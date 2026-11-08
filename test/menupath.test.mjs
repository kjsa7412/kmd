// 메뉴 길 말(UX T5-07) — 화면 메뉴 이름과 글 속 「설정 › …」 길이 한 곳(core/menupath.js)과 맞는가
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SET_TEAM, SET_PC, WORK, okSetPath } from '../core/menupath.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(ROOT, 'app', 'main.js'), 'utf8')

test('화면의 설정 메뉴 · 작업 메뉴 이름이 core/menupath.js 와 같다', () => {
  const body = (name) => { const i = main.indexOf(`function ${name}()`); assert.ok(i >= 0, name); return main.slice(i, main.indexOf('\n}', i)) }
  const labels = (src) => [...src.matchAll(/\bl: '([^']+)'/g)].map((m) => m[1])
  const set = body('setMenu')
  const pcLine = set.split('\n').find((l) => l.includes('!isTeam()'))
  assert.deepEqual(labels(pcLine), [...SET_PC])
  assert.deepEqual(labels(set.replace(pcLine, '')), [...SET_TEAM])
  for (const l of labels(body('workMenu'))) assert.ok(WORK.includes(l), `작업 메뉴 「${l}」 가 core/menupath.js WORK 에 없다`)
})

test('서버 · core · 스킬 · 설명서의 「설정 › …」 길이 있는 메뉴로 시작한다', () => {
  const files = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|mjs|md|html)$/.test(e.name)) files.push(p) } }
  for (const d of ['server', 'core', 'agent', 'docs_ops/manual']) walk(path.join(ROOT, d))
  files.push(path.join(ROOT, 'app', 'main.js'))
  const bad = []
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*|#)/.test(l) && !/\.(md|html)$/.test(f)) return // 코드 주석은 사람에게 보이지 않는다
      for (const m of l.matchAll(/설정\s*(?:›|&rsaquo;|<b>›<\/b>)\s*(?:<b>)?([^\n]{0,20})/g)) if (!/^['"`$]/.test(m[1]) && !okSetPath(m[1].replace(/<[^>]+>/g, ''))) bad.push(`${path.relative(ROOT, f)}:${i + 1} 「설정 › ${m[1].slice(0, 12)}」`)
    })
  }
  assert.deepEqual(bad, [], '없는 메뉴를 가리키는 길:\n' + bad.join('\n'))
})
