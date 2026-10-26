// 예약 — 사람이 쓸 수 없는 이름 · 태그.
//
// kmd 가 저절로 쓰는 기록은 작성자 · 태그로 가른다(되돌리기 · 오늘 바뀐 것 · 정리 검사가 본다).
// 사람 · 세션이 같은 이름 · 태그를 쓰면 기계가 쓴 것으로 보이므로 막는다.

export const RESERVED_USERS = ['kmd', 'kmd-auto', 'kmd-worker']
// watched — 문서 폴더 감시가 들인 파일의 기록(원본이 주인인 문서의 앞 기록)
export const RESERVED_TAGS = ['edit', 'curate-auto', 'curate-llm', 'alias-auto', 'sources', 'touches-fix', 'code-change', 'watched']

export const isReservedUser = (u) => RESERVED_USERS.includes(String(u || '').trim().toLowerCase())
export const isReservedTag = (t) => RESERVED_TAGS.includes(String(t || '').trim().toLowerCase())

// 이력 — kmd 가 지식을 다룬 일(가져옴 · 가져오는 곳 바꿈 · 화면 · 편집기에서 바로 고침 · 정리)은 기록이 아니다.
// 기록(`work/`)은 그 자체로 지식이 될 글만 · 이런 일은 이력(`log/`)에 · 화면은 「이력」 한 곳에서 본다
export const LOG_TAGS = ['edit', 'curate-auto', 'curate-llm', 'alias-auto', 'sources']
export const LOG_DIR = 'log'
export const isLogRecord = (tags) => (tags || []).some((t) => LOG_TAGS.includes(t))
