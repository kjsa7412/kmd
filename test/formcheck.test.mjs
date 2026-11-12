// 서식 계약 · 서식 검사(서식 설계 F1 ~ F7) — core/forms.js · core/formcheck.js · core/guard.js parseProps · core/ooxml.js 날짜 · 저장 알림(formLint)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FORMS, KINDS, ISSUE_PROPS, kindOf, formBlock, formFixOf, templateOf } from '../core/forms.js'
import { lintForm, lintFormNew, missingIds, headProblem, FIX_CODES } from '../core/formcheck.js'
import { formsOf, parseForms, parseProps } from '../core/guard.js'
import { excelDate, tidyNumber } from '../core/ooxml.js'
import { WRITE_RULES } from '../core/writerules.js'

const codes = (xs) => xs.map((x) => x.code)

test('계약 — 종류 여섯 · 종류 정하기(갈래 장부 · 서식 결정기록 · 이름 짐작) · 속성 정의가 기본 속성을 이긴다', () => {
  assert.deepEqual(KINDS, ['대상', '서술', '사건', '대장', '결정', '기록'])
  for (const k of KINDS) assert.ok(FORMS[k].ask && FORMS[k].head && FORMS[k].order, k)
  const forms = formsOf(['| 갈래 | 별칭 | 폴더 | 종류 | 항목 | 서식 |', '|---|---|---|---|---|---|', '| 위험및이슈관리대장 | 이슈, 위험 | 1.2 | 대장 | `이슈:*` | 결정기록 |', '| 설계 결정 | 결정 | 3 | 대상 | - | 결정기록 |', '| 회의록 | 회의 | 1.2 | 사건 | - | 작업기록 |', '', '## 속성: 위험및이슈관리대장', '', '| 속성 | 원본 칸 | 쓰는 법 | 필수 |', '|---|---|---|---|', '| 유형 | 이슈 유형 | 범위 · 일정 | ! |', '| 제기 | 이슈 제기자 | 이름 | ? |'].join('\n'))
  assert.equal(forms.rows.length, 3, '속성 표는 갈래 행이 아니다')
  assert.deepEqual(kindOf(forms, '1.2/위험및이슈관리대장').props.map((p) => [p.name, p.must]), [['유형', true], ['제기', false]])
  assert.equal(kindOf(forms, '3/설계 결정').kind, '결정', '서식 결정기록 + 종류 대상 → 결정')
  assert.equal(kindOf(forms, '1.2/위험및이슈관리대장').kind, '대장', '대장은 서식이 결정기록이어도 대장')
  const none = formsOf('')
  assert.equal(kindOf(none, '사업관리/위험및이슈관리대장').props, ISSUE_PROPS, '장부가 없으면 이슈 대장 기본 속성')
  assert.equal(kindOf(none, '사업관리/주간보고').kind, '사건')
  assert.equal(kindOf(none, '설계/코드정의서').kind, '대상')
  assert.equal(parseProps('## 속성: x\n\n| 속성 | 원본 칸 |\n|---|---|\n| __proto__ | y |').size, 0, 'prototype 이름 막기')
  assert.equal(parseForms('## 속성: a\n| 유형 | 이슈 유형 | 범위 | ! |').length, 0)
})

test('속성 정의 쓰기 — 저장 forms[].props 가 「## 속성: <갈래>」 블록을 쓰고 바꾸고 걷는다 · 새 갈래 줄은 갈래 표에만', async () => {
  const { upsertForms, cleanForms } = await import('../core/namebook.js')
  const f = cleanForms([{ name: '위험및이슈관리대장', aliases: ['이슈'], folder: '1.2', kind: '대장', pattern: '이슈:*', form: '지식문서', props: [{ name: '유형', src: '이슈 유형', how: '기술 · 일정', must: true }, { name: '처리 담당' }] }])
  let t = upsertForms('', f)
  assert.deepEqual(formsOf(t).rows[0].props.map((p) => [p.name, p.must]), [['유형', true], ['처리 담당', false]])
  t = upsertForms(t, cleanForms([{ name: '회의록', kind: '사건' }]))
  assert.deepEqual(parseForms(t).map((r) => r.name), ['위험및이슈관리대장', '회의록'], '새 갈래 줄은 속성 표가 아니라 갈래 표에')
  assert.equal(parseProps(t).get('위험및이슈관리대장').length, 2)
  t = upsertForms(t, cleanForms([{ name: '위험및이슈관리대장', kind: '대장', pattern: '이슈:*', props: [{ name: '진행상태', must: true }] }]))
  assert.deepEqual(parseProps(t).get('위험및이슈관리대장').map((p) => p.name), ['진행상태'], '바꾼다')
  assert.equal((t.match(/## 속성:/g) || []).length, 1)
  t = upsertForms(t, cleanForms([{ name: '위험및이슈관리대장', kind: '대장', props: [] }]))
  assert.equal(parseProps(t).size, 0, '빈 목록이면 걷는다')
  assert.equal(cleanForms([{ name: 'x', props: [{ name: '__proto__' }] }]), null)
  assert.equal(cleanForms([{ name: 'x', props: [{ name: 'a' }, { name: 'a' }] }]), null)
})

test('프롬프트 블록 · 고쳐 받기 꼴 · 템플릿 · WRITE_RULES 에 서식 공통 줄', () => {
  const b = formBlock('대장', { name: '위험및이슈관리대장', props: ISSUE_PROPS })
  assert.match(b, /이 문서의 서식\(위험및이슈관리대장 · 대장\)/)
  assert.match(b, /속성 행\(이 차례 · 빠짐 없이 · 빈 값 「-」\): 유형 · 영역 · 식별단계/)
  assert.match(b, /좋은 예:\n## IS01/)
  assert.match(b, /나쁜 예: /)
  assert.ok(!/—/.test(b), '줄표 없음')
  assert.match(formFixOf([{ code: 'no-lead', where: 'IS01', line: 3, msg: '첫 문장 없음' }]), /^서식 검사에 걸린 곳이다[\s\S]*- no-lead IS01 3째 줄: 첫 문장 없음/)
  assert.match(templateOf('사건'), /- \*\*누가\*\*:\n- \*\*때 · 곳\*\*: \(선택\)/)
  assert.match(WRITE_RULES, /서식\(작성기준 7절\)/)
  assert.match(WRITE_RULES, /「- \*\*누가\*\*:」/)
})

test('검사 — 지금 kmd 꼴(요약 없음 · 메타 뭉침 · 라벨 없음 · 양식 항목 · 엑셀 날짜 · 번호 되풀이)은 걸리고 계약 꼴은 넘는다', () => {
  const bad = ['# 회의록', '', '## 2022-08-03 분석 설계 사전 미팅', '프로젝트명: 나라119. 일시: 2022-08-03 11:00. 장소: 창원. 참석자: 김지현.', '', '1. 현황', '- 소스 제공 불가', '1. 신규', '- 조회 프로그램'].join('\n')
  const xs = lintForm(bad, { kind: '사건' })
  for (const c of ['no-summary', 'meta-lump', 'missing-label', 'num-repeat']) assert.ok(codes(xs).includes(c), c + ' ' + JSON.stringify(codes(xs)))
  const good = ['# 회의록', '', '이 문서는 회의 한 번을 항목 하나로 적는다.', '', '## 2022-08-30 실무자 인터뷰', '', '공무팀 실무자를 인터뷰해 요구를 모았다.', '', '- **누가**: 김지현, 박재성', '- **때 · 곳**: 2022-08-30 10:00 · 김해', '- **정한 것**:', '* 원본에 따로 없음', '- **남은 것**:', '* 엑셀 파일 전달: 김지현 · 기한 -', '', '1. 공무팀 업무', '1.1. 보고', '- 주 단위로 보고한다.', '2. 자금'].join('\n')
  assert.deepEqual(lintForm(good, { kind: '사건' }).filter((x) => x.level === 'fix'), [])
  const ledger = ['# 위험및이슈관리대장', '', '이슈 하나에 항목 하나다.', '', '## IS01: 소스코드 접근 불가', '', '| 항목 | 값 |', '|---|---|', '| 발생일 | 44785 |', '', '## 이슈 관리 필드 구조', '', '식별 · 해결 단계다.'].join('\n')
  const ys = lintForm(ledger, { kind: '대장', props: ISSUE_PROPS })
  for (const c of ['no-lead', 'prop-rows', 'raw-date', 'form-meta', 'missing-label']) assert.ok(codes(ys).includes(c), c + ' ' + JSON.stringify(codes(ys)))
  assert.ok(ys.filter((x) => FIX_CODES.has(x.code)).every((x) => x.level === 'fix'))
  const head = lintForm('# x\n\n요약.\n\n## 3.2 직급\n\n직급 코드다.\n', { kind: '대상' })
  assert.deepEqual(codes(head), ['head-form'])
  const cell = lintForm('# x\n\n요약.\n\n## 공통 코드\n\n코드다.\n\n| 그룹 | 값 |\n|---|---|\n| HR001 | 0001 대표 · 0002 이사 · 0003 부장 · 0004 과장 · 0005 사원 |\n| SY001 | 〃 |\n', { kind: '대상' })
  assert.deepEqual(codes(cell).sort(), ['cell-list', 'ditto'])
  assert.equal(lintForm('# 주간보고\n\n주마다 하나.\n\n## 10주차\n\n진도 11%.\n', { kind: '사건', form: '보고서' }).filter((x) => x.code === 'missing-label').length, 0, '정례 보고는 회의 라벨을 묻지 않는다')
  assert.ok(codes(lintForm('# a\n\n요약.\n\n## 2022-08-11 요구\n\n모았다.\n\n- **누가**: a\n- **때 · 곳**: 2022-08-10 · 김해\n- **정한 것**:\n* 없음\n- **남은 것**:\n* 없음\n', { kind: '사건' })).includes('date-mismatch'))
  assert.ok(codes(lintForm('# a\n\n요약.\n\n## 설치\n\n설치한다.\n\n<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->\n**참고**\n\n- 설치 순서\n  - 2026-11-01 [x](../work/a.md)\n<!-- /kmd:참고 -->\n', { kind: '대상' })).includes('ref-key'), '참고 키가 머리에 없다')
})

test('저장 알림 — 새로 생긴 것만 · 옛 머리 「값:」 이 사라지면 head-value · 대장 원본 ID 덮임 · 머리 하나 검사', () => {
  const before = '# x\n\n요약.\n\n## 설치: 설치 순서\n\n설치한다.\n'
  assert.deepEqual(lintFormNew(before, before, { kind: '대상' }), [])
  const after = '# x\n\n요약.\n\n## 설치 순서\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
  assert.deepEqual(codes(lintFormNew(before, after, { kind: '대상' })).sort(), ['head-value', 'no-lead'])
  assert.deepEqual(missingIds(['| 이슈ID | 유형 |\n|---|---|\n| IS01 | 범위 |\n| IS02 |  |'], ['IS01: 소스코드']), ['IS02'])
  assert.deepEqual(missingIds(['| ISS-09 | x |'], ['ISS-09']), [])
  assert.match(headProblem('대장', '이슈 관리 필드 구조'), /양식 항목/)
  assert.equal(headProblem('대장', 'IS02'), null)
  assert.match(headProblem('사건', '착수 회의'), /꼴\(사건\)/)
  assert.equal(headProblem('사건', '10주차'), null)
})

test('원본 전처리 — 엑셀 날짜 일련번호 · 시각 · 부동소수 꼬리', () => {
  assert.equal(excelDate(44785), '2022-08-12')
  assert.equal(excelDate(44785.5, true), '2022-08-12 12:00')
  assert.equal(excelDate('x'), null)
  assert.equal(tidyNumber('0.30000000000000004'), '0.3')
  assert.equal(tidyNumber('2.9999999999999996'), '3')
  assert.equal(tidyNumber('12.5'), '12.5')
})

test('저장 문 — 새 항목의 서식 문제는 formLint 알림(저장은 한다) · 이미 있던 문제는 다시 알리지 않는다', async () => {
  const { save } = await import('../core/save.js')
  const { ensureRepo } = await import('../core/git.js')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-form-'))
  try {
    const dir = path.join(tmp, 'kn')
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', '회의록.md'), '# 회의록\n\n회의 한 번에 항목 하나다.\n\n## 2022-08-01 사전\n\n사전 회의다.\n\n- **누가**: 김\n- **정한 것**:\n* 없음\n- **남은 것**:\n* 없음\n')
    await ensureRepo(dir)
    const r = await save(dir, { record: { title: '착수 회의', body: '착수 회의를 적었다.' }, sections: [{ doc: 'docs/회의록.md', heading: '2022-08-03 착수', content: '프로젝트명: 나라. 일시: 2022-08-03. 장소: 창원. 참석: 김.\n' }] }, { user: 'lee' })
    assert.ok(r.commit, '저장은 했다')
    assert.equal(r.formLint?.length, 1, JSON.stringify(r.formLint))
    assert.equal(r.formLint[0].kind, '사건')
    assert.match(r.formLint[0].msg, /^「회의록」 서식\(알림 · 저장은 했다\)/)
    const cs = r.formLint[0].items.map((x) => x.code)
    assert.ok(cs.includes('missing-label') && cs.includes('meta-lump'), cs.join(' '))
    assert.ok(r.formLint[0].items.every((x) => x.where === '2022-08-03 착수'), '새 항목만(이미 있던 항목은 다시 알리지 않는다)')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
