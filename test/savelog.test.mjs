// 저장 측정 읽기(scripts/savelog.mjs · 설계 9절 · K12-2 · K12-4) — 픽스처 jsonl 로 통과율 · 다시 넣은 비율 · 동시 쓰기 짝 · 지표 칸
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs, readLines, summarize, main } from '../scripts/savelog.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', 'scripts', 'savelog.mjs')
let tmp, data

const L = (o) => JSON.stringify({ kn: 'dpms', device: null, kit: 2, stale: [], conflictWith: [], same: false, err: null, cost: null, ...o })
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-savelog-'))
  data = path.join(tmp, '.kmd')
  fs.mkdirSync(path.join(data, 'savelog'), { recursive: true })
  const dpms = [
    // 김: 항목 둘 중 하나만 넣음 · 10분 뒤 다른 자리를 넣음
    L({ at: '2026-11-10 09:00', user: 'kim', ch: 'session', rec: 'r1', n: 2, put: 1, ok: ['proc:카나리'], ms: 800 }),
    L({ at: '2026-11-10 09:10', user: 'kim', ch: 'session', rec: 'r2', n: 1, put: 1, ok: ['proc:롤백'], ms: 400 }),
    // 이: E_CONFLICT(가져올 곳이 먼저 넣은 항목) → 한 시간 뒤에야 넣음(30분 넘음 · 다시 넣음 아님)
    L({ at: '2026-11-10 10:00', user: 'lee', ch: 'session', n: 1, stale: ['proc:헬스 체크'], conflictWith: [{ coord: 'proc:헬스 체크', by: 'kmd' }], ms: 200, err: 'E_CONFLICT' }),
    L({ at: '2026-11-10 11:05', user: 'lee', ch: 'session', rec: 'r3', n: 1, put: 1, ok: ['proc:헬스 체크'], ms: 600 }),
    // 옛 판 스킬 · 같은 것
    L({ at: '2026-11-11 09:00', user: 'park', ch: 'session', kit: 1, rec: 'r4', n: 0, put: 0, ms: 100 }),
    L({ at: '2026-11-11 09:01', user: 'park', ch: 'session', kit: null, rec: 'r4', n: 0, put: 0, same: true, ms: 50 }),
    // 대량 넣기 · 다른 사람이 먼저 넣은 항목과 겹침
    L({ at: '2026-11-12 09:00', user: 'kim', ch: 'bulk', rec: 'r5', n: 4, put: 3, ok: ['a', 'b', 'c'], ms: 4000 }),
    L({ at: '2026-11-12 09:30', user: 'kim', ch: 'bulk', n: 1, stale: ['a'], conflictWith: [{ coord: 'a', by: 'lee' }], ms: 100, err: 'E_CONFLICT' }),
    '{깨진 줄',
  ]
  fs.writeFileSync(path.join(data, 'savelog', 'dpms.jsonl'), dpms.join('\n') + '\n')
  fs.writeFileSync(path.join(data, 'savelog', 'gdi.jsonl.1'), L({ kn: 'gdi', at: '2026-11-09 09:00', user: 'kim', ch: 'http', rec: 'g1', n: 1, put: 0, ms: 300 }) + '\n')
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
  assert.equal(se.pieces, 4)
  assert.equal(se.put, 3)
  assert.equal(se.pass, 0.75)
  assert.equal(se.goal.pass, true, '70% 목표')
  assert.equal(se.conflicts, 1)
  assert.deepEqual(se.retry, { events: 1, done: 0, ratio: 0 }, 'E_CONFLICT 뒤 65분은 다시 넣음이 아니다')
  assert.deepEqual(se.kits, { 2: 4, 1: 1, '없음': 1 })
  // 자리당 시간 — ms / 항목의 중앙값(800/2 · 400/1 · 600/1 → 400)
  assert.equal(se.msPerSpot, 400)
  assert.equal(se.goal.time, true)
  const bu = s.channels.find((c) => c.ch === 'bulk')
  assert.equal(bu.pass, 0.75)
  assert.deepEqual(bu.retry, { events: 1, done: 0, ratio: 0 })
  assert.deepEqual(s.pairs, [{ pair: 'session ↔ kmd(가져올 곳 · 들이기)', n: 1 }, { pair: 'bulk ↔ 다른 사람', n: 1 }].sort((a, b) => b.n - a.n))
})

test('json: 채널 표만(정리 장부 비교는 걷었다)', async () => {
  const j = JSON.parse(await main([data, '--kn', 'dpms', '--json', '--since', '2026-11-10', '--until', '2026-11-10']))
  assert.equal(j.channels[0].ch, 'session')
  assert.equal(j.tidy, undefined)
  assert.equal(j.channels[0].memo, undefined)
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
  assert.match(out.text, /\nsession\s+5\s+1\s+4\s+3\s+75% ✓/)
  assert.doesNotMatch(out.text, /정리 장부|메모|넣지못함/)
  assert.match(out.text, /동시 쓰기\(K12-4\): session ↔ kmd\(가져올 곳 · 들이기\) 1 · bulk ↔ 다른 사람 1/)
  const bad = await new Promise((ok) => { const c = spawn(process.execPath, [SCRIPT]); c.on('close', ok) })
  assert.equal(bad, 1, '쓰는 법이 틀리면 1')
})

test('지표 칸(P-D37 · P10): 무인 값 경고 · 고쳐 받기 · 다시 대기 · 입력 오류 · core/metrics.js 지표 줄 여섯(기간 · 새로 생긴 것은 fresh 표지)', async () => {
  const { metricsOf, readKnLines, daysOf, sinceOf } = await import('../core/metrics.js')
  const lines = [
    { at: '2026-11-10 10:00', kn: 'apv', user: 'wr', ch: 'session', err: 'E_INPUT', mode: 'approve', code: ['format'] },
    { at: '2026-11-10 10:01', kn: 'apv', user: 'wr', ch: 'session', rec: 'a1', n: 1, put: 1, mode: 'approve', accepted: ['missing'], rounds: 3, linked: 0, fresh: 1 },
    { at: '2026-11-10 10:02', kn: 'apv', user: 'kmd', ch: 'intake', rec: 'u1', n: 1, put: 1, mode: 'approve', warned: ['invented', 'missing'], fix: 2, conflict: 1, linked: 0, fresh: 0 },
    { at: '2026-11-10 10:03', kn: 'apv', user: 'kmd', ch: 'intake', rec: 'u2', n: 1, put: 1, mode: 'approve', warned: [], linked: 0, fresh: 0 },
    { at: '2026-11-10 10:04', kn: 'apv', user: 'wr', ch: 'session', rec: 'old', n: 1, put: 1 },
    // 무인 실패 줄(지식 생성 하네스 H4b) — 첫 시도 실패 둘 · 그 가운데 하나는 끝내 실패
    { at: '2026-11-10 10:05', kn: 'apv', by: 'kmd', ch: 'intake-file', job: 'j1', rec: null, mode: 'approve', err: 'unattended', fail: { n: 1, code: 'check', final: false } },
    { at: '2026-11-10 10:06', kn: 'apv', by: 'kmd', ch: 'intake-file', job: 'j2', rec: null, mode: 'approve', err: 'unattended', fail: { n: 1, code: 'nosave', final: false } },
    { at: '2026-11-10 10:07', kn: 'apv', by: 'kmd', ch: 'intake-file', job: 'j2', rec: null, mode: 'approve', err: 'unattended', fail: { n: 4, code: 'nosave', final: true, same: true } },
  ]
  const s = summarize(lines)
  const a = s.channels.find((c) => c.ch === 'intake').approve
  assert.deepEqual([a.un, a.warnedSaves, a.warned.invented, a.warnedRatio, a.fix, a.conflict], [2, 1, 1, 0.5, 2, 1])
  assert.deepEqual(s.channels.find((c) => c.ch === 'session').approve.code, { format: 1 })
  // 지표 줄 — 기록 이름 · 새로 생긴 것(기간 안 fresh 표지)
  const works = [
    { id: 'a1', title: '사람 저장', date: '2026-11-10 10:01', author: 'wr', body: '본문\n\n## 새로 세움\n- 문서 docs/새 문서.md\n- 이름 sys:새것\n' },
    { id: 'z9', title: '옛 것', date: '2026-10-01 10:01', author: 'wr', body: '## 새로 세움\n- 문서 docs/옛 문서.md\n' },
    { id: 'u1', title: '들인 것', date: '2026-11-10 10:02', author: 'kmd', body: '' },
  ]
  const m = metricsOf(lines, { works, days: 14, now: new Date('2026-11-11T12:00:00') })
  const by = Object.fromEntries(m.rows.map((r) => [r.key, r]))
  assert.deepEqual(m.rows.map((r) => r.key), ['fresh', 'accepted', 'warned', 'fail', 'fix', 'rounds'])
  assert.deepEqual([by.fresh.n, by.fresh.recs.map((x) => x.rec), by.fresh.codes], [2, ['a1'], { 문서: 1, 이름: 1 }])
  assert.deepEqual([by.accepted.n, by.accepted.base, by.accepted.recs[0].title], [1, 1, '사람 저장'])
  assert.deepEqual([by.warned.n, by.warned.base, by.warned.codes], [1, 2, { invented: 1, missing: 1 }])
  // 무인 실패 — 첫 시도 실패 2 / 무인 일감 3(들어간 무인 저장 2 + 끝내 실패 1)
  assert.deepEqual([by.fail.n, by.fail.base, by.fail.codes, by.fix.n, by.rounds.n], [2, 3, { check: 1, nosave: 1, '끝내 실패': 1 }, 2, 2])
  assert.deepEqual([daysOf('30'), daysOf('5'), daysOf(null), sinceOf(14, new Date('2026-11-14T09:00:00'))], [30, 14, 14, '2026-11-01'])
  // 기록 목록은 새 것 위 · 50 까지(줄이 많아도 최근 것이 빠지지 않는다)
  const many = Array.from({ length: 300 }, (_, i) => ({ at: '2026-11-10 ' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'), ch: 'intake', rec: 'r' + i, mode: 'approve', warned: ['missing'] }))
  const w2 = metricsOf(many, { days: 14, now: new Date('2026-11-11T12:00:00') }).rows.find((r) => r.key === 'warned')
  assert.deepEqual([w2.n, w2.recs.length, w2.recs[0].rec], [300, 50, 'r299'])
  // 파일 읽기 — 기간 밖 · 깨진 줄
  const r = await readKnLines(data, 'dpms', '2026-11-11')
  assert.deepEqual([r.lines.length, r.broken], [4, 1])
})
