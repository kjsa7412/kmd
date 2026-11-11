// kmd 화면 — 목업(kmd_목업_인터랙션.html)의 그리기 · 이벤트를 그대로 옮기고 자료만 서버에서 받는다.
//
// 그리기는 목업처럼 글 틀(문자열)로 한 번에 다시 그린다. 자료는 화면이 처음 필요할 때 받아
// 두고(S.cache), 받는 동안은 빈 자리로 그렸다가 받으면 다시 그린다.
//
// K0 에 있는 것: 셸(리본 · 옆 메뉴 · 머리 · 띠 · 아래 줄) · 지식 목록 · 문서로 보기(나무 · 탭 · 나누기 ·
// 문서 · 기록 · 첨부 · 옆 칸) · 빨리 열기 · 찾기 · 명령 창. 항목 · 그래프 · 일 화면은 뒤 판이 채운다.

import { $, esc, norm, uid, svg, whenTxt, isToday, hhmm, clock, stampDate } from './ui.js'
import { prehash } from './prehash.js'

const S = {
  me: null,
  kns: [],
  route: { scr: 'home', kn: '*' },
  lastKn: null,
  tabs: [], active: null, split: null, hist: [], hpos: -1,
  fold: {},
  menu: null, pal: null, qo: null, cmd: null,
  cache: {}, wait: {}, err: null,
  stops: [],
  srcRun: {}, sf: null, sfMsg: null, imports: [], addDraft: '', addMsg: null, sending: false,
  openToday: null, picker: false,
  iq: '', ifilt: { recent: false, mine: false }, kfold: {}, tq: '', tfilt: { mine: false }, tablesAll: false, gPop: false, curSec: null,
  g: { kn: null, pos: {}, cam: { rx: -0.35, ry: 0.6, zoom: 1, base: 1, px: 0, py: 0, needFit: true }, sel: null, open: [], cur: null, visKey: '', mode: '3d', bundle: false, layoutKey: '', f: { q: '', item: true, doc: true, rec: true, recent: false, orph: false, label: false, line: false, spin: true } },
}
// 고른 지식을 따르는 화면 — 지식 관리(이력 · 설정 · 점검 · 가져오기 · 보내기)는 고른 지식과 따로다
const KNSCR = ['docs', 'items', 'graph']
const KN = (k) => S.kns.find((x) => x.id === k) || null
// 팀 지식 가운데 관리 자리가 하나라도 있나(지식 관리자에게 가져오기 메뉴)
const anyAdm = () => (S.kns || []).some((x) => !isPersonal(x) && x.level === 'admin')
const isTeam = () => S.me && S.me.mode === 'team'
// 들어오기 전 — 아직 들어오지 않았다(머리 · 옆 메뉴 · 아래 줄은 이것을 본다)
const anon = () => !!S.me && !!S.me.anon
// 들어가기 화면 — 들어오지 않았거나 · 처음 들어오기 링크 · 첫 설정을 보는 중(들어온 채 링크를 열어도 이 화면)
const gated = () => !!S.me && (!!S.me.anon || !!S.gate)
const knType = () => (isTeam() ? 'team' : 'pc')
// 지식 하나의 갈래 — 팀 화면은 팀 지식만 · 개인 화면은 개인 지식만(팀 화면은 개인 프로그램을 부르지 않는다)
const isPersonal = () => !isTeam()
const knWhere = (n) => (!n ? '' : !isTeam() ? n.dir || '' : '팀')
const LV_T = { read: '읽기', write: '쓰기', admin: '지식관리자' }
const lvOf = (n) => (!n ? null : n.level && LV_T[n.level] ? n.level : n.role === '정리' || n.role === '주인' || !isTeam() ? 'admin' : 'write')
const lvChip = (n) => { const l = lvOf(n); return l ? `<span class="kt lv-${l}" data-t="lvChip" title="이 지식에서 나의 자리: ${LV_T[l]}">${LV_T[l]}</span>` : '' }
// 쓰기 단추 — 읽기 자리면 막는다(서버도 막는다 · 화면은 미리 알린다)
const canWrite = (k) => lvOf(KN(k)) !== 'read'
// 자리 이름 넷(없음까지) — 권한 창 · 자리 표 요약
const LV_N = { none: '없음', ...LV_T }
const LVS = ['none', 'read', 'write', 'admin']
// 이 지식의 권한을 다루나 — 팀 지식 · 관리 자리(주인 · 관리 자리 · 총괄 관리자)
const accCan = (n) => !!n && isTeam() && !isPersonal(n) && !n.dim && lvOf(n) === 'admin'
// 지식의 자리 표(모두 · 사람 · 묶음) — 관리 자리만 읽는다 · 문서 화면 속성 칸에서만(카드 목록은 내 자리 칩만 — 지식 수만큼 묻지 않게)
const accessOf = (k) => need('access:' + k, `/api/k/${encodeURIComponent(k)}/access`)
const accSum = (a) => { const us = Object.keys(a.users || {}).filter((u) => u !== a.owner); return [`모두 ${LV_N[a.all] || '없음'}`, us.length ? `사람 ${us.length}` : '', Object.keys(a.groups || {}).length ? `묶음 ${Object.keys(a.groups).length}` : ''].filter(Boolean).join(' · ') }
// 속성 칸 「쓰는 사람」 — 관리 자리는 자리 표 요약 + [권한] · 그 밖에는 내 자리만
function whoHtml(k) {
  const n = KN(k)
  if (!accCan(n)) return `<span data-t="whoVal">나: ${lvChip(n)}</span>`
  const a = accessOf(k)
  // 자리 표를 읽지 못했으면 값으로 바꿔 보이지 않는다(Q45) — 까닭 + 다시 읽기
  if (a && a.error) return `<span data-t="whoVal" class="muted">권한을 읽지 못했다 <button type="button" class="lk" data-a="retryKey" data-k="${esc('access:' + k)}" data-t="whoRetry">다시 읽기</button></span>`
  const sum = !a ? '읽는 중…' : accSum(a)
  return `<span data-t="whoVal">${esc(sum)} <button type="button" class="lk" data-a="accOpen" data-k="${esc(k)}" data-t="accOpenSide">권한</button></span>`
}
const roAttr = (k) => (canWrite(k) ? '' : ' aria-disabled="true" data-ro="1" title="이 지식은 읽기 자리다: 고치려면 지식관리자에게 쓰기 자리를 부탁한다"')
const knTag = () => (isTeam() ? '<span class="kt team">팀</span>' : '<span class="kt me">개인</span>')

// ───────────── 자료 ─────────────
const BG = ['/api/busy', '/api/stops', '/api/claude/state', '/api/feed']
async function getJSON(p) {
  const r = await fetch(p, { headers: { accept: 'application/json' } }).catch(() => { throw Object.assign(new Error('서버에 닿지 않는다'), { code: 'E_REACH' }) })
  const bg = BG.some((x) => p.startsWith(x))
  if (r.status === 401 && bg && S.me && !S.me.anon) { if (!S.loginLost) { S.loginLost = true; setTimeout(render) } throw Object.assign(new Error('들어간 것이 끝났다'), { code: 'E_AUTH' }) }
  if (r.status === 401 && canRelogin()) { await askLogin(); S.loginLost = false; return getJSON(p) }
  const j = await r.json().catch(() => ({}))
  if (r.ok && S.loginLost && !bg) { S.loginLost = false; setTimeout(render) }
  if (r.status === 401 && S.me && !S.me.anon) { S.me = { ...S.me, anon: true }; setTimeout(render) }
  if (!r.ok) throw Object.assign(new Error(j.message || '서버에 닿지 않는다'), { code: j.error })
  return j
}
// 글 속 그림 · 첨부 그림 — 이 지식의 첨부만(data-att · data-ak)
function fillAtts() {
  for (const img of app.querySelectorAll('img[data-att]:not([src])')) img.src = `/api/k/${encodeURIComponent(img.dataset.ak)}/att?a=${encodeURIComponent(img.dataset.att)}`
}
// 지식 목록 — 실패하면 지금 목록 그대로
// 문서 지켜보기(UX T4-03) — { 'kn|doc': { at, title } } · 이 브라우저에만(사람마다 편의)
const WATCH_KEY = 'kmd.watch'
function watchList() { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '{}') || {} } catch (e) { console.warn('지켜보기 목록을 읽지 못했다', e); return {} } }
function watchSave(w) { try { localStorage.setItem(WATCH_KEY, JSON.stringify(w)) } catch (e) { console.warn('지켜보기 목록을 남기지 못했다', e) } }
const myWrites = new Map() // 'kn|doc' → 내가 저장한 때(그 바뀜은 알리지 않는다)
async function watchTick() {
  if (!S.me || anon()) return
  const w = watchList(), keys = Object.keys(w)
  if (!keys.length) return
  const changed = []
  for (const k of [...new Set(keys.map((x) => x.split('|')[0]))]) {
    if (!KN(k)) continue
    const tr = await getJSON(`/api/k/${encodeURIComponent(k)}/tree`).catch((e) => { console.warn('지켜보는 지식을 읽지 못했다', k, e.message); return null })
    if (!tr || !tr.docs) continue
    for (const d of tr.docs) {
      const key = k + '|' + d.id, it = w[key]
      if (!it || !d.when) continue
      const t = Date.parse(d.when)
      if (t > it.at && !(myWrites.get(key) && Math.abs(myWrites.get(key) - t) < 120000)) changed.push({ k, d: d.id, title: d.title || it.title })
      it.at = Math.max(it.at, t || 0)
    }
  }
  watchSave(w)
  if (!changed.length) return
  forgetKn(changed[0].k)
  toast(`<b>지켜보는 문서가 바뀌었다</b> · ${changed.slice(0, 3).map((c) => `<button type="button" class="lk" data-a="openDoc" data-k="${esc(c.k)}" data-d="${esc(c.d)}">${esc(c.title)}</button>`).join(' · ')}${changed.length > 3 ? ` 외 ${changed.length - 3}` : ''}`, 12000)
  if (document.hidden && window.Notification && Notification.permission === 'granted') { try { new Notification('kmd: 지켜보는 문서가 바뀌었다', { body: changed.map((c) => c.title).join(' · ').slice(0, 160), tag: 'kmd-watch' }) } catch (e) { console.warn('화면 밖 알림을 띄우지 못했다', e) } }
}
setInterval(() => { watchTick().catch((e) => console.warn('지켜보기', e)) }, 60000)
async function reloadKns() {
  const ks = await getJSON('/api/knowledge').catch((e) => { console.warn('지식 목록을 읽지 못했다', e); return null })
  if (ks) S.kns = ks
}
// 있으면 바로 · 없으면 받기 시작하고 null(받으면 다시 그린다) · 실패는 15초만 기억한다(서버가 돌아오면 다시 받는다)
function need(key, path) {
  if (key in S.cache && S.cache[key] && S.cache[key].error && Date.now() - (S.cache[key].at || 0) > 15000) delete S.cache[key]
  if (key in S.cache) return S.cache[key]
  if (!S.wait[key]) {
    S.wait[key] = getJSON(path)
      .then((v) => { S.cache[key] = v }, (e) => { S.cache[key] = { error: e.message, code: e.code || null, at: Date.now() } })
      .finally(() => { delete S.wait[key]; scheduleRender() })
  }
  return null
}
const treeOf = (k) => need('tree:' + k, `/api/k/${encodeURIComponent(k)}/tree`)
// 기록은 최근 200 개씩(서버 Q71) — { total, more, next } · 다음 쪽과 겹칠 수 있다 → id 로 거른다.
//   남은 수는 total - 받은 수
const recLeft = (tr) => (tr && tr.total != null ? Math.max(0, tr.total - (tr.records || []).length) : 0)
const recOrd = (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))
async function treeMore(k) {
  const tr = S.cache['tree:' + k]
  if (!tr || !tr.next || S.wait['treeMore:' + k]) return
  S.wait['treeMore:' + k] = true; render()
  try {
    const v = await getJSON(`/api/k/${encodeURIComponent(k)}/tree?before=${encodeURIComponent(tr.next)}`)
    const cur = S.cache['tree:' + k]
    if (cur !== tr) return // 그사이 새로 읽었다(저장 · 정리) — 첫 쪽부터 다시
    const seen = new Set(tr.records.map((x) => x.id))
    const add = (v.records || []).filter((x) => !seen.has(x.id))
    S.cache['tree:' + k] = { ...tr, records: [...tr.records, ...add].sort(recOrd), total: v.total ?? tr.total, more: v.more, next: v.next }
  } catch (e) { toastErr(e) } finally { delete S.wait['treeMore:' + k]; render() }
}
const docOf = (k, d) => need(`doc:${k}:${d}`, `/api/k/${encodeURIComponent(k)}/doc?d=${encodeURIComponent(d)}`)
// 고칠 때만 — 편집용 md · 잠긴 표를 실은 것(읽기만 할 때는 받지 않는다 · Q84)
const docEdOf = (k, d) => need(`doc:${k}:${d}:ed`, `/api/k/${encodeURIComponent(k)}/doc?d=${encodeURIComponent(d)}&edit=1`)
const recOf = (k, r) => need(`rec:${k}:${r}`, `/api/k/${encodeURIComponent(k)}/rec?r=${encodeURIComponent(r)}`)
// 읽는 중 — 빙빙이 + 글(컨벤션 10절)
const loadingHtml = '<p class="loading" data-t="loading">읽는 중…</p>'
const teamKn = (k) => isTeam() && KN(k) && !isPersonal(KN(k))
// 오류 — 무엇이 · 왜 + 「다시 읽기」(그 받은 값을 지우고 다시 받는다). key 를 모르면(v.key 도 없으면) 단추 없이
const keyOf = (v) => (v && typeof v === 'object' ? Object.keys(S.cache).find((x) => S.cache[x] === v) : null)
// 화면 읽기 프로그램에 오류를 알린다 — 그린 칸에는 role=alert 를 달지 않는다(3초마다 다시 그리면 같은 오류를 되풀이해 읽는다).
//   그리는 동안 sayErr 로 모으고, 다 그린 뒤 지난번에 없던 것만 고정 자리 #srLive 에 쓴다(사라졌다 다시 나면 다시 읽는다)
let saidNow = [], saidPrev = []
const sayErr = (m) => { saidNow.push(String(m)); return '' }
function sayFlush() {
  const fresh = saidNow.filter((m) => !saidPrev.includes(m))
  saidPrev = saidNow
  saidNow = []
  const h = document.getElementById('srLive')
  if (h && fresh.length) h.textContent = fresh.join(' · ')
}
const errHtml = (v, key) => {
  const k = key || keyOf(v)
  sayErr((v && v.error) || v || '읽지 못했다')
  return `<div class="callout danger err" data-t="err"><b>${esc((v && v.error) || v || '읽지 못했다')}</b>${k ? `<button type="button" class="btn sm retry" data-a="retryKey" data-k="${esc(k)}" data-t="retry">다시 읽기</button>` : ''}</div>`
}
// 창 · 폼 안의 오류 — 화면 읽기 프로그램에도 알린다(sayErr) · id 는 틀린 칸의 aria-describedby 가 가리킨다
//   formErr(글, data-t, 덧붙일 html) — 글은 그대로 넣는다(이미 esc 한 것이면 raw=true)
const formErr = (msg, t, extra, raw) => { sayErr(String(msg).replace(/<[^>]+>/g, '')); return `<div class="callout danger" id="fe-${esc(t)}" data-t="${esc(t)}">${raw ? msg : esc(msg)}${extra || ''}</div>` }
// 틀린 칸 표시 — 오류가 있으면 aria-invalid · aria-describedby(formErr 의 id)
const invAttr = (on, t) => (on ? ` aria-invalid="true" aria-describedby="fe-${esc(t)}"` : '')

// ───────────── 토스트 ─────────────
// 알림은 4.5초 · 오류(err)는 7초 넘게 · 화면 읽기 프로그램이 읽게(#toastHost 는 role=status · 오류는 role=alert)
//   여럿이면 쌓는다(Q48 · 최대 3 · 넘치면 오래된 알림부터 · 오류는 알림에 밀려 사라지지 않는다) · 토스트마다 제 시간
function toast(html, ms, err) {
  const h = $('#toastHost')
  err = err || ms === true
  if (ms === true) ms = 0
  const el = document.createElement('div')
  el.className = 'toast' + (err ? ' err' : '')
  el.dataset.t = 'toast'
  if (err) el.setAttribute('role', 'alert')
  el.innerHTML = html
  // 같은 글이 떠 있으면 그것을 새로(되풀이해 쌓지 않는다)
  for (const o of [...h.children]) if (o.innerHTML === el.innerHTML) { clearTimeout(o._t); o.remove() }
  h.appendChild(el)
  while (h.children.length > 3) { const old = [...h.children].find((x) => !x.classList.contains('err')) || h.children[0]; clearTimeout(old._t); old.remove() }
  el._t = setTimeout(() => el.remove(), Math.max(ms || 4500, err ? 8000 : 0))
}
// 오류 토스트 — 잡은 오류를 그대로
const toastErr = (e) => toast(esc(e && e.message ? e.message : e), 8000, true)

// ───────────── 길 · 탭 · 이전/다음 ─────────────
// 들어온 채 보던 들어가기 화면(✓ 정했다 · 쓴 링크 · 남의 링크) — 다른 곳으로 옮기면 닫는다(옆 메뉴 · 머리 · 단축키가 그대로 듣게)
function leaveGate() {
  if (!S.gate || anon()) return
  S.gate = null
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}
function go(r) {
  leaveGate()
  r = r || {}
  const prevKn = S.route.kn
  // 지식 메뉴 화면(점검 · 생성 · 공유 · 이력 · 구조)은 옆 메뉴에서 고른 지식을 따른다(메뉴 개편 N5 · 화면 안 지식 고르기는 걷었다)
  S.route = Object.assign({ scr: 'home', kn: S.route.kn }, r)
  if (KM_SCR.includes(S.route.scr) && (!S.route.kn || S.route.kn === '*')) S.route.kn = defaultKn() || '*'
  if (r.sub !== undefined) subSet(S.route.scr, r.sub)
  delete S.route.sub
  // 옛 화면 · 설정 페이지 이름은 새 자리로(routeFix 한곳) · 설정 · 지식관리 페이지는 { scr, page } 하나로 간다(앱 안 기록에 실린다)
  S.route = routeFix(S.route)
  S.menu = null
  if (S._flashSel && S.route.scr !== 'import') S._flashSel = null
  if (S.route.scr !== 'import') S.paste = null
  if (S.route.scr === 'import') { dropSrcs(); setTimeout(pollRuns, 0) }
  if (S.route.scr === 'today' || S.route.scr === 'log') { delete S.cache.history } // 감시가 뒤에서 바꾼 것 — 열 때마다 새로
  S.sideOpen = false; S.asideOpen = false // 서랍은 옮기면 닫는다
  if (S.route.kn && S.route.kn !== '*') S.lastKn = S.route.kn
  if (r.kn && r.kn !== '*' && r.kn !== prevKn) {
    const t = activeTab()
    if (t && t.kn !== r.kn) {
      const o = S.tabs.filter((x) => x.kn === r.kn).pop()
      S.active = o ? o.id : null
      if (!o || S.split === S.active) S.split = null
    }
  }
  pushHist()
  render()
  scrollTopMain()
}
// 서랍(옆 메뉴 · 옆 칸)을 닫는다 — 초점이 서랍 안에 있었으면 연 단추(☰ · 옆 칸)로 돌려준다(숨은 칸에 남지 않게)
function drawerShut() {
  const a = document.activeElement
  const from = a && a.closest ? (a.closest('.aside') ? 'asideBtn' : a.closest('.side') ? 'menuBtn' : null) : null
  S.sideOpen = false; S.asideOpen = false
  render()
  if (from) { const b = $(`[data-t=${from}]`); if (b) b.focus({ preventScroll: true }) }
}
function scrollTopMain() { const m = $('#app .main'); if (m) m.scrollTop = 0 }
function defaultKn() {
  const k = S.route.kn
  if (k && k !== '*' && KN(k)) return k
  return KN(S.lastKn) ? S.lastKn : (shownKns()[0] || S.kns[0] || {}).id
}
function setView(v) { if (VIEWS3.includes(v)) S.ktab = v; go({ scr: v, kn: defaultKn() }) }
function activeTab() { return S.tabs.find((t) => t.id === S.active) || null }
function tabOf(id) { return S.tabs.find((t) => t.id === id) || null }
function isAct(kind, k, ref) { const t = activeTab(); return !!t && t.kind === kind && t.kn === k && t.ref === ref }
// 최근 본 것(UX T4-08) — localStorage · 실패해도 화면은 그대로
const recentGet = () => { try { return JSON.parse(localStorage.getItem('kmd.recent') || '[]').slice(0, 8) } catch { return [] } }
function recentAdd(t) { try { const a = recentGet().filter((x) => !(x.kind === t.kind && x.k === t.kn && x.ref === t.ref)); a.unshift({ kind: t.kind, k: t.kn, ref: t.ref }); localStorage.setItem('kmd.recent', JSON.stringify(a.slice(0, 8))) } catch {} }
function openTab(t, o) {
  if (t && t.kind && t.kn && t.ref) recentAdd(t)
  o = o || {}
  let ex = S.tabs.find((x) => x.kind === t.kind && x.kn === t.kn && x.ref === t.ref)
  if (ex) { ex.hl = t.hl || null; ex.q = t.q || null }
  else {
    ex = Object.assign({ hl: null, q: null }, t, { id: uid() })
    const i = S.tabs.findIndex((x) => x.id === S.active)
    S.tabs.splice(i < 0 ? S.tabs.length : i + 1, 0, ex)
  }
  S.active = ex.id
  if (S.split === ex.id) S.split = null
  S.route.kn = t.kn
  S.lastKn = t.kn
  if (o.view) S.route.scr = o.view
  else if (!['docs', 'items'].includes(S.route.scr)) S.route.scr = t.kind === 'item' ? 'items' : 'docs'
  if (!o.noHist) pushHist()
  return ex
}
function tabTitle(t) {
  if (t.kind === 'doc') { const tr = S.cache['tree:' + t.kn]; const d = tr && tr.docs && tr.docs.find((x) => x.id === t.ref); return d ? d.title : t.ref }
  if (t.kind === 'rec') { const tr = S.cache['tree:' + t.kn]; const r = (tr && tr.records && tr.records.find((x) => x.id === t.ref)) || S.cache[`rec:${t.kn}:${t.ref}`]; return r && r.title ? r.title.split(/ — |: /)[0] : '기록' }
  if (t.kind === 'item') { const it = itemByKey(t.kn, t.ref); return it ? it.short || it.name : t.ref.replace(/^#[^#]*#/, '').replace(/^[^:]+:/, '') }
  return t.ref
}
function tabIcon(t) { return t.kind === 'doc' ? svg('doc') : t.kind === 'item' ? svg('tag') : t.kind === 'att' ? svg('clip') : '<i class="pd"></i>' }
function closeTab(id) {
  const i = S.tabs.findIndex((t) => t.id === id)
  if (i < 0) return
  S.tabs.splice(i, 1)
  if (S.split === id) S.split = null
  if (S.active === id) { const n = S.tabs[i] || S.tabs[i - 1]; S.active = n ? n.id : null; if (n) S.route.kn = n.kn }
  if (S.split === S.active) S.split = null
  pushHist()
}
function toggleSplit() {
  S.menu = null
  if (S.split) { S.split = null; render(); return }
  const a = activeTab(), others = S.tabs.filter((t) => t.id !== S.active)
  if (!a || !others.length) { toast('탭이 둘 있어야 나란히 본다. Ctrl O 로 하나 더 연다'); render(); return }
  const i = S.tabs.indexOf(a)
  const o = S.tabs[i - 1] && S.tabs[i - 1].id !== S.active ? S.tabs[i - 1] : others[others.length - 1]
  S.split = o.id
  if (!['docs', 'items'].includes(S.route.scr)) S.route.scr = 'docs'
  render()
}
const HASH_TAB = { doc: 'd', item: 'i', rec: 'r' }
// 지식 메뉴 화면의 주소(메뉴 개편 N5 · 저장 승인 P10) — 고른 지식에 딸린다: #/k/<지식>/gen(/auto) · check(/check · /metrics · 옛 /review) · share · history · shape
//   옛 주소 #/import · #/held · #/send · #/structure · #/today 도 그대로 열고, 연 뒤 새 꼴로 바꿔 적는다(openHash → pushHist)
const HASH_SCR = { import: 'gen', held: 'check', send: 'share', structure: 'shape', today: 'history', log: 'history' }
const SCR_HASH = { gen: 'import', check: 'held', share: 'send', shape: 'structure', history: 'today' }
// 화면 안 탭(주소 끝 조각) — 생성 수기수집(처음) · 자동수집 / 점검 점검(처음) · 지표(저장 승인 P10 · P11)
//   옛 주소 #/held · #/k/<지식>/check · check/review 는 처음 탭(점검)으로 · 점검 화면의 안쪽 이름은 옛 그대로 held
const subOf = (scr) => (scr === 'import' ? (S.genTab === 'auto' ? 'auto' : null) : scr === 'held' ? (S.ckTab === 'metrics' ? 'metrics' : null) : scr === 'structure' ? (S.sxTab === 'check' && !isTeam() ? 'check' : null) : null)
function subSet(scr, sub) {
  if (scr === 'import') S.genTab = sub === 'auto' ? 'auto' : 'manual'
  if (scr === 'held') S.ckTab = sub === 'metrics' ? 'metrics' : 'check'
  if (scr === 'structure') S.sxTab = sub === 'check' ? 'check' : 'shape'
}
function hashOf(s) {
  const e = encodeURIComponent
  if (s.tab && HASH_TAB[s.tab.kind]) return `#/k/${e(s.tab.kn)}/${HASH_TAB[s.tab.kind]}/${e(s.tab.ref)}`
  if (s.scr === 'settings') return '#/settings' + (s.page ? '/' + e(s.page) : '')
  if (s.scr === 'home') return s.page === 'seed' || s.page === 'people' ? '#/manage/' + s.page : s.mk ? `#/manage/k/${e(s.mk)}/${e(s.mt || 'info')}` : '#/manage'
  if (s.kn && s.kn !== '*' && KNSCR.includes(s.scr)) return `#/k/${e(s.kn)}/${s.scr}`
  if (KM_SCR.includes(s.scr) && s.kn && s.kn !== '*') return `#/k/${e(s.kn)}/${HASH_SCR[s.scr]}${s.sub ? '/' + e(s.sub) : ''}`
  return s.scr && s.scr !== 'home' ? '#/' + s.scr : '#/'
}
// 주소 → 갈 곳(모르는 꼴이면 null) — #once= · #code= 는 이 길이 아니다
function parseHash(h) {
  const m = String(h || '').match(/^#\/(.*)$/)
  if (!m) return null
  let p
  try { p = m[1].split('/').map(decodeURIComponent) } catch { return null }
  if (p[0] === 'k' && p[1]) {
    const kind = { d: 'doc', i: 'item', r: 'rec' }[p[2]]
    if (kind && p[3]) return { scr: kind === 'item' ? 'items' : 'docs', kn: p[1], tab: { kind, kn: p[1], ref: p[3] }, sec: p[4] === 'h' && p[5] ? p[5] : null }
    if (SCR_HASH[p[2]]) return { scr: SCR_HASH[p[2]], kn: p[1], sub: p[3] || null }
    return { scr: p[2] || 'docs', kn: p[1] }
  }
  if (p[0] === 'settings') return { scr: 'settings', page: p[1] || null }
  if (p[0] === 'manage') return p[1] === 'k' && p[2] ? { scr: 'home', kn: '*', page: 'all', mk: p[2], mt: p[3] || 'info' } : { scr: 'home', kn: '*', page: p[1] || 'all' }
  return { scr: p[0] || 'home', kn: '*' }
}
// 주소로 연다(처음 들어올 때 · 브라우저 뒤로) — 보이지 않는 지식이면 지식 목록으로
function openHash(r) {
  if (!r) return false
  if (r.kn && r.kn !== '*' && !KN(r.kn)) { toast('그 지식이 없거나 볼 자리가 없다'); S.route = { scr: 'home', kn: '*' }; return true }
  S.route = routeFix({ scr: r.scr, kn: r.kn || S.route.kn, ...(r.page ? { page: r.page } : {}), ...(r.mk ? { mk: r.mk, mt: r.mt } : {}) })
  if (S.route.mk && !KN(S.route.mk)) { toast('그 지식이 없거나 볼 자리가 없다'); delete S.route.mk; delete S.route.mt }
  // 지식 메뉴 화면 — 옛 주소(지식 없음)는 고른 지식으로 · 화면 안 탭 · 생성은 일 줄 읽기를 건다
  if (KM_SCR.includes(S.route.scr)) {
    if (!S.route.kn || S.route.kn === '*') S.route.kn = defaultKn() || '*'
    subSet(S.route.scr, r.sub)
    if (S.route.scr === 'import') setTimeout(pollRuns, 0)
  }
  if (r.tab) { if (r.tab.kind === 'doc' && r.sec) openDocAt(r.kn, r.tab.ref, r.sec, null, 'docs'); else openTab(Object.assign({}, r.tab), { noHist: true, view: r.scr }) }
  return true
}
let hashSkip = false // 앱이 바꾼 주소에는 popstate 로 다시 옮겨 가지 않는다
function syncHash(push) {
  if (!S.me || anon() || gated()) return
  const h = hashOf(snap())
  if (location.hash === h) return
  try { if (push) history.pushState({ kmd: S.hpos }, '', h); else history.replaceState({ kmd: S.hpos }, '', h) } catch {}
}
window.addEventListener('popstate', (ev) => {
  if (!S.me || anon()) return
  const st = ev.state
  if (st && typeof st.kmd === 'number' && S.hist[st.kmd] && st.kmd !== S.hpos) { hashSkip = true; histGo(st.kmd - S.hpos); hashSkip = false; return }
  const r = parseHash(location.hash)
  if (r) { S.menu = null; S.pal = null; S.qo = null; S.cmd = null; openHash(r); pushHist(true); render() }
})
function snap() { const t = ['docs', 'items'].includes(S.route.scr) ? activeTab() : null; return { scr: S.route.scr, kn: S.route.kn, page: S.route.scr === 'settings' || S.route.scr === 'home' ? S.route.page || null : null, mk: S.route.scr === 'home' && S.route.mk ? S.route.mk : null, mt: S.route.scr === 'home' && S.route.mk ? S.route.mt || 'info' : null, sub: subOf(S.route.scr), tab: t ? { kind: t.kind, kn: t.kn, ref: t.ref } : null } }
function pushHist(replace = false) {
  const s = snap(), c = S.hist[S.hpos]
  if (c && JSON.stringify(c) === JSON.stringify(s)) { syncHash(false); return } // 같은 화면 — 옛 꼴 주소(#/structure 등)로 왔으면 새 꼴로만 바꿔 적는다
  S.hist = S.hist.slice(0, S.hpos + 1)
  S.hist.push(s)
  if (S.hist.length > 80) S.hist.shift()
  S.hpos = S.hist.length - 1
  syncHash(!replace && S.hist.length > 1)
}
function histGo(d) {
  leaveGate()
  const i = S.hpos + d
  if (i < 0 || i >= S.hist.length) return
  S.hpos = i
  const s = S.hist[i]
  S.route = { scr: s.scr, kn: s.kn, ...(s.page ? { page: s.page } : {}), ...(s.mk ? { mk: s.mk, mt: s.mt } : {}) }
  S.menu = null; S.pal = null; S.qo = null; S.cmd = null
  subSet(s.scr, s.sub)
  if (s.tab) openTab(Object.assign({}, s.tab), { noHist: true, view: s.scr })
  if (!hashSkip) syncHash(false)
  render()
  scrollTopMain()
}

// ───────────── 그리기 ─────────────
// 받기 여럿이 끝날 때마다 따로 그리지 않게 — 다음 그림 한 번으로 묶는다(바로 그리는 render() 가 오면 묶은 것은 버린다)
let rafId = 0
function scheduleRender() { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render() }) }
// 다시 그려도 키보드 자리 그대로 — 그리기 전 초점의 id · data-a(+ data-*) 를 기억했다가 같은 것을 다시 찾는다
function focusKey(el) {
  if (!el || el === document.body || !app.contains(el)) return null
  if (el.id) return '#' + CSS.escape(el.id)
  if (!el.dataset || !el.dataset.a) return null
  return Object.keys(el.dataset).filter((k) => k !== 'pv').map((k) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${CSS.escape(el.dataset[k])}"]`).join('')
}
const app = document.getElementById('app')
// 그리다 넘어진 화면의 안내 — 프로그램 속 오류 글은 펼쳐 보는 자세히에만(콘솔에도 남는다)
const drawErrHtml = (e) => `<div class="callout danger err" role="alert" data-t="drawErr"><b>이 화면을 보여 주지 못했다</b><small>옆 메뉴로 다른 화면에 갈 수 있다 · 계속되면 관리자에게 알린다</small><details><summary>자세히</summary><code>${esc(e && e.message ? e.message : String(e))}</code></details><button type="button" class="btn sm retry" data-a="retryAll">다시 읽기</button></div>`
function render() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  const fk = focusKey(document.activeElement)
  try { draw() } catch (e) {
    // 그리다 넘어졌다 — 굳은 화면 대신 안내를 남긴다(다시 읽기 = 받은 값을 모두 지우고 다시)
    console.error(e)
    if (app.querySelector('.col')) toast('화면을 새로 그리지 못해 보던 화면을 그대로 둔다 · <button type="button" class="btn sm" data-a="retryAll">다시 읽기</button>', 8000, true)
    else app.innerHTML = `<div class="col"><div class="main">${drawErrHtml(e)}</div></div>`
  }
  a11yPass()
  modalPass()
  sayFlush()
  if (fk && (!document.activeElement || document.activeElement === document.body)) { const el = app.querySelector(fk); if (el) el.focus({ preventScroll: true }) }
}
// 누르는 것을 키보드로 — div · span · li 의 data-a 에 role=button · tabindex=0(이미 단추 · 링크 · 칸이면 건너뛴다) · 탭 줄은 role=tab
// 터미널을 위로 올려 본 자리(그리는 차례 i → scrollTop) · 맨 아래로 내리면 지운다
const termUp = new Map()
document.addEventListener('scroll', (ev) => {
  const t = ev.target
  if (!t.classList || !t.classList.contains('term')) return
  const i = [...app.querySelectorAll('.term')].indexOf(t)
  if (i < 0) return
  if (t.scrollTop + t.clientHeight >= t.scrollHeight - 8) termUp.delete(i)
  else termUp.set(i, t.scrollTop)
}, true)
function a11yPass() {
  for (const el of document.querySelectorAll('#app [data-a]:not(button,a[href],input,select,textarea,label,option,[data-self]), #toastHost [data-a]:not(button,a[href])')) {
    if (el.closest('.tabs') && el.parentElement.classList.contains('tabs')) { el.setAttribute('role', 'tab'); el.setAttribute('aria-selected', el.classList.contains('on') ? 'true' : 'false') } else if (!el.hasAttribute('role')) el.setAttribute('role', el.matches('a,.dlink') ? 'link' : 'button') // href 없는 a · 본문 문서 링크는 링크로 읽는다
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0
  }
  for (const t of document.querySelectorAll('#app .tabs')) t.setAttribute('role', 'tablist')
  for (const b of document.querySelectorAll('#app button[title]:not([aria-label])')) if (/^[‹›+−×⋯▸▾☰]$/.test(b.textContent.trim())) b.setAttribute('aria-label', b.title)
  for (const a of document.querySelectorAll('#app a.dlink, #app .ilink')) if (a.getAttribute('role') === 'button') a.removeAttribute('role')
  for (const a of document.querySelectorAll('#app .paper .dlink.rec:not([title])')) a.title = '기록: 문서 본문이 아니다'
  // 스위치 — 켜짐을 class on 으로만 그린 곳도 읽히게
  for (const b of document.querySelectorAll('#app button.sw')) { b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', b.classList.contains('on') ? 'true' : 'false') }
  // 고른 것 — seg 단추 · 일 줄 거름 칩은 aria-pressed · 나무의 연 문서 · 옆 메뉴의 지금 화면은 aria-current · 접기 머리는 aria-expanded
  for (const b of document.querySelectorAll('#app .seg > button')) b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false')
  for (const b of document.querySelectorAll('#app .tn')) { if (b.classList.contains('on')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current') }
  for (const b of document.querySelectorAll('#app .tf')) { const ar = b.querySelector('.ar'); if (ar) b.setAttribute('aria-expanded', ar.textContent.trim() === '▾' ? 'true' : 'false') }
  const dr = drawerBox()
  for (const b of document.querySelectorAll('#app .side, #app .aside')) {
    if (b === dr) { b.setAttribute('role', 'dialog'); b.setAttribute('aria-modal', 'true'); b.setAttribute('aria-label', b.classList.contains('side') ? '옆 메뉴' : '옆 칸') } else if (b.getAttribute('role') === 'dialog') { b.removeAttribute('role'); b.removeAttribute('aria-modal') }
  }
  // 서랍이 열린 동안 덮개 뒤 — 옆 메뉴가 열리면 .col · 옆 칸이 열리면 가운데(.main · 탭 줄)를 inert
  const back = dr ? (dr.classList.contains('side') ? [$('#app .col')] : [...app.querySelectorAll('.col > .hdr, .col .center, .col > .body > .main, .col .band')]) : []
  for (const el of app.querySelectorAll('[inert]')) if (!back.includes(el)) el.removeAttribute('inert')
  for (const el of back) if (el) el.setAttribute('inert', '')
  const kp = $('#app [data-t=kpick]'); if (kp) { kp.setAttribute('aria-haspopup', 'menu'); kp.setAttribute('aria-expanded', S.menu === 'kmenu' ? 'true' : 'false'); kp.setAttribute('aria-label', '지식 고르기: ' + (kp.querySelector('.rn')?.firstChild?.textContent || '').trim()) }
  for (const m of document.querySelectorAll('#app .kmenu, #app .menu, #app .pop')) {
    const its = [...m.querySelectorAll('[data-a]')]
    if (!its.length || m.querySelector('input,select,textarea') || !its.every((x) => x.classList.contains('mi'))) continue // 칸 · 일 줄이 든 팝업(지금 하는 일)은 메뉴가 아니다
    m.setAttribute('role', 'menu')
    for (const it of its) { it.setAttribute('role', 'menuitem'); it.tabIndex = -1 }
    for (const sp of m.querySelectorAll('.sep')) sp.setAttribute('role', 'separator')
  }
  for (const tl of document.querySelectorAll('#app [role=tablist]')) {
    const ts = [...tl.querySelectorAll('[role=tab]')].filter((t) => t.closest('[role=tablist]') === tl)
    const on = ts.find((t) => t.getAttribute('aria-selected') === 'true') || ts[0]
    for (const t of ts) t.tabIndex = t === on ? 0 : -1
  }
  for (const b of document.querySelectorAll('#app [data-m]')) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', S.menu === b.dataset.m ? 'true' : 'false'); if (!b.hasAttribute('aria-label') && b.title) b.setAttribute('aria-label', b.title) } // ⋯ 은 이름이 「⋯」 뿐 — title 을 이름으로
}
// 모달 — role=dialog · 제목으로 이름 · 열리면 첫 칸(없으면 첫 단추)에 초점 · 닫히면 연 단추로 돌아간다
const modals = () => [...app.querySelectorAll('.scrim > .modal, .pscrim > .modal, .pscrim > .pal')]
// 열린 서랍 — 옆 메뉴(600 이하) · 옆 칸(1024 이하)
const drawerBox = () => (S.sideOpen && app.classList.contains('side-open') ? $('#app .side') : S.asideOpen && app.classList.contains('aside-open') ? $('#app .aside') : null)
function modalPass() {
  const ms = modals()
  ms.forEach((m, i) => {
    m.setAttribute('role', 'dialog')
    m.setAttribute('aria-modal', 'true')
    const h = m.querySelector('.mh, .tb')
    if (h) { if (!h.id) h.id = 'mh-' + (m.dataset.t || i); m.setAttribute('aria-labelledby', h.id) } else if (!m.hasAttribute('aria-label')) m.setAttribute('aria-label', m.querySelector('input') ? m.querySelector('input').placeholder || '찾기' : '창')
  })
  const top = ms[ms.length - 1] || null
  const sig = top ? top.dataset.t || top.className : null
  if (sig === S._modalSig) return
  if (top && !S._modalSig) S._modalFrom = S._lastFocus || null
  S._modalSig = sig
  if (top) {
    if (top.contains(document.activeElement)) return
    const f = top.querySelector('input:not([type=hidden]):not([disabled]):not([readonly]),textarea:not([disabled]),select:not([disabled])') || top.querySelector('.mf button:not([disabled]),.wf button:not([disabled])') || focusables(top)[0]
    if (f) f.focus({ preventScroll: true })
  } else if (S._modalFrom && (!document.activeElement || document.activeElement === document.body)) {
    const el = app.querySelector(S._modalFrom) || (S._lastMenu && app.querySelector(`[data-m="${CSS.escape(S._lastMenu)}"]`)) || app.querySelector('.main[data-t=main]')
    if (el) { if (!el.matches('button,a[href],input,select,textarea,[tabindex]')) el.tabIndex = -1; el.focus({ preventScroll: true }) }
    S._modalFrom = null
  }
}
const focusables = (box) => [...box.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((x) => x.getClientRects().length)
document.addEventListener('focusin', (ev) => { if (!ev.target.closest || !ev.target.closest('.scrim,.pscrim')) S._lastFocus = focusKey(ev.target) })
// 팝업(.pop) — 화면 맨 위 층에 띄운다. 그리는 곳은 popHtml(key, 글) 하나: S._pop 에 두고 빈 글을 돌려준다(누른 단추 [data-m=key] 에서 자리를 잰다)
function popHtml(key, html) { S._pop = { key, html }; return '' }
// 정보 단추 (!) · 툴팁(컨벤션 4절 · docs/품질개선/KMD_메뉴개편_설계.md 3-2) — 덧말 글은 TIPS 한곳 · 화면은 tipb(id) 하나로 그린다
//   TIPS[id] = [글, 설명서 주소(없으면 '')] · 글은 세 줄 · 문장 둘까지 · 한 화면 (!) 는 다섯까지
//   툴팁은 누른 단추 바로 뒤에 그린다(Tab 차례가 단추 다음 · 모달이면 모달 Tab 가둠 안) · 설명서가 있으면 dialog(열 때 링크에 초점) · 없으면 tooltip(단추 aria-describedby · 초점은 단추)
//   누름 · Enter · Space 로 열고 닫는다(hover 로 열지 않는다) · Esc(초점은 단추로) · 바깥 누름 · 초점이 밖으로 · 단추가 화면 밖이면 닫는다 · 한 번에 하나
const TIPS = {
  'sx.flow': ['항목을 옮기거나 합치거나 나누면 단계를 지난다: 구조안 검사 · 연습 판에 해 보기 · 넣기. 넣기 전에는 지식이 바뀌지 않는다', ''],
  'sx.claude': ['Claude 가 지금 짜임을 보고 구조안을 지어 나무에 놓는다. 넣기 전에는 지식이 바뀌지 않는다 · 고쳐서 쓰거나 모두 처음대로', ''],
  'sx.claudeW': ['Claude 가 출처 글로 새 글을 짓는다. 걸리는 꼴은 고쳐 쓰고 · 출처에 없는 값은 알려 준다', ''],
  'sx.write': ['합치거나 나눈 항목의 새 글. 출처 글의 값(숫자 · 주소 · 이름)만 쓴다. 지어낸 값이 있으면 그 걸음은 넣지 않는다', ''],
  'sx.stepFail': ['걸린 걸음은 아무것도 쓰지 않고 멈췄다. 앞에서 넣은 걸음은 그대로다. 구조안을 고쳐 검사 · 해 보기 · 넣기를 다시 한다', ''],
  'set.check': ['문제가 있을 때만 줄이 선다. 풀리면 저절로 사라진다 · 지식 폴더 다시 읽기 · 운영 값도 여기', ''],
  'set.server': ['팀 서버의 Claude(팀 일꾼) 로그인. 팀 지식의 들이기 · 다듬기를 이 로그인으로 한다', ''],
  'set.agent': ['작업 폴더의 Claude Code 에 팀 지식을 붙인다. 개인 지식을 쓰려면 개인 프로그램', ''],
  'set.agentPc': ['작업 폴더의 Claude Code 에 개인 지식을 붙인다. 팀 지식은 팀 화면에서 붙인다', ''],
  'set.mine': ['이 팀 서버와 이 서버에 들어온 나: 내 자리 · 비밀번호 · 나가기. 화면 밝기 · 내 기기는 오른쪽 위 내 메뉴', ''],
  'set.team': ['이 PC 가 기기 열쇠로 이은 팀 서버다. 공유 · Claude Code 의 팀 연결이 쓴다', ''],
  'set.teamHow': ['팀 화면 › 설정 › 개인 프로그램 설치의 한 줄로 잇는다. 끊기는 팀 화면 내 메뉴 › 내 기기', ''],
  'kn.root': ['지식 하나 = 이 폴더 안의 폴더 하나. 다른 곳에서 만든 지식은 폴더째 놓고 [동기화] · [바꾸기] 는 다른 폴더를 잇는다(.kmd 가 없거나 빈 폴더면 새로 세운다)', ''],
  'kn.rootTeam': ['팀 지식 하나 = 이 폴더 안의 폴더 하나. 서버에 폴더째 놓은 지식은 [동기화] 로 읽는다', ''],
  'kd.gitlab': ['서버의 GitLab 연결로 새 저장소를 만들어 붙인다. 그룹은 봇이 만들 수 있는 곳 · 이름은 영문 · 숫자 · . _ - · 가지 처음 값 main', ''],
  'kd.repo': ['지식마다 붙이는 git 저장소다. 저장할 때마다 kmd 가 보낸다 · 비었거나 이 지식의 지난 이력이어야 붙는다 · 주소 속 열쇠는 가린다', ''],
  'mg.seed': ['빈 지식을 폴더째 재료로 한 번에 세운다. 파일 몇 개는 생성 › 수기수집', ''],
  'sd.kn': ['문서가 없는 지식에만 세운다. 먼저 수기수집으로 넣은 지식은 고를 수 없다 · [넣기] 전에는 지식이 바뀌지 않는다', ''],
  'sd.src': ['이 PC 의 폴더 경로. kmd-seed 스킬이 만든 짜임 꾸러미 폴더도 같은 칸에 넣는다', ''],
  'sd.big': ['이 화면은 한 번에 300 파일 · 200MB 까지 연다. 넘으면 Claude Code 에서 kmd-seed 스킬로 짜임 꾸러미를 만든 뒤 그 폴더를 넣는다', ''],
  'sd.claude': ['비밀 의심 파일은 보내지 않는다. 구조안 · 글을 지을 때 고른 파일의 글이 이 PC 의 Claude 로 간다', ''],
  'sd.up': ['폴더나 파일을 팀 서버로 올린다. 서버가 파일마다 글로 바꿔 두고 원본은 두지 않는다 · 올린 뒤 조사(판 · 같은 글 · 비밀 의심)', ''],
  'sd.bigT': ['한 묶음 300 파일 · 200MB. 넘으면 나눠 올린다: 앞 묶음을 넣은 뒤 같은 지식에 다음 묶음(묶음마다 구조안 승인). 스캔 · 아주 큰 대량은 Claude Code 의 kmd-seed', ''],
  'sd.team': ['원본은 팀 서버로 올라가 글로 바뀐다. 비밀 의심 파일은 보내지 않고 고른 파일의 글만 팀 일꾼(Claude)으로 간다', ''],
  'sd.cost': ['팀 일꾼 일: 구조안 1 + 글을 지을 문서마다 1. 하루 한도(지식마다)를 넘으면 내일 잇거나 손으로 쓴다 · 폴더 그대로는 0', ''],
  'sd.worker': ['열 분 안에 일감을 물은 팀 일꾼이 없거나 옛 판이다. 폴더 그대로 · 손으로 짜거나 설정 › 팀 일꾼', ''],
  'sd.idle': ['24시간 걸음이 없던 기초 세우기. 지은 것은 그대로다 · 다른 지식관리자가 새로 열 수 있다', ''],
  'sd.pick': ['넣음: 글로 쓴다 · 근거만: 값을 견줄 때만 · 빼기: 쓰지 않는다 · 보류: 이번에는 둔다. 옛 판 · 같은 글은 빼기, 비밀 의심 · 스캔은 보류가 처음 값', ''],
  'sd.feed': ['Claude 가 지금 하는 일: 읽는 재료 · 생각 · 답 · kmd 의 검사. 이 PC 의 메모리에만 있다(다시 켜면 사라진다)', ''],
  'sd.plan': ['어떤 문서 · 항목을 세울지. 문서 이름은 여기서 고친다 · 걸림이 0 이어야 다음으로', ''],
  'sd.mode': ['Claude 안: 파일을 대상 · 주제로 다시 묶는다 · 폴더 그대로: 파일 하나가 문서 하나(Claude 를 부르지 않는다)', ''],
  'sd.write': ['문서마다 항목 글. 재료에 없는 값은 알려 준다 · [보기] 에서 손으로 고친다', ''],
  'sd.first': ['Claude 안이면 처음 3 문서는 하나씩 읽고 승인한 뒤 남은 문서를 모두 짓는다', ''],
  'sd.diag': ['연습 판(지식의 사본)에 모두 넣어 본 결과. 막는 것이 0 이어야 넣는다 · 값 대조는 재기만 한다', ''],
  'sd.values': ['재료 글에 없는 값이 든 항목. 막지 않는다 · 넣은 뒤 그 문서에서 고친다', ''],
  'sd.put': ['걸음마다 한 번에 넣는다. 걸린 걸음은 아무것도 쓰지 않고 선다 · 꺼졌다 켜면 [이어 넣기]', ''],
  'mg.people': ['사람을 들이고 지식마다 자리를 준다. 바꾸기는 총괄 관리자만', ''],
  'set.claude': ['이 프로그램이 쓰는 내 Claude 로그인 · 일마다 모델', ''],
  'set.restore': ['저장소 주소에서 새 지식으로 불러온다. 삭제는 보관하지 않으므로 삭제한 지식은 저장소에서만 돌아온다', ''],
  'set.install': ['팀 지식만 쓰면 개인 프로그램은 필요 없다(위 카드 한 줄이면 된다). 내 지식 · 내 Claude 로그인을 따로 쓰려면 개인 프로그램을 깔고 팀에 잇는다', ''],
  'set.dev': ['내 이름의 기기 열쇠다. 팀에 이은 PC 의 Claude Code · 개인 프로그램 가운데 팀 서버가 아는 것만 보인다', ''],
  'set.backup': ['이 PC 를 잃어도 남게 다른 드라이브 · 네트워크 폴더 · USB 에 둔다. 지식마다 붙이는 저장소와 다르다', ''],
  // 페이지 머리 — 옛 .lead 문단
  'kn.list': ['옆 메뉴에 이 순서로 보인다. 줄을 끌어 순서를 바꾸고, 줄을 누르면 지식 상세', ''],
  'kn.listTeam': ['내가 자리를 받은 팀 지식이다. 순서 · 메뉴에서 빼기는 나에게만 걸린다. 줄을 누르면 지식 상세', ''],
  'side.noKn': ['총괄 관리자가 자리를 준다', ''],
  'kn.empty': ['총괄 관리자나 그 지식의 지식관리자가 자리(읽기 · 쓰기)를 주면 여기에 보인다. 자리 부탁 글을 복사해 보낸다', ''],
  'kn.hidden': ['옆 메뉴에 보이지 않을 뿐 지우지 않았다. [메뉴에 올리기] 로 다시 올린다', ''],
  'home.stale': ['180일 넘게 바뀌지 않은 문서다. 지금도 맞는지 본다', ''],
  'home.removed': ['지운 때의 글로 다시 세운다. 되살린 것도 이력에 남는다', ''],
  'items': ['항목 하나를 고르면 그 항목의 지금 글 · 지난 기록이 한 화면에 모인다', ''],
  'hist': ['고른 지식에서 저장 · 수집 · 들이기 · 공유로 바뀐 것(오른쪽 위에서 「모든 지식」). 값이 바뀐 줄은 맨 위 「값 바뀜」(모든 지식) · 되돌릴 수 있는 줄만 [되돌리기] · 나에게 온 줄은 7일 둔다', ''],
  'imp': ['들여오는 일은 수집 › 검토 › 짓기 › 넣기 차례로 돈다. 줄을 고르면 흐름과 터미널이 보인다', ''],
  'imp.req': ['더하면 그 지식의 가져올 곳이 된다. 거절 까닭은 부탁한 사람에게 간다', ''],
  'imp.auto': ['정한 때마다 바뀐 것만 수집 › 검토 › 짓기 › 넣기. 바뀐 줄은 이력에 · 한꺼번에 크게 바뀌면 쓰지 않고 멈춘다(진행의 「크게 바뀜」)', ''],
  'imp.files': ['md · txt · csv · html · json · docx · pptx · xlsx · hwpx · pdf · hwp 는 글로 바꿔 들이고 원본은 첨부로. 파일마다 Claude Code 가 갈래 · 주제 문서의 항목으로 넣는다 · 안 되면 규칙으로 · 파일마다 글 20만 자까지', ''],
  'imp.filesTeam': ['md · txt · csv · html · json · docx · pptx · xlsx · hwpx · pdf · hwp 는 글로 바꾸고 파일마다 팀 일꾼이 기록과 문서를 한 번에 짓는다 · 글 20만 자까지. 많거나 글이 없는 pdf(스캔)는 Claude Code 에서 대량 넣기(설정 › 에이전트 설치)', ''],
  'imp.ahead': ['일 줄은 이 서버 하나라 다른 지식의 일이 앞에 있으면 기다린다. 줄 멈춤 · 동시에 도는 수도 모든 지식에 걸린다', ''],
  // 점검(메뉴 개편 6-2 · 저장 승인 P10) — 탭 머리 · 점검 줄 묶음 · 지표
  'chk': ['점검: 기록 · 장부 · 문서가 어긋난 곳 · 지표: 저장이 어떻게 들어갔는지 잰 값', '/manual/지식관리자.html#check'],
  'mt': ['할 일 목록이 아니다. 새로 생긴 것 · 받아들인 경고 · 무인 값 경고 · 규칙 길 · FIX · 다시 제안을 기간으로 센다. 줄의 [보기] 로 그 기록을 연다', '/manual/지식관리자.html#metrics'],
  'chk.rec': ['항목 없음: 건드린 항목이 없는 기록 · 장부 밖: 항목 장부에 없는 항목을 단 기록 · 폐기 항목: 폐기된 항목을 단 안 넣은 기록', ''],
  'chk.name': ['잃은 항목: 문서에 머리가 없는 항목 · 빈칸 값: 값에 빈칸이 든 옛 항목', ''],
  'chk.sec': ['장부에 없는 항목: 항목 장부에 오르지 않은 머리 · 깨진 머리: 머리 꼴이 깨진 항목 · 깨진 링크: 없는 문서 · 항목을 가리키는 링크', ''],
  'chk.word': ['별칭 겹침: 별칭이 둘 이상의 항목에 겹친다 · 같은 라벨: 라벨이 같은 항목이 둘 이상(알림)', ''],
  'job.ctl': ['잠깐 멈춤은 지금 단계를 마치고 서고, [이어서] 로 잇는다. 그만두기는 바로 끝내며 이어 할 수 없다', ''],
  // 저장 확인 창(저장 승인 P5)
  'sv': ['저장 제안이다. 아직 쓰지 않았다. [넣기] 를 누르면 이대로 기록과 문서에 한 번에 들어간다', ''],
  'sv.warn': ['[넣기] 를 누르면 경고를 받아들이고 그대로 남긴다(기록의 받아들인 경고). 고치려면 취소하고 글을 고친다', ''],
  'send.to': ['정하면 이 개인 지식에서 보내는 것은 모두 그곳으로만 간다. 바꾸려면 새 이름을 그대로 친다', ''],
  'send': ['내 개인 지식의 기록 · 문서를 묶인 팀 지식으로 보낸다. 받는 쪽 작성기준으로 지어, 받는 쪽 저장 제안을 보고 보낸다', ''],
  'band.out': ['이 PC 밖으로 나가는 것은 지식백업 · Claude(들이기 · 문서 다듬기) · 공유다. 공유는 누를 때만 받는 팀 지식으로 간다', ''],
  'acc': ['자리는 받은 것 가운데 가장 높은 것 하나다. 쓰기는 저장 검사를 넘으면 바로 문서에 들어가고, 없음이면 이 지식이 보이지 않는다', ''],
  'mine.pw': ['이 브라우저는 그대로 이어진다. 다른 곳은 다시 들어가고, 기기 열쇠는 그대로다', ''],
  // 새 지식 창
  'add.team': ['팀 지식 폴더에 팀 지식으로 선다. 처음에는 나(주인)와 총괄 관리자만 보고, 지식 상세 › 권한에서 자리를 준다', ''],
  'add.local': ['지식 폴더 안에 선다. 나만 보고, 새 지식은 메뉴 맨 아래에 들어온다', ''],
  // 들어가기
  'gate.pc': ['이 화면은 개인 프로그램이 여는 한 번용 주소로 들어온다. 아이디 · 비밀번호는 없다', ''],
  'gate.login': ['한 번 들어오면 쓰는 동안 이어진다. 12시간 쉬거나 7일이 지나면 다시 들어간다', ''],
  'gate.legacy': ['붙여 넣으면 곧바로 비밀번호를 정한다. 그 뒤로는 아이디 · 비밀번호로 들어온다', ''],
  'gate.done': ['작업 폴더의 Claude Code 에 팀 지식을 붙이려면 설정 › 에이전트 설치(개인 프로그램은 필요 없다). 개인 프로그램은 나중에 설정 › 에이전트 설치에서도 깐다', ''],
  'gate.first': ['처음 들어오기 링크다. 관리자가 보냈다', ''],
  'gate.reset': ['비밀번호 다시 정하기 링크다. 정하면 앞의 비밀번호는 이제 쓰지 않는다', ''],
  'gate.setup': ['이 주소에서 한 번만 묻는다. 브라우저가 제안하는 비밀번호를 쓰면 외울 것이 없다', ''],
  // 가져올 곳
  'src.when': ['바뀔 때는 5분마다 보고 바뀐 것만 가져온다', ''],
  'src.whenDocs': ['폴더는 실시간으로도 지켜본다. 정한 때는 놓친 것을 잡는 때고, 바뀔 때는 5분마다 보고 바뀐 것만 가져온다', ''],
  'src.intoCode': ['코드 바뀜 기록은 묶음마다 하나다. 걸린 항목 글은 들이기가 맞춘다', ''],
  'src.intoDocs': ['지식 안 이 이름의 폴더로 문서가 선다. 바꾸면 처음부터 다시 가져온다', ''],
  'src.intoDb': ['테이블마다 이 문서의 항목이 된다. 바꾸면 처음부터 다시 가져온다', ''],
  'sf.whatCode': ['새 묶음마다 바뀐 코드로 기록 하나를 남기고 걸린 항목 글을 맞춘다. 값이 바뀌면 노란 줄로 보이고 되돌릴 수 있다', ''],
  'sf.whatDocs': ['바뀐 파일만 다시 가져오고 원본은 첨부로 둔다. 원본에서 지우면 「원본에 없다」 로 남는다', ''],
  'sf.intoCode': ['기록은 이 지식에 남는다. 항목 장부의 항목이 걸리면 그 항목으로 들인다', ''],
  'sf.intoDocs': ['파일마다 기록으로 들고 갈래 · 주제 문서의 항목으로 넣는다(파일 이름 문서를 세우지 않는다). 이 이름은 기록의 출처다', ''],
  'sf.intoDb': ['문서가 없으면 새로 선다. 표는 그 문서 안 「저절로 채우는 표」 상자로 들어간다', ''],
}
// name = 붙은 이름(제목 · 칸 이름) — 화면 읽기 이름 「<name> 도움말」 · 표에 없는 id 는 그리지 않는다
const tipb = (id, name) => TIPS[id] ? `<button type="button" class="tipb" data-a="tip" data-v="${esc(id)}" data-t="tip-${esc(id)}" data-n="${esc(name || '')}" aria-label="${esc(name || '')} 도움말" aria-expanded="false">!</button>` : ''
const tipSeen = (b) => b.getClientRects().length && (typeof b.checkVisibility !== 'function' || b.checkVisibility({ visibilityProperty: true }))
const tipBtn = () => S.tip ? [...document.querySelectorAll('[data-a=tip]')].find((b) => b.dataset.v === S.tip && tipSeen(b)) || null : null
// 그린다 — 다시 그린 뒤(draw)에도 부른다: 단추가 그대로 있으면 툴팁도 다시 단다
function tipPaint(say) {
  const old = document.getElementById('tipPop')
  if (old) old.remove()
  const b = tipBtn()
  if (S.tip && !b) S.tip = null
  for (const x of document.querySelectorAll('.tipb')) {
    const on = x === b
    x.setAttribute('aria-expanded', String(on))
    if (on) x.setAttribute('aria-controls', 'tipPop'); else x.removeAttribute('aria-controls')
    x.removeAttribute('aria-describedby')
  }
  if (!b) return
  const [tx, man] = TIPS[S.tip]
  const el = document.createElement('div')
  el.className = 'pop tipp'
  el.id = 'tipPop'
  el.dataset.t = 'tipPop'
  if (man) { el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `${b.dataset.n} 도움말`) }
  else { el.setAttribute('role', 'tooltip'); b.setAttribute('aria-describedby', 'tipPop') }
  el.innerHTML = `<p>${esc(tx)}</p>${man ? `<a class="lk" data-t="tipMan" href="${esc(man)}" target="_blank" rel="noopener">설명서</a>` : ''}`
  b.insertAdjacentElement('afterend', el)
  if (say && !man) { let h = document.getElementById('srTip'); if (!h) { h = document.createElement('div'); h.id = 'srTip'; h.className = 'sr-only'; h.setAttribute('role', 'status'); document.body.appendChild(h) } h.textContent = ''; setTimeout(() => { h.textContent = tx }, 50) }
  placeTip()
}
function placeTip() {
  const el = document.getElementById('tipPop'), b = tipBtn()
  if (!el || !b) return
  const r = b.getBoundingClientRect(), box = b.closest('.main,.asc,.mb,.pal,.side')
  const v = box ? box.getBoundingClientRect() : { top: 0, bottom: innerHeight }
  if (r.bottom < Math.max(0, v.top) || r.top > Math.min(innerHeight, v.bottom)) { tipShut(false); return } // 단추가 보이는 자리(스크롤 상자 · 화면) 밖으로 나가면 닫는다
  const w = el.offsetWidth, h = el.offsetHeight
  const x = Math.min(Math.max(8, r.left - 12), innerWidth - w - 8)
  let y = r.bottom + 6
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6)
  el.style.left = Math.max(8, x) + 'px'
  el.style.top = y + 'px'
}
function tipShut(back) { const b = tipBtn(); S.tip = null; tipPaint(); if (back && b && b.isConnected) b.focus() }
document.addEventListener('pointerdown', (ev) => { if (S.tip && ev.target.closest && !ev.target.closest('#tipPop,[data-a=tip]')) tipShut(false) }, true)
document.addEventListener('focusin', (ev) => { if (S.tip && ev.target.closest && !ev.target.closest('#tipPop') && ev.target !== tipBtn()) tipShut(false) })
document.addEventListener('scroll', () => { if (S.tip) placeTip() }, true)
window.addEventListener('resize', () => { if (S.tip) placeTip() })
// 열린 메뉴의 항목 — 맨 위 층 .pop 또는 단추 안에 그린 .menu · .kmenu
const menuItems = () => { const b = $('#app .pop') || $(`#app [data-m="${CSS.escape(S.menu || '')}"] .menu`) || $('#app .kmenu'); return b ? [...b.querySelectorAll('[data-a]')].filter((x) => x.getClientRects().length) : [] }
// 메뉴를 닫았다 — 초점이 메뉴 안(이제 없다)이나 body 면 연 단추로 돌려준다
function menuBack(k) {
  const a = document.activeElement
  if (a && a !== document.body && app.contains(a)) return
  const b = k && $(`#app [data-m="${CSS.escape(k)}"]`)
  if (b) b.focus({ preventScroll: true })
}
// 공통 확인 창 — 브라우저 confirm() · prompt() 대신(컨벤션 10절). 돌려주는 것: 고른 단추의 값 · 취소 · Esc · 바깥 누름은 false
//   ask({ t: 제목, d: 설명, ok: '지우기', danger: true }) → true / false
//   ask({ t, d, btns: [['drop', '사본도 지우기', 'danger'], ['keep', '사본은 남기기', 'pri']] }) → 'drop' / 'keep' / false(취소)
//   ask({ t, d, input: { label, value } }) → 쓴 글 / null(취소)
// 칩 갈래(컨벤션 5절) — 상태 뜻 → 색 하나. 칩은 이 표로만 그린다(같은 상태가 화면마다 다른 색이 되지 않게 · UX T1-04)
const CHIP = { ok: 'c-ok', new: 'c-acc', chg: 'c-acc', now: 'c-acc', same: 'c-mute', rest: 'c-mute', stop: 'c-warn', held: 'c-warn', fail: 'c-danger', run: 'c-pend', wait: 'c-pend' }
const chipOf = (st, text, attrs = '') => `<span class="chip ${CHIP[st] || 'c-mute'}"${attrs}>${text}</span>`
function ask(o) {
  return new Promise((res) => { if (S.ask) S.ask.res(S.ask.input || S.ask.select ? null : false); S.ask = { ...o, input: o.input && { ...o.input }, res }; render() })
}
function askHtml() {
  const a = S.ask
  const btns = a.btns || [[true, a.ok || '확인', a.danger ? 'danger' : 'pri']]
  return `<div class="scrim fix" data-a="askNo" data-self="1"><div class="modal w420" data-t="askWin"><div class="mh">${esc(a.t)}<button type="button" class="x" data-a="askNo" title="닫기" aria-label="닫기">×</button></div><div class="mb">${a.d ? `<p class="ask-d" data-t="askText">${esc(a.d)}</p>` : ''}${a.input ? `<div class="field"><label for="askIn">${esc(a.input.label)}</label><input class="inp" id="askIn" data-in="askIn" data-t="askIn" value="${esc(a.input.value || '')}" autocomplete="off"></div>` : ''}${a.select ? `<div class="field"><label for="askSel">${esc(a.select.label)}</label><select class="inp" id="askSel" data-t="askSel">${a.select.options.map(([v, l]) => `<option value="${esc(v)}"${v === a.select.value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>` : ''}</div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="askNo" data-t="askNo">취소</button>${btns.map(([, l, c], i) => `<button type="button" class="btn ${c || ''}" data-a="askOk" data-i="${i}" data-t="askOk${i || ''}">${esc(l)}</button>`).join('')}</span></div></div></div>`
}
const ask1 = (t, ok, danger, d) => ask({ t, ok, danger, d })
function askDone(i) {
  const a = S.ask
  if (!a) return
  const v = i == null ? (a.input || a.select ? null : false) : a.input ? String(($('#askIn') || {}).value || '') : a.select ? String(($('#askSel') || {}).value ?? '') : (a.btns || [[true]])[i][0]
  S.ask = null
  render()
  a.res(v)
}
// ── 화면 자리(컨벤션 11-2) — 옆 메뉴 · 오른쪽 칸 접기(레일) · 너비 · 문서 폭 · 오른쪽 묶음 펼침. 이 브라우저에만 남긴다 ──
const UI_KEY = 'kmd.ui'
const SW = [200, 420, 248], AW = [260, 560, 300] // 최소 · 최대 · 기본
const UI = (() => {
  const d = { sw: SW[2], aw: AW[2], sideRail: false, asideRail: false, wide: false, ag: {}, dirs: {}, stab: {} }
  try { return { ...d, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') } } catch (e) { console.warn('화면 자리 읽기 못 함', e); return d }
})()
// 화면 밝기(UX T1-32) — UI.theme: '' 시스템 따라 · 'light' · 'dark'(이 브라우저에만)
function applyTheme() { const t = UI.theme === 'light' || UI.theme === 'dark' ? UI.theme : ''; if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; GTOK = null }

function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(UI)) } catch (e) { console.warn('화면 자리 남기기 못 함', e) } }
function placeUi() {
  app.style.setProperty('--sw', UI.sw + 'px')
  app.style.setProperty('--aw', UI.aw + 'px')
  app.classList.toggle('side-rail', !!UI.sideRail)
  app.classList.toggle('aside-rail', !!UI.asideRail)
}
function setW(which, w) {
  const [lo, hi] = which === 'side' ? SW : AW
  const v = Math.round(Math.min(hi, Math.max(lo, w)))
  if (which === 'side') UI.sw = v
  else UI.aw = v
  placeUi()
  const g = document.querySelector(`#app [data-grip=${which}]`)
  if (g) g.setAttribute('aria-valuenow', v)
}
// 끌기 · 두 번 누르면 처음 너비 · 끄는 동안은 다시 그리지 않고 CSS 변수만 바꾼다
let GR = null
document.addEventListener('pointerdown', (ev) => {
  const g = ev.target.closest && ev.target.closest('[data-grip]')
  if (g) {
    ev.preventDefault()
    GR = { which: g.dataset.grip, x: ev.clientX, w: g.dataset.grip === 'side' ? UI.sw : UI.aw }
    g.classList.add('drag')
    document.body.classList.add('resizing')
    return
  }
  // 그래프 팝업 — 바깥을 누르면 접는다
  if (S.gPop && !(ev.target.closest && ev.target.closest('[data-t=gDock]'))) { S.gPop = false; render() }
})
document.addEventListener('pointermove', (ev) => { if (GR) setW(GR.which, GR.which === 'side' ? GR.w + (ev.clientX - GR.x) : GR.w - (ev.clientX - GR.x)) })
document.addEventListener('pointerup', () => {
  if (!GR) return
  GR = null
  for (const g of document.querySelectorAll('[data-grip].drag')) g.classList.remove('drag')
  document.body.classList.remove('resizing')
  saveUi()
})
document.addEventListener('dblclick', (ev) => { const g = ev.target.closest && ev.target.closest('[data-grip]'); if (g) { setW(g.dataset.grip, g.dataset.grip === 'side' ? SW[2] : AW[2]); saveUi() } })
const gripHtml = (which) => {
  const [lo, hi] = which === 'side' ? SW : AW
  return `<div class="grip" data-grip="${which}" data-t="${which}Grip" role="separator" tabindex="0" aria-orientation="vertical" aria-label="${which === 'side' ? '옆 메뉴' : '오른쪽 칸'} 너비: ← → 로 바꾼다 · 두 번 누르면 처음 너비" aria-valuemin="${lo}" aria-valuemax="${hi}" aria-valuenow="${which === 'side' ? UI.sw : UI.aw}"></div>`
}
function draw() {
  if (!S.me) { app.innerHTML = `<div class="col"><div class="main">${S.err ? `<div class="callout danger err" data-t="bootErr">${sayErr(S.err)}<b>${esc(S.err)}</b><button type="button" class="btn sm retry" data-a="retryBoot" data-t="retry">다시 읽기</button></div>` : loadingHtml}</div></div>`; return }
  hidePv()
  S._pop = null
  let scr
  try { scr = gated() ? gateView() : viewOf(S.route.scr) } catch (e) { console.error(e); scr = { main: drawErrHtml(e) } }
  const center = scr.tabs
    ? `<div class="center">${tabbarHtml()}<div class="panes"><div class="main${scr.full ? ' full' : ''}${UI.wide ? ' wide' : ''}" data-t="main">${scr.main}</div>${scr.right != null ? `<div class="main rp" data-t="rightPane">${scr.right}</div>` : ''}</div></div>`
    : `<div class="main" data-t="main">${scr.main}</div>`
  // 다시 그려도 보던 자리 그대로 — 같은 화면 · 같은 탭이면 가운데 · 옆 목록 · 옆 칸의 스크롤을 지킨다(go 로 다른 화면에 가면 맨 위)
  const view = `${S.route.scr}|${S.route.kn}|${S.active || ''}|${S.split || ''}`
  const lpView = `${gated() ? '' : defaultKn()}|${VIEWS3.includes(S.route.scr) ? S.route.scr : S.ktab || 'docs'}`
  const keep = ['.main[data-t=main]', '[data-t=rightPane]', '[data-t=leftPane]', '[data-t=asideScroll]'].map((q) => { const el = app.querySelector(q); return el ? [q, el.scrollTop] : null }).filter((x) => x && (x[0] === '[data-t=leftPane]' ? S._lpView === lpView : S._view === view))
  const sameView = S._view === view
  // 초점 · 편집기 자리 — innerHTML 을 통째로 바꿔도 같은 요소(id 또는 data-t + 차례)로 되돌린다
  const fa = document.activeElement
  let refocus = null
  if (sameView && fa && fa !== document.body && app.contains(fa)) {
    const q = fa.id ? '#' + CSS.escape(fa.id) : fa.dataset && fa.dataset.t ? `[data-t="${CSS.escape(fa.dataset.t)}"]` : null
    if (q) refocus = [q, [...app.querySelectorAll(q)].indexOf(fa)]
  }
  const ta0 = $('#edTx')
  const edPos = ta0 ? { top: ta0.scrollTop, a: ta0.selectionStart, b: ta0.selectionEnd } : null
  S._view = view
  S._lpView = lpView
  S._hasAside = !!scr.aside
  app.innerHTML = sideHtml(scr.left) + `<div class="col">${hdrHtml(scr.crumb)}${gated() ? '' : bandHtml()}<div class="body">${center}${scr.aside ? `<div class="aside" data-t="aside"><button type="button" class="hb afold" data-a="asideRail" data-t="asideFold" aria-expanded="${!UI.asideRail}" title="${UI.asideRail ? '오른쪽 칸 펴기' : '오른쪽 칸 접기'} (Ctrl ])" aria-label="${UI.asideRail ? '오른쪽 칸 펴기' : '오른쪽 칸 접기'}">${svg(UI.asideRail ? 'sideL' : 'sideR')}</button><div class="asc" data-t="asideScroll">${scr.aside}</div>${gripHtml('aside')}</div>` : ''}</div>${statusHtml()}</div>${S.pal ? palHtml() : ''}${S.qo ? qoHtml() : ''}${S.cmd ? cmdHtml() : ''}${S.del ? delHtml() : ''}${S.addPop ? addPopHtml() : ''}${S.rsWin ? rsWinHtml() : ''}${S.devWin ? devWinHtml() : ''}${S.se && S.route.scr === 'import' ? srcModalHtml() : ''}${S.sfOpen && S.route.scr === 'import' ? sfModal() : ''}${S.paste && S.route.scr === 'import' ? pasteWinHtml() : ''}${S._pop ? `<div class="pop" data-t="pop" data-pop="${esc(S._pop.key)}">${S._pop.html}</div>` : ''}${S.off ? offHtml() : ''}${S.seatWin ? seatWinHtml() : ''}${S.claudeWin ? claudeWinHtml() : ''}${S.stopWin ? stopWinHtml() : ''}${S.sendWin && S.route.scr === 'send' ? sendWinHtml() : ''}${S.acc ? accHtml() : ''}${S.recFix ? recFixHtml() : ''}${S.sv ? svHtml() : ''}${S.past ? pastHtml() : ''}${S.sdw && S.route.scr === 'home' ? sdwHtml() : ''}${S.ask ? askHtml() : ''}${S.sudo ? sudoHtml() : ''}${S.keys ? keysHtml() : ''}`
  app.classList.toggle('side-open', !!S.sideOpen && !gated())
  app.classList.toggle('aside-open', !!S.asideOpen && !!scr.aside)
  placeUi()
  placePop()
  if (!sameView) S.tip = null
  for (const [q, top] of keep) { const el = app.querySelector(q); if (el) el.scrollTop = top }
  // 좁은 폭은 창 전체가 스크롤된다 — 같은 화면을 다시 그리는 동안 잠깐 짧아져(읽는 중) 맨 위로 밀리지 않게, 사람이 둔 자리로 되돌린다
  S._renderAt = performance.now()
  if (sameView && S._wantY && Math.abs(scrollY - S._wantY) > 2) scrollTo(0, S._wantY)
  if (!sameView) { S._wantY = 0; termUp.clear() }
  if (S.tip) tipPaint() // 스크롤을 되돌린 뒤에 잰다(먼저 재면 맨 위 자리로 재어 닫히거나 한 번 튄다)
  if (gated()) { const g = $('[data-focus]'); if (g && document.activeElement !== g) g.focus(); return }
  const fi = $('#palIn') || $('#qoIn') || $('#cmdIn')
  if (fi && document.activeElement !== fi) { fi.focus(); fi.setSelectionRange(fi.value.length, fi.value.length) }
  // 고칠 칸이 아직 읽는 중이면(편집기 · Q84) 그려질 때까지 기다린다
  if (S.route.scr === 'graph') gStart()
  if (S._focus) { const el = document.getElementById(S._focus); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length) } catch {} S._focus = null } else if (S._focus !== 'edTx' || !S.edit) S._focus = null }
  const mainEl = app.querySelector('.main[data-t=main]')
  if (mainEl) { mainEl.id = 'main'; mainEl.setAttribute('role', 'main'); if (!mainEl.hasAttribute('tabindex')) mainEl.tabIndex = -1 }
  if (!document.querySelector('.skip')) document.body.insertAdjacentHTML('afterbegin', '<a class="skip" href="#main">본문으로 건너뛰기</a>')
  const ttl = [String(scr.crumb || '').split(' › ').pop(), S.route.kn && S.route.kn !== '*' && KN(S.route.kn) ? KN(S.route.kn).name : '', isTeam() ? 'kmd 팀' : 'kmd'].filter(Boolean).join(' · ')
  if (S.me && !anon() && document.title !== ttl) document.title = ttl
  { const on = app.querySelector('.tabbar .on, [data-t=tabbar] .tab.on'), bar = on && on.parentElement; if (on && bar && bar.scrollWidth > bar.clientWidth) { const l = on.offsetLeft - bar.offsetLeft; if (l < bar.scrollLeft || l + on.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = Math.max(0, l - 24) } }
  if (!sameView && (document.activeElement === document.body || !document.activeElement) && mainEl && !S._focus && !$('#palIn,#qoIn,#cmdIn')) mainEl.focus({ preventScroll: true })
  if ($('#edTx')) edFit($('#edTx'))
  if (edPos) { const ta = $('#edTx'); if (ta) { ta.scrollTop = edPos.top; try { ta.setSelectionRange(edPos.a, edPos.b) } catch {} } }
  if (refocus && (document.activeElement === document.body || !document.activeElement)) { const el = app.querySelectorAll(refocus[0])[Math.max(0, refocus[1])]; if (el) el.focus({ preventScroll: true }) }
  fillAtts()
  // 터미널 — 새 줄이 오면 아래로 · 사람이 위로 올려 보고 있으면 그 자리 그대로(컨벤션 7절)
  ;[...app.querySelectorAll('.term')].forEach((t, i) => { const up = termUp.get(i); t.scrollTop = up != null ? up : t.scrollHeight })
  if (S._lit) {
    let el = $('#app .main[data-t=main] .lit') || $('#app .main[data-t=main] h2.flash')
    const sub = el && el.tagName === 'H2' && S._litSub && S._litSub.h === el.dataset.sec ? subHead(el, S._litSub.sub) : null
    if (sub) { el.classList.remove('flash'); sub.classList.remove('flash'); void sub.offsetWidth; sub.classList.add('flash'); el = sub }
    if (el) { S._lit = false; S._litSub = null; setTimeout(() => el.scrollIntoView({ block: 'center' }), 30) }
  }
  flashSel()
}
// 「지금 하는 일」 에서 온 줄 — 그 줄이 그려지면 가운데로 스크롤하고 잠깐 빛낸다(.flash · 움직임 줄이기면 빛내지 않는다)
//   좁은 폭(600 이하)은 현황판 · 정리 칸 아래에 일 줄이 있어 스크롤하지 않으면 보이지 않는다 — 그 줄(없으면 일 줄 영역 머리)까지 꼭 간다
//   스크롤은 30ms 뒤 — 그사이 다시 그렸으면 옛 요소는 떨어져 나갔다(그러면 아무 데도 가지 않았다 · 188 시험 T12): 그때 다시 찾는다
const FLASH_Q = {
  imp: ['#impBody .qrow.sel', '#impBody'],

}
// ## 머리(h2) 아래 · 다음 ## 앞에서 글이 sub 와 같은 ### (h3) — 빈칸 · NFC 를 맞춰 본다
function subHead(h2, sub) {
  const nm = (x) => String(x || '').normalize('NFC').replace(/\s+/g, ' ').trim()
  const want = nm(sub)
  // 옛 ### 소제목 · 수준 표시 1 ~ 3 줄(작성기준 5-1 · data-lv 는 표시를 뗀 글)
  const txt = (x) => nm(x.dataset && x.dataset.lv != null ? x.dataset.lv : x.textContent)
  for (let n = h2.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) {
    const hs = n.tagName === 'H3' || (n.matches && n.matches('.lv[data-lv]')) ? [n] : [...n.querySelectorAll('h3, .lv[data-lv]')]
    const hit = hs.find((x) => txt(x) === want)
    if (hit) return hit
  }
  return null
}
function flashSel() {
  const kind = S._flashSel
  if (!kind || !FLASH_Q[kind]) return
  const [rowQ, headQ] = FLASH_Q[kind]
  const go = (q, flash) => setTimeout(() => {
    const el = $(q)
    if (!el) return
    if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }
    el.scrollIntoView({ block: 'center' })
    S._wantY = scrollY
  }, 30)
  if ($(rowQ)) { S._flashSel = null; S._flashHead = false; $(rowQ).classList.add('flash'); go(rowQ, true); return }
  // 그 줄이 아직 없다 — 영역 머리까지는 먼저 간다(한 번) · 받는 동안 잠깐 더 기다리고 푼다(나중에 다른 줄이 빛나지 않게)
  if ($(headQ) && !S._flashHead) { S._flashHead = true; go(headQ, false) }
  if (Date.now() - (S._flashAt || 0) > 5000) { S._flashSel = null; S._flashHead = false }
}
function placePop() {
  const p = $('#app .pop')
  if (!p) return
  const a = [...document.querySelectorAll('[data-m]')].find((x) => x.dataset.m === p.dataset.pop && x.getClientRects().length) // 보이는 단추(머리 줄 · 옆 메뉴에 같은 것이 있으면)
  if (!a) { p.remove(); return }
  const r = a.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight
  let x = r.right - w
  if (x < 8) x = Math.min(r.left, innerWidth - w - 8)
  let y = r.bottom + 4
  if (y + h > innerHeight - 8 && r.top - h - 4 > 8) y = r.top - h - 4
  p.style.left = Math.max(8, x) + 'px'
  p.style.top = Math.max(8, y) + 'px'
}
function viewOf(s) {
  if (s === 'tidy') s = isTeam() ? 'held' : 'home' // 옛 정리 화면(S13 에 걷었다) — 팀은 점검으로 · 개인은 지식관리
  // 점검(안쪽 이름 held)은 개인 화면에도 있다(점검 · 지표 · P-D43 · 저장 승인 P10)
  if (isTeam() && s === 'send') s = 'home' // 지식 보내기는 개인 화면에서만
    const f0 = { home: viewHome, docs: viewDocsV, items: viewItems, graph: viewGraph, today: viewToday, log: viewToday, held: viewHeld, structure: viewStructure, import: viewImport, add: viewHome, send: viewSend, settings: viewSettings }[s]
  const v = f0 ? f0() : viewLater(s)
  return MGSCR.includes(s) && !gated() ? mgWrap(s, v) : v
}
// 설정 메뉴 표 하나 — 왼쪽 메뉴 · 페이지 제목 · 위치 줄 · 멈춤 줄 갈 곳이 모두 여기서 나온다(docs/품질개선/설정_화면_개선검토.html)
//   scr 가 있으면 따로 선 화면, 없으면 설정 페이지(route.page = id) · 보이기는 서버 판정과 같은 자리로만(판정은 서버, 화면은 숨기기만)
//   이력은 설정 밖(옆 메뉴 지식 메뉴 「이력」)
const MGSCR = ['settings', 'home']
const HISTSCR = ['today', 'log']
// 옛 화면 이름 → 새 자리(go · openHash 가 routeFix 한곳에서 바꾼다 · 메뉴 개편 N6)
//   옛 화면: members · people → 지식관리 › 사람 · admin → 설정 › 운영 · install → 설정 › 개인 프로그램 설치(개인은 에이전트 설치)
//   옛 설정 페이지: pc(이 PC) → 지식백업 · kns(팀 지식) → 지식관리 › 모든 지식 · people(사람) → 지식관리 › 사람
const SET_ALIAS = { members: 'people', admin: 'check', install: 'install' }
function routeFix(rt) {
  let r = { ...rt }
  if (r.scr === 'members' || r.scr === 'people') r = { scr: 'home', kn: '*', page: 'people' }
  else if (SET_ALIAS[r.scr]) r = { ...r, scr: 'settings', page: SET_ALIAS[r.scr] }
  if (r.scr === 'settings') {
    if (r.page === 'kns') r = { scr: 'home', kn: '*', page: 'all' }
    else if (r.page === 'people') r = { scr: 'home', kn: '*', page: 'people' }
    else if (r.page === 'pc') r.page = 'backup'
    else if (r.page === 'install' && !isTeam()) r.page = 'agent'
  }
  // 공유는 개인 화면만 — 팀 주소 #/send · #/k/<지식>/share 는 지식관리로
  if (r.scr === 'send' && isTeam()) r = { scr: 'home', kn: '*' }
  if (r.scr !== 'settings' && r.scr !== 'home') delete r.page
  if (r.scr !== 'home' || (r.page && r.page !== 'all')) { delete r.mk; delete r.mt }
  return r
}
//   설정(메뉴 개편 5-2 · 6-2) — 개인: 지식백업 · Claude 연결 · 에이전트 설치 · 팀 연결 / 팀: 서버 정보 · 에이전트 설치 · 개인 프로그램 설치 · 팀 일꾼 · 운영
//   팀 일꾼 · 운영은 총괄 관리자만(서버 /api/admin/* 도 총괄 관리자만) · 설정을 열면 첫 페이지
function setMenu() {
  const boss = !!(S.me && S.me.admin)
  if (!isTeam()) return [{ id: 'backup', l: '지식백업' }, { id: 'claude', l: 'Claude 연결' }, { id: 'agent', l: '에이전트 설치' }, { id: 'team', l: '팀 연결' }]
  return [
    { id: 'mine', l: '서버 정보' },
    { id: 'agent', l: '에이전트 설치' },
    { id: 'install', l: '개인 프로그램 설치' },
    boss && { id: 'server', l: '팀 일꾼' },
    boss && { id: 'check', l: '운영' },
  ].filter(Boolean)
}
// 작업 화면의 갈 곳 글(멈춤 줄 · 안내 · openSet) — 옆 메뉴는 kmItems · 구조는 문서 나무 머리 [구조]
//   생성 — 쓰기 자리가 있는 팀 지식이 하나라도 있으면(파일 넣기 · S-D34) · 점검 — 점검을 여는 지식이 하나라도(ckOk) · 구조 — 지식관리자 자리(작성기준 6-1절)
function workMenu() {
  if (!isTeam()) return [{ id: 'held', scr: 'held', l: '점검' }, { id: 'import', scr: 'import', l: '생성' }, { id: 'structure', scr: 'structure', l: '문서 › 구조' }, { id: 'send', scr: 'send', l: '공유' }]
  const kadm = !!(S.me && S.me.admin) || anyAdm()
  const imp = kadm || (S.kns || []).some((x) => !isPersonal(x) && !x.hidden && lvOf(x) && lvOf(x) !== 'read')
  const ck = kadm || (S.kns || []).some((x) => !x.hidden && ckOk(x))
  return [imp && { id: 'import', scr: 'import', l: '생성' }, ck && { id: 'held', scr: 'held', l: '점검' }, kadm && { id: 'structure', scr: 'structure', l: '문서 › 구조' }].filter(Boolean)
}
// 지식 메뉴(옆 메뉴 층 2 · 메뉴 개편 5 · 6 · 7절 · 저장 승인 P10) — 고른 지식에 딸린 일 · 위에서 고른 지식으로 연다
//   개인: 점검 · 생성 · 공유 · 이력 / 팀: 점검 · 생성 · 이력(문서는 버튼 없이 아래 나무가 늘 보인다) — 점검은 ckOk · 생성은 고른 지식에 쓰기 자리부터(6-4 · 판정은 서버 · 화면은 숨기기만) · 배지 없음(P-D28)
const DOCSCR = ['docs', 'items', 'graph', 'structure']
function kmItems() {
  if (!isTeam()) return [{ id: 'held', scr: 'held', l: '점검', ic: 'check' }, { id: 'import', scr: 'import', l: '생성', ic: 'gen' }, { id: 'send', scr: 'send', l: '공유', ic: 'share' }, { id: 'history', scr: 'today', l: '이력', ic: 'hour' }]
  const n = KN(defaultKn())
  const w = n ? lvOf(n) === 'write' || lvOf(n) === 'admin' : !!(S.me && S.me.admin)
  const ck = n ? ckOk(n) : !!(S.me && S.me.admin)
  return [ck && { id: 'held', scr: 'held', l: '점검', ic: 'check' }, w && { id: 'import', scr: 'import', l: '생성', ic: 'gen' }, { id: 'history', scr: 'today', l: '이력', ic: 'hour' }].filter(Boolean)
}
// 점검 메뉴를 여나(저장 승인 P10 · P11 · P-D28) — 개인은 주인(내 개인 지식) · 팀은 그 지식의 지식관리자(점검 · 지표)
const ckOk = (x) => !!x && (isTeam() ? !isPersonal(x) && lvOf(x) === 'admin' : isPersonal(x))
const KM_SCR = ['import', 'held', 'send', 'today', 'log', 'structure']
// sub — 화면 안 탭(생성 manual · auto / 점검 check · metrics) · 주지 않으면 그대로
function kmGo(scr, k, sub) {
  const x = sub !== undefined ? { sub } : {}
  if (!k || !KN(k)) return go({ scr, ...x })
  if (k !== S.route.kn) S.logKn = '' // 다른 지식 — 그 지식의 처음 값으로
  if (scr === 'docs') return go({ scr: VIEWS3.includes(S.ktab) ? S.ktab : 'docs', kn: k })
  go({ scr, kn: k, ...x })
}
const kmOn = (id) => { const s = S.route.scr; return id === 'docs' ? DOCSCR.includes(s) : id === 'history' ? HISTSCR.includes(s) : s === id }
// 문서 › 구조 를 여나(나무 머리 [구조]) — 개인은 주인 · 팀은 그 지식의 지식관리자 · 총괄 관리자
const canStruct = (k) => !!k && !!KN(k) && admKn(k)
const setPages = () => setMenu().filter((x) => !x.scr)
// 지금 설정 페이지 — 메뉴에 없는 이름이면 보이는 첫 페이지
const setPage = () => { const ps = setPages(); return ps.find((x) => x.id === S.route.page) || ps[0] }
// 메뉴 이름으로 쓴 갈 곳 글 — 멈춤 줄 · 안내 글이 메뉴 이름을 따로 적지 않게
const setWhere = (id) => { const x = [...setMenu(), ...workMenu()].find((y) => y.id === id); return !x ? '' : x.scr ? x.l : '설정 › ' + x.l }
function openSet(id) {
  S.menu = null
  const x = [...setMenu(), ...workMenu()].find((y) => y.id === id)
  if (x && x.scr) go({ scr: x.scr })
  else go({ scr: 'settings', page: id || undefined })
}
// 설정을 연다 — 보이는 첫 설정 페이지(옆 메뉴 · 레일 · 내 메뉴 · 명령 창 모두 이 길)
const openSettings = () => openSet(null)
// 본문 왼쪽 메뉴 — 설정(setMenu) · 지식관리(mgMenu) 같은 꼴 · 위치 줄은 「설정 › …」 · 「지식관리 › …」
function mgWrap(scr, v) {
  const mg = scr === 'home', name = mg ? '지식관리' : '설정'
  const items = mg ? mgMenu() : setMenu(), cur = mg ? mgPage().id : (setPage() || {}).id
  const nav = `<nav class="mgnav" data-t="mgNav" data-area="${mg ? 'manage' : setArea()}" aria-label="${name}"><div class="mgt">${name}</div>${items.map((x) => `<button type="button" class="mgi${x.id === cur ? ' on' : ''}" data-a="${mg ? 'mgGo' : 'openSet'}" data-v="${x.id}" data-t="${mg ? 'mgp' : 'mg'}-${x.id}"${x.id === cur ? ' aria-current="page"' : ''}>${esc(x.l)}</button>`).join('')}</nav>`
  return { ...v, crumb: name + ' › ' + v.crumb, main: `<div class="mgwrap">${nav}<div class="mgbody">${v.main}</div></div>` }
}
// 옆 메뉴(메뉴 개편 N4 · docs/품질개선/KMD_메뉴개편_설계.md 7절 · 컨벤션 5절) — 위에서 아래로 네 층
//   1 지식 고르기(.sb-top) · 지금 하는 일 점 · 접기 — 고르기 끝 줄 「모든 지식」 은 지식관리로 가는 지름길(고른 지식은 그대로)
//   2 지식 메뉴(.kmn > button.kmi) — 개인 점검 · 생성 · 공유 · 이력 / 팀 점검 · 생성 · 이력(kmItems) · 배지는 이력 값 바뀜만(점검 배지 없음 · P-D28)
//   3 고른 지식이 있으면 늘(어느 화면이든): 보기 탭 한 줄(.ktabs 목차 · 항목 · 기록 · 그래프) · 찾기 + 도구(나무 머리 [구조]) · 목록
//   4 공통 메뉴(.sb-mg.nm2): 지식관리 · 설정(아이콘 + 이름)
//   접힌 레일은 같은 차례(지식 약자 · 층 2 · 선 · 층 4) · 들어온 사람은 머리 줄 오른쪽 동그라미(meHtml)
const VIEWS3 = ['docs', 'items', 'graph']
function sideList(vt, k) {
  if (!k || !KN(k)) return `<p class="muted small u-p3-4" data-t="sideNoKn">지식이 없다</p>`
  if (vt === 'items') return itemListHtml(k)
  if (vt === 'graph') return `<div class="muted small u-p3-4" data-t="graphHint">그래프는 가운데에 그린다. <button type="button" class="lk" data-a="view" data-v="graph">열기</button></div>`
  return treeHtml(k)
}
const VIEW_LABEL = { docs: '문서로 보기', items: '항목으로 보기', graph: '그래프로 보기' }
const KEYS = [['Ctrl K', '찾기 — 글 속 낱말까지'], ['Ctrl O', '빨리 열기 — 문서 · 항목 · 기록 이름으로'], ['Ctrl P', '명령 창'], ['Ctrl \\', '탭 둘을 나란히'], ['Ctrl [', '옆 메뉴 접기 · 펴기'], ['Ctrl ]', '오른쪽 칸 접기 · 펴기'], ['Alt ← · Alt →', '이전 · 다음 화면'], ['Ctrl S', '고치는 중 저장'], ['Esc', '창 · 고치기 닫기'], ['? · Ctrl /', '이 창']]
function keysHtml() {
  return `<div class="scrim fix" data-a="keysClose" data-self="1"><div class="modal w420" role="dialog" aria-modal="true" aria-label="단축키" data-t="keysWin"><div class="mh">단축키<button type="button" class="x" data-a="keysClose" title="닫기" aria-label="닫기">×</button></div><div class="mb"><table class="t"><tbody>${KEYS.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('')}</tbody></table></div><div class="mf"><span class="l">설명서 › 쓰는 사람에도 있다</span><span class="acts"><button type="button" class="btn ghost" data-a="keysClose" data-focus>닫기</button></span></div></div></div>`
}
// 보기 탭 넷 — 기록은 문서 보기 안의 기록 목록
const LTABS = [['docs', '목차', 'doc'], ['items', '항목', 'tag'], ['recs', '기록', 'rec'], ['graph', '그래프', 'graph']]
const ltabOf = (vt, k) => (vt === 'docs' && k && stabOf(k) === 'rec' ? 'recs' : vt)
// 탭의 수 — 이미 읽은 것만(수 때문에 따로 읽지 않는다)
function ltabN(v, k) {
  const tr = S.cache['tree:' + k], m = S.cache['model:' + k]
  if (v === 'docs') return tr && !tr.error ? tr.docs.length : ''
  if (v === 'recs') return tr && !tr.error ? tr.total ?? tr.records.length : ''
  if (v === 'items') return m && !m.error ? m.items.length : ''
  return ''
}
// 지식 메뉴 · 공통 메뉴 · 레일이 같이 쓰는 차례 { id, a(누르면), ic, l(이름), on, n(배지 수), nt(배지 이름), warn, dis }
function sideItems() {
  const r = S.route, team = isTeam(), k = defaultKn(), n = KN(k)
  const nCheck = histChecks(), nNew = !HISTSCR.includes(r.scr) ? histNew() : 0
  const km = kmItems().map((x) => {
    const b = x.id === 'history' ? { n: nCheck || nNew, nt: nCheck ? '값 바뀜' : '새 줄', warn: !!nCheck } : { n: 0 }
    return { ...x, ...b, a: `data-a="km" data-v="${x.id}"`, on: kmOn(x.id), dis: !n }
  })
  const cm = [
    { id: 'manage', a: 'data-a="mgAll"', ic: 'layers', l: '지식관리', on: r.scr === 'home' || r.scr === 'add' },
    { id: 'settings-' + (team ? 'team' : 'me'), a: 'data-a="setArea"', ic: 'gear', l: '설정', on: MGSCR.includes(r.scr) },
  ]
  return { km, cm }
}
const sideLab = (x) => x.l + (!x.n ? '' : ` · ${x.nt} ${x.n}`)
const sideBadge = (x) => (x.n && !x.dis ? `<span class="bd${x.bad ? '' : x.warn ? ' warn' : ''}" data-t="${x.warn ? 'histBadge' : 'histNew'}" aria-hidden="true">${x.n}</span>` : '')
function sideHtml(left) {
  const r = S.route, team = isTeam()
  if (anon()) return `<aside class="side dim"><div class="sb-top"><div class="logo${team ? '' : ' me'}">K</div><span class="brand">kmd</span></div></aside>`
  const k = defaultKn(), cur = k ? KN(k) : null
  const fold = `<button type="button" class="hb sfold" data-a="sideRail" data-t="sideFold" aria-expanded="${!UI.sideRail}" title="${UI.sideRail ? '옆 메뉴 펴기' : '옆 메뉴 접기'} (Ctrl [)" aria-label="${UI.sideRail ? '옆 메뉴 펴기' : '옆 메뉴 접기'}">${svg(UI.sideRail ? 'sideR' : 'sideL')}</button>`
  const { km, cm } = sideItems()
  const cur4 = (x) => (x.on ? ' aria-current="page"' : '')
  const dis = (x) => (x.dis ? ' aria-disabled="true"' : '')
  // 접힌 옆 메뉴(레일) — 편 메뉴와 같은 차례: 지식 약자 · 지식 메뉴 · 선 · 공통 메뉴
  const rb = (x) => `<button type="button" class="hb${x.on ? ' on' : ''}" ${x.a} data-t="rl-${x.id}" title="${esc(sideLab(x))}" aria-label="${esc(sideLab(x))}"${cur4(x)}${dis(x)}>${svg(x.ic)}${x.n && !x.dis ? `<i class="rdot${x.bad ? ' dan' : ''}"></i>` : ''}</button>`
  const kab = cur ? `<button type="button" class="hb kab" data-a="railKn" data-t="rl-kn" title="${esc(cur.name)}" aria-label="지식 고르기: ${esc(cur.name)}">${esc(cur.name.slice(0, 1))}</button>` : ''
  const rail = `<nav class="srail" data-t="sideRailNav" aria-label="옆 메뉴(접힘)">${fold}${kab}${km.map(rb).join('')}<span class="rsep" aria-hidden="true"></span>${cm.map(rb).join('')}</nav>`
  let h = `<aside class="side" aria-label="옆 메뉴">${rail}`
  // 1 지식 고르기 — 지식이 없으면 「지식이 없다」(만들 수 있는 사람은 [+ 새 지식]) · 팀에서 받은 지식이 없으면 「받은 지식 없음 (!)」
  const vk = shownKns()
  const make = !team || !!S.me.admin
  const kmenu = S.menu === 'kmenu' ? `<div class="kmenu" role="menu" aria-label="지식 고르기" data-t="kmenu">${vk.map((x) => `<button type="button" role="menuitem" class="mi${x.id === k ? ' on' : ''}" data-a="pickKn" data-k="${esc(x.id)}" data-t="kmenuKn"${x.id === k ? ' aria-current="true"' : ''}>${esc(x.name)} ${knTag(x)}</button>`).join('')}<div class="sep" role="separator"></div><button type="button" role="menuitem" class="mi" data-a="pickKn" data-k="*" data-t="nav-home">${svg('list')} 모든 지식</button>${make ? '<button type="button" role="menuitem" class="mi" data-a="openAdd" data-t="nav-add">+ 새 지식</button>' : ''}</div>` : ''
  const top = cur
    ? `<div class="sb-kn"><button type="button" class="sb-repo" data-a="kmenu" data-t="kpick" aria-haspopup="menu" aria-expanded="${S.menu === 'kmenu'}" title="${esc(cur.name + (knWhere(cur) ? ' · ' + knWhere(cur) : ''))}"><span class="rk">${esc(cur.name.slice(0, 2))}</span><span class="rn">${esc(cur.name)}</span><span class="rc" aria-hidden="true">▾</span></button>${kmenu}</div>`
    : `<div class="sb-kn side-empty" data-t="sideEmpty"><b>${make ? '지식이 없다' : '받은 지식 없음'}</b>${make ? '<button type="button" class="btn sm" data-a="openAdd" data-t="sideAdd">+ 새 지식</button>' : tipb('side.noKn', '받은 지식 없음')}</div>`
  h += `<div class="sb-top">${top}${busyDot()}${fold}</div>`
  // 2 지식 메뉴
  h += `<nav class="kmn n${km.length}" data-t="knMenu" aria-label="지식 메뉴">${km.map((x) => `<button type="button" class="kmi" ${x.a} data-t="nav-${x.id}" title="${esc(sideLab(x))}" aria-label="${esc(sideLab(x))}"${cur4(x)}${dis(x)}>${svg(x.ic)}<span aria-hidden="true">${esc(x.l)}</span>${sideBadge(x)}</button>`).join('')}</nav>`
  // 3 고른 지식이 있으면 늘: 보기 탭 · 찾기 · 목록(목록 쪽이 찾기 칸 · 나무 머리 [구조] 를 그린다) · 탭 선택은 문서 화면일 때만
  if (cur) {
    const ds = DOCSCR.includes(r.scr)
    const vt = VIEWS3.includes(r.scr) ? r.scr : VIEWS3.includes(S.ktab) ? S.ktab : 'docs'
    const lt = !ds || r.scr === 'structure' ? '' : ltabOf(vt, k)
    if (!ds) left = ''
    h += `<div class="sb-know" data-t="knowArea"><div class="ktabs" role="tablist" aria-label="보기" data-t="ktabs">${LTABS.map(([v, l, ic]) => { const n = ltabN(v, k), g = v === 'graph'; return `<button type="button" role="tab" aria-selected="${lt === v}" class="${g ? 'ic' : ''}" data-a="ltab" data-v="${v}" data-t="rb-${v}" title="${VIEW_LABEL[v] || l + ' 보기'}"${g ? ` aria-label="${l}"` : ''}>${g ? svg(ic) : `${l}${n !== '' ? ` <em>${n}</em>` : ''}`}</button>` }).join('')}</div>`
    h += `<div class="lp" data-t="leftPane">${left || sideList(vt, k)}</div></div>`
  } else h += '<div class="sb-sp"></div>'
  // 4 공통 메뉴
  h += `<nav class="sb-mg nm2" data-t="manageArea" aria-label="공통 메뉴">${cm.map((x) => `<button type="button" class="sb-ic" ${x.a} data-t="nav-${x.id}"${cur4(x)}>${svg(x.ic)}<span>${esc(x.l)}</span></button>`).join('')}</nav>`
  return h + gripHtml('side') + '</aside>'
}
// 들어온 사람 — 머리 줄 오른쪽 동그라미 · 누르면 설정 · 단축키 · 내 기기 · 화면 밝기(메뉴 개편 11절 2) · 나가기
function meHtml() {
  const menu = S.menu === 'me' ? popHtml('me', `<div data-t="meMenu"><div class="mi muted small" data-t="meWhere" aria-disabled="true"><b>${esc(S.me.user)}</b>${isTeam() ? ' · 팀 서버 · ' + esc(S.me.host || '') + (S.me.admin ? ' · 총괄 관리자' : '') : ' · 이 PC 에서 돈다'}</div><div class="sep"></div><div class="mi" data-a="setArea" data-t="meSettings">설정</div><div class="mi" data-a="keysOpen" data-t="meKeys">단축키<small>? · Ctrl /</small></div><div class="mi" data-a="devOpen" data-t="meDevices">내 기기</div><div class="sep"></div><div class="mi muted small" aria-disabled="true" data-t="meTheme">화면 밝기</div>${[['', '시스템'], ['light', '밝게'], ['dark', '어둡게']].map(([v, l]) => `<div class="mi${(UI.theme || '') === v ? ' on' : ''}" role="menuitemradio" aria-checked="${(UI.theme || '') === v}" data-a="setTheme" data-v="${v}" data-t="theme-${v || 'auto'}">${(UI.theme || '') === v ? '✓ ' : ''}${l}</div>`).join('')}${isTeam() ? '<div class="sep"></div><div class="mi" data-a="logout" data-t="meLogout">나가기<small>이 브라우저에서</small></div><div class="mi" data-a="logoutAll" data-t="meLogoutAll">모두 나가기<small>다른 기기 · 브라우저도</small></div>' : '<div class="sep"></div><div class="mi" data-a="logout" data-t="meLogout">나가기<small>이 브라우저에서</small></div>'}</div>`) : ''
  const who = `${S.me.user} · ${isTeam() ? '팀 서버' : '이 PC'}${S.me.admin && isTeam() ? ' · 총괄 관리자' : ''}`
  return `<button type="button" class="hav" data-a="menu" data-m="me" data-t="me" aria-haspopup="menu" aria-expanded="${S.menu === 'me'}" title="${esc(who)}: 설정 · 단축키 · 나가기" aria-label="${esc(who)}: 설정 · 단축키 · 나가기">${menu}${esc(String(S.me.user).slice(0, 1))}</button>`
}
function hdrHtml(crumb) {
  const r = S.route
  const kn = r.kn && r.kn !== '*' && KNSCR.includes(r.scr) && KN(r.kn) ? KN(r.kn).name : ''
  const parts = String(crumb || '').split(' › ').filter(Boolean)
  // 지식 조각은 누르면 그 지식 홈으로 · 맨 앞 「모든 지식」 은 지식관리 › 모든 지식으로(UX T5-12 · T5-15)
  const c = (anon() || !kn || parts[0] === '지식관리' ? '' : '<button type="button" class="lk crumbk" data-a="nav" data-s="home" data-t="crumbHome">모든 지식</button> › ') + (kn && parts[0] !== kn ? '<button type="button" class="lk crumbk" data-a="openKn" data-k="' + esc(r.kn) + '" data-t="crumbKn">' + esc(kn) + '</button> › ' : '') + parts.map((x, i) => (i === parts.length - 1 ? '<b>' + esc(x) + '</b>' : esc(x))).join(' › ')
  const hb = `<span class="hist"><button class="hb" data-a="histGo" data-v="-1" data-t="histBack" title="이전 (Alt ←)"${S.hpos > 0 ? '' : ' disabled'}>‹</button><button class="hb" data-a="histGo" data-v="1" data-t="histFwd" title="다음 (Alt →)"${S.hpos < S.hist.length - 1 ? '' : ' disabled'}>›</button></span>`
  const me = anon() ? '<span class="hme muted" data-t="me">아직 들어오지 않았다</span>' : meHtml()
  const right = `<div class="hright">${anon() ? '' : claudeChip()}<a class="hlink" data-t="manual" href="/manual" target="_blank" rel="noopener" title="설명서: 새 탭">${svg('book')}<span>설명서</span></a>${me}</div>`
  const menuBtn = gated() ? '' : `<button type="button" class="hb menu-btn" data-a="sideToggle" data-t="menuBtn" aria-label="옆 메뉴" aria-expanded="${S.sideOpen ? 'true' : 'false'}" title="옆 메뉴">☰</button>`
  const asideBtn = S._hasAside && !gated() ? `<button type="button" class="hb aside-btn${S.asideOpen ? ' on' : ''}" data-a="asideToggle" data-t="asideBtn" aria-expanded="${S.asideOpen ? 'true' : 'false'}" title="오른쪽 칸: 개요 · 문서 · 기록 · 항목 · 속성">옆 칸</button>` : ''
  if (anon()) return `<header class="hdr">${menuBtn}<span class="crumb">${c}</span><div class="hmid"></div>${right}</header>`
  return `<header class="hdr">${menuBtn}${hb}<span class="crumb">${c}</span><div class="hmid"><div class="qbtn" data-a="openQo" data-t="qoBtn" title="문서 · 항목 · 기록 이름으로 바로 연다">빨리 열기 <kbd>Ctrl O</kbd></div><div class="search" data-a="openSearch" data-t="search">${svg('search')}<span class="sl">찾기</span><span class="sk">Ctrl K</span></div></div>${asideBtn}<span class="hbusy">${busyDot(true)}</span>${right}</header>`
}
function bandHtml() {
  const r = S.route, team = isTeam()
  const k = r.kn && r.kn !== '*' && KNSCR.includes(r.scr) ? r.kn : null
  let left
  if (!k) left = team ? '팀 서버의 kmd · 같이 쓴다' : '개인 프로그램 · 나만 쓴다'
  else left = team ? '팀 지식 · 팀 서버' : '내 지식 · ' + ((KN(k) && KN(k).dir) || '') + ' · 나만'
  const mine = team && k && KN(k)
  const st = stopsFor(k)
  const right = S.loginLost ? '<button type="button" class="btn sm stopbtn" data-a="reLogin" data-t="loginLost">들어간 것이 끝났다 · 다시 들어가기</button>' : st.length ? stopBtnHtml(st) : ''
  return `<div class="band ${team ? 'team' : 'me'}"><span class="who"><i></i>${esc(left)}${mine ? ` · 나: ${lvChip(KN(k))}` : ''}${team ? '' : tipb('band.out', '개인 프로그램')}</span><span class="out">${right}</span></div>`
}
// ── 멈춤 한 줄(서버가 준 줄 그대로) ──
function stopsFor(k) { return S.stops.filter((x) => !k || !x.kn || x.kn === k) }
// 경고(멈춤 줄) — 화면마다 띠로 깔지 않고 머리 띠의 「경고 n」 단추 하나 · 누르면 팝업에 모두(무엇 · 얼마나 · 풀리는 길 · 그 일로 가기)
// 멈춤 줄의 종류 · 갈 곳(메뉴 id) — 갈 곳 글은 메뉴 표의 이름(setWhere)
const STOP_T = { backup: ['지식백업', 'backup'], repo: ['저장소', 'repo'], source: ['자동수집', 'import'], send: ['공유', 'send'], worker: ['팀 일꾼', 'claude'], ver: ['새 판', ''] }
function stopBtnHtml(st) {
  if (!st.length) return ''
  const bad = st.some((x) => x.level === 'bad')
  return `<button type="button" class="btn sm stopbtn${bad ? ' bad' : ''}" data-a="stopOpen" data-t="stopBtn" title="경고를 모두 본다">⚠ 경고 ${st.length}<span>${esc(st[0].b)}${st.length > 1 ? ` 외 ${st.length - 1}` : ''}</span></button>`
}
function stopWinHtml() {
  const st = S.stops
  const row = stopRow
  return stopWinBody(st, row)
}
function stopRow(x) {
  {
    // 갈 곳 — 팀 서버의 백업은 고치는 자리(총괄 관리자만) · 그 밖은 관리자에게 알린다
    let [kind, to] = STOP_T[x.kind] || ['kmd', '']
    if (isTeam() && x.kind === 'backup') { kind = '저장소'; to = S.me.admin || (x.kn && KN(x.kn) && lvOf(KN(x.kn)) === 'admin') ? 'repo' : '' }
    if (isTeam() && x.kind === 'worker') to = S.me.admin ? 'server' : 'mine'
    const where = to === 'repo' ? '지식관리 › 모든 지식 › 저장소' : to ? setWhere(to) : isTeam() && x.kind === 'backup' ? '관리자에게 알린다' : ''
    const scr = to && where ? to : ''
    const attrs = ''
    const kn = x.kn && KN(x.kn) ? KN(x.kn).name : ''
    return `<div class="callout ${x.level === 'bad' ? 'danger' : 'warn'} stop" data-t="stop" data-kind="${esc(x.kind)}"><i></i><span><b>${esc(x.b)}</b>${x.t ? ': ' + esc(x.t) : ''}<small>${esc(kind)}${kn ? ' · ' + esc(kn) : ''}${x.r ? ' · ' + esc(x.r) : ''}</small></span>${scr ? `<button class="btn sm" data-a="stopGo" data-v="${scr}" data-k="${esc(x.kn || '')}"${attrs} data-t="stopGo">${esc(where)} ›</button>` : where ? `<small class="muted">${esc(where)}</small>` : ''}${x.kind === 'migrate' && x.kn && !isTeam() ? `<button type="button" class="btn sm" data-a="migrateAgain" data-k="${esc(x.kn)}" data-t="migrateAgain">다시 하기</button>` : ''}${x.key ? `<button type="button" class="btn ghost sm" data-a="stopAck" data-v="${esc(x.key)}" data-t="stopAck" title="나에게서 이 경고를 걷는다 · 양이나 까닭이 바뀌면 다시 선다">알았다</button>` : ''}</div>`
  }
}
function stopWinBody(st, row) {
  return `<div class="scrim fix" data-a="stopClose" data-self="1"><div class="modal w640" data-t="stopWin"><div class="mh">경고 <small>저절로 하는 일(백업 · 자동수집 · 공유 · 들이기)이 멈췄거나 막혔다. 풀리는 길과 그 일로 가는 단추</small><button class="x" data-a="stopClose" title="닫기">×</button></div>
   <div class="mb">${S.stopsErr ? `<div class="callout danger err" data-t="stopsErr">${sayErr('경고를 읽지 못했다: ' + S.stopsErr)}<b>경고를 읽지 못했다: ${esc(S.stopsErr)}</b><button type="button" class="btn sm retry" data-a="stopReload">다시 읽기</button></div>` : ''}${st.length ? st.map(row).join('') : S.stopsErr ? '' : S.stopsAt ? '<div class="muted">경고가 없다. 모두 잘 돈다</div>' : loadingHtml}</div>
   <div class="mf"><span class="l">잘 될 때는 경고가 없다 · 풀리면 저절로 걷힌다</span><span class="acts"><button class="btn" data-a="stopReload">다시 읽기</button><button class="btn ghost" data-a="stopClose">닫기</button></span></div></div></div>`
}
// 받지 못하면 S.stopsErr — 「모두 잘 돈다」 는 받기에 성공했고 빈 때만(S.stopsAt) · 실패는 돌려준다(다시 읽기가 알린다)
async function loadStops() {
  try {
    const st = await getJSON('/api/stops')
    S.stopsAt = Date.now()
    if (S.stopsErr) { S.stopsErr = null; if (S.stopWin) render() }
    if (S.stopsAt0 && Array.isArray(S.stops)) { const was = new Set(S.stops.map((x) => x.kind + '|' + (x.kn || '') + '|' + x.b)); const fresh = st.filter((x) => !was.has(x.kind + '|' + (x.kn || '') + '|' + x.b)); if (fresh.length) toast('새 경고: ' + esc(fresh[0].b) + (fresh.length > 1 ? ` 외 ${fresh.length - 1}` : ''), 7000) }
    S.stopsAt0 = true
    if (JSON.stringify(st) !== JSON.stringify(S.stops)) { S.stops = st; if (!S.qo && !S.pal && !S.cmd && !gated()) render() }
    return true
  } catch (e) {
    const had = S.stopsErr
    S.stopsErr = e.message || '서버에 닿지 않는다'
    if (S.stopWin && had !== S.stopsErr) render()
    return e
  }
}

function statusHtml() {
  const l = anon() ? (S.gate === 'setup' ? '첫 설정 · 아직 관리자가 없다' : '') : isTeam() ? '들어옴 · ' + esc(S.me.user) : '이 PC'
  return `<div class="status"><span>${l}</span><span class="r" data-t="clock">kmd v${esc(S.me.version)} · ${clock()}</span></div>`
}

// ── 지식관리(메뉴 개편 N6 · 5-2 · 6-2 · 6-4) — 모든 지식 · 기초 세우기 · 사람(팀) ──
//   scr 'home' 하나에 page('all' 처음 · 'seed' · 'people') · 모든 지식의 지식 상세는 mk(지식) · mt(탭)
//   주소 #/manage · #/manage/k/<지식>/<탭> · #/manage/seed · #/manage/people — 옛 지식 목록 카드 · 설정 › 팀 지식 · 설정 › 사람 · 설정 › 이 PC 의 지식 폴더를 여기로 합쳤다
//   판정은 서버(지식마다 hub.levelOf · 총괄 관리자 ctx.admin) · 화면은 자리에 없는 탭 · 칸 · 단추를 숨기기만
function knMeta(n) {
  return '문서 ' + n.docs + (n.when ? ' · ' + whenTxt(n.when) : '')
}
const shownKns = () => S.kns.filter((x) => !x.hidden)
const knRoot = () => (isTeam() ? (S.me.admin ? S.me.root || '' : '') : pcRoot())
const isBoss = () => !!(S.me && S.me.admin)
// 기초 세우기 메뉴(6-4) — 개인 · 총괄 관리자는 늘 · 지식관리자는 지식관리자인 지식 가운데 빈 지식이 있을 때만
const seedMenuOk = () => !isTeam() || isBoss() || (S.kns || []).some((x) => !x.dim && lvOf(x) === 'admin' && !x.docs)
function mgMenu() {
  return [{ id: 'all', l: '모든 지식' }, seedMenuOk() && { id: 'seed', l: '기초 세우기' }, isTeam() && { id: 'people', l: '사람' }].filter(Boolean)
}
const mgPage = () => { const ps = mgMenu(); return ps.find((x) => x.id === S.route.page) || ps[0] }
// 지식관리자 아침 점검(UX T6-11) — 상태 칸의 칩: 점검 · 부탁 · 가져오기 문제. 누르면 그 화면으로
function kchkHtml(n) {
  const c = n.chk; if (!c) return ''
  const b = (v, l, a, t) => v ? `<button type="button" class="lk small" data-a="${a}" data-k="${esc(n.id)}" data-t="${t}">${l} ${v}</button>` : ''
  return `<span class="kchk" data-t="knChk">${b(c.guard, '점검', 'kchkGuard', 'knChkGuard')}${b(c.req, '부탁', 'kchkReq', 'knChkReq')}${b(c.src, '가져오기 문제', 'kchkSrc', 'knChkSrc')}</span>`
}
// 저장소 칸(6-4) — 개인 · 총괄 관리자: 실제 값 · 지식관리자: 붙음 · 없음(목록 응답이 자리로 거른 repo) · 쓰기 · 읽기: 칸째 없음
const repoTail = (u) => String(u || '').replace(/\.git$/, '').split(/[\\/:]/).filter(Boolean).pop() || ''
const pcRepo = (n) => { const st = settingsOf(); return st && !st.error ? (st.backup.list || []).find((x) => x.id === n.id || x.name === n.name) || null : null }
const bossRepo = (n) => { const a = overviewOf(); return a && !a.error ? (a.backups || []).find((x) => x.id === n.id || x.name === n.name) || null : null }
function repoCell(n) {
  const src = !isTeam() ? settingsOf() : isBoss() ? overviewOf() : true
  if (!src) return '<span class="muted" data-t="knRepoWait" aria-label="읽는 중">…</span>'
  if (src.error) return '<span class="chip c-warn" data-t="knRepoErr">못 읽음</span>'
  if (!isTeam()) { const b = pcRepo(n); return b && b.url ? `<span class="mono small" data-t="knRepo" title="${esc(b.url)}">${esc(repoTail(b.url))}</span>` : `<span class="chip c-mute" data-t="knRepo">없음</span>` }
  if (isBoss()) { const b = bossRepo(n); if (!b) return '<span class="muted">-</span>'; const v = b.off ? ['c-mute', '없음'] : REPO_V[b.verdict] || ['c-mute', '확인 전']; return `<span class="chip ${v[0]}" data-t="knBackup" title="${esc(b.off ? '' : b.url || '')}">${v[1]}</span>` }
  if (lvOf(n) !== 'admin' || n.repo == null) return '<span class="muted">-</span>'
  return `<span class="chip ${n.repo ? 'c-ok' : 'c-mute'}" data-t="knRepo">${n.repo ? '붙음' : '없음'}</span>`
}
// 상태 칸 — 빈 지식 · 메뉴에서 뺌 · 안 보냄 n(개인) · 점검 · 부탁 · 가져오기 문제(팀)
function knStateHtml(n) {
  const team = isTeam(), id = esc(n.id)
  return [
    !n.dim && !n.docs ? '<span class="chip c-mute" data-t="knEmpty">빈 지식</span>' : '',
    n.hidden ? `<span class="chip c-mute" data-t="knHidChip">메뉴에서 뺌</span><button type="button" class="btn sm" data-a="knHide" data-k="${id}" data-v="" data-t="knShow">메뉴에 올리기</button>` : '',
    !team && n.sendN ? `<span class="chip c-pend" data-t="knSendN" title="보내지 않은 기록 ${n.sendN}">안 보냄 ${n.sendN}</span>` : '',
    team ? kchkHtml(n) : '',
  ].join('')
}
// 표 칸 — 자리별(6-4): 저장소 · Claude 는 지식관리자인 지식이 하나라도 있을 때만 · 개인은 받을 곳
function knCols(list) {
  const team = isTeam(), adm = !team || isBoss() || list.some((x) => !x.dim && lvOf(x) === 'admin')
  return { role: team, repo: adm, claude: team && adm, route: !team }
}
function knRowHtml(n, cols, sel) {
  const id = esc(n.id), own = !n.dim, mk = 'kn:' + n.id
  const items = own ? `${n.hidden ? '' : `<div class="mi" data-a="knMove" data-k="${id}" data-v="-1" data-t="knUp">앞으로<small>메뉴 순서</small></div><div class="mi" data-a="knMove" data-k="${id}" data-v="1" data-t="knDown">뒤로</div>`}<div class="mi" data-a="knHide" data-k="${id}" data-v="${n.hidden ? '' : '1'}" data-t="knHide">${n.hidden ? '메뉴에 올리기' : '메뉴에서 빼기'}<small>${n.hidden ? '옆 메뉴에 다시' : '지우지 않는다'}</small></div>` : ''
  if (S.menu === mk && items) S._pop = { key: mk, html: items }
  const kebab = items ? `<button type="button" class="kebab${S.menu === mk ? ' on' : ''}" data-a="menu" data-m="${esc(mk)}" data-t="knKebab" aria-haspopup="menu" aria-expanded="${S.menu === mk}" title="순서 · 메뉴에서 빼기" aria-label="${esc(n.name)}: 순서 · 메뉴에서 빼기">⋯</button>` : ''
  const drag = own && !n.hidden ? ` draggable="true" data-drag="${id}"` : ''
  const claude = lvOf(n) === 'admin' ? (n.noClaude ? '<span class="chip c-mute">보내지 않음</span>' : '보냄') : '<span class="muted">-</span>'
  return `<tr class="krow${sel ? ' on' : ''}${n.hidden ? ' hid' : ''}${n.dim ? ' dim' : ''}" data-k="${id}" data-t="${n.hidden ? 'kHid' : 'krow'}" data-name="${esc(n.name)}"${drag}><td class="kgr">${drag ? '<span class="kgrip" aria-hidden="true" title="끌어서 순서를 바꾼다">⋮⋮</span>' : ''}</td><td><button type="button" class="kn3" data-a="kdet" data-k="${id}" data-t="knOpen"${sel ? ' aria-current="true"' : ''}>${esc(n.name)}</button></td>${cols.role ? `<td class="opt">${lvChip(n)}</td>` : ''}<td class="opt u-tr">${n.docs ?? ''}</td>${cols.repo ? `<td>${repoCell(n)}</td>` : ''}${cols.claude ? `<td class="opt">${claude}</td>` : ''}${cols.route ? `<td class="opt">${n.route ? esc(sendNm(n.route)) : '<span class="muted">없음</span>'}</td>` : ''}<td class="kst">${knStateHtml(n) || '<span class="muted">-</span>'}</td><td class="u-tr">${kebab}</td></tr>`
}
// 모든 지식(5-2 · 6-2) — 머리 「모든 지식 n (!)」 · [불러오기] [+ 새 지식](개인 · 총괄 관리자) · 개인은 지식 폴더 줄 · 표(끌어 순서 · 사람마다) · 줄을 누르면 지식 상세
function mgAllHtml() {
  const team = isTeam(), list = S.kns, make = !team || isBoss()
  const sel = S.route.mk && KN(S.route.mk) ? KN(S.route.mk) : null
  const cols = knCols(list)
  const msg = S.syncMsg ? `<div class="callout ${S.syncMsg.cls || ''} stop" data-t="syncMsg"><i></i><span>${S.syncMsg.t}</span></div>` : ''
  const mine = team && !isBoss() && list.length ? [...new Set(list.map(lvOf))].map((l) => `<span class="kt lv-${l}" data-t="myRole">${LV_T[l]}</span>`).join('') : ''
  const more = !team ? `<button type="button" class="kebab${S.menu === 'allMenu' ? ' on' : ''}" data-a="menu" data-m="allMenu" data-t="allMenu" aria-haspopup="menu" aria-expanded="${S.menu === 'allMenu'}" title="모든 지식에 걸린 것" aria-label="모든 지식에 걸린 것">⋯</button>` : ''
  if (!team && S.menu === 'allMenu') { const st = settingsOf(); S._pop = { key: 'allMenu', html: st && !st.error ? `<div class="mi" data-a="toggleAuto" data-v="save" data-t="sw-save" role="menuitemcheckbox" aria-checked="${!!st.auto.save}">편집기 저장<small>${st.auto.save ? '켜짐: 30초 조용하면 저절로' : '꺼짐'}</small></div>` : `<div class="mi muted" aria-disabled="true">읽는 중…</div>` } }
  const head = `<div class="pg-h kmh" data-t="allHead"><div class="pt"><div class="big" data-t="allTitle">모든 지식 <span class="muted">${list.length}</span></div>${tipb(team ? 'kn.listTeam' : 'kn.list', '모든 지식')}</div>${mine}<span class="acts">${make ? `<button type="button" class="btn" data-a="rsOpen" data-t="rsOpen">불러오기</button><button type="button" class="btn${sel ? '' : ' pri'}" data-a="openAdd" data-t="addKn">+ 새 지식</button>` : ''}${more}</span></div>`
  const table = list.length
    ? `<div class="tblwrap"><table class="t ktab" data-t="knTable"><thead><tr><th><span class="sr-only">순서</span></th><th>이름</th>${cols.role ? '<th class="opt">나의 자리</th>' : ''}<th class="opt u-tr">문서</th>${cols.repo ? '<th>저장소</th>' : ''}${cols.claude ? '<th class="opt">Claude</th>' : ''}${cols.route ? '<th class="opt">받을 곳</th>' : ''}<th>상태</th><th><span class="sr-only">메뉴</span></th></tr></thead><tbody data-t="klist">${list.map((n) => knRowHtml(n, cols, sel && sel.id === n.id)).join('')}</tbody></table></div>`
    : `<div class="empty2" data-t="${team ? 'teamEmpty' : 'knEmptyAll'}"><div class="pt"><b>${make ? '지식이 없다' : '받은 지식 없음'}</b>${make ? '' : tipb('kn.empty', '받은 지식 없음')}</div>${make ? '<button type="button" class="btn pri" data-a="openAdd" data-t="addKnEmpty">+ 새 지식</button>' : '<button type="button" class="btn" data-a="copySeatAsk" data-t="copySeatAsk">자리 부탁 글 복사</button>'}</div>`
  const rsrc = list.length && cols.repo ? (!team ? settingsOf() : isBoss() ? overviewOf() : null) : null
  const rerr = rsrc && rsrc.error ? errHtml(rsrc, team ? 'admin' : 'settings') : ''
  const pane = `<div class="kmlist">${head}${rerr}${localRootBar()}${msg}${table}</div>`
  return `<div class="kmsplit${sel ? ' has' : ''}" data-t="allPage">${pane}${sel ? kdHtml(sel) : ''}</div>`
}
// 지식 상세(5-2 · 6-2 · 11절 10) — 1025 이상은 표 오른쪽 판 · 1024 이하는 따로 페이지(같은 주소 #/manage/k/<지식>/<탭>)
//   탭은 자리마다(6-4): 개인 정보 · 저장소 · 삭제 / 팀 지식관리자 정보 · 권한 · 저장소 · 정책(+ 총괄 관리자 삭제) / 쓰기 · 읽기 정보만
function kdTabs(n) {
  if (!isTeam()) return [['info', '정보'], ['repo', '저장소'], ['del', '삭제']]
  if (n.dim || lvOf(n) !== 'admin') return [['info', '정보']]
  return [['info', '정보'], ['perm', '권한'], ['repo', '저장소'], ['policy', '정책'], ...(canDelete(n) ? [['del', '삭제']] : [])]
}
const manageOf = (k) => need('manage:' + k, `/api/k/${encodeURIComponent(k)}/manage`)
const repoOf = (k) => need('repo:' + k, `/api/k/${encodeURIComponent(k)}/backup`)
function kdHtml(n) {
  const tabs = kdTabs(n), tab = tabs.some((t) => t[0] === S.route.mt) ? S.route.mt : 'info'
  const body = tab === 'perm' ? kdPerm(n) : tab === 'repo' ? kdRepo(n) : tab === 'policy' ? kdPolicy(n) : tab === 'del' ? kdDel(n) : kdInfo(n)
  return `<section class="card kdpane" data-t="kdPane" aria-label="${esc(n.name)} 상세"><div class="ch"><button type="button" class="lk kdback" data-a="kdClose" data-t="kdBack">‹ 모든 지식</button><b class="kdn">${esc(n.name)}</b><span class="acts">${n.dim ? '' : `<button type="button" class="btn sm" data-a="knGo" data-k="${esc(n.id)}" data-t="knGo">열기</button>`}<button type="button" class="hb x" data-a="kdClose" data-t="kdClose" title="닫기" aria-label="닫기">×</button></span></div><div class="cb"><div class="tabs" role="tablist" aria-label="지식 상세" data-t="kdTabs">${tabs.map(([v, l]) => `<button type="button" role="tab" aria-selected="${tab === v}" tabindex="${tab === v ? 0 : -1}" data-a="kdTab" data-k="${esc(n.id)}" data-v="${v}" data-t="kdTab-${v}">${l}</button>`).join('')}</div><div role="tabpanel" data-t="kdBody-${tab}">${body}</div></div></section>`
}
function kdInfo(n) {
  const team = isTeam(), adm = lvOf(n) === 'admin' && !n.dim
  const m = adm ? manageOf(n.id) : null
  const more = !adm ? '' : !m ? `<span>기록</span><span>${loadingHtml}</span>` : m.error ? `<span>기록</span><span>${errHtml(m, 'manage:' + n.id)}</span>` : `<span>기록</span><span data-t="kdRecs">${m.records}</span>${m.created ? `<span>만든 때</span><span>${esc(String(m.created).slice(0, 10))}</span>` : ''}${team && m.owner ? `<span>주인</span><span>${esc(m.owner)}</span>` : ''}`
  const route = !team ? `<span>받을 곳</span><span data-t="kdRoute">${n.route ? esc(sendNm(n.route)) : '<span class="muted">없음</span>'} <button type="button" class="lk" data-a="kdSend" data-k="${esc(n.id)}" data-t="kdSend">${n.route ? '바꾸기' : '정하기'}</button></span>` : ''
  return `<div class="kv" data-t="kdInfo"><span>이름</span><span><b>${esc(n.name)}</b></span>${team ? `<span>나의 자리</span><span>${lvChip(n)}</span>` : ''}<span>문서</span><span>${n.docs ?? 0}</span>${more}${!team && n.dir ? `<span>폴더</span><span class="mono small">${esc(n.dir)}</span>` : ''}${route}</div>${n.dim ? '' : `<div class="kdsw">${swHtml(!!n.hidden, '메뉴에서 빼기', `role="switch" aria-checked="${!!n.hidden}" data-a="knHide" data-k="${esc(n.id)}" data-v="${n.hidden ? '' : '1'}" data-t="kdHide"`)}</div>`}`
}
// 권한(팀 · 지식관리자) — 지금 자리 표(읽기만) + [바꾸기](권한 창 · 주인 넘기기는 총괄 관리자가 그 창에서)
function kdPerm(n) {
  const v = accessOf(n.id)
  if (!v) return loadingHtml
  if (v.error) return errHtml(v, 'access:' + n.id)
  const rows = [[`<b>${esc(v.owner || '-')}</b>`, '주인'], ['<b>모두</b>', LV_N[v.all] || '없음'], ...Object.entries(v.groups || {}).map(([g, l]) => [`묶음 ${esc(g)}`, LV_N[l] || l]), ...Object.entries(v.users || {}).filter(([u]) => u !== v.owner).map(([u, l]) => [esc(u), LV_N[l] || l])]
  return `<div class="tblwrap"><table class="t" data-t="kdPermTable"><thead><tr><th>누구</th><th>자리${tipb('acc', '자리')}</th></tr></thead><tbody>${rows.map(([a, b]) => `<tr data-t="kdPermRow"><td>${a}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div><div class="row kdacts"><button type="button" class="btn pri" data-a="accOpen" data-k="${esc(n.id)}" data-t="accOpen">바꾸기</button></div>`
}
// 저장소(6-4 · 8-3 · 지식관리 2) — 개인 · 총괄 관리자: 주소 · 가지(접힘 「가지 main ▸」) · 상태 · [붙이기]/[바꾸기] · [떼기] ·
//   팀 총괄 관리자가 아직 붙이지 않은 지식은 「GitLab 새로(그룹 · 이름 · 가지) | 있는 주소」 · 지식관리자: 보기만(GET /api/k/:id/backup · 주소 가림)
//   지식백업과 다른 곳(설정 › 지식백업은 경로 + 사본 수)
function kdRepo(n) {
  const team = isTeam(), id = esc(n.id)
  if (team && !isBoss()) {
    const r = repoOf(n.id)
    if (!r) return loadingHtml
    if (r.error) return errHtml(r, 'repo:' + n.id)
    return `<div class="kv" data-t="kdRepoView"><span>저장소</span><span class="mono small">${r.off ? '<span class="chip c-mute">없음</span>' : esc(r.url || '')}</span>${r.off ? '' : `<span>가지</span><span class="mono">${esc(r.branch || 'main')}</span><span>마지막 보냄</span><span>${r.at ? esc(whenTxt(r.at)) : '-'}</span>`}</div>`
  }
  const b = team ? bossRepo(n) : pcRepo(n), src = team ? overviewOf() : settingsOf()
  if (!src) return loadingHtml
  if (src.error) return errHtml(src, team ? 'admin' : 'settings')
  const url = b && !b.off ? b.url || '' : ''
  if (!S.rf || S.rf.kn !== n.id) S.rf = { kn: n.id, url: null, br: null, brOpen: false, mode: null, group: '', rname: '' }
  const f = S.rf, cur = (b && b.branch) || 'main'
  const v = team ? (b ? (b.off ? ['c-mute', '없음'] : REPO_V[b.verdict] || ['c-mute', '확인 전']) : ['c-mute', '없음']) : url ? ['c-ok', '붙음'] : ['c-mute', '없음']
  const state = `<span class="chip ${v[0]}" data-t="kdRepoState">${v[1]}</span>`
  // 아직 없는 팀 지식 — GitLab 새로 | 있는 주소(나중에는 없다 · 6-1)
  const mode = !url && team ? repoMode(f) : 'url'
  const seg = !url && team ? repoSeg(f, 'rf', false) : ''
  if (mode === 'gitlab') return `${seg}${glFields(f, 'rf', n.name)}<div class="row kdacts">${state}<button type="button" class="btn pri" data-a="repoGitlab" data-k="${id}" data-t="repoGitlab"${glReady() ? '' : ' disabled'}>만들어 붙이기</button></div>`
  const val = f.url != null ? f.url : url
  return `${seg}<div class="field"><div class="lbrow"><label for="repoUrl">저장소</label>${tipb('kd.repo', '저장소')}</div><div class="row u-g3"><input class="inp mono u-f1" id="repoUrl" data-in="rfUrl" data-t="repoUrl" value="${esc(val)}" placeholder="예: git@gitlab.team:kmd/dpms.git · https://…" autocomplete="off">${brFold(f, 'rf', cur)}</div>${brField(f, 'rf', cur)}</div><div class="row kdacts">${state}<button type="button" class="btn pri" data-a="repoSave" data-k="${id}" data-t="repoSave">${url ? '바꾸기' : '붙이기'}</button>${url ? `<button type="button" class="btn danger" data-a="repoDetach" data-k="${id}" data-t="repoDetach">떼기</button>` : ''}</div>`
}
// 가지 접기(메뉴개편 8-3) — 저장소 칸 오른쪽 「가지 main ▸」(.btn.ghost.sm · aria-expanded) · 누르면 아래 가지 칸 · 바꾼 값이면 접혀도 그 이름
//   key: add(새 지식) · rs(불러오기) · rf(지식 상세 › 저장소) — 상태는 그 창의 것(S.addPop · S.rs · S.rf)
const brState = (key) => (key === 'add' ? S.addPop : key === 'rs' ? S.rs : key === 'rf' ? S.rf : null)
const brVal = (f, dflt = 'main') => (f && f.br != null && String(f.br).trim() ? String(f.br).trim() : dflt)
function brFold(f, key, dflt = 'main') {
  return `<button type="button" class="btn ghost sm u-fnone" id="${key}BrFold" data-a="brFold" data-v="${key}" aria-expanded="${!!f.brOpen}" data-t="${key}BrFold">가지 ${esc(brVal(f, dflt))} ${f.brOpen ? '▾' : '▸'}</button>`
}
function brField(f, key, dflt = 'main') {
  return f.brOpen ? `<div class="field" style="margin:var(--sp-3) 0 0"><label for="${key}Br">가지</label><input class="inp mono" id="${key}Br" data-in="br" data-k="${key}" data-t="${key}Br" value="${esc(f.br || '')}" placeholder="${esc(dflt)}" autocomplete="off"></div>` : ''
}
// GitLab 연결(총괄 관리자 · 팀) — 그룹 목록 · 처음 값(serve.json group) · 없으면 { why }
const glOf = () => (isTeam() && isBoss() ? need('gitlab', '/api/gitlab/groups') : null)
const glReady = () => { const g = glOf(); return !!(g && !g.error && !g.why && Array.isArray(g.groups) && g.groups.length) }
// 저장소 고르기 — 처음 값: 팀 총괄 관리자는 GitLab 이 되면 GitLab 새로 · 아니면 있는 주소
function repoMode(f) {
  if (f.mode) return f.mode
  if (isTeam() && isBoss()) { const g = glOf(); if (!g || glReady()) return 'gitlab' }
  return 'url'
}
function repoSeg(f, key, later) {
  const m = repoMode(f), gl = isTeam() && isBoss()
  const opts = [...(gl ? [['gitlab', 'GitLab 새로']] : []), ['url', '있는 주소'], ...(later ? [['later', '나중에']] : [])]
  return `<div class="seg in" role="radiogroup" aria-label="저장소 고르기" data-t="${key}Mode" style="margin:0 0 var(--sp-4)">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${m === v}" class="${m === v ? 'on' : ''}" data-a="repoMode" data-k="${key}" data-v="${v}" data-t="${key}Mode-${v}">${l}</button>`).join('')}</div>`
}
// 저장소 이름 처음 값 — 지식 이름의 영문 · 숫자 · . _ - (한글뿐이면 knowledge-n · 관리 설계 6)
const repoSlug = (nm) => String(nm || '').normalize('NFC').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 100) || `knowledge-${(S.kns || []).length + 1}`
const GL_WHY = { noconfig: 'GitLab 연결이 없다', nosecret: 'GitLab 열쇠가 없다' }
function glFields(f, key, nm) {
  const g = glOf()
  if (!g) return loadingHtml
  if (g.error) return errHtml(g, 'gitlab')
  if (g.why || !glReady()) return `<div class="callout warn" data-t="${key}GlOff"><i></i><span>${esc(GL_WHY[g.why] || '봇이 저장소를 만들 수 있는 그룹이 없다')}: 「있는 주소」 로 붙인다</span></div>`
  const grp = f.group || (g.groups.some((x) => x.path === g.group) ? g.group : g.groups[0].path)
  const rn = f.rname || repoSlug(nm)
  return `<div class="field" style="margin:0"><div class="lbrow"><label for="${key}Grp">그룹</label>${tipb('kd.gitlab', 'GitLab 새로')}</div><select class="inp mono" id="${key}Grp" data-in="glf" data-k="${key}" data-f="group" data-t="${key}Grp">${g.groups.map((x) => `<option value="${esc(x.path)}"${x.path === grp ? ' selected' : ''}>${esc(x.path)}</option>`).join('')}</select></div><div class="field" style="margin:var(--sp-4) 0 0"><label for="${key}Rn">저장소 이름</label><div class="row u-g3"><input class="inp mono u-f1" id="${key}Rn" data-in="glf" data-k="${key}" data-f="rname" data-t="${key}Rn" value="${esc(rn)}" autocomplete="off">${brFold(f, key)}</div>${brField(f, key)}</div>`
}
// GitLab 새로 결과 → 사람 말(지식관리 2 · 관리 설계 9-2) — 붙었으면 ''
function glSay(g) {
  if (!g || g.made) return ''
  if (g.found && g.empty) return `같은 이름의 빈 저장소가 이미 있다: ${g.found}`
  if (g.why === 'exists') return '같은 이름의 저장소에 다른 이력이 있다: 이름을 바꾼다'
  if (g.why === 'used') return `다른 지식(${g.by || ''})이 이미 이 저장소를 쓴다`
  if (g.why === 'attached') return '이미 저장소가 붙어 있다'
  return GL_WHY[g.why] || '저장소를 붙이지 못했다'
}
const glGroup = (f) => { const g = glOf(); return f.group || (g && g.groups ? (g.groups.some((x) => x.path === g.group) ? g.group : (g.groups[0] || {}).path) : '') || '' }
const REPO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
// 저장소를 바꾼 뒤 — 그 탭의 칸 · 상태(총괄 관리자 개요 · 지식관리자 보기 · 개인 설정) · 경고 줄을 다시 읽는다
function repoDone(k) { S.rf = null; S.repoEdit = null; delete S.cache.admin; delete S.cache['repo:' + k]; dropSettings(); loadStops(); render() }
// 정책(팀 · 지식관리자) — Claude 에 보내기 · 들어간 것 하루 요약(P-D13) · 이슈 주소 · 저장 방식 스위치는 걷었다(팀 지식은 늘 저장 승인 · P11)
function kdPolicy(n) {
  const id = esc(n.id)
  return `<div class="kdsw col" data-t="kdPolicy">${swHtml(!n.noClaude, 'Claude 에 보내기', `role="switch" aria-checked="${!n.noClaude}" data-a="toggleNoClaude" data-k="${id}" data-t="noClaudeSw"`)}${swHtml(!!n.review, '들어간 것 하루 요약', `role="switch" aria-checked="${!!n.review}" data-a="knReview" data-k="${id}" data-t="knReview"`)}</div><div class="kv kdissue"><span>이슈 주소</span><span><span class="mono small">${n.issueUrl ? esc(n.issueUrl) : '<span class="muted">없음</span>'}</span> <button type="button" class="lk" data-a="knIssue" data-k="${id}" data-t="knIssue">${n.issueUrl ? '바꾸기' : '정하기'}</button></span></div>`
}
// 삭제(개인 · 총괄 관리자) — 이름을 쳐서 확인하는 창(delHtml)
function kdDel(n) {
  return `<div class="callout danger" data-t="kdDelWarn"><i></i><span><b>삭제는 되돌릴 수 없다</b> · 보관하지 않는다. 저장소에 사본이 있으면 불러오기로 돌아온다</span></div><div class="row kdacts"><button type="button" class="btn danger" data-a="delOpen" data-k="${esc(n.id)}" data-t="delOpen">삭제</button></div>`
}
// 기초 세우기(TODO 9 · 메뉴개편 8-1 · 바탕 설계 5-3 · 통합 I1) — 개인: 단계 띠 일곱(지식 · 재료 · 거르기 · 구조안 · 짓기 · 진단 · 넣기).
//   서버 장부(짜임 일 kind seed)가 단계를 쥔다(GET /api/k/:id/seed · 다시 열면 그 단계에서 잇는다) · 도는 일(조사 · Claude 구조안 · 짓기 · 넣기)은 1.2초마다 다시 읽는다.
//   팀(TODO 10 · 메뉴개편 8-2)은 재료를 브라우저로 올리고(seed/upload · 원본은 팀 서버로 · 글만 남김) 묶음으로 조사 · Claude 는 팀 일꾼 일감 ·
//   비용 숫자 · 하루 한도 · 24시간 걸음 없으면 멈춤 · 다 넣은 뒤 다음 묶음(통합 I2). 넣기 전에는 지식이 바뀌지 않는다
const SD_STEPS = ['지식', '재료', '거르기', '구조안', '짓기', '진단', '넣기']
const SD_TIP = ['sd.kn', 'sd.src', 'sd.pick', 'sd.plan', 'sd.write', 'sd.diag', 'sd.put']
const SD_PICKS = ['넣음', '근거만', '빼기', '보류']
const sdState = () => (S.sd ||= { kn: null, ui: 0, back: false, path: '', v: null, err: null, busy: '', open: null, openErr: null, t0: 0 })
const sdUrl = (k, x) => `/api/k/${encodeURIComponent(k)}/seed${x ? '/' + x : ''}`
const sdWork = (d) => (d.v && d.v.work && !d.v.work.other && !d.v.work.broken && d.v.work.mine ? d.v.work : null)
const sdRunning = (d) => !!(d.v && d.v.run && d.v.run.state === 'running')
// 지금 단계 — 장부가 있으면 장부의 단계(이전으로 재료를 다시 볼 때만 1) · 조사 중이면 1 · 없으면 화면의 단계(0 · 1)
function sdStep(d) {
  const w = sdWork(d)
  if (d.pick0 || !d.kn) return 0
  if (d.v && d.v.run && d.v.run.kind === 'survey' && d.v.run.state === 'running') return 1
  if (d.next || (w && d.back)) return 1
  if (w) return w.stage === 'done' || ['putting', 'stopped', 'rebase'].includes(w.stage) ? 6 : w.ui
  return Math.min(d.ui, 1)
}
async function sdLoad(k, quiet) {
  const d = sdState()
  if (!k) return
  d.loading = true
  if (!quiet) { d.err = null; render() }
  try {
    const v = await getJSON(sdUrl(k))
    if (d.kn !== k) return render()
    d.v = v; d.err = null
    await sdFeedLoad(k)
  } catch (e) { if (d.kn === k) d.err = e.message } finally { d.loading = false }
  sdTick()
  render()
}
async function sdLoadOpen() {
  const d = sdState()
  try { d.open = await getJSON('/api/seed/open'); d.openErr = null } catch (e) { d.openErr = e.message; d.openWait = false }
  render()
}
// 도는 일 — 1.2초마다 다시 읽는다(이 화면에 있을 때만)
function sdTick() {
  const d = sdState()
  clearTimeout(d.timer)
  if (!(sdRunning(d) || d.busy === 'put')) return
  d.timer = setTimeout(() => { if (S.route.scr === 'home' && S.route.page === 'seed' && d.kn) sdLoad(d.kn, true) }, 1200)
}
// 단추가 하는 일 — 오류는 화면 위 줄로 · 끝나면 다시 읽는다
async function sdDo(busy, fn) {
  const d = sdState()
  if (d.busy) return
  d.busy = busy; d.actErr = null; d.t0 = Date.now(); render()
  try { const r = await fn(); if (r && r.kn && r.work !== undefined && r.claude) d.v = r } catch (e) { if (e.code !== 'E_CANCEL') d.actErr = e } finally { d.busy = '' }
  await sdLoad(d.kn, true)
}
const sdSecs = (t) => Math.max(0, Math.round((Date.now() - Date.parse(t || 0)) / 1000))
function sdBarHtml(st, w) {
  const top = w ? w.top : st
  return `<nav class="stepbar" aria-label="기초 세우기 단계" data-t="sdSteps">${SD_STEPS.map((l, i) => {
    const cur = i === st, done = i < st, can = !cur && (i === 0 || (w ? i >= 1 && i <= top : i < st)), far = Math.abs(i - st) > 1 ? ' far' : ''
    return `${i ? `<span class="sep${far}" aria-hidden="true">›</span>` : ''}<button type="button" class="step${done ? ' done' : ''}${far}" data-a="sdGoStep" data-v="${i}" data-t="sdStep-${i}"${cur ? ' aria-current="step"' : ''}${can ? '' : ' aria-disabled="true"'}><span class="n">${i + 1}</span>${done ? '<span class="ck" aria-hidden="true">✓</span><span class="sr-only">지남</span>' : ''}${l}</button>`
  }).join('')}</nav>`
}
const sdNeed = (t) => `<span class="need" data-t="sdNeed">먼저: ${esc(t)}</span>`
const sdRunHtml = (d, what) => { const r = d.v && d.v.run; if (r && r.hold) what = `Claude 사용 한도 · ${hhmmOf(r.hold.next)} 에 다시 본다 · 풀리면 잇는다`; return `<div class="callout sx-cj${r && r.hold ? ' warn' : ''}" role="status" data-t="sdRun"${r && r.hold ? ' data-hold="1"' : ''}><span class="loading u-f1">${what} · ${sdSecs(r && r.at)}초</span>${r && r.kind !== 'survey' ? '<button type="button" class="btn ghost sm" data-a="sdStopRun" data-t="sdStopRun">그만두기</button>' : ''}</div>` }
const sdRunFail = (d, kind) => { const r = d.v && d.v.run; return r && r.kind === kind && r.state === 'fail' ? `<div class="callout danger" role="alert" data-t="sdRunFail"><i></i><span>${esc(r.why || '하지 못했다')}</span></div>` : '' }
// a 지식 — 지식관리자인 지식 · 빈 지식만 고른다(문서가 있으면 「문서 n」 · 고를 수 없음)
function sdKnHtml(d) {
  const list = (S.kns || []).filter((n) => !n.dim && lvOf(n) === 'admin')
  const open = Array.isArray(d.open) ? d.open : []
  const rows = list.map((n) => {
    const ok = !n.docs, on = d.kn === n.id, going = open.find((x) => x.kn === n.id)
    return `<label class="trow${on ? ' on' : ''}" data-t="sdKn"${ok ? '' : ' aria-disabled="true"'}><input type="radio" name="sdkn" data-sdkn="${esc(n.id)}"${on ? ' checked' : ''}${ok ? '' : ' disabled'}><span class="tn"><b>${esc(n.name)}</b></span>${ok ? (going ? chipOf('run', '만드는 중') : chipOf('ok', '빈 지식')) : `<span class="chip c-mute" data-t="sdKnDocs">문서 ${n.docs}</span>`}</label>`
  }).join('')
  const mine = open.filter((x) => x.mine)
  const going = mine.length ? `<div class="card" data-t="sdOpen"><div class="ch">만들던 것 <small>${mine.length}</small></div><ul class="plain pl">${mine.map((x) => `<li><span class="nm"><b>${esc(x.name)}</b> <small>${esc(SD_STEPS[x.ui] || '')}</small></span><button type="button" class="btn sm" data-a="sdResume" data-k="${esc(x.kn)}" data-t="sdResume">이어 하기</button></li>`).join('')}</ul></div>` : d.openErr ? `<div class="callout danger err" data-t="sdOpenErr"><b>${esc(d.openErr)}</b><button type="button" class="btn sm retry" data-a="sdOpenRetry" data-t="retry">다시 읽기</button></div>` : ''
  return `<div role="radiogroup" aria-label="빈 지식" data-t="sdKns">${rows || '<p class="muted" data-t="sdNoKn">지식이 없다</p>'}</div>${!isTeam() || isBoss() ? '<div class="row u-g3"><button type="button" class="btn" data-a="openAdd" data-t="sdAdd">+ 새 지식</button></div>' : ''}${going}`
}
// b 재료 — 경로 칸 · 한도 칩 · Claude 로 글이 간다
function sdSrcHtml(d) {
  if (isTeam()) return sdUpHtml(d)
  const r = d.v && d.v.run, w = sdWork(d), lim = d.v ? d.v.limit : { files: 300, bytes: 200 << 20 }
  if (r && r.kind === 'survey' && r.state === 'running') return sdRunHtml(d, `조사하는 중${r.n ? ` ${r.i}/${r.n}` : ''}`)
  const big = r && r.kind === 'survey' && r.state === 'fail' && r.big
  const fail = r && r.kind === 'survey' && r.state === 'fail' && !big ? sdRunFail(d, 'survey') : ''
  const val = d.path || (w && w.src) || ''
  return `<div class="field"><label for="sdPath">재료 경로</label><input class="inp mono" id="sdPath" data-in="sdPath" data-t="sdPath" value="${esc(val)}" placeholder="D:\\자료\\…" autocomplete="off"></div><div class="row u-g3 u-wrap"><span class="chip c-mute" data-t="sdLimit">${lim.files} 파일 · ${Math.round(lim.bytes / 1048576)}MB</span>${tipb('sd.big', '큰 폴더')}</div>${big ? `<div class="callout warn" data-t="sdBig"><i></i><span>파일 ${big.files}${big.files > lim.files ? '+' : ''} · 한도 넘음 <code>kmd-seed ${esc(val)}</code></span></div>` : ''}${fail}<div class="callout warn" data-t="sdClaudeNote"><i></i><span>글은 이 PC 의 Claude 로 간다</span>${tipb('sd.claude', 'Claude')}</div>`
}
// b 재료(팀 · 메뉴개편 8-2 b) — 폴더 · 파일 올리기(끌어다 놓기) · 한도 칩은 늘 · 넘으면 나눠 올리기 · kmd-seed (!) · 원본은 팀 서버로 간다(경고 한 줄)
function sdUpHtml(d) {
  const lim = d.v ? d.v.limit : { files: 300, bytes: 200 << 20 }, up = d.up || {}, g = d.v && d.v.team && d.v.team.upload
  const busy = !!up.going || !!d.busy
  const prog = up.going ? `<div class="callout sx-cj" role="status" data-t="sdUpGoing"><span class="loading u-f1">올리는 중 ${up.n} / ${up.of}</span></div>` : ''
  const err = up.err ? `<div class="callout danger" role="alert" data-t="sdUpErr"><i></i><span>${esc(up.err)}</span>${up.big ? tipb('sd.bigT', '큰 묶음') : ''}</div>` : ''
  const kept = g && !up.going ? `<div class="row u-g3 u-wrap" data-t="sdUpKept">${chipOf(g.last ? 'ok' : 'wait', `올림 ${g.files} 파일`)}${g.last ? '' : '<span class="small muted">다 올리지 못했다 · 다시 올린다</span>'}</div>` : ''
  return `<div class="drop" id="sdDrop" data-t="sdDrop"><div class="acts"><button type="button" class="btn pri" data-a="pickIn" data-v="sdDirIn" data-t="sdPickDir"${busy ? ' disabled' : ''}>폴더</button><button type="button" class="btn" data-a="pickIn" data-v="sdFileIn" data-t="sdPickFile"${busy ? ' disabled' : ''}>파일</button></div><div class="muted">여기에 놓기</div><input type="file" multiple id="sdFileIn" aria-label="파일 고르기" data-t="sdFileIn" tabindex="-1"><input type="file" webkitdirectory directory multiple id="sdDirIn" aria-label="폴더 고르기" data-t="sdDirIn" tabindex="-1"></div><div class="row u-g3 u-wrap"><span class="chip c-mute" data-t="sdLimit">${lim.files} 파일 · ${Math.round(lim.bytes / 1048576)}MB</span>${tipb('sd.bigT', '큰 묶음')}${tipb('sd.up', '올리기')}</div>${prog}${kept}${err}<div class="callout warn" data-t="sdTeamNote"><i></i><span>원본은 팀 서버로 간다</span>${tipb('sd.team', '팀 서버')}</div>`
}
// 팀 비용 숫자(8-2) — 파일 · 글 자 · 팀 일꾼 일(구조안 1 + 문서) · 오늘 한도 남음
function sdCostHtml(d, w) {
  const t = d.v && d.v.team
  if (!t || !t.cost) return ''
  const docs = t.cost.docs == null ? (w.plan ? 0 : null) : t.cost.docs
  const jobs = w.mode === 'folder' ? 0 : (w.plan ? 0 : 1) + (docs || 0)
  const over = jobs > t.day.left
  return `<div class="row u-g3 u-wrap" data-t="sdCost"><span class="chip c-mute" data-t="sdCostFiles">파일 ${t.cost.files}</span><span class="chip c-mute" data-t="sdCostChars">글 ${t.cost.chars.toLocaleString()} 자</span><span class="chip c-mute" data-t="sdCostJobs">팀 일꾼 일 ${docs == null && w.mode !== 'folder' ? '1 + 문서' : jobs}</span><span class="chip ${over ? 'c-warn' : 'c-mute'}" data-t="sdDayLeft">오늘 한도 ${t.day.left} 남음</span>${tipb('sd.cost', '비용')}</div>`
}
// 팀 일꾼 칩 — 없음 · 옛 판(Claude 안 · 짓기 꺼짐)
const sdWorkerChip = (cl) => (cl && cl.ok && (cl.none || cl.old) ? `<span class="chip c-warn" data-t="sdNoWorker">${cl.old ? '팀 일꾼 옛 판' : '팀 일꾼 없음'}</span>${tipb('sd.worker', '팀 일꾼')}` : '')
const sdClaudeOk = (cl) => !!(cl && cl.ok && !cl.none && !cl.old)
// c 거르기 — 줄마다 고르기(넣음 · 근거만 · 빼기 · 보류) · 비밀 의심 · 글 없는 줄은 넣지 못한다
function sdPickHtml(d, w) {
  const rows = w.rows || []
  if (w.rowsErr) return errHtml(w.rowsErr, null)
  const n = (p) => rows.filter((r) => r.pick === p).length
  const role = (r) => r.role === '정본' ? '' : r.role === '비밀 의심' ? `<span class="chip c-warn" title="${esc((r.secret || []).join(' · '))}" data-t="sdSecret">비밀 의심</span>` : r.role === '못 읽음' || r.role === '그림' || (r.role === '스캔' && !r.src) ? `<span class="chip c-mute" title="${esc(r.why || '')}">${esc(r.role)}</span>` : `<span class="chip c-mute">${esc(r.role)}</span>`
  const body = rows.map((r, i) => {
    const lock = !r.src || r.role === '비밀 의심'
    return `<tr data-t="sdRow"><td><select class="inp" data-sdpick="${i}" aria-label="${esc(r.path)} 고르기" data-t="sdPick">${SD_PICKS.map((p) => `<option${r.pick === p ? ' selected' : ''}${lock && (p === '넣음' || p === '근거만') ? ' disabled' : ''}>${p}</option>`).join('')}</select></td><td class="mono sd-path" title="${esc(r.path)}">${esc(r.path)}</td><td>${role(r)}</td><td class="u-tr mono small">${r.chars ? r.chars.toLocaleString() : '-'}</td></tr>`
  }).join('')
  return `<div class="row u-g3 u-wrap" data-t="sdPickSum">${chipOf('ok', `넣음 ${n('넣음')}`)}<span class="chip c-mute">근거만 ${n('근거만')}</span><span class="chip c-mute">빼기 ${n('빼기')}</span><span class="chip c-mute">보류 ${n('보류')}</span><button type="button" class="btn sm" data-a="sdPickAll" data-t="sdPickAll"${d.busy ? ' disabled' : ''}>모두 넣기</button></div><div class="tblwrap"><table class="t" data-t="sdRows"><thead><tr><th>고르기</th><th>파일</th><th><span class="sr-only">판</span></th><th class="u-tr">글자</th></tr></thead><tbody>${body}</tbody></table></div>`
}
// d 구조안 — Claude 안 · 폴더 그대로 · 문서 이름은 손으로 고친다 · 검사(걸림 · 경고)
function sdPlanHtml(d, w) {
  const v = d.v, cl = v.claude || { ok: false }, r = v.run, cok = sdClaudeOk(cl) && !(v.team && v.team.day.left < 1)
  const seg = `<div class="seg in" role="radiogroup" aria-label="구조안" data-t="sdMode"><button type="button" role="radio" aria-checked="${w.mode === 'claude'}" class="${w.mode === 'claude' ? 'on' : ''}" data-a="sdPlan" data-v="claude" data-t="sdModeClaude"${cok && !d.busy && !sdRunning(d) ? '' : ' disabled'}${cl.ok ? '' : ` title="${esc(cl.why || '')}"`}>Claude 안</button><button type="button" role="radio" aria-checked="${w.mode === 'folder'}" class="${w.mode === 'folder' ? 'on' : ''}" data-a="sdPlan" data-v="folder" data-t="sdModeFolder"${d.busy || sdRunning(d) ? ' disabled' : ''}>폴더 그대로</button></div>${cl.ok ? '' : '<span class="chip c-mute" data-t="sdNoClaude">Claude 에 보내지 않음</span>'}${sdWorkerChip(cl)}`
  const run = r && r.kind === 'plan' && r.state === 'running' ? sdRunHtml(d, r.wait ? '팀 일꾼을 기다리는 중' : isTeam() ? `Claude 가 구조안을 짓는 중${r.tries > 1 ? ` · 고쳐 쓰기 ${r.tries - 1}` : ''}` : `Claude 가 구조안을 짓는 중 · ${r.n > 1 ? `묶음 ${r.i}/${r.n}` : '뼈대'}`) : sdRunFail(d, 'plan')
  const cost = sdCostHtml(d, w)
  if (!w.plan) return `<div class="row u-g3 u-wrap">${seg}${tipb('sd.mode', '구조안')}</div>${cost}${run}`
  const ck = w.check || { ok: false, errors: [], warnings: [] }
  const docs = w.plan.docs.map((x, i) => `<li data-t="sdDoc"><span class="muted mono">${i + 1}</span><input class="inp u-f1" value="${esc(x.id)}" aria-label="문서 ${i + 1} 이름" data-sdren="${i}" data-t="sdDocName"${d.busy || sdRunning(d) ? ' disabled' : ''}><small class="muted">항목 ${x.items.length}</small></li>`).join('')
  const errs = ck.errors.length ? `<div class="callout danger" data-t="sdPlanErr"><i></i><div><b>걸림 ${ck.errors.length}</b><ul class="sx-ul bad">${ck.errors.slice(0, 30).map(sxWhere).join('')}</ul></div></div>` : ''
  const warns = ck.warnings.length ? `<details class="small" data-t="sdPlanWarn"><summary>경고 ${ck.warnings.length}</summary><ul class="sx-ul">${ck.warnings.slice(0, 50).map(sxWhere).join('')}</ul></details>` : ''
  return `<div class="row u-g3 u-wrap">${seg}${tipb('sd.mode', '구조안')}${ck.ok ? chipOf('ok', '걸림 0') : ''}</div>${cost}${run}${w.why ? `<p class="small muted">${esc(w.why)}</p>` : ''}${errs}<div class="card" data-t="sdDocs"><div class="ch">문서 <small>${w.plan.docs.length}</small></div><ul class="plain sd-docs">${docs}</ul></div>${warns}`
}
// e 짓기 — 문서마다 글(Claude · 폴더 그대로 · 손으로) · 처음 3 문서 승인 · 모두 짓기
const SD_ST = { wait: ['wait', '기다림'], run: ['run', '짓는 중'], ok: ['ok', '지음'], fail: ['held', '걸림'] }
const sdNeedN = (w) => (w.mode === 'claude' ? Math.min(3, w.docs.length) : 0)
function sdWriteHtml(d, w) {
  const r = d.v.run, cl0 = d.v.claude || { ok: false }, run = sdRunning(d), team = d.v.team
  const cl = { ...cl0, ok: sdClaudeOk(cl0) }
  const dayLeft = team ? team.day.left : Infinity
  const need = sdNeedN(w), apN = w.docs.slice(0, need).filter((x) => x.ok).length
  const rows = w.docs.map((x, i) => {
    const st = SD_ST[x.state] || SD_ST.wait
    const first = i < need
    const acts = [
      x.state !== 'ok' && x.state !== 'run' && cl.ok ? `<button type="button" class="btn sm" data-a="sdWriteOne" data-v="${i}" data-t="sdWriteOne"${run || d.busy || dayLeft < 1 ? ' disabled' : ''}>짓기</button>` : '',
      x.state === 'ok' || x.state === 'fail' || x.state === 'wait' ? `<button type="button" class="btn sm" data-a="sdPeek" data-v="${i}" data-t="sdPeek">보기</button>` : '',
      first && x.state === 'ok' && !x.ok ? `<button type="button" class="btn sm" data-a="sdApprove" data-v="${i}" data-t="sdApprove"${d.busy ? ' disabled' : ''}>승인</button>` : '',
    ].join('')
    return `<tr data-t="sdWRow"><td class="sd-path" title="${esc(x.id)}">${esc(x.id)}${first ? ` ${x.ok ? chipOf('ok', '승인') : '<span class="chip c-mute">처음</span>'}` : ''}</td><td class="u-tr">${x.items.length}</td><td>${chipOf(st[0], st[1])}${x.values.length ? ` <span class="chip c-warn" title="${esc(x.values.map((y) => y.why).join(' · '))}">값 ${x.values.length}</span>` : ''}</td><td class="u-tr mono small">${x.chars ? x.chars.toLocaleString() + ' 자' : '-'}</td><td class="u-tr"><span class="row u-g3 sd-acts">${acts}</span></td></tr>`
  }).join('')
  const left = w.docs.filter((x) => x.state !== 'ok').length
  const over = team && left > dayLeft
  const top = w.mode !== 'folder' ? `<div class="row u-g3 u-wrap" data-t="sdWriteTop">${need ? `<span class="chip ${apN === need ? 'c-ok' : 'c-mute'}" data-t="sdApN">승인 ${apN} / ${need}</span>${tipb('sd.first', '처음 문서')}` : ''}<button type="button" class="btn" data-a="sdWriteAll" data-t="sdWriteAll"${apN < need || run || d.busy || !left || !cl.ok || over ? ' disabled' : ''}>모두 짓기</button>${team ? `<span class="chip ${over ? 'c-warn' : 'c-mute'}" data-t="sdDayLeft">오늘 한도 ${dayLeft} 남음</span>${over ? tipb('sd.cost', '하루 한도') : ''}` : ''}${sdWorkerChip(cl0)}</div>` : ''
  const going = r && r.kind === 'write' && r.state === 'running' ? sdRunHtml(d, r.wait ? `팀 일꾼을 기다리는 중 ${r.i}/${r.n}` : (isTeam() ? `Claude 가 글을 짓는 중 ${r.i + 1}/${r.n}${r.doc ? ' · ' + r.doc : ''}` : `Claude 가 글을 짓는 중 · 끝 ${r.i}/${r.n}${r.doc ? ' · ' + r.doc : ''}`)) : sdRunFail(d, 'write')
  return `${top}${going}<div class="tblwrap"><table class="t" data-t="sdWTable"><thead><tr><th>문서</th><th class="u-tr">항목</th><th>상태</th><th class="u-tr">쓴 글</th><th><span class="sr-only">할 일</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
}
// f 진단 — 연습 판 끝 진단(막는 것 · 볼 것 · 값 대조는 재기만)
function sdDiagHtml(d, w) {
  const t = w.tried
  if (d.busy === 'try') return `<div class="card"><div class="cb">${loadingHtml.replace('읽는 중…', '해 보는 중…')}</div></div>`
  if (!t) return '<p class="muted" data-t="sdNoTry">연습 판에 아직 해 보지 않았다</p>'
  const g = t.diag || { blockers: [], warnings: [], counts: {} }, c = g.counts || {}
  const vals = g.warnings.filter((x) => x.what === '값 대조').length
  const tile = (l, n, warn, tt) => `<div class="tile${warn ? ' w' : ''}" data-t="${tt}"><div class="l">${l}</div><div class="n">${n}</div></div>`
  return `<div class="tiles" data-t="sdTiles">${tile('막는 것', g.blockers.length, g.blockers.length, 'sdBlockN')}${tile('볼 것', g.warnings.length, false, 'sdWarnN')}${tile('문서', c.docs ?? '-', false, 'sdDocN')}${tile('항목', c.items ?? '-', false, 'sdItemN')}</div>${g.blockers.length ? `<div class="callout danger" data-t="sdBlockers"><i></i><div><ul class="sx-ul bad">${g.blockers.map(sxWhere).join('')}</ul><button type="button" class="btn sm" data-a="sdGoStep" data-v="3" data-t="sdFixPlan">구조안 고치기</button></div></div>` : ''}${vals ? `<p class="small muted" data-t="sdVals">재료에 없는 값 ${vals}${tipb('sd.values', '값 대조')}</p>` : ''}${g.warnings.length ? `<details class="small" data-t="sdWarns"><summary>볼 것 ${g.warnings.length}</summary><ul class="sx-ul">${g.warnings.slice(0, 50).map(sxWhere).join('')}</ul></details>` : ''}`
}
// g 넣기 — 걸음 · 끝 카드 · 걸음 실패(P-D24)
function sdPutHtml(d, w) {
  if (w.stage === 'done') return `<div class="card" data-t="sdDone"><div class="empty3"><b>다 넣었다</b><span class="small muted">걸음 ${w.done}</span><span class="row u-g3 u-wrap"><button type="button" class="btn pri" data-a="knGo" data-k="${esc(d.kn)}" data-t="sdOpenKn">지식 열기</button>${isTeam() ? `<button type="button" class="btn" data-a="sdNextGroup" data-t="sdNextGroup">다음 묶음</button>${tipb('sd.bigT', '다음 묶음')}` : ''}</span></div></div>`
  // 걸음 실패(P-D24) — 걸린 문서의 글을 고쳐 [이어 넣기](연습 판 · 넣은 걸음은 그대로)
  const fdoc = (h) => { const id = String(h.doc || '').replace(/^docs\//, '').replace(/\.md$/, ''); return w.docs.findIndex((x) => x.id === id) }
  const fail = w.fail ? `<div class="callout danger" data-t="sdStepFail"><i></i><div><b>걸음 실패</b>${tipb('sx.stepFail', '걸음 실패')}<ul class="sx-ul">${w.fail.map((h) => `<li><b>${esc(h.heading || h.doc || '')}</b> <span>${esc(h.why || '')}</span></li>`).join('')}</ul>${[...new Set(w.fail.map(fdoc).filter((i) => i >= 0))].slice(0, 5).map((i) => `<button type="button" class="btn sm" data-a="sdFixDoc" data-v="${i}" data-t="sdFixDoc"${d.busy ? ' disabled' : ''}>글 고치기 · ${esc(w.docs[i].id)}</button>`).join(' ')}</div></div>` : ''
  const busy = d.busy === 'put' ? `<div class="callout sx-cj" role="status" data-t="sdPutting"><span class="loading u-f1">넣는 중 · ${Math.round((Date.now() - d.t0) / 1000)}초</span></div>` : ''
  const steps = w.steps || 0
  return `${busy}${fail}<div class="card" data-t="sdSteps6"><div class="cb"><div class="row u-g3 u-wrap">${chipOf(w.done >= steps && steps ? 'ok' : d.busy === 'put' ? 'run' : 'wait', `걸음 ${w.done} / ${steps}`)}${w.stage !== 'done' && !d.busy ? '<span class="small muted">잠깐 멈춤</span>' : ''}</div></div></div>`
}
// 바닥 줄 — 「먼저: 까닭」 · ⋯(그만두기) · [이전] · 주 단추 하나
function sdFootHtml(d, st, w) {
  let main = '', need = '', back = ''
  const run = sdRunning(d), b = d.busy
  const btn = (a, l, dis, t) => `<button type="button" class="btn pri" data-a="${a}" data-t="${t || 'sdGo'}"${dis || b || run ? ' disabled' : ''}${b ? ' aria-busy="true"' : ''}>${esc(l)}</button>`
  if (st === 0) { main = btn('sdNext0', '다음', !d.kn); if (!d.kn) need = '빈 지식을 고른다' }
  else if (st === 1 && isTeam()) { const g = d.v && d.v.team && d.v.team.upload, ok = !!(g && g.last) && !(d.up && d.up.going); main = btn('sdSurveyGroup', b === 'survey' ? '조사 거는 중…' : '조사', !ok); if (!ok) need = '재료를 올린다'; back = w && !d.next ? '' : 'sdBack0' }
  else if (st === 1) { const p = (d.path || (w && w.src) || '').trim(); main = btn('sdSurvey', b === 'survey' ? '조사 거는 중…' : '조사', !p); if (!p) need = '재료 폴더 경로를 쓴다'; back = w ? '' : 'sdBack0' }
  else if (st === 2) { const on = (w.rows || []).some((r) => r.pick === '넣음'); main = btn('sdNext', '다음', !on); if (!on) need = '하나 이상 넣는다'; back = 'sdBack1' }
  else if (st === 3) { const ok = w.plan && w.check && w.check.ok; main = btn('sdNext', '다음', !ok); if (!w.plan) need = '구조안을 고른다'; else if (!ok) need = `걸림 ${(w.check && w.check.errors.length) || 0} 을 고친다`; back = 'sdBack' }
  else if (st === 4) {
    const need0 = sdNeedN(w), apN = w.docs.slice(0, need0).filter((x) => x.ok).length, left = w.docs.filter((x) => x.state !== 'ok').length
    main = btn('sdTry', b === 'try' ? '해 보는 중…' : '연습 판', left || apN < need0)
    if (apN < need0) need = '처음 문서를 승인한다'; else if (left) need = `글 ${left} 을 짓는다`
    back = 'sdBack'
  } else if (st === 5) { const bl = w.tried && w.tried.diag ? w.tried.diag.blockers.length : 1; main = btn('sdPut', '넣기', bl || !w.tried); if (bl) need = `막는 것 ${bl}`; back = 'sdBack' }
  else if (w && w.stage !== 'done') main = btn('sdPut', b === 'put' ? '넣는 중…' : '이어 넣기', false, 'sdResumePut')
  if (d.next) return main ? `<div class="sx-bar" data-t="sdBar" role="region" aria-label="기초 세우기"><div class="sx-bh"><span class="l">${need ? sdNeed(need) : ''}${d.actErr ? `<span class="need" role="alert" data-t="sdActErr">${esc(d.actErr.message || String(d.actErr))}</span>` : ''}</span><span class="r">${main}</span></div></div>` : ''
  const more = w ? `<button type="button" class="kebab${S.menu === 'sdMore' ? ' on' : ''}" data-a="menu" data-m="sdMore" data-t="sdMore" title="더 보기" aria-haspopup="menu" aria-expanded="${S.menu === 'sdMore'}" aria-label="더 보기">⋯${S.menu === 'sdMore' ? popHtml('sdMore', `<div><div class="mi" data-a="sdQuit" data-t="sdQuit">그만두기<small>${w.stage === 'done' ? '이 화면에서 닫는다' : '지식은 그대로'}</small></div></div>`) : ''}</button>` : ''
  if (!main && !more) return ''
  return `<div class="sx-bar" data-t="sdBar" role="region" aria-label="기초 세우기"><div class="sx-bh"><span class="l">${need ? sdNeed(need) : ''}${d.actErr ? `<span class="need" role="alert" data-t="sdActErr">${esc(d.actErr.message || String(d.actErr))}</span>` : ''}</span><span class="r">${more}${back ? `<button type="button" class="btn" data-a="${back}" data-t="sdBackBtn"${b || run ? ' disabled' : ''}>이전</button>` : ''}${main}</span></div></div>`
}
// 동작 내역(Z9 · 바탕 설계 5-3) — 오른쪽 칸 · 개인 프로그램 · 기초 세우기 일의 Claude 흐름(세션 · 짓기)을 터미널(.term · 컨벤션 7절)로.
//   GET seed/feed?after=&sid= 로 이어 읽는다(sdLoad 와 같이 · 도는 동안 1.2초마다) · sid 가 바뀌면 처음부터 · 줄 400
async function sdFeedLoad(k) {
  const d = sdState()
  if (isTeam() || !k || !sdWork(d)) return
  const f = d.feed && d.feed.kn === k ? d.feed : (d.feed = { kn: k, sid: null, seq: 0, rows: [], live: null, loaded: false })
  try {
    const r = await getJSON(`${sdUrl(k, 'feed')}?after=${f.seq}${f.sid ? `&sid=${f.sid}` : ''}`)
    if (d.feed !== f) return
    if (r.sid !== f.sid) { f.rows = []; f.sid = r.sid }
    Object.assign(f, { rows: f.rows.concat(r.rows || []).slice(-400), seq: r.seq || 0, live: r.live || null, title: r.title || '', at: r.at || null, running: !!r.running, err: null, loaded: true })
  } catch (e) { if (d.feed === f) Object.assign(f, { err: e.message, loaded: true }) }
}
const SDF_MARK = { start: '● ', me: '› ', think: '∴ ', tool: '▸ ', answer: '✓ ', result: '■ ' }
function sdFeedLine(f, r) {
  const ms = Math.max(0, Date.parse(r.at) - Date.parse(f.at || r.at))
  const s = Math.floor(ms / 1000)
  const tm = `<span class="tm">${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}</span>`
  const cut = (t, n) => { const x = String(t || ''); return x.length > n ? x.slice(0, n) + ' …' : x }
  let k = 'sys', x = ''
  if (r.k === 'start') x = `세션 · ${r.text}`
  else if (r.k === 'me') x = `kmd: ${cut(String(r.text).split('\n')[0], 160)}`
  else if (r.k === 'think') x = cut(r.text, 400)
  else if (r.k === 'say' || r.k === 'note') { k = 'say'; x = r.text }
  else if (r.k === 'tool') { k = 'tool'; x = `${r.name} ${r.text}` }
  else if (r.k === 'toolres') { k = r.err ? 'err' : 'sys'; x = `  ⎿ ${r.err ? cut(r.text, 200) : `${r.lines}줄`}` }
  else if (r.k === 'answer') { k = 'ok'; x = r.text }
  else if (r.k === 'result') { k = r.ok ? 'cost' : 'err'; x = `${r.text}${r.turns ? ` · ${r.turns}턴` : ''}${r.ms ? ` · ${Math.round(r.ms / 1000)}초` : ''}${r.cost ? ` · $${r.cost.toFixed(2)}` : ''}` }
  else if (r.k === 'kmd') { k = r.tone === 'ok' ? 'ok' : r.tone === 'bad' ? 'err' : 'sys'; x = `${r.tone === 'ok' ? '✓ ' : r.tone === 'bad' ? '✗ ' : r.tone === 'warn' ? '! ' : '· '}${r.text}` }
  return `<div class="${k}" data-t="sdfRow" data-k="${esc(r.k)}">${tm}${r.tag ? `<span class="sg">[${esc(r.tag)}]</span>` : ''}${SDF_MARK[r.k] || ''}${esc(x)}</div>`
}
function sdFeedHtml(d) {
  const f = d.feed
  const state = !f || !f.sid ? '' : f.running ? chipOf('run', '도는 중') : chipOf('same', '끝')
  const head = `<div class="term-h" data-t="sdFeedH"><b>동작 내역</b>${state}${f && f.title ? `<small>${esc(f.title)}</small>` : ''}${f && f.at ? `<small class="mono">${hhmmOf(f.at)}</small>` : ''}${tipb('sd.feed', '동작 내역')}</div>`
  if (!f || !f.loaded) return `${head}<div class="term sdf" data-t="sdFeed"><span class="sys">불러오는 중…</span></div>`
  if (f.err) return `${head}<div class="callout danger err" role="alert" data-t="sdFeedErr"><b>${esc(f.err)}</b><button type="button" class="btn sm retry" data-a="sdFeedRetry" data-t="retry">다시 읽기</button></div>`
  if (!f.sid) return `${head}<div class="term sdf" data-t="sdFeed"><span class="sys">아직 줄이 없다 · Claude 안 · 짓기를 걸면 흐름이 여기에 보인다</span></div>`
  const lv = f.live && f.running ? `<div class="${f.live.kind === 'think' ? 'sys' : f.live.kind === 'json' ? 'tool' : 'say'}" data-t="sdfLive">${f.live.tag ? `<span class="sg">[${esc(f.live.tag)}]</span>` : ''}${f.live.kind === 'think' ? '∴ ' : f.live.kind === 'json' ? '▸ 답 쓰는 중 ' : ''}${esc(f.live.text.slice(-300))}▍</div>` : ''
  return `${head}<div class="term sdf" data-t="sdFeed" role="log" aria-label="동작 내역">${f.rows.map((r) => sdFeedLine(f, r)).join('')}${lv}</div>`
}
function mgSeedHtml() {
  const head = (x) => `<div class="pg-h"><div class="pt"><div class="big">기초 세우기</div>${tipb('mg.seed', '기초 세우기')}</div>${x || ''}</div>`
  const d = sdState()
  // 새 지식 창 · 수기수집 빈 지식 줄에서 넘어온 지식
  if (S.seedKn) { if (S.seedKn !== d.kn) { d.kn = S.seedKn; d.v = null; d.ui = 1; d.back = false; d.next = false; d.up = null; d.path = ''; d.err = null } d.pick0 = false; S.seedKn = null }
  if (d.open == null && !d.openWait && !d.openErr) { d.openWait = true; setTimeout(sdLoadOpen) }
  if (d.kn && !KN(d.kn)) { d.kn = null; d.v = null }
  if (d.kn && !d.v && !d.loading && !d.err) { d.loading = true; setTimeout(() => sdLoad(d.kn, true)) }
  const w = sdWork(d), st = sdStep(d), k = d.kn && KN(d.kn)
  const title = `<div class="ph sd-ph"><b>${SD_STEPS[st]}</b>${tipb(SD_TIP[st], SD_STEPS[st])}${k && st ? `<span class="chip c-mute" data-t="sdKnChip">${esc(k.name)}</span>` : ''}</div>`
  let body = ''
  if (d.err) body = `<div class="callout danger err" data-t="err"><b>${esc(d.err)}</b><button type="button" class="btn sm retry" data-a="sdReload" data-t="retry">다시 읽기</button></div>`
  else if (d.kn && !d.v && st > 0) body = loadingHtml
  else if (d.v && d.v.work && d.v.work.broken) body = '<div class="callout danger" data-t="sdBroken"><i></i><span>짜임 일 장부가 깨졌다</span><button type="button" class="btn sm" data-a="sdQuit" data-t="sdBrokenStop">그만두기</button></div>'
  else if (d.v && d.v.work && (d.v.work.other || !d.v.work.mine) && st > 0) body = `<div class="callout warn" data-t="sdOther"><i></i><span>${esc(d.v.work.by || '')} 가 연 짜임 일이 있다</span></div>`
  else if (st === 0) body = sdKnHtml(d)
  else if (st === 1) body = sdSrcHtml(d)
  else if (!w) body = loadingHtml
  else body = [null, null, sdPickHtml, sdPlanHtml, sdWriteHtml, sdDiagHtml, sdPutHtml][st](d, w)
  // 24시간 걸음이 없던 일(팀) — 멈춤 · [이어 하기] 가 깨운다
  if (w && w.idle && st > 1) body = `<div class="callout warn" data-t="sdIdle"><i></i><span>멈춤 · 24시간 걸음 없음</span>${tipb('sd.idle', '멈춤')}<button type="button" class="btn sm" data-a="sdWake" data-t="sdWake"${d.busy ? ' disabled' : ''}>이어 하기</button></div>${body}`
  return `<div class="pg-text sd" data-t="seedPage">${head()}${sdBarHtml(st, w)}${title}<div class="sd-b" data-t="sdBody-${st}">${body}</div>${d.err ? '' : sdFootHtml(d, st, w)}</div>`
}
// [보기] 창 — 문서 글(항목마다) · 값 알림 · 걸림 · 손으로 고치기 · 승인(처음 3 문서)
function sdwHtml() {
  const x = S.sdw, d = sdState(), w = sdWork(d)
  const doc = w && w.docs.find((y) => y.id === x.doc)
  if (!doc) return ''
  const t = x.text
  const first = w.docs.indexOf(doc) < sdNeedN(w)
  let mb
  if (x.loading) mb = loadingHtml
  else if (x.err) mb = formErr(x.err, 'sdwErr')
  else if (x.edit) mb = doc.items.map((it, i) => `<div class="field"><label for="sdwT${i}">${esc(it.h)}</label><textarea class="inp" id="sdwT${i}" rows="5" data-in="sdwT" data-i="${i}" data-t="sdwText"${i ? '' : ' data-focus'}>${esc(x.rows[i] || '')}</textarea></div>`).join('')
  else mb = (t && t.items && t.items.length ? t.items.map((it) => `<h4 class="sd-h">${esc(it.h)}</h4><div class="sd-tx">${esc(it.content)}</div>`).join('') : '<p class="muted" data-t="sdwNone">글이 아직 없다</p>')
  const vals = doc.values.length ? `<div class="callout warn" data-t="sdwVals"><i></i><span>재료에 없는 값: ${doc.values.slice(0, 3).map((v) => esc(v.why)).join(' · ')}</span></div>` : ''
  const fail = doc.state === 'fail' ? `<div class="callout danger" data-t="sdwFail"><i></i><span>${esc(doc.why || '걸렸다')}</span></div>` : ''
  const go = x.edit ? `<button type="button" class="btn pri" data-a="sdwSave" data-t="sdwSave"${x.busy ? ' disabled' : ''}>${x.busy ? '저장하는 중…' : '저장'}</button>` : first && doc.state === 'ok' && !doc.ok ? '<button type="button" class="btn pri" data-a="sdwApprove" data-t="sdwApprove">승인</button>' : ''
  return `<div class="scrim fix" data-a="sdwClose" data-self="1"${x.busy ? ' data-busy="1"' : ''}><div class="modal w760" role="dialog" aria-modal="true" aria-labelledby="sdwH" data-t="sdwWin"><div class="mh" id="sdwH">${esc(doc.id)} <small>항목 ${doc.items.length}</small><button type="button" class="x" data-a="sdwClose" title="닫기" aria-label="닫기">×</button></div><div class="mb">${fail}${vals}${mb}</div><div class="mf"><span class="acts">${x.edit ? '<button type="button" class="btn ghost" data-a="sdwEditOff">취소</button>' : `<button type="button" class="btn ghost" data-a="sdwClose" data-focus>닫기</button><button type="button" class="btn" data-a="sdwEdit" data-t="sdwEdit"${x.loading || sdRunning(d) ? ' disabled' : ''}>손으로 고치기</button>`}${go}</span></div></div></div>`
}
async function sdPeek(i) {
  const d = sdState(), w = sdWork(d)
  const doc = w && w.docs[i]
  if (!doc) return
  S.sdw = { doc: doc.id, loading: true, edit: false, rows: [] }
  render()
  try {
    const v = await getJSON(`${sdUrl(d.kn)}?doc=${encodeURIComponent(doc.id)}`)
    if (!S.sdw || S.sdw.doc !== doc.id) return
    S.sdw.text = v.work && v.work.text ? v.work.text : null
    d.v = v
  } catch (e) { if (S.sdw) S.sdw.err = e.message } finally { if (S.sdw) S.sdw.loading = false; render() }
}
// 사람(팀 · 6-2 · 11절 8) — 총괄 관리자: 탭 사람 · 묶음(바꿈) · 그 밖: 보기만 판(팀 사람 목록 · 자리 (!)) · 사람 목록 길(/api/people)은 들어온 사람 누구나
function mgPeopleHtml() {
  const head = (extra) => `<div class="pg-h"><div class="pt"><div class="big">사람</div>${tipb('mg.people', '사람')}</div>${extra || ''}</div>`
  if (isBoss()) {
    const tab = S.pplTab === 'g' ? 'g' : 'p'
    const tabs = `<div class="tabs" role="tablist" aria-label="사람" data-t="pplTabs">${[['p', '사람'], ['g', '묶음']].map(([v, l]) => `<button type="button" role="tab" aria-selected="${tab === v}" tabindex="${tab === v ? 0 : -1}" data-a="pplTab" data-v="${v}" data-t="pplTab-${v}">${l}</button>`).join('')}</div>`
    return `<div class="pg-text">${head()}${tabs}${tab === 'g' ? admGroupsCard() : admPeopleCard() + `<div class="card">${ROLE_RULE}</div>`}</div>`
  }
  const p = peopleOf()
  const rows = !p ? `<li>${loadingHtml}</li>` : p.error ? `<li>${errHtml(p, 'people')}</li>` : p.map((x) => `<li data-t="pplRow"><span class="av2">${esc(String(x).slice(0, 1))}</span><span class="nm">${esc(x)}${x === S.me.user ? ' <small>나</small>' : ''}</span></li>`).join('') || '<li class="muted">사람이 없다</li>'
  return `<div class="pg-text">${head('<span class="chip c-mute" data-t="pplRO">보기만</span>')}<div class="card" data-t="peopleRO"><div class="ch">팀 사람 ${Array.isArray(p) ? p.length : ''}<span class="lbrow">자리${tipb('acc', '자리')}</span></div><ul class="plain pl">${rows}</ul></div></div>`
}
function viewHome() {
  const pg = mgPage(), p = pg.id
  const main = p === 'seed' ? mgSeedHtml() : p === 'people' ? mgPeopleHtml() : mgAllHtml()
  const kd = p === 'all' && S.route.mk && KN(S.route.mk) ? ' › ' + KN(S.route.mk).name : ''
  const sd = p === 'seed' && !isTeam() && sdWork(sdState()) ? sdFeedHtml(sdState()) : null
  return { crumb: pg.l + kd, main: `<div class="pg-grid">${main}</div>`, ...(sd ? { aside: sd } : {}) }
}
// 개인 화면의 지식 폴더 띠 — 경로 · [경로 복사] · [동기화] · [바꾸기] · [빼기](빼면 경로 칸이 늘 열린다)
//   바꾸면 그 폴더에 .kmd 가 있으면 그대로 잇고 · 없거나 빈 폴더면 새로 세운다 · 개인 프로그램이 그 폴더로 다시 켜진다
const meRootNow = () => (S.me.none ? '' : S.me.root || '')
function localRootBar() {
  if (isTeam()) return ''
  const ed = S.meRootEdit != null || S.me.none
  const body = ed
    ? `<input class="inp mono u-f1" id="meRootIn"${invAttr(S.meRootErr, 'meRootErr')} aria-label="지식 폴더 경로" data-in="meRoot" data-t="meRootIn" value="${esc(S.meRootEdit || '')}" placeholder="예: D:\\kmd" autocomplete="off" style="min-width:min(220px,100%)"><span class="acts"><button class="btn pri" data-a="meRootSave" data-t="meRootSave"${S.meRootBusy ? ' disabled' : ''}>${S.meRootBusy ? '바꾸는 중…' : '이 폴더로'}</button>${S.me.none ? '' : '<button class="btn ghost" data-a="meRootCancel">취소</button>'}</span>`
    : `<span class="fp" data-t="rootPath">${esc(S.me.root || '')}</span><span class="acts"><button class="btn" data-a="copyRoot" data-t="copyRoot">복사</button><button class="btn" data-a="syncKn" data-t="syncKn"${S.syncing ? ' disabled' : ''}>${S.syncing ? '읽는 중…' : '동기화'}</button><button class="btn" data-a="meRootEdit" data-t="meRootEdit">바꾸기</button><button class="btn" data-a="meRootDrop" data-t="meRootDrop"${S.meRootBusy ? ' disabled' : ''} title="이 PC 의 지식 폴더를 뗀다(폴더의 파일은 지우지 않는다)">떼기</button></span>`
  // 덧말은 (!) 로(메뉴 개편 11절 2) · 뺀 때만 늘 보이는 한 줄
  const note = S.me.none ? '<small>지식 폴더를 뺐다. 경로를 쓰면 그 폴더에 세운다 · 이미 kmd 지식 폴더(.kmd 가 있는 곳)면 그대로 쓴다</small>' : ''
  return `<div class="fbar" data-t="addRoot"><span class="fl">${svg('doc')}지식 폴더${tipb('kn.root', '지식 폴더')}</span>${body}${note}</div>${S.meRootErr ? formErr(S.meRootErr, 'meRootErr') : ''}`
}
// 개인 화면 — 다시 켜진 개인 프로그램이 답할 때까지 기다렸다가 화면을 다시 연다(30초)
async function localRootWait() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    if (await fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.ok, () => false)) break
  }
  location.reload()
}
// 지식 폴더 빼기 — 개인 프로그램은 켠 채(팀 연결 · 내 Claude 그대로) 빈자리로 다시 켜진다 · 폴더의 파일은 그대로 · 경로를 쓰면 다시 붙는다
async function meRootDrop() {
  const r0 = meRootNow()
  if (!r0 || !await ask1('지식 폴더 떼기', '떼기', true, `지식 폴더를 뗀다: ${r0}\n\n폴더의 파일은 지우지 않는다. 개인 지식은 경로를 다시 쓰기 전까지 보이지 않는다.`)) return
  await meRootPost({ none: true })
}
async function meRootSave() {
  const v = String(($('#meRootIn') || {}).value || S.meRootEdit || '').trim()
  if (!v) { S.meRootErr = '경로를 쓴다'; render(); return }
  await meRootPost({ root: v })
}
// 바꾸기 · 빼기(개인 화면) — 그 폴더(빼기면 빈자리)로 개인 프로그램이 다시 켜진다
async function meRootPost(body) {
  S.meRootBusy = true; S.meRootErr = null; render()
  try {
    const r = await postJSON('/api/pc/root', body)
    S.meRootEdit = null
    if (r.same) S.syncMsg = { cls: 'gray', t: '<b>지금 쓰는 지식 폴더다</b>' }
    else {
      S.syncMsg = r.kind === 'none' ? { t: '<b>지식 폴더를 뺐다</b> · 폴더의 파일은 그대로 · 다시 켜지는 중…' }
        : { t: `<b>지식 폴더를 바꿨다</b>: ${esc(r.root)} · ${r.kind === 'open' ? '있던 작업 환경(.kmd)을 그대로 잇는다' : '새 지식 폴더로 세웠다'} · 다시 켜지는 중…` }
      S.meRootBusy = true
      render()
      return localRootWait()
    }
  } catch (e) { if (e.code !== 'E_CANCEL') S.meRootErr = e.message; else toastErr(e) }
  S.meRootBusy = false
  render()
}
// [+ 새 지식] 창(메뉴 개편 5-2 · 8-3 · 11절 13 · 지식관리 2) — 이름 · 저장소(접힘: [저장소 붙이기 ▸] → 팀 총괄 관리자 「GitLab 새로 | 있는 주소 | 나중에」 ·
//   개인 「있는 주소 | 나중에」 · 가지 접기 「가지 main ▸」) · [만들기] → POST /api/knowledge/add { kind: 'new', name, empty: true, backup: false } → 고른 대로 저장소
//   팀에서 저장소를 고르면 비밀번호를 만들기 앞에서 받는다(관리 설계 4-5 · 걸음 중간에 창이 떠 지식만 남지 않게)
//   만든 뒤 창은 닫지 않고 다음 걸음 카드로: 「<이름> 을 만들었다」 + [기초 세우기] · [수기수집] · [닫기] (저장소를 못 붙였으면 까닭 + [저장소])
//   개인 화면: 지식 폴더 안 새 지식 · 팀 화면: 팀 지식(총괄 관리자 · 서버도 ctx.admin) · 자리 · 받을 곳은 만든 뒤 지식 상세 › 권한 · 공유에서
//   공유 화면에서 연 창은 그 화면 위에 띄우고, 만든 개인 지식을 곧 보내는 지식으로 고른다
function openAdd() {
  S.menu = null
  const from = ['send', 'import'].includes(S.route.scr) ? S.route.scr : null
  S.addPop = { name: '', url: '', repo: false, mode: null, group: '', rname: '', br: null, brOpen: false, err: null, busy: false, done: null, from, where: isTeam() ? 'team' : 'local' }
  S._focus = 'addIn'
  render()
}
function addPopHtml() {
  const a = S.addPop
  const x = '<button type="button" class="x" data-a="addClose" title="닫기" aria-label="닫기">×</button>'
  if (a.done) {
    const n = KN(a.done.id), w = n && (!isTeam() || lvOf(n) === 'write' || lvOf(n) === 'admin')
    return `<div class="scrim fix" data-a="addClose" data-self="1"><div class="modal w420" role="dialog" aria-modal="true" aria-label="새 지식" data-t="addPop"><div class="mh">새 지식${x}</div><div class="mb"><div class="empty3" data-t="addNext"><b data-t="addDoneName">${esc(a.done.name)} 을 만들었다</b>${a.done.warn ? `<div class="callout warn" data-t="addRepoErr"><i></i><span>${esc(a.done.warn)}</span><button type="button" class="btn sm" data-a="addRepoGo" data-t="addRepoGo">저장소</button></div>` : a.done.repo ? `<small class="muted mono" data-t="addRepoOk">${esc(a.done.repo)}</small>` : ''}<div class="row u-wrap u-g3"><button type="button" class="btn pri" data-a="addSeed" data-t="addSeed">기초 세우기</button>${w ? '<button type="button" class="btn" data-a="addManual" data-t="addManual">수기수집</button>' : ''}</div></div></div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="addClose" data-t="addDone" id="addDoneBtn">닫기</button></span></div></div></div>`
  }
  let repo
  if (!a.repo) repo = `<button type="button" class="btn ghost sm" data-a="addRepo" data-t="addRepo" aria-expanded="false">저장소 붙이기 ▸</button>`
  else {
    const m = repoMode(a)
    repo = repoSeg(a, 'add', true) + (m === 'later' ? '<small class="muted" data-t="addLater">지식 상세 › 저장소에서 붙인다</small>'
      : m === 'gitlab' ? glFields(a, 'add', a.name)
        : `<div class="row u-g3"><input class="inp mono u-f1" id="addUrl" data-in="addUrl" data-t="addUrl" aria-label="저장소 주소" value="${esc(a.url || '')}" placeholder="${isTeam() ? '예: git@gitlab.team:kmd/회의.git' : '예: E:\\kmd-저장소\\회의.git'}" autocomplete="off">${brFold(a, 'add')}</div>${brField(a, 'add')}`)
  }
  return `<div class="scrim fix" data-a="addClose" data-self="1"${a.busy ? ' data-busy="1"' : ''}><div class="modal w420" role="dialog" aria-modal="true" aria-label="새 지식" data-t="addPop"><div class="mh">새 지식${tipb(a.where === 'team' ? 'add.team' : 'add.local', '새 지식')}${x}</div><div class="mb"><div class="field" style="margin:0"><label for="addIn">이름</label><input class="inp" id="addIn" data-in="addName" data-t="addIn"${invAttr(a.err, 'addMsg')} value="${esc(a.name)}" placeholder="예: 회의" autocomplete="off"></div><div class="field" style="margin:var(--sp-5) 0 0"><div class="lbrow"><span class="lb">저장소 <span class="muted">(선택)</span></span>${tipb('kd.repo', '저장소')}</div>${repo}</div>${a.err ? formErr(a.err, 'addMsg') : ''}</div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="addClose">취소</button><button type="button" class="btn pri" data-a="doAdd" data-t="addBtn"${a.busy ? ' disabled' : ''}>${a.busy ? '만드는 중…' : '만들기'}</button></span></div></div></div>`
}
async function doAdd() {
  const a = S.addPop
  if (!a || a.busy || a.done) return
  const name = String(a.name || '').trim(), mode = a.repo ? repoMode(a) : 'later'
  const url = mode === 'url' ? String(a.url || '').trim() : '', branch = brVal(a, '') || undefined
  const group = mode === 'gitlab' ? glGroup(a) : '', rname = mode === 'gitlab' ? String(a.rname || repoSlug(name)).trim() : ''
  if (!name) { a.err = '이름을 쓴다'; render(); return }
  if (mode === 'url' && !url) { a.err = '저장소 주소를 넣거나 나중에'; render(); return }
  if (mode === 'gitlab' && (!glReady() || !group)) { a.err = 'GitLab 그룹을 고른다'; render(); return }
  if (mode === 'gitlab' && !REPO_NAME_RE.test(rname)) { a.err = '저장소 이름은 영문 · 숫자 · . _ - (영문이나 숫자로 시작)'; render(); return }
  a.busy = true; a.err = null; render()
  // 팀 저장소 — 비밀번호를 만들기 앞에서(그만두면 아무것도 만들지 않는다)
  if (isTeam() && mode !== 'later' && !(S.me && S.me.sudo)) {
    try { await askSudo(); S.me = { ...S.me, sudo: true } } catch (e) { a.busy = false; if (e.code !== 'E_CANCEL') a.err = e.message; render(); return }
  }
  try {
    const r = await postJSON('/api/knowledge/add', { kind: 'new', name, empty: true, backup: false })
    // 저장소는 지식이 선 뒤에 붙인다 — 못 붙여도 지식은 섰다(까닭 + [저장소] 로 지식 상세 › 저장소)
    let warn = '', repo = ''
    const kp = `/api/k/${encodeURIComponent(r.id)}`
    if (mode === 'url') await postJSON(kp + '/backup', { url, ...(branch ? { branch } : {}) }).then((x) => { repo = `${(x.backup && x.backup.url) || url} · 가지 ${(x.backup && x.backup.branch) || branch || 'main'}` }, (e) => { warn = e.code === 'E_CANCEL' ? '저장소는 붙이지 않았다' : `저장소는 붙이지 못했다: ${e.message}` })
    if (mode === 'gitlab') await postJSON(kp + '/backup/gitlab', { group, name: rname, ...(branch ? { branch } : {}) }).then((g) => { warn = glSay(g); if (g.made) repo = `${g.made.url} · 가지 ${g.made.branch}` }, (e) => { warn = e.code === 'E_CANCEL' ? '저장소는 붙이지 않았다' : `저장소는 붙이지 못했다: ${e.message}` })
    if (mode !== 'later') { delete S.cache.admin; loadStops() }
    await reloadKns()
    delete S.cache.history
    dropSettings()
    if (a.from === 'send' && !isTeam()) { S.addPop = null; S.route.kn = S.lastKn = r.id; S.sendSel = {}; S.sendWhole = {}; S.sendTab = 'rec'; toast(`만들었다: ${esc(r.name)} · 보내는 지식으로 골랐다`); render(); return }
    a.busy = false
    a.done = { id: r.id, name: r.name, warn, repo }
    S._focus = 'addDoneBtn'
  } catch (e) { a.busy = false; a.err = e.message }
  render()
}
// [불러오기] 창(5-2 · 8-3 · 지식관리 2) — 저장소 주소 · 가지 접기(비우면 저장소의 기본 가지) · 이름(비우면 주소 끝) · 연습(팀) · 길은 POST /api/restore { url, name, branch }(개인 · 총괄 관리자)
function rsWinHtml() {
  const busy = S.restoring, f = S.rs || (S.rs = { url: '', name: '', br: null, brOpen: false, practice: false })
  return `<div class="scrim fix" data-a="rsClose" data-self="1"${busy ? ' data-busy="1"' : ''}><div class="modal w420" role="dialog" aria-modal="true" aria-label="불러오기" data-t="rsWin"><div class="mh">불러오기${tipb('set.restore', '불러오기')}<button type="button" class="x" data-a="rsClose" title="닫기" aria-label="닫기">×</button></div><div class="mb"><div class="field" style="margin:0"><label for="rsUrl">저장소 주소</label><div class="row u-g3"><input class="inp mono u-f1" id="rsUrl" data-in="rsF" data-f="url" data-t="rsUrl" value="${esc(f.url)}" placeholder="${isTeam() ? '예: git@gitlab.team:kmd/dpms.git' : '예: E:\\kmd-백업\\설계메모.git'}" autocomplete="off">${brFold(f, 'rs', '기본')}</div>${brField(f, 'rs', '기본')}</div><div class="field" style="margin:var(--sp-5) 0 0"><label for="rsName">이름 <span class="muted">(비우면 주소의 끝)</span></label><input class="inp" id="rsName" data-in="rsF" data-f="name" data-t="rsName" value="${esc(f.name)}" autocomplete="off"></div><label class="small u-blk" style="margin-top:var(--sp-5)"><input type="checkbox" id="rsPractice" data-in="rsF" data-f="practice" data-t="rsPractice"${f.practice ? ' checked' : ''}> 연습(저장소에 보내지 않는다)</label></div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="rsClose">취소</button><button type="button" class="btn pri" data-a="restoreDo" data-t="restoreDo"${busy ? ' disabled' : ''}>${busy ? '불러오는 중…' : '불러오기'}</button></span></div></div></div>`
}
async function syncKn() {
  S.syncing = true; S.syncMsg = null; render()
  try {
    const r = await postJSON('/api/knowledge/sync', {})
    await reloadKns()
    S.cache = {}
    S.syncMsg = r.added.length ? { t: `<b>새 지식 ${r.added.length}: ${r.added.map((x) => esc(x.name)).join(' · ')}</b> · 메뉴 맨 아래에 두었다${r.gone.length ? ' · 없어진 폴더 ' + r.gone.length : ''}` } : { cls: 'gray', t: `<b>새로 놓인 지식이 없다</b>: 지식 ${r.total}${r.gone.length ? ' · 없어진 폴더 ' + r.gone.length + '(목록에서 뺐다)' : ''}` }
  } catch (e) { S.syncMsg = { cls: 'danger', t: esc(e.message) } }
  S.syncing = false
  render()
}
// 메뉴 순서 · 뺌 — 화면은 바로 바꾸고 서버에 적는다(사람마다)
async function saveMenu() {
  const own = S.kns
  try { await postJSON('/api/knowledge/menu', { order: own.map((x) => x.id), hidden: own.filter((x) => x.hidden).map((x) => x.id) }) } catch (e) { toastErr(e) }
}
function knMove(id, d) {
  const own = S.kns.filter((x) => !x.hidden), i = own.findIndex((x) => x.id === id), j = i + d
  if (i < 0 || j < 0 || j >= own.length) return
  knPlace(id, own[j].id, d > 0)
}
// id 를 to 앞(after 면 뒤)으로
function knPlace(id, to, after) {
  if (id === to) return
  const x = S.kns.find((k) => k.id === id)
  const rest = S.kns.filter((k) => k.id !== id)
  const at = rest.findIndex((k) => k.id === to)
  if (!x || at < 0) return
  rest.splice(after ? at + 1 : at, 0, x)
  S.kns = rest
  render()
  saveMenu()
}
function knHide(id, on) {
  const x = KN(id)
  if (!x) return
  if (on) x.hidden = true; else delete x.hidden
  // 다시 올린 지식은 메뉴 맨 아래로
  if (!on) S.kns = [...S.kns.filter((k) => k.id !== id && !k.hidden), x, ...S.kns.filter((k) => k.id !== id && k.hidden)]
  if (on && S.lastKn === id) S.lastKn = null
  render()
  saveMenu()
}

// ── 아직 없는 화면(뒤 판) ──
const LATER = {}
function viewLater(s) {
  return { crumb: LATER[s] || '지식 목록', main: `<div class="pg-text"><div class="big">${esc(LATER[s] || '')}</div><div class="callout gray" data-t="later">이 화면은 다음 판에 열린다. 지금은 문서로 보기에서 읽는다. <button type="button" class="lk" data-a="view" data-v="docs">문서로 보기 ›</button></div></div>` }
}
// ── 탭 줄 ──
function tabbarHtml() {
  const g = S.route.scr === 'graph'
  const tabs = S.tabs.map((t) => `<div class="tb1${t.id === S.active && !g ? ' on' : ''}${t.id === S.split && !g ? ' rt' : ''}" data-a="actTab" data-id="${t.id}" data-t="tab" data-name="${esc(tabTitle(t))}" title="${esc((KN(t.kn) ? KN(t.kn).name : '') + ' › ' + tabTitle(t))}${t.id === S.split ? ': 오른쪽에 나란히' : ''}">${tabIcon(t)}<span class="nm">${esc(tabTitle(t))}</span><button class="x" data-a="closeTab" data-id="${t.id}" data-t="tabX" title="닫기">×</button></div>`).join('')
  const menu = S.menu === 'tabs' ? popHtml('tabs', `<div data-t="tabMenu"><div class="mi" data-a="splitToggle" data-t="splitBtn">${S.split ? '나누기 닫기' : '나누어 보기'}<small>Ctrl \\</small></div><div class="mi" data-a="openQo">빨리 열기<small>Ctrl O</small></div><div class="sep"></div><div class="mi" data-a="closeOthers" data-t="closeOthers">다른 탭 모두 닫기</div></div>`) : ''
  return `<div class="tabbar" data-t="tabbar"><div class="tabs-s">${tabs || '<span class="none">열린 탭이 없다. 왼쪽에서 열거나 Ctrl O</span>'}</div><button class="tadd" data-a="openQo" data-t="tabAdd" title="빨리 열기 (Ctrl O)">+</button><button class="kebab${S.menu === 'tabs' ? ' on' : ''}" data-a="menu" data-m="tabs" data-t="tabKebab" title="나누어 보기 · 탭">⋯${menu}</button></div>`
}

// ── 보기 하나 — 문서로 보기 ──
function pickKn() {
  let k = S.route.kn
  if (!k || k === '*' || !KN(k)) { k = defaultKn(); S.route.kn = k }
  return k
}
function centerOf(emptyFn) {
  const t = activeTab()
  if (!t) { const e = emptyFn(); return { main: e.main, aside: e.aside, title: null } }
  const r = paneOf(t, false), st = S.split && tabOf(S.split)
  return { main: r.html, aside: r.aside, right: st ? paneOf(st, true).html : null, title: r.title }
}
function paneOf(t, right) {
  if (t.kind === 'doc') return docPane(t, right)
  if (t.kind === 'rec') return recPane(t, right)
  if (t.kind === 'item') return itemPane(t, right)
  return attPane(t, right)
}
function viewDocsV() {
  const k = pickKn()
  if (!k) return { crumb: '문서로 보기', tabs: true, main: viewHome().main }
  const c = centerOf(() => ({ main: docsEmpty(k), aside: knAside(k) }))
  return { crumb: '문서로 보기' + (c.title ? ' › ' + c.title : ''), main: c.main, aside: c.aside, right: c.right, tabs: true, left: treeHtml(k) }
}
// 그 지식의 가져올 곳 수 — 받지 못했으면(읽는 중 · 오류) 링크만 둔다
function knSrcN(k) {
  const v = need('sources', '/api/sources')
  if (!v || v.error || !Array.isArray(v.items)) return ''
  const n = v.items.filter((x) => x.kn === k).length
  return n ? n + ' · ' : '없음 · '
}
function knAside(k) {
  const team = isTeam() && !isPersonal(KN(k))
  return `<h4>속성</h4><div class="kv" data-t="knProps">${team ? `<span>쓰는 사람</span>${whoHtml(k)}` : '<span>주인</span><span>나: 저장하면 바로 문서에 들어간다</span>'}
  <span>자동수집</span><span data-t="knSrcN">${knSrcN(k)}<small><button type="button" class="lk" data-a="nav" data-s="import">생성 ›</button></small></span></div>`
}
function docsEmpty(k) {
  const n = KN(k), tr = treeOf(k)
  const ds = tr && tr.docs ? tr.docs : []
  if (tr && tr.error) return `<div class="pg-text"><div class="big">${esc(n.name)}</div>${errHtml(tr)}</div>`
  return `<div class="pg-text"><div class="big">${esc(n.name)}</div><p class="lead">${isPersonal(n) ? '내 지식' + (n.dir ? ' · ' + esc(n.dir) : '') + ' · 나만' : `팀 지식 · 나: ${lvChip(n)}`}</p>
  <div class="callout gray" data-t="docsEmpty">왼쪽 나무에서 문서나 기록을 연다. 여러 개를 탭으로 띄우고, <b>Ctrl \\</b> 로 둘을 나란히 본다. 이름으로 바로 열려면 <b>Ctrl O</b>.</div>
  ${tr && tr.readme ? `<div class="card" data-t="readmeCard"><div class="ch">먼저 읽을 것 <small>README</small></div><div class="cb paper">${tr.readme}</div></div>` : ''}
  ${staleCard(k)}
  <div class="card"><div class="ch">최근 바뀐 문서 <small>문서 ${tr ? ds.length : "…"}</small></div><div class="cb u-p1-7-2"><ul class="plain dl">${tr ? ds.slice(0, 5).map((d) => `<li data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="recentDoc" data-pv="doc|${esc(k)}|${esc(d.id)}">${svg('doc', 'di')}<span class="nm">${esc(d.title)}</span><span class="when${isToday(d.when) ? ' td' : ''}">${esc(whenTxt(d.when))}</span></li>`).join('') : `<li>${loadingHtml}</li>`}</ul></div></div>${removedCard(k)}${guardCard(k)}</div>`
}
// 지식 점검(지식관리자) — 지식 생성 가드가 보는 것의 지금 상태(문서 작성기준 9절 · core/guard.js audit)
const guardOf = (k) => need('guard:' + k, `/api/k/${encodeURIComponent(k)}/guard`)
// 줄 이름은 짧게(메뉴 개편 4-1) · 뜻은 넷째 칸(줄 이름의 title)
const GUARD_ROWS = [['unnamed', '항목 없음', 'rec', '건드린 항목이 없는 기록'], ['outside', '장부 밖', 'rec', '항목 장부에 없는 항목을 단 기록'], ['deprecatedUse', '폐기 항목', 'rec', '폐기된 항목을 단 안 넣은 기록'], ['lost', '잃은 항목', 'item', '문서에 머리가 없는 항목'], ['noName', '장부에 없는 항목', 'sec', '항목 장부에 오르지 않은 머리'], ['aliasClash', '별칭 겹침', 'word', '별칭이 둘 이상의 항목에 겹친다'], ['sameLabel', '같은 라벨(알림)', 'word', '라벨이 같은 항목이 둘 이상이다'], ['brokenHead', '깨진 머리', 'sec', '머리 꼴이 깨진 항목'], ['spaced', '빈칸 값', 'name', '값에 빈칸이 든 옛 항목'], ['brokenLink', '깨진 링크', 'sec', '없는 문서 · 항목을 가리키는 링크']]
function staleCard(k) {
  const n = KN(k), tr = treeOf(k)
  if (!n || !tr || tr.error || !(isPersonal(n) || n.level === 'admin')) return ''
  const day = 864e5, now = Date.now()
  const old = (tr.docs || []).filter((d) => d.when && now - Date.parse(d.when) > 180 * day).sort((a, b) => Date.parse(a.when) - Date.parse(b.when))
  if (!old.length) return ''
  return `<div class="card" data-t="staleCard"><div class="ch">오래 안 바뀐 문서 ${old.length} <small>180일 넘게</small>${tipb('home.stale', '오래 안 바뀐 문서')}</div><div class="cb u-p1-7-2"><ul class="plain dl">${old.slice(0, 8).map((d) => `<li><button type="button" class="lk" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}">${esc(d.title)}</button><span class="r small muted">${esc(whenTxt(d.when))}</span></li>`).join('')}</ul></div></div>`
}
// 최근에 지운 항목(UX T4-09 · 쓰기 자리부터) — 지운 때의 앞 판 글로 다시 세운다
function removedCard(k) {
  if (!canWrite(k)) return ''
  const r = need('removed:' + k, `/api/k/${encodeURIComponent(k)}/removed`)
  if (!r || r.error || !r.length) return ''
  return `<div class="card" data-t="removedCard"><div class="ch">최근에 지운 항목${tipb('home.removed', '최근에 지운 항목')}</div><div class="cb u-p1-7-3"><ul class="plain">${r.slice(0, 8).map((x) => `<li data-t="removedRow"><span class="u-f1"><b>${esc(x.docTitle)} › ${esc(x.heading)}</b><small class="muted u-blk">${esc(x.who)} · ${esc(whenTxt(x.at))}</small></span><button type="button" class="btn sm" data-a="restoreRemoved" data-k="${esc(k)}" data-r="${esc(x.rec)}" data-d="${esc(x.doc)}" data-v="${esc(x.heading)}" data-t="restoreRemoved">되살리기</button></li>`).join('')}</ul></div></div>`
}
// 점검 줄 — 지식 홈 카드(개인)와 점검 › 점검(팀)이 같이 쓴다 · [보기] 로 목록
function guardRowsHtml(k, g, keys) {
  const c = g.counts, open = S.guardOpen || ''
  const li = (kind, x) => {
    if (kind === 'rec') return `<li data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}" data-t="guardRec"><span class="nm">${esc(x.title)}</span><small class="muted">${esc(x.why || (x.names || []).join(' · '))}</small></li>`
    if (kind === 'item') return `<li data-a="openItem" data-k="${esc(k)}" data-n="${esc(x.coord)}" data-t="guardItem"><span class="nm"><span class="iv">${esc(x.coord)}</span></span><small class="muted">${esc(x.doc.replace(/^docs\/|\.md$/g, ''))} 에 「${esc(x.heading)}」 머리가 없다</small></li>`
    if (kind === 'sec') return `<li data-a="openDoc" data-k="${esc(k)}" data-d="${esc(x.doc)}" data-h="${esc(x.heading)}" data-t="guardSec"><span class="nm">${esc(x.doc)} › ${esc(x.heading)}</span></li>`
    if (kind === 'word') return `<li data-t="guardWord"><span class="nm">${esc(x.word)}</span><small class="muted">${x.names.map(esc).join(' · ')}</small></li>`
    return `<li data-t="guardName"><span class="nm"><span class="iv">${esc(x)}</span></span></li>`
  }
  return GUARD_ROWS.filter(([key]) => !keys || keys.includes(key)).map(([key, label, kind, why]) => `<div class="srow${c[key] ? '' : ' dim'}" data-t="guard-${key}"><span class="nm"${why ? ` title="${why}"` : ''}>${label}</span><span class="chip ${c[key] ? (GUARD_SOFT.includes(key) ? 'c-mute' : 'c-warn') : 'c-ok'}">${c[key]}</span>${c[key] ? `<button type="button" class="btn ghost sm" data-a="guardOpen" data-v="${key}" aria-expanded="${open === key}">${open === key ? '접기' : '보기'}</button>` : ''}</div>${open === key ? `<ul class="plain dl" data-t="guardList">${(g[key] || []).slice(0, 100).map((x) => li(kind, x)).join('')}${c[key] > 100 ? `<li class="muted small">그 밖에 ${c[key] - 100}: kmd guard ${esc(k)} --list</li>` : ''}</ul>` : ''}`).join('')
}
function guardCard(k) {
  const n = KN(k)
  if (!n || !(isPersonal(n) || n.level === 'admin')) return ''
  if (isTeam()) return '' // 팀은 점검 › 점검(메뉴 개편 N5)
  const g = guardOf(k)
  if (!g) return `<div class="card" data-t="guardCard"><div class="ch">점검</div><div class="cb">${loadingHtml}</div></div>`
  if (g.error) return `<div class="card" data-t="guardCard"><div class="ch">점검</div><div class="cb">${errHtml(g, 'guard:' + k)}</div></div>`
  const c = g.counts
  return `<div class="card" data-t="guardCard"><div class="ch">점검 <small>장부 항목 ${c.live} · 기록 ${c.records} · 문서 항목 ${c.sections} · 갈래 장부 ${g.forms.own ? g.forms.rows.length : '없음(기본 갈래)'}</small><button type="button" class="btn ghost sm r" data-a="guardRe" data-t="guardRe">다시 읽기</button></div><div class="cb u-p1-7-3">${guardRowsHtml(k, g)}</div></div>`
}
// 점검 › 점검 — 줄 묶음 넷(기록 · 장부 · 문서 · 낱말)마다 (!) 하나(화면에 다섯까지)
const GUARD_G = [['기록', 'chk.rec', ['unnamed', 'outside', 'deprecatedUse']], ['장부', 'chk.name', ['lost', 'spaced']], ['문서', 'chk.sec', ['noName', 'brokenHead', 'brokenLink']], ['낱말', 'chk.word', ['aliasClash', 'sameLabel']]]
function guardBodyHtml(k) {
  const g = guardOf(k)
  if (!g) return loadingHtml
  if (g.error) return errHtml(g, 'guard:' + k)
  const c = g.counts
  return `<div class="ck-sum small muted" data-t="guardSum">장부 항목 ${c.live} · 기록 ${c.records} · 문서 항목 ${c.sections}<button type="button" class="btn ghost sm" data-a="guardRe" data-t="guardRe">다시 읽기</button></div><div class="card" data-t="guardCard"><div class="cb u-p1-7-3">${GUARD_G.map(([l, tip, keys]) => `<div class="ck-g" data-t="ckGroup"><b>${l}</b>${tipb(tip, l)}</div>${guardRowsHtml(k, g, keys)}`).join('')}</div></div>`
}
// 문서 나무(컨벤션 5절) — docs/ 폴더 짜임 그대로. 폴더 먼저 · 이름 차례(숫자는 수로) · 처음은 접힘 · 지금 연 문서가 든 폴더는 펼침
//   펼침은 UI.dirs[지식:폴더] — 없으면 기본(지금 문서의 폴더면 펼침), true/false 는 사람이 고른 것
const CK = '<svg viewBox="0 0 24 24" class="ck" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>'
const fbtn = (on, attrs, label, title) => `<button type="button" class="fbtn" aria-pressed="${!!on}"${attrs}${title ? ` title="${esc(title)}"` : ''}>${CK}${label}</button>`
const byName = (a, b) => a.localeCompare(b, 'ko', { numeric: true })
function docTreeHtml(k, ds, q = '', tr = null) {
  const nq = norm(q)
  if (nq) ds = ds.filter((d) => norm(d.title).includes(nq) || norm(d.id).includes(nq))
  const root = { dirs: new Map(), docs: [], n: 0 }
  for (const d of ds) {
    const parts = d.id.split('/'), name = parts.pop()
    let node = root
    root.n++
    for (const p of parts) { if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), docs: [], n: 0 }); node = node.dirs.get(p); node.n++ }
    node.docs.push({ ...d, name })
  }
  // 차례 장부의 빈 폴더(문서 짜임) — 찾기 · 거르기 중에는 뺀다
  if (!nq && tr && tr.dirs) for (const p of tr.dirs) { let node = root; for (const x of p.split('/')) { if (!node.dirs.has(x)) node.dirs.set(x, { dirs: new Map(), docs: [], n: 0 }); node = node.dirs.get(x) } }
  const ord = (tr && tr.order) || {}
  const t = activeTab(), cur = t && t.kind === 'doc' && t.kn === k ? t.ref : ''
  const isOpen = (p) => { if (nq) return true; const v = UI.dirs[k + ':' + p]; return v != null ? v : cur.startsWith(p + '/') }
  const pad = (dep) => (dep ? ` style="--dep:${dep}"` : '')
  const walk = (node, pre, dep) => {
    let h = ''
    // 형제 차례 — 차례 장부(폴더는 끝에 /) 먼저 · 없으면 폴더 먼저 · 이름 차례
    const at = new Map((ord[pre] || []).map((x, i) => [x, i]))
    const sibs = [...[...node.dirs.keys()].map((x) => x + '/'), ...node.docs.map((d) => d.name)].sort((a, b) => { const ia = at.has(a) ? at.get(a) : Infinity, ib = at.has(b) ? at.get(b) : Infinity; if (ia !== ib) return ia - ib; if (a.endsWith('/') !== b.endsWith('/')) return a.endsWith('/') ? -1 : 1; return byName(a, b) })
    const docs = node.docs
    for (const sn of sibs) {
      if (sn.endsWith('/')) {
        const name = sn.slice(0, -1)
        const p = pre ? pre + '/' + name : name, c = node.dirs.get(name), open = isOpen(p)
      h += `<div class="tn dir" data-a="dirFold" data-p="${esc(p)}" data-t="dir" aria-expanded="${open}"${pad(dep)}><span class="ar" aria-hidden="true">${open ? '▾' : '▸'}</span>${svg('folder')}<span class="nm">${esc(name)}</span><span class="rc">${c.n}</span></div>`
        if (open) h += walk(c, p, dep + 1)
        continue
      }
      const d = docs.find((x) => x.name === sn)
      const twin = docs.filter((o) => o.title === d.title).length > 1
      h += `<div class="tn${isAct('doc', k, d.id) ? ' on' : ''}" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="doc" data-name="${esc(d.title)}" data-pv="doc|${esc(k)}|${esc(d.id)}"${pad(dep)}>${svg('doc')}<span class="nm" title="${esc(d.id)}">${esc(d.title)}${twin ? ` <small class="muted mono">${esc(d.name)}</small>` : ''}</span></div>`
    }
    return h
  }
  return walk(root, '', 0) || `<div class="tn muted nc" data-t="docNone">${q ? '맞는 문서가 없다' : '없다'}</div>`
}
const dirsOf = (ds) => [...new Set(ds.flatMap((d) => d.id.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))]
// 문서 보기(컨벤션 5절 옆 메뉴 짜임) — 보기 탭 「문서」 · 「기록」 이 이 목록 하나를 갈라 쓴다(UI.stab[지식] doc | rec) → 찾기 + 도구 아이콘 → 목록. 첨부는 문서 나무 끝 묶음
const stabOf = (k) => (UI.stab[k] === 'rec' ? 'rec' : 'doc')
// 찾기 칸 옆 도구 아이콘 — 눌린 것은 aria-pressed
const ltool = (attrs, ic, l, on) => `<button type="button" class="hb ltool"${attrs} title="${l}" aria-label="${l}"${on == null ? '' : ` aria-pressed="${!!on}"`}>${svg(ic)}</button>`
function treeHtml(k) {
  const tr = treeOf(k)
  if (!tr) return `<div class="tree" data-t="tree">${loadingHtml}</div>`
  if (tr.error) return `<div class="tree" data-t="tree">${errHtml(tr)}</div>`
  const st = stabOf(k), f = S.tfilt
  const ph = { doc: '문서 찾기: 제목 · 폴더 · 첨부', rec: '기록 찾기: 제목 · 쓴 사람' }[st]
  let tool = ''
  if (st === 'doc') {
    const dirs = dirsOf(tr.docs), allOpen = dirs.length && dirs.every((p) => UI.dirs[k + ':' + p])
    if (dirs.length) tool = ltool(' data-a="dirAll" data-t="dirAll"', allOpen ? 'fold' : 'unfold', allOpen ? '폴더 모두 접기' : '폴더 모두 펴기')
  } else tool = ltool(' data-a="tFilt" data-v="mine" data-t="tf-mine"', 'filter', '내가 쓴 것만', f.mine)
  // 나무 머리 [구조] — 문서 › 구조(개인 주인 · 팀 지식관리자 · 총괄 관리자 · 메뉴 개편 7절)
  if (canStruct(k)) { const on = S.route.scr === 'structure'; tool += `<button type="button" class="hb ltool${on ? ' on' : ''}" data-a="km" data-v="structure" data-t="treeStruct" title="구조" aria-label="구조"${on ? ' aria-current="page"' : ''}>${svg('pen')}</button>` }
  return `<div class="tree" data-t="tree"><div class="lhead"><div class="lfind"><input class="inp" id="treeQ" aria-label="${esc(ph.split(':')[0])}" data-in="treeQ" data-t="treeQ" value="${esc(S.tq)}" placeholder="${esc(ph)}" autocomplete="off">${tool}</div></div><div id="treeBody">${treeBody(k)}</div></div>`
}
// 첨부 묶음(문서 나무 끝) — 접고 편 것은 문서 폴더처럼 이 브라우저에(키 「지식://att」 · 폴더 이름과 겹치지 않는다)
function attGroupHtml(k, tr, nq) {
  const at = tr.atts.filter((a) => !nq || norm(a).includes(nq))
  if (!at.length) return ''
  const open = nq ? true : !!UI.dirs[k + '://att'] || tr.atts.some((a) => isAct('att', k, a))
  return `<div class="tn dir" data-a="dirFold" data-p="//att" data-t="attDir" aria-expanded="${open}"><span class="ar" aria-hidden="true">${open ? '▾' : '▸'}</span>${svg('clip')}<span class="nm">첨부</span><span class="rc">${at.length}</span></div>` + (open ? at.map((a) => `<div class="tn${isAct('att', k, a) ? ' on' : ''}" data-a="openAtt" data-k="${esc(k)}" data-v="${esc(a)}" data-t="att" style="--dep:1">${svg('clip')}<span class="nm">${esc(a)}</span></div>`).join('') : '')
}
function treeBody(k) {
  const tr = treeOf(k), st = stabOf(k), q = S.tq.trim(), nq = norm(q), f = S.tfilt
  if (st === 'doc') {
    const att = attGroupHtml(k, tr, nq)
    const docs = docTreeHtml(k, tr.docs, q, tr)
    return att && docs.includes('data-t="docNone"') ? att : docs + att
  }
  const rs = tr.records.filter((r) => (!f.mine || r.author === S.me.user) && (!nq || norm(r.title).includes(nq) || norm(r.author || '').includes(nq))), left = recLeft(tr)
  if (!tr.records.length) return `<div class="tn muted nc">${isTeam() ? '아직 없다' : '내 지식은 고치면 바로 문서다'}</div>`
  return (rs.map((r) => `<div class="tn${isAct('rec', k, r.id) ? ' on' : ''}" data-a="openRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="rec" data-state="${r.state}" data-pv="rec|${esc(k)}|${esc(r.id)}"><span class="dt">${esc(isToday(r.date) ? hhmm(r.date) : whenTxt(r.date))}</span><span class="nm">${esc(r.title.split(/ — |: /)[0])}</span></div>`).join('') || '<div class="tn muted nc">맞는 기록이 없다</div>') + (left && tr.next ? `<div class="tn more" data-a="treeMore" data-k="${esc(k)}" data-t="moreRecs"${S.wait['treeMore:' + k] ? ' aria-busy="true"' : ''}>${S.wait['treeMore:' + k] ? '읽는 중…' : `더 보기(남은 ${left})`}</div>` : '')
}
function rpHead() { return '<div class="rph"><i class="pd"></i>나란히 보기: 읽기만<button type="button" class="lk r small" data-a="closeSplit" data-t="closeSplit">나누기 닫기 ×</button></div>' }

// ── 오른쪽 칸: 개요 · 문서 · 기록 · 항목 · 속성 다섯 묶음(컨벤션 5절 · 2026-11-05) ──
//   화면(문서 · 항목 · 기록)마다 속은 다르다 · 처음은 모두 접힘 · 펼친 것은 화면 종류마다 이 브라우저에 남긴다(UI.ag)
//   지금 보는 것(이 문서 · 이 항목 · 이 기록 · 스크롤 중인 항목)은 그 묶음 안에서 「지금」 으로 표시한다
const AG_IC = { ol: 'list', docs: 'doc', recs: 'rec', items: 'tag', props: 'info' }
const AG_KIND = { doc: '이 문서', item: '이 항목', rec: '이 기록' }
// 남긴 값이 없으면 「개요」 만 펴 둔다 — 첫 화면에서 문서 짜임이 보이게(UX T2-16 · 정함)
const agOpen = (kind, g) => { const m = UI.ag[kind] || {}; return g in m ? !!m[g] : g === 'ol' }
// 출처 줄 — 참고 블록(문서 끝 <!-- kmd:참고 -->)이 적은 「어느 기록에서 들어왔나」 · 이름은 「출처」 하나(Q89)
function srcHtml(k, d, cur) {
  const s = d.sections.find((x) => x.h === cur) || null
  const row = (r) => r.id ? recRow(k, { id: r.id, title: r.title || r.id, date: r.date || '', author: '' }, { sub: r.note || '', t: 'srcRow' }) : `<div class="alr muted small" data-t="srcNote">${r.html || esc(r.note || '')}</div>`
  const mine = s && (s.refs || []).length ? agSub(`지금 보는 항목의 출처 · ${esc(s.h)}`, s.refs.length) + s.refs.map(row).join('') : ''
  const docs = d.refs && (d.refs.doc || []).length ? agSub('문서 전체의 출처', d.refs.doc.length) + d.refs.doc.map(row).join('') : ''
  return mine + docs
}
function agWrap(kind, gs) {
  const sec = gs.map((g) => {
    const on = agOpen(kind, g.id)
    return `<section class="ag${on ? ' open' : ''}" data-t="ag-${g.id}"><button type="button" class="agh" data-a="agToggle" data-k="${kind}" data-g="${g.id}" aria-expanded="${on}"><span class="ar" aria-hidden="true">▸</span><span class="agn">${g.t}</span>${g.n === '' || g.n == null ? '' : `<span class="agc" data-t="agN-${g.id}">${g.n}</span>`}</button>${on ? `<div class="agb">${g.body()}</div>` : ''}</section>`
  }).join('')
  const rail = gs.map((g) => `<button type="button" class="hb" data-a="agRail" data-k="${kind}" data-g="${g.id}" data-t="rlg-${g.id}" title="${g.t}${g.n === '' || g.n == null ? '' : ' ' + g.n}" aria-label="${g.t}">${svg(AG_IC[g.id])}</button>`).join('')
  return `<div class="agtop" data-t="agTop"><b>${AG_KIND[kind]}</b><button type="button" class="btn ghost sm" data-a="agFold" data-k="${kind}" data-t="agFold">모두 접기</button></div>${sec}<div class="arl" data-t="asideRailNav">${rail}</div>`
}
// 한 줄 — a(누르면 할 일) · nm(이미 고친 HTML) · sub · dt(날짜 칸) · ic · cur(지금) · spy(스크롤 따라 「지금」 이 옮겨 가는 줄)
function agRow(o) {
  const act = o.a && !(o.cur && !o.spy)
  return `<div class="alr${o.cur ? ' cur' : ''}"${act ? ` data-a="${o.a}" role="button" tabindex="0"` : ''}${o.attrs || ''} data-t="${o.t || 'agRow'}"${o.cur ? ' aria-current="true"' : ''}${o.spy != null ? ` data-spy="${esc(o.spy)}"` : ''}${o.pv && !o.cur ? ` data-pv="${o.pv}"` : ''}>${o.dt != null ? `<span class="dt">${esc(o.dt)}</span>` : o.ic ? svg(o.ic) : ''}<span class="nm">${o.nm}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span><span class="chip c-acc now">지금</span>${o.rc != null ? `<span class="rc">${o.rc}</span>` : ''}</div>`
}
const agSub = (t, n) => `<div class="bg">${t}${n == null ? '' : ` <b>${n}</b>`}</div>`
const agNone = '<div class="muted small alr">없다</div>'
const agKv = (pairs) => `<div class="kv">${pairs.filter(Boolean).map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('')}</div>`
const dt5 = (s) => whenTxt(s).replace(/^(오늘|어제) /, '')
const docRow = (k, id, title, x = {}) => agRow({ a: 'openDoc', attrs: ` data-k="${esc(k)}" data-d="${esc(id)}"${x.h ? ` data-h="${esc(x.h)}"` : ''}`, ic: 'doc', nm: esc(title), sub: x.sub, cur: x.cur, pv: `doc|${esc(k)}|${esc(id)}`, t: x.t })
// 기록 제목 「무엇: 어떻게」 — 무엇은 굵게 · 어떻게(결정 값)는 흐리게 한 줄 · 전체는 title(UX T2-09)
const recNm = (t) => { const m = String(t).match(/^(.+?)(: | — )(.+)$/); return m ? `<span title="${esc(t)}">${esc(m[1])} <small class="muted">${esc(m[3])}</small></span>` : esc(t) }
const recRow = (k, r, x = {}) => agRow({ a: 'openRec', attrs: ` data-k="${esc(k)}" data-r="${esc(r.id)}"`, dt: dt5(r.date), nm: recNm(r.title) + (r.state && r.state !== 'in' ? ' ' + recStateChip(k, r) : ''), sub: x.sub != null ? x.sub : r.author, cur: x.cur, pv: `rec|${esc(k)}|${esc(r.id)}`, t: x.t || 'agRec' })
const itemRow = (k, it, x = {}) => agRow({ a: 'openItem', attrs: ` data-k="${esc(k)}" data-n="${esc(it.key)}"`, ic: 'tag', nm: inmHtml(it), sub: x.sub, cur: x.cur, spy: x.spy, rc: x.rc, pv: `item|${esc(k)}|${esc(it.key)}`, t: x.t || 'agItem' })
// 문서 화면 — 스크롤 중인 항목(S.curSec)
const curSecOf = (t, d) => (S.curSec && S.curSec.tab === t.id && d.sections.some((s) => s.h === S.curSec.h) ? S.curSec.h : (d.sections[0] || {}).h)
function docAside(k, d, t) {
  const bl = d.backlinks, m = M(k)
  const cur = curSecOf(t, d)
  const order = new Map(d.sections.map((s, i) => [s.h, i]))
  const its = m ? m.items.filter((i) => i.doc === d.id).sort((a, b) => (order.get(a.sec) ?? 1e9) - (order.get(b.sec) ?? 1e9)) : []
  const hist = bl.recs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const nDocs = 1 + (d.links || []).length + bl.linkers.length + bl.ments.length
  return agWrap('doc', [
    { id: 'ol', t: '개요', n: d.sections.length, body: () => d.sections.map((s) => agRow({ a: 'scrollSec', attrs: ` data-h="${esc(s.h)}"`, nm: esc(s.h), cur: s.h === cur, spy: s.h, t: 'olRow' })).join('') || agNone },
    { id: 'docs', t: '문서', n: nDocs, body: () => agSub('이 문서') + docRow(k, d.id, d.title, { cur: true, sub: d.path.replace(/^docs\/|[^/]*$/g, '').replace(/\/$/, ''), t: 'agDocMe' })
      + agSub('이 문서가 가리키는 문서', (d.links || []).length) + ((d.links || []).map((x) => docRow(k, x.id, x.title, { t: 'dlink' })).join('') || agNone)
      + agSub('이 문서를 가리키는 문서', bl.linkers.length) + (bl.linkers.map((o) => docRow(k, o.id, o.title, { t: 'blDoc' })).join('') || agNone)
      + (bl.ments.length ? agSub('이름이 나온 곳', bl.ments.length) + bl.ments.map((x) => docRow(k, x.d, `${x.title} › ${x.h}`, { h: x.h, sub: `「${x.x}」`, t: 'blMent' })).join('') : '') },
    { id: 'recs', t: '기록', n: hist.length, body: () => srcHtml(k, d, cur) + agSub('이 문서의 이력 · 새것 위') + (hist.map((r) => recRow(k, r, { t: 'blRec' })).join('') || agNone) + `<div class="muted small alr">항목마다 옛 값 → 새 값 · 되돌리기는 <button type="button" class="lk" data-a="nav" data-s="today">이력</button>에서</div>` },
    { id: 'items', t: '항목', n: its.length, body: () => agSub('이 문서의 항목', its.length) + (its.map((i) => itemRow(k, i, { cur: i.sec === cur, spy: i.sec })).join('') || agNone) },
    { id: 'props', t: '속성', n: '', body: () => agKv([
      ['지금 보는 항목', `<b data-t="curSec">${esc(cur || '')}</b>`],
      ['마지막으로 바뀜', esc(d.last ? whenTxt(d.last.date) + ': ' + d.last.author + '의 기록에서' : whenTxt(d.when))],
      ['폴더', esc(d.path.replace(/^docs\/?|[^/]*$/g, '').replace(/\/$/, '') || '-')],
      ['가져올 곳', d.watched ? esc(d.watched.src) + (d.watched.orphan ? ': 없어졌다' : '') : '없음'],
      ['자리', esc(knWhere(KN(k)) || (isTeam() ? '팀 서버' : '이 PC'))],
      isTeam() && !isPersonal(KN(k)) ? ['쓰는 사람', whoHtml(k)] : null,
      ['항목', String(its.length || d.items || 0)],
    ]) },
  ])
}
// 스크롤 따라 「지금 보는 항목」 — 가운데 위쪽에 걸린 ## 머리(맨 아래면 마지막) · 다시 그리지 않고 줄 표시만 옮긴다
function spySec() {
  const t = activeTab()
  const main = $('#app .main[data-t=main]')
  if (!t || t.kind !== 'doc' || !main) return
  const hs = [...main.querySelectorAll('h2[data-sec]')]
  if (!hs.length) return
  const top = main.getBoundingClientRect().top + 72
  let cur = hs[0]
  for (const h of hs) if (h.getBoundingClientRect().top <= top) cur = h
  const winBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2
  if (main.scrollTop + main.clientHeight >= main.scrollHeight - 2 && (main.scrollHeight > main.clientHeight || winBottom)) cur = hs[hs.length - 1]
  const h = cur.dataset.sec
  if (S.curSec && S.curSec.tab === t.id && S.curSec.h === h) return
  S.curSec = { tab: t.id, h }
  for (const el of document.querySelectorAll('#app .aside [data-spy]')) { const on = el.dataset.spy === h; el.classList.toggle('cur', on); if (on) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current') }
  const c = $('#app .aside [data-t=curSec]')
  if (c) c.textContent = h
}
document.addEventListener('scroll', () => { if (S.route && S.route.scr === 'docs') spySec() }, true)

// 문서 폭 — 기본(글 읽기 좋은 폭) · 넓게(가운데 칸 전체) · 문서 · 항목 · 기록 같은 값
const wideSeg = () => `<span class="wseg" role="group" aria-label="문서 폭" data-t="wideSeg"><button type="button" data-a="docWide" data-v="0" aria-pressed="${!UI.wide}" title="글 읽기 좋은 폭" data-t="wideOff">${svg('narrow')}기본 폭</button><button type="button" data-a="docWide" data-v="1" aria-pressed="${!!UI.wide}" title="가운데 칸을 다 쓴다(넓은 표 · 그림)" data-t="wideOn">${svg('wide')}넓게</button></span>`

// 그래프 — 본문 오른쪽 위 접힌 단추 · 누르면 한 겹 이웃 팝업 · 점을 누르면 그 문서 · 항목 · 기록이 열린다
function nbOf(k, c) {
  if (!M(k)) return null
  const G = graphData(k, { q: '', item: true, doc: true, rec: true, recent: false, orph: false }, true)
  const nb = []
  G.edges.forEach((e) => { if (e.a === c && !nb.includes(e.b)) nb.push(e.b); if (e.b === c && !nb.includes(e.a)) nb.push(e.a) })
  const nm = {}
  G.nodes.forEach((n) => (nm[n.id] = n))
  return { nb: nb.filter((id) => nm[id]), nm, me: nm[c] || { kind: 'doc', label: '?' } }
}
function gdockHtml(k, c) {
  const x = nbOf(k, c)
  const n = x ? x.nb.length : '…'
  return `<div class="gdock" data-t="gDock"><button type="button" class="gbtn" data-a="gPop" data-t="gPopBtn" aria-expanded="${!!S.gPop}" aria-controls="gPop">${svg('graph')}그래프 <span class="muted small">${n}</span><span aria-hidden="true">${S.gPop ? '▴' : '▾'}</span></button>${S.gPop ? `<div class="gpop" id="gPop" role="dialog" aria-label="그래프: 한 겹 이웃" data-t="gPop"><div class="gph"><b>한 겹 이웃</b><span class="muted small">점을 누르면 그것이 열린다</span><button type="button" class="hb" data-a="gPop" data-t="gPopX" aria-label="그래프 접기">×</button></div>${x ? popGraph(k, c, x) : loadingHtml}<div class="gpf">${['doc', 'item', 'rec'].map((kd) => `<span>${glyphIcon(kd)}${KLAB[kd]}</span>`).join('')}<button type="button" class="btn ghost sm r" data-a="openGraph" data-n="${esc(c)}" data-t="gPopBig">그래프 화면에서 크게</button></div></div>` : ''}</div>`
}
function popGraph(k, c, x) {
  const sh = x.nb.slice(0, 16), W = 380, H = 260, cx = W / 2, cy = H / 2 - 6
  const pos = sh.map((id, i) => { const a = (i / Math.max(sh.length, 1)) * Math.PI * 2 - Math.PI / 2; return [cx + Math.cos(a) * 150, cy + Math.sin(a) * 92] })
  const lab = (s) => esc(String(s).length > 12 ? String(s).slice(0, 12) + '…' : s)
  return `<svg class="gpsvg" viewBox="0 0 ${W} ${H}" role="group" aria-label="이웃 ${x.nb.length}">${pos.map((p) => `<line x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`).join('')}${sh.map((id, i) => `<g class="gnd" data-a="gNode" data-k="${esc(k)}" data-n="${esc(id)}" data-t="gNode" tabindex="0" role="button" aria-label="${esc(x.nm[id].label)} 열기"><title>${esc(x.nm[id].label)}</title>${glyphSvg(x.nm[id].kind, pos[i][0], pos[i][1], 6)}<text x="${pos[i][0].toFixed(1)}" y="${(pos[i][1] + 17).toFixed(1)}" text-anchor="middle">${lab(x.nm[id].label)}</text></g>`).join('')}<g class="gnd me">${glyphSvg(x.me.kind, cx, cy, 9)}<text x="${cx}" y="${cy - 14}" text-anchor="middle" class="c">${lab(x.me.label)}</text></g></svg>${x.nb.length > 16 ? `<div class="small muted gpm">이웃 ${x.nb.length} · 16 만 보인다</div>` : ''}`
}
// 본문의 문서 · 항목 링크에 미리보기 카드(이 지식 안)
const pvLinks = (h, k) => String(h).replace(/(<a class="dlink (?:doc|item)" data-a="openDoc" data-k="[^"]*" data-d="([^"]*)")/g, (m, a, d) => `${a} data-pv="doc|${esc(k)}|${d}"`)
// 큰 문서(Q97) — 3초마다 다시 그려도 항목 글(항목 링크 · 미리보기 표시)을 다시 만들지 않는다. 받은 항목(s) · 항목 장부(M) 가 같으면 그대로
const secMemo = new WeakMap()
function secInner(k, s, it) {
  const m = M(k) || null, key = it ? it.key : null
  const c = secMemo.get(s)
  if (c && c.m === m && c.key === key) return c.html
  const html = pvLinks(linkify(s.html, k, key), k)
  secMemo.set(s, { m, key, html })
  return html
}
// 문서 · 머리 → 항목(장부마다 한 번 짓는다 · 항목 311개 × 장부 줄 수를 매번 훑지 않게)
const itemIdx = new WeakMap()
function itemAt(k, doc, sec) {
  const m = M(k)
  if (!m) return null
  let x = itemIdx.get(m)
  if (!x) { x = new Map(); for (const i of m.items) { const key = i.doc + '|' + i.sec; if (!x.has(key)) x.set(key, i) } itemIdx.set(m, x) }
  return x.get(doc + '|' + sec) || null
}
function docPane(t, right) {
  const k = t.kn, n = KN(k), d = docOf(k, t.ref)
  if (!d) return { html: loadingHtml, title: tabTitle(t) }
  if (d.error) return { html: d.code === 'E_NOTFOUND' ? `<div class="callout gray" data-t="docGone"><span>이 문서는 이제 없다. 지워졌거나 이름이 바뀌었다</span><button type="button" class="lk r" data-a="closeTab" data-id="${esc(t.id)}">탭 닫기</button></div>` : errHtml(d, `doc:${k}:${t.ref}`), title: t.ref }
  const hl = right ? null : t.hl, q = right ? null : t.q
  const flashH = right ? null : t.flashH
  if (flashH) t.flashH = null
  const loc = isTeam() ? n.name + ' › ' + d.title : n.name + ' › ' + d.path.replace(/^docs\//, '')
  const editing = !right && S.edit && S.edit.tab === t.id
  const de = editing ? docEdOf(k, t.ref) : null
  const body = editing && !de
    ? loadingHtml
    : editing && de.error
    ? errHtml(de, `doc:${k}:${t.ref}:ed`)
    : editing
    ? `<div class="ed" data-t="editor"><div class="lbl"><b>고치는 중</b> · 「## 」 으로 시작하는 줄이 항목 이름이다 · md 로 쓴다. **굵게** · - 목록 · [링크](주소) · Ctrl S 저장 · Esc 취소</div><div class="toolbar"><button class="btn sm" data-a="edAddSec" data-t="edAddSec">항목 더하기</button><button class="btn sm${S.edit.preview ? ' on' : ''}" data-a="edPreview" data-t="edPreview" aria-pressed="${!!S.edit.preview}">바뀐 것 보기</button><span class="muted small">${de.structure ? '항목을 지우려면 그 「## 」 줄과 글을 지운다 · 이름을 바꾸려면 「## 」 줄만 고친다' : '항목을 지우거나 이름을 바꾸는 일은 지식관리자가 한다'}</span></div><textarea id="edTx" aria-label="문서 글(md)" data-in="edTx" data-t="edTx" spellcheck="false"${S.edit.busy ? ' readonly aria-busy="true"' : ''}>${esc(edText(de))}</textarea>
   ${de.sections.filter((s) => s.locks).map((s) => `<div class="lockh">항목 「${esc(s.h)}」 의 표: 회색은 잠겨 있다</div>${s.locks}`).join('')}
   <div class="row" style="margin-top:var(--sp-5)"><button class="btn pri" data-a="saveDoc" data-t="saveBtn"${S.edit.busy ? ' disabled' : ''}>${S.edit.busy ? '저장하는 중…' : '저장'}</button><button class="btn ghost" data-a="cancelEdit" data-t="cancelEdit"${S.edit.busy ? ' disabled' : ''}>취소</button><input id="edWhy" data-in="edWhy" data-t="edWhy" maxlength="200" class="inp edwhy" placeholder="바꾼 까닭(선택) · 예: 10-21 주간회의에서 배포 창 변경" aria-label="바꾼 까닭" value="${esc(S.edit.why || '')}"><span class="r small muted" data-t="edNote">${svApprove(k) ? '저장하면 확인 창 뒤 문서에 들어간다' : '저장하면 바로 문서에 들어간다 · 이력에 남는다'}</span></div>${S.edit.preview ? `<div class="edprev" data-t="edPrev"><div class="small muted">저장하면 바뀌는 것(저장 전 · 막지 않는다)</div>${edPreviewHtml(k, de)}</div>` : ''}${S.edit.err ? formErr(S.edit.err, 'edErr') : ''}${(S.edit.errSecs || []).length ? `<div class="row" data-t="edErrSecs">${S.edit.errSecs.map((h) => `<button type="button" class="btn sm" data-a="edGoSec" data-v="${esc(h)}">「${esc(h)}」 로</button>`).join('')}</div>` : ''}${(S.edit.conflict || []).length ? `<div class="callout warn" data-t="edConflict"><div><b>그사이 바뀐 글</b>${S.edit.conflict.map((c) => `<div class="small"><b>${esc(c.h)}</b><pre class="cfpre">${esc(c.theirs)}</pre></div>`).join('')}<div class="row"><button class="btn sm pri" data-a="edForce" data-t="edForce">내 글로 저장</button><button class="btn sm" data-a="edTheirs" data-t="edTheirs">그쪽 글로</button></div></div></div>` : ''}</div>`
    : d.sections.map((s) => {
    // 찾기로 연 것만 「찾은 곳」 · 링크 · 개요로 연 항목은 머리를 잠깐 빛낸다
    const lit = q && hl && s.h === hl
    const it = itemAt(k, d.id, s.h)
    // 가운데는 문서 내용만(컨벤션 5절 · 2026-11-05) — 머리 줄에는 항목 이름만. 출처 · 기록 · 이력은 오른쪽 칸 다섯 묶음으로
    const inner = secInner(k, s, it)
    const newerTx = ''
    return `<section class="dsec"><div class="hrow"><h2 data-sec="${esc(s.h)}"${!q && flashH && s.h === flashH ? ' class="flash"' : ''}>${esc(s.h)}</h2></div>${newerTx}${lit ? `<div class="lit" data-t="lit"><span class="tag">찾은 곳</span>${inner}</div>` : inner}</section>`
  }).join('')
  // ## 항목이 없는 문서(맨 위가 ###) — 글이 모두 머리글이라 편집기가 빈 칸으로 열린다 · 고치기 · 다듬기를 막고 까닭을 보인다
  const noSec = !d.sections.length
  const oldShape = noSec && /<h[3-6][\s>]/.test(d.intro || '') // ## 없이 ### 로 시작하는 옛 문서 — 화면에서 고치면 글이 섞인다
  const main = `<div class="docw" data-t="docPane" data-name="${esc(d.title)}">${right ? rpHead() : ''}
  ${q ? `<div class="found" data-t="found"><span>찾기 <b>‘${esc(q)}’</b> 로 열었다</span><button type="button" class="lk" data-a="reopenSearch">찾은 것으로 돌아가기</button></div>` : ''}
  <div class="ttl"><div class="path"><span>${esc(loc)}</span></div>${right ? '' : wideSeg()}${!right && !isTeam() && KN(k) && KN(k).dir ? `<button type="button" class="btn ghost sm" data-a="copyDocPath" data-v="${esc(KN(k).dir + '\\' + String(d.path).split('/').join('\\'))}" data-t="copyDocPath" title="편집기로 고쳐도 된다: 저장하면 곧 들어간다">파일 경로 복사</button>` : ''}${editing || right || d.watched || noSec || !isTeam() || isPersonal(KN(k)) || lvOf(KN(k)) !== 'admin' ? '' : `<button class="btn" data-a="polishDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="polishBtn"${KN(k).noClaude ? ' disabled title="Claude 에 보내지 않는 지식: 다듬기는 팀 일꾼(Claude)이 한다 · 지식관리 › 모든 지식 › 지식 상세 › 정책에서 바꾼다"' : ' title="팀 일꾼이 문체 · 짜임만 정돈한다 · 값은 그대로"'}>다듬기</button>`}${editing || right || !isTeam() ? '' : `<button type="button" class="btn ghost sm" data-a="watchDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-v="${esc(d.title)}" data-t="watchDoc" aria-pressed="${!!watchList()[k + '|' + d.id]}" title="남이 이 문서를 바꾸면 알린다(이 브라우저)">${watchList()[k + '|' + d.id] ? '지켜보는 중' : '지켜보기'}</button>`}${editing || right ? '' : `<button type="button" class="btn ghost sm" data-a="pastOpen" data-k="${esc(k)}" data-d="${esc(d.id)}" data-v="${esc(d.title)}" data-t="pastOpen" title="이 문서의 옛 판 · 지금과 견주기">옛 판</button>`}${editing || right || d.watched ? '' : `<button class="btn pri" data-a="editDoc" data-t="editBtn"${oldShape ? ' disabled title="## 항목이 없는 옛 문서: 화면에서 고칠 수 없다"' : roAttr(k)}>고치기</button>`}</div>
  ${d.watched && d.watched.orphan ? `<div class="callout warn stop" data-t="watchedOrphan"><i></i><span><b>원본이 없어졌다</b>: 가져오던 곳 「${esc(d.watched.src)}」 이 지워졌다 · 내 문서로 하면 고칠 수 있다</span><button class="btn sm r" data-a="unwatchDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="unwatchBtn">내 문서로</button></div>` : ''}${d.watched && !d.watched.orphan ? `<div class="callout ${d.watched.missing ? 'warn' : 'gray'} stop" data-t="watched"><i></i><span><b>${d.watched.missing ? `원본에 없다: ${esc(d.watched.missing)} 부터` : '원본이 주인이다'}</b>: ${esc(d.watched.src)} 의 <span class="mono">${esc(d.watched.path)}</span> 에서 온다 · 고치려면 원본 파일을 고친다 · 덧붙일 말은 기록으로 남긴다</span></div>` : ''}
  ${right || editing ? '' : gdockHtml(k, 'd:' + d.id)}<div class="paper"><h1>${esc(d.title)}</h1><div class="docmeta muted small" data-t="docMeta">${d.last ? `${esc(whenTxt(d.last.date))} 바뀜 · ${esc(d.last.author)}` : d.when ? `${esc(whenTxt(d.when))} 바뀜(파일 날짜)` : ''}</div>${noSec && !oldShape && !editing && !right ? '<div class="callout gray" data-t="newDocEdit">빈 문서다. [고치기] 로 첫 항목(## 머리 + 글)을 쓴다</div>' : ''}${oldShape && !editing && !right ? '<div class="callout gray" data-t="noSecEdit">이 문서는 ## 항목이 없어 화면에서 고칠 수 없다. 맨 위 ### 머리를 ## 로 올리면 항목으로 나뉜다</div>' : ''}${d.intro ? `<div class="dlead" data-t="docLead">${pvLinks(linkify(d.intro, k, null), k)}</div>` : ''}${body}</div></div>`
  return { html: main, aside: right ? null : docAside(k, d, t), title: d.title }
}
function recPane(t, right) {
  const k = t.kn, r = recOf(k, t.ref)
  if (!r) return { html: loadingHtml, title: tabTitle(t) }
  if (r.error) return { html: r.code === 'E_NOTFOUND' ? '<p class="muted" data-t="recGone">이 기록은 이제 없다. 다른 이름으로 남았을 수 있다</p>' : errHtml(r, `rec:${k}:${t.ref}`), title: '기록' }
  const fx = r.fixes[0], fb = r.fixedBy, who = (w) => (w === S.me.user ? '나' : w)
  const html = `<div class="docw" data-t="recPane" data-name="${esc(r.title)}">${right ? rpHead() : ''}<div class="ttl"><div class="path"><span>${esc(KN(k).name)} › ${r.log ? '이력' : '기록'} › ${esc(r.date)}</span><span class="r">${r.ingest && !r.ingest.read && !isTeam() && !right && !svApprove(k) ? `<button class="btn sm" data-a="readRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="readRec"${S.reading && S.reading[r.id] ? ' disabled' : ''} title="넣은 파일을 Claude 가 읽고 무엇 · 핵심 · 정한 것 · 남은 것 + 본문으로 기록을 다시 쓴다">${S.reading && S.reading[r.id] ? 'Claude 가 읽는 중…' : 'Claude 로 기록 정리'}</button> ` : ''}${recFixOk(k, r) && !right ? `<button type="button" class="btn sm" data-a="recFix" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="recFixBtn" title="원래 기록은 두고 정정 기록을 새로 남긴다">고치기</button> ` : ''}${r.log ? `<span class="chip c-mute" data-t="recLog">이력 · ${esc(r.log)}: kmd 가 한 일</span>` : ''}${recStateChip(k, r)}</span></div>${right ? '' : wideSeg()}</div>
  ${right ? '' : gdockHtml(k, 'r:' + r.id)}<div class="paper"><h1>${esc(r.title)}</h1><div class="docmeta muted small" data-t="recMeta">${esc(who(r.author))} · ${esc(recDt(r.date))}${r.state ? ' · ' + esc(recStateTx(k, r)) : ''}</div>${linkify(r.html, k, null)}</div></div>`
  // 가운데는 기록 글만(2026-11-05) — 쓴 사람 · 때 · 상태 · 정정은 오른쪽 칸으로
  const went = r.went || [], via = r.via || [], from = r.from || []
  // 개요 — 기록 본문의 머리(## · ###)와 수준 표시 1 ~ 3 줄
  const heads = [...String(r.html || '').matchAll(/<h([2-4])[^>]*>([\s\S]*?)<\/h\1>|<div class="lv l([1-3])" data-lv="([^"]*)"/g)].map((m) => (m[1] ? { lv: +m[1] - 1, tx: m[2].replace(/<[^>]+>/g, '').trim() } : { lv: +m[3], tx: m[4].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') })).filter((x) => x.tx)
  const nRecs = 1 + (fx ? 1 : 0) + fb.length + via.length + from.length
  const aside = agWrap('rec', [
    { id: 'ol', t: '개요', n: heads.length, body: () => heads.map((x) => agRow({ a: 'scrollTx', attrs: ` data-v="${esc(x.tx)}"`, nm: esc(x.tx), t: 'olRec', sub: '' })).join('') || agNone },
    { id: 'docs', t: '문서', n: went.length, body: () => agSub(r.log ? '이 일이 넣은 문서' : '이 기록이 들어간 문서') + (went.map((d) => docRow(k, d.id, d.title, { h: d.hs[0] || '', sub: `항목 ${d.hs.length}: ${d.hs.slice(0, 3).join(' · ')}${d.hs.length > 3 ? ' …' : ''}`, t: 'wentDoc' })).join('') || `<div class="muted small alr">없다</div>`) },
    { id: 'recs', t: '기록', n: nRecs, body: () => agSub('이 기록') + recRow(k, r, { cur: true, sub: who(r.author), t: 'recMe' })
      + agSub('바로잡은 · 바로잡힌 기록', (fx ? 1 : 0) + fb.length) + ((fx ? recRow(k, fx, { sub: '이 기록이 바로잡음', t: 'fixRow' }) : '') + fb.map((x) => recRow(k, x, { sub: '이 기록을 바로잡음', t: 'fixRow' })).join('') || agNone)
      + (via.length ? agSub('이 기록을 넣은 kmd 기록', via.length) + via.map((x) => recRow(k, x, { sub: `${x.author} 가 넣었다`, t: 'viaRec' })).join('') : '')
      + (from.length ? agSub('이 일이 넣은 기록', from.length) + from.map((x) => recRow(k, x, { sub: x.author, t: 'fromRec' })).join('') : '') },
    { id: 'items', t: '항목', n: r.items.length, body: () => agSub(r.log ? '이 일이 건드린 항목' : '이 기록이 건드린 항목', r.items.length) + (r.items.map((i) => agRow({ a: 'openItem', attrs: ` data-k="${esc(k)}" data-n="${esc(i.coord)}"`, ic: 'tag', nm: esc(i.name), sub: i.docTitle || '문서가 없는 항목', pv: `item|${esc(k)}|${esc(i.coord)}`, t: 'recItem' })).join('') || agNone) },
    { id: 'props', t: '속성', n: '', body: () => agKv([
      ['종류', r.log ? '이력: kmd 가 한 일' : '기록'],
      ['쓴 사람', esc(who(r.author))],
      ['때', esc(r.date)],
      ['상태', `<span data-t="recStateTx">${esc(recStateTx(k, r))}</span>`],
      (r.tags || []).length ? ['태그', esc(r.tags.join(' · '))] : null,
    ]) },
  ])
  return { html, aside: right ? null : aside, title: r.title.split(/ — |: /)[0] }
}
// 기록 상태(설계 4-8 · 저장 승인 P11 · P12) — 칩 · 속성 말: 들어감(c-ok) · 바로잡힘(c-ok) · 되돌림 · 저장 승인 전 기록(old)은 칩 없이 「기록」
function recStateTx(k, r) {
  return { fixed: '바로잡힘: 나중 기록이 고쳤다', reverted: '되돌림', in: '문서에 들어감', none: 'kmd 가 한 일', old: '기록' }[r.state] || '기록'
}
function recStateChip(k, r) {
  const c = { fixed: ['ok', '바로잡힘'], reverted: ['rest', '되돌림'], in: ['ok', '문서에 들어감'] }[r.state]
  return c ? chipOf(c[0], c[1], ` data-t="recState" title="${esc(recStateTx(k, r))}"`) : ''
}
// 기록 고치기(정정 기록 · S9 · 설계 4-3) — 팀 지식 · 쓰기 이상 · 이력이 아닌 기록 · 내가 쓴 기록이거나 지식관리자(서버도 같은 판정)
const recFixOk = (k, r) => isTeam() && !r.log && canWrite(k) && (r.author === S.me.user || lvOf(KN(k)) === 'admin')
// 옛 판(UX T4-10) — 판 목록 → 그때의 글 · [지금과 견주기](항목마다 빠진 줄 · 더한 줄)
function pastDiff(a, b) {
  const split = (t) => { const m = new Map(); let h = '(머리말)'; m.set(h, []); for (const l of String(t).split('\n')) { const x = /^##\s+(.+?)\s*$/.exec(l); if (x) { h = x[1]; m.set(h, []) } else m.get(h).push(l) } return m }
  const A = split(a), B = split(b), out = []
  for (const [h, al] of A) { const bl = B.get(h); const aa = al.filter((l) => l.trim()), bb = (bl || []).filter((l) => l.trim()); if (bl && aa.join('\n') === bb.join('\n')) continue; out.push({ h, gone: !bl, del: aa.filter((l) => !bb.includes(l)), add: bb.filter((l) => !aa.includes(l)) }) }
  for (const [h, bl] of B) if (!A.has(h)) out.push({ h, isNew: true, del: [], add: bl.filter((l) => l.trim()) })
  return out
}
function pastHtml() {
  const w = S.past, k = w.k
  const L = need(`past:${k}:${w.d}`, `/api/k/${encodeURIComponent(k)}/past?d=${encodeURIComponent(w.d)}`)
  const V0 = w.at ? need(`past:${k}:${w.d}:${w.at}`, `/api/k/${encodeURIComponent(k)}/past?d=${encodeURIComponent(w.d)}&at=${w.at}`) : null
  const list = !L ? loadingHtml : L.error ? errHtml(L, `past:${k}:${w.d}`) : !L.versions.length ? '<p class="muted">git 에 남은 판이 없다</p>' : `<ul class="plain past-l" data-t="pastList">${L.versions.map((v, i) => `<li><button type="button" class="past-v${w.at === v.sha ? ' on' : ''}" data-a="pastPick" data-v="${esc(v.sha)}" aria-pressed="${w.at === v.sha}" data-t="pastVer"><b>${esc(whenTxt(v.at))}${i === 0 ? ' · 지금' : ''}</b><small class="muted u-blk">${esc(v.who)} · ${esc(v.msg)}</small></button></li>`).join('')}</ul>`
  let view = '<p class="muted">왼쪽에서 판을 고른다</p>'
  if (w.at) view = !V0 ? loadingHtml : V0.error ? errHtml(V0, `past:${k}:${w.d}:${w.at}`) : w.cmp ? (() => { const ch = pastDiff(V0.md, V0.cur); return ch.length ? ch.map((c) => `<div class="diff"><div class="fh">${esc(c.h)}${c.isNew ? ' · 그 뒤 새로' : c.gone ? ' · 그 뒤 지움' : ''}</div>${c.del.map((l) => `<div class="ln2 del">${esc(l)}</div>`).join('')}${c.add.map((l) => `<div class="ln2 add">${esc(l)}</div>`).join('')}</div>`).join('') : '<p class="muted">지금과 같다</p>' })() : `<div class="paper">${V0.html}</div>`
  const tools = w.at && V0 && !V0.error ? `<div class="seg in" data-t="pastSeg"><button type="button" class="${w.cmp ? '' : 'on'}" data-a="pastCmp" data-v="">그때의 글</button><button type="button" class="${w.cmp ? 'on' : ''}" data-a="pastCmp" data-v="1" data-t="pastCmp">지금과 견주기</button></div>` : ''
  return `<div class="scrim fix" data-a="pastClose" data-self="1"><div class="modal w760" role="dialog" aria-modal="true" data-t="pastWin"><div class="mh">옛 판 <small>${esc(w.title || w.d)}</small><button type="button" class="x" data-a="pastClose" title="닫기" aria-label="닫기">×</button></div><div class="mb past-b"><div class="past-side">${list}</div><div class="past-main">${tools}${view}</div></div><div class="mf"><span class="small muted">읽기만 · 되돌리려면 이력의 [되돌리기]</span><span class="acts"><button type="button" class="btn ghost" data-a="pastClose">닫기</button></span></div></div></div>`
}
function recFixHtml() {
  const w = S.recFix
  const busy = w.busy ? ' data-busy="1"' : ''
  return `<div class="scrim fix" data-a="recFixClose" data-self="1"${busy}><div class="modal w560" role="dialog" aria-modal="true" data-t="recFixWin"><div class="mh">기록 고치기 <small>${esc(w.title)}</small><button type="button" class="x" data-a="recFixClose" title="닫기" aria-label="닫기">×</button></div><div class="mb"><p class="small muted mt0">원래 기록은 그대로 두고 정정 기록을 새로 남긴다 · 옛 값이 그 항목에 한 곳이면 바로 문서에 넣고, 아니면 팀 일꾼이 넣는다</p><div class="field"><label for="rfFrom">옛 값</label><input class="inp" id="rfFrom" data-in="rfFrom" data-t="rfFrom" value="${esc(w.from)}" placeholder="예: 3초" autocomplete="off"></div><div class="field"><label for="rfTo">새 값</label><input class="inp" id="rfTo" data-in="rfTo" data-t="rfTo" value="${esc(w.to)}" placeholder="예: 5초" autocomplete="off"></div><div class="field" style="margin-bottom:0"><label for="rfBody">고친 내용</label><textarea class="inp" id="rfBody" rows="4" data-in="rfBody" data-t="rfBody" placeholder="무엇을 왜 바로잡나(md)">${esc(w.body)}</textarea></div>${w.err ? formErr(w.err, 'recFixErr') : ''}</div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="recFixClose" data-t="recFixCancel">취소</button><button type="button" class="btn pri" data-a="recFixSave" data-t="recFixSave"${w.busy ? ' disabled' : ''}>${w.busy ? '저장하는 중…' : '저장'}</button></span></div></div></div>`
}
async function recFixSave() {
  const w = S.recFix
  if (!w || w.busy) return
  const from = w.from.trim(), to = w.to.trim()
  if (!!from !== !!to) { w.err = '옛 값과 새 값은 같이 적는다'; render(); return }
  if (from && from === to) { w.err = '옛 값과 새 값이 같다'; render(); return }
  if (!from && !w.body.trim()) { w.err = '고친 내용이나 옛 값 → 새 값을 적는다'; render(); return }
  w.busy = true
  w.err = null
  render()
  try {
    const r = await postJSON(`/api/k/${encodeURIComponent(w.k)}/rec/${encodeURIComponent(w.rec)}/fix`, { body: w.body, ...(from ? { from, to } : {}) })
    S.recFix = null
    forgetKn(w.k)
    toast(esc(r.job ? '팀 일꾼에게 넘겼다: 넣으면 이력에 남는다' : r.rule ? `정정 기록을 남겼다 · 규칙 길: ${r.rule}` : `정정 기록을 남겼다 · 문서 ${r.put || 0}곳에 넣었다`), 7000)
  } catch (e) {
    if (S.recFix) { S.recFix.busy = false; if (e.code !== 'E_CANCEL') S.recFix.err = e.message }
  }
  render()
}
const extOf = (n) => { const m = String(n).toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : '' }
function attPane(t, right) {
  const ext = extOf(t.ref), img = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
  return {
    html: `<div class="docw" data-t="attPane">${right ? rpHead() : ''}<div class="ttl"><div class="path"><span>${esc(KN(t.kn).name)} › 첨부 › ${esc(t.ref)}</span></div></div><div class="paper"><h1>${esc(t.ref)}</h1>${img ? `<img class="attimg" data-att="${esc(t.ref)}" data-ak="${esc(t.kn)}" alt="${esc(t.ref)}">` : `<div class="attph">${esc(ext)} 첨부: 원본 그대로 둔다</div>`}</div></div>`,
    aside: right ? null : `<div class="ap"><h4>속성</h4><div class="kv"><span>종류</span><span>${esc(ext)}</span><span>자리</span><span>첨부</span></div></div>`,
    title: t.ref,
  }
}

// ── 빨리 열기(Ctrl O) ──
function openQo() { leaveGate(); S.pal = null; S.cmd = null; S.menu = null; S.qo = { q: '', sel: 0 }; render() }
function qoList() {
  const q = (S.qo.q || '').trim(), nq = norm(q)
  // 범위 — 지식 화면이면 그 지식, 아니면(또는 「모든 지식」 을 고르면) 모든 지식(UX T5-04)
  const one = !S.qo.all && KNSCR.includes(S.route.scr) && S.route.kn && S.route.kn !== '*' && KN(S.route.kn)
  S.qo.scope = one ? KN(S.route.kn).name : '모든 지식'
  const ks = one ? [S.route.kn] : S.kns.filter((x) => !x.dim).map((x) => x.id), out = []
  // 건너뛴 지식 — 읽는 중 · 못 읽음(결과가 비어도 「없다」 라고 하지 않게)
  S.qo.wait = 0; S.qo.bad = []
  ks.forEach((k) => {
    const tr = treeOf(k)
    if (!tr) { S.qo.wait++; return }
    if (tr.error) { S.qo.bad.push(k); return }
    const kn = KN(k).name
    tr.docs.forEach((d) => out.push({ kind: 'doc', label: d.title, sub: kn + ' · 문서', k, ref: d.id }))
    // 「문서 + 항목」 꼴(배포 절차 롤백) — 문서 제목과 항목 이름을 이은 이름으로도 찾는다
    if (q) itemsOf(k).forEach((i) => { const d = i.doc && tr.docs.find((x) => x.id === i.doc); if (d) out.push({ kind: 'item', label: d.title + ' ' + i.name, sub: kn + ' · 항목', k, ref: i.key, joined: true }) })
    itemsOf(k).forEach((i) => { if (i.table && !q) return; out.push({ kind: 'item', label: i.val && !sameTxt(i.val, i.name) ? `${i.short} ${i.name}` : i.name, sub: kn + ' · 항목 · ' + i.kind, k, ref: i.key, alias: [...i.aliases, ...(i.val ? [i.val] : [])] }) })
    tr.records.forEach((r) => out.push({ kind: 'rec', label: r.title, sub: kn + ' · 기록 · ' + whenTxt(r.date), k, ref: r.id }))
  })
  if (!q) { const rec = recentGet().map((r) => out.find((x) => x.kind === r.kind && x.k === r.k && x.ref === r.ref)).filter(Boolean).map((x) => ({ ...x, sub: '최근 본 것 · ' + x.sub })); const seen = new Set(rec.map((x) => x.kind + x.k + x.ref)); return [...rec, ...out.filter((x) => x.kind !== 'rec' && !seen.has(x.kind + x.k + x.ref))].slice(0, 14) }
  const ord = { doc: 0, item: 1, rec: 2 }
  const sc = (x) => { const l = norm(x.label); if (l === nq) return 0; if (l.startsWith(nq)) return 1; if (l.includes(nq)) return 2; if ((x.alias || []).some((a) => norm(a).includes(nq))) return 3; return 9 }
  const seen = new Set()
  return out.map((x) => Object.assign({ s: sc(x) + (x.joined ? 0.5 : 0) }, x)).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).filter((x) => { const key = x.kind + '|' + x.k + '|' + x.ref; if (seen.has(key)) return false; seen.add(key); return true }).sort((a, b) => a.s - b.s || ord[a.kind] - ord[b.kind]).slice(0, 30)
}
function qoBody() {
  const L = qoList()
  S.qo.list = L
  if (S.qo.sel >= L.length) S.qo.sel = Math.max(0, L.length - 1)
  const bad = S.qo.bad || []
  const top = (S.qo.wait ? loadingHtml : '') + (bad.length ? `<div class="callout danger err" data-t="qoErr">${sayErr(`지식 ${bad.length} 을 읽지 못했다`)}<b>지식 ${bad.length} 을 읽지 못했다: ${esc(bad.map(knNm).join(' · '))}</b><button type="button" class="btn sm retry" data-a="qoRetry" data-t="retry">다시 읽기</button></div>` : '')
  if (!L.length) return top || `<div class="empty" data-t="qoNone"><b>${esc(S.qo.scope)}에는 이 이름이 없다</b>글 속 낱말은 Ctrl K 찾기로${S.qo.scope !== '모든 지식' ? ' · <button type="button" class="btn ghost sm" data-a="qoAll" data-t="qoAll">모든 지식에서 찾기</button>' : ''}</div>`
  return top + '<div role="listbox" id="qoList" aria-label="찾은 이름">' + L.map((x, i) => `<div class="qr${i === S.qo.sel ? ' sel' : ''}" role="option" id="qo-o${i}" aria-selected="${i === S.qo.sel}" tabindex="-1" data-a="qoPick" data-i="${i}" data-t="qoRow" data-kind="${x.kind}" data-name="${esc(x.label)}"><span class="qk">${x.kind === 'doc' ? svg('doc') : x.kind === 'item' ? svg('tag') : '<i class="pd"></i>'}</span><span class="nm">${esc(x.label)}</span><span class="r small muted">${esc(x.sub)}</span></div>`).join('') + '</div><div class="ft">문서 · 항목 · 기록 이름으로 연다. ↑↓ 로 고르고 Enter · 글 속 낱말은 <b>Ctrl K</b></div>'
}
function qoHtml() { const scope = !S.qo.all && KNSCR.includes(S.route.scr) && S.route.kn && S.route.kn !== '*' && KN(S.route.kn) ? KN(S.route.kn).name : '모든 지식'; return `<div class="pscrim" data-a="qoClose" data-self="1"><div class="pal" data-t="qo"><div class="pin">${svg('search')}<span class="kt" data-t="qoScope" title="찾는 범위">${esc(scope)}</span><input id="qoIn" role="combobox" aria-expanded="true" aria-controls="qoList" aria-autocomplete="list" aria-activedescendant="qo-o${S.qo.sel || 0}" aria-label="빨리 열기: 이름" data-in="qo" data-t="qoIn" value="${esc(S.qo.q)}" placeholder="빨리 열기: 문서 · 항목 · 기록 이름" autocomplete="off"><span class="r">↑↓ · Enter · Esc</span></div><div id="qoBody">${qoBody()}</div></div></div>` }
function qoPick(i) {
  const x = S.qo && S.qo.list && S.qo.list[i]
  S.qo = null
  if (!x) { render(); return }
  openTab({ kind: x.kind, kn: x.k, ref: x.ref })
  render()
  scrollTopMain()
}

// ── 명령 창(Ctrl P) ──
function openCmd() { leaveGate(); S.pal = null; S.qo = null; S.menu = null; S.cmd = { q: '', sel: 0 }; render() }
function cmdDefs() {
  return [
    { n: '생성', s: '수기수집 · 자동수집: 파일 · 문서 폴더 · 소스 코드 · DB', f: () => go({ scr: 'import' }) },
    { n: '새 지식', s: '이름 하나로 새 지식', f: () => openAdd() },
    { n: '나누어 보기', s: 'Ctrl \\: 두 탭을 나란히', f: () => toggleSplit() },
    { n: '그래프 열기', s: '옆 메뉴: 그래프 탭', f: () => setView('graph') },
    { n: '문서로 보기', s: '옆 메뉴: 목차 탭', f: () => setView('docs') },
    { n: '항목으로 보기', s: '옆 메뉴: 항목 탭', f: () => setView('items') },
    { n: '빨리 열기', s: 'Ctrl O', f: () => openQo() },
    { n: '찾기', s: 'Ctrl K', f: () => openPal() },
    { n: '이력', s: '고른 지식에서 바뀐 것 · 값 바뀜', f: () => go({ scr: 'today' }) },
    ckKn() && { n: '점검', s: KN(ckKn()).name + ' · 점검 · 지표', f: () => kmGo('held', ckKn(), 'check') },
    ckKn() && admKn(ckKn()) && { n: '지표', s: KN(ckKn()).name + ' · 새로 생긴 것 · 받아들인 경고 · 규칙 길 …', f: () => kmGo('held', ckKn(), 'metrics') },
    !isTeam() && { n: '공유', s: '내 개인 지식 → 팀 지식', f: () => go({ scr: 'send' }) },
    { n: '설정', s: '', f: () => openSettings() },
    { n: '모든 지식', s: '지식관리', f: () => go({ scr: 'home', kn: '*' }) },
    { n: '탭 닫기', s: '지금 탭', f: () => { if (S.active) closeTab(S.active); render() } },
    { n: '이전으로', s: 'Alt ←', f: () => histGo(-1) },
    { n: '다음으로', s: 'Alt →', f: () => histGo(1) },
  ]
}
function cmdList() { const nq = norm(S.cmd.q || ''); return cmdDefs().filter(Boolean).filter((c) => !nq || norm(c.n).includes(nq)) }
function cmdBody() {
  const L = cmdList()
  S.cmd.list = L
  if (S.cmd.sel >= L.length) S.cmd.sel = Math.max(0, L.length - 1)
  if (!L.length) return '<div class="empty" data-t="cmdNone"><b>그런 명령은 없다</b>다른 말로: 예: 그래프 · 나누어</div>'
  return '<div role="listbox" id="cmdList" aria-label="명령">' + L.map((c, i) => `<div class="qr${i === S.cmd.sel ? ' sel' : ''}" role="option" id="cmd-o${i}" aria-selected="${i === S.cmd.sel}" tabindex="-1" data-a="cmdPick" data-i="${i}" data-t="cmdRow" data-name="${esc(c.n)}"><span class="qk">›</span><span class="nm">${esc(c.n)}</span><span class="r small muted">${esc(c.s)}</span></div>`).join('') + '</div>'
}
function cmdHtml() { return `<div class="pscrim" data-a="cmdClose" data-self="1"><div class="pal" data-t="cmd"><div class="pin"><span class="qk">›</span><input id="cmdIn" role="combobox" aria-expanded="true" aria-controls="cmdList" aria-autocomplete="list" aria-activedescendant="cmd-o${S.cmd.sel || 0}" aria-label="명령 이름" data-in="cmd" data-t="cmdIn" value="${esc(S.cmd.q)}" placeholder="명령 창: 화면의 일을 이름으로" autocomplete="off"><span class="r">↑↓ · Enter · Esc</span></div><div id="cmdBody">${cmdBody()}</div></div></div>` }
function cmdPick(i) { const c = S.cmd && S.cmd.list && S.cmd.list[i]; S.cmd = null; render(); if (c) c.f() }

// ── 찾기(Ctrl K) ──
function scopeKn() { const k = S.route.kn; return k && k !== '*' && KN(k) && KNSCR.includes(S.route.scr) ? k : null }
function openPal(q) { leaveGate(); S.qo = null; S.cmd = null; S.menu = null; S.pal = { q: q || '', res: null }; settingsOf(); render(); if (q) runFind() }
let findT = null
function runFind() {
  clearTimeout(findT)
  const q = S.pal.q.trim()
  if (!q) { S.pal.res = null; paintPal(); return }
  findT = setTimeout(async () => {
    const k = scopeKn()
    try {
      const r = await getJSON(`/api/find?q=${encodeURIComponent(q)}${k ? '&k=' + encodeURIComponent(k) : ''}`)
      if (S.pal && S.pal.q.trim() === q) { S.pal.res = r; paintPal() }
    } catch (e) { if (S.pal) { S.pal.res = { error: e.message }; paintPal(); const h = document.getElementById('srLive'); if (h) h.textContent = '찾지 못했다: ' + e.message } }
  }, 120)
}
// 별칭을 더할 수 있는 지식 — 찾은 범위(하나면 그것) 가운데 쓰기 자리 이상
const palAliasKns = () => { const k = scopeKn(); return (k ? [KN(k)] : shownKns()).filter((n) => n && canWrite(n.id)) }
async function palAliasGo() {
  const q = S.pal && S.pal.q.trim(); if (!q) return
  if (q.length > 60 || /[`|,\r\n]/.test(q)) { toast('<b>별칭은 60자 안 · 쉼표 · ` · | 없이</b>', 0, true); return }
  const ks = palAliasKns()
  let k = ks.length === 1 ? ks[0].id : await ask({ t: '어느 지식의 항목인가', select: { label: '지식', options: ks.map((n) => [n.id, n.name]), value: ks[0].id }, ok: '다음' })
  if (!k) return
  let m = M(k)
  if (!m) { try { S.cache['model:' + k] = await getJSON(`/api/k/${encodeURIComponent(k)}/model`); m = M(k) } catch (e) { toastErr(e); return } }
  const part = await ask({ t: `「${q}」 를 별칭으로 달 항목`, d: '항목 이름이나 값의 일부를 쓴다(예: 롤백 · DPMS-ISS-15)', input: { label: '항목', value: '' }, ok: '찾기' })
  if (!part || !part.trim()) return
  const w = norm(part.trim())
  const hits = m.items.filter((i) => i.coord && (norm(i.name).includes(w) || norm(i.val || '').includes(w) || (i.aliases || []).some((a) => norm(a).includes(w)))).slice(0, 40)
  if (!hits.length) { toast(`<b>「${esc(part.trim())}」 가 든 항목이 없다</b> · 장부에 오른 항목만 별칭을 단다`, 0, true); return }
  const coord = hits.length === 1 ? hits[0].coord : await ask({ t: '항목 고르기', d: `맞는 항목 ${hits.length}${hits.length === 40 ? '(앞 40)' : ''}`, select: { label: '항목', options: hits.map((i) => [i.coord, `${i.name} · ${i.coord}`]), value: hits[0].coord }, ok: '더하기' })
  if (!coord) return
  const it = hits.find((i) => i.coord === coord)
  const kadm = lvOf(KN(k)) === 'admin' || !isTeam()
  const input = { record: { title: `별칭 더하기: ${q} → ${it.name}`.slice(0, 120), body: `찾기에서 「${q}」 로 찾은 것이 없어 ${it.name}(${coord}) 의 별칭으로 더한다.`, touches: [coord] }, names: [{ coord, label: it.name, aliases: [q] }] }
  try {
    await postJSON(`/api/k/${encodeURIComponent(k)}/learn`, { q, coord })
    // 승인 저장 지식(저장 승인 P5) — 항목 장부의 별칭은 지식관리자가 저장 확인 창에서 넣는다 · 쓰기 자리는 찾기에 배운 것까지
    if (svApprove(k)) {
      if (!kadm) { toast(`<b>찾기에 배웠다</b> · 이 말로 ${esc(it.name)} 가 찾힌다. 항목 장부의 별칭은 지식관리자가 더한다`, 9000); runFind(); return }
      const kk = encodeURIComponent(k)
      return svOpen({
        k, fields: null,
        again: () => postJSON(`/api/k/${kk}/propose`, input),
        send: (proposal) => postJSON(`/api/k/${kk}/save`, { ...input, proposal }),
        done: () => { delete S.cache['model:' + k]; toast(`<b>「${esc(q)}」 를 ${esc(it.name)} 의 별칭으로 더했다</b> · 이제 이 말로 찾힌다`, 9000); runFind() },
      })
    }
    const r = await postJSON(`/api/k/${encodeURIComponent(k)}/save`, input)
    delete S.cache['model:' + k]
    toast(r && kadm ? `<b>「${esc(q)}」 를 ${esc(it.name)} 의 별칭으로 더했다</b> · 이제 이 말로 찾힌다` : `<b>찾기에 배웠다</b> · 이 말로 ${esc(it.name)} 가 찾힌다`, 9000)
    runFind()
  } catch (e) { toastErr(e) }
}
function paintPal() { const b = $('#palBody'); if (b) b.innerHTML = palBody() }
function palHtml() {
  const k = scopeKn(), where = k ? KN(k).name + '에서' : '지식 전체에서'
  return `<div class="pscrim" data-a="palClose" data-self="1"><div class="pal" data-t="pal"><div class="pin">${svg('search')}<input id="palIn" aria-label="찾을 말" data-in="pal" data-t="palIn" value="${esc(S.pal.q || '')}" placeholder="찾기" autocomplete="off"><span class="r">${esc(where)} · Esc</span></div><div id="palBody">${palBody()}</div><div class="pft" data-t="palFoot">${autoSw('find', '비슷한 글')}</div></div></div>`
}
// md 를 읽는 글로(링크 [글](주소) → 글 · 굵게 · 코드 · 머리 · 표 줄 기호 · 목록 표시 걷기)
function plainMd(t) {
  return String(t || '').split('\n').filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l)).map((l) => l.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '').replace(/^\s*\|(.*)\|\s*$/, (m, x) => x.split('|').map((c) => c.trim()).filter(Boolean).join(' · '))).join(' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/`([^`]+)`/g, '$1').replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g, ' ').trim()
}
function snip(b, toks) { let h = esc(plainMd(b)); (toks || []).forEach((x) => { if (x) h = h.split(esc(x)).join('<mark>' + esc(x) + '</mark>') }); return h }
function nameHits(q) {
  const nq = norm(q)
  if (!nq) return []
  const out = []
  const ks = scopeKn() ? [scopeKn()] : S.kns.map((x) => x.id)
  for (const k of ks) {
    const tr = treeOf(k)
    if (!tr || tr.error) continue
    for (const d of tr.docs) { const l = norm(d.title), l2 = norm(d.id); if (l === nq || l2 === nq || l.startsWith(nq) || l2.startsWith(nq)) out.push({ kind: 'doc', k, ref: d.id, label: d.title, s: l === nq || l2 === nq ? 0 : 1 }) }
    for (const i of itemsOf(k)) { const l = norm(i.name), v = norm(i.val || ''); if (l === nq || l.startsWith(nq) || (v && (v === nq || v.startsWith(nq)))) out.push({ kind: 'item', k, ref: i.key, label: i.val && !sameTxt(i.val, i.name) ? `${i.short} ${i.name}` : i.name, s: l === nq || v === nq ? 0 : 1 }) }
  }
  return out.sort((a, b) => a.s - b.s).slice(0, 5)
}
function palBody() {
  const r = S.pal.res
  if (!S.pal.q.trim() || !r) return '<div class="tip">문서의 항목 이름이나 낱말을 친다. 예: 헬스 체크 · 상태 점검</div>'
  if (r.error) return `<div class="callout danger err" data-t="palErr"><b>찾지 못했다: ${esc(r.error)}</b><button type="button" class="btn sm retry" data-a="palRetry" data-t="retry">다시 찾기</button></div>`
  const nh = nameHits(S.pal.q.trim())
  const names = nh.length ? `<div class="g" data-t="gName">이름이 맞는 것</div>${nh.map((x) => `<div class="hit" data-a="palName" data-kind="${x.kind}" data-k="${esc(x.k)}" data-v="${esc(x.ref)}" data-t="nameHit"><div class="ht"><b>${esc(x.label)}</b><span class="tg">${x.kind === 'doc' ? '문서' : '항목'}</span><span class="r">${esc((KN(x.k) || {}).name || '')}</span></div></div>`).join('')}` : ''
  if (!r.hits.length && names) return names
  if (!r.hits.length) return '<div class="empty" data-t="none"><b>이 말로는 못 찾았다. 없다는 뜻은 아니다</b>다른 말이나 문서 목록으로<br><button type="button" class="lk" data-a="palDocs">문서 목록 ›</button><button type="button" class="lk" data-a="palQo" data-t="palQo">빨리 열기로 이름 찾기 ›</button><button type="button" class="lk" data-a="palClear">다른 말로 다시 ›</button>' + (palAliasKns().length ? `<div class="pal-alias" data-t="palAliasBox">맞는 항목을 안다면: <button type="button" class="btn sm" data-a="palAlias" data-t="palAlias">「${esc(S.pal.q.trim().slice(0, 40))}」 을 항목의 별칭으로 더하기</button><small class="muted u-blk">다음부터 이 말로 찾힌다 · 영문 · 줄임말 · 바꿔 말한 말</small></div>` : '') + '</div>'
  const hit = (x, i) => {
    const tags = (x.alias && x.exact ? '<span class="tg nm">별칭</span>' : '') + (x.r ? '<span class="tg">기록</span>' : '')
    const at = x.r ? `data-r="${esc(x.r)}"` : `data-d="${esc(x.d)}" data-h="${esc(x.h)}"${x.coord ? ` data-c="${esc(x.coord)}"` : ''}`
    return `<div class="hit${i === 0 ? ' sel' : ''}" data-a="openHit" data-k="${esc(x.k)}" ${at} data-t="hit"><div class="ht"><b>${esc(x.title)}${x.h ? ' › ' + esc(x.h) : ''}</b>${tags}${x.r && x.state && x.state !== 'in' ? ' ' + recStateChip(x.k, { state: x.state }) : ''}<span class="r">${esc(x.kn)}</span></div><div class="tx">${snip(x.text, r.toks)}</div></div>`
  }
  const pf = S.palF || 'all'
  const fbar = `<div class="tools" data-t="palFilter">${[['all', '모두'], ['doc', '문서만'], ['rec', '기록만']].map(([v, l]) => `<button type="button" class="fbtn" data-a="palF" data-v="${v}" aria-pressed="${pf === v}">${l}</button>`).join('')}</div>`
  const hs = r.hits.filter((x) => pf === 'all' || (pf === 'rec' ? !!x.r : !x.r))
  if (r.exact) return `${names}${fbar}<div class="g" data-t="gExact">문서의 항목</div>${hs.map(hit).join('')}`
  const N = hs.length, more = S.pal.more, sh = more ? hs : hs.slice(0, 5)
  return `${names}${fbar}<div class="g" data-t="gSim">딱 맞는 항목이 없어 비슷한 글에서 찾았다</div>${sh.map(hit).join('')}<div class="ft" data-t="simCount">비슷한 글 ${N}개${N > 5 ? (more ? ': 모두 보인다' : `: 5개 · <button type="button" class="lk" data-a="palMore" data-t="palMore">${N - 5}개 더 보기</button>`) : ''}</div>`
}

// ───────────── 지식 한 벌의 모양 — 항목 · 기록 · 쓰는 곳(서버 /model) ─────────────
const modelOf = (k) => need('model:' + k, `/api/k/${encodeURIComponent(k)}/model`)
// 모델을 받지 못했으면 그 오류(M(k) 는 null 이라 「읽는 중」 과 가르지 못한다) — 그리는 곳이 errHtml(modelErr(k), 'model:' + k)
const modelErr = (k) => { const m = modelOf(k); return m && m.error ? m : null }
function M(k) {
  const m = modelOf(k)
  if (!m || m.error) return null
  if (!m._ix) {
    m._ix = true
    m.byKey = new Map(m.items.map((i) => [i.key, i]))
    m.recById = new Map(m.recs.map((r) => [r.id, r]))
    m.docById = new Map(m.docs.map((d) => [d.id, d]))
    m.recsByItem = new Map()
    for (const r of m.recs) for (const key of r.items) (m.recsByItem.get(key) || m.recsByItem.set(key, []).get(key)).push(r)
    // 항목 이름 = 값 + 설명(디자인 컨벤션 5절) — 값은 `종류:값` 의 「:」 뒤 · 같은 값이 둘 이상이면 짧은 이름에 종류를 붙인다
    const nv = {}
    for (const i of m.items) { i.val = i.coord ? i.coord.slice(i.coord.indexOf(':') + 1) : null; if (i.val) nv[i.val] = (nv[i.val] || 0) + 1 }
    for (const i of m.items) i.short = i.val ? (nv[i.val] > 1 ? i.coord : i.val) : i.name
  }
  return m
}
const itemsOf = (k) => (M(k) ? M(k).items : [])
const sameTxt = (a, b) => norm(a || '') === norm(b || '')
function inmHtml(i) {
  if (!i.val) return `<span class="id1">${esc(i.name)}</span>`
  return `<span class="iv">${esc(i.short)}</span>${sameTxt(i.val, i.name) || sameTxt(i.short, i.name) ? '' : `<span class="id" title="${esc(i.name)}">${esc(i.name)}</span>`}`
}
const itemHit = (i, nq) => norm(i.name).includes(nq) || (i.val && norm(i.val).includes(nq)) || (i.coord && norm(i.coord).includes(nq)) || i.aliases.some((a) => norm(a).includes(nq))
const itemByKey = (k, key) => (M(k) ? M(k).byKey.get(key) || null : null)
const recsOfItem = (k, i) => (i && M(k) ? M(k).recsByItem.get(i.key) || [] : [])
const usesOf = (k, i) => ((M(k) && M(k).uses[i.key]) || []).map((x) => itemByKey(k, x)).filter(Boolean)
const firstLine = (k, i) => i.first || (recsOfItem(k, i)[0] ? recsOfItem(k, i)[0].title : '아직 글이 없다')
const recDt = (d) => (isToday(d) ? hhmm(d) : whenTxt(d))
function coItems(k, it) {
  const c = {}
  recsOfItem(k, it).forEach((r) => r.items.forEach((o) => { if (o !== it.key) c[o] = (c[o] || 0) + 1 }))
  return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => ({ it: itemByKey(k, key), n })).filter((x) => x.it)
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
// 글 속 항목 이름 → 항목 링크(이름 · 별칭 · 2자 이상 · 테이블과 자기 자신은 빼고) — 링크(<a>) 안은 건드리지 않는다
function linkify(h, k, self) {
  const m = M(k)
  if (!m) return h
  if (!m._lmap) {
    m._lmap = {}
    m.items.forEach((i) => { if (i.table) return; [i.name, ...i.aliases].forEach((a) => { if (a && a.length >= 2 && !m._lmap[a]) m._lmap[a] = i.key }) })
    const keys = Object.keys(m._lmap).sort((a, b) => b.length - a.length)
    m._lre = keys.length ? new RegExp(keys.map((x) => reEsc(esc(x))).join('|'), 'g') : null
    m._lrev = Object.fromEntries(Object.entries(m._lmap).map(([a, key]) => [esc(a), key]))
  }
  if (!m._lre) return h
  // 건너뛰는 곳 — 링크(<a>) 안 · 서버가 이미 항목으로 감싼 항목 값(<span class="ilink coord">) 안
  let inA = 0, inIl = 0
  return h.split(/(<[^>]+>)/).map((p) => {
    if (p.charAt(0) === '<') {
      if (/^<a[\s>]/i.test(p)) inA++
      else if (/^<\/a>/i.test(p)) inA = Math.max(0, inA - 1)
      else if (/^<span[\s>]/i.test(p)) { if (inIl) inIl++; else if (/\bclass="[^"]*\bilink\b/i.test(p)) inIl = 1 }
      else if (/^<\/span>/i.test(p) && inIl) inIl--
      return p
    }
    if (inA || inIl) return p
    return p.replace(m._lre, (x) => { const key = m._lrev[x]; return key && key !== self ? `<span class="ilink" data-a="openItem" data-k="${esc(k)}" data-n="${esc(key)}" data-pv="item|${esc(k)}|${esc(key)}">${x}</span>` : x })
  }).join('')
}

// ───────────── 보기 둘 — 항목으로 보기(목업 M6) ─────────────
const IFL = [['recent', '최근 바뀜'], ['mine', '내가 쓴 것']]
const KINDS = ['화면', '절차', '테이블', 'API', '용어']
function viewItems() {
  const k = pickKn()
  if (!k) return { crumb: '항목으로 보기', tabs: true, main: viewHome().main }
  const c = centerOf(() => ({ main: itemsEmpty(k), aside: knAside(k) }))
  return { crumb: '항목으로 보기' + (c.title ? ' › ' + c.title : ''), main: c.main, aside: c.aside, right: c.right, tabs: true, left: itemListHtml(k) }
}
function itemListHtml(k) {
  if (!M(k)) return `<div class="ilist" data-t="itemList">${modelErr(k) ? errHtml(modelErr(k), 'model:' + k) : loadingHtml}</div>`
  const kinds = [...new Set(itemsOf(k).map((i) => i.kind))], allOpen = kinds.length && kinds.every((kd) => S.kfold[kd] === false)
  return `<div class="ilist" data-t="itemList"><div class="lhead"><div class="lfind"><input class="inp" id="itemQ" aria-label="항목 찾기" data-in="itemQ" data-t="itemQ" value="${esc(S.iq)}" placeholder="항목 찾기: 이름 · 별칭" autocomplete="off">${kinds.length ? ltool(' data-a="kindAll" data-t="kindAll"', allOpen ? 'fold' : 'unfold', allOpen ? '종류 모두 접기' : '종류 모두 펴기') : ''}</div><div class="tools">${IFL.map(([v, l]) => fbtn(S.ifilt[v], ` data-a="itemFilt" data-v="${v}" data-t="if-${v}"`, l)).join('')}</div></div><div id="itemListBody">${itemListBody(k)}</div></div>`
}
function itemRecent(k, i) {
  const cut = Date.now() - 3 * 864e5
  return recsOfItem(k, i).some((r) => (stampDate(r.date) || 0) >= cut)
}
const itemMine = (k, i) => recsOfItem(k, i).some((r) => r.author === S.me.user)
// 항목 종류 묶음 — 처음은 모두 접힘(컨벤션 5절 묶음 줄) · 지금 연 항목의 종류는 펼침
function kindFolded(k, kd) { if (S.kfold[kd] !== undefined) return S.kfold[kd]; const t = activeTab(); return !(t && t.kind === 'item' && t.kn === k && (itemByKey(k, t.ref) || {}).kind === kd) }
function itemListBody(k) {
  const q = S.iq.trim(), nq = norm(q), f = S.ifilt
  const its = itemsOf(k).filter((i) => (!f.recent || itemRecent(k, i)) && (!f.mine || itemMine(k, i)))
  const hits = q ? its.filter((i) => itemHit(i, nq)) : its
  if (q && !hits.length) {
    const toks = q.split(/\s+/).filter(Boolean)
    const like = its.filter((i) => toks.some((t) => (i.first || '').includes(t))).slice(0, 8)
    return like.length ? `<div class="ig" data-t="itemSim">이름이 맞는 항목이 없다. 비슷한 항목</div>${like.map((i) => itemRowHtml(k, i)).join('')}` : '<div class="empty2" data-t="itemNone"><b>이 말로는 못 찾았다. 없다는 뜻은 아니다</b>다른 말로 · 또는 Ctrl K 찾기</div>'
  }
  let h = ''
  const kinds = [...KINDS, ...new Set(hits.map((i) => i.kind).filter((x) => !KINDS.includes(x)))]
  kinds.forEach((kd) => {
    const g = hits.filter((i) => i.kind === kd)
    if (!g.length) return
    const folded = q || f.recent || f.mine ? false : kindFolded(k, kd)
    h += `<div class="tn dir" data-a="foldKind" data-v="${esc(kd)}" data-t="kind-${esc(kd)}" aria-expanded="${!folded}"><span class="ar" aria-hidden="true">${folded ? '▸' : '▾'}</span><span class="nm">${esc(kd)}</span><span class="rc">${g.length}</span></div>`
    if (folded) return
    const show = !S.tablesAll && g.length > 30 ? g.slice(0, 30) : g
    h += show.map((i) => itemRowHtml(k, i, '', 1)).join('')
    if (show.length < g.length) h += `<div class="tn more" style="--dep:1" data-a="moreTables" data-t="moreTables">${g.length - show.length}개 더</div>`
  })
  return h || '<div class="muted small u-p4">이 거름에 맞는 항목이 없다</div>'
}
function itemRowHtml(k, i, dt, dep) {
  const rs = recsOfItem(k, i)
  return `<div class="tn${isAct('item', k, i.key) ? ' on' : ''}" data-a="openItem" data-k="${esc(k)}" data-n="${esc(i.key)}" data-t="${dt || 'itemRow'}" data-name="${esc(i.name)}" data-pv="item|${esc(k)}|${esc(i.key)}"${dep ? ` style="--dep:${dep}"` : ''}><span class="nm">${inmHtml(i)}</span>${!i.doc ? '<small class="nd">문서 없음</small>' : ''}${rs.length ? `<span class="rc" title="기록">${rs.length}</span>` : ''}</div>`
}
function itemsEmpty(k) {
  if (!M(k)) return `<div class="pg-text"><div class="big">${esc(KN(k).name)}: 항목</div>${modelErr(k) ? errHtml(modelErr(k), 'model:' + k) : loadingHtml}</div>`
  const its = itemsOf(k)
  const kinds = [...KINDS, ...new Set(its.map((i) => i.kind).filter((x) => !KINDS.includes(x)))]
  const by = kinds.map((kd) => [kd, its.filter((i) => i.kind === kd).length]).filter((x) => x[1])
  return `<div class="pg-text"><div class="pt" style="margin-bottom:var(--sp-5)"><div class="big">${esc(KN(k).name)}: 항목</div>${tipb('items', '항목')}</div><div class="row u-wrap u-g3" style="margin-bottom:var(--sp-6)">${by.map(([kd, n]) => `<span class="kn">${esc(kd)} ${n}</span>`).join('')}</div></div>`
}
const itemOf = (k, key) => need(`item:${k}:${key}`, `/api/k/${encodeURIComponent(k)}/item?key=${encodeURIComponent(key)}`)
// 이슈 주소(UX T4-13) — 지식 설정의 주소 틀에 항목 값을 넣는다(갈래 이름에 「이슈」 가 든 항목만)
const issueHref = (k, it) => { const u = KN(k) && (KN(k).issue || KN(k).issueUrl); return u && it && it.val && /이슈|issue/i.test(it.kind || '') ? u.replace('{값}', encodeURIComponent(it.val)) : '' }
function itemPane(t, right) {
  const k = t.kn, it = itemByKey(k, t.ref)
  if (!M(k)) return { html: modelErr(k) ? errHtml(modelErr(k), 'model:' + k) : loadingHtml, title: tabTitle(t) }
  if (!it) return { html: '<p class="muted">이 항목은 이제 없다</p>', title: t.ref }
  const v = it.doc ? itemOf(k, it.key) : null
  const d = it.doc && M(k).docById.get(it.doc)
  const rs = recsOfItem(k, it)
  const past = rs.slice().sort((a, b) => b.date.localeCompare(a.date))
  const uses = usesOf(k, it), al = it.aliases
  const who = (w) => (w === S.me.user ? '나' : w)
  let now
  if (it.doc && !v) now = loadingHtml
  else if (v && v.html != null) now = `<div class="paper ip">${linkify(v.html, k, it.key)}</div>`
  else if (d) now = `<div class="callout gray">문서 ${esc(d.title)} 에서 이 항목의 글이 빠졌다. 문서에서 그 머리를 다시 세우거나 점검에서 본다</div>`
  else now = `<div class="callout gray" data-t="noDoc">아직 문서에 없다. 오른쪽 「기록」 에서 이 항목을 건드린 기록 ${rs.length} 을 본다</div>`
  // 가운데는 항목 글만(2026-11-05) — 지난 기록 · 쓰는 곳 · 별칭은 오른쪽 칸 다섯 묶음으로
  const html = `<div class="docw" data-t="itemPage" data-name="${esc(it.name)}">${right ? rpHead() : ''}
  <div class="ttl"><div class="path"><span>${d ? `${esc(d.title)} › ${esc(it.sec)}` : '문서 없음'}</span></div>${right ? '' : wideSeg()}${d && !right ? `<button class="btn pri" data-a="itemToDoc" data-k="${esc(k)}" data-n="${esc(it.key)}" data-t="itemToDoc">문서로 보기에서 열기</button>` : ''}</div>
  ${right ? '' : gdockHtml(k, 'i:' + it.key)}<div class="ih"><span class="kt src">${esc(it.kind)}</span>${it.val && !sameTxt(it.val, it.name) ? `<span class="iv" data-t="itemVal" title="${esc(it.coord)}">${esc(it.val)}</span>` : ''}${issueHref(k, it) ? `<a class="lk small" href="${esc(issueHref(k, it))}" target="_blank" rel="noopener" data-t="issueLink">이슈 열기 ↗</a>` : ''}<h1>${esc(it.name)}</h1></div>
  <section class="isec" data-t="itemNow">${now}</section></div>`
  // 오른쪽 칸 — 개요(들어 있는 문서의 차례 · 이 항목에 「지금」) · 문서 · 기록(이 항목의 이력) · 항목 · 속성
  const sibs = d ? M(k).items.filter((i) => i.doc === d.id) : []
  const useDocs = [...new Set(uses.map((u) => u.doc).filter((x) => x && (!d || x !== d.id)))]
  const co = coItems(k, it)
  const aside = agWrap('item', [
    { id: 'ol', t: '개요', n: sibs.length, body: () => (d ? agSub(`${esc(d.title)}의 차례`) : '') + (sibs.map((i) => itemRow(k, i, { cur: i.key === it.key, t: 'olItem' })).join('') || agNone) },
    { id: 'docs', t: '문서', n: (d ? 1 : 0) + useDocs.length, body: () => agSub('이 항목이 있는 문서') + (d ? docRow(k, d.id, d.title, { h: it.sec, sub: it.sec, t: 'inDoc' }) : agNone) + agSub('이 항목을 쓰는 문서', useDocs.length) + (useDocs.map((x) => docRow(k, x, (M(k).docById.get(x) || {}).title || x, { t: 'useDoc' })).join('') || agNone) },
    { id: 'recs', t: '기록', n: past.length, body: () => agSub('이 항목의 이력 · 새것 위') + (past.map((r) => recRow(k, r, { sub: `${who(r.author)}${r.fixes.length ? ' · 바로잡음' : ''}${M(k).recs.some((x) => x.fixes.includes(r.id)) ? ' · 바로잡힘' : ''}`, t: 'itemHistRow' })).join('') || agNone) },
    { id: 'items', t: '항목', n: 1 + uses.length + co.length, body: () => agSub('이 항목') + itemRow(k, it, { cur: true, t: 'itemMe' }) + agSub('이 항목을 쓰는 곳', uses.length) + (uses.map((u) => itemRow(k, u, { sub: u.doc ? (M(k).docById.get(u.doc) || {}).title || u.doc : '', t: 'useRow' })).join('') || agNone) + agSub('함께 바뀐 항목', co.length) + (co.map((c) => itemRow(k, c.it, { rc: c.n, t: 'coItem' })).join('') || agNone) },
    { id: 'props', t: '속성', n: '', body: () => agKv([
      ['종류', esc(it.kind)],
      it.val ? ['값', `<b class="mono">${esc(it.val)}</b>`] : null,
      ['별칭', al.length ? al.map(esc).join(' · ') : '<span class="muted">없다. 같은 말로 이틀 찾으면 저절로 붙는다</span>'],
      ['문서', d ? `${esc(d.title)} › ${esc(it.sec)}` : '없음'],
      ['마지막으로 바뀜', v && v.by ? `${esc(whenTxt(v.by.date))}: ${esc(who(v.by.author))}의 기록에서` : d ? esc(whenTxt(d.when)) : '-'],
      ['기록', String(rs.length)],
    ]) },
  ])
  return { html, aside: right ? null : aside, title: it.short || it.name }
}

// ───────────── 보기 셋 — 그래프(문서 · 항목 · 기록의 이어짐 · 3D 와 2D 표 두 방식 · 바깥 라이브러리 없음) ─────────────
//   점은 문서 · 항목 · 기록 셋(가져올 곳 표시는 그래프에 싣지 않는다) · 선은 한 가지(이어져 있다)만
//   종류는 모양 + 색(색만으로 가르지 않는다): 문서 둥근 사각 · 항목 원 · 기록 마름모 · 테이블 묶음 두 겹 원(토큰 --k-*)
//   보는 방법 둘: 3D(손으로 쓴 힘 배치 · canvas · 끌어 돌리기) · 2D 표(ERD 처럼 문서 상자 안에 항목 줄 · 기록은 왼쪽 열)
//   점을 고르면 그 점과 한 겹 이웃만 · 보이는 점을 누르면 그 점에서 한 겹 더 뻗는다 · 고르기를 닫으면 전체
//   고른 점 카드 · 범례는 그래프 칸 안에(오른쪽 칸 없음) · 왼쪽 칸은 어떻게 보일지 정하는 판
const KLAB = { item: '항목', bundle: '항목 묶음', doc: '문서', rec: '기록' }
let CURG = null, GTOK = null
// 캔버스 색 — CSS 토큰을 한 번 읽어 둔다(매 프레임 getComputedStyle 를 부르지 않게)
function gTok() {
  if (GTOK && GTOK.dark === !!UI.gdark) return GTOK
  const cs = getComputedStyle($('#app .gwrap') || document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d
  return (GTOK = { doc: v('--k-doc', '#334155'), item: v('--k-item', '#3358e6'), rec: v('--k-rec', '#c2410c'), line: v('--text-3', '#646d7b'), text: v('--text', '#11151c'), text2: v('--text-2', '#515a68'), bg: v('--hover', '#f5f7fa'), ring: v('--g-ring', '#fff'), hit: '#f0b400', dark: !!UI.gdark })
}
// 모양 — 같은 모양을 SVG(2D 표 · 범례 · 목록 · 팝업)와 canvas(3D)에 그린다
function glyphSvg(kind, x, y, r = 6) {
  const f = (v) => +v.toFixed(1)
  if (kind === 'doc') return `<rect class="gk gk-doc" x="${f(x - r)}" y="${f(y - r)}" width="${f(2 * r)}" height="${f(2 * r)}" rx="${f(r / 3)}"/>`
  if (kind === 'rec') return `<path class="gk gk-rec" d="M${f(x)} ${f(y - r * 1.15)}L${f(x + r * 1.15)} ${f(y)}L${f(x)} ${f(y + r * 1.15)}L${f(x - r * 1.15)} ${f(y)}Z"/>`
  if (kind === 'bundle') return `<circle class="gk gk-bnd" cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/><circle class="gk gk-bnd" cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.6)}"/>`
  return `<circle class="gk gk-item" cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.85)}"/>`
}
const glyphIcon = (kind) => `<svg class="gki" viewBox="0 0 16 16" aria-hidden="true">${glyphSvg(kind, 8, 8, 5.5)}</svg>`
function glyphPath(ctx, kind, x, y, r) {
  ctx.beginPath()
  if (kind === 'doc') { const q = r * 0.9, c = q / 3; ctx.moveTo(x - q + c, y - q); ctx.arcTo(x + q, y - q, x + q, y + q, c); ctx.arcTo(x + q, y + q, x - q, y + q, c); ctx.arcTo(x - q, y + q, x - q, y - q, c); ctx.arcTo(x - q, y - q, x + q, y - q, c); ctx.closePath(); return }
  if (kind === 'rec') { const q = r * 1.15; ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath(); return }
  ctx.arc(x, y, r, 0, 7)
}
function graphData(k, fo, bundle) {
  const f = fo || S.g.f, B = bundle === undefined ? S.g.bundle : bundle
  const m = M(k)
  if (!m) return { nodes: [], edges: [] }
  const its = m.items, ds = m.docs, rs = m.recs
  const N = [], has = {}
  const add = (id, kind, label, x) => { N.push(Object.assign({ id, kind, label }, x || {})); has[id] = 1 }
  const tables = its.filter((i) => i.table)
  const iid = (i) => (i.table && !B ? 'b:table' : 'i:' + i.key)
  if (f.item) {
    its.filter((i) => !i.table).forEach((i) => add('i:' + i.key, 'item', i.short || i.name))
    if (tables.length) { if (B) tables.forEach((i) => add('i:' + i.key, 'item', i.short || i.name, { table: true })); else add('b:table', 'bundle', '테이블 ' + tables.length, { n: tables.length }) }
  }
  if (f.doc) ds.forEach((d) => add('d:' + d.id, 'doc', d.title))
  const cut = Date.now() - 30 * 864e5
  if (f.rec) rs.forEach((r) => { if (f.recent && (stampDate(r.date) || 0) < cut) return; add('r:' + r.id, 'rec', String(r.date || '').slice(5, 10) + ' ' + r.title.split(/ — |: /)[0]) })
  // 선은 한 가지(이어져 있다) — 같은 두 점 사이는 하나만. in(문서 ⊃ 항목)은 2D 표에서 상자로 보인다
  const E = [], seen = new Set()
  const edge = (a, b, t) => { const key = a < b ? a + '>' + b : b + '>' + a; if (has[a] && has[b] && a !== b && !seen.has(key)) { seen.add(key); E.push({ a, b, t }) } }
  its.forEach((i) => { if (i.doc || i.whole) edge('d:' + (i.doc || i.whole), iid(i), 'in') })
  rs.forEach((r) => { r.items.forEach((key) => { const i = m.byKey.get(key); if (i) edge('r:' + r.id, iid(i), 'link') }); r.fixes.forEach((x) => edge('r:' + r.id, 'r:' + x, 'link')) })
  ds.forEach((d) => d.links.forEach((b) => edge('d:' + d.id, 'd:' + b, 'link')))
  ds.forEach((d) => (d.cites || []).forEach((r) => edge('d:' + d.id, 'r:' + r, 'link')))
  its.filter((i) => !i.table).forEach((i) => usesOf(k, i).forEach((u) => edge('i:' + u.key, 'i:' + i.key, 'link')))
  let nodes = N, edges = E
  if (f.orph) { const deg = {}; edges.forEach((e) => { deg[e.a] = 1; deg[e.b] = 1 }); nodes = nodes.filter((n) => deg[n.id]) }
  return { nodes, edges }
}
// 보이는 점 — 고른 점이 없으면 전체(null) · 있으면 고른 점 + 한 겹 이웃 + 펼친 점마다 한 겹 이웃
function gVisible(G) {
  const sel = S.g.sel
  if (!sel || !G.nbr[sel]) return null
  const vis = new Set([sel])
  for (const id of [sel, ...S.g.open]) if (vis.has(id) && G.nbr[id]) G.nbr[id].forEach((x) => vis.add(x))
  if (S.g.recsOf === sel) for (const r of gRecsOf(G, sel)) vis.add(r)
  return vis
}
// 고른 점의 기록 점 — 바로 이웃 기록 + 이웃 항목(문서 ⊃ 항목)에 닿은 기록(UX G1-01)
function gRecsOf(G, id) {
  const kind = G._kind || (G._kind = new Map(G.nodes.map((n) => [n.id, n.kind])))
  const out = new Set()
  for (const x of G.nbr[id] || []) {
    if (kind.get(x) === 'rec') out.add(x)
    else if (kind.get(x) === 'item') for (const y of G.nbr[x] || []) if (kind.get(y) === 'rec') out.add(y)
  }
  return out
}
// 뻗은 선 — 고른 뒤에는 고른 점 · 펼친 점에 닿는 선만 그린다(「선」 을 켜면 보이는 점 사이 모두)
const gBranch = (G, e) => !G.vis || S.g.f.line || e.a === S.g.sel || e.b === S.g.sel || S.g.open.includes(e.a) || S.g.open.includes(e.b) || (S.g.recsOf === S.g.sel && G._kind && (G._kind.get(e.a) === 'rec' || G._kind.get(e.b) === 'rec'))
function hashf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return ((h >>> 0) % 10007) / 10007 }
// 3D 배치 — 질량 밀어내기(ForceAtlas2 의 기본 힘) · 허브를 가운데 몰지 않고 퍼뜨린다
//   밀어내기 = KR · (연결 수 + 1)(연결 수 + 1) / 거리 — 허브끼리 서로 밀어 흩어지고, 허브마다 제 이웃을 끌고 간다
//   당김 = LinLog(log(1 + 거리)) — 문서 ⊃ 항목(in) 1 · 그 밖의 선 0.6. 허브의 당김을 연결 수로 나누지 않는다(나누면 허브만 테두리로 밀려난다)
//   중력 = GR · (연결 수 + 1) — 외톨이가 멀리 달아나지 않게 · 움직임은 질량(연결 수 + 1)으로 나눈다
//   처음 자리는 작은 구(0.15R)의 황금각 나선 · 고정 씨앗이라 같은 지식은 늘 같은 모양 · 그 뒤는 돌리기만
//   (이전: 연결 수 순위로 반지름을 정해 허브가 모두 가운데에 겹쳤다. 2026-11-06 측정 · 상위 5% 허브가 반지름 35% 안에 든 비율
//    DPMS 0.80 → 0.13 · GDI 0.93 → 0.11, 허브에 이어진 점이 공간에서도 그 허브 곁인 비율 0.20 → 0.49 · 0.15 → 0.63)
//   전체 그래프로 한 번 푼다 — 고르기 · 펼치기는 자리를 그대로 두고 보이기만 바꾼다
const G3 = { R: 260, KR: 0.5, ATT: 6, GR: 1.5, CAP: 30 }
function layoutGraph(G) {
  const P = S.g.pos, ns = G.nodes, N = ns.length
  const key = ns.map((n) => n.id).join('|') + '#' + G.edges.length
  if (key === S.g.layoutKey && ns.every((n) => P[n.id])) return
  S.g.layoutKey = key
  S.g.cam.needFit = true
  if (!N) return
  const ix = new Map(ns.map((n, i) => [n.id, i]))
  const E = G.edges.length, ea = new Int32Array(E), eb = new Int32Array(E), ew = new Float64Array(E)
  const deg = new Float64Array(N)
  G.edges.forEach((e, k) => { ea[k] = ix.get(e.a); eb[k] = ix.get(e.b); ew[k] = G3.ATT * (e.t === 'in' ? 1 : 0.6); deg[ea[k]]++; deg[eb[k]]++ })
  const R = G3.R * Math.max(1, Math.cbrt(N / 60)), mass = Float64Array.from(deg, (d) => d + 1)
  // 처음 자리 — 거의 다 새 점이면 작은 구의 황금각 나선(id 해시 차례 · 종류 순이면 종류마다 위도 띠가 되어 세로로 길쭉해진다) · 몇 개만 새로 들면 이웃 곁
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N)
  const fresh = ns.filter((n) => !P[n.id]).length, whole = fresh > N / 2
  const hk = ns.map((n) => hashf(n.id + '#o'))
  const sorder = ns.map((_, i) => i).sort((a, b) => hk[a] - hk[b] || (ns[a].id < ns[b].id ? -1 : 1))
  const dir = new Array(N)
  sorder.forEach((i, k) => { const y = 1 - ((k + 0.5) / N) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = k * 2.399963; dir[i] = [Math.cos(th) * r, y, Math.sin(th) * r] })
  const jit = (id, s) => (hashf(id + s) - 0.5) * 30
  ns.forEach((n, i) => {
    const p = P[n.id]
    if (p && !whole) { px[i] = p.x; py[i] = p.y; pz[i] = p.z; return }
    const e = whole ? null : G.edges.find((e) => (e.a === n.id && P[e.b]) || (e.b === n.id && P[e.a]))
    const o = e ? P[e.a === n.id ? e.b : e.a] : null
    if (o) { px[i] = o.x + jit(n.id, 'x'); py[i] = o.y + jit(n.id, 'y'); pz[i] = o.z + jit(n.id, 'z'); return }
    const r0 = R * 0.15
    px[i] = dir[i][0] * r0 + jit(n.id, 'x') * 0.2; py[i] = dir[i][1] * r0 + jit(n.id, 'y') * 0.2; pz[i] = dir[i][2] * r0 + jit(n.id, 'z') * 0.2
  })
  const T = !whole ? 60 : N <= 120 ? 260 : N <= 400 ? 140 : 80, amp = whole ? 1 : 0.4
  // 멀리 떨어진 몇 점(외톨이 · 작은 덩어리)이 전체 맞춤을 작게 만들지 않게 — 90% 반지름의 1.2배 밖은 넘은 거리를 1/10 로(방향은 그대로)
  const fin = () => {
    const rs = [...Array(N).keys()].map((i) => Math.hypot(px[i], py[i], pz[i])), r9 = [...rs].sort((a, b) => a - b)[Math.floor((N - 1) * 0.9)] || 1, lim = r9 * 1.2
    ns.forEach((n, i) => { const r = rs[i], k = r > lim ? (lim + (r - lim) * 0.1) / r : 1; P[n.id] = { x: px[i] * k, y: py[i] * k, z: pz[i] * k } })
  }
  if (!(whole && N > 400)) { gRelax(px, py, pz, mass, ea, eb, ew, T, amp, -1); fin(); return }
  let t = 0
  S.g.layBusy = true
  fin()
  const step = () => {
    if (S.g.layoutKey !== key) return
    const t0 = performance.now()
    while (t < T && performance.now() - t0 < 24) { gRelax(px, py, pz, mass, ea, eb, ew, T, amp, -1, null, t, t + 1); t++ }
    fin()
    if (t >= T) { S.g.layBusy = false; S.g.cam.needFit = true; const h = $('#app [data-t=gLayBusy]'); if (h) h.hidden = true }
    if ($('#gcv') && CURG) { if (CURG.vis) render(); else gPaint() }
    if (t < T) setTimeout(step, 0)
  }
  setTimeout(step, 0)
}
// 힘 풀기 — 질량 밀어내기 · LinLog 당김 · 중력(원점으로). pin 번 점은 원점에 묶는다(고른 점 기준 배치) · fixed[i] 가 참인 점은 그 자리에 둔다(뻗기)
function gRelax(px, py, pz, mass, ea, eb, ew, TICKS, amp, pin, fixed, from = 0, to = TICKS) {
  const N = px.length, E = ea.length
  const fx = new Float64Array(N), fy = new Float64Array(N), fz = new Float64Array(N)
  for (let s = from; s < Math.min(to, TICKS); s++) {
    const al = amp * (1 - s / TICKS)
    fx.fill(0); fy.fill(0); fz.fill(0)
    for (let i = 0; i < N; i++) {
      const xi = px[i], yi = py[i], zi = pz[i], mi = mass[i] * G3.KR
      for (let j = i + 1; j < N; j++) {
        let dx = xi - px[j], dy = yi - py[j], dz = zi - pz[j], d2 = dx * dx + dy * dy + dz * dz
        if (d2 < 1) { dx = hashf(i + '/' + j) - 0.5; dy = hashf(j + '/' + i) - 0.5; dz = hashf(i + '|' + j) - 0.5; d2 = 1 }
        const d = Math.sqrt(d2), f = Math.min(400, (mi * mass[j]) / d) / d
        fx[i] += dx * f; fy[i] += dy * f; fz[i] += dz * f
        fx[j] -= dx * f; fy[j] -= dy * f; fz[j] -= dz * f
      }
    }
    for (let k = 0; k < E; k++) {
      const i = ea[k], j = eb[k], dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i]
      const d = Math.max(1, Math.hypot(dx, dy, dz)), f = (ew[k] * Math.log(1 + d)) / d
      fx[i] += dx * f; fy[i] += dy * f; fz[i] += dz * f
      fx[j] -= dx * f; fy[j] -= dy * f; fz[j] -= dz * f
    }
    const cap = G3.CAP * al + 0.2
    for (let i = 0; i < N; i++) {
      if (i === pin) { px[i] = py[i] = pz[i] = 0; continue }
      if (fixed && fixed[i]) continue
      const x = px[i], y = py[i], z = pz[i], m0 = Math.hypot(x, y, z) || 1, g = G3.GR * mass[i]
      const ax = (fx[i] - (x / m0) * g) / mass[i], ay = (fy[i] - (y / m0) * g) / mass[i], az = (fz[i] - (z / m0) * g) / mass[i]
      const m = Math.hypot(ax, ay, az), k = m > cap ? cap / m : 1
      px[i] = x + ax * k; py[i] = y + ay * k; pz[i] = z + az * k
    }
  }
}
// 고른 점 기준 배치 — 고르면 전체 배치를 풀고, 보이는 점(고른 점 + 뻗은 이웃)만 지금 누른 점(cur)을 원점에 묶어 다시 푼다
//   선은 뻗은 선(고른 점 · 펼친 점에 닿는 선)만 쓴다 — 누른 점과 그 선이 기준
//   처음 자리는 바로 앞 배치(앞서 고른 배치 · 없으면 전체 배치)를 누른 점이 원점이 되게 옮긴 것 — 점이 제자리에서 움직여 간다
//   원점 = 누른 점이라 돌리기도 그 점을 중심으로 돈다. × 로 닫으면 전체 배치(S.g.pos)로 돌아간다
function layoutSub(G) {
  const cur = G.vis.has(S.g.cur) ? S.g.cur : S.g.sel
  const key = gSubKey(G.vis, cur)
  const sub = S.g.sub
  if (sub && sub.key === key) return sub.pos
  const prev = sub && sub.pos && sub.pos[cur] ? sub.pos : S.g.pos, o = prev[cur] || { x: 0, y: 0, z: 0 }
  const ns = G.nodes.filter((n) => G.vis.has(n.id)), N = ns.length, ix = new Map(ns.map((n, i) => [n.id, i]))
  const es = G.edges.filter((e) => ix.has(e.a) && ix.has(e.b) && (e.a === S.g.sel || e.b === S.g.sel || S.g.open.includes(e.a) || S.g.open.includes(e.b)))
  const ea = Int32Array.from(es, (e) => ix.get(e.a)), eb = Int32Array.from(es, (e) => ix.get(e.b)), ew = Float64Array.from(es, (e) => G3.ATT * (e.t === 'in' ? 1 : 0.6))
  const deg = new Float64Array(N); for (let k = 0; k < es.length; k++) { deg[ea[k]]++; deg[eb[k]]++ }
  const mass = Float64Array.from(deg, (d) => d + 1)
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N)
  const jit = (id, s) => (hashf(id + s) - 0.5) * 40
  ns.forEach((n, i) => {
    let p = prev[n.id]
    if (!p) { const e = es.find((e) => (e.a === n.id && prev[e.b]) || (e.b === n.id && prev[e.a])); const q = e ? prev[e.a === n.id ? e.b : e.a] : o; p = { x: q.x + jit(n.id, 'x'), y: q.y + jit(n.id, 'y'), z: q.z + jit(n.id, 'z') } }
    px[i] = p.x - o.x; py[i] = p.y - o.y; pz[i] = p.z - o.z
  })
  gRelax(px, py, pz, mass, ea, eb, ew, N <= 150 ? 160 : 100, 1, ix.get(cur))
  // 점이 적으면 힘이 맞는 거리가 몇 px 뿐이다 — 90% 반지름을 점 수에 맞춘 크기(160 ~ 400)로 늘린다(누른 점은 원점 그대로)
  const rs = ns.map((_, i) => Math.hypot(px[i], py[i], pz[i])).sort((a, b) => a - b), r9 = rs[Math.floor((N - 1) * 0.9)] || 1
  const sc = Math.min(400, 160 * Math.max(1, Math.cbrt(N / 12))) / r9
  const pos = {}
  ns.forEach((n, i) => { pos[n.id] = { x: px[i] * sc, y: py[i] * sc, z: pz[i] * sc } })
  // 원근 거리(R3)는 이 배치 때 정해 두고 뻗어도 바꾸지 않는다(바꾸면 점들이 조금씩 움직인다)
  const R3 = Math.max(100, ...ns.map((n) => { const p = pos[n.id]; return Math.hypot(p.x, p.y, p.z) }))
  S.g.sub = { key, pos, sc, R3 }
  S.g.cam.needFit = true
  return pos
}
const gSubKey = (vis, cur) => [...vis].sort().join('|') + '@' + cur
// 뻗기(3D) — 보이는 이웃을 누르면 화면을 다시 그리지 않고 그 자리에서 새 이웃만 붙인다
//   카메라(크기 · 각도 · 옮김)와 지금 점들의 자리는 그대로 · 새 점만 누른 점 바깥쪽에 놓고 그것만 푼다(지금 점은 묶어 둔다)
//   새 점은 누른 점 자리에서 제자리로 0.35초 동안 뻗어 나간다 · 수 · 카드만 바꿔 끼운다(캔버스는 그대로 · 깜빡임 없음)
function gExpand(id) {
  const G = CURG, sub = S.g.sub
  if (!G || !G.vis || !sub || !sub.pos[id]) return false
  if (id !== S.g.sel && !S.g.open.includes(id)) S.g.open = [...S.g.open, id]
  S.g.cur = id
  const vis = gVisible(G)
  const ns = G.nodes.filter((n) => vis.has(n.id)), N = ns.length, ix = new Map(ns.map((n, i) => [n.id, i]))
  const es = G.edges.filter((e) => ix.has(e.a) && ix.has(e.b) && (e.a === S.g.sel || e.b === S.g.sel || S.g.open.includes(e.a) || S.g.open.includes(e.b)))
  const ea = Int32Array.from(es, (e) => ix.get(e.a)), eb = Int32Array.from(es, (e) => ix.get(e.b)), ew = Float64Array.from(es, (e) => G3.ATT * (e.t === 'in' ? 1 : 0.6))
  const deg = new Float64Array(N); for (let k = 0; k < es.length; k++) { deg[ea[k]]++; deg[eb[k]]++ }
  const mass = Float64Array.from(deg, (d) => d + 1), fixed = new Uint8Array(N)
  const sc = sub.sc || 1, o = sub.pos[id], ol = Math.hypot(o.x, o.y, o.z) || 1, out = [o.x / ol, o.y / ol, o.z / ol]
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N), fresh = []
  ns.forEach((n, i) => {
    const p = sub.pos[n.id]
    if (p) { px[i] = p.x / sc; py[i] = p.y / sc; pz[i] = p.z / sc; fixed[i] = 1; return }
    fresh.push(n.id)
    const j = (s) => (hashf(n.id + s) - 0.5) * 2
    px[i] = (o.x + (out[0] * 0.6 + j('x') * 0.5) * 90) / sc; py[i] = (o.y + (out[1] * 0.6 + j('y') * 0.5) * 90) / sc; pz[i] = (o.z + (out[2] * 0.6 + j('z') * 0.5) * 90) / sc
  })
  if (fresh.length) gRelax(px, py, pz, mass, ea, eb, ew, 80, 0.6, -1, fixed)
  const pos = {}, from = {}
  ns.forEach((n, i) => { pos[n.id] = { x: px[i] * sc, y: py[i] * sc, z: pz[i] * sc } })
  fresh.forEach((x) => { from[x] = { x: o.x, y: o.y, z: o.z } })
  S.g.sub = { key: gSubKey(vis, id), pos, sc, R3: sub.R3 }
  S.g.visKey = S.g.sel + '|' + S.g.open.join('|')
  G.vis = vis; G.P = pos
  S.g.grow = fresh.length ? { t0: performance.now(), from } : null
  // 수 · 카드만 바꿔 끼운다
  const c = $('[data-t=gCount]'); if (c) c.textContent = gCountText(G, true)
  const old = $('#app [data-t=gCard]'); if (old) old.outerHTML = gCardHtml(S.route.kn, G)
  const cv = $('#gcv'); if (cv) cv.setAttribute('aria-label', gAria(G))
  gGrow()
  return true
}
function gGrow() { gPaint(); if (S.g.grow) requestAnimationFrame(gGrow) }
function gCountText(G, d3) {
  const nV = G.vis ? G.vis.size : G.nodes.length, eV = G.vis ? G.edges.filter((e) => G.vis.has(e.a) && G.vis.has(e.b) && gBranch(G, e)).length : G.edges.length
  return `점 ${nV} · 선 ${eV}${!S.g.f.line && !G.vis && S.g.mode !== '2d' ? '(그린 선 0 · 「선」 을 켜면 모두)' : ''}${G.vis ? (d3 ? ' · 고른 점에서 ' + (S.g.open.length + 1) + '번 뻗음' : ' · 고른 점 중심' + ((S.g.trail || []).length ? ' · 지나온 점 ' + S.g.trail.length : '')) : ''}`
}
function gAria(G) {
  const nV = G.vis ? G.vis.size : G.nodes.length, eV = G.vis ? G.edges.filter((e) => G.vis.has(e.a) && G.vis.has(e.b) && gBranch(G, e)).length : G.edges.length
  return `그래프: 점 ${nV} · 선 ${eV}${S.g.cur ? ' · 고른 점 ' + ((G.nodes.find((n) => n.id === S.g.cur) || {}).label || '') : ''} · 키보드: 왼쪽 찾기 칸에서 Enter 로 맞는 첫 점을 고르거나, 보는 방법 「2D 표」 에서 점을 Tab 으로 고른다`
}
// 점 크기 — 종류 바탕 + 중요도(√, 위 8) · 중요도가 큰 점이 커서 어디가 중심인지 보인다
function nodeR(n, w) { if (n.kind === 'bundle') return 13; if (n.table) return 3; return (n.kind === 'doc' ? 5 : n.kind === 'rec' ? 3.5 : 3) + Math.min(8, Math.sqrt(w) * 0.9) }
let GCV = null, GH = null, GRAF = 0
// 그리기(3D) — canvas 하나 · 원근 투영 · 먼 것부터
//   선은 한 가지 색 · 한 가지 굵기 · 화살표 없음. 「선」 을 끄면 고른 점 · 올린 점의 선만(고른 뒤 보이는 이웃 그림은 늘 선을 그린다)
//   선이 많을수록 · 멀수록 조금 옅게(투명도 0.12 ~ 0.6) · 끝까지 다 그린다(토막으로 자르면 수염처럼 보였다)
//   고른 점이 있으면 보이는 점(고른 점 + 펼친 이웃)만 그린다 · 자리는 전체 배치 그대로
function gPaint() {
  const cv = $('#gcv'), G = CURG
  if (!cv || !G) return
  const rc = cv.getBoundingClientRect(), W = rc.width, H0 = rc.height
  if (W < 4 || H0 < 4) return
  const dpr = window.devicePixelRatio || 1
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H0 * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H0 * dpr) }
  const ctx = cv.getContext('2d'), T = gTok()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H0)
  const C = S.g.cam, P = G.P || S.g.pos, f = S.g.f, cx = W / 2, cy = H0 / 2, vis = G.vis
  const shown = vis ? G.nodes.filter((n) => vis.has(n.id)) : G.nodes
  const sy = Math.sin(C.ry), cy2 = Math.cos(C.ry), sx = Math.sin(C.rx), cx2 = Math.cos(C.rx), D = G.R3 * 2.6
  const raw = (p) => { const x1 = p.x * cy2 - p.z * sy, z1 = p.x * sy + p.z * cy2, y1 = p.y * cx2 - z1 * sx, z2 = p.y * sx + z1 * cx2, sc = D / Math.max(D * 0.35, D + z2); return [x1 * sc, y1 * sc, z2, sc] }
  if (C.needFit) {
    // 보이는 점이 다 들어오게 — 고르면 누른 점(원점)이 칸 가운데 · 돌려도 그 점이 제자리에서 돈다 · 닫으면 전체로
    let mx = 1, my = 1, ax = 0, ay = 0
    const qs = shown.map((n) => raw(P[n.id]))
    qs.forEach((q) => { mx = Math.max(mx, Math.abs(q[0] - ax)); my = Math.max(my, Math.abs(q[1] - ay)) })
    const cw = vis ? Math.min(W * 0.45, (($('#app .gov') || {}).offsetWidth || 0) + 16) : 0
    C.base = Math.max(0.02, Math.min(vis ? 3 : 6, Math.min((W / 2 - 60 - cw) / mx, (H0 / 2 - 50) / my)))
    C.zoom = 1; C.px = -ax * C.base; C.py = -ay * C.base; C.needFit = false; S.g.outHint = false
  }
  const Z = C.base * C.zoom, rk = Math.max(0.7, Math.min(2.6, Math.sqrt(C.zoom)))
  const by = {}
  // 뻗기 — 새 점은 누른 점 자리에서 제자리로(0.35초 · 감속)
  const gr = S.g.grow, ge = gr ? Math.min(1, (performance.now() - gr.t0) / 350) : 1, gk = 1 - (1 - ge) ** 3
  if (gr && ge >= 1) {
    S.g.grow = null
    // 뻗은 이웃이 칸 밖이나 카드 밑으로 나갔으면 한 번 다시 맞춘다(UX G1-02) — 카드 밑 점은 눌리지 않는다
    const card = $('#app .gov'), cr = card && cv ? (() => { const a = card.getBoundingClientRect(), b = cv.getBoundingClientRect(); return { l: a.left - b.left, b: a.bottom - b.top } })() : null
    const out = shown.some((n) => { const q = raw(P[n.id]); const X = cx + q[0] * Z + C.px, Y = cy + q[1] * Z + C.py; return X < 12 || Y < 12 || X > W - 12 || Y > H0 - 12 || (cr && X > cr.l - 8 && Y < cr.b + 8) })
    S.g.outHint = out
    const hint = $('#app [data-t=gOutHint]'); if (hint) hint.hidden = !out
  }
  const at = (id) => { const p = P[id], f = gr && gr.from[id]; return f && ge < 1 ? { x: f.x + (p.x - f.x) * gk, y: f.y + (p.y - f.y) * gk, z: f.z + (p.z - f.z) * gk } : p }
  const pts = shown.map((n) => { const q = raw(at(n.id)); const t = { n, X: cx + q[0] * Z + C.px, Y: cy + q[1] * Z + C.py, z: q[2], sc: q[3] }; t.r = nodeR(n, G.w[n.id] || 0) * Math.max(0.6, Math.min(1.6, q[3])) * rk; t.dep = Math.max(0.45, Math.min(1, q[3])); by[n.id] = t; return t })
  const Hd = GH != null && by[GH] ? GH : null
  const nb = Hd ? G.nbr[Hd] : null
  // 점을 고른 동안은 찾기로 흐리지 않는다 — 막 보려는 이웃이 흐려지지 않게(UX G1-04)
  const nq = S.g.sel ? '' : norm(f.q || ''), hits = new Set()
  if (nq) shown.forEach((n) => { if (norm(n.label).includes(nq)) hits.add(n.id) })
  // 선 — 한 가지. 투명도 통(0.05 간격)마다 Path2D 하나에 모아 한 번 그린다(선마다 stroke 하면 수천 번 · 실측 70 ms 넘게)
  //   굵기는 1px(굵은 선을 모으면 오히려 느려진다) · 올린 점의 선만 따로 굵게 · 끄는 동안 선이 많으면(1500 넘게) 올린 점 선만
  const es = G.edges.filter((e) => by[e.a] && by[e.b])
  const fade = Math.max(0.35, Math.min(1, Math.sqrt(400 / Math.max(1, es.length))))
  const moving = !!(GD && GD.moved) && es.length > 1500
  const bins = new Map()
  let litP = null, drawn = 0
  es.forEach((e) => {
    const p = by[e.a], q = by[e.b]
    const lit = !!Hd && (e.a === Hd || e.b === Hd)
    if (!f.line && !lit && !vis) return
    if (!lit && (moving || !gBranch(G, e))) return
    const off = (!!Hd && !lit) || (!!nq && !(hits.has(e.a) || hits.has(e.b)))
    let path
    if (lit) path = litP || (litP = new Path2D())
    else {
      const al = off ? 0.05 : Math.round((vis ? 0.7 : Math.max(0.12, 0.6 * fade * (p.dep + q.dep) / 2)) * 20) / 20
      path = bins.get(al) || bins.set(al, new Path2D()).get(al)
    }
    drawn++
    path.moveTo(p.X, p.Y); path.lineTo(q.X, q.Y)
  })
  ctx.strokeStyle = T.line; ctx.setLineDash([]); ctx.lineWidth = 1
  bins.forEach((path, al) => { ctx.globalAlpha = al; ctx.stroke(path) })
  if (litP) { ctx.globalAlpha = 0.95; ctx.lineWidth = 1.6; ctx.stroke(litP) }
  // 점 — 먼 것부터 · 고른 점과 이웃은 맨 나중
  const sel = S.g.sel, cur = S.g.cur
  const rank = (t) => (t.n.id === Hd || t.n.id === cur ? 3 : hits.has(t.n.id) ? 2 : nb && nb.has(t.n.id) ? 1 : 0)
  const order = [...pts].sort((a, b) => rank(a) - rank(b) || b.z - a.z)
  order.forEach((t) => {
    const n = t.n, id = n.id, focus = id === Hd, isN = !!nb && nb.has(id), hit = hits.has(id)
    const dim = (!!Hd && !focus && !isN && !hit) || (!!nq && !hit && !focus)
    const a0 = dim ? 0.15 : focus || isN || hit || vis ? 1 : t.dep
    if (hit) { ctx.globalAlpha = 0.55; ctx.fillStyle = T.hit; ctx.beginPath(); ctx.arc(t.X, t.Y, t.r + 5, 0, 7); ctx.fill() }
    ctx.globalAlpha = a0
    if (n.kind === 'bundle') {
      ctx.strokeStyle = T.item; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(t.X, t.Y, t.r, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(t.X, t.Y, t.r * 0.6, 0, 7); ctx.stroke()
    } else {
      ctx.fillStyle = T[n.kind] || T.item
      glyphPath(ctx, n.kind, t.X, t.Y, t.r); ctx.fill()
      ctx.strokeStyle = id === sel || id === cur || focus ? T.text : T.ring; ctx.lineWidth = id === cur ? 2.5 : id === sel || focus ? 2 : 1.2
      glyphPath(ctx, n.kind, t.X, t.Y, t.r + ctx.lineWidth / 2 - 0.5); ctx.stroke()
    }
  })
  // 점 제목 — 늘 보기를 켜면 모두(자리가 없으면 건너뛴다) · 끄면 올린 점 · 고른 점 · 찾기에 맞은 점 · 고른 뒤 보이는 점
  //   전체 그래프에서는 「제목」 을 꺼도 허브(중요도 상위) 이름을 쓴다 — 어디가 중심인지 읽히게
  const big = shown.length > 90, ff = getComputedStyle(cv).fontFamily, placed = []
  const clash = (b) => placed.some((o) => b.x < o.x2 && b.x2 > o.x && b.y < o.y2 && b.y2 > o.y)
  let lab = 0
  ctx.lineJoin = 'round'
  const hubL = (id) => !vis && !Hd && !nq && G.hubs.has(id)
  let hubN = 0
  ;[...pts].sort((a, b) => rank(b) - rank(a) || hubL(b.n.id) - hubL(a.n.id) || (hubL(a.n.id) ? G.w[b.n.id] - G.w[a.n.id] : 0) || b.sc - a.sc).forEach((t) => {
    const n = t.n, pri = rank(t) > 0 || t.n.id === sel, hub = !pri && hubL(n.id)
    if (!pri && !hub && !(f.label || vis)) return
    if (!pri && big && n.table) return
    if (!pri && !!Hd) return
    ctx.font = `${pri ? '700 ' : hub ? '600 ' : ''}11px ${ff}`
    const txt = hub ? gFit(n.label, 170, 11) : n.label, w = ctx.measureText(txt).width, h = 13
    const cands = [[t.X + t.r + 4, t.Y + 4], [t.X - t.r - 4 - w, t.Y + 4], [t.X + t.r + 4, t.Y - 9], [t.X + t.r + 4, t.Y + 17]]
    let at = null
    for (const c of cands) { const b = { x: c[0] - 1, y: c[1] - h + 2, x2: c[0] + w + 1, y2: c[1] + 3 }; if (!clash(b)) { at = c; placed.push(b); break } }
    if (!at) { if (!pri) return; at = cands[0] }
    ctx.globalAlpha = pri || hub ? 1 : Math.max(0.6, t.dep)
    ctx.strokeStyle = T.bg; ctx.lineWidth = 3; ctx.strokeText(txt, at[0], at[1])
    ctx.fillStyle = pri || hub ? T.text : T.text2; ctx.fillText(txt, at[0], at[1])
    lab++; if (hub) hubN++
  })
  ctx.globalAlpha = 1
  GCV = { pts, rc }
  cv.dataset.n = pts.length; cv.dataset.shown = lab; cv.dataset.hubs = hubN; cv.dataset.lines = drawn
  const c = $('[data-t=gHits]')
  if (c) c.textContent = nq ? '맞는 점 ' + hits.size : ''
}
// 천천히 돈다 — 끌거나 점에 올려 둔 동안은 멈춘다(누르려는 점이 달아나지 않게)
const gCalm = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
function gLoop() { GRAF = 0; if (!$('#gcv') || !S.g.f.spin || GD || GH != null || gCalm()) return; S.g.cam.ry += 0.0016; gPaint(); GRAF = requestAnimationFrame(gLoop) }
function gStart() { if (!S.g.spinSet && GCV && GCV.pts && GCV.pts.length > 400) { S.g.f.spin = false; S.g.spinSet = true } gPaint(); if (!GRAF && S.g.f.spin && !gCalm()) GRAF = requestAnimationFrame(gLoop) }
function gHit(x, y) {
  if (!GCV) return null
  const lx = x - GCV.rc.left, ly = y - GCV.rc.top
  let best = null, bd = 1e9
  GCV.pts.forEach((t) => { const d = Math.hypot(t.X - lx, t.Y - ly); if (d <= t.r + 4 && d < bd) { bd = d; best = t.n.id } })
  return best
}
// 시험이 점 자리를 묻는다(canvas 라 DOM 에 점이 없다)
window.kmdGraphIds = () => (GCV ? GCV.pts.map((t) => t.n.id) : [])
window.kmdGraphPt = (id) => { const t = GCV && GCV.pts.find((t) => t.n.id === id); return t ? { x: GCV.rc.left + t.X, y: GCV.rc.top + t.Y } : null }
function zoomAt(lx, ly, k) { const C = S.g.cam, cv = $('#gcv'); if (!cv) return; const r = cv.getBoundingClientRect(), z2 = Math.max(0.2, Math.min(8, C.zoom * k)), q = z2 / C.zoom, ox = lx - r.width / 2, oy = ly - r.height / 2; C.px = ox - (ox - C.px) * q; C.py = oy - (oy - C.py) * q; C.zoom = z2; gPaint() }
// 점을 누르면
//   3D — 고른 점이 없거나 안 보이는 점이면 그 점을 고른다(한 겹 이웃만) · 보이는 이웃이면 그 점에서 한 겹 더 뻗는다
//   2D 표 — 누른 점이 새 가운데(그 점 + 한 겹 이웃) · 앞의 가운데는 「지나온 점」 으로 남아 카드에서 되돌아간다
//          (뻗기를 쌓으면 표에서는 선이 늘어 누른 선이 묻힌다)
function gClick(id) {
  if (id === 'b:table') { S.g.bundle = true; toast('테이블 ' + itemsOf(S.route.kn).filter((i) => i.table).length + ' 을 폈다. 다른 지식을 열었다 오면 다시 접힌다'); render(); return }
  const G = CURG
  if (S.g.mode === '2d') {
    if (S.g.sel && S.g.sel !== id) S.g.trail = [...(S.g.trail || []).filter((x) => x !== id), S.g.sel].slice(-12)
    Object.assign(S.g, { sel: id, open: [], cur: id })
  } else if (!S.g.sel || !G || !G.vis || !G.vis.has(id)) Object.assign(S.g, { sel: id, open: [], cur: id })
  else { if (gExpand(id)) return; if (id !== S.g.sel && !S.g.open.includes(id)) S.g.open = [...S.g.open, id]; S.g.cur = id }
  S.g.grow = null
  render()
}
// 2D 표(ERD 처럼) — 문서 상자 안에 항목 줄 · 기록은 왼쪽 열(위가 최근)
//   가운데 점이 든 상자를 맨 앞 열에 둔다(선이 한쪽으로 흐른다) · 선은 상자 뒤 · 가운데 점의 선은 강조색 · 이어진 점의 줄은 옅게 칠한다
//   그림은 한 장(<g id="gerdg">) · 옮기기 · 크게 · 작게는 transform 만 바꾼다(스크롤 없음 · 다시 그리지 않음)
const gW = (ch) => (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? 1 : 0.6)
function gFit(s, px, fs = 12) {
  const a = [...String(s || '')], lim = px / fs
  let w = 0
  for (let i = 0; i < a.length; i++) { w += gW(a[i]); if (w > lim) return a.slice(0, Math.max(1, i - 1)).join('') + '…' }
  return a.join('')
}
const f1 = (v) => +v.toFixed(1)
const gAvail = (max) => { const m = $('#app .main'), w = m ? m.clientWidth - 40 : innerWidth - 300; return Math.round(Math.max(640, Math.min(max, w))) }
function gErdSvg(k, G) {
  const m = M(k), vis = G.vis, cur = S.g.cur, sel = S.g.sel, f = S.g.f, nq = norm(f.q || '')
  const nodes = vis ? G.nodes.filter((n) => vis.has(n.id)) : G.nodes
  if (!nodes.length) return '<div class="empty2" data-t="gEmpty"><b>보일 점이 없다</b>왼쪽 「문서 · 항목 · 기록」 을 켠다.</div>'
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const dOrder = new Map(m.docs.map((d, i) => [d.id, i]))
  const recs = nodes.filter((n) => n.kind === 'rec').sort((a, b) => (stampDate((m.recById.get(b.id.slice(2)) || {}).date) || 0) - (stampDate((m.recById.get(a.id.slice(2)) || {}).date) || 0))
  const boxes = new Map()
  const boxOf = (key, title, head) => { if (!boxes.has(key)) boxes.set(key, { key, title, head, rows: [] }); return boxes.get(key) }
  nodes.filter((n) => n.kind === 'doc').forEach((n) => boxOf(n.id.slice(2), n.label, n))
  nodes.filter((n) => n.kind === 'item').forEach((n) => {
    const it = m.byKey.get(n.id.slice(2)), d = it && (it.doc || it.whole), dd = d && m.docById.get(d)
    ;(d ? boxOf(d, dd ? dd.title : d, byId.get('d:' + d) || null) : boxOf('_out', '문서 밖 항목', null)).rows.push(n)
  })
  nodes.filter((n) => n.kind === 'bundle').forEach((n) => boxOf('_bnd', n.label, n))
  // 가운데 점이 든 상자 — 맨 앞
  const selBox = sel && (sel.startsWith('d:') ? sel.slice(2) : sel.startsWith('i:') ? (() => { const it = m.byKey.get(sel.slice(2)); return it ? it.doc || it.whole || '_out' : null })() : null)
  const list = [...boxes.values()].sort((a, b) => (a.key === selBox ? -1 : b.key === selBox ? 1 : 0) || (dOrder.has(a.key) ? dOrder.get(a.key) : 1e9) - (dOrder.has(b.key) ? dOrder.get(b.key) : 1e9) || a.title.localeCompare(b.title))
  list.forEach((b) => { const d = m.docById.get(b.key), io = new Map(((d && d.items) || []).map((x, i) => ['i:' + x, i])); b.rows.sort((p, q) => (io.has(p.id) ? io.get(p.id) : 1e9) - (io.has(q.id) ? io.get(q.id) : 1e9)) })
  // 배치 — 칸의 가로 · 세로 비율에 맞춘다. 문서 상자 열 수(nc)를 바꿔 가며 상자를 낮은 열부터 채우고, 기록은 그 높이에 맞춰 여러 열로 접는다.
  //   그중 「칸에 다 들어올 때의 배율」 이 가장 큰 배치를 고른다(아래로만 길게 늘어지지 않게)
  const PAD = 16, TOP = 16, RH = 24, HH = 30, BW = 232, GX = 72, RW = 220, RG = 14, RHH = 48
  const bhOf = (b) => HH + b.rows.length * RH + (b.rows.length ? 8 : 0)
  const wrap = $('#app .gerdw'), cw = (wrap && wrap.clientWidth) || gAvail(1600), ch = (wrap && wrap.clientHeight) || Math.max(400, innerHeight - 260)
  // 열 하나보다 긴 상자는 잘라 다음 열에서 이어 간다(머리 「(이어서)」) — 큰 문서 하나가 높이를 정하지 않게
  const total = list.reduce((a, b) => a + bhOf(b) + 18, 0)
  const place = (nc) => {
    const cap = Math.max(8, Math.floor((total / nc - HH - 8) / RH))
    const pieces = []
    for (const b of list) { if (b.rows.length <= cap) pieces.push({ b, rows: b.rows, cont: false }); else for (let i = 0; i < b.rows.length; i += cap) pieces.push({ b, rows: b.rows.slice(i, i + cap), cont: i > 0 }) }
    const h = new Array(nc).fill(TOP), pos = []
    for (const pc of pieces) { const c = h.indexOf(Math.min(...h)); pos.push([c, h[c]]); h[c] += HH + pc.rows.length * RH + (pc.rows.length ? 8 : 0) + 18 }
    return { pieces, pos, H: Math.max(...h) }
  }
  let best = null
  for (let n = 1; n <= Math.max(1, Math.min(40, list.length)); n++) {
    const p = place(n)
    const rc = recs.length ? Math.max(1, Math.ceil((recs.length * RHH) / Math.max(RHH, p.H - TOP))) : 0, rr = rc ? Math.ceil(recs.length / rc) : 0
    const H = Math.max(p.H, TOP + rr * RHH) + PAD, W = PAD + (rc ? rc * RW + (rc - 1) * RG + GX : 0) + n * BW + (n - 1) * GX + PAD
    const sc = Math.min(cw / W, (ch - 64) / H)
    if (!best || sc > best.sc + 1e-9) best = { nc: n, rc, rr, p, W, H, sc }
  }
  const { rc, rr, p: placed, W } = best
  const x0 = PAD + (rc ? rc * RW + (rc - 1) * RG + GX : 0), at = {}
  // 가운데 점과 이어진 점 — 줄을 옅게 칠해 선이 상자 뒤로 숨어도 무엇과 이어졌는지 보인다
  const nbs = new Set(sel && G.nbr[sel] ? [...G.nbr[sel], ...S.g.open.flatMap((o) => [...(G.nbr[o] || [])])] : [])
  const cls = (id) => (id === cur ? ' on' : '') + (id === sel ? ' sel' : '') + (nbs.has(id) && id !== sel ? ' nb' : '') + (nq && byId.get(id) && norm(byId.get(id).label).includes(nq) ? ' hit' : '')
  const el = (n, inner) => `<g class="ge${cls(n.id)}" data-a="gTap" data-v="${esc(n.id)}" data-t="gEl" data-l="${esc(norm(n.label))}" role="button" tabindex="0" aria-label="${esc((KLAB[n.kind] || '') + ' ' + n.label)}"><title>${esc(n.label)}</title>${inner}</g>`
  let boxS = '', recS = ''
  placed.pieces.forEach((pc, bi) => {
    const b = pc.b, [c, by] = placed.pos[bi], bx = x0 + c * (BW + GX), bh = HH + pc.rows.length * RH + (pc.rows.length ? 8 : 0)
    let s = `<rect class="gbx" x="${bx}" y="${by}" width="${BW}" height="${bh}" rx="8"/>`
    const head = `<rect class="ghr" x="${bx}" y="${by}" width="${BW}" height="${HH}" rx="8"/>${glyphSvg(b.head ? b.head.kind : 'doc', bx + 15, by + 15, 6)}<text class="gt b" x="${bx + 28}" y="${by + 19}">${esc(gFit(b.title, BW - (pc.cont ? 90 : 40), 12))}</text>${pc.cont ? `<text class="gs" x="${bx + BW - 10}" y="${by + 19}" text-anchor="end">(이어서)</text>` : ''}`
    s += b.head ? el(b.head, head) : `<g class="ge off">${head}</g>`
    if (b.head && !pc.cont) at[b.head.id] = { lx: bx, rx: bx + BW, y: by + 15 }
    pc.rows.forEach((n, i) => {
      const y = by + HH + 4 + i * RH
      s += el(n, `<rect class="grow" x="${bx + 4}" y="${y}" width="${BW - 8}" height="${RH - 2}" rx="5"/>${glyphSvg(n.kind, bx + 16, y + 11, 5)}<text class="gt" x="${bx + 28}" y="${y + 15}">${esc(gFit(n.label, BW - 40, 12))}</text>`)
      at[n.id] = { lx: bx + 4, rx: bx + BW - 4, y: y + 11 }
    })
    boxS += s
  })
  // 기록 — 위가 최근 · 열을 위에서 아래로 채우고 다음 열로
  recs.forEach((n, j) => {
    const r = m.recById.get(n.id.slice(2)), rx = PAD + Math.floor(j / rr) * (RW + RG), ry = TOP + (j % rr) * RHH
    recS += el(n, `<rect class="grec" x="${rx}" y="${ry}" width="${RW}" height="40" rx="8"/>${glyphSvg('rec', rx + 15, ry + 20, 6)}<text class="gt" x="${rx + 30}" y="${ry + 17}">${esc(gFit(n.label, RW - 40, 12))}</text><text class="gs" x="${rx + 30}" y="${ry + 32}">${esc(r ? recDt(r.date) + ' · ' + r.author : '')}</text>`)
    at[n.id] = { lx: rx, rx: rx + RW, y: ry + 20 }
  })
  // 선 — 상자 뒤에 그린다(글을 가로지르지 않게). 가운데 점의 선은 강조색 · 「선」 을 켜면 나머지 선은 옅게 · 문서 ⊃ 항목은 상자가 보여 준다
  const path = (a, b) => {
    if (a.rx <= b.lx) return `M${a.rx} ${a.y}C${(a.rx + b.lx) / 2} ${a.y} ${(a.rx + b.lx) / 2} ${b.y} ${b.lx} ${b.y}`
    if (b.rx <= a.lx) return `M${b.rx} ${b.y}C${(b.rx + a.lx) / 2} ${b.y} ${(b.rx + a.lx) / 2} ${a.y} ${a.lx} ${a.y}`
    return `M${a.rx} ${a.y}C${a.rx + 36} ${a.y} ${b.rx + 36} ${b.y} ${b.rx} ${b.y}`
  }
  // 나머지 선은 path 하나(요소 수천 개면 옮길 때마다 느리다) · 끌거나 휠을 굴리는 동안은 숨긴다(CSS .gerdw.drag)
  const backD = []
  let front = '', nl = 0
  for (const e of G.edges) {
    if (e.t === 'in') continue
    const a = at[e.a], b = at[e.b]
    if (!a || !b) continue
    const mine = !!sel && (e.a === sel || e.b === sel || S.g.open.includes(e.a) || S.g.open.includes(e.b))
    if (mine) { front += `<path class="gln lit" d="${path(a, b)}"/>`; nl++ } else if (f.line) { backD.push(path(a, b)); nl++ }
  }
  // 가운데 점 끝에 점 하나 — 선이 어디서 나가는지
  const sa = sel && at[sel]
  const dot = sa ? `<circle class="gdot" cx="${sa.rx}" cy="${sa.y}" r="3.5"/><circle class="gdot" cx="${sa.lx}" cy="${sa.y}" r="3.5"/>` : ''
  const H = best.H, c = gC2()
  return `<svg class="gerd" role="group" aria-label="${esc(`그래프 2D 표: 점 ${nodes.length} · 선 ${nl}`)}" data-t="gErd" data-n="${nodes.length}" data-lines="${nl}" data-w="${W}" data-h="${H}"><g id="gerdg" transform="translate(${f1(c.px)} ${f1(c.py)}) scale(${+c.z.toFixed(3)})">${backD.length ? `<path class="gln gbk" d="${backD.join(' ')}"/>` : ''}${front}${recS}${boxS}${dot}</g></svg>`
}
// 2D 표 카메라 — 처음(고른 점 · 보는 방법 · 지식이 바뀌면): 고른 뒤에는 다 들어오게 · 전체는 폭에 맞춰 위부터
const gC2 = () => S.g.cam2 || (S.g.cam2 = { z: 1, px: 8, py: 64, needFit: true })
function gErdApply() { const g = $('#gerdg'), c = gC2(); if (g) g.setAttribute('transform', `translate(${f1(c.px)} ${f1(c.py)}) scale(${+c.z.toFixed(3)})`) }
function gErdFit() {
  const w = $('#app .gerdw'), sv = $('#app .gerd'), c = gC2()
  if (!w || !sv) return
  if (!c.needFit) return gErdApply()
  const cw = w.clientWidth, ch = w.clientHeight, W = Number(sv.dataset.w), H = Number(sv.dataset.h), top = 64
  if (!cw || !ch || !W || !H) return
  const vis = !!(CURG && CURG.vis)
  const zFit = Math.max(0.05, Math.min(vis ? 1.25 : 1, (cw - 16) / W, (ch - top - 8) / H))
  // 읽히는 배율(UX G1-08) — 전체 보기에서 다 넣으면 너무 작으면 0.45 로 왼쪽 위부터(사람이 [다 넣기] 를 고르면 그대로)
  c.small = !vis && !c.all && zFit < 0.45
  c.z = c.small ? 0.45 : zFit
  c.px = c.small ? 8 : Math.max(8, (cw - W * c.z) / 2)
  c.py = c.small ? top : Math.max(top, top + (ch - top - H * c.z) / 2)
  c.needFit = false
  const tip = $('#app [data-t=gErdTip]'); if (tip) tip.hidden = !c.small
  gErdApply()
}
function gErdZoom(lx, ly, k) { const c = gC2(), z2 = Math.max(0.15, Math.min(3, c.z * k)), q = z2 / c.z; c.px = lx - (lx - c.px) * q; c.py = ly - (ly - c.py) * q; c.z = z2; gErdApply() }
// 2D 표 — 끌어 옮기기(왼쪽 끌기 · 가운데 단추 · 스페이스 + 끌기) · 휠: 크게 · 작게(마우스 자리 중심) · 끌고 난 누름은 점 고르기가 아니다
let GD2 = null, G2MOVED = 0
document.addEventListener('pointerdown', (ev) => {
  const w = ev.target.closest && ev.target.closest('.gerdw')
  if (!w || ev.button === 2) return
  const c = gC2()
  GD2 = { x: ev.clientX, y: ev.clientY, px: c.px, py: c.py, moved: false }
  if (GSPACE || ev.button === 1) ev.preventDefault()
})
document.addEventListener('pointermove', (ev) => {
  if (!GD2) return
  const dx = ev.clientX - GD2.x, dy = ev.clientY - GD2.y
  if (!GD2.moved && Math.hypot(dx, dy) < 5) return
  GD2.moved = true
  const c = gC2()
  c.px = GD2.px + dx; c.py = GD2.py + dy
  gErdApply()
  const w = $('#app .gerdw'); if (w) w.classList.add('drag')
})
document.addEventListener('pointerup', () => { if (!GD2) return; if (GD2.moved) G2MOVED = Date.now(); GD2 = null; const w = $('#app .gerdw'); if (w) w.classList.remove('drag') })
document.addEventListener('click', (ev) => { if (Date.now() - G2MOVED < 300 && ev.target.closest && ev.target.closest('.gerdw')) { ev.stopImmediatePropagation(); ev.preventDefault() } }, true)
let GWT = 0
document.addEventListener('wheel', (ev) => { const w = ev.target.closest && ev.target.closest('.gerdw'); if (!w) return; ev.preventDefault(); w.classList.add('drag'); clearTimeout(GWT); GWT = setTimeout(() => w.classList.remove('drag'), 160); const r = w.getBoundingClientRect(); gErdZoom(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015)) }, { passive: false })
// 스페이스 — 그래프 칸 위에서 누르고 있으면 잡아 옮긴다(3D · 2D 표 같음 · 가운데 단추 끌기와 같은 일)
let GSPACE = false, GOVER = false
document.addEventListener('pointerover', (ev) => { GOVER = !!(ev.target.closest && ev.target.closest('#app .gwrap')) })
document.addEventListener('keydown', (ev) => {
  if (ev.code !== 'Space' || !GOVER || S.route.scr !== 'graph') return
  const t = ev.target
  if (t && t.matches && t.matches('input, textarea, select, [contenteditable]')) return
  ev.preventDefault(); ev.stopImmediatePropagation()
  if (!GSPACE) { GSPACE = true; const w = $('#app .gwrap'); if (w) w.classList.add('grab') }
}, true)
document.addEventListener('keyup', (ev) => { if (ev.code === 'Space' && GSPACE) { GSPACE = false; const w = $('#app .gwrap'); if (w) w.classList.remove('grab') } })
window.addEventListener('blur', () => { GSPACE = false })
function viewGraph() {
  const k = pickKn()
  if (!k) return { crumb: '그래프', main: viewHome().main }
  if (S.g.kn !== k) Object.assign(S.g, { kn: k, pos: {}, sub: null, sel: null, open: [], cur: null, visKey: '', layoutKey: '', bundle: false, cam: { rx: -0.35, ry: 0.6, zoom: 1, base: 1, px: 0, py: 0, needFit: true } })
  if (!M(k)) { const me = modelErr(k); return { crumb: '그래프', main: me ? errHtml(me, 'model:' + k) : loadingHtml, tabs: true, left: `<div class="gf">${me ? '' : loadingHtml}</div>` } }
  const G = graphData(k)
  G.deg = {}; G.nbr = {}
  G.nodes.forEach((n) => { G.deg[n.id] = 0; G.nbr[n.id] = new Set() })
  G.edges.forEach((e) => { G.deg[e.a]++; G.deg[e.b]++; G.nbr[e.a].add(e.b); G.nbr[e.b].add(e.a) })
  // 중요도 = 선 수 · 문서 ⊃ 제 항목(in) 선은 0.25 — 항목이 많은 문서가 저절로 가장 커지지 않게
  //   허브 = 중요도 상위 3%(5 ~ 20개) · 「제목」 을 꺼도 전체 그래프에서 이름을 쓴다
  G.w = {}
  G.nodes.forEach((n) => { G.w[n.id] = 0 })
  G.edges.forEach((e) => { const x = e.t === 'in' ? 0.25 : 1; G.w[e.a] += x; G.w[e.b] += x })
  G.hubs = new Set(G.nodes.filter((n) => !n.table && n.kind !== 'bundle' && G.w[n.id] >= 2).sort((a, b) => G.w[b.id] - G.w[a.id] || (a.id < b.id ? -1 : 1)).slice(0, Math.min(20, Math.max(5, Math.round(G.nodes.length * 0.03)))).map((n) => n.id))
  if (S.g.sel && !G.nbr[S.g.sel]) Object.assign(S.g, { sel: null, open: [], cur: null })
  if (S.g.cur && !G.nbr[S.g.cur]) S.g.cur = S.g.sel
  G.vis = gVisible(G)
  const vk = S.g.sel ? S.g.sel + '|' + S.g.open.join('|') : ''
  if (vk !== S.g.visKey) { S.g.visKey = vk; S.g.cam.needFit = true; gC2().needFit = true }
  const d3 = S.g.mode !== '2d'
  if (d3) {
    layoutGraph(G)
    if (G.vis) G.P = layoutSub(G); else { G.P = S.g.pos; S.g.sub = null }
    G.R3 = G.vis && S.g.sub && S.g.sub.R3 ? S.g.sub.R3 : Math.max(100, ...G.nodes.filter((n) => G.P[n.id]).map((n) => { const p = G.P[n.id]; return Math.hypot(p.x, p.y, p.z) }))
  }
  CURG = G
  const count = `<div class="gtl small"><span data-t="gCount">${gCountText(G, d3)}</span> <b class="t-warn" data-t="gHits"></b></div>`
  const legend = `<div class="glg small" data-t="gLegend">${['doc', 'item', 'rec'].map((v) => `<span class="lgr">${glyphIcon(v)}${KLAB[v]}</span>`).join('')}<span class="lgr"><svg class="gki" viewBox="0 0 16 16" aria-hidden="true"><line class="gln" x1="1" y1="8" x2="15" y2="8"/></svg>이어져 있다</span></div>`
  const card = gCardHtml(k, G)
  const main = d3
    ? `<div class="gwrap${UI.gdark ? ' dark' : ''}" data-t="graph" data-mode="3d"><canvas id="gcv" data-t="gcanvas" role="img" aria-label="${esc(gAria(G))}"></canvas><div class="gerd-tip" data-t="gLayBusy" role="status"${S.g.layBusy ? '' : ' hidden'}>점이 많아 그래프를 나눠 펴는 중이다 · 그사이 돌리거나 골라도 된다</div><div class="gerd-tip" data-t="gOutHint" role="status"${S.g.outHint && G.vis ? '' : ' hidden'}>뻗은 점 가운데 칸 밖 · 카드 밑에 있는 것이 있다 <button type="button" class="lk small" data-a="gRefit" data-t="gRefit">다 보이게</button></div>${(G.vis ? G.vis.size : G.nodes.length) ? '' : '<div class="empty2 gempty3" data-t="gEmpty3"><b>보일 점이 없다</b>왼쪽 「문서 · 항목 · 기록」 을 켠다.</div>'}${count}${legend}${card}<div class="gz"><button class="btn sm" data-a="gZoom" data-v="1.25" data-t="gZoomIn" title="크게">+</button><button class="btn sm" data-a="gZoom" data-v="0.8" data-t="gZoomOut" title="작게">−</button><button class="btn sm" data-a="gFit" data-t="gFit" title="보이는 점이 다 들어오게 · 처음 각도로">처음 크기</button></div><div class="ghint small">끌기: 돌리기 · 스페이스 · Shift · 오른쪽 끌기: 옮기기 · 휠: 크게 · 작게 · 점을 누르면 이웃 한 겹 · 이웃을 누르면 더 뻗는다</div></div>`
    : `<div class="gwrap erd${UI.gdark ? ' dark' : ''}" data-t="graph" data-mode="2d"><div class="gerdw" data-t="gErdWrap">${gErdSvg(k, G)}</div><div class="gerd-tip" data-t="gErdTip" role="status"${gC2().small ? '' : ' hidden'}>전체가 커서 읽히는 크기로 일부만 보인다 · 끌어 옮기거나 점을 고른다 <button type="button" class="lk small" data-a="gErdAll" data-t="gErdAll">다 넣기</button>${S.g.f.rec ? '<button type="button" class="lk small" data-a="gSet" data-v="rec" data-t="gErdNoRec">기록 열 끄기</button>' : ''}</div>${count}${legend}${card}<div class="gz"><button class="btn sm" data-a="gZoom" data-v="1.25" data-t="gZoomIn" title="크게">+</button><button class="btn sm" data-a="gZoom" data-v="0.8" data-t="gZoomOut" title="작게">−</button><button class="btn sm" data-a="gFit" data-t="gFit" title="처음 크기">처음 크기</button></div><div class="ghint small">끌기 · 스페이스 끌기: 옮기기 · 휠: 크게 · 작게 · 점을 누르면 그 점이 가운데</div></div>`
  if (!d3) requestAnimationFrame(gErdFit)
  return { crumb: '그래프', main, tabs: true, left: graphFilter(), full: true }
}
// 고른 점 카드 — 그래프 칸 안 오른쪽 위 · × 는 고르기를 닫고 전체 그래프로
function gCardHtml(k, G) {
  const id = S.g.cur, n = id && G.nodes.find((x) => x.id === id), info = n && nodeInfo(k, id)
  if (!info) return ''
  const nb = G.nbr[id] ? G.nbr[id].size : 0
  return `<div class="gov" data-t="gCard" data-name="${esc(info.name)}"><div class="row">${glyphIcon(n.kind)}<span class="small muted">${KLAB[n.kind]}${info.kind ? ' · ' + esc(info.kind) : ''}</span><button type="button" class="hb r" data-a="gUnsel" data-t="gClose" title="고르기 닫기: 전체 그래프로" aria-label="고르기 닫기: 전체 그래프로">×</button></div><div class="gn">${esc(info.name)}</div><div class="small gfirst">${esc(plainMd(info.first).slice(0, 160))}</div><div class="small muted" data-t="gCardRecs">${info.recs && n.kind !== 'rec' && id === S.g.sel ? `<button type="button" class="lk small" data-a="gRecs" data-t="gRecs" aria-pressed="${S.g.recsOf === id}">${S.g.recsOf === id ? '기록 거두기' : `기록 ${info.recs} 펴기`}</button>` : `기록 ${info.recs}`} · 이웃 ${nb}</div><div class="row u-wrap"><button class="btn pri sm" data-a="gOpen" data-v="docs" data-t="gOpenDocs"${info.doc ? '' : ' disabled'}>문서로 보기</button><button class="btn sm" data-a="gOpen" data-v="items" data-t="gOpenItems"${info.item ? '' : ' disabled'}>항목으로 보기</button>${S.g.mode !== '2d' && (S.g.open || []).length ? '<button class="btn ghost sm" data-a="gUndoOpen" data-t="gUndoOpen" title="마지막으로 뻗은 것을 거둔다">뻗기 거두기</button><button class="btn ghost sm" data-a="gFirst" data-t="gFirst" title="처음 고른 점만">처음 점으로</button>' : ''}</div>${S.g.mode === '2d' && (S.g.trail || []).length ? `<div class="gtrail small" data-t="gTrail"><span class="muted">지나온 점</span>${S.g.trail.slice(-5).map((t) => { const o = G.nodes.find((x) => x.id === t); return o ? `<button type="button" class="lk" data-a="gBack" data-v="${esc(t)}" title="${esc(o.label)}">${esc(gFit(o.label, 110, 12))}</button>` : '' }).join('<span class="muted">›</span>')}</div>` : ''}<div class="small muted gcap">${S.g.mode === '2d' ? '점을 누르면 그 점이 가운데 · × 로 닫으면 전체' : '이웃을 누르면 그 점에서 한 겹 더 · × 로 닫으면 전체'}</div></div>`
}
// 왼쪽 칸 — 그래프를 어떻게 보일지 정하는 판 다섯(묶음마다 이름표): 찾기 · 보는 방법(3D | 2D 표) · 보기(선 · 제목 · 회전) · 종류(문서 · 항목 · 기록) · 바탕(밝게 | 어둡게)
//   찾기는 맞는 점을 밝히고 Enter 면 맞는 첫 점(선 많은 차례)을 고른다 · 제목 · 회전은 3D 에서만 쓴다
function graphFilter() {
  const f = S.g.f, d3 = S.g.mode !== '2d'
  const vb = (v, ic, l, title, off) => `<button type="button" class="fbtn" aria-pressed="${!!f[v] && !off}" data-a="gSet" data-v="${v}" data-t="g-${v}" title="${esc(off ? title + ' (3D 에서 쓴다)' : title)}"${off ? ' disabled' : ''}>${svg(ic)}${l}</button>`
  const kd = (v, l) => `<button type="button" class="fbtn" aria-pressed="${!!f[v]}" data-a="gSet" data-v="${v}" data-t="gk-${v}">${glyphIcon(v)}${l}</button>`
  const md = (v, l, title) => fbtn(v === '3d' ? d3 : !d3, ` data-a="gMode" data-v="${v}" data-t="gm-${v}"`, l, title)
  return `<div class="gf" data-t="gFilter">
  <div class="gfs"><div class="gh" id="gh-q">찾기</div><div class="lhead"><input class="inp" id="gQ" aria-labelledby="gh-q" aria-describedby="gq-tip" data-in="gQ" data-t="gQ" value="${esc(f.q)}" placeholder="이름 · 맞는 점을 밝힌다" autocomplete="off"></div><div class="small muted gtip" id="gq-tip">Enter 면 맞는 첫 점을 고른다</div></div>
  <div class="gfs"><div class="gh" id="gh-mode">보는 방법</div><div class="vgrp gfr" role="group" aria-labelledby="gh-mode" data-t="gMode">${md('3d', '3D', '힘 배치 · 끌어 돌린다')}${md('2d', '2D 표', '문서 상자 안에 항목 줄 · 기록은 왼쪽 열')}</div></div>
  <div class="gfs"><div class="gh" id="gh-view">보기</div><div class="vgrp gfr" role="group" aria-labelledby="gh-view" data-t="gView">${vb('line', 'line', '선', '모든 선을 그린다. 끄면 고른 점의 이웃 선만')}${vb('label', 'title', '제목', '모든 점의 제목을 쓴다. 끄면 올리거나 고른 점만', !d3)}${vb('spin', 'sync', '회전', '천천히 돈다. 끌거나 점에 올리면 멈춘다', !d3)}</div></div>
  <div class="gfs"><div class="gh" id="gh-kind">종류</div><div class="vgrp gfr" role="group" aria-labelledby="gh-kind" data-t="gKind">${kd('doc', '문서')}${kd('item', '항목')}${kd('rec', '기록')}</div></div>
  <div class="gfs"><div class="gh" id="gh-bg">바탕</div><div class="vgrp gfr" role="group" aria-labelledby="gh-bg" data-t="gBg">${fbtn(!UI.gdark, ' data-a="gDark" data-v="0" data-t="gb-light"', '밝게', '그래프 칸을 밝은 바탕으로')}${fbtn(!!UI.gdark, ' data-a="gDark" data-v="1" data-t="gb-dark"', '어둡게', '그래프 칸만 어두운 바탕으로(이 브라우저에 남긴다)')}</div></div></div>`
}
// 찾기 칸 Enter — 맞는 첫 점(선 많은 차례)을 고른다
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' || ev.isComposing || !ev.target || ev.target.id !== 'gQ' || !CURG) return
  const q = norm(ev.target.value || ''), G = CURG
  if (!q) return
  const hit = G.nodes.filter((n) => norm(n.label || '').includes(q)).sort((a, b) => (G.deg[b.id] || 0) - (G.deg[a.id] || 0))[0]
  if (!hit) return toast('맞는 점이 없다')
  ev.preventDefault()
  gClick(hit.id)
})
function nodeInfo(k, id) {
  const i = id.indexOf(':'), t = id.slice(0, i), ref = id.slice(i + 1), m = M(k)
  if (t === 'i') { const it = itemByKey(k, ref); if (!it) return null; const rs = recsOfItem(k, it); return { kind: it.kind + (it.val ? ' · ' + it.val : ''), name: it.name, first: firstLine(k, it), recs: rs.length, doc: it.doc ? { ref: it.doc, hl: it.sec } : null, item: it.key } }
  if (t === 'd') { const d = m.docById.get(ref); if (!d) return null; const its = d.items.map((x) => itemByKey(k, x)).filter(Boolean); const rs = m.recs.filter((r) => r.items.some((x) => d.items.includes(x))); return { kind: '항목 ' + its.length, name: d.title, first: d.first, recs: rs.length, doc: { ref: d.id }, item: its[0] ? its[0].key : null } }
  if (t === 'r') { const r = m.recById.get(ref); if (!r) return null; return { kind: r.author + ' · ' + recDt(r.date), name: r.title, first: r.body, recs: 1, doc: { rec: r.id }, item: r.items[0] || null } }
  return null
}

// ───────────── 미리보기 카드(이름 · 링크에 마우스) ─────────────
let pvT = null
function hidePv() { clearTimeout(pvT); const h = document.getElementById('pvHost'); if (h) h.innerHTML = '' }
function pvHtml(spec) {
  const parts = String(spec).split('|'), kind = parts[0], k = parts[1], ref = parts.slice(2).join('|')
  const m = M(k)
  if (!m) return ''
  if (kind === 'item') { const it = itemByKey(k, ref); if (!it) return ''; const d = it.doc && m.docById.get(it.doc), rs = recsOfItem(k, it); return `<div class="pv" data-t="pv"><div class="ph"><span class="kt src">${esc(it.kind)}</span><b>${esc(it.name)}</b></div><div>${esc(plainMd(firstLine(k, it)))}</div><div class="pm">${d ? esc(d.title + ' › ' + it.sec) + ' · 바뀐 때 ' + esc(whenTxt(d.when)) : '아직 문서에 없다'} · 기록 ${rs.length}</div></div>` }
  if (kind === 'doc') { const d = m.docById.get(ref); if (!d) return ''; return `<div class="pv" data-t="pv"><div class="ph">${svg('doc')}<b>${esc(d.title)}</b></div><div>${esc(plainMd(d.first))}</div><div class="pm">바뀐 때 ${esc(whenTxt(d.when))} · 항목 ${d.items.length}</div></div>` }
  if (kind === 'rec') { const r = m.recById.get(ref); if (!r) return ''; return `<div class="pv" data-t="pv"><div class="ph"><i class="pd"></i><b>${esc(r.title)}</b></div><div>${esc(plainMd(r.body).slice(0, 240))}</div><div class="pm">${esc(r.author)} · ${esc(recDt(r.date))}</div></div>` }
  return ''
}
function showPv(el) {
  if (!document.body.contains(el)) return
  const h = pvHtml(el.dataset.pv), host = document.getElementById('pvHost')
  if (!h || !host) return
  host.innerHTML = h
  const c = host.firstElementChild, r = el.getBoundingClientRect()
  const side = el.closest('.side'), sr = side && side.getBoundingClientRect()
  let x = Math.min(r.left, innerWidth - 300), y = r.bottom + 6
  if (sr && sr.right + 300 < innerWidth) { x = sr.right + 8; y = Math.min(r.top, innerHeight - c.offsetHeight - 8) }
  else if (y + c.offsetHeight > innerHeight - 8) y = r.top - c.offsetHeight - 6
  c.style.left = Math.max(8, x) + 'px'
  c.style.top = Math.max(8, y) + 'px'
}
let pvOff = null // 누른 요소 — 떠날 때까지 카드를 다시 띄우지 않는다
let pvMouse = true // 마지막 누름이 마우스였나(터치 · 펜이면 미리보기를 띄우지 않는다 · UX T1-29)
document.addEventListener('pointerdown', (ev) => { pvMouse = ev.pointerType === 'mouse' }, true)
document.addEventListener('pointerdown', (ev) => { const el = ev.target.closest && ev.target.closest('[data-pv]'); if (el) pvOff = el; hidePv() }, true)
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' || ev.key === 'Enter') hidePv() }, true)
document.addEventListener('mouseover', (ev) => { const el = ev.target.closest && ev.target.closest('[data-pv]'); if (!el || el === pvOff || !pvMouse) return; if (ev.relatedTarget && el.contains(ev.relatedTarget)) return; clearTimeout(pvT); pvT = setTimeout(() => showPv(el), 250) })
document.addEventListener('mouseout', (ev) => { const el = ev.target.closest && ev.target.closest('[data-pv]'); if (!el) return; if (ev.relatedTarget && el.contains(ev.relatedTarget)) return; if (el === pvOff) pvOff = null; hidePv() })

// 그래프 — 왼쪽 끌기: 돌리기 · Shift · 가운데 · 오른쪽 끌기: 옮기기 · 휠: 크게 · 작게(마우스 자리 중심) · 누르면 고른다
let GD = null
document.addEventListener('pointerdown', (ev) => {
  const cv = ev.target.closest && ev.target.closest('#gcv')
  if (!cv) return
  const pan = ev.shiftKey || GSPACE || ev.button === 1 || ev.button === 2, C = S.g.cam
  GD = { cv, pan, node: pan ? null : gHit(ev.clientX, ev.clientY), sx: ev.clientX, sy: ev.clientY, moved: false, rx: C.rx, ry: C.ry, px: C.px, py: C.py }
  ev.preventDefault()
})
document.addEventListener('pointermove', (ev) => {
  if (!GD) {
    const cv = ev.target.closest && ev.target.closest('#gcv'), id = cv ? gHit(ev.clientX, ev.clientY) : null
    if (id !== GH) { GH = id; if (cv) cv.style.cursor = id ? 'pointer' : ''; gStart() }
    return
  }
  const dx = ev.clientX - GD.sx, dy = ev.clientY - GD.sy, C = S.g.cam
  if (!GD.moved && Math.hypot(dx, dy) < 4) return
  GD.moved = true
  GD.cv.style.cursor = 'grabbing'
  if (GD.pan) { C.px = GD.px + dx; C.py = GD.py + dy } else { C.ry = GD.ry + dx * 0.006; C.rx = Math.max(-1.5, Math.min(1.5, GD.rx + dy * 0.006)) }
  gPaint()
})
document.addEventListener('pointerup', () => { if (!GD) return; const g = GD; GD = null; g.cv.style.cursor = ''; if (!g.moved && g.node) { gClick(g.node); return } gStart() })
document.addEventListener('contextmenu', (ev) => { if (ev.target.closest && ev.target.closest('#gcv')) ev.preventDefault() })
document.addEventListener('wheel', (ev) => { const cv = ev.target.closest && ev.target.closest('#gcv'); if (!cv) return; ev.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015)) }, { passive: false })
window.addEventListener('resize', () => { if ($('#gcv')) gPaint() })

// ───────────── 고치기 저장 — 글을 항목으로 다시 갈라 바뀐 항목만 보낸다 ─────────────
function forgetKn(k) { for (const key of Object.keys(S.cache)) if (key.startsWith(`tree:${k}`) || key.startsWith(`doc:${k}:`) || key.startsWith(`rec:${k}:`) || key.startsWith(`model:${k}`) || key.startsWith(`item:${k}:`)) delete S.cache[key] }
// 편집기 글 — 쓰던 글(S.edit.text)이 있으면 그것 · 없으면 서버의 글. 다시 그려도 · 찾기 · 다른 화면에 갔다 와도 그대로
const edOrig = (d) => d.sections.map((s) => '## ' + s.h + '\n' + s.md).join('\n\n')
function edText(d) {
  if (S.edit.orig == null) S.edit.orig = edOrig(d)
  if (S.edit.text == null && !d.sections.length && !S.edit.orig) S.edit.text = '## 개요\n\n'
  return S.edit.text != null ? S.edit.text : S.edit.orig
}
const edKey = (e) => `kmdDraft:${e.kn}|${e.doc}`
const edDirty = () => !!S.edit && S.edit.text != null && S.edit.text !== S.edit.orig
function edDrop() { if (S.edit) { try { sessionStorage.removeItem(edKey(S.edit)) } catch {} } S.edit = null }
// 고치는 중인 글을 버리는 길(그만두기 · 탭 닫기 · 지식 지우기 …) — 바뀐 글이 있으면 묻는다
async function edLeave(what) { return !edDirty() || (await ask1('고치던 글 버리기', '버리기', true, `저장하지 않은 글이 있다: ${what}면 버린다`)) }
window.addEventListener('beforeunload', (ev) => { if (edDirty() || (S.imports || []).some((x) => x.cls === 'run' || x.busy || x.sending)) { ev.preventDefault(); ev.returnValue = '' } })
function edFit(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 4, Math.max(320, innerHeight - 220)) + 'px' }
function edChanges(d, txt) {
  const parts = []
  let cur = null
  for (const line of String(txt).split('\n')) { const m = line.match(/^##\s+(.+)$/); if (m) { cur = { h: m[1].trim(), b: [] }; parts.push(cur) } else if (cur) cur.b.push(line) }
  const old = new Map(d.sections.map((x) => [x.h, x.md]))
  const out = []
  for (const p of parts) {
    const now = p.b.join('\n').trim(), was = (old.get(p.h) || '').trim()
    if (old.has(p.h) && now === was) continue
    const a = was.split('\n').filter((l) => l.trim()), b = now.split('\n').filter((l) => l.trim())
    out.push({ h: p.h, isNew: !old.has(p.h), del: a.filter((l) => !b.includes(l)), add: b.filter((l) => !a.includes(l)) })
  }
  for (const h of old.keys()) if (!parts.some((p) => p.h === h)) out.push({ h, gone: true, del: [], add: [] })
  return out
}
function edPreviewHtml(k, d) {
  const ch = edChanges(d, edText(d))
  if (!ch.length) return '<div class="diff" data-t="edDiff"><div class="ln2">아직 바뀐 글이 없다</div></div>'
  return ch.map((c) => {
    return `<div class="diff" data-t="edDiff"><div class="fh">${esc(c.h)}${c.isNew ? ' · 새 항목' : c.gone ? ' · 지움' : ''}</div>${c.del.map((l) => `<div class="ln2 del">${esc(l)}</div>`).join('')}${c.add.map((l) => `<div class="ln2 add">${esc(l)}</div>`).join('')}</div>` }).join('')
}
async function saveDoc() {
  const e = S.edit
  if (!e || e.busy) return
  const d = S.cache[`doc:${e.kn}:${e.doc}:ed`]
  if (!d || d.error) return
  const txt = e.text != null ? e.text : $('#edTx').value
  const parts = []
  const pre = [] // 첫 ## 위 글
  let cur = null
  txt.split('\n').forEach((line) => {
    const m = line.match(/^##\s+(.+)$/)
    if (m) { cur = { h: m[1].trim(), b: [] }; parts.push(cur) } else { if (!cur) { if (line.trim()) pre.push(line); return } cur.b.push(line) }
  })
  if (pre.length) { e.err = `첫 「## 」 줄 위에 글이 있다: 「${pre[0].trim().slice(0, 30)}」. 항목 글은 「## 머리」 아래에 쓴다(문서 요약은 문서 다듬기 · 세션이 쓴다)`; render(); return }
  const old = new Map(d.sections.map((s) => [s.h, s]))
  const now = parts.map((p) => ({ h: p.h, body: p.b.join('\n').replace(/^\n+|\n+$/g, '') }))
  const trim = (x) => String(x).replace(/\s+$/, '')
  // 빠진 항목 — 글이 같은 새 이름이 있으면 이름 바꾸기, 아니면 지우기
  const gone = d.sections.filter((s) => !now.some((p) => p.h === s.h))
  const rename = []
  const remove = []
  for (const s of gone) {
    const to = now.find((p) => !old.has(p.h) && trim(p.body) === trim(s.md) && !rename.some((x) => x.to === p.h))
    if (to) rename.push({ from: s.h, to: to.h })
    else remove.push(s.h)
  }
  const changed = now.filter((p) => !rename.some((x) => x.to === p.h)).filter((p) => !old.has(p.h) || trim(old.get(p.h).md) !== trim(p.body))
  if (!changed.length && !remove.length && !rename.length) { edDrop(); toast('바뀐 글이 없다. 그대로 두었다'); render(); return }
  e.err = null; e.errSecs = null
  if ((remove.length || rename.length) && !d.structure) { e.err = `항목을 지우거나 이름을 바꾸는 일은 지식관리자가 한다: ${[...remove, ...rename.map((x) => x.from)].join(' · ')} 의 「## 」 줄을 되살린다`; render(); return }
  // 승인 저장 지식(저장 승인 P5 · P-D39) — [저장] 은 저장 확인 창(저장 제안을 보고 [넣기] 가 승인 · 지움 · 이름 바뀜 줄도 그 창에)
  if (svApprove(e.kn)) return saveDocSv(e, txt, old, changed, remove, rename)
  if ((remove.length || rename.length) && !await ask1('항목 지우기 · 이름 바꾸기', '이대로 저장', false, [remove.length ? `지울 항목 ${remove.length}: ${remove.join(' · ')}` : '', rename.length ? `이름 바꿀 항목 ${rename.length}: ${rename.map((x) => x.from + ' → ' + x.to).join(' · ')}` : '', changed.length ? `고친 항목 ${changed.length}` : ''].filter(Boolean).join('\n') + '\n\n이대로 저장한다')) return
  e.busy = true
  render()
  try {
    const r = await postJSON(`/api/k/${encodeURIComponent(e.kn)}/edit`, { ...edBody(e, old, changed, remove, rename), ...(edWhy(e) ? { why: edWhy(e) } : {}) })
    saveDocDone(e, txt, r)
  } catch (err) {
    e.busy = false
    await saveDocFail(e, err, txt, old, changed)
  }
  render()
}
// 고치기 몸(글 · 지문) — 겹쳐 지킨 지문(keepBase)이 있으면 그것
const edBody = (e, old, changed, remove, rename) => ({ ...(e.fixes ? { fixes: e.fixes } : {}), doc: e.doc, sections: changed.map((p) => ({ h: p.h, body: p.body, ...(old.has(p.h) ? { base: (e.keepBase && e.keepBase[p.h]) || old.get(p.h).base } : {}) })), remove, rename })
const edWhy = (e) => ((($('#edWhy') || {}).value || e.why || '').trim()).slice(0, 200)
// 승인 저장 지식의 고치기 — 창이 dry(쓰지 않는 저장 제안) → [넣기] 가 proposal 을 싣는다(서버가 같은 제안을 다시 만들어 대 본다)
function saveDocSv(e, txt, old, changed, remove, rename) {
  const url = `/api/k/${encodeURIComponent(e.kn)}/edit`
  const body = edBody(e, old, changed, remove, rename)
  const flds = (f) => ({ ...(f.changes.length ? { changes: f.changes } : {}), ...(f.why ? { why: f.why } : {}) })
  return svOpen({
    k: e.kn,
    ops: [...remove.map((h) => [h, '지움']), ...rename.map((x) => [`${x.from} → ${x.to}`, '이름 바뀜'])],
    fields: { changes: [], why: edWhy(e) },
    fill: true,
    again: async (f) => (await postJSON(url, { ...body, ...flds(f), dry: true })).propose,
    send: (proposal, f) => postJSON(url, { ...body, ...flds(f), ...(proposal ? { proposal } : {}) }),
    done: (r, f) => { if (S.edit === e) e.why = f.why; saveDocDone(e, txt, r); render() },
    fail: async (err) => { await saveDocFail(e, err, txt, old, changed); render() },
  })
}
// 저장한 뒤 — 그사이 더 쓴 글(붙여 넣기 · 다른 탭)이 있으면 버리지 않는다 · 저장한 글을 바탕으로 이어 고친다
function saveDocDone(e, txt, r) {
  const later = S.edit === e && e.text != null && e.text !== txt
  if (later) { e.orig = txt; e.busy = false; e.keepBase = null; e.conflict = null; e.errSecs = null } else edDrop()
  myWrites.set(e.kn + '|' + e.doc, Date.now())
  forgetKn(e.kn)
  // 저장은 했다 — 서버 알림(문서 짜임 · 그대로 둔 줄 · 백업)은 오류가 아닌 알림으로 같은 토스트에(role=status)
  const msg = '저장했다. 문서에도 넣었다'
  const warns = (Array.isArray(r.warnings) ? r.warnings : []).filter(Boolean)
  toast(warns.length ? `<span class="tw">${esc(msg)}<small data-t="saveWarn">${warns.slice(0, 3).map((w) => esc(w)).join('<br>')}${warns.length > 3 ? `<br>그 밖 ${warns.length - 3}` : ''}</small></span>` : esc(msg), warns.length ? 10000 : 7000)
}
// 저장하지 못함 — 읽은 뒤 바뀜(E_CONFLICT)은 새 글을 다시 읽어 바탕만 바꾸고 쓴 글은 지킨다 · 꼴 · 입력 오류는 편집기 아래
async function saveDocFail(e, err, txt, old, changed) {
  // 그사이 저장 방식이 바뀌었다(승인 저장으로 켜짐 · 꺼짐) — 지식 줄을 다시 읽고 맞는 길로 한 번 더(창 · 바로)
  if ((err.code === 'E_APPROVE' && err.details && err.details.propose && !svApprove(e.kn)) || (err.code === 'E_INPUT' && err.details && err.details.mode && svApprove(e.kn))) {
    await reloadKns()
    if (svApprove(e.kn) === (err.code === 'E_APPROVE')) { e.busy = false; return saveDoc() }
  }
  if (err.code === 'E_CONFLICT') {
    // 읽은 뒤 누가 고쳤다 — 새 글을 다시 받아 바탕(orig · base)만 바꾸고 쓰던 글은 지킨다(설계 4-2)
    const key = `doc:${e.kn}:${e.doc}:ed`
    try {
      const v = await getJSON(`/api/k/${encodeURIComponent(e.kn)}/doc?d=${encodeURIComponent(e.doc)}&edit=1`)
      const hOf = (c) => String(c).replace(/^.*(#| › )/, '')
      const nb = Object.fromEntries(v.sections.map((s) => [s.h, s.base])) // 내가 고친 항목 가운데 지문이 바뀐 것 — 서버 stale 은 항목(coord)일 수 있어 화면이 직접 견준다
      const ob = (h) => (e.keepBase && e.keepBase[h]) || (old.has(h) ? old.get(h).base : null) // 이미 겹쳐 지킨 지문이 있으면 그것
      const stale = changed.map((p) => p.h).filter((h) => ob(h) && nb[h] !== ob(h))
      if (!stale.length) stale.push(...((err.details && err.details.stale) || []).map(hOf))
      const oldBase = Object.fromEntries(stale.map((h) => [h, ob(h)]))
      S.cache[key] = v
      if (e.text == null) e.text = txt
      e.orig = edOrig(v)
      // 겹친 항목은 읽던 때의 지문을 지킨다 — 그대로 [저장] 하면 다시 막힌다(남의 고침을 말없이 덮지 않는다)
      e.keepBase = Object.fromEntries(stale.filter((h) => oldBase[h]).map((h) => [h, oldBase[h]]))
      e.conflict = stale.map((h) => ({ h, theirs: (v.sections.find((s) => s.h === h) || {}).md || '' }))
      e.err = `읽은 뒤 누가 고친 항목이 있다: ${stale.join(' · ') || '알 수 없음'}. 아래 그사이 바뀐 글을 보고 내 글에 합친 뒤 [내 글로 저장] 을 누르거나 [그쪽 글로] 를 고른다`
    } catch (x) { e.err = `읽은 뒤 누가 고쳤다. 새 글을 다시 읽지 못했다: ${x.message}` }
  } else if (err.code === 'E_FORMAT' || err.code === 'E_INPUT') { e.err = `저장하지 않았다(함께 고친 항목 ${changed.length}개 모두): ${err.message}`; e.errSecs = changed.map((p) => p.h).filter((h) => String(err.message).includes(h)) }
  else if (err.code !== 'E_CANCEL') toastErr(err)
}

// ───────────── 저장 확인 창(저장 승인 설계 2-3 · P-D39 · P5) ─────────────
//   승인 저장 지식(지식 줄 save === 'approve' · 팀 · 개인 같은 창)에서 사람이 화면에서 쓰는 저장(문서 고치기 · 별칭 더하기 …)은
//   먼저 저장 제안(쓰지 않음)을 받아 이 창에 보이고, [넣기] 가 승인이다(경고를 받아들인다 · 서버가 같은 제안을 다시 만들어 지문을 대 본다).
//   S.sv = { k, p(제안) · ops([이름, 갈래] 지움 · 이름 바뀜) · fields({ changes, why } | null) · dirty · busy · err · note · raw ·
//            again(fields) → 제안 · send(proposal, fields) → 결과 · done(결과, fields) · fail(오류)(읽은 뒤 바뀜 · 꼴 · 입력 오류) }
const svApprove = (k) => !!KN(k) && KN(k).save === 'approve'
const svChanged = (p) => (p && p.items || []).flatMap((x) => (x.changed || []).map((c) => `${x.heading}: ${c.from} → ${c.to}`.slice(0, 200))).slice(0, 20)
async function svOpen(o) {
  S.sv = { ...o, p: null, busy: true, dirty: false, err: null, note: null, raw: false }
  render()
  await svAsk()
}
// 제안 받기 — 처음(fill)에는 바뀐 값으로 「바뀐 것」 을 채워 한 번 더(차이에서 채움 · 고칠 수 있음)
async function svAsk() {
  const w = S.sv
  if (!w) return
  w.busy = true; w.err = null
  // 읽는 동안 칸을 고치면 다시 볼 것으로 남긴다(고친 글을 덮지 않는다)
  const snap = JSON.stringify(w.fields)
  try {
    let p = await w.again(w.fields)
    if (S.sv !== w) return
    if (w.fill && w.fields && !w.fields.changes.length && svChanged(p).length && JSON.stringify(w.fields) === snap) {
      const was = w.fields.changes
      w.fields.changes = svChanged(p)
      try { p = await w.again(w.fields) } catch (err) { if (S.sv !== w) return; if (err.code !== 'E_INPUT') throw err; w.fields.changes = was }
    }
    w.fill = false
    if (S.sv !== w) return
    w.p = p
    w.dirty = w.dirty && JSON.stringify(w.fields) !== snap
  } catch (err) {
    if (S.sv !== w) return
    if (await svFail(w, err)) return
  }
  w.busy = false
  render()
}
// 창 밖에서 다룰 오류(읽은 뒤 바뀜 · 꼴 · 입력 오류)는 창을 닫고 부른 쪽이 · 그 밖은 창 안 오류 줄
async function svFail(w, err) {
  if (err.code === 'E_CANCEL') { w.busy = false; render(); return true }
  if (w.fail && ['E_CONFLICT', 'E_FORMAT', 'E_INPUT', 'E_FORBIDDEN', 'E_NOTFOUND'].includes(err.code)) { S.sv = null; render(); await w.fail(err); return true }
  w.err = err.message
  return false
}
async function svGo() {
  const w = S.sv
  if (!w || w.busy) return
  if (w.dirty || (!w.p && !w.ops?.length)) return svAsk()
  if (w.p && w.p.errors.length) return
  w.busy = true; w.err = null; w.note = null
  render()
  try {
    const r = await w.send(w.p ? w.p.proposal : null, w.fields)
    if (S.sv === w) S.sv = null
    await w.done(r, w.fields)
  } catch (err) {
    if (S.sv !== w) return
    // 그사이 제안이 바뀌었다 — 새 제안을 보이고 다시 [넣기](서버가 준 것이 없으면 다시 묻는다)
    if (err.code === 'E_APPROVE') {
      w.note = '그사이 바뀌었다. 다시 보고 넣는다'
      if (err.details && err.details.propose) w.p = err.details.propose
      else { w.busy = false; return svAsk() }
    } else if (await svFail(w, err)) return
    w.busy = false
  }
  render()
}
function svClose() { if (S.sv && !S.sv.busy) { S.sv = null; render() } }
const SV_KIND = { 고침: '고침', 신설: '새 항목', 잇기: '글 그대로' }
// 새로 세운 것의 갈래 말 — 기록 칸(저장 꼴)의 「이름」 은 장부에 오른 새 항목 · 「항목」 은 문서에 선 새 머리
const FRESH_KIND = { 이름: '항목(장부)', 항목: '항목(문서)' }
// 바뀐 줄만(편집기 「바뀐 것 보기」 와 같은 꼴)
function svItemHtml(x) {
  const a = String(x.before || '').split('\n').filter((l) => l.trim()), b = String(x.after || '').split('\n').filter((l) => l.trim())
  const del = x.kind === '고침' ? a.filter((l) => !b.includes(l)) : [], add = x.kind === '잇기' ? [] : x.kind === '고침' ? b.filter((l) => !a.includes(l)) : b.slice(0, 6)
  return `<div class="diff" data-t="svItem"><div class="fh">${esc(x.at)} <small class="muted">${esc(SV_KIND[x.kind] || x.kind)}</small></div>${del.map((l) => `<div class="ln2 del">${esc(l)}</div>`).join('')}${add.map((l) => `<div class="ln2 add">${esc(l)}</div>`).join('')}</div>`
}
function svHtml() {
  const w = S.sv, p = w.p, n = KN(w.k)
  const items = p ? p.items.map(svItemHtml).join('') : ''
  const ops = (w.ops || []).map(([h, g]) => `<div class="diff" data-t="svOp"><div class="fh">${esc(h)} <small class="muted">${esc(g)}</small></div></div>`).join('')
  const fresh = p && (p.fresh || []).filter((x) => x.kind !== '항목').length ? `<div class="small" data-t="svFresh"><b>새로 생긴 것</b> ${p.fresh.filter((x) => x.kind !== '항목').map((x) => `${esc(FRESH_KIND[x.kind] || x.kind)} ${esc(String(x.name).replace(/^docs\//, '').replace(/\.md$/, ''))}`).join(' · ')}</div>` : ''
  const fl = w.fields ? `<div class="field"><label for="svChg">바뀐 것</label><textarea class="inp" id="svChg" rows="2" data-in="svChg" data-t="svChg" placeholder="무엇: 옛 값 → 새 값(줄마다)">${esc(w.fields.changes.join('\n'))}</textarea></div><div class="field"><label for="svWhy">까닭</label><input class="inp" id="svWhy" data-in="svWhy" data-t="svWhy" maxlength="200" value="${esc(w.fields.why || '')}" autocomplete="off"></div>` : ''
  const warn = p && p.warnings.length ? `<div class="callout warn" data-t="svWarn"><div><b>경고 ${p.warnings.length}</b>${tipb('sv.warn', '경고')}${p.warnings.map((x) => `<div class="small">${esc(x.at)}: ${esc(x.why)}</div>`).join('')}</div></div>` : ''
  const errs = p && p.errors.length ? `<div class="callout danger" role="alert" data-t="svErrs"><div><b>오류 ${p.errors.length}</b> · 고쳐서 다시${p.errors.map((x) => `<div class="small">${esc(x.at)}: ${esc(x.why)}</div>`).join('')}</div></div>` : ''
  const raw = p && p.text ? `<button type="button" class="lk" data-a="svRaw" data-t="svRaw" aria-expanded="${!!w.raw}">저장 제안 글</button>${w.raw ? `<pre class="cfpre" data-t="svText">${esc(p.text)}</pre>` : ''}` : ''
  const body = !p && !w.ops?.length ? loadingHtml : `${items}${ops}${fresh}${fl}${warn}${errs}${raw}`
  const block = w.busy || (p && p.errors.length && !w.dirty)
  const lbl = w.busy ? (p || w.ops?.length ? '넣는 중…' : '읽는 중…') : w.dirty ? '다시 보기' : '넣기'
  return `<div class="scrim fix" data-a="svClose" data-self="1"${w.busy ? ' data-busy="1"' : ''}><div class="modal w560" role="dialog" aria-modal="true" data-t="saveWin"><div class="mh">저장 확인 <small>${esc(n ? n.name : w.k)}</small>${tipb('sv', '저장 확인')}<button type="button" class="x" data-a="svClose" title="닫기" aria-label="닫기">×</button></div><div class="mb" aria-busy="${!!w.busy}">${body}${w.note ? `<div class="callout warn" role="status" data-t="svNote"><span>${esc(w.note)}</span></div>` : ''}${w.err ? formErr(w.err, 'svErr') : ''}</div><div class="mf"><span class="acts"><button type="button" class="btn" data-a="svClose" data-t="svCancel"${w.busy ? ' disabled' : ''}>취소</button><button type="button" class="btn pri" data-a="svGo" data-t="svGo"${block ? ' disabled' : ''}>${lbl}</button></span></div></div></div>`
}

// ───────────── 오늘 바뀐 것(목업 M9) ─────────────
const pad2 = (n) => String(n).padStart(2, '0')
function tmOf(iso) {
  const d = new Date(iso)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return isToday(iso) ? hm : `${whenTxt(iso).split(' ')[0]}<br>${hm}`
}
function diffHtml(list, label) {
  if (!list) return loadingHtml
  if (list.error) return errHtml(list)
  if (!list.length) return '<div class="diff"><div class="ln2">바뀐 글이 없다</div></div>'
  return list.map((x) => `<div class="diff"><div class="fh">${esc(label || x.title + ' › ' + x.heading)}</div>${String(x.before || '').split('\n').filter((l) => l.trim()).map((l) => `<div class="ln2 del">${esc(l)}</div>`).join('')}${String(x.after || '').split('\n').filter((l) => l.trim()).map((l) => `<div class="ln2 add">${esc(l)}</div>`).join('')}</div>`).join('')
}
const diffOf = (k, record) => need(`diff:${k}:${record}`, `/api/k/${encodeURIComponent(k)}/diff?record=${encodeURIComponent(record)}`)
// 이력 — 팀 지식과 개인 지식의 이력을 한 흐름으로(서버가 같은 일은 한 줄로 합쳐 준다 · /api/history).
//   팀 화면은 팀 지식만 · 개인 화면은 개인 지식만
//   맨 위 「값 바뀜」 — 내 값이 바뀐 줄(들이기가 바꿨든 남의 저장이 바꿨든) · 아래는 날마다 묶은 흐름 · 갈래 · 지식 · 사람으로 거른다
//   저장 문이 넣은 기록 줄(items)은 펼치면 항목마다 「옛 값 → 새 값」 · 서버가 준 canRevert · live 인 항목만 [되돌리기](S5)
//   줄을 누르면 펼친다 — 비교 · 되돌리기 / 기기 끊기 / 문서 열기 / 그 일 열기
//   위에서 고른 지식과 따로다
const historyOf = () => need('history', '/api/history')
const HIST_CHECK = '값 바뀜'
// 갈래 — 옛 held 갈래는 P11 에서 걷었다(옛 기록은 「정리」 · 줄 수 0 이면 고르기에 없다)
const HIST_KINDS = [HIST_CHECK, '저장', '고침', '들이기', '다듬기', '되돌림', '버림', '가져오기', '짜임', '장부', '보내기', '받음', '설정', '지식']
const isCheck = (x) => x.yl && !x.reverted && !x.unlinked
const HIST_PAGE = 200
// 한 흐름 — 팀 화면은 팀 지식만 · 개인 화면은 개인 지식만
//   읽은 것이 그대로면 같은 배열(되돌림 · 끊음 표시가 남게)
let histMemo = null
function histRows() {
  const v = historyOf()
  if (!v || v.error) return v
  if (histMemo && histMemo.v === v) return histMemo.out
  const a = isTeam() ? 'team' : 'me'
  const out = v.map((x) => ({ ...x, a })).sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')))
  histMemo = { v, out }
  return out
}
const histFind = (id) => (Array.isArray(histRows()) ? histRows() : []).find((x) => x.id === id) || null
// 옆 메뉴 이력의 「값 바뀜」 수 — 읽어 둔 것만 센다(옆 메뉴가 이력을 받으러 가지 않는다)
function histChecks() {
  const n = (v) => (Array.isArray(v) ? v.filter(isCheck).length : 0)
  return n(S.cache.history)
}
function dayOf(at) {
  const d = new Date(at), t = new Date()
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)
  if (d.toDateString() === t.toDateString()) return '오늘'
  if (d.toDateString() === y.toDateString()) return '어제'
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '(' + '일월화수목금토'[d.getDay()] + ')'
}
const atTxt = (at) => { const d = new Date(at); return `${dayOf(at)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
// 보낸 기록의 짝 — 개인 「보내기」(받는 지식 이름) ↔ 팀 「받음」(보낸 지식 이름) · 5분 안
function histPair(x, all) {
  const near = (y) => Math.abs(Date.parse(y.at) - Date.parse(x.at)) < 5 * 60000
  if (x.kind === '보내기' && x.to) return all.find((y) => y.kind === '받음' && y.knName === x.to && (!y.from || y.from === x.knName) && near(y)) || null
  if (x.kind === '받음') return all.find((y) => y.kind === '보내기' && y.to === x.knName && (!x.from || x.from === y.knName) && near(y)) || null
  return null
}
const sentDone = (x, all) => { const r = histPair(x, all); return !!r && r.st === 'in' }
function traceHtml(x, all) {
  const p = histPair(x, all)
  const s = x.kind === '보내기' ? x : p, r = x.kind === '받음' ? x : p
  const li = (cls, at, b, sm) => `<li><span class="t">${at ? esc(atTxt(at)) : ''}</span><span class="dot ${cls}">${cls === 'ok' ? '✓' : cls === 'w' ? '…' : ''}</span><span><b>${esc(b)}</b>${sm ? `<small>${esc(sm)}</small>` : ''}</span></li>`
  const L = [s ? li('ok', s.at, `${s.knName || '개인 지식'} 에서 보냈다`, s.title) : li('n', '', `${r.from || '개인 지식'} 에서 보냈다`, '보낸 쪽 줄은 이력에 없다: 다른 사람이 보냈거나 오래됐다')]
  if (r) {
    L.push(li('ok', r.at, `${r.knName} · 받은 것에 섰다`, r.title))
    L.push(r.st === 'in' ? li('ok', '', '문서에 들어갔다', '받을 때 넣었다') : li('w', '', '기록', r.sub || ''))
  } else L.push(li('n', '', `${s.to || '팀 지식'} 의 받은 것`, '팀 쪽 줄을 찾지 못했다: 보낸 지 오래됐거나 아직 닿지 않았다'))
  return `<div class="small muted" style="margin:var(--sp-1) 0">보낸 기록이 지나간 길</div><ul class="trace" data-t="histTrace">${L.join('')}</ul>`
}
// 저장 문이 넣은 항목 한 줄 — 「문서 › 머리」 · 옛 값 → 새 값(또는 새 항목) · [되돌리기](서버가 준 canRevert 이고 지금도 그 기록이 표지인 항목만)
function histItem(x, it, i) {
  const chg = it.isNew ? '<span class="chip c-acc">새 항목</span>' : it.from || it.to ? `<span class="vchg" data-t="histChg">${esc(it.from || '—')} → ${esc(it.to || '—')}</span>` : ''
  // 되돌림 기록의 항목은 표지를 앞 기록에 돌려 두므로 live 가 늘 아니다 — 「그 뒤 다시 바뀜」 을 달지 않는다
  const st = it.reverted ? '<span class="chip c-mute" data-t="itemReverted">되돌림</span>' : x.kind === '되돌림' ? '' : !it.live ?'<span class="small muted">그 뒤 다시 바뀜</span>' : x.canRevert ? `<button type="button" class="btn sm" data-a="revertItem" data-id="${esc(x.id)}" data-i="${i}" data-t="revertItem">되돌리기</button>` : ''
  return `<li class="${it.reverted ? 'done' : ''}" data-t="histItem"><span class="nm">${esc(it.name)} › <b>${esc(it.heading)}</b></span>${chg}${st}</li>`
}
function histRow(x, all) {
  const open = S.openToday === x.id
  const team = isTeam()
  let ex = ''
  if (open) {
    ex += '<div class="open" data-t="todayOpen">'
    if (x.sub) ex += `<div class="small muted" style="margin-bottom:var(--sp-3)">${esc(x.sub)}</div>`
    if (team && (x.kind === '보내기' && x.to || x.kind === '받음')) ex += traceHtml(x, all)
    if (x.items && x.items.length) ex += `<div class="small muted">넣은 항목</div><ul class="hitems" data-t="histItems">${x.items.map((it, i) => histItem(x, it, i)).join('')}</ul>`
    if (x.revert) ex += `<div class="small muted">비교</div>${diffHtml(diffOf(x.kn, x.revert))}`
    if (x.revert && !x.reverted) ex += `<button class="btn sm" data-a="revertToday" data-id="${esc(x.id)}" data-t="revertBtn">되돌리기</button> <span class="small muted">그 줄만 넣기 전으로</span>`
    if (x.revert && x.reverted) ex += '<span class="chip c-mute">되돌렸다</span>'
    if (x.device) ex += x.unlinked ? '<span class="chip c-mute">끊었다</span>' : `<button class="btn sm" data-a="unlinkDev" data-id="${esc(x.id)}">끊기</button> <span class="small muted">내가 한 것이 아니면: 그 기기의 Claude Code 는 다시 이어야 한다</span>`
    const links = []
    if (x.go) links.push(`<button type="button" class="lk" data-a="todayGo" data-id="${esc(x.id)}">문서 열기 ›</button>`)
    if (x.rec && x.kn && KN(x.kn)) links.push(`<button type="button" class="lk" data-a="openRec" data-k="${esc(x.kn)}" data-r="${esc(x.rec)}" data-t="histRec">그 일 열기 ›</button>`)
    if (links.length) ex += `<div class="u-flex u-g6" style="margin-top:var(--sp-3)">${links.join('')}</div>`
    ex += '</div>'
  }
  const kind = isCheck(x) ? HIST_CHECK : x.kind
  const sent = team && x.kind === '보내기' && x.to && !open ? (sentDone(x, all) ? ' ' + chipOf('ok', '문서에 들어감', ' data-t="sentState"') : histPair(x, all) ? ' <span class="chip c-mute" data-t="sentState">기록</span>' : '') : ''
  return `<div class="hrow${team ? ' ' + x.a : ''}${isCheck(x) ? ' yl' : ''}${x.reverted ? ' done' : ''}" data-t="histRow" data-kind="${esc(x.kind)}" data-area="${x.a}" data-id="${esc(x.id)}"><div class="hl" data-a="toggleToday" data-id="${esc(x.id)}"><span class="tm">${tmOf(x.at)}</span><span class="chip ${isCheck(x) ? 'c-warn' : 'c-mute'} u-fnone">${esc(kind)}</span><span class="tx"><b>${esc(x.title)}</b>${sent}${x.reverted ? ' <span class="chip c-mute" data-t="reverted">되돌렸다</span>' : ''}${x.asIs ? ' <small class="muted" data-t="histAsIs">글 그대로</small>' : ''}${x.sub && !open ? `<small>${esc(x.sub)}</small>` : ''}</span><span class="kn2">${esc(x.knName || '')}</span><span class="who">${esc(x.who || '')}</span><span class="act" data-t="viewBtn">${open ? '접기' : '보기'}</span></div>${ex}</div>`
}
// 이력 새 줄 수(UX T4-03 · 정함 ① ) — 마지막으로 이력을 본 때(이 브라우저) 뒤에 생긴 줄
const histSeenAt = () => { try { return Number(localStorage.getItem('kmd.histSeen')) || 0 } catch { return 0 } }
function histNew() { const h = S.cache.history; const xs = h && !h.error ? (Array.isArray(h) ? h : h.items || h.rows || []) : []; const t0 = histSeenAt(); return t0 ? xs.filter((x) => Date.parse(x.at || x.time || x.date || 0) > t0 && x.by !== (S.me && S.me.user)).length : 0 }
function viewToday() {
  try { localStorage.setItem('kmd.histSeen', String(Date.now())) } catch {}
  const team = isTeam()
  const crumb = '이력'
  const all = histRows()
  // 거르기 — 갈래 하나(고르기) · 지식(처음은 고른 지식 · 「모든 지식」) · 사람 · 메뉴 개편 N5 · 11절 7
  const f = S.logKind || '', pp = S.logWho || '', cur = defaultKn()
  const kn = S.logKn === '*' ? '' : S.logKn || cur || ''
  const mine = (x) => x.who === S.me.user
  // 「보내기」 갈래는 하나 — 개인의 보내기와 팀의 받음(메뉴 개편 4-2)
  const kindOf = (x) => (x.kind === '받음' ? '보내기' : x.kind)
  const pass = (x, skip) => (skip === 'kn' || !kn || x.kn === kn) && (skip === 'pp' || !pp || (pp === 'me' ? mine(x) : x.who === 'kmd'))
    && (skip === 'kind' || !f || (f === HIST_CHECK ? isCheck(x) : kindOf(x) === f && !isCheck(x)))
  const knOpts = () => {
    const ks = [...new Map((Array.isArray(all) ? all : []).filter((x) => x.kn && x.kn !== cur).map((x) => [x.kn, x.knName || knNm(x.kn)])).entries()]
    const v = S.logKn || ''
    return `<option value=""${!v ? ' selected' : ''}>${esc(cur && KN(cur) ? KN(cur).name : '이 지식')}</option><option value="*"${v === '*' ? ' selected' : ''}>모든 지식</option>${ks.map(([id, n]) => `<option value="${esc(id)}"${v === id ? ' selected' : ''}>${esc(n)}</option>`).join('')}`
  }
  const knSel = `<select class="inp" id="logKn" aria-label="지식" data-t="logKn" style="width:auto">${knOpts()}</select>`
  const head = `<div class="pg-h"><div class="pt"><div class="big">이력</div>${tipb('hist', '이력')}</div><span class="acts">${knSel}</span></div>`
  if (!all) return { crumb, main: `<div class="pg-list">${head}${loadingHtml}</div>` }
  if (all.error) return { crumb, main: `<div class="pg-list">${head}${errHtml(all)}</div>` }
  const rows = all.filter((x) => pass(x))
  const cnt = (g) => all.filter(g).length
  const kindN = (k) => cnt((x) => pass(x, 'kind') && (k === HIST_CHECK ? isCheck(x) : kindOf(x) === k && !isCheck(x)))
  const kinds = HIST_KINDS.filter((k) => k !== '받음' && (k === HIST_CHECK || kindN(k)))
  const kindSel = `<select class="inp" id="logKind" aria-label="갈래" data-t="logKind" style="width:auto"><option value="">모든 갈래 ${cnt((x) => pass(x, 'kind'))}</option>${kinds.map((k) => `<option value="${esc(k)}"${f === k ? ' selected' : ''}>${esc(k)} ${kindN(k)}</option>`).join('')}</select>`
  const whoSel = `<select class="inp" id="logWho" aria-label="사람" data-t="logWho" style="width:auto">${[['', '사람 모두'], ['me', `나(${S.me.user})`], ['kmd', 'kmd 가 한 일']].map(([v, l]) => `<option value="${v}"${pp === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
  // 맨 위 「값 바뀜 n」 — 옆 메뉴 배지와 같은 수(모든 지식 · 지식 거르기와 상관없이)
  const checks = f && f !== HIST_CHECK ? [] : all.filter((x) => isCheck(x) && pass(x, 'kn'))
  const flowAll = f !== HIST_CHECK ? rows.filter((x) => !isCheck(x)) : []
  const flow = flowAll.slice(0, S.histMax || HIST_PAGE), flowLeft = flowAll.length - flow.length
  const days = []
  for (const x of flow) { const d = dayOf(x.at); const g = days[days.length - 1]; if (g && g.d === d) g.rows.push(x); else days.push({ d, rows: [x] }) }
  const row = (x) => histRow(x, all)
  const checkCard = checks.length ? `<div class="card" data-t="histCheck"><div class="ch">값 바뀜 <span class="chip c-warn">${checks.length}</span></div><div class="cb u-p0">${checks.map(row).join('')}</div></div>` : ''
  const flowCard = f === HIST_CHECK ? '' : `<div class="card" data-t="feed"><div class="cb u-p0">${days.map((g) => `<div class="hday" data-t="histDay">${esc(g.d)}<small>${g.rows.length}</small></div>${g.rows.map(row).join('')}`).join('') || '<div class="empty2" data-t="logEmpty"><b>이력 없음</b></div>'}${flowLeft > 0 ? `<div class="hmore"><button type="button" class="btn sm" data-a="histMore" data-t="histMore">더 보기(남은 ${flowLeft})</button></div>` : ''}</div></div>`
  const main = `<div class="pg-list">${head}
  <div class="hfl" data-t="logKinds">${kindSel}<span class="r">${whoSel}</span></div>
  ${checkCard}${flowCard}</div>`
  return { crumb, main }
}

// ───────────── 점검(메뉴 개편 N5 · 6-2 · 저장 승인 P10 · P11 · P-D28) — 본문 머리 탭 점검 · 지표 ─────────────
//   점검 · 지표: 그 지식의 지식관리자(개인은 주인) · 배지 없음(할 일 목록이 아니다) · 옛 탭 둘은 걷었다(P11)
// 점검 화면의 지식 — 고른 지식(점검을 여는 자리일 때)
function ckKn() {
  const k = defaultKn()
  return ckOk(KN(k)) ? k : null
}
// 점검 수 — 알림 줄(같은 이름 · 빈칸 값)은 세지 않는다
const GUARD_SOFT = ['sameLabel', 'spaced']
const guardN = (g) => (!g || g.error ? null : GUARD_ROWS.filter(([key]) => !GUARD_SOFT.includes(key)).reduce((n, [key]) => n + (g.counts[key] || 0), 0))
const CK_NAME = { check: '점검', metrics: '지표' }
function ckTabsHtml(k) {
  const g = guardOf(k)
  const tabs = [['check', CK_NAME.check, guardN(g) ?? '…'], ['metrics', CK_NAME.metrics, null]]
  const tab = tabs.some((t) => t[0] === S.ckTab) ? S.ckTab : tabs[0][0]
  return { tab, html: `<div class="tabs" data-t="ckTabs" aria-label="점검">${tabs.map(([v, l, c]) => `<span class="${tab === v ? 'on' : ''}${c === 0 ? ' z' : ''}" data-a="ckTab" data-v="${v}" data-t="ckTab-${v}">${l}${c == null ? '' : ` <em>${c}</em>`}</span>`).join('')}</div>` }
}
function viewHeld() {
  const k = ckKn()
  const title = (tip) => `<div class="pt"><div class="big">점검</div>${tipb(tip, '점검')}</div>`
  if (!k || !admKn(k)) return { crumb: '점검', main: `<div class="hdy"><div class="pg-h">${title('chk')}</div><div class="empty2" data-t="ckNone"><b>${KN(defaultKn()) ? '이 지식의 점검은 지식관리자가 본다' : '지식을 고른다'}</b></div></div>` }
  const { tab, html: tabs } = ckTabsHtml(k)
  const crumb = '점검 › ' + CK_NAME[tab]
  if (tab === 'metrics') return { crumb, main: `<div class="hdy"><div class="pg-h">${title('mt')}</div>${tabs}${metricsHtml(k)}</div>` }
  return { crumb, main: `<div class="hdy"><div class="pg-h">${title('chk')}</div>${tabs}${guardBodyHtml(k)}</div>` }
}
// 지표(저장 승인 P10 · P-D27 · P-D37) — 지식 · 기간(기본 14일 · Q15) · 줄 여섯 · 줄의 [보기] 는 그 기록들(누르면 기록) · 할 일이 아니다(배지 · 봤음 없음)
//   GET /api/k/:id/metrics?days= — 그 지식의 지식관리자(개인 주인) · 이 서버(이 PC)의 저장 측정 줄 + 기록 끝 「새로 세움」
const MT_DAYS = [7, 14, 30, 90]
// 줄: [열쇠, 이름, 줄 이름 툴팁, 문턱(넘으면 경고 칩 · P-D37 · Q2)]
const MT_ROWS = [
  ['fresh', '새로 생긴 것', '이 기간에 저장이 새로 세운 문서 · 항목(문서 · 장부) · 갈래 · 종류', null],
  ['accepted', '받아들인 경고', '사람이 저장 제안의 경고를 보고 승인해 넣은 저장 / 사람 채널 저장', null],
  ['warned', '무인 값 경고', '들이기 · 가져올 곳 · 정정 같은 무인 저장에서 값 대조가 걸린 저장 / 무인 저장', 0.2],
  ['rule', '규칙 길', 'Claude 글 대신 규칙 길로 들어간 무인 저장 / 무인 저장', 0.1],
  ['fix', 'FIX 번 수', '무인 저장이 결정적 오류를 고치려 다시 지은 번 수', null],
  ['rounds', '다시 제안 수', '사람 채널에서 저장 제안을 다시 받은 번 수', null],
]
const MT_CODE = { 이름: '항목(장부)', 항목: '항목(문서)', missing: '빠진 값', invented: '지어낸 값', gone: '사라진 값', lost: '사라진 값', split: '나뉜 글', near: '비슷한 이름', reverts: '되돌림 잦음', remain: '남은 값', unreflected: '본문 반영 안 됨' }
// 규칙 길 까닭 묶음 이름 — 「일꾼 실패: …」 · 「오늘 들이기 수(30)를 넘었다: …」 처럼 첫 「:」 앞 · 괄호 수를 걷고 · 짧게(지표 줄이 길게 붙지 않게 · 12 화면 말)
const mtWhy = (c) => { const s = String(c).split(/[:：]/)[0].replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); return s.length > 16 ? s.slice(0, 15) + '…' : s || '까닭 모름' }
const mtDays = () => (MT_DAYS.includes(S.mtDays) ? S.mtDays : 14)
const mtKey = (k) => `metrics:${k}:${mtDays()}`
const mtOf = (k) => need(mtKey(k), `/api/k/${encodeURIComponent(k)}/metrics?days=${mtDays()}`)
function metricsHtml(k) {
  const mine = (S.kns || []).filter((x) => (!x.hidden || x.id === k) && ckOk(x) && admKn(x.id))
  const knSel = mine.length > 1 ? `<select class="inp" id="mtKn" data-t="mtKn" aria-label="지식" style="width:auto">${mine.map((x) => `<option value="${esc(x.id)}"${x.id === k ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''
  const tools = `<div class="tools" data-t="mtTools">${knSel}<select class="inp" id="mtDays" data-t="mtDays" aria-label="기간" style="width:auto">${MT_DAYS.map((d) => `<option value="${d}"${d === mtDays() ? ' selected' : ''}>최근 ${d}일</option>`).join('')}</select><button type="button" class="btn ghost sm" data-a="mtRe" data-t="mtRe">다시 읽기</button></div>`
  const m = mtOf(k)
  if (!m) return tools + loadingHtml
  if (m.error) return tools + errHtml(m, mtKey(k))
  const fresh = m.rows.find((r) => r.key === 'fresh')
  if (!m.saves && !(fresh && fresh.n)) return tools + '<div class="empty2" data-t="mtEmpty"><b>이 기간에 들어간 저장이 없다</b></div>'
  const open = S.mtOpen || ''
  const codes = (r) => {
    const g = {}
    for (const [c, n] of Object.entries(r.codes || {})) { const nm = MT_CODE[c] || mtWhy(c); g[nm] = (g[nm] || 0) + n }
    return Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join(' · ')
  }
  const li = (x) => `<li><button type="button" class="lk" data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.rec)}" data-t="mtRec">${esc(x.title || x.rec)}</button> <small class="muted">${esc(whenTxt(x.at))}${x.codes ? ' · ' + esc(x.codes.map((c) => MT_CODE[c] || c).join(' · ')) : x.names ? ' · ' + esc(x.names.join(' · ')) : x.n > 1 ? ' · ' + x.n : ''}</small></li>`
  const rows = MT_ROWS.map(([key, label, why, limit]) => {
    const r = m.rows.find((x) => x.key === key) || { n: 0, base: null, recs: [], codes: {} }
    const ratio = r.base ? r.n / r.base : null
    const over = limit != null && ratio != null && ratio > limit
    const val = r.base != null && ['accepted', 'warned', 'rule'].includes(key) ? `${r.n} / ${r.base}` : String(r.n)
    const cs = r.n ? codes(r) : ''
    return `<div class="srow${r.n ? '' : ' dim'}" data-t="mt-${key}"><span class="nm" title="${esc(why)}">${label}${cs ? ` <small class="muted">${esc(cs)}</small>` : ''}</span><span class="chip ${over ? 'c-warn' : r.n ? 'c-mute' : 'c-ok'}" data-t="mtVal">${esc(val)}</span>${r.recs.length ? `<button type="button" class="btn ghost sm" data-a="mtOpen" data-v="${key}" aria-expanded="${open === key}" data-t="mtOpen">${open === key ? '접기' : '보기'}</button>` : ''}</div>${open === key && r.recs.length ? `<ul class="plain dl" data-t="mtList">${r.recs.map(li).join('')}</ul>` : ''}`
  }).join('')
  return tools + `<div class="ck-sum small muted" data-t="mtSum">${esc(m.since)} 부터 · 저장 ${m.saves} · 사람 ${m.human} · 무인 ${m.unattended}</div><div class="card" data-t="mtCard"><div class="cb u-p1-7-3">${rows}</div></div>`
}

// ───────────── 구조(옆 메뉴 구조 · N4 부터 문서 › 구조 · 옛 문서 짜임 · 지식관리자 · 작성기준 6-1절 · 권한 모델 7-1절) ─────────────
//   나무 하나로 — 끌어 옮기기(폴더 안 · 줄 사이) · 줄 안에서 이름 바꾸기(두 번 누름 · F2) · 새 문서 · 새 폴더 · Alt ↑↓ 차례.
//   고친 짜임은 이 화면에만(S.sx) · [저장] 이 마른 실행으로 요약을 보이고 확인 뒤 한 번에 넣는다(커밋 하나 · 지문이 어긋나면 다시 읽기)
//   이름 = 제목 = 파일 이름 — 이름을 바꾸면 파일 이름도 · 제목과 다른 옛 문서는 「제목으로 맞추기」
//   고른 지식(S.route.kn) 하나만 — 주소 · 뒤로 · 앞으로도 그 지식 · 메뉴에서 뺀(hidden) 지식이어도 그 지식(다른 지식으로 바꿔 열지 않는다)
const sxOk = (x) => !!x && lvOf(x) === 'admin' && (isTeam() ? !isPersonal(x) : isPersonal(x))
function sxKn() {
  const k = S.route.kn
  return k && k !== '*' && sxOk(KN(k)) ? k : null
}
const sxOf = (k) => need('sx:' + k, `/api/k/${encodeURIComponent(k)}/structure`)
const sxSplit = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? ['', p] : [p.slice(0, i), p.slice(i + 1)] }
const sxBy = (a, b) => a.localeCompare(b, 'ko', { numeric: true })
const sxBad = (n) => !n ? '이름을 쓴다' : n !== n.trim() ? '앞뒤 빈칸은 쓰지 않는다' : /[\\/:*?"<>|#%]/.test(n) ? '쓸 수 없는 글자' : /^[._]/.test(n) ? '. _ 로 시작하지 않는다' : /^assets$/i.test(n) ? '쓸 수 없는 이름' : [...n].length > 40 ? '40자 안으로' : ''
const sxFileish = (n) => /(20\d\d)[-._ ]?(0[1-9]|1[0-2])[-._ ]?(0[1-9]|[12]\d|3[01])|(^|[\s_-])[vV]\d+(\.\d+)*($|[\s_-])|최종|사본|final|copy|\(\d+\)|\.(md|docx?|hwpx?|pdf|xlsx?|pptx?|txt)$/i.test(n)
// 받은 짜임 → 고치는 판(처음 · 저장 뒤 · 다시 읽기)
function sxInit(k, d) {
  const docs = d.docs.map((x) => { const [f, file] = sxSplit(x.id); return { id: x.id, folder: f, file, title: x.title, name: x.title, watched: !!x.watched } })
  const x = { k, fp: d.fp, O: docs.map((o) => ({ ...o })), W: docs.map((o) => ({ ...o })), ODIRS: new Set(d.dirs || []), WDIRS: new Set(d.dirs || []), ORDER: {}, OORDER: {}, open: (S.sx && S.sx.k === k && S.sx.open) || {}, sel: null, multi: new Set(), pick: false, edit: null, q: '', barOpen: false, seq: 0, busy: false }
  S.sx = x
  for (const o of docs) { let f = o.folder; while (f) { x.ODIRS.add(f); x.WDIRS.add(f); f = sxSplit(f)[0] } }
  // 장부 차례(이름) → 열쇠(f:폴더 · d:id)
  for (const f of ['', ...sxDirs()]) {
    const names = (d.order || {})[f] || []
    x.ORDER[f] = names.map((nm) => (nm.endsWith('/') ? 'f:' + (f ? f + '/' : '') + nm.slice(0, -1) : (() => { const o = docs.find((z) => z.folder === f && z.file === nm); return o ? 'd:' + o.id : null })())).filter(Boolean)
  }
  x.OORDER = JSON.parse(JSON.stringify(Object.fromEntries(['', ...sxDirs()].map((f) => [f, sxSibs(f)]))))
  return x
}
const sxW = (id) => S.sx.W.find((d) => d.id === id)
const sxO = (id) => S.sx.O.find((d) => d.id === id)
function sxDirs() { const x = S.sx, s = new Set(x.WDIRS); for (const d of x.W) { let f = d.folder; while (f) { s.add(f); f = sxSplit(f)[0] } } return [...s].sort(sxBy) }
const sxKids = (p) => sxDirs().filter((f) => sxSplit(f)[0] === p)
const sxDocsIn = (p) => S.sx.W.filter((d) => d.folder === p)
const sxDeep = (p) => S.sx.W.filter((d) => d.folder === p || d.folder.startsWith(p + '/')).length
const sxLocked = (p) => S.sx.W.some((d) => (d.folder === p || d.folder.startsWith(p + '/')) && d.watched)
// 끝 파일 이름 — 이름을 바꿨거나 맞추기를 골랐으면 이름 · 아니면 옛 파일 이름 그대로
const sxFile = (d) => (!sxO(d.id) || d.sync || d.name !== d.title ? d.name : d.file)
const sxClash = (folder, name, self) => S.sx.W.some((d) => d.id !== self && d.folder === folder && sxFile(d).toLowerCase() === name.toLowerCase())
function sxSibs(p) {
  const ks = [...sxKids(p).map((f) => 'f:' + f), ...sxDocsIn(p).sort((a, b) => sxBy(a.name, b.name)).map((d) => 'd:' + d.id)]
  const o = S.sx.ORDER[p] || []
  return ks.map((k, i) => [k, o.indexOf(k), i]).sort((a, b) => (a[1] < 0 ? 1e6 + a[2] : a[1]) - (b[1] < 0 ? 1e6 + b[2] : b[1])).map((z) => z[0])
}
function sxPlace(key, P, ref, after) { const arr = sxSibs(P).filter((k) => k !== key); let i = arr.indexOf(ref); i = i < 0 ? arr.length : i + (after ? 1 : 0); arr.splice(i, 0, key); S.sx.ORDER[P] = arr }
const sxOrderMoved = (p) => { const o = S.sx.OORDER[p] || [], a = sxSibs(p).filter((k) => o.includes(k)), b = o.filter((k) => a.includes(k)); return a.join('|') !== b.join('|') }
const sxChanged = (d) => { const o = sxO(d.id); return !o || o.folder !== d.folder || o.name !== d.name || !!d.sync }
function sxDiff() {
  const x = S.sx, out = []
  for (const d of x.W) {
    const o = sxO(d.id)
    if (!o) { out.push({ k: '새 문서', nw: true, d }); continue }
    if (o.folder !== d.folder || o.name !== d.name || d.sync) out.push({ k: o.folder !== d.folder ? '옮김' : '이름', d, o })
  }
  for (const f of sxDirs()) if (!x.ODIRS.has(f) && !sxDeep(f) && !sxKids(f).length) out.push({ k: '새 폴더', nw: true, f })
  for (const p of ['', ...sxDirs()]) if (sxOrderMoved(p)) out.push({ k: '차례', p })
  return out
}
// 서버에 보낼 것 — moves(옛 id → 끝 id) · creates · dirs · order(폴더마다 이름 · 폴더는 끝에 /)
function sxOps() {
  const x = S.sx, idOf = (d) => (d.folder ? d.folder + '/' : '') + sxFile(d)
  const moves = x.W.filter((d) => sxO(d.id) && idOf(d) !== d.id).map((d) => ({ from: d.id, to: idOf(d) }))
  const creates = x.W.filter((d) => !sxO(d.id)).map(idOf)
  // 제목이 바뀐 문서 — 파일 이름이 그대로여도 `# 제목` 을 이름으로(제목을 파일 이름에 맞출 때 · 경로가 안 바뀌어 moves 에 없다)
  const titles = x.W.filter((d) => sxO(d.id) && d.name !== d.title).map((d) => d.id)
  const order = {}
  for (const p of ['', ...sxDirs()]) order[p] = sxSibs(p).map((k) => (k.startsWith('f:') ? sxSplit(k.slice(2))[1] + '/' : sxFile(sxW(k.slice(2)))))
  return { moves, creates, titles, dirs: sxDirs().filter((f) => !sxDeep(f)), order }
}
function sxMoveDoc(id, to, { open = false } = {}) {
  const d = sxW(id)
  if (!d || d.watched) { toast('<b>원본이 주인인 문서는 옮기지 않는다</b>', 0, true); return false }
  if (d.folder === to) return true
  if (sxClash(to, sxFile(d), id)) { toast(`<b>「${esc(to || '맨 위')}」 에 같은 이름이 있다</b>`, 0, true); return false }
  d.folder = to; if (to && open) S.sx.open[to] = true; S.sx.sel = 'd:' + id; return true // 끌어 옮기면 그 폴더를 펴지 않는다 — 다음 끌 자리가 밀리지 않게(UX G4-08)
}
function sxMoveDir(from, toParent, newName) {
  const x = S.sx, nm = newName ?? sxSplit(from)[1], to = toParent ? toParent + '/' + nm : nm
  if (to === from) return true
  if (toParent === from || toParent.startsWith(from + '/')) { toast('<b>폴더를 자기 안으로 옮길 수 없다</b>', 0, true); return false }
  if (sxDirs().some((f) => f.toLowerCase() === to.toLowerCase())) { toast(`<b>「${esc(to)}」 가 이미 있다</b>`, 0, true); return false }
  if (sxLocked(from)) { toast('<b>원본이 주인인 문서가 든 폴더는 옮기지 않는다</b>', 0, true); return false }
  const re = (p) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  for (const d of x.W) d.folder = re(d.folder)
  x.WDIRS = new Set([...x.WDIRS].map(re))
  const no = {}; for (const k in x.ORDER) no[re(k)] = x.ORDER[k].map((z) => (z.startsWith('f:') ? 'f:' + re(z.slice(2)) : z)); x.ORDER = no
  const op = {}; for (const k in x.open) op[re(k)] = x.open[k]; x.open = op
  if (toParent) x.open[toParent] = true
  x.sel = 'f:' + to; return true
}
// 옮기기(끌기 대신 · 키보드 · 터치 · 여럿 한꺼번에) — 고른 폴더 안의 것은 폴더와 함께 간다
async function sxMoveKeys(keys) {
  if (sxHold()) return
  const x = S.sx
  const dirs = keys.filter((k) => k.startsWith('f:')).map((k) => k.slice(2))
  const inSel = (f) => dirs.some((p) => f === p || f.startsWith(p + '/'))
  const go = keys.filter((k) => (k.startsWith('f:') ? !dirs.some((p) => k.slice(2) !== p && k.slice(2).startsWith(p + '/')) : !inSel(sxW(k.slice(2))?.folder || '')))
  if (!go.length) return
  const opts = [['', '맨 위'], ...sxDirs().filter((f) => !inSel(f)).map((f) => [f, f])]
  const first = go[0], cur = first.startsWith('f:') ? sxSplit(first.slice(2))[0] : (sxW(first.slice(2)) || {}).folder || ''
  const one = go.length === 1 ? (first.startsWith('f:') ? sxSplit(first.slice(2))[1] : (sxW(first.slice(2)) || {}).name) : ''
  const to = await ask({ t: one ? `「${one}」 옮기기` : `고른 ${go.length}개 옮기기`, d: '옮길 폴더를 고른다. 저장하기 전까지는 이 화면에만 바뀐다', select: { label: '옮길 곳', options: opts, value: cur }, ok: '옮기기' })
  if (to == null) return
  let ok = 0, no = 0
  const here = (k) => (k.startsWith('f:') ? sxSplit(k.slice(2))[0] : (sxW(k.slice(2)) || {}).folder) === to
  for (const k of go) { if (here(k)) continue; const r = k.startsWith('f:') ? sxMoveDir(k.slice(2), to) : sxMoveDoc(k.slice(2), to); if (r) ok++; else no++ }
  if (to) x.open[to] = true
  x.multi = new Set()
  render()
  if (!ok && !no) toast('<b>이미 그 자리에 있다</b>')
  else if (go.length > 1) toast(`<b>${ok}개를 「${esc(to || '맨 위')}」 안으로 옮겼다</b>${no ? ` · ${no}개는 못 옮겼다(같은 이름 · 원본이 주인)` : ''}`, 0, !!no)
}
const sxSelFolder = () => { const s = S.sx.sel; if (!s) return ''; if (s.startsWith('f:')) return s.slice(2); const d = sxW(s.slice(2)); return d ? d.folder : '' }
// 줄 안 이름 칸 — 검사 · 넣기
function sxEditCheck() {
  const e = S.sx.edit, inp = $('#sxIn'); if (!e || !inp) return null
  const v = inp.value.trim()
  let w = sxBad(v)
  if (!w && (e.t === 'doc' || e.t === 'newdoc') && sxFileish(v) && !(e.t === 'doc' && sxW(e.id).name === v)) w = '날짜 · 판 · 최종 같은 조각은 이름에 쓰지 않는다'
  if (!w && e.t === 'doc') { const d = sxW(e.id); if (sxClash(d.folder, v, d.id)) w = '같은 이름이 있다' }
  if (!w && e.t === 'newdoc' && sxClash(e.parent, v)) w = '같은 이름이 있다'
  if (!w && (e.t === 'dir' || e.t === 'newdir')) { const par = e.t === 'dir' ? sxSplit(e.id)[0] : e.parent, p = par ? par + '/' + v : v; if (p !== e.id && sxDirs().some((f) => f.toLowerCase() === p.toLowerCase())) w = '같은 이름이 있다' }
  const why = $('#sxWhy'); if (why) why.textContent = w
  inp.setAttribute('aria-invalid', w ? 'true' : 'false')
  return w ? null : v
}
function sxEditCommit() {
  const x = S.sx, e = x && x.edit; if (!e) return
  const v = sxEditCheck(); if (v == null) return
  x.edit = null
  if (e.t === 'doc') { sxW(e.id).name = v; x.sel = 'd:' + e.id }
  if (e.t === 'newdoc') { const id = 'new:' + (++x.seq); x.W.push({ id, folder: e.parent, file: v, title: v, name: v, watched: false }); x.sel = 'd:' + id }
  if (e.t === 'newdir') { const p = e.parent ? e.parent + '/' + v : v; x.WDIRS.add(p); x.open[p] = true; x.sel = 'f:' + p }
  if (e.t === 'dir') sxMoveDir(e.id, sxSplit(e.id)[0], v)
  render()
}
function sxRow(key, dep) {
  const x = S.sx, e = x.edit
  if (key.startsWith('f:')) {
    const f = key.slice(2), [, nm] = sxSplit(f), open = !!x.open[f] || !!x.q.trim(), n = sxDeep(f), lock = sxLocked(f)
    if (e && e.t === 'dir' && e.id === f) return sxEditRow(nm, dep, true)
    const mark = !x.ODIRS.has(f) ? (x.W.some((d) => sxO(d.id) && (d.folder === f || d.folder.startsWith(f + '/'))) ? '<i class="sx-dot ch" title="바뀜"></i>' : '<i class="sx-dot new" title="새 폴더"></i>') : ''
    return `<div class="sx-row dir${x.sel === key ? ' on' : ''}${x.multi.has(key) ? ' pk' : ''}" role="treeitem" aria-selected="${x.multi.has(key)}" aria-level="${dep + 1}" aria-expanded="${open}" tabindex="0" draggable="${!lock}" data-a="sxClick" data-sk="${esc(key)}" data-t="sxDir" data-p="${esc(f)}" style="--dep:${dep}"><span class="ar" aria-hidden="true">${open ? '▾' : '▸'}</span>${svg('folder')}<span class="nm">${esc(nm)}</span>${mark}${lock ? '' : `<button type="button" class="sx-ib" data-a="sxMv" data-sk="${esc(key)}" aria-label="${esc(nm)} 옮기기" title="옮기기(M)" tabindex="-1">${svg('arrow')}</button><button type="button" class="sx-ib" data-a="sxRen" data-sk="${esc(key)}" aria-label="${esc(nm)} 이름 바꾸기" tabindex="-1">${svg('pen')}</button>`}${!n && !sxKids(f).length ? `<button type="button" class="sx-ib del" data-a="sxRm" data-sk="${esc(key)}" aria-label="빈 폴더 지우기" tabindex="-1">${svg('bin')}</button>` : ''}<span class="rc">${n}</span></div>`
  }
  const d = sxW(key.slice(2)); if (!d) return ''
  if (e && e.t === 'doc' && e.id === d.id) return sxEditRow(d.name, dep, false)
  const o = sxO(d.id)
  const mk = !o ? '<i class="sx-dot new" title="새 문서"></i>' : sxChanged(d) ? '<i class="sx-dot ch" title="바뀜"></i>' : d.watched ? `<span class="sx-lock" title="원본이 주인">${svg('lock')}</span>` : o.file !== o.title ? '<i class="sx-dot df" title="파일 이름이 제목과 다르다"></i>' : ''
  const twin = sxDocsIn(d.folder).filter((z) => z.name === d.name).length > 1 ? ` <small class="muted mono">${esc(sxFile(d))}</small>` : ''
  return `<div class="sx-row${x.sel === key ? ' on' : ''}${x.multi.has(key) ? ' pk' : ''}" role="treeitem" aria-selected="${x.multi.has(key)}" aria-level="${dep + 1}" tabindex="0" draggable="${!d.watched}" data-a="sxClick" data-sk="${esc(key)}" data-t="sxDoc" data-d="${esc(d.id)}" style="--dep:${dep}">${svg('doc')}<span class="nm">${esc(d.name)}${twin}</span>${d.watched ? '' : `<button type="button" class="sx-ib" data-a="sxMv" data-sk="${esc(key)}" aria-label="${esc(d.name)} 옮기기" title="옮기기(M)" tabindex="-1">${svg('arrow')}</button><button type="button" class="sx-ib" data-a="sxRen" data-sk="${esc(key)}" aria-label="${esc(d.name)} 이름 바꾸기" tabindex="-1">${svg('pen')}</button>`}${!o ? `<button type="button" class="sx-ib del" data-a="sxRm" data-sk="${esc(key)}" aria-label="만들지 않기" tabindex="-1">${svg('bin')}</button>` : ''}${mk}</div>`
}
const sxEditRow = (v, dep, dir) => `<div class="sx-row${dir ? ' dir' : ''} edit" style="--dep:${dep}">${dir ? '<span class="ar"></span>' + svg('folder') : svg('doc')}<input class="inp sx-in" id="sxIn" data-in="sxIn" data-t="sxIn" value="${esc(v)}" aria-label="${dir ? '폴더' : '문서'} 이름" autocomplete="off" aria-describedby="sxWhy"><span class="sx-why" id="sxWhy" role="status"></span></div>`
function sxTreeHtml() {
  const x = S.sx, q = x.q.trim(), e = x.edit
  const hit = (d) => !q || d.name.includes(q) || d.folder.includes(q)
  const walk = (p, dep) => {
    let h = ''
    if (e && e.t === 'newdir' && e.parent === p) h += sxEditRow('', dep, true)
    for (const k of sxSibs(p)) {
      if (k.startsWith('f:')) {
        const f = k.slice(2)
        if (q && !x.W.some((d) => (d.folder === f || d.folder.startsWith(f + '/')) && hit(d))) continue
        h += sxRow(k, dep)
        if (x.open[f] || q) h += walk(f, dep + 1)
      } else { const d = sxW(k.slice(2)); if (d && hit(d)) h += sxRow(k, dep) }
    }
    if (e && e.t === 'newdoc' && e.parent === p) h += sxEditRow('', dep, false)
    return h
  }
  return `<button type="button" class="sx-root${!S.sx.sel ? ' on' : ''}" data-sxroot="1" data-a="sxRootSel" data-t="sxRoot" aria-pressed="${!S.sx.sel}" title="맨 위를 고른다 · [+ 폴더] 는 여기에 선다">${svg('folder')}맨 위</button>${walk('', 0) || '<div class="empty2"><b>맞는 문서가 없다</b>다른 말로 찾는다</div>'}`
}
function sxBarHtml() {
  if (sxFlowOn()) return sxFlowBarHtml()
  const ch = sxDiff(), n = ch.length
  if (!n) return ''
  const cnt = (k) => ch.filter((c) => c.k === k).length
  const parts = ['옮김', '이름', '차례', '새 문서', '새 폴더'].map((k) => [k, cnt(k)]).filter((z) => z[1]).map(([k, v]) => `${k} ${v}`).join(' · ')
  const pth = (f, nm) => esc((f ? f + '/' : '') + nm) + '.md'
  const rows = S.sx.barOpen ? `<ul class="sx-chg" data-t="sxChg">${ch.map((c) => `<li><span class="sx-kd${c.nw ? ' new' : ''}">${c.k}</span><span class="fr">${c.k === '차례' ? `<b>${esc(c.p || '맨 위')}</b> 안의 차례` : c.f ? `<b>${esc(c.f)}/</b>` : c.nw ? `<b>${pth(c.d.folder, c.d.name)}</b>` : `<s>${pth(c.o.folder, c.o.file)}</s> → <b>${pth(c.d.folder, sxFile(c.d))}</b>`}</span>${c.k === '차례' ? `<button type="button" class="btn ghost sm" data-a="sxUndoOrd" data-p="${esc(c.p)}">처음대로</button>` : c.d ? `<button type="button" class="btn ghost sm" data-a="sxUndo" data-d="${esc(c.d.id)}">${c.nw ? '빼기' : '처음대로'}</button>` : ''}</li>`).join('')}</ul>` : ''
  return `<div class="sx-bar" data-t="sxBar" role="region" aria-label="바뀐 것"><div class="sx-bh"><b>바뀐 것 ${n}</b><span class="muted small">${parts}</span><button type="button" class="lk" data-a="sxBarT" aria-expanded="${S.sx.barOpen}">${S.sx.barOpen ? '접기' : '보기'}</button><span class="r"><button type="button" class="btn ghost" data-a="sxReset" data-t="sxReset">모두 처음대로</button><button type="button" class="btn pri" data-a="sxSave" data-t="sxSave"${S.sx.busy ? ' disabled aria-busy="true"' : ''}>${S.sx.busy ? '저장 중…' : '저장'}</button></span></div>${rows}</div>`
}
function viewStructure() {
  const head = (n, extra = '') => `<div class="pg-h sx-h"><div><div class="big">구조${n ? ': ' + esc(n.name) : ''}</div></div>${extra}</div>`
  const k = sxKn()
  if (!k) { const n0 = KN(S.route.kn); return { crumb: '문서 › 구조', main: `<div class="sxy">${head(n0)}<div class="empty2" data-t="sxNone"><b>이 지식에 지식관리자 자리가 없다</b></div></div>` } }
  const n = KN(k)
  const d = sxOf(k)
  if (!d) return { crumb: '문서 › 구조', main: `<div class="sxy">${head(n)}${loadingHtml}</div>` }
  if (d.error) return { crumb: '문서 › 구조', main: `<div class="sxy">${head(n)}${errHtml(d, 'sx:' + k)}</div>` }
  if (!S.sx || S.sx.k !== k || S.sx.src !== d) { sxInit(k, d); S.sx.src = d }
  const x = S.sx
  // 항목(다시 잡기) — 지금 짜임(GET shape)을 받으면 문서마다 항목 줄 · 받는 중 · 못 받음은 고른 것 카드에서만(나무 · 단순 길은 그대로)
  const sh = shOf(k)
  if (sh && !sh.error && (!x.IT || x.shFp !== sh.fp)) sxItemsInit(sh)
  if (sh && !sh.error) x.shSrc = sh
  const f = S.sxf && S.sxf.k === k ? S.sxf : null
  if (f && f.step === 2 && !f.srv && f.planKey !== sxPlanKey()) { f.step = 1; f.tried = null }
  const tabs = isTeam() ? '' : `<div class="tabs" role="tablist" aria-label="문서" data-t="sxTabs">${[['shape', '구조'], ['check', '점검']].map(([v, l]) => `<button type="button" role="tab" aria-selected="${(S.sxTab || 'shape') === v}" tabindex="${(S.sxTab || 'shape') === v ? 0 : -1}" data-a="sxTab" data-v="${v}" data-t="sxTab-${v}">${l}</button>`).join('')}</div>`
  if (!isTeam() && S.sxTab === 'check') return { crumb: '문서 › 구조', main: `<div class="sxy">${head(n)}${tabs}${guardBodyHtml(k)}</div>` }
  const df = x.W.filter((z) => { const o = sxO(z.id); return o && o.file !== o.title && !z.sync && !z.watched }).length
  const tools = `<div class="sx-tools"><input class="inp sx-q" id="sxQ" data-in="sxQ" data-t="sxQ" value="${esc(x.q)}" placeholder="찾기" aria-label="문서 찾기" autocomplete="off"><button type="button" class="btn" data-a="sxPick" data-t="sxPick" aria-pressed="${x.pick}" title="누르는 줄마다 고른다(Ctrl · Shift 를 누르고 눌러도 된다)">여러 개 고르기</button><button type="button" class="btn" data-a="sxNewDir" data-t="sxNewDir">+ 폴더</button><button type="button" class="btn pri" data-a="sxNewDoc" data-t="sxNewDoc">+ 새 문서</button>${sxClaudeBtn(sh)}</div>`
  const strip = df ? `<div class="callout warn sx-strip" data-t="sxStrip"><span><i class="sx-dot df" aria-hidden="true"></i> 파일 이름이 제목과 다른 문서 <b>${df}</b> <small class="muted">· 점: 파랑 바뀜 · 초록 새것 · 노랑 파일 이름 ≠ 제목</small></span><button type="button" class="btn sm" data-a="sxFix" data-t="sxFix">제목으로 맞추기</button></div>` : ''
  const card = sxCardHtml(k, sh)
  const tree = `<div class="sx-tree" id="sxTree" role="tree" aria-multiselectable="true" aria-label="문서 짜임" data-t="sxTree">${sxTreeHtml()}</div>`
  return { crumb: '문서 › 구조', main: `<div class="sxy">${head(n, tools)}${tabs}${sxCjHtml(k)}${sxWorkHtml(sh, f)}${sxFlowOn() ? sxFlowHtml() : ''}${strip}${x.multi.size ? `<div class="sx-sel" data-t="sxSel" role="status"><b>고른 것 ${x.multi.size}</b><button type="button" class="btn pri sm" data-a="sxMvSel" data-t="sxMvSel">옮기기…</button><button type="button" class="btn ghost sm" data-a="sxSelClear" data-t="sxSelClear">고르기 풀기</button></div>` : ''}${card ? `<div class="sxg"><div class="sxt">${tree}</div><div class="sxc">${card}</div></div>` : tree}<p class="muted small sx-tip">끌거나 [옮기기](M) 로 옮긴다 · 여럿은 Ctrl · Shift 로 누르거나 [여러 개 고르기](Ctrl + Space) · 이름은 두 번 누르거나 F2 · 차례는 Alt ↑↓</p>${sxBarHtml()}${S.sxw && S.sxw.k === k ? sxWinHtml() : ''}</div>` }
}
async function sxSave() {
  const x = S.sx, k = x.k, ops = sxOps()
  x.busy = true; render()
  try {
    const dry = await postJSON(`/api/k/${encodeURIComponent(k)}/structure`, { ops, base: x.fp, dry: true })
    x.busy = false; render()
    const s = dry.summary || {}
    const ok = await ask({ t: '구조 저장', d: `바뀐 것 ${sxDiff().length} 대로 바꾼다. ${[s.moved ? `옮김 ${s.moved}` : '', s.titled ? `제목 ${s.titled}` : '', s.created ? `새 문서 ${s.created}` : '', s.links ? `고칠 링크 ${s.links}` : '', s.registry ? `장부 줄 ${s.registry + (s.forms || 0)}` : ''].filter(Boolean).join(' · ')}`, ok: '저장' })
    if (!ok) return
    x.busy = true; render()
    const r = await postJSON(`/api/k/${encodeURIComponent(k)}/structure`, { ops, base: x.fp })
    toast(`<b>구조를 저장했다</b>${r.commit ? '' : ' · 바뀐 것이 없다'}`)
    sxReload(k)
  } catch (e) {
    if (e.code === 'E_CONFLICT') {
      const again = await ask({ t: '그사이 구조가 바뀌었다', d: '다시 읽으면 이 화면에서 바꾼 것은 사라진다', ok: '다시 읽기' })
      if (again) { sxReload(k) }
    } else toastErr(e)
  } finally { if (S.sx) S.sx.busy = false; render() }
}

// ── 다시 잡기(바탕 세우기 설계 5-4 · Z5) — 항목 옮기기 · 이름 · 합치기 · 나누기 · 빈 문서 걷기 → 구조안(설계 3-3 · 새 짜임 전체) →
//   1 구조안(POST shape/check · 바뀔 것 · 걸림) › 2 해 보기(shape/try · 연습 판 · 끝 진단) › 3 넣기(shape/put · 걸음 실패 · 이어 넣기) › 4 끝(shape/undo 되돌리기 구조안).
//   단순 길(문서 · 폴더 · 차례만)은 [저장] 그대로. 걸음은 서버가 지금 지식으로 다시 만든다(화면은 구조안만 보낸다 · 권한 모델 7-2).
//   Claude(구조안 받기 · 글 짓기)는 Z6 까지 꺼 둔다 — 합치기 · 나누기 글은 손으로 쓴다(items[].text)
const shOf = (k) => need('sh:' + k, `/api/k/${encodeURIComponent(k)}/shape`)
const SX_STEPS = ['구조안', '해 보기', '넣기', '끝']
const SX_STAGE = { plan: '구조안', tried: '해 보기', putting: '넣는 중', stopped: '넣다 섬', rebase: '다시 맞추기' }
const shapeUrl = (k, p) => `/api/k/${encodeURIComponent(k)}/shape/${p}`
// 항목 판 — 받은 짜임의 문서마다 항목(글이 그대로 가는 것: from = 제자리) · 새 문서는 빈 목록
function sxItemsInit(sh) {
  const x = S.sx
  x.IT = new Map(); x.shFp = sh.fp
  for (const d of x.W) { const o = sxO(d.id) && sh.docs.find((z) => z.id === d.id); x.IT.set(d.id, o ? o.items.map((it) => ({ h: it.h, from: [{ doc: d.id, h: it.h }], lines: it.lines, names: it.names })) : []) }
  x.OIT = new Map([...x.IT].map(([id, v]) => [id, v.map((it) => it.h)]))
  x.empty = new Set(); x.names = []; x.ipick = new Set(); x.isel = null
}
const sxItems = (wid) => { const x = S.sx; if (!x.IT) return []; if (!x.IT.has(wid)) x.IT.set(wid, []); return x.IT.get(wid) }
const sxSame = (wid, it) => !!sxO(wid) && it.from.length === 1 && it.from[0].doc === wid && it.from[0].h === it.h && typeof it.text !== 'string'
const sxIKey = (wid, h) => wid + '\n' + h
const sxPath = (d) => (d.folder ? d.folder + '/' : '') + d.name
// 항목 바뀐 것 — 옮김 · 이름 · 합치기 · 나누기 · 항목 차례 · 걷기
function sxItemDiff() {
  const x = S.sx, out = []
  if (!x || !x.IT) return out
  for (const d of x.W) {
    const its = x.IT.get(d.id) || []
    for (const it of its) {
      if (sxSame(d.id, it)) continue
      const k = typeof it.text === 'string' ? (it.from.length > 1 ? '합치기' : '나누기') : it.from[0].doc !== d.id ? '항목 옮김' : '항목 이름'
      out.push({ k, d, it })
    }
    const kept = its.filter((it) => sxSame(d.id, it)).map((it) => it.h), orig = (x.OIT.get(d.id) || []).filter((h) => kept.includes(h))
    if (kept.join('\n') !== orig.join('\n')) out.push({ k: '항목 차례', d })
  }
  for (const id of x.empty) { const d = sxW(id); if (d) out.push({ k: '걷기', d }) }
  return out
}
const sxFlow = () => (S.sxf && S.sxf.k === S.sx.k ? S.sxf : (S.sxf = { k: S.sx.k, step: 1 }))
const sxFlowOn = () => !!S.sx && (sxItemDiff().length > 0 || (!!S.sxf && S.sxf.k === S.sx.k && (S.sxf.step > 1 || !!S.sxf.check)))
// 넣는 중 · 끝 — 나무를 고쳐도 넣기에 들지 않는다(구조안은 서버 장부의 것)
function sxHold() {
  if (!S.sxf || !S.sx || S.sxf.k !== S.sx.k || S.sxf.step < 3) return false
  toast('<b>넣기 단계에서는 구조안을 고치지 않는다</b> · [마치기] 나 그만두기 뒤에', 0, true)
  return true
}
// 구조안(설계 3-3) — 새 짜임 전체. 문서는 끝 id + was(지금 id) · 항목은 h + from(+ 손으로 쓴 text) · 장부 항목 자리 · 걷을 문서 · 차례(바뀌었을 때만)
function sxPlan() {
  const x = S.sx, ops = sxOps(), idOf = (d) => (d.folder ? d.folder + '/' : '') + sxFile(d)
  const live = x.W.filter((d) => !x.empty.has(d.id))
  const docs = live.map((d) => ({ id: idOf(d), was: sxO(d.id) ? d.id : null, items: sxItems(d.id).map((it) => ({ h: it.h, from: it.from.map((z) => ({ doc: z.doc, h: z.h })), ...(typeof it.text === 'string' ? { text: it.text } : {}) })) }))
  let order = null
  if (['', ...sxDirs()].some(sxOrderMoved)) {
    order = { ...ops.order }
    for (const id of x.empty) { const d = sxW(id); if (d && order[d.folder]) order[d.folder] = order[d.folder].filter((nm) => nm !== sxFile(d)) }
  }
  const names = (x.names || []).filter((nm) => sxW(nm.wid) && !x.empty.has(nm.wid)).map((nm) => ({ coord: nm.coord, label: '', doc: idOf(sxW(nm.wid)), h: nm.h }))
  return { v: 1, kind: 'reshape', kn: x.k, base: x.shFp || null, forms: null, dirs: ops.dirs, docs, names, order, empty: [...x.empty].filter((id) => sxO(id)), skip: [] }
}
const sxPlanKey = () => (S.sx && S.sx.IT ? JSON.stringify(sxPlan()) : '')
// 장부 항목 자리 — 검사가 「닿던 장부 항목을 새 항목에 놓는다」 로 걸면 그 출처를 쓰는 항목에 놓는다(하나면 그것 · 여럿이면 첫 것 + 고르기)
function sxPlaceNames(r) {
  const x = S.sx
  let ch = false
  for (const e of (r && r.errors) || []) {
    if (e.code !== 'names' || !/^[^:\s]+:.+$/.test(e.where)) continue
    if (/장부 항목 자리가 구조안에 없다/.test(e.why)) { const n0 = x.names.length; x.names = x.names.filter((nm) => nm.coord !== e.where); ch = ch || x.names.length !== n0; continue }
    const m = /^「(.+?) › (.+)」 에 닿던 장부 항목/.exec(e.why)
    if (!m) continue
    const opts = []
    for (const d of x.W) for (const it of sxItems(d.id)) if (it.from.some((z) => z.doc === m[1] && z.h === m[2])) opts.push({ wid: d.id, h: it.h })
    if (!opts.length || x.names.some((nm) => nm.coord === e.where && opts.some((o) => o.wid === nm.wid && o.h === nm.h))) continue
    x.names = x.names.filter((nm) => nm.coord !== e.where)
    x.names.push({ coord: e.where, wid: opts[0].wid, h: opts[0].h, opts })
    ch = true
  }
  return ch
}
// 다시 읽기 — 넣은 뒤 · 그만둔 뒤(짜임 · 항목 · 나무)
function sxReload(k) { delete S.cache['sx:' + k]; delete S.cache['sh:' + k]; forgetKn(k); S.sx = null }
async function sxRun(kind, fn) {
  const f = sxFlow()
  if (f.busy) return
  f.busy = kind; f.err = null; render()
  try { await fn(f) } catch (e) { if (e && e.code === 'E_CANCEL') return; f.err = e; console.warn('다시 잡기', e) } finally { f.busy = null; render() }
}
const sxCheck = () => sxRun('check', async (f) => {
  const k = S.sx.k
  let plan, r
  for (let i = 0; i < 3; i++) { plan = sxPlan(); r = await postJSON(shapeUrl(k, 'check'), { plan }); if (!sxPlaceNames(r)) break }
  Object.assign(f, { check: r, planKey: JSON.stringify(plan), tried: null, put: null, srv: false, undo: false })
})
const sxTry = () => sxRun('try', async (f) => { f.tried = null; f.tried = await postJSON(shapeUrl(S.sx.k, 'try'), {}) })
async function sxPut() {
  const f = sxFlow(), n = (f.tried && f.tried.steps && f.tried.steps.length) || 0
  if (!f.put && !(await ask({ t: '넣기', d: `${n ? `걸음 ${n} 을 ` : ''}지식에 넣는다. 넣은 뒤에 되돌리려면 되돌리기 구조안을 연다`, ok: '넣기' }))) return
  const k = S.sx.k
  await sxRun('put', async (f2) => {
    const r = await postJSON(shapeUrl(k, 'put'), {})
    f2.put = r
    sxReload(k)
    if (r.done) { f2.step = 4; toast('<b>구조를 넣었다</b>') }
  })
}
async function sxStop() {
  const k = S.sx.k
  if (!(await ask({ t: '그만두기', d: '열린 짜임 일을 끝낸다. 이미 넣은 걸음은 그대로 남는다', ok: '그만두기', danger: true }))) return
  try {
    await postJSON(shapeUrl(k, 'stop'), {})
    S.sxf = null; delete S.cache['sh:' + k]
    toast('<b>짜임 일을 그만두었다</b>')
  } catch (e) { toastErr(e) } finally { render() }
}
const sxUndoPlan = () => sxRun('undo', async (f) => {
  const k = S.sx.k
  const r = await postJSON(shapeUrl(k, 'undo'), {})
  sxReload(k)
  S.sxf = { k, step: 2, check: r, srv: true, undo: true }
})
// 열린 짜임 일(GET shape 의 work) — 내 것이면 이어 하기 · 남의 것이면 그만두게 하기(지식관리자 누구나)
function sxWorkHtml(sh, f) {
  const w = sh && !sh.error ? sh.work : null
  if (!w || (f && (f.step > 1 || f.check)) || ['done', 'stopped-final'].includes(w.stage)) return ''
  if (w.broken) return `<div class="callout danger" data-t="sxWork"><i></i><span><b>짜임 일 장부가 깨졌다</b></span><button type="button" class="btn sm r" data-a="sxStop" data-t="sxWorkStop">그만두게 하기</button></div>`
  // 열린 기초 세우기(TODO 9) — 다시 잡기가 아니라 지식관리 › 기초 세우기에서 잇는다
  if (w.kind === 'seed') return `<div class="callout warn" data-t="sxWork"><i></i><span><b>기초 세우기 중</b> · ${esc(w.by)}</span>${w.mine && !isTeam() ? `<button type="button" class="btn sm r" data-a="sdOpenSeed" data-k="${esc(sh.kn)}" data-t="sxSeedGo">기초 세우기</button>` : ''}</div>`
  if (!w.mine) return `<div class="callout warn" data-t="sxWork"><i></i><span><b>${esc(w.by)}</b> 가 연 짜임 일 · ${esc(SX_STAGE[w.stage] || w.stage)}</span><button type="button" class="btn sm r" data-a="sxStop" data-t="sxWorkStop">그만두게 하기</button></div>`
  // 걸음 실패로 선 일(approve 모드 지식 · P-D24) — 이어 넣기가 아니라 까닭을 보고 구조안을 고친다
  return `<div class="callout warn" data-t="sxWork"><i></i><span><b>열린 짜임 일</b> · ${w.fail ? '걸음 실패' : esc(SX_STAGE[w.stage] || w.stage)}</span><span class="r row u-g3"><button type="button" class="btn ghost sm" data-a="sxStop" data-t="sxWorkStop">버리기</button><button type="button" class="btn sm" data-a="sxResume" data-t="sxResume">${['putting', 'stopped', 'rebase'].includes(w.stage) && !w.fail ? '이어 넣기' : '이어 하기'}</button></span></div>`
}
// 단계 띠(.stepbar · 설계 5-2) — 지금 aria-current · 지난 ✓ · 아직 aria-disabled · 2 에서는 1 로 돌아가 고칠 수 있다
function sxStepsHtml(f) {
  return `<nav class="stepbar" aria-label="다시 잡기 단계" data-t="sxSteps">${SX_STEPS.map((l, i) => {
    const n = i + 1, cur = f.step === n, done = f.step > n, back = n === 1 && f.step === 2 && !f.srv, far = Math.abs(n - f.step) > 1 ? ' far' : ''
    return `${i ? `<span class="sep${far}" aria-hidden="true">›</span>` : ''}<button type="button" class="step${done ? ' done' : ''}${far}" data-a="sxStep" data-v="${n}" data-t="sxStep-${n}"${cur ? ' aria-current="step"' : ''}${!cur && !back ? ' aria-disabled="true"' : ''}><span class="n">${n}</span>${done ? '<span class="ck" aria-hidden="true">✓</span><span class="sr-only">지남</span>' : ''}${l}</button>`
  }).join('')}${tipb('sx.flow', '다시 잡기')}</nav>`
}
const sxWhere = (e) => `<li><b>${esc(e.where || e.what || '')}</b> <span class="muted">${esc(e.why || '')}</span></li>`
function sxCheckHtml(r, stale) {
  const errs = r.errors || [], warns = r.warnings || [], x = S.sx
  const pick = (x.names || []).map((nm, i) => (nm.opts && nm.opts.length > 1 ? `<div class="sx-nm" data-t="sxNamePick"><label class="small" for="sxNm${i}"><span class="iv">${esc(nm.coord)}</span></label><select class="inp" id="sxNm${i}" data-sxname="${i}">${nm.opts.map((o, j) => `<option value="${j}"${o.wid === nm.wid && o.h === nm.h ? ' selected' : ''}>${esc(sxPath(sxW(o.wid) || { folder: '', name: o.wid }))} › ${esc(o.h)}</option>`).join('')}</select></div>` : '')).join('')
  return `<div class="card sx-ck" data-t="sxCheck"><div class="ch">바뀔 것 <small>${(r.changes || []).length}</small><span class="r">${stale ? chipOf('wait', '다시 검사') : errs.length ? chipOf('held', `걸림 ${errs.length}`) : chipOf('ok', '걸림 0')}</span></div><div class="cb">${r.stale ? '<div class="callout warn" data-t="sxStale"><i></i><span>그사이 짜임이 바뀌었다: 다시 검사한다</span></div>' : ''}${errs.length ? `<ul class="sx-ul bad" data-t="sxErrors">${errs.slice(0, 50).map(sxWhere).join('')}</ul>` : ''}${pick}<ul class="sx-ul" data-t="sxChanges">${(r.changes || []).slice(0, 200).map((c) => `<li>${esc(c)}</li>`).join('') || '<li class="muted">없다</li>'}</ul>${warns.length ? `<details class="small" data-t="sxWarn"><summary>경고 ${warns.length}</summary><ul class="sx-ul">${warns.slice(0, 50).map(sxWhere).join('')}</ul></details>` : ''}</div></div>`
}
function sxDiagHtml(t) {
  const d = t.diag || { blockers: [], warnings: [], counts: {} }, c = d.counts || {}
  return `<div class="card sx-ck" data-t="sxDiag"><div class="ch">연습 판 <small>걸음 ${(t.steps || []).length}</small><span class="r">${d.blockers.length ? chipOf('held', `막는 것 ${d.blockers.length}`) : chipOf('ok', '막는 것 0')}</span></div><div class="cb">${d.blockers.length ? `<ul class="sx-ul bad" data-t="sxBlockers">${d.blockers.map(sxWhere).join('')}</ul>` : ''}<p class="small muted mt0" data-t="sxCounts">문서 ${c.docs ?? '-'} · 항목 ${c.items ?? '-'} · 고칠 링크 ${c.links ?? 0} · 머리 잃은 항목 ${c.lost ?? 0}</p>${d.warnings.length ? `<details class="small" data-t="sxWarn"><summary>볼 것 ${d.warnings.length}</summary><ul class="sx-ul">${d.warnings.slice(0, 50).map(sxWhere).join('')}</ul></details>` : ''}</div></div>`
}
function sxPutHtml(f) {
  const p = f.put
  if (f.busy === 'put') return `<div class="card sx-ck" data-t="sxPutting"><div class="cb">${loadingHtml.replace('읽는 중…', '넣는 중…')}<p class="small muted mt0">다른 화면으로 가도 이어 간다</p></div></div>`
  if (!p) return f.tried ? sxDiagHtml(f.tried) : ''
  // 걸음 실패(approve 모드 지식 · 저장 승인 P-D24) — 아무것도 쓰지 않고 멈췄다 · 구조안을 고쳐 다시 검사한다
  if (p.stopped && p.stopped.fail) return `<div class="callout danger" data-t="sxStepFail"><i></i><div><b>걸음 실패</b>${tipb('sx.stepFail', '걸음 실패')}<ul class="sx-ul">${p.stopped.fail.map((h) => `<li><b>${esc(h.heading || h.doc || '')}</b> <span>${esc(h.why || h.code || '')}</span></li>`).join('')}</ul><button type="button" class="btn sm" data-a="sxFixPlan" data-t="sxFixPlan">구조안 고치기</button></div></div>`
  if (p.again) return `<div class="callout warn" data-t="sxAgain"><i></i><span><b>그사이 바뀜</b>: 연습 판에 다시 해 본다</span></div>${p.diag ? sxDiagHtml({ diag: p.diag, steps: [] }) : ''}`
  if (p.conflict) return `<div class="callout warn" data-t="sxConflict"><i></i><span><b>그사이 바뀜</b>: ${esc(p.conflict.why || '')}</span></div>`
  if (p.halted) return '<div class="callout warn" data-t="sxHalted"><i></i><span>그만둔 일이다</span></div>'
  if (p.resume || p.putting) return '<div class="callout warn" data-t="sxResumeNote"><i></i><span><b>잠깐 멈춤</b>: 남은 걸음부터 이어 넣는다</span></div>'
  return ''
}
function sxFlowHtml() {
  const f = sxFlow()
  let body = f.err ? formErr(f.err.message || String(f.err), 'sxFlowErr') : ''
  if (f.step === 1 && f.check) body += sxCheckHtml(f.check, sxPlanKey() !== f.planKey)
  if (f.step === 2) {
    if (f.undo) body += '<div class="callout warn" data-t="sxUndoNote"><i></i><span><b>되돌리기 구조안</b>: 넣기 앞 짜임으로 돌린다</span></div>'
    if (f.check) body += sxCheckHtml(f.check, false)
    if (f.busy === 'try') body += `<div class="card sx-ck"><div class="cb">${loadingHtml.replace('읽는 중…', '해 보는 중…')}</div></div>`
    else if (f.tried) body += sxDiagHtml(f.tried)
  }
  if (f.step === 3) body += sxPutHtml(f)
  if (f.step === 4) body += `<div class="card sx-ck" data-t="sxDone"><div class="ch">넣었다 <small>걸음 ${(f.put && f.put.steps) || 0}</small><span class="r">${chipOf('ok', '끝')}</span></div><div class="cb"><button type="button" class="btn" data-a="sxUndoPlan" data-t="sxUndoPlan"${f.busy ? ' disabled' : ''}>되돌리기 구조안</button></div></div>`
  return `<div class="sx-flow" data-t="sxFlow">${sxStepsHtml(f)}${body}</div>`
}
// 바닥 줄(다시 잡기) — 바뀐 것 수 · 주 단추가 꺼졌으면 「먼저: 까닭」 · ⋯(모두 처음대로 · 그만두기) · 주 단추 하나
function sxFlowMain(f) {
  if (f.busy) return [{ check: '검사하는 중…', try: '해 보는 중…', put: '넣는 중…', undo: '여는 중…' }[f.busy] || '…', '', true, '']
  if (f.step === 1) {
    const n = sxItemDiff().length + sxDiff().length
    if (!n && !f.check) return ['검사', 'sxCheck', true, '바뀐 것이 없다']
    const fresh = f.check && sxPlanKey() === f.planKey
    if (fresh && f.check.ok) return ['정하고 다음: 해 보기', 'sxNext', false, '']
    return ['검사', 'sxCheck', false, fresh ? `걸림 ${(f.check.errors || []).length}` : '']
  }
  if (f.step === 2) {
    if (f.check && !f.check.ok) return ['연습 판에 해 보기', '', true, `걸림 ${(f.check.errors || []).length}`]
    if (!f.tried) return ['연습 판에 해 보기', 'sxTry', false, '']
    if (f.tried.ok) return ['정하고 다음: 넣기', 'sxNext', false, '']
    return ['다시 해 보기', 'sxTry', false, `막는 것 ${((f.tried.diag && f.tried.diag.blockers) || []).length}`]
  }
  if (f.step === 3) {
    if (!f.put) return ['넣기', 'sxPut', false, '']
    if (f.put.again) return ['다시 해 보기', 'sxTryAgain', false, '']
    if (f.put.stopped && f.put.stopped.fail) return ['구조안 고치기', 'sxFixPlan', false, '']
    return ['이어 넣기', 'sxPut', false, f.put.stopped ? '걸린 걸음을 고친다' : '']
  }
  return ['마치기', 'sxEnd', false, '']
}
function sxFlowBarHtml() {
  const f = sxFlow(), x = S.sx, ich = sxItemDiff(), ch = sxDiff(), n = ch.length + ich.length
  const [label, act, dis, need] = sxFlowMain(f)
  const sh = x.shSrc, open = f.step > 1 || !!(sh && sh.work && sh.work.mine && !['done', 'stopped-final'].includes(sh.work.stage))
  const more = `<button type="button" class="kebab${S.menu === 'sxMore' ? ' on' : ''}" data-a="menu" data-m="sxMore" data-t="sxMore" title="더 보기">⋯${S.menu === 'sxMore' ? popHtml('sxMore', `<div>${f.step < 3 ? '<div class="mi" data-a="sxReset" data-t="sxResetMi">모두 처음대로</div>' : ''}${open ? '<div class="mi" data-a="sxStop" data-t="sxStopMi">그만두기</div>' : ''}</div>`) : ''}</button>`
  const rows = x.barOpen ? `<ul class="sx-chg" data-t="sxChg">${[...ch.map((c) => [c.k, c.d ? sxPath(c.d) : c.f || c.p || '맨 위']), ...ich.map((c) => [c.k, sxPath(c.d) + (c.it ? ' › ' + c.it.h : '')])].map(([k, t]) => `<li><span class="sx-kd">${esc(k)}</span><span class="fr">${esc(t)}</span></li>`).join('')}</ul>` : ''
  return `<div class="sx-bar" data-t="sxBar" role="region" aria-label="바뀐 것"><div class="sx-bh"><span class="l"><span><b>바뀐 것 ${n}</b>${n ? ` <button type="button" class="lk" data-a="sxBarT" aria-expanded="${x.barOpen}">${x.barOpen ? '접기' : '보기'}</button>` : ''}</span>${need ? `<span class="need" data-t="sxNeed">먼저: ${esc(need)}</span>` : ''}</span><span class="r">${f.step < 3 || open ? more : ''}<button type="button" class="btn pri"${act ? ` data-a="${act}"` : ''} data-t="sxGo"${dis ? ' disabled' : ''}${f.busy ? ' aria-busy="true"' : ''}>${esc(label)}</button></span></div>${rows}</div>`
}
// 고른 것 카드 — 고른 문서의 항목 줄 · 항목 하나를 고르면 [옮기기…] [이름] [나누기…] · 둘 이상 표시하면 [합치기…] · 빈 문서는 [걷기]
function sxCardHtml(k, sh) {
  const x = S.sx, s = x.sel && x.sel.startsWith('d:') ? sxW(x.sel.slice(2)) : null
  if (!s) return ''
  const head = `<div class="ch">${svg('doc')}<span class="u-f1 sx-cn">${esc(s.name)}</span>${s.watched ? `<span class="sx-lock" title="원본이 주인">${svg('lock')}</span>` : ''}</div>`
  if (!sh) return `<div class="card" data-t="sxCard">${head}<div class="cb">${loadingHtml}</div></div>`
  if (sh.error) return `<div class="card" data-t="sxCard">${head}<div class="cb">${errHtml(sh, 'sh:' + k)}</div></div>`
  const its = sxItems(s.id), lock = s.watched
  const rows = its.map((it) => {
    const key = sxIKey(s.id, it.h), on = x.isel === key
    const dot = typeof it.text === 'string' ? '<i class="sx-dot new" title="새 글"></i>' : !sxSame(s.id, it) ? '<i class="sx-dot ch" title="바뀜"></i>' : ''
    return `<li class="sx-it${on ? ' on' : ''}" data-t="sxItem" data-h="${esc(it.h)}"><input type="checkbox" data-sxpick="${esc(key)}" aria-label="${esc(it.h)} 합치기에 넣기"${x.ipick.has(key) ? ' checked' : ''}${lock ? ' disabled' : ''}><button type="button" class="nm" data-a="sxISel" data-k="${esc(key)}" aria-pressed="${on}">${esc(it.h)}</button><span class="mt">${it.lines ?? 0}줄${it.names ? ` · 장부 항목 ${it.names}` : ''}</span>${dot}</li>${on && !lock ? `<li class="sx-ia" data-t="sxItemActs"><button type="button" class="btn sm" data-a="sxIMv" data-t="sxIMv">옮기기…</button><button type="button" class="btn sm" data-a="sxIRen" data-t="sxIRen">이름</button><button type="button" class="btn sm" data-a="sxISplit" data-t="sxISplit">나누기…</button></li>` : ''}`
  }).join('')
  const np = x.ipick.size
  const tools = lock ? '' : `<div class="sx-itools"><button type="button" class="btn sm" data-a="sxIMerge" data-t="sxIMerge"${np >= 2 ? '' : ' disabled'}>합치기…${np ? ` ${np}` : ''}</button>${np ? '<button type="button" class="btn ghost sm" data-a="sxIPickClear" data-t="sxIPickClear">풀기</button>' : ''}${!its.length && sxO(s.id) ? `<button type="button" class="btn sm" data-a="sxDrop" data-t="sxDrop" aria-pressed="${x.empty.has(s.id)}">${x.empty.has(s.id) ? '걷기 풀기' : '걷기'}</button>` : ''}</div>`
  return `<div class="card" data-t="sxCard">${head}<div class="cb">${tools}${its.length ? `<ul class="sx-its" data-t="sxItems">${rows}</ul>` : `<div class="empty2" data-t="sxNoItems"><b>${x.empty.has(s.id) ? '걷을 문서' : '항목 없음'}</b></div>`}</div></div>`
}
// 창 셋(설계 5-4) — 옮기기 · 합치기 · 나누기. 구조안에만 적는다(넣기 전에는 지식이 바뀌지 않는다)
const sxDocOpts = () => S.sx.W.filter((d) => !d.watched && !S.sx.empty.has(d.id)).map((d) => [d.id, sxPath(d)]).sort((a, b) => sxBy(a[1], b[1]))
const sxAtOpts = (wid, skip) => [['', '맨 끝'], ...sxItems(wid).filter((it) => !skip.includes(sxIKey(wid, it.h))).map((it) => [it.h, it.h + ' 앞'])]
const sxSel = (id, t, opts, v, extra = '') => `<select class="inp" id="${id}" data-sxw="${t}"${extra}>${opts.map(([o, l]) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
const sxItemOf = (key) => { const i = key.indexOf('\n'), wid = key.slice(0, i), h = key.slice(i + 1); return { wid, h, it: sxItems(wid).find((z) => z.h === h) } }
function sxWinHtml() {
  const w = S.sxw, cl = sxwClaudeBtn(w)
  const shell = (t, title, sub, mb, go, wide) => `<div class="scrim fix" data-a="sxwClose" data-self="1"><div class="modal ${wide ? 'w760' : 'w560'}" role="dialog" aria-modal="true" aria-labelledby="sxwH" data-t="${t}"><div class="mh" id="sxwH">${title} <small>${esc(sub)}</small><button type="button" class="x" data-a="sxwClose" title="닫기" aria-label="닫기">×</button></div><div class="mb">${mb}${sxwCjHtml(w)}${w.err ? formErr(w.err, 'sxwErr') : ''}</div><div class="mf"><span class="l small muted">구조안에만 적는다</span><span class="acts"><button type="button" class="btn ghost" data-a="sxwClose">취소</button><button type="button" class="btn pri" data-a="sxwGo" data-t="sxwGo"${w.loading || w.cj?.state === 'run' ? ' disabled' : ''}>${go}</button></span></div></div></div>`
  const fld = (id, label, inner, last) => `<div class="field"${last ? ' style="margin-bottom:0"' : ''}><label for="${id}">${label}</label>${inner}</div>`
  const place = (skip) => fld('sxwTo', '문서', sxSel('sxwTo', 'to', sxDocOpts(), w.to)) + fld('sxwAt', '놓을 차례', sxSel('sxwAt', 'at', sxAtOpts(w.to, skip), w.at)) + fld('sxwHd', '머리', `<input class="inp" id="sxwHd" data-in="sxw" data-f="h" value="${esc(w.h)}" autocomplete="off">`)
  const txt = (id, v, i) => (w.loading ? loadingHtml : w.cj?.state === 'run' ? '<p class="loading" data-t="sxwCjRun">Claude 가 짓는 중…</p>' : `<textarea class="inp" id="${id}" rows="6" data-in="sxw" data-f="text"${i != null ? ` data-i="${i}"` : ''}>${esc(v || '')}</textarea>`)
  if (w.t === 'move') return shell('sxMoveWin', '항목 옮기기', w.src.h, place([sxIKey(w.src.wid, w.src.h)]), '옮기기')
  if (w.t === 'merge') {
    const srcs = `<ul class="sx-ul" data-t="sxwSrcs">${w.srcs.map((s, i) => `<li><b>${esc(sxPath(sxW(s.wid)))} › ${esc(s.h)}</b>${w.srcs.length > 2 ? ` <button type="button" class="btn ghost sm" data-a="sxwDrop" data-i="${i}">빼기</button>` : ''}</li>`).join('')}</ul>`
    return shell('sxMergeWin', '합치기', `항목 ${w.srcs.length}`, srcs + place(w.srcs.map((s) => sxIKey(s.wid, s.h))) + `<div class="field" style="margin-bottom:0"><div class="lbrow"><label class="lb" for="sxwTx">글</label>${tipb('sx.write', '글')}${cl}</div>${txt('sxwTx', w.text)}</div>`, '합치기')
  }
  const rows = w.rows.map((r, i) => `<div class="sx-wrow" data-t="sxwRow"><div class="sx-wf">${fld(`sxwTo${i}`, '문서', sxSel(`sxwTo${i}`, 'to', sxDocOpts(), r.to, ` data-i="${i}"`))}${fld(`sxwHd${i}`, '머리', `<input class="inp" id="sxwHd${i}" data-in="sxw" data-f="h" data-i="${i}" value="${esc(r.h)}" autocomplete="off">`)}</div>${fld(`sxwTx${i}`, '이 항목에 갈 내용', txt(`sxwTx${i}`, r.text, i), true)}${w.rows.length > 2 ? `<button type="button" class="btn ghost sm" data-a="sxwDrop" data-i="${i}">이 목표 빼기</button>` : ''}</div>`).join('')
  return shell('sxSplitWin', '나누기', w.src.h, `<div class="lbrow"><span class="lb">${esc(sxPath(sxW(w.src.wid)))} › ${esc(w.src.h)}</span>${tipb('sx.write', '글')}${cl}</div>${rows}<button type="button" class="btn sm" data-a="sxwAddRow" data-t="sxwAddRow">+ 목표 줄</button>`, '나누기', true)
}
// 출처 글 — 편집용 md(손으로 쓴 글이 있으면 그것)
async function sxSrcText(k, it) {
  if (typeof it.text === 'string') return it.text
  const out = []
  for (const z of it.from) {
    const v = await getJSON(`/api/k/${encodeURIComponent(k)}/doc?d=${encodeURIComponent(z.doc)}&edit=1`)
    const sec = (v.sections || []).find((s) => s.h === z.h)
    if (sec) out.push(sec.md ?? '')
  }
  return out.join('\n\n')
}
async function sxwFill(w, its, put) {
  try { const t = []; for (const it of its) t.push(await sxSrcText(w.k, it)); put(t) } catch (e) { w.err = '출처 글을 읽지 못했다: ' + e.message } finally { w.loading = false; if (S.sxw === w) render() }
}
function sxwOpen(t, keys) {
  const x = S.sx, its = keys.map(sxItemOf).filter((z) => z.it)
  if (!its.length || sxHold()) return
  const a = its[0], base = { k: x.k, t, to: a.wid, at: '', h: a.h, err: '' }
  if (t === 'move') S.sxw = { ...base, src: { wid: a.wid, h: a.h } }
  if (t === 'merge') { S.sxw = { ...base, srcs: its.map((z) => ({ wid: z.wid, h: z.h })), text: '', loading: true }; sxwFill(S.sxw, its.map((z) => z.it), (ts) => { S.sxw.text = ts.filter(Boolean).join('\n\n') }) }
  if (t === 'split') { S.sxw = { ...base, src: { wid: a.wid, h: a.h }, rows: [{ to: a.wid, h: a.h, text: '' }, { to: a.wid, h: '', text: '' }], loading: true }; sxwFill(S.sxw, [a.it], (ts) => { S.sxw.rows[0].text = ts[0] || '' }) }
  render()
}
// 놓은 장부 항목 자리를 따라 옮긴다(항목을 옮기거나 이름을 바꾸거나 합칠 때)
function sxNameMove(keys, wid, h) { for (const nm of S.sx.names || []) if (keys.includes(sxIKey(nm.wid, nm.h))) Object.assign(nm, { wid, h, opts: null }) }
const sxHeadBad = (h) => (!h ? '머리를 쓴다' : h.length > 120 ? '머리는 120자 안으로' : /[\r\n]/.test(h) ? '머리는 한 줄' : '')
function sxwGo() {
  const w = S.sxw, x = S.sx
  if (!w || w.loading) return
  const clash = (wid, h, skip) => sxItems(wid).some((it) => it.h === h && !skip.includes(sxIKey(wid, it.h)))
  const take = (wid, h) => { const a = sxItems(wid), i = a.findIndex((z) => z.h === h); return i < 0 ? null : a.splice(i, 1)[0] }
  const put = (wid, it, before) => { const a = sxItems(wid); let i = before ? a.findIndex((z) => z.h === before) : -1; if (i < 0) i = a.length; a.splice(i, 0, it) }
  const fail = (m) => { w.err = m; render() }
  if (w.t === 'move' || w.t === 'merge') {
    const h = String(w.h || '').trim(), skip = w.t === 'move' ? [sxIKey(w.src.wid, w.src.h)] : w.srcs.map((s) => sxIKey(s.wid, s.h))
    const bad = sxHeadBad(h) || (clash(w.to, h, skip) ? `같은 머리가 있다: ${sxPath(sxW(w.to))} › ${h}` : '')
    if (bad) return fail(bad)
    if (w.t === 'move') {
      const it = take(w.src.wid, w.src.h); if (!it) return fail('그 항목이 이제 없다')
      sxNameMove([sxIKey(w.src.wid, w.src.h)], w.to, h)
      it.h = h; put(w.to, it, w.at)
    } else {
      if (!String(w.text || '').trim()) return fail('글을 쓴다')
      if (w.srcs.length < 2) return fail('합칠 항목은 둘 이상')
      const its = w.srcs.map((s) => take(s.wid, s.h)).filter(Boolean)
      const from = []; for (const it of its) for (const z of it.from) if (!from.some((y) => y.doc === z.doc && y.h === z.h)) from.push(z)
      put(w.to, { h, from, text: w.text, lines: its.reduce((n, it) => n + (it.lines || 0), 0), names: its.reduce((n, it) => n + (it.names || 0), 0) }, w.at)
      sxNameMove(w.srcs.map((s) => sxIKey(s.wid, s.h)), w.to, h)
      x.ipick = new Set()
    }
    x.isel = sxIKey(w.to, h)
  } else {
    const rows = w.rows.map((r) => ({ ...r, h: String(r.h || '').trim() }))
    if (rows.length < 2) return fail('목표는 둘 이상')
    for (const r of rows) { const b = sxHeadBad(r.h) || (!String(r.text || '').trim() ? `「${r.h}」 에 갈 내용을 쓴다` : '') || (clash(r.to, r.h, [sxIKey(w.src.wid, w.src.h)]) || rows.some((o) => o !== r && o.to === r.to && o.h === r.h) ? `같은 머리가 있다: ${sxPath(sxW(r.to))} › ${r.h}` : ''); if (b) return fail(b) }
    const it = take(w.src.wid, w.src.h); if (!it) return fail('그 항목이 이제 없다')
    for (const r of rows) put(r.to, { h: r.h, from: it.from.map((z) => ({ ...z })), text: r.text, lines: String(r.text).split('\n').length, names: 0 }, '')
    x.isel = sxIKey(rows[0].to, rows[0].h)
  }
  S.sxw = null
  render()
}

// ── Claude 짜임(바탕 세우기 Z6 · 설계 5-4) — [Claude 구조안](나무에 덧씌움 · 넣기 전에는 지식이 바뀌지 않는다) · [Claude 짓기](합치기 · 나누기 창 · 구조안이 놓은 글 필요 항목).
//   개인은 이 PC 의 claude -p, 팀은 팀 일꾼 일감. 일은 POST shape/ask · shape/write → GET shape/job/:job 를 돌며 본다 · 그만두기 POST …/stop.
//   「Claude 에 보내지 않음」 지식은 단추가 꺼지고 까닭을 보인다. 글은 결정적 오류만 고쳐 쓰고(그래도면 「걸음 실패」) · 출처에 없는 값은 알림(값 대조)
const sxIdOf = (d) => (d.folder ? d.folder + '/' : '') + sxFile(d)
const sxCjOff = (sh) => (!sh ? '짜임을 읽는 중' : sh.error ? '짜임을 읽지 못했다' : sh.claude && !sh.claude.ok ? sh.claude.why : '')
function sxClaudeBtn(sh) {
  const off = sxCjOff(sh), c = S.sxc && S.sx && S.sxc.k === S.sx.k ? S.sxc : null, run = c && c.state === 'run'
  return `<span class="sx-cl"><button type="button" class="btn" data-a="sxClaude" data-t="sxClaude"${off || run ? ' disabled' : ''}${off ? ` title="${esc(off)}"` : ''}${run ? ' aria-busy="true"' : ''}>${c && c.state === 'done' ? 'Claude 다시 받기' : 'Claude 구조안'}</button>${tipb('sx.claude', 'Claude 구조안')}</span>`
}
function sxwClaudeBtn(w) {
  const off = sxCjOff(shOf(w.k)), run = w.cj && w.cj.state === 'run'
  return `<span class="sx-cl"><button type="button" class="btn sm" data-a="sxwClaude" data-t="sxwClaude"${off || run || w.loading ? ' disabled' : ''}${off ? ` title="${esc(off)}"` : ''}${run ? ' aria-busy="true"' : ''}>${run ? '짓는 중…' : 'Claude 짓기'}</button>${tipb('sx.claudeW', 'Claude 짓기')}</span>`
}
const sxSecs = (t0) => Math.max(0, Math.round((Date.now() - t0) / 1000))
const sxCjWait = (c) => (c.old ? ' · 팀 일꾼 판이 옛것이다: 손으로 짜거나 일꾼을 다시 설치한다' : c.queued ? ' · 팀 일꾼을 기다린다' : '')
// 구조안 · 모두 짓기 줄(도구 줄 아래) — 도는 중 · 끝 · 못함 · 바꿀 것 없음을 가른다
function sxCjHtml(k) {
  const c = S.sxc && S.sxc.k === k ? S.sxc : null
  if (!c) return ''
  const close = '<button type="button" class="btn ghost sm" data-a="sxCjClose" data-t="sxCjClose">닫기</button>'
  if (c.state === 'run') return `<div class="callout sx-cj" data-t="sxCj" role="status"><span class="loading u-f1">${c.wr ? `Claude 가 글을 짓는 중 ${c.wr.i}/${c.wr.m}` : 'Claude 가 구조안을 짓는 중'} · ${sxSecs(c.t0)}초${sxCjWait(c)}</span><button type="button" class="btn ghost sm" data-a="sxCjStop" data-t="sxCjStop">그만두기</button></div>`
  if (c.state === 'fail') return `<div class="callout danger sx-cj" data-t="sxCj" role="alert"><span class="u-f1">${c.wr ? '글을 짓지 못했다' : '구조안을 받지 못했다'}: ${esc(c.why || '까닭을 모른다')}</span><button type="button" class="btn sm" data-a="${c.wr ? 'sxCjWrite' : 'sxClaude'}" data-t="sxCjAgain">다시</button>${close}</div>`
  if (c.state === 'cancel') return `<div class="callout gray sx-cj" data-t="sxCj"><span class="u-f1">그만뒀다 · 나무는 그대로다</span>${close}</div>`
  const need = sxNeedGroups().reduce((n, g) => n + g.items.length, 0)
  const wr = c.wrDone ? ` · 글 지음 ${c.wrDone.ok}${c.wrDone.fail.length ? ` · 걸림 ${c.wrDone.fail.length}` : ''}${c.wrDone.values ? ` · 값 알림 ${c.wrDone.values}` : ''}` : ''
  const fails = c.wrDone && c.wrDone.fail.length ? `<ul class="sx-ul" data-t="sxCjFails">${c.wrDone.fail.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''
  if (c.none) return `<div class="callout gray sx-cj" data-t="sxCj"><span class="u-f1">Claude 가 바꿀 것이 없다고 했다${c.why ? ' · ' + esc(c.why) : ''}</span>${close}</div>`
  return `<div class="callout sx-cj" data-t="sxCj"><span class="u-f1">Claude 구조안을 나무에 놓았다 · 바뀐 것 ${c.n}${need ? ` · 글 필요 ${need}` : ''}${wr}${c.why ? ` <small class="muted">${esc(c.why)}</small>` : ''}</span>${need ? `<button type="button" class="btn sm" data-a="sxCjWrite" data-t="sxCjWrite"${sxCjOff(shOf(k)) ? ' disabled' : ''}>Claude 짓기 ${need}</button>` : ''}${close}</div>${fails}`
}
// 창 안 짓기 줄 — 도는 중은 글 칸 자리 · 끝은 값 알림 · 걸음 실패 · 못함(+ 다시)
function sxwCjHtml(w) {
  const c = w.cj
  if (!c || c.state === 'run') return c ? `<div class="callout sx-cj" data-t="sxwCj" role="status"><span class="u-f1">${sxSecs(c.t0)}초${sxCjWait(c)}</span><button type="button" class="btn ghost sm" data-a="sxwCjStop" data-t="sxwCjStop">그만두기</button></div>` : ''
  if (c.state === 'done') return c.values && c.values.length ? `<div class="callout warn" data-t="sxwCjVals">출처에 없는 값: ${c.values.slice(0, 3).map((v) => esc(v.why)).join(' · ')}</div>` : ''
  if (c.state === 'cancel') return ''
  return `<div class="callout danger sx-cj" data-t="sxwCjFail" role="alert"><span class="u-f1">${esc(c.why || '짓지 못했다')}${c.stepFail ? ' · 고쳐 쓰거나 손으로 쓴다' : ''}</span><button type="button" class="btn sm" data-a="sxwClaude" data-t="sxwCjAgain">다시</button></div>`
}
// 일 하나를 끝까지 본다 — 1.5초마다 · 그만두거나 다른 일로 바뀌면(alive 거짓) 서지 않고 놓는다
async function sxCjPoll(k, job, alive, onTick) {
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 1500))
    if (!alive()) return null
    let r
    try { r = await getJSON(`/api/k/${encodeURIComponent(k)}/shape/job/${job}`) } catch (e) { return { state: 'fail', why: e.message } }
    if (!alive()) return null
    if (r.state !== 'queued' && r.state !== 'running') return r
    onTick(r)
    render()
  }
}
// 구조안 받기 — 손으로 고친 것이 있으면 같이 준다(ask) · 받은 안을 나무에 덧씌운다
async function sxClaude() {
  const x = S.sx
  if (!x || sxHold()) return
  const k = x.k, ch = sxDiff().length + sxItemDiff().length
  if (ch && !(await ask({ t: 'Claude 구조안', d: `손으로 고친 것 ${ch} 을 Claude 에게 같이 준다. 받은 안이 지금 나무를 바꾼다`, ok: '받기' }))) return
  const c = { k, state: 'run', t0: Date.now() }
  S.sxc = c; render()
  try {
    const r = await postJSON(shapeUrl(k, 'ask'), { plan: ch && x.IT ? sxPlan() : null })
    c.job = r.job
    const end = await sxCjPoll(k, r.job, () => S.sxc === c && c.state === 'run', (t) => { c.queued = t.state === 'queued'; c.old = !!t.old })
    if (!end) return
    if (end.state !== 'done') { Object.assign(c, { state: end.state === 'cancelled' ? 'cancel' : 'fail', why: end.why }); return }
    if (!S.sx || S.sx.k !== k) { S.sxc = null; return }
    const n = sxApplyPlan(end.result.plan)
    Object.assign(c, { state: 'done', n, none: !n, why: end.result.why || '' })
  } catch (e) { Object.assign(c, { state: 'fail', why: e.message }) } finally { render() }
}
// 받은 구조안 → 나무(문서 옮김 · 새 문서 · 항목 · 걷기 · 장부 항목 자리). 합치기 · 나누기 항목은 글이 비어 있다(need) — [Claude 짓기] · 손으로
function sxApplyPlan(plan) {
  const x = S.sx, sh = x.shSrc
  if (!x.IT && sh) sxItemsInit(sh)
  const before = sxDiff().length + sxItemDiff().length
  const lineOf = (z) => { const d = sh && sh.docs.find((y) => y.id === z.doc); const it = d && d.items.find((y) => y.h === z.h); return it ? { lines: it.lines, names: it.names } : { lines: 0, names: 0 } }
  const uses = new Map()
  for (const d of plan.docs) for (const it of d.items) for (const z of it.from) uses.set(z.doc + '\n' + z.h, (uses.get(z.doc + '\n' + z.h) || 0) + 1)
  const widOf = new Map()
  for (const d of plan.docs) {
    const [folder, nm] = sxSplit(d.id)
    let w = d.was ? sxW(d.was) : null
    if (w && w.watched) { widOf.set(d.id, w.id); continue }
    if (w) {
      if (sxIdOf(w) !== d.id) { w.folder = folder; w.name = nm; w.sync = nm === w.title && w.file !== nm }
    } else {
      w = { id: 'new:' + (++x.seq), folder, file: nm, title: nm, name: nm, watched: false }
      x.W.push(w)
    }
    widOf.set(d.id, w.id)
    x.IT.set(w.id, d.items.map((it) => {
      const sum = it.from.map(lineOf).reduce((a, b) => ({ lines: a.lines + b.lines, names: a.names + b.names }), { lines: 0, names: 0 })
      const write = it.from.length > 1 || it.from.some((z) => (uses.get(z.doc + '\n' + z.h) || 0) > 1)
      return { h: it.h, from: it.from.map((z) => ({ doc: z.doc, h: z.h })), ...sum, ...(write ? { text: '', need: true, ...(it.part ? { part: it.part } : {}) } : {}) }
    }))
  }
  x.empty = new Set((plan.empty || []).filter((id) => sxW(id) && sxO(id)))
  x.names = (plan.names || []).filter((nm) => widOf.has(nm.doc)).map((nm) => ({ coord: nm.coord, wid: widOf.get(nm.doc), h: nm.h }))
  x.ipick = new Set(); x.isel = null
  const after = sxDiff().length + sxItemDiff().length
  return after || (after !== before ? 1 : 0)
}
// 글이 필요한 항목(구조안이 놓은 합치기 · 나누기) — 출처가 같은 나누기 목표는 한 번에
function sxNeedGroups() {
  const x = S.sx, groups = []
  if (!x || !x.IT) return groups
  for (const d of x.W) for (const it of sxItems(d.id)) {
    if (!it.need || String(it.text || '').trim()) continue
    const key = it.from.map((z) => z.doc + '\n' + z.h).join('|')
    let g = it.from.length === 1 ? groups.find((y) => y.key === key) : null
    if (!g) groups.push((g = { key, sources: it.from.map((z) => ({ doc: z.doc, h: z.h })), items: [] }))
    g.items.push({ wid: d.id, h: it.h, part: it.part || '' })
  }
  return groups
}
async function sxCjWrite() {
  const x = S.sx
  if (!x || sxHold()) return
  const k = x.k, gs = sxNeedGroups()
  if (!gs.length) return
  const c = { k, state: 'run', t0: Date.now(), wr: { i: 0, m: gs.length }, n: (S.sxc && S.sxc.n) || 0, why: '' }
  S.sxc = c; render()
  const done = { ok: 0, fail: [], values: 0 }
  for (const g of gs) {
    if (S.sxc !== c || c.state !== 'run') return
    c.wr.i++
    try {
      const r = await postJSON(shapeUrl(k, 'write'), { sources: g.sources, targets: g.items.map((t) => ({ doc: sxIdOf(sxW(t.wid)), h: t.h, ...(t.part ? { part: t.part } : {}) })) })
      c.job = r.job
      const end = await sxCjPoll(k, r.job, () => S.sxc === c && c.state === 'run', (t) => { c.queued = t.state === 'queued'; c.old = !!t.old })
      if (!end) return
      const texts = (end.result && end.result.texts) || end.texts || []
      for (const t of g.items) { const it = sxItems(t.wid).find((z) => z.h === t.h); const tx = texts.find((y) => y.h === t.h); if (it && tx) it.text = tx.content }
      if (end.state === 'done') { done.ok += g.items.length; done.values += (end.result.values || []).length } else done.fail.push(`${g.items.map((t) => t.h).join(' · ')}: ${end.why || '짓지 못했다'}`)
    } catch (e) { done.fail.push(`${g.items.map((t) => t.h).join(' · ')}: ${e.message}`) }
  }
  if (S.sxc === c) Object.assign(c, { state: 'done', wr: null, wrDone: done })
  render()
}
async function sxCjStop(c, job) {
  if (!c) return
  const was = c.state
  c.state = 'cancel'
  render()
  if (was === 'run' && job) { try { await postJSON(`/api/k/${encodeURIComponent(c.k || S.sx.k)}/shape/job/${job}/stop`, {}) } catch (e) { toastErr(e) } }
}
// 창(합치기 · 나누기)의 [Claude 짓기] — 출처는 그 항목들의 지금 자리 · 목표는 창의 문서 · 머리
async function sxwClaude() {
  const w = S.sxw, x = S.sx
  if (!w || w.t === 'move' || (w.cj && w.cj.state === 'run')) return
  const its = (w.t === 'merge' ? w.srcs : [w.src]).map((z) => sxItems(z.wid).find((it) => it.h === z.h)).filter(Boolean)
  const sources = []
  for (const it of its) for (const z of it.from) if (!sources.some((y) => y.doc === z.doc && y.h === z.h)) sources.push({ doc: z.doc, h: z.h })
  const rows = w.t === 'merge' ? [{ to: w.to, h: w.h, text: '' }] : w.rows
  const bad = rows.map((r) => sxHeadBad(String(r.h || '').trim())).find(Boolean)
  if (bad) { w.err = bad; render(); return }
  w.err = ''
  const targets = rows.map((r, i) => ({ doc: sxIdOf(sxW(r.to)), h: String(r.h).trim(), ...(w.t === 'split' && i && r.text && r.text.length <= 500 ? { part: r.text } : {}) }))
  const c = { state: 'run', t0: Date.now() }
  w.cj = c; render()
  try {
    const r = await postJSON(shapeUrl(x.k, 'write'), { sources, targets })
    c.job = r.job
    const end = await sxCjPoll(x.k, r.job, () => S.sxw === w && w.cj === c && c.state === 'run', (t) => { c.queued = t.state === 'queued'; c.old = !!t.old })
    if (!end) return
    const texts = (end.result && end.result.texts) || end.texts || []
    const put = (i, h) => { const tx = texts.find((y) => y.h === h) || texts[i]; return tx ? tx.content : null }
    if (w.t === 'merge') { const v = put(0, targets[0].h); if (v != null) w.text = v } else w.rows.forEach((r, i) => { const v = put(i, targets[i].h); if (v != null) r.text = v })
    Object.assign(c, end.state === 'done' ? { state: 'done', values: end.result.values || [] } : { state: end.state === 'cancelled' ? 'cancel' : 'fail', why: end.why, stepFail: end.stepFail || null })
  } catch (e) { Object.assign(c, { state: 'fail', why: e.message }) } finally { if (S.sxw === w) render() }
}

// ───────────── 주인 줄(지식관리자 · Claude 에 보내지 않음) ─────────────
// 「이 지식의 사람」 화면은 걷었다 — 주인 바꾸기 · 자리(지식관리자)는 지식 카드 ⋯ › 권한에서(accHtml) · 정리 설정은 S13 에 걷었다
const ownerOf = (k) => need('owner:' + k, `/api/k/${encodeURIComponent(k)}/owner`)
const peopleOf = () => need('people', '/api/people')
async function setOwnerRow(k, patch) {
  try {
    await postJSON(`/api/k/${encodeURIComponent(k)}/owner`, patch)
    delete S.cache['owner:' + k]
    S.menu = null
    await reloadKns()
    render()
  } catch (e) { toastErr(e) }
}

// ───────────── 들어오기 전 — 들어가기 · 처음 들어오기 링크 · 첫 설정 ─────────────
// 서버는 비밀번호를 받지 않는다 — 여기서 전처리(prehash)한 값을 보낸다.
function gateView() {
  // 개인 프로그램 — 들어가기(아이디 · 비밀번호)가 없다. 한 번용 주소로만 들어온다
  if (S.me.mode === 'pc' && S.me.anon) return { crumb: '개인 프로그램', main: viewPcGate() }
  if (S.gate === 'first' || S.gate === 'done') return { crumb: '처음', main: viewFirst() }
  if (S.gate === 'setup') return { crumb: '처음', main: viewSetup() }
  return { crumb: '들어가기', main: viewLogin() }
}
const gateErr = () => (S.gateErr ? formErr(S.gateErr, 'loginErr') : '')
// 개인 화면 — 들어온 적 없는 브라우저 · 지난 주소. 화면은 개인 프로그램이 연 한 번용 주소로만 들어온다
function viewPcGate() {
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb" data-t="pcGate">
  <div class="mk">${svg('lock')}</div><div class="pt" style="margin-bottom:var(--sp-5)"><div class="big">개인 화면을 연다</div>${tipb('gate.pc', '개인 화면을 연다')}</div>
  ${S.onceErr ? `<div class="callout gray" data-t="onceErr">${esc(S.onceErr)}</div>` : ''}
  <p><b>시작 메뉴 › kmd</b> 를 누른다. 꺼져 있으면 켜고 이 화면을 새로 연다.</p>
  <p class="small muted">터미널이면 <span class="mono">kmd open</span> · 꾸러미를 손으로 풀어 쓰면 그 폴더의 <span class="mono">kmd.cmd open</span> · 한 번 들어온 브라우저는 쓰는 동안 30일 이어진다</p>
  <div class="links">팀 kmd 는 팀 서버 주소에서 아이디 · 비밀번호로 들어간다 · <a href="/manual" target="_blank" rel="noopener" data-t="pcGateManual">설명서</a></div>
 </div></div></div></div>`
}
function viewLogin() {
  const legacy = S.legacyOpen
  const form = legacy
    ? `<form data-f="legacy" autocomplete="off">
  <div class="field"><div class="lbrow"><label for="lgTok">예전 열쇠</label>${tipb('gate.legacy', '예전 열쇠')}</div><input class="inp mono" id="lgTok" type="password" autocomplete="off" data-focus></div>
  ${gateErr()}<button class="btn pri" type="submit" data-t="legacyBtn">다음</button></form>`
    : `<form data-f="login" autocomplete="on">
  <div class="field"><label for="lgId">아이디</label><input class="inp" id="lgId" name="username" autocomplete="username" value="${esc(S.gateUser || '')}" data-focus></div>
  <div class="field"><label for="lgPw">비밀번호</label><input class="inp" id="lgPw"${invAttr(S.gateErr, 'loginErr')} type="password" name="password" autocomplete="current-password"></div>
  ${gateErr()}<button class="btn pri" type="submit" data-t="loginBtn">들어가기</button></form>`
  const old = S.me.legacy && !legacy ? ` <button type="button" class="lk" data-a="legacyOpen" data-t="legacyOpen">예전 열쇠로 들어가기</button>` : legacy ? ` <button type="button" class="lk" data-a="legacyClose">아이디 · 비밀번호로</button>` : ''
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb">
  <div class="mk">${svg('user')}</div><div class="pt" style="margin-bottom:var(--sp-7)"><div class="big">팀 kmd 에 들어간다</div>${tipb('gate.login', '팀 kmd 에 들어간다')}</div>
  ${form}
  <div class="links">잊었거나 막혔으면 ${S.me && S.me.help ? esc(S.me.help) : '총괄 관리자에게'}: 새 링크를 보내 주거나 잠김을 풀어 준다${old}</div>
 </div></div></div></div>`
}
function viewFirst() {
  if (S.gate === 'done')
    return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb" data-t="firstDone">
  <div class="mk">${svg('check')}</div><div class="pt" style="margin-bottom:var(--sp-5)"><div class="big">✓ 정했다. 들어왔다.</div>${tipb('gate.done', '정했다')}</div>
  <p>개인 프로그램 설치: <button type="button" class="lk" data-a="copyInstall" data-t="copyInstall">한 줄 복사</button><br><span class="muted small">10분 동안 한 번만 · 남에게 주지 않는다</span></p>
  <div class="links"><button type="button" class="btn pri" data-a="gateHome" data-t="gateHome">모든 지식으로</button></div>
 </div></div></div></div>`
  const who = S.gateUser
  // 쓴 링크 · 지난 링크 — 서버는 둘을 가르지 않는다. 들어와 있으면 그대로 이어 쓰고, 아니면 비밀번호로 들어가거나 새 링크
  if (!who && !S.me.anon) return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb"><div class="big">${S.gateReset ? '비밀번호 다시 정하기' : '처음 들어오기'}</div><div class="callout gray" data-t="firstGone">이 링크는 쓸 수 없다(이미 썼거나 지났다). 지금 ${esc(S.me.user)}로 들어와 있다 · 다른 사람에게 줄 링크면 관리자가 새로 만든다</div><div class="links"><button type="button" class="lk" data-a="gateHome" data-t="gateHome">지식 목록 ›</button></div></div></div></div></div>`
  if (!who) return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb"><div class="big">처음 들어오기</div><div class="callout gray" data-t="firstGone">이 링크는 이미 썼거나 24시간이 지났다. 비밀번호를 정했으면 들어가고, 아니면 관리자에게 새 링크를 부탁한다</div><div class="links"><button type="button" class="lk" data-a="gateLogin">들어가기 ›</button></div></div></div></div></div>`
  const other = !S.me.anon && S.me.user !== who ? `<div class="callout gray" data-t="firstOther">지금 ${esc(S.me.user)}로 들어와 있다. 정하면 ${esc(who)}로 바뀐다</div>` : ''
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb">
  <div class="mk">${svg('lock')}</div><div class="pt" style="margin-bottom:var(--sp-7)"><div class="big">${esc(who)}의 비밀번호를 정한다</div>${tipb(S.gateReset ? 'gate.reset' : 'gate.first', '비밀번호를 정한다')}</div>${other}
  <form data-f="first" autocomplete="on">
  <div class="field"><label for="fsId">아이디</label><input class="inp" id="fsId" name="username" autocomplete="username" value="${esc(who)}" readonly></div>
  <div class="field"><label for="fsPw">비밀번호(10자 이상)</label><input class="inp" id="fsPw" type="password" name="new-password" autocomplete="new-password" data-focus></div>
  ${gateErr()}<button class="btn pri" type="submit" data-t="firstBtn">정하기</button></form>
 </div></div></div></div>`
}
function viewSetup() {
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb">
  <div class="mk">${svg('shield')}</div><div class="pt" style="margin-bottom:var(--sp-7)"><div class="big">팀 kmd 의 관리자를 만든다</div>${tipb('gate.setup', '관리자를 만든다')}</div>
  <form data-f="setup" autocomplete="on">
  <div class="field"><label for="suId">관리자 아이디</label><input class="inp" id="suId" name="username" autocomplete="username" data-focus></div>
  <div class="field"><label for="suPw">비밀번호(10자 이상)</label><input class="inp" id="suPw" type="password" name="new-password" autocomplete="new-password"></div>
  ${gateErr()}<button class="btn pri" type="submit" data-t="setupBtn">관리자 만들기</button></form>
  <details class="more"><summary>자세히</summary><div class="in">Claude · DB · GitLab 의 열쇠는 이 화면에서 받지 않는다. 서버에서 한 번 넣어 둔다. 들어오면 사람마다 「처음 들어오기 링크」 를 만들어 메신저로 전하면 끝: 비밀번호는 그 사람이 정한다.</div></details>
 </div></div></div></div>`
}
async function postJSON(p, body) {
  // 일을 거는 요청일 수 있다 — 곧 「지금 하는 일」 을 다시 읽는다(가져오기 · 넣기가 도는 동안 점이 바로 깜빡이게)
  //   그 일은 서버가 조금 뒤에 세우기도 한다(파일 넣기 → 들이기 일감) — 30초 동안은 일이 없어도 3초마다 본다(15초를 기다리면 짧은 일은 점에 보이지 않고 끝난다 · 188 시험 T12)
  if (S.me && !anon()) { clearTimeout(busyTimer); busyTimer = setTimeout(loadBusy, 500); busyHot = Date.now() + 30000 }
  const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).catch(() => { throw Object.assign(new Error('서버에 닿지 않는다'), { code: 'E_REACH' }) })
  const j = await r.json().catch(() => ({}))
  // 관리자 일 — 비밀번호 한 번 더(15분). 확인되면 같은 요청을 한 번 더 보낸다 · 그만두면 E_CANCEL
  if (!r.ok && j.error === 'E_SUDO' && p !== '/api/sudo') { await askSudo(); return postJSON(p, body) }
  // 들어온 것이 끝났다(12시간 쉼 · 7일) — 쓰던 글은 그대로 두고 그 자리에서 다시 들어간 뒤 같은 요청을 다시
  if (r.status === 401 && canRelogin() && !['/login', '/api/sudo', '/first', '/setup', '/once'].includes(p)) { await askLogin(); return postJSON(p, body) }
  if (!r.ok) throw Object.assign(new Error(j.message || '서버에 닿지 않는다'), { code: j.error, need: j.need || null, details: j.details || null })
  return j
}
const canRelogin = () => isTeam() && !!S.me && !S.me.anon && !S.gate
let loginWait = null
function askLogin() {
  if (!loginWait) loginWait = new Promise((ok, no) => { S.sudo = { ok, no, err: null, busy: false, login: true }; S._focus = 'sudoPw'; render() }).finally(() => { loginWait = null })
  return loginWait
}
let sudoWait = null
function askSudo() {
  if (!sudoWait) sudoWait = new Promise((ok, no) => { S.sudo = { ok, no, err: null, busy: false }; S._focus = 'sudoPw'; render() }).finally(() => { sudoWait = null })
  return sudoWait
}
// 바깥 누름으로는 닫지 않는다(잘못 한 번 누르면 나가지거나 하던 일이 그만두어진다) — × · 취소 · Esc 로만
function sudoHtml() {
  const v = S.sudo
  return `<div class="scrim fix"${v.busy ? ' data-busy="1"' : ''}><div class="modal w420" data-t="sudoWin"><div class="mh">${v.login ? `다시 들어가기: ${esc(S.me.user)}` : '비밀번호 한 번 더: 총괄 관리자 확인'}<button type="button" class="x" data-a="sudoCancel" title="닫기" aria-label="닫기">×</button></div><div class="mb"><p class="small muted mt0">${v.login ? '들어온 것이 끝났다(12시간 쉬었거나 · 7일이 지났거나 · 다른 곳에서 「모두 나가기」 를 했거나 · 비밀번호를 다시 정했다). 쓰던 글은 그대로 있다 · 비밀번호가 맞지 않으면 관리자가 새 링크를 보냈거나 떠남으로 했을 수 있다: 받은 링크로 다시 정하거나 관리자에게 묻는다' : '총괄 관리자 일은 15분마다 비밀번호를 한 번 더 넣는다. 확인되면 하던 일을 이어서 한다'}</p><input class="inp wfull" type="password" id="sudoPw" data-t="sudoPw" aria-label="비밀번호" autocomplete="current-password">${v.err ? `<div class="callout danger" style="margin-top:var(--sp-5)">${sayErr(v.err)}<i></i><span>${esc(v.err)}</span></div>` : ''}</div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="sudoCancel" data-t="sudoCancel">취소</button><button type="button" class="btn pri" data-a="sudoOk" data-t="sudoOk"${v.busy ? ' disabled' : ''}>${v.busy ? '확인하는 중…' : '확인'}</button></span></div></div></div>`
}
async function sudoOk() {
  const v = S.sudo
  if (!v || v.busy) return
  const pw = ($('#sudoPw') || {}).value || '' // 다시 그리기 전에 읽는다(그리면 칸이 새로 선다)
  v.busy = true; v.err = null; render()
  try {
    if (v.login) await postJSON('/login', { user: S.me.user, pw: prehash(S.me.user, pw) })
    else await postJSON('/api/sudo', { pw: prehash(S.me.user, pw) })
    S.sudo = null
    render()
    v.ok()
  } catch (e) { v.busy = false; v.err = e.code === 'E_AUTH' ? '비밀번호가 맞지 않는다. 다시 본다' : e.message; S._focus = 'sudoPw'; render() }
}
function sudoCancel() { const v = S.sudo; if (!v || v.busy) return; S.sudo = null; if (v.login) { S.me = { ...S.me, anon: true } } render(); v.no(Object.assign(new Error(v.login ? '들어오지 않았다' : '그만두었다'), { code: 'E_CANCEL' })) }
// 화면 밖에서 복사 — http 화면은 navigator.clipboard 가 없을 수 있다
function copyText(t) {
  try {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t)
  } catch {}
  const ta = document.createElement('textarea')
  ta.value = t
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } catch {}
  ta.remove()
}
// team — 에이전트 설치 · 팀: 고른 팀 지식을 설치 한 줄에 싣는다(붙여 넣은 작업 폴더가 그 지식에 붙는다)
async function copyInstall(team) {
  try {
    const r = await postJSON('/api/device/ticket', team && S.agKn ? { kn: S.agKn } : {})
    const line = /Win/i.test(navigator.platform || navigator.userAgent) ? r.line : r.sh
    copyText(line)
    S.lastInstall = line
    S.lastInstallVer = r.pcVer || null
    toast('설치 한 줄을 복사했다. 10분 동안 한 번만 · PowerShell 에 붙여 넣는다')
  } catch (e) { toastErr(e) }
  render()
}
async function afterLogin(notice) {
  S.gate = S.gate === 'done' ? 'done' : null
  S.gateErr = null
  S.legacyOpen = false
  const keep = /^#\//.test(location.hash) ? location.hash : ''
  if (location.pathname !== '/' || (location.hash && !keep)) history.replaceState(null, '', '/' + keep)
  await loadAll()
  if (notice) toast(esc(notice), 9000)
}
async function submitGate(kind) {
  // 도는 중이면 단추를 막고 「… 중」(두 번 누름 막기) — 비밀번호 전처리가 무거워 한 번 그린 뒤에 시작한다
  const btn = document.querySelector(`form[data-f="${kind}"] button[type=submit]`)
  if (btn && btn.disabled) return
  const label = btn ? btn.textContent : ''
  if (btn) {
    btn.disabled = true
    btn.textContent = { login: '들어가는 중…', first: '정하는 중…', setup: '만드는 중…' }[kind] || '여는 중…'
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  }
  S.gateErr = null
  const v = (id) => ($('#' + id) ? $('#' + id).value : '')
  try {
    if (kind === 'login') {
      const user = v('lgId').trim()
      if (!user || !v('lgPw')) throw new Error('아이디나 비밀번호를 확인하세요. 여러 번 틀리면 잠시 막힌다') // 서버(core/auth.js FAIL)와 같은 말
      S.gateUser = user
      const r = await postJSON('/login', { user, pw: prehash(user, v('lgPw')) })
      await afterLogin(r.notice)
    } else if (kind === 'legacy') {
      const r = await postJSON('/login', { token: v('lgTok').trim() })
      S.gate = 'first'
      S.gateCode = r.code
      S.gateUser = r.user
      S.legacyOpen = false
      render()
    } else if (kind === 'first') {
      const pw = v('fsPw')
      if (pw.length < 10) throw new Error('10자 이상: 회사 메일 · 윈도 비밀번호와 다르게')
      await postJSON('/first', { code: S.gateCode, pw: prehash(S.gateUser, pw) })
      S.gate = 'done'
      await afterLogin()
    } else if (kind === 'setup') {
      const user = v('suId').trim()
      const pw = v('suPw')
      if (pw.length < 10) throw new Error('10자 이상: 회사 메일 · 윈도 비밀번호와 다르게')
      await postJSON('/setup', { code: S.gateCode, name: user, pw: prehash(user, pw) })
      S.gate = null
      await afterLogin()
    }
  } catch (e) {
    S.gateErr = e.message
    render()
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label }
  }
}
document.addEventListener('submit', (ev) => {
  const f = ev.target.dataset && ev.target.dataset.f
  if (!f) return
  ev.preventDefault()
  submitGate(f)
})

// ── 자료 가져오기(목업 M15) ──
const nowHm = () => { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
const EVERY_T = { hourly: '1시간마다', weekly: '매주 월', change: '바뀔 때만', manual: '손으로만' }
function everyTxt(e) { e = String(e || 'hourly'); return e.startsWith('daily ') ? '매일 ' + e.slice(6) : EVERY_T[e] || e }
function nextTxt(e, last) {
  e = String(e || 'hourly')
  const d = new Date(), m = d.getHours() * 60 + d.getMinutes()
  if (e === 'hourly') { const t = last ? new Date(Date.parse(last) + 3600e3) : null; return t && t > d ? pad2(t.getHours()) + ':' + pad2(t.getMinutes()) : '곧' }
  if (e.startsWith('daily ')) { const [h, mi] = e.slice(6).split(':').map(Number); return (h * 60 + mi > m ? '오늘 ' : '내일 ') + e.slice(6) }
  if (e === 'weekly') return '다음 월요일'
  if (e === 'change') return '바뀌면 바로'
  return '-'
}
// 가져올 곳
const sourcesOf = () => need('sources', '/api/sources')
const dropSrcs = () => { delete S.cache.sources }
async function fetchSrcs() {
  const v = await getJSON('/api/sources').catch((e) => { console.warn('가져올 곳을 읽지 못했다', e); return null })
  if (v) S.cache.sources = v
  return v
}
// 가져오기(옛 자료 가져오기)는 무엇을 만드나로 두 영역 — 문서로 들이기(파일 · 폴더 → 문서 · 한 번) · 지켜보며 맞추기(때마다 바뀐 것만).
// 지켜보며 맞추기의 더하기는 유형마다 칸이 다르다 — 코드 폴더(경로) · git 저장소(주소 · 자격) · DB(호스트 · 포트 · DB · 스키마 · 계정 · 비밀번호).
// 나가는 자격(git 토큰 · DB 비밀번호)은 이 PC 화면만 받는다 — 팀 화면은 받지 않고 셸 한 줄과 「있음」 만(v0.6 정정 ③).
// 유형 — 사람이 가르는 대로 문서 · 소스 코드(git — 묶음 이력으로) · DB. 파일을 팀으로 나르는 길은 없다 — 지식은 「보내기」 로
const sfTypes = () => [['docs', '문서 폴더'], ['git', '소스 코드(git)'], ['db', 'DB']]
const SF_RULES = {
  db: [['dbtables', '테이블 정의', '테이블마다 컬럼 · 형 · 길이 · 키 표']],
}
for (const r of SF_RULES.db) TIPS['sf.rule.' + r[0]] = [r[2], '']
const SF_DOC = { deps: '라이브러리', tables: '코드표', dbtables: '테이블 정의', docs: '' }
function sfState() {
  if (!S.sf) {
    const k = S.route.kn && S.route.kn !== '*' && KN(S.route.kn) ? S.route.kn : (S.kns[0] || {}).id
    S.sf = { type: 'docs', kn: k, rule: 'docs', every: 'hourly', port: '5432', schema: 'public' }
  }
  return S.sf
}
// 넣을 곳 — 쓰기 자리 이상만(읽기 자리 지식에 넣으면 일이 줄에 선 뒤 403 으로 진다 · 권한 모델)
//   넣을 곳은 옆 메뉴에서 고른 지식(메뉴 개편 N5 · 화면 안 지식 고르기 impPick 은 걷었다)
function impTarget() {
  const k = defaultKn()
  if (k && KN(k)) return canWrite(k) ? { kn: k, label: KN(k).name } : { kn: null, none: true, label: '이 지식에 쓰기 자리가 없다' }
  if (isTeam()) return { kn: null, none: true, label: '쓰기 자리가 있는 지식이 없다' } // 팀 화면은 받은편지함을 세우지 않는다
  return { kn: null, make: true, label: '넣을 지식이 없다' } // 받은편지함을 저절로 세우지 않는다(관리 설계 11-1 · [+ 새 지식] 으로)
}
const KIND_T = { docs: '문서 폴더', folder: '코드 폴더(예전)', git: '소스 코드 · git', db: 'DB · 읽기만', pc: '이 PC 폴더(예전)' }
const KIND_I = { docs: 'doc', folder: 'doc', git: 'sync', db: 'server', pc: 'pair' }
const isCode = (s) => s.kind === 'git' && !(s.rules && s.rules.length)
const srcId = (s) => s.kn + '|' + s.name
// 마지막으로 바뀐 것 — 바뀐 파일 · 표 · 묶음 수
function srcChange(s) {
  const lc = (s.state || {}).lastChange
  return lc && lc.commits != null ? `새 묶음 ${lc.commits} · 기록 ${lc.records} · ${whenTxt(lc.at)}` : lc ? `바뀐 파일 ${lc.files}${lc.removed ? '(지움 ' + lc.removed + ')' : ''} · ${lc.recs != null ? '기록 ' + lc.recs : lc.docs != null ? '문서 ' + lc.docs : '표 ' + lc.tables} · ${whenTxt(lc.at)}` : ''
}
// 지금 도는 중 — 이 화면에서 누른 [지금 가져오기] 이거나, 뒤에서(시계 · 실시간 감시) 도는 것(「지금 하는 일」 과 같은 값)
const srcRunning = (s) => S.srcRun[srcId(s)] === 'run' || ((S.busy && S.busy.items) || []).some((x) => x.kind === 'source' && x.kn === s.kn && x.name === s.name)
// 상태 칩 하나 — 도는 중 · 다시 맞추는 중 · 멈춤 · 못 가져옴 · 그대로 · 바뀜
function srcChip(s) {
  const st = s.state || {}, rs = s.resync
  if (srcRunning(s)) return '<span class="chip c-pend" data-t="srcRun">가져오는 중…</span>'
  if (rs && rs.state === 'running') return `<span class="chip c-pend" data-t="resyncRun">다시 맞추는 중 ${rs.done || 0} / ${rs.total || '…'}</span>`
  if (rs && rs.state === 'paused') return '<span class="chip c-warn" data-t="resyncPaused">다시 맞추기 끊김</span>'
  if (st.stopped) return '<span class="chip c-warn">멈춤: 크게 바뀜</span>'
  if (st.failures) return `<span class="chip c-danger" title="${esc(st.lastNote || '')}">못 가져옴</span>`
  if (!st.checkedAt) return '<span class="chip c-mute">아직</span>'
  return `<span class="chip ${/바뀐|새 묶음 [1-9]/.test(st.lastNote || '') ? 'c-acc' : 'c-mute'}" title="${esc(st.lastNote || '')}">${esc(String(st.lastNote || '그대로').split(' · ')[0])}</span>`
}
function srcRow(s, can) {
  const id = srcId(s), st = s.state || {}, run = S.srcRun[id]
  const ev = String(s.every || 'hourly'), live = s.watch === 'live'
  const into = isCode(s) ? '코드 바뀜 기록' : (s.rules && s.rules[0] && s.rules[0].into && s.rules[0].into.doc) || ''
  const sub = s.kind === 'pc' ? '이 PC 폴더(예전): 걷은 기능 · 쉰다' : `${KIND_T[s.kind] || s.kind} · ${s.at || ''}`
  const msg = run && run !== 'run' ? `<small data-t="srcOk">${esc(run)}</small>` : ''
  const going = srcRunning(s)
  const fetch = s.kind === 'pc' || !admKn(s.kn) ? '' : `<button class="btn sm" data-a="fetchSrc" data-id="${esc(id)}" data-t="fetchBtn"${going ? ' disabled' : ''}>${going ? '가져오는 중…' : '지금 가져오기'}</button>`
  return `<div class="srow" data-a="srcOpen" data-id="${esc(id)}" data-t="srcRow" data-name="${esc(s.name)}"><span class="si">${svg(KIND_I[s.kind] || 'doc')}</span><span class="sn"><b>${esc(s.name)}</b><small>${esc(sub)}</small></span><span class="sc">${esc(s.knName)} › ${esc(into)}<small data-t="every">${live ? '<b data-t="live">실시간</b> · 그 밖에 ' + esc(everyTxt(ev)) : esc(everyTxt(ev))} · 마지막 ${st.checkedAt ? esc(whenTxt(st.checkedAt)) : '-'}</small>${srcChange(s) ? `<small data-t="srcLast">마지막 바뀜 ${esc(srcChange(s))}</small>` : ''}${msg}</span><span class="ss">${srcChip(s)}</span><span class="sa">${can ? fetch : ''}</span></div>`
}
// 가져올 곳 자세히 — 보고 · 고치고 · 지운다(요구 v0.2 R4)
function srcOf(id) { const v = sourcesOf(); return v && !v.error ? v.items.find((s) => srcId(s) === id) || null : null }
function srcOpen(id) {
  const s = srcOf(id)
  if (!s) return
  const ev = String(s.every || 'hourly'), db = (() => { try { const u = new URL(s.at); return { host: u.hostname, port: u.port || '5432', database: decodeURIComponent(u.pathname.slice(1)), user: decodeURIComponent(u.username), schema: u.searchParams.get('schema') || 'public' } } catch { return {} } })()
  S.se = { id, at: s.kind === 'db' ? '' : s.at || '', doc: (s.rules && s.rules[0] && s.rules[0].into && s.rules[0].into.doc) || '', every: ev.startsWith('daily ') ? 'daily' : ev, at2: ev.startsWith('daily ') ? ev.slice(6) : '06:00', meaning: !!s.meaning, kn: s.kn, ...db, password: '', gitUser: '', gitToken: '', msg: null, busy: false, del: false }
  render()
}
const seFld = (label, f, v, ph, opt = {}) => `<div class="field"><label for="se-${f}">${label}</label><input class="inp${opt.mono ? ' mono' : ''}" id="se-${f}" data-in="se" data-f="${f}" value="${esc(v || '')}" placeholder="${esc(ph || '')}" autocomplete="${opt.pw ? 'new-password' : 'off'}"${opt.pw ? ' type="password"' : ''}${opt.ro ? ' readonly' : ''}>${opt.hint ? `<div class="hint">${opt.hint}</div>` : ''}</div>`
function srcModalHtml() {
  const e = S.se, s = srcOf(e.id)
  if (!s) return ''
  const v = sourcesOf(), can = v && !v.error ? v.can : false, team = isTeam(), st = s.state || {}, id = e.id
  const ro = !can
  const evSel = `<div class="field"><div class="lbrow"><label for="se-every">언제</label>${tipb(s.kind === 'docs' ? 'src.whenDocs' : 'src.when', '언제')}</div><div class="row"><select class="inp u-f1" id="se-every" data-se="every"${ro ? ' disabled' : ''}>${[['hourly', '1시간마다'], ['daily', '매일'], ['weekly', '매주 월'], ['change', '바뀔 때'], ['manual', '손으로만']].map(([x, l]) => `<option value="${x}"${e.every === x ? ' selected' : ''}>${l}</option>`).join('')}</select>${e.every === 'daily' ? `<input class="inp mono" type="time" id="se-at2" aria-label="매일 가져올 시각" data-in="se" data-f="at2" value="${esc(e.at2)}" style="width:min(120px,100%)"${ro ? ' disabled' : ''}>` : ''}</div></div>`
  let where = ''
  if (s.kind === 'db') where = `<div class="fgrid">${seFld('호스트', 'host', e.host, 'db.team.local', { mono: 1, ro })}${seFld('포트', 'port', e.port, '5432', { mono: 1, ro })}${seFld('DB 이름', 'database', e.database, '', { mono: 1, ro })}${seFld('스키마', 'schema', e.schema, 'public', { mono: 1, ro })}${seFld('계정', 'user', e.user, '', { mono: 1, ro })}${team ? `<div class="field"><label>비밀번호</label><div class="hint" data-t="credLine">화면으로 받지 않는다. 서버에서 <code>kmd secret set ${esc(s.secret.name)}</code> · ${s.secret.has ? '있음' : '없음'}</div></div>` : seFld('비밀번호', 'password', e.password, s.secret && s.secret.has ? '그대로(바꿀 때만 쓴다)' : '이 PC 의 자격 저장소에만', { pw: 1, ro })}</div>`
  else where = seFld(s.kind === 'git' ? 'git 주소 · 저장소 폴더' : '문서 폴더 경로', 'at', e.at, '', { mono: 1, ro }) + (s.kind === 'git' && !team ? `<div class="fgrid">${seFld('계정', 'gitUser', e.gitUser, s.secret && s.secret.has ? '그대로' : '들어가야 하는 저장소면', { ro })}${seFld('읽기 열쇠', 'gitToken', e.gitToken, s.secret && s.secret.has ? '그대로(바꿀 때만 쓴다)' : '읽기 권한 열쇠', { pw: 1, ro })}</div>` : '')
  // 넣을 지식 › 문서 — 지식을 바꾸면 옛 지식에서 걷고 새 지식으로 처음부터 다시 가져온다
  const knSel = `<select class="inp u-f1" id="se-kn" data-se="kn" data-t="seKn"${ro ? ' disabled' : ''}>${S.kns.map((k) => `<option value="${esc(k.id)}"${k.id === e.kn ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select>`
  const moved = e.kn !== s.kn ? '<div class="hint"><b>다른 지식으로 옮기면 처음부터 다시 가져온다</b></div>' : e.doc != null && e.doc !== (s.doc || '') ? '<div class="hint" data-t="seDocMoved"><b>이름을 바꾸면 처음부터 다시 가져온다</b></div>' : ''
  const into = isCode(s)
    ? `<div class="field"><div class="lbrow"><label for="se-kn">넣을 지식</label>${tipb('src.intoCode', '넣을 지식')}</div><div class="row">${knSel}</div>${moved}</div>`
    : `<div class="field"><div class="lbrow"><label for="se-kn">넣을 지식 › ${s.kind === 'docs' ? '폴더' : '문서'}</label>${tipb(s.kind === 'docs' ? 'src.intoDocs' : 'src.intoDb', '넣을 지식')}</div><div class="row">${knSel}<input class="inp u-f1" id="se-doc" aria-label="넣을 문서 · 폴더 이름" data-in="se" data-f="doc" data-t="seDoc" value="${esc(e.doc || '')}" autocomplete="off"${ro ? ' readonly' : ''}></div>${moved}</div>`
  const mean = s.kind === 'git' ? `<div class="field"><label for="seMeaningSw">뜻 갱신</label><div class="row"><button class="sw${e.meaning ? ' on' : ''}" id="seMeaningSw" role="switch" aria-checked="${e.meaning ? 'true' : 'false'}" aria-label="뜻 갱신" data-a="seMeaning" data-t="seMeaning"${ro ? ' disabled' : ''}></button><span class="small muted">바뀐 코드로 걸린 항목 글도 맞춘다. Claude 로${s.meaningBlocked ? ' · 이 지식은 Claude 에 보내지 않아 쉰다' : ''}</span></div></div>` : ''
  const stat = `<div class="kv" style="margin-bottom:var(--sp-7)" data-t="seState"><span>유형</span><span>${esc(KIND_T[s.kind] || s.kind)} · ${esc(String(s.since || ''))} 부터${s.by ? ' · ' + esc(s.by) : ''}</span><span>상태</span><span>${srcChip(s)} <small>${esc(st.lastNote || '')}</small></span><span>마지막 확인</span><span>${st.checkedAt ? esc(whenTxt(st.checkedAt)) : '-'}</span><span>다음</span><span>${s.watch === 'live' ? '바뀌면 바로 · ' + esc(nextTxt(s.every, st.checkedAt)) : esc(nextTxt(s.every, st.checkedAt))}</span>${srcChange(s) ? `<span>마지막 바뀜</span><span data-t="lastChange">${esc(srcChange(s))}</span>` : ''}</div>`
  const msg = e.msg ? `<div class="callout ${e.msg.cls || ''}" data-t="seMsg"><i></i><span>${e.msg.t}</span></div>` : ''
  const rs = s.resync, run = S.srcRun[id]
  const foot = e.del
    ? `<span class="l t-danger">「${esc(s.name)}」 을 지운다. 들어온 문서 · 기록은 그대로 둔다</span><span class="acts"><button class="btn ghost" data-a="seDelNo">취소</button><button class="btn danger" data-a="seDelOk" data-t="seDelOk"${e.busy ? ' disabled' : ''}>지우기</button></span>`
    : `<span class="acts" style="margin-left:0">${can ? `<button class="btn ghost t-danger" data-a="seDel" data-t="seDel">지우기</button>` : ''}</span><span class="acts">${s.kind !== 'pc' && admKn(s.kn) ? `<button class="btn" data-a="fetchSrc" data-id="${esc(id)}" data-t="seFetch"${run === 'run' ? ' disabled' : ''}>${run === 'run' ? '가져오는 중…' : '지금 가져오기'}</button>` : ''}${can && !isCode(s) ? `<button class="btn" data-a="resyncSrc" data-id="${esc(id)}" data-t="resyncBtn" title="모든 파일을 다시 읽어 맞춘다. 오래 걸릴 수 있다 · 쓰는 것은 다른 것뿐"${rs && rs.state === 'running' ? ' disabled' : ''}>전체 다시 맞추기</button>` : ''}${can ? `<button class="btn pri" data-a="seSave" data-t="seSave"${e.busy ? ' disabled' : ''}>${e.busy ? '고치는 중…' : '고친 것 저장'}</button>` : ''}</span>`
  return `<div class="scrim fix" data-a="seClose" data-self="1"><div class="modal w560" data-t="srcModal"><div class="mh">${svg(KIND_I[s.kind] || 'doc')} ${esc(s.name)} <small>가져올 곳</small><button class="x" data-a="seClose" title="닫기">×</button></div><div class="mb">${msg}${stat}${where}${into}${evSel}${mean}${!can ? '<div class="hint">고치기 · 지우기는 관리자가 한다</div>' : ''}</div><div class="mf">${foot}</div></div></div>`
}
async function seSave() {
  const e = S.se, s = srcOf(e.id)
  if (!s || e.busy) return
  const body = { name: s.name, every: e.every === 'daily' ? 'daily ' + (e.at2 || '06:00') : e.every }
  if (s.kind === 'db') body.db = { host: e.host, port: Number(e.port) || 5432, database: e.database, schema: e.schema, user: e.user, ...(e.password ? { password: e.password } : {}) }
  else if (e.at.trim()) body.at = e.at.trim()
  if (!isCode(s)) body.doc = e.doc
  if (s.kind === 'git') { body.meaning = !!e.meaning; if (e.gitUser || e.gitToken) body.cred = { user: e.gitUser, token: e.gitToken } }
  if (e.kn && e.kn !== s.kn) {
    const to = (S.kns.find((k) => k.id === e.kn) || {}).name || e.kn
    if (!await ask1('다른 지식으로 옮기기', '옮기기', false, `${s.name} 을 「${to}」 지식으로 옮긴다. 처음부터 다시 가져온다.\n\n계속할까?`)) return
    body.kn = e.kn
    const c = await ask({ t: '옛 사본 문서', d: `「${s.knName}」 에 들어와 있던 사본 문서를 어떻게 할까? 남기면 내 문서가 되어 고칠 수 있다`, btns: [['drop', '사본도 지우기', 'danger'], ['keep', '사본은 남기기', 'pri']] })
    if (!c) return
    body.copies = c
  }
  e.busy = true; e.msg = { cls: 'gray', t: '<b>고치는 중…</b>' }; render()
  try {
    const r = await postJSON(`/api/k/${encodeURIComponent(s.kn)}/sources/edit`, body)
    const st = r.run && r.run[0]
    e.msg = { t: `<b>${r.moved ? '옮겼다' : '고쳤다'}</b>${r.moved && r.copies ? ` · 옛 사본 ${r.copies} ${r.kept ? '은 내 문서로 남겼다' : '도 지웠다'}` : ''}${st ? (st.state === 'failed' ? ' · 그러나 못 가져왔다: ' + esc(st.why || '') : ' · 처음부터 다시 가져왔다') : ''}` }
    if (r.moved) { forgetKn(r.moved); e.id = r.moved + '|' + s.name; e.kn = r.moved }
    e.password = ''; e.gitToken = ''
    dropSrcs()
    forgetKn(s.kn)
  } catch (x) { e.msg = { cls: 'danger', t: esc(x.message) } }
  e.busy = false
  render()
}
async function seDelOk() {
  const e = S.se, s = srcOf(e.id)
  if (!s || e.busy) return
  const c = await ask({ t: `${s.name} 지우기`, d: `${s.name} 에서 들어온 사본 문서를 어떻게 할까? 남기면 내 문서가 되어 고칠 수 있다`, btns: [['drop', '사본도 지우기', 'danger'], ['keep', '사본은 남기기', 'pri']] })
  if (!c) return
  e.busy = true; render()
  try {
    const drop = c === 'drop'
    const r = await postJSON(`/api/k/${encodeURIComponent(s.kn)}/sources/remove`, { name: s.name, copies: drop ? 'drop' : 'keep' })
    S.se = null
    dropSrcs()
    forgetKn(s.kn)
    toast(`지웠다: ${esc(s.name)}${r.copies ? ` · 사본 ${r.copies} ${r.kept ? '은 내 문서로 남겼다' : '도 지웠다'}` : ''}`)
  } catch (x) { e.busy = false; e.msg = { cls: 'danger', t: esc(x.message) } }
  render()
}
const fld = (label, f, v, ph, opt = {}) => `<div class="field" style="margin:0"><label for="sf-${f}">${label}${opt.need ? '' : ' <span class="muted">(선택)</span>'}</label><input class="inp${opt.mono ? ' mono' : ''}" id="sf-${f}" data-in="sf" data-f="${f}" value="${esc(v || '')}" placeholder="${esc(ph || '')}" autocomplete="${opt.pw ? 'new-password' : 'off'}"${opt.pw ? ' type="password"' : ''} style="width:100%"></div>`
function sfForm(can) {
  const f = sfState(), team = isTeam()
  const types = sfTypes()
  if (!types.some((t) => t[0] === f.type)) f.type = 'docs'
  const ruleSet = f.type === 'db' ? SF_RULES.db : null
  if (ruleSet && !ruleSet.some((r) => r[0] === f.rule)) f.rule = ruleSet[0][0]
  if (f.type === 'docs') f.rule = 'docs'
  if (f.type === 'git') f.rule = ''
  const grid = (x) => `<div class="fgrid">${x}</div>`
  const full = (x) => `<div class="u-full">${x}</div>`
  const kns = S.kns
  const sel = (f2, opts, v) => `<select class="inp wfull" id="sf-${f2}" data-sf="${f2}">${opts.map(([val, l]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
  const res = S.sfMsg ? `<div class="callout ${S.sfMsg.cls || ''}" data-t="sfMsg" style="margin:var(--sp-6) 0 0"><i></i><span>${S.sfMsg.t}</span></div>` : ''
  const tabs = `<div class="tabs" data-t="sfTabs" style="margin:0 0 var(--sp-7)">${types.map(([v, l]) => `<span class="${f.type === v ? 'on' : ''}" data-a="sfType" data-v="${v}" data-t="sf-${v}">${l}</span>`).join('')}</div>`
  let where = ''
  if (f.type === 'docs') where = full(fld(team ? '서버의 문서 폴더 경로' : '문서 폴더 경로', 'at', f.at, team ? '예: /srv/share/운영문서: 서버에서 허락된 폴더 안만' : '예: D:\\공유\\운영문서', { need: 1, mono: 1 }))
  if (f.type === 'git') where = full(fld(team ? 'git 주소' : 'git 주소 · 이 PC 의 저장소 폴더', 'at', f.at, team ? '예: https://gitlab.team.local/dpms/dpms-api.git' : '예: https://gitlab.team.local/dpms/dpms-api.git · D:\\work\\dpms-api', { need: 1, mono: 1 })) + (team ? '<div class="small muted u-full" data-t="credNote">들어가야 하는 저장소면: 더한 뒤 서버에서 자격 한 줄(표의 그 줄에 보인다) · 화면으로는 받지 않는다</div>' : fld('계정', 'gitUser', f.gitUser, '사내 저장소에 들어가는 계정') + fld('읽기 열쇠', 'gitToken', f.gitToken, '읽기 권한 열쇠', { pw: 1 }))
  if (f.type === 'db') where = fld('호스트', 'host', f.host, '예: db.team.local', { need: 1, mono: 1 }) + fld('포트', 'port', f.port, '5432', { need: 1, mono: 1 }) + fld('DB 이름', 'database', f.database, '예: gdi', { need: 1, mono: 1 }) + fld('스키마', 'schema', f.schema, 'public', { mono: 1 }) + fld('계정', 'user', f.user, '예: kmd_read', { need: 1, mono: 1 }) + (team ? '<div class="small muted" data-t="credNote" style="align-self:end">비밀번호는 화면으로 받지 않는다. 더한 뒤 서버에서 한 줄(표의 그 줄에 보인다)</div>' : fld('비밀번호', 'password', f.password, '이 PC 의 자격 저장소에만', { need: 1, pw: 1 }))
  const docsLike = f.type === 'docs'
  const what = f.type === 'git' ? `<div class="field" style="margin:0" data-t="codeWhat"><div class="lbrow"><label>무엇을</label>${tipb('sf.whatCode', '무엇을')}</div><div class="small u-p4-0">묶음(지금부터) · 바뀐 코드는 Claude 로 간다</div></div>` : ruleSet ? `<div class="field" style="margin:0"><div class="lbrow"><label for="sf-rule">무엇을 채우나</label>${tipb('sf.rule.' + f.rule, '무엇을 채우나')}</div>${sel('rule', ruleSet.map((r) => [r[0], r[1]]), f.rule)}</div>` : `<div class="field" style="margin:0"><div class="lbrow"><label>무엇을</label>${tipb('sf.whatDocs', '무엇을')}</div><div class="small u-p4-0">문서: md · docx · pptx · xlsx · hwpx · hwp · pdf · 그림은 첨부로</div><div class="hint">들어온 문서는 원본이 주인이다(화면에서 고치지 않는다)</div></div>`
  const into = f.type === 'git' ? `<div class="field" style="margin:0"><div class="lbrow"><label for="sf-kn">넣을 지식</label>${tipb('sf.intoCode', '넣을 지식')}</div>${sel('kn', kns.map((k) => [k.id, k.name]), f.kn)}</div>` : `<div class="field" style="margin:0"><div class="lbrow"><label for="sf-kn">넣을 지식 › ${docsLike ? '출처 이름' : '문서'}</label>${tipb(docsLike ? 'sf.intoDocs' : 'sf.intoDb', '넣을 지식')}</div><div class="u-flex u-g3">${sel('kn', kns.map((k) => [k.id, k.name]), f.kn)}<input class="inp" id="sf-doc" aria-label="${docsLike ? '출처 이름' : '넣을 문서 이름'}" data-in="sf" data-f="doc" value="${esc(f.doc || '')}" placeholder="${esc(docsLike ? sfAutoName(f) || '폴더 이름' : SF_DOC[f.rule])}" style="width:45%"></div></div>`
  const paths = ''
  const when = `<div class="field" style="margin:0"><label for="sf-every">언제</label>${sel('every', [['hourly', '1시간마다'], ['daily 06:00', '매일 06:00'], ['weekly', '매주 월'], ['change', '바뀔 때(5분마다 보고)']], f.every)}</div>`
  const nm = fld('이름', 'name', f.name, sfAutoName(f) || '예: dpms-api 코드')
  const meaning = '' // 뜻 갱신 체크는 걷었다 — 소스 코드(git)는 묶음마다 기록이 그 일이다
  const dbNote = f.type === 'db' ? '<div class="callout gray" data-t="dbNote" style="margin:var(--sp-6) 0 0"><i></i><span><b>테이블마다 정의 표를 채우고 바뀐 테이블만 고친다</b>: 읽기 전용으로만 붙어 테이블 목록(테이블 · 칸 · 형 · 키 · 설명)만 읽는다 · 행은 읽지 않는다 · 어떤 계정이든 세션을 읽기 전용으로 열어 쓰지 않는다 · [연결 확인] 으로 먼저 붙어 본다</span></div>' : ''
  const probe = f.type === 'db' ? '<button class="btn" data-a="sfCheck" data-t="sfCheck">연결 확인</button>' : can && f.type === 'git' ? '<button class="btn" data-a="sfProbe" data-t="sfProbe">살펴보기</button>' : ''
  const go = can ? `<button class="btn pri" data-a="sfAdd" data-t="sfAdd">더하기</button>` : '<button class="btn pri" data-a="sfAsk" data-t="sfAsk">관리자에게 부탁</button>'
  return `<div class="scrim fix" data-a="sfClose" data-self="1"><div class="modal w760" data-t="sfCard"><div class="mh">${can ? '가져올 곳 더하기' : '가져올 곳 부탁'}<button class="x" data-a="sfClose" title="닫기">×</button></div>
   <div class="mb">${tabs}
   ${where ? grid(where) + '<div class="hsep"></div>' : ''}${grid(what + into + paths + when + nm + meaning)}${dbNote}${res}</div>
   <div class="mf"><span class="acts">${probe}${go}</span></div></div></div>`
}
function sfModal() { const v = sourcesOf(); return sfForm(v && !v.error ? v.can : !isTeam() || S.me.admin) }
function sfAutoName(f) {
  const at = String(f.at || '').trim()
  if (f.type === 'db') return f.database ? `${f.database} DB` : ''
  if (!at) return ''
  const base = at.replace(/\.git$/i, '').replace(/[\\/]+$/, '').split(/[\\/:]/).filter(Boolean).pop()
  return f.type === 'docs' ? base : base + ' 코드'
}
// ── 가져오기 — 일 줄(서버 일 줄 /api/queue) ──
//   들여오는 일은 모두 서버의 일 줄에 선다 — 파일 들이기 · 여러 파일 묶음 · 가져오기 · 기록을 문서에 넣기(PC) · 팀 들이기 일감(다시 들이기 · 정정 · 다듬기).
//   일은 늘 네 단계(수집 › 검토 › 짓기 › 넣기 · S-D33) · 잠깐 멈춤은 단계 사이에서 · 그만두기는 바로 · 다시는 그 단계부터.
//   탭 셋 — 일 줄(도는 중 · 멈춤/확인/못함 · 기다림 + 자세히) · 가져올 곳(지켜보며 맞추기) · 끝난 일(찾기 · 거르기 · 쪽)
const runActive = (r) => r && (r.state === 'wait' || r.state === 'run')
const STG = ['수집', '검토', '짓기', '넣기']
const STG_S = ['수집', '검토', '짓기', '넣기']
const STG_LAST = STG.length - 1
const STG_SUB = {
  file: [['받기', '글로 바꾸기'], ['같은 파일 확인', '원본 첨부'], ['기록 쓰기', '기록 정리'], ['지식 둘러보기 · 항목 맞추기', '항목에 넣기 · 장부에 올리기']],
  // 팀 화면 파일 넣기(S8) — 파일마다 팀 일꾼이 기록 + 문서를 한 번에 짓고 저장 한 번
  fileTeam: [['받기', '글로 바꾸기'], ['같은 파일 확인', '원본 첨부 고르기'], ['팀 일꾼이 기록 + 문서를 짓는다', '검사에 걸리면 고쳐 쓴다'], ['저장 한 번 · 이력에 남는다', '못 넘으면 규칙 길로']],
  docs: [['폴더 읽기', '바뀐 파일 찾기'], ['크게 바뀜 문턱(지운 파일)'], ['파일마다 기록 · 글로 바꾸기'], ['팀 일꾼이 자리를 골라 문서에 · 장부 적기']],
  git: [['저장소에서 받기'], ['새 묶음 찾기', '합친 묶음 거르기'], ['묶음마다 코드 바뀜 기록'], ['기준 묶음 옮기기 · 들이기에 넘김']],
  db: [['읽기 전용으로 붙기', '테이블 목록 읽기'], ['지난 것과 견주기', '크게 바뀜 문턱'], ['바뀐 테이블 기록'], ['테이블 정의 표 채우기']],
  group: [['화면이 나눠 보내기'], ['같은 파일 확인'], ['파일마다 기록'], ['파일마다 들이기']],
  groupTeam: [['화면이 나눠 보내기'], ['같은 파일 확인'], ['파일마다 팀 일꾼에게'], ['파일마다 저장 한 번']],
  kmd: [['-'], ['-'], ['-'], ['기록을 항목 · 문서에 넣기']],
}
const ORG_T = { file: '파일 들이기', group: '여러 파일', docs: '문서 폴더', git: '소스 코드 · git', db: 'DB', kmd: 'kmd', person: '사람' }
const ORG_I = { file: 'doc', group: 'clip', docs: 'doc', git: 'sync', db: 'server', kmd: 'list' }
const QAUTO_T = { src: '가져올 곳' }
const autoTxt = (a) => QAUTO_T[a] || everyTxt(a)
const knName = (k) => (KN(k) || {}).name || k || ''
const durTxt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 3600 ? `${Math.floor(s / 60)}:${pad2(s % 60)}` : `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분` }
// 예전 터미널 줄(단계 표지가 없는 것)만 줄로 어림한다 — 둘러보기 · 항목 맞추기(옛 줄은 이름 맞추기) · 찾기 · 항목 읽기 = 검토 … (지금 줄은 서버가 s 를 단다)
function stageLines(lines) {
  let s = 0, saved = false
  return lines.map((l) => {
    if (l.s != null) return l
    const x = String(l.x || '')
    if (l.k === 'tool' && /^저장/.test(x)) { s = Math.max(s, 2); saved = true }
    else if (saved && (l.k === 'ok' || l.k === 'cost')) s = 3
    else if (/규칙으로 넣는다/.test(x)) s = 3
    else if ((l.k === 'tool' && /^(지식 둘러보기|항목 맞추기|이름 맞추기|찾기|항목 읽기)/.test(x)) || /에 들인다(?: —|:) 기록|기록을 정리했다/.test(x)) s = Math.max(s, 1)
    return { ...l, s }
  })
}
// 모든 일 — 서버 일 줄 + 아직 서버에 닿지 않은 올리기(화면이 보내는 중)
function impJobs() {
  const v = S.cache.queue
  const out = (v && !v.error ? v.items : []).map((x) => ({ ...x, origin: x.kind === 'group' ? 'group' : x.origin || 'file', known: !!x.stages, at: x.startedAt || x.at, end: x.endedAt, run: x.kind === 'file' ? x : null }))
  for (const x of S.imports) {
    if (x.run && !x.many) continue // Claude Code 일이 맡았다 — 그 일로
    if (x.gid && v && !v.error && v.items.some((y) => y.id === x.gid)) continue // 서버의 묶음 일로
    const bad = x.cls === 'bad'
    out.push({ id: 'i:' + x.id, imp: x, kind: 'local', origin: x.many ? 'group' : 'file', title: x.title, kn: x.kn, state: x.fin ? (bad ? 'fail' : 'done') : 'run', fin: !!x.fin, stage: 0, known: false, at: x.at, end: x.end, msg: x.msg })
  }
  return out
}
const isRun = (j) => j.state === 'run' || j.state === 'pausing'
const IMP_G = [['run', '도는 중', isRun], ['attn', '멈춤 · 크게 바뀜 · 못함', (j) => ['pause', 'check', 'fail'].includes(j.state)], ['wait', '기다림', (j) => j.state === 'wait']]
const IMP_F = [['all', '전체', () => true], ['run', '도는 중', IMP_G[0][2]], ['wait', '기다림', IMP_G[2][2]], ['attn', '멈춤 · 확인', IMP_G[1][2]]]
const stCls = (j, i) => {
  if (!j.known) return j.state === 'done' ? 'done' : ''
  const s = (j.stages[i] || {}).state
  return { done: 'done', run: j.state === 'pausing' ? 'pause' : 'run', pause: 'pause', check: 'check', fail: 'fail', cancel: 'fail', skip: 'skip' }[s] || ''
}
function miniHtml(j) {
  const lab = j.state === 'wait' ? (j.stage ? `${STG[j.stage]}부터` : '차례 기다림') : j.fin ? { done: '끝남', rule: '끝남', cancel: '그만둠', fail: '못함' }[j.state] || '끝남' : j.known ? STG[Math.min(j.stage, STG_LAST)] : '-'
  return `<span class="qmini" data-t="qmini" data-stage="${j.known ? j.stage : ''}"><span class="mini">${STG.map((_, i) => `<i class="${stCls(j, i)}"></i>`).join('')}</span><small>${lab}</small></span>`
}
// 일마다 손잡이 — 상태대로(잠깐 멈춤은 단계 사이에서 · 이어서로 잇는다 · 그만두기는 바로 끝낸다 · 다시는 그 단계부터)
function impActs(j, small = true) {
  const sm = small ? ' sm' : ''
  const b = (act, t, cls = '') => `<button class="btn${sm}${cls}" data-a="qAct" data-v="${act}" data-id="${esc(j.id)}" data-t="q-${act}" title="${t}">${t}</button>`
  const o = []
  if (j.kind === 'local') { if (j.imp && j.imp.many && !j.fin && !j.imp.stop) o.push(`<button class="btn${sm}" data-a="impStop" data-v="${esc(j.imp.id)}" data-t="impStop">그만두기</button>`) }
  else if (j.kind === 'intake') { if (j.state === 'wait') o.push(b('cancel', '빼기', ' dz')) }
  else if (j.intake) { if (j.state === 'wait') o.push(b('cancel', '빼기', ' dz')); else if (j.state === 'run') o.push(b('cancel', '그만두기', ' dz')); else if (j.state === 'fail') o.push(b('cancel', '줄에서 빼기(기록은 남는다)', ' dz')) }
  else if (!j.fin) {
    if (j.state === 'run') o.push(b('pause', '잠깐 멈춤'), b('cancel', '그만두기', ' dz'))
    if (j.state === 'pausing') o.push(b('resume', '멈추지 않기'), b('cancel', '바로 그만두기', ' dz'))
    if (j.state === 'wait') o.push(b('top', '맨 앞으로'), b('pause', '잠깐 멈춤'), b('cancel', '빼기', ' dz'))
    if (j.state === 'pause') o.push(b('resume', '이어서'), b('cancel', '그만두기', ' dz'))
    if (j.state === 'check') o.push(b('force', '그대로 맞추기'), b('cancel', '이번은 건너뛰기', ' dz'))
    if (j.state === 'fail') o.push(...(j.retry ? [b('retry', '다시')] : []), b('cancel', '지우기', ' dz'))
  } else if ((j.state === 'cancel' || j.state === 'fail') && j.retry) o.push(b('retry', '다시'))
  if (j.kind === 'source' && !small) o.push(`<button class="btn${sm} ghost" data-a="srcOpenQ" data-k="${esc(j.kn)}" data-v="${esc(j.src || '')}">가져올 곳 자세히</button>`)
  if (j.docs && j.docs[0]) o.push(`<button class="btn${sm}" data-a="impGo" data-k="${esc(j.kn)}" data-d="${esc(j.docs[0])}" data-t="runGo">보기</button>`)
  if (j.imp && j.imp.go) o.push(`<button class="btn${sm}" data-a="impGo" data-k="${esc(j.imp.go.kn)}" data-d="${esc(j.imp.go.doc)}">보기</button>`)
  if (j.imp && j.imp.rec) o.push(`<button class="btn${sm}" data-a="openRec" data-k="${esc(j.imp.rec.kn)}" data-r="${esc(j.imp.rec.id)}" data-t="impRec">보기</button>`)
  return o.join('')
}
function subTxt(j) {
  const who = j.auto ? `<span class="auto">자동 · ${esc(autoTxt(j.auto))}</span>` : ''
  return `${ORG_T[j.origin] || j.origin}${who} → ${esc(knName(j.kn))}${!isRun(j) && j.msg ? ' · ' + esc(j.msg) : ''}`
}
function qrowHtml(j, n) {
  const el = isRun(j) && j.at ? durTxt(Date.now() - Date.parse(j.at)) : ''
  const drag = j.state === 'wait' && j.kind !== 'intake' && j.kind !== 'local'
  return `<div class="qrow${S.impSel === j.id ? ' sel' : ''}" data-a="impSel" data-id="${esc(j.id)}" data-t="qrow" data-state="${j.state}"${drag ? ` draggable="true" data-qdrag="${esc(j.id)}" title="끌어서 순서를 바꾼다"` : ''}><span class="ord">${drag ? '<i class="grip">⋮⋮</i>' : ''}${n || ''}</span><span class="ic o-${j.origin}">${svg(ORG_I[j.origin])}</span><span class="tx"><b>${esc(j.title)}</b><small>${j.rule ? `<span class="chip c-mute" data-t="qRule" title="${esc(j.rule)}">규칙 길</span> ` : ''}${subTxt(j)}</small></span>${miniHtml(j)}<span class="el">${el}</span><span class="ac">${impActs(j)}</span></div>`
}
function termHtml(id, fil = 'all') {
  const L = (S.runLines || {})[id]
  if (!L) return '<div class="term" data-t="term"><span class="sys">불러오는 중…</span></div>'
  const t = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }
  const mark = { tool: '▸ ', ok: '✓ ', err: '✗ ', sys: '· ', cost: '■ ', say: '' }
  const ls = stageLines(L.lines).filter((l) => fil === 'all' || String(l.s) === fil)
  return `<div class="term" data-t="term" data-run="${esc(id)}">${ls.map((l) => `<div class="${esc(l.k)}"><span class="tm">${t(l.t)}</span><span class="sg">[${STG_S[l.s] || '-'}]</span>${mark[l.k] || ''}${esc(l.x)}</div>`).join('') || `<span class="sys">${L.lines.length ? '이 단계의 줄이 없다' : '아직 줄이 없다. 차례를 기다린다'}</span>`}</div>`
}
const IMP_K = { doc: '문서', record: '기록', run: 'Claude 일', rule: '규칙 길', att: '첨부', same: '그대로', fail: '못 넣음', skip: '읽지 못하는 종류' }
const ST_T = { done: '끝남', run: '도는 중', pause: '멈춤', check: '크게 바뀜', fail: '못함', cancel: '그만둠', skip: '건너뜀', wait: '기다림' }
// 자세히 — 흐름 그림(네 단계 · 안의 걸음) · 안의 파일 · 터미널(단계로 거른다) · 만든 것
function impDetHtml(j) {
  if (!j) return '<div class="card det" data-t="impDet"><div class="none">왼쪽에서 일을 고른다. 단계 · 터미널 · 만든 것이 여기 보인다</div></div>'
  const sub = STG_SUB[j.kind === 'intake' ? 'kmd' : isTeam() && (j.origin === 'file' || j.origin === 'group') ? j.origin + 'Team' : j.origin] || STG_SUB.file
  const fil = S.impTfil || 'all'
  const flow = STG.map((nm, i) => {
    const c = stCls(j, i)
    const items = sub[i].map((x, k) => `<li class="${c === 'done' ? 'd' : c === 'skip' ? 's' : k ? '' : c === 'run' ? 'r' : c === 'fail' ? 'x' : c === 'pause' || c === 'check' ? 'p' : ''}">${esc(x)}</li>`).join('')
    const st = j.known ? (j.stages[i] || {}).state : ''
    return `${i ? `<span class="arr${stCls(j, i - 1) === 'done' ? ' done' : ''}">→</span>` : ''}<div class="st ${c}${fil === String(i) ? ' focus' : ''}" data-a="impStg" data-v="${i}" data-t="impStg" title="이 단계의 줄만 터미널에"><div class="n"><span>${i + 1}</span><span>${st === 'run' && j.state === 'pausing' ? '멈추는 중' : ST_T[st] || ''}</span></div><div class="nm">${nm}</div><ul>${items}</ul>${j.known && j.stages[i] && j.stages[i].at && j.stages[i].end ? `<div class="tt">${durTxt(Date.parse(j.stages[i].end) - Date.parse(j.stages[i].at))}</div>` : ''}</div>`
  }).join('')
  const why = j.state === 'check' ? `<div class="callout warn" data-t="whyCheck"><span><b>크게 바뀜</b>: ${esc(j.msg)} · [그대로 맞추기] 는 크게 바뀜 문턱을 넘어 쓴다 · [이번은 건너뛰기] 는 다음 정한 때에 다시 본다</span></div>`
    : j.state === 'fail' ? `<div class="callout danger"><span><b>못함: ${STG[Math.min(j.stage, STG_LAST)]}</b> · ${esc(j.msg)}${j.retry ? ' · [다시] 는 이 단계부터' : ''}</span></div>`
    : j.state === 'pause' ? `<div class="callout warn"><span><b>멈춤</b>: ${esc(j.msg)}</span></div>`
    : j.state === 'pausing' ? `<div class="callout warn"><span><b>멈추는 중</b>: 지금 단계(「${STG[Math.min(j.stage, STG_LAST)]}」)를 마치면 선다 · 바로 끝내려면 [바로 그만두기]</span></div>`
    : j.rule ? `<div class="callout gray" data-t="whyRule"><span><b>규칙 길</b>: ${esc(j.rule)}</span></div>`
    : !j.known ? '<div class="callout gray"><span>단계를 알 수 없다. 화면이 보내는 중이거나 줄이 남지 않은 일이다</span></div>' : ''
  const rows = j.kind === 'group' ? j.rows || [] : j.imp && j.imp.many ? j.imp.rows : null
  const kids = rows ? `<div class="sec"><div class="sh">안의 파일 ${j.total || (j.imp && j.imp.total) || rows.length}<span class="r">${j.kind === 'group' ? `보냄 ${j.sent}/${j.total}` : `${j.imp.done}/${j.imp.total}`}</span></div><div class="kids" data-t="impFiles">${[...rows].sort((a, b) => (a.kind === 'fail' || a.kind === 'skip' ? 0 : 1) - (b.kind === 'fail' || b.kind === 'skip' ? 0 : 1)).map((r) => `<div${r.run ? ` data-a="impSel" data-id="${esc(r.run)}"` : ''}><span class="chip ${r.kind === 'fail' || r.kind === 'skip' ? 'c-warn' : 'c-mute'}">${IMP_K[r.kind] || r.kind}</span><span class="mono">${esc(r.name)}</span><small>${esc(r.msg || '')}</small></div>`).join('') || '<div class="muted">아직 보낸 파일이 없다</div>'}</div></div>` : ''
  const live = j.kind !== 'local' && j.kind !== 'intake'
  const term = live
    ? `<div class="sec"><div class="sh">터미널 <small>${j.kind === 'file' ? (isTeam() ? '팀 일꾼 · kmd 가 하는 일' : 'Claude Code · kmd 가 하는 일') : 'kmd 가 하는 일'}</small><span class="tfil">${[['all', '전체'], ...STG_S.map((s, i) => [String(i), s])].map(([v, l]) => `<span class="${fil === v ? 'on' : ''}" data-a="impTfil" data-v="${v}">${l}</span>`).join('')}</span></div>${termHtml(j.id, fil)}</div>`
    : `<div class="sec"><div class="sh">하는 일 <small>${j.kind === 'intake' ? '팀 일꾼이 한다' : '화면이 올린다'}</small></div><div class="term"><div class="sys">· ${esc(j.msg || '-')}</div></div></div>`
  const made = []
  for (const d of j.docs || []) made.push(`<li><span class="muted small">문서</span><button type="button" class="lk" data-a="impGo" data-k="${esc(j.kn)}" data-d="${esc(d)}">${esc(d)}</button></li>`)
  if (j.rec) made.push(`<li><span class="muted small">기록</span><button type="button" class="lk" data-a="openRec" data-k="${esc(j.kn)}" data-r="${esc(j.rec)}">${esc(j.title)}</button></li>`)
  const x = j.imp
  if (x && x.go) made.push(`<li><span class="muted small">문서</span><button type="button" class="lk" data-a="impGo" data-k="${esc(x.go.kn)}" data-d="${esc(x.go.doc)}">${esc(x.go.doc)}</button></li>`)
  if (x && x.rec) made.push(`<li><span class="muted small">기록</span><button type="button" class="lk" data-a="openRec" data-k="${esc(x.rec.kn)}" data-r="${esc(x.rec.id)}">${esc(x.title)}</button></li>`)
  if (j.names) made.push(`<li><span class="muted small">장부</span><span>새 항목 ${j.names}</span></li>`)
  const took = j.at ? durTxt((j.end ? Date.parse(j.end) : Date.now()) - Date.parse(j.at)) : '-'
  const acts = impActs(j, false)
  return `<div class="card det" data-t="impDet" data-id="${esc(j.id)}">
   <div class="dh"><span class="ic o-${j.origin}">${svg(ORG_I[j.origin])}</span><div class="t"><b>${esc(j.title)}</b><small>${ORG_T[j.origin] || ''}${j.auto ? ' · 자동 ' + esc(autoTxt(j.auto)) : j.by && j.by !== 'kmd' ? ' · ' + esc(j.by) + ' 이 넣음' : ''} → ${esc(knName(j.kn))}</small></div>${impChip(j)}</div>
   ${acts ? `<div class="ctl">${acts}${isRun(j) ? tipb('job.ctl', '잠깐 멈춤 · 그만두기') : ''}</div>` : ''}
   <div class="sec"><dl class="meta"><dt>시작</dt><dd>${j.at ? esc(whenTxt(j.at)) : '-'}</dd><dt>걸린 시간</dt><dd>${took}</dd><dt>하는 것</dt><dd>${j.kind === 'file' ? 'Claude Code · kmd' : j.kind === 'intake' ? '팀 일꾼' : j.kind === 'local' ? '화면' : 'kmd'}</dd><dt>상태</dt><dd>${esc(j.msg || ST_T[j.state] || '-')}</dd></dl></div>
   <div class="sec"><div class="sh">흐름 <span class="r">단계를 누르면 그 단계의 줄만</span></div>${why}<div class="stflow">${flow}</div></div>
   ${kids}${term}
   ${made.length ? `<div class="sec"><div class="sh">만든 것</div><ul class="res">${made.join('')}</ul></div>` : ''}
  </div>`
}
function impChip(j) {
  if (j.state === 'rule') return chipOf('ok', '규칙으로 넣음')
  // 승인 저장 지식의 무인 일(저장 승인 P6) — 규칙 길로 들어갔다(까닭은 툴팁)
  if (j.rule && j.state === 'done') return chipOf('ok', '규칙 길', ` data-t="qRule" title="${esc(j.rule)}"`)
  const m = { run: ['run', '도는 중'], pausing: ['stop', '멈추는 중'], wait: ['wait', '기다림'], pause: ['stop', '멈춤'], check: ['stop', '크게 바뀜'], fail: ['fail', '못함'], done: ['ok', '끝남'], cancel: ['rest', '그만둠'] }[j.state]
  return m ? chipOf(m[0], m[1]) : ''
}
// 고른 일 — 줄의 id · 「지금 하는 일」 에서 온 가져올 곳(src:지식|이름)
function impPicked(js, q) {
  const s = S.impSel || ''
  if (s.startsWith('src:')) {
    const [kn, name] = s.slice(4).split('|')
    const m = js.filter((j) => j.kind === 'source' && j.kn === kn && j.src === name)
    const j = m.find((x) => !x.fin) || m.sort((a, b) => String(b.end || '').localeCompare(String(a.end || '')))[0]
    if (j) S.impSel = j.id
    return j || null
  }
  return js.find((j) => j.id === s) || q.find(isRun) || q[0] || null
}
function impQueueHtml(js) {
  const v = S.cache.queue
  const q = js.filter((j) => !j.fin)
  const f = IMP_F.find((x) => x[0] === (S.impFil || 'all')) || IMP_F[0]
  let list = ''
  for (const [gk, gl, fn] of IMP_G) {
    const xs = q.filter((j) => fn(j) && f[2](j)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    if (xs.length) list += `<div class="qg">${gl} <small>${xs.length}</small>${gk === 'wait' ? '<span class="r">위에서부터 차례로 · 끌어서 순서를 바꾼다</span>' : ''}</div>` + xs.map((j, i) => qrowHtml(j, gk === 'wait' ? i + 1 : 0)).join('')
  }
  // 첫 일 줄을 받기 전 — 빈 줄로 깜빡이지 않게(이 화면에서 넣은 줄은 먼저 보인다)
  if (!list && !v && !S.queueErr) list = loadingHtml
  if (!list) list = `<div class="none" data-t="qEmpty">${q.length ? '이 갈래에 일이 없다' : '도는 일 없음'}</div>`
  const sel = impPicked(js, q)
  const can = v && !v.error && v.can
  const lane = (k, l) => { const x = (v && v.lanes && v.lanes[k]) || { cap: 1, busy: 0 }; return `<span class="lane" title="${l}: 한 번에 도는 수">${l} ${Array.from({ length: Math.min(x.cap, 4) }, (_, i) => `<i class="${i < x.busy ? 'on' : ''}"></i>`).join('')}${can ? `<select class="inp" data-t="cap-${k}" data-cap="${k}" aria-label="${l}: 동시에 도는 수">${[1, 2, 3, 4].map((n) => `<option${n === x.cap ? ' selected' : ''}>${n}</option>`).join('')}</select>` : ` ${x.cap}`}</span>` }
  const hold = v && v.hold
  const wk = v && v.worker
  const wkBand = wk && !wk.ok ? `<div class="callout warn" data-t="workerBand"><b>${wk.resting ? '팀 일꾼이 쉬고 있다' : '팀 일꾼이 일감을 받지 않는다'}</b>: 기다리는 들이기 ${wk.waiting}개는 일꾼이 돌아오면 이어서 짓는다 · ${wk.staleHours}시간을 넘게 기다리면 규칙 길로 넣는다 · ${S.me && S.me.admin ? `<button type="button" class="lk" data-a="openSet" data-v="server">설정 › 팀 일꾼 ›</button>` : '총괄 관리자에게 알린다'}</div>` : ''
  return `${wkBand}${S.queueErr ? `<div class="callout danger err" data-t="queueErr">${sayErr('도는 일을 읽지 못했다: ' + S.queueErr)}<b>도는 일을 읽지 못했다: ${esc(S.queueErr)}</b><button type="button" class="btn sm retry" data-a="queueRetry">다시 읽기</button></div>` : ''}${hold ? `<div class="callout warn hold" data-t="holdBand"><span><b>줄 멈춤</b>: 도는 일은 지금 단계를 마치고 서고, 기다리는 일은 시작하지 않는다 · 정한 때 · 실시간으로 오는 일도 줄에만 선다</span>${can ? '<button class="btn sm" data-a="qHold" data-v="0">줄 다시 돌리기</button>' : ''}</div>` : ''}
   <div class="qbar">${IMP_F.map(([k, l, fn]) => fbtn((S.impFil || 'all') === k, ` data-a="impFil" data-v="${k}" data-t="impFil-${k}"`, `${l} <b>${q.filter(fn).length}</b>`)).join('')}
    <span class="r">동시에 ${lane('claude', 'Claude')}${lane('fetch', '자동수집')}${can ? `<button class="btn sm" data-a="qHold" data-v="${hold ? 0 : 1}" data-t="qHold">${hold ? '줄 다시 돌리기' : '줄 멈춤'}</button>` : ''}</span></div>
   <div class="qwrap"><div class="qlist" data-t="queue">${list}</div>${impDetHtml(sel)}</div>`
}
// 끝난 일 — 찾기 · 갈래 · 결과로 거르고 20 줄씩
function impDoneList(js) {
  const q = norm(S.impQ || ''), o = S.impOrg || '', r = S.impRes || ''
  return js.filter((j) => j.fin && (!q || norm(j.title + ' ' + (j.msg || '') + ' ' + knName(j.kn)).includes(q)) && (!o || j.origin === o || (o === 'kmd' && j.kind === 'intake')) && (!r || j.state === r || (r === 'done' && j.state === 'rule')))
    .sort((a, b) => String(b.end || b.at || '').localeCompare(String(a.end || a.at || '')))
}
function impDoneRows(js) {
  const all = impDoneList(js), per = 20, pages = Math.max(1, Math.ceil(all.length / per))
  const pg = Math.min(S.impPage || 0, pages - 1)
  let last = '', rows = ''
  for (const j of all.slice(pg * per, pg * per + per)) {
    const t = j.end || j.at, day = t ? (isToday(t) ? '오늘' : whenTxt(t).split(' ')[0]) : '-'
    if (day !== last) { rows += `<tr class="day"><td colspan="5">${esc(day)}</td></tr>`; last = day }
    const open = !!(S.termOpen || {})[j.id] && j.kind !== 'local' && j.kind !== 'intake'
    const tr = j.imp ? ' data-t="impRow"' : j.kind === 'file' ? ` data-t="runRow" data-run="${esc(j.id)}"` : ` data-t="doneRow" data-kind="${esc(j.kind)}"`
    rows += `<tr${tr}><td class="m">${t ? esc(hhmmOf(t)) : ''}</td><td><span class="ic o-${j.origin}">${svg(ORG_I[j.origin])}</span> <b>${esc(j.title)}</b><small${j.imp ? ' data-t="impMsg"' : j.kind === 'file' ? ' data-t="runMsg"' : ''}>${subTxt(j)}${!j.imp && j.msg && isRun(j) ? ' · ' + esc(j.msg) : ''}</small></td><td>${miniHtml(j)}</td><td>${impChip(j)}</td><td class="acts">${impActs(j)}${j.kind !== 'local' && j.kind !== 'intake' && j.n ? `<button class="btn sm ghost" data-a="termToggle" data-id="${esc(j.id)}" data-t="termBtn">${open ? '터미널 닫기' : '터미널'}</button>` : ''}</td></tr>${open ? `<tr class="tr-term"><td></td><td colspan="4">${termHtml(j.id)}</td></tr>` : ''}`
  }
  if (!rows) rows = `<tr><td colspan="5" class="none">${js.some((j) => j.fin) ? '맞는 일이 없다' : '아직 끝난 일이 없다'}</td></tr>`
  const pager = pages > 1 ? `<div class="pager">${Array.from({ length: pages }, (_, i) => `<span class="${i === pg ? 'on' : ''}" data-a="impPage" data-v="${i}">${i + 1}</span>`).join('')}</div>` : ''
  return `<div class="tblwrap"><table class="done"><thead><tr><th style="width:min(56px,100%)">시각</th><th>일</th><th style="width:min(110px,100%)">단계</th><th style="width:min(96px,100%)">결과</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${pager}`
}
function impDoneHtml(js) {
  const sel = (id, v, opts) => `<select class="inp" id="${id}" aria-label="${id === 'impOrg' ? '갈래로 거르기' : '결과로 거르기'}" style="width:auto">${opts.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`
  return `<div class="qbar"><input class="inp" data-in="impQ" id="impQ" aria-label="끝난 일 찾기" value="${esc(S.impQ || '')}" placeholder="파일 · 제목 찾기" style="width:min(220px,100%)" autocomplete="off">${sel('impOrg', S.impOrg || '', [['', '모든 갈래'], ...Object.entries(ORG_T)])}${sel('impRes', S.impRes || '', [['', '모든 결과'], ['done', '끝남'], ['cancel', '그만둠'], ['fail', '못함']])}<span class="r">30일 동안 남는다(터미널 줄까지)</span></div>
   <div class="card" id="impDone" data-t="doneTable">${impDoneRows(js)}</div>`
}
// 자동수집 줄 — 고른 지식의 가져올 곳만(메뉴 개편 N5)
function impSrcHtml(srcs, v, can) {
  return `<div class="slist" data-t="srcTable">${!v ? loadingHtml : v.error ? errHtml(v) : srcs.length ? srcs.map((s) => srcRow(s, can)).join('') : `<div class="empty2" data-t="srcEmpty"><b>가져올 곳 없음</b></div>`}</div>`
}
// 가져올 곳 더하기 — 이 PC 프로그램 · 팀은 고른 지식의 지식관리자(총괄 관리자 포함) · 쓰기 자리는 부탁
const impCan = () => { const k = impTarget().kn; return !isTeam() || (!!k && admKn(k)) }
// 지식 하나의 관리 자리 — 지금 가져오기 · 고치기는 관리 자리만(서버도 막는다)
const admKn = (kn) => !isTeam() || !!S.me.admin || lvOf(KN(kn)) === 'admin'
// 진행 — 고른 지식의 일만 · 다른 지식의 앞 일은 수만(일 줄은 서버 하나 · 줄 멈춤 · 동시에 도는 수도 전체 값)
function impMine() {
  const all = impJobs(), k = impTarget().kn
  const js = k ? all.filter((j) => j.kn === k) : all
  const ahead = k ? all.filter((j) => j.kn !== k && !j.fin && (isRun(j) || j.state === 'wait')).length : 0
  return { all, js, ahead }
}
function impBodyHtml() {
  const { js } = impMine()
  return S.impTab === 'done' ? impDoneHtml(js) : impQueueHtml(js)
}
function paintJobs() {
  const box = document.getElementById('impBody')
  if (!box) return
  const a = document.activeElement
  if (a && box.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName)) return // 찾는 중 · 고르는 중 — 칸을 다시 그리지 않는다
  if (S.dragQ) return // 순서를 끄는 중
  // 터미널을 보던 자리 — 맨 아래였으면 새 줄을 따라간다
  const stick = {}
  for (const t of box.querySelectorAll('.term')) stick[t.dataset.run] = t.scrollHeight - t.scrollTop - t.clientHeight < 24 ? 'end' : t.scrollTop
  box.innerHTML = impBodyHtml()
  const th = box.parentNode.querySelector('[data-t=progHead]')
  if (th) th.outerHTML = progHeadHtml()
  for (const t of box.querySelectorAll('.term')) { const v = stick[t.dataset.run]; t.scrollTop = v === undefined || v === 'end' ? t.scrollHeight : v }
  a11yPass()
  flashSel()
}
// 일 줄 읽기 — 도는 일이 있으면 1초 · 없으면 8초마다(정한 때 · 실시간 일이 서면 보인다) · 가져오기 화면에서만
let runTimer = null
async function pollRuns() {
  clearTimeout(runTimer)
  if (!S.me || gated() || S.route.scr !== 'import' || document.hidden) return
  let busy = false
  try {
    const v = await getJSON('/api/queue')
    const was = new Map(((S.cache.queue && S.cache.queue.items) || []).map((x) => [x.id, x]))
    S.cache.queue = v
    // 고른 일 · 도는 일 · 펼친 터미널 — 줄을 이어 받는다
    S.termOpen ||= {}
    const want = new Set(v.items.filter((x) => !x.fin && x.n && x.kind !== 'intake' && (isRun(x) || x.id === S.impSel)).map((x) => x.id))
    if (S.impSel && v.items.some((x) => x.id === S.impSel && x.kind !== 'intake')) want.add(S.impSel)
    for (const id of Object.keys(S.termOpen)) if (S.termOpen[id]) want.add(id)
    for (const id of want) {
      const x = v.items.find((y) => y.id === id)
      if (!x) continue
      const L = ((S.runLines ||= {})[id] ||= { lines: [], n: 0 })
      if (L.n >= x.n && L.done) continue
      const g = await getJSON(`/api/queue/${id}?from=${L.n}`)
      L.lines.push(...g.lines)
      L.n = g.n
      L.done = !!g.fin
    }
    // 끝난 일이 있으면 그 지식의 나무 · 목록을 새로
    const ended = v.items.filter((x) => x.fin && was.get(x.id) && !was.get(x.id).fin)
    for (const kn of new Set(ended.map((x) => x.kn))) { forgetKn(kn); delete S.cache.history; await reloadKns() }
    if (ended.some((x) => x.kind === 'source')) { dropSrcs(); sourcesOf() }
    busy = v.items.some((x) => !x.fin && ['run', 'pausing', 'wait'].includes(x.state)) || S.imports.some((x) => !x.fin)
    S.queueErr = null
    paintJobs()
  } catch (e) {
    // 빈 줄로 보이지 않게 — 일 줄 위에 무엇이 안 됐는지 · 다시 읽기(8초 뒤에도 저절로 다시)
    S.queueErr = e.message
    paintJobs()
  }
  runTimer = setTimeout(pollRuns, busy ? 1000 : 8000)
}
async function qAct(id, act) {
  const j = impJobs().find((x) => x.id === id)
  if (!j) return
  if (act === 'cancel' && isRun(j) && !await ask1('이 일 그만두기', '그만두기', true, j.intake ? `「${j.title}」 을 그만둘까?\n\n팀 일꾼이 짓던 것은 넣지 않고 닫는다. 기록도 남기지 않는다 · 다시 넣으려면 파일을 다시 넣는다` : `「${j.title}」 을 그만둘까?\n\n지금 「${STG[Math.min(j.stage, STG_LAST)]}」 단계를 바로 끊고 일을 끝낸다. 이어서는 할 수 없다(잠깐 멈추려면 [잠깐 멈춤]) · 끝난 단계의 결과(남긴 기록)는 그대로 남는다`)) return
  if (act === 'force' && !await ask1('그대로 맞추기', '그대로 맞추기', true, `「${j.title}」 을 그대로 맞출까?\n\n${j.msg}\n\n크게 바뀜 문턱을 넘어 원본대로 쓴다. 쓴 것은 「이력」 에서 되돌릴 수 있다`)) return
  try {
    const r = await postJSON(`/api/queue/${encodeURIComponent(id)}/${act}`, {})
    toast({ pause: '지금 단계를 마치면 멈춘다', resume: '이어 간다', cancel: j.state === 'check' ? '건너뛰었다. 다음 정한 때에 다시 본다' : j.state === 'wait' ? '줄에서 뺐다' : r && r.state === 'pausing' ? '그만두는 중: 팀 일꾼이 지금 초안을 마치면 넣지 않고 닫는다' : '그만뒀다', retry: '다시: 그 단계부터 줄 뒤에 섰다', force: '그대로 맞춘다. 새 일로 섰다', top: '기다림 맨 앞으로' }[act] || '했다')
    if (r && r.again) S.impSel = `src:${j.kn}|${j.src || ''}`
  } catch (e) { toastErr(e) }
  pollRuns()
}
async function qMove(id, before) {
  try { await postJSON(`/api/queue/${encodeURIComponent(id)}/move`, { before }) } catch (e) { toastErr(e) }
  pollRuns()
}
// 진행 머리 — 「진행」 · 살펴볼 일 n(멈춤 · 크게 바뀜 · 못함) · 앞 일 n · 탭 도는 일 · 끝난 일(수기수집 · 자동수집 아래 같은 목록)
function progHeadHtml() {
  const { js, ahead } = impMine(), q = js.filter((j) => !j.fin)
  const attn = q.filter(IMP_G[1][2]).length
  return `<div data-t="progHead"><div class="prog-h"><h2 class="sh">진행</h2>${attn ? `<span class="chip c-warn" data-t="impAttn">살펴볼 일 ${attn}</span>` : ''}${ahead ? `<span class="small muted" data-t="impAhead">앞 일 ${ahead}</span>${tipb('imp.ahead', '앞 일')}` : ''}</div>${progTabsHtml(js, q)}</div>`
}
function progTabsHtml(js, q) {
  const tab = S.impTab === 'done' ? 'done' : 'queue'
  const tabs = [['queue', '도는 일', q.length], ['done', '끝난 일', js.filter((j) => j.fin).length]]
  return `<div class="tabs" data-t="impTabs" aria-label="진행">${tabs.map(([k, l, n]) => `<span class="${tab === k ? 'on' : ''}" data-a="impTab" data-v="${k}" data-t="impTab-${k}">${l} <em>${n}</em></span>`).join('')}</div>`
}
// 본문 머리 탭 — 수기수집 · 자동수집(메뉴 개편 7절 · 층 3 줄이 아니다)
const GEN_TABS = [['manual', '수기수집'], ['auto', '자동수집']]
function genTabsHtml(sub) {
  return `<div class="tabs" data-t="genTabs" aria-label="생성">${GEN_TABS.map(([k, l]) => `<span class="${sub === k ? 'on' : ''}" data-a="genTab" data-v="${k}" data-t="genTab-${k}">${l}</span>`).join('')}</div>`
}
// 가져올 곳 부탁(자동수집 머리 · 11절 15) — 고른 지식의 부탁만 · 총괄 관리자 · 그 지식의 지식관리자(서버가 지식관리자 제 지식만 거른다) · 더하기 · 거절
const requestsOf = () => need('requests', '/api/requests')
function reqHtml(k) {
  if (!isTeam() || !k || !admKn(k)) return ''
  const rs = requestsOf()
  const mine = Array.isArray(rs) ? rs.filter((r) => r.kn === k) : []
  if (!mine.length) return ''
  return `<div class="card" data-t="impReqs"><div class="ch">가져올 곳 부탁 <span class="chip c-pend">${mine.length}</span>${tipb('imp.req', '가져올 곳 부탁')}</div><ul class="plain pl">${mine.slice(0, 10).map((r) => `<li data-t="impReq"><span class="dot pu"></span><span class="tx"><b>「${esc(r.name)}」: ${esc(r.by)}</b><small>${esc(whenTxt(r.at))} · ${esc({ docs: '문서 폴더', git: '소스 코드', db: 'DB' }[r.kind] || r.kind || '')} · ${esc(r.every || '')} → ${esc((r.rules && r.rules[0] && r.rules[0].into && r.rules[0].into.doc) || '넣을 곳은 팀 일꾼이 고른다')}${r.at2 ? ' · ' + esc(r.at2) : ''}</small></span><button class="btn sm" data-a="admAddReq" data-id="${esc(r.id)}" data-t="impReqAdd">더하기</button><button class="btn sm ghost" data-a="admNoReq" data-id="${esc(r.id)}" data-t="impReqNo">거절</button></li>`).join('')}</ul></div>`
}
// 스위치 한 줄 — 저절로 하는 일(설정 값 · 사람마다) · 원본도 첨부(이 화면 값)
const swHtml = (on, label, attrs) => `<span class="swl"><button type="button" class="sw${on ? ' on' : ''}" aria-label="${esc(label)}" ${attrs}></button><span>${esc(label)}</span></span>`
function autoSw(key, label) {
  const st = settingsOf()
  if (!st || st.error || !st.auto || !(key in st.auto)) return ''
  return swHtml(!!st.auto[key], label, `data-a="toggleAuto" data-v="${key}" data-t="sw-${key}"`)
}
// 생성 › 수기수집 — [파일] [폴더] [글] · 한도 칩(늘) · 끌어다 놓는 판 · 스위치 · 빈 지식 한 줄 · 팀 한도 넘음 오류 + [에이전트 설치]
function genManualHtml(t, team) {
  if (t.none) return `<div class="empty2" data-t="impNone"><b>${esc(t.label)}</b></div>`
  const n = KN(t.kn)
  const lim = team ? `${TEAM_IMPORT_MAX} 파일 · 파일 하나 32MB` : '300 파일 · 200MB'
  const empty = n && Number(n.docs) === 0 ? `<div class="callout gray" data-t="impEmptyKn"><span>빈 지식이다 · 폴더째라면</span>${admKn(t.kn) ? '<button type="button" class="btn sm" data-a="seedGo" data-t="seedGo">기초 세우기</button>' : ''}</div>` : ''
  const many = team && S.impMany ? `<div class="callout danger" role="alert" data-t="impMany"><span>파일 ${S.impMany}개는 보내지 않았다 · 한 번에 ${TEAM_IMPORT_MAX}개까지 · 많으면 Claude Code 에서 대량 넣기</span><button type="button" class="btn sm" data-a="openSet" data-v="agent" data-t="impManyGo">에이전트 설치</button></div>` : ''
  const sws = [team ? swHtml(!!S.impAtt, '원본도 첨부', 'data-a="impAtt" data-t="impAtt"') : '', autoSw('file', '글로 바꾸기')].join('')
  return `<div class="gen-lim"><span class="chip c-mute" data-t="impLimit">${lim}</span>${tipb(team ? 'imp.filesTeam' : 'imp.files', '파일 한도')}</div>${empty}${many}
  <div class="drop" id="drop" data-t="drop"><div class="acts"><button type="button" class="btn pri" data-a="pickIn" data-v="fileIn" data-t="pickFile">파일</button><button type="button" class="btn" data-a="pickIn" data-v="dirIn" data-t="pickDir">폴더</button><button type="button" class="btn" data-a="pasteOpen" data-t="pasteOpen">글</button></div><div class="muted" data-t="dropNote">여기에 놓기</div><input type="file" multiple id="fileIn" aria-label="파일 고르기" data-t="fileIn" tabindex="-1"><input type="file" webkitdirectory directory multiple id="dirIn" aria-label="폴더 고르기" data-t="dirIn" tabindex="-1"></div>
  ${sws ? `<div class="gen-opts" data-t="genOpts">${sws}</div>` : ''}`
}
// 생성 › 자동수집 — 머리: 스위치 「자동수집」(개인) · [모두 수집] · [+ 더하기](폴더 · GIT · DB) / 쓰기 자리 [+ 부탁] · 부탁 카드 · 가져올 곳 줄
function genAutoActs(t, srcs) {
  if (t.none) return ''
  const can = impCan()
  if (S.menu === 'sfAdd') S._pop = { key: 'sfAdd', html: `<div data-t="sfAddMenu">${[['docs', '폴더'], ['git', 'GIT'], ['db', 'DB']].map(([v, l]) => `<div class="mi" data-a="sfOpen" data-v="${v}" data-t="sfAdd-${v}">${l}</div>`).join('')}</div>` }
  const live = srcs.filter((s) => s.kind !== 'pc')
  return `${!isTeam() && can ? autoSw('src', '자동수집') : ''}${can && live.length ? `<button type="button" class="btn" data-a="fetchAll" data-t="fetchAll"${S.fetchAll ? ' disabled' : ''}>${S.fetchAll ? `가져오는 중… ${S.fetchAll.n} / ${S.fetchAll.all}` : '모두 수집'}</button>` : ''}<button type="button" class="btn${can ? ' pri' : ''}" data-a="menu" data-m="sfAdd" data-t="sfOpen" aria-haspopup="menu" aria-expanded="${S.menu === 'sfAdd'}">${can ? '+ 더하기' : '+ 부탁'}</button>`
}
function viewImport() {
  const team = isTeam(), t = impTarget(), k = t.kn
  const sub = S.genTab === 'auto' ? 'auto' : 'manual'
  const v = sourcesOf(), srcs = v && !v.error ? v.items.filter((s) => s.kn === k) : []
  const acts = sub === 'auto' ? genAutoActs(t, srcs) : ''
  const head = `<div class="pg-h"><div class="pt"><div class="big">생성</div>${tipb(sub === 'auto' ? 'imp.auto' : 'imp', '생성')}</div>${acts ? `<span class="acts">${acts}</span>` : ''}</div>${genTabsHtml(sub)}`
  const body = sub === 'auto' ? (t.none ? genManualHtml(t, team) : `${reqHtml(k)}${impSrcHtml(srcs, v, impCan())}`) : genManualHtml(t, team)
  const prog = t.none ? '' : `<div class="genprog" data-t="prog">${progHeadHtml()}<div id="impBody">${impBodyHtml()}</div></div>`
  return { crumb: '생성 › ' + (sub === 'auto' ? '자동수집' : '수기수집'), main: `<div class="imp">${head}${body}${prog}</div>` }
}
// [글] — 붙여넣기 창(제목 · 글) · 파일 하나처럼 들인다
function pasteWinHtml() {
  const p = S.paste
  return `<div class="scrim fix" data-a="pasteClose" data-self="1"><div class="modal w560" role="dialog" aria-modal="true" aria-labelledby="pasteH" data-t="pasteWin"><div class="mh" id="pasteH">글<button type="button" class="x" data-a="pasteClose" title="닫기" aria-label="닫기">×</button></div><div class="mb"><div class="field" style="margin:0"><label for="pasteTitle">제목</label><input class="inp" id="pasteTitle" data-in="pasteT" data-t="pasteTitle" value="${esc(p.title || '')}" autocomplete="off" data-focus></div><div class="field" style="margin:var(--sp-5) 0 0"><label for="pasteTx">글</label><textarea class="inp" id="pasteTx" rows="8" data-in="pasteX" data-t="pasteTx">${esc(p.tx || '')}</textarea></div></div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="pasteClose">취소</button><button type="button" class="btn pri" data-a="pasteGo" data-t="pasteGo">넣기</button></span></div></div></div>`
}
// 전체 다시 맞추기 — 뒤에서 돈다 · 도는 동안 1초마다 진행을 다시 받는다
async function resyncSrc(id) {
  const [kn, name] = id.split('|')
  try {
    await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/resync`, { name })
    S.srcRun[id + '|rs'] = true
    toast('전체 다시 맞추기를 시작했다. 모든 파일을 다시 읽는다 · 쓰는 것은 다른 것뿐')
  } catch (e) { toastErr(e); return }
  const tick = async () => {
    if (document.hidden) return setTimeout(tick, 5000)
    dropSrcs()
    const v = await fetchSrcs()
    if (S.route.scr === 'import' && !typing() && !S.se && !S.sfOpen) render()
    const row = v && v.items.find((x) => x.kn === kn && x.name === name)
    if (row && row.resync && row.resync.state === 'running') setTimeout(tick, 1000)
    else { forgetKn(kn); loadStops() }
  }
  setTimeout(tick, 300)
}
async function fetchSrc(id) {
  const [kn, name] = id.split('|')
  S.srcRun[id] = 'run'
  render()
  try {
    const r = (await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/run`, { name }))[0] || {}
    // 그대로 — 실시간 감시가 먼저 들였을 수 있다: 마지막으로 들인 것은 줄의 「마지막 바뀜」 에
    S.srcRun[id] = r.commits != null && r.state !== 'failed' ? (r.commits ? `새 묶음 ${r.commits} · 코드 바뀜 기록 ${r.codeRecords} · ${nowHm()}` : `새 묶음 없음 · ${nowHm()}`) : r.state === 'changed' ? (r.recs != null ? `가져왔다. 기록 ${r.recs}${r.runs ? ' · Claude Code 가 자리를 골라 넣는 중' : ''} · ${nowHm()}` : `가져왔다. 바뀐 표 ${r.n} · ${nowHm()}`) : r.state === 'stopped' ? '멈췄다. 한꺼번에 크게 바뀌었다' : r.state === 'failed' ? '못 가져왔다: ' + (r.why || '') : r.state === 'waiting' ? r.why : `새로 바뀐 것 없음 · ${nowHm()}`
    if (r.state === 'changed') { forgetKn(kn); delete S.cache.history }
  } catch (e) { S.srcRun[id] = '못 가져왔다: ' + e.message }
  dropSrcs()
  loadStops()
  render()
}
// 칸 → 보낼 카드(검사는 화면에서 먼저 — 빈 칸이면 어느 칸인지 말한다)
function sfCard() {
  const f = sfState()
  const miss = (x, l) => { if (!String(x || '').trim()) throw new Error(`${l} 칸을 채운다`) }
  if (f.type === 'db') { miss(f.host, '호스트'); miss(f.database, 'DB 이름'); miss(f.user, '계정'); if (!isTeam() && !S.sfAsking) miss(f.password, '비밀번호') }
  else miss(f.at, f.type === 'git' ? 'git 주소' : '문서 폴더 경로')
  if (!f.kn) throw new Error('넣을 지식이 없다. 새 지식에서 먼저 세운다')
  const name = String(f.name || '').trim() || sfAutoName(f)
  const docsLike = f.type === 'docs'
  const doc = String(f.doc || '').trim() || (docsLike ? name : SF_DOC[f.rule])
  const card = { name, kind: f.type, every: f.every, rules: f.type === 'git' ? [] : [{ rule: docsLike ? 'docs' : f.rule, into: { doc } }] }
  if (f.type === 'db') card.db = { engine: 'postgres', host: f.host.trim(), port: Number(f.port) || 5432, database: f.database.trim(), schema: (f.schema || 'public').trim(), user: f.user.trim(), ...(isTeam() || !f.password ? {} : { password: f.password }) }
  else card.at = f.at.trim()
  if (f.type === 'git' && !isTeam() && (f.gitUser || f.gitToken)) card.cred = { user: f.gitUser || '', token: f.gitToken || '' }
  return card
}
async function sfAdd(ask) {
  const f = sfState()
  let card
  S.sfAsking = ask
  try { card = sfCard() } catch (e) { S.sfMsg = { cls: 'danger', t: esc(e.message) }; render(); return }
  try {
    if (ask) {
      delete card.cred
      if (card.db) delete card.db.password
      await postJSON(`/api/k/${encodeURIComponent(f.kn)}/sources/request`, card)
      S.sfMsg = { t: `<b>관리자에게 부탁했다: ${esc(card.name)}</b> · 그 지식의 지식관리자 생성 화면과 설정 › 운영에 「더해 달라」 한 줄로 갔다` }
    } else {
      S.sfMsg = { cls: 'gray', t: '<b>더하는 중…</b> 처음 한 번 가져온다' }
      render()
      const r = await postJSON(`/api/k/${encodeURIComponent(f.kn)}/sources`, card)
      const st = r.run && r.run[0]
      S.sfOpen = false
      S.impTab = 'src'
      S.sfMsg = { t: `<b>더했다: ${esc(card.name)}</b>${st && st.state === 'changed' ? (card.kind === 'docs' ? ` · 문서 ${st.docs}` : ` · 처음 가져온 표 ${st.n}`) : card.kind === 'git' && st && st.state === 'same' ? ' · 지금 묶음을 기준으로 두었다. 다음 묶음부터 바뀐 코드를 기록한다' : st && st.state === 'waiting' ? '' : st && st.state === 'failed' ? ` · 그러나 못 가져왔다: ${esc(st.why || '')}` : ''}${isTeam() && (card.kind === 'git' || card.kind === 'db') ? ` · 자격이 필요하면 서버에서 <code>kmd secret set ${esc(r.secret)}</code>` : ''}` }
      toast(S.sfMsg.t, 8000)
      forgetKn(f.kn)
    }
    S.sf = { ...f, at: '', name: '', doc: '', gitUser: '', gitToken: '', password: '', host: '', database: '', user: '', paths: '' }
    dropSrcs()
  } catch (e) { S.sfMsg = { cls: 'danger', t: esc(e.message) } }
  render()
}
async function sfProbe() {
  const f = sfState()
  if (!String(f.at || '').trim()) { S.sfMsg = { cls: 'danger', t: 'git 주소 칸을 채운다' }; render(); return }
  S.sfMsg = { cls: 'gray', t: '<b>살펴보는 중…</b>' }
  render()
  try {
    const r = await postJSON(`/api/k/${encodeURIComponent(f.kn)}/sources/probe`, { at: f.at.trim(), kind: f.type })
    S.sfMsg = { t: `<b>닿는다. 마지막 묶음 ${esc(r.head.sha)}</b> · ${esc(r.head.subject)} · ${esc(r.asof)} · 더하면 이 묶음이 기준: 그 뒤 묶음부터 기록한다` }
  } catch (e) { S.sfMsg = { cls: 'danger', t: esc(e.message) } }
  render()
}
async function sfCheck() {
  const f = sfState()
  if (!String(f.host || '').trim()) { S.sfMsg = { cls: 'danger', t: '호스트 칸을 채운다' }; render(); return }
  try {
    S.sfMsg = { cls: 'gray', t: '<b>붙어 보는 중…</b>' }
    render()
    const r = await postJSON(`/api/k/${encodeURIComponent(f.kn)}/sources/checkdb`, { host: f.host.trim(), port: Number(f.port) || 5432, database: (f.database || '').trim() || null, user: (f.user || '').trim() || null, schema: (f.schema || 'public').trim(), name: (f.name || '').trim() || sfAutoName(f) || null, ...(isTeam() || !f.password ? {} : { password: f.password }) })
    const where = `${esc(f.host)}:${esc(f.port || 5432)}`
    if (!r.reach) S.sfMsg = { cls: 'danger', t: `<b>닿지 않는다: ${where}</b> · 주소 · 포트 · 방화벽을 본다` }
    else if (r.login === null || r.login === undefined) S.sfMsg = { t: `<b>닿는다: ${where}</b> · ${r.ms}ms · ${isTeam() ? '계정 확인은 서버에 비밀번호를 넣은 뒤(kmd secret set)' : '비밀번호를 넣으면 붙어서 계정까지 본다'}` }
    else if (!r.login) S.sfMsg = { cls: 'danger', t: `<b>닿지만 붙지 못했다</b>: ${esc(r.why)}` }
    else S.sfMsg = { t: `<b>붙었다. 테이블 ${r.tables}</b> · 읽기 전용으로 붙어 테이블 목록만 읽는다` }
  } catch (e) { S.sfMsg = { cls: 'danger', t: esc(e.message) } }
  render()
}
// 팀 화면 파일 넣기 한도(S-D35 · core/importer.js TEAM_IMPORT_MAX 와 같은 값) · 요청 하나 64MB — base64 로 4/3 이 되므로 파일 합 46MB 씩 나눠 보낸다
const TEAM_IMPORT_MAX = 20
const TEAM_PART = 46 << 20
const fileB64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(f) })
async function takeFiles(files) {
  files = [...files]
  if (!files.length) return
  S.impTab = 'queue' // 넣은 것은 진행 › 도는 일에서 본다
  let t = impTarget()
  if (t.none) { toastErr(t.label + '. 넣을 곳이 없다'); return }
  try {
    if (!t.kn) { toast('넣을 지식이 없다: 새 지식을 먼저 만든다'); openAdd(); return }
  } catch (e) { toastErr(e); return }
  // 팀 — 한 번에 TEAM_IMPORT_MAX 개까지(넘으면 보내지 않고 대량 넣기 안내 · 서버도 막는다) · 요청 하나 64MB(넘으면 묶음으로 나눠 보낸다)
  if (isTeam()) {
    if (files.length > TEAM_IMPORT_MAX) { S.impMany = files.length; S.impTab = 'queue'; render(); return }
    S.impMany = 0
    if (files.length > 1 && files.reduce((a, f) => a + f.size, 0) > TEAM_PART) return takeMany(files, t)
  }
  if (files.length > 10) return takeMany(files, t)
  const name = (KN(t.kn) || {}).name || t.kn
  const tops = [...new Set(files.map((f) => (f.webkitRelativePath || f._rel || '').split('/')).filter((p) => p.length > 1).map((p) => p[0]))]
  const row = { tm: nowHm(), title: tops.length ? tops[0] + ' 폴더 → ' + name + ' › ' + tops[0] : files.length === 1 ? files[0].name : `파일 ${files.length}개 → ${name}`, msg: '바꾸는 중…', cls: 'run', id: uid(), at: new Date().toISOString(), kn: t.kn }
  S.imports.unshift(row)
  S.impSel = 'i:' + row.id
  render()
  try {
    const list = await Promise.all(files.map(async (f) => ({ path: f.webkitRelativePath || f._rel || f.name, b64: await fileB64(f) })))
    const r = await postJSON(`/api/k/${encodeURIComponent(t.kn)}/import`, { files: list, ...(isTeam() && S.impAtt ? { attach: true } : {}) })
    const s = r.summary
    if (files.length === 1 && r.rows[0]) {
      const x = r.rows[0]
      row.msg = x.msg
      row.cls = x.kind === 'fail' || x.kind === 'skip' ? 'bad' : ''
      if (x.kind === 'doc') { row.title = files[0].name + ' → ' + name + ' › ' + x.doc; row.go = { kn: t.kn, doc: x.doc } }
      if (x.kind === 'record') { row.title = files[0].name + ' → ' + name + ' › 기록'; row.rec = x.rec ? { kn: t.kn, id: x.rec } : null }
      if (x.kind === 'run') row.run = x.run
    } else {
      row.msg = isTeam() ? `${tops[0] ? tops[0] + ' 폴더: ' : ''}팀 일꾼에게 넘김 ${s.run}${s.rule ? ' · 규칙 길로 넣음 ' + s.rule : ''}${s.att ? ' · 첨부 ' + s.att : ''}${s.same ? ' · 그대로 ' + s.same : ''}${s.fail ? ' · 바꾸지 못한 파일 ' + s.fail : ''}${s.skip ? ' · 넣지 않은 파일 ' + s.skip : ''}` : `${tops[0] ? tops[0] + ' 폴더: ' : ''}${s.record ? '기록 ' + s.record + ': kmd 가 기존 문서에 넣거나 새 문서로 세운다 · ' : ''}${s.doc ? '문서 ' + s.doc + ' · ' : ''}첨부 ${s.att}${s.same ? ' · 그대로 ' + s.same : ''}${s.fail ? ' · 바꾸지 못한 파일 ' + s.fail : ''} · 넣지 않은 파일 ${s.skip}`
      row.cls = s.skip || s.fail ? 'bad' : ''
    }
    row.tm = nowHm()
    const runIds = r.rows.filter((x) => x.kind === 'run').map((x) => x.run)
    if (runIds.length) { row.run = row.run || runIds[0]; if (!row.many && files.length === 1) S.impSel = row.run }
    forgetKn(t.kn)
    delete S.cache.history
    await reloadKns()
  } catch (e) { row.msg = e.message; row.cls = 'bad' }
  Object.assign(row, { fin: true, end: new Date().toISOString() })
  render()
  pollRuns()
}
// 기초 세우기 올리기(팀 · 메뉴개편 8-2 b) — 한 묶음 300 파일 · 200MB(넘으면 보내지 않고 나눠 올리기 · kmd-seed (!)) · 조각마다 seed/upload · 끝나면 조사
async function sdUpload(files) {
  files = [...files]
  const d = sdState()
  if (!files.length || !d.kn || (d.up && d.up.going) || d.busy) return
  const lim = (d.v && d.v.limit) || { files: 300, bytes: 200 << 20 }
  const bytes = files.reduce((a, f) => a + f.size, 0)
  const mb = (n) => Math.round(n / 1048576)
  if (files.length > lim.files || bytes > lim.bytes) { d.up = { err: `파일 ${files.length} · ${mb(bytes)}MB: 한 묶음 ${lim.files} 파일 · ${mb(lim.bytes)}MB 까지 · 나눠 올린다`, big: true }; render(); return }
  d.up = { going: true, n: 0, of: files.length }
  render()
  try {
    const parts = []
    let cur = [], sz = 0
    for (const x of files) { if (cur.length && (sz + x.size > TEAM_PART || cur.length >= 50)) { parts.push(cur); cur = []; sz = 0 } cur.push(x); sz += x.size }
    if (cur.length) parts.push(cur)
    let gid = null
    for (const [i, part] of parts.entries()) {
      const list = await Promise.all(part.map(async (x) => ({ path: x.webkitRelativePath || x._rel || x.name, b64: await fileB64(x) })))
      const r = await postJSON(sdUrl(d.kn, 'upload'), { group: { ...(gid ? { id: gid } : {}), total: files.length, last: i === parts.length - 1 }, files: list })
      gid = r.group
      d.up.n += part.length
      render()
    }
    await postJSON('/api/shape/survey', { kn: d.kn, group: gid })
    d.up = null; d.back = false; d.next = false
  } catch (e) { d.up = { err: e.message, big: /300 파일|200MB|kmd-seed/.test(e.message) } }
  await sdLoad(d.kn, true)
}
// 여럿 — 10 개(또는 40MB)씩 나눠 보낸다 · 서버의 「여러 파일」 일 하나로 묶인다(첫 조각이 세우고 마지막 조각에 last) ·
//   그 일을 그만두면 다음 조각은 stopped 로 돌아와 남은 파일을 보내지 않는다
async function takeMany(files, t) {
  const name = (KN(t.kn) || {}).name || t.kn
  const tops = [...new Set(files.map((f) => (f.webkitRelativePath || f._rel || '').split('/')).filter((p) => p.length > 1).map((p) => p[0]))]
  const row = { tm: nowHm(), title: tops.length ? tops[0] + ' 폴더 → ' + name : `파일 ${files.length}개 → ${name}`, msg: `넣는 중: 0/${files.length}`, cls: 'run', many: true, done: 0, total: files.length, rows: [], id: uid(), at: new Date().toISOString(), kn: t.kn }
  row.gid = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('') // 묶음 일의 id — 첫 조각이 이 id 로 세운다
  S.imports.unshift(row)
  S.impSel = row.gid
  render()
  const parts = []
  let cur = [], size = 0
  for (const f of files) { if (cur.length && (cur.length >= 10 || size + f.size > (isTeam() ? TEAM_PART : 40 << 20))) { parts.push(cur); cur = []; size = 0 } cur.push(f); size += f.size }
  if (cur.length) parts.push(cur)
  for (const [i, part] of parts.entries()) {
    if (row.stop) break
    try {
      const list = await Promise.all(part.map(async (f) => ({ path: f.webkitRelativePath || f._rel || f.name, b64: await fileB64(f) })))
      const last = i === parts.length - 1
      const r = await postJSON(`/api/k/${encodeURIComponent(t.kn)}/import`, { files: list, group: { id: row.gid, title: row.title, total: files.length, last }, ...(isTeam() && S.impAtt ? { attach: true } : {}) })
      if (r.stopped) { row.stop = true; break }
      if (i === 0) pollRuns()
      row.rows.push(...r.rows)
    } catch (e) { row.rows.push(...part.map((f) => ({ name: f.webkitRelativePath || f._rel || f.name, kind: 'fail', msg: e.message }))) }
    row.done += part.length
    const n = (k) => row.rows.filter((x) => x.kind === k).length
    const okN = row.rows.filter((x) => !['fail', 'skip', 'same'].includes(x.kind)).length
    row.msg = `${row.stop ? '그만뒀다' : row.done < row.total ? '넣는 중' : !okN && row.rows.length ? (n('same') === row.rows.length ? '모두 이미 있다' : '못 넣었다') : okN < row.rows.length - n('same') ? '일부 넣었다' : '넣었다'}: ${row.done}/${row.total} · ${isTeam() ? `팀 일꾼에게 넘김 ${n('run')}${n('rule') ? ' · 규칙 길 ' + n('rule') : ''}` : `문서 ${n('doc')} · 기록 ${n('record')} · Claude 일 ${n('run')}`} · 첨부 ${n('att')}${n('same') ? ' · 그대로 ' + n('same') : ''}${n('fail') ? ' · 못 넣음 ' + n('fail') : ''}${n('skip') ? ' · 읽지 못하는 종류 ' + n('skip') : ''}`
    render()
  }
  // 못함(빨강)은 하나도 넣지 못했을 때만 — 일부만 못 넣었으면 결과 글이 수를 말한다
  row.cls = row.rows.length && row.rows.every((x) => ['fail', 'skip'].includes(x.kind)) ? 'bad' : ''
  row.tm = nowHm()
  const runIds = row.rows.filter((x) => x.kind === 'run').map((x) => x.run)
  if (runIds.length) row.run = runIds[0]
  Object.assign(row, { fin: true, end: new Date().toISOString() })
  forgetKn(t.kn)
  delete S.cache.history
  await reloadKns()
  render()
  pollRuns()
}
function readEntries(entry, p, out) {
  return new Promise((res) => {
    if (entry.isFile) entry.file((f) => { f._rel = p + f.name; out.push(f); res() }, () => res())
    else if (entry.isDirectory) { const rd = entry.createReader(), all = []; const next = () => rd.readEntries((es) => { if (!es.length) Promise.all(all.map((e) => readEntries(e, p + entry.name + '/', out))).then(res); else { all.push(...es); next() } }, () => res()); next() }
    else res()
  })
}

const pcRoot = () => (S.me.root || '').replace(/[\\/]+$/, '')

// ── 공유(옛 지식 보내기) — 팀 지식으로 ──
// 맨 위가 보내는 길 — 보내는 지식(개인 지식) → 받는 지식(팀 지식 하나). 개인 화면에서만. 길은 개인 지식마다 하나로 묶였고
//   화면이 그때그때 고르지 않는다 · 바꾸려면 새 이름을 그대로 친다 · 단추 · 확인 창에 받는 지식 이름이 늘 들어간다.
// 보낼 것은 그 길 안에서 탭으로 — 기록(먼저 · 보내지 않은 것) · 문서(통째로) · 보낸 것. 보내기는 개인 프로그램이 이 PC 의 기기 열쇠로 한다
const sendSrcs = () => S.kns.filter((k) => !k.dim)
// 받는 팀 지식 — 이 PC 가 이은 팀마다 기기 열쇠로 본 목록(/api/send/teams · 쓰기 자리 이상)
//   key — 팀이 여럿이면 같은 id 가 있을 수 있어 개인 화면은 「주소#id」
const sendTeamsV = () => need('sendTeams', '/api/send/teams')
function sendTeams() {
  if (isTeam()) return []
  const v = sendTeamsV()
  if (!v || v.error) return []
  const many = v.teams.filter((t) => t.kns).length > 1
  return v.teams.flatMap((t) => (t.kns || []).map((k) => ({ key: t.url + '#' + k.id, id: k.id, name: k.name, url: t.url, host: many ? t.url.replace(/^https?:\/\//, '') : '' })))
}
const sendTeamOf = (key) => sendTeams().find((t) => t.key === key) || null
// 받는 지식 이름 — 개인 화면은 받는 팀의 목록에서(같은 id 의 개인 지식과 섞이지 않게)
const sendNm = (id) => (sendTeams().find((t) => t.id === id) || {}).name || id
// 받는 팀 지식 고르기 칸의 상태 — 읽는 중 · 못 읽음(+ 다시 읽기) · 팀에 잇지 않음
function sendTeamsNote() {
  const v = sendTeamsV()
  if (!v) return loadingHtml
  if (v.error) return errHtml(v, 'sendTeams')
  const bad = v.teams.filter((t) => t.error)
  if (!v.teams.length) return '<p class="muted small" data-t="sendNoLink">이 PC 가 팀에 이어지지 않았다. 팀 화면의 설치 한 줄로 잇는다</p>'
  return bad.map((t) => `<div class="callout warn" data-t="sendTeamErr"><i></i><span><b>${esc(t.url)}</b> · ${esc(t.error)}</span></div>`).join('')
}
const sendOf = (k) => need('send:' + k, `/api/k/${encodeURIComponent(k)}/send`)
const knNm = (id) => (KN(id) || {}).name || id
// 「…로 / …으로」 — 받침(ㄹ 빼고)이 있으면 으로
const ro = (w) => { w = String(w); const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 && c % 28 !== 8 ? '으로' : '로') }
function sendSrc() {
  const ks = sendSrcs()
  if (!ks.length) return null
  // 보내는 지식은 옆 메뉴에서 고른 지식(메뉴 개편 N5 · 화면 안 고르기는 걷었다) · 바뀌면 고른 것을 비운다
  const k = defaultKn(), id = ks.some((x) => x.id === k) ? k : ks[0].id
  if (S.sendSrc !== id) { S.sendSrc = id; S.sendSel = {}; S.sendWhole = {}; S.sendTab = 'rec' }
  return KN(id)
}
const sendPicks = () => Object.keys(S.sendSel || {}).filter((x) => S.sendSel[x])
// 받는 팀 지식 한 줄 — 보낸 것은 받는 지식이 검사해 그 순간 문서에 넣는다(S12 · 정리를 기다리지 않는다)
const teamWho = () => '그 지식에 자리가 있는 팀원이 본다 · 보내기 확인 창에서 저장 제안을 승인하면 문서에'
// 팀 연결 칩 — 이 PC 가 이은 팀(기기 열쇠)의 상태 · 이어지지 않았으면 null(빈 상태 「팀 연결 없음」)
function sendLinkChip() {
  const v = sendTeamsV()
  if (!v) return '<span class="chip c-mute" data-t="sendLink">팀 연결 보는 중…</span>'
  if (v.error) return '<span class="chip c-danger" data-t="sendLink">팀 연결 못 읽음</span>'
  if (!v.teams.length) return null
  return v.teams.some((t) => t.error) ? '<span class="chip c-warn" data-t="sendLink">팀 연결 끊김</span>' : '<span class="chip c-ok" data-t="sendLink">팀 연결</span>'
}
function viewSend() {
  const head = `<div class="pg-h"><div class="pt"><div class="big">공유</div>${tipb('send', '공유')}</div></div>`
  const src = sendSrc()
  if (!src) return { crumb: '공유', main: `<div class="snd">${head}<div class="card" data-t="sendNone"><div class="empty3">${svg('arrow')}<b>보낼 개인 지식이 없다</b><button class="btn pri" data-a="openAdd" data-t="sendMakeKn">+ 새 개인 지식</button></div></div></div>` }
  const link = sendLinkChip()
  // 팀 연결이 없으면 늘 이 빈 상태(메뉴 개편 5-1) — [잇기] 는 설정의 팀 잇기 자리로
  if (link === null) return { crumb: '공유', main: `<div class="snd">${head}<div class="empty2" data-t="sendNoLink"><b>팀 연결 없음</b><button type="button" class="btn pri sm" data-a="openSet" data-v="team" data-t="sendLinkGo" style="margin-top:var(--sp-3)">잇기</button></div></div>` }
  const v = sendOf(src.id)
  if (!v) return { crumb: '공유', main: `<div class="snd">${head}${loadingHtml}</div>` }
  if (v.error) return { crumb: '공유', main: `<div class="snd">${head}${errHtml(v)}</div>` }
  const r = v.route && !v.route.gone ? v.route : null
  // 위 줄 — <이 지식> → <받을 곳>(받을 곳이 없거나 없어졌으면 [받을 곳 정하기])
  const route = `<div class="route" data-t="sendRoute"><b data-t="sendFrom">${esc(src.name)}</b><span class="kt me">개인</span><span class="ar" aria-hidden="true">→</span>${r ? `<b data-t="sendTo" data-kn="${esc(r.kn)}">${esc(r.name)}</b><span class="kt team">팀</span>${link}<button type="button" class="btn sm ghost" data-a="sendWin" data-v="change" data-t="sendChange">바꾸기</button>` : `${v.route && v.route.gone ? '<span class="chip c-warn" data-t="sendGone">받을 곳이 없어졌다</span>' : ''}${link}<button type="button" class="btn pri sm" data-a="sendWin" data-v="set" data-t="sendPickOpen">받을 곳 정하기</button>`}</div>`
  let top = ''
  for (const w of v.wait) top += `<div class="callout ${w.state === 'wait' ? 'gray' : 'warn'} stop" data-t="sendWait" data-state="${esc(w.state)}"><i></i><span><b>${w.state === 'wait' ? '받는 지식에 닿지 않았다' : '보내지 못했다'}: ${esc(sendNm(w.to))} ${w.n}개</b> · ${w.state === 'wait' ? '저절로 다시 보낸다' : esc(w.why || '')}${w.fix ? ' · ' + esc(w.fix) : ''} · ${esc(whenTxt(w.at))} 에 누른 것${w.tries ? ` · ${w.tries}번 다시 했다(${esc(whenTxt(w.lastAt))})${w.sameWhy ? ' · 같은 까닭이 되풀이된다' : ''}` : ''}</span><span class="r u-flex u-g4" style="margin-left:auto"><button class="btn sm" data-a="sendWaitAct" data-k="${esc(src.id)}" data-id="${esc(w.id)}" data-v="retry" data-t="sendRetry">지금 다시</button><button class="btn sm ghost" data-a="sendWaitAct" data-k="${esc(src.id)}" data-id="${esc(w.id)}" data-v="drop" data-t="sendDrop">버리기</button></span></div>`
  if (!r) return { crumb: '공유', main: `<div class="snd">${head}${route}${top}</div>` }
  const unsent = v.recs.filter((x) => !x.sent), todo = v.docs.filter((d) => d.st !== 'same')
  const tab = S.sendTab === 'doc' ? 'doc' : 'rec'
  const tabs = `<div class="tabs" data-t="sendTabs">${[['rec', '기록', unsent.length, ''], ['doc', '문서', todo.length, todo.length ? 'w' : '']].map(([k, l, n, c]) => `<span class="${tab === k ? 'on' : ''}" data-a="sendTab" data-v="${k}" data-t="sendTab-${k}">${l} <em${c ? ` class="${c}"` : ''}>${n}</em></span>`).join('')}</div>`
  const box = (on, key, attrs = '') => `<input type="checkbox" data-a="sendPick" data-v="${esc(key)}"${on ? ' checked' : ''}${attrs}>`
  let body
  if (tab === 'rec') {
    const list = S.sendRecAll ? v.recs : unsent
    const rows = list.map((x) => x.sent
      ? `<div class="drow dim" data-t="sendRec" data-sent="1"><input type="checkbox" disabled><span class="ic2">${svg('doc')}</span><span class="dn"><b>${esc(x.title)}</b><small>${esc(x.author || '')} · ${esc(whenTxt(x.when))}</small></span><span class="chip c-mute">${typeof x.sent === 'string' ? esc(whenTxt(x.sent)) + ' 보냄' : '보냄'}</span></div>`
      : `<label class="drow${picked('r|' + x.id) ? ' on' : ''}" data-t="sendRec">${box(picked('r|' + x.id), 'r|' + x.id)}<span class="ic2">${svg('doc')}</span><span class="dn"><b>${esc(x.title)}</b><small>${esc(x.author || '')} · ${esc(whenTxt(x.when))}</small></span><span class="chip c-acc">보내지 않음</span></label>`).join('')
    body = `<div class="tbar"><span class="seg in" data-t="sendRecSeg"><button class="${S.sendRecAll ? '' : 'on'}" data-a="sendRecAll" data-v="">보내지 않은 것 ${unsent.length}</button><button class="${S.sendRecAll ? 'on' : ''}" data-a="sendRecAll" data-v="1">모두 ${v.recs.length}</button></span><span class="r"><button class="btn sm ghost" data-a="sendAll" data-v="1" data-t="sendAllOn">모두 고르기</button><button class="btn sm ghost" data-a="sendAll" data-v="" data-t="sendAllOff">모두 빼기</button><input class="inp" id="sendQ" aria-label="보낼 기록 찾기" data-in="sendQ" data-t="sendQ" value="${esc(S.sendQ || '')}" placeholder="제목으로 찾기" style="width:min(170px,100%)"></span></div><div class="dlist">${rows || `<div class="empty3 sm">${S.sendRecAll ? '기록이 없다' : '보내지 않은 기록 없음'}</div>`}</div>`
  } else {
    const rows = v.docs.map((d) => {
      const on = picked('d|' + d.path)
      const chip = d.st === 'new' ? '<span class="chip c-acc">보낸 적 없음</span>' : d.st === 'chg' ? chipOf('chg', `보낸 뒤 고침${d.heads.length ? ' ' + d.heads.length : ''}`) : '<span class="chip c-mute">보낸 그대로</span>'
      const sentAt = typeof d.sent === 'string' ? ` · ${whenTxt(d.sent)} 에 보냄` : d.sent ? ' · 보냄' : ''
      const sub = d.st === 'chg' && d.heads.length ? `보낸 뒤 고친 항목: ${d.heads.join(' · ')} · ${whenTxt(d.when)}${sentAt}` : whenTxt(d.when) + sentAt
      return `<label class="drow${on ? ' on' : ''}" data-t="sendDoc" data-st="${d.st}">${box(on, 'd|' + d.path)}<span class="ic2">${svg('doc')}</span><span class="dn"><b>${esc(d.title)}</b><small>${esc(sub)}</small></span>${chip}<span class="how">문서 통째로</span></label>`
    }).join('')
    body = `<div class="dlist">${rows || '<div class="empty3 sm">문서가 없다</div>'}</div>`
  }
  const sel = sendPicks(), nR = sel.filter((x) => x.startsWith('r|')).length, nD = sel.length - nR
  const foot = `<div class="callout warn" data-t="sendWarn" style="margin:var(--sp-5) var(--sp-7) 0"><span>고른 것은 이 PC 의 Claude 를 거쳐 <b>${esc(r.name)}</b> 팀원 모두가 본다</span></div><div class="cf"><span>고름: 기록 ${nR} · 문서 ${nD}</span><button class="btn pri" style="margin-left:auto" data-a="sendWin" data-v="confirm" data-t="sendBtn"${sel.length && !S.sending ? '' : ' disabled'}>${S.sending ? '보내는 중…' : sel.length ? `${esc(ro(r.name))} ${sel.length}개 보내기` : '보낼 것을 고른다'}</button></div>`
  return { crumb: '공유', main: `<div class="snd">${head}${route}${top}<div class="card" data-t="sendBody">${tabs}${body}${foot}</div></div>` }
}
const picked = (x) => !!(S.sendSel || {})[x]
// 확인 창 — 보내기(어디서 어디로 크게) · 받는 지식 바꾸기(새 이름을 그대로 친다)
function sendWinHtml() {
  const w = S.sendWin, src = sendSrc(), v = src && S.cache['send:' + src.id]
  if (!src || !v || v.error) return ''
  const r = v.route
  if (w.kind === 'confirm' && r) {
    const sel = sendPicks()
    const rows = sel.map((x) => {
      if (x.startsWith('r|')) { const it = v.recs.find((y) => y.id === x.slice(2)); return it ? `<li><b>${esc(it.title)}</b> <small class="muted">: 기록 전체</small></li>` : '' }
      const d = v.docs.find((y) => y.path === x.slice(2))
      if (!d) return ''
      const how = d.st === 'new' ? '문서 통째로 · 처음' : '문서 통째로'
      return `<li><b>${esc(d.title)}</b> <small class="muted">: ${esc(how)}</small></li>`
    }).join('')
    // 받는 팀 지식이 저장 제안을 받으면(P-D22 · P7) 창이 곧 제안서 — 제안을 짓는 동안은 [보내기] 를 누르지 않는다
    const prev = sendPrevHtml(src, v, sel), pk = 'sendPrev:' + src.id + ':' + r.kn + ':' + sel.join('|'), pv = S.cache[pk], wait = !pv && !!S.wait[pk]
    const note = pv && pv.approve ? `고른 것마다 이 PC 의 Claude 가 지은 글을 ${esc(r.name)} 가 저장 제안으로 보였다 · [보내기] 가 그 제안의 승인이다(경고 받아들임) · 뺀 것은 보내지 않고 남는다 · ${esc(S.me.user)} 이름으로 간다 · 내 개인 지식의 글은 그대로다` : `고른 것마다 이 PC 의 Claude 가 ${esc(r.name)} 의 작성기준에 맞춰 기록과 항목 글로 짓는다 · 받는 지식이 보내기 확인 창의 저장 제안을 승인하면 그 순간 문서에 들어간다 · ${esc(S.me.user)} 이름으로 간다 · 내 개인 지식의 글은 그대로다`
    return `<div class="scrim fix" data-a="sendWinClose" data-self="1"><div class="modal w560" role="dialog" aria-modal="true" aria-labelledby="sendCfH" data-t="sendConfirm"><div class="mh" id="sendCfH">보내기 확인<button class="x" data-a="sendWinClose" title="닫기" aria-label="닫기">×</button></div><div class="mb"><div class="bigroute"><span class="e"><small>보내는 지식 · 개인 · 나만</small><b>${esc(src.name)}</b></span>${svg('arrow')}<span class="e"><small>받는 지식 · 팀 · ${esc(teamWho(r).split(' · ')[1])}</small><b data-t="sendConfirmTo">${esc(r.name)}</b></span></div><ul class="plain sum">${rows}</ul>${prev}<p class="small muted" style="margin:var(--sp-5) 0 0">${note}</p></div><div class="mf"><span class="l">이 프로그램이 이 PC 의 기기 열쇠로 보낸다</span><span class="acts"><button class="btn ghost" data-a="sendWinClose">취소</button><button class="btn pri" data-a="doSend" data-t="sendGo"${S.sending || wait || (pv && pv.approve && (pv.unavailable || !(pv.proposals || []).some((x) => !(x.propose.errors || []).length))) ? ' disabled' : ''}>${S.sending ? '보내는 중…' : esc(ro(r.name)) + ' 보내기'}</button></span></div></div></div>`
  }
  // 받을 곳 정하기 · 바꾸기 — 목록은 이 PC 의 팀 사람이 쓰기 자리 이상인 팀 지식만(팀 서버가 자리로 거른다 · /api/send/teams)
  const set = w.kind === 'set' || !r || r.gone
  const teams = sendTeams().filter((t) => set || !(t.id === r.kn && t.url === r.url))
  const pt = w.to && sendTeamOf(w.to)
  const rows = teams.map((t) => `<label class="trow${w.to === t.key ? ' on' : ''}" data-t="${set ? 'sendTeam' : 'sendChangeTeam'}"><input type="radio" name="sendTo2" data-a="sendWinTo" data-v="${esc(t.key)}"${w.to === t.key ? ' checked' : ''}><span class="tn"><b>${esc(t.name)}</b><small>${esc(teamWho())}${t.host ? ' · ' + esc(t.host) : ''}</small></span><span class="kt team">팀</span></label>`).join('')
  const none = sendTeamsV() && sendTeamsV().error ? '' : `<p class="muted small" data-t="sendNoTeam">받을 수 있는 팀 지식 없음</p>`
  if (set) return `<div class="scrim fix" data-a="sendWinClose" data-self="1"><div class="modal w560" role="dialog" aria-modal="true" aria-labelledby="sendSetH" data-t="sendSetup"><div class="mh" id="sendSetH">받을 곳 정하기 <small>${esc(src.name)}</small>${tipb('send.to', '받을 곳')}<button class="x" data-a="sendWinClose" title="닫기" aria-label="닫기">×</button></div><div class="mb">${sendTeamsNote()}${rows || none}${w.err ? formErr(w.err, 'sendWinErr') : ''}</div><div class="mf"><span class="acts"><button class="btn ghost" data-a="sendWinClose">취소</button><button class="btn pri" data-a="sendSetRoute" data-t="sendSetRoute"${pt && !S.sending ? '' : ' disabled'}>${pt ? esc(ro(pt.name)) + ' 정하기' : '정하기'}</button></span></div></div></div>`
  return `<div class="scrim fix" data-a="sendWinClose" data-self="1"><div class="modal w560" role="dialog" aria-modal="true" aria-labelledby="sendChgH" data-t="sendChangeWin"><div class="mh" id="sendChgH">받을 곳 바꾸기 <small>${esc(src.name)}</small><button class="x" data-a="sendWinClose" title="닫기" aria-label="닫기">×</button></div><div class="mb"><div class="callout warn" style="margin-top:0">바꾸면 <b>${esc(src.name)}</b> 에서 앞으로 보내는 것이 모두 새 곳으로 간다. ${esc(r.name)} 에 이미 보낸 것은 그대로 남는다.</div><div class="small b6 mt-sec">지금: ${esc(r.name)} · 새 받을 곳</div>${rows || none}${pt ? `<div class="field" style="margin:var(--sp-5) 0 0"><label for="sendType">확인: 새 받을 곳 이름 「${esc(pt.name)}」 를 그대로 친다</label><input class="inp" id="sendType" data-in="sendType" data-t="sendType" value="${esc(w.type || '')}" placeholder="${esc(pt.name)}" autocomplete="off"></div>` : ''}${w.err ? formErr(w.err, 'sendWinErr') : ''}</div><div class="mf"><span class="l">바꾼 일은 이력에 남는다</span><span class="acts"><button class="btn ghost" data-a="sendWinClose">취소</button><button class="btn pri" data-a="sendChangeGo" data-t="sendChangeGo"${pt && (w.type || '').trim() === pt.name && !S.sending ? '' : ' disabled'}>${pt ? esc(ro(pt.name)) + ' 바꾸기' : '바꾸기'}</button></span></div></div></div>`
}
// 길 정하기 · 바꾸기 — 서버가 다시 본다(바꾸기는 새 이름을 그대로 · 팀 지식만)
async function sendRoute(src, key, confirm) {
  const t = sendTeamOf(key)
  if (!t) return
  const to = t.id
  S.sending = true
  render()
  try {
    S.cache['send:' + src] = await postJSON(`/api/k/${encodeURIComponent(src)}/send/route`, { to, confirm, ...(t.url ? { url: t.url } : {}) })
    S.sendSel = {}
    S.sendWhole = {}
    S.sendWin = null
    S.sendPickTo = null
    toast(`받을 곳을 정했다: ${esc(knNm(src))} 에서 보내는 것은 모두 ${esc(ro(t.name))} 간다`)
    await reloadKns()
  } catch (e) {
    if (S.sendWin) S.sendWin.err = e.message
    else toastErr(e)
  }
  S.sending = false
  render()
}
// 보내기 미리 보기 — 고른 것을 받는 지식의 항목 장부로 맞춰 본다(쓰지 않는다)
function sendPrevHtml(src, v, sel) {
  const key = 'sendPrev:' + src.id + ':' + v.route.kn + ':' + sel.join('|')
  if (!(key in S.cache) && !S.wait[key]) {
    const recs = sel.filter((x) => x.startsWith('r|')).map((x) => x.slice(2))
    const docs = sel.filter((x) => x.startsWith('d|')).map((x) => ({ path: x.slice(2) }))
    S.wait[key] = postJSON(`/api/k/${encodeURIComponent(src.id)}/send/preview`, { to: v.route.kn, recs, docs })
      .then((r) => { S.cache[key] = r }, (e) => { S.cache[key] = { unavailable: e.message } })
      .finally(() => { delete S.wait[key]; scheduleRender() })
  }
  const p = S.cache[key]
  if (!p) return `<div class="small muted" data-t="sendPrev" style="margin:var(--sp-5) 0 0">${esc(sendNm(v.route.kn) || v.route.name)} 의 항목 장부와 맞춰 보는 중…</div>`
  if (!p.unavailable && Array.isArray(p.proposals) && p.proposals.length) return sendPropHtml(p)
  if (p.unavailable && p.approve) return `<div class="callout warn" data-t="sendPrev" style="margin:var(--sp-5) 0 0"><span>저장 제안을 보지 못했다: ${esc(p.unavailable)}</span></div>`
  if (p.unavailable) return `<div class="small muted" data-t="sendPrev" style="margin:var(--sp-5) 0 0">항목 미리 보기를 하지 못했다: ${esc(p.unavailable)} · 보내기에는 지장이 없다</div>`
  if (!p.unnamed.length) return `<div class="small" data-t="sendPrev" style="margin:var(--sp-5) 0 0">${chipOf('ok', '항목 맞음')} 고른 것이 모두 ${esc(sendNm(v.route.kn) || v.route.name)} 의 항목에 닿는다${p.same ? ` · 이미 보낸 것 ${p.same}` : ''}</div>`
  return `<div class="callout warn" data-t="sendPrev" style="margin:var(--sp-5) 0 0"><span><b>${p.unnamed.length}개는 ${esc(sendNm(v.route.kn) || v.route.name)} 의 항목 장부에서 맞는 항목을 못 찾았다.</b> 그대로 보내면 Claude 가 받는 지식의 문서에서 넣을 곳을 찾는다. 넣을 곳은 보내기 확인 창의 저장 제안에서 본다<small>${p.unnamed.slice(0, 5).map(esc).join(' · ')}${p.unnamed.length > 5 ? ` 외 ${p.unnamed.length - 5}` : ''}</small></span></div>`
}
// 받는 팀 지식의 저장 제안(저장 승인 P-D22) — 미리 보기가 기록마다 팀의 propose 결과를 실으면(proposals[{ rec, title, propose }] · P7) 보내기 창이 곧 제안서다.
//   항목마다 [빼기](뺀 것은 보내지 않고 개인 쪽에 남는다 · S.sendEx[기록] = 뺀 넣을 곳) · [보내기] 가 승인(경고 받아들임). 싣지 않는 옛 판은 위 항목 미리 보기 그대로
function sendPropHtml(p) {
  const ex = S.sendEx || {}
  return p.proposals.map((x) => {
    const pr = x.propose || {}, out = ex[x.rec] || []
    const rows = (pr.items || []).map((it) => { const off = out.includes(it.at); return `<div class="row" data-t="sendPropItem"><span class="small${off ? ' muted' : ''}">${esc(it.at)} <small class="muted">${esc(SV_KIND[it.kind] || it.kind)}</small></span><button type="button" class="btn sm" style="margin-left:auto" data-a="sendEx" data-r="${esc(x.rec)}" data-v="${esc(it.at)}" aria-pressed="${off}" data-t="sendExBtn">${off ? '되넣기' : '빼기'}</button></div>` }).join('')
    const warn = (pr.warnings || []).length ? `<div class="small" data-t="sendPropWarn">경고 ${pr.warnings.length}${tipb('sv.warn', '경고')}</div>` : ''
    const errs = (pr.errors || []).length ? `<div class="small" role="alert" data-t="sendPropErr">오류 ${pr.errors.length}: ${esc(pr.errors[0].why || '')}</div>` : ''
    return `<div class="diff" data-t="sendProp"><div class="fh">${esc(x.title || x.rec)}</div><div class="u-p4-7">${rows}${warn}${errs}</div></div>`
  }).join('')
}
async function doSend() {
  const src = sendSrc(), v = src && S.cache['send:' + src.id]
  if (!v || !v.route || S.sending) return
  const sel = sendPicks()
  const recs = sel.filter((x) => x.startsWith('r|')).map((x) => x.slice(2))
  const docs = sel.filter((x) => x.startsWith('d|')).map((x) => ({ path: x.slice(2) }))
  S.sending = true
  render()
  try {
    // to — 화면이 본 받는 지식 · 그새 바뀌었으면 서버가 보내지 않는다
    const ex = Object.fromEntries(Object.entries(S.sendEx || {}).filter(([, xs]) => xs.length))
    const r = await postJSON(`/api/k/${encodeURIComponent(src.id)}/send`, { to: v.route.kn, recs, docs, ...(Object.keys(ex).length ? { excluded: ex } : {}) })
    S.sendEx = {}
    S.sendSel = {}
    S.sendWhole = {}
    // 넣음 · 이미 넣음(S12)
    const sum = r.put != null ? `넣음 ${r.put}${r.same ? ` · 이미 넣음 ${r.same}` : ''}${r.skipped ? ` · 뺌 ${r.skipped}` : ''}` : `${r.sent}개`
    if (r.fail && !(r.put || r.same)) toastErr(`보내지 못했다: ${(r.why || [])[0] || ''}`)
    else toast(r.wait ? `닿지 않았다: ${r.wait}개는 저절로 다시 보낸다` : `${esc(ro(v.route.name))} 보냈다: ${esc(sum)}`)
  } catch (e) { toastErr(e) }
  S.sending = false
  S.sendWin = null
  delete S.cache['send:' + src.id]
  delete S.cache.history
  await reloadKns()
  loadStops()
  render()
}

// 칸에 쓰는 중이면 다시 그리지 않는다(상태는 바뀌었으니 다음에 그릴 때 보인다)
const typing = () => !!document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
// 숨은 탭에서는 다시 읽기를 쉰다(지금 하는 일 · 일 줄 · 경고) — 다시 보이면 곧바로 한 번 읽고 이어 간다
// 사람이 스크롤한 자리(창 전체) — 다시 그리기 바로 뒤에 오는 스크롤(짧아져 밀린 것)은 사람 것이 아니다
addEventListener('scroll', () => { if (performance.now() - (S._renderAt || 0) > 150) S._wantY = scrollY }, { passive: true })
// 자리를 받으면 — 지식이 하나도 없던 사람이 화면으로 돌아오면 목록을 다시 읽는다(UX T5-03)
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me && !anon() && isTeam() && !(S.kns || []).filter((x) => !isPersonal(x)).length) reloadKns().then(render, (e) => console.error(e)) })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  if (!S.me || anon()) return
  loadBusy()
  loadStops()
  if (S.route.scr === 'import') pollRuns()
  const t = activeTab()
  if (t && !S.edit && KNSCR.includes(S.route.scr)) { for (const key of Object.keys(S.cache)) if (key === 'tree:' + t.kn || key.startsWith(`doc:${t.kn}:${t.ref}`) || key.startsWith(`item:${t.kn}:`) || key.startsWith(`model:${t.kn}`)) delete S.cache[key]; render() }
})
// ── 설정 — 팀: 점검 · 팀 서버 · 팀 지식 · 사람 · 묶음 · 에이전트 설치 · 나 / 개인: 이 PC · Claude 연결 · 에이전트 설치 ──
const settingsOf = () => need('settings', '/api/settings')
const dropSettings = () => { delete S.cache.settings }
const devicesOf = () => need('devices', '/api/me/devices')
// 설정 — 팀 화면은 팀 서버의 것만 · 개인 화면은 개인 프로그램의 것만
const setArea = () => (isTeam() ? 'team' : 'me')
function viewSettings() {
  const team = isTeam(), st = settingsOf()
  const pg = setPage() || { id: 'mine', l: '서버 정보' }, tab = pg.id
  // 페이지 안내는 제목 옆 (!) — 개인 화면의 에이전트 설치는 개인 지식 연결(kmd) 안내
  const head = `<div class="pt" style="margin-bottom:var(--sp-5)"><div class="big" data-t="setTitle">${esc(pg.l)}</div>${tipb(tab === 'agent' && !isTeam() ? 'set.agentPc' : 'set.' + tab, pg.l)}</div>`
  if (!st || st.error) return { crumb: '설정', main: `<div class="pg-list">${head}${st ? errHtml(st) : loadingHtml}</div>` }
  const one = (h) => `<div class="pg-text">${h}</div>`
  const body = !team
    ? tab === 'claude' ? one(claudeCard(st) + `<div class="card" data-t="claudeAuto"><div class="cb u-p4-7">${autoSw('claude', 'Claude 로 들이기')}</div></div>` + modelCard(st)) : tab === 'agent' ? one(agentCard()) : tab === 'team' ? one(teamLinkCard(st)) : one(pcBackupCard(st))
    : tab === 'check' ? opsHtml() : tab === 'server' ? one(serverCards(st)) : tab === 'agent' ? one(agentInstallCard()) : tab === 'install' ? one(installCardHtml()) : mineHtml(st)
  return { crumb: pg.l, main: `<div class="pg-list">${head}${body}</div>` }
}
// 운영 값(읽기만 · UX T6-26) — 흩어진 손잡이를 한 곳에서 본다. 바꾸는 곳은 줄마다 적은 곳
const OPS_NAME = { helpContact: ['잊었을 때 부탁할 곳', '들어가기 화면'], backupRoot: ['저장소 폴더', '지식관리 › 모든 지식'], backupRoots: ['백업으로 허락한 폴더', ''], sourceRoots: ['가져올 곳으로 허락한 폴더', ''], sourceHosts: ['가져올 곳으로 허락한 주소', ''], collect: ['편집기로 고친 문서 거두기', ''], trustProxy: ['앞단 프록시 믿기', ''], attachDaily: ['하루 첨부 한도', ''], intakeDaily: ['하루 들이기 한도', ''], intakeQueue: ['들이기 줄 길이', ''], saveRate: ['저장 빠르기 한도', ''], savelogMax: ['저장 측정 줄 길이', ''], dl: ['꾸러미 자리', ''], prepMax: ['미리 읽기 한도', ''], scryptN: ['비밀번호 굳히기 세기', ''], gitlab: ['GitLab 연결', ''] }
function opsCard(a) {
  const o = a.ops; if (!o) return ''
  const v = (x) => Array.isArray(x) ? (x.length ? x.join(' · ') : '없음') : typeof x === 'object' ? JSON.stringify(x) : String(x)
  const conf = Object.entries(o.conf || {}).map(([k, x]) => `<span>${esc((OPS_NAME[k] || [k])[0])} <small class="muted mono">${esc(k)}</small></span><span class="mono">${esc(v(x))}</span>`).join('')
  return `<div class="card" data-t="opsCard"><div class="ch">운영 값 <small>읽기만 · 바꾸는 곳은 줄마다 · 서버 파일은 <span class="mono">serve.json</span>(고친 뒤 서버를 다시 켠다)</small></div><div class="cb"><div class="kv">
   <span>줄 멈춤</span><span>${o.hold ? '<b>멈춤</b>' : '돈다'} <small class="muted">· 설정 › 팀 일꾼</small></span>
   <span>동시에 도는 수</span><span>Claude ${esc(String(o.caps?.claude ?? '—'))} · 자동수집 ${esc(String(o.caps?.fetch ?? '—'))} <small class="muted">· 설정 › 팀 일꾼</small></span>
   <span>지식 폴더</span><span class="mono">${esc(o.root || '')}</span>
   <span>살림 자리</span><span class="mono">${esc(o.dataDir || '')}</span>
   ${conf || '<span>serve.json</span><span class="muted">따로 정한 값이 없다(모두 기본값)</span>'}
   ${(o.other || []).length ? `<span>그 밖에 정한 것</span><span class="mono small">${esc(o.other.join(' · '))}</span>` : ''}
  </div></div></div>`
}
// 팀 일꾼(총괄 관리자 · 6-2) — 팀 일꾼 로그인 · 어떻게 하나 · 운영 값은 운영에
function serverCards(st) {
  const a = overviewOf()
  if (!a || a.error) return a ? errHtml(a) : loadingHtml
  return admClaudeCard(a) + queueCard(a) + claudeHowCard(a)
}
// 일 줄(총괄 관리자) — 동시에 도는 수 · 줄 멈춤 · 생성 › 진행과 같은 손잡이(data-cap · qHold) · 지식이 없어도 여기서 닿는다
function queueCard(a) {
  const o = a.ops || {}, caps = o.caps || {}
  const sel = (k, l) => `<span class="qcap">${l} <select class="inp" data-t="cap-${k}" data-cap="${k}" aria-label="${l}: 동시에 도는 수" style="width:auto">${[1, 2, 3, 4].map((n) => `<option${n === Number(caps[k]) ? ' selected' : ''}>${n}</option>`).join('')}</select></span>`
  return `<div class="card" data-t="queueCard"><div class="ch">일 줄${tipb('imp.ahead', '일 줄')}</div><div class="cb"><div class="kv"><span>동시에 도는 수</span><span>${sel('claude', 'Claude')} ${sel('fetch', '자동수집')}</span><span>줄 멈춤</span><span>${o.hold ? '<b>멈춤</b>' : '돈다'} <button type="button" class="btn sm" data-a="qHold" data-v="${o.hold ? 0 : 1}" data-t="qHold">${o.hold ? '줄 다시 돌리기' : '줄 멈춤'}</button></span></div></div></div>`
}
// 일 줄 손잡이를 바꾼 뒤 — 팀 일꾼 · 운영 화면의 값(overview.ops)도 맞춘다
function opsQueueSet(f) { const a = S.cache.admin; if (a && !a.error && a.ops) { f(a.ops); render() } }
// 운영(총괄 관리자 · 옛 점검 · 6-2) — 경고 · 오늘 · 감사 기록 · 지식 폴더 다시 읽기([동기화]) · 운영 값
function opsHtml() {
  const v = viewAdmin().main, a = S.me.admin ? overviewOf() : null, root = knRoot()
  const fbar = root ? `<div class="fbar" data-t="addRoot"><span class="fl">${svg('doc')}지식 폴더${tipb('kn.rootTeam', '지식 폴더')}</span><span class="fp" data-t="rootPath">${esc(root)}</span><span class="acts"><button class="btn" data-a="copyRoot" data-t="copyRoot">복사</button><button class="btn" data-a="syncKn" data-t="syncKn"${S.syncing ? ' disabled' : ''}>${S.syncing ? '읽는 중…' : '동기화'}</button></span></div>` : ''
  const msg = S.syncMsg ? `<div class="callout ${S.syncMsg.cls || ''} stop" data-t="syncMsg"><i></i><span>${S.syncMsg.t}</span></div>` : ''
  return v.replace(/<\/div>$/, `${fbar}${msg}${a && !a.error ? opsCard(a) : ''}</div>`)
}
// 서버 정보(누구나 · 6-2 · 6-3) — 정보(주소 · 판 · https · 팀 일꾼 · 저장소) · 로그인(나 · 내 자리 · 비밀번호 · 나가기) · 내 설정(찾기)
//   화면 밝기 · 내 기기는 머리 줄 사람 동그라미 메뉴 · 팀 사람 · 자리란? 은 지식관리 › 사람
function mineHtml(st) {
  const ks = S.kns.filter((x) => !isPersonal(x) && !x.dim)
  const seats = S.me.admin ? '<p class="small" data-t="mineBoss" style="margin:var(--sp-4) var(--sp-7)"><span class="kt role">총괄 관리자</span> 모든 팀 지식이 보이고 모두 지식관리자다</p>'
    : `<div class="tblwrap"><table class="t"><tr><th>팀 지식</th><th>나의 자리</th></tr>${ks.map((k) => `<tr data-t="mineSeat" data-name="${esc(k.name)}"><td><b>${esc(k.name)}</b></td><td>${lvChip(k)}</td></tr>`).join('') || '<tr><td class="muted" colspan="2">받은 팀 지식이 없다. 관리자가 자리를 주면 여기에 보인다</td></tr>'}</table></div>`
  const w = st.claude && st.claude.worker, wk = w && w.ok === false ? '쉼' : (st.claude && st.claude.team && st.claude.team.token) || (w && w.ok) ? '됨' : '로그인 전'
  const ov = S.me.admin ? overviewOf() : null
  const https = ov && !ov.error ? `<span>https</span><span>${ov.https ? '켬' : '아직 아니다. 사내 인증서가 생기면 켤 수 있다'}</span>` : ''
  const info = `<div class="card" data-t="serverCard"><div class="ch">정보</div><div class="cb"><div class="kv" data-t="mineServer"><span>주소</span><span class="mono">${esc(st.host)}</span><span>판</span><span>kmd v${esc(st.version)}</span>${https}<span>팀 일꾼</span><span>${wk}</span><span>저장소</span><span>${st.backup.n ? (st.backup.n < st.backup.of ? '일부만 붙음' : '붙음') : '없음'}</span></div></div></div>`
  const login = `<div class="card" data-t="mineSeats"><div class="ch">로그인 <small>아이디 ${esc(S.me.user)}</small></div><div class="cb tight">${seats}</div><div class="cb u-p1-7">${autoSw('find', '비슷한 글')}</div></div>
   <div class="card" data-t="minePw"><div class="ch">비밀번호 바꾸기${tipb('mine.pw', '비밀번호 바꾸기')}</div><div class="cb"><div class="fgrid"><div class="field"><label for="pwOld">지금 비밀번호</label><input class="inp" id="pwOld" type="password" autocomplete="current-password" data-t="pwOld"></div><div class="field"><label for="pwNew">새 비밀번호(10자 이상)</label><input class="inp" id="pwNew" type="password" autocomplete="new-password" data-t="pwNew"></div></div><button type="button" class="btn" data-a="pwChange" data-t="pwChange">바꾸기</button></div></div>
   <div class="card" data-t="mineLogout"><div class="ch">나가기</div><div class="cb u-p1-7"><div class="set"><span class="tx"><b>이 브라우저에서</b></span><button type="button" class="btn" data-a="logout" data-t="logout">나가기</button></div><div class="set"><span class="tx"><b>모든 곳에서</b><small>다른 기기 · 브라우저도</small></span><button type="button" class="btn" data-a="logoutAll" data-t="mineLogoutAll">모두 나가기</button></div></div></div>`
  return `<div class="g2"><div>${info}</div><div>${login}</div></div>`
}
// 자리 설명 한 벌(docs/kmd_권한_모델.md 1절 · 개편 뒤 「저장이 곧 반영」) — 사람 · 지식 권한 창 · 자리 (!) 이 같이 쓴다
const ROLE_TEXT = '읽기(보기 · 찾기) · 쓰기(+ 문서 고치기 · 기록 · 파일 넣기 · 가져올 곳 부탁 — 저장 제안을 승인하면 문서에 들어간다) · 지식관리자(+ 항목 지우기 · 이름 바꾸기 · 남의 기록 · 점검 · 지표 · 문서 짜임 · 다듬기 · 가져올 곳 · 권한)'
const ROLE_RULE = '<div class="cf small muted" data-t="roleRule"><span><b>총괄 관리자</b>: 사람 · 묶음 · 팀 지식 세우기 · 지우기 · 백업 · Claude 연결, 모든 지식에서 지식관리자 &nbsp;·&nbsp; <b>지식마다 자리</b>: ' + ROLE_TEXT + '. 받지 않은 지식은 보이지 않는다 · 한 사람의 자리는 주인 · 사람 줄 · 든 묶음 · 모두 가운데 가장 높은 것 · 주는 곳은 지식관리 › 사람(사람 ⋯ › 지식마다 자리) · 지식관리 › 모든 지식(지식 상세 › 권한)</span></div>'
// 팀 연결(개인 · 11절 14) — 이 PC 가 기기 열쇠로 이은 팀 서버 · 이어짐 칩 · 잇기는 팀 화면의 설치 한 줄 · 끊기는 팀 화면의 내 기기
function teamLinkCard(st) {
  const v = sendTeamsV(), teams = st.teams || []
  const chip = (u) => { if (!v) return '<span class="chip c-mute">보는 중…</span>'; if (v.error) return '<span class="chip c-danger">못 읽음</span>'; const t = (v.teams || []).find((x) => x.url === u || x.url.replace(/^https?:\/\//, '') === u.replace(/^https?:\/\//, '')); return t && t.error ? `<span class="chip c-warn" title="${esc(t.error)}">끊김</span>` : '<span class="chip c-ok">이어짐</span>' }
  const rows = teams.map((u) => `<li data-t="teamRow"><span class="u-f1"><a href="${esc(/^https?:\/\//.test(u) ? u : 'http://' + u)}" target="_blank" rel="noopener" title="팀 화면을 새 탭에서">${esc(u.replace(/^https?:\/\//, ''))} ↗</a></span>${chip(u)}</li>`).join('')
  return `<div class="card" data-t="teamLink"><div class="cb u-p1-7">${rows ? `<ul class="plain">${rows}</ul>` : `<div class="empty3" data-t="teamNone"><b>팀 연결 없음</b>${tipb('set.teamHow', '팀 연결 없음')}</div>`}</div></div>`
}
// 폴더에 붙은 개인 지식 — { kns } · 옛 PC 프로그램은 { area, kn, knName } · 팀 지식은 팀 화면 › 설정 › 에이전트 설치가 맡는다
const agKns = (f) => (Array.isArray(f.kns) ? f.kns : f.area && f.kn ? [{ area: f.area, kn: f.kn, knName: f.knName }] : []).filter((k) => k.area === 'me')
// 메뉴 줄의 지식 — 이름은 그 폴더 줄에서
const agKnOf = (el) => { const f = ((S.cache.agent || {}).folders || []).find((x) => x.path === el.dataset.v); const k = f && agKns(f).find((x) => x.area === el.dataset.area && x.kn === el.dataset.kn); return { area: el.dataset.area, kn: el.dataset.kn, knName: (k && k.knName) || el.dataset.kn } }
function agChips(f) {
  const ks = agKns(f)
  if (!ks.length) return '<span class="chip c-mute">지식을 정하지 않음</span>'
  return `<span class="u-flex u-wrap u-g2-4 u-je" data-t="agentKns">${ks.map((k) => `<span data-t="agentKn" data-kn="${esc(k.kn)}" data-area="me"><span class="kt me">개인</span> <b class="small">${esc(k.knName || k.kn)}</b></span>`).join('')}</span>`
}
// 에이전트 설치(팀 화면 › 설정 · 누구나) — 팀 지식을 고르면 그 지식의 설치 한 줄을 복사한다(core/teamkit.js).
//   한 줄은 작업 폴더에 팀 스킬 · 연결 kmd-team · 팀 안내만 쓴다. 개인 프로그램을 깔거나 올리지 않는다 · 이 PC 에 팀 열쇠가 없을 때만 표(10분 · 한 번)로 하나 받는다
//   개인 지식은 개인 화면 › 설정 › 에이전트 설치 · 붙인 폴더의 이력은 두지 않는다 — 명령을 받는 곳
function agentInstallCard() {
  const team = S.kns
  const C = S.agCopied
  const row = (k, area) => `<li data-t="agInstRow" data-area="${area}" data-name="${esc(k.name)}"${C && C.id === k.id ? ' class="on"' : ''}><span class="u-f1"><b>${esc(k.name)}</b> ${area === 'team' ? lvChip(k) : '<span class="kt me">개인</span>'}</span><button class="btn sm${C && C.id === k.id ? ' pri' : ''}" data-a="agentCopy" data-k="${esc(k.id)}" data-area="${area}" data-t="agentCopy">${C && C.id === k.id ? '다시 복사' : '설치 명령 복사'}</button></li>`
  const copied = C ? `<div class="callout gray u-blk" data-t="agCopied" style="margin:var(--sp-5) 0 0"><b>「${esc(C.name)}」 설치 명령을 복사했다</b> · 10분 안에 붙여 넣는다<div class="urlbox u-mhn" data-t="agCopiedLine">${esc(C.line)}</div></div>` : ''
  return `<div class="card" data-t="agentCard"><div class="ch">작업 폴더에 팀 지식 붙이기</div><div class="cb u-p5-7-6">
   <p class="muted small" data-t="agWinOnly">지금은 Windows PC 만 된다${/Windows/i.test(navigator.userAgent) ? '' : ' · 이 PC 는 Windows 가 아니다: 아래 줄을 붙이지 않는다(설명서 › 쓰는 사람 8절)'}</p>
   <ol class="lsteps" data-t="agGuide">
    <li><b>작업 폴더에서 PowerShell 을 연다</b><small>그 폴더의 탐색기 주소 줄에 powershell 을 치고 Enter</small></li>
    <li><b>붙일 팀 지식의 [설치 명령 복사] 를 누른다</b><small>10분 안에 붙여 넣는다</small></li>
    <li><b>PowerShell 에 붙여 넣고 Enter</b><small>「✓ … 를 붙였다」 가 나오면 끝</small></li>
    <li><b>그 폴더에서 Claude Code 를 새로 연다</b><small>팀 스킬 kmd-team-work · kmd-team-save · kmd-team-import 와 연결 kmd-team 이 붙어 있다</small></li>
   </ol>
   <details class="more" data-t="agHelp"><summary>막혔을 때 볼 것</summary><div class="in small"><ul class="plain">
    <li>지금은 Windows 만 · 개인 프로그램은 깔지 않는다. 이 PC 에 팀 열쇠가 없을 때만 10분 · 한 번짜리 번호로 하나 받는다(내 메뉴 › 내 기기)</li>
    <li>Claude Code 가 이 PC 에 있나 · 로그인했나도 한 줄로 알린다. 없으면 깔고, 로그인하지 않았으면 터미널에서 claude auth login</li>
    <li>한 폴더에 팀 지식 여럿을 붙이려면 명령을 차례로 붙인다(남길 때 세션이 어느 팀 지식에 남길지 묻는다) · 열려 있던 Claude Code 는 다시 연다</li></ul></div></details>
   <div class="callout gray u-blk" data-t="agBulk" style="margin:var(--sp-5) 0 0"><b>대량 넣기는 Claude Code 에서</b> · 폴더째 많은 파일(팀 화면 파일 넣기는 한 번에 ${TEAM_IMPORT_MAX}개)은 붙인 폴더의 Claude Code 에 「이 폴더를 팀 지식에 넣어 줘」 라고 한다(스킬 kmd-team-import · 내 PC · 내 Claude 구독) · 파일을 글로 바꾸는 파서는 처음 할 때 한 번 받는다 · 글이 없는 pdf(스캔)도 Claude Code 가 원본을 읽는다</div>
   <div class="rh">팀 지식 <small class="muted">팀 서버 · 팀 모두</small></div><ul class="plain" data-t="agInstTeam">${team.map((k) => row(k, 'team')).join('') || '<li class="muted">팀 지식이 없다</li>'}</ul>

   ${copied}</div></div>`
}
// 개인 지식 쓰기(팀 화면 · 누구나 · 옛 이름 「개인 프로그램 설치」 · K11-2) — 이 PC 에 개인 프로그램을 깔고 팀에 잇는 한 줄 ·
//   팀 지식만 쓰는 사람은 개인 프로그램이 필요 없다(설정 › 에이전트 설치 한 줄) ·
//   내 기기(팀 서버가 아는 것만 · PC 에 묻지 않는다). 개인 지식 · 개인 폴더는 보이지 않는다
function installCardHtml() {
  const line = S.lastInstall ? `<div class="callout gray u-blk" data-t="installLine" style="margin:var(--sp-5) 0 0"><b>설치 · 잇기 한 줄을 복사했다</b> · 10분 동안 한 번만 · 남에게 주지 않는다${S.lastInstallVer ? ` · 개인 프로그램 판 ${esc(S.lastInstallVer)}` : ''}<div class="urlbox u-mhn">${esc(S.lastInstall)}</div></div>` : ''
  return `<div class="card" data-t="installCard"><div class="ch">개인 프로그램 설치 <small>고를 수 있음</small>${tipb('set.install', '개인 프로그램 설치')}</div><div class="cb u-p5-7-6">
   <ol class="lsteps"><li><b>[한 줄 복사] 를 누른다</b><small>10분 동안 한 번만 · 내 이름의 기기 열쇠가 만들어진다(내 메뉴 › 내 기기)</small></li><li><b>PowerShell 에 붙여 넣고 Enter</b><small>없으면 깔고 · 옛 판이면 팀 서버의 판으로 올리고(앞 판은 남는다) · 팀에 다시 잇는다 · 관리자 권한은 쓰지 않는다</small></li><li><b>끝에 개인 화면이 열린다</b><small>다음부터는 시작 메뉴 › kmd</small></li></ol>
   <div class="row" style="margin-top:var(--sp-4)"><button class="btn" data-a="copyInstall" data-v="" data-t="installCopy">한 줄 복사</button></div>${line}</div></div>`
}
// 설치 명령 복사 — 그 팀 지식을 실은 설치 한 줄(팀 서버가 만든다)
async function agentCopy(id, area) {
  const k = KN(id)
  if (!k) return
  try {
    const r = await postJSON('/api/device/ticket', { kn: id })
    copyText(r.line)
    S.agCopied = { id, name: k.name, area, line: r.line }
    toast(`「${esc(k.name)}」 설치 명령을 복사했다. 작업 폴더의 PowerShell 에 붙여 넣는다`)
  } catch (e) { toastErr(e) }
  render()
}
// 일마다 Claude 모델 — 이 PC 만(core/models.js) · 옮겨 적기 · 고르기는 가벼운 모델 · 판단은 큰 모델
const MODEL_T = [['convert', 'pdf · hwp 를 글로', '글이 없는 pdf · 표가 깨진 hwp 만: 옮겨 적기'], ['read', '넣은 파일의 기록 정리', '무엇 · 핵심 · 정한 것 · 남은 것'], ['touch', '기록의 건드린 항목 고르기', '후보 안에서 고른다'], ['ingest', '들이기 초안', '넣은 파일 · 기록을 항목에 넣어 다시 쓴다'], ['commit', '코드 바뀜 분석', '묶음 차이를 읽는다'], ['agent', '지식에 들이기(에이전트)', '둘러보고 넣을 곳 · 항목을 정한다']]
function modelCard(st) {
  if (isTeam() || !st.models) return ''
  const opt = [['haiku', 'Haiku: 빠르고 싸다'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['', '기본: Claude Code 의 모델']]
  return `<div class="card" data-t="modelCard"><div class="ch">Claude 모델 <small>일마다</small></div><div class="cb u-p1-7">${MODEL_T.map(([r, l, d]) => `<div class="set" data-t="model-${r}"><span class="tx"><b>${l}</b><small>${d}</small></span><select class="inp" data-model="${r}" data-t="msel-${r}" aria-label="쓰는 모델" style="width:auto">${opt.map(([v, t]) => `<option value="${v}"${st.models[r] === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`).join('')}</div><div class="cf">옮겨 적기 · 고르기는 가벼운 모델로, 판단이 필요한 일만 큰 모델로: 같은 일을 덜 쓰고 빨리 한다.</div></div>`
}
// 내 기기 줄 — 설정 › 서버 정보 · 에이전트 설치가 같이 쓴다. PC(이름 · 사용자)마다 가장 최근 열쇠가 위 · 같은 PC 의 옛 열쇠는 접는다(끊을 줄을 가려내게)
const DEV_SAY = '내 이름의 기기 열쇠: 팀에 이은 PC 의 Claude Code · 개인 프로그램 · 팀 서버가 아는 것만'
function devRowHtml(d, old) {
  const nm = d.host || '이름 없는 기기'
  return `<li data-t="devRow" data-name="${esc(d.host || d.id)}"${old ? ' data-old="1"' : ''}><span class="u-f1"><b>${esc(nm)}</b>${d.osuser ? ` <small class="muted">${esc(d.osuser)}</small>` : ''}<small class="muted u-blk">열쇠 ${esc(String(d.id).slice(-4))} · 이은 때 ${esc(whenTxt(d.at))} · ${d.used ? '마지막 사용 ' + esc(whenTxt(d.used)) : '아직 쓰지 않음'}${old ? ' · 같은 PC 에서 다시 이어 남은 옛 열쇠' : ''}</small></span><button type="button" class="btn sm${old ? '' : ' ghost'}" data-a="unlinkMyDev" data-id="${esc(d.id)}" data-t="unlinkBtn" aria-label="${esc(nm)} 열쇠 ${esc(String(d.id).slice(-4))} 끊기">끊기</button></li>`
}
function devRowsHtml(devs) {
  if (!devs) return `<li>${loadingHtml}</li>`
  if (devs.error) return `<li>${errHtml(devs, 'devices')}</li>`
  if (!devs.length) return '<li class="muted">이어진 기기가 없다</li>'
  const t = (d) => Date.parse(d.used || d.at || 0) || 0
  const by = new Map()
  for (const d of devs) { const k = (d.host || d.id) + '|' + (d.osuser || ''); if (!by.has(k)) by.set(k, []); by.get(k).push(d) }
  const cur = [], old = []
  for (const g of by.values()) { g.sort((a, b) => t(b) - t(a)); cur.push(g[0]); old.push(...g.slice(1)) }
  cur.sort((a, b) => t(b) - t(a))
  return cur.map((d) => devRowHtml(d, false)).join('') + (old.length ? `<li class="u-blk"><details class="more" data-t="devOld"><summary>옛 열쇠 ${old.length} <small class="muted">같은 PC 에서 다시 이어 남은 것 · 끊어도 그 PC 는 그대로 쓴다</small></summary><ul class="plain">${old.map((d) => devRowHtml(d, true)).join('')}</ul><button type="button" class="btn sm" data-a="unlinkOldDevs" data-v="${esc(old.map((d) => d.id).join(','))}" data-t="unlinkOld">옛 열쇠 ${old.length} 모두 끊기</button></details></li>` : '')
}
// 내 기기 창(머리 줄 사람 동그라미 메뉴 › 내 기기 · 메뉴 개편 11절 2) — 개인 · 팀 같은 자리
function devWinHtml() {
  return `<div class="scrim fix" data-a="devClose" data-self="1"><div class="modal w560" role="dialog" aria-modal="true" aria-label="내 기기" data-t="devWin"><div class="mh">내 기기${tipb('set.dev', '내 기기')}<button type="button" class="x" data-a="devClose" title="닫기" aria-label="닫기">×</button></div><div class="mb"><ul class="plain" data-t="devList">${devRowsHtml(devicesOf())}</ul><p class="small muted">90일 안 쓰면 저절로 끊긴다. 내가 이은 것이 아니면 끊고 비밀번호를 바꾼다.</p></div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="devClose" id="devCloseBtn">닫기</button></span></div></div></div>`
}
// 지식백업(개인 · 5-2 · 8-3) — 경로 · [바꾸기] · 사본 n/m 지식 · 상태 칩. 지식마다의 git 저장소는 지식관리 › 모든 지식 › 저장소(두 곳을 값으로 구별)
//   불러오기는 모든 지식 머리 [불러오기] 창
function pcBackupCard(st) {
  const pcBad = S.stops.find((x) => x.kind === 'backup')
  const chip = !st.backup.n ? '<span class="chip c-warn">백업 없음</span>' : pcBad ? `<span class="chip c-warn" title="${esc(pcBad.t)}">${esc(pcBad.b)}</span>` : st.backup.n < st.backup.of ? '<span class="chip c-warn">일부만</span>' : '<span class="chip c-ok">잘 된다</span>'
  const miss = (st.backup.list || []).filter((x) => !x.url)
  return `<div class="card" data-t="pcBackupCard"><div class="cb u-p4-7-5">
   <div class="field" style="margin:0"><label for="bkRoot">경로</label><div class="row"><input class="inp mono u-f1" id="bkRoot" data-t="bkRoot" value="${esc(st.backup.root || '')}" placeholder="예: E:\\kmd-백업 · \\\\nas\\kmd"><button class="btn" data-a="bkRootSet" data-t="bkRootSet">${st.backup.root ? '바꾸기' : '정하기'}</button></div></div>
   <div class="row u-wrap u-g3" style="margin-top:var(--sp-4)" data-t="pcBackup"><span class="chip c-mute">사본 ${st.backup.n}/${st.backup.of} 지식</span>${st.backup.bad ? `<span class="chip c-warn">맞지 않음 ${st.backup.bad}</span>` : ''}${chip}</div>
   ${miss.length ? `<p class="small" style="margin:var(--sp-3) 0 0">아직 없는 지식: ${esc(miss.map((x) => x.name).join(' · '))}</p>` : ''}
   <p class="small" style="margin:var(--sp-4) 0 0"><button type="button" class="lk" data-a="mgAll" data-t="bkToRepo">지식관리 › 모든 지식</button></p></div></div>`
}
function claudeCard(st) {
  const c = st.claude, w = c.worker
  if (!isTeam()) {
    // 로그인 — 「kmd — Claude 로그인」 창(claude auth login)이 브라우저를 연다(팀 화면의 개인 쪽이면 이 PC 에) · 화면은 그 창을 알려 주고 저절로 확인한다
    const L = S.pcLogin || null
    let flow = ''
    if (L) flow = `<div class="flow" data-t="claudeFlow"><p style="margin:0 0 var(--sp-3)"><b>작업 표시줄의 「kmd: Claude 로그인」 창</b>이 떴다. 그 창이 브라우저를 연다. 브라우저에서 Claude 에 들어가면 끝이다.</p><p class="small muted" style="margin:0 0 var(--sp-4)">창이 안 보이면 작업 표시줄에서 그 창을 누른다 · 브라우저가 안 열리면 그 창에 나온 주소를 연다 · 다 되면 그 창은 닫아도 된다</p><div class="row"><span class="prog" data-t="claudeWait"><i></i>${L.checking ? '로그인을 확인하는 중…' : L.last ? esc(L.last) : '로그인을 기다린다. 몇 초마다 저절로 확인한다'}</span><button type="button" class="btn ghost sm" data-a="pcLoginCancel" data-t="claudeCancel" style="margin-left:auto">취소</button><button class="btn sm" data-a="pcLoginCheck" data-t="claudeCheck">지금 확인</button></div></div>`
    const ok = w && w.ok, bad = w && w.ok === false
    const state = bad ? (w.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : '로그인이 끝났다. 다시 로그인한다') : ok ? '로그인됨. 이 PC 의 Claude Code' : '아직 확인 전: [로그인 확인] 으로 본다'
    const row = `<div class="set"><span class="tx"><b data-t="claudeState">${state}</b><small>파일 · 기록을 Claude 로 다듬어 문서에 넣는다(안 되면 규칙으로) · 이번 달 ${c.month}건 · 로그인은 이 PC 의 Claude Code 로그인</small></span>${L ? '' : `<button class="btn" data-a="pcLoginCheck" data-t="claudeCheck" style="width:auto">로그인 확인</button><button class="btn${ok ? '' : ' pri'}" data-a="pcLoginStart" data-t="claudeLogin" style="width:auto">${ok ? '다시 로그인' : 'Claude 로그인'}</button>`}<button class="kebab${S.menu === 'claude' ? ' on' : ''}" data-a="menu" data-m="claude" data-t="claudeKebab" title="쓰지 않기">⋯${S.menu === 'claude' ? popHtml('claude', '<div><div class="mi" data-a="claudeOff" data-t="claudeOff">Claude 쓰지 않기<small>규칙으로 되는 것만</small></div></div>') : ''}</button></div>`
    return `<div class="card u-ovv" data-t="claudeCard"><div class="ch">Claude 연결</div><div class="cb u-p1-7-5">${row}${flow}</div><div class="cf">Claude Code 의 로그인은 진짜 터미널 창에서 돈다. [Claude 로그인] 이 「kmd: Claude 로그인」 창을 띄우고, 이 화면이 저절로 확인한다</div></div>`
  }
  // 팀 서버 — 관리자는 여기서 팀 일꾼 로그인을 다 한다(상태 · 로그인 시작 · 다시 로그인 · 확인) · 일반은 읽기만
  if (S.me.admin) {
    const a = overviewOf()
    if (!a || a.error) return a ? errHtml(a) : loadingHtml
    return admClaudeCard(a) + claudeHowCard(a)
  }
  const rest = w && w.ok === false
  const days = rest ? Math.max(1, Math.round((Date.now() - Date.parse(w.since)) / 864e5)) : 0
  return `<div class="card" data-t="claudeCard"><div class="ch">Claude 연결 <small>읽기만</small></div><div class="cb u-p1-7"><div class="set"><span class="tx"><b data-t="claudeRead">팀 들이기는 팀 일꾼 로그인으로 돈다. 쉬면 관리자에게 알린다</b><small>${rest ? `지금 쉬고 있다 · ${days}일: 관리자에게 알렸다` : (c.team && c.team.token) || (w && w.ok) ? '지금 돈다 · 로그인해 두는 것은 관리자' : '아직 로그인하지 않았다. 관리자가 한다'}</small></span></div></div><div class="cf">로그인은 관리자가 이 화면에서 한다</div></div>`
}
// 팀 일꾼 로그인이 무엇이고 어떻게 하는지 — 로그인 카드 아래
function claudeHowCard(a) {
  return `<div class="card" data-t="claudeHow"><div class="ch">어떻게 하나</div><div class="cb u-p2-7-5"><ul class="plain small">
   <li><span><b>쓰는 곳</b>: 팀 지식의 들이기(파일 넣기 · 가져올 곳 · 다시 들이기 · 정정) · 문서 다듬기. 로그인이 없거나 쉬면 들이기는 기다린다(24시간 넘으면 규칙 길로 넣는다)</span></li>
   <li><span><b>서버 PC 에 화면이 있으면</b>: 그 PC 에 「kmd: Claude 로그인」 창이 뜬다. 그 PC 의 브라우저에서 들어가면 이 화면이 저절로 확인한다</span></li>
   <li><span><b>화면이 없는 서버면</b>: 이 브라우저에서 주소를 열어 Claude 계정(Pro · Max · Team · Enterprise)으로 들어가고, 받은 번호를 붙여 넣는다</span></li>
   <li><span><b>열쇠</b>: 팀 서버 비밀로만 남고 화면 · 기록에 나오지 않는다${a.https ? '' : ' · 아직 https 가 아니다. 사내 https 뒤 권장'}</span></li></ul></div></div>`
}
// 로그인 확인 — 작은 부르기 한 번 · 됐으면 흐름을 닫는다
async function pcLoginCheck(byHand) {
  if (S.pcLogin) S.pcLogin.checking = true
  render()
  let r = null
  try { r = await postJSON('/api/claude/check', {}) } catch (e) { r = { ok: false, reason: e.message } }
  dropSettings()
  const C = S.claude
  if (C && r.reason !== undefined) Object.assign(C, { ok: !!r.ok, reason: r.reason || null, at: new Date().toISOString() })
  if (r.ok) { S.pcLogin = null; toast('로그인됨. 이제 가져온 지식을 Claude 가 읽고 기록 · 문서로 쓴다') }
  else if (S.pcLogin) { S.pcLogin.checking = false; S.pcLogin.last = r.reason === 'login' ? '아직 로그인 전: 그 창 · 브라우저에서 마치면 저절로 확인한다' : r.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : '확인하지 못했다. 다시 본다' }
  else if (byHand) toast(r.reason === 'login' ? '로그인이 끝났다. [Claude 로그인] 으로 다시 들어간다' : r.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : '확인하지 못했다')
  render()
  return r.ok
}
// ── 지금 하는 일 — 옆 메뉴 맨 위 점(좁은 화면은 머리 줄)(일이 있으면 깜빡인다) · 누르면 작은 팝업에 내역 ──
//   가져오기(지켜보며 맞추기) · Claude Code 일(넣은 파일 · 코드 바뀜) · 들이기 일감. 일이 있으면 3초 · 없으면 15초마다 읽는다
const BUSY_K = { source: '자동수집', run: 'Claude Code', intake: '들이기' }
// 지금 하는 일 점 — 옆 메뉴 맨 위(600 이하는 머리 줄 · 둘 중 하나만 보인다)
function busyDot(hdr) {
  if (anon() || gated()) return ''
  const n = ((S.busy && S.busy.items) || []).length
  if (S.menu === 'busy') S._pop = { key: 'busy', html: busyPopHtml() }
  return `<button type="button" class="busy${n ? ' on' : ''}${S.busyErr ? ' err' : ''}${S.menu === 'busy' ? ' open' : ''}"${S.busyErr ? ' aria-label="지금 하는 일을 읽지 못했다(서버에 닿지 않는다)"' : ''} data-a="menu" data-m="busy" data-t="${hdr ? 'busyDotHdr' : 'busyDot'}" data-n="${n}" aria-haspopup="true" aria-expanded="${S.menu === 'busy' ? 'true' : 'false'}" title="${S.busyErr ? '지금 하는 일을 읽지 못했다' : n ? `지금 하는 일 ${n}: 누르면 내역` : '지금 하는 일 없음'}"><i></i>${n ? `<span>${n}</span>` : ''}</button>`
}
// 줄 — 누르면 그 일의 진행 현황(생성 › 도는 일) · 오른쪽 끝 작은 「문서」 는 그 지식의 문서로
function busyPopHtml() {
  const xs = (S.busy && S.busy.items) || []
  const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 1000)); return s < 60 ? `${s}초` : s < 3600 ? `${Math.floor(s / 60)}분` : `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분` }
  const rows = xs.map((x) => `<div class="brow-w"><button type="button" class="mi brow" data-a="busyGo" data-kind="${esc(x.kind)}" data-k="${esc(x.kn)}" data-name="${esc(x.name || '')}" data-run="${esc(x.run || '')}" data-qid="${esc(x.qid || '')}" data-job="${esc(x.job || '')}" data-t="busyRow"><i class="bd"></i><span class="bt"><b>${esc(x.title)}</b><small>${esc(BUSY_K[x.kind] || x.kind)} · ${esc(x.knName)} · ${esc(x.small || '')}</small></span><small>${ago(x.since)}</small></button><button type="button" class="lk bdoc" data-a="busyDoc" data-k="${esc(x.kn)}" data-t="busyDoc" title="${esc(x.knName)} 의 문서">문서</button></div>`).join('')
  const bad = S.busyErr ? `<div class="callout danger err" data-t="busyErr" style="margin:var(--sp-2) var(--sp-4)">${sayErr('지금 하는 일을 읽지 못했다')}<b>읽지 못했다: ${esc(S.busyErr)}${xs.length ? ' · 아래는 지난번 것' : ''}</b><button type="button" class="btn sm retry" data-a="busyRetry" data-t="retry">다시 읽기</button></div>` : ''
  return `<div class="gray pop-h"><b>지금 하는 일</b> ${xs.length ? xs.length : ''}</div>${bad}${rows || (S.busyErr ? '' : '<div class="gray" data-t="busyNone">지금 하는 일이 없다. 자동수집 · 들이기 · Claude Code 일이 돌면 여기 보인다</div>')}`
}
let busyTimer = null
let busyHot = 0 // 이때까지는 일이 없어도 3초마다(postJSON 뒤)
async function loadBusy() {
  clearTimeout(busyTimer)
  if (!S.me || anon()) return
  // 팝업에만 보이는 글은 팝업이 닫혀 있으면 다시 그릴 까닭이 아니다
  const sig = (xs) => JSON.stringify((xs || []).map((x) => (S.menu === 'busy' ? x : { ...x, small: undefined })))
  const before = sig(S.busy && S.busy.items)
  let err = null
  const v = await getJSON('/api/busy').catch((e) => { err = e.message || '서버에 닿지 않는다'; return null })
  // 받지 못했다 — 지난 목록을 「지금」 처럼 보이지 않게(팝업 머리 · 점 title 이 말한다)
  if (err !== (S.busyErr || null)) { S.busyErr = err; busyPaint(); if (S.menu === 'busy') render() }
  if (v) {
    // 뒤에서 돌던 가져오기가 끝났다 — 가져오기 화면의 줄(마지막 · 그대로 · 바뀜)도 새로
    const was = ((S.busy && S.busy.items) || []).filter((x) => x.kind === 'source')
    if (S.route.scr === 'import' && was.some((x) => !v.items.some((y) => y.kind === 'source' && y.kn === x.kn && y.name === x.name))) {
      await fetchSrcs()
    }
    const gone = ((S.busy && S.busy.items) || []).filter((x) => (x.kind === 'run' || x.kind === 'intake') && !v.items.some((y) => (y.qid || y.job || y.run) === (x.qid || x.job || x.run)))
    if (gone.length && S.route.scr !== 'import') { toast(`<b>${esc(gone[0].title)} 끝났다</b>${gone.length > 1 ? ` 외 ${gone.length - 1}` : ''} · <button type="button" class="lk" data-a="openSet" data-v="import">생성에서 보기</button>`, 9000); reloadKns().then(() => render()) }
    S.busy = v
    // 바뀌었거나 팝업이 열려 있으면(지난 시간) 다시 그린다 — 쓰는 중인 칸은 건드리지 않는다
    //   글 칸만 「쓰는 중」 이다(파일 고르기 · 고르기 칸에 초점이 남아도 점은 바뀌어야 한다 — 188 시험 T12)
    const ae = document.activeElement
    const typing = !!ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !/^(file|checkbox|radio|button|submit)$/.test(ae.type)))
    if ((sig(v.items) !== before || S.menu === 'busy') && !typing) render()
    else if (typing) busyPaint() // 다시 그리지 못해도 점(옆 메뉴 · 머리 줄)만은 같은 상태로
  }
  if (!document.hidden) busyTimer = setTimeout(loadBusy, (v && v.items.length) || Date.now() < busyHot ? 3000 : 15000)
}
// 지금 하는 일 점만 고쳐 그린다 — 옆 메뉴 · 머리 줄(600 이하) 둘이 늘 같은 상태(.on · 수)
function busyPaint() {
  for (const el of document.querySelectorAll('#app [data-t=busyDot], #app [data-t=busyDotHdr]')) {
    const w = document.createElement('div')
    w.innerHTML = busyDot(el.dataset.t === 'busyDotHdr')
    if (w.firstElementChild) el.replaceWith(w.firstElementChild)
  }
}
// ── Claude 연결 — 머리의 칩 · 창 ──
//   가져온 지식(넣은 파일 · git 묶음)은 Claude 가 읽고 기록으로 쓰고, 그 기록으로 문서를 세운다 — 구독형 Claude 로그인이 있어야 한다.
//   로그인은 이 PC 의 Claude Code 에 남아 저절로 이어진다. 화면은 30분마다 상태를 읽고, 6시간이 지났으면 작은 부르기로 확인하고,
//   끝났으면(로그인 · 한도) 칩이 빨갛게 · 들어올 때 창을 한 번 띄운다
// 팀 화면 — 팀 일꾼 로그인(팀 서버 · 총괄 관리자) · 개인 화면 — 내 Claude 로그인
async function loadClaude({ verify = false } = {}) {
  // 읽지 못하면 「아직 확인 전」 으로 남기지 않고 칩을 「읽지 못함」 으로(Q45) · 다음에 읽으면 걷는다
  try { S.claude = await getJSON('/api/claude/state'); S.claudeErr = null } catch (e) { console.warn('Claude 상태를 읽지 못했다', e); S.claudeErr = e.message || '서버에 닿지 않는다'; render(); return }
  const c = S.claude
  if (c && verify && c.pc && !c.off && (c.ok !== true || !c.at || Date.now() - Date.parse(c.at) > 6 * 3600_000)) {
    const r = await postJSON('/api/claude/check', {}).catch((e) => { console.warn('Claude 로그인을 확인하지 못했다', e); return null })
    if (r) Object.assign(c, { ok: r.ok, reason: r.reason || null, at: new Date().toISOString() })
  }
  if (c && c.pc && !c.off && c.ok === false && !S.claudeAsked) { S.claudeAsked = true; S.claudeWin = true }
  render()
}
function claudeOpen() { S.claudeWin = true; render() }
function claudeTone(c) { return S.claudeErr ? 'err' : !c ? 'unk' : c.off ? 'off' : c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'unk' }
function claudeChip() {
  const c = S.claude, st = claudeTone(c)
  const tip = { ok: 'Claude 연결됨', bad: c && c.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : 'Claude 로그인이 필요하다', off: 'Claude 쓰지 않음', unk: 'Claude 연결: 아직 확인 전', err: 'Claude 연결: 상태를 읽지 못했다' }[st]
  return `<button type="button" class="hlink cchip ${st}" data-a="claudeOpen" data-t="claudeChip" data-state="${st}" title="${tip}: 누르면 연결 창">${'<i class="cdot"></i>'}<span>Claude</span></button>`
}
function claudeWinHtml() {
  const c = S.claude || {}, st = claudeTone(S.claude), L = S.pcLogin
  const stateTxt = { ok: '연결됨. 이 PC 의 Claude Code 로그인', bad: c.reason === 'limit' ? 'Claude 사용 한도에 닿았다. 한도가 풀리면 저절로 이어진다' : '로그인이 필요하다. 아래 [Claude 로그인]', off: 'Claude 쓰지 않기로 해 두었다. 설정 › Claude 연결에서 켠다', unk: '아직 확인 전: [로그인 확인] 으로 본다', err: `상태를 읽지 못했다: ${S.claudeErr || ''} · [로그인 확인] 으로 다시 읽는다` }[st]
  const when = c.at ? ` · ${esc(whenTxt(c.at))} 확인` : ''
  const why = '<p class="small" style="margin:0 0 var(--sp-4)">kmd 는 가져온 지식: <b>넣은 파일 · git 묶음</b>: 을 Claude 가 읽고 분석해 <b>기록</b>으로 쓰고, 그 기록으로 <b>문서</b>를 세운다. 그래서 구독형 Claude(Pro · Max · Team · Enterprise) 로그인이 있어야 한다. 로그인이 없으면 받은 글 그대로 기록하고 규칙으로만 넣는다.</p>'
  let body, foot
  if (c.pc) {
    const flow = L ? `<div class="callout gray u-blk" data-t="claudeWinFlow"><b>작업 표시줄의 「kmd: Claude 로그인」 창</b>이 떴다. 그 창이 브라우저를 연다.<ol class="small"><li>브라우저에서 Claude 계정(구독)으로 들어가 <b>허락</b>을 누른다</li><li>「로그인됨」 이 나오면 그 창은 닫아도 된다</li><li>이 창이 몇 초마다 저절로 확인한다</li></ol><div class="row" style="margin-top:var(--sp-4)"><span class="prog" data-t="claudeWait"><i></i>${L.checking ? '로그인을 확인하는 중…' : L.last ? esc(L.last) : '로그인을 기다린다'}</span><button type="button" class="btn ghost sm" data-a="pcLoginCancel" style="margin-left:auto">취소</button></div><p class="small muted" style="margin:var(--sp-3) 0 0">창이 안 보이면 작업 표시줄에서 누른다 · 브라우저가 안 열리면 그 창에 나온 주소를 연다</p></div>` : ''
    body = `${why}<div class="cst cchip ${st}" data-t="claudeWinState"><i class="cdot"></i><b>${stateTxt}</b><small class="muted">${when}</small></div>${flow}<p class="small muted" style="margin:var(--sp-4) 0 0">로그인은 이 PC 의 Claude Code 에 남아 다시 켜도 이어진다 · kmd 가 때때로 확인하고 끝나면 이 창을 다시 띄운다</p>`
    foot = `<button type="button" class="btn ghost" data-a="claudeClose">닫기</button><button class="btn" data-a="pcLoginCheck" data-t="claudeWinCheck"${L && L.checking ? ' disabled' : ''}>로그인 확인</button>${L ? '' : `<button class="btn${st === 'ok' ? '' : ' pri'}" data-a="pcLoginStart" data-t="claudeWinLogin">${st === 'ok' ? '다시 로그인' : 'Claude 로그인'}</button>`}`
  } else {
    // 팀 화면 — 팀 일꾼 로그인(팀 서버 · 팀 지식 · 총괄 관리자가 한다) · 내 Claude 로그인은 개인 화면에서



    body = `${why}<div class="rh" style="margin:0 0 var(--sp-2)">팀 일꾼 로그인 <small class="muted">팀 지식 · 팀 서버 · 총괄 관리자가 한다 · 내 Claude 로그인은 개인 화면 › 설정 › Claude 연결</small></div><div class="cst cchip ${st}" data-t="claudeWinState"><i class="cdot"></i><b>${st === 'ok' ? '팀 일꾼 로그인이 돈다' : st === 'bad' ? '팀 일꾼 로그인이 쉬고 있다. 관리자에게 알렸다' : '팀 일꾼 로그인: 관리자가 해 둔다'}</b><small class="muted">${when}</small></div>`

    foot = `<button type="button" class="btn ghost" data-a="claudeClose">닫기</button>${S.me.admin ? `<button class="btn" data-a="toTeamClaude" data-t="claudeToTeam">${esc(setWhere('server'))} ›</button>` : ''}`
  }
  return `<div class="scrim fix" data-a="claudeClose" data-self="1"><div class="modal w560 cwin" data-t="claudeWin"><div class="mh">Claude 연결<button type="button" class="x" data-a="claudeClose" title="닫기" aria-label="닫기">×</button></div><div class="mb">${body}</div><div class="mf"><span class="acts">${foot}</span></div></div></div>`
}
// 창을 띄운 뒤 — 8초마다 확인(10분까지)
function pcLoginPoll() {
  const L = S.pcLogin
  if (!L) return
  setTimeout(async () => {
    if (S.pcLogin !== L || Date.now() - L.since > 10 * 60_000) return
    if (!(await pcLoginCheck(false))) pcLoginPoll()
  }, 8000)
}
const agentOf = () => need('agent', '/api/agent')
function agBtn() { const ok = /^([A-Za-z]:\\|\/)./.test((S.agDraft || '').trim()); return `<button class="btn pri" data-a="agentAddOk" data-t="agentAddOk"${ok ? '' : ' disabled'}>더하기</button>` }
function agentCard() {
  if (!isTeam()) {
    const A = agentOf()
    if (!A) return loadingHtml
    if (A.error) return errHtml(A)
    const oldN = A.folders.filter((f) => f.state !== 'latest').length
    const rows = A.folders.map((f) => {
      const old = f.state !== 'latest', mk = 'ag:' + f.path
      const ks = agKns(f)
      const kv = (k) => `data-v="${esc(f.path)}" data-area="me" data-kn="${esc(k.kn)}"`
      const knMenu = ks.length > 1 ? ks.map((k) => `<div class="mi" data-a="agentDrop" ${kv(k)} data-t="agentDrop">「${esc(k.knName || k.kn)}」 떼기<small>다른 개인 지식은 그대로</small></div>`).join('') : ''
      return `<li data-t="agentRow" data-name="${esc(f.name)}"><span class="u-f1"><b>${esc(f.name)}</b><small class="muted mono u-blk">${esc(f.path)}</small></span>${agChips(f)}${old ? `<span class="chip c-warn" data-t="agentState">${f.state === 'none' ? '없음. 다시 붙인다' : '옛 판: 고침 있음'}</span><small class="muted">${esc(f.ver || '')}</small>` : `<span class="chip c-acc" data-t="agentState">최신 · ${esc(A.latest)}</span>`}<button class="kebab${S.menu === mk ? ' on' : ''}" data-a="menu" data-m="${esc(mk)}" data-t="agentKebab" title="지식 더하기 · 떼기 · 빼기">⋯${S.menu === mk ? popHtml(mk, `<div>${old ? `<div class="mi" data-a="agentUp" data-v="${esc(f.path)}" data-t="agentUp">최신으로<small>kmd 안내만 바꾼다</small></div>` : ''}<div class="mi" data-a="agentMore" data-v="${esc(f.path)}" data-t="agentMoreKn">개인 지식 더하기<small>개인 지식만</small></div>${knMenu}<div class="mi" data-a="agentRm" data-v="${esc(f.path)}" data-t="agentRm">빼기<small>스킬 · 연결 · kmd 안내를 걷는다</small></div></div>`) : ''}</button></li>`
    }).join('')
    const add = S.agAdding ? `<div class="paste" style="margin-top:var(--sp-5)"><input class="inp mono" id="agIn" aria-label="작업 폴더 경로" data-in="ag" data-t="agIn" value="${esc(S.agDraft || '')}" placeholder="작업 폴더 경로: 예: D:\\work\\dpms-batch" autocomplete="off"><select class="inp" id="agKnMe" aria-label="붙일 개인 지식" data-in="agKnMe" data-t="agKnMe" style="width:auto">${agMeKns().map((k) => `<option value="${esc(k.id)}"${k.id === (S.agKnMe || (agMeKns()[0] || {}).id) ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select><span id="agBtnBox">${agBtn()}</span></div>` : '<button class="btn pri" data-a="agentAdd" data-t="agentAddBtn" style="margin-top:var(--sp-5)">폴더 더하기</button>'
    return `<div class="card u-ovv" data-t="agentCard"><div class="ch">작업 폴더<span class="r"><button class="kebab${S.menu === 'agAll' ? ' on' : ''}" data-a="menu" data-m="agAll" data-t="agentAllKebab" title="지금 모두 최신으로">⋯${S.menu === 'agAll' ? popHtml('agAll', `<div><div class="mi" data-a="agentAllNew" data-t="agentAllNew">지금 모두 최신으로<small>${oldN ? '옛 판 ' + oldN : '모두 최신'}</small></div></div>`) : ''}</button></span></div><div class="cb u-p1-7-6">${S.agMsg ? `<div class="callout" data-t="agentMsg">${S.agMsg}</div>` : ''}<ul class="plain" data-t="agentList">${rows || '<li class="muted">아직 붙인 폴더가 없다</li>'}</ul>${add}
   <details class="more" data-t="agentMore"><summary>자세히: 무엇이 깔리나</summary><div class="in">개인 스킬 셋: <code>kmd-work</code> · <code>kmd-save</code> · <code>kmd-build</code>(파일을 지식에 들이기)<br>연결: <code>kmd</code>(이 PC 의 개인 프로그램) 하나 · 열쇠는 이 PC 의 자격 저장소에서 꺼낸다<br>이 폴더의 개인 지식: CLAUDE.md 안내에 표가 적힌다. 세션은 표의 지식 모두에서 읽고, 여럿이면 남기기 전에 어느 지식에 남길지 묻는다<br>팀 지식: 따로 붙인다(팀 화면 › 설정 › 에이전트 설치 · 스킬 <code>kmd-team-work</code> · <code>kmd-team-save</code> · 연결 <code>kmd-team</code>). 여기서는 건드리지 않는다<br>안내 한 단락: <code>CLAUDE.md</code> 안 kmd 안내 · 사람이 고친 줄은 그대로 두고 kmd 안내만 바꾼다</div></details></div></div>`
  }
  const devs = devicesOf()
  return `<div class="card" data-t="agentCard"><div class="ch">작업 폴더</div><div class="cb u-p1-7-6"><div class="set"><span class="tx"><b>이 PC 의 Claude Code 로 쓰려면: 설치 한 줄 복사</b><small>작업 폴더의 터미널에 붙여 넣는다 · 10분 동안 한 번만 · 개인 프로그램이 있으면 그 프로그램에 폴더를 더한다</small></span><button class="btn pri" data-a="copyInstall" data-t="copyInstall">설치 한 줄 복사</button></div>
  <div class="rh">내 기기 <small class="muted">${DEV_SAY}</small></div><ul class="plain" data-t="agentDevs">${devRowsHtml(devs)}</ul><p class="small muted">기기의 kmd 스킬은 그 기기의 kmd 가 최신으로 맞춘다.</p></div></div>`
}
// 에이전트에 붙일 개인 지식 — 개인 화면의 지식 모두
const agMeKns = () => S.kns
// kn — 지식 하나에 하는 일(rm 의 떼기) { area, kn, knName }
async function agentDo(what, dir, kn = null) {
  try {
    const r = await postJSON(('/api/agent/' + what), dir ? { dir, ...(what === 'add' ? { kn: S.agKnMe || (agMeKns()[0] || {}).id || '' } : {}), ...(kn ? kn : {}) } : {})
    if (what === 'add') { S.agAdding = false; S.agDraft = ''; S.agMsg = r.again ? `<b>이 폴더에 더했다. 이 폴더의 개인 지식 ${(r.kns || []).length} · 남길 때 세션이 어느 지식에 남길지 묻는다</b>` : `<b>Claude Code 에 kmd 를 붙였다. 스킬 · 연결 · 안내 한 단락</b> · ${esc(r.dir)}` }
    else if (what === 'rm' && kn) S.agMsg = r.kns ? `<b>「${esc(kn.knName)}」 을 뗐다. 붙은 지식 ${r.kns.length}</b>` : '<b>마지막 지식을 떼어 폴더를 뺐다</b>'
    else S.agMsg = what === 'rm' ? '<b>뺐다. 스킬 · 연결 · kmd 안내를 걷었다</b>' : `<b>최신으로: ${r.n}곳</b>`
  } catch (e) { S.agMsg = `<b>${esc(e.message)}</b>` }
  S.menu = null
  delete S.cache.agent
  render()
}

// ── 권한 — 지식 하나의 자리 표(docs/kmd_권한_모델.md 6절) ──
//   지식 카드 ⋯ › 권한 · 문서 화면 속성 칸 「쓰는 사람」 의 [권한](관리 자리). 주인은 맨 위 고정 · 모두(그 밖의 사람)의 기본 자리 ·
//   사람 줄 · 묶음 줄마다 자리 + 빼기 · 더하기. 저장 한 번에 보낸다(총괄 관리자면 비밀번호 한 번 더 — postJSON 이 묻는다)
const accSig = (a) => JSON.stringify([a.all, Object.entries(a.users).sort(), Object.entries(a.groups).sort()])
const accDirty = () => !!S.acc && !!S.acc.v && accSig(S.acc) !== S.acc.orig
async function accOpen(k) {
  S.menu = null
  S.acc = { k, v: null, err: null, busy: false, addU: '', addG: '' }
  render()
  try {
    const v = await getJSON(`/api/k/${encodeURIComponent(k)}/access`)
    if (!S.acc || S.acc.k !== k) return
    S.cache['access:' + k] = v
    Object.assign(S.acc, { v, all: v.all, users: { ...v.users }, groups: { ...v.groups } })
    delete S.acc.users[v.owner] // 주인은 맨 위 줄 하나로
    S.acc.orig = accSig(S.acc)
  } catch (e) { if (S.acc && S.acc.k === k) S.acc.err = e.message }
  render()
}
const accSel = (attr, cur, list, label) => `<select class="inp acc-lv" ${attr} aria-label="${esc(label)}">${list.map((l) => `<option value="${l}"${cur === l ? ' selected' : ''}>${LV_N[l]}</option>`).join('')}</select>`
function accHtml() {
  const a = S.acc, n = KN(a.k) || { name: a.k }, v = a.v
  const busy = a.busy ? ' data-busy="1"' : ''
  const head = `<div class="mh">권한: ${esc(n.name)}${tipb('acc', '권한')}<button type="button" class="x" data-a="accClose" title="닫기" aria-label="닫기">×</button></div>`
  if (!v) return `<div class="scrim fix" data-a="accClose" data-self="1"${busy}><div class="modal w560" data-t="accWin">${head}<div class="mb">${a.err ? formErr(`<i></i><span>${esc(a.err)}</span>`, 'accErr', `<button type="button" class="btn sm retry" data-a="accOpen" data-k="${esc(a.k)}">다시 읽기</button>`, true) : loadingHtml}</div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="accClose">취소</button></span></div></div></div>`
  const people = (v.people || []).filter((p) => p !== v.owner)
  const uRow = (u) => `<li data-t="accUser" data-name="${esc(u)}"><span class="av2">${esc(u.slice(0, 1))}</span><span class="nm">${esc(u)}</span>${accSel(`data-acc="u" data-v="${esc(u)}" data-t="accUserLv"`, a.users[u], LVS.slice(1), u + ' 의 자리')}<button type="button" class="btn sm ghost" data-a="accDrop" data-kind="u" data-v="${esc(u)}" data-t="accUserDrop">빼기</button></li>`
  const gRow = (g) => `<li data-t="accGroup" data-name="${esc(g)}"><span class="av2 all">${esc(g.slice(0, 1))}</span><span class="nm">${esc(g)}<small>묶음</small></span>${accSel(`data-acc="g" data-v="${esc(g)}" data-t="accGroupLv"`, a.groups[g], LVS.slice(1), '묶음 ' + g + ' 의 자리')}<button type="button" class="btn sm ghost" data-a="accDrop" data-kind="g" data-v="${esc(g)}" data-t="accGroupDrop">빼기</button></li>`
  const freeU = people.filter((p) => !(p in a.users)), freeG = (v.groupNames || []).filter((g) => !(g in a.groups))
  const addRow = (kind, free, cur, ph, btn) => free.length ? `<div class="row acc-add"><select class="inp" data-acc="add${kind}" data-t="accAdd${kind}Pick" aria-label="${esc(ph)}"><option value="">${esc(ph)}</option>${free.map((x) => `<option value="${esc(x)}"${cur === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select><button type="button" class="btn sm" data-a="accAdd" data-kind="${kind}" data-t="accAdd${kind}"${cur ? '' : ' disabled'}>${btn}</button></div>` : ''
  const us = Object.keys(a.users).sort(), gs = Object.keys(a.groups).sort()
  const nCh = accDirty()
  // 주인 바꾸기 — 총괄 관리자만(서버 POST …/owner · 비밀번호 한 번 더는 postJSON 이 묻는다). 바꾼 자리가 있으면 먼저 저장 · 취소
  const canOwn = isTeam() && !!S.me.admin
  const ownPick = canOwn && a.own != null ? `<div class="row acc-add" data-t="accOwnForm"><select class="inp" data-acc="own" data-t="accOwnPick" aria-label="새 주인"><option value="">새 주인 고르기</option>${(v.people || []).filter((p) => p !== v.owner).map((p) => `<option value="${esc(p)}"${a.own === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select><button type="button" class="btn ghost sm" data-a="accOwnCancel">취소</button><button type="button" class="btn sm" data-a="accOwnDo" data-t="accOwnDo"${a.own && !a.busy ? '' : ' disabled'}>주인 바꾸기</button></div>` : ''
  const ownBtn = canOwn && a.own == null ? `<button type="button" class="btn sm ghost" data-a="accOwnOpen" data-t="accOwnOpen"${nCh ? ' disabled title="바꾼 자리를 먼저 저장하거나 취소한다"' : ''}>주인 바꾸기</button>` : ''
  return `<div class="scrim fix" data-a="accClose" data-self="1"${busy}><div class="modal w560" data-t="accWin">${head}<div class="mb">
  <ul class="plain pl acc">
   <li data-t="accOwner"><span class="av2">${esc((v.owner || '관').slice(0, 1))}</span><span class="nm">${esc(v.owner || '총괄 관리자')}<small>${v.owner ? '주인 · 늘 지식관리자' : '주인이 없다. 총괄 관리자가 관리한다'}</small></span>${ownBtn}<span class="kt lv-admin">지식관리자</span></li>
  </ul>
  ${ownPick}
  <ul class="plain pl acc">
   <li data-t="accAll"><span class="av2 all">모</span><span class="nm">모두<small>그 밖의 사람 · 들어오는 사람의 기본 자리</small></span>${accSel('data-acc="all" data-t="accAllLv"', a.all, LVS, '모두의 자리')}</li>
  </ul>
  <div class="sub">사람 ${us.length} <small class="muted">이 사람만 따로</small></div>
  <ul class="plain pl acc" data-t="accUsers">${us.map(uRow).join('') || '<li class="muted small" data-t="accUsersNone">따로 준 사람이 없다</li>'}</ul>
  ${addRow('U', freeU, a.addU, '사람 고르기', '사람 더하기')}
  <div class="sub">묶음 ${gs.length} <small class="muted">묶음 안 사람 모두에게</small></div>
  <ul class="plain pl acc" data-t="accGroups">${gs.map(gRow).join('') || `<li class="muted small" data-t="accGroupsNone">${(v.groupNames || []).length ? '따로 준 묶음이 없다' : '묶음이 없다. 관리자가 관리 › 묶음에서 만든다'}</li>`}</ul>
  ${addRow('G', freeG, a.addG, '묶음 고르기', '묶음 더하기')}
  ${v.legacy ? '<p class="small muted" data-t="accLegacy">아직 자리 표가 없다(기본 없음). 저장하면 이 표로 적힌다</p>' : ''}
  ${a.err ? formErr(`<i></i><span>${esc(a.err)}</span>`, 'accErr', '', true) : ''}
  </div><div class="mf"><span class="l" data-t="accNote">${nCh ? '바꾼 것이 있다 · 저장하면 곧바로 적용된다' : '바꾼 것이 없다'}</span><span class="acts"><button type="button" class="btn ghost" data-a="accClose" data-t="accCancel">취소</button><button type="button" class="btn pri" data-a="accSave" data-t="accSave"${nCh && !a.busy ? '' : ' disabled'}>${a.busy ? '저장하는 중…' : '저장'}</button></span></div></div></div>`
}
// 고르기 칸 — 자리 바꾸기 · 더할 사람 · 묶음 고르기
function accPick(t) {
  const a = S.acc, f = t.dataset.acc
  if (!a || !a.v) return
  if (f === 'all') a.all = t.value
  else if (f === 'u') a.users[t.dataset.v] = t.value
  else if (f === 'g') a.groups[t.dataset.v] = t.value
  else if (f === 'addU') a.addU = t.value
  else if (f === 'addG') a.addG = t.value
  else if (f === 'own') a.own = t.value
  a.err = null
  render()
}
async function accSave() {
  const a = S.acc
  if (!a || a.busy || !accDirty()) return
  a.busy = true; a.err = null; render()
  try {
    await postJSON(`/api/k/${encodeURIComponent(a.k)}/access`, { all: a.all, users: a.users, groups: a.groups })
    S.acc = null
    delete S.cache['access:' + a.k]; delete S.cache['owner:' + a.k]; delete S.cache.users; delete S.cache.groups
    await reloadKns() // 내 자리 · 목록이 바뀌었을 수 있다(나를 뺐으면 그 지식이 사라진다)
    toast('권한을 저장했다')
  } catch (e) { if (S.acc) { S.acc.busy = false; S.acc.err = e.code === 'E_CANCEL' ? null : e.message } }
  render()
}
// 주인 바꾸기 — 확인 창 → POST …/owner(총괄 관리자 · 비밀번호 한 번 더) → 자리 표를 다시 읽는다(옛 주인은 사람 줄로 남지 않는다)
async function accOwnDo() {
  const a = S.acc
  if (!a || a.busy || !a.own || accDirty()) return
  const to = a.own, k = a.k, n = KN(k) || { name: k }
  if (!(await ask1('주인 바꾸기', '주인 바꾸기', true, `${n.name}: 주인 ${a.v.owner || '없음'} → ${to}. 새 주인은 늘 지식관리자다 · 앞 주인은 사람 줄(관리)로 남는다`))) return
  if (!S.acc || S.acc.k !== k) return
  a.busy = true; a.err = null; render()
  try {
    await postJSON(`/api/k/${encodeURIComponent(k)}/owner`, { owner: to })
    delete S.cache['owner:' + k]; delete S.cache['access:' + k]; delete S.cache.users
    await reloadKns()
    toast(`주인을 바꿨다: ${esc(to)}`)
    await accOpen(k)
  } catch (e) { if (S.acc) { S.acc.busy = false; S.acc.err = e.code === 'E_CANCEL' ? null : e.message } render() }
}

// ── 관리(목업 M14) — 문제 줄만 ──
const overviewOf = () => need('admin', '/api/admin/overview')
const usersOf = () => need('users', '/api/admin/users')
const leftMin = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000))
// 사람 카드 — 더하기 · 사람마다 새 링크(골라서) · 관리자 켜고 끄기 · 기기 끊기 · 떠남. 떠난 사람은 접어 둔다(아이디는 되쓰지 않는다)
const admGuideText = (L) => [`kmd 팀 지식에 들어오기: ${L.id}`, '', `1. 처음 들어오기 링크(24시간 · 한 번): ${L.link}`, '   링크를 열고 비밀번호를 정한다', `2. 다음부터는 ${location.origin} 에서 아이디 ${L.id} 로 들어온다`, '3. 작업 폴더의 Claude Code 에 팀 지식을 붙이려면: 설정 › 에이전트 설치 › [설치 명령 복사]'].join('\n')
function admPeopleCard() {
  const u = usersOf()
  if (!u || u.error) return `<div class="card" data-t="admPeople"><div class="ch">사람</div><div class="cb u-p4-7">${u ? errHtml(u) : loadingHtml}</div></div>`
  const live = u.users.filter((x) => !x.off && !x.legacyOnly), gone = u.users.filter((x) => x.off)
  const st = (x) => (u && Array.isArray(u.locked) ? u.locked : []).some((l) => l.user === x.id) ? '여러 번 틀려 잠시 막힘(점검에서 풀기)' : x.password ? '들어온다' : x.firstExp && leftMin(x.firstExp) <= 0 ? '링크 지남: 새 링크를 만든다' : x.firstOpen ? `링크 보냄 · ${Math.floor(leftMin(x.firstExp) / 60)}시간 ${leftMin(x.firstExp) % 60}분 남음` : '비밀번호를 안 정함'
  const mk = (x) => 'pp:' + x.id
  const row = (x) => `<li data-t="admPerson" data-name="${esc(x.id)}"><span class="av2">${esc(x.id.slice(0, 1))}</span><span class="nm">${esc(x.id)}${x.admin ? ' <span class="kt role">총괄 관리자</span>' : ''}<small>${esc(st(x))} · 기기 ${x.devices}${x.roles.team ? ` · 주인 ${x.roles.team}` : ''}${x.admin ? ' · 모든 지식 지식관리자' : ` · <span data-t="admPersonKns">지식 ${x.roles.kns || 0}개에 자리</span>`}</small></span>${S.admLink && S.admLink.id === x.id ? `<span class="mono small ell mw260" data-t="admLinkOut">${esc(S.admLink.link)}</span><button type="button" class="lk" data-a="admCopyLink" data-t="admCopyLink">링크만 복사</button><button type="button" class="lk" data-a="admCopyGuide" data-t="admCopyGuide">안내 복사</button>` : ''}${x.id === S.me.user ? '' : `<button class="kebab${S.menu === mk(x) ? ' on' : ''}" data-a="menu" data-m="${esc(mk(x))}" data-t="admPersonKebab" title="지식마다 자리 · 새 링크 · 총괄 관리자 · 기기 · 떠남">⋯${S.menu === mk(x) ? popHtml(mk(x), `<div>${x.admin ? '' : `<div class="mi" data-a="seatOpen" data-v="${esc(x.id)}" data-t="seatOpen">지식마다 자리<small>없음 · 읽기 · 쓰기 · 지식관리자</small></div><div class="sep"></div>`}<div class="mi" data-a="admLink1" data-v="${esc(x.id)}" data-pw="${x.password ? 1 : 0}" data-t="admLink1">새 링크<small>24시간 · 한 번 · 지금 비밀번호는 지워진다</small></div><div class="mi" data-a="admLogoutAll" data-v="${esc(x.id)}" data-t="admLogoutAll">모든 곳에서 내보내기<small>브라우저만</small></div><div class="mi" data-a="admAdminSet" data-v="${esc(x.id)}" data-on="${x.admin ? '' : '1'}" data-t="admAdminSet">${x.admin ? '총괄 관리자 아님으로' : '총괄 관리자로'}</div><div class="mi" data-a="admRevokeAll" data-v="${esc(x.id)}" data-t="admRevokeAll">기기 모두 끊기<small>그 사람이 다시 잇는다</small></div><div class="sep"></div><div class="mi danger" data-a="admOffOpen" data-v="${esc(x.id)}" data-t="admOffOpen">떠남…<small>들어가기 · 기기를 끊고 지식을 넘긴다</small></div></div>`) : ''}</button>`}</li>`
  const add = S.admAdd ? `<div class="flow" data-t="admAddForm"><div class="row"><input class="inp u-f1" id="admAddIn"${invAttr(S.admAdd.err, 'admAddErr')} aria-label="새 사람 아이디" data-in="admAddId" data-t="admAddIn" value="${esc(S.admAdd.id || '')}" placeholder="아이디: 영문 · 숫자 · . _ -" autocomplete="off"><label class="small"><input type="checkbox" id="admAddAdmin"${S.admAdd.admin ? ' checked' : ''} data-a="admAddAdmin" data-t="admAddAdmin"> 총괄 관리자</label></div>${seatTable(S.admAdd.seats, 'add', S.admAdd.admin)}${S.admAdd.err ? formErr(S.admAdd.err, 'admAddErr') : ''}<div class="row u-je" style="margin-top:var(--sp-4)"><button type="button" class="btn ghost" data-a="admAddCancel">취소</button><button class="btn pri" data-a="admAddDo" data-t="admAddDo">더하기</button></div></div>` : ''
  return `<div class="card u-ovv" data-t="admPeople"><div class="ch">사람 ${live.length}</div><div class="cb u-p1-7-5">${add}<ul class="plain pl">${live.map(row).join('')}</ul>${gone.length ? `<details class="more" data-t="admGone"><summary>떠난 사람 ${gone.length}: 아이디는 되쓰지 않는다</summary><div class="in">${gone.map((x) => `${esc(x.id)} · ${esc(String(x.off.at).slice(0, 10))}`).join(' · ')}</div></details>` : ''}</div><div class="cf">${S.admAdd ? '' : '<button class="btn pri" data-a="admAddOpen" data-t="admAddOpen">사람 더하기</button>'}<span>더하면 처음 들어오기 링크(24시간 · 한 번)가 나온다. 아이디와 함께 그 사람에게만 보낸다 · 비밀번호는 그 사람이 정한다</span></div></div>`
}
// 지식마다 자리 표 — 사람 더하기 · 사람 ⋯ › 지식마다 자리 창. 팀 지식마다 없음 · 읽기 · 쓰기 · 지식관리자(고르지 않으면 없음 — 보이지 않는다)
//   info — 창에서: 그 사람의 묶음 · 주인 자리(사람 줄과 따로 · 실제 자리는 가장 높은 것)
const SEAT_LV = ['none', 'read', 'write', 'admin']
function seatTable(seats = {}, key, all = false, info = null) {
  const ks = S.kns.filter((k) => !k.dim)
  if (all) return '<p class="small muted" data-t="seatAll" style="margin:var(--sp-4) 0 0">총괄 관리자는 모든 지식이 보이고 모두 지식관리자다</p>'
  if (!ks.length) return '<p class="small muted" style="margin:var(--sp-4) 0 0">팀 지식이 아직 없다</p>'
  const row = (k) => {
    const i = info && info[k.id]
    const extra = i ? [i.owner ? '주인' : '', ...(i.groups || []).map((g) => `묶음 ${g.group}: ${LV_N[g.level]}`), i.all && i.all !== 'none' ? `모두: ${LV_N[i.all]}` : ''].filter(Boolean).join(' · ') : ''
    const sel = `<select class="inp" data-seat="${esc(key)}" data-k="${esc(k.id)}" data-t="seatSel" aria-label="${esc(k.name)} 의 자리"${i && i.owner ? ' disabled' : ''}>${SEAT_LV.map((l) => `<option value="${l}"${(seats[k.id] || 'none') === l ? ' selected' : ''}>${LV_N[l]}</option>`).join('')}</select>`
    return `<tr data-t="seatRow" data-name="${esc(k.name)}"><td><b>${esc(k.name)}</b>${extra ? `<small class="muted u-blk">${esc(extra)}${i.level && i.level !== (seats[k.id] || 'none') ? ' · 지금 실제 자리 ' + esc(LV_N[i.level]) : ''}</small>` : ''}</td><td class="u-tr">${sel}</td></tr>`
  }
  return `<div class="tblwrap" style="margin-top:var(--sp-4)" data-t="seatTable"><table class="t"><tr><th>팀 지식</th><th class="u-tr">자리</th></tr>${ks.map(row).join('')}</table></div>`
}
const seatsOfUser = (u) => need('seats:' + u, `/api/admin/users/${encodeURIComponent(u)}/seats`)
function seatWinHtml() {
  const w = S.seatWin
  const v = seatsOfUser(w.user)
  if (v && !v.error && !w.seats) w.seats = Object.fromEntries(Object.entries(v.seats).map(([k, x]) => [k, x.owner ? 'admin' : x.mine]))
  const body = !v ? loadingHtml : v.error ? errHtml(v, 'seats:' + w.user) : seatTable(w.seats, 'win', false, v.seats)
  return `<div class="scrim fix" data-a="seatClose" data-self="1"><div class="modal w560" role="dialog" aria-modal="true" aria-label="지식마다 자리" data-t="seatWin"><div class="mh">지식마다 자리: ${esc(w.user)}<button type="button" class="x" data-a="seatClose" title="닫기" aria-label="닫기">×</button></div><div class="mb"><p class="small muted mt0">사람 줄의 자리를 바꾼다 · 묶음 · 주인으로 받은 자리는 그대로(실제 자리는 가장 높은 것) · 없음이면 그 지식이 보이지 않는다</p>${body}${w.err ? formErr(`<i></i><span>${esc(w.err)}</span>`, 'seatErr', '', true) : ''}</div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="seatClose">취소</button><button class="btn pri" data-a="seatSave" data-t="seatSave"${v && !v.error && !w.busy ? '' : ' disabled'}>${w.busy ? '저장하는 중…' : '저장'}</button></span></div></div></div>`
}
// 묶음 카드 — 사람 여럿에 한 번에 자리를 준다(총괄 관리자). 묶음마다 사람 칩(× 로 빼기) · 넣기 · 자리 있는 지식 수 · 지우기(확인 창)
//   자리는 지식마다 지식 카드 ⋯ › 권한에서 준다 · 묶음의 사람 목록은 서버에만 있다
const groupsOf = () => need('groups', '/api/admin/groups')
function admGroupsCard() {
  const v = groupsOf()
  if (!v || v.error) return `<div class="card" data-t="admGroups"><div class="ch">묶음</div><div class="cb u-p4-7">${v ? errHtml(v, 'groups') : loadingHtml}</div></div>`
  const people = v.people || []
  const pick = S.grpPick || {}
  const row = (g) => {
    const free = people.filter((p) => !g.members.includes(p))
    const chips = g.members.map((m) => `<span class="gm" data-t="grpMember" data-name="${esc(m)}">${esc(m)}<button type="button" class="x" data-a="grpOut" data-g="${esc(g.name)}" data-v="${esc(m)}" data-t="grpOut" title="${esc(m)} 빼기" aria-label="${esc(m)} 빼기">×</button></span>`).join('') || '<span class="muted small">사람이 없다</span>'
    const add = free.length ? `<span class="row grp-add"><select class="inp" data-grp="${esc(g.name)}" data-t="grpPick" aria-label="${esc(g.name)} 에 넣을 사람"><option value="">사람 고르기</option>${free.map((p) => `<option value="${esc(p)}"${pick[g.name] === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select><button type="button" class="btn sm" data-a="grpIn" data-g="${esc(g.name)}" data-t="grpIn"${pick[g.name] ? '' : ' disabled'}>넣기</button></span>` : ''
    return `<li data-t="grpRow" data-name="${esc(g.name)}"><span class="av2 all">${esc(g.name.slice(0, 1))}</span><span class="nm">${esc(g.name)}<small data-t="grpKns">지식 ${g.kns.length}개에 자리 · 사람 ${g.members.length}</small><span class="gms">${chips}</span>${add}</span><button type="button" class="btn sm ghost" data-a="grpDel" data-v="${esc(g.name)}" data-t="grpDel">지우기</button></li>`
  }
  const f = S.grpAdd
  const form = f ? `<div class="flow" data-t="grpAddForm"><div class="field" style="margin:0"><label for="grpName">묶음 이름</label><input class="inp" id="grpName"${invAttr(f.err, 'grpAddErr')} data-in="grpName" data-t="grpName" value="${esc(f.name || '')}" placeholder="예: 개발 · 운영" autocomplete="off"></div><div class="small b6" style="margin:var(--sp-4) 0 var(--sp-2)">넣을 사람</div><div class="gpick" data-t="grpAddPeople">${people.map((p) => `<label class="small"><input type="checkbox" data-grpadd="${esc(p)}"${(f.members || []).includes(p) ? ' checked' : ''}> ${esc(p)}</label>`).join('') || '<span class="muted small">사람이 없다</span>'}</div>${f.err ? formErr(`<i></i><span>${esc(f.err)}</span>`, 'grpAddErr', '', true) : ''}<div class="row" style="margin-top:var(--sp-4)"><button type="button" class="btn ghost" data-a="grpAddCancel">취소</button><button type="button" class="btn pri" data-a="grpAddDo" data-t="grpAddDo"${(f.name || '').trim() && !f.busy ? '' : ' disabled'}>더하기</button></div></div>` : ''
  return `<div class="card" data-t="admGroups"><div class="ch">묶음 ${v.groups.length}</div><div class="cb u-p1-7-5">${form}<ul class="plain pl">${v.groups.map(row).join('') || '<li class="muted" data-t="grpNone">아직 묶음이 없다</li>'}</ul></div><div class="cf">${f ? '' : '<button class="btn pri" data-a="grpAddOpen" data-t="grpAddOpen">묶음 더하기</button>'}<span>묶음을 지우면 지식마다 준 그 묶음 줄도 빠진다</span></div></div>`
}
// 묶음 바꾸기 — 사람 목록을 통째로 보낸다(관리자 일 · 비밀번호 한 번 더) · 사람 카드의 「지식 n개에 자리」 도 새로
async function grpSet(name, members) {
  try {
    await postJSON('/api/admin/groups', { name, members })
    delete S.cache.groups; delete S.cache.users
    for (const key of Object.keys(S.cache)) if (key.startsWith('access:')) delete S.cache[key]
    return true
  } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e); return false }
}
const grpOf = (name) => ((groupsOf() || {}).groups || []).find((g) => g.name === name) || null
// 떠남 확인 — 그 사람이 주인인 지식을 누가 잇는가
function offHtml() {
  const v = S.off
  const x = ((usersOf() || {}).users || []).find((u) => u.id === v.id)
  if (!x) return ''
  const r = x.roles
  return `<div class="scrim fix" data-a="offClose" data-self="1"${v.busy ? ' data-busy="1"' : ''}><div class="modal w560" data-t="offWin"><div class="mh">떠남: ${esc(x.id)}<button type="button" class="x" data-a="offClose" title="닫기" aria-label="닫기">×</button></div><div class="mb">
  <div class="callout danger" style="margin:0 0 var(--sp-6)"><i></i><span><b>한 번에 끊는다. 들어가기 · 기기 ${x.devices}</b> · 되돌릴 수 없다 · 아이디는 남겨 두고 되쓰지 않는다(같은 아이디로 다시 들일 수 없다 · 잠시 쉬는 사람은 기기 끊기 + 새 링크로)</span></div>
  <p class="small" style="margin:0 0 var(--sp-3)">${esc(x.id)} 이 주인인 지식: 팀 지식 ${r.team} · 지식관리자로 받은 지식 ${r.curate}(자리에서 뺀다)</p>
  <label class="small u-blk" style="margin:var(--sp-3) 0"><input type="radio" name="offTo" value="me"${v.to === 'me' ? ' checked' : ''} data-a="offTo" data-v="me" data-t="offToMe"> 내가 주인을 잇는다</label>
  <label class="small u-blk" style="margin:var(--sp-3) 0"><input type="radio" name="offTo" value="none"${v.to === 'me' ? '' : ' checked'} data-a="offTo" data-v="none" data-t="offToNone"> 주인 칸을 비운다. 자리를 받은 사람에게는 그대로 보인다(나중에 지식 카드 ⋯ › 권한 › 주인 바꾸기로 새 주인을 정한다)</label>
  ${v.err ? formErr(`<i></i><span>${esc(v.err)}</span>`, 'offErr', '', true) : ''}
  </div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="offClose" data-t="offClose">취소</button><button class="btn danger" data-a="offDo" data-t="offDo"${v.busy ? ' disabled' : ''}>${v.busy ? '끊는 중…' : '떠남으로'}</button></span></div></div></div>`
}
// 점검 요약 칩 — 멈춤 · 백업 · 팀 일꾼(정보 표시만 · 고치기는 아래 줄)
function checkChips(a) {
  const bk = a.backups.filter((x) => x.off || (x.verdict && x.verdict !== 'ok' && x.verdict !== 'lag')).length
  const rest = a.worker && a.worker.ok === false
  const c = (cls, t, k) => `<span class="chip ${cls}" data-t="chk-${k}">${t}</span>`
  return `<div class="row u-wrap u-g3" data-t="checkChips" style="margin:0 0 var(--sp-5)">${c(S.stops.length ? 'c-warn' : 'c-mute', '멈춤 ' + S.stops.length, 'stop')}${c(bk ? 'c-danger' : 'c-mute', '백업 문제 ' + bk, 'backup')}${c(rest ? 'c-warn' : a.claude.token || (a.worker && a.worker.ok) ? 'c-ok' : 'c-mute', '팀 일꾼 ' + (rest ? '쉼' : a.claude.token || (a.worker && a.worker.ok) ? '됨' : '로그인 전'), 'worker')}</div>`
}
// 감사 기록(UX T4-04 · 총괄 관리자) — 관리 쓰기 요청을 한 곳에서: 때 · 누가 · 무엇 · 지식 · 결과
const AUDIT_SAY = [[/\/admin\/users\/[^/]+\/reset$/, '비밀번호 다시 정하기'], [/\/admin\/users\/[^/]+\/unlock$/, '잠금 풀기'], [/\/admin\/users\/[^/]+\/revoke-all$/, '기기 열쇠 모두 끊기'], [/\/admin\/users\/[^/]+\/logout-all$/, '모든 곳에서 내보내기'], [/\/admin\/users\/[^/]+\/admin$/, '총괄 관리자 주기 · 걷기'], [/\/admin\/users\/[^/]+\/off$/, '사람 끄기 · 켜기'], [/\/admin\/users\/[^/]+\/seats$/, '자리 주기'], [/\/admin\/users$/, '사람 더하기'], [/\/admin\/groups/, '묶음'], [/\/admin\/links$/, '설치 한 줄 만들기'], [/\/admin\/claude/, 'Claude 연결'], [/\/queue\/caps$/, '동시에 도는 수'], [/\/queue\/hold$/, '줄 멈춤'], [/\/requests\/.+\/close$/, '가져올 곳 부탁 닫기'], [/\/knowledge\/add$/, '지식 세우기'], [/\/knowledge\/sync$/, '지식 폴더 다시 읽기'], [/\/restore$/, '불러오기'], [/\/sudo$/, '비밀번호 한 번 더'], [/\/me\/password$/, '내 비밀번호 바꾸기'], [/\/me\/logout-all$/, '모두 나가기'], [/\/me\/devices\/revoke$/, '내 기기 끊기'], [/\/device\/ticket$/, '설치 번호 받기'], [/\/owner$/, '주인 · 지식 설정'], [/\/access$/, '권한'], [/\/delete$/, '지식 삭제'], [/\/structure$/, '구조'], [/\/polish$/, '문서 다듬기'], [/\/revert$/, '되돌리기'], [/\/unwatch$/, '원본 떼기'], [/\/docfmt$/, '문서 꼴 고치기'], [/\/backup/, '백업'], [/\/sources/, '가져올 곳'], [/\/rec\/[^/]+\/fix$/, '기록 바로잡기']]
const auditSay = (p) => (AUDIT_SAY.find(([re]) => re.test(p)) || [null, p])[1]
const auditOf = () => need('audit', '/api/admin/audit?n=300')
function auditCard() {
  const a = auditOf()
  const body = !a ? loadingHtml : a.error ? errHtml(a, 'audit') : !a.rows.length ? '<p class="muted">아직 적힌 것이 없다</p>' : `<div class="tblwrap"><table class="t" data-t="auditTbl"><thead><tr><th>때</th><th>누가</th><th>무엇</th><th>지식 · 사람</th><th>결과</th></tr></thead><tbody>${a.rows.slice(0, S.auditMore ? 300 : 30).map((x) => `<tr><td class="u-nw">${esc(whenTxt(x.at))}</td><td>${esc(x.user || '')}${x.admin ? ' <small class="muted">총괄</small>' : ''}</td><td title="${esc(x.path)}">${esc(auditSay(x.path))}</td><td>${esc(x.knName || x.who || '')}</td><td>${x.status < 400 ? chipOf('ok', '됨') : chipOf(x.status === 403 || x.status === 401 ? 'stop' : 'fail', '못 함 ' + x.status)}</td></tr>`).join('')}</tbody></table></div>${a.rows.length > 30 && !S.auditMore ? `<button type="button" class="lk small" data-a="auditMore" data-t="auditMore">더 보기(${a.rows.length})</button>` : ''}`
  return `<div class="card" data-t="auditCard"><div class="ch">감사 기록 <small>본문은 적지 않는다</small><button type="button" class="btn ghost sm r" data-a="auditRe" data-t="auditRe">다시 읽기</button></div><div class="cb">${body}</div></div>`
}
function viewAdmin() {
  if (!S.me.admin) return { crumb: '관리', main: '<div class="callout gray">총괄 관리자만 본다</div>' }
  const a = overviewOf()
  if (!a || a.error) return { crumb: '관리', main: `<div class="pg-text">${a ? errHtml(a) : loadingHtml}</div>` }
  const rows = []
  // 경고(멈춤 줄)를 맨 위에 그대로 — 위 띠 「⚠ 경고 n」 과 같은 줄(UX T6-08)
  const warnRows = (S.stops || []).map(stopRow).join('')
  if (a.nopw.length) rows.push(`<li class="hot" data-t="adm-nopw"><span class="dot warn"></span><span class="tx"><b>비밀번호를 안 정한 사람 ${a.nopw.length}</b><small>${esc(a.nopw.join(' · '))}: 사람 페이지에서 그 사람의 ⋯ › 새 링크 · 떠난 사람이면 ⋯ › 떠남</small></span><button class="btn sm" data-a="openSet" data-v="people" data-t="admToPeople">${esc(setWhere('people'))} ›</button></li>`)
  for (const l of a.locked) rows.push(`<li data-t="adm-lock"><span class="dot"></span><span class="tx"><b>${esc(l.user)} · ${l.ip === '*' ? '여러 자리에서' : '다른 자리에서'} 여러 번 틀림: 잠시 막혔다</b><small>${l.ip === '*' ? '' : esc(l.ip) + ' · '}${esc(hhmmOf(l.until))} 에 저절로 풀린다 · 맞는 사람은 그대로 쓴다</small></span><button class="btn sm" data-a="admUnlock" data-v="${esc(l.user)}" data-t="admUnlock">풀기</button></li>`)
  for (const r of a.requests.slice(0, 10)) rows.push(`<li data-t="adm-req"><span class="dot pu"></span><span class="tx"><b>가져올 곳 「${esc(r.name)}」 더해 달라는 부탁: ${esc(r.by)}</b><small>${esc(whenTxt(r.at))} · → ${esc((KN(r.kn) || {}).name || r.kn)} › ${esc((r.rules[0] && r.rules[0].into && r.rules[0].into.doc) || '')} · ${esc(r.at2)}</small></span><button class="btn sm" data-a="admAddReq" data-id="${esc(r.id)}" data-t="admAddReq">더하기</button><button class="btn sm ghost" data-a="admNoReq" data-id="${esc(r.id)}" data-t="admNoReq">거절</button></li>`)
  if (a.worker && a.worker.ok === false) rows.push(`<li data-t="adm-rest"><span class="dot warn"></span><span class="tx"><b>팀 일꾼이 쉬고 있다 · ${Math.max(1, Math.round((Date.now() - Date.parse(a.worker.since)) / 864e5))}일</b><small>${a.worker.reason === 'limit' ? '사용 한도에 닿았다' : a.worker.reason === 'missing' ? '서버에 Claude Code(claude) 가 설치되어 있지 않다' : '팀 일꾼 Claude 로그인이 끝났다'}: 그동안 들이기는 기다린다 · 24시간 넘으면 기록만 남는다. 다시 로그인한다</small></span><button class="btn sm" data-a="toTeamClaude" data-t="admToClaude">${esc(setWhere('server'))} ›</button></li>`)
  for (const b of a.backups.filter((x) => x.verdict && x.verdict !== 'ok' && x.verdict !== 'lag')) rows.push(`<li data-t="adm-backup"><span class="dot warn"></span><span class="tx"><b>${esc(b.name)}: 백업과 ${b.verdict === 'behind' ? '백업이 앞섰다' : b.verdict === 'moved' ? '갈라졌다' : '맞지 않는다'}</b><small>어느 쪽이 맞는지 정한다. 백업이 맞으면 이어 쓰기(지금 것은 가지로 남는다 · 그사이 기록은 쓴 사람에게 알린다) · 서버가 맞으면 백업을 덮는다</small></span><button class="btn sm" data-a="admAdopt" data-v="${esc(b.name)}" data-t="admAdopt">${b.verdict === 'behind' ? '백업에서 받기' : '이 백업 이어 쓰기'}</button>${b.verdict === 'moved' ? `<button class="btn sm ghost" data-a="admKeep" data-v="${esc(b.name)}" data-t="admKeep">서버 것으로 백업 덮기</button>` : ''}</li>`)
  const now = clock().split(' ').pop()
  return { crumb: '관리', main: `<div class="pg-text">${checkChips(a)}
  ${warnRows ? `<div class="card" data-t="admWarn"><div class="ch">경고 ${(S.stops || []).length}</div><div class="cb">${warnRows}</div></div>` : ''}<div class="card"><div class="ch">오늘 ${rows.length} <small>${esc(now)}</small></div><ul class="plain pl" data-t="admList">${rows.join('') || (warnRows ? '<li class="muted" data-t="admEmpty">위 경고 밖에는 문제가 없다</li>' : '<li class="muted" data-t="admEmpty">오늘은 문제가 없다</li>')}</ul>${a.https ? '' : '<div class="cf">아직 https 가 아니다. 사내 인증서가 생기면 켤 수 있다</div>'}</div>
  <p class="small muted" data-t="admChecks">찾기 점검(6개 안에 찾음): ${a.checks.map((c) => `${esc(c.name)} 제목 문제 ${c.in}%(${c.n})${c.hard != null ? ` · <b>바꾼 문제 ${c.hard}%(${c.hn})</b>` : ''}`).join(' · ') || '아직 재지 않았다'}${a.checks.some((c) => (c.miss || []).length) ? `<br>바꾼 문제 가운데 못 찾은 것: ${a.checks.flatMap((c) => (c.miss || []).map((q) => `「${esc(q)}」`)).slice(0, 5).join(' · ')} <small>(별칭으로 더하면 찾힌다)</small>` : ''}</p>${auditCard()}</div>` }
}
// 저장소 상태 이름(설정 › 팀 지식의 저장소 칸) — 저장소 붙이기 · 주소 바꾸기는 그 줄 ⋯
const REPO_V = { ok: ['c-ok', '맞음'], lag: ['c-pend', '보내는 중'], gone: ['c-warn', '저장소가 비었다 · 다시 보낸다'], rewound: ['c-warn', '저장소가 뒤로 갔다 · 다시 보낸다'], behind: ['c-danger', '저장소가 앞섰다'], moved: ['c-danger', '갈라졌다'] }
const hhmmOf = (iso) => { const d = new Date(iso); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
function admDoneBtn() { const ok = !!(S.admCode || '').trim() && !S.admBusy; return `<button class="btn pri" data-a="admDone" data-t="admDone"${ok ? '' : ' disabled'}>${S.admBusy ? '마치는 중…' : '마치기'}</button>` }
function admClaudeCard(a) {
  const rest = a.worker && a.worker.ok === false, step = S.admStep
  let flow = ''
  if (step === 'wait') flow = '<div class="flow"><span class="prog" data-t="admWait"><i></i>팀 서버가 팀 일꾼 로그인을 띄우는 중…</span></div>'
  else if (step === 'window') flow = `<div class="flow" data-t="admWindow"><p style="margin:0 0 var(--sp-3)"><b>팀 서버 PC 화면에 「kmd: Claude 로그인」 창</b>이 떴다. 그 창이 브라우저를 연다. 그 PC 의 브라우저에서 Claude 에 들어가면 끝이다.</p><p class="small muted" style="margin:0 0 var(--sp-4)">창이 안 보이면 그 PC 의 작업 표시줄에서 그 창을 누른다 · 팀 일꾼은 그 PC 의 Claude Code 로그인을 쓴다 · 다 되면 그 창은 닫아도 된다</p><div class="row"><span class="prog" data-t="admWinWait"><i></i>${S.admChecking ? '로그인을 확인하는 중…' : S.admLast ? esc(S.admLast) : '로그인을 기다린다. 몇 초마다 저절로 확인한다'}</span><button type="button" class="btn ghost sm" data-a="admFlowCancel" style="margin-left:auto">취소</button><button class="btn sm" data-a="admCheck" data-t="admCheck">지금 확인</button></div></div>`
  else if (!step && S.admErr) flow = `<div class="flow">${formErr(S.admErr, 'admErr')}</div>`
  // 기다리던 로그인이 끝났다(시간이 지났다 · 팀 서버가 다시 켜졌다) — 그 번호는 못 쓴다 · 새 주소로 다시
  else if (step === 'expired') flow = `<div class="flow" data-t="admExpired"><div class="callout warn" style="margin:0 0 var(--sp-4)"><b>기다리던 로그인이 끝났다</b>. ${esc(S.admErr || '')}</div><div class="row"><button type="button" class="btn ghost sm" data-a="admFlowCancel">취소</button><button class="btn pri" data-a="admLoginStart" data-t="admRestart">다시 시작</button></div></div>`
  // 화면 없는 서버 — 둘: 이 브라우저에서 주소를 열어 로그인 → 받은 번호를 붙여 넣기(주소는 길어 두 줄까지만 보이고 복사 · 열기로)
  else if (step === 'code') flow = `<div class="flow" data-t="admCode"><ol class="lsteps">
   <li><b>Claude 로그인 주소를 연다</b><small>새 탭에서 Claude 계정(Pro · Max · Team · Enterprise)으로 들어가 [Authorize] 를 누르면 번호가 나온다 · 메일로 오는 링크는 같은 브라우저에서 연다${S.admUntil ? ` · <b data-t="admUntil">${new Date(S.admUntil).toTimeString().slice(0, 5)} 까지</b>` : ''}</small><div class="row"><a class="btn pri sm" href="${esc(S.admUrl)}" target="_blank" rel="noopener noreferrer" data-t="admOpenUrl">주소 열기 ↗</a><button class="btn sm" data-a="admCopyUrl" data-t="admCopyUrl">주소 복사</button></div><div class="urlbox" data-t="admUrl" title="${esc(S.admUrl)}">${esc(S.admUrl)}</div></li>
   <li><b>받은 번호를 붙여 넣는다</b><small>Claude 화면에 나온 번호를 그대로 · 한 번용이라 저장하지 않는다</small><div class="paste"><input class="inp mono" id="admCodeIn" aria-label="로그인 코드" data-in="admCode" data-t="admCodeIn" value="${esc(S.admCode || '')}" placeholder="받은 번호 붙여 넣기" autocomplete="off"><span id="admDoneBox">${admDoneBtn()}</span></div>${S.admBusy ? '<div class="row" style="margin-top:var(--sp-4)"><span class="prog" data-t="admBusy"><i></i>번호를 넘기고 Claude 의 열쇠를 받는 중… 30초까지 걸린다</span></div>' : ''}</li></ol>
   ${S.admErr ? formErr(S.admErr, 'admCodeErr') : ''}<div class="row" style="margin-top:var(--sp-1)"><span class="hint" style="margin:0">${a.https ? '로그인한 열쇠는 팀 서버 비밀로만 남는다' : '아직 https 가 아니다. 사내 https 뒤 권장'}</span><button type="button" class="btn ghost sm" data-a="admFlowCancel" style="margin-left:auto">취소</button></div></div>`
  const state = rest ? `쉬고 있다 · ${Math.max(1, Math.round((Date.now() - Date.parse(a.worker.since)) / 864e5))}일: 로그인이 끝났다` : a.claude.token ? '로그인됨 · 팀 일꾼' : a.worker && a.worker.ok ? '로그인됨. 팀 서버 PC 의 Claude Code' : '아직 로그인하지 않았다'
  const inn = a.claude.token || (a.worker && a.worker.ok)
  return `<div class="card" data-t="admClaude"><div class="ch">Claude 연결 <small>팀 일꾼 로그인</small></div><div class="cb u-p1-7-5"><div class="set"><span class="tx"><b data-t="admClaudeState">${state}</b><small>쓰는 곳: 들이기 · 다시 들이기 · 정정 · 문서 다듬기${rest ? ' · 그동안 들이기는 기다린다' : ''}</small></span>${step ? '' : `<button class="btn${rest || !inn ? ' pri' : ''}" data-a="admLoginStart" data-t="admLoginStart">${rest || !inn ? '로그인 시작' : '다시 로그인'}</button>`}</div>${flow}</div></div>`
}
// 로그인 시작 — 비밀번호 한 번 더는 공통 창(Q13 · postJSON 이 E_SUDO 를 받으면 askSudo 로 묻고 이어서 한다)
async function admLoginStart() {
  try {
    S.admErr = null
    S.admStep = 'wait'
    render()
    const r = await postJSON('/api/admin/claude/start', {})
    if (r.window) { S.admStep = 'window'; S.admLast = null; S.admSince = Date.now(); admPoll() } // 화면 있는 서버 PC — 보이는 창 · 번호 칸 없음
    else { S.admUrl = r.url; S.admStep = 'code'; S.admCode = ''; S.admUntil = Date.now() + 20 * 60_000 }
  } catch (e) { S.admErr = e.code === 'E_SUDO' || e.code === 'E_CANCEL' ? null : e.message; if (S.admStep === 'wait') S.admStep = null }
  render()
}
// 화면 있는 서버 PC — 그 PC 의 Claude Code 로그인을 작은 부르기로 확인 · 8초마다(10분까지)
async function admCheck(byHand) {
  S.admChecking = true
  render()
  let r = null
  try { r = await postJSON('/api/admin/claude/check', {}) } catch (e) { r = { ok: false, reason: e.message } }
  S.admChecking = false
  if (r.ok) { S.admStep = null; S.admLast = null; delete S.cache.admin; loadStops(); toast('로그인됨. 팀 서버 PC 의 Claude Code · 팀 일꾼이 이어서 들인다') }
  else if (S.admStep === 'window') S.admLast = r.reason === 'login' ? '아직 로그인 전: 그 창 · 브라우저에서 마치면 저절로 확인한다' : r.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : '확인하지 못했다. 다시 본다'
  else if (byHand) toast('확인하지 못했다')
  render()
  return r.ok
}
function admPoll() {
  const since = S.admSince
  setTimeout(async () => {
    if (S.admStep !== 'window' || S.admSince !== since || Date.now() - since > 20 * 60_000) return
    if (!(await admCheck(false))) admPoll()
  }, 8000)
}
// 마치기 — 번호를 팀 서버의 로그인에 넘기고 열쇠를 받을 때까지(30초까지) 돌아가는 줄 · 끝난 로그인이면 [다시 시작]
async function admDone() {
  if (S.admBusy) return
  S.admBusy = true; S.admErr = null
  render()
  try {
    const r = await postJSON('/api/admin/claude/code', { code: S.admCode })
    // Claude 가 번호를 받지 않았다 — 같은 로그인이 새 주소를 받았다. 새 주소를 열어 새 번호로(옛 탭 · 옛 번호는 쓰지 못한다)
    if (r && r.again) {
      S.admUrl = r.url; S.admCode = ''; S.admUntil = Date.now() + 20 * 60_000
      S.admErr = `Claude 가 이 번호를 받지 않았다(${r.why}). 새 주소를 받았다: 위의 [주소 열기] 로 새 탭에서 다시 로그인해 새 번호를 붙여 넣는다 · 전에 연 탭의 번호는 쓰지 못한다`
      S.admBusy = false
      render()
      return
    }
    S.admStep = null; S.admCode = ''; S.admErr = null; S.admUntil = null
    delete S.cache.admin
    loadStops()
    toast('로그인됨. 팀 일꾼이 이어서 들인다')
  } catch (e) {
    S.admErr = e.message
    if (e.need === 'restart') { S.admStep = 'expired'; S.admCode = ''; S.admUntil = null }
  }
  S.admBusy = false
  render()
}

// ── 지식 지우기 — 보관하지 않고 완전히 · 지식 이름을 그대로 써야 단추가 선다 ──
function canDelete(n) {
  if (!n || n.dim) return false
  if (!isTeam()) return true
  return !!S.me.admin
}
function delHtml() {
  const n = KN(S.del.kn)
  if (!n) return ''
  const ok = (S.del.typed || '').trim() === n.name
  const where = isTeam() ? '팀 서버의 이 지식 폴더가 통째로 사라진다. 팀 모두가 더는 보지 못한다' : `지식 폴더의 「${n.dir || n.name}」 폴더가 통째로 사라진다`
  return `<div class="scrim fix" data-a="delClose" data-self="1"${S.del.busy ? ' data-busy="1"' : ''}><div class="modal w560" data-t="delWin"><div class="mh">지식 삭제: ${esc(n.name)}<button type="button" class="x" data-a="delClose" title="닫기" aria-label="닫기">×</button></div><div class="mb">
  <div class="callout danger" data-t="delWarn" style="margin:0 0 var(--sp-6)"><i></i><span><b>보관하지 않고 완전히 지운다. 되돌릴 수 없다</b></span></div>
  <ul class="plain small u-lhr" style="margin:0 0 var(--sp-6)">
   <li>문서 ${n.docs} · 기록 ${n.records} · 첨부를 모두 지운다. 휴지통 · 보관함에 남기지 않는다</li>
   <li>${esc(where)}</li>
   <li>이 지식의 보낼 곳 · 자동수집 · 찾기 색인 · 사람 설정도 함께 사라진다</li>
   <li>저장소 · 지식백업에 이미 보낸 이력은 kmd 가 지우지 않는다. 그것까지 없애려면 그곳에서 지운다</li>
  </ul>
  <label for="delIn" class="small">삭제하려면 지식 이름을 그대로 쓴다. <b>${esc(n.name)}</b></label>
  <input class="inp wfull" id="delIn" data-in="del" data-t="delIn" value="${esc(S.del.typed || '')}" autocomplete="off" style="margin-top:var(--sp-3)">
  ${S.del.err ? formErr(`<i></i><span>${esc(S.del.err)}</span>`, 'delErr', '', true) : ''}
  </div><div class="mf"><span class="acts"><button type="button" class="btn ghost" data-a="delClose" data-t="delClose">취소</button><span id="delBtnBox">${delBtn(ok)}</span></span></div></div></div>`
}
const delBtn = (ok) => `<button class="btn danger" data-a="delDo" data-t="delDo"${ok && !S.del.busy ? '' : ' disabled'}>${S.del.busy ? '삭제하는 중…' : '삭제'}</button>`
async function delDo() {
  const n = KN(S.del.kn)
  if (!n || (S.del.typed || '').trim() !== n.name) return
  S.del.busy = true
  S.del.err = null
  render()
  try {
    // 비밀번호 한 번 더는 공통 창(Q13) — postJSON 이 E_SUDO 를 받으면 묻고 이어서 지운다
    await postJSON(`/api/k/${encodeURIComponent(n.id)}/delete`, { confirm: S.del.typed.trim() })
    S.tabs = S.tabs.filter((t) => t.kn !== n.id)
    if (!S.tabs.some((t) => t.id === S.active)) S.active = S.tabs[0] ? S.tabs[0].id : null
    forgetKn(n.id)
    S.del = null
    await reloadKns()
    delete S.cache.history
    go({ scr: 'home', kn: '*' })
    toast(`지웠다: ${esc(n.name)} · 보관하지 않고 완전히`)
  } catch (e) {
    if (S.del) { S.del.err = e.code === 'E_SUDO' || e.code === 'E_CANCEL' ? null : e.message; S.del.busy = false }
    render()
  }
}

// ───────────── 이벤트 ─────────────
function openDocAt(k, d, h, q, view, sub) {
  const t = openTab({ kind: 'doc', kn: k, ref: d, hl: q && h ? h : null, q: q || null }, view ? { view } : {})
  t.flashH = !q && h ? h : null
  S._litSub = !q && h && sub ? { h, sub } : null
  if (h) S._lit = true
  render()
  if (!h) scrollTopMain()
}
const sxFocus = (key) => { const el = key && document.querySelector(`#sxTree [data-sk="${CSS.escape(key)}"]`); if (el) el.focus({ preventScroll: false }) }
const sxEditStart = (e) => { if (sxHold()) return; S.sx.edit = e; render(); const i = $('#sxIn'); if (i) { i.focus(); i.select() } sxEditCheck() }
function sxReorder(el, up) {
  const key = el.dataset.sk, P = key.startsWith('f:') ? sxSplit(key.slice(2))[0] : sxW(key.slice(2)).folder
  const arr = sxSibs(P), i = arr.indexOf(key), j = i + (up ? -1 : 1)
  if (j < 0 || j >= arr.length) return
  arr.splice(i, 1); arr.splice(j, 0, key); S.sx.ORDER[P] = arr; S.sx.sel = key; render(); sxFocus(key)
}
const ACT = {
  // 문서 짜임(viewStructure)
  sxClick: (el, ev) => {
    const key = el.dataset.sk, x = S.sx
    if (ev && ev.detail === 2 && el.querySelector('[data-a=sxRen]')) { if (key.startsWith('f:')) x.open[key.slice(2)] = !x.open[key.slice(2)]; sxEditStart(key.startsWith('f:') ? { t: 'dir', id: key.slice(2) } : { t: 'doc', id: key.slice(2) }); return }
    const lock = el.getAttribute('draggable') !== 'true'
    if (ev && ev.shiftKey && x.sel) {
      const rows = [...document.querySelectorAll('#sxTree .sx-row[data-sk]')].map((r) => [r.dataset.sk, r.getAttribute('draggable') === 'true'])
      const a = rows.findIndex((r) => r[0] === x.sel), b = rows.findIndex((r) => r[0] === key)
      if (a >= 0 && b >= 0) { for (const [k, ok] of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) if (ok) x.multi.add(k) }
      render(); sxFocus(key); return
    }
    if (ev && (ev.ctrlKey || ev.metaKey || x.pick)) {
      if (lock) { toast('<b>원본이 주인인 것은 옮기지 않는다</b>', 0, true); return }
      if (x.multi.has(key)) x.multi.delete(key); else x.multi.add(key)
      x.sel = key; render(); sxFocus(key); return
    }
    if (x.multi.size) x.multi = new Set()
    if (key.startsWith('f:')) x.open[key.slice(2)] = !x.open[key.slice(2)]
    x.sel = key; render(); sxFocus(key)
  },
  sxMv: (el) => { const key = el.dataset.sk, x = S.sx; sxMoveKeys(x.multi.has(key) ? [...x.multi] : [key]) },
  sxMvSel: () => sxMoveKeys([...S.sx.multi]),
  sxSelClear: () => { S.sx.multi = new Set(); S.sx.pick = false; render() },
  sxPick: () => { const x = S.sx; x.pick = !x.pick; if (!x.pick) x.multi = new Set(); render() },
  sxRen: (el) => { const key = el.dataset.sk; sxEditStart(key.startsWith('f:') ? { t: 'dir', id: key.slice(2) } : { t: 'doc', id: key.slice(2) }) },
  sxRm: (el) => { const key = el.dataset.sk, x = S.sx; if (key.startsWith('f:')) x.WDIRS.delete(key.slice(2)); else x.W = x.W.filter((d) => d.id !== key.slice(2)); x.sel = null; render() },
  sxNewDoc: () => { const p = sxSelFolder(); if (p) S.sx.open[p] = true; sxEditStart({ t: 'newdoc', parent: p }) },
  sxRootSel: () => { S.sx.sel = null; render() },
  sxNewDir: () => { const p = sxSelFolder(); if (p) S.sx.open[p] = true; sxEditStart({ t: 'newdir', parent: p }) },
  sxUndo: (el) => { const id = el.dataset.d, o = sxO(id); if (o) Object.assign(sxW(id), o, { sync: false }); else S.sx.W = S.sx.W.filter((d) => d.id !== id); render() },
  sxUndoOrd: (el) => { const p = el.dataset.p; S.sx.ORDER[p] = [...(S.sx.OORDER[p] || [])]; render() },
  sxReset: async () => { S.menu = null; if (await ask1('바꾼 것을 모두 처음대로', '처음대로')) { const k = S.sx.k, d = sxOf(k); sxInit(k, d); S.sx.src = d; if (S.sxf && S.sxf.k === k && S.sxf.step < 3) S.sxf = null; render() } },
  // 다시 잡기(Z5) — 단계 · 항목 · 창
  sxTab: (el) => { if ((S.sxTab || 'shape') === el.dataset.v) return; S.sxTab = el.dataset.v; pushHist(); render() },
  sxStep: (el) => { if (el.getAttribute('aria-disabled') === 'true') return; const f = sxFlow(), n = Number(el.dataset.v); if (n === 1 && f.step === 2 && !f.srv) { f.step = 1; f.tried = null; render() } },
  sxCheck: () => sxCheck(),
  sxNext: () => { const f = sxFlow(); if (f.step < 3) { f.step++; if (f.step === 2) f.tried = null; f.err = null; render() } },
  sxTry: () => sxTry(),
  sxTryAgain: () => { const f = sxFlow(); f.step = 2; f.put = null; f.tried = null; sxTry() },
  sxPut: () => sxPut(),
  sxStop: () => { S.menu = null; sxStop() },
  sxEnd: () => { S.sxf = null; render() },
  // 걸음 실패 뒤 — 지금 짜임으로 다시 읽고 1 구조안부터(넣은 걸음은 그대로 · 서버가 넣다 선 일로 다시 검사한다)
  sxFixPlan: () => { const k = S.sx.k; sxReload(k); S.sxf = { k, step: 1 }; render() },
  sxUndoPlan: () => sxUndoPlan(),
  sxResume: () => {
    const x = S.sx, w = x.shSrc && x.shSrc.work; if (!w) return
    const step = ['putting', 'stopped', 'rebase'].includes(w.stage) ? 3 : w.stage === 'tried' && !w.blockers ? 3 : 2
    S.sxf = { k: x.k, step, srv: true, check: null, tried: step === 3 && w.stage === 'tried' ? { ok: true, steps: Array(w.steps || 0).fill(0) } : null, put: step === 3 && w.stage !== 'tried' ? (w.fail ? { stopped: { fail: w.fail } } : { resume: true }) : null }
    render()
  },
  sxISel: (el) => { const x = S.sx; x.isel = x.isel === el.dataset.k ? null : el.dataset.k; render() },
  sxIMv: () => sxwOpen('move', [S.sx.isel]),
  sxISplit: () => sxwOpen('split', [S.sx.isel]),
  sxIMerge: () => sxwOpen('merge', [...S.sx.ipick]),
  sxIPickClear: () => { S.sx.ipick = new Set(); render() },
  sxIRen: async () => {
    const x = S.sx; if (!x.isel || sxHold()) return
    const z = sxItemOf(x.isel); if (!z.it) return
    const v = await ask({ t: `「${z.h}」 이름`, d: '항목 머리를 바꾼다. 구조안에만 적는다', input: { label: '머리', value: z.h }, ok: '바꾸기' })
    if (v == null) return
    const h = v.trim(), bad = sxHeadBad(h) || (h !== z.h && sxItems(z.wid).some((it) => it.h === h) ? '같은 머리가 있다' : '')
    if (bad) { toast(`<b>${esc(bad)}</b>`, 0, true); return }
    sxNameMove([sxIKey(z.wid, z.h)], z.wid, h)
    z.it.h = h; x.isel = sxIKey(z.wid, h); render()
  },
  sxDrop: (el) => { const x = S.sx, id = x.sel && x.sel.slice(2); if (!id || sxHold()) return; if (x.empty.has(id)) x.empty.delete(id); else x.empty.add(id); render() },
  sxwClose: () => { S.sxw = null; render() },
  sxwGo: () => sxwGo(),
  sxwDrop: (el) => { const w = S.sxw, i = Number(el.dataset.i); if (w.t === 'merge') w.srcs.splice(i, 1); else w.rows.splice(i, 1); render() },
  sxwAddRow: () => { const w = S.sxw; w.rows.push({ to: w.src.wid, h: '', text: '' }); render() },
  sxClaude: () => sxClaude(),
  sxCjWrite: () => sxCjWrite(),
  sxCjStop: () => sxCjStop(S.sxc, S.sxc && S.sxc.job),
  sxCjClose: () => { S.sxc = null; render() },
  sxwClaude: () => sxwClaude(),
  sxwCjStop: () => { const c = S.sxw && S.sxw.cj; if (c) sxCjStop(c, c.job) },
  sxBarT: () => { S.sx.barOpen = !S.sx.barOpen; render() },
  sxSave: () => sxSave(),
  sxFix: async () => {
    const x = S.sx
    for (const d of x.W.filter((z) => { const o = sxO(z.id); return o && o.file !== o.title && !z.sync && !z.watched })) {
      if (d.file === d.title.replace(/\s+/g, '')) { if (!sxClash(d.folder, d.title, d.id)) d.sync = true; continue }
      const v = await ask({ t: `「${d.title}」`, d: `파일 이름 ${d.file}.md · 어느 쪽으로 맞출까`, btns: [['file', `파일 이름을 「${d.title}」로`, 'pri'], ['title', `제목을 「${d.file}」로`, '']] })
      if (v === false) break
      if (v === 'title') d.name = d.file
      else if (!sxClash(d.folder, d.title, d.id)) d.sync = true
    }
    render()
  },

  // 서랍 — ☰(600 이하 옆 메뉴) · 옆 칸(1024 이하 오른쪽 칸) · 덮개를 누르거나 Esc 면 닫는다
  sideToggle: () => { S.sideOpen = !S.sideOpen; S.asideOpen = false; S.menu = null; render(); if (S.sideOpen) { const f = focusables($('#app .side'))[0]; if (f) f.focus() } },
  // 화면 자리(컨벤션 11-2) — 접기 · 묶음 펼침 · 문서 폭 · 그래프 팝업
  sideRail: () => { UI.sideRail = !UI.sideRail; saveUi(); render(); const b = [...document.querySelectorAll('#app [data-t=sideFold]')].find((x) => x.getClientRects().length); if (b) b.focus() },
  asideRail: () => { UI.asideRail = !UI.asideRail; saveUi(); render(); const b = $('#app [data-t=asideFold]'); if (b) b.focus() },
  agToggle: (el) => { const k = el.dataset.k, g = el.dataset.g; UI.ag[k] = { ...(UI.ag[k] || {}), [g]: !agOpen(k, g) }; saveUi(); render(); const b = $(`#app .aside [data-a=agToggle][data-g="${g}"]`); if (b) b.focus() },
  agRail: (el) => { const k = el.dataset.k, g = el.dataset.g; UI.asideRail = false; UI.ag[k] = { ...(UI.ag[k] || {}), [g]: true }; saveUi(); render(); const b = $(`#app .aside [data-a=agToggle][data-g="${g}"]`); if (b) { b.scrollIntoView({ block: 'nearest' }); b.focus() } },
  agFold: (el) => { UI.ag[el.dataset.k] = {}; saveUi(); render() },
  docWide: (el) => { UI.wide = el.dataset.v === '1'; saveUi(); render() },
  gPop: () => { S.gPop = !S.gPop; render(); const f = S.gPop ? $('#app [data-t=gNode]') : $('#app [data-t=gPopBtn]'); if (f) f.focus() },
  gNode: (el) => {
    const k = el.dataset.k, id = el.dataset.n, ref = id.slice(2)
    S.gPop = false
    if (id.startsWith('d:')) return openDocAt(k, ref, null, null)
    if (id.startsWith('i:')) { openTab({ kind: 'item', kn: k, ref }); render(); return scrollTopMain() }
    if (id.startsWith('r:')) { openTab({ kind: 'rec', kn: k, ref }); render(); return scrollTopMain() }
    render()
  },
  scrollTx: (el) => {
    const want = el.dataset.v
    const h = [...document.querySelectorAll('#app .main[data-t=main] .paper :is(h2,h3,h4,.lv[data-lv])')].find((x) => (x.dataset.lv != null ? x.dataset.lv : x.textContent.trim()) === want)
    if (h) { h.scrollIntoView({ block: 'start', behavior: 'smooth' }); h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash') }
  },
  asideToggle: () => { S.asideOpen = !S.asideOpen; S.sideOpen = false; S.menu = null; render(); if (S.asideOpen) { const f = focusables($('#app .aside'))[0]; if (f) f.focus() } },
  drawerClose: () => drawerShut(),
  // 다시 읽기 — 그 받은 값(cache key)을 지우고 다시 받는다 · 그리다 넘어졌으면 모두
  retryKey: (el) => { delete S.cache[el.dataset.k]; delete S.wait[el.dataset.k]; render() },
  retryAll: () => { S.cache = {}; S.wait = {}; render() },
  retryBoot: () => retryBoot(),
  palRetry: () => { if (S.pal) { S.pal.res = null; runFind() } },
  busyRetry: () => loadBusy(),
  qoRetry: () => { for (const k of (S.qo && S.qo.bad) || []) { delete S.cache['tree:' + k]; delete S.wait['tree:' + k] } render() },
  queueRetry: () => { S.queueErr = null; paintJobs(); pollRuns() },
  askNo: () => askDone(null),
  askOk: (el) => askDone(Number(el.dataset.i)),
  // 권한 창
  accOpen: (el) => accOpen(el.dataset.k),
  treeMore: (el) => treeMore(el.dataset.k),
  histMore: () => { S.histMax = (S.histMax || HIST_PAGE) + HIST_PAGE; render() },
  accOwnOpen: () => { if (S.acc && !accDirty()) { S.acc.own = ''; S.acc.err = null; render() } },
  accOwnCancel: () => { if (S.acc) { S.acc.own = null; render() } },
  accOwnDo: () => accOwnDo(),
  accClose: async () => { if (!S.acc || S.acc.busy) return; if (accDirty() && !(await ask1('바꾼 권한 버리기', '버리기', true, '저장하지 않은 자리가 있다. 닫으면 버린다'))) return; S.acc = null; render() },
  accSave: () => accSave(),
  accDrop: (el) => { const a = S.acc; if (!a) return; delete a[el.dataset.kind === 'g' ? 'groups' : 'users'][el.dataset.v]; render() },
  accAdd: (el) => { const a = S.acc; if (!a) return; const g = el.dataset.kind === 'G', x = g ? a.addG : a.addU; if (!x) return; a[g ? 'groups' : 'users'][x] = 'read'; a[g ? 'addG' : 'addU'] = ''; render() },
  // 묶음 카드
  grpAddOpen: () => { S.grpAdd = { name: '', members: [] }; S._focus = 'grpName'; render() },
  grpAddCancel: () => { S.grpAdd = null; render() },
  grpAddDo: async () => {
    const f = S.grpAdd
    if (!f || f.busy || !f.name.trim()) return
    if (grpOf(f.name.trim())) { f.err = '같은 이름의 묶음이 있다'; render(); return }
    f.busy = true; f.err = null; render()
    try {
      await postJSON('/api/admin/groups', { name: f.name.trim(), members: f.members })
      S.grpAdd = null; delete S.cache.groups; delete S.cache.users
      toast('묶음을 더했다: ' + esc(f.name.trim()))
    } catch (e) { f.busy = false; f.err = e.code === 'E_CANCEL' ? null : e.message }
    render()
  },
  grpIn: async (el) => { const g = grpOf(el.dataset.g), p = (S.grpPick || {})[el.dataset.g]; if (!g || !p) return; if (await grpSet(g.name, [...g.members, p])) delete S.grpPick[g.name]; render() },
  grpOut: async (el) => { const g = grpOf(el.dataset.g); if (!g) return; await grpSet(g.name, g.members.filter((m) => m !== el.dataset.v)); render() },
  grpDel: async (el) => {
    const g = grpOf(el.dataset.v)
    if (!g) return
    if (!(await ask1(`묶음 지우기: ${g.name}`, '지우기', true, `사람 ${g.members.length} 의 묶음을 지운다. 이 묶음으로 자리를 준 지식 ${g.kns.length}개에서 그 줄도 빠진다(사람 줄 · 모두로 받은 자리는 그대로)`))) return
    try { await postJSON(`/api/admin/groups/${encodeURIComponent(g.name)}/delete`, {}); toast('묶음을 지웠다: ' + esc(g.name)) } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e) }
    delete S.cache.groups; delete S.cache.users
    for (const key of Object.keys(S.cache)) if (key.startsWith('access:')) delete S.cache[key]
    render()
  },
  openSet: (el) => openSet(el.dataset.v),
  guardOpen: (el) => { S.guardOpen = S.guardOpen === el.dataset.v ? '' : el.dataset.v; render() },
  guardRe: () => { delete S.cache['guard:' + S.route.kn]; render() },
  // 옆 메뉴 「설정」 은 보이는 첫 칸으로 연다(Q11 의 예측 가능: 총괄 관리자 점검 · 지식관리자 팀 지식 · 그 밖 에이전트 설치)
  setArea: () => openSettings(),
  sendOpen: (el) => kmGo('send', el.dataset.k),
  pickModel: async (el) => { const st = settingsOf(); if (!st) return; try { const r = await postJSON('/api/settings/model', { role: el.dataset.model, model: el.value }); st.models[r.role] = r.model } catch (e) { toastErr(e) } render() },
  toggleAuto: async (el) => { const st = settingsOf(); if (!st) return; try { const r = await postJSON('/api/settings/auto', { key: el.dataset.v, on: !st.auto[el.dataset.v] }); st.auto[r.key] = r.on } catch (e) { toastErr(e) } render() },
  unlinkOldDevs: async (el) => { const ids = String(el.dataset.v || '').split(',').filter(Boolean); if (!ids.length || !await ask1(`옛 열쇠 ${ids.length} 끊기`, '끊기', true, '같은 PC 에서 다시 이어 남은 옛 열쇠만 끊는다. 지금 쓰는 열쇠는 그대로다')) return render(); let n = 0; for (const id of ids) { try { await postJSON('/api/me/devices/revoke', { id }); n++ } catch (e) { toastErr(e); break } } toast(`옛 열쇠 ${n} 를 끊었다`); delete S.cache.devices; render() },
  unlinkMyDev: async (el) => { S.menu = null; if (!await ask1('기기 끊기', '끊기', true, '이 기기를 끊는다. 그 기기의 Claude Code · 개인 프로그램은 다시 이어야 한다')) return render(); try { await postJSON('/api/me/devices/revoke', { id: el.dataset.id }); toast('끊었다. 그 기기의 Claude Code 는 다시 이어야 한다') } catch (e) { toastErr(e) } delete S.cache.devices; render() },
  pcLoginStart: async () => {
    S.menu = null
    try { await postJSON('/api/claude/login', {}) } catch (e) { toastErr(e); return }
    S.pcLogin = { since: Date.now() }
    render()
    pcLoginPoll()
  },
  pcLoginCheck: () => pcLoginCheck(true),
  pcLoginCancel: () => { S.pcLogin = null; render() },
  claudeOpen: () => { claudeOpen(); loadClaude() },
  claudeClose: () => { S.claudeWin = false; render() },
  // 설정 › 팀 일꾼 — 팀 일꾼 로그인은 거기서 다 한다
  toTeamClaude: () => { S.claudeWin = false; S.stopWin = false; openSet('server') },
  claudeLogin: async () => { S.menu = null; try { await postJSON('/api/claude/login', {}); S.claudeOpening = true; setTimeout(() => { S.claudeOpening = false; dropSettings(); render() }, 60000) } catch (e) { toastErr(e) } render() },
  claudeOff: async () => { S.menu = null; try { await postJSON('/api/settings/auto', { key: 'claude', on: false }); dropSettings(); loadClaude(); toast('Claude 쓰지 않기: 규칙으로 되는 것만 한다 · 저절로 하는 일에서 다시 켠다') } catch (e) { toastErr(e) } render() },
  agentAdd: () => { S.agAdding = true; S._focus = 'agIn'; render() },
  agentAddOk: () => agentDo('add', (S.agDraft || '').trim()),
  agentUp: (el) => agentDo('up', el.dataset.v),
  agentRm: async (el) => { if (!await ask1('작업 폴더에서 kmd 빼기', '빼기', true, '이 작업 폴더에서 kmd 를 뺀다. 스킬 · 연결 · CLAUDE.md 의 kmd 안내를 걷는다')) { S.menu = null; return render() } agentDo('rm', el.dataset.v) },
  agentAllNew: () => agentDo('up'),
  agentMore: (el) => { S.menu = null; S.agAdding = true; S.agDraft = el.dataset.v; S._focus = 'agKnMe'; render() },
  agentDrop: async (el) => { const k = agKnOf(el); if (!await ask1('지식 떼기', '떼기', true, `이 작업 폴더에서 「${k.knName}」 을 뗀다. 다른 지식은 그대로 둔다`)) { S.menu = null; return render() } agentDo('rm', el.dataset.v, k) },
  logoutAll: async () => { S.menu = null; if (!(await edLeave('나가'))) return render(); const c = await ask({ t: '모두 나가기', d: '이 브라우저와 다른 기기 · 브라우저의 들어온 것이 모두 끊긴다. 기기 열쇠(Claude Code 연결 · 개인 프로그램의 팀 잇기)까지 끊을지 고른다', btns: [['dev', '기기 열쇠까지 끊기', 'danger'], ['web', '브라우저만', 'pri']] }); if (!c) return render(); try { await postJSON('/api/me/logout-all', { devices: c === 'dev' }) } catch (e) { toastErr(e); return } location.href = '/' },
  logout: async () => { if (!(await edLeave('나가'))) return; edDrop(); await postJSON('/logout', {}).catch((e) => console.warn('나가기를 서버에 알리지 못했다', e)); location.href = '/' },
  admAddOpen: () => { S.admAdd = { id: '', admin: false, seats: {} }; S._focus = 'admAddIn'; render() },
  admAddAdmin: (el) => { if (S.admAdd) { S.admAdd.admin = el.checked; render() } },
  seatOpen: (el) => { S.menu = null; delete S.cache['seats:' + el.dataset.v]; S.seatWin = { user: el.dataset.v, seats: null }; render() },
  seatClose: () => { S.seatWin = null; render() },
  seatSave: async () => {
    const w = S.seatWin
    if (!w || !w.seats || w.busy) return
    w.busy = true; w.err = null; render()
    try {
      const r = await postJSON(`/api/admin/users/${encodeURIComponent(w.user)}/seats`, { seats: w.seats })
      S.seatWin = null
      delete S.cache.users; for (const key of Object.keys(S.cache)) if (key.startsWith('access:') || key.startsWith('seats:')) delete S.cache[key]
      toast(r.kns.length ? `자리를 바꿨다: ${esc(w.user)} · 지식 ${r.kns.length}` : '바뀐 자리가 없다')
    } catch (e) { if (e.code !== 'E_CANCEL') w.err = e.message; w.busy = false }
    render()
  },
  admAddCancel: () => { S.admAdd = null; render() },
  admAddDo: async () => {
    const v = S.admAdd
    if (!v) return
    v.admin = !!($('#admAddAdmin') || {}).checked
    try { const r = await postJSON('/api/admin/users', { id: (v.id || '').trim(), admin: v.admin, seats: v.admin ? {} : v.seats || {} }); S.admAdd = null; S.admLink = { id: r.id, link: r.link }; for (const key of Object.keys(S.cache)) if (key.startsWith('access:')) delete S.cache[key]; delete S.cache.users; delete S.cache.admin; toast('더했다. 링크를 그 사람에게만 보낸다') } catch (e) { if (e.code !== 'E_CANCEL') v.err = e.message }
    render()
  },
  admLink1: async (el) => {
    S.menu = null
    if (!await ask1('새 처음 들어오기 링크', '만들기', true, `${el.dataset.v}: 새 처음 들어오기 링크를 만든다 · 앞의 링크는 못 쓴다${el.dataset.pw === '1' ? ' · 이미 정한 비밀번호와 들어온 곳은 끊긴다' : ''} · 만들면 바로 복사한다(이 화면을 닫으면 다시 볼 수 없다)`)) return render()
    try { const r = await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/reset`, {}); S.admLink = { id: r.id, link: r.link }; copyText(r.link); toast('새 링크를 복사했다: ' + esc(r.id) + ' 에게만'); delete S.cache.users; delete S.cache.admin } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e) }
    render()
  },
  admCopyLink: () => { if (S.admLink) { copyText(S.admLink.link); toast('복사했다: ' + esc(S.admLink.id) + ' 에게만') } },
  // 들이기 안내 한 덩이 — 아이디 · 들어오기 링크 · 팀 주소 · 들어온 뒤 할 일(에이전트 설치)
  admCopyGuide: () => { const L = S.admLink; if (!L) return; copyText(admGuideText(L)); toast('들이기 안내를 복사했다: ' + esc(L.id) + ' 에게만') },
  pwChange: async () => { const o = ($('#pwOld') || {}).value || '', n = ($('#pwNew') || {}).value || ''; if (n.length < 10) { toast('새 비밀번호는 10자 이상', 6000, true); return } try { await postJSON('/api/me/password', { old: prehash(S.me.user, o), pw: prehash(S.me.user, n) }); toast('비밀번호를 바꿨다. 다른 브라우저는 다시 들어간다'); ($('#pwOld') || {}).value = ''; ($('#pwNew') || {}).value = '' } catch (e) { toastErr(e) } },
  admLogoutAll: async (el) => { S.menu = null; if (!await ask1('모든 곳에서 내보내기', '내보내기', true, `${el.dataset.v} 의 모든 브라우저 들어간 것을 끊는다 · 비밀번호와 기기 열쇠는 그대로`)) return render(); try { await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/logout-all`, {}); toast('내보냈다: ' + esc(el.dataset.v)) } catch (e) { toastErr(e) } render() },
  admAdminSet: async (el) => { S.menu = null; if (el.dataset.on && !await ask1('총괄 관리자 주기', '총괄 관리자로', true, `${el.dataset.v} 에게 총괄 관리자를 준다: 모든 지식의 지식관리자 · 사람 · 묶음 · 백업 · Claude 연결을 다룬다`)) return render(); try { await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/admin`, { admin: !!el.dataset.on }); delete S.cache.users; toast(el.dataset.on ? `총괄 관리자로 했다: ${esc(el.dataset.v)}` : `총괄 관리자에서 뺐다: ${esc(el.dataset.v)}`) } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e) } render() },
  admRevokeAll: async (el) => {
    S.menu = null
    if (!await ask1('기기 모두 끊기', '끊기', true, `${el.dataset.v} 의 기기를 모두 끊는다. 그 사람의 Claude Code 팀 연결 · 개인 프로그램의 팀 잇기가 다시 이어야 한다`)) return render()
    try { const r = await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/revoke-all`, {}); delete S.cache.users; toast(`끊었다. 기기 ${r.revoked}`) } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e) }
    render()
  },
  admOffOpen: (el) => { S.menu = null; S.off = { id: el.dataset.v, to: 'none' }; render() },
  offTo: (el) => { if (S.off) { S.off.to = el.dataset.v; render() } },
  offClose: () => { if (S.off && !S.off.busy) { S.off = null; render() } },
  offDo: async () => {
    const v = S.off
    if (!v || v.busy) return
    v.busy = true; v.err = null; render()
    try {
      const r = await postJSON(`/api/admin/users/${encodeURIComponent(v.id)}/off`, { to: v.to })
      S.off = null
      delete S.cache.users; delete S.cache.admin
      await reloadKns()
      toast(`떠남으로 했다: ${esc(v.id)} · 기기 ${r.devices} 끊음${r.kn ? ` · 지식 ${r.kn.team}${v.to === 'me' ? ' 을 이었다' : ' 의 주인 칸을 비웠다'}` : ''}`, 7000)
    } catch (e) { v.busy = false; if (e.code !== 'E_CANCEL') v.err = e.message }
    render()
  },
  admNoReq: async (el) => {
    const why = await ask({ t: '부탁 거절', d: '거절 까닭은 부탁한 사람에게 간다(비워도 된다)', input: { label: '거절 까닭', value: '' }, ok: '거절하기' })
    if (why === null) return
    try { await postJSON(`/api/requests/${encodeURIComponent(el.dataset.id)}/close`, { state: 'no', why }); delete S.cache.admin; delete S.cache.requests; toast('거절했다. 부탁한 사람에게 알렸다') } catch (e) { toastErr(e) }
    render()
  },
  sudoOk: () => sudoOk(),
  repoEdit: (el) => { S.menu = null; S.repoEdit = el.dataset.k || null; S._focus = 'repoUrl'; render() },
  repoSave: async (el) => {
    const k = el.dataset.k, f = S.rf && S.rf.kn === k ? S.rf : {}
    const url = String(f.url != null ? f.url : (($('#repoUrl') || {}).value || '')).trim(), branch = brVal(f, '')
    if (!url) return toast('저장소 주소를 쓴다')
    try { await postJSON(`/api/k/${encodeURIComponent(k)}/backup`, { url, ...(branch ? { branch } : {}) }); repoDone(k); toast('저장소를 붙였다. 지금까지의 이력을 보낸다') } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e.message || '붙이지 못했다') }
  },
  // GitLab 새로(지식관리 2) — 그룹 · 이름 · 가지 → POST backup/gitlab · 같은 이름의 빈 저장소면 그 주소에 붙일지 묻는다
  repoGitlab: async (el) => {
    const k = el.dataset.k, n = KN(k), f = S.rf && S.rf.kn === k ? S.rf : null
    if (!n || !f || !glReady()) return
    const group = glGroup(f), name = String(f.rname || repoSlug(n.name)).trim(), branch = brVal(f, '')
    if (!REPO_NAME_RE.test(name)) return toastErr('저장소 이름은 영문 · 숫자 · . _ - (영문이나 숫자로 시작)')
    try {
      const g = await postJSON(`/api/k/${encodeURIComponent(k)}/backup/gitlab`, { group, name, ...(branch ? { branch } : {}) })
      if (g.made) { repoDone(k); toast(`GitLab 에 만들어 붙였다: ${esc(g.made.url)} · 가지 ${esc(g.made.branch)}`); return }
      if (g.found && g.empty) {
        if (!await ask1('빈 저장소에 붙이기', '붙이기', false, `${glSay(g)}. 이 저장소에 붙일까?`)) return
        await postJSON(`/api/k/${encodeURIComponent(k)}/backup`, { url: g.found, ...(branch ? { branch } : {}) })
        repoDone(k); toast('저장소를 붙였다. 지금까지의 이력을 보낸다'); return
      }
      toastErr(glSay(g))
    } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e.message || '붙이지 못했다') }
  },
  // 떼기(지식관리 2) — 총괄 관리자 · ask() · 저장소에 보낸 이력은 그대로
  repoDetach: async (el) => {
    const k = el.dataset.k, n = KN(k)
    if (!n || !await ask1('저장소 떼기', '떼기', true, `${n.name}: 저장소를 뗀다. 저장소에 보낸 이력은 그대로 남고 이 지식은 더 보내지 않는다`)) return
    try { await postJSON(`/api/k/${encodeURIComponent(k)}/backup/detach`, {}); repoDone(k); toast('저장소를 뗐다') } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e.message || '떼지 못했다') }
  },
  repoMode: (el) => { const f = brState(el.dataset.k); if (!f) return; f.mode = el.dataset.v; if (el.dataset.v === 'gitlab') glOf(); render(); const b = $(`[data-t=${el.dataset.k}Mode-${el.dataset.v}]`); if (b) b.focus() },
  brFold: (el) => { const key = el.dataset.v, f = brState(key); if (!f) return; f.brOpen = !f.brOpen; S._focus = f.brOpen ? key + 'Br' : key + 'BrFold'; render() },
  addRepoGo: () => { const a = S.addPop; if (!a || !a.done) return; const k = a.done.id; S.addPop = null; go({ scr: 'home', kn: '*', page: 'all', mk: k, mt: 'repo' }) },
  impStop: (el) => { const x = S.imports.find((r) => r.id === el.dataset.v); if (x) { x.stop = true; x.msg = '그만두는 중: 보내던 묶음까지 넣는다'; render() } },
  impTab: (el) => { S.impTab = el.dataset.v; render() },
  genTab: (el) => { if ((S.genTab || 'manual') === el.dataset.v) return; S.genTab = el.dataset.v; S.menu = null; pushHist(); render() },
  pickIn: (el) => { const i = document.getElementById(el.dataset.v); if (i) i.click() },
  impAtt: () => { S.impAtt = !S.impAtt; render() },
  pasteOpen: () => { S.paste = { title: '', tx: '' }; S._focus = 'pasteTitle'; render() },
  pasteClose: () => { S.paste = null; render(); const b = $('[data-t=pasteOpen]'); if (b) b.focus() },
  // 기초 세우기(TODO 9) — 단계 띠 · 지식 · 재료 · 거르기 · 구조안 · 짓기 · 진단 · 넣기 · 그만두기
  seedGo: () => { S.seedKn = defaultKn() || null; go({ scr: 'home', kn: '*', page: 'seed' }) },
  sdOpenSeed: (el) => { S.seedKn = el.dataset.k; go({ scr: 'home', kn: '*', page: 'seed' }) },
  sdOpenRetry: () => { const d = sdState(); d.open = null; d.openErr = null; d.openWait = false; render() },
  sdFeedRetry: () => { const d = sdState(); if (d.feed) d.feed.err = null; sdFeedLoad(d.kn).then(render) },
  sdReload: () => { const d = sdState(); d.err = null; d.v = null; render() },
  sdResume: (el) => { const d = sdState(); d.kn = el.dataset.k; d.v = null; d.err = null; d.pick0 = false; d.back = false; d.ui = 1; render() },
  sdGoStep: (el) => {
    const i = Number(el.dataset.v), d = sdState(), w = sdWork(d), st = sdStep(d)
    if (el.getAttribute('aria-disabled') === 'true' || i === st || d.busy) return
    if (i === 0) { d.pick0 = true; d.open = null; d.openWait = false; render(); return }
    d.pick0 = false
    if (!w) { d.ui = i; render(); return }
    if (i === 1) { d.back = true; render(); return }
    d.back = false
    sdDo('step', () => postJSON(sdUrl(d.kn, 'step'), { ui: i }))
  },
  sdNext0: () => { const d = sdState(); if (!d.kn) return; d.pick0 = false; d.ui = 1; if (!d.v) d.loading = false; render() },
  sdBack0: () => { const d = sdState(); d.pick0 = true; render() },
  sdBack1: () => { const d = sdState(); d.back = true; render() },
  sdBack: () => { const d = sdState(), st = sdStep(d); sdDo('step', () => postJSON(sdUrl(d.kn, 'step'), { ui: Math.max(2, st - 1) })) },
  sdNext: () => { const d = sdState(), st = sdStep(d); sdDo('step', () => postJSON(sdUrl(d.kn, 'step'), { ui: st + 1 })) },
  // 팀 — 올린 묶음으로 조사 · 다음 묶음(I2) · 걸음 실패 문서 고치기 · 24시간 멈춤 깨우기
  sdSurveyGroup: () => {
    const d = sdState(), g = d.v && d.v.team && d.v.team.upload
    if (!g || !g.last) return
    sdDo('survey', async () => { await postJSON('/api/shape/survey', { kn: d.kn, group: g.id }); d.back = false; d.next = false; d.up = null })
  },
  sdNextGroup: () => { const d = sdState(); d.next = true; d.up = null; d.actErr = null; render() },
  sdFixDoc: async (el) => { await sdPeek(Number(el.dataset.v)); if (S.sdw && !S.sdw.err) ACT.sdwEdit() },
  sdWake: () => { const d = sdState(), w = sdWork(d); if (w) sdDo('step', () => postJSON(sdUrl(d.kn, 'step'), { ui: Math.max(2, Math.min(6, w.ui || 2)) })) },
  sdSurvey: () => {
    const d = sdState(), w = sdWork(d), dir = (d.path || (w && w.src) || '').trim()
    if (!dir) return
    sdDo('survey', async () => { await postJSON('/api/shape/survey', { kn: d.kn, dir }); d.back = false; d.path = dir })
  },
  sdPickAll: () => {
    const d = sdState(), w = sdWork(d)
    if (!w) return
    const picks = {}
    for (const r of w.rows || []) if (r.src && r.role !== '비밀 의심' && r.role !== '같은 글' && r.pick !== '넣음') picks[r.path] = '넣음'
    if (!Object.keys(picks).length) return
    sdDo('pick', () => postJSON(sdUrl(d.kn, 'pick'), { picks }))
  },
  sdPlan: (el) => { const d = sdState(); if (el.getAttribute('aria-checked') === 'true' && el.dataset.v === 'folder') return; sdDo('plan', () => postJSON(sdUrl(d.kn, 'plan'), { mode: el.dataset.v })) },
  sdWriteOne: (el) => { const d = sdState(), w = sdWork(d), x = w && w.docs[Number(el.dataset.v)]; if (x) sdDo('write', () => postJSON(sdUrl(d.kn, 'write'), { doc: x.id })) },
  sdWriteAll: () => { const d = sdState(); sdDo('write', () => postJSON(sdUrl(d.kn, 'write'), { all: true })) },
  sdStopRun: () => { const d = sdState(); sdDo('stop', () => postJSON(sdUrl(d.kn, 'write'), { stop: true })) },
  sdApprove: (el) => { const d = sdState(), w = sdWork(d), x = w && w.docs[Number(el.dataset.v)]; if (x) sdDo('approve', () => postJSON(sdUrl(d.kn, 'write'), { approve: x.id })) },
  sdPeek: (el) => sdPeek(Number(el.dataset.v)),
  sdwClose: () => { if (S.sdw && S.sdw.busy) return; S.sdw = null; render() },
  sdwEdit: () => { const x = S.sdw, w = sdWork(sdState()), doc = w && x && w.docs.find((y) => y.id === x.doc); if (!doc) return; x.rows = doc.items.map((it) => ((x.text && x.text.items) || []).find((y) => y.h === it.h)?.content || ''); x.edit = true; render() },
  sdwEditOff: () => { if (S.sdw) { S.sdw.edit = false; render() } },
  sdwSave: async () => {
    const x = S.sdw, d = sdState(), w = sdWork(d), doc = w && x && w.docs.find((y) => y.id === x.doc)
    if (!doc || x.busy) return
    x.busy = true; x.err = null; render()
    try {
      d.v = await postJSON(sdUrl(d.kn, 'write'), { doc: doc.id, items: doc.items.map((it, i) => ({ h: it.h, content: x.rows[i] || '' })) })
      const now = sdWork(d).docs.find((y) => y.id === doc.id)
      if (now && now.state === 'fail') { x.err = now.why || '걸렸다'; x.busy = false; render(); return }
      S.sdw = null
      toast(w.stage === 'stopped' ? '저장했다 · 이어 넣기' : '저장했다 · 연습 판 전')
    } catch (e) { x.err = e.message; x.busy = false }
    render()
  },
  sdwApprove: () => { const x = S.sdw, d = sdState(); if (!x) return; S.sdw = null; sdDo('approve', () => postJSON(sdUrl(d.kn, 'write'), { approve: x.doc })) },
  sdTry: () => { const d = sdState(); sdDo('try', () => postJSON(sdUrl(d.kn, 'try'), {})) },
  sdPut: async () => {
    const d = sdState(), w = sdWork(d), k = KN(d.kn), st = sdStep(d)
    if (!w || d.busy) return
    if (st === 5) {
      const c = (w.tried && w.tried.diag && w.tried.diag.counts) || {}
      if (!(await ask({ t: '넣기', d: `${k ? k.name : d.kn} 에 문서 ${c.docs ?? w.docs.length} · 항목 ${c.items ?? '-'} 을 넣는다`, ok: '넣기' }))) return
      try { await postJSON(sdUrl(d.kn, 'step'), { ui: 6 }) } catch (e) { d.actErr = e; render(); return }
    }
    d.busy = 'put'; d.actErr = null; d.t0 = Date.now(); render(); sdTick()
    try {
      const r = await postJSON(`/api/k/${encodeURIComponent(d.kn)}/shape/put`, {})
      if (r.done) toast('다 넣었다')
      else if (r.conflict || r.again) d.actErr = new Error('그사이 바뀌었다: 이어 넣기로 다시 맞춘다')
    } catch (e) { d.actErr = e } finally { d.busy = '' }
    await reloadKns()
    await sdLoad(d.kn, true)
  },
  sdQuit: async () => {
    const d = sdState(), w = sdWork(d)
    S.menu = null
    if (w && w.stage !== 'done' && !(await ask({ t: '그만두기', d: '지은 구조안 · 글을 버린다. 지식은 그대로다', ok: '그만두기', danger: true }))) return render()
    try { await postJSON(`/api/k/${encodeURIComponent(d.kn)}/shape/stop`, {}) } catch (e) { toastErr(e); return }
    d.v = null; d.ui = 0; d.pick0 = true; d.back = false; d.next = false; d.up = null; d.path = ''; d.open = null; d.openWait = false
    render()
  },
  impFil: (el) => { S.impFil = el.dataset.v; paintJobs() },
  impSel: (el) => { S.impSel = el.dataset.id; S.impTfil = 'all'; paintJobs(); pollRuns(); if (innerWidth <= 600) setTimeout(() => { const d = $('[data-t=impDet]'); if (d) d.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, 50) },
  qAct: (el) => qAct(el.dataset.id, el.dataset.v),
  qHold: async (el) => { try { await postJSON('/api/queue/hold', { on: el.dataset.v === '1' }); opsQueueSet((o) => { o.hold = el.dataset.v === '1' }); toast(el.dataset.v === '1' ? '줄 멈춤: 도는 일은 지금 단계를 마치고 선다' : '줄을 다시 돌린다') } catch (e) { toastErr(e) } pollRuns() },
  srcOpenQ: (el) => { const s = (sourcesOf()?.items || []).find((x) => x.kn === el.dataset.k && x.name === el.dataset.v); if (s) srcOpen(srcId(s)) },
  impStg: (el) => { S.impTfil = S.impTfil === el.dataset.v ? 'all' : el.dataset.v; paintJobs() },
  impTfil: (el) => { S.impTfil = el.dataset.v; paintJobs() },
  impPage: (el) => { S.impPage = +el.dataset.v; paintJobs() },
  palQo: () => { const q = S.pal ? S.pal.q : ''; S.pal = null; openQo(); if (S.qo) S.qo.q = q; render() },
  palName: (el) => { S.pal = null; openTab({ kind: el.dataset.kind, kn: el.dataset.k, ref: el.dataset.v }); render(); scrollTopMain() },
  // 넣은 파일의 기록 — Claude 가 읽고 사람이 읽을 기록으로 다시 쓴다(로그인이 없으면 Claude 연결 창)
  readRec: async (el) => {
    const k = el.dataset.k, r = el.dataset.r
    S.reading = { ...(S.reading || {}), [r]: true }
    render()
    try { const x = await postJSON(`/api/k/${encodeURIComponent(k)}/rec/read`, { r }); forgetKn(k); toast(`기록을 정리했다: ${esc(x.title || '')}`) } catch (e) { if (/로그인/.test(e.message)) claudeOpen(); toastErr(e) }
    delete S.reading[r]
    render()
  },
  unwatchDoc: async (el) => {
    if (!await ask1('내 문서로 고치기', '내 문서로', false, '원본이 없어진 사본이다. 「원본이 주인」 표지를 걷어 내 문서로 고친다')) return
    try { await postJSON(`/api/k/${encodeURIComponent(el.dataset.k)}/unwatch`, { doc: el.dataset.d }); forgetKn(el.dataset.k); toast('내 문서로 했다. 이제 고칠 수 있다') } catch (e) { toastErr(e) }
    render()
  },
  sudoCancel: () => sudoCancel(),
  admUnlock: async (el) => { try { await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/unlock`, {}); delete S.cache.admin; toast('풀었다') } catch (e) { toastErr(e) } render() },
  admAddReq: async (el) => {
    const pool = [...((S.cache.admin || {}).requests || []), ...(Array.isArray(S.cache.requests) ? S.cache.requests : [])]
    const r = pool.find((x) => x.id === el.dataset.id)
    if (!r) return
    try { await postJSON(`/api/k/${encodeURIComponent(r.kn)}/sources`, { name: r.name, at: r.at2, kind: r.kind, rules: r.rules, every: r.every, db: r.db }); delete S.cache.admin; delete S.cache.requests; dropSrcs(); toast('더했다: ' + esc(r.name)) } catch (e) { toastErr(e) }
    render()
  },
  admKeep: async (el) => {
    const k = S.kns.find((x) => x.name === el.dataset.v)
    if (!k || !await ask1('백업 덮기', '덮기', true, `${k.name}: 서버의 지금 글로 백업을 덮는다 · 백업에만 있던 묶음은 백업에서 사라진다(서버에는 처음부터 없다)`)) return
    try { await postJSON(`/api/k/${encodeURIComponent(k.id)}/backup/keep`, {}); delete S.cache.admin; loadStops(); toast('백업을 서버 것으로 덮었다: ' + esc(k.name)) } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e) }
    render()
  },
  admAdopt: async (el) => {
    const k = S.kns.find((x) => x.name === el.dataset.v)
    if (!k) return
    const b0 = ((overviewOf() || {}).backups || []).find((x) => x.name === el.dataset.v)
    if (b0 && b0.verdict !== 'moved' && !await ask1('백업의 글로 잇기', '잇기', true, `${k.name}: 백업의 글로 이어 쓴다 · 서버에만 있던 것은 가지(kmd-before-…)로 남는다`)) return
    if (b0 && b0.verdict === 'moved') {
      const lost = await getJSON(`/api/k/${encodeURIComponent(k.id)}/backup/lost`).catch(() => null)
      const n = lost ? lost.records.length : 0
      if (!await ask1('백업의 글로 잇기', '잇기', true, `${k.name}: 백업의 글로 이어 쓴다.${lost ? `\n서버에만 있던 기록 ${n} · 문서 ${lost.docs.length} 가 지식에서 빠진다(가지 kmd-before-… 에 남는다 · 쓴 사람에게 알린다)${n ? '\n' + lost.records.slice(0, 8).map((r) => '- ' + r.title + (r.author ? ' · ' + r.author : '')).join('\n') : ''}` : ''}`)) return
    }
    if (b0 && b0.verdict === 'behind' && !await ask1('백업에서 받기', '받기', false, `${k.name}: 백업에 앞선 묶음을 받는다(앞으로만 · 받은 글에 새 오류면 되돌린다)`)) return
    try { const b = (overviewOf() || {}).backups.find((x) => x.name === el.dataset.v); await postJSON(`/api/k/${encodeURIComponent(k.id)}/${b && b.verdict === 'behind' ? 'backup/pull' : 'backup/adopt'}`, {}); delete S.cache.admin; forgetKn(k.id); loadStops(); toast('맞췄다: ' + esc(k.name)) } catch (e) { toastErr(e) }
    render()
  },
  bkRootSet: async () => {
    const root = (($('#bkRoot') || {}).value || '').trim()
    if (!root) return toast('지식백업 폴더를 쓴다')
    try { const r = await postJSON('/api/pc/backup', { root }); dropSettings(); loadStops(); toast(`지식백업을 정했다. 붙인 지식 ${r.attached}${r.failed.length ? ` · 못 붙임 ${r.failed.length}: ${esc(r.failed[0])}` : ''}`, 7000) } catch (e) { toastErr(e) }
    render()
  },
  restoreDo: async () => {
    const f = S.rs || {}
    const url = String(f.url || '').trim()
    const name = String(f.name || '').trim() || undefined, practice = !!f.practice, branch = brVal(f, '')
    if (!url) { toast('저장소 주소를 쓴다'); return }
    if (S.restoring) return
    S.restoring = true
    render()
    try {
      const r = await postJSON('/api/restore', { url, name, ...(branch ? { branch } : {}), ...(practice ? { attach: false } : {}) })
      await reloadKns()
      dropSettings()
      S.rsWin = false; S.rs = null
      toast(`되살렸다: ${esc(r.id)} · 문서 ${r.docs} · 기록 ${r.records}${r.attached ? ' · 같은 백업으로 이어 보낸다' : ' · 읽기만 사본(원래 백업에 보내지 않는다)'}`, 8000)
    } catch (e) { if (e.code !== 'E_CANCEL') toastErr(e) }
    S.restoring = false
    render()
  },
  admLoginStart: () => admLoginStart(),
  admCheck: () => admCheck(true),
  admFlowCancel: () => { if (S.admStep === 'code' || S.admStep === 'window') postJSON('/api/admin/claude/cancel', {}).catch(() => {}); S.admStep = null; S.admErr = null; S.admCode = ''; render() },
  admCopyUrl: () => { copyText(S.admUrl || ''); toast('복사했다') },
  admDone: () => admDone(),
  fetchSrc: (el) => fetchSrc(el.dataset.id),
  resyncSrc: (el) => resyncSrc(el.dataset.id),
  toggleMeaning: async (el) => { const [kn, name] = el.dataset.id.split('|'); S.menu = null; try { await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/meaning`, { name, on: !!el.dataset.v }); dropSrcs(); toast(el.dataset.v ? '뜻 갱신을 켰다. 이제 바뀐 코드로 관련 항목 글도 맞춘다' : '뜻 갱신을 껐다. 표만 채운다') } catch (e) { toastErr(e) } render() },
  fetchAll: async () => {
    if (S.fetchAll) return
    const k = impTarget().kn // 고른 지식의 가져올 곳만(메뉴 개편 N5)
    const xs = ((sourcesOf() || {}).items || []).filter((x) => x.kind !== 'pc' && x.kn === k)
    S.fetchAll = { n: 0, all: xs.length, bad: 0 }
    render()
    for (const s of xs) { await fetchSrc(s.kn + '|' + s.name); S.fetchAll.n++; if (/^못 /.test(String(S.srcRun[srcId(s)] || ''))) S.fetchAll.bad++; render() }
    const r = S.fetchAll
    S.fetchAll = null
    render()
    if (r.bad) toast(`모두 수집을 마쳤다: ${r.all} 중 ${r.bad} 은 못 가져왔다`, 8000, true)
    else toast(`모두 수집을 마쳤다: ${r.all}`)
  },
  setEvery: async (el, ev) => {
    if (ev.target.closest('[data-stop]')) return
    const [kn, name] = el.dataset.id.split('|'), at = ($('#evAt') || {}).value || '06:00'
    const every = el.dataset.v === 'daily' ? 'daily ' + at : el.dataset.v
    S.menu = null
    try { await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/every`, { name, every }); dropSrcs(); toast('언제를 바꿨다: ' + everyTxt(every)) } catch (e) { toastErr(e) }
    render()
  },
  sfType: (el) => { const f = sfState(); f.type = el.dataset.v; f.rule = f.type === 'db' ? 'dbtables' : f.rule === 'dbtables' ? 'deps' : f.rule; S.sfMsg = null; render() },
  // 지금 하는 일 팝업의 줄 — 그 일의 진행 현황으로(D6): 가져오기 · Claude Code · 기록을 문서에 넣기(옛 개인 지식) · 파일 묶음은 생성 › 도는 일의 그 줄 ·
  //   팀 들이기 일감도 생성 › 도는 일의 그 줄(t:<일감>). 개인 프로그램 쪽 일(~)이면 개인 영역으로 바꿔 그쪽 일 줄을 읽는다 · 그 줄로 스크롤하고 잠깐 빛낸다
  busyGo: (el) => {
    S.menu = null
    const { kind, k, run, qid } = el.dataset
    const sel = qid || (kind === 'run' ? run : kind === 'source' ? `src:${k}|${el.dataset.name || ''}` : '')
    if (sel && ['run', 'source', 'group', 'intake'].includes(kind)) {
      Object.assign(S, { impTab: 'queue', impFil: 'all', impSel: sel, _flashSel: 'imp', _flashAt: Date.now(), _flashHead: false })
      go({ scr: 'import' })
      return
    }
    go({ scr: 'docs', kn: k })
  },
  busyDoc: (el) => { S.menu = null; go({ scr: 'docs', kn: el.dataset.k }) },
  termToggle: (el) => { const id = el.dataset.id; (S.termOpen ||= {})[id] = !S.termOpen[id]; paintJobs(); pollRuns() },
  sfAdd: () => sfAdd(false),
  sfOpen: (el) => { S.menu = null; const f = sfState(); const k = impTarget().kn; if (k) f.kn = k; if (el && el.dataset.v) { f.type = el.dataset.v; f.rule = f.type === 'db' ? 'dbtables' : f.rule === 'dbtables' ? 'deps' : f.rule } S.sfOpen = true; S.sfMsg = null; render() },
  sfClose: () => { S.sfOpen = false; render() },
  stopOpen: () => { S.stopWin = true; S.menu = null; loadStops(); render() },
  stopClose: () => { S.stopWin = false; render() },
  stopReload: () => loadStops().then((r) => { render(); if (r !== true) toastErr('경고를 읽지 못했다: ' + ((r && r.message) || '')) }),
  stopGo: (el) => {
    S.stopWin = false; S.menu = null
    const id = el.dataset.v, k = el.dataset.k && KN(el.dataset.k) ? el.dataset.k : null
    // 저장소(팀) — 그 지식의 상세 › 저장소 · 지식 메뉴 화면(자동수집 · 공유) — 멈춤 줄의 지식으로
    if (id === 'repo') return go(k ? { scr: 'home', kn: '*', page: 'all', mk: k, mt: 'repo' } : { scr: 'home', kn: '*', page: 'all' })
    if (k && KM_SCR.includes(id)) return kmGo(id, k, id === 'import' ? 'auto' : undefined)
    openSet(id)
  },
  srcOpen: (el) => srcOpen(el.dataset.id),
  seClose: () => { if (S.se && !S.se.busy) { S.se = null; render() } },
  seSave: () => seSave(),
  seDel: () => { S.se.del = true; render() },
  seDelNo: () => { S.se.del = false; render() },
  seDelOk: () => seDelOk(),
  seMeaning: () => { S.se.meaning = !S.se.meaning; render() },
  sfAsk: () => sfAdd(true),
  sfProbe: () => sfProbe(),
  sfCheck: () => sfCheck(),
  impGo: (el) => { openTab({ kind: 'doc', kn: el.dataset.k, ref: el.dataset.d }, { view: 'docs' }); render() },
  delOpen: (el, ev) => { ev.stopPropagation(); S.menu = null; S.del = { kn: el.dataset.k, typed: '' }; S._focus = 'delIn'; render() },
  delClose: () => { if (S.del && !S.del.busy) { S.del = null; render() } },
  delDo: () => delDo(),
  copyRoot: () => { copyText(knRoot()); toast('지식 폴더 경로를 복사했다') },
  copyMeRoot: () => { copyText(meRootNow()); toast('지식 폴더 경로를 복사했다') },
  meRootEdit: () => { S.meRootEdit = meRootNow(); S.meRootErr = null; S._focus = 'meRootIn'; render() },
  meRootCancel: () => { S.meRootEdit = null; S.meRootErr = null; render() },
  meRootSave: () => meRootSave(),
  meRootDrop: () => meRootDrop(),
  doAdd: () => doAdd(),
  openAdd: () => openAdd(),
  addClose: () => { if (S.addPop && !S.addPop.busy) { S.addPop = null; render() } },
  syncKn: () => syncKn(),
  knMove: (el, ev) => { ev.stopPropagation(); S.menu = null; knMove(el.dataset.k, Number(el.dataset.v)) },
  knHide: (el, ev) => { ev.stopPropagation(); S.menu = null; knHide(el.dataset.k, !!el.dataset.v) },
  // 지식 보내기 — 보내는 지식 · 탭 · 고르기 · 받는 지식 정하기 / 바꾸기 · 확인 창
  sendTab: (el) => { S.sendTab = el.dataset.v; render() },
  sendRecAll: (el) => { S.sendRecAll = !!el.dataset.v; render() },
  sendPick: (el) => { (S.sendSel ||= {})[el.dataset.v] = el.checked; if (!el.checked && el.dataset.v.startsWith('d|')) delete (S.sendWhole || {})[el.dataset.v.slice(2)]; render() },
  sendWhole: (el, ev) => { ev.preventDefault(); (S.sendWhole ||= {})[el.dataset.v] = !!el.dataset.on; render() },
  sendAll: (el) => { const src = sendSrc(), v = src && S.cache['send:' + src.id]; if (v && !v.error) for (const x of v.recs) if (!x.sent) (S.sendSel ||= {})['r|' + x.id] = !!el.dataset.v; render() },
  sendPickTo: (el) => { S.sendPickTo = el.dataset.v; render() },
  sendSetRoute: () => { const src = sendSrc(), w = S.sendWin; if (src && w && w.to) sendRoute(src.id, w.to) },
  // 보내기 확인 창을 열 때마다 미리 보기(저장 제안)를 새로 받는다 — 지난 제안 · 오류를 다시 보이지 않게
  sendWin: (el) => { S.sendWin = { kind: el.dataset.v, to: null, type: '', err: null }; if (el.dataset.v === 'confirm') for (const k of Object.keys(S.cache)) if (k.startsWith('sendPrev:')) delete S.cache[k]; if (el.dataset.v === 'change') S._focus = null; render() },
  sendWinTo: (el) => { S.sendWin.to = el.dataset.v; S.sendWin.type = ''; S.sendWin.err = null; if (S.sendWin.kind === 'change') S._focus = 'sendType'; render() },
  sendWinClose: () => { if (!S.sending) { S.sendWin = null; render() } },
  sendChangeGo: () => { const src = sendSrc(), w = S.sendWin; if (src && w && w.to) sendRoute(src.id, w.to, w.type) },
  doSend: () => doSend(),
  sendWaitAct: async (el) => {
    const drop = el.dataset.v === 'drop'
    if (drop && !await ask1('이 줄 버리기', '버리기', true, '이 줄을 버린다. 보내지 않는다(내 글은 그대로 · 다시 고르면 다시 보낼 수 있다)')) return
    try { const r = await postJSON(`/api/k/${encodeURIComponent(el.dataset.k)}/send/wait`, { id: el.dataset.id, act: el.dataset.v }); toast(drop ? `버렸다: ${r.dropped}개` : `보냈다: ${r.sent}개`) } catch (e) { toastErr(e) }
    delete S.cache['send:' + el.dataset.k]
    await reloadKns()
    loadStops()
    render()
  },
  toggleToday: (el) => { S.openToday = S.openToday === el.dataset.id ? null : el.dataset.id; render() },
  todayGo: (el) => { const x = histFind(el.dataset.id); if (x && x.go) openDocAt(x.go.kn, x.go.doc, x.go.hl || null, null, 'docs') },
  revertToday: async (el) => {
    const x = histFind(el.dataset.id)
    if (!x || !await ask1('되돌리기', '되돌리기', true, '그 줄을 넣기 전 글로 되돌린다. 그 줄에 든 기록은 다시 넣지 않는다')) return
    try { await postJSON(`/api/k/${encodeURIComponent(x.kn)}/revert`, { record: x.revert }); x.reverted = true; forgetKn(x.kn); toast('되돌렸다. 넣기 전 글로 · 그 기록은 다시 문서 옆에 같이 읽힌다'); render() } catch (e) { toastErr(e) }
  },
  // 항목 하나 되돌리기(S5) — 그 기록이 넣기 전 글로 · 서버가 자리 · 지문을 다시 본다(그 뒤 누가 고쳤으면 E_CONFLICT)
  revertItem: async (el) => {
    const x = histFind(el.dataset.id)
    const it = x && x.items && x.items[Number(el.dataset.i)]
    if (!it || !await ask1('항목 되돌리기', '되돌리기', true, `「${it.name} › ${it.heading}」 을 이 기록이 넣기 전 글로 되돌린다${it.isNew ? '(이 기록이 세운 항목이라 항목을 지운다)' : ''}. 되돌린 일은 이력에 남는다`)) return
    try {
      await postJSON(`/api/k/${encodeURIComponent(x.kn)}/revert`, { record: x.rec, doc: it.doc, heading: it.heading })
      it.live = false; it.reverted = true; x.canRevert = x.items.some((y) => y.live)
      forgetKn(x.kn); delete S.cache.history
      toast(it.isNew ? '되돌렸다. 그 항목을 지웠다' : '되돌렸다. 그 항목은 넣기 전 글로')
      render()
    } catch (e) { toastErr(e) }
  },
  unlinkDev: async (el) => {
    const x = histFind(el.dataset.id)
    if (!x || !await ask1('기기 끊기', '끊기', true, '그 기기를 끊는다. 그 기기의 Claude Code 는 다시 이어야 한다')) return
    try { await postJSON('/api/me/devices/revoke', { id: x.device }); x.unlinked = true; toast('끊었다. 그 기기의 Claude Code 는 다시 이어야 한다'); render() } catch (e) { toastErr(e) }
  },
  // 들어간 것 하루 요약(P-D13) — 알리기만(승인 받고 넣기는 P11 에서 걷었다)
  knReview: async (el) => {
    S.menu = null
    const k = el.dataset.k, n = KN(k), on = !(n && n.review)
      if (!await ask1(on ? '하루 요약 켜기' : '하루 요약 끄기', on ? '켜기' : '끄기', false, on ? '하루에 한 번 지난날 들어간 기록 수를 지식관리자에게 알린다' : '하루 요약 알림을 그만 보낸다')) return
      try { await postJSON(`/api/k/${encodeURIComponent(k)}/owner`, { review: on }); await reloadKns(); toast(on ? '<b>하루 요약을 켰다</b>' : '<b>하루 요약을 껐다</b>') } catch (e) { toastErr(e) }
    render()
  },
  knIssue: async (el) => {
    S.menu = null
    const k = el.dataset.k, n = KN(k)
    const v = await ask({ t: '이슈 주소', d: '갈래 이름에 「이슈」 가 든 항목의 값(예: DPMS-ISS-15)을 {값} 자리에 넣어 연다. 비우면 걷는다', input: { label: '주소 틀', value: (n && n.issueUrl) || 'https://' }, ok: '저장' })
    if (v == null) return
    const u = v.trim() === 'https://' ? '' : v.trim()
    try { await postJSON(`/api/k/${encodeURIComponent(k)}/owner`, { issueUrl: u }); await reloadKns(); toast(u ? '<b>이슈 주소를 정했다</b> · 항목 화면에 [이슈 열기]' : '<b>이슈 주소를 걷었다</b>') } catch (e) { toastErr(e) }
  },
  auditMore: () => { S.auditMore = true; render() },
  auditRe: () => { delete S.cache.audit; render() },
  pastOpen: (el) => { S.past = { k: el.dataset.k, d: el.dataset.d, title: el.dataset.v, at: null, cmp: false }; render() },
  pastPick: (el) => { S.past.at = el.dataset.v; render() },
  pastCmp: (el) => { S.past.cmp = !!el.dataset.v; render() },
  pastClose: () => { S.past = null; render() },
  restoreRemoved: async (el) => {
    const k = el.dataset.k
    if (!await ask1(`「${el.dataset.v}」 되살리기`, '되살리기', false, '지운 때의 글로 이 항목을 문서 끝에 다시 세운다. 이력에 남고, 거기서 다시 되돌릴 수 있다')) return
    try { await postJSON(`/api/k/${encodeURIComponent(k)}/removed/restore`, { rec: el.dataset.r, doc: el.dataset.d, heading: el.dataset.v }); delete S.cache['removed:' + k]; forgetKn(k); toast(`<b>「${esc(el.dataset.v)}」 를 되살렸다</b>`) } catch (e) { toastErr(e) }
    render()
  },
  stopAck: async (el) => { try { await postJSON('/api/stops/ack', { key: el.dataset.v }); S.stops = S.stops.filter((x) => x.key !== el.dataset.v); toast('경고를 걷었다 · 양이나 까닭이 바뀌면 다시 선다'); render() } catch (e) { toastErr(e) } },
  watchDoc: (el) => { const key = el.dataset.k + '|' + el.dataset.d; const w = watchList(); if (w[key]) delete w[key]; else { w[key] = { at: Date.now(), title: el.dataset.v }; if (window.Notification && Notification.permission === 'default') Notification.requestPermission().catch((e) => console.warn('알림 허락을 묻지 못했다', e)) } watchSave(w); toast(w[key] ? '<b>지켜본다</b> · 남이 바꾸면 알린다(이 브라우저)' : '지켜보기를 그만뒀다'); render() },
  ckTab: (el) => { if (S.ckTab === el.dataset.v) return; S.ckTab = el.dataset.v; pushHist(); render() },
  mtOpen: (el) => { S.mtOpen = S.mtOpen === el.dataset.v ? '' : el.dataset.v; render() },
  mtRe: () => { const k = ckKn(); if (k) delete S.cache[mtKey(k)]; render() },
  kchkGuard: (el) => kmGo('held', el.dataset.k, 'check'),
  kchkReq: (el) => kmGo('import', el.dataset.k, 'auto'),
  kchkSrc: (el) => kmGo('import', el.dataset.k, 'auto'),
  // Claude 에 보내지 않음(지식관리자 · 설정 › 팀 지식) — 들이기 · 다듬기에 이 지식의 글을 보내지 않는다
  toggleNoClaude: (el) => { const k = el.dataset.k, kn = KN(k); if (kn) setOwnerRow(k, { noClaude: !kn.noClaude }) },
  // 문서 다듬기(S13 · K10-4) — 지식관리자 · 팀 일꾼이 문체 · 짜임만 정돈한다
  polishDoc: async (el) => {
    const k = el.dataset.k, doc = el.dataset.d
    if (!(await ask({ t: '이 문서를 다듬는다', d: '문체 · 짜임만 정돈한다. 값은 바꾸지 않는다(값이 바뀌는 항목은 넣지 않는다). 팀 일꾼이 하고, 결과는 이력에서 항목마다 되돌릴 수 있다', ok: '다듬기' }))) return
    try {
      const r = await postJSON(`/api/k/${encodeURIComponent(k)}/polish`, { doc })
      toast(r.state === 'aborted' ? '다듬기를 걸지 못했다' : r.again ? '이미 팀 일꾼이 다듬는 중이다' : '도는 일에 올렸다: 팀 일꾼이 다듬으면 이력에 「다듬기」 로 남는다', 7000)
    } catch (e) { toastErr(e) }
  },
  // 충돌 고르기 — 내 글로: 새 지문으로 다시 보낸다(이력에 남아 되돌릴 수 있다) · 그쪽 글로: 쓰던 글을 버리고 새 글로
  pasteGo: async () => {
    const tx = (($('#pasteTx') || {}).value || '').trim(), ti = (($('#pasteTitle') || {}).value || '').trim() || tx.split('\n')[0].slice(0, 40)
    if (!tx) { toast('붙여 넣을 글이 없다'); return }
    S.paste = null
    const name = (ti.replace(/[\\/:*?"<>|#%]/g, ' ').trim() || '붙여넣은 글').slice(0, 40) + '.md'
    await takeFiles([new File(['# ' + ti + '\n\n' + tx + '\n'], name, { type: 'text/markdown' })])
  },
  copyDocPath: (el) => { copyText(el.dataset.v); toast('파일 경로를 복사했다: 편집기로 고치면 곧 문서에 들어간다') },
  edForce: async () => { const e = S.edit; if (!e) return; if (!await ask1('내 글로 저장', '내 글로 저장', true, `그사이 바뀐 글(${(e.conflict || []).map((x) => x.h).join(' · ')})을 내 글로 바꾼다. 남이 고친 것은 이력에 남아 되돌릴 수 있다`)) return; e.keepBase = null; e.conflict = null; e.err = null; await saveDoc() },
  edTheirs: () => { const e = S.edit; if (!e) return; const v = S.cache[`doc:${e.kn}:${e.doc}:ed`]; e.text = v ? edOrig(v) : null; e.keepBase = null; e.conflict = null; e.err = null; render() },
  edGoSec: (el) => { const ta = $('#edTx'); if (!ta) return; const i = ta.value.indexOf('## ' + el.dataset.v); if (i < 0) return; ta.focus(); ta.setSelectionRange(i, i + 3 + el.dataset.v.length); const lh = ta.scrollHeight / Math.max(1, ta.value.split('\n').length); ta.scrollTop = ta.value.slice(0, i).split('\n').length * lh - 40 },
  edPreview: () => { if (!S.edit) return; const ta = $('#edTx'); if (ta && !S.edit.busy) S.edit.text = ta.value; S.edit.preview = !S.edit.preview; render() },
  reLogin: async () => { if (canRelogin()) { await askLogin(); S.loginLost = false; loadStops(); loadBusy(); render() } else location.reload() },
  palAlias: () => palAliasGo(),
  palF: (el) => { S.palF = el.dataset.v; const b = $('#palBody') || $('[data-t=palBody]'); if (b) b.innerHTML = palBody(); else render() },
  keysClose: () => { S.keys = false; render() },
  keysOpen: () => { S.menu = null; S.keys = true; render() },
  qoAll: () => { if (S.qo) { S.qo.all = true; render() } },
  copySeatAsk: async () => { const t = `kmd 팀 지식 자리를 부탁합니다: 아이디 ${S.me.user} · 볼 지식과 자리(읽기 · 쓰기)를 정해 주세요 · 팀 화면 ${location.origin}`; try { await navigator.clipboard.writeText(t); toast('부탁 글을 복사했다. 관리자에게 보낸다') } catch { toast(esc(t), 12000) } },
  editDoc: async () => {
    const t = activeTab()
    if (!t) return
    if (S.edit && (S.edit.kn !== t.kn || S.edit.doc !== t.ref)) { if (!(await edLeave(`「${S.edit.doc}」 를 고치던 중이다. 다른 문서를 고치`))) return; edDrop() }
    S.edit = { tab: t.id, kn: t.kn, doc: t.ref }
    delete S.cache[`doc:${t.kn}:${t.ref}:ed`] // 고칠 때마다 지금 글로
    let draft = null
    try { draft = sessionStorage.getItem(edKey(S.edit)) } catch {}
    if (draft != null) { S.edit.text = draft; toast('저장하지 않은 글을 되살렸다. 그만두면 버린다') }
    S._focus = 'edTx'
    render()
  },
  cancelEdit: async () => { if (S.edit && !S.edit.busy && (await edLeave('취소하'))) { edDrop(); render() } },
  edAddSec: () => {
    const ta = $('#edTx')
    if (!ta || !S.edit) return
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)
    const ins = (ta.value.endsWith('\n') ? '\n' : '\n\n') + '## 새 항목\n'
    const v = document.execCommand && document.execCommand('insertText', false, ins) ? ta.value : (ta.value = ta.value.replace(/\s+$/, '') + '\n\n## 새 항목\n')
    S.edit.text = v
    ta.focus()
    ta.setSelectionRange(v.length - '새 항목\n'.length, v.length - 1)
  },
  retryDoc: (el) => { delete S.cache[el.dataset.k]; render() },
  saveDoc: () => saveDoc(),
  recFix: (el) => { const r = recOf(el.dataset.k, el.dataset.r); if (!r || r.error) return; S.recFix = { k: el.dataset.k, rec: el.dataset.r, title: r.title, from: '', to: '', body: '', busy: false, err: null }; render() },
  svGo: () => svGo(),
  sendEx: (el) => { const r = el.dataset.r, at = el.dataset.v; S.sendEx = S.sendEx || {}; const xs = S.sendEx[r] || []; S.sendEx[r] = xs.includes(at) ? xs.filter((x) => x !== at) : [...xs, at]; render() },
  svClose: () => svClose(),
  svRaw: () => { if (S.sv) { S.sv.raw = !S.sv.raw; render() } },
  recFixClose: () => { if (S.recFix && !S.recFix.busy) { S.recFix = null; render() } },
  recFixSave: () => recFixSave(),
  openItem: (el) => { openTab({ kind: 'item', kn: el.dataset.k, ref: el.dataset.n }); render(); scrollTopMain() },
  itemFilt: (el) => { S.ifilt[el.dataset.v] = !S.ifilt[el.dataset.v]; render() },
  foldKind: (el) => { const kd = el.dataset.v; S.kfold[kd] = !kindFolded(S.route.kn, kd); render() },
  moreTables: () => { S.tablesAll = true; render() },
  itemToDoc: (el) => { const it = itemByKey(el.dataset.k, el.dataset.n); if (it && it.doc) openDocAt(el.dataset.k, it.doc, it.sec, null, 'docs') },
  openGraph: (el) => { S.gPop = false; Object.assign(S.g, { kn: S.route.kn, sel: el.dataset.n, open: [], cur: el.dataset.n }); setView('graph') },
  gSet: (el) => { const v = el.dataset.v; S.g.f[v] = !S.g.f[v]; if (v === 'spin') S.g.spinSet = true; render() },
  // 그래프 칸만 어두운 바탕 — 화면 자리(UI)에 남긴다 · 캔버스 색은 다시 읽는다
  setTheme: (el) => { UI.theme = el.dataset.v || ''; saveUi(); applyTheme(); render() },
  gDark: (el) => { UI.gdark = el.dataset.v === '1'; saveUi(); GTOK = null; render() },
  gMode: (el) => { S.g.mode = el.dataset.v; if (S.g.mode === '2d' && S.g.sel) Object.assign(S.g, { sel: S.g.cur || S.g.sel, open: [] }); S.g.cam.needFit = true; gC2().needFit = true; render() },
  gZoom: (el) => { const cv = $('#gcv'), w = $('#app .gerdw'); if (cv) zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, Number(el.dataset.v)); else if (w) gErdZoom(w.clientWidth / 2, w.clientHeight / 2, Number(el.dataset.v)) },
  gRecs: () => { S.g.recsOf = S.g.recsOf === S.g.sel ? null : S.g.sel; S.g.f.rec = true; render() },
  gRefit: () => { S.g.cam.needFit = true; S.g.outHint = false; const h = $('#app [data-t=gOutHint]'); if (h) h.hidden = true; gPaint() },
  gErdAll: () => { const c = gC2(); c.all = true; c.needFit = true; gErdFit() },
  gFit: () => { Object.assign(S.g.cam, { rx: -0.35, ry: 0.6, needFit: true }); gC2().needFit = true; gPaint(); gErdFit() },
  gBack: (el) => { const v = el.dataset.v, t = S.g.trail || [], i = t.indexOf(v); Object.assign(S.g, { sel: v, cur: v, open: [], trail: i >= 0 ? t.slice(0, i) : t }); render() },
  gUndoOpen: () => { const o = S.g.open || []; if (!o.length) return; S.g.open = o.slice(0, -1); S.g.cur = S.g.open.length ? S.g.open[S.g.open.length - 1] : S.g.sel; render() },
  gFirst: () => { S.g.open = []; S.g.cur = S.g.sel; render() },
  gTap: (el) => gClick(el.dataset.v),
  gUnsel: () => { Object.assign(S.g, { sel: null, open: [], cur: null, trail: [] }); render() },
  gOpen: (el) => {
    const k = S.route.kn, info = nodeInfo(k, S.g.cur)
    if (!info) return
    if (el.dataset.v === 'items' && info.item) { openTab({ kind: 'item', kn: k, ref: info.item }, { view: 'items' }); render(); return }
    if (info.doc && info.doc.rec) { openTab({ kind: 'rec', kn: k, ref: info.doc.rec }, { view: 'docs' }); render(); return }
    if (info.doc) { openTab({ kind: 'doc', kn: k, ref: info.doc.ref, hl: info.doc.hl || null }, { view: 'docs' }); if (info.doc.hl) S._lit = true; render() }
  },
  legacyOpen: () => { S.legacyOpen = true; S.gateErr = null; render() },
  legacyClose: () => { S.legacyOpen = false; S.gateErr = null; render() },
  copyInstall: (el) => copyInstall(el.dataset.v === 'team'),
  agentCopy: (el) => agentCopy(el.dataset.k, el.dataset.area),
  gateHome: () => { S.gate = null; history.replaceState(null, '', '/'); go({ scr: 'home', kn: '*' }) },
  gateLogin: () => { S.gate = null; history.replaceState(null, '', '/'); render() },
  view: (el) => setView(el.dataset.v),
  nav: (el) => (el.dataset.s === 'add' ? openAdd() : go({ scr: el.dataset.s })),
  kmenu: () => { S.menu = S.menu === 'kmenu' ? null : 'kmenu'; render() },
  // 개인 지식을 고르면 팀 지식에만 있는 화면(이 지식의 사람)에서 그 지식의 문서로
  // 지식 메뉴 화면(점검 · 생성 · 공유 · 이력 · 구조)에서 고르면 그 화면 그대로 새 지식으로 · 그 밖(지식관리 · 설정)은 그 지식의 문서로
  //   「모든 지식」(*) 은 지식관리로 가는 지름길 — 고른 지식은 그대로(메뉴 개편 7절)
  pickKn: (el, ev) => { ev.stopPropagation(); S.menu = null; const k = el.dataset.k; if (k === '*') return go({ scr: 'home', kn: '*' }); const s = S.route.scr; if (KM_SCR.includes(s)) return kmGo(s, k); go({ scr: KNSCR.includes(s) ? s : 'docs', kn: k }) },
  // 지식 메뉴 · 레일 · 나무 머리 [구조] — 위에서 고른 지식으로 연다 · 「문서」 는 600 이하 서랍을 닫지 않는다(층 3 나무를 보인다)
  km: (el) => { if (el.getAttribute('aria-disabled') === 'true') return; const id = el.dataset.v, open = S.sideOpen; const x = [...kmItems(), { id: 'structure', scr: 'structure' }].find((y) => y.id === id); if (!x) return; kmGo(x.scr, defaultKn()) },
  mgAll: () => go({ scr: 'home', kn: '*' }),
  // 지식관리(N6) — 본문 왼쪽 메뉴 · 지식 상세(줄 누름 · 탭 · 닫기 · 열기) · 사람 탭 · 불러오기 창 · 새 지식 다음 걸음 · 내 기기 창
  mgGo: (el) => go({ scr: 'home', kn: '*', page: el.dataset.v }),
  kdet: (el, ev) => { if (ev.target.closest('.kebab,.btn,.lk:not(.kn3),.pop')) return; const k = el.dataset.k; if (S.route.mk === k && innerWidth > 1024 && el.tagName === 'TR') return; go({ scr: 'home', kn: '*', page: 'all', mk: k, mt: S.route.mk === k ? S.route.mt : 'info' }) },
  kdTab: (el) => go({ scr: 'home', kn: '*', page: 'all', mk: el.dataset.k, mt: el.dataset.v }),
  kdClose: () => go({ scr: 'home', kn: '*', page: 'all' }),
  knGo: (el) => go({ scr: 'docs', kn: el.dataset.k }),
  kdSend: (el) => kmGo('send', el.dataset.k),
  kdManual: (el) => kmGo('import', el.dataset.k, 'manual'),
  pplTab: (el) => { S.pplTab = el.dataset.v; render() },
  rsOpen: () => { S.menu = null; S.rsWin = true; S.rs = { url: '', name: '', br: null, brOpen: false, practice: false }; S._focus = 'rsUrl'; render() },
  rsClose: () => { if (S.restoring) return; S.rsWin = false; render() },
  addRepo: () => { if (S.addPop) { S.addPop.repo = true; S._focus = 'addUrl'; render() } },
  addSeed: () => { const a = S.addPop; if (!a || !a.done) return; S.addPop = null; S.seedKn = a.done.id; go({ scr: 'home', kn: '*', page: 'seed' }) },
  addManual: () => { const a = S.addPop; if (!a || !a.done) return; S.addPop = null; kmGo('import', a.done.id, 'manual') },
  devOpen: () => { S.menu = null; S.devWin = true; S._focus = 'devCloseBtn'; render() },
  devClose: () => { S.devWin = false; render() },
  railKn: () => { UI.sideRail = false; saveUi(); S.menu = 'kmenu'; render(); const b = $('#app [data-t=kpick]'); if (b) b.focus() },
  openKn: (el, ev) => {
    if (ev.target.closest('.kebab,.btn')) return
    go({ scr: 'docs', kn: el.dataset.k }) },
  histGo: (el) => histGo(Number(el.dataset.v)),
  openQo: () => openQo(),
  openSearch: () => openPal(),
  fold: (el) => { const key = S.route.kn + ':' + el.dataset.f; S.fold[key] = !S.fold[key]; render() },
  // 보기 탭 — 문서 · 기록은 문서 보기의 두 목록(UI.stab) · 항목 · 그래프는 보기 그대로
  ltab: (el) => { const v = el.dataset.v; if (v !== 'docs' && v !== 'recs') return setView(v); const k = defaultKn(), st = v === 'recs' ? 'rec' : 'doc'; if (k && stabOf(k) !== st) { UI.stab[k] = st; saveUi(); S.tq = '' } setView('docs') },
  tFilt: (el) => { S.tfilt[el.dataset.v] = !S.tfilt[el.dataset.v]; render() },
  dirAll: () => { const k = S.route.kn, tr = treeOf(k), ds = dirsOf(tr.docs), all = ds.every((p) => UI.dirs[k + ':' + p]); ds.forEach((p) => { UI.dirs[k + ':' + p] = !all }); saveUi(); render() },
  kindAll: () => { const k = S.route.kn, ks = [...new Set(itemsOf(k).map((i) => i.kind))], all = ks.every((kd) => S.kfold[kd] === false); ks.forEach((kd) => { S.kfold[kd] = all }); render() },
  dirFold: (el) => { const key = S.route.kn + ':' + el.dataset.p; UI.dirs[key] = el.getAttribute('aria-expanded') !== 'true'; saveUi(); render() },
  openDoc: (el) => openDocAt(el.dataset.k, el.dataset.d, el.dataset.h, null, undefined, el.dataset.sub),
  // 위 요약 칸 — 값 바뀜 · 오늘 팀 · 오늘 개인 · 보낸 것으로 거른다
  openRec: (el) => { openTab({ kind: 'rec', kn: el.dataset.k, ref: el.dataset.r }); render(); scrollTopMain() },
  openAtt: (el) => { openTab({ kind: 'att', kn: el.dataset.k, ref: el.dataset.v }); render() },
  actTab: (el, ev) => { if (ev.target.closest('.x')) return; const t = tabOf(el.dataset.id); if (!t) return; S.active = t.id; if (S.split === t.id) S.split = null; S.route.kn = t.kn; if (!['docs', 'items'].includes(S.route.scr)) S.route.scr = 'docs'; pushHist(); render() },
  closeTab: async (el, ev) => { ev.stopPropagation(); if (S.edit && S.edit.tab === el.dataset.id) { if (!(await edLeave('탭을 닫으'))) return; edDrop() } closeTab(el.dataset.id); render() },
  // ⋯ 메뉴 — 열면 첫 항목에 초점(키보드로 바로 고른다 · ↑↓ 로 움직인다) · 닫으면 연 단추로
  menu: (el, ev) => {
    if (ev.target.closest('.menu')) return
    const k = el.dataset.m
    S.menu = S.menu === k ? null : k
    if (S.menu) S._lastMenu = k
    render()
    if (S.menu) { const it = menuItems()[0]; if (it) it.focus({ preventScroll: true }) } else menuBack(k)
  },
  splitToggle: () => toggleSplit(),
  closeSplit: () => { S.split = null; render() },
  closeOthers: async () => { S.menu = null; if (S.edit && S.edit.tab !== S.active) { if (!(await edLeave('다른 탭을 모두 닫으'))) return render(); edDrop() } S.tabs = S.tabs.filter((t) => t.id === S.active); S.split = null; pushHist(); render() },
  scrollSec: (el) => { const h = [...document.querySelectorAll('#app .main[data-t=main] h2[data-sec]')].find((x) => x.dataset.sec === el.dataset.h); if (h) { h.scrollIntoView({ block: 'start', behavior: 'smooth' }); h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash') } },
  qoPick: (el) => qoPick(Number(el.dataset.i)),
  qoClose: () => { S.qo = null; render() },
  cmdPick: (el) => cmdPick(Number(el.dataset.i)),
  cmdClose: () => { S.cmd = null; render() },
  palClose: () => { S.pal = null; render() },
  palClear: () => { S.pal.q = ''; S.pal.res = null; render() },
  palDocs: () => { S.pal = null; setView('docs') },
  openHit: (el) => {
    const q = S.pal && S.pal.q
    S.pal = null
    // 사람이 고른 것 — 다음에 같은 말로 찾으면 약한 후보로 보인다(찾기 후보 배우기)
    if (el.dataset.c && q) postJSON(`/api/k/${encodeURIComponent(el.dataset.k)}/learn`, { q, coord: el.dataset.c }).catch(() => {})
    if (el.dataset.r) { openTab({ kind: 'rec', kn: el.dataset.k, ref: el.dataset.r }); render(); return }
    openDocAt(el.dataset.k, el.dataset.d, el.dataset.h, q)
  },
  palMore: () => { S.pal.more = true; paintPal() },
  tip: (el) => {
    const v = el.dataset.v
    if (S.menu) { S.menu = null; render() } // 열린 팝업 메뉴는 닫는다(한 번에 하나)
    S.tip = S.tip === v ? null : v
    tipPaint(true)
    const l = S.tip && document.querySelector('#tipPop[role=dialog] .lk')
    if (l) l.focus()
  },
  reopenSearch: () => { const t = activeTab(); openPal(t && t.q) },
}
document.addEventListener('click', (ev) => {
  if (ev.target.closest && ev.target.closest('#tipPop') && !ev.target.closest('#tipPop [data-a]')) return // 툴팁 글을 누름 — 둘레 줄 · 카드의 일을 하지 않는다
  const el = ev.target.closest('[data-a]')
  if (!el) {
    // 모든 지식 표의 줄 — 줄 어디를 눌러도 상세(줄은 단추가 아니다 · 키보드는 이름 단추 .kn3)
    const tr = ev.target.closest && ev.target.closest('tr.krow')
    if (tr && !ev.target.closest('.menu,.pop')) { S.menu = null; try { ACT.kdet(tr, ev) } catch (e) { actFail(e) } return }
    if (S.menu && !ev.target.closest('.menu,.pop')) { S.menu = null; render() } return
  }
  if (el.dataset.self && ev.target !== el) return
  if (el.dataset.ro === '1') { ev.preventDefault(); toast('이 지식은 읽기 자리다. 고치려면 지식관리자(또는 총괄 관리자)에게 쓰기 자리를 부탁한다 · <button type="button" class="lk" data-a="copySeatAsk">부탁 글 복사</button>', 9000); return }
  const f = ACT[el.dataset.a]
  if (!f) return
  // 주소가 있는 링크를 Ctrl · Shift · ⌘ 로 누르면 브라우저에 맡긴다(새 탭 · 새 창)
  if (el.tagName === 'A' && el.getAttribute('href') && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) return
  if (el.tagName === 'A') ev.preventDefault()
  if (S.menu && !['menu', 'kmenu', 'pickKn', 'tip'].includes(el.dataset.a) && !ev.target.closest('.menu,.pop')) S.menu = null
  if ((S.sideOpen || S.asideOpen) && el.closest('.side,.aside,.pop') && !(el.dataset.a === 'km' && el.dataset.v === 'docs') && !['menu', 'kmenu', 'fold', 'dirFold', 'dirAll', 'tFilt', 'kindAll', 'foldKind', 'sideToggle', 'asideToggle', 'itemFilt', 'agToggle', 'agFold', 'agRail', 'gSet', 'gMode', 'gDark', 'tip'].includes(el.dataset.a)) { S.sideOpen = false; S.asideOpen = false }
  // 감싸지 않은 곳의 오류도 알린다(단추가 아무 말 없이 먹지 않게) — 돌려받은 Promise 까지
  try { Promise.resolve(f(el, ev)).catch(actFail) } catch (e) { actFail(e) }
})
function actFail(e) { if (e && e.code === 'E_CANCEL') return; console.error(e); toastErr(e) }
// 어디서도 잡지 않은 Promise 오류 — 알림 + 콘솔(조용히 사라지지 않게)
window.addEventListener('unhandledrejection', (ev) => { const e = ev.reason; if (e && e.code === 'E_CANCEL') return; console.error(e); if (S.me) toastErr(e) })
document.addEventListener('input', (ev) => {
  const t = ev.target, k = t.dataset && t.dataset.in
  if (!k) return
  if (k === 'edWhy') { if (S.edit) S.edit.why = t.value; return }
  // 저장 확인 창의 칸 — 고치면 제안을 다시 본다(지문이 바뀐다)
  if (k === 'svChg' || k === 'svWhy') {
    const w = S.sv
    if (!w || !w.fields) return
    if (k === 'svChg') w.fields.changes = t.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20)
    else w.fields.why = t.value.trim().slice(0, 200)
    w.dirty = true
    const b = $('[data-t=svGo]'); if (b && !w.busy) { b.textContent = '다시 보기'; b.disabled = false }
    return
  }
  if (k === 'edTx') edFit(t)
  // 칸은 다시 그리지 않는다(한글 입력이 끊기지 않게) — 결과 자리만 바꾼다
  if (k === 'pal') { S.pal.q = t.value; runFind() }
  if (k === 'askIn' && S.ask && S.ask.input) S.ask.input.value = t.value // 다시 그려도 쓰던 글이 남게
  if (k === 'impQ') { S.impQ = t.value; S.impPage = 0; const b = $('#impDone'); if (b) b.innerHTML = impDoneRows(impMine().js) }
  if (k === 'pasteT' && S.paste) S.paste.title = t.value
  if (k === 'pasteX' && S.paste) S.paste.tx = t.value
  if (k === 'qo') { S.qo.q = t.value; S.qo.sel = 0; $('#qoBody').innerHTML = qoBody(); actDesc(t, 'qoBody') }
  if (k === 'cmd') { S.cmd.q = t.value; S.cmd.sel = 0; $('#cmdBody').innerHTML = cmdBody(); actDesc(t, 'cmdBody') }
  if (k === 'sxQ' && S.sx) { S.sx.q = t.value; const b = $('#sxTree'); if (b) b.innerHTML = sxTreeHtml() }
  if (k === 'sxIn') sxEditCheck()
  if (k === 'sxw' && S.sxw) { const i = t.dataset.i; if (i != null && S.sxw.rows) S.sxw.rows[Number(i)][t.dataset.f] = t.value; else S.sxw[t.dataset.f] = t.value }
  if (k === 'treeQ') { S.tq = t.value; $('#treeBody').innerHTML = treeBody(S.route.kn) }
  if (k === 'itemQ') { S.iq = t.value; $('#itemListBody').innerHTML = itemListBody(S.route.kn) }
  if (k === 'gQ') { S.g.f.q = t.value; gPaint(); const q = norm(t.value || ''); document.querySelectorAll('#app .gerd .ge[data-l]').forEach((e) => e.classList.toggle('hit', !!q && e.dataset.l.includes(q))) }
  if (k === 'del' && S.del) { S.del.typed = t.value; const n = KN(S.del.kn); $('#delBtnBox').innerHTML = delBtn(!!n && t.value.trim() === n.name) }
  if (k === 'ag') { S.agDraft = t.value; $('#agBtnBox').innerHTML = agBtn() }
  if (k === 'admCode') { S.admCode = t.value; $('#admDoneBox').innerHTML = admDoneBtn() }
  if (k === 'sf') sfState()[t.dataset.f] = t.value
  if (k === 'se' && S.se) S.se[t.dataset.f] = t.value
  if (k === 'sendQ') { S.sendQ = t.value; const q = t.value.trim().toLowerCase(); for (const r of document.querySelectorAll('[data-t=sendRec]')) r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none' }
  if (k === 'sendType' && S.sendWin) { S.sendWin.type = t.value; const b = $('[data-t=sendChangeGo]'), pt = S.sendWin.to && sendTeamOf(S.sendWin.to); if (b) b.disabled = !pt || t.value.trim() !== pt.name || S.sending }
  if (k === 'edTx' && S.edit) { S.edit.text = t.value; try { sessionStorage.setItem(edKey(S.edit), t.value) } catch {} return }
  if ((k === 'rfFrom' || k === 'rfTo' || k === 'rfBody') && S.recFix) S.recFix[{ rfFrom: 'from', rfTo: 'to', rfBody: 'body' }[k]] = t.value
  if (k === 'meRoot') S.meRootEdit = t.value
  if (k === 'sdPath') { sdState().path = t.value; const g = $('[data-t=sdGo]'); if (g) g.disabled = !t.value.trim() }
  if (k === 'sdwT' && S.sdw) S.sdw.rows[Number(t.dataset.i)] = t.value
  if (k === 'addUrl' && S.addPop) S.addPop.url = t.value
  if (k === 'br') { const f = brState(t.dataset.k); if (f) f.br = t.value }
  if (k === 'glf') { const f = brState(t.dataset.k); if (f) f[t.dataset.f] = t.value }
  if (k === 'rsF' && S.rs) S.rs[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value
  if (k === 'rfUrl' && S.rf) S.rf.url = t.value
  if (k === 'agKn') S.agKn = t.value
  if (k === 'agKnMe') S.agKnMe = t.value
  if (k === 'admAddId' && S.admAdd) S.admAdd.id = t.value
  if (k === 'grpName' && S.grpAdd) { S.grpAdd.name = t.value; const b = $('[data-t=grpAddDo]'); if (b) b.disabled = !t.value.trim() || !!S.grpAdd.busy }
  if (k === 'addName' && S.addPop) { S.addPop.name = t.value; if (!S.addPop.rname) { const rn = $('#addRn'); if (rn) rn.value = repoSlug(t.value) }if (S.addPop.err) { S.addPop.err = null; const m = $('[data-t=addMsg]'); if (m) m.remove() } }
})
// 기초 세우기 — 지식 고르기 · 파일 고르기 · 문서 이름(손으로)
document.addEventListener('change', (ev) => {
  const t = ev.target, d = S.sd
  if (!t.dataset || !d) return
  if (t.dataset.sdkn != null) { if (d.kn !== t.dataset.sdkn) { d.kn = t.dataset.sdkn; d.v = null; d.err = null; d.back = false; d.path = '' } d.pick0 = true; render(); return }
  const w = sdWork(d)
  if (!w) return
  if (t.dataset.sdpick != null) { const r = (w.rows || [])[Number(t.dataset.sdpick)]; if (r && r.pick !== t.value) sdDo('pick', () => postJSON(sdUrl(d.kn, 'pick'), { picks: { [r.path]: t.value } })); return }
  if (t.dataset.sdren != null && w.plan) {
    const i = Number(t.dataset.sdren), old = w.plan.docs[i] && w.plan.docs[i].id, nu = t.value.trim().replace(/^\/+|\/+$/g, '')
    if (!old || !nu || nu === old) { t.value = old || ''; return }
    const plan = { docs: w.plan.docs.map((x, j) => ({ id: j === i ? nu : x.id, items: x.items.map((it) => ({ h: it.h, src: it.src })) })), names: (w.plan.names || []).map((n) => (n.doc === old ? { ...n, doc: nu } : n)), skip: w.plan.skip || [] }
    sdDo('plan', () => postJSON(sdUrl(d.kn, 'plan'), { mode: 'hand', plan }))
  }
})
// 다시 잡기 — 창의 문서 · 놓을 차례 · 합치기 표시 · 장부 항목 자리 고르기
document.addEventListener('change', (ev) => {
  const t = ev.target
  if (!t.dataset || !S.sx) return
  if (t.dataset.sxw && S.sxw) {
    const w = S.sxw, i = t.dataset.i
    if (i != null && w.rows) w.rows[Number(i)][t.dataset.sxw] = t.value
    else { w[t.dataset.sxw] = t.value; if (t.dataset.sxw === 'to') w.at = '' }
    render(); return
  }
  if (t.dataset.sxpick != null) { const x = S.sx; if (t.checked) x.ipick.add(t.dataset.sxpick); else x.ipick.delete(t.dataset.sxpick); render(); return }
  if (t.dataset.sxname != null) { const nm = S.sx.names[Number(t.dataset.sxname)], o = nm && nm.opts && nm.opts[Number(t.value)]; if (o) { nm.wid = o.wid; nm.h = o.h } render() }
})
// 파일 · 폴더 — 고르기 · 끌어다 놓기
document.addEventListener('toggle', (ev) => { const d = ev.target; if (d.dataset && d.dataset.keep) (S.detOpen ||= {})[d.dataset.keep] = d.open }, true)
document.addEventListener('change', (ev) => { const t = ev.target; if (t.dataset && t.dataset.acc) { accPick(t); return } if (t.dataset && t.dataset.seat) { const o = t.dataset.seat === 'add' ? S.admAdd : S.seatWin; if (o) (o.seats ||= {})[t.dataset.k] = t.value; return } if (t.dataset && t.dataset.grp != null) { (S.grpPick ||= {})[t.dataset.grp] = t.value; render(); return } if (t.dataset && t.dataset.grpadd != null && S.grpAdd) { const m = new Set(S.grpAdd.members); if (t.checked) m.add(t.dataset.grpadd); else m.delete(t.dataset.grpadd); S.grpAdd.members = [...m]; return } if (t.dataset && t.dataset.model != null) { ACT.pickModel(t); return } if (t.id === 'ckScope') { S.ckAll = t.value === '*'; S.hdPick = null; render(); return } if (t.id === 'mtDays') { S.mtDays = Number(t.value) || 14; S.mtOpen = ''; render(); return } if (t.id === 'mtKn' && t.value && KN(t.value)) { S.mtOpen = ''; kmGo('held', t.value, 'metrics'); return } if (t.id === 'hdPickSel') { const o = $('[data-t=heldPickOther]'); if (o) o.checked = true; return } if (t.dataset && t.dataset.se && S.se) { S.se[t.dataset.se] = t.value; render(); return } if (t.dataset && t.dataset.sf) { sfState()[t.dataset.sf] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.sf === 'rule') render(); return } if (t.id === 'logKn') { S.logKn = t.value; render(); return } if (t.id === 'logKind') { S.logKind = t.value; render(); return } if (t.id === 'logWho') { S.logWho = t.value; render(); return } if (t.id === 'impOrg' || t.id === 'impRes') { S[t.id] = t.value; S.impPage = 0; render(); return } if (t.dataset && t.dataset.cap) { postJSON('/api/queue/caps', { [t.dataset.cap]: Number(t.value) }).then(() => { opsQueueSet((o) => { (o.caps ||= {})[t.dataset.cap] = Number(t.value) }); return toast(`동시에 도는 수: ${t.dataset.cap === 'claude' ? 'Claude' : '가져오기'} ${t.value}`) }, (e) => toastErr(e)).finally(() => { t.blur(); pollRuns() }); return } if (t.id === 'sdFileIn' || t.id === 'sdDirIn') { sdUpload(t.files); t.value = ''; return } if (t.id === 'fileIn' || t.id === 'dirIn') { takeFiles(t.files); t.value = '' } })
document.addEventListener('dragstart', (ev) => { const c = ev.target.closest && ev.target.closest('[data-drag]'); if (!c) return; S.dragK = c.dataset.drag; c.classList.add('drag'); ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', c.dataset.drag) } catch {} })
document.addEventListener('dragend', () => { S.dragK = null; for (const x of document.querySelectorAll('[data-drag].drag,[data-drag].over')) x.classList.remove('drag', 'over') })
document.addEventListener('dragover', (ev) => { const c = S.dragK && ev.target.closest && ev.target.closest('[data-drag]'); if (c) { ev.preventDefault(); for (const x of document.querySelectorAll('[data-drag].over')) if (x !== c) x.classList.remove('over'); if (c.dataset.drag !== S.dragK) c.classList.add('over') } })
document.addEventListener('drop', (ev) => { const c = S.dragK && ev.target.closest && ev.target.closest('[data-drag]'); if (!c) return; ev.preventDefault(); const r = c.getBoundingClientRect(); knPlace(S.dragK, c.dataset.drag, c.tagName === 'TR' ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2); S.dragK = null })
// 팝업은 스크롤해도 단추를 따라간다
document.addEventListener('scroll', () => { if (S.menu) placePop() }, true)
window.addEventListener('resize', () => { if (S.menu) placePop() })
// 일 줄의 순서 — 기다리는 줄을 끌어 다른 기다리는 줄 위에 놓으면 그 앞으로
document.addEventListener('dragstart', (ev) => { const r = ev.target.closest && ev.target.closest('[data-qdrag]'); if (!r) return; S.dragQ = r.dataset.qdrag; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', S.dragQ) })
document.addEventListener('dragend', () => { S.dragQ = null; for (const x of document.querySelectorAll('.qrow.over')) x.classList.remove('over') })
document.addEventListener('dragover', (ev) => { const r = S.dragQ && ev.target.closest && ev.target.closest('[data-qdrag]'); if (!r) return; ev.preventDefault(); for (const x of document.querySelectorAll('.qrow.over')) if (x !== r) x.classList.remove('over'); if (r.dataset.qdrag !== S.dragQ) r.classList.add('over') })
document.addEventListener('drop', (ev) => { const r = S.dragQ && ev.target.closest && ev.target.closest('[data-qdrag]'); if (!r) return; ev.preventDefault(); const id = S.dragQ; S.dragQ = null; if (r.dataset.qdrag !== id) qMove(id, r.dataset.qdrag) })
// 끌어다 놓기 — 넣는 칸이거나, 가져오기 화면이면 가운데 어디든(파일을 끌 때만)
const dropAt = (ev) => (ev.target.closest && (ev.target.closest('#drop') || ev.target.closest('#sdDrop'))) || (S.route.scr === 'import' && !S.dragK && !S.dragQ && ev.dataTransfer && [...ev.dataTransfer.types].includes('Files') && ev.target.closest && ev.target.closest('.main') ? $('#drop') : null)
document.addEventListener('dragover', (ev) => { const d = dropAt(ev); if (d) { ev.preventDefault(); d.classList.add('over') } })
document.addEventListener('dragleave', (ev) => { const d = dropAt(ev), to = ev.relatedTarget; if (d && !(to && to.closest && (to.closest('#drop') || to.closest('#sdDrop') || (S.route.scr === 'import' && to.closest('.main'))))) d.classList.remove('over') })
document.addEventListener('drop', async (ev) => {
  const d = dropAt(ev)
  if (!d) return
  ev.preventDefault()
  d.classList.remove('over')
  const take = d.id === 'sdDrop' ? sdUpload : takeFiles
  const items = [...(ev.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean)
  if (!items.length) { take(ev.dataTransfer.files); return }
  const out = []
  await Promise.all(items.map((e) => readEntries(e, '', out)))
  take(out)
})
// 고른 줄을 화면 읽기에 알린다(Q50) — 입력칸의 aria-activedescendant 를 고른 줄(role=option)로
function actDesc(inp, bodyId) {
  const s = $('#' + bodyId + ' .qr.sel')
  if (!inp) return
  if (s) inp.setAttribute('aria-activedescendant', s.id); else inp.removeAttribute('aria-activedescendant')
  inp.setAttribute('aria-expanded', $('#' + bodyId + ' [role=option]') ? 'true' : 'false')
}
function listKeys(ev, st, bodyId, bodyFn, pick) {
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault()
    const n = (st.list || []).length
    if (n) { st.sel = (st.sel + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n; $('#' + bodyId).innerHTML = bodyFn(); const s = $('#' + bodyId + ' .qr.sel'); if (s) s.scrollIntoView({ block: 'nearest' }); actDesc(ev.target, bodyId) }
    return true
  }
  if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); pick(st.sel); return true }
  return false
}
// 모달 안에서 Tab 이 돈다(창 밖으로 나가지 않는다) · role=button/tab 요소는 Enter · Space 가 누름
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Tab') {
    // 가둠 상자 — 맨 위 창 · 없으면 열린 서랍(옆 메뉴 · 옆 칸 · 덮개 뒤 본문으로 빠지지 않게)
    const top = modals().pop() || drawerBox()
    if (!top) return
    const fs = focusables(top)
    if (!fs.length) { ev.preventDefault(); return }
    const i = fs.indexOf(document.activeElement)
    if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); fs[fs.length - 1].focus() } else if (!ev.shiftKey && (i === fs.length - 1 || i < 0)) { ev.preventDefault(); fs[0].focus() }
    return
  }
  const t = ev.target
  if ((ev.key === 'Enter' || ev.key === ' ') && !ev.isComposing && t && t.matches && t.matches('[role=button][data-a]:not(button,a[href]),[role=tab][data-a],[role=link][data-a]')) { ev.preventDefault(); if (t.click) t.click(); else t.dispatchEvent(new MouseEvent('click', { bubbles: true })) }
}, true)
document.addEventListener('keydown', (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey, low = String(ev.key).toLowerCase(), code = ev.code
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'askIn') { ev.preventDefault(); askDone(0); return }
  if (ev.key === 'Escape' && S.tip) { ev.preventDefault(); ev.stopImmediatePropagation(); tipShut(true); return }
  if (ev.key === 'Escape' && S.ask && !S.sudo) { askDone(null); return }
  if (!S.me || anon()) return
  if (ev.key === 'Escape' && S.gPop) { ACT.gPop(); return }
  // 너비 잡이 — ← → 10px(Shift 40px) · Home 처음 너비
  const gr = ev.target && ev.target.dataset && ev.target.dataset.grip
  if (gr && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Home')) {
    ev.preventDefault()
    const step = (ev.shiftKey ? 40 : 10) * (ev.key === 'ArrowRight' ? 1 : -1) * (gr === 'side' ? 1 : -1)
    setW(gr, ev.key === 'Home' ? (gr === 'side' ? SW[2] : AW[2]) : (gr === 'side' ? UI.sw : UI.aw) + step)
    saveUi()
    return
  }
  if (S.edit && ev.target.id === 'edTx' && ctrl && (low === 's' || code === 'KeyS')) { ev.preventDefault(); saveDoc(); return }
  if (S.edit && ev.target.id === 'edTx' && ev.key === 'Escape' && !S.sudo) { ev.preventDefault(); ACT.cancelEdit(); return }
  if (S.qo && ev.target.id === 'qoIn' && listKeys(ev, S.qo, 'qoBody', qoBody, qoPick)) return
  if (S.cmd && ev.target.id === 'cmdIn' && listKeys(ev, S.cmd, 'cmdBody', cmdBody, cmdPick)) return
  if (S.me && !anon() && !gated() && ((ev.key === '?' && !/^(TEXTAREA|INPUT|SELECT)$/.test(ev.target.tagName) && !ev.target.isContentEditable) || (ctrl && (ev.key === '/' || code === 'Slash')))) { ev.preventDefault(); S.keys = true; render(); return }
  if (ev.key === 'Escape' && S.keys) { S.keys = false; render(); return }
  if (ctrl && !ev.altKey) {
    if (low === 'k' || code === 'KeyK') { ev.preventDefault(); openPal(); return }
    if (low === 'o' || low === 't' || code === 'KeyO' || code === 'KeyT') { ev.preventDefault(); openQo(); return }
    if (low === 'p' || code === 'KeyP') { ev.preventDefault(); openCmd(); return }
    if (ev.key === '\\' || code === 'Backslash') { ev.preventDefault(); toggleSplit(); return }
    if (ev.key === '[' || code === 'BracketLeft') { ev.preventDefault(); ACT.sideRail(); return }
    if ((ev.key === ']' || code === 'BracketRight') && S._hasAside) { ev.preventDefault(); ACT.asideRail(); return }
  }
  if (ev.altKey && !ctrl && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !/^(TEXTAREA|INPUT)$/.test(ev.target.tagName)) { ev.preventDefault(); histGo(ev.key === 'ArrowLeft' ? -1 : 1); return }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'sudoPw') { ev.preventDefault(); sudoOk(); return }
  // Esc — 팝업 메뉴 → 맨 위 창(바깥 누름과 같은 닫기 · 도는 중이면 data-busy 로 막힌다) → 서랍
  if (ev.key === 'Escape') {
    if (S.menu) { const k = S.menu; S.menu = null; render(); menuBack(k); return }
    const top = modals().pop()
    if (top) {
      const sc = top.parentElement
      if (sc.dataset.busy) return
      const x = sc.dataset.self ? sc : top.querySelector('[data-close]') || top.querySelector('.mh .x[data-a],.tb .x[data-a]')
      if (x) { ev.preventDefault(); x.click() }
      return
    }
    if (S.sideOpen || S.asideOpen) drawerShut()
    return
  }
  // 탭 — ← → Home End 로 옮기며 고른다(APG 자동 고르기)
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key) && ev.target.getAttribute && ev.target.getAttribute('role') === 'tab' && !ev.altKey && !ev.ctrlKey) {
    const tl = ev.target.closest('[role=tablist]'), ts = tl ? [...tl.querySelectorAll('[role=tab]')].filter((t) => t.closest('[role=tablist]') === tl && !t.disabled) : []
    const i = ts.indexOf(ev.target)
    if (i >= 0 && ts.length > 1) {
      ev.preventDefault()
      const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? ts.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : ts.length - 1)) % ts.length
      const sel = tl.dataset.t, pos = n
      ts[n].click()
      requestAnimationFrame(() => { const tl2 = sel ? $(`#app [data-t="${sel}"]`) : null; const t2 = tl2 ? [...tl2.querySelectorAll('[role=tab]')][pos] : null; if (t2) t2.focus() })
    }
    return
  }
  if (S.menu && (ev.key === 'Home' || ev.key === 'End') && ev.target.closest && ev.target.closest('.pop,.menu,.kmenu')) { const its = menuItems(); if (its.length) { ev.preventDefault(); its[ev.key === 'Home' ? 0 : its.length - 1].focus({ preventScroll: true }) } return }
  if (S.menu && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && ev.target.closest && ev.target.closest('.pop,.menu,.kmenu,[data-m],[data-t=kpick]')) {
    const its = menuItems()
    if (its.length) { ev.preventDefault(); const i = its.indexOf(document.activeElement); const n = i < 0 ? (ev.key === 'ArrowDown' ? 0 : its.length - 1) : (i + (ev.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length; its[n].focus({ preventScroll: true }) }
    return
  }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'palIn') { const h = $('#app .hit'); if (h) h.click() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'addIn') { ev.preventDefault(); doAdd() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'grpName') { ev.preventDefault(); ACT.grpAddDo() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'meRootIn') { ev.preventDefault(); meRootSave() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.dataset && ev.target.dataset.in === 'sf') { ev.preventDefault(); const b = $('[data-t=sfAdd]') || $('[data-t=sfAsk]'); if (b) b.click() }
})

// 아래 줄 시계 — 분마다
setInterval(() => { const c = $('[data-t=clock]'); if (c && S.me && !document.hidden) c.textContent = `kmd v${S.me.version} · ${clock()}` }, 30000)
// 자료 가져오기를 보는 동안 — 감시가 뒤에서 바꾼 줄을 20초마다 조용히 다시(칸에 쓰는 중 · 메뉴 · 창이 열려 있으면 그다음에)
setInterval(async () => {
  if (document.hidden || !S.me || gated() || S.route.scr !== 'import' || S.menu || S.ask || S.del || S.pal || S.qo || S.cmd || S.se || S.sfOpen) return
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return
  const before = JSON.stringify(S.cache.sources || null)
  const v = await fetchSrcs()
  if (v && JSON.stringify(S.cache.sources) !== before) render()
}, 20000)

// 들어온 사람의 자료 — 목록 · 멈춤 줄
let stopTimer = null
let claudeTimer = null
async function loadAll() {
  S.me = await getJSON('/api/me')
  if (S.me.anon) { render(); return }
  await reloadKns()
  S.cache = {}
  loadStops()
  clearInterval(stopTimer)
  stopTimer = setInterval(() => { if (!document.hidden) loadStops() }, 60000)
  loadClaude({ verify: true })
  loadBusy()
  clearInterval(claudeTimer)
  claudeTimer = setInterval(() => loadClaude({ verify: true }), 30 * 60_000)
  document.title = isTeam() ? 'kmd: 팀' : 'kmd'
  const fromHash = parseHash(location.hash)
  if (fromHash && !S.hist.length) openHash(fromHash)
  if (!S.hist.length) pushHist(true)
  render() // openTab 은 그리지 않는다 — 여기서 그린다
}

// ───────────── 시작 ─────────────
// 이 PC 화면의 한 번용 번호(#once=) — 받으면 들어온다 · 지났거나 쓴 번호면 그 까닭을 들어가기 화면에 보인다
async function takeOnce() {
  const once = (location.hash.match(/(?:^#|&)once=([^&]+)/) || [])[1]
  if (!once) return false
  S.onceErr = null
  await postJSON('/once', { code: once }).catch((e) => { S.onceErr = e.message })
  history.replaceState(null, '', '/')
  return true
}
// 같은 탭에 새 번호를 붙여도(시작 메뉴 kmd 가 이미 열린 탭을 다시 쓸 때) 들어온다
window.addEventListener('hashchange', async () => {
  if (!/(?:^#|&)once=/.test(location.hash)) return
  try {
    await takeOnce()
    await loadAll()
  } catch (e) { bootFail(e) }
})
// 처음 들어올 때 닿지 않았다 — 같은 말을 두 번 붙이지 않고(E_REACH 는 그 말 그대로) · 다시 읽기 단추 · 15초 뒤 한 번 저절로 다시
let bootRetry = 0
function bootFail(e) {
  S.err = e && e.code === 'E_REACH' ? e.message : 'kmd 에 닿지 않는다: ' + ((e && e.message) || e)
  render()
  clearTimeout(bootRetry)
  if (!S._bootAuto) { S._bootAuto = true; bootRetry = setTimeout(() => { if (S.err && !S.me) retryBoot() }, 15000) }
}
function retryBoot() { clearTimeout(bootRetry); S.err = null; boot() }
async function boot() {
  render() // 처음 읽는 동안 흰 화면 대신 「읽는 중」
  try {
    const code = (location.hash.match(/(?:^#|&)code=([^&]+)/) || [])[1]
    await takeOnce()
    if (location.pathname === '/first') {
      S.gate = 'first'
      S.gateCode = code ? decodeURIComponent(code) : ''
      { const fc = S.gateCode ? await postJSON('/first', { check: true, code: S.gateCode }).catch(() => ({})) : {}; S.gateUser = fc.user || null; S.gateReset = !!fc.reset }
    } else if (location.pathname === '/setup') {
      S.gate = 'setup'
      S.gateCode = code ? decodeURIComponent(code) : ''
    }
    await loadAll()
  } catch (e) { bootFail(e) }
}
try { applyTheme() } catch (e) { console.warn('화면 밝기를 맞추지 못했다', e) }
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { GTOK = null; if (S.me) render() })
boot()
// 문서 짜임 — 줄 안 이름 칸(Enter 넣기 · Esc 취소 · 벗어나면 맞으면 넣기) · 줄(F2 이름 · Alt ↑↓ 차례 · Enter 고르기)
document.addEventListener('keydown', (ev) => {
  const t = ev.target
  if (!S.sx || !t || !t.closest || !t.closest('#sxTree')) return
  if (t.id === 'sxIn') {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); sxEditCommit() }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); S.sx.edit = null; render() }
    return
  }
  const r = t.closest('.sx-row[data-sk]')
  if (!r || t !== r) return
  if (ev.key === 'F2' && r.querySelector('[data-a=sxRen]')) { ev.preventDefault(); ACT.sxRen(r) }
  else if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { ev.preventDefault(); sxReorder(r, ev.key === 'ArrowUp') }
  else if (ev.key === ' ' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.stopPropagation(); ACT.sxClick(r, { detail: 1, ctrlKey: true }) }
  else if ((ev.key === 'm' || ev.key === 'M') && !ev.ctrlKey && !ev.altKey && !ev.metaKey && r.querySelector('[data-a=sxMv]')) { ev.preventDefault(); ACT.sxMv(r.querySelector('[data-a=sxMv]')) }
  else if ((ev.key === 'Enter' || ev.key === ' ') && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); ACT.sxClick(r, { detail: 1 }) }
}, true)
document.addEventListener('focusout', (ev) => {
  if (ev.target.id !== 'sxIn' || !S.sx || !S.sx.edit) return
  setTimeout(() => { if (!S.sx || !S.sx.edit || document.activeElement?.id === 'sxIn') return; if (sxEditCheck() == null) { S.sx.edit = null; render() } else sxEditCommit() }, 0)
})
// 끌어 옮기기 — 폴더 줄 가운데는 그 안으로 · 줄 위 · 아래는 사이에 · 맨 위 줄은 맨 위 끝으로(키보드는 이름 칸 · Alt ↑↓ · 끌기 대신 잘라 붙이기 없음)
let sxDrag = null
const sxClearDrop = () => document.querySelectorAll('#sxTree .into,#sxTree .before,#sxTree .after').forEach((z) => z.classList.remove('into', 'before', 'after'))
function sxDropAt(ev, t) {
  if (t.dataset.sxroot) return { P: '', pos: 'into' }
  const r = t.getBoundingClientRect(), y = (ev.clientY - r.top) / r.height, key = t.dataset.sk
  const dir = key.startsWith('f:') ? key.slice(2) : null
  const par = dir ? sxSplit(dir)[0] : sxW(key.slice(2)).folder
  const pos = dir ? (y < 0.28 ? 'before' : y > 0.72 && !S.sx.open[dir] ? 'after' : 'into') : y < 0.5 ? 'before' : 'after'
  const P = pos === 'into' ? dir : par
  if (key === sxDrag) return null
  if (sxDrag.startsWith('f:')) { const me = sxDrag.slice(2); if (P === me || P.startsWith(me + '/')) return null }
  return { P, ref: key, pos }
}
document.addEventListener('dragstart', (ev) => {
  const r = ev.target.closest && ev.target.closest('#sxTree .sx-row[data-sk]')
  if (!r || r.getAttribute('draggable') !== 'true' || !S.sx) return
  if (S.sxf && S.sxf.k === S.sx.k && S.sxf.step >= 3) { ev.preventDefault(); sxHold(); return }
  sxDrag = r.dataset.sk
  ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', sxDrag)
  r.classList.add('drag'); $('#sxTree').classList.add('dragging')
})
document.addEventListener('dragover', (ev) => {
  if (!sxDrag) return
  const t = ev.target.closest && ev.target.closest('#sxTree .sx-row[data-sk], #sxTree [data-sxroot]')
  sxClearDrop()
  if (!t) return
  const at = sxDropAt(ev, t); if (!at) return
  ev.preventDefault(); t.classList.add(at.pos)
  if (at.pos === 'into' && at.P && !S.sx.open[at.P]) { clearTimeout(t._sxo); t._sxo = setTimeout(() => { if (sxDrag && t.classList.contains('into')) { S.sx.open[at.P] = true; const b = $('#sxTree'); if (b) { b.innerHTML = sxTreeHtml(); b.classList.add('dragging') } } }, 700) }
})
document.addEventListener('drop', (ev) => {
  if (!sxDrag) return
  const t = ev.target.closest && ev.target.closest('#sxTree .sx-row[data-sk], #sxTree [data-sxroot]')
  sxClearDrop()
  if (!t) return
  const at = sxDropAt(ev, t); if (!at) return
  ev.preventDefault()
  const key = sxDrag, isDir = key.startsWith('f:')
  const ok = isDir ? sxMoveDir(key.slice(2), at.P) : sxMoveDoc(key.slice(2), at.P)
  if (ok && at.pos !== 'into') sxPlace(isDir ? 'f:' + (at.P ? at.P + '/' : '') + sxSplit(key.slice(2))[1] : key, at.P, at.ref, at.pos === 'after')
  sxDrag = null; render()
})
document.addEventListener('dragend', () => { if (!sxDrag && !$('#sxTree .drag')) return; sxDrag = null; sxClearDrop(); document.querySelectorAll('#sxTree .drag').forEach((z) => z.classList.remove('drag')); const b = $('#sxTree'); if (b) b.classList.remove('dragging') })
// 일부만 다시 그린 곳(찾기 결과 · 일 줄 · 나무 찾기 · 창 안 상자)도 역할 · 이름 · 키보드가 닿게 — 줄이 바뀐 뒤 한 번(UX T1-08)
{ let a11yT = null; const host = document.getElementById('app'); if (host) new MutationObserver(() => { clearTimeout(a11yT); a11yT = setTimeout(() => { try { a11yPass() } catch (e) { console.error(e) } }, 60) }).observe(host, { childList: true, subtree: true }) }
// 그래프 두 손가락 — 집어 확대 · 축소(터치 · UX T1-31 정함) · 한 손가락 끌기는 지금처럼 돌리기
const GP = new Map()
document.addEventListener('pointerdown', (ev) => { if (ev.target.closest && ev.target.closest('#gcv')) GP.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }) }, true)
document.addEventListener('pointermove', (ev) => {
  if (!GP.has(ev.pointerId) || GP.size !== 2) { if (GP.has(ev.pointerId)) GP.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); return }
  const [a0, b0] = [...GP.values()], d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y)
  GP.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
  const [a, b] = [...GP.values()], d1 = Math.hypot(a.x - b.x, a.y - b.y), cv = $('#gcv')
  if (!cv || !d0 || !d1) return
  const r = cv.getBoundingClientRect()
  GD = null // 두 손가락이면 돌리기를 멈춘다
  zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d1 / d0)
}, true)
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, (ev) => GP.delete(ev.pointerId), true)
// 편집기 붙여넣기 — 엑셀 · 표 글(탭으로 나뉜 줄)은 md 표로 · 그림은 넣을 수 없다고 알린다(UX G4-04)
document.addEventListener('paste', (ev) => {
  const ta = ev.target; if (!ta || ta.id !== 'edTx' || !ev.clipboardData) return
  if ([...ev.clipboardData.items || []].some((x) => x.kind === 'file' && /^image\//.test(x.type))) { ev.preventDefault(); toast('그림은 여기 붙여 넣을 수 없다: 생성 화면에 파일로 넣어 첨부하고 링크를 단다', 7000); return }
  const t = ev.clipboardData.getData('text/plain') || ''
  const rows = t.replace(/\r/g, '').split('\n').filter((l) => l.length)
  if (rows.length < 2 || !rows.every((l) => l.includes('\t'))) return
  ev.preventDefault()
  const cells = rows.map((l) => l.split('\t').map((c) => c.trim().replace(/\|/g, '\|')))
  const n = Math.max(...cells.map((r) => r.length))
  const line = (r) => '| ' + Array.from({ length: n }, (_, i) => r[i] || '').join(' | ') + ' |'
  const md = [line(cells[0]), '|' + ' --- |'.repeat(n), ...cells.slice(1).map(line)].join('\n') + '\n'
  if (!(document.execCommand && document.execCommand('insertText', false, md))) { const a = ta.selectionStart; ta.setRangeText(md, a, ta.selectionEnd, 'end') }
  if (S.edit) S.edit.text = ta.value
  toast('표로 바꿔 붙였다')
})
