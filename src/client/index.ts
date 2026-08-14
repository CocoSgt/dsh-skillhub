/**
 * dsh-skill-manager 的浏览器端 half（自渲染 DOM）。
 *
 * 左下角常驻「🧩 技能」入口，点开管理面板：
 * - 已安装：编辑 / 保存 / 删除（回收站）/ 打开目录 / 复制 /名称。
 * - 可导入：从配置的来源目录（默认 ~/.claude/skills）一键导入。
 * - 粘贴导入：名称 + 描述 + 正文直接落为标准 SKILL.md。
 * - 来源：管理来源目录列表。
 *
 * 数据通道：本插件宿主 half 的环回 sidecar HTTP 服务（官方 RPC map 对第
 * 三方固定，settings 线上面有白名单围栏）。面板按 3180–3189 的顺序探测
 * GET /ping 定位服务，随后同步请求-响应完成全部操作。「打开目录」走官方
 * host.openPath RPC。导入的技能由官方 skill-filesystem 自动发现，随即
 * 出现在 `/` 斜杠菜单中。
 */

interface ApiClient {
  host: {
    openPath(payload: { path: string }): Promise<unknown>
  }
}

interface ConnectionHandle {
  api: ApiClient
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
}

/** 与宿主 half 的 PORT_RANGE 保持一致。 */
const PORT_RANGE = Array.from({ length: 10 }, (_, i) => 3180 + i)

function h(tag: string, attrs: Record<string, unknown> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') el.className = String(value)
    else if (key === 'style') el.setAttribute('style', String(value))
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener)
    else if (value === true) el.setAttribute(key, '')
    else el.setAttribute(key, String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined) continue
    el.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return el
}

const CSS = `
#dsh-skm-launcher {
  position: fixed; left: 14px; bottom: 14px; z-index: 9000;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border: none; border-radius: 999px; cursor: pointer;
  font: 12px/1.4 system-ui, sans-serif; color: var(--dsw-alias-text-2, #bbb);
  background: var(--dsw-hovercard-bg, #2C2C2E);
  box-shadow: 0 2px 10px rgba(0,0,0,.25);
  transition: color .15s ease, transform .15s ease;
}
#dsh-skm-launcher:hover { color: var(--dsw-alias-text-1, #eee); transform: translateY(-1px); }
#dsh-skm-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.38);
}
#dsh-skm-panel {
  position: relative; width: min(760px, 92vw); max-height: 84vh; overflow-y: auto; box-sizing: border-box;
  padding: 16px 18px; border-radius: 14px; font: 13px/1.5 system-ui, sans-serif;
  color: var(--dsw-alias-text-1, #eee);
  background: var(--dsw-hovercard-bg, #2C2C2E);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 40px rgba(0,0,0,.4));
}
#dsh-skm-panel h3 { margin: 0; font-size: 14px; font-weight: 600; }
#dsh-skm-close {
  position: absolute; top: 10px; right: 12px; border: none; background: none;
  font-size: 16px; color: var(--dsw-alias-text-3, #999); cursor: pointer;
}
.dsh-skm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
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
  box-sizing: border-box; padding: 6px 8px; border-radius: 8px; font: 12px system-ui, sans-serif;
  color: var(--dsw-alias-text-1, #eee); background: rgba(0,0,0,.25);
  border: 1px solid rgba(128,128,140,.35); }
.dsh-skm-label { display: block; font-size: 12px; margin: 8px 0 4px; color: var(--dsw-alias-text-2, #bbb); }
.dsh-skm-block { width: 100%; }
`

export default {
  name: 'dsh-skill-manager-client',
  apply(ctx: { get(name: string): unknown, effect?(fn: () => () => void): unknown }) {
    if (typeof document === 'undefined' || document.body === null) return

    if (document.getElementById('dsh-skill-manager-style') === null) {
      const style = document.createElement('style')
      style.id = 'dsh-skill-manager-style'
      style.textContent = CSS
      document.head.append(style)
    }

    let overlay: HTMLElement | undefined
    let panelBody: HTMLElement | undefined
    let messageEl: HTMLElement | undefined
    let currentTab = 'installed'
    let status: StatusValue | undefined
    let sourcesText = ''
    /** read 命令取回的编辑内容；关闭编辑即丢弃。 */
    let editBody: { name: string, content: string } | undefined
    let busy = false

    const getConnection = (): ConnectionHandle | undefined => {
      try {
        return ctx.get('connection') as ConnectionHandle | undefined
      } catch {
        return undefined
      }
    }

    let base: string | undefined

    /** 探测环回 sidecar：按宿主 half 相同的端口顺序请求 /ping。 */
    async function findBase(): Promise<string> {
      if (base !== undefined) return base
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
              base = candidate
              return base
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

    async function refresh(): Promise<void> {
      const state = await apiGet<StateResponse>('/state')
      status = state.status
      sourcesText = state.sources.join('\n')
    }

    async function run(command: Record<string, unknown>): Promise<CommandResponse> {
      if (busy) throw new Error('上一个操作还在执行')
      busy = true
      setMessage('执行中…')
      try {
        const response = await apiPost<CommandResponse>('/command', command)
        if (response.status !== undefined) status = response.status
        setMessage(response.message ?? response.error ?? '')
        renderTab()
        return response
      } catch (error) {
        const text = `出错：${error instanceof Error ? error.message : String(error)}`
        setMessage(text)
        throw error
      } finally {
        busy = false
      }
    }

    function setMessage(text: string): void {
      if (messageEl !== undefined) messageEl.textContent = text
    }

    async function startEdit(skill: InstalledSkill): Promise<void> {
      setMessage(`正在读取「${skill.name}」…`)
      try {
        const response = await run({ action: 'read', name: skill.name })
        if (response.body !== undefined && response.body.name === skill.name) {
          editBody = response.body
          renderTab()
        } else {
          setMessage('读取失败：未收到内容')
        }
      } catch { /* run 已提示 */ }
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

    function actionBtn(label: string, onClick: () => void, extra?: string): HTMLElement {
      return h('button', { class: `dsh-skm-btn ${extra ?? ''}`, onClick }, label)
    }

    function renderInstalled(): void {
      const list = status?.installed ?? []
      if (list.length === 0) {
        panelBody!.replaceChildren(h('div', { class: 'dsh-skm-empty' }, '还没有已安装的技能。去「可导入」或「粘贴导入」添加一个吧。'))
        return
      }
      const rows = list.map(skill => {
        if (editBody !== undefined && editBody.name === skill.name) {
          const textarea = h('textarea', { class: 'dsh-skm-editor' }) as HTMLTextAreaElement
          textarea.value = editBody.content
          return h('div', { class: 'dsh-skm-main' },
            h('div', { class: 'dsh-skm-name' }, `编辑：${skill.name}`),
            textarea,
            h('div', { class: 'dsh-skm-actions' },
              actionBtn('保存', () => {
                const content = textarea.value
                editBody = undefined
                void run({ action: 'save', name: skill.name, content }).catch(() => undefined)
              }),
              actionBtn('取消', () => {
                editBody = undefined
                renderTab()
              })))
        }
        const actions = h('div', { class: 'dsh-skm-actions' },
          actionBtn('编辑', () => void startEdit(skill)),
          actionBtn('复制 /' + skill.name, () => {
            void navigator.clipboard?.writeText(`/${skill.name}`).catch(() => undefined)
          }),
          actionBtn('打开目录', () => {
            const dir = skill.file.split('/').slice(0, -1).join('/')
            const conn = getConnection()
            void conn?.api.host.openPath({ path: dir }).catch(() => undefined)
          }),
          actionBtn('删除', () => {
            if (window.confirm(`确定删除技能「${skill.name}」吗？（会移到 skill-trash 回收站）`)) {
              void run({ action: 'delete', name: skill.name }).catch(() => undefined)
            }
          }, 'danger'))
        const metaBits = [
          invocationLabel(skill.invocation),
          skill.addedAt !== '' ? `添加于 ${fmtDate(skill.addedAt)}` : '',
          skill.source !== '' ? `来源：${skill.source}` : '',
        ].filter(s => s !== '')
        return h('div', { class: 'dsh-skm-row' },
          h('div', { class: 'dsh-skm-main' },
            h('div', { class: 'dsh-skm-name' }, h('code', {}, `/${skill.name}`)),
            h('div', { class: 'dsh-skm-desc' }, skill.description),
            metaBits.length > 0 ? h('div', { class: 'dsh-skm-meta' }, metaBits.join(' · ')) : null),
          actions)
      })
      panelBody!.replaceChildren(...rows)
    }

    function renderImportable(): void {
      const list = status?.importable ?? []
      if (list.length === 0) {
        panelBody!.replaceChildren(h('div', { class: 'dsh-skm-empty' },
          '来源目录中没有可导入的新技能。可在「来源」页检查目录配置。'))
        return
      }
      panelBody!.replaceChildren(...list.map(skill => h('div', { class: 'dsh-skm-row' },
        h('div', { class: 'dsh-skm-main' },
          h('div', { class: 'dsh-skm-name' }, h('code', {}, `/${skill.name}`)),
          h('div', { class: 'dsh-skm-desc' }, skill.description),
          h('div', { class: 'dsh-skm-meta' }, skill.sourcePath)),
        h('div', { class: 'dsh-skm-actions' },
          actionBtn('导入', () => void run({ action: 'import', sourcePath: skill.sourcePath }).catch(() => undefined))))))
    }

    function renderPaste(): void {
      const nameInput = h('input', { class: 'dsh-skm-input', placeholder: 'my-skill（可留空，从内容推断）' }) as HTMLInputElement
      nameInput.style.width = '100%'
      const descInput = h('input', { class: 'dsh-skm-input', placeholder: '一句话描述（可留空，取正文首行）' }) as HTMLInputElement
      descInput.style.width = '100%'
      const textarea = h('textarea', { class: 'dsh-skm-editor dsh-skm-block' }) as HTMLTextAreaElement
      textarea.placeholder = '技能正文（Markdown）。也可以直接粘贴带 --- frontmatter 的完整 SKILL.md。'
      panelBody!.replaceChildren(
        h('label', { class: 'dsh-skm-label' }, '技能名称'),
        nameInput,
        h('label', { class: 'dsh-skm-label' }, '描述'),
        descInput,
        h('label', { class: 'dsh-skm-label' }, '内容'),
        textarea,
        h('div', { class: 'dsh-skm-actions' },
          actionBtn('导入', () => void run({
            action: 'importPaste',
            name: nameInput.value,
            description: descInput.value,
            content: textarea.value,
          }).catch(() => undefined))))
    }

    function renderSources(): void {
      const textarea = h('textarea', { class: 'dsh-skm-editor dsh-skm-block' }) as HTMLTextAreaElement
      textarea.value = sourcesText
      textarea.style.minHeight = '120px'
      panelBody!.replaceChildren(
        h('label', { class: 'dsh-skm-label' }, '来源目录（每行一个，支持 ~）'),
        textarea,
        h('div', { class: 'dsh-skm-actions' },
          actionBtn('保存并刷新', () => {
            const sources = textarea.value.split('\n').map(s => s.trim()).filter(s => s !== '')
            void run({ action: 'setSources', sources }).catch(() => undefined)
          })))
    }

    function renderTab(): void {
      if (panelBody === undefined) return
      if (currentTab === 'installed') renderInstalled()
      else if (currentTab === 'importable') renderImportable()
      else if (currentTab === 'paste') renderPaste()
      else renderSources()
    }

    function openPanel(): void {
      if (overlay !== undefined) {
        overlay.remove()
        overlay = undefined
      }
      editBody = undefined
      const tabs = [
        { id: 'installed', label: `已安装 (${status?.installed.length ?? 0})` },
        { id: 'importable', label: `可导入 (${status?.importable.length ?? 0})` },
        { id: 'paste', label: '粘贴导入' },
        { id: 'sources', label: '来源' },
      ]
      const tabButtons = tabs.map(tab => h('button', {
        class: `dsh-skm-tab ${tab.id === currentTab ? 'active' : ''}`,
        onClick: () => {
          currentTab = tab.id
          editBody = undefined
          for (const button of tabButtons) button.classList.remove('active')
          tabButtons[tabs.findIndex(t => t.id === tab.id)]?.classList.add('active')
          renderTab()
        },
      }, tab.label))
      messageEl = h('div', { class: 'dsh-skm-message' }, '')
      panelBody = h('div', {})
      const close = h('button', {
        id: 'dsh-skm-close',
        onClick: () => {
          overlay?.remove()
          overlay = undefined
        },
      }, '✕')
      const panel = h('div', { id: 'dsh-skm-panel' },
        h('div', { class: 'dsh-skm-head' }, h('h3', {}, '🧩 技能管理'), close),
        messageEl,
        h('div', { class: 'dsh-skm-tabs' }, ...tabButtons),
        panelBody)
      overlay = h('div', {
        id: 'dsh-skm-overlay',
        onClick: (event: Event) => {
          if (event.target === overlay) {
            overlay?.remove()
            overlay = undefined
          }
        },
      }, panel)
      document.body.append(overlay)
      setMessage('加载中…')
      renderTab()
      void refresh()
        .then(() => {
          setMessage('')
          renderTab()
        })
        .catch((error: unknown) => {
          setMessage(`加载失败：${error instanceof Error ? error.message : String(error)}`)
        })
    }

    const launcher = h('button', {
      id: 'dsh-skm-launcher',
      onClick: () => openPanel(),
    }, '🧩 技能')

    document.body.append(launcher)

    if (ctx.effect !== undefined) {
      ctx.effect(() => () => {
        launcher.remove()
        overlay?.remove()
      })
    }
  },
}
