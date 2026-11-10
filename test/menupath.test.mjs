// 메뉴 길 말(UX T5-07 · 메뉴 개편 N3) — 화면 메뉴 이름과 글 속 메뉴 길이 한 곳(core/menupath.js)과 맞는가
//   지금 화면에 있는 길만 쓴다. 목표 메뉴(N6)에만 있는 길은 아직 쓰지 않는다 — 화면을 옮기는 단계에서 이 시험을 뒤집는다(N4: 옆 메뉴 · 「문서 › 구조」 · N5: 생성 › 수기수집 · 자동수집 · 진행 · 확인 › 넣지 못함 · 점검 · 승인)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SET_TEAM, SET_PC, KN_MENU_PC, KN_MENU_TEAM, COMMON, GEN_TABS, PROGRESS, CHECK_TABS, MANAGE_PC, MANAGE_TEAM, DETAIL_PC, DETAIL_TEAM, okNow, okTarget } from '../core/menupath.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(ROOT, 'app', 'main.js'), 'utf8').replace(/\r\n/g, '\n')

test('화면의 설정 메뉴 · 옆 메뉴(지식 메뉴 · 공통 메뉴) · 생성 탭 이름이 core/menupath.js 와 같다', () => {
  const body = (name) => { const i = main.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return main.slice(i, main.indexOf('\n}', i)) }
  const labels = (src) => [...src.matchAll(/\bl: '([^']+)'/g)].map((m) => m[1])
  const set = body('setMenu')
  const pcLine = set.split('\n').find((l) => l.includes('!isTeam()'))
  const pc = labels(pcLine), team = labels(set.replace(pcLine, ''))
  assert.deepEqual(pc, [...SET_PC])
  assert.deepEqual(team, [...SET_TEAM])
  // 지식 메뉴 — 개인 줄(!isTeam()) · 팀 줄 차례 그대로 · 공통 메뉴 둘(sideItems)
  const km = body('kmItems')
  const kmPc = km.split('\n').find((l) => l.includes('!isTeam()'))
  assert.deepEqual(labels(kmPc), [...KN_MENU_PC])
  assert.deepEqual(labels(km.replace(kmPc, '')), [...KN_MENU_TEAM])
  assert.deepEqual(labels(body('sideItems')), [...COMMON])
  // 작업 화면 갈 곳 글(workMenu) — 지식 메뉴 이름이거나 「문서 › 구조」
  for (const l of labels(body('workMenu'))) assert.ok(KN_MENU_PC.includes(l) || KN_MENU_TEAM.includes(l) || l === '문서 › 구조', `작업 갈 곳 「${l}」`)
  // 지식 메뉴 화면의 본문 머리 탭(N5) — 생성(수기수집 · 자동수집) · 진행(도는 일 · 끝난 일) · 확인(넣지 못함 · 점검 · 승인)
  const gen = main.match(/const GEN_TABS = \[(.*)\]\n/)
  assert.ok(gen, 'GEN_TABS')
  assert.deepEqual([...gen[1].matchAll(/\['(?:manual|auto)', '([^']+)'\]/g)].map((m) => m[1]), [...GEN_TABS])
  assert.match(body('progHeadHtml'), />진행</)
  assert.deepEqual(['진행', ...[...body('progTabsHtml').matchAll(/\['(?:queue|done)', '([^']+)'/g)].map((m) => m[1])], [...PROGRESS])
  assert.deepEqual([...body('ckTabsHtml').matchAll(/\['(?:held|check|review)', '([^']+)'/g)].map((m) => m[1]), [...CHECK_TABS])
  // 지식관리(N6) — 본문 왼쪽 메뉴(mgMenu: 팀만 사람) · 지식 상세 탭(kdTabs: 개인 줄 · 팀 줄)
  const mgm = labels(body('mgMenu'))
  assert.deepEqual(mgm, [...MANAGE_TEAM])
  assert.deepEqual(mgm.filter((x) => x !== '사람'), [...MANAGE_PC])
  const tabsOf = (src) => [...src.matchAll(/\['(?:info|perm|repo|policy|del)', '([^']+)'\]/g)].map((m) => m[1])
  const kd = body('kdTabs'), kdPc = kd.split('\n').find((l) => l.includes('!isTeam()'))
  assert.deepEqual(tabsOf(kdPc), [...DETAIL_PC])
  assert.deepEqual([...new Set(tabsOf(kd.replace(kdPc, '')))], [...DETAIL_TEAM])
  // 옛 설정 페이지 이름(이 PC · 팀 지식 · 사람)은 화면 설정 메뉴에 없다 — 옛 주소는 routeFix 가 새 자리로
  for (const old of ['이 PC', '팀 지식', '사람']) assert.ok(!pc.includes(old) && !team.includes(old), `옛 설정 페이지 「${old}」`)
  const fix = body('routeFix')
  for (const k of ["'kns'", "'people'", "'pc'", "'members'"]) assert.ok(fix.includes(k), `routeFix 가 옛 ${k} 를 바꾼다`)
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

test('목표 메뉴에만 있는 길은 아직 쓰지 않는다(N6 뒤 지금 = 목표)', () => {
  const early = paths().filter((p) => !okNow(p.menu, p.rest) && okTarget(p.menu, p.rest)).map((p) => p.at)
  assert.deepEqual(early, [], '화면에 아직 없는 길(그 단계에서 쓴다):\n' + early.join('\n'))
})
