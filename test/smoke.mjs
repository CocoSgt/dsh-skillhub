/**
 * 冒烟测试:直接驱动构建产物 lib/index.mjs 的 SkillHubGateway
 * (TypertRemoteService 的公开方法 getState/runCommand 可当普通方法调用;
 * 环回 sidecar HTTP 已随重构移除,不再走网络)。
 *
 * 隔离铁律:DSH_HOME、来源目录、cwd 全部用 mkdtemp 临时目录,绝不触碰
 * 真实 ~/.dsh;并且先用 setSources 把来源钉在临时目录,后续每次命令的
 * buildState 都不会去扫描真实的 ~/.claude/skills。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDeflateRaw, deflateRawSync } from 'node:zlib'
import assert from 'node:assert/strict'

const SMOKE_HOME = await mkdtemp(path.join(tmpdir(), 'dsh-skm-home-'))
const SMOKE_SRC = await mkdtemp(path.join(tmpdir(), 'dsh-skm-src-'))
process.env['DSH_HOME'] = SMOKE_HOME
process.chdir(SMOKE_SRC)

const { SkillHubGateway } = await import('../lib/index.mjs')

// 最小宿主上下文:Service 基类要 ctx.reflect.provide,网关构造要 ctx.inject,
// 错误路径要 ctx.logger.warn。typert registry 在测试里不存在,inject 空转即可。
const provided = []
const fakeCtx = {
  logger: { info() {}, warn() {} },
  inject(deps, fn) { return () => {} },
  reflect: { provide(name) { provided.push(name) } },
}
const gateway = new SkillHubGateway(fakeCtx, 'skillHub')

// ---------- 断言骨架:每条断言一行,失败汇总后非零退出 ----------
let passed = 0
const failures = []
async function check(label, fn) {
  try {
    await fn()
    passed += 1
    console.log(`ok   ${label}`)
  } catch (error) {
    failures.push(`${label}\n    ${error instanceof Error ? error.message : String(error)}`)
    console.log(`FAIL ${label}`)
  }
}

/** src-json 不允许 undefined 值的键:递归校验整个结果对象。 */
function assertJsonSafe(value, trail) {
  if (value === null || typeof value !== 'object') {
    assert.notEqual(value, undefined, `${trail} 为 undefined`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertJsonSafe(item, `${trail}[${i}]`))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    assert.notEqual(child, undefined, `${trail}.${key} 为 undefined`)
    assertJsonSafe(child, `${trail}.${key}`)
  }
}

/** runCommand + 每次结果的 JSON 安全断言。 */
async function run(command) {
  const result = await gateway.runCommand(command)
  assertJsonSafe(result, `runCommand(${command.action})`)
  return result
}

// ---------- 测试用 zip 手工打包器(可伪造解压后大小,供炸弹用例) ----------

/**
 * 流式压缩 totalBytes 个零字节:测试自身也不持有完整零块,内存峰值恒定。
 * (readZip 不校验 CRC,所以零块本身不必落地。)
 */
async function deflateZeros(totalBytes) {
  const deflater = createDeflateRaw({ level: 9 })
  const chunks = []
  deflater.on('data', chunk => chunks.push(chunk))
  const done = new Promise(resolve => deflater.on('end', resolve))
  const piece = Buffer.alloc(8 * 1024 * 1024)
  let remaining = totalBytes
  while (remaining > 0) {
    const take = Math.min(remaining, piece.length)
    if (!deflater.write(take === piece.length ? piece : piece.subarray(0, take))) {
      await new Promise(resolve => deflater.once('drain', resolve))
    }
    remaining -= take
  }
  deflater.end()
  await done
  return Buffer.concat(chunks)
}

/**
 * 打一个全 deflate 的 zip。每个文件给 { name, data } 或 { name, compressed,
 * uncompressed }(炸弹用例:compressed 是流式预压缩产物,uncompressed 可与
 * 实际解压大小不符——伪头部炸弹正是靠它绕过 inflate 前的声明检查)。
 * readZip 不校验 CRC,CRC 一律写 0。
 */
function packZip(files) {
  const parts = []
  const central = []
  let offset = 0
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const compressed = file.compressed ?? deflateRawSync(file.data)
    const uncomp = file.uncompressed ?? file.data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(uncomp, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, compressed)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt32LE(0, 16)
    dir.writeUInt32LE(compressed.length, 20)
    dir.writeUInt32LE(uncomp, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)
    offset += local.length + nameBuf.length + compressed.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, eocd])
}

// ---------- 用例 ----------
await check('网关以 skillHub 服务键注册(fakeCtx.reflect.provide)', () => {
  assert.ok(provided.includes('skillHub'), `provided = ${JSON.stringify(provided)}`)
})

await check('setSources:来源钉在临时目录(后续命令不再扫描真实 home)', async () => {
  const result = await run({ action: 'setSources', sources: [SMOKE_SRC] })
  assert.equal(result.code, 'sources.saved', result.message)
  assert.equal(result.state.sources.length, 1)
  assert.equal(result.state.sources[0].path, SMOKE_SRC)
})

await check('NAME_PATTERN:read 拒绝 ../evil 与 a/b(err.read.invalid)', async () => {
  for (const name of ['../evil', 'a/b']) {
    const result = await run({ action: 'read', name })
    assert.equal(result.code, 'err.read.invalid', `${name}: ${result.message}`)
    assert.equal(result.level, 'error')
  }
})

await check('NAME_PATTERN:save 拒绝 ../evil 与 a/b(err.save.invalid)', async () => {
  for (const name of ['../evil', 'a/b']) {
    const result = await run({ action: 'save', name, content: 'x' })
    assert.equal(result.code, 'err.save.invalid', `${name}: ${result.message}`)
    assert.equal(result.level, 'error')
  }
})

await check('NAME_PATTERN:delete 拒绝 ../evil 与 a/b(err.delete.invalid)', async () => {
  for (const name of ['../evil', 'a/b']) {
    const result = await run({ action: 'delete', name })
    assert.equal(result.code, 'err.delete.invalid', `${name}: ${result.message}`)
    assert.equal(result.level, 'error')
  }
})

await check('来源围栏:importLink 读取来源目录外路径 → err.link.source', async () => {
  const result = await run({ action: 'importLink', sourcePath: '/etc/passwd' })
  assert.equal(result.code, 'err.link.source', result.message)
  assert.equal(result.level, 'error')
})

await check('来源围栏:importCopy 读取来源目录外路径 → err.copy.source', async () => {
  const result = await run({ action: 'importCopy', sourcePath: '/etc/passwd' })
  assert.equal(result.code, 'err.copy.source', result.message)
  assert.equal(result.level, 'error')
})

await check('importArchive:空 base64 → err.archive.empty', async () => {
  const result = await run({ action: 'importArchive', archiveBase64: '' })
  assert.equal(result.code, 'err.archive.empty', result.message)
  assert.equal(result.level, 'error')
})

await check('importArchive:base64 超过 64MB 字符上限 → err.archive.tooLarge(params.limitMb=48)', async () => {
  const huge = 'A'.repeat(65 * 1024 * 1024)
  const result = await run({ action: 'importArchive', name: 'bomb.skill', archiveBase64: huge })
  assert.equal(result.code, 'err.archive.tooLarge', result.message)
  assert.equal(result.level, 'error')
  assert.deepEqual(result.params, { limitMb: 48 })
  assert.match(result.message, /48MB/)
})

await check('importArchive:合法最小包 <name>/SKILL.md → import.copied 且落盘临时 skills 目录', async () => {
  const zip = packZip([{ name: 'demo-pack/SKILL.md', data: '---\nname: demo-pack\ndescription: 打包技能\n---\n\n# Demo\n' }])
  const result = await run({ action: 'importArchive', name: 'demo-pack.skill', archiveBase64: zip.toString('base64') })
  assert.equal(result.code, 'import.copied', result.message)
  assert.equal(result.level, undefined)
  const written = await readFile(path.join(SMOKE_HOME, 'skills', 'demo-pack', 'SKILL.md'), 'utf8')
  assert.match(written, /^---\nname: demo-pack/, 'SKILL.md 落地临时 skills 目录')
  assert.ok(result.state.skills.some(s => s.name === 'demo-pack'), '刷新后的 state 能看到新技能')
})

await check('zip 炸弹(头部如实声明 200MB):inflate 前按声明拦截,报「超过上限」', async () => {
  const compressed = await deflateZeros(200 * 1024 * 1024)
  const bomb = packZip([{ name: 'bomb-claimed/SKILL.md', compressed, uncompressed: 200 * 1024 * 1024 }])
  assert.ok(bomb.length < 1024 * 1024, '炸弹压缩后应保持很小(否则用例构造有误)')
  const result = await run({ action: 'importArchive', name: 'bomb-claimed.skill', archiveBase64: bomb.toString('base64') })
  assert.equal(result.code, 'err.archive.invalid', result.message)
  assert.equal(result.level, 'error')
  assert.match(result.message, /超过上限/)
})

await check('zip 炸弹(头部谎报 1 字节、实为 200MB 零块):inflate 中途被 maxOutputLength 掐断', async () => {
  const compressed = await deflateZeros(200 * 1024 * 1024)
  const bomb = packZip([{ name: 'bomb-lied/SKILL.md', compressed, uncompressed: 1 }])
  const result = await run({ action: 'importArchive', name: 'bomb-lied.skill', archiveBase64: bomb.toString('base64') })
  assert.equal(result.code, 'err.archive.invalid', result.message)
  assert.equal(result.level, 'error')
  assert.match(result.message, /超过上限/)
  assert.equal(result.archiveBase64, undefined, '不得把解压数据带回')
})

await check('炸弹用例后进程内存未膨胀(rss < 512MB)', () => {
  const rss = process.memoryUsage().rss
  assert.ok(rss < 512 * 1024 * 1024, `rss = ${Math.round(rss / 1024 / 1024)}MB`)
})

await check('getState:返回 JSON 安全(递归无 undefined 值的键)', async () => {
  const state = await gateway.getState()
  assertJsonSafe(state, 'getState()')
  assert.ok(Array.isArray(state.skills) && state.skills.length >= 1, 'state.skills 非空')
})

// ---------- 收尾 ----------
await rm(SMOKE_HOME, { recursive: true, force: true })
await rm(SMOKE_SRC, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\nsmoke FAILED:${failures.length} 条断言失败(通过 ${passed} 条)`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`\nsmoke OK:全部 ${String(passed)} 条断言通过`)
process.exit(0)
