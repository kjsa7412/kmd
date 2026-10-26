// kmd 의 가운데 — 지식 읽기 · 저장 · 백업 · 멈춤 줄 · 누가 무엇을 보나. 화면(HTTP)과 세션(MCP)이 같은 길을 쓴다.
//
// 모든 길은 ctx { user, admin, machine? } 를 받는다. 볼 수 없는 지식은 목록 · 찾기 · 읽기 · 저장에서 같은 판정
// 한 곳(`owners.visible`)으로 가린다. 저장은 여기 한 곳으로만 간다 — 읽기만으로 닫힌 지식을 막고, 그 지식의
// 캐시만 새로 읽게 하고(바뀐 파일만 — F12), 백업 줄에 넣고, 멈춤 줄을 warnings 로 돌려준다.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { listKnowledge, loadKnowledge, coordsOfSection, sectionOf, looksLikeKnowledge } from '../core/knowledge.js'
import { KmdError, httpStatusOf } from '../core/errors.js'
import { save as coreSave, serial, localStamp, recordTakenSync } from '../core/save.js'
import { decide, decisionRecord, revertPlan } from '../core/curate.js'
import * as collect from '../core/collect.js'
import crypto from 'node:crypto'
import net from 'node:net'
import { material, check as checkDraft, planSave, promptOf as tidyPrompt, INGEST_SCHEMA, DRAFT_SCHEMA, TOUCH_SCHEMA, ingestCandidates, ingestRule } from '../core/tidy.js'
import { runClaude } from '../core/claude.js'
import * as feed from '../core/feed.js'
import { checkTarget, readSource, probe, readDecl, writeDecl, stripCreds, secretName, secretPrefix, docPrefix, runSource, planRun, readState as readSourceState, writeState as writeSourceState, sourceLines, everyMs, probeGit } from '../core/sources.js'
import { forgetFile } from '../core/watch.js'
import { check } from '../core/check.js'
import { commitPaths, ensureRepo, tryGit, maskUrl } from '../core/git.js'
import { stopLine, ageText } from '../core/stopline.js'
import * as backup from '../core/backup.js'
import * as owners from '../core/owners.js'
import { buildIndex, ladder, loadLearned, learn, searchCheck, exact } from '../core/search.js'
import { planImport, summary, MAX_FILES, MAX_BYTES, PCONLY } from '../core/importer.js'
import { runAgent, agentAvailable } from '../core/agent.js'
import { modelOf, ROLES, CHOICES } from '../core/models.js'
import { expandSections } from '../core/excerpt.js'
import { FILE_SCHEMA, filePrompt, fileRecord, COMMIT_SCHEMA, commitPrompt, commitAnalyzed } from '../core/analyze.js'
import { renderRecord } from '../core/frontmatter.js'
import { stampAll } from '../core/sections.js'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, statSync, watch as fsWatch } from 'node:fs'
import * as sendLib from '../core/send.js'
import * as keystore from '../core/keystore.js'
import { sha16 } from '../core/text.js'
import { isSystemRecord, labelOf } from '../core/knowledge.js'
import { RESERVED_TAGS } from '../core/names.js'
import { isoOfStamp, logKind, atTag } from './views.js'
import { restore as restoreFrom, checkUrl } from '../core/restore.js'
import { watchedOf } from '../core/watchmark.js'
import { applyDocs, wantDoc, watchedCount } from '../core/docwatch.js'
import { connect as dbConnect, catalog as dbCatalog } from '../core/db.js'
import { ensureProject } from '../core/gitlab.js'
import { getSecret, setSecret, listSecrets, delSecret } from '../core/secrets.js'

// serve.json — 살림 자리의 설정(없어도 된다)
async function loadConfig(dataDir) {
  const t = await fs.readFile(path.join(dataDir, 'serve.json'), 'utf8').catch(() => null)
  if (t == null) return {}
  try {
    return JSON.parse(t)
  } catch (e) {
    throw new Error(`serve.json 이 깨졌다 — ${e.message}`)
  }
}

// 백업 주소가 이 PC 의 폴더인가(scp 모양 user@host:path · 스킴 주소는 아니다)
const isLocalPath = (u) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^[^/\\]+@[^/\\]+:/.test(u) && !/^ext::/i.test(u)

export async function makeHub({ root, dataDir, mode = 'team', pcUser = null, log = (...a) => console.log('[kmd]', ...a) }) {
  const config = await loadConfig(dataDir)
  // 주인 장부 — 읽을 때마다 R()(셸이 바꿨으면 mtime 을 보고 다시 읽는다) · 고칠 때는 mutateReg 하나로(한 줄로 서서
  // 디스크의 것을 다시 읽고 → 고치고 → 쓴다 · 둘이 겹쳐 앞사람의 「나만」 줄을 덮어 지우지 않게)
  let reg = await owners.load(dataDir)
  let regAt = owners.mtimeOf(dataDir)
  const R = () => {
    const m = owners.mtimeOf(dataDir)
    if (m !== regAt) {
      try {
        reg = owners.loadSync(dataDir)
        regAt = m
        list = null // 셸이 되살렸거나 고친 지식 — 목록도 다시 읽는다
      } catch (e) {
        log('owners.json 을 다시 읽지 못했다 — 앞의 것을 쓴다', e.message)
      }
    }
    return reg
  }
  // 고치기 — 이 프로세스 안은 큐로, 셸 · 다른 kmd 와는 파일 잠금으로 한 줄. 잠금 안에서 디스크의 것을 다시 읽고(읽지 못하면
  // 옛 것으로 덮지 않고 넘어진다) 고쳐 쓴다. fn 은 장부만 고친다(git 은 밖에서 — 잠금을 짧게)
  let regQ = Promise.resolve()
  let knownQ = Promise.resolve()
  let reqQ = Promise.resolve()
  const inReq = (fn) => { const p = reqQ.then(fn); reqQ = p.catch(() => {}); return p }
  const mutateReg = (fn) => {
    const p = regQ.then(() => owners.withLock(dataDir, async () => {
      const cur = owners.loadSync(dataDir)
      const before = JSON.stringify(cur)
      const next = structuredClone(cur)
      const out = await fn(next)
      if (JSON.stringify(next) !== before) await owners.store(dataDir, next)
      reg = next
      regAt = NaN // 다음 R() 가 디스크를 한 번 더 본다(쓰고 mtime 을 재는 사이 다른 프로세스가 쓴 것을 놓치지 않게)
      return out
    }))
    regQ = p.catch(() => {})
    return p
  }
  // 장부에 줄이 없는 지식 — 지식 안의 `_members.md` 가 「개인: 예」 면 그것으로 가린다(팀 서버만). 되살리는 중 · 동기화 전 ·
  // 켤 때 맞추기 전처럼 줄이 아직 없는 틈에도 개인 지식이 팀에 열리지 않게 · mtime 으로 다시 읽는다
  const membersRows = new Map()
  const membersRow = (id) => {
    if (mode !== 'team') return null
    const dir = list?.find((k) => k.id === id)?.dir || path.join(root, id)
    const f = path.join(dir, '_members.md')
    let m
    try { m = statSync(f).mtimeMs } catch { membersRows.delete(id); return null }
    const c = membersRows.get(id)
    if (c && c.m === m) return c.row
    let row = null
    try {
      const p = owners.parseMembers(readFileSync(f, 'utf8'))
      if (p.private) row = { owner: p.owner, private: true, curators: p.curators }
    } catch {}
    membersRows.set(id, { m, row })
    return row
  }
  const rowFor = (id) => owners.rowOf(R(), id) || membersRow(id)
  const visibleTo = (id, ctx) => owners.visible({ knowledge: { [id]: rowFor(id) || undefined } }, id, ctx)
  // 저절로 하는 일 켬 · 끔(설정) — PC 는 하나 · 팀은 사람마다. 없으면 켬
  let prefs = await fs.readFile(path.join(dataDir, 'prefs.json'), 'utf8').then(JSON.parse, () => ({}))
  const cache = new Map() // 지식 → 읽은 지식(promise)
  const files = new Map() // 지식 → 파일 캐시
  const indexes = new Map() // 지식 → { k, p: 색인 promise }
  let list = null
  const decideTimers = new Map()
  const jobs = new Map() // 정리 일감
  let tidyTimer = null
  let sourceTimer = null
  const lastTidy = new Map()
  const drafts = new Map() // 초안 전용 단기 열쇠(sha → { job, kn, exp })
  const curateRuns = new Map() // 이 PC · 팀 서버의 개인 지식 — 지식마다 바로 넣기 한 줄
  const editDup = new Map() // 화면 고치기 — 같은 글 두 번 누름(1분)
  const runs = new Map() // 에이전트 일 — 터미널 줄(요구 v0.2 R8)
  const agentKeys = new Map() // kmda_ 단기 열쇠 → { kn, rec, run, exp }
  const importing = new Set() // 파일을 넣는 중인 지식 — 정리 줄이 막 남은 기록을 따로 집지 않게
  const queuedRecs = new Set() // 일(run)이 맡은 기록
  // 넣은 파일의 앞일(글로 바꾸기 · 기록 정리) — 파일끼리 따로라 몇 개씩 함께(Claude 를 기다리는 동안 다음 파일도) · 들이기는 문서를 고치므로 지식마다 한 줄
  const PREP_MAX = config.prepMax ?? 3
  let prepN = 0
  const prepWait = []
  const preps = new Map() // 지식 → 앞일이 도는 파일들(curateIdle 이 기다린다)
  const prepSlot = async (f) => {
    while (prepN >= PREP_MAX) await new Promise((ok) => prepWait.push(ok))
    prepN++
    try {
      return await f()
    } finally {
      prepN--
      prepWait.shift()?.()
    }
  }
  const codeTried = new Map() // 에이전트가 맡았던 코드 바뀜 기록 → 시각 — 정리가 세 차례 돌아도 다시 띄우지 않고, 못 넣었으면 한 시간 뒤 정리 때 다시
  const codeFresh = (id) => Date.now() - (codeTried.get(id) || 0) < 3600_000
  const liveTimers = new Map() // 팀 지식 「실시간」 정리 — 조용해진 뒤 한 번
  const privTimers = new Map() // 개인 지식 일감 — 주인의 PC 일꾼이 오래 받지 않으면 규칙으로
  const seenFile = path.join(dataDir, 'worker-seen.json') // 사람마다 PC 일꾼이 마지막으로 일감을 물은 때
  let seen = null
  const seenOf = async () => (seen ??= await fs.readFile(seenFile, 'utf8').then(JSON.parse, () => ({})))
  // 일감 — 맡은 일감은 임대(기본 40분 · 일꾼이 부를 때마다 늘린다). 지나면 다시 기다림으로(세 번째면 failed · 까닭) ·
  // 파일(<data>/jobs.json)에 두어 다시 켜도 기다리던 정리가 사라지지 않는다(맡았던 것은 기다림으로)
  const JOB_LEASE = config.jobLeaseMs ?? 40 * 60_000
  const jobsFile = path.join(dataDir, 'jobs.json')
  let jobsW = Promise.resolve()
  const saveJobs = () => {
    const keep = [...jobs.values()].filter((j) => j.state === 'queued' || j.state === 'running' || Date.now() - Date.parse(j.done || j.at) < 24 * 3600_000).slice(-200)
    jobsW = jobsW.then(() => fs.mkdir(dataDir, { recursive: true })).then(() => fs.writeFile(jobsFile + '.tmp', JSON.stringify(keep))).then(() => fs.rename(jobsFile + '.tmp', jobsFile)).catch(() => {})
    return jobsW
  }
  const sweepJobs = () => {
    let changed = false
    for (const j of jobs.values()) {
      if (j.state !== 'running' || !(j.leaseUntil < Date.now())) continue
      j.tries = (j.tries || 0) + 1
      changed = true
      if (j.tries >= 3) Object.assign(j, { state: 'failed', why: '정리 일꾼이 세 번 끝내지 못했다 — 일꾼 기록을 본다', done: new Date().toISOString() })
      else Object.assign(j, { state: 'queued', worker: null, why: '정리 일꾼이 끝내지 못해 다시 기다린다' })
    }
    if (changed) saveJobs()
  }
  // 정리 일꾼(팀) — 쉬는 중(로그인 끝 · 한도)이면 규칙으로 · 마지막으로 물은 때
  let wsNow = null
  let teamSeenAt = 0
  const workerRests = () => wsNow?.ok === false
  const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
  const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  async function groupFor(k, id, g) {
    if (!g) return null
    const all = material(k)
    if (g.kind === 'touches') {
      const x = all.find((y) => y.kind === 'touches' && y.record.id === g.record?.id)
      if (!x) return null
      const r = await ladder(k, await hub.index(id), { q: `${x.record.title} ${x.record.body}`.slice(0, 300), learned: await loadLearned(dataDir, id), max: 8 })
      x.candidates = [...r.exact, ...r.coords].filter((c) => c.coord).slice(0, 8).map((c) => ({ coord: c.coord, name: c.name }))
      return x
    }
    if (g.kind === 'ingest') return all.find((y) => y.kind === 'ingest' && y.record.id === g.record?.id) || null
    return all.find((y) => y.kind === 'section' && y.coord === g.coord) || null
  }
  // 되돌림 — 그 문서에서 7일 안에 되돌린 수
  async function recentReverts(id, doc) {
    const k = await hub.get(id)
    const cut = Date.now() - 7 * 864e5
    return k.logs.filter((w) => w.reopens.length && w.title.startsWith('되돌림') && w.body.includes(doc.replace(/^docs\/|\.md$/g, '')) && (stampMs(w.date) || 0) >= cut).length
  }
  async function saveRun(id, run) {
    const f = path.join(dataDir, 'tidy', `${encodeURIComponent(id)}.json`)
    const all = await fs.readFile(f, 'utf8').then(JSON.parse, () => [])
    all.unshift(run)
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, JSON.stringify(all.slice(0, 30)))
  }
  // 보내기 한 곳 — 같은 kmd 면 받기 길 그대로 · 다른 kmd 면 그 주소의 기기 열쇠로
  // 보내지 못한 것 한 줄 — 닿지 않음(연결 · 시간 넘김 · 5xx)은 wait(저절로 다시) · 받는 쪽이 거절(4xx · 같은 kmd 의 오류)은 fail(사람이)
  function waitOf(to, payload, e) {
    const status = e.status || (e.code ? httpStatusOf(e.code) : null)
    const retry = e.reach === false || (status != null && status >= 500 && e.reach !== true) || (!status && !e.code)
    return { id: crypto.randomBytes(5).toString('hex'), state: retry ? 'wait' : 'fail', to, payload, at: new Date().toISOString(), why: String(e.message || '').slice(0, 160), ...(retry ? {} : { status, fix: sendLib.fixOf({ status }) }) }
  }
  async function deliver(ctx, d, payload) {
    if (!d.url) return hub.receive(ctx, d.kn, payload)
    const key = process.env.KMD_SEND_KEY || (await keystore.get(keystore.keyName(d.url)).catch(() => null))
    return sendLib.post(d.url, d.kn, payload, key)
  }
  let sendTimer = null
  const srcRuns = new Map() // 가져오는 곳마다 도는 중인 것(한 줄로 세운다)
  const srcBusy = new Map() // 그중 지금 실제로 도는 것 — 「지금 하는 일」 팝업
  const curating = new Map() // 바로 넣기(정리)가 도는 지식 → 시작 시각
  const adding = new Set() // 막 더하는 중인 곳 — 시계 · 켤 때 확인이 끼어들지 않게
  const resyncs = new Map() // 전체 다시 맞추기 일감 — 진행률
  const srcWatch = new Map() // 코드 폴더 실시간 감시
  let started = false
  const watchers = []
  const scheduleDecide = (id) => {
    clearTimeout(decideTimers.get(id))
    const t = setTimeout(() => hub.decide(id).catch((e) => log('결정 규칙', id, e.message)), config.decideMs ?? 60_000)
    t.unref?.()
    decideTimers.set(id, t)
  }

  const hub = {
    root,
    dataDir,
    mode,
    config,
    log,
    // 루트 아래 지식 + 이 PC 에서 이은 폴더(`<data>/links.json` — 그 자리에서 따라간다)
    async list() {
      if (!list) {
        const own = await listKnowledge(root)
        const links = await fs.readFile(path.join(dataDir, 'links.json'), 'utf8').then(JSON.parse, () => [])
        const more = []
        for (const l of links) if (!own.some((k) => k.id === l.id) && (await looksLikeKnowledge(l.dir))) more.push({ id: l.id, name: (await listKnowledge(l.dir))[0]?.name || l.id, dir: l.dir })
        list = [...own, ...more]
      }
      return list
    },
    // 지식 추가 — 새 이름(PC: 지식 폴더 안 · 팀: 서버 안 내 지식 · 나만) · 내 폴더(PC 만 · 지식 폴더 안의 새 지식으로 들여온다 · 원본은 그대로)
    async addKnowledge(ctx, { kind, name, dir, empty = false, team = false }) {
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다 — 여러 지식을 두려면 위 폴더에서 띄운다')
      if (kind === 'new') {
        const nm = String(name || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim()
        if (!nm || nm.length > 60 || nm.startsWith('.')) throw new KmdError('E_INPUT', '이름은 한 줄 60자 안')
        const all = await hub.list()
        let id = nm
        // 팀 서버 — 관리자가 고르면 팀 지식(이름 그대로 · 주인은 만든 관리자 · 팀 모두 본다), 아니면 내 지식(이름-아이디 · 나만)
        const teamKn = mode === 'team' && !!team
        // 팀 서버에 지식을 세우는 것은 관리자만(팀 지식 · 팀 서버 안 내 지식) — 사람의 내 지식은 내 PC 프로그램의 지식 폴더에(새 지식 › 내 PC)
        if (mode === 'team' && !ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '팀 서버에 지식을 세우는 것은 관리자가 한다 — 내 지식은 내 PC 에(새 지식 › 내 PC · 내 PC 프로그램이 있어야 한다)')
        if (mode === 'team') id = (teamKn ? nm : `${nm}-${ctx.user}`).replace(/[<>:"/\\|?*\s]+/g, '-')
        if (all.some((k) => k.id.toLowerCase() === id.toLowerCase())) throw new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`)
        const d = path.join(root, id)
        // 폴더를 먼저 차지한다(같은 이름 두 번 누름 — 둘째는 여기서 E_CONFLICT · 첫째의 줄을 건드리지 않는다).
        // 팀 서버의 내 지식은 곧바로 `_members.md`(개인: 예)를 두어 목록에 보이는 순간 이미 가려져 있게 한 뒤 장부 줄을 세운다
        await fs.mkdir(root, { recursive: true })
        await fs.mkdir(d).catch((e) => { throw e.code === 'EEXIST' ? new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`) : e })
        let row = null
        try {
          if (mode === 'team') {
            row = { owner: ctx.user, private: !teamKn, curators: [] }
            await fs.writeFile(path.join(d, '_members.md'), owners.renderMembers(row), 'utf8')
            row = await mutateReg((next) => {
              if (next.knowledge[id]) throw new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`)
              return owners.setOwner(next, id, { owner: ctx.user, private: !teamKn })
            })
          }
          await ensureRepo(d) // 빈 폴더에서 먼저 — 만든 묶음이 만든 사람 이름으로 남게
          await fs.mkdir(path.join(d, 'docs'), { recursive: true })
          await fs.mkdir(path.join(d, 'work'), { recursive: true })
          await fs.writeFile(path.join(d, 'README.md'), `# ${nm}\n`, 'utf8')
          if (!empty) await fs.writeFile(path.join(d, 'docs', '처음.md'), `# 처음\n\n## 개요\n새 지식 — 첫 문서를 쓴다.\n`, 'utf8')
          await commitPaths(d, [...(empty ? ['README.md'] : ['README.md', 'docs/처음.md']), ...(mode === 'team' ? ['_members.md'] : [])], `지식 만듦 — ${nm}`, ctx.user)
        } catch (e) {
          // 내가 차지한 폴더를 지운 뒤에만 줄을 지운다(폴더가 남으면 「나만」 줄도 남긴다)
          const gone = await fs.rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).then(() => true, () => false)
          if (gone && row) await mutateReg((next) => { delete next.knowledge[id] }).catch(() => {})
          throw e
        }
        list = null
        // 아는 지식에 더하기 — 한 줄로(여럿이 같은 때 만들어도 앞사람의 것을 잃어 다음 동기화가 「새로 놓인 지식」 으로 보지 않게)
        await (knownQ = knownQ.then(async () => hub.known([...new Set([...(await hub.known()), id])])).catch(() => {}))
        if (mode === 'pc' && started) watchers.push(Object.assign(collect.watch(d, () => hub.collect(id)), { dir: d })) // 편집기에서 고친 것 거두기 — 켤 때 없던 지식도
        await hub.gitlabAttach(id).catch((e) => log('GitLab 백업 자리', id, e.message))
        await hub.autoBackup(id).catch((e) => log('백업 자리', id, e.message))
        feed.add(dataDir, ctx.user, { kind: 'kn', kn: id, dot: 'acc', text: `지식을 추가했다 — ${nm}`, small: mode === 'team' ? (teamKn ? `팀 지식 · 팀 모두 본다 · 주인 ${ctx.user}` : '팀 서버 안 내 지식 · 나만') : d }).catch(() => {})
        return { id, name: nm, dir: mode === 'pc' ? d : undefined }
      }
      // 지식 폴더 밖의 폴더 — 그 자리에서 따라가지 않는다(남의 폴더에 쓰지 않게 · 지식은 지식 폴더 안에만).
      // 지식 폴더 안에 같은 이름의 새 지식을 세우고 그 폴더의 파일을 한 번 들여온다(파일 넣기와 같은 길 · 원본은 그대로)
      if (kind === 'folder') {
        if (mode !== 'pc' && !ctx.pc) throw new KmdError('E_FORBIDDEN', '경로는 내 PC 프로그램이 연다')
        const full = path.resolve(String(dir || ''))
        if (!path.isAbsolute(String(dir || '')) || !(await fs.stat(full).then((s) => s.isDirectory(), () => false))) throw new KmdError('E_NOTFOUND', '그 폴더가 없다')
        const inside = (a, b) => { const r = path.relative(b.toLowerCase(), a.toLowerCase()); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)) }
        if (path.parse(full).root.toLowerCase() === full.toLowerCase() || full.toLowerCase() === os.homedir().toLowerCase()) throw new KmdError('E_INPUT', '드라이브 통째 · 사용자 집 폴더 통째는 들여오지 않는다 — 그 안의 폴더를 고른다')
        if (inside(full, path.resolve(root))) throw new KmdError('E_INPUT', '이미 지식 폴더 안이다 — 지식 목록에서 연다')
        if (inside(path.resolve(root), full)) throw new KmdError('E_INPUT', '지식 폴더를 품은 폴더는 들여오지 않는다')
        // 이미 지식 모양(docs 폴더)이면 그 docs 안을 · 아니면 폴더 전체를 문서로 · 숨김 · node_modules 는 보지 않는다
        const src = (await fs.stat(path.join(full, 'docs')).then((s) => s.isDirectory(), () => false)) ? path.join(full, 'docs') : full
        const files = []
        let bytes = 0
        const walk = async (d, rel) => {
          for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue
            const r = rel ? `${rel}/${e.name}` : e.name
            if (e.isDirectory()) await walk(path.join(d, e.name), r)
            else if (e.isFile()) {
              const st = await fs.stat(path.join(d, e.name))
              bytes += st.size
              files.push({ path: r, full: path.join(d, e.name) })
              if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new KmdError('E_INPUT', `한 번에 ${MAX_FILES} 파일 · 200MB 까지 — 가져오기에서 나눠 넣는다`)
            }
          }
        }
        await walk(src, '')
        if (!files.some((f) => /\.(md|markdown|docx|pptx|xlsx)$/i.test(f.path))) throw new KmdError('E_INPUT', '이 폴더에는 문서가 될 파일(md · docx · pptx · xlsx)이 없다')
        const all = await hub.list()
        let nm = path.basename(full).normalize('NFC')
        for (let n = 2; all.some((k) => k.id.toLowerCase() === nm.toLowerCase()); n++) nm = `${path.basename(full).normalize('NFC')}-${n}`
        const made = await hub.addKnowledge(ctx, { kind: 'new', name: nm, empty: true })
        const r = await hub.importFiles(ctx, made.id, await Promise.all(files.map(async (f) => ({ path: f.path, data: await fs.readFile(f.full) }))), { asDocs: true })
        for (const x of ['_vocab.md', '_managed.md']) {
          const t = await fs.readFile(path.join(full, x)).catch(() => null)
          if (t) await fs.writeFile(path.join(made.dir, x), t)
        }
        if (src !== full) await commitPaths(made.dir, ['_vocab.md', '_managed.md'].filter((x) => existsSync(path.join(made.dir, x))), '이름 장부 들여옴', ctx.user).catch(() => {})
        cache.delete(made.id)
        return { ...made, from: full, summary: r.summary }
      }
      throw new KmdError('E_INPUT', '알아듣지 못했다 — 이름 · 내 PC 폴더 경로를 붙인다')
    },
    // 지식 지우기 — 보관하지 않고 완전히. 지식 폴더 · kmd 가 그 지식에 대해 둔 살림(백업 연결 · 색인 · 보내기 · 정리 · 가져오기 상태 · 주인 줄)을
    // 모두 지운다. 확인은 지식 이름을 그대로 다시 쓰는 것. 백업 자리에 이미 보낸 이력은 kmd 가 지우지 않는다(백업 자리의 일).
    // 누가 — 이 PC 의 주인 · 팀은 관리자 또는 개인 지식의 주인
    async deleteKnowledge(ctx, id, { confirm } = {}) {
      const meta = await hub.meta(id, ctx)
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다 — 지울 수 없다')
      const row = rowFor(id)
      const mine = row?.owner && row.owner === ctx.user && row.private
      if (mode !== 'pc' && !ctx.pc && !ctx.admin && !ctx.shell && !mine) throw new KmdError('E_FORBIDDEN', '팀 지식은 관리자가 지운다')
      if (String(confirm ?? '').trim().normalize('NFC') !== meta.name.normalize('NFC')) throw new KmdError('E_INPUT', `지우려면 지식 이름 「${meta.name}」 을 그대로 쓴다`)
      const dir = path.resolve(meta.dir)
      const inRoot = dir.startsWith(path.resolve(root) + path.sep)
      // 붙어 있는 것부터 떼고(감시 · 백업 · 일감 · 시계) 폴더를 지운다
      for (const w of watchers.filter((x) => x.dir && path.resolve(x.dir) === dir)) w.close()
      watchers.splice(0, watchers.length, ...watchers.filter((x) => !(x.dir && path.resolve(x.dir) === dir)))
      clearTimeout(decideTimers.get(id))
      decideTimers.delete(id)
      for (const [jid, j] of jobs) if (j.kn === id) jobs.delete(jid)
      for (const [key, w] of srcWatch) if (key.startsWith(id + '\n')) { w.close(); srcWatch.delete(key) }
      await backup.detach(meta).catch(() => {})
      cache.delete(id)
      files.delete(id)
      indexes.delete(id)
      // 지식 폴더 안의 것만 폴더째 지운다(예전에 밖에서 이어 둔 것은 잇기만 끊는다 — 남의 폴더를 지우지 않게)
      if (inRoot) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      const e = encodeURIComponent(id)
      // 그 지식의 일(넣은 파일 이름 · 터미널 줄)도 — 남기면 줄 없는 지식이 되어 누구에게나 보인다
      for (const [rid, r] of runs) if (r.kn === id) runs.delete(rid)
      for (const [t, a] of agentKeys) if (a.kn === id) agentKeys.delete(t)
      for (const p of [`backup/${e}.json`, `send/${e}.json`, `inbox/${e}.json`, `tidy/${e}.json`, `baseline/${e}.json`, `searchcheck/${e}.json`, `learn/${e}.json`, `runs/${e}.json`, `index/${e}`, `sources/${e}`, `watch/${e}`]) await fs.rm(path.join(dataDir, p), { recursive: true, force: true }).catch(() => {})
      for (const x of await listSecrets(dataDir).catch(() => [])) if (x.name.startsWith(secretPrefix(id))) await delSecret(dataDir, x.name).catch(() => {}) // 가져오는 곳의 자격
      const lf = path.join(dataDir, 'links.json')
      const links = await fs.readFile(lf, 'utf8').then(JSON.parse, () => null)
      if (links) await fs.writeFile(lf, JSON.stringify(links.filter((l) => l.id !== id), null, 1))
      if (rowFor(id)) await mutateReg((next) => { delete next.knowledge[id] })
      list = null
      feed.add(dataDir, ctx.user || 'kmd', { kind: 'kn', dot: 'acc', text: `지식을 지웠다 — ${meta.name}`, small: inRoot ? '보관하지 않고 완전히' : '잇기만 끊었다 — 폴더는 그 자리에 그대로' }).catch(() => {})
      log(`지식을 지웠다 — ${meta.name}${inRoot ? '' : ' (잇기만 끊음)'}`)
      return { id, name: meta.name, removed: inRoot }
    },
    // 일마다 모델 — 이 PC 의 설정(pc.models) · 없으면 기본 배분
    modelOf(role) {
      return modelOf(role, mode === 'pc' ? prefs.pc?.models : null)
    },
    models() {
      return Object.fromEntries(ROLES.map((r) => [r, hub.modelOf(r)]))
    },
    async setModel(ctx, role, model) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', 'Claude 모델은 내 PC 프로그램에서 고른다')
      if (!ROLES.includes(role)) throw new KmdError('E_INPUT', '그런 일은 없다')
      if (!CHOICES.includes(model)) throw new KmdError('E_INPUT', '고를 수 있는 모델이 아니다 — haiku · sonnet · opus · 기본')
      const next = structuredClone(prefs)
      ;((next.pc ||= {}).models ||= {})[role] = model
      await fs.mkdir(dataDir, { recursive: true })
      await fs.writeFile(path.join(dataDir, 'prefs.json'), JSON.stringify(next, null, 1))
      prefs = next
      return { role, model }
    },
    autoOf(user, key) {
      return mode === 'pc' ? prefs.pc?.[key] !== false : prefs.users?.[user]?.[key] !== false
    },
    async setAuto(ctx, key, on) {
      const ok = mode === 'pc' ? ['save', 'file', 'src', 'claude', 'find'] : ['file', 'find']
      if (!ok.includes(key)) throw new KmdError('E_INPUT', '그런 일은 없다')
      const next = structuredClone(prefs)
      if (mode === 'pc') (next.pc ||= {})[key] = !!on
      else ((next.users ||= {})[ctx.user] ||= {})[key] = !!on
      await fs.mkdir(dataDir, { recursive: true })
      await fs.writeFile(path.join(dataDir, 'prefs.json'), JSON.stringify(next, null, 1))
      prefs = next
      return { key, on: !!on }
    },
    // 메뉴 — 사람마다 지식의 순서 · 뺀 것(요구 v0.2 R2). 순서에 없는 지식(새로 생긴 것)은 맨 아래로 붙여 적는다
    async menuOf(ctx, ids = null) {
      const f = path.join(dataDir, 'menu', `${encodeURIComponent(ctx.user)}.json`)
      const m = await fs.readFile(f, 'utf8').then(JSON.parse, () => ({ order: [], hidden: [] }))
      if (!ids) return m
      const add = ids.filter((id) => !m.order.includes(id))
      if (add.length) {
        m.order = [...m.order, ...add]
        await fs.mkdir(path.dirname(f), { recursive: true })
        await fs.writeFile(f, JSON.stringify(m, null, 1))
      }
      return m
    },
    async menuSet(ctx, { order, hidden }) {
      const ids = (await hub.visible(ctx)).map((k) => k.id)
      const cur = await hub.menuOf(ctx, ids)
      const ok = (a) => (Array.isArray(a) ? [...new Set(a.map(String))].filter((x) => ids.includes(x)) : null)
      const next = { order: ok(order) ?? cur.order, hidden: ok(hidden) ?? cur.hidden }
      // 보낸 순서에 빠진 지식은 그 뒤로(없어지지 않게)
      next.order = [...next.order, ...cur.order.filter((x) => !next.order.includes(x))]
      const f = path.join(dataDir, 'menu', `${encodeURIComponent(ctx.user)}.json`)
      await fs.mkdir(path.dirname(f), { recursive: true })
      await fs.writeFile(f, JSON.stringify(next, null, 1))
      return next
    },
    // kmd 가 아는 지식 폴더 — 읽기(ids 없이) · 적기(ids)
    async known(ids = null) {
      const f = path.join(dataDir, 'known.json')
      if (ids) {
        await fs.mkdir(dataDir, { recursive: true })
        await fs.writeFile(f, JSON.stringify(ids))
        return ids
      }
      const j = await fs.readFile(f, 'utf8').then(JSON.parse, () => null)
      return j || hub.known((await hub.list()).map((k) => k.id))
    },
    // 동기화 — 지식 폴더를 다시 읽는다. 새로 놓인 지식 폴더는 잇고(git 이 없으면 세운다 · 편집기 거두기) 메뉴 맨 아래로 · 없어진 폴더는 목록에서 빠진다
    async sync(ctx) {
      if (mode === 'team' && !ctx.admin) throw new KmdError('E_FORBIDDEN', '팀 서버의 지식 폴더는 관리자가 다시 읽는다')
      // 새로 놓인 것 = kmd 가 아직 알지 못한 지식 폴더(알던 것은 <살림>/known.json — 켤 때 · 만들 때 · 동기화 때 적는다)
      const before = new Set(await hub.known())
      list = null
      cache.clear()
      const now = await hub.list()
      const added = now.filter((k) => !before.has(k.id))
      const gone = [...before].filter((id) => !now.some((k) => k.id === id))
      await hub.known(now.map((k) => k.id))
      // 새로 놓인 지식 — `_members.md` 가 있으면 그것을 따른다(되살렸거나 다른 서버에서 옮긴 개인 지식을 누른 사람의 팀 지식으로
      // 바꾸지 않게) · 없으면 팀 지식이고 누른 관리자가 주인이다. 그 뒤 모든 지식의 장부를 `_members.md` 와 맞춘다
      for (const k of added) {
        await ensureRepo(k.dir).catch((e) => log('동기화 — git', k.id, e.message))
        if (mode === 'pc' && started) watchers.push(Object.assign(collect.watch(k.dir, () => hub.collect(k.id)), { dir: k.dir }))
        if (mode === 'team' && !rowFor(k.id) && !existsSync(path.join(k.dir, '_members.md'))) await hub.setOwner({ ...ctx, shell: true }, k.id, { owner: ctx.user }).catch(() => {})
      }
      if (mode === 'team') await hub.reconcileOwners()
      for (const k of added) {
        await hub.gitlabAttach(k.id).catch((e) => log('GitLab 백업 자리', k.id, e.message))
        await hub.autoBackup(k.id).catch((e) => log('백업 자리', k.id, e.message))
      }
      const m = await hub.menuOf(ctx)
      await hub.menuSet(ctx, { order: [...m.order.filter((x) => now.some((k) => k.id === x)), ...added.map((k) => k.id)], hidden: m.hidden.filter((x) => now.some((k) => k.id === x)) })
      if (added.length) feed.add(dataDir, ctx.user, { kind: 'kn', dot: 'acc', text: `지식 폴더를 다시 읽었다 — 새 지식 ${added.length}`, small: added.map((k) => k.name).join(' · ') }).catch(() => {})
      return { added: added.map((k) => ({ id: k.id, name: k.name })), gone, total: now.length }
    },
    // 그 사람이 보는 지식들
    async visible(ctx) {
      if (ctx?.agent) return (await hub.list()).filter((k) => k.id === ctx.agent.kn)
      return (await hub.list()).filter((k) => visibleTo(k.id, ctx))
    },
    async meta(id, ctx) {
      const m = (await hub.list()).find((k) => k.id === id)
      if (!m) throw new KmdError('E_NOTFOUND', `지식 「${id}」 이 없다`)
      if (ctx?.agent && ctx.agent.kn !== id) throw new KmdError('E_FORBIDDEN', '이 일은 다른 지식에 쓰지 않는다')
      if (ctx && !ctx.agent && !visibleTo(id, ctx)) throw new KmdError('E_FORBIDDEN', '이 지식은 주인만 본다')
      return m
    },
    async get(id, ctx) {
      const meta = await hub.meta(id, ctx)
      if (!files.has(id)) files.set(id, new Map())
      if (!cache.has(id)) cache.set(id, loadKnowledge(meta, { cache: files.get(id) }).catch((e) => { cache.delete(id); throw e }))
      return cache.get(id)
    },
    async all(ctx) {
      return Promise.all((await hub.visible(ctx)).map((k) => hub.get(k.id)))
    },
    forget(id) {
      if (id) cache.delete(id)
      else {
        cache.clear()
        list = null
      }
    },
    owner(id) {
      return rowFor(id)
    },
    // 지식 안에서의 내 자리 — 주인 · 정리 · 기록
    roleIn(id, ctx) {
      const r = rowFor(id)
      if (r?.owner && r.owner === ctx.user) return '주인'
      if (r?.curators?.includes(ctx.user)) return '정리'
      return '기록'
    },

    // 저장 하나 — ctx.user 가 쓴다
    async save(ctx, id, input, opt = {}) {
      const meta = await hub.meta(id, ctx)
      if (ctx.agent) {
        const rec = input?.record || {}
        // 항목 글의 from(파일 글을 서버가 옮김) · append(지금 글 끝에 보탬)를 푼다 — 모델은 파일 글을 다시 쓰지 않는다
        const k0 = await hub.get(id)
        input = { ...input, sections: expandSections(k0, k0.byWork.get(ctx.agent.rec), input?.sections), record: { ...rec, tags: [...new Set([...(Array.isArray(rec.tags) ? rec.tags : []).filter((t) => !RESERVED_TAGS.includes(String(t).trim().toLowerCase())), 'curate-llm'])], reflects: [ctx.agent.rec] } }
        const r0 = await coreSave(meta.dir, input, { user: 'kmd-auto', agent: true })
        cache.delete(id)
        const run = runs.get(ctx.agent.run)
        if (run) {
          for (const d of r0.docs) { const n = d.replace(/^docs\/|\.md$/g, ''); if (!run.docs.includes(n)) run.docs.push(n) }
          run.names += r0.names || 0
        }
        return { ...r0, warnings: [] }
      }
      if (ctx.machine && ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const shut = backup.closed(meta)
      if (shut) throw new KmdError('E_BEHIND', shut.message)
      // 팀 지식에서 주인 · 정리하는 사람이 아니면 항목 글은 기록에 싣는다 — 정리 때 문서에 들어간다
      let queued = false
      let namesHeld = 0
      if (input?.sections?.some((s) => s?.doc && owners.isReservedFile(String(s.doc).replace(/\.md$/, '') + '.md'))) throw new KmdError('E_FORBIDDEN', 'kmd 가 쓰는 파일이다')
      // 이름 · 자리 장부(names)도 항목 글과 같은 자리 — 기록만 하는 사람의 것은 기록 본문에 「세울 이름」 으로 실어 정리 재료로 넘긴다
      // (팀 지식의 이름을 엉뚱한 자리로 옮겨 모두의 match · section 을 깨뜨리지 않게). 없는 이름 · 문서는 자리와 상관없이 같은 검사
      if ((input?.sections?.length || input?.names?.length) && !opt.system && !hub.canDirect(ctx, id)) {
        const k = await hub.get(id)
        const add = []
        const lines = []
        for (const s of input.sections || []) {
          if (s.coord) {
            const x = sectionOf(k, String(s.coord).trim().normalize('NFC'))
            if (!x) throw new KmdError('E_NOTFOUND', `「${s.coord}」 이 들어갈 문서가 정해져 있지 않다 — 기록만 보내거나 문서 · 머리로 가리킨다`)
            add.push(s.coord)
            lines.push(`## ${x.sec?.h || x.loc?.heading || s.coord}\n${String(s.content || '').trim()}`)
            continue
          }
          const d = s.doc && k.docs.find((x) => x.id === String(s.doc).replace(/^docs\/|\.md$/g, ''))
          if (!d) throw new KmdError('E_NOTFOUND', `「${s.doc || ''}」 문서가 없다 — 기록만 보내거나 있는 문서 · 머리로 가리킨다`)
          lines.push(`## ${s.heading}\n${String(s.content || '').trim()}`)
          if (s.heading) add.push(...coordsOfSection(k, d, s.heading))
        }
        const ns = (Array.isArray(input.names) ? input.names : []).filter((n) => n && n.coord && n.label)
        if (ns.length) lines.push(`## 세울 이름\n${ns.map((n) => `- ${n.label} (${n.coord})${n.doc ? ` → ${n.doc}${n.heading ? ' › ' + n.heading : ''}` : ''}${n.aliases?.length ? ` · 다른 이름 ${n.aliases.join(', ')}` : ''}`).join('\n')}`)
        namesHeld = ns.length
        input = { record: { ...input.record, touches: [...new Set([...(input.record?.touches || []), ...add])], body: `${input.record?.body || ''}\n\n${lines.join('\n\n')}`.trim() } }
        queued = true
      }
      const r0 = await coreSave(meta.dir, input, { user: ctx.user, system: !!opt.system })
      const r = queued ? { ...r0, queued: true, ...(namesHeld ? { namesHeld } : {}) } : r0
      // 그 사람의 「오늘 바뀐 것」 한 줄
      const title = input?.record?.title || ''
      feed.add(dataDir, ctx.user, queued || !r0.docs.length
        ? { kind: 'save', rec: r0.id, kn: id, dot: r0.docs.length ? 'acc' : 'pend', text: `${meta.name}에 기록 — 「${title.split(' — ')[0]}」`, small: r0.docs.length ? '' : hub.pendText(id) }
        : { kind: 'save', rec: r0.id, kn: id, dot: 'acc', text: `저장 — ${meta.name} › ${r0.docs.map((p) => p.replace(/^docs\/|\.md$/g, '')).join(' · ')} 「${title.split(' — ')[0]}」`, small: '문서에도 넣었다' }).catch(() => {})
      cache.delete(id)
      scheduleDecide(id)
      // 이 PC · 팀 서버의 개인 지식 — 남은 기록은 바로 문서에(뒤에서) · 팀 지식은 정리 방식이 「실시간」 이면 조용해진 뒤
      if ((mode === 'pc' || hub.teamPrivate(id)) && !opt.system && !opt.noCurate) hub.curateSoon(id).catch(() => {})
      else if (mode === 'team' && !opt.system && hub.tidyModeOf(id) === 'live') hub.liveSoon(id)
      // 백업은 기다리되 길게는 아니다 — 늦으면 다음 판정이 줄을 낸다
      // 백업 — 보통은 3초까지 기다린다(경고를 응답에 싣게) · 여럿을 받는 길(later)은 끝에 한 번
      if (backup.attached(meta) && !opt.later) await Promise.race([backup.enqueue(meta, { log }), new Promise((ok) => setTimeout(ok, 3000).unref?.())])
      return { ...r, warnings: backup.lines(meta, { name: meta.name }).map((l) => l.text) }
    },

    // 찾기 — 색인은 지식마다 · 바뀐 파일만 다시(저장 뒤 · 처음 찾을 때) · 지식을 섞지 않는다
    async index(id) {
      const k = await hub.get(id)
      const cur = indexes.get(id)
      if (cur && cur.k === k) return cur.p
      const p = buildIndex(k, { dataDir, prev: cur ? await cur.p.catch(() => null) : null })
      indexes.set(id, { k, p })
      return p
    },
    async search(ctx, id, { q = '', words = null, max = 6 } = {}) {
      const ks = id ? [await hub.meta(id, ctx)] : await hub.visible(ctx)
      const out = []
      for (const m of ks) {
        const k = await hub.get(m.id)
        const r = await ladder(k, await hub.index(m.id), { q, words, max, learned: await loadLearned(dataDir, m.id), passagesMax: hub.autoOf(ctx.user, 'find') ? 5 : 0 })
        out.push({ knowledge: m.id, name: m.name, ...r })
      }
      return out
    },
    async learn(ctx, id, { q, coord }) {
      await hub.meta(id, ctx)
      await learn(dataDir, id, { q, coord, who: ctx.user })
      return { ok: true }
    },
    async searchCheck(ctx, id, { freeze = false } = {}) {
      const k = await hub.get(id, ctx)
      return searchCheck(k, await hub.index(id), { dataDir, freeze })
    },

    // 고치기 — 주인(PC · 개인 · 주인 줄)은 저장하면 바로 문서에 · 그 밖은 기록으로 남고 정리 때 문서에
    canDirect(ctx, id) {
      if (mode === 'pc' || ctx.pc) return true
      if (ctx.agent) return ctx.agent.kn === id
      const r = rowFor(id)
      if (r?.owner && r.owner === ctx.user) return true
      if (r?.curators?.includes(ctx.user)) return true
      return !r?.owner && !!ctx.admin // 주인을 정하지 않은 팀 지식은 관리자가 정리한다
    },
    // 화면의 고치기 — sections(고친 항목) · remove(지운 항목 이름) · rename([{ from, to }] — 글은 그대로 이름만)
    //   주인 · 정리하는 사람은 곧바로 문서에 · 그 밖은 기록으로(지우기 · 이름 바꾸기도 기록 글에 — 정리하는 사람이 한다)
    //   같은 사람이 같은 글을 1분 안에 다시 보내면(두 번 누름) 앞의 것을 돌려준다
    async edit(ctx, id, { doc, sections = [], remove = [], rename = [] }) {
      const k = await hub.get(id, ctx)
      const d = k.docs.find((x) => x.id === doc)
      if (!d) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      sections = Array.isArray(sections) ? sections : []
      remove = (Array.isArray(remove) ? remove : []).map((h) => String(h || '').trim()).filter(Boolean)
      rename = (Array.isArray(rename) ? rename : []).map((x) => ({ from: String(x?.from || '').trim(), to: String(x?.to || '').trim() })).filter((x) => x.from && x.to && x.from !== x.to)
      if (!sections.length && !remove.length && !rename.length) throw new KmdError('E_INPUT', '바뀐 항목이 없다')
      const hs = sections.map((s) => String(s.h || '').trim())
      if ([...hs, ...remove, ...rename.flatMap((x) => [x.from, x.to])].some((h) => !h || /[\r\n]/.test(h))) throw new KmdError('E_INPUT', '항목 이름은 한 줄 글이다')
      for (const h of [...remove, ...rename.map((x) => x.from)]) if (!d.sections.some((s) => s.h === h)) throw new KmdError('E_CONFLICT', `「${h}」 항목이 읽은 뒤 바뀌었다 — 다시 읽고 고친다`)
      const dupKey = sha(JSON.stringify([ctx.user, id, doc, sections, remove, rename]))
      const dup = editDup.get(dupKey)
      if (dup && Date.now() - dup.at < 60_000) return dup.r
      const coords = [...new Set([...hs, ...remove, ...rename.map((x) => x.from)].flatMap((h) => coordsOfSection(k, d, h)))]
      const w = watchedOf(await fs.readFile(path.join(k.dir, ...d.path.split('/')), 'utf8').catch(() => ''))
      if (w) throw new KmdError('E_FORBIDDEN', `이 문서는 원본이 주인이다 — ${w.src} 의 ${w.path} 를 고친다 · 덧붙일 말은 기록으로 남긴다`)
      const what = [...hs, ...remove.map((h) => `${h} 지움`), ...rename.map((x) => `${x.from} → ${x.to}`)]
      let out
      if (hub.canDirect(ctx, id)) {
        const r = await hub.save(ctx, id, {
          record: { title: `화면에서 고침 — ${d.title} 「${what.join(' · ')}」`, body: `화면에서 고쳤다 — ${what.map((h) => `${d.title} › ${h}`).join(' · ')}`, touches: coords, tags: ['edit'] },
          sections: [
            ...sections.map((s) => ({ doc: d.path, heading: s.h, content: String(s.body ?? ''), ...(s.base ? { base: s.base } : {}) })),
            ...remove.map((h) => ({ doc: d.path, heading: h, remove: true, base: sha16(d.sections.find((s) => s.h === h).body) })),
            ...rename.map((x) => ({ doc: d.path, heading: x.from, rename: x.to, base: sha16(d.sections.find((s) => s.h === x.from).body) })),
          ],
        }, { system: true })
        out = { direct: true, ...r }
      } else {
        const body = [
          ...sections.map((s) => `## ${s.h}\n${String(s.body ?? '').trim()}`),
          ...(remove.length ? [`## 지울 항목\n${remove.map((h) => `- ${d.title} › ${h}`).join('\n')}`] : []),
          ...(rename.length ? [`## 이름 바꿀 항목\n${rename.map((x) => `- ${d.title} › ${x.from} → ${x.to}`).join('\n')}`] : []),
        ].join('\n\n')
        // 이름 장부에 없는 항목도 그 항목에 선다(at/ — 문서 · 항목 화면이 「아직 안 넣은 기록」 으로 보인다)
        const ats = [...new Set([...hs, ...remove, ...rename.map((x) => x.from)].filter((h) => d.sections.some((s) => s.h === h)).map((h) => atTag(d.id, h)))]
        const r = await hub.save(ctx, id, { record: { title: `${d.title} › ${what.join(' · ')} 고침`, body: `화면에서 남긴 기록 — 정리 때 문서에 넣는다\n\n${body}`, touches: coords, ...(ats.length ? { tags: ats } : {}) } })
        out = { direct: false, ...r }
      }
      editDup.set(dupKey, { at: Date.now(), r: out })
      for (const [key, v] of editDup) if (Date.now() - v.at > 60_000) editDup.delete(key)
      return out
    },
    // 되돌리기 — 그 기록을 넣은 항목을 넣기 전 글로 쓰고 판정을 거둔다(그 기록은 다시 아직 안 넣은 기록)
    async revert(ctx, id, { record }) {
      const k = await hub.get(id, ctx)
      // 주인 · 정리하는 사람 · 관리자 — 또는 그 정리가 넣은 기록을 쓴 사람(「내 기록에서 값이 바뀌었다 — 되돌릴 수 있다」)
      // 기록만 하는 사람은 자기 기록만 든 정리만 — 남의 기록이 섞였으면 정리하는 사람에게(남의 반영을 말없이 거두지 않게)
      const authors = new Set((k.byWork.get(record)?.reflects || []).map((x) => k.byWork.get(x)?.author).filter(Boolean))
      const curator = hub.canDirect(ctx, id) || !!rowFor(id)?.curators?.includes(ctx.user) || !!ctx.admin
      if (!curator && !authors.has(ctx.user)) throw new KmdError('E_FORBIDDEN', '주인 · 정리하는 사람만 되돌린다')
      if (!curator && [...authors].some((a) => a !== ctx.user)) throw new KmdError('E_FORBIDDEN', '이 정리에는 다른 사람의 기록도 들어 있다 — 주인 · 정리하는 사람에게 되돌려 달라고 한다')
      if (k.reverted?.has(record)) throw new KmdError('E_CONFLICT', '이미 되돌렸다')
      const plan = await revertPlan(k, record)
      const w = plan.record
      // 정리 기록을 되돌리면 그 정리가 넣은 기록들도 「주인이 되돌림」 — 다음 정리가 같은 초안을 다시 넣지 않게
      const used = w.tags.includes('curate-llm') ? [...w.body.matchAll(/^- 넣음 (\S+) — /gm)].map((m) => m[1]) : []
      // 함께 든 기록의 주인에게 — 내 기록의 반영이 거둬졌다
      for (const a of new Set([...used, ...(w.reflects || [])].map((x) => k.byWork.get(x)?.author).filter((a) => a && a !== ctx.user && !/^kmd/.test(a)))) feed.add(dataDir, a, { kind: 'tidy', kn: id, dot: 'warn', text: `${ctx.user} 이 정리를 되돌렸다 — 내 기록도 문서에서 빠졌다 · ${k.name}`, small: `「${w.title.split(' — ')[0]}」 · 다시 넣으려면 기록을 고쳐 남긴다` }).catch(() => {})
      return hub.save(ctx, id, {
        record: { title: `되돌림 — ${w.title}`, body: plan.sections.length ? plan.sections.map((s) => `- ${s.doc.replace(/^docs\/|\.md$/g, '')} › ${s.heading} — 넣기 전 글로`).join('\n') : '넣은 항목이 없다 — 판정만 거둔다', tags: ['curate-auto'], reopens: [w.id, ...used] },
        sections: plan.sections.map((s) => ({ doc: s.doc, heading: s.heading, content: s.content, applied: s.applied })),
      }, { system: true }).then(async (r) => {
        // 「오늘 바뀐 것」 줄에 「되돌렸다」 — 되돌린 사람과 그 정리에 든 기록을 쓴 사람 모두(남은 [되돌리기] 가 빈 되돌림을 만들지 않게)
        const who = new Set([ctx.user, ...[...used, ...(w.reflects || [])].map((x) => k.byWork.get(x)?.author).filter(Boolean)])
        for (const u of who) for (const x of await feed.list(dataDir, u)) if (x.revert === record) await feed.mark(dataDir, u, x.id, { reverted: true })
        return r
      })
    },
    // 비교 — 그 기록이 넣은 항목의 넣기 전 · 지금
    async diff(ctx, id, record) {
      const k = await hub.get(id, ctx)
      const plan = await revertPlan(k, record)
      return plan.sections.map((s) => {
        const d = k.byDocPath.get(s.doc)
        const now = d?.sections.find((x) => x.h === s.heading)
        return { doc: s.doc.replace(/^docs\/|\.md$/g, ''), title: d?.title || s.doc, heading: s.heading, before: s.content, after: now ? now.body : '' }
      })
    },
    // 결정 규칙 — 저장 뒤 잠시(기본 1분) 뒤에 한 번 · 누름 없음
    async decide(id) {
      const meta = await hub.meta(id)
      const k = await hub.get(id)
      const { curates, tasks } = decide(k)
      if (!curates.length) return { curates: 0, tasks: tasks.length }
      await coreSave(meta.dir, { record: decisionRecord(curates) }, { user: 'kmd-auto', system: true })
      cache.delete(id)
      return { curates: curates.length, tasks: tasks.length }
    },
    tasks: async (id) => decide(await hub.get(id)).tasks,

    // ── 자동으로 가져오는 곳(v0.6 §5) — 더하기는 관리자(팀) · 주인(PC) · 그 밖은 [관리자에게 부탁] ──
    async sourceCtx(id) {
      const metas = await hub.list()
      const backups = metas.map((m) => backup.stateOf(m)?.url).filter(Boolean)
      return { roots: (config.sourceRoots || []).map((r) => path.resolve(r)), dataDir, knowledgeDirs: metas.map((m) => m.dir), backups, pc: mode === 'pc' }
    },
    canSource(ctx, id) {
      return mode === 'pc' || ctx.pc || !!ctx.admin
    },
    // 살펴보기 — 주소를 받아 어떤 규칙이 무엇을 내는지(쓰지 않는다)
    async sourceProbe(ctx, id, { at, kind = null }) {
      await hub.meta(id, ctx)
      const k2 = kind || 'git'
      const t = checkTarget(at, { kind: k2, ...(await hub.sourceCtx(id)) })
      const src = { name: 'probe', kind: k2, at: t.url || t.folder, folder: t.folder, rules: [] }
      // 소스 코드(git) — 닿나 · 마지막 커밋(그것이 기준이 된다)
      if (k2 === 'git') {
        const h = await probeGit(src, { dataDir, kn: id })
        return { kind: k2, at: maskUrl(t.url || t.folder), asof: h.asof, head: h.head }
      }
      const r = await readSource(src, { dataDir, kn: id })
      const files = await r.read()
      return { kind: k2, at: maskUrl(t.url || t.folder), asof: r.asof, files: files.length, rules: probe(files).map((x) => ({ rule: x.rule, items: x.items.length, sample: x.items.slice(0, 3).map((i) => i.key || `${i.rows.length}줄`) })) }
    },
    // 더하기 — 유형마다(folder 코드 폴더 · git 저장소 · db). 나가는 자격(git 토큰 · DB 비밀번호)은 이 PC 화면만 받는다 —
    // 팀 화면은 받지 않고 셸 한 줄(`kmd secret set <자격 이름>`)과 상태만 보인다(v0.6 정정 ③)
    async sourceAdd(ctx, id, { name, at, kind = null, every = 'hourly', rules, cred = null, db = null, mode: pcMode = 'docs', meaning = false }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 관리자가 더한다 — [관리자에게 부탁]')
      name = String(name || '').trim()
      if (!name || name.length > 60 || /[\r\n"]/.test(name)) throw new KmdError('E_INPUT', '이름은 한 줄 60자 안')
      const pcScreen = mode === 'pc' || ctx.pc
      if ((cred?.password || cred?.token || db?.password) && !pcScreen) throw new KmdError('E_FORBIDDEN', `자격은 화면으로 받지 않는다 — 서버에서 한 줄: kmd secret set ${secretName(id, name)}`)
      const k2 = kind || (db ? 'db' : 'git')
      // 소스 코드는 git 하나 — 커밋 이력으로 바뀐 것만(정정 2026-10-23 · 코드 폴더 · 라이브러리 버전 · 표 파일은 걷었다)
      if (k2 === 'folder') throw new KmdError('E_INPUT', '소스 코드는 git 저장소로 받는다 — 올라온 묶음으로 바뀐 것을 본다 · 이 PC 폴더면 그 폴더의 git 저장소 경로를 넣는다')
      if (k2 === 'git') rules = []
      // 내 PC 폴더(PC 가 파일을 팀으로 보내기)는 걷었다 — 파일을 나르는 것은 이 서비스의 일이 아니다 · 지식은 「보내기」 로
      if (k2 === 'pc') throw new KmdError('E_INPUT', '내 PC 폴더는 없다 — 내 지식에서 만든 기록 · 문서를 「보내기」 로 보낸다')
      // 파일 목록(files)은 걷었다(감시 검토 v0.1 — 값보다 소음) · 표 파일(tables)은 사람이 고른 파일 · 폴더만
      // docs — 문서 폴더(지식 안 그 폴더로 사본 문서) · pc — 내 PC 폴더(팀 · 관리자 · PC 프로그램이 기계 열쇠로 보낸다 · 결정 ④)
      if (k2 === 'pc' && (mode !== 'team' || !ctx.admin)) throw new KmdError('E_FORBIDDEN', '내 PC 폴더는 팀에서 관리자가 허락한다')
      const okRules = k2 === 'db' ? ['dbtables'] : ['docs']
      for (const r of Array.isArray(rules) ? rules : []) {
        if (r?.rule !== 'tables') continue
        const ps = (Array.isArray(r.paths) ? r.paths : []).map((x) => String(x).trim().replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '')).filter(Boolean)
        if (!ps.length || ps.some((x) => x.split('/').includes('..') || /^[A-Za-z]:|^\//.test(x))) throw new KmdError('E_INPUT', '표로 만들 파일 · 폴더를 그 안의 경로로 하나 이상 적는다(예: codes/상태코드.csv · data/)')
        r.paths = ps.slice(0, 50)
      }
      if (k2 !== 'git' && (!Array.isArray(rules) || !rules.length || rules.some((r) => !okRules.includes(r.rule) || !r.into?.doc))) throw new KmdError('E_INPUT', `무엇을 채우나는 ${okRules.join(' · ')} 중 · 넣을 문서와 함께`)
      const decl = await readDecl(meta.dir)
      if (decl.some((s) => s.name === name)) throw new KmdError('E_CONFLICT', '같은 이름의 가져오는 곳이 있다')
      let shown
      if (k2 === 'db') {
        const d = db || {}
        const word = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/
        if ((d.engine || 'postgres') !== 'postgres') throw new KmdError('E_INPUT', 'DB 는 PostgreSQL 만 — 다른 DB 는 바깥 생성기(기계 열쇠)로')
        if (!/^[A-Za-z0-9.-]{1,253}$/.test(String(d.host || ''))) throw new KmdError('E_INPUT', '호스트가 아니다')
        const port = Number(d.port || 5432)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new KmdError('E_INPUT', '포트는 1 ~ 65535')
        if (!word.test(String(d.database || ''))) throw new KmdError('E_INPUT', 'DB 이름이 아니다')
        if (!word.test(String(d.user || ''))) throw new KmdError('E_INPUT', '계정이 아니다')
        const schema = String(d.schema || 'public')
        if (!word.test(schema)) throw new KmdError('E_INPUT', '스키마 이름이 아니다')
        if (d.password) await setSecret(dataDir, secretName(id, name), String(d.password))
        shown = `postgres://${d.user}@${d.host}:${port}/${d.database}?schema=${schema}`
      } else if (k2 === 'pc') {
        shown = '내 PC — 기계 열쇠로 보낸다'
      } else {
        const t = checkTarget(at, { kind: k2 === 'docs' ? 'folder' : k2, ...(await hub.sourceCtx(id)) })
        if (k2 === 'git' && (cred?.user || cred?.token)) await setSecret(dataDir, secretName(id, name), `${cred.user || 'git'}:${cred.token || ''}`)
        shown = t.url ? await stripCreds(t.url, { dataDir, kn: id, name }) : t.folder
      }
      // DB 주소는 계정 이름까지 둔다(비밀번호는 처음부터 없다) · 그 밖은 주소에 든 자격을 가린다
      // 뜻 갱신(소스 변경 → 기록 → 정리)은 코드 폴더 · git 만 — 내 PC 폴더는 코드가 팀으로 가지 않게 하지 않는다
      const src = { name, kind: k2, at: k2 === 'db' ? shown : maskUrl(shown), every, rules: rules.map((r) => ({ rule: r.rule, ...(r.paths ? { paths: r.paths } : {}), into: { doc: String(r.into.doc), ...(r.into.heading ? { heading: String(r.into.heading) } : {}) } })), by: ctx.user, since: new Date().toISOString().slice(0, 10) }
      const addKey = `${id}\n${name}`
      adding.add(addKey)
      try {
        await writeDecl(meta.dir, [...decl, src], { user: ctx.user, title: `가져오는 곳 더함 — ${name}` })
        cache.delete(id)
        if (started) hub.watchSource(id, src)
        const r = await hub.sourceRun(id, name, { first: true })
        // 같은 이름 · 같은 지식의 기다리는 부탁은 닫는다(부탁한 사람에게 알린다)
        for (const q of (await hub.requests()).filter((q) => q.kn === id && q.name === name)) await hub.requestClose(ctx, q.id, { state: 'done' }).catch(() => {})
        return { source: src, run: r, secret: secretName(id, name) }
      } finally {
        adding.delete(addKey)
      }
    },
    // DB 연결 확인 — 닿나 · 비밀번호(또는 든 비밀)가 있으면 붙어서 테이블 수까지 · 관리자 · PC 만(아무나 포트를 두드리지 않게)
    async sourceCheckDb(ctx, id, { host, port = 5432, database = null, user = null, schema = 'public', password = null, name = null }) {
      await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '관리자가 한다')
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(String(host || ''))) throw new KmdError('E_INPUT', '호스트가 아니다')
      const t0 = Date.now()
      const reach = await new Promise((ok) => {
        const sock = net.connect({ host: String(host), port: Number(port) || 5432 })
        const done = (v) => { sock.destroy(); ok(v) }
        sock.setTimeout(3000, () => done(false))
        sock.once('connect', () => done(true))
        sock.once('error', () => done(false))
      })
      if (!reach || !database || !user) return { reach, ms: Date.now() - t0 }
      // 팀 화면은 비밀번호를 받지 않는다 — 이미 넣은 비밀(그 이름)이 있으면 그것으로
      if (password && mode !== 'pc' && !ctx.pc) throw new KmdError('E_FORBIDDEN', '비밀번호는 화면으로 받지 않는다 — 서버에서 kmd secret set')
      const pw = password || (name ? await getSecret(dataDir, secretName(id, name)) : null)
      if (!pw) return { reach, ms: Date.now() - t0, login: null }
      try {
        const c = await dbConnect({ host: String(host), port: Number(port) || 5432, database: String(database), user: String(user), password: pw })
        try {
          const t = await dbCatalog(c, String(schema || 'public'))
          return { reach, ms: Date.now() - t0, login: true, tables: t.size }
        } finally { await c.end().catch(() => {}) }
      } catch (e) {
        return { reach, ms: Date.now() - t0, login: false, why: e.message }
      }
    },
    // 한 곳 돌리기 — 같은 곳은 한 줄로 선다(실시간 감시 · 시계 · [지금 확인] · 전체 다시 맞추기가 겹쳐도 차례로)
    async sourceRun(id, name = null, { first = false, force = false, full = false, pass = null, onProgress = null } = {}) {
      const meta = await hub.meta(id)
      const decl = await readDecl(meta.dir)
      const out = []
      for (const s of decl.filter((x) => !name || x.name === name)) {
        // DB 읽기(pg · 읽기 전용 확인)는 S10 계정이 생기면 연다 — 그때까지는 연결 정보만 두고 쉰다(실패로 세지 않는다 · 멈춤 줄 없음)
        if (s.kind === 'pc') {
          out.push({ name: s.name, state: 'waiting', n: 0, why: '내 PC 폴더는 걷었다 — 지식은 「보내기」 로 받는다' })
          continue
        }
        const key = `${id}\n${s.name}`
        const prev = srcRuns.get(key) || Promise.resolve()
        const job = prev.catch(() => {}).then(async () => {
          srcBusy.set(key, { kn: id, name: s.name, kind: s.kind, since: new Date().toISOString(), full })
          try {
          const k = await hub.get(id)
          const src = { ...s, folder: s.kind === 'folder' || !(/^(https?|ssh):\/\//i.test(s.at) || /^[^/\\\s]+@[^/\\\s]+:/.test(s.at)) ? s.at : undefined }
          const r = await runSource(k, src, { dataDir, first, force, full, pass, onProgress, meaning: hub.meaningOk(id), mdOf: mode === 'pc' ? (rel, data) => hub.mdOf(rel, data) : null, analyze: mode === 'pc' && hub.meaningOk(id) ? (c, diffs, rec) => hub.analyzeCommit(id, s.name, c, diffs, rec) : null, save: (input) => coreSave(meta.dir, input, { user: 'kmd', system: true }) })
          cache.delete(id)
          if (s.kind === 'docs' && hub.agentOk(id)) for (const x of (r.rows || []).filter((y) => y.kind === 'fail' && PCONLY.includes(y.name.split('.').pop().toLowerCase()))) {
            const pre = docPrefix(s)
            const rel = pre && x.name.startsWith(pre + '/') ? x.name.slice(pre.length + 1) : x.name
            const run = hub.newRun(id, { title: `${s.name} › ${rel}`, file: rel, by: 'kmd' })
            hub.queueRun(id, async () => {
              try {
                const data = await fs.readFile(path.join(s.at, ...rel.split('/')))
                const md = await hub.mdOf(rel, data, run)
                if (!md) { run.state = 'fail'; run.msg = '글로 바꾸지 못했다 — 원본은 첨부로'; return }
                const a = await applyDocs(await hub.get(id), { src: s, prefix: pre, files: [{ rel, data }], mdOf: async () => md })
                run.state = 'done'
                run.msg = a.docs ? `기록 · 문서가 됐다 — ${pre ? pre + ' › ' : ''}${rel.replace(/\.[^.]+$/, '')}(원본이 주인)` : '그대로'
                if (a.docs) run.docs.push(`${pre ? pre + '/' : ''}${rel.replace(/\.[^.]+$/, '')}`)
                hub.runLine(run, 'ok', run.msg)
              } catch (e) {
                // 일이 도중에 깨졌다(파일 잠김 · 읽기 실패) — 장부에서 걷어 다음 확인(실시간 · 정한 때)이 다시 한다. 글로 못 바꾼 것(위)은 다시 하지 않는다
                await forgetFile(dataDir, id, s.name, rel).catch(() => {})
                run.state = 'fail'; run.msg = `${e.message} — 다음 확인 때 다시 한다`; hub.runLine(run, 'err', run.msg)
              } finally { run.endedAt = new Date().toISOString(); cache.delete(id); hub.runSave(run) }
            })
          }
          // 코드가 바뀌어 기록을 남겼다 — 그 지식의 정리를 바로 건다(정리 검사를 그대로 탄다 · 값이 바뀌면 노랑 · 되돌릴 수 있다)
          // 「Claude 에 보내지 않음」 지식 · 이 PC 의 자동 정리 끔이면 기록만 남는다(사람이 정리할 때 들어간다)
          if (r.codeRecords && mode === 'pc') hub.curateSoon(id).catch(() => {})
          else if (r.codeRecords && hub.teamPrivate(id)) hub.curateSoon(id).catch(() => {})
          else if (r.codeRecords && hub.meaningOk(id) && hub.tidyModeOf(id) !== 'manual') hub.tidyNow({ user: 'kmd', admin: true }, id, { by: 'kmd', auto: true }).catch(() => {})
          if (r.state === 'changed') for (const u of await hub.curatorsOf(id)) await feed.add(dataDir, u, { kind: 'source', kn: id, dot: 'acc', text: r.commits != null ? `${s.name}에서 새 묶음 ${r.commits} · 코드 바뀜 기록 ${r.codeRecords} — ${meta.name}` : s.kind === 'docs' ? `${s.name}에서 기록 ${r.recs || 0} · 문서 ${r.docs || 0} — ${meta.name}` : `${s.name}에서 바뀐 표 ${r.n} — ${meta.name}`, small: r.commits != null ? '정리가 걸린 항목 글을 맞춘다' : s.kind === 'docs' ? `바뀐 파일 ${r.files} · 파일마다 기록을 남기고 원본이 주인인 문서로` : `바뀐 파일 ${r.files} · 저절로 채우는 표` })
          return r
          } finally {
            srcBusy.delete(key)
          }
        })
        srcRuns.set(key, job)
        out.push({ name: s.name, ...(await job) })
        if (srcRuns.get(key) === job) srcRuns.delete(key)
      }
      if (out.some((x) => x.state === 'changed') && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return out
    },
    // 전체 다시 맞추기 — 뒤에서 일감으로 · 진행률 · 끊기면(서버를 다시 켜면) 같은 pass 로 이어서. 쓰는 것은 다른 것뿐
    async sourceResync(ctx, id, name) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '전체 다시 맞추기는 관리자가 한다')
      const s = (await readDecl(meta.dir)).find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져오는 곳이 없다')
      if (s.kind === 'git' && !s.rules?.length) throw new KmdError('E_INPUT', '소스 코드는 묶음으로 본다 — 다시 맞출 것이 없다')
      const key = `${id}\n${name}`
      if (resyncs.get(key)?.state === 'running') return resyncs.get(key)
      const st = await readSourceState(dataDir, id)
      const pass = st[name]?.resync?.pass || Date.now() // 남은 pass 가 있으면 이어서
      const job = { state: 'running', done: 0, total: 0, pass, at: new Date().toISOString() }
      resyncs.set(key, job)
      const mark = async (v) => { const x = await readSourceState(dataDir, id); (x[name] ||= {}).resync = v; await writeSourceState(dataDir, id, x) }
      await mark({ pass, at: job.at })
      hub.sourceRun(id, name, { full: true, pass, onProgress: (d, t) => { job.done = d; job.total = t } })
        .then(async ([r]) => {
          Object.assign(job, { state: r?.state === 'failed' ? 'failed' : 'done', result: r, end: new Date().toISOString() })
          if (r?.state !== 'failed') await mark(undefined)
        })
        .catch((e) => Object.assign(job, { state: 'failed', why: e.message }))
      return job
    },
    // 뜻 갱신을 해도 되는 지식 — 「Claude 에 보내지 않음」 이 아니고(결정 ③) · 이 PC 는 「자동 정리 — Claude 로」 를 켰을 때
    meaningOk(id) {
      if (rowFor(id)?.noClaude) return false
      return mode === 'pc' ? hub.autoOf(pcUser, 'claude') : true
    },
    async sourceMeaning(ctx, id, { name, on }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '관리자가 한다')
      const decl = await readDecl(meta.dir)
      const s = decl.find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져오는 곳이 없다')
      if (s.kind !== 'folder' && s.kind !== 'git') throw new KmdError('E_INPUT', '뜻 갱신은 코드 폴더 · git 만')
      if (!!s.meaning === !!on) return s
      if (on) s.meaning = true
      else delete s.meaning
      await writeDecl(meta.dir, decl, { user: ctx.user, title: `가져오는 곳 뜻 갱신 ${on ? '켬' : '끔'} — ${name}` })
      cache.delete(id)
      // 켜면 지금 코드로 사본 · 장부를 맞춘다(그 뒤 바뀐 것부터 기록)
      if (on) await hub.sourceRun(id, name)
      return s
    },
    // 실시간 감시 — 이 PC(팀이면 서버)의 코드 폴더는 바뀌면 조용해진 뒤(기본 10초) 그곳만 확인한다 · git 은 정한 때마다
    watchSource(id, s) {
      const key = `${id}\n${s.name}`
      srcWatch.get(key)?.close()
      srcWatch.delete(key)
      if ((s.kind !== 'folder' && s.kind !== 'docs') || !s.at) return
      let timer = null
      try {
        const w = fsWatch(s.at, { recursive: true }, (ev, f) => {
          const p = String(f || '').replace(/\\/g, '/')
          if (p.split('/').some((x) => x.startsWith('.') || x === 'node_modules')) return
          clearTimeout(timer)
          timer = setTimeout(() => hub.sourceRun(id, s.name).catch(() => {}), config.watchQuietMs ?? 10_000)
          timer.unref?.()
        })
        w.on('error', () => {})
        srcWatch.set(key, { close: () => { clearTimeout(timer); w.close() } })
      } catch {}
    },
    sourceState: (id) => readSourceState(dataDir, id),
    async sources(ctx, id) {
      const meta = await hub.meta(id, ctx)
      const decl = await readDecl(meta.dir)
      const st = await readSourceState(dataDir, id)
      const have = new Set((await listSecrets(dataDir).catch(() => [])).map((x) => x.name))
      // watch — live(실시간 감시) · poll(정한 때마다) · none · resync — 전체 다시 맞추기(도는 중 · 끝 · 끊김)
      const noClaude = !hub.meaningOk(id)
      return decl.map((s) => ({ ...s, meaningBlocked: noClaude, watch: s.kind === 'pc' ? 'pc' : s.kind === 'folder' || s.kind === 'docs' ? (srcWatch.has(`${id}\n${s.name}`) ? 'live' : 'poll') : s.kind === 'git' ? 'poll' : 'none', resync: resyncs.get(`${id}\n${s.name}`) || (st[s.name]?.resync ? { state: 'paused', ...st[s.name].resync } : null), state: st[s.name] || {}, secret: { name: secretName(id, s.name), has: have.has(secretName(id, s.name)) } }))
    },
    // 자료 가져오기 화면 — 그 사람이 보는 지식들의 가져오는 곳 모두
    async allSources(ctx) {
      const out = []
      for (const m of await hub.visible(ctx)) for (const s of await hub.sources(ctx, m.id)) out.push({ kn: m.id, knName: m.name, ...s })
      return out
    },
    // 언제 — hourly · daily HH:MM · weekly · change(바뀔 때만) · manual
    async sourceEvery(ctx, id, { name, every }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '언제 바꾸기는 관리자가 한다')
      if (!/^(hourly|weekly|change|manual|daily ([01]\d|2[0-3]):[0-5]\d)$/.test(String(every))) throw new KmdError('E_INPUT', '언제는 hourly · daily HH:MM · weekly · change')
      const decl = await readDecl(meta.dir)
      const s = decl.find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져오는 곳이 없다')
      if (s.every === every) return s
      s.every = every
      await writeDecl(meta.dir, decl, { user: ctx.user, title: `가져오는 곳 언제 — ${name} · ${every}` })
      cache.delete(id)
      return s
    },
    // 고치기 — 주소(경로 · git) · 넣을 문서 · 언제 · 뜻 갱신 · DB 접속 · 자격(요구 v0.2 R4). 이름은 상태 · 자격의 열쇠라 고치지 않는다.
    //   빈 비밀번호 · 토큰은 「그대로」 · 주소나 접속이 바뀌면 처음부터 다시 한 번 가져온다
    async sourceEdit(ctx, id, { name, at = null, doc = null, every = null, meaning = null, db = null, cred = null }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 관리자가 고친다')
      const pcScreen = mode === 'pc' || ctx.pc
      if ((cred?.token || db?.password) && !pcScreen) throw new KmdError('E_FORBIDDEN', `자격은 화면으로 받지 않는다 — 서버에서 한 줄: kmd secret set ${secretName(id, name)}`)
      const decl = await readDecl(meta.dir)
      const s = decl.find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져오는 곳이 없다')
      const was = JSON.stringify(s)
      let refetch = false
      if (every != null) {
        if (!/^(hourly|weekly|change|manual|daily ([01]\d|2[0-3]):[0-5]\d)$/.test(String(every))) throw new KmdError('E_INPUT', '언제는 hourly · daily HH:MM · weekly · change · manual')
        s.every = String(every)
      }
      if (doc != null && s.rules?.[0]) {
        const d = String(doc).trim().replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '')
        if (!d || d.length > 80 || d.split('/').some((x) => !x.trim() || x === '..')) throw new KmdError('E_INPUT', '넣을 문서 이름이 아니다')
        if (s.rules[0].into.doc !== d) { s.rules[0].into.doc = d; refetch = true }
      }
      if (meaning != null && s.kind === 'git') { if (meaning) s.meaning = true; else delete s.meaning }
      if (s.kind === 'db' && db) {
        const word = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/
        const cur = (() => { try { const u = new URL(s.at); return { host: u.hostname, port: Number(u.port) || 5432, database: decodeURIComponent(u.pathname.slice(1)), user: decodeURIComponent(u.username), schema: u.searchParams.get('schema') || 'public' } } catch { return {} } })()
        const d = { ...cur, ...Object.fromEntries(Object.entries(db).filter(([, v]) => v != null && String(v).trim() !== '').map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) }
        if (!/^[A-Za-z0-9.-]{1,253}$/.test(String(d.host || ''))) throw new KmdError('E_INPUT', '호스트가 아니다')
        const port = Number(d.port || 5432)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new KmdError('E_INPUT', '포트는 1 ~ 65535')
        if (!word.test(String(d.database || ''))) throw new KmdError('E_INPUT', 'DB 이름이 아니다')
        if (!word.test(String(d.user || ''))) throw new KmdError('E_INPUT', '계정이 아니다')
        if (!word.test(String(d.schema || 'public'))) throw new KmdError('E_INPUT', '스키마 이름이 아니다')
        const shown = `postgres://${d.user}@${d.host}:${port}/${d.database}?schema=${d.schema || 'public'}`
        if (shown !== s.at) { s.at = shown; refetch = true }
        if (db.password) { await setSecret(dataDir, secretName(id, name), String(db.password)); refetch = true }
      } else if (at != null && String(at).trim() && s.kind !== 'db') {
        const t = checkTarget(String(at).trim(), { kind: s.kind === 'docs' ? 'folder' : s.kind, ...(await hub.sourceCtx(id)) })
        const shown = t.url ? await stripCreds(t.url, { dataDir, kn: id, name }) : t.folder
        if (maskUrl(shown) !== s.at) { s.at = maskUrl(shown); refetch = true }
      }
      if (s.kind === 'git' && cred && (cred.user || cred.token)) {
        const old = await getSecret(dataDir, secretName(id, name)).catch(() => null)
        const [ou, ...ot] = String(old || '').split(':')
        await setSecret(dataDir, secretName(id, name), `${cred.user || ou || 'git'}:${cred.token || ot.join(':') || ''}`)
        refetch = true
      }
      if (JSON.stringify(s) !== was) {
        await writeDecl(meta.dir, decl, { user: ctx.user, title: `가져오는 곳 고침 — ${name}` })
        cache.delete(id)
        if (started) hub.watchSource(id, s)
      }
      // 주소 · 접속 · 넣을 문서가 바뀌면 장부를 비우고 처음처럼 한 번(바뀐 것만 보는 기준이 달라졌다)
      let run = null
      if (refetch) {
        await fs.rm(path.join(dataDir, 'watch', encodeURIComponent(id), `${crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 16)}.json`), { force: true })
        run = await hub.sourceRun(id, name, { first: true }).catch((e) => [{ state: 'failed', why: e.message }])
      }
      return { source: s, run }
    },
    // 지우기 — 감시 · 상태 · 장부 · 자격을 걷는다. 이미 들어온 문서 · 기록은 그대로 둔다(지식의 글이다)
    async sourceRemove(ctx, id, { name, copies = 'keep' }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 관리자가 지운다')
      const decl = await readDecl(meta.dir)
      if (!decl.some((x) => x.name === name)) throw new KmdError('E_NOTFOUND', '그 가져오는 곳이 없다')
      const key = `${id}\n${name}`
      srcWatch.get(key)?.close()
      srcWatch.delete(key)
      await writeDecl(meta.dir, decl.filter((x) => x.name !== name), { user: ctx.user, title: `가져오는 곳 지움 — ${name}` })
      const st = await readSourceState(dataDir, id)
      delete st[name]
      await writeSourceState(dataDir, id, st)
      await fs.rm(path.join(dataDir, 'watch', encodeURIComponent(id), `${crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 16)}.json`), { force: true })
      await delSecret(dataDir, secretName(id, name)).catch(() => {})
      // 그 곳에서 온 사본 문서 — 「원본이 주인」 표지가 남으면 고칠 길이 없다
      const mine = []
      for (const d of (await hub.get(id)).docs) {
        const t = await fs.readFile(path.join(meta.dir, ...d.path.split('/')), 'utf8').catch(() => '')
        if (watchedOf(t)?.src === name) mine.push({ d, t })
      }
      if (mine.length) {
        await serial(path.resolve(meta.dir), async () => {
          for (const { d, t } of mine) {
            const full = path.join(meta.dir, ...d.path.split('/'))
            if (copies === 'drop') await fs.rm(full, { force: true })
            else await fs.writeFile(full, t.split('\n').slice(1).join('\n').replace(/^\n+/, ''), 'utf8')
          }
          await commitPaths(meta.dir, mine.map((x) => x.d.path), `가져오는 곳 지움 — ${name} · 사본 ${mine.length} ${copies === 'drop' ? '지움' : '내 문서로'}`, ctx.user).catch((e) => log('사본 정리', id, e.message))
        })
      }
      cache.delete(id)
      return { removed: name, copies: mine.length, kept: copies !== 'drop' }
    },
    // 원본이 없어진 사본 — 「원본이 주인」 표지를 걷어 내 문서로(고칠 수 있게)
    async unwatch(ctx, id, { doc }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '주인 · 정리하는 사람이 한다')
      const d = (await hub.get(id)).docs.find((x) => x.id === doc)
      if (!d) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      const full = path.join(meta.dir, ...d.path.split('/'))
      const t = await fs.readFile(full, 'utf8')
      const w = watchedOf(t)
      if (!w) return { ok: true }
      if ((await readDecl(meta.dir)).some((s) => s.name === w.src)) throw new KmdError('E_CONFLICT', `원본이 아직 있다 — ${w.src} 에서 가져온다 · 가져오는 곳을 지우면 내 문서로 남는다`)
      await serial(path.resolve(meta.dir), async () => {
        await fs.writeFile(full, t.split('\n').slice(1).join('\n').replace(/^\n+/, ''), 'utf8')
        await commitPaths(meta.dir, [d.path], `원본이 없어진 사본 — 내 문서로 · ${d.title}`, ctx.user)
      })
      cache.delete(id)
      return { ok: true }
    },
    async curatorsOf(id) {
      const r = rowFor(id)
      return [...new Set([r?.owner, ...(r?.curators || [])].filter(Boolean))]
    },
    // 관리자에게 부탁 — 관리 화면 · 관리자의 오늘 바뀐 것에
    // 부탁 — 상태(기다림 wait · 더함 done · 거절 no) · 같은 부탁은 합친다 · 주소는 받을 때 검사한다 · 결과는 부탁한 사람 이력에.
    // 개인 지식은 관리자가 볼 수 없어 처리할 수 없다 — 받지 않고 길을 안내한다
    async sourceRequest(ctx, id, card) {
      await hub.meta(id, ctx)
      if (mode === 'team' && rowFor(id)?.private) throw new KmdError('E_INPUT', '개인 지식은 관리자가 열 수 없어 부탁을 처리하지 못한다 — 내 PC 지식에서 지켜보며 맞추기로 받은 뒤 보내기로 옮긴다')
      const name = String(card.name || '').trim().slice(0, 60)
      if (!name) throw new KmdError('E_INPUT', '이름이 있다')
      const kind = card.kind || (card.db ? 'db' : 'git')
      if (kind !== 'db') checkTarget(String(card.at || '').trim(), { kind: kind === 'docs' ? 'folder' : kind, ...(await hub.sourceCtx(id)) })
      const f = path.join(dataDir, 'requests.json')
      return inReq(async () => {
        const all = await hub.requestsAll()
        const at2 = maskUrl(String(card.at || ''))
        const same = all.find((r) => (r.state || 'wait') === 'wait' && r.kn === id && r.name === name && r.at2 === at2)
        if (same) { if (!same.by.split(', ').includes(ctx.user)) same.by += ', ' + ctx.user; await fs.writeFile(f, JSON.stringify(all)); return { ...same, again: true } }
        const req = { id: crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), by: ctx.user, kn: id, name, at2, kind: card.kind || null, rules: card.rules || [], every: card.every || 'hourly', state: 'wait', ...(card.db ? { db: { engine: 'postgres', host: String(card.db.host || '').slice(0, 253), port: Number(card.db.port) || 5432, database: String(card.db.database || '').slice(0, 63), schema: String(card.db.schema || 'public').slice(0, 63), user: String(card.db.user || '').slice(0, 63) } } : {}) }
        all.unshift(req)
        await fs.writeFile(f, JSON.stringify(all.slice(0, 200)))
        return req
      })
    },
    requestsAll: async () => fs.readFile(path.join(dataDir, 'requests.json'), 'utf8').then(JSON.parse, () => []),
    // 관리 화면 — 기다리는 것만 · 넣을 지식이 사라진 부탁은 뺀다
    requests: async () => {
      const ids = new Set((await hub.list()).map((k) => k.id))
      return (await hub.requestsAll()).filter((r) => (r.state || 'wait') === 'wait' && ids.has(r.kn))
    },
    // 부탁 닫기 — 더함 · 거절(까닭) · 부탁한 사람에게 결과를 알린다
    async requestClose(ctx, rid, { state, why = '' }) {
      if (!['done', 'no'].includes(state)) throw new KmdError('E_INPUT', '더함 · 거절 중 하나')
      const f = path.join(dataDir, 'requests.json')
      return inReq(async () => {
        const all = await hub.requestsAll()
        const r = all.find((x) => x.id === rid)
        if (!r) throw new KmdError('E_NOTFOUND', '그런 부탁은 없다')
        Object.assign(r, { state, closedBy: ctx.user, closedAt: new Date().toISOString(), ...(why ? { why: String(why).slice(0, 200) } : {}) })
        await fs.writeFile(f, JSON.stringify(all))
        const kn = (await hub.list()).find((k) => k.id === r.kn)?.name || r.kn
        for (const u of r.by.split(', ')) await feed.add(dataDir, u, { kind: 'source', kn: r.kn, dot: state === 'done' ? 'acc' : 'warn', text: state === 'done' ? `부탁한 가져오는 곳을 더했다 — ${r.name} · ${kn}` : `부탁한 가져오는 곳을 더하지 않았다 — ${r.name} · ${kn}`, small: state === 'done' ? `${ctx.user} 이 더했다` : `${ctx.user}${why ? ' — ' + String(why).slice(0, 200) : ''}` }).catch(() => {})
        return r
      })
    },
    // 바깥 생성기 — 기계 열쇠로 그 원천의 표만(이름의 종류도 열쇠의 것과 대조)
    async baseline(ctx, id, { source, items = [], asof = null, host = '', files = 0 }) {
      const meta = await hub.meta(id)
      if (!ctx.machine || ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '기계 열쇠로만 쓴다', { need: 'machine' })
      if (String(source) !== ctx.machine.source) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 가져오는 곳의 것이다')
      const k = await hub.get(id)
      const types = ctx.machine.types || []
      const targets = []
      for (const it of Array.isArray(items) ? items : []) {
        if (!Array.isArray(it.cols) || !Array.isArray(it.rows)) throw new KmdError('E_INPUT', '항목마다 cols · rows')
        let doc = it.doc
        let heading = it.heading
        if (it.coord) {
          if (types.length && !types.includes(String(it.coord).split(':')[0])) throw new KmdError('E_FORBIDDEN', `이 열쇠는 ${types.join(' · ')} 종류만 쓴다`)
          const x = sectionOf(k, it.coord)
          if (!x?.loc) throw new KmdError('E_NOTFOUND', `「${it.coord}」 이 들어갈 문서가 정해져 있지 않다`)
          doc = x.loc.doc
          heading = x.sec ? x.sec.h : x.loc.heading
        }
        if (!doc || !heading) throw new KmdError('E_INPUT', '항목마다 coord 또는 doc · heading')
        targets.push({ doc: String(doc).replace(/^docs\/|\.md$/g, ''), heading, cols: it.cols.map(String), rows: it.rows.map((r) => r.map((c) => String(c ?? ''))) })
      }
      const srcDecl = { name: source, rules: [{ rule: 'outside', into: { doc: targets[0]?.doc || '' } }] }
      const plan = await planRun(k, srcDecl, { outside: targets.map((t) => ({ key: t.heading, cols: t.cols, rows: t.rows, doc: t.doc })) }, { asof: asof || new Date().toISOString().slice(0, 16).replace('T', ' ') })
      // 줄의 상태(내 PC 폴더 · 바깥 생성기) — 받은 때 · 마지막 변화
      const mark = async (n) => {
        const st = await readSourceState(dataDir, id)
        const s0 = (st[source] ||= {})
        const now = new Date().toISOString()
        Object.assign(s0, { checkedAt: now, host: String(host || '').slice(0, 60), failures: 0, lastNote: n ? `바뀐 표 ${n}` : '그대로', ...(n ? { lastChange: { at: now, files: files || 0, tables: n } } : {}) })
        await writeSourceState(dataDir, id, st)
      }
      if (!plan.changed.length) { await mark(0); return { changed: 0 } }
      await mark(plan.changed.length)
      await coreSave(meta.dir, { record: { title: `가져옴 — ${source} · 바뀐 표 ${plan.changed.length}`, body: plan.changed.map((c) => `- ${c.doc} › ${c.heading}`).join('\n'), tags: ['sources'] }, sections: plan.changed.map((c) => ({ doc: c.doc, heading: c.heading, content: c.content, applied: c.applied })) }, { user: 'kmd-auto', system: true })
      cache.delete(id)
      return { changed: plan.changed.length }
    },

    // ── 정리(KM81 — 검사를 넘으면 승인 없이 바로) ──
    // 일감은 서버가 낸다(정해진 시간 · [지금 정리]). 일꾼은 일감마다 받은 초안 전용 단기 열쇠로 재료를 받고 초안만 올린다
    tidyAtOf: (id) => rowFor(id)?.tidyAt || config.tidyAt || '02:30',
    // 팀 지식의 정리 방식 — time 정해진 시각(기본) · live 실시간(기록이 남고 조용해진 뒤) · manual 손으로만([지금 정리])
    tidyModeOf: (id) => rowFor(id)?.tidyMode || 'time',
    teamPrivate: (id) => mode === 'team' && !!rowFor(id)?.private,
    pendText(id) {
      if (mode === 'pc' || hub.teamPrivate(id)) return 'kmd 가 곧바로 문서에 넣는다'
      const m = hub.tidyModeOf(id)
      if (m === 'live') return '조용해지면 바로 문서에 들어간다'
      if (m === 'manual') return '정리하는 사람이 [지금 정리] 를 누를 때 문서에 들어간다'
      return `정해진 시각 ${hub.tidyAtOf(id)} 정리 때 문서에 들어간다`
    },
    ruleOnly: (id) => mode === 'team' && !rowFor(id)?.private && (!!rowFor(id)?.noClaude || workerRests()),
    liveSoon(id) {
      clearTimeout(liveTimers.get(id))
      const t = setTimeout(() => { liveTimers.delete(id); if (hub.tidyModeOf(id) === 'live') hub.tidyNow({ user: 'kmd', admin: true }, id, { by: 'kmd', auto: true }).catch(() => {}) }, config.liveQuietMs ?? 5 * 60_000)
      t.unref?.()
      liveTimers.set(id, t)
    },
    async tidyNow(ctx, id, { by = ctx.user, auto = false } = {}) {
      await hub.meta(id, auto && ctx.user === 'kmd' ? undefined : ctx)
      sweepJobs()
      const cur = [...jobs.values()].find((j) => j.kn === id && (j.state === 'queued' || j.state === 'running'))
      // 팀 서버의 개인 지식 — PC 일꾼을 기다리는 일감이 있는데 사람이 [지금 정리] 를 누르면 기다리지 않고 규칙으로
      if (cur && !auto && cur.state === 'queued' && hub.teamPrivate(id)) {
        clearTimeout(privTimers.get(id))
        privTimers.delete(id)
        Object.assign(cur, { state: 'failed', why: 'PC 일꾼 대신 규칙으로 넣었다', done: new Date().toISOString() })
        saveJobs()
        return hub.ruleJob(id, { by, why: 'PC 일꾼을 기다리지 않고 규칙으로 넣었다' })
      }
      if (cur) return cur
      // 규칙으로만 — 일꾼에게 내지 않고 서버가 넣는다(넣은 것이 없으면 「정리한 것」 카드를 남기지 않는다)
      if (hub.ruleOnly(id)) return hub.ruleJob(id, { by, auto, why: rowFor(id)?.noClaude ? '자동 정리에 Claude 를 쓰지 않는 지식 — 규칙으로 넣었다' : '정리 일꾼이 쉬고 있어 규칙으로 넣었다' })
      const j = { id: crypto.randomBytes(6).toString('hex'), kn: id, by, auto, at: new Date().toISOString(), state: 'queued' }
      jobs.set(j.id, j)
      saveJobs()
      return j
    },
    // 규칙 일감 — 곧바로 돌고(running) 끝나면 done · 넣은 수
    ruleJob(id, { by = 'kmd', auto = true, why = null } = {}) {
      const j = { id: crypto.randomBytes(6).toString('hex'), kn: id, by, auto, at: new Date().toISOString(), state: 'running', rule: true, why }
      jobs.set(j.id, j)
      hub.curateRules(id).then((r) => Object.assign(j, { state: 'done', done: new Date().toISOString(), summary: { put: r?.n || 0, changed: 0, left: 0 } }), (e) => Object.assign(j, { state: 'failed', why: e.message, done: new Date().toISOString() })).finally(saveJobs)
      return j
    },
    job: (jid) => (sweepJobs(), jobs.get(jid) || null),
    jobsOf: (id) => (sweepJobs(), [...jobs.values()].filter((j) => j.kn === id)),
    // 정리 일꾼(팀)을 마지막으로 본 때 · 기다리는 정리 — 멈춤 줄 · 관리 화면
    pcWorkerSeen: async (user) => (await seenOf())[user] || null,
    workerSeen: () => ({ at: teamSeenAt ? new Date(teamSeenAt).toISOString() : null, queued: [...jobs.values()].filter((j) => j.state === 'queued' && !rowFor(j.kn)?.private) }),
    // 일꾼 — 다음 일감 하나 + 그 일감 · 그 지식에만 쓰는 단기 열쇠(30분 · 한 일감)
    workerNext(wctx) {
      const own = wctx.worker.owner || null
      if (own) {
        const now = new Date().toISOString()
        seenOf().then((m) => { if (!m[own] || Date.parse(now) - Date.parse(m[own]) > 60_000) { m[own] = now; return fs.writeFile(seenFile, JSON.stringify(m)) } }).catch(() => {})
      }
      if (!own) teamSeenAt = Date.now()
      sweepJobs()
      const mine = (j) => { const row = rowFor(j.kn); return own ? !!row?.private && row.owner === own : !row?.private }
      const j = [...jobs.values()].find((x) => x.state === 'queued' && mine(x))
      if (!j) return null
      // 개인 지식 — 받았으니 「하루 뒤 규칙으로」 시계는 걷는다(다음 일감에 다시 건다)
      clearTimeout(privTimers.get(j.kn))
      privTimers.delete(j.kn)
      j.state = 'running'
      j.worker = wctx.worker.id
      j.started = new Date().toISOString()
      j.leaseUntil = Date.now() + JOB_LEASE
      saveJobs()
      const key = 'kmdd_' + crypto.randomBytes(24).toString('base64url')
      drafts.set(sha(key), { job: j.id, kn: j.kn, owner: own, exp: Date.now() + 30 * 60_000 })
      return { job: { id: j.id, kn: j.kn }, key }
    },
    draftCtx(token) {
      const d = drafts.get(sha(token))
      if (!d || d.exp < Date.now()) return null
      const j = jobs.get(d.job)
      if (j && j.state !== 'running') return null // 임대가 끝나 다시 기다림이 된 일감 — 옛 일꾼의 초안은 받지 않는다
      d.exp = Math.max(d.exp, Date.now() + 30 * 60_000)
      if (j) j.leaseUntil = Date.now() + JOB_LEASE
      return { user: 'kmd-worker', admin: false, draft: d, token }
    },
    async material(dctx, id) {
      if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const row = rowFor(id)
      // 나가기 전에 막는다 — 「Claude 에 보내지 않음」 · 남의 개인 지식은 주인이 켠 것만
      if (row?.noClaude) throw new KmdError('E_FORBIDDEN', '이 지식은 Claude 에 보내지 않는다')
      // 개인 지식은 그 사람의 PC 일꾼(그 사람의 Claude)만 — 팀의 정리 전용 로그인으로는 나가지 않는다
      if (row?.private ? dctx.draft.owner !== row.owner : dctx.draft.owner) throw new KmdError('E_FORBIDDEN', '개인 지식은 그 사람의 PC 일꾼만 정리한다')
      const k = await hub.get(id)
      const idx = await hub.index(id)
      const learned = await loadLearned(dataDir, id)
      const cands = []
      const groups = material(k, { candidates: (w) => cands.find((c) => c.id === w.id)?.list || [] })
      // 이름 없는 기록의 후보 이름 — 찾기 사다리(제목 + 글)
      for (const g of groups.filter((x) => x.kind === 'touches')) {
        const r = await ladder(k, idx, { q: `${g.record.title} ${g.record.body}`.slice(0, 300), learned, max: 8 })
        g.candidates = [...r.exact, ...r.coords].filter((c) => c.coord).slice(0, 8).map((c) => ({ coord: c.coord, name: c.name }))
      }
      return { kn: id, groups }
    },
    async drafts(dctx, id, list) {
      if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const j = jobs.get(dctx.draft.job)
      const meta = await hub.meta(id)
      const rows = []
      for (const item of Array.isArray(list) ? list : []) {
        cache.delete(id)
        const k = await hub.get(id)
        // 묶음은 일꾼이 보낸 것을 믿지 않고 지금 지식에서 다시 만든다(열쇠를 빼앗겨도 재료 · 근거를 바꾸지 못하게)
        const g = await groupFor(k, id, item.group)
        const d = item.draft
        if (!g) {
          rows.push({ kind: 'left', target: String(item.group?.heading || item.group?.record?.title || ''), why: '그사이 넣을 것이 없어졌다', records: [] })
          continue
        }
        const r = item.error ? { ok: false, why: item.error === 'login' ? '정리 전용 로그인이 끝났다' : item.error === 'limit' ? '사용 한도에 닿았다' : '초안을 받지 못했다' } : checkDraft(k, g, d)
        const target = g.kind === 'touches' || g.kind === 'ingest' ? g.record.title : `${g.doc.replace(/^docs\/|\.md$/g, '')} › ${g.heading}`
        // 원본이 주인인 문서에는 정리도 넣지 않는다 — 기록은 문서 옆에 그대로 읽힌다
        if (g.doc && watchedOf(await fs.readFile(path.join(meta.dir, ...g.doc.split('/')), 'utf8').catch(() => ''))) {
          rows.push({ kind: 'left', target, why: '원본이 주인인 문서 — 원본 파일을 고친다 · 기록은 옆에 그대로 읽힌다', records: (g.records || [g.record]).map((x) => x.id) })
          continue
        }
        const recs = g.kind === 'touches' || g.kind === 'ingest' ? [g.record] : g.records
        if (!r.ok) {
          rows.push({ kind: 'left', target, why: r.why, records: recs.map((x) => x.id) })
          continue
        }
        // 되돌림이 잦은 문서는 7일 동안 값 바뀜을 넣지 않는다
        if (r.changed.length && g.doc && (await recentReverts(id, g.doc)) >= 2) {
          rows.push({ kind: 'left', target, why: '이 문서는 되돌림이 잦아 값이 바뀌는 것은 7일 동안 넣지 않는다', records: recs.map((x) => x.id) })
          continue
        }
        try {
          const saved = await coreSave(meta.dir, planSave(k, g, d, { model: item.model }), { user: 'kmd-auto', system: true })
          const used = g.kind === 'touches' ? [] : g.kind === 'ingest' ? [g.record] : g.records.filter((x) => d.used.includes(x.id))
          // 넣은 파일 — 「문서 열기」 는 새 문서 또는 처음 고친 항목으로
          const at = g.kind === 'ingest' ? (d.newDoc ? { doc: String(d.newDoc.path).replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '').trim(), heading: d.newDoc.sections[0]?.heading } : { doc: String(d.updates[0].doc).replace(/^docs\/|\.md$/g, ''), heading: d.updates[0].heading }) : g.doc ? { doc: g.doc.replace(/^docs\/|\.md$/g, ''), heading: g.heading } : null
          rows.push({ kind: g.kind === 'touches' ? 'touches' : r.changed.length ? 'changed' : 'put', target, record: saved.id, from: r.changed[0]?.from, to: r.changed[0]?.to, records: used.map((x) => x.id), left: (d.left || []).map((x) => x.id) })
          // 그 기록을 쓴 사람의 「오늘 바뀐 것」 — 값이 바뀌었으면 노랑
          for (const u of [...new Set(used.map((x) => x.author))]) {
            await feed.add(dataDir, u, r.changed.length
              ? { kind: 'tidy', rec: saved.id, kn: id, yl: true, b: `kmd 가 정리하며 값을 바꿨다 — ${meta.name} › ${target} · ${r.changed[0].from} → ${r.changed[0].to}`, small: '내 기록에서 — 되돌릴 수 있다', go: { kn: id, doc: at.doc, hl: at.heading }, revert: saved.id }
              : { kind: 'tidy', rec: saved.id, kn: id, dot: 'acc', text: g.kind === 'ingest' ? `kmd 가 넣은 파일을 문서에 들였다 — ${meta.name} › ${at.doc}` : `kmd 가 정리했다 — ${meta.name} › ${target}`, small: g.kind === 'ingest' ? `${d.newDoc ? '새 문서' : '기존 문서에'} · ${g.record.title.split(' — ')[0]}` : '내가 남긴 기록', go: { kn: id, doc: at.doc, hl: at.heading } })
          }
        } catch (e) {
          rows.push({ kind: 'left', target, why: e.message, records: recs.map((x) => x.id) })
        }
      }
      cache.delete(id)
      const run = { at: new Date().toISOString(), by: j?.by || null, auto: !!j?.auto, rows }
      if (rows.length) await saveRun(id, run) // 빈 정리는 「정리한 것」 카드를 남기지 않는다
      if (j) {
        const stop = (Array.isArray(list) ? list : []).filter((x) => x.error === 'login' || x.error === 'limit')
        const allStop = rows.length > 0 && stop.length === rows.length
        j.state = allStop ? 'failed' : 'done'
        j.done = run.at
        if (allStop) j.why = stop[0].error === 'login' ? '정리 전용 로그인이 끝났다 — 관리 › Claude 연결' : '사용 한도에 닿았다 — 풀리면 이어서 한다'
        j.summary = { put: rows.filter((x) => x.kind === 'put' || x.kind === 'touches').length, changed: rows.filter((x) => x.kind === 'changed').length, left: rows.filter((x) => x.kind === 'left').length }
        saveJobs()
      }
      drafts.delete(sha(dctx.token || ''))
      if (hub.teamPrivate(id)) hub.curateRules(id).catch(() => {})
      // 이 PC — 일꾼은 이름만 고른다. 걸린 항목이 없는 코드 바뀜 기록은 Claude Code 가 문서에 들인다(codeToDoc)
      cache.delete(id)
      if (mode === 'pc' && hub.agentOk(id) && (await hub.get(id)).works.some((w) => w.state === 'nowhere' && w.tags.includes('code-change') && !codeFresh(w.id))) hub.curateSoon(id).catch(() => {})
      if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return { rows, summary: j?.summary || null }
    },
    async workerStatus(wctx, { ok = true, reason = null, message = null } = {}) {
      if (wctx.worker.owner) {
        for (const j of jobs.values()) {
          if (j.state !== 'running' || j.worker !== wctx.worker.id || ok) continue
          Object.assign(j, { state: 'failed', why: 'PC 일꾼의 Claude 가 쉬어 규칙으로 넣었다', done: new Date().toISOString() })
          hub.curateRules(j.kn).catch(() => {})
        }
        saveJobs()
        return { ok, reason }
      }
      const prev = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => ({}))
      const next = ok ? { ok: true, at: new Date().toISOString() } : { ok: false, reason, message: String(message || '').slice(0, 200), since: prev.ok === false ? prev.since : new Date().toISOString(), at: new Date().toISOString() }
      await fs.mkdir(dataDir, { recursive: true })
      await fs.writeFile(path.join(dataDir, 'worker.json'), JSON.stringify(next))
      wsNow = next
      for (const j of jobs.values()) if (j.state === 'running' && j.worker === wctx.worker.id && !ok) Object.assign(j, { state: 'failed', why: reason === 'limit' ? '사용 한도에 닿았다' : '정리 전용 로그인이 끝났다', done: new Date().toISOString() })
      saveJobs()
      return next
    },
    async runs(id) {
      return fs.readFile(path.join(dataDir, 'tidy', `${encodeURIComponent(id)}.json`), 'utf8').then(JSON.parse, () => [])
    },
    // 새 기기가 이어졌다 — 그 사람의 오늘 바뀐 것 · 다음 대화 첫 안내(다른 대역에서 받은 표면 노랑)
    async notifyDevice(user, dev) {
      await feed.add(dataDir, user, { kind: 'device', brief: true, yl: !!dev.yellow, dot: 'acc', text: `새 기기가 이어졌다 — ${dev.host || '이름 없는 기기'} · ${user}`, small: '설치 한 줄로 · 내가 한 것이 아니면 [보기] 에서 끊는다', device: dev.id })
    },
    async today(ctx) {
      return feed.list(dataDir, ctx.user)
    },
    // 이력 — 오늘 바뀐 것(사람마다 · 7일 · 알아야 할 것 · git 밖의 일)과 지식의 이력(kmd 가 다룬 일 · git)을 한 흐름으로.
    //   같은 일은 한 줄 — 가져오기 · 바로 고침은 지식의 이력 줄로(누구에게나 같다) · 정리는 내 줄로(되돌리기가 있다)
    //   예전 줄(갈래 없음)은 글로 가른다
    async history(ctx) {
      const mine = await feed.list(dataDir, ctx.user)
      const rows = []
      const logs = []
      const names = {}
      const kById = {}
      for (const m of await hub.visible(ctx)) {
        const k = await hub.get(m.id)
        kById[k.id] = k
        names[k.id] = k.name
        for (const w of k.logs.slice(0, 300)) logs.push({ k, w })
      }
      const logIds = new Set(logs.map((x) => x.w.id))
      const kindOf = (x) => x.kind || (x.revert || /^kmd 가 정리/.test(x.text || '') ? 'tidy' : /^새 기기/.test(x.text || '') ? 'device' : /^(지식을 |되살렸다)/.test(x.text || '') ? 'kn' : /보냈다|옮겼다/.test(x.text || '') ? 'send' : /^파일 /.test(x.text || '') ? 'import' : /에서 (바뀐 표|새 묶음)/.test(x.text || '') ? 'source' : 'save')
      const FEED_KIND = { save: '저장', import: '가져오기', source: '가져오기', tidy: '정리', send: '보내기', kn: '지식', device: '지식' }
      const taken = new Set()
      for (const x of mine) {
        const kind = kindOf(x)
        if (kind === 'source') continue // 지식의 이력 「가져옴」 이 같은 일
        if (kind === 'save' && (x.rec ? logIds.has(x.rec) : /「화면에서 고침/.test(x.text || ''))) continue // 바로 고침 — 이력 줄이 같은 일
        if (x.rec && logIds.has(x.rec)) taken.add(x.rec)
        const w = kind === 'save' && x.rec && kById[x.kn]?.byWork.get(x.rec)
        const sub = !w ? x.small || '' : w.state === 'pend' ? hub.pendText(x.kn) : w.state === 'nowhere' ? '넣을 곳을 찾는 중 — 정리하는 사람이 고른다' : '문서에 들어갔다'
        rows.push({ id: `f:${x.id}`, at: x.at, kind: FEED_KIND[kind], kn: x.kn || null, title: x.b || x.text, sub, who: kind === 'tidy' ? 'kmd' : kind === 'device' ? '' : ctx.user, yl: !!x.yl, revert: x.revert || null, device: x.device || null, go: x.go || null, rec: x.rec || null })
      }
      for (const { k, w } of logs) {
        if (taken.has(w.id)) continue
        rows.push({ id: `l:${k.id}:${w.id}`, at: isoOfStamp(w.date), kind: logKind(w), kn: k.id, title: w.title, sub: w.body.replace(/\s+/g, ' ').slice(0, 200), who: w.author, rec: w.id })
      }
      for (const r of rows) r.knName = r.kn ? names[r.kn] || r.kn : ''
      rows.sort((a, b) => String(b.at).localeCompare(String(a.at)))
      return rows.slice(0, 600)
    },
    async notices(ctx) {
      return feed.takeNotices(dataDir, ctx.user)
    },

    // ── 파일 · 폴더 넣기(KM82 — 한 번 들여온다) ──
    // ── 이 PC — 정리가 따로 없다: 「아직 안 넣은 기록」 은 남는 즉시 문서에 ──
    //   Claude(claude -p · 정리와 같은 프롬프트 · 같은 검사)로 다듬어 넣고, 로그인 없음 · 한도 · 검사 실패 · Claude 끔이면 규칙으로:
    //   항목이 정해진 기록 → 그 항목 끝에 글을 붙인다 · 이름 없는 기록(넣은 파일 · 세션 메모) → 이어지는 문서 또는 새 문서(규칙이면 새 문서)
    //   어느 쪽이든 그 기록은 「넣음」(reflects) · 넣은 일은 이력에 · 지식마다 한 줄로(저장은 바로 돌려주고 뒤에서)
    // role — 그 일의 모델(core/models.js · 설정 › Claude 모델)
    async askClaude(id, prompt, schema, { budget = 0.5, timeoutMs, role = 'tidy' } = {}) {
      if (mode !== 'pc') return { why: 'PC 일꾼이 받지 못했다' }
      if (!hub.meaningOk(id)) return { why: 'Claude 를 쓰지 않는다' }
      const r = await runClaude({ prompt, schema, budget, model: hub.modelOf(role), ...(timeoutMs ? { timeoutMs } : {}) })
      if (r.error) {
        if (r.error === 'login' || r.error === 'limit') await hub.workerStatus({ worker: { id: null } }, { ok: false, reason: r.error, message: r.message })
        return { why: r.error === 'login' ? 'Claude 로그인이 없다 — 머리의 「Claude」 에서 로그인' : r.error === 'limit' ? 'Claude 사용 한도' : 'Claude 가 답하지 않았다' }
      }
      await hub.workerStatus({ worker: { id: null } }, { ok: true })
      return { value: r.value, model: r.model }
    },
    // ── 에이전트로 지식 세우기 · 터미널(요구 v0.2 R6 · R8) ──
    //   일(run) 하나 = 파일 하나를 들이는 일 — 줄(터미널) · 상태 · 넣은 문서. 지식마다 최근 30 · 서버를 다시 켜면 비운다(이력은 log/)
    newRun(id, { title, file = null, by = null, quiet = false }) {
      const run = { id: crypto.randomBytes(6).toString('hex'), kn: id, title, file, by, quiet, state: 'wait', startedAt: new Date().toISOString(), endedAt: null, lines: [], docs: [], names: 0, msg: '' }
      runs.set(run.id, run)
      const mine = [...runs.values()].filter((r) => r.kn === id)
      for (const r of mine.slice(0, Math.max(0, mine.length - 30))) runs.delete(r.id)
      return run
    },
    runLine(run, k, x) {
      run.lines.push({ t: Date.now() - Date.parse(run.startedAt), k, x: String(x).slice(0, 4000) })
      if (run.lines.length > 2000) run.lines.splice(0, run.lines.length - 2000)
    },
    // 끝난 일은 지식마다 파일로(<살림>/runs/<지식>.json · 최근 30 · 줄은 400 까지) — 다시 켜도 「최근 넣은 것」 · 터미널이 남는다
    runSave(run) {
      const mine = [...runs.values()].filter((r) => r.kn === run.kn && r.endedAt).slice(-30).map((r) => ({ ...r, lines: r.lines.slice(-400) }))
      const f = path.join(dataDir, 'runs', `${encodeURIComponent(run.kn)}.json`)
      fs.mkdir(path.dirname(f), { recursive: true }).then(() => fs.writeFile(f, JSON.stringify(mine))).catch(() => {})
    },
    // 있는 지식의 일만 — 지운 지식의 파일이 남아 있어도 싣지 않는다(줄 없는 지식으로 누구에게나 보이지 않게)
    async runLoad() {
      const dir = path.join(dataDir, 'runs')
      const ids = new Set((await hub.list().catch(() => [])).map((k) => k.id))
      for (const n of await fs.readdir(dir).catch(() => [])) for (const r of await fs.readFile(path.join(dir, n), 'utf8').then(JSON.parse, () => [])) if (r?.id && ids.has(r.kn) && !runs.has(r.id)) runs.set(r.id, r)
    },
    runOk(r, ctx) {
      return (!list || list.some((k) => k.id === r.kn)) && visibleTo(r.kn, ctx)
    },
    runList(ctx, kn = null) {
      return [...runs.values()].filter((r) => (!kn || r.kn === kn) && hub.runOk(r, ctx)).reverse().slice(0, 40).map(({ lines, ...r }) => ({ ...r, n: lines.length }))
    },
    // 지금 하는 일 — 가져오기(지켜보며 맞추기) · Claude Code 일(넣은 파일 · 코드 바뀜) · 정리 일감 · 바로 넣기 · 전체 다시 맞추기.
    //   왼쪽 위 「kmd」 의 점멸 점과 작은 팝업이 읽는다(가볍게 — 메모리만)
    async busy(ctx) {
      const ks = new Map((await hub.visible(ctx)).map((k) => [k.id, k.name]))
      const nm = (id) => ks.get(id)
      const out = []
      for (const b of srcBusy.values()) if (nm(b.kn)) out.push({ kind: 'source', kn: b.kn, knName: nm(b.kn), name: b.name, title: `${b.name} 가져오는 중${b.full ? ' — 전체 다시 맞추기' : ''}`, small: { git: '소스 코드', db: 'DB', docs: '문서 폴더', folder: '폴더' }[b.kind] || b.kind, since: b.since })
      for (const r of runs.values()) if ((r.state === 'wait' || r.state === 'run') && nm(r.kn) && hub.runOk(r, ctx)) out.push({ kind: 'run', kn: r.kn, knName: nm(r.kn), title: r.title, small: r.state === 'wait' ? '차례를 기다린다' : `Claude Code 가 들이는 중 · 줄 ${r.lines.length}`, since: r.startedAt, run: r.id })
      for (const j of jobs.values()) if ((j.state === 'queued' || j.state === 'running') && nm(j.kn)) out.push({ kind: 'tidy', kn: j.kn, knName: nm(j.kn), title: '정리', small: j.state === 'queued' ? '정리 일꾼을 기다린다' : '정리하는 중', since: j.at })
      // 바로 넣기 — 차례를 기다리는 기록 수(코드 바뀜은 Claude Code 가 하나씩 넣어 몇 분씩 걸린다)
      for (const [id, since] of curating) {
        if (!nm(id)) continue
        const wait = (await hub.get(id)).works.filter((w) => (w.state === 'pend' || w.state === 'nowhere') && !queuedRecs.has(w.id)).length
        out.push({ kind: 'curate', kn: id, knName: nm(id), title: '기록을 문서에 넣는 중', small: wait ? `차례를 기다리는 기록 ${wait}` : '마무리하는 중', since })
      }
      return { items: out.sort((a, b) => String(a.since).localeCompare(String(b.since))) }
    },
    runGet(ctx, rid, from = 0) {
      const r = runs.get(rid)
      if (!r || !hub.runOk(r, ctx)) throw new KmdError('E_NOTFOUND', '그 일은 이제 없다')
      const { lines, ...rest } = r
      return { ...rest, n: lines.length, lines: lines.slice(Math.max(0, from)) }
    },
    // 단기 열쇠(kmda_) — 그 지식 · 그 일에만 · MCP 길만 · 일이 끝나면 지운다(늦어도 40분)
    agentToken(kn, rec, run) {
      const token = 'kmda_' + crypto.randomBytes(24).toString('base64url')
      agentKeys.set(token, { kn, rec, run, exp: Date.now() + 40 * 60_000 })
      return token
    },
    agentCtx(token) {
      const a = agentKeys.get(token)
      if (!a || a.exp < Date.now()) return null
      return { user: 'kmd-auto', agent: { kn: a.kn, rec: a.rec, run: a.run } }
    },
    agentOk(id) {
      return mode === 'pc' && agentAvailable() && hub.meaningOk(id) && !!hub.selfUrl
    },
    // pdf · hwp → md — 바꾼 글 보관(<살림>/convert/<sha>.md)이 있으면 그것 · 없고 run 이 있으면 Claude Code 가 원본을 읽어 옮긴다
    async mdOf(rel, data, run = null) {
      const sha = crypto.createHash('sha256').update(data).digest('hex')
      const f = path.join(dataDir, 'convert', `${sha}.md`)
      const have = await fs.readFile(f, 'utf8').catch(() => null)
      if (have) return have
      if (!run) return null
      const name = rel.split('/').pop()
      hub.runLine(run, 'sys', `${name} — 글로 바꾼다(Claude Code 가 원본을 읽는다)`)
      const r = await runAgent({
        prompt: [`일 폴더의 「원본/${name}」 을 Read 로 끝까지 읽고(쪽이 많으면 나눠 읽는다) 글 그대로 md 로 옮긴다.`, '- 머리 · 표 · 목록 짜임을 살린다(표는 md 표). 수 · 날짜 · 이름은 그대로. 요약하지 않는다.', '- 쪽 번호 · 머리글 · 바닥글 · 표지 장식은 뺀다. 그림은 [그림: 무엇] 한 줄로.', '- 마지막 답에는 md 글만 쓴다(설명 · 머리말 없이).'].join('\n'),
        files: [{ name: `원본/${name}`, data }],
        budget: 3,
        model: hub.modelOf('convert'),
        onLine: (l) => hub.runLine(run, l.k, l.x),
      })
      if (!r.ok || !r.text.trim()) return null
      const md = r.text.replace(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```\s*$/m, '$1').trim()
      await fs.mkdir(path.dirname(f), { recursive: true })
      await fs.writeFile(f, md + '\n', 'utf8')
      hub.runLine(run, 'ok', `글로 바꿨다 — ${md.split('\n').length}줄`)
      return md
    },
    // 들인 기록 하나를 에이전트로 — 세션처럼 둘러보고 · 이름을 맞추고 · 항목에 넣고 · 이름을 세운다.
    //   끝나도 그 기록이 아직 「안 넣음」 이면 규칙으로(ingestNow · Claude 없이) — 까닭은 터미널 · 이력에
    async ingestAgent(id, recId, run, { original = null } = {}) {
      const meta = await hub.meta(id)
      cache.delete(id)
      const k = await hub.get(id)
      const w = k.byWork.get(recId)
      if (!w || (w.state !== 'pend' && w.state !== 'nowhere')) { run.state = 'done'; run.msg = '이미 넣은 기록이다'; return { doc: null } }
      const name = hub.ingestFileOf(w).split('/').pop()
      run.state = 'run'
      hub.runLine(run, 'sys', `${meta.name} 에 들인다 — 기록 ${w.id}`)
      const token = hub.agentToken(id, w.id, run.id)
      let r
      try {
        r = await runAgent({ ...(await hub.agentTask(meta, w, original)), mcp: { url: `${hub.selfUrl}/mcp`, token }, budget: 3, model: hub.modelOf('agent'), onLine: (l) => hub.runLine(run, l.k, l.x) })
      } finally {
        agentKeys.delete(token)
      }
      cache.delete(id)
      const k2 = await hub.get(id)
      const w2 = k2.byWork.get(w.id)
      if (r.ok && w2 && w2.state !== 'pend' && w2.state !== 'nowhere') {
        run.state = 'done'
        run.msg = `문서에 넣었다 — ${run.docs.join(' · ') || meta.name}${run.names ? ` · 이름 ${run.names}` : ''}`
        if (r.error === 'login' || r.error === 'limit') await hub.workerStatus({ worker: { id: null } }, { ok: false, reason: r.error, message: r.message })
        else await hub.workerStatus({ worker: { id: null } }, { ok: true })
        if (!run.quiet) feed.add(dataDir, w.author, { kind: 'tidy', kn: id, dot: 'acc', text: `kmd 가 넣은 파일을 문서에 들였다 — ${meta.name} › ${run.docs[0] || ''}`, small: `${name} · Claude Code 로`, ...(run.docs[0] ? { go: { kn: id, doc: run.docs[0] } } : {}) }).catch(() => {})
        return { doc: run.docs[0] || null, how: 'agent', msg: run.msg }
      }
      if (r.error === 'login' || r.error === 'limit') await hub.workerStatus({ worker: { id: null } }, { ok: false, reason: r.error, message: r.message })
      const why = r.ok ? 'Claude Code 가 이 기록을 문서에 넣지 않았다' : r.error === 'login' ? 'Claude 로그인이 없다 — 머리의 「Claude」 에서 로그인' : r.error === 'limit' ? 'Claude 한도 · 예산' : 'Claude Code 가 끝을 내지 못했다'
      hub.runLine(run, 'sys', `규칙으로 넣는다 — ${why}`)
      const got = await hub.ingestNow(id, w.id, { claude: false, why })
      run.state = got.doc ? 'rule' : 'fail'
      run.msg = got.doc ? `규칙으로 넣었다 — ${got.doc} · ${why}` : `넣지 못했다 — ${got.why || why}`
      if (got.doc) run.docs.push(got.doc)
      return got
    },
    // 코드 바뀜 기록 하나를 문서로 — Claude Code(에이전트)가 지식을 둘러보고 그 저장소가 만드는 시스템의 기능 · 설계 문서에
    //   넣는다(바뀐 기능의 항목을 지금 동작으로 고치거나 새 항목). 커밋마다 새 문서를 세우지 않는다. 에이전트가 없으면 기록으로 둔다
    async codeToDoc(id, w) {
      if (!hub.agentOk(id) || codeFresh(w.id) || queuedRecs.has(w.id)) return false
      codeTried.set(w.id, Date.now())
      queuedRecs.add(w.id)
      const run = hub.newRun(id, { title: w.title.split(' — ')[0], file: hub.ingestFileOf(w), by: w.author, quiet: true })
      try {
        await hub.ingestAgent(id, w.id, run)
      } catch (e) {
        run.state = 'fail'
        run.msg = e.message
        hub.runLine(run, 'err', e.message)
      } finally {
        queuedRecs.delete(w.id)
        run.endedAt = new Date().toISOString()
        hub.runSave(run)
        cache.delete(id)
      }
      return run.state === 'done'
    },
    ingestFileOf(w) {
      const tag = w.tags.find((t) => t.startsWith('ingest/'))
      return tag ? tag.slice(7) : `${w.title.split(' — ')[0]}.md`
    },
    // 넣은 파일의 기록을 Claude 가 읽고 사람이 읽을 기록으로 — 무엇 · 핵심 · 정한 것 · 남은 것 + 본문(원문 짜임 그대로).
    //   기록은 그 자체로 지식이고 나중에 문서를 다시 세우는 재료다 — 받은 글(html 태그만 뺀 글 따위)을 그대로 두지 않는다.
    //   같은 기록(id)을 고쳐 쓰고 태그 ingest-read 를 단다(두 번 하지 않는다) · Claude 가 없거나 답이 틀리면 받은 글 그대로
    async polishRecord(id, recId, run = null) {
      const meta = await hub.meta(id)
      cache.delete(id)
      const w = (await hub.get(id)).byWork.get(recId)
      if (!w || !w.tags.some((t) => t.startsWith('ingest/')) || w.tags.includes('ingest-read')) return { ok: false, why: '정리할 넣은 파일 기록이 아니다' }
      const file = hub.ingestFileOf(w)
      if (run) hub.runLine(run, 'sys', `${file.split('/').pop()} — Claude 가 읽고 기록을 정리한다(무엇 · 핵심 · 정한 것 · 남은 것 + 본문)`)
      const src = { file, author: w.author, date: w.date, md: w.body }
      const prompt = filePrompt(src)
      // 분석은 살림 자리에 남긴다(<살림>/convert/<지문>.read.json) — 쓰기가 넘어져 다시 해도 Claude 를 또 부르지 않는다
      const keep = path.join(dataDir, 'convert', `${crypto.createHash('sha256').update(prompt).digest('hex')}.read.json`)
      let a = await fs.readFile(keep, 'utf8').then((t) => ({ value: JSON.parse(t) }), () => null)
      if (!a) {
        a = await hub.askClaude(id, prompt, FILE_SCHEMA, { budget: 2, timeoutMs: 600_000, role: 'read' })
        if (a.value) await fs.mkdir(path.dirname(keep), { recursive: true }).then(() => fs.writeFile(keep, JSON.stringify(a.value))).catch(() => {})
      }
      const rec = fileRecord(src, a.value)
      if (!rec) {
        if (run) hub.runLine(run, 'err', `기록은 받은 글 그대로 둔다 — ${a.why || 'Claude 의 답이 기록 모양이 아니었다'}`)
        return { ok: false, why: a.why || 'Claude 의 답이 기록 모양이 아니었다' }
      }
      await serial(path.resolve(meta.dir), async () => {
        // 옆 임시 파일에 쓰고 이름을 바꾼다 — 감시 · 백신이 기록 파일을 잡고 있으면(EBUSY · EPERM) 잠깐 기다려 다시
        const f = path.join(meta.dir, ...w.path.split('/'))
        const tmp = `${f}.${process.pid}.tmp`
        await fs.writeFile(tmp, renderRecord({ ...w, title: rec.title, tags: [...w.tags, 'ingest-read'] }, rec.body), 'utf8')
        for (let i = 0; ; i++) {
          try { await fs.rename(tmp, f); break } catch (e) {
            if (i >= 12 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { await fs.rm(tmp, { force: true }).catch(() => {}); throw e }
            await new Promise((ok) => setTimeout(ok, 100 * (i + 1)))
          }
        }
        await commitPaths(meta.dir, [w.path], `기록 정리 — ${rec.title}`, 'kmd-auto')
      })
      cache.delete(id)
      if (run) hub.runLine(run, 'ok', `기록을 정리했다 — 「${rec.title}」`)
      return { ok: true, title: rec.title }
    },
    // 화면의 [Claude 로 기록 정리] — 이 PC · 바로 넣을 수 있는 사람만
    async readRecord(ctx, id, recId) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '기록 정리는 내 PC 프로그램이 내 Claude 로 한다')
      await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '이 지식에 바로 넣을 수 없다')
      const r = await hub.queueRun(id, () => hub.polishRecord(id, String(recId || '')))
      if (!r.ok) throw new KmdError('E_INPUT', `기록을 정리하지 못했다 — ${r.why}`)
      return r
    },
    // 새 커밋 하나 — Claude 가 차이를 읽고 무엇이 왜 바뀌었는지 쓴 기록으로(안 되면 null · 차이 그대로)
    async analyzeCommit(id, srcName, c, diffs, rec) {
      const a = await hub.askClaude(id, commitPrompt({ src: srcName, c, diffs, names: rec.touches || [] }), COMMIT_SCHEMA, { budget: 1, timeoutMs: 300_000, role: 'commit' })
      return a.value ? commitAnalyzed(rec, a.value, { src: srcName, c }) : null
    },
    // 에이전트에게 줄 일 — 일 설명 · 스킬(kmd-build) · 일 폴더 파일(바꾼 글 · 원본). 이 PC 와 팀 정리 일꾼이 같은 것을 쓴다
    async agentTask(meta, w, original = null) {
      const file = hub.ingestFileOf(w)
      const name = file.split('/').pop()
      const mdName = name.replace(/\.[^.]+$/, '') + '.md'
      const skill = await fs.readFile(path.join(AGENT_DIR, 'skills', 'kmd-build', 'SKILL.md'), 'utf8').catch(() => '')
      // 코드 바뀜 — 파일이 아니라 커밋 하나의 분석 기록이다. 자리는 그 저장소가 만드는 시스템의 기능 · 설계 문서
      if (w.tags.includes('code-change')) {
        const src = (w.title.match(/ — (\S+) [0-9a-f]{7}(?:\.\.[0-9a-f]+)?$/) || [])[1] || '그 저장소'
        return {
          prompt: [
            `지식 「${meta.name}」(knowledge id: ${meta.id}) 에 소스 코드 커밋 하나의 기록을 들인다 — kmd-build 순서대로, 다만 넣은 파일이 아니라 코드 바뀜이다.`,
            `- 기록: 「${mdName}」(일 폴더) — Claude 가 커밋 차이를 읽고 쓴 분석(무엇이 바뀌었나 · 바뀐 것 · 영향 · 문서에서 맞춰 볼 것) · 끝에 커밋 메시지와 차이(근거)`,
            `- 저장소: ${src} · 기록 id: ${w.id} — save 하면 kmd 가 이 기록을 「넣음」 으로 단다`,
            `- 자리: ${src} 가 만드는 시스템의 기능 · 설계 문서. brief 로 둘러보고 그 시스템을 다루는 문서가 있으면 거기에 — 바뀐 기능의 항목이 있으면 section 으로 읽고 base 와 함께 지금 동작으로 고치고, 없으면 그 기능 이름으로 새 항목을 더한다.`,
            `  그런 문서가 없을 때만 「${src} 기능」 처럼 시스템 이름의 새 문서 하나를 세운다. 커밋 · 판 · 날짜로 문서나 항목을 세우지 않는다.`,
            '- 항목 글은 바뀐 이력 나열이 아니라 「지금 어떻게 동작하나」 로 쓴다 — 기능 · 화면 · API · 설정 · 데이터. 차이 · 분석에 없는 것은 지어내지 않는다. 코드 줄 · 차이는 항목에 옮기지 않는다.',
            '- 이 지식의 다른 주제(이 저장소와 상관없는 문서)는 고치지 않는다.',
            '도구의 knowledge 는 늘 위 id 를 쓴다.',
          ].join('\n'),
          system: skill.replace(/^---[\s\S]*?---\s*/, ''),
          files: [{ name: mdName, data: Buffer.from(w.body.replace(/^# .*\n+/, ''), 'utf8') }],
        }
      }
      return {
        prompt: [`지식 「${meta.name}」(knowledge id: ${meta.id}) 에 넣은 파일 하나를 들인다 — kmd-build 순서대로.`, `- 바꾼 글: 「${mdName}」(일 폴더)${original ? ` · 원본: 「원본/${name}」` : ''}`, `- 파일 이름: ${file}`, `- 넣은 사람: ${w.author} · ${w.date}`, `- 이 파일의 기록 id: ${w.id} — save 하면 kmd 가 이 기록을 「넣음」 으로 단다(따로 적지 않아도 된다)`, '도구의 knowledge 는 늘 위 id 를 쓴다.'].join('\n'),
        system: skill.replace(/^---[\s\S]*?---\s*/, ''),
        files: [{ name: mdName, data: Buffer.from(w.body.replace(/^# .*\n+/, ''), 'utf8') }, ...(original ? [{ name: `원본/${name}`, data: original }] : [])],
      }
    },
    // 팀 정리 일꾼(kmd worker)의 에이전트 — 일감 열쇠(kmdd_)로 넣은 파일 하나의 일을 받고 · 줄을 올리고 · 끝을 알린다(요구 v0.2 F)
    //   팀 서버는 Claude 를 부르지 않는다 — 일꾼이 그 PC 에서 Claude Code 를 띄우고 MCP 는 이 서버(단기 열쇠 kmda_ · 그 지식 · 그 기록만)
    async workerAgent(dctx, id, { rec }) {
      if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const row = rowFor(id)
      if (row?.noClaude) throw new KmdError('E_FORBIDDEN', '이 지식은 Claude 에 보내지 않는다')
      if (row?.private ? dctx.draft.owner !== row.owner : dctx.draft.owner) throw new KmdError('E_FORBIDDEN', '개인 지식은 그 사람의 PC 일꾼만 정리한다')
      const meta = await hub.meta(id)
      cache.delete(id)
      const w = (await hub.get(id)).byWork.get(String(rec || ''))
      if (!w || w.state !== 'pend' || !w.tags.some((t) => t.startsWith('ingest/'))) throw new KmdError('E_NOTFOUND', '들일 넣은 파일 기록이 없다')
      const run = hub.newRun(id, { title: hub.ingestFileOf(w).split('/').pop(), file: hub.ingestFileOf(w), by: w.author })
      run.state = 'run'
      hub.runLine(run, 'sys', `정리 일꾼이 ${meta.name} 에 들인다 — 기록 ${w.id}`)
      const task = await hub.agentTask(meta, w)
      return { run: run.id, token: hub.agentToken(id, w.id, run.id), prompt: task.prompt, system: task.system, files: task.files.map((f) => ({ name: f.name, b64: f.data.toString('base64') })) }
    },
    workerAgentLog(dctx, id, { run: rid, lines }) {
      const run = runs.get(String(rid || ''))
      if (!run || run.kn !== id || dctx.draft.kn !== id) throw new KmdError('E_NOTFOUND', '그 일은 없다')
      for (const l of (Array.isArray(lines) ? lines : []).slice(0, 500)) hub.runLine(run, ['say', 'tool', 'ok', 'err', 'sys', 'cost'].includes(l?.k) ? l.k : 'sys', String(l?.x ?? ''))
      return { n: run.lines.length }
    },
    async workerAgentDone(dctx, id, { run: rid, ok = false, why = null }) {
      const run = runs.get(String(rid || ''))
      if (!run || run.kn !== id || dctx.draft.kn !== id) throw new KmdError('E_NOTFOUND', '그 일은 없다')
      for (const [t, a] of agentKeys) if (a.run === run.id) agentKeys.delete(t)
      cache.delete(id)
      // 넣었나 — 에이전트의 save 가 이 일에 문서를 남겼다(그 save 가 기록을 「넣음」 으로 달았다)
      const placed = !!ok && run.docs.length > 0
      run.state = placed ? 'done' : 'fail'
      run.msg = placed ? `문서에 넣었다 — ${run.docs.join(' · ')}${run.names ? ` · 이름 ${run.names}` : ''}` : `에이전트가 넣지 못했다 — ${String(why || '정리 초안으로 다시 한다').slice(0, 200)}`
      run.endedAt = new Date().toISOString()
      hub.runSave(run)
      if (placed) {
        const meta = await hub.meta(id)
        if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      }
      return { placed }
    },
    // 일감 줄 — 지식마다 한 줄로(정리 줄과 같은 줄 · 동시에 같은 지식을 고치지 않게)
    queueRun(id, f) {
      const job = (curateRuns.get(id) || Promise.resolve()).catch(() => {}).then(f)
      curateRuns.set(id, job)
      return job
    },
    // 파일 하나 — 앞일(pdf · hwp 면 글로 바꿔 기록부터 · 기록 정리) → 들이기(에이전트 · 안 되면 규칙)
    async ingestFileRun(ctx, id, args) {
      const p = await hub.ingestPrep(ctx, id, args)
      if (p) await hub.ingestPlace(ctx, id, p)
    },
    // 뒤에서 — 앞일은 PREP_MAX 개씩 함께 · 들이기는 앞일이 끝난 차례로 지식마다 한 줄(queueRun)
    ingestFileLater(ctx, id, args) {
      const job = prepSlot(() => hub.ingestPrep(ctx, id, args)).then((p) => p && hub.queueRun(id, () => hub.ingestPlace(ctx, id, p)))
      const mine = preps.get(id) || preps.set(id, new Set()).get(id)
      mine.add(job)
      return job.finally(() => mine.delete(job))
    },
    // 앞일 — 들일 것이 남으면 { rel, data, recId, run } · 끝났으면(못 바꿈 · 같은 파일 · 넘어짐) null
    async ingestPrep(ctx, id, { rel, data = null, recId = null, run }) {
      const meta = await hub.meta(id)
      try {
        if (!recId && data) {
          const md = await hub.mdOf(rel, data, run)
          if (!md) {
            run.state = 'fail'
            run.msg = '글로 바꾸지 못했다 — 원본은 첨부로 두었다'
            await coreSave(meta.dir, { record: { title: `글로 바꾸지 못한 파일 — ${rel.split('/').pop()}`, body: `원본은 첨부로 두었다 — docs/assets/${rel}\n- 까닭: ${hub.agentOk(id) ? 'Claude Code 가 글로 옮기지 못했다' : 'Claude 를 쓰지 않는다(로그인 · 「Claude 에 보내지 않음」)'}\n- 다시: 지식 만들기 › 파일 넣기에 같은 파일을 다시 넣는다`, tags: ['curate-auto'] } }, { user: 'kmd-auto', system: true })
            hub.ingestEnd(id, run, null, meta)
            return null
          }
          const plan = await planImport(await hub.get(id), [{ path: rel, data }], { direct: true, asRecord: true, mdOf: async () => md, read: (r2) => fs.readFile(path.join(meta.dir, r2)).catch(() => null) })
          const rec = plan.records[0]
          if (!rec) {
            run.state = 'done'
            run.msg = '같은 파일 — 그대로 두었다'
            hub.ingestEnd(id, run, null, meta)
            return null
          }
          recId = (await hub.save(ctx, id, { record: rec }, { noCurate: true })).id
          queuedRecs.add(recId) // 들이기 차례를 기다리는 동안 정리 줄이 따로 집지 않게
          run.rec = recId
          hub.runLine(run, 'ok', `기록이 됐다 — ${recId}`)
        }
        await hub.polishRecord(id, recId, run).catch((e) => hub.runLine(run, 'err', `기록 정리 — ${e.message}`))
        return { rel, data, recId, run }
      } catch (e) {
        run.state = 'fail'
        run.msg = e.message
        hub.runLine(run, 'err', e.message)
        hub.ingestEnd(id, run, recId, meta)
        return null
      }
    },
    // 들이기 — 에이전트(없으면 규칙 · Claude 한 번)
    async ingestPlace(ctx, id, { rel, data, recId, run }) {
      const meta = await hub.meta(id)
      try {
        if (!hub.agentOk(id)) {
          const got = await hub.ingestNow(id, recId)
          run.state = got.doc ? (got.how === 'claude' ? 'done' : 'rule') : 'fail'
          run.msg = got.msg || got.why || ''
          if (got.doc) run.docs.push(got.doc)
          hub.runLine(run, got.doc ? 'ok' : 'err', run.msg)
          return
        }
        await hub.ingestAgent(id, recId, run, { original: data && PCONLY.includes(rel.split('.').pop().toLowerCase()) ? data : null })
      } catch (e) {
        run.state = 'fail'
        run.msg = e.message
        hub.runLine(run, 'err', e.message)
      } finally {
        hub.ingestEnd(id, run, recId, meta)
      }
    },
    ingestEnd(id, run, recId, meta) {
      if (recId) queuedRecs.delete(recId)
      run.endedAt = new Date().toISOString()
      hub.runSave(run)
      cache.delete(id)
      if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
    },
    // 이름 없는 기록 하나(넣은 파일 · 세션 메모)를 문서로 — 이어지는 문서의 항목에 넣거나 새 문서
    async ingestNow(id, recId, { claude = true, why: why0 = null } = {}) {
      const meta = await hub.meta(id)
      cache.delete(id)
      const k = await hub.get(id)
      const w = k.byWork.get(recId)
      if (!w || (w.state !== 'pend' && w.state !== 'nowhere') || w.touches.length) return { why: '들일 기록이 없다' }
      if (w.tags.includes('code-change')) return { why: '코드 바뀜은 기록으로 둔다 — 걸린 항목 글은 정리가 맞춘다' }
      const tag = w.tags.find((t) => t.startsWith('ingest/'))
      const file = tag ? tag.slice(7) : `${w.title.split(' — ')[0].replace(/[\\/<>:"|?*\u0000-\u001f]/g, '').trim() || '메모'}.md`
      const g = { kind: 'ingest', record: { id: w.id, date: w.date, author: w.author, title: w.title, body: w.body, file }, docs: ingestCandidates(k, w) }
      let why = why0 || 'Claude 를 쓰지 않는다'
      if (claude) {
        const a = await hub.askClaude(id, tidyPrompt(g), INGEST_SCHEMA)
        why = a.why || null
        if (a.value) {
          const c = checkDraft(k, g, a.value)
          if (c.ok) {
            await coreSave(meta.dir, planSave(k, g, a.value, { model: a.model }), { user: 'kmd-auto', system: true })
            cache.delete(id)
            const d = a.value
            const doc = d.newDoc ? String(d.newDoc.path).replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '').trim() : String(d.updates[0].doc).replace(/^docs\/|\.md$/g, '')
            return { doc, how: 'claude', msg: `기록 · 문서가 됐다 — ${meta.name} › ${doc.split('/').join(' › ')}${d.newDoc ? ' (새 문서)' : ' (기존 문서에 넣음)'} · Claude 로 다듬었다` }
          }
          why = `검사를 넘지 못했다 — ${c.why}`
        }
      }
      const rule = ingestRule(k, g, { why })
      if (!rule) return { why: '빈 기록이다' }
      await coreSave(meta.dir, rule.input, { user: 'kmd-auto', system: true })
      cache.delete(id)
      return { doc: rule.doc, how: 'rule', msg: `기록 · 문서가 됐다 — ${meta.name} › ${rule.doc.split('/').join(' › ')} (규칙으로 ${rule.note}${why ? ' · ' + why : ''})` }
    },
    // 묶음 하나 넣기 — 항목(section) · 이름 고르기(touches) · 이름 없는 기록(ingest) · 넣었으면 true
    async placeGroup(id, g) {
      const meta = await hub.meta(id)
      if (g.kind === 'ingest' && (importing.has(id) || queuedRecs.has(g.record.id))) return false // 넣는 일이 맡았다
      if (g.kind === 'ingest' && hub.agentOk(id) && g.record.file) {
        const run = hub.newRun(id, { title: g.record.file.split('/').pop(), file: g.record.file, by: g.record.author })
        await hub.ingestFileRun({ user: g.record.author }, id, { rel: g.record.file, recId: g.record.id, run })
        return run.state === 'done' || run.state === 'rule'
      }
      if (g.kind === 'ingest') return !!(await hub.ingestNow(id, g.record.id)).doc
      const k = await hub.get(id)
      if (g.kind === 'touches') {
        // 이름 고르기 — 고르면 다음 차례에 그 항목으로 · 못 고르면 이어지는 문서 · 새 문서로
        if (hub.meaningOk(id)) {
          const r = await ladder(k, await hub.index(id), { q: `${g.record.title} ${g.record.body}`.slice(0, 300), learned: await loadLearned(dataDir, id), max: 8 })
          g.candidates = [...r.exact, ...r.coords].filter((c) => c.coord).slice(0, 8).map((c) => ({ coord: c.coord, name: c.name }))
          if (g.candidates.length) {
            const a = await hub.askClaude(id, tidyPrompt(g), TOUCH_SCHEMA, { role: 'touch' })
            if (a.value && checkDraft(k, g, a.value).ok && a.value.touches.length) {
              await coreSave(meta.dir, planSave(k, g, a.value, { model: a.model }), { user: 'kmd-auto', system: true })
              cache.delete(id)
              return true
            }
          }
        }
        // 코드 바뀜 기록 — 걸린 항목이 없으면 Claude Code 가 그 저장소의 기능 · 설계 문서에 들인다(규칙으로는 문서를 세우지 않는다)
        const w0 = k.byWork.get(g.record.id)
        if (w0?.tags.includes('code-change')) return hub.codeToDoc(id, w0)
        return !!(await hub.ingestNow(id, g.record.id)).doc
      }
      // 항목 — 원본이 주인인 문서에는 넣지 않는다
      if (watchedOf(await fs.readFile(path.join(meta.dir, ...g.doc.split('/')), 'utf8').catch(() => ''))) return false
      const target = `${g.doc.replace(/^docs\/|\.md$/g, '')} › ${g.heading}`
      const a = await hub.askClaude(id, tidyPrompt(g), DRAFT_SCHEMA)
      let why = a.why || null
      if (a.value) {
        const c = checkDraft(k, g, a.value)
        if (c.ok) {
          const saved = await coreSave(meta.dir, planSave(k, g, a.value, { model: a.model }), { user: 'kmd-auto', system: true })
          cache.delete(id)
          const used = g.records.filter((x) => a.value.used.includes(x.id))
          for (const u of [...new Set(used.map((x) => x.author))])
            await feed.add(dataDir, u, c.changed.length
              ? { kind: 'tidy', rec: saved.id, kn: id, yl: true, b: `kmd 가 문서에 넣으며 값을 바꿨다 — ${meta.name} › ${target} · ${c.changed[0].from} → ${c.changed[0].to}`, small: '내 기록에서 — 되돌릴 수 있다', go: { kn: id, doc: g.doc.replace(/^docs\/|\.md$/g, ''), hl: g.heading }, revert: saved.id }
              : { kind: 'tidy', rec: saved.id, kn: id, dot: 'acc', text: `kmd 가 문서에 넣었다 — ${meta.name} › ${target}`, small: '내가 남긴 기록', go: { kn: id, doc: g.doc.replace(/^docs\/|\.md$/g, ''), hl: g.heading } })
          // 넣지 않고 둔 기록(left)이 있으면 다음 차례에 규칙으로
          return true
        }
        why = `검사를 넘지 못했다 — ${c.why}`
      }
      // 규칙 — 기록 글을 항목 끝에 붙인다(머리 줄은 굵은 글로 · 표지는 뺀다)
      const add = g.records.map((r) => r.body.replace(/<!--[\s\S]*?-->/g, '').replace(/^#{1,6}\s+(.+)$/gm, '**$1**').trim()).filter(Boolean).join('\n\n')
      const content = [g.content.trim(), add].filter(Boolean).join('\n\n')
      await coreSave(meta.dir, { record: { title: `정리 — ${g.name}`, body: ['규칙으로 — 기록 글을 항목 끝에 붙였다', ...g.records.map((r) => `- 넣음 ${r.id} — ${r.title}`), ...(why ? [`- Claude 로 하지 못한 까닭 — ${why}`] : [])].join('\n'), touches: [g.coord], tags: ['curate-auto'], reflects: g.records.map((r) => r.id) }, sections: [{ coord: g.coord, content, base: g.base }] }, { user: 'kmd-auto', system: true })
      cache.delete(id)
      return true
    },
    // 그 지식의 「아직 안 넣은 기록」 모두 — 이름을 고른 기록은 다음 차례에 그 항목으로(세 차례까지)
    async curatePending(id) {
      if (mode !== 'pc' && !hub.teamPrivate(id) && !hub.ruleOnly(id)) return { n: 0 }
      let n = 0
      curating.set(id, new Date().toISOString())
      try {
        for (let round = 0; round < 3; round++) {
          cache.delete(id)
          const k = await hub.get(id)
          const groups = material(k)
          let did = 0
          for (const g of groups) if (await hub.placeGroup(id, g).catch((e) => (log(`바로 넣기 ${id}: ${e.message}`), false))) did++
          n += did
          if (!did) break
        }
      } finally {
        curating.delete(id)
      }
      if (n) {
        const meta = await hub.meta(id)
        if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      }
      return { n }
    },
    // 저장 뒤 — 지식마다 한 줄로 뒤에서(저장은 기다리지 않는다) · 시험은 curateIdle 로 기다린다
    // 팀 서버의 개인 지식 — 주인의 PC 일꾼(그 사람의 Claude)에 일감을 건다. PC 일꾼을 7일 안에 본 적이 없거나(브라우저만 쓴다) ·
    //   Claude 에 보내지 않는 지식이면 곧바로 규칙으로 · 일감을 privateWaitMs(기본 하루) 안에 받지 않으면(PC 가 꺼져 있다) 규칙으로
    curateSoon(id) {
      if (mode !== 'pc' && !hub.teamPrivate(id)) return Promise.resolve()
      const run = (curateRuns.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
        if (mode === 'pc') return hub.curatePending(id)
        const owner = rowFor(id)?.owner
        const last = (await seenOf())[owner]
        if (!owner || !hub.meaningOk(id) || !last || Date.now() - Date.parse(last) > 7 * 24 * 3600_000) return hub.curatePending(id)
        const j = await hub.tidyNow({ user: 'kmd', admin: true }, id, { by: 'kmd', auto: true })
        if (!privTimers.has(id) && j.state === 'queued') {
          const t = setTimeout(() => {
            privTimers.delete(id)
            if (j.state !== 'queued') return
            Object.assign(j, { state: 'failed', why: 'PC 일꾼이 받지 않았다', done: new Date().toISOString() })
            saveJobs()
            hub.curateRules(id).catch(() => {})
          }, config.privateWaitMs ?? 24 * 3600_000)
          t.unref?.()
          privTimers.set(id, t)
        }
        return { job: j.id }
      })
      curateRuns.set(id, run)
      return run
    },
    // 규칙으로만 — 지식마다 한 줄
    curateRules(id) {
      const run = (curateRuns.get(id) || Promise.resolve()).catch(() => {}).then(() => hub.curatePending(id))
      curateRuns.set(id, run)
      return run
    },
    // 앞일(파일을 글로 · 기록 정리)과 줄이 모두 빌 때까지
    async curateIdle(id) {
      for (;;) {
        await Promise.allSettled([...(preps.get(id) || [])])
        await (curateRuns.get(id) || Promise.resolve()).catch(() => {})
        if (!preps.get(id)?.size) return
      }
    },
    // asDocs — 옛 폴더로 지식을 세울 때(지식 추가)만 바로 문서 · 그 밖은 기록으로 들이고 정리가 문서에 넣는다
    async importFiles(ctx, id, files, { asDocs = false } = {}) {
      const meta = await hub.meta(id, ctx)
      const shut = backup.closed(meta)
      if (shut) throw new KmdError('E_BEHIND', shut.message)
      const k = await hub.get(id)
      const direct = hub.canDirect(ctx, id)
      const plan = await planImport(k, files, { direct, asRecord: !asDocs, convert: hub.autoOf(ctx.user, 'file'), mdOf: mode === 'pc' ? (rel, data) => hub.mdOf(rel, data) : null, read: (rel) => fs.readFile(path.join(meta.dir, rel)).catch(() => null) })
      if (plan.docs.length || plan.atts.length) {
        await serial(path.resolve(meta.dir), async () => {
          await ensureRepo(meta.dir)
          const paths = []
          const put = async (rel, data) => {
            const full = path.join(meta.dir, rel)
            if (!path.resolve(full).startsWith(path.resolve(meta.dir) + path.sep) || owners.isReservedFile(rel)) return false
            await fs.mkdir(path.dirname(full), { recursive: true })
            await fs.writeFile(full, data)
            paths.push(rel)
            return true
          }
          // 대원칙 — 지식은 기록 → 문서. 옛 폴더로 세울 때도 파일마다 기록 하나(글 그대로)를 먼저 남기고,
          // 그 문서의 항목에 그 기록을 표지로 단다 · 이력 하나가 그 기록들을 넣었다고 적는다(reflects — 「문서에 들어감」)
          const docs = plan.docs.filter((d) => !owners.isReservedFile(d.rel))
          let title = `파일 넣기 — ${ctx.user} · ${docs.length + plan.atts.length}`
          if (docs.length) {
            const date = localStamp()
            const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
            const taken = new Set()
            const idOf = (base) => {
              let x = base
              for (let n = 2; taken.has(x) || recordTakenSync(meta.dir, x); n++) x = `${base}-${n}`
              taken.add(x)
              return x
            }
            const ids = []
            const stamped = []
            for (const d of docs) {
              const file = d.rel.replace(/^docs\//, '')
              const rid = idOf(`${day}-${(file.split('/').pop().replace(/\.md$/, '').replace(/[\\/:*?"<>|#%`'\s]+/g, '-').slice(0, 40).replace(/^-+|[-.]+$/g, '') || '문서')}`)
              if (!(await put(`work/${rid}.md`, renderRecord({ id: rid, title: `${file.split('/').pop()} — 들여온 문서 · ${meta.name}`, date, author: ctx.user, tags: [] }, d.text)))) continue
              ids.push(rid)
              stamped.push({ rel: d.rel, data: Buffer.from(stampAll(d.text, rid), 'utf8') })
            }
            title = `들여옴 — 옛 폴더 · 문서 ${ids.length}${plan.atts.length ? ' · 첨부 ' + plan.atts.length : ''}`
            const lid = idOf(`${day}-옛-폴더-들여옴`)
            await put(`log/${lid}.md`, renderRecord({ id: lid, title, date, author: ctx.user, tags: ['sources'], reflects: ids }, ids.map((x) => `- ${x}`).slice(0, 300).join('\n')))
            for (const x of stamped) await put(x.rel, x.data)
          }
          for (const x of plan.atts) await put(x.rel, x.data)
          if (paths.length) await commitPaths(meta.dir, paths, title, ctx.user)
        })
        cache.delete(id)
      }
      // 기록 줄에 그 기록 id — 화면의 [보기] 가 연다
      // 이 PC — 정리가 따로 없다: 넣으면 기록과 문서가 바로(Claude 로 다듬어 · 안 되면 규칙으로 파일 그대로 새 문서) · 팀은 정리가 넣는다
      const now = mode === 'pc' && direct
      const recRows = plan.rows.filter((x) => x.kind === 'record')
      const agent = now && !asDocs && hub.agentOk(id)
      if (agent) importing.add(id)
      try {
      for (const [i, r] of plan.records.entries()) {
        let sv
        try {
          sv = await hub.save(ctx, id, { record: r }, { noCurate: now })
        } catch (e) {
          if (recRows[i]) Object.assign(recRows[i], { kind: 'fail', msg: `넣지 못했다 — ${e.message}` })
          continue
        }
        if (!recRows[i]) continue
        recRows[i].rec = sv.id
        if (agent && i < INGEST_CLAUDE_MAX) {
          const rel = r.tags[0].slice(7)
          const run = hub.newRun(id, { title: recRows[i].name.split('/').pop(), file: recRows[i].name, by: ctx.user, quiet: files.length > 1 })
          queuedRecs.add(sv.id)
          hub.ingestFileLater(ctx, id, { rel, recId: sv.id, run })
          Object.assign(recRows[i], { kind: 'run', run: run.id, msg: 'Claude Code 가 들이는 중 — 터미널에서 본다' })
          continue
        }
        if (now) {
          if (i < INGEST_CLAUDE_MAX) await hub.polishRecord(id, sv.id).catch(() => null)
          const got = await hub.ingestNow(id, sv.id, { claude: i < INGEST_CLAUDE_MAX }).catch((e) => ({ why: e.message }))
          if (got.doc) Object.assign(recRows[i], { kind: 'doc', doc: got.doc, msg: got.msg })
          else recRows[i].msg = `기록이 됐다 — 문서로 들이지 못했다 · ${got.why || ''}`
        }
      }
      } finally {
        importing.delete(id)
      }
      // pdf · hwp — 바꾼 글이 없으면 Claude Code 가 원본을 읽어 글로 바꾼 뒤 같은 길로(원본은 위에서 첨부로 두었다)
      if (agent && hub.autoOf(ctx.user, 'file')) for (const x of plan.rows.filter((r) => r.kind === 'fail' && PCONLY.includes(r.name.split('.').pop().toLowerCase()))) {
        const fd = files.find((y) => String(y.path || y.name).replace(/\\/g, '/').endsWith(x.name.split('/').pop()))
        if (!fd) continue
        const run = hub.newRun(id, { title: x.name.split('/').pop(), file: x.name, by: ctx.user })
        hub.ingestFileLater(ctx, id, { rel: x.name, data: fd.data, run })
        Object.assign(x, { kind: 'run', run: run.id, msg: 'Claude Code 가 글로 바꿔 들이는 중 — 터미널에서 본다 · 원본은 첨부로' })
      }
      const s = summary(plan.rows)
      // 이력 — 넣기 한 번이 한 줄(파일마다 줄을 쌓지 않는다) · 못 넣은 파일과 까닭도
      if (s.doc || s.record || s.run || s.fail || s.skip) feed.add(dataDir, ctx.user, { kind: 'import', kn: id, dot: s.fail ? 'warn' : 'acc', text: `파일 ${plan.rows.length}개를 넣었다 — ${meta.name}`, small: [s.doc ? `문서 ${s.doc}` : '', s.record ? `기록 ${s.record}` : '', s.run ? `Claude Code 일 ${s.run}` : '', s.att ? `첨부 ${s.att}` : '', s.fail ? `못 넣음 ${s.fail} — ${plan.rows.filter((x) => x.kind === 'fail').slice(0, 3).map((x) => `${x.name}: ${x.msg}`).join(' · ')}` : '', s.skip ? `읽지 못하는 종류 ${s.skip}` : ''].filter(Boolean).join(' · ') }).catch(() => {})
      // 넣은 파일의 기록 — 팀은 정리를 바로 건다(Claude 에 보내지 않는 지식이면 기록으로 기다린다) · 이 PC 는 위에서 이미 문서까지
      if (!now && s.record && hub.teamPrivate(id)) hub.curateSoon(id).catch(() => {})
      else if (!now && s.record && (hub.meaningOk(id) || hub.ruleOnly(id)) && hub.tidyModeOf(id) !== 'manual') hub.tidyNow({ user: 'kmd', admin: true }, id, { by: 'kmd', auto: true }).catch(() => {})
      if ((plan.docs.length || plan.atts.length) && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return { direct, summary: s, rows: plan.rows }
    },

    // ── 보내기(M10) — 보낼 곳 · 보낼 것 · 보내기 · 받기 ──
    async sendDests(ctx, id, dests) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '보낼 곳은 주인이 정한다')
      if (!Array.isArray(dests)) throw new KmdError('E_INPUT', '보낼 곳은 목록이다')
      dests.forEach(sendLib.checkDest)
      // 받는 쪽에 그 지식이 있나 — 같은 kmd 면 목록에서 · 다른 kmd 면 이 PC 의 열쇠로 그 팀의 지식 목록에서(닿지 않으면 받고 · 보낼 때 다시 본다)
      for (const d of dests) {
        if (!d.url) {
          if (d.kn === id) throw new KmdError('E_INPUT', '자기 자신으로는 보내지 않는다')
          if (!(await hub.list()).some((k) => k.id === d.kn)) throw new KmdError('E_INPUT', `「${d.kn}」 지식이 없다 — 다른 kmd(팀)의 지식이면 그 팀 › 지식으로 고른다`)
          continue
        }
        const t = await hub.teamKns(d.url).catch(() => null)
        if (t?.error === 401) throw new KmdError('E_INPUT', '이 PC 의 열쇠를 그 팀이 받지 않는다 — 팀 화면 › 설치 한 줄로 다시 잇는다')
        if (t?.kns && !t.kns.some((k) => k.id === d.kn)) throw new KmdError('E_INPUT', `그 팀에 「${d.kn}」 지식이 없다 — 팀 › 지식 목록에서 고른다`)
      }
      const conf = await sendLib.readConf(meta.dir)
      await serial(path.resolve(meta.dir), async () => {
        await ensureRepo(meta.dir)
        await fs.writeFile(path.join(meta.dir, sendLib.CONF), JSON.stringify({ ...conf, send: dests.map((d) => ({ kn: d.kn, ...(d.url ? { url: String(d.url).replace(/\/+$/, '') } : {}) })) }, null, 2) + '\n')
        await commitPaths(meta.dir, [sendLib.CONF], `보낼 곳 — ${dests.map((d) => d.kn).join(' · ') || '없음'}`, ctx.user).catch(() => {})
      })
      // 처음 정하면 지금 글 · 기록을 보낸 것으로 — 그 뒤 고친 문서 · 새 기록만 변경사항에 모인다
      // 대기 — 뺀 보낼 곳의 것은 걷고 · 주소를 바꾼 곳은 새 주소로
      const st = await sendLib.readState(dataDir, id)
      const nd = dests.map((d) => ({ kn: d.kn, ...(d.url ? { url: String(d.url).replace(/\/+$/, '') } : {}) }))
      st.wait = st.wait.filter((w) => nd.some((d) => d.kn === w.to.kn)).map((w) => ({ ...w, to: nd.find((d) => d.kn === w.to.kn) }))
      await sendLib.writeState(dataDir, id, { ...st, sent: Object.keys(st.sent).length ? st.sent : sendLib.baseline(await hub.get(id)), recSince: st.recSince || localStamp() })
      return sendLib.destsOf(meta.dir)
    },
    async teamKns(url) {
      const key = process.env.KMD_SEND_KEY || (await keystore.get(keystore.keyName(url)).catch(() => null))
      if (!key) return { error: 'nokey' } // 이 PC 에 그 팀의 열쇠가 없다 — 고를 때는 「잇지 않았다」 · 정할 때는 막지 않는다(보낼 때 다시 본다)
      const r = await fetch(`${url}/api/knowledge`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) })
      if (!r.ok) return { error: r.status }
      return { kns: (await r.json()).map((k) => ({ id: k.id, name: k.name, private: !!k.private })) }
    },
    // 보낼 곳 고르기 — 이 PC 가 이은 팀마다 그 팀의 지식(팀 지식 · 내 개인 지식)
    async sendTargets(ctx) {
      const teams = await fs.readFile(path.join(dataDir, 'teams.json'), 'utf8').then(JSON.parse, () => [])
      const out = []
      for (const u of teams) {
        const url = String(u).replace(/\/+$/, '')
        const t = await hub.teamKns(url).catch(() => ({ error: 'reach' }))
        out.push({ url, ...(t.kns ? { kns: t.kns } : { error: t.error === 401 ? '이 PC 의 열쇠를 그 팀이 받지 않는다 — 다시 잇는다' : t.error === 'nokey' ? '이 PC 가 그 팀에 이어지지 않았다 — 팀 화면 › 설치 한 줄' : '그 팀에 닿지 않는다' }) })
      }
      return { teams: out, local: mode === 'team' ? [] : (await hub.list()).map((k) => ({ id: k.id, name: k.name })) }
    },
    async sendQueue(ctx, id) {
      const meta = await hub.meta(id, ctx)
      const dests = await sendLib.destsOf(meta.dir)
      const st = await sendLib.readState(dataDir, id)
      const k = await hub.get(id)
      // 예전에 정한 보낼 곳 — 기록의 기준 시각이 없으면 지금부터(옛 기록이 한꺼번에 모이지 않게)
      if (dests.length && !st.recSince) await sendLib.writeState(dataDir, id, (st.recSince = localStamp(), st))
      // ① 변경사항(문서 · 기록) ② 지식(문서 · 기록 목록 — 골라서 전체로)
      const items = dests.length ? [...sendLib.queue(k, st), ...sendLib.recQueue(k, st)].sort((a, b) => String(b.when).localeCompare(String(a.when))) : []
      const docs = dests.length ? k.docs.map((d) => ({ path: d.path, id: d.id, title: d.title, when: d.mtime })) : []
      const recs = dests.length ? k.works.filter((w) => !w.tags.some((t) => t.startsWith('sent/'))).map((w) => ({ id: w.id, title: w.title, author: w.author, when: w.date })) : []
      return { dests, items, docs, recs, wait: st.wait.map((w) => ({ id: w.id, state: w.state, to: w.to.kn, url: w.to.url || null, n: w.payload.items.length, at: w.at, why: w.why, fix: w.fix || null })), log: st.log }
    },
    async sendDrop(ctx, id, { path: p, on }) {
      await hub.meta(id, ctx)
      const st = await sendLib.readState(dataDir, id)
      const q = sendLib.queue(await hub.get(id), st).find((x) => x.path === p)
      if (!q) throw new KmdError('E_NOTFOUND', '보낼 것에 없다')
      if (on) delete st.dropped[p]
      else st.dropped[p] = q.sha
      await sendLib.writeState(dataDir, id, st)
      return { ok: true }
    },
    // 보내기 — changes(변경사항의 key) · docs(문서 경로 — 전체) · recs(기록 id — 전체) · 셋 다 없으면 변경사항 모두(예전 길)
    async send(ctx, id, { extra = [], changes = null, docs = [], recs = [] } = {}) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '내 지식에서만 보낸다')
      const dests = await sendLib.destsOf(meta.dir)
      if (!dests.length) throw new KmdError('E_INPUT', '보낼 곳이 없다 — 지식 설정에서 정한다')
      const k = await hub.get(id)
      const st = await sendLib.readState(dataDir, id)
      const pick = Array.isArray(changes) ? new Set(changes.map(String)) : null
      // 지식에서 문서 전체를 고르면 그 문서의 변경사항(바뀐 항목만) 대신 전체로 간다
      const wholeDocs = [...new Set((Array.isArray(docs) ? docs : []).map(String))].map((p) => k.byDocPath.get(p)).filter(Boolean)
      const qs = sendLib.queue(k, st).filter((q) => (pick ? pick.has(q.key) : q.on) && !wholeDocs.some((d) => d.path === q.path))
      const rq = sendLib.recQueue(k, st).filter((q) => (pick ? pick.has(q.key) : true))
      const recIds = [...new Set([...rq.map((q) => q.id), ...(Array.isArray(recs) ? recs : []).map(String)])].filter((x) => k.works.some((w) => w.id === x))
      const items = [
        ...qs.map((q) => sendLib.itemOf(k, q)),
        ...wholeDocs.map((d) => sendLib.docItem(k, d)),
        ...recIds.map((x) => sendLib.recItem(k, k.byWork.get(x))),
        ...(Array.isArray(extra) ? extra : []).map((x) => ({ title: String(x.title || '').slice(0, 200), body: String(x.body || ''), sha: sha16(`${id}\n${x.title}\n${x.body}`) })),
      ]
      if (!items.length) return { sent: 0, wait: 0 }
      let sent = 0
      let wait = 0
      let fail = 0
      const why = []
      for (const d of dests) {
        for (const part of sendLib.chunks(items)) {
          const payload = { from: meta.name, items: part }
          try {
            await deliver(ctx, d, payload)
            sent += part.length
          } catch (e) {
            const w = waitOf(d, payload, e)
            st.wait.push(w)
            if (w.state === 'wait') wait += part.length
            else { fail += part.length; why.push(`${d.kn} — ${w.why}`) }
          }
        }
      }
      // 보낸 문서는 지금 글이 「보낸 것」 · 보낸 기록은 다시 모이지 않는다 — 모든 보낼 곳이 거절했으면 그대로 둔다(다시 고를 수 있게)
      if (sent || wait) {
        for (const p of [...qs.map((q) => q.path), ...wholeDocs.map((d) => d.path)]) {
          st.sent[p] = sendLib.marks(k.byDocPath.get(p))
          delete st.dropped[p]
        }
        for (const x of recIds) st.sentRecs[x] = true
      }
      st.log.unshift({ at: new Date().toISOString(), n: items.length, to: dests.map((d) => d.kn), wait: !!wait, ...(fail ? { fail } : {}), titles: items.slice(0, 5).map((x) => x.title) })
      await sendLib.writeState(dataDir, id, st)
      if (sent) feed.add(dataDir, ctx.user, { kind: 'send', kn: id, dot: 'acc', text: `${sent}개를 보냈다 — ${dests.map((d) => d.kn).join(' · ')}`, small: '정리 때 문서에 들어간다' }).catch(() => {})
      return { sent, wait, ...(fail ? { fail, why } : {}) }
    },
    // 닿지 않아 둔 것 — 닿을 때 저절로(분마다) · 거절된 것(fail)은 사람이 [다시] · [버리기]
    async sendRetry() {
      let n = 0
      for (const m of await hub.list().catch(() => [])) {
        const st = await sendLib.readState(dataDir, m.id)
        if (!st.wait.some((w) => w.state === 'wait')) continue
        const left = []
        for (const w of st.wait) {
          if (w.state !== 'wait') { left.push(w); continue }
          try {
            await deliver({ user: pcUser || 'kmd', pc: mode === 'pc' }, w.to, w.payload)
            n += w.payload.items.length
            st.log.unshift({ at: new Date().toISOString(), n: w.payload.items.length, to: [w.to.kn], late: w.at })
          } catch (e) {
            left.push({ ...waitOf(w.to, w.payload, e), id: w.id, at: w.at })
          }
        }
        st.wait = left
        await sendLib.writeState(dataDir, m.id, st)
      }
      return n
    },
    // 대기 줄 하나 — [지금 다시](닿으면 보낸 것으로) · [버리기]
    async sendWaitAct(ctx, id, { wid, act }) {
      await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '내 지식에서만 보낸다')
      const st = await sendLib.readState(dataDir, id)
      const w = st.wait.find((x) => x.id === String(wid))
      if (!w) throw new KmdError('E_NOTFOUND', '그 줄은 이제 없다')
      if (act === 'drop') {
        st.wait = st.wait.filter((x) => x !== w)
        await sendLib.writeState(dataDir, id, st)
        return { dropped: w.payload.items.length }
      }
      if (act !== 'retry') throw new KmdError('E_INPUT', '다시 · 버리기 중 하나')
      try {
        await deliver(ctx, w.to, w.payload)
        st.wait = st.wait.filter((x) => x !== w)
        st.log.unshift({ at: new Date().toISOString(), n: w.payload.items.length, to: [w.to.kn], late: w.at })
        await sendLib.writeState(dataDir, id, st)
        return { sent: w.payload.items.length }
      } catch (e) {
        Object.assign(w, waitOf(w.to, w.payload, e), { id: w.id, at: w.at })
        await sendLib.writeState(dataDir, id, st)
        throw new KmdError('E_INPUT', `보내지 못했다 — ${w.why}${w.fix ? ' · ' + w.fix : ''}`)
      }
    },
    // 받기 — 기록 하나씩(같은 지문이면 0) · 이름은 이 지식의 장부에 정확히 맞는 것만
    async receive(ctx, id, { from = '', items = [] } = {}) {
      await hub.meta(id, ctx)
      if (!Array.isArray(items) || !items.length || items.length > 200) throw new KmdError('E_INPUT', '받을 것은 1 ~ 200 개')
      let saved = 0
      let same = 0
      for (const it of items) {
        const k = await hub.get(id)
        const sha = /^[0-9a-f]{16}$/.test(String(it.sha)) ? it.sha : sha16(`${it.title}\n${it.body}`)
        const tag = `sent/${sha}`
        if (k.works.some((w) => w.tags.includes(tag))) {
          same++
          continue
        }
        const heads = [...String(it.body || '').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
        const words = [...heads, ...String(it.title || '').split(/\s+—\s+/)]
        const touches = [...new Set(words.flatMap((w) => exact(k, w).map((x) => x.coord)).filter(Boolean))]
        await hub.save(ctx, id, { record: { title: String(it.title || '보낸 것').slice(0, 200), body: `${String(from).slice(0, 80)}에서 보냄\n\n${String(it.body || '')}`.trim(), touches, tags: [tag] } }, { later: true })
        saved++
      }
      const meta = await hub.meta(id)
      if (saved && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return { saved, same }
    },
    // 받은편지함 정리 — 같은 주인의 개인 지식으로만 옮긴다 · 팀 지식에 이름이 걸리면 보내기 후보 · private 은 그대로
    async inboxTidy(ctx, id, { dry = false } = {}) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '받은편지함은 주인이 정리한다')
      const owner = rowFor(id)?.owner || ctx.user
      const k = await hub.get(id)
      const f = path.join(dataDir, 'inbox', `${encodeURIComponent(id)}.json`)
      const st = await fs.readFile(f, 'utf8').then(JSON.parse, () => ({ moved: {} }))
      const others = (await hub.visible(ctx)).filter((m) => m.id !== id)
      const mine = others.filter((m) => mode === 'pc' || (rowFor(m.id)?.owner === owner && rowFor(m.id)?.private))
      const team = others.filter((m) => !mine.includes(m))
      const moved = []
      const candidates = []
      for (const w of k.works) {
        if (isSystemRecord(w) || w.tags.includes('private') || st.moved[w.id]) continue
        const words = [...w.touches.map((c) => labelOf(k, c)), ...w.title.split(/\s+—\s+/)].filter(Boolean)
        const hit = async (ms) => {
          for (const m of ms) {
            const k2 = await hub.get(m.id)
            const coords = [...new Set(words.flatMap((x) => exact(k2, x).map((y) => y.coord)).filter(Boolean))]
            if (coords.length) return { m, coords }
          }
          return null
        }
        const to = await hit(mine)
        if (to && dry) {
          moved.push({ record: w.id, title: w.title, to: to.m.id })
          continue
        }
        if (to) {
          await hub.save(ctx, to.m.id, { record: { title: w.title, body: `받은편지함에서 옮김\n\n${w.body}`.trim(), touches: to.coords, tags: w.tags.filter((t) => !t.startsWith('sent/')) } })
          st.moved[w.id] = to.m.id
          moved.push({ record: w.id, title: w.title, to: to.m.id })
          continue
        }
        const t2 = await hit(team)
        if (t2) candidates.push({ record: w.id, title: w.title, to: t2.m.id, name: labelOf(await hub.get(t2.m.id), t2.coords[0]) })
      }
      if (dry) return { moved, candidates }
      await fs.mkdir(path.dirname(f), { recursive: true })
      await fs.writeFile(f, JSON.stringify(st))
      if (moved.length) feed.add(dataDir, ctx.user, { kind: 'send', kn: id, dot: 'acc', text: `받은편지함 메모 ${moved.length}개를 옮겼다`, small: [...new Set(moved.map((x) => x.to))].join(' · ') }).catch(() => {})
      return { moved, candidates, left: k.works.filter((w) => !isSystemRecord(w) && !st.moved[w.id]).length - candidates.length }
    },
    // 받은편지함 메모 하나를 팀 지식으로(보내기 화면의 「보낼 것에 넣기」) — 같은 kmd 의 받기 길 · 다시 옮기지 않게 표시
    async inboxSend(ctx, id, { record, to }) {
      await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '받은편지함은 주인이 보낸다')
      const w = (await hub.get(id)).byWork.get(record)
      if (!w || w.tags.includes('private')) throw new KmdError('E_NOTFOUND', '보낼 메모가 없다')
      const r = await hub.receive(ctx, to, { from: '받은편지함', items: [{ title: w.title, body: w.body, sha: sha16(`${id}\n${w.id}`) }] })
      const f = path.join(dataDir, 'inbox', `${encodeURIComponent(id)}.json`)
      const st = await fs.readFile(f, 'utf8').then(JSON.parse, () => ({ moved: {} }))
      st.moved[w.id] = to
      await fs.mkdir(path.dirname(f), { recursive: true })
      await fs.writeFile(f, JSON.stringify(st))
      return r
    },

    // 멈춤 줄 — 그 사람이 보는 지식만
    async stops(ctx, id = null) {
      const ks = id ? [await hub.meta(id, ctx)] : await hub.visible(ctx)
      const out = []
      // 정리 일꾼이 쉬고 있다(로그인 끝 · 한도) — 관리자 · 정리하는 사람에게
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      const curates = ctx.admin || ks.some((k) => rowFor(k.id)?.curators?.includes(ctx.user) || rowFor(k.id)?.owner === ctx.user)
      if (ws && ws.ok === false && !id) {
        const d = (Date.now() - Date.parse(ws.since)) / 864e5
        out.push(stopLine({ kind: 'worker', level: 'warn', what: '자동 정리가 쉬고 있다', amount: d < 1 ? '오늘부터' : `${Math.round(d)}일`, fix: mode === 'pc' ? '설정 › Claude 연결에서 다시 로그인하면 이어서 한다 · 그동안은 규칙으로 넣는다' : ctx.admin ? '관리 › Claude 연결에서 다시 로그인하면 이어서 한다 · 그동안은 규칙으로 넣는다' : '그동안은 규칙으로 넣는다', told: ctx.admin ? null : curates ? '관리자에게 알렸다' : null }))
      }
      // 정리 일꾼이 일감을 받지 않는다 — 기다리는 팀 정리가 10분 넘었고 일꾼을 10분 넘게 못 봤다(설치 뒤 일꾼을 띄우지 않았다 · 일꾼이 멈췄다)
      if (mode === 'team' && curates && !id && !(ws && ws.ok === false)) {
        const w = hub.workerSeen()
        const old = w.queued.filter((j) => Date.now() - Date.parse(j.at) > 10 * 60_000)
        if (old.length && (!w.at || Date.now() - Date.parse(w.at) > 10 * 60_000)) out.push(stopLine({ kind: 'worker', level: 'warn', what: '정리 일꾼이 일감을 받지 않는다', amount: `기다리는 정리 ${old.length}`, fix: ctx.admin ? '서버에서 정리 일꾼을 띄운다 — 관리자 설명서 › Claude 연결' : null, told: ctx.admin ? (w.at ? `마지막으로 본 때 ${w.at.slice(5, 16).replace('T', ' ')}` : '한 번도 묻지 않았다') : '관리자에게 알렸다' }))
      }
      for (const k of ks) {
        out.push(...backup.lines(k, { name: k.name }))
        // 팀 서버의 내 개인 지식 — 내 PC 일꾼을 기다린다(PC 가 꺼져 있다)
        if (hub.teamPrivate(k.id) && rowFor(k.id)?.owner === ctx.user && [...jobs.values()].some((j) => j.kn === k.id && j.state === 'queued')) out.push(stopLine({ kind: 'tidy', kn: k.id, level: 'warn', what: `${k.name} — 내 PC 일꾼을 기다린다`, fix: 'PC 를 켜면 내 Claude 로 들어간다 · 기다리지 않으려면 정리에서 [지금 정리](규칙으로)' }))
        const all = (await sendLib.readState(dataDir, k.id)).wait
        const sw = all.filter((w) => w.state === 'wait')
        const sf = all.filter((w) => w.state !== 'wait')
        if (sw.length) out.push(stopLine({ kind: 'send', kn: k.id, level: 'warn', what: `${k.name} — 보낼 곳에 닿지 않는다`, amount: `${sw.reduce((a, w) => a + w.payload.items.length, 0)}개`, fix: '닿으면 저절로 보낸다', since: `${sw[0].at.slice(5, 10)} ${new Date(sw[0].at).toTimeString().slice(0, 5)} 에 누른 것` }))
        if (sf.length) out.push(stopLine({ kind: 'send', kn: k.id, level: 'warn', what: `${k.name} — 보내지 못했다(${sf[0].to.kn})`, amount: `${sf.reduce((a, w) => a + w.payload.items.length, 0)}개`, fix: sf[0].fix || '지식 보내기에서 [다시] · [버리기]', told: sf[0].why }))
        const decl = await readDecl(k.dir)
        if (decl.length) out.push(...sourceLines(k, decl, await readSourceState(dataDir, k.id), { admin: !!ctx.admin || mode === 'pc' }))
        if (!backup.attached(k)) {
          const u = await unbacked(k)
          if (u) out.push(stopLine({ kind: 'backup', kn: k.id, level: 'warn', what: `${k.name} — 백업 자리가 없다`, amount: `백업 안 된 저장 ${u.n}번`, fix: mode === 'pc' ? '설정 › 이 PC 에서 백업 자리를 정하면 저절로 붙고 그동안의 것을 모두 보낸다' : rowFor(k.id)?.private ? '관리자가 개인 지식 백업 자리(serve.json 의 privateBackup)를 정하면 저절로 붙는다' : '관리자가 백업 자리를 붙이면 그동안의 것을 모두 보낸다', since: `${u.since} 부터` }))
        }
      }
      return out
    },

    // 주인 · 개인 · 정리하는 사람 · 정리 설정 — 관리자 또는 지금 주인. `_members.md` 도 같이 바꿔 백업 · 되살림에 따라가게.
    // 주인이 바꾸는 것은 정리 설정과 정리하는 사람까지 — 「개인」 과 「주인」 은 관리자(· 셸)만(주인 혼자 팀 지식을 감추거나 넘기지 않게).
    // 권한은 잠금 안의 지금 줄로 다시 본다(관리자가 막 바꾼 것을 옛 줄로 되돌리지 않게). 셸(서버를 띄운 사람)은 가림을 건너뛴다 — 감춰진 지식을 되찾는 길
    async setOwner(ctx, id, row) {
      const meta = await hub.meta(id, ctx.shell ? null : ctx)
      // private 은 참 · 거짓으로만(문자열 'false' 가 지식을 가리지 않게)
      if (row?.private != null) row = { ...row, private: row.private === true || /^(true|1|yes|예)$/i.test(String(row.private)) }
      const allowed = (cur) => {
        const isOwner = !!(cur?.owner && cur.owner === ctx.user)
        if (!ctx.admin && !isOwner && !ctx.shell) throw new KmdError('E_FORBIDDEN', '주인이나 관리자만 바꾼다')
        const changesPrivate = row?.private != null && row.private !== !!cur?.private
        const changesOwner = row?.owner != null && row.owner !== (cur?.owner ?? null)
        if (!ctx.admin && !ctx.shell && (changesPrivate || changesOwner)) throw new KmdError('E_FORBIDDEN', '개인 · 주인은 관리자가 바꾼다')
      }
      allowed(rowFor(id))
      let cerr = null
      const out = await mutateReg(async (next) => {
        allowed(next.knowledge[id] || membersRow(id))
        owners.setOwner(next, id, row)
        // 주인 없는 개인 지식은 관리자만 본다 — 받지 않는다
        if (next.knowledge[id].private && !next.knowledge[id].owner) throw new KmdError('E_INPUT', '개인 지식은 주인을 함께 정한다')
        delete next.knowledge[id].check
        const r = { ...next.knowledge[id] }
        // 지식 안의 사람 칸도 잠금 안에서 — 셸 · 서버가 겹쳐 고쳐도 장부와 같은 차례로 쓰고 묶는다(git 잠금을 다투지 않는다).
        // 묶지 못해도 장부는 남기고 알린다(백업에 옛 사람 칸이 남으면 되살릴 때 다르게 열린다)
        await ensureRepo(meta.dir)
        const mf = path.join(meta.dir, '_members.md'), text = owners.renderMembers(r)
        if ((await fs.readFile(mf, 'utf8').catch(() => null)) !== text) {
          await fs.writeFile(mf, text, 'utf8')
          membersRows.delete(id)
          await commitPaths(meta.dir, ['_members.md'], '이 지식의 사람 — 주인 · 정리', 'kmd').catch((e) => { cerr = e })
        }
        return r
      })
      if (out.tidyMode !== 'live') { clearTimeout(liveTimers.get(id)); liveTimers.delete(id) } // 실시간을 끄면 기다리던 한 번도 걷는다
      if (cerr) throw new KmdError('E_INTERNAL', `사람 칸을 지식에 묶지 못했다 — ${String(cerr.message).split('\n')[0]} · 다시 한다`)
      return out
    },
    // 되살린 지식 — `_members.md` 로 주인 · 개인 · 정리 설정을 다시 건다(없으면 팀 지식 · 옛 꼴이면 안전한 쪽)
    async adoptRestored(id) {
      const meta = await hub.meta(id)
      return mutateReg((next) => owners.adoptMembers(next, id, meta.dir, { restore: true }))
    },
    // 장부와 `_members.md` 맞추기 — 켤 때 · 동기화 때(장부를 잃었거나 · 셸 · 밤 묶음으로 되돌렸어도 「개인」 이 다시 가린다).
    // 팀 서버만(이 PC 는 한 사람 — 팀에서 받아 온 지식의 사람 칸으로 이 PC 주인을 가리지 않는다). 설정 줄이 없는 옛 `_members.md` 는
    // 장부의 값으로 새 꼴로 고쳐 쓴다(되살려도 정리 설정이 그대로이게)
    async reconcileOwners() {
      if (mode !== 'team') return []
      const ks = await hub.list().catch(() => [])
      const fixed = await mutateReg(async (next) => {
        const out = []
        for (const k of ks) if (await owners.reconcile(next, k.id, k.dir)) out.push(k.name)
        return out
      })
      if (fixed.length) log(`주인 장부를 지식 안의 _members.md 와 맞췄다 — ${fixed.join(' · ')}`)
      for (const k of ks) {
        const text = await fs.readFile(path.join(k.dir, '_members.md'), 'utf8').catch(() => null)
        const row = owners.rowOf(R(), k.id)
        if (text == null || !row || owners.parseMembers(text).settings) continue
        await fs.writeFile(path.join(k.dir, '_members.md'), owners.renderMembers(row), 'utf8')
        membersRows.delete(k.id)
        await commitPaths(k.dir, ['_members.md'], '이 지식의 사람 — 정리 설정도 싣는다', 'kmd').catch((e) => log('사람 칸 새 꼴', k.id, e.message))
      }
      return fixed
    },
    // 떠난 사람의 지식 — 주인 · 정리하는 사람 칸에서 뺀다. to 가 있으면 그 사람이 주인을 잇고(개인 지식이면 이제 그 사람만 본다),
    // 없으면 주인 칸을 비운다(개인 지식은 관리자만 본다 — 관리자가 이 지식의 사람에서 넘기거나 지운다). `_members.md` 도 같이
    async handOver(user, { to = null } = {}) {
      const ks = await hub.list()
      const changed = await mutateReg((next) => {
        const out = []
        for (const k of ks) {
          const r = next.knowledge[k.id]
          if (!r) continue
          const own = r.owner === user
          const cur = (r.curators || []).includes(user)
          if (!own && !cur) continue
          if (own) { if (to) r.owner = to; else r.owner = null }
          if (cur) r.curators = r.curators.filter((x) => x !== user)
          r.at = new Date().toISOString()
          out.push({ id: k.id, dir: k.dir, own, private: !!r.private, row: { ...r } })
        }
        return out
      })
      for (const c of changed) {
        await fs.writeFile(path.join(c.dir, '_members.md'), owners.renderMembers(c.row), 'utf8').catch(() => {})
        membersRows.delete(c.id)
        await commitPaths(c.dir, ['_members.md'], `이 지식의 사람 — ${user} 이 떠났다`, 'kmd').catch((e) => log('사람 칸', c.id, e.message))
      }
      list = null
      return { team: changed.filter((c) => c.own && !c.private).length, private: changed.filter((c) => c.own && c.private).length, curate: changed.filter((c) => !c.own).length, to }
    },
    // 사람마다 — 주인인 팀 지식 · 개인 지식 · 정리하는 지식의 수(관리 › 사람 · 떠남 확인)
    async peopleRoles() {
      const out = {}
      const add = (u, key) => { (out[u] ||= { team: 0, private: 0, curate: 0 })[key]++ }
      for (const k of await hub.list()) {
        const r = rowFor(k.id)
        if (!r) continue
        if (r.owner) add(r.owner, r.private ? 'private' : 'team')
        for (const c of r.curators || []) add(c, 'curate')
      }
      return out
    },

    // 백업 — 붙이기 · 받기 · 상태(관리자만)
    async backupAttach(ctx, id, url) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '백업 자리는 관리자가 붙인다')
      url = String(url || '').trim()
      if (!url || /[\s\0]/.test(url) || /^ext::|^-/i.test(url)) throw new KmdError('E_INPUT', '백업 자리 주소가 아니다')
      if (isLocalPath(url) && mode === 'team') {
        const roots = (config.backupRoots || []).map((r) => path.resolve(r))
        const full = path.resolve(url)
        const meta = await hub.meta(id)
        if (full === path.resolve(meta.dir) || full.startsWith(path.resolve(meta.dir) + path.sep) || full.startsWith(path.resolve(dataDir) + path.sep)) throw new KmdError('E_INPUT', '지식 폴더 · 살림 자리 안에는 백업을 둘 수 없다')
        if (!roots.some((r) => full === r || full.startsWith(r + path.sep))) throw new KmdError('E_FORBIDDEN', '이 폴더는 백업 자리로 허락되지 않았다 — serve.json 의 backupRoots 에 더한다')
      }
      const meta = await hub.meta(id)
      const r = await backup.attach(meta, url, { dataDir })
      return { ...r, backup: backup.stateOf(meta) }
    },
    async backupPull(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '백업에서 받기는 관리자가 한다')
      const meta = await hub.meta(id, ctx)
      const r = await backup.pull(meta, { check })
      cache.delete(id)
      return r
    },
    // 이 백업 이어 쓰기 — 갈라졌을 때 백업 쪽이 맞다고 사람이 정한다(지금 머리는 가지로 남긴다)
    async backupAdopt(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '백업 이어 쓰기는 관리자가 한다')
      const meta = await hub.meta(id)
      // 갈라졌으면 — 서버에만 있던 기록을 쓴 사람에게 알린다(가지 kmd-before-… 에 남는다 · 다시 남기면 들어간다)
      const lost = await backup.lostIfAdopt(meta).catch(() => ({ records: [], docs: [] }))
      const r = await backup.adopt(meta, { check })
      cache.delete(id)
      const by = {}
      for (const x of lost.records) if (x.author && !/^kmd/.test(x.author)) (by[x.author] ||= []).push(x)
      if (r.kept) for (const [u, recs] of Object.entries(by)) await feed.add(dataDir, u, { kind: 'kn', kn: id, yl: true, b: `${meta.name} 을 백업의 글로 되돌렸다 — 내 기록 ${recs.length} 이 지식에서 빠졌다`, small: `${recs.slice(0, 3).map((x) => x.title).join(' · ')} · 가지 ${r.kept} 에 남아 있다 — 필요하면 다시 남긴다` }).catch(() => {})
      return { ...r, lost: lost.records.length }
    },
    // 되살리기 — 백업 자리에서 새 폴더로(지식 받아 오기 · 새 PC 의 [이 PC 로 되살리기]) · 받은 곳을 그대로 백업 자리로 붙인다
    async restore(ctx, { url, name, attach = null }) {
      if (!ctx.admin && !ctx.shell && mode !== 'pc') throw new KmdError('E_FORBIDDEN', '되살리기는 관리자가 한다')
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다')
      const t = checkUrl(url, { roots: config.backupRoots || [], pc: mode === 'pc' })
      const nm = String(name || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || path.basename(t.url).replace(/\.git$/i, '')
      if (!nm || nm.startsWith('.')) throw new KmdError('E_INPUT', '이름을 정한다')
      if ((await hub.list()).some((k) => k.id.toLowerCase() === nm.toLowerCase())) throw new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`)
      const dir = path.join(root, nm)
      // 백업에 이어 붙이나 — 같은 주소를 이 kmd 의 다른 지식이 쓰면 붙이지 않는다(연습 사본이 운영 백업에 밀어 넣지 않게) ·
      // 정하지 않았으면 원래 이름(주소의 끝)으로 되살릴 때만 붙인다 · 다른 이름이면 읽기만 사본
      const used = (await hub.list()).find((k) => backup.stateOf(k)?.url === maskUrl(t.url))
      if (attach === true && used) throw new KmdError('E_CONFLICT', `같은 백업 자리를 「${used.name}」 이 쓰고 있다 — 연습이면 붙이지 않고 되살린다(--practice)`)
      const same = nm.toLowerCase() === path.basename(String(t.url).replace(/[\\/]+$/, '')).replace(/\.git$/i, '').toLowerCase()
      const doAttach = attach === false ? false : attach === true ? true : !used && same
      const r = await restoreFrom({ url: t.url, dir, check, local: t.local })
      // 주인 · 개인 · 정리 설정을 목록에 보이기 전에 건다(되살린 개인 지식이 한순간도 팀에 열리지 않게)
      const owner = await mutateReg((next) => owners.adoptMembers(next, nm, dir, { restore: true }))
      list = null
      const meta = await hub.meta(nm)
      if (doAttach) await backup.attach(meta, t.url, { dataDir }).catch((e) => log('되살린 지식 백업 붙이기', nm, e.message))
      else {
        // 읽기만 사본 — 원래 백업에는 보내지 않는다(이 PC · 개인 지식의 자리가 있으면 거기로 새로)
        await tryGit(dir, ['remote', 'remove', backup.REMOTE])
        await hub.autoBackup(nm).catch(() => {})
      }
      // 받을 사람 — 되살린 사람과(셸이면 없다) 주인에게 · 주인이 명부에 없으면 되살린 사람만
      if (owner?.check) for (const who of new Set([ctx.shell ? null : ctx.user, owner.owner].filter(Boolean))) feed.add(dataDir, who, { kind: 'kn', kn: nm, dot: 'warn', text: `되살린 지식의 정리 설정을 다시 본다 — ${meta.name}`, small: '옛 백업이라 정리 방식 · Claude 에 보내지 않음이 없어 「손으로만 · 보내지 않음」 으로 두었다 — 이 지식의 사람에서 바꾼다' }).catch(() => {})
      feed.add(dataDir, ctx.user || 'kmd', { kind: 'kn', kn: nm, dot: 'acc', text: `되살렸다 — ${meta.name}`, small: `문서 ${r.docs} · 기록 ${r.records} · 첨부 ${r.atts}${r.errors.length ? ' · 검사 줄 ' + r.errors.length : ''}` }).catch(() => {})
      return { id: nm, ...r, owner: owner?.owner || null, private: !!owner?.private, check: !!owner?.check, attached: doAttach }
    },
    // GitLab 봇 — 백업 자리가 없는 팀 지식에 저장소를 찾거나 만들어 붙인다(안 되면 지금처럼 · 멈춤 줄이 남는다)
    async gitlabAttach(id) {
      const g = config.gitlab
      if (!g || mode !== 'team') return null
      const meta = await hub.meta(id)
      if (backup.attached(meta)) return null
      const row = rowFor(id)
      if (row?.private && !g.privateGroup) return null // 팀 그룹에 두면 그룹 사람 모두 읽는다 — 개인 지식은 privateBackup · privateGroup 으로
      const token = await getSecret(dataDir, g.secret || 'gitlab')
      if (!token) return null
      const p = await ensureProject({ api: g.api, group: row?.private ? g.privateGroup : g.group, token, name: row?.private ? `${row.owner || '_'}-${meta.id}` : meta.id })
      await ensureRepo(meta.dir) // 아직 git 이 없는 지식이면 있던 글을 첫 묶음으로
      await backup.attach(meta, p.url, { dataDir })
      log(`${meta.name} — GitLab 백업 자리를 ${p.created ? '만들어' : '찾아'} 붙였다`)
      return p
    },
    backupStateSync: (meta) => backup.stateOf(meta),
    async backupState(ctx, id) {
      return backup.stateOf(await hub.meta(id, ctx.admin || ctx.shell ? undefined : ctx))
    },
    // 저절로 붙이기 — 이 PC 는 백업 자리(backupRoot) 아래 · 팀 서버의 개인 지식은 privateBackup 아래 주인마다 자리
    //   새 지식 · 동기화 · 되살리기 · 켤 때(붙지 않은 것)
    async autoBackup(id) {
      const meta = await hub.meta(id)
      if (backup.attached(meta)) return null
      const row = rowFor(id)
      const base = mode === 'pc' ? config.backupRoot : row?.private && config.privateBackup ? path.join(config.privateBackup, row.owner || '_주인없음') : null
      if (!base) return null
      const bare = path.join(path.resolve(base), `${id}.git`)
      await fs.mkdir(path.dirname(bare), { recursive: true })
      if (!existsSync(bare)) {
        const r = await tryGit(path.dirname(bare), ['init', '-q', '--bare', '-b', 'main', bare])
        if (!r.ok) throw new KmdError('E_INPUT', `백업 자리를 만들지 못했다 — ${r.err.split('\n')[0]}`)
      }
      await backup.attach(meta, bare, { dataDir })
      return bare
    },
    // 이 PC 의 백업 자리 정하기 — serve.json 의 backupRoot · 정하면 붙지 않은 지식을 모두 붙인다
    async setBackupRoot(ctx, dir) {
      if (mode !== 'pc' || ctx.pair) throw new KmdError('E_FORBIDDEN', '이 PC 화면에서 한다')
      const full = path.resolve(String(dir || '').trim())
      if (!String(dir || '').trim()) throw new KmdError('E_INPUT', '백업 자리 폴더를 쓴다')
      const inside = (a, b) => a === b || a.startsWith(b + path.sep)
      if (inside(full, path.resolve(root)) || inside(full, path.resolve(dataDir)) || inside(path.resolve(root), full)) throw new KmdError('E_INPUT', '지식 폴더 · 살림 자리와 겹치지 않는 곳에 둔다(다른 드라이브 · 네트워크 폴더)')
      await fs.mkdir(full, { recursive: true }).catch((e) => { throw new KmdError('E_INPUT', `그 폴더를 만들 수 없다 — ${e.code || e.message}`) })
      const cur = await loadConfig(dataDir)
      await fs.writeFile(path.join(dataDir, 'serve.json'), JSON.stringify({ ...cur, backupRoot: full }, null, 1))
      config.backupRoot = full
      let attached = 0
      const failed = []
      for (const m of await hub.list()) {
        try { if (await hub.autoBackup(m.id)) attached++ } catch (e) { failed.push(`${m.name} — ${e.message}`) }
      }
      return { root: full, attached, failed }
    },
    // 갈라졌을 때 — 이어 쓰기가 빼는 것(서버에만 있는 기록 · 문서) · 서버 것으로 백업 덮기
    async backupLost(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '관리자가 한다')
      return backup.lostIfAdopt(await hub.meta(id))
    },
    async backupKeep(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '관리자가 한다')
      return backup.keepServer(await hub.meta(id))
    },
    async start() {
      // 기다리던 정리 · 마지막 정리 날 · 정리 일꾼 상태 — 다시 켜도 잇는다(맡았던 일감은 기다림으로)
      for (const j of await fs.readFile(jobsFile, 'utf8').then(JSON.parse, () => [])) jobs.set(j.id, j.state === 'running' ? { ...j, state: j.rule ? 'failed' : 'queued', worker: null, ...(j.rule ? { why: '다시 켜며 멈췄다 — [지금 정리]' } : {}) } : j)
      for (const [k, v] of Object.entries(await fs.readFile(path.join(dataDir, 'tidy-last.json'), 'utf8').then(JSON.parse, () => ({})))) lastTidy.set(k, v)
      wsNow = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      // 장부를 지식 안의 `_members.md` 와 맞춘다 — 밤 묶음으로 살림 자리를 되돌렸거나 장부 줄을 잃었어도 개인 지식은 다시 가린다
      await hub.reconcileOwners().catch((e) => log('주인 장부 맞추기', e.message))
      await hub.runLoad()
      started = true
      await backup.start(await hub.list(), { dataDir, log })
      // GitLab 봇 — 백업 자리가 없는 지식마다(켤 때 한 번 · 지식 추가 때)
      // 못 붙인 것(GitLab · 저장소가 잠깐 닿지 않음)은 30초 · 2분 · 10분 · 그 뒤 한 시간마다 다시 — 다시 켤 때까지 백업 없이 두지 않게
      if (config.gitlab) {
        const sweep = async (i) => {
          let left = 0
          for (const m of await hub.list().catch(() => [])) await hub.gitlabAttach(m.id).catch((e) => { left++; log('GitLab 백업 자리', m.id, e.message) })
          if (left && started) setTimeout(() => sweep(i + 1), [30_000, 120_000, 600_000][i] ?? 3600_000).unref?.()
        }
        setTimeout(() => sweep(0), 500).unref?.()
      }
      // 이 PC 의 백업 자리 · 팀 서버의 개인 지식 백업 자리 — 붙지 않은 지식마다(켤 때 한 번)
      if (config.backupRoot || config.privateBackup) setTimeout(async () => { for (const m of await hub.list().catch(() => [])) await hub.autoBackup(m.id).catch((e) => log('백업 자리', m.id, e.message)) }, 800).unref?.()
      // 거두기 — PC(또는 serve.json collect)에서 편집기로 고친 문서를 30초 고요 뒤 들인다
      await hub.known().catch(() => {}) // 처음 켤 때 — 지금 있는 지식을 아는 것으로
      if (mode === 'pc' || config.collect) for (const m of await hub.list()) watchers.push(Object.assign(collect.watch(m.dir, () => hub.collect(m.id)), { dir: m.dir }))
      // 꺼져 있던 동안 편집기로 고친 것 — 켤 때 한 번 거둔다(다른 파일이 바뀔 때까지 기다리지 않게)
      if (mode === 'pc' || config.collect) setTimeout(async () => { for (const m of await hub.list().catch(() => [])) await hub.collect(m.id).catch(() => {}) }, config.collectOnStartMs ?? 1500).unref?.()
      // 가져오는 곳 — 할 일 시계(분마다 본다 · 각자의 every) · 켤 때 한 번
      const dueSources = async (all) => {
        for (const m of await hub.list().catch(() => [])) {
          const decl = await readDecl(m.dir)
          if (!decl.length) continue
          const st = await readSourceState(dataDir, m.id)
          for (const s of decl) {
            // 마지막으로 본 때 — 가져왔거나 해 본 때(실패도 주기를 지킨다 · 실패가 이어지면 간격을 두 배씩 · 여덟 배까지)
            const s0 = st[s.name] || {}
            const c = [s0.checkedAt, s0.triedAt].filter(Boolean).sort().pop()
            const back = s0.triedAt && (!s0.checkedAt || s0.triedAt > s0.checkedAt) ? Math.min(8, 2 ** Math.max(0, (s0.failures || 1) - 1)) : 1
            const daily = String(s.every || '').startsWith('daily ') && String(s.every).slice(6)
            const hm = new Date().toTimeString().slice(0, 5)
            const due = all || !c || (daily ? hm >= daily && new Date(c).toDateString() !== new Date().toDateString() : Date.now() - Date.parse(c) >= everyMs(s.every) * back)
            if (adding.has(`${m.id}\n${s.name}`)) continue // 막 더하는 중 — 더하기의 첫 확인이 한다
            if (due && s.every !== 'manual' && (mode !== 'pc' || hub.autoOf(pcUser, 'src'))) await hub.sourceRun(m.id, s.name).catch(() => {})
          }
        }
      }
      sourceTimer = setInterval(() => dueSources(false), config.sourceTickMs || 60_000)
      setTimeout(async () => {
        for (const m of await hub.list().catch(() => [])) {
          const decl = await readDecl(m.dir).catch(() => [])
          const st = await readSourceState(dataDir, m.id).catch(() => ({}))
          for (const s of decl) {
            hub.watchSource(m.id, s)
            if (st[s.name]?.resync) hub.sourceResync({ ...SHELL }, m.id, s.name).catch(() => {})
          }
        }
      }, 1000).unref?.()
      sourceTimer.unref?.()
      setTimeout(() => dueSources(true), 3000).unref?.()
      // 이 PC — 켤 때 쌓여 있던 「아직 안 넣은 기록」 을 바로 문서에(뒤에서 · 지식마다 한 줄)
      if (config.curateOnStart !== false) setTimeout(async () => { for (const m of await hub.list().catch(() => [])) if (mode === 'pc' || hub.teamPrivate(m.id)) hub.curateSoon(m.id).catch(() => {}) }, 2000).unref?.()
      // 정해진 시간의 정리 — 분마다 본다 · 지식마다 하루 한 번 · 넣을 것이 있을 때만
      tidyTimer = setInterval(async () => {
        const d = new Date()
        const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        const day = localDay(d)
        for (const m of await hub.list().catch(() => [])) {
          if (hm < hub.tidyAtOf(m.id) || lastTidy.get(m.id) === day) continue
          lastTidy.set(m.id, day)
          await fs.writeFile(path.join(dataDir, 'tidy-last.json'), JSON.stringify(Object.fromEntries(lastTidy))).catch(() => {})
          // 받은편지함 — 정리 시각에 같은 주인의 개인 지식으로 옮긴다
          if (m.name === '받은편지함') await hub.inboxTidy({ user: rowFor(m.id)?.owner || pcUser || 'kmd', pc: mode === 'pc' }, m.id).catch(() => {})
          const k = await hub.get(m.id).catch(() => null)
          if (k && (mode !== 'pc' || hub.autoOf(pcUser, 'claude')) && !hub.teamPrivate(m.id) && (mode === 'pc' || hub.tidyModeOf(m.id) === 'time') && k.works.some((w) => w.state === 'pend' || w.state === 'nowhere')) hub.tidyNow({ user: 'kmd', admin: true }, m.id, { by: 'kmd', auto: true }).catch(() => {})
        }
      }, config.tidyTickMs || 60_000)
      tidyTimer.unref?.()
      // 보내기 — 닿지 않아 둔 것을 분마다 다시
      sendTimer = setInterval(() => hub.sendRetry().catch(() => {}), config.sendTickMs || 60_000)
      sendTimer.unref?.()
      // 찾기 색인 — 뒤에서 미리(지금 찾는 지식은 기다리지 않고 그때 짓는다)
      setTimeout(async () => {
        for (const m of await hub.list().catch(() => [])) await hub.index(m.id).catch(() => {})
      }, 200).unref?.()
    },
    async collect(id) {
      const meta = await hub.meta(id)
      if (!hub.autoOf(pcUser, 'save')) return null // 설정에서 「편집기에서 고친 것 저장」 을 껐다
      const user = pcUser || 'kmd'
      const r = await serial(path.resolve(meta.dir), () => collect.collectNow(meta.dir, { user, save: (x) => collect.writeCollect(meta.dir, { ...x, user }) }))
      if (r) {
        cache.delete(id)
        if (r.reverted?.length) log(`${meta.name} — 손으로 고친 기록 · 장부를 되돌렸다: ${r.reverted.join(' · ')}`)
        // 되돌린 손 고침 — 이력에 노란 줄(까닭 · 사본 자리) · 글은 사본으로 남았다
        for (const x of r.rescued || []) await feed.add(dataDir, user, { kind: 'edit', kn: id, yl: true, b: `편집기 고침을 되돌렸다 — ${meta.name} › ${x.path}`, small: `${x.why} · 고친 글의 사본: ${x.copy}` }).catch(() => {})
        if (r.id && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      }
      return r
    },
    stop() {
      started = false
      backup.stop()
      for (const w of watchers) w.close()
      for (const t of decideTimers.values()) clearTimeout(t)
      for (const t of [...liveTimers.values(), ...privTimers.values()]) clearTimeout(t)
      clearInterval(tidyTimer)
      clearInterval(sourceTimer)
      clearInterval(sendTimer)
      for (const w of srcWatch.values()) w.close()
      srcWatch.clear()
    },
  }
  return hub
}

export const defaultDataDir = (root) => path.join(root, '.kmd')
const stampMs = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : null
}

// 백업 자리가 없는 지식 — 저장이 50 을 넘거나 첫 저장이 7일 넘었으면 노랑 한 줄(v0.5 §4.2). HEAD 마다 한 번 잰다
const unbackedCache = new Map()
async function unbacked(k) {
  const head = (await tryGit(k.dir, ['rev-parse', '-q', '--verify', 'HEAD'])).out.trim()
  if (!head) return null
  const hit = unbackedCache.get(k.dir)
  if (hit && hit.head === head) return hit.v
  const n = Number((await tryGit(k.dir, ['rev-list', '--count', 'HEAD'])).out.trim()) || 0
  const first = Number((await tryGit(k.dir, ['log', '--reverse', '--format=%ct', '--max-parents=0'])).out.trim().split('\n')[0]) * 1000
  const old = first && Date.now() - first > 7 * 864e5
  const d = new Date(first)
  const v = n >= 50 || old ? { n, since: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` } : null
  unbackedCache.set(k.dir, { head, v })
  return v
}
// 셸(서버를 띄운 사람)의 자리 — CLI 가 쓴다
// 이 PC 의 넣기 — 한 번에 Claude 로 다듬는 파일 수(나머지는 규칙으로 — 큰 폴더가 오래 걸리지 않게)
const INGEST_CLAUDE_MAX = 20
const AGENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agent')
export const SHELL = Object.freeze({ user: 'kmd', admin: true, shell: true })
