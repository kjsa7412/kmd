// 저장 측정 읽기(scripts/savelog.mjs · 설계 9절 · K12-2 · K12-4) — 픽스처 jsonl 로 통과율 · 다시 넣은 비율 · 동시 쓰기 짝 · 정리 장부 비교 · 날마다 열린 넣지 못함
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs, readLines, summarize, readTidy, trend, main } from '../scripts/savelog.mjs'
import { renderRecord } from '../core/frontmatter.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', 'scripts', 'savelog.mjs')
let tmp, data

const L = (o) => JSON.stringify({ kn: 'dpms', device: null, kit: 2, stale: [], conflictWith: [], memo: false, same: false, err: null, cost: null, ...o })
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-savelog-'))
  data = path.join(tmp, '.kmd')
  fs.mkdirSync(path.join(data, 'savelog'), { recursive: true })
  fs.mkdirSync(path.join(data, 'tidy'), { recursive: true })
  const dpms = [
    // 김: 조각 둘 중 하나 넣지 못함 → 10분 뒤 그 자리를 넣음(다시 넣음 1/1)
    L({ at: '2026-11-10 09:00', user: 'kim', ch: 'session', rec: 'r1', n: 2, put: 1, ok: ['proc:카나리'], held: [{ code: 'values', coord: 'proc:롤백', why: '기록의 값이 글에 없다: 30분' }], ms: 800 }),
    L({ at: '2026-11-10 09:10', user: 'kim', ch: 'session', rec: 'r2', n: 1, put: 1, ok: ['proc:롤백'], held: [], ms: 400 }),
    // 이: E_CONFLICT(가져올 곳이 먼저 넣은 항목) → 한 시간 뒤에야 넣음(30분 넘음 · 다시 넣음 아님)
    L({ at: '2026-11-10 10:00', user: 'lee', ch: 'session', n: 1, stale: ['proc:헬스 체크'], conflictWith: [{ coord: 'proc:헬스 체크', by: 'kmd' }], ms: 200, err: 'E_CONFLICT' }),
    L({ at: '2026-11-10 11:05', user: 'lee', ch: 'session', rec: 'r3', n: 1, put: 1, ok: ['proc:헬스 체크'], held: [], ms: 600 }),
    // 옛 판 스킬 · 메모 · 같은 것
    L({ at: '2026-11-11 09:00', user: 'park', ch: 'session', kit: 1, rec: 'r4', n: 0, put: 0, held: [], memo: true, ms: 100 }),
    L({ at: '2026-11-11 09:01', user: 'park', ch: 'session', kit: null, rec: 'r4', n: 0, put: 0, held: [], same: true, ms: 50 }),
    // 대량 넣기 · 다른 사람이 먼저 넣은 항목과 겹침
    L({ at: '2026-11-12 09:00', user: 'kim', ch: 'bulk', rec: 'r5', n: 4, put: 3, ok: ['a', 'b', 'c'], held: [{ code: 'format', coord: 'd', why: '꼴' }], ms: 4000 }),
    L({ at: '2026-11-12 09:30', user: 'kim', ch: 'bulk', n: 1, stale: ['a'], conflictWith: [{ coord: 'a', by: 'lee' }], ms: 100, err: 'E_CONFLICT' }),
    '{깨진 줄',
  ]
  fs.writeFileSync(path.join(data, 'savelog', 'dpms.jsonl'), dpms.join('\n') + '\n')
  fs.writeFileSync(path.join(data, 'savelog', 'gdi.jsonl.1'), L({ kn: 'gdi', at: '2026-11-09 09:00', user: 'kim', ch: 'http', rec: 'g1', n: 1, put: 0, held: [{ code: 'conflict', coord: 'x', why: '그사이' }], ms: 300 }) + '\n')
  // 정리 장부(비교 기준) — 자리 넷 가운데 하나 넣음 · 자리 시간 3분 · 5분
  fs.writeFileSync(path.join(data, 'tidy', 'dpms.json'), JSON.stringify([{ at: '2026-11-10T01:00:00.000Z', rows: [{ kind: 'put' }, { kind: 'left' }, { kind: 'left' }, { kind: 'left' }, { kind: 'stopped' }], took: [{ ms: 180_000 }, { ms: 300_000 }] }]))
  // 지식 폴더(날마다 열린 넣지 못함 · 메모) — 넣지 못함 하나(11일 바로잡힘) · 메모 하나(열림)
  const kn = path.join(tmp, 'dpms')
  fs.mkdirSync(path.join(kn, 'work'), { recursive: true })
  fs.mkdirSync(path.join(kn, 'docs'), { recursive: true })
  const rec = (o) => fs.writeFileSync(path.join(kn, 'work', `${o.id}.md`), renderRecord({ author: 'kim', touchesEmpty: '시험', ...o }, '본문'))
  rec({ id: 'h1', title: '넣지 못함', date: '2026-11-10 09:00', tags: ['held'] })
  rec({ id: 'm1', title: '메모', date: '2026-11-10 12:00', tags: ['memo'] })
  rec({ id: 'f1', title: '고쳐 다시', date: '2026-11-11 09:00', tags: ['put'], fixes: ['h1'] })
  // 넣지 못함 하나 더(h2) — 12일 정리 판정 「두기」(kept)로 닫힘(화면 · brief 의 넣지 못함 셈과 같게)
  rec({ id: 'h2', title: '넣지 못함 둘', date: '2026-11-10 10:00', tags: ['held'] })
  rec({ id: 'k1', title: '정리 판정', date: '2026-11-12 08:00', author: 'kmd', tags: ['curate-auto'], curates: [{ id: 'h2', verdict: 'keep', reason: '시험' }] })
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('줄 읽기 · 거르기: 지식 · 날 · 채널 · 돌려 둔 .1 파일 · 깨진 줄은 세기만', async () => {
  const all = await readLines(data)
  assert.equal(all.lines.length, 9)
  assert.equal(all.broken, 1)
  assert.equal(all.lines[0].kn, 'gdi', '.jsonl.1 도 읽고 시각 순')
  assert.equal((await readLines(data, { kn: 'dpms' })).lines.length, 8)
  assert.equal((await readLines(data, { since: '2026-11-11', until: '2026-11-11' })).lines.length, 2)
  assert.equal((await readLines(data, { ch: ['bulk'] })).lines.length, 2)
  assert.throws(() => parseArgs(['--since', '11-10', data]), /YYYY-MM-DD/)
  assert.throws(() => parseArgs([]), /쓰는 법/)
})

test('채널마다 통과율 · 까닭 · E_CONFLICT · 다시 넣은 비율(30분 안 · 같은 사람 · 같은 자리) · 자리당 시간 · 스킬 판 · 동시 쓰기 짝', async () => {
  const s = summarize((await readLines(data, { kn: 'dpms' })).lines)
  const se = s.channels.find((c) => c.ch === 'session')
  assert.equal(se.saves, 5, '실패 줄은 저장이 아니다')
  assert.equal(se.same, 1)
  assert.equal(se.memo, 1)
  assert.equal(se.pieces, 4)
  assert.equal(se.put, 3)
  assert.equal(se.pass, 0.75)
  assert.equal(se.goal.pass, true, '70% 목표')
  assert.equal(se.conflicts, 1)
  assert.deepEqual(se.reasons, [{ why: 'values · 기록의 값이 글에 없다: 30분', n: 1 }])
  assert.deepEqual(se.retry, { events: 2, done: 1, ratio: 0.5 }, '넣지 못함 뒤 10분은 다시 넣음 · E_CONFLICT 뒤 65분은 아님')
  assert.deepEqual(se.kits, { 2: 4, 1: 1, '없음': 1 })
  // 자리당 시간 — ms / 조각의 중앙값(800/2 · 400/1 · 600/1 → 400)
  assert.equal(se.msPerSpot, 400)
  assert.equal(se.goal.time, true)
  const bu = s.channels.find((c) => c.ch === 'bulk')
  assert.equal(bu.pass, 0.75)
  assert.deepEqual(bu.retry, { events: 2, done: 0, ratio: 0 })
  assert.deepEqual(s.pairs, [{ pair: 'session ↔ kmd(가져올 곳 · 정리)', n: 1 }, { pair: 'bulk ↔ 다른 사람', n: 1 }].sort((a, b) => b.n - a.n))
})

test('정리 장부 비교 · 날마다 열린 넣지 못함 · 메모(바로잡힌 날 · 두기 판정 날 닫힘)', async () => {
  const t = await readTidy(data, { kn: 'dpms' })
  assert.deepEqual(t, { runs: 1, spots: 4, put: 1, pass: 0.25, msPerSpot: 240_000 })
  assert.equal(await readTidy(data, { kn: 'gdi' }), null)
  const rows = await trend(tmp, { kn: 'dpms', since: '2026-11-09', until: '2026-11-12' })
  assert.deepEqual(rows, [
    { day: '2026-11-09', held: 0, memo: 0 },
    { day: '2026-11-10', held: 2, memo: 1 },
    { day: '2026-11-11', held: 1, memo: 1 },
    { day: '2026-11-12', held: 0, memo: 1 },
  ])
  const j = JSON.parse(await main([data, '--kn', 'dpms', '--json', '--trend', '--since', '2026-11-10', '--until', '2026-11-10']))
  assert.equal(j.channels[0].ch, 'session')
  assert.equal(j.tidy.pass, 0.25)
  assert.deepEqual(j.trend, [{ day: '2026-11-10', held: 2, memo: 1 }], 'data 폴더가 .kmd 면 그 위가 지식 폴더')
})

test('명령: node scripts/savelog.mjs <data> 가 표를 낸다', async () => {
  const out = await new Promise((ok) => {
    const c = spawn(process.execPath, [SCRIPT, data, '--kn', 'dpms'])
    const o = []
    c.stdout.on('data', (d) => o.push(d))
    c.stderr.on('data', (d) => o.push(d))
    c.on('close', (status) => ok({ status, text: Buffer.concat(o).toString('utf8') }))
  })
  assert.equal(out.status, 0, out.text)
  assert.match(out.text, /^저장 측정\(savelog\) — 지식 dpms · 모든 날 · 줄 8 · 깨진 줄 1/)
  assert.match(out.text, /\nsession\s+5\s+1\s+1\s+4\s+3\s+75% ✓/)
  assert.match(out.text, /비교 기준 · 정리 장부\(tidy\/\): 정리 1번 · 자리 4 · 넣음 1 · 넣음 비율 25% · 자리당 4\.0분/)
  assert.match(out.text, /동시 쓰기\(K12-4\): session ↔ kmd\(가져올 곳 · 정리\) 1 · bulk ↔ 다른 사람 1/)
  const bad = await new Promise((ok) => { const c = spawn(process.execPath, [SCRIPT]); c.on('close', ok) })
  assert.equal(bad, 1, '쓰는 법이 틀리면 1')
})
