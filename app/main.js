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
  srcDraft: '', srcRun: {}, imports: [], addDraft: '', addMsg: null, cand: null, sending: false,
  openToday: null, tidyRun: null, tidyMsg: {}, runOpen: {}, cmp: null, picker: false,
  iq: '', ifilt: { pend: false, recent: false, mine: false }, kfold: {}, tablesAll: false, nbOpen: false,
  g: { kn: null, pos: {}, view: { x: 0, y: 0, k: 1 }, sel: null, bundle: false, layoutKey: '', f: { q: '', item: true, doc: true, rec: false, src: false, pend: false, recent: false, orph: false, depth: 0 } },
}
const KNSCR = ['docs', 'items', 'graph', 'tidy', 'members']
const KN = (k) => S.kns.find((x) => x.id === k) || null
const isTeam = () => S.me && S.me.mode === 'team'
// 들어오기 전 — 들어가기 · 처음 들어오기 링크 · 첫 설정 화면
const anon = () => !!S.me && (!!S.me.anon || !!S.gate)
const knType = () => (isTeam() ? 'team' : 'pc')

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
  const r = await fetch(t.url, { headers: { accept: 'application/json', ...t.headers } })
  if (t.headers.authorization && r.status === 401) { S.pc.token = null; try { sessionStorage.removeItem('kmdPair') } catch {} }
  if (t.headers.authorization && !r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.message || '내 PC 프로그램에 닿지 않는다'), { code: j.error }) }
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
  const scr = anon() ? gateView() : S.pairPage ? viewPair() : viewOf(S.route.scr)
  const center = scr.tabs
    ? `<div class="center">${tabbarHtml()}<div class="panes"><div class="main${scr.full ? ' full' : ''}" data-t="main">${scr.main}</div>${scr.right != null ? `<div class="main rp" data-t="rightPane">${scr.right}</div>` : ''}</div></div>`
    : `<div class="main" data-t="main">${scr.main}</div>`
  app.innerHTML = ribbonHtml() + sideHtml(scr.left) + `<div class="col">${hdrHtml(scr.crumb)}${anon() ? '' : bandHtml()}<div class="body">${center}${scr.aside ? `<div class="aside" data-t="aside">${scr.aside}</div>` : ''}</div>${statusHtml()}</div>${S.pal ? palHtml() : ''}${S.qo ? qoHtml() : ''}${S.cmd ? cmdHtml() : ''}`
  if (anon()) { const g = $('[data-focus]'); if (g && document.activeElement !== g) g.focus(); return }
  const fi = $('#palIn') || $('#qoIn') || $('#cmdIn')
  if (fi && document.activeElement !== fi) { fi.focus(); fi.setSelectionRange(fi.value.length, fi.value.length) }
  if (S._focus) { const el = document.getElementById(S._focus); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length) } catch {} } S._focus = null }
  if (S.route.scr === 'graph') gHighlight()
  // 내 PC 지식의 주소는 해시 조각으로만 — 팀 서버 요청 · Referer 에 실리지 않는다
  const at = activeTab()
  const want = at && String(at.kn).startsWith('~') && ['docs', 'items'].includes(S.route.scr) ? '#' + encodeURIComponent(at.kn).replace('%7E', '~') + '/' + encodeURIComponent(at.ref) : ''
  if (want !== location.hash && (want || location.hash.startsWith('#~'))) history.replaceState(null, '', location.pathname + (want || ''))
  if (S._lit) {
    const el = $('#app .main[data-t=main] .lit')
    if (el) { S._lit = false; setTimeout(() => el.scrollIntoView({ block: 'center' }), 30) }
  }
}
function viewOf(s) {
  if (!isTeam() && (s === 'tidy' || s === 'members' || s === 'admin')) s = 'home' // 팀의 일 — 이 PC 에는 없다
  const f = { home: viewHome, docs: viewDocsV, items: viewItems, graph: viewGraph, today: viewToday, tidy: viewTidy, members: viewMembers, import: viewImport, add: viewAdd, send: viewSend, settings: viewSettings, admin: viewAdmin }[s]
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
  // 정리하는 사람 — 팀에서 주인 · 정리하는 지식이 하나라도 있거나 관리자. 이 PC 는 없다(목업 kimPc — 정리는 저절로 · 켬/끔은 설정 · 결과는 오늘 바뀐 것)
  const curator = !dim && team && (S.kns.some((x) => x.role && x.role !== '기록') || S.me.admin)
  const tk = curator && KN(tidyKn())
  const it2 = (key, l, ic, bd) => `<div class="sb-i${!dim && r.scr === key ? ' on' : ''}" data-a="nav" data-s="${key}" data-t="nav-${key}">${svg(ic)}<span>${l}</span>${bd ? `<span class="bd">${bd}</span>` : ''}</div>`
  h += '<div class="nav">' + it('today', '오늘 바뀐 것', 'check') + it('import', '자료 가져오기', 'plug')
  // 보내기 — 이 PC 이거나 보낼 곳이 있는 지식이 있을 때
  if (!dim && (!team || S.kns.some((x) => x.dests))) h += it2('send', '보내기', 'pair', S.kns.some((x) => x.sendWait) ? '…' : S.kns.reduce((a, x) => a + (x.sendN || 0), 0) || '')
  if (curator) h += '<div class="sb-g">정리하는 사람</div>' + it2('tidy', '정리', 'hour', tk && tk.pend ? tk.pend : '') + it2('members', '이 지식의 사람', 'users')
  h += '</div>'
  if (left) h += `<div class="lp" data-t="leftPane">${left}</div>`
  h += '<div class="sb-foot"><div class="nav">' + (!dim && S.me.admin && team ? it('admin', '관리', 'shield') : '') + '<div class="sb-i deco">' + svg('book') + '<span>설명서</span></div></div>'
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
  // 팀 화면의 「내 PC」 줄 — 내 PC 프로그램이 꺼져 있으면 지난번 이름만 흐리게(이 탭 안의 것 · 서버로 가지 않는다)
  const offPc = team && S.pc && S.pc.off ? pcRemembered().map((x) => ({ ...x, pc: true, dim: true })) : []
  const rows = [...S.kns, ...offPc].map((n) => {
    const tag = n.pc ? '<span class="kt me">내 PC</span>' : team ? (n.private ? '<span class="kt me">개인</span>' : '<span class="kt team">팀</span>') : ''
    const rr = team && !n.pc && n.role && n.role !== '기록' ? `<span class="dst">나: 정리</span>${n.pend ? `<span class="chip c-pend">받은 것 ${n.pend}</span>` : ''}` : n.sendN ? `<span class="chip c-pend">보낼 것 ${n.sendN}</span><span class="dst">→ ${esc((n.dests || []).join(' · '))}</span>` : ''
    return `<div class="krow${n.dim ? ' dim' : ''}" data-a="openKn" data-k="${esc(n.id)}" data-t="krow" data-name="${esc(n.name)}"><span class="nm">${esc(n.name)} ${tag}</span><span class="meta">${esc(n.dim ? '내 PC 프로그램이 켜지면 열린다' : n.pc ? '문서 ' + n.docs + ' · 내 PC 프로그램이 연다' : knMeta(n))}</span><span class="rr">${rr}</span></div>`
  }).join('')
  const pcLine = !team || !S.pc ? '' : S.pc.off && (S.pc.seen || offPc.length) ? '<div class="callout gray stop" data-t="pcOff"><i></i><span><b>내 PC 프로그램이 꺼져 있다</b> — 켜면 저절로 다시 열린다</span></div>' : S.pc.allow ? `<div class="callout gray stop" data-t="pcAllow"><i></i><span><b>이 PC 의 내 지식을 여기서도 연다</b> — 내 PC 프로그램 창에서 한 번 허락한다</span><a class="lk r" data-a="pcAllow" data-t="pcAllowBtn">허락</a></div>` : ''
  const none = team ? '<div class="cb"><div class="empty2"><b>아직 지식이 없다</b>폴더 안에 md 폴더를 두면 지식이 된다</div></div>' : '<div class="cb"><div class="empty2" data-t="pcEmpty"><b>아직 내 지식이 없다</b><a data-a="nav" data-s="add">내 지식 세우기 ›</a></div></div>'
  return {
    crumb: '지식 목록',
    main: `<div style="max-width:960px"><div class="top"><div><div class="big">지식 목록</div>${team ? '' : '<p class="lead">내 지식 ' + S.kns.length + '</p>'}</div><div class="acts"></div></div>
  ${S.stops.map(stopHtml).join('')}${pcLine}
  <div class="card" data-t="klist">${rows || none}</div>
  <p class="tl"><a data-a="nav" data-s="add">+ 지식 추가</a><a data-a="nav" data-s="import">+ 자료 가져오기</a></p></div>`,
  }
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
  <div class="card"><div class="ch">최근 바뀐 문서 <small>문서 ${ds.length}</small></div><div class="cb" style="padding:2px 14px 4px"><ul class="plain dl">${tr ? ds.slice(0, 5).map((d) => `<li data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="recentDoc" data-pv="doc|${esc(k)}|${esc(d.id)}">${svg('doc', 'di')}<span class="nm">${esc(d.title)}</span><span class="when${isToday(d.when) ? ' td' : ''}">${esc(whenTxt(d.when))}</span></li>`).join('') : `<li>${loadingHtml}</li>`}</ul></div></div></div>`
}
function treeHtml(k) {
  const n = KN(k), tr = treeOf(k)
  if (!tr) return `<div class="tree" data-t="tree"><div class="lh">${esc(n.name)}</div>${loadingHtml}</div>`
  if (tr.error) return `<div class="tree" data-t="tree"><div class="lh">${esc(n.name)}</div>${errHtml(tr)}</div>`
  const ds = tr.docs, fk = (f) => !!S.fold[k + ':' + f]
  const all = S.all, list = all ? ds : ds.slice(0, 11)
  const head = (f, l, cnt, extra) => `<div class="tf" data-a="fold" data-f="${f}" data-t="fold-${f}"><span class="ar">${fk(f) ? '▸' : '▾'}</span>${l}${extra || ''}<span class="cnt">${cnt}</span></div>`
  let h = `<div class="tree" data-t="tree"><div class="lh">${esc(n.name)}</div>` + head('docs', '문서', ds.length)
  if (!fk('docs')) h += list.map((d) => `<div class="tn${isAct('doc', k, d.id) ? ' on' : ''}" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(d.id)}" data-t="doc" data-name="${esc(d.title)}" data-pv="doc|${esc(k)}|${esc(d.id)}">${svg('doc')}<span class="nm">${esc(d.title)}</span>${d.pend ? '<i class="pd" title="아직 문서에 안 넣은 기록이 있다"></i>' : ''}</div>`).join('') + (!all && ds.length > 11 ? `<div class="tn more" data-a="allDocs" data-t="moreDocs">${ds.length - 11}개 더</div>` : '')
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
  return `<div class="ap" data-t="outline"><h4>개요</h4>${ol}</div>
  <div class="ap" data-t="backlinks"><h4>이 문서를 가리키는 것</h4>
   <div class="bg">기록 <b data-t="blRecN">${bl.recs.length}</b> <small>이 문서의 항목을 건드린 것</small></div>${recs || none}
   <div class="bg">문서 <b data-t="blDocN">${bl.linkers.length}</b> <small>이 문서를 링크한 것</small></div>${docs || none}
   <div class="bg">이름만 나온 곳 <b data-t="blMentN">${bl.ments.length}</b> <small>링크 없이 이름만</small></div>${ments || none}</div>
  <div class="ap" data-t="props"><h4>속성</h4><div class="kv"><span>마지막 정리</span><span>${esc(d.last ? whenTxt(d.last.date) + ' — ' + d.last.author + '의 기록에서' : whenTxt(d.when))}</span><span>가져오는 곳</span><span>없음</span><span>자리</span><span>${isTeam() ? '팀' : '내 PC'}</span><span>항목</span><span>${d.items}</span></div></div>
  ${nbGraph(k, 'd:' + d.id)}`
}
function docPane(t, right) {
  const k = t.kn, n = KN(k), d = docOf(k, t.ref)
  if (!d) return { html: loadingHtml, title: tabTitle(t) }
  if (d.error) return { html: '<p class="muted">이 문서는 이제 없다 — 탭을 닫는다</p>', title: t.ref }
  const hl = right ? null : t.hl, q = right ? null : t.q
  const loc = isTeam() ? n.name + ' › ' + d.title : n.name + ' › ' + d.path.replace(/^docs\//, '')
  const mine = d.sections.flatMap((s) => s.pend.filter((x) => x.author === S.me.user))
  const editing = !right && S.edit && S.edit.tab === t.id
  const body = editing
    ? `<div class="ed" data-t="editor"><div class="lbl"><b>고치는 중</b> · 「## 」 으로 시작하는 줄이 항목 이름이다</div><div class="toolbar"><span>제목</span><span>굵게</span><span>목록</span><span>표</span><span>링크</span></div><textarea id="edTx" data-t="edTx" spellcheck="false">${esc(d.sections.map((s) => '## ' + s.h + '\n' + s.md).join('\n\n'))}</textarea>
   ${d.sections.filter((s) => s.locks).map((s) => `<div class="lockh">항목 「${esc(s.h)}」 의 표 — 회색은 잠겨 있다</div>${s.locks}`).join('')}
   <div class="row" style="margin-top:10px"><button class="btn pri" data-a="saveDoc" data-t="saveBtn">저장</button><a class="muted" data-a="cancelEdit">그만두기</a><span class="r small muted">${d.direct ? '저장하면 바로 문서에 들어간다' : '팀 지식 — 저장하면 기록으로 남고 정리 때 문서에 들어간다'}</span></div></div>`
    : d.sections.map((s) => {
    const lit = hl && s.h === hl
    const it = M(k) && M(k).items.find((x) => x.doc === d.id && x.sec === s.h)
    const hn = it ? `<span class="hn" data-a="openItem" data-k="${esc(k)}" data-n="${esc(it.key)}" data-t="hn" title="항목으로 보기">${s.pend.length ? '<i class="pd"></i>' : ''}기록 ${s.recs}</span>` : ''
    const by = s.by && isToday(s.by.date) ? `<div class="hc"><span class="hchip">${esc(whenTxt(s.by.date))} 넣음 — ${esc(s.by.author)}의 기록에서</span></div>` : ''
    const pens = s.pend.map((x) => `<div class="penrec" data-t="penrec"><i></i><span><b>아직 문서에 안 넣은 기록 1</b> · ${esc(whenTxt(x.date))} · ${esc(x.author === S.me.user ? '나' : x.author)} — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}">「${esc(x.title)}」</a> · 같이 읽힌다</span></div>`).join('')
    const inner = linkify(s.html, k, it ? it.key : null)
    return `<h2 data-sec="${esc(s.h)}">${esc(s.h)}${hn}</h2>${lit ? `<div class="lit" data-t="lit"><span class="tag">찾은 곳</span>${inner}</div>` : inner}${by}${pens}`
  }).join('')
  const main = `<div class="docw" data-t="docPane" data-name="${esc(d.title)}">${right ? rpHead() : ''}
  ${q ? `<div class="found" data-t="found"><span>찾기 <b>‘${esc(q)}’</b> 로 열었다</span><a data-a="reopenSearch">찾은 것으로 돌아가기</a></div>` : ''}
  <div class="ttl"><div class="path"><span>${esc(loc)}</span><span class="r">마지막으로 바뀐 때 ${esc(whenTxt(d.when))}</span></div>${editing || right ? '' : '<button class="btn pri" data-a="editDoc" data-t="editBtn">고치기</button>'}</div>
  ${mine.length && !editing ? `<div class="wait" data-t="wait"><i></i>${esc(whenTxt(mine[0].date))} 에 쓴 기록 ${mine.length} — 정리 때 문서에 들어간다 · 그동안도 문서 옆에 같이 읽힌다</div>` : ''}
  <div class="paper"><h1>${esc(d.title)}</h1>${d.intro ? d.intro.replace(/<p>/g, '<p class="muted small">') : ''}${body}
  ${d.links.length && !editing ? `<div class="dlinks" data-t="dlinks">이 문서가 가리키는 문서 — ${d.links.map((x) => `<span class="dlink" data-a="openDoc" data-k="${esc(k)}" data-d="${esc(x.id)}" data-t="dlink">${esc(x.title)}</span>`).join(' · ')}</div>` : ''}</div></div>`
  return { html: main, aside: right ? null : docAside(k, d), title: d.title }
}
function recPane(t, right) {
  const k = t.kn, r = recOf(k, t.ref)
  if (!r) return { html: loadingHtml, title: tabTitle(t) }
  if (r.error) return { html: '<p class="muted">이 기록은 이제 없다 — 정리되어 다른 이름으로 남았을 수 있다</p>', title: '기록' }
  const fx = r.fixes[0], fb = r.fixedBy, who = (w) => (w === S.me.user ? '나' : w)
  const html = `<div class="docw" data-t="recPane" data-name="${esc(r.title)}">${right ? rpHead() : ''}<div class="ttl"><div class="path"><span>${esc(KN(k).name)} › 기록 › ${esc(r.date)}</span><span class="r">${r.state === 'pend' ? '<span class="chip c-pend" data-t="recState">아직 문서에 안 넣은 기록</span>' : r.state === 'in' ? '<span class="chip c-mute" data-t="recState">문서에 들어감</span>' : ''}</span></div></div>
  <div class="paper"><h1>${esc(r.title)}</h1><p class="muted small">${esc(r.author)} · ${esc(r.date)}</p>${linkify(r.html, k, null)}
  ${fx ? `<div class="callout warn">이 기록은 ${esc(whenTxt(fx.date))} ${esc(who(fx.author))}의 기록을 바로잡았다 — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(fx.id)}">${esc(fx.title)}</a></div>` : ''}${fb.map((x) => `<div class="callout gray">${esc(whenTxt(x.date))} ${esc(who(x.author))}이 이 기록을 바로잡았다 — <a data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}">${esc(x.title)}</a></div>`).join('')}
  ${r.state === 'pend' ? '<div class="callout pend">정리 때 문서에 들어간다 — 그동안도 그 항목 옆에 같이 읽힌다</div>' : ''}</div></div>`
  const aside = `<div class="ap" data-t="recItems"><h4>이 기록이 건드린 항목 <small>${r.items.length}</small></h4>${r.items.map((i) => `<div class="alr" data-a="openItem" data-k="${esc(k)}" data-n="${esc(i.coord)}" data-t="recItem" data-pv="item|${esc(k)}|${esc(i.coord)}">${svg('tag')}<span class="nm">${esc(i.name)}<small>${esc(i.docTitle ? i.docTitle : '문서가 없는 항목')}</small></span></div>`).join('') || '<div class="muted small alr">없다</div>'}</div>
  <div class="ap" data-t="recFix"><h4>바로잡은 / 바로잡힌 기록</h4>${fx ? `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(fx.id)}" data-t="fixRow"><span class="dt">${esc(whenTxt(fx.date).replace(/^(오늘|어제) /, ''))}</span><span class="nm">바로잡음 — ${esc(fx.title)}</span></div>` : ''}${fb.map((x) => `<div class="alr" data-a="openRec" data-k="${esc(k)}" data-r="${esc(x.id)}" data-t="fixRow"><span class="dt">${esc(whenTxt(x.date).replace(/^(오늘|어제) /, ''))}</span><span class="nm">바로잡힘 — ${esc(x.title)}</span></div>`).join('')}${fx || fb.length ? '' : '<div class="muted small alr">없다</div>'}</div>
  ${nbGraph(k, 'r:' + r.id)}`
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
  const hit = (x, i) => {
    const tags = (x.alias && x.exact ? '<span class="tg nm">다른 이름</span>' : '') + (x.r ? '<span class="tg">기록</span>' : '')
    const at = x.r ? `data-r="${esc(x.r)}"` : `data-d="${esc(x.d)}" data-h="${esc(x.h)}"${x.coord ? ` data-c="${esc(x.coord)}"` : ''}`
    return `<div class="hit${i === 0 ? ' sel' : ''}" data-a="openHit" data-k="${esc(x.k)}" ${at} data-t="hit"><div class="ht"><b>${esc(x.title)}${x.h ? ' › ' + esc(x.h) : ''}</b>${tags}<span class="r">${esc(x.kn)}</span></div><div class="tx">${snip(x.text, r.toks)}</div></div>`
  }
  if (r.exact) return `<div class="g" data-t="gExact">문서의 항목</div>${r.hits.map(hit).join('')}`
  const N = r.hits.length, more = S.pal.more, sh = more ? r.hits : r.hits.slice(0, 5)
  return `<div class="g" data-t="gSim">딱 맞는 항목이 없어 비슷한 글에서 찾았다</div>${sh.map(hit).join('')}<div class="ft" data-t="simCount">비슷한 글 ${N}개${N > 5 ? (more ? ' — 모두 보인다' : ` — 5개 · <a data-a="palMore" data-t="palMore">${N - 5}개 더 보기</a>`) : ''}</div>`
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
  if (!M(k)) return `<div class="ilist" data-t="itemList"><div class="lh">${esc(KN(k).name)} — 항목</div>${loadingHtml}</div>`
  return `<div class="ilist" data-t="itemList"><div class="lh">${esc(KN(k).name)} — 항목</div><input class="inp" id="itemQ" data-in="itemQ" data-t="itemQ" value="${esc(S.iq)}" placeholder="항목 찾기 — 이름 · 다른 이름" autocomplete="off"><div class="fcs">${IFL.map(([v, l]) => `<span class="fc${S.ifilt[v] ? ' on' : ''}" data-a="itemFilt" data-v="${v}" data-t="if-${v}">${l}</span>`).join('')}</div><div id="itemListBody">${itemListBody(k)}</div></div>`
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
  if (!M(k)) return { crumb: '그래프', main: loadingHtml, tabs: true, left: `<div class="gf"><div class="lh">${esc(KN(k).name)} — 그래프</div>${loadingHtml}</div>` }
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
  return `<div class="gf" data-t="gFilter"><div class="lh">${esc(KN(k).name)} — 그래프</div>
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
async function saveDoc() {
  const e = S.edit
  if (!e) return
  const d = S.cache[`doc:${e.kn}:${e.doc}`]
  const txt = $('#edTx').value
  const parts = []
  let cur = null
  txt.split('\n').forEach((line) => {
    const m = line.match(/^##\s+(.+)$/)
    if (m) { cur = { h: m[1].trim(), b: [] }; parts.push(cur) } else { if (!cur) { cur = { h: '머리말', b: [] }; parts.push(cur) } cur.b.push(line) }
  })
  const old = new Map(d.sections.map((s) => [s.h, s]))
  const changed = parts.map((p) => ({ h: p.h, body: p.b.join('\n').replace(/^\n+|\n+$/g, '') })).filter((p) => !old.has(p.h) || old.get(p.h).md.replace(/\s+$/, '') !== p.body.replace(/\s+$/, ''))
  if (!changed.length) { S.edit = null; toast('바뀐 글이 없다 — 그대로 두었다'); render(); return }
  try {
    const r = await postJSON(`/api/k/${encodeURIComponent(e.kn)}/edit`, { doc: e.doc, sections: changed.map((p) => ({ h: p.h, body: p.body, ...(old.has(p.h) ? { base: old.get(p.h).base } : {}) })) })
    S.edit = null
    forgetKn(e.kn)
    toast(r.direct ? '저장했다 — 문서에도 넣었다' : '기록했다 — 정리 때 문서에 들어간다 · 그동안도 문서 옆에 같이 읽힌다', 7000)
    render()
  } catch (err) {
    toast(esc(err.message), 7000)
  }
}

// ───────────── 오늘 바뀐 것(목업 M9) ─────────────
const todayOf = () => need('today', '/api/today')
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
function viewToday() {
  const all = todayOf()
  if (!all) return { crumb: '오늘 바뀐 것', main: loadingHtml }
  const items = (all.error ? [] : all).filter((x) => Date.now() - Date.parse(x.at) < 36 * 3600_000)
  const li = (x) => {
    const open = S.openToday === x.id
    const team = isTeam() && KN(x.kn)
    const tag = team ? '<span class="kt team">팀</span>' : `<span class="kt me">${isTeam() ? '개인' : '내 지식'}</span>`
    let ex = ''
    if (open) {
      ex += '<div class="open" data-t="todayOpen">'
      if (x.revert) ex += `<div class="small muted">비교</div>${diffHtml(diffOf(x.kn, x.revert))}`
      if (x.revert && !x.reverted) ex += `<button class="btn sm" data-a="revertToday" data-id="${esc(x.id)}" data-t="revertBtn">되돌리기</button> <span class="small muted">그 줄만 넣기 전으로</span>`
      if (x.revert && x.reverted) ex += '<span class="chip c-mute">되돌렸다</span>'
      if (x.device) ex += x.unlinked ? '<span class="chip c-mute">끊었다</span>' : `<button class="btn sm" data-a="unlinkDev" data-id="${esc(x.id)}">끊기</button> <span class="small muted">내가 한 것이 아니면 — 그 기기의 Claude Code 는 다시 이어야 한다</span>`
      if (!x.revert && !x.device && x.small) ex += `<div class="small muted">${esc(x.small)}</div>`
      if (x.go) ex += ` <a class="small" data-a="todayGo" data-id="${esc(x.id)}" style="margin-left:8px">문서 열기 ›</a>`
      ex += '</div>'
    }
    const reverted = x.revert && x.reverted
    return `<div class="fi${x.yl ? ' yl' : ''}${reverted ? ' done' : ''}" data-t="fi" data-id="${esc(x.id)}"><div class="ln"><span class="tm">${tmOf(x.at)}</span><span class="dot ${x.yl ? 'warn' : x.dot || ''}"></span><div class="tx">${tag}${x.b ? '<b>' + esc(x.b) + '</b>' : esc(x.text)}${reverted ? ' <span class="chip c-mute" data-t="reverted">되돌렸다</span>' : ''}${x.small ? '<small>' + esc(x.small) + '</small>' : ''}</div><span class="act" data-a="toggleToday" data-id="${esc(x.id)}" data-t="viewBtn">${open ? '접기' : '보기'}</span></div>${ex}</div>`
  }
  const d = new Date()
  return {
    crumb: '오늘 바뀐 것',
    main: `<div style="max-width:760px;margin:0 auto"><div class="big">오늘 바뀐 것</div><p class="lead">kmd 가 알아서 한 일 · 다른 곳에서 바뀐 것. 마음에 들지 않으면 그 줄의 [보기] 에서.</p>
  ${S.stops.filter((s) => s.level === 'warn').map(stopHtml).join('')}
  <div class="feed" data-t="feed"><div class="fh">오늘<small>${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}(${'일월화수목금토'[d.getDay()]})</small></div>${items.map(li).join('') || '<div class="fi"><div class="ln muted">오늘은 바뀐 것이 없다</div></div>'}</div></div>`,
  }
}

// ───────────── 정리(목업 M12) ─────────────
const tidyOf = (k) => need('tidy:' + k, `/api/k/${encodeURIComponent(k)}/tidy`)
function tidyKn() { const k = S.route.kn; return k && k !== '*' && KN(k) ? k : (S.kns.find((x) => x.role !== '기록') || S.kns[0] || {}).id }
function recTitle(k, id) { const tr = treeOf(k); const r = tr && tr.records && tr.records.find((x) => x.id === id); return r || { title: id, author: '', date: '' } }
function rowHtml(k, row, key) {
  const kind = row.kind === 'left' ? 'keep' : row.kind === 'touches' ? 'put' : row.kind
  const yl = kind === 'changed' && !row.reverted, dim = kind === 'keep'
  const first = recTitle(k, (row.records || [])[0])
  const who = [...new Set((row.records || []).map((id) => recTitle(k, id).author).filter(Boolean))].join(' · ') || 'kmd'
  const title = row.kind === 'touches' ? `${first.title} — 이름을 골랐다` : first.title || row.target
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
  ${open ? grp('넣은 것', '숫자 · 이름 모두 확인 ✓', put) + grp('값이 바뀐 것', '쓴 사람에게 알렸다 — 오늘 바뀐 것 맨 위', chg) + grp('그대로 둔 것', '문서 옆에 같이 읽힌다 · 다음 정리 때 다시', keep) : ''}</div>`
}
function viewTidy() {
  const k = tidyKn()
  if (!k) return { crumb: '정리', main: viewHome().main }
  const n = KN(k), t = tidyOf(k), tr = treeOf(k)
  if (!t || !tr) return { crumb: '정리', main: loadingHtml }
  if (t.error) return { crumb: '정리', main: errHtml(t) }
  const run = S.tidyRun && S.tidyRun.kn === k ? S.tidyRun : null
  const inbox = tr.records.filter((r) => r.state === 'pend' || r.state === 'nowhere')
  const target = (r) => { const m = M(k); const it = m && m.items.find((i) => m.recsByItem.get(i.key)?.some((x) => x.id === r.id)); return it ? (it.doc ? `${(m.docById.get(it.doc) || {}).title || it.doc} › ${it.sec}` : it.name) : '넣을 곳을 찾는다' }
  const goBox = `<div class="go" data-t="goBox"><span class="tx"><b data-t="nextTidy">다음 정리 ${t.tidyAt > clock().slice(-5) ? '오늘' : '내일'} ${esc(t.tidyAt)} · 받은 것 ${inbox.length}</b><small>이 지식에 기록할 수 있는 사람 누구나 지금 정리할 수 있다 · 1~2분</small></span>${run ? `<span class="prog" data-t="prog"><i></i>정리하는 중 — 받은 것 ${inbox.length}…</span>` : `<button class="btn pri" data-a="tidyNow" data-k="${esc(k)}" data-t="tidyBtn"${inbox.length ? '' : ' disabled'}>지금 정리</button>`}</div>`
  const inboxCard = inbox.length ? `<div class="card" data-t="inbox"><div class="ch">받은 것 ${inbox.length} <small>정리 때 kmd 가 바로 문서에 넣는다</small></div><ul class="plain tl2">${inbox.map((r) => `<li><span class="k">${esc(r.author)}</span><span class="nm">${esc(r.title)}<small>${esc(recDt(r.date))}${r.state === 'nowhere' ? ' · 넣을 곳이 없는 메모' : ''}</small></span><span class="to">→ ${esc(target(r))}</span></li>`).join('')}</ul></div>` : ''
  const msg = S.tidyMsg[k]
  return {
    crumb: '정리',
    main: `<div style="max-width:800px"><div class="row" style="align-items:baseline"><span class="big">정리 — ${esc(n.name)}</span><span class="r muted small">매일 ${esc(t.tidyAt)} · 바꾸려면 <a data-a="nav" data-s="members">이 지식의 사람</a></span></div>
  <p class="lead">받은 기록은 kmd 가 정해진 시간에 바로 문서에 넣는다. 기다리기 싫으면 지금 정리.</p>
  ${S.stops.filter((s) => s.kind === 'worker').map(stopHtml).join('')}
  ${goBox}${msg ? `<div class="callout ${msg.cls}" data-t="tidyMsg">${esc(msg.t)}</div>` : ''}${inboxCard}${t.runs.map((r, i) => runHtml(k, r, i)).join('')}
  <details class="more"><summary>자세히</summary><div class="in">kmd 의 검사(값 · 이름 대조 · 크기 · 표지)를 못 넘은 글은 넣지 않고 그대로 둔다 — 문서 옆에 같이 읽히고 다음 정리 때 다시 해 본다. 이름 바꾸기 · 합치기 · 없애기는 넣지 않는다 — 제안 한 줄로만 선다.</div></details></div>`,
  }
}
async function tidyNow(k) {
  if (S.tidyRun) return
  try {
    const j = await postJSON(`/api/k/${encodeURIComponent(k)}/tidy`, {})
    S.tidyRun = { kn: k, job: j.id }
    S.tidyMsg[k] = null
    render()
    const poll = setInterval(async () => {
      const st = await getJSON('/api/job/' + j.id).catch(() => ({ state: 'gone' }))
      if (st.state === 'queued' || st.state === 'running') return
      clearInterval(poll)
      S.tidyRun = null
      forgetKn(k)
      delete S.cache['tidy:' + k]
      delete S.cache.today
      if (st.state === 'failed') S.tidyMsg[k] = { cls: 'warn', t: '정리하지 못했다 — 정리 전용 로그인이 쉬고 있다 · 받은 기록은 문서 옆에 같이 읽힌다' }
      else toast(`정리했다 — ${(st.summary?.put || 0) + (st.summary?.changed || 0)}건을 ${esc(KN(k).name)}에 넣었다`)
      S.kns = await getJSON('/api/knowledge').catch(() => S.kns)
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
  const k = tidyKn()
  if (!k) return { crumb: '이 지식의 사람', main: viewHome().main }
  const n = KN(k), row = ownerOf(k), t = tidyOf(k), tr = treeOf(k)
  if (!row || !t || !tr) return { crumb: '이 지식의 사람', main: loadingHtml }
  const owner = row.owner || null
  const own = (owner && owner === S.me.user) || S.me.admin
  const tidyAt = row.tidyAt || t.tidyAt
  const curators = (row.curators || []).filter((c) => c !== owner)
  const inboxN = tr.records.filter((r) => r.state === 'pend' || r.state === 'nowhere').length
  const tmenu = S.menu === 'tidyAt' ? `<div class="menu" style="right:0;top:28px" data-t="timeMenu"><div class="gray">정리 시각 — 매일</div>${TIMES.map((x) => `<div class="mi${x === tidyAt ? ' on' : ''}" data-a="setTidyAt" data-v="${x}" data-t="time-${x}">${x === tidyAt ? '✓ ' : ''}${x}</div>`).join('')}<div class="sep"></div><div class="mi" data-a="toggleNoClaude">Claude 에 보내지 않기 <span class="sw${row.noClaude ? ' on' : ''}" style="margin-left:auto"></span></div></div>` : ''
  const people = peopleOf() || []
  const picker = S.picker ? `<div class="pk" data-t="picker"><div class="muted" style="padding:2px 6px 6px">팀 kmd 사람 목록에서 한 사람</div>${(Array.isArray(people) ? people : []).map((r) => { const has = curators.includes(r) || r === owner; return `<div class="o${has ? ' off' : ''}" ${has ? '' : `data-a="addCur" data-v="${esc(r)}"`} data-t="pick-${esc(r)}"><span class="av2" style="width:20px;height:20px;font-size:10.5px">${esc(r.slice(0, 1))}</span>${esc(r)}${has ? ' — 이미 정리하는 사람' : ''}</div>` }).join('')}</div>` : ''
  return {
    crumb: '이 지식의 사람',
    main: `<div style="max-width:780px"><div class="big">이 지식의 사람 — ${esc(n.name)}</div><p class="lead">누가 정리하고 누가 기록을 남기는지, kmd 가 언제 정리하는지 주인이 정한다.</p>
  ${own ? '' : `<div class="callout gray">바꾸기는 주인(${esc(owner || '관리자')})이 한다 — 여기서는 읽기만</div>`}
  <div class="card" style="overflow:visible"><div class="ch">정리하는 사람 <small>문서를 고치고 제안을 본다</small></div>
   <ul class="plain pl" data-t="curList"><li><span class="av2">${esc((owner || '관').slice(0, 1))}</span><span class="nm">${esc(owner || '관리자')}<small>${owner ? '세운 사람' : '주인을 정하지 않았다 — 관리자가 정리한다'}${curators.length ? '' : ' · 지금은 혼자 정리한다'}</small></span><span class="kt role">주인</span></li>
   ${curators.map((c) => `<li data-t="curRow"><span class="av2">${esc(c.slice(0, 1))}</span><span class="nm">${esc(c)}<small>${esc(n.name)} 정리하는 사람</small></span><span class="kt role">정리</span>${own ? `<a class="lk q" data-a="rmCur" data-v="${esc(c)}">빼기</a>` : ''}</li>`).join('')}</ul>
   <div class="sub">kmd</div>
   <ul class="plain pl"><li><span class="av2 k">K</span><span class="nm" data-t="kmdRow">kmd — 정해진 시간과 [지금 정리] 로 바로 넣는다 · 매일 ${esc(tidyAt)}<small>다음 정리 ${esc(tidyAt)} — 받은 것 ${inboxN} · 값이 바뀌면 쓴 사람에게 알린다${row.noClaude ? ' · Claude 에 보내지 않음' : ''}</small></span><span class="kt role">자동 정리</span>${own ? `<button class="kebab${S.menu === 'tidyAt' ? ' on' : ''}" data-a="menu" data-m="tidyAt" data-t="tidyKebab" title="정리 시각 바꾸기">⋯${tmenu}</button>` : ''}</li></ul>
   <div class="sub">기록을 남기는 사람 <small>남긴 기록은 받은 것으로 온다</small></div>
   <ul class="plain pl"><li><span class="av2 all">팀</span><span class="nm">팀 모두<small>팀 kmd 에 들어오는 사람은 누구나 읽고 기록을 남긴다</small></span><span class="kt role">기록</span></li></ul>
   ${picker}
   <div class="cf">${own ? '<button class="btn pri" data-a="togglePicker" data-t="addCurBtn">정리하는 사람 더하기</button><span>팀 kmd 사람 목록에서 고른다</span>' : '<span>사람 목록에 없는 사람은 관리자에게</span>'}</div></div>
  <details class="more"><summary>이 설정은 지식 안에 적혀 백업과 같이 간다</summary><div class="in">정해진 시간의 정리는 팀 서버의 정리 전용 Claude 로그인으로 한다 — 로그인해 두는 것은 관리자.</div></details></div>`,
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
  const t = reqTo(p)
  const r = await fetch(t.url, { method: 'POST', headers: { 'content-type': 'application/json', ...t.headers }, body: JSON.stringify(body || {}) })
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
function srcKn(nm) {
  const s = String(nm || '').toLowerCase()
  const hit = S.kns.find((k) => s && (s.includes(k.id.toLowerCase()) || s.includes(String(k.name).toLowerCase())))
  if (hit) return { kn: hit.id, why: '이름이 맞아서' }
  const k = S.route.kn && S.route.kn !== '*' && KN(S.route.kn) ? S.route.kn : S.lastKn && KN(S.lastKn) ? S.lastKn : (S.kns[0] || {}).id
  return { kn: k, why: '가장 최근에 연 지식이라서' }
}
function parseSrc(t) {
  t = String(t || '').trim()
  if (!t) return null
  let m
  if ((m = t.match(/^(postgres(?:ql)?|mysql|oracle|mssql|sqlserver):\/\/[^/]*\/([^?\s/]+)/i))) return { kind: 'DB', name: m[2] + ' DB', db: true }
  if (/^(git@|https?:\/\/|ssh:\/\/).+\.git$/i.test(t) || /^git@/i.test(t) || /^(https?|ssh):\/\//i.test(t)) {
    const nm = t.replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).pop()
    return { kind: '코드', name: nm + ' 코드', at: t, src: 'git', ...srcKn(nm), doc: '꾸러미 판', every: 'hourly', what: '꾸러미 판 표(package.json · pom.xml 에서)' }
  }
  if (/^[A-Za-z]:\\/.test(t) || /^\/[^\s]+/.test(t)) {
    const nm = t.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
    return { kind: '코드 폴더', name: nm + ' 코드 폴더', at: t, src: 'folder', ...srcKn(nm), doc: '꾸러미 판', every: 'hourly', what: '꾸러미 판 표(폴더 안의 package.json · pom.xml 에서)', local: true }
  }
  return { bad: true }
}
function srcHeard() {
  const v = sourcesOf(), can = v && !v.error ? v.can : !isTeam() || S.me.admin, pr = parseSrc(S.srcDraft)
  let heard = '', ok = false
  if (pr && pr.bad) heard = '<div class="heard bad" data-t="srcHeard">알아듣지 못했다 — 코드 폴더 · git 주소 · DB 주소를 붙인다</div>'
  else if (pr && pr.db) heard = `<div class="heard bad" data-t="srcHeard"><span class="kt src">DB</span><span>DB 에서 가져오기는 아직 열리지 않았다<span class="sub2">서버의 DB 읽기 계정이 정해지면 연다 · 코드 폴더 · git 주소는 지금 된다</span></span></div>`
  else if (pr) { ok = true; heard = `<div class="heard" data-t="srcHeard"><span class="kt src">${esc(pr.kind)}</span><span><b>${esc(pr.name)} → ${esc((KN(pr.kn) || {}).name || pr.kn)} › ${esc(pr.doc)} · ${everyTxt(pr.every)}</b><span class="sub2">${esc(pr.what)} · 바뀐 것만 고친다 · 넣을 곳은 kmd 가 골랐다 — ${esc(pr.why)}${pr.local && isTeam() ? ' · 이 경로는 팀 서버의 폴더다' : ''}</span></span></div>` }
  const btn = can ? `<button class="btn" data-a="addSrc" data-t="addSrcBtn"${ok ? '' : ' disabled'}>더하기</button>` : `<button class="btn pri" data-a="askSrc" data-t="askSrcBtn"${ok ? '' : ' disabled'}>관리자에게 부탁</button>`
  return { heard, btn }
}
function impTarget() {
  const k = S.route.kn
  if (k && k !== '*' && KN(k)) return { kn: k, label: KN(k).name + '(지금 연 지식)' }
  const ib = S.kns.find((x) => x.name === '받은편지함')
  if (ib) return { kn: ib.id, label: '받은편지함' }
  return { kn: null, label: '받은편지함(처음 넣으면 생긴다)' }
}
function viewImport() {
  const team = isTeam(), v = sourcesOf()
  const srcs = v && !v.error ? v.items : []
  const can = v && !v.error ? v.can : !team || S.me.admin
  const rowsHtml = srcs.map((s) => {
    const id = s.kn + '|' + s.name, st = s.state || {}, run = S.srcRun[id]
    const runH = run === 'run' ? '<span class="st2 run" data-t="srcRun">가져오는 중…</span>' : run ? `<span class="st2 ok" data-t="srcOk">${esc(run)}</span>` : ''
    const ev = String(s.every || 'hourly'), at = ev.startsWith('daily ') ? ev.slice(6) : '06:00'
    const mi = (val, l, sm) => `<div class="mi${ev.split(' ')[0] === val ? ' on' : ''}" data-a="setEvery" data-id="${esc(id)}" data-v="${val}">${ev.split(' ')[0] === val ? '✓ ' : ''}${l}${sm || ''}</div>`
    const menu = S.menu === 'every:' + id ? `<div class="menu" style="right:0;top:26px" data-t="everyMenu">${mi('hourly', '1시간마다')}${mi('daily', `매일 <input type="time" id="evAt" data-t="evAt" value="${esc(at)}" data-stop="1">`)}${mi('weekly', '매주 월')}${mi('change', '바뀔 때만', '<small>코드가 바뀌면 바로</small>')}<div class="sep"></div><div class="gray">한꺼번에 크게 바뀌면 쓰지 않고 멈춘다 — 「지금 가져오기」 는 언제든</div></div>` : ''
    const sub = `${s.kind === 'git' ? 'git · ' : '폴더 · '}${String(s.since || '').slice(5).replace('-', '-')} 부터${s.by && s.by !== S.me.user ? ' · ' + s.by : ''}`
    const into = (s.rules && s.rules[0] && s.rules[0].into && s.rules[0].into.doc) || ''
    return `<tr data-t="srcRow" data-name="${esc(s.name)}"><td><b>${esc(s.name)}</b><small>${esc(sub)}</small></td><td>${esc(s.knName)} › ${esc(into)}</td><td><span class="ev" data-t="every">${everyTxt(ev)}${can ? `<button class="kebab" data-a="menu" data-m="every:${esc(id)}" data-t="everyKebab" title="언제 바꾸기">⋯</button>` : ''}${menu}</span></td><td data-t="last">${st.checkedAt ? esc(whenTxt(st.checkedAt)) : '—'}<small>${esc(st.lastNote || '')}</small></td><td data-t="next">${esc(nextTxt(ev, st.checkedAt))}</td><td class="go2">${runH} ${run === 'run' ? '' : `<a class="lk" data-a="fetchSrc" data-id="${esc(id)}" data-t="fetchBtn">지금 가져오기</a>`}</td></tr>`
  }).join('')
  const sh = srcHeard(), target = impTarget()
  const main = `<div style="max-width:980px"><div class="big">자료 가져오기</div><p class="lead">코드 · DB 에서 표를 저절로 채우고, 파일이나 폴더를 문서로 들인다.</p>
  ${S.stops.map(stopHtml).join('')}
  <div class="card"><div class="ch">자동으로 가져오는 곳 <small>정한 때마다 확인 · 바뀐 것만 고친다</small>${can ? `<span class="r"><button class="btn pri" data-a="fetchAll" data-t="fetchAll"${srcs.length ? '' : ' disabled'}>지금 모두 가져오기</button></span>` : ''}</div>
   <div class="cb" style="padding:2px 14px 4px;overflow-x:auto">${!v ? loadingHtml : srcs.length ? `<table class="t" data-t="srcTable"><thead><tr><th>가져오는 곳</th><th>넣는 곳</th><th>언제</th><th>마지막 확인</th><th>다음</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>` : '<p class="muted" style="margin:10px 0">아직 더한 곳 없음 — 아래 칸에 코드 폴더 · git 주소 · DB 주소를 붙인다</p>'}</div>
   <div class="cf">바뀐 줄은 그 지식의 「오늘 바뀐 것」 에 · 한꺼번에 크게 바뀌면 쓰지 않고 멈춘다 · ${can ? '언제 바꾸기는 줄의 ⋯' : '언제 바꾸기 · 더하기 · 끊기는 관리자'}</div></div>
  <div class="card"><div class="ch">자동으로 가져올 곳 더하기 <small>코드 폴더 · git 주소 · DB 주소 — 한 칸</small></div><div class="cb">
   <div class="paste"><input class="inp mono" id="srcIn" data-in="src" data-t="srcIn" value="${esc(S.srcDraft)}" placeholder="붙여 넣기 — 예: postgres://읽기전용@db.team.local/gdi · git@gitlab.team.local:dpms/dpms-batch.git" autocomplete="off"><span id="srcBtnBox">${sh.btn}</span></div><div id="srcHeardBox">${sh.heard}</div></div></div>
  <div class="card"><div class="ch">파일 · 폴더 넣기 <small>한 번 들여온다 — 원본은 첨부로</small></div><div class="cb">
   <div class="drop" id="drop" data-t="drop"><b>파일이나 폴더를 여기에 끌어다 놓으면 문서가 된다</b>md · docx · pptx · xlsx · hwpx · pdf · 원본은 첨부로 · 넣을 곳 — ${esc(target.label)}
    <div class="lks"><label>파일 고르기<input type="file" multiple id="fileIn" data-t="fileIn"></label> · <label>폴더 고르기<input type="file" webkitdirectory directory multiple id="dirIn" data-t="dirIn"></label></div></div>
   <p class="gl">${team ? 'md · docx · pptx · xlsx 는 바로 바꾼다 — hwpx · pdf 는 내 PC 프로그램이 있는 PC 에서 · 원본은 먼저 첨부로.' : 'md · docx · pptx · xlsx 는 바로 바꾼다 — hwpx · pdf 는 원본을 첨부로 두었다가 바꾼다.'} 폴더 안의 짜임은 그대로 · 한 번에 300 파일 · 200MB 까지.</p>
   <div class="rh">최근 넣은 것</div><ul class="plain rec" data-t="recent">${S.imports.map((x) => `<li class="${x.cls || ''}" data-t="impRow"><span class="tm">${esc(x.tm)}</span><span class="tx">${esc(x.title)}<small data-t="impMsg">${esc(x.msg)}</small></span>${x.go ? `<a class="lk" data-a="impGo" data-k="${esc(x.go.kn)}" data-d="${esc(x.go.doc)}">보기</a>` : ''}</li>`).join('') || '<li class="muted">아직 없다</li>'}</ul>
  </div></div></div>`
  return { crumb: '자료 가져오기', main }
}
async function fetchSrc(id) {
  const [kn, name] = id.split('|')
  S.srcRun[id] = 'run'
  render()
  try {
    const r = (await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/run`, { name }))[0] || {}
    S.srcRun[id] = r.state === 'changed' ? `가져왔다 — 바뀐 표 ${r.n} · ${nowHm()}` : r.state === 'stopped' ? '멈췄다 — 한꺼번에 크게 바뀌었다' : r.state === 'failed' ? '못 가져왔다 — ' + (r.why || '') : `가져왔다 — 그대로 · ${nowHm()}`
    if (r.state === 'changed') { forgetKn(kn); delete S.cache.today }
  } catch (e) { S.srcRun[id] = '못 가져왔다 — ' + e.message }
  delete S.cache.sources
  loadStops()
  render()
}
async function addSrc(ask) {
  const pr = parseSrc(S.srcDraft)
  if (!pr || pr.bad || pr.db) return
  const card = { name: pr.name, at: pr.at, kind: pr.src, every: pr.every, rules: [{ rule: 'deps', into: { doc: pr.doc } }] }
  try {
    if (ask) { await postJSON(`/api/k/${encodeURIComponent(pr.kn)}/sources/request`, card); toast('관리자에게 부탁했다 — 관리 화면에 보인다'); S.srcDraft = ''; render(); return }
    toast('가져오는 중…')
    const r = await postJSON(`/api/k/${encodeURIComponent(pr.kn)}/sources`, card)
    S.srcDraft = ''
    delete S.cache.sources
    forgetKn(pr.kn)
    const st = r.run && r.run[0]
    toast(st && st.state === 'changed' ? `더했다 — ${esc(pr.name)} · 처음 가져온 표 ${st.n}` : `더했다 — ${esc(pr.name)}`)
    render()
  } catch (e) { toast(esc(e.message), 7000) }
}
const fileB64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(f) })
async function takeFiles(files) {
  files = [...files]
  if (!files.length) return
  let t = impTarget()
  try {
    if (!t.kn) { const r = await postJSON('/api/knowledge/add', { kind: 'new', name: '받은편지함' }); S.kns = await getJSON('/api/knowledge'); t = { kn: r.id, label: '받은편지함' } }
  } catch (e) { toast(esc(e.message)); return }
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
    } else {
      row.msg = `${tops[0] ? tops[0] + ' 폴더 — ' : ''}문서 ${s.doc}${s.record ? ' · 기록 ' + s.record : ''} · 첨부 ${s.att}${s.same ? ' · 그대로 ' + s.same : ''}${s.fail ? ' · 바꾸지 못한 파일 ' + s.fail : ''} · 넣지 않은 파일 ${s.skip}`
      row.cls = s.skip || s.fail ? 'bad' : ''
    }
    row.tm = nowHm()
    forgetKn(t.kn)
    delete S.cache.today
    S.kns = await getJSON('/api/knowledge')
  } catch (e) { row.msg = e.message; row.cls = 'bad' }
  render()
}
function readEntries(entry, p, out) {
  return new Promise((res) => {
    if (entry.isFile) entry.file((f) => { f._rel = p + f.name; out.push(f); res() }, () => res())
    else if (entry.isDirectory) { const rd = entry.createReader(), all = []; const next = () => rd.readEntries((es) => { if (!es.length) Promise.all(all.map((e) => readEntries(e, p + entry.name + '/', out))).then(res); else { all.push(...es); next() } }, () => res()); next() }
    else res()
  })
}

// ── 지식 추가(목업 M3) ──
function parseAdd(t) {
  t = String(t || '').trim()
  if (!t) return null
  if (/^(postgres(ql)?|mysql|oracle|mssql):\/\//i.test(t) || /\.git$/i.test(t) || /^git@/i.test(t)) return { kind: 'src' }
  if (/^https?:\/\//i.test(t)) {
    let u
    try { u = new URL(t) } catch { return { kind: 'bad' } }
    const slug = decodeURIComponent((u.pathname.match(/^\/r\/([^/?#]+)/) || u.hash.match(/^#~([^/]+)/) || [])[1] || '')
    if (!slug) return { kind: 'bad' }
    const id = slug.replace(/_wiki$/i, '')
    const k = S.kns.find((x) => x.id.toLowerCase() === id.toLowerCase())
    return { kind: 'team', k: u.host === location.host && k ? k.id : null, slug, other: u.host !== location.host }
  }
  if (/^[A-Za-z]:\\/.test(t) || /^\/[^\s]/.test(t)) { const nm = t.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || t; return { kind: 'folder', path: t, name: nm } }
  return { kind: 'new', name: t }
}
const pcRoot = () => (S.me.root || '').replace(/[\\/]+$/, '')
function addHeard() {
  const hasPc = !isTeam(), pr = parseAdd(S.addDraft)
  let heard = '', ok = false
  if (pr) {
    if (pr.kind === 'src') heard = '<div class="heard bad" data-t="addHeard"><span class="kt src">코드 · DB</span><span>코드 · DB 는 자료 가져오기에서 더한다 <a data-a="addToImport" data-t="addToImport">→</a><span class="sub2">지식 안에 표를 저절로 채우는 일이라 여기서는 더하지 않는다</span></span></div>'
    else if (pr.kind === 'team' && hasPc) heard = '<div class="heard bad" data-t="addHeard"><span class="kt team">팀</span><span>팀 지식은 팀 화면에서 연다<span class="sub2">이 PC 에서는 내 지식만 더한다 · 팀에 잇기는 팀 화면 › 설치 한 줄</span></span></div>'
    else if (pr.kind === 'team') {
      if (pr.k) { ok = true; heard = `<div class="heard" data-t="addHeard"><span class="kt team">팀</span><span><b>팀 지식 들어가기</b> — ${esc(KN(pr.k).name)} · 이미 목록에 있다 — 그 지식으로 간다</span></div>` }
      else heard = `<div class="heard bad" data-t="addHeard"><span class="kt team">팀</span><span>${pr.other ? '다른 kmd 의 팀 지식 — 이 PC 에서 설치 한 줄(kmd connect)로 잇는다' : esc(pr.slug) + ' — 이 kmd 에 그런 지식이 없다'}</span></div>`
    } else if (pr.kind === 'folder') {
      if (!hasPc) heard = '<div class="heard bad" data-t="addHeard"><span class="kt me">내 PC</span><span>경로는 내 PC 프로그램이 연다 — 이 PC 에는 없다<span class="sub2">새 이름을 붙이면 팀 서버 안 내 지식이 선다</span></span></div>'
      else { ok = true; heard = `<div class="heard" data-t="addHeard"><span class="kt me">내 PC</span><span><b>새 지식으로 들여오기</b> — 지식 폴더 안 「${esc(pr.name)}」 로<span class="sub2">md · docx · pptx · xlsx 는 문서가 되고 그 밖은 첨부 · 원본 폴더는 그대로 둔다 · 한 번에 300 파일 · 200MB</span></span></div>` }
    } else if (pr.kind === 'new') { ok = true; heard = `<div class="heard" data-t="addHeard"><span class="kt me">${hasPc ? '내 PC' : '개인'}</span><span><b>${hasPc && !S.kns.length ? '첫 지식 세우기' : '새 지식 만들기'}</b> — ${hasPc ? esc(pcRoot() + '\\' + pr.name) + ' · 나만' : '팀 서버 안 내 지식 「' + esc(pr.name) + '」 · 나만(관리자는 볼 수 있다)'}</span></div>` }
    else heard = `<div class="heard bad" data-t="addHeard">알아듣지 못했다 — ${hasPc ? '이름이나 내 PC 폴더 경로를' : '이름 · 내 PC 폴더 경로 · 팀 지식 주소를'} 붙인다</div>`
  }
  return { heard, btn: `<button class="btn pri" data-a="doAdd" data-t="addBtn"${ok ? '' : ' disabled'}>${hasPc && !S.kns.length ? '세우기' : '추가'}</button>`, ok }
}
// 이 PC — 내 지식만 다룬다(팀 지식 주소는 팀 화면의 일). 지식은 모두 지식 폴더 안에 — 밖의 폴더는 새 지식으로 들여온다(원본은 그대로).
// 내 지식이 하나도 없으면 「내 지식 세우기」 — 지식 폴더를 먼저 보이고 첫 이름 하나
function rootCard(first) {
  const root = pcRoot()
  return `<div class="card" data-t="addRoot"><div class="ch">지식 폴더 <small>내 지식은 모두 이 안에 — 지식 하나 = 폴더 하나</small></div><div class="cb"><div class="path" data-t="rootPath"><span class="mono">${esc(root)}</span><a class="r lk" data-a="copyRoot" data-t="copyRoot">경로 복사</a></div>${first ? '<div class="kv" style="margin-top:10px"><span>누가</span><span>나만 — 이 PC 밖으로는 백업 · 보내기 · Claude 정리만 나간다</span></div>' : ''}</div><div class="cf">탐색기 · 편집기에서 열 때 이 경로를 붙인다 · 다른 자리로 하려면 kmd 를 그 폴더로 다시 연다 — <code>kmd up D:\\다른자리</code></div></div>`
}
function viewAddPc() {
  const ah = addHeard(), root = pcRoot(), first = S.kns.length === 0
  const msg = S.addMsg ? `<div class="callout ${S.addMsg.cls} stop" data-t="addMsg"><i></i><span>${S.addMsg.t}</span></div>` : ''
  const box = (ph) => `<div class="paste"><input class="inp mono" id="addIn" data-in="add" data-t="addIn" value="${esc(S.addDraft)}" placeholder="${ph}" autocomplete="off"><span id="addBtnBox">${ah.btn}</span></div><div id="addHeardBox">${ah.heard}</div>`
  if (first) return { crumb: '내 지식 세우기', main: `<div style="max-width:820px"><div class="big">내 지식 세우기</div><p class="lead">아직 내 지식이 없다. 첫 지식의 이름을 정하면 지식 폴더 안에 선다.</p>
  ${msg}${rootCard(true)}
  <div class="rh" style="margin-top:16px">첫 지식 이름</div>${box('예: 메모')}
  <p class="small muted" style="margin-top:10px">md 를 모아 둔 폴더가 이미 있으면 그 경로를 붙인다(예: <code data-a="fillAdd" data-v="D:\\옛자료" style="cursor:pointer">D:\\옛자료</code>) — 지식 폴더 안의 새 지식으로 들여온다 · 원본은 그대로.</p></div>` }
  return { crumb: '지식 추가', main: `<div style="max-width:820px"><div class="big">지식 추가</div><p class="lead">새 이름이나 내 PC 폴더를 붙인다 — 지식 폴더 안에 내 지식 ${S.kns.length} 옆으로 선다.</p>
  ${msg}${rootCard(false)}<div style="margin-top:16px">${box('예: 회의 · D:\\옛자료')}</div>
  <div class="card" style="margin-top:16px"><div class="ch">이렇게도 붙인다</div><div class="cb" style="padding:2px 14px"><ul class="plain">
   <li><code data-a="fillAdd" data-v="회의" style="cursor:pointer">회의</code> → <b>새 지식 만들기</b> — 지식 폴더 안 「회의」 · 나만</li>
   <li><code data-a="fillAdd" data-v="D:\\옛자료" style="cursor:pointer">D:\\옛자료</code> → <b>새 지식으로 들여오기</b> — 지식 폴더 안 「옛자료」 로 · 원본은 그대로</li>
   <li>코드 폴더 · git · DB 주소 → <a data-a="nav" data-s="import">자료 가져오기</a>에서 — 표를 저절로 채운다</li>
  </ul></div><div class="cf">예를 누르면 칸에 들어간다</div></div></div>` }
}
function viewAdd() {
  if (!isTeam()) return viewAddPc()
  const hasPc = !isTeam(), ah = addHeard(), ex = location.origin + '/r/' + ((S.kns.find((k) => !k.private) || S.kns[0] || {}).id || 'dpms')
  return { crumb: '지식 추가', main: `<div style="max-width:820px"><div class="big">지식 추가</div><p class="lead">새 이름 · 내 PC 폴더 · 팀 지식 주소 — 무엇이든 붙인다. kmd 가 알아서 가른다.</p>
  ${S.addMsg ? `<div class="callout ${S.addMsg.cls} stop" data-t="addMsg"><i></i><span>${S.addMsg.t}</span></div>` : ''}
  <div class="paste"><input class="inp mono" id="addIn" data-in="add" data-t="addIn" value="${esc(S.addDraft)}" placeholder="예: 회의 · D:\\옛자료 · ${esc(ex)}" autocomplete="off"><span id="addBtnBox">${ah.btn}</span></div><div id="addHeardBox">${ah.heard}</div>
  <div class="card" style="margin-top:16px"><div class="ch">이렇게도 붙인다</div><div class="cb" style="padding:2px 14px"><ul class="plain">
   <li><code data-a="fillAdd" data-v="회의" style="cursor:pointer">회의</code> → <b>새 지식 만들기</b> — ${hasPc ? esc(pcRoot() + '\\회의') + ' · 나만' : '팀 서버 안 내 지식'}</li>
   <li><code data-a="fillAdd" data-v="D:\\옛자료" style="cursor:pointer">D:\\옛자료</code> → <b>내 폴더를 지식으로</b> — 그 자리에서 따라간다 · 복사하지 않는다</li>
   <li><code data-a="fillAdd" data-v="${esc(ex)}" style="cursor:pointer">${esc(ex)}</code> → <b>팀 지식 들어가기</b></li>
   <li><code data-a="fillAdd" data-v="git@gitlab.team.local:dpms/dpms-batch.git" style="cursor:pointer">git@gitlab.team.local:dpms/dpms-batch.git</code> → 코드 · DB 는 <a data-a="nav" data-s="import">자료 가져오기</a>에서</li>
  </ul></div><div class="cf">예를 누르면 칸에 들어간다</div></div></div>` }
}
async function doAdd() {
  const pr = parseAdd(S.addDraft)
  if (!pr) return
  S.addMsg = null
  if (pr.kind === 'team') { if (pr.k) { S.addDraft = ''; go({ scr: 'docs', kn: pr.k }) } return }
  if (pr.kind !== 'new' && pr.kind !== 'folder') return
  try {
    const r = await postJSON('/api/knowledge/add', pr.kind === 'new' ? { kind: 'new', name: pr.name } : { kind: 'folder', dir: pr.path })
    S.kns = await getJSON('/api/knowledge')
    S.addDraft = ''
    delete S.cache.today
    const firstPc = !isTeam() && S.kns.length === 1
    const s = r.summary
    const got = s ? ` · 문서 ${s.doc}${s.att ? ' · 첨부 ' + s.att : ''}${s.fail ? ' · 바꾸지 못한 파일 ' + s.fail : ''}${s.skip ? ' · 넣지 않은 파일 ' + s.skip : ''} — 원본은 그대로` : ''
    S.addMsg = { cls: '', t: `<b>${r.from ? '들여왔다' : firstPc ? '세웠다' : pr.kind === 'new' && isTeam() ? '만들었다' : '추가했다'} — ${esc(r.name)}</b>${isTeam() ? ' · 팀 서버 안 내 지식' : got || (r.dir ? ' · ' + esc(r.dir) : '')} <a data-a="openKn" data-k="${esc(r.id)}">${firstPc && !r.from ? '열어서 첫 문서 쓰기' : '열기'} ›</a>` }
  } catch (e) { S.addMsg = { cls: 'gray', t: `<b>${esc(e.message)}</b>` } }
  render()
}

// ── 보내기(목업 M10) ──
const sendOf = (k) => need('send:' + k, `/api/k/${encodeURIComponent(k)}/send`)
const sendKns = () => S.kns.filter((k) => k.dests && k.dests.length)
function viewSend() {
  if (S.cand === null) setTimeout(loadCand)
  const ks = sendKns(), qs = ks.map((k) => ({ k, v: sendOf(k.id) }))
  const loading = qs.some((x) => !x.v)
  const on = [], off = [], wait = [], log = []
  for (const { k, v } of qs) {
    if (!v || v.error) continue
    for (const q of v.items) (q.on ? on : off).push({ ...q, kn: k.id, from: k.name, to: v.dests.map((d) => d.kn) })
    for (const w of v.wait) wait.push({ ...w, from: k.name })
    for (const l of v.log) log.push({ ...l, from: k.name })
  }
  log.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const dests = [...new Set(on.flatMap((q) => q.to))]
  const dn = dests.map((d) => (KN(d) || {}).name || d).join(' · ') || '팀'
  const dnK = /지식$/.test(dn) ? dn : dn + ' 지식'
  const cand = S.cand || []
  const tidyAt = dests.length === 1 && KN(dests[0]) && KN(dests[0]).tidyAt
  let top = ''
  if (wait.length) top += `<div class="callout gray stop" data-t="sendWait"><i></i><span><b>팀 서버에 닿지 않는다</b> — 닿으면 저절로 보낸다 · ${wait.reduce((a, w) => a + w.n, 0)}개 · ${esc(whenTxt(wait[0].at))} 에 누른 것</span></div>`
  const li = (q) => `<li data-t="sendItem"><span style="display:flex;flex-direction:column;min-width:0"><b>${esc(q.isNew ? q.title : q.title + ' — ' + q.heads.join(' · '))}</b><small class="muted">${esc(q.from)}에서 · ${esc(whenTxt(q.when))}</small></span><span class="r small muted" style="white-space:nowrap">${q.isNew ? '새 문서로' : '고친 것 → ' + esc(q.title)}</span><button class="kebab" data-a="menu" data-m="sq:${esc(q.kn + '|' + q.path)}" title="이번에 빼기">⋯${S.menu === 'sq:' + q.kn + '|' + q.path ? `<div class="menu" style="right:0;top:28px"><div class="mi" data-a="dropSend" data-k="${esc(q.kn)}" data-p="${esc(q.path)}">이번에 빼기<small>다음에 다시 모인다</small></div></div>` : ''}</button></li>`
  const list = on.length + cand.filter((c) => c.on).length ? `<div class="card"><div class="ch"><span class="kt team">팀</span>${esc(dnK)}으로 <span class="chip c-pend">${on.length + cand.filter((c) => c.on).length}</span></div><div class="cb" style="padding:2px 14px 8px"><ul class="plain">${on.map(li).join('')}${cand.filter((c) => c.on).map((c) => `<li data-t="sendItem"><span style="display:flex;flex-direction:column;min-width:0"><b>${esc(c.title)}</b><small class="muted">받은편지함에서 · 메모</small></span><span class="r small muted" style="white-space:nowrap">→ ${esc(c.name || c.to)}</span></li>`).join('')}</ul>
   ${cand.some((c) => !c.on) ? `<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:8px;font-size:12px;color:var(--text-2)"><div class="muted">받은편지함에서 — 넣으면 같이 간다</div>${cand.filter((c) => !c.on).map((c) => `<div class="row" style="margin-top:4px"><span class="kn none">메모</span><b>${esc(c.title)}</b><span class="muted">→ ${esc(c.name || c.to)}</span><a class="lk r" data-a="addCand" data-id="${esc(c.record)}" data-t="addCand">보낼 것에 넣기</a></div>`).join('')}</div>` : ''}
   ${off.length ? `<div class="small muted" style="margin-top:8px">이번에 뺀 것 ${off.length} — ${off.map((q) => esc(q.title) + ` <a data-a="undropSend" data-k="${esc(q.kn)}" data-p="${esc(q.path)}">다시 넣기</a>`).join(' · ')}</div>` : ''}
  </div></div>
  <div class="row" style="margin:12px 0 0;padding-top:10px;border-top:1px solid var(--border)"><span class="muted small">${tidyAt ? '오늘 밤 ' + esc(tidyAt) + ' 정리 때 문서에 들어간다' : '받는 지식의 정리 때 문서에 들어간다'}</span><button class="btn pri r" data-a="doSend" data-t="sendBtn"${wait.length || S.sending ? ' disabled' : ''}>${on.length + cand.filter((c) => c.on).length}개 보내기</button></div>`
    : loading ? loadingHtml : `<p class="muted" data-t="sendEmpty">보낼 것이 없다 — 내 지식에서 고치면 여기에 저절로 모인다.</p>${off.length ? `<div class="small muted">이번에 뺀 것 ${off.length} — ${off.map((q) => esc(q.title) + ` <a data-a="undropSend" data-k="${esc(q.kn)}" data-p="${esc(q.path)}">다시 넣기</a>`).join(' · ')}</div>` : ''}`
  const destRows = S.kns.filter((k) => k.role === '주인' || !isTeam()).map((k) => `<div class="row" style="margin-top:6px" data-t="destRow"><span style="min-width:110px"><b>${esc(k.name)}</b></span><input class="inp mono" style="flex:1" id="dest-${esc(k.id)}" value="${esc((k.dests || []).join(', '))}" placeholder="보낼 지식 — 예: dpms · 다른 kmd 면 http://kmd.team.local/r/dpms"><a class="lk" data-a="setDests" data-k="${esc(k.id)}">저장</a></div>`).join('')
  return { crumb: '보내기', main: `<div style="max-width:720px"><div class="big">보내기</div>${on.length ? `<p class="lead">바뀐 문서 ${on.length}개를 골라 두었다 — 누르면 ${esc(dnK)}으로 간다.</p>` : ''}
  ${S.stops.filter((s) => s.level === 'warn' && s.kind !== 'send').map(stopHtml).join('')}${top}${list}
  <div class="feed" style="margin-top:14px" data-t="sentFeed"><div class="fh">보낸 것</div>${log.map((x) => `<div class="fi" data-t="sentRow"><div class="ln"><span class="tm">${esc(whenTxt(x.at))}</span><span class="dot ${x.late || x.wait ? 'acc' : ''}"></span><span class="tx">${esc(x.to.map((d) => (KN(d) || {}).name || d).join(' · '))}로 ${x.n}개를 ${x.wait ? '보내려 했다' : '보냈다'}${x.late ? `<small>${esc(whenTxt(x.late))} 에 누른 것</small>` : x.wait ? '<small>닿으면 저절로 보낸다</small>' : ''}</span></div></div>`).join('') || '<div class="fi"><div class="ln"><span class="tx muted">아직 없다</span></div></div>'}</div>
  <details class="more"${ks.length ? '' : ' open'}><summary>자세히</summary><div class="in">${esc(S.me.user)} 이름으로 간다${isTeam() ? '' : ' — 이 PC 가 설치 때 팀에 이어진 대로'}. 정리 때 kmd 가 바로 문서에 넣고(누구나 [지금 정리]), 값이 바뀌면 나에게 「오늘 바뀐 것」 노란 줄로 알린다. 내 글은 그대로다.<div class="rh" style="margin-top:10px">보낼 곳</div>${destRows || '<span class="muted">내 지식이 없다</span>'}</div></details></div>` }
}
async function loadCand() {
  const ib = S.kns.find((k) => k.name === '받은편지함')
  if (!ib || S.cand) return
  S.cand = []
  try { S.cand = (await postJSON(`/api/k/${encodeURIComponent(ib.id)}/inbox/tidy`, { dry: true })).candidates.map((c) => ({ ...c, on: false, from: ib.id })) } catch {}
  render()
}
async function doSend() {
  S.sending = true
  render()
  let n = 0, w = 0
  try {
    for (const k of sendKns()) {
      const v = S.cache['send:' + k.id]
      if (!v || v.error || !v.items.some((q) => q.on)) continue
      const r = await postJSON(`/api/k/${encodeURIComponent(k.id)}/send`, {})
      n += r.sent
      w += r.wait
    }
    for (const c of (S.cand || []).filter((x) => x.on)) {
      await postJSON(`/api/k/${encodeURIComponent(c.from)}/inbox/send`, { record: c.record, to: c.to })
      n++
    }
    S.cand = null
    toast(w ? `닿지 않는다 — ${w}개는 닿으면 저절로 보낸다` : `보냈다 — ${n}개 · 정리 때 문서에 들어간다`)
  } catch (e) { toast(esc(e.message), 7000) }
  S.sending = false
  for (const key of Object.keys(S.cache)) if (key.startsWith('send:')) delete S.cache[key]
  delete S.cache.today
  S.kns = await getJSON('/api/knowledge').catch(() => S.kns)
  loadStops()
  render()
}

// ── 팀 화면 ↔ 내 PC(E8 · v0.5 §5 · v0.6 ⑫) ──
// 설치가 팀 주소를 내 PC 프로그램에 적어 두었으면 물으면 바로 12시간 짝 열쇠를 준다(누름 없음 · 탭 메모리만).
// 내 PC 지식의 id 는 ~ 로 시작하고 그 요청은 reqTo 가 내 PC 프로그램으로만 보낸다.
function pcRemembered() { try { return JSON.parse(localStorage.getItem('kmdPcKns') || '[]') } catch { return [] } }
async function pcConnect(again) {
  const url = S.me.pcUrl
  if (!url) return
  let seen = false, tok = null
  try { seen = !!localStorage.getItem('kmdPcSeen'); tok = sessionStorage.getItem('kmdPair') } catch {}
  S.pc = { url, token: null, kns: [], off: false, allow: false, seen }
  S.kns = S.kns.filter((k) => !k.pc)
  try {
    if (!tok) {
      const r = await fetch(url + '/pair', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.status === 403 && j.need === 'allow') { S.pc.allow = true; return }
      if (!r.ok) throw new Error(j.message || '')
      tok = j.token
      try { sessionStorage.setItem('kmdPair', tok); localStorage.setItem('kmdPcSeen', '1') } catch {}
    }
    S.pc.token = tok
    const r2 = await fetch(url + '/api/knowledge', { headers: { authorization: 'Bearer ' + tok } })
    if (r2.status === 401 && !again) { try { sessionStorage.removeItem('kmdPair') } catch {} return pcConnect(true) }
    if (!r2.ok) throw new Error('')
    S.pc.kns = (await r2.json()).map((k) => ({ ...k, id: '~' + k.id, pc: true, role: null, dests: null, sendN: 0 }))
    S.kns = [...S.kns, ...S.pc.kns]
    try { localStorage.setItem('kmdPcKns', JSON.stringify(S.pc.kns.map((k) => ({ id: k.id, name: k.name, docs: k.docs })))) } catch {}
  } catch { S.pc.off = true; S.pc.token = null }
}
// 적히지 않은 팀 주소 — 내 PC 프로그램 창이 [허락] 을 묻고 짝 열쇠를 이 창에만 넘긴다(대상 출처 고정)
function pcAllow() {
  const w = window.open(S.pc.url + '/pair?from=' + encodeURIComponent(location.origin), 'kmdpair', 'width=520,height=360')
  const on = async (ev) => {
    if (ev.origin !== S.pc.url || !ev.data || !ev.data.kmdPair) return
    window.removeEventListener('message', on)
    try { sessionStorage.setItem('kmdPair', ev.data.kmdPair); localStorage.setItem('kmdPcSeen', '1') } catch {}
    await pcConnect()
    render()
  }
  window.addEventListener('message', on)
  if (!w) toast('창이 막혔다 — 이 사이트의 팝업을 허락한다')
}
// 내 PC 프로그램 쪽 — /pair?from=<팀 주소> 창
function viewPair() {
  const from = (() => { try { return new URL(new URLSearchParams(location.search).get('from') || '').origin } catch { return '' } })()
  if (!from) return { crumb: '허락', main: '<div class="callout gray">팀 주소가 없다</div>' }
  return { crumb: '허락', main: `<div class="modal win" style="margin:24px auto;position:static" data-t="pairWin"><div class="tb"><span class="logo me">K</span><b>kmd — 이 PC</b></div><div class="wb"><div class="ask">팀 화면 <b>${esc(new URL(from).host)}</b> 에서<br>내 PC 지식을 연다</div><p class="only">이 PC 에서만 열린다 — 내 지식은 팀 서버로 가지 않는다 · 읽기와 저장만</p></div><div class="wf"><button class="btn pri" data-a="pairOk" data-v="${esc(from)}" data-t="pairOk">허락</button></div></div>` }
}
async function pairOk(from) {
  try {
    const r = await postJSON('/api/pair/allow', { origin: from })
    if (window.opener) window.opener.postMessage({ kmdPair: r.token }, from)
    toast('허락했다 — 팀 화면에서 내 PC 지식이 열린다')
    setTimeout(() => window.close(), 600)
  } catch (e) { toast(esc(e.message)) }
}

// ── 설정(목업 M13) — 일반 · Claude 연결 · 에이전트 설치 ──
const settingsOf = () => need('settings', '/api/settings')
const devicesOf = () => need('devices', '/api/me/devices')
const AUTO_T = {
  team: [['file', '넣은 파일을 문서로', 'md · docx · pptx · xlsx 는 팀 서버에서 바로'], ['find', '찾기', '딱 맞는 항목이 없으면 비슷한 글에서']],
  pc: [['save', '편집기에서 고친 것 저장', '30초 조용하면 저절로'], ['file', '넣은 파일을 문서로', 'md · docx · pptx · xlsx 를 넣으면 바로'], ['src', '자동으로 가져오는 곳', '더해 둔 곳에서 때마다 표를 다시 채운다'], ['claude', '자동 정리 — Claude 로', '정해진 시각에 내 Claude 로그인으로'], ['find', '찾기', '딱 맞는 항목이 없으면 비슷한 글에서']],
}
function viewSettings() {
  const team = isTeam(), st = settingsOf(), tab = S.setTab || 'gen'
  const ST = [['gen', '일반'], ['claude', 'Claude 연결'], ['agent', '에이전트 설치']]
  const tabs = `<div class="tabs" data-t="setTabs">${ST.map(([v, l]) => `<span class="${tab === v ? 'on' : ''}" data-a="setTab" data-v="${v}" data-t="st-${v}">${l}</span>`).join('')}</div>`
  if (!st || st.error) return { crumb: '설정', main: `<div style="max-width:980px"><div class="big">설정</div>${tabs}${st ? errHtml(st) : loadingHtml}</div>` }
  const body = tab === 'claude' ? `<div style="max-width:720px">${claudeCard(st)}</div>` : tab === 'agent' ? `<div style="max-width:760px">${agentCard()}</div>` : `<div class="g2"><div>${setLeft(st)}</div><div>${autoCard(st)}</div></div>`
  return { crumb: '설정' + (tab === 'gen' ? '' : ' › ' + ST.find((x) => x[0] === tab)[1]), main: `<div style="max-width:980px"><div class="big">설정</div>${tabs}${body}</div>` }
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
  if (isTeam()) return `<div class="card" style="overflow:visible"><div class="ch">이 팀 서버 <small class="mono">${esc(st.host)}</small></div><div class="cb"><div class="kv"><span>들어가기</span><span>아이디 ${esc(S.me.user)} · 비밀번호는 브라우저가 기억한다 <a class="small" data-a="logout" data-t="logout">나가기</a></span><span>내 지식</span><span>${S.pc && S.pc.kns.length ? '내 PC 지식 ' + S.pc.kns.length + ' — 내 PC 프로그램이 연다' : S.kns.some((k) => k.private) ? '받은편지함 · 내 지식 — 이 서버 안 · 나만 쓴다' : '아직 없다 — 지식 추가에서'}</span><span>백업</span><span>${bk}</span><span>판</span><span>kmd v${esc(st.version)}</span></div></div>${S.me.admin ? '<div class="cf"><a class="lk" data-a="nav" data-s="admin">관리 — 문제 · 사람 · 백업 →</a></div>' : ''}</div>` + devCard()
  const pcBad = S.stops.find((x) => x.kind === 'backup')
  return `<div class="card"><div class="ch">이 PC</div><div class="cb"><div class="kv"><span>지식 폴더</span><span><span class="mono">${esc(st.root)}</span> — 지식 ${st.kns}</span><span>백업 자리</span><span>${st.backup.n ? `<span class="mono">${esc(st.backup.urls.join(' · '))}</span> ${pcBad ? `<span class="chip c-warn">${esc(pcBad.b)}</span><small>${esc(pcBad.t)}</small>` : '<span class="chip c-acc">잘 된다</span>'}` : '아직 없다'}</span><span>보낼 곳</span><span>${(st.dests || []).map((d) => esc(d.name) + ' → ' + esc(d.to.join(' · '))).join(' · ') || '없다 — 보내기 › 자세히에서'}</span><span>판</span><span>kmd v${esc(st.version)}</span></div></div></div>
  <div class="card" style="overflow:visible"><div class="ch">이어진 것</div><div class="cb" style="padding:2px 14px"><ul class="plain"><li><span style="flex:1"><b>Claude Code</b><small class="muted" style="display:block">작업 폴더 ${(S.cache.agent && S.cache.agent.folders ? S.cache.agent.folders.length : 0)} <a data-a="setTab" data-v="agent">에이전트 설치 ›</a></small></span></li><li><span style="flex:1"><b>팀 kmd</b><small class="muted" style="display:block">${st.teams && st.teams.length ? esc(st.teams.map((u) => u.replace(/^https?:\/\//, '')).join(' · ')) + ' · 이어짐' : '아직 잇지 않았다 — 팀 화면의 설치 한 줄'}</small></span></li></ul><p class="small muted">밖으로 나가는 것은 보내기 · 백업 · Claude 정리뿐이다.</p></div></div>` + devCard()
}
function claudeCard(st) {
  const c = st.claude, w = c.worker
  if (!isTeam()) {
    let row
    if (S.claudeOpening) row = '<div class="set"><span class="tx"><b data-t="claudeState">로그인하는 중</b><span class="prog" data-t="claudeProg" style="margin-top:4px"><i></i>창이 열렸다 — Claude 에 들어가면 끝</span></span></div>'
    else if (w && w.ok === false && w.reason === 'login') row = '<div class="set"><span class="tx"><b data-t="claudeState">로그인 안 됨</b><small>정리 · 기록 만들기는 규칙으로 되는 것만 한다</small></span><button class="btn pri" data-a="claudeLogin" data-t="claudeLogin">Claude 로그인</button></div>'
    else row = `<div class="set"><span class="tx"><b data-t="claudeState">${w && w.ok ? '로그인됨' : '이 PC 의 Claude Code 로그인을 쓴다'}</b><small>이번 달 정리 ${c.month}건 · 기록 만들기 · 정리에 쓴다 · 로그인은 이 PC 의 Claude Code 에</small></span><button class="kebab${S.menu === 'claude' ? ' on' : ''}" data-a="menu" data-m="claude" data-t="claudeKebab" title="다시 로그인 · 쓰지 않기">⋯${S.menu === 'claude' ? '<div class="menu" style="right:0;top:28px"><div class="mi" data-a="claudeLogin" data-t="claudeRelogin">다시 로그인<small>창이 열린다</small></div><div class="mi" data-a="claudeOff" data-t="claudeOff">Claude 쓰지 않기<small>규칙으로 되는 것만</small></div></div>' : ''}</button></div>`
    return `<div class="card" data-t="claudeCard" style="overflow:visible"><div class="ch">Claude 연결 <small>이 프로그램이 쓰는 Claude Code 로그인</small></div><div class="cb" style="padding:2px 14px">${row}</div><div class="cf">기록 문서를 만들거나 정리할 때 이 PC 의 Claude Code 를 부른다 · 오래 가는 로그인을 쓴다</div></div>`
  }
  const rest = w && w.ok === false
  const days = rest ? Math.max(1, Math.round((Date.now() - Date.parse(w.since)) / 864e5)) : 0
  const pcLine = S.pc ? `<div class="set"><span class="tx"><b>내 PC 프로그램의 Claude</b><small data-t="claudePcLine">${S.pc.off ? '내 PC 프로그램이 꺼져 있다' : '내 PC 프로그램의 설정에서'}</small></span></div>` : ''
  return `<div class="card" data-t="claudeCard"><div class="ch">Claude 연결 <small>읽기만</small></div><div class="cb" style="padding:2px 14px"><div class="set"><span class="tx"><b data-t="claudeRead">팀 정리는 정리 전용 로그인으로 돈다 — 쉬면 관리자에게 알린다</b><small>${rest ? `지금 쉬고 있다 · ${days}일 — 관리자에게 알렸다` : c.team && c.team.token ? '지금 돈다 · 로그인해 두는 것은 관리자' : '아직 로그인하지 않았다 — 관리자가 한다'}</small></span></div>${pcLine}</div>${S.me.admin ? '<div class="cf"><a class="lk" data-a="nav" data-s="admin" data-t="toAdmClaude">관리 › Claude 연결 →</a></div>' : ''}</div>`
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
      return `<li data-t="agentRow" data-name="${esc(f.name)}"><span style="flex:1;min-width:0"><b>${esc(f.name)}</b><small class="muted mono" style="display:block">${esc(f.path)}</small></span>${old ? `<span class="chip c-warn" data-t="agentState">${f.state === 'none' ? '없음 — 다시 붙인다' : '옛 판 — 고침 있음'}</span><small class="muted">${esc(f.ver || '')}</small>` : `<span class="chip c-acc" data-t="agentState">최신 · ${esc(A.latest)}</span>`}<button class="kebab${S.menu === mk ? ' on' : ''}" data-a="menu" data-m="${esc(mk)}" data-t="agentKebab" title="최신으로 · 빼기">⋯${S.menu === mk ? `<div class="menu" style="right:0;top:28px">${old ? `<div class="mi" data-a="agentUp" data-v="${esc(f.path)}" data-t="agentUp">최신으로<small>kmd 덩이만 바꾼다</small></div>` : ''}<div class="mi" data-a="agentRm" data-v="${esc(f.path)}" data-t="agentRm">빼기<small>스킬 · 연결 · kmd 덩이를 걷는다</small></div></div>` : ''}</button></li>`
    }).join('')
    const add = S.agAdding ? `<div class="paste" style="margin-top:10px"><input class="inp mono" id="agIn" data-in="ag" data-t="agIn" value="${esc(S.agDraft || '')}" placeholder="작업 폴더 경로 — 예: D:\\work\\dpms-batch" autocomplete="off"><span id="agBtnBox">${agBtn()}</span></div>` : '<button class="btn pri" data-a="agentAdd" data-t="agentAddBtn" style="margin-top:10px">폴더 더하기</button>'
    return `<div class="card" data-t="agentCard" style="overflow:visible"><div class="ch">에이전트 설치 <small>Claude Code 에 kmd 를 붙인다 — 작업 폴더마다</small><span class="r"><button class="kebab${S.menu === 'agAll' ? ' on' : ''}" data-a="menu" data-m="agAll" data-t="agentAllKebab" title="지금 모두 최신으로">⋯${S.menu === 'agAll' ? `<div class="menu" style="right:0;top:28px"><div class="mi" data-a="agentAllNew" data-t="agentAllNew">지금 모두 최신으로<small>${oldN ? '옛 판 ' + oldN : '모두 최신'}</small></div></div>` : ''}</button></span></div><div class="cb" style="padding:2px 14px 12px">${S.agMsg ? `<div class="callout" data-t="agentMsg">${S.agMsg}</div>` : ''}<ul class="plain" data-t="agentList">${rows || '<li class="muted">아직 붙인 폴더가 없다</li>'}</ul>${add}
   <details class="more" data-t="agentMore"><summary>자세히 — 무엇이 깔리나</summary><div class="in">스킬 둘 — <code>kmd-work</code> · <code>kmd-save</code><br>연결 둘 — 팀 kmd · 이 PC 의 kmd · 열쇠는 이 PC 의 자격 저장소에서 꺼낸다<br>안내 한 덩이 — <code>CLAUDE.md</code> 안 kmd 덩이 · 사람이 고친 줄은 그대로 두고 kmd 덩이만 바꾼다</div></details></div></div>`
  }
  const devs = devicesOf()
  return `<div class="card" data-t="agentCard"><div class="ch">에이전트 설치 <small>Claude Code 에 kmd 를 붙인다</small></div><div class="cb" style="padding:2px 14px 12px"><div class="set"><span class="tx"><b>이 PC 의 Claude Code 로 쓰려면 — 설치 한 줄 복사</b><small>작업 폴더의 터미널에 붙여 넣는다 · 10분 동안 한 번만 · 내 PC 프로그램이 있으면 그 프로그램에 폴더를 더한다</small></span><button class="btn pri" data-a="copyInstall" data-t="copyInstall">설치 한 줄 복사</button></div>
  <div class="rh">내 기기</div><ul class="plain" data-t="agentDevs">${(devs && !devs.error ? devs : []).map((d) => `<li data-t="agentDev" data-name="${esc(d.host || d.id)}"><span style="flex:1"><b>${esc(d.host || '이름 없는 기기')}</b><small class="muted" style="display:block">Claude Code · ${d.used ? '마지막 사용 ' + esc(whenTxt(d.used)) : '이은 때 ' + esc(whenTxt(d.at))}</small></span></li>`).join('') || '<li class="muted">아직 붙인 기기가 없다</li>'}</ul><p class="small muted">기기의 kmd 스킬은 그 기기의 내 PC 프로그램이 최신으로 맞춘다.</p></div></div>`
}
async function agentDo(what, dir) {
  try {
    const r = await postJSON('/api/agent/' + what, dir ? { dir } : {})
    if (what === 'add') { S.agAdding = false; S.agDraft = ''; S.agMsg = r.again ? '<b>이미 붙어 있다 — 최신으로 맞췄다</b>' : `<b>Claude Code 에 kmd 를 붙였다 — 스킬 · 연결 둘 · 안내 한 덩이</b> · ${esc(r.dir)}` }
    else S.agMsg = what === 'rm' ? '<b>뺐다 — 스킬 · 연결 · kmd 덩이를 걷었다</b>' : `<b>최신으로 — ${r.n}곳</b>`
  } catch (e) { S.agMsg = `<b>${esc(e.message)}</b>` }
  S.menu = null
  delete S.cache.agent
  render()
}

// ── 관리(목업 M14) — 문제 줄만 ──
const overviewOf = () => need('admin', '/api/admin/overview')
function viewAdmin() {
  if (!S.me.admin) return { crumb: '관리', main: '<div class="callout gray">관리자만 본다</div>' }
  const a = overviewOf()
  if (!a || a.error) return { crumb: '관리', main: `<div style="max-width:780px"><div class="big">관리</div>${a ? errHtml(a) : loadingHtml}</div>` }
  const rows = []
  if (a.nopw.length) rows.push(`<li class="hot" data-t="adm-nopw"><span class="dot warn"></span><span class="tx"><b>비밀번호를 안 정한 사람 ${a.nopw.length}</b><small>${esc(a.nopw.join(' · '))} — 처음 들어오기 링크를 한꺼번에 만든다</small></span><a class="lk" data-a="admLinks" data-t="admLinks">링크 만들기</a></li>`)
  if (S.admLinks) rows.push(`<li data-t="adm-links"><span class="dot"></span><span class="tx"><b>링크를 만들었다 — 사람마다 따로 보낸다(24시간 · 한 번)</b>${S.admLinks.map((l) => `<small class="mono">${esc(l.id)} — ${esc(l.link)}</small>`).join('')}</span><a class="lk" data-a="admCopyLinks">복사</a></li>`)
  for (const l of a.locked) rows.push(`<li data-t="adm-lock"><span class="dot"></span><span class="tx"><b>${esc(l.user)} · ${l.ip === '*' ? '여러 자리에서' : '다른 자리에서'} 여러 번 틀림 — 잠시 막혔다</b><small>${l.ip === '*' ? '' : esc(l.ip) + ' · '}${esc(hhmmOf(l.until))} 에 저절로 풀린다 · 맞는 사람은 그대로 쓴다</small></span><a class="lk" data-a="admUnlock" data-v="${esc(l.user)}" data-t="admUnlock">풀기</a></li>`)
  for (const r of a.requests.slice(0, 10)) rows.push(`<li data-t="adm-req"><span class="dot pu"></span><span class="tx"><b>${esc(r.by)}이 ${esc(r.name)}를 더해 달라고 했다</b><small>${esc(whenTxt(r.at))} · → ${esc((KN(r.kn) || {}).name || r.kn)} › ${esc((r.rules[0] && r.rules[0].into && r.rules[0].into.doc) || '')} · ${esc(r.at2)}</small></span><a class="lk" data-a="admAddReq" data-id="${esc(r.id)}" data-t="admAddReq">더하기</a></li>`)
  if (a.worker && a.worker.ok === false) rows.push(`<li data-t="adm-rest"><span class="dot warn"></span><span class="tx"><b>자동 정리가 쉬고 있다 · ${Math.max(1, Math.round((Date.now() - Date.parse(a.worker.since)) / 864e5))}일</b><small>${a.worker.reason === 'limit' ? '사용 한도에 닿았다' : '정리 전용 Claude 로그인이 끝났다'} — 아래 「Claude 연결」 에서 다시 로그인 · 그동안은 규칙으로 되는 것만 넣는다</small></span></li>`)
  for (const b of a.backups.filter((x) => x.verdict && x.verdict !== 'ok' && x.verdict !== 'lag')) rows.push(`<li data-t="adm-backup"><span class="dot warn"></span><span class="tx"><b>${esc(b.name)} — 백업과 ${b.verdict === 'behind' ? '백업이 앞섰다' : b.verdict === 'moved' ? '갈라졌다' : '맞지 않는다'}</b><small>어느 쪽이 맞는지 정한다 — 백업이 맞으면 이어 쓰기(지금 것은 가지로 남는다)</small></span><a class="lk" data-a="admAdopt" data-v="${esc(b.name)}">${b.verdict === 'behind' ? '백업에서 받기' : '이 백업 이어 쓰기'}</a></li>`)
  const now = clock().split(' ').pop()
  return { crumb: '관리', main: `<div style="max-width:780px"><div class="big">관리</div><p class="lead">문제가 있을 때만 줄이 선다 — 풀리면 저절로 사라진다.</p>
  <div class="card"><div class="ch">오늘 ${rows.length} <small>${esc(now)}</small></div><ul class="plain pl" data-t="admList">${rows.join('') || '<li class="muted" data-t="admEmpty">오늘은 문제가 없다</li>'}</ul>${a.https ? '' : '<div class="cf">아직 https 가 아니다 — 사내 인증서가 생기면 켤 수 있다</div>'}</div>
  ${admClaudeCard(a)}
  <details class="more" data-t="admMore"><summary>잘 도는 것 — 지식 ${a.kns} · 사람 ${a.people.length} · 자동으로 가져오는 곳 ${a.sources.length} · 자세히</summary><div class="in">
   <div>자동으로 가져오는 곳 — ${a.sources.map((s) => esc(s.name) + ' ' + esc(s.last ? whenTxt(s.last) : '아직')).join(' · ') || '없다'} · <a data-a="nav" data-s="import">자료 가져오기 ›</a></div>
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
  else if (step === 'code') flow = `<div class="flow" data-t="admCode"><p style="margin:0 0 6px"><b>이 주소를 열어 Claude 에 들어가고 받은 번호를 붙여 넣으세요</b></p><div class="path"><span data-t="admUrl">${esc(S.admUrl)}</span><a class="r lk" data-a="admCopyUrl">복사</a></div><div class="paste" style="margin-top:8px"><input class="inp mono" id="admCodeIn" data-in="admCode" data-t="admCodeIn" value="${esc(S.admCode || '')}" placeholder="받은 번호 붙여 넣기" autocomplete="off"><span id="admDoneBox">${admDoneBtn()}</span></div><p class="hint">한 번용 번호 — 저장하지 않는다${a.https ? '' : ' · 아직 https 가 아니다 — 사내 https 뒤 권장'} · <a data-a="admFlowCancel">그만두기</a></p>${S.admErr ? `<div class="callout danger">${esc(S.admErr)}</div>` : ''}</div>`
  const state = rest ? `쉬고 있다 · ${Math.max(1, Math.round((Date.now() - Date.parse(a.worker.since)) / 864e5))}일 — 로그인이 끝났다` : a.claude.token ? '로그인됨 · 정리 전용' : '아직 로그인하지 않았다'
  return `<div class="card" data-t="admClaude"><div class="ch">Claude 연결 <small>정리 전용 로그인 — 팀 서버의 정리 일꾼이 쓴다</small></div><div class="cb" style="padding:2px 14px 10px"><div class="set"><span class="tx"><b data-t="admClaudeState">${state}</b><small>쓰는 곳 — 정해진 정리 · 지금 정리 · 기록 만들기${rest ? ' · 그동안은 규칙으로 되는 것만 넣는다' : ''}</small></span>${step ? '' : `<button class="btn${rest || !a.claude.token ? ' pri' : ''}" data-a="admLoginStart" data-t="admLoginStart">${rest || !a.claude.token ? '로그인 시작' : '다시 로그인'}</button>`}</div>${flow}</div></div>`
}
async function admPwOk() {
  const pw = ($('#admPw') || {}).value || ''
  try {
    await postJSON('/api/sudo', { pw: prehash(S.me.user, pw) })
    S.admErr = null
    S.admStep = 'wait'
    render()
    const r = await postJSON('/api/admin/claude/start', {})
    S.admUrl = r.url
    S.admStep = 'code'
  } catch (e) { S.admErr = e.code === 'E_AUTH' ? '비밀번호를 확인하세요' : e.message; if (S.admStep === 'wait') S.admStep = null }
  render()
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

// ───────────── 이벤트 ─────────────
function openDocAt(k, d, h, q) {
  openTab({ kind: 'doc', kn: k, ref: d, hl: h || null, q: q || null })
  if (h) S._lit = true
  render()
  if (!h) scrollTopMain()
}
const ACT = {
  setTab: (el) => { S.setTab = el.dataset.v; S.menu = null; if (S.route.scr !== 'settings') go({ scr: 'settings' }); else render() },
  toggleAuto: async (el) => { const st = settingsOf(); if (!st) return; try { const r = await postJSON('/api/settings/auto', { key: el.dataset.v, on: !st.auto[el.dataset.v] }); st.auto[r.key] = r.on } catch (e) { toast(esc(e.message)) } render() },
  unlinkMyDev: async (el) => { S.menu = null; try { await postJSON('/api/me/devices/revoke', { id: el.dataset.id }); toast('끊었다 — 그 기기의 Claude Code 는 다시 이어야 한다') } catch (e) { toast(esc(e.message)) } delete S.cache.devices; render() },
  claudeLogin: async () => { S.menu = null; try { await postJSON('/api/claude/login', {}); S.claudeOpening = true; setTimeout(() => { S.claudeOpening = false; delete S.cache.settings; render() }, 60000) } catch (e) { toast(esc(e.message)) } render() },
  claudeOff: async () => { S.menu = null; try { await postJSON('/api/settings/auto', { key: 'claude', on: false }); delete S.cache.settings; toast('Claude 쓰지 않기 — 규칙으로 되는 것만 한다 · 저절로 하는 일에서 다시 켠다') } catch (e) { toast(esc(e.message)) } render() },
  agentAdd: () => { S.agAdding = true; S._focus = 'agIn'; render() },
  agentAddOk: () => agentDo('add', (S.agDraft || '').trim()),
  agentUp: (el) => agentDo('up', el.dataset.v),
  agentRm: (el) => agentDo('rm', el.dataset.v),
  agentAllNew: () => agentDo('up'),
  logout: async () => { await postJSON('/logout', {}).catch(() => {}); try { sessionStorage.removeItem('kmdPair') } catch {} location.href = '/' },
  admLinks: async () => { const a = overviewOf(); if (!a) return; try { S.admLinks = (await postJSON('/api/admin/links', { users: a.nopw })).links; delete S.cache.admin } catch (e) { toast(e.code === 'E_SUDO' ? '비밀번호를 한 번 더 넣는다 — Claude 연결의 「로그인 시작」 처럼' : esc(e.message)) } render() },
  admCopyLinks: () => { copyText((S.admLinks || []).map((l) => l.id + ' ' + l.link).join('\n')); toast('복사했다') },
  admUnlock: async (el) => { try { await postJSON(`/api/admin/users/${encodeURIComponent(el.dataset.v)}/unlock`, {}); delete S.cache.admin; toast('풀었다') } catch (e) { toast(esc(e.message)) } render() },
  admAddReq: async (el) => {
    const r = ((overviewOf() || {}).requests || []).find((x) => x.id === el.dataset.id)
    if (!r) return
    try { await postJSON(`/api/k/${encodeURIComponent(r.kn)}/sources`, { name: r.name, at: r.at2, kind: r.kind, rules: r.rules }); delete S.cache.admin; delete S.cache.sources; toast('더했다 — ' + esc(r.name)) } catch (e) { toast(esc(e.message), 7000) }
    render()
  },
  admAdopt: async (el) => {
    const k = S.kns.find((x) => x.name === el.dataset.v)
    if (!k) return
    try { const b = (overviewOf() || {}).backups.find((x) => x.name === el.dataset.v); await postJSON(`/api/k/${encodeURIComponent(k.id)}/${b && b.verdict === 'behind' ? 'backup/pull' : 'backup/adopt'}`, {}); delete S.cache.admin; forgetKn(k.id); loadStops(); toast('맞췄다 — ' + esc(k.name)) } catch (e) { toast(esc(e.message), 7000) }
    render()
  },
  admLoginStart: () => { S.admStep = 'pw'; S.admErr = null; S._focus = 'admPw'; render() },
  admPwOk: () => admPwOk(),
  admFlowCancel: () => { if (S.admStep === 'code') postJSON('/api/admin/claude/cancel', {}).catch(() => {}); S.admStep = null; S.admErr = null; S.admCode = ''; render() },
  admCopyUrl: () => { copyText(S.admUrl || ''); toast('복사했다') },
  admDone: () => admDone(),
  fetchSrc: (el) => fetchSrc(el.dataset.id),
  fetchAll: async () => { for (const s of (sourcesOf() || {}).items || []) await fetchSrc(s.kn + '|' + s.name) },
  setEvery: async (el, ev) => {
    if (ev.target.closest('[data-stop]')) return
    const [kn, name] = el.dataset.id.split('|'), at = ($('#evAt') || {}).value || '06:00'
    const every = el.dataset.v === 'daily' ? 'daily ' + at : el.dataset.v
    S.menu = null
    try { await postJSON(`/api/k/${encodeURIComponent(kn)}/sources/every`, { name, every }); delete S.cache.sources; toast('언제를 바꿨다 — ' + everyTxt(every)) } catch (e) { toast(esc(e.message)) }
    render()
  },
  addSrc: () => addSrc(false),
  askSrc: () => addSrc(true),
  impGo: (el) => { openTab({ kind: 'doc', kn: el.dataset.k, ref: el.dataset.d }, { view: 'docs' }); render() },
  copyRoot: () => { copyText(pcRoot()); toast('지식 폴더 경로를 복사했다') },
  fillAdd: (el) => { S.addDraft = el.dataset.v; S.addMsg = null; S._focus = 'addIn'; render() },
  addToImport: () => { S.srcDraft = S.addDraft; S.addDraft = ''; go({ scr: 'import' }) },
  doAdd: () => doAdd(),
  dropSend: async (el) => { S.menu = null; await postJSON(`/api/k/${encodeURIComponent(el.dataset.k)}/send/drop`, { path: el.dataset.p, on: false }).catch((e) => toast(esc(e.message))); delete S.cache['send:' + el.dataset.k]; S.kns = await getJSON('/api/knowledge'); render() },
  undropSend: async (el) => { await postJSON(`/api/k/${encodeURIComponent(el.dataset.k)}/send/drop`, { path: el.dataset.p, on: true }).catch((e) => toast(esc(e.message))); delete S.cache['send:' + el.dataset.k]; S.kns = await getJSON('/api/knowledge'); render() },
  addCand: (el) => { const c = (S.cand || []).find((x) => x.record === el.dataset.id); if (c) c.on = true; render() },
  doSend: () => doSend(),
  setDests: async (el) => {
    const k = el.dataset.k, raw = ($('#dest-' + CSS.escape(k)) || {}).value || ''
    const dests = raw.split(/[,\s]+/).filter(Boolean).map((x) => { const m = x.match(/^(https?:\/\/[^/]+)(?:\/r)?\/([^/?#]+)/i); return m ? { kn: decodeURIComponent(m[2]).replace(/_wiki$/i, ''), url: m[1] } : { kn: x } })
    try { await postJSON(`/api/k/${encodeURIComponent(k)}/send/dests`, { dests }); S.kns = await getJSON('/api/knowledge'); delete S.cache['send:' + k]; toast(dests.length ? '보낼 곳을 정했다 — 이제부터 고친 것이 모인다' : '보낼 곳을 뺐다') } catch (e) { toast(esc(e.message)) }
    render()
  },
  toggleToday: (el) => { S.openToday = S.openToday === el.dataset.id ? null : el.dataset.id; render() },
  todayGo: (el) => { const x = (S.cache.today || []).find((e) => e.id === el.dataset.id); if (x && x.go) { openTab({ kind: 'doc', kn: x.go.kn, ref: x.go.doc, hl: x.go.hl || null }, { view: 'docs' }); if (x.go.hl) S._lit = true; render() } },
  revertToday: async (el) => {
    const x = (S.cache.today || []).find((e) => e.id === el.dataset.id)
    if (!x) return
    try { await postJSON(`/api/k/${encodeURIComponent(x.kn)}/revert`, { record: x.revert }); x.reverted = true; forgetKn(x.kn); delete S.cache['tidy:' + x.kn]; toast('되돌렸다 — 넣기 전 글로 · 그 기록은 다시 문서 옆에 같이 읽힌다'); render() } catch (e) { toast(esc(e.message)) }
  },
  unlinkDev: async (el) => {
    const x = (S.cache.today || []).find((e) => e.id === el.dataset.id)
    if (!x) return
    try { await postJSON('/api/me/devices/revoke', { id: x.device }); x.unlinked = true; toast('끊었다 — 그 기기의 Claude Code 는 다시 이어야 한다'); render() } catch (e) { toast(esc(e.message)) }
  },
  tidyNow: (el) => tidyNow(el.dataset.k || tidyKn()),
  toggleRun: (el) => { const cur = S.runOpen[el.dataset.id]; const ri = Number(el.dataset.id.split(':').pop()); S.runOpen[el.dataset.id] = !(cur !== undefined ? cur : ri === 0); render() },
  cmpRow: (el) => { S.cmp = S.cmp === el.dataset.id ? null : el.dataset.id; S.menu = null; render() },
  revertRow: async (el) => {
    const k = tidyKn(), [ri, i] = el.dataset.id.split(':').map(Number), row = S.cache['tidy:' + k]?.runs?.[ri]?.rows?.[i]
    if (!row || !row.record) return
    try { await postJSON(`/api/k/${encodeURIComponent(k)}/revert`, { record: row.record }); forgetKn(k); delete S.cache['tidy:' + k]; S.menu = null; toast('되돌렸다 — 그 줄만 넣기 전으로'); render() } catch (e) { toast(esc(e.message)) }
  },
  setTidyAt: (el) => setOwnerRow(tidyKn(), { tidyAt: el.dataset.v }),
  toggleNoClaude: () => { const r = S.cache['owner:' + tidyKn()] || {}; setOwnerRow(tidyKn(), { noClaude: !r.noClaude }) },
  togglePicker: () => { S.picker = !S.picker; render() },
  addCur: (el) => { const r = S.cache['owner:' + tidyKn()] || {}; S.picker = false; setOwnerRow(tidyKn(), { curators: [...new Set([...(r.curators || []), el.dataset.v])] }) },
  rmCur: (el) => { const r = S.cache['owner:' + tidyKn()] || {}; setOwnerRow(tidyKn(), { curators: (r.curators || []).filter((c) => c !== el.dataset.v) }) },
  editDoc: () => { const t = activeTab(); if (t) { S.edit = { tab: t.id, kn: t.kn, doc: t.ref }; S._focus = 'edTx'; render() } },
  cancelEdit: () => { S.edit = null; render() },
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
  nav: (el) => go({ scr: el.dataset.s }),
  kmenu: () => { S.menu = S.menu === 'kmenu' ? null : 'kmenu'; render() },
  pickKn: (el, ev) => { ev.stopPropagation(); S.menu = null; const k = el.dataset.k; if (k === '*') go({ scr: 'home', kn: '*' }); else go({ scr: KNSCR.includes(S.route.scr) ? S.route.scr : 'docs', kn: k }) },
  openKn: (el) => { if (el.classList.contains('dim')) { toast('내 PC 프로그램이 꺼져 있다 — 켜면 저절로 다시 열린다'); return } go({ scr: 'docs', kn: el.dataset.k }) },
  pcAllow: () => pcAllow(),
  pairOk: (el) => pairOk(el.dataset.v),
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
  if (k === 'itemQ') { S.iq = t.value; $('#itemListBody').innerHTML = itemListBody(S.route.kn) }
  if (k === 'gQ') { S.g.f.q = t.value; gHighlight() }
  if (k === 'ag') { S.agDraft = t.value; $('#agBtnBox').innerHTML = agBtn() }
  if (k === 'admCode') { S.admCode = t.value; $('#admDoneBox').innerHTML = admDoneBtn() }
  if (k === 'src') { S.srcDraft = t.value; const h = srcHeard(); $('#srcHeardBox').innerHTML = h.heard; $('#srcBtnBox').innerHTML = h.btn }
  if (k === 'add') { S.addDraft = t.value; const h = addHeard(); $('#addHeardBox').innerHTML = h.heard; $('#addBtnBox').innerHTML = h.btn; const m = $('[data-t=addMsg]'); if (m) { S.addMsg = null; m.remove() } }
})
// 파일 · 폴더 — 고르기 · 끌어다 놓기
document.addEventListener('change', (ev) => { const t = ev.target; if (t.id === 'fileIn' || t.id === 'dirIn') { takeFiles(t.files); t.value = '' } })
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
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'addIn') { ev.preventDefault(); doAdd() }
  if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'srcIn') { ev.preventDefault(); const b = $('#srcBtnBox button'); if (b && !b.disabled) b.click() }
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
  if (isTeam()) await pcConnect()
  const hm = location.hash.match(/^#(~[^/]+)\/(.+)$/)
  if (hm && KN(decodeURIComponent(hm[1]))) { openTab({ kind: 'doc', kn: decodeURIComponent(hm[1]), ref: decodeURIComponent(hm[2]) }, { view: 'docs' }) }
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
    } else if (location.pathname === '/pair') {
      S.pairPage = true
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
