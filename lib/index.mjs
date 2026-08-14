import { cp, lstat, mkdir, readFile, readdir, readlink, rename, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/index.ts
/**
* dsh-skill-hub 宿主端:skillHub 网关服务。
*
* 核心机制:把散落各处的技能(Claude Code 的 ~/.claude/skills、项目目录、
* .skill 包……)汇成 `<dshHome>/skills/` 这个全局库——官方 skill-filesystem
* 的默认扫描根(rank 400,watcher 实时),入库即出现在 `/` 斜杠菜单。
*
* 两种入库身份:
*   - **引用(link,默认推荐)**:`skills/<name>` 是指向来源目录/文件的符号
*     链接。只有一份文件,没有同步问题;编辑引用技能=编辑来源本身。
*     harness 的扫描(nodeEntryKind 跟随符号链接)、fs 提供者与 watcher
*     (followSymlinks 默认开)都原生支持。来源消失时面板标注「引用失效」。
*   - **副本(copy)**:整树拷贝,与来源独立演化;state 记录来源路径备查
*     (漂移检测是二期,本期只记录不判定)。
*
* 传输:此前的环回 sidecar HTTP 服务已移除,改为 TypertRemoteService +
* 弱(src-json)清单注册(第三方双副本下 SRC 发现失明,原因与
* dsh-context-inspector 相同)。暴露 `skillHub/getState|runCommand|browseDirs`
* 三个 RPC(browseDirs 供来源选择器逐级浏览目录);runCommand 的负载是
* 既有的命令联合,src-json 原样过 wire。
*
* 重要:Gateway 按参数名生成 wire 字段,公开方法保持简单标识符参数。
* 不使用 @Remote 装饰器:第三方双副本下宿主读不到本副本的装饰器标记
* (端点全靠上面的弱清单),且 tsdown 产物保留装饰器语法会让 Node 导入报错。
*/
/** 名称规范化后必须匹配的模式,同时是路径安全边界(无 `/`、无 `..`)。 */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DEFAULT_SOURCES = ["~/.claude/skills"];
/** 单个 zip 条目解压后的上限(64MB):inflate 前先查中央目录声明,inflate 后再兜底复查。 */
const ZIP_ENTRY_LIMIT = 64 * 1024 * 1024;
/** 全部条目解压后的累计上限(256MB):防「千刀万剐」式多小条目炸弹。 */
const ZIP_TOTAL_LIMIT = 256 * 1024 * 1024;
/** importArchive 上传 base64 的长度上限(64MB 字符 ≈ 48MB 二进制)。 */
const ARCHIVE_BASE64_LIMIT = 64 * 1024 * 1024;
/** 极简 zip 读取:EOCD 定位中央目录,支持 stored(0)/deflate(8)。不做 ZIP64。 */
function readZip(buffer) {
	let eocd = -1;
	const scanFloor = Math.max(0, buffer.length - 22 - 65536);
	for (let i = buffer.length - 22; i >= scanFloor; i--) if (buffer.readUInt32LE(i) === 101010256) {
		eocd = i;
		break;
	}
	if (eocd < 0) throw new Error("不是有效的 .skill 包(缺少 zip 结束目录)");
	const count = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);
	const out = [];
	let totalSize = 0;
	for (let n = 0; n < count; n++) {
		if (buffer.readUInt32LE(offset) !== 33639248) throw new Error(".skill 包中央目录损坏");
		const method = buffer.readUInt16LE(offset + 10);
		const compSize = buffer.readUInt32LE(offset + 20);
		const uncompSize = buffer.readUInt32LE(offset + 24);
		const nameLen = buffer.readUInt16LE(offset + 28);
		const extraLen = buffer.readUInt16LE(offset + 30);
		const commentLen = buffer.readUInt16LE(offset + 32);
		const localOffset = buffer.readUInt32LE(offset + 42);
		const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
		if (!name.endsWith("/")) {
			if (buffer.readUInt32LE(localOffset) !== 67324752) throw new Error(".skill 包本地头损坏");
			const localNameLen = buffer.readUInt16LE(localOffset + 26);
			const localExtraLen = buffer.readUInt16LE(localOffset + 28);
			const dataStart = localOffset + 30 + localNameLen + localExtraLen;
			const compressed = buffer.subarray(dataStart, dataStart + compSize);
			if (uncompSize > ZIP_ENTRY_LIMIT || totalSize + uncompSize > ZIP_TOTAL_LIMIT) throw new Error(`zip 条目解压后超过上限:${name}`);
			let data;
			if (method === 0) data = Buffer.from(compressed);
			else if (method === 8) try {
				data = inflateRawSync(compressed, { maxOutputLength: 67108865 });
			} catch (error) {
				if (error instanceof RangeError || error.code === "ERR_BUFFER_TOO_LARGE") throw new Error(`zip 条目解压后超过上限:${name}`);
				throw error;
			}
			else throw new Error(`不支持的压缩方式 ${String(method)}(${name})`);
			if (data.length > ZIP_ENTRY_LIMIT || totalSize + data.length > ZIP_TOTAL_LIMIT) throw new Error(`zip 条目解压后超过上限:${name}`);
			totalSize += data.length;
			out.push({
				name,
				data
			});
		}
		offset += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}
/** zip 写入需要的 CRC32(多项式 0xEDB88320,查表法)。 */
const CRC_TABLE = (() => {
	const table = /* @__PURE__ */ new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 3988292384 ^ c >>> 1 : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
function crc32(data) {
	let crc = 4294967295;
	for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
	return (crc ^ 4294967295) >>> 0;
}
/** 极简 zip 写入:全 deflate,无目录条目。足够生成 .skill 导出包。 */
function writeZip(entries) {
	const parts = [];
	const central = [];
	let offset = 0;
	for (const entry of entries) {
		const nameBuf = Buffer.from(entry.name, "utf8");
		const compressed = deflateRawSync(entry.data, { level: 9 });
		const crc = crc32(entry.data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(67324752, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(2048, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		parts.push(local, nameBuf, compressed);
		const dir = Buffer.alloc(46);
		dir.writeUInt32LE(33639248, 0);
		dir.writeUInt16LE(20, 4);
		dir.writeUInt16LE(20, 6);
		dir.writeUInt16LE(2048, 8);
		dir.writeUInt16LE(8, 10);
		dir.writeUInt32LE(crc, 16);
		dir.writeUInt32LE(compressed.length, 20);
		dir.writeUInt32LE(entry.data.length, 24);
		dir.writeUInt16LE(nameBuf.length, 28);
		dir.writeUInt32LE(offset, 42);
		central.push(dir, nameBuf);
		offset += local.length + nameBuf.length + compressed.length;
	}
	const centralBuf = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(101010256, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralBuf.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([
		...parts,
		centralBuf,
		eocd
	]);
}
/** zip 条目名安全化:拒绝绝对路径与 `..`,返回清理后的相对名。 */
function safeEntryName(name) {
	const normalized = name.replace(/\\/g, "/");
	if (normalized.startsWith("/") || /[^\x20-￿]/.test(normalized)) return void 0;
	const segments = normalized.split("/");
	if (segments.includes("..") || segments.includes("")) return void 0;
	return segments.join("/");
}
/** 若所有条目共享同一个顶层目录(`<name>/SKILL.md` 形态)则剥掉它。 */
function commonTopDir(entries) {
	const tops = new Set(entries.map((entry) => entry.name.split("/")[0] ?? ""));
	if (tops.size !== 1) return void 0;
	const top = [...tops][0];
	return entries.every((entry) => entry.name === top || entry.name.startsWith(`${top}/`)) ? top : void 0;
}
/** 找包内 SKILL.md 条目(顶层或剥掉顶层目录后的顶层)。 */
function findSkillMd(entries) {
	const top = commonTopDir(entries);
	const prefix = top === void 0 ? "" : `${top}/`;
	return entries.find((entry) => entry.name === `${prefix}SKILL.md`);
}
/** 把 .skill 包解到目标目录(整树保留资源)。 */
async function extractZip(entries, destDir) {
	if (findSkillMd(entries) === void 0) throw new Error(".skill 包内没有 SKILL.md");
	const top = commonTopDir(entries);
	const prefix = top === void 0 ? "" : `${top}/`;
	for (const entry of entries) {
		const stripped = prefix === "" ? entry.name : entry.name.slice(prefix.length);
		if (stripped === "") continue;
		const safe = safeEntryName(stripped);
		if (safe === void 0) throw new Error(`包内路径不安全:${entry.name}`);
		await mkdir(path.dirname(path.join(destDir, safe)), { recursive: true });
		await writeFile(path.join(destDir, safe), entry.data);
	}
}
/** 多行 frontmatter 值的尽力而为读取(`description: |` 块取首个非空行)。 */
function scalarMultiline(lines, key) {
	const single = scalar(lines, key);
	if (single !== void 0 && single !== "" && single !== "|" && single !== ">" && !single.startsWith("|-") && !single.startsWith(">-")) return single;
	const index = lines.findIndex((line) => /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)?.[1] === key);
	if (index < 0) return void 0;
	for (const line of lines.slice(index + 1)) {
		if (/^\S/.test(line)) break;
		const trimmed = line.trim();
		if (trimmed === "") continue;
		return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
	}
}
/** dsh 主目录:$DSH_HOME 覆盖,默认 ~/.dsh(与 skill-filesystem provider 一致)。 */
function dshHome() {
	const env = process.env["DSH_HOME"];
	return env !== void 0 && env.trim() !== "" ? env : path.join(os.homedir(), ".dsh");
}
/** 把绝对路径的 home 前缀替换为 ~(仅展示/存储用)。 */
function tildeDisplay(p) {
	const home = os.homedir();
	if (p === home) return "~";
	if (p.startsWith(home + path.sep)) return `~${p.slice(home.length)}`;
	return p;
}
/** 常见技能目录候选(存在才会作为建议给出)。 */
const KNOWN_SKILL_DIRS = [
	"~/.claude/skills",
	"~/.agents/skills",
	"~/.codex/skills",
	"~/.cursor/skills"
];
function expandHome(p) {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}
/** 极简 frontmatter 拆分:只认首行 `---` 到下一行 `---` 的块。 */
function splitFrontmatter(text) {
	if (!text.startsWith("---")) return {
		raw: [],
		body: text
	};
	const lines = text.split("\n");
	for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") return {
		raw: lines.slice(1, i),
		body: lines.slice(i + 1).join("\n")
	};
	return {
		raw: [],
		body: text
	};
}
function scalar(lines, key) {
	for (const line of lines) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (match !== null && match[1] === key) return unquoteYaml(match[2].trim());
	}
}
/** 剥除 YAML 标量的成对引号并反转义(双引号 \\" 与单引号 '' 两种方言)。 */
function unquoteYaml(value) {
	if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
	return value;
}
/** kebab-case 名称;无法得出时回退 'skill'。保证匹配 NAME_PATTERN。 */
function normalizeName(input) {
	const kebab = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	const safe = kebab === "" ? "skill" : kebab;
	return /^\d/.test(safe) ? `s-${safe}` : safe;
}
/** 缺 description 时取正文第一行非标题文本充当。 */
function fallbackDescription(body) {
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
		const clean = trimmed.replace(/[*`_[\]()]/g, "").trim();
		if (clean === "") continue;
		return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
	}
	return "(无描述)";
}
/**
* 清洗管线(粘贴/平铺 .md 复制入库时用):解析任意 Markdown/SKILL.md 文本,
* 产出规范命名的 SKILL.md 全文。保留 name/description 之外的全部
* frontmatter 原行。引用与编辑保存不经过此管线(字节原样)。
*/
function parseSkillText(text, fallbackName, fallbackDesc) {
	const { raw, body } = splitFrontmatter(text.replace(/^﻿/, ""));
	const fmName = scalar(raw, "name");
	const fmDescription = scalar(raw, "description");
	const name = normalizeName(fmName !== void 0 && fmName !== "" ? fmName : fallbackName);
	const description = fmDescription !== void 0 && fmDescription !== "" ? fmDescription : fallbackDesc !== "" ? fallbackDesc : fallbackDescription(body);
	const kept = raw.filter((line) => {
		const match = /^([A-Za-z0-9_-]+):/.exec(line);
		return match === null || match[1] !== "name" && match[1] !== "description";
	});
	return {
		name,
		description,
		content: `---\n${[
			`name: ${name}`,
			`description: ${description}`,
			...kept
		].join("\n")}\n---\n\n${body.trim()}\n`
	};
}
/** frontmatter 行 → invocation 标签。 */
function invocationOf(raw) {
	if (scalar(raw, "disable-model-invocation") === "true") return "user";
	return scalar(raw, "user-invocable") === "false" ? "model" : "both";
}
const TYPERT_MANIFEST = {
	package: "dsh-skill-hub",
	face: "host",
	schemas: [],
	model: {
		services: [],
		events: [],
		objects: []
	},
	invocations: [
		{
			id: "dsh-skill-hub#skillHub/getState",
			service: "skillHub",
			namespace: "skillHub",
			method: "getState",
			invocation: { kind: "direct" },
			parameters: [],
			result: { mode: "src-json" }
		},
		{
			id: "dsh-skill-hub#skillHub/browseDirs",
			service: "skillHub",
			namespace: "skillHub",
			method: "browseDirs",
			invocation: { kind: "direct" },
			parameters: [{
				name: "dirPath",
				wire: "dirPath",
				source: "json",
				codec: { mode: "src-json" }
			}],
			result: { mode: "src-json" }
		},
		{
			id: "dsh-skill-hub#skillHub/runCommand",
			service: "skillHub",
			namespace: "skillHub",
			method: "runCommand",
			invocation: { kind: "direct" },
			parameters: [{
				name: "command",
				wire: "command",
				source: "json",
				codec: { mode: "src-json" }
			}],
			result: { mode: "src-json" }
		}
	]
};
/**
* skillHub 网关服务:全局技能库的状态/入库(引用|复制)/编辑/导出/删除。
* @param ctx - 宿主 Cordis 上下文。
*/
var SkillHubGateway = class extends TypertRemoteService {
	skillsDir = path.join(dshHome(), "skills");
	trashDir = path.join(dshHome(), "skill-trash");
	statePath = path.join(dshHome(), "skills", ".skill-manager.json");
	/** 注册 'skillHub' 服务键;typert registry 就绪后补登记弱清单。 */
	constructor(ctx) {
		super(ctx, "skillHub");
		ctx.inject(["typert"], (typertCtx) => typertCtx.typert.register(TYPERT_MANIFEST));
	}
	/** 全量状态(设置页首屏与每次命令后的刷新)。 */
	async getState() {
		return await this.buildState("");
	}
	/** 执行一条面板命令,返回结果码/消息 + 刷新后的全量状态。 */
	async runCommand(command) {
		const result = await this.execute(command);
		return {
			code: result.code,
			message: result.message,
			state: await this.buildState(result.message),
			...result.params === void 0 ? {} : { params: result.params },
			...result.level === void 0 ? {} : { level: result.level },
			...result.body === void 0 ? {} : { body: result.body },
			...result.archiveBase64 === void 0 ? {} : { archiveBase64: result.archiveBase64 }
		};
	}
	/**
	* 目录浏览器:列出一个目录的子目录与技能计数,供「选择扫描目录」使用。
	* dirPath 传 '' 表示 home,并附带常见技能位置建议。
	* @param dirPath - 要浏览的目录(支持 ~ 前缀;'' = home)。
	*/
	async browseDirs(dirPath) {
		const isRoot = typeof dirPath !== "string" || dirPath.trim() === "";
		const target = path.resolve(expandHome(isRoot ? "~" : dirPath.trim()));
		let entries;
		try {
			entries = await readdir(target, { withFileTypes: true });
		} catch {
			throw new Error(`无法读取目录:${tildeDisplay(target)}`);
		}
		const dirNames = entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name).slice(0, 400);
		const dirs = [];
		let probes = 0;
		for (const name of dirNames) {
			let skillCount = 0;
			if (probes < 60) {
				probes += 1;
				skillCount = await this.countSkillShaped(path.join(target, name));
			}
			dirs.push({
				name,
				skillCount
			});
		}
		dirs.sort((a, b) => b.skillCount - a.skillCount || a.name.localeCompare(b.name));
		const parent = path.dirname(target);
		const result = {
			path: target,
			display: tildeDisplay(target),
			...parent === target ? {} : { parent },
			dirs
		};
		if (isRoot) {
			const configured = new Set(((await this.readState()).sources ?? DEFAULT_SOURCES).map((source) => path.resolve(expandHome(source))));
			const suggestions = [];
			for (const candidate of KNOWN_SKILL_DIRS) {
				const absolute = path.resolve(expandHome(candidate));
				if (configured.has(absolute)) continue;
				try {
					if (!(await stat(absolute)).isDirectory()) continue;
				} catch {
					continue;
				}
				suggestions.push({
					path: candidate,
					skillCount: await this.countSkillShaped(absolute)
				});
			}
			if (suggestions.length > 0) result.suggestions = suggestions;
		}
		return result;
	}
	/** 限量探测一个目录里的技能形态条目数(SKILL.md 目录 / 平铺 .md / .skill)。 */
	async countSkillShaped(dir) {
		let names;
		try {
			names = (await readdir(dir)).slice(0, 150);
		} catch {
			return 0;
		}
		let count = 0;
		for (const name of names) {
			if (name.startsWith(".")) continue;
			if (name.endsWith(".md") || name.endsWith(".skill")) {
				count += 1;
				continue;
			}
			try {
				await stat(path.join(dir, name, "SKILL.md"));
				count += 1;
			} catch {}
		}
		return count;
	}
	async readState() {
		try {
			return JSON.parse(await readFile(this.statePath, "utf8"));
		} catch {
			return {};
		}
	}
	async writeState(state) {
		await mkdir(this.skillsDir, { recursive: true });
		await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	}
	/** 数一棵技能树里 SKILL.md 之外的文件数(限量,防大目录)。 */
	async countResources(dir) {
		let count = 0;
		const walk = async (current, depth) => {
			if (depth > 6 || count > 500) return;
			let entries;
			try {
				entries = await readdir(current, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.name === ".DS_Store") continue;
				const full = path.join(current, entry.name);
				if (entry.isDirectory()) await walk(full, depth + 1);
				else if (entry.isFile() && !(current === dir && (entry.name === "SKILL.md" || entry.name === "skill.md"))) count += 1;
			}
		};
		await walk(dir, 0);
		return count;
	}
	/** 扫描全局库:目录/平铺/符号链接条目 → HubSkill(含身份与失效标注)。 */
	async scanHub() {
		const state = await this.readState();
		const out = [];
		let entries;
		try {
			entries = await readdir(this.skillsDir);
		} catch {
			return out;
		}
		for (const entry of entries) {
			if (entry.startsWith(".")) continue;
			const full = path.join(this.skillsDir, entry);
			let linkInfo;
			try {
				linkInfo = await lstat(full);
			} catch {
				continue;
			}
			const isLink = linkInfo.isSymbolicLink();
			let sourcePath = "";
			if (isLink) try {
				sourcePath = path.resolve(this.skillsDir, await readlink(full));
			} catch {}
			let info;
			try {
				info = await stat(full);
			} catch {
				const meta = state.skills?.[entry.replace(/\.md$/u, "")];
				out.push({
					name: entry.replace(/\.md$/u, ""),
					description: "",
					whenToUse: "",
					invocation: "both",
					addedAt: meta?.addedAt ?? "",
					mode: "link",
					sourcePath: meta?.source ?? sourcePath,
					broken: true,
					resourceCount: 0,
					file: full,
					dir: this.skillsDir
				});
				continue;
			}
			let file;
			let fallbackName = entry;
			let dir = this.skillsDir;
			if (info.isDirectory()) {
				dir = full;
				for (const candidate of ["SKILL.md", "skill.md"]) {
					const probe = path.join(full, candidate);
					try {
						await stat(probe);
						file = probe;
						break;
					} catch {}
				}
			} else if (entry.endsWith(".md")) {
				file = full;
				fallbackName = entry.slice(0, -3);
			} else continue;
			if (file === void 0) continue;
			let text;
			try {
				text = await readFile(file, "utf8");
			} catch {
				continue;
			}
			const { raw, body } = splitFrontmatter(text);
			const name = normalizeName(scalar(raw, "name") ?? fallbackName);
			const meta = state.skills?.[entry.replace(/\.md$/u, "")] ?? state.skills?.[name];
			const mode = isLink ? "link" : meta?.mode ?? (meta?.source !== void 0 && meta.source !== "" && meta.source !== "paste" && meta.source !== "edit" && meta.source !== "upload" ? "copy" : "local");
			out.push({
				name,
				description: scalarMultiline(raw, "description") ?? fallbackDescription(body),
				whenToUse: scalar(raw, "whenToUse") ?? "",
				invocation: invocationOf(raw),
				addedAt: meta?.addedAt ?? "",
				mode,
				sourcePath: isLink ? sourcePath : mode === "copy" ? meta?.source ?? "" : "",
				broken: false,
				resourceCount: info.isDirectory() ? await this.countResources(full) : 0,
				file,
				dir
			});
		}
		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	}
	/** 扫描来源目录:尚未入库的技能(目录式/平铺 .md/.skill 包)+ 每目录状态。 */
	async scanDiscoverable(sources, hub) {
		const hubNames = new Set(hub.map((s) => s.name));
		const hubSources = new Set(hub.map((s) => s.sourcePath).filter((s) => s !== ""));
		const out = /* @__PURE__ */ new Map();
		const sourceInfos = [];
		for (const source of sources) {
			const dir = expandHome(source);
			let entries;
			try {
				entries = await readdir(dir);
			} catch {
				sourceInfos.push({
					path: source,
					exists: false,
					skillCount: 0
				});
				continue;
			}
			let skillCount = 0;
			for (const entry of entries) {
				if (entry.startsWith(".")) continue;
				const full = path.join(dir, entry);
				if (hubSources.has(full)) {
					skillCount += 1;
					continue;
				}
				let info;
				try {
					info = await stat(full);
				} catch {
					continue;
				}
				if (info.isFile() && entry.endsWith(".skill")) {
					skillCount += 1;
					let name = normalizeName(entry.replace(/\.skill$/iu, ""));
					let description = "(打包技能)";
					try {
						const skillMd = findSkillMd(readZip(await readFile(full)));
						if (skillMd !== void 0) {
							const { raw, body } = splitFrontmatter(skillMd.data.toString("utf8"));
							name = normalizeName(scalar(raw, "name") ?? name);
							description = scalarMultiline(raw, "description") ?? fallbackDescription(body);
						}
					} catch {}
					if (!hubNames.has(name) && !out.has(name)) out.set(name, {
						name,
						description,
						sourcePath: full,
						kind: "archive"
					});
					continue;
				}
				let file;
				let kind = "md";
				let fallbackName = entry;
				if (info.isDirectory()) {
					const probe = path.join(full, "SKILL.md");
					try {
						await stat(probe);
						file = probe;
						kind = "dir";
					} catch {
						continue;
					}
				} else if (entry.endsWith(".md")) {
					file = full;
					fallbackName = entry.slice(0, -3);
				} else continue;
				if (file === void 0) continue;
				skillCount += 1;
				let text;
				try {
					text = await readFile(file, "utf8");
				} catch {
					continue;
				}
				const { raw, body } = splitFrontmatter(text);
				const name = normalizeName(scalar(raw, "name") ?? fallbackName);
				if (hubNames.has(name) || out.has(name)) continue;
				out.set(name, {
					name,
					description: scalarMultiline(raw, "description") ?? fallbackDescription(body),
					sourcePath: kind === "dir" ? full : file,
					kind
				});
			}
			sourceInfos.push({
				path: source,
				exists: true,
				skillCount
			});
		}
		return {
			discoverable: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)),
			sourceInfos
		};
	}
	/** 技能名在库里对应的现有路径(目录式或平铺式),不存在则 undefined。 */
	async existingPath(name) {
		for (const candidate of [path.join(this.skillsDir, name, "SKILL.md"), path.join(this.skillsDir, `${name}.md`)]) try {
			await stat(candidate);
			return candidate;
		} catch {}
	}
	/** 名字对应的库条目(目录、平铺文件或符号链接本身),含失效链接。 */
	async entryPath(name) {
		for (const candidate of [path.join(this.skillsDir, name), path.join(this.skillsDir, `${name}.md`)]) try {
			await lstat(candidate);
			return candidate;
		} catch {}
	}
	/** 同名已存在时追加 -2/-3… 序号。 */
	async uniqueName(base) {
		if (await this.entryPath(base) === void 0) return base;
		for (let i = 2; i < 100; i++) {
			const candidate = `${base}-${i}`;
			if (await this.entryPath(candidate) === void 0) return candidate;
		}
		return `${base}-${Date.now()}`;
	}
	/** sourcePath 必须位于某个配置来源目录内,拒绝任意路径读取。 */
	async sourceAllowed(sourcePath) {
		const sources = (await this.readState()).sources ?? DEFAULT_SOURCES;
		for (const source of sources) {
			const root = `${expandHome(source).replace(/\/+$/, "")}/`;
			if (sourcePath.startsWith(root)) return true;
		}
		return sourcePath.startsWith(`${this.skillsDir.replace(/\/+$/, "")}/`);
	}
	/** 把技能目录里 SKILL.md 的 frontmatter `name:` 同步为最终目录名(仅副本)。 */
	async syncFrontmatterName(dir, name) {
		const skillMd = path.join(dir, "SKILL.md");
		let text;
		try {
			text = await readFile(skillMd, "utf8");
		} catch {
			return;
		}
		const { raw } = splitFrontmatter(text);
		if (scalar(raw, "name") === name) return;
		await writeFile(skillMd, raw.some((line) => /^([A-Za-z0-9_-]+):/.exec(line)?.[1] === "name") ? text.replace(/^name:.*$/mu, `name: ${name}`) : text.replace(/^---\n/u, `---\nname: ${name}\n`), "utf8");
	}
	async recordSkill(key, source, mode) {
		const state = await this.readState();
		state.skills = {
			...state.skills,
			[key]: {
				addedAt: (/* @__PURE__ */ new Date()).toISOString(),
				source,
				mode
			}
		};
		await this.writeState(state);
	}
	/** 安装 .skill 包(只能复制):整树解压到 skills/<name>/。 */
	async installArchive(entries, fallbackName, source) {
		let name = fallbackName;
		const skillMd = findSkillMd(entries);
		if (skillMd !== void 0) {
			const fmName = scalar(splitFrontmatter(skillMd.data.toString("utf8")).raw, "name");
			if (fmName !== void 0 && fmName !== "") name = normalizeName(fmName);
		}
		name = await this.uniqueName(name);
		try {
			await extractZip(entries, path.join(this.skillsDir, name));
		} catch (error) {
			this.ctx.logger.warn(error);
			return {
				code: "err.archive.extract",
				level: "error",
				message: `入库失败:${error instanceof Error ? error.message : String(error)}`
			};
		}
		await this.syncFrontmatterName(path.join(this.skillsDir, name), name);
		await this.recordSkill(name, source, "copy");
		return {
			code: "import.copied",
			params: { name },
			message: `已复制入库「${name}」(含全部资源文件)`
		};
	}
	/** 递归收集技能目录为 zip 条目(`<name>/<相对路径>`)。 */
	async collectTree(rootDir, prefix) {
		const out = [];
		const walk = async (dir, rel) => {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name === ".DS_Store") continue;
				const full = path.join(dir, entry.name);
				const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
				if (entry.isDirectory()) await walk(full, relPath);
				else if (entry.isFile()) out.push({
					name: `${prefix}/${relPath}`,
					data: await readFile(full)
				});
			}
		};
		await walk(rootDir, "");
		return out;
	}
	/** 引用入库:skills/<name> 符号链接 → 来源目录/文件。 */
	async importLink(sourcePath) {
		if (sourcePath === "" || !await this.sourceAllowed(sourcePath)) return {
			code: "err.link.source",
			level: "error",
			message: "引用失败:来源路径不在配置的来源目录内"
		};
		let info;
		try {
			info = await stat(sourcePath);
		} catch {
			return {
				code: "err.link.unreadable",
				level: "error",
				message: "引用失败:无法读取来源"
			};
		}
		if (sourcePath.endsWith(".skill")) return {
			code: "err.link.archive",
			level: "error",
			message: "打包技能(.skill)没有可引用的目录,请用「复制」入库"
		};
		let name = normalizeName(path.basename(sourcePath).replace(/\.md$/iu, ""));
		try {
			name = normalizeName(scalar(splitFrontmatter(info.isDirectory() ? await readFile(path.join(sourcePath, "SKILL.md"), "utf8") : await readFile(sourcePath, "utf8")).raw, "name") ?? name);
		} catch {}
		const collides = (await this.scanHub()).some((skill) => skill.name === name);
		const linkKey = await this.uniqueName(name);
		const linkPath = info.isDirectory() ? path.join(this.skillsDir, linkKey) : path.join(this.skillsDir, `${linkKey}.md`);
		await mkdir(this.skillsDir, { recursive: true });
		try {
			await symlink(sourcePath, linkPath, info.isDirectory() ? process.platform === "win32" ? "junction" : "dir" : "file");
		} catch (error) {
			this.ctx.logger.warn(error);
			if (process.platform === "win32" && info.isFile()) {
				await cp(sourcePath, linkPath, { dereference: true });
				await this.recordSkill(linkKey, sourcePath, "copy");
				return {
					code: "import.fallbackCopy",
					params: { name },
					message: `此平台无法创建文件符号链接,「${name}」已改为复制入库`
				};
			}
			return {
				code: "err.link.symlink",
				level: "error",
				params: { message: error instanceof Error ? error.message : String(error) },
				message: `引用失败:${error instanceof Error ? error.message : String(error)}`
			};
		}
		await this.recordSkill(linkKey, sourcePath, "link");
		if (collides) return {
			code: "import.linked.dup",
			params: {
				name,
				path: sourcePath
			},
			message: `已引用「${name}」→ ${sourcePath}(编辑即编辑来源;新会话立即可用,已打开的会话刷新页面后 / 菜单可见);注意:库里已有同名技能,同名时只有一个会生效`
		};
		return {
			code: "import.linked",
			params: {
				name,
				path: sourcePath
			},
			message: `已引用「${name}」→ ${sourcePath}(编辑即编辑来源;新会话立即可用,已打开的会话刷新页面后 / 菜单可见)`
		};
	}
	/** 复制入库(目录整树 / .skill 解压 / 平铺 .md 清洗)。 */
	async importCopy(sourcePath) {
		if (sourcePath === "" || !await this.sourceAllowed(sourcePath)) return {
			code: "err.copy.source",
			level: "error",
			message: "复制失败:来源路径不在配置的来源目录内"
		};
		let info;
		try {
			info = await stat(sourcePath);
		} catch (error) {
			this.ctx.logger.warn(error);
			return {
				code: "err.copy.unreadable",
				level: "error",
				message: "复制失败:无法读取来源"
			};
		}
		if (info.isDirectory()) {
			let name = normalizeName(path.basename(sourcePath));
			try {
				name = normalizeName(scalar(splitFrontmatter(await readFile(path.join(sourcePath, "SKILL.md"), "utf8")).raw, "name") ?? name);
			} catch {}
			const finalName = await this.uniqueName(name);
			try {
				await cp(sourcePath, path.join(this.skillsDir, finalName), {
					recursive: true,
					dereference: true
				});
			} catch (error) {
				this.ctx.logger.warn(error);
				return {
					code: "err.copy.dir",
					level: "error",
					message: "复制失败:拷贝技能目录出错"
				};
			}
			await this.syncFrontmatterName(path.join(this.skillsDir, finalName), finalName);
			await this.recordSkill(finalName, sourcePath, "copy");
			return {
				code: "import.copied",
				params: { name: finalName },
				message: `已复制入库「${finalName}」(含全部资源文件)`
			};
		}
		if (sourcePath.endsWith(".skill")) {
			let entries;
			try {
				entries = readZip(await readFile(sourcePath));
			} catch (error) {
				this.ctx.logger.warn(error);
				return {
					code: "err.copy.archive",
					level: "error",
					params: { message: error instanceof Error ? error.message : String(error) },
					message: `复制失败:${error instanceof Error ? error.message : String(error)}`
				};
			}
			return await this.installArchive(entries, normalizeName(path.basename(sourcePath).replace(/\.skill$/iu, "")), sourcePath);
		}
		let text;
		try {
			text = await readFile(sourcePath, "utf8");
		} catch (error) {
			this.ctx.logger.warn(error);
			return {
				code: "err.copy.readFile",
				level: "error",
				message: "复制失败:无法读取来源文件"
			};
		}
		const parsed = parseSkillText(text, path.basename(sourcePath).replace(/\.md$/iu, ""), "");
		const name = await this.uniqueName(parsed.name);
		await mkdir(path.join(this.skillsDir, name), { recursive: true });
		await writeFile(path.join(this.skillsDir, name, "SKILL.md"), parsed.content, "utf8");
		await this.recordSkill(name, sourcePath, "copy");
		return {
			code: "import.copiedMd",
			params: { name },
			message: `已复制入库「${name}」`
		};
	}
	async execute(cmd) {
		switch (cmd.action) {
			case "rescan": return {
				code: "rescan.done",
				message: "已刷新技能列表"
			};
			case "importLink": return await this.importLink(cmd.sourcePath ?? "");
			case "importLinkBatch": {
				const sourcePaths = cmd.sourcePaths ?? [];
				if (sourcePaths.length === 0) return {
					code: "import.batch.empty",
					level: "error",
					message: "批量引用:没有收到来源"
				};
				let linked = 0;
				const failures = [];
				for (const sourcePath of sourcePaths) {
					const result = await this.importLink(sourcePath);
					if (result.level === void 0) linked += 1;
					else failures.push(result.message);
				}
				if (failures.length > 0) return {
					code: "import.batch.doneWithFail",
					level: "error",
					params: {
						linked,
						total: sourcePaths.length,
						failCount: failures.length,
						firstFail: failures[0]
					},
					message: `批量引用完成:${linked}/${sourcePaths.length} 个入库;${failures.length} 个失败(${failures[0]})`
				};
				return {
					code: "import.batch.done",
					params: {
						linked,
						total: sourcePaths.length
					},
					message: `批量引用完成:${linked}/${sourcePaths.length} 个入库`
				};
			}
			case "importCopy": return await this.importCopy(cmd.sourcePath ?? "");
			case "importArchive": {
				const archiveBase64 = cmd.archiveBase64 ?? "";
				if (archiveBase64 === "") return {
					code: "err.archive.empty",
					level: "error",
					message: "入库失败:没有收到文件内容"
				};
				if (archiveBase64.length > ARCHIVE_BASE64_LIMIT) return {
					code: "err.archive.tooLarge",
					level: "error",
					params: { limitMb: 48 },
					message: "入库失败:文件超过 48MB 上限"
				};
				let entries;
				try {
					entries = readZip(Buffer.from(archiveBase64, "base64"));
				} catch (error) {
					this.ctx.logger.warn(error);
					return {
						code: "err.archive.invalid",
						level: "error",
						params: { message: error instanceof Error ? error.message : String(error) },
						message: `入库失败:${error instanceof Error ? error.message : String(error)}`
					};
				}
				const fallbackName = normalizeName((cmd.name ?? "").replace(/\.skill$/iu, ""));
				return await this.installArchive(entries, fallbackName, "upload");
			}
			case "importPaste": {
				const content = cmd.content ?? "";
				if (content.trim() === "") return {
					code: "err.paste.empty",
					level: "error",
					message: "创建失败:内容为空"
				};
				const parsed = parseSkillText(content, cmd.name ?? "", cmd.description ?? "");
				const name = await this.uniqueName(parsed.name);
				await mkdir(path.join(this.skillsDir, name), { recursive: true });
				await writeFile(path.join(this.skillsDir, name, "SKILL.md"), parsed.content, "utf8");
				await this.recordSkill(name, "paste", "local");
				return {
					code: "import.created",
					params: { name },
					message: `已创建技能「${name}」`
				};
			}
			case "read": {
				const name = cmd.name ?? "";
				if (!NAME_PATTERN.test(name)) return {
					code: "err.read.invalid",
					level: "error",
					message: "读取失败:技能名不合法"
				};
				const file = await this.existingPath(name);
				if (file === void 0) return {
					code: "err.read.notFound",
					level: "error",
					params: { name },
					message: `读取失败:找不到技能「${name}」`
				};
				return {
					code: "read.done",
					params: { name },
					message: `已读取「${name}」`,
					body: {
						name,
						content: await readFile(file, "utf8")
					}
				};
			}
			case "save": {
				const name = cmd.name ?? "";
				if (!NAME_PATTERN.test(name)) return {
					code: "err.save.invalid",
					level: "error",
					message: "保存失败:技能名不合法"
				};
				const file = await this.existingPath(name);
				if (file === void 0) return {
					code: "err.save.notFound",
					level: "error",
					params: { name },
					message: `保存失败:找不到技能「${name}」`
				};
				await writeFile(file, cmd.content ?? "", "utf8");
				return {
					code: "save.done",
					params: { name },
					message: `已保存「${name}」`
				};
			}
			case "delete": {
				const name = cmd.name ?? "";
				if (!NAME_PATTERN.test(name)) return {
					code: "err.delete.invalid",
					level: "error",
					message: "删除失败:技能名不合法"
				};
				const entry = await this.entryPath(name);
				if (entry === void 0) return {
					code: "err.delete.notFound",
					level: "error",
					params: { name },
					message: `删除失败:找不到技能「${name}」`
				};
				const linkInfo = await lstat(entry);
				const state = await this.readState();
				const key = path.basename(entry).replace(/\.md$/u, "");
				if (linkInfo.isSymbolicLink()) {
					await unlink(entry);
					if (state.skills?.[key] !== void 0) {
						delete state.skills[key];
						await this.writeState(state);
					}
					return {
						code: "delete.removedLink",
						params: { name },
						message: `已移除引用「${name}」(来源文件未动)`
					};
				}
				await mkdir(this.trashDir, { recursive: true });
				await rename(entry, path.join(this.trashDir, `${Date.now()}-${name}`));
				if (state.skills?.[key] !== void 0) {
					delete state.skills[key];
					await this.writeState(state);
				}
				return {
					code: "delete.done",
					params: { name },
					message: `已删除「${name}」(可在 skill-trash 目录找回)`
				};
			}
			case "export": {
				const name = cmd.name ?? "";
				if (!NAME_PATTERN.test(name)) return {
					code: "err.export.invalid",
					level: "error",
					message: "导出失败:技能名不合法"
				};
				const file = await this.existingPath(name);
				if (file === void 0) return {
					code: "err.export.notFound",
					level: "error",
					params: { name },
					message: `导出失败:找不到技能「${name}」`
				};
				try {
					const dir = path.dirname(file);
					const entries = path.basename(dir) !== path.basename(this.skillsDir) ? await this.collectTree(dir, name) : [{
						name: `${name}/SKILL.md`,
						data: await readFile(file)
					}];
					if (!entries.some((entry) => entry.name === `${name}/SKILL.md` || entry.name === `${name}/skill.md`)) return {
						code: "err.export.noSkillMd",
						level: "error",
						params: { name },
						message: `导出失败:「${name}」缺少 SKILL.md`
					};
					return {
						code: "export.done",
						params: { name },
						message: `已导出「${name}」为 .skill 包`,
						archiveBase64: writeZip(entries).toString("base64")
					};
				} catch (error) {
					this.ctx.logger.warn(error);
					return {
						code: "err.export.failed",
						level: "error",
						message: "导出失败:打包出错"
					};
				}
			}
			case "setSources": {
				const sources = cmd.sources ?? [];
				if (sources.some((s) => typeof s !== "string" || s.trim() === "")) return {
					code: "err.sources.invalid",
					level: "error",
					message: "保存失败:来源目录列表不合法"
				};
				const state = await this.readState();
				state.sources = sources;
				await this.writeState(state);
				return {
					code: "sources.saved",
					message: "已保存来源配置"
				};
			}
			default: return {
				code: "err.unknown",
				level: "error",
				message: "未知命令"
			};
		}
	}
	async buildState(message) {
		const skills = await this.scanHub();
		const sourcePaths = (await this.readState()).sources ?? DEFAULT_SOURCES;
		const { discoverable, sourceInfos } = await this.scanDiscoverable(sourcePaths, skills);
		return {
			message,
			skills,
			discoverable,
			sources: sourceInfos
		};
	}
};
//#endregion
export { SkillHubGateway, SkillHubGateway as default };
