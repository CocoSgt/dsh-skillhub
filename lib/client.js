window.__ModuleLoader__.load({
	id: "dsh-skillhub",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/** 词典命名空间。 */
		const NS = "dsh-skillhub";
		/** 简体中文词典(键集真源)。 */
		const zh = {
			"nav": "技能",
			"intro": "全局技能库(~/.dsh/skills):对所有会话生效,出现在输入框的「/」菜单。项目目录里的技能由 dsh 直接扫描生效,不经过此页。",
			"tabs.aria": "技能中枢页签",
			"tab.hub": "全局技能 ({count})",
			"tab.discover": "发现 ({count})",
			"status.loading": "加载中…",
			"status.running": "执行中…",
			"status.loadFailed": "加载失败:{msg}",
			"status.error": "出错:{msg}",
			"svc.unready": "skillHub 服务未就绪",
			"svc.busy": "上一个操作还在执行",
			"read.emptyBody": "读取失败:未收到内容",
			"common.cancel": "取消",
			"desc.expand": "点击展开",
			"desc.collapse": "点击收起",
			"tag.broken": "引用失效",
			"tag.brokenTitle": "来源已消失:{path}",
			"tag.link": "引用 → {path}",
			"tag.copy": "副本",
			"tag.copyTitle": "复制自 {path}",
			"tag.local": "本地创建",
			"tag.userOnly": "仅用户可调用",
			"tag.modelOnly": "仅模型可调用",
			"tag.resources": "{count} 个资源文件",
			"card.edit": "编辑 SKILL.md",
			"card.more": "更多操作",
			"card.export": "导出 .skill",
			"card.openDir": "打开目录",
			"card.copyName": "复制 /{name}",
			"card.removeLink": "移除引用",
			"card.removeLinkConfirm": "确认移除(不动来源)",
			"card.delete": "删除",
			"card.deleteConfirm": "确认删除(入回收站)",
			"card.brokenNote": "来源已消失:{path}(移除引用不会影响来源;若来源只是移动了位置,移除后到「发现」页重新引用)",
			"card.addedAt": "入库于 {date}",
			"create.title": "新建技能",
			"create.intro": "直接写内容;名称与描述可留空(自动从内容推断),也可以粘贴带 --- frontmatter 的完整 SKILL.md。",
			"create.nameLabel": "名称(可留空)",
			"create.descLabel": "描述(可留空)",
			"create.descPlaceholder": "这个技能什么时候用(留空取正文首行)",
			"create.bodyLabel": "技能正文(Markdown)",
			"create.bodyPlaceholder": "技能正文。示例:\n\n1. 打开 xxx\n2. 检查 yyy",
			"create.submit": "创建",
			"hub.new": "＋ 新建技能",
			"hub.collapse": "收起新建",
			"hub.upload": "上传 .skill",
			"hub.filter": "筛选技能…",
			"hub.empty": "全局库还是空的。",
			"hub.goDiscover": "去「发现」引用现有技能({count})",
			"filter.noMatch": "没有匹配「{filter}」的技能。",
			"editor.title": "编辑 SKILL.md:/{name}",
			"editor.linkNote": "⚠ 这是引用技能:保存会直接写入来源文件 {path}(在 Claude Code 等处同步可见)。",
			"editor.resourceNote": "此技能还有 {count} 个资源文件,这里只编辑 SKILL.md;资源用「打开目录」管理。",
			"editor.aria": "编辑 {name} 的 SKILL.md",
			"editor.dirty": "● 有未保存的修改",
			"editor.saveAndClose": "保存并关闭",
			"editor.discard": "放弃修改",
			"editor.continue": "继续编辑",
			"editor.save": "保存",
			"editor.closeDirty": "关闭…",
			"editor.close": "关闭",
			"discover.scanDirs": "扫描目录",
			"discover.scanDirsLabel": "扫描目录:",
			"discover.chipTitle": "{path}:{count} 个技能(含已入库)",
			"discover.chipMissing": "{path}:目录不存在或不可读",
			"discover.missing": "不存在",
			"discover.removeSource": "移除扫描目录 {path}",
			"discover.addDir": "＋ 目录",
			"discover.filter": "筛选可入库的技能…",
			"discover.linkAll": "全部引用({count})",
			"discover.introPre": "「",
			"discover.introMid": "」= 符号链接,一份文件两边生效,编辑即编辑来源(推荐);「",
			"discover.introPost": "」= 独立副本,与来源各自演化。入库即出现在「/」菜单。",
			"discover.empty": "扫描目录里没有可入库的新技能(已入库的不重复列出)。",
			"discover.archiveOnly": ".skill 包 · 仅可复制",
			"discover.link": "引用",
			"discover.copy": "复制",
			"picker.title": "选择扫描目录",
			"picker.common": "常见位置:",
			"picker.addTitle": "添加 {path}",
			"picker.skillCount": "{count} 个技能",
			"picker.parent": "↑ 上一级",
			"picker.addCurrent": "把这个目录加为来源",
			"picker.noSubdirs": "没有子目录。",
			"picker.add": "添加",
			"picker.manualPlaceholder": "或直接输入路径:~/some/skills",
			"picker.manualAria": "手动输入扫描目录",
			"picker.browseFailed": "无法读取目录:{path}",
			"rescan.done": "已刷新技能列表",
			"import.linked": "已引用「{name}」→ {path}(编辑即编辑来源;新会话立即可用,已打开的会话刷新页面后 / 菜单可见)",
			"import.linked.dup": "已引用「{name}」→ {path}(编辑即编辑来源;新会话立即可用,已打开的会话刷新页面后 / 菜单可见);注意:库里已有同名技能,同名时只有一个会生效",
			"import.fallbackCopy": "此平台无法创建文件符号链接,「{name}」已改为复制入库",
			"import.batch.empty": "批量引用:没有收到来源",
			"import.batch.done": "批量引用完成:{linked}/{total} 个入库",
			"import.batch.doneWithFail": "批量引用完成:{linked}/{total} 个入库;{failCount} 个失败({firstFail})",
			"import.copied": "已复制入库「{name}」(含全部资源文件)",
			"import.copiedMd": "已复制入库「{name}」",
			"import.created": "已创建技能「{name}」",
			"read.done": "已读取「{name}」",
			"save.done": "已保存「{name}」",
			"delete.removedLink": "已移除引用「{name}」(来源文件未动)",
			"delete.done": "已删除「{name}」(可在 skill-trash 目录找回)",
			"export.done": "已导出「{name}」为 .skill 包",
			"sources.saved": "已保存来源配置",
			"err.link.source": "引用失败:来源路径不在配置的来源目录内",
			"err.link.unreadable": "引用失败:无法读取来源",
			"err.link.archive": "打包技能(.skill)没有可引用的目录,请用「复制」入库",
			"err.link.symlink": "引用失败:{message}",
			"err.copy.source": "复制失败:来源路径不在配置的来源目录内",
			"err.copy.unreadable": "复制失败:无法读取来源",
			"err.copy.dir": "复制失败:拷贝技能目录出错",
			"err.copy.archive": "复制失败:{message}",
			"err.copy.readFile": "复制失败:无法读取来源文件",
			"err.archive.empty": "入库失败:没有收到文件内容",
			"err.archive.tooLarge": "入库失败:文件超过 {limitMb}MB 上限",
			"err.archive.invalid": "入库失败:{message}",
			"err.archive.extract": "入库失败:{message}",
			"err.paste.empty": "创建失败:内容为空",
			"err.read.invalid": "读取失败:技能名不合法",
			"err.read.notFound": "读取失败:找不到技能「{name}」",
			"err.save.invalid": "保存失败:技能名不合法",
			"err.save.notFound": "保存失败:找不到技能「{name}」",
			"err.delete.invalid": "删除失败:技能名不合法",
			"err.delete.notFound": "删除失败:找不到技能「{name}」",
			"err.export.invalid": "导出失败:技能名不合法",
			"err.export.notFound": "导出失败:找不到技能「{name}」",
			"err.export.noSkillMd": "导出失败:「{name}」缺少 SKILL.md",
			"err.export.failed": "导出失败:打包出错",
			"err.sources.invalid": "保存失败:来源目录列表不合法",
			"err.unknown": "未知命令"
		};
		/** 英文词典(键集与 zh 对齐,编译期校验)。 */
		const en = {
			"nav": "Skills",
			"intro": "Global skill library (~/.dsh/skills): applies to every session and shows up in the \"/\" menu of the input box. Skills inside project directories are picked up by dsh directly and are not managed on this page.",
			"tabs.aria": "Skill hub tabs",
			"tab.hub": "Global skills ({count})",
			"tab.discover": "Discover ({count})",
			"status.loading": "Loading…",
			"status.running": "Working…",
			"status.loadFailed": "Failed to load: {msg}",
			"status.error": "Error: {msg}",
			"svc.unready": "skillHub service is not ready",
			"svc.busy": "Another operation is still running",
			"read.emptyBody": "Read failed: no content received",
			"common.cancel": "Cancel",
			"desc.expand": "Click to expand",
			"desc.collapse": "Click to collapse",
			"tag.broken": "Broken link",
			"tag.brokenTitle": "Source is gone: {path}",
			"tag.link": "Link → {path}",
			"tag.copy": "Copy",
			"tag.copyTitle": "Copied from {path}",
			"tag.local": "Created locally",
			"tag.userOnly": "User-invocable only",
			"tag.modelOnly": "Model-invocable only",
			"tag.resources": "{count} resource files",
			"card.edit": "Edit SKILL.md",
			"card.more": "More actions",
			"card.export": "Export .skill",
			"card.openDir": "Open directory",
			"card.copyName": "Copy /{name}",
			"card.removeLink": "Remove link",
			"card.removeLinkConfirm": "Confirm removal (source untouched)",
			"card.delete": "Delete",
			"card.deleteConfirm": "Confirm delete (moved to trash)",
			"card.brokenNote": "Source is gone: {path} (removing the link never touches the source; if it merely moved, remove it and re-link from the Discover tab)",
			"card.addedAt": "Added {date}",
			"create.title": "New skill",
			"create.intro": "Write the body directly; name and description can stay empty (inferred from the content), or paste a full SKILL.md with --- frontmatter.",
			"create.nameLabel": "Name (optional)",
			"create.descLabel": "Description (optional)",
			"create.descPlaceholder": "When to use this skill (defaults to the first body line)",
			"create.bodyLabel": "Skill body (Markdown)",
			"create.bodyPlaceholder": "Skill body. Example:\n\n1. Open xxx\n2. Check yyy",
			"create.submit": "Create",
			"hub.new": "＋ New skill",
			"hub.collapse": "Collapse",
			"hub.upload": "Upload .skill",
			"hub.filter": "Filter skills…",
			"hub.empty": "The global library is empty.",
			"hub.goDiscover": "Link existing skills from Discover ({count})",
			"filter.noMatch": "No skills match \"{filter}\".",
			"editor.title": "Edit SKILL.md: /{name}",
			"editor.linkNote": "⚠ This is a linked skill: saving writes straight to the source file {path} (visible in Claude Code and elsewhere).",
			"editor.resourceNote": "This skill also has {count} resource files; only SKILL.md is edited here — manage resources via \"Open directory\".",
			"editor.aria": "Edit SKILL.md of {name}",
			"editor.dirty": "● Unsaved changes",
			"editor.saveAndClose": "Save and close",
			"editor.discard": "Discard changes",
			"editor.continue": "Keep editing",
			"editor.save": "Save",
			"editor.closeDirty": "Close…",
			"editor.close": "Close",
			"discover.scanDirs": "Scan directories",
			"discover.scanDirsLabel": "Scan directories:",
			"discover.chipTitle": "{path}: {count} skills (including imported)",
			"discover.chipMissing": "{path}: directory does not exist or is unreadable",
			"discover.missing": "missing",
			"discover.removeSource": "Remove scan directory {path}",
			"discover.addDir": "＋ Directory",
			"discover.filter": "Filter importable skills…",
			"discover.linkAll": "Link all ({count})",
			"discover.introPre": "\"",
			"discover.introMid": "\" = a symlink: one file on both sides, editing edits the source (recommended); \"",
			"discover.introPost": "\" = an independent copy that evolves separately. Importing makes it appear in the \"/\" menu.",
			"discover.empty": "No new importable skills in the scan directories (already-imported ones are not listed again).",
			"discover.archiveOnly": ".skill package · copy only",
			"discover.link": "Link",
			"discover.copy": "Copy",
			"picker.title": "Choose a scan directory",
			"picker.common": "Common locations:",
			"picker.addTitle": "Add {path}",
			"picker.skillCount": "{count} skills",
			"picker.parent": "↑ Up one level",
			"picker.addCurrent": "Add this directory as a source",
			"picker.noSubdirs": "No subdirectories.",
			"picker.add": "Add",
			"picker.manualPlaceholder": "Or type a path directly: ~/some/skills",
			"picker.manualAria": "Enter a scan directory manually",
			"picker.browseFailed": "Cannot read directory: {path}",
			"rescan.done": "Skill list refreshed",
			"import.linked": "Linked \"{name}\" → {path} (editing edits the source; available to new sessions immediately — reload an open session to see it in the / menu)",
			"import.linked.dup": "Linked \"{name}\" → {path} (editing edits the source; available to new sessions immediately — reload an open session to see it in the / menu); note: a skill with the same name already exists, only one of them takes effect",
			"import.fallbackCopy": "Cannot create file symlinks on this platform; \"{name}\" was imported as a copy instead",
			"import.batch.empty": "Batch link: no sources received",
			"import.batch.done": "Batch link complete: {linked}/{total} imported",
			"import.batch.doneWithFail": "Batch link complete: {linked}/{total} imported; {failCount} failed ({firstFail})",
			"import.copied": "Copied \"{name}\" into the library (with all resource files)",
			"import.copiedMd": "Copied \"{name}\" into the library",
			"import.created": "Created skill \"{name}\"",
			"read.done": "Read \"{name}\"",
			"save.done": "Saved \"{name}\"",
			"delete.removedLink": "Removed link \"{name}\" (source file untouched)",
			"delete.done": "Deleted \"{name}\" (recoverable in the skill-trash directory)",
			"export.done": "Exported \"{name}\" as a .skill package",
			"sources.saved": "Source configuration saved",
			"err.link.source": "Link failed: source path is not inside a configured source directory",
			"err.link.unreadable": "Link failed: cannot read the source",
			"err.link.archive": "A .skill package has no directory to link; import it as a copy instead",
			"err.link.symlink": "Link failed: {message}",
			"err.copy.source": "Copy failed: source path is not inside a configured source directory",
			"err.copy.unreadable": "Copy failed: cannot read the source",
			"err.copy.dir": "Copy failed: error copying the skill directory",
			"err.copy.archive": "Copy failed: {message}",
			"err.copy.readFile": "Copy failed: cannot read the source file",
			"err.archive.empty": "Import failed: no file content received",
			"err.archive.tooLarge": "Import failed: file exceeds the {limitMb} MB limit",
			"err.archive.invalid": "Import failed: {message}",
			"err.archive.extract": "Import failed: {message}",
			"err.paste.empty": "Create failed: content is empty",
			"err.read.invalid": "Read failed: invalid skill name",
			"err.read.notFound": "Read failed: skill \"{name}\" not found",
			"err.save.invalid": "Save failed: invalid skill name",
			"err.save.notFound": "Save failed: skill \"{name}\" not found",
			"err.delete.invalid": "Delete failed: invalid skill name",
			"err.delete.notFound": "Delete failed: skill \"{name}\" not found",
			"err.export.invalid": "Export failed: invalid skill name",
			"err.export.notFound": "Export failed: skill \"{name}\" not found",
			"err.export.noSkillMd": "Export failed: \"{name}\" has no SKILL.md",
			"err.export.failed": "Export failed: packaging error",
			"err.sources.invalid": "Save failed: invalid source directory list",
			"err.unknown": "Unknown command"
		};
		/** 槽位树之外的模块(挂载/RPC 包装层)用的绑定翻译。 */
		let bound;
		/** locale.bind(NS) 之后由插件体调用,使非槽位模块拿到随 locale 切换的 t。 */
		function setBoundT(t) {
			bound = t;
		}
		/** 模块级翻译:未绑定(宿主未注入 locale)时回退键名本身。 */
		function tr(key, params) {
			return bound !== void 0 ? bound(key, params) : key;
		}
		//#endregion
		//#region src/client/SkillHubSection.tsx
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
		function fmtDate(iso) {
			if (iso === "") return "";
			const date = new Date(iso);
			return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
		}
		/** 把 home 路径缩写为 ~ 形式(展示用,尽力而为)。 */
		function shortPath(p) {
			return p.replace(/^\/(Users|home)\/[^/]+/u, "~");
		}
		/** 状态行文本:键命中词典取译文,否则回退 fallback(都没有则显示键)。 */
		function statusText(t, line) {
			const translated = t(line.key, line.params);
			return translated === line.key && line.fallback !== void 0 ? line.fallback : translated;
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
`;
		/** base64 → Blob 下载 .skill 包。 */
		function downloadArchive(name, archiveBase64) {
			const bytes = Uint8Array.from(atob(archiveBase64), (char) => char.charCodeAt(0));
			const blob = new Blob([bytes], { type: "application/zip" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `${name}.skill`;
			anchor.click();
			URL.revokeObjectURL(url);
		}
		/** 行内两步确认按钮(替代 window.confirm;4 秒未确认自动收回)。 */
		function ConfirmButton(props) {
			const { t, label, confirmLabel, onConfirm } = props;
			const [arming, setArming] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!arming) return;
				const timer = setTimeout(() => {
					setArming(false);
				}, 4e3);
				return () => {
					clearTimeout(timer);
				};
			}, [arming]);
			return arming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				className: "dsh-skh-danger",
				onClick: onConfirm,
				children: confirmLabel
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "outline",
				onClick: () => {
					setArming(false);
				},
				children: t("common.cancel")
			})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				className: "dsh-skh-danger",
				onClick: () => {
					setArming(true);
				},
				children: label
			});
		}
		/** 可折叠描述:默认 3 行截断,点击展开/收起。 */
		function ClampedDescription({ t, text }) {
			const [clamped, setClamped] = (0, react.useState)(true);
			if (text === "") return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-skh-desc dsh-skh-md",
				"data-clamped": clamped ? "true" : void 0,
				title: clamped ? t("desc.expand") : t("desc.collapse"),
				onClick: () => {
					setClamped((value) => !value);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text })
			});
		}
		/** 技能中枢设置页组件。 */
		function SkillHubSection({ openPath, api, t }) {
			(0, react.useEffect)(() => {
				if (document.getElementById("dsh-skillhub-style") === null) {
					const style = document.createElement("style");
					style.id = "dsh-skillhub-style";
					style.textContent = CSS;
					document.head.append(style);
				}
			}, []);
			const [tab, setTab] = (0, react.useState)("hub");
			const [state, setState] = (0, react.useState)(void 0);
			const [status, setStatus] = (0, react.useState)({
				key: "status.loading",
				level: "idle"
			});
			const [editing, setEditing] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			const refresh = (0, react.useCallback)(async () => {
				if (api === void 0) throw new Error(tr("svc.unready"));
				setState(await api.getState());
			}, [api]);
			(0, react.useEffect)(() => {
				refresh().then(() => {
					setStatus({
						key: "",
						level: "idle"
					});
				}).catch((error) => {
					setStatus({
						key: "status.loadFailed",
						params: { msg: error instanceof Error ? error.message : String(error) },
						level: "error"
					});
				});
			}, [refresh]);
			const run = (0, react.useCallback)(async (command) => {
				if (api === void 0) throw new Error(tr("svc.unready"));
				if (busy) throw new Error(tr("svc.busy"));
				setBusy(true);
				setStatus({
					key: "status.running",
					level: "idle"
				});
				try {
					const result = await api.runCommand(command);
					setState(result.state);
					setStatus({
						key: result.code ?? "",
						params: result.params,
						fallback: result.message,
						level: result.level === "error" ? "error" : "idle"
					});
					return result;
				} catch (error) {
					setStatus({
						key: "status.error",
						params: { msg: error instanceof Error ? error.message : String(error) },
						level: "error"
					});
					throw error;
				} finally {
					setBusy(false);
				}
			}, [api, busy]);
			const startEdit = (0, react.useCallback)(async (skill) => {
				try {
					const response = await run({
						action: "read",
						name: skill.name
					});
					if (response.body !== void 0) setEditing({
						skill,
						content: response.body.content
					});
					else setStatus({
						key: "read.emptyBody",
						level: "error"
					});
				} catch {}
			}, [run]);
			const tabs = (0, react.useMemo)(() => [{
				id: "hub",
				label: t("tab.hub", { count: state?.skills.length ?? 0 })
			}, {
				id: "discover",
				label: t("tab.discover", { count: state?.discoverable.length ?? 0 })
			}], [state, t]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-skh-section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", {
						className: "dsh-skh-heading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSkillOutline16, { size: 16 }), t("nav")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-skh-intro",
						children: t("intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-skh-status",
						role: "status",
						"aria-live": "polite",
						"data-tone": status.level,
						children: statusText(t, status)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-skh-tabs",
						role: "tablist",
						"aria-label": t("tabs.aria"),
						children: tabs.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							className: "dsh-skh-tab",
							"aria-selected": tab === entry.id,
							"data-active": tab === entry.id ? "true" : void 0,
							onClick: () => {
								setTab(entry.id);
							},
							children: entry.label
						}, entry.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-panel",
						role: "tabpanel",
						children: [tab === "hub" && (editing !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillEditor, {
							t,
							editing,
							run,
							openPath,
							onClose: () => {
								setEditing(void 0);
							}
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HubTab, {
							t,
							state,
							run,
							startEdit,
							openPath,
							goDiscover: () => {
								setTab("discover");
							}
						})), tab === "discover" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiscoverTab, {
							t,
							state,
							run,
							browseDirs: api?.browseDirs
						})]
					})
				]
			});
		}
		/** 身份徽标集合。 */
		function modeTags(t, skill) {
			const tags = [];
			if (skill.broken) tags.push({
				text: t("tag.broken"),
				kind: "broken",
				title: t("tag.brokenTitle", { path: skill.sourcePath })
			});
			else if (skill.mode === "link") tags.push({
				text: t("tag.link", { path: shortPath(skill.sourcePath) }),
				kind: "link",
				title: skill.sourcePath
			});
			else if (skill.mode === "copy") tags.push({
				text: t("tag.copy"),
				title: skill.sourcePath === "" ? void 0 : t("tag.copyTitle", { path: skill.sourcePath })
			});
			else tags.push({ text: t("tag.local") });
			if (skill.invocation === "user") tags.push({ text: t("tag.userOnly") });
			if (skill.invocation === "model") tags.push({ text: t("tag.modelOnly") });
			if (skill.resourceCount > 0) tags.push({ text: t("tag.resources", { count: skill.resourceCount }) });
			return tags;
		}
		/** 一张全局技能卡:主操作「编辑」,次要操作收进 ⋯ 菜单。 */
		function SkillCard({ t, skill, run, startEdit, openPath }) {
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const menuItems = [
				{
					id: "export",
					label: t("card.export")
				},
				...openPath !== void 0 ? [{
					id: "open",
					label: t("card.openDir")
				}] : [],
				{
					id: "copy-name",
					label: t("card.copyName", { name: skill.name })
				}
			];
			const onMenuSelect = (id) => {
				setMenuOpen(false);
				if (id === "export") run({
					action: "export",
					name: skill.name
				}).then((response) => {
					if (response.archiveBase64 !== void 0) downloadArchive(skill.name, response.archiveBase64);
				}).catch(() => void 0);
				else if (id === "open" && openPath !== void 0) openPath(skill.mode === "link" && skill.sourcePath !== "" && !skill.broken ? skill.sourcePath : skill.dir);
				else if (id === "copy-name") navigator.clipboard?.writeText(`/${skill.name}`).catch(() => void 0);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-skh-rowCard",
				"data-broken": skill.broken ? "true" : void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-rowHead",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-skh-rowIdentity",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-skh-rowName",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", { children: ["/", skill.name] })
							}), modeTags(t, skill).map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-skh-tag",
								"data-kind": tag.kind,
								title: tag.title,
								children: tag.text
							}, tag.text))]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-skh-rowActions",
							children: [
								!skill.broken && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "outline",
									onClick: () => void startEdit(skill),
									children: t("card.edit")
								}),
								!skill.broken && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
									open: menuOpen,
									anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "outline",
										"aria-label": t("card.more"),
										onClick: () => {
											setMenuOpen((value) => !value);
										},
										children: "⋯"
									}),
									items: menuItems,
									onSelect: onMenuSelect,
									onClose: () => {
										setMenuOpen(false);
									},
									align: "end"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmButton, {
									t,
									label: skill.mode === "link" ? t("card.removeLink") : t("card.delete"),
									confirmLabel: skill.mode === "link" ? t("card.removeLinkConfirm") : t("card.deleteConfirm"),
									onConfirm: () => {
										run({
											action: "delete",
											name: skill.name
										}).catch(() => void 0);
									}
								})
							]
						})]
					}),
					!skill.broken && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ClampedDescription, {
						t,
						text: skill.description
					}),
					skill.broken ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-skh-meta",
						"data-tone": "error",
						children: t("card.brokenNote", { path: shortPath(skill.sourcePath) })
					}) : skill.addedAt !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-skh-meta",
						children: t("card.addedAt", { date: fmtDate(skill.addedAt) })
					}) : null
				]
			});
		}
		/** 内联新建卡(粘贴创建;显示在列表上方,不用滚动)。 */
		function CreateCard({ t, run, onDone }) {
			const [name, setName] = (0, react.useState)("");
			const [description, setDescription] = (0, react.useState)("");
			const [content, setContent] = (0, react.useState)("");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-skh-editor",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-skh-blockTitle",
						children: t("create.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-skh-intro",
						children: t("create.intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "dsh-skh-fieldLabel",
							htmlFor: "dsh-skh-new-name",
							children: t("create.nameLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "dsh-skh-new-name",
							className: "dsh-skh-input",
							placeholder: "my-skill",
							value: name,
							onChange: (event) => setName(event.target.value)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "dsh-skh-fieldLabel",
							htmlFor: "dsh-skh-new-desc",
							children: t("create.descLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "dsh-skh-new-desc",
							className: "dsh-skh-input",
							placeholder: t("create.descPlaceholder"),
							value: description,
							onChange: (event) => setDescription(event.target.value)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "dsh-skh-fieldLabel",
							htmlFor: "dsh-skh-new-body",
							children: t("create.bodyLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							id: "dsh-skh-new-body",
							className: "dsh-skh-textarea",
							placeholder: t("create.bodyPlaceholder"),
							value: content,
							onChange: (event) => setContent(event.target.value)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-editorActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							onClick: onDone,
							children: t("common.cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "primary",
							disabled: content.trim() === "",
							onClick: () => {
								run({
									action: "importPaste",
									name,
									description,
									content
								}).then(() => {
									onDone();
								}).catch(() => void 0);
							},
							children: t("create.submit")
						})]
					})
				]
			});
		}
		function HubTab({ t, state, run, startEdit, openPath, goDiscover }) {
			const list = state?.skills ?? [];
			const discoverCount = state?.discoverable.length ?? 0;
			const [creating, setCreating] = (0, react.useState)(false);
			const [filter, setFilter] = (0, react.useState)("");
			const shown = filter.trim() === "" ? list : list.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(filter.trim().toLowerCase()));
			/** 上传 .skill:选完文件即入库,不设中间确认步。 */
			const onPickArchive = (file) => {
				if (file === void 0) return;
				const reader = new FileReader();
				reader.addEventListener("load", () => {
					const result = typeof reader.result === "string" ? reader.result : "";
					const base64 = result.includes(",") ? result.split(",").slice(1).join(",") : "";
					if (base64 === "") return;
					run({
						action: "importArchive",
						name: file.name,
						archiveBase64: base64
					}).catch(() => void 0);
				});
				reader.readAsDataURL(file);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-skh-toolbar",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: creating ? "outline" : "primary",
							onClick: () => {
								setCreating((value) => !value);
							},
							children: creating ? t("hub.collapse") : t("hub.new")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "file",
							accept: ".skill,.zip",
							style: { display: "none" },
							onChange: (event) => {
								onPickArchive(event.target.files?.[0]);
								event.target.value = "";
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							onClick: (event) => {
								(event.currentTarget.parentElement?.querySelector("input[type=file]"))?.click();
							},
							children: t("hub.upload")
						})] }),
						list.length > 5 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dsh-skh-filter",
							placeholder: t("hub.filter"),
							"aria-label": t("hub.filter"),
							value: filter,
							onChange: (event) => setFilter(event.target.value)
						})
					]
				}),
				creating && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreateCard, {
					t,
					run,
					onDone: () => {
						setCreating(false);
					}
				}),
				list.length === 0 && !creating ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "dsh-skh-empty",
					children: [t("hub.empty"), discoverCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						variant: "primary",
						onClick: goDiscover,
						children: t("hub.goDiscover", { count: discoverCount })
					})]
				}) : shown.length === 0 && filter !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-skh-empty",
					children: t("filter.noMatch", { filter })
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "dsh-skh-cards",
					children: shown.map((skill) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillCard, {
						t,
						skill,
						run,
						startEdit,
						openPath
					}, skill.name))
				})
			] });
		}
		/** SKILL.md 编辑器:脏态守卫 + Cmd/Ctrl+S,保存后停留;引用技能明示写穿来源。 */
		function SkillEditor({ t, editing, run, openPath, onClose }) {
			const { skill } = editing;
			const [baseline, setBaseline] = (0, react.useState)(editing.content);
			const [draft, setDraft] = (0, react.useState)(editing.content);
			const [confirmDiscard, setConfirmDiscard] = (0, react.useState)(false);
			const dirty = draft !== baseline;
			const save = () => {
				if (!dirty) return;
				run({
					action: "save",
					name: skill.name,
					content: draft
				}).then(() => {
					setBaseline(draft);
					setConfirmDiscard(false);
				}).catch(() => void 0);
			};
			const requestClose = () => {
				if (dirty) setConfirmDiscard(true);
				else onClose();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-skh-editor",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-editorHeader",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-skh-editorTitleRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-skh-editorTitle",
									children: t("editor.title", { name: skill.name })
								}), openPath !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-skh-link",
									onClick: () => {
										openPath(skill.mode === "link" && skill.sourcePath !== "" ? skill.sourcePath : skill.dir);
									},
									children: t("card.openDir")
								})]
							}),
							skill.mode === "link" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-skh-editorNote",
								children: t("editor.linkNote", { path: skill.sourcePath })
							}),
							skill.resourceCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-skh-editorNote",
								children: t("editor.resourceNote", { count: skill.resourceCount })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "dsh-skh-textarea",
						"aria-label": t("editor.aria", { name: skill.name }),
						value: draft,
						spellCheck: false,
						onChange: (event) => {
							setDraft(event.target.value);
						},
						onKeyDown: (event) => {
							if ((event.metaKey || event.ctrlKey) && event.key === "s") {
								event.preventDefault();
								save();
							}
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-editorActions",
						children: [dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-skh-dirty",
							children: t("editor.dirty")
						}), confirmDiscard ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "primary",
								onClick: () => {
									save();
									onClose();
								},
								children: t("editor.saveAndClose")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "ghost",
								className: "dsh-skh-danger",
								onClick: onClose,
								children: t("editor.discard")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								onClick: () => {
									setConfirmDiscard(false);
								},
								children: t("editor.continue")
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "primary",
							disabled: !dirty,
							onClick: save,
							children: t("editor.save")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							onClick: requestClose,
							children: dirty ? t("editor.closeDirty") : t("editor.close")
						})] })]
					})
				]
			});
		}
		/** 发现页:来源 chips(内联管理)+ 目录选择器 + 扫描结果(引用/复制/批量)。 */
		function DiscoverTab({ t, state, run, browseDirs }) {
			const discoverable = state?.discoverable ?? [];
			const sources = state?.sources ?? [];
			const linkable = discoverable.filter((item) => item.kind !== "archive");
			const [filter, setFilter] = (0, react.useState)("");
			const [addingSource, setAddingSource] = (0, react.useState)(false);
			const shown = filter.trim() === "" ? discoverable : discoverable.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(filter.trim().toLowerCase()));
			const saveSources = (next) => {
				run({
					action: "setSources",
					sources: [...next]
				}).catch(() => void 0);
			};
			const addSource = (value) => {
				const trimmed = value.trim();
				if (trimmed !== "" && !sources.some((info) => info.path === trimmed)) saveSources([...sources.map((info) => info.path), trimmed]);
				setAddingSource(false);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-skh-chips",
					"aria-label": t("discover.scanDirs"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-skh-meta",
							children: t("discover.scanDirsLabel")
						}),
						sources.map((info) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-skh-chip",
							"data-missing": info.exists ? void 0 : "true",
							title: info.exists ? t("discover.chipTitle", {
								path: info.path,
								count: info.skillCount
							}) : t("discover.chipMissing", { path: info.path }),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: info.path }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-skh-chip-count",
									children: info.exists ? info.skillCount : t("discover.missing")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-skh-chip-remove",
									"aria-label": t("discover.removeSource", { path: info.path }),
									onClick: () => {
										saveSources(sources.filter((other) => other.path !== info.path).map((other) => other.path));
									},
									children: "✕"
								})
							]
						}, info.path)),
						!addingSource && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							onClick: () => {
								setAddingSource(true);
							},
							children: t("discover.addDir")
						})
					]
				}),
				addingSource && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourcePicker, {
					t,
					browseDirs,
					onAdd: addSource,
					onClose: () => {
						setAddingSource(false);
					}
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-skh-toolbar",
					children: [discoverable.length > 5 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "dsh-skh-filter",
						placeholder: t("discover.filter"),
						"aria-label": t("discover.filter"),
						value: filter,
						onChange: (event) => setFilter(event.target.value)
					}), linkable.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						variant: "outline",
						onClick: () => {
							run({
								action: "importLinkBatch",
								sourcePaths: linkable.map((item) => item.sourcePath)
							}).catch(() => void 0);
						},
						children: t("discover.linkAll", { count: linkable.length })
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "dsh-skh-intro",
					children: [
						t("discover.introPre"),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t("discover.link") }),
						t("discover.introMid"),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t("discover.copy") }),
						t("discover.introPost")
					]
				}),
				discoverable.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-skh-empty",
					children: t("discover.empty")
				}) : shown.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-skh-empty",
					children: t("filter.noMatch", { filter })
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "dsh-skh-cards",
					children: shown.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: "dsh-skh-rowCard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-skh-rowHead",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsh-skh-rowIdentity",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-skh-rowName",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", { children: ["/", item.name] })
									}), item.kind === "archive" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-skh-tag",
										children: t("discover.archiveOnly")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsh-skh-rowActions",
									children: [item.kind !== "archive" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "primary",
										onClick: () => {
											run({
												action: "importLink",
												sourcePath: item.sourcePath
											}).catch(() => void 0);
										},
										children: t("discover.link")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: item.kind === "archive" ? "primary" : "outline",
										onClick: () => {
											run({
												action: "importCopy",
												sourcePath: item.sourcePath
											}).catch(() => void 0);
										},
										children: t("discover.copy")
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ClampedDescription, {
								t,
								text: item.description
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-skh-meta",
								children: shortPath(item.sourcePath)
							})
						]
					}, item.sourcePath))
				})
			] });
		}
		/** 目录选择器:常见位置一键添加 + 逐级浏览 + 手输兜底。 */
		function SourcePicker({ t, browseDirs, onAdd, onClose }) {
			const [view, setView] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			const [manual, setManual] = (0, react.useState)("");
			const browse = (0, react.useCallback)((dirPath) => {
				if (browseDirs === void 0) return;
				setError(void 0);
				browseDirs(dirPath).then((result) => {
					setView(result);
				}).catch(() => {
					setError(t("picker.browseFailed", { path: dirPath === "" ? "~" : dirPath }));
				});
			}, [browseDirs, t]);
			(0, react.useEffect)(() => {
				browse("");
			}, [browse]);
			/** 当前视图下某子目录的展示路径(~ 形式,直接可存为来源)。 */
			const childPath = (name) => view === void 0 ? name : view.display === "~" ? `~/${name}` : `${view.display}/${name}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-skh-editor",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-blockTitle",
						children: [
							t("picker.title"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { marginLeft: "auto" } }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								onClick: onClose,
								children: t("common.cancel")
							})
						]
					}),
					view?.suggestions !== void 0 && view.suggestions.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-chips",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-skh-meta",
							children: t("picker.common")
						}), view.suggestions.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dsh-skh-chip",
							style: { cursor: "pointer" },
							title: t("picker.addTitle", { path: item.path }),
							onClick: () => {
								onAdd(item.path);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.path }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-skh-chip-count",
									children: t("picker.skillCount", { count: item.skillCount })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "＋"
								})
							]
						}, item.path))]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-skh-status",
						"data-tone": "error",
						children: error
					}),
					view !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-toolbar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "outline",
								disabled: view.parent === void 0,
								onClick: () => {
									if (view.parent !== void 0) browse(view.parent);
								},
								children: t("picker.parent")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-skh-meta",
								style: {
									flex: 1,
									overflowWrap: "anywhere"
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: view.display })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "primary",
								onClick: () => {
									onAdd(view.display);
								},
								children: t("picker.addCurrent")
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: "dsh-skh-cards",
						style: {
							gap: 2,
							maxHeight: 260,
							overflowY: "auto"
						},
						children: [view.dirs.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							className: "dsh-skh-empty",
							children: t("picker.noSubdirs")
						}), view.dirs.map((dir) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: "dsh-skh-rowHead",
							style: { padding: "4px 6px" },
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dsh-skh-link",
									style: { fontSize: 13 },
									onClick: () => {
										browse(`${view.display === "~" ? "~" : view.display}/${dir.name}`);
									},
									children: [dir.name, "/"]
								}),
								dir.skillCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-skh-tag",
									children: t("picker.skillCount", { count: dir.skillCount })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-skh-rowActions",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: dir.skillCount > 0 ? "primary" : "outline",
										onClick: () => {
											onAdd(childPath(dir.name));
										},
										children: t("picker.add")
									})
								})
							]
						}, dir.name))]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-skh-addRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dsh-skh-filter",
							style: { flex: 1 },
							placeholder: t("picker.manualPlaceholder"),
							"aria-label": t("picker.manualAria"),
							value: manual,
							onChange: (event) => setManual(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter" && manual.trim() !== "") onAdd(manual);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							disabled: manual.trim() === "",
							onClick: () => {
								onAdd(manual);
							},
							children: t("picker.add")
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** identity 编解码:负载原样过 wire,校验交给宿主端。 */
		const passCodec = (typeSymbol) => ({
			mode: "strict",
			typeSymbol,
			schema: { parse: (value) => value }
		});
		const DESCRIPTORS = [
			{
				id: "dsh-skillhub#skillHub/getState",
				service: "skillHub",
				namespace: "skillHub",
				method: "getState",
				invocation: { kind: "direct" },
				parameters: [],
				result: passCodec("dsh-skillhub#HubState")
			},
			{
				id: "dsh-skillhub#skillHub/browseDirs",
				service: "skillHub",
				namespace: "skillHub",
				method: "browseDirs",
				invocation: { kind: "direct" },
				parameters: [{
					name: "dirPath",
					wire: "dirPath",
					source: "json",
					codec: passCodec("dsh-skillhub#DirPath")
				}],
				result: passCodec("dsh-skillhub#BrowseResult")
			},
			{
				id: "dsh-skillhub#skillHub/runCommand",
				service: "skillHub",
				namespace: "skillHub",
				method: "runCommand",
				invocation: { kind: "direct" },
				parameters: [{
					name: "command",
					wire: "command",
					source: "json",
					codec: passCodec("dsh-skillhub#HubCommand")
				}],
				result: passCodec("dsh-skillhub#HubCommandResult")
			}
		];
		function unwrap(result) {
			if (result.ok) return result.value;
			throw new Error(`${result.error.code}: ${result.error.message}`);
		}
		/** 依赖的服务:槽系统、remote 挂载面。connection / locale 惰性获取。 */
		const inject = ["slots", "remote"];
		/**
		* 客户端插件体:挂载 RPC 描述符,把技能中枢面板注册为设置导航页。
		* @param ctx - 客户端根上下文。
		*/
		async function apply(ctx) {
			const disposeRemote = await ctx.remote.$mount({
				package: "dsh-skillhub",
				descriptors: DESCRIPTORS
			});
			ctx.effect(() => () => {
				disposeRemote();
			}, "dsh-skillhub: remote descriptor mount");
			let calls;
			ctx.inject(["remote", "remote.skillHub"], (namespaceCtx) => {
				calls = namespaceCtx.remote.skillHub;
			});
			const api = {
				getState: async () => {
					if (calls === void 0) throw new Error(tr("svc.unready"));
					return unwrap(await calls.getState());
				},
				runCommand: async (command) => {
					if (calls === void 0) throw new Error(tr("svc.unready"));
					return unwrap(await calls.runCommand(command));
				},
				browseDirs: async (dirPath) => {
					if (calls === void 0) throw new Error(tr("svc.unready"));
					return unwrap(await calls.browseDirs(dirPath));
				}
			};
			const openPath = (path) => {
				try {
					ctx.get("connection")?.api.host.openPath({ path }).catch(() => void 0);
				} catch {}
			};
			ctx.inject(["locale"], (localeCtx) => {
				const locale = localeCtx.locale;
				ctx.effect(() => {
					const dispose = locale.register(NS, {
						zh,
						en
					});
					return () => {
						if (typeof dispose === "function") dispose();
					};
				}, "dsh-skillhub: dictionary registration");
				const t = locale.bind(NS);
				setBoundT(t);
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "skills",
					order: 25,
					label: () => t("nav"),
					locale: NS,
					inject: () => ({
						openPath,
						api
					})
				}, SkillHubSection));
			});
		}
		//#endregion
		exports.SkillHubSection = SkillHubSection;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
