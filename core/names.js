// 예약 — 사람이 쓸 수 없는 이름 · 태그.
//
// kmd 가 저절로 쓰는 기록은 작성자 · 태그로 가른다(되돌리기 · 오늘 바뀐 것 · 정리 검사가 본다).
// 사람 · 세션이 같은 이름 · 태그를 쓰면 기계가 쓴 것으로 보이므로 막는다.

export const RESERVED_USERS = ['kmd', 'kmd-auto', 'kmd-worker']
export const RESERVED_TAGS = ['edit', 'curate-auto', 'curate-llm', 'alias-auto', 'sources', 'touches-fix']

export const isReservedUser = (u) => RESERVED_USERS.includes(String(u || '').trim().toLowerCase())
export const isReservedTag = (t) => RESERVED_TAGS.includes(String(t || '').trim().toLowerCase())
