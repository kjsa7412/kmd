// 문서 › 구조 화면의 다시 잡기(바탕 세우기 Z5 · 설계 5-2 · 5-4) — 단순 길 [저장] 은 그대로 · 항목 합치기 · 옮기기 → 검사(바뀔 것 · 걸림 0) →
//   연습 판에 해 보기(막는 것 0) → 넣기(확인 → 끝) → 되돌리기 구조안 · 열린 짜임 일 버리기(그만두기) · 개인 탭 구조 · 점검 · 네 폭 잘린 요소 0
//
// playwright-core + 이 PC 의 Chrome(없으면 건너뛴다 — KMD_CHROME).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer } from '../server/http.js'
import { signIn } from './helpers.mjs'
import { workOnce } from '../core/worker.js'
import { SHELL } from '../server/hub.js'
import { parseDoc } from '../core/sections.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = [process.env.KMD_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p))
const BANNED = ['좌표', '섹션', '원천', '기준선', '큐레이션', '대기열', '판정', '토큰', '커밋', '레포', '미러', '동기화', 'LLM', 'RAG', '노드', '엣지', '백링크', 'coord', 'commit',
  // 걷은 말(컨벤션 9절 용어집) — 항목 장부 · 문서 장부 · 건드린 항목 · 라벨 · 고칠 항목 · 바꿀 곳으로 쓴다
  '이름 장부', '자리 장부', '건드린 이름', '보이는 이름', '항목 조각', '바꿀 조각']
const VIEW = { width: 1300, height: 820 }
// 연습 판 · 넣기는 git 을 여러 번 부른다(Windows 에서 느리다)
const LONG = { timeout: 180000 }
const rec = (id, date, touches) => `---\nid: ${id}\ntitle: "${id}"\ndate: ${date}\nauthor: 김\ntouches:\n${touches.map((c) => `  - ${c}`).join('\n')}\n---\n\n# ${id}\n\n## 바뀐 것\n- 값\n`
const FILES = {
  'README.md': '# ops\n',
  'docs/배포 절차.md': '# 배포 절차\n\n## 배포 창\n<!-- applied: 2026-1101-a -->\n화요일 10:00.\n\n## 사전 점검\n디스크 80% 확인.\n\n## 사후 점검\n헬스 체크 3회.\n',
  'docs/장애 대응.md': '# 장애 대응\n\n## 롤백\n이전 판으로 5분 안에.\n\n## 연락\n당번에게.\n',
  'docs/회의 규칙.md': '# 회의 규칙\n\n## 시간\n30분.\n',
  'work/2026-1101-a.md': rec('2026-1101-a', '2026-11-01 09:00', ['proc:배포창']),
  '_managed.md': '| 이름 | 문서 | 항목 |\n|---|---|---|\n| `proc:배포창` | `docs/배포 절차.md` | `## 배포 창` |\n| `check:*` | `docs/배포 절차.md` | `## {값}` |\n',
  '_vocab.md': '# 항목 장부\n\n## proc\n\n- `proc:배포창`: 배포 창\n\n## check\n\n- `check:사전 점검`: 사전 점검\n- `check:사후 점검`: 사후 점검\n',
}
let tmp, s, browser, me, wk
// 팀 일꾼 한 번(가짜 Claude) — 화면이 일감을 세울 때까지 기다렸다가
const work1 = async () => { for (let i = 0; i < 100; i++) { const r = await workOnce({ server: s.url, key: wk }); if (r) return r; await new Promise((ok) => setTimeout(ok, 100)) } throw new Error('일감이 서지 않았다') }
const kdir = () => path.join(tmp, 'kn', 'ops')
const heads = (doc) => parseDoc(fs.readFileSync(path.join(kdir(), 'docs', doc + '.md'), 'utf8'), '').sections.map((x) => x.h)

before(async () => {
  if (!CHROME) return
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-shape-screen-'))
  const env = { ...process.env }
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(kdir(), rel)), { recursive: true })
    fs.writeFileSync(path.join(kdir(), rel), text)
  }
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  me = await signIn(s, { id: 'kim' })
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  delete process.env.FAKE_CLAUDE_MODE
  wk = (await s.auth.workerAdd()).key
  if (!/^[\x20-\x7e]*$/.test(os.tmpdir())) {
    const ascii = path.join(HERE, '..', '.kmd-data', 'tmp')
    fs.mkdirSync(ascii, { recursive: true })
    process.env.TEMP = process.env.TMP = env.TEMP = env.TMP = ascii
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true, env })
})
after(async () => {
  await browser?.close()
  await s?.close()
  try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

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
async function login(page) {
  await page.goto(s.url)
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist]')
}
const go = (page) => page.locator('[data-t=sxBar] [data-t=sxGo]')
const pickItem = (page, h) => page.click(`[data-t=sxItems] [data-t=sxItem][data-h="${h}"] .nm`)

test('구조 다시 잡기: 단순 [저장] 그대로 · 합치기 · 항목 옮기기 → 검사 → 해 보기 → 넣기 → 되돌리기 구조안 · 버리기 · 네 폭', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await login(page)
    await page.goto(s.url + '/#/k/ops/shape')
    await page.waitForSelector('[data-t=sxTree] [data-t=sxDoc][data-d="회의 규칙"]')
    assert.equal(await page.locator('[data-t=sxSteps]').count(), 0, '처음엔 단계 띠가 없다')
    assert.equal(await page.locator('[data-t=sxTabs]').count(), 0, '팀은 탭 없음(점검은 확인 › 점검)')
    assert.equal(await page.locator('[data-t=sxClaude]').isDisabled(), false, 'Claude 단추가 켜졌다(Z6)')
    await page.click('[data-t="tip-sx.claude"]'); assert.match(await page.locator('#tipPop').innerText(), /구조안/); await page.keyboard.press('Escape')

    // 단순 길 — 문서 이름만: 단계 띠 없이 [저장](마른 실행 요약 → 확인 → 한 번) 그대로
    await page.dblclick('#sxTree [data-t=sxDoc][data-d="회의 규칙"] .nm')
    await page.fill('#sxIn', '회의 원칙')
    await page.press('#sxIn', 'Enter')
    assert.equal(await page.locator('[data-t=sxSteps]').count(), 0, '단순 길은 단계 띠 없음')
    await page.click('[data-t=sxSave]')
    await page.waitForSelector('[data-t=askWin]')
    assert.match(await page.locator('[data-t=askWin]').innerText(), /옮김 1/)
    await page.click('[data-t=askWin] .btn.pri')
    await page.waitForSelector('[data-t=sxBar]', { state: 'detached', ...LONG })
    assert.ok(fs.existsSync(path.join(kdir(), 'docs', '회의 원칙.md')), '단순 저장이 들어갔다')

    // 합치기 — 배포 절차 › 사전 점검 + 사후 점검 → 점검 목록(출처 글이 채워진다 · 손으로 고칠 수 있다)
    await page.click('#sxTree [data-t=sxDoc][data-d="배포 절차"]')
    await page.waitForSelector('[data-t=sxCard] [data-t=sxItems]')
    assert.equal(await page.locator('[data-t=sxIMerge]').isDisabled(), true, '둘 미만이면 합치기 꺼짐')
    await page.check('[data-t=sxItem][data-h="사전 점검"] input[type=checkbox]')
    await page.check('[data-t=sxItem][data-h="사후 점검"] input[type=checkbox]')
    await page.click('[data-t=sxIMerge]')
    await page.waitForSelector('[data-t=sxMergeWin] #sxwTx')
    assert.equal(await page.getAttribute('[data-t=sxMergeWin]', 'role'), 'dialog')
    const tx = await page.inputValue('#sxwTx')
    assert.match(tx, /디스크 80% 확인[\s\S]*헬스 체크 3회/, '출처 글이 채워진다')
    assert.equal(await page.locator('[data-t=sxMergeWin] [data-t=sxwClaude]').isDisabled(), false)
    // 머리 겹침 막기 — 같은 문서의 「배포 창」
    await page.fill('#sxwHd', '배포 창')
    await page.click('[data-t=sxwGo]')
    assert.match(await page.locator('[data-t=sxwErr]').innerText(), /같은 머리가 있다/)
    await page.fill('#sxwHd', '점검 목록')
    await page.click('[data-t=sxwGo]')
    await page.waitForSelector('[data-t=sxMergeWin]', { state: 'detached' })
    await page.waitForSelector('[data-t=sxSteps]')
    assert.equal(await page.getAttribute('[data-t=sxStep-1]', 'aria-current'), 'step')
    assert.equal(await go(page).innerText(), '검사')

    // 항목 옮기기 — 장애 대응 › 롤백 → 배포 절차 › 되돌리기(맨 끝)
    await page.click('#sxTree [data-t=sxDoc][data-d="장애 대응"]')
    await pickItem(page, '롤백')
    await page.click('[data-t=sxIMv]')
    await page.waitForSelector('[data-t=sxMoveWin]')
    await page.selectOption('#sxwTo', '배포 절차')
    await page.fill('#sxwHd', '되돌리기')
    await page.click('[data-t=sxwGo]')
    await page.waitForSelector('[data-t=sxMoveWin]', { state: 'detached' })
    assert.equal(await page.locator('[data-t=sxItem][data-h="롤백"]').count(), 0)

    // 1 구조안 — 검사: 바뀔 것 · 걸림 0(닿던 장부 항목은 합친 항목에 저절로 놓는다)
    await go(page).click()
    await page.waitForSelector('[data-t=sxCheck]')
    const ck = await page.locator('[data-t=sxCheck]').innerText()
    assert.match(ck, /합치기/)
    assert.match(ck, /항목 옮김: 장애 대응 › 롤백 → 배포 절차 › 되돌리기/)
    assert.match(ck, /걸림 0/, ck)
    assert.equal(await go(page).innerText(), '정하고 다음: 해 보기')
    // 네 폭 — 단계 띠 · 검사 카드 · 고른 것 카드
    await page.click('#sxTree [data-t=sxDoc][data-d="배포 절차"]')
    for (const w of [1280, 1024, 600, 375]) {
      await page.setViewportSize({ width: w, height: 820 })
      const c = await cutAt(page)
      assert.deepEqual(c.cut, [], `다시 잡기 ${w}: 잘린 요소`)
      assert.ok(c.sw <= w, `다시 잡기 ${w}: 가로 넘침 ${c.sw}`)
    }
    await page.setViewportSize(VIEW)
    const text = await page.evaluate(() => document.body.innerText)
    assert.deepEqual(BANNED.filter((x) => text.includes(x)), [])

    // 2 해 보기 — 연습 판(진짜는 그대로) · 막는 것 0
    await go(page).click()
    assert.equal(await page.getAttribute('[data-t=sxStep-2]', 'aria-current'), 'step')
    assert.equal(await go(page).innerText(), '연습 판에 해 보기')
    await go(page).click()
    await page.waitForSelector('[data-t=sxDiag]', LONG)
    assert.match(await page.locator('[data-t=sxDiag]').innerText(), /막는 것 0/)
    assert.deepEqual(heads('배포 절차'), ['배포 창', '사전 점검', '사후 점검'], '해 보기는 진짜를 건드리지 않는다')
    // 3 넣기 — 확인 창 → 끝
    await page.waitForFunction(() => document.querySelector('[data-t=sxBar] [data-t=sxGo]')?.innerText === '정하고 다음: 넣기', null, LONG)
    await go(page).click()
    assert.equal(await go(page).innerText(), '넣기')
    await go(page).click()
    await page.waitForSelector('[data-t=askWin]')
    await page.click('[data-t=askWin] .btn.pri')
    await page.waitForSelector('[data-t=sxDone]', LONG)
    assert.equal(await page.getAttribute('[data-t=sxStep-4]', 'aria-current'), 'step')
    assert.deepEqual(heads('배포 절차'), ['배포 창', '점검 목록', '되돌리기'])
    assert.deepEqual(heads('장애 대응'), ['연락'])
    assert.match(fs.readFileSync(path.join(kdir(), 'docs', '배포 절차.md'), 'utf8'), /디스크 80% 확인[\s\S]*헬스 체크 3회/)

    // 4 끝 — 되돌리기 구조안: 2 해 보기로 열린다 · 해 보기 · 넣기로 앞 짜임
    await page.click('[data-t=sxUndoPlan]')
    await page.waitForSelector('[data-t=sxUndoNote]')
    assert.equal(await page.getAttribute('[data-t=sxStep-2]', 'aria-current'), 'step')
    assert.match(await page.locator('[data-t=sxCheck]').innerText(), /걸림 0/)
    await go(page).click()
    await page.waitForSelector('[data-t=sxDiag]', LONG)
    await page.waitForFunction(() => document.querySelector('[data-t=sxBar] [data-t=sxGo]')?.innerText === '정하고 다음: 넣기', null, LONG)
    await go(page).click()
    await go(page).click()
    await page.click('[data-t=askWin] .btn.pri')
    await page.waitForSelector('[data-t=sxDone]', LONG)
    assert.deepEqual(heads('장애 대응').sort(), ['롤백', '연락'].sort(), '되돌렸다')
    assert.ok(heads('배포 절차').includes('사전 점검') && heads('배포 절차').includes('사후 점검'))
    await go(page).click() // 마치기
    await page.waitForSelector('[data-t=sxSteps]', { state: 'detached' })

    // 그만두기 — 검사로 연 짜임 일을 다시 열면 「열린 짜임 일」 · [버리기] 로 끝낸다
    await page.click('#sxTree [data-t=sxDoc][data-d="장애 대응"]')
    await pickItem(page, '연락')
    await page.click('[data-t=sxIRen]')
    await page.fill('#askIn', '당번 연락')
    await page.click('[data-t=askWin] .btn.pri')
    await go(page).click()
    await page.waitForSelector('[data-t=sxCheck]')
    await page.reload()
    await page.waitForSelector('[data-t=sxWork]')
    assert.match(await page.locator('[data-t=sxWork]').innerText(), /열린 짜임 일/)
    await page.click('[data-t=sxWorkStop]')
    await page.waitForSelector('[data-t=askWin]')
    await page.click('[data-t=askWin] .btn.danger')
    await page.waitForSelector('[data-t=sxWork]', { state: 'detached' })
    const sh = await page.evaluate(() => fetch('/api/k/ops/shape').then((r) => r.json()))
    assert.equal(sh.work, null, '장부가 지워졌다')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// 저장 승인 P7(P-D24) — 걸음 실패로 선 짜임 일: 열린 일 줄 「걸음 실패」 → [이어 하기] → 3 넣기의 「걸음 실패: 까닭」 + [구조안 고치기] → 1 구조안 · 네 폭
test('구조 다시 잡기: 걸음 실패 — 까닭 · [구조안 고치기] · 네 폭', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const now = new Date().toISOString()
  const fail = [{ doc: 'docs/배포 절차.md', heading: '점검 목록', code: 'format', why: '「점검 목록」 글에 머리 · 표지가 들었다: 머리 줄' }]
  fs.mkdirSync(path.dirname(s.hub.shapeFile('ops')), { recursive: true })
  fs.writeFileSync(s.hub.shapeFile('ops'), JSON.stringify({ v: 1, kn: 'ops', work: 'abcdefabcdef', kind: 'reshape', by: 'kim', opened: now, at: now, stage: 'stopped', plan: { v: 1, kind: 'reshape', docs: [], names: [] }, done: [2], tried: { steps: [{ n: 2, kind: 'frame' }, { n: 11, kind: 'write', unit: 1 }], diag: { blockers: [], warnings: [] } }, last: { n: 11, fail } }))
  try {
    await login(page)
    await page.goto(s.url + '/#/k/ops/shape')
    await page.waitForSelector('[data-t=sxWork]')
    assert.match(await page.locator('[data-t=sxWork]').innerText(), /걸음 실패/)
    await page.click('[data-t=sxResume]')
    await page.waitForSelector('[data-t=sxStepFail]')
    assert.match(await page.locator('[data-t=sxStepFail]').innerText(), /걸음 실패[\s\S]*점검 목록[\s\S]*머리 줄/)
    assert.equal(await go(page).innerText(), '구조안 고치기')
    for (const w of [1280, 1024, 600, 375]) {
      await page.setViewportSize({ width: w, height: 820 })
      const c = await cutAt(page)
      assert.deepEqual(c.cut, [], `걸음 실패 ${w}: 잘린 요소`)
      assert.ok(c.sw <= w, `걸음 실패 ${w}: 가로 넘침 ${c.sw}`)
    }
    await page.setViewportSize(VIEW)
    const text = await page.evaluate(() => document.body.innerText)
    assert.deepEqual(BANNED.filter((x) => text.includes(x)), [])
    await page.click('[data-t=sxStepFail] [data-t=sxFixPlan]')
    await page.waitForSelector('[data-t=sxStepFail]', { state: 'detached' })
    await page.waitForSelector('[data-t=sxTree] [data-t=sxDoc]')
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
    fs.rmSync(s.hub.shapeFile('ops'), { force: true })
  }
})

// 바탕 세우기 Z6 — [Claude 구조안](팀 일꾼 · 가짜 Claude) → 나무에 놓음 · 글 필요 → [Claude 짓기] → 글 · 검사 걸림 0 · 창 [Claude 짓기] · Claude 에 보내지 않는 지식은 꺼짐 · 네 폭
test('구조 다시 잡기: Claude 구조안 · Claude 짓기(팀 일꾼) · 꺼짐 까닭 · 네 폭', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await login(page)
    // Claude 에 보내지 않는 지식 — 단추가 꺼지고 까닭(title)
    await s.hub.setOwner(SHELL, 'ops', { noClaude: true })
    try {
      await page.goto(s.url + '/#/k/ops/shape')
      await page.waitForSelector('[data-t=sxTree] [data-t=sxDoc][data-d="장애 대응"]')
      await page.waitForFunction(() => /Claude 에 보내지 않는/.test(document.querySelector('[data-t=sxClaude]')?.title || ''))
      assert.equal(await page.locator('[data-t=sxClaude]').isDisabled(), true)
      assert.match(await page.getAttribute('[data-t=sxClaude]', 'title'), /Claude 에 보내지 않는 지식/)
    } finally { await s.hub.setOwner(SHELL, 'ops', { noClaude: false }) }
    await page.reload()
    await page.waitForSelector('[data-t=sxTree] [data-t=sxDoc][data-d="장애 대응"]')
    await page.waitForFunction(() => document.querySelector('[data-t=sxClaude]')?.disabled === false)

    // [Claude 구조안] — 도는 줄 · 그만두기 → 일꾼이 지으면 나무에 놓는다(끝 낱말이 같은 「사전 점검」 · 「사후 점검」 → 「점검 목록」)
    await page.click('[data-t=sxClaude]')
    await page.waitForSelector('[data-t=sxCj] [data-t=sxCjStop]')
    assert.match(await page.locator('[data-t=sxCj]').innerText(), /구조안을 짓는 중/)
    assert.equal((await work1()).job.type, 'shape-plan')
    await page.waitForSelector('[data-t=sxCj] [data-t=sxCjWrite]', LONG)
    assert.match(await page.locator('[data-t=sxCj]').innerText(), /나무에 놓았다[\s\S]*글 필요 1/)
    assert.deepEqual(heads('배포 절차'), ['배포 창', '사전 점검', '사후 점검'], '지식은 그대로')
    await page.click('#sxTree [data-t=sxDoc][data-d="배포 절차"]')
    await page.waitForSelector('[data-t=sxItem][data-h="점검 목록"]')
    // 네 폭 — Claude 줄 · 단계 띠
    for (const w of [1280, 1024, 600, 375]) {
      await page.setViewportSize({ width: w, height: 820 })
      const c = await cutAt(page)
      assert.deepEqual(c.cut, [], `Claude 줄 ${w}: 잘린 요소`)
      assert.ok(c.sw <= w, `Claude 줄 ${w}: 가로 넘침 ${c.sw}`)
    }
    await page.setViewportSize(VIEW)
    // [Claude 짓기 1] — 합칠 글을 지어 항목에 놓는다 → 검사 걸림 0
    await page.click('[data-t=sxCjWrite]')
    await page.waitForSelector('[data-t=sxCj] [data-t=sxCjStop]')
    assert.equal((await work1()).job.type, 'shape-write')
    await page.waitForFunction(() => /글 지음 1/.test(document.querySelector('[data-t=sxCj]')?.innerText || ''), null, LONG)
    await go(page).click()
    await page.waitForSelector('[data-t=sxCheck]', LONG)
    const ck = await page.locator('[data-t=sxCheck]').innerText()
    assert.match(ck, /합치기/)
    assert.match(ck, /걸림 0/, ck)

    // 창 [Claude 짓기] — 나누기 창의 목표 줄 글을 짓는다(도는 동안 글 칸은 읽는 중 · 끝나면 채움)
    await page.click('#sxTree [data-t=sxDoc][data-d="장애 대응"]')
    await pickItem(page, '롤백')
    await page.click('[data-t=sxISplit]')
    await page.waitForSelector('[data-t=sxSplitWin] #sxwTx0')
    await page.fill('#sxwHd1', '되돌리는 때')
    await page.click('[data-t=sxSplitWin] [data-t=sxwClaude]')
    await page.waitForSelector('[data-t=sxwCj] [data-t=sxwCjStop]')
    assert.equal(await page.locator('[data-t=sxwGo]').isDisabled(), true, '짓는 동안 [나누기] 꺼짐')
    assert.equal((await work1()).job.type, 'shape-write')
    await page.waitForSelector('#sxwTx1', LONG)
    assert.equal(await page.locator('[data-t=sxwCj]').count(), 0)
    assert.match((await page.inputValue('#sxwTx0')) + (await page.inputValue('#sxwTx1')), /5분 안에/)
    for (const w of [1280, 375]) {
      await page.setViewportSize({ width: w, height: 820 })
      const c = await cutAt(page)
      assert.deepEqual(c.cut, [], `나누기 창 ${w}: 잘린 요소`)
    }
    await page.setViewportSize(VIEW)
    await page.click('[data-t=sxSplitWin] .btn.ghost[data-a=sxwClose]')
    const text = await page.evaluate(() => document.body.innerText)
    assert.deepEqual(BANNED.filter((x) => text.includes(x)), [])
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
    await s.hub.shapeStop({ user: 'kim', admin: true }, 'ops').catch((e) => e) // 검사로 연 짜임 일 걷기
  }
})

test('개인 문서 › 구조: 탭 구조 · 점검(점검 줄) · 주소 끝 /check', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const root = path.join(tmp, 'pc-shape')
  fs.mkdirSync(path.join(root, '메모', 'docs'), { recursive: true })
  fs.writeFileSync(path.join(root, '메모', 'README.md'), '# 메모\n')
  fs.writeFileSync(path.join(root, '메모', 'docs', '카나리.md'), '# 카나리\n\n## 비율\n10%.\n')
  const pc = await startServer({ root, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  const page = await browser.newPage({ viewport: VIEW })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(`${pc.url}/#once=${pc.auth.once(pc.pcUser)}`)
    await page.waitForSelector('[data-t=klist]')
    await page.goto(`${pc.url}/#/k/${encodeURIComponent('메모')}/shape`)
    await page.waitForSelector('[data-t=sxTabs]')
    assert.equal(await page.getAttribute('[data-t=sxTab-shape]', 'aria-selected'), 'true')
    await page.click('[data-t=sxTab-check]')
    await page.waitForSelector('[data-t=guardCard]')
    await page.waitForFunction(() => /\/shape\/check$/.test(location.hash))
    await page.click('[data-t=sxTab-shape]')
    await page.waitForSelector('[data-t=sxTree]')
    assert.deepEqual(errors, [])
  } finally { await page.close(); await pc.close() }
})
