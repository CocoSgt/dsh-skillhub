/**
 * 端到端冒烟：直接 apply 宿主 half（DSH_HOME 指向临时目录），按浏览器
 * 面板的发现与调用序列走环回 sidecar HTTP：ping 发现 → state → 全部命令
 * → 安全围栏（Origin/Host）。
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.mjs'

const SMOKE_HOME = '/tmp/dsh-skm-smoke-home'
const SMOKE_SRC = '/tmp/dsh-skm-smoke-src'
const PORT_RANGE = Array.from({ length: 10 }, (_, i) => 3180 + i)

process.env['DSH_HOME'] = SMOKE_HOME
await rm(SMOKE_HOME, { recursive: true, force: true })
await rm(SMOKE_SRC, { recursive: true, force: true })
await mkdir(path.join(SMOKE_SRC, 'lark'), { recursive: true })
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
  '通过飞书 OpenAPI 完成操作。',
  '',
].join('\n'), 'utf8')

// 最小宿主上下文：apply 只需要 logger 与 effect。
let disposeServer = () => {}
const ctx = {
  logger: { info() {}, warn() {} },
  effect(fn) {
    disposeServer = fn()
    return () => disposeServer()
  },
}
plugin.apply(ctx)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 1. 发现：与浏览器 half 相同的端口探测
let base
for (let i = 0; i < 30 && base === undefined; i++) {
  await sleep(100)
  for (const port of PORT_RANGE) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/ping`)
      if (response.ok && (await response.json()).plugin === 'dsh-skill-manager') {
        base = `http://127.0.0.1:${String(port)}`
        break
      }
    } catch { /* 继续探测 */ }
  }
}
assert.notEqual(base, undefined, 'sidecar 在 3 秒内可发现')
const port = base.split(':').at(-1)

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
assert.equal(result.message, '已导入技能「lark」')
const larkText = await readFile(path.join(SMOKE_HOME, 'skills', 'lark', 'SKILL.md'), 'utf8')
assert.match(larkText, /whenToUse: 需要操作飞书文档\/日历时/, '保留 whenToUse')
assert.match(larkText, /disable-model-invocation: true/, '保留 disable-model-invocation')
assert.match(larkText, /metadata: owner=cowork/, '保留未知 frontmatter 键')
const installedLark = result.status.installed.find(s => s.name === 'lark')
assert.equal(installedLark.invocation, 'user', 'disable-model-invocation → 仅用户可调用')
assert.notEqual(installedLark.addedAt, '', '状态文件记录 addedAt')
assert.equal(installedLark.source, importableLark.sourcePath)

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
assert.equal(result.status.installed.length, 1, '只剩 lark')

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

// 11. client bundle 形态：__ModuleLoader__ 包装 + default 赋给 module.exports
const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
assert.match(clientSource, /^window\.__ModuleLoader__\.load\(/)
assert.ok(clientSource.includes('return module.exports;'), 'factory 以 return module.exports 收尾')
assert.match(clientSource, /module\.exports = \{/, 'default 导出赋给 module.exports')

disposeServer()
console.log('smoke OK: 11 组断言全部通过')
process.exit(0)
