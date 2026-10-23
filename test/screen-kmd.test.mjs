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
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOCK = pathToFileURL(path.join(HERE, '..', 'docs', 'kmd_목업_인터랙션.html')).href
const SHOTS = process.env.KMD_SHOTS || path.join(os.tmpdir(), 'kmd-shots')
const CHROME = [process.env.KMD_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p))

// 사람 화면에 쓰지 않는 말(절차서 §0 「화면 말」)
const BANNED = ['좌표', '섹션', '원천', '기준선', '큐레이션', '대기열', '판정', '토큰', '커밋', '레포', '미러', '동기화', 'LLM', 'RAG', '노드', '엣지', '백링크', 'coord', 'commit']

let tmp, s, browser, me
const VIEW = { width: 1300, height: 820 }

before(async () => {
  if (!CHROME) return
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-screen-'))
  const env = { ...process.env } // Chrome 은 원래 집 폴더로 띄운다(임시 APPDATA 면 프로필을 거절한다)
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  me = await signIn(s, { id: 'kim' })
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
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
})

async function bannedIn(page) {
  const text = await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[placeholder]')].map((e) => (e.title || '') + ' ' + (e.placeholder || '')).join(' '))
  return BANNED.filter((w) => text.includes(w))
}

test('셸 · 지식 목록 · 문서로 보기 — 목업과 같은 글 · 단추 · 금지어 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))

  // 들어가기 — 두 칸 + [들어가기] · 리본 · 옆 메뉴는 흐리게 · 틀리면 한 줄
  await page.goto(s.url)
  await page.waitForSelector('[data-t=loginBtn]')
  assert.match(await page.locator('.gate').innerText(), /팀 kmd 에 들어간다[\s\S]*한 번 들어오면 일주일쯤 이어진다/)
  assert.equal(await page.locator('.ribbon.dim').count(), 1)
  assert.equal(await page.getAttribute('#lgPw', 'autocomplete'), 'current-password')
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', 'wrong-password')
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=loginErr]')
  assert.equal(await page.locator('[data-t=loginErr]').innerText(), '아이디나 비밀번호를 확인하세요 — 여러 번 틀리면 잠시 막힌다')
  await page.screenshot({ path: path.join(SHOTS, 'app-login.png') })
  errors.length = 0 // 일부러 틀린 들어가기의 401 은 브라우저가 콘솔에 적는다
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist] [data-t=krow]')
  // 셸 — 리본 넷(문서 · 항목 · 그래프 · 설정) · 옆 메뉴 · 머리 · 띠 · 아래 줄
  assert.deepEqual(await page.locator('.ribbon .rb span').allInnerTexts(), ['문서', '항목', '그래프', '설정'])
  assert.deepEqual(await page.locator('.side .nav .sb-i span').allInnerTexts(), ['오늘 바뀐 것', '자료 가져오기', '설명서'])
  assert.match(await page.locator('.hdr').innerText(), /빨리 열기[\s\S]*Ctrl O[\s\S]*찾기[\s\S]*Ctrl K/)
  assert.equal(await page.locator('.band .who').innerText(), '팀 서버의 kmd · 같이 쓴다')
  assert.deepEqual(await page.locator('[data-t=krow]').evaluateAll((els) => els.map((e) => e.dataset.name)), ['DPMS 지식', 'GDI 지식'])
  assert.deepEqual(await page.locator('.tl a').allInnerTexts(), ['+ 지식 추가', '+ 자료 가져오기'])
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-home.png') })

  // 문서로 보기 — 나무 · 빈 가운데 · 이 지식
  await page.click('[data-t=krow][data-name="DPMS 지식"]')
  await page.waitForSelector('[data-t=tree] [data-t=doc]')
  assert.equal(await page.locator('.tabbar .none').innerText(), '열린 탭이 없다 — 왼쪽에서 열거나 Ctrl O')
  assert.match(await page.locator('[data-t=docsEmpty]').innerText(), /왼쪽 나무에서 문서나 기록을 연다/)
  assert.deepEqual(await page.locator('.tree .tf').evaluateAll((els) => els.map((e) => e.dataset.t)), ['fold-docs', 'fold-recs', 'fold-atts'])
  assert.equal(await page.locator('[data-t=moreDocs]').innerText(), '6개 더')

  // 문서 하나 — 탭 · 항목 다섯 · 옆 칸(개요 · 이 문서를 가리키는 것 · 속성)
  await page.click('[data-t=moreDocs]')
  await page.click('[data-t=doc][data-name="배포절차"]')
  await page.waitForSelector('[data-t=docPane]')
  assert.deepEqual(await page.locator('[data-t=tab] .nm').allInnerTexts(), ['배포절차'])
  assert.deepEqual(await page.locator('[data-t=docPane] h2[data-sec]').evaluateAll((els) => els.map((e) => e.dataset.sec)), ['준비', '카나리', '헬스 체크', '롤백', '꾸러미 판'])
  assert.deepEqual(await page.locator('.aside .ap > h4').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim())), ['개요', '이 문서를 가리키는 것', '속성'])
  assert.equal(await page.locator('[data-t=olRow]').count(), 5)
  assert.equal(await page.locator('[data-t=penrec]').count(), 1, '롤백 아래 아직 안 넣은 기록 한 줄')
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
  assert.equal(await page.locator('[data-t=recState]').innerText(), '아직 문서에 안 넣은 기록')
  assert.equal(await page.locator('[data-t=recItem]').count(), 1)

  // 글 속 항목 이름 → 항목 링크 · 마우스를 올리면 미리보기 카드
  await page.click('[data-t=tab][data-name="배포절차"]')
  await page.waitForSelector('[data-t=docPane][data-name="배포절차"] .ilink')
  await page.hover('[data-t=docPane] .ilink >> nth=0')
  await page.waitForSelector('[data-t=pv]')

  // 항목으로 보기(M6) — 종류별 목록 · 항목 한 화면 · 옆 칸
  await page.click('[data-t=rb-items]')
  await page.waitForSelector('[data-t=itemList] [data-t=itemRow]')
  assert.deepEqual(await page.locator('.fcs .fc').allInnerTexts(), ['아직 안 넣은 것', '최근 바뀐 것', '내가 쓴 것'])
  await page.click('[data-t=itemRow][data-name="헬스 체크"]')
  await page.waitForSelector('[data-t=itemPage]')
  assert.deepEqual(await page.locator('[data-t=itemPage] .isec > h3').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim())), ['지금', '아직 문서에 안 넣은 기록', '지난 기록', '이 항목을 쓰는 곳', '다른 이름'])
  assert.ok((await page.locator('[data-t=itemHistRow]').count()) >= 5)
  assert.ok((await page.locator('[data-t=coItem]').count()) >= 1)
  await page.screenshot({ path: path.join(SHOTS, 'app-items.png') })

  // 그래프(M7) — 점 · 선 · 거름 · 범례 · 점을 누르면 카드
  await page.click('[data-t=rb-graph]')
  await page.waitForSelector('#gsvg [data-t=gnode]')
  assert.ok((await page.locator('#gsvg [data-t=gnode]').count()) > 10)
  assert.equal(await page.locator('[data-t=gLegend] .lgr').count(), 10)
  await page.locator('#gsvg [data-node="i:proc:헬스 체크"]').dispatchEvent('pointerdown', { button: 0, clientX: 1, clientY: 1 })
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

test('목업과 나란히 — 같은 크기로 지식 목록 · 문서 한 장을 찍는다', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
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
  assert.deepEqual(mockShell.aside.slice(0, 3), ['개요', '이 문서를 가리키는 것', '속성'])
  await page.click('[data-t=rb-items]')
  await page.click('[data-t=itemRow][data-name="헬스 체크"]')
  await page.waitForSelector('[data-t=itemPage]')
  await page.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-items.png') })
  await page.click('[data-t=rb-graph]')
  await page.waitForSelector('#gsvg')
  await page.locator('#app').screenshot({ path: path.join(SHOTS, 'mock-graph.png') })
  await page.close()
  console.log(`# 나란히 볼 그림 — ${SHOTS}`)
})
