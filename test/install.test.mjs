// S8 필수 — 설치 한 줄의 출력: ✓ 넷(세웠다 · 팀에 이었다 · Claude Code 에 이었다 · 늘 켜기)과 값이 있는 흐린 줄.
// 「새 판 저절로」 처럼 하지 않는 일을 했다고 찍지 않는다 · 이 PC 의 kmd 화면을 다시 여는 길(시작 메뉴 kmd · kmd open)을 알린다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installLines, pickBackupDir } from '../core/install.js'

test('설치 출력: ✓ 넷 · 흐린 줄 · 화면 여는 길 · 안 된 단계는 붙일 한 줄', () => {
  const L = installLines({ version: '0.1.0', root: 'D:\\kmd', backup: 'E:\\kmd-백업', kns: ['배포노트', '설계메모', '개인메모', '받은편지함'], team: { ok: true, host: 'kmd.team.local' }, user: 'kim', host: 'DESKTOP-KIM', osuser: 'kim', screen: { ok: true } })
  assert.deepEqual(L.filter((l) => l.startsWith('✓')), [
    '✓ D:\\kmd 에 세웠다 · 백업은 E:\\kmd-백업: 바꾸려면 설정',
    '✓ 팀 kmd.team.local 에 kim로 이었다',
    '✓ Claude Code 에 이었다. 새로 여는 것부터',
    '✓ 늘 켜기: 로그온 때 켜고 멈추면 다시 켠다',
  ])
  const dim = L.filter((l) => l.startsWith('    ')).map((l) => l.trim())
  assert.deepEqual(dim, ['폴더 넷이 그대로 지식이 됐다: 배포노트 · 설계메모 · 개인메모 · 받은편지함', 'kim의 「이력」 에 「새 기기가 이어졌다: DESKTOP-KIM · kim」 한 줄이 남는다', '이 PC 의 kmd 화면을 열었다. 다음부터는 시작 메뉴의 kmd(또는 kmd open)', '기록이 남으면 곧바로 Claude 로 다듬어 문서에 넣는다. 끄려면 설정'])
  assert.ok(!L.some((l) => /새 판 저절로/.test(l)), '하지 않는 일을 했다고 찍지 않는다')
  // 화면을 아직 못 열었으면 여는 길과 까닭
  const slow = installLines({ version: '0.1.0', root: 'D:\\kmd', team: { ok: true, host: 'h' }, user: 'kim', screen: { ok: false, why: '아직 켜지는 중이다' } })
  assert.ok(slow.some((l) => l.trim() === '이 PC 의 kmd 화면은 시작 메뉴의 kmd(또는 kmd open)로 연다: 아직 켜지는 중이다'))
  const bad = installLines({ version: '0.1.0', root: 'D:\\kmd', team: { ok: false, why: '표가 끝났다' }, claude: { ok: false, line: 'claude mcp add-json kmd-team …' }, task: { ok: false } })
  assert.equal(bad.filter((l) => l.startsWith('✓')).length, 1)
  assert.ok(bad.some((l) => /팀에 잇지 못했다. 표가 끝났다/.test(l)))
  assert.ok(bad.some((l) => /Claude Code 에 잇기\(한 번\): claude mcp add-json/.test(l)))
  assert.ok(bad.some((l) => /kmd up 으로 켜면 열린다/.test(l)), '늘 켜기가 없으면 화면은 kmd up')
})

test('백업 자리: 시스템 · 지식 드라이브가 아닌 드라이브의 \\kmd-백업', () => {
  process.env.KMD_FAKE_WIN = '1'
  const has = (set) => (p) => set.includes(p)
  assert.equal(pickBackupDir('D:\\kmd', { exists: has(['D:\\', 'E:\\']), sys: 'C:' }), 'E:\\kmd-백업')
  assert.equal(pickBackupDir('D:\\kmd', { exists: has(['D:\\']), sys: 'C:' }), null)
  delete process.env.KMD_FAKE_WIN
})
