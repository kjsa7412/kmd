// 설치 한 줄의 출력 — ✓ 넷과 값이 있는 흐린 줄 셋(목업 M1). 묻는 것 없이 끝난다.
//
//   ✓ D:\kmd 에 세웠다 · 백업은 E:\kmd-백업 — 바꾸려면 설정
//       폴더 넷이 그대로 지식이 됐다 — 배포노트 · 설계메모 · …
//   ✓ 팀 kmd.team.local 에 김으로 이었다
//       김의 「오늘 바뀐 것」 에 「새 기기가 이어졌다 — DESKTOP-KIM · kim」 한 줄이 남는다
//   ✓ Claude Code 에 이었다 — 새로 여는 것부터
//   ✓ 늘 켜기 · 새 판 저절로
//       밤에 내 지식 정리에 Claude 를 쓴다 — 끄려면 설정
// 안 된 단계는 ✓ 대신 · 와 사람이 붙일 한 줄.

import fs from 'node:fs'
import path from 'node:path'

const NUM = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열']

// 백업 자리 — 시스템 드라이브도 지식 드라이브도 아닌 고정 드라이브의 \kmd-백업(없으면 null — 설정에서)
export function pickBackupDir(root, { exists = fs.existsSync, sys = process.env.SystemDrive || 'C:' } = {}) {
  if (process.platform !== 'win32' && !process.env.KMD_FAKE_WIN) return null
  const rootDrive = path.parse(path.resolve(root)).root.slice(0, 2).toUpperCase()
  for (const d of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    const drv = `${d}:`
    if (drv === rootDrive || drv === sys.toUpperCase()) continue
    if (exists(drv + '\\')) return `${drv}\\kmd-백업`
  }
  return null
}

export function installLines({ version, root, backup = null, kns = [], team = null, user = null, host = '', osuser = '', claude = { ok: true }, task = { ok: true }, claudeTidy = true }) {
  const L = []
  const ok = (t) => L.push(`✓ ${t}`)
  const no = (t) => L.push(`· ${t}`)
  const dim = (t) => L.push(`    ${t}`)
  L.push(`kmd v${version} 을 이 PC 에 깐다 — 나만 쓴다 · 망 없이도 된다`)
  ok(`${root} 에 세웠다 · ${backup ? `백업은 ${backup}` : '백업 자리는 아직 — 다른 드라이브가 생기면 설정에서'} — 바꾸려면 설정`)
  if (kns.length) dim(`폴더 ${NUM[kns.length] || kns.length}${kns.length === 1 ? '가' : kns.length <= 10 ? '이' : '개가'} 그대로 지식이 됐다 — ${kns.slice(0, 6).join(' · ')}${kns.length > 6 ? ' …' : ''}`)
  if (team?.ok) {
    ok(`팀 ${team.host} 에 ${user}로 이었다`)
    dim(`${user}의 「오늘 바뀐 것」 에 「새 기기가 이어졌다 — ${host} · ${osuser}」 한 줄이 남는다`)
  } else if (team) no(`팀에 잇지 못했다 — ${team.why} · 팀 화면에서 설치 한 줄을 다시 복사한다`)
  if (claude.ok) ok('Claude Code 에 이었다 — 새로 여는 것부터')
  else no(`Claude Code 에 잇기(한 번): ${claude.line}`)
  if (task.ok) ok('늘 켜기 · 새 판 저절로')
  else no(`늘 켜기는 못 했다 — ${task.why || '이 PC 에서 kmd up 으로 켠다'}`)
  if (claudeTidy) dim('밤에 내 지식 정리에 Claude 를 쓴다 — 끄려면 설정')
  return L
}
