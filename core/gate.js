// 검사 — 새 글(초안 · 조각으로 만든 글)이 지식에 들어가도 되나(docs/kmd_권한_모델.md 7절 · docs/kmd_문서_작성기준.md 3 ~ 5절).
//
//   G1 모양 · 기록마다 넣음(used) 또는 둠(left) · G2 base · G4 값 대조(빠진 값 · 지어낸 값 · 옛 값 빠짐) ·
//   G5 크기 · G6 표지(항목 머리 # · ## · applied · 프런트매터 · script — 소제목 ### 아래는 된다). 못 넘으면 { ok:false, why }.
//   초안 글 검사는 저장과 같은 문서 꼴 검사(core/docformat.js formatProblems)를 쓴다.
//
//   S2 에서 core/tidy.js 에서 옮겼다(tidy.js 는 다시 내보낸다 · docs/품질개선/KMD_개편_설계.md 3-1).
//   check 는 옛 정리 묶음(g)의 갈래 나누기다 — 정리가 걷히는 S13 까지만. 저장 문(hub.save · S4)은 checkSection(k, { doc, heading, base, content, record, spread, legacyPend }) 을 쓴다.

import { sha16 } from './text.js'
import { guardNewDoc } from './guard.js'
import { sectionOf, reflectedIn } from './knowledge.js'
import { formatProblems, lintSection } from './docformat.js'
import { splitBlocks, hasBlockMarker } from './baseline.js'
// 코드 바뀜 기록(code-change)은 차이 속의 수를 다 볼 수 없다 — 「바뀐 값」 의 새 값만 글에 있어야 한다
import { newValuesOf } from './codechange.js'
import { valuesOf, mustValues, oldValues, namesIn, groundedIn } from './values.js'
import { applyEdits as applyPatch } from './edits.js'
import { docRel } from './ingest.js'

// 초안 짜임 알림 — 머리 단계 건너뜀 · 5단계 머리(거절하지 않는다 · 결과에 lint 로 싣는다)
export function draftLint(outs) {
  const lint = outs.flatMap((o) => lintSection(o))
  return lint.length ? { lint } : {}
}
// 초안 글 검사 — 저장의 문서 꼴 검사 + 프런트매터 · script · 저절로 채우는 표를 고쳤나(cur 의 표와 같아야 한다)
export function draftBad(t, cur = '', { doc = null, old = null } = {}) {
  if (/^---\s*$/m.test(t)) return '프런트매터 줄(---)'
  if (/<script/i.test(t)) return 'script'
  // 지금 글에 이미 있던 줄은 초안 탓이 아니다(옛 들이기 · 옛 정리 · 손으로 쓴 줄) — 새로 든 줄만
  const p = formatProblems(t, { doc, old })
  if (p.length) return p.slice(0, 2).map((x) => `${x.line}째 줄 ${x.what}`).join(' / ')
  if (hasBlockMarker(t) && JSON.stringify(splitBlocks(t).blocks) !== JSON.stringify(splitBlocks(cur).blocks)) return '저절로 채우는 표를 고쳤다'
  return null
}

// 조각 초안을 지금 글에 댄다(옛 tidy applyEdits(cur, d)) — find 는 꼭 한 번 맞아야 한다(두 곳 · 없음은 거절: 엉뚱한 곳을 고치지 않게) ·
//   rewrite 면 그 글 · 빈 조각이면 지금 글 그대로
export function applyDraft(cur, d) {
  if (typeof d.rewrite === 'string' && d.rewrite.trim()) return { content: d.rewrite }
  if (!Array.isArray(d.edits)) return { why: '초안 모양이 아니다' }
  if (!d.edits.length) return { content: String(cur || '') }
  // 대는 법은 제안(core/propose.js)과 하나 — 꼭 한 번 · 겹치지 않음 · 원문 그대로(core/edits.js)
  const r = applyPatch(String(cur || ''), d.edits)
  return r.ok ? { content: r.text } : { why: `조각이 지금 글에 맞지 않는다: ${r.why}` }
}

// 검사 — { ok, why, changed: [{from, to}] } · 정리 묶음의 갈래(ingest · touches · section)로 나눈다
export function check(k, g, d) {
  if (!d || typeof d !== 'object') return { ok: false, why: '초안 모양이 아니다' }
  if (g.kind === 'ingest') return checkIngest(k, g, d)
  if (g.kind === 'touches') {
    if (!Array.isArray(d.touches)) return { ok: false, why: '초안 모양이 아니다' }
    const allowed = new Set(g.candidates.map((c) => c.coord))
    if (d.touches.some((c) => !allowed.has(c))) return { ok: false, why: '후보 밖의 이름을 골랐다' }
    return { ok: true, changed: [] }
  }
  return checkSectionDraft(k, g, d)
}

// 항목 한 곳의 초안 검사(옛 check 의 section 갈래) — g: { coord, base, heading, records[] } · d: { content | edits | rewrite, used[], left[], drop[] }
export function checkSectionDraft(k, g, d) {
  if (typeof d.content !== 'string' && (Array.isArray(d.edits) || typeof d.rewrite === 'string')) {
    const a = applyDraft(g.content || '', d)
    if (a.why) return { ok: false, why: a.why }
    d.content = a.content
  }
  if (typeof d.content !== 'string' || !Array.isArray(d.used) || !Array.isArray(d.left)) return { ok: false, why: '초안 모양이 아니다' }
  const ids = g.records.map((r) => r.id)
  // 묶음 답(한 문서의 항목 여럿)은 다른 항목의 기록 id 를 섞어 말하곤 한다 — 이 항목의 것만 본다(넣기도 같다 · planSave).
  //   다른 기록의 값이 글에 들면 아래 지어낸 값 검사가 막는다
  const said = [...d.used, ...d.left.map((x) => x?.id)].filter((x) => ids.includes(x))
  if (!said.length && [...d.used, ...d.left].length) return { ok: false, why: '받지 않은 기록을 말했다' }
  if (ids.some((x) => !said.includes(x))) return { ok: false, why: '빠뜨린 기록이 있다' }
  // G2 — 지금 글이 재료를 줄 때와 같나
  const x = sectionOf(k, g.coord)
  const whole = x?.sec ? x.sec.body : ''
  if (sha16(whole) !== g.base) return { ok: false, why: '그사이 항목이 바뀌었다. 다음 정리 때 다시 만든다', stale: true }
  // 그사이 같은 항목에 새 기록이 왔으면 같이 넣어야 한다(표지가 그 기록까지 「넣음」 으로 보이게 되므로)
  const pendNow = k.works.filter((w) => w.state === 'pend' && w.touches.includes(g.coord) && !reflectedIn(k, w, x?.sec)).map((w) => w.id)
  if (pendNow.some((x) => !ids.includes(x))) return { ok: false, why: '그사이 새 기록이 왔다. 다음 정리 때 같이 넣는다', stale: true }
  // 값 · 크기는 본문끼리 견준다(항목 글은 본문만 · 참고 줄은 저장이 지킨다)
  const cur = whole
  // G6 — 문서 꼴(기록 링크 · 시스템 주소 · 주석 · 경과 · 항목 머리) · 프런트매터 · script(소제목 ### 아래는 된다)
  const bad = draftBad(d.content, cur, { doc: x?.loc?.doc || null, old: cur })
  if (bad) return { ok: false, why: `글에 머리 · 표지가 들었다: ${bad}` }
  if (!d.content.trim() && cur.trim()) return { ok: false, why: '글을 비웠다' }
  // G5 — 근거보다 크게 쓰지 않는다
  const used = g.records.filter((r) => d.used.includes(r.id))
  const budget = cur.length + used.reduce((a, r) => a + r.body.length + r.title.length, 0) * 1.5 + 300
  if (d.content.length > budget) return { ok: false, why: '근거보다 크게 썼다' }
  // G4 — 값 대조: 넣은 기록의 값이 글에 있나(빠진 값) · 글의 값이 옛 글이나 기록에 있나(지어낸 값)
  const drop = new Set((d.drop || []).map((v) => String(v).replace(/\s+/g, '')))
  const now = valuesOf(d.content)
  const oldV = valuesOf(cur)
  const vOf = (rs) => new Set(rs.flatMap((r) => [...valuesOf(r.body + ' ' + r.title)]))
  const recV = vOf(used)
  // 코드 바뀜 기록은 「바뀐 값」 의 새 값만 글에 있어야 한다(차이 속의 다른 수 · 옛 값까지 요구하면 늘 남는다) ·
  //   옛 기록(지금 글에 더 늦게 쓴 기록이 이미 들어갔다)의 값은 글에 없어도 된다 — 더 새 값이 이겼을 수 있다
  //   여러 항목에 걸린 기록(spread)의 값은 그 항목들에 나뉜다 — 항목 하나에 다 요구하면 늘 남는다(받은 것 「다시 · N번째」)
  //   항목 머리에 있는 값(이슈 번호 같은 그 항목의 이름)은 글에 다시 쓰지 않아도 된다
  const headV = valuesOf(g.heading)
  const missing = [...new Set(used.filter((r) => !r.old && !r.spread).flatMap((r) => (r.code ? newValuesOf(r.body) : mustValues(r.body))))].filter((v) => !now.has(v) && !drop.has(v) && !headV.has(v))
  if (missing.length) return { ok: false, why: `기록의 값이 글에 없다: ${missing.slice(0, 3).join(' · ')}` }
  // 지식에 있는 이름(같은 문서의 항목 머리 · 이름 장부의 이름)을 가리키는 것은 지어낸 값이 아니다(`DPMS-ISS-18` 같은 관련 항목)
  const named = namesIn(k, x?.doc)
  const grounded = groundedIn(cur + ' ' + used.map((r) => r.body + ' ' + r.title).join(' '), oldV, recV)
  const invented = [...now].filter((v) => !oldV.has(v) && !recV.has(v) && !named.has(v) && !grounded(v))
  if (invented.length) return { ok: false, why: `근거에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}` }
  const gone = [...oldV].filter((v) => !now.has(v))
  const came = [...now].filter((v) => !oldV.has(v))
  // 옛 글의 값은 기록이 바꾼 것만 빠진다(작성기준 3절 5) — drop 에 적었거나 기록의 「옛 → 새」 왼쪽에 있는 값 ·
  //   그 밖의 값이 빠지면 옛 글 사실을 잃은 것이다(「Windows 10 · PostgreSQL 16」 이 값 바뀜에 섞여 묻지 않고 들어가던 것)
  //   코드 바뀜 기록은 「바뀐 값: 옛 → 새 · …」 줄의 옛 값
  const codeOld = (b) => ((String(b).match(/바뀐 값:? ([^\n]+)/) || [])[1] || '').split(/ — |: /)[0].split(' · ').flatMap((p) => (p.includes(' → ') ? [...valuesOf(p.split(' → ')[0])] : []))
  const told = new Set([...drop, ...used.flatMap((r) => [...oldValues(r.body), ...(r.code ? codeOld(r.body) : [])].map((v) => v.replace(/\s+/g, '')))])
  const lost = gone.filter((v) => !told.has(v.replace(/\s+/g, '')))
  if (lost.length) return { ok: false, why: `옛 글의 값이 빠졌다: ${lost.slice(0, 3).join(' · ')}` }
  // 옛 기록은 지금 글의 값을 바꾸지 못한다 — 빠진 값이 있는데 새로 든 값이 옛 기록에서만 왔으면 되돌림이다
  const newerV = vOf(used.filter((r) => !r.old))
  const back = vOf(used.filter((r) => r.old))
  if (gone.length && came.some((v) => back.has(v) && !newerV.has(v))) return { ok: false, why: '더 늦게 쓴 기록이 이미 들어간 항목: 옛 기록은 값을 바꾸지 않는다' }
  const changed = gone.length && came.length ? [{ from: gone.join(' · '), to: came.join(' · ') }] : []
  return { ok: true, changed, ...draftLint([d.content]) }
}

// 저장 문의 항목 검사(S4 · docs/품질개선/KMD_개편_설계.md 3-3) — 사람 · 세션이 보낸 새 글(content · 조각을 댄 글) 하나를 지금 지식에 대어 본다.
//   { doc, heading } — 항목 자리(문서 경로 docs/x.md · 머리) · base — 보낸 쪽이 읽은 지문(이미 있는 항목이면 꼭) ·
//   record — 함께 보낸 기록({ title, body }) · spread — 조각이 여럿이라 기록의 값이 항목들에 나뉜다(빠진 값은 부르는 쪽이 합쳐서 본다) ·
//   legacyPend — 이 항목에 아직 안 들어간 개편 전 기록 id(있으면 넣지 않는다: 들어가면 그 기록까지 「넣음」 으로 보이므로)
//   → { ok, why, code, stale, changed: [{ from, to }], lint } · code: conflict · legacy-mix · format · values
//   크기(G5 근거보다 크게)는 보지 않는다 — 사람 · 세션이 항목 전체를 다시 쓰는 일은 정리 초안과 다르다
export function checkSection(k, { doc, heading, base, content, record, spread = false, legacyPend = [] }) {
  if (typeof content !== 'string') return { ok: false, code: 'format', why: '항목 글이 없다' }
  const d = k.byDocPath.get(doc)
  const sec = d ? d.sections.find((s) => s.h === heading) || null : null
  const cur = sec ? sec.body : ''
  if (sec && (!base || String(base) !== sha16(cur))) return { ok: false, code: 'conflict', stale: true, why: base ? '그사이 항목이 바뀌었다. section 으로 다시 읽고 그 위에서 다시 짓는다' : '이미 있는 항목이다. section 이 준 base 를 같이 보낸다(그사이 남이 고친 글을 덮지 않게)' }
  if (legacyPend.length) return { ok: false, code: 'legacy-mix', why: `이 항목에 개편 전 기록 ${legacyPend.length} 이 아직 안 들어갔다: 지식관리자가 [옛 기록 다시 들이기] 를 하면 풀린다` }
  const bad = draftBad(content, cur, { doc, old: sec ? cur : null })
  if (bad) return { ok: false, code: bad === '저절로 채우는 표를 고쳤다' ? 'machine' : 'format', why: `글에 머리 · 표지가 들었다: ${bad}` }
  if (!content.trim() && cur.trim()) return { ok: false, code: 'format', why: '글을 비웠다. 항목을 지우는 일은 지식관리자가 화면에서 한다' }
  const body = String(record?.body || '')
  const title = String(record?.title || '')
  // 저절로 채우는 표의 값은 견주지 않는다 — 표는 저장이 원래 것을 되붙인다(core/baseline.js keepBlocks)
  const plain = (t) => (hasBlockMarker(t) ? splitBlocks(t).text.replace(/\u0000block\d+\u0000/g, '') : t)
  const now = valuesOf(plain(content))
  const oldV = valuesOf(plain(cur))
  const recV = valuesOf(body + ' ' + title)
  // 빠진 값 — 기록이 「바뀐 것」 에 적은 새 값이 글에 있어야 한다(항목 머리에 있는 값은 다시 쓰지 않아도 된다)
  if (!spread) {
    const headV = valuesOf(heading)
    const missing = mustValues(body).filter((v) => !now.has(v) && !headV.has(v))
    if (missing.length) return { ok: false, code: 'values', why: `기록의 값이 글에 없다: ${missing.slice(0, 3).join(' · ')}` }
  }
  // 지어낸 값 — 글의 값은 옛 글이나 기록에 있어야 한다(같은 문서의 항목 머리 · 이름 장부의 이름은 된다)
  const named = namesIn(k, d)
  const grounded = groundedIn(plain(cur) + ' ' + body + ' ' + title, oldV, recV)
  const invented = [...now].filter((v) => !oldV.has(v) && !recV.has(v) && !named.has(v) && !grounded(v))
  if (invented.length) return { ok: false, code: 'values', why: `근거에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}` }
  // 옛 글의 값은 기록이 「옛 → 새」 로 말한 것만 빠진다(작성기준 3절 5)
  const gone = [...oldV].filter((v) => !now.has(v))
  const came = [...now].filter((v) => !oldV.has(v))
  const told = new Set(oldValues(body).map((v) => v.replace(/\s+/g, '')))
  const lost = gone.filter((v) => !told.has(v.replace(/\s+/g, '')))
  if (lost.length) return { ok: false, code: 'values', why: `옛 글의 값이 빠졌다: ${lost.slice(0, 3).join(' · ')}. 바꾼 값이면 기록의 바뀐 것에 「옛 값 → 새 값」 으로 적는다` }
  const changed = gone.length && came.length ? [{ from: gone.join(' · '), to: came.join(' · ') }] : []
  return { ok: true, changed, ...draftLint([content]) }
}

// 넣은 파일 검사 — 모양 · 후보 문서만 고친다 · 새 문서 경로 · 지문(그사이 바뀜) · 표지 · 크기 · 값 대조(빠짐 · 지어냄)
const oneLineH = (h) => typeof h === 'string' && h.trim() && !/[\r\n]/.test(h) && h.length <= 120
export function checkIngest(k, g, d) {
  const ups = Array.isArray(d.updates) ? d.updates : null
  const nd = d.newDoc && typeof d.newDoc === 'object' ? d.newDoc : null
  if (!ups || (nd && !Array.isArray(nd.sections))) return { ok: false, why: '초안 모양이 아니다' }
  // 새 문서는 ## 항목으로만 세운다(K14-1 · S-D31) — 항목이 없는 새 문서는 좌표가 서지 않는다
  if (nd && !nd.sections.length) return { ok: false, why: '새 문서는 ## 항목으로 세운다' }
  if (!ups.length && !nd?.sections?.length) return { ok: false, why: '넣을 곳을 고르지 않았다' }
  const outs = []
  const olds = []
  let old = ''
  const changed = []
  for (const u of ups) {
    const c = g.docs.find((x) => x.doc === docRel(u.doc))
    if (!c) return { ok: false, why: '후보 밖의 문서를 고쳤다' }
    if (!oneLineH(u.heading) || typeof u.content !== 'string') return { ok: false, why: '초안 모양이 아니다' }
    const s = c.sections.find((x) => x.h === u.heading.trim())
    // 그사이 그 항목이 바뀌었나
    const cur = k.byDocPath.get(c.doc)?.sections.find((x) => x.h === u.heading.trim())
    if (s && (!cur || sha16(cur.body) !== s.base)) return { ok: false, why: '그사이 항목이 바뀌었다. 다음 정리 때 다시 만든다', stale: true }
    const curBody = cur ? cur.body : ''
    if (s && !u.content.trim() && curBody.trim()) return { ok: false, why: '글을 비웠다' }
    if (cur) {
      old += '\n' + curBody
      const a = valuesOf(curBody)
      const b = valuesOf(u.content)
      const gone = [...a].filter((v) => !b.has(v))
      const came = [...b].filter((v) => !a.has(v))
      if (gone.length && came.length) changed.push({ from: gone.join(' · '), to: came.join(' · ') })
    }
    outs.push(u.content)
    olds.push({ doc: c.doc, old: cur ? curBody : null })
  }
  if (nd) {
    const p = String(nd.path || '').replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '').trim()
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..' || x.length > 80) || /[<>:"|?*\u0000-\u001f]/.test(p)) return { ok: false, why: '새 문서 경로가 아니다' }
    if (k.byDocPath.get(docRel(p))) return { ok: false, why: '이미 있는 문서다. 새 문서가 아니라 고치기로' }
    if (k.forms) {
      const gd = guardNewDoc(k.forms, docRel(p), nd.sections.map((s) => String(s?.heading || '').trim()))
      if (gd.errors.length) return { ok: false, why: gd.errors[0].message }
    }
    for (const s of nd.sections) {
      if (!oneLineH(s?.heading) || typeof s.content !== 'string') return { ok: false, why: '초안 모양이 아니다' }
      outs.push(s.content)
      olds.push({ doc: docRel(p), old: null })
    }
  }
  const bad = outs.map((o, i) => draftBad(o, '', olds[i])).find(Boolean)
  if (bad) return { ok: false, why: `글에 머리 · 표지가 들었다: ${bad}` }
  const text = outs.join('\n')
  if (text.length > old.length + g.record.body.length * 1.5 + 500) return { ok: false, why: '근거보다 크게 썼다' }
  // 파일의 글을 거의 옮기지 않았다(값이 없는 글도 잃지 않게) — 머리 · 제목 줄을 뺀 글의 3할은 넘어야 한다
  const plain = (t) => String(t).replace(/^#{1,6} .*$/gm, '').replace(/\s+/g, '')
  if (plain(text).length < plain(g.record.body).length * 0.3 && !ups.length) return { ok: false, why: '파일의 글을 거의 옮기지 않았다' }
  const now = valuesOf(text)
  const recV = valuesOf(g.record.body + ' ' + g.record.title + ' ' + g.record.file)
  const oldV = valuesOf(old)
  // 파일의 값은 빠짐없이 — 다른 후보 문서에 이미 있는 값 · 새 문서 이름에 든 값은 거기 있으므로 괜찮다 · 파일의 제목 줄(# …)은 문서 이름이 된다
  const elsewhere = valuesOf(g.docs.flatMap((c) => c.sections.map((s) => s.body)).join('\n') + ' ' + (nd ? nd.path : ''))
  const missing = [...valuesOf(g.record.body.replace(/^# .*$/gm, ''))].filter((v) => !now.has(v) && !elsewhere.has(v))
  if (missing.length) return { ok: false, why: `파일의 값이 글에 없다: ${missing.slice(0, 3).join(' · ')}` }
  const grounded = groundedIn(g.record.body + ' ' + g.record.title + ' ' + g.record.file + ' ' + old, recV, oldV)
  const invented = [...now].filter((v) => !recV.has(v) && !oldV.has(v) && !grounded(v))
  if (invented.length) return { ok: false, why: `근거에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}` }
  return { ok: true, changed, ...draftLint(outs) }
}
