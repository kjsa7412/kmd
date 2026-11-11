// 권한 화면 — 지식 카드 ⋯ › 권한 창 · 문서 화면 속성 칸 「쓰는 사람」 · 관리 › 묶음 카드(docs/kmd_권한_모델.md 6절).
//
// 사람 넷: boss(총괄 관리자) · own(dpms 주인 — 지식관리자 자리, 비밀번호 한 번 더가 없다) · rd · no. own 이 창에서 「모두」 를 없음으로,
// rd 를 읽기로 더해 저장하면 서버 자리 표가 바뀌고 · rd 의 카드에는 「읽기」 칩 · 「고치기」 는 흐리게 · no 의 목록에는 dpms 가 없다.
// playwright-core + 이 PC 의 Chrome(없으면 건너뛴다 — KMD_CHROME). 찍은 그림은 KMD_SHOTS(없으면 임시 폴더의 kmd-shots)에 access-*.png.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = process.env.KMD_SHOTS || path.join(os.tmpdir(), 'kmd-shots')
const CHROME = [process.env.KMD_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p))
const BANNED = ['좌표', '섹션', '원천', '기준선', '큐레이션', '대기열', '판정', '토큰', '커밋', '레포', '미러', '동기화', 'LLM', 'RAG', '노드', '엣지', '백링크']

let tmp, data, s, browser
const P = {}
const ledger = () => JSON.parse(fs.readFileSync(path.join(data, 'owners.json'), 'utf8'))

before(async () => {
  if (!CHROME) return
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-accui-'))
  const env = { ...process.env }
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  const root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
  for (const id of ['own', 'rd', 'no']) P[id] = await signIn(s, { id, admin: false })
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'own' })
  // 기본 자리는 「없음」(권한 모델 v1.1 1절) · 서버를 켠 뒤에 만든 사람에게는 옮기기 자리도 없다 —
  // gdi 는 셋 모두 쓰기 자리로 주고(own 은 gdi 에서 쓰기 자리) · dpms 는 「모두: 쓰기」 를 자리 표에 적어 둔다(주인이 창에서 없음으로 바꾼다)
  for (const id of ['own', 'rd', 'no']) await seat(s, id, { gdi: 'write' })
  await s.hub.setAccess(SHELL, 'dpms', { all: 'write' })
  // Chrome 은 한글이 든 임시 경로의 프로필 폴더를 받지 않는다 — 그때만 레포의 .kmd-data/tmp(무시 목록)로
  if (!/^[\x20-\x7e]*$/.test(os.tmpdir())) {
    const ascii = path.join(HERE, '..', '.kmd-data', 'tmp')
    fs.mkdirSync(ascii, { recursive: true })
    env.TEMP = env.TMP = ascii
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true, env })
  fs.mkdirSync(SHOTS, { recursive: true })
})
after(async () => {
  await browser?.close()
  await s?.close()
  try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

async function login(who, viewport = { width: 1300, height: 820 }) {
  const page = await browser.newPage({ viewport })
  page._errs = []
  page.on('pageerror', (e) => page._errs.push(e.message))
  await page.goto(s.url)
  await page.waitForSelector('[data-t=loginBtn]')
  await page.fill('#lgId', who.id)
  await page.fill('#lgPw', who.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist]')
  return page
}
const card = (page, name) => page.locator(`[data-t=klist] [data-t=krow][data-name="${name}"]`)
// 모든 지식 줄 → 지식 상세(메뉴 개편 N6) · [열기] 로 그 지식 · 상세 탭 이름
async function detail(page, name) { await card(page, name).locator('[data-t=knOpen]').click(); await page.waitForSelector('[data-t=kdPane] [data-t=kdTabs]'); return page.locator('[data-t=kdTabs] [role=tab]').allInnerTexts() }
async function openKn(page, name) { await detail(page, name); await page.click('[data-t=kdPane] [data-t=knGo]') }
async function bannedIn(page) {
  const text = await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[placeholder],[aria-label]')].map((e) => (e.title || '') + ' ' + (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '')).join(' '))
  return BANNED.filter((w) => text.includes(w))
}

test('권한 창: 주인이 「모두」 를 없음으로 · rd 를 읽기로 더해 저장 → 자리 표 · 읽기 칩 · 고치기 흐림 · 없음은 목록에 없다', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await login(P.own)
  // 카드 글은 자리 표를 따른다(T13) — 「팀 모두 기록」 이 아니라 내 자리 칩
  await page.waitForSelector('[data-t=krow][data-name="DPMS 지식"] [data-t=lvChip]')
  assert.doesNotMatch(await card(page, 'DPMS 지식').innerText(), /팀 모두/)
  assert.equal(await card(page, 'DPMS 지식').locator('[data-t=lvChip]').innerText(), '지식관리자')
  // 지식 상세 › 권한 — 관리 자리에게만(gdi 는 own 이 쓰기 자리라 정보 탭만 · 6-4)
  assert.deepEqual(await detail(page, 'GDI 지식'), ['정보'], '쓰기 자리: 정보 탭만')
  assert.equal(await page.locator('[data-t=kdRecs]').count(), 0, '쓰기 자리: 관리 정보(GET manage)를 읽지 않는다')
  assert.deepEqual(await detail(page, 'DPMS 지식'), ['정보', '권한', '저장소', '정책'], '지식관리자: 삭제 없음')
  await page.waitForSelector('[data-t=kdRecs]')
  await page.click('[data-t=kdTab-repo]')
  await page.waitForSelector('[data-t=kdRepoView]')
  assert.match(await page.locator('[data-t=kdRepoView]').innerText(), /없음/, '지식관리자: 저장소는 보기만(GET backup)')
  assert.equal(await page.locator('[data-t=kdBody-repo] #repoUrl, [data-t=kdBody-repo] [data-t=repoSave]').count(), 0)
  await page.click('[data-t=kdTab-perm]')
  await page.waitForSelector('[data-t=kdPermTable]')
  await page.click('[data-t=kdPane] [data-t=accOpen]')
  await page.waitForSelector('[data-t=accWin] [data-t=accAllLv]')
  const win = page.locator('[data-t=accWin]')
  assert.equal(await win.getAttribute('role'), 'dialog')
  assert.match(await win.locator('[data-t=accOwner]').innerText(), /own[\s\S]*주인[\s\S]*관리/)
  assert.equal(await win.locator('[data-t=accAllLv]').inputValue(), 'write', '자리 표에 적어 둔 「모두: 쓰기」')
  assert.ok(await win.locator('[data-t=accSave]').isDisabled(), '바꾼 것이 없으면 저장은 흐리다')
  // 모두 → 없음 · rd 를 더하면 읽기로 선다
  await win.locator('[data-t=accAllLv]').selectOption('none')
  await win.locator('[data-t=accAddUPick]').selectOption('rd')
  await win.locator('[data-t=accAddU]').click()
  await page.waitForSelector('[data-t=accUser][data-name=rd]')
  assert.equal(await win.locator('[data-t=accUser][data-name=rd] [data-t=accUserLv]').inputValue(), 'read')
  assert.ok(!(await win.locator('[data-t=accSave]').isDisabled()))
  assert.deepEqual(await bannedIn(page), [])
  await page.screenshot({ path: path.join(SHOTS, 'access-win-1300.png') })
  await win.locator('[data-t=accSave]').click()
  await page.waitForSelector('[data-t=accWin]', { state: 'detached' })
  // 서버 자리 표
  const a = ledger().knowledge.dpms.access
  assert.equal(a.all, 'none')
  assert.deepEqual(a.users, { rd: 'read' })
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', '_members.md'), 'utf8'), /모두: 없음[\s\S]*읽기: rd/)
  // 문서 화면 속성 칸 — 관리 자리는 자리 표 요약 + [권한]
  await openKn(page, 'DPMS 지식')
  await page.waitForFunction(() => /모두 없음 · 사람 1/.test(document.querySelector('[data-t=whoVal]')?.textContent || ''))
  assert.equal(await page.locator('[data-t=whoVal] [data-t=accOpenSide]').count(), 1)
  // 옆 메뉴 자리별(메뉴 개편 6-4 · 저장 승인 P10) — 지식관리자 지식: 점검 · 생성 · 문서 · 이력 + 나무 머리 [구조]
  await page.waitForSelector('[data-t=tree] [data-t=doc]')
  assert.deepEqual(await page.locator('[data-t=knMenu] .kmi').evaluateAll((els) => els.map((e) => e.dataset.t)), ['nav-held', 'nav-import', 'nav-docs', 'nav-history'])
  assert.equal(await page.locator('[data-t=tree] [data-t=treeStruct]').count(), 1, '지식관리자: [구조]')
  assert.deepEqual(page._errs, [])
  await page.close()

  // rd — 읽기 칩 · 고치기는 흐리게(감추지 않는다)
  const p2 = await login(P.rd)
  await p2.waitForSelector('[data-t=krow][data-name="DPMS 지식"] [data-t=lvChip]')
  assert.equal(await card(p2, 'DPMS 지식').locator('[data-t=lvChip]').innerText(), '읽기')
  assert.deepEqual(await detail(p2, 'DPMS 지식'), ['정보'], '읽기 자리: 정보 탭만')
  assert.equal(await p2.locator('[data-t=accOpen], [data-t=allHead] [data-t=addKn], [data-t=rsOpen]').count(), 0, '읽기 자리: 권한 · 새 지식 · 불러오기 없음')
  assert.equal(await p2.locator('[data-t=knTable] th', { hasText: '저장소' }).count(), 0, '저장소 칸째 없음')
  assert.equal(await p2.locator('[data-t=myRole]').first().innerText(), '읽기')
  assert.deepEqual(await p2.locator('[data-t=mgNav] .mgi').allInnerTexts(), ['모든 지식', '사람'], '기초 세우기는 빈 지식의 지식관리자부터')
  await p2.click('[data-t=kdPane] [data-t=knGo]')
  await p2.waitForSelector('[data-t=whoVal]')
  assert.match(await p2.locator('[data-t=whoVal]').innerText(), /나: 읽기/)
  assert.equal(await p2.locator('[data-t=accOpenSide]').count(), 0)
  // 옆 메뉴 자리별(6-4) — 읽기 자리 지식: 지식 메뉴는 문서 · 이력만 · [구조] 없음 / 쓰기 자리 지식(gdi): 생성 · 문서 · 이력 · [구조] 없음
  await p2.waitForSelector('[data-t=tree] [data-t=doc]')
  assert.deepEqual(await p2.locator('[data-t=knMenu] .kmi').evaluateAll((els) => els.map((e) => e.dataset.t)), ['nav-docs', 'nav-history'])
  assert.equal(await p2.locator('[data-t=knMenu]').getAttribute('class'), 'kmn n2')
  assert.equal(await p2.locator('[data-t=treeStruct], [data-t=rl-held], [data-t=rl-import]').count(), 0, '읽기 자리: [구조] · 확인 · 생성 없음')
  await p2.click('[data-t=kpick]')
  await p2.locator('[data-t=kmenuKn]').filter({ hasText: 'GDI 지식' }).click()
  await p2.waitForFunction(() => document.querySelectorAll('[data-t=knMenu] .kmi').length === 3) // 쓰기 자리: 생성 · 문서 · 이력(점검은 지식관리자만 · P11)
  await p2.waitForSelector('[data-t=tree] [data-t=doc]')
  assert.equal(await p2.locator('[data-t=treeStruct]').count(), 0, '쓰기 자리: [구조] 없음')
  await p2.click('[data-t=nav-manage]')
  await p2.waitForSelector('[data-t=klist]')
  await openKn(p2, 'DPMS 지식')
  await p2.waitForSelector('[data-t=whoVal]')
  await p2.click('[data-t=doc][data-name="배포절차"]')
  await p2.waitForSelector('[data-t=editBtn]')
  assert.ok(await p2.locator('[data-t=editBtn]').isDisabled(), '읽기 자리: 고치기 흐림')
  assert.deepEqual(p2._errs, [])
  await p2.close()

  // no — 모두 없음 · 사람 줄 없음 → 목록에 dpms 가 없다
  const p3 = await login(P.no)
  await p3.waitForSelector('[data-t=krow][data-name="GDI 지식"]')
  assert.equal(await card(p3, 'DPMS 지식').count(), 0)
  await p3.close()
})

test('묶음 카드 · 권한 창의 묶음 줄: 더하기 · 넣기 · 빼기 · 지우기(확인 창) · 사람 줄의 「지식 n개에 자리」', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await login(P.boss)
  await page.click('[data-t=nav-manage]')
  await page.click('[data-t=mgNav] [data-t=mgp-people]')
  await page.click('[data-t=pplTab-p]')
  await page.waitForSelector('[data-t=admPerson][data-name=rd]')
  assert.match(await page.locator('[data-t=admPerson][data-name=rd]').innerText(), /지식 \d+개에 자리/)
  await page.click('[data-t=pplTab-g]')
  await page.waitForSelector('[data-t=admGroups] [data-t=grpAddOpen]')
  // 비밀번호 한 번 더(관리자 일)는 창으로 — 묶음 더하기 전에 미리 해 둔다
  await page.click('[data-t=grpAddOpen]')
  await page.fill('#grpName', '개발')
  await page.locator('[data-t=grpAddPeople] input[data-grpadd=rd]').check()
  await page.click('[data-t=grpAddDo]')
  await page.waitForSelector('[data-t=sudoWin]')
  await page.fill('#sudoPw', P.boss.pw)
  await page.click('[data-t=sudoOk]')
  await page.waitForSelector('[data-t=grpRow][data-name="개발"] [data-t=grpMember][data-name=rd]')
  assert.deepEqual(ledger().groups['개발'].members, ['rd'])
  // 넣기 · 빼기
  await page.locator('[data-t=grpRow][data-name="개발"] [data-t=grpPick]').selectOption('no')
  await page.click('[data-t=grpRow][data-name="개발"] [data-t=grpIn]')
  await page.waitForSelector('[data-t=grpRow][data-name="개발"] [data-t=grpMember][data-name=no]')
  await page.click('[data-t=grpRow][data-name="개발"] [data-t=grpMember][data-name=rd] [data-t=grpOut]')
  await page.waitForSelector('[data-t=grpRow][data-name="개발"] [data-t=grpMember][data-name=rd]', { state: 'detached' })
  assert.deepEqual(ledger().groups['개발'].members, ['no'])
  // 권한 창(전역 관리자) — 묶음 더하기 → 쓰기로 저장 → 묶음 카드 「지식 1개에 자리」
  await page.goto(s.url + '/')
  await page.waitForSelector('[data-t=klist]')
  await detail(page, 'DPMS 지식')
  await page.click('[data-t=kdTab-perm]')
  await page.click('[data-t=kdPane] [data-t=accOpen]')
  await page.waitForSelector('[data-t=accWin] [data-t=accAddGPick]')
  await page.locator('[data-t=accAddGPick]').selectOption('개발')
  await page.click('[data-t=accAddG]')
  await page.locator('[data-t=accGroup][data-name="개발"] [data-t=accGroupLv]').selectOption('write')
  await page.click('[data-t=accSave]')
  await page.waitForSelector('[data-t=accWin]', { state: 'detached' })
  assert.deepEqual(ledger().knowledge.dpms.access.groups, { 개발: 'write' })
  await page.waitForFunction(() => /개발/.test(document.querySelector('[data-t=kdPermTable]')?.textContent || ''))
  await page.click('[data-t=nav-manage]')
  await page.click('[data-t=mgNav] [data-t=mgp-people]')
  await page.click('[data-t=pplTab-g]')
  await page.waitForFunction(() => /지식 1개에 자리/.test(document.querySelector('[data-t=grpRow][data-name="개발"] [data-t=grpKns]')?.textContent || ''))
  assert.deepEqual(await bannedIn(page), [])
  await page.locator('[data-t=admGroups]').screenshot({ path: path.join(SHOTS, 'access-groups-1300.png') })
  // 지우기 — 확인 창 · 지식의 묶음 줄도 빠진다
  await page.click('[data-t=grpRow][data-name="개발"] [data-t=grpDel]')
  await page.waitForSelector('[data-t=askWin]')
  assert.match(await page.locator('[data-t=askText]').innerText(), /지식 1개/)
  await page.click('[data-t=askOk]')
  await page.waitForSelector('[data-t=grpRow][data-name="개발"]', { state: 'detached' })
  assert.equal(ledger().groups['개발'], undefined)
  assert.deepEqual(ledger().knowledge.dpms.access.groups, {})
  assert.deepEqual(page._errs, [])
  await page.close()
})

test('설정 메뉴 표 하나: 지식관리자에게 관리가 없다 · 설정 페이지를 옮기면 뒤로 가기로 돌아온다', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  // own — dpms 지식관리자(주인) · 총괄 관리자 아님 → 메뉴에 「관리」 가 없다(서버 /api/admin/* 도 총괄 관리자만)
  const page = await login(P.own)
  await page.click('[data-t=nav-settings-team]')
  await page.waitForSelector('[data-t=mgNav]')
  const items = await page.locator('[data-t=mgNav] .mgi').allInnerTexts()
  assert.deepEqual(items, ['서버 정보', '에이전트 설치', '개인 프로그램 설치'], '지식관리자 메뉴: 팀 일꾼 · 운영은 없다(N6 · 6-4)')
  assert.equal((await page.locator('[data-t=setTitle]').innerText()).trim(), '서버 정보', '첫 화면은 서버 정보')
  assert.equal(await page.locator('[data-t=mgNav] .mgi').first().evaluate((e) => e.tagName), 'BUTTON')
  // 설정 페이지 사이를 옮기면 앱 안 기록에 남는다 — ‹ 로 앞 페이지
  const first = (await page.locator('[data-t=setTitle]').innerText()).trim()
  await page.click('[data-t=mgNav] [data-t=mg-agent]')
  await page.waitForFunction(() => document.querySelector('[data-t=setTitle]')?.textContent.trim() === '에이전트 설치')
  await page.click('[data-t=histBack]')
  await page.waitForFunction((t) => document.querySelector('[data-t=setTitle]')?.textContent.trim() === t, first)
  assert.equal((await page.locator('[data-t=mgNav] .mgi.on').innerText()).trim(), first)
  assert.deepEqual(page._errs, [])
  await page.close()
  // boss — 총괄 관리자에게는 관리가 있고, 관리에는 사람 · 묶음 카드가 다시 나오지 않는다
  const b = await login(P.boss)
  await b.click('[data-t=nav-settings-team]')
  await b.click('[data-t=mgNav] [data-t=mg-check]')
  await b.waitForSelector('[data-t=admList]')
  assert.equal(await b.locator('[data-t=admPeople], [data-t=admGroups]').count(), 0)
  assert.equal(await b.locator('.main .big').count(), 1, '제목은 한 번')
  assert.deepEqual(b._errs, [])
  await b.close()
})

test('지식관리 › 모든 지식 자리별(메뉴 개편 N6 · 6-4): 지식관리자 붙음/없음 · 총괄 관리자 실제 값 · [+ 새 지식] [불러오기] · 저장소 붙이기 · 네 폭', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await login(P.own)
  await page.waitForSelector('[data-t=knTable] [data-t=krow][data-name="DPMS 지식"] [data-t=knRepo]')
  assert.equal(await page.locator('[data-t=krow][data-name="DPMS 지식"] [data-t=knRepo]').innerText(), '없음', '지식관리자: 붙음 · 없음 칩')
  assert.equal(await page.locator('[data-t=krow][data-name="GDI 지식"] [data-t=knRepo]').count(), 0, '쓰기 자리 지식: 저장소 값 없음')
  assert.equal(await page.locator('[data-t=addKn], [data-t=rsOpen], [data-t=knBackup]').count(), 0, '지식관리자: 새 지식 · 불러오기 없음')
  // 정책 탭(저장 승인 P5) — 지식관리자는 「승인 받고 넣기」 까지 · 저장 승인 스위치는 총괄 관리자만
  await detail(page, 'DPMS 지식')
  await page.click('[data-t=kdTab-policy]')
  await page.waitForSelector('[data-t=kdPolicy] [data-t=knReview]')
  assert.equal(await page.locator('[data-t=knSaveMode]').count(), 0, '지식관리자: 저장 승인 스위치 없음')
  assert.deepEqual(page._errs, [])
  await page.close()
  const b = await login(P.boss)
  await b.waitForSelector('[data-t=krow][data-name="GDI 지식"] [data-t=knBackup]')
  assert.equal(await b.locator('[data-t=addKn]').count(), 1)
  await b.click('[data-t=rsOpen]')
  await b.waitForSelector('[data-t=rsWin] [data-t=restoreDo]')
  await b.keyboard.press('Escape')
  assert.deepEqual(await detail(b, 'GDI 지식'), ['정보', '권한', '저장소', '정책', '삭제'])
  await b.click('[data-t=kdTab-policy]')
  await b.waitForSelector('[data-t=kdPolicy]')
  assert.equal(await b.locator('[data-t=knSaveMode]').count(), 0, '저장 승인 스위치는 걷었다(P11)')
  await b.click('[data-t=kdTab-repo]')
  await b.waitForSelector('[data-t=kdBody-repo] #repoUrl')
  assert.equal(await b.locator('[data-t=kdBody-repo] [data-t=repoSave]').innerText(), '붙이기')
  for (const w of [1280, 1024, 600, 375]) {
    await b.setViewportSize({ width: w, height: 820 })
    const sw = await b.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
    assert.ok(sw[0] <= sw[1], `지식 상세 ${w}: 가로 넘침 없음`)
  }
  assert.deepEqual(await bannedIn(b), [])
  assert.deepEqual(b._errs, [])
  await b.close()
})

test('가져올 곳 부탁: 그 지식의 지식관리자가 가져오기 화면에서 본다 · 거절', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  // rd(쓰기 자리)가 dpms 에 가져올 곳을 부탁한다 — own(지식관리자 · 총괄 관리자 아님)이 가져오기 위에서 보고 거절한다
  await s.hub.setAccess(SHELL, 'dpms', { all: 'write' })
  await s.hub.sourceRequest({ user: 'rd' }, 'dpms', { name: '테스트-부탁', at: 'https://git.example/team/test.git', kind: 'git', rules: [] })
  const page = await login(P.own)
  // 부탁 카드는 생성 › 자동수집 머리(메뉴 개편 11절 15) · 고른 지식의 부탁만
  await page.click('[data-t=kpick]')
  await page.locator('[data-t=kmenuKn]').filter({ hasText: 'DPMS 지식' }).click()
  await page.click('[data-t=knMenu] [data-t=nav-import]')
  await page.click('[data-t=genTab-auto]')
  await page.waitForSelector('[data-t=impReqs] [data-t=impReq]')
  assert.equal((await page.locator('[data-t=sfOpen]').innerText()).trim(), '+ 더하기', '지식관리자: [+ 더하기]')
  assert.match(await page.locator('[data-t=impReqs]').innerText(), /테스트-부탁[\s\S]*rd/)
  await page.click('[data-t=impReqs] [data-t=impReqNo]')
  await page.waitForSelector('[data-t=askWin]')
  await page.click('[data-t=askOk]')
  await page.waitForSelector('[data-t=impReqs]', { state: 'detached' })
  assert.equal((await s.hub.requests()).length, 0)
  assert.deepEqual(page._errs, [])
  await page.close()
})

test('지식 메뉴 화면 자리별(메뉴 개편 6-4 · N5): 쓰기는 점검 없음 · 자동수집 [+ 부탁] · 읽기는 확인 · 생성 없음 · 옛 주소는 새 주소로', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  // 쓰기 자리(rd · gdi 쓰기) — 점검 메뉴 없음 · 생성 › 자동수집은 [+ 부탁] · 부탁 카드 · [모두 수집] 없음
  const w = await login(P.rd)
  await w.click('[data-t=kpick]')
  await w.locator('[data-t=kmenuKn]').filter({ hasText: 'GDI 지식' }).click()
  await w.waitForSelector('[data-t=knMenu] [data-t=nav-import]')
  assert.equal(await w.locator('[data-t=knMenu] [data-t=nav-held]').count(), 0, '쓰기: 점검 메뉴 없음(넣지 못함 탭은 P11 에서 걷었다)')
  await w.click('[data-t=knMenu] [data-t=nav-import]')
  await w.click('[data-t=genTab-auto]')
  await w.waitForSelector('[data-t=srcTable]')
  assert.equal((await w.locator('[data-t=sfOpen]').innerText()).trim(), '+ 부탁')
  assert.equal(await w.locator('[data-t=impReqs], [data-t=fetchAll]').count(), 0)
  assert.deepEqual(await bannedIn(w), [])
  assert.deepEqual(w._errs, [])
  await w.close()
  // 읽기 자리 — 옆 메뉴에 점검 · 생성이 없고, 옛 주소 #/held 로 와도 점검을 보이지 않는다 · 주소는 새 꼴로
  await s.hub.setAccess(SHELL, 'dpms', { all: 'read' })
  const r = await login(P.rd)
  await r.click('[data-t=kpick]')
  await r.locator('[data-t=kmenuKn]').filter({ hasText: 'DPMS 지식' }).click()
  await r.waitForFunction(() => document.querySelectorAll('[data-t=knMenu] .kmi').length === 2)
  await r.goto(s.url + '/#/held')
  await r.waitForSelector('[data-t=ckNone]')
  assert.equal(await r.locator('[data-t=ckTabs]').count(), 0)
  await r.waitForFunction(() => /#\/k\/dpms\/check$/.test(location.hash))
  // 옛 주소 #/import → 생성(읽기 자리는 쓰기 자리가 없다는 한 줄)
  await r.goto(s.url + '/#/import')
  await r.waitForSelector('[data-t=impNone]')
  await r.waitForFunction(() => /#\/k\/dpms\/gen$/.test(location.hash))
  assert.deepEqual(r._errs, [])
  await r.close()
  await s.hub.setAccess(SHELL, 'dpms', { all: 'write' })
})

test('점검 자리별(저장 승인 P10 · P-D28): 승인 저장 지식은 지식관리자만 점검 · 지표(배지 없음) · 쓰기 자리는 점검 메뉴가 없고 옛 주소는 빈 상태', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const dir = path.join(path.dirname(data), 'apv10')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), dir)
  fs.rmSync(path.join(dir, 'work'), { recursive: true, force: true })
  fs.writeFileSync(path.join(dir, 'README.md'), '# 테스트 점검 지식\n')
  await s.hub.sync({ user: 'boss', admin: true })
  await s.hub.ensureRecordsDoc('apv10')
  await s.hub.setOwner(SHELL, 'apv10', { owner: 'own' })
  await s.hub.setAccess(SHELL, 'apv10', { all: 'none', users: { rd: 'write' } })
  // 지식관리자(주인) — 점검 · 지표 탭 · 넣지 못함 탭 없음 · 배지 없음
  const a = await login(P.own)
  await openKn(a, '테스트 점검 지식')
  await a.waitForSelector('[data-t=knMenu] [data-t=nav-held]')
  assert.equal(await a.locator('[data-t=knMenu] [data-t=nav-held] span').innerText(), '점검')
  assert.equal(await a.locator('[data-t=knMenu] .bd').count(), 0, '점검 배지 없음')
  await a.click('[data-t=knMenu] [data-t=nav-held]')
  await a.waitForSelector('[data-t=ckTabs]')
  assert.deepEqual((await a.locator('[data-t=ckTabs] > span').allInnerTexts()).map((x) => x.replace(/\s*[\d…].*$/s, '')), ['점검', '지표'])
  await a.click('[data-t=ckTab-metrics]')
  await a.waitForSelector('[data-t=mtEmpty], [data-t=mtCard]')
  assert.match(a.url(), /#\/k\/apv10\/check\/metrics$/)
  assert.deepEqual(await bannedIn(a), [])
  assert.deepEqual(a._errs, [])
  await a.close()
  // 쓰기 자리 — 점검 메뉴 없음 · 옛 주소 #/k/apv10/check 는 빈 상태 · 지표 길은 403
  const w = await login(P.rd)
  await openKn(w, '테스트 점검 지식')
  await w.waitForSelector('[data-t=knMenu] [data-t=nav-import]')
  assert.equal(await w.locator('[data-t=knMenu] [data-t=nav-held]').count(), 0, '쓰기: 점검 메뉴 없음')
  await w.goto(s.url + '/#/k/apv10/check')
  await w.waitForSelector('[data-t=ckNone]')
  assert.equal(await w.locator('[data-t=ckTabs]').count(), 0)
  const st = await w.evaluate(() => fetch('/api/k/apv10/metrics').then((r) => r.status))
  assert.equal(st, 403)
  assert.deepEqual(w._errs, [])
  await w.close()
})
