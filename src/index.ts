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
import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-skill-manager'

/** 环回 sidecar 的端口扫描范围；浏览器 half 按同样的顺序探测。 */
const PORT_RANGE = Array.from({ length: 10 }, (_, i) => 3180 + i)
/** 单个命令请求体上限（.skill 上传走 base64，放宽到 64 MB）。 */
const MAX_BODY_BYTES = 64 * 1024 * 1024
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
  action: 'rescan' | 'import' | 'importPaste' | 'importArchive' | 'read' | 'save' | 'delete' | 'export' | 'setSources'
  name?: string
  content?: string
  description?: string
  sourcePath?: string
  sources?: string[]
  /** .skill 上传：zip 全文的 base64。 */
  archiveBase64?: string
}

/** Claude 网页版的 .skill 文件即 zip：`<name>/SKILL.md` + 任意资源文件。 */
interface ZipEntry {
  name: string
  data: Buffer
}

/** 极简 zip 读取：EOCD 定位中央目录，支持 stored(0)/deflate(8)。不做 ZIP64。 */
function readZip(buffer: Buffer): ZipEntry[] {
  let eocd = -1
  const scanFloor = Math.max(0, buffer.length - 22 - 65536)
  for (let i = buffer.length - 22; i >= scanFloor; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 .skill 包（缺少 zip 结束目录）')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const out: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('.skill 包中央目录损坏')
    const method = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    if (!name.endsWith('/')) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('.skill 包本地头损坏')
      const localNameLen = buffer.readUInt16LE(localOffset + 26)
      const localExtraLen = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      const compressed = buffer.subarray(dataStart, dataStart + compSize)
      if (method === 0) out.push({ name, data: Buffer.from(compressed) })
      else if (method === 8) out.push({ name, data: inflateRawSync(compressed) })
      else throw new Error(`不支持的压缩方式 ${String(method)}（${name}）`)
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** zip 写入需要的 CRC32（多项式 0xEDB88320，查表法）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** 极简 zip 写入：全 deflate，无目录条目。足够生成 .skill 导出包。 */
function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名标志
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, compressed)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4) // version made by
    dir.writeUInt16LE(20, 6) // version needed
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(compressed.length, 20)
    dir.writeUInt32LE(entry.data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)
    offset += local.length + nameBuf.length + compressed.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8) // 本盘条目数
  eocd.writeUInt16LE(entries.length, 10) // 总条目数
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, eocd])
}

/** zip 条目名安全化：拒绝绝对路径与 `..`，返回清理后的相对名。 */
function safeEntryName(name: string): string | undefined {
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /[^\x20-￿]/.test(normalized)) return undefined
  const segments = normalized.split('/')
  if (segments.includes('..') || segments.includes('')) return undefined
  return segments.join('/')
}

/** 若所有条目共享同一个顶层目录（`<name>/SKILL.md` 形态）则剥掉它。 */
function commonTopDir(entries: ZipEntry[]): string | undefined {
  const tops = new Set(entries.map(entry => entry.name.split('/')[0] ?? ''))
  if (tops.size !== 1) return undefined
  const top = [...tops][0]!
  return entries.every(entry => entry.name === top || entry.name.startsWith(`${top}/`)) ? top : undefined
}

/** 找包内 SKILL.md 条目（顶层或剥掉顶层目录后的顶层）。 */
function findSkillMd(entries: ZipEntry[]): ZipEntry | undefined {
  const top = commonTopDir(entries)
  const prefix = top === undefined ? '' : `${top}/`
  return entries.find(entry => entry.name === `${prefix}SKILL.md`)
}

/**
 * 把 .skill 包解到目标目录。目录式技能整树保留（references/、files/ 等
 * 资源由官方 skill-filesystem 的 resourceBase 机制可用）。
 */
async function extractZip(entries: ZipEntry[], destDir: string): Promise<void> {
  if (findSkillMd(entries) === undefined) throw new Error('.skill 包内没有 SKILL.md')
  const top = commonTopDir(entries)
  const prefix = top === undefined ? '' : `${top}/`
  for (const entry of entries) {
    const stripped = prefix === '' ? entry.name : entry.name.slice(prefix.length)
    if (stripped === '') continue
    const safe = safeEntryName(stripped)
    if (safe === undefined) throw new Error(`包内路径不安全：${entry.name}`)
    await mkdir(path.dirname(path.join(destDir, safe)), { recursive: true })
    await writeFile(path.join(destDir, safe), entry.data)
  }
}

/** 多行 frontmatter 值的尽力而为读取（`description: |` 块取首个非空行）。 */
function scalarMultiline(lines: string[], key: string): string | undefined {
  const single = scalar(lines, key)
  if (single !== undefined && single !== '' && single !== '|' && single !== '>' && !single.startsWith('|-') && !single.startsWith('>-')) {
    return single
  }
  const index = lines.findIndex(line => /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)?.[1] === key)
  if (index < 0) return undefined
  for (const line of lines.slice(index + 1)) {
    if (/^\S/.test(line)) break // 回到顶格键：块结束
    const trimmed = line.trim()
    if (trimmed === '') continue
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed
  }
  return undefined
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
        description: scalarMultiline(raw, 'description') ?? fallbackDescription(body),
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

  /**
   * 扫描外部来源目录中可导入的技能，剔除已安装同名项。三种形态：
   * 目录式（含 SKILL.md + 资源树）、平铺 `.md`、Claude 网页版导出的
   * `.skill` zip 包。
   */
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
        if (info.isFile() && entry.endsWith('.skill')) {
          // 打包技能：解包内 SKILL.md 的 frontmatter 取名与描述
          let name = normalizeName(entry.replace(/\.skill$/iu, ''))
          let description = '（打包技能）'
          try {
            const zipEntries = readZip(await readFile(full))
            const skillMd = findSkillMd(zipEntries)
            if (skillMd !== undefined) {
              const { raw, body } = splitFrontmatter(skillMd.data.toString('utf8'))
              name = normalizeName(scalar(raw, 'name') ?? name)
              description = scalarMultiline(raw, 'description') ?? fallbackDescription(body)
            }
          } catch { /* 损坏的包按文件名展示，导入时报错 */ }
          if (!installedNames.has(name) && !out.has(name)) {
            out.set(name, { name, description, sourcePath: full })
          }
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
          description: scalarMultiline(raw, 'description') ?? fallbackDescription(body),
          sourcePath: info.isDirectory() ? full : file,
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

  /**
   * 把技能目录里 SKILL.md 的 frontmatter `name:` 同步为最终目录名。
   * 去重安装（-2/-3 序号）或 frontmatter 与目录名不一致时，身份以目录为准。
   */
  async function syncFrontmatterName(dir: string, name: string): Promise<void> {
    const skillMd = path.join(dir, 'SKILL.md')
    let text: string
    try {
      text = await readFile(skillMd, 'utf8')
    } catch {
      return
    }
    const { raw } = splitFrontmatter(text)
    if (scalar(raw, 'name') === name) return
    const updated = raw.some(line => /^([A-Za-z0-9_-]+):/.exec(line)?.[1] === 'name')
      ? text.replace(/^name:.*$/mu, `name: ${name}`)
      : text.replace(/^---\n/u, `---\nname: ${name}\n`)
    await writeFile(skillMd, updated, 'utf8')
  }

  /** 安装 .skill 包：名称取包内 frontmatter，整树解压到 skills/<name>/。 */
  async function installArchive(entries: ZipEntry[], fallbackName: string, source: string): Promise<{ message: string }> {
    let name = fallbackName
    const skillMd = findSkillMd(entries)
    if (skillMd !== undefined) {
      const fmName = scalar(splitFrontmatter(skillMd.data.toString('utf8')).raw, 'name')
      if (fmName !== undefined && fmName !== '') name = normalizeName(fmName)
    }
    name = await uniqueName(name)
    try {
      await extractZip(entries, path.join(skillsDir, name))
    } catch (error) {
      ctx.logger.warn(error)
      return { message: `导入失败：${error instanceof Error ? error.message : String(error)}` }
    }
    await syncFrontmatterName(path.join(skillsDir, name), name)
    const state = await readState()
    state.skills = { ...state.skills, [name]: { addedAt: new Date().toISOString(), source } }
    await writeState(state)
    return { message: `已导入技能「${name}」（含全部资源文件）` }
  }

  /** 递归收集技能目录为 zip 条目（`<name>/<相对路径>`）。 */
  async function collectTree(rootDir: string, prefix: string): Promise<ZipEntry[]> {
    const out: ZipEntry[] = []
    const walk = async (dir: string, rel: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === '.DS_Store') continue
        const full = path.join(dir, entry.name)
        const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
        if (entry.isDirectory()) await walk(full, relPath)
        else if (entry.isFile()) out.push({ name: `${prefix}/${relPath}`, data: await readFile(full) })
      }
    }
    await walk(rootDir, '')
    return out
  }

  async function execute(cmd: StateCommand): Promise<{ message: string, body?: { name: string, content: string }, archiveBase64?: string }> {
    switch (cmd.action) {
      case 'rescan':
        return { message: '已刷新技能列表' }
      case 'import': {
        const sourcePath = cmd.sourcePath ?? ''
        if (sourcePath === '' || !await sourceAllowed(sourcePath)) {
          return { message: '导入失败：来源路径不在配置的来源目录内' }
        }
        let info
        try {
          info = await stat(sourcePath)
        } catch (error) {
          ctx.logger.warn(error)
          return { message: '导入失败：无法读取来源' }
        }
        // 目录式技能：整树拷贝（SKILL.md + references/ 等资源），保持字节原样
        if (info.isDirectory()) {
          let name = normalizeName(path.basename(sourcePath))
          try {
            const text = await readFile(path.join(sourcePath, 'SKILL.md'), 'utf8')
            name = normalizeName(scalar(splitFrontmatter(text).raw, 'name') ?? name)
          } catch { /* 无 frontmatter 时用目录名 */ }
          const finalName = await uniqueName(name)
          try {
            await cp(sourcePath, path.join(skillsDir, finalName), { recursive: true, dereference: true })
          } catch (error) {
            ctx.logger.warn(error)
            return { message: '导入失败：拷贝技能目录出错' }
          }
          await syncFrontmatterName(path.join(skillsDir, finalName), finalName)
          const state = await readState()
          state.skills = { ...state.skills, [finalName]: { addedAt: new Date().toISOString(), source: sourcePath } }
          await writeState(state)
          return { message: `已导入技能「${finalName}」（含全部资源文件）` }
        }
        // .skill 打包：整包解压
        if (sourcePath.endsWith('.skill')) {
          let entries: ZipEntry[]
          try {
            entries = readZip(await readFile(sourcePath))
          } catch (error) {
            ctx.logger.warn(error)
            return { message: `导入失败：${error instanceof Error ? error.message : String(error)}` }
          }
          return await installArchive(entries, normalizeName(path.basename(sourcePath).replace(/\.skill$/iu, '')), sourcePath)
        }
        // 平铺 .md：走清洗管线
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
      case 'importArchive': {
        const archiveBase64 = cmd.archiveBase64 ?? ''
        if (archiveBase64 === '') return { message: '导入失败：没有收到文件内容' }
        let entries: ZipEntry[]
        try {
          entries = readZip(Buffer.from(archiveBase64, 'base64'))
        } catch (error) {
          ctx.logger.warn(error)
          return { message: `导入失败：${error instanceof Error ? error.message : String(error)}` }
        }
        const fallbackName = normalizeName((cmd.name ?? '').replace(/\.skill$/iu, ''))
        return await installArchive(entries, fallbackName, 'upload')
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
      case 'export': {
        const name = cmd.name ?? ''
        if (!NAME_PATTERN.test(name)) return { message: '导出失败：技能名不合法' }
        const file = await existingPath(name)
        if (file === undefined) return { message: `导出失败：找不到技能「${name}」` }
        try {
          const dir = path.dirname(file)
          const isBundle = path.basename(dir) === name
          // 目录式：整树打包；平铺式：单文件也按 <name>/SKILL.md 形态打包
          const entries = isBundle
            ? await collectTree(dir, name)
            : [{ name: `${name}/SKILL.md`, data: await readFile(file) }]
          if (!entries.some(entry => entry.name === `${name}/SKILL.md`)) {
            return { message: `导出失败：「${name}」缺少 SKILL.md` }
          }
          return { message: `已导出「${name}」为 .skill 包`, archiveBase64: writeZip(entries).toString('base64') }
        } catch (error) {
          ctx.logger.warn(error)
          return { message: '导出失败：打包出错' }
        }
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
            ...result.archiveBase64 === undefined ? {} : { archiveBase64: result.archiveBase64 },
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
