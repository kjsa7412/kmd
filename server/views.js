// 화면이 읽는 자료 — 지식 목록 · 나무 · 문서 한 장 · 기록 한 장 · 찾기.
//
// 글은 서버가 markdown 을 HTML 로 바꿔 보낸다(날 HTML 은 받지 않는다 — html:false).
// 문서 · 기록을 가리키는 링크는 화면 안에서 탭으로 열리게 표지를 단다.

import MarkdownIt from 'markdown-it'
import path from 'node:path'
import { coordsOfSection, labelOf, sectionOf, reflectedIn } from '../core/knowledge.js'
import { parsePut, parseLinked, itemKey } from '../core/parts.js'
import { sha16 } from '../core/text.js'
import { parseRefLine, headingMatches } from '../core/sections.js'
import { levelOf, eachLive } from '../core/levels.js'
import { RECORDS_DOC } from '../core/guard.js'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// 맨 글자 「README.md」 를 바깥 주소(http://README.md)로 잇지 않는다 — https:// · www. · 메일만 저절로 링크
md.linkify.set({ fuzzyLink: false })
// 표는 감싼다 — 넓은 표가 좁은 화면에서 옆으로 밀리게(본문은 밀리지 않게)
md.renderer.rules.table_open = () => '<div class="tblwrap"><table class="t">\n'
md.renderer.rules.table_close = () => '</table></div>\n'

const safeDec = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}
// 문서 id 찾기 — 쓴 글자 그대로 · NFC · 대소문자 무시(Windows · 맥에서 쓴 글) · 지식을 모르면(문서 목록 없음) 쓴 그대로
const docIds = new WeakMap()
function docIdOf(k, id) {
  if (!k?.docs) return null
  if (!docIds.has(k)) docIds.set(k, new Map(k.docs.map((d) => [d.id.normalize('NFC').toLowerCase(), d.id])))
  return docIds.get(k).get(String(id).normalize('NFC').toLowerCase()) || null
}
// 글 속 링크 → 무엇인가(작성기준 4절)
//   { t: 'doc', d } · { t: 'item', d, h } · { t: 'missing', d } · { t: 'rec', r, sub } · { t: 'ext' } · { t: 'mail' } · { t: 'dead' }
//   문서 = docs/ 아래 .md(확장자 없으면 .md 를 붙여 있는 문서면) · '/' 로 시작하면 지식 뿌리 기준 · '#머리' 는 같은 문서 항목
//   기록 · 이력 = work/ · log/ 의 .md · 바깥 = http(s) · mailto · 그 밖(내부 경로 · 시스템 주소 · 깨진 % 글자)은 열 수 없는 링크
export function linkTarget(k, fromPath, href) {
  const dead = { t: 'dead' }
  const s = String(href || '').trim()
  if (!s) return dead
  if (/^https?:\/\//i.test(s)) return { t: 'ext' }
  if (/^mailto:/i.test(s)) return { t: 'mail' }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return dead
  const at = s.indexOf('#')
  const part = (at < 0 ? s : s.slice(0, at)).split('?')[0]
  const frag = at < 0 ? '' : s.slice(at + 1)
  if (frag.startsWith('/')) return dead // #/… 화면 주소
  const h = frag ? safeDec(frag) : ''
  if (h == null) return dead
  const from = String(fromPath || '')
  if (!part) {
    // 같은 문서의 항목
    const self = /^docs\/.+\.md$/i.test(from) ? from.slice(5, -3) : null
    if (!self || !h) return dead
    return itemTarget(k, docIdOf(k, self) || self, h)
  }
  const rel = safeDec(part)
  if (rel == null) return dead
  const r0 = rel.normalize('NFC').replace(/\\/g, '/')
  if (/^\/(api|manual)\//i.test(r0)) return dead
  const p = r0.startsWith('/') ? path.posix.normalize(r0.replace(/^\/+/, '')) : path.posix.normalize(path.posix.join(path.posix.dirname(from), r0))
  if (p === '..' || p.startsWith('../') || p.startsWith('/')) return dead
  const w = p.match(/^(work|log)\/([^/]+?)\.md$/i)
  if (w) return { t: 'rec', r: w[2], sub: w[1].toLowerCase(), ...(k?.byWork && !k.byWork.has(w[2]) ? { gone: true } : {}) }
  if (!/^docs\/./i.test(p)) return dead
  const md = /\.md$/i.test(p)
  const want = md ? p.slice(5, -3) : p.slice(5)
  if (!k?.docs) return md ? (h ? { t: 'item', d: want, h: h.normalize('NFC') } : { t: 'doc', d: want }) : dead
  const id = docIdOf(k, want)
  if (id) return h ? itemTarget(k, id, h) : { t: 'doc', d: id }
  return md ? { t: 'missing', d: want } : dead
}

// GitHub 꼴 앵커 — 소문자 · 글자 · 숫자 · 빈칸 · - · _ 만 남기고 빈칸은 - 로(「원격 제어 확인 창 (DPA020 · DPC010 공통)」 → 원격-제어-확인-창-dpa020--dpc010-공통)
export const slugOf = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
// 문서 하나의 머리 — [{ h(## 이름), sub(### 이름 · ## 이면 null) }] (코드 울타리 밖 · 항목 글 안의 ###)
const headIdx = new WeakMap()
function headsOfDoc(d) {
  if (headIdx.has(d)) return headIdx.get(d)
  const out = []
  for (const s of d.sections || []) {
    out.push({ h: s.h, sub: null })
    let fence = null
    for (const ln of String(s.body || '').split('\n')) {
      const f = ln.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (f) {
        fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
        continue
      }
      const m = !fence && ln.match(/^###\s+(.+?)\s*#*\s*$/)
      if (m) out.push({ h: s.h, sub: m[1].trim() })
    }
  }
  headIdx.set(d, out)
  return out
}
// 항목 링크(#머리) — 그 문서의 ## 이름(NFC)과 같으면 그 항목 · 아니면 slug 로 ## · ### 를 찾는다(### 면 sub — 위 ## 로 열고 그 소제목까지)
//   못 찾으면 { miss: true }(「없는 항목」) · 지식이나 그 문서를 모르면 쓴 그대로(재 볼 수 없다)
function itemTarget(k, d, h0) {
  const h = h0.normalize('NFC')
  const doc = k?.docs?.find((x) => x.id === d)
  if (!doc) return { t: 'item', d, h }
  const hs = headsOfDoc(doc)
  const top = hs.filter((x) => !x.sub)
  const nf = (x) => x.normalize('NFC')
  const same = top.find((x) => nf(x.h) === h)
  if (same) return { t: 'item', d, h: same.h }
  const want = slugOf(h)
  const hit = want && (top.find((x) => slugOf(x.h) === want) || hs.find((x) => x.sub && slugOf(x.sub) === want))
  if (hit) return { t: 'item', d, h: hit.h, ...(hit.sub ? { sub: hit.sub } : {}) }
  return { t: 'item', d, h, miss: true }
}

// 문단 안의 줄바꿈은 줄마다 문단으로 — 목업(paras)이 줄 하나를 <p> 하나로 그린다
// 수준 표시 줄(작성기준 5-1절 · 컨벤션 「문서 표시」) — md 목록으로 넘기지 않고 먼저 떼어 그린다(번호를 다시 매기지 않는다)
//   글은 들여쓰지 않고 줄 머리 표시로 쓰고(쓰는 규칙), 화면은 그 표시를 읽어 짜임대로 그린다(그리는 규칙):
//   - 라벨 줄(「- **이름**: …」)은 라벨 칸 + 내용 칸 · 바로 아래 「*」 줄과 표 · 울타리는 그 내용 칸 안(다음 라벨 · 수준 줄 · 문단 · 머리에서 닫는다)
//   - 그 밖의 줄은 앞 줄 맥락만큼 들인다: 「1.」 0 · 「1.1.」 1 · 「1.1.1.」 2 · 「1)」 은 위 점 번호 한 단 아래 · 「-」 은 위 번호 한 단 아래 · 「*」 은 위 「-」 한 단 아래(넷까지)
//   - 표시는 번호는 그대로, 「-」 · 「*」 은 점(lvm 의 data-m)으로 · 남은 것 줄(「할 일: 맡은 이 · 기한 X」)은 할 일과 덧붙임을 나눈다
const LABEL_LINE = /^\*\*([^*\n]{1,24})\*\*\s*[:：]\s?(.*)$/
function levelLines(text) {
  const lines = text.split('\n')
  const lv = []
  const lbs = []
  let open = null // 열린 라벨 { name }
  let dot = -1 // 마지막 점 번호 단(0 ~ 2)
  let base = 0 // 「-」 의 단
  let star = 0 // 「*」 의 단
  // 이 줄 앞에서 라벨 칸을 닫는다 — 줄 글은 아래에서 자리표시로 바뀔 수 있어 다 돈 뒤에 붙인다
  const shut = new Set()
  const close = (i) => { if (open == null) return; shut.add(i); open = null }
  const reset = () => { dot = -1; base = 0; star = 0 }
  eachLive(lines, (ln, i, head) => {
    if (head) { close(i); reset(); return }
    const x = levelOf(ln)
    if (!x) { if (ln.trim()) close(i); return }
    const lb = x.n === 7 ? x.text.match(LABEL_LINE) : null
    if (lb) {
      close(i)
      lines[i] = `\n\nKMDLBO${lbs.length}\n\n`
      lbs.push({ name: lb[1].trim(), rest: lb[2] })
      open = lbs.length - 1
      star = 0
      return
    }
    let d
    if (x.n === 8 && open != null) d = 0
    else {
      if (x.n !== 8) close(i)
      if (x.n <= 3) { d = x.n - 1; dot = d; base = d + 1; star = base + 1 }
      else if (x.n <= 6) { d = (dot >= 0 ? dot + 1 : 0) + (x.n - 4); base = d + 1; star = base + 1 }
      else if (x.n === 7) { d = base; star = d + 1 }
      else d = star
    }
    const todo = x.n === 8 && open != null && /^남은 것$/.test(lbs[open].name) ? x.text.match(/^(.+?):\s+(.+?)\s+·\s+기한\s+(\d{4}-\d{2}-\d{2}|-)\s*$/) : null
    lines[i] = `\n\nKMDLV${lv.length}\n\n`
    lv.push({ ...x, d: Math.min(d, 4), inLabel: open != null && x.n === 8, ...(todo ? { todo: { what: todo[1], who: todo[2], due: todo[3] } } : {}) })
  })
  for (const i of shut) lines[i] = `\n\nKMDLBC\n\n${lines[i]}`
  if (open != null) lines.push('\n\nKMDLBC\n\n')
  return { text: lines.join('\n'), lv, lbs }
}
const plainOf = (h) => h.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
export function render(k, fromPath, text) {
  const env = { k, fromPath }
  const { text: t, lv, lbs } = levelLines(String(text || ''))
  const html = md.render(t, env).replace(/<p>([\s\S]*?)<\/p>/g, (all, inner) => inner.split('<br>\n').map((x) => `<p>${x}</p>`).join('\n'))
  return html
    .replace(/<p>KMDLBO(\d+)<\/p>/g, (_, n) => {
      const b = lbs[Number(n)]
      return `<div class="lbr" data-t="lbRow"><div class="lbn">${esc(b.name)}</div><div class="lbv">${b.rest.trim() ? `<p>${md.renderInline(b.rest, env)}</p>` : ''}`
    })
    .replace(/<p>KMDLBC<\/p>/g, '</div></div>')
    .replace(/<p>KMDLV(\d+)<\/p>/g, (_, n) => {
      const x = lv[Number(n)]
      const mark = x.n >= 7 ? `<span class="lvm" data-m="${x.inLabel || x.n === 7 ? 'dot' : 'ring'}" aria-hidden="true"></span>` : `<span class="lvm">${esc(x.mark)}</span>`
      const inner = x.todo
        ? `${md.renderInline(x.todo.what, env)}<span class="lvt"> · ${x.todo.who === '-' ? '' : `${md.renderInline(x.todo.who, env)} · `}${x.todo.due === '-' ? '기한 없음' : `기한 ${esc(x.todo.due)}`}</span>`
        : md.renderInline(x.text, env)
      return `<div class="lv l${x.n}${x.d ? ` d${x.d}` : ''}"${x.n <= 3 ? ` data-lv="${esc(plainOf(inner))}"` : ''}>${mark}<span class="lvx">${inner}</span></div>`
    })
}
// 편집기용 글
export const editParts = (body) => ({ md: String(body || '').replace(/\n{3,}/g, '\n\n').trim() })

// 링크 모양 — 문서 'dlink doc' · 항목 'dlink item' · 없는 문서 'dlink doc missing' · 기록 · 이력 'dlink rec' · 바깥 'xlink'(새 창) ·
// 열 수 없는 것은 <span class="deadlink">(눌러지는 것처럼 보이지 않게)
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  const t = tokens[i]
  const href = t.attrGet('href')
  const to = linkTarget(env?.k || null, env?.fromPath, href)
  const kid = env?.k?.id ?? ''
  // 없는 항목(그 문서에 그 머리가 없다)은 흐리게 · 누르면 문서만 연다(data-h 없음)
  if (to.t === 'item' && to.miss) t.attrs = [['class', 'dlink item missing'], ['data-a', 'openDoc'], ['data-k', kid], ['data-d', to.d], ['title', '없는 항목']]
  else if (to.t === 'doc' || to.t === 'item') t.attrs = [['href', '#/k/' + encodeURIComponent(kid) + '/d/' + encodeURIComponent(to.d) + (to.h ? '/h/' + encodeURIComponent(to.h) : '')], ['class', to.t === 'item' ? 'dlink item' : 'dlink doc'], ['data-a', 'openDoc'], ['data-k', kid], ['data-d', to.d], ...(to.h ? [['data-h', to.h]] : []), ...(to.sub ? [['data-sub', to.sub]] : [])]
  else if (to.t === 'missing') t.attrs = [['class', 'dlink doc missing'], ['title', '없는 문서']]
  else if (to.t === 'rec') t.attrs = [...(to.gone ? [] : [['href', '#/k/' + encodeURIComponent(kid) + '/r/' + encodeURIComponent(to.r)]]), ['class', `dlink rec${to.gone ? ' missing' : ''}`], ['data-a', 'openRec'], ['data-k', kid], ['data-r', to.r], ...(to.gone ? [['title', '없는 기록']] : [])]
  else if (to.t === 'ext') t.attrs = [['href', href], ['class', 'xlink'], ['target', '_blank'], ['rel', 'noopener noreferrer']]
  else if (to.t === 'mail') t.attrs = [['href', href], ['class', 'xlink']]
  else {
    // 경로 꼴이 아닌 괄호 글 — `[단추](설명)` 처럼 쓴 글이다. 링크로 풀지 않고 쓴 그대로 그린다(괄호 안 글이 사라지지 않게)
    const raw = md.normalizeLinkText(href || '')
    const plain = !t.markup && !/^[a-z][a-z0-9+.-]*:|^\/|[#.]/i.test(raw) && !(raw.includes('/') && !/[=\s]/.test(raw))
    // 짝인 link_close 도 span 으로(또는 쓴 그대로)
    for (let j = i + 1; j < tokens.length; j++)
      if (tokens[j].type === 'link_close' && tokens[j].level === t.level) {
        tokens[j].meta = { ...(tokens[j].meta || {}), ...(plain ? { plain: raw } : { dead: true }) }
        break
      }
    return plain ? '[' : '<span class="deadlink" title="열 수 없는 링크">'
  }
  return self.renderToken(tokens, i, opts)
}
// 글 속 항목 값 — `screen:ACA011` 처럼 백틱 안에 `종류:값` 하나만 있고 그 지식 항목 장부(_vocab)에 있는 항목이면 그 이름으로 그리고 누르면 그 항목으로
//   (화면 linkify 의 항목 링크와 같은 꼴 · 열쇠는 title 로) · 장부에 없거나 폐기된 항목 · 코드 울타리(pre)는 그대로
const COORD = /^[A-Za-z_][\w.-]*:[^\s`]+$/
md.renderer.rules.code_inline = (tokens, i, opts, env, self) => {
  const c = tokens[i].content.trim()
  const k = env?.k
  // 링크 글 안(`[\`screen:X\`](…)`)은 링크가 이미 간다 — 그대로
  let inLink = 0
  for (let j = 0; j < i; j++) inLink += tokens[j].type === 'link_open' ? 1 : tokens[j].type === 'link_close' ? -1 : 0
  const v = !inLink && COORD.test(c) && k?.vocab?.coords ? k.vocab.coords.get(c) || k.vocab.coords.get(c.normalize('NFC')) : null
  if (!v || v.deprecated || !v.label) return `<code>${esc(tokens[i].content)}</code>`
  const key = k.vocab.coords.has(c) ? c : c.normalize('NFC')
  return `<span class="ilink coord" data-a="openItem" data-k="${esc(k.id ?? '')}" data-n="${esc(key)}" data-pv="item|${esc(k.id ?? '')}|${esc(key)}" title="${esc(key)}">${esc(v.label)}</span>`
}
md.renderer.rules.link_close = (tokens, i, opts, env, self) => (tokens[i].meta?.plain != null ? `](${esc(tokens[i].meta.plain)})` : tokens[i].meta?.dead ? '</span>' : self.renderToken(tokens, i, opts))

// 글 속 그림 — 이 지식의 첨부(docs|work/assets)만 그린다. 주소는 화면이 채운다(data-att · data-ak).
// 그 밖의 주소(/api/… 등)는 그리지 않는다(같은 출처 그림이 연 사람의 쿠키로 길을 부르지 않게)
md.renderer.rules.image = (tokens, i, opts, env) => {
  const t = tokens[i]
  const src = t.attrGet('src') || ''
  const alt = esc(t.content || '')
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(src)) return `<img src="${esc(src)}" alt="${alt}">`
  const k = env?.k
  let rel = null
  if (k && src && !/^[a-z]+:|^\/|^#/i.test(src)) {
    try { rel = path.posix.normalize(path.posix.join(path.posix.dirname(env.fromPath || ''), decodeURIComponent(src.split(/[?#]/)[0]))).normalize('NFC') } catch {}
  }
  if (rel && (k.atts || []).includes(rel)) return `<img data-att="${esc(rel.replace(/^(docs|work)\/assets\//i, ''))}" data-ak="${esc(k.id)}" alt="${alt}">`
  return `<span class="muted">[그림${alt ? ': ' + alt : ''}]</span>`
}

// 글 속 링크 표기들(코드 울타리 안 · 그림은 빼고) — 렌더와 같은 풀이(linkTarget)로 센다 · 깨진 % 하나가 화면 전체를 깨뜨리지 않게
function hrefsOf(doc) {
  const out = []
  let fence = null
  for (const ln of [doc.intro, ...doc.sections.map((s) => s.body)].join('\n').split('\n')) {
    const f = ln.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (f) {
      fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
      continue
    }
    if (fence) continue
    for (const m of ln.replace(/(`+)[^`]*?\1/g, '').matchAll(/(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) if (!m[1]) out.push(m[2])
  }
  return out
}
// 기록 근거 — 본문 링크 · 참고 줄의 기록(work/ · log/)
export function citesOf(doc, k = null) {
  const out = []
  const refs = (doc.sections || []).flatMap((s) => (s.log || []).map((l) => (String(l).match(/\]\(([^)\s]+)\)/) || [])[1]).filter(Boolean))
  for (const href of [...hrefsOf(doc), ...refs]) {
    const to = linkTarget(k, doc.path, href)
    if (to.t === 'rec' && !out.includes(to.r)) out.push(to.r)
  }
  return out
}
export function linksOf(doc, k = null) {
  const out = []
  for (const href of hrefsOf(doc)) {
    const to = linkTarget(k, doc.path, href)
    if ((to.t === 'doc' || to.t === 'item') && to.d !== doc.id && !out.includes(to.d)) out.push(to.d)
  }
  return out
}
// 참고 줄 → { date, title, id, sub: 'work' | 'log', note } · 메모 줄(옛 경과 · 표 출처 · 표식)은 { note } 만
export function refOf(docPath, line, k = null) {
  const r = parseRefLine(line)
  // 메모 줄 안의 링크(옛 경과의 기록 링크)도 누를 수 있게 — 같은 링크 규칙으로 그린 html
  if (r.kind !== 'rec') return { date: null, title: null, id: null, sub: null, note: r.note, ...(k ? { html: render(k, docPath, r.note).replace(/^<p>|<\/p>\s*$/g, '') } : {}) }
  const to = linkTarget(null, docPath, r.href)
  return { date: r.date, title: r.title, id: to.t === 'rec' ? to.r : null, sub: to.t === 'rec' ? to.sub : null, note: r.note }
}

export function knowledgeRow(k) {
  const when = [k.docs[0]?.mtime, k.works[0] ? isoOfStamp(k.works[0].date) : null].filter(Boolean).sort().pop() || null
  //   docs — 기록 모음(저장 문이 세우는 문서 · 저장 승인 P-D29)은 세지 않는다(새 지식의 「빈 지식」 · 바탕 세우기 안내가 그대로이게)
  return { id: k.id, name: k.name, docs: k.docs.filter((d) => d.id !== RECORDS_DOC).length, records: k.works.length, when }
}

// 기록의 날짜(YYYY-MM-DD HH:MM · 지역 시각) → ISO
export function isoOfStamp(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).toISOString()
}

// 들어온 길 — 보내기(sent/지문 · 글 첫 줄 「…에서 보냄」) · 넣은 파일 · 코드 바뀜 · 그 밖은 세션 · 화면에서 남긴 기록
const routeOf = (w) => (w.tags.some((t) => t.startsWith('sent/')) ? 'send' : w.tags.some((t) => t.startsWith('ingest/')) ? 'file' : w.tags.includes('code-change') ? 'code' : 'sess')
const recRow = (w) => {
  const route = routeOf(w)
  const from = route === 'send' ? (String(w.body).match(/^(.{1,80})에서 보냄/) || [])[1] || '' : route === 'file' ? w.tags.find((t) => t.startsWith('ingest/')).slice(7) : ''
  return { id: w.id, date: w.date, title: w.title, author: w.author, state: w.state, route, ...(from ? { from } : {}), ...(w.tags.some((t) => /^private$/i.test(t)) ? { priv: true } : {}) }
}

export function tree(k) {
  return {
    id: k.id,
    name: k.name,
    readme: k.readme ? render(k, 'README.md', k.readme) : '',
    docs: k.docs.map((d) => ({ id: d.id, title: d.title, when: d.mtime })),
    records: k.works.map(recRow),
    atts: k.atts.map((a) => a.replace(/^(docs|work)\/assets\//i, '')),
    // 차례 장부(core/order.js) — 폴더마다 형제 차례 · 문서가 없는 폴더
    order: k.order?.order || {},
    dirs: k.order?.dirs || [],
  }
}

// 이 문서를 가리키는 것 — 기록(이 문서의 항목을 건드린 것) · 문서(이 문서를 링크한 것) · 이름만 나온 곳
function backlinks(k, d) {
  const recs = k.works.filter((w) => w.touches.some((c) => sectionOf(k, c)?.loc?.doc === d.path))
  const linkers = k.docs.filter((o) => o !== d && linksOf(o, k).includes(d.id))
  const names = [d.title, ...d.sections.flatMap((s) => coordsOfSection(k, d, s.h).flatMap((c) => [labelOf(k, c), ...(k.vocab.coords.get(c)?.aliases || [])]))].filter((x) => x && x.length >= 2)
  const uniq = [...new Set(names)]
  const ments = []
  for (const o of k.docs) {
    if (o === d || linkers.includes(o)) continue
    const s = o.sections.find((s) => uniq.some((x) => `${s.h} ${s.body}`.includes(x)))
    if (s) ments.push({ d: o.id, title: o.title, h: s.h, x: uniq.find((x) => `${s.h} ${s.body}`.includes(x)) })
  }
  return { recs: recs.map(recRow), linkers: linkers.map((o) => ({ id: o.id, title: o.title })), ments }
}

// 기록 ↔ 문서 — 항목 표지(applied)와 기록의 reflects(가져올 곳 이력이 단다)로 잇는다. 건드린 항목(touches)이 없는 넣은 파일 기록도
// 어느 문서 · 항목으로 갔는지, 문서가 어느 기록에서 왔는지 보인다(touches 만 보면 둘 다 0 이었다)
const placedBy = (k, w) => [...k.works, ...k.logs].filter((o) => o !== w && o.reflects?.includes(w.id))
// 상태 「문서에 들어감」(recordState) 과 같은 판정 — 항목 표지가 이 기록(또는 이 기록을 reflects 로 넣은 기록)인 곳만이 아니라
//   저장 문이 넣었다고 적은 항목(넣은 것 칸 · 되돌린 항목 빼고) · 글 그대로 이은 항목(이은 항목 칸 · same 에도 적는다) · 건드린 항목에 더 늦은 기록이 들어 이 기록도 든 곳(reflectedIn)까지.
//   표지만 보면 나중 기록이 같은 항목을 고친 순간 「들어감」 기록의 문서가 「없다」 로 보인다
function landedIn(k, w, ids) {
  const out = new Map()
  const put = new Set() // 글이 든 항목(문서 id · 머리) — 이은 항목에만 있으면 글 그대로
  const add = (d, h, same = false) => {
    if (!out.has(d.id)) out.set(d.id, { id: d.id, title: d.title, hs: [] })
    const x = out.get(d.id)
    if (!x.hs.includes(h)) x.hs.push(h)
    if (!same) put.add(d.id + '\n' + h)
  }
  const done = () => [...out.values()].map((x) => {
    const same = x.hs.filter((h) => !put.has(x.id + '\n' + h))
    return same.length ? { ...x, same } : x
  })
  for (const d of k.docs) {
    for (const s of d.sections) if (s.applied && ids.has(s.applied)) add(d, s.h)
  }
  if (w.state !== 'in') return done()
  if ((w.tags || []).includes('put')) {
    const back = k.revertedItems?.get(w.id)
    for (const x of parsePut(w.body)) {
      if (back?.has(itemKey(x.doc, x.heading))) continue
      const d = k.byDocPath.get(x.doc)
      const s = d?.sections.find((o) => headingMatches(o.h, x.heading || ''))
      if (s) add(d, s.h)
    }
    // 글 그대로(P-D12) — 본문은 그대로 두고 항목에 이은 기록도 「들어감」 이다
    for (const x of parseLinked(w.body)) {
      const d = k.byDocPath.get(x.doc)
      const s = d?.sections.find((o) => headingMatches(o.h, x.heading || ''))
      if (s) add(d, s.h, true)
    }
  }
  for (const c of w.touches) {
    const x = sectionOf(k, c)
    if (x?.doc && x.sec && reflectedIn(k, w, x.sec)) add(x.doc, x.sec.h)
  }
  return done()
}
// 이 문서가 온 곳 — 항목마다 넣은 기록(how: rec) 과 그 기록을 넣은 kmd 이력 기록(how: kmd · 고침 · 다듬기) · 넣은 항목 머리
function originsOf(k, d) {
  const m = new Map()
  const add = (w, how, h) => {
    if (!m.has(w.id)) m.set(w.id, { ...recRow(w), how, hs: [] })
    const x = m.get(w.id)
    if (h != null && !x.hs.includes(h)) x.hs.push(h)
  }
  for (const s of d.sections) {
    const a = s.applied && k.byWork.get(s.applied)
    if (!a) continue
    for (const r of a.reflects || []) { const o = k.byWork.get(r); if (o) add(o, 'rec', s.h) }
    add(a, k.logs.includes(a) ? 'kmd' : 'rec', s.h)
  }
  return [...m.values()].sort((a, b) => (a.how === b.how ? b.date.localeCompare(a.date) : a.how === 'rec' ? -1 : 1))
}

export const atTag = (docId, heading) => 'at/' + sha16(`${docId}\n${String(heading).normalize('NFC')}`).slice(0, 12)
// edit — 편집기용 md · 잠긴 표도 싣는다(Q84 · 읽기만 할 때는 본문이 두 번 실리지 않게 · 「고치기」 를 누를 때 ?edit=1 로)
export function docView(k, docId, { edit = false } = {}) {
  const d = k.docs.find((x) => x.id === docId)
  if (!d) return null
  const last = d.sections.map((s) => s.applied && k.byWork.get(s.applied)).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date))[0]
  const sections = d.sections.map((s) => {
    const coords = coordsOfSection(k, d, s.h)
    // 항목 장부에 없는 항목을 화면에서 고친 기록 — 「at/<문서 · 머리 지문>」 으로 이 항목에 선다(넣을 곳은 관리자가 고른다)
    const at = atTag(d.id, s.h)
    const recs = k.works.filter((w) => w.touches.some((c) => coords.includes(c)) || w.tags.includes(at))
    const by = s.applied && k.byWork.get(s.applied)
    const refs = (s.log || []).map((l) => refOf(d.path, l, k))
    return {
      h: s.h,
      // 본문만 — 출처(refs)는 화면이 참고 칸으로 따로 그린다
      html: render(k, d.path, s.body),
      ...(edit ? editParts(s.body) : {}),

      base: sha16(s.body),
      recs: recs.length,
      // 출처 — 문서 끝 참고 블록의 이 항목 줄(본문 html 에는 나오지 않는다)
      refs,
      by: by ? { id: by.id, date: by.date, author: by.author } : null,
      named: coords.length > 0,
    }
  })
  const links = linksOf(d, k).filter((id) => k.docs.some((o) => o.id === id)).map((id) => ({ id, title: k.docs.find((o) => o.id === id).title }))
  return {
    id: d.id,
    title: d.title,
    path: d.path,
    when: d.mtime,
    intro: d.intro ? render(k, d.path, d.intro) : '',
    sections,
    // 출처 요약 — 항목마다 참고 줄 수
    refs: { n: sections.reduce((a, s) => a + s.refs.length, 0), items: sections.filter((s) => s.refs.length).map((s) => ({ h: s.h, n: s.refs.length })), doc: (d.docLog || []).map((l) => refOf(d.path, l, k)) },
    links,
    backlinks: backlinks(k, d),
    origins: originsOf(k, d),
    last: last ? { date: last.date, author: last.author } : null,
    items: sections.filter((s) => s.named).length,
  }
}

export function recView(k, id) {
  const w = k.byWork.get(id)
  if (!w) return null
  const items = w.touches.map((c) => {
    const x = sectionOf(k, c)
    return { coord: c, name: labelOf(k, c), kind: c.split(':')[0], doc: x?.doc?.id || null, docTitle: x?.doc?.title || null, h: x?.sec?.h || null }
  })
  const fixes = w.fixes.map((f) => k.byWork.get(f)).filter(Boolean).map(recRow)
  const fixedBy = [...k.works, ...k.logs].filter((o) => o.fixes.includes(w.id)).map(recRow)
  // 이 기록이 간 곳 — 이 기록(또는 이 기록을 reflects 로 넣은 기록)이 표지로 남은 항목 · reflects 가 있는 기록이면 그 기록이 넣은 기록
  const via = placedBy(k, w)
  const went = landedIn(k, w, new Set([w.id, ...via.map((o) => o.id)]))
  const from = (w.reflects || []).map((x) => k.byWork.get(x)).filter(Boolean).map(recRow)
  const ingest = w.tags.some((t) => t.startsWith('ingest/')) && !k.logs.includes(w)
  return { ...recRow(w), html: render(k, w.path, w.body), tags: w.tags, items, fixes, fixedBy, went, via: via.map(recRow), from, ...(ingest ? { ingest: { read: w.tags.includes('ingest-read') } } : {}), ...(k.logs.includes(w) ? { log: logKind(w) } : {}) }
}

// 이력의 갈래(설계 3-4) — 가져오기 · 가져올 곳(설정) · 되돌림 · 고침 · 다듬기 · 서식(서식 맞춤) · 버림 · 들이기 · 저장(저장 문이 넣은 기록) · 그 밖은 「이력」(지운 태그의 옛 이력 · O-10) 옛 넣지 못함도)
export function logKind(w) {
  const t = w.tags || []
  if (t.includes('sources')) return /^가져올 곳/.test(w.title) ? '설정' : '가져오기'
  if (t.includes('revert')) return '되돌림'
  if (t.includes('edit')) return '고침'
  if (t.includes('polish')) return '다듬기'
  if (t.includes('format')) return '서식'
  if (t.includes('drop')) return '버림'
  if (t.includes('ledger')) return '장부'
  if (t.includes('structure')) return '짜임'
  if (t.includes('intake')) return '들이기'
  if (t.includes('put')) return '저장'
  return '이력'
}
// 이력 — 지식마다 날짜 순(새 것 위) · 화면 「이력」 한 곳에서 본다
export function logRows(k, { limit = 300 } = {}) {
  return k.logs.slice(0, limit).map((w) => ({ kn: k.id, knName: k.name, id: w.id, date: w.date, author: w.author, title: w.title, kind: logKind(w), body: w.body.replace(/\s+/g, ' ').slice(0, 240) }))
}

// 찾기 — 사다리 결과(core/search.js)를 화면의 찾은 것 줄로. 정확한 이름이면 「문서의 항목」, 아니면 비슷한 글
export function findView(pairs) {
  const hits = []
  let exact = false
  const words = []
  let more = 0
  for (const { k, r } of pairs) {
    const k0 = hits.length
    for (const w of r.words || []) if (!words.includes(w)) words.push(w)
    const secText = (docId, h) => {
      const d = k.docs.find((x) => x.id === docId)
      const sec = d && d.sections.find((x) => x.h === h)
      return { title: d ? d.title : docId, text: sec ? sec.body.replace(/`/g, '').slice(0, 220) : '' }
    }
    for (const c of r.exact) {
      if (!c.doc || !c.heading) continue
      exact = true
      const t = secText(c.doc, c.heading)
      hits.push({ k: k.id, kn: k.name, d: c.doc, title: t.title, h: c.heading, text: t.text, coord: c.coord || null, exact: true, alias: !!c.coord && !!k.vocab.coords.get(c.coord)?.aliases?.length })
    }
    if (exact) continue
    for (const c of r.coords) {
      if (!c.doc || !c.heading) continue
      const t = secText(c.doc, c.heading)
      hits.push({ k: k.id, kn: k.name, d: c.doc, title: t.title, h: c.heading, text: t.text, coord: c.coord || null })
    }
    const body = (p) => p.text.split('\n').slice(1).join(' ').replace(/`/g, '').slice(0, 220)
    for (const p of r.passages) {
      if (p.doc) hits.push({ k: k.id, kn: k.name, d: p.doc, title: k.docs.find((x) => x.id === p.doc)?.title || p.doc, h: p.head, text: body(p), label: p.label })
      else if (p.record) { const w = k.byWork.get(p.record); hits.push({ k: k.id, kn: k.name, r: p.record, title: w?.title || p.record, h: '', text: body(p), label: p.label, state: w?.state || null }) }
    }
    more += (r.more?.coords?.n || 0) + (r.more?.passages?.n || 0)
    for (let i = k0; i < hits.length; i++) hits[i]._rrf = 1 / (60 + (i - k0))
  }
  // 바로잡힌 · 버린 · 되돌린 기록은 맨 뒤로(옛 값이 첫 줄에 오지 않게 · UX G3-01)
  const late = (h) => (h.state === 'fixed' || h.state === 'reverted' ? 1 : 0)
  const sorted = hits.map((h, i) => [h, i]).sort((a, b) => late(a[0]) - late(b[0]) || (b[0]._rrf || 0) - (a[0]._rrf || 0) || a[1] - b[1]).map((x) => { delete x[0]._rrf; return x[0] })
  return { hits: exact ? sorted.filter((h) => h.exact) : sorted.slice(0, 30), toks: words, exact, more }
}

// ── 지식 한 벌의 모양 — 항목으로 보기 · 그래프 · 글 속 항목 이름 · 미리보기 카드가 같이 쓴다 ──
//
// 항목 = 항목 장부의 항목(문서 장부로 닿는 `##` 머리가 있으면 거기) + 장부에 없는 문서의 `##` 머리.
// 항목 열쇠(key)는 coord(종류:값)가 있으면 그것, 없으면 `#문서#머리`.
const KIND = { table: '테이블', screen: '화면', api: 'API', term: '용어', proc: '절차', code: '코드', module: '모듈', issue: '이슈', ops: '운영', prog: '프로그램', batch: '배치', req: '요구사항', func: '기능', arch: '구조', test: '시험', scenario: '시나리오', domain: '업무 영역' }
export const kindOf = (coord) => (coord ? KIND[coord.split(':')[0]] || coord.split(':')[0] : '장부에 없는 항목')
const firstOf = (body) => String(body || '').slice(0, 1500).split('\n').map((l) => l.replace(/[`*#>|]/g, '').trim()).find((l) => l && !/^[-:| ]+$/.test(l)) || ''
const keyOf = (coord, doc, h) => coord || `#${doc}#${h}`

// 글 속 이름 찾기(그래프 「가리킨다」 · 항목의 「이 항목을 쓰는 곳」) — 흔한 말 · 짧은 이름이 가짜 허브가 되지 않게
//   이름 = 항목 값(`화면:PSA010` 의 PSA010) · 라벨 · 별칭. USES_MIN 글자 이상만
//   낱말 경계: 앞 글자가 글자 · 숫자면 안 된다. 영문 · 숫자로 끝나는 이름은 뒤도(PSA 가 PSA010 · OPS-PSA-1 에 걸리지 않게)
//   한 이름이 항목 글의 USES_SHARE 넘게(적어도 USES_SHARE_MIN) 나오면 흔한 말로 보고 세지 않는다
export const USES_MIN = 3, USES_SHARE = 0.1, USES_SHARE_MIN = 20
const LW = /[\p{L}\p{N}]/u, AW = /[A-Za-z0-9]/
export function usesNames(it) {
  const v = it.coord && it.coord.includes(':') ? it.coord.slice(it.coord.indexOf(':') + 1) : null
  return [...new Set([v, it.name, ...(it.aliases || [])].filter((x) => x && [...x].length >= USES_MIN))]
}
export function mentions(text, n) {
  for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + 1)) {
    const p = text[i - 1] || '', p2 = text[i - 2] || '', q = text[i + n.length] || '', q2 = text[i + n.length + 1] || ''
    if (p && (LW.test(p) || (/[-_.]/.test(p) && AW.test(p2) && AW.test(n[0])))) continue
    if (q && AW.test(n[n.length - 1]) && (AW.test(q) || (/[-_]/.test(q) && AW.test(q2)))) continue
    return true
  }
  return false
}

const models = new WeakMap()
export function model(k) {
  if (models.has(k)) return models.get(k)
  const items = []
  const byKey = new Map()
  const add = (it) => {
    if (byKey.has(it.key)) return
    byKey.set(it.key, it)
    items.push(it)
  }
  for (const [coord, v] of k.vocab.coords) {
    if (v.deprecated) continue
    const s = sectionOf(k, coord)
    add({ key: coord, coord, name: v.label, kind: kindOf(coord), doc: s?.sec ? s.doc.id : null, sec: s?.sec?.h || null, aliases: v.aliases, table: coord.startsWith('table:'), first: firstOf(s?.sec?.body) })
  }
  for (const d of k.docs)
    for (const s of d.sections) {
      if (coordsOfSection(k, d, s.h).length) continue
      add({ key: keyOf(null, d.id, s.h), coord: null, name: s.h, kind: '장부에 없는 항목', doc: d.id, sec: s.h, aliases: [], table: false, first: firstOf(s.body) })
    }
  // 기록이 건드렸지만 장부에도 문서에도 없는 항목 — 「문서가 없는 항목」 · 장부에서 폐기된 항목은 deprecated(항목 나무 · 찾기에 서지 않고 그 기록 · 링크로만 연다)
  for (const w of k.works)
    for (const c of w.touches) if (!byKey.has(c) && !c.startsWith('domain:')) add({ key: c, coord: c, name: labelOf(k, c), kind: kindOf(c), doc: null, sec: null, aliases: [], table: c.startsWith('table:'), first: '', ...(k.vocab.coords.get(c)?.deprecated ? { deprecated: true } : {}) })
  const itemOfSec = new Map(items.filter((i) => i.doc).map((i) => [`${i.doc}\n${i.sec}`, i.key]))
  const recs = k.works.map((w) => ({ id: w.id, date: w.date, author: w.author, title: w.title, body: w.body.replace(/\s+/g, ' ').slice(0, 200), state: w.state, fixes: w.fixes, items: w.touches.filter((c) => byKey.has(c)) }))
  // cites — 글 속 기록 링크(../work/…md · 그 글의 근거) · 그래프의 「근거」 선
  const docs = k.docs.map((d) => ({ id: d.id, title: d.title, when: d.mtime, first: firstOf(d.intro || d.sections[0]?.body), links: linksOf(d, k).filter((x) => k.docs.some((o) => o.id === x)), cites: citesOf(d, k).filter((x) => k.byWork.has(x)), items: d.sections.map((s) => itemOfSec.get(`${d.id}\n${s.h}`)).filter(Boolean) }))
  // 이 항목을 쓰는 곳 — 다른 항목의 글에 이 항목 이름 · 별칭이 나온다(테이블 빼고)
  const uses = {}
  const bodies = items.filter((i) => i.doc && !i.table).map((i) => {
    const d = k.docs.find((x) => x.id === i.doc)
    return { key: i.key, text: d?.sections.find((s) => s.h === i.sec)?.body || '' }
  })
  // 2글자 조각 → 그 조각이 든 글들 — 이름마다 가장 드문 조각의 글만 대조한다(gdi 1,200 항목에서 2초 → 수십 ms)
  const grams = new Map()
  bodies.forEach((b, i) => {
    const t = b.text.toLowerCase()
    const seen = new Set()
    for (let j = 0; j < t.length - 1; j++) {
      const g = t.slice(j, j + 2)
      if (seen.has(g)) continue
      seen.add(g)
      if (!grams.has(g)) grams.set(g, [])
      grams.get(g).push(i)
    }
  })
  // 이름마다 그 이름을 쓰는 항목 — 둘 이상이면 누구 것인지 몰라 세지 않는다(usesNames)
  const owners = new Map()
  for (const it of items) for (const n of usesNames(it)) { if (!owners.has(n)) owners.set(n, new Set()); owners.get(n).add(it.key) }
  const common = Math.max(USES_SHARE_MIN, bodies.length * USES_SHARE)
  for (const it of items) {
    if (it.table) continue
    const hit = new Set()
    for (const n of usesNames(it)) {
      if (owners.get(n).size > 1) continue
      const low = n.toLowerCase()
      let best = null
      for (let j = 0; j < low.length - 1; j++) {
        const l = grams.get(low.slice(j, j + 2)) || []
        if (!best || l.length < best.length) best = l
      }
      const got = (best || []).filter((i) => bodies[i].key !== it.key && mentions(bodies[i].text, n))
      if (got.length > common) continue // 글 열에 하나 넘게 나오는 이름은 흔한 말이다
      for (const i of got) hit.add(bodies[i].key)
    }
    if (hit.size) uses[it.key] = [...hit].sort()
  }
  const m = { items, docs, recs, uses }
  models.set(k, m)
  return m
}

// 항목 한 장 — 지금 글(그 문서 안의 그 부분)
export function itemView(k, key) {
  const it = model(k).items.find((x) => x.key === key)
  if (!it) return null
  const d = it.doc && k.docs.find((x) => x.id === it.doc)
  const s = d && d.sections.find((x) => x.h === it.sec)
  const by = s?.applied && k.byWork.get(s.applied)
  return { ...it, docTitle: d ? d.title : null, html: s ? render(k, d.path, s.body) : null, by: by ? { id: by.id, date: by.date, author: by.author } : null }
}
