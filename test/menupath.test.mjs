// 메뉴 길 말(UX T5-07 · 메뉴 개편 N3) — 화면 메뉴 이름과 글 속 메뉴 길이 한 곳(core/menupath.js)과 맞는가
//   지금 화면에 있는 길만 쓴다. 목표 메뉴(N4 ~ N6)에만 있는 길은 아직 쓰지 않는다 — 화면을 옮기는 단계에서 이 시험을 뒤집는다
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SET_TEAM, SET_PC, WORK, IMP_TABS, BRIDGE, okNow, okTarget } from '../core/menupath.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(ROOT, 'app', 'main.js'), 'utf8').replace(/\r\n/g, '\n')

test('화면의 설정 메뉴 · 작업 메뉴 · 생성 탭 이름이 core/menupath.js 와 같다', () => {
  const body = (name) => { const i = main.indexOf(`function ${name}()`); assert.ok(i >= 0, name); return main.slice(i, main.indexOf('\n}', i)) }
  const labels = (src) => [...src.matchAll(/\bl: '([^']+)'/g)].map((m) => m[1])
  const set = body('setMenu')
  const pcLine = set.split('\n').find((l) => l.includes('!isTeam()'))
  const pc = labels(pcLine), team = labels(set.replace(pcLine, ''))
  assert.deepEqual(pc, [...SET_PC])
  assert.deepEqual(team, [...SET_TEAM])
  const work = labels(body('workMenu'))
  for (const l of work) assert.ok(WORK.includes(l), `작업 메뉴 「${l}」 가 core/menupath.js WORK 에 없다`)
  assert.deepEqual([...new Set(work)].sort(), [...WORK].sort(), 'WORK 는 화면 작업 메뉴 이름 그대로')
  assert.deepEqual([...body('impTabsHtml').matchAll(/\['(?:queue|src|done)', '([^']+)'/g)].map((m) => m[1]), [...IMP_TABS])
  // BRIDGE — 화면에 남은 설정 페이지만 · 목표 길은 목표 메뉴에 있다
  for (const [k, to] of Object.entries(BRIDGE)) {
    assert.ok(pc.includes(k) || team.includes(k), `BRIDGE 「${k}」 가 화면 설정 메뉴에 없다: 옮겼으면 core/menupath.js 에서 걷는다`)
    for (const p of to.split(' · ')) { const [m, r] = p.split(' › '); assert.ok(okTarget(m, r), `BRIDGE 「${k}」 의 목표 길 「${p}」`) }
  }
})

// 서버 · core · 스킬 · 설명서 · 서비스 전체 · 화면 글의 메뉴 길을 모두 모은다(코드 주석은 사람에게 보이지 않아 뺀다)
function paths() {
  const files = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|mjs|md|html)$/.test(e.name)) files.push(p) } }
  for (const d of ['server', 'core', 'agent', 'docs_ops']) walk(path.join(ROOT, d))
  files.push(path.join(ROOT, 'app', 'main.js'))
  const out = []
  const self = path.join(ROOT, 'core', 'menupath.js') // 이름 표 자신(목표 길 데이터)
  for (const f of files.filter((x) => x !== self)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|#)/.test(l) && !/\.(md|html)$/.test(f)) return
      for (const m of l.matchAll(/(설정|지식관리|생성|확인|문서)\s*(?:›|&rsaquo;|<b>›<\/b>)\s*(?:<b>)?([^\n]{0,20})/g)) {
        if (/^(['"`$…]|<\/)/.test(m[2])) continue // 코드로 잇는 길 · 링크 이름 끝(「생성 ›」 단추) · 「설정 › …」 꼴의 말
        out.push({ at: `${path.relative(ROOT, f)}:${i + 1} 「${m[1]} › ${m[2].slice(0, 12)}」`, menu: m[1], rest: m[2].replace(/<[^>]+>/g, '') })
      }
    })
  }
  return out
}

test('글 속 메뉴 길이 지금 화면에 있는 메뉴로 시작한다', () => {
  const bad = paths().filter((p) => !okNow(p.menu, p.rest) && !okTarget(p.menu, p.rest)).map((p) => p.at)
  assert.deepEqual(bad, [], '없는 메뉴를 가리키는 길:\n' + bad.join('\n'))
})

test('목표 메뉴(N4 ~ N6)에만 있는 길은 아직 쓰지 않는다', () => {
  const early = paths().filter((p) => !okNow(p.menu, p.rest) && okTarget(p.menu, p.rest)).map((p) => p.at)
  assert.deepEqual(early, [], '화면에 아직 없는 길(그 단계에서 쓴다):\n' + early.join('\n'))
})
