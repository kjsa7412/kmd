// GitLab 봇 열쇠로 지식마다 저장소를(v0.6 ⑫ · 지식관리 2) — 그룹 안에 이름의 저장소를 찾거나 만든다.
//
//   serve.json  "gitlab": { "api": "https://gitlab.team.local", "group": "kmd-backup", "secret": "gitlab" } — group 은 화면의 처음 값일 뿐
//   열쇠        `kmd serve secret set gitlab` 로만 받는다(화면 · 로그 · 상태 파일 · 응답에 0). 봇은 만들기 권한만 —
//               지우기 · 보호 해제 권한이 없는 열쇠를 쓴다(사람 설명서). 밀기는 서버의 git 자격(ssh 키)이 한다.
//   안 되면     열쇠를 저장하지 않고 지금처럼 — 총괄 관리자가 지식 상세 › 저장소에서 붙인다(멈춤 줄이 그대로 남는다).

import { KmdError } from './errors.js'

const slug = (s) => String(s).normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'kmd'
export const projectSlug = slug

// 부르기 하나 — 열쇠는 머리 private-token 에만(오류 글 · 돌려주는 값에 싣지 않는다) · 닿지 않으면 E_INPUT(why: 'net')
function caller({ api, token, timeoutMs }) {
  const base = String(api).replace(/\/+$/, '') + '/api/v4'
  return async (method, p, body) => {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const r = await fetch(base + p, { method, headers: { 'private-token': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal })
      const j = await r.json().catch(() => ({}))
      return { status: r.status, j }
    } catch (e) {
      throw new KmdError('E_INPUT', e?.name === 'AbortError' ? 'GitLab 이 답하지 않는다(시간 넘음)' : 'GitLab 에 닿지 않는다', { details: { why: 'net' } })
    } finally {
      clearTimeout(t)
    }
  }
}
const authFail = (status) => (status === 401 || status === 403 ? new KmdError('E_INPUT', 'GitLab 열쇠가 맞지 않는다', { details: { why: 'auth' } }) : null)

// 봇이 저장소를 만들 수 있는 그룹(개발자 자리 30 이상) — [{ path, name }]
export async function listGroups({ api, token, timeoutMs = 15_000 }) {
  if (!api || !token) throw new KmdError('E_INPUT', 'GitLab 설정이 모자란다')
  const call = caller({ api, token, timeoutMs })
  const out = []
  // 쪽마다 100 · 열 쪽까지(1000 그룹) — 다음 쪽이 없으면(받은 수 < 100) 멈춘다
  for (let page = 1; page <= 10; page++) {
    const r = await call('GET', `/groups?min_access_level=30&per_page=100&order_by=path&page=${page}`)
    const a = authFail(r.status)
    if (a) throw a
    if (r.status !== 200 || !Array.isArray(r.j)) throw new KmdError('E_INPUT', `GitLab 이 답하지 않는다: ${r.status}`, { details: { why: 'net' } })
    out.push(...r.j.filter((g) => g && typeof g.full_path === 'string' && g.full_path).map((g) => ({ path: String(g.full_path).slice(0, 200), name: String(g.name || g.full_path).slice(0, 200) })))
    if (r.j.length < 100) break
  }
  return out
}

// 그룹 안 이름의 저장소를 찾거나 만든다 — { url, created, path, empty }(empty: 찾은 저장소가 비었나 · GitLab 의 empty_repo)
export async function ensureProject({ api, group, token, name, timeoutMs = 15_000 }) {
  if (!api || !group || !token) throw new KmdError('E_INPUT', 'GitLab 설정이 모자란다')
  const call = caller({ api, token, timeoutMs })
  const path = slug(name)
  const got = await call('GET', `/projects/${encodeURIComponent(`${group}/${path}`)}`)
  if (got.status === 200) return { url: got.j.ssh_url_to_repo || got.j.http_url_to_repo, created: false, path, empty: got.j.empty_repo === true }
  const a = authFail(got.status)
  if (a) throw a
  if (got.status !== 404) throw new KmdError('E_INPUT', `GitLab 이 답하지 않는다: ${got.status}`)
  const g = await call('GET', `/groups/${encodeURIComponent(group)}`)
  if (g.status !== 200) throw new KmdError('E_INPUT', `GitLab 그룹 「${group}」 을 보지 못했다: ${g.status}`)
  const made = await call('POST', '/projects', { name: path, path, namespace_id: g.j.id, visibility: 'private', initialize_with_readme: false })
  if (made.status === 401 || made.status === 403) throw new KmdError('E_INPUT', `봇이 그룹 「${group}」 에 저장소를 만들 자격이 없다(그룹의 Maintainer 이상이 필요할 수 있다)`, { details: { why: 'auth' } })
  if (made.status !== 201) throw new KmdError('E_INPUT', `GitLab 저장소를 만들지 못했다: ${made.status}`)
  return { url: made.j.ssh_url_to_repo || made.j.http_url_to_repo, created: true, path, empty: true }
}
