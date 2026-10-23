// kmd 화면 — 목업(kmd_목업_인터랙션.html)의 그리기 · 이벤트를 그대로 옮기고 자료만 서버에서 받는다.
//
// 그리기는 목업처럼 글 틀(문자열)로 한 번에 다시 그린다. 자료는 화면이 처음 필요할 때 받아
// 두고(S.cache), 받는 동안은 빈 자리로 그렸다가 받으면 다시 그린다.
//
// K0 에 있는 것: 셸(리본 · 옆 메뉴 · 머리 · 띠 · 아래 줄) · 지식 목록 · 문서로 보기(나무 · 탭 · 나누기 ·
// 문서 · 기록 · 첨부 · 옆 칸) · 빨리 열기 · 찾기 · 명령 창. 항목 · 그래프 · 일 화면은 뒤 판이 채운다.

import { $, esc, norm, uid, svg, whenTxt, isToday, hhmm, clock } from './ui.js'
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
}
const KNSCR = ['docs', 'items', 'graph']
const KN = (k) => S.kns.find((x) => x.id === k) || null
const isTeam = () => S.me && S.me.mode === 'team'
// 들어오기 전 — 들어가기 · 처음 들어오기 링크 · 첫 설정 화면
const anon = () => !!S.me && (!!S.me.anon || !!S.gate)
const knType = () => (isTeam() ? 'team' : 'pc')

// ───────────── 자료 ─────────────
async function getJSON(p) {
  const r = await fetch(p, { headers: { accept: 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 && S.me && !S.me.anon) { S.me = { ...S.me, anon: true }; setTimeout(render) }
  if (!r.ok) throw Object.assign(new Error(j.message || '서버에 닿지 않는다'), { code: j.error })
  return j
}
// 있으면 바로 · 없으면 받기 시작하고 null(받으면 다시 그린다)
function need(key, path) {
  if (key in S.cache) return S.cache[key]
  if (!S.wait[key]) {
    S.wait[key] = getJSON(path)
      .then((v) => { S.cache[key] = v }, (e) => { S.cache[key] = { error: e.message } })
      .finally(() => { delete S.wait[key]; render() })
  }
  return null
}
const treeOf = (k) => need('tree:' + k, `/api/k/${encodeURIComponent(k)}/tree`)
const docOf = (k, d) => need(`doc:${k}:${d}`, `/api/k/${encodeURIComponent(k)}/doc?d=${encodeURIComponent(d)}`)
const recOf = (k, r) => need(`rec:${k}:${r}`, `/api/k/${encodeURIComponent(k)}/rec?r=${encodeURIComponent(r)}`)
const loadingHtml = '<p class="muted small">읽는 중…</p>'
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
function go(r) {
  r = r || {}
  const prevKn = S.route.kn
  S.route = Object.assign({ scr: 'home', kn: S.route.kn }, r)
  S.menu = null
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
  return KN(S.lastKn) ? S.lastKn : S.kns[0] && S.kns[0].id
}
function setView(v) { go({ scr: v, kn: defaultKn() }) }
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
  else if (!['docs', 'items'].includes(S.route.scr)) S.route.scr = 'docs'
  if (!o.noHist) pushHist()
  return ex
}
function tabTitle(t) {
  if (t.kind === 'doc') { const tr = S.cache['tree:' + t.kn]; const d = tr && tr.docs && tr.docs.find((x) => x.id === t.ref); return d ? d.title : t.ref }
  if (t.kind === 'rec') { const tr = S.cache['tree:' + t.kn]; const r = tr && tr.records && tr.records.find((x) => x.id === t.ref); return r ? r.title.split(' — ')[0] : '기록' }
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
  const scr = anon() ? gateView() : viewOf(S.route.scr)
  const center = scr.tabs
    ? `<div class="center">${tabbarHtml()}<div class="panes"><div class="main" data-t="main">${scr.main}</div>${scr.right != null ? `<div class="main rp" data-t="rightPane">${scr.right}</div>` : ''}</div></div>`
    : `<div class="main" data-t="main">${scr.main}</div>`
  app.innerHTML = ribbonHtml() + sideHtml(scr.left) + `<div class="col">${hdrHtml(scr.crumb)}${anon() ? '' : bandHtml()}<div class="body">${center}${scr.aside ? `<div class="aside" data-t="aside">${scr.aside}</div>` : ''}</div>${statusHtml()}</div>${S.pal ? palHtml() : ''}${S.qo ? qoHtml() : ''}${S.cmd ? cmdHtml() : ''}`
  if (anon()) { const g = $('[data-focus]'); if (g && document.activeElement !== g) g.focus(); return }
  const fi = $('#palIn') || $('#qoIn') || $('#cmdIn')
  if (fi && document.activeElement !== fi) { fi.focus(); fi.setSelectionRange(fi.value.length, fi.value.length) }
  if (S._lit) {
    const el = $('#app .main[data-t=main] .lit')
    if (el) { S._lit = false; setTimeout(() => el.scrollIntoView({ block: 'center' }), 30) }
  }
}
function viewOf(s) {
  const f = { home: viewHome, docs: viewDocsV, items: viewItems, graph: viewGraph }[s]
  return f ? f() : viewLater(s)
}
function ribbonHtml() {
  const r = anon() ? null : S.route.scr
  const b = (v, l, ic) => `<button class="rb${r === v ? ' on' : ''}" data-a="view" data-v="${v}" data-t="rb-${v}" title="${l}로 보기">${svg(ic)}<span>${l}</span></button>`
  return `<nav class="ribbon${anon() ? ' dim' : ''}" data-t="ribbon">${b('docs', '문서', 'doc')}${b('items', '항목', 'tag')}${b('graph', '그래프', 'graph')}<span class="sp"></span><button class="rb${r === 'settings' ? ' on' : ''}" data-a="nav" data-s="settings" data-t="nav-settings" title="설정">${svg('gear')}<span>설정</span></button></nav>`
}
function sideHtml(left) {
  const r = S.route, team = isTeam()
  const cur = r.kn && r.kn !== '*' ? KN(r.kn) : null
  const ktag = () => (team ? '<span class="kt team">팀</span>' : '<span class="kt me">개인</span>')
  const dim = anon()
  let h = `<aside class="side${dim ? ' dim' : ''}"><div class="sb-top"><div class="logo${team ? '' : ' me'}">K</div><span class="brand">kmd</span></div><div class="where">${team ? '팀 서버에서 돈다 · ' + esc(S.me.host) : '이 PC 에서 돈다'}</div>`
  const cnt = team ? '팀 ' + S.kns.length : '내 지식 ' + S.kns.length
  if (!dim) h += `<div class="sb-repo" data-a="kmenu" data-t="kpick">${cur ? `<span class="rk">${esc(cur.name.slice(0, 2))}</span><span class="rn">${esc(cur.name)} <small>${team ? '팀 서버' : esc(cur.dir || '')}</small></span>` : `<span class="rk">전체</span><span class="rn">지식 전체<small>${cnt}</small></span>`}<span class="rc">▾</span>${S.menu === 'kmenu' ? `<div class="kmenu"><div class="mi" data-a="pickKn" data-k="*" data-t="nav-home">${svg('list')} 지식 목록 — 전체</div>${S.kns.map((k) => `<div class="mi" data-a="pickKn" data-k="${esc(k.id)}">${esc(k.name)} ${ktag()}</div>`).join('')}</div>` : ''}</div>`
  const it = (key, l, ic) => `<div class="sb-i${!dim && r.scr === key ? ' on' : ''}" data-a="nav" data-s="${key}" data-t="nav-${key}">${svg(ic)}<span>${l}</span></div>`
  h += '<div class="nav">' + it('today', '오늘 바뀐 것', 'check') + it('import', '자료 가져오기', 'plug') + '</div>'
  if (left) h += `<div class="lp" data-t="leftPane">${left}</div>`
  h += '<div class="sb-foot"><div class="nav"><div class="sb-i deco">' + svg('book') + '<span>설명서</span></div></div>'
  h += dim ? '<div class="sb-me"><span class="av">?</span><span class="muted">아직 들어오지 않았다</span></div>' : `<div class="sb-me"><span class="av">${esc(String(S.me.user).slice(0, 1))}</span><span>${esc(S.me.user)} <small>· ${team ? '팀 서버' : '이 PC'}</small></span></div>`
  return h + '</div></aside>'
}
function hdrHtml(crumb) {
  const r = S.route
  const kn = r.kn && r.kn !== '*' && KNSCR.includes(r.scr) && KN(r.kn) ? KN(r.kn).name : ''
  const parts = String(crumb || '').split(' › ').filter(Boolean)
  const c = (kn && parts[0] !== kn ? '<span>' + esc(kn) + '</span> › ' : '') + parts.map((x, i) => (i === parts.length - 1 ? '<b>' + esc(x) + '</b>' : esc(x))).join(' › ')
  const hb = `<span class="hist"><button class="hb" data-a="histGo" data-v="-1" data-t="histBack" title="이전 (Alt ←)"${S.hpos > 0 ? '' : ' disabled'}>‹</button><button class="hb" data-a="histGo" data-v="1" data-t="histFwd" title="다음 (Alt →)"${S.hpos < S.hist.length - 1 ? '' : ' disabled'}>›</button></span>`
  if (anon()) return `<header class="hdr"><span class="crumb">${c}</span></header>`
  return `<header class="hdr">${hb}<span class="crumb">${c}</span><div class="qbtn" data-a="openQo" data-t="qoBtn" title="문서 · 항목 · 기록 이름으로 바로 연다">빨리 열기 <kbd>Ctrl O</kbd></div><div class="search" data-a="openSearch" data-t="search">${svg('search')}<span style="margin-left:6px">찾기</span><span style="margin-left:auto;font-size:11px">Ctrl K</span></div></header>`
}
function bandHtml() {
  const r = S.route, team = isTeam()
  const k = r.kn && r.kn !== '*' && KNSCR.includes(r.scr) ? r.kn : null
  let left
  if (!k) left = team ? '팀 서버의 kmd · 같이 쓴다' : '이 PC 의 kmd · 나만 쓴다'
  else left = team ? '팀 지식 · 팀 서버 · 나: 기록' : '내 지식 · ' + ((KN(k) && KN(k).dir) || '') + ' · 나만'
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
    if (JSON.stringify(st) !== JSON.stringify(S.stops)) { S.stops = st; if (!S.qo && !S.pal && !S.cmd) render() }
  } catch {}
}

function statusHtml() {
  const l = anon() ? (S.gate === 'setup' ? '첫 설정 · 아직 관리자가 없다' : '') : isTeam() ? '들어옴 · ' + esc(S.me.user) : '이 PC'
  return `<div class="status"><span>${l}</span><span class="r" data-t="clock">kmd v${esc(S.me.version)} · ${clock()}</span></div>`
}

// ── 지식 목록 ──
function knMeta(n) {
  return isTeam() ? '문서 ' + n.docs + ' · 팀 모두 기록' : '문서 ' + n.docs + (n.when ? ' · ' + whenTxt(n.when) : '')
}
function viewHome() {
  const team = isTeam()
  const rows = S.kns.map((n) => {
    const tag = team ? '<span class="kt team">팀</span>' : ''
    const rr = ''
    return `<div class="krow" data-a="openKn" data-k="${esc(n.id)}" data-t="krow" data-name="${esc(n.name)}"><span class="nm">${esc(n.name)} ${tag}</span><span class="meta">${esc(knMeta(n))}</span><span class="rr">${rr}</span></div>`
  }).join('')
  const none = '<div class="cb"><div class="empty2"><b>아직 지식이 없다</b>폴더 안에 md 폴더를 두면 지식이 된다</div></div>'
  return {
    crumb: '지식 목록',
    main: `<div style="max-width:960px"><div class="top"><div><div class="big">지식 목록</div>${team ? '' : '<p class="lead">내 지식 ' + S.kns.length + '</p>'}</div><div class="acts"></div></div>
  ${S.stops.map(stopHtml).join('')}
  <div class="card" data-t="klist">${rows || none}</div>
  <p class="tl"><a data-a="nav" data-s="add">+ 지식 추가</a><a data-a="nav" data-s="import">+ 자료 가져오기</a></p></div>`,
  }
}

// ── 아직 없는 화면(뒤 판) ──
const LATER = { today: '오늘 바뀐 것', import: '자료 가져오기', add: '지식 추가', settings: '설정' }
function viewLater(s) {
  return { crumb: LATER[s] || '지식 목록', main: `<div style="max-width:760px"><div class="big">${esc(LATER[s] || '')}</div><div class="callout gray" data-t="later">이 화면은 다음 판에 열린다 — 지금은 문서로 보기에서 읽는다. <a data-a="view" data-v="docs">문서로 보기 ›</a></div></div>` }
}
function viewItems() {
  const k = defaultKn()
  return { crumb: '항목으로 보기', tabs: true, main: `<div style="max-width:760px"><div class="big">${esc(KN(k) ? KN(k).name : '')}</div><div class="callout gray" data-t="later">항목으로 보기는 다음 판에 열린다 — 지금은 문서로 보기에서 읽는다. <a data-a="view" data-v="docs">문서로 보기 ›</a></div></div>` }
}
function viewGraph() {
  return { crumb: '그래프', main: `<div style="max-width:760px"><div class="big">그래프</div><div class="callout gray" data-t="later">그래프는 다음 판에 열린다 — 지금은 문서로 보기에서 읽는다. <a data-a="view" data-v="docs">문서로 보기 ›</a></div></div>` }
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
  return attPane(t, right)
}
function viewDocsV() {
  const k = pickKn()
  if (!k) return { crumb: '문서로 보기', tabs: true, main: viewHome().main }
  const c = centerOf(() => ({ main: docsEmpty(k), aside: knAside(k) }))
  return { crumb: '문서로 보기' + (c.title ? ' › ' + c.title : ''), main: c.main, aside: c.aside, right: c.right, tabs: true, left: treeHtml(k) }
}
function knAside(k) {
  const team = isTeam()
  return `<h4>이 지식</h4><div class="kv">${team ? '<span>쓰는 사람</span><span>팀 모두 기록</span>' : '<span>주인</span><span>나 — 정리하면 바로 바뀐다</span>'}
  <span>자동으로 가져오는 곳</span><span>없음<small><a data-a="nav" data-s="import">자료 가져오기 ›</a></small></span></div>`
}
function myPend(tr) { return (tr && tr.records ? tr.records : []).filter((r) => r.state === 'pend' && r.author === S.me.user) }
function waitHtml(k, tr) {
  const p = myPend(tr)
  return p.length ? `<div class="wait" data-t="wait"><i></i>${p.map((x) => esc(whenTxt(x.date)) + ' 에 쓴 기록 1 — 정리 때 문서에 들어간다 · ' + esc(x.title.split(' — ')[0])).join('<br>')} · 그동안도 문서 옆에 같이 읽힌다</div>` : ''
}
function docsEmpty(k) {
  const n = KN(k), tr = treeOf(k)
  const ds = tr && tr.docs ? tr.docs : []
  return `<div style="max-width:760px"><div class="big">${esc(n.name)}</div><p class="lead">${isTeam() ? '팀 모두 기록' : '내 지식 · ' + esc(n.dir || '') + ' · 나만'}</p>${waitHtml(k, tr)}
  <div class="callout gray" data-t="docsEmpty">왼쪽 나무에서 문서나 기록을 연다 — 여러 개를 탭으로 띄우고, <b>Ctrl \\</b> 로 둘을 나란히 본다. 이름으로 바로 열려면 <b>Ctrl O</b>.</div>
  <div class="card"><div class="ch">최근 바뀐 문서 <small>문서 ${ds.length}</small></div><div class="cb" style="padding:2px 14px 4px"><ul class="plain dl">${tr ? ds.slice(0, 5).map((d) => `<li data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="recentDoc">${svg('doc', 'di')}<span class="nm">${esc(d.title)}</span><span class="when${isToday(d.when) ? ' td' : ''}">${esc(whenTxt(d.when))}</span></li>`).join('') : `<li>${loadingHtml}</li>`}</ul></div></div></div>`
}
function treeHtml(k) {
  const n = KN(k), tr = treeOf(k)
  if (!tr) return `<div class="tree" data-t="tree"><div class="lh">${esc(n.name)}</div>${loadingHtml}</div>`
  if (tr.error) return `<div class="tree" data-t="tree"><div class="lh">${esc(n.name)}</div>${errHtml(tr)}</div>`
  const ds = tr.docs, fk = (f) => !!S.fold[k + ':' + f]
  const all = S.all, list = all ? ds : ds.slice(0, 11)
  const head = (f, l, cnt, extra) => `<div class="tf" data-a="fold" data-f="${f}" data-t="fold-${f}"><span class="ar">${fk(f) ? '▸' : '▾'}</span>${l}${extra || ''}<span class="cnt">${cnt}</span></div>`
  let h = `<div class="tree" data-t="tree"><div class="lh">${esc(n.name)}</div>` + head('docs', '문서', ds.length)
  if (!fk('docs')) h += list.map((d) => `<div class="tn${isAct('doc', k, d.id) ? ' on' : ''}" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="doc" data-name="${esc(d.title)}">${svg('doc')}<span class="nm">${esc(d.title)}</span>${d.pend ? '<i class="pd" title="아직 문서에 안 넣은 기록이 있다"></i>' : ''}</div>`).join('') + (!all && ds.length > 11 ? `<div class="tn more" data-a="allDocs" data-t="moreDocs">${ds.length - 11}개 더</div>` : '')
  const rs = tr.records
  h += head('recs', '기록', rs.length, ' <small>날짜 순</small>')
  if (!fk('recs')) h += rs.length ? rs.map((r) => `<div class="tn${isAct('rec', k, r.id) ? ' on' : ''}" data-a="openRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="rec" data-state="${r.state}">${r.state === 'pend' ? '<i class="pd" title="아직 문서에 안 넣은 기록"></i>' : ''}<span class="dt">${esc(isToday(r.date) ? hhmm(r.date) : whenTxt(r.date))}</span><span class="nm">${esc(r.title.split(' — ')[0])}</span></div>`).join('') : `<div class="tn muted nc">${isTeam() ? '아직 없다' : '내 지식은 고치면 바로 문서다'}</div>`
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
  const recs = bl.recs.map((r) => `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(r.id)}" data-t="blRec"><span class="dt">${r.state === 'pend' ? '●' : esc(whenTxt(r.date).replace(/^(오늘|어제) /, ''))}</span><span class="nm">${esc(r.title)}</span></div>`).join('')
  const docs = bl.linkers.map((o) => `<div class="alr" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(o.id)}" data-t="blDoc">${svg('doc')}<span class="nm">${esc(o.title)}</span></div>`).join('')
  const ments = bl.ments.map((x) => `<div class="alr" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(x.d)}" data-h="${esc(x.h)}" data-t="blMent">${svg('doc')}<span class="nm">${esc(x.title)} › ${esc(x.h)}<small>「${esc(x.x)}」</small></span></div>`).join('')
  return `<div class="ap" data-t="outline"><h4>개요</h4>${ol}</div>
  <div class="ap" data-t="backlinks"><h4>이 문서를 가리키는 것</h4>
   <div class="bg">기록 <b data-t="blRecN">${bl.recs.length}</b> <small>이 문서의 항목을 건드린 것</small></div>${recs || none}
   <div class="bg">문서 <b data-t="blDocN">${bl.linkers.length}</b> <small>이 문서를 링크한 것</small></div>${docs || none}
   <div class="bg">이름만 나온 곳 <b data-t="blMentN">${bl.ments.length}</b> <small>링크 없이 이름만</small></div>${ments || none}</div>
  <div class="ap" data-t="props"><h4>속성</h4><div class="kv"><span>마지막 정리</span><span>${esc(d.last ? whenTxt(d.last.date) + ' — ' + d.last.author + '의 기록에서' : whenTxt(d.when))}</span><span>가져오는 곳</span><span>없음</span><span>자리</span><span>${isTeam() ? '팀' : '내 PC'}</span><span>항목</span><span>${d.items}</span></div></div>`
}
function docPane(t, right) {
  const k = t.kn, n = KN(k), d = docOf(k, t.ref)
  if (!d) return { html: loadingHtml, title: tabTitle(t) }
  if (d.error) return { html: '<p class="muted">이 문서는 이제 없다 — 탭을 닫는다</p>', title: t.ref }
  const hl = right ? null : t.hl, q = right ? null : t.q
  const loc = isTeam() ? n.name + ' › ' + d.title : n.name + ' › ' + d.path.replace(/^docs\//, '')
  const mine = d.sections.flatMap((s) => s.pend.filter((x) => x.author === S.me.user))
  const body = d.sections.map((s) => {
    const lit = hl && s.h === hl
    const hn = s.named ? `<span class="hn" data-t="hn" title="이 항목을 건드린 기록">${s.pend.length ? '<i class="pd"></i>' : ''}기록 ${s.recs}</span>` : ''
    const by = s.by && isToday(s.by.date) ? `<div class="hc"><span class="hchip">${esc(whenTxt(s.by.date))} 넣음 — ${esc(s.by.author)}의 기록에서</span></div>` : ''
    const pens = s.pend.map((x) => `<div class="penrec" data-t="penrec"><i></i><span><b>아직 문서에 안 넣은 기록 1</b> · ${esc(whenTxt(x.date))} · ${esc(x.author === S.me.user ? '나' : x.author)} — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}">「${esc(x.title)}」</a> · 같이 읽힌다</span></div>`).join('')
    return `<h2 data-sec="${esc(s.h)}">${esc(s.h)}${hn}</h2>${lit ? `<div class="lit" data-t="lit"><span class="tag">찾은 곳</span>${s.html}</div>` : s.html}${by}${pens}`
  }).join('')
  const main = `<div class="docw" data-t="docPane" data-name="${esc(d.title)}">${right ? rpHead() : ''}
  ${q ? `<div class="found" data-t="found"><span>찾기 <b>‘${esc(q)}’</b> 로 열었다</span><a data-a="reopenSearch">찾은 것으로 돌아가기</a></div>` : ''}
  <div class="ttl"><div class="path"><span>${esc(loc)}</span><span class="r">마지막으로 바뀐 때 ${esc(whenTxt(d.when))}</span></div></div>
  ${mine.length ? `<div class="wait" data-t="wait"><i></i>${esc(whenTxt(mine[0].date))} 에 쓴 기록 ${mine.length} — 정리 때 문서에 들어간다 · 그동안도 문서 옆에 같이 읽힌다</div>` : ''}
  <div class="paper"><h1>${esc(d.title)}</h1>${d.intro ? d.intro.replace(/<p>/g, '<p class="muted small">') : ''}${body}
  ${d.links.length ? `<div class="dlinks" data-t="dlinks">이 문서가 가리키는 문서 — ${d.links.map((x) => `<span class="dlink" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(x.id)}" data-t="dlink">${esc(x.title)}</span>`).join(' · ')}</div>` : ''}</div></div>`
  return { html: main, aside: right ? null : docAside(k, d), title: d.title }
}
function recPane(t, right) {
  const k = t.kn, r = recOf(k, t.ref)
  if (!r) return { html: loadingHtml, title: tabTitle(t) }
  if (r.error) return { html: '<p class="muted">이 기록은 이제 없다 — 정리되어 다른 이름으로 남았을 수 있다</p>', title: '기록' }
  const fx = r.fixes[0], fb = r.fixedBy, who = (w) => (w === S.me.user ? '나' : w)
  const html = `<div class="docw" data-t="recPane" data-name="${esc(r.title)}">${right ? rpHead() : ''}<div class="ttl"><div class="path"><span>${esc(KN(k).name)} › 기록 › ${esc(r.date)}</span><span class="r">${r.state === 'pend' ? '<span class="chip c-pend" data-t="recState">아직 문서에 안 넣은 기록</span>' : r.state === 'in' ? '<span class="chip c-mute" data-t="recState">문서에 들어감</span>' : ''}</span></div></div>
  <div class="paper"><h1>${esc(r.title)}</h1><p class="muted small">${esc(r.author)} · ${esc(r.date)}</p>${r.html}
  ${fx ? `<div class="callout warn">이 기록은 ${esc(whenTxt(fx.date))} ${esc(who(fx.author))}의 기록을 바로잡았다 — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(fx.id)}">${esc(fx.title)}</a></div>` : ''}${fb.map((x) => `<div class="callout gray">${esc(whenTxt(x.date))} ${esc(who(x.author))}이 이 기록을 바로잡았다 — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}">${esc(x.title)}</a></div>`).join('')}
  ${r.state === 'pend' ? '<div class="callout pend">정리 때 문서에 들어간다 — 그동안도 그 항목 옆에 같이 읽힌다</div>' : ''}</div></div>`
  const aside = `<div class="ap" data-t="recItems"><h4>이 기록이 건드린 항목 <small>${r.items.length}</small></h4>${r.items.map((i) => `<div class="alr${i.doc ? '' : ' muted'}"${i.doc ? ` data-a="openDoc" data-k="${esc(k)}" data-d="${esc(i.doc)}"${i.h ? ` data-h="${esc(i.h)}"` : ''}` : ''} data-t="recItem">${svg('tag')}<span class="nm">${esc(i.name)}<small>${esc(i.docTitle ? i.docTitle : '문서가 없는 항목')}</small></span></div>`).join('') || '<div class="muted small alr">없다</div>'}</div>
  <div class="ap" data-t="recFix"><h4>바로잡은 / 바로잡힌 기록</h4>${fx ? `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(fx.id)}" data-t="fixRow"><span class="dt">${esc(whenTxt(fx.date).replace(/^(오늘|어제) /, ''))}</span><span class="nm">바로잡음 — ${esc(fx.title)}</span></div>` : ''}${fb.map((x) => `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}" data-t="fixRow"><span class="dt">${esc(whenTxt(x.date).replace(/^(오늘|어제) /, ''))}</span><span class="nm">바로잡힘 — ${esc(x.title)}</span></div>`).join('')}${fx || fb.length ? '' : '<div class="muted small alr">없다</div>'}</div>`
  return { html, aside: right ? null : aside, title: r.title.split(' — ')[0] }
}
const extOf = (n) => { const m = String(n).toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : '' }
function attPane(t, right) {
  const ext = extOf(t.ref), img = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
  const src = `/api/k/${encodeURIComponent(t.kn)}/att?a=${encodeURIComponent(t.ref)}`
  return {
    html: `<div class="docw" data-t="attPane">${right ? rpHead() : ''}<div class="ttl"><div class="path"><span>${esc(KN(t.kn).name)} › 첨부 › ${esc(t.ref)}</span></div></div><div class="paper"><h1>${esc(t.ref)}</h1>${img ? `<img src="${src}" alt="${esc(t.ref)}" style="max-width:100%;margin-top:10px;border:1px solid var(--border);border-radius:8px">` : `<div class="attph">${esc(ext)} 첨부 — 원본 그대로 둔다</div>`}</div></div>`,
    aside: right ? null : `<div class="ap"><h4>속성</h4><div class="kv"><span>종류</span><span>${esc(ext)}</span><span>자리</span><span>첨부</span></div></div>`,
    title: t.ref,
  }
}

// ── 빨리 열기(Ctrl O) ──
function openQo() { S.pal = null; S.cmd = null; S.menu = null; S.qo = { q: '', sel: 0 }; render() }
function qoList() {
  const q = (S.qo.q || '').trim(), nq = norm(q)
  const ks = S.route.kn && S.route.kn !== '*' ? [S.route.kn] : S.kns.map((x) => x.id), out = []
  ks.forEach((k) => {
    const tr = treeOf(k)
    if (!tr || tr.error) return
    const kn = KN(k).name
    tr.docs.forEach((d) => out.push({ kind: 'doc', label: d.title, sub: kn + ' · 문서', k, ref: d.id }))
    tr.records.forEach((r) => out.push({ kind: 'rec', label: r.title, sub: kn + ' · 기록 · ' + (r.state === 'pend' ? '● 아직 안 넣음' : whenTxt(r.date)), k, ref: r.id }))
  })
  if (!q) return out.filter((x) => x.kind !== 'rec').slice(0, 12)
  const ord = { doc: 0, item: 1, rec: 2 }
  const sc = (x) => { const l = norm(x.label); if (l === nq) return 0; if (l.startsWith(nq)) return 1; if (l.includes(nq)) return 2; return 9 }
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
function openCmd() { S.pal = null; S.qo = null; S.menu = null; S.cmd = { q: '', sel: 0 }; render() }
function cmdDefs() {
  return [
    { n: '자료 가져오기', s: '코드 · DB · 파일', f: () => go({ scr: 'import' }) },
    { n: '지식 추가', s: '새 이름 · 폴더 · 팀 주소', f: () => go({ scr: 'add' }) },
    { n: '나누어 보기', s: 'Ctrl \\ — 두 탭을 나란히', f: () => toggleSplit() },
    { n: '그래프 열기', s: '리본 — 그래프', f: () => setView('graph') },
    { n: '문서로 보기', s: '리본 — 문서', f: () => setView('docs') },
    { n: '항목으로 보기', s: '리본 — 항목', f: () => setView('items') },
    { n: '빨리 열기', s: 'Ctrl O', f: () => openQo() },
    { n: '찾기', s: 'Ctrl K', f: () => openPal() },
    { n: '오늘 바뀐 것', s: '', f: () => go({ scr: 'today' }) },
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
function openPal(q) { S.qo = null; S.cmd = null; S.menu = null; S.pal = { q: q || '', res: null }; render(); if (q) runFind() }
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
function palBody() {
  const r = S.pal.res
  if (!S.pal.q.trim() || !r) return '<div class="tip">문서의 항목 이름이나 낱말을 친다 — 예: 헬스 체크 · 상태 점검</div>'
  if (r.error) return `<div class="empty"><b>${esc(r.error)}</b></div>`
  if (!r.hits.length) return '<div class="empty" data-t="none"><b>이 말로는 못 찾았다 — 없다는 뜻은 아니다</b>다른 이름이나 문서 목록으로<br><a data-a="palDocs">문서 목록 ›</a><a data-a="palClear">다른 말로 다시 ›</a></div>'
  const hit = (x, i) => `<div class="hit${i === 0 ? ' sel' : ''}" data-a="openHit" data-k="${esc(x.k)}" data-d="${esc(x.d)}" data-h="${esc(x.h)}" data-t="hit"><div class="ht"><b>${esc(x.title)} › ${esc(x.h)}</b><span class="r">${esc(x.kn)}</span></div><div class="tx">${snip(x.text, r.toks)}</div></div>`
  if (r.exact) return `<div class="g" data-t="gExact">문서의 항목</div>${r.hits.filter((x) => x.v >= 100).map(hit).join('')}`
  return `<div class="g" data-t="gSim">딱 맞는 항목이 없어 비슷한 글에서 찾았다</div>${r.hits.map(hit).join('')}<div class="ft" data-t="simCount">비슷한 글 ${r.hits.length}개</div>`
}

// ───────────── 들어오기 전 — 들어가기 · 처음 들어오기 링크 · 첫 설정 ─────────────
// 서버는 비밀번호를 받지 않는다 — 여기서 전처리(prehash)한 값을 보낸다.
function gateView() {
  if (S.gate === 'first' || S.gate === 'done') return { crumb: '처음', main: viewFirst() }
  if (S.gate === 'setup') return { crumb: '처음', main: viewSetup() }
  return { crumb: '들어가기', main: viewLogin() }
}
const gateErr = () => (S.gateErr ? `<div class="callout danger" data-t="loginErr">${esc(S.gateErr)}</div>` : '')
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
  if (!who) return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb"><div class="big">처음 들어오기</div><div class="callout gray" data-t="firstGone">이 링크는 이제 쓸 수 없다 — 관리자에게 새 링크를 부탁한다</div><div class="links"><a data-a="gateLogin">들어가기 ›</a></div></div></div></div></div>`
  return `<div class="gatewrap"><div class="gate"><div class="card"><div class="cb">
  <div class="mk">${svg('lock')}</div><div class="big">${esc(who)}의 비밀번호를 정한다</div><p class="lead">처음 들어오기 링크 — 관리자가 보냈다</p>
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
  const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.message || '서버에 닿지 않는다'), { code: j.error })
  return j
}
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
    copyText(r.line)
    S.lastInstall = r.line
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
  }
}
document.addEventListener('submit', (ev) => {
  const f = ev.target.dataset && ev.target.dataset.f
  if (!f) return
  ev.preventDefault()
  submitGate(f)
})

// ───────────── 이벤트 ─────────────
function openDocAt(k, d, h, q) {
  openTab({ kind: 'doc', kn: k, ref: d, hl: h || null, q: q || null })
  if (h) S._lit = true
  render()
  if (!h) scrollTopMain()
}
const ACT = {
  legacyOpen: () => { S.legacyOpen = true; S.gateErr = null; render() },
  legacyClose: () => { S.legacyOpen = false; S.gateErr = null; render() },
  copyInstall: () => copyInstall(),
  gateHome: () => { S.gate = null; history.replaceState(null, '', '/'); go({ scr: 'home', kn: '*' }) },
  gateLogin: () => { S.gate = null; history.replaceState(null, '', '/'); render() },
  view: (el) => setView(el.dataset.v),
  nav: (el) => go({ scr: el.dataset.s }),
  kmenu: () => { S.menu = S.menu === 'kmenu' ? null : 'kmenu'; render() },
  pickKn: (el, ev) => { ev.stopPropagation(); S.menu = null; const k = el.dataset.k; if (k === '*') go({ scr: 'home', kn: '*' }); else go({ scr: KNSCR.includes(S.route.scr) ? S.route.scr : 'docs', kn: k }) },
  openKn: (el) => go({ scr: 'docs', kn: el.dataset.k }),
  histGo: (el) => histGo(Number(el.dataset.v)),
  openQo: () => openQo(),
  openSearch: () => openPal(),
  fold: (el) => { const key = S.route.kn + ':' + el.dataset.f; S.fold[key] = !S.fold[key]; render() },
  allDocs: () => { S.all = true; render() },
  openDoc: (el) => openDocAt(el.dataset.k, el.dataset.d, el.dataset.h),
  openRec: (el) => { openTab({ kind: 'rec', kn: el.dataset.k, ref: el.dataset.r }); render(); scrollTopMain() },
  openAtt: (el) => { openTab({ kind: 'att', kn: el.dataset.k, ref: el.dataset.v }); render() },
  actTab: (el, ev) => { if (ev.target.closest('.x')) return; const t = tabOf(el.dataset.id); if (!t) return; S.active = t.id; if (S.split === t.id) S.split = null; S.route.kn = t.kn; if (!['docs', 'items'].includes(S.route.scr)) S.route.scr = 'docs'; pushHist(); render() },
  closeTab: (el, ev) => { ev.stopPropagation(); closeTab(el.dataset.id); render() },
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
  openHit: (el) => { const q = S.pal && S.pal.q; S.pal = null; openDocAt(el.dataset.k, el.dataset.d, el.dataset.h, q) },
  reopenSearch: () => { const t = activeTab(); openPal(t && t.q) },
}
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]')
  if (!el) { if (S.menu && !ev.target.closest('.menu')) { S.menu = null; render() } return }
  if (el.dataset.self && ev.target !== el) return
  const f = ACT[el.dataset.a]
  if (!f) return
  if (el.tagName === 'A') ev.preventDefault()
  if (S.menu && !['menu', 'kmenu', 'pickKn'].includes(el.dataset.a) && !ev.target.closest('.menu')) S.menu = null
  f(el, ev)
})
document.addEventListener('input', (ev) => {
  const t = ev.target, k = t.dataset && t.dataset.in
  if (!k) return
  // 칸은 다시 그리지 않는다(한글 입력이 끊기지 않게) — 결과 자리만 바꾼다
  if (k === 'pal') { S.pal.q = t.value; runFind() }
  if (k === 'qo') { S.qo.q = t.value; S.qo.sel = 0; $('#qoBody').innerHTML = qoBody() }
  if (k === 'cmd') { S.cmd.q = t.value; S.cmd.sel = 0; $('#cmdBody').innerHTML = cmdBody() }
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
  if (S.qo && ev.target.id === 'qoIn' && listKeys(ev, S.qo, 'qoBody', qoBody, qoPick)) return
  if (S.cmd && ev.target.id === 'cmdIn' && listKeys(ev, S.cmd, 'cmdBody', cmdBody, cmdPick)) return
  if (ctrl && !ev.altKey) {
    if (low === 'k' || code === 'KeyK') { ev.preventDefault(); openPal(); return }
    if (low === 'o' || low === 't' || code === 'KeyO' || code === 'KeyT') { ev.preventDefault(); openQo(); return }
    if (low === 'p' || code === 'KeyP') { ev.preventDefault(); openCmd(); return }
    if (ev.key === '\\' || code === 'Backslash') { ev.preventDefault(); toggleSplit(); return }
  }
  if (ev.altKey && !ctrl && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !/^(TEXTAREA|INPUT)$/.test(ev.target.tagName)) { ev.preventDefault(); histGo(ev.key === 'ArrowLeft' ? -1 : 1); return }
  if (ev.key === 'Escape') { if (S.qo) S.qo = null; else if (S.cmd) S.cmd = null; else if (S.pal) S.pal = null; else if (S.menu) S.menu = null; else return; render() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'palIn') { const h = $('#app .hit'); if (h) h.click() }
})

// 아래 줄 시계 — 분마다
setInterval(() => { const c = $('[data-t=clock]'); if (c && S.me) c.textContent = `kmd v${S.me.version} · ${clock()}` }, 30000)

// 들어온 사람의 자료 — 목록 · 멈춤 줄
let stopTimer = null
async function loadAll() {
  S.me = await getJSON('/api/me')
  if (S.me.anon) { render(); return }
  S.kns = await getJSON('/api/knowledge')
  S.cache = {}
  loadStops()
  clearInterval(stopTimer)
  stopTimer = setInterval(loadStops, 60000)
  document.title = isTeam() ? 'kmd — 팀' : 'kmd'
  if (!S.hist.length) pushHist()
  render()
}

// ───────────── 시작 ─────────────
async function boot() {
  try {
    const code = (location.hash.match(/(?:^#|&)code=([^&]+)/) || [])[1]
    const once = (location.hash.match(/(?:^#|&)once=([^&]+)/) || [])[1]
    if (once) {
      await postJSON('/once', { code: once }).catch(() => {})
      history.replaceState(null, '', '/')
    }
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
