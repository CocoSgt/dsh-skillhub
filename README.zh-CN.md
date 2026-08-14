# dsh-skillhub

简体中文 | [English](README.md)

npm 包名:`dsh-skillhub` · GitHub 仓库:
[CocoSgt/dsh-skillhub](https://github.com/CocoSgt/dsh-skillhub)

DeepSeek Harness(dsh)的第三方技能中枢:**把散落各处的技能汇成全局库**。
Claude Code 的 `~/.claude/skills`、项目目录、`.skill` 包……统一入库到
`~/.dsh/skills`(官方 skill-filesystem 的默认扫描根,watcher 实时),入库即
出现在输入框的「/」斜杠菜单。设置页里的「技能」导航页。

## 两种入库身份

| | 引用(推荐) | 副本 |
| --- | --- | --- |
| 实现 | `skills/<name>` → 来源的**符号链接** | 整树拷贝 |
| 同步 | **不存在同步问题**:只有一份文件,编辑即编辑来源 | 与来源独立演化(state 记录来源备查) |
| 来源删了 | 面板标注「引用失效」,一键移除(不动来源) | 无影响 |
| 适用 | 来源长期存在且归你维护 | 来源临时(.skill 包、要删的仓库),或想改全局版不动来源 |

harness 的技能扫描、fs 提供者与 watcher 都原生跟随符号链接(实测
skill-filesystem 的 `nodeEntryKind` 显式处理),引用无需任何补丁,且在
全部加载形态(含 SDK/ACP,插件装不进去的那些)下生效。

## 概念对齐 harness 现实

- **没有「安装」这回事**:技能放进扫描根即生效。本页管理的是全局库
  (`~/.dsh/skills`,rank 400,对所有会话生效);项目目录里的技能
  (`.dsh/skills`、`.agents/skills`,rank 100/200)由 harness 直接扫描,
  不经过本页——它们「一直可调用」正是这个原因,同名时项目技能优先。
- **技能是文件树,不是一个 MD**:编辑器只编辑 `SKILL.md` 并明示还有几个
  资源文件;资源用「打开目录」管理。导出 .skill 整树打包(引用则解引用
  打包真实文件)。
- **编辑引用 = 编辑来源**:编辑器头部黄字明示,保存直接写入来源文件。

## 页签

1. **全局技能**:页首动作行「＋ 新建技能」(内联展开,不用滚动)与
   「上传 .skill」(选完文件即入库,无中间确认步);技能多时有筛选框。
   每张卡:身份徽标(`引用 → 来源` / `副本` / `本地创建` / `引用失效`)、
   资源文件数、非默认调用策略;描述默认 3 行折叠(点击展开);主操作
   「编辑 SKILL.md」,导出/打开目录/复制名收进 ⋯ 菜单,删除行内两步确认
   (引用只删链接)。
2. **发现**:页首「扫描目录」chips 内联管理(每个 chip 标注技能数或
   「不存在」,✕ 即时移除,＋ 就地添加——不再有独立的「来源」页签);
   扫描结果每项「引用」(主)/「复制」,「全部引用」走单次批量 RPC;
   结果多时有筛选框。

## 架构

- **宿主端**(`lib/index.mjs`):`SkillHubGateway` 继承 `TypertRemoteService`,
  暴露 `skillHub/getState|runCommand|browseDirs` 三个 RPC(browseDirs 供
  来源选择器逐级浏览目录;runCommand 负载为命令联合,src-json 过 wire)。
  此前的 3180–3189 端口探测 sidecar HTTP 服务已移除。第三方双副本场景下
  SRC 发现失明,同时注册弱清单进宿主 typert registry。
- **浏览器端**(`lib/client.js`):$mount identity 编解码描述符 →
  `ctx.remote.skillHub`;面板注册 `settings.section` 槽,「打开目录」走官方
  `host.openPath`。
- **国际化**:全部可见文案经官方 locale 服务渲染。zh/en 词典在
  `src/client/locales.ts`;槽位注册声明 `locale: NS`,框架向组件 props 注入
  随语言切换重推导的 `t` 席位。宿主 runCommand 结果携带稳定 `code`
  (如 `import.linked`、`err.read.notFound`)与可选 `params`、显式
  `level: 'error'`;客户端按 code 取本地化文案、取不到回退中文
  `message`,状态行语气按 `level` 判定,不再对文案做正则猜测。

state 文件 `~/.dsh/skills/.skill-manager.json` 记录来源配置与每个技能的
`{mode, source, addedAt}`(为二期漂移检测预留 schema)。文件名沿用旧
skill-manager 的命名,已有安装的状态得以保留。

## 安装

从 npm 安装:

```sh
dsh plugin --profile web add dsh-skillhub
```

三个 dsh 插件可以一条命令一起安装:

```sh
dsh plugin --profile web add dsh-skillhub dsh-attachments dsh-context-inspector
```

GitHub 回退方式:

```sh
dsh plugin --profile web add github:CocoSgt/dsh-skillhub
```

安装后重启 `dsh web`。卸载:`dsh plugin --profile web remove dsh-skillhub`。

## 已知限制

- 副本与来源的漂移检测/拉取/推回是二期;本期副本只记录来源不判定漂移。
- Windows 上目录引用用 junction;文件级引用无特权时自动退化为复制并如实提示。
- 引用技能的库内链接名固定于入库时刻;来源 frontmatter 改名后技能名跟着
  来源走,链接名不自动更新(无害,仅目录名与技能名不一致)。
- 「全部引用」串行执行,失败逐条收集汇总(只展示首条,不刷屏)。
- 少数底层失败的宿主报错(如 zip 损坏细节)以 `{message}` 参数透传,
  英文界面下仍显示中文片段。

## 开发

```sh
pnpm install
pnpm run check   # tsc --noEmit
pnpm run build   # tsdown(宿主 ESM + 浏览器 bundle)
```

注意:宿主方法参数名就是 RPC wire 字段名(Gateway SRC 模式),构建不得
压缩改写参数名。

## 许可

MIT
