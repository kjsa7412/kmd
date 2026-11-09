// kmd 소개 사이트 — 빌드 없는 바닐라 JS. 자료는 data/story.js(site/demo/run.mjs 가 만든다)
(() => {
  'use strict'
  const S = window.KMD_STORY
  const $ = (s, r = document) => r.querySelector(s)
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const NS = 'http://www.w3.org/2000/svg'
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const narrow = () => innerWidth <= 600

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

  // ── 글 조각 — 기록 본문(## 머리 · - 줄 · 문단)만 ──
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

  // ── 개념 — 기록 하나 → 항목 둘 ──
  function anatomy() {
    const st = step('session'), d = docOf('첫 주 안내')
    const hits = new Set(st.sections.map((x) => x.coord.split(':')[1]))
    $('#anRec').innerHTML = `<h4>${esc(st.title)}</h4><div class="md">${md(st.body)}</div>`
    $('#anDoc').innerHTML = `<h4>${esc(d.title)}</h4><p class="intro">${esc(strip(d.intro.split('\n').pop()))}</p>` +
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
    draw(); addEventListener('resize', draw); window.addEventListener('load', draw)
  }

  // ── 이야기 — 흐름 그림 + 요일 탭 ──
  const CHANNELS = [['session', '세션', 'Claude Code'], ['edit', '화면 고치기', '팀 화면'], ['file', '파일 넣기', '팀 일꾼'], ['bulk', '대량 넣기', 'Claude Code'], ['commit', '가져올 곳', 'git · 폴더 · DB'], ['send', '보내기', '개인 → 팀']]
  const chOf = (key) => (key === 'held' ? 'session' : key)
  const SHOT_OF = { session: ['rec', '세션이 남긴 기록 — 바뀐 것 · 까닭 · 넣은 것'], file: ['import', '팀 화면 › 가져오기 — 파일을 끌어다 놓으면 팀 일꾼이 기록과 조각을 짓는다'], commit: ['history', '이력 — 들이기 · 저장 · 고침 · 넣지 못함이 한 줄에'], edit: ['edit', '문서 고치기 — 쓰기 자리부터 · 이력에 옛 값 → 새 값'], send: ['doc', '보낸 메모가 들어간 「첫 주 안내」 — 짝꿍 항목 끝'], held: ['held', '넣지 못함 — 까닭 · 들어온 길 · [고치기] · [다시 들이기]'] }
  let flow = null
  function flowDraw() {
    const svg = $('#flowSvg'); svg.innerHTML = ''
    const N = narrow()
    const W = N ? 360 : 900, H = N ? 470 : 300
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const g = { ch: {}, out: {} }
    const wires = el('g', {}, svg)
    // 채널
    CHANNELS.forEach(([k, l, s], i) => {
      const x = N ? (i % 2 ? 190 : 20) : 20, y = N ? 14 + Math.floor(i / 2) * 46 : 16 + i * 46, w = 150, h = 36
      const gg = el('g', { class: 'ch' }, svg)
      el('rect', { x, y, width: w, height: h, rx: 8 }, gg)
      const t = el('text', { x: x + 12, y: y + 23 }, gg); t.textContent = l
      if (!N) { const t2 = el('text', { x: x + w - 10, y: y + 23, 'text-anchor': 'end', style: 'font-weight:400;font-size:10.5px;opacity:.75' }, gg); t2.textContent = s }
      g.ch[k] = { gg, ax: N ? x + w / 2 : x + w, ay: N ? y + h : y + h / 2 }
    })
    // 저장 문
    const gx = N ? 60 : 330, gy = N ? 170 : 40, gw = N ? 240 : 230, gh = N ? 132 : 220
    const gate = el('g', { class: 'gate' }, svg)
    el('rect', { x: gx, y: gy, width: gw, height: gh, rx: 12 }, gate)
    const tt = el('text', { x: gx + gw / 2, y: gy + 28, 'text-anchor': 'middle' }, gate); tt.textContent = '저장 문 — 한 덩이로 검사'
    const checks = N ? ['자리 · 저장 속도 · 같은 저장', '꼴(E_FORMAT) · 값 대조', '지문(base) · 섞인 자리', '→ 기록 · 문서 · git 한 묶음'] : ['자리(쓰기 이상)', '저장 속도 · 같은 저장', '항목 꼴(E_FORMAT)', '값 대조 — 근거에 있는 값만', '지문(base) — 읽은 뒤 바뀌었나', '→ 기록 · 문서 · git 한 묶음']
    checks.forEach((c, i) => { const t = el('text', { x: gx + 18, y: gy + 54 + i * (N ? 20 : 26), class: 'chk' }, gate); t.textContent = c })
    // 나오는 곳
    const OUT = [['rec', '기록', 'work/<id>.md · 늘 남는다'], ['doc', '문서 · 항목', '조각이 그 자리에 들어간다'], ['held', '넣지 못함', '기록만 · 까닭과 함께']]
    OUT.forEach(([k, l, s], i) => {
      const x = N ? 6 + i * 118 : 680, y = N ? 360 : 30 + i * 90, w = N ? 112 : 200, h = N ? 64 : 62
      const gg = el('g', { class: 'out ' + k }, svg)
      el('rect', { x, y, width: w, height: h, rx: 10 }, gg)
      const t = el('text', { x: x + 12, y: y + 26 }, gg); t.textContent = l
      if (!N) { const t2 = el('text', { x: x + 12, y: y + 46, class: 's' }, gg); t2.textContent = s }
      g.out[k] = { gg, bx: N ? x + w / 2 : x, by: N ? y : y + h / 2 }
    })
    // 선
    const inX = N ? gx + gw / 2 : gx, inY = N ? gy : gy + gh / 2, outX = N ? gx + gw / 2 : gx + gw, outY = N ? gy + gh : gy + gh / 2
    for (const k in g.ch) {
      const c = g.ch[k]
      const d = N ? `M${c.ax},${c.ay} C${c.ax},${c.ay + 24} ${inX},${inY - 24} ${inX},${inY}` : `M${c.ax},${c.ay} C${c.ax + 80},${c.ay} ${inX - 80},${inY} ${inX},${inY}`
      c.wire = el('path', { d, class: 'wire' }, wires)
    }
    for (const k in g.out) {
      const o = g.out[k]
      const d = N ? `M${outX},${outY} C${outX},${outY + 30} ${o.bx},${o.by - 30} ${o.bx},${o.by}` : `M${outX},${outY} C${outX + 60},${outY} ${o.bx - 60},${o.by} ${o.bx},${o.by}`
      o.wire = el('path', { d, class: 'wire' + (k === 'held' ? ' held' : '') }, wires)
    }
    g.dots = el('g', {}, svg)
    flow = g
  }
  let dotRaf = 0
  function flowShow(key) {
    if (!flow) return
    cancelAnimationFrame(dotRaf)
    const c = chOf(key), outs = key === 'held' ? ['rec', 'held'] : ['rec', 'doc']
    for (const k in flow.ch) { const on = k === c; flow.ch[k].gg.classList.toggle('on', on); flow.ch[k].wire.classList.toggle('on', on) }
    for (const k in flow.out) { const on = outs.includes(k); flow.out[k].gg.classList.toggle('on', on); flow.out[k].wire.classList.toggle('on', on) }
    flow.dots.innerHTML = ''
    if (reduce) return
    const a = flow.ch[c].wire, la = a.getTotalLength()
    const legs = outs.map((k) => ({ p: flow.out[k].wire, l: flow.out[k].wire.getTotalLength(), held: k === 'held' }))
    const dots = legs.map((x) => el('circle', { r: 5, class: 'dot' + (x.held ? ' held' : '') }, flow.dots))
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
  let cur = 0, auto = null
  const DUR = 7000
  function stepShow(i, user) {
    cur = i
    const st = S.steps[i], held = st.result && st.result.held && st.result.held.length
    document.querySelectorAll('#stepTabs button').forEach((b, j) => {
      b.setAttribute('aria-selected', j === i); b.tabIndex = j === i ? 0 : -1
      const p = b.querySelector('.pbar'); p.classList.remove('run'); if (j === i && auto && !user) { void p.offsetWidth; p.classList.add('run') }
    })
    flowShow(st.key)
    const pieces = st.key === 'edit' ? [{ coord: `proc:${st.heading}`, from: st.from, to: st.to }] : st.sections || []
    const diffs = pieces.map((x) => { const name = x.coord.split(':')[1], where = secOf(name); return `<div class="card diff${held ? ' held' : ''}"><div class="h">${esc(name)} <code>${esc(x.coord)}</code><span class="chip">${esc(where ? where.d.title : '')}</span></div><div>${diffHtml(x.from, x.to)}</div></div>` }).join('')
    const src = st.file ? `<div class="src">📄 ${esc(st.file)}</div>` : st.commit ? `<div class="src">⎇ ${esc(st.commit)}</div>` : ''
    const rec = st.key === 'edit' ? `<div class="card recbox"><div class="t">화면에서 고침: ${esc(st.doc)} 「${esc(st.heading)}」</div><p>쓰기 자리부터 문서를 바로 고친다. 고친 글 그대로 들어가고, 이력에 「고침」 · 옛 값 → 새 값이 남는다.</p></div>` : `<div class="card recbox"><div class="t">${esc(st.title)}</div>${md(st.body)}</div>`
    const result = held ? `<span class="chip warn">넣지 못함</span> ${esc(st.result.held.join(' · '))} — 기록만 남고 문서는 그대로다. 「3일」 이 기록 어디에도 근거가 없어서다.` : `<span class="chip ok">문서에 들어감</span> 항목 ${pieces.length} · 기록 · git 한 묶음`
    const [shot, cap] = SHOT_OF[st.key]
    $('#stepPanel').setAttribute('aria-labelledby', 'tab-' + st.key)
    $('#stepPanel').innerHTML = `<div class="st-left"><p class="who"><span class="av">${esc(st.who.replace('test-', '').slice(0, 2))}</span><b>${esc(st.who)}</b><span class="chip">${esc(st.role)}</span><span class="chip acc">${esc(st.ch)}</span></p><h3>${esc(st.title.replace('(테스트)', ''))}</h3><p class="via">${esc(st.via)}</p>${src}${rec}<div class="diffs">${diffs}</div><p class="result">${result}</p></div><div class="st-right"><figure class="frame"><div class="bar"><i></i><i></i><i></i><span>${esc(cap.split(' — ')[0])}</span></div><button type="button" class="zoom" data-zoom="${shot}"><img data-shot="${shot}" alt="${esc(cap)}" width="1280" height="800"></button><figcaption>${esc(cap)}</figcaption></figure></div>`
    setShots()
  }
  const stop = () => { clearInterval(auto); auto = null; document.querySelectorAll('#stepTabs .pbar').forEach((p) => p.classList.remove('run')) }
  function story() {
    const tabs = $('#stepTabs')
    tabs.innerHTML = S.steps.map((st, i) => `<button type="button" role="tab" id="tab-${st.key}" aria-controls="stepPanel" data-i="${i}"><span>${esc(st.day)} · ${esc(st.ch)}</span><small>${esc(st.key === 'held' ? '넣지 못함' : st.key === 'edit' ? '첫날 일정' : st.sections[0].coord.split(':')[1])}</small><i class="pbar" style="--dur:${DUR}ms"></i></button>`).join('')
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
    if (!reduce) new IntersectionObserver((es, ob) => {
      if (!es[0].isIntersecting) return
      ob.disconnect()
      auto = setInterval(() => { if (cur === S.steps.length - 1) { stop(); return } stepShow(cur + 1) }, DUR)
      stepShow(cur)
    }, { threshold: 0.35 }).observe($('#story .flow'))
  }

  // ── 찾아가기 ──
  const FIND = [
    ['home', '지식 목록', '자리를 받은 지식만 보인다. 카드에 내 자리 · 넣지 못함 수 · 점검 경고가 붙는다.', '지식 목록 — 받은 지식 카드'],
    ['search', '찾기 <kbd>Ctrl</kbd> <kbd>K</kbd> 「노트북」', '이름이 맞는 항목(노트북 받기 · 반납 · 사양)이 먼저, 그다음 비슷한 글이 항목 단위로 나온다.', '찾기 — 이름이 맞는 것 · 비슷한 글'],
    ['item', '항목 「노트북 받기」', '글은 지금 값만. 오른쪽 칸에 이 항목이 있는 문서와 이 항목을 바꾼 기록(이력)이 같이 보인다.', '항목 보기 — 문서 · 기록이 오른쪽 칸에'],
    ['rec', '기록 — 왜 바뀌었나', '바뀐 것 · 까닭 · 넣은 것(어느 문서의 어느 항목). 「월요일 온보딩 회의에서 정했다」 가 출처다.', '기록 보기 — 바뀐 것 · 까닭 · 넣은 것'],
    ['doc', '문서 「첫 주 안내」', '확정된 지식만 읽힌다. 기록 · 경위는 본문에 섞지 않고 문서 끝 참고 블록에 출처로 남는다.', '문서 보기 — 항목 넷 · 이 문서의 차례'],
  ]
  function finder() {
    const ol = $('#findSteps')
    ol.innerHTML = FIND.map(([, t, d], i) => `<li><button type="button" data-i="${i}"><span class="n">${i + 1}</span><span><b>${t}</b><span class="d">${esc(d)}</span></span></button></li>`).join('')
    const img = $('#findImg')
    const show = (i) => {
      const [shot, , d, cap] = FIND[i]
      ol.querySelectorAll('button').forEach((b, j) => (j === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')))
      img.classList.add('fade')
      setTimeout(() => { img.dataset.shot = shot; img.alt = cap; $('#findZoom').dataset.zoom = shot; setShots(); img.onload = () => img.classList.remove('fade'); if (img.complete) img.classList.remove('fade') }, reduce ? 0 : 160)
      $('#findBar').textContent = cap.split(' — ')[0]
      $('#findCap').textContent = d
    }
    ol.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i) })
    show(0)
  }

  // ── 그래프 ──
  function graph() {
    const N = S.graph.nodes.map((n) => ({ ...n })), E = S.graph.edges.map((e) => ({ ...e }))
    const byId = new Map(N.map((n) => [n.id, n]))
    const recOf = (k) => N.find((n) => n.step === k)
    const heldRec = N.find((n) => n.held)
    // 넣지 못한 기록은 들어가려던 항목에 점선으로(줄거리의 조각에서)
    if (heldRec) for (const x of step('held').sections) if (byId.has('i:' + x.coord)) E.push({ a: heldRec.id, b: 'i:' + x.coord, t: 'held' })
    const nbr = new Map(N.map((n) => [n.id, new Set()]))
    E.forEach((e) => { nbr.get(e.a).add(e.b); nbr.get(e.b).add(e.a) })
    const svg = $('#gSvg')
    let W, H
    // 배치 — 고정 씨앗 힘 배치(같은 자료면 늘 같은 모양)
    function layout() {
      const N0 = narrow() || svg.parentElement.clientWidth < 560
      W = N0 ? 440 : 800; H = N0 ? 600 : 550
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.aspectRatio = `${W}/${H}`
      const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967296 }
      N.forEach((n, i) => { const a = (i / N.length) * Math.PI * 2 + hash(n.id), r = 60 + hash(n.id + 'r') * 120; n.x = W / 2 + Math.cos(a) * r; n.y = H / 2 + Math.sin(a) * r; n.vx = 0; n.vy = 0 })
      const L = { in: 72, touch: 96, link: 170, held: 96 }
      for (let it = 0; it < 500; it++) {
        const cool = 1 - it / 500
        for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
          const a = N[i], b = N[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy + 0.01
          const f = 5200 / d2; const d = Math.sqrt(d2); dx /= d; dy /= d
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f
        }
        for (const e of E) {
          const a = byId.get(e.a), b = byId.get(e.b); const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1
          const f = (d - L[e.t]) * 0.04; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
        }
        for (const n of N) {
          n.vx += (W / 2 - n.x) * 0.006; n.vy += (H / 2 - n.y) * 0.006
          const m = Math.min(1, Math.hypot(n.vx, n.vy)) // 한 걸음 길이 제한
          const s = Math.hypot(n.vx, n.vy) || 1
          n.x += (n.vx / s) * m * 6 * cool + n.vx * 0.05 * cool; n.y += (n.vy / s) * m * 6 * cool + n.vy * 0.05 * cool
          n.vx *= 0.5; n.vy *= 0.5
          n.x = Math.max(56, Math.min(W - 56, n.x)); n.y = Math.max(44, Math.min(H - 24, n.y))
        }
      }
    }
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
        const g = el('g', { class: `gn ${n.kind}${n.held ? ' held' : ''} off`, tabindex: 0, role: 'button', 'aria-label': `${KIND[n.kind]} ${n.label}` }, gn)
        g.style.transformOrigin = `${n.x}px ${n.y}px`
        el('circle', { class: 'gring', cx: n.x, cy: n.y, r: 10 }, g)
        const sh = n.kind === 'doc' ? el('rect', { class: 'shape', x: n.x - 8, y: n.y - 8, width: 16, height: 16, rx: 3 }, g)
          : n.kind === 'item' ? el('circle', { class: 'shape', cx: n.x, cy: n.y, r: 7 }, g)
          : el('polygon', { class: 'shape', points: `${n.x},${n.y - 8} ${n.x + 8},${n.y} ${n.x},${n.y + 8} ${n.x - 8},${n.y}` }, g)
        sh.style.transformOrigin = `${n.x}px ${n.y}px`
        const right = n.x < W * 0.62
        const t = el('text', { x: n.x + (right ? 13 : -13), y: n.y + 4, 'text-anchor': right ? 'start' : 'end' }, g)
        t.textContent = n.label.length > 16 ? n.label.slice(0, 15) + '…' : n.label
        g.addEventListener('click', () => { stopTour(); expand(n.id) })
        g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); stopTour(); expand(n.id) } })
        els.set(n.id, g)
      }
      paint(false)
    }
    const KIND = { doc: '문서', item: '항목', rec: '기록' }
    let vis = new Set(), focus = null
    function paint(anim = true) {
      for (const [id, g] of els) { g.classList.toggle('off', !vis.has(id)); g.classList.toggle('focus', id === focus) }
      for (const { e, l } of eEls) {
        const on = vis.has(e.a) && vis.has(e.b)
        if (on && l.classList.contains('off') && anim && !reduce) { l.classList.remove('draw'); void l.getBoundingClientRect(); l.classList.add('draw') }
        l.classList.toggle('off', !on)
        l.classList.toggle('hot', on && !!focus && (e.a === focus || e.b === focus) && e.t !== 'held')
      }
      card(focus)
    }
    function card(id) {
      const n = id && byId.get(id), box = $('#gCard')
      if (!n) { box.innerHTML = `<span class="k">점 ${vis.size} / ${N.length}</span><b>${esc(S.name)}</b><p>문서 ${N.filter((x) => x.kind === 'doc').length} · 항목 ${N.filter((x) => x.kind === 'item').length} · 기록 ${N.filter((x) => x.kind === 'rec').length}</p>`; return }
      let k = KIND[n.kind], p = ''
      if (n.kind === 'item') { const w = secOf(n.label); k += ` · ${n.coord || ''}`; p = w ? `${w.d.title} › ${strip(w.s.body)}` : '' }
      else if (n.kind === 'doc') { const d = docOf(n.label); p = d ? strip(d.intro.split('\n').pop()) : '' }
      else { const r = S.recs.find((x) => 'r:' + x.id === n.id); const st = n.step && step(n.step); k += ` · ${st ? st.ch : ''}${n.held ? ' · 넣지 못함' : ''}`; p = r ? strip(r.body.split('\n').filter((l) => l.startsWith('- ')).slice(0, 2).join(' ')) : '' }
      box.innerHTML = `<span class="k">${esc(k)}</span><b>${esc(n.label)}</b><p>${esc(p.slice(0, 140))}</p>`
    }
    function expand(id) { vis.add(id); nbr.get(id).forEach((x) => vis.add(x)); focus = id; paint() }
    // 둘러보기
    const sess = recOf('session'), vpn = recOf('file')
    const TOUR = [
      ['찾기 「노트북」 → 항목 「노트북 받기」', () => { vis = new Set(['i:proc:노트북 받기']); focus = 'i:proc:노트북 받기' }],
      ['이웃 한 겹 — 들어 있는 문서 · 바꾼 기록', () => expandQ('i:proc:노트북 받기')],
      ['기록을 누르면 — 같이 바뀐 「입사 전날」', () => expandQ(sess && sess.id)],
      ['문서 「첫 주 안내」 — 나머지 항목 · 보낸 메모', () => { expandQ('d:첫 주 안내'); nbr.get('i:proc:짝꿍').forEach((x) => vis.add(x)) }],
      ['문서 링크를 따라 — 계정 발급 · 장비', () => { expandQ('d:계정 발급'); expandQ('d:장비') }],
      ['「노트북 반납」 — 넣지 못한 기록이 매달려 있다', () => { expandQ('i:proc:노트북 반납'); if (heldRec) focus = heldRec.id }],
      ['지식 전체 — 파일 기록 하나가 두 문서를 잇는다', () => { N.forEach((n) => vis.add(n.id)); focus = vpn ? vpn.id : null }],
    ]
    function expandQ(id) { if (!id) return; vis.add(id); nbr.get(id).forEach((x) => vis.add(x)); focus = id }
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
    function play() { stopTour(); tourTo(0); if (reduce) { tourTo(TOUR.length - 1); return } timer = setInterval(() => { if (ti >= TOUR.length - 1) { clearInterval(timer); timer = null; return } tourTo(ti + 1) }, 2800) }
    tourOl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; clearInterval(timer); timer = null; tourTo(+b.dataset.i) })
    $('#gPlay').addEventListener('click', play)
    $('#gAll').addEventListener('click', () => { stopTour(); vis = new Set(N.map((n) => n.id)); focus = null; paint() })
    layout(); render()
    let wasN = narrow()
    addEventListener('resize', () => { if (narrow() !== wasN) { wasN = narrow(); layout(); render(); paint(false) } })
    new IntersectionObserver((es, ob) => { if (es[0].isIntersecting) { ob.disconnect(); play() } }, { threshold: 0.5 }).observe($('#gSvg'))
  }

  // ── Claude Code 재생 ──
  function terminal() {
    const st = step('session')
    const L = [
      ['u', '> 오늘 온보딩 회의에서 노트북을 입사 전날 택배로 보내기로 했어. 팀 지식에 남겨 줘.'],
      ['', ''],
      ['t', '● kmd-team · brief  onboard'],
      ['d', `  ${S.name} · 문서 ${S.docs.length} · 내 넣지 못함 0 · 안 넣은 메모 0`],
      ['t', '● kmd-team · match  "노트북"'],
      ['d', '  proc:노트북 받기   첫 주 안내 › 노트북 받기'],
      ['d', '  proc:노트북 반납   장비 › 노트북 반납'],
      ['d', '  term:노트북 사양   장비 › 노트북 사양'],
      ['t', '● kmd-team · section  proc:노트북 받기 · proc:입사 전날'],
      ['d', `  「${st.sections[0].from}」 · base 지문 16자`],
      ['', '  회의에서 정한 결정이라 확정으로 저장합니다.'],
      ['t', '● kmd-team · save'],
      ['d', `  record    ${st.title}`],
      ['d', '  sections  proc:노트북 받기 · proc:입사 전날  (조각 2 · 지문 2)'],
      ['o', '  ✓ 넣음 2 · 넣지 못함 0 · 기록 work/…노트북은-입사-전날-집으로-보낸다.md'],
      ['', ''],
      ['', '「첫 주 안내」 의 노트북 받기 · 입사 전날을 바꿨습니다.'],
      ['', '이력에서 옛 값 → 새 값을 보고, 항목마다 되돌릴 수 있습니다.'],
    ]
    const out = $('#termOut')
    let run = 0
    async function play() {
      const me = ++run
      out.innerHTML = ''
      const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms))
      for (const [c, text] of L) {
        if (me !== run) return
        const span = document.createElement('span'); if (c) span.className = c
        out.appendChild(span)
        if (c === 'u' && !reduce) { for (let i = 1; i <= text.length; i++) { if (me !== run) return; span.textContent = text.slice(0, i); await wait(28) } }
        else span.textContent = text
        out.appendChild(document.createTextNode('\n'))
        await wait(c === 't' ? 650 : c === 'u' ? 500 : 180)
      }
      const cur = document.createElement('span'); cur.className = 'cur'; out.appendChild(cur)
    }
    $('#termRe').addEventListener('click', play)
    new IntersectionObserver((es, ob) => { if (es[0].isIntersecting) { ob.disconnect(); play() } }, { threshold: 0.3 }).observe($('#term'))
  }

  // ── 화면 모음 · 크게 보기 ──
  const GALLERY = [
    ['home', '지식 목록', '받은 지식 카드 · 자리 · 넣지 못함 수'],
    ['doc', '문서 보기', '확정된 지식만 · 오른쪽 칸에 차례'],
    ['item', '항목 보기', '이 항목이 있는 문서 · 이 항목의 이력'],
    ['rec', '기록 보기', '바뀐 것 · 까닭 · 넣은 것'],
    ['recs', '기록 목록', '옆 메뉴 「기록」 — 새것 위'],
    ['search', '찾기', '이름이 맞는 것 · 비슷한 글'],
    ['edit', '문서 고치기', '항목마다 고치고 한 번에 저장'],
    ['graph', '그래프', '문서 · 항목 · 기록의 3D 그래프'],
    ['history', '이력', '저장 · 들이기 · 고침 · 넣지 못함'],
    ['held', '넣지 못함', '까닭 · 들어온 길 · 고치기 · 다시 들이기'],
    ['import', '가져오기', '파일 넣기 · 가져올 곳 · 일 줄'],
    ['kn', '지식 홈', '지식 하나의 첫 화면'],
  ]
  function gallery() {
    $('#gallery').innerHTML = GALLERY.map(([s, t, d]) => `<figure><button type="button" class="zoom" data-zoom="${s}"><img data-shot="${s}" alt="${esc(t)} — ${esc(d)}" width="1280" height="800" loading="lazy"></button><figcaption><b>${esc(t)}</b><span>${esc(d)}</span></figcaption></figure>`).join('')
    const box = $('#lightbox')
    document.addEventListener('click', (e) => {
      const z = e.target.closest('[data-zoom]'); if (!z) return
      const img = z.querySelector('img')
      $('#lbImg').src = img.currentSrc || img.src; $('#lbImg').alt = img.alt; $('#lbCap').textContent = img.alt
      box.showModal()
    })
    box.addEventListener('click', (e) => { if (e.target === box) box.close() })
  }

  // ── 메뉴 — 지금 보는 마디 ──
  function spy() {
    const links = [...document.querySelectorAll('.menu a')]
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)) }, { rootMargin: '-45% 0px -50% 0px' })
    document.querySelectorAll('main section[id]').forEach((s) => io.observe(s))
  }

  if (!S) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px">자료(data/story.js)를 읽지 못했다. node site/demo/run.mjs 로 만든다.</p>'); return }
  anatomy(); story(); finder(); graph(); terminal(); gallery(); spy(); setShots()
})()
