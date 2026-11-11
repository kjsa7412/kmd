// 지식관리 › 기초 세우기(개인 · TODO 9 · 메뉴개편 8-1 · 목업 S2) — 단계 띠 일곱: 지식(빈 지식만 · 「문서 n」 은 못 고름) → 재료(경로 · 조사) →
//   거르기(비밀 의심 · 옛 판) → 구조안(Claude 안 · 문서 이름 손으로) → 다시 열어 만들던 것 이어 하기 → 짓기(처음 문서 [보기] 창 · 승인) →
//   진단(연습 판) → 넣기(확인 → 다 넣었다) · 네 폭 잘린 요소 0 · 금지어
//
// playwright-core + 이 PC 의 Chrome(없으면 건너뛴다 — KMD_CHROME) · 가짜 claude(test/fixture/fake-claude.mjs)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer } from '../server/http.js'
import { parseDoc } from '../core/sections.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = [process.env.KMD_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p))
const BANNED = ['좌표', '섹션', '원천', '기준선', '큐레이션', '대기열', '판정', '토큰', '커밋', '레포', '미러', '동기화', 'LLM', 'RAG', '노드', '엣지', '백링크', 'coord', 'commit',
  // 걷은 말(컨벤션 9절 용어집) — 항목 장부 · 문서 장부 · 건드린 항목 · 라벨 · 고칠 항목 · 바꿀 곳으로 쓴다
  '이름 장부', '자리 장부', '건드린 이름', '보이는 이름', '항목 조각', '바꿀 조각']
const SRC = {
  '입사 안내.md': '# 입사 안내\n\n## 첫날\n09:00 까지 3층 접수에 온다.\n',
  '장비 지급.md': '# 장비 지급\n\n## 노트북\nThinkPad X1 을 지급한다.\n',
  '반납 절차 v1.md': '# 반납 절차\n\n## 반납\n총무팀에 낸다.\n',
  '반납 절차 v2.md': '# 반납 절차\n\n## 반납\n총무팀 김 대리에게 낸다. 내선 1234.\n',
  '접속정보.md': '# 접속정보\n\n비밀번호: hunter2abc\n',
}
let tmp, pc, browser, src
const ctx = { user: 'kim', pc: true }

before(async () => {
  if (!CHROME) return
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-seed-screen-'))
  const env = { ...process.env }
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  src = path.join(tmp, 'src')
  for (const [rel, text] of Object.entries(SRC)) { fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true }); fs.writeFileSync(path.join(src, rel), text) }
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  delete process.env.FAKE_CLAUDE_MODE
  fs.mkdirSync(path.join(tmp, 'pc'), { recursive: true })
  pc = await startServer({ root: path.join(tmp, 'pc'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  await pc.hub.addKnowledge(ctx, { kind: 'new', name: '온보딩', empty: true, backup: false })
  await pc.hub.addKnowledge(ctx, { kind: 'new', name: '찬 지식', empty: false, backup: false })
  if (!/^[\x20-\x7e]*$/.test(os.tmpdir())) {
    const ascii = path.join(HERE, '..', '.kmd-data', 'tmp')
    fs.mkdirSync(ascii, { recursive: true })
    process.env.TEMP = process.env.TMP = env.TEMP = env.TMP = ascii
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true, env })
})
after(async () => {
  await browser?.close()
  await pc?.close()
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
// 네 폭 — 잘린 요소 0 · 가로 넘침 0 · 금지어 0
async function widths(page, what) {
  for (const w of [1280, 1024, 600, 375]) {
    await page.setViewportSize({ width: w, height: 820 })
    await page.waitForTimeout(260) // 오른쪽 칸 서랍 전환(.2s)이 끝난 뒤에 잰다
    const c = await cutAt(page)
    assert.deepEqual(c.cut, [], `${what} ${w} 잘림`)
    assert.ok(c.sw <= c.w + 1, `${what} ${w} 가로 넘침 ${c.sw}`)
  }
  await page.setViewportSize({ width: 1300, height: 820 })
  const t = await page.locator('[data-t=seedPage]').innerText()
  for (const b of BANNED) assert.ok(!t.includes(b), `${what}: 금지어 「${b}」`)
}
const step = (page, i) => page.waitForSelector(`[data-t=sdBody-${i}]`, { timeout: 60000 })
const go = (page) => page.click('[data-t=sdGo]:not([disabled])', { timeout: 60000 })

test('기초 세우기(개인) — 지식 · 재료 · 거르기 · 구조안 · 이어 하기 · 짓기 · 진단 · 넣기 · 네 폭', { skip: !CHROME && 'Chrome 이 없다', timeout: 300000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 820 } })
  try {
    await page.goto(`${pc.url}/#once=${pc.auth.once(pc.pcUser)}`)
    await page.waitForSelector('#app .side')
    await page.goto(`${pc.url}/#/manage/seed`)
    await page.waitForSelector('[data-t=seedPage]')
    // a 지식 — 빈 지식만 고른다 · 문서가 있으면 「문서 n」 칩 · 못 고름
    await step(page, 0)
    assert.equal(await page.locator('[data-t=sdSteps] .step').count(), 7)
    assert.equal(await page.locator('[data-t=sdStep-0]').getAttribute('aria-current'), 'step')
    const full = page.locator('[data-t=sdKn]', { hasText: '찬 지식' })
    assert.match(await full.innerText(), /문서 1/)
    assert.equal(await full.locator('input').isDisabled(), true)
    assert.equal(await page.locator('[data-t=sdGo]').isDisabled(), true, '고르기 전에는 다음이 꺼진다')
    assert.match(await page.locator('[data-t=sdNeed]').innerText(), /먼저: 빈 지식을 고른다/)
    await widths(page, '지식')
    await page.locator('[data-t=sdKn]', { hasText: '온보딩' }).locator('input').check()
    await go(page)
    // b 재료 — 경로 · 한도 칩 · 조사
    await step(page, 1)
    assert.equal(await page.locator('[data-t=sdLimit]').innerText(), '300 파일 · 200MB')
    await page.fill('#sdPath', src)
    await go(page)
    // c 거르기 — 옛 판 빼기 · 비밀 의심 보류(넣음 고를 수 없음)
    await step(page, 2)
    await page.waitForSelector('[data-t=sdRow]')
    const sec = page.locator('[data-t=sdRow]', { hasText: '접속정보.md' })
    assert.equal(await sec.locator('select').inputValue(), '보류')
    assert.equal(await sec.locator('option', { hasText: '넣음' }).isDisabled(), true)
    assert.equal(await page.locator('[data-t=sdRow]', { hasText: '반납 절차 v1.md' }).locator('select').inputValue(), '빼기')
    assert.ok(!(await page.locator('[data-t=seedPage]').innerText()).includes('hunter2abc'))
    await widths(page, '거르기')
    await go(page)
    // d 구조안 — Claude 안 → 문서 목록 · 걸림 0 · 문서 이름은 손으로
    await step(page, 3)
    await page.click('[data-t=sdModeClaude]')
    await page.waitForSelector('[data-t=sdDocs] [data-t=sdDocName]', { timeout: 60000 })
    assert.equal(await page.locator('[data-t=sdDocName]').first().inputValue(), '업무 안내')
    // 동작 내역(Z9) — 오른쪽 칸 터미널: 세션 시작 · 도구(원본 이름) · 답 · 나무에 놓음 · 끝
    await page.waitForSelector('[data-t=aside] [data-t=sdFeed] [data-k=answer]', { timeout: 60000 })
    const fd = await page.locator('[data-t=sdFeed]').innerText()
    assert.match(fd, /세션 · fake-claude/)
    assert.match(fd, /Grep/)
    assert.match(fd, /나무에 놓았다/)
    assert.equal(await page.locator('[data-t=sdFeed]').getAttribute('role'), 'log')
    assert.match(await page.locator('[data-t=sdFeedH]').innerText(), /동작 내역[\s\S]*끝/)
    await page.fill('[data-t=sdDocName]', '첫 주 안내')
    await page.locator('[data-t=sdDocName]').press('Tab')
    await page.waitForFunction(() => { const i = document.querySelector('[data-t=sdDocName]'); return i && i.value === '첫 주 안내' && !document.querySelector('[data-t=sdGo][disabled]') }, null, { timeout: 60000 })
    await widths(page, '구조안')
    // 만들던 것 이어 하기 — 새로 고쳐도 장부의 단계에서
    await page.reload()
    await page.waitForSelector('[data-t=sdResume]', { timeout: 60000 })
    await page.click('[data-t=sdResume]')
    await step(page, 3)
    assert.equal(await page.locator('[data-t=sdDocName]').first().inputValue(), '첫 주 안내')
    await go(page)
    // e 짓기 — 처음 문서 짓기 → [보기] 창(role=dialog · Esc) → 승인 → 연습 판
    await step(page, 4)
    assert.equal(await page.locator('[data-t=sdWriteAll]').isDisabled(), true, '처음 문서 승인 전')
    await page.click('[data-t=sdWriteOne]')
    await page.waitForSelector('[data-t=sdWRow] :text("지음")', { timeout: 60000 })
    await page.click('[data-t=sdPeek]')
    await page.waitForSelector('[data-t=sdwWin] .sd-tx')
    assert.equal(await page.locator('[data-t=sdwWin]').getAttribute('role'), 'dialog')
    assert.match(await page.locator('[data-t=sdwWin]').innerText(), /09:00/)
    await widths(page, '짓기 창')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-t=sdwWin]', { state: 'detached' })
    await page.click('[data-t=sdApprove]')
    await page.waitForSelector('[data-t=sdApN]:text("승인 1 / 1")', { timeout: 60000 })
    await widths(page, '짓기')
    await go(page)
    // f 진단 — 막는 것 0
    await step(page, 5)
    await page.waitForSelector('[data-t=sdBlockN]', { timeout: 120000 })
    assert.equal(await page.locator('[data-t=sdBlockN] .n').innerText(), '0')
    await widths(page, '진단')
    // g 넣기 — 확인 창 → 다 넣었다 · [지식 열기]
    await go(page)
    await page.waitForSelector('[data-t=askWin]')
    await page.click('[data-t=askOk]')
    await page.waitForSelector('[data-t=sdDone]', { timeout: 180000 })
    await widths(page, '넣기')
    const kd = path.join(tmp, 'pc', '온보딩', 'docs', '첫 주 안내.md')
    assert.ok(fs.existsSync(kd), '지식에 문서가 섰다')
    assert.ok(parseDoc(fs.readFileSync(kd, 'utf8'), '').sections.length >= 3)
    assert.equal(await page.locator('[data-t=sdOpenKn]').count(), 1)
  } finally { await page.close() }
})

// 팀(TODO 10 · 메뉴개편 8-2 · 목업 S10 · S13 · S14) — 올리기(파일 · 폴더 · 끌어다 놓기 · 한도 칩 · 넘으면 나눠 올리기 (!)) · 원본은 팀 서버로 간다 ·
//   구조안의 비용 숫자 · 「팀 일꾼 없음」 · 오늘 한도 0 이면 Claude 안 꺼짐 · 폴더 그대로 → 짓기 → 진단 → 넣기 → 다음 묶음 · 네 폭
test('기초 세우기(팀) — 올리기 · 한도 넘음 · 원본 경고 · 비용 · 팀 일꾼 없음 · 오늘 한도 · 폴더 그대로 → 넣기 · 다음 묶음 · 네 폭', { skip: !CHROME && 'Chrome 이 없다', timeout: 300000 }, async () => {
  const { signIn } = await import('./helpers.mjs')
  const root = path.join(tmp, 'team')
  fs.mkdirSync(path.join(root, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(root, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, sendTickMs: 3600000, jobTickMs: 3600000, queueResumeMs: 3600000, inboxTickMs: 3600000 }))
  const s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  const boss = await signIn(s, { id: 'boss', admin: true })
  const kn = (await s.hub.addKnowledge({ user: 'boss', admin: true }, { kind: 'new', name: '온보딩 테스트', empty: true })).id
  const page = await browser.newPage({ viewport: { width: 1300, height: 820 } })
  try {
    await page.goto(s.url)
    await page.fill('#lgId', 'boss')
    await page.fill('#lgPw', boss.pw)
    await page.click('[data-t=loginBtn]')
    await page.waitForSelector('#app .side')
    await page.goto(`${s.url}/#/manage/seed`)
    await page.waitForSelector('[data-t=seedPage]')
    await step(page, 0)
    await page.locator('[data-t=sdKn]', { hasText: '온보딩 테스트' }).locator('input').check()
    await go(page)
    // b 재료 — 올리기 칸 · 한도 칩(늘) · 원본은 팀 서버로 간다
    await step(page, 1)
    assert.equal(await page.locator('[data-t=sdLimit]').innerText(), '300 파일 · 200MB')
    assert.match(await page.locator('[data-t=sdTeamNote]').innerText(), /원본은 팀 서버로 간다/)
    assert.equal(await page.locator('#sdDirIn').getAttribute('webkitdirectory'), '')
    assert.equal(await page.locator('[data-t=sdGo]').isDisabled(), true, '올리기 전에는 조사가 꺼진다')
    await widths(page, '팀 재료')
    // 한도 넘음(목업 S13) — 보내지 않고 나눠 올리기 · (!)
    await page.setInputFiles('#sdFileIn', Array.from({ length: 301 }, (_, i) => ({ name: `f${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`줄 ${i}`) })))
    await page.waitForSelector('[data-t=sdUpErr]')
    assert.match(await page.locator('[data-t=sdUpErr]').innerText(), /한 묶음 300 파일/)
    assert.equal(await page.locator('[data-t=sdUpErr] .tipb').count(), 1, '나눠 올리기 · kmd-seed (!)')
    await widths(page, '팀 한도 넘음')
    assert.ok(!fs.existsSync(path.join(root, '.kmd', 'shape')), '넘으면 서버에 보내지 않는다')
    // 올리기 → 조사(묶음) → 거르기
    await page.setInputFiles('#sdFileIn', Object.entries(SRC).map(([name, t]) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(t, 'utf8') })))
    await step(page, 2)
    await page.waitForSelector('[data-t=sdRow]')
    assert.equal(await page.locator('[data-t=sdRow]', { hasText: '접속정보.md' }).locator('select').inputValue(), '보류')
    assert.ok(!(await page.locator('[data-t=seedPage]').innerText()).includes('hunter2abc'))
    await go(page)
    // d 구조안 — 비용 숫자 · 팀 일꾼 없음(Claude 안 꺼짐) · 오늘 한도 0(목업 S14)
    await step(page, 3)
    await page.waitForSelector('[data-t=sdCost]')
    assert.match(await page.locator('[data-t=sdCostFiles]').innerText(), /파일 3/)
    assert.match(await page.locator('[data-t=sdCostChars]').innerText(), /글 [\d,]+ 자/)
    assert.match(await page.locator('[data-t=sdCostJobs]').innerText(), /팀 일꾼 일 1 \+ 문서/)
    assert.equal(await page.locator('[data-t=sdNoWorker]').innerText(), '팀 일꾼 없음')
    assert.equal(await page.locator('[data-t=sdModeClaude]').isDisabled(), true)
    await widths(page, '팀 구조안')
    const { KNOWN_TYPES } = await import('../core/worker.js')
    s.hub.workerNext({ worker: { id: 'w-screen' } }, { types: KNOWN_TYPES })
    s.hub.config.intakeDaily = 0
    await page.click('[data-t=sdModeFolder]')
    await page.waitForSelector('[data-t=sdDocs] [data-t=sdDocName]', { timeout: 60000 })
    assert.equal(await page.locator('[data-t=sdNoWorker]').count(), 0, '일꾼이 보이면 칩이 없다')
    assert.match(await page.locator('[data-t=sdDayLeft]').innerText(), /오늘 한도 0 남음/)
    assert.equal(await page.locator('[data-t=sdModeClaude]').isDisabled(), true, '오늘 한도 0 이면 Claude 안이 꺼진다')
    await widths(page, '팀 폴더 그대로')
    await go(page)
    // e 짓기(폴더 그대로는 글이 다 있다) → f 진단 → g 넣기 → 다음 묶음
    await step(page, 4)
    await go(page)
    await step(page, 5)
    await page.waitForSelector('[data-t=sdBlockN]', { timeout: 120000 })
    assert.equal(await page.locator('[data-t=sdBlockN] .n').innerText(), '0')
    await go(page)
    await page.waitForSelector('[data-t=askWin]')
    await page.click('[data-t=askOk]')
    await page.waitForSelector('[data-t=sdDone]', { timeout: 180000 })
    assert.ok(fs.existsSync(path.join(root, kn, 'docs', '입사 안내.md')), '팀 지식에 문서가 섰다')
    assert.equal(await page.locator('[data-t=sdNextGroup]').count(), 1)
    await widths(page, '팀 넣기')
    await page.click('[data-t=sdNextGroup]')
    await step(page, 1)
    await page.waitForSelector('[data-t=sdDrop]')
    await widths(page, '팀 다음 묶음')
  } finally { await page.close(); await s.close() }
})
