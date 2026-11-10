// 원격 둘 — 지식의 git 이력을 붙인 원격에 보내고, 멈추면 조용히 넘어가지 않는다(메뉴개편 8-3 · 11절 5 · G1).
//
//   저장소(repo)        지식마다 git 주소 + 가지(처음 값 main) · 원격 `kmd-backup` · 상태 `<data>/backup/<지식>.json` · 총괄 관리자가 붙인다 ·
//                       behind · moved 면 저장을 닫는다(E_BEHIND)
//   지식백업(copy)      이 PC 의 사본 자리(serve.json backupRoot) 아래 `<지식>.git` · 원격 `kmd-copy` · 상태 `<data>/copy/<지식>.json` · 개인 프로그램만 ·
//                       저장소를 붙여도 꺼지지 않는다 · 저장을 닫지 않는다(사본일 뿐)
//   붙인 원격에만 민다   상태 파일 `{ url, branch, pushed, at, notice? }` 이 있는 지식만 — clone 으로 받아 온 origin 은 저장소가 아니다.
//   판정 여섯           ls-remote 로 본 원격의 실제 sha 를 HEAD · pushed 에 견준다 — ok · lag · gone · rewound · behind · moved
//   대상을 적어 민다    `push <원격> <sha>:refs/heads/<가지>` — 지워진 원격 가지도 다시 올린다
//   다시 보내기         1 · 5 · 15 · 60분, 그 뒤 시간마다 · 시작할 때 한 번 · 매일 한 번. 자격 실패는 되풀이하지 않는다
//   읽기만으로 닫기     (저장소만) behind · moved 면 그 지식의 save 가 E_BEHIND — 그 밖의 실패는 save 를 막지 않는다
//   나이 경보           안 보낸 가장 오래된 저장이 6시간이면 warn · 24시간이면 bad(멈춤 한 줄)
//   저장소에서 받기     앞으로만(ff) · 받은 머리를 검사해 새 오류가 나면 되돌린다
//
// 하지 않는 것 — merge · rebase · force push. 그 묶음이 누구 것인지 기계는 모른다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { tryGit, headSha, currentBranch, hasCommit, isAncestor, remoteUrl, maskUrl, oldestAfter, ensureRepo } from './git.js'
import { stopLine, ageText } from './stopline.js'
import { KmdError } from './errors.js'

export const REMOTE = 'kmd-backup'
export const COPY_REMOTE = 'kmd-copy'
const HOUR = 3600000
const DAY = 24 * HOUR
export const WARN_AGE = 6 * HOUR
export const BAD_AGE = 24 * HOUR
export const CLOSED = new Set(['behind', 'moved'])

let cfg = { delays: [1, 5, 15, 60].map((m) => m * 60000), dailyMs: DAY, lsTimeout: 10000, noticeMs: DAY }
export function configure(o = {}) {
  cfg = { ...cfg, ...o }
}

// ── 원격 보기 · 판정 ──
export const REASON = {
  'non-ff': '이 서버가 모르는 글이 있다',
  auth: '자격이 맞지 않는다',
  net: '닿지 않는다',
  protected: '받기를 막았다(보호된 가지)',
  locked: '같은 순간에 다른 보내기가 있었다',
  timeout: '답하지 않는다',
  unknown: '까닭을 모른다',
}
export function classify(err) {
  const s = String(err || '')
  if (/timeout/i.test(s)) return 'timeout'
  if (/Authentication failed|could not read Username|Permission denied|access denied|403|401|terminal prompts disabled/i.test(s)) return 'auth'
  if (/non-fast-forward|fetch first|\(rejected\)|failed to push some refs.*rejected/i.test(s)) return 'non-ff'
  if (/protected branch|pre-receive hook declined/i.test(s)) return 'protected'
  if (/cannot lock ref/i.test(s)) return 'locked'
  if (/Could not resolve|unable to access|Connection|timed out|does not appear to be a git repository|not found|No such file|Could not read from remote/i.test(s)) return 'net'
  return 'unknown'
}
// 원격 sha 와 HEAD · pushed 의 관계 → 상태 하나(순수 함수 — 시험이 직접 부른다)
//   ok 원격 = HEAD · gone 보낸 적이 있는데 원격 가지가 없다 · lag 원격이 HEAD 의 조상(보낼 것이 남음)
//   rewound 원격이 pushed 의 조상이면서 다르다(되감김) · behind 원격이 HEAD 의 자손 · moved 그 밖
export function judge({ head, remote, pushed = null, remoteInHead = false, headInRemote = false, remoteInPushed = false, pushedInRemote = false }) {
  if (!remote) return pushed ? 'gone' : 'lag' // 한 번도 안 보낸 빈 자리는 첫 보내기
  if (remote === head) return 'ok'
  if (remoteInHead) {
    if (!pushed || remote === pushed || pushedInRemote) return 'lag'
    if (remoteInPushed) return 'rewound'
    return 'lag'
  }
  if (headInRemote) return 'behind'
  return 'moved'
}

// 멈춤 한 줄 — 잘 될 때는 빈 목록
const hm = (ms) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 가지 이름 검사 — git check-ref-format 규칙(한 줄 · 100자 · 빈칸 · 제어 글자 · ~^:?*[\ 없음 · .. · @{ · // 없음 ·
//   - · / · . 로 시작하지 않음 · / · . · .lock 으로 끝나지 않음 · 조각마다 . 으로 시작하지 않음 · @ 하나만은 안 됨) → 깨끗한 이름 또는 E_INPUT
export function checkBranch(b, { dflt = 'main' } = {}) {
  if (b == null || b === '') return dflt
  const s = typeof b === 'string' ? b.trim() : ''
  const bad = !s || s.length > 100 || /[\u0000-\u0020\u007f~^:?*[\\]/.test(s) || s.includes('..') || s.includes('@{') || s.includes('//') || s === '@' ||
    /^[-/.]/.test(s) || /[/.]$/.test(s) || /\.lock$/i.test(s) || s.split('/').some((x) => !x || x.startsWith('.') || /\.lock$/i.test(x)) || s === 'HEAD'
  if (bad) throw new KmdError('E_INPUT', '가지 이름이 아니다(영문 · 숫자 · - _ / . · 100자 · 예: main · dev)')
  return s
}

// 원격 하나 — K: { kind(멈춤 줄 갈래 · 화면 STOP_T 의 열쇠 · lines 의 kind 로 바꿀 수 있다) · label(화면 말) · i · eul · gwa(조사 붙은 말) · remote(git 원격 이름) · dir(상태 폴더) · closes(behind · moved 면 저장을 닫나) }
function makeRemote(K) {
  const entries = new Map()
  function E(kn) {
    const k = path.resolve(kn.dir)
    let e = entries.get(k)
    if (!e) entries.set(k, (e = { dir: k, id: kn.id, file: null, state: null, verdict: null, last: null, running: null, again: false, waiters: [], retry: { n: 0, timer: null, next: null } }))
    return e
  }

  // ── 상태 파일 ──
  const stateFile = (dataDir, id) => path.join(dataDir, K.dir, `${encodeURIComponent(id)}.json`)
  async function readState(file) {
    try {
      const j = JSON.parse(await fs.readFile(file, 'utf8'))
      return j && typeof j === 'object' && j.branch ? j : null
    } catch {
      return null
    }
  }
  async function persist(e) {
    if (!e.file || !e.state) return
    await fs.mkdir(path.dirname(e.file), { recursive: true })
    await fs.writeFile(e.file + '.tmp', JSON.stringify(e.state, null, 1) + '\n')
    await fs.rename(e.file + '.tmp', e.file)
  }

  async function register(kn, { dataDir }) {
    const e = E(kn)
    e.id = kn.id
    if (e.state) return true
    e.file = stateFile(dataDir, kn.id)
    e.state = await readState(e.file)
    return !!e.state
  }
  const attached = (kn) => !!entries.get(path.resolve(kn.dir))?.state
  function stateOf(kn) {
    const e = entries.get(path.resolve(kn.dir))
    return e?.state ? { ...e.state, verdict: e.verdict?.state || null, last: e.last, next: e.retry.next } : null
  }

  // 원격을 붙인다(branch — 보낼 가지 · 처음 값 main) — 원격이 비었거나 HEAD 의 조상 · 같을 때만. 원격이 앞섰거나 갈라졌으면 먼저 맞추라고 멈춘다
  async function attach(kn, url, { dataDir, branch: want = null }) {
  // 가지(want)를 정하지 않으면 이미 붙어 있던 가지를 그대로(다시 붙이기가 master 를 main 으로 바꿔 갈라지지 않게) · 처음이면 main
    const e = E(kn)
    e.file = stateFile(dataDir, kn.id)
    const dir = e.dir
    // 지식 폴더에 .git 이 없으면 git 이 위로 올라가 바깥 저장소를 잡는다 — 먼저 이 폴더에 세운다
    await ensureRepo(dir)
    const branch = want != null && want !== '' ? checkBranch(want) : e.state?.branch || 'main'
    const head = await headSha(dir)
    if (!head) throw new KmdError('E_INPUT', '아직 저장된 것이 없다. 한 번 저장한 뒤 붙인다')
    const had = await remoteUrl(dir, K.remote)
    const set = await tryGit(dir, had ? ['remote', 'set-url', K.remote, url] : ['remote', 'add', K.remote, url])
    if (!set.ok) throw new KmdError('E_INPUT', `${K.label} 주소를 받지 못했다`)
    const ls = await lsRemote(dir, branch)
    if (!ls.ok) {
      if (!had) await tryGit(dir, ['remote', 'remove', K.remote])
      throw new KmdError('E_INPUT', `${K.label}에 닿지 않는다: ${REASON[ls.reason] || ls.reason}`)
    }
    if (ls.sha && ls.sha !== head) {
      if (!(await hasCommit(dir, ls.sha))) await tryGit(dir, ['fetch', '-q', K.remote, branch])
      const have = await hasCommit(dir, ls.sha)
      if (!have || !(await isAncestor(dir, ls.sha, head))) {
        const ahead = have && (await isAncestor(dir, head, ls.sha))
        if (!had) await tryGit(dir, ['remote', 'remove', K.remote])
        throw new KmdError('E_CONFLICT', ahead ? `${K.label} 쪽이 앞서 있다. 먼저 ${K.label}에서 받는다` : `${K.gwa} 갈라졌다. 사람이 맞춘 뒤 다시 붙인다`)
      }
    }
    e.state = { url: maskUrl(url), branch, pushed: ls.sha || null, at: new Date().toISOString() }
    e.verdict = null
    await persist(e)
    return enqueue(kn)
  }

  async function detach(kn) {
    const e = E(kn)
    clearTimeout(e.retry.timer)
    if (e.file) await fs.rm(e.file, { force: true }).catch((x) => console.log(`[kmd] ${K.label} 상태 파일을 지우지 못했다 ${e.id}: ${x.message}`))
    if (await fs.stat(path.join(e.dir, '.git')).then(() => true, () => false)) await tryGit(e.dir, ['remote', 'remove', K.remote])
    entries.delete(e.dir)
  }

  async function lsRemote(dir, branch) {
    const r = await tryGit(dir, ['ls-remote', '--heads', K.remote, `refs/heads/${branch}`], { timeout: cfg.lsTimeout })
    if (!r.ok) return { ok: false, reason: r.timedOut ? 'timeout' : classify(r.err), message: r.err.trim().split('\n').pop() }
    const line = r.out.split('\n').find((l) => l.endsWith(`refs/heads/${branch}`))
    return { ok: true, sha: line ? line.split(/\s+/)[0] : null }
  }

  async function inspect(e) {
    const { dir, state: s } = e
    const at = Date.now()
    const head = await headSha(dir)
    const ls = await lsRemote(dir, s.branch)
    if (!ls.ok) {
      const base = s.pushed && (await hasCommit(dir, s.pushed)) ? s.pushed : null
      const b = s.pushed === head ? { count: 0, oldest: null } : await oldestAfter(dir, base)
      const keep = e.verdict && CLOSED.has(e.verdict.state) ? e.verdict.state : null
      return (e.verdict = { state: keep || (b.count ? 'lag' : 'ok'), unreachable: true, reason: ls.reason, message: ls.message, at, head, ahead: b.count, oldest: b.oldest })
    }
    const remote = ls.sha
    if (remote && remote !== head && !(await hasCommit(dir, remote))) await tryGit(dir, ['fetch', '-q', K.remote, s.branch], { timeout: 60000 })
    const have = remote ? await hasCommit(dir, remote) : false
    const facts = {
      head,
      remote,
      pushed: s.pushed,
      remoteInHead: have && (await isAncestor(dir, remote, head)),
      headInRemote: have && (await isAncestor(dir, head, remote)),
      remoteInPushed: have && !!s.pushed && (await isAncestor(dir, remote, s.pushed)),
      pushedInRemote: have && !!s.pushed && (await isAncestor(dir, s.pushed, remote)),
    }
    const state = !remote || have ? judge(facts) : 'moved'
    const b = state === 'ok' ? { count: 0, oldest: null } : await oldestAfter(dir, remote && have && facts.remoteInHead ? remote : null)
    return (e.verdict = { state, at, head, remote, ahead: b.count, oldest: b.oldest })
  }

  // ── 보내기 줄 ──
  // 요청 하나 = 「지금 HEAD 까지 보내라」. 도는 중에 오면 끝난 뒤 한 번 더 민다
  function enqueue(kn, opt = {}) {
    const e = E(kn)
    if (!e.state) return Promise.resolve({ ok: false, state: 'off' })
    return new Promise((resolve) => {
      e.waiters.push(resolve)
      e.again = true
      if (!e.running) e.running = drain(e, opt)
    })
  }
  async function drain(e, opt) {
    try {
      while (e.again) {
        e.again = false
        const batch = e.waiters
        e.waiters = []
        let r
        try {
          r = await pushOnce(e, opt)
        } catch (err) {
          r = e.last = { ok: false, state: 'lag', reason: 'unknown', message: String(err?.message || err), at: Date.now() }
        }
        for (const w of batch) w(r)
      }
    } finally {
      e.running = null
    }
  }
  async function pushOnce(e, { log = null } = {}) {
    const s = e.state
    const done = (r) => {
      e.last = { at: Date.now(), ...r }
      schedule(e, r, log)
      return e.last
    }
    const v = await inspect(e)
    if (v.state === 'ok') return done({ ok: true, state: 'ok' })
    if (CLOSED.has(v.state)) {
      log?.(`${K.label} ${e.id}: ${v.state === 'behind' ? '이 서버가 모르는 글이 있다' : '다른 서버가 쓴다'}${K.closes ? ': 저장을 닫았다' : ''}`)
      return done({ ok: false, state: v.state })
    }
    if (v.unreachable) {
      log?.(`${K.label} ${e.id}: ${REASON[v.reason] || v.reason}`)
      return done({ ok: false, state: 'lag', reason: v.reason, message: v.message })
    }
    // lag · gone · rewound — 민다. gone · rewound 는 다시 올린 뒤에도 하루 빨강으로 남긴다
    const p = await tryGit(e.dir, ['push', '-q', K.remote, `${v.head}:refs/heads/${s.branch}`], { timeout: 120000 })
    if (v.state === 'gone' || v.state === 'rewound') {
      s.notice = { kind: v.state, at: new Date().toISOString(), repushed: p.ok }
      log?.(`${K.label} ${e.id}: ${v.state === 'gone' ? '지워져 있었다' : '옛것으로 되감겨 있었다'}: ${p.ok ? '다시 올렸다' : '다시 올리지 못했다'}`)
    }
    if (p.ok) {
      s.pushed = v.head
      s.pushedAt = new Date().toISOString()
      await persist(e).catch(() => {})
      e.verdict = { ...v, state: 'ok', ahead: 0, oldest: null, remote: v.head }
      return done({ ok: true, state: 'ok' })
    }
    if (s.notice) await persist(e).catch(() => {})
    const reason = p.timedOut ? 'timeout' : classify(p.err)
    log?.(`${K.label} ${e.id}: ${REASON[reason] || reason}`)
    if (reason === 'non-ff') {
      const v2 = await inspect(e)
      return done({ ok: false, state: v2.state === 'ok' ? 'moved' : v2.state, reason })
    }
    return done({ ok: false, state: 'lag', reason, message: p.err.trim().split('\n').pop() })
  }
  function schedule(e, r, log) {
    clearTimeout(e.retry.timer)
    e.retry.timer = null
    e.retry.next = null
    if (r.ok || r.state !== 'lag' || r.reason === 'auth') {
      if (r.ok) e.retry.n = 0
      return
    }
    const ms = cfg.delays[Math.min(e.retry.n, cfg.delays.length - 1)]
    e.retry.n++
    e.retry.next = Date.now() + ms
    e.retry.timer = setTimeout(() => {
      e.retry.timer = null
      enqueue({ id: e.id, dir: e.dir }, { log }).catch(() => {})
    }, ms)
    e.retry.timer.unref?.()
  }

  // save 가 묻는다 — 닫혔으면 까닭, 아니면 null
  function closed(kn) {
    const e = entries.get(path.resolve(kn.dir))
    const v = e?.verdict
    if (!K.closes || !e?.state || !v || !CLOSED.has(v.state)) return null
    return {
      state: v.state,
      message: v.state === 'behind' ? '이 지식은 지금 읽기만 된다. 저장소에 이 서버가 모르는 글이 있다. 총괄 관리자가 「저장소에서 받기」 를 한 뒤 다시 저장한다' : '이 지식은 지금 읽기만 된다. 저장소를 다른 서버가 이어 쓴다. 어느 쪽이 맞는지 총괄 관리자가 정한다',
    }
  }

  function lines(kn, { now = Date.now(), name = kn.id, kind = K.kind } = {}) {
    const e = entries.get(path.resolve(kn.dir))
    if (!e?.state) return []
    const out = []
    const v = e.verdict
    const L = (o) => out.push(stopLine({ kind, kn: kn.id, ...o }))
    if (v && CLOSED.has(v.state)) {
      L({ level: 'bad', what: v.state === 'behind' ? `${name}: ${K.label}에 이 서버가 모르는 글이 있다` : `${name}: ${K.eul} 다른 서버가 쓴다`, fix: K.closes ? '총괄 관리자가 맞추면 다시 저장된다' : '사본 자리를 다른 곳이 쓴다: 지식백업 경로를 바꾼다', told: K.closes ? '그동안 읽기만' : '저장은 그대로 된다' })
      return out
    }
    const n = e.state.notice
    if (n && now - Date.parse(n.at) < cfg.noticeMs) {
      L({ level: 'bad', what: `${name} ${K.i} ${n.kind === 'gone' ? '지워졌다' : '옛것으로 되감겼다'}`, fix: n.repushed ? '다시 올렸다 · 잃은 것 없음' : '다시 올리는 중', told: `누가 했는지는 ${K.label}에서`, since: hm(Date.parse(n.at)) })
    }
    if (e.last?.reason === 'auth') {
      L({ level: 'bad', what: `${name} ${K.label}에 들어가지 못한다`, fix: '자격을 다시 넣으면 이어서 보낸다', since: '저장은 그대로 된다' })
      return out
    }
    if (v && v.oldest && v.ahead > 0) {
      const age = now - v.oldest
      if (age >= WARN_AGE) L({ level: age >= BAD_AGE ? 'bad' : 'warn', what: `${name} ${K.label} 보내기가 멈췄다`, amount: ageText(age), fix: `${K.label}에 닿으면 이어서 보낸다`, since: `${hm(v.oldest)} 부터 · 저장은 그대로 된다` })
    }
    return out
  }

  // 원격에서 받기 — 원격이 앞섰을 때(behind)만 · 앞으로만 · 받은 뒤 검사가 새 오류를 내면 되돌린다
  async function pull(kn, { check = null } = {}) {
    const e = E(kn)
    if (!e.state) throw new KmdError('E_INPUT', `이 지식에는 ${K.i} 없다`)
    const v = await inspect(e)
    if (v.state === 'ok' || v.state === 'lag' || v.state === 'gone' || v.state === 'rewound') return { ok: true, pulled: 0, state: v.state }
    if (v.state === 'moved') throw new KmdError('E_CONFLICT', `${K.gwa} 갈라졌다. 앞으로만 받을 수 없다. 어느 쪽이 맞는지 사람이 정한다`)
    const before = v.head
    const errs0 = check ? await check(e.dir) : []
    const ff = await tryGit(e.dir, ['merge', '--ff-only', '-q', v.remote])
    if (!ff.ok) throw new KmdError('E_CONFLICT', '앞으로만 받지 못했다. 손으로 고친 파일이 있으면 먼저 치운다')
    if (check) {
      const errs1 = await check(e.dir)
      const fresh = errs1.filter((x) => !errs0.includes(x))
      if (fresh.length) {
        await tryGit(e.dir, ['reset', '--hard', '-q', before])
        throw new KmdError('E_CHECK', `받은 글에 새 오류가 있어 되돌렸다: ${fresh.slice(0, 3).join(' · ')}`)
      }
    }
    e.state.pushed = v.remote
    await persist(e)
    e.verdict = { ...v, state: 'ok', head: v.remote, ahead: 0, oldest: null }
    e.last = { at: Date.now(), ok: true, state: 'ok' }
    return { ok: true, pulled: (await oldestAfter(e.dir, before)).count, state: 'ok' }
  }

  // 갈라졌을 때 — 이어 쓰기가 지식에서 빼는 것(서버에만 있는 기록 · 고친 문서) · 서버 것으로 백업을 덮기(force-with-lease)
  async function lostIfAdopt(kn) {
    const e = E(kn)
    if (!e.state) return { records: [], docs: [] }
    const v = await inspect(e)
    if (!v.remote || !v.head) return { records: [], docs: [] }
    await tryGit(e.dir, ['fetch', '-q', K.remote, e.state.branch || 'main'])
    const r = await tryGit(e.dir, ['log', '--format=', '--name-status', `${v.remote}..${v.head}`])
    const added = [...new Set(r.out.split('\n').map((l) => l.split('\t')).filter((x) => x[0] === 'A' && /^work\/[^/]+\.md$/.test(x[1] || '')).map((x) => x[1]))]
    const docs = [...new Set(r.out.split('\n').map((l) => l.split('\t')).filter((x) => /^[AM]/.test(x[0] || '') && /^docs\/.+\.md$/.test(x[1] || '')).map((x) => x[1]))]
    const records = []
    for (const p of added) {
      const t = await fs.readFile(path.join(e.dir, ...p.split('/')), 'utf8').catch(() => '')
      const val = (k) => ((t.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '').replace(/^["']|["']$/g, '') || null
      records.push({ path: p, title: val('title') || p, author: val('author') })
    }
    return { records, docs }
  }
  async function keepServer(kn) {
    const e = E(kn)
    if (!e.state) throw new KmdError('E_INPUT', `이 지식에는 ${K.i} 없다`)
    const v = await inspect(e)
    if (v.unreachable) throw new KmdError('E_INPUT', `${K.label}에 닿지 않는다: ${REASON[v.reason] || v.reason}`)
    const branch = e.state.branch || 'main'
    const r = await tryGit(e.dir, ['push', '-q', `--force-with-lease=${branch}:${v.remote || ''}`, K.remote, `HEAD:${branch}`], { timeout: 120_000 })
    if (!r.ok) throw new KmdError('E_CONFLICT', `${K.eul} 덮지 못했다. 그사이 ${K.i} 또 바뀌었거나 보호된 가지다 · ${classify(r.err)}`)
    e.state.pushed = v.head
    await persist(e)
    e.verdict = { ...v, state: 'ok', remote: v.head, ahead: 0, oldest: null }
    e.last = { at: Date.now(), ok: true, state: 'ok' }
    return { ok: true, state: 'ok', replaced: v.remote }
  }

  // 이 백업 이어 쓰기 — 백업과 갈라졌을 때(moved · behind) 사람이 「백업 쪽이 맞다」 고 정하면, 지금 머리는 가지
  // `kmd-before-<시각>` 로 남겨 두고 백업의 머리로 옮긴다. 받은 머리를 검사해 새 오류면 되돌린다. 지우는 것은 없다.
  async function adopt(kn, { check = null } = {}) {
    const e = E(kn)
    if (!e.state) throw new KmdError('E_INPUT', `이 지식에는 ${K.i} 없다`)
    const v = await inspect(e)
    if (v.unreachable) throw new KmdError('E_INPUT', `${K.label}에 닿지 않는다: ${REASON[v.reason] || v.reason}`)
    if (!v.remote) throw new KmdError('E_INPUT', `${K.i} 비었다. 이어 쓸 것이 없다(다음 보내기가 다시 올린다)`)
    if (v.state === 'ok' || v.state === 'lag') return { ok: true, kept: null, state: v.state }
    const before = v.head
    const errs0 = check ? await check(e.dir) : []
    const kept = `kmd-before-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`
    if (before) await tryGit(e.dir, ['branch', '-f', kept, before])
    const r = await tryGit(e.dir, ['reset', '--hard', '-q', v.remote])
    if (!r.ok) throw new KmdError('E_CONFLICT', `${K.label}의 머리로 옮기지 못했다`)
    if (check) {
      const fresh = (await check(e.dir)).filter((x) => !errs0.includes(x))
      if (fresh.length) {
        if (before) await tryGit(e.dir, ['reset', '--hard', '-q', before])
        throw new KmdError('E_CHECK', `${K.label}의 글에 새 오류가 있어 그대로 두었다: ${fresh.slice(0, 3).join(' · ')}`)
      }
    }
    e.state.pushed = v.remote
    await persist(e)
    e.verdict = { ...v, state: 'ok', head: v.remote, ahead: 0, oldest: null }
    e.last = { at: Date.now(), ok: true, state: 'ok' }
    return { ok: true, kept: before ? kept : null, state: 'ok' }
  }


  // 서버 시작 — 붙은 지식을 올리고 한 번씩 판정 · 매일 한 번 더
  let daily = null
  async function start(kns, { dataDir, log = null }) {
    for (const kn of kns) if (await register(kn, { dataDir })) enqueue(kn, { log }).catch(() => {})
    clearInterval(daily)
    daily = setInterval(() => {
      for (const e of entries.values()) if (e.state) enqueue({ id: e.id, dir: e.dir }, { log }).catch(() => {})
    }, cfg.dailyMs)
    daily.unref?.()
  }
  function stop() {
    clearInterval(daily)
    daily = null
    for (const e of entries.values()) clearTimeout(e.retry.timer)
    entries.clear()
  }
  return { kind: K.kind, label: K.label, remote: K.remote, register, attached, stateOf, attach, detach, enqueue, closed, lines, pull, lostIfAdopt, keepServer, adopt, start, stop }
}

// 저장소 — 지식마다 git 주소 + 가지 · 총괄 관리자가 붙인다 · 옛 API 그대로(backup.attach · enqueue · …)
export const repo = makeRemote({ kind: 'backup', label: '저장소', i: '저장소가', eul: '저장소를', gwa: '저장소와', remote: REMOTE, dir: 'backup', closes: true })
// 지식백업 — 이 PC 의 사본 자리(개인 프로그램만) · 저장소와 따로 돈다
export const copy = makeRemote({ kind: 'backup', label: '지식백업', i: '지식백업이', eul: '지식백업을', gwa: '지식백업과', remote: COPY_REMOTE, dir: 'copy', closes: false })
export const { register, attached, stateOf, attach, detach, enqueue, closed, lines, pull, lostIfAdopt, keepServer, adopt } = repo
export async function start(kns, opt) {
  await repo.start(kns, opt)
  await copy.start(kns, opt)
}
export function stop() {
  repo.stop()
  copy.stop()
}
