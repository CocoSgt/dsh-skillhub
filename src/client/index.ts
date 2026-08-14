/**
 * dsh-skill-hub 的浏览器端 half(React 设置页)。
 *
 * 管理面板注册进官方设置域的 settings.section 槽(与 Models / Plugins
 * 同级的导航页)。数据通道:宿主 skillHub 网关的 typert RPC——$mount
 * 手写描述符(src 直调,identity 编解码,负载由宿主校验),此前的
 * 3180–3189 端口探测 sidecar 已移除。「打开目录」走官方 host.openPath。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 类型边界:'settings.section' 的 SlotMap 声明(ui-settings 的 declare
// module 合并)。仅类型,编译后擦除。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { BrowseResult, HubCommand, HubCommandResult, HubState } from '../index.js'
import { SkillHubSection } from './SkillHubSection.tsx'

export { SkillHubSection } from './SkillHubSection.tsx'

/** ctx.locale 的最小面:注册词典 + 绑定翻译函数(官方设置页同一机制)。 */
interface LocaleFace {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(ns: string): (key: string) => string
}

/** 词典命名空间。 */
const NS = 'dsh-skill-hub'

const en = { nav: 'Skills' }
const zh = { nav: '技能' }

interface ApiClient {
  host: {
    openPath(payload: { path: string }): Promise<unknown>
  }
}

interface ConnectionHandle {
  api: ApiClient
}

/** RPC 结果的共用外形。 */
type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** skillHub 命名空间挂载后的调用面。 */
interface SkillHubCalls {
  getState(): Promise<RpcResult<HubState>>
  runCommand(command: HubCommand): Promise<RpcResult<HubCommandResult>>
  browseDirs(dirPath: string): Promise<RpcResult<BrowseResult>>
}

/** ctx.remote 的最小面。 */
interface RemoteFace {
  $mount(contribution: { package: string; descriptors: readonly unknown[] }): Promise<() => Promise<void>>
  skillHub: SkillHubCalls
}

/** identity 编解码:负载原样过 wire,校验交给宿主端。 */
const passCodec = (typeSymbol: string) => ({ mode: 'strict' as const, typeSymbol, schema: { parse: (value: unknown) => value } })

const DESCRIPTORS = [
  {
    id: 'dsh-skill-hub#skillHub/getState',
    service: 'skillHub',
    namespace: 'skillHub',
    method: 'getState',
    invocation: { kind: 'direct' as const },
    parameters: [],
    result: passCodec('dsh-skill-hub#HubState'),
  },
  {
    id: 'dsh-skill-hub#skillHub/browseDirs',
    service: 'skillHub',
    namespace: 'skillHub',
    method: 'browseDirs',
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'dirPath', wire: 'dirPath', source: 'json' as const, codec: passCodec('dsh-skill-hub#DirPath') }],
    result: passCodec('dsh-skill-hub#BrowseResult'),
  },
  {
    id: 'dsh-skill-hub#skillHub/runCommand',
    service: 'skillHub',
    namespace: 'skillHub',
    method: 'runCommand',
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'command', wire: 'command', source: 'json' as const, codec: passCodec('dsh-skill-hub#HubCommand') }],
    result: passCodec('dsh-skill-hub#HubCommandResult'),
  },
]

function unwrap<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`${result.error.code}: ${result.error.message}`)
}

/** 依赖的服务:槽系统、remote 挂载面。connection / locale 惰性获取。 */
export const inject = ['slots', 'remote']

/**
 * 客户端插件体:挂载 RPC 描述符,把技能中枢面板注册为设置导航页。
 * @param ctx - 客户端根上下文。
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const remote = (ctx as unknown as { remote: RemoteFace }).remote
  const disposeRemote = await remote.$mount({ package: 'dsh-skill-hub', descriptors: DESCRIPTORS })
  ctx.effect(() => () => { void disposeRemote() }, 'dsh-skill-hub: 远端描述符挂载')

  let calls: SkillHubCalls | undefined
  ctx.inject(['remote', 'remote.skillHub'], (namespaceCtx: ClientContext): void => {
    calls = (namespaceCtx as unknown as { remote: RemoteFace }).remote.skillHub
  })

  const api = {
    getState: async (): Promise<HubState> => {
      if (calls === undefined) throw new Error('skillHub 服务未就绪')
      return unwrap(await calls.getState())
    },
    runCommand: async (command: HubCommand): Promise<HubCommandResult> => {
      if (calls === undefined) throw new Error('skillHub 服务未就绪')
      return unwrap(await calls.runCommand(command))
    },
    browseDirs: async (dirPath: string): Promise<BrowseResult> => {
      if (calls === undefined) throw new Error('skillHub 服务未就绪')
      return unwrap(await calls.browseDirs(dirPath))
    },
  }

  const openPath = (path: string): void => {
    try {
      const connection = ctx.get('connection') as ConnectionHandle | undefined
      void connection?.api.host.openPath({ path }).catch(() => undefined)
    } catch { /* connection 未就绪时静默忽略 */ }
  }

  // 导航标签走官方 locale 服务:英文界面显示 Skills,中文显示 技能。
  ctx.inject(['locale'], (localeCtx: ClientContext) => {
    const locale = (localeCtx as unknown as { locale: LocaleFace }).locale
    ctx.effect(() => {
      const dispose = locale.register(NS, { zh, en })
      return () => { if (typeof dispose === 'function') dispose() }
    }, 'dsh-skill-hub: 词典注册')
    const t = locale.bind(NS)
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'skills',
      order: 25,
      label: () => t('nav'),
      inject: () => ({ openPath, api }),
    }, SkillHubSection))
  })
}
