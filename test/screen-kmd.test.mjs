// 화면 필수 — 목업과 같은 글 · 단추 수 · 금지어 0 · 콘솔 에러 0. 그리고 목업과 나란히 찍는다.
//
// playwright-core + 이 PC 에 깔린 Chrome(없으면 건너뛴다 — KMD_CHROME 으로 자리를 준다).
// 찍은 그림은 KMD_SHOTS(없으면 임시 폴더의 kmd-shots)에 app-*.png · mock-*.png 로 남는다 — 사람이 나란히 본다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { workOnce } from '../core/worker.js'
import { sha16 } from '../core/text.js'
import { sectionOf } from '../core/knowledge.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOCK = pathToFileURL(path.join(HERE, '..', 'docs', 'kmd_목업_인터랙션.html')).href
const SHOTS = process.env.KMD_SHOTS || path.join(os.tmpdir(), 'kmd-shots')
const CHROME = [process.env.KMD_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p))

// 사람 화면에 쓰지 않는 말(절차서 §0 「화면 말」)
const BANNED = ['좌표', '섹션', '원천', '기준선', '큐레이션', '대기열', '판정', '토큰', '커밋', '레포', '미러', '동기화', 'LLM', 'RAG', '노드', '엣지', '백링크', 'coord', 'commit']

let tmp, s, pc, browser, me, dkey = null
const VIEW = { width: 1300, height: 820 }

before(async () => {
  if (!CHROME) return
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-screen-'))
  const env = { ...process.env } // Chrome 은 원래 집 폴더로 띄운다(임시 APPDATA 면 프로필을 거절한다)
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  // 팀 화면이 내 Claude(내 PC 쪽)를 확인한다 — 진짜 claude 대신 가짜로
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  // 개인 프로그램 — 개인 화면 시험(지식 보내기 · 받는 팀 지식)이 쓴다
  fs.mkdirSync(path.join(tmp, 'pc'), { recursive: true })
  pc = await startServer({ root: path.join(tmp, 'pc'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  me = await signIn(s, { id: 'kim' })
  dkey = await s.auth.deviceKeyFor('kim', { host: 'KIM-PC', osuser: 'kim' }) // 설치 한 줄로 이은 PC
  process.env.KMD_SEND_KEY = dkey // 내 PC 쪽이 팀 서버에 보낼 때 쓰는 이 PC 의 기기 열쇠
  fs.writeFileSync(path.join(tmp, 'pc', '.kmd', 'teams.json'), JSON.stringify([s.url]))
  // Chrome 은 한글이 든 임시 경로(세정아~1)의 프로필 폴더를 받지 않는다 — 그때만 레포의 .kmd-data/tmp(무시 목록)로
  if (!/^[\x20-\x7e]*$/.test(os.tmpdir())) {
    const ascii = path.join(HERE, '..', '.kmd-data', 'tmp')
    fs.mkdirSync(ascii, { recursive: true })
    process.env.TEMP = process.env.TMP = env.TEMP = env.TMP = ascii
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true, env })
  fs.mkdirSync(SHOTS, { recursive: true })
})
after(async () => {
  await browser?.close()
  await s?.close()
  await pc?.close()
  // Windows — 감시 · git 손잡이가 늦게 풀려 지우기가 EBUSY 일 때가 있다(임시 폴더라 남겨도 된다)
  try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

// 지식 관리 — 옆 메뉴의 설정 · 팀 / 설정 · 개인(이 PC 는 설정)을 누르고 본문 왼쪽 메뉴에서 고른다 · 이력은 옆 메뉴에 따로
const hist = (page) => page.click('[data-t=nav-history]')
async function mg(page, area, item) {
  await page.click(`[data-t=nav-settings-${area}]`)
  await page.click(`[data-t=mgNav] [data-t=mg-${item}]`)
}
const mgItems = (page) => page.locator('[data-t=mgNav] .mgi').allInnerTexts()

// 잘린 요소 · 가로 넘침 — 보이는 요소 중 오른쪽 끝이 창 폭을 넘는데 가로로 밀어 볼 조상(overflow-x auto · scroll)이 없는 것
async function cutAt(page) {
  return page.evaluate(() => {
    const W = innerWidth, out = []
    const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
    for (const el of document.querySelectorAll('#app *')) {
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const b = el.getBoundingClientRect()
      if (b.width && b.height && b.right > W + 1 && b.left < W && !scrolls(el)) out.push(`${el.tagName}.${el.className} ${Math.round(b.right)}`)
    }
    return { cut: out, sw: document.documentElement.scrollWidth, w: W }
  })
}
async function bannedIn(page) {
  // 지식 폴더 띠의 [동기화] · 그 설명 줄은 운영자가 정한 이름이라 뺀다(요구 v0.2 R2.5 · 디자인 컨벤션 §9)
  const text = await page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('[data-t=syncKn], [data-t=addRoot] small, [data-t=syncMsg]').forEach((x) => x.remove()); document.body.appendChild(c); c.style.display = 'block'; const t = c.innerText; c.remove(); return t + ' ' + [...document.querySelectorAll('[title],[placeholder]')].map((e) => (e.title || '') + ' ' + (e.placeholder || '')).join(' ') })
  return BANNED.filter((w) => text.includes(w))
}

test('셸 · 지식 목록 · 문서로 보기: 목업과 같은 글 · 단추 · 금지어 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))

  // 들어가기 — 두 칸 + [들어가기] · 옆 메뉴는 흐리게 · 틀리면 한 줄
  await page.goto(s.url)
  await page.waitForSelector('[data-t=loginBtn]')
  assert.match(await page.locator('.gate').innerText(), /팀 kmd 에 들어간다[\s\S]*한 번 들어오면 일주일쯤 이어진다/)
  assert.equal(await page.locator('.side.dim').count(), 1)
  assert.equal(await page.getAttribute('#lgPw', 'autocomplete'), 'current-password')
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', 'wrong-password')
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=loginErr]')
  assert.equal(await page.locator('[data-t=loginErr]').innerText(), '아이디나 비밀번호를 확인하세요. 여러 번 틀리면 잠시 막힌다')
  await page.screenshot({ path: path.join(SHOTS, 'app-login.png') })
  errors.length = 0 // 일부러 틀린 들어가기의 401 은 브라우저가 콘솔에 적는다
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist] [data-t=krow]')
  // 셸 — 리본 없음 · 옆 메뉴 두 영역(지식 고르기: 고르기 · 문서 · 항목 · 그래프 탭 · 목록 / 지식 관리: 공통 메뉴) · 머리(찾기 가운데 · 설명서 · 나 오른쪽) · 띠 · 아래 줄
  assert.equal(await page.locator('.ribbon').count(), 0)
  assert.deepEqual(await page.locator('[data-t=ktabs] span').allInnerTexts(), ['문서', '항목', '그래프'])
  // 지식 관리 — 이력과 설정(팀 화면은 팀 지식만 · 개인 지식은 개인 화면에서)
  assert.deepEqual(await page.locator('[data-t=manageArea] .sb-i').evaluateAll((els) => els.map((e) => e.querySelector('span').textContent)), ['이력', '설정', '개인 프로그램 설치'])
  assert.match(await page.locator('.hdr .hmid').innerText(), /빨리 열기[\s\S]*Ctrl O[\s\S]*찾기[\s\S]*Ctrl K/)
  assert.match(await page.locator('.hdr .hright').innerText(), /Claude[\s\S]*설명서/)
  // 들어온 사람은 왼쪽 메뉴 맨 위(누르면 설정 · 나가기)
  assert.match(await page.locator('.side .sb-top [data-t=me]').innerText(), /kim[\s\S]*팀 서버 · 관리자/)
  assert.equal(await page.locator('.band .who').innerText(), '팀 서버의 kmd · 같이 쓴다')
  assert.deepEqual(await page.locator('[data-t=krow]').evaluateAll((els) => els.map((e) => e.dataset.name)), ['DPMS 지식', 'GDI 지식'])
  // 팀 화면은 팀 지식만 — 개인 칸 · 「내 PC 지식 폴더」 띠 · 「+ 새 개인 지식」 이 없다(분리)
  assert.deepEqual(await page.locator('.sec-h b').allInnerTexts(), ['팀 지식'])
  assert.equal(await page.locator('[data-t=klist] [data-t=addCardTeam]').count(), 1, '팀 지식 끝 「+ 새 팀 지식」')
  assert.equal(await page.locator('[data-t=meList], [data-t=meWhere], [data-t=meSec]').count(), 0, '개인 지식 칸이 없다')
  assert.equal(await page.locator('text=+ 지식 만들기').count(), 0, '지식 목록의 「지식 만들기」 단추는 걷었다')
  assert.match(await page.locator('[data-t=rootPath]').innerText(), /kn/, '팀 관리자에게는 서버의 지식 폴더 · [동기화]')
  assert.equal(await page.locator('[data-t=syncKn]').count(), 1)
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-home.png') })

  // 문서로 보기 — 나무 · 빈 가운데 · 이 지식
  await page.click('[data-t=krow][data-name="DPMS 지식"]')
  await page.waitForSelector('[data-t=tree] [data-t=doc]')
  assert.equal(await page.locator('.tabbar .none').innerText(), '열린 탭이 없다. 왼쪽에서 열거나 Ctrl O')
  assert.match(await page.locator('[data-t=docsEmpty]').innerText(), /왼쪽 나무에서 문서나 기록을 연다/)
  // 지식 점검(지식관리자) — 지식 생성 가드가 보는 것의 지금 상태 · 줄마다 수 · [보기] 로 목록
  await page.waitForSelector('[data-t=guardCard] [data-t=guard-unnamed]')
  assert.match(await page.locator('[data-t=guardCard]').innerText(), /지식 점검[\s\S]*이름 없는 기록[\s\S]*장부 밖 이름을 단 기록[\s\S]*이름 없는 항목/)
  assert.deepEqual(await page.locator('.tree .tf').evaluateAll((els) => els.map((e) => e.dataset.t)), ['fold-docs', 'fold-recs', 'fold-atts'])
  assert.equal(await page.locator('[data-t=moreDocs]').innerText(), '6개 더')

  // 문서 하나 — 탭 · 항목 다섯 · 옆 칸(개요 · 참고 · 넣은 기록 · 연결 · 속성)
  await page.click('[data-t=moreDocs]')
  await page.click('[data-t=doc][data-name="배포절차"]')
  await page.waitForSelector('[data-t=docPane]')
  assert.deepEqual(await page.locator('[data-t=tab] .nm').allInnerTexts(), ['배포절차'])
  assert.deepEqual(await page.locator('[data-t=docPane] h2[data-sec]').evaluateAll((els) => els.map((e) => e.dataset.sec)), ['준비', '카나리', '헬스 체크', '롤백', '꾸러미 판'])
  assert.deepEqual(await page.locator('.aside .ap > h4').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim())), ['개요', '넣은 기록', '연결', '속성'])
  assert.equal(await page.locator('[data-t=olRow]').count(), 5)
  // 아직 안 넣은 기록은 본문 사이에 상자로 끼우지 않는다 — 롤백 머리 오른쪽 「반영 대기 1」 칩 · 누르면 그 머리 바로 아래 참고 칸(작성기준 1절)
  assert.equal(await page.locator('[data-t=penrec]').count(), 0)
  assert.equal(await page.locator('[data-t=pendChip]').count(), 1)
  assert.equal(await page.locator('.hrow:has(h2[data-sec="롤백"]) [data-t=pendChip]').innerText(), '반영 대기 1')
  await page.click('.hrow:has(h2[data-sec="롤백"]) [data-t=pendChip]')
  await page.waitForSelector('[data-t=pendPanel] [data-t=pendRow]')
  assert.equal(await page.locator('[data-t=pendPanel] [data-t=pendRow]').count(), 1)
  assert.equal(await page.locator('.hrow:has(h2[data-sec="롤백"]) [data-t=pendChip]').getAttribute('aria-expanded'), 'true')
  await page.click('.hrow:has(h2[data-sec="롤백"]) [data-t=pendChip]')
  assert.equal(await page.locator('[data-t=pendPanel]').count(), 0, '다시 누르면 접힌다')
  assert.equal(await page.locator('[data-t=docRefs]').count(), 1, '오른쪽 칸 「참고」')
  assert.ok((await page.locator('.btn.pri:visible').count()) <= 1, '주 단추는 하나까지')
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-docs.png') })

  // 글 속 링크로 다른 문서 · 기록 · 나누어 보기
  await page.click('[data-t=docPane] .dlink[data-d="롤백절차"] >> nth=0')
  await page.waitForSelector('[data-t=docPane][data-name="롤백 절차"]')
  assert.equal(await page.locator('[data-t=tab]').count(), 2)
  await page.keyboard.press('Control+Backslash')
  await page.waitForSelector('[data-t=rightPane] [data-t=docPane]')
  await page.click('[data-t=closeSplit]')
  await page.click('[data-t=rec][data-state=pend]')
  await page.waitForSelector('[data-t=recPane]')
  assert.equal(await page.locator('[data-t=recState]').innerText(), '반영 대기')
  assert.equal(await page.locator('[data-t=recItem]').count(), 1)

  // 글 속 항목 이름 → 항목 링크 · 마우스를 올리면 미리보기 카드
  await page.click('[data-t=tab][data-name="배포절차"]')
  await page.waitForSelector('[data-t=docPane][data-name="배포절차"] .ilink')
  await page.hover('[data-t=docPane] .ilink >> nth=0')
  await page.waitForSelector('[data-t=pv]')

  // 항목으로 보기(M6) — 종류별 목록 · 항목 한 화면 · 옆 칸
  await page.click('[data-t=rb-items]')
  await page.waitForSelector('[data-t=itemList] [data-t=itemRow]')
  assert.deepEqual(await page.locator('.fcs .fc').allInnerTexts(), ['반영 대기', '최근 바뀐 것', '내가 쓴 것'])
  await page.click('[data-t=itemRow][data-name="헬스 체크"]')
  await page.waitForSelector('[data-t=itemPage]')
  assert.deepEqual(await page.locator('[data-t=itemPage] .isec > h3').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim())), ['지금', '반영 대기', '지난 기록', '이 항목을 쓰는 곳', '다른 이름'])
  assert.ok((await page.locator('[data-t=itemHistRow]').count()) >= 5)
  assert.ok((await page.locator('[data-t=coItem]').count()) >= 1)
  // 항목 이름 = 값 + 설명(컨벤션 5절) — 항목 머리 첫 줄에 값 · 목록 줄에 값 · 항목 찾기는 값으로도
  assert.equal(await page.locator('[data-t=itemVal]').innerText(), '헬스 체크')
  assert.ok((await page.locator('[data-t=itemRow] .iv').count()) >= 5, '목록 줄에 값')
  await page.screenshot({ path: path.join(SHOTS, 'app-items.png') })

  // 그래프(M7) — 점 · 선 · 거름 · 범례 · 점을 누르면 카드
  await page.click('[data-t=rb-graph]')
  await page.waitForSelector('#gcv[data-n]')
  const ga = (k) => page.getAttribute('#gcv', 'data-' + k).then(Number)
  assert.ok((await ga('n')) > 10)
  assert.equal(await page.locator('[data-t=gLegend] .lgr').count(), 11) // 점 5 · 선 6(근거 더함)
  // 점 제목 — 기본은 숨김(올리거나 고를 때) · 「점 제목 늘 보기」 를 켜면 모두
  assert.equal(await ga('shown'), 0)
  await page.click('[data-t=g-label]')
  assert.ok((await ga('shown')) > 10)
  await page.click('[data-t=g-label]')
  // 선 — 기본은 끔(고른 점 · 올린 점의 선만) · 「선 보기」 를 켜면 모두
  assert.equal(await ga('lines'), 0)
  await page.click('[data-t=g-line]')
  assert.ok((await ga('lines')) > 10)
  await page.click('[data-t=g-line]')
  const pt = await page.evaluate(() => window.kmdGraphPt('i:proc:헬스 체크'))
  assert.ok(pt)
  await page.locator('#gcv').dispatchEvent('pointerdown', { button: 0, clientX: pt.x, clientY: pt.y })
  await page.dispatchEvent('body', 'pointerup')
  await page.waitForSelector('[data-t=gCard][data-name="헬스 체크"]')
  await page.screenshot({ path: path.join(SHOTS, 'app-graph.png') })
  await page.click('[data-t=gOpenDocs]')
  await page.waitForSelector('[data-t=docPane][data-name="배포절차"]')

  // 빨리 열기 · 찾기
  await page.keyboard.press('Control+o')
  await page.fill('#qoIn', '서버')
  await page.waitForSelector('[data-t=qoRow][data-name="서버목록"]')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-t=docPane][data-name="서버목록"]')
  await page.keyboard.press('Control+k')
  await page.fill('#palIn', '헬스 체크')
  await page.waitForSelector('[data-t=gExact]')
  await page.locator('[data-t=hit]').first().click()
  await page.waitForSelector('[data-t=found]')
  await page.waitForSelector('[data-t=lit]')
  assert.deepEqual(await bannedIn(page), [])
  assert.deepEqual(errors, [])
  await page.close()
})

test('정리 · 이 지식의 사람 · 오늘 바뀐 것(M12 · M11 · M9): 목업 글 · 금지어 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  const wkey = (await s.auth.workerAdd()).key
  // lee — dpms 에 쓰기 자리를 받은 팀원(받지 않은 지식은 없음이 기본 · 권한 모델 v1.1)
  if (!s.auth.people().includes('lee')) { await s.auth.addUser({ id: 'lee', admin: false }); await seat(s, 'lee', { dpms: 'write' }) }
  await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '카나리 비율', body: '첫 30분 요청 10% → 20%', touches: ['proc:카나리'] } })
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(s.url)
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist]')
  await page.click('[data-t=krow][data-name="DPMS 지식"]')
  await mg(page, 'team', 'tidy')
  // 정리할 팀 지식은 둘 이상이면 고르기 하나 · 머리 줄에 위에서 고른 지식을 싣지 않는다
  await page.waitForSelector('[data-t=tdKnSel]')
  await page.selectOption('[data-t=tdKnSel]', 'dpms')
  await page.waitForFunction(() => document.querySelector('[data-t=tdKnSel]')?.value === 'dpms' && document.querySelector('[data-t=goBox]'))
  assert.match(await page.locator('.hdr .crumb').innerText(), /^설정 › 정리/)
  assert.match(await page.locator('.main .big').innerText(), /정리: DPMS 지식/)
  assert.match(await page.locator('[data-t=nextTidy]').innerText(), /다음 정리 .* 02:30 · 반영 대기 \d+/)
  // 요약 줄(단위가 고정된 수) · 반영 대기는 보낸 사람으로 묶은 그리드 · 현황판은 없다
  assert.match(await page.locator('[data-t=tdSum]').innerText(), /반영 대기[\s\S]*넣을 곳 없음[\s\S]*다시 볼 것[\s\S]*사람이 볼 것[\s\S]*지난 정리 넣음/)
  assert.equal(await page.locator('.td-board').count(), 0)
  assert.match(await page.locator('[data-t=tdTabs]').innerText(), /반영 대기[\s\S]*정리 중[\s\S]*지난 정리/)
  assert.ok((await page.locator('[data-t=inbox] [data-t=tdGroup]').count()) >= 1)
  assert.ok((await page.locator('[data-t=inbox] [data-t=tdRec]').count()) >= 1)
  // 묶음 머리 단추를 누르면 그 아래 줄을 접고 편다(aria-expanded) · 고르기 칸은 단추 밖 · 모두 접기 · 모두 펼치기
  const recN = await page.locator('[data-t=inbox] [data-t=tdRec]').count()
  const gb = page.locator('[data-t=inbox] [data-t=tdGroup] .td-gb').first()
  assert.equal(await gb.getAttribute('aria-expanded'), 'true')
  assert.equal(await page.locator('[data-t=inbox] .td-gb input').count(), 0, '단추 안에 고르기 칸이 없다')
  await gb.click()
  assert.ok((await page.locator('[data-t=inbox] [data-t=tdRec]').count()) < recN)
  assert.equal(await page.locator('[data-t=inbox] [data-t=tdGroup] .td-gb').first().getAttribute('aria-expanded'), 'false')
  await page.locator('[data-t=inbox] [data-t=tdGroup] .td-gb').first().click()
  assert.equal(await page.locator('[data-t=inbox] [data-t=tdRec]').count(), recN)
  await page.click('[data-t=tdFoldAll]')
  assert.equal(await page.locator('[data-t=inbox] [data-t=tdRec]').count(), 0)
  await page.click('[data-t=tdFoldAll]')
  assert.equal(await page.locator('[data-t=inbox] [data-t=tdRec]').count(), recN)
  await page.screenshot({ path: path.join(SHOTS, 'app-tidy-inbox.png') })
  await page.click('[data-t=tidyBtn]')
  await page.waitForSelector('[data-t=prog]')
  // 쓰는 동안 — 진행 띠(막대 · 수 칩) · 넣을 곳 줄의 「쓰는 중 · 쓴 글 / 상한」 · 시각 붙은 활동 기록
  process.env.FAKE_CLAUDE_STREAM_MS = '2500'
  process.env.KMD_TIDY_TICK_MS = '200'
  const working = workOnce({ server: s.url, key: wkey })
  try {
    await page.waitForSelector('[data-t=tdSpotRow][data-st=run] [data-t=tdMeta]', { timeout: 20000 })
    await page.waitForFunction(() => /쓴 글 [\d,]+ 자 \/ 상한/.test(document.querySelector('[data-t=tdSpotRow][data-st=run]')?.innerText || ''), null, { timeout: 20000 })
    assert.ok(await page.locator('.td-band .td-bar').count(), '진행 막대')
    assert.match(await page.locator('.td-band').innerText(), /이번 정리[\s\S]*시작[\s\S]*지남[\s\S]*쓰는 중 \d/)
    assert.match(await page.locator('[data-t=tdDocGroup]').first().innerText(), /· 항목 \d/)
    assert.match(await page.locator('[data-t=tdDet] [data-t=tdTerm]').innerText(), /\+0:\d\d[\s\S]*Claude 에 보냄/)
    await page.evaluate(() => document.querySelectorAll('#toastHost > *').forEach((x) => x.remove()))
    await page.screenshot({ path: path.join(SHOTS, 'app-tidy-running.png') })
  } finally {
    await working
    delete process.env.FAKE_CLAUDE_STREAM_MS
    delete process.env.KMD_TIDY_TICK_MS
  }
  // 정리 중 — 넣을 곳마다 한 줄 · 누르면 그 줄 바로 아래에 흐름 · 활동 기록 · 결과(두 칸으로 나누지 않는다)
  await page.waitForSelector('[data-t=tdSpotRow]', { timeout: 20000 })
  await page.waitForFunction(() => !document.querySelector('[data-t=goBox].td-band'), null, { timeout: 20000 })
  if (!(await page.locator('[data-t=tdDet]').count())) await page.locator('[data-t=tdSpotRow]').first().click()
  await page.waitForSelector('[data-t=tdDet] [data-t=tdTerm]')
  const open = page.locator('[data-t=tdSpotRow][aria-expanded=true]')
  assert.equal(await open.count(), 1)
  assert.equal(await page.evaluate(() => document.querySelector('[data-t=tdSpotRow][aria-expanded=true]').nextElementSibling?.dataset.t), 'tdDet', '자세히는 그 줄 바로 아래')
  assert.equal(await page.locator('.tdy .qwrap').count(), 0)
  assert.doesNotMatch(await page.locator('[data-t=tdSpotRow]').first().innerText(), /docs\//, '넣을 곳은 문서 제목으로')
  // 그림에서 토스트를 걷는다(설명서 그림)
  await page.evaluate(() => document.querySelectorAll('#toastHost > *').forEach((x) => x.remove()))
  await page.screenshot({ path: path.join(SHOTS, 'app-tidy-run.png') })
  const widths = async (name) => {
    for (const w of [1280, 1024, 600, 375]) {
      await page.setViewportSize({ width: w, height: 820 })
      await page.waitForTimeout(100)
      const r = await cutAt(page)
      assert.deepEqual(r.cut, [], `정리 ${name} ${w}: 잘린 요소 없음`)
      assert.ok(r.sw <= r.w, `정리 ${name} ${w}: 가로 넘침 없음 ${r.sw}`)
      await page.screenshot({ path: path.join(SHOTS, `app-tidy-${name}-${w}.png`) })
    }
    await page.setViewportSize(VIEW)
  }
  await widths('run')
  // 다시 누르면 접는다
  await open.first().click()
  await page.waitForFunction(() => !document.querySelector('[data-t=tdDet]'))
  await page.click('[data-t=tdTab-hist]')
  await page.waitForSelector('[data-t=run]', { timeout: 20000 })
  assert.ok((await page.locator('[data-t=tidyRow][data-kind=changed]').count()) >= 1)
  assert.match(await page.locator('[data-t=tidyRow]').first().innerText(), /카나리 비율/, '지난 정리 줄은 기록 제목')
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-tidy.png') })
  await widths('hist')
  // 넣을 곳 고르기 창 — 후보 · 「다른 항목」 이 한 무리의 라디오
  await s.hub.save({ user: 'kim', admin: true }, 'dpms', { record: { title: '넣을 곳 없는 메모 테스트', body: '당번 표를 다시 짠다.' } })
  await page.reload()
  await page.waitForSelector('[data-t=klist], [data-t=tdKnSel]')
  await mg(page, 'team', 'tidy')
  await page.waitForSelector('[data-t=tdKnSel]')
  await page.selectOption('[data-t=tdKnSel]', 'dpms')
  await page.waitForSelector('[data-t=tdPickBtn]', { timeout: 20000 })
  await page.locator('[data-t=tdPickBtn]').first().click()
  await page.waitForSelector('[data-t=tdPickWin] [data-t=tdPickSel]')
  assert.equal(await page.locator('[data-t=tdPickWin] .x').getAttribute('aria-label'), '닫기')
  await page.selectOption('[data-t=tdPickSel]', { index: 1 })
  assert.equal(await page.locator('[data-t=tdPickOther]').isChecked(), true, '목록에서 고르면 「다른 항목」 이 골라진다')
  await widths('pick')
  await page.keyboard.press('Escape')
  // 정리 때 바꾸기는 정리 화면의 ⋯(관리자) — 「이 지식의 사람」 은 걷었다(팀 권한은 관리자 · 일반 둘뿐)
  assert.equal(await page.locator('[data-t=nav-members]').count(), 0)
  await page.click('[data-t=tidyKebab]')
  await page.waitForSelector('[data-t=timeMenu]')
  assert.match(await page.locator('[data-t=timeMenu]').innerText(), /정리 방식[\s\S]*정해진 시각[\s\S]*정리 시각/)
  await page.keyboard.press('Escape')
  assert.deepEqual(await bannedIn(page), [])
  await s.hub.save({ user: 'kim', admin: true }, 'dpms', { record: { title: '메모: 화면 시험', body: '오늘 바뀐 것에 한 줄.' } })
  // 이력 — 한 흐름(날마다) · 내가 남긴 기록 줄 · 다른 화면과 같은 짜임(왼쪽 정렬 · 제목 · 설명)
  await hist(page)
  await page.waitForSelector('[data-t=feed] [data-t=histDay]')
  assert.equal(await page.locator('.main .big').innerText(), '이력')
  // 팀 지식만 한 흐름 — 갈래 · 지식 · 사람으로 거른다(개인 영역 거르기 · 개인 줄 없음) · 설정 안 메뉴에는 이력이 없다
  assert.equal(await page.locator('[data-t=mgNav]').count(), 0)
  assert.ok(await page.locator('[data-t=histRow][data-area=team]').count() >= 1)
  assert.equal(await page.locator('[data-t=histRow][data-area=me]').count(), 0, '팀 화면에 개인 줄이 없다')
  assert.equal(await page.locator('[data-t=histTiles] .tile').count(), 2)
  assert.equal(await page.locator('[data-t=logAreas]').count(), 0)
  assert.ok(await page.locator('[data-t=histRow][data-kind="저장"]').filter({ hasText: '메모' }).count() >= 1, '내가 남긴 기록')
  await page.locator('[data-t=histRow] .hl').first().click()
  await page.waitForSelector('[data-t=todayOpen]')
  assert.deepEqual(await bannedIn(page), [])
  assert.deepEqual(errors, [])
  await page.close()
})

test('자료 가져오기 · 지식 추가 · 보내기(M15 · M3 · M10): 목업 글 · 파일 넣기 · 금지어 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(s.url)
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist]')
  // 자료 가져오기 — 표 · 한 칸 · 알아들은 한 줄 · 끌어다 놓기
  await mg(page, 'team', 'import')
  await page.waitForSelector('[data-t=drop]')
  // 탭 셋 — 일 줄(넣는 칸 · 도는 일 · 자세히) · 가져올 곳(지켜보며 맞추기) · 끝난 일 · 더하기는 유형마다 칸
  assert.deepEqual((await page.locator('[data-t=impTabs] > span').allInnerTexts()).map((x) => x.replace(/\s*\d.*$/s, '')), ['일 줄', '가져올 곳', '끝난 일'])
  assert.match(await page.locator('[data-t=queue]').innerText(), /줄이 비었다/)
  // 가져올 곳 더하기는 팝업 — 머리의 단추로 연다(단추는 단추로 · 요구 v0.2 R5)
  await page.click('[data-t=sfOpen]')
  await page.waitForSelector('[data-t=sfCard]')
  assert.deepEqual(await page.locator('[data-t=sfTabs] span').allInnerTexts(), ['문서 폴더', '소스 코드(git)', 'DB'], '파일을 팀으로 나르는 내 PC 폴더는 없다')
  await page.click('[data-t=sf-git]')
  assert.match(await page.locator('[data-t=codeWhat]').innerText(), /묶음. 더한 뒤 저장소에 새로 올라온 묶음마다 바뀐 코드로 기록 하나/, '소스 코드는 커밋 이력으로: 채울 표를 고르지 않는다')
  assert.equal(await page.locator('#sf-rule').count(), 0)
  assert.match(await page.locator('[data-t=credNote]').innerText(), /화면으로는 받지 않는다/, '팀 화면은 git 자격을 받지 않는다')
  await page.click('[data-t=sf-db]')
  for (const f of ['host', 'port', 'database', 'schema', 'user']) assert.equal(await page.locator(`#sf-${f}`).count(), 1)
  assert.equal(await page.locator('#sf-password').count(), 0, '팀 화면은 DB 비밀번호 칸이 없다')
  assert.match(await page.locator('[data-t=dbNote]').innerText(), /테이블마다 정의 표를 채우고 바뀐 테이블만 고친다[\s\S]*어떤 계정이든 세션을 읽기 전용으로 열어 쓰지 않는다/)
  await page.click('[data-t=sfAdd]')
  assert.match(await page.locator('[data-t=sfMsg]').innerText(), /호스트 칸을 채운다/)
  await page.fill('#sf-host', 'db.team.local')
  await page.fill('#sf-database', 'gdi')
  await page.fill('#sf-user', 'kmd_read')
  await page.click('[data-t=sfAdd]')
  // 처음 쓰는 지식은 git 이력을 세우며 첫 묶음을 만든다 — 이 PC(Windows · 바쁨)에서 몇 초 걸린다
  await page.waitForSelector('[data-t=srcRow][data-name="gdi DB"]', { timeout: 90000 })
  assert.equal(await page.locator('[data-t=sfCard]').count(), 0, '더하면 팝업이 닫힌다')
  assert.match(await page.locator('[data-t=srcRow][data-name="gdi DB"]').innerText(), /DB · 읽기만/)
  // 줄을 누르면 자세히 — 보기 · 고치기 · 지우기 · 자격 한 줄(팀은 화면으로 받지 않는다)
  await page.click('[data-t=srcRow][data-name="gdi DB"]')
  await page.waitForSelector('[data-t=srcModal]')
  assert.match(await page.locator('[data-t=credLine]').innerText(), /kmd secret set src\/\S+/)
  assert.deepEqual(await page.locator('[data-t=srcModal] .mf button').allInnerTexts(), ['지우기', '지금 가져오기', '전체 다시 맞추기', '고친 것 저장'])
  await page.click('[data-t=srcModal] .mh .x')
  // 이력 — 가져오는 곳을 더한 일은 기록이 아니라 이력 한 곳에
  await hist(page) // 이력 — 오늘 바뀐 것과 kmd 가 다룬 일이 한 흐름
  await page.waitForSelector('[data-t=histRow]')
  assert.match(await page.locator('[data-t=histRow][data-kind="설정"]').first().innerText(), /가져올 곳 더함. gdi DB/)
  await page.click('[data-t=logKind-설정]')
  assert.equal(await page.locator('[data-t=histRow]:not([data-kind="설정"])').count(), 0, '갈래로 거른다')
  await page.click('[data-t=logKind-all]')
  await mg(page, 'team', 'import')
  // 더한 뒤라 가져올 곳 탭이 열려 있다 — 일 줄로
  await page.waitForSelector('[data-t=srcTable]')
  await page.click('[data-t=impTab-queue]')
  await page.waitForSelector('[data-t=drop]')
  // 넣을 곳 — 옆 메뉴에서 고른 지식이 기본 · 드롭 영역에서 바꾼다 · 팀 화면에는 받은편지함(새로)이 없다(개인 지식은 내 PC 에)
  assert.equal(await page.locator('#impKn').count(), 1)
  assert.match(await page.locator('#impKn').inputValue(), /\S/, '고른 지식이 기본')
  assert.equal(await page.locator('#impKn option[value=""]').count(), 0, '팀 서버에 받은편지함을 세우지 않는다')
  await page.selectOption('#impKn', 'dpms')
  await page.setInputFiles('#fileIn', { name: '회의록-1021.md', mimeType: 'text/markdown', buffer: Buffer.from('# 회의록-1021\n\n## 정한 것\n배포 창은 화 · 목.\n') })
  // 넣은 파일은 기록이 된다 — 정리가 기존 문서에 넣거나 새 문서로 세운다 · [보기] 는 그 기록 · 끝난 일은 「끝난 일」 탭에
  await page.click('[data-t=impTab-done]')
  await page.waitForFunction(() => /기록이 됐다/.test(document.querySelector('[data-t=impMsg]')?.textContent || ''), null, { timeout: 90000 })
  assert.match(await page.locator('[data-t=impRow]').first().innerText(), /회의록-1021\.md → DPMS 지식 › 기록[\s\S]*정리가 기존 문서에 넣거나 새 문서로 세운다/)
  assert.equal(await page.locator('[data-t=impRow] [data-t=impRec]').count(), 1)
  await page.click('[data-t=impTab-queue]')
  await page.setInputFiles('#fileIn', { name: '스캔.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  await page.click('[data-t=impTab-done]')
  await page.waitForFunction(() => /개인 프로그램/.test(document.querySelector('[data-t=impMsg]')?.textContent || ''))
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-import.png') })
  // 지식 추가 — 지식 목록의 카드 → 팝업(이름만 · 요구 v0.2 R2)
  await page.goto(s.url + '/')
  await page.waitForSelector('[data-t=klist]')
  await page.click('[data-t=addCardTeam]')
  await page.waitForSelector('[data-t=addPop] #addIn')
  // 팀 화면의 새 지식은 팀 지식뿐(개인 영역 고르기 없음) · 받는 팀 지식 칸 없음
  assert.equal(await page.locator('[data-t=addArea]').count(), 0)
  assert.match(await page.locator('[data-t=addPop]').innerText(), /팀 지식 폴더에 팀 지식으로 선다/)
  assert.equal(await page.locator('[data-t=addTo]').count(), 0, '팀 지식에는 받는 팀 지식 칸이 없다')
  await page.click('[data-t=addBtn]')
  assert.match(await page.locator('[data-t=addMsg]').innerText(), /이름을 쓴다/)
  await page.fill('#addIn', '보안점검')
  await page.click('[data-t=addBtn]')
  await page.waitForSelector('[data-t=syncMsg]')
  assert.match(await page.locator('[data-t=syncMsg]').innerText(), /만들었다: 보안점검 · 팀 지식/)
  assert.equal(await page.locator('[data-t=addPop]').count(), 0)
  assert.equal(await page.locator('[data-t=klist] [data-t=krow][data-name="보안점검"]').count(), 1, '새 팀 지식은 위 팀 지식에')
  // 메뉴에서 빼기 → 아래 「뺀 지식」 · 옆 메뉴에 없다 → 메뉴에 올리기
  await page.locator('[data-t=krow][data-name="GDI 지식"] [data-t=knKebab]').click()
  await page.click('.pop [data-t=knHide]')
  await page.waitForSelector('[data-t=hidList] [data-t=kHid][data-name="GDI 지식"]')
  await page.click('[data-t=kpick]')
  assert.equal(await page.locator('[data-t=kmenuKn]').filter({ hasText: 'GDI 지식' }).count(), 0, '뺀 지식은 지식 고르기에 없다')
  await page.keyboard.press('Escape')
  await page.click('[data-t=hidList] [data-t=knShow]')
  await page.waitForFunction(() => !document.querySelector('[data-t=hidList]'))
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-add.png') })
  // 지식 보내기는 개인 화면에서만(분리) — 팀 화면에는 메뉴가 없다 · 개인 화면 시험이 본다
  await mg(page, 'team', 'tidy')
  assert.equal(await page.locator('[data-t=mg-send]').count(), 0)
  assert.deepEqual(await bannedIn(page), [])
  assert.deepEqual(errors, [])
  await page.close()
  // 목업의 같은 화면
  const mock = await browser.newPage({ viewport: VIEW })
  await mock.goto(MOCK)
  await mock.click('[data-t=loginBtn]')
  await mock.waitForSelector('[data-t=klist]')
  await mock.click('[data-t=nav-import]')
  await mock.waitForSelector('[data-t=drop]')
  await mock.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-import.png') })
  await mock.close()
})

test('설정 · 관리(M13 · M14): 탭 셋 · 저절로 하는 일 · 정리 전용 로그인 흐름 · 금지어 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  if (!s.auth.people().includes('test-lee')) await s.auth.addUser({ id: 'test-lee' }) // 사람 ⋯ › 지식마다 자리 창을 볼 사람
  process.env.KMD_CLAUDE_LOGIN = path.join(HERE, 'fixture', 'fake-claude-login.mjs')
  process.env.KMD_TEAM_LOGIN = 'pty' // 화면 없는 서버의 길(주소 · 번호)
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(s.url)
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist]')
  await mg(page, 'team', 'gen')
  assert.equal(await page.locator('[data-t=mgNav] .mgt').innerText(), '설정')
  assert.equal(await page.locator('[data-t=setTitle]').innerText(), '일반')
  assert.deepEqual(await mgItems(page), ['가져오기', '정리', '일반', '사람', 'Claude 연결', '에이전트 설치', '관리'])
  await page.waitForSelector('[data-t=auto-find]')
  assert.match(await page.locator('.main .card .ch').first().innerText(), /이 팀 서버/)
  await page.click('[data-t=sw-find]')
  await page.waitForFunction(() => /꺼 두었다/.test(document.querySelector('[data-t=auto-find]').textContent))
  await page.click('[data-t=sw-find]')
  await page.waitForFunction(() => !/꺼 두었다/.test(document.querySelector('[data-t=auto-find]').textContent))
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-settings.png') })
  await page.click('[data-t=mg-claude]')
  // 관리자 — 정리 전용 로그인을 이 탭에서 다 한다(관리로 보내지 않는다)
  await page.waitForSelector('[data-t=admClaude] [data-t=admLoginStart]')
  assert.equal(await page.locator('[data-t=toAdmClaude]').count(), 0)
  // 개인 프로그램 설치(옆 메뉴 · 누구나) — 설치 · 잇기 한 줄 · 내 기기 한 곳(작업 폴더에 팀 지식 붙이기는 설정 › 에이전트 설치 탭)
  await page.click('[data-t=nav-install]')
  await page.waitForSelector('[data-t=installCard]')
  assert.equal(await page.locator('.hdr .crumb').innerText(), '개인 프로그램 설치')
  await page.click('[data-t=installCopy]')
  await page.waitForSelector('[data-t=installLine]')
  assert.match(await page.locator('[data-t=installLine]').innerText(), /\/i\/kmdt_[A-Za-z0-9_-]+/)
  await page.waitForSelector('[data-t=devList]')
  for (const w of [1280, 1024, 600, 375]) {
    await page.setViewportSize({ width: w, height: 820 })
    const r = await cutAt(page)
    assert.deepEqual(r.cut, [], `개인 프로그램 설치 ${w}: 잘린 요소 없음`)
    assert.ok(r.sw <= r.w, `개인 프로그램 설치 ${w}: 가로 넘침 없음`)
    await page.screenshot({ path: path.join(SHOTS, `app-install-${w}.png`) })
  }
  await page.setViewportSize(VIEW)
  assert.equal(await page.locator('[data-t=agentCard]').count(), 0, '개인 프로그램 설치에 에이전트 설치 카드가 없다')
  await mg(page, 'team', 'agent')
  await page.waitForSelector('[data-t=agentCard]')
  assert.equal(await page.locator('[data-t=setTitle]').innerText(), '에이전트 설치')
  for (const w of [1280, 1024, 600, 375]) {
    await page.setViewportSize({ width: w, height: 820 })
    const r = await cutAt(page)
    assert.deepEqual(r.cut, [], `에이전트 설치 ${w}: 잘린 요소 없음`)
    assert.ok(r.sw <= r.w, `에이전트 설치 ${w}: 가로 넘침 없음`)
  }
  await page.setViewportSize(VIEW)
  assert.equal(await page.locator('[data-t=agGuide] > li').count(), 4)
  const teamRows = await page.locator('[data-t=agInstTeam] [data-t=agInstRow]').evaluateAll((els) => els.map((e) => e.dataset.name))
  assert.ok(['DPMS 지식', 'GDI 지식'].every((n) => teamRows.includes(n)), '팀 지식이 늘어선다: ' + teamRows)
  assert.equal(await page.locator('[data-t=agInstMe]').count(), 0, '팀 화면에 개인 지식 목록이 없다')
  await page.locator('[data-t=agInstTeam] [data-t=agInstRow][data-name="DPMS 지식"] [data-t=agentCopy]').click()
  await page.waitForSelector('[data-t=agCopied]')
  assert.match(await page.locator('[data-t=agCopiedLine]').innerText(), /^irm '.+\/a\/kmdt_[A-Za-z0-9_-]+\?kn=dpms' \| iex$/, '팀 에이전트 설치 한 줄(개인 프로그램 설치 한 줄이 아니다)')
  await page.locator('[data-t=agentCard]').screenshot({ path: path.join(SHOTS, 'app-agent.png') })
  assert.equal(await page.locator('text=내 PC 프로그램').count(), 0)
  await mg(page, 'team', 'people')
  // 사람 규칙 — 전역 관리자 + 지식마다 자리(읽기 · 쓰기 · 관리) · 옛 「지식마다 따로 주는 권한은 없다」 는 걷었다 · 관리자에게는 묶음 카드
  assert.match(await page.locator('[data-t=roleRule]').innerText(), /관리자[\s\S]*지식마다 자리[\s\S]*읽기[\s\S]*쓰기[\s\S]*관리[\s\S]*권한/)
  assert.doesNotMatch(await page.locator('[data-t=roleRule]').innerText(), /따로 주는 권한은 없다/)
  await page.waitForSelector('[data-t=admGroups] [data-t=grpAddOpen]')
  // 사람 더하기 — 아이디 · 총괄 관리자 · 팀 지식마다 자리 표(처음은 모두 없음) · 총괄 관리자면 표 대신 한 줄
  await page.click('[data-t=admAddOpen]')
  await page.waitForSelector('[data-t=admAddForm] [data-t=seatTable]')
  assert.ok(await page.locator('[data-t=admAddForm] [data-t=seatRow]').count() >= 2)
  assert.deepEqual(await page.locator('[data-t=admAddForm] [data-t=seatRow]').first().locator('option').allInnerTexts(), ['없음', '읽기', '쓰기', '지식관리자'])
  assert.equal(await page.locator('[data-t=admAddForm] [data-t=seatSel]').first().inputValue(), 'none')
  for (const w of [1280, 1024, 600, 375]) {
    await page.setViewportSize({ width: w, height: 820 })
    const r = await cutAt(page)
    assert.deepEqual(r.cut, [], `사람 더하기 ${w}: 잘린 요소 없음`)
    assert.ok(r.sw <= r.w, `사람 더하기 ${w}: 가로 넘침 없음`)
  }
  await page.setViewportSize(VIEW)
  await page.click('[data-t=admAddAdmin]')
  await page.waitForSelector('[data-t=admAddForm] [data-t=seatAll]')
  await page.click('[data-a=admAddCancel]')
  // 사람 ⋯ › 지식마다 자리 — 창(묶음 · 주인 자리는 따로 보인다 · 저장)
  const other = page.locator('[data-t=admPerson]').filter({ has: page.locator('[data-t=admPersonKebab]') }).filter({ hasNotText: '총괄 관리자' }).first()
  {
    await other.locator('[data-t=admPersonKebab]').click()
    await page.click('.pop [data-t=seatOpen]')
    await page.waitForSelector('[data-t=seatWin] [data-t=seatTable]')
    assert.equal(await page.locator('[data-t=seatWin]').getAttribute('role'), 'dialog')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-t=seatWin]'))
  }
  // 설정 · 개인은 팀 화면에 없다(분리 — 개인 화면에서)
  assert.equal(await page.locator('[data-t=nav-settings-me]').count(), 0)
  // 관리 — 문제 줄만 · 정리 로그인은 설정 · 팀 › Claude 연결에서 다 한다(비밀번호 한 번 더 → 주소 → 번호 → 로그인됨)
  await mg(page, 'team', 'admin')
  await page.waitForSelector('[data-t=admList]')
  assert.match(await page.locator('.main .lead').last().innerText(), /문제가 있을 때만 줄이 선다/)
  assert.equal(await page.locator('[data-t=admClaude]').count(), 0)
  await mg(page, 'team', 'claude')
  await page.waitForSelector('[data-t=admClaude]')
  await page.waitForSelector('[data-t=claudeHow]')
  // 비밀번호 한 번 더는 공통 창(Q13) — 카드 안 칸이 없다 · 15분 안이면 묻지 않는다
  await page.click('[data-t=admLoginStart]')
  await page.waitForSelector('[data-t=sudoWin] #sudoPw, [data-t=admUrl]')
  assert.equal(await page.locator('#admPw').count(), 0)
  if (await page.locator('[data-t=sudoWin]').count()) { await page.fill('#sudoPw', me.pw); await page.click('[data-t=sudoOk]') }
  await page.waitForSelector('[data-t=admUrl]')
  assert.match(await page.locator('[data-t=admUrl]').innerText(), /^https:\/\/claude\.ai\/oauth\/authorize/)
  // 두 단계(주소 열기 · 번호 붙여 넣기)가 카드 안에 아래로 선다 — 긴 주소가 카드를 밀어내지 않는다
  assert.match(await page.locator('[data-t=admOpenUrl]').getAttribute('href'), /^https:\/\/claude\.ai\/oauth\/authorize/)
  const box = await page.locator('[data-t=admClaude]').boundingBox(), code = await page.locator('[data-t=admCode]').boundingBox()
  assert.ok(code.x + code.width <= box.x + box.width + 1, '로그인 흐름이 카드 밖으로 나가지 않는다')
  assert.ok((await page.locator('#admCodeIn').boundingBox()).y > (await page.locator('[data-t=admUrl]').boundingBox()).y, '번호 칸은 주소 아래')
  await page.locator('[data-t=admClaude]').screenshot({ path: path.join(SHOTS, 'app-admin-login.png') })
  assert.match(await page.locator('[data-t=admUntil]').innerText(), /^\d\d:\d\d 까지$/, '언제까지 받는지')
  // 기다리던 로그인이 끝났으면(시간 · 서버가 다시 켜짐) 마치기는 [다시 시작] 으로 잇는다
  await page.evaluate(() => fetch('/api/admin/claude/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
  await page.fill('#admCodeIn', 'old-code')
  await page.click('[data-t=admDone]')
  await page.waitForSelector('[data-t=admRestart]')
  assert.match(await page.locator('[data-t=admExpired]').innerText(), /기다리던 로그인이 끝났다[\s\S]*다시 시작/)
  await page.click('[data-t=admRestart]')
  await page.waitForSelector('[data-t=admUrl]')
  // Claude 가 번호를 받지 않으면 — 그 까닭과 새 주소(같은 로그인) · 다시 받은 번호로 마친다
  await page.fill('#admCodeIn', 'bad')
  await page.click('[data-t=admDone]')
  await page.waitForSelector('[data-t=admCodeErr]')
  assert.match(await page.locator('[data-t=admCodeErr]').innerText(), /Claude 가 이 번호를 받지 않았다\(OAuth error[^)]*400\)[\s\S]*새 주소/)
  assert.match(await page.locator('[data-t=admUrl]').innerText(), /state=test-retry1/)
  assert.equal(await page.locator('#admCodeIn').inputValue(), '')
  await page.fill('#admCodeIn', 'code-from-browser')
  await page.click('[data-t=admDone]')
  await page.waitForFunction(() => /로그인됨 · 정리 전용/.test(document.querySelector('[data-t=admClaudeState]')?.textContent || ''))
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-admin.png') })
  assert.deepEqual(errors, [])
  await page.close()
  const mock = await browser.newPage({ viewport: VIEW })
  await mock.goto(MOCK)
  await mock.click('[data-t=loginBtn]')
  await mock.waitForSelector('[data-t=klist]')
  await mock.click('[data-t=nav-settings]')
  await mock.waitForSelector('[data-t=setTabs]')
  await mock.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-settings.png') })
  await mock.close()
})

test('목업과 나란히: 같은 크기로 지식 목록 · 문서 한 장을 찍는다', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  await page.goto(MOCK)
  await page.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-login.png') })
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist]')
  await page.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-home.png') })
  await page.click('[data-t=krow][data-name="DPMS 지식"]')
  await page.click('[data-t=rb-docs]')
  await page.click('[data-t=doc][data-name="배포절차"]')
  await page.waitForSelector('[data-t=docPane]')
  await page.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-docs.png') })
  // 목업의 셸 글이 프로그램에도 그대로 있다
  const mockShell = await page.evaluate(() => ({
    ribbon: [...document.querySelectorAll('.ribbon .rb span')].map((e) => e.textContent),
    aside: [...document.querySelectorAll('.aside .ap > h4')].map((e) => e.firstChild.textContent.trim()),
    tabbar: document.querySelector('[data-t=tabAdd]').title,
  }))
  assert.deepEqual(mockShell.ribbon, ['문서', '항목', '그래프', '설정'])
  assert.deepEqual(mockShell.aside.slice(0, 3), ['개요', '연결', '속성'])
  await page.click('[data-t=rb-items]')
  await page.click('[data-t=itemRow][data-name="헬스 체크"]')
  await page.waitForSelector('[data-t=itemPage]')
  await page.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-items.png') })
  await page.click('[data-t=rb-graph]')
  await page.waitForSelector('#gsvg')
  await page.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-graph.png') })
  await page.close()
  console.log(`# 나란히 볼 그림: ${SHOTS}`)
})

test('이 PC 화면: 정리가 따로 없다는 말(지식 만들기 · 설정) · 지식 추가 예 · 좁은 폭에서도 문서 본문이 선다', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const root = path.join(tmp, 'pc-screen')
  fs.mkdirSync(path.join(root, '배포노트', 'docs'), { recursive: true })
  fs.writeFileSync(path.join(root, '배포노트', 'README.md'), '# 배포노트\n')
  fs.writeFileSync(path.join(root, '배포노트', 'docs', '카나리.md'), '# 카나리\n\n## 비율\n' + '첫 30분은 요청의 10% 만 새 판으로 보낸다. '.repeat(12) + '\n')
  const pc = await startServer({ root, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  const page = await browser.newPage({ viewport: VIEW })
  try {
    await page.goto(`${pc.url}/#once=${pc.auth.once(pc.pcUser)}`)
    await page.waitForSelector('[data-t=klist]')
    // 지식 만들기 — 넣으면 Claude Code 가 곧바로 항목으로(요구 16 · v0.2 R8) · 「정리가 문서로」 라고 하지 않는다
    await mg(page, 'me', 'import')
    await page.waitForSelector('[data-t=drop]')
    const imp = await page.locator('[data-t=main]').innerText()
    assert.match(imp, /Claude Code 가 지식을 둘러보고 갈래 · 주제 문서의 항목으로/)
    assert.match(imp, /흐름과 터미널/)
    assert.doesNotMatch(imp, /정리가 (기존 문서|문서로|이어지는)/)
    // 일 줄 머리 — 동시에 도는 수(이 PC 는 누구나 고른다) · 줄 멈춤
    await page.waitForSelector('[data-t=cap-claude]')
    assert.equal(await page.locator('[data-t=cap-claude]').inputValue(), '1')
    assert.equal(await page.locator('[data-t=cap-fetch]').inputValue(), '2')
    assert.equal(await page.locator('[data-t=qHold]').innerText(), '줄 멈춤')
    // 설정 — Claude 스위치는 「정해진 시각의 자동 정리」 가 아니라 기록을 곧바로 문서로
    await mg(page, 'me', 'gen')
    await page.waitForSelector('[data-t=auto-claude]')
    assert.match(await page.locator('[data-t=auto-claude]').innerText(), /기록을 문서로: Claude 로[\s\S]*곧바로/)
    // 지식 추가 — 지식 고르기의 「+ 지식 추가」 → 지식 목록 위 팝업(이름만) · 지식 폴더 띠(경로 · 동기화) — 요구 v0.2 R2
    await page.click('[data-t=kpick]')
    await page.click('[data-t=nav-add]')
    await page.waitForSelector('[data-t=addPop] #addIn')
    assert.match(await page.locator('[data-t=addPop]').innerText(), /지식 폴더 안에 선다. 나만 본다[\s\S]*폴더 경로를 쓰면/)
    assert.equal(await page.locator('[data-t=rootPath]').innerText(), root)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[data-t=addPop]').count(), 0)
    // 좁은 폭 — 옆 메뉴는 서랍(☰ · 고르면 닫힌다) · 가운데 문서 본문이 0 높이로 접히지 않는다 · 잘린 요소가 없다(요구 18 · 컨벤션 11절)
    await page.setViewportSize({ width: 420, height: 820 })
    const side = async () => { await page.click('[data-t=menuBtn]'); await page.waitForSelector('#app.side-open') }
    await side()
    await page.click('[data-t=kpick]')
    await page.click('[data-t=kmenuKn]')
    assert.equal(await page.locator('#app.side-open').count(), 0, '고르면 서랍이 닫힌다')
    await side()
    await page.click('[data-t=rb-docs]')
    await side()
    await page.click('[data-t=doc][data-name="카나리"]')
    await page.waitForSelector('[data-t=docPane]')
    const box = await page.evaluate(() => ({ main: document.querySelector('.main[data-t=main]').getBoundingClientRect().height, paper: document.querySelector('.paper').scrollHeight, sw: document.documentElement.scrollWidth, w: innerWidth }))
    assert.ok(box.main >= box.paper, `본문이 다 선다 ${JSON.stringify(box)}`)
    assert.ok(box.sw <= box.w, `가로 넘침 없음 ${JSON.stringify(box)}`)
    // 잘린 요소 — 보이는 요소 중 오른쪽 끝이 창 폭을 넘는데 가로로 밀어 볼 조상(overflow-x auto · scroll)이 없는 것
    const cut = await page.evaluate(() => {
      const W = innerWidth, out = []
      const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') continue
        const r = el.getBoundingClientRect()
        if (r.width && r.height && r.right > W + 1 && r.left < W && !scrolls(el)) out.push(`${el.tagName}.${el.className} ${Math.round(r.right)}`)
      }
      return out
    })
    assert.deepEqual(cut, [], '잘린 요소 없음')
    assert.deepEqual(await bannedIn(page), [])
  } finally {
    await page.close()
    await pc.close()
  }
})

test('개인 화면: 지식 보내기 · 받는 팀 지식 고르기 · 지식 폴더 바꾸기 · 네 폭에서 잘린 요소 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  // 분리 1단계 — 팀 화면에서 하던 개인 일이 개인 화면(개인 프로그램)에 다 있다
  const PCK = { user: pc.pcUser, admin: true, pc: true }
  const kn = await pc.hub.addKnowledge(PCK, { kind: 'new', name: '테스트-보내기' })
  await pc.hub.save(PCK, kn.id, { record: { title: '테스트 기록: 개인 화면에서 보냄', body: '개인 화면에서 팀 지식으로 보낸다.' } })
  await pc.hub.curateIdle(kn.id)
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(`${pc.url}/#once=${pc.auth.once(pc.pcUser)}`)
    await page.waitForSelector('[data-t=klist]')
    // 지식 폴더 띠 — 경로 · 동기화 · 바꾸기 · 빼기
    assert.equal(await page.locator('[data-t=addRoot] [data-t=meRootEdit]').count(), 1)
    assert.equal(await page.locator('[data-t=addRoot] [data-t=meRootDrop]').count(), 1)
    await page.click('[data-t=meRootEdit]')
    assert.equal(await page.locator('[data-t=meRootIn]').inputValue(), path.join(tmp, 'pc'))
    await page.click('[data-a=meRootCancel]')
    // 지식 관리 — 개인 화면에도 지식 보내기
    await mg(page, 'me', 'send')
    await page.waitForSelector('[data-t=mgNav]')
    assert.deepEqual(await mgItems(page), ['가져오기', '지식 보내기', '일반', 'Claude 연결', '에이전트 설치'])
    await page.click('[data-t=sendSrc]')
    await page.locator('[data-t=sendSrcItem]').filter({ hasText: '테스트-보내기' }).click()
    await page.waitForSelector('[data-t=sendSetup]')
    // 받는 팀 지식 — 이 PC 가 이은 팀의 지식(기기 열쇠로 본 목록)
    await page.locator('[data-t=sendTeam]').filter({ hasText: 'DPMS 지식' }).waitFor()
    await page.locator('[data-t=sendTeam]').filter({ hasText: 'DPMS 지식' }).click()
    await page.click('[data-t=sendSetRoute]')
    await page.waitForSelector('[data-t=sendBody]')
    assert.match(await page.locator('[data-t=sendRoute]').innerText(), /테스트-보내기 에서 보내는 것은 모두 DPMS 지식으로만 간다/)
    await page.locator('[data-t=sendRec]').filter({ hasText: '테스트 기록: 개인 화면에서 보냄' }).click()
    assert.equal(await page.locator('[data-t=sendBtn]').innerText(), 'DPMS 지식으로 1개 보내기')
    await page.click('[data-t=sendBtn]')
    await page.waitForSelector('[data-t=sendConfirm]')
    // 보내기 미리 보기 — 받는 팀 지식의 이름 장부로 맞춰 본다(이 기록은 이름이 닿지 않는다 · 보내기는 막지 않는다)
    await page.waitForFunction(() => /이름 장부에서 이름을 못 찾았다|이름에 닿는다|미리 보기를 하지 못했다/.test(document.querySelector('[data-t=sendPrev]')?.textContent || ''))
    assert.match(await page.locator('[data-t=sendPrev]').innerText(), /1개는 DPMS 지식 의 이름 장부에서 이름을 못 찾았다/)
    await page.click('[data-t=sendGo]')
    await page.waitForFunction(() => !document.querySelector('[data-t=sendConfirm]'))
    assert.ok((await s.hub.get('dpms')).works.some((w) => w.title === '테스트 기록: 개인 화면에서 보냄'), '팀 지식에 기록으로 들어갔다')
    await page.click('[data-t=sendTab-log]')
    assert.match(await page.locator('[data-t=sentRow]').first().innerText(), /DPMS 지식으로 1개를 보냈다/)
    // 받는 지식 바꾸기 — 새 이름을 그대로 쳐야 단추가 선다
    await page.click('[data-t=sendChange]')
    await page.waitForSelector('[data-t=sendChangeWin]')
    await page.locator('[data-t=sendChangeTeam]').filter({ hasText: 'GDI 지식' }).click()
    assert.equal(await page.locator('[data-t=sendChangeGo]').isDisabled(), true)
    await page.fill('#sendType', 'GDI 지식')
    assert.equal(await page.locator('[data-t=sendChangeGo]').isDisabled(), false)
    await page.click('[data-t=sendChangeWin] .btn.ghost')
    assert.match(await page.locator('[data-t=sendTo]').innerText(), /DPMS 지식/, '취소하면 그대로')
    // 네 폭 — 잘린 요소 · 가로 넘침 0(보내기 화면)
    for (const w of [1280, 1024, 600, 375]) {
      await page.setViewportSize({ width: w, height: 820 })
      await page.click('[data-t=sendTab-rec]')
      const r = await page.evaluate(() => {
        const W = innerWidth, out = []
        const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
        for (const el of document.querySelectorAll('.main *')) {
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.display === 'none') continue
          const b = el.getBoundingClientRect()
          if (b.width && b.height && b.right > W + 1 && b.left < W && !scrolls(el)) out.push(`${el.tagName}.${el.className} ${Math.round(b.right)}`)
        }
        return { cut: out, sw: document.documentElement.scrollWidth, w: W }
      })
      assert.deepEqual(r.cut, [], `${w}: 잘린 요소 없음`)
      assert.ok(r.sw <= r.w, `${w}: 가로 넘침 없음 ${r.sw}`)
      await page.screenshot({ path: path.join(SHOTS, `app-pc-send-${w}.png`) })
    }
    await page.setViewportSize(VIEW)
    // 새 지식 팝업 — 받는 팀 지식을 함께 정한다
    await page.goto(`${pc.url}/`)
    await page.waitForSelector('[data-t=klist]')
    await page.click('[data-t=klist] [data-t=addCard]')
    await page.waitForSelector('[data-t=addTo]')
    await page.fill('#addIn', '테스트-보내기2')
    await page.selectOption('[data-t=addTo]', { label: 'DPMS 지식' })
    await page.click('[data-t=addBtn]')
    await page.waitForSelector('[data-t=syncMsg]')
    assert.match(await page.locator('[data-t=syncMsg]').innerText(), /보내는 곳 DPMS 지식/)
    const v = await pc.hub.sendView(PCK, '테스트-보내기2')
    assert.equal(v.route && v.route.kn, 'dpms')
    // 에이전트 설치(개인) — 개인 지식만 · 기본 지식은 없다 · 팀 지식은 팀 화면에서
    await mg(page, 'me', 'agent')
    await page.waitForSelector('[data-t=agentCard] [data-t=agentAddBtn]')
    assert.match(await page.locator('[data-t=agentCard] .ch').innerText(), /개인 지식을 붙인다/)
    assert.doesNotMatch(await page.locator('[data-t=agentCard]').innerText(), /기본으로|기본 지식에/)
    await page.click('[data-t=agentMore] summary')
    assert.match(await page.locator('[data-t=agentMore]').innerText(), /팀 화면 › 설정 › 에이전트 설치[\s\S]*kmd-team-work/)
    for (const w of [1280, 1024, 600, 375]) {
      await page.setViewportSize({ width: w, height: 820 })
      const r = await cutAt(page)
      assert.deepEqual(r.cut, [], `개인 에이전트 설치 ${w}: 잘린 요소 없음`)
      assert.ok(r.sw <= r.w, `개인 에이전트 설치 ${w}: 가로 넘침 없음`)
    }
    await page.setViewportSize(VIEW)
    assert.deepEqual(await bannedIn(page), [])
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('팀 화면: 팀 지식만 — 지식 목록 · 이력 · 설정 · 정리 · 1280 · 1024 · 600 · 375 에서 잘린 요소 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(s.url)
    await page.fill('#lgId', 'kim')
    await page.fill('#lgPw', me.pw)
    await page.click('[data-t=loginBtn]')
    await page.waitForSelector('[data-t=klist]')
    // 개인 프로그램을 부르지 않는다 — 팀 화면의 요청은 팀 서버로만
    const asked = []
    page.on('request', (r) => { if (!r.url().startsWith(s.url)) asked.push(r.url()) })
    const screens = [['home', null], ['history', async () => hist(page)], ['settings', async () => mg(page, 'team', 'gen')], ['tidy', async () => mg(page, 'team', 'tidy')]]
    for (const [name, open] of screens) {
      await page.setViewportSize(VIEW)
      if (open) await open(); else { await page.goto(s.url + '/'); await page.waitForSelector('[data-t=klist]') }
      await page.waitForTimeout(300)
      for (const w of [1280, 1024, 600, 375]) {
        await page.setViewportSize({ width: w, height: 820 })
        await page.waitForTimeout(100)
        const r = await cutAt(page)
        assert.deepEqual(r.cut, [], `${name} ${w}: 잘린 요소 없음`)
        assert.ok(r.sw <= r.w, `${name} ${w}: 가로 넘침 없음 ${r.sw}`)
        await page.screenshot({ path: path.join(SHOTS, `app-team-${name}-${w}.png`) })
      }
    }
    assert.deepEqual(asked, [], '팀 서버 밖으로 요청하지 않는다')
    assert.equal(await page.locator('text=내 PC').count(), 0)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('따로 할 것(Q11 · Q50 · Q51 · Q52): 설정은 일반으로 · 고르는 줄 combobox · 카드 이름 단추 · 그래프 점 목록', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(s.url)
    await page.fill('#lgId', 'kim')
    await page.fill('#lgPw', me.pw)
    await page.click('[data-t=loginBtn]')
    await page.waitForSelector('[data-t=klist] [data-t=krow]')
    // Q51 — 카드는 role=group · 여는 것은 이름 단추
    const card = page.locator('[data-t=krow][data-name="DPMS 지식"]')
    assert.equal(await card.getAttribute('role'), 'group')
    assert.equal(await card.locator('[data-t=knOpen]').evaluate((e) => e.tagName), 'BUTTON')
    // Q11 — 옆 메뉴 「설정」 은 설정 › 일반
    await page.click('[data-t=nav-settings-team]')
    await page.waitForSelector('[data-t=mgNav]')
    assert.equal((await page.locator('[data-t=mgNav] .mgi.on').innerText()).trim(), '일반')
    // Q50 — 빨리 열기: combobox · listbox · 고른 줄이 activedescendant
    await page.keyboard.press('Control+o')
    await page.waitForSelector('#qoIn[role=combobox]')
    await page.keyboard.type('배포')
    await page.waitForSelector('#qoList [role=option]')
    await page.keyboard.press('ArrowDown')
    const ad = await page.getAttribute('#qoIn', 'aria-activedescendant')
    assert.equal(await page.locator(`#${ad}`).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Escape')
    // Q52 — 그래프: canvas 대체 글 · 옆 칸 점 목록을 누르면 고른다
    await page.goto(s.url + '/')
    await page.click('[data-t=krow][data-name="DPMS 지식"] [data-t=knOpen]')
    await page.click('[data-t=rb-graph]')
    await page.waitForSelector('[data-t=gList] [data-t=gListRow]')
    assert.match(await page.getAttribute('#gcv', 'aria-label'), /^그래프: 점 \d+ · 선 \d+/)
    await page.locator('[data-t=gList] [data-t=gListRow]').first().click()
    await page.waitForSelector('[data-t=gCard][data-name]')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('A8 정리 · 반영 대기: 제안이 실린 기록에 「제안 있음」 · 확인 대기면 지식관리자의 [넣기] 로 넣는다', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  await s.auth.addUser({ id: 'test-prop', admin: false })
  await seat(s, 'test-prop', { dpms: 'write' })
  const k = await s.hub.get('dpms')
  const body = sectionOf(k, 'proc:준비').sec.body
  const m = body.match(/[^\n]*\d+[^\n]*/)
  assert.ok(m, '값이 든 줄')
  const line = m[0], next = line.replace(/\d+/, (d) => String(Number(d) + 1))
  const r = await s.hub.save({ user: 'test-prop' }, 'dpms', { record: { title: '준비: 테스트 제안 값', body: `## 바뀐 것\n- 값: ${line.match(/\d+/)[0]} → ${next.match(/\d+/)[0]}`, touches: ['proc:준비'] }, sections: [{ coord: 'proc:준비', base: sha16(body), edits: [{ find: line, replace: next }] }] }, { queue: true })
  assert.equal(r.proposals[0].waits, 'review', r.proposals[0].why)
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(s.url)
    await page.fill('#lgId', 'kim')
    await page.fill('#lgPw', me.pw)
    await page.click('[data-t=loginBtn]')
    await page.waitForSelector('[data-t=klist]')
    await mg(page, 'team', 'tidy')
    if (await page.locator('[data-t=tdKnSel]').count()) await page.selectOption('[data-t=tdKnSel]', 'dpms')
    const row = page.locator('[data-t=tdRec]', { has: page.locator('[data-t=tdProp]') }).first()
    await row.waitFor()
    assert.match(await row.locator('[data-t=tdProp]').innerText(), /제안 있음 1[\s\S]*확인 대기 1/)
    await row.locator('[data-t=tdPropPut]').click()
    await page.waitForSelector('[data-t=toast]')
    assert.match(await page.locator('[data-t=toast]').last().innerText(), /제안 1 을 넣었다/)
    assert.equal((await s.hub.get('dpms')).byWork.get(r.id).state, 'in')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})
