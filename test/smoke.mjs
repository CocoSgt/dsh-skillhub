/**
 * 端到端冒烟：直接 apply 宿主 half（DSH_HOME 指向临时目录），按浏览器
 * 面板的发现与调用序列走环回 sidecar HTTP：ping 发现 → state → 全部命令
 * → 安全围栏（Origin/Host）。
 */
import { execSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.mjs'

const SMOKE_HOME = '/tmp/dsh-skm-smoke-home'
const SMOKE_SRC = '/tmp/dsh-skm-smoke-src'

process.env['DSH_HOME'] = SMOKE_HOME
await rm(SMOKE_HOME, { recursive: true, force: true })
await rm(SMOKE_SRC, { recursive: true, force: true })
await mkdir(path.join(SMOKE_SRC, 'lark', 'references'), { recursive: true })
await writeFile(path.join(SMOKE_SRC, 'lark', 'SKILL.md'), [
  '---',
  'name: Lark 工具集',
  'description: 飞书套件操作技能',
  'whenToUse: 需要操作飞书文档/日历时',
  'disable-model-invocation: true',
  'metadata: owner=cowork',
  '---',
  '',
  '# Lark',
  '',
  '通过飞书 OpenAPI 完成操作，详见 references/api.md。',
  '',
].join('\n'), 'utf8')
// 多行 description（`|` 块）与资源子目录：目录式技能 + .skill 包都要能吃下
await mkdir(path.join(SMOKE_SRC, 'tree-skill'), { recursive: true })
await writeFile(path.join(SMOKE_SRC, 'tree-skill', 'SKILL.md'), [
  '---',
  'name: tree-skill',
  'description: |',
  '  多行描述第一行',
  '  多行描述第二行',
  '---',
  '',
  '# Tree',
  '',
  '资源见 assets/data.txt。',
  '',
].join('\n'), 'utf8')
await mkdir(path.join(SMOKE_SRC, 'tree-skill', 'assets'), { recursive: true })
await writeFile(path.join(SMOKE_SRC, 'tree-skill', 'assets', 'data.txt'), '资源数据', 'utf8')
// .skill 打包（模拟 Claude 网页版导出：<name>/SKILL.md + files/ 资源）
await mkdir('/tmp/dsh-skm-pkg/packed-skill/files', { recursive: true })
await writeFile('/tmp/dsh-skm-pkg/packed-skill/SKILL.md', [
  '---',
  'name: packed-skill',
  'description: 打包技能',
  '---',
  '',
  '# Packed',
  '',
  '见 files/note.txt。',
  '',
].join('\n'), 'utf8')
await writeFile('/tmp/dsh-skm-pkg/packed-skill/files/note.txt', '包内资源', 'utf8')
execSync('cd /tmp/dsh-skm-pkg && zip -qr packed-skill.skill packed-skill')
execSync(`cp /tmp/dsh-skm-pkg/packed-skill.skill ${SMOKE_SRC}/packed-skill.skill`)

// 最小宿主上下文：apply 只需要 logger 与 effect。info 日志里抓 sidecar
// 实际绑定的端口——不能按端口范围探测发现：本机可能同时跑着正式 dsh
// web（其 sidecar 占 3180），扫端口会找错服务、把测试命令打进真实环境。
let disposeServer = () => {}
const logs = []
const ctx = {
  logger: {
    info(...args) { logs.push(args.map(String).join(' ')) },
    warn(...args) { logs.push(args.map(String).join(' ')) },
  },
  effect(fn) {
    disposeServer = fn()
    return () => disposeServer()
  },
}
plugin.apply(ctx)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 1. 发现：从 apply 的就绪日志取本进程 sidecar 的端口
let port
for (let i = 0; i < 30 && port === undefined; i++) {
  await sleep(100)
  const ready = logs.join('\n').match(/sidecar 已就绪 http:\/\/127\.0\.0\.1:(\d+)/)
  if (ready !== null) port = ready[1]
}
assert.notEqual(port, undefined, 'sidecar 在 3 秒内就绪')
const base = `http://127.0.0.1:${String(port)}`

const get = async pathname => (await fetch(`${base}${pathname}`)).json()
const command = async payload => {
  const response = await fetch(`${base}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return await response.json()
}

// 2. 初始状态：默认来源 ~/.claude/skills
let state = await get('/state')
assert.equal(state.ok, true)
assert.deepEqual(state.sources, ['~/.claude/skills'])
assert.equal(state.status.installed.length, 0)

// 3. 粘贴导入：乱名称 + 无 frontmatter 裸 Markdown → 清洗为标准 SKILL.md
let result = await command({
  action: 'importPaste',
  name: 'Demo Skill!!',
  description: '演示技能',
  content: '# Demo\n\n这是演示正文。',
})
assert.equal(result.message, '已导入技能「demo-skill」', result.message)
const written = await readFile(path.join(SMOKE_HOME, 'skills', 'demo-skill', 'SKILL.md'), 'utf8')
assert.match(written, /^---\nname: demo-skill\ndescription: 演示技能\n---\n\n# Demo/, written)
assert.equal(result.status.installed.length, 1)

// 4. 读取回传 body
result = await command({ action: 'read', name: 'demo-skill' })
assert.equal(result.body.name, 'demo-skill')
assert.match(result.body.content, /^---\nname: demo-skill/, result.body.content)

// 5. 保存编辑：内容重新清洗但保留手工描述
result = await command({ action: 'save', name: 'demo-skill', content: '---\nname: demo-skill\ndescription: 新描述\n---\n\n改过的正文。\n' })
assert.equal(result.message, '已保存「demo-skill」')
assert.match(await readFile(path.join(SMOKE_HOME, 'skills', 'demo-skill', 'SKILL.md'), 'utf8'), /description: 新描述/)

// 6. 来源配置 + 扫描 + 导入：保留 whenToUse / disable-model-invocation / 未知键
result = await command({ action: 'setSources', sources: [SMOKE_SRC] })
assert.equal(result.message, '已保存来源配置')
state = await get('/state')
assert.deepEqual(state.sources, [SMOKE_SRC])
const importableLark = state.status.importable.find(s => s.name === 'lark')
assert.notEqual(importableLark, undefined, '来源中的 lark 出现在可导入列表')
assert.equal(importableLark.description, '飞书套件操作技能')

result = await command({ action: 'import', sourcePath: importableLark.sourcePath })
assert.equal(result.message, '已导入技能「lark」（含全部资源文件）', result.message)
const larkText = await readFile(path.join(SMOKE_HOME, 'skills', 'lark', 'SKILL.md'), 'utf8')
assert.match(larkText, /whenToUse: 需要操作飞书文档\/日历时/, '保留 whenToUse')
assert.match(larkText, /disable-model-invocation: true/, '保留 disable-model-invocation')
assert.match(larkText, /metadata: owner=cowork/, '保留未知 frontmatter 键')
const installedLark = result.status.installed.find(s => s.name === 'lark')
assert.equal(installedLark.invocation, 'user', 'disable-model-invocation → 仅用户可调用')
assert.notEqual(installedLark.addedAt, '', '状态文件记录 addedAt')
assert.equal(installedLark.source, importableLark.sourcePath)

// 6b. 目录式技能整树导入：references/assets 资源文件必须原样保留
const importableTree = state.status.importable.find(s => s.name === 'tree-skill')
assert.notEqual(importableTree, undefined, '目录式 tree-skill 出现在可导入列表')
assert.equal(importableTree.description, '多行描述第一行', '多行 description（| 块）取首个非空行')
result = await command({ action: 'import', sourcePath: importableTree.sourcePath })
assert.equal(result.message, '已导入技能「tree-skill」（含全部资源文件）', result.message)
assert.equal(await readFile(path.join(SMOKE_HOME, 'skills', 'tree-skill', 'assets', 'data.txt'), 'utf8'), '资源数据', '资源子目录整树保留')

// 6c. 来源目录中的 .skill 包：识别 + 整包解压
const importablePacked = state.status.importable.find(s => s.name === 'packed-skill')
assert.notEqual(importablePacked, undefined, '.skill 包出现在可导入列表')
assert.equal(importablePacked.description, '打包技能', '包内 frontmatter 描述被读出')
result = await command({ action: 'import', sourcePath: importablePacked.sourcePath })
assert.equal(result.message, '已导入技能「packed-skill」（含全部资源文件）', result.message)
assert.equal(await readFile(path.join(SMOKE_HOME, 'skills', 'packed-skill', 'files', 'note.txt'), 'utf8'), '包内资源', '包内资源解压到位')
assert.match(await readFile(path.join(SMOKE_HOME, 'skills', 'packed-skill', 'SKILL.md'), 'utf8'), /^---\nname: packed-skill/, '包内 SKILL.md 原样落地')

// 6d. 导出 .skill → 再作为上传（base64）导入：整包往返
result = await command({ action: 'export', name: 'packed-skill' })
assert.equal(result.message, '已导出「packed-skill」为 .skill 包', result.message)
assert.ok(typeof result.archiveBase64 === 'string' && result.archiveBase64.length > 0, '导出返回 base64 包')
execSync('rm -rf /tmp/dsh-skm-unzip && mkdir -p /tmp/dsh-skm-unzip')
execSync(`printf %s '${result.archiveBase64}' | base64 -d > /tmp/dsh-skm-unzip/out.skill`)
execSync('cd /tmp/dsh-skm-unzip && unzip -q out.skill')
assert.equal(await readFile('/tmp/dsh-skm-unzip/packed-skill/files/note.txt', 'utf8'), '包内资源', '导出包可被标准 unzip 解开且内容一致')
result = await command({ action: 'importArchive', name: '上传副本.skill', archiveBase64: result.archiveBase64 })
assert.equal(result.message, '已导入技能「packed-skill-2」（含全部资源文件）', result.message)
assert.equal(await readFile(path.join(SMOKE_HOME, 'skills', 'packed-skill-2', 'files', 'note.txt'), 'utf8'), '包内资源', '上传导入的包资源完整')

// 6e. 坏包被拒：无 SKILL.md 的 zip
execSync('rm -rf /tmp/dsh-skm-badpkg && mkdir -p /tmp/dsh-skm-badpkg && cd /tmp/dsh-skm-badpkg && echo hi > readme.txt && zip -q bad.skill readme.txt')
const badBase64 = execSync('base64 -i /tmp/dsh-skm-badpkg/bad.skill').toString().trim()
result = await command({ action: 'importArchive', name: 'bad.skill', archiveBase64: badBase64 })
assert.match(result.message, /没有 SKILL\.md/, result.message)

// 7. 越权路径导入被拒
result = await command({ action: 'import', sourcePath: '/etc/passwd' })
assert.match(result.message, /来源路径不在配置的来源目录内/, result.message)

// 8. 非法名称被拒（路径安全边界）
result = await command({ action: 'read', name: '../escape' })
assert.match(result.message, /技能名不合法/)

// 9. 删除 → 回收站
result = await command({ action: 'delete', name: 'demo-skill' })
assert.match(result.message, /已删除「demo-skill」/)
const trash = await readdir(path.join(SMOKE_HOME, 'skill-trash'))
assert.equal(trash.length, 1)
const remaining = result.status.installed.map(s => s.name)
assert.deepEqual(remaining.sort(), ['lark', 'packed-skill', 'packed-skill-2', 'tree-skill'], '删除后剩余技能清单')

// 10. 安全围栏：恶意 Origin 与非本机 Host 都拒绝
let response = await fetch(`${base}/state`, { headers: { origin: 'https://evil.example' } })
assert.equal(response.status, 403, '恶意 Origin 被拒')
response = await fetch(`${base}/state`, { headers: { origin: `http://127.0.0.1:${port}` } })
assert.equal(response.status, 200, '本机 Origin 放行')
// fetch 不允许覆盖 Host 头（undici 禁改头），用原生 http 客户端验证 DNS rebinding 防护
const evilHostStatus = await new Promise((resolve, reject) => {
  const req = httpGet({ host: '127.0.0.1', port: Number(port), path: '/state', headers: { host: 'evil.example' } }, res => {
    res.resume()
    resolve(res.statusCode)
  })
  req.on('error', reject)
})
assert.equal(evilHostStatus, 403, '非本机 Host 被拒（DNS rebinding 防护）')

// 10b. CORS 回显：localhost 页面跨源 fetch（页面 localhost:3080 → sidecar
// 127.0.0.1）必须拿到自己的 Origin，写死 127.0.0.1 会让浏览器全部拒收
response = await fetch(`${base}/state`, { headers: { origin: `http://localhost:3080` } })
assert.equal(response.status, 200, 'localhost Origin 放行')
assert.equal(
  response.headers.get('access-control-allow-origin'),
  'http://localhost:3080',
  'ACAO 原样回显请求 Origin（而非写死 127.0.0.1）',
)

// 11. client bundle 形态：__ModuleLoader__ 包装 + 命名导出 apply/inject（与
// 正式跑通的 dsh-file-upload bundle 同构，runner 按命名导出取插件体）
const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
assert.match(clientSource, /^window\.__ModuleLoader__\.load\(/)
assert.ok(clientSource.includes('return module.exports;'), 'factory 以 return module.exports 收尾')
assert.match(clientSource, /exports\.apply = apply;/, 'apply 以命名导出挂到 exports')
assert.match(clientSource, /exports\.inject = inject;/, 'inject 以命名导出挂到 exports')

disposeServer()
console.log('smoke OK: 全部断言通过')
process.exit(0)
