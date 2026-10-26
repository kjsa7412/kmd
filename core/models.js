// 일마다 Claude 모델 — 기계적인 일은 가벼운 모델로, 판단이 필요한 일만 큰 모델로(`claude -p --model`).
//
//   convert  pdf · hwp 를 글로 옮기기(에이전트 · 원본 Read)        옮겨 적기 — haiku
//   read     넣은 파일의 기록 정리(무엇 · 핵심 · 정한 것 · 남은 것)  JSON 몇 줄 — haiku
//   touch    기록이 건드린 이름 고르기(후보 8 안에서)                고르기 — haiku
//   tidy     항목 글 초안 · 넣은 파일 초안(값 검사를 넘어야 한다)     다시 쓰기 — sonnet
//   commit   커밋 차이 분석                                          코드 읽기 — sonnet
//   agent    에이전트로 지식에 들이기(둘러보기 · 자리 · 이름)        판단 — sonnet
//
// 값은 별칭(haiku · sonnet · opus) 또는 「기본」('') — 기본이면 --model 을 넘기지 않는다(그 PC 의 Claude Code 기본 모델).
// 이 PC 는 설정(prefs.json 의 pc.models)으로 바꾼다 · 팀 정리 일꾼은 기본 배분.

export const ROLES = ['convert', 'read', 'touch', 'tidy', 'commit', 'agent']
export const DEFAULT_MODELS = { convert: 'haiku', read: 'haiku', touch: 'haiku', tidy: 'sonnet', commit: 'sonnet', agent: 'sonnet' }
export const CHOICES = ['haiku', 'sonnet', 'opus', '']

// 고른 값 · 기본 배분을 합친 그 일의 모델('' 이면 기본 모델)
export function modelOf(role, models = {}) {
  const v = models?.[role]
  return CHOICES.includes(v) ? v : DEFAULT_MODELS[role] ?? ''
}

// --model 인자 — 값이 없으면 넘기지 않는다
export const modelArgs = (model) => (model ? ['--model', String(model)] : [])
