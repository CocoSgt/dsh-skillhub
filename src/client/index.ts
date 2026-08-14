/**
 * dsh-skill-manager 的浏览器端 half（React 设置页）。
 *
 * 管理面板注册进官方设置域的 settings.section 槽（与 Models / Plugins
 * 同级的导航页），不再使用独立浮动入口：
 * - 已安装：编辑 / 保存 / 删除（回收站）/ 打开目录 / 复制 /名称。
 * - 可导入：从配置的来源目录（默认 ~/.claude/skills）一键导入。
 * - 粘贴导入：名称 + 描述 + 正文直接落为标准 SKILL.md。
 * - 来源：管理来源目录列表。
 *
 * 数据通道：本插件宿主 half 的环回 sidecar HTTP 服务（官方 RPC map 对第
 * 三方固定，settings 线上面有白名单围栏）。面板按 3180–3189 的顺序探测
 * GET /ping 定位服务。「打开目录」走官方 host.openPath RPC。导入的技能由
 * 官方 skill-filesystem 自动发现，随即出现在 `/` 斜杠菜单中。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 类型边界：'settings.section' 的 SlotMap 声明（ui-settings 的 declare
// module 合并）。仅类型，编译后擦除。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkillManagerSection } from './SkillManagerSection.tsx'

export { SkillManagerSection } from './SkillManagerSection.tsx'

/** ctx.locale 的最小面：注册词典 + 绑定翻译函数(官方设置页同一机制)。 */
interface LocaleFace {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(ns: string): (key: string) => string
}

/** 词典命名空间。 */
const NS = 'dsh-skill-manager'

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

/** 依赖的服务：槽系统（settings.section 注册）。connection 惰性获取。 */
export const inject = ['slots']

/**
 * 客户端插件体：把技能管理面板注册为设置里的一个独立导航页。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  const openPath = (path: string): void => {
    try {
      const connection = ctx.get('connection') as ConnectionHandle | undefined
      void connection?.api.host.openPath({ path }).catch(() => undefined)
    } catch { /* connection 未就绪时静默忽略 */ }
  }

  // 导航标签走官方 locale 服务:英文界面显示 Skills,中文显示 技能。
  // 动态 inject:locale 由 ui-settings-general 等官方包提供,web shell 必有;
  // 组合里万一缺席也只是本页不注册,不阻塞 boot。
  ctx.inject(['locale'], (localeCtx: ClientContext) => {
    const locale = (localeCtx as unknown as { locale: LocaleFace }).locale
    ctx.effect(() => {
      const dispose = locale.register(NS, { zh, en })
      return () => { if (typeof dispose === 'function') dispose() }
    }, 'dsh-skill-manager: 词典注册')
    const t = locale.bind(NS)
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'skills',
      order: 25,
      label: () => t('nav'),
      inject: () => ({ openPath }),
    }, SkillManagerSection))
  })
}
