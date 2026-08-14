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
 * 全部可见文案经词典键渲染:t 由槽位注册声明的 locale: NS 注入,
 * 随界面语言切换重推导;子组件经 props 逐层透传。宿主结果的展示文案
 * 优先按结果码 code 取本地化版本,取不到回退宿主中文 message。
 *
 * 数据操作经宿主 skillHub RPC。样式复用官方设置页体系。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, IconSkillOutline16, MarkdownText, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowseResult, HubCommand, HubCommandResult, HubSkill, HubState } from '../index.js'
import { tr } from './locales.ts'

/** 本命名空间的翻译函数(槽位 locale 席位注入的标准类型)。 */
type T = TranslateNS<'dsh-skills'>

export interface SkillHubSectionProps {
  /** 槽位 inject 面:打开技能目录。 */
  openPath?: (path: string) => void
  /** 槽位 inject 面:宿主调用(RPC 解包后,错误直接抛 Error)。 */
  api?: {
    getState(): Promise<HubState>
    runCommand(command: HubCommand): Promise<HubCommandResult>
    browseDirs(dirPath: string): Promise<BrowseResult>
  }
  /** 槽位 locale 席位:框架注入的翻译函数。 */
  t: T
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

/**
 * 状态行:存词典键而非成品文案,渲染时经 t 取词,语言切换即时跟随。
 * fallback 是键缺翻译时的宿主中文回退(runCommand 结果码路径)。
 */
interface StatusLine {
  key: string
  params?: Record<string, unknown>
  fallback?: string
  /** 宿主显式给出的语气:error 标红,缺省 idle。 */
  level: 'idle' | 'error'
}

/** 状态行文本:键命中词典取译文,否则回退 fallback(都没有则显示键)。 */
function statusText(t: T, line: StatusLine): string {
  // key 经 wire 来自宿主(任意 string),运行时由 translate 的缺词回键兜底。
  const translated = t(line.key as Parameters<T>[0], line.params)
  return translated === line.key && line.fallback !== undefined ? line.fallback : translated
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
function ConfirmButton(props: { t: T, label: string, confirmLabel: string, onConfirm: () => void }) {
  const { t, label, confirmLabel, onConfirm } = props
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
        <Button size="sm" variant="outline" onClick={() => { setArming(false) }}>{t('common.cancel')}</Button>
      </>
    )
    : <Button size="sm" variant="ghost" className="dsh-skh-danger" onClick={() => { setArming(true) }}>{label}</Button>
}

/** 可折叠描述:默认 3 行截断,点击展开/收起。 */
function ClampedDescription({ t, text }: { t: T, text: string }) {
  const [clamped, setClamped] = useState(true)
  if (text === '') return null
  return (
    <div
      className="dsh-skh-desc dsh-skh-md"
      data-clamped={clamped ? 'true' : undefined}
      title={clamped ? t('desc.expand') : t('desc.collapse')}
      onClick={() => { setClamped(value => !value) }}
    >
      <MarkdownText text={text} />
    </div>
  )
}

/** 技能中枢设置页组件。 */
export function SkillHubSection({ openPath, api, t }: SkillHubSectionProps) {
  useEffect(() => {
    if (document.getElementById('dsh-skills-style') === null) {
      const style = document.createElement('style')
      style.id = 'dsh-skills-style'
      style.textContent = CSS
      document.head.append(style)
    }
  }, [])

  const [tab, setTab] = useState<TabId>('hub')
  const [state, setState] = useState<HubState | undefined>(undefined)
  const [status, setStatus] = useState<StatusLine>({ key: 'status.loading', level: 'idle' })
  const [editing, setEditing] = useState<{ skill: HubSkill, content: string } | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (api === undefined) throw new Error(tr('svc.unready'))
    setState(await api.getState())
  }, [api])

  useEffect(() => {
    void refresh()
      .then(() => { setStatus({ key: '', level: 'idle' }) })
      .catch((error: unknown) => {
        setStatus({
          key: 'status.loadFailed',
          params: { msg: error instanceof Error ? error.message : String(error) },
          level: 'error',
        })
      })
  }, [refresh])

  const run = useCallback(async (command: HubCommand): Promise<HubCommandResult> => {
    if (api === undefined) throw new Error(tr('svc.unready'))
    if (busy) throw new Error(tr('svc.busy'))
    setBusy(true)
    setStatus({ key: 'status.running', level: 'idle' })
    try {
      const result = await api.runCommand(command)
      setState(result.state)
      setStatus({
        key: result.code ?? '',
        params: result.params,
        fallback: result.message,
        level: result.level === 'error' ? 'error' : 'idle',
      })
      return result
    } catch (error) {
      setStatus({
        key: 'status.error',
        params: { msg: error instanceof Error ? error.message : String(error) },
        level: 'error',
      })
      throw error
    } finally {
      setBusy(false)
    }
  }, [api, busy])

  const startEdit = useCallback(async (skill: HubSkill): Promise<void> => {
    try {
      const response = await run({ action: 'read', name: skill.name })
      if (response.body !== undefined) setEditing({ skill, content: response.body.content })
      else setStatus({ key: 'read.emptyBody', level: 'error' })
    } catch { /* run 已提示 */ }
  }, [run])

  const tabs = useMemo(() => ([
    { id: 'hub' as const, label: t('tab.hub', { count: state?.skills.length ?? 0 }) },
    { id: 'discover' as const, label: t('tab.discover', { count: state?.discoverable.length ?? 0 }) },
  ]), [state, t])

  return (
    <div className="dsh-skh-section">
      <h2 className="dsh-skh-heading">
        <IconSkillOutline16 size={16} />{t('nav')}
      </h2>
      <p className="dsh-skh-intro">
        {t('intro')}
      </p>
      <p className="dsh-skh-status" role="status" aria-live="polite" data-tone={status.level}>{statusText(t, status)}</p>
      <div className="dsh-skh-tabs" role="tablist" aria-label={t('tabs.aria')}>
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
                t={t}
                editing={editing}
                run={run}
                openPath={openPath}
                onClose={() => { setEditing(undefined) }}
              />
            )
            : (
              <HubTab
                t={t}
                state={state}
                run={run}
                startEdit={startEdit}
                openPath={openPath}
                goDiscover={() => { setTab('discover') }}
              />
            )
        )}
        {tab === 'discover' && <DiscoverTab t={t} state={state} run={run} browseDirs={api?.browseDirs} />}
      </div>
    </div>
  )
}

interface TabCommon {
  t: T
  run: (command: HubCommand) => Promise<HubCommandResult>
}

/** 身份徽标集合。 */
function modeTags(t: T, skill: HubSkill): { text: string, kind?: string, title?: string }[] {
  const tags: { text: string, kind?: string, title?: string }[] = []
  if (skill.broken) tags.push({ text: t('tag.broken'), kind: 'broken', title: t('tag.brokenTitle', { path: skill.sourcePath }) })
  else if (skill.mode === 'link') tags.push({ text: t('tag.link', { path: shortPath(skill.sourcePath) }), kind: 'link', title: skill.sourcePath })
  else if (skill.mode === 'copy') tags.push({ text: t('tag.copy'), title: skill.sourcePath === '' ? undefined : t('tag.copyTitle', { path: skill.sourcePath }) })
  else tags.push({ text: t('tag.local') })
  // 「用户 + 模型可调用」是默认态,只标注非默认的收窄。
  if (skill.invocation === 'user') tags.push({ text: t('tag.userOnly') })
  if (skill.invocation === 'model') tags.push({ text: t('tag.modelOnly') })
  if (skill.resourceCount > 0) tags.push({ text: t('tag.resources', { count: skill.resourceCount }) })
  return tags
}

/** 一张全局技能卡:主操作「编辑」,次要操作收进 ⋯ 菜单。 */
function SkillCard({ t, skill, run, startEdit, openPath }: TabCommon & {
  skill: HubSkill
  startEdit: (skill: HubSkill) => Promise<void>
  openPath: ((path: string) => void) | undefined
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuItems = [
    { id: 'export', label: t('card.export') },
    ...openPath !== undefined ? [{ id: 'open', label: t('card.openDir') }] : [],
    { id: 'copy-name', label: t('card.copyName', { name: skill.name }) },
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
          {modeTags(t, skill).map(tag => (
            <span key={tag.text} className="dsh-skh-tag" data-kind={tag.kind} title={tag.title}>{tag.text}</span>
          ))}
        </span>
        <span className="dsh-skh-rowActions">
          {!skill.broken && <Button size="sm" variant="outline" onClick={() => void startEdit(skill)}>{t('card.edit')}</Button>}
          {!skill.broken && (
            <Menu
              open={menuOpen}
              anchor={<Button size="sm" variant="outline" aria-label={t('card.more')} onClick={() => { setMenuOpen(value => !value) }}>⋯</Button>}
              items={menuItems}
              onSelect={onMenuSelect}
              onClose={() => { setMenuOpen(false) }}
              align="end"
            />
          )}
          <ConfirmButton
            t={t}
            label={skill.mode === 'link' ? t('card.removeLink') : t('card.delete')}
            confirmLabel={skill.mode === 'link' ? t('card.removeLinkConfirm') : t('card.deleteConfirm')}
            onConfirm={() => { void run({ action: 'delete', name: skill.name }).catch(() => undefined) }}
          />
        </span>
      </div>
      {!skill.broken && <ClampedDescription t={t} text={skill.description} />}
      {skill.broken
        ? <p className="dsh-skh-meta" data-tone="error">{t('card.brokenNote', { path: shortPath(skill.sourcePath) })}</p>
        : skill.addedAt !== '' ? <p className="dsh-skh-meta">{t('card.addedAt', { date: fmtDate(skill.addedAt) })}</p> : null}
    </li>
  )
}

/** 内联新建卡(粘贴创建;显示在列表上方,不用滚动)。 */
function CreateCard({ t, run, onDone }: TabCommon & { onDone: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  return (
    <section className="dsh-skh-editor">
      <div className="dsh-skh-blockTitle">{t('create.title')}</div>
      <p className="dsh-skh-intro">{t('create.intro')}</p>
      <div className="dsh-skh-field">
        <label className="dsh-skh-fieldLabel" htmlFor="dsh-skh-new-name">{t('create.nameLabel')}</label>
        <input id="dsh-skh-new-name" className="dsh-skh-input" placeholder="my-skill"
          value={name} onChange={event => setName(event.target.value)} />
      </div>
      <div className="dsh-skh-field">
        <label className="dsh-skh-fieldLabel" htmlFor="dsh-skh-new-desc">{t('create.descLabel')}</label>
        <input id="dsh-skh-new-desc" className="dsh-skh-input" placeholder={t('create.descPlaceholder')}
          value={description} onChange={event => setDescription(event.target.value)} />
      </div>
      <div className="dsh-skh-field">
        <label className="dsh-skh-fieldLabel" htmlFor="dsh-skh-new-body">{t('create.bodyLabel')}</label>
        <textarea id="dsh-skh-new-body" className="dsh-skh-textarea"
          placeholder={t('create.bodyPlaceholder')}
          value={content} onChange={event => setContent(event.target.value)} />
      </div>
      <div className="dsh-skh-editorActions">
        <Button size="sm" variant="outline" onClick={onDone}>{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" disabled={content.trim() === ''} onClick={() => {
          void run({ action: 'importPaste', name, description, content })
            .then(() => { onDone() })
            .catch(() => undefined)
        }}>{t('create.submit')}</Button>
      </div>
    </section>
  )
}

function HubTab({ t, state, run, startEdit, openPath, goDiscover }: TabCommon & {
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
        {creating ? t('hub.collapse') : t('hub.new')}
      </Button>
      <label>
        <input type="file" accept=".skill,.zip" style={{ display: 'none' }}
          onChange={event => { onPickArchive(event.target.files?.[0]); event.target.value = '' }} />
        <Button size="sm" variant="outline" onClick={event => {
          (event.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null)?.click()
        }}>{t('hub.upload')}</Button>
      </label>
      {list.length > 5 && (
        <input className="dsh-skh-filter" placeholder={t('hub.filter')} aria-label={t('hub.filter')}
          value={filter} onChange={event => setFilter(event.target.value)} />
      )}
    </div>
    {creating && <CreateCard t={t} run={run} onDone={() => { setCreating(false) }} />}
    {list.length === 0 && !creating
      ? (
        <p className="dsh-skh-empty">
          {t('hub.empty')}
          {discoverCount > 0 && (
            <Button size="sm" variant="primary" onClick={goDiscover}>{t('hub.goDiscover', { count: discoverCount })}</Button>
          )}
        </p>
      )
      : shown.length === 0 && filter !== ''
        ? <p className="dsh-skh-empty">{t('filter.noMatch', { filter })}</p>
        : (
          <ul className="dsh-skh-cards">
            {shown.map(skill => (
              <SkillCard key={skill.name} t={t} skill={skill} run={run} startEdit={startEdit} openPath={openPath} />
            ))}
          </ul>
        )}
  </>
}

/** SKILL.md 编辑器:脏态守卫 + Cmd/Ctrl+S,保存后停留;引用技能明示写穿来源。 */
function SkillEditor({ t, editing, run, openPath, onClose }: TabCommon & {
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
        <span className="dsh-skh-editorTitle">{t('editor.title', { name: skill.name })}</span>
        {openPath !== undefined && (
          <button type="button" className="dsh-skh-link" onClick={() => {
            openPath(skill.mode === 'link' && skill.sourcePath !== '' ? skill.sourcePath : skill.dir)
          }}>{t('card.openDir')}</button>
        )}
      </div>
      {skill.mode === 'link' && (
        <span className="dsh-skh-editorNote">{t('editor.linkNote', { path: skill.sourcePath })}</span>
      )}
      {skill.resourceCount > 0 && (
        <span className="dsh-skh-editorNote">{t('editor.resourceNote', { count: skill.resourceCount })}</span>
      )}
    </div>
    <textarea
      className="dsh-skh-textarea"
      aria-label={t('editor.aria', { name: skill.name })}
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
      {dirty && <span className="dsh-skh-dirty">{t('editor.dirty')}</span>}
      {confirmDiscard
        ? (
          <>
            <Button size="sm" variant="primary" onClick={() => { save(); onClose() }}>{t('editor.saveAndClose')}</Button>
            <Button size="sm" variant="ghost" className="dsh-skh-danger" onClick={onClose}>{t('editor.discard')}</Button>
            <Button size="sm" variant="outline" onClick={() => { setConfirmDiscard(false) }}>{t('editor.continue')}</Button>
          </>
        )
        : (
          <>
            <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>{t('editor.save')}</Button>
            <Button size="sm" variant="outline" onClick={requestClose}>{dirty ? t('editor.closeDirty') : t('editor.close')}</Button>
          </>
        )}
    </div>
  </div>
}

/** 发现页:来源 chips(内联管理)+ 目录选择器 + 扫描结果(引用/复制/批量)。 */
function DiscoverTab({ t, state, run, browseDirs }: TabCommon & {
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
    <div className="dsh-skh-chips" aria-label={t('discover.scanDirs')}>
      <span className="dsh-skh-meta">{t('discover.scanDirsLabel')}</span>
      {sources.map(info => (
        <span key={info.path} className="dsh-skh-chip" data-missing={info.exists ? undefined : 'true'}
          title={info.exists
            ? t('discover.chipTitle', { path: info.path, count: info.skillCount })
            : t('discover.chipMissing', { path: info.path })}>
          <code>{info.path}</code>
          <span className="dsh-skh-chip-count">{info.exists ? info.skillCount : t('discover.missing')}</span>
          <button type="button" className="dsh-skh-chip-remove" aria-label={t('discover.removeSource', { path: info.path })}
            onClick={() => { saveSources(sources.filter(other => other.path !== info.path).map(other => other.path)) }}>✕</button>
        </span>
      ))}
      {!addingSource && <Button size="sm" variant="outline" onClick={() => { setAddingSource(true) }}>{t('discover.addDir')}</Button>}
    </div>
    {addingSource && (
      <SourcePicker t={t} browseDirs={browseDirs} onAdd={addSource} onClose={() => { setAddingSource(false) }} />
    )}
    <div className="dsh-skh-toolbar">
      {discoverable.length > 5 && (
        <input className="dsh-skh-filter" placeholder={t('discover.filter')} aria-label={t('discover.filter')}
          value={filter} onChange={event => setFilter(event.target.value)} />
      )}
      {linkable.length > 1 && (
        <Button size="sm" variant="outline" onClick={() => {
          void run({ action: 'importLinkBatch', sourcePaths: linkable.map(item => item.sourcePath) }).catch(() => undefined)
        }}>{t('discover.linkAll', { count: linkable.length })}</Button>
      )}
    </div>
    <p className="dsh-skh-intro">
      {t('discover.introPre')}<b>{t('discover.link')}</b>{t('discover.introMid')}<b>{t('discover.copy')}</b>{t('discover.introPost')}
    </p>
    {discoverable.length === 0
      ? <p className="dsh-skh-empty">{t('discover.empty')}</p>
      : shown.length === 0
        ? <p className="dsh-skh-empty">{t('filter.noMatch', { filter })}</p>
        : (
          <ul className="dsh-skh-cards">
            {shown.map(item => (
              <li key={item.sourcePath} className="dsh-skh-rowCard">
                <div className="dsh-skh-rowHead">
                  <span className="dsh-skh-rowIdentity">
                    <span className="dsh-skh-rowName"><code>/{item.name}</code></span>
                    {item.kind === 'archive' && <span className="dsh-skh-tag">{t('discover.archiveOnly')}</span>}
                  </span>
                  <span className="dsh-skh-rowActions">
                    {item.kind !== 'archive' && (
                      <Button size="sm" variant="primary" onClick={() => {
                        void run({ action: 'importLink', sourcePath: item.sourcePath }).catch(() => undefined)
                      }}>{t('discover.link')}</Button>
                    )}
                    <Button size="sm" variant={item.kind === 'archive' ? 'primary' : 'outline'} onClick={() => {
                      void run({ action: 'importCopy', sourcePath: item.sourcePath }).catch(() => undefined)
                    }}>{t('discover.copy')}</Button>
                  </span>
                </div>
                <ClampedDescription t={t} text={item.description} />
                <p className="dsh-skh-meta">{shortPath(item.sourcePath)}</p>
              </li>
            ))}
          </ul>
        )}
  </>
}

/** 目录选择器:常见位置一键添加 + 逐级浏览 + 手输兜底。 */
function SourcePicker({ t, browseDirs, onAdd, onClose }: {
  t: T
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
      .catch(() => { setError(t('picker.browseFailed', { path: dirPath === '' ? '~' : dirPath })) })
  }, [browseDirs, t])

  useEffect(() => { browse('') }, [browse])

  /** 当前视图下某子目录的展示路径(~ 形式,直接可存为来源)。 */
  const childPath = (name: string): string =>
    view === undefined ? name : view.display === '~' ? `~/${name}` : `${view.display}/${name}`

  return (
    <section className="dsh-skh-editor">
      <div className="dsh-skh-blockTitle">
        {t('picker.title')}
        <span style={{ marginLeft: 'auto' }} />
        <Button size="sm" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
      {view?.suggestions !== undefined && view.suggestions.length > 0 && (
        <div className="dsh-skh-chips">
          <span className="dsh-skh-meta">{t('picker.common')}</span>
          {view.suggestions.map(item => (
            <button key={item.path} type="button" className="dsh-skh-chip" style={{ cursor: 'pointer' }}
              title={t('picker.addTitle', { path: item.path })} onClick={() => { onAdd(item.path) }}>
              <code>{item.path}</code>
              <span className="dsh-skh-chip-count">{t('picker.skillCount', { count: item.skillCount })}</span>
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
              onClick={() => { if (view.parent !== undefined) browse(view.parent) }}>{t('picker.parent')}</Button>
            <span className="dsh-skh-meta" style={{ flex: 1, overflowWrap: 'anywhere' }}><code>{view.display}</code></span>
            <Button size="sm" variant="primary" onClick={() => { onAdd(view.display) }}>{t('picker.addCurrent')}</Button>
          </div>
          <ul className="dsh-skh-cards" style={{ gap: 2, maxHeight: 260, overflowY: 'auto' }}>
            {view.dirs.length === 0 && <li className="dsh-skh-empty">{t('picker.noSubdirs')}</li>}
            {view.dirs.map(dir => (
              <li key={dir.name} className="dsh-skh-rowHead" style={{ padding: '4px 6px' }}>
                <button type="button" className="dsh-skh-link" style={{ fontSize: 13 }}
                  onClick={() => { browse(`${view.display === '~' ? '~' : view.display}/${dir.name}`) }}>
                  {dir.name}/
                </button>
                {dir.skillCount > 0 && <span className="dsh-skh-tag">{t('picker.skillCount', { count: dir.skillCount })}</span>}
                <span className="dsh-skh-rowActions">
                  <Button size="sm" variant={dir.skillCount > 0 ? 'primary' : 'outline'}
                    onClick={() => { onAdd(childPath(dir.name)) }}>{t('picker.add')}</Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="dsh-skh-addRow">
        <input className="dsh-skh-filter" style={{ flex: 1 }} placeholder={t('picker.manualPlaceholder')}
          aria-label={t('picker.manualAria')} value={manual}
          onChange={event => setManual(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && manual.trim() !== '') onAdd(manual) }} />
        <Button size="sm" variant="outline" disabled={manual.trim() === ''} onClick={() => { onAdd(manual) }}>{t('picker.add')}</Button>
      </div>
    </section>
  )
}
