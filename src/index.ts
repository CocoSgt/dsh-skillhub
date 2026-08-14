/**
 * dsh-skill-manager 宿主端 half。
 *
 * 官方 RPC map 是构建期固定的（第三方插件不能注册新 RPC），settings 线上
 * 面也只暴露白名单命名空间，因此浏览器面板与本插件宿主 half 之间的数据
 * 通道是一个自建的环回 sidecar HTTP 服务：
 * - 绑定 127.0.0.1，端口取 3180–3189 中第一个空闲位（官方 web 默认 3080）。
 * - Origin/Host 围栏只放行本机来源（127.0.0.1 / localhost / [::1]），
 *   恶意网站的跨站请求与 DNS rebinding 均被拒绝。
 * - 端点：GET /ping（发现）、GET /state（状态+来源配置）、POST /command
 *   （rescan / import / importPaste / read / save / delete / setSources）。
 *
 * 导入的技能清洗为标准格式后写入 `<dshHome>/skills/<name>/SKILL.md`，
 * 该目录是官方 skill-filesystem provider 的默认扫描根（rank 400），
 * 因此导入完成后技能自动出现在 `/` 斜杠菜单中，无需其他接线。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-skill-manager'

/** 环回 sidecar 的端口扫描范围；浏览器 half 按同样的顺序探测。 */
const PORT_RANGE = Array.from({ length: 10 }, (_, i) => 3180 + i)
/** 单个命令请求体上限（粘贴导入的技能全文）。 */
const MAX_BODY_BYTES = 5 * 1024 * 1024
/** 名称规范化后必须匹配的模式，同时是路径安全边界（无 `/`、无 `..`）。 */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DEFAULT_SOURCES = ['~/.claude/skills']

interface InstalledSkill {
  name: string
  description: string
  whenToUse: string
  /** 'both' | 'user' | 'model'：来自 disable-model-invocation / user-invocable。 */
  invocation: string
  addedAt: string
  source: string
  /** 技能文件的绝对路径。 */
  file: string
}

interface ImportableSkill {
  name: string
  description: string
  sourcePath: string
}

interface StateStatus {
  message: string
  installed: InstalledSkill[]
  importable: ImportableSkill[]
}

interface StateFile {
  sources?: string[]
  skills?: Record<string, { addedAt: string, source: string }>
}

interface StateCommand {
  action: 'rescan' | 'import' | 'importPaste' | 'read' | 'save' | 'delete' | 'setSources'
  name?: string
  content?: string
  description?: string
  sourcePath?: string
  sources?: string[]
}

/** dsh 主目录：$DSH_HOME 覆盖，默认 ~/.dsh（与 skill-filesystem provider 一致）。 */
function dshHome(): string {
  const env = process.env['DSH_HOME']
  return env !== undefined && env.trim() !== '' ? env : path.join(os.homedir(), '.dsh')
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** 极简 frontmatter 拆分：只认首行 `---` 到下一行 `---` 的块。 */
function splitFrontmatter(text: string): { raw: string[], body: string } {
  if (!text.startsWith('---')) return { raw: [], body: text }
  const lines = text.split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      return { raw: lines.slice(1, i), body: lines.slice(i + 1).join('\n') }
    }
  }
  return { raw: [], body: text }
}

function scalar(lines: string[], key: string): string | undefined {
  for (const line of lines) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match !== null && match[1] === key) return match[2]!.trim()
  }
  return undefined
}

/** kebab-case 名称；无法得出时回退 'skill'。保证匹配 NAME_PATTERN。 */
function normalizeName(input: string): string {
  const kebab = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const safe = kebab === '' ? 'skill' : kebab
  return /^\d/.test(safe) ? `s-${safe}` : safe
}

/** 缺 description 时取正文第一行非标题文本充当。 */
function fallbackDescription(body: string): string {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('---')) continue
    const clean = trimmed.replace(/[*`_[\]()]/g, '').trim()
    if (clean === '') continue
    return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean
  }
  return '(no description)'
}

interface ParsedSkill {
  name: string
  description: string
  whenToUse: string
  invocation: 'both' | 'user' | 'model'
  content: string
}

/**
 * 清洗管线入口：解析任意 Markdown/SKILL.md 文本，产出规范命名的
 * SKILL.md 全文。保留 name/description 之外的全部 frontmatter 原行
 * （whenToUse、metadata、disable-model-invocation、user-invocable 等）。
 */
function parseSkillText(text: string, fallbackName: string, fallbackDesc: string): ParsedSkill {
  const { raw, body } = splitFrontmatter(text.replace(/^﻿/, ''))
  const fmName = scalar(raw, 'name')
  const fmDescription = scalar(raw, 'description')
  const fmWhenToUse = scalar(raw, 'whenToUse')
  const disableModel = scalar(raw, 'disable-model-invocation') === 'true'
  const userInvocable = scalar(raw, 'user-invocable')

  let invocation: ParsedSkill['invocation'] = 'both'
  if (disableModel) invocation = 'user'
  else if (userInvocable === 'false') invocation = 'model'

  const name = normalizeName(fmName !== undefined && fmName !== '' ? fmName : fallbackName)
  const description = fmDescription !== undefined && fmDescription !== ''
    ? fmDescription
    : (fallbackDesc !== '' ? fallbackDesc : fallbackDescription(body))
  const whenToUse = fmWhenToUse ?? ''

  // 保留除 name/description 外的原始 frontmatter 行，维持未知键原样。
  const kept = raw.filter(line => {
    const match = /^([A-Za-z0-9_-]+):/.exec(line)
    return match === null || (match[1] !== 'name' && match[1] !== 'description')
  })

  const fmOut = [`name: ${name}`, `description: ${description}`, ...kept]
  const content = `---\n${fmOut.join('\n')}\n---\n\n${body.trim()}\n`
  return { name, description, whenToUse, invocation, content }
}

/** 环回来源判定：dsh web 页面本身，或无 Origin 的本机进程（curl 等）。 */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers['origin']
  if (origin === undefined) return true
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/iu.test(String(origin))
}

function hostIsLoopback(req: IncomingMessage): boolean {
  const host = String(req.headers['host'] ?? '')
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/iu.test(host)
}

export function apply(ctx: Context): void {
  const skillsDir = path.join(dshHome(), 'skills')
  const trashDir = path.join(dshHome(), 'skill-trash')
  const statePath = path.join(skillsDir, '.skill-manager.json')

  /** 来源配置与导入清单共用一个状态文件；损坏时回退默认。 */
  async function readState(): Promise<StateFile> {
    try {
      return JSON.parse(await readFile(statePath, 'utf8')) as StateFile
    } catch {
      return {}
    }
  }

  async function writeState(state: StateFile): Promise<void> {
    await mkdir(skillsDir, { recursive: true })
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  /** 扫描已安装技能：`<name>/SKILL.md` 目录式与 `<name>.md` 平铺式。 */
  async function scanInstalled(): Promise<InstalledSkill[]> {
    const state = await readState()
    const out: InstalledSkill[] = []
    let entries: string[]
    try {
      entries = await readdir(skillsDir)
    } catch {
      return out
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const full = path.join(skillsDir, entry)
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      let file: string | undefined
      let fallbackName = entry
      if (info.isDirectory()) {
        for (const candidate of ['SKILL.md', 'skill.md']) {
          const probe = path.join(full, candidate)
          try {
            await stat(probe)
            file = probe
            break
          } catch { /* try next */ }
        }
      } else if (entry.endsWith('.md')) {
        file = full
        fallbackName = entry.slice(0, -3)
      } else {
        continue
      }
      if (file === undefined) continue
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue
      }
      const { raw, body } = splitFrontmatter(text)
      const name = normalizeName(scalar(raw, 'name') ?? fallbackName)
      const meta = state.skills?.[name]
      out.push({
        name,
        description: scalar(raw, 'description') ?? fallbackDescription(body),
        whenToUse: scalar(raw, 'whenToUse') ?? '',
        invocation: scalar(raw, 'disable-model-invocation') === 'true'
          ? 'user'
          : scalar(raw, 'user-invocable') === 'false' ? 'model' : 'both',
        addedAt: meta?.addedAt ?? '',
        source: meta?.source ?? '',
        file,
      })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  /** 扫描外部来源目录中可导入的技能，剔除已安装同名项。 */
  async function scanImportable(sources: string[], installed: InstalledSkill[]): Promise<ImportableSkill[]> {
    const installedNames = new Set(installed.map(s => s.name))
    const out = new Map<string, ImportableSkill>()
    for (const source of sources) {
      const dir = expandHome(source)
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.startsWith('.') || installedNames.has(normalizeName(entry))) continue
        const full = path.join(dir, entry)
        let info
        try {
          info = await stat(full)
        } catch {
          continue
        }
        let file: string | undefined
        let fallbackName = entry
        if (info.isDirectory()) {
          const probe = path.join(full, 'SKILL.md')
          try {
            await stat(probe)
            file = probe
          } catch {
            continue
          }
        } else if (entry.endsWith('.md')) {
          file = full
          fallbackName = entry.slice(0, -3)
        } else {
          continue
        }
        if (file === undefined) continue
        let text: string
        try {
          text = await readFile(file, 'utf8')
        } catch {
          continue
        }
        const { raw, body } = splitFrontmatter(text)
        const name = normalizeName(scalar(raw, 'name') ?? fallbackName)
        if (installedNames.has(name) || out.has(name)) continue
        out.set(name, {
          name,
          description: scalar(raw, 'description') ?? fallbackDescription(body),
          sourcePath: file,
        })
      }
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** 技能名在 skillsDir 下对应的现有路径（目录式或平铺式），不存在则 undefined。 */
  async function existingPath(name: string): Promise<string | undefined> {
    for (const candidate of [path.join(skillsDir, name, 'SKILL.md'), path.join(skillsDir, `${name}.md`)]) {
      try {
        await stat(candidate)
        return candidate
      } catch { /* try next */ }
    }
    return undefined
  }

  /** 同名已存在时追加 -2/-3… 序号。 */
  async function uniqueName(base: string): Promise<string> {
    if (await existingPath(base) === undefined) return base
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`
      if (await existingPath(candidate) === undefined) return candidate
    }
    return `${base}-${Date.now()}`
  }

  /** import 命令的 sourcePath 必须位于某个配置来源目录内，拒绝任意路径读取。 */
  async function sourceAllowed(sourcePath: string): Promise<boolean> {
    const sources = (await readState()).sources ?? DEFAULT_SOURCES
    for (const source of sources) {
      const root = `${expandHome(source).replace(/\/+$/, '')}/`
      if (sourcePath.startsWith(root)) return true
    }
    return sourcePath.startsWith(`${skillsDir.replace(/\/+$/, '')}/`)
  }

  async function execute(cmd: StateCommand): Promise<{ message: string, body?: { name: string, content: string } }> {
    switch (cmd.action) {
      case 'rescan':
        return { message: '已刷新技能列表' }
      case 'import': {
        const sourcePath = cmd.sourcePath ?? ''
        if (sourcePath === '' || !await sourceAllowed(sourcePath)) {
          return { message: '导入失败：来源路径不在配置的来源目录内' }
        }
        let text: string
        try {
          text = await readFile(sourcePath, 'utf8')
        } catch (error) {
          ctx.logger.warn(error)
          return { message: '导入失败：无法读取来源文件' }
        }
        const parsed = parseSkillText(text, path.basename(sourcePath).replace(/\.md$/iu, ''), '')
        const name = await uniqueName(parsed.name)
        await mkdir(path.join(skillsDir, name), { recursive: true })
        await writeFile(path.join(skillsDir, name, 'SKILL.md'), parsed.content, 'utf8')
        const state = await readState()
        state.skills = { ...state.skills, [name]: { addedAt: new Date().toISOString(), source: sourcePath } }
        await writeState(state)
        return { message: `已导入技能「${name}」` }
      }
      case 'importPaste': {
        const content = cmd.content ?? ''
        if (content.trim() === '') return { message: '导入失败：内容为空' }
        const parsed = parseSkillText(content, cmd.name ?? '', cmd.description ?? '')
        const name = await uniqueName(parsed.name)
        await mkdir(path.join(skillsDir, name), { recursive: true })
        await writeFile(path.join(skillsDir, name, 'SKILL.md'), parsed.content, 'utf8')
        const state = await readState()
        state.skills = { ...state.skills, [name]: { addedAt: new Date().toISOString(), source: 'paste' } }
        await writeState(state)
        return { message: `已导入技能「${name}」` }
      }
      case 'read': {
        const name = cmd.name ?? ''
        if (!NAME_PATTERN.test(name)) return { message: '读取失败：技能名不合法' }
        const file = await existingPath(name)
        if (file === undefined) return { message: `读取失败：找不到技能「${name}」` }
        return { message: `已读取「${name}」`, body: { name, content: await readFile(file, 'utf8') } }
      }
      case 'save': {
        const name = cmd.name ?? ''
        if (!NAME_PATTERN.test(name)) return { message: '保存失败：技能名不合法' }
        const parsed = parseSkillText(cmd.content ?? '', name, '')
        await mkdir(path.join(skillsDir, name), { recursive: true })
        await writeFile(path.join(skillsDir, name, 'SKILL.md'), parsed.content, 'utf8')
        const state = await readState()
        if (state.skills?.[name] === undefined) {
          state.skills = { ...state.skills, [name]: { addedAt: new Date().toISOString(), source: 'edit' } }
          await writeState(state)
        }
        return { message: `已保存「${name}」` }
      }
      case 'delete': {
        const name = cmd.name ?? ''
        if (!NAME_PATTERN.test(name)) return { message: '删除失败：技能名不合法' }
        const file = await existingPath(name)
        if (file === undefined) return { message: `删除失败：找不到技能「${name}」` }
        // 目录式技能连目录一起进回收站，平铺式只移文件本身。
        const dir = path.dirname(file)
        const target = path.basename(dir) === name ? dir : file
        await mkdir(trashDir, { recursive: true })
        await rename(target, path.join(trashDir, `${Date.now()}-${name}`))
        const state = await readState()
        if (state.skills?.[name] !== undefined) {
          delete state.skills[name]
          await writeState(state)
        }
        return { message: `已删除「${name}」（可在 skill-trash 目录找回）` }
      }
      case 'setSources': {
        const sources = cmd.sources ?? []
        if (sources.some(s => typeof s !== 'string' || s.trim() === '')) {
          return { message: '保存失败：来源目录列表不合法' }
        }
        const state = await readState()
        state.sources = sources
        await writeState(state)
        return { message: '已保存来源配置' }
      }
      default:
        return { message: '未知命令' }
    }
  }

  async function buildStatus(message: string): Promise<StateStatus> {
    const installed = await scanInstalled()
    const sources = (await readState()).sources ?? DEFAULT_SOURCES
    return { message, installed, importable: await scanImportable(sources, installed) }
  }

  /**
   * CORS 回显：originAllowed 已把 Origin 限定为本机环回地址，这里必须
   * 原样回显该值——写死 127.0.0.1 会让 localhost 页面上的跨源 fetch
   *（页面 localhost:3080 → sidecar 127.0.0.1:318x）全部失败。
   */
  function allowedOrigin(req: IncomingMessage): string {
    const origin = req.headers['origin']
    return origin === undefined ? 'http://127.0.0.1' : String(origin)
  }

  function sendJson(req: IncomingMessage, res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': allowedOrigin(req),
      vary: 'Origin',
    })
    res.end(JSON.stringify(payload))
  }

  /** 读定长请求体；超限与坏 JSON 都变成 4xx 而不是断连。 */
  function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(new Error('payload too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }

  const server: Server = createServer((req, res) => {
    if (!originAllowed(req) || !hostIsLoopback(req)) {
      sendJson(req, res, 403, { ok: false, error: 'forbidden' })
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': allowedOrigin(req),
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
        vary: 'Origin',
      })
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/ping') {
      sendJson(req, res, 200, { ok: true, plugin: name })
      return
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      void buildStatus('')
        .then(async status => sendJson(req, res, 200, {
          ok: true,
          status,
          sources: (await readState()).sources ?? DEFAULT_SOURCES,
        }))
        .catch((error: unknown) => {
          ctx.logger.warn(error)
          sendJson(req, res, 500, { ok: false, error: 'state build failed' })
        })
      return
    }
    if (req.method === 'POST' && url.pathname === '/command') {
      void readBody(req)
        .then(async raw => {
          const cmd = JSON.parse(raw.toString('utf8')) as StateCommand
          const result = await execute(cmd)
          const status = await buildStatus(result.message)
          sendJson(req, res, 200, {
            ok: true,
            message: result.message,
            status,
            ...result.body === undefined ? {} : { body: result.body },
          })
        })
        .catch((error: unknown) => {
          ctx.logger.warn(error)
          sendJson(req, res, 400, { ok: false, error: error instanceof Error ? error.message : 'bad request' })
        })
      return
    }
    sendJson(req, res, 404, { ok: false, error: 'not found' })
  })

  /** 依序试绑端口范围；全占满时退到 OS 随机端口并告警（发现协议会失效）。 */
  function listen(index: number): void {
    if (index >= PORT_RANGE.length) {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address !== null ? String(address.port) : '?'
        ctx.logger.warn(`dsh-skill-manager: 端口 ${String(PORT_RANGE[0])}–${String(PORT_RANGE.at(-1))} 均被占用，退到随机端口 ${port}（浏览器面板将无法自动发现）`)
      })
      return
    }
    server.once('error', () => listen(index + 1))
    server.listen(PORT_RANGE[index]!, '127.0.0.1', () => {
      // 失败的那次 listen 的回调不会被消费：端口占用重试后，旧回调会在
      // 最终成功时补跑。以实际绑定地址为准，只记真实端口的一条日志。
      const address = server.address()
      const bound = typeof address === 'object' && address !== null ? address.port : undefined
      if (bound === PORT_RANGE[index]) {
        ctx.logger.info(`dsh-skill-manager: sidecar 已就绪 http://127.0.0.1:${String(bound)}`)
      }
    })
  }

  listen(0)

  ctx.effect(() => () => {
    server.close()
  })
}
