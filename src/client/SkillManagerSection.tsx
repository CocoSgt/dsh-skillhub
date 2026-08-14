/**
 * 技能管理设置页：四个页签（已安装 / 可导入 / 粘贴导入 / 来源）。
 *
 * 全部数据操作经宿主 half 的环回 sidecar 完成（见 src/client/index.ts 头注）。
 * 组件由 settings.section 槽渲染；inject 面提供 openPath（打开技能目录）。
 *
 * 样式完全复用官方设置页体系：Button 原子组件
 * （@deepseek-ai/dsh-client-ui-primitives）+ 全局 --dsw-alias-* 设计令牌 +
 * 官方尺寸词汇（section 760 / 卡片 r12 / 输入 h32 r8 / 密集动作胶囊
 * h28 r14），结构与类名形态对齐 Models / Plugins 设置页，不引入自配色。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, IconSkillOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

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

/** 状态行语气：失败类文案挂 error 红，成功/中性走 tertiary。 */
function statusTone(message: string): 'idle' | 'error' {
  return /^(出错|加载失败|读取失败|保存失败|删除失败|导入失败|导出失败)/u.test(message) ? 'error' : 'idle'
}

/**
 * 官方设置页样式词汇（来源：ui-settings-plugins / ui-settings-models 的
 * module.css，令牌全部走 --dsw-alias-*，深浅色由宿主主题切换自动适配）。
 */
const CSS = `
.dsh-skm-section { display: flex; flex-direction: column; gap: 12px; width: 100%;
  min-width: 0; box-sizing: border-box; max-width: 760px;
  color: var(--dsw-alias-label-primary); }
.dsh-skm-heading { display: flex; align-items: center; gap: 8px; margin: 0;
  font-size: 18px; font-weight: 600; }
.dsh-skm-heading svg { flex: none; color: var(--dsw-alias-label-secondary); }
.dsh-skm-intro { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.dsh-skm-status { margin: 0; min-height: 18px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); }
.dsh-skm-status[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.dsh-skm-tabs { display: flex; align-items: flex-end; gap: 22px; flex-wrap: wrap;
  border-bottom: 1px solid var(--dsw-alias-border-l2); margin-top: 2px; }
.dsh-skm-tab { position: relative; border: 0; padding: 7px 1px 9px; background: transparent;
  color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; line-height: 20px;
  cursor: pointer; }
.dsh-skm-tab:hover, .dsh-skm-tab[data-active='true'] { color: var(--dsw-alias-label-primary); }
.dsh-skm-tab[data-active='true']::after { position: absolute; right: 0; bottom: -1px; left: 0;
  height: 2px; border-radius: 2px 2px 0 0; background: var(--dsw-alias-label-primary); content: ''; }
.dsh-skm-tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px; border-radius: 2px; color: var(--dsw-alias-label-primary); }
.dsh-skm-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0;
  padding-top: 2px; }
.dsh-skm-blockTitle { display: flex; align-items: center; gap: 8px; font-size: 14px;
  line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsh-skm-link { border: 0; padding: 0 0 0 4px; background: transparent;
  color: var(--dsw-alias-brand-primary); font: inherit; font-size: 13px;
  cursor: pointer; }
.dsh-skm-link:hover { text-decoration: underline; }
.dsh-skm-addRow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-skm-addRow .dsh-skm-input { flex: 1; min-width: 0; }
.dsh-skm-cards { list-style: none; margin: 0; padding: 0; display: flex;
  flex-direction: column; gap: 10px; }
.dsh-skm-rowCard { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dsh-skm-rowHead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-skm-rowIdentity { display: inline-flex; align-items: center; gap: 6px;
  min-width: 0; max-width: 100%; }
.dsh-skm-rowName { font-size: 14px; line-height: 22px; font-weight: 500;
  color: var(--dsw-alias-label-primary); min-width: 0; overflow-wrap: anywhere; }
.dsh-skm-rowName code { font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 13px; overflow-wrap: anywhere; }
.dsh-skm-rowTag { flex: none; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 4px; font-size: 11px; line-height: 16px;
  color: var(--dsw-alias-label-secondary); }
.dsh-skm-rowActions { display: inline-flex; align-items: center; gap: 4px;
  flex-wrap: wrap; margin-left: auto; }
.dsh-skm-danger { color: var(--dsw-alias-state-error-primary); }
.dsh-skm-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
.dsh-skm-desc { margin: 0; font-size: 13px; line-height: 20px; min-width: 0;
  overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
.dsh-skm-md { display: flex; flex-direction: column; }
.dsh-skm-md > :first-child { margin-top: 0; }
.dsh-skm-md > :last-child { margin-bottom: 0; }
.dsh-skm-md :where(h1, h2, h3, h4, h5, h6) { margin: 8px 0 4px; font-size: 13.5px;
  line-height: 20px; font-weight: 600; }
.dsh-skm-md :where(p, ul, ol) { margin: 0 0 6px; font-size: 13px; line-height: 20px; }
.dsh-skm-md :where(ul, ol) { padding-left: 20px; }
.dsh-skm-md :where(pre) { margin: 0 0 6px; font-size: 12px; max-width: 100%;
  overflow-x: auto; }
.dsh-skm-md :where(code) { font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 12px; overflow-wrap: anywhere; }
.dsh-skm-md :where(a) { overflow-wrap: anywhere; }
.dsh-skm-meta { margin: 0; font-size: 12px; line-height: 18px; overflow-wrap: anywhere;
  color: var(--dsw-alias-label-tertiary); }
.dsh-skm-empty { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.dsh-skm-editor { border-radius: 12px; min-width: 0; box-sizing: border-box;
  background: var(--dsw-alias-bg-module-platform);
  padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.dsh-skm-editorHeader { display: flex; align-items: baseline; gap: 8px; }
.dsh-skm-editorTitle { font-size: 14px; line-height: 22px; font-weight: 500;
  color: var(--dsw-alias-label-primary); }
.dsh-skm-field { display: flex; flex-direction: column; gap: 6px; }
.dsh-skm-fieldLabel { display: inline-flex; align-items: center; gap: 10px; font-size: 12px;
  line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dsh-skm-input, .dsh-skm-textarea { box-sizing: border-box; width: 100%;
  padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  font: inherit; font-size: 14px; line-height: 22px; background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); }
.dsh-skm-input { height: 32px; padding: 0 10px; }
.dsh-skm-textarea { min-height: 200px; resize: vertical;
  font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12px;
  line-height: 1.6; }
.dsh-skm-input:focus, .dsh-skm-textarea:focus { outline: none;
  border-color: var(--dsw-alias-brand-primary); }
.dsh-skm-input::placeholder, .dsh-skm-textarea::placeholder {
  color: var(--dsw-alias-label-dimmed); }
.dsh-skm-file { font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsh-skm-file::file-selector-button { box-sizing: border-box; display: inline-flex;
  align-items: center; justify-content: center; height: 28px; padding: 0 10px;
  margin-right: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-primary); font: inherit;
  font-size: 12px; line-height: 18px; cursor: pointer; }
.dsh-skm-file::file-selector-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-skm-editorActions { display: flex; justify-content: flex-end; gap: 8px; }
`

type TabId = 'installed' | 'import' | 'sources'

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
    { id: 'import' as const, label: `导入 (${status?.importable.length ?? 0})` },
    { id: 'sources' as const, label: '来源' },
  ]), [status])

  return (
    <div className="dsh-skm-section">
      <h2 className="dsh-skm-heading">
        <IconSkillOutline16 size={16} />技能
      </h2>
      <p className="dsh-skm-intro">管理本地技能：已安装的技能出现在输入框的「/」斜杠菜单中。</p>
      <p className="dsh-skm-status" role="status" aria-live="polite" data-tone={statusTone(message)}>
        {message}
      </p>
      <div className="dsh-skm-tabs" role="tablist" aria-label="技能管理页签">
        {tabs.map(entry => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className="dsh-skm-tab"
            aria-selected={tab === entry.id}
            data-active={tab === entry.id ? 'true' : undefined}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => { setTab(entry.id); setEditing(undefined) }}
          >{entry.label}</button>
        ))}
      </div>
      <div className="dsh-skm-panel" role="tabpanel">
        {tab === 'installed' && (
          <InstalledTab status={status} editing={editing} setEditing={setEditing} run={run} startEdit={startEdit} openPath={openPath} />
        )}
        {tab === 'import' && <ImportTab status={status} run={run} openSources={() => { setTab('sources') }} />}
        {tab === 'sources' && <SourcesTab run={run} refresh={refresh} openImport={() => { setTab('import') }} />}
      </div>
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
    return <p className="dsh-skm-empty">还没有已安装的技能。去「可导入」或「粘贴导入」添加一个吧。</p>
  }
  return <ul className="dsh-skm-cards">
    {list.map(skill => {
      if (editing !== undefined && editing.name === skill.name) {
        return <li key={skill.name} className="dsh-skm-editor">
          <div className="dsh-skm-editorHeader">
            <span className="dsh-skm-editorTitle">编辑：{skill.name}</span>
          </div>
          <textarea className="dsh-skm-textarea" aria-label={`编辑 ${skill.name} 的内容`}
            value={draft} onChange={event => setDraft(event.target.value)} />
          <div className="dsh-skm-editorActions">
            <Button size="sm" variant="primary" onClick={() => {
              const content = draft
              setEditing(undefined)
              void run({ action: 'save', name: skill.name, content }).catch(() => undefined)
            }}>保存</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(undefined)}>取消</Button>
          </div>
        </li>
      }
      const metaBits = [
        skill.addedAt !== '' ? `添加于 ${fmtDate(skill.addedAt)}` : '',
        skill.source !== '' ? `来源：${skill.source}` : '',
      ].filter(s => s !== '')
      return <li key={skill.name} className="dsh-skm-rowCard">
        <div className="dsh-skm-rowHead">
          <span className="dsh-skm-rowIdentity">
            <span className="dsh-skm-rowName"><code>/{skill.name}</code></span>
            <span className="dsh-skm-rowTag">{invocationLabel(skill.invocation)}</span>
          </span>
          <span className="dsh-skm-rowActions">
            <Button size="sm" variant="outline" onClick={() => void startEdit(skill)}>编辑</Button>
            <Button size="sm" variant="outline" onClick={() => {
              void run({ action: 'export', name: skill.name })
                .then(response => {
                  if (response.archiveBase64 !== undefined) downloadArchive(skill.name, response.archiveBase64)
                })
                .catch(() => undefined)
            }}>导出 .skill</Button>
            <Button size="sm" variant="outline" onClick={() => {
              void navigator.clipboard?.writeText(`/${skill.name}`).catch(() => undefined)
            }}>复制 /{skill.name}</Button>
            {openPath !== undefined && <Button size="sm" variant="outline" onClick={() => {
              const dir = skill.file.split('/').slice(0, -1).join('/')
              openPath(dir)
            }}>打开目录</Button>}
            <Button size="sm" variant="ghost" className="dsh-skm-danger" onClick={() => {
              if (window.confirm(`确定删除技能「${skill.name}」吗？（会移到 skill-trash 回收站）`)) {
                void run({ action: 'delete', name: skill.name }).catch(() => undefined)
              }
            }}>删除</Button>
          </span>
        </div>
        {skill.description !== '' && (
          <div className="dsh-skm-desc dsh-skm-md"><MarkdownText text={skill.description} /></div>
        )}
        {metaBits.length > 0 && <p className="dsh-skm-meta">{metaBits.join(' · ')}</p>}
      </li>
    })}
  </ul>
}

/**
 * 导入页:三段式动线,每段一个自足的卡片——
 * ① 从来源目录导入(点「来源」页配置的目录里扫描到的技能)
 * ② 上传 .skill 包(Claude 网页版导出格式)
 * ③ 粘贴文本创建(名称/描述可留空,自动推断)
 */
function ImportTab({ status, run, openSources }: TabCommon & {
  status: StatusValue | undefined
  openSources: () => void
}) {
  const importable = status?.importable ?? []
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

  return <>
    <section className="dsh-skm-editor">
      <div className="dsh-skm-blockTitle">① 从来源目录导入</div>
      <p className="dsh-skm-intro">扫描「来源」页配置的目录,点击即导入;导入后出现在输入框的「/」菜单。</p>
      {importable.length === 0
        ? (
          <p className="dsh-skm-empty">
            来源目录里没有可导入的新技能。
            <button type="button" className="dsh-skm-link" onClick={openSources}>去配置来源目录 →</button>
          </p>
        )
        : <ul className="dsh-skm-cards">
          {importable.map(skill => (
            <li key={skill.sourcePath} className="dsh-skm-rowCard">
              <div className="dsh-skm-rowHead">
                <span className="dsh-skm-rowIdentity">
                  <span className="dsh-skm-rowName"><code>/{skill.name}</code></span>
                </span>
                <span className="dsh-skm-rowActions">
                  <Button size="sm" variant="primary" onClick={() => {
                    void run({ action: 'import', sourcePath: skill.sourcePath }).catch(() => undefined)
                  }}>导入</Button>
                </span>
              </div>
              {skill.description !== '' && (
                <div className="dsh-skm-desc dsh-skm-md"><MarkdownText text={skill.description} /></div>
              )}
              <p className="dsh-skm-meta">{skill.sourcePath}</p>
            </li>
          ))}
        </ul>}
    </section>
    <section className="dsh-skm-editor">
      <div className="dsh-skm-blockTitle">② 上传 .skill 包</div>
      <p className="dsh-skm-intro">Claude 网页版导出的 zip 包(内含 SKILL.md 与资源文件),整包导入。</p>
      <div className="dsh-skm-field">
        <input className="dsh-skm-file" type="file" accept=".skill,.zip" aria-label="选择 .skill 包"
          onChange={event => onPickArchive(event.target.files?.[0])} />
      </div>
      {uploadBase64 !== '' && <div className="dsh-skm-editorActions">
        <Button size="sm" variant="primary" onClick={() => {
          void run({ action: 'importArchive', name: uploadName, archiveBase64: uploadBase64 })
            .then(() => { setUploadBase64(''); setUploadName('') })
            .catch(() => undefined)
        }}>导入 {uploadName}</Button>
        <Button size="sm" variant="outline" onClick={() => { setUploadBase64(''); setUploadName('') }}>取消</Button>
      </div>}
    </section>
    <section className="dsh-skm-editor">
      <div className="dsh-skm-blockTitle">③ 粘贴文本创建</div>
      <p className="dsh-skm-intro">把技能内容直接写成文本;名称与描述可留空(自动从内容推断),也可以粘贴带 --- frontmatter 的完整 SKILL.md。</p>
      <div className="dsh-skm-field">
        <label className="dsh-skm-fieldLabel" htmlFor="dsh-skm-paste-name">名称(可留空)</label>
        <input id="dsh-skm-paste-name" className="dsh-skm-input" placeholder="my-skill"
          value={name} onChange={event => setName(event.target.value)} />
      </div>
      <div className="dsh-skm-field">
        <label className="dsh-skm-fieldLabel" htmlFor="dsh-skm-paste-desc">描述(可留空)</label>
        <input id="dsh-skm-paste-desc" className="dsh-skm-input" placeholder="这个技能什么时候用(留空取正文首行)"
          value={description} onChange={event => setDescription(event.target.value)} />
      </div>
      <div className="dsh-skm-field">
        <label className="dsh-skm-fieldLabel" htmlFor="dsh-skm-paste-body">技能正文(Markdown)</label>
        <textarea id="dsh-skm-paste-body" className="dsh-skm-textarea"
          placeholder={'技能正文。示例:\n\n1. 打开 xxx\n2. 检查 yyy'}
          value={content} onChange={event => setContent(event.target.value)} />
      </div>
      <div className="dsh-skm-editorActions">
        <Button variant="primary" disabled={content.trim() === ''} onClick={() => {
          void run({ action: 'importPaste', name, description, content }).catch(() => undefined)
        }}>创建技能</Button>
      </div>
    </section>
  </>
}

/** 来源页:列表式管理导入扫描目录——每行一个目录,即时增删,不再编辑整块文本。 */
function SourcesTab({ run, refresh, openImport }: TabCommon & {
  refresh: () => Promise<void>
  openImport: () => void
}) {
  const [sources, setSources] = useState<readonly string[] | undefined>(undefined)
  const [draft, setDraft] = useState('')
  useEffect(() => {
    void apiGet<StateResponse>('/state')
      .then(state => { setSources(state.sources) })
      .catch(() => { setSources([]) })
  }, [])
  if (sources === undefined) return <p className="dsh-skm-empty">读取来源配置中…</p>

  /** 立即保存新列表并刷新状态(每次增删都落盘,没有「暂存」概念)。 */
  const save = (next: readonly string[]): void => {
    setSources(next)
    void run({ action: 'setSources', sources: [...next] })
      .then(() => refresh())
      .catch(() => undefined)
  }
  const add = (): void => {
    const value = draft.trim()
    if (value === '' || sources.includes(value)) { setDraft(''); return }
    save([...sources, value])
    setDraft('')
  }

  return <div className="dsh-skm-editor">
    <div className="dsh-skm-blockTitle">来源目录</div>
    <p className="dsh-skm-intro">
      「导入」页会扫描下面这些目录,列出里面尚未安装的技能(目录式 SKILL.md、平铺 .md 或 .skill 包均可)。默认含本机 Claude 技能目录 ~/.claude/skills。
    </p>
    {sources.length === 0
      ? <p className="dsh-skm-empty">还没有配置来源目录,在下方添加一个。</p>
      : <ul className="dsh-skm-cards">
        {sources.map(source => (
          <li key={source} className="dsh-skm-rowCard">
            <div className="dsh-skm-rowHead">
              <span className="dsh-skm-rowIdentity">
                <span className="dsh-skm-rowName"><code>{source}</code></span>
              </span>
              <span className="dsh-skm-rowActions">
                <Button size="sm" variant="ghost" className="dsh-skm-danger" onClick={() => {
                  if (window.confirm(`从来源里移除「${source}」?(只影响扫描,不删除文件)`)) {
                    save(sources.filter(item => item !== source))
                  }
                }}>移除</Button>
              </span>
            </div>
          </li>
        ))}
      </ul>}
    <div className="dsh-skm-field">
      <label className="dsh-skm-fieldLabel" htmlFor="dsh-skm-source-add">添加来源目录(绝对路径,支持 ~)</label>
      <div className="dsh-skm-addRow">
        <input id="dsh-skm-source-add" className="dsh-skm-input" placeholder="~/.claude/skills"
          value={draft} onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') add() }} />
        <Button size="sm" variant="primary" disabled={draft.trim() === ''} onClick={add}>添加</Button>
      </div>
    </div>
    <div className="dsh-skm-editorActions">
      <Button size="sm" variant="outline" onClick={openImport}>去「导入」页看看 →</Button>
    </div>
  </div>
}
