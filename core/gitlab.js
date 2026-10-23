// GitLab 봇 열쇠로 지식마다 백업 자리를 저절로(v0.6 ⑫) — 그룹 안에 지식 이름의 저장소를 찾거나 만든다.
//
//   serve.json  "gitlab": { "api": "https://gitlab.team.local", "group": "kmd-backup", "secret": "gitlab" }
//   열쇠        `kmd serve secret set gitlab` 로만 받는다(화면 · 로그 · 상태 파일에 0). 봇은 만들기 권한만 —
//               지우기 · 보호 해제 권한이 없는 열쇠를 쓴다(사람 설명서). 밀기는 서버의 git 자격(ssh 키)이 한다.
//   안 되면     열쇠를 저장하지 않고 지금처럼 — 관리자가 [백업 자리 붙이기](멈춤 줄 「백업 자리가 없다」 가 그대로 남는다).

import { KmdError } from './errors.js'

const slug = (s) => String(s).normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'kmd'

export async function ensureProject({ api, group, token, name, timeoutMs = 15_000 }) {
  if (!api || !group || !token) throw new KmdError('E_INPUT', 'GitLab 설정이 모자란다')
  const base = String(api).replace(/\/+$/, '') + '/api/v4'
  const call = async (method, p, body) => {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const r = await fetch(base + p, { method, headers: { 'private-token': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal })
      const j = await r.json().catch(() => ({}))
      return { status: r.status, j }
    } finally {
      clearTimeout(t)
    }
  }
  const path = slug(name)
  const got = await call('GET', `/projects/${encodeURIComponent(`${group}/${path}`)}`)
  if (got.status === 200) return { url: got.j.ssh_url_to_repo || got.j.http_url_to_repo, created: false, path }
  if (got.status !== 404) throw new KmdError('E_INPUT', `GitLab 이 답하지 않는다 — ${got.status}`)
  const g = await call('GET', `/groups/${encodeURIComponent(group)}`)
  if (g.status !== 200) throw new KmdError('E_INPUT', `GitLab 그룹 「${group}」 을 보지 못했다 — ${g.status}`)
  const made = await call('POST', '/projects', { name: path, path, namespace_id: g.j.id, visibility: 'private', initialize_with_readme: false })
  if (made.status !== 201) throw new KmdError('E_INPUT', `GitLab 저장소를 만들지 못했다 — ${made.status}`)
  return { url: made.j.ssh_url_to_repo || made.j.http_url_to_repo, created: true, path }
}
