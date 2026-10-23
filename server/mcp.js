// MCP — Claude Code 세션이 kmd 를 읽고 쓰는 길(Streamable HTTP · JSON 응답 하나).
//
// 도구 넷(K0): brief(지금 무엇이 있나) · match(이름으로 찾기) · section(항목 글 읽기) · save(기록 남기기).
// 세션 응답의 말은 사람 화면과 같은 쉬운 말로 쓴다.
//
// SDK 없이 JSON-RPC 몇 갈래만 받는다 — initialize · tools/list · tools/call · ping. 서버가 세션을
// 기억하지 않으므로(무상태) 다시 띄워도 세션이 끊기지 않는다.

import { KmdError } from '../core/errors.js'
import { labelOf, sectionOf, coordsOfSection, pendPick } from '../core/knowledge.js'
import { headingMatches } from '../core/sections.js'
import { VERSION } from './version.js'
import { sha16 } from '../core/text.js'


const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = [
  'kmd 는 팀과 내 PC 의 지식이다 — 문서(항목 = ## 머리)와 기록(누가 무엇을 왜 바꿨나).',
  '일을 시작할 때 brief 로 무엇이 있나 본다. 이름을 알면 match 로 그 항목을 찾고 section 으로 지금 글을 읽는다.',
  '일을 마치면 save 로 기록을 남긴다 — 바뀐 값 · 까닭 · 건드린 이름(touches)을 적는다. 항목 글을 고쳤으면 sections 에 새 글을 같이 보낸다.',
].join('\n')

const str = (description) => ({ type: 'string', description })
const TOOLS = [
  {
    name: 'brief',
    description: '지금 kmd 에 무엇이 있나 — 지식 목록 · 지식 하나의 문서 · 최근 기록 · 아직 문서에 안 넣은 기록. 일을 시작할 때 한 번.',
    inputSchema: { type: 'object', properties: { knowledge: str('지식 id(없으면 목록)') } },
  },
  {
    name: 'match',
    description: '이름으로 항목을 찾는다 — 정한 이름 · 다른 이름 · 문서의 머리 · 문서 이름. 찾은 것마다 지식 · 문서 · 머리 · 이름(coord)을 준다.',
    inputSchema: { type: 'object', properties: { q: str('찾을 이름'), knowledge: str('지식 id(없으면 전체)') }, required: ['q'] },
  },
  {
    name: 'section',
    description: '항목 하나의 지금 글 · 지문(base) · 그 항목을 건드린 기록(아직 문서에 안 넣은 것은 최신 8). 이름(coord) 또는 문서 · 머리로 가리킨다. 그 항목을 고쳐 save 할 때 base 를 같이 보내면 그사이 남이 바꿨을 때 덮지 않는다.',
    inputSchema: { type: 'object', properties: { knowledge: str('지식 id'), coord: str('이름 — 예 proc:헬스 체크'), doc: str('문서 — 예 배포절차'), heading: str('머리 — 예 헬스 체크') }, required: ['knowledge'] },
  },
  {
    name: 'save',
    description: '기록을 남긴다 — 제목 · 글 · 건드린 이름. 항목 글을 고쳤으면 sections 에 새 글 전체를 같이 보낸다(그 항목이 갈아 끼워진다). 한 번에 한 묶음으로 남는다.',
    inputSchema: {
      type: 'object',
      properties: {
        knowledge: str('지식 id'),
        record: {
          type: 'object',
          properties: {
            title: str('한 줄 제목 — 「무엇 — 어떻게」'),
            body: str('글 — 바뀐 값 · 까닭'),
            touches: { type: 'array', items: { type: 'string' }, description: '건드린 이름(coord) — 예 proc:헬스 체크' },
            tags: { type: 'array', items: { type: 'string' } },
            fixes: { type: 'array', items: { type: 'string' }, description: '바로잡는 기록 id' },
          },
          required: ['title', 'body'],
        },
        sections: {
          type: 'array',
          items: { type: 'object', properties: { coord: str('이름'), doc: str('문서'), heading: str('머리'), content: str('항목의 새 글 전체(머리 줄 빼고)'), base: str('section 이 준 지문 — 읽은 뒤 바뀌었으면 거절') }, required: ['content'] },
        },
      },
      required: ['knowledge', 'record'],
    },
  },
]

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

export function makeMcp(store) {
  const tools = {
    async brief({ knowledge } = {}, ctx) {
      if (!knowledge) {
        const ks = await store.all(ctx)
        return {
          knowledge: ks.map((k) => ({ id: k.id, name: k.name, docs: k.docs.length, records: k.works.length, notYetInDocs: k.works.filter((w) => w.state === 'pend').length })),
          next: ks.length ? 'brief { knowledge } 로 지식 하나를 본다' : '아직 지식이 없다',
          stops: (await store.stops(ctx)).map((l) => l.text),
        }
      }
      const k = await store.get(knowledge, ctx)
      return {
        id: k.id,
        name: k.name,
        docs: k.docs.map((d) => ({ doc: d.id, title: d.title, headings: d.sections.map((s) => s.h) })),
        recent: k.works.slice(0, 10).map((w) => ({ id: w.id, date: w.date, author: w.author, title: w.title })),
        notYetInDocs: k.works.filter((w) => w.state === 'pend').map((w) => ({ id: w.id, date: w.date, title: w.title })),
        stops: (await store.stops(ctx, k.id)).map((l) => l.text),
      }
    },

    async match({ q, knowledge }, ctx) {
      if (!q || typeof q !== 'string') throw new KmdError('E_INPUT', '찾을 이름(q)이 없다')
      const nq = norm(q)
      const ks = knowledge ? [await store.get(knowledge, ctx)] : await store.all(ctx)
      const out = []
      const score = (names) => Math.min(...names.map((n) => { const x = norm(n); return x === nq ? 0 : x.startsWith(nq) ? 1 : x.includes(nq) ? 2 : 9 }))
      for (const k of ks) {
        const seen = new Set()
        for (const [coord, v] of k.vocab.coords) {
          const s = score([coord, coord.split(':').slice(1).join(':'), v.label, ...v.aliases])
          if (s > 2) continue
          const x = sectionOf(k, coord)
          if (x?.sec) seen.add(`${x.doc.id}#${x.sec.h}`)
          out.push({ s, knowledge: k.id, coord, name: v.label, aliases: v.aliases, doc: x?.doc?.id || null, heading: x?.sec?.h || null, inDocs: !!x?.sec })
        }
        for (const d of k.docs) {
          for (const sec of d.sections) {
            if (seen.has(`${d.id}#${sec.h}`)) continue
            const s = score([sec.h])
            if (s <= 2) out.push({ s, knowledge: k.id, coord: coordsOfSection(k, d, sec.h)[0] || null, name: sec.h, doc: d.id, heading: sec.h, inDocs: true })
          }
          const s = score([d.title, d.id])
          if (s <= 2) out.push({ s: s + 0.5, knowledge: k.id, coord: null, name: d.title, doc: d.id, heading: null, inDocs: true })
        }
      }
      out.sort((a, b) => a.s - b.s)
      const found = out.slice(0, 12).map(({ s, ...x }) => ({ ...x, exact: s === 0 }))
      return found.length ? { found } : { found, note: '이 이름으로는 없다 — 없다는 뜻은 아니다. 다른 이름으로 다시 찾거나 brief 의 문서 목록을 본다' }
    },

    async section({ knowledge, coord, doc, heading }, ctx) {
      const k = await store.get(knowledge, ctx)
      let d = null
      let sec = null
      let coords = []
      if (coord) {
        const x = sectionOf(k, coord)
        if (!x) throw new KmdError('E_NOTFOUND', `「${labelOf(k, coord)}」 이 들어갈 문서가 정해져 있지 않다 — 기록에만 있다`)
        d = x.doc
        sec = x.sec
        coords = [coord]
        if (!sec) {
          const recs = k.works.filter((w) => w.touches.includes(coord))
          return { knowledge: k.id, coord, doc: x.loc.doc.replace(/^docs\/|\.md$/g, ''), heading: x.loc.heading, content: null, note: '아직 문서에 이 항목이 없다', records: recs.map(recOut) }
        }
      } else {
        d = k.docs.find((x) => x.id === doc || x.title === doc)
        if (!d) throw new KmdError('E_NOTFOUND', `문서 「${doc}」 이 없다`)
        if (heading == null) return { knowledge: k.id, doc: d.id, title: d.title, intro: d.intro, headings: d.sections.map((s) => s.h) }
        sec = d.sections.find((s) => headingMatches(s.h, heading))
        if (!sec) throw new KmdError('E_NOTFOUND', `「${d.title}」 에 「${heading}」 항목이 없다`)
        coords = coordsOfSection(k, d, sec.h)
      }
      const recs = k.works.filter((w) => w.touches.some((c) => coords.includes(c)))
      return {
        knowledge: k.id,
        doc: d.id,
        title: d.title,
        heading: sec.h,
        coords,
        content: sec.body,
        base: sha16(sec.body),
        lastPut: sec.applied || null,
        notYetInDocs: pendPick(recs).pick.map((w) => ({ ...recOut(w), body: w.body })),
        notYetMore: pendPick(recs).more,
        records: recs.slice(0, 10).map(recOut),
      }
    },

    async save({ knowledge, record, sections }, ctx) {
      const k = await store.get(knowledge, ctx)
      const r = await store.save(ctx, k.id, { record, sections })
      const n = r.docs.length
      return { saved: r.id, date: r.date, docs: r.docs.map((p) => p.replace(/^docs\/|\.md$/g, '')), note: n ? `저장했다 — 기록 1 · 문서 ${n}` : '저장했다 — 기록 1', warnings: r.warnings }
    },
  }

  const recOut = (w) => ({ id: w.id, date: w.date, author: w.author, title: w.title, state: w.state === 'pend' ? '아직 문서에 안 넣음' : '문서에 들어감' })

  async function call(msg, ctx) {
    const { id, method, params } = msg
    const ok = (result) => ({ jsonrpc: '2.0', id, result })
    const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
    if (msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, '요청 모양이 아니다')
    if (id === undefined) return null // 알림 — 답하지 않는다
    if (method === 'initialize') {
      const want = params?.protocolVersion
      return ok({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'kmd', version: VERSION }, instructions: INSTRUCTIONS })
    }
    if (method === 'ping') return ok({})
    if (method === 'tools/list') return ok({ tools: TOOLS })
    if (method === 'tools/call') {
      const f = tools[params?.name]
      if (!f) return err(-32602, `그런 도구는 없다 — ${params?.name}`)
      try {
        const out = await f(params.arguments || {}, ctx)
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out })
      } catch (e) {
        if (!(e instanceof KmdError)) console.error('[kmd] 도구 오류', params?.name, e)
        const out = { error: e.code || 'E_INTERNAL', message: e instanceof KmdError ? e.message : '서버 안에서 넘어졌다 — 서버 창의 글을 본다' }
        return ok({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: true })
      }
    }
    return err(-32601, `모르는 요청 — ${method}`)
  }

  return { call, tools }
}
