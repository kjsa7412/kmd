// 시험 도우미
import fs from 'node:fs'
import path from 'node:path'

// 폴더 복사 — fs.cpSync(recursive)는 Node 22 · Windows 의 한글 임시 경로(세정아~1)에서 넘어진다(segfault)
export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name)
    const b = path.join(to, e.name)
    if (e.isDirectory()) copyDir(a, b)
    else fs.copyFileSync(a, b)
  }
}

// 들어오기 — 사람 하나를 만들고(처음 들어오기 링크로 비밀번호를 정해) 쿠키 · 기기 열쇠를 받는다
export async function signIn(s, { id = 'kim', admin = true, password = null } = {}) {
  const { prehash } = await import('../app/prehash.js')
  const pw = password || `pw-${id}-1234567`
  const { code } = await s.auth.addUser({ id, admin })
  const r = await fetch(s.url + '/first', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, pw: prehash(id, pw) }) })
  if (!r.ok) throw new Error('들어오지 못했다 ' + r.status)
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const key = await s.auth.deviceKeyFor(id, { host: 'TEST' })
  return { id, pw, cookie, key }
}
