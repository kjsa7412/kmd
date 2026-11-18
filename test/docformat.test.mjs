// 문서 꼴 — 본문과 시스템 참고 정보를 나눈다(docs/kmd_문서_작성기준.md).
//
// 참고 블록(문서 끝)을 읽을 때 떼고 · 옛 경과 꼬리 · 「기록 그대로」 줄은 읽지 않고(옛 꼴은 이행기 core/oldform.js 만 안다 · 그 시험은 oldform.test) · 쓸 때 블록을 다시 쓴다 ·
// 저장은 참고 줄을 잃지 않는다 · 사람 · 세션의 항목 글 검사(E_FORMAT) ·
// 화면 링크 풀이(문서 · 항목 · 없는 문서 · 기록 · 이력 · 바깥 · 열 수 없는 것 · 깨진 % · README.md) · 표 감싸기.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDoc, replaceSection, removeSection, renameSection, stampAll } from '../core/sections.js'
import { formatProblems, lintDoc, lintNew } from '../core/docformat.js'
import { save, sectionBase } from '../core/save.js'
import { loadKnowledge } from '../core/knowledge.js'
import { render, linkTarget, linksOf, citesOf, docView } from '../server/views.js'
import { copyDir } from './helpers.mjs'

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

test('읽기: 옛 경과 꼬리 · 「기록 그대로」 줄은 읽지 않는다(지금 꼴만 · 옛 꼴은 옛 문서 옮기기가 안다)', () => {
  const old = ['# 문서', '', '## 가', '가의 글.', '', '> 기록 그대로: [셋](../work/2026-1023-셋.md) · Claude 로 다듬지 못했다', '', '붙인 기록 글.', '', '**경과**', '- 2026-10-21 [하나](../work/2026-1021-하나.md)', ''].join('\n')
  const s = parseDoc(old, '').sections[0]
  assert.ok(s.body.includes('**경과**') && s.body.includes('기록 그대로'))
  assert.deepEqual(s.log, [])
  assert.equal(s.old, undefined)
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
  // log 를 주지 않으면 지금 줄을 그대로 둔다(보낸 글의 경과 꼬리를 떼는 것은 저장 문 · core/save.js)
  const w2 = replaceSection(NEW, { heading: '나', body: '나의 새 글.' })
  assert.deepEqual(parseDoc(w2, '').sections[1].log, ['- 2026-10-22 [둘](../work/2026-1022-둘.md)'])
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

test('쓰기: 다른 항목의 글은 바이트 그대로(옛 꼬리가 있어도 건드리지 않는다)', () => {
  const old = ['# 문서', '', '## 가', '가의 글.', '', '## 나', '나의 글.', '', '**경과**', '- 2026-10-22 [둘](../work/b.md)', ''].join('\n')
  const w = replaceSection(old, { heading: '가', body: '가의 새 글.', log: ['- 2026-10-21 [하나](../work/a.md)'] })
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

test('저장: 참고 줄을 잃지 않는다 · base 는 본문으로 잰다', async () => {
  const f = path.join(dir, 'docs', '롤백절차.md')
  const text = fs.readFileSync(f, 'utf8')
  const sec = parseDoc(text, '').sections[0]
  const h = sec.h
  // 앞 기록의 참고 줄 하나
  fs.writeFileSync(f, replaceSection(text, { heading: h, body: sec.body, applied: sec.applied, log: ['- 2026-10-01 [옛 기록](../work/2026-1001-옛.md)'] }))
  const sec0 = parseDoc(fs.readFileSync(f, 'utf8'), '').sections[0]
  assert.deepEqual(sec0.log, ['- 2026-10-01 [옛 기록](../work/2026-1001-옛.md)'])
  const base = sectionBase(fs.readFileSync(f, 'utf8'), h)
  const k = await loadKnowledge({ id: 'dpms', name: 'dpms', dir })
  assert.equal(k.byDocPath.get('docs/롤백절차.md').sections[0].body, sec0.body)
  const r = await save(dir, { record: { title: `${h}: 새 글`, body: '새 글', touches: ['proc:되돌리기'] }, sections: [{ doc: 'docs/롤백절차.md', heading: h, content: '되돌리기는 이전 판으로 3단계에 한다.', base }] }, { user: 'lee' })
  const raw = fs.readFileSync(f, 'utf8')
  assert.ok(!/\*\*경과\*\*/.test(raw))
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
  assert.ok(html.includes('<a href="#/k/K/d/' + encodeURIComponent('배포절차') + '/h/' + encodeURIComponent('준비') + '" class="dlink item" data-a="openDoc" data-k="K" data-d="배포절차" data-h="준비">a</a>'))
  assert.ok(html.includes('<a class="dlink doc missing" title="없는 문서">b</a>'))
  assert.ok(html.includes('<a href="#/k/K/r/2026-1026-b" class="dlink rec" data-a="openRec" data-k="K" data-r="2026-1026-b">c</a>'))
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

test('본문의 「**경과**」 타임라인은 본문이다 — kmd 꼴의 기록 줄만 꼬리로 뗀다', () => {
  const t = '# 장애 대응\n\n요약\n\n## 2026-10-01 DB 장애\n\n- **누가**: 김\n\n**경과**\n- 09:00 알람\n- 09:30 복구\n'
  const s = parseDoc(t, '').sections[0]
  assert.equal(s.body, '- **누가**: 김\n\n**경과**\n- 09:00 알람\n- 09:30 복구')
  assert.deepEqual(s.log, [])
  // 섞여 있어도(한 줄이라도 kmd 꼴이 아니면) 본문
  const mixed = '# a\n\n## 가\n글\n\n**경과**\n- 2026-10-21 [하나](../work/2026-1021-하나.md)\n- 10:00 복구\n'
  assert.match(parseDoc(mixed, '').sections[0].body, /10:00 복구/)
  assert.deepEqual(formatProblems('글\n\n**경과**\n- 09:00 알람\n- 09:30 복구'), [])
  // 쓸 때도 본문 그대로(규칙 들이기가 ## 경과 → **경과** 로 바꾼 글)
  const w = replaceSection('# 장애\n', { heading: '2026-10-01 DB', body: '**원인**\nDB 락\n\n**경과**\n- 09:00 알람\n- 09:30 복구', log: ['- 2026-10-01 [장애](../work/2026-1001-x.md) · 다듬지 못함'] })
  const s2 = parseDoc(w, '').sections[0]
  assert.match(s2.body, /\*\*경과\*\*\n- 09:00 알람\n- 09:30 복구$/)
  assert.deepEqual(s2.log, ['- 2026-10-01 [장애](../work/2026-1001-x.md) · 다듬지 못함'])
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

test('문서 짜임 검사(lintDoc): 제목 · 요약 · 운영 말 · ## 앞 소제목 · 단계 건너뜀 · 5단계 · 머리 앞 applied', () => {
  const t = '<!-- applied: 2026-1019-x -->\n| 작성 | 판 |\n|---|---|\n| a | 1 |\n\n### 목적\n좌표는 `screen:X` 다\n\n## A\n#### 건너뜀\n##### 깊다\n'
  const codes = lintDoc(t).map((x) => x.code)
  for (const c of ['no-title', 'top-applied', 'no-summary', 'ops-word', 'sub-before-sec', 'skip-level', 'too-deep']) assert.ok(codes.includes(c), c)
  assert.deepEqual(lintDoc('# 제목\n\n이 문서는 배포를 다룬다. 창은 화 · 목이다.\n\n## A\n1. a\n1.1. b\n1) c\n- d\n'), [])
  // 작성기준 v1.2 5-1절 — ### 소제목은 받되 수준 표시로 쓰라는 알림
  assert.deepEqual(lintDoc('# 제목\n\n이 문서는 배포를 다룬다. 창은 화 · 목이다.\n\n## A\n### a\n#### b\n').map((x) => x.code), ['sub-head', 'sub-head'])
  assert.equal(lintDoc('# 제목\n\n한. 둘. 셋. 넷.\n\n## A\n')[0].code, 'long-summary')
  // 저장 알림은 새로 생긴 것만
  assert.deepEqual(lintNew('# t\n\n요약.\n\n## A\n#### x\n', '# t\n\n요약.\n\n## A\n#### x\n## B\n#### y\n').map((x) => x.code), ['skip-level', 'sub-head'])
})

test('Q86 짜임 알림: 같은 인용 문장(출처 · 상태)이 다섯 번 이상이면 한 번 알린다 · 넷이면 없다', async () => {
  const { lintDoc } = await import('../core/docformat.js')
  const doc = (n) => '# 제목\n\n요약이다.\n\n' + Array.from({ length: n }, (_, i) => `## A${i}\n\n> 아래는 사용자 매뉴얼에서 옮긴 것이다(${i}절)\n\n글.\n`).join('\n')
  const xs = lintDoc(doc(6)).filter((x) => x.code === 'repeat-note')
  assert.equal(xs.length, 1)
  assert.match(xs[0].msg, /6번 되풀이/)
  assert.equal(lintDoc(doc(4)).filter((x) => x.code === 'repeat-note').length, 0)
})
