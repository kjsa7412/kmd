// 세션 가짜의 들이기 대본(FAKE_AGENT_SCRIPT) — 옛 한 번 부르기 가짜(fake-claude.mjs 의 「넣을 것을 지식에 들인다」)와 같은 일을 kmd MCP 로 한다.
//   파일: `## 머리` 마다 — 같은 머리의 항목이 지식에 있으면 그 항목을 고치고(section 의 base), 없는 머리는 파일 이름의 새 문서에 새 항목으로.
//   커밋: 기록의 「바뀐 값: 옛 → 새」 를 찾아 옛 값이 든 첫 항목의 그 값을 바꾼다. 없으면 넣지 않고 끝낸다.
//   FAKE_AGENT_MODE=idle → 아무것도 넣지 않는다 · =lie → 원천에 없는 값을 덧붙인다(값 대조 경고) · =bad → 첫 저장은 본문이 아닌 줄을 섞는다(고쳐 받기)
export default async function ({ prompt, kn, files, read, mcp, env }) {
  const mode = env.FAKE_AGENT_MODE || ''
  const b = await mcp('brief', { knowledge: kn })
  if (env.FAKE_AGENT_WAIT_MS) await new Promise((ok) => setTimeout(ok, Number(env.FAKE_AGENT_WAIT_MS)))
  if (mode === 'idle') return '넣을 곳을 못 찾았다'
  const docs = (b?.docs || []).map((d) => ({ doc: d.doc, heads: d.headings || [] }))
  const save = async (args) => {
    let r = await mcp('save', { knowledge: kn, ...args(mode === 'bad') })
    if (r?.error && mode === 'bad') r = await mcp('save', { knowledge: kn, ...args(false) })
    return r
  }
  const commit = /소스 코드 커밋 하나의 기록을 들인다/.test(prompt)
  const mdName = (commit ? /- 기록: 「([^」]+)」/ : /바꾼 글: 「([^」]+)」/).exec(prompt)?.[1] || files.find((f) => f.endsWith('.md'))
  const md = read(mdName)
  if (commit) {
    const sw = /바뀐 값:? (\S+) → (\S+?)(?::|\s|$)/.exec(md)
    const title = (/^- 커밋 제목: (.+)$/m.exec(prompt)?.[1] || '코드 바뀜').split(': ')[0].slice(0, 80)
    const none = async () => { await mcp('save', { knowledge: kn, record: { title }, items: [], skip: [{ what: title, rule: 'R6-3', why: '문서와 상관없는 커밋' }] }); return '문서와 상관없는 커밋' }
    if (!sw) return none()
    const [, a, to] = sw
    for (const d of docs) for (const h of d.heads) {
      const cur = await mcp('section', { knowledge: kn, doc: d.doc, heading: h })
      if (!cur || cur.error || !String(cur.text ?? cur.body ?? cur.content ?? '').includes(a)) continue
      const body = String(cur.text ?? cur.body ?? cur.content)
      await save(() => ({ record: { title, summary: '코드가 바뀌었다.', changes: [`${h}: ${a} → ${to}`] }, items: [{ doc: d.doc, heading: h, act: 'edit', base: cur.base, content: body.split(a).join(to) + (mode === 'lie' ? ' 그리고 999초 기다린다.' : ''), judge: { rule: ['R2-1'], none: 'all' } }] }))
      return `${d.doc} › ${h}`
    }
    return none()
  }
  const file = mdName.replace(/\.[^.]+$/, '')
  const secs = [...md.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm)].map((m) => ({ heading: m[1].trim(), content: m[2].trim() })).filter((x) => x.content)
  const items = []
  for (const x of secs) {
    const d = docs.find((y) => y.heads.includes(x.heading))
    if (d) {
      const cur = await mcp('section', { knowledge: kn, doc: d.doc, heading: x.heading })
      items.push({ doc: d.doc, heading: x.heading, act: 'edit', base: cur?.base, content: x.content, judge: { rule: ['R2-1'], none: 'all' } })
    } else items.push({ doc: file, heading: x.heading, act: 'new', nature: '서술', kind: '메모', gist: `${x.heading} 에 대한 글`, content: x.content, judge: { rule: ['R1-1', 'R3-4'], none: 'all' } })
  }
  if (!items.length) return '넣을 것이 없다'
  if (mode === 'lie') items[0].content += ' 그리고 999초 기다린다.'
  const fresh = items.some((i) => i.act === 'new')
  await save((bad) => ({
    record: { title: `${file}: 들임`, summary: `${file} 을 들였다.`, changes: items.map((i) => `${i.act === 'new' ? '새로' : '고침'}: ${i.heading}`) },
    items: bad ? items.map((i, n) => (n ? i : { ...i, content: `${i.content}\n\n## 본문이 아닌 머리` })) : items,
    ...(fresh ? { docs: [{ path: file, nature: '서술', summary: `${file} 에서 온 글을 항목마다 적는다.`, judge: { rule: ['R3-4'], none: 'all' } }] } : {}),
  }))
  return `${items.length} 항목`
}
