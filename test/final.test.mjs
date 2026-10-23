// P5 끝 시험 — 여덟 칸(보기 · 찾기 0 ~ 4단 · 고치기 · 저장이 곧 반영 · 세션 저장 · 보내기 · 저절로 채우는 표 · 정리)을
// 팀 모드와 PC 모드로 돌려 결과가 같다 · 자동 쓰기 표 밖의 무인 커밋 0.
//
// 허용된 차이 다섯(결과 비교에서 뺀다) — ① 들어가기(팀은 비밀번호 · PC 는 없음) ② 기록 작성자 이름(팀 아이디 · PC 사용자)
// ③ 백업 자리(팀은 관리자가 · PC 는 설치가) ④ 이 PC 폴더 원천(팀은 sourceRoots 안만) ⑤ 팀 화면의 「내 PC」 줄.
// 설정 차이(뜻 꾸러미 · Claude 자격)는 목록으로 — 둘 다 가짜 claude · 같은 뜻 꾸러미.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce } from '../core/worker.js'
import { SYSTEM_TAGS } from '../core/knowledge.js'
import { parseRecord } from '../core/frontmatter.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp
const G = (dir, ...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-p5-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  const src = path.join(tmp, 'src', 'dpms-api')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ dependencies: { express: '^4.19.2', pg: '8.11.0' } }))
})
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {} })

async function eight(mode) {
  const root = path.join(tmp, mode)
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(path.join(root, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(root, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceRoots: [path.join(tmp, 'src')], tidyTickMs: 3600000, sourceTickMs: 3600000 }))
  const s = await startServer({ root, mode, user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const KIM = mode === 'pc' ? { user: s.pcUser, admin: true, pc: true } : { user: 'kim', admin: true }
    const key = mode === 'pc' ? await s.auth.deviceKeyFor(s.pcUser, { host: 'T' }) : (await signIn(s, { id: 'kim' })).key
    const out = {}
    // ① 보기
    const k = await s.hub.get('dpms', KIM)
    out.view = { docs: k.docs.length, records: k.works.length, sections: k.docs.find((d) => d.id === '배포절차').sections.map((x) => x.h) }
    // ② 찾기 — 딱 맞는 이름 · 다른 이름 · 비슷한 글
    const f1 = (await s.hub.search(KIM, 'dpms', { q: '헬스 체크' }))[0]
    const f2 = (await s.hub.search(KIM, 'dpms', { q: '상태 점검' }))[0]
    const f3 = (await s.hub.search(KIM, 'dpms', { q: '첫 30분 요청 비율은 얼마인가' }))[0]
    out.find = { exact: f1.exact.map((x) => x.coord || x.name), alias: f2.exact.map((x) => x.coord || x.name), passages: f3.passages.length > 0 || f3.coords.length > 0 }
    // ③ 고치기 · ④ 저장이 곧 반영
    const e = await s.hub.edit(KIM, 'dpms', { doc: '배포절차', sections: [{ h: '카나리', body: '첫 30분은 요청의 20% 만 새 판으로 보낸다.' }] })
    out.edit = { direct: e.direct, state: (await s.hub.get('dpms')).byWork.get(e.id)?.state, doc: (await s.hub.get('dpms')).docs.find((d) => d.id === '배포절차').sections.find((x) => x.h === '카나리').body.includes('20%') }
    // ⑤ 세션 저장 — MCP save(기기 열쇠)
    const r = await fetch(s.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save', arguments: { knowledge: 'dpms', record: { title: '롤백 — DB 먼저 멈춤', body: '세션에서 — 롤백 전에 쓰기를 멈춘다.', touches: ['proc:롤백'] } } } }) }).then((x) => x.json())
    const sid = r.result.structuredContent.id
    out.session = { ok: !r.result.isError, touches: (await s.hub.get('dpms')).byWork.get(sid)?.touches }
    // ⑥ 보내기 — gdi → dpms(같은 kmd)
    await s.hub.sendDests(KIM, 'gdi', [{ kn: 'dpms' }])
    const gdoc = (await s.hub.get('gdi')).docs[0]
    await s.hub.edit(KIM, 'gdi', { doc: gdoc.id, sections: [{ h: gdoc.sections[0].h, body: '보내기 시험 — 고친 글.' }] })
    const sent = await s.hub.send(KIM, 'gdi')
    out.send = { sent: sent.sent, got: (await s.hub.get('dpms')).works.filter((w) => w.tags.some((t) => t.startsWith('sent/'))).length }
    // ⑦ 저절로 채우는 표 — 이 PC 폴더의 package.json → 꾸러미 판
    const a = await s.hub.sourceAdd(KIM, 'dpms', { name: 'dpms-api 코드', at: path.join(tmp, 'src', 'dpms-api'), kind: 'folder', rules: [{ rule: 'deps', into: { doc: '배포절차', heading: '꾸러미 판' } }] })
    const again = await s.hub.sourceRun('dpms', 'dpms-api 코드')
    const body = (await s.hub.get('dpms')).docs.find((d) => d.id === '배포절차').sections.find((x) => x.h === '꾸러미 판').body
    out.table = { first: a.run[0].state, again: again[0].state, rows: ['express', 'pg'].every((n) => body.includes(n)) }
    // ⑧ 정리 — 팀 모두의 기록 → [지금 정리] → 일꾼(가짜 claude) → 넣음
    await s.hub.save(mode === 'pc' ? KIM : { user: 'lee' }, 'dpms', { record: { title: '헬스 체크 — 시간 초과 5초', body: '헬스 체크는 5초 안에 200 이 와야 통과.', touches: ['proc:헬스 체크'] } })
    const job = await s.hub.tidyNow(KIM, 'dpms')
    await workOnce({ server: s.url, key: (await s.auth.workerAdd()).key })
    const j = s.hub.job(job.id)
    out.tidy = { state: j.state, done: !!j.summary && j.summary.put + j.summary.changed >= 1 }
    // 무인 커밋 — 사람 아닌 작성자의 기록은 자동 쓰기 표의 태그만
    const dir = path.join(root, 'dpms')
    const bad = []
    for (const f of fs.readdirSync(path.join(dir, 'work'))) {
      const w = parseRecord(fs.readFileSync(path.join(dir, 'work', f), 'utf8'), f)
      if (!w || !['kmd', 'kmd-auto', 'kmd-worker'].includes(w.author)) continue
      if (!w.tags.some((t) => [...SYSTEM_TAGS, 'sources'].includes(t))) bad.push(`${w.author} ${f} [${w.tags}]`)
    }
    // 사람 아닌 작성자의 묶음마다 — 자동 쓰기 표의 기록(work/*.md)을 싣거나, kmd 가 쓰는 파일만 건드리거나, 처음 묶음
    const loose = []
    for (const l of G(dir, 'log', '--format=%H|%an|%s').split('\n')) {
      const [sha, an, subj] = l.split('|')
      if (!/^kmd(-auto|-worker)?$/.test(an) || subj === '처음 — 있던 글') continue
      const files = G(dir, 'show', '--name-only', '--format=', sha).split('\n').filter(Boolean)
      if (files.some((f) => /^work\/[^/]+\.md$/.test(f)) || files.every((f) => ['_members.md', '_sources.json', '.kmd.json'].includes(f))) continue
      loose.push(`${an} ${subj}`)
    }
    out.unattended = { bad, commitsWithoutRecord: loose }
    return out
  } finally {
    await s.close()
  }
}

test('여덟 칸 — 팀 모드와 PC 모드의 결과가 같다 · 자동 쓰기 표 밖의 무인 커밋 0', async () => {
  const team = await eight('team')
  const pc = await eight('pc')
  assert.deepEqual(team.unattended, { bad: [], commitsWithoutRecord: [] })
  assert.deepEqual(pc.unattended, { bad: [], commitsWithoutRecord: [] })
  assert.equal(team.find.exact[0], 'proc:헬스 체크')
  assert.equal(team.find.alias[0], 'proc:헬스 체크')
  assert.deepEqual(team.edit, { direct: true, state: 'in', doc: true })
  assert.deepEqual(team.send, { sent: 1, got: 1 })
  assert.deepEqual(team.table, { first: 'changed', again: 'same', rows: true })
  assert.deepEqual(team.tidy, { state: 'done', done: true })
  assert.equal(team.session.ok, true)
  assert.deepEqual(pc, team, '두 모드의 결과가 같다')
})
