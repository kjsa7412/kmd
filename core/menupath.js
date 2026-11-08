// 메뉴 길 말(UX T5-07) — 사람에게 「어디서 하라」 고 쓸 때 쓰는 설정 메뉴 이름의 한 곳.
//   화면의 메뉴(app/main.js setMenu · workMenu)와 같아야 한다. test/menupath.test.mjs 가
//   ① 화면 메뉴 이름이 여기와 같은지 ② 서버 · core · 스킬 · 설명서 글의 「설정 › …」 길이 여기 있는 이름으로 시작하는지 본다.
//   메뉴 이름을 바꾸면 여기와 화면 · 글을 같은 커밋에서 고친다.
export const SET_TEAM = Object.freeze(['점검', '팀 서버', '팀 지식', '사람 · 묶음', '에이전트 설치', '나'])
export const SET_PC = Object.freeze(['이 PC', 'Claude 연결', '에이전트 설치'])
// 옆 메뉴 「지식 관리」 작업(설정 밖)
export const WORK = Object.freeze(['이력', '가져오기', '넣지 못함', '문서 짜임', '지식 보내기'])
export const MENU_NAMES = Object.freeze([...new Set([...SET_TEAM, ...SET_PC])])
// 「설정 › 이름」 꼴의 길이 있는 메뉴로 시작하는가
export const okSetPath = (rest) => MENU_NAMES.some((n) => String(rest).startsWith(n))
