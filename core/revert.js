// 되돌리기 — 그 기록을 넣은 항목들을 넣기 전 글로(설계 3-4 · S-D13 · S-D53).
//
//   git revert 는 쓰지 않는다: 표지를 처음 그 기록으로 바꾼 묶음의 앞 판에서 그 항목 글을 꺼낸다.
//   { doc, heading } 을 주면 그 항목(들)만 · 항목마다 base(지금 글의 지문 — 되돌리기 사이 누가 고쳤으면 저장이 E_CONFLICT) ·
//   앞 판에 그 항목이 없으면(그 기록이 세운 항목 · 첫 커밋 문서) 빈 글 대신 remove(빈 머리가 남지 않게).
//   git 을 읽지 못하면 던진다(E_GIT) — 앞 판을 모르는 채 항목을 지우거나 비우지 않게.
//   표지를 단 묶음이 문서 짜임 커밋(태그 structure 이력이 같이 든 커밋)이면 지우지 않는다 — 짜임 이력의
//   「옛 문서 › 옛 머리 → 새 문서 › 새 머리」 · 「옮김 · 이름: 옛 문서 → 새 문서」 줄로 앞 자리를 찾아 거기서 다시 찾고,
//   못 찾으면 E_CONFLICT(바탕 세우기 설계 4-3 되돌리기 2)

import { git, tryGit } from './git.js'
import { readText, sha16 } from './text.js'
import { parseDoc, headingMatches } from './sections.js'
import { coordsOfSection } from './knowledge.js'
import { parseRecord } from './frontmatter.js'
import { KmdError } from './errors.js'

const gitFail = (rel, what) => (e) => {
  console.error(`[revert] ${rel} ${what}: ${e?.message || e}`)
  throw new KmdError('E_GIT', `「${rel}」 의 이력을 읽지 못해 되돌리지 않았다`)
}
// 그 커밋이 문서 짜임 커밋이면 그 이력 본문 · 아니면 null
async function structureBody(dir, sha) {
  const r = await tryGit(dir, ['show', '--format=', '--name-only', sha])
  if (!r.ok) throw new KmdError('E_GIT', '묶음의 파일 목록을 읽지 못해 되돌리지 않았다')
  for (const f of r.out.split('\n').map((x) => x.trim()).filter((x) => /^log\/[^/]+\.md$/.test(x))) {
    const t = await tryGit(dir, ['show', `${sha}:${f}`])
    if (!t.ok) continue
    const rec = parseRecord(readText(t.out), f.slice(4))
    if (rec?.tags.includes('structure')) return rec.body
  }
  return null
}
// 짜임 이력 줄로 앞 자리 — { doc(문서 id), h } · 못 찾으면 null
export function priorPlace(body, docId, h) {
  const lines = String(body).split('\n')
  for (const l of lines) {
    const m = l.match(/^- 항목 (?:옮김|이름|차례): (.+?) › (.+) → (.+?) › (.+)$/)
    if (m && m[3] === docId && m[4] === h) return { doc: m[1], h: m[2] }
  }
  for (const l of lines) {
    const m = l.match(/^- (?:옮김|이름): (.+) → (.+)$/)
    if (m && m[2] === docId) return { doc: m[1], h }
  }
  return null
}
const docIdOf = (rel) => rel.replace(/^docs\//, '').replace(/\.md$/, '')

// 그 기록이 처음 표지를 단 묶음의 앞 판 — { text(문서 글 · 앞 판에 없으면 null), h(앞 판에서 찾을 머리) }
async function beforeOf(dir, rel, h, recordId, until = null, depth = 0) {
  if (depth > 20) throw new KmdError('E_CONFLICT', `「${rel}」 의 짜임이 너무 여러 번 바뀌었다: 문서 고치기로 고친다`)
  const log = await git(dir, ['log', '--format=%H', '-S', `<!-- applied: ${recordId} -->`, ...(until ? [until] : []), '--', rel]).catch(gitFail(rel, '이력을 읽지 못했다'))
  const shas = log.trim().split('\n').filter(Boolean)
  const first = shas[shas.length - 1]
  // 표지를 단 묶음이 없다(손으로 달고 아직 커밋하지 않은 표지) — 앞 판을 모르니 지우지도 비우지도 않는다
  if (!first) throw new KmdError('E_CONFLICT', `「${rel}」 에서 그 기록을 넣은 묶음을 찾지 못했다. 문서를 열어 손으로 고친다`)
  // 문서 짜임 커밋 — 항목이 옮겨 왔다. 앞 자리에서 다시 찾는다(지우지 않는다)
  const sb = await structureBody(dir, first)
  if (sb != null) {
    const p = priorPlace(sb, docIdOf(rel), h)
    if (!p) throw new KmdError('E_CONFLICT', `짜임이 바뀐 항목이다(「${docIdOf(rel)} › ${h}」): 문서 고치기로 고친다`)
    return beforeOf(dir, `docs/${p.doc}.md`, p.h, recordId, `${first}^`, depth + 1)
  }
  // 첫 커밋이면 앞 판이 없다 · 앞 판에 그 문서가 없으면(이 기록이 세운 문서) 없다
  if (!(await tryGit(dir, ['rev-parse', '--verify', '-q', `${first}^`])).ok) return { text: null, h }
  const ls = await tryGit(dir, ['ls-tree', '--name-only', `${first}^`, '--', rel])
  if (!ls.ok) {
    console.error(`[revert] ${rel} 앞 판을 찾지 못했다: ${ls.err}`)
    throw new KmdError('E_GIT', `「${rel}」 의 앞 판을 읽지 못해 되돌리지 않았다`)
  }
  if (!ls.out.trim()) return { text: null, h }
  const text = readText(await git(dir, ['show', `${first}^:${rel}`]).catch((e) => {
    console.error(`[revert] ${rel} 앞 판을 읽지 못했다: ${e?.message || e}`)
    throw new KmdError('E_GIT', `「${rel}」 의 앞 판을 읽지 못해 되돌리지 않았다`)
  }))
  return { text, h }
}

const same = (x, y) => String(x).normalize('NFC').trim() === String(y).normalize('NFC').trim()

// { record, sections: [{ doc, heading, content, applied, coords, base, remove? }] } — 지금 그 기록이 표지인 항목만(live)
export async function revertPlan(k, recordId, { doc = null, heading = null } = {}) {
  const w = k.byWork.get(recordId)
  if (!w) throw new KmdError('E_NOTFOUND', '그 기록이 없다')
  const sections = []
  for (const d of k.docs) {
    if (doc && d.path !== doc) continue
    // 머리 거르기 — 같은 머리가 있으면 그것만(「배포」 를 되돌리며 「배포 절차」 까지 되돌리지 않게) · 없으면 머리 맞춤(넣은 것 줄의 짧은 머리)
    const mine = d.sections.filter((s) => s.applied === recordId)
    const exact = heading ? mine.filter((s) => same(s.h, heading)) : []
    for (const s of mine) {
      if (heading && !(exact.length ? exact.includes(s) : headingMatches(s.h, heading))) continue
      const before = await beforeOf(k.dir, d.path, s.h, recordId)
      // 앞 판의 그 항목 — 머리가 같은 것만(앞 판에 「배포 절차」 만 있으면 「배포」 는 이 기록이 세운 항목 · remove) · 짜임으로 옮겨 온 항목은 앞 자리의 머리로
      const old = before.text ? parseDoc(before.text, '').sections.find((x) => same(x.h, before.h)) : null
      const base = sha16(s.body)
      const coords = coordsOfSection(k, d, s.h)
      if (old) sections.push({ doc: d.path, heading: s.h, content: old.body, applied: old.applied || null, coords, base })
      else sections.push({ doc: d.path, heading: s.h, content: '', applied: null, coords, base, remove: true })
    }
  }
  return { record: w, sections }
}
