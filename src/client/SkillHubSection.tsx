/**
 * 技能中枢设置页:两个页签(全局技能 / 发现)。
 *
 * 信息架构原则:
 * - **产物落在哪,操作就在哪**:新建与上传 .skill 的产物是全局库技能,
 *   所以入口在「全局技能」页首行(不用滚过发现列表);上传选完文件即入库,
 *   没有多余的确认步。
 * - **来源不是独立页**:它只是发现页的扫描配置,以 chips 形式内联在
 *   发现页顶部(存在性/技能数直接标在 chip 上,坏路径一眼可见)。
 * - **批量引用走单次 RPC**(importLinkBatch),不逐项刷新闪屏。
 *
 * 数据操作经宿主 skillHub RPC。样式复用官方设置页体系。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, IconSkillOutline16, MarkdownText, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BrowseResult, HubCommand, HubCommandResult, HubSkill, HubState } from '../index.js'

export interface SkillHubSectionProps {
  /** 槽位 inject 面:打开技能目录。 */
  openPath?: (path: string) => void
  /** 槽位 inject 面:宿主调用(RPC 解包后,错误直接抛 Error)。 */
  api?: {
    getState(): Promise<HubState>
    runCommand(command: HubCommand): Promise<HubCommandResult>
    browseDirs(dirPath: string): Promise<BrowseResult>
  }
}

function fmtDate(iso: string): string {
  if (iso === '') return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** 把 home 路径缩写为 ~ 形式(展示用,尽力而为)。 */
function shortPath(p: string): string {
  return p.replace(/^\/(Users|home)\/[^/]+/u, '~')
}

/** 状态行语气:失败类文案挂 error 红,成功/中性走 tertiary。 */
function statusTone(message: string): 'idle' | 'error' {
  return /失败|出错|不合法|损坏|无法/u.test(message) ? 'error' : 'idle'
}

const CSS = `
.dsh-skh-section { display: flex; flex-direction: column; gap: 12px; width: 100%;
  min-width: 0; box-sizing: border-box; max-width: 760px;
  color: var(--dsw-alias-label-primary); }
.dsh-skh-heading { display: flex; align-items: center; gap: 8px; margin: 0;
  font-size: 18px; font-weight: 600; }
.dsh-skh-heading svg { flex: none; color: var(--dsw-alias-label-secondary); }
.dsh-skh-intro { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.dsh-skh-status { margin: 0; min-height: 18px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); }
.dsh-skh-status[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.dsh-skh-tabs { display: flex; align-items: flex-end; gap: 22px; flex-wrap: wrap;
  border-bottom: 1px solid var(--dsw-alias-border-l2); margin-top: 2px; }
.dsh-skh-tab { position: relative; border: 0; padding: 7px 1px 9px; background: transparent;
  color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; line-height: 20px;
  cursor: pointer; }
.dsh-skh-tab:hover, .dsh-skh-tab[data-active='true'] { color: var(--dsw-alias-label-primary); }
.dsh-skh-tab[data-active='true']::after { position: absolute; right: 0; bottom: -1px; left: 0;
  height: 2px; border-radius: 2px 2px 0 0; background: var(--dsw-alias-label-primary); content: ''; }
.dsh-skh-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0;
  padding-top: 2px; }
.dsh-skh-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-skh-toolbar .dsh-skh-filter { flex: 1; min-width: 140px; }
.dsh-skh-filter { box-sizing: border-box; height: 28px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
  font: inherit; font-size: 12px; background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); }
.dsh-skh-filter:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dsh-skh-filter::placeholder { color: var(--dsw-alias-label-dimmed); }
.dsh-skh-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-skh-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 3px 6px 3px 10px; border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-primary); }
.dsh-skh-chip[data-missing='true'] { border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary); }
.dsh-skh-chip code { font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11.5px; overflow-wrap: anywhere; }
.dsh-skh-chip-count { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dsh-skh-chip-remove { border: none; background: transparent; padding: 1px 4px;
  border-radius: 8px; font-size: 12px; line-height: 1; cursor: pointer;
  color: var(--dsw-alias-label-tertiary); }
.dsh-skh-chip-remove:hover { background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary); }
.dsh-skh-blockTitle { display: flex; align-items: center; gap: 8px; font-size: 14px;
  line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsh-skh-addRow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-skh-addRow .dsh-skh-input { flex: 1; min-width: 0; }
.dsh-skh-cards { list-style: none; margin: 0; padding: 0; display: flex;
  flex-direction: column; gap: 10px; }
.dsh-skh-rowCard { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dsh-skh-rowCard[data-broken='true'] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-skh-rowHead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-skh-rowIdentity { display: inline-flex; align-items: center; gap: 6px;
  min-width: 0; max-width: 100%; flex-wrap: wrap; }
.dsh-skh-rowName { font-size: 14px; line-height: 22px; font-weight: 500;
  color: var(--dsw-alias-label-primary); min-width: 0; overflow-wrap: anywhere; }
.dsh-skh-rowName code { font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 13px; overflow-wrap: anywhere; }
.dsh-skh-tag { flex: none; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 4px; font-size: 11px; line-height: 16px;
  color: var(--dsw-alias-label-secondary); max-width: 320px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.dsh-skh-tag[data-kind='link'] { color: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary); }
.dsh-skh-tag[data-kind='broken'] { color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary); }
.dsh-skh-rowActions { display: inline-flex; align-items: center; gap: 4px;
  flex-wrap: wrap; margin-left: auto; }
.dsh-skh-danger { color: var(--dsw-alias-state-error-primary); }
.dsh-skh-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
.dsh-skh-desc { margin: 0; font-size: 13px; line-height: 20px; min-width: 0;
  overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
.dsh-skh-desc[data-clamped='true'] { cursor: pointer; }
.dsh-skh-desc[data-clamped='true'] .dsh-skh-md { display: -webkit-box;
  -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.dsh-skh-md { display: flex; flex-direction: column; }
.dsh-skh-md > :first-child { margin-top: 0; }
.dsh-skh-md > :last-child { margin-bottom: 0; }
.dsh-skh-md :where(h1, h2, h3, h4, h5, h6) { margin: 8px 0 4px; font-size: 13.5px;
  line-height: 20px; font-weight: 600; }
.dsh-skh-md :where(p, ul, ol) { margin: 0 0 6px; font-size: 13px; line-height: 20px; }
.dsh-skh-md :where(ul, ol) { padding-left: 20px; }
.dsh-skh-md :where(pre) { margin: 0 0 6px; font-size: 12px; max-width: 100%; overflow-x: auto; }
.dsh-skh-md :where(code) { font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 12px; overflow-wrap: anywhere; }
.dsh-skh-meta { margin: 0; font-size: 12px; line-height: 18px; overflow-wrap: anywhere;
  color: var(--dsw-alias-label-tertiary); }
.dsh-skh-meta[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.dsh-skh-empty { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary);
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-skh-editor { border-radius: 12px; min-width: 0; box-sizing: border-box;
  background: var(--dsw-alias-bg-module-platform);
  padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.dsh-skh-editorHeader { display: flex; flex-direction: column; gap: 4px; }
.dsh-skh-editorTitleRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-skh-editorTitle { font-size: 14px; line-height: 22px; font-weight: 500;
  color: var(--dsw-alias-label-primary); }
.dsh-skh-editorNote { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere; }
.dsh-skh-field { display: flex; flex-direction: column; gap: 6px; }
.dsh-skh-fieldLabel { display: inline-flex; align-items: center; gap: 10px; font-size: 12px;
  line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dsh-skh-input, .dsh-skh-textarea { box-sizing: border-box; width: 100%;
  padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  font: inherit; font-size: 14px; line-height: 22px; background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); }
.dsh-skh-input { height: 32px; padding: 0 10px; }
.dsh-skh-textarea { min-height: 220px; resize: vertical;
  font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12px;
  line-height: 1.6; }
.dsh-skh-input:focus, .dsh-skh-textarea:focus { outline: none;
  border-color: var(--dsw-alias-brand-primary); }
.dsh-skh-input::placeholder, .dsh-skh-textarea::placeholder {
  color: var(--dsw-alias-label-dimmed); }
.dsh-skh-editorActions { display: flex; justify-content: flex-end; gap: 8px; align-items: center;
  flex-wrap: wrap; }
.dsh-skh-dirty { color: var(--dsw-alias-brand-primary); margin-right: auto; font-size: 12px; }
.dsh-skh-link { border: 0; padding: 0; background: transparent;
  color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-skh-link:hover { text-decoration: underline; }
`

type TabId = 'hub' | 'discover'

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

/** 行内两步确认按钮(替代 window.confirm;4 秒未确认自动收回)。 */
function ConfirmButton(props: { label: string, confirmLabel: string, onConfirm: () => void }) {
  const { label, confirmLabel, onConfirm } = props
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const timer = setTimeout(() => { setArming(false) }, 4000)
    return () => { clearTimeout(timer) }
  }, [arming])
  return arming
    ? (
      <>
        <Button size="sm" variant="ghost" className="dsh-skh-danger" onClick={onConfirm}>{confirmLabel}</Button>
        <Button size="sm" variant="outline" onClick={() => { setArming(false) }}>取消</Button>
      </>
    )
    : <Button size="sm" variant="ghost" className="dsh-skh-danger" onClick={() => { setArming(true) }}>{label}</Button>
}

/** 可折叠描述:默认 3 行截断,点击展开/收起。 */
function ClampedDescription({ text }: { text: string }) {
  const [clamped, setClamped] = useState(true)
  if (text === '') return null
  return (
    <div
      className="dsh-skh-desc dsh-skh-md"
      data-clamped={clamped ? 'true' : undefined}
      title={clamped ? '点击展开' : '点击收起'}
      onClick={() => { setClamped(value => !value) }}
    >
      <MarkdownText text={text} />
    </div>
  )
}

/** 技能中枢设置页组件。 */
export function SkillHubSection({ openPath, api }: SkillHubSectionProps) {
  useEffect(() => {
    if (document.getElementById('dsh-skill-hub-style') === null) {
      const style = document.createElement('style')
      style.id = 'dsh-skill-hub-style'
      style.textContent = CSS
      document.head.append(style)
    }
  }, [])

  const [tab, setTab] = useState<TabId>('hub')
  const [state, setState] = useState<HubState | undefined>(undefined)
  const [message, setMessage] = useState('加载中…')
  const [editing, setEditing] = useState<{ skill: HubSkill, content: string } | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (api === undefined) throw new Error('skillHub 服务未就绪')
    setState(await api.getState())
  }, [api])

  useEffect(() => {
    void refresh()
      .then(() => setMessage(''))
      .catch((error: unknown) => {
        setMessage(`加载失败:${error instanceof Error ? error.message : String(error)}`)
      })
  }, [refresh])

  const run = useCallback(async (command: HubCommand): Promise<HubCommandResult> => {
    if (api === undefined) throw new Error('skillHub 服务未就绪')
    if (busy) throw new Error('上一个操作还在执行')
    setBusy(true)
    setMessage('执行中…')
    try {
      const result = await api.runCommand(command)
      setState(result.state)
      setMessage(result.message)
      return result
    } catch (error) {
      setMessage(`出错:${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      setBusy(false)
    }
  }, [api, busy])

  const startEdit = useCallback(async (skill: HubSkill): Promise<void> => {
    try {
      const response = await run({ action: 'read', name: skill.name })
      if (response.body !== undefined) setEditing({ skill, content: response.body.content })
      else setMessage('读取失败:未收到内容')
    } catch { /* run 已提示 */ }
  }, [run])

  const tabs = useMemo(() => ([
    { id: 'hub' as const, label: `全局技能 (${state?.skills.length ?? 0})` },
    { id: 'discover' as const, label: `发现 (${state?.discoverable.length ?? 0})` },
  ]), [state])

  return (
    <div className="dsh-skh-section">
      <h2 className="dsh-skh-heading">
        <IconSkillOutline16 size={16} />技能
      </h2>
      <p className="dsh-skh-intro">
        全局技能库(~/.dsh/skills):对所有会话生效,出现在输入框的「/」菜单。项目目录里的技能由 dsh 直接扫描生效,不经过此页。
      </p>
      <p className="dsh-skh-status" role="status" aria-live="polite" data-tone={statusTone(message)}>{message}</p>
      <div className="dsh-skh-tabs" role="tablist" aria-label="技能中枢页签">
        {tabs.map(entry => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className="dsh-skh-tab"
            aria-selected={tab === entry.id}
            data-active={tab === entry.id ? 'true' : undefined}
            onClick={() => { setTab(entry.id) }}
          >{entry.label}</button>
        ))}
      </div>
      <div className="dsh-skh-panel" role="tabpanel">
        {tab === 'hub' && (
          editing !== undefined
            ? (
              <SkillEditor
                editing={editing}
                run={run}
                openPath={openPath}
                onClose={() => { setEditing(undefined) }}
              />
            )
            : (
              <HubTab
                state={state}
                run={run}
                startEdit={startEdit}
                openPath={openPath}
                goDiscover={() => { setTab('discover') }}
              />
            )
        )}
        {tab === 'discover' && <DiscoverTab state={state} run={run} browseDirs={api?.browseDirs} />}
      </div>
    </div>
  )
}

interface TabCommon {
  run: (command: HubCommand) => Promise<HubCommandResult>
}

/** 身份徽标集合。 */
function modeTags(skill: HubSkill): { text: string, kind?: string, title?: string }[] {
  const tags: { text: string, kind?: string, title?: string }[] = []
  if (skill.broken) tags.push({ text: '引用失效', kind: 'broken', title: `来源已消失:${skill.sourcePath}` })
  else if (skill.mode === 'link') tags.push({ text: `引用 → ${shortPath(skill.sourcePath)}`, kind: 'link', title: skill.sourcePath })
  else if (skill.mode === 'copy') tags.push({ text: '副本', title: skill.sourcePath === '' ? undefined : `复制自 ${skill.sourcePath}` })
  else tags.push({ text: '本地创建' })
  // 「用户 + 模型可调用」是默认态,只标注非默认的收窄。
  if (skill.invocation === 'user') tags.push({ text: '仅用户可调用' })
  if (skill.invocation === 'model') tags.push({ text: '仅模型可调用' })
  if (skill.resourceCount > 0) tags.push({ text: `${skill.resourceCount} 个资源文件` })
  return tags
}

/** 一张全局技能卡:主操作「编辑」,次要操作收进 ⋯ 菜单。 */
function SkillCard({ skill, run, startEdit, openPath }: TabCommon & {
  skill: HubSkill
  startEdit: (skill: HubSkill) => Promise<void>
  openPath: ((path: string) => void) | undefined
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuItems = [
    { id: 'export', label: '导出 .skill' },
    ...openPath !== undefined ? [{ id: 'open', label: '打开目录' }] : [],
    { id: 'copy-name', label: `复制 /${skill.name}` },
  ]
  const onMenuSelect = (id: string): void => {
    setMenuOpen(false)
    if (id === 'export') {
      void run({ action: 'export', name: skill.name })
        .then(response => {
          if (response.archiveBase64 !== undefined) downloadArchive(skill.name, response.archiveBase64)
        })
        .catch(() => undefined)
    } else if (id === 'open' && openPath !== undefined) {
      openPath(skill.mode === 'link' && skill.sourcePath !== '' && !skill.broken ? skill.sourcePath : skill.dir)
    } else if (id === 'copy-name') {
      void navigator.clipboard?.writeText(`/${skill.name}`).catch(() => undefined)
    }
  }
  return (
    <li className="dsh-skh-rowCard" data-broken={skill.broken ? 'true' : undefined}>
      <div className="dsh-skh-rowHead">
        <span className="dsh-skh-rowIdentity">
          <span className="dsh-skh-rowName"><code>/{skill.name}</code></span>
          {modeTags(skill).map(tag => (
            <span key={tag.text} className="dsh-skh-tag" data-kind={tag.kind} title={tag.title}>{tag.text}</span>
          ))}
        </span>
        <span className="dsh-skh-rowActions">
          {!skill.broken && <Button size="sm" variant="outline" onClick={() => void startEdit(skill)}>编辑 SKILL.md</Button>}
          {!skill.broken && (
            <Menu
              open={menuOpen}
              anchor={<Button size="sm" variant="outline" aria-label="更多操作" onClick={() => { setMenuOpen(value => !value) }}>⋯</Button>}
              items={menuItems}
              onSelect={onMenuSelect}
              onClose={() => { setMenuOpen(false) }}
              align="end"
            />
          )}
          <ConfirmButton
            label={skill.mode === 'link' ? '移除引用' : '删除'}
            confirmLabel={skill.mode === 'link' ? '确认移除(不动来源)' : '确认删除(入回收站)'}
            onConfirm={() => { void run({ action: 'delete', name: skill.name }).catch(() => undefined) }}
          />
        </span>
      </div>
      {!skill.broken && <ClampedDescription text={skill.description} />}
      {skill.broken
        ? <p className="dsh-skh-meta" data-tone="error">来源已消失:{shortPath(skill.sourcePath)}(移除引用不会影响来源;若来源只是移动了位置,移除后到「发现」页重新引用)</p>
        : skill.addedAt !== '' ? <p className="dsh-skh-meta">入库于 {fmtDate(skill.addedAt)}</p> : null}
    </li>
  )
}

/** 内联新建卡(粘贴创建;显示在列表上方,不用滚动)。 */
function CreateCard({ run, onDone }: TabCommon & { onDone: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  return (
    <section className="dsh-skh-editor">
      <div className="dsh-skh-blockTitle">新建技能</div>
      <p className="dsh-skh-intro">直接写内容;名称与描述可留空(自动从内容推断),也可以粘贴带 --- frontmatter 的完整 SKILL.md。</p>
      <div className="dsh-skh-field">
        <label className="dsh-skh-fieldLabel" htmlFor="dsh-skh-new-name">名称(可留空)</label>
        <input id="dsh-skh-new-name" className="dsh-skh-input" placeholder="my-skill"
          value={name} onChange={event => setName(event.target.value)} />
      </div>
      <div className="dsh-skh-field">
        <label className="dsh-skh-fieldLabel" htmlFor="dsh-skh-new-desc">描述(可留空)</label>
        <input id="dsh-skh-new-desc" className="dsh-skh-input" placeholder="这个技能什么时候用(留空取正文首行)"
          value={description} onChange={event => setDescription(event.target.value)} />
      </div>
      <div className="dsh-skh-field">
        <label className="dsh-skh-fieldLabel" htmlFor="dsh-skh-new-body">技能正文(Markdown)</label>
        <textarea id="dsh-skh-new-body" className="dsh-skh-textarea"
          placeholder={'技能正文。示例:\n\n1. 打开 xxx\n2. 检查 yyy'}
          value={content} onChange={event => setContent(event.target.value)} />
      </div>
      <div className="dsh-skh-editorActions">
        <Button size="sm" variant="outline" onClick={onDone}>取消</Button>
        <Button size="sm" variant="primary" disabled={content.trim() === ''} onClick={() => {
          void run({ action: 'importPaste', name, description, content })
            .then(() => { onDone() })
            .catch(() => undefined)
        }}>创建</Button>
      </div>
    </section>
  )
}

function HubTab({ state, run, startEdit, openPath, goDiscover }: TabCommon & {
  state: HubState | undefined
  startEdit: (skill: HubSkill) => Promise<void>
  openPath: ((path: string) => void) | undefined
  goDiscover: () => void
}) {
  const list = state?.skills ?? []
  const discoverCount = state?.discoverable.length ?? 0
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const shown = filter.trim() === ''
    ? list
    : list.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(filter.trim().toLowerCase()))

  /** 上传 .skill:选完文件即入库,不设中间确认步。 */
  const onPickArchive = (file: File | undefined): void => {
    if (file === undefined) return
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.includes(',') ? result.split(',').slice(1).join(',') : ''
      if (base64 === '') return
      void run({ action: 'importArchive', name: file.name, archiveBase64: base64 }).catch(() => undefined)
    })
    reader.readAsDataURL(file)
  }

  return <>
    <div className="dsh-skh-toolbar">
      <Button size="sm" variant={creating ? 'outline' : 'primary'} onClick={() => { setCreating(value => !value) }}>
        {creating ? '收起新建' : '＋ 新建技能'}
      </Button>
      <label>
        <input type="file" accept=".skill,.zip" style={{ display: 'none' }}
          onChange={event => { onPickArchive(event.target.files?.[0]); event.target.value = '' }} />
        <Button size="sm" variant="outline" onClick={event => {
          (event.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null)?.click()
        }}>上传 .skill</Button>
      </label>
      {list.length > 5 && (
        <input className="dsh-skh-filter" placeholder="筛选技能…" aria-label="筛选技能"
          value={filter} onChange={event => setFilter(event.target.value)} />
      )}
    </div>
    {creating && <CreateCard run={run} onDone={() => { setCreating(false) }} />}
    {list.length === 0 && !creating
      ? (
        <p className="dsh-skh-empty">
          全局库还是空的。
          {discoverCount > 0 && (
            <Button size="sm" variant="primary" onClick={goDiscover}>去「发现」引用现有技能({discoverCount})</Button>
          )}
        </p>
      )
      : shown.length === 0 && filter !== ''
        ? <p className="dsh-skh-empty">没有匹配「{filter}」的技能。</p>
        : (
          <ul className="dsh-skh-cards">
            {shown.map(skill => (
              <SkillCard key={skill.name} skill={skill} run={run} startEdit={startEdit} openPath={openPath} />
            ))}
          </ul>
        )}
  </>
}

/** SKILL.md 编辑器:脏态守卫 + Cmd/Ctrl+S,保存后停留;引用技能明示写穿来源。 */
function SkillEditor({ editing, run, openPath, onClose }: TabCommon & {
  editing: { skill: HubSkill, content: string }
  openPath: ((path: string) => void) | undefined
  onClose: () => void
}) {
  const { skill } = editing
  const [baseline, setBaseline] = useState(editing.content)
  const [draft, setDraft] = useState(editing.content)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = draft !== baseline

  const save = (): void => {
    if (!dirty) return
    void run({ action: 'save', name: skill.name, content: draft })
      .then(() => { setBaseline(draft); setConfirmDiscard(false) })
      .catch(() => undefined)
  }
  const requestClose = (): void => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  return <div className="dsh-skh-editor">
    <div className="dsh-skh-editorHeader">
      <div className="dsh-skh-editorTitleRow">
        <span className="dsh-skh-editorTitle">编辑 SKILL.md:/{skill.name}</span>
        {openPath !== undefined && (
          <button type="button" className="dsh-skh-link" onClick={() => {
            openPath(skill.mode === 'link' && skill.sourcePath !== '' ? skill.sourcePath : skill.dir)
          }}>打开目录</button>
        )}
      </div>
      {skill.mode === 'link' && (
        <span className="dsh-skh-editorNote">⚠ 这是引用技能:保存会直接写入来源文件 {skill.sourcePath}(在 Claude Code 等处同步可见)。</span>
      )}
      {skill.resourceCount > 0 && (
        <span className="dsh-skh-editorNote">此技能还有 {skill.resourceCount} 个资源文件,这里只编辑 SKILL.md;资源用「打开目录」管理。</span>
      )}
    </div>
    <textarea
      className="dsh-skh-textarea"
      aria-label={`编辑 ${skill.name} 的 SKILL.md`}
      value={draft}
      spellCheck={false}
      onChange={event => { setDraft(event.target.value) }}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
          event.preventDefault()
          save()
        }
      }}
    />
    <div className="dsh-skh-editorActions">
      {dirty && <span className="dsh-skh-dirty">● 有未保存的修改</span>}
      {confirmDiscard
        ? (
          <>
            <Button size="sm" variant="primary" onClick={() => { save(); onClose() }}>保存并关闭</Button>
            <Button size="sm" variant="ghost" className="dsh-skh-danger" onClick={onClose}>放弃修改</Button>
            <Button size="sm" variant="outline" onClick={() => { setConfirmDiscard(false) }}>继续编辑</Button>
          </>
        )
        : (
          <>
            <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>保存</Button>
            <Button size="sm" variant="outline" onClick={requestClose}>{dirty ? '关闭…' : '关闭'}</Button>
          </>
        )}
    </div>
  </div>
}

/** 发现页:来源 chips(内联管理)+ 目录选择器 + 扫描结果(引用/复制/批量)。 */
function DiscoverTab({ state, run, browseDirs }: TabCommon & {
  state: HubState | undefined
  browseDirs: ((dirPath: string) => Promise<BrowseResult>) | undefined
}) {
  const discoverable = state?.discoverable ?? []
  const sources = state?.sources ?? []
  const linkable = discoverable.filter(item => item.kind !== 'archive')
  const [filter, setFilter] = useState('')
  const [addingSource, setAddingSource] = useState(false)

  const shown = filter.trim() === ''
    ? discoverable
    : discoverable.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(filter.trim().toLowerCase()))

  const saveSources = (next: readonly string[]): void => {
    void run({ action: 'setSources', sources: [...next] }).catch(() => undefined)
  }
  const addSource = (value: string): void => {
    const trimmed = value.trim()
    if (trimmed !== '' && !sources.some(info => info.path === trimmed)) {
      saveSources([...sources.map(info => info.path), trimmed])
    }
    setAddingSource(false)
  }

  return <>
    <div className="dsh-skh-chips" aria-label="扫描目录">
      <span className="dsh-skh-meta">扫描目录:</span>
      {sources.map(info => (
        <span key={info.path} className="dsh-skh-chip" data-missing={info.exists ? undefined : 'true'}
          title={info.exists ? `${info.path}:${info.skillCount} 个技能(含已入库)` : `${info.path}:目录不存在或不可读`}>
          <code>{info.path}</code>
          <span className="dsh-skh-chip-count">{info.exists ? info.skillCount : '不存在'}</span>
          <button type="button" className="dsh-skh-chip-remove" aria-label={`移除扫描目录 ${info.path}`}
            onClick={() => { saveSources(sources.filter(other => other.path !== info.path).map(other => other.path)) }}>✕</button>
        </span>
      ))}
      {!addingSource && <Button size="sm" variant="outline" onClick={() => { setAddingSource(true) }}>＋ 目录</Button>}
    </div>
    {addingSource && (
      <SourcePicker browseDirs={browseDirs} onAdd={addSource} onClose={() => { setAddingSource(false) }} />
    )}
    <div className="dsh-skh-toolbar">
      {discoverable.length > 5 && (
        <input className="dsh-skh-filter" placeholder="筛选可入库的技能…" aria-label="筛选可入库的技能"
          value={filter} onChange={event => setFilter(event.target.value)} />
      )}
      {linkable.length > 1 && (
        <Button size="sm" variant="outline" onClick={() => {
          void run({ action: 'importLinkBatch', sourcePaths: linkable.map(item => item.sourcePath) }).catch(() => undefined)
        }}>全部引用({linkable.length})</Button>
      )}
    </div>
    <p className="dsh-skh-intro">
      「<b>引用</b>」= 符号链接,一份文件两边生效,编辑即编辑来源(推荐);「<b>复制</b>」= 独立副本,与来源各自演化。入库即出现在「/」菜单。
    </p>
    {discoverable.length === 0
      ? <p className="dsh-skh-empty">扫描目录里没有可入库的新技能(已入库的不重复列出)。</p>
      : shown.length === 0
        ? <p className="dsh-skh-empty">没有匹配「{filter}」的技能。</p>
        : (
          <ul className="dsh-skh-cards">
            {shown.map(item => (
              <li key={item.sourcePath} className="dsh-skh-rowCard">
                <div className="dsh-skh-rowHead">
                  <span className="dsh-skh-rowIdentity">
                    <span className="dsh-skh-rowName"><code>/{item.name}</code></span>
                    {item.kind === 'archive' && <span className="dsh-skh-tag">.skill 包 · 仅可复制</span>}
                  </span>
                  <span className="dsh-skh-rowActions">
                    {item.kind !== 'archive' && (
                      <Button size="sm" variant="primary" onClick={() => {
                        void run({ action: 'importLink', sourcePath: item.sourcePath }).catch(() => undefined)
                      }}>引用</Button>
                    )}
                    <Button size="sm" variant={item.kind === 'archive' ? 'primary' : 'outline'} onClick={() => {
                      void run({ action: 'importCopy', sourcePath: item.sourcePath }).catch(() => undefined)
                    }}>复制</Button>
                  </span>
                </div>
                <ClampedDescription text={item.description} />
                <p className="dsh-skh-meta">{shortPath(item.sourcePath)}</p>
              </li>
            ))}
          </ul>
        )}
  </>
}

/** 目录选择器:常见位置一键添加 + 逐级浏览 + 手输兜底。 */
function SourcePicker({ browseDirs, onAdd, onClose }: {
  browseDirs: ((dirPath: string) => Promise<BrowseResult>) | undefined
  onAdd: (path: string) => void
  onClose: () => void
}) {
  const [view, setView] = useState<BrowseResult | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [manual, setManual] = useState('')

  const browse = useCallback((dirPath: string): void => {
    if (browseDirs === undefined) return
    setError(undefined)
    void browseDirs(dirPath)
      .then(result => { setView(result) })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
  }, [browseDirs])

  useEffect(() => { browse('') }, [browse])

  /** 当前视图下某子目录的展示路径(~ 形式,直接可存为来源)。 */
  const childPath = (name: string): string =>
    view === undefined ? name : view.display === '~' ? `~/${name}` : `${view.display}/${name}`

  return (
    <section className="dsh-skh-editor">
      <div className="dsh-skh-blockTitle">
        选择扫描目录
        <span style={{ marginLeft: 'auto' }} />
        <Button size="sm" variant="outline" onClick={onClose}>取消</Button>
      </div>
      {view?.suggestions !== undefined && view.suggestions.length > 0 && (
        <div className="dsh-skh-chips">
          <span className="dsh-skh-meta">常见位置:</span>
          {view.suggestions.map(item => (
            <button key={item.path} type="button" className="dsh-skh-chip" style={{ cursor: 'pointer' }}
              title={`添加 ${item.path}`} onClick={() => { onAdd(item.path) }}>
              <code>{item.path}</code>
              <span className="dsh-skh-chip-count">{item.skillCount} 个技能</span>
              <span aria-hidden="true">＋</span>
            </button>
          ))}
        </div>
      )}
      {error !== undefined && <p className="dsh-skh-status" data-tone="error">{error}</p>}
      {view !== undefined && (
        <>
          <div className="dsh-skh-toolbar">
            <Button size="sm" variant="outline" disabled={view.parent === undefined}
              onClick={() => { if (view.parent !== undefined) browse(view.parent) }}>↑ 上一级</Button>
            <span className="dsh-skh-meta" style={{ flex: 1, overflowWrap: 'anywhere' }}><code>{view.display}</code></span>
            <Button size="sm" variant="primary" onClick={() => { onAdd(view.display) }}>把这个目录加为来源</Button>
          </div>
          <ul className="dsh-skh-cards" style={{ gap: 2, maxHeight: 260, overflowY: 'auto' }}>
            {view.dirs.length === 0 && <li className="dsh-skh-empty">没有子目录。</li>}
            {view.dirs.map(dir => (
              <li key={dir.name} className="dsh-skh-rowHead" style={{ padding: '4px 6px' }}>
                <button type="button" className="dsh-skh-link" style={{ fontSize: 13 }}
                  onClick={() => { browse(`${view.display === '~' ? '~' : view.display}/${dir.name}`) }}>
                  {dir.name}/
                </button>
                {dir.skillCount > 0 && <span className="dsh-skh-tag">{dir.skillCount} 个技能</span>}
                <span className="dsh-skh-rowActions">
                  <Button size="sm" variant={dir.skillCount > 0 ? 'primary' : 'outline'}
                    onClick={() => { onAdd(childPath(dir.name)) }}>添加</Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="dsh-skh-addRow">
        <input className="dsh-skh-filter" style={{ flex: 1 }} placeholder="或直接输入路径:~/some/skills"
          aria-label="手动输入扫描目录" value={manual}
          onChange={event => setManual(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && manual.trim() !== '') onAdd(manual) }} />
        <Button size="sm" variant="outline" disabled={manual.trim() === ''} onClick={() => { onAdd(manual) }}>添加</Button>
      </div>
    </section>
  )
}
