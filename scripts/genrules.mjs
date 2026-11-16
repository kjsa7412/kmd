#!/usr/bin/env node
// 생성 룰 뽑기 — 조문 데이터(core/genrules.js)에서 작성기준 6-4 를 뽑아 쓰고(--write) 대조한다(--check · test/genrules.test.mjs).
//   기계가 읽는 원본은 데이터 · 사람이 읽는 원본은 작성기준 6-4 · 둘은 같은 커밋에서만 바뀐다(지식 생성 하네스 H-O10).
//
//   node scripts/genrules.mjs            긴 판 글을 찍는다
//   node scripts/genrules.mjs --short    짧은 판
//   node scripts/genrules.mjs --block <agent|session|send|shape|migrate>   채널 블록(룰 + 머리 꼴 + 덧붙임)
//   node scripts/genrules.mjs --write    docs/kmd_문서_작성기준.md 의 6-4 절을 데이터로 다시 쓴다
//   node scripts/genrules.mjs --check    6-4 절이 데이터와 같은가(다르면 종료 1)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { genRulesText, genRulesBlock, GEN_RULES_REV, rulesHash, SEED_KINDS, NATURES, PROFILES } from '../core/genrules.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DOC = path.join(ROOT, 'docs/kmd_문서_작성기준.md')
const HEAD = '## 6-4. 생성 룰(무엇을 항목 · 문서 · 기록으로 세우나)'
const NEXT = '## 7. 경로마다 지키는 법'

// 작성기준 6-4 절의 글(머리 줄부터 다음 절 앞까지)
export function sectionText() {
  const long = genRulesText({ long: true })
  const short = genRulesText({ long: false })
  return [
    HEAD,
    '',
    `지식이 생길 때 「있는 항목을 고칠지 · 새 항목 · 새 문서 · 장부에 무엇을 올릴지」 는 지식 밖의 고정 생성 룰 한 벌이 정한다([KMD_지식생성_하네스_설계](품질개선/KMD_지식생성_하네스_설계.md)). 장부는 그 룰을 적용해 온 과거 결정(판례)이고 따를지는 글을 짓는 LLM 이 맡는다. 빈 지식은 「판례 0 건」 일 뿐 따로 길이 없다.`,
    '',
    `- 이 절은 \`core/genrules.js\` 의 데이터에서 뽑은 글이다. 손으로 고치지 않는다: 데이터를 고치고 판을 올린 뒤 \`node scripts/genrules.mjs --write\` 로 다시 쓴다(\`--check\` 가 시험에 걸려 있다).`,
    `- 판 ${GEN_RULES_REV} · 지문 \`${rulesHash()}\` · 긴 판 ${long.length}자 · 짧은 판 ${short.length}자(긴 판에서 「헷갈릴 때」 묶음만 뺀 것).`,
    `- 스킬 · MCP 설명 · 오류 글은 조문의 사본을 쓰지 않고 번호(R2-1)로 가리킨다.`,
    `- 채널마다 싣는 판: ${Object.entries(PROFILES).map(([k, p]) => `\`${k}\` ${p.rev === 'long' ? '긴 판' : '짧은 판'}${p.only ? `(${p.only[0]} ~ ${p.only[p.only.length - 1]})` : ''}`).join(' · ')}.`,
    '',
    '```',
    long,
    '```',
    '',
    '씨앗 종류(R5-1 다): 지식에 같은 뜻의 종류가 없을 때 쓰는 낱말이다.',
    '',
    '| 성격 | 종류 | 뜻 |',
    '|---|---|---|',
    ...NATURES.flatMap((n) => SEED_KINDS[n].map((s) => `| ${n} | ${s.kind} | ${s.gist} |`)),
    '',
  ].join('\n')
}
// 문서에서 6-4 절을 찾는다 → { before, cur, after } · 없으면 cur null(7절 앞에 넣는다)
export function splitDoc(text) {
  const t = text.replace(/\r\n/g, '\n')
  const b = t.indexOf(`\n${NEXT}`)
  if (b < 0) throw new Error(`작성기준에 「${NEXT}」 머리가 없다`)
  const a = t.indexOf(`\n${HEAD}\n`)
  if (a < 0 || a > b) return { before: t.slice(0, b + 1), cur: null, after: t.slice(b + 1) }
  return { before: t.slice(0, a + 1), cur: t.slice(a + 1, b + 1), after: t.slice(b + 1) }
}
export function check() {
  const { cur } = splitDoc(fs.readFileSync(DOC, 'utf8'))
  return cur != null && cur.trimEnd() === sectionText().trimEnd()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2)
  if (a.includes('--write')) {
    const { before, after } = splitDoc(fs.readFileSync(DOC, 'utf8'))
    fs.writeFileSync(DOC, `${before}${sectionText()}\n${after}`)
    console.log(`작성기준 6-4 를 썼다(판 ${GEN_RULES_REV} · 지문 ${rulesHash()})`)
  } else if (a.includes('--check')) {
    if (!check()) { console.error('작성기준 6-4 가 조문 데이터와 다르다: node scripts/genrules.mjs --write'); process.exit(1) }
    console.log(`같다(판 ${GEN_RULES_REV} · 지문 ${rulesHash()})`)
  } else if (a.includes('--block')) console.log(genRulesBlock({ profile: a[a.indexOf('--block') + 1] || 'agent' }))
  else console.log(genRulesText({ long: !a.includes('--short') }))
}
