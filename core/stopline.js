// 멈춤 한 줄 — 저절로 하는 일이 멈췄을 때 사람에게 하는 말의 틀 하나.
//
//   무엇이 · 얼마나 — 풀리는 길 / 누구에게 알렸다
//
// 화면 띠 · 첫 화면 · /api/stops · save 응답 warnings · 세션 brief · 서버 콘솔이 같은 줄을 받는다.
// 뒤 판(정리 일꾼의 쉼 · 가져오는 곳의 멈춤 …)은 줄 종류(kind)만 더한다. 잘 될 때는 줄이 없다.
//
// 화면은 목업의 stop 모양 그대로 받는다 — b(무엇이 · 얼마나) · t(풀리는 길) · r(언제부터 — 오른쪽 작은 글).

export function stopLine({ kind, kn = null, level = 'warn', what, amount = null, fix = null, told = null, since = null }) {
  if (!what) return null
  const b = amount ? `${what} · ${amount}` : what
  const t = [fix, told].filter(Boolean).join(' / ')
  return { kind, kn, level, b, t, r: since || null, text: t ? `${b} — ${t}` : b }
}

// 나이 — 1시간 아래는 분, 2일 아래는 시간, 그 위는 일
export function ageText(ms) {
  if (!(ms >= 0)) return null
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${Math.max(1, min)}분`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}시간`
  return `${Math.floor(h / 24)}일`
}

export function worst(lines) {
  const xs = (lines || []).filter(Boolean)
  return xs.find((l) => l.level === 'bad') || xs.find((l) => l.level === 'warn') || null
}
