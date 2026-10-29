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
  // ⋯ › 권한 — 관리 자리에게만(gdi 는 own 이 쓰기 자리라 없다)
  await card(page, 'GDI 지식').locator('[data-t=knKebab]').click()
  assert.equal(await page.locator('.pop [data-t=accOpen]').count(), 0, '쓰기 자리에는 권한 메뉴가 없다')
  await page.keyboard.press('Escape')
  await card(page, 'DPMS 지식').locator('[data-t=knKebab]').click()
  await page.click('.pop [data-t=accOpen]')
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
  await card(page, 'DPMS 지식').click()
  await page.waitForFunction(() => /모두 없음 · 사람 1/.test(document.querySelector('[data-t=whoVal]')?.textContent || ''))
  assert.equal(await page.locator('[data-t=whoVal] [data-t=accOpenSide]').count(), 1)
  assert.deepEqual(page._errs, [])
  await page.close()

  // rd — 읽기 칩 · 고치기는 흐리게(감추지 않는다)
  const p2 = await login(P.rd)
  await p2.waitForSelector('[data-t=krow][data-name="DPMS 지식"] [data-t=lvChip]')
  assert.equal(await card(p2, 'DPMS 지식').locator('[data-t=lvChip]').innerText(), '읽기')
  await card(p2, 'DPMS 지식').locator('[data-t=knKebab]').click()
  assert.equal(await p2.locator('.pop [data-t=accOpen]').count(), 0, '읽기 자리에는 권한 메뉴가 없다')
  await p2.keyboard.press('Escape')
  await card(p2, 'DPMS 지식').click()
  await p2.waitForSelector('[data-t=whoVal]')
  assert.match(await p2.locator('[data-t=whoVal]').innerText(), /나: 읽기/)
  assert.equal(await p2.locator('[data-t=accOpenSide]').count(), 0)
  if (await p2.locator('[data-t=moreDocs]').count()) await p2.click('[data-t=moreDocs]')
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
  await page.click('[data-t=nav-settings-team]')
  await page.click('[data-t=mgNav] [data-t=mg-people]')
  await page.waitForSelector('[data-t=admGroups] [data-t=grpAddOpen]')
  assert.match(await page.locator('[data-t=admPerson][data-name=rd]').innerText(), /지식 \d+개에 자리/)
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
  await card(page, 'DPMS 지식').locator('[data-t=knKebab]').click()
  await page.click('.pop [data-t=accOpen]')
  await page.waitForSelector('[data-t=accWin] [data-t=accAddGPick]')
  await page.locator('[data-t=accAddGPick]').selectOption('개발')
  await page.click('[data-t=accAddG]')
  await page.locator('[data-t=accGroup][data-name="개발"] [data-t=accGroupLv]').selectOption('write')
  await page.click('[data-t=accSave]')
  await page.waitForSelector('[data-t=accWin]', { state: 'detached' })
  assert.deepEqual(ledger().knowledge.dpms.access.groups, { 개발: 'write' })
  await page.click('[data-t=nav-settings-team]')
  await page.click('[data-t=mgNav] [data-t=mg-people]')
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
