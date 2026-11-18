// 낡은 말 시험(지식 생성 하네스 H5) — 세션이 읽는 글(스킬 글 · 폴더 덩이 · MCP 도구 설명)에 걷은 길의 말이 남지 않게.
//   걷은 것: 규칙 길(무인 실패는 다시 시도) · 거두기 · 넣지 못함 · 바로 넣기 · 단발 claude -p · 원문을 그대로 옮긴 「들인 자료」 를 새로 세우는 말.
//   생성 룰 조문(core/genrules.js)은 여기서 보지 않는다(조문의 말은 genrules 시험이 본다).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOLS } from '../server/mcp.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const GONE = [
  [/규칙 길/, '규칙 길(걷었다: 무인 실패는 지식에 아무것도 쓰지 않고 일감이 다시 시도한다)'],
  [/거두기/, '거두기(걷었다: 손으로 고친 파일은 넣을 것으로 올린다)'],
  [/넣지 못함/, '넣지 못함(없다: 못 넘으면 아무것도 쓰지 않는 입력 오류다)'],
  [/바로 넣기/, '바로 넣기(걷었다)'],
  [/claude -p/, '단발 claude -p(걷었다: 세션으로 부른다)'],
  [/들인 자료/, '들인 자료(옛 규칙 길 문서 · 새로 세우지 않는다)'],
]
const mdUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? mdUnder(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []))
const hits = (text) => GONE.filter(([re]) => re.test(text)).map(([, why]) => why)

test('스킬 글 · 폴더 덩이: 걷은 길의 말이 없다', () => {
  const bad = []
  for (const f of mdUnder(path.join(ROOT, 'agent'))) {
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    lines.forEach((l, i) => { for (const why of hits(l)) bad.push(`${path.relative(ROOT, f)}:${i + 1} ${why}`) })
  }
  assert.deepEqual(bad, [])
})

test('MCP 도구 설명: 걷은 길의 말이 없다', () => {
  const bad = []
  const walk = (o, at) => {
    if (typeof o === 'string') { for (const why of hits(o)) bad.push(`${at} ${why}`) } else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${at}[${i}]`))
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`)
  }
  for (const t of TOOLS) walk(t, t.name)
  assert.ok(TOOLS.length >= 5)
  assert.deepEqual(bad, [])
})
