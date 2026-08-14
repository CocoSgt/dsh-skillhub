/**
 * dsh-skills 宿主端:skillHub 网关服务。
 *
 * 核心机制:把散落各处的技能(Claude Code 的 ~/.claude/skills、项目目录、
 * .skill 包……)汇成 `<dshHome>/skills/` 这个全局库——官方 skill-filesystem
 * 的默认扫描根(rank 400,watcher 实时),入库即出现在 `/` 斜杠菜单。
 *
 * 两种入库身份:
 *   - **引用(link,默认推荐)**:`skills/<name>` 是指向来源目录/文件的符号
 *     链接。只有一份文件,没有同步问题;编辑引用技能=编辑来源本身。
 *     harness 的扫描(nodeEntryKind 跟随符号链接)、fs 提供者与 watcher
 *     (followSymlinks 默认开)都原生支持。来源消失时面板标注「引用失效」。
 *   - **副本(copy)**:整树拷贝,与来源独立演化;state 记录来源路径备查
 *     (漂移检测是二期,本期只记录不判定)。
 *
 * 传输:此前的环回 sidecar HTTP 服务已移除,改为 TypertRemoteService +
 * 弱(src-json)清单注册(第三方双副本下 SRC 发现失明,原因与
 * dsh-inspector 相同)。暴露 `skillHub/getState|runCommand|browseDirs`
 * 三个 RPC(browseDirs 供来源选择器逐级浏览目录);runCommand 的负载是
 * 既有的命令联合,src-json 原样过 wire。
 *
 * 重要:Gateway 按参数名生成 wire 字段,公开方法保持简单标识符参数。
 * 不使用 @Remote 装饰器:第三方双副本下宿主读不到本副本的装饰器标记
 * (端点全靠上面的弱清单),且 tsdown 产物保留装饰器语法会让 Node 导入报错。
 */

import { cp, lstat, mkdir, readdir, readFile, readlink, rename, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** 名称规范化后必须匹配的模式,同时是路径安全边界(无 `/`、无 `..`)。 */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DEFAULT_SOURCES = ['~/.claude/skills']

/** 技能的入库身份。 */
export type SkillMode = 'link' | 'copy' | 'local'

/** 全局库里的一个技能。 */
export interface HubSkill {
  name: string
  description: string
  whenToUse: string
  /** 'both' | 'user' | 'model':来自 disable-model-invocation / user-invocable。 */
  invocation: string
  addedAt: string
  /** 入库身份;旧版无记录的条目按 local 展示。 */
  mode: SkillMode
  /** link/copy 的来源路径('' 表示无来源:粘贴/编辑创建)。 */
  sourcePath: string
  /** link 的目标已消失(或不可读)。 */
  broken: boolean
  /** SKILL.md 之外的资源文件数(平铺 .md 恒 0)。 */
  resourceCount: number
  /** SKILL.md(或平铺 .md)的绝对路径。 */
  file: string
  /** 技能目录的绝对路径(平铺 .md 为其所在目录)。 */
  dir: string
}

/** 来源目录里一个可入库的技能。 */
export interface DiscoverableSkill {
  name: string
  description: string
  sourcePath: string
  /** .skill 打包技能只能复制,不能引用。 */
  kind: 'dir' | 'md' | 'archive'
}

/** 一个来源目录的状态。 */
export interface SourceInfo {
  /** 配置原文(可含 ~)。 */
  path: string
  /** 目录当前是否存在可读。 */
  exists: boolean
  /** 目录里技能形态条目总数(含已入库的)。 */
  skillCount: number
}

/** getState / runCommand 附带的完整状态。 */
export interface HubState {
  message: string
  skills: HubSkill[]
  discoverable: DiscoverableSkill[]
  sources: SourceInfo[]
}

interface StateFile {
  sources?: string[]
  skills?: Record<string, { addedAt: string, source: string, mode?: SkillMode }>
}

/** runCommand 的命令联合(src-json 原样过 wire)。 */
export interface HubCommand {
  action: 'rescan' | 'importLink' | 'importLinkBatch' | 'importCopy' | 'importPaste' | 'importArchive'
    | 'read' | 'save' | 'delete' | 'export' | 'setSources'
  /** importLinkBatch:一次引用多个来源。 */
  sourcePaths?: string[]
  name?: string
  content?: string
  description?: string
  sourcePath?: string
  sources?: string[]
  /** .skill 上传:zip 全文的 base64。 */
  archiveBase64?: string
}

/** 目录浏览器的一个子目录条目。 */
export interface BrowseEntry {
  /** 目录名。 */
  name: string
  /** 其中技能形态条目数(限量探测;0 表示没有或未探测到)。 */
  skillCount: number
}

/** browseDirs 的返回。 */
export interface BrowseResult {
  /** 当前目录绝对路径。 */
  path: string
  /** 展示路径(home 缩写为 ~)。 */
  display: string
  /** 上一级绝对路径(已到文件系统根时缺省)。 */
  parent?: string
  /** 子目录列表(技能多的在前)。 */
  dirs: BrowseEntry[]
  /** 常见技能位置建议(仅根调用返回;已配置的来源不重复给)。 */
  suggestions?: { path: string, skillCount: number }[]
}

/** runCommand 的返回。 */
export interface HubCommandResult {
  /**
   * 稳定结果码(点分,如 'import.linked' / 'err.read.notFound'):客户端据此
   * 取本地化文案;message 保留为中文回退,保证 wire 向后兼容。
   */
  code?: string
  /** code 对应文案的 {占位符} 参数。 */
  params?: Record<string, unknown>
  /** 显式语气:'error' 时客户端标红(替代对 message 文案的正则猜测);缺省 idle。 */
  level?: 'error'
  /** 中文回退文案(恒有值;src-json 不允许 undefined,可选字段按需展开)。 */
  message: string
  state: HubState
  body?: { name: string, content: string }
  archiveBase64?: string
}

/** execute 及各导入助手的统一结果:code 必填,错误路径带 level: 'error'。 */
interface ExecOutcome {
  code: string
  message: string
  params?: Record<string, unknown>
  level?: 'error'
  body?: { name: string, content: string }
  archiveBase64?: string
}

/** Claude 网页版的 .skill 文件即 zip:`<name>/SKILL.md` + 任意资源文件。 */
interface ZipEntry {
  name: string
  data: Buffer
}

/** 单个 zip 条目解压后的上限(64MB):inflate 前先查中央目录声明,inflate 后再兜底复查。 */
const ZIP_ENTRY_LIMIT = 64 * 1024 * 1024
/** 全部条目解压后的累计上限(256MB):防「千刀万剐」式多小条目炸弹。 */
const ZIP_TOTAL_LIMIT = 256 * 1024 * 1024
/** importArchive 上传 base64 的长度上限(64MB 字符 ≈ 48MB 二进制)。 */
const ARCHIVE_BASE64_LIMIT = 64 * 1024 * 1024

/** 极简 zip 读取:EOCD 定位中央目录,支持 stored(0)/deflate(8)。不做 ZIP64。 */
function readZip(buffer: Buffer): ZipEntry[] {
  let eocd = -1
  const scanFloor = Math.max(0, buffer.length - 22 - 65536)
  for (let i = buffer.length - 22; i >= scanFloor; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 .skill 包(缺少 zip 结束目录)')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const out: ZipEntry[] = []
  let totalSize = 0
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('.skill 包中央目录损坏')
    const method = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    // 声明的解压后大小:inflate 前先按上限拦截(头部可伪造,inflate 后仍要复查)。
    const uncompSize = buffer.readUInt32LE(offset + 24)
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
      // 解压前:中央目录声明的解压后大小超限即拒(伪造小声明的情况由下面的兜底复查覆盖)。
      if (uncompSize > ZIP_ENTRY_LIMIT || totalSize + uncompSize > ZIP_TOTAL_LIMIT) {
        throw new Error(`zip 条目解压后超过上限:${name}`)
      }
      let data: Buffer
      if (method === 0) {
        data = Buffer.from(compressed)
      } else if (method === 8) {
        try {
          // maxOutputLength 让 zlib 在越过上限时立即中断,不把整块炸弹灌进内存。
          data = inflateRawSync(compressed, { maxOutputLength: ZIP_ENTRY_LIMIT + 1 })
        } catch (error) {
          // 头部声明偏小的真炸弹在此暴露;其余(损坏流等)错误原样透传。
          if (error instanceof RangeError || (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
            throw new Error(`zip 条目解压后超过上限:${name}`)
          }
          throw error as Error
        }
      } else {
        throw new Error(`不支持的压缩方式 ${String(method)}(${name})`)
      }
      // 解压后:实际大小复查(头部可撒谎),并累计总量。
      if (data.length > ZIP_ENTRY_LIMIT || totalSize + data.length > ZIP_TOTAL_LIMIT) {
        throw new Error(`zip 条目解压后超过上限:${name}`)
      }
      totalSize += data.length
      out.push({ name, data })
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** zip 写入需要的 CRC32(多项式 0xEDB88320,查表法)。 */
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

/** 极简 zip 写入:全 deflate,无目录条目。足够生成 .skill 导出包。 */
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
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, compressed)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
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
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, eocd])
}

/** zip 条目名安全化:拒绝绝对路径与 `..`,返回清理后的相对名。 */
function safeEntryName(name: string): string | undefined {
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /[^\x20-￿]/.test(normalized)) return undefined
  const segments = normalized.split('/')
  if (segments.includes('..') || segments.includes('')) return undefined
  return segments.join('/')
}

/** 若所有条目共享同一个顶层目录(`<name>/SKILL.md` 形态)则剥掉它。 */
function commonTopDir(entries: ZipEntry[]): string | undefined {
  const tops = new Set(entries.map(entry => entry.name.split('/')[0] ?? ''))
  if (tops.size !== 1) return undefined
  const top = [...tops][0]!
  return entries.every(entry => entry.name === top || entry.name.startsWith(`${top}/`)) ? top : undefined
}

/** 找包内 SKILL.md 条目(顶层或剥掉顶层目录后的顶层)。 */
function findSkillMd(entries: ZipEntry[]): ZipEntry | undefined {
  const top = commonTopDir(entries)
  const prefix = top === undefined ? '' : `${top}/`
  return entries.find(entry => entry.name === `${prefix}SKILL.md`)
}

/** 把 .skill 包解到目标目录(整树保留资源)。 */
async function extractZip(entries: ZipEntry[], destDir: string): Promise<void> {
  if (findSkillMd(entries) === undefined) throw new Error('.skill 包内没有 SKILL.md')
  const top = commonTopDir(entries)
  const prefix = top === undefined ? '' : `${top}/`
  for (const entry of entries) {
    const stripped = prefix === '' ? entry.name : entry.name.slice(prefix.length)
    if (stripped === '') continue
    const safe = safeEntryName(stripped)
    if (safe === undefined) throw new Error(`包内路径不安全:${entry.name}`)
    await mkdir(path.dirname(path.join(destDir, safe)), { recursive: true })
    await writeFile(path.join(destDir, safe), entry.data)
  }
}

/** 多行 frontmatter 值的尽力而为读取(`description: |` 块取首个非空行)。 */
function scalarMultiline(lines: string[], key: string): string | undefined {
  const single = scalar(lines, key)
  if (single !== undefined && single !== '' && single !== '|' && single !== '>' && !single.startsWith('|-') && !single.startsWith('>-')) {
    return single
  }
  const index = lines.findIndex(line => /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)?.[1] === key)
  if (index < 0) return undefined
  for (const line of lines.slice(index + 1)) {
    if (/^\S/.test(line)) break
    const trimmed = line.trim()
    if (trimmed === '') continue
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed
  }
  return undefined
}

/** dsh 主目录:$DSH_HOME 覆盖,默认 ~/.dsh(与 skill-filesystem provider 一致)。 */
function dshHome(): string {
  const env = process.env['DSH_HOME']
  return env !== undefined && env.trim() !== '' ? env : path.join(os.homedir(), '.dsh')
}

/** 把绝对路径的 home 前缀替换为 ~(仅展示/存储用)。 */
function tildeDisplay(p: string): string {
  const home = os.homedir()
  if (p === home) return '~'
  if (p.startsWith(home + path.sep)) return `~${p.slice(home.length)}`
  return p
}

/** 常见技能目录候选(存在才会作为建议给出)。 */
const KNOWN_SKILL_DIRS = ['~/.claude/skills', '~/.agents/skills', '~/.codex/skills', '~/.cursor/skills']

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** 极简 frontmatter 拆分:只认首行 `---` 到下一行 `---` 的块。 */
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
    if (match !== null && match[1] === key) return unquoteYaml(match[2]!.trim())
  }
  return undefined
}

/** 剥除 YAML 标量的成对引号并反转义(双引号 \\" 与单引号 '' 两种方言)。 */
function unquoteYaml(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

/** kebab-case 名称;无法得出时回退 'skill'。保证匹配 NAME_PATTERN。 */
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
  return '(无描述)'
}

interface ParsedSkill {
  name: string
  description: string
  content: string
}

/**
 * 清洗管线(粘贴/平铺 .md 复制入库时用):解析任意 Markdown/SKILL.md 文本,
 * 产出规范命名的 SKILL.md 全文。保留 name/description 之外的全部
 * frontmatter 原行。引用与编辑保存不经过此管线(字节原样)。
 */
function parseSkillText(text: string, fallbackName: string, fallbackDesc: string): ParsedSkill {
  const { raw, body } = splitFrontmatter(text.replace(/^﻿/, ''))
  const fmName = scalar(raw, 'name')
  const fmDescription = scalar(raw, 'description')
  const name = normalizeName(fmName !== undefined && fmName !== '' ? fmName : fallbackName)
  const description = fmDescription !== undefined && fmDescription !== ''
    ? fmDescription
    : (fallbackDesc !== '' ? fallbackDesc : fallbackDescription(body))
  const kept = raw.filter(line => {
    const match = /^([A-Za-z0-9_-]+):/.exec(line)
    return match === null || (match[1] !== 'name' && match[1] !== 'description')
  })
  const fmOut = [`name: ${name}`, `description: ${description}`, ...kept]
  return { name, description, content: `---\n${fmOut.join('\n')}\n---\n\n${body.trim()}\n` }
}

/** frontmatter 行 → invocation 标签。 */
function invocationOf(raw: string[]): string {
  if (scalar(raw, 'disable-model-invocation') === 'true') return 'user'
  return scalar(raw, 'user-invocable') === 'false' ? 'model' : 'both'
}

/** 弱(src-json)调用描述符。 */
interface WeakInvocation {
  readonly id: string
  readonly service: 'skillHub'
  readonly namespace: 'skillHub'
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: ReadonlyArray<{
    readonly name: string
    readonly wire: string
    readonly source: 'json'
    readonly codec: { readonly mode: 'src-json' }
  }>
  readonly result: { readonly mode: 'src-json' }
}

/** ctx.typert 注册面(宿主 dsh-typert-registry 提供;本包不依赖其类型)。 */
interface TypertRegistryLike {
  register(contribution: unknown): unknown
}

const TYPERT_MANIFEST = {
  package: 'dsh-skills',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [
    {
      id: 'dsh-skills#skillHub/getState',
      service: 'skillHub',
      namespace: 'skillHub',
      method: 'getState',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    },
    {
      id: 'dsh-skills#skillHub/browseDirs',
      service: 'skillHub',
      namespace: 'skillHub',
      method: 'browseDirs',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'dirPath', wire: 'dirPath', source: 'json', codec: { mode: 'src-json' } }],
      result: { mode: 'src-json' },
    },
    {
      id: 'dsh-skills#skillHub/runCommand',
      service: 'skillHub',
      namespace: 'skillHub',
      method: 'runCommand',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'command', wire: 'command', source: 'json', codec: { mode: 'src-json' } }],
      result: { mode: 'src-json' },
    },
  ] satisfies WeakInvocation[],
} as const

/**
 * skillHub 网关服务:全局技能库的状态/入库(引用|复制)/编辑/导出/删除。
 * @param ctx - 宿主 Cordis 上下文。
 */
export class SkillHubGateway extends TypertRemoteService {
  private readonly skillsDir = path.join(dshHome(), 'skills')
  private readonly trashDir = path.join(dshHome(), 'skill-trash')
  private readonly statePath = path.join(dshHome(), 'skills', '.skill-manager.json')

  /** 注册 'skillHub' 服务键;typert registry 就绪后补登记弱清单。 */
  constructor(ctx: Context) {
    super(ctx, 'skillHub')
    ctx.inject(['typert'], (typertCtx: Context) =>
      (typertCtx as unknown as { typert: TypertRegistryLike }).typert.register(TYPERT_MANIFEST))
  }

  /** 全量状态(设置页首屏与每次命令后的刷新)。 */
  async getState(): Promise<HubState> {
    return await this.buildState('')
  }

  /** 执行一条面板命令,返回结果码/消息 + 刷新后的全量状态。 */
  async runCommand(command: HubCommand): Promise<HubCommandResult> {
    const result = await this.execute(command)
    return {
      code: result.code,
      message: result.message,
      state: await this.buildState(result.message),
      ...result.params === undefined ? {} : { params: result.params },
      ...result.level === undefined ? {} : { level: result.level },
      ...result.body === undefined ? {} : { body: result.body },
      ...result.archiveBase64 === undefined ? {} : { archiveBase64: result.archiveBase64 },
    }
  }

  /**
   * 目录浏览器:列出一个目录的子目录与技能计数,供「选择扫描目录」使用。
   * dirPath 传 '' 表示 home,并附带常见技能位置建议。
   * @param dirPath - 要浏览的目录(支持 ~ 前缀;'' = home)。
   */
  async browseDirs(dirPath: string): Promise<BrowseResult> {
    const isRoot = typeof dirPath !== 'string' || dirPath.trim() === ''
    const target = path.resolve(expandHome(isRoot ? '~' : dirPath.trim()))
    let entries
    try {
      entries = await readdir(target, { withFileTypes: true })
    } catch {
      throw new Error(`无法读取目录:${tildeDisplay(target)}`)
    }
    const dirNames = entries.filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name).slice(0, 400)
    const dirs: BrowseEntry[] = []
    let probes = 0
    for (const name of dirNames) {
      let skillCount = 0
      if (probes < 60) {
        probes += 1
        skillCount = await this.countSkillShaped(path.join(target, name))
      }
      dirs.push({ name, skillCount })
    }
    dirs.sort((a, b) => b.skillCount - a.skillCount || a.name.localeCompare(b.name))
    const parent = path.dirname(target)
    const result: BrowseResult = {
      path: target,
      display: tildeDisplay(target),
      ...parent === target ? {} : { parent },
      dirs,
    }
    if (isRoot) {
      const configured = new Set(((await this.readState()).sources ?? DEFAULT_SOURCES).map(source => path.resolve(expandHome(source))))
      const suggestions: { path: string, skillCount: number }[] = []
      for (const candidate of KNOWN_SKILL_DIRS) {
        const absolute = path.resolve(expandHome(candidate))
        if (configured.has(absolute)) continue
        try {
          const info = await stat(absolute)
          if (!info.isDirectory()) continue
        } catch {
          continue
        }
        suggestions.push({ path: candidate, skillCount: await this.countSkillShaped(absolute) })
      }
      if (suggestions.length > 0) result.suggestions = suggestions
    }
    return result
  }

  /** 限量探测一个目录里的技能形态条目数(SKILL.md 目录 / 平铺 .md / .skill)。 */
  private async countSkillShaped(dir: string): Promise<number> {
    let names: string[]
    try {
      names = (await readdir(dir)).slice(0, 150)
    } catch {
      return 0
    }
    let count = 0
    for (const name of names) {
      if (name.startsWith('.')) continue
      if (name.endsWith('.md') || name.endsWith('.skill')) { count += 1; continue }
      try {
        await stat(path.join(dir, name, 'SKILL.md'))
        count += 1
      } catch { /* 非技能目录 */ }
    }
    return count
  }

  private async readState(): Promise<StateFile> {
    try {
      return JSON.parse(await readFile(this.statePath, 'utf8')) as StateFile
    } catch {
      return {}
    }
  }

  private async writeState(state: StateFile): Promise<void> {
    await mkdir(this.skillsDir, { recursive: true })
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  /** 数一棵技能树里 SKILL.md 之外的文件数(限量,防大目录)。 */
  private async countResources(dir: string): Promise<number> {
    let count = 0
    const walk = async (current: string, depth: number): Promise<void> => {
      if (depth > 6 || count > 500) return
      let entries
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name === '.DS_Store') continue
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) await walk(full, depth + 1)
        else if (entry.isFile() && !(current === dir && (entry.name === 'SKILL.md' || entry.name === 'skill.md'))) count += 1
      }
    }
    await walk(dir, 0)
    return count
  }

  /** 扫描全局库:目录/平铺/符号链接条目 → HubSkill(含身份与失效标注)。 */
  private async scanHub(): Promise<HubSkill[]> {
    const state = await this.readState()
    const out: HubSkill[] = []
    let entries: string[]
    try {
      entries = await readdir(this.skillsDir)
    } catch {
      return out
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const full = path.join(this.skillsDir, entry)
      let linkInfo
      try {
        linkInfo = await lstat(full)
      } catch {
        continue
      }
      const isLink = linkInfo.isSymbolicLink()
      let sourcePath = ''
      if (isLink) {
        try {
          sourcePath = path.resolve(this.skillsDir, await readlink(full))
        } catch { /* 读不出目标:按失效处理 */ }
      }
      let info
      try {
        info = await stat(full) // 跟随链接
      } catch {
        // 失效引用:目标消失。仍然展示,供用户处理。
        const meta = state.skills?.[entry.replace(/\.md$/u, '')]
        out.push({
          name: entry.replace(/\.md$/u, ''),
          description: '',
          whenToUse: '',
          invocation: 'both',
          addedAt: meta?.addedAt ?? '',
          mode: 'link',
          sourcePath: meta?.source ?? sourcePath,
          broken: true,
          resourceCount: 0,
          file: full,
          dir: this.skillsDir,
        })
        continue
      }
      let file: string | undefined
      let fallbackName = entry
      let dir = this.skillsDir
      if (info.isDirectory()) {
        dir = full
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
      const meta = state.skills?.[entry.replace(/\.md$/u, '')] ?? state.skills?.[name]
      const mode: SkillMode = isLink ? 'link' : (meta?.mode ?? (meta?.source !== undefined && meta.source !== '' && meta.source !== 'paste' && meta.source !== 'edit' && meta.source !== 'upload' ? 'copy' : 'local'))
      out.push({
        name,
        description: scalarMultiline(raw, 'description') ?? fallbackDescription(body),
        whenToUse: scalar(raw, 'whenToUse') ?? '',
        invocation: invocationOf(raw),
        addedAt: meta?.addedAt ?? '',
        mode,
        sourcePath: isLink ? sourcePath : (mode === 'copy' ? meta?.source ?? '' : ''),
        broken: false,
        resourceCount: info.isDirectory() ? await this.countResources(full) : 0,
        file,
        dir,
      })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  /** 扫描来源目录:尚未入库的技能(目录式/平铺 .md/.skill 包)+ 每目录状态。 */
  private async scanDiscoverable(sources: string[], hub: HubSkill[]): Promise<{ discoverable: DiscoverableSkill[], sourceInfos: SourceInfo[] }> {
    const hubNames = new Set(hub.map(s => s.name))
    const hubSources = new Set(hub.map(s => s.sourcePath).filter(s => s !== ''))
    const out = new Map<string, DiscoverableSkill>()
    const sourceInfos: SourceInfo[] = []
    for (const source of sources) {
      const dir = expandHome(source)
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        sourceInfos.push({ path: source, exists: false, skillCount: 0 })
        continue
      }
      let skillCount = 0
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const full = path.join(dir, entry)
        // 已以引用/副本身份入库:不再列入可发现,但计入目录技能数。
        if (hubSources.has(full)) { skillCount += 1; continue }
        let info
        try {
          info = await stat(full)
        } catch {
          continue
        }
        if (info.isFile() && entry.endsWith('.skill')) {
          skillCount += 1
          let name = normalizeName(entry.replace(/\.skill$/iu, ''))
          let description = '(打包技能)'
          try {
            const zipEntries = readZip(await readFile(full))
            const skillMd = findSkillMd(zipEntries)
            if (skillMd !== undefined) {
              const { raw, body } = splitFrontmatter(skillMd.data.toString('utf8'))
              name = normalizeName(scalar(raw, 'name') ?? name)
              description = scalarMultiline(raw, 'description') ?? fallbackDescription(body)
            }
          } catch { /* 损坏的包按文件名展示,导入时报错 */ }
          if (!hubNames.has(name) && !out.has(name)) {
            out.set(name, { name, description, sourcePath: full, kind: 'archive' })
          }
          continue
        }
        let file: string | undefined
        let kind: DiscoverableSkill['kind'] = 'md'
        let fallbackName = entry
        if (info.isDirectory()) {
          const probe = path.join(full, 'SKILL.md')
          try {
            await stat(probe)
            file = probe
            kind = 'dir'
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
        skillCount += 1
        let text: string
        try {
          text = await readFile(file, 'utf8')
        } catch {
          continue
        }
        const { raw, body } = splitFrontmatter(text)
        const name = normalizeName(scalar(raw, 'name') ?? fallbackName)
        if (hubNames.has(name) || out.has(name)) continue
        out.set(name, {
          name,
          description: scalarMultiline(raw, 'description') ?? fallbackDescription(body),
          sourcePath: kind === 'dir' ? full : file,
          kind,
        })
      }
      sourceInfos.push({ path: source, exists: true, skillCount })
    }
    return { discoverable: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)), sourceInfos }
  }

  /** 技能名在库里对应的现有路径(目录式或平铺式),不存在则 undefined。 */
  private async existingPath(name: string): Promise<string | undefined> {
    for (const candidate of [path.join(this.skillsDir, name, 'SKILL.md'), path.join(this.skillsDir, `${name}.md`)]) {
      try {
        await stat(candidate)
        return candidate
      } catch { /* try next */ }
    }
    return undefined
  }

  /** 名字对应的库条目(目录、平铺文件或符号链接本身),含失效链接。 */
  private async entryPath(name: string): Promise<string | undefined> {
    for (const candidate of [path.join(this.skillsDir, name), path.join(this.skillsDir, `${name}.md`)]) {
      try {
        await lstat(candidate)
        return candidate
      } catch { /* try next */ }
    }
    return undefined
  }

  /** 同名已存在时追加 -2/-3… 序号。 */
  private async uniqueName(base: string): Promise<string> {
    if (await this.entryPath(base) === undefined) return base
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`
      if (await this.entryPath(candidate) === undefined) return candidate
    }
    return `${base}-${Date.now()}`
  }

  /** sourcePath 必须位于某个配置来源目录内,拒绝任意路径读取。 */
  private async sourceAllowed(sourcePath: string): Promise<boolean> {
    const sources = (await this.readState()).sources ?? DEFAULT_SOURCES
    for (const source of sources) {
      const root = `${expandHome(source).replace(/\/+$/, '')}/`
      if (sourcePath.startsWith(root)) return true
    }
    return sourcePath.startsWith(`${this.skillsDir.replace(/\/+$/, '')}/`)
  }

  /** 把技能目录里 SKILL.md 的 frontmatter `name:` 同步为最终目录名(仅副本)。 */
  private async syncFrontmatterName(dir: string, name: string): Promise<void> {
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

  private async recordSkill(key: string, source: string, mode: SkillMode): Promise<void> {
    const state = await this.readState()
    state.skills = { ...state.skills, [key]: { addedAt: new Date().toISOString(), source, mode } }
    await this.writeState(state)
  }

  /** 安装 .skill 包(只能复制):整树解压到 skills/<name>/。 */
  private async installArchive(entries: ZipEntry[], fallbackName: string, source: string): Promise<ExecOutcome> {
    let name = fallbackName
    const skillMd = findSkillMd(entries)
    if (skillMd !== undefined) {
      const fmName = scalar(splitFrontmatter(skillMd.data.toString('utf8')).raw, 'name')
      if (fmName !== undefined && fmName !== '') name = normalizeName(fmName)
    }
    name = await this.uniqueName(name)
    try {
      await extractZip(entries, path.join(this.skillsDir, name))
    } catch (error) {
      this.ctx.logger.warn(error)
      return { code: 'err.archive.extract', level: 'error', message: `入库失败:${error instanceof Error ? error.message : String(error)}` }
    }
    await this.syncFrontmatterName(path.join(this.skillsDir, name), name)
    await this.recordSkill(name, source, 'copy')
    return { code: 'import.copied', params: { name }, message: `已复制入库「${name}」(含全部资源文件)` }
  }

  /** 递归收集技能目录为 zip 条目(`<name>/<相对路径>`)。 */
  private async collectTree(rootDir: string, prefix: string): Promise<ZipEntry[]> {
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

  /** 引用入库:skills/<name> 符号链接 → 来源目录/文件。 */
  private async importLink(sourcePath: string): Promise<ExecOutcome> {
    if (sourcePath === '' || !await this.sourceAllowed(sourcePath)) {
      return { code: 'err.link.source', level: 'error', message: '引用失败:来源路径不在配置的来源目录内' }
    }
    let info
    try {
      info = await stat(sourcePath)
    } catch {
      return { code: 'err.link.unreadable', level: 'error', message: '引用失败:无法读取来源' }
    }
    if (sourcePath.endsWith('.skill')) {
      return { code: 'err.link.archive', level: 'error', message: '打包技能(.skill)没有可引用的目录,请用「复制」入库' }
    }
    // 名字取 frontmatter(目录读 SKILL.md;平铺读文件本身)
    let name = normalizeName(path.basename(sourcePath).replace(/\.md$/iu, ''))
    try {
      const text = info.isDirectory()
        ? await readFile(path.join(sourcePath, 'SKILL.md'), 'utf8')
        : await readFile(sourcePath, 'utf8')
      name = normalizeName(scalar(splitFrontmatter(text).raw, 'name') ?? name)
    } catch { /* 读不到就用路径名 */ }
    const hub = await this.scanHub()
    const collides = hub.some(skill => skill.name === name)
    const linkKey = await this.uniqueName(name)
    const linkPath = info.isDirectory()
      ? path.join(this.skillsDir, linkKey)
      : path.join(this.skillsDir, `${linkKey}.md`)
    await mkdir(this.skillsDir, { recursive: true })
    try {
      const type = info.isDirectory() ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'
      await symlink(sourcePath, linkPath, type)
    } catch (error) {
      this.ctx.logger.warn(error)
      // Windows 无特权符号链接失败时退化为复制,如实告知。
      if (process.platform === 'win32' && info.isFile()) {
        await cp(sourcePath, linkPath, { dereference: true })
        await this.recordSkill(linkKey, sourcePath, 'copy')
        return { code: 'import.fallbackCopy', params: { name }, message: `此平台无法创建文件符号链接,「${name}」已改为复制入库` }
      }
      return { code: 'err.link.symlink', level: 'error', params: { message: error instanceof Error ? error.message : String(error) }, message: `引用失败:${error instanceof Error ? error.message : String(error)}` }
    }
    await this.recordSkill(linkKey, sourcePath, 'link')
    if (collides) {
      return { code: 'import.linked.dup', params: { name, path: sourcePath }, message: `已引用「${name}」→ ${sourcePath}(编辑即编辑来源;新会话立即可用,已打开的会话刷新页面后 / 菜单可见);注意:库里已有同名技能,同名时只有一个会生效` }
    }
    return { code: 'import.linked', params: { name, path: sourcePath }, message: `已引用「${name}」→ ${sourcePath}(编辑即编辑来源;新会话立即可用,已打开的会话刷新页面后 / 菜单可见)` }
  }

  /** 复制入库(目录整树 / .skill 解压 / 平铺 .md 清洗)。 */
  private async importCopy(sourcePath: string): Promise<ExecOutcome> {
    if (sourcePath === '' || !await this.sourceAllowed(sourcePath)) {
      return { code: 'err.copy.source', level: 'error', message: '复制失败:来源路径不在配置的来源目录内' }
    }
    let info
    try {
      info = await stat(sourcePath)
    } catch (error) {
      this.ctx.logger.warn(error)
      return { code: 'err.copy.unreadable', level: 'error', message: '复制失败:无法读取来源' }
    }
    if (info.isDirectory()) {
      let name = normalizeName(path.basename(sourcePath))
      try {
        const text = await readFile(path.join(sourcePath, 'SKILL.md'), 'utf8')
        name = normalizeName(scalar(splitFrontmatter(text).raw, 'name') ?? name)
      } catch { /* 无 frontmatter 时用目录名 */ }
      const finalName = await this.uniqueName(name)
      try {
        await cp(sourcePath, path.join(this.skillsDir, finalName), { recursive: true, dereference: true })
      } catch (error) {
        this.ctx.logger.warn(error)
        return { code: 'err.copy.dir', level: 'error', message: '复制失败:拷贝技能目录出错' }
      }
      await this.syncFrontmatterName(path.join(this.skillsDir, finalName), finalName)
      await this.recordSkill(finalName, sourcePath, 'copy')
      return { code: 'import.copied', params: { name: finalName }, message: `已复制入库「${finalName}」(含全部资源文件)` }
    }
    if (sourcePath.endsWith('.skill')) {
      let entries: ZipEntry[]
      try {
        entries = readZip(await readFile(sourcePath))
      } catch (error) {
        this.ctx.logger.warn(error)
        return { code: 'err.copy.archive', level: 'error', params: { message: error instanceof Error ? error.message : String(error) }, message: `复制失败:${error instanceof Error ? error.message : String(error)}` }
      }
      return await this.installArchive(entries, normalizeName(path.basename(sourcePath).replace(/\.skill$/iu, '')), sourcePath)
    }
    let text: string
    try {
      text = await readFile(sourcePath, 'utf8')
    } catch (error) {
      this.ctx.logger.warn(error)
      return { code: 'err.copy.readFile', level: 'error', message: '复制失败:无法读取来源文件' }
    }
    const parsed = parseSkillText(text, path.basename(sourcePath).replace(/\.md$/iu, ''), '')
    const name = await this.uniqueName(parsed.name)
    await mkdir(path.join(this.skillsDir, name), { recursive: true })
    await writeFile(path.join(this.skillsDir, name, 'SKILL.md'), parsed.content, 'utf8')
    await this.recordSkill(name, sourcePath, 'copy')
    return { code: 'import.copiedMd', params: { name }, message: `已复制入库「${name}」` }
  }

  private async execute(cmd: HubCommand): Promise<ExecOutcome> {
    switch (cmd.action) {
      case 'rescan':
        return { code: 'rescan.done', message: '已刷新技能列表' }
      case 'importLink':
        return await this.importLink(cmd.sourcePath ?? '')
      case 'importLinkBatch': {
        const sourcePaths = cmd.sourcePaths ?? []
        if (sourcePaths.length === 0) return { code: 'import.batch.empty', level: 'error', message: '批量引用:没有收到来源' }
        let linked = 0
        const failures: string[] = []
        for (const sourcePath of sourcePaths) {
          const result = await this.importLink(sourcePath)
          if (result.level === undefined) linked += 1
          else failures.push(result.message)
        }
        if (failures.length > 0) {
          return {
            code: 'import.batch.doneWithFail',
            level: 'error',
            params: { linked, total: sourcePaths.length, failCount: failures.length, firstFail: failures[0]! },
            message: `批量引用完成:${linked}/${sourcePaths.length} 个入库;${failures.length} 个失败(${failures[0]!})`,
          }
        }
        return { code: 'import.batch.done', params: { linked, total: sourcePaths.length }, message: `批量引用完成:${linked}/${sourcePaths.length} 个入库` }
      }
      case 'importCopy':
        return await this.importCopy(cmd.sourcePath ?? '')
      case 'importArchive': {
        const archiveBase64 = cmd.archiveBase64 ?? ''
        if (archiveBase64 === '') return { code: 'err.archive.empty', level: 'error', message: '入库失败:没有收到文件内容' }
        // 上传体积上限:64MB base64 字符 ≈ 48MB 二进制,超限直接拒绝(防 zip 炸弹窗口)。
        if (archiveBase64.length > ARCHIVE_BASE64_LIMIT) {
          return { code: 'err.archive.tooLarge', level: 'error', params: { limitMb: 48 }, message: '入库失败:文件超过 48MB 上限' }
        }
        let entries: ZipEntry[]
        try {
          entries = readZip(Buffer.from(archiveBase64, 'base64'))
        } catch (error) {
          this.ctx.logger.warn(error)
          return { code: 'err.archive.invalid', level: 'error', params: { message: error instanceof Error ? error.message : String(error) }, message: `入库失败:${error instanceof Error ? error.message : String(error)}` }
        }
        const fallbackName = normalizeName((cmd.name ?? '').replace(/\.skill$/iu, ''))
        return await this.installArchive(entries, fallbackName, 'upload')
      }
      case 'importPaste': {
        const content = cmd.content ?? ''
        if (content.trim() === '') return { code: 'err.paste.empty', level: 'error', message: '创建失败:内容为空' }
        const parsed = parseSkillText(content, cmd.name ?? '', cmd.description ?? '')
        const name = await this.uniqueName(parsed.name)
        await mkdir(path.join(this.skillsDir, name), { recursive: true })
        await writeFile(path.join(this.skillsDir, name, 'SKILL.md'), parsed.content, 'utf8')
        await this.recordSkill(name, 'paste', 'local')
        return { code: 'import.created', params: { name }, message: `已创建技能「${name}」` }
      }
      case 'read': {
        const name = cmd.name ?? ''
        if (!NAME_PATTERN.test(name)) return { code: 'err.read.invalid', level: 'error', message: '读取失败:技能名不合法' }
        const file = await this.existingPath(name)
        if (file === undefined) return { code: 'err.read.notFound', level: 'error', params: { name }, message: `读取失败:找不到技能「${name}」` }
        return { code: 'read.done', params: { name }, message: `已读取「${name}」`, body: { name, content: await readFile(file, 'utf8') } }
      }
      case 'save': {
        // 保存 = 字节原样写回 SKILL.md(引用技能写穿链接,直达来源)。
        // 不再经清洗管线:编辑器所见即落盘内容。
        const name = cmd.name ?? ''
        if (!NAME_PATTERN.test(name)) return { code: 'err.save.invalid', level: 'error', message: '保存失败:技能名不合法' }
        const file = await this.existingPath(name)
        if (file === undefined) return { code: 'err.save.notFound', level: 'error', params: { name }, message: `保存失败:找不到技能「${name}」` }
        await writeFile(file, cmd.content ?? '', 'utf8')
        return { code: 'save.done', params: { name }, message: `已保存「${name}」` }
      }
      case 'delete': {
        const name = cmd.name ?? ''
        if (!NAME_PATTERN.test(name)) return { code: 'err.delete.invalid', level: 'error', message: '删除失败:技能名不合法' }
        const entry = await this.entryPath(name)
        if (entry === undefined) return { code: 'err.delete.notFound', level: 'error', params: { name }, message: `删除失败:找不到技能「${name}」` }
        const linkInfo = await lstat(entry)
        const state = await this.readState()
        const key = path.basename(entry).replace(/\.md$/u, '')
        if (linkInfo.isSymbolicLink()) {
          // 引用:只删链接,绝不触碰来源。
          await unlink(entry)
          if (state.skills?.[key] !== undefined) {
            delete state.skills[key]
            await this.writeState(state)
          }
          return { code: 'delete.removedLink', params: { name }, message: `已移除引用「${name}」(来源文件未动)` }
        }
        await mkdir(this.trashDir, { recursive: true })
        await rename(entry, path.join(this.trashDir, `${Date.now()}-${name}`))
        if (state.skills?.[key] !== undefined) {
          delete state.skills[key]
          await this.writeState(state)
        }
        return { code: 'delete.done', params: { name }, message: `已删除「${name}」(可在 skill-trash 目录找回)` }
      }
      case 'export': {
        const name = cmd.name ?? ''
        if (!NAME_PATTERN.test(name)) return { code: 'err.export.invalid', level: 'error', message: '导出失败:技能名不合法' }
        const file = await this.existingPath(name)
        if (file === undefined) return { code: 'err.export.notFound', level: 'error', params: { name }, message: `导出失败:找不到技能「${name}」` }
        try {
          const dir = path.dirname(file)
          const isBundle = path.basename(dir) !== path.basename(this.skillsDir)
          const entries = isBundle
            ? await this.collectTree(dir, name)
            : [{ name: `${name}/SKILL.md`, data: await readFile(file) }]
          if (!entries.some(entry => entry.name === `${name}/SKILL.md` || entry.name === `${name}/skill.md`)) {
            return { code: 'err.export.noSkillMd', level: 'error', params: { name }, message: `导出失败:「${name}」缺少 SKILL.md` }
          }
          return { code: 'export.done', params: { name }, message: `已导出「${name}」为 .skill 包`, archiveBase64: writeZip(entries).toString('base64') }
        } catch (error) {
          this.ctx.logger.warn(error)
          return { code: 'err.export.failed', level: 'error', message: '导出失败:打包出错' }
        }
      }
      case 'setSources': {
        const sources = cmd.sources ?? []
        if (sources.some(s => typeof s !== 'string' || s.trim() === '')) {
          return { code: 'err.sources.invalid', level: 'error', message: '保存失败:来源目录列表不合法' }
        }
        const state = await this.readState()
        state.sources = sources
        await this.writeState(state)
        return { code: 'sources.saved', message: '已保存来源配置' }
      }
      default:
        return { code: 'err.unknown', level: 'error', message: '未知命令' }
    }
  }

  private async buildState(message: string): Promise<HubState> {
    const skills = await this.scanHub()
    const sourcePaths = (await this.readState()).sources ?? DEFAULT_SOURCES
    const { discoverable, sourceInfos } = await this.scanDiscoverable(sourcePaths, skills)
    return { message, skills, discoverable, sources: sourceInfos }
  }
}

export default SkillHubGateway
