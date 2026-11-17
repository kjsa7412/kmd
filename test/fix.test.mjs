// 기록 고치기(H-D38 · 2026-11-17) — 문서 고치기와 같은 로직이다.
//   그 기록이 넣은 항목을 화면의 편집기로 고치고 저장하면: 고친 그대로 문서에 들어가고 · 바로잡는 기록이 원래 기록에 이어진다(fixes) · 원래 기록은 그대로다.
//   옛 값 · 새 값을 적으면 코드가 글자를 바꾸던 길과 팀 일꾼의 정정 일감은 걷었다. 내 기록이거나 그 지식의 지식관리자만 고친다.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { sha16 } from '../core/text.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const P = {}
const KIM = { user: 'kim', admin: true }
const LEE = { user: 'lee' }
const code = async (p) => p.then(() => 'ok', (e) => e.code)
const secOf = async (h) => (await s.hub.get('dpms')).docs.find((d) => d.id === '배포절차').sections.find((x) => x.h === h)
const fixEdit = async (ctx, rec, h, from, to) => {
  const c = await secOf(h)
  const body = c.body.replace(from, to)
  const sections = [{ h, base: sha16(c.body), body }]
  const d = await s.hub.edit(ctx, 'dpms', { doc: '배포절차', sections, fixes: [rec], changes: [`${h}: ${from} → ${to}`], why: '테스트로 바로잡는다', dry: true }, { needBase: true })
  return s.hub.edit(ctx, 'dpms', { doc: '배포절차', sections, fixes: [rec], changes: [`${h}: ${from} → ${to}`], why: '테스트로 바로잡는다', proposal: d.propose.proposal }, { needBase: true })
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-fix-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  P.kim = await signIn(s, { id: 'kim', admin: true })
  P.lee = await signIn(s, { id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('기록 고치기: 그 기록이 넣은 항목을 고치면 고친 그대로 문서에 · 바로잡는 기록이 원래 기록에 이어진다 · 원래 기록은 그대로', async () => {
  const k0 = await s.hub.get('dpms')
  const orig = k0.byWork.get('2026-1017-카나리')
  assert.ok(orig)
  const before = orig.body
  const c = await secOf('카나리')
  const m = c.body.match(/\d+%/)
  const r = await fixEdit(KIM, orig.id, '카나리', m[0], '33%')
  assert.equal(r.direct, true)
  assert.match((await secOf('카나리')).body, /33%/)
  s.hub.forget('dpms')
  const k = await s.hub.get('dpms')
  const w = [...k.works, ...k.logs].find((x) => (x.fixes || []).includes(orig.id))
  assert.ok(w, '바로잡는 기록이 섰다')
  assert.match(w.title, /^바로잡음: /)
  assert.equal(w.author, 'kim')
  assert.equal(k.byWork.get(orig.id).body, before, '원래 기록은 그대로다')
})

test('자리: 남의 기록은 쓰기 자리가 고치지 못한다(403) · 내 기록은 쓰기 자리도 · 없는 기록 404', async () => {
  assert.equal(await code(fixEdit(LEE, '2026-1017-카나리', '카나리', '33%', '34%')), 'E_FORBIDDEN')
  assert.equal(await code(fixEdit(KIM, '없는-기록', '카나리', '33%', '34%')), 'E_NOTFOUND')
  assert.match((await secOf('카나리')).body, /33%/, '아무것도 쓰지 않았다')
})

test('옛 길: 옛 값 · 새 값으로 고치는 길은 걷었다(E_INPUT · 아무것도 쓰지 않는다) · 읽기 자리는 403', async () => {
  const body = (await secOf('카나리')).body
  assert.equal(await code(s.hub.fixRecord(KIM, 'dpms', '2026-1017-카나리', { body: 'x', from: '33%', to: '40%' })), 'E_INPUT')
  assert.equal((await secOf('카나리')).body, body)
  await s.auth.addUser({ id: 'rd', admin: false }).catch(() => {})
  await seat(s, 'rd', { dpms: 'read' })
  assert.equal(await code(s.hub.fixRecord({ user: 'rd' }, 'dpms', '2026-1017-카나리', { body: 'x', from: 'a', to: 'b' })), 'E_FORBIDDEN')
})
