// 장부 고침(지식 생성 하네스 H7 · H-O12)과 되돌림의 장부 줄 걷기(H6 · H-D24).
//   지식관리자만 · 저장 문의 system 걸음(이력) · 줄은 지우지 않고 폐기 표시 · 걸음 하나라도 틀리면 아무것도 쓰지 않는다.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { ledgerOps } from '../core/namebook.js'
import { parseVocab } from '../core/vocab.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const P = {}
const vocab = () => fs.readFileSync(path.join(tmp, 'kn', 'dpms', '_vocab.md'), 'utf8')
const post = async (who, p, body) => {
  const r = await fetch(s.url + p, { method: 'POST', headers: { cookie: who.cookie, 'content-type': 'application/json', 'x-kmd': '1' }, body: JSON.stringify(body) })
  return { status: r.status, j: await r.json().catch(() => null) }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hledger-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  P.kim = await signIn(s, { id: 'kim', admin: true })
  P.wr = await signIn(s, { id: 'wr', admin: false })
  await seat(s, 'wr', { dpms: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('ledgerOps: 폐기 · 합치기 · 별칭 빼기 · 틀린 걸음이 하나라도 있으면 글은 그대로', () => {
  const t = '# 항목 장부\n\n## proc\n\n- `proc:배포`: 배포\n  aliases: 릴리스, 내보내기\n- `proc:롤백`: 롤백\n- `proc:되돌리기`: 되돌리기\n  aliases: 원복\n'
  const r = ledgerOps(t, [{ op: 'unalias', coord: 'proc:배포', alias: '내보내기' }, { op: 'merge', coord: 'proc:되돌리기', into: 'proc:롤백' }], { today: '2026-11-17' })
  assert.deepEqual(r.errors, [])
  const v = parseVocab(r.text).coords
  assert.deepEqual(v.get('proc:배포').aliases, ['릴리스'])
  assert.equal(v.get('proc:되돌리기').deprecated, '2026-11-17 → proc:롤백: 합침')
  assert.deepEqual(v.get('proc:롤백').aliases, ['되돌리기', '원복'])
  // 뜻 한 줄 적기 — 없으면 더하고 있으면 갈음한다(옛 장부 줄의 보강)
  const g1 = ledgerOps(t, [{ op: 'gist', coord: 'proc:배포', gist: '새 판을 운영에 올리는 절차' }])
  assert.equal(parseVocab(g1.text).coords.get('proc:배포').gist, '새 판을 운영에 올리는 절차')
  assert.deepEqual(parseVocab(g1.text).coords.get('proc:배포').aliases, ['릴리스', '내보내기'], '별칭은 그대로')
  const g2 = ledgerOps(g1.text, [{ op: 'gist', coord: 'proc:배포', gist: '판을 올리는 절차' }])
  assert.equal(parseVocab(g2.text).coords.get('proc:배포').gist, '판을 올리는 절차')
  assert.equal((g2.text.match(/gist:/g) || []).length, 1)
  const r2 = ledgerOps(t, [{ op: 'retire', coord: 'proc:배포', why: '안 쓴다' }, { op: 'retire', coord: 'proc:없음' }])
  assert.equal(r2.errors.length, 1)
  assert.equal(r2.text, t, '하나라도 틀리면 아무것도 고치지 않는다')
})

test('장부 고침 길: 지식관리자만 · 까닭이 꼭 · 이력에 남는다 · 줄은 지우지 않는다', async () => {
  const k = await s.hub.get('dpms')
  const coord = [...k.vocab.coords.entries()].find(([, v]) => !v.deprecated)[0]
  assert.equal((await post(P.wr, '/api/k/dpms/ledger', { ops: [{ op: 'retire', coord }], why: 'x' })).status, 403)
  assert.equal((await post(P.kim, '/api/k/dpms/ledger', { ops: [{ op: 'retire', coord }] })).status, 400, '까닭이 없다')
  const before = vocab()
  assert.equal((await post(P.kim, '/api/k/dpms/ledger', { ops: [{ op: 'retire', coord: 'proc:그런것없음' }], why: '시험' })).status, 400)
  assert.equal(vocab(), before)
  const r = await post(P.kim, '/api/k/dpms/ledger', { ops: [{ op: 'retire', coord }], why: '쓰지 않는 항목' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.j.done, [`폐기: ${coord}`])
  const k2 = await s.hub.get('dpms')
  assert.match(k2.vocab.coords.get(coord).deprecated, /^\d{4}-\d{2}-\d{2}: 쓰지 않는 항목$/)
  assert.ok(k2.logs.some((w) => w.title.startsWith('장부 고침: 폐기') && /까닭: 쓰지 않는 항목/.test(w.body)), '이력에 남는다(기록이 아니다)')
})
