// 오류 — 코드 하나와 사람이 읽는 한 줄.
//
// 코드는 기계가 가른다(E_INPUT · E_NOTFOUND · E_CONFLICT · E_GIT). 글은 화면과
// 세션에 그대로 보이므로 쉬운 말로 쓴다.

export class KmdError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.code = code
    Object.assign(this, extra)
  }
}

export const fail = (code, message, extra) => {
  throw new KmdError(code, message, extra)
}

export function httpStatusOf(code) {
  return { E_INPUT: 400, E_AUTH: 401, E_FORBIDDEN: 403, E_SUDO: 403, E_NOTFOUND: 404, E_CONFLICT: 409, E_BEHIND: 409, E_CHECK: 422, E_LOCKED: 429 }[code] || 500
}
