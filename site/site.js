// kmd 소개 사이트: 빌드 없는 바닐라 JS. 자료는 data/story.js(site/demo/run.mjs 가 만든다)
(() => {
  'use strict'
  const S = window.KMD_STORY
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const NS = 'http://www.w3.org/2000/svg'
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const narrow = () => innerWidth <= 600
  const onSee = (node, fn, threshold = 0.4) => new IntersectionObserver((es, ob) => { if (es[0].isIntersecting) { ob.disconnect(); fn() } }, { threshold }).observe(node)

  // ── 밝기 ──
  const dark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches }
  const setShots = () => { const m = dark() ? 'dark' : 'light'; document.querySelectorAll('img[data-shot]').forEach((i) => { const u = `shots/${i.dataset.shot}-${m}.png`; if (i.getAttribute('src') !== u) i.src = u }) }
  $('#themeBtn').addEventListener('click', () => {
    const t = dark() ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('kmd-site-theme', t) } catch {}
    setShots()
  })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setShots)

  // ── 글 조각: 기록 본문(## 머리 · - 줄 · 문단)만 ──
  const md = (body, h = 'h5') => {
    let out = '', list = false
    for (const line of String(body || '').split('\n')) {
      const l = line.trim()
      if (l.startsWith('- ')) { if (!list) { out += '<ul>'; list = true } out += `<li>${esc(l.slice(2))}</li>`; continue }
      if (list) { out += '</ul>'; list = false }
      if (!l) continue
      out += l.startsWith('## ') ? `<${h}>${esc(l.slice(3))}</${h}>` : `<p>${esc(l)}</p>`
    }
    return out + (list ? '</ul>' : '')
  }
  const strip = (t) => String(t || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*#]/g, '')
  const docOf = (title) => S.docs.find((d) => d.title === title)
  const secOf = (label) => { for (const d of S.docs) { const s = d.sections.find((x) => x.h === label); if (s) return { d, s } } return null }
  const step = (key) => S.steps.find((x) => x.key === key)
  const piecesOf = (st) => (st.key === 'edit' ? [{ coord: `proc:${st.heading}`, from: st.from, to: st.to }] : st.sections || [])
  const namesOf = (st) => piecesOf(st).map((x) => x.coord.split(':')[1])
  const isWarn = (st) => !!(st.result && st.result.accepted && st.result.accepted.length)
  const UNATTENDED = new Set(['commit', 'file'])

  // ── 지식 지도: 문서 넷 · 항목 · 링크(크게) / 걸음마다 바뀐 곳(작게) ──
  const DOC_AREA = { '첫 주 안내': 'a', '계정 발급': 'b', '장비': 'c', '연락처': 'd' }
  const WEEK = new Set(S.steps.flatMap(namesOf))
  // state: Map(항목 → { cls, em })
  function mapHtml(state, mini) {
    const docs = [...S.docs].sort((a, b) => (DOC_AREA[a.title] || 'z').localeCompare(DOC_AREA[b.title] || 'z'))
    return `<div class="km-grid">${docs.map((d) => `<div class="card km-doc" data-doc="${esc(d.title)}" style="grid-area:${DOC_AREA[d.title] || 'auto'}"><h4>${esc(d.title)}</h4><ul class="km-its">${d.sections.map((s) => {
      const st = state && state.get(s.h)
      return `<li class="km-it${st ? ' ' + st.cls : ''}" data-h="${esc(s.h)}">${esc(s.h)}${st && st.em ? `<em>${esc(st.em)}</em>` : !mini && WEEK.has(s.h) ? '<span class="w" title="이번 주에 바뀐다"></span>' : ''}</li>`
    }).join('')}</ul></div>`).join('')}</div><svg class="km-lines" aria-hidden="true"></svg>`
  }
  function mapLines(root) {
    const svg = root.querySelector('.km-lines'); if (!svg) return
    svg.innerHTML = ''
    if (narrow()) return
    const box = root.getBoundingClientRect()
    const R = (t) => { const e = root.querySelector(`[data-doc="${t}"]`); return e && e.getBoundingClientRect() }
    for (const e of S.graph.edges.filter((x) => x.t === 'link')) {
      const a = R(e.a.slice(2)), b = R(e.b.slice(2)); if (!a || !b) continue
      let x0, y0, x1, y1
      if (b.left > a.right - 4) { x0 = a.right - box.left; y0 = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2 - box.top; x1 = b.left - box.left; y1 = y0 }
      else { x0 = a.left + a.width / 2 - box.left; y0 = a.bottom - box.top; x1 = b.left + b.width / 2 - box.left; y1 = b.top - box.top }
      if (Math.abs(y1 - y0) < 2 && !(b.top < a.bottom && b.bottom > a.top)) y0 = y1 = (a.top + a.bottom) / 2 - box.top
      const mx = (x0 + x1) / 2
      el('path', { d: x1 > x0 + 4 ? `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1 - 2},${y1}` : `M${x0},${y0} L${x1},${y1 - 2}` }, svg)
      const t = el('text', { class: 'lb', x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 6, 'text-anchor': 'middle' }, svg); t.textContent = '링크'
    }
  }
  function kmap() {
    const root = $('#kmap')
    root.innerHTML = mapHtml(null, false)
    const draw = () => mapLines(root)
    draw(); addEventListener('resize', draw); addEventListener('load', draw)
  }

  // ── 개념: 기록 하나 → 항목 둘 ──
  function anatomy() {
    const st = step('session'), d = docOf('첫 주 안내')
    const hits = new Set(namesOf(st))
    $('#anRec').innerHTML = `<h4>${esc(st.title)}</h4><div class="md">${md(st.body)}</div>`
    $('#anDoc').innerHTML = `<h4>${esc(d.title)}</h4>` +
      d.sections.map((s) => `<div class="an-sec${hits.has(s.h) ? ' hit' : ''}" data-h="${esc(s.h)}"><b>${esc(s.h)}</b><span>${esc(strip(s.body))}</span></div>`).join('')
    const draw = () => {
      const svg = $('#anLines'); svg.innerHTML = ''
      if (narrow()) return
      const box = $('#anatomy').getBoundingClientRect(), rec = $('#anRec').getBoundingClientRect()
      const x0 = rec.right - box.left, y0 = rec.top - box.top + 40
      document.querySelectorAll('.an-sec.hit').forEach((sec, i) => {
        const r = sec.getBoundingClientRect(), x1 = r.left - box.left, y1 = r.top - box.top + r.height / 2
        const ya = y0 + i * 26, mx = (x0 + x1) / 2
        el('path', { d: `M${x0},${ya} C${mx},${ya} ${mx},${y1} ${x1 - 6},${y1}` }, svg)
        el('circle', { cx: x0, cy: ya, r: 3.5 }, svg)
        el('circle', { cx: x1 - 4, cy: y1, r: 3.5 }, svg)
      })
    }
    draw(); addEventListener('resize', draw); addEventListener('load', draw)
  }

  // ── 이야기: 시간 줄 + 흐름 그림 + 걸음 ──
  const CHANNELS = [['session', '세션', 'Claude Code'], ['edit', '화면 고치기', '팀 화면'], ['send', '공유', '개인 → 팀'], ['bulk', '대량 넣기', 'Claude Code'], ['file', '수기수집', '팀 일꾼'], ['commit', '자동수집', 'git · 폴더 · DB']]
  const chOf = (key) => (key === 'warn' ? 'session' : key)
  const SHOT_OF = { session: ['rec', '세션이 남긴 기록: 요약 · 바뀐 것 · 까닭'], commit: ['history', '이력: 시간 줄에 저장 · 들이기 · 고침'], file: ['import', '생성 › 수기수집: 파일을 놓으면 팀 일꾼이 기록과 항목 글을 짓는다'], edit: ['propose', '저장 확인 창: 바뀐 줄 · 경고 · [넣기] 가 승인'], send: ['item', '노트북 받기 항목: 오른쪽 기둥에 이 항목을 바꾼 기록'], warn: ['check', '점검 › 지표: 받아들인 경고 · 규칙 길을 기간으로 센다'] }
  let flow = null
  function flowDraw() {
    const svg = $('#flowSvg'); svg.innerHTML = ''
    const N = narrow()
    const W = N ? 360 : 900, H = N ? 470 : 300
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const g = { ch: {}, out: {} }
    const wires = el('g', {}, svg)
    CHANNELS.forEach(([k, l, s], i) => {
      const x = N ? (i % 2 ? 190 : 20) : 20, y = N ? 14 + Math.floor(i / 2) * 46 : 16 + i * 46, w = 150, h = 36
      const gg = el('g', { class: 'ch' }, svg)
      el('rect', { x, y, width: w, height: h, rx: 8 }, gg)
      const t = el('text', { x: x + 12, y: y + 23 }, gg); t.textContent = l
      if (!N) { const t2 = el('text', { x: x + w - 10, y: y + 23, 'text-anchor': 'end', style: 'font-weight:400;font-size:10.5px;opacity:.75' }, gg); t2.textContent = s }
      g.ch[k] = { gg, ax: N ? x + w / 2 : x + w, ay: N ? y + h : y + h / 2 }
    })
    const gx = N ? 60 : 330, gy = N ? 170 : 40, gw = N ? 240 : 230, gh = N ? 132 : 220
    const gate = el('g', { class: 'gate' }, svg)
    el('rect', { x: gx, y: gy, width: gw, height: gh, rx: 12 }, gate)
    const tt = el('text', { x: gx + gw / 2, y: gy + 28, 'text-anchor': 'middle' }, gate); tt.textContent = '저장 문: 한 덩이로 판정'
    const checks = N ? ['사람: 저장 제안 → 승인', '무인: 규칙 길까지 늘 들어감', '자리 · 꼴 · 지문(base)', '→ 기록 + 항목 글 · git 한 묶음'] : ['사람: 저장 제안 → 승인', '무인: FIX 고리 → 규칙 길', '자리 · 꼴(E_FORMAT) · 지문(base)', '값 대조: 근거 없는 값은 경고', '경고는 승인하면 「받아들인 경고」', '→ 기록 + 항목 글 · git 한 묶음']
    checks.forEach((c, i) => { const t = el('text', { x: gx + 18, y: gy + 54 + i * (N ? 20 : 26), class: 'chk' }, gate); t.textContent = c })
    const OUT = [['rec', '기록', 'work/<id>.md · 바뀐 것 · 까닭'], ['doc', '문서 · 항목', '항목 글이 그 자리에 들어간다'], ['err', '입력 오류', '아무것도 쓰지 않음 · 고쳐 다시']]
    OUT.forEach(([k, l, s], i) => {
      const x = N ? 6 + i * 118 : 680, y = N ? 360 : 30 + i * 90, w = N ? 112 : 200, h = N ? 64 : 62
      const gg = el('g', { class: 'out ' + k }, svg)
      el('rect', { x, y, width: w, height: h, rx: 10 }, gg)
      const t = el('text', { x: x + 12, y: y + 26 }, gg); t.textContent = l
      if (!N) { const t2 = el('text', { x: x + 12, y: y + 46, class: 's' }, gg); t2.textContent = s }
      g.out[k] = { gg, bx: N ? x + w / 2 : x, by: N ? y : y + h / 2 }
    })
    const inX = N ? gx + gw / 2 : gx, inY = N ? gy : gy + gh / 2, outX = N ? gx + gw / 2 : gx + gw, outY = N ? gy + gh : gy + gh / 2
    for (const k in g.ch) {
      const c = g.ch[k]
      const d = N ? `M${c.ax},${c.ay} C${c.ax},${c.ay + 24} ${inX},${inY - 24} ${inX},${inY}` : `M${c.ax},${c.ay} C${c.ax + 80},${c.ay} ${inX - 80},${inY} ${inX},${inY}`
      c.wire = el('path', { d, class: 'wire' }, wires)
    }
    for (const k in g.out) {
      const o = g.out[k]
      const d = N ? `M${outX},${outY} C${outX},${outY + 30} ${o.bx},${o.by - 30} ${o.bx},${o.by}` : `M${outX},${outY} C${outX + 60},${outY} ${o.bx - 60},${o.by} ${o.bx},${o.by}`
      o.wire = el('path', { d, class: 'wire' + (k === 'err' ? ' err' : '') }, wires)
    }
    g.dots = el('g', {}, svg)
    flow = g
  }
  let dotRaf = 0
  function flowShow(key) {
    if (!flow) return
    cancelAnimationFrame(dotRaf)
    const c = chOf(key), outs = ['rec', 'doc']
    for (const k in flow.ch) { const on = k === c; flow.ch[k].gg.classList.toggle('on', on); flow.ch[k].wire.classList.toggle('on', on) }
    for (const k in flow.out) { const on = outs.includes(k); flow.out[k].gg.classList.toggle('on', on); flow.out[k].wire.classList.toggle('on', on) }
    flow.dots.innerHTML = ''
    if (reduce) return
    const a = flow.ch[c].wire, la = a.getTotalLength()
    const legs = outs.map((k) => ({ p: flow.out[k].wire, l: flow.out[k].wire.getTotalLength() }))
    const dots = legs.map(() => el('circle', { r: 5, class: 'dot' }, flow.dots))
    const T = 2600, t0 = performance.now()
    const tick = (now) => {
      const t = ((now - t0) % (T + 600)) / T
      dots.forEach((d, i) => {
        let pt
        if (t <= 0.5) pt = a.getPointAtLength(la * (t / 0.5))
        else if (t <= 1) pt = legs[i].p.getPointAtLength(legs[i].l * ((t - 0.5) / 0.5))
        else { d.setAttribute('opacity', 0); return }
        d.setAttribute('opacity', 1); d.setAttribute('cx', pt.x); d.setAttribute('cy', pt.y)
      })
      dotRaf = requestAnimationFrame(tick)
    }
    dotRaf = requestAnimationFrame(tick)
  }
  const diffHtml = (from, to) => {
    let a = 0; while (a < from.length && a < to.length && from[a] === to[a]) a++
    let b = 0; while (b < from.length - a && b < to.length - a && from[from.length - 1 - b] === to[to.length - 1 - b]) b++
    return `${esc(from.slice(0, a))}${from.length - a - b > 0 ? `<del>${esc(from.slice(a, from.length - b))}</del>` : ''}${to.length - a - b > 0 ? `<ins>${esc(to.slice(a, to.length - b))}</ins>` : ''}${esc(from.slice(from.length - b))}`
  }
  // 걸음 i 까지 바뀐 곳: 이번 걸음(now · warn) · 앞 걸음(done · 요일)
  function weekState(i) {
    const m = new Map()
    S.steps.slice(0, i).forEach((st) => namesOf(st).forEach((n) => m.set(n, { cls: 'done', em: st.day + ' ✓' })))
    const st = S.steps[i]
    namesOf(st).forEach((n) => m.set(n, isWarn(st) ? { cls: 'warn', em: '받아들인 경고' } : { cls: 'now', em: '지금' }))
    return m
  }
  let cur = 0, auto = null
  const DUR = 8000
  const stop = () => { clearInterval(auto); auto = null; document.querySelectorAll('#stepTabs .pbar').forEach((p) => p.classList.remove('run')) }
  function stepShow(i, user) {
    cur = i
    const st = S.steps[i], warn = isWarn(st)
    document.querySelectorAll('#stepTabs button').forEach((b, j) => {
      b.setAttribute('aria-selected', j === i); b.tabIndex = j === i ? 0 : -1
      b.classList.toggle('done', j < i)
      const p = b.querySelector('.pbar'); p.classList.remove('run'); if (j === i && auto && !user) { void p.offsetWidth; p.classList.add('run') }
    })
    flowShow(st.key)
    const pieces = piecesOf(st)
    const diffs = pieces.map((x) => { const name = x.coord.split(':')[1], where = secOf(name); return `<div class="card diff${warn ? ' warn' : ''}"><div class="h">${esc(name)} <code>${esc(x.coord)}</code><span class="chip">${esc(where ? where.d.title : '')}</span></div><div>${diffHtml(x.from, x.to)}</div></div>` }).join('')
    const src = st.file ? `<div class="src">📄 ${esc(st.file)}</div>` : st.commit ? `<div class="src">⎇ ${esc(st.commit)}</div>` : ''
    const rec = st.key === 'edit' ? `<div class="card recbox"><div class="t">화면에서 고침: ${esc(st.doc)} 「${esc(st.heading)}」</div><p>쓰기 자리부터 고친다. [저장] 을 누르면 저장 확인 창(저장 제안: 바뀐 줄 · 경고)이 뜨고 [넣기] 가 승인이다. 이력에 「고침」, 옛 값 → 새 값이 남는다.</p></div>` : `<div class="card recbox"><div class="t">${esc(st.title)}</div>${md(st.body)}</div>`
    const how = UNATTENDED.has(st.key) ? (st.result && st.result.rule ? '무인 · 규칙 길' : '무인 · 승인 없이') : st.key === 'send' ? '보내기 확인 창 = 팀 저장 제안 → [보내기] 승인' : st.key === 'edit' ? '저장 확인 창 → [넣기] 승인' : '저장 제안 → 「좋아, 넣어」 승인'
    const result = warn ? `<span class="chip warn">받아들인 경고</span> ${esc(st.result.accepted.join(' · '))}. 승인해 들어갔고, 기록 끝 「받아들인 경고」 에 남아 점검 › 지표가 센다.` : `<span class="chip ok">들어감</span> 항목 ${pieces.length} · 기록 · git 한 묶음 · ${esc(how)}`
    const [shot, cap] = SHOT_OF[st.key]
    const [capT, capD] = cap.split(': ')
    const panel = $('#stepPanel')
    panel.setAttribute('aria-labelledby', 'tab-' + st.key)
    panel.innerHTML = `<p class="why${warn ? ' warn' : ''}"><span class="dy">${esc(st.day)}요일 · ${esc(st.ch)}</span><span>${esc(st.why || '')}</span></p>
      <div class="st-left"><p class="st-h">어디가 바뀌었나</p><div class="kmap mini">${mapHtml(weekState(i), true)}</div>
        <p class="st-h">무엇이 바뀌었나</p><div class="diffs">${diffs}</div><p class="result">${result}</p></div>
      <div class="st-right"><p class="st-h">누가 · 어느 길로</p><p class="who"><span class="av">${esc(st.who.replace('test-', '').slice(0, 2))}</span><b>${esc(st.who)}</b><span class="chip">${esc(st.role)}</span><span class="chip acc">${esc(st.via)}</span></p>${src}${rec}
        <figure class="frame"><div class="bar"><i></i><i></i><i></i><span>${esc(capT)}</span></div><button type="button" class="zoom" data-zoom="${shot}"><img data-shot="${shot}" alt="${esc(cap)}" width="1280" height="800"></button><figcaption>${esc(capD || capT)}</figcaption></figure></div>`
    setShots()
  }
  function story() {
    const tabs = $('#stepTabs')
    tabs.innerHTML = S.steps.map((st, i) => `<button type="button" role="tab" id="tab-${st.key}" aria-controls="stepPanel" data-i="${i}" class="${isWarn(st) ? 'warn-k' : ''}"><span class="dot">${esc(st.day)}</span><span class="c">${esc(st.ch)}</span><span class="i">${esc(namesOf(st)[0])}</span><i class="pbar" style="--dur:${DUR}ms"></i></button>`).join('')
    tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; stop(); stepShow(+b.dataset.i, true) })
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault(); stop()
      const n = (cur + (e.key === 'ArrowRight' ? 1 : S.steps.length - 1)) % S.steps.length
      stepShow(n, true); tabs.children[n].focus()
    })
    $('#stepPanel').addEventListener('pointerdown', () => stop())
    flowDraw(); stepShow(0, true)
    let wasNarrow = narrow()
    addEventListener('resize', () => { if (narrow() !== wasNarrow) { wasNarrow = narrow(); flowDraw(); flowShow(S.steps[cur].key) } })
    if (!reduce) onSee($('#stepTabs'), () => {
      auto = setInterval(() => { if (cur === S.steps.length - 1) { stop(); return } stepShow(cur + 1) }, DUR)
      stepShow(cur)
    }, 0.9)
  }

  // ── 찾아가기 ──
  const FIND = [
    ['home', 'list', '모든 지식', '지식관리 › 모든 지식', '자리를 받은 지식만 카드로 선다. 카드에 내 자리 · 문서 수 · 점검이 붙는다.'],
    ['search', 'find', '찾기 「노트북」', '찾기 <kbd>Ctrl</kbd> <kbd>K</kbd> 「노트북」', '이름이 맞는 항목(노트북 받기 · 반납 · 사양)이 먼저, 그다음 비슷한 글이 항목 단위로 나온다.'],
    ['item', 'item', '항목', '항목 「노트북 받기」', '글은 지금 값만. 오른쪽 기둥을 펴면 이 항목이 든 문서와, 이 항목을 바꾼 기록(월요일 세션 · 금요일 공유)이 보인다.'],
    ['rec', 'rec', '기록', '기록: 왜 바뀌었나', '요약 · 바뀐 것 · 까닭과 넣은 항목. 「월요일 온보딩 회의에서 정했다」 가 출처다.'],
    ['doc', 'doc', '문서', '문서 「첫 주 안내」', '책상 위 종이에 확정된 지식만 읽힌다. 경위는 본문에 섞지 않고 문서 끝 참고 블록에 출처로 남는다.'],
  ]
  function finder() {
    const ol = $('#findSteps'), path = $('#findPath')
    path.innerHTML = FIND.map(([, sh, short], i) => `<li><button type="button" data-i="${i}"><span class="sh ${sh}" aria-hidden="true"></span>${esc(short)}</button></li>`).join('')
    ol.innerHTML = FIND.map(([, , , t, d], i) => `<li><button type="button" data-i="${i}"><span class="n">${i + 1}</span><span><b>${t}</b><span class="d">${esc(d)}</span></span></button></li>`).join('')
    const img = $('#findImg')
    const show = (i) => {
      const [shot, , , t, d] = FIND[i]
      for (const list of [ol, path]) list.querySelectorAll('button').forEach((b, j) => (j === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')))
      img.classList.add('fade')
      setTimeout(() => { img.dataset.shot = shot; img.alt = t.replace(/<[^>]+>/g, ''); $('#findZoom').dataset.zoom = shot; setShots(); img.onload = () => img.classList.remove('fade'); if (img.complete) img.classList.remove('fade') }, reduce ? 0 : 160)
      $('#findBar').textContent = t.replace(/<[^>]+>/g, '')
      $('#findCap').textContent = d
    }
    for (const list of [ol, path]) list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i) })
    show(0)
  }

  // ── 그래프 ──
  function graph() {
    const N = S.graph.nodes.map((n) => ({ ...n })), E = S.graph.edges.map((e) => ({ ...e }))
    const byId = new Map(N.map((n) => [n.id, n]))
    const recOf = (k) => N.find((n) => n.step === k)
    const warnRec = N.find((n) => n.warn)
    const nbr = new Map(N.map((n) => [n.id, new Set()]))
    E.forEach((e) => { nbr.get(e.a).add(e.b); nbr.get(e.b).add(e.a) })
    const svg = $('#gSvg')
    let W, H
    function layout() {
      const N0 = narrow() || svg.parentElement.clientWidth < 560
      W = N0 ? 440 : 800; H = N0 ? 600 : 550
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.aspectRatio = `${W}/${H}`
      const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967296 }
      N.forEach((n, i) => { const a = (i / N.length) * Math.PI * 2 + hash(n.id), r = 60 + hash(n.id + 'r') * 120; n.x = W / 2 + Math.cos(a) * r; n.y = H / 2 + Math.sin(a) * r; n.vx = 0; n.vy = 0 })
      const L = { in: 72, touch: 96, link: 170 }
      for (let it = 0; it < 500; it++) {
        const cool = 1 - it / 500
        for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
          const a = N[i], b = N[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.01
          const f = 5200 / d2; const d = Math.sqrt(d2); dx /= d; dy /= d
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f
        }
        for (const e of E) {
          const a = byId.get(e.a), b = byId.get(e.b); const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1
          const f = (d - L[e.t]) * 0.04; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
        }
        for (const n of N) {
          n.vx += (W / 2 - n.x) * 0.006; n.vy += (H / 2 - n.y) * 0.006
          const s = Math.hypot(n.vx, n.vy) || 1, m = Math.min(1, s)
          n.x += (n.vx / s) * m * 6 * cool + n.vx * 0.05 * cool; n.y += (n.vy / s) * m * 6 * cool + n.vy * 0.05 * cool
          n.vx *= 0.5; n.vy *= 0.5
          n.x = Math.max(56, Math.min(W - 56, n.x)); n.y = Math.max(44, Math.min(H - 24, n.y))
        }
      }
    }
    const KIND = { doc: '문서', item: '항목', rec: '기록' }
    const els = new Map(), eEls = []
    function render() {
      svg.innerHTML = ''
      const ge = el('g', {}, svg), gn = el('g', {}, svg)
      eEls.length = 0
      for (const e of E) {
        const a = byId.get(e.a), b = byId.get(e.b)
        const l = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `ge ${e.t} off` }, ge)
        l.style.setProperty('--len', Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)))
        eEls.push({ e, l })
      }
      for (const n of N) {
        const g = el('g', { class: `gn ${n.kind}${n.warn ? ' warn' : ''} off`, tabindex: 0, role: 'button', 'aria-label': `${KIND[n.kind]} ${n.label}` }, gn)
        el('circle', { class: 'gring', cx: n.x, cy: n.y, r: 10 }, g)
        const sh = n.kind === 'doc' ? el('rect', { class: 'shape', x: n.x - 8, y: n.y - 8, width: 16, height: 16, rx: 3 }, g)
          : n.kind === 'item' ? el('circle', { class: 'shape', cx: n.x, cy: n.y, r: 7 }, g)
          : el('polygon', { class: 'shape', points: `${n.x},${n.y - 8} ${n.x + 8},${n.y} ${n.x},${n.y + 8} ${n.x - 8},${n.y}` }, g)
        sh.style.transformOrigin = `${n.x}px ${n.y}px`
        const right = n.x < W * 0.62
        const t = el('text', { x: n.x + (right ? 13 : -13), y: n.y + 4, 'text-anchor': right ? 'start' : 'end' }, g)
        const st = n.step && step(n.step)
        const lab = st ? `${st.day} ${n.label}` : n.label
        t.textContent = lab.length > 17 ? lab.slice(0, 16) + '…' : lab
        g.addEventListener('click', () => { stopTour(); expand(n.id) })
        g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); stopTour(); expand(n.id) } })
        els.set(n.id, g)
      }
      paint(false)
    }
    let vis = new Set(), focus = null
    function paint(anim = true) {
      for (const [id, g] of els) { g.classList.toggle('off', !vis.has(id)); g.classList.toggle('focus', id === focus) }
      for (const { e, l } of eEls) {
        const on = vis.has(e.a) && vis.has(e.b)
        if (on && l.classList.contains('off') && anim && !reduce) { l.classList.remove('draw'); void l.getBoundingClientRect(); l.classList.add('draw') }
        l.classList.toggle('off', !on)
        l.classList.toggle('hot', on && !!focus && (e.a === focus || e.b === focus))
      }
      card(focus)
    }
    function card(id) {
      const n = id && byId.get(id), box = $('#gCard')
      if (!n) { box.innerHTML = `<span class="k">점 ${vis.size} / ${N.length}</span><b>${esc(S.name)}</b><p>문서 ${N.filter((x) => x.kind === 'doc').length} · 항목 ${N.filter((x) => x.kind === 'item').length} · 기록 ${N.filter((x) => x.kind === 'rec').length}</p>`; return }
      let k = KIND[n.kind], p = ''
      if (n.kind === 'item') { const w = secOf(n.label); k += ` · ${n.coord || ''}`; p = w ? `${w.d.title} › ${strip(w.s.body)}` : '' }
      else if (n.kind === 'doc') { const d = docOf(n.label); p = d ? strip(d.intro.split('\n').pop()) : '' }
      else { const st = n.step && step(n.step); k += st ? ` · ${st.day}요일 · ${st.ch}${n.warn ? ' · 받아들인 경고' : ''}` : ''; p = st ? st.why || '' : '' }
      box.innerHTML = `<span class="k">${esc(k)}</span><b>${esc(n.label)}</b><p>${esc(p.slice(0, 160))}</p>`
    }
    function expand(id) { vis.add(id); nbr.get(id).forEach((x) => vis.add(x)); focus = id; paint() }
    function expandQ(id) { if (!id) return; vis.add(id); nbr.get(id).forEach((x) => vis.add(x)); focus = id }
    const sess = recOf('session'), sent = recOf('send'), mail = recOf('commit'), vpn = recOf('file')
    const TOUR = [
      ['찾기 「노트북」 → 항목 「노트북 받기」', () => { vis = new Set(['i:proc:노트북 받기']); focus = 'i:proc:노트북 받기' }],
      ['이웃 한 겹: 든 문서와 바꾼 기록 둘', () => expandQ('i:proc:노트북 받기')],
      ['월요일 기록을 누르면: 같이 바뀐 「입사 전날」', () => expandQ(sess && sess.id)],
      ['문서 링크를 따라 계정 발급으로: 화요일 커밋', () => { expandQ('d:첫 주 안내'); expandQ('d:계정 발급'); expandQ('i:proc:메일 계정'); if (mail) focus = mail.id }],
      ['VPN 신청: 수요일 파일이 연락처까지 잇는다', () => { expandQ('i:proc:VPN 신청'); expandQ(vpn && vpn.id) }],
      ['장비 › 노트북 반납: 경고를 받아들인 기록', () => { expandQ('d:장비'); expandQ('i:proc:노트북 반납'); if (warnRec) focus = warnRec.id }],
      ['지식 전체', () => { N.forEach((n) => vis.add(n.id)); focus = sent ? sent.id : null }],
    ]
    const tourOl = $('#gTour')
    tourOl.innerHTML = TOUR.map(([t], i) => `<li><button type="button" data-i="${i}"><span class="n">${i + 1}</span><span>${esc(t)}</span></button></li>`).join('')
    let ti = -1, timer = null
    function tourTo(i) {
      vis = new Set(); focus = null
      for (let j = 0; j <= i; j++) TOUR[j][1]()
      ti = i
      tourOl.querySelectorAll('button').forEach((b, j) => (j === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')))
      paint()
    }
    function stopTour() { clearInterval(timer); timer = null; tourOl.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-current')) }
    function play() { stopTour(); tourTo(0); if (reduce) { tourTo(TOUR.length - 1); return } timer = setInterval(() => { if (ti >= TOUR.length - 1) { clearInterval(timer); timer = null; return } tourTo(ti + 1) }, 3000) }
    tourOl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; clearInterval(timer); timer = null; tourTo(+b.dataset.i) })
    $('#gPlay').addEventListener('click', play)
    $('#gAll').addEventListener('click', () => { stopTour(); vis = new Set(N.map((n) => n.id)); focus = null; paint() })
    layout(); render()
    let wasN = narrow()
    addEventListener('resize', () => { if (narrow() !== wasN) { wasN = narrow(); layout(); render(); paint(false) } })
    onSee(svg, play, 0.5)
  }

  // ── Claude Code 재생: 위 차례 띠가 같이 켜진다 ──
  function terminal() {
    const st = step('session')
    // [모양, 글, 켤 차례(0 brief · 1 match · 2 section · 3 일 · 4 propose · 5 승인 · 6 save)]
    const L = [
      ['u', '> 오늘 온보딩 회의에서 노트북을 입사 전날 택배로 보내기로 했어. 팀 지식에 남겨 줘.'],
      ['', ''],
      ['t', '● kmd-team · brief  onboard', 0],
      ['d', `  ${S.name} · 문서 ${S.docs.length}`],
      ['t', '● kmd-team · match  "노트북"', 1],
      ['d', '  proc:노트북 받기   첫 주 안내 › 노트북 받기'],
      ['d', '  proc:노트북 반납   장비 › 노트북 반납'],
      ['d', '  term:노트북 사양   장비 › 노트북 사양'],
      ['t', '● kmd-team · section  proc:노트북 받기 · proc:입사 전날', 2],
      ['d', `  「${st.sections[0].from}」 · base 지문 16자`],
      ['', '  회의에서 정한 결정이라 남길 거리로 묶었습니다.', 3],
      ['t', '● kmd-team · propose', 4],
      ['d', '  【저장 제안】 신규 입사 온보딩(테스트) · 보는 사람 3 · 길: 이 세션의 작업'],
      ['d', `  기록   ${st.title}`],
      ['d', '  고침   첫 주 안내 › 노트북 받기 · 입사 전날  (바뀐 줄 2)'],
      ['d', '  경고   없음 · 오류 없음'],
      ['', '  승인하시면 기록과 항목 글이 한 번에 들어갑니다. 경고가 있으면 받아들인 것으로 남습니다.', 4],
      ['u', '> 좋아, 넣어', 5],
      ['t', '● kmd-team · save  (proposal 승인)', 6],
      ['o', '  ✓ 들어감 · 항목 2 · 기록 work/…노트북은-입사-전날-집으로-보낸다(테스트).md'],
      ['', ''],
      ['', '「첫 주 안내」 의 노트북 받기 · 입사 전날을 바꿨습니다.'],
      ['', '이력에서 옛 값 → 새 값을 보고, 항목마다 되돌릴 수 있습니다.'],
    ]
    const out = $('#termOut'), cc = [...document.querySelectorAll('.cc li')]
    const lit = (k) => cc.forEach((li, j) => li.classList.toggle('on', j === k))
    let run = 0
    async function play() {
      const me = ++run
      out.innerHTML = ''; lit(-1)
      const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms))
      for (const [c, text, k] of L) {
        if (me !== run) return
        if (k != null) lit(k)
        const span = document.createElement('span'); if (c) span.className = c
        out.appendChild(span)
        if (c === 'u' && !reduce) { for (let i = 1; i <= text.length; i++) { if (me !== run) return; span.textContent = text.slice(0, i); await wait(28) } }
        else span.textContent = text
        out.appendChild(document.createTextNode('\n'))
        await wait(c === 't' ? 750 : c === 'u' ? 500 : 200)
      }
      const cur = document.createElement('span'); cur.className = 'cur'; out.appendChild(cur)
    }
    $('#termRe').addEventListener('click', play)
    onSee($('#term'), play, 0.3)
  }

  // ── 화면 모음 · 크게 보기 ──
  const GALLERY = [
    ['doc', '문서 보기', '세 칸 책상: 잉크 기둥 · 목록 칸 · 종이'],
    ['kn', '지식 홈', '무대 · 최근 바뀐 문서'],
    ['home', '모든 지식', '지식관리 › 모든 지식 · 지식 카드'],
    ['item', '항목 보기', '오른쪽 기둥: 문서 · 기록 · 속성'],
    ['rec', '기록 보기', '요약 · 바뀐 것 · 까닭'],
    ['recs', '기록 목록', '잉크 기둥 보기 「기록」 · 두 줄'],
    ['search', '찾기', 'Ctrl K · 이름이 맞는 것 · 비슷한 글'],
    ['cmd', '명령 창', 'Ctrl P · 화면 · 일을 이름으로'],
    ['edit', '문서 고치기', '항목마다 고치고 [저장]'],
    ['propose', '저장 확인', '저장 제안 · 바뀐 줄 · [넣기] = 승인'],
    ['graph', '그래프', '문서 · 항목 · 기록의 3D 그래프'],
    ['history', '이력', '시간 줄 · 저장 · 들이기 · 고침'],
    ['check', '점검 › 지표', '받아들인 경고 · 규칙 길 · FIX'],
    ['import', '생성', '수기수집 · 자동수집 · 진행'],
    ['shape', '문서 › 구조', '폴더 · 이름 · 옮기기 · 합치기'],
    ['seed', '기초 세우기', '빈 지식에 폴더째 첫 짜임'],
  ]
  function gallery() {
    $('#gallery').innerHTML = GALLERY.map(([s, t, d]) => `<figure><button type="button" class="zoom" data-zoom="${s}"><img data-shot="${s}" alt="${esc(t)}: ${esc(d)}" width="1280" height="800" loading="lazy"></button><figcaption><b>${esc(t)}</b><span>${esc(d)}</span></figcaption></figure>`).join('')
    const box = $('#lightbox')
    document.addEventListener('click', (e) => {
      const z = e.target.closest('[data-zoom]'); if (!z) return
      const img = z.querySelector('img')
      $('#lbImg').src = img.currentSrc || img.src; $('#lbImg').alt = img.alt; $('#lbCap').textContent = img.alt
      box.showModal()
    })
    box.addEventListener('click', (e) => { if (e.target === box) box.close() })
  }

  // ── 메뉴: 지금 보는 마디 ──
  function spy() {
    const links = [...document.querySelectorAll('.menu a')]
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)) }, { rootMargin: '-45% 0px -50% 0px' })
    document.querySelectorAll('main section[id]').forEach((s) => io.observe(s))
  }

  if (!S) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px">자료(data/story.js)를 읽지 못했다. node site/demo/run.mjs 로 만든다.</p>'); return }
  kmap(); anatomy(); story(); finder(); graph(); terminal(); gallery(); spy(); setShots()
})()
