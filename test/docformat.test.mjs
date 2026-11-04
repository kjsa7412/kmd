// 문서 꼴 — 본문과 시스템 참고 정보를 나눈다(docs/kmd_문서_작성기준.md).
//
// 참고 블록(문서 끝)을 읽을 때 떼고 · 옛 경과 꼬리 · 「기록 그대로」 줄을 받아 주고 · 쓸 때 블록을 다시 쓴다 ·
// 저장은 새 꼴로 쓰고 옛 줄을 잃지 않는다 · 사람 · 세션의 항목 글 검사(E_FORMAT) · 옛 문서 옮기기(본문 보존) ·
// 화면 링크 풀이(문서 · 항목 · 없는 문서 · 기록 · 이력 · 바깥 · 열 수 없는 것 · 깨진 % · README.md) · 표 감싸기.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseDoc, replaceSection, removeSection, renameSection, stampAll } from '../core/sections.js'
import { formatProblems, convertDoc, verifyConvert, docfmtDir, lintDoc, lintNew } from '../core/docformat.js'
import { save, sectionBase } from '../core/save.js'
import { loadKnowledge } from '../core/knowledge.js'
import { check as checkDraft } from '../core/gate.js'
import { material } from '../core/pcplace.js'
import { render, linkTarget, linksOf, citesOf, docView } from '../server/views.js'
import { copyDir } from './helpers.mjs'

const pick = ({ text, changed, moved, ok }) => ({ text, changed, moved, ok })
const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, dir
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-docfmt-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  dir = path.join(tmp, 'dpms')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), dir)
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

const BLOCK = ['<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->', '**참고**', '', '- 가', '  - 2026-10-21 [하나](../work/2026-1021-하나.md)', '- 나', '  - 2026-10-22 [둘](../work/2026-1022-둘.md)', '<!-- /kmd:참고 -->']
const NEW = ['# 문서', '', '요약 한 줄.', '', '## 가', '<!-- applied: 2026-1021-하나 -->', '가의 글.', '', '## 나', '나의 글.', '', ...BLOCK, ''].join('\n')

test('읽기: 참고 블록을 떼어 항목마다 log · 마지막 항목 본문에 섞이지 않는다', () => {
  const d = parseDoc(NEW, '')
  assert.equal(d.title, '문서')
  assert.equal(d.intro, '요약 한 줄.')
  assert.deepEqual(d.sections.map((s) => [s.h, s.body, s.applied]), [['가', '가의 글.', '2026-1021-하나'], ['나', '나의 글.', null]])
  assert.deepEqual(d.sections[0].log, ['- 2026-10-21 [하나](../work/2026-1021-하나.md)'])
  assert.deepEqual(d.sections[1].log, ['- 2026-10-22 [둘](../work/2026-1022-둘.md)'])
  assert.deepEqual(d.ref.map((x) => x.h), ['가', '나'])
})

test('읽기: 옛 경과 꼬리 · 「기록 그대로」 줄은 log 로 받는다 · 본문은 깨끗하게', () => {
  const old = ['# 문서', '', '## 가', '가의 글.', '', '> 기록 그대로: [셋](../work/2026-1023-셋.md) · Claude 로 다듬지 못했다', '', '붙인 기록 글.', '', '**경과**', '- 2026-10-21 [하나](../work/2026-1021-하나.md)', '- 2026-10-23 [셋](../work/2026-1023-셋.md)', ''].join('\n')
  const s = parseDoc(old, '').sections[0]
  assert.equal(s.body, '가의 글.\n\n붙인 기록 글.')
  assert.deepEqual(s.log, ['- 2026-10-21 [하나](../work/2026-1021-하나.md)', '- 2026-10-23 [셋](../work/2026-1023-셋.md) · 다듬지 못함'])
  assert.equal(s.old, 3)
})

test('코드 울타리 안의 표식은 블록이 아니다', () => {
  const t = ['# 문서', '', '## 예', '```md', ...BLOCK, '```', ''].join('\n')
  const d = parseDoc(t, '')
  assert.ok(d.sections[0].body.includes('<!-- kmd:참고'))
  assert.deepEqual(d.sections[0].log, [])
  assert.deepEqual(d.ref, [])
  // 갈아 끼워도 울타리 안 글은 그대로
  const w = replaceSection(t, { heading: '예', body: d.sections[0].body, log: ['- 2026-10-24 [넷](../work/2026-1024-넷.md)'] })
  assert.equal(parseDoc(w, '').sections[0].body, d.sections[0].body)
  assert.deepEqual(parseDoc(w, '').sections[0].log, ['- 2026-10-24 [넷](../work/2026-1024-넷.md)'])
})

test('쓰기: replaceSection 이 그 항목 줄만 고쳐 블록을 끝에 다시 쓴다 · 다른 줄은 그대로', () => {
  const w = replaceSection(NEW, { heading: '가', body: '가의 새 글.', applied: 'x1', log: ['- 2026-10-21 [하나](../work/2026-1021-하나.md)', '- 2026-10-25 [다섯](../work/x1.md)'] })
  const d = parseDoc(w, '')
  assert.equal(d.sections[0].body, '가의 새 글.')
  assert.equal(d.sections[0].log.length, 2)
  assert.deepEqual(d.sections[1].log, ['- 2026-10-22 [둘](../work/2026-1022-둘.md)'])
  assert.ok(w.startsWith('# 문서\n\n요약 한 줄.\n\n## 가\n<!-- applied: x1 -->\n가의 새 글.\n\n## 나\n나의 글.\n\n<!-- kmd:참고'))
  assert.ok(w.endsWith('<!-- /kmd:참고 -->\n'))
  // 본문에 경과 꼬리가 오면 떼어 줄로(log 를 주지 않으면 지금 줄에 보탠다)
  const w2 = replaceSection(NEW, { heading: '나', body: '나의 글.\n\n**경과**\n- 2026-10-26 [여섯](../work/x6.md)' })
  assert.deepEqual(parseDoc(w2, '').sections[1].log, ['- 2026-10-22 [둘](../work/2026-1022-둘.md)', '- 2026-10-26 [여섯](../work/x6.md)'])
  assert.ok(!/\*\*경과\*\*/.test(w2))
  // 줄이 하나도 없으면 블록을 지운다
  let t = replaceSection(NEW, { heading: '가', body: '가', log: [] })
  t = replaceSection(t, { heading: '나', body: '나', log: [] })
  assert.ok(!t.includes('kmd:참고'))
  // 새 항목 — 블록 앞에 붙고 블록은 다시 끝
  const w3 = replaceSection(NEW, { heading: '다', body: '다의 글.', log: ['- 2026-10-27 [일곱](../work/x7.md)'] })
  const d3 = parseDoc(w3, '')
  assert.deepEqual(d3.sections.map((s) => s.h), ['가', '나', '다'])
  assert.equal(d3.sections[1].body, '나의 글.')
  assert.deepEqual(d3.ref.map((x) => x.h), ['가', '나', '다'])
})

test('쓰기: 옛 꼴 항목을 쓰면 그 항목 꼬리를 블록으로 옮긴다 · 다른 항목의 옛 꼬리는 그대로', () => {
  const old = ['# 문서', '', '## 가', '가의 글.', '', '**경과**', '- 2026-10-21 [하나](../work/a.md)', '', '## 나', '나의 글.', '', '**경과**', '- 2026-10-22 [둘](../work/b.md)', ''].join('\n')
  const w = replaceSection(old, { heading: '가', body: '가의 새 글.' })
  assert.ok(w.includes('## 나\n나의 글.\n\n**경과**\n- 2026-10-22 [둘](../work/b.md)\n'))
  const d = parseDoc(w, '')
  assert.equal(d.sections[0].body, '가의 새 글.')
  assert.deepEqual(d.sections[0].log, ['- 2026-10-21 [하나](../work/a.md)'])
  assert.deepEqual(d.ref.map((x) => x.h), ['가'])
})

test('지우기 · 이름 바꾸기는 참고 줄도 같이 · stampAll 은 블록 안을 건드리지 않는다', () => {
  const r = removeSection(NEW, { heading: '가' })
  assert.deepEqual(parseDoc(r, '').ref.map((x) => x.h), ['나'])
  assert.ok(!r.includes('[하나]'))
  const n = renameSection(NEW, { heading: '나', to: '나라' })
  const d = parseDoc(n, '')
  assert.deepEqual(d.sections.map((s) => s.h), ['가', '나라'])
  assert.deepEqual(d.sections[1].log, ['- 2026-10-22 [둘](../work/2026-1022-둘.md)'])
  assert.ok(n.includes('\n- 나라\n  - 2026-10-22'))
  const st = stampAll(NEW, 'z')
  assert.ok(st.endsWith(BLOCK.join('\n') + '\n'))
})

test('저장: 새 꼴로 쓰고 옛 경과를 잃지 않는다 · base 는 본문으로 잰다', async () => {
  const f = path.join(dir, 'docs', '롤백절차.md')
  const text = fs.readFileSync(f, 'utf8')
  const h = parseDoc(text, '').sections[0].h
  // 옛 꼴: 첫 항목 끝에 경과 꼬리를 손으로 단다
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l === `## ${h}`)
  const next = lines.findIndex((l, i) => i > at && /^## /.test(l))
  const end = next < 0 ? lines.length : next
  const before = lines.slice(0, end).join('\n').replace(/\s+$/, '')
  fs.writeFileSync(f, `${before}\n\n**경과**\n- 2026-10-01 [옛 기록](../work/2026-1001-옛.md)\n\n${lines.slice(end).join('\n')}`)
  const sec0 = parseDoc(fs.readFileSync(f, 'utf8'), '').sections[0]
  assert.deepEqual(sec0.log, ['- 2026-10-01 [옛 기록](../work/2026-1001-옛.md)'])
  const base = sectionBase(fs.readFileSync(f, 'utf8'), h)
  const k = await loadKnowledge({ id: 'dpms', name: 'dpms', dir })
  assert.equal(k.byDocPath.get('docs/롤백절차.md').sections[0].body, sec0.body)
  const r = await save(dir, { record: { title: `${h}: 새 글`, body: '새 글', touches: ['proc:되돌리기'] }, sections: [{ doc: 'docs/롤백절차.md', heading: h, content: '되돌리기는 이전 판으로 3단계에 한다.', base }] }, { user: 'lee' })
  const raw = fs.readFileSync(f, 'utf8')
  assert.ok(!/\*\*경과\*\*/.test(raw), '옛 꼬리는 새 꼴로 옮겨졌다')
  const s = parseDoc(raw, '').sections[0]
  assert.equal(s.body, '되돌리기는 이전 판으로 3단계에 한다.')
  assert.equal(s.log.length, 2)
  assert.ok(s.log[0].includes('2026-1001-옛') && s.log[1].includes(encodeURI(r.id)))
  assert.match(raw, /<!-- \/kmd:참고 -->\n$/)
  // 다시 읽은 지문이 저장의 지문과 같다(화면 · 세션의 base 가 늘 맞게)
  const k2 = await loadKnowledge({ id: 'dpms', name: 'dpms', dir })
  const v = docView(k2, '롤백절차')
  assert.equal(v.sections[0].base, sectionBase(raw, h))
  assert.equal(v.sections[0].refs.length, 2)
  assert.deepEqual(v.sections[0].refs[0], { date: '2026-10-01', title: '옛 기록', id: '2026-1001-옛', sub: 'work', note: null })
  // 본문 html 에는 참고 블록 글도 출처 목록도 없다 — 출처는 refs 로만(화면이 「출처 n」 칩 · 참고 칸으로 그린다)
  assert.ok(!v.sections[0].html.includes('kmd:참고'))
  assert.ok(!v.sections[0].html.includes('옛 기록'))
  assert.ok(!v.sections[0].html.includes('srcrefs'))
  assert.equal(typeof v.sections[0].heldN, 'number')
  assert.equal(v.refs.n, 2)
})

test('저장 검사(E_FORMAT): 사람 · 세션의 항목 글에 본문이 아닌 것', async () => {
  const k = await loadKnowledge({ id: 'dpms', name: 'dpms', dir })
  const base = sectionBase(fs.readFileSync(path.join(dir, 'docs', '배포절차.md'), 'utf8'), '준비')
  const bad = {
    '기록 링크': '배포 창은 화 · 목이다([기록](../work/2026-1021-배포-창.md)).',
    '이력 링크': '정리했다 [이력](../log/2026-1026-정리.md)',
    '시스템 주소': '화면은 [여기](/api/k/dpms/doc) 와 [오늘](#/today)',
    '표지 밖 주석': '배포 창은 화 · 목이다.\n<!-- 메모 -->',
    '경과 꼬리': '배포 창은 화 · 목이다.\n\n**경과**\n- 2026-10-21 [배포 창](../work/x.md)',
    '머리 줄': '배포 창은 화 · 목이다.\n\n## 다른 항목\n글',
    '참고 표식': '글\n<!-- kmd:참고 -->\n<!-- /kmd:참고 -->',
  }
  for (const [name, content] of Object.entries(bad)) {
    await assert.rejects(async () => save(dir, { record: { title: `준비: ${name}`, body: '글', touches: ['proc:준비'] }, sections: [{ coord: 'proc:준비', content, base }] }, { user: 'lee' }), (e) => e.code === 'E_FORMAT' && /「proc:준비」 글을 받지 않는다: \d+째 줄/.test(e.message), name)
  }
  // 받는 것 — 코드 울타리 안 · `코드` 안 · ### 소제목 · 문서 · 항목 · 바깥 링크
  const ok = '배포 창은 화 · 목이다. [롤백](#롤백) · [백업](백업절차.md) · <https://example.com>\n\n### 예\n```\n## 코드 안\n[x](../work/a.md) <!-- 주석 -->\n```\n`<!-- 코드 -->`'
  assert.deepEqual(formatProblems(ok), [])
  // kmd 자신의 쓰기는 고쳐서 넣는다(경과 꼬리는 참고 줄로)
  await save(dir, { record: { title: '정리: 준비', body: '넣음', touches: ['proc:준비'], tags: ['curate-llm'] }, sections: [{ coord: 'proc:준비', content: '배포 창은 화 · 목이다.\n\n**경과**\n- 2026-10-21 [배포 창](../work/2026-1021-배포-창.md)' }] }, { user: 'kmd-auto', system: true })
  const s = parseDoc(fs.readFileSync(path.join(dir, 'docs', '배포절차.md'), 'utf8'), '').sections.find((x) => x.h === '준비')
  assert.equal(s.body, '배포 창은 화 · 목이다.')
  assert.ok(s.log.some((l) => l.includes('2026-1021-배포-창')))
  assert.ok(k)
})

test('정리 초안 검사도 같은 검사를 쓴다(기록 링크 · 경과는 거절 · 까닭이 남는다)', async () => {
  await save(dir, { record: { title: '헬스 체크: 5초', body: '시간 초과는 5초', touches: ['proc:헬스 체크'] } }, { user: 'lee' })
  const k = await loadKnowledge({ id: 'dpms', name: 'dpms', dir })
  const g = material(k).find((x) => x.coord === 'proc:헬스 체크')
  const draft = (content) => ({ content, used: g.records.map((r) => r.id), left: [] })
  const c = checkDraft(k, g, draft(`${g.content.replace('3초', '5초')}\n\n[기록](../work/${g.records[0].id}.md)`))
  assert.equal(c.ok, false)
  assert.match(c.why, /머리 · 표지.*기록 · 이력 링크/)
})

test('옛 문서 옮기기: 본문은 그대로 · 줄은 참고 블록으로 · 다르면 옮기지 않는다', () => {
  const old = ['# 문서', '', '요약.', '', '## 가', '<!-- applied: a -->', '가의 글.', '', '> 기록 그대로: [셋](../work/2026-1023-셋.md) · Claude 로 다듬지 못했다', '', '붙인 글.', '', '**경과**', '- 2026-10-21 [하나](../work/2026-1021-하나.md)', '', '## 나', '나의 글.', ''].join('\n')
  const c = convertDoc(old)
  assert.equal(c.ok, true)
  assert.equal(c.changed, true)
  assert.equal(c.moved, 2)
  assert.ok(!/\*\*경과\*\*|기록 그대로/.test(c.text.replace(/<!-- kmd:참고[\s\S]*$/, '')))
  const a = parseDoc(old, '')
  const b = parseDoc(c.text, '')
  assert.deepEqual(b.sections.map((s) => [s.h, s.body, s.applied]), a.sections.map((s) => [s.h, s.body, s.applied]))
  assert.deepEqual(b.sections[0].log, ['- 2026-10-21 [하나](../work/2026-1021-하나.md)', '- 2026-10-23 [셋](../work/2026-1023-셋.md) · 다듬지 못함'])
  assert.ok(c.text.includes('## 나\n나의 글.\n\n<!-- kmd:참고'))
  // 이미 새 꼴 · 옛 꼴이 없으면 그대로
  assert.deepEqual(pick(convertDoc(NEW)), { text: NEW, changed: false, moved: 0, ok: true })
  assert.equal(convertDoc(NEW).why, null)
  assert.equal(convertDoc(c.text).changed, false)
  // 본문이 달라지면 ok: false
  assert.equal(verifyConvert(old, c.text).ok, true)
  assert.deepEqual(verifyConvert(old, c.text.replace('가의 글.', '가의 글')), { ok: false, why: '옮기면 본문 글이 달라진다' })
  assert.equal(verifyConvert(old, c.text.replace('  - 2026-10-21 [하나](../work/2026-1021-하나.md)\n', '')).ok, false)
})

test('지식 옮기기: dry 는 쓰지 않는다 · 옮기면 git 한 묶음과 이력 하나 · 원본이 주인인 문서는 건너뛴다', async () => {
  const d2 = path.join(tmp, 'fmt')
  fs.mkdirSync(path.join(d2, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(d2, 'docs', 'a.md'), '# a\n\n## 가\n가의 글.\n\n**경과**\n- 2026-10-21 [하나](../work/2026-1021-하나.md)\n')
  fs.writeFileSync(path.join(d2, 'docs', 'w.md'), '<!-- watched: src="s" path="w.docx" rec="r1" -->\n# w\n\n## 가\n글\n\n**경과**\n- 2026-10-21 [하나](../work/2026-1021-하나.md)\n')
  fs.writeFileSync(path.join(d2, 'docs', 'n.md'), '# n\n\n## 가\n글\n')
  const dry = await docfmtDir(d2, { dry: true })
  assert.equal(dry.files, 1)
  assert.equal(dry.commit, null)
  assert.ok(fs.readFileSync(path.join(d2, 'docs', 'a.md'), 'utf8').includes('**경과**'))
  assert.ok(dry.docs.find((x) => x.doc === 'w').skipped)
  const r = await docfmtDir(d2, { user: 'kmd', by: 'kim' })
  assert.equal(r.files, 1)
  assert.equal(r.moved, 1)
  assert.match(r.commit, /^[0-9a-f]{40}$/)
  const a = fs.readFileSync(path.join(d2, 'docs', 'a.md'), 'utf8')
  assert.ok(!a.includes('**경과**') && a.includes('<!-- kmd:참고'))
  assert.ok(fs.readFileSync(path.join(d2, 'docs', 'w.md'), 'utf8').includes('**경과**'))
  const lg = fs.readFileSync(path.join(d2, 'log', `${r.log}.md`), 'utf8')
  assert.match(lg, /tags:\n {2}- docfmt/)
  assert.match(lg, /- a: 줄 1/)
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'docs/a.md', `log/${r.log}.md`], { cwd: d2, encoding: 'utf8' }).trim(), '')
  // 두 번째는 할 것이 없다
  const again = await docfmtDir(d2)
  assert.equal(again.files, 0)
  assert.equal(again.commit, null)
})

test('### 올리기(liftH3 · S-D31 · S13): --lift 일 때만 · ## 없는 문서의 머리를 한 단씩 · 자리 장부 줄도 같은 커밋 · 장부 이름이 항목에 닿지 않으면 올리지 않는다', async () => {
  const d3 = path.join(tmp, 'lift')
  fs.mkdirSync(path.join(d3, 'docs'), { recursive: true })
  const plc = '# PLC연계규격서\n\n소개.\n\n### 1. 개요\n개요 글.\n\n#### 1.1 범위\n범위 글.\n\n```\n### 코드 안\n```\n\n### 2. 통신\n주기 500ms.\n'
  fs.writeFileSync(path.join(d3, 'docs', 'plc.md'), plc)
  fs.writeFileSync(path.join(d3, 'docs', 'bad.md'), '# bad\n\n### 가\n글\n')
  fs.writeFileSync(path.join(d3, 'docs', 'ok.md'), '# ok\n\n## 가\n글\n\n### 나\n글\n')
  fs.writeFileSync(path.join(d3, '_managed.md'), '# 자리 장부\n\n| 이름 | 문서 | 항목 |\n|---|---|---|\n| `spec:개요` | `docs/plc.md` | `### 1. 개요` |\n| `spec:통신` | `docs/plc.md` | `### 2. 통신` |\n| `spec:없음` | `docs/bad.md` | `### 없는 머리` |\n')
  // lift 없이는 그대로
  const plain = await docfmtDir(d3, { dry: true })
  assert.equal(plain.lifted, 0)
  const dry = await docfmtDir(d3, { dry: true, lift: true })
  assert.equal(dry.lifted, 2, 'plc 의 ### 둘(bad 는 장부 이름이 닿지 않아 올리지 않는다 · ok 는 ## 가 있다)')
  assert.match(dry.docs.find((x) => x.doc === 'bad').why, /### 올리지 않음: 장부 「spec:없음」/)
  assert.equal(fs.readFileSync(path.join(d3, 'docs', 'plc.md'), 'utf8'), plc, 'dry 는 쓰지 않는다')
  const r = await docfmtDir(d3, { lift: true, user: 'kmd', by: 'kim' })
  assert.match(r.commit, /^[0-9a-f]{40}$/)
  const doc = fs.readFileSync(path.join(d3, 'docs', 'plc.md'), 'utf8')
  assert.match(doc, /^## 1\. 개요$/m)
  assert.match(doc, /^### 1\.1 범위$/m)
  assert.match(doc, /```\n### 코드 안\n```/, '코드 울타리 안은 그대로')
  assert.deepEqual(parseDoc(doc, 'docs/plc.md').sections.map((x) => x.h), ['1. 개요', '2. 통신'])
  const reg = fs.readFileSync(path.join(d3, '_managed.md'), 'utf8')
  assert.match(reg, /\| `spec:개요` \| `docs\/plc\.md` \| `## 1\. 개요` \|/)
  assert.match(reg, /\| `spec:없음` \| `docs\/bad\.md` \| `### 없는 머리` \|/, '올리지 않은 문서의 줄은 그대로')
  assert.equal(fs.readFileSync(path.join(d3, 'docs', 'bad.md'), 'utf8'), '# bad\n\n### 가\n글\n')
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'docs/plc.md', '_managed.md'], { cwd: d3, encoding: 'utf8' }).trim(), '', '문서와 장부가 같은 커밋')
  assert.match(fs.readFileSync(path.join(d3, 'log', `${r.log}.md`), 'utf8'), /### 올림 2/)
})

test('화면 링크: 문서 · 항목 · 없는 문서 · 기록 · 이력 · 바깥 · 열 수 없는 것 · 깨진 % · README.md', () => {
  const k = { id: 'K', docs: [{ id: '배포절차', path: 'docs/배포절차.md', intro: '', sections: [{ h: '준비', body: '' }] }, { id: 'ops/Backup', path: 'docs/ops/Backup.md', intro: '', sections: [] }], byWork: new Map([['2026-1021-a', {}], ['2026-1026-b', {}]]), atts: [] }
  const from = 'docs/x.md'
  assert.deepEqual(linkTarget(k, from, '배포절차.md'), { t: 'doc', d: '배포절차' })
  assert.deepEqual(linkTarget(k, from, '배포절차.md#준비'), { t: 'item', d: '배포절차', h: '준비' })
  assert.deepEqual(linkTarget(k, from, '#롤백'), { t: 'item', d: 'x', h: '롤백' })
  assert.deepEqual(linkTarget(k, from, '없음.md'), { t: 'missing', d: '없음' })
  assert.deepEqual(linkTarget(k, from, 'ops/backup.md'), { t: 'doc', d: 'ops/Backup' }) // 대소문자
  assert.deepEqual(linkTarget(k, from, 'ops/Backup'), { t: 'doc', d: 'ops/Backup' }) // 확장자 없음
  assert.deepEqual(linkTarget(k, from, '/docs/배포절차.md'), { t: 'doc', d: '배포절차' }) // 지식 뿌리 기준
  assert.deepEqual(linkTarget(k, from, '배포절차.md'.normalize('NFD')), { t: 'doc', d: '배포절차' })
  assert.deepEqual(linkTarget(k, from, '../work/2026-1021-a.md'), { t: 'rec', r: '2026-1021-a', sub: 'work' })
  assert.deepEqual(linkTarget(k, from, '../log/2026-1026-b.md'), { t: 'rec', r: '2026-1026-b', sub: 'log' })
  assert.equal(linkTarget(k, from, 'https://example.com').t, 'ext')
  assert.equal(linkTarget(k, from, 'mailto:a@b.c').t, 'mail')
  for (const h of ['/api/k/x', '#/today', '../src/a.js', 'ftp://x', 'a%FF.md', '#%E0', '../../밖.md']) assert.equal(linkTarget(k, from, h).t, 'dead', h)
  const html = render(k, from, '[a](배포절차.md#준비) [b](없음.md) [c](../log/2026-1026-b.md) [d](/api/x) [e](https://e.com) [f](mailto:a@b.c)\n\nREADME.md 를 본다')
  assert.ok(html.includes('<a class="dlink item" data-a="openDoc" data-k="K" data-d="배포절차" data-h="준비">a</a>'))
  assert.ok(html.includes('<a class="dlink doc missing" title="없는 문서">b</a>'))
  assert.ok(html.includes('<a class="dlink rec" data-a="openRec" data-k="K" data-r="2026-1026-b">c</a>'))
  assert.ok(html.includes('<span class="deadlink" title="열 수 없는 링크">d</span>'))
  assert.ok(html.includes('<a href="https://e.com" class="xlink" target="_blank" rel="noopener noreferrer">e</a>'))
  assert.ok(html.includes('<a href="mailto:a@b.c" class="xlink">f</a>'))
  assert.ok(html.includes('README.md 를 본다') && !html.includes('http://README.md'))
  // 깨진 % 하나가 연결 셈을 깨뜨리지 않는다 · 코드 안 링크는 세지 않는다
  const doc = { id: 'x', path: from, intro: '[z](a%ZZ.md)', sections: [{ h: '가', body: '[a](배포절차.md) [r](../log/2026-1026-b.md)\n```\n[c](ops/Backup.md)\n```', log: ['- 2026-10-21 [a](../work/2026-1021-a.md)'] }] }
  assert.deepEqual(linksOf(doc, k), ['배포절차'])
  assert.deepEqual(citesOf(doc, k), ['2026-1026-b', '2026-1021-a'])
})

test('표는 감싼다', () => {
  const html = render({ id: 'K', docs: [], atts: [] }, 'docs/x.md', '| a | b |\n|---|---|\n| 1 | 2 |')
  assert.match(html, /^<div class="tblwrap"><table class="t">[\s\S]*<\/table><\/div>\s*$/)
})

test('POST /api/k/:k/docfmt: 관리자 · 비밀번호 한 번 더 · dry 는 쓰지 않는다', async () => {
  const { startServer } = await import('../server/http.js')
  const { signIn } = await import('./helpers.mjs')
  const { prehash } = await import('../app/prehash.js')
  process.env.KMD_NO_CLAUDE = '1'
  const root = path.join(tmp, 'team')
  fs.mkdirSync(path.join(root, 'demo', 'docs'), { recursive: true })
  fs.mkdirSync(path.join(root, 'demo', 'work'), { recursive: true })
  fs.writeFileSync(path.join(root, 'demo', 'README.md'), '# demo\n')
  const f = path.join(root, 'demo', 'docs', 'a.md')
  fs.writeFileSync(f, '# a\n\n## 가\n가의 글.\n\n**경과**\n- 2026-10-21 [하나](../work/2026-1021-하나.md)\n')
  const s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const me = await signIn(s, { id: 'kim' })
    const H = { 'content-type': 'application/json', cookie: me.cookie }
    const post = (p, b) => fetch(s.url + p, { method: 'POST', headers: H, body: JSON.stringify(b || {}) })
    assert.equal((await post('/api/k/demo/docfmt', { dry: true })).status, 403, '비밀번호 한 번 더 없이는 안 된다')
    const su = await post('/api/sudo', { pw: prehash('kim', me.pw) })
    H.cookie = [me.cookie, ...su.headers.getSetCookie().map((c) => c.split(';')[0])].join('; ')
    const dry = await (await post('/api/k/demo/docfmt', { dry: true })).json()
    assert.deepEqual([dry.files, dry.moved, dry.commit], [1, 1, null])
    assert.ok(fs.readFileSync(f, 'utf8').includes('**경과**'))
    const r = await (await post('/api/k/demo/docfmt', {})).json()
    assert.equal(r.files, 1)
    assert.ok(fs.readFileSync(f, 'utf8').includes('<!-- kmd:참고'))
    // 화면 자료도 새 꼴로(캐시를 지웠다)
    const v = await (await fetch(`${s.url}/api/k/demo/doc?d=a`, { headers: { cookie: H.cookie } })).json()
    assert.equal(v.sections[0].refs.length, 1)
  } finally {
    await s.close()
  }
})

// ── 검토 뒤 고침 ──

test('본문의 「**경과**」 타임라인은 본문이다 — kmd 꼴의 기록 줄만 꼬리로 뗀다', () => {
  const t = '# 장애 대응\n\n요약\n\n## 2026-10-01 DB 장애\n\n- **누가**: 김\n\n**경과**\n- 09:00 알람\n- 09:30 복구\n'
  const s = parseDoc(t, '').sections[0]
  assert.equal(s.body, '- **누가**: 김\n\n**경과**\n- 09:00 알람\n- 09:30 복구')
  assert.deepEqual(s.log, [])
  // 섞여 있어도(한 줄이라도 kmd 꼴이 아니면) 본문
  const mixed = '# a\n\n## 가\n글\n\n**경과**\n- 2026-10-21 [하나](../work/2026-1021-하나.md)\n- 10:00 복구\n'
  assert.match(parseDoc(mixed, '').sections[0].body, /10:00 복구/)
  // 옮기기도 건드리지 않는다 · 사람의 글로 받는다
  assert.deepEqual(pick(convertDoc(t)), { text: t, changed: false, moved: 0, ok: true })
  assert.match(convertDoc(t).why, /날짜로 시작하지 않는 줄/)
  assert.deepEqual(formatProblems('글\n\n**경과**\n- 09:00 알람\n- 09:30 복구'), [])
  // 쓸 때도 본문 그대로(규칙 들이기가 ## 경과 → **경과** 로 바꾼 글)
  const w = replaceSection('# 장애\n', { heading: '2026-10-01 DB', body: '**원인**\nDB 락\n\n**경과**\n- 09:00 알람\n- 09:30 복구', log: ['- 2026-10-01 [장애](../work/2026-1001-x.md) · 다듬지 못함'] })
  const s2 = parseDoc(w, '').sections[0]
  assert.match(s2.body, /\*\*경과\*\*\n- 09:00 알람\n- 09:30 복구$/)
  assert.deepEqual(s2.log, ['- 2026-10-01 [장애](../work/2026-1001-x.md) · 다듬지 못함'])
})

test('옮기기 검사는 원문으로 잰다 — 본문 줄을 꼬리로 떼면 ok: false', () => {
  const old = '# a\n\n## 가\n가의 글.\n\n**경과**\n- 09:00 알람\n'
  // 잘못 옮긴 글(본문 타임라인을 참고 블록으로) — parseDoc 끼리는 같아 보여도 거절
  const bad = '# a\n\n## 가\n가의 글.\n\n<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->\n**참고**\n\n- 가\n  - 09:00 알람\n<!-- /kmd:참고 -->\n'
  assert.deepEqual(verifyConvert(old, bad), { ok: false, why: '옮기면 본문 글이 달라진다' })
  // 본문에 글을 보태도 거절
  const old2 = '# a\n\n## 가\n가의 글.\n\n**경과**\n- 2026-10-21 [하나](../work/2026-1021-하나.md)\n'
  const c = convertDoc(old2)
  assert.equal(c.ok, true)
  assert.equal(verifyConvert(old2, c.text.replace('가의 글.', '가의 글.\n덧붙임')).ok, false)
})

test('닫히지 않은 코드 울타리: 쓸 때 닫고 · 맨 끝 블록은 울타리 안이어도 읽고 · 검사는 거절', () => {
  let t = '# t\n\n## a\n본문\n```js\ncode\n'
  t = replaceSection(t, { heading: 'a', body: '본문\n```js\ncode', log: ['- 2026-01-01 [x](../work/2026-0101-x.md)'] })
  t = replaceSection(t, { heading: 'a', body: parseDoc(t, '').sections[0].body, log: ['- 2026-01-02 [y](../work/2026-0102-y.md)'] })
  assert.equal((t.match(/kmd:참고 ·/g) || []).length, 1)
  const s = parseDoc(t, '').sections[0]
  assert.equal(s.body, '본문\n```js\ncode\n```')
  assert.deepEqual(s.log, ['- 2026-01-02 [y](../work/2026-0102-y.md)'])
  // 이미 망가진 문서(울타리 안에 블록 둘) — 끝의 블록을 모두 읽고 하나로 합친다
  const broken = '# t\n\n## a\n본문\n```js\ncode\n\n' + BLOCK.join('\n').replace('- 가', '- a') + '\n\n' + BLOCK.join('\n').replace('- 가', '- a') + '\n'
  const d = parseDoc(broken, '')
  assert.equal(d.sections[0].body, '본문\n```js\ncode')
  assert.equal(d.sections[0].log.length, 1)
  const healed = replaceSection(broken, { heading: 'a', body: d.sections[0].body })
  assert.equal((healed.match(/kmd:참고 ·/g) || []).length, 1)
  assert.match(healed, /code\n```\n\n<!-- kmd:참고/)
  assert.deepEqual(formatProblems('글\n```js\ncode').map((p) => p.line), [2])
})

test('검사: 지금 글에 있던 줄은 거절하지 않는다 · 새로 든 줄만', async () => {
  const f = path.join(dir, 'docs', '메모.md')
  fs.writeFileSync(f, '# 메모\n\n## 가\n가의 글.\n<!-- 메모 -->\n[옛](../work/2026-0101-옛.md)\n')
  const base = sectionBase(fs.readFileSync(f, 'utf8'), '가')
  const old = parseDoc(fs.readFileSync(f, 'utf8'), '').sections[0].body
  // 덧붙이기(append 처럼 지금 글 + 새 줄) — 받는다 · 이미 있던 줄은 알림으로
  const r = await save(dir, { record: { title: '가: 덧붙임', body: '글', touches: [] }, sections: [{ doc: 'docs/메모.md', heading: '가', content: `${old}\n\n새 줄`, base }] }, { user: 'lee' })
  assert.equal(r.formatKept.length, 1)
  assert.match(r.formatKept[0], /「가」 에 전부터 본문이 아닌 줄이 있다/)
  // 새로 넣은 주석은 거절
  const base2 = sectionBase(fs.readFileSync(f, 'utf8'), '가')
  const now = parseDoc(fs.readFileSync(f, 'utf8'), '').sections[0].body
  await assert.rejects(async () => save(dir, { record: { title: '가: 또', body: '글' }, sections: [{ doc: 'docs/메모.md', heading: '가', content: `${now}\n<!-- 새 메모 -->`, base: base2 }] }, { user: 'lee' }), (e) => e.code === 'E_FORMAT' && /표지 밖 주석/.test(e.message))
  // 정리 초안 검사도 같다
  assert.deepEqual(formatProblems(`${now}\n\n더`, { old: now }), [])
})

test('검사: 링크는 그 문서 자리에서 푼다 · 꺾쇠 · 참조식 · 절대 주소의 화면 길', () => {
  // docs/ 안의 work/ 폴더는 문서다
  assert.deepEqual(formatProblems('[d](work/설계.md)', { doc: 'docs/a.md' }), [])
  assert.deepEqual(formatProblems('[d](work/설계.md)'), [])
  assert.deepEqual(formatProblems('[y](../work/y.md)', { doc: 'docs/운영/x.md' }), [])
  assert.equal(formatProblems('[y](../../work/y.md)', { doc: 'docs/운영/x.md' }).length, 1)
  assert.equal(formatProblems('[y](../work/y.md)', { doc: 'docs/x.md' }).length, 1)
  assert.equal(formatProblems('[y](/log/y.md)', { doc: 'docs/운영/x.md' }).length, 1)
  // 꺾쇠 안 빈칸 · 참조식
  assert.match(formatProblems('[a](<../work/a b.md>)')[0].what, /기록 · 이력 링크/)
  assert.deepEqual(formatProblems('[a][r]\n\n[r]: ../work/2026-0101-a.md').map((p) => p.line), [3])
  // 절대 주소 — 화면 길(#/) · 이 서버의 /api/
  assert.match(formatProblems('[x](http://10.10.20.188:8090/#/k/a)')[0].what, /시스템 주소/)
  assert.match(formatProblems('[x](http://10.10.20.188:8090/api/k/a)', { origins: ['http://10.10.20.188:8090'] })[0].what, /시스템 주소/)
  assert.deepEqual(formatProblems('[x](https://example.com/api/docs) <https://example.com/a#b>'), [])
})

test('참고 블록: 문서에 없는 이름의 줄은 쓸 때 걷는다', () => {
  // 문서 밖에서 「나」 를 「다」 로 바꿨다
  const t = NEW.replace('## 나', '## 다')
  const out = replaceSection(t, { heading: '가', body: '가의 새 글.' })
  const d = parseDoc(out, '')
  assert.deepEqual(d.ref.map((x) => x.h), ['가'])
  assert.ok(!out.includes('- 나\n'))
})

test('찾기 토막: 참고 블록은 마지막 항목의 글이 아니다', async () => {
  const { chunkText } = await import('../core/search.js')
  const t = '# 배포\n\n## 준비\n배포 창은 화 목.\n\n## 롤백\n되돌린다.\n\n<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->\n**참고**\n\n- 준비\n  - 2026-10-21 [배포 창 바꿈](../work/2026-1021-a.md)\n<!-- /kmd:참고 -->\n'
  const cs = chunkText(t)
  const last = cs.find((c) => c.head === '롤백')
  assert.ok(!/배포 창 바꿈|kmd:참고|\*\*참고\*\*/.test(last.text))
  assert.ok(!cs.some((c) => c.text.includes('배포 창 바꿈')))
  assert.equal(t.split('\n')[last.a], '## 롤백')
})

// 옛 CDP 표식(팀 서버 문서의 실제 꼴) — 날짜 줄 경과 · cdp:baseline · cdp:form · gen 주석
const CDP = [
  '# 위험대장',
  '<!-- cdp:form public-si/BM_501 -->',
  '',
  '결정이 필요한 것.',
  '',
  '## ISS-01 — 연계 확인',
  '<!-- applied: 2026-1019-a -->',
  '',
  '**내용** — 모른다.',
  '',
  '**경과**',
  '- `2026-09-30` 내부 회의에서 제기 ([회의록.md](../../work/2026-0930-회의록.md))',
  '- 2026-10-02 [`연계검토`](../../work/2026-1002-연계검토.md) 경보 질문 12~14',
  '- `2026-10-08` 자동제어 로직은 PLC 가 수행 (사경진 과장)',
  '',
  '**관련 좌표** — 회의록 `2026-10-01`',
  '',
  '## 표',
  '<!-- cdp:baseline src="개발 DB 추출" asof="2026-10-12" -->',
  '| 열 | 뜻 |',
  '|---|---|',
  '| a | 가 |',
  '<!-- /cdp:baseline -->',
  '',
  '<!-- gen: WBS — 일정.xlsx 에서 생성',
  '  (2026-10-02). 이 줄 아래는 다시 쓴다 -->',
  '',
  '## WBS',
  '할 일.',
  '',
  '```md',
  '<!-- 코드 안 주석은 둔다 -->',
  '```',
  '',
].join('\n')

test('옛 CDP 표식 옮기기: 날짜 줄 경과 · cdp:baseline · 주석 → 참고 메모 · 본문은 그대로', async () => {
  const { strayMarks } = await import('../core/docformat.js')
  const c = convertDoc(CDP)
  assert.equal(c.ok, true, c.why)
  assert.equal(c.changed, true)
  assert.deepEqual(c.kinds, { kmd: 0, log: 3, table: 1, mark: 2 })
  assert.equal(c.left, 0)
  assert.equal(strayMarks(CDP), 4) // form · baseline 두 줄 · gen(코드 안 것은 세지 않는다)
  const d = parseDoc(c.text, '')
  // (a) 경과 줄은 그대로(앞의 「- 」 만) 그 항목 참고로
  const iss = d.sections.find((s) => s.h === 'ISS-01 — 연계 확인')
  assert.deepEqual(iss.log, ['- `2026-09-30` 내부 회의에서 제기 ([회의록.md](../../work/2026-0930-회의록.md))', '- 2026-10-02 [`연계검토`](../../work/2026-1002-연계검토.md) 경보 질문 12~14', '- `2026-10-08` 자동제어 로직은 PLC 가 수행 (사경진 과장)'])
  assert.equal(iss.applied, '2026-1019-a')
  assert.ok(iss.body.includes('**관련 좌표**') && !iss.body.includes('**경과**'))
  // (b) 표는 본문에 · 주석 두 줄은 걷고 「표 출처」
  const tb = d.sections.find((s) => s.h === '표')
  assert.ok(tb.body.startsWith('| 열 | 뜻 |') && !tb.body.includes('cdp:'))
  assert.deepEqual(tb.log, ['- 표 출처: 개발 DB 추출 · 2026-10-12'])
  // (c) 머리글 주석은 (문서) · 바로 아래 ## 가 오는 여러 줄 주석은 그 항목
  assert.deepEqual(d.docLog, ['- 표식: cdp:form public-si/BM_501'])
  assert.deepEqual(d.sections.find((s) => s.h === 'WBS').log, ['- 표식: gen: WBS — 일정.xlsx 에서 생성 (2026-10-02). 이 줄 아래는 다시 쓴다'])
  assert.ok(c.text.includes('<!-- 코드 안 주석은 둔다 -->'))
  assert.ok(c.text.startsWith('# 위험대장\n\n결정이 필요한 것.'))
  // 블록은 (문서) 가 맨 앞
  const blk = c.text.slice(c.text.indexOf('**참고**'))
  assert.ok(blk.indexOf('- (문서)') < blk.indexOf('- ISS-01'))
  // 다시 옮기면 바뀜 없음(멱등)
  const c2 = convertDoc(c.text)
  assert.equal(c2.changed, false)
  assert.equal(c2.moved, 0)
  assert.equal(c2.ok, true)
})

test('옛 CDP 경과: 날짜로 시작하지 않는 줄이 섞이면 본문으로 둔다(까닭을 남긴다)', () => {
  const t = '# 장애\n\n## 타임라인\n**경과**\n- `2026-10-01` 멈춤\n- 오후에 다시 켬\n'
  const c = convertDoc(t)
  assert.equal(c.ok, true)
  assert.equal(c.changed, false)
  assert.match(c.why, /타임라인.*날짜로 시작하지 않는 줄/)
})

test('옮기기 검사: 뗀 표식이 참고에 없거나 본문 줄이 빠지면 ok: false', () => {
  const ok = convertDoc(CDP).text
  // 메모 하나를 지운 글
  const lost = ok.replace('  - 표 출처: 개발 DB 추출 · 2026-10-12\n', '')
  assert.equal(verifyConvert(CDP, lost).ok, false)
  // 본문 줄 하나가 빠진 글
  assert.equal(verifyConvert(CDP, ok.replace('**관련 좌표** — 회의록 `2026-10-01`\n', '')).ok, false)
  assert.equal(verifyConvert(CDP, ok).ok, true)
})

test('참고 블록 메모 줄 · (문서): 읽고 그대로 다시 쓴다 · 풀기 도우미', async () => {
  const { parseRefLine } = await import('../core/sections.js')
  const t = convertDoc(CDP).text
  // 다른 항목을 고쳐 써도 메모 줄 · (문서) 줄은 그대로
  const out = replaceSection(t, { heading: 'WBS', body: '할 일 바꿈.' })
  const a = parseDoc(t, '')
  const b = parseDoc(out, '')
  assert.deepEqual(b.ref, a.ref)
  assert.deepEqual(b.docLog, ['- 표식: cdp:form public-si/BM_501'])
  // 이름 바꾸기 · 지우기도 (문서) 는 둔다
  assert.deepEqual(parseDoc(removeSection(out, { heading: 'WBS' }), '').docLog, b.docLog)
  assert.deepEqual(parseDoc(renameSection(out, { heading: '표', to: '표2' }), '').sections.find((s) => s.h === '표2').log, ['- 표 출처: 개발 DB 추출 · 2026-10-12'])
  // 같은 링크의 메모 줄 둘은 합치지 않는다(기록 줄만 링크로 합친다)
  const two = ['- `2026-10-01` 가 ([x](../../work/2026-1001-a.md))', '- `2026-10-02` 나 ([x](../../work/2026-1001-a.md))']
  const r = replaceSection('# t\n\n## 가\n글.\n', { heading: '가', body: '글.', log: two })
  assert.deepEqual(parseDoc(r, '').sections[0].log, two)
  // 풀기 — 기록 줄 · 메모 줄
  assert.deepEqual(parseRefLine('- 2026-10-21 [배포 창](../work/2026-1021-a.md) · 다듬지 못함'), { kind: 'rec', date: '2026-10-21', title: '배포 창', href: '../work/2026-1021-a.md', note: '다듬지 못함' })
  assert.deepEqual(parseRefLine('- 표 출처: 개발 DB 추출 · 2026-10-12'), { kind: 'note', date: null, title: null, href: null, note: '표 출처: 개발 DB 추출 · 2026-10-12' })
  assert.equal(parseRefLine('- 2026-10-02 [`연계검토`](../../work/2026-1002-b.md) 경보 질문').kind, 'note')
})

// ── 옛 CDP 표식 옮기기 검토 뒤 고침 ──

test('옛 CDP 경과: 날짜로만 시작하는 사람의 타임라인은 본문에 둔다(까닭을 남긴다)', () => {
  const t = '# 장애 보고\n\n## 장애 경과\n\n**경과**\n- 2026-10-01 09:00 DB 서버 응답 없음\n- 2026-10-01 09:30 재기동 · 복구\n\n원인은 디스크 가득 참.\n'
  const c = convertDoc(t)
  assert.deepEqual(pick(c), { text: t, changed: false, moved: 0, ok: true })
  assert.match(c.why, /장애 경과.*사람이 쓴 타임라인/)
  assert.ok(parseDoc(c.text, '').sections[0].body.includes('09:30 재기동'))
})

test('옛 CDP 경과: **경과** 와 목록 사이 빈 줄은 건너 찾는다', () => {
  const t = '# a\n\n## 가\n글\n\n**경과**\n\n- `2026-10-01` 회의\n- 2026-10-02 [`검토`](../../work/2026-1002-검토.md) 질문\n\n뒤 글.\n'
  const c = convertDoc(t)
  assert.equal(c.ok, true, c.why)
  assert.equal(c.kinds.log, 2)
  const s = parseDoc(c.text, '').sections[0]
  assert.equal(s.body, '글\n\n뒤 글.')
  assert.deepEqual(s.log, ['- `2026-10-01` 회의', '- 2026-10-02 [`검토`](../../work/2026-1002-검토.md) 질문'])
})

test('옛 CDP 경과: 글이 같은 줄 둘은 둘 다 옮긴다 · 다시 읽고 써도 둘', () => {
  const t = '# a\n\n## A\na\n\n**경과**\n- `2026-10-01` 회의\n- `2026-10-01` 회의\n'
  const c = convertDoc(t)
  assert.equal(c.ok, true, c.why)
  assert.equal(c.moved, 2)
  assert.deepEqual(parseDoc(c.text, '').sections[0].log, ['- `2026-10-01` 회의', '- `2026-10-01` 회의'])
  const out = replaceSection(c.text, { heading: 'A', body: 'a 바꿈' })
  assert.deepEqual(parseDoc(out, '').sections[0].log, ['- `2026-10-01` 회의', '- `2026-10-01` 회의'])
  // 검사 — 둘 가운데 하나를 잃은 글은 ok: false(개수까지 센다)
  assert.equal(verifyConvert(t, c.text.replace('  - `2026-10-01` 회의\n', '')).ok, false)
})

test('옛 표식 주석: 항목 끝 주석은 그 항목 · gen: 만 바로 아래 항목 · 빈 항목도 이름으로', () => {
  const t = '# a\n\n## A\n표 하나\n\n<!-- TODO: 위 표 값 확인 -->\n\n## B\nb 글\n'
  const c = convertDoc(t)
  assert.equal(c.ok, true, c.why)
  const d = parseDoc(c.text, '')
  assert.deepEqual(d.sections.find((s) => s.h === 'A').log, ['- 표식: TODO: 위 표 값 확인'])
  assert.deepEqual(d.sections.find((s) => s.h === 'B').log, [])
  // 바로 아래 항목이 비어 있어도 그 항목으로
  const g = '# a\n\n## A\n글\n\n<!-- gen: 표 — x.xlsx 에서 생성 -->\n\n## B\n## C\nc\n'
  const cg = convertDoc(g)
  assert.equal(cg.ok, true, cg.why)
  const dg = parseDoc(cg.text, '')
  assert.deepEqual(dg.sections.find((s) => s.h === 'B').log, ['- 표식: gen: 표 — x.xlsx 에서 생성'])
  assert.deepEqual(dg.docLog, [])
  // 검사 — 메모가 엉뚱한 항목에 붙으면 ok: false
  const wrong = c.text.replace('- A\n  - 표식', '- B\n  - 표식')
  assert.equal(verifyConvert(t, wrong, [{ h: 'A', l: '- 표식: TODO: 위 표 값 확인' }]).ok, false)
  assert.equal(verifyConvert(t, c.text, [{ h: 'A', l: '- 표식: TODO: 위 표 값 확인' }]).ok, true)
})

test('옛 GDI 변경 이력(Q73): 머리 · 가운뎃점 줄 → 그 항목의 기록 줄 · 꼴이 아닌 줄이 섞이면 둔다 · 멱등', () => {
  const t = '# a\n\n요약.\n\n## A\n글\n\n**변경 이력** (편입한 과거 기록 — 지금 상태는 위 본문이다)\n· 2026-07-02 [`x-신설`](../work/2026-0702-x-신설.md) A 신설\n· 2026-07-03 12:10 [`y`](../work/2026-0703-y.md) 고침\n\n## B\nb\n\n**변경** · 2026-08-01 [`z`](../work/2026-0801-z.md) 하나\n**변경** · 2026-08-02 [`w`](../work/2026-0802-w.md) 둘\n\n## C\nc\n\n**변경**\n· 2026-08-03 [`v`](../work/2026-0803-v.md) 셋\n이어진 본문 글\n'
  const c = convertDoc(t)
  assert.equal(c.ok, true, c.why)
  assert.equal(c.kinds.change, 4)
  const d = parseDoc(c.text, '')
  assert.deepEqual(d.sections.find((s) => s.h === 'A').log, ['- 2026-07-02 [x-신설](../work/2026-0702-x-신설.md) · A 신설', '- 2026-07-03 [y](../work/2026-0703-y.md) · 고침'])
  assert.equal(d.sections.find((s) => s.h === 'B').log.length, 2)
  assert.ok(!c.text.split('<!-- kmd:참고')[0].includes('변경 이력'))
  // C 는 꼴이 아닌 줄이 섞여 본문으로 둔다
  assert.ok(c.text.includes('· 2026-08-03 [`v`]') && /C/.test(c.why))
  assert.equal(convertDoc(c.text).moved, 0)
})

test('문서 짜임 검사(lintDoc): 제목 · 요약 · 운영 말 · ## 앞 소제목 · 단계 건너뜀 · 5단계 · 머리 앞 applied 는 옮기기가 걷는다', () => {
  const t = '<!-- applied: 2026-1019-x -->\n| 작성 | 판 |\n|---|---|\n| a | 1 |\n\n### 목적\n좌표는 `screen:X` 다\n\n## A\n#### 건너뜀\n##### 깊다\n'
  const codes = lintDoc(t).map((x) => x.code)
  for (const c of ['no-title', 'top-applied', 'no-summary', 'ops-word', 'sub-before-sec', 'skip-level', 'too-deep']) assert.ok(codes.includes(c), c)
  const c = convertDoc(t)
  assert.equal(c.ok, true, c.why)
  assert.equal(c.kinds.top, 1)
  assert.ok(!c.text.includes('applied'))
  assert.deepEqual(lintDoc('# 제목\n\n이 문서는 배포를 다룬다. 창은 화 · 목이다.\n\n## A\n### a\n#### b\n'), [])
  assert.equal(lintDoc('# 제목\n\n한. 둘. 셋. 넷.\n\n## A\n')[0].code, 'long-summary')
  // 저장 알림은 새로 생긴 것만
  assert.deepEqual(lintNew('# t\n\n요약.\n\n## A\n#### x\n', '# t\n\n요약.\n\n## A\n#### x\n## B\n#### y\n').map((x) => x.code), ['skip-level'])
})

test('Q86 짜임 알림: 같은 인용 문장(출처 · 상태)이 다섯 번 이상이면 한 번 알린다 · 넷이면 없다', async () => {
  const { lintDoc } = await import('../core/docformat.js')
  const doc = (n) => '# 제목\n\n요약이다.\n\n' + Array.from({ length: n }, (_, i) => `## A${i}\n\n> 아래는 사용자 매뉴얼에서 옮긴 것이다(${i}절)\n\n글.\n`).join('\n')
  const xs = lintDoc(doc(6)).filter((x) => x.code === 'repeat-note')
  assert.equal(xs.length, 1)
  assert.match(xs[0].msg, /6번 되풀이/)
  assert.equal(lintDoc(doc(4)).filter((x) => x.code === 'repeat-note').length, 0)
})
