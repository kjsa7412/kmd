// S8 필수 — 설치 한 줄의 출력: ✓ 넷(세웠다 · 팀에 이었다 · Claude Code 에 이었다 · 늘 켜기)과 값이 있는 흐린 줄 셋.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installLines, pickBackupDir } from '../core/install.js'

test('설치 출력 — ✓ 넷 · 흐린 줄 셋 · 안 된 단계는 붙일 한 줄', () => {
  const L = installLines({ version: '0.1.0', root: 'D:\\kmd', backup: 'E:\\kmd-백업', kns: ['배포노트', '설계메모', '개인메모', '받은편지함'], team: { ok: true, host: 'kmd.team.local' }, user: 'kim', host: 'DESKTOP-KIM', osuser: 'kim' })
  assert.deepEqual(L.filter((l) => l.startsWith('✓')), [
    '✓ D:\\kmd 에 세웠다 · 백업은 E:\\kmd-백업 — 바꾸려면 설정',
    '✓ 팀 kmd.team.local 에 kim로 이었다',
    '✓ Claude Code 에 이었다 — 새로 여는 것부터',
    '✓ 늘 켜기 · 새 판 저절로',
  ])
  const dim = L.filter((l) => l.startsWith('    ')).map((l) => l.trim())
  assert.deepEqual(dim, ['폴더 넷이 그대로 지식이 됐다 — 배포노트 · 설계메모 · 개인메모 · 받은편지함', 'kim의 「이력」 에 「새 기기가 이어졌다 — DESKTOP-KIM · kim」 한 줄이 남는다', '기록이 남으면 곧바로 Claude 로 다듬어 문서에 넣는다 — 끄려면 설정'])
  const bad = installLines({ version: '0.1.0', root: 'D:\\kmd', team: { ok: false, why: '표가 끝났다' }, claude: { ok: false, line: 'claude mcp add-json kmd-team …' }, task: { ok: false } })
  assert.equal(bad.filter((l) => l.startsWith('✓')).length, 1)
  assert.ok(bad.some((l) => /팀에 잇지 못했다 — 표가 끝났다/.test(l)))
  assert.ok(bad.some((l) => /Claude Code 에 잇기\(한 번\): claude mcp add-json/.test(l)))
})

test('백업 자리 — 시스템 · 지식 드라이브가 아닌 드라이브의 \\kmd-백업', () => {
  process.env.KMD_FAKE_WIN = '1'
  const has = (set) => (p) => set.includes(p)
  assert.equal(pickBackupDir('D:\\kmd', { exists: has(['D:\\', 'E:\\']), sys: 'C:' }), 'E:\\kmd-백업')
  assert.equal(pickBackupDir('D:\\kmd', { exists: has(['D:\\']), sys: 'C:' }), null)
  delete process.env.KMD_FAKE_WIN
})
