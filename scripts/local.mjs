// 로컬 시험 환경 — 팀 서버 하나와 내 PC 프로그램 하나를 이 PC 에 같이 띄운다(서로 이어진 채로).
//
//   팀   http://localhost:7381  — 지식 dpms · gdi(시험 지식 사본) · 사람 kim(관리자) · park(dpms 주인) · lee
//   PC   http://127.0.0.1:7382  — kim 의 내 지식 배포노트(→ 팀 dpms 로 보냄) · 설계메모 · 받은편지함
//   자리 .kmd-data/local/ (무시 목록) — 지우면 처음 상태로. 진짜 D:\kmd · Claude Code 설정 · 자격 저장소는 건드리지 않는다.
//   Claude 는 이 PC 의 진짜 Claude Code(`claude -p` · 이 PC 의 로그인 · 설정 › Claude 연결에서 받은 로그인) — 들이기 · 정리를 실제로 본다.
//   가짜(test/fixture)로 돌리려면 KMD_LOCAL_FAKE_CLAUDE=1 — 정리 · 로그인이 진짜 Claude 없이 돈다.
// 쓰기: node scripts/local.mjs   (끄기: Ctrl C)

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.KMD_LOCAL_DIR ? path.resolve(process.env.KMD_LOCAL_DIR) : path.join(ROOT, '.kmd-data', 'local') // 다른 사본으로 따로 띄우려면 KMD_LOCAL_DIR
const TEAM = path.join(BASE, 'team')
const PC = path.join(BASE, 'pc')
const TEAM_PORT = Number(process.env.KMD_LOCAL_PORT) || 7381 // 다른 작업 폴더의 로컬 환경과 겹치면 KMD_LOCAL_PORT 로 옮긴다
const PC_PORT = TEAM_PORT + 1
const PW = { kim: 'kim-password-1', park: 'park-password-1', lee: 'lee-password-1' }

process.env.KMD_NO_CLAUDE = '1' // claude mcp add 를 부르지 않는다
if (process.env.KMD_LOCAL_FAKE_CLAUDE) {
  process.env.KMD_CLAUDE = path.join(ROOT, 'test', 'fixture', 'fake-claude.mjs')
  process.env.KMD_CLAUDE_LOGIN = path.join(ROOT, 'test', 'fixture', 'fake-claude-login.mjs')
} else {
  delete process.env.KMD_CLAUDE
  delete process.env.KMD_CLAUDE_LOGIN
}

const { startServer } = await import('../server/http.js')
const { runWorker } = await import('../core/worker.js')
const { prehash } = await import('../app/prehash.js')

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name))
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name))
  }
}
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const bare = (p) => { if (!fs.existsSync(p)) execFileSync('git', ['init', '-q', '--bare', '-b', 'main', p]) }

const first = !fs.existsSync(BASE)
if (first) {
  copyDir(path.join(ROOT, 'test', 'fixture', 'kmd'), TEAM)
  write(path.join(TEAM, '.kmd', 'serve.json'), JSON.stringify({ pcUrl: `http://127.0.0.1:${PC_PORT}`, sourceRoots: [path.join(BASE, 'src')], backupRoots: [path.join(BASE, 'bk')], decideMs: 60000 }, null, 1))
  write(path.join(PC, '배포노트', 'README.md'), '# 배포노트\n')
  write(path.join(PC, '배포노트', 'docs', '카나리 메모.md'), '# 카나리 메모\n\n## 카나리\n첫 30분은 요청의 10% 만 새 판으로.\n\n## 헬스 체크\n3초 안에 200.\n')
  write(path.join(PC, '설계메모', 'README.md'), '# 설계메모\n')
  write(path.join(PC, '설계메모', 'docs', '배치 설계.md'), '# 배치 설계\n\n## 재시도\n실패하면 5분 뒤 한 번 더.\n')
  write(path.join(PC, '받은편지함', 'README.md'), '# 받은편지함\n')
  write(path.join(PC, '받은편지함', 'docs', '처음.md'), '# 처음\n\n## 개요\n넣은 파일이 여기로 온다.\n')
  write(path.join(BASE, 'src', 'dpms-api', 'package.json'), JSON.stringify({ dependencies: { express: '^4.19.2', pg: '8.11.0', 'spring-like': '3.3.4' } }, null, 1))
  fs.mkdirSync(path.join(BASE, 'bk'), { recursive: true })
}

const log = () => {}
// 이 PC 의 기기 열쇠 — 짝을 지을 때 팀 서버에 「들어온 사람 = 이 PC 를 이은 사람」 인지 묻는다(진짜 자격 저장소 대신 메모리로)
let kimKey = null
const pc = await startServer({ root: PC, mode: 'pc', user: 'kim', port: PC_PORT, log, scryptN: 1 << 15, deviceKey: async () => kimKey })
const team = await startServer({ root: TEAM, port: TEAM_PORT, log, scryptN: 1 << 15 })
// 쿠키는 포트를 가리지 않는다 — 팀은 localhost · PC 는 127.0.0.1 로 호스트 이름을 갈라 두 화면의 들어가기가 서로 덮지 않게
const TEAM_URL = `http://localhost:${TEAM_PORT}`
write(path.join(PC, '.kmd', 'teams.json'), JSON.stringify([TEAM_URL]))

const SHELL = { user: 'kmd', admin: true, shell: true }
if (first) {
  for (const id of ['kim', 'park', 'lee']) {
    const { code } = await team.auth.addUser({ id, admin: id === 'kim' })
    await team.auth.first({ code, pw: prehash(id, PW[id]) })
  }
  await team.hub.setOwner(SHELL, 'dpms', { owner: 'park', curators: ['park'] })
  for (const k of ['dpms', 'gdi']) { const b = path.join(BASE, 'bk', `${k}.git`); bare(b); await team.hub.backupAttach(SHELL, k, b).catch(() => {}) }
  // 정리할 것 몇 개 — lee 가 남긴 기록
  await team.hub.save({ user: 'lee' }, 'dpms', { record: { title: '카나리 비율', body: '첫 30분 요청 10% → 20%', touches: ['proc:카나리'] } })
  await team.hub.save({ user: 'lee' }, 'dpms', { record: { title: '알람: 당번 채널', body: '받는 곳에 #ops-oncall 도 더한다.', touches: ['term:알람'] } })
  // PC — 배포노트는 팀 dpms 로 보낸다 · 백업은 다른 폴더
  await pc.hub.sendDests({ user: pc.pcUser, pc: true }, '배포노트', [{ kn: 'dpms', url: TEAM_URL }])
  for (const k of ['배포노트', '설계메모', '받은편지함']) { const b = path.join(BASE, 'pc-bk', `${k}.git`); fs.mkdirSync(path.dirname(b), { recursive: true }); bare(b); await pc.hub.backupAttach(SHELL, k, b).catch(() => {}) }
}
// kim 의 「설치 한 줄로 이은 PC」 — 팀 화면이 내 PC 를 묻고, PC 의 보내기가 이 열쇠로 팀에 닿는다
kimKey = await team.auth.deviceKeyFor('kim', { host: 'LOCAL-PC', osuser: 'kim' })
process.env.KMD_SEND_KEY = kimKey
runWorker({ server: team.url, key: (await team.auth.workerAdd()).key, poll: 3000, log })
runWorker({ server: pc.url, key: (await pc.auth.workerAdd()).key, poll: 3000, log })
// kim 의 PC 일꾼 — 팀 서버의 kim 개인 지식 일감을 이 PC 의 Claude 로(kmd up 의 `kmd worker mine` 과 같은 일)
runWorker({ server: team.url, key: (await team.auth.workerAdd({ owner: 'kim', device: team.auth.bearer(kimKey).device })).key, poll: 3000, log })

// PC 화면은 들어가기가 없다 — 한 번용 번호(60초)가 든 주소로 연다. 50초마다 새로 적는다
const linkFile = path.join(BASE, 'PC-열기.txt')
const freshLink = () => { const u = `${pc.url}/#once=${pc.auth.once(pc.pcUser)}`; fs.writeFileSync(linkFile, u + '\n'); return u }
const u = freshLink()
setInterval(freshLink, 50_000)

console.log(`
kmd 로컬 시험 환경${first ? ': 처음 세움' : ''}
  팀  ${TEAM_URL}   kim / ${PW.kim} (관리자) · park / ${PW.park} (dpms 주인) · lee / ${PW.lee}
  PC  ${u}
      (60초 안에 연다. 새 주소는 ${path.relative(ROOT, linkFile)} 에 50초마다)
  자리 ${path.relative(ROOT, BASE)}: 지우면 처음 상태로 · 끄기 Ctrl C
`)
const stop = async () => { await team.close(); await pc.close(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
