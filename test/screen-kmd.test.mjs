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
import { workOnce } from '../core/worker.js'

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
  // Windows — 감시 · git 손잡이가 늦게 풀려 지우기가 EBUSY 일 때가 있다(임시 폴더라 남겨도 된다)
  try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
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
  assert.equal(await page.locator('[data-t=loginErr]').innerText(), '아이디나 비밀번호를 확인하세요 — 여러 번 틀리면 잠시 막힌다')
  await page.screenshot({ path: path.join(SHOTS, 'app-login.png') })
  errors.length = 0 // 일부러 틀린 들어가기의 401 은 브라우저가 콘솔에 적는다
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist] [data-t=krow]')
  // 셸 — 리본 없음 · 옆 메뉴 두 영역(지식 고르기: 고르기 · 문서 · 항목 · 그래프 탭 · 목록 / 지식 관리: 공통 메뉴) · 머리(찾기 가운데 · 설명서 · 나 오른쪽) · 띠 · 아래 줄
  assert.equal(await page.locator('.ribbon').count(), 0)
  assert.deepEqual(await page.locator('[data-t=ktabs] span').allInnerTexts(), ['문서', '항목', '그래프'])
  // 관리자라 「정리 · 이 지식의 사람 · 관리」 도 지식 관리에 선다
  assert.deepEqual(await page.locator('[data-t=manageArea] .sb-i').evaluateAll((els) => els.map((e) => e.querySelector('span').textContent)), ['이력', '지식 만들기', '정리', '이 지식의 사람', '관리', '설정'])
  assert.match(await page.locator('.hdr .hmid').innerText(), /빨리 열기[\s\S]*Ctrl O[\s\S]*찾기[\s\S]*Ctrl K/)
  assert.match(await page.locator('.hdr .hright').innerText(), /설명서[\s\S]*kim\s*· 팀 서버/)
  assert.equal(await page.locator('.band .who').innerText(), '팀 서버의 kmd · 같이 쓴다')
  assert.deepEqual(await page.locator('[data-t=krow]').evaluateAll((els) => els.map((e) => e.dataset.name)), ['DPMS 지식', 'GDI 지식'])
  assert.deepEqual(await page.locator('.tl a').allInnerTexts(), ['+ 지식 추가', '+ 지식 만들기'])
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

test('정리 · 이 지식의 사람 · 오늘 바뀐 것(M12 · M11 · M9) — 목업 글 · 금지어 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  const wkey = (await s.auth.workerAdd()).key
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
  await page.click('[data-t=nav-tidy]')
  await page.waitForSelector('[data-t=goBox]')
  assert.match(await page.locator('[data-t=nextTidy]').innerText(), /다음 정리 .* 02:30 · 받은 것 \d+/)
  assert.match(await page.locator('[data-t=inbox] .ch').innerText(), /받은 것 \d+/)
  await page.click('[data-t=tidyBtn]')
  await page.waitForSelector('[data-t=prog]')
  await workOnce({ server: s.url, key: wkey })
  await page.waitForSelector('[data-t=run]', { timeout: 20000 })
  assert.ok((await page.locator('[data-t=tidyRow][data-kind=changed]').count()) >= 1)
  assert.match(await page.locator('[data-t=run] .sub').first().innerText(), /넣은 것|값이 바뀐 것/)
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-tidy.png') })
  await page.click('[data-t=nav-members]')
  await page.waitForSelector('[data-t=kmdRow]')
  assert.match(await page.locator('[data-t=kmdRow]').innerText(), /kmd — 정해진 시간과 \[지금 정리\] 로 바로 넣는다 · 매일 02:30/)
  assert.deepEqual(await bannedIn(page), [])
  await s.hub.save({ user: 'kim', admin: true }, 'dpms', { record: { title: '메모 — 화면 시험', body: '오늘 바뀐 것에 한 줄.' } })
  // 이력 — 한 흐름(날마다) · 내가 남긴 기록 줄 · 다른 화면과 같은 짜임(왼쪽 정렬 · 제목 · 설명)
  await page.click('[data-t=nav-today]')
  await page.waitForSelector('[data-t=feed] [data-t=histDay]')
  assert.equal(await page.locator('.main .big').innerText(), '이력')
  assert.ok(await page.locator('[data-t=histRow][data-kind="저장"]').filter({ hasText: '메모' }).count() >= 1, '내가 남긴 기록')
  await page.locator('[data-t=histRow] .hl').first().click()
  await page.waitForSelector('[data-t=todayOpen]')
  assert.deepEqual(await bannedIn(page), [])
  assert.deepEqual(errors, [])
  await page.close()
})

test('자료 가져오기 · 지식 추가 · 보내기(M15 · M3 · M10) — 목업 글 · 파일 넣기 · 금지어 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(s.url)
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist]')
  // 자료 가져오기 — 표 · 한 칸 · 알아들은 한 줄 · 끌어다 놓기
  await page.click('[data-t=nav-import]')
  await page.waitForSelector('[data-t=drop]')
  // 두 영역 — ① 문서로 들이기 ② 표를 저절로 채우기 · 더하기는 유형마다 칸
  assert.deepEqual((await page.locator('[data-t=impSec]').allInnerTexts()).map((t) => t.split(' ').slice(0, 2).join(' ')), ['문서로 들이기', '지켜보며 맞추기'])
  assert.deepEqual(await page.locator('[data-t=sfTabs] span').allInnerTexts(), ['문서 폴더', '소스 코드(git)', 'DB'], '파일을 팀으로 나르는 내 PC 폴더는 없다')
  await page.click('[data-t=sf-git]')
  assert.match(await page.locator('[data-t=codeWhat]').innerText(), /묶음 — 더한 뒤 저장소에 새로 올라온 묶음마다 바뀐 코드로 기록 하나/, '소스 코드는 커밋 이력으로 — 채울 표를 고르지 않는다')
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
  await page.waitForFunction(() => /더했다 — gdi DB/.test(document.querySelector('[data-t=sfMsg]')?.textContent || ''), null, { timeout: 90000 })
  assert.match(await page.locator('[data-t=sfMsg]').innerText(), /kmd secret set src\/dpms\/gdi-db-[0-9a-f]{6}|kmd secret set src\/\S+/)
  await page.waitForSelector('[data-t=srcRow][data-name="gdi DB"]')
  assert.match(await page.locator('[data-t=srcRow][data-name="gdi DB"]').innerText(), /DB · 읽기만[\s\S]*kmd secret set/)
  // 이력 — 가져오는 곳을 더한 일은 기록이 아니라 이력 한 곳에
  await page.click('[data-t=nav-today]') // 이력 — 오늘 바뀐 것과 kmd 가 다룬 일이 한 흐름
  await page.waitForSelector('[data-t=histRow]')
  assert.match(await page.locator('[data-t=histRow][data-kind="설정"]').first().innerText(), /가져오는 곳 더함 — gdi DB/)
  await page.click('[data-t=logKind-설정]')
  assert.equal(await page.locator('[data-t=histRow]:not([data-kind="설정"])').count(), 0, '갈래로 거른다')
  await page.click('[data-t=logKind-all]')
  await page.click('[data-t=nav-import]')
  await page.waitForSelector('[data-t=drop]')
  // 파일 고르기 — 지금 연 지식이 없으면 받은편지함(처음 넣으면 생긴다)
  assert.match(await page.locator('[data-t=drop]').innerText(), /받은편지함\(처음 넣으면 생긴다\)/)
  await page.setInputFiles('#fileIn', { name: '회의록-1021.md', mimeType: 'text/markdown', buffer: Buffer.from('# 회의록-1021\n\n## 정한 것\n배포 창은 화 · 목.\n') })
  await page.waitForFunction(() => /문서가 됐다/.test(document.querySelector('[data-t=impMsg]')?.textContent || ''), null, { timeout: 90000 })
  assert.match(await page.locator('[data-t=impRow]').first().innerText(), /회의록-1021\.md → 받은편지함 › 회의록-1021/)
  await page.setInputFiles('#fileIn', { name: '스캔.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  await page.waitForFunction(() => /내 PC 프로그램/.test(document.querySelector('[data-t=impMsg]')?.textContent || ''))
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-import.png') })
  // 지식 추가 — 한 칸 · 알아들은 한 줄 · [추가]
  await page.goto(s.url + '/')
  await page.waitForSelector('[data-t=klist]')
  await page.click('text=+ 지식 추가')
  await page.waitForSelector('[data-t=addIn]')
  await page.fill('#addIn', 'git@gitlab.team.local:dpms/dpms-batch.git')
  assert.match(await page.locator('[data-t=addHeard]').innerText(), /코드 · DB 는 지식 만들기에서 더한다/)
  await page.fill('#addIn', 'D:\\옛자료')
  assert.match(await page.locator('[data-t=addHeard]').innerText(), /경로는 내 PC 프로그램이 연다/)
  await page.fill('#addIn', '설계메모')
  assert.match(await page.locator('[data-t=addHeard]').innerText(), /새 지식 만들기 — 팀 서버 안 내 지식 「설계메모」/)
  await page.click('[data-t=addBtn]')
  await page.waitForSelector('[data-t=addMsg]')
  assert.match(await page.locator('[data-t=addMsg]').innerText(), /만들었다 — 설계메모/)
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-add.png') })
  // 보내기 — 보낼 곳을 정한 내 지식에서 고친 것이 모인다 → [1개 보내기]
  const mine = (await s.hub.list()).find((k) => k.name === '설계메모').id
  const KIM = { user: 'kim', admin: true }
  await s.hub.sendDests(KIM, mine, [{ kn: 'dpms' }])
  await s.hub.edit(KIM, mine, { doc: '처음', sections: [{ h: '개요', body: '카나리는 첫 30분 20%.' }] })
  await page.goto(s.url + '/')
  await page.waitForSelector('[data-t=nav-send]')
  assert.match(await page.locator('[data-t=nav-send]').innerText(), /보내기\s*1/)
  await page.click('[data-t=nav-send]')
  await page.waitForSelector('[data-t=sendItem]')
  assert.match(await page.locator('.main .lead').innerText(), /만들어진 지식만 보낸다 — 바뀐 것은 골라 두었다[\s\S]*누르면 DPMS 지식으로 간다/)
  // ① 변경사항 — 고친 문서는 바뀐 항목만 · 처음엔 골라 둔다 · 전체 해제 / 전체 체크
  assert.match(await page.locator('[data-t=sendItem][data-kind=doc]').innerText(), /고친 항목만 — 개요/)
  assert.equal(await page.locator('[data-t=sendBtn]').innerText(), '변경사항 1개 보내기')
  await page.click('[data-t=sendAllOff]')
  assert.equal(await page.locator('[data-t=sendBtn]').innerText(), '변경사항 0개 보내기')
  assert.equal(await page.locator('[data-t=sendBtn]').isDisabled(), true)
  await page.click('[data-t=sendAllOn]')
  assert.equal(await page.locator('[data-t=sendBtn]').innerText(), '변경사항 1개 보내기')
  // ② 지식 — 문서 목록 · 기록 목록(여럿 골라 전체로)
  assert.ok((await page.locator('[data-t=sendDocs] [data-t=sendDoc]').count()) >= 1)
  assert.equal(await page.locator('[data-t=sendRecs]').count(), 1)
  // 영역마다 보내기 단추 — 지식에서 고른 것은 그 영역의 단추로
  assert.equal(await page.locator('[data-t=sendKnowBtn]').isDisabled(), true)
  await page.locator('[data-t=sendDoc]').first().click()
  assert.equal(await page.locator('[data-t=sendKnowBtn]').innerText(), '고른 1개 보내기')
  assert.equal(await page.locator('[data-t=sendBtn]').innerText(), '변경사항 1개 보내기')
  await page.locator('[data-t=sendDoc]').first().click()
  assert.equal(await page.locator('[data-t=sendKnowBtn]').innerText(), '고른 0개 보내기')
  assert.equal(await page.evaluate(() => /[\u2460-\u2473]/.test(document.querySelector('.main').innerText)), false, '① ② 같은 글자를 쓰지 않는다')
  await page.screenshot({ path: path.join(SHOTS, 'app-send.png') })
  await page.click('[data-t=sendBtn]')
  await page.waitForSelector('[data-t=sendEmpty]')
  assert.match(await page.locator('[data-t=sentRow]').first().innerText(), /1개를 보냈다/)
  assert.ok((await s.hub.get('dpms')).works.some((w) => w.tags.some((t) => t.startsWith('sent/'))))
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

test('설정 · 관리(M13 · M14) — 탭 셋 · 저절로 하는 일 · 정리 전용 로그인 흐름 · 금지어 0', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  process.env.KMD_CLAUDE_LOGIN = path.join(HERE, 'fixture', 'fake-claude-login.mjs')
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(s.url)
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist]')
  await page.click('[data-t=nav-settings]')
  await page.waitForSelector('[data-t=setTabs]')
  assert.deepEqual(await page.locator('[data-t=setTabs] span').allInnerTexts(), ['일반', 'Claude 연결', '에이전트 설치'])
  await page.waitForSelector('[data-t=auto-find]')
  assert.match(await page.locator('.main .card .ch').first().innerText(), /이 팀 서버/)
  await page.click('[data-t=sw-find]')
  await page.waitForFunction(() => /꺼 두었다/.test(document.querySelector('[data-t=auto-find]').textContent))
  await page.click('[data-t=sw-find]')
  await page.waitForFunction(() => !/꺼 두었다/.test(document.querySelector('[data-t=auto-find]').textContent))
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'app-settings.png') })
  await page.click('[data-t=st-claude]')
  assert.match(await page.locator('[data-t=claudeRead]').innerText(), /팀 정리는 정리 전용 로그인으로 돈다/)
  await page.click('[data-t=st-agent]')
  assert.equal(await page.locator('[data-t=copyInstall]').innerText(), '설치 한 줄 복사')
  // 관리 — 문제 줄 · Claude 연결(비밀번호 한 번 더 → 주소 → 번호 → 로그인됨)
  await page.click('[data-t=nav-admin]')
  await page.waitForSelector('[data-t=admClaude]')
  assert.match(await page.locator('.main .lead').innerText(), /문제가 있을 때만 줄이 선다/)
  await page.click('[data-t=admLoginStart]')
  await page.fill('#admPw', me.pw)
  await page.click('[data-t=admPwOk]')
  await page.waitForSelector('[data-t=admUrl]')
  assert.match(await page.locator('[data-t=admUrl]').innerText(), /^https:\/\/claude\.ai\/oauth\/authorize/)
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
