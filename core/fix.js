// 기록 고치기(정정 기록 · K4 · docs/품질개선/KMD_개편_설계.md 3-6 · S-D23).
//
//   원래 기록은 그대로 두고 「정정: <원래 기록>」 기록을 새로 남긴다. 원래 기록이 들어간 항목(targetsOf)에서 옛 값이
//   글자 그대로 한 곳에만 있으면 Claude 없이 조각으로 바꾼다(ruleFix). 못 한 항목이 하나라도 있으면 저장하지 않고
//   팀 일꾼 들이기 일감(type fix)으로 넘긴다 — 일꾼은 남은 항목마다 조각(FIX_SCHEMA)을 짓고 서버가 규칙 조각과 한 저장으로 넣는다.
//   이 모듈은 쓰지 않는다(판정 · 프롬프트만).

import { sha16 } from './text.js'
import { valuesOf } from './values.js'
import { logHas } from './sections.js'
import { reflectedIn, coordsOfSection } from './knowledge.js'
import { validEdits, locate } from './edits.js'

// 정정 값 — 한 줄 · 200자 안
export const FIX_VALUE_MAX = 200
const squeeze = (s) => String(s).replace(/\s+/g, '')

// 원래 기록이 들어간 항목 — 표지 · 참고 줄이 그 기록을 가리키는 항목(direct)과,
//   그 기록이 건드린 이름의 항목 가운데 더 늦은 기록이 들어가 「넣음」 으로 보이는 항목(reflectedIn · 옛 값이 글에 있을 때만 ruleFix 가 본다)
//   → [{ doc, heading, base, body, direct }]
export function targetsOf(k, rec) {
  const w = k.byWork.get(rec)
  const out = []
  for (const d of k.docs) {
    for (const sec of d.sections) {
      if (!sec.h) continue
      const direct = sec.applied === rec || logHas(sec.log || [], rec)
      const indirect = !direct && !!w && w.touches.some((c) => coordsOfSection(k, d, sec.h).includes(c)) && reflectedIn(k, w, sec)
      if (direct || indirect) out.push({ doc: d.path, title: d.title, heading: sec.h, base: sha16(sec.body), body: sec.body, direct })
    }
  }
  return out
}

// 규칙 — 옛 값(from)이 그 항목 글에 글자 그대로 꼭 한 번 · 값 장부에도 있으면 조각 { find: from, replace: to }.
//   여러 곳 · 없음(문장이 바뀜)이면 left. from · to 가 없으면 모든 항목이 left.
//   간접 항목(direct 아님)은 옛 값이 글에 있을 때만 본다(없으면 그 기록의 값이 든 항목이 아니다)
//   → { sections: [{ doc, heading, base, edits }], left: [{ doc, heading, base, why }] }
export function ruleFix(targets, { from, to } = {}) {
  const sections = []
  const left = []
  const has = typeof from === 'string' && from.trim() && typeof to === 'string'
  for (const t of targets) {
    if (!has) {
      if (t.direct) left.push({ doc: t.doc, heading: t.heading, base: t.base, why: '옛 값 · 새 값을 적지 않았다' })
      continue
    }
    const at = locate(t.body, from)
    if (!t.direct && at.why === '지금 글에 없다') continue
    if (at.why) {
      left.push({ doc: t.doc, heading: t.heading, base: t.base, why: at.why === '지금 글에 없다' ? '옛 값이 글에 없다(문장이 바뀌었다)' : '옛 값이 글에 여러 곳 있다' })
      continue
    }
    if (!valuesOf(t.body).has(squeeze(from))) {
      left.push({ doc: t.doc, heading: t.heading, base: t.base, why: '옛 값이 문장 속 말이다(값이 아니다)' })
      continue
    }
    sections.push({ doc: t.doc, heading: t.heading, base: t.base, edits: [{ find: from, replace: to }] })
  }
  return { sections, left }
}

// 정정 기록 초안 — 원 기록의 제목 · 이름을 잇는다 · 「## 바뀐 것」 의 「옛 → 새」 가 항목 검사의 값 근거다
export function fixRecordOf(w, { title, body, from, to }) {
  const t = String(title || '').replace(/\s+/g, ' ').trim() || `정정: ${w.title}`
  const lead = String(body || '').trim() || '앞 기록의 값을 바로잡는다.'
  const change = typeof from === 'string' && from.trim() && typeof to === 'string' ? `\n\n## 바뀐 것\n- ${from} → ${to}` : ''
  return {
    title: t.slice(0, 200),
    body: `${lead}${change}`,
    fixes: [w.id],
    ...(w.touches.length ? { touches: [...w.touches] } : { touchesEmpty: '정정: 원래 기록에 걸린 이름이 없다' }),
  }
}

// 팀 일꾼이 남은 항목마다 짓는 조각(S-D23)
export const FIX_SCHEMA = {
  type: 'object',
  properties: {
    updates: {
      type: 'array',
      description: '남은 항목마다: 그 항목 글에서 옛 값이 든 곳을 새 값으로 고치는 조각(find 는 지금 글에 꼭 한 번 · replace 는 바꿀 글)',
      items: {
        type: 'object',
        properties: {
          doc: { type: 'string' },
          heading: { type: 'string' },
          base: { type: 'string', description: '항목에 적힌 base 그대로' },
          edits: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'] } },
        },
        required: ['doc', 'heading', 'edits'],
      },
    },
    why: { type: 'string' },
  },
  required: ['updates'],
}

// 정정 프롬프트 — g: 서버 재료 { type: 'fix', src: { title, from, to, md }, targets: [{ doc, title, heading, base, body, why }] }
//   첫 줄은 시험의 가짜 claude 갈래와 맞춘다(「정정 기록 하나를 항목에 반영한다」) · 항목은 끝에 둔다
export function corrPromptOf(g, { writeRules = '' } = {}) {
  const src = g.src || {}
  return [
    '정정 기록 하나를 항목에 반영한다. 아래 항목마다 옛 값이 든 곳을 새 값으로 고치는 조각(edits)을 짓는다. kmd 가 검사해 넘은 조각은 정정 기록과 한 번에 문서에 들어간다.',
    [
      '조각:',
      '- find 는 지금 항목 글에 꼭 한 번 나오는 글이다. 옛 값이 여러 번 나오면 그 값이 든 문장을 통째로 find 로 잡는다.',
      '- replace 는 find 의 옛 값만 새 값으로 바꾼 글이다. 다른 말 · 값은 그대로 둔다. 바꿀 곳이 없는 항목은 updates 에 넣지 않는다.',
      '- base 는 항목에 적힌 base 를 그대로 싣는다. 정정 기록에 없는 값을 지어내지 않는다.',
    ].join('\n'),
    writeRules,
    'JSON 으로만 답한다.',
    `바꿀 값: ${src.from || '(적지 않음)'} → ${src.to || '(적지 않음)'}`,
    `정정 기록: ${src.title || ''}\n${String(src.md || '').slice(0, 4000)}`,
    `항목:\n${(g.targets || []).map((t) => `[item ${t.doc} › ${t.heading}]\n(base ${t.base})\n${t.body}`).join('\n\n')}`,
  ].filter(Boolean).join('\n\n')
}
export function corrRetryPromptOf(g, draft, why, opt = {}) {
  return [corrPromptOf(g, opt), `지난 초안이 kmd 검사에 걸렸다: ${String(why || '').slice(0, 300)}\n걸린 까닭만 고쳐 다시 짓는다.\n지난 초안:\n${JSON.stringify(draft ?? null).slice(0, 20_000)}`].join('\n\n')
}

// 일꾼 조각 → 저장 조각 — 남은 항목(left)에 든 것만 · base 는 일꾼에게 보인 것(seen) · 모양이 틀리면 { ok: false, why }
export function fixDraftToSections(left, seen, draft) {
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.updates)) return { ok: false, why: '초안 모양이 아니다: updates 가 없다' }
  const out = []
  for (const u of draft.updates) {
    if (!u || typeof u !== 'object' || typeof u.doc !== 'string' || typeof u.heading !== 'string') return { ok: false, why: '초안 모양이 아니다: updates 의 doc · heading' }
    const doc = `docs/${u.doc.replace(/^docs\/|\.md$/g, '')}.md`
    const heading = u.heading.trim()
    const t = left.find((x) => x.doc === doc && x.heading === heading)
    if (!t) continue // 남은 항목이 아닌 것은 넣지 않는다(규칙이 한 항목 · 원래 기록이 들지 않은 항목)
    if (out.some((x) => x.doc === doc && x.heading === heading)) return { ok: false, why: `같은 항목을 두 번 고쳤다: ${heading}` }
    const v = validEdits(u.edits)
    if (!v.ok) return { ok: false, why: `조각이 지금 글에 맞지 않는다: ${v.why}` }
    const base = seen?.find((x) => x.doc === doc && x.heading === heading)?.base || t.base
    out.push({ doc, heading, base, edits: u.edits.map((e) => ({ find: String(e.find), replace: String(e.replace) })) })
  }
  return { ok: true, sections: out }
}
