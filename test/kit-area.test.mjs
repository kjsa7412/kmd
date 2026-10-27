// 에이전트 설치 · 팀 / 개인: 작업 폴더 하나는 한 영역 · 지식 하나. 연결은 그 영역의 것 하나만 · CLAUDE.md 안내에 기본 지식
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { install, status } from '../core/kit.js'
import { installPs, safeKn } from '../server/http.js'

test('팀 → 개인으로 다시 붙이면 연결이 바뀌고 기본 지식 줄도 바뀐다 · 표지 밖의 줄은 그대로', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-kit-'))
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# 내 프로젝트\n\n사람이 쓴 줄\n')
    await install(dir, { teamUrl: 'http://kmd.team:7381', pcUrl: 'http://127.0.0.1:7373', area: 'team', kn: 'dpms', knName: 'DPMS 지식' })
    let mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers
    assert.deepEqual(Object.keys(mcp), ['kmd-team'], '팀 폴더에는 팀 연결 하나')
    let md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    assert.match(md, /사람이 쓴 줄/)
    assert.match(md, /## 이 폴더의 기본 지식[\s\S]*영역: 팀 · 연결: kmd-team[\s\S]*기본 지식: 「DPMS 지식」 \(id: dpms\)/)
    assert.equal((await status(dir)).state, 'latest', '기본 지식 줄은 판 지문에 들지 않는다')
    await install(dir, { teamUrl: 'http://kmd.team:7381', pcUrl: 'http://127.0.0.1:7373', area: 'me', kn: '설계메모', knName: '설계메모' })
    mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers
    assert.deepEqual(Object.keys(mcp), ['kmd'], '개인으로 바꾸면 팀 연결을 걷는다')
    md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    assert.match(md, /영역: 개인 · 연결: kmd\(이 PC 의 개인 지식\)[\s\S]*기본 지식: 「설계메모」/)
    assert.doesNotMatch(md, /DPMS 지식/)
    assert.equal((md.match(/kmd:begin/g) || []).length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('설치 한 줄: 팀 지식을 고르면 kmd connect 에 --kn · 이상한 이름은 싣지 않는다', () => {
  const ps = installPs({ origin: 'http://kmd.team:7381', ticket: 'kmdt_abcdefghijklmnop', pkg: null, kn: 'DPMS 지식' })
  assert.match(ps, /connect \$o --ticket \$t --kn 'DPMS 지식'/)
  assert.doesNotMatch(installPs({ origin: 'http://kmd.team:7381', ticket: 'kmdt_abcdefghijklmnop', pkg: null }), /--kn/)
  assert.equal(safeKn("a'; rm -rf /"), null)
  assert.equal(safeKn('$(x)'), null)
  assert.equal(safeKn('배포노트-2'), '배포노트-2')
})
