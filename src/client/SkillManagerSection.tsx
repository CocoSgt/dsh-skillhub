/**
 * 技能管理设置页：四个页签（已安装 / 可导入 / 粘贴导入 / 来源）。
 *
 * 全部数据操作经宿主 half 的环回 sidecar 完成（见 src/client/index.ts 头注）。
 * 组件由 settings.section 槽渲染；inject 面提供 openPath（打开技能目录）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

export interface SkillManagerSectionProps {
  /** 槽位 inject 面（apply 注册时提供，经 InjectFace 摊平为 prop）。 */
  openPath?: (path: string) => void
}

export interface SkillManagerSectionInjected {
  openPath: (path: string) => void
}

interface InstalledSkill {
  name: string
  description: string
  whenToUse: string
  invocation: string
  addedAt: string
  source: string
  file: string
}

interface ImportableSkill {
  name: string
  description: string
  sourcePath: string
}

interface StatusValue {
  message: string
  installed: InstalledSkill[]
  importable: ImportableSkill[]
}

interface StateResponse {
  ok: boolean
  status: StatusValue
  sources: string[]
}

interface CommandResponse {
  ok: boolean
  message?: string
  error?: string
  status: StatusValue
  body?: { name: string, content: string }
  /** export 命令返回：.skill 包（zip）全文的 base64。 */
  archiveBase64?: string
}

/** 与宿主 half 的 PORT_RANGE 保持一致。 */
const PORT_RANGE = Array.from({ length: 10 }, (_, i) => 3180 + i)

let cachedBase: string | undefined

/** 探测环回 sidecar：按宿主 half 相同的端口顺序请求 /ping。 */
async function findBase(): Promise<string> {
  if (cachedBase !== undefined) return cachedBase
  for (const port of PORT_RANGE) {
    const candidate = `http://127.0.0.1:${String(port)}`
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 800)
      const response = await fetch(`${candidate}/ping`, { signal: controller.signal })
      clearTimeout(timer)
      if (response.ok) {
        const payload = await response.json() as { plugin?: string }
        if (payload.plugin === 'dsh-skill-manager') {
          cachedBase = candidate
          return cachedBase
        }
      }
    } catch { /* 端口未开，继续探测 */ }
  }
  throw new Error('未找到 dsh-skill-manager 宿主服务（端口 3180–3189 均无响应）')
}

async function apiGet<T>(pathname: string): Promise<T> {
  const response = await fetch(`${await findBase()}${pathname}`)
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as T
}

async function apiPost<T>(pathname: string, payload: unknown): Promise<T> {
  const response = await fetch(`${await findBase()}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as T
}

function fmtDate(iso: string): string {
  if (iso === '') return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function invocationLabel(invocation: string): string {
  if (invocation === 'user') return '仅用户可调用'
  if (invocation === 'model') return '仅模型可调用'
  return '用户 + 模型可调用'
}

/** 面板内容样式（作用域限于本组件的类名前缀 dsh-skm-）。 */
const CSS = `
.dsh-skm-message { min-height: 18px; font-size: 12px; color: var(--dsw-alias-text-3, #999); margin-bottom: 8px; }
.dsh-skm-tabs { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.dsh-skm-tab {
  padding: 4px 10px; border-radius: 8px; border: 1px solid transparent; cursor: pointer;
  font-size: 12px; background: none; color: var(--dsw-alias-text-2, #bbb);
}
.dsh-skm-tab.active { border-color: var(--dsw-alias-text-accent, #4c9aff); color: var(--dsw-alias-text-1, #eee); }
.dsh-skm-row {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 0;
  border-top: 1px solid rgba(128,128,140,.18);
}
.dsh-skm-row:first-child { border-top: none; }
.dsh-skm-main { flex: 1; min-width: 0; }
.dsh-skm-name { font-weight: 600; font-size: 13px; }
.dsh-skm-name code { font-family: ui-monospace, monospace; font-size: 12px; color: var(--dsw-alias-text-accent, #4c9aff); }
.dsh-skm-desc { font-size: 12px; color: var(--dsw-alias-text-2, #bbb); word-break: break-word; }
.dsh-skm-meta { font-size: 11px; color: var(--dsw-alias-text-3, #888); margin-top: 2px; }
.dsh-skm-actions { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.dsh-skm-btn {
  padding: 3px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;
  border: 1px solid rgba(128,128,140,.35); background: none; color: var(--dsw-alias-text-2, #bbb);
}
.dsh-skm-btn:hover { color: var(--dsw-alias-text-1, #eee); border-color: var(--dsw-alias-text-accent, #4c9aff); }
.dsh-skm-btn.danger:hover { color: #ff7a7a; border-color: #ff7a7a; }
.dsh-skm-empty { padding: 18px 0; text-align: center; color: var(--dsw-alias-text-3, #888); font-size: 12px; }
.dsh-skm-editor { width: 100%; box-sizing: border-box; min-height: 200px; margin: 6px 0;
  padding: 8px; border-radius: 8px; font: 12px/1.5 ui-monospace, monospace;
  color: var(--dsw-alias-text-1, #eee); background: rgba(0,0,0,.25);
  border: 1px solid rgba(128,128,140,.35); resize: vertical; }
.dsh-skm-input {
  box-sizing: border-box; width: 100%; padding: 6px 8px; border-radius: 8px; font: 12px system-ui, sans-serif;
  color: var(--dsw-alias-text-1, #eee); background: rgba(0,0,0,.25);
  border: 1px solid rgba(128,128,140,.35); }
.dsh-skm-label { display: block; font-size: 12px; margin: 8px 0 4px; color: var(--dsw-alias-text-2, #bbb); }
.dsh-skm-block { width: 100%; }
`

type TabId = 'installed' | 'importable' | 'paste' | 'sources'

/** 技能管理设置页组件。 */
export function SkillManagerSection({ openPath }: SkillManagerSectionProps) {

  useEffect(() => {
    if (document.getElementById('dsh-skill-manager-style') === null) {
      const style = document.createElement('style')
      style.id = 'dsh-skill-manager-style'
      style.textContent = CSS
      document.head.append(style)
    }
  }, [])

  const [tab, setTab] = useState<TabId>('installed')
  const [status, setStatus] = useState<StatusValue | undefined>(undefined)
  const [message, setMessage] = useState('加载中…')
  const [editing, setEditing] = useState<{ name: string, content: string } | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const state = await apiGet<StateResponse>('/state')
    setStatus(state.status)
  }, [])

  useEffect(() => {
    void refresh()
      .then(() => setMessage(''))
      .catch((error: unknown) => {
        setMessage(`加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }, [refresh])

  const run = useCallback(async (command: Record<string, unknown>): Promise<CommandResponse> => {
    if (busy) throw new Error('上一个操作还在执行')
    setBusy(true)
    setMessage('执行中…')
    try {
      const response = await apiPost<CommandResponse>('/command', command)
      if (response.status !== undefined) setStatus(response.status)
      setMessage(response.message ?? response.error ?? '')
      return response
    } catch (error) {
      setMessage(`出错：${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      setBusy(false)
    }
  }, [busy])

  const startEdit = useCallback(async (skill: InstalledSkill): Promise<void> => {
    setMessage(`正在读取「${skill.name}」…`)
    try {
      const response = await run({ action: 'read', name: skill.name })
      if (response.body !== undefined && response.body.name === skill.name) {
        setEditing(response.body)
      } else {
        setMessage('读取失败：未收到内容')
      }
    } catch { /* run 已提示 */ }
  }, [run])

  const tabs = useMemo(() => ([
    { id: 'installed' as const, label: `已安装 (${status?.installed.length ?? 0})` },
    { id: 'importable' as const, label: `可导入 (${status?.importable.length ?? 0})` },
    { id: 'paste' as const, label: '粘贴 / 上传' },
    { id: 'sources' as const, label: '来源' },
  ]), [status])

  return (
    <div className="dsh-skm-section">
      <div className="dsh-skm-message">{message}</div>
      <div className="dsh-skm-tabs">
        {tabs.map(entry => (
          <button
            key={entry.id}
            type="button"
            className={`dsh-skm-tab ${tab === entry.id ? 'active' : ''}`}
            onClick={() => { setTab(entry.id); setEditing(undefined) }}
          >{entry.label}</button>
        ))}
      </div>
      {tab === 'installed' && (
        <InstalledTab status={status} editing={editing} setEditing={setEditing} run={run} startEdit={startEdit} openPath={openPath} />
      )}
      {tab === 'importable' && <ImportableTab status={status} run={run} />}
      {tab === 'paste' && <PasteTab run={run} />}
      {tab === 'sources' && <SourcesTab run={run} refresh={refresh} />}
    </div>
  )
}

interface TabCommon {
  run: (command: Record<string, unknown>) => Promise<CommandResponse>
}

/** base64 → Blob 下载 .skill 包。 */
function downloadArchive(name: string, archiveBase64: string): void {
  const bytes = Uint8Array.from(atob(archiveBase64), char => char.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name}.skill`
  anchor.click()
  URL.revokeObjectURL(url)
}

function InstalledTab({ status, editing, setEditing, run, startEdit, openPath }: {
  status: StatusValue | undefined
  editing: { name: string, content: string } | undefined
  setEditing: (value: { name: string, content: string } | undefined) => void
  run: TabCommon['run']
  startEdit: (skill: InstalledSkill) => Promise<void>
  openPath: ((path: string) => void) | undefined
}) {
  const list = status?.installed ?? []
  const [draft, setDraft] = useState('')
  useEffect(() => { setDraft(editing?.content ?? '') }, [editing])
  if (list.length === 0) {
    return <div className="dsh-skm-empty">还没有已安装的技能。去「可导入」或「粘贴导入」添加一个吧。</div>
  }
  return <div>
    {list.map(skill => {
      if (editing !== undefined && editing.name === skill.name) {
        return <div key={skill.name} className="dsh-skm-row">
          <div className="dsh-skm-main">
            <div className="dsh-skm-name">编辑：{skill.name}</div>
            <textarea className="dsh-skm-editor" value={draft} onChange={event => setDraft(event.target.value)} />
            <div className="dsh-skm-actions">
              <button type="button" className="dsh-skm-btn" onClick={() => {
                const content = draft
                setEditing(undefined)
                void run({ action: 'save', name: skill.name, content }).catch(() => undefined)
              }}>保存</button>
              <button type="button" className="dsh-skm-btn" onClick={() => setEditing(undefined)}>取消</button>
            </div>
          </div>
        </div>
      }
      const metaBits = [
        invocationLabel(skill.invocation),
        skill.addedAt !== '' ? `添加于 ${fmtDate(skill.addedAt)}` : '',
        skill.source !== '' ? `来源：${skill.source}` : '',
      ].filter(s => s !== '')
      return <div key={skill.name} className="dsh-skm-row">
        <div className="dsh-skm-main">
          <div className="dsh-skm-name"><code>/{skill.name}</code></div>
          <div className="dsh-skm-desc">{skill.description}</div>
          {metaBits.length > 0 && <div className="dsh-skm-meta">{metaBits.join(' · ')}</div>}
        </div>
        <div className="dsh-skm-actions">
          <button type="button" className="dsh-skm-btn" onClick={() => void startEdit(skill)}>编辑</button>
          <button type="button" className="dsh-skm-btn" onClick={() => {
            void run({ action: 'export', name: skill.name })
              .then(response => {
                if (response.archiveBase64 !== undefined) downloadArchive(skill.name, response.archiveBase64)
              })
              .catch(() => undefined)
          }}>导出 .skill</button>
          <button type="button" className="dsh-skm-btn" onClick={() => {
            void navigator.clipboard?.writeText(`/${skill.name}`).catch(() => undefined)
          }}>复制 /{skill.name}</button>
          <button type="button" className="dsh-skm-btn" onClick={() => {
            const dir = skill.file.split('/').slice(0, -1).join('/')
            openPath?.(dir)
          }}>打开目录</button>
          <button type="button" className="dsh-skm-btn danger" onClick={() => {
            if (window.confirm(`确定删除技能「${skill.name}」吗？（会移到 skill-trash 回收站）`)) {
              void run({ action: 'delete', name: skill.name }).catch(() => undefined)
            }
          }}>删除</button>
        </div>
      </div>
    })}
  </div>
}

function ImportableTab({ status, run }: TabCommon & { status: StatusValue | undefined }) {
  const list = status?.importable ?? []
  if (list.length === 0) {
    return <div className="dsh-skm-empty">来源目录中没有可导入的新技能。可在「来源」页检查目录配置。</div>
  }
  return <div>
    {list.map(skill => (
      <div key={skill.sourcePath} className="dsh-skm-row">
        <div className="dsh-skm-main">
          <div className="dsh-skm-name"><code>/{skill.name}</code></div>
          <div className="dsh-skm-desc">{skill.description}</div>
          <div className="dsh-skm-meta">{skill.sourcePath}</div>
        </div>
        <div className="dsh-skm-actions">
          <button type="button" className="dsh-skm-btn" onClick={() => {
            void run({ action: 'import', sourcePath: skill.sourcePath }).catch(() => undefined)
          }}>导入</button>
        </div>
      </div>
    ))}
  </div>
}

function PasteTab({ run }: TabCommon) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [uploadName, setUploadName] = useState('')
  const [uploadBase64, setUploadBase64] = useState('')

  /** 读 .skill 文件为 base64，暂存待导入（名称取包内 frontmatter，文件名只是兜底）。 */
  const onPickArchive = (file: File | undefined): void => {
    if (file === undefined) return
    setUploadName(file.name)
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setUploadBase64(result.includes(',') ? result.split(',').slice(1).join(',') : '')
    })
    reader.readAsDataURL(file)
  }

  return <div>
    <label className="dsh-skm-label" htmlFor="dsh-skm-paste-archive">上传 .skill 包（Claude 网页版导出格式，含资源文件整包导入）</label>
    <input id="dsh-skm-paste-archive" className="dsh-skm-input" type="file" accept=".skill,.zip"
      onChange={event => onPickArchive(event.target.files?.[0])} />
    {uploadBase64 !== '' && <div className="dsh-skm-actions">
      <button type="button" className="dsh-skm-btn" onClick={() => {
        void run({ action: 'importArchive', name: uploadName, archiveBase64: uploadBase64 })
          .then(() => { setUploadBase64(''); setUploadName('') })
          .catch(() => undefined)
      }}>导入 {uploadName}</button>
      <button type="button" className="dsh-skm-btn" onClick={() => { setUploadBase64(''); setUploadName('') }}>取消</button>
    </div>}
    <label className="dsh-skm-label" htmlFor="dsh-skm-paste-name">技能名称</label>
    <input id="dsh-skm-paste-name" className="dsh-skm-input" placeholder="my-skill（可留空，从内容推断）"
      value={name} onChange={event => setName(event.target.value)} />
    <label className="dsh-skm-label" htmlFor="dsh-skm-paste-desc">描述</label>
    <input id="dsh-skm-paste-desc" className="dsh-skm-input" placeholder="一句话描述（可留空，取正文首行）"
      value={description} onChange={event => setDescription(event.target.value)} />
    <label className="dsh-skm-label" htmlFor="dsh-skm-paste-body">内容</label>
    <textarea id="dsh-skm-paste-body" className="dsh-skm-editor dsh-skm-block"
      placeholder="技能正文（Markdown）。也可以直接粘贴带 --- frontmatter 的完整 SKILL.md。"
      value={content} onChange={event => setContent(event.target.value)} />
    <div className="dsh-skm-actions">
      <button type="button" className="dsh-skm-btn" onClick={() => {
        void run({ action: 'importPaste', name, description, content }).catch(() => undefined)
      }}>导入</button>
    </div>
  </div>
}

function SourcesTab({ run, refresh }: TabCommon & { refresh: () => Promise<void> }) {
  const [sourcesText, setSourcesText] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (loaded) return
    void apiGet<StateResponse>('/state')
      .then(state => { setSourcesText(state.sources.join('\n')); setLoaded(true) })
      .catch(() => { setSourcesText(''); setLoaded(true) })
  }, [loaded])
  if (sourcesText === undefined) return <div className="dsh-skm-empty">读取来源配置中…</div>
  return <div>
    <label className="dsh-skm-label" htmlFor="dsh-skm-sources">来源目录（每行一个，支持 ~）</label>
    <textarea id="dsh-skm-sources" className="dsh-skm-editor dsh-skm-block" style={{ minHeight: '120px' }}
      value={sourcesText} onChange={event => setSourcesText(event.target.value)} />
    <div className="dsh-skm-actions">
      <button type="button" className="dsh-skm-btn" onClick={() => {
        const sources = sourcesText.split('\n').map(s => s.trim()).filter(s => s !== '')
        void run({ action: 'setSources', sources })
          .then(() => refresh())
          .catch(() => undefined)
      }}>保存并刷新</button>
    </div>
  </div>
}
