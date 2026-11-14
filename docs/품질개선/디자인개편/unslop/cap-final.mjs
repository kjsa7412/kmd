// 개편 안 캡처: node cap.mjs <안 폴더(절대)> <자리 이름(영문 소문자)> [폭들 1280,1024,375]
// 안 폴더의 concept.css(덧입힐 CSS) · concept.js(화면이 그려질 때마다 도는 DOM 손질 · 선택)를 실제 화면에 입혀 <안 폴더>/shots/<화면>-<폭>.png 로 찍는다.
// 글꼴: CSS 에서 url(/__mock/pv.woff2) 로 Pretendard Variable 을 쓸 수 있다.
import fs from 'node:fs'
import path from 'node:path'
import { open, teamPage, overflow, done } from 'file:///C:/project/kmd/.kmd-data/ux-review/uxlib.mjs'
const [DIR, ENV = 'cap', WS = '1280,1024,375'] = process.argv.slice(2)
if (!DIR || !/^[a-z0-9-]+$/.test(ENV)) { console.error('쓰는 법: node cap.mjs <안 폴더> <자리 이름> [폭들]'); process.exit(2) }
const css = fs.existsSync(path.join(DIR, 'concept.css')) ? fs.readFileSync(path.join(DIR, 'concept.css'), 'utf8') : ''
const js = fs.existsSync(path.join(DIR, 'concept.js')) ? fs.readFileSync(path.join(DIR, 'concept.js'), 'utf8') : ''
const OUT = path.join(DIR, 'shots'); fs.mkdirSync(OUT, { recursive: true })
const env = await open(ENV)
const report = []
const PROBE = process.env.PROBE ? fs.readFileSync(process.env.PROBE, 'utf8') : null
const DARK = !!process.env.DARK, ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null, SUF = (DARK ? '-dark' : '') + (process.env.STOPS === '1' ? '-stops' : '')
const dress = async (p) => {
  await p.route('**/__mock/pv.woff2', (r) => r.fulfill({ path: 'C:/project/kmd/.kmd-data/tmp/font/PretendardVariable.woff2', contentType: 'font/woff2' }))
  await p.addInitScript(([c, j]) => {
    const put = () => {
      if (!document.head || !document.body) return setTimeout(put, 5)
      if (c) { const s = document.createElement('style'); s.id = 'concept'; s.textContent = c; document.head.appendChild(s) }

    }
    put()
  }, [css, js])
  // 이력 화면 시험 데이터(찍기 전용 · 지식에 쓰지 않는다): 시험 환경의 이력이 비어 있어 줄 짜임을 볼 수 없다
  if (process.env.HIST !== '0') await p.route('**/api/history', (r) => {
    const t = Date.now(), at = (h) => new Date(t - h * 3600e3).toISOString()
    const k = { kn: 'dpms', knName: 'DPMS 지식' }
    r.fulfill({ json: [
      { id: 'test-h1', at: at(0.4), kind: '저장', title: '배포 체크리스트 · 개요', sub: '배포 전 확인을 한 줄 더했다', who: 'park', ...k },
      { id: 'test-h2', at: at(1.2), kind: '고침', title: '롤백 순서', sub: '앱 먼저 · DB 나중으로 고쳤다', who: 'lee', ...k },
      { id: 'test-h3', at: at(2.5), kind: '들이기', title: '헬스 체크 주소', sub: '회의록에서 들였다', who: 'kmd', ...k },
      { id: 'test-h4', at: at(3.1), kind: '저장', title: '테스트 값 바뀜 · 서버 상태', sub: '점검 주기 5분 → 3분', who: 'lee', yl: true, ...k },
      { id: 'test-h5', at: at(26), kind: '다듬기', title: '용어 모음', sub: '서식에 맞췄다', who: 'kmd', ...k },
      { id: 'test-h6', at: at(27.5), kind: '저장', title: '인증서 갱신', sub: '갱신 날짜를 적었다', who: 'park', ...k },
      { id: 'test-h7', at: at(29), kind: '되돌림', title: '캐시 정책', sub: '5분으로 되돌렸다', who: 'park', ...k }
    ] })
  })
  // 멈춤 줄 시험 데이터(STOPS=1 · 찍기 전용): 띠에서 옮긴 「경고 n」 자리를 보려고
  if (process.env.STOPS === '1') await p.route('**/api/stops', (r) => r.fulfill({ json: [
    { kind: 'backup', level: 'warn', kn: 'dpms', b: '테스트 백업이 멈췄다', t: '어제 03:00 부터', key: 'test-stop-1' },
    { kind: 'source', level: 'warn', kn: 'dpms', b: '테스트 자동수집 늦음', t: '6시간', key: 'test-stop-2' }
  ] }))
  if (js) await p.addInitScript({ content: js })
  if (DARK) await p.emulateMedia({ colorScheme: 'dark' })
  p.on('pageerror', (e) => report.push('pageerror ' + String(e).slice(0, 160)))
}
for (const W of WS.split(',').map(Number)) {
  const H = W > 600 ? 820 : 812
  const snapNoMove = async (p, name) => {
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600)
    await p.screenshot({ path: path.join(OUT, `${name}-${W}${SUF}.png`) })
  }
  const snap = async (p, name) => {
    if (ONLY && !ONLY.includes(name)) return
    await p.mouse.move(W - 4, H - 4); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1100)
    const o = await overflow(p); if (o.pageScrolls || o.outside.length) report.push(`${name}-${W} 넘침 ${o.outside.slice(0, 3).join(' ')}`)
    if (PROBE) { try { report.push(`${name}-${W} probe ${JSON.stringify(await p.evaluate(PROBE))}`) } catch (e) { report.push(`${name}-${W} probe 실패 ${e.message.split(String.fromCharCode(10))[0]}`) } }
    await p.screenshot({ path: path.join(OUT, `${name}-${W}${SUF}.png`) })
  }
  { const p = await teamPage(env, null, { width: W, height: H }); await dress(p); await p.reload(); await snap(p, '1login'); await p.context().close() }
  const doc = '#/k/dpms/d/' + encodeURIComponent('배포 체크리스트')
  for (const [user, list] of [['park', [['2list', null], ['3home', 'home'], ['14drawer', 'drawer'], ['4doc', doc], ['16rail', 'rail'], ['5rec', '#/k/dpms/r/' + encodeURIComponent('2026-1023-롤백-순서')], ['6hist', '#/k/dpms/history'], ['7check', '#/k/dpms/check'], ['10graph', '#/k/dpms/graph'], ['10graph-sel', 'gsel'], ['17font', 'font'], ['11qo', 'key:Control+o'], ['12search', 'key:Control+k'], ['13edit', 'edit'], ['15focus-nav', 'focus:.app .side .kmi'], ['15focus-btn', 'focus:.app [data-t=editBtn]'], ['15focus-inp', 'focus:.app .cx-list [data-t=treeQ]']]], ['kim', [['8set', '#/settings'], ['9people', '#/manage/people']]]]) {
    const p = await teamPage(env, user, { width: W, height: H }); await dress(p); await p.reload(); await p.waitForTimeout(1200)
    for (const [name, go] of list) {
      try {
        if (go === 'rail') { if (W <= 1024 || (ONLY && !ONLY.includes(name))) continue; await p.click('.sb-top [data-t=sideFold]', { timeout: 5000 }); await p.waitForTimeout(800); await snap(p, name); await p.click('.srail [data-t=sideFold]', { timeout: 5000 }); await p.waitForTimeout(600); continue }
        if (go === 'drawer') { if (W > 600 || (ONLY && !ONLY.includes(name))) continue; await p.click('[data-t=menuBtn]', { timeout: 5000 }); await p.waitForTimeout(700); await snap(p, name); await p.evaluate(() => document.querySelector('[data-t=menuBtn]').click()); await p.waitForTimeout(500); continue }
        if (go && go.startsWith('focus:')) { if (W <= 600 || (ONLY && !ONLY.includes(name))) continue; await p.keyboard.press('Escape'); await p.evaluate((h) => { location.hash = h }, doc); await p.waitForTimeout(1200); await p.keyboard.press('Shift'); await p.focus(go.slice(6), { timeout: 5000 }); await p.waitForTimeout(300); await snapNoMove(p, name); continue }
        if (go === 'gsel') {
          if (ONLY && !ONLY.includes(name)) continue
          await p.keyboard.press('Escape'); await p.evaluate(() => { location.hash = '#/k/dpms/graph' }); await p.waitForTimeout(1500)
          const pt = await p.evaluate(() => { const ids = window.kmdGraphIds(); const id = ids.find((x) => /배포 체크리스트/.test(x)) || ids.find((x) => !/^b:/.test(x)); return window.kmdGraphPt(id) })
          if (!pt) throw new Error('그래프 점 없음')
          await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(1500)
        } else if (go === 'font') {
          if (ONLY && !ONLY.includes(name)) continue
          await p.keyboard.press('Escape'); await p.evaluate(() => { location.hash = '#/k/dpms/r/' + encodeURIComponent('2026-1114-테스트-글꼴-똠-펲') }); await p.waitForTimeout(1500)
          await p.evaluate(() => document.fonts.ready)
          console.error(name + '-' + W + ' 글꼴 ' + (await p.evaluate(() => [...document.fonts].filter((x) => x.family.includes('KMD')).map((x) => (x.unicodeRange.includes('U+100-') ? 'rest' : 'core') + ':' + x.status).join(' '))))
        } else if (go === 'home') { await p.click('[data-t=knOpen][data-k=dpms]', { timeout: 5000 }); await p.waitForTimeout(700); await p.click('[data-t=knGo]', { timeout: 5000 }) }
        else if (go && go.startsWith('key:')) { await p.keyboard.press('Escape'); await p.evaluate(() => { location.hash = '#/k/dpms/docs' }); await p.waitForTimeout(800); await p.keyboard.press(go.slice(4)); await p.waitForTimeout(700) }
        else if (go === 'edit') { await p.keyboard.press('Escape'); await p.evaluate((h) => { location.hash = h }, doc); await p.waitForTimeout(1200); await p.getByRole('button', { name: '고치기', exact: true }).first().click({ timeout: 5000 }); await p.waitForTimeout(900) }
        else if (go) { await p.evaluate((h) => { location.hash = h }, go); await p.waitForTimeout(1200) }
        await snap(p, name)
      } catch (e) { report.push(`${name}-${W} 실패 ${String(e.message).split('\n')[0]}`) }
    }
    await p.context().close()
  }
}
await done()
console.log(JSON.stringify({ out: OUT, problems: report }, null, 1))
