# dsh-skill-manager

DeepSeek Harness（dsh）第三方插件：**技能管理器**。在 dsh web 界面左下角提供「🧩 技能」入口，点开面板即可查看、导入、编辑、删除技能——导入的技能自动出现在输入框的 `/` 斜杠菜单中。

对标 Claude 网页版的技能管理器，入口更低层（直接管理本地 `SKILL.md` 文件）。

## 功能

- **已安装**：列出 `<dshHome>/skills` 下的全部技能（目录式 `<name>/SKILL.md` 与平铺式 `<name>.md`），显示描述、调用方式（用户/模型）、添加时间、导入来源；支持编辑（读取全文 → 面板内编辑 → 保存）、删除（移入 `<dshHome>/skill-trash` 回收站，可找回）、打开所在目录、复制 `/名称`。
- **可导入**：扫描配置的来源目录（默认 `~/.claude/skills`，即可直接导入本机 Claude 技能），一键导入。导入时走清洗管线（见下），剔除已安装同名项。
- **粘贴导入**：名称 + 描述 + 正文（裸 Markdown 或带 frontmatter 的完整 SKILL.md 均可）直接落为标准技能文件。
- **来源**：管理来源目录列表（每行一个，支持 `~`）。
- **斜杠调用**：导入即生效——`<dshHome>/skills` 是官方 skill-filesystem provider 的默认扫描根，`/技能名` 出现在输入框斜杠菜单中，无需任何额外接线。

### 清洗管线

导入/保存时对内容做结构清洗，但**保留全部功能字段**：

- 名称规范化为 kebab-case（`Demo Skill!!` → `demo-skill`）；与已安装冲突时自动追加 `-2`/`-3` 序号。
- 缺 `description` 时取正文第一行非标题文本充当（截断 200 字符）。
- `name`/`description` 之外的 frontmatter 键**原样保留**：`whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable` 及任何未知键。
- 产出统一为 `---\nname: …\ndescription: …\n（原样保留行）\n---\n\n正文` 的标准格式。

## 架构

双 half 单包结构（与官方外部插件模板一致）：

```
src/index.ts          宿主端 half（Node）：技能扫描/清洗/导入/编辑/删除 + 环回 sidecar HTTP
src/client/index.ts   浏览器 half（自渲染 DOM）：左下角入口 + 管理面板
cordis.patch.yml      bundle 层声明（向组合 insert 本插件）
```

### 数据通道：环回 sidecar

官方 RPC map 是构建期固定的，第三方插件不能注册新 RPC；`settings.*` 线上面也有命名空间白名单（只放行官方命名空间）。因此浏览器面板与宿主 half 之间使用插件自建的环回 HTTP 服务：

- 宿主 half 绑定 `127.0.0.1`，端口取 **3180–3189** 中第一个空闲位（官方 web 默认 3080，互不冲突）。
- 浏览器 half 打开面板时按相同顺序探测 `GET /ping` 完成发现。
- 端点：`GET /ping`（发现）、`GET /state`（状态 + 来源配置）、`POST /command`（全部操作，同步请求-响应）。
- **安全围栏**：只放行本机 Origin（`127.0.0.1` / `localhost` / `[::1]` 或无 Origin 的本机进程）且 Host 必须是环回地址——恶意网页的跨站请求与 DNS rebinding 均被拒绝；请求体上限 5 MB。
- `import` 命令的来源路径必须位于配置的来源目录内，拒绝任意路径读取；技能名经 kebab-case 规范化后天然不含 `/` 与 `..`。

状态与来源配置存于 `<dshHome>/skills/.skill-manager.json`（导入清单 `skills` + 来源 `sources`）。

## 安装

```sh
dsh plugin --profile web add <本仓库路径或 git URL>
```

随后正常启动 `dsh web`（或 `dsh --profile web`）即可。与其他插件独立加载、合并加载均互不依赖（端口冲突时自动顺延到 3181–3189）。

`$DSH_HOME` 环境变量可覆盖主目录（默认 `~/.dsh`），与官方 skill-filesystem provider 的解析规则一致。

## 开发

```sh
pnpm install
pnpm build          # tsdown：宿主 half（lib/index.mjs，esm）+ 浏览器 half（lib/client.js，__ModuleLoader__ 契约）
pnpm exec tsc --noEmit
node test/smoke.mjs # 端到端冒烟：发现 → 全部命令 → 安全围栏，11 组断言
```

## 已知限制

- **中文名称会被清洗掉**：kebab-case 规范化只保留 `[a-z0-9]`，纯中文名导入后会回退为 `skill`（建议导入前起一个拉丁名称）。
- 端口 3180–3189 全被占用时退到 OS 随机端口并告警，浏览器面板将无法自动发现（同一台机器跑 10 个以上 dsh 实例才会触发）。
- 编辑保存会重新走清洗管线：手工排版的 frontmatter 键顺序可能重排（`name`/`description` 固定在前，其余按键原样保留原顺序），正文首尾空白会被裁剪。
- 面板 UI 为自渲染 DOM（外部插件通行做法），跟随 dsh 的 CSS 变量但非 React 组件，与官方设置页观感可能略有差异。
- 未提供按目录批量导入；导入以技能为单位。
