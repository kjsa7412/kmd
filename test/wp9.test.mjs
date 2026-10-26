// WP9 필수 — 상태 · 말 바로잡기(제품화 검토 v0.1 F-052 · F-064 · F-065 · F-069 · F-074 · F-018 · F-032).
//
// 기록이 언제 문서에 들어가는지 지식마다(정리 방식 · 시각) · 이력의 저장 줄은 그 기록의 지금 상태 · 오류 글 · 화면 글에 금지어 0 ·
// 이 PC 의 멈춤 줄은 팀 서비스의 말(관리 › …)을 쓰지 않는다 · 일을 하는 관리 줄은 단추 · 「가져오기」 · 「새 지식」.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BANNED = ['좌표', '섹션', '원천', '기준선', '큐레이션', '대기열', '판정', '토큰', '커밋', '레포', '미러', 'LLM', 'RAG', '노드', '엣지', '백링크']
let tmp, root, s

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wp9-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(path.join(root, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(root, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000 }))
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('오류 글 · 화면 글에 금지어 0 — 사람에게 가는 KmdError 글과 화면의 글 틀', () => {
  const bad = []
  for (const f of [...fs.readdirSync(path.join(HERE, '..', 'core')).map((x) => 'core/' + x), ...fs.readdirSync(path.join(HERE, '..', 'server')).filter((x) => x.endsWith('.js')).map((x) => 'server/' + x)]) {
    if (!f.endsWith('.js')) continue
    const t = fs.readFileSync(path.join(HERE, '..', f), 'utf8')
    for (const m of t.matchAll(/KmdError\('E_[A-Z_]+', [`'"]([^`'"]*)/g)) for (const w of BANNED) if (m[1].includes(w)) bad.push(`${f}: ${m[1]}`)
  }
  // 화면 — 주석을 뺀 줄의 글 틀에서
  const ui = fs.readFileSync(path.join(HERE, '..', 'app', 'main.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  for (const w of ['토큰', '카탈로그', '덩이', '변경사항', '전체 체크', '지식 만들기', '지식 추가']) if (ui.includes(w)) bad.push(`app/main.js: ${w}`)
  assert.deepEqual(bad, [])
})

test('기록이 언제 문서에 — 지식의 정리 방식 · 시각 · 이력의 저장 줄은 그 기록의 지금 상태', async () => {
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'park', tidyAt: '03:30' })
  assert.equal(s.hub.pendText('dpms'), '정해진 시각 03:30 정리 때 문서에 들어간다')
  await s.hub.setOwner(SHELL, 'dpms', { tidyMode: 'manual' })
  assert.match(s.hub.pendText('dpms'), /정리하는 사람이 \[지금 정리\] 를 누를 때/)
  await s.hub.setOwner(SHELL, 'dpms', { tidyMode: 'live' })
  assert.match(s.hub.pendText('dpms'), /조용해지면 바로/)
  const r = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '헬스 체크 — 주기', touches: ['proc:헬스 체크'], body: '15초' } })
  let h
  for (let i = 0; i < 100 && !(h = await s.hub.history({ user: 'lee' })).some((x) => x.rec === r.id); i++) await new Promise((ok) => setTimeout(ok, 50))
  assert.match(h.find((x) => x.rec === r.id).sub, /조용해지면 바로 문서에 들어간다/)
  // 들어간 뒤 — 「들어갔다」
  await s.hub.save({ user: 'kmd-auto' }, 'dpms', { record: { title: '정리 — 헬스 체크', tags: ['curate-auto'], reflects: [r.id], body: `- 넣음 ${r.id} — 헬스 체크` }, sections: [{ coord: 'proc:헬스 체크', content: '15초' }] }, { system: true })
  h = await s.hub.history({ user: 'lee' })
  assert.equal(h.find((x) => x.rec === r.id).sub, '문서에 들어갔다')
})

test('이 PC 의 멈춤 줄은 팀 서비스의 말을 쓰지 않는다 — 「설정 › Claude 연결」 · 「백업 안 된 저장 n번」', async () => {
  const pcRoot = path.join(tmp, 'pc')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), path.join(pcRoot, '메모'))
  const pc = await startServer({ root: pcRoot, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    await pc.hub.workerStatus({ worker: { id: null } }, { ok: false, reason: 'login', message: 'x' })
    const st = await pc.hub.stops({ user: 'kim', admin: true, pc: true })
    const w = st.find((l) => l.kind === 'worker')
    assert.match(w.text, /설정 › Claude 연결/)
    assert.doesNotMatch(w.text, /관리 ›/)
  } finally {
    await pc.close()
  }
})
