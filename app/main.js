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
  fold: {}, all: false,
  menu: null, pal: null, qo: null, cmd: null,
  cache: {}, wait: {}, err: null,
  stops: [],
  srcRun: {}, sf: null, sfMsg: null, imports: [], addDraft: '', addMsg: null, cand: null, sending: false,
  openToday: null, tidyRun: null, tidyMsg: {}, runOpen: {}, cmp: null, picker: false,
  iq: '', ifilt: { pend: false, recent: false, mine: false }, kfold: {}, tablesAll: false, nbOpen: false,
  g: { kn: null, pos: {}, view: { x: 0, y: 0, k: 1 }, sel: null, bundle: false, layoutKey: '', f: { q: '', item: true, doc: true, rec: false, src: false, pend: false, recent: false, orph: false, depth: 0 } },
}
const KNSCR = ['docs', 'items', 'graph', 'tidy', 'members']
const KN = (k) => S.kns.find((x) => x.id === k) || null
const isTeam = () => S.me && S.me.mode === 'team'
// 들어오기 전 — 아직 들어오지 않았다(머리 · 옆 메뉴 · 아래 줄은 이것을 본다)
const anon = () => !!S.me && !!S.me.anon
// 들어가기 화면 — 들어오지 않았거나 · 처음 들어오기 링크 · 첫 설정을 보는 중(들어온 채 링크를 열어도 이 화면)
const gated = () => !!S.me && (!!S.me.anon || !!S.gate)
const knType = () => (isTeam() ? 'team' : 'pc')
// 지식 하나의 갈래 — 내 PC 지식 · 팀 서버의 개인 지식 · 이 PC 프로그램의 지식은 개인, 그 밖은 팀 지식
const isPersonal = (n) => !n || !!n.pc || !!n.private || !isTeam()
const knWhere = (n) => (!n ? '' : n.pc ? '내 PC' + (n.dir ? ' · ' + n.dir : '') : !isTeam() ? n.dir || '' : n.private ? '팀 서버 · 개인' : '팀 서버')
const knTag = (n) => (n && n.pc ? '<span class="kt me">내 PC</span>' : isPersonal(n) ? '<span class="kt me">개인</span>' : '<span class="kt team">팀</span>')

// ───────────── 자료 ─────────────
// 내 PC 지식(id 가 ~ 로 시작)은 내 PC 프로그램으로만 간다 — 팀 서버로 가려 하면 멈춘다(fail-closed · v0.5 §5.3 ⑤)
function reqTo(p) {
  const m = String(p).match(/^\/api\/k\/(?:~|%7e)([^/?]+)(.*)$/i)
  if (m) {
    if (!S.pc || !S.pc.token) throw Object.assign(new Error('내 PC 프로그램이 꺼져 있다 — 켜면 저절로 다시 열린다'), { code: 'E_PC' })
    return { url: S.pc.url + '/api/k/' + m[1] + m[2], headers: { authorization: 'Bearer ' + S.pc.token } }
  }
  if (/^\/api\/k\/|[?&]k=/.test(p) && /~|%7e/i.test(p)) throw new Error('내 PC 지식의 조각을 팀 서버로 보내지 않는다')
  if (S.pc && S.pc.kns.some((k) => k.dir && (String(p).includes(k.dir) || String(p).includes(encodeURIComponent(k.dir))))) throw new Error('내 PC 지식의 조각을 팀 서버로 보내지 않는다')
  return { url: p, headers: {} }
}
async function getJSON(p) {
  const t = reqTo(p)
  const r = await fetch(t.url, { headers: { accept: 'application/json', ...t.headers } }).catch(() => { throw Object.assign(new Error(t.headers.authorization ? '내 PC 프로그램에 닿지 않는다' : '서버에 닿지 않는다'), { code: 'E_REACH' }) })
  if (r.status === 401 && !t.headers.authorization && canRelogin()) { await askLogin(); return getJSON(p) }
  if (t.headers.authorization && r.status === 401) { S.pc.token = null; try { sessionStorage.removeItem('kmdPair') } catch {} }
  if (t.headers.authorization && !r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.message || '내 PC 프로그램에 닿지 않는다'), { code: j.error }) }
  // 내 PC 지식의 글 속 그림 — 그 지식 id 에 ~ 를 붙여 화면이 짝 열쇠로 PC 에서 받게(팀 서버로 가지 않게)
  const j = t.headers.authorization ? await r.text().then((x) => JSON.parse(x.replace(/data-ak=\\"(?!~)/g, 'data-ak=\\"~')), () => ({})) : await r.json().catch(() => ({}))
  if (r.status === 401 && S.me && !S.me.anon) { S.me = { ...S.me, anon: true }; setTimeout(render) }
  if (!r.ok) throw Object.assign(new Error(j.message || '서버에 닿지 않는다'), { code: j.error })
  return j
}
// 글 속 그림 · 첨부 그림 — 이 지식의 첨부만(data-att · data-ak). 내 PC 지식은 짝 열쇠로 PC 에서 받아 blob 으로 보인다
const attBlobs = {}
function fillAtts() {
  for (const img of app.querySelectorAll('img[data-att]:not([src])')) {
    const kn = img.dataset.ak, p = `/api/k/${encodeURIComponent(kn).replace('%7E', '~')}/att?a=${encodeURIComponent(img.dataset.att)}`
    if (!String(kn).startsWith('~')) { img.src = p; continue }
    if (typeof attBlobs[p] === 'string') { img.src = attBlobs[p]; continue }
    if (attBlobs[p]) continue
    let t
    try { t = reqTo(p) } catch { continue }
    attBlobs[p] = fetch(t.url, { headers: t.headers }).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { attBlobs[p] = URL.createObjectURL(b); render() } else delete attBlobs[p] }, () => { delete attBlobs[p] })
  }
}
// 지식 목록 — 팀(이 서버)의 것에 짝 지은 내 PC 지식을 붙인다 · 실패하면 지금 목록 그대로
async function reloadKns() {
  const ks = await getJSON('/api/knowledge').catch(() => null)
  if (ks) S.kns = [...ks, ...(S.pc && S.pc.kns ? S.pc.kns : [])]
}
// 있으면 바로 · 없으면 받기 시작하고 null(받으면 다시 그린다) · 실패는 15초만 기억한다(서버가 돌아오면 다시 받는다)
function need(key, path) {
  if (key in S.cache && S.cache[key] && S.cache[key].error && Date.now() - (S.cache[key].at || 0) > 15000) delete S.cache[key]
  if (key in S.cache) return S.cache[key]
  if (!S.wait[key]) {
    S.wait[key] = getJSON(path)
      .then((v) => { S.cache[key] = v }, (e) => { S.cache[key] = { error: e.message, code: e.code || null, at: Date.now() } })
      .finally(() => { delete S.wait[key]; render() })
  }
  return null
}
const treeOf = (k) => need('tree:' + k, `/api/k/${encodeURIComponent(k)}/tree`)
const docOf = (k, d) => need(`doc:${k}:${d}`, `/api/k/${encodeURIComponent(k)}/doc?d=${encodeURIComponent(d)}`)
const recOf = (k, r) => need(`rec:${k}:${r}`, `/api/k/${encodeURIComponent(k)}/rec?r=${encodeURIComponent(r)}`)
const loadingHtml = '<p class="muted small">읽는 중…</p>'
// 아직 안 넣은 기록이 언제 문서에 — 지식마다: 팀 지식은 정리 때 · 개인 지식(이 PC · 내 PC · 팀 서버의 개인)은 kmd 가 곧바로
const pendWhen = (k) => (KN(k) && KN(k).pendText) || (isTeam() && KN(k) && !isPersonal(KN(k)) ? '정리 때 문서에 들어간다' : 'kmd 가 곧바로 문서에 넣는다')
const errHtml = (v) => `<div class="callout gray stop"><i></i><span><b>${esc(v.error)}</b></span></div>`

// ───────────── 토스트 ─────────────
let toastTimer = null
function toast(html, ms) {
  const h = $('#toastHost')
  h.innerHTML = `<div class="toast" data-t="toast">${html}</div>`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { h.innerHTML = '' }, ms || 4500)
}

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
  S.route = Object.assign({ scr: 'home', kn: S.route.kn }, r)
  S.menu = null
  if (S.route.scr === 'import') { delete S.cache.sources; setTimeout(pollRuns, 0) }
  if (S.route.scr === 'today' || S.route.scr === 'log') delete S.cache.history // 감시가 뒤에서 바꾼 것 — 열 때마다 새로
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
function openTab(t, o) {
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
  if (t.kind === 'rec') { const tr = S.cache['tree:' + t.kn]; const r = tr && tr.records && tr.records.find((x) => x.id === t.ref); return r ? r.title.split(' — ')[0] : '기록' }
  if (t.kind === 'item') { const it = itemByKey(t.kn, t.ref); return it ? it.name : t.ref.replace(/^#[^#]*#/, '').replace(/^[^:]+:/, '') }
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
  if (!a || !others.length) { toast('탭이 둘 있어야 나란히 본다 — Ctrl O 로 하나 더 연다'); render(); return }
  const i = S.tabs.indexOf(a)
  const o = S.tabs[i - 1] && S.tabs[i - 1].id !== S.active ? S.tabs[i - 1] : others[others.length - 1]
  S.split = o.id
  if (!['docs', 'items'].includes(S.route.scr)) S.route.scr = 'docs'
  render()
}
function snap() { const t = ['docs', 'items'].includes(S.route.scr) ? activeTab() : null; return { scr: S.route.scr, kn: S.route.kn, tab: t ? { kind: t.kind, kn: t.kn, ref: t.ref } : null } }
function pushHist() {
  const s = snap(), c = S.hist[S.hpos]
  if (c && JSON.stringify(c) === JSON.stringify(s)) return
  S.hist = S.hist.slice(0, S.hpos + 1)
  S.hist.push(s)
  if (S.hist.length > 80) S.hist.shift()
  S.hpos = S.hist.length - 1
}
function histGo(d) {
  leaveGate()
  const i = S.hpos + d
  if (i < 0 || i >= S.hist.length) return
  S.hpos = i
  const s = S.hist[i]
  S.route = { scr: s.scr, kn: s.kn }
  S.menu = null; S.pal = null; S.qo = null; S.cmd = null
  if (s.tab) openTab(Object.assign({}, s.tab), { noHist: true, view: s.scr })
  render()
  scrollTopMain()
}

// ───────────── 그리기 ─────────────
function render() {
  const app = $('#app')
  if (!S.me) { app.innerHTML = `<div class="col"><div class="main">${S.err ? errHtml({ error: S.err }) : loadingHtml}</div></div>`; return }
  hidePv()
  S._pop = null
  const scr = gated() ? gateView() : viewOf(S.route.scr)
  const center = scr.tabs
    ? `<div class="center">${tabbarHtml()}<div class="panes"><div class="main${scr.full ? ' full' : ''}" data-t="main">${scr.main}</div>${scr.right != null ? `<div class="main rp" data-t="rightPane">${scr.right}</div>` : ''}</div></div>`
    : `<div class="main" data-t="main">${scr.main}</div>`
  // 다시 그려도 보던 자리 그대로 — 같은 화면 · 같은 탭이면 가운데 · 옆 목록 · 옆 칸의 스크롤을 지킨다(go 로 다른 화면에 가면 맨 위)
  const view = `${S.route.scr}|${S.route.kn}|${S.active || ''}|${S.split || ''}`
  const lpView = `${gated() ? '' : defaultKn()}|${VIEWS3.includes(S.route.scr) ? S.route.scr : S.ktab || 'docs'}`
  const keep = ['.main[data-t=main]', '[data-t=rightPane]', '[data-t=leftPane]', '[data-t=aside]'].map((q) => { const el = app.querySelector(q); return el ? [q, el.scrollTop] : null }).filter((x) => x && (x[0] === '[data-t=leftPane]' ? S._lpView === lpView : S._view === view))
  S._view = view
  S._lpView = lpView
  app.innerHTML = sideHtml(scr.left) + `<div class="col">${hdrHtml(scr.crumb)}${gated() ? '' : bandHtml()}<div class="body">${center}${scr.aside ? `<div class="aside" data-t="aside">${scr.aside}</div>` : ''}</div>${statusHtml()}</div>${S.pal ? palHtml() : ''}${S.qo ? qoHtml() : ''}${S.cmd ? cmdHtml() : ''}${S.del ? delHtml() : ''}${S.addPop ? addPopHtml() : ''}${S.se && S.route.scr === 'import' ? srcModalHtml() : ''}${S.sfOpen && S.route.scr === 'import' ? sfModal() : ''}${S._pop ? `<div class="pop" data-t="pop" data-pop="${esc(S._pop.key)}">${S._pop.html}</div>` : ''}${S.off ? offHtml() : ''}${S.claudeWin ? claudeWinHtml() : ''}${S.sudo ? sudoHtml() : ''}`
  placePop()
  for (const [q, top] of keep) { const el = app.querySelector(q); if (el) el.scrollTop = top }
  if (gated()) { const g = $('[data-focus]'); if (g && document.activeElement !== g) g.focus(); return }
  const fi = $('#palIn') || $('#qoIn') || $('#cmdIn')
  if (fi && document.activeElement !== fi) { fi.focus(); fi.setSelectionRange(fi.value.length, fi.value.length) }
  if (S._focus) { const el = document.getElementById(S._focus); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length) } catch {} } S._focus = null }
  if (S.route.scr === 'graph') gHighlight()
  fillAtts()
  for (const t of app.querySelectorAll('.term')) t.scrollTop = t.scrollHeight
  // 내 PC 지식의 주소는 해시 조각으로만 — 팀 서버 요청 · Referer 에 실리지 않는다
  const at = activeTab()
  const want = at && String(at.kn).startsWith('~') && ['docs', 'items'].includes(S.route.scr) ? '#' + encodeURIComponent(at.kn).replace('%7E', '~') + '/' + encodeURIComponent(at.ref) : ''
  if (want !== location.hash && (want || location.hash.startsWith('#~'))) history.replaceState(null, '', location.pathname + (want || ''))
  if (S._lit) {
    const el = $('#app .main[data-t=main] .lit')
    if (el) { S._lit = false; setTimeout(() => el.scrollIntoView({ block: 'center' }), 30) }
  }
}
function placePop() {
  const p = $('#app .pop')
  if (!p) return
  const a = [...document.querySelectorAll('[data-m]')].find((x) => x.dataset.m === p.dataset.pop)
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
  if (!isTeam() && (s === 'tidy' || s === 'members' || s === 'admin')) s = 'home' // 팀의 일 — 이 PC 에는 없다
  const f = { home: viewHome, docs: viewDocsV, items: viewItems, graph: viewGraph, today: viewToday, log: viewToday, tidy: viewTidy, members: viewMembers, import: viewImport, add: viewHome, send: viewSend, settings: viewSettings, admin: viewAdmin }[s]
  return f ? f() : viewLater(s)
}
// 옆 메뉴 — 두 영역(정정 2026-10-23 · 리본을 걷었다)
//   지식 고르기 — 지식 고르기 · 문서 · 항목 · 그래프 탭 · 그 탭의 목록(다른 화면에서도 그대로 보인다)
//   지식 관리   — 모든 지식에 공통: 바뀐 것 · 이력 · 가져오기 · 지식 보내기 · 설정(팀이면 정리하는 사람 · 관리도)
const VIEWS3 = ['docs', 'items', 'graph']
function sideList(vt, k) {
  // 지식 목록(전체) 화면 — 지식을 고르면 그 지식의 문서 · 항목이 선다
  if (S.route.scr === 'home') return '<div class="lh">지식을 고른다</div>' + shownKns().map((x) => `<div class="tn" style="padding-left:8px" data-a="openKn" data-k="${esc(x.id)}" data-t="sideKn">${svg('doc')}<span class="nm">${esc(x.name)}</span></div>`).join('')
  if (!k || !KN(k)) return '<p class="muted small" style="padding:6px 8px">지식이 없다 — 지식 관리 › 가져오기에서 세운다</p>'
  if (vt === 'items') return itemListHtml(k)
  if (vt === 'graph') return `<div class="muted small" style="padding:6px 8px" data-t="graphHint">그래프는 가운데에 그린다 — <a data-a="view" data-v="graph">열기</a></div>`
  return treeHtml(k)
}
function sideHtml(left) {
  const r = S.route, team = isTeam()
  const dim = anon()
  const vt = VIEWS3.includes(r.scr) ? r.scr : S.ktab || 'docs'
  const k = dim ? null : defaultKn()
  const cur = k ? KN(k) : null
  let h = `<aside class="side${dim ? ' dim' : ''}"><div class="sb-top"><div class="logo${team ? '' : ' me'}">K</div><span class="brand">kmd</span>${busyDot()}</div><div class="where">${team ? '팀 서버에서 돈다 · ' + esc(S.me.host) : '이 PC 에서 돈다'}</div>`
  if (!dim) {
    // 지식 고르기 영역
    // 팀 화면의 지식 수는 갈래마다 — 내 PC · 개인 지식까지 「팀」 으로 세지 않는다
    const vk = shownKns(), nPc = vk.filter((x) => x.pc).length, nMine = vk.filter((x) => !x.pc && x.private).length
    const cnt = team ? ['팀 ' + (vk.length - nPc - nMine), nMine ? '개인 ' + nMine : '', nPc ? '내 PC ' + nPc : ''].filter(Boolean).join(' · ') : '내 지식 ' + vk.length
    const home = r.scr === 'home'
    h += `<div class="sb-know" data-t="knowArea"><div class="sb-repo" data-a="kmenu" data-t="kpick">${cur && !home ? `<span class="rk">${esc(cur.name.slice(0, 2))}</span><span class="rn">${esc(cur.name)} <small>${esc(knWhere(cur))}</small></span>` : `<span class="rk">전체</span><span class="rn">지식 전체<small>${cnt}</small></span>`}<span class="rc">▾</span>${S.menu === 'kmenu' ? `<div class="kmenu"><div class="mi" data-a="pickKn" data-k="*" data-t="nav-home">${svg('list')} 지식 목록 — 전체</div>${shownKns().map((x) => `<div class="mi" data-a="pickKn" data-k="${esc(x.id)}" data-t="kmenuKn">${esc(x.name)} ${knTag(x)}</div>`).join('')}<div class="sep"></div><div class="mi" data-a="openAdd" data-t="nav-add">+ 새 지식</div></div>` : ''}</div>`
    h += `<div class="ktabs" data-t="ktabs">${[['docs', '문서', 'doc'], ['items', '항목', 'tag'], ['graph', '그래프', 'graph']].map(([v, l, ic]) => `<span class="${VIEWS3.includes(r.scr) && vt === v ? 'on' : vt === v ? 'cur' : ''}" data-a="view" data-v="${v}" data-t="rb-${v}" title="${l}로 보기">${svg(ic)}${l}</span>`).join('')}</div>`
    h += `<div class="lp" data-t="leftPane">${left || sideList(vt, k)}</div></div>`
  }
  // 지식 관리 영역 — 공통
  const it = (key, l, ic, bd) => `<div class="sb-i${!dim && (r.scr === key || (key === 'today' && r.scr === 'log')) ? ' on' : ''}" data-a="nav" data-s="${key}" data-t="nav-${key}">${svg(ic)}<span>${l}</span>${bd ? `<span class="bd">${bd}</span>` : ''}</div>`
  // 지식 관리 — 고른 지식의 갈래에 따라: 모두 이력 · 가져오기 · 설정 / 개인 지식은 + 지식 보내기(개인 → 팀) /
  //   팀 지식은 + 정리 · 이 지식의 사람(주인 · 정리하는 사람 · 관리자) · 관리는 팀 서버 전체의 일이라 관리자에게 늘
  const personal = isPersonal(cur)
  const curator = !dim && team && !personal && ((cur && cur.role && cur.role !== '기록') || S.me.admin)
  const tk = curator && cur
  h += `<div class="sb-mg" data-t="manageArea" data-kind="${personal ? 'personal' : 'team'}"><div class="sb-g">지식 관리 <span data-t="manageKind">${dim ? '' : personal ? (cur && cur.pc ? '· 내 PC 지식' : '· 개인 지식') : '· 팀 지식'}</span></div><div class="nav">` + it('today', '이력', 'check') + it('import', '가져오기', 'plug')
  if (!dim && personal) h += it('send', '지식 보내기', 'pair', S.kns.some((x) => x.sendWait) ? '…' : S.kns.filter(isPersonal).reduce((a, x) => a + (x.sendN || 0), 0) || '')
  if (!dim && team && !personal) h += it('tidy', '정리', 'hour', tk && tk.pend ? tk.pend : '')
  if (curator) h += it('members', '이 지식의 사람', 'users')
  // 관리는 팀 서버 전체의 일 — 고른 지식과 상관없이 관리자에게
  if (!dim && S.me.admin && team) h += it('admin', '관리', 'shield')
  h += it('settings', '설정', 'gear') + '</div></div>'
  return h + '</aside>'
}
function hdrHtml(crumb) {
  const r = S.route
  const kn = r.kn && r.kn !== '*' && KNSCR.includes(r.scr) && KN(r.kn) ? KN(r.kn).name : ''
  const parts = String(crumb || '').split(' › ').filter(Boolean)
  const c = (kn && parts[0] !== kn ? '<span>' + esc(kn) + '</span> › ' : '') + parts.map((x, i) => (i === parts.length - 1 ? '<b>' + esc(x) + '</b>' : esc(x))).join(' › ')
  const hb = `<span class="hist"><button class="hb" data-a="histGo" data-v="-1" data-t="histBack" title="이전 (Alt ←)"${S.hpos > 0 ? '' : ' disabled'}>‹</button><button class="hb" data-a="histGo" data-v="1" data-t="histFwd" title="다음 (Alt →)"${S.hpos < S.hist.length - 1 ? '' : ' disabled'}>›</button></span>`
  const meMenu = S.menu === 'me' ? `<div class="menu" style="right:0;top:30px" data-t="meMenu"><div class="mi" data-a="nav" data-s="settings" data-t="meSettings">설정</div>${isTeam() ? '<div class="sep"></div><div class="mi" data-a="logout" data-t="meLogout">나가기<small>이 브라우저에서</small></div><div class="mi" data-a="logoutAll" data-t="meLogoutAll">모든 곳에서 나가기<small>다른 기기 · 브라우저도</small></div>' : ''}</div>` : ''
  const me = anon() ? '<span class="hme muted" data-t="me">아직 들어오지 않았다</span>' : `<span class="hme" data-a="menu" data-m="me" data-t="me" title="설정 · 나가기" style="cursor:pointer;position:relative">${meMenu}<span class="av">${esc(String(S.me.user).slice(0, 1))}</span>${esc(S.me.user)} <small>· ${isTeam() ? '팀 서버' : '이 PC'}</small></span>`
  const right = `<div class="hright">${anon() ? '' : claudeChip()}<a class="hlink" data-t="manual" href="/manual" target="_blank" rel="noopener" title="설명서 — 새 탭">${svg('book')}<span>설명서</span></a>${me}</div>`
  if (anon()) return `<header class="hdr"><span class="crumb">${c}</span><div class="hmid"></div>${right}</header>`
  return `<header class="hdr">${hb}<span class="crumb">${c}</span><div class="hmid"><div class="qbtn" data-a="openQo" data-t="qoBtn" title="문서 · 항목 · 기록 이름으로 바로 연다">빨리 열기 <kbd>Ctrl O</kbd></div><div class="search" data-a="openSearch" data-t="search">${svg('search')}<span style="margin-left:6px">찾기</span><span style="margin-left:auto;font-size:11px">Ctrl K</span></div></div>${right}</header>`
}
function bandHtml() {
  const r = S.route, team = isTeam()
  const k = r.kn && r.kn !== '*' && KNSCR.includes(r.scr) ? r.kn : null
  let left
  if (!k) left = team ? '팀 서버의 kmd · 같이 쓴다' : '이 PC 의 kmd · 나만 쓴다'
  else if (KN(k) && KN(k).pc) left = '내 PC 지식 · ' + (KN(k).dir || '이 PC') + ' · 나만'
  else if (team && KN(k) && KN(k).private) left = '개인 지식 · 팀 서버 · 나만'
  else left = team ? '팀 지식 · 팀 서버 · 나: ' + (KN(k) && KN(k).role === '주인' ? '주인' : '기록') : '내 지식 · ' + ((KN(k) && KN(k).dir) || '') + ' · 나만'
  const st = stopsFor(k)
  const right = st.length ? st.map((x) => `<span class="chip ${x.level === 'bad' ? 'c-danger' : 'c-warn'}" data-t="bandchip">${esc(x.b)} — ${esc(x.t)}</span>`).join('') : team ? '' : '<span class="muted">밖으로 나가는 것은 보내기 · 백업 · Claude 정리뿐</span>'
  return `<div class="band ${team ? 'team' : 'me'}"><span class="who"><i></i>${esc(left)}</span><span class="out">${right}</span></div>`
}
// ── 멈춤 한 줄(서버가 준 줄 그대로) ──
function stopsFor(k) { return S.stops.filter((x) => !k || !x.kn || x.kn === k) }
const stopHtml = (x) => `<div class="callout ${x.level === 'bad' ? 'danger' : 'warn'} stop" data-t="stop"><i></i><span><b>${esc(x.b)}</b>${x.t ? ' — ' + esc(x.t) : ''}</span>${x.r ? `<span class="r">${esc(x.r)}</span>` : ''}</div>`
async function loadStops() {
  try {
    const st = await getJSON('/api/stops')
    if (JSON.stringify(st) !== JSON.stringify(S.stops)) { S.stops = st; if (!S.qo && !S.pal && !S.cmd && !gated()) render() }
  } catch {}
}

function statusHtml() {
  const l = anon() ? (S.gate === 'setup' ? '첫 설정 · 아직 관리자가 없다' : '') : isTeam() ? '들어옴 · ' + esc(S.me.user) : '이 PC'
  return `<div class="status"><span>${l}</span><span class="r" data-t="clock">kmd v${esc(S.me.version)} · ${clock()}</span></div>`
}

// ── 지식 목록 ──
function knMeta(n) {
  return isTeam() && !isPersonal(n) ? '문서 ' + n.docs + ' · 팀 모두 기록' : '문서 ' + n.docs + (n.when ? ' · ' + whenTxt(n.when) : '')
}
// 지식 목록 — 새 지식와 한 화면(요구 v0.2 R2): 지식 폴더 띠 · 그리드(메뉴 순서 · 끌어 옮기기) · + 새 지식(팝업 · 이름만) · 뺀 지식
const shownKns = () => S.kns.filter((x) => !x.hidden)
const knRoot = () => (isTeam() ? (S.me.admin ? S.me.root || '' : '') : pcRoot())
function kcardHtml(n, team) {
  const tag = n.pc ? '<span class="kt me">내 PC</span>' : team ? (n.private ? '<span class="kt me">개인</span>' : '<span class="kt team">팀</span>') : ''
  const chips = team && !n.pc && n.role && n.role !== '기록' ? `<span class="chip c-mute">나: 정리</span>${n.pend ? `<span class="chip c-pend">받은 것 ${n.pend}</span>` : ''}` : n.sendN ? `<span class="chip c-pend">보낼 것 ${n.sendN}</span>` : ''
  const mk = 'kn:' + n.id
  const own = !n.pc && !n.dim
  const items = own ? [
    n.hidden ? '' : `<div class="mi" data-a="knMove" data-k="${esc(n.id)}" data-v="-1" data-t="knUp">앞으로<small>메뉴 순서</small></div><div class="mi" data-a="knMove" data-k="${esc(n.id)}" data-v="1" data-t="knDown">뒤로</div>`,
    `<div class="mi" data-a="knHide" data-k="${esc(n.id)}" data-v="${n.hidden ? '' : '1'}" data-t="knHide">${n.hidden ? '메뉴에 올리기' : '메뉴에서 빼기'}<small>${n.hidden ? '옆 메뉴에 다시' : '지우지 않는다'}</small></div>`,
    canDelete(n) ? `<div class="sep"></div><div class="mi dan" data-a="delOpen" data-k="${esc(n.id)}" data-t="delOpen">지식 지우기<small>보관하지 않고 완전히</small></div>` : '',
  ].join('') : ''
  if (S.menu === mk && items) S._pop = { key: mk, html: items }
  const kebab = items ? `<button class="kebab${S.menu === mk ? ' on' : ''}" data-a="menu" data-m="${esc(mk)}" data-t="knKebab" title="순서 · 메뉴에서 빼기 · 지우기">⋯</button>` : ''
  const meta = n.dim ? '내 PC 프로그램이 켜지면 열린다' : n.pc ? '문서 ' + n.docs + ' · 내 PC 프로그램이 연다' : knMeta(n)
  const drag = own && !n.hidden ? ` draggable="true" data-drag="${esc(n.id)}"` : ''
  return `<div class="kcard${n.dim ? ' dim' : ''}${n.hidden ? ' hid' : ''}" data-a="openKn" data-k="${esc(n.id)}" data-t="${n.hidden ? 'kHid' : 'krow'}" data-name="${esc(n.name)}"${drag}>${drag ? '<span class="grip" title="끌어서 순서를 바꾼다">⋮⋮</span>' : ''}<div class="kh"><span class="kn3">${esc(n.name)}</span>${kebab}</div><div class="km">${tag} ${esc(meta)}</div>${chips || n.hidden ? `<div class="kf">${chips}${n.hidden ? `<button class="btn sm" data-a="knHide" data-k="${esc(n.id)}" data-v="" data-t="knShow">메뉴에 올리기</button>` : ''}</div>` : ''}</div>`
}
function viewHome() {
  const team = isTeam()
  // 팀 화면의 「내 PC」 카드 — 내 PC 프로그램이 꺼져 있으면 지난번 이름만 흐리게(이 탭 안의 것 · 서버로 가지 않는다)
  const offPc = team && S.pc && S.pc.off ? pcRemembered().map((x) => ({ ...x, pc: true, dim: true })) : []
  const shown = [...shownKns(), ...offPc], hid = S.kns.filter((x) => x.hidden)
  const root = knRoot()
  const fbar = root ? `<div class="fbar" data-t="addRoot"><span class="fl">${svg('doc')}지식 폴더</span><span class="fp" data-t="rootPath">${esc(root)}</span><span class="acts"><button class="btn" data-a="copyRoot" data-t="copyRoot">경로 복사</button><button class="btn" data-a="syncKn" data-t="syncKn"${S.syncing ? ' disabled' : ''}>${S.syncing ? '읽는 중…' : '동기화'}</button></span><small>지식 하나 = 이 폴더 안의 폴더 하나 · 다른 곳에서 만든 지식은 폴더째 여기에 놓고 [동기화] — 메뉴 맨 아래에 들어온다</small></div>` : ''
  const pcLine = !team || !S.pc ? '' : S.pc.wait ? '<div class="callout gray stop" data-t="pcWait"><i></i><span>내 PC 프로그램에 잇는 중…</span></div>' : S.pc.off ? '<div class="callout gray stop" data-t="pcOff"><i></i><span><b>내 PC 프로그램이 꺼져 있다</b> — 켜면 저절로 다시 열린다</span></div>' : S.pc.deny ? `<div class="callout gray stop" data-t="pcDeny"><i></i><span><b>이 PC 의 내 지식은 여기서 열지 않는다</b> — ${esc(S.pc.deny)}</span></div>` : ''
  const msg = S.syncMsg ? `<div class="callout ${S.syncMsg.cls || ''} stop" data-t="syncMsg"><i></i><span>${S.syncMsg.t}</span></div>` : ''
  const add = `<div class="kcard add" data-a="openAdd" data-t="addCard"><span class="pl">+</span>${!team && !S.kns.length ? '첫 지식 세우기' : '새 지식'}</div>`
  return {
    crumb: '지식 목록',
    main: `<div style="max-width:1100px"><div class="pg-h"><div><div class="big">지식 목록</div><p class="lead">${team ? '팀 서버의 지식 · 내 지식' : '내 지식 ' + S.kns.length} — 옆 메뉴에 이 순서로 보인다 · 카드를 끌어 순서를 바꾼다</p></div></div>
  ${S.stops.map(stopHtml).join('')}${pcLine}${fbar}${msg}
  <div class="kgrid" data-t="klist">${shown.map((n) => kcardHtml(n, team)).join('')}${add}</div>
  ${hid.length ? `<div class="sec-h" data-t="hidSec"><b>뺀 지식</b><small>옆 메뉴에 보이지 않는다 · 지우지 않았다 — [메뉴에 올리기] 로 다시</small></div><div class="kgrid" data-t="hidList">${hid.map((n) => kcardHtml(n, team)).join('')}</div>` : ''}</div>`,
  }
}
// 새 지식 팝업 — 이름만(PC: 지식 폴더 안 새 지식 · 팀: 팀 서버 안 내 지식)
function openAdd() { S.menu = null; S.addPop = { name: '', dir: '', where: isTeam() ? (S.me.admin ? 'team' : 'pc') : 'local', err: null, busy: false }; S._focus = 'addIn'; if (S.route.scr !== 'home') go({ scr: 'home', kn: '*' }); else render() }
function addPopHtml() {
  const a = S.addPop, team = isTeam()
  const onPc = a.where === 'pc' || a.where === 'local'
  const pcOff = team && a.where === 'pc' && !(S.pc && S.pc.token)
  const kinds = team ? `<div class="seg" data-t="addKind" style="margin:0 0 10px"><button class="${a.where === 'pc' ? 'on' : ''}" data-a="addKind" data-v="pc" data-t="addKindPc">내 PC</button>${S.me.admin ? `<button class="${a.where === 'team' ? 'on' : ''}" data-a="addKind" data-v="team" data-t="addKindTeam">팀 지식</button><button class="${a.where === 'mine' ? 'on' : ''}" data-a="addKind" data-v="mine" data-t="addKindMine">팀 서버 · 나만</button>` : ''}</div>` : ''
  const hint = a.where === 'team' ? '팀 서버에 팀 지식으로 선다 — 팀 모두 보고 기록한다 · 주인은 나(이 지식의 사람에서 넘긴다)'
    : a.where === 'mine' ? '팀 서버 안에 내 지식으로 선다 — 나만 본다(관리자 · 서버를 돌보는 사람은 디스크 · 백업으로 볼 수 있다) · 떠나면 관리자가 넘겨받는다'
    : `내 PC 의 지식 폴더 안에 선다 — 나만 · 팀 서버에는 가지 않는다${team ? ' · 팀 화면에서도 「내 PC」 로 열린다' : ''} · 폴더 경로를 쓰면 그 폴더의 글(md · docx · pptx · xlsx)을 한 번 들인다(원본은 그대로)`
  const dirFld = onPc ? `<div class="field" style="margin:10px 0 0"><label for="addDir">내 PC 폴더 경로 <span class="muted">(선택 — 쓰면 이름은 폴더 이름)</span></label><input class="inp mono" id="addDir" data-in="addDir" data-t="addDir" value="${esc(a.dir || '')}" placeholder="예: D:\\문서\\배포 노트" autocomplete="off"></div>` : ''
  return `<div class="scrim fix" data-a="addClose" data-self="1"><div class="modal w420" data-t="addPop"><div class="mh">새 지식<button class="x" data-a="addClose" title="닫기">×</button></div><div class="mb">${kinds}<div class="field" style="margin:0"><label for="addIn">이름</label><input class="inp" id="addIn" data-in="addName" data-t="addIn" value="${esc(a.name)}" placeholder="예: 회의" autocomplete="off"></div>${dirFld}<div class="hint" style="margin-top:8px">${esc(hint)}</div>${pcOff ? '<div class="callout gray" data-t="addPcOff" style="margin-top:8px">내 PC 프로그램에 닿지 않는다 — 켜 두거나, 없으면 설정 › 에이전트 설치의 설치 한 줄로 깐다</div>' : ''}${a.err ? `<div class="callout danger" data-t="addMsg">${esc(a.err)}</div>` : ''}</div><div class="mf"><span class="l">새 지식은 메뉴 맨 아래에 들어온다</span><span class="acts"><button class="btn ghost" data-a="addClose">취소</button><button class="btn pri" data-a="doAdd" data-t="addBtn"${a.busy || pcOff ? ' disabled' : ''}>${a.busy ? '만드는 중…' : '추가'}</button></span></div></div></div>`
}
// 내 PC 프로그램에 바로(짝 열쇠) — 팀 화면의 「새 지식 › 내 PC」
async function pcPost(p, body) {
  if (!S.pc || !S.pc.token) throw new Error('내 PC 프로그램에 닿지 않는다 — 켜 두거나 설치 한 줄로 깐다')
  const r = await fetch(S.pc.url + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.pc.token }, body: JSON.stringify(body || {}) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.message || '내 PC 프로그램이 받지 않았다'), { code: j.error })
  return j
}
async function doAdd() {
  const a = S.addPop
  if (!a || a.busy) return
  const name = String(a.name || '').trim()
  const dir = String(a.dir || '').trim()
  const onPc = a.where === 'pc' || a.where === 'local'
  if (!name && !(onPc && dir)) { a.err = '이름을 쓴다(또는 내 PC 폴더 경로)'; render(); return }
  a.busy = true; a.err = null; render()
  try {
    const body = onPc && dir ? { kind: 'folder', dir } : { kind: 'new', name, ...(a.where === 'team' ? { team: true } : {}) }
    const r = a.where === 'pc' ? await pcPost('/api/knowledge/add', body) : await postJSON('/api/knowledge/add', body)
    S.addPop = null
    if (a.where === 'pc') await pcConnect(false, { quiet: true }) // 팀 화면의 「내 PC」 목록을 새로
    await reloadKns()
    delete S.cache.history
    const id = a.where === 'pc' ? '~' + r.id : r.id
    S.syncMsg = { t: `<b>추가했다 — ${esc(r.name)}</b>${a.where === 'pc' ? ' · 내 PC' : a.where === 'team' ? ' · 팀 지식 · 팀 모두 본다' : a.where === 'mine' ? ' · 팀 서버 안 내 지식' : r.dir ? ' · ' + esc(r.dir) : ''}${r.summary ? ` · 문서 ${r.summary.doc || 0}` : ''} <a data-a="openKn" data-k="${esc(id)}">열기 ›</a>` }
  } catch (e) { a.busy = false; a.err = e.message }
  render()
}
async function syncKn() {
  S.syncing = true; S.syncMsg = null; render()
  try {
    const r = await postJSON('/api/knowledge/sync', {})
    await reloadKns()
    S.cache = {}
    S.syncMsg = r.added.length ? { t: `<b>새 지식 ${r.added.length} — ${r.added.map((x) => esc(x.name)).join(' · ')}</b> · 메뉴 맨 아래에 두었다${r.gone.length ? ' · 없어진 폴더 ' + r.gone.length : ''}` } : { cls: 'gray', t: `<b>새로 놓인 지식이 없다</b> — 지식 ${r.total}${r.gone.length ? ' · 없어진 폴더 ' + r.gone.length + '(목록에서 뺐다)' : ''}` }
  } catch (e) { S.syncMsg = { cls: 'danger', t: esc(e.message) } }
  S.syncing = false
  render()
}
// 메뉴 순서 · 뺌 — 화면은 바로 바꾸고 서버에 적는다(사람마다)
async function saveMenu() {
  const own = S.kns.filter((x) => !x.pc)
  try { await postJSON('/api/knowledge/menu', { order: own.map((x) => x.id), hidden: own.filter((x) => x.hidden).map((x) => x.id) }) } catch (e) { toast(esc(e.message)) }
}
function knMove(id, d) {
  const own = S.kns.filter((x) => !x.pc && !x.hidden), i = own.findIndex((x) => x.id === id), j = i + d
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
  return { crumb: LATER[s] || '지식 목록', main: `<div style="max-width:760px"><div class="big">${esc(LATER[s] || '')}</div><div class="callout gray" data-t="later">이 화면은 다음 판에 열린다 — 지금은 문서로 보기에서 읽는다. <a data-a="view" data-v="docs">문서로 보기 ›</a></div></div>` }
}
// ── 탭 줄 ──
function tabbarHtml() {
  const g = S.route.scr === 'graph'
  const tabs = S.tabs.map((t) => `<div class="tb1${t.id === S.active && !g ? ' on' : ''}${t.id === S.split && !g ? ' rt' : ''}" data-a="actTab" data-id="${t.id}" data-t="tab" data-name="${esc(tabTitle(t))}" title="${esc((KN(t.kn) ? KN(t.kn).name : '') + ' › ' + tabTitle(t))}${t.id === S.split ? ' — 오른쪽에 나란히' : ''}">${tabIcon(t)}<span class="nm">${esc(tabTitle(t))}</span><button class="x" data-a="closeTab" data-id="${t.id}" data-t="tabX" title="닫기">×</button></div>`).join('')
  const menu = S.menu === 'tabs' ? `<div class="menu" style="right:0;top:28px" data-t="tabMenu"><div class="mi" data-a="splitToggle" data-t="splitBtn">${S.split ? '나누기 닫기' : '나누어 보기'}<small>Ctrl \\</small></div><div class="mi" data-a="openQo">빨리 열기<small>Ctrl O · Ctrl T</small></div><div class="sep"></div><div class="mi" data-a="closeOthers" data-t="closeOthers">다른 탭 모두 닫기</div></div>` : ''
  return `<div class="tabbar" data-t="tabbar"><div class="tabs-s">${tabs || '<span class="none">열린 탭이 없다 — 왼쪽에서 열거나 Ctrl O</span>'}</div><button class="tadd" data-a="openQo" data-t="tabAdd" title="빨리 열기 (Ctrl O · Ctrl T)">+</button><button class="kebab${S.menu === 'tabs' ? ' on' : ''}" data-a="menu" data-m="tabs" data-t="tabKebab" title="나누어 보기 · 탭">⋯${menu}</button></div>`
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
function knAside(k) {
  const team = isTeam() && !isPersonal(KN(k))
  return `<h4>이 지식</h4><div class="kv">${team ? '<span>쓰는 사람</span><span>팀 모두 기록</span>' : '<span>주인</span><span>나 — 저장하면 바로 문서에 들어간다</span>'}
  <span>자동으로 가져오는 곳</span><span>없음<small><a data-a="nav" data-s="import">가져오기 ›</a></small></span></div>`
}
function myPend(tr) { return (tr && tr.records ? tr.records : []).filter((r) => r.state === 'pend' && r.author === S.me.user) }
function waitHtml(k, tr) {
  const p = myPend(tr)
  return p.length ? `<div class="wait" data-t="wait"><i></i>${p.map((x) => esc(whenTxt(x.date)) + ' 에 쓴 기록 1 — ' + pendWhen(k) + ' · ' + esc(x.title.split(' — ')[0])).join('<br>')} · 그동안도 문서 옆에 같이 읽힌다</div>` : ''
}
function docsEmpty(k) {
  const n = KN(k), tr = treeOf(k)
  const ds = tr && tr.docs ? tr.docs : []
  return `<div style="max-width:760px"><div class="big">${esc(n.name)}</div><p class="lead">${isPersonal(n) ? (n.pc ? '내 PC 지식' : '내 지식') + (n.dir ? ' · ' + esc(n.dir) : '') + ' · 나만' : '팀 모두 기록'}</p>${waitHtml(k, tr)}
  <div class="callout gray" data-t="docsEmpty">왼쪽 나무에서 문서나 기록을 연다 — 여러 개를 탭으로 띄우고, <b>Ctrl \\</b> 로 둘을 나란히 본다. 이름으로 바로 열려면 <b>Ctrl O</b>.</div>
  <div class="card"><div class="ch">최근 바뀐 문서 <small>문서 ${ds.length}</small></div><div class="cb" style="padding:2px 14px 4px"><ul class="plain dl">${tr ? ds.slice(0, 5).map((d) => `<li data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="recentDoc" data-pv="doc|${esc(k)}|${esc(d.id)}">${svg('doc', 'di')}<span class="nm">${esc(d.title)}</span><span class="when${isToday(d.when) ? ' td' : ''}">${esc(whenTxt(d.when))}</span></li>`).join('') : `<li>${loadingHtml}</li>`}</ul></div></div></div>`
}
function treeHtml(k) {
  const n = KN(k), tr = treeOf(k)
  if (!tr) return `<div class="tree" data-t="tree">${loadingHtml}</div>`
  if (tr.error) return `<div class="tree" data-t="tree">${errHtml(tr)}</div>`
  const ds = tr.docs, fk = (f) => !!S.fold[k + ':' + f]
  const all = S.all, list = all ? ds : ds.slice(0, 11)
  const head = (f, l, cnt, extra) => `<div class="tf" data-a="fold" data-f="${f}" data-t="fold-${f}"><span class="ar">${fk(f) ? '▸' : '▾'}</span>${l}${extra || ''}<span class="cnt">${cnt}</span></div>`
  let h = `<div class="tree" data-t="tree">` + head('docs', '문서', ds.length)
  if (!fk('docs')) h += list.map((d) => `<div class="tn${isAct('doc', k, d.id) ? ' on' : ''}" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="doc" data-name="${esc(d.title)}" data-pv="doc|${esc(k)}|${esc(d.id)}">${svg('doc')}<span class="nm">${esc(d.title)}${list.filter((o) => o.title === d.title).length > 1 ? ` <small class="muted mono">${esc(d.id)}</small>` : ''}</span>${d.pend ? '<i class="pd" title="아직 문서에 안 넣은 기록이 있다"></i>' : ''}</div>`).join('') + (!all && ds.length > 11 ? `<div class="tn more" data-a="allDocs" data-t="moreDocs">${ds.length - 11}개 더</div>` : '')
  const rs = tr.records
  h += head('recs', '기록', rs.length, ' <small>날짜 순</small>')
  if (!fk('recs')) h += rs.length ? rs.map((r) => `<div class="tn${isAct('rec', k, r.id) ? ' on' : ''}" data-a="openRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="rec" data-state="${r.state}" data-pv="rec|${esc(k)}|${esc(r.id)}">${r.state === 'pend' ? '<i class="pd" title="아직 문서에 안 넣은 기록"></i>' : ''}<span class="dt">${esc(isToday(r.date) ? hhmm(r.date) : whenTxt(r.date))}</span><span class="nm">${esc(r.title.split(' — ')[0])}</span></div>`).join('') : `<div class="tn muted nc">${isTeam() ? '아직 없다' : '내 지식은 고치면 바로 문서다'}</div>`
  const at = tr.atts
  h += head('atts', '첨부', at.length)
  if (!fk('atts')) h += at.length ? at.map((a) => `<div class="tn${isAct('att', k, a) ? ' on' : ''}" data-a="openAtt" data-k="${esc(k)}" data-v="${esc(a)}" data-t="att">${svg('clip')}<span class="nm">${esc(a)}</span></div>`).join('') : '<div class="tn muted nc">없다</div>'
  return h + '</div>'
}
function rpHead() { return '<div class="rph"><i class="pd"></i>나란히 보기 — 읽기만<a class="r small" data-a="closeSplit" data-t="closeSplit">나누기 닫기 ×</a></div>' }

function docAside(k, d) {
  const bl = d.backlinks
  const ol = d.sections.map((s) => `<div class="olr" data-a="scrollSec" data-h="${esc(s.h)}" data-t="olRow">${esc(s.h)}${s.pend.length ? '<i class="pd"></i>' : ''}</div>`).join('')
  const none = '<div class="muted small alr">없다</div>'
  const recs = bl.recs.map((r) => `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="blRec" data-pv="rec|${esc(k)}|${esc(r.id)}"><span class="dt">${r.state === 'pend' ? '●' : esc(whenTxt(r.date).replace(/^(오늘|어제) /, ''))}</span><span class="nm">${esc(r.title)}</span></div>`).join('')
  const docs = bl.linkers.map((o) => `<div class="alr" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(o.id)}" data-t="blDoc" data-pv="doc|${esc(k)}|${esc(o.id)}">${svg('doc')}<span class="nm">${esc(o.title)}</span></div>`).join('')
  const ments = bl.ments.map((x) => `<div class="alr" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(x.d)}" data-h="${esc(x.h)}" data-t="blMent" data-pv="doc|${esc(k)}|${esc(x.d)}">${svg('doc')}<span class="nm">${esc(x.title)} › ${esc(x.h)}<small>「${esc(x.x)}」</small></span></div>`).join('')
  // 이 문서가 온 곳 — 항목에 넣은 기록(넣은 파일 · 기록)과 그 기록을 넣은 정리
  const og = d.origins || []
  const ogRow = (r) => `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="originRow" data-how="${r.how}" data-pv="rec|${esc(k)}|${esc(r.id)}"><span class="dt">${r.how === 'tidy' ? '정리' : '기록'}</span><span class="nm">${esc(r.title.split(' — ')[0])}<small>${esc(whenTxt(r.date))} · ${esc(r.author)} · 항목 ${r.hs.length}${r.hs.length ? ' — ' + esc(r.hs.slice(0, 2).join(' · ')) + (r.hs.length > 2 ? ' …' : '') : ''}</small></span></div>`
  return `<div class="ap" data-t="outline"><h4>개요</h4>${ol}</div>
  <div class="ap" data-t="origins"><h4>이 문서가 온 곳 <small data-t="originN">${og.length}</small></h4>${og.map(ogRow).join('') || '<div class="muted small alr">없다 — 손으로 쓴 문서이거나 표지가 없다</div>'}</div>
  <div class="ap" data-t="backlinks"><h4>이 문서를 가리키는 것</h4>
   <div class="bg">기록 <b data-t="blRecN">${bl.recs.length}</b> <small>이 문서의 항목을 건드린 것</small></div>${recs || none}
   <div class="bg">문서 <b data-t="blDocN">${bl.linkers.length}</b> <small>이 문서를 링크한 것</small></div>${docs || none}
   <div class="bg">이름만 나온 곳 <b data-t="blMentN">${bl.ments.length}</b> <small>링크 없이 이름만</small></div>${ments || none}</div>
  <div class="ap" data-t="props"><h4>속성</h4><div class="kv"><span>마지막 정리</span><span>${esc(d.last ? whenTxt(d.last.date) + ' — ' + d.last.author + '의 기록에서' : whenTxt(d.when))}</span><span>가져오는 곳</span><span>${d.watched ? esc(d.watched.src) + (d.watched.orphan ? ' — 없어졌다' : '') : '없음'}</span><span>자리</span><span>${esc(knWhere(KN(k)) || (isTeam() ? '팀 서버' : '내 PC'))}</span><span>항목</span><span>${M(k) ? M(k).items.filter((i) => i.doc === d.id).length : d.items}</span></div></div>
  ${nbGraph(k, 'd:' + d.id)}`
}
function docPane(t, right) {
  const k = t.kn, n = KN(k), d = docOf(k, t.ref)
  if (!d) return { html: loadingHtml, title: tabTitle(t) }
  if (d.error) return { html: d.code === 'E_NOTFOUND' ? `<div class="callout gray" data-t="docGone"><span>이 문서는 이제 없다 — 지워졌거나 이름이 바뀌었다</span><a class="lk r" data-a="closeTab" data-id="${esc(t.id)}">탭 닫기</a></div>` : `<div class="callout warn" data-t="docErr"><span>${esc(d.error)}</span><a class="lk r" data-a="retryDoc" data-k="${esc(`doc:${k}:${t.ref}`)}" data-t="retryDoc">다시 시도</a></div>`, title: t.ref }
  const hl = right ? null : t.hl, q = right ? null : t.q
  const loc = isTeam() ? n.name + ' › ' + d.title : n.name + ' › ' + d.path.replace(/^docs\//, '')
  const mine = d.sections.flatMap((s) => s.pend.filter((x) => x.author === S.me.user))
  const editing = !right && S.edit && S.edit.tab === t.id
  const body = editing
    ? `<div class="ed" data-t="editor"><div class="lbl"><b>고치는 중</b> · 「## 」 으로 시작하는 줄이 항목 이름이다 · md 로 쓴다 — **굵게** · - 목록 · [링크](주소) · Ctrl S 저장 · Esc 그만두기</div><div class="toolbar"><button class="btn sm" data-a="edAddSec" data-t="edAddSec">항목 더하기</button><span class="muted small">항목을 지우려면 그 「## 」 줄과 글을 지운다 · 이름을 바꾸려면 「## 」 줄만 고친다</span></div><textarea id="edTx" data-in="edTx" data-t="edTx" spellcheck="false">${esc(edText(d))}</textarea>
   ${d.sections.filter((s) => s.locks).map((s) => `<div class="lockh">항목 「${esc(s.h)}」 의 표 — 회색은 잠겨 있다</div>${s.locks}`).join('')}
   <div class="row" style="margin-top:10px"><button class="btn pri" data-a="saveDoc" data-t="saveBtn"${S.edit.busy ? ' disabled' : ''}>${S.edit.busy ? '저장하는 중…' : '저장'}</button><button class="btn ghost" data-a="cancelEdit" data-t="cancelEdit"${S.edit.busy ? ' disabled' : ''}>그만두기</button><span class="r small muted">${d.direct ? '저장하면 바로 문서에 들어간다' : '팀 지식 — 저장하면 기록으로 남고 정리 때 문서에 들어간다'}</span></div></div>`
    : d.sections.map((s) => {
    const lit = hl && s.h === hl
    const it = M(k) && M(k).items.find((x) => x.doc === d.id && x.sec === s.h)
    const hn = it ? `<span class="hn" data-a="openItem" data-k="${esc(k)}" data-n="${esc(it.key)}" data-t="hn" title="항목으로 보기">${s.pend.length ? '<i class="pd"></i>' : ''}기록 ${s.recs}</span>` : ''
    const by = s.by && isToday(s.by.date) ? `<div class="hc"><span class="hchip">${esc(whenTxt(s.by.date))} 넣음 — ${esc(s.by.author)}의 기록에서</span></div>` : ''
    const pens = s.pend.map((x) => `<div class="penrec" data-t="penrec"><i></i><span><b>아직 문서에 안 넣은 기록 1</b> · ${esc(whenTxt(x.date))} · ${esc(x.author === S.me.user ? '나' : x.author)} — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}">「${esc(x.title)}」</a> · ${x.nowhere ? '넣을 곳은 정리하는 사람이 고른다' : '같이 읽힌다'}</span></div>`).join('')
    const inner = linkify(s.html, k, it ? it.key : null)
    return `<h2 data-sec="${esc(s.h)}">${esc(s.h)}${hn}</h2>${lit ? `<div class="lit" data-t="lit"><span class="tag">찾은 곳</span>${inner}</div>` : inner}${by}${pens}`
  }).join('')
  const main = `<div class="docw" data-t="docPane" data-name="${esc(d.title)}">${right ? rpHead() : ''}
  ${q ? `<div class="found" data-t="found"><span>찾기 <b>‘${esc(q)}’</b> 로 열었다</span><a data-a="reopenSearch">찾은 것으로 돌아가기</a></div>` : ''}
  <div class="ttl"><div class="path"><span>${esc(loc)}</span><span class="r">마지막으로 바뀐 때 ${esc(whenTxt(d.when))}</span></div>${editing || right || d.watched ? '' : '<button class="btn pri" data-a="editDoc" data-t="editBtn">고치기</button>'}</div>
  ${d.watched && d.watched.orphan ? `<div class="callout warn stop" data-t="watchedOrphan"><i></i><span><b>원본이 없어졌다</b> — 가져오던 곳 「${esc(d.watched.src)}」 이 지워졌다 · 내 문서로 하면 고칠 수 있다</span><button class="btn sm r" data-a="unwatchDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="unwatchBtn">내 문서로</button></div>` : ''}${d.watched && !d.watched.orphan ? `<div class="callout ${d.watched.missing ? 'warn' : 'gray'} stop" data-t="watched"><i></i><span><b>${d.watched.missing ? `원본에 없다 — ${esc(d.watched.missing)} 부터` : '원본이 주인이다'}</b> — ${esc(d.watched.src)} 의 <span class="mono">${esc(d.watched.path)}</span> 에서 온다 · 고치려면 원본 파일을 고친다 · 덧붙일 말은 기록으로 남긴다</span></div>` : ''}
  ${mine.length && !editing ? `<div class="wait" data-t="wait"><i></i>${esc(whenTxt(mine[0].date))} 에 쓴 기록 ${mine.length} — ${pendWhen(t.kn)} · 그동안도 문서 옆에 같이 읽힌다</div>` : ''}
  <div class="paper"><h1>${esc(d.title)}</h1>${d.intro ? d.intro.replace(/<p>/g, '<p class="muted small">') : ''}${body}
  ${d.links.length && !editing ? `<div class="dlinks" data-t="dlinks">이 문서가 가리키는 문서 — ${d.links.map((x) => `<span class="dlink" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(x.id)}" data-t="dlink">${esc(x.title)}</span>`).join(' · ')}</div>` : ''}</div></div>`
  return { html: main, aside: right ? null : docAside(k, d), title: d.title }
}
function recPane(t, right) {
  const k = t.kn, r = recOf(k, t.ref)
  if (!r) return { html: loadingHtml, title: tabTitle(t) }
  if (r.error) return { html: '<p class="muted">이 기록은 이제 없다 — 정리되어 다른 이름으로 남았을 수 있다</p>', title: '기록' }
  const fx = r.fixes[0], fb = r.fixedBy, who = (w) => (w === S.me.user ? '나' : w)
  const html = `<div class="docw" data-t="recPane" data-name="${esc(r.title)}">${right ? rpHead() : ''}<div class="ttl"><div class="path"><span>${esc(KN(k).name)} › ${r.log ? '이력' : '기록'} › ${esc(r.date)}</span><span class="r">${r.ingest && !r.ingest.read && !isTeam() && !right ? `<button class="btn sm" data-a="readRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="readRec"${S.reading && S.reading[r.id] ? ' disabled' : ''} title="넣은 파일을 Claude 가 읽고 무엇 · 핵심 · 정한 것 · 남은 것 + 본문으로 기록을 다시 쓴다">${S.reading && S.reading[r.id] ? 'Claude 가 읽는 중…' : 'Claude 로 기록 정리'}</button> ` : ''}${r.log ? `<span class="chip c-mute" data-t="recLog">이력 · ${esc(r.log)} — kmd 가 한 일</span>` : ''}${r.state === 'pend' ? '<span class="chip c-pend" data-t="recState">아직 문서에 안 넣은 기록</span>' : r.state === 'in' ? '<span class="chip c-mute" data-t="recState">문서에 들어감</span>' : ''}</span></div></div>
  <div class="paper"><h1>${esc(r.title)}</h1><p class="muted small">${esc(r.author)} · ${esc(r.date)}</p>${linkify(r.html, k, null)}
  ${fx ? `<div class="callout warn">이 기록은 ${esc(whenTxt(fx.date))} ${esc(who(fx.author))}의 기록을 바로잡았다 — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(fx.id)}">${esc(fx.title)}</a></div>` : ''}${fb.map((x) => `<div class="callout gray">${esc(whenTxt(x.date))} ${esc(who(x.author))}이 이 기록을 바로잡았다 — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}">${esc(x.title)}</a></div>`).join('')}
  ${r.state === 'pend' ? `<div class="callout pend">${pendWhen(k)} — 그동안도 그 항목 옆에 같이 읽힌다</div>` : ''}</div></div>`
  // 이 기록이 간 문서 — 이 기록(또는 이 기록을 넣은 정리)이 넣은 항목 · 정리 기록이면 그 정리가 넣은 기록
  const went = r.went || [], via = r.via || [], from = r.from || []
  const wentHtml = `<div class="ap" data-t="recWent"><h4>${r.log ? '이 일이 넣은 문서' : '이 기록이 간 문서'} <small data-t="recWentN">${went.length}</small></h4>${went.map((d) => `<div class="alr" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-h="${esc(d.hs[0] || '')}" data-t="wentDoc" data-pv="doc|${esc(k)}|${esc(d.id)}">${svg('doc')}<span class="nm">${esc(d.title)}<small>항목 ${d.hs.length} — ${esc(d.hs.slice(0, 3).join(' · '))}${d.hs.length > 3 ? ' …' : ''}</small></span></div>`).join('') || `<div class="muted small alr">${r.state === 'pend' ? '아직 문서에 들어가지 않았다' : '없다'}</div>`}${via.map((x) => `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}" data-t="viaRec"><span class="dt">정리</span><span class="nm">${esc(x.title.split(' — ')[0])}<small>${esc(whenTxt(x.date))} · ${esc(x.author)} 가 넣었다</small></span></div>`).join('')}${from.map((x) => `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}" data-t="fromRec"><span class="dt">기록</span><span class="nm">${esc(x.title.split(' — ')[0])}<small>이 일이 넣은 기록 · ${esc(whenTxt(x.date))} · ${esc(x.author)}</small></span></div>`).join('')}</div>`
  const aside = wentHtml + `<div class="ap" data-t="recItems"><h4>${r.log ? '이 일이 건드린 항목' : '이 기록이 건드린 항목'} <small>${r.items.length}</small></h4>${r.items.map((i) => `<div class="alr" data-a="openItem" data-k="${esc(k)}" data-n="${esc(i.coord)}" data-t="recItem" data-pv="item|${esc(k)}|${esc(i.coord)}">${svg('tag')}<span class="nm">${esc(i.name)}<small>${esc(i.docTitle ? i.docTitle : '문서가 없는 항목')}</small></span></div>`).join('') || '<div class="muted small alr">없다</div>'}</div>
  <div class="ap" data-t="recFix"><h4>바로잡은 / 바로잡힌 기록</h4>${fx ? `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(fx.id)}" data-t="fixRow"><span class="dt">${esc(whenTxt(fx.date).replace(/^(오늘|어제) /, ''))}</span><span class="nm">바로잡음 — ${esc(fx.title)}</span></div>` : ''}${fb.map((x) => `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}" data-t="fixRow"><span class="dt">${esc(whenTxt(x.date).replace(/^(오늘|어제) /, ''))}</span><span class="nm">바로잡힘 — ${esc(x.title)}</span></div>`).join('')}${fx || fb.length ? '' : '<div class="muted small alr">없다</div>'}</div>
  ${nbGraph(k, 'r:' + r.id)}`
  return { html, aside: right ? null : aside, title: r.title.split(' — ')[0] }
}
const extOf = (n) => { const m = String(n).toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : '' }
function attPane(t, right) {
  const ext = extOf(t.ref), img = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
  return {
    html: `<div class="docw" data-t="attPane">${right ? rpHead() : ''}<div class="ttl"><div class="path"><span>${esc(KN(t.kn).name)} › 첨부 › ${esc(t.ref)}</span></div></div><div class="paper"><h1>${esc(t.ref)}</h1>${img ? `<img data-att="${esc(t.ref)}" data-ak="${esc(t.kn)}" alt="${esc(t.ref)}" style="max-width:100%;margin-top:10px;border:1px solid var(--border);border-radius:8px">` : `<div class="attph">${esc(ext)} 첨부 — 원본 그대로 둔다</div>`}</div></div>`,
    aside: right ? null : `<div class="ap"><h4>속성</h4><div class="kv"><span>종류</span><span>${esc(ext)}</span><span>자리</span><span>첨부</span></div></div>`,
    title: t.ref,
  }
}

// ── 빨리 열기(Ctrl O) ──
function openQo() { leaveGate(); S.pal = null; S.cmd = null; S.menu = null; S.qo = { q: '', sel: 0 }; render() }
function qoList() {
  const q = (S.qo.q || '').trim(), nq = norm(q)
  const ks = S.route.kn && S.route.kn !== '*' ? [S.route.kn] : S.kns.map((x) => x.id), out = []
  ks.forEach((k) => {
    const tr = treeOf(k)
    if (!tr || tr.error) return
    const kn = KN(k).name
    tr.docs.forEach((d) => out.push({ kind: 'doc', label: d.title, sub: kn + ' · 문서', k, ref: d.id }))
    itemsOf(k).forEach((i) => { if (i.table && !q) return; out.push({ kind: 'item', label: i.name, sub: kn + ' · 항목 · ' + i.kind, k, ref: i.key, alias: i.aliases }) })
    tr.records.forEach((r) => out.push({ kind: 'rec', label: r.title, sub: kn + ' · 기록 · ' + (r.state === 'pend' ? '● 아직 안 넣음' : whenTxt(r.date)), k, ref: r.id }))
  })
  if (!q) return out.filter((x) => x.kind !== 'rec').slice(0, 12)
  const ord = { doc: 0, item: 1, rec: 2 }
  const sc = (x) => { const l = norm(x.label); if (l === nq) return 0; if (l.startsWith(nq)) return 1; if (l.includes(nq)) return 2; if ((x.alias || []).some((a) => norm(a).includes(nq))) return 3; return 9 }
  return out.map((x) => Object.assign({ s: sc(x) }, x)).filter((x) => x.s < 9).sort((a, b) => a.s - b.s || ord[a.kind] - ord[b.kind]).slice(0, 30)
}
function qoBody() {
  const L = qoList()
  S.qo.list = L
  if (S.qo.sel >= L.length) S.qo.sel = Math.max(0, L.length - 1)
  if (!L.length) return '<div class="empty" data-t="qoNone"><b>이 이름으로는 없다</b>글 속 낱말은 Ctrl K 찾기로</div>'
  return L.map((x, i) => `<div class="qr${i === S.qo.sel ? ' sel' : ''}" data-a="qoPick" data-i="${i}" data-t="qoRow" data-kind="${x.kind}" data-name="${esc(x.label)}"><span class="qk">${x.kind === 'doc' ? svg('doc') : x.kind === 'item' ? svg('tag') : '<i class="pd"></i>'}</span><span class="nm">${esc(x.label)}</span><span class="r small muted">${esc(x.sub)}</span></div>`).join('') + '<div class="ft">문서 · 항목 · 기록 이름으로 연다 — ↑↓ 로 고르고 Enter · 글 속 낱말은 <b>Ctrl K</b></div>'
}
function qoHtml() { return `<div class="pscrim" data-a="qoClose" data-self="1"><div class="pal" data-t="qo"><div class="pin">${svg('search')}<input id="qoIn" data-in="qo" data-t="qoIn" value="${esc(S.qo.q)}" placeholder="빨리 열기 — 문서 · 항목 · 기록 이름" autocomplete="off"><span class="r">↑↓ · Enter · Esc</span></div><div id="qoBody">${qoBody()}</div></div></div>` }
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
    { n: '가져오기', s: '파일 · 문서 폴더 · 소스 코드 · DB', f: () => go({ scr: 'import' }) },
    { n: '새 지식', s: '이름 하나로 새 지식', f: () => openAdd() },
    { n: '나누어 보기', s: 'Ctrl \\ — 두 탭을 나란히', f: () => toggleSplit() },
    { n: '그래프 열기', s: '옆 메뉴 — 그래프 탭', f: () => setView('graph') },
    { n: '문서로 보기', s: '옆 메뉴 — 문서 탭', f: () => setView('docs') },
    { n: '항목으로 보기', s: '옆 메뉴 — 항목 탭', f: () => setView('items') },
    { n: '빨리 열기', s: 'Ctrl O', f: () => openQo() },
    { n: '찾기', s: 'Ctrl K', f: () => openPal() },
    { n: '이력', s: '모든 지식에서 바뀐 것 · 확인할 것', f: () => go({ scr: 'today' }) },
    { n: '지식 보내기', s: '바뀐 것 · 지식에서 골라', f: () => go({ scr: 'send' }) },
    { n: '설정', s: '', f: () => go({ scr: 'settings' }) },
    { n: '지식 목록', s: '전체', f: () => go({ scr: 'home', kn: '*' }) },
    { n: '탭 닫기', s: '지금 탭', f: () => { if (S.active) closeTab(S.active); render() } },
    { n: '이전으로', s: 'Alt ←', f: () => histGo(-1) },
    { n: '다음으로', s: 'Alt →', f: () => histGo(1) },
  ]
}
function cmdList() { const nq = norm(S.cmd.q || ''); return cmdDefs().filter((c) => !nq || norm(c.n).includes(nq)) }
function cmdBody() {
  const L = cmdList()
  S.cmd.list = L
  if (S.cmd.sel >= L.length) S.cmd.sel = Math.max(0, L.length - 1)
  if (!L.length) return '<div class="empty" data-t="cmdNone"><b>그런 명령은 없다</b>다른 말로 — 예: 그래프 · 나누어</div>'
  return L.map((c, i) => `<div class="qr${i === S.cmd.sel ? ' sel' : ''}" data-a="cmdPick" data-i="${i}" data-t="cmdRow" data-name="${esc(c.n)}"><span class="qk">›</span><span class="nm">${esc(c.n)}</span><span class="r small muted">${esc(c.s)}</span></div>`).join('')
}
function cmdHtml() { return `<div class="pscrim" data-a="cmdClose" data-self="1"><div class="pal" data-t="cmd"><div class="pin"><span class="qk">›</span><input id="cmdIn" data-in="cmd" data-t="cmdIn" value="${esc(S.cmd.q)}" placeholder="명령 창 — 화면의 일을 이름으로" autocomplete="off"><span class="r">↑↓ · Enter · Esc</span></div><div id="cmdBody">${cmdBody()}</div></div></div>` }
function cmdPick(i) { const c = S.cmd && S.cmd.list && S.cmd.list[i]; S.cmd = null; render(); if (c) c.f() }

// ── 찾기(Ctrl K) ──
function scopeKn() { const k = S.route.kn; return k && k !== '*' && KN(k) && KNSCR.includes(S.route.scr) ? k : null }
function openPal(q) { leaveGate(); S.qo = null; S.cmd = null; S.menu = null; S.pal = { q: q || '', res: null }; render(); if (q) runFind() }
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
    } catch (e) { if (S.pal) { S.pal.res = { error: e.message }; paintPal() } }
  }, 120)
}
function paintPal() { const b = $('#palBody'); if (b) b.innerHTML = palBody() }
function palHtml() {
  const k = scopeKn(), where = k ? KN(k).name + '에서' : '지식 전체에서'
  return `<div class="pscrim" data-a="palClose" data-self="1"><div class="pal" data-t="pal"><div class="pin">${svg('search')}<input id="palIn" data-in="pal" data-t="palIn" value="${esc(S.pal.q || '')}" placeholder="찾기" autocomplete="off"><span class="r">${esc(where)} · Esc</span></div><div id="palBody">${palBody()}</div></div></div>`
}
function snip(b, toks) { let h = esc(String(b)); (toks || []).forEach((x) => { if (x) h = h.split(esc(x)).join('<mark>' + esc(x) + '</mark>') }); return h }
function nameHits(q) {
  const nq = norm(q)
  if (!nq) return []
  const out = []
  const ks = scopeKn() ? [scopeKn()] : S.kns.map((x) => x.id)
  for (const k of ks) {
    const tr = treeOf(k)
    if (!tr || tr.error) continue
    for (const d of tr.docs) { const l = norm(d.title), l2 = norm(d.id); if (l === nq || l2 === nq || l.startsWith(nq) || l2.startsWith(nq)) out.push({ kind: 'doc', k, ref: d.id, label: d.title, s: l === nq || l2 === nq ? 0 : 1 }) }
    for (const i of itemsOf(k)) { const l = norm(i.name); if (l === nq || l.startsWith(nq)) out.push({ kind: 'item', k, ref: i.key, label: i.name, s: l === nq ? 0 : 1 }) }
  }
  return out.sort((a, b) => a.s - b.s).slice(0, 5)
}
function palBody() {
  const r = S.pal.res
  if (!S.pal.q.trim() || !r) return '<div class="tip">문서의 항목 이름이나 낱말을 친다 — 예: 헬스 체크 · 상태 점검</div>'
  if (r.error) return `<div class="empty"><b>${esc(r.error)}</b></div>`
  const nh = nameHits(S.pal.q.trim())
  const names = nh.length ? `<div class="g" data-t="gName">이름이 맞는 것</div>${nh.map((x) => `<div class="hit" data-a="palName" data-kind="${x.kind}" data-k="${esc(x.k)}" data-v="${esc(x.ref)}" data-t="nameHit"><div class="ht"><b>${esc(x.label)}</b><span class="tg">${x.kind === 'doc' ? '문서' : '항목'}</span><span class="r">${esc((KN(x.k) || {}).name || '')}</span></div></div>`).join('')}` : ''
  if (!r.hits.length && names) return names
  if (!r.hits.length) return '<div class="empty" data-t="none"><b>이 말로는 못 찾았다 — 없다는 뜻은 아니다</b>다른 이름이나 문서 목록으로<br><a data-a="palDocs">문서 목록 ›</a><a data-a="palQo" data-t="palQo">빨리 열기로 이름 찾기 ›</a><a data-a="palClear">다른 말로 다시 ›</a></div>'
  const hit = (x, i) => {
    const tags = (x.alias && x.exact ? '<span class="tg nm">다른 이름</span>' : '') + (x.r ? '<span class="tg">기록</span>' : '')
    const at = x.r ? `data-r="${esc(x.r)}"` : `data-d="${esc(x.d)}" data-h="${esc(x.h)}"${x.coord ? ` data-c="${esc(x.coord)}"` : ''}`
    return `<div class="hit${i === 0 ? ' sel' : ''}" data-a="openHit" data-k="${esc(x.k)}" ${at} data-t="hit"><div class="ht"><b>${esc(x.title)}${x.h ? ' › ' + esc(x.h) : ''}</b>${tags}<span class="r">${esc(x.kn)}</span></div><div class="tx">${snip(x.text, r.toks)}</div></div>`
  }
  if (r.exact) return `${names}<div class="g" data-t="gExact">문서의 항목</div>${r.hits.map(hit).join('')}`
  const N = r.hits.length, more = S.pal.more, sh = more ? r.hits : r.hits.slice(0, 5)
  return `${names}<div class="g" data-t="gSim">딱 맞는 항목이 없어 비슷한 글에서 찾았다</div>${sh.map(hit).join('')}<div class="ft" data-t="simCount">비슷한 글 ${N}개${N > 5 ? (more ? ' — 모두 보인다' : ` — 5개 · <a data-a="palMore" data-t="palMore">${N - 5}개 더 보기</a>`) : ''}</div>`
}

// ───────────── 지식 한 벌의 모양 — 항목 · 기록 · 쓰는 곳(서버 /model) ─────────────
const modelOf = (k) => need('model:' + k, `/api/k/${encodeURIComponent(k)}/model`)
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
  }
  return m
}
const itemsOf = (k) => (M(k) ? M(k).items : [])
const itemByKey = (k, key) => (M(k) ? M(k).byKey.get(key) || null : null)
const recsOfItem = (k, i) => (i && M(k) ? M(k).recsByItem.get(i.key) || [] : [])
const itemPend = (k, i) => recsOfItem(k, i).filter((r) => r.state === 'pend')
const usesOf = (k, i) => ((M(k) && M(k).uses[i.key]) || []).map((x) => itemByKey(k, x)).filter(Boolean)
const firstLine = (k, i) => i.first || (recsOfItem(k, i)[0] ? recsOfItem(k, i)[0].title : '아직 글이 없다')
const recDt = (d) => (isToday(d) ? hhmm(d) : whenTxt(d))
function coItems(k, it) {
  const c = {}
  recsOfItem(k, it).forEach((r) => r.items.forEach((o) => { if (o !== it.key) c[o] = (c[o] || 0) + 1 }))
  return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => ({ it: itemByKey(k, key), n })).filter((x) => x.it)
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
// 글 속 항목 이름 → 항목 링크(이름 · 다른 이름 · 2자 이상 · 테이블과 자기 자신은 빼고) — 링크(<a>) 안은 건드리지 않는다
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
  let inA = 0
  return h.split(/(<[^>]+>)/).map((p) => {
    if (p.charAt(0) === '<') {
      if (/^<a[\s>]/i.test(p)) inA++
      else if (/^<\/a>/i.test(p)) inA = Math.max(0, inA - 1)
      return p
    }
    if (inA) return p
    return p.replace(m._lre, (x) => { const key = m._lrev[x]; return key && key !== self ? `<span class="ilink" data-a="openItem" data-k="${esc(k)}" data-n="${esc(key)}" data-pv="item|${esc(k)}|${esc(key)}">${x}</span>` : x })
  }).join('')
}

// ───────────── 보기 둘 — 항목으로 보기(목업 M6) ─────────────
const IFL = [['pend', '아직 안 넣은 것'], ['recent', '최근 바뀐 것'], ['mine', '내가 쓴 것']]
const KINDS = ['화면', '절차', '테이블', 'API', '용어']
function viewItems() {
  const k = pickKn()
  if (!k) return { crumb: '항목으로 보기', tabs: true, main: viewHome().main }
  const c = centerOf(() => ({ main: itemsEmpty(k), aside: knAside(k) }))
  return { crumb: '항목으로 보기' + (c.title ? ' › ' + c.title : ''), main: c.main, aside: c.aside, right: c.right, tabs: true, left: itemListHtml(k) }
}
function itemListHtml(k) {
  if (!M(k)) return `<div class="ilist" data-t="itemList">${loadingHtml}</div>`
  return `<div class="ilist" data-t="itemList"><input class="inp" id="itemQ" data-in="itemQ" data-t="itemQ" value="${esc(S.iq)}" placeholder="항목 찾기 — 이름 · 다른 이름" autocomplete="off"><div class="fcs">${IFL.map(([v, l]) => `<span class="fc${S.ifilt[v] ? ' on' : ''}" data-a="itemFilt" data-v="${v}" data-t="if-${v}">${l}</span>`).join('')}</div><div id="itemListBody">${itemListBody(k)}</div></div>`
}
function itemRecent(k, i) {
  const cut = Date.now() - 3 * 864e5
  return recsOfItem(k, i).some((r) => r.state === 'pend' || (stampDate(r.date) || 0) >= cut)
}
const itemMine = (k, i) => recsOfItem(k, i).some((r) => r.author === S.me.user)
function kindFolded(k, kd) { return S.kfold[kd] !== undefined ? S.kfold[kd] : kd === '테이블' && itemsOf(k).filter((i) => i.kind === kd).length > 40 }
function itemListBody(k) {
  const q = S.iq.trim(), nq = norm(q), f = S.ifilt
  const its = itemsOf(k).filter((i) => (!f.pend || itemPend(k, i).length) && (!f.recent || itemRecent(k, i)) && (!f.mine || itemMine(k, i)))
  const hits = q ? its.filter((i) => norm(i.name).includes(nq) || i.aliases.some((a) => norm(a).includes(nq))) : its
  if (q && !hits.length) {
    const toks = q.split(/\s+/).filter(Boolean)
    const like = its.filter((i) => toks.some((t) => (i.first || '').includes(t))).slice(0, 8)
    return like.length ? `<div class="ig" data-t="itemSim">이름이 맞는 항목이 없다 — 비슷한 항목</div>${like.map((i) => itemRowHtml(k, i)).join('')}` : '<div class="empty2" data-t="itemNone"><b>이 말로는 못 찾았다 — 없다는 뜻은 아니다</b>다른 이름으로 · 또는 Ctrl K 찾기</div>'
  }
  let h = ''
  const kinds = [...KINDS, ...new Set(hits.map((i) => i.kind).filter((x) => !KINDS.includes(x)))]
  kinds.forEach((kd) => {
    const g = hits.filter((i) => i.kind === kd)
    if (!g.length) return
    const folded = q ? false : kindFolded(k, kd)
    h += `<div class="tf" data-a="foldKind" data-v="${esc(kd)}" data-t="kind-${esc(kd)}"><span class="ar">${folded ? '▸' : '▾'}</span>${esc(kd)}<span class="cnt">${g.length}</span></div>`
    if (folded) return
    const show = !S.tablesAll && g.length > 30 ? g.slice(0, 30) : g
    h += show.map((i) => itemRowHtml(k, i)).join('')
    if (show.length < g.length) h += `<div class="tn more" data-a="moreTables" data-t="moreTables">${g.length - show.length}개 더</div>`
  })
  return h || '<div class="muted small" style="padding:8px">이 거름에 맞는 항목이 없다</div>'
}
function itemRowHtml(k, i, dt) {
  const rs = recsOfItem(k, i), p = rs.filter((r) => r.state === 'pend').length
  return `<div class="tn${isAct('item', k, i.key) ? ' on' : ''}" data-a="openItem" data-k="${esc(k)}" data-n="${esc(i.key)}" data-t="${dt || 'itemRow'}" data-name="${esc(i.name)}" data-pv="item|${esc(k)}|${esc(i.key)}"><span class="nm">${esc(i.name)}</span>${p ? '<i class="pd" title="아직 문서에 안 넣은 기록"></i>' : ''}${!i.doc ? '<small class="nd">문서 없음</small>' : ''}${rs.length ? `<span class="rc" title="기록">${rs.length}</span>` : ''}</div>`
}
function itemsEmpty(k) {
  const its = itemsOf(k)
  const kinds = [...KINDS, ...new Set(its.map((i) => i.kind).filter((x) => !KINDS.includes(x)))]
  const by = kinds.map((kd) => [kd, its.filter((i) => i.kind === kd).length]).filter((x) => x[1])
  const pend = its.filter((i) => itemPend(k, i).length)
  return `<div style="max-width:760px"><div class="big">${esc(KN(k).name)} — 항목</div><p class="lead">항목 하나를 고르면 그 항목의 지금 글 · 아직 문서에 안 넣은 기록 · 지난 기록이 한 화면에 모인다.</p><div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:12px">${by.map(([kd, n]) => `<span class="kn">${esc(kd)} ${n}</span>`).join('')}</div>${waitHtml(k, treeOf(k))}
  ${pend.length ? `<div class="card"><div class="ch">아직 문서에 안 넣은 기록이 있는 항목 <span class="chip c-pend">${pend.length}</span></div><div class="cb" style="padding:6px 8px">${pend.map((i) => itemRowHtml(k, i, 'pendItem')).join('')}</div></div>` : ''}</div>`
}
const itemOf = (k, key) => need(`item:${k}:${key}`, `/api/k/${encodeURIComponent(k)}/item?key=${encodeURIComponent(key)}`)
function itemPane(t, right) {
  const k = t.kn, it = itemByKey(k, t.ref)
  if (!M(k)) return { html: loadingHtml, title: tabTitle(t) }
  if (!it) return { html: '<p class="muted">이 항목은 이제 없다</p>', title: t.ref }
  const v = it.doc ? itemOf(k, it.key) : null
  const d = it.doc && M(k).docById.get(it.doc)
  const rs = recsOfItem(k, it), pend = rs.filter((r) => r.state === 'pend')
  const all = M(k).recs
  const past = rs.filter((r) => r.state !== 'pend').slice().sort((a, b) => (b.fixes.length ? 1 : 0) - (a.fixes.length ? 1 : 0) || b.date.localeCompare(a.date))
  const uses = usesOf(k, it), al = it.aliases
  const who = (w) => (w === S.me.user ? '나' : w)
  const li = (r, cls) => `<li class="${cls || ''}" data-a="openRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="${cls === 'pend' ? 'itemPendRow' : 'itemHistRow'}" data-pv="rec|${esc(k)}|${esc(r.id)}"><span class="dt">${esc(recDt(r.date))}</span><span class="tx"><b>${esc(r.title)}</b>${r.fixes.length ? ' <span class="chip c-warn">바로잡음</span>' : ''}${all.some((x) => x.fixes.includes(r.id)) ? ' <span class="chip c-mute">바로잡힘</span>' : ''}<small>${esc(who(r.author))} · ${esc(r.body || '')}</small></span></li>`
  let now
  if (it.doc && !v) now = loadingHtml
  else if (v && v.html != null) now = `<div class="paper ip">${linkify(v.html, k, it.key)}${v.by && isToday(v.by.date) ? `<div class="hc"><span class="hchip">${esc(whenTxt(v.by.date))} 넣음 — ${esc(who(v.by.author))}의 기록에서</span></div>` : ''}</div>`
  else if (d) now = `<div class="callout gray">문서 ${esc(d.title)} 에서 이 항목의 글이 빠졌다 — 다음 정리 때 kmd 가 자리를 다시 찾는다</div>`
  else now = `<div class="callout gray" data-t="noDoc">아직 문서에 없다 — 기록 ${rs.length} 이 같이 읽힌다</div><div class="paper ip">${rs.map((r) => `<p><b>${esc(recDt(r.date))} ${esc(who(r.author))}</b> — ${esc(r.title)}. ${esc(r.body)}</p>`).join('') || '<p class="muted">기록도 아직 없다</p>'}</div>`
  const html = `<div class="docw" data-t="itemPage" data-name="${esc(it.name)}">${right ? rpHead() : ''}
  <div class="ih"><span class="kt src">${esc(it.kind)}</span><h1>${esc(it.name)}</h1>${d ? `<span class="muted small">${esc(d.title)} › ${esc(it.sec)}</span>` : '<span class="chip c-mute">문서 없음</span>'}${al.length ? `<span class="r small muted">다른 이름: ${al.map(esc).join(' · ')}</span>` : ''}</div>
  <section class="isec" data-t="itemNow"><h3>지금${d ? ` <small>— ${esc(d.title)} 안의 그 부분</small>` : ''}${d && !right ? `<button class="btn pri sm r" data-a="itemToDoc" data-k="${esc(k)}" data-n="${esc(it.key)}" data-t="itemToDoc">문서로 보기에서 열기</button>` : ''}</h3>${now}</section>
  <section class="isec" data-t="itemPend"><h3>아직 문서에 안 넣은 기록 <span class="chip c-pend" data-t="itemPendN">${pend.length}</span></h3>${pend.length ? `<ul class="rl">${pend.map((r) => li(r, 'pend')).join('')}</ul>` : '<p class="muted small">없다 — 모두 문서에 들어갔다</p>'}</section>
  <section class="isec" data-t="itemHist"><h3>지난 기록 <small>이력 · 바로잡은 것 위</small> <span class="chip c-mute" data-t="itemHistN">${past.length}</span></h3>${past.length ? `<ul class="rl">${past.map((r) => li(r)).join('')}</ul>` : '<p class="muted small">없다</p>'}</section>
  <section class="isec" data-t="itemUses"><h3>이 항목을 쓰는 곳 <span class="chip c-mute">${uses.length}</span></h3>${uses.length ? `<ul class="rl">${uses.map((u) => `<li data-a="openItem" data-k="${esc(k)}" data-n="${esc(u.key)}" data-t="useRow" data-pv="item|${esc(k)}|${esc(u.key)}"><span class="tx"><b>${esc(u.doc ? (M(k).docById.get(u.doc) || {}).title || u.doc : '')} › ${esc(u.name)}</b><small>${esc(firstLine(k, u))}</small></span></li>`).join('')}</ul>` : '<p class="muted small">없다</p>'}</section>
  <section class="isec" data-t="itemAlias"><h3>다른 이름</h3>${al.length ? al.map((a) => `<span class="kn">${esc(a)}</span>`).join(' ') : '<p class="muted small">없다 — 같은 말로 이틀 찾으면 저절로 붙는다</p>'}</section></div>`
  const co = coItems(k, it)
  const aside = `<div class="ap" data-t="coItems"><h4>같이 나오는 항목 <small>같은 기록이 함께 건드린 것</small></h4>${co.length ? co.map((c) => `<div class="alr" data-a="openItem" data-k="${esc(k)}" data-n="${esc(c.it.key)}" data-t="coItem" data-pv="item|${esc(k)}|${esc(c.it.key)}">${svg('tag')}<span class="nm">${esc(c.it.name)}</span><span class="rc">${c.n}</span></div>`).join('') : '<div class="muted small alr">없다</div>'}</div>
  <div class="ap"><h4>들어 있는 문서</h4>${d ? `<div class="alr" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-h="${esc(it.sec)}" data-t="inDoc" data-pv="doc|${esc(k)}|${esc(d.id)}">${svg('doc')}<span class="nm">${esc(d.title)}</span></div>` : '<div class="muted small alr">아직 없다 — 정리 때 kmd 가 자리를 찾는다</div>'}</div>
  ${nbGraph(k, 'i:' + it.key)}`
  return { html, aside: right ? null : aside, title: it.name }
}

// ───────────── 보기 셋 — 그래프(2D · 손으로 쓴 힘 배치 · 바깥 라이브러리 없음 · 목업 M7) ─────────────
const KCOL = { item: '#3358e6', bundle: '#3358e6', doc: '#7a8494', rec: '#8b6fe0', src: '#2f8f5b' }
const KLAB = { item: '항목', bundle: '항목 묶음', doc: '문서', rec: '기록', src: '가져오는 곳' }
const ELAB = [['in', '들어 있다', '문서 ⊃ 항목'], ['touch', '건드렸다', '기록 → 항목'], ['fix', '바로잡았다', '기록 → 기록'], ['point', '가리킨다', '문서 → 문서 · 글 속 다른 항목 이름'], ['fill', '채운다', '가져오는 곳 → 항목']]
let CURG = null
function graphData(k, fo, bundle) {
  const f = fo || S.g.f, B = bundle === undefined ? S.g.bundle : bundle
  const m = M(k)
  if (!m) return { nodes: [], edges: [] }
  const its = m.items, ds = m.docs, rs = m.recs, srcs = m.sources || []
  const N = [], has = {}
  const add = (id, kind, label, x) => { N.push(Object.assign({ id, kind, label }, x || {})); has[id] = 1 }
  const pendI = new Set()
  rs.filter((r) => r.state === 'pend').forEach((r) => r.items.forEach((i) => pendI.add(i)))
  const tr = treeOf(k)
  const pendD = new Set(tr && tr.docs ? tr.docs.filter((d) => d.pend).map((d) => d.id) : [])
  const tables = its.filter((i) => i.table)
  const iid = (i) => (i.table && !B ? 'b:table' : 'i:' + i.key)
  if (f.item) {
    its.filter((i) => !i.table).forEach((i) => add('i:' + i.key, 'item', i.name, { pend: pendI.has(i.key) }))
    if (tables.length) { if (B) tables.forEach((i) => add('i:' + i.key, 'item', i.name, { table: true, pend: pendI.has(i.key) })); else add('b:table', 'bundle', '테이블 ' + tables.length, { n: tables.length }) }
  }
  if (f.doc) ds.forEach((d) => add('d:' + d.id, 'doc', d.title, { pend: pendD.has(d.id) }))
  const cut = Date.now() - 30 * 864e5
  if (f.rec) rs.forEach((r) => { if (f.recent && (stampDate(r.date) || 0) < cut) return; add('r:' + r.id, 'rec', r.title.split(' — ')[0], { pend: r.state === 'pend' }) })
  if (f.src) srcs.forEach((s) => add('s:' + s.id, 'src', s.name))
  const E = [], seen = new Set()
  const edge = (a, b, t) => { const key = a + '>' + b + '>' + t; if (has[a] && has[b] && a !== b && !seen.has(key)) { seen.add(key); E.push({ a, b, t }) } }
  its.forEach((i) => { if (i.doc) edge('d:' + i.doc, iid(i), 'in') })
  rs.forEach((r) => { r.items.forEach((key) => { const i = m.byKey.get(key); if (i) edge('r:' + r.id, iid(i), 'touch') }); r.fixes.forEach((x) => edge('r:' + r.id, 'r:' + x, 'fix')) })
  ds.forEach((d) => d.links.forEach((b) => edge('d:' + d.id, 'd:' + b, 'point')))
  its.filter((i) => !i.table).forEach((i) => usesOf(k, i).forEach((u) => edge('i:' + u.key, 'i:' + i.key, 'point')))
  srcs.forEach((s) => s.items.forEach((key) => { const i = m.byKey.get(key); if (i) edge('s:' + s.id, iid(i), 'fill') }))
  let nodes = N
  if (f.pend) nodes = nodes.filter((n) => n.pend)
  let ids = new Set(nodes.map((n) => n.id))
  let edges = E.filter((e) => ids.has(e.a) && ids.has(e.b))
  const sel = fo ? null : S.g.sel
  if (f.depth && sel && ids.has(sel)) {
    const keep = new Set([sel])
    let front = [sel]
    for (let d = 0; d < f.depth; d++) { const nx = []; edges.forEach((e) => { if (front.includes(e.a) && !keep.has(e.b)) { keep.add(e.b); nx.push(e.b) } if (front.includes(e.b) && !keep.has(e.a)) { keep.add(e.a); nx.push(e.a) } }); front = nx }
    nodes = nodes.filter((n) => keep.has(n.id)); ids = keep; edges = edges.filter((e) => keep.has(e.a) && keep.has(e.b))
  }
  if (f.orph) { const deg = {}; edges.forEach((e) => { deg[e.a] = 1; deg[e.b] = 1 }); nodes = nodes.filter((n) => deg[n.id] || n.id === sel) }
  return { nodes, edges }
}
function hashf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return ((h >>> 0) % 10007) / 10007 }
function simTick(G, alpha, pin) {
  const ns = G.nodes, P = S.g.pos, n = ns.length
  for (let i = 0; i < n; i++) { const a = P[ns[i].id]; for (let j = i + 1; j < n; j++) { const b = P[ns[j].id]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy; if (d2 > 90000) continue; if (d2 < 1) { dx = hashf(i + '/' + j) - 0.5; dy = hashf(j + '/' + i) - 0.5; d2 = 1 } const d = Math.sqrt(d2), f = (3200 * alpha) / d2; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f } }
  G.edges.forEach((e) => { const a = P[e.a], b = P[e.b]; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const L = e.t === 'in' ? 48 : 66; const f = (d - L) * 0.045 * alpha; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f })
  ns.forEach((nd) => { const p = P[nd.id]; p.vx -= p.x * 0.006 * alpha; p.vy -= p.y * 0.01 * alpha; if (p.fx || nd.id === pin) { p.vx = 0; p.vy = 0; return } p.vx *= 0.55; p.vy *= 0.55; const m = Math.hypot(p.vx, p.vy); if (m > 24) { p.vx *= 24 / m; p.vy *= 24 / m } p.x += p.vx; p.y += p.vy })
}
function layoutGraph(G) {
  const P = S.g.pos, fresh = G.nodes.filter((n) => !P[n.id])
  fresh.forEach((n) => {
    const e = G.edges.find((e) => (e.a === n.id && P[e.b]) || (e.b === n.id && P[e.a]))
    const o = e ? P[e.a === n.id ? e.b : e.a] : n.table && P['b:table']
    const r1 = hashf(n.id), r2 = hashf(n.id + '#')
    if (o) P[n.id] = { x: o.x + (r1 - 0.5) * 70, y: o.y + (r2 - 0.5) * 70, vx: 0, vy: 0 }
    else { const a = r1 * Math.PI * 2, R = 40 + r2 * 240; P[n.id] = { x: Math.cos(a) * R, y: Math.sin(a) * R * 0.65, vx: 0, vy: 0 } }
  })
  const key = G.nodes.map((n) => n.id).join('|') + '#' + G.edges.length
  if (key !== S.g.layoutKey) { S.g.layoutKey = key; const big = fresh.length > G.nodes.length / 2; const it = G.nodes.length > 400 ? 60 : big ? 300 : 120; for (let i = 0; i < it; i++) simTick(G, 1 - (i / it) * 0.85); fitView(G) }
}
function fitView(G) {
  if (!G || !G.nodes.length) return
  const P = S.g.pos
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  G.nodes.forEach((n) => { const p = P[n.id]; if (!p) return; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + 50); y1 = Math.max(y1, p.y) })
  const k = Math.max(0.3, Math.min(1.6, 660 / (x1 - x0 + 40), 440 / (y1 - y0 + 40)))
  S.g.view = { x: (-(x0 + x1) / 2) * k, y: (-(y0 + y1) / 2) * k, k }
}
function nodeR(n, dg) { if (n.kind === 'bundle') return 15; if (n.table) return 3; if (n.kind === 'rec') return 4.5; if (n.kind === 'src') return 6.5; if (n.kind === 'doc') return 6; return 5 + Math.min(dg, 8) * 0.45 }
function graphSvg(G) {
  const P = S.g.pos, big = G.nodes.length > 90, deg = {}
  G.edges.forEach((e) => { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1 })
  const lines = G.edges.map((e, i) => { const a = P[e.a], b = P[e.b]; return `<line data-e="${i}" class="e-${e.t}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"${e.t === 'fix' || e.t === 'point' ? ` marker-end="url(#ar-${e.t})"` : ''}/>` }).join('')
  const nodes = G.nodes.map((n) => {
    const p = P[n.id], r = nodeR(n, deg[n.id] || 0)
    const cls = ['n', 'k-' + n.kind]
    if (S.g.sel === n.id) cls.push('sel')
    if (big && n.table) cls.push('nl')
    return `<g class="${cls.join(' ')}" data-node="${esc(n.id)}" data-t="gnode" data-kind="${n.kind}" data-name="${esc(n.label)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><title>${esc(KLAB[n.kind] + ' · ' + n.label)}</title>${n.pend ? `<circle class="ring" r="${(r + 3.5).toFixed(1)}"/>` : ''}<circle class="dot" r="${r.toFixed(1)}" fill="${KCOL[n.kind]}"${n.kind === 'bundle' ? ' fill-opacity=".55"' : ''}/><text x="${(r + 3).toFixed(1)}" y="3.5">${esc(n.label)}</text></g>`
  }).join('')
  const v = S.g.view
  return `<svg id="gsvg" viewBox="-340 -230 680 460" preserveAspectRatio="xMidYMid meet" data-t="gsvg"><defs>${['fix', 'point'].map((t) => `<marker id="ar-${t}" viewBox="0 0 10 10" refX="17" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="mk-${t}"/></marker>`).join('')}</defs><g id="gview" transform="translate(${v.x.toFixed(1)} ${v.y.toFixed(1)}) scale(${v.k.toFixed(3)})"><g class="edges">${lines}</g><g class="nodes">${nodes}</g></g></svg>`
}
function paintGraph() {
  const sv = $('#gsvg')
  if (!sv || !CURG) return
  const P = S.g.pos
  sv.querySelectorAll('g[data-node]').forEach((g) => { const p = P[g.dataset.node]; if (p) g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`) })
  sv.querySelectorAll('line[data-e]').forEach((l) => { const e = CURG.edges[+l.dataset.e]; if (!e) return; const a = P[e.a], b = P[e.b]; l.setAttribute('x1', a.x.toFixed(1)); l.setAttribute('y1', a.y.toFixed(1)); l.setAttribute('x2', b.x.toFixed(1)); l.setAttribute('y2', b.y.toFixed(1)) })
}
function gHighlight() {
  const sv = $('#gsvg')
  if (!sv || !CURG) return
  const nq = norm(S.g.f.q || ''), hits = new Set()
  sv.querySelectorAll('g[data-node]').forEach((g) => { const h = !!nq && norm(g.dataset.name).includes(nq); g.classList.toggle('hit', h); g.classList.toggle('dim', !!nq && !h); if (h) hits.add(g.dataset.node) })
  sv.querySelectorAll('line[data-e]').forEach((l) => { const e = CURG.edges[+l.dataset.e]; l.classList.toggle('dim', !!nq && !(e && (hits.has(e.a) || hits.has(e.b)))) })
  const c = $('[data-t=gHits]')
  if (c) c.textContent = nq ? '맞는 점 ' + hits.size : ''
}
function applyView() { const g = $('#gview'), v = S.g.view; if (g) g.setAttribute('transform', `translate(${v.x.toFixed(1)} ${v.y.toFixed(1)}) scale(${v.k.toFixed(3)})`) }
function zoomAt(p, f) { const v = S.g.view, k2 = Math.max(0.25, Math.min(4, v.k * f)), r = k2 / v.k; v.x = p.x - (p.x - v.x) * r; v.y = p.y - (p.y - v.y) * r; v.k = k2; applyView() }
function relax(pin) { let i = 0; const step = () => { if (!CURG || !$('#gsvg')) return; simTick(CURG, 0.25 * (1 - i / 30), pin); paintGraph(); if (++i < 30) requestAnimationFrame(step) }; requestAnimationFrame(step) }
function gClick(id) {
  if (id === 'b:table') { S.g.bundle = true; toast('테이블 ' + itemsOf(S.route.kn).filter((i) => i.table).length + ' 을 폈다 — 접으려면 왼쪽 「접기」'); render(); return }
  S.g.sel = id
  render()
}
function viewGraph() {
  const k = pickKn()
  if (!k) return { crumb: '그래프', main: viewHome().main }
  if (S.g.kn !== k) { S.g.kn = k; S.g.pos = {}; S.g.sel = null; S.g.layoutKey = ''; S.g.bundle = false }
  if (!M(k)) return { crumb: '그래프', main: loadingHtml, tabs: true, left: `<div class="gf">${loadingHtml}</div>` }
  const G = graphData(k)
  layoutGraph(G)
  CURG = G
  const f = S.g.f
  const main = `<div class="gwrap" data-t="graph">${graphSvg(G)}<div class="gtl small"><span data-t="gCount">점 ${G.nodes.length} · 선 ${G.edges.length}${f.depth && S.g.sel ? ' · 깊이 ' + f.depth : ''}</span> <b data-t="gHits" style="color:#9a6a00"></b></div><div class="gz"><button class="btn sm" data-a="gZoom" data-v="1.25" data-t="gZoomIn" title="크게">+</button><button class="btn sm" data-a="gZoom" data-v="0.8" data-t="gZoomOut" title="작게">−</button><button class="btn sm" data-a="gFit" data-t="gFit">처음 크기</button></div><div class="ghint small">휠 — 크게 · 작게 · 빈 곳을 끌면 옮긴다 · 점을 끌어 옮긴다</div></div>`
  return { crumb: '그래프' + (S.g.sel ? ' › ' + ((G.nodes.find((n) => n.id === S.g.sel) || {}).label || '') : ''), main, aside: graphAside(k, G), tabs: true, left: graphFilter(k), full: true }
}
function graphFilter(k) {
  const f = S.g.f, tables = itemsOf(k).filter((i) => i.table).length
  const sw = (v, l, sub) => `<div class="gr"><span class="tx">${l}${sub ? `<small>${sub}</small>` : ''}</span><button class="sw${f[v] ? ' on' : ''}" data-a="gSet" data-v="${v}" data-t="g-${v}" aria-label="${l}"></button></div>`
  const kd = (v, l) => `<div class="gr"><span class="tx"><i class="kd" style="background:${KCOL[v]}"></i>${l}</span><button class="sw${f[v] ? ' on' : ''}" data-a="gSet" data-v="${v}" data-t="gk-${v}" aria-label="${l}"></button></div>`
  return `<div class="gf" data-t="gFilter">
  <input class="inp" id="gQ" data-in="gQ" data-t="gQ" value="${esc(f.q)}" placeholder="찾기 — 맞는 점을 밝힌다" autocomplete="off">
  <div class="gh">종류</div>${kd('item', '항목')}${kd('doc', '문서')}${kd('rec', '기록')}${kd('src', '가져오는 곳')}
  <div class="gh">거름</div>${sw('pend', '아직 안 넣은 것만')}${sw('recent', '기간 — 최근 30일 기록', f.rec ? '' : '기록을 켜면 쓴다')}${sw('orph', '외톨이 숨기기')}
  <div class="gh">깊이 <small>고른 점 중심</small></div><div class="seg" data-t="gDepth">${[0, 1, 2, 3].map((d) => `<button class="${f.depth === d ? 'on' : ''}" data-a="gDepth" data-v="${d}" data-t="gd-${d}"${d && !S.g.sel ? ' disabled' : ''}>${d || '전체'}</button>`).join('')}</div>${S.g.sel ? '' : '<div class="small muted" style="margin:4px">점을 고르면 깊이를 쓴다</div>'}
  ${tables ? `<div class="gh">큰 종류</div><div class="gr"><span class="tx">테이블 ${tables}<small>${S.g.bundle ? '펴 두었다 — 점 ' + tables : '묶음 점 하나로 접어 두었다 — 누르면 편다'}</small></span>${S.g.bundle ? '<a class="lk" data-a="gBundle" data-t="gFold">접기</a>' : '<a class="lk" data-a="gBundle" data-t="gUnfold">펴기</a>'}</div>` : ''}</div>`
}
function nodeInfo(k, id) {
  const i = id.indexOf(':'), t = id.slice(0, i), ref = id.slice(i + 1), m = M(k)
  if (t === 'i') { const it = itemByKey(k, ref); if (!it) return null; const rs = recsOfItem(k, it); return { kind: it.kind, name: it.name, first: firstLine(k, it), recs: rs.length, pend: rs.filter((r) => r.state === 'pend').length, doc: it.doc ? { ref: it.doc, hl: it.sec } : null, item: it.key } }
  if (t === 'd') { const d = m.docById.get(ref); if (!d) return null; const its = d.items.map((x) => itemByKey(k, x)).filter(Boolean); const rs = m.recs.filter((r) => r.items.some((x) => d.items.includes(x))); return { kind: '항목 ' + its.length, name: d.title, first: d.first, recs: rs.length, pend: rs.filter((r) => r.state === 'pend').length, doc: { ref: d.id }, item: its[0] ? its[0].key : null } }
  if (t === 'r') { const r = m.recById.get(ref); if (!r) return null; return { kind: r.author + ' · ' + recDt(r.date), name: r.title, first: r.body, recs: 1, pend: r.state === 'pend' ? 1 : 0, doc: { rec: r.id }, item: r.items[0] || null } }
  return null
}
function graphAside(k, G) {
  const id = S.g.sel, n = id && G.nodes.find((x) => x.id === id), info = n && nodeInfo(k, id)
  const card = !info
    ? '<div class="gcard muted small" data-t="gCard">점을 누르면 여기에 — 이름 · 첫 줄 · 기록 수.<br>[문서로 보기] · [항목으로 보기] 로 연다.</div>'
    : `<div class="gcard" data-t="gCard" data-name="${esc(info.name)}"><div class="row"><i class="kd" style="background:${KCOL[n.kind]}"></i><span class="small muted">${KLAB[n.kind]}${info.kind ? ' · ' + esc(info.kind) : ''}</span><a class="r small" data-a="gUnsel" title="고르기 풀기">×</a></div><div class="gn">${esc(info.name)}</div><div class="small">${esc(info.first)}</div><div class="small muted" data-t="gCardRecs" style="margin:4px 0 10px">기록 ${info.recs}${info.pend ? ' · 아직 안 넣은 기록 ' + info.pend : ''}</div><div class="row" style="flex-wrap:wrap"><button class="btn pri sm" data-a="gOpen" data-v="docs" data-t="gOpenDocs"${info.doc ? '' : ' disabled'}>문서로 보기</button><button class="btn sm" data-a="gOpen" data-v="items" data-t="gOpenItems"${info.item ? '' : ' disabled'}>항목으로 보기</button></div></div>`
  const legend = `<div class="ap" data-t="gLegend"><h4>점 — 색</h4>${['item', 'doc', 'rec', 'src'].map((v) => `<div class="lgr"><i class="kd" style="background:${KCOL[v]}"></i>${KLAB[v]}</div>`).join('')}<div class="lgr"><i class="kd ringk"></i>아직 안 넣은 기록이 있다</div><h4 style="margin-top:10px">선</h4>${ELAB.map(([t, l, s]) => `<div class="lgr" data-t="lg-${t}"><svg class="lgl" viewBox="0 0 34 8"><line class="e-${t}" x1="1" y1="4" x2="33" y2="4"/></svg><span>${l}<small>${s}</small></span></div>`).join('')}</div>`
  return `<h4>고른 점</h4>${card}${legend}`
}
// 이웃 그래프(옆 칸 · 접힘) — 한 겹 · 누르면 그래프로
function nbGraph(k, center) { return `<details class="ap nb" data-t="nbGraph"${S.nbOpen ? ' open' : ''}><summary data-a="nbToggle">이웃 그래프 <small>한 겹 · 누르면 그래프로</small></summary>${S.nbOpen ? miniGraph(k, center) : ''}</details>` }
function miniGraph(k, c) {
  if (!M(k)) return loadingHtml
  const G = graphData(k, { q: '', item: true, doc: true, rec: true, src: true, pend: false, recent: false, orph: false, depth: 0 }, false)
  const nb = []
  G.edges.forEach((e) => { if (e.a === c && !nb.includes(e.b)) nb.push(e.b); if (e.b === c && !nb.includes(e.a)) nb.push(e.a) })
  const nm = {}
  G.nodes.forEach((n) => (nm[n.id] = n))
  const sh = nb.slice(0, 12), R = 64
  const pos = sh.map((id, i) => { const a = (i / Math.max(sh.length, 1)) * Math.PI * 2 - Math.PI / 2; return [Math.cos(a) * R, Math.sin(a) * R * 0.8] })
  const lab = (s) => esc(String(s).length > 8 ? String(s).slice(0, 8) + '…' : s)
  const cn = nm[c] || { kind: 'doc', label: '?' }
  return `<svg class="mini" viewBox="-115 -80 230 160" data-a="openGraph" data-n="${esc(c)}" data-t="miniGraph"><title>그래프에서 보기</title>${pos.map((p) => `<line x1="0" y1="0" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`).join('')}${sh.map((id, i) => `<circle cx="${pos[i][0].toFixed(1)}" cy="${pos[i][1].toFixed(1)}" r="4" fill="${KCOL[nm[id].kind]}"/><text x="${pos[i][0].toFixed(1)}" y="${(pos[i][1] + 12).toFixed(1)}" text-anchor="middle">${lab(nm[id].label)}</text>`).join('')}<circle r="7" fill="${KCOL[cn.kind]}"/><text y="-11" text-anchor="middle" class="c">${lab(cn.label)}</text></svg><div class="small muted">이웃 ${nb.length}${nb.length > 12 ? ' · 12 만 보인다' : ''}</div>`
}

// ───────────── 미리보기 카드(이름 · 링크에 마우스) ─────────────
let pvT = null
function hidePv() { clearTimeout(pvT); const h = document.getElementById('pvHost'); if (h) h.innerHTML = '' }
function pvHtml(spec) {
  const parts = String(spec).split('|'), kind = parts[0], k = parts[1], ref = parts.slice(2).join('|')
  const m = M(k)
  if (!m) return ''
  if (kind === 'item') { const it = itemByKey(k, ref); if (!it) return ''; const d = it.doc && m.docById.get(it.doc), rs = recsOfItem(k, it), p = rs.filter((r) => r.state === 'pend').length; return `<div class="pv" data-t="pv"><div class="ph"><span class="kt src">${esc(it.kind)}</span><b>${esc(it.name)}</b></div><div>${esc(firstLine(k, it))}</div><div class="pm">${d ? esc(d.title + ' › ' + it.sec) + ' · 바뀐 때 ' + esc(whenTxt(d.when)) : '아직 문서에 없다'} · 기록 ${rs.length}${p ? ' · 안 넣은 기록 ' + p : ''}</div></div>` }
  if (kind === 'doc') { const d = m.docById.get(ref); if (!d) return ''; return `<div class="pv" data-t="pv"><div class="ph">${svg('doc')}<b>${esc(d.title)}</b></div><div>${esc(d.first)}</div><div class="pm">바뀐 때 ${esc(whenTxt(d.when))} · 항목 ${d.items.length}</div></div>` }
  if (kind === 'rec') { const r = m.recById.get(ref); if (!r) return ''; return `<div class="pv" data-t="pv"><div class="ph"><i class="pd"></i><b>${esc(r.title)}</b></div><div>${esc(r.body)}</div><div class="pm">${esc(r.author)} · ${esc(recDt(r.date))}${r.state === 'pend' ? ' · 아직 문서에 안 넣은 기록' : ''}</div></div>` }
  return ''
}
function showPv(el) {
  if (!document.body.contains(el)) return
  const h = pvHtml(el.dataset.pv), host = document.getElementById('pvHost')
  if (!h || !host) return
  host.innerHTML = h
  const c = host.firstElementChild, r = el.getBoundingClientRect()
  let x = Math.min(r.left, innerWidth - 300), y = r.bottom + 6
  if (y + c.offsetHeight > innerHeight - 8) y = r.top - c.offsetHeight - 6
  c.style.left = Math.max(8, x) + 'px'
  c.style.top = Math.max(8, y) + 'px'
}
document.addEventListener('mouseover', (ev) => { const el = ev.target.closest && ev.target.closest('[data-pv]'); if (!el) return; if (ev.relatedTarget && el.contains(ev.relatedTarget)) return; clearTimeout(pvT); pvT = setTimeout(() => showPv(el), 250) })
document.addEventListener('mouseout', (ev) => { const el = ev.target.closest && ev.target.closest('[data-pv]'); if (!el) return; if (ev.relatedTarget && el.contains(ev.relatedTarget)) return; hidePv() })

// 그래프 — 점 끌기 · 빈 곳 끌어 옮기기 · 휠 확대
let GD = null
function svgPt(sv, ev, inner) { const pt = sv.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform((inner || sv).getScreenCTM().inverse()) }
document.addEventListener('pointerdown', (ev) => { const sv = ev.target.closest && ev.target.closest('#gsvg'); if (!sv || ev.button !== 0) return; const nd = ev.target.closest('[data-node]'); GD = { sv, node: nd ? nd.dataset.node : null, sx: ev.clientX, sy: ev.clientY, moved: false, vx: S.g.view.x, vy: S.g.view.y }; if (!nd) sv.style.cursor = 'grabbing'; ev.preventDefault() })
document.addEventListener('pointermove', (ev) => {
  if (!GD) return
  const dx = ev.clientX - GD.sx, dy = ev.clientY - GD.sy
  if (!GD.moved && Math.hypot(dx, dy) < 4) return
  GD.moved = true
  if (GD.node) { const p = svgPt(GD.sv, ev, $('#gview')), q = S.g.pos[GD.node]; if (q) { q.x = p.x; q.y = p.y; q.vx = 0; q.vy = 0; paintGraph() } }
  else { const a = svgPt(GD.sv, { clientX: GD.sx, clientY: GD.sy }), b = svgPt(GD.sv, ev); S.g.view.x = GD.vx + (b.x - a.x); S.g.view.y = GD.vy + (b.y - a.y); applyView() }
})
document.addEventListener('pointerup', () => { if (!GD) return; const g = GD; GD = null; g.sv.style.cursor = ''; if (g.moved) { if (g.node) relax(g.node); return } if (g.node) gClick(g.node) })
document.addEventListener('wheel', (ev) => { const sv = ev.target.closest && ev.target.closest('#gsvg'); if (!sv) return; ev.preventDefault(); zoomAt(svgPt(sv, ev), Math.exp(-ev.deltaY * 0.0015)) }, { passive: false })

// ───────────── 고치기 저장 — 글을 항목으로 다시 갈라 바뀐 항목만 보낸다 ─────────────
function forgetKn(k) { for (const key of Object.keys(S.cache)) if (key.startsWith(`tree:${k}`) || key.startsWith(`doc:${k}:`) || key.startsWith(`rec:${k}:`) || key.startsWith(`model:${k}`) || key.startsWith(`item:${k}:`)) delete S.cache[key] }
// 편집기 글 — 쓰던 글(S.edit.text)이 있으면 그것 · 없으면 서버의 글. 다시 그려도 · 찾기 · 다른 화면에 갔다 와도 그대로
const edOrig = (d) => d.sections.map((s) => '## ' + s.h + '\n' + s.md).join('\n\n')
function edText(d) {
  if (S.edit.orig == null) S.edit.orig = edOrig(d)
  return S.edit.text != null ? S.edit.text : S.edit.orig
}
const edKey = (e) => `kmdDraft:${e.kn}|${e.doc}`
const edDirty = () => !!S.edit && S.edit.text != null && S.edit.text !== S.edit.orig
function edDrop() { if (S.edit) { try { sessionStorage.removeItem(edKey(S.edit)) } catch {} } S.edit = null }
// 고치는 중인 글을 버리는 길(그만두기 · 탭 닫기 · 지식 지우기 …) — 바뀐 글이 있으면 묻는다
function edLeave(what) { return !edDirty() || confirm(`저장하지 않은 글이 있다 — ${what}면 버린다`) }
window.addEventListener('beforeunload', (ev) => { if (edDirty()) { ev.preventDefault(); ev.returnValue = '' } })
async function saveDoc() {
  const e = S.edit
  if (!e || e.busy) return
  const d = S.cache[`doc:${e.kn}:${e.doc}`]
  const txt = e.text != null ? e.text : $('#edTx').value
  const parts = []
  let cur = null
  txt.split('\n').forEach((line) => {
    const m = line.match(/^##\s+(.+)$/)
    if (m) { cur = { h: m[1].trim(), b: [] }; parts.push(cur) } else { if (!cur) { cur = { h: '머리말', b: [] }; parts.push(cur) } cur.b.push(line) }
  })
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
  if (!changed.length && !remove.length && !rename.length) { edDrop(); toast('바뀐 글이 없다 — 그대로 두었다'); render(); return }
  if ((remove.length || rename.length) && !confirm([remove.length ? `지울 항목 ${remove.length} — ${remove.join(' · ')}` : '', rename.length ? `이름 바꿀 항목 ${rename.length} — ${rename.map((x) => x.from + ' → ' + x.to).join(' · ')}` : '', changed.length ? `고친 항목 ${changed.length}` : ''].filter(Boolean).join('\n') + '\n\n이대로 저장한다')) return
  e.busy = true
  render()
  try {
    const r = await postJSON(`/api/k/${encodeURIComponent(e.kn)}/edit`, { doc: e.doc, sections: changed.map((p) => ({ h: p.h, body: p.body, ...(old.has(p.h) ? { base: old.get(p.h).base } : {}) })), remove, rename })
    edDrop()
    forgetKn(e.kn)
    toast(r.direct ? '저장했다 — 문서에도 넣었다' : '기록했다 — ' + pendWhen(e.kn) + ' · 그동안도 문서 옆에 같이 읽힌다', 7000)
  } catch (err) {
    e.busy = false
    if (err.code !== 'E_CANCEL') toast(esc(err.message), 7000)
  }
  render()
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
  if (!list.length) return '<div class="diff"><div class="ln2">바뀐 글이 없다</div></div>'
  return list.map((x) => `<div class="diff"><div class="fh">${esc(label || x.title + ' › ' + x.heading)}</div>${String(x.before || '').split('\n').filter((l) => l.trim()).map((l) => `<div class="ln2 del">${esc(l)}</div>`).join('')}${String(x.after || '').split('\n').filter((l) => l.trim()).map((l) => `<div class="ln2 add">${esc(l)}</div>`).join('')}</div>`).join('')
}
const diffOf = (k, record) => need(`diff:${k}:${record}`, `/api/k/${encodeURIComponent(k)}/diff?record=${encodeURIComponent(record)}`)
// 이력 — 오늘 바뀐 것과 kmd 가 지식을 다룬 일을 한 흐름으로(서버가 같은 일은 한 줄로 합쳐 준다 · /api/history).
//   맨 위 「확인할 것」 — kmd 가 내 값을 바꾼 줄(되돌리기 전) · 아래는 날마다 묶은 흐름 · 갈래 · 지식으로 거른다
//   줄을 누르면 펼친다 — 비교 · 되돌리기 / 기기 끊기 / 문서 열기 / 그 일 열기
const historyOf = () => need('history', '/api/history')
const HIST_KINDS = ['확인할 것', '저장', '가져오기', '정리', '바로 고침', '보내기', '설정', '지식']
const isCheck = (x) => x.yl && !x.reverted && !x.unlinked
function dayOf(at) {
  const d = new Date(at), t = new Date()
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)
  if (d.toDateString() === t.toDateString()) return '오늘'
  if (d.toDateString() === y.toDateString()) return '어제'
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '(' + '일월화수목금토'[d.getDay()] + ')'
}
function histRow(x) {
  const open = S.openToday === x.id
  let ex = ''
  if (open) {
    ex += '<div class="open" data-t="todayOpen">'
    if (x.sub) ex += `<div class="small muted" style="margin-bottom:6px">${esc(x.sub)}</div>`
    if (x.revert) ex += `<div class="small muted">비교</div>${diffHtml(diffOf(x.kn, x.revert))}`
    if (x.revert && !x.reverted) ex += `<button class="btn sm" data-a="revertToday" data-id="${esc(x.id)}" data-t="revertBtn">되돌리기</button> <span class="small muted">그 줄만 넣기 전으로</span>`
    if (x.revert && x.reverted) ex += '<span class="chip c-mute">되돌렸다</span>'
    if (x.device) ex += x.unlinked ? '<span class="chip c-mute">끊었다</span>' : `<button class="btn sm" data-a="unlinkDev" data-id="${esc(x.id)}">끊기</button> <span class="small muted">내가 한 것이 아니면 — 그 기기의 Claude Code 는 다시 이어야 한다</span>`
    const links = []
    if (x.go) links.push(`<a class="lk" data-a="todayGo" data-id="${esc(x.id)}">문서 열기 ›</a>`)
    if (x.rec && x.kn && KN(x.kn)) links.push(`<a class="lk" data-a="openRec" data-k="${esc(x.kn)}" data-r="${esc(x.rec)}" data-t="histRec">그 일 열기 ›</a>`)
    if (links.length) ex += `<div style="margin-top:6px;display:flex;gap:12px">${links.join('')}</div>`
    ex += '</div>'
  }
  const kind = isCheck(x) ? '확인할 것' : x.kind
  return `<div class="hrow${isCheck(x) ? ' yl' : ''}${x.reverted ? ' done' : ''}" data-t="histRow" data-kind="${esc(x.kind)}" data-id="${esc(x.id)}"><div class="hl" data-a="toggleToday" data-id="${esc(x.id)}"><span class="tm">${esc(tmOf(x.at))}</span><span class="chip ${isCheck(x) ? 'c-warn' : 'c-mute'}" style="flex:none">${esc(kind)}</span><span class="tx"><b>${esc(x.title)}</b>${x.reverted ? ' <span class="chip c-mute" data-t="reverted">되돌렸다</span>' : ''}${x.sub && !open ? `<small>${esc(x.sub)}</small>` : ''}</span><span class="kn2">${esc(x.knName || '')}</span><span class="who">${esc(x.who || '')}</span><span class="act" data-t="viewBtn">${open ? '접기' : '보기'}</span></div>${ex}</div>`
}
// 팀 화면에서 내 PC 지식을 골랐을 때 — 그 지식의 이력 · 가져오기 · 지식 보내기는 내 PC 프로그램 화면의 일이다
//   (팀 화면은 내 PC 지식을 읽고 저장하는 길만 잇는다 · 팀 서버의 이력 · 가져오는 곳 · 보낼 것을 그 지식의 것처럼 보이지 않는다)
function pcOnly(title, subj, other) {
  const n = isTeam() ? KN(defaultKn()) : null
  if (!n || !n.pc) return null
  const open = S.pc && S.pc.url ? `<a class="lk r" href="${esc(S.pc.url)}/" target="_blank" rel="noopener" data-t="pcOpen">내 PC 화면 열기 ›</a>` : ''
  return { crumb: title, main: `<div style="max-width:820px"><div class="big">${esc(title)}</div><div class="callout gray stop" data-t="pcOnly"><i></i><span><b>내 PC 지식 「${esc(n.name)}」 — ${esc(subj)} 내 PC 프로그램 화면에서 한다</b> · 팀 화면은 내 PC 지식을 읽고 저장하는 것만 잇는다 · 팀 서버에는 한 조각도 가지 않는다</span>${open}</div><p class="small muted">${esc(other || '팀 지식의 ' + subj + ' 지식 고르기에서 팀 지식을 고르면 여기서 본다.')}</p></div>` }
}
function viewToday() {
  const po = pcOnly('이력', '이력은')
  if (po) return po
  const v = historyOf()
  const head = '<div class="big">이력</div><p class="lead">모든 지식에서 바뀐 것 — 내가 저장 · 가져오기 · 보내기 한 것, kmd 가 가져오고 정리한 것, 화면 · 편집기에서 바로 고친 것. 내 값이 바뀐 줄은 맨 위 「확인할 것」 에 — 마음에 들지 않으면 [보기] 에서 되돌린다.</p>'
  if (!v) return { crumb: '이력', main: `<div style="max-width:980px">${head}${loadingHtml}</div>` }
  if (v.error) return { crumb: '이력', main: `<div style="max-width:980px">${head}${errHtml(v)}</div>` }
  const f = S.logKind || '', kn = S.logKn || ''
  const pass = (x) => (!kn || x.kn === kn) && (!f || (f === '확인할 것' ? isCheck(x) : x.kind === f && !isCheck(x)))
  const rows = v.filter(pass)
  const cnt = (k) => v.filter((x) => (!kn || x.kn === kn) && (k === '확인할 것' ? isCheck(x) : x.kind === k && !isCheck(x))).length
  const chip = (val, l, n) => `<span class="${f === val ? 'on' : ''}" data-a="logKind" data-v="${esc(val)}" data-t="logKind-${esc(val || 'all')}">${l} <small class="muted">${n}</small></span>`
  const kns = [...new Map(v.filter((x) => x.kn).map((x) => [x.kn, x.knName])).entries()]
  const knSel = kns.length > 1 ? `<select class="inp" id="logKn" data-t="logKn" style="width:auto;margin-left:auto">${[['', '지식 전체'], ...kns].map(([id, n]) => `<option value="${esc(id)}"${id === kn ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''
  const kinds = HIST_KINDS.filter((k) => k === '확인할 것' || cnt(k))
  // 확인할 것은 전체에서 맨 위 카드로 · 나머지는 날마다
  const checks = !f ? rows.filter(isCheck) : []
  const flow = !f ? rows.filter((x) => !isCheck(x)) : rows
  const days = []
  for (const x of flow) { const d = dayOf(x.at); const g = days[days.length - 1]; if (g && g.d === d) g.rows.push(x); else days.push({ d, rows: [x] }) }
  const checkCard = checks.length ? `<div class="card" data-t="histCheck"><div class="ch">확인할 것 <span class="chip c-warn">${checks.length}</span><small>kmd 가 정리하며 내 기록의 값을 바꿨다 — 그 줄만 되돌릴 수 있다</small></div><div class="cb" style="padding:0">${checks.map(histRow).join('')}</div></div>` : ''
  const flowCard = `<div class="card" data-t="feed"><div class="cb" style="padding:0">${days.map((g) => `<div class="hday" data-t="histDay">${esc(g.d)}<small>${g.rows.length}</small></div>${g.rows.map(histRow).join('')}`).join('') || '<p class="muted" style="margin:12px 14px" data-t="logEmpty">아직 없다</p>'}</div><div class="cf">줄을 누르면 펼친다 · kmd 가 다룬 일은 지식의 git 에 그대로 남아 되살리기 · 백업에 같이 간다 · 나에게 온 줄은 7일 둔다</div></div>`
  const main = `<div style="max-width:980px">${head}
  ${S.stops.filter((x) => x.level === 'warn').map(stopHtml).join('')}
  <div style="display:flex;align-items:center;gap:10px;margin:0 0 12px"><div class="tabs" data-t="logKinds" style="margin:0">${chip('', '전체', v.filter((x) => !kn || x.kn === kn).length)}${kinds.map((k) => chip(k, k, cnt(k))).join('')}</div>${knSel}</div>
  ${checkCard}${flowCard}</div>`
  return { crumb: '이력', main }
}

// ───────────── 정리(목업 M12) ─────────────
const tidyOf = (k) => need('tidy:' + k, `/api/k/${encodeURIComponent(k)}/tidy`)
function tidyKn() { return defaultKn() }
function recTitle(k, id) { const tr = treeOf(k); const r = tr && tr.records && tr.records.find((x) => x.id === id); return r || { title: id, author: '', date: '' } }
function rowHtml(k, row, key) {
  const kind = row.kind === 'left' ? 'keep' : row.kind === 'touches' ? 'put' : row.kind
  const yl = kind === 'changed' && !row.reverted, dim = kind === 'keep'
  const first = recTitle(k, (row.records || [])[0])
  const who = [...new Set((row.records || []).map((id) => recTitle(k, id).author).filter(Boolean))].join(' · ') || 'kmd'
  const title = row.kind === 'touches' ? `${first.title || row.target || '기록'} — 이름을 골랐다` : first.title || row.target || '이름 바로잡음'
  const small = row.why || (first.date ? recDt(first.date) : '')
  const menu = S.menu === 'row:' + key ? `<div class="menu" style="right:0;top:28px" data-t="rowMenu"><div class="mi" data-a="cmpRow" data-id="${esc(key)}" data-t="cmpBtn">비교<small>넣기 전 · 넣은 뒤</small></div>${!dim && row.record && !row.reverted ? `<div class="mi" data-a="revertRow" data-id="${esc(key)}" data-t="revertRow">되돌리기<small>그 줄만 넣기 전으로</small></div>` : ''}</div>` : ''
  const cmp = S.cmp === key ? `<div class="cmp" data-t="cmp">${row.record ? diffHtml(diffOf(k, row.record)) : `<div class="diff"><div class="fh">${esc(row.target)}</div><div class="ln2">${esc(title)} — ${esc(small)}</div></div>`}</div>` : ''
  return `<li class="${yl ? 'yl' : ''}${dim ? ' dim' : ''}${row.reverted ? ' rv' : ''}" data-t="tidyRow" data-kind="${kind}"><span class="k">${esc(who)}</span><span class="nm">${esc(title)}<small>${esc(small)}</small></span>${kind === 'changed' ? `<span class="chip c-warn">${esc(row.from)} → ${esc(row.to)}</span>` : ''}${row.reverted ? '<span class="chip c-mute" data-t="rowReverted">되돌렸다</span>' : ''}<span class="to${dim ? ' mute' : ''}">${dim ? '넣지 않음' : '→ ' + esc(row.target)}</span><button class="kebab" data-a="menu" data-m="row:${esc(key)}" data-t="rowKebab" title="비교 · 되돌리기">⋯${menu}</button>${cmp}</li>`
}
function runHtml(k, run, ri) {
  const rows = run.rows.map((r, i) => ({ r, key: `${ri}:${i}` }))
  const put = rows.filter((x) => x.r.kind === 'put' || x.r.kind === 'touches'), chg = rows.filter((x) => x.r.kind === 'changed'), keep = rows.filter((x) => x.r.kind === 'left')
  const done = put.length + chg.length
  const grp = (t, small, list) => (list.length ? `<div class="sub">${t} ${list.length} <small>${small}</small></div><ul class="plain tl2">${list.map((x) => rowHtml(k, x.r, x.key)).join('')}</ul>` : '')
  const open = S.runOpen[`${k}:${ri}`] !== undefined ? S.runOpen[`${k}:${ri}`] : ri === 0
  return `<div class="card" data-t="run" style="overflow:visible"><div class="ch2" data-a="toggleRun" data-id="${k}:${ri}"><b>${esc(whenTxt(run.at))} ${run.auto ? 'kmd 가 ' : ''}정리한 것 ${done}</b><small>건마다 따로 저장 · 되돌리기는 줄마다 ⋯ 안에</small><span class="r">${open ? '접기' : '펼치기'}</span></div>
  ${open ? grp('넣은 것', '숫자 · 이름 모두 확인 ✓', put) + grp('값이 바뀐 것', '쓴 사람의 이력 맨 위 「확인할 것」 에 알렸다', chg) + grp('그대로 둔 것', '문서 옆에 같이 읽힌다 · 다음 정리 때 다시', keep) : ''}</div>`
}
// 팀 지식의 정리 방식 — 정해진 시각(매일 HH:MM) · 실시간(기록이 남고 조용해진 뒤) · 손으로만([지금 정리])
const TIDY_MODES = [['time', '정해진 시각', '매일 정한 때 한 번'], ['live', '실시간', '기록이 남고 5분 조용해지면 바로'], ['manual', '손으로만', '[지금 정리] 를 누를 때만']]
const modeTxt = (mode, at) => (mode === 'live' ? '실시간 — 기록이 남고 조용해지면 바로' : mode === 'manual' ? '손으로만 — [지금 정리] 를 누를 때' : '매일 ' + at)
function viewTidy() {
  const po = pcOnly('정리', '정리는', '팀 지식의 정리는 지식 고르기에서 팀 지식을 고르면 여기서 본다 — 내 PC 지식은 내 PC 프로그램이 곧바로 넣는다.')
  if (po) return po
  const k = tidyKn()
  if (!k) return { crumb: '정리', main: viewHome().main }
  const n = KN(k), t = tidyOf(k), tr = treeOf(k)
  if (!t || !tr) return { crumb: '정리', main: loadingHtml }
  if (t.error) return { crumb: '정리', main: errHtml(t) }
  const run = (S.tidyRuns || {})[k] || null
  const inbox = tr.records.filter((r) => r.state === 'pend' || r.state === 'nowhere')
  const target = (r) => { const m = M(k); const it = m && m.items.find((i) => m.recsByItem.get(i.key)?.some((x) => x.id === r.id)); return it ? (it.doc ? `${(m.docById.get(it.doc) || {}).title || it.doc} › ${it.sec}` : it.name) : '넣을 곳을 찾는다' }
  const goBox = `<div class="go" data-t="goBox"><span class="tx"><b data-t="nextTidy">${t.tidyMode === 'live' ? '실시간 — 기록이 남고 조용해지면 바로' : t.tidyMode === 'manual' ? '손으로만 — 지금 정리를 누를 때' : `다음 정리 ${t.tidyAt > clock().slice(-5) ? '오늘' : '내일'} ${esc(t.tidyAt)}`} · 받은 것 ${inbox.length}</b><small>이 지식에 기록할 수 있는 사람 누구나 지금 정리할 수 있다 · 1~2분</small></span>${run ? `<span class="prog" data-t="prog"><i></i>${run.queued && Date.now() - run.t0 > 120000 ? `정리 일꾼을 기다린다 — ${Math.round((Date.now() - run.t0) / 60000)}분` : `정리하는 중 — 받은 것 ${inbox.length}…`}</span>` : `<button class="btn pri" data-a="tidyNow" data-k="${esc(k)}" data-t="tidyBtn"${inbox.length ? '' : ' disabled'}>지금 정리</button>`}</div>`
  const inboxCard = inbox.length ? `<div class="card" data-t="inbox"><div class="ch">받은 것 ${inbox.length} <small>정리 때 kmd 가 바로 문서에 넣는다</small></div><ul class="plain tl2">${inbox.map((r) => `<li><span class="k">${esc(r.author)}</span><span class="nm">${esc(r.title)}<small>${esc(recDt(r.date))}${r.state === 'nowhere' ? ' · 넣을 곳이 없는 메모' : ''}</small></span><span class="to">→ ${esc(target(r))}</span></li>`).join('')}</ul></div>` : ''
  const msg = S.tidyMsg[k]
  return {
    crumb: '정리',
    main: `<div style="max-width:800px"><div class="row" style="align-items:baseline"><span class="big">정리 — ${esc(n.name)}</span><span class="r muted small" data-t="tidyMode">${esc(modeTxt(t.tidyMode, t.tidyAt))} · 바꾸려면 <a data-a="nav" data-s="members">이 지식의 사람</a></span></div>
  <p class="lead">${t.tidyMode === 'live' ? '받은 기록은 kmd 가 남는 대로(조용해진 뒤) 바로 문서에 넣는다.' : t.tidyMode === 'manual' ? '받은 기록은 누군가 지금 정리를 누를 때 kmd 가 문서에 넣는다.' : '받은 기록은 kmd 가 정해진 시간에 바로 문서에 넣는다. 기다리기 싫으면 지금 정리.'}</p>
  ${S.stops.filter((s) => s.kind === 'worker' || (s.kind === 'tidy' && s.kn === k)).map(stopHtml).join('')}
  ${goBox}${msg ? `<div class="callout ${msg.cls}" data-t="tidyMsg">${esc(msg.t)}</div>` : ''}${inboxCard}${t.runs.map((r, i) => runHtml(k, r, i)).join('')}
  <details class="more"><summary>자세히</summary><div class="in">kmd 의 검사(값 · 이름 대조 · 크기 · 표지)를 못 넘은 글은 넣지 않고 그대로 둔다 — 문서 옆에 같이 읽히고 다음 정리 때 다시 해 본다. 이름 바꾸기 · 합치기 · 없애기는 넣지 않는다 — 제안 한 줄로만 선다.</div></details></div>`,
  }
}
// 지금 정리 — 지식마다 따로(한 지식의 정리가 다른 지식의 단추를 막지 않는다) · 1.5초마다 묻고 30분이면 그만 묻는다(일감은 서버에 남는다)
async function tidyNow(k) {
  S.tidyRuns ||= {}
  if (S.tidyRuns[k]) return
  try {
    const j = await postJSON(`/api/k/${encodeURIComponent(k)}/tidy`, {})
    const run = (S.tidyRuns[k] = { kn: k, job: j.id, t0: Date.now(), queued: j.state === 'queued' })
    S.tidyMsg[k] = null
    render()
    const poll = setInterval(async () => {
      const st = await getJSON('/api/job/' + j.id).catch(() => ({ state: 'gone' }))
      if ((st.state === 'queued' || st.state === 'running') && Date.now() - run.t0 < 30 * 60000) { const was = run.queued; run.queued = st.state === 'queued'; if (was !== run.queued || run.queued) render(); return }
      clearInterval(poll)
      delete S.tidyRuns[k]
      forgetKn(k)
      delete S.cache['tidy:' + k]
      delete S.cache.history
      if (st.state === 'queued' || st.state === 'running') S.tidyMsg[k] = { cls: 'warn', t: '정리 일꾼이 30분 넘게 끝내지 않는다 — 일감은 남아 있다 · 관리자에게(관리 › Claude 연결)' }
      else if (st.state === 'failed') S.tidyMsg[k] = { cls: 'warn', t: `정리하지 못했다 — ${st.why || '정리 일꾼이 끝내지 못했다'} · 받은 기록은 문서 옆에 같이 읽힌다` }
      else if (st.rule) toast(`${esc(st.why || '규칙으로 넣었다')} — ${st.summary?.put || 0}건`)
      else toast(`정리했다 — ${(st.summary?.put || 0) + (st.summary?.changed || 0)}건을 ${esc(KN(k).name)}에 넣었다`)
      await reloadKns()
      loadStops()
      render()
    }, 1500)
  } catch (e) { toast(esc(e.message)) }
}

// ───────────── 이 지식의 사람(목업 M11) ─────────────
const TIMES = ['00:30', '01:30', '02:30', '03:30', '05:00', '07:00', '12:00', '18:00', '22:00']
const ownerOf = (k) => need('owner:' + k, `/api/k/${encodeURIComponent(k)}/owner`)
const peopleOf = () => need('people', '/api/people')
function viewMembers() {
  const po = pcOnly('이 지식의 사람', '이 지식의 사람은')
  if (po) return po
  const k = tidyKn()
  if (!k) return { crumb: '이 지식의 사람', main: viewHome().main }
  const n = KN(k), row = ownerOf(k), t = tidyOf(k), tr = treeOf(k)
  if (!row || !t || !tr) return { crumb: '이 지식의 사람', main: loadingHtml }
  const owner = row.owner || null
  const own = (owner && owner === S.me.user) || S.me.admin
  const tidyAt = row.tidyAt || t.tidyAt
  const curators = (row.curators || []).filter((c) => c !== owner)
  const inboxN = tr.records.filter((r) => r.state === 'pend' || r.state === 'nowhere').length
  const mode = row.tidyMode || t.tidyMode || 'time'
  const tmenu = S.menu === 'tidyAt' ? `<div class="menu" style="right:0;top:28px" data-t="timeMenu"><div class="gray">정리 방식</div>${TIDY_MODES.map(([v, l, d]) => `<div class="mi${v === mode ? ' on' : ''}" data-a="setTidyMode" data-v="${v}" data-t="mode-${v}">${v === mode ? '✓ ' : ''}${l}<small>${d}</small></div>`).join('')}${mode === 'time' ? `<div class="sep"></div><div class="gray">정리 시각 — 매일</div>${TIMES.map((x) => `<div class="mi${x === tidyAt ? ' on' : ''}" data-a="setTidyAt" data-v="${x}" data-t="time-${x}">${x === tidyAt ? '✓ ' : ''}${x}</div>`).join('')}` : ''}<div class="sep"></div><div class="mi" data-a="toggleNoClaude" title="정리 일꾼에게 이 지식의 글을 보내지 않는다 — 규칙으로 되는 것만 넣는다. 팀원의 Claude Code 대화(kmd 도구)는 여전히 이 지식을 읽는다">자동 정리에 Claude 쓰지 않기<small>Claude Code 대화는 여전히 읽는다</small> <span class="sw${row.noClaude ? ' on' : ''}" style="margin-left:auto"></span></div></div>` : ''
  const people = peopleOf() || []
  const picker = S.picker ? `<div class="pk" data-t="picker"><div class="muted" style="padding:2px 6px 6px">팀 kmd 사람 목록에서 한 사람</div>${(Array.isArray(people) ? people : []).map((r) => { const has = curators.includes(r) || r === owner; return `<div class="o${has ? ' off' : ''}" ${has ? '' : `data-a="addCur" data-v="${esc(r)}"`} data-t="pick-${esc(r)}"><span class="av2" style="width:20px;height:20px;font-size:10.5px">${esc(r.slice(0, 1))}</span>${esc(r)}${has ? ' — 이미 정리하는 사람' : ''}</div>` }).join('')}</div>` : ''
  return {
    crumb: '이 지식의 사람',
    main: `<div style="max-width:780px"><div class="big">이 지식의 사람 — ${esc(n.name)}</div><p class="lead">누가 정리하고 누가 기록을 남기는지, kmd 가 언제 정리하는지 주인이 정한다.</p>
  ${own ? '' : `<div class="callout gray">바꾸기는 주인(${esc(owner || '관리자')})이 한다 — 여기서는 읽기만</div>`}
  <div class="card" style="overflow:visible"><div class="ch">정리하는 사람 <small>문서를 고치고 제안을 본다</small></div>
   <ul class="plain pl" data-t="curList"><li><span class="av2">${esc((owner || '관').slice(0, 1))}</span><span class="nm">${esc(owner || '관리자')}<small>${owner ? '세운 사람' : '주인을 정하지 않았다 — 관리자가 정리한다'}${curators.length ? '' : ' · 지금은 혼자 정리한다'}</small></span><span class="kt role">주인</span></li>
   ${curators.map((c) => `<li data-t="curRow"><span class="av2">${esc(c.slice(0, 1))}</span><span class="nm">${esc(c)}<small>${esc(n.name)} 정리하는 사람</small></span><span class="kt role">정리</span>${own ? `<button class="btn sm ghost" data-a="rmCur" data-v="${esc(c)}" data-t="rmCur">빼기</button>` : ''}</li>`).join('')}</ul>
   <div class="sub">kmd</div>
   <ul class="plain pl"><li><span class="av2 k">K</span><span class="nm" data-t="kmdRow">kmd — ${mode === 'live' ? '실시간 · 기록이 남고 조용해지면 바로 넣는다' : mode === 'manual' ? '손으로만 · [지금 정리] 를 누를 때 넣는다' : `정해진 시간과 [지금 정리] 로 바로 넣는다 · 매일 ${esc(tidyAt)}`}<small>${mode === 'time' ? `다음 정리 ${esc(tidyAt)} — ` : ''}받은 것 ${inboxN} · 값이 바뀌면 쓴 사람에게 알린다${row.noClaude ? ' · 자동 정리에 Claude 쓰지 않음' : ''}</small></span><span class="kt role">자동 정리</span>${own ? `<button class="kebab${S.menu === 'tidyAt' ? ' on' : ''}" data-a="menu" data-m="tidyAt" data-t="tidyKebab" title="정리 방식 · 시각 바꾸기">⋯${tmenu}</button>` : ''}</li></ul>
   <div class="sub">기록을 남기는 사람 <small>남긴 기록은 받은 것으로 온다</small></div>
   <ul class="plain pl"><li><span class="av2 all">팀</span><span class="nm">팀 모두<small>팀 kmd 에 들어오는 사람은 누구나 읽고 기록을 남긴다</small></span><span class="kt role">기록</span></li></ul>
   ${picker}
   <div class="cf">${own ? '<button class="btn pri" data-a="togglePicker" data-t="addCurBtn">정리하는 사람 더하기</button><span>팀 kmd 사람 목록에서 고른다</span>' : '<span>사람 목록에 없는 사람은 관리자에게</span>'}</div></div>
  ${isTeam() && S.me.admin ? `<div class="card" data-t="ownCard"><div class="ch">주인 · 갈래 <small>관리자만 — 비밀번호 한 번 더</small></div><div class="cb" style="padding:4px 14px 12px">
   <div class="set"><span class="tx"><b>주인 넘기기</b><small>지금 ${esc(owner || '없음')} — 넘겨받은 사람이 정리 설정 · 정리하는 사람을 정한다${row.private ? ' · 개인 지식은 새 주인만 본다' : ''}</small></span><select class="inp" id="ownSel" data-t="ownSel" style="width:auto">${(Array.isArray(people) ? people : []).map((p) => `<option value="${esc(p)}"${p === owner ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select><button class="btn" data-a="ownGive" data-t="ownGive">넘기기</button></div>
   <div class="set"><span class="tx"><b>${row.private ? '개인 지식 — 주인만 본다' : '팀 지식 — 팀 모두 본다'}</b><small>${row.private ? '팀 지식으로 내놓으면 팀 모두 읽고 기록한다' : '개인으로 돌리면 주인만 본다 — 팀원의 화면 · 찾기 · Claude Code 에서 사라진다'}</small></span><button class="btn" data-a="ownKind" data-v="${row.private ? 'team' : 'private'}" data-t="ownKind">${row.private ? '팀 지식으로 내놓기' : '개인으로 돌리기'}</button></div></div></div>` : ''}
  <details class="more"><summary>이 설정은 지식 안에 적혀 백업과 같이 간다</summary><div class="in">팀 지식의 정리는 팀 서버의 정리 전용 Claude 로그인으로 한다 — 로그인해 두는 것은 관리자. 개인 지식은 그 사람 PC 프로그램이 그 사람의 Claude 로 곧바로 넣는다.</div></details></div>`,
  }
}
async function setOwnerRow(k, patch) {
  try {
    await postJSON(`/api/k/${encodeURIComponent(k)}/owner`, patch)
    delete S.cache['owner:' + k]
    delete S.cache['tidy:' + k]
    S.menu = null
    render()
  } catch (e) { toast(esc(e.message)) }
}

// ───────────── 들어오기 전 — 들어가기 · 처음 들어오기 링크 · 첫 설정 ─────────────
// 서버는 비밀번호를 받지 않는다 — 여기서 전처리(prehash)한 값을 보낸다.
function gateView() {
  // 이 PC 의 kmd — 들어가기(아이디 · 비밀번호)가 없다. 한 번용 주소로만 들어온다
  if (S.me.mode === 'pc' && S.me.anon) return { crumb: '이 PC 의 kmd', main: viewPcGate() }
  if (S.gate === 'first' || S.gate === 'done') return { crumb: '처음', main: viewFirst() }
  if (S.gate === 'setup') return { crumb: '처음', main: viewSetup() }
  return { crumb: '들어가기', main: viewLogin() }
}
const gateErr = () => (S.gateErr ? `<div class="callout danger" data-t="loginErr">${esc(S.gateErr)}</div>` : '')
// 이 PC 의 kmd 화면 — 들어온 적 없는 브라우저 · 지난 주소. 화면은 이 PC 의 kmd 가 연 한 번용 주소로만 들어온다
function viewPcGate() {
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb" data-t="pcGate">
  <div class="mk">${svg('lock')}</div><div class="big">이 PC 의 kmd 화면을 연다</div>
  <p class="lead">이 화면은 이 PC 의 kmd 가 여는 한 번용 주소로 들어온다 — 아이디 · 비밀번호는 없다.</p>
  ${S.onceErr ? `<div class="callout gray" data-t="onceErr">${esc(S.onceErr)}</div>` : ''}
  <p><b>시작 메뉴 › kmd</b> 를 누른다 — 꺼져 있으면 켜고 이 화면을 새로 연다.</p>
  <p class="small muted">터미널이면 <span class="mono">kmd open</span> · 꾸러미를 손으로 풀어 쓰면 그 폴더의 <span class="mono">kmd.cmd open</span> · 한 번 들어온 브라우저는 쓰는 동안 30일 이어진다</p>
  <div class="links">팀 kmd 는 팀 서버 주소에서 아이디 · 비밀번호로 들어간다 · <a href="/manual" target="_blank" rel="noopener" data-t="pcGateManual">설명서</a></div>
 </div></div></div></div>`
}
function viewLogin() {
  const legacy = S.legacyOpen
  const form = legacy
    ? `<form data-f="legacy" autocomplete="off">
  <div class="field"><label for="lgTok">예전 열쇠</label><input class="inp mono" id="lgTok" type="password" autocomplete="off" data-focus><div class="hint">붙여 넣으면 곧바로 비밀번호를 정한다 — 그 뒤로는 아이디 · 비밀번호로 들어온다</div></div>
  ${gateErr()}<button class="btn pri" type="submit" data-t="legacyBtn">다음</button></form>`
    : `<form data-f="login" autocomplete="on">
  <div class="field"><label for="lgId">아이디</label><input class="inp" id="lgId" name="username" autocomplete="username" value="${esc(S.gateUser || '')}" data-focus></div>
  <div class="field"><label for="lgPw">비밀번호</label><input class="inp" id="lgPw" type="password" name="password" autocomplete="current-password"><div class="hint">브라우저가 채웠다 — Enter 만 누르면 된다</div></div>
  ${gateErr()}<button class="btn pri" type="submit" data-t="loginBtn">들어가기</button></form>`
  const old = S.me.legacy && !legacy ? ` <a data-a="legacyOpen" data-t="legacyOpen">예전 열쇠로 들어가기</a>` : legacy ? ` <a data-a="legacyClose">아이디 · 비밀번호로</a>` : ''
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb">
  <div class="mk">${svg('user')}</div><div class="big">팀 kmd 에 들어간다</div><p class="lead">한 번 들어오면 일주일쯤 이어진다.</p>
  ${form}
  <div class="links">잊었으면 관리자에게 — 새 링크를 보내 준다${old}</div>
 </div></div></div></div>`
}
function viewFirst() {
  if (S.gate === 'done')
    return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb" data-t="firstDone">
  <div class="mk">${svg('check')}</div><div class="big">✓ 정했다 — 들어왔다.</div>
  <p class="lead">이 PC 의 Claude Code 로도 쓰려면 — <a data-a="copyInstall" data-t="copyInstall">한 줄 복사</a><br><span class="muted small">10분 동안 한 번만 · 남에게 주지 마세요</span></p>
  <div class="links"><a data-a="gateHome" data-t="gateHome">지식 목록 ›</a></div>
 </div></div></div></div>`
  const who = S.gateUser
  // 쓴 링크 · 지난 링크 — 서버는 둘을 가르지 않는다. 들어와 있으면 그대로 이어 쓰고, 아니면 비밀번호로 들어가거나 새 링크
  if (!who && !S.me.anon) return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb"><div class="big">처음 들어오기</div><div class="callout gray" data-t="firstGone">이 링크는 쓸 수 없다(이미 썼거나 지났다) — 지금 ${esc(S.me.user)}로 들어와 있다 · 다른 사람에게 줄 링크면 관리자가 새로 만든다</div><div class="links"><a data-a="gateHome" data-t="gateHome">지식 목록 ›</a></div></div></div></div></div>`
  if (!who) return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb"><div class="big">처음 들어오기</div><div class="callout gray" data-t="firstGone">이 링크는 이미 썼거나 24시간이 지났다 — 비밀번호를 정했으면 들어가고, 아니면 관리자에게 새 링크를 부탁한다</div><div class="links"><a data-a="gateLogin">들어가기 ›</a></div></div></div></div></div>`
  const other = !S.me.anon && S.me.user !== who ? `<div class="callout gray" data-t="firstOther">지금 ${esc(S.me.user)}로 들어와 있다 — 정하면 ${esc(who)}로 바뀐다</div>` : ''
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb">
  <div class="mk">${svg('lock')}</div><div class="big">${esc(who)}의 비밀번호를 정한다</div><p class="lead">처음 들어오기 링크 — 관리자가 보냈다</p>${other}
  <form data-f="first" autocomplete="on">
  <div class="field"><label for="fsId">아이디</label><input class="inp" id="fsId" name="username" autocomplete="username" value="${esc(who)}" readonly></div>
  <div class="field"><label for="fsPw">비밀번호</label><input class="inp" id="fsPw" type="password" name="new-password" autocomplete="new-password" data-focus><div class="hint">브라우저가 제안하는 비밀번호를 쓰면 외울 것이 없다 — 직접 정하면 10자 이상 · 회사 메일 · 윈도 비밀번호와 다르게</div></div>
  ${gateErr()}<button class="btn pri" type="submit" data-t="firstBtn">정하기</button></form>
 </div></div></div></div>`
}
function viewSetup() {
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb">
  <div class="mk">${svg('shield')}</div><div class="big">팀 kmd 의 관리자를 만든다</div><p class="lead">이 주소에서 한 번만 묻는다.</p>
  <form data-f="setup" autocomplete="on">
  <div class="field"><label for="suId">관리자 아이디</label><input class="inp" id="suId" name="username" autocomplete="username" data-focus></div>
  <div class="field"><label for="suPw">비밀번호</label><input class="inp" id="suPw" type="password" name="new-password" autocomplete="new-password"><div class="hint">브라우저가 제안하는 비밀번호를 쓰면 외울 것이 없다</div></div>
  ${gateErr()}<button class="btn pri" type="submit" data-t="setupBtn">관리자 만들기</button></form>
  <details class="more"><summary>자세히</summary><div class="in">Claude · DB · GitLab 의 열쇠는 이 화면에서 받지 않는다 — 서버에서 한 번 넣어 둔다. 들어오면 사람마다 「처음 들어오기 링크」 를 만들어 메신저로 전하면 끝 — 비밀번호는 그 사람이 정한다.</div></details>
 </div></div></div></div>`
}
async function postJSON(p, body) {
  // 일을 거는 요청일 수 있다 — 곧 「지금 하는 일」 을 다시 읽는다(가져오기 · 넣기가 도는 동안 점이 바로 깜빡이게)
  if (S.me && !anon()) { clearTimeout(busyTimer); busyTimer = setTimeout(loadBusy, 500) }
  const t = reqTo(p)
  const r = await fetch(t.url, { method: 'POST', headers: { 'content-type': 'application/json', ...t.headers }, body: JSON.stringify(body || {}) })
  const j = await r.json().catch(() => ({}))
  // 관리자 일 — 비밀번호 한 번 더(15분). 확인되면 같은 요청을 한 번 더 보낸다 · 그만두면 E_CANCEL
  if (!r.ok && j.error === 'E_SUDO' && p !== '/api/sudo') { await askSudo(); return postJSON(p, body) }
  // 들어온 것이 끝났다(12시간 쉼 · 7일) — 쓰던 글은 그대로 두고 그 자리에서 다시 들어간 뒤 같은 요청을 다시
  if (r.status === 401 && !t.headers.authorization && canRelogin() && !['/login', '/api/sudo', '/first', '/setup', '/once'].includes(p)) { await askLogin(); return postJSON(p, body) }
  if (!r.ok) throw Object.assign(new Error(j.message || '서버에 닿지 않는다'), { code: j.error })
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
function sudoHtml() {
  const v = S.sudo
  return `<div class="pscrim" data-t="sudoWin"><div class="modal win" style="width:min(420px,94%)"><div class="tb"><b>${v.login ? `다시 들어가기 — ${esc(S.me.user)}` : '비밀번호 한 번 더 — 관리자 확인'}</b></div><div class="wb"><p class="small muted" style="margin:0 0 8px">${v.login ? '들어온 것이 끝났다(12시간 쉬었거나 7일이 지났다) — 쓰던 글은 그대로 있다 · 들어오면 하던 일을 이어서 한다' : '관리자 일은 15분마다 비밀번호를 한 번 더 넣는다 — 확인되면 하던 일을 이어서 한다'}</p><input class="inp" type="password" id="sudoPw" data-t="sudoPw" aria-label="비밀번호" autocomplete="current-password" style="width:100%">${v.err ? `<div class="callout danger" style="margin-top:10px"><i></i><span>${esc(v.err)}</span></div>` : ''}</div><div class="wf"><a class="muted" data-a="sudoCancel" style="align-self:center;margin-right:auto">그만두기</a><button class="btn pri" data-a="sudoOk" data-t="sudoOk"${v.busy ? ' disabled' : ''}>${v.busy ? '확인하는 중…' : '확인'}</button></div></div></div>`
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
  } catch (e) { v.busy = false; v.err = e.code === 'E_AUTH' ? '비밀번호를 확인하세요' : e.message; S._focus = 'sudoPw'; render() }
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
async function copyInstall() {
  try {
    const r = await postJSON('/api/device/ticket')
    const line = /Win/i.test(navigator.platform || navigator.userAgent) ? r.line : r.sh
    copyText(line)
    S.lastInstall = line
    toast('설치 한 줄을 복사했다 — 10분 동안 한 번만 · 작업 폴더의 터미널에 붙여 넣는다')
  } catch (e) { toast(esc(e.message)) }
}
async function afterLogin(notice) {
  S.gate = S.gate === 'done' ? 'done' : null
  S.gateErr = null
  S.legacyOpen = false
  if (location.pathname !== '/' || location.hash) history.replaceState(null, '', '/')
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
      if (!user || !v('lgPw')) throw new Error('아이디나 비밀번호를 확인하세요 — 여러 번 틀리면 잠시 막힌다')
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
      if (pw.length < 10) throw new Error('10자 이상 — 회사 메일 · 윈도 비밀번호와 다르게')
      await postJSON('/first', { code: S.gateCode, pw: prehash(S.gateUser, pw) })
      S.gate = 'done'
      await afterLogin()
    } else if (kind === 'setup') {
      const user = v('suId').trim()
      const pw = v('suPw')
      if (pw.length < 10) throw new Error('10자 이상 — 회사 메일 · 윈도 비밀번호와 다르게')
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
  return '—'
}
const sourcesOf = () => need('sources', '/api/sources')
// 가져오기(옛 자료 가져오기)는 무엇을 만드나로 두 영역 — 문서로 들이기(파일 · 폴더 → 문서 · 한 번) · 지켜보며 맞추기(때마다 바뀐 것만).
// 지켜보며 맞추기의 더하기는 유형마다 칸이 다르다 — 코드 폴더(경로) · git 저장소(주소 · 자격) · DB(호스트 · 포트 · DB · 스키마 · 계정 · 비밀번호).
// 나가는 자격(git 토큰 · DB 비밀번호)은 이 PC 화면만 받는다 — 팀 화면은 받지 않고 셸 한 줄과 「있음」 만(v0.6 정정 ③).
// 유형 — 사람이 가르는 대로 문서 · 소스 코드(git — 묶음 이력으로) · DB. 파일을 팀으로 나르는 길은 없다 — 지식은 「보내기」 로
const sfTypes = () => [['docs', '문서 폴더'], ['git', '소스 코드(git)'], ['db', 'DB']]
const SF_RULES = {
  db: [['dbtables', '테이블 정의', '테이블마다 컬럼 · 형 · 길이 · 키 표']],
}
const SF_DOC = { deps: '라이브러리', tables: '코드표', dbtables: '테이블 정의', docs: '' }
function sfState() {
  if (!S.sf) {
    const k = S.route.kn && S.route.kn !== '*' && KN(S.route.kn) && !KN(S.route.kn).pc ? S.route.kn : (S.kns.find((x) => !x.pc) || {}).id
    S.sf = { type: 'docs', kn: k, rule: 'docs', every: 'hourly', port: '5432', schema: 'public' }
  }
  return S.sf
}
const impKns = () => S.kns.filter((x) => !x.pc && !x.hidden)
function impTarget() {
  if (S.impKn === '') return { kn: null, label: '받은편지함(새로)' } // 사람이 「받은편지함(새로)」 를 골랐다
  const pick = S.impKn && KN(S.impKn) && !KN(S.impKn).pc ? S.impKn : null
  const k = pick || defaultKn()
  if (k && KN(k) && !KN(k).pc) return { kn: k, label: KN(k).name }
  const ib = impKns().find((x) => x.name === '받은편지함') || impKns()[0]
  if (ib) return { kn: ib.id, label: ib.name }
  return { kn: null, label: '받은편지함(처음 넣으면 생긴다)' }
}
function impPick(target) {
  return `<select class="inp" data-t="impKn" id="impKn" style="width:auto;margin:0 4px">${impKns().map((x) => `<option value="${esc(x.id)}"${x.id === target.kn ? ' selected' : ''}>${esc(x.name)}${isPersonal(x) ? ' · 나만' : ' · 팀'}</option>`).join('')}${impKns().some((x) => x.name === '받은편지함') || (isTeam() && !S.me.admin) ? '' : `<option value=""${target.kn ? '' : ' selected'}>받은편지함(새로 — 정리 시각에 이름이 걸리는 지식으로 옮긴다)</option>`}</select>`
}
const KIND_T = { docs: '문서 폴더', folder: '코드 폴더(예전)', git: '소스 코드 · git', db: 'DB · 읽기만', pc: '내 PC 폴더' }
const KIND_I = { docs: 'doc', folder: 'doc', git: 'sync', db: 'server', pc: 'pair' }
const isCode = (s) => s.kind === 'git' && !(s.rules && s.rules.length)
const srcId = (s) => s.kn + '|' + s.name
// 마지막으로 바뀐 것 — 바뀐 파일 · 표 · 묶음 수
function srcChange(s) {
  const lc = (s.state || {}).lastChange
  return lc && lc.commits != null ? `새 묶음 ${lc.commits} · 기록 ${lc.records} · ${whenTxt(lc.at)}` : lc ? `바뀐 파일 ${lc.files}${lc.removed ? '(지움 ' + lc.removed + ')' : ''} · ${lc.docs != null ? '문서 ' + lc.docs : '표 ' + lc.tables} · ${whenTxt(lc.at)}` : ''
}
// 상태 칩 하나 — 도는 중 · 다시 맞추는 중 · 멈춤 · 못 가져옴 · 그대로 · 바뀜
function srcChip(s) {
  const id = srcId(s), st = s.state || {}, run = S.srcRun[id], rs = s.resync
  if (run === 'run') return '<span class="chip c-pend" data-t="srcRun">가져오는 중…</span>'
  if (rs && rs.state === 'running') return `<span class="chip c-pend" data-t="resyncRun">다시 맞추는 중 ${rs.done || 0} / ${rs.total || '…'}</span>`
  if (rs && rs.state === 'paused') return '<span class="chip c-warn" data-t="resyncPaused">다시 맞추기 끊김</span>'
  if (st.stopped) return '<span class="chip c-warn">멈춤 — 크게 바뀜</span>'
  if (st.failures) return `<span class="chip c-danger" title="${esc(st.lastNote || '')}">못 가져옴</span>`
  if (!st.checkedAt) return '<span class="chip c-mute">아직</span>'
  return `<span class="chip ${/바뀐|새 묶음 [1-9]/.test(st.lastNote || '') ? 'c-acc' : 'c-mute'}" title="${esc(st.lastNote || '')}">${esc(String(st.lastNote || '그대로').split(' · ')[0])}</span>`
}
function srcRow(s, can) {
  const id = srcId(s), st = s.state || {}, run = S.srcRun[id]
  const ev = String(s.every || 'hourly'), live = s.watch === 'live'
  const into = isCode(s) ? '코드 바뀜 기록' : (s.rules && s.rules[0] && s.rules[0].into && s.rules[0].into.doc) || ''
  const sub = s.kind === 'pc' ? '내 PC 폴더 — 걷은 기능 · 쉰다' : `${KIND_T[s.kind] || s.kind} · ${s.at || ''}`
  const msg = run && run !== 'run' ? `<small data-t="srcOk">${esc(run)}</small>` : ''
  const fetch = s.kind === 'pc' ? '' : `<button class="btn sm" data-a="fetchSrc" data-id="${esc(id)}" data-t="fetchBtn"${run === 'run' ? ' disabled' : ''}>${run === 'run' ? '가져오는 중…' : '지금 가져오기'}</button>`
  return `<div class="srow" data-a="srcOpen" data-id="${esc(id)}" data-t="srcRow" data-name="${esc(s.name)}"><span class="si">${svg(KIND_I[s.kind] || 'doc')}</span><span class="sn"><b>${esc(s.name)}</b><small>${esc(sub)}</small></span><span class="sc">${esc(s.knName)} › ${esc(into)}<small data-t="every">${live ? '<b data-t="live">실시간</b> · 그 밖에 ' + esc(everyTxt(ev)) : esc(everyTxt(ev))} · 마지막 ${st.checkedAt ? esc(whenTxt(st.checkedAt)) : '—'}</small>${msg}</span><span class="ss">${srcChip(s)}</span><span class="sa">${can ? fetch : ''}</span></div>`
}
// 가져오는 곳 자세히 — 보고 · 고치고 · 지운다(요구 v0.2 R4)
function srcOf(id) { const v = sourcesOf(); return v && !v.error ? v.items.find((s) => srcId(s) === id) || null : null }
function srcOpen(id) {
  const s = srcOf(id)
  if (!s) return
  const ev = String(s.every || 'hourly'), db = (() => { try { const u = new URL(s.at); return { host: u.hostname, port: u.port || '5432', database: decodeURIComponent(u.pathname.slice(1)), user: decodeURIComponent(u.username), schema: u.searchParams.get('schema') || 'public' } } catch { return {} } })()
  S.se = { id, at: s.kind === 'db' ? '' : s.at || '', doc: (s.rules && s.rules[0] && s.rules[0].into && s.rules[0].into.doc) || '', every: ev.startsWith('daily ') ? 'daily' : ev, at2: ev.startsWith('daily ') ? ev.slice(6) : '06:00', meaning: !!s.meaning, ...db, password: '', gitUser: '', gitToken: '', msg: null, busy: false, del: false }
  render()
}
const seFld = (label, f, v, ph, opt = {}) => `<div class="field"><label for="se-${f}">${label}</label><input class="inp${opt.mono ? ' mono' : ''}" id="se-${f}" data-in="se" data-f="${f}" value="${esc(v || '')}" placeholder="${esc(ph || '')}" autocomplete="${opt.pw ? 'new-password' : 'off'}"${opt.pw ? ' type="password"' : ''}${opt.ro ? ' readonly' : ''}>${opt.hint ? `<div class="hint">${opt.hint}</div>` : ''}</div>`
function srcModalHtml() {
  const e = S.se, s = srcOf(e.id)
  if (!s) return ''
  const v = sourcesOf(), can = v && !v.error ? v.can : false, team = isTeam(), st = s.state || {}, id = e.id
  const ro = !can
  const evSel = `<div class="field"><label for="se-every">언제</label><div class="row"><select class="inp" id="se-every" data-se="every" style="flex:1"${ro ? ' disabled' : ''}>${[['hourly', '1시간마다'], ['daily', '매일'], ['weekly', '매주 월'], ['change', '바뀔 때만 — 5분마다 보고 바뀐 것만'], ['manual', '손으로만']].map(([x, l]) => `<option value="${x}"${e.every === x ? ' selected' : ''}>${l}</option>`).join('')}</select>${e.every === 'daily' ? `<input class="inp mono" type="time" id="se-at2" data-in="se" data-f="at2" value="${esc(e.at2)}" style="width:120px"${ro ? ' disabled' : ''}>` : ''}</div>${s.kind === 'docs' ? '<div class="hint">폴더는 실시간으로도 지켜본다 — 이것은 놓친 것을 잡는 때</div>' : ''}</div>`
  let where = ''
  if (s.kind === 'db') where = `<div class="fgrid">${seFld('호스트', 'host', e.host, 'db.team.local', { mono: 1, ro })}${seFld('포트', 'port', e.port, '5432', { mono: 1, ro })}${seFld('DB 이름', 'database', e.database, '', { mono: 1, ro })}${seFld('스키마', 'schema', e.schema, 'public', { mono: 1, ro })}${seFld('계정', 'user', e.user, '', { mono: 1, ro })}${team ? `<div class="field"><label>비밀번호</label><div class="hint" data-t="credLine">화면으로 받지 않는다 — 서버에서 <code>kmd secret set ${esc(s.secret.name)}</code> · ${s.secret.has ? '있음' : '없음'}</div></div>` : seFld('비밀번호', 'password', e.password, s.secret && s.secret.has ? '그대로(바꿀 때만 쓴다)' : '이 PC 의 자격 저장소에만', { pw: 1, ro })}</div>`
  else where = seFld(s.kind === 'git' ? 'git 주소 · 저장소 폴더' : '문서 폴더 경로', 'at', e.at, '', { mono: 1, ro }) + (s.kind === 'git' && !team ? `<div class="fgrid">${seFld('계정', 'gitUser', e.gitUser, s.secret && s.secret.has ? '그대로' : '들어가야 하는 저장소면', { ro })}${seFld('읽기 열쇠', 'gitToken', e.gitToken, s.secret && s.secret.has ? '그대로(바꿀 때만 쓴다)' : '읽기 권한 열쇠', { pw: 1, ro })}</div>` : '')
  const into = isCode(s) ? `<div class="field"><label>넣는 곳</label><div class="small" style="padding:6px 0">${esc(s.knName)} › 코드 바뀜 기록 — 묶음마다 기록 하나 · 걸린 항목 글은 정리가 맞춘다</div></div>` : seFld(`넣을 문서 — ${esc(s.knName)} 안`, 'doc', e.doc, '', { ro, hint: s.kind === 'docs' ? '이 이름의 폴더로 문서가 선다 · 바꾸면 처음부터 다시 가져온다' : '테이블마다 이 문서의 항목으로 · 바꾸면 처음부터 다시 가져온다' })
  const mean = s.kind === 'git' ? `<div class="field"><label>뜻 갱신</label><div class="row"><button class="sw${e.meaning ? ' on' : ''}" data-a="seMeaning" data-t="seMeaning"${ro ? ' disabled' : ''}></button><span class="small muted">바뀐 코드로 걸린 항목 글도 맞춘다 — Claude 로${s.meaningBlocked ? ' · 이 지식은 자동 정리에 Claude 를 쓰지 않아 쉰다' : ''}</span></div></div>` : ''
  const stat = `<div class="kv" style="margin-bottom:14px" data-t="seState"><span>유형</span><span>${esc(KIND_T[s.kind] || s.kind)} · ${esc(String(s.since || ''))} 부터${s.by ? ' · ' + esc(s.by) : ''}</span><span>상태</span><span>${srcChip(s)} <small>${esc(st.lastNote || '')}</small></span><span>마지막 확인</span><span>${st.checkedAt ? esc(whenTxt(st.checkedAt)) : '—'}</span><span>다음</span><span>${s.watch === 'live' ? '바뀌면 바로 · ' + esc(nextTxt(s.every, st.checkedAt)) : esc(nextTxt(s.every, st.checkedAt))}</span>${srcChange(s) ? `<span>마지막 바뀜</span><span data-t="lastChange">${esc(srcChange(s))}</span>` : ''}</div>`
  const msg = e.msg ? `<div class="callout ${e.msg.cls || ''}" data-t="seMsg"><i></i><span>${e.msg.t}</span></div>` : ''
  const rs = s.resync, run = S.srcRun[id]
  const foot = e.del
    ? `<span class="l" style="color:var(--danger)">「${esc(s.name)}」 을 지운다 — 들어온 문서 · 기록은 그대로 둔다</span><span class="acts"><button class="btn ghost" data-a="seDelNo">취소</button><button class="btn danger" data-a="seDelOk" data-t="seDelOk"${e.busy ? ' disabled' : ''}>지우기</button></span>`
    : `<span class="acts" style="margin-left:0">${can ? `<button class="btn ghost" data-a="seDel" data-t="seDel" style="color:var(--danger)">지우기</button>` : ''}</span><span class="acts">${s.kind !== 'pc' ? `<button class="btn" data-a="fetchSrc" data-id="${esc(id)}" data-t="seFetch"${run === 'run' ? ' disabled' : ''}>${run === 'run' ? '가져오는 중…' : '지금 가져오기'}</button>` : ''}${can && !isCode(s) ? `<button class="btn" data-a="resyncSrc" data-id="${esc(id)}" data-t="resyncBtn" title="모든 파일을 다시 읽어 맞춘다 — 오래 걸릴 수 있다 · 쓰는 것은 다른 것뿐"${rs && rs.state === 'running' ? ' disabled' : ''}>전체 다시 맞추기</button>` : ''}${can ? `<button class="btn pri" data-a="seSave" data-t="seSave"${e.busy ? ' disabled' : ''}>${e.busy ? '고치는 중…' : '고친 것 저장'}</button>` : ''}</span>`
  return `<div class="scrim fix" data-a="seClose" data-self="1"><div class="modal w560" data-t="srcModal"><div class="mh">${svg(KIND_I[s.kind] || 'doc')} ${esc(s.name)} <small>가져오는 곳</small><button class="x" data-a="seClose" title="닫기">×</button></div><div class="mb">${msg}${stat}${where}${into}${evSel}${mean}${!can ? '<div class="hint">고치기 · 지우기는 관리자가 한다</div>' : ''}</div><div class="mf">${foot}</div></div></div>`
}
async function seSave() {
  const e = S.se, s = srcOf(e.id)
  if (!s || e.busy) return
  const body = { name: s.name, every: e.every === 'daily' ? 'daily ' + (e.at2 || '06:00') : e.every }
  if (s.kind === 'db') body.db = { host: e.host, port: Number(e.port) || 5432, database: e.database, schema: e.schema, user: e.user, ...(e.password ? { password: e.password } : {}) }
  else if (e.at.trim()) body.at = e.at.trim()
  if (!isCode(s)) body.doc = e.doc
  if (s.kind === 'git') { body.meaning = !!e.meaning; if (e.gitUser || e.gitToken) body.cred = { user: e.gitUser, token: e.gitToken } }
  e.busy = true; e.msg = { cls: 'gray', t: '<b>고치는 중…</b>' }; render()
  try {
    const r = await postJSON(`/api/k/${encodeURIComponent(s.kn)}/sources/edit`, body)
    const st = r.run && r.run[0]
    e.msg = { t: `<b>고쳤다</b>${st ? (st.state === 'failed' ? ' · 그러나 못 가져왔다 — ' + esc(st.why || '') : ' · 처음부터 다시 가져왔다') : ''}` }
    e.password = ''; e.gitToken = ''
    delete S.cache.sources
    forgetKn(s.kn)
  } catch (x) { e.msg = { cls: 'danger', t: esc(x.message) } }
  e.busy = false
  render()
}
async function seDelOk() {
  const e = S.se, s = srcOf(e.id)
  if (!s || e.busy) return
  e.busy = true; render()
  try {
    const drop = confirm(`${s.name} 에서 들어온 사본 문서도 지울까?\n\n[확인] 사본도 지운다 · [취소] 사본은 내 문서로 남긴다(고칠 수 있다)`)
    const r = await postJSON(`/api/k/${encodeURIComponent(s.kn)}/sources/remove`, { name: s.name, copies: drop ? 'drop' : 'keep' })
    S.se = null
    delete S.cache.sources
    forgetKn(s.kn)
    toast(`지웠다 — ${esc(s.name)}${r.copies ? ` · 사본 ${r.copies} ${r.kept ? '은 내 문서로 남겼다' : '도 지웠다'}` : ''}`)
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
  const grid = (x) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px">${x}</div>`
  const full = (x) => `<div style="grid-column:1/-1">${x}</div>`
  const kns = S.kns.filter((k) => !k.pc)
  const sel = (f2, opts, v) => `<select class="inp" id="sf-${f2}" data-sf="${f2}" style="width:100%">${opts.map(([val, l]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
  const res = S.sfMsg ? `<div class="callout ${S.sfMsg.cls || ''}" data-t="sfMsg" style="margin:12px 0 0"><i></i><span>${S.sfMsg.t}</span></div>` : ''
  const tabs = `<div class="tabs" data-t="sfTabs" style="margin:0 0 14px">${types.map(([v, l]) => `<span class="${f.type === v ? 'on' : ''}" data-a="sfType" data-v="${v}" data-t="sf-${v}">${l}</span>`).join('')}</div>`
  let where = ''
  if (f.type === 'docs') where = full(fld(team ? '서버의 문서 폴더 경로' : '문서 폴더 경로', 'at', f.at, team ? '예: /srv/share/운영문서 — 서버에서 허락된 폴더 안만' : '예: D:\\공유\\운영문서', { need: 1, mono: 1 }))
  if (f.type === 'git') where = full(fld(team ? 'git 주소' : 'git 주소 · 이 PC 의 저장소 폴더', 'at', f.at, team ? '예: https://gitlab.team.local/dpms/dpms-api.git' : '예: https://gitlab.team.local/dpms/dpms-api.git · D:\\work\\dpms-api', { need: 1, mono: 1 })) + (team ? '<div class="small muted" style="grid-column:1/-1" data-t="credNote">들어가야 하는 저장소면 — 더한 뒤 서버에서 자격 한 줄(표의 그 줄에 보인다) · 화면으로는 받지 않는다</div>' : fld('계정', 'gitUser', f.gitUser, '사내 저장소에 들어가는 계정') + fld('읽기 열쇠', 'gitToken', f.gitToken, '읽기 권한 열쇠', { pw: 1 }))
  if (f.type === 'db') where = fld('호스트', 'host', f.host, '예: db.team.local', { need: 1, mono: 1 }) + fld('포트', 'port', f.port, '5432', { need: 1, mono: 1 }) + fld('DB 이름', 'database', f.database, '예: gdi', { need: 1, mono: 1 }) + fld('스키마', 'schema', f.schema, 'public', { mono: 1 }) + fld('계정', 'user', f.user, '예: kmd_read', { need: 1, mono: 1 }) + (team ? '<div class="small muted" data-t="credNote" style="align-self:end">비밀번호는 화면으로 받지 않는다 — 더한 뒤 서버에서 한 줄(표의 그 줄에 보인다)</div>' : fld('비밀번호', 'password', f.password, '이 PC 의 자격 저장소에만', { need: 1, pw: 1 }))
  const docsLike = f.type === 'docs'
  const what = f.type === 'git' ? '<div class="field" style="margin:0" data-t="codeWhat"><label>무엇을</label><div class="small" style="padding:8px 0">묶음 — 더한 뒤 저장소에 새로 올라온 묶음마다 바뀐 코드로 기록 하나</div><div class="hint">묶음 설명 · 바뀐 값(3초 → 5초) · 차이 · 걸린 항목 이름 · 정리가 그 항목 글을 맞춘다(Claude — 값이 바뀌면 노란 줄 · 되돌릴 수 있다) · 지금 묶음이 기준 · 합친 묶음 · 시험 · 빌드 결과는 보지 않는다</div></div>' : ruleSet ? `<div class="field" style="margin:0"><label for="sf-rule">무엇을 채우나</label>${sel('rule', ruleSet.map((r) => [r[0], r[1]]), f.rule)}<div class="hint">${esc(ruleSet.find((r) => r[0] === f.rule)[2])}</div></div>` : '<div class="field" style="margin:0"><label>무엇을</label><div class="small" style="padding:8px 0">문서 — md · docx · pptx · xlsx 는 문서로 · hwpx · pdf · 그림은 첨부로</div><div class="hint">바뀐 파일만 다시 · 들어온 문서는 원본이 주인(화면에서 고치지 않는다) · 원본에서 지우면 「원본에 없다」</div></div>'
  const into = f.type === 'git' ? `<div class="field" style="margin:0"><label for="sf-kn">넣을 지식</label>${sel('kn', kns.map((k) => [k.id, k.name]), f.kn)}<div class="hint">기록은 이 지식에 · 이름 장부의 항목이 걸리면 그 항목 정리로</div></div>` : `<div class="field" style="margin:0"><label for="sf-kn">넣을 지식 › ${docsLike ? '폴더' : '문서'}</label><div style="display:flex;gap:6px">${sel('kn', kns.map((k) => [k.id, k.name]), f.kn)}<input class="inp" id="sf-doc" data-in="sf" data-f="doc" value="${esc(f.doc || '')}" placeholder="${esc(docsLike ? sfAutoName(f) || '폴더 이름' : SF_DOC[f.rule])}" style="width:45%"></div><div class="hint">${docsLike ? '지식 안에 이 이름의 폴더로 문서가 선다 · 원본 폴더의 짜임 그대로' : '문서가 없으면 새로 선다 · 표는 그 문서 안 「저절로 채우는 표」 상자로'}</div></div>`
  const paths = ''
  const when = `<div class="field" style="margin:0"><label for="sf-every">언제</label>${sel('every', [['hourly', '1시간마다'], ['daily 06:00', '매일 06:00'], ['weekly', '매주 월'], ['change', '바뀔 때만 — 5분마다 보고 바뀐 것만']], f.every)}${f.type === 'docs' ? '<div class="hint">폴더는 실시간으로도 지켜본다 — 이것은 놓친 것을 잡는 때</div>' : f.type === 'git' ? '<div class="hint">이때마다 새 묶음을 본다</div>' : ''}</div>`
  const nm = fld('이름', 'name', f.name, sfAutoName(f) || '예: dpms-api 코드')
  const meaning = '' // 뜻 갱신 체크는 걷었다 — 소스 코드(git)는 묶음마다 기록이 그 일이다
  const dbNote = f.type === 'db' ? '<div class="callout gray" data-t="dbNote" style="margin:12px 0 0"><i></i><span><b>테이블마다 정의 표를 채우고 바뀐 테이블만 고친다</b> — 읽기 전용으로만 붙어 테이블 목록(테이블 · 칸 · 형 · 키 · 설명)만 읽는다 · 행은 읽지 않는다 · 어떤 계정이든 세션을 읽기 전용으로 열어 쓰지 않는다 · [연결 확인] 으로 먼저 붙어 본다</span></div>' : ''
  const probe = f.type === 'db' ? '<button class="btn" data-a="sfCheck" data-t="sfCheck">연결 확인</button>' : can && f.type === 'git' ? '<button class="btn" data-a="sfProbe" data-t="sfProbe">살펴보기</button>' : ''
  const go = can ? `<button class="btn pri" data-a="sfAdd" data-t="sfAdd">더하기</button>` : '<button class="btn pri" data-a="sfAsk" data-t="sfAsk">관리자에게 부탁</button>'
  return `<div class="scrim fix" data-a="sfClose" data-self="1"><div class="modal w760" data-t="sfCard"><div class="mh">가져올 곳 더하기 <small>유형을 고르고 칸을 채운다</small><button class="x" data-a="sfClose" title="닫기">×</button></div>
   <div class="mb">${tabs}
   ${where ? grid(where) + '<div style="border-top:1px solid var(--border);margin:14px 0"></div>' : ''}${grid(what + into + paths + when + nm + meaning)}${dbNote}${res}</div>
   <div class="mf"><span class="l">${can ? '더하면 바로 한 번 가져온다' : '관리자 화면에 「더해 달라」 한 줄로 간다'}</span><span class="acts">${probe}${go}</span></div></div></div>`
}
function sfModal() { const v = sourcesOf(); return sfForm(v && !v.error ? v.can : !isTeam() || S.me.admin) }
function sfAutoName(f) {
  const at = String(f.at || '').trim()
  if (f.type === 'db') return f.database ? `${f.database} DB` : ''
  if (!at) return ''
  const base = at.replace(/\.git$/i, '').replace(/[\\/]+$/, '').split(/[\\/:]/).filter(Boolean).pop()
  return f.type === 'docs' ? base : base + ' 코드'
}
// ── 넣은 일 · 터미널(요구 v0.2 R8) — 서버의 일 목록(새로 열어도 남는다) · 줄을 펼치면 Claude Code 가 하는 일이 보인다 ──
const RUN_T = { wait: ['c-mute', '기다림'], run: ['c-pend', '들이는 중'], done: ['c-acc', '넣음'], rule: ['c-warn', '규칙으로 넣음'], fail: ['c-danger', '못 넣음'] }
const runActive = (r) => r && (r.state === 'wait' || r.state === 'run')
function termHtml(id) {
  const L = (S.runLines || {})[id]
  if (!L) return '<div class="term" data-t="term"><span class="sys">불러오는 중…</span></div>'
  const t = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }
  const mark = { tool: '▸ ', ok: '✓ ', err: '✗ ', sys: '· ', cost: '■ ', say: '' }
  return `<div class="term" data-t="term" data-run="${esc(id)}">${L.lines.map((l) => `<div class="${esc(l.k)}"><span class="tm">${t(l.t)}</span>${mark[l.k] || ''}${esc(l.x)}</div>`).join('') || '<span class="sys">아직 줄이 없다 — 차례를 기다린다</span>'}</div>`
}
function jobsHtml() {
  const rs = S.cache.runs || []
  const runRows = rs.map((r) => {
    const [cls, lab] = RUN_T[r.state] || RUN_T.wait
    const open = !!(S.termOpen || {})[r.id]
    const kn = KN(r.kn)
    return `<div class="jrow" data-t="runRow" data-run="${esc(r.id)}"><div class="jl"><span class="tm">${esc(hhmm(r.startedAt))}</span><span class="tx">${esc(r.title)} → ${esc(kn ? kn.name : r.kn)} <span class="chip ${cls}" data-t="runState">${lab}</span><small data-t="runMsg">${esc(r.msg || (runActive(r) ? 'Claude Code 가 지식을 둘러보고 항목에 넣는다' : ''))}</small></span><span class="acts">${r.docs && r.docs[0] ? `<button class="btn sm" data-a="impGo" data-k="${esc(r.kn)}" data-d="${esc(r.docs[0])}" data-t="runGo">보기</button>` : ''}<button class="btn sm ghost" data-a="termToggle" data-id="${esc(r.id)}" data-t="termBtn">${open ? '터미널 닫기' : '터미널'}</button></span></div>${open ? termHtml(r.id) : ''}</div>`
  }).join('')
  const local = S.imports.filter((x) => x.many || !x.run).map((x) => x.many ? manyRow(x) : `<div class="jrow ${x.cls || ''}" data-t="impRow"><div class="jl"><span class="tm">${esc(x.tm)}</span><span class="tx">${esc(x.title)}<small data-t="impMsg">${esc(x.msg)}</small></span><span class="acts">${x.go ? `<button class="btn sm" data-a="impGo" data-k="${esc(x.go.kn)}" data-d="${esc(x.go.doc)}">보기</button>` : x.rec ? `<button class="btn sm" data-a="openRec" data-k="${esc(x.rec.kn)}" data-r="${esc(x.rec.id)}" data-t="impRec">보기</button>` : ''}</span></div></div>`).join('')
  return runRows + local || '<div class="muted small" style="padding:6px 2px">아직 없다</div>'
}
const IMP_K = { doc: '문서', record: '기록', run: 'Claude 일', att: '첨부', same: '그대로', fail: '못 넣음', skip: '읽지 못하는 종류' }
function manyRow(x) {
  const open = S.impOpen === x.id
  const list = open ? `<ul class="plain small" data-t="impFiles" style="margin:6px 0 0 54px">${[...x.rows].sort((a, b) => (a.kind === 'fail' || a.kind === 'skip' ? 0 : 1) - (b.kind === 'fail' || b.kind === 'skip' ? 0 : 1)).map((r) => `<li><span class="chip ${r.kind === 'fail' || r.kind === 'skip' ? 'c-warn' : 'c-mute'}">${IMP_K[r.kind] || r.kind}</span> <span class="mono">${esc(r.name)}</span> <small class="muted">${esc(r.msg || '')}</small></li>`).join('')}</ul>` : ''
  return `<div class="jrow ${x.cls || ''}" data-t="impRow" data-many="1"><div class="jl"><span class="tm">${esc(x.tm)}</span><span class="tx">${esc(x.title)}<small data-t="impMsg">${esc(x.msg)}</small></span><span class="acts">${x.done < x.total && !x.stop ? `<button class="btn sm" data-a="impStop" data-v="${esc(x.id)}" data-t="impStop">그만두기</button>` : ''}${x.rows.length ? `<button class="btn sm" data-a="impOpen" data-v="${esc(x.id)}" data-t="impOpen">${open ? '접기' : '보기'}</button>` : ''}</span></div>${list}</div>`
}
function paintJobs() {
  const box = document.getElementById('jobs')
  if (!box) return
  // 터미널을 보던 자리 — 맨 아래였으면 새 줄을 따라간다
  const stick = {}
  for (const t of box.querySelectorAll('.term')) stick[t.dataset.run] = t.scrollHeight - t.scrollTop - t.clientHeight < 24 ? 'end' : t.scrollTop
  box.innerHTML = jobsHtml()
  for (const t of box.querySelectorAll('.term')) { const v = stick[t.dataset.run]; t.scrollTop = v === undefined || v === 'end' ? t.scrollHeight : v }
}
let runTimer = null
async function pollRuns() {
  clearTimeout(runTimer)
  if (!S.me || gated() || S.route.scr !== 'import') return
  try {
    const rs = await getJSON('/api/runs')
    S.cache.runs = rs
    for (const id of Object.keys(S.termOpen || {})) {
      if (!S.termOpen[id]) continue
      const L = ((S.runLines ||= {})[id] ||= { lines: [], n: 0 })
      const r = rs.find((x) => x.id === id)
      if (!r || (L.n >= r.n && !runActive(r) && L.done)) continue
      const g = await getJSON(`/api/runs/${id}?from=${L.n}`)
      L.lines.push(...g.lines)
      L.n = g.n
      L.done = !runActive(g)
    }
    // 들이기가 끝난 일이 있으면 그 지식의 나무 · 목록을 새로
    for (const r of rs) if (!runActive(r) && (S.runSeen || {})[r.id] === 'active') { forgetKn(r.kn); delete S.cache.history; await reloadKns() }
    S.runSeen = Object.fromEntries(rs.map((r) => [r.id, runActive(r) ? 'active' : 'end']))
    paintJobs()
    if (rs.some(runActive)) runTimer = setTimeout(pollRuns, 900)
  } catch {}
}
function viewImport() {
  const po = pcOnly('가져오기', '가져오기는')
  if (po) return po
  const team = isTeam(), v = sourcesOf()
  const srcs = v && !v.error ? v.items : []
  const can = v && !v.error ? v.can : !team || S.me.admin
  const target = impTarget()
  const main = `<div style="max-width:980px"><div class="pg-h"><div><div class="big">가져오기</div><p class="lead">파일 · 폴더는 한 번 들여 지식으로(${team ? '정리가 기존 문서에 넣거나 새 문서로 세운다' : 'Claude Code 가 지식을 둘러보고 갈래 · 주제 문서의 항목으로 넣고 이름을 세운다'}), 문서 폴더 · 소스 코드 · DB 는 지켜보다 바뀐 것만 맞춘다. 빈 지식을 새로 세우려면 <a data-a="openAdd" data-t="toAdd">지식 목록 › 새 지식</a></p></div></div>
  ${S.stops.map(stopHtml).join('')}
  <div class="sec-h" data-t="impSec"><b>파일로 들이기</b><small>${team ? '파일 · 폴더 → 기록 → 정리가 문서로 · 원본은 첨부로' : '파일 · 폴더 → 기록 → Claude Code 가 문서의 항목으로 · 원본은 첨부로'}</small></div>
  <div class="card"><div class="cb">
   <div class="drop" id="drop" data-t="drop"><b>파일이나 폴더를 여기에 끌어다 놓는다</b>넣을 곳 ${impPick(target)} · md · txt · csv · html · json · docx · pptx · xlsx · hwpx${team ? '' : ' · pdf · hwp'} 는 글로 바꿔 들이고 원본은 첨부로
    <div class="lks"><label>파일 고르기<input type="file" multiple id="fileIn" data-t="fileIn"></label> · <label>폴더 고르기<input type="file" webkitdirectory directory multiple id="dirIn" data-t="dirIn"></label></div></div>
   <p class="gl">${team ? 'md · docx · pptx · xlsx · hwpx 는 글로 바꿔 파일마다 기록 하나 — 정리(Claude)가 읽어 이어지는 문서의 항목에 넣거나 새 문서로 세운다 · pdf · hwp 는 내 PC 프로그램에서 넣는다 · 원본은 첨부로.' : '파일마다 Claude Code 가 세션처럼 일한다 — 지식을 둘러보고, 글 속 이름을 맞추고, 회의록 › 「2026-10-21 HNC 통화」 처럼 갈래 · 주제 문서의 항목으로 넣고, 새 이름을 세운다. 하는 일은 줄마다 [터미널] 에 보인다 · Claude 가 안 되면 규칙으로.'} 한 번에 300 파일 · 200MB 까지.</p>
   <div class="rh">최근 넣은 것</div><div data-t="recent" id="jobs">${jobsHtml()}</div>
  </div></div>
  <div class="sec-h" data-t="impSec"><b>지켜보며 맞추기</b><small>문서 폴더 · 소스 코드(git 묶음) · DB — 정한 때마다 확인하고 바뀐 것만 지식에 맞춘다 · 줄을 누르면 자세히 · 고치기 · 지우기</small><span class="acts">${can ? `<button class="btn" data-a="fetchAll" data-t="fetchAll"${srcs.some((s) => s.kind !== 'pc') ? '' : ' disabled'}>지금 모두 가져오기</button><button class="btn pri" data-a="sfOpen" data-t="sfOpen">+ 가져올 곳 더하기</button>` : '<button class="btn" data-a="sfOpen" data-t="sfOpen">+ 더해 달라고 부탁</button>'}</span></div>
  <div class="slist" data-t="srcTable">${!v ? loadingHtml : srcs.length ? srcs.map((s) => srcRow(s, can)).join('') : '<div class="none">아직 더한 곳 없음 — [+ 가져올 곳 더하기] 로 문서 폴더 · 소스 코드(git) · DB 를 더한다</div>'}</div>
  <p class="gl">바뀐 줄은 그 지식의 「이력」 에 · 한꺼번에 크게 바뀌면 쓰지 않고 멈춘다 — 자세히에서 [지금 가져오기] 는 언제든</p></div>`
  return { crumb: '가져오기', main }
}
// 전체 다시 맞추기 — 뒤에서 돈다 · 도는 동안 1초마다 진행을 다시 받는다
async function resyncSrc(id) {
  const [kn, name] = id.split('|')
  try {
    await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/resync`, { name })
    S.srcRun[id + '|rs'] = true
    toast('전체 다시 맞추기를 시작했다 — 모든 파일을 다시 읽는다 · 쓰는 것은 다른 것뿐')
  } catch (e) { toast(esc(e.message)); return }
  const tick = async () => {
    delete S.cache.sources
    const v = await getJSON('/api/sources').catch(() => null)
    if (v) S.cache.sources = v
    if (S.route.scr === 'import') render()
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
    S.srcRun[id] = r.commits != null && r.state !== 'failed' ? (r.commits ? `새 묶음 ${r.commits} · 코드 바뀜 기록 ${r.codeRecords} · ${nowHm()}` : `새 묶음 없음 · ${nowHm()}`) : r.state === 'changed' ? `가져왔다 — 바뀐 표 ${r.n} · ${nowHm()}` : r.state === 'stopped' ? '멈췄다 — 한꺼번에 크게 바뀌었다' : r.state === 'failed' ? '못 가져왔다 — ' + (r.why || '') : r.state === 'waiting' ? r.why : `가져왔다 — 그대로 · ${nowHm()}`
    if (r.state === 'changed') { forgetKn(kn); delete S.cache.history }
  } catch (e) { S.srcRun[id] = '못 가져왔다 — ' + e.message }
  delete S.cache.sources
  loadStops()
  render()
}
// 칸 → 보낼 카드(검사는 화면에서 먼저 — 빈 칸이면 어느 칸인지 말한다)
function sfCard() {
  const f = sfState()
  const miss = (x, l) => { if (!String(x || '').trim()) throw new Error(`${l} 칸을 채운다`) }
  if (f.type === 'db') { miss(f.host, '호스트'); miss(f.database, 'DB 이름'); miss(f.user, '계정'); if (!isTeam() && !S.sfAsking) miss(f.password, '비밀번호') }
  else miss(f.at, f.type === 'git' ? 'git 주소' : '문서 폴더 경로')
  if (!f.kn) throw new Error('넣을 지식이 없다 — 새 지식에서 먼저 세운다')
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
      S.sfMsg = { t: `<b>관리자에게 부탁했다 — ${esc(card.name)}</b> · 관리 화면에 「더해 달라」 한 줄로 갔다` }
    } else {
      S.sfMsg = { cls: 'gray', t: '<b>더하는 중…</b> 처음 한 번 가져온다' }
      render()
      const r = await postJSON(`/api/k/${encodeURIComponent(f.kn)}/sources`, card)
      const st = r.run && r.run[0]
      S.sfOpen = false
      S.sfMsg = { t: `<b>더했다 — ${esc(card.name)}</b>${st && st.state === 'changed' ? (card.kind === 'docs' ? ` · 문서 ${st.docs}` : ` · 처음 가져온 표 ${st.n}`) : card.kind === 'git' && st && st.state === 'same' ? ' · 지금 묶음을 기준으로 두었다 — 다음 묶음부터 바뀐 코드를 기록한다' : st && st.state === 'waiting' ? '' : st && st.state === 'failed' ? ` · 그러나 못 가져왔다 — ${esc(st.why || '')}` : ''}${isTeam() && (card.kind === 'git' || card.kind === 'db') ? ` · 자격이 필요하면 서버에서 <code>kmd secret set ${esc(r.secret)}</code>` : ''}` }
      toast(S.sfMsg.t, 8000)
      forgetKn(f.kn)
    }
    S.sf = { ...f, at: '', name: '', doc: '', gitUser: '', gitToken: '', password: '', host: '', database: '', user: '', paths: '' }
    delete S.cache.sources
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
    S.sfMsg = { t: `<b>닿는다 — 마지막 묶음 ${esc(r.head.sha)}</b> · ${esc(r.head.subject)} · ${esc(r.asof)} · 더하면 이 묶음이 기준 — 그 뒤 묶음부터 기록한다` }
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
    if (!r.reach) S.sfMsg = { cls: 'danger', t: `<b>닿지 않는다 — ${where}</b> · 주소 · 포트 · 방화벽을 본다` }
    else if (r.login === null || r.login === undefined) S.sfMsg = { t: `<b>닿는다 — ${where}</b> · ${r.ms}ms · ${isTeam() ? '계정 확인은 서버에 비밀번호를 넣은 뒤(kmd secret set)' : '비밀번호를 넣으면 붙어서 계정까지 본다'}` }
    else if (!r.login) S.sfMsg = { cls: 'danger', t: `<b>닿지만 붙지 못했다</b> — ${esc(r.why)}` }
    else S.sfMsg = { t: `<b>붙었다 — 테이블 ${r.tables}</b> · 읽기 전용으로 붙어 테이블 목록만 읽는다` }
  } catch (e) { S.sfMsg = { cls: 'danger', t: esc(e.message) } }
  render()
}
const fileB64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(f) })
async function takeFiles(files) {
  files = [...files]
  if (!files.length) return
  let t = impTarget()
  try {
    if (!t.kn) { const r = await postJSON('/api/knowledge/add', { kind: 'new', name: '받은편지함' }); await reloadKns(); t = { kn: r.id, label: '받은편지함' }; S.impKn = r.id }
  } catch (e) { toast(esc(e.message)); return }
  if (files.length > 10) return takeMany(files, t)
  const name = (KN(t.kn) || {}).name || t.kn
  const tops = [...new Set(files.map((f) => (f.webkitRelativePath || f._rel || '').split('/')).filter((p) => p.length > 1).map((p) => p[0]))]
  const row = { tm: nowHm(), title: tops.length ? tops[0] + ' 폴더 → ' + name + ' › ' + tops[0] : files.length === 1 ? files[0].name : `파일 ${files.length}개 → ${name}`, msg: '바꾸는 중…', cls: 'run' }
  S.imports.unshift(row)
  render()
  try {
    const list = await Promise.all(files.map(async (f) => ({ path: f.webkitRelativePath || f._rel || f.name, b64: await fileB64(f) })))
    const r = await postJSON(`/api/k/${encodeURIComponent(t.kn)}/import`, { files: list })
    const s = r.summary
    if (files.length === 1 && r.rows[0]) {
      const x = r.rows[0]
      row.msg = x.msg
      row.cls = x.kind === 'fail' || x.kind === 'skip' ? 'bad' : ''
      if (x.kind === 'doc') { row.title = files[0].name + ' → ' + name + ' › ' + x.doc; row.go = { kn: t.kn, doc: x.doc } }
      if (x.kind === 'record') { row.title = files[0].name + ' → ' + name + ' › 기록'; row.rec = x.rec ? { kn: t.kn, id: x.rec } : null }
      if (x.kind === 'run') row.run = x.run
    } else {
      row.msg = `${tops[0] ? tops[0] + ' 폴더 — ' : ''}${s.record ? '기록 ' + s.record + ' — 정리가 기존 문서에 넣거나 새 문서로 세운다 · ' : ''}${s.doc ? '문서 ' + s.doc + ' · ' : ''}첨부 ${s.att}${s.same ? ' · 그대로 ' + s.same : ''}${s.fail ? ' · 바꾸지 못한 파일 ' + s.fail : ''} · 넣지 않은 파일 ${s.skip}`
      row.cls = s.skip || s.fail ? 'bad' : ''
    }
    row.tm = nowHm()
    const runIds = r.rows.filter((x) => x.kind === 'run').map((x) => x.run)
    if (runIds.length) { row.run = row.run || runIds[0]; (S.termOpen ||= {})[runIds[0]] = true }
    forgetKn(t.kn)
    delete S.cache.history
    await reloadKns()
  } catch (e) { row.msg = e.message; row.cls = 'bad' }
  render()
  pollRuns()
}
// 여럿 — 10 개(또는 40MB)씩 나눠 보낸다 · 묶음 한 줄에 n/N · 문서 · 기록 · Claude 일 · 못 넣음 [보기] · [그만두기] 는 남은 묶음을 보내지 않는다
async function takeMany(files, t) {
  const name = (KN(t.kn) || {}).name || t.kn
  const tops = [...new Set(files.map((f) => (f.webkitRelativePath || f._rel || '').split('/')).filter((p) => p.length > 1).map((p) => p[0]))]
  const row = { tm: nowHm(), title: tops.length ? tops[0] + ' 폴더 → ' + name : `파일 ${files.length}개 → ${name}`, msg: `넣는 중 — 0/${files.length}`, cls: 'run', many: true, done: 0, total: files.length, rows: [], id: uid() }
  S.imports.unshift(row)
  render()
  const parts = []
  let cur = [], size = 0
  for (const f of files) { if (cur.length && (cur.length >= 10 || size + f.size > 40 << 20)) { parts.push(cur); cur = []; size = 0 } cur.push(f); size += f.size }
  if (cur.length) parts.push(cur)
  for (const part of parts) {
    if (row.stop) break
    try {
      const list = await Promise.all(part.map(async (f) => ({ path: f.webkitRelativePath || f._rel || f.name, b64: await fileB64(f) })))
      const r = await postJSON(`/api/k/${encodeURIComponent(t.kn)}/import`, { files: list })
      row.rows.push(...r.rows)
    } catch (e) { row.rows.push(...part.map((f) => ({ name: f.webkitRelativePath || f._rel || f.name, kind: 'fail', msg: e.message }))) }
    row.done += part.length
    const n = (k) => row.rows.filter((x) => x.kind === k).length
    row.msg = `${row.stop ? '그만뒀다' : row.done < row.total ? '넣는 중' : '넣었다'} — ${row.done}/${row.total} · 문서 ${n('doc')} · 기록 ${n('record')} · Claude 일 ${n('run')} · 첨부 ${n('att')}${n('same') ? ' · 그대로 ' + n('same') : ''}${n('fail') ? ' · 못 넣음 ' + n('fail') : ''}${n('skip') ? ' · 읽지 못하는 종류 ' + n('skip') : ''}`
    render()
  }
  row.cls = row.rows.some((x) => x.kind === 'fail' || x.kind === 'skip') ? 'bad' : ''
  row.tm = nowHm()
  const runIds = row.rows.filter((x) => x.kind === 'run').map((x) => x.run)
  if (runIds.length) { row.run = runIds[0]; (S.termOpen ||= {})[runIds[0]] = true }
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

// ── 보내기(목업 M10 · 정정 2026-10-23) ──
// 두 영역 — 영역마다 보내기 단추
//   바뀐 것: 보낸 뒤 바뀐 문서(새 문서는 전체 · 아니면 바뀐 항목만) · 그 뒤 새로 남은 기록(전체) — 처음엔 모두 골라 둔다 · 모두 고르기 / 모두 빼기
//   지식: 문서 목록 · 기록 목록 — 여럿 골라 전체로 보낸다. 고르지 않은 바뀐 것은 다음에 그대로 남는다
const sendOf = (k) => need('send:' + k, `/api/k/${encodeURIComponent(k)}/send`)
const sendKns = () => S.kns.filter((k) => k.dests && k.dests.length)
const sendKey = (kn, x) => kn + '|' + x
const chOn = (kn, key) => !(S.sendOff || {})[sendKey(kn, key)]
const picked = (kn, x) => !!(S.sendSel || {})[sendKey(kn, x)]
// 영역마다 고른 수 — changes(바뀐 것 · 받은편지함 메모) · know(지식에서 고른 문서 · 기록)
function sendCount(qs, area) {
  let n = 0
  for (const { k, v } of qs) {
    if (!v || v.error) continue
    if (area === 'changes') n += v.items.filter((q) => chOn(k.id, q.key)).length
    else n += Object.keys(S.sendSel || {}).filter((x) => S.sendSel[x] && x.startsWith(k.id + '|')).length
  }
  return area === 'changes' ? n + (S.cand || []).filter((c) => c.on).length : n
}
function viewSend() {
  const po = pcOnly('지식 보내기', '지식 보내기는', '팀 서버의 개인 지식은 지식 고르기에서 그 지식을 고르면 여기서 팀 지식으로 보낸다.')
  if (po) return po
  if (S.cand === null) setTimeout(loadCand)
  const ks = sendKns(), qs = ks.map((k) => ({ k, v: sendOf(k.id) }))
  const loading = qs.some((x) => !x.v)
  const wait = [], log = []
  for (const { k, v } of qs) {
    if (!v || v.error) continue
    for (const w of v.wait) wait.push({ ...w, from: k.name, kn: k.id })
    for (const l of v.log) log.push({ ...l, from: k.name })
  }
  log.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const dests = [...new Set(qs.flatMap(({ v }) => (v && !v.error ? v.dests.map((d) => d.kn) : [])))]
  const targets = S.sendTargets
  const dn = dests.map((d) => (KN(d) || {}).name || d).join(' · ') || '팀'
  const dnK = /지식$/.test(dn) ? dn : dn + ' 지식'
  const cand = S.cand || []
  const tidyAt = dests.length === 1 && KN(dests[0]) && KN(dests[0]).tidyAt
  const nCh = sendCount(qs, 'changes'), nKw = sendCount(qs, 'know')
  const when = tidyAt ? '오늘 밤 ' + esc(tidyAt) + ' 정리 때 문서에 들어간다' : '받는 지식의 정리 때 문서에 들어간다'
  const goBtn = (area, label, n, t) => `<div class="cf" style="display:flex;align-items:center;gap:8px"><span class="muted small">${when}</span><button class="btn pri" data-a="doSend" data-v="${area}" data-t="${t}" style="margin-left:auto;width:auto"${S.sending || !n ? ' disabled' : ''}>${label} ${n}개 보내기</button></div>`
  const box = (on, a, attrs) => `<input type="checkbox" data-a="${a}" ${attrs}${on ? ' checked' : ''} style="margin:2px 8px 0 0;flex:none">`
  // 바뀐 것
  const chRows = qs.map(({ k, v }) => {
    if (!v || v.error || !v.items.length) return ''
    const rows = v.items.map((q) => {
      const what = q.kind === 'rec' ? '기록 — 전체' : q.isNew ? '새 문서 — 전체' : '고친 항목만 — ' + q.heads.join(' · ')
      const t = q.kind === 'rec' ? q.title : q.title
      return `<li data-t="sendItem" data-kind="${q.kind}" style="display:flex;align-items:flex-start">${box(chOn(k.id, q.key), 'sendCh', `data-k="${esc(k.id)}" data-v="${esc(q.key)}" data-t="sendCh"`)}<span style="display:flex;flex-direction:column;min-width:0;flex:1"><b>${esc(t)}</b><small class="muted">${esc(what)} · ${esc(whenTxt(q.when))}</small></span><span class="chip c-mute">${q.kind === 'rec' ? '기록' : '문서'}</span></li>`
    }).join('')
    return `${ks.length > 1 ? `<div class="rh" style="margin:8px 0 2px">${esc(k.name)}</div>` : ''}<ul class="plain">${rows}</ul>`
  }).join('')
  const anyCh = qs.some(({ v }) => v && !v.error && v.items.length)
  const candHtml = cand.length ? `<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:8px;font-size:12px;color:var(--text-2)"><div class="muted">받은편지함에서 — 넣으면 같이 간다</div>${cand.map((c) => `<div class="row" style="margin-top:4px">${box(c.on, 'candOn', `data-id="${esc(c.record)}" data-t="addCand"`)}<span class="kn none">메모</span><b>${esc(c.title)}</b><span class="muted">→ ${esc(c.name || c.to)}</span></div>`).join('')}</div>` : ''
  const changes = `<div class="card" data-t="sendChanges"><div class="ch">바뀐 것 <small>보낸 뒤 바뀐 문서 · 새로 남은 기록</small><span class="r" style="display:flex;gap:10px"><a class="lk" data-a="sendAll" data-v="1" data-t="sendAllOn">모두 고르기</a><a class="lk" data-a="sendAll" data-v="" data-t="sendAllOff">모두 빼기</a></span></div><div class="cb" style="padding:2px 14px 8px">${anyCh ? chRows : loading ? loadingHtml : '<p class="muted" data-t="sendEmpty">바뀐 것이 없다 — 내 지식에서 고치거나 기록을 남기면 여기에 저절로 모인다.</p>'}${candHtml}<div class="small muted" style="margin-top:6px">문서 — 새 문서면 전체, 아니면 바뀐 항목만 · 기록 — 전체 · 고르지 않은 것은 다음에 그대로 남는다</div></div>${goBtn('changes', '바뀐 것', nCh, 'sendBtn')}</div>`
  // 지식 — 문서 목록 · 기록 목록(여럿 골라 전체로)
  const fq = String(S.sendQ || '').trim().toLowerCase()
  const hit = (t) => !fq || String(t).toLowerCase().includes(fq)
  const listBox = (title, tkey, rows) => `<div style="flex:1;min-width:260px"><div class="rh" style="margin:0 0 4px">${title}</div><div style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:4px 8px" data-t="${tkey}">${rows || '<div class="muted small" style="padding:6px 0">없다</div>'}</div></div>`
  const know = qs.map(({ k, v }) => {
    if (!v || v.error) return ''
    const docs = (v.docs || []).filter((d) => hit(d.title) || hit(d.id)).map((d) => `<label class="row" style="margin:3px 0;cursor:pointer" data-t="sendDoc">${box(picked(k.id, 'd|' + d.path), 'sendPick', `data-k="${esc(k.id)}" data-v="${esc('d|' + d.path)}"`)}<span style="flex:1;min-width:0">${esc(d.id)}</span><small class="muted">${esc(whenTxt(d.when))}</small></label>`).join('')
    const recs = (v.recs || []).filter((r) => hit(r.title)).map((r) => `<label class="row" style="margin:3px 0;cursor:pointer" data-t="sendRec">${box(picked(k.id, 'r|' + r.id), 'sendPick', `data-k="${esc(k.id)}" data-v="${esc('r|' + r.id)}"`)}<span style="flex:1;min-width:0">${esc(r.title)}</span><small class="muted">${esc(r.author)} · ${esc(whenTxt(r.when))}</small></label>`).join('')
    return `${ks.length > 1 ? `<div class="rh" style="margin:10px 0 4px">${esc(k.name)}</div>` : ''}<div style="display:flex;gap:14px;flex-wrap:wrap">${listBox(`문서 <small class="muted">${(v.docs || []).length}</small>`, 'sendDocs', docs)}${listBox(`기록 <small class="muted">${(v.recs || []).length}</small>`, 'sendRecs', recs)}</div>`
  }).join('')
  const knowCard = ks.length ? `<div class="card" data-t="sendKnow"><div class="ch">지식 <small>문서 · 기록을 골라 전체로 보낸다</small><span class="r"><input class="inp" id="sendQ" data-in="sendQ" data-t="sendQ" value="${esc(S.sendQ || '')}" placeholder="이름으로 거르기" style="width:180px"></span></div><div class="cb" style="padding:8px 14px 10px">${loading ? loadingHtml : know}</div>${goBtn('know', '고른', nKw, 'sendKnowBtn')}</div>` : ''
  let top = ''
  for (const w of wait) top += `<div class="callout ${w.state === 'wait' ? 'gray' : 'warn'} stop" data-t="sendWait" data-state="${esc(w.state)}"><i></i><span><b>${w.state === 'wait' ? '팀 서버에 닿지 않는다' : '보내지 못했다'} — ${esc(w.from)} → ${esc(w.to)} ${w.n}개</b> · ${w.state === 'wait' ? '닿으면 저절로 보낸다' : esc(w.why || '')}${w.fix ? ' · ' + esc(w.fix) : ''} · ${esc(whenTxt(w.at))} 에 누른 것</span><span class="r" style="display:flex;gap:10px;margin-left:auto"><a class="lk" data-a="sendWaitAct" data-k="${esc(w.kn)}" data-id="${esc(w.id)}" data-v="retry" data-t="sendRetry">지금 다시</a><a class="lk q" data-a="sendWaitAct" data-k="${esc(w.kn)}" data-id="${esc(w.id)}" data-v="drop" data-t="sendDrop">버리기</a></span></div>`
  if (S.sendTargets === undefined) { S.sendTargets = null; getJSON('/api/send/targets').then((t) => { S.sendTargets = t; render() }, () => { S.sendTargets = { teams: [], local: [] } }) }
  const pickOpts = targets ? [...targets.teams.flatMap((t) => (t.kns || []).filter((x) => !x.private || isTeam()).map((x) => `<option value="${esc(t.url + '/r/' + encodeURIComponent(x.id))}">${esc(t.url.replace(/^https?:\/\//, ''))} › ${esc(x.name)}${x.private ? ' (내 개인 지식)' : ''}</option>`)), ...targets.local.map((x) => `<option value="${esc(x.id)}">이 kmd › ${esc(x.name)}</option>`)].join('') : ''
  const teamErr = targets ? targets.teams.filter((t) => t.error).map((t) => `${t.url.replace(/^https?:\/\//, '')} — ${t.error}`).join(' · ') : ''
  const destRows = S.kns.filter((k) => k.role === '주인' || !isTeam()).map((k) => `<div class="row" style="margin-top:6px;flex-wrap:wrap" data-t="destRow"><span style="min-width:110px"><b>${esc(k.name)}</b></span><input class="inp mono" style="flex:1;min-width:220px" id="dest-${esc(k.id)}" value="${esc((k.dests || []).join(', '))}" placeholder="보낼 지식 — 오른쪽에서 고른다"><select class="inp" data-k="${esc(k.id)}" data-t="destPick" style="width:auto"><option value="">${targets ? '팀 › 지식 고르기' : '팀 지식 목록을 받는 중…'}</option>${pickOpts}</select><button class="btn sm" data-a="setDests" data-k="${esc(k.id)}" data-t="destSave">저장</button></div>`).join('') + (teamErr ? `<p class="small muted" style="margin-top:6px">${esc(teamErr)}</p>` : '')
  const lead = ks.length ? `<p class="lead">만들어진 지식만 보낸다 — 바뀐 것은 골라 두었다 · 더 보낼 문서 · 기록은 지식에서 고른다 · 영역마다 보내기 단추를 누르면 ${esc(dnK)}으로 간다.</p>` : '<p class="lead">보낼 곳을 정한 내 지식이 없다 — 아래 자세히에서 정한다.</p>'
  return { crumb: '지식 보내기', main: `<div style="max-width:900px"><div class="big">지식 보내기</div>${lead}
  ${S.stops.filter((s) => s.level === 'warn' && s.kind !== 'send').map(stopHtml).join('')}${top}${ks.length ? changes + knowCard : ''}
  <div class="feed" style="margin-top:14px" data-t="sentFeed"><div class="fh">보낸 것</div>${log.map((x) => `<div class="fi" data-t="sentRow"><div class="ln"><span class="tm">${esc(whenTxt(x.at))}</span><span class="dot ${x.late || x.wait ? 'acc' : ''}"></span><span class="tx">${esc(x.to.map((d) => (KN(d) || {}).name || d).join(' · '))}로 ${x.n}개를 ${x.wait ? '보내려 했다' : '보냈다'}${x.late ? `<small>${esc(whenTxt(x.late))} 에 누른 것</small>` : x.wait ? '<small>닿으면 저절로 보낸다</small>' : ''}${x.fail ? `<small>${x.fail}개는 보내지 못했다 — 위 줄에서 [다시]</small>` : ''}${x.titles && x.titles.length ? `<small>${esc(x.titles.join(' · '))}${x.n > x.titles.length ? ` 외 ${x.n - x.titles.length}` : ''}</small>` : ''}</span></div></div>`).join('') || '<div class="fi"><div class="ln"><span class="tx muted">아직 없다</span></div></div>'}</div>
  <details class="more"${ks.length ? '' : ' open'}><summary>자세히</summary><div class="in">${esc(S.me.user)} 이름으로 간다${isTeam() ? '' : ' — 이 PC 가 설치 때 팀에 이어진 대로'}. 받는 지식에는 고른 것마다 기록 하나로 들어가고, 정리 때 kmd 가 문서에 넣는다(누구나 [지금 정리]). 값이 바뀌면 나에게 「이력」 노란 줄로 알린다. 내 글은 그대로다.<div class="rh" style="margin-top:10px">보낼 곳</div>${destRows || '<span class="muted">내 지식이 없다</span>'}</div></details></div>` }
}
async function loadCand() {
  const ib = S.kns.find((k) => k.name === '받은편지함')
  if (!ib || S.cand) return
  S.cand = []
  try { S.cand = (await postJSON(`/api/k/${encodeURIComponent(ib.id)}/inbox/tidy`, { dry: true })).candidates.map((c) => ({ ...c, on: false, from: ib.id })) } catch {}
  render()
}
async function doSend(area) {
  S.sending = true
  render()
  let n = 0, w = 0
  const bad = []
  try {
    for (const k of sendKns()) {
      const v = S.cache['send:' + k.id]
      if (!v || v.error) continue
      const changes = area === 'changes' ? v.items.filter((q) => chOn(k.id, q.key)).map((q) => q.key) : []
      const sel = area === 'changes' ? [] : Object.keys(S.sendSel || {}).filter((x) => S.sendSel[x] && x.startsWith(k.id + '|')).map((x) => x.slice(k.id.length + 1))
      const docs = sel.filter((x) => x.startsWith('d|')).map((x) => x.slice(2))
      const recs = sel.filter((x) => x.startsWith('r|')).map((x) => x.slice(2))
      if (!changes.length && !docs.length && !recs.length) continue
      const r = await postJSON(`/api/k/${encodeURIComponent(k.id)}/send`, { changes, docs, recs })
      n += r.sent
      w += r.wait
      if (r.fail) bad.push(...(r.why || []))
    }
    for (const c of (area === 'changes' ? S.cand || [] : []).filter((x) => x.on)) {
      await postJSON(`/api/k/${encodeURIComponent(c.from)}/inbox/send`, { record: c.record, to: c.to })
      n++
    }
    if (area === 'changes') { S.cand = null; S.sendOff = {} } else S.sendSel = {}
    toast(bad.length ? `보내지 못했다 — ${esc(bad[0])}` : w ? `닿지 않는다 — ${w}개는 닿으면 저절로 보낸다` : `보냈다 — ${n}개 · 정리 때 문서에 들어간다`, bad.length ? 9000 : undefined)
  } catch (e) { toast(esc(e.message), 7000) }
  S.sending = false
  for (const key of Object.keys(S.cache)) if (key.startsWith('send:')) delete S.cache[key]
  delete S.cache.history
  await reloadKns()
  loadStops()
  render()
}

// ── 팀 화면 ↔ 내 PC(E8 · v0.5 §5 · v0.6 ⑫) ──
// 설치가 팀 주소를 내 PC 프로그램에 적어 두었으면 물으면 바로 12시간 짝 열쇠를 준다(누름 없음 · 탭 메모리만).
// 내 PC 지식의 id 는 ~ 로 시작하고 그 요청은 reqTo 가 내 PC 프로그램으로만 보낸다.
function pcRemembered() { try { return JSON.parse(localStorage.getItem('kmdPcKns') || '[]') } catch { return [] } }
// 내 PC 프로그램은 이 PC 안이라 보통 곧 답한다 — 늦어도 팀 화면은 기다리지 않는다(뒤에서 잇는다) · 넣기 · 정리로 바쁜 PC 를
// 꺼짐으로 보지 않게 넉넉히 기다린다 · 꺼져 있었으면 15초마다 · 창으로 돌아올 때 다시 잇는다(「켜면 저절로 다시 열린다」)
const PC_MS = 15000
function fetchPc(u, opt = {}) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), PC_MS)
  return fetch(u, { ...opt, signal: c.signal }).finally(() => clearTimeout(t))
}
// quiet — 다시 잇기. 붙을 때까지 지금 상태(꺼짐 줄 · 흐린 카드)를 그대로 둔다(「잇는 중」 으로 깜박이지 않게)
async function pcConnect(again, { quiet = false } = {}) {
  const url = S.me.pcUrl
  if (!url) return
  let seen = false, tok = null
  try { seen = !!localStorage.getItem('kmdPcSeen'); tok = sessionStorage.getItem('kmdPair') } catch {}
  const pc = { url, token: null, kns: [], off: false, deny: null, seen, wait: true }
  if (!quiet) { S.pc = pc; S.kns = S.kns.filter((k) => !k.pc) }
  try {
    if (!tok) {
      // 팀 서버의 한 번용 표 — 내 PC 프로그램이 이 PC 의 기기 열쇠로 「들어온 사람 = 이 PC 를 이은 사람」 을 팀 서버에 물어 본다
      const { pass } = await postJSON('/api/me/pcpass', {})
      const r = await fetchPc(url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass }) })
      const j = await r.json().catch(() => ({}))
      if (r.status === 403 && (j.need === 'connect' || j.need === 'person')) { pc.deny = j.message; pc.wait = false; S.pc = pc; return }
      if (!r.ok) throw new Error(j.message || '')
      tok = j.token
      try { sessionStorage.setItem('kmdPair', tok); localStorage.setItem('kmdPcSeen', '1') } catch {}
    }
    pc.token = tok
    const r2 = await fetchPc(url + '/api/knowledge', { headers: { authorization: 'Bearer ' + tok } })
    if (r2.status === 401 && !again) { try { sessionStorage.removeItem('kmdPair') } catch {} return pcConnect(true, { quiet }) }
    if (!r2.ok) throw new Error('')
    pc.kns = (await r2.json()).map((k) => ({ ...k, id: '~' + k.id, pc: true, role: null, dests: k.dests || null, sendN: k.sendN || 0 }))
    pc.wait = false
    S.pc = pc
    S.kns = [...S.kns.filter((k) => !k.pc), ...pc.kns]
    try { localStorage.setItem('kmdPcKns', JSON.stringify(pc.kns.map((k) => ({ id: k.id, name: k.name, docs: k.docs })))) } catch {}
  } catch {
    pc.off = true
    pc.token = null
    pc.wait = false
    if (!quiet) S.pc = pc
  }
}
// 칸에 쓰는 중이면 다시 그리지 않는다(상태는 바뀌었으니 다음에 그릴 때 보인다)
const typing = () => !!document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
function pcRetry() {
  if (!S.me || gated() || !isTeam() || !S.pc || !S.pc.off || S.pc.wait || S._pcRetry) return
  S._pcRetry = true
  pcConnect(false, { quiet: true }).then(() => { S._pcRetry = false; if (!S.pc.off && !typing()) render() })
}
setInterval(pcRetry, 15000)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pcRetry() })
window.addEventListener('focus', pcRetry)
// ── 설정(목업 M13) — 일반 · Claude 연결 · 에이전트 설치 ──
const settingsOf = () => need('settings', '/api/settings')
const devicesOf = () => need('devices', '/api/me/devices')
const AUTO_T = {
  team: [['file', '넣은 파일을 글로', 'md · docx · pptx · xlsx 를 글로 바꿔 기록으로 — 정리가 문서에 넣는다 · 끄면 원본 첨부만'], ['find', '찾기', '딱 맞는 항목이 없으면 비슷한 글에서']],
  pc: [['save', '편집기에서 고친 것 저장', '30초 조용하면 저절로'], ['file', '넣은 파일을 글로', 'md · docx · pptx · xlsx 를 넣으면 기록 · 문서로 바로(Claude 로 다듬어) · 끄면 원본 첨부만'], ['src', '자동으로 가져오는 곳', '더해 둔 곳에서 때마다 표를 다시 채운다'], ['claude', '기록을 문서로 — Claude 로', '기록이 남으면 곧바로 내 Claude 로그인으로 다듬어 넣는다 · 끄면 규칙으로'], ['find', '찾기', '딱 맞는 항목이 없으면 비슷한 글에서']],
}
function viewSettings() {
  const team = isTeam(), st = settingsOf(), tab = S.setTab || 'gen'
  const ST = [['gen', '일반'], ['claude', 'Claude 연결'], ['agent', '에이전트 설치']]
  const tabs = `<div class="tabs" data-t="setTabs">${ST.map(([v, l]) => `<span class="${tab === v ? 'on' : ''}" data-a="setTab" data-v="${v}" data-t="st-${v}">${l}</span>`).join('')}</div>`
  if (!st || st.error) return { crumb: '설정', main: `<div style="max-width:980px"><div class="big">설정</div>${tabs}${st ? errHtml(st) : loadingHtml}</div>` }
  const body = tab === 'claude' ? `<div style="max-width:720px">${claudeCard(st)}${modelCard(st)}</div>` : tab === 'agent' ? `<div style="max-width:760px">${agentCard()}</div>` : `<div class="g2"><div>${setLeft(st)}</div><div>${autoCard(st)}</div></div>`
  return { crumb: '설정' + (tab === 'gen' ? '' : ' › ' + ST.find((x) => x[0] === tab)[1]), main: `<div style="max-width:980px"><div class="big">설정</div>${tabs}${body}</div>` }
}
// 일마다 Claude 모델 — 이 PC 만(core/models.js) · 옮겨 적기 · 고르기는 가벼운 모델 · 판단은 큰 모델
const MODEL_T = [['convert', 'pdf · hwp 를 글로', '글이 없는 pdf · 표가 깨진 hwp 만 — 옮겨 적기'], ['read', '넣은 파일의 기록 정리', '무엇 · 핵심 · 정한 것 · 남은 것'], ['touch', '기록의 이름 고르기', '후보 안에서 고른다'], ['tidy', '항목 글 초안', '기록을 항목에 넣어 다시 쓴다'], ['commit', '코드 바뀜 분석', '커밋 차이를 읽는다'], ['agent', '지식에 들이기(에이전트)', '둘러보고 자리 · 이름을 정한다']]
function modelCard(st) {
  if (isTeam() || !st.models) return ''
  const opt = [['haiku', 'Haiku — 빠르고 싸다'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['', '기본 — Claude Code 의 모델']]
  return `<div class="card" data-t="modelCard"><div class="ch">Claude 모델 <small>일마다</small></div><div class="cb" style="padding:2px 14px">${MODEL_T.map(([r, l, d]) => `<div class="set" data-t="model-${r}"><span class="tx"><b>${l}</b><small>${d}</small></span><select class="inp" data-model="${r}" data-t="msel-${r}" style="width:auto">${opt.map(([v, t]) => `<option value="${v}"${st.models[r] === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`).join('')}</div><div class="cf">옮겨 적기 · 고르기는 가벼운 모델로, 판단이 필요한 일만 큰 모델로 — 같은 일을 덜 쓰고 빨리 한다.</div></div>`
}
function autoCard(st) {
  const A = AUTO_T[isTeam() ? 'team' : 'pc']
  const all = A.every((a) => st.auto[a[0]])
  return `<div class="card"><div class="ch">저절로 하는 일 <small>${all ? '모두 켬' : '일부 끔'}</small></div><div class="cb" style="padding:2px 14px">${A.map((a) => `<div class="set" data-t="auto-${a[0]}"><span class="tx"><b>${a[1]}</b><small>${st.auto[a[0]] ? a[2] : '꺼 두었다 — 켜면 다시 한다'}</small></span><button class="sw${st.auto[a[0]] ? ' on' : ''}" data-a="toggleAuto" data-v="${a[0]}" data-t="sw-${a[0]}" aria-label="${a[1]}"></button></div>`).join('')}</div><div class="cf">멈추면 맨 위에 한 줄로 알린다.</div></div>`
}
function devCard() {
  const devs = devicesOf()
  const rows = !devs ? '<li class="muted">읽는 중…</li>' : devs.error ? '' : devs.map((d) => `<li data-t="devRow" data-name="${esc(d.host || d.id)}"><span style="flex:1"><b>${esc(d.host || '이름 없는 기기')}</b><small class="muted" style="display:block">Claude Code · ${d.used ? '마지막 사용 ' + esc(whenTxt(d.used)) : '이은 때 ' + esc(whenTxt(d.at))}</small></span><button class="kebab" data-a="menu" data-m="dev:${esc(d.id)}" data-t="devKebab">⋯${S.menu === 'dev:' + d.id ? `<div class="menu" style="right:0;top:28px"><div class="mi" data-a="unlinkMyDev" data-id="${esc(d.id)}" data-t="unlinkBtn">끊기<small>그 기기의 Claude Code 는 다시 이어야 한다</small></div></div>` : ''}</button></li>`).join('')
  return `<div class="card" style="overflow:visible"><div class="ch">내 기기 <small>내 이름으로 ${isTeam() ? '팀 kmd' : '이 kmd'} 를 쓰는 곳</small></div><div class="cb" style="padding:2px 14px"><ul class="plain" data-t="devList">${rows || '<li class="muted">이어진 기기가 없다</li>'}</ul><p class="small muted">90일 안 쓰면 저절로 끊긴다.</p></div></div>`
}
function setLeft(st) {
  const bk = st.backup.n ? `${esc(st.backup.urls.join(' · '))} · 저장할 때마다 저절로${st.backup.n < st.backup.of ? ` · 지식 ${st.backup.of - st.backup.n} 은 아직 없다` : ''}` : '아직 없다 — 관리자가 붙인다'
  if (isTeam()) return `<div class="card" style="overflow:visible"><div class="ch">이 팀 서버 <small class="mono">${esc(st.host)}</small></div><div class="cb"><div class="kv"><span>들어가기</span><span>아이디 ${esc(S.me.user)} · 비밀번호는 브라우저가 기억한다 <a class="small" data-a="logout" data-t="logout">나가기</a></span><span>내 지식</span><span>${S.pc && S.pc.kns.length ? '내 PC 지식 ' + S.pc.kns.length + ' — 내 PC 프로그램이 연다' : S.kns.some((k) => k.private) ? '받은편지함 · 내 지식 — 이 서버 안 · 나만 쓴다' : '아직 없다 — 새 지식에서'}</span><span>백업</span><span>${bk}</span><span>판</span><span>kmd v${esc(st.version)}</span></div></div>${S.me.admin ? '<div class="cf"><a class="lk" data-a="nav" data-s="admin">관리 — 문제 · 사람 · 백업 →</a></div>' : ''}</div>` + devCard()
  const pcBad = S.stops.find((x) => x.kind === 'backup')
  return `<div class="card"><div class="ch">이 PC</div><div class="cb"><div class="kv"><span>지식 폴더</span><span><span class="mono">${esc(st.root)}</span> — 지식 ${st.kns}</span><span>백업 자리</span><span data-t="pcBackup">${st.backup.root ? `<span class="mono">${esc(st.backup.root)}</span> · ` : ''}붙음 ${st.backup.n}/${st.backup.of}${st.backup.bad ? ` · <b style="color:var(--warn)">맞지 않음 ${st.backup.bad}</b>` : ''} ${!st.backup.n ? '<span class="chip c-warn">백업 없음</span>' : pcBad ? `<span class="chip c-warn">${esc(pcBad.b)}</span><small>${esc(pcBad.t)}</small>` : st.backup.n < st.backup.of ? '<span class="chip c-warn">일부만</span>' : '<span class="chip c-acc">잘 된다</span>'}</span><span>보낼 곳</span><span>${(st.dests || []).map((d) => esc(d.name) + ' → ' + esc(d.to.join(' · '))).join(' · ') || '없다 — 보내기 › 자세히에서'}</span><span>판</span><span>kmd v${esc(st.version)}</span></div></div></div>
  <div class="card" data-t="pcBackupCard"><div class="ch">백업 <small>이 PC 를 잃어도 남게 — 다른 드라이브 · 네트워크 폴더 · USB</small></div><div class="cb" style="padding:4px 14px 10px">
   <div class="row"><input class="inp mono" id="bkRoot" data-t="bkRoot" style="flex:1" value="${esc(st.backup.root || '')}" placeholder="예: E:\\kmd-백업 · \\\\nas\\kmd"><button class="btn sm" data-a="bkRootSet" data-t="bkRootSet">${st.backup.root ? '바꾸기' : '정하기'}</button></div>
   <p class="small muted" style="margin:6px 0 0">정하면 붙지 않은 지식을 모두 그 아래(<span class="mono">&lt;지식&gt;.git</span>)에 붙이고 저장할 때마다 보낸다 · 새 지식 · 되살린 지식도 저절로</p>
   ${(st.backup.list || []).filter((x) => !x.url).length ? `<p class="small" style="margin:6px 0 0">아직 없는 지식 — ${esc(st.backup.list.filter((x) => !x.url).map((x) => x.name).join(' · '))}</p>` : ''}
   <div class="rh" style="margin-top:10px">백업에서 되살리기</div>
   <div class="row" style="flex-wrap:wrap"><input class="inp mono" id="rsUrl" data-t="rsUrl" style="flex:1;min-width:220px" placeholder="백업 주소 — 예: E:\\kmd-백업\\설계메모.git"><input class="inp" id="rsName" data-t="rsName" style="width:140px" placeholder="이름(비우면 주소의 끝)"><label class="small"><input type="checkbox" id="rsPractice" data-t="rsPractice"> 연습(백업에 보내지 않는다)</label><button class="btn sm" data-a="restoreDo" data-t="restoreDo"${S.restoring ? ' disabled' : ''}>${S.restoring ? '되살리는 중…' : '되살리기'}</button></div></div></div>
  <div class="card" style="overflow:visible"><div class="ch">이어진 것</div><div class="cb" style="padding:2px 14px"><ul class="plain"><li><span style="flex:1"><b>Claude Code</b><small class="muted" style="display:block">작업 폴더 ${(S.cache.agent && S.cache.agent.folders ? S.cache.agent.folders.length : 0)} <a data-a="setTab" data-v="agent">에이전트 설치 ›</a></small></span></li><li><span style="flex:1"><b>팀 kmd</b><small class="muted" style="display:block">${st.teams && st.teams.length ? '이 팀 화면에 들어온 내가 내 PC 지식을 연다(읽기 · 저장만)' : '아직 잇지 않았다 — 팀 화면의 설치 한 줄'}</small></span></li>${(st.teams || []).map((u) => `<li data-t="teamRow"><span style="flex:1">${esc(u.replace(/^https?:\/\//, ''))}</span><button class="btn sm" data-a="pairForget" data-v="${esc(u)}" data-t="pairForget">끊기</button></li>`).join('')}</ul><p class="small muted">밖으로 나가는 것은 보내기 · 백업 · Claude 정리뿐이다.</p></div></div>` + devCard()
}
function claudeCard(st) {
  const c = st.claude, w = c.worker
  if (!isTeam()) {
    // 로그인 — 「kmd — Claude 로그인」 창(claude auth login)이 브라우저를 연다 · 화면은 그 창을 알려 주고 저절로 확인한다
    const L = S.pcLogin || null
    let flow = ''
    if (L) flow = `<div class="flow" data-t="claudeFlow"><p style="margin:0 0 6px"><b>작업 표시줄의 「kmd — Claude 로그인」 창</b>이 떴다 — 그 창이 브라우저를 연다. 브라우저에서 Claude 에 들어가면 끝이다.</p><p class="small muted" style="margin:0 0 8px">창이 안 보이면 작업 표시줄에서 그 창을 누른다 · 브라우저가 안 열리면 그 창에 나온 주소를 연다 · 다 되면 그 창은 닫아도 된다</p><div class="row"><span class="prog" data-t="claudeWait"><i></i>${L.checking ? '로그인을 확인하는 중…' : L.last ? esc(L.last) : '로그인을 기다린다 — 몇 초마다 저절로 확인한다'}</span><button class="btn sm" data-a="pcLoginCheck" data-t="claudeCheck" style="margin-left:auto">지금 확인</button><a class="lk" data-a="pcLoginCancel" style="margin-left:10px">그만두기</a></div></div>`
    const ok = w && w.ok, bad = w && w.ok === false
    const state = bad ? (w.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : '로그인이 끝났다 — 다시 로그인한다') : ok ? '로그인됨 — 이 PC 의 Claude Code' : '아직 확인 전 — [로그인 확인] 으로 본다'
    const row = `<div class="set"><span class="tx"><b data-t="claudeState">${state}</b><small>파일 · 기록을 Claude 로 다듬어 문서에 넣는다(안 되면 규칙으로) · 이번 달 ${c.month}건 · 로그인은 이 PC 의 Claude Code 로그인</small></span>${L ? '' : `<button class="btn" data-a="pcLoginCheck" data-t="claudeCheck" style="width:auto">로그인 확인</button><button class="btn${ok ? '' : ' pri'}" data-a="pcLoginStart" data-t="claudeLogin" style="width:auto">${ok ? '다시 로그인' : 'Claude 로그인'}</button>`}<button class="kebab${S.menu === 'claude' ? ' on' : ''}" data-a="menu" data-m="claude" data-t="claudeKebab" title="쓰지 않기">⋯${S.menu === 'claude' ? '<div class="menu" style="right:0;top:28px"><div class="mi" data-a="claudeOff" data-t="claudeOff">Claude 쓰지 않기<small>규칙으로 되는 것만</small></div></div>' : ''}</button></div>`
    return `<div class="card" data-t="claudeCard" style="overflow:visible"><div class="ch">Claude 연결 <small>이 프로그램이 쓰는 Claude 로그인</small></div><div class="cb" style="padding:2px 14px 10px">${row}${flow}</div><div class="cf">Claude Code 의 로그인은 진짜 터미널 창에서 돈다 — [Claude 로그인] 이 「kmd — Claude 로그인」 창을 띄우고, 이 화면이 저절로 확인한다</div></div>`
  }
  const rest = w && w.ok === false
  const days = rest ? Math.max(1, Math.round((Date.now() - Date.parse(w.since)) / 864e5)) : 0
  const pcLine = `<div class="set"><span class="tx"><b>내 PC 일꾼 — 내 개인 지식을 내 Claude 로</b><small data-t="claudePcLine">${st.pcWorker ? `마지막으로 본 때 ${esc(whenTxt(st.pcWorker))}` : '아직 일감을 물은 적이 없다 — 내 개인 지식은 팀 서버가 규칙으로 넣는다'}${S.pc && S.pc.off ? ' · 지금 내 PC 프로그램이 꺼져 있다 — 켜기 전에는 하루 기다린 뒤 규칙으로' : ''} · 로그인은 내 PC 프로그램의 설정에서</small></span></div>`
  return `<div class="card" data-t="claudeCard"><div class="ch">Claude 연결 <small>읽기만</small></div><div class="cb" style="padding:2px 14px"><div class="set"><span class="tx"><b data-t="claudeRead">팀 정리는 정리 전용 로그인으로 돈다 — 쉬면 관리자에게 알린다</b><small>${rest ? `지금 쉬고 있다 · ${days}일 — 관리자에게 알렸다` : (c.team && c.team.token) || (w && w.ok) ? '지금 돈다 · 로그인해 두는 것은 관리자' : '아직 로그인하지 않았다 — 관리자가 한다'}</small></span></div>${pcLine}</div>${S.me.admin ? '<div class="cf"><a class="lk" data-a="nav" data-s="admin" data-t="toAdmClaude">관리 › Claude 연결 →</a></div>' : ''}</div>`
}
// 로그인 확인 — 작은 부르기 한 번 · 됐으면 흐름을 닫는다
async function pcLoginCheck(byHand) {
  if (S.pcLogin) S.pcLogin.checking = true
  render()
  let r = null
  try { r = await postJSON('/api/claude/check', {}) } catch (e) { r = { ok: false, reason: e.message } }
  delete S.cache.settings
  if (S.claude && r.reason !== undefined) Object.assign(S.claude, { ok: !!r.ok, reason: r.reason || null, at: new Date().toISOString() })
  if (r.ok) { S.pcLogin = null; toast('로그인됨 — 이제 가져온 지식을 Claude 가 읽고 기록 · 문서로 쓴다') }
  else if (S.pcLogin) { S.pcLogin.checking = false; S.pcLogin.last = r.reason === 'login' ? '아직 로그인 전 — 그 창 · 브라우저에서 마치면 저절로 확인한다' : r.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : '확인하지 못했다 — 다시 본다' }
  else if (byHand) toast(r.reason === 'login' ? '로그인이 끝났다 — [Claude 로그인] 으로 다시 들어간다' : r.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : '확인하지 못했다')
  render()
  return r.ok
}
// ── 지금 하는 일 — 왼쪽 위 「kmd」 옆 점(일이 있으면 깜빡인다) · 누르면 작은 팝업에 내역 ──
//   가져오기(지켜보며 맞추기) · Claude Code 일(넣은 파일 · 코드 바뀜) · 정리 일감 · 기록을 문서에 넣는 중. 일이 있으면 3초 · 없으면 15초마다 읽는다
const BUSY_K = { source: '가져오기', run: 'Claude Code', tidy: '정리', curate: '문서에 넣기' }
function busyDot() {
  if (anon() || gated()) return ''
  const n = ((S.busy && S.busy.items) || []).length
  if (S.menu === 'busy') S._pop = { key: 'busy', html: busyPopHtml() }
  return `<button class="busy${n ? ' on' : ''}${S.menu === 'busy' ? ' open' : ''}" data-a="menu" data-m="busy" data-t="busyDot" data-n="${n}" title="${n ? `지금 하는 일 ${n} — 누르면 내역` : '지금 하는 일 없음'}"><i></i>${n ? `<span>${n}</span>` : ''}</button>`
}
function busyPopHtml() {
  const xs = (S.busy && S.busy.items) || []
  const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 1000)); return s < 60 ? `${s}초` : s < 3600 ? `${Math.floor(s / 60)}분` : `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분` }
  const rows = xs.map((x) => `<div class="mi brow" data-a="busyGo" data-kind="${esc(x.kind)}" data-k="${esc(x.kn)}" data-run="${esc(x.run || '')}" data-t="busyRow"><i class="bd"></i><span class="bt"><b>${esc(x.title)}</b><small>${esc(BUSY_K[x.kind] || x.kind)} · ${esc(x.knName)} · ${esc(x.small || '')}</small></span><small>${ago(x.since)}</small></div>`).join('')
  return `<div class="gray" style="padding-top:2px"><b style="color:var(--text)">지금 하는 일</b> ${xs.length ? xs.length : ''}</div>${rows || '<div class="gray" data-t="busyNone">지금 하는 일이 없다 — 가져오기 · 정리 · Claude Code 일이 돌면 여기 보인다</div>'}`
}
let busyTimer = null
async function loadBusy() {
  clearTimeout(busyTimer)
  if (!S.me || anon()) return
  const before = JSON.stringify((S.busy && S.busy.items) || [])
  const v = await getJSON('/api/busy').catch(() => null)
  if (v) {
    S.busy = v
    // 바뀌었거나 팝업이 열려 있으면(지난 시간) 다시 그린다 — 쓰는 중인 칸은 건드리지 않는다
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
    if ((JSON.stringify(v.items) !== before || S.menu === 'busy') && !typing) render()
  }
  busyTimer = setTimeout(loadBusy, v && v.items.length ? 3000 : 15000)
}
// ── Claude 연결 — 머리의 칩 · 창 ──
//   가져온 지식(넣은 파일 · git 커밋)은 Claude 가 읽고 기록으로 쓰고, 그 기록으로 문서를 세운다 — 구독형 Claude 로그인이 있어야 한다.
//   로그인은 이 PC 의 Claude Code 에 남아 저절로 이어진다. 화면은 30분마다 상태를 읽고, 6시간이 지났으면 작은 부르기로 확인하고,
//   끝났으면(로그인 · 한도) 칩이 빨갛게 · 들어올 때 창을 한 번 띄운다
async function loadClaude({ verify = false } = {}) {
  try { S.claude = await getJSON('/api/claude/state') } catch { return }
  const c = S.claude
  if (verify && c.pc && !c.off && (c.ok !== true || !c.at || Date.now() - Date.parse(c.at) > 6 * 3600_000)) {
    const r = await postJSON('/api/claude/check', {}).catch(() => null)
    if (r) Object.assign(c, { ok: r.ok, reason: r.reason || null, at: new Date().toISOString() })
  }
  if (c.pc && !c.off && c.ok === false && !S.claudeAsked) { S.claudeAsked = true; S.claudeWin = true }
  render()
}
function claudeOpen() { S.claudeWin = true; render() }
function claudeTone(c) { return !c ? 'unk' : c.off ? 'off' : c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'unk' }
function claudeChip() {
  const c = S.claude, st = claudeTone(c)
  const tip = { ok: 'Claude 연결됨', bad: c && c.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : 'Claude 로그인이 필요하다', off: 'Claude 쓰지 않음', unk: 'Claude 연결 — 아직 확인 전' }[st]
  return `<a class="hlink cchip ${st}" data-a="claudeOpen" data-t="claudeChip" data-state="${st}" title="${tip} — 누르면 연결 창">${'<i class="cdot"></i>'}<span>Claude</span></a>`
}
function claudeWinHtml() {
  const c = S.claude || {}, st = claudeTone(S.claude), L = S.pcLogin
  const stateTxt = { ok: '연결됨 — 이 PC 의 Claude Code 로그인', bad: c.reason === 'limit' ? 'Claude 사용 한도에 닿았다 — 한도가 풀리면 저절로 이어진다' : '로그인이 필요하다 — 아래 [Claude 로그인]', off: 'Claude 쓰지 않기로 해 두었다 — 설정 › 저절로 하는 일에서 켠다', unk: '아직 확인 전 — [로그인 확인] 으로 본다' }[st]
  const when = c.at ? ` · ${esc(whenTxt(c.at))} 확인` : ''
  const why = '<p class="small" style="margin:0 0 8px">kmd 는 가져온 지식 — <b>넣은 파일 · git 커밋</b> — 을 Claude 가 읽고 분석해 <b>기록</b>으로 쓰고, 그 기록으로 <b>문서</b>를 세운다. 그래서 구독형 Claude(Pro · Max · Team · Enterprise) 로그인이 있어야 한다. 로그인이 없으면 받은 글 그대로 기록하고 규칙으로만 넣는다.</p>'
  let body, foot
  if (c.pc) {
    const flow = L ? `<div class="callout gray" data-t="claudeWinFlow" style="display:block"><b>작업 표시줄의 「kmd — Claude 로그인」 창</b>이 떴다 — 그 창이 브라우저를 연다.<ol class="small"><li>브라우저에서 Claude 계정(구독)으로 들어가 <b>허락</b>을 누른다</li><li>「로그인됨」 이 나오면 그 창은 닫아도 된다</li><li>이 창이 몇 초마다 저절로 확인한다</li></ol><div class="row" style="margin-top:8px"><span class="prog" data-t="claudeWait"><i></i>${L.checking ? '로그인을 확인하는 중…' : L.last ? esc(L.last) : '로그인을 기다린다'}</span><a class="lk" data-a="pcLoginCancel" style="margin-left:auto">그만두기</a></div><p class="small muted" style="margin:6px 0 0">창이 안 보이면 작업 표시줄에서 누른다 · 브라우저가 안 열리면 그 창에 나온 주소를 연다</p></div>` : ''
    body = `${why}<div class="cst cchip ${st}" data-t="claudeWinState"><i class="cdot"></i><b>${stateTxt}</b><small class="muted">${when}</small></div>${flow}<p class="small muted" style="margin:8px 0 0">로그인은 이 PC 의 Claude Code 에 남아 다시 켜도 이어진다 · kmd 가 때때로 확인하고 끝나면 이 창을 다시 띄운다</p>`
    foot = `<a class="muted" data-a="claudeClose" style="align-self:center;margin-right:auto">닫기</a><button class="btn" data-a="pcLoginCheck" data-t="claudeWinCheck"${L && L.checking ? ' disabled' : ''}>로그인 확인</button>${L ? '' : `<button class="btn${st === 'ok' ? '' : ' pri'}" data-a="pcLoginStart" data-t="claudeWinLogin">${st === 'ok' ? '다시 로그인' : 'Claude 로그인'}</button>`}`
  } else {
    body = `${why}<div class="cst cchip ${st}" data-t="claudeWinState"><i class="cdot"></i><b>${st === 'ok' ? '팀 정리 로그인이 돈다' : st === 'bad' ? '팀 정리 로그인이 쉬고 있다 — 관리자에게 알렸다' : '팀 정리 로그인 — 관리자가 해 둔다'}</b><small class="muted">${when}</small></div><p class="small muted" style="margin:8px 0 0">팀 지식은 팀 서버의 정리 전용 Claude 로그인으로 · 내 개인 지식은 내 PC 프로그램의 Claude 로그인으로 한다(내 PC 프로그램 화면의 머리 「Claude」).</p>`
    foot = `<a class="muted" data-a="claudeClose" style="align-self:center;margin-right:auto">닫기</a>${S.me.admin ? '<button class="btn pri" data-a="claudeToAdmin" data-t="claudeToAdmin">관리 › Claude 연결</button>' : ''}`
  }
  return `<div class="pscrim" data-a="claudeClose" data-self="1"><div class="modal win cwin" data-t="claudeWin" style="width:min(520px,94%)"><div class="tb"><b>Claude 연결</b><button class="x" data-a="claudeClose" title="닫기" style="margin-left:auto;border:0;background:none;cursor:pointer;font-size:16px">×</button></div><div class="wb">${body}</div><div class="wf">${foot}</div></div></div>`
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
      return `<li data-t="agentRow" data-name="${esc(f.name)}"><span style="flex:1;min-width:0"><b>${esc(f.name)}</b><small class="muted mono" style="display:block">${esc(f.path)}</small></span>${old ? `<span class="chip c-warn" data-t="agentState">${f.state === 'none' ? '없음 — 다시 붙인다' : '옛 판 — 고침 있음'}</span><small class="muted">${esc(f.ver || '')}</small>` : `<span class="chip c-acc" data-t="agentState">최신 · ${esc(A.latest)}</span>`}<button class="kebab${S.menu === mk ? ' on' : ''}" data-a="menu" data-m="${esc(mk)}" data-t="agentKebab" title="최신으로 · 빼기">⋯${S.menu === mk ? `<div class="menu" style="right:0;top:28px">${old ? `<div class="mi" data-a="agentUp" data-v="${esc(f.path)}" data-t="agentUp">최신으로<small>kmd 안내만 바꾼다</small></div>` : ''}<div class="mi" data-a="agentRm" data-v="${esc(f.path)}" data-t="agentRm">빼기<small>스킬 · 연결 · kmd 안내를 걷는다</small></div></div>` : ''}</button></li>`
    }).join('')
    const add = S.agAdding ? `<div class="paste" style="margin-top:10px"><input class="inp mono" id="agIn" data-in="ag" data-t="agIn" value="${esc(S.agDraft || '')}" placeholder="작업 폴더 경로 — 예: D:\\work\\dpms-batch" autocomplete="off"><span id="agBtnBox">${agBtn()}</span></div>` : '<button class="btn pri" data-a="agentAdd" data-t="agentAddBtn" style="margin-top:10px">폴더 더하기</button>'
    return `<div class="card" data-t="agentCard" style="overflow:visible"><div class="ch">에이전트 설치 <small>Claude Code 에 kmd 를 붙인다 — 작업 폴더마다</small><span class="r"><button class="kebab${S.menu === 'agAll' ? ' on' : ''}" data-a="menu" data-m="agAll" data-t="agentAllKebab" title="지금 모두 최신으로">⋯${S.menu === 'agAll' ? `<div class="menu" style="right:0;top:28px"><div class="mi" data-a="agentAllNew" data-t="agentAllNew">지금 모두 최신으로<small>${oldN ? '옛 판 ' + oldN : '모두 최신'}</small></div></div>` : ''}</button></span></div><div class="cb" style="padding:2px 14px 12px">${S.agMsg ? `<div class="callout" data-t="agentMsg">${S.agMsg}</div>` : ''}<ul class="plain" data-t="agentList">${rows || '<li class="muted">아직 붙인 폴더가 없다</li>'}</ul>${add}
   <details class="more" data-t="agentMore"><summary>자세히 — 무엇이 깔리나</summary><div class="in">스킬 셋 — <code>kmd-work</code> · <code>kmd-save</code> · <code>kmd-build</code>(파일을 지식에 들이기)<br>연결 둘 — 팀 kmd · 이 PC 의 kmd · 열쇠는 이 PC 의 자격 저장소에서 꺼낸다<br>안내 한 단락 — <code>CLAUDE.md</code> 안 kmd 안내 · 사람이 고친 줄은 그대로 두고 kmd 안내만 바꾼다</div></details></div></div>`
  }
  const devs = devicesOf()
  return `<div class="card" data-t="agentCard"><div class="ch">에이전트 설치 <small>Claude Code 에 kmd 를 붙인다</small></div><div class="cb" style="padding:2px 14px 12px"><div class="set"><span class="tx"><b>이 PC 의 Claude Code 로 쓰려면 — 설치 한 줄 복사</b><small>작업 폴더의 터미널에 붙여 넣는다 · 10분 동안 한 번만 · 내 PC 프로그램이 있으면 그 프로그램에 폴더를 더한다</small></span><button class="btn pri" data-a="copyInstall" data-t="copyInstall">설치 한 줄 복사</button></div>
  <div class="rh">내 기기</div><ul class="plain" data-t="agentDevs">${(devs && !devs.error ? devs : []).map((d) => `<li data-t="agentDev" data-name="${esc(d.host || d.id)}"><span style="flex:1"><b>${esc(d.host || '이름 없는 기기')}</b><small class="muted" style="display:block">Claude Code · ${d.used ? '마지막 사용 ' + esc(whenTxt(d.used)) : '이은 때 ' + esc(whenTxt(d.at))}</small></span></li>`).join('') || '<li class="muted">아직 붙인 기기가 없다</li>'}</ul><p class="small muted">기기의 kmd 스킬은 그 기기의 내 PC 프로그램이 최신으로 맞춘다.</p></div></div>`
}
async function agentDo(what, dir) {
  try {
    const r = await postJSON('/api/agent/' + what, dir ? { dir } : {})
    if (what === 'add') { S.agAdding = false; S.agDraft = ''; S.agMsg = r.again ? '<b>이미 붙어 있다 — 최신으로 맞췄다</b>' : `<b>Claude Code 에 kmd 를 붙였다 — 스킬 · 연결 둘 · 안내 한 단락</b> · ${esc(r.dir)}` }
    else S.agMsg = what === 'rm' ? '<b>뺐다 — 스킬 · 연결 · kmd 안내를 걷었다</b>' : `<b>최신으로 — ${r.n}곳</b>`
  } catch (e) { S.agMsg = `<b>${esc(e.message)}</b>` }
  S.menu = null
  delete S.cache.agent
  render()
}

// ── 관리(목업 M14) — 문제 줄만 ──
const overviewOf = () => need('admin', '/api/admin/overview')
const usersOf = () => need('users', '/api/admin/users')
const leftMin = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000))
// 사람 카드 — 더하기 · 사람마다 새 링크(골라서) · 관리자 켜고 끄기 · 기기 끊기 · 떠남. 떠난 사람은 접어 둔다(아이디는 되쓰지 않는다)
function admPeopleCard() {
  const u = usersOf()
  if (!u || u.error) return `<div class="card" data-t="admPeople"><div class="ch">사람</div><div class="cb" style="padding:8px 14px">${u ? errHtml(u) : loadingHtml}</div></div>`
  const live = u.users.filter((x) => !x.off && !x.legacyOnly), gone = u.users.filter((x) => x.off)
  const st = (x) => x.password ? '들어온다' : x.firstOpen ? `링크 보냄 · ${Math.floor(leftMin(x.firstExp) / 60)}시간 ${leftMin(x.firstExp) % 60}분 남음` : '비밀번호를 안 정함'
  const mk = (x) => 'pp:' + x.id
  const row = (x) => `<li data-t="admPerson" data-name="${esc(x.id)}"><span class="av2">${esc(x.id.slice(0, 1))}</span><span class="nm">${esc(x.id)}${x.admin ? ' <span class="kt role">관리자</span>' : ''}<small>${esc(st(x))} · 기기 ${x.devices}${x.workers ? ' · PC 일꾼 ' + x.workers : ''}${x.roles.team + x.roles.private + x.roles.curate ? ` · 주인 ${x.roles.team + x.roles.private} · 정리 ${x.roles.curate}` : ''}</small></span>${S.admLink && S.admLink.id === x.id ? `<span class="mono small" data-t="admLinkOut" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S.admLink.link)}</span><a class="lk" data-a="admCopyLink" data-t="admCopyLink">복사</a>` : ''}${x.id === S.me.user ? '' : `<button class="kebab${S.menu === mk(x) ? ' on' : ''}" data-a="menu" data-m="${esc(mk(x))}" data-t="admPersonKebab" title="새 링크 · 관리자 · 기기 · 떠남">⋯${S.menu === mk(x) ? `<div class="menu" style="right:0;top:28px"><div class="mi" data-a="admLink1" data-v="${esc(x.id)}" data-t="admLink1">새 링크<small>이 사람만 · 24시간 · 한 번 — 지금 비밀번호는 지워진다</small></div><div class="mi" data-a="admAdminSet" data-v="${esc(x.id)}" data-on="${x.admin ? '' : '1'}" data-t="admAdminSet">${x.admin ? '관리자 아님으로' : '관리자로'}</div><div class="mi" data-a="admRevokeAll" data-v="${esc(x.id)}" data-t="admRevokeAll">기기 모두 끊기<small>Claude Code · 내 PC 프로그램 · PC 일꾼이 다시 이어야 한다</small></div><div class="sep"></div><div class="mi danger" data-a="admOffOpen" data-v="${esc(x.id)}" data-t="admOffOpen">떠남…<small>들어가기 · 기기 · PC 일꾼을 끊고 지식을 넘긴다</small></div></div>` : ''}</button>`}</li>`
  const add = S.admAdd ? `<div class="flow" data-t="admAddForm"><div class="row"><input class="inp" id="admAddIn" data-in="admAddId" data-t="admAddIn" value="${esc(S.admAdd.id || '')}" placeholder="아이디 — 영문 · 숫자 · . _ -" autocomplete="off" style="flex:1"><label class="small"><input type="checkbox" id="admAddAdmin"${S.admAdd.admin ? ' checked' : ''} data-t="admAddAdmin"> 관리자</label><button class="btn pri" data-a="admAddDo" data-t="admAddDo">더하기</button><a class="muted" data-a="admAddCancel">그만두기</a></div>${S.admAdd.err ? `<div class="callout danger" style="margin-top:8px">${esc(S.admAdd.err)}</div>` : ''}</div>` : ''
  return `<div class="card" data-t="admPeople" style="overflow:visible"><div class="ch">사람 ${live.length} <small>처음 들어오기 링크는 사람마다 따로 보낸다</small></div><div class="cb" style="padding:2px 14px 10px">${add}<ul class="plain pl">${live.map(row).join('')}</ul>${gone.length ? `<details class="more" data-t="admGone"><summary>떠난 사람 ${gone.length} — 아이디는 되쓰지 않는다</summary><div class="in">${gone.map((x) => `${esc(x.id)} · ${esc(String(x.off.at).slice(0, 10))}`).join(' · ')}</div></details>` : ''}</div><div class="cf">${S.admAdd ? '' : '<button class="btn pri" data-a="admAddOpen" data-t="admAddOpen">사람 더하기</button>'}<span>더하면 처음 들어오기 링크가 나온다 — 그 사람에게만 보낸다</span></div></div>`
}
// 떠남 확인 — 그 사람이 주인인 지식을 누가 잇는가
function offHtml() {
  const v = S.off
  const x = ((usersOf() || {}).users || []).find((u) => u.id === v.id)
  if (!x) return ''
  const r = x.roles
  return `<div class="pscrim" data-t="offWin"><div class="modal win" style="width:min(560px,94%)"><div class="tb"><b>떠남 — ${esc(x.id)}</b></div><div class="wb">
  <div class="callout danger" style="margin:0 0 12px"><i></i><span><b>한 번에 끊는다 — 들어가기 · 기기 ${x.devices} · PC 일꾼 ${x.workers}</b> · 아이디는 남겨 두고 되쓰지 않는다(같은 이름의 새 사람은 다른 아이디로)</span></div>
  <p class="small" style="margin:0 0 6px">${esc(x.id)} 이 주인인 지식 — 팀 지식 ${r.team} · 개인 지식 ${r.private} · 정리하는 지식 ${r.curate}(정리하는 사람에서 뺀다)</p>
  <label class="small" style="display:block;margin:6px 0"><input type="radio" name="offTo" value="me"${v.to === 'me' ? ' checked' : ''} data-a="offTo" data-v="me" data-t="offToMe"> 내가 주인을 잇는다 — 개인 지식은 이제 나만 본다</label>
  <label class="small" style="display:block;margin:6px 0"><input type="radio" name="offTo" value="none"${v.to === 'me' ? '' : ' checked'} data-a="offTo" data-v="none" data-t="offToNone"> 주인 칸을 비운다 — 개인 지식은 관리자만 본다(이 지식의 사람에서 넘기거나 지운다)</label>
  ${v.err ? `<div class="callout danger" style="margin-top:10px"><i></i><span>${esc(v.err)}</span></div>` : ''}
  </div><div class="wf"><a class="muted" data-a="offClose" style="align-self:center;margin-right:auto">그만두기</a><button class="btn danger" data-a="offDo" data-t="offDo"${v.busy ? ' disabled' : ''}>${v.busy ? '끊는 중…' : '떠남으로'}</button></div></div></div>`
}
function viewAdmin() {
  if (!S.me.admin) return { crumb: '관리', main: '<div class="callout gray">관리자만 본다</div>' }
  const a = overviewOf()
  if (!a || a.error) return { crumb: '관리', main: `<div style="max-width:780px"><div class="big">관리</div>${a ? errHtml(a) : loadingHtml}</div>` }
  const rows = []
  if (a.nopw.length) rows.push(`<li class="hot" data-t="adm-nopw"><span class="dot warn"></span><span class="tx"><b>비밀번호를 안 정한 사람 ${a.nopw.length}</b><small>${esc(a.nopw.join(' · '))} — 아래 사람 카드에서 그 사람의 ⋯ › 새 링크 · 떠난 사람이면 ⋯ › 떠남</small></span></li>`)
  for (const l of a.locked) rows.push(`<li data-t="adm-lock"><span class="dot"></span><span class="tx"><b>${esc(l.user)} · ${l.ip === '*' ? '여러 자리에서' : '다른 자리에서'} 여러 번 틀림 — 잠시 막혔다</b><small>${l.ip === '*' ? '' : esc(l.ip) + ' · '}${esc(hhmmOf(l.until))} 에 저절로 풀린다 · 맞는 사람은 그대로 쓴다</small></span><button class="btn sm" data-a="admUnlock" data-v="${esc(l.user)}" data-t="admUnlock">풀기</button></li>`)
  for (const r of a.requests.slice(0, 10)) rows.push(`<li data-t="adm-req"><span class="dot pu"></span><span class="tx"><b>가져오는 곳 「${esc(r.name)}」 더해 달라는 부탁 — ${esc(r.by)}</b><small>${esc(whenTxt(r.at))} · → ${esc((KN(r.kn) || {}).name || r.kn)} › ${esc((r.rules[0] && r.rules[0].into && r.rules[0].into.doc) || '')} · ${esc(r.at2)}</small></span><button class="btn sm" data-a="admAddReq" data-id="${esc(r.id)}" data-t="admAddReq">더하기</button><button class="btn sm ghost" data-a="admNoReq" data-id="${esc(r.id)}" data-t="admNoReq">거절</button></li>`)
  if (a.worker && a.worker.ok === false) rows.push(`<li data-t="adm-rest"><span class="dot warn"></span><span class="tx"><b>자동 정리가 쉬고 있다 · ${Math.max(1, Math.round((Date.now() - Date.parse(a.worker.since)) / 864e5))}일</b><small>${a.worker.reason === 'limit' ? '사용 한도에 닿았다' : '정리 전용 Claude 로그인이 끝났다'} — 아래 「Claude 연결」 에서 다시 로그인 · 그동안은 규칙으로 되는 것만 넣는다</small></span></li>`)
  for (const b of a.backups.filter((x) => x.verdict && x.verdict !== 'ok' && x.verdict !== 'lag')) rows.push(`<li data-t="adm-backup"><span class="dot warn"></span><span class="tx"><b>${esc(b.name)} — 백업과 ${b.verdict === 'behind' ? '백업이 앞섰다' : b.verdict === 'moved' ? '갈라졌다' : '맞지 않는다'}</b><small>어느 쪽이 맞는지 정한다 — 백업이 맞으면 이어 쓰기(지금 것은 가지로 남는다 · 그사이 기록은 쓴 사람에게 알린다) · 서버가 맞으면 백업을 덮는다</small></span><button class="btn sm" data-a="admAdopt" data-v="${esc(b.name)}" data-t="admAdopt">${b.verdict === 'behind' ? '백업에서 받기' : '이 백업 이어 쓰기'}</button>${b.verdict === 'moved' ? `<button class="btn sm ghost" data-a="admKeep" data-v="${esc(b.name)}" data-t="admKeep">서버 것으로 백업 덮기</button>` : ''}</li>`)
  const now = clock().split(' ').pop()
  return { crumb: '관리', main: `<div style="max-width:780px"><div class="big">관리</div><p class="lead">문제가 있을 때만 줄이 선다 — 풀리면 저절로 사라진다.</p>
  <div class="card"><div class="ch">오늘 ${rows.length} <small>${esc(now)}</small></div><ul class="plain pl" data-t="admList">${rows.join('') || '<li class="muted" data-t="admEmpty">오늘은 문제가 없다</li>'}</ul>${a.https ? '' : '<div class="cf">아직 https 가 아니다 — 사내 인증서가 생기면 켤 수 있다</div>'}</div>
  ${admPeopleCard()}
  ${admClaudeCard(a)}
  <details class="more" data-t="admMore"><summary>잘 도는 것 — 지식 ${a.kns}${a.knsPrivate ? ` · 남의 개인 지식 ${a.knsPrivate}` : ''} · 사람 ${a.people.length} · 자동으로 가져오는 곳 ${a.sources.length} · 자세히</summary><div class="in">
   <div>자동으로 가져오는 곳 — ${a.sources.map((s) => esc(s.name) + ' ' + esc(s.last ? whenTxt(s.last) : '아직')).join(' · ') || '없다'} · <a data-a="nav" data-s="import">가져오기 ›</a></div>
   <div style="margin-top:4px">자동 정리 — 정리 전용 로그인 ${a.claude.token ? '있음' : '없음'}${a.worker && a.worker.ok === false ? ' · <b style="color:var(--warn)">쉼</b>' : ''}</div>
   <div style="margin-top:4px">찾기 점검 — ${a.checks.map((c) => `${esc(c.name)} ${c.in}%(${c.n})`).join(' · ') || '아직 재지 않았다'}</div>
   <div style="margin-top:4px">백업 — ${a.backups.map((b) => esc(b.name) + ' ' + (b.off ? '없음' : esc(b.url))).join(' · ')}</div>
   <div style="margin-top:4px">사람 — ${esc(a.people.join(' · '))}${a.waiting.length ? ' · (' + esc(a.waiting.join(' · ')) + ' 링크 보냄)' : ''}</div></div></details></div>` }
}
const hhmmOf = (iso) => { const d = new Date(iso); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
function admDoneBtn() { const ok = !!(S.admCode || '').trim(); return `<button class="btn pri" data-a="admDone" data-t="admDone"${ok ? '' : ' disabled'}>마치기</button>` }
function admClaudeCard(a) {
  const rest = a.worker && a.worker.ok === false, step = S.admStep
  let flow = ''
  if (step === 'pw') flow = `<div class="flow" data-t="admPw"><div class="field"><label for="admPw">비밀번호 한 번 더 — 관리자 확인</label><input class="inp af" type="password" id="admPw" data-t="admPwIn" autocomplete="current-password"><div class="hint">브라우저가 채우면 확인만 누르면 된다</div></div>${S.admErr ? `<div class="callout danger">${esc(S.admErr)}</div>` : ''}<div class="row"><button class="btn pri" data-a="admPwOk" data-t="admPwOk">확인</button><a class="muted" data-a="admFlowCancel">그만두기</a></div></div>`
  else if (step === 'wait') flow = '<div class="flow"><span class="prog" data-t="admWait"><i></i>팀 서버가 정리용 로그인을 띄우는 중…</span></div>'
  else if (step === 'window') flow = `<div class="flow" data-t="admWindow"><p style="margin:0 0 6px"><b>팀 서버 PC 화면에 「kmd — Claude 로그인」 창</b>이 떴다 — 그 창이 브라우저를 연다. 그 PC 의 브라우저에서 Claude 에 들어가면 끝이다.</p><p class="small muted" style="margin:0 0 8px">창이 안 보이면 그 PC 의 작업 표시줄에서 그 창을 누른다 · 정리 일꾼은 그 PC 의 Claude Code 로그인을 쓴다 · 다 되면 그 창은 닫아도 된다</p><div class="row"><span class="prog" data-t="admWinWait"><i></i>${S.admChecking ? '로그인을 확인하는 중…' : S.admLast ? esc(S.admLast) : '로그인을 기다린다 — 몇 초마다 저절로 확인한다'}</span><button class="btn sm" data-a="admCheck" data-t="admCheck" style="margin-left:auto">지금 확인</button><a class="lk" data-a="admFlowCancel" style="margin-left:10px">그만두기</a></div></div>`
  else if (!step && S.admErr) flow = `<div class="flow"><div class="callout danger" data-t="admErr">${esc(S.admErr)}</div></div>`
  else if (step === 'code') flow = `<div class="flow" data-t="admCode"><p style="margin:0 0 6px"><b>이 주소를 열어 Claude 에 들어가고 받은 번호를 붙여 넣으세요</b></p><div class="path"><span data-t="admUrl">${esc(S.admUrl)}</span><a class="r lk" data-a="admCopyUrl">복사</a></div><div class="paste" style="margin-top:8px"><input class="inp mono" id="admCodeIn" data-in="admCode" data-t="admCodeIn" value="${esc(S.admCode || '')}" placeholder="받은 번호 붙여 넣기" autocomplete="off"><span id="admDoneBox">${admDoneBtn()}</span></div><p class="hint">한 번용 번호 — 저장하지 않는다${a.https ? '' : ' · 아직 https 가 아니다 — 사내 https 뒤 권장'} · <a data-a="admFlowCancel">그만두기</a></p>${S.admErr ? `<div class="callout danger">${esc(S.admErr)}</div>` : ''}</div>`
  const state = rest ? `쉬고 있다 · ${Math.max(1, Math.round((Date.now() - Date.parse(a.worker.since)) / 864e5))}일 — 로그인이 끝났다` : a.claude.token ? '로그인됨 · 정리 전용' : a.worker && a.worker.ok ? '로그인됨 — 팀 서버 PC 의 Claude Code' : '아직 로그인하지 않았다'
  const inn = a.claude.token || (a.worker && a.worker.ok)
  return `<div class="card" data-t="admClaude"><div class="ch">Claude 연결 <small>정리 전용 로그인 — 팀 서버의 정리 일꾼이 쓴다</small></div><div class="cb" style="padding:2px 14px 10px"><div class="set"><span class="tx"><b data-t="admClaudeState">${state}</b><small>쓰는 곳 — 정해진 정리 · 지금 정리 · 기록 만들기${rest ? ' · 그동안은 규칙으로 되는 것만 넣는다' : ''}</small></span>${step ? '' : `<button class="btn${rest || !inn ? ' pri' : ''}" data-a="admLoginStart" data-t="admLoginStart">${rest || !inn ? '로그인 시작' : '다시 로그인'}</button>`}</div>${flow}</div></div>`
}
async function admPwOk() {
  const pw = ($('#admPw') || {}).value || ''
  try {
    await postJSON('/api/sudo', { pw: prehash(S.me.user, pw) })
    S.admErr = null
    S.admStep = 'wait'
    render()
    const r = await postJSON('/api/admin/claude/start', {})
    if (r.window) { S.admStep = 'window'; S.admLast = null; S.admSince = Date.now(); admPoll() } // 화면 있는 서버 PC — 보이는 창 · 번호 칸 없음
    else { S.admUrl = r.url; S.admStep = 'code' }
  } catch (e) { S.admErr = e.code === 'E_AUTH' ? '비밀번호를 확인하세요' : e.message; if (S.admStep === 'wait') S.admStep = null }
  render()
}
// 화면 있는 서버 PC — 그 PC 의 Claude Code 로그인을 작은 부르기로 확인 · 8초마다(10분까지)
async function admCheck(byHand) {
  S.admChecking = true
  render()
  let r = null
  try { r = await postJSON('/api/admin/claude/check', {}) } catch (e) { r = { ok: false, reason: e.message } }
  S.admChecking = false
  if (r.ok) { S.admStep = null; S.admLast = null; delete S.cache.admin; loadStops(); toast('로그인됨 — 팀 서버 PC 의 Claude Code · 자동 정리가 이어서 한다') }
  else if (S.admStep === 'window') S.admLast = r.reason === 'login' ? '아직 로그인 전 — 그 창 · 브라우저에서 마치면 저절로 확인한다' : r.reason === 'limit' ? 'Claude 사용 한도에 닿았다' : '확인하지 못했다 — 다시 본다'
  else if (byHand) toast('확인하지 못했다')
  render()
  return r.ok
}
function admPoll() {
  const since = S.admSince
  setTimeout(async () => {
    if (S.admStep !== 'window' || S.admSince !== since || Date.now() - since > 10 * 60_000) return
    if (!(await admCheck(false))) admPoll()
  }, 8000)
}
async function admDone() {
  try {
    await postJSON('/api/admin/claude/code', { code: S.admCode })
    S.admStep = null; S.admCode = ''; S.admErr = null
    delete S.cache.admin
    loadStops()
    toast('로그인됨 — 정리 전용 · 자동 정리가 이어서 한다')
  } catch (e) { S.admErr = e.message }
  render()
}

// ── 지식 지우기 — 보관하지 않고 완전히 · 지식 이름을 그대로 써야 단추가 선다 ──
function canDelete(n) {
  if (!n || n.pc) return false
  if (!isTeam()) return true
  return !!S.me.admin || (n.private && n.role === '주인')
}
function delHtml() {
  const n = KN(S.del.kn)
  if (!n) return ''
  const ok = (S.del.typed || '').trim() === n.name
  const where = isTeam() ? '팀 서버의 이 지식 폴더가 통째로 사라진다 — 팀 모두가 더는 보지 못한다' : `지식 폴더의 「${n.dir || n.name}」 폴더가 통째로 사라진다`
  return `<div class="pscrim" data-a="delClose" data-self="1"><div class="modal win" data-t="delWin" style="width:min(560px,94%)"><div class="tb"><b>지식 지우기 — ${esc(n.name)}</b><button class="x" data-a="delClose" title="닫기" style="margin-left:auto;border:0;background:none;cursor:pointer;font-size:16px">×</button></div><div class="wb">
  <div class="callout danger" data-t="delWarn" style="margin:0 0 12px"><i></i><span><b>보관하지 않고 완전히 지운다 — 되돌릴 수 없다</b></span></div>
  <ul class="plain small" style="margin:0 0 12px;line-height:1.7">
   <li>문서 ${n.docs} · 기록 ${n.records} · 첨부를 모두 지운다 — 휴지통 · 보관함에 남기지 않는다</li>
   <li>${esc(where)}</li>
   <li>이 지식의 정리 · 보낼 곳 · 자동으로 가져오는 곳 · 찾기 색인 · 사람 설정도 함께 사라진다</li>
   <li>백업 자리에 이미 보낸 이력은 kmd 가 지우지 않는다 — 그것까지 없애려면 백업 자리에서 지운다</li>
  </ul>
  <label for="delIn" class="small">지우려면 지식 이름을 그대로 쓴다 — <b>${esc(n.name)}</b></label>
  <input class="inp" id="delIn" data-in="del" data-t="delIn" value="${esc(S.del.typed || '')}" autocomplete="off" style="width:100%;margin-top:6px">
  ${S.del.needPw ? '<label for="delPw" class="small" style="display:block;margin-top:10px">비밀번호 한 번 더 — 관리자 확인</label><input class="inp" type="password" id="delPw" data-t="delPw" autocomplete="current-password" style="width:100%;margin-top:6px">' : ''}
  ${S.del.err ? `<div class="callout danger" style="margin-top:10px"><i></i><span>${esc(S.del.err)}</span></div>` : ''}
  </div><div class="wf"><a class="muted" data-a="delClose" style="align-self:center;margin-right:auto">그만두기</a><span id="delBtnBox">${delBtn(ok)}</span></div></div></div>`
}
const delBtn = (ok) => `<button class="btn danger" data-a="delDo" data-t="delDo"${ok && !S.del.busy ? '' : ' disabled'}>${S.del.busy ? '지우는 중…' : '완전히 지우기'}</button>`
async function delDo() {
  const n = KN(S.del.kn)
  if (!n || (S.del.typed || '').trim() !== n.name) return
  S.del.busy = true
  S.del.err = null
  render()
  try {
    if (S.del.needPw) await postJSON('/api/sudo', { pw: prehash(S.me.user, ($('#delPw') || {}).value || '') })
    await postJSON(`/api/k/${encodeURIComponent(n.id)}/delete`, { confirm: S.del.typed.trim() })
    S.tabs = S.tabs.filter((t) => t.kn !== n.id)
    if (!S.tabs.some((t) => t.id === S.active)) S.active = S.tabs[0] ? S.tabs[0].id : null
    forgetKn(n.id)
    S.del = null
    await reloadKns()
    delete S.cache.history
    go({ scr: 'home', kn: '*' })
    toast(`지웠다 — ${esc(n.name)} · 보관하지 않고 완전히`)
  } catch (e) {
    if (e.code === 'E_SUDO') { S.del.needPw = true; S.del.err = null; S._focus = 'delPw' }
    else S.del.err = e.code === 'E_AUTH' ? '비밀번호를 확인하세요' : e.message
    S.del.busy = false
    render()
  }
}

// ───────────── 이벤트 ─────────────
function openDocAt(k, d, h, q) {
  openTab({ kind: 'doc', kn: k, ref: d, hl: h || null, q: q || null })
  if (h) S._lit = true
  render()
  if (!h) scrollTopMain()
}
const ACT = {
  setTab: (el) => { S.setTab = el.dataset.v; S.menu = null; if (S.route.scr !== 'settings') go({ scr: 'settings' }); else render() },
  pickModel: async (el) => { const st = settingsOf(); if (!st) return; try { const r = await postJSON('/api/settings/model', { role: el.dataset.model, model: el.value }); st.models[r.role] = r.model } catch (e) { toast(esc(e.message)) } render() },
  toggleAuto: async (el) => { const st = settingsOf(); if (!st) return; try { const r = await postJSON('/api/settings/auto', { key: el.dataset.v, on: !st.auto[el.dataset.v] }); st.auto[r.key] = r.on } catch (e) { toast(esc(e.message)) } render() },
  unlinkMyDev: async (el) => { S.menu = null; if (!confirm('이 기기를 끊는다 — 그 기기의 Claude Code · 내 PC 프로그램은 다시 이어야 한다')) return render(); try { await postJSON('/api/me/devices/revoke', { id: el.dataset.id }); toast('끊었다 — 그 기기의 Claude Code 는 다시 이어야 한다') } catch (e) { toast(esc(e.message)) } delete S.cache.devices; render() },
  pcLoginStart: async () => {
    S.menu = null
    try { await postJSON('/api/claude/login', {}) } catch (e) { toast(esc(e.message)); return }
    S.pcLogin = { since: Date.now() }
    render()
    pcLoginPoll()
  },
  pcLoginCheck: () => pcLoginCheck(true),
  pcLoginCancel: () => { S.pcLogin = null; render() },
  claudeOpen: () => { claudeOpen(); loadClaude() },
  claudeClose: () => { S.claudeWin = false; render() },
  claudeToAdmin: () => { S.claudeWin = false; go({ scr: 'admin' }) },
  claudeLogin: async () => { S.menu = null; try { await postJSON('/api/claude/login', {}); S.claudeOpening = true; setTimeout(() => { S.claudeOpening = false; delete S.cache.settings; render() }, 60000) } catch (e) { toast(esc(e.message)) } render() },
  claudeOff: async () => { S.menu = null; try { await postJSON('/api/settings/auto', { key: 'claude', on: false }); delete S.cache.settings; toast('Claude 쓰지 않기 — 규칙으로 되는 것만 한다 · 저절로 하는 일에서 다시 켠다') } catch (e) { toast(esc(e.message)) } render() },
  agentAdd: () => { S.agAdding = true; S._focus = 'agIn'; render() },
  agentAddOk: () => agentDo('add', (S.agDraft || '').trim()),
  agentUp: (el) => agentDo('up', el.dataset.v),
  agentRm: (el) => { if (!confirm('이 작업 폴더에서 kmd 를 뺀다 — 스킬 · 연결 · CLAUDE.md 의 kmd 안내를 걷는다')) { S.menu = null; return render() } agentDo('rm', el.dataset.v) },
  agentAllNew: () => agentDo('up'),
  logoutAll: async () => { S.menu = null; if (!confirm('모든 곳에서 나간다 — 이 브라우저와 다른 기기 · 브라우저의 들어온 것이 모두 끊긴다(Claude Code 의 기기 열쇠는 그대로)')) return render(); try { await postJSON('/api/me/logout-all', {}) } catch {} try { sessionStorage.removeItem('kmdPair'); localStorage.removeItem('kmdPcKns'); localStorage.removeItem('kmdPcSeen') } catch {} location.href = '/' },
  logout: async () => { await postJSON('/logout', {}).catch(() => {}); try { sessionStorage.removeItem('kmdPair'); localStorage.removeItem('kmdPcKns'); localStorage.removeItem('kmdPcSeen') } catch {} location.href = '/' },
  admAddOpen: () => { S.admAdd = { id: '', admin: false }; S._focus = 'admAddIn'; render() },
  admAddCancel: () => { S.admAdd = null; render() },
  admAddDo: async () => {
    const v = S.admAdd
    if (!v) return
    v.admin = !!($('#admAddAdmin') || {}).checked
    try { const r = await postJSON('/api/admin/users', { id: (v.id || '').trim(), admin: v.admin }); S.admAdd = null; S.admLink = { id: r.id, link: r.link }; delete S.cache.users; delete S.cache.admin; toast('더했다 — 링크를 그 사람에게만 보낸다') } catch (e) { if (e.code !== 'E_CANCEL') v.err = e.message }
    render()
  },
  admLink1: async (el) => {
    S.menu = null
    if (!confirm(`${el.dataset.v} — 새 처음 들어오기 링크를 만든다 · 지금 비밀번호와 들어온 곳은 끊긴다`)) return render()
    try { const r = await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/reset`, {}); S.admLink = { id: r.id, link: r.link }; delete S.cache.users; delete S.cache.admin } catch (e) { if (e.code !== 'E_CANCEL') toast(esc(e.message)) }
    render()
  },
  admCopyLink: () => { if (S.admLink) { copyText(S.admLink.link); toast('복사했다 — ' + esc(S.admLink.id) + ' 에게만') } },
  admAdminSet: async (el) => { S.menu = null; try { await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/admin`, { admin: !!el.dataset.on }); delete S.cache.users; toast(el.dataset.on ? '관리자로 했다' : '관리자가 아니다') } catch (e) { if (e.code !== 'E_CANCEL') toast(esc(e.message)) } render() },
  admRevokeAll: async (el) => {
    S.menu = null
    if (!confirm(`${el.dataset.v} 의 기기를 모두 끊는다 — Claude Code · 내 PC 프로그램 · PC 일꾼이 다시 이어야 한다`)) return render()
    try { const r = await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/revoke-all`, {}); delete S.cache.users; toast(`끊었다 — 기기 ${r.revoked}`) } catch (e) { if (e.code !== 'E_CANCEL') toast(esc(e.message)) }
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
      toast(`떠남으로 했다 — ${esc(v.id)} · 기기 ${r.devices} · PC 일꾼 ${r.workers} 끊음${r.kn ? ` · 지식 ${r.kn.team + r.kn.private}${v.to === 'me' ? ' 을 이었다' : ' 의 주인 칸을 비웠다'}` : ''}`, 7000)
    } catch (e) { v.busy = false; if (e.code !== 'E_CANCEL') v.err = e.message }
    render()
  },
  admNoReq: async (el) => {
    const why = prompt('거절 까닭 — 부탁한 사람에게 간다(비워도 된다)', '')
    if (why === null) return
    try { await postJSON(`/api/requests/${encodeURIComponent(el.dataset.id)}/close`, { state: 'no', why }); delete S.cache.admin; toast('거절했다 — 부탁한 사람에게 알렸다') } catch (e) { toast(esc(e.message)) }
    render()
  },
  addKind: (el) => { if (S.addPop) { S.addPop.where = el.dataset.v; S.addPop.err = null; render() } },
  ownGive: async () => { const to = ($('#ownSel') || {}).value; const k = tidyKn(); if (!to || !confirm(`주인을 ${to} 에게 넘긴다`)) return; await setOwnerRow(k, { owner: to }); await reloadKns(); render() },
  ownKind: async (el) => { const k = tidyKn(); const toTeam = el.dataset.v === 'team'; if (!confirm(toTeam ? '팀 지식으로 내놓는다 — 팀 모두 읽고 기록한다' : '개인으로 돌린다 — 주인만 본다(팀원의 화면 · 찾기 · Claude Code 에서 사라진다)')) return; await setOwnerRow(k, { private: !toTeam }); await reloadKns(); render() },
  sudoOk: () => sudoOk(),
  impStop: (el) => { const x = S.imports.find((r) => r.id === el.dataset.v); if (x) { x.stop = true; x.msg = '그만두는 중 — 보내던 묶음까지 넣는다'; render() } },
  impOpen: (el) => { S.impOpen = S.impOpen === el.dataset.v ? null : el.dataset.v; render() },
  palQo: () => { const q = S.pal ? S.pal.q : ''; S.pal = null; openQo(); if (S.qo) S.qo.q = q; render() },
  palName: (el) => { S.pal = null; openTab({ kind: el.dataset.kind, kn: el.dataset.k, ref: el.dataset.v }); render(); scrollTopMain() },
  // 넣은 파일의 기록 — Claude 가 읽고 사람이 읽을 기록으로 다시 쓴다(로그인이 없으면 Claude 연결 창)
  readRec: async (el) => {
    const k = el.dataset.k, r = el.dataset.r
    S.reading = { ...(S.reading || {}), [r]: true }
    render()
    try { const x = await postJSON(`/api/k/${encodeURIComponent(k)}/rec/read`, { r }); forgetKn(k); toast(`기록을 정리했다 — ${esc(x.title || '')}`) } catch (e) { if (/로그인/.test(e.message)) claudeOpen(); toast(esc(e.message)) }
    delete S.reading[r]
    render()
  },
  unwatchDoc: async (el) => {
    if (!confirm('원본이 없어진 사본이다 — 「원본이 주인」 표지를 걷어 내 문서로 고친다')) return
    try { await postJSON(`/api/k/${encodeURIComponent(el.dataset.k)}/unwatch`, { doc: el.dataset.d }); forgetKn(el.dataset.k); toast('내 문서로 했다 — 이제 고칠 수 있다') } catch (e) { toast(esc(e.message)) }
    render()
  },
  sudoCancel: () => sudoCancel(),
  admUnlock: async (el) => { try { await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/unlock`, {}); delete S.cache.admin; toast('풀었다') } catch (e) { toast(esc(e.message)) } render() },
  admAddReq: async (el) => {
    const r = ((overviewOf() || {}).requests || []).find((x) => x.id === el.dataset.id)
    if (!r) return
    try { await postJSON(`/api/k/${encodeURIComponent(r.kn)}/sources`, { name: r.name, at: r.at2, kind: r.kind, rules: r.rules, every: r.every, db: r.db }); delete S.cache.admin; delete S.cache.sources; toast('더했다 — ' + esc(r.name)) } catch (e) { toast(esc(e.message), 7000) }
    render()
  },
  admKeep: async (el) => {
    const k = S.kns.find((x) => x.name === el.dataset.v)
    if (!k || !confirm(`${k.name} — 서버의 지금 글로 백업을 덮는다 · 백업에만 있던 묶음은 백업에서 사라진다(서버에는 처음부터 없다)`)) return
    try { await postJSON(`/api/k/${encodeURIComponent(k.id)}/backup/keep`, {}); delete S.cache.admin; loadStops(); toast('백업을 서버 것으로 덮었다 — ' + esc(k.name)) } catch (e) { if (e.code !== 'E_CANCEL') toast(esc(e.message), 7000) }
    render()
  },
  admAdopt: async (el) => {
    const k = S.kns.find((x) => x.name === el.dataset.v)
    if (!k) return
    const b0 = (overviewOf() || {}).backups.find((x) => x.name === el.dataset.v)
    if (b0 && b0.verdict === 'moved') {
      const lost = await getJSON(`/api/k/${encodeURIComponent(k.id)}/backup/lost`).catch(() => null)
      const n = lost ? lost.records.length : 0
      if (!confirm(`${k.name} — 백업의 글로 이어 쓴다.${lost ? `\n서버에만 있던 기록 ${n} · 문서 ${lost.docs.length} 가 지식에서 빠진다(가지 kmd-before-… 에 남는다 · 쓴 사람에게 알린다)${n ? '\n' + lost.records.slice(0, 8).map((r) => '- ' + r.title + (r.author ? ' · ' + r.author : '')).join('\n') : ''}` : ''}`)) return
    }
    if (b0 && b0.verdict === 'behind' && !confirm(`${k.name} — 백업에 앞선 묶음을 받는다(앞으로만 · 받은 글에 새 오류면 되돌린다)`)) return
    try { const b = (overviewOf() || {}).backups.find((x) => x.name === el.dataset.v); await postJSON(`/api/k/${encodeURIComponent(k.id)}/${b && b.verdict === 'behind' ? 'backup/pull' : 'backup/adopt'}`, {}); delete S.cache.admin; forgetKn(k.id); loadStops(); toast('맞췄다 — ' + esc(k.name)) } catch (e) { toast(esc(e.message), 7000) }
    render()
  },
  bkRootSet: async () => {
    const root = (($('#bkRoot') || {}).value || '').trim()
    if (!root) return toast('백업 자리 폴더를 쓴다')
    try { const r = await postJSON('/api/pc/backup', { root }); delete S.cache.settings; loadStops(); toast(`백업 자리를 정했다 — 붙인 지식 ${r.attached}${r.failed.length ? ` · 못 붙임 ${r.failed.length}: ${esc(r.failed[0])}` : ''}`, 7000) } catch (e) { toast(esc(e.message), 7000) }
    render()
  },
  restoreDo: async () => {
    const url = (($('#rsUrl') || {}).value || '').trim()
    if (!url || S.restoring) return
    S.restoring = true
    render()
    try {
      const r = await postJSON('/api/restore', { url, name: (($('#rsName') || {}).value || '').trim() || undefined, ...(($('#rsPractice') || {}).checked ? { attach: false } : {}) })
      await reloadKns()
      delete S.cache.settings
      toast(`되살렸다 — ${esc(r.id)} · 문서 ${r.docs} · 기록 ${r.records}${r.attached ? ' · 같은 백업으로 이어 보낸다' : ' · 읽기만 사본(원래 백업에 보내지 않는다)'}`, 8000)
    } catch (e) { if (e.code !== 'E_CANCEL') toast(esc(e.message), 8000) }
    S.restoring = false
    render()
  },
  admLoginStart: () => { S.admStep = 'pw'; S.admErr = null; S._focus = 'admPw'; render() },
  admPwOk: () => admPwOk(),
  admCheck: () => admCheck(true),
  admFlowCancel: () => { if (S.admStep === 'code' || S.admStep === 'window') postJSON('/api/admin/claude/cancel', {}).catch(() => {}); S.admStep = null; S.admErr = null; S.admCode = ''; render() },
  admCopyUrl: () => { copyText(S.admUrl || ''); toast('복사했다') },
  admDone: () => admDone(),
  fetchSrc: (el) => fetchSrc(el.dataset.id),
  resyncSrc: (el) => resyncSrc(el.dataset.id),
  toggleMeaning: async (el) => { const [kn, name] = el.dataset.id.split('|'); S.menu = null; try { await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/meaning`, { name, on: !!el.dataset.v }); delete S.cache.sources; toast(el.dataset.v ? '뜻 갱신을 켰다 — 이제 바뀐 코드로 관련 항목 글도 맞춘다' : '뜻 갱신을 껐다 — 표만 채운다') } catch (e) { toast(esc(e.message)) } render() },
  fetchAll: async () => { for (const s of ((sourcesOf() || {}).items || []).filter((x) => x.kind !== 'pc')) await fetchSrc(s.kn + '|' + s.name) },
  setEvery: async (el, ev) => {
    if (ev.target.closest('[data-stop]')) return
    const [kn, name] = el.dataset.id.split('|'), at = ($('#evAt') || {}).value || '06:00'
    const every = el.dataset.v === 'daily' ? 'daily ' + at : el.dataset.v
    S.menu = null
    try { await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/every`, { name, every }); delete S.cache.sources; toast('언제를 바꿨다 — ' + everyTxt(every)) } catch (e) { toast(esc(e.message)) }
    render()
  },
  sfType: (el) => { const f = sfState(); f.type = el.dataset.v; f.rule = f.type === 'db' ? 'dbtables' : f.rule === 'dbtables' ? 'deps' : f.rule; S.sfMsg = null; render() },
  // 지금 하는 일 팝업의 줄 — Claude Code 일은 가져오기 화면의 그 터미널 · 가져오기는 가져오기 화면 · 정리는 그 지식의 문서
  busyGo: (el) => {
    S.menu = null
    const { kind, k, run } = el.dataset
    if (kind === 'run' && run) { (S.termOpen ||= {})[run] = true; go({ scr: 'import' }); pollRuns(); return }
    if (kind === 'source') { go({ scr: 'import' }); return }
    go({ scr: 'docs', kn: k })
  },
  termToggle: (el) => { const id = el.dataset.id; (S.termOpen ||= {})[id] = !S.termOpen[id]; paintJobs(); pollRuns() },
  sfAdd: () => sfAdd(false),
  sfOpen: () => { S.sfOpen = true; S.sfMsg = null; render() },
  sfClose: () => { S.sfOpen = false; render() },
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
  copyRoot: () => { copyText(pcRoot()); toast('지식 폴더 경로를 복사했다') },
  doAdd: () => doAdd(),
  openAdd: () => openAdd(),
  addClose: () => { if (S.addPop && !S.addPop.busy) { S.addPop = null; render() } },
  syncKn: () => syncKn(),
  knMove: (el, ev) => { ev.stopPropagation(); S.menu = null; knMove(el.dataset.k, Number(el.dataset.v)) },
  knHide: (el, ev) => { ev.stopPropagation(); S.menu = null; knHide(el.dataset.k, !!el.dataset.v) },
  // 보내기 — 바뀐 것 체크(처음엔 모두) · 모두 고르기 / 해제 · 지식에서 고르기 · 받은편지함 메모
  sendCh: (el) => { (S.sendOff ||= {})[sendKey(el.dataset.k, el.dataset.v)] = !el.checked; render() },
  sendPick: (el) => { (S.sendSel ||= {})[sendKey(el.dataset.k, el.dataset.v)] = el.checked; render() },
  sendAll: (el) => { S.sendOff = {}; if (!el.dataset.v) for (const k of sendKns()) { const v = S.cache['send:' + k.id]; if (v && !v.error) for (const q of v.items) S.sendOff[sendKey(k.id, q.key)] = true } render() },
  candOn: (el) => { const c = (S.cand || []).find((x) => x.record === el.dataset.id); if (c) c.on = el.checked; render() },
  doSend: (el) => doSend(el.dataset.v || 'changes'),
  sendWaitAct: async (el) => {
    const drop = el.dataset.v === 'drop'
    if (drop && !confirm('이 줄을 버린다 — 보내지 않는다(내 글은 그대로 · 다시 고르면 다시 보낼 수 있다)')) return
    try { const r = await postJSON(`/api/k/${encodeURIComponent(el.dataset.k)}/send/wait`, { id: el.dataset.id, act: el.dataset.v }); toast(drop ? `버렸다 — ${r.dropped}개` : `보냈다 — ${r.sent}개`) } catch (e) { toast(esc(e.message), 9000) }
    delete S.cache['send:' + el.dataset.k]
    await reloadKns()
    loadStops()
    render()
  },
  destPick: (el) => { const v = el.value; if (!v) return; const inp = $('#dest-' + CSS.escape(el.dataset.k)); if (inp) { const cur = inp.value.split(/[,\s]+/).filter(Boolean); if (!cur.includes(v)) inp.value = [...cur, v].join(', ') } el.value = '' },
  setDests: async (el) => {
    const k = el.dataset.k, raw = ($('#dest-' + CSS.escape(k)) || {}).value || ''
    const dests = raw.split(/[,\s]+/).filter(Boolean).map((x) => { const m = x.match(/^(https?:\/\/[^/]+)(?:\/r)?\/([^/?#]+)/i); return m ? { kn: decodeURIComponent(m[2]).replace(/_wiki$/i, ''), url: m[1] } : { kn: x } })
    try { await postJSON(`/api/k/${encodeURIComponent(k)}/send/dests`, { dests }); await reloadKns(); delete S.cache['send:' + k]; toast(dests.length ? '보낼 곳을 정했다 — 이제부터 고친 것이 모인다' : '보낼 곳을 뺐다') } catch (e) { toast(esc(e.message)) }
    render()
  },
  toggleToday: (el) => { S.openToday = S.openToday === el.dataset.id ? null : el.dataset.id; render() },
  todayGo: (el) => { const x = (S.cache.history || []).find((e) => e.id === el.dataset.id); if (x && x.go) { openTab({ kind: 'doc', kn: x.go.kn, ref: x.go.doc, hl: x.go.hl || null }, { view: 'docs' }); if (x.go.hl) S._lit = true; render() } },
  revertToday: async (el) => {
    const x = (S.cache.history || []).find((e) => e.id === el.dataset.id)
    if (!x || !confirm('그 줄을 넣기 전 글로 되돌린다 — 그 정리에 든 기록은 다시 넣지 않는다')) return
    try { await postJSON(`/api/k/${encodeURIComponent(x.kn)}/revert`, { record: x.revert }); x.reverted = true; forgetKn(x.kn); delete S.cache['tidy:' + x.kn]; toast('되돌렸다 — 넣기 전 글로 · 그 기록은 다시 문서 옆에 같이 읽힌다'); render() } catch (e) { toast(esc(e.message)) }
  },
  unlinkDev: async (el) => {
    const x = (S.cache.history || []).find((e) => e.id === el.dataset.id)
    if (!x || !confirm('그 기기를 끊는다 — 그 기기의 Claude Code 는 다시 이어야 한다')) return
    try { await postJSON('/api/me/devices/revoke', { id: x.device }); x.unlinked = true; toast('끊었다 — 그 기기의 Claude Code 는 다시 이어야 한다'); render() } catch (e) { toast(esc(e.message)) }
  },
  tidyNow: (el) => tidyNow(el.dataset.k || tidyKn()),
  toggleRun: (el) => { const cur = S.runOpen[el.dataset.id]; const ri = Number(el.dataset.id.split(':').pop()); S.runOpen[el.dataset.id] = !(cur !== undefined ? cur : ri === 0); render() },
  cmpRow: (el) => { S.cmp = S.cmp === el.dataset.id ? null : el.dataset.id; S.menu = null; render() },
  revertRow: async (el) => {
    const k = tidyKn(), [ri, i] = el.dataset.id.split(':').map(Number), row = S.cache['tidy:' + k]?.runs?.[ri]?.rows?.[i]
    if (!row || !row.record) return
    if (!confirm('그 줄을 넣기 전 글로 되돌린다 — 그 정리에 든 기록은 다시 넣지 않는다')) { S.menu = null; return render() }
    try { await postJSON(`/api/k/${encodeURIComponent(k)}/revert`, { record: row.record }); forgetKn(k); delete S.cache['tidy:' + k]; S.menu = null; toast('되돌렸다 — 그 줄만 넣기 전으로'); render() } catch (e) { toast(esc(e.message)) }
  },
  setTidyAt: (el) => setOwnerRow(tidyKn(), { tidyAt: el.dataset.v }),
  setTidyMode: (el) => setOwnerRow(tidyKn(), { tidyMode: el.dataset.v }),
  toggleNoClaude: () => { const r = S.cache['owner:' + tidyKn()] || {}; setOwnerRow(tidyKn(), { noClaude: !r.noClaude }) },
  togglePicker: () => { S.picker = !S.picker; render() },
  addCur: (el) => { const r = S.cache['owner:' + tidyKn()] || {}; S.picker = false; setOwnerRow(tidyKn(), { curators: [...new Set([...(r.curators || []), el.dataset.v])] }) },
  rmCur: (el) => { const r = S.cache['owner:' + tidyKn()] || {}; setOwnerRow(tidyKn(), { curators: (r.curators || []).filter((c) => c !== el.dataset.v) }) },
  editDoc: () => {
    const t = activeTab()
    if (!t) return
    S.edit = { tab: t.id, kn: t.kn, doc: t.ref }
    let draft = null
    try { draft = sessionStorage.getItem(edKey(S.edit)) } catch {}
    if (draft != null) { S.edit.text = draft; toast('저장하지 않은 글을 되살렸다 — 그만두면 버린다') }
    S._focus = 'edTx'
    render()
  },
  cancelEdit: () => { if (S.edit && !S.edit.busy && edLeave('그만두')) { edDrop(); render() } },
  edAddSec: () => {
    const ta = $('#edTx')
    if (!ta || !S.edit) return
    const v = ta.value.replace(/\s+$/, '') + '\n\n## 새 항목\n'
    ta.value = v
    S.edit.text = v
    ta.focus()
    ta.setSelectionRange(v.length - '새 항목\n'.length, v.length - 1)
  },
  retryDoc: (el) => { delete S.cache[el.dataset.k]; render() },
  saveDoc: () => saveDoc(),
  openItem: (el) => { openTab({ kind: 'item', kn: el.dataset.k, ref: el.dataset.n }); render(); scrollTopMain() },
  itemFilt: (el) => { S.ifilt[el.dataset.v] = !S.ifilt[el.dataset.v]; render() },
  foldKind: (el) => { const kd = el.dataset.v; S.kfold[kd] = !kindFolded(S.route.kn, kd); render() },
  moreTables: () => { S.tablesAll = true; render() },
  itemToDoc: (el) => { const it = itemByKey(el.dataset.k, el.dataset.n); if (it && it.doc) { openTab({ kind: 'doc', kn: el.dataset.k, ref: it.doc, hl: it.sec }, { view: 'docs' }); S._lit = true; render() } },
  nbToggle: (el, ev) => { ev.preventDefault(); S.nbOpen = !S.nbOpen; render() },
  openGraph: (el) => { S.g.sel = el.dataset.n; S.g.f.depth = 1; setView('graph') },
  gSet: (el) => { const v = el.dataset.v; S.g.f[v] = !S.g.f[v]; render() },
  gDepth: (el) => { S.g.f.depth = Number(el.dataset.v); render() },
  gZoom: (el) => { zoomAt({ x: 0, y: 0 }, Number(el.dataset.v)) },
  gFit: () => { fitView(CURG); applyView() },
  gBundle: () => { S.g.bundle = !S.g.bundle; render() },
  gUnsel: () => { S.g.sel = null; S.g.f.depth = 0; render() },
  gOpen: (el) => {
    const k = S.route.kn, info = nodeInfo(k, S.g.sel)
    if (!info) return
    if (el.dataset.v === 'items' && info.item) { openTab({ kind: 'item', kn: k, ref: info.item }, { view: 'items' }); render(); return }
    if (info.doc && info.doc.rec) { openTab({ kind: 'rec', kn: k, ref: info.doc.rec }, { view: 'docs' }); render(); return }
    if (info.doc) { openTab({ kind: 'doc', kn: k, ref: info.doc.ref, hl: info.doc.hl || null }, { view: 'docs' }); if (info.doc.hl) S._lit = true; render() }
  },
  legacyOpen: () => { S.legacyOpen = true; S.gateErr = null; render() },
  legacyClose: () => { S.legacyOpen = false; S.gateErr = null; render() },
  copyInstall: () => copyInstall(),
  gateHome: () => { S.gate = null; history.replaceState(null, '', '/'); go({ scr: 'home', kn: '*' }) },
  gateLogin: () => { S.gate = null; history.replaceState(null, '', '/'); render() },
  view: (el) => setView(el.dataset.v),
  nav: (el) => (el.dataset.s === 'add' ? openAdd() : go({ scr: el.dataset.s })),
  kmenu: () => { S.menu = S.menu === 'kmenu' ? null : 'kmenu'; render() },
  // 개인 지식을 고르면 팀 지식에만 있는 화면(정리 · 이 지식의 사람)에서 그 지식의 문서로
  pickKn: (el, ev) => { ev.stopPropagation(); S.menu = null; const k = el.dataset.k; if (k === '*') go({ scr: 'home', kn: '*' }); else go({ scr: KNSCR.includes(S.route.scr) && !(isPersonal(KN(k)) && ['tidy', 'members'].includes(S.route.scr)) ? S.route.scr : 'docs', kn: k }) },
  openKn: (el, ev) => {
    if (ev.target.closest('.kebab,.btn')) return
    if (el.classList.contains('dim')) { toast('내 PC 프로그램이 꺼져 있다 — 켜면 저절로 다시 열린다'); return } go({ scr: 'docs', kn: el.dataset.k }) },
  pairForget: async (el) => {
    if (!confirm(`${el.dataset.v.replace(/^https?:\/\//, '')} — 이 팀 화면에서 내 PC 지식을 더 열지 않는다 · 이 팀의 내 개인 지식 일꾼도 멈춘다(다시 이으려면 팀 화면 › 설치 한 줄)`)) return
    try { await postJSON('/api/pair/forget', { origin: el.dataset.v }); delete S.cache.settings; toast('끊었다') } catch (e) { toast(esc(e.message)) }
    render()
  },
  histGo: (el) => histGo(Number(el.dataset.v)),
  openQo: () => openQo(),
  openSearch: () => openPal(),
  fold: (el) => { const key = S.route.kn + ':' + el.dataset.f; S.fold[key] = !S.fold[key]; render() },
  allDocs: () => { S.all = true; render() },
  openDoc: (el) => openDocAt(el.dataset.k, el.dataset.d, el.dataset.h),
  logKind: (el) => { S.logKind = el.dataset.v; render() },
  openRec: (el) => { openTab({ kind: 'rec', kn: el.dataset.k, ref: el.dataset.r }); render(); scrollTopMain() },
  openAtt: (el) => { openTab({ kind: 'att', kn: el.dataset.k, ref: el.dataset.v }); render() },
  actTab: (el, ev) => { if (ev.target.closest('.x')) return; const t = tabOf(el.dataset.id); if (!t) return; S.active = t.id; if (S.split === t.id) S.split = null; S.route.kn = t.kn; if (!['docs', 'items'].includes(S.route.scr)) S.route.scr = 'docs'; pushHist(); render() },
  closeTab: (el, ev) => { ev.stopPropagation(); if (S.edit && S.edit.tab === el.dataset.id) { if (!edLeave('탭을 닫으')) return; edDrop() } closeTab(el.dataset.id); render() },
  menu: (el, ev) => { if (ev.target.closest('.menu')) return; S.menu = S.menu === el.dataset.m ? null : el.dataset.m; render() },
  splitToggle: () => toggleSplit(),
  closeSplit: () => { S.split = null; render() },
  closeOthers: () => { S.tabs = S.tabs.filter((t) => t.id === S.active); S.split = null; S.menu = null; pushHist(); render() },
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
  reopenSearch: () => { const t = activeTab(); openPal(t && t.q) },
}
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]')
  if (!el) { if (S.menu && !ev.target.closest('.menu,.pop')) { S.menu = null; render() } return }
  if (el.dataset.self && ev.target !== el) return
  const f = ACT[el.dataset.a]
  if (!f) return
  if (el.tagName === 'A') ev.preventDefault()
  if (S.menu && !['menu', 'kmenu', 'pickKn'].includes(el.dataset.a) && !ev.target.closest('.menu,.pop')) S.menu = null
  f(el, ev)
})
document.addEventListener('input', (ev) => {
  const t = ev.target, k = t.dataset && t.dataset.in
  if (!k) return
  // 칸은 다시 그리지 않는다(한글 입력이 끊기지 않게) — 결과 자리만 바꾼다
  if (k === 'pal') { S.pal.q = t.value; runFind() }
  if (k === 'qo') { S.qo.q = t.value; S.qo.sel = 0; $('#qoBody').innerHTML = qoBody() }
  if (k === 'cmd') { S.cmd.q = t.value; S.cmd.sel = 0; $('#cmdBody').innerHTML = cmdBody() }
  if (k === 'itemQ') { S.iq = t.value; $('#itemListBody').innerHTML = itemListBody(S.route.kn) }
  if (k === 'gQ') { S.g.f.q = t.value; gHighlight() }
  if (k === 'del' && S.del) { S.del.typed = t.value; const n = KN(S.del.kn); $('#delBtnBox').innerHTML = delBtn(!!n && t.value.trim() === n.name) }
  if (k === 'ag') { S.agDraft = t.value; $('#agBtnBox').innerHTML = agBtn() }
  if (k === 'admCode') { S.admCode = t.value; $('#admDoneBox').innerHTML = admDoneBtn() }
  if (k === 'sf') sfState()[t.dataset.f] = t.value
  if (k === 'se' && S.se) S.se[t.dataset.f] = t.value
  if (k === 'sendQ') { S.sendQ = t.value; const q = t.value.trim().toLowerCase(); for (const r of document.querySelectorAll('[data-t=sendDoc],[data-t=sendRec]')) r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none' }
  if (k === 'edTx' && S.edit) { S.edit.text = t.value; try { sessionStorage.setItem(edKey(S.edit), t.value) } catch {} return }
  if (k === 'addDir' && S.addPop) S.addPop.dir = t.value
  if (k === 'admAddId' && S.admAdd) S.admAdd.id = t.value
  if (k === 'addName' && S.addPop) { S.addPop.name = t.value; if (S.addPop.err) { S.addPop.err = null; const m = $('[data-t=addMsg]'); if (m) m.remove() } }
})
// 파일 · 폴더 — 고르기 · 끌어다 놓기
document.addEventListener('change', (ev) => { const t = ev.target; if (t.dataset && t.dataset.model != null) { ACT.pickModel(t); return } if (t.dataset && t.dataset.t === 'destPick') { ACT.destPick(t); return } if (t.id === 'impKn') { S.impKn = t.value; render(); return } if (t.dataset && t.dataset.se && S.se) { S.se[t.dataset.se] = t.value; render(); return } if (t.dataset && t.dataset.sf) { sfState()[t.dataset.sf] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.sf === 'rule') render(); return } if (t.id === 'logKn') { S.logKn = t.value; render(); return } if (t.id === 'fileIn' || t.id === 'dirIn') { takeFiles(t.files); t.value = '' } })
document.addEventListener('dragstart', (ev) => { const c = ev.target.closest && ev.target.closest('[data-drag]'); if (!c) return; S.dragK = c.dataset.drag; c.classList.add('drag'); ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', c.dataset.drag) } catch {} })
document.addEventListener('dragend', () => { S.dragK = null; for (const x of document.querySelectorAll('.kcard.drag,.kcard.over')) x.classList.remove('drag', 'over') })
document.addEventListener('dragover', (ev) => { const c = S.dragK && ev.target.closest && ev.target.closest('[data-drag]'); if (c) { ev.preventDefault(); for (const x of document.querySelectorAll('.kcard.over')) if (x !== c) x.classList.remove('over'); if (c.dataset.drag !== S.dragK) c.classList.add('over') } })
document.addEventListener('drop', (ev) => { const c = S.dragK && ev.target.closest && ev.target.closest('[data-drag]'); if (!c) return; ev.preventDefault(); const r = c.getBoundingClientRect(); knPlace(S.dragK, c.dataset.drag, ev.clientX > r.left + r.width / 2); S.dragK = null })
// 팝업은 스크롤해도 단추를 따라간다
document.addEventListener('scroll', () => { if (S.menu) placePop() }, true)
window.addEventListener('resize', () => { if (S.menu) placePop() })
document.addEventListener('dragover', (ev) => { const d = ev.target.closest && ev.target.closest('#drop'); if (d) { ev.preventDefault(); d.classList.add('over') } })
document.addEventListener('dragleave', (ev) => { const d = ev.target.closest && ev.target.closest('#drop'); if (d) d.classList.remove('over') })
document.addEventListener('drop', async (ev) => {
  const d = ev.target.closest && ev.target.closest('#drop')
  if (!d) return
  ev.preventDefault()
  d.classList.remove('over')
  const items = [...(ev.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean)
  if (!items.length) { takeFiles(ev.dataTransfer.files); return }
  const out = []
  await Promise.all(items.map((e) => readEntries(e, '', out)))
  takeFiles(out)
})
function listKeys(ev, st, bodyId, bodyFn, pick) {
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault()
    const n = (st.list || []).length
    if (n) { st.sel = (st.sel + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n; $('#' + bodyId).innerHTML = bodyFn(); const s = $('#' + bodyId + ' .qr.sel'); if (s) s.scrollIntoView({ block: 'nearest' }) }
    return true
  }
  if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); pick(st.sel); return true }
  return false
}
document.addEventListener('keydown', (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey, low = String(ev.key).toLowerCase(), code = ev.code
  if (!S.me || anon()) return
  if (S.edit && ev.target.id === 'edTx' && ctrl && (low === 's' || code === 'KeyS')) { ev.preventDefault(); saveDoc(); return }
  if (S.edit && ev.target.id === 'edTx' && ev.key === 'Escape' && !S.sudo) { ev.preventDefault(); ACT.cancelEdit(); return }
  if (S.qo && ev.target.id === 'qoIn' && listKeys(ev, S.qo, 'qoBody', qoBody, qoPick)) return
  if (S.cmd && ev.target.id === 'cmdIn' && listKeys(ev, S.cmd, 'cmdBody', cmdBody, cmdPick)) return
  if (ctrl && !ev.altKey) {
    if (low === 'k' || code === 'KeyK') { ev.preventDefault(); openPal(); return }
    if (low === 'o' || low === 't' || code === 'KeyO' || code === 'KeyT') { ev.preventDefault(); openQo(); return }
    if (low === 'p' || code === 'KeyP') { ev.preventDefault(); openCmd(); return }
    if (ev.key === '\\' || code === 'Backslash') { ev.preventDefault(); toggleSplit(); return }
  }
  if (ev.altKey && !ctrl && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !/^(TEXTAREA|INPUT)$/.test(ev.target.tagName)) { ev.preventDefault(); histGo(ev.key === 'ArrowLeft' ? -1 : 1); return }
  if (ev.key === 'Escape' && S.sudo) { sudoCancel(); return }
  if (ev.key === 'Escape' && S.off && !S.off.busy) { S.off = null; render(); return }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'sudoPw') { ev.preventDefault(); sudoOk(); return }
  if (ev.key === 'Escape' && S.del && !S.del.busy) { S.del = null; render(); return }
  if (ev.key === 'Escape' && S.addPop && !S.addPop.busy) { S.addPop = null; render(); return }
  if (ev.key === 'Escape' && S.se && !S.se.busy) { S.se = null; render(); return }
  if (ev.key === 'Escape' && S.sfOpen) { S.sfOpen = false; render(); return }
  if (ev.key === 'Escape') { if (S.qo) S.qo = null; else if (S.cmd) S.cmd = null; else if (S.pal) S.pal = null; else if (S.menu) S.menu = null; else return; render() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'palIn') { const h = $('#app .hit'); if (h) h.click() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'addIn') { ev.preventDefault(); doAdd() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.dataset && ev.target.dataset.in === 'sf') { ev.preventDefault(); const b = $('[data-t=sfAdd]') || $('[data-t=sfAsk]'); if (b) b.click() }
})

// 아래 줄 시계 — 분마다
setInterval(() => { const c = $('[data-t=clock]'); if (c && S.me) c.textContent = `kmd v${S.me.version} · ${clock()}` }, 30000)
// 자료 가져오기를 보는 동안 — 감시가 뒤에서 바꾼 줄을 20초마다 조용히 다시(칸에 쓰는 중 · 메뉴 · 창이 열려 있으면 그다음에)
setInterval(async () => {
  if (!S.me || gated() || S.route.scr !== 'import' || S.menu || S.del || S.pal || S.qo || S.cmd || S.se || S.sfOpen) return
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return
  const v = await getJSON('/api/sources').catch(() => null)
  if (v && JSON.stringify(v) !== JSON.stringify(S.cache.sources)) { S.cache.sources = v; render() }
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
  stopTimer = setInterval(loadStops, 60000)
  loadClaude({ verify: true })
  loadBusy()
  clearInterval(claudeTimer)
  claudeTimer = setInterval(() => loadClaude({ verify: true }), 30 * 60_000)
  document.title = isTeam() ? 'kmd — 팀' : 'kmd'
  if (!S.hist.length) pushHist()
  // 팀 지식은 바로 그리고, 내 PC 프로그램은 뒤에서 잇는다(붙으면 다시 그린다) — PC 가 늦어도 팀 화면이 기다리지 않는다.
  // 내 PC 문서 주소(#~지식/문서)는 첫 그리기가 지우기 전에 잡아 두고, 붙은 뒤 그사이 다른 곳으로 옮기지 않았으면 연다
  const hm = location.hash.match(/^#(~[^/]+)\/(.+)$/)
  const openHash = () => { if (hm && KN(decodeURIComponent(hm[1]))) { openTab({ kind: 'doc', kn: decodeURIComponent(hm[1]), ref: decodeURIComponent(hm[2]) }, { view: 'docs' }); return true } return false }
  const pc = isTeam() && S.me.pcUrl ? pcConnect() : null
  if (!pc) openHash()
  render() // openTab 은 그리지 않는다 — 열었든 아니든 여기서 그린다
  if (!pc) return
  const at = [S.hpos, S.active, S.route.scr]
  pc.then(() => {
    const still = at[0] === S.hpos && at[1] === S.active && at[2] === S.route.scr
    // 들어가기 화면(처음 들어오기 · 남의 링크)은 PC 상태를 쓰지 않는다 — 비밀번호 칸을 다시 그려 지우지 않게
    if (gated()) return
    if (still && openHash()) return render()
    if (!typing()) render()
  })
}

// ───────────── 시작 ─────────────
// 이 PC 화면의 한 번용 번호(#once=) — 받으면 들어온다 · 지났거나 쓴 번호면 그 까닭을 들어가기 화면에 보인다
async function takeOnce() {
  const once = (location.hash.match(/(?:^#|&)once=([^&]+)/) || [])[1]
  if (!once) return false
  S.onceErr = null
  await postJSON('/once', { code: once }).catch((e) => { S.onceErr = e.message })
  history.replaceState(null, '', location.pathname === '/pair' ? location.pathname + location.search : '/')
  return true
}
// 같은 탭에 새 번호를 붙여도(시작 메뉴 kmd 가 이미 열린 탭을 다시 쓸 때) 들어온다
window.addEventListener('hashchange', async () => {
  if (!/(?:^#|&)once=/.test(location.hash)) return
  try {
    await takeOnce()
    await loadAll()
  } catch (e) {
    S.err = 'kmd 에 닿지 않는다 — ' + e.message
    render()
  }
})
async function boot() {
  render() // 처음 읽는 동안 흰 화면 대신 「읽는 중」
  try {
    const code = (location.hash.match(/(?:^#|&)code=([^&]+)/) || [])[1]
    await takeOnce()
    if (location.pathname === '/first') {
      S.gate = 'first'
      S.gateCode = code ? decodeURIComponent(code) : ''
      S.gateUser = S.gateCode ? (await postJSON('/first', { check: true, code: S.gateCode }).catch(() => ({}))).user || null : null
    } else if (location.pathname === '/setup') {
      S.gate = 'setup'
      S.gateCode = code ? decodeURIComponent(code) : ''
    }
    await loadAll()
  } catch (e) {
    S.err = 'kmd 에 닿지 않는다 — ' + e.message
    render()
  }
}
boot()
