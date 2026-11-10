// 메뉴 길 말(UX T5-07 · 메뉴 개편 설계 5 · 6절) — 사람에게 「어디서 하라」 고 쓸 때 쓰는 메뉴 이름의 한 곳.
//   화면의 메뉴(app/main.js setMenu · workMenu · impTabsHtml)와 같아야 한다. test/menupath.test.mjs 가
//   ① 화면 메뉴 이름이 여기 「지금」 목록과 같은지 ② 서버 · core · 스킬 · 설명서 글의 메뉴 길(「설정 › …」 · 「지식관리 › …」 · 「생성 › …」 · 「확인 › …」 · 「문서 › 구조」)이
//   지금 화면에 있는 이름으로 시작하는지 ③ 목표 메뉴에만 있는 길을 아직 쓰지 않는지 본다.
//   메뉴 이름을 바꾸면 여기와 화면 · 글을 같은 커밋에서 고친다. N4 ~ N6 에서 화면을 옮기면 「지금」 목록을 목표로 바꾸고 BRIDGE 를 걷는다.

// ── 지금 화면(메뉴 개편 N3 뒤 · N4 전) ──
export const SET_TEAM = Object.freeze(['운영', '팀 일꾼', '팀 지식', '사람', '에이전트 설치', '서버 정보'])
export const SET_PC = Object.freeze(['이 PC', 'Claude 연결', '에이전트 설치'])
// 옆 메뉴 아이콘 줄의 작업(설정 밖) — 개인 생성 · 구조 · 공유 / 팀 생성 · 확인 · 구조
export const WORK = Object.freeze(['생성', '확인', '구조', '공유'])
// 생성 화면의 탭 · 확인 화면(넣지 못함) — 「생성 › 도는 일」 · 「확인 › 넣지 못함」 꼴의 길
export const IMP_TABS = Object.freeze(['도는 일', '자동수집', '끝난 일'])
export const HELD_NOW = Object.freeze(['넣지 못함'])
export const MENU_NAMES = Object.freeze([...new Set([...SET_TEAM, ...SET_PC])])
// 아직 설정 밑에 있는 페이지 → 목표 길(N6 에서 제자리로 옮기며 걷는다)
export const BRIDGE = Object.freeze({ '이 PC': '설정 › 지식백업 · 설정 › 팀 연결 · 지식관리 › 모든 지식', '팀 지식': '지식관리 › 모든 지식', 사람: '지식관리 › 사람' })

// ── 목표 메뉴(N4 ~ N6 뒤 · 데이터로만 둔다) ──
//   지식 메뉴(고른 지식에 딸림): 개인 생성 · 공유 · 문서 · 이력 / 팀 확인 · 생성 · 문서 · 이력
export const KN_PC = Object.freeze({ 생성: Object.freeze(['수기수집', '자동수집']), 공유: Object.freeze([]), 문서: Object.freeze(['구조']), 이력: Object.freeze([]) })
export const KN_TEAM = Object.freeze({ 확인: Object.freeze(['넣지 못함', '점검', '승인']), 생성: Object.freeze(['수기수집', '자동수집']), 문서: Object.freeze(['구조']), 이력: Object.freeze([]) })
// 생성 아래 「진행」(수기 · 자동이 같이 쓰는 목록) — 탭 도는 일 · 끝난 일
export const PROGRESS = Object.freeze(['진행', '도는 일', '끝난 일'])
//   공통 메뉴: 지식관리 · 설정
export const MANAGE_PC = Object.freeze(['모든 지식', '기초 세우기'])
export const MANAGE_TEAM = Object.freeze(['모든 지식', '기초 세우기', '사람'])
export const TARGET_SET_PC = Object.freeze(['지식백업', 'Claude 연결', '에이전트 설치', '팀 연결'])
export const TARGET_SET_TEAM = Object.freeze(['서버 정보', '에이전트 설치', '개인 프로그램 설치', '팀 일꾼', '운영'])

const starts = (names, rest) => names.some((n) => String(rest).startsWith(n))
const uniq = (...xs) => [...new Set(xs.flat())]
// 길 「<메뉴> › <나머지>」 가 지금 화면에 있는가 · 목표 메뉴에 있는가
const NOW = { 설정: MENU_NAMES, 생성: IMP_TABS, 확인: HELD_NOW, 지식관리: [], 문서: null }
const TARGET = {
  설정: uniq(TARGET_SET_PC, TARGET_SET_TEAM),
  생성: uniq(KN_PC.생성, PROGRESS),
  확인: KN_TEAM.확인,
  지식관리: uniq(MANAGE_PC, MANAGE_TEAM),
  문서: KN_PC.문서,
}
// 「문서 › …」 은 「문서 › 항목」 꼴(넣을 곳)로도 쓴다 — 목표 하위(구조)가 아니면 지금도 맞다
export const okNow = (menu, rest) => (NOW[menu] === null ? !starts(TARGET[menu], rest) : starts(NOW[menu] || [], rest))
export const okTarget = (menu, rest) => starts(TARGET[menu] || [], rest)
// 「설정 › 이름」 꼴의 길이 지금 있는 메뉴로 시작하는가(옛 이름 그대로)
export const okSetPath = (rest) => okNow('설정', rest)
