//
// 모든 길은 ctx { user, admin, machine? } 를 받는다. 지식마다 자리(없음 · 읽기 · 쓰기 · 관리 — docs/kmd_권한_모델.md)는
// 한 곳(`hub.levelOf` → `owners.levelOf`)에서 정한다: 읽기 미만은 목록 · 찾기 · 읽기에서 「없는 지식」 · 쓰기 · 관리 길은
// `hub.need` 를 먼저 지난다. 저장은 여기 한 곳으로만 간다 — 읽기만으로 닫힌 지식을 막고, 그 지식의
// 캐시만 새로 읽게 하고(바뀐 파일만 — F12), 백업 줄에 넣고, 멈춤 줄을 warnings 로 돌려준다.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { listKnowledge, loadKnowledge, coordsOfSection, sectionOf, looksLikeKnowledge } from '../core/knowledge.js'
import { KmdError, httpStatusOf } from '../core/errors.js'
import { save as coreSave, saveRecords, serial, localStamp, recordTakenSync, SECTIONS_MAX } from '../core/save.js'
import { audit as guardAudit, recordBody, RECORD_PARTS } from '../core/guard.js'
import { recover as recoverSave } from '../core/journal.js'
import { decide } from '../core/curate.js'
import { decisionRecord, renderReverted, parseReverted, parsePut, dropPart, parseHeld, PUT_PART, HELD_PART, REVERTED_PART, itemKey } from '../core/parts.js'
import { revertPlan } from '../core/revert.js'
import * as collect from '../core/collect.js'
import crypto from 'node:crypto'
import net from 'node:net'
import { material, planSave, promptOf as tidyPrompt, DRAFT_SCHEMA, TOUCH_SCHEMA, ingestRule } from '../core/tidy.js'
import { check as checkDraft } from '../core/gate.js'
import { INGEST_SCHEMA, ingestCandidates, formsOf, spotKey, spotTarget, draftToSave, heldRecord, intakeTags } from '../core/ingest.js'
import { checkProposal, placeOf, PROPOSAL_PART } from '../core/propose.js'
import { checkSection } from '../core/gate.js'
import { valuesOf, mustValues } from '../core/values.js'
import { splitBlocks, hasBlockMarker } from '../core/baseline.js'
import { validEdits } from '../core/edits.js'
import { runClaude } from '../core/claude.js'
import * as feed from '../core/feed.js'
import { inside as insideDir, checkTarget, readSource, probe, readDecl, editDecl, DECL_BROKEN, stripCreds, secretName, secretPrefix, docPrefix, runSource, planRun, readState as readSourceState, writeState as writeSourceState, sourceLines, everyMs, probeGit } from '../core/sources.js'
import { check } from '../core/check.js'
import { commitPaths, ensureRepo, tryGit, maskUrl } from '../core/git.js'
import { stopLine, ageText } from '../core/stopline.js'
import * as backup from '../core/backup.js'
import * as owners from '../core/owners.js'
import { buildIndex, ladder, loadLearned, learn, searchCheck, exact } from '../core/search.js'
import { planImport, summary, MAX_FILES, MAX_BYTES, PCONLY } from '../core/importer.js'
import { imagesOf } from '../core/ooxml.js'
import { runAgent, agentAvailable } from '../core/agent.js'
import { createQueue, Cancelled, isFinal, STAGES } from '../core/queue.js'
import { modelOf, ROLES, CHOICES, roleOf } from '../core/models.js'
import { expandSections } from '../core/excerpt.js'
import { FILE_SCHEMA, filePrompt, fileRecord, COMMIT_SCHEMA, commitPrompt, commitAnalyzed } from '../core/analyze.js'
import { renderRecord } from '../core/frontmatter.js'
import { stampAll, headingMatches, findHeading } from '../core/sections.js'
import { docfmtDir, checkFormat } from '../core/docformat.js'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, statSync, watch as fsWatch } from 'node:fs'
import * as sendLib from '../core/send.js'
import * as keystore from '../core/keystore.js'
import { sha16 } from '../core/text.js'
import { isSystemRecord, labelOf, isLegacy, reflectedIn } from '../core/knowledge.js'
import { isReservedTag } from '../core/names.js' // 예약 접두사(job/)까지 본다(S3)
import { isoOfStamp, logKind, atTag } from './views.js'
import { restore as restoreFrom, checkUrl } from '../core/restore.js'
import { writeJsonAtomic } from '../core/atomic.js'
import { watchedOf } from '../core/watchmark.js'
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
    throw new Error(`serve.json 이 깨졌다: ${e.message}`)
  }
}

// 저장소 주소를 견줄 꼴로 — 자격 · 틀(https · ssh · git@host:) · 포트 · .git 꼬리 · 끝 / · 대소문자를 걷고 「호스트/경로」 만
//   https://u:p@Git.x/a/b.git · ssh://git@git.x:22/a/b · git@git.x:a/b → git.x/a/b
const repoKey = (u) => {
  let x = String(u || '').trim().replace(/\\/g, '/')
  const scp = /^[^/@\s]+@([^/:\s]+):(?!\/\/)(.*)$/.exec(x)
  if (scp) x = `${scp[1]}/${scp[2]}`
  else x = x.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^/@]*@/, '')
  return x.replace(/^([^/:]+):\d+(?=\/|$)/, '$1').replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
}
// 백업 주소가 이 PC 의 폴더인가(scp 모양 user@host:path · 스킴 주소는 아니다)
const isLocalPath = (u) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^[^/\\]+@[^/\\]+:/.test(u) && !/^ext::/i.test(u)

// 정리 일꾼이 멈추는 까닭(자리마다 다시 불러도 같다) — 일감 · 정리 일 줄의 글
// 초안 검사에서 Claude 가 고쳐 쓸 수 있는 까닭 — 일꾼이 까닭을 붙여 한 번 더 쓴다(그사이 바뀜 · 받지 않은 기록 같은 것은 다시 써도 같다)
const FIXABLE = /^(기록의 값이 글에 없다|근거에 없는 값이 있다|옛 글의 값이 빠졌다|조각이 지금 글|근거보다 크게 썼다|글에 머리 · 표지가 들었다|빠뜨린 기록이 있다|글을 비웠다)/
const STOP_WHY = { login: '정리 전용 로그인이 끝났다', limit: '사용 한도에 닿았다', missing: '서버에 Claude Code(claude) 가 설치되어 있지 않다' }

// 되돌림 — 그 문서에서 7일 안에 되돌린 수(S-D11). 새 되돌림(태그 revert)은 「## 되돌린 항목」 의 문서 경로로,
//   옛 되돌림(제목 「되돌림」 · reopens)은 본문 줄 「- <문서 이름> › 」 으로 센다 — 이름이 다른 이름 안에 든 문서(배포 / 배포절차)를 함께 세지 않게
export function revertsOfDoc(k, doc, now = Date.now()) {
  const cut = now - 7 * 864e5
  const line = `- ${doc.replace(/^docs\/|\.md$/g, '')} › `
  return k.logs.filter((w) => {
    if ((stampMs(w.date) || 0) < cut) return false
    if (w.tags.includes('revert')) return parseReverted(w.body).some((r) => r.doc === doc)
    return w.reopens.length > 0 && w.title.startsWith('되돌림') && w.body.split('\n').some((l) => l.startsWith(line))
  }).length
}

export async function makeHub({ root, dataDir, mode = 'team', pcUser = null, log = (...a) => console.log('[kmd]', ...a) }) {
  const config = await loadConfig(dataDir)
  // 주인 장부 — 읽을 때마다 R()(셸이 바꿨으면 mtime 을 보고 다시 읽는다) · 고칠 때는 mutateReg 하나로(한 줄로 서서
  // 디스크의 것을 다시 읽고 → 고치고 → 쓴다 · 둘이 겹쳐 앞사람의 「나만」 줄을 덮어 지우지 않게)
  let reg = await owners.load(dataDir)
  let regAt = owners.mtimeOf(dataDir)
  let regBad = null // 읽지 못한 owners.json 의 mtime · 까닭 — 같은 mtime 이면 다시 읽지 않고 로그도 한 번만
  // mtime 은 한 차례(같은 동기 흐름) 안에서 한 번만 본다(Q70 — 지식 N 개를 거르는 visible 이 statSync 를 N 번 하지 않게)
  //   await 를 넘거나 이 프로세스가 쓰면 다시 본다 · 다른 프로세스가 쓴 것을 늦게 보지 않는다
  let regFresh = false
  const R = () => {
    if (regFresh && !Number.isNaN(regAt)) return reg
    regFresh = true
    queueMicrotask(() => { regFresh = false })
    const m = owners.mtimeOf(dataDir)
    if (m !== regAt && m !== regBad?.at) {
      try {
        reg = owners.loadSync(dataDir)
        regAt = m
        regBad = null
        list = null // 셸이 되살렸거나 고친 지식 — 목록도 다시 읽는다
      } catch (e) {
        regBad = { at: m, why: e.message, since: new Date().toISOString() }
        log('owners.json 을 다시 읽지 못했다. 앞의 것을 쓴다', e.message)
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
  // 고치려고 읽기 — 깨졌으면 던진다(빈 목록 위에 써서 기다리는 부탁을 지우지 않게)
  const reqRead = async () => {
    const t = await fs.readFile(path.join(dataDir, 'requests.json'), 'utf8').catch(() => null)
    if (t == null || !t.trim()) return []
    try { const j = JSON.parse(t); if (Array.isArray(j)) return j } catch {}
    throw new KmdError('E_INPUT', '부탁 장부(requests.json)가 깨졌다: 바로잡을 때까지 부탁을 받지 않는다')
  }
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
  // 지식의 장부 줄 — 팀 서버의 지식은 모두 팀 지식이다(개인 지식은 각자의 PC 프로그램에만 · 팀 서버에 서지 않는다)
  const rowFor = (id) => owners.rowOf(R(), id)
  // 지식마다 자리(docs/kmd_권한_모델.md) — 이 PC 는 한 사람이라 늘 관리 · 팀은 장부의 자리 표로
  const levelFor = (id, ctx) => (mode === 'pc' && !ctx?.agent && !ctx?.machine ? 'admin' : owners.levelOf(R(), id, ctx))
  const visibleTo = (id, ctx) => owners.atLeast(levelFor(id, ctx), 'read')
  // 저절로 하는 일 켬 · 끔(설정) — PC 는 하나 · 팀은 사람마다. 없으면 켬
  // prefs.json 이 깨졌으면 삼켜 모두 켬으로 돌리지 않는다 — 원본을 prefs.json.bad 로 옮겨 두고 알린다
  const prefsFile = path.join(dataDir, 'prefs.json')
  let prefs = await fs.readFile(prefsFile, 'utf8').then(
    async (t) => {
      try {
        return JSON.parse(t)
      } catch (e) {
        log('prefs.json 을 읽지 못했다. prefs.json.bad 로 옮겨 두고 기본(켬)으로 시작한다', e.message)
        await fs.rename(prefsFile, prefsFile + '.bad').catch((e2) => log('prefs.json.bad 로 옮기지 못했다', e2.message))
        return {}
      }
    },
    () => ({})
  )
  // 설정 고치기는 한 줄로 — 사본 · 쓰기 · 바꾸기를 그 안에서(겹친 두 사람이 서로의 값을 덮지 않게) · 임시 파일 뒤 이름 바꾸기
  let prefsQ = Promise.resolve()
  const mutatePrefs = (fn) => {
    const p = prefsQ.then(async () => {
      const next = structuredClone(prefs)
      fn(next)
      await writeJsonAtomic(prefsFile, next, { indent: 1 })
      prefs = next
    })
    prefsQ = p.catch(() => {})
    return p
  }
  const cache = new Map() // 지식 → 읽은 지식(promise)
  // 찾기 학습 — 메모리에 둔다(Q64 · 찾을 때마다 파일을 다시 읽지 않게) · learn 이 쓰면 비운다 · 10분이면 다시(180일 지난 것 걷기)
  const learnedC = new Map()
  const learnedOf = (id) => {
    const c = learnedC.get(id)
    if (c && Date.now() - c.at < 10 * 60_000) return c.p
    const p = loadLearned(dataDir, id)
    learnedC.set(id, { at: Date.now(), p })
    return p
  }
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
  // 일 줄 — 파일 들이기(run 그대로) · 가져오기 · 기록을 문서에 넣기 · 여러 파일 묶음을 한 줄로(core/queue.js · 가져오기 일 줄 검토안)
  const Q = createQueue({ file: path.join(dataDir, 'queue.json'), log: (...a) => log('일 줄', ...a) })
  const srcPend = new Map() // 가져올 곳 → 아직 차례를 기다리는 일(겹치면 그 일에 붙는다)
  const binOf = (jid) => path.join(dataDir, 'queue', `${jid}.bin`) // 기록이 서기 전에 멈춘 파일의 원본(다시 하기 · 다시 켠 뒤 이어서)
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
  // 코드 바뀜 기록 → 그 기록을 남긴 가져오기 일 — 정리가 문서에 넣으면 그 일의 터미널에 [문서] 줄로 잇는다(이 켜짐 동안만)
  const codeJobs = new Map()
  //   keep — 아직 끝이 아니다(항목만 골랐다 · 못 넣어 한 시간 뒤 다시) — 다음 줄도 그 일에
  const codeNote = (recIds, k, x, { keep = false } = {}) => { for (const r of recIds) { const qj = codeJobs.get(r); if (qj) { if (!keep) codeJobs.delete(r); Q.line(qj, k, x) } } }
  const liveTimers = new Map() // 팀 지식 「실시간」 정리 — 조용해진 뒤 한 번
  const draftLocks = new Map() // 지식마다 초안 받기 한 줄(hub.drafts)
  // 일감 — 맡은 일감은 임대(기본 40분 · 일꾼이 부를 때마다 늘린다). 지나면 다시 기다림으로(세 번째면 failed · 까닭) ·
  // 파일(<data>/jobs.json)에 두어 다시 켜도 기다리던 정리가 사라지지 않는다(맡았던 것은 기다림으로)
  const JOB_LEASE = config.jobLeaseMs ?? 40 * 60_000
  const jobsFile = path.join(dataDir, 'jobs.json')
  // 들이기 일감(S7 · 설계 3-5 · 2-6) — 같은 jobs 장부의 kind:'intake' 줄. 원천은 <data>/queue/<jid>.md(글) · .bin(파일 바이트)에 들고 있다가 저장 한 번으로(S-D18)
  //   고쳐 쓰기 횟수(S-D20 · 서버가 센다) · 기다림 상한(S-D22 · jobTimer) · 사람 × 지식 기다림 상한 · 지식마다 하루 상한(S-D47)
  const INTAKE_FIX = Math.min(2, Math.max(1, Number(config.ingestFix ?? process.env.KMD_INGEST_FIX) || 2))
  const INTAKE_STALE_MS = config.intakeStaleMs ?? 24 * 3600_000
  const intakeMdOf = (jid) => path.join(dataDir, 'queue', `${jid}.md`)
  const heldDir = (id) => path.join(dataDir, 'held', encodeURIComponent(id))
  const intakeDayFile = path.join(dataDir, 'intake-day.json')
  let intakeDay = {} // 지식 → { day, n } — 하루 들이기 수(다시 켜도 잇는다)
  let jobTimer = null
  // 같은 원천의 열린 일감을 찾는 열쇠(S-D47)
  const intakeKey = (type, src = {}) => (type === 'file' ? `f:${src.rel}:${src.sha}` : type === 'commit' ? `c:${src.src}:${src.commit}` : type === 'polish' ? `d:${src.doc}` : `r:${src.rec}`)
  let jobsW = Promise.resolve()
  // 끝난 일감은 7일 · 지식마다 최근 50건 남긴다(사흘 · 일주일 정리 시간을 서버 기록 없이 본다) · 도는 것은 늘
  const JOB_KEEP_MS = 7 * 24 * 3600_000
  const JOB_KEEP_N = 50
  const saveJobs = () => {
    const live = (j) => j.state === 'queued' || j.state === 'running'
    const per = new Map()
    const keep = [...jobs.values()].filter((j) => live(j) || Date.now() - Date.parse(j.done || j.at) < JOB_KEEP_MS).reverse().filter((j) => live(j) || (per.set(j.kn, (per.get(j.kn) || 0) + 1).get(j.kn) <= JOB_KEEP_N)).reverse()
    for (const j of [...jobs.values()]) if (!keep.includes(j)) jobs.delete(j.id)
    jobsW = jobsW.then(() => fs.mkdir(dataDir, { recursive: true })).then(() => fs.writeFile(jobsFile + '.tmp', JSON.stringify(keep))).then(() => fs.rename(jobsFile + '.tmp', jobsFile)).catch((e) => log(`정리 일감 장부를 쓰지 못했다: ${e.message}`))
    return jobsW
  }
  const sweepJobs = () => {
    let changed = false
    for (const j of jobs.values()) {
      if (j.state !== 'running' || !(j.leaseUntil < Date.now())) continue
      changed = true
      if (j.kind === 'intake') {
        j.leases = (j.leases || 0) + 1
        if (j.leases >= 3) {
          j.state = 'closing'
          hub.intakeGiveUp(j, 'claude', '팀 일꾼이 세 번 끝내지 못했다').catch((e) => log('들이기 일감 닫기', j.id, e.message))
        } else Object.assign(j, { state: 'queued', worker: null, why: `팀 일꾼이 끝내지 못해 다시 기다린다(${j.leases}번째)` })
        continue
      }
      if (j.stop) {
        Object.assign(j, { state: 'cancelled', why: `그만뒀다: ${j.stop.by} · 정리 일꾼이 돌아오지 않아 그대로 닫았다`, done: new Date().toISOString() })
        for (const sp of j.spots || []) if (sp.st !== 'done' && sp.st !== 'left') Object.assign(sp, { st: 'stop' })
        continue
      }
      j.tries = (j.tries || 0) + 1
      if (j.tries >= 3) Object.assign(j, { state: 'failed', why: '정리 일꾼이 세 번 끝내지 못했다. 일꾼 기록을 본다', done: new Date().toISOString() })
      else Object.assign(j, { state: 'queued', worker: null, why: '정리 일꾼이 끝내지 못해 다시 기다린다' })
      // 쓰던 자리는 다시 기다림으로(「글 쓰는 중」 이 남아 화면이 서로 어긋나던 것)
      for (const sp of j.spots || []) if (sp.st === 'run' || sp.st === 'got') { Object.assign(sp, { st: 'wait', stage: 2 }); sp.lines.push([2, 'sys', `정리 일꾼이 끝내지 못해 다시 기다린다(${j.tries}번째)`]) }
      stamp(j)
    }
    if (changed) saveJobs()
    // 일꾼의 단기 열쇠 — 때가 지난 줄을 걷는다(일꾼이 죽거나 임대가 끝나 정상으로 지워지지 않은 것)
    const now = Date.now()
    for (const [h, d] of drafts) if (!(d.exp >= now)) drafts.delete(h)
  }
  // 정리 일꾼(팀) — 쉬는 중(로그인 끝 · 한도)이면 규칙으로 · 마지막으로 물은 때
  let wsNow = null
  let teamSeenAt = 0
  const workerRests = () => wsNow?.ok === false
  const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
  const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  async function groupFor(k, id, g, ids = null) {
    if (!g) return null
    const all = material(k, { ids })
    if (g.kind === 'touches') {
      const x = all.find((y) => y.kind === 'touches' && y.record.id === g.record?.id)
      if (!x) return null
      const r = await ladder(k, await hub.index(id), { q: `${x.record.title} ${x.record.body}`.slice(0, 300), learned: await learnedOf(id), max: 8 })
      x.candidates = [...r.exact, ...r.coords].filter((c) => c.coord).slice(0, 8).map((c) => ({ coord: c.coord, name: c.name }))
      return x
    }
    if (g.kind === 'ingest') return all.find((y) => y.kind === 'ingest' && y.record.id === g.record?.id) || null
    return all.find((y) => y.kind === 'section' && y.coord === g.coord) || null
  }
  // 되돌림 — 그 문서에서 7일 안에 되돌린 수
  async function recentReverts(id, doc) {
    return revertsOfDoc(await hub.get(id), doc)
  }
  // 정리 일 줄의 줄 — 시각이 없는 줄에 지금을 단다(줄을 쌓은 함수 끝에서 한 번 · 예전 줄은 시각 없이 그대로)
  const stamp = (j) => { const t = Date.now(); for (const sp of j?.spots || []) for (const l of sp.lines || []) if (l.length < 4) l.push(t) }
  // 넣을 곳의 보이는 이름 — 문서는 제목으로(경로는 path) · 「4.1_개발환경/내부시험서버구성서 › 2. 배치」 를 사람이 읽는 이름으로
  const spotName = (k, g) => {
    if (g.kind !== 'section') return { name: g.kind === 'ingest' ? `${String(g.record.file || g.record.title).split('/').pop()} · 문서에 들이기` : `${String(g.record.title).split(/ — |: /)[0]} · 넣을 곳 고르기` }
    const doc = k.byDocPath.get(g.doc)
    const p = g.doc.replace(/^docs\/|\.md$/g, '')
    return { name: `${doc?.title || p.split('/').pop()} › ${g.heading}`, path: p, docName: doc?.title || p.split('/').pop() }
  }
  // 화면에 내는 정리 일감 — 일꾼 · 임대 · 일감 범위는 빼고 비용은 관리 자리만
  const jobView = (j, boss) => {
    const { worker, leaseUntil, ids, seen, ...rest0 } = j
    const noCost = ({ cost, ...y }) => y
    // 들이기 일감의 비용 · 횟수도 관리 자리만(권한 모델 7절)
    const rest = boss || j.kind !== 'intake' ? rest0 : noCost(rest0)
    return { ...rest, ...(ids ? { picked: ids.length } : {}), ...(j.spots ? { spots: j.spots.map((x) => (boss ? x : noCost(x))) } : {}) }
  }
  // 정리 장부(tidy/<id>.json · 지난 정리 30번) — 없으면 빈 것 · 깨졌으면 옆으로 옮겨 두고 log(빈 것으로 읽어 덮지 않는다 · 둔 횟수의 바탕이다)
  const runsFile = (id) => path.join(dataDir, 'tidy', `${encodeURIComponent(id)}.json`)
  async function readRuns(id, { aside = false } = {}) {
    const f = runsFile(id)
    let t
    try {
      t = await fs.readFile(f, 'utf8')
    } catch (e) {
      if (e.code === 'ENOENT') return []
      throw e
    }
    try {
      const v = JSON.parse(t)
      if (Array.isArray(v)) return v
    } catch {}
    log(`정리 장부가 깨졌다: ${f}${aside ? ' · 옆으로 옮기고 새로 쓴다' : ''}`)
    if (aside) await fs.rename(f, `${f}.broken-${Date.now()}`)
    return []
  }
  // 정리가 넣지 못하고 둔 횟수 — 기록마다 정리 한 번에 한 번(한 기록이 자리 여럿에 걸려도) ·
  //   HOLD 번이면 자동 정리에서 빼고 「사람이 볼 것」 으로 지식관리자에게 알린다(매일 밤 같은 기록을 다시 쓰던 것) · 손 정리는 그대로 된다
  const HOLD = 3
  async function leftTries(id) {
    const tries = {}
    for (const run of await readRuns(id)) for (const x of new Set((run.rows || []).filter((r) => r.kind === 'left').flatMap((r) => r.records || []))) tries[x] = (tries[x] || 0) + 1
    return tries
  }
  function saveRun(id, run) {
    const f = runsFile(id)
    return serial(`json:${f}`, async () => {
      const all = await readRuns(id, { aside: true })
      all.unshift(run)
      await writeJsonAtomic(f, all.slice(0, 30))
    })
  }
  // 보내기 한 곳 — 같은 kmd 면 받기 길 그대로 · 다른 kmd 면 그 주소의 기기 열쇠로
  // 보내지 못한 것 한 줄 — 닿지 않음(연결 · 시간 넘김 · 5xx)은 wait(저절로 다시) · 받는 쪽이 거절(4xx · 같은 kmd 의 오류)은 fail(사람이)
  function waitOf(to, payload, e) {
    const status = e.status || (e.code ? httpStatusOf(e.code) : null)
    const retry = e.reach === false || (status != null && status >= 500 && e.reach !== true) || (!status && !e.code)
    return { id: crypto.randomBytes(5).toString('hex'), state: retry ? 'wait' : 'fail', to, payload, at: new Date().toISOString(), why: String(e.message || '').slice(0, 160), ...(retry ? {} : { status, fix: sendLib.fixOf({ status }) }) }
  }
  const nameAsked = new Set()
  async function askName(id, meta, rec, why) {
    const key = `${id}\n${rec.id}`
    if (nameAsked.has(key)) return
    nameAsked.add(key)
    for (const u of await hub.curatorsOf(id)) {
      await feed.add(dataDir, u, { kind: 'tidy', rec: rec.id, kn: id, dot: 'warn', text: `이름을 고르지 못한 기록: ${meta.name} › 「${String(rec.title || rec.id).split(/ — |: /)[0]}」`, small: `${why} · 문서 첫 화면의 지식 점검 › 이름 없는 기록` }).catch((e) => log(`이름 부탁 알림 실패: ${e.message}`))
    }
  }
  // 받을 글 하나의 이름 — 글의 ## 머리 · 제목 조각이 받는 지식의 이름(값 · 보이는 이름 · 다른 이름)과 꼭 맞는 것
  function recvTouches(k, it) {
    const heads = [...String(it.body || '').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
    const words = [...heads, ...String(it.title || '').split(/\s+—\s+|:\s+/)]
    return [...new Set(words.flatMap((w) => exact(k, w).map((x) => x.coord)).filter(Boolean))]
  }
  // 고른 것 → 보낼 글(보내기 · 보내기 미리 보기가 같은 계산)
  function pickedItems(k, docs, recs) {
    const pickDocs = (Array.isArray(docs) ? docs : []).map((x) => k.byDocPath.get(String(x?.path || ''))).filter(Boolean)
    const recIds = [...new Set((Array.isArray(recs) ? recs : []).map(String))].filter((x) => { const w = k.byWork.get(x); return w && !isSystemRecord(w) && !w.tags.some((t) => t.startsWith('sent/')) })
    return [...pickDocs.map((d) => sendLib.docItem(k, d)), ...recIds.map((x) => sendLib.recItem(k, k.byWork.get(x)))].flatMap((it) => sendLib.split(it))
  }
  async function deliver(ctx, d, payload) {
    if (!d.url) return hub.receive(ctx, d.kn, payload)
    const key = process.env.KMD_SEND_KEY || (await keystore.get(keystore.keyName(d.url)).catch(() => null))
    return sendLib.post(d.url, d.kn, payload, key)
  }
  // 받는 쪽이 몇 개만 거절했다(r.bad) — 그것만 fail 줄로(사람이 [다시] · [버리기]) · 없으면 null
  function badOf(to, payload, r) {
    const bad = (Array.isArray(r?.bad) ? r.bad : []).filter((b) => payload.items[b?.i])
    if (!bad.length) return null
    return waitOf(to, { ...payload, items: bad.map((b) => payload.items[b.i]) }, Object.assign(new Error(bad.map((b) => String(b.why || '받지 않았다')).join(' · ')), { status: 400, reach: true }))
  }
  // 보낼 곳마다 묶음으로 — 보낸 수 · 닿지 않아 둔 수(wait) · 거절된 수(fail) · 대기 줄(상태 파일에 넣는 것은 부르는 쪽)
  async function deliverAll(ctx, meta, dests, items) {
    let sent = 0
    let wait = 0
    let fail = 0
    let unnamed = 0 // 받은 쪽(팀) 장부에서 이름을 못 찾은 수 — 받은 쪽 가드가 「이름 없음 — 받음」 으로 붙잡아 둔 것
    const why = []
    const waits = []
    for (const d of dests) {
      for (const part of sendLib.chunks(items)) {
        const payload = { from: meta.name, items: part }
        try {
          const res = await deliver(ctx, d, payload)
          unnamed += Number(res?.unnamed) || 0
          const b = badOf(d, payload, res)
          sent += part.length - (b ? b.payload.items.length : 0)
          if (b) { waits.push(b); fail += b.payload.items.length; why.push(`${d.kn}: ${b.why}`) }
        } catch (e) {
          const w = waitOf(d, payload, e)
          waits.push(w)
          if (w.state === 'wait') wait += part.length
          else { fail += part.length; why.push(`${d.kn}: ${w.why}`) }
        }
      }
    }
    return { sent, wait, fail, why, waits, unnamed }
  }
  // 보내기 상태 파일(send/<지식>.json) — 읽고 고쳐 쓰는 곳은 모두 이 줄로 · 전달(네트워크)은 줄 밖에서 하고 결과만 안에서 합친다
  //   (보내기 · 저절로 다시 · [다시] · [버리기]가 서로의 대기 줄 · 보낸 표시를 덮어쓰지 않게)
  const sendState = (id, f) => serial(`send:${path.resolve(dataDir)}:${id}`, async () => {
    const st = await sendLib.readState(dataDir, id)
    const r = await f(st)
    await sendLib.writeState(dataDir, id, st)
    return r
  })
  let sendTimer = null
  let retrying = null // 도는 중인 저절로 다시 — 분마다 걸어도 겹쳐 돌지 않는다
  const srcRuns = new Map() // 가져올 곳마다 도는 중인 것(한 줄로 세운다)
  const srcBusy = new Map() // 그중 지금 실제로 도는 것 — 「지금 하는 일」 팝업
  const curating = new Map() // 바로 넣기(정리)가 도는 지식 → 시작 시각
  const curateQ = new Map() // 그 바로 넣기의 일 줄 id(지금 하는 일 → 일 줄)
  const adding = new Set() // 막 더하는 중인 곳 — 시계 · 켤 때 확인이 끼어들지 않게
  const declWarned = new Map() // 지식 → 알린 장부 깨짐(정기 가져오기가 분마다 같은 줄을 적지 않게)
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

  // ── 저장 문(S4 · docs/품질개선/KMD_개편_설계.md 3-3) ──
  // 저장 속도(S-D28) — 지식 + 기기(없으면 사람)마다 토큰 통. 토큰은 await 앞에서 동기로 뺀다(MCP 묶음이 동시에 돈다)
  const rates = new Map()
  const SAVE_CHANNELS = new Set(['session', 'bulk', 'http', 'send'])
  // 들이기 일감의 채널(측정 줄 · 속도 한도는 세지 않는다 · 비용 한도는 openJob)
  const INTAKE_CHANNELS = new Set(['intake-file', 'intake-src', 'intake-fix', 'intake-again', 'polish'])
  function rateTake(ctx, id, n = 1) {
    const per = Number((config.saveRate ?? { perMin: 30 }).perMin ?? 30)
    if (!(per > 0)) return
    const key = `${id}\n${ctx.device ? 'd:' + ctx.device : 'u:' + ctx.user}`
    const now = Date.now()
    const rate = per / 60_000
    const b = rates.get(key) || { tokens: per, at: now }
    b.tokens = Math.min(per, b.tokens + (now - b.at) * rate)
    b.at = now
    if (b.tokens < n) {
      rates.set(key, b)
      const retryAfter = Math.max(1, Math.ceil((n - b.tokens) / rate / 1000))
      throw new KmdError('E_RATE', `저장이 너무 잦다. ${retryAfter}초 뒤에 다시 보낸다`, { details: { retryAfter } })
    }
    b.tokens -= n
    rates.set(key, b)
    // 오래 안 쓴 통은 걷는다(가득 찬 통은 없는 것과 같다)
    if (rates.size > 2000) for (const [x, v] of rates) if (now - v.at > 120_000) rates.delete(x)
  }
  // 측정 줄(S-D29) — <data>/savelog/<지식>.jsonl 덧붙이기 · 5MB 넘으면 .1 로 · 던지지 않는다(커밋 뒤 · S-D49)
  const SAVELOG_MAX = config.savelogMax ?? 5 * 1024 * 1024
  async function savelog(id, line) {
    const dir = path.join(dataDir, 'savelog')
    const f = path.join(dir, `${encodeURIComponent(id)}.jsonl`)
    await serial('savelog:' + f, async () => {
      await fs.mkdir(dir, { recursive: true })
      const st = await fs.stat(f).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
      if (st && st.size > SAVELOG_MAX) await fs.rename(f, f + '.1')
      await fs.appendFile(f, JSON.stringify(line) + '\n')
    })
  }
  // 되돌림 — 그 문서에서 7일 안에 되돌린 수(줄 안에서 새로 읽은 지식으로)
  const revertsIn = (k, doc) => revertsOfDoc(k, doc)
  // 섞인 자리(S-D55) — 그 항목에 아직 안 들어간 개편 전 기록(제안 칸이 없는 것) · held · memo · fixed · reverted 는 상태가 달라 빠진다
  function legacyPendOf(k, at, coord) {
    const coords = coord ? [coord] : at.sec && at.docObj ? coordsOfSection(k, at.docObj, at.sec.h) : []
    const tag = at.docObj ? atTag(at.docObj.id, at.heading) : null
    return k.works.filter((w) => isLegacy(k, w) && !String(w.body).includes('## ' + PROPOSAL_PART) && (w.touches.some((c) => coords.includes(c)) || (tag && w.tags.includes(tag))) && !reflectedIn(k, w, at.sec)).map((w) => w.id)
  }
  // 같은 저장(S-D16 · S-D48) — 같은 파일 지문(md/ + 같은 ingest/) · 보낸 지문(sent/) · 일감(job/)을 단 기록이 이미 있나.
  //   같은 사람이 쓴 기록이거나 서버가 붙인 들이기 기록만 본다 · 넣지 못함 · 바로잡힘이 된 기록은 다시 보낼 수 있다
  function sameKey(k, record, user) {
    const tags = (Array.isArray(record?.tags) ? record.tags : []).map((t) => String(t).trim())
    const md = tags.find((t) => /^md\/[0-9a-f]{16}$/.test(t))
    const ing = tags.find((t) => t.startsWith('ingest/'))
    const sent = tags.find((t) => /^sent\/[0-9a-f]{16}$/.test(t))
    const job = tags.find((t) => /^job\/[A-Za-z0-9_-]{1,64}$/.test(t))
    if (!md && !sent && !job) return null
    const hit = k.works.find((w) => (w.author === user || w.tags.includes('intake')) && w.state !== 'held' && w.state !== 'fixed' && ((md && w.tags.includes(md) && (!ing || w.tags.includes(ing))) || (sent && w.tags.includes(sent)) || (job && w.tags.includes(job))))
    return hit ? hit.id : null
  }
  // 조각 판정(팀만 · S-D52) — 쓰지 않는다 · 같은 serial 키를 잡는 것을 부르지 않는다(S-D7).
  //   newDoc — 없는 문서를 세워도 되나(지식관리자) · intake — 들이기 일감(지문이 어긋난 조각은 넣지 못함 · S-D9)
  function gatePrepare(k, input, { user, newDoc = false, intake = false } = {}) {
    const secs = Array.isArray(input.sections) ? input.sections : []
    const record = { title: String(input.record?.title || ''), body: String(input.record?.body || '') }
    const spread = secs.length > 1
    const out = []
    const held = []
    const proposals = []
    const stale = []
    // 동시 쓰기 측정(K12-4) — 어긋난 항목마다 그 항목에 지금 들어 있는 기록의 쓴 사람(savelog 에만 · 응답에는 싣지 않는다)
    const conflictWith = []
    for (let s of secs) {
      const coord = s.coord != null ? String(s.coord).trim().normalize('NFC') : null
      const at = placeOf(k, { coord, doc: s.doc, heading: s.heading })
      const where = coord || `${String(s.doc ?? '').replace(/^docs\/|\.md$/g, '')} › ${String(s.heading ?? '').trim()}`
      const row = { coord: where, ...(at ? { doc: at.doc, heading: at.heading } : {}) }
      const hold = (code, why, extra = {}) => {
        held.push({ ...(coord ? { coord } : {}), ...(at ? { doc: at.doc, heading: at.heading } : { doc: s.doc, heading: s.heading }), code, why, ...(s.base ? { base: s.base } : {}), ...(Array.isArray(s.edits) ? { edits: s.edits } : {}), ...(typeof s.content === 'string' ? { content: s.content } : {}) })
        proposals.push({ ...row, ok: false, code, why, ...extra, applied: false })
      }
      if (!at) {
        // 들어갈 문서가 없다 — 저장 단위 입력 오류(아무것도 쓰지 않는다) · 지식관리자는 새 문서를 세울 수 있다(core G4)
        if (coord) throw new KmdError('E_NOTFOUND', `「${s.coord}」 이 들어갈 문서가 정해져 있지 않다. 기록만 보내거나 문서 · 머리로 가리킨다`)
        if (!newDoc || typeof s.content !== 'string') throw new KmdError('E_NOTFOUND', `「${s.doc || ''}」 문서가 없다. 기록만 보내거나 있는 문서 · 머리로 가리킨다`)
        out.push({ doc: s.doc, heading: s.heading, content: s.content })
        proposals.push({ ...row, ok: true, changed: [] })
        continue
      }
      const legacyPend = legacyPendOf(k, at, coord)
      let r
      if (Array.isArray(s.edits)) {
        r = checkProposal(k, { coord, doc: at.doc, heading: at.heading, base: s.base, edits: s.edits, record, spread, legacyPend })
        // 들이기(claude -p 일감) — 읽은 뒤 바뀐 항목이면 같은 조각을 새 글에 Claude 없이 한 번 다시 댄다(S-D9 · K2-3) · 그래도 안 되면 넣지 못함
        if (!r.ok && r.stale && intake && at.sec) {
          const again = checkProposal(k, { coord, doc: at.doc, heading: at.heading, base: sha16(at.sec.body), edits: s.edits, record, spread, legacyPend })
          r = again.ok ? { ...again, warnings: [...(again.warnings || []), '읽은 뒤 바뀐 항목: 같은 조각을 새 글에 다시 대어 넣었다'] } : { ...again, ok: false, code: 'conflict', why: `그사이 항목이 바뀌었다. 같은 조각을 새 글에 다시 대지 못했다: ${again.why}` }
          if (r.ok) s = { ...s, base: sha16(at.sec.body) }
        }
      } else {
        r = checkSection(k, { doc: at.doc, heading: at.heading, base: s.base, content: s.content, record, spread, legacyPend })
        if (r.ok) r.text = s.content
      }
      if (!r.ok) {
        if (r.stale && !intake) {
          stale.push(where)
          conflictWith.push({ coord: where, by: (at.sec?.applied && k.byWork.get(at.sec.applied)?.author) || null })
          proposals.push({ ...row, ok: false, code: 'conflict', why: r.why, stale: true, applied: false })
          continue
        }
        hold(r.code || 'values', r.why, r.near ? { near: r.near } : {})
        continue
      }
      // 되돌림 잦은 문서(S-D11) — 값을 바꾸는 조각만
      if (r.changed?.length && revertsIn(k, at.doc) >= 2) {
        hold('reverts', '7일 안에 두 번 되돌린 문서: 값 바꿈은 넣지 않았다', { changed: r.changed })
        continue
      }
      // 저절로 채우는 표 — 고치지 않았으면(checkSection 이 견줬다) 표를 뗀 글로 보낸다(저장이 원래 표를 되붙인다)
      let text = r.text
      if (hasBlockMarker(text)) text = splitBlocks(text).text.replace(/\u0000block\d+\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim()
      out.push({ ...(coord ? { coord } : { doc: at.doc, heading: at.heading }), content: text, ...(at.sec ? { base: s.base } : {}) })
      proposals.push({ ...row, ok: true, changed: r.changed || [], ...(r.warnings ? { warnings: r.warnings } : {}), ...(r.lint ? { lint: r.lint } : {}) })
    }
    if (stale.length) throw Object.assign(new KmdError('E_CONFLICT', `읽은 뒤 바뀐 항목이 있다: ${stale.slice(0, 3).join(' · ')}. section 으로 다시 읽고 다시 보낸다(아무것도 쓰지 않았다)`, { details: { stale, proposals } }), { conflictWith })
    // 빠진 값(spread) — 기록이 적은 새 값을 넣는 모든 글을 합친 데서 한 번 본다 → 없으면 기록 단위 넣지 못함(S-D51)
    if (spread && out.length) {
      const all = valuesOf(out.map((x) => `${x.heading || ''}\n${x.content}`).join('\n') + ' ' + out.map((x) => x.coord || '').join(' '))
      const heads = valuesOf(proposals.map((p) => p.heading || '').join(' '))
      const missing = mustValues(record.body).filter((v) => !all.has(v) && !heads.has(v))
      if (missing.length) held.push({ code: 'values', why: `기록의 값이 글에 없다: ${missing.slice(0, 3).join(' · ')}` })
    }
    return { sections: out, held, proposals }
  }

  // hub.save 의 몸(meta · 자리 · 속도를 넘은 뒤) — 커밋 뒤는 던지지 않는다(S-D49)
  async function saveIn(ctx, id, meta, input, opt, channel, logLine, t0) {
    // form — 세션(MCP)의 기록 글은 서식 칸으로(작성기준 6절 · 템플릿/기록.md) · 칸을 kmd 가 머리를 달아 엮는다 · 메모는 바뀐 것이 없어도 된다
    if (opt.form && input?.record && typeof input.record === 'object') {
      const b = recordBody(input.record, { memo: input.record.memo === true })
      if (b.error) throw new KmdError('E_INPUT', b.error)
      input = { ...input, record: { ...Object.fromEntries(Object.entries(input.record).filter(([x]) => !RECORD_PARTS.some(([p]) => p === x))), body: b.body } }
    }
    const shut = backup.closed(meta)
    if (shut) throw new KmdError('E_BEHIND', shut.message)
    const rec0 = input?.record && typeof input.record === 'object' ? input.record : null
    if (input?.sections != null && !Array.isArray(input.sections)) throw new KmdError('E_INPUT', 'sections 는 목록이다')
    if (input?.sections?.some((s) => s?.doc && owners.isReservedFile(String(s.doc).replace(/\.md$/, '') + '.md'))) throw new KmdError('E_FORBIDDEN', 'kmd 가 쓰는 파일이다')
    if (rec0?.memo === true && input.sections?.length) throw new KmdError('E_INPUT', '메모는 항목 글을 받지 않는다')
    // 보낸 지문(sent/)은 보내기 채널만(S-D16)
    if (!opt.system && (Array.isArray(rec0?.tags) ? rec0.tags : []).some((t) => String(t).trim().startsWith('sent/')) && channel !== 'send') throw new KmdError('E_INPUT', 'sent/ 표지는 보내기만 단다')
    const team = mode === 'team' && !opt.system
    // 들이기 일감의 저장(S-D19 · S-D43) — 자리는 intakeCtx 가 일감을 끝낼 때 정했다 · 예약 사람 kmd · 저장 문이 붙이는 태그 · 새 문서를 세운다
    const intake = opt.intake && ctx.intake ? opt.intake : null
    const rctx = intake ? undefined : ctx
    // 바로잡기(S-D17) — fixes 가 가리키는 기록은 내가 쓴 것이거나 내가 그 지식의 지식관리자일 때만 · 좌표정정 판정을 건너뛸지(correction)는 서버가 정한다
    let correction = false
    if (team && Array.isArray(rec0?.fixes) && rec0.fixes.length) {
      const k0 = await hub.get(id, rctx)
      const admin = !!intake || levelFor(id, ctx) === 'admin'
      const ws = rec0.fixes.map((x) => k0.byWork.get(String(x).trim().normalize('NFC'))).filter(Boolean)
      if (!admin && ws.some((w) => w.author !== ctx.user)) throw new KmdError('E_FORBIDDEN', '남의 기록은 지식관리자가 바로잡는다')
      correction = ws.length === rec0.fixes.length && ws.every((w) => w.state === 'held' || w.state === 'memo')
    }
    // 이름 · 갈래 장부(names · forms)는 지식관리자만 곧바로 — 그 밖은 기록 본문 「세울 이름 · 세울 갈래」 칸으로 싣고
    //   팀이면 넣지 못함(code names · 기록 단위)으로 지식관리자에게 보인다(S-D6 · S-D51 · 장부 밖 이름이 모두의 match · section 을 깨뜨리지 않게) ·
    //   들이기의 이름은 자리와 상관없이 늘 칸으로(S-D43)
    let proposed = []
    let namesHeld = 0
    const extraHeld = intake ? [...(intake.held || [])] : []
    if ((input?.names?.length || input?.forms?.length) && !opt.system && (intake || !hub.canDirect(ctx, id))) {
      const lines = []
      const ns = (Array.isArray(input.names) ? input.names : []).filter((n) => n && n.coord && n.label)
      if (ns.length) lines.push(`## 세울 이름\n${ns.map((n) => `- ${n.label} (${n.coord})${n.doc ? ` → ${n.doc}${n.heading ? ' › ' + n.heading : ''}` : ''}${n.aliases?.length ? ` · 다른 이름 ${n.aliases.join(', ')}` : ''}`).join('\n')}`)
      namesHeld = ns.length
      proposed = ns.map((n) => String(n.coord))
      const fs0 = (Array.isArray(input.forms) ? input.forms : []).filter((f) => f && f.name)
      if (fs0.length) lines.push(`## 세울 갈래\n${fs0.map((f) => `- ${f.name}${f.aliases?.length ? ` · 다른 이름 ${f.aliases.join(', ')}` : ''}${f.folder ? ` · 폴더 ${f.folder}` : ''}${f.kind ? ` · ${f.kind}` : ''}${f.pattern ? ` · 이름 ${f.pattern}` : ''}`).join('\n')}`)
      const { names: _n, forms: _f, ...rest } = input
      input = { ...rest, record: { ...rec0, body: `${rec0?.body || ''}\n\n${lines.join('\n\n')}`.trim() } }
      if (team && lines.length) extraHeld.push({ code: 'names', why: `세울 ${ns.length ? `이름 ${ns.length}` : ''}${ns.length && fs0.length ? ' · ' : ''}${fs0.length ? `갈래 ${fs0.length}` : ''} 이 있다: 지식관리자가 세운다` })
    }
    let r0
    if (team) {
      // 조각의 모양 — core 는 edits 를 모른다(prepare 가 새 글로 바꾼다) · 그래서 입력 조각은 여기서 본다
      const secs = Array.isArray(input.sections) ? input.sections : []
      if (secs.length > SECTIONS_MAX) throw new KmdError('E_INPUT', `항목은 한 번에 ${SECTIONS_MAX}개까지 보낸다`)
      for (const s of secs) {
        if (!s || typeof s !== 'object' || Array.isArray(s)) throw new KmdError('E_INPUT', '항목마다 { coord | doc · heading, base, edits | content } 이다')
        if (s.coord == null && (s.doc == null || s.heading == null)) throw new KmdError('E_INPUT', '항목은 이름(coord) 또는 문서 · 머리(doc · heading)로 가리킨다')
        if (s.coord != null && typeof s.coord !== 'string') throw new KmdError('E_INPUT', '이름(coord)은 글이다')
        if (s.doc != null && typeof s.doc !== 'string') throw new KmdError('E_INPUT', '문서(doc)는 글이다')
        if (s.heading != null && (typeof s.heading !== 'string' || !s.heading.trim() || /[\r\n]/.test(s.heading))) throw new KmdError('E_INPUT', '머리는 한 줄 글이다')
        if (s.base != null && !(typeof s.base === 'string' && /^[0-9a-f]{16}$/.test(s.base))) throw new KmdError('E_INPUT', 'base 는 읽을 때 받은 16자 지문이다')
        if (s.remove || s.rename != null) throw new KmdError('E_FORBIDDEN', '항목 지우기 · 이름 바꾸기는 화면의 고치기로 한다')
        if (Array.isArray(s.edits)) {
          if (s.content != null) throw new KmdError('E_INPUT', '조각(edits)과 새 글(content)은 하나만 보낸다')
          const v = validEdits(s.edits)
          if (!v.ok) throw new KmdError('E_INPUT', `「${s.coord || s.heading}」 조각: ${v.why}`)
        } else if (typeof s.content !== 'string') throw new KmdError('E_INPUT', '항목마다 edits(바꿀 조각) 또는 content(새 글)가 있다')
      }
      const prepare = async () => {
        // 줄 안 · 남은 저널을 되돌린 뒤 — hub.get 캐시가 아니라 새로 읽는다(S-D7 · 파일마다 mtime 캐시라 싸다)
        const k = await loadKnowledge(meta, { cache: files.get(id) })
        const same = sameKey(k, input.record, ctx.user)
        if (same) return { abort: { same: true, id: same } }
        const p = gatePrepare(k, input, { user: ctx.user, newDoc: intake ? true : hub.canDirect(ctx, id), intake: !!intake })
        return extraHeld.length ? { ...p, held: [...p.held, ...extraHeld] } : p
      }
      if (!files.has(id)) files.set(id, new Map())
      r0 = await coreSave(meta.dir, { record: input.record, sections: [], names: input.names, forms: input.forms, ...(input.attach ? { attach: input.attach } : {}) }, { user: ctx.user, guard: opt.guard || 'hold', holdWhy: opt.holdWhy || null, proposed, prepare, partial: true, correction, ...(intake ? { intake: { tags: intake.tags || [] } } : {}), onCommit: () => cache.delete(id) })
      if (r0.same) {
        cache.delete(id)
        if (channel) {
          try { await savelog(id, { ...logLine, rec: r0.id, n: 0, put: 0, held: [], stale: [], memo: false, same: true, ms: Date.now() - t0, err: null }) } catch (e) { log(`저장 측정 줄을 쓰지 못했다 ${id}: ${e.message}`) }
        }
        return { same: true, id: r0.id, docs: [], note: '같은 것을 이미 저장했다. 다시 쓰지 않았다', warnings: [] }
      }
    } else {
      r0 = await coreSave(meta.dir, input, { user: ctx.user, system: !!opt.system, guard: opt.guard || 'hold', holdWhy: opt.holdWhy || null, proposed })
    }
    // ── 여기부터 던지지 않는다(S-D49): 하나씩 try/catch + log ──
    cache.delete(id)
    const held = r0.held || []
    // 조각마다 결과 — 넣었나(넣은 것 칸) · 저장이 넣지 못함으로 돌렸나(원본이 주인 · 문서 꼴)
    const proposals = (r0.proposals || []).map((p) => {
      if (!p.ok) return p
      const same = (x) => x.doc === p.doc && (x.heading === p.heading || headingMatches(x.heading || '', p.heading || '') || headingMatches(p.heading || '', x.heading || ''))
      const h = held.find(same)
      if (h) return { ...p, ok: false, code: h.code, why: h.why, applied: false }
      return { ...p, applied: (r0.putRows || []).some((x) => !p.doc || same(x)) }
    })
    const put = r0.put ?? r0.docs.length
    // 조각 없이 남긴 사람 기록은 S13 까지 정리가 넣는다(S-D3 은 S13 에 켠다)
    const bare = !(Array.isArray(input?.sections) && input.sections.length) && !put && !held.length
    const note = team
      ? r0.memo ? '메모로 남겼다. 문서는 바꾸지 않았다' : `${bare ? `기록했다. 조각이 없어 문서는 아직 그대로다: ${hub.pendText(id)}` : `저장했다. 기록 1 · 넣음 ${put} · 넣지 못함 ${held.length}`}${namesHeld ? ` · 이름 ${namesHeld} 은 아직 세우지 않았다. 기록에 실어 두었고 지식관리자가 세운다(그 전에는 match 로 찾지 못한다)` : ''}`
      : null
    if (channel) {
      // 측정 줄(S-D29) — conflictWith 는 E_CONFLICT 때만 · 들이기 비용은 S7
      //   ok — 넣은 자리(scripts/savelog.mjs 의 「다시 넣은 비율」 이 같은 자리를 짝짓는다) · held 의 why 는 앞 40자(까닭 상위)
      //   cost — 들이기 일감이면 일꾼이 알린 claude 비용 합 · 횟수(S-D29 · 2-5) · warn — 새 항목을 세우며 이름을 싣지 않았다(names-missing · S-D32)
      try { await savelog(id, { ...logLine, rec: r0.id, n: Array.isArray(input?.sections) ? input.sections.length : 0, put, ok: proposals.filter((p) => p.applied).map((p) => p.coord), held: held.map((x) => ({ code: x.code, ...(x.coord ? { coord: x.coord } : x.doc ? { coord: `${x.doc}${x.heading ? ` › ${x.heading}` : ''}` } : {}), ...(x.why ? { why: String(x.why).slice(0, 40) } : {}) })), stale: [], conflictWith: [], memo: !!r0.memo, same: false, ms: Date.now() - t0, err: null, cost: intake?.cost || null, ...(intake?.warn?.length ? { warn: intake.warn } : {}) }) } catch (e) { log(`저장 측정 줄을 쓰지 못했다 ${id}: ${e.message}`) }
    }
    // 그 사람의 「오늘 바뀐 것」 한 줄 — 본인 줄만(남에게 알리지 않는다 · K-D13)
    const title = input?.record?.title || ''
    const short = title.split(/ — |: /)[0]
    const line = team && (put || held.length)
      ? { kind: 'save', rec: r0.id, kn: id, dot: held.length ? 'warn' : 'acc', text: `저장: ${meta.name} 「${short}」`, small: `넣음 ${put} · 넣지 못함 ${held.length}` }
      : !r0.docs.length
        ? { kind: 'save', rec: r0.id, kn: id, dot: r0.memo ? 'acc' : 'pend', text: `${meta.name}에 기록: 「${short}」`, small: r0.memo ? '메모: 문서는 바꾸지 않았다' : hub.pendText(id) }
        : { kind: 'save', rec: r0.id, kn: id, dot: 'acc', text: `저장: ${meta.name} › ${r0.docs.map((p) => p.replace(/^docs\/|\.md$/g, '')).join(' · ')} 「${short}」`, small: '문서에도 넣었다' }
    //   기다리지 않는다(옛 판처럼) — 파일 넣기는 이 저장 바로 뒤에 그 기록을 들이므로 그 사이를 늘리지 않는다
    try { feed.add(dataDir, ctx.user, line).catch((e) => log(`오늘 바뀐 것 줄을 쓰지 못했다 ${id}: ${e.message}`)) } catch (e) { log(`오늘 바뀐 것 줄을 쓰지 못했다 ${id}: ${e.message}`) }
    // 결정 규칙은 넣은 파일(ingest/) 저장 뒤에만(S4 · 사람 기록의 판정은 S13 에 걷는다)
    if ((input?.record?.tags || []).some((t) => String(t).startsWith('ingest/'))) scheduleDecide(id)
    // 이 PC · 팀 서버의 개인 지식 — 남은 기록은 바로 문서에(뒤에서) · 팀 지식은 정리 방식이 「실시간」 이면 조용해진 뒤
    try {
      if (mode === 'pc' && !opt.system && !opt.noCurate) hub.curateSoon(id).catch((e) => log('바로 넣기', id, e.message))
      else if (mode === 'team' && !opt.system && !intake && hub.tidyModeOf(id) === 'live') hub.liveSoon(id)
    } catch (e) { log(`정리 걸기 실패 ${id}: ${e.message}`) }
    // 백업 — 3초까지 기다린다(경고를 응답에 싣게) · 여럿을 받는 길(receive)은 끝에 한 번
    let backupLines = []
    try {
      if (backup.attached(meta)) await Promise.race([backup.enqueue(meta, { log }), new Promise((ok) => setTimeout(ok, 3000).unref?.())])
      backupLines = backup.lines(meta, { name: meta.name }).map((l) => l.text)
    } catch (e) { log(`백업 걸기 실패 ${id}: ${e.message}`) }
    const { proposals: _p, warnings: w0, ...rest } = r0
    return {
      ...rest,
      ...(proposals.length ? { proposals } : {}),
      ...(namesHeld ? { namesHeld } : {}),
      ...(note ? { note } : {}),
      warnings: [...(r0.formatKept || []), ...(r0.docLint || []), ...(r0.guardWarn || []), ...(w0 || []), ...backupLines],
    }
  }

  // ── 들이기 일감 도우미(S7) ──
  // 가져오기 요약 — 넣음 · 넣지 못함 · 들이기에 넘김 · 기록(이 PC)
  const intakeSum = (r) => [r.put ? `넣음 ${r.put}` : '', r.held ? `넣지 못함 ${r.held}` : '', r.queued ? `들이기에 넘김 ${r.queued}` : '', r.record ? `기록 ${r.record}` : '', r.fail ? `못 들임 ${r.fail}` : ''].filter(Boolean).join(' · ')
  // 팀 — 들어온 것마다 들이기 일감(작성자 kmd · 가져오기 일 줄에 결과 한 줄) · 파일은 파일 넣기와 같은 글 바꾸기(planImport · 파일 하나)
  const teamIntake = (id, s, qj) => async (item) => {
    if (item.kind === 'file') {
      const k1 = await hub.get(id)
      const plan = await planImport(k1, [{ path: item.rel, data: item.data }], { direct: false, asRecord: true, convert: true, mdOf: null })
      const row = plan.rows[0] || {}
      const rec = plan.records[0]
      if (!rec) return { state: row.kind === 'same' ? 'same' : row.kind === 'skip' ? 'skip' : 'fail', why: row.msg }
      const rel = rec.tags.find((t) => t.startsWith('ingest/')).slice(7)
      const sha = (rec.tags.find((t) => t.startsWith('md/')) || '').slice(3)
      const r = await hub.openJob(id, { type: 'file', by: 'kmd', auto: true, src: { rel, sha, title: path.posix.basename(rel), file: item.rel, src: s.name }, md: rec.body, bin: item.data, qj: qj.id })
      return { state: r.state, ...(r.rec ? { recId: r.rec } : {}), ...(r.job ? { job: r.job } : {}), ...(r.why ? { why: r.why } : {}) }
    }
    const raw = item.raw
    const r = await hub.openJob(id, { type: 'commit', by: 'kmd', auto: true, src: { src: s.name, commit: String(item.info?.sha || ''), title: raw.title, touches: raw.touches || [] }, md: raw.body, qj: qj.id })
    return { state: r.state, ...(r.rec ? { recId: r.rec } : {}), ...(r.job ? { job: r.job } : {}), ...(r.why ? { why: r.why } : {}) }
  }
  // 이 PC — 지금 길 그대로(K-D8): 파일은 파일 넣기(Claude Code · 저장 즉시 넣기) · 커밋은 분석(켰으면) → 기록(저장 즉시 넣기가 넣는다)
  const pcIntake = (id, meta, s) => {
    let n = 0 // Claude 로 다듬는 파일 수 — 한 번 가져오기에서 이어 센다(INGEST_CLAUDE_MAX)
    return async (item) => {
      if (item.kind === 'file') {
        const r = await hub.importFiles({ user: 'kmd', admin: true }, id, [{ path: item.rel, data: item.data }], { system: true, offset: n })
        const row = r.rows[0] || {}
        if (row.kind === 'record' || row.kind === 'run' || row.kind === 'doc') n++
        const state = { doc: 'put', run: 'queued', record: 'record', same: 'same', skip: 'skip', att: 'skip' }[row.kind] || 'fail'
        return { state, ...(row.rec ? { recId: row.rec } : {}), ...(row.run ? { run: row.run } : {}), ...(state === 'fail' || state === 'skip' ? { why: row.msg } : {}) }
      }
      const raw = item.raw
      let rec = raw
      let note = null
      if (hub.meaningOk(id) && item.diffs?.length) {
        rec = (await hub.analyzeCommit(id, s.name, item.info, item.diffs, raw).catch((e) => (log('커밋 분석', id, e.message), null))) || raw
        note = rec === raw ? '요약 못함. 차이 그대로 기록한다' : `요약: ${rec.title.split(/ — |: /)[0]}`
      }
      const saved = await coreSave(meta.dir, { record: rec.touches?.length ? rec : { ...rec, touchesEmpty: `가져올 곳 ${s.name}: 걸린 이름이 없다` } }, { user: 'kmd', system: true })
      return { state: 'record', recId: saved.id, note: [note, `기록 저장 · ${rec.touches?.length ? `걸린 항목 ${rec.touches.join(' · ')}` : '걸린 항목 없음. 저장 즉시 넣기가 넣을 문서를 찾는다'}`].filter(Boolean).join('\n') }
    }
  }
  // 고쳐 쓸 수 있는 넣지 못함(값 · 꼴 · 조각) — 마지막 전에는 저장하지 않고 일꾼에게 { fix } 로 돌려준다(S-D20)
  const FIX_CODES = new Set(['values', 'format', 'edits'])
  // 일꾼이 알리는 실패 까닭(S-D54) — login · limit · missing 은 일꾼이 쉰다(일감은 다시 기다림)
  const INTAKE_FAIL = new Set(['login', 'limit', 'missing', 'budget', 'timeout', 'fail', 'shape'])
  const intakeChannel = (j) => (j.type === 'polish' ? 'polish' : j.auto ? 'intake-src' : `intake-${j.type}`)
  // 저장 문이 붙이는 예약 태그(S-D43) — intake 는 core 가 늘 붙인다
  const intakeTagsOf = (j) => [`job/${j.id}`, ...(j.type === 'commit' ? ['code-change'] : []), ...(j.type === 'polish' ? ['polish'] : [])]
  function intakeJobOf(dctx, id) {
    if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
    const j = jobs.get(dctx.draft.job)
    if (!j || j.kind !== 'intake') throw new KmdError('E_INPUT', '들이기 일감이 아니다')
    if (j.state !== 'running') throw new KmdError('E_CONFLICT', '이 일감은 지금 맡은 것이 아니다')
    return j
  }
  // 가져오기 일 줄(있으면)에 한 줄 — 들이기 일감은 일 줄에 따로 서지 않는다
  function intakeLine(j, k, x) {
    const qj = j.qj ? Q.get(j.qj) : null
    if (qj) Q.line(qj, k, `${String(j.src?.title || j.src?.rel || '').slice(0, 80)}: ${x}`)
  }
  // 후보 문서 꼴(core/ingest.js ingestCandidates 와 같다)
  const candOf = (d) => ({ doc: d.path, title: d.title, sections: d.sections.filter((s) => s.h).map((s) => ({ h: s.h, body: s.body.slice(0, 1500), base: sha16(s.body) })) })
  // 재료 — 후보는 원천과 말이 겹치는 문서 다섯(원천이 건드린 이름의 문서를 앞에) · seen 이 있으면 일꾼에게 보인 후보 · 지문 그대로(글은 지금 것)
  function intakeG(k, j, md, { seen = null } = {}) {
    let docs
    if (seen) {
      docs = seen.map((x) => {
        const d = k.byDocPath.get(x.doc)
        return { doc: x.doc, title: d?.title || x.doc, sections: x.s.map(([h, base]) => ({ h, base, body: d?.sections.find((y) => y.h === h)?.body || '' })) }
      })
    } else {
      docs = ingestCandidates(k, { title: j.src?.title || '', body: md })
      for (const c of [...(j.src?.touches || [])].reverse()) {
        const x = sectionOf(k, c)
        const d = x?.loc?.doc && k.byDocPath.get(x.loc.doc)
        if (!d || /<!--\s*watched:/.test(d.intro || '')) continue
        docs = [candOf(d), ...docs.filter((y) => y.doc !== d.path)]
      }
      docs = docs.slice(0, 5)
    }
    const coords = [...(k.vocab?.coords?.entries() || [])].filter(([, v]) => !v?.deprecated).map(([c]) => c)
    return {
      type: j.type,
      src: { title: j.src?.title || '', author: j.by, date: String(j.at || '').slice(0, 16).replace('T', ' '), ...(j.src?.rel ? { file: j.src.rel, rel: j.src.rel } : {}), ...(j.src?.commit ? { commit: j.src.commit, src: j.src.src } : {}), ...(j.src?.touches ? { touches: j.src.touches } : {}), ...(j.src?.rec ? { rec: j.src.rec } : {}), type: j.type, sha: j.src?.sha, md },
      docs,
      ...formsOf(k),
      names: coords.slice(0, 200),
      kinds: [...new Set(coords.map((c) => c.split(':')[0]))],
    }
  }
  // 넣지 못함으로 끝난 들이기의 원천 — <data>/held/<지식>/<기록>.md · .bin(32MB 까지 · S-D50). 그 기록이 바로잡힘 · 버림이 되면 jobTimer 가 걷는다
  async function keepHeld(id, rec, md, bin) {
    if (!rec || /[\\/]|\.\./.test(rec)) return
    const dir = heldDir(id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${rec}.md`), String(md ?? ''))
    if (bin && bin.length <= 32 << 20) await fs.writeFile(path.join(dir, `${rec}.bin`), bin)
  }
  // 일감 닫기 — 원천 파일을 걷고(held 는 위에서 옮겼다) · 결과 · 가져오기 일 줄에 한 줄
  async function intakeClose(j, { rec = null, put = 0, held = 0, same = false, why = null }) {
    Object.assign(j, { state: 'done', done: new Date().toISOString(), worker: null, result: { rec, put, held, ...(same ? { same: true } : {}) }, ...(why ? { why } : {}) })
    for (const p of [intakeMdOf(j.id), binOf(j.id)]) await fs.rm(p, { force: true }).catch((e) => log('들이기 원천 걷기', j.id, e.message))
    intakeLine(j, held ? 'err' : 'ok', same ? '같은 것을 이미 들였다' : `넣음 ${put}${held ? ` · 넣지 못함${why ? `: ${why}` : ''}` : ''}${rec ? ` · 기록 ${rec}` : ''}`)
    saveJobs()
  }
  // 팀 시계(S-D40 의 jobTimer · S-D22) — 임대 지난 일감 · 24시간 넘게 기다린 들이기는 기록만 + 넣지 못함(worker) · 바로잡힘 · 버림이 된 넣지 못함의 원천을 걷는다
  async function jobTick() {
    sweepJobs()
    const now = Date.now()
    for (const j of [...jobs.values()]) {
      if (j.kind !== 'intake' || j.state !== 'queued' || now - Date.parse(j.at) < INTAKE_STALE_MS) continue
      j.state = 'closing'
      await hub.intakeGiveUp(j, 'worker', '팀 일꾼이 24시간 넘게 일감을 받지 않았다: 기록만 남겼다').catch((e) => { j.state = 'queued'; log('들이기 일감 닫기', j.id, e.message) })
    }
    const root0 = path.join(dataDir, 'held')
    for (const d of await fs.readdir(root0).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))) {
      const id = decodeURIComponent(d)
      const k = await hub.get(id).catch(() => null)
      if (!k) continue
      for (const f of await fs.readdir(path.join(root0, d))) {
        const rec = f.replace(/\.(md|bin)$/, '')
        const st = k.byWork.get(rec)?.state
        if (st && st !== 'held') await fs.rm(path.join(root0, d, f), { force: true })
      }
    }
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
    // 지식 추가 — 새 이름(PC: 지식 폴더 안 · 팀: 팀 지식 · 관리자만) · 내 폴더(PC 만 · 지식 폴더 안의 새 지식으로 들여온다 · 원본은 그대로)
    async addKnowledge(ctx, { kind, name, dir, empty = false }) {
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다. 여러 지식을 두려면 위 폴더에서 띄운다')
      if (kind === 'new') {
        const nm = String(name || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim()
        if (!nm || nm.length > 60 || nm.startsWith('.')) throw new KmdError('E_INPUT', '이름은 한 줄 60자 안')
        const all = await hub.list()
        let id = nm
        // 팀 서버 — 팀 지식만 선다(이름 그대로 · 주인은 만든 관리자 · 팀 모두 본다). 개인 지식은 각자의 PC 프로그램에
        if (mode === 'team' && !ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '팀 지식은 팀 서버 관리자가 세운다')
        if (mode === 'team') id = nm.replace(/[<>:"/\\|?*\s]+/g, '-')
        if (all.some((k) => k.id.toLowerCase() === id.toLowerCase())) throw new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`)
        const d = path.join(root, id)
        // 폴더를 먼저 차지한다(같은 이름 두 번 누름 — 둘째는 여기서 E_CONFLICT · 첫째의 줄을 건드리지 않는다).
        await fs.mkdir(root, { recursive: true })
        await fs.mkdir(d).catch((e) => { throw e.code === 'EEXIST' ? new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`) : e })
        let row = null
        try {
          if (mode === 'team') {
            row = { owner: ctx.user, curators: [] }
            await fs.writeFile(path.join(d, '_members.md'), owners.renderMembers(row), 'utf8')
            row = await mutateReg((next) => {
              if (next.knowledge[id]) throw new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`)
              return owners.setOwner(next, id, { owner: ctx.user })
            })
          }
          await ensureRepo(d) // 빈 폴더에서 먼저 — 만든 묶음이 만든 사람 이름으로 남게
          await fs.mkdir(path.join(d, 'docs'), { recursive: true })
          await fs.mkdir(path.join(d, 'work'), { recursive: true })
          await fs.writeFile(path.join(d, 'README.md'), `# ${nm}\n`, 'utf8')
          if (!empty) await fs.writeFile(path.join(d, 'docs', '처음.md'), `# 처음\n\n## 개요\n새 지식: 첫 문서를 쓴다.\n`, 'utf8')
          await commitPaths(d, [...(empty ? ['README.md'] : ['README.md', 'docs/처음.md']), ...(mode === 'team' ? ['_members.md'] : [])], `지식 만듦: ${nm}`, ctx.user)
        } catch (e) {
          // 내가 차지한 폴더를 지운 뒤에만 줄을 지운다(폴더가 남으면 줄도 남긴다)
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
        feed.add(dataDir, ctx.user, { kind: 'kn', kn: id, dot: 'acc', text: `지식을 추가했다: ${nm}`, small: mode === 'team' ? `팀 지식 · 팀 모두 본다 · 주인 ${ctx.user}` : d }).catch(() => {})
        return { id, name: nm, dir: mode === 'pc' ? d : undefined }
      }
      // 지식 폴더 밖의 폴더 — 그 자리에서 따라가지 않는다(남의 폴더에 쓰지 않게 · 지식은 지식 폴더 안에만).
      // 지식 폴더 안에 같은 이름의 새 지식을 세우고 그 폴더의 파일을 한 번 들여온다(파일 넣기와 같은 길 · 원본은 그대로)
      if (kind === 'folder') {
        if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '폴더 들이기는 개인 화면의 개인 지식에서 한다')
        const full = path.resolve(String(dir || ''))
        if (!path.isAbsolute(String(dir || '')) || !(await fs.stat(full).then((s) => s.isDirectory(), () => false))) throw new KmdError('E_NOTFOUND', '그 폴더가 없다')
        const inside = (a, b) => { const r = path.relative(b.toLowerCase(), a.toLowerCase()); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)) }
        if (path.parse(full).root.toLowerCase() === full.toLowerCase() || full.toLowerCase() === os.homedir().toLowerCase()) throw new KmdError('E_INPUT', '드라이브 통째 · 사용자 집 폴더 통째는 들여오지 않는다. 그 안의 폴더를 고른다')
        if (inside(full, path.resolve(root))) throw new KmdError('E_INPUT', '이미 지식 폴더 안이다. 지식 목록에서 연다')
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
              if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new KmdError('E_INPUT', `한 번에 ${MAX_FILES} 파일 · 200MB 까지: 가져오기에서 나눠 넣는다`)
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
      throw new KmdError('E_INPUT', '알아듣지 못했다. 이름 · 들일 폴더 경로를 붙인다')
    },
    // 지식 지우기 — 보관하지 않고 완전히. 지식 폴더 · kmd 가 그 지식에 대해 둔 살림(백업 연결 · 색인 · 보내기 · 정리 · 가져오기 상태 · 주인 줄)을
    // 모두 지운다. 확인은 지식 이름을 그대로 다시 쓰는 것. 백업 자리에 이미 보낸 이력은 kmd 가 지우지 않는다(백업 자리의 일).
    // 누가 — 이 PC 의 주인 · 팀은 관리자
    async deleteKnowledge(ctx, id, { confirm } = {}) {
      const meta = await hub.meta(id, ctx)
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다. 지울 수 없다')
      if (mode !== 'pc' && !ctx.pc && !ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '팀 지식은 총괄 관리자가 지운다')
      if (String(confirm ?? '').trim().normalize('NFC') !== meta.name.normalize('NFC')) throw new KmdError('E_INPUT', `지우려면 지식 이름 「${meta.name}」 을 그대로 쓴다`)
      const dir = path.resolve(meta.dir)
      const inRoot = insideDir(dir, root) && !insideDir(root, dir) // root 아래 폴더만(root 자신은 아니다)
      // 붙어 있는 것부터 떼고(감시 · 백업 · 일감 · 시계) 폴더를 지운다
      for (const w of watchers.filter((x) => x.dir && path.resolve(x.dir) === dir)) w.close()
      watchers.splice(0, watchers.length, ...watchers.filter((x) => !(x.dir && path.resolve(x.dir) === dir)))
      clearTimeout(decideTimers.get(id))
      decideTimers.delete(id)
      for (const [jid, j] of jobs) if (j.kn === id) { if (j.kind === 'intake') for (const x of ['.md', '.bin']) await fs.rm(binOf(jid).replace(/\.bin$/, x), { force: true }).catch((e) => log('들이기 원천 지우기', jid, e.message)); jobs.delete(jid) }
      await fs.rm(heldDir(id), { recursive: true, force: true }).catch((e) => log('넣지 못함 원천 지우기', id, e.message))
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
      for (const x of await listSecrets(dataDir).catch(() => [])) if (x.name.startsWith(secretPrefix(id))) await delSecret(dataDir, x.name).catch(() => {}) // 가져올 곳의 자격
      const lf = path.join(dataDir, 'links.json')
      const links = await fs.readFile(lf, 'utf8').then(JSON.parse, () => null)
      if (links) await writeJsonAtomic(lf, links.filter((l) => l.id !== id), { indent: 1 })
      if (rowFor(id)) await mutateReg((next) => { delete next.knowledge[id] })
      list = null
      feed.add(dataDir, ctx.user || 'kmd', { kind: 'kn', dot: 'acc', text: `지식을 지웠다: ${meta.name}`, small: inRoot ? '보관하지 않고 완전히' : '잇기만 끊었다. 폴더는 그 자리에 그대로' }).catch(() => {})
      log(`지식을 지웠다: ${meta.name}${inRoot ? '' : ' (잇기만 끊음)'}`)
      return { id, name: meta.name, removed: inRoot }
    },
    // 일마다 모델 — 이 PC 의 설정(pc.models) · 없으면 기본 배분
    modelOf(role) {
      return modelOf(role, mode === 'pc' ? prefs.pc?.models : null)
    },
    models() {
      return Object.fromEntries(ROLES.map((r) => [r, hub.modelOf(r)]))
    },
    async setModel(ctx, role0, model) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', 'Claude 모델은 개인 프로그램에서 고른다')
      const role = roleOf(role0) // 옛 이름 tidy → ingest(S-D39)
      if (!ROLES.includes(role)) throw new KmdError('E_INPUT', '그런 일은 없다')
      if (!CHOICES.includes(model)) throw new KmdError('E_INPUT', '고를 수 있는 모델이 아니다. haiku · sonnet · opus · 기본')
      await mutatePrefs((next) => {
        const m = ((next.pc ||= {}).models ||= {})
        m[role] = model
        if (role === 'ingest') delete m.tidy // 옛 이름 칸을 옮긴다
      })
      return { role, model }
    },
    autoOf(user, key) {
      return mode === 'pc' ? prefs.pc?.[key] !== false : prefs.users?.[user]?.[key] !== false
    },
    async setAuto(ctx, key, on) {
      const ok = mode === 'pc' ? ['save', 'file', 'src', 'claude', 'find'] : ['file', 'find']
      if (!ok.includes(key)) throw new KmdError('E_INPUT', '그런 일은 없다')
      await mutatePrefs((next) => {
        if (mode === 'pc') (next.pc ||= {})[key] = !!on
        else ((next.users ||= {})[ctx.user] ||= {})[key] = !!on
      })
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
        await writeJsonAtomic(f, m, { indent: 1 })
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
      await writeJsonAtomic(f, next, { indent: 1 })
      // 응답은 지금 보는 지식만(파일에는 옛 순서를 남긴다 — 자리를 다시 받으면 그 자리로 · 남에게 옛 id 를 보이지 않게)
      return { order: next.order.filter((x) => ids.includes(x)), hidden: next.hidden.filter((x) => ids.includes(x)) }
    },
    // kmd 가 아는 지식 폴더 — 읽기(ids 없이) · 적기(ids)
    async known(ids = null) {
      const f = path.join(dataDir, 'known.json')
      if (ids) {
        await writeJsonAtomic(f, ids)
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
        await ensureRepo(k.dir).catch((e) => log('동기화: git', k.id, e.message))
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
      if (added.length) feed.add(dataDir, ctx.user, { kind: 'kn', dot: 'acc', text: `지식 폴더를 다시 읽었다. 새 지식 ${added.length}`, small: added.map((k) => k.name).join(' · ') }).catch(() => {})
      return { added: added.map((k) => ({ id: k.id, name: k.name })), gone, total: now.length }
    },
    // 그 사람이 보는 지식들 — 읽기 자리 이상
    async visible(ctx) {
      if (ctx?.agent) return (await hub.list()).filter((k) => k.id === ctx.agent.kn)
      return (await hub.list()).filter((k) => visibleTo(k.id, ctx))
    },
    // 지식 하나 — ctx 가 있으면 읽기 자리 미만은 「없는 지식」 과 같게(있는지조차 드러내지 않게) · ctx 없이는 안의 일
    async meta(id, ctx) {
      const m = (await hub.list()).find((k) => k.id === id)
      if (!m) throw new KmdError('E_NOTFOUND', `지식 「${id}」 이 없다`)
      if (ctx?.agent && ctx.agent.kn !== id) throw new KmdError('E_FORBIDDEN', '이 일은 다른 지식에 쓰지 않는다')
      if (ctx && !ctx.agent && !visibleTo(id, ctx)) throw new KmdError('E_NOTFOUND', `지식 「${id}」 이 없다`)
      return m
    },
    // 그 지식에서의 자리 — 'none' | 'read' | 'write' | 'admin'
    levelOf(ctx, id) {
      return levelFor(id, ctx)
    },
    // 쓰기 · 관리 길의 문 — 모자라면 E_FORBIDDEN(읽기도 없으면 「없는 지식」)
    need(ctx, id, lvl = 'write') {
      const l = levelFor(id, ctx)
      if (!owners.atLeast(l, 'read')) throw new KmdError('E_NOTFOUND', `지식 「${id}」 이 없다`)
      if (!owners.atLeast(l, lvl)) throw new KmdError('E_FORBIDDEN', lvl === 'admin' ? '이 지식의 지식관리자가 아니다' : `이 지식에 ${owners.LEVEL_WORD[lvl] || lvl} 자리가 없다`, { need: lvl })
      return l
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
    // 지식 안에서의 내 자리 이름 — 팀은 읽기 · 쓰기 · 관리(levelOf) · 이 PC 는 주인
    roleIn(id, ctx) {
      if (mode === 'team') return owners.LEVEL_WORD[levelFor(id, ctx)] || '없음'
      const r = rowFor(id)
      if (r?.owner && r.owner === ctx.user) return '주인'
      return '기록'
    },
    // 내 것 가운데 아직 끝나지 않은 것(K3-3 · K2-6 · brief 의 mine · you) — 안 넣은 메모 · 넣지 못함 수와 최근 것(제목 · 까닭).
    //   상태는 recordState 그대로: 나중 기록이 fixes 로 바로잡은 것은 fixed 라 세지 않는다. 팀 지식에서만(이 PC 는 곧바로 넣는다)
    mineIn(ctx, k, { recent = 0 } = {}) {
      if (mode !== 'team' || !ctx?.user) return null
      const ws = k.works.filter((w) => w.author === ctx.user && (w.state === 'memo' || w.state === 'held'))
      const out = { memos: ws.filter((w) => w.state === 'memo').length, held: ws.filter((w) => w.state === 'held').length }
      if (recent) {
        out.recent = ws.slice(0, recent).map((w) => {
          const why = w.state === 'held' ? [...new Set(parseHeld(w.body).map((x) => String(x.why || x.code || '')).filter(Boolean))].join(' · ').slice(0, 160) || '넣지 못함' : '메모: 값이 확정되면 조각과 함께 다시 저장한다'
          return { id: w.id, date: w.date, title: w.title, state: w.state === 'held' ? '넣지 못함' : '메모', why }
        })
      }
      return out
    },
    // 팀 서버의 관리자 아이디 · 지금 쓰는 사람 아이디(http 가 auth 로 채운다) — 지식의 관리 자리 사람(알림 받는 사람)을 셀 때
    admins: () => [],
    people: () => [],

    // 저장 하나 — ctx.user 가 쓴다. 모든 채널의 저장 문(docs/kmd_권한_모델.md 7절 · docs/품질개선/KMD_개편_설계.md 3-3)
    //   opt.channel — 부르는 쪽(서버 코드)이 정한다: session · bulk(MCP) · http · send(HTTP /save) · 서버 안의 저장은 없음
    //   팀(system 이 아닌 저장): 줄 안에서 새로 읽은 지식으로 조각마다 검사(gatePrepare) → 넘은 조각은 그 순간 넣고 · 못 넘은 조각은 기록에 「넣지 못함」 ·
    //   지문이 어긋나면 E_CONFLICT(아무것도 쓰지 않는다) · 이 PC 는 지금 그대로(곧바로 넣기 · S-D52)
    async save(ctx, id, input, opt = {}) {
      // 들이기 일감(ctx.intake 는 서버 코드만 단다 · intakeCtx)은 일감을 끝낼 때 그 사람의 자리를 이미 다시 읽었다(S-D43)
      const asIntake = !!(opt.intake && ctx?.intake)
      const meta = await hub.meta(id, asIntake ? undefined : ctx)
      if (ctx.agent) {
        const rec = input?.record || {}
        // 항목 글의 from(파일 글을 서버가 옮김) · append(지금 글 끝에 보탬)를 푼다 — 모델은 파일 글을 다시 쓰지 않는다
        const k0 = await hub.get(id)
        input = { ...input, sections: expandSections(k0, k0.byWork.get(ctx.agent.rec), input?.sections), record: { ...rec, tags: [...new Set([...(Array.isArray(rec.tags) ? rec.tags : []).filter((t) => !isReservedTag(t)), 'curate-llm'])], reflects: [ctx.agent.rec] } }
        const r0 = await coreSave(meta.dir, input, { user: 'kmd-auto', agent: true })
        cache.delete(id)
        const run = runs.get(ctx.agent.run)
        if (run) {
          for (const d of r0.docs) { const n = d.replace(/^docs\/|\.md$/g, ''); if (!run.docs.includes(n)) run.docs.push(n) }
          run.names += r0.names || 0
        }
        return { ...r0, warnings: [...(r0.formatKept || []), ...(r0.docLint || [])] }
      }
      if (ctx.machine && ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      if (!ctx.machine && !asIntake) hub.need(ctx, id, 'write')
      const channel = SAVE_CHANNELS.has(opt.channel) || (asIntake && INTAKE_CHANNELS.has(opt.channel)) ? opt.channel : null
      // 저장 속도(S-D28) — 바깥에서 온 저장(세션 · HTTP · 보내기)만 · 서버 안의 저장(가져오기 · 받은편지함 · 되돌리기)은 세지 않는다
      if (channel && !opt.system && !asIntake) rateTake(ctx, id)
      const t0 = Date.now()
      //   kit — 세션 스킬 판(MCP 가 넘긴 수 · 없으면 null · S-D15)
      const logLine = { at: localStamp(), kn: id, user: ctx.user || null, device: ctx.device || null, ch: channel || (opt.system ? 'system' : 'server'), kit: Number.isInteger(opt.kit) ? opt.kit : null }
      try {
        return await saveIn(ctx, id, meta, input, opt, channel, logLine, t0)
      } catch (e) {
        // 저장 전체가 실패한 것도 측정 줄로(rec 없음 · S-D29)
        if (channel && e instanceof KmdError) {
          try { await savelog(id, { ...logLine, n: Array.isArray(input?.sections) ? input.sections.length : 0, stale: e.details?.stale || [], conflictWith: e.conflictWith || [], ms: Date.now() - t0, err: e.code }) } catch (x) { log(`저장 측정 줄을 쓰지 못했다 ${id}: ${x.message}`) }
        }
        throw e
      }
    },

    // 판정만(S-D20 · 들이기 고쳐 쓰기) — 줄 안에서 prepare 만 돌고 쓰지 않는다 · 팀만
    async checkSave(ctx, id, input, opt = {}) {
      const asIntake = !!(opt.intake && ctx?.intake)
      const meta = await hub.meta(id, asIntake ? undefined : ctx)
      if (!asIntake) hub.need(ctx, id, 'write')
      if (mode !== 'team') throw new KmdError('E_INPUT', '쓰지 않고 검사만 하는 것은 팀 지식에서 한다')
      if (!files.has(id)) files.set(id, new Map())
      return serial(path.resolve(meta.dir), async () => {
        await recoverSave(meta.dir)
        const k = await loadKnowledge(meta, { cache: files.get(id) })
        const s = sameKey(k, input?.record, ctx.user)
        if (s) return { same: true, id: s }
        try {
          const p = gatePrepare(k, input || {}, { user: ctx.user, newDoc: asIntake ? true : hub.canDirect(ctx, id), intake: asIntake })
          return { ok: !p.held.length, proposals: p.proposals, held: p.held.map(({ edits, content, ...x }) => x) }
        } catch (e) {
          if (e instanceof KmdError && e.code === 'E_CONFLICT') return { ok: false, stale: e.details?.stale || [], proposals: e.details?.proposals || [] }
          throw e
        }
      })
    },

    // 지식 점검 — 지식 생성 가드가 보는 것의 지금 상태(이름 없는 기록 · 장부 밖 이름 · 이름 없는 항목 · 자리 잃은 이름 · 같은 말 여러 이름 · 깨진 머리)
    //   지식관리자만 · 목록은 줄마다 200 까지(수는 그대로)
    async guardAudit(ctx, id) {
      const k = await hub.get(id, ctx)
      hub.need(ctx, id, 'admin')
      const a = guardAudit(k, { sectionOf, coordsOfSection })
      const cut = (xs) => xs.slice(0, 200)
      return { id: k.id, name: k.name, counts: a.counts, unnamed: cut(a.unnamed), outside: cut(a.outside), deprecatedUse: cut(a.deprecatedUse), lost: cut(a.lost), noName: cut(a.noName), aliasClash: cut(a.aliasClash), sameLabel: cut(a.sameLabel), brokenHead: cut(a.brokenHead), spaced: cut(a.spaced), forms: { own: k.forms.own, rows: k.forms.rows } }
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
      // 지식마다 동시에(Q64 — 지식 수만큼 차례로 기다리지 않게) · 순서는 ks 대로
      return Promise.all(ks.map(async (m) => {
        const k = await hub.get(m.id)
        const r = await ladder(k, await hub.index(m.id), { q, words, max, learned: await learnedOf(m.id), passagesMax: hub.autoOf(ctx.user, 'find') ? 5 : 0 })
        return { knowledge: m.id, name: m.name, ...r }
      }))
    },
    async learn(ctx, id, { q, coord }) {
      await hub.meta(id, ctx)
      hub.need(ctx, id, 'write') // 찾기 학습은 지식마다 하나 — 모두의 찾기가 바뀐다
      q = String(q || '')
      coord = String(coord || '')
      if (!q.trim() || q.length > 200 || !coord || coord.length > 200) throw new KmdError('E_INPUT', '찾은 말과 항목 이름은 200자 안으로 보낸다')
      if (!sectionOf(await hub.get(id, ctx), coord.trim().normalize('NFC'))?.loc) throw new KmdError('E_INPUT', '그런 항목이 없다')
      await learn(dataDir, id, { q, coord: coord.trim().normalize('NFC'), who: ctx.user, log }).finally(() => learnedC.delete(id))
      return { ok: true }
    },
    async searchCheck(ctx, id, { freeze = false } = {}) {
      const k = await hub.get(id, ctx)
      return searchCheck(k, await hub.index(id), { dataDir, freeze })
    },
    // 옛 문서 옮기기(작성기준 10절) — 항목 끝 경과 · 「기록 그대로」 줄을 문서 끝 참고 블록으로. 그 지식의 관리 자리 · 셸만
    //   dry 면 쓰지 않고 결과만 · 본문 글이 달라지는 문서 · 원본이 주인인 문서는 옮기지 않는다 · 옮긴 것은 git 한 묶음 + 이력 하나
    async docfmt(id, ctx, { dry = false } = {}) {
      const meta = await hub.meta(id, ctx)
      if (ctx) hub.need(ctx, id, 'admin')
      if (!dry) {
        const shut = backup.closed(meta)
        if (shut) throw new KmdError('E_BEHIND', shut.message)
      }
      const r = await docfmtDir(meta.dir, { dry, user: 'kmd', by: ctx?.user && ctx.user !== 'kmd' ? ctx.user : null })
      if (r.commit) {
        cache.delete(id)
        if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      }
      return { kn: id, name: meta.name, ...r }
    },

    // 조각을 넣는 판정(S-D6) — 이 PC · 그 지식의 에이전트 · 쓰기 이상. 장부 · 되돌리기 · 받은편지함은 canDirect(지식관리자) 그대로
    canSave(ctx, id) {
      if (mode === 'pc' || ctx.pc) return true
      if (ctx.agent) return ctx.agent.kn === id
      return owners.atLeast(levelFor(id, ctx), 'write')
    },
    canDirect(ctx, id) {
      if (mode === 'pc' || ctx.pc) return true
      if (ctx.agent) return ctx.agent.kn === id
      return levelFor(id, ctx) === 'admin'
    },
    // 화면의 고치기 — sections(고친 항목) · remove(지운 항목 이름) · rename([{ from, to }] — 글은 그대로 이름만)
    //   관리자는 곧바로 문서에 · 그 밖은 기록으로(지우기 · 이름 바꾸기도 기록 글에 — 관리자가 한다)
    //   같은 사람이 같은 글을 1분 안에 다시 보내면(두 번 누름) 앞의 것을 돌려준다
    async edit(ctx, id, { doc, sections = [], remove = [], rename = [] }) {
      const k = await hub.get(id, ctx)
      hub.need(ctx, id, 'write')
      const d = k.docs.find((x) => x.id === doc)
      if (!d) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      sections = Array.isArray(sections) ? sections : []
      remove = (Array.isArray(remove) ? remove : []).map((h) => String(h || '').trim()).filter(Boolean)
      rename = (Array.isArray(rename) ? rename : []).map((x) => ({ from: String(x?.from || '').trim(), to: String(x?.to || '').trim() })).filter((x) => x.from && x.to && x.from !== x.to)
      if (!sections.length && !remove.length && !rename.length) throw new KmdError('E_INPUT', '바뀐 항목이 없다')
      const hs = sections.map((s) => String(s.h || '').trim())
      if ([...hs, ...remove, ...rename.flatMap((x) => [x.from, x.to])].some((h) => !h || /[\r\n]/.test(h))) throw new KmdError('E_INPUT', '항목 이름은 한 줄 글이다')
      for (const h of [...remove, ...rename.map((x) => x.from)]) if (!d.sections.some((s) => s.h === h)) throw new KmdError('E_CONFLICT', `「${h}」 항목이 읽은 뒤 바뀌었다. 다시 읽고 고친다`)
      const dupKey = sha(JSON.stringify([ctx.user, id, doc, sections, remove, rename]))
      const dup = editDup.get(dupKey)
      if (dup && Date.now() - dup.at < 60_000) return dup.r
      const coords = [...new Set([...hs, ...remove, ...rename.map((x) => x.from)].flatMap((h) => coordsOfSection(k, d, h)))]
      const w = watchedOf(await fs.readFile(path.join(k.dir, ...d.path.split('/')), 'utf8').catch(() => ''))
      if (w) throw new KmdError('E_FORBIDDEN', `이 문서는 원본이 주인이다: ${w.src} 의 ${w.path} 를 고친다 · 덧붙일 말은 기록으로 남긴다`)
      const what = [...hs, ...remove.map((h) => `${h} 지움`), ...rename.map((x) => `${x.from} → ${x.to}`)]
      // 문서 꼴(작성기준 7절) — 화면에서 고친 글도 본문만. 지금 글에 있던 줄은 거절하지 않는다 · 거절하면 몇째 줄 · 까닭이 화면에 나온다
      for (const s of sections) {
        const h = String(s.h || '').trim()
        checkFormat(h, String(s.body ?? ''), { doc: d.path, old: d.sections.find((x) => x.h === h)?.body ?? null })
      }
      let out
      if (hub.canDirect(ctx, id)) {
        const r = await hub.save(ctx, id, {
          record: { title: `화면에서 고침: ${d.title} 「${what.join(' · ')}」`, body: `화면에서 고쳤다: ${what.map((h) => `${d.title} › ${h}`).join(' · ')}`, touches: coords, tags: ['edit'] },
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
        const r = await hub.save(ctx, id, { record: { title: `${d.title} › ${what.join(' · ')} 고침`, body: `화면에서 남긴 기록: 정리 때 문서에 넣는다\n\n${body}`, touches: coords, ...(ats.length ? { tags: ats } : {}) } }, { guard: 'strict' })
        out = { direct: false, ...r }
      }
      editDup.set(dupKey, { at: Date.now(), r: out })
      for (const [key, v] of editDup) if (Date.now() - v.at > 60_000) editDup.delete(key)
      return out
    },
    // 되돌리기 — 그 기록이 넣은 항목을 넣기 전 글로(설계 3-4 · S-D13 · S-D14 · S-D53)
    //   { record } 만이면 통째로(판정도 거둔다 · reopens) · { record, doc, heading? } 면 그 항목만(reopens 없이 · 원 기록은 남은 항목이 있으면 「들어감」)
    //   되돌림 기록은 태그 revert · 본문 끝 「## 되돌린 항목」 · 알림 없음. 넣은 항목마다 지문(base) — 그사이 누가 고쳤으면 E_CONFLICT
    async revert(ctx, id, input) {
      const { record, doc = null, heading = null } = input && typeof input === 'object' ? input : {}
      if (typeof record !== 'string' || !record) throw new KmdError('E_INPUT', '되돌릴 기록(record)이 없다')
      const k = await hub.get(id, ctx)
      hub.need(ctx, id, 'write')
      const w = k.byWork.get(record)
      if (!w) throw new KmdError('E_NOTFOUND', '그 기록이 없다')
      // 자리(S-D13) — 지식관리자 · 그 기록을 쓴 사람 · 그 기록이 반영한 기록의 쓴 사람이 나 하나뿐
      const curator = hub.canDirect(ctx, id)
      if (!curator && w.author !== ctx.user) {
        const authors = new Set((w.reflects || []).map((x) => k.byWork.get(x)?.author).filter(Boolean))
        if (!authors.has(ctx.user)) throw new KmdError('E_FORBIDDEN', '남의 기록은 그 지식의 지식관리자가 되돌린다')
        if ([...authors].some((a) => a !== ctx.user)) throw new KmdError('E_FORBIDDEN', '이 정리에는 다른 사람의 기록도 들어 있다. 지식관리자에게 되돌려 달라고 한다')
      }
      const whole = !doc && !heading
      if (whole && k.reverted?.has(record)) throw new KmdError('E_CONFLICT', '이미 되돌렸다')
      const plan = await revertPlan(k, record, { doc, heading })
      if (!whole && !plan.sections.length) throw new KmdError('E_CONFLICT', '그 항목은 이미 되돌렸거나 그 뒤 누가 고쳤다. 이력을 다시 읽는다')
      // 지식관리자가 아니면 원본이 주인인 문서 · 저절로 채우는 표가 바뀌는 항목은 되돌리지 못한다(되돌리기는 system 저장이라 그 막기를 건너뛴다 · S-D53)
      if (!curator) {
        const meta = await hub.meta(id, ctx)
        const blocks = (t) => splitBlocks(t || '').blocks.map((b) => JSON.stringify(b)).join('\n')
        for (const p of plan.sections) {
          const text = await fs.readFile(path.join(meta.dir, p.doc), 'utf8').catch((e) => (e.code === 'ENOENT' ? '' : Promise.reject(e)))
          if (watchedOf(text)) throw new KmdError('E_FORBIDDEN', '원본이 주인인 문서는 지식관리자가 되돌린다')
          const cur = k.byDocPath.get(p.doc)?.sections.find((x) => x.h === p.heading)
          if (blocks(cur?.body) !== blocks(p.remove ? '' : p.content)) throw new KmdError('E_FORBIDDEN', '저절로 채우는 표가 바뀌는 항목은 지식관리자가 되돌린다')
        }
      }
      // 정리 기록을 통째로 되돌리면 그 정리가 넣은 기록들도 「주인이 되돌림」 — 다음 정리가 같은 초안을 다시 넣지 않게
      const used = whole && w.tags.includes('curate-llm') ? [...w.body.matchAll(/^- 넣음 (\S+)(?: —|:) /gm)].map((m) => m[1]) : []
      const name = (p) => p.doc.replace(/^docs\/|\.md$/g, '')
      const title = whole || !plan.sections.length ? `되돌림: ${w.title}` : `되돌림: ${name(plan.sections[0])} › ${plan.sections.map((p) => p.heading).join(' · ')}`
      const lines = plan.sections.map((p) => `- ${name(p)} › ${p.heading}: ${p.remove ? '그 기록이 세운 항목이라 지웠다' : '넣기 전 글로'}`)
      const body = plan.sections.length
        ? `${lines.join('\n')}\n\n${renderReverted(plan.sections.map((p) => ({ rec: record, doc: p.doc, heading: p.heading })))}`
        : '넣은 항목이 없다. 판정만 거둔다'
      const r = await hub.save(ctx, id, {
        record: { title: title.length > 200 ? title.slice(0, 199) + '…' : title, body, tags: ['revert'], ...(whole ? { reopens: [w.id, ...used] } : {}) },
        sections: plan.sections.map((p) => ({ doc: p.doc, heading: p.heading, content: p.content, applied: p.applied, base: p.base, ...(p.remove ? { remove: true } : {}) })),
      }, { system: true })
      // 통째로 되돌렸으면 「오늘 바뀐 것」 의 정리 줄에 「되돌렸다」(남은 [되돌리기] 가 빈 되돌림을 만들지 않게) — 커밋 뒤라 던지지 않는다
      if (whole) {
        try {
          const who = new Set([ctx.user, ...[...used, ...(w.reflects || [])].map((x) => k.byWork.get(x)?.author).filter(Boolean)])
          for (const u of who) for (const x of await feed.list(dataDir, u)) if (x.revert === record) await feed.mark(dataDir, u, x.id, { reverted: true })
        } catch (e) { log(`되돌린 줄 표시를 쓰지 못했다 ${id}: ${e.message}`) }
      }
      return r
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

    // ── 자동으로 가져올 곳(v0.6 §5) — 더하기는 관리자(팀) · 주인(PC) · 그 밖은 [관리자에게 부탁] ──
    async sourceCtx(id) {
      const metas = await hub.list()
      const backups = metas.map((m) => backup.stateOf(m)?.url).filter(Boolean)
      return { roots: (config.sourceRoots || []).map((r) => path.resolve(r)), dataDir, knowledgeDirs: metas.map((m) => m.dir), backups, pc: mode === 'pc' }
    },
    canSource(ctx, id) {
      return mode === 'pc' || !!ctx.pc || levelFor(id, ctx) === 'admin'
    },
    // 서버 자원에 닿는 일(아무 호스트의 포트 · 서버의 git 자격 · 서버의 폴더)은 총괄 관리자 · 셸 · PC 만.
    // 지식의 관리 자리는 허락된 호스트(sourceHosts) 안의 https git · DB 만 — 아무 주소로 서버가 대신 받아 오지 않게
    sourceServer(ctx) {
      return mode === 'pc' || !!ctx?.pc || !!ctx?.admin || !!ctx?.shell
    },
    async sourceGuard(ctx, id, { kind, at = null, host = null }) {
      if (kind === 'git' && at != null) {
        const { backups } = await hub.sourceCtx(id)
        if (backups.some((b) => repoKey(b) === repoKey(at))) throw new KmdError('E_INPUT', '이 kmd 의 백업 자리는 가져올 곳이 될 수 없다')
      }
      if (hub.sourceServer(ctx)) return
      const hosts = (config.sourceHosts || []).map((h) => String(h).trim().toLowerCase()).filter(Boolean)
      const allowed = `허락된 곳: ${hosts.length ? hosts.join(' · ') : '아직 없다(총괄 관리자가 정한다)'}`
      let h = host
      if (kind === 'git') {
        let u = null
        try { u = new URL(String(at || '').trim()) } catch {}
        if (!u || u.protocol !== 'https:') throw new KmdError('E_FORBIDDEN', '소스 코드는 https 주소만 더한다. ssh · 서버 폴더는 서버 관리자가 더한다', { need: 'admin' })
        h = u.hostname
      } else if (kind !== 'db') throw new KmdError('E_FORBIDDEN', '이 가져올 곳은 서버 관리자가 더한다', { need: 'admin' })
      if (!hosts.includes(String(h || '').toLowerCase())) throw new KmdError('E_FORBIDDEN', `이 호스트는 가져올 곳으로 허락되지 않았다. ${allowed}`, { need: 'admin' })
    },
    // 살펴보기 — 주소를 받아 어떤 규칙이 무엇을 내는지(쓰지 않는다)
    async sourceProbe(ctx, id, { at, kind = null }) {
      await hub.meta(id, ctx)
      const k2 = kind || 'git'
      const t = checkTarget(at, { kind: k2, ...(await hub.sourceCtx(id)) })
      await hub.sourceGuard(ctx, id, { kind: k2, at: t.url || t.folder })
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
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 관리자가 더한다. [관리자에게 부탁]')
      name = String(name || '').trim()
      if (!name || name.length > 60 || /[\r\n"]/.test(name)) throw new KmdError('E_INPUT', '이름은 한 줄 60자 안')
      const pcScreen = mode === 'pc' || ctx.pc
      if ((cred?.password || cred?.token || db?.password) && !pcScreen) throw new KmdError('E_FORBIDDEN', `자격은 화면으로 받지 않는다. 서버에서 한 줄: kmd secret set ${secretName(id, name)}`)
      const k2 = kind || (db ? 'db' : 'git')
      // 소스 코드는 git 하나 — 커밋 이력으로 바뀐 것만(정정 2026-10-23 · 코드 폴더 · 라이브러리 버전 · 표 파일은 걷었다)
      if (k2 === 'folder') throw new KmdError('E_INPUT', '소스 코드는 git 저장소로 받는다. 올라온 묶음으로 바뀐 것을 본다 · 이 PC 폴더면 그 폴더의 git 저장소 경로를 넣는다')
      if (k2 === 'git') rules = []
      // 옛 PC 폴더(PC 가 파일을 팀으로 보내기)는 걷었다 — 파일을 나르는 것은 이 서비스의 일이 아니다 · 지식은 「보내기」 로
      if (k2 === 'pc') throw new KmdError('E_INPUT', '옛 PC 폴더는 없다. 내 지식에서 만든 기록 · 문서를 「보내기」 로 보낸다')
      // 파일 목록(files)은 걷었다(감시 검토 v0.1 — 값보다 소음) · 표 파일(tables)은 사람이 고른 파일 · 폴더만
      // docs — 문서 폴더(지식 안 그 폴더로 사본 문서) · pc — 옛 PC 폴더(팀 · 관리자 · PC 프로그램이 기계 열쇠로 보낸다 · 결정 ④)
      if (k2 === 'pc' && (mode !== 'team' || !ctx.admin)) throw new KmdError('E_FORBIDDEN', '옛 PC 폴더는 팀에서 관리자가 허락한다')
      const okRules = k2 === 'db' ? ['dbtables'] : ['docs']
      for (const r of Array.isArray(rules) ? rules : []) {
        if (r?.rule !== 'tables') continue
        const ps = (Array.isArray(r.paths) ? r.paths : []).map((x) => String(x).trim().replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '')).filter(Boolean)
        if (!ps.length || ps.some((x) => x.split('/').includes('..') || /^[A-Za-z]:|^\//.test(x))) throw new KmdError('E_INPUT', '표로 만들 파일 · 폴더를 그 안의 경로로 하나 이상 적는다(예: codes/상태코드.csv · data/)')
        r.paths = ps.slice(0, 50)
      }
      if (k2 !== 'git' && (!Array.isArray(rules) || !rules.length || rules.some((r) => !okRules.includes(r.rule) || !r.into?.doc))) throw new KmdError('E_INPUT', `무엇을 채우나는 ${okRules.join(' · ')} 중 · 넣을 문서와 함께`)
      const decl = await readDecl(meta.dir)
      if (decl.some((s) => s.name === name)) throw new KmdError('E_CONFLICT', '같은 이름의 가져올 곳이 있다')
      let shown
      if (k2 === 'db') {
        const d = db || {}
        const word = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/
        if ((d.engine || 'postgres') !== 'postgres') throw new KmdError('E_INPUT', 'DB 는 PostgreSQL 만: 다른 DB 는 바깥 생성기(기계 열쇠)로')
        if (!/^[A-Za-z0-9.-]{1,253}$/.test(String(d.host || ''))) throw new KmdError('E_INPUT', '호스트가 아니다')
        const port = Number(d.port || 5432)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new KmdError('E_INPUT', '포트는 1 ~ 65535')
        if (!word.test(String(d.database || ''))) throw new KmdError('E_INPUT', 'DB 이름이 아니다')
        if (!word.test(String(d.user || ''))) throw new KmdError('E_INPUT', '계정이 아니다')
        const schema = String(d.schema || 'public')
        if (!word.test(schema)) throw new KmdError('E_INPUT', '스키마 이름이 아니다')
        await hub.sourceGuard(ctx, id, { kind: 'db', host: String(d.host) })
        if (d.password) await setSecret(dataDir, secretName(id, name), String(d.password))
        shown = `postgres://${d.user}@${d.host}:${port}/${d.database}?schema=${schema}`
      } else if (k2 === 'pc') {
        shown = '옛 PC 폴더: 기계 열쇠로 보낸다'
      } else {
        const t = checkTarget(at, { kind: k2 === 'docs' ? 'folder' : k2, ...(await hub.sourceCtx(id)) })
        await hub.sourceGuard(ctx, id, { kind: k2, at: t.url || t.folder })
        if (k2 === 'git' && (cred?.user || cred?.token)) await setSecret(dataDir, secretName(id, name), `${cred.user || 'git'}:${cred.token || ''}`)
        shown = t.url ? await stripCreds(t.url, { dataDir, kn: id, name }) : t.folder
      }
      // DB 주소는 계정 이름까지 둔다(비밀번호는 처음부터 없다) · 그 밖은 주소에 든 자격을 가린다
      // 뜻 갱신(소스 변경 → 기록 → 정리)은 코드 폴더 · git 만 — 옛 PC 폴더는 코드가 팀으로 가지 않게 하지 않는다
      const src = { name, kind: k2, at: k2 === 'db' ? shown : maskUrl(shown), every, rules: rules.map((r) => ({ rule: r.rule, ...(r.paths ? { paths: r.paths } : {}), into: { doc: String(r.into.doc), ...(r.into.heading ? { heading: String(r.into.heading) } : {}) } })), by: ctx.user, since: new Date().toISOString().slice(0, 10) }
      const addKey = `${id}\n${name}`
      adding.add(addKey)
      try {
        // 한 줄 안에서 다시 읽고 더한다 — 그사이 다른 고치기가 남긴 것을 덮지 않게 · 깨진 장부면 여기서 거절
        await editDecl(meta.dir, (cur) => {
          if (cur.some((s) => s.name === name)) throw new KmdError('E_CONFLICT', '같은 이름의 가져올 곳이 있다')
          return [...cur, src]
        }, { user: ctx.user, title: `가져올 곳 더함: ${name}` })
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
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '그 지식의 지식관리자가 한다')
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(String(host || ''))) throw new KmdError('E_INPUT', '호스트가 아니다')
      await hub.sourceGuard(ctx, id, { kind: 'db', host: String(host) })
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
      if (password && mode !== 'pc' && !ctx.pc) throw new KmdError('E_FORBIDDEN', '비밀번호는 화면으로 받지 않는다. 서버에서 kmd secret set')
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
    async sourceRun(id, name = null, { first = false, force = false, full = false, pass = null, onProgress = null, by = null, live = false } = {}) {
      const meta = await hub.meta(id)
      const decl = await readDecl(meta.dir)
      const out = []
      for (const s of decl.filter((x) => !name || x.name === name)) {
        // DB 읽기(pg · 읽기 전용 확인)는 S10 계정이 생기면 연다 — 그때까지는 연결 정보만 두고 쉰다(실패로 세지 않는다 · 멈춤 줄 없음)
        if (s.kind === 'pc') {
          out.push({ name: s.name, state: 'waiting', n: 0, why: '옛 PC 폴더는 걷었다. 지식은 「보내기」 로 받는다' })
          continue
        }
        const key = `${id}\n${s.name}`
        // 같은 곳이 아직 차례를 기다리면 그 일에 붙는다(실시간 · 시계 · [지금 가져오기] 가 겹쳐도 한 줄)
        const pend = srcPend.get(key)
        if (pend && !force && !full && !first && pend.qj.state === 'wait') { out.push({ name: s.name, ...(await pend.job) }); continue }
        const qj = Q.add({ kind: 'source', origin: s.kind === 'folder' ? 'docs' : s.kind, kn: id, title: full ? `${s.name}: 전체 다시 맞추기` : s.name, by: by || 'kmd', auto: by ? null : live ? 'live' : String(s.every || 'hourly'), spec: { type: 'source', kn: id, name: s.name, force, full } })
        const prev = srcRuns.get(key) || Promise.resolve()
        const job = prev.catch(() => {}).then(async () => {
          try { await Q.step(qj, 0, { lane: 'fetch' }) } catch (e) { Q.end(qj, 'cancel', e.message); return { state: 'cancelled', n: 0, why: e.message } }
          Q.line(qj, 'sys', `${s.name}: ${{ git: '저장소에서 받는다', db: 'DB 에 읽기 전용으로 붙는다', docs: '폴더를 읽는다', folder: '폴더를 읽는다' }[s.kind] || '읽는다'}${force ? ' · 그대로 맞춘다' : ''}`)
          srcBusy.set(key, { kn: id, name: s.name, kind: s.kind, since: new Date().toISOString(), full, qid: qj.id })
          try {
          const k = await hub.get(id)
          const src = { ...s, folder: s.kind === 'folder' || !(/^(https?|ssh):\/\//i.test(s.at) || /^[^/\\\s]+@[^/\\\s]+:/.test(s.at)) ? s.at : undefined }
          // 들어온 것마다 intake 하나(S7 · 설계 4-5) — 팀은 들이기 일감(정리 일감을 세우지 않는다) · 이 PC 는 지금 길(파일 넣기 · 커밋 분석 → 기록 · 저장 즉시 넣기)
          //   표 블록(저절로 채우는 표 · DB 표)은 save 로 그대로 — 기록 + 표가 이미 한 번에(system)
          const r = await runSource(k, src, { dataDir, first, force, full, pass, onProgress, onStage: (i) => (i >= 3 ? Q.mark(qj, 3) : Q.step(qj, i)), line: (kk, x) => Q.line(qj, kk, x), meaning: hub.meaningOk(id), intake: mode === 'pc' ? pcIntake(id, meta, s) : teamIntake(id, s, qj), save: (input) => coreSave(meta.dir, input, { user: 'kmd', system: true }) })
          cache.delete(id)
          // 이 PC — 커밋 기록을 남겼다: 그 기록을 문서에 넣으면 이 일의 터미널에 한 줄씩 · 저장 즉시 넣기를 건다
          for (const rid of r.recIds || []) codeJobs.set(rid, qj)
          if (codeJobs.size > 500) for (const rid of [...codeJobs.keys()].slice(0, codeJobs.size - 500)) codeJobs.delete(rid)
          if (r.codeRecords && mode === 'pc') hub.curateSoon(id).catch((e) => log('가져온 뒤 바로 넣기', id, e.message))
          const told = mode === 'pc' ? 'Claude Code 가 자리를 골라 문서에 넣는다' : '팀 일꾼이 기록과 항목 글을 한 번에 넣는다'
          if (r.state === 'changed') for (const u of await hub.curatorsOf(id)) await feed.add(dataDir, u, { kind: 'source', kn: id, dot: 'acc', text: r.commits != null ? `${s.name}에서 새 묶음 ${r.commits} · 코드 바뀜 ${r.codeRecords}: ${meta.name}` : s.kind === 'docs' ? `${s.name}에서 바뀐 파일 ${r.files}: ${meta.name}` : `${s.name}에서 바뀐 표 ${r.n}: ${meta.name}`, small: r.commits != null || s.kind === 'docs' ? `${intakeSum(r) || '그대로'} · ${told}` : `바뀐 파일 ${r.files} · 저절로 채우는 표${r.codeRecords ? ` · 코드 바뀜 ${r.codeRecords}: ${intakeSum(r)}` : ''}` })
          hub.sourceJobEnd(qj, s, r)
          return r
          } catch (e) {
            if (e?.cancelled) { Q.end(qj, 'cancel', e.message); return { state: 'cancelled', n: 0, why: e.message } }
            Q.end(qj, 'fail', e.message)
            throw e
          } finally {
            srcBusy.delete(key)
          }
        })
        srcRuns.set(key, job)
        srcPend.set(key, { qj, job })
        out.push({ name: s.name, ...(await job) })
        if (srcRuns.get(key) === job) srcRuns.delete(key)
        if (srcPend.get(key)?.job === job) srcPend.delete(key)
      }
      if (out.some((x) => x.state === 'changed') && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return out
    },
    // 전체 다시 맞추기 — 뒤에서 일감으로 · 진행률 · 끊기면(서버를 다시 켜면) 같은 pass 로 이어서. 쓰는 것은 다른 것뿐
    async sourceResync(ctx, id, name) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '전체 다시 맞추기는 그 지식의 지식관리자가 한다')
      const s = (await readDecl(meta.dir)).find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
      if (s.kind === 'git' && !s.rules?.length) throw new KmdError('E_INPUT', '소스 코드는 묶음으로 본다. 다시 맞출 것이 없다')
      const key = `${id}\n${name}`
      if (resyncs.get(key)?.state === 'running') return resyncs.get(key)
      const st = await readSourceState(dataDir, id)
      const pass = st[name]?.resync?.pass || Date.now() // 남은 pass 가 있으면 이어서
      const job = { state: 'running', done: 0, total: 0, pass, at: new Date().toISOString() }
      resyncs.set(key, job)
      const mark = async (v) => { const x = await readSourceState(dataDir, id); (x[name] ||= {}).resync = v; await writeSourceState(dataDir, id, x) }
      await mark({ pass, at: job.at })
      hub.sourceRun(id, name, { full: true, pass, by: ctx.user, onProgress: (d, t) => { job.done = d; job.total = t } })
        .then(async ([r]) => {
          Object.assign(job, { state: r?.state === 'failed' ? 'failed' : r?.state === 'cancelled' ? 'paused' : 'done', result: r, end: new Date().toISOString() })
          if (r?.state !== 'failed' && r?.state !== 'cancelled') await mark(undefined)
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
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '그 지식의 지식관리자가 한다')
      const decl = await readDecl(meta.dir)
      const s = decl.find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
      if (s.kind !== 'folder' && s.kind !== 'git') throw new KmdError('E_INPUT', '뜻 갱신은 코드 폴더 · git 만')
      if (!!s.meaning === !!on) return s
      const flip = (x) => { if (on) x.meaning = true; else delete x.meaning }
      flip(s)
      await editDecl(meta.dir, (cur) => {
        const x = cur.find((y) => y.name === name)
        if (!x) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
        flip(x)
        return cur
      },{ user: ctx.user, title: `가져올 곳 뜻 갱신 ${on ? '켬' : '끔'}: ${name}` })
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
          timer = setTimeout(() => hub.sourceRun(id, s.name, { live: true }).catch(() => {}), config.watchQuietMs ?? 10_000)
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
    // 자료 가져오기 화면 — 그 사람이 보는 지식들의 가져올 곳 모두
    async allSources(ctx) {
      const out = []
      // 장부가 깨진 지식은 건너뛴다(그 경고는 멈춤 줄 · 그 지식의 가져오기 화면) — 한 지식 때문에 모두가 비지 않게
      for (const m of await hub.visible(ctx)) for (const s of await hub.sources(ctx, m.id).catch((e) => (e?.declBroken ? [] : Promise.reject(e)))) out.push({ kn: m.id, knName: m.name, ...s })
      return out
    },
    // 언제 — hourly · daily HH:MM · weekly · change(바뀔 때만) · manual
    async sourceEvery(ctx, id, { name, every }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '언제 바꾸기는 그 지식의 지식관리자가 한다')
      if (!/^(hourly|weekly|change|manual|daily ([01]\d|2[0-3]):[0-5]\d)$/.test(String(every))) throw new KmdError('E_INPUT', '언제는 hourly · daily HH:MM · weekly · change')
      const decl = await readDecl(meta.dir)
      const s = decl.find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
      if (s.every === every) return s
      s.every = every
      await editDecl(meta.dir, (cur) => {
        const x = cur.find((y) => y.name === name)
        if (!x) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
        x.every = every
        return cur
      }, { user: ctx.user, title: `가져올 곳 언제: ${name} · ${every}` })
      cache.delete(id)
      return s
    },
    // 고치기 — 주소(경로 · git) · 넣을 문서 · 언제 · 뜻 갱신 · DB 접속 · 자격(요구 v0.2 R4). 이름은 상태 · 자격의 열쇠라 고치지 않는다.
    //   빈 비밀번호 · 토큰은 「그대로」 · 주소나 접속이 바뀌면 처음부터 다시 한 번 가져온다
    //   넣을 지식(kn)이 바뀌면 옛 지식에서 지우고(사본은 copies 대로) 새 지식에 더해 처음부터 한 번 가져온다
    async sourceEdit(ctx, id, { name, at = null, doc = null, every = null, meaning = null, db = null, cred = null, kn = null, copies = 'keep' }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 관리자가 고친다')
      const to = kn && kn !== id ? String(kn) : null
      if (to) {
        const tm = await hub.meta(to, ctx)
        if (!hub.canSource(ctx, to)) throw new KmdError('E_FORBIDDEN', '옮겨 갈 지식에 가져올 곳을 더할 수 없다')
        if ((await readDecl(tm.dir)).some((x) => x.name === name)) throw new KmdError('E_CONFLICT', '옮겨 갈 지식에 같은 이름의 가져올 곳이 있다')
      }
      const pcScreen = mode === 'pc' || ctx.pc
      if ((cred?.token || db?.password) && !pcScreen) throw new KmdError('E_FORBIDDEN', `자격은 화면으로 받지 않는다. 서버에서 한 줄: kmd secret set ${secretName(id, name)}`)
      const decl = await readDecl(meta.dir)
      const s = decl.find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
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
        if (String(d.host) !== String(cur.host)) await hub.sourceGuard(ctx, id, { kind: 'db', host: String(d.host) })
        const shown = `postgres://${d.user}@${d.host}:${port}/${d.database}?schema=${d.schema || 'public'}`
        if (shown !== s.at) { s.at = shown; refetch = true }
        if (db.password) { await setSecret(dataDir, secretName(id, name), String(db.password)); refetch = true }
      } else if (at != null && String(at).trim() && s.kind !== 'db') {
        const t = checkTarget(String(at).trim(), { kind: s.kind === 'docs' ? 'folder' : s.kind, ...(await hub.sourceCtx(id)) })
        if (repoKey(t.url || t.folder) !== repoKey(s.at)) await hub.sourceGuard(ctx, id, { kind: s.kind, at: t.url || t.folder })
        const shown = t.url ? await stripCreds(t.url, { dataDir, kn: id, name }) : t.folder
        if (maskUrl(shown) !== s.at) { s.at = maskUrl(shown); refetch = true }
      }
      if (s.kind === 'git' && cred && (cred.user || cred.token)) {
        const old = await getSecret(dataDir, secretName(id, name)).catch(() => null)
        const [ou, ...ot] = String(old || '').split(':')
        await setSecret(dataDir, secretName(id, name), `${cred.user || ou || 'git'}:${cred.token || ot.join(':') || ''}`)
        refetch = true
      }
      // 다른 지식으로 — 자격을 새 이름으로 옮기고 옛 자리는 지우기와 같게 걷은 뒤 새 지식에 더한다
      if (to) {
        const sec = await getSecret(dataDir, secretName(id, name)).catch(() => null)
        if (sec) await setSecret(dataDir, secretName(to, name), sec)
        const r = await hub.sourceRemove(ctx, id, { name, copies })
        const tm = await hub.meta(to, ctx)
        const addKey = `${to}\n${name}`
        adding.add(addKey)
        try {
          await editDecl(tm.dir, (cur) => {
            if (cur.some((x) => x.name === name)) throw new KmdError('E_CONFLICT', '옮겨 갈 지식에 같은 이름의 가져올 곳이 있다')
            return [...cur, s]
          }, { user: ctx.user, title: `가져올 곳 옮겨 옴: ${name} · ${meta.name || id} 에서` })
          cache.delete(to)
          if (started) hub.watchSource(to, s)
          const run = await hub.sourceRun(to, name, { first: true }).catch((e) => [{ state: 'failed', why: e.message }])
          return { source: s, run, moved: to, copies: r.copies, kept: r.kept }
        } finally {
          adding.delete(addKey)
        }
      }
      if (JSON.stringify(s) !== was) {
        // 한 줄 안에서 다시 읽고 이 곳만 바꾼다(그사이 다른 곳을 고친 것은 그대로)
        await editDecl(meta.dir, (cur) => {
          const i = cur.findIndex((x) => x.name === name)
          if (i < 0) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
          cur[i] = s
          return cur
        }, { user: ctx.user, title: `가져올 곳 고침: ${name}` })
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
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 그 지식의 지식관리자가 지운다')
      const decl = await readDecl(meta.dir)
      if (!decl.some((x) => x.name === name)) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
      const key = `${id}\n${name}`
      srcWatch.get(key)?.close()
      srcWatch.delete(key)
      await editDecl(meta.dir, (cur) => {
        if (!cur.some((x) => x.name === name)) throw new KmdError('E_NOTFOUND', '그 가져올 곳이 없다')
        return cur.filter((x) => x.name !== name)
      }, { user: ctx.user, title: `가져올 곳 지움: ${name}` })
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
          await commitPaths(meta.dir, mine.map((x) => x.d.path), `가져올 곳 지움: ${name} · 사본 ${mine.length} ${copies === 'drop' ? '지움' : '내 문서로'}`, ctx.user).catch((e) => log('사본 정리', id, e.message))
        })
      }
      cache.delete(id)
      return { removed: name, copies: mine.length, kept: copies !== 'drop' }
    },
    // 원본이 없어진 사본 — 「원본이 주인」 표지를 걷어 내 문서로(고칠 수 있게)
    async unwatch(ctx, id, { doc }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '그 지식의 지식관리자가 한다')
      const d = (await hub.get(id)).docs.find((x) => x.id === doc)
      if (!d) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      const full = path.join(meta.dir, ...d.path.split('/'))
      const t = await fs.readFile(full, 'utf8')
      const w = watchedOf(t)
      if (!w) return { ok: true }
      if ((await readDecl(meta.dir)).some((s) => s.name === w.src)) throw new KmdError('E_CONFLICT', `원본이 아직 있다: ${w.src} 에서 가져온다 · 가져올 곳을 지우면 내 문서로 남는다`)
      await serial(path.resolve(meta.dir), async () => {
        await fs.writeFile(full, t.split('\n').slice(1).join('\n').replace(/^\n+/, ''), 'utf8')
        await commitPaths(meta.dir, [d.path], `원본이 없어진 사본: 내 문서로 · ${d.title}`, ctx.user)
      })
      cache.delete(id)
      return { ok: true }
    },
    // 그 지식의 관리 자리 사람(총괄 관리자 포함) — 정리 · 가져오기 알림을 받는 사람
    async curatorsOf(id) {
      const reg = R()
      const users = new Set(hub.admins())
      for (const u of hub.people()) if (owners.levelOf(reg, id, { user: u }) === 'admin') users.add(u)
      return [...users]
    },
    // 관리자에게 부탁 — 관리 화면 · 관리자의 오늘 바뀐 것에
    // 부탁 — 상태(기다림 wait · 더함 done · 거절 no) · 같은 부탁은 합친다 · 주소는 받을 때 검사한다 · 결과는 부탁한 사람 이력에.
    async sourceRequest(ctx, id, card) {
      await hub.meta(id, ctx)
      hub.need(ctx, id, 'write')
      card = card && typeof card === 'object' ? card : {}
      const name = String(card.name || '').trim().slice(0, 60)
      if (!name || /[\r\n"]/.test(name)) throw new KmdError('E_INPUT', '이름은 한 줄 60자 안')
      // 부탁 카드도 더하기(sourceAdd)와 같은 모양만 받는다 — 관리자가 [더함] 으로 옮길 때 다시 걸리지 않게 · requests.json 이 커지지 않게
      const kind = card.kind || (card.db ? 'db' : 'git')
      if (!['git', 'docs', 'db'].includes(kind)) throw new KmdError('E_INPUT', '가져올 곳은 git · 문서 폴더 · DB 중 하나')
      const every = String(card.every || 'hourly')
      if (!/^(hourly|weekly|change|manual|daily ([01]\d|2[0-3]):[0-5]\d)$/.test(every)) throw new KmdError('E_INPUT', '언제는 hourly · daily HH:MM · weekly · change · manual')
      if (card.rules != null && !Array.isArray(card.rules)) throw new KmdError('E_INPUT', '무엇을 채우나가 목록이 아니다')
      const raw = card.rules || []
      if (raw.length > 20) throw new KmdError('E_INPUT', '무엇을 채우나는 20개 안')
      const cut = (x, n) => {
        const t = String(x ?? '').trim()
        if (t.length > n || /[\r\n\0]/.test(t)) throw new KmdError('E_INPUT', `무엇을 채우나의 글은 한 줄 ${n}자 안`)
        return t
      }
      const rules = raw.map((r) => {
        if (!r || typeof r !== 'object' || !['docs', 'dbtables', 'tables'].includes(r.rule)) throw new KmdError('E_INPUT', '무엇을 채우나는 docs · dbtables 중')
        const ps = Array.isArray(r.paths) ? r.paths : null
        if (ps && ps.length > 50) throw new KmdError('E_INPUT', '표로 만들 파일 · 폴더는 50개 안')
        return { rule: r.rule, ...(ps ? { paths: ps.map((x) => cut(x, 300)) } : {}), ...(r.into ? { into: { doc: cut(r.into.doc, 200), ...(r.into.heading ? { heading: cut(r.into.heading, 200) } : {}) } } : {}) }
      })
      if (String(card.at || '').length > 2048) throw new KmdError('E_INPUT', '주소가 너무 길다')
      if (kind !== 'db') checkTarget(String(card.at || '').trim(), { kind: kind === 'docs' ? 'folder' : kind, ...(await hub.sourceCtx(id)) })
      const f = path.join(dataDir, 'requests.json')
      return inReq(async () => {
        const all = await reqRead()
        const at2 = maskUrl(String(card.at || ''))
        const same = all.find((r) => (r.state || 'wait') === 'wait' && r.kn === id && r.name === name && r.at2 === at2)
        if (same) { if (!same.by.split(', ').includes(ctx.user)) same.by += ', ' + ctx.user; await writeJsonAtomic(f, all); return { ...same, again: true } }
        const req = { id: crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), by: ctx.user, kn: id, name, at2, kind: card.kind ? kind : null, rules, every, state: 'wait', ...(card.db ? { db: { engine: 'postgres', host: String(card.db.host || '').slice(0, 253), port: Number(card.db.port) || 5432, database: String(card.db.database || '').slice(0, 63), schema: String(card.db.schema || 'public').slice(0, 63), user: String(card.db.user || '').slice(0, 63) } } : {}) }
        all.unshift(req)
        await writeJsonAtomic(f, all.slice(0, 200))
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
        const all = await reqRead()
        const r = all.find((x) => x.id === rid)
        if (!r) throw new KmdError('E_NOTFOUND', '그런 부탁은 없다')
        Object.assign(r, { state, closedBy: ctx.user, closedAt: new Date().toISOString(), ...(why ? { why: String(why).slice(0, 200) } : {}) })
        await writeJsonAtomic(f, all)
        const kn = (await hub.list()).find((k) => k.id === r.kn)?.name || r.kn
        for (const u of r.by.split(', ')) await feed.add(dataDir, u, { kind: 'source', kn: r.kn, dot: state === 'done' ? 'acc' : 'warn', text: state === 'done' ? `부탁한 가져올 곳을 더했다: ${r.name} · ${kn}` : `부탁한 가져올 곳을 더하지 않았다: ${r.name} · ${kn}`, small: state === 'done' ? `${ctx.user} 이 더했다` : `${ctx.user}${why ? ': ' + String(why).slice(0, 200) : ''}` }).catch(() => {})
        return r
      })
    },
    // 바깥 생성기 — 기계 열쇠로 그 원천의 표만(이름의 종류도 열쇠의 것과 대조)
    async baseline(ctx, id, { source, items = [], asof = null, host = '', files = 0 }) {
      const meta = await hub.meta(id)
      if (!ctx.machine || ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '기계 열쇠로만 쓴다', { need: 'machine' })
      if (String(source) !== ctx.machine.source) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 가져올 곳의 것이다')
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
      // 줄의 상태(옛 PC 폴더 · 바깥 생성기) — 받은 때 · 마지막 변화
      const mark = async (n) => {
        const st = await readSourceState(dataDir, id)
        const s0 = (st[source] ||= {})
        const now = new Date().toISOString()
        Object.assign(s0, { checkedAt: now, host: String(host || '').slice(0, 60), failures: 0, lastNote: n ? `바뀐 표 ${n}` : '그대로', ...(n ? { lastChange: { at: now, files: files || 0, tables: n } } : {}) })
        await writeSourceState(dataDir, id, st)
      }
      if (!plan.changed.length) { await mark(0); return { changed: 0 } }
      await mark(plan.changed.length)
      await coreSave(meta.dir, { record: { title: `가져옴: ${source} · 바뀐 표 ${plan.changed.length}`, body: plan.changed.map((c) => `- ${c.doc} › ${c.heading}`).join('\n'), tags: ['sources'] }, sections: plan.changed.map((c) => ({ doc: c.doc, heading: c.heading, content: c.content, applied: c.applied })) }, { user: 'kmd-auto', system: true })
      cache.delete(id)
      return { changed: plan.changed.length }
    },

    // ── 정리(KM81 — 검사를 넘으면 승인 없이 바로) ──
    // 일감은 서버가 낸다(정해진 시간 · [지금 정리]). 일꾼은 일감마다 받은 초안 전용 단기 열쇠로 재료를 받고 초안만 올린다
    tidyAtOf: (id) => rowFor(id)?.tidyAt || config.tidyAt || '02:30',
    // 팀 지식의 정리 방식 — time 정해진 시각(기본) · live 실시간(기록이 남고 조용해진 뒤) · manual 손으로만([지금 정리])
    tidyModeOf: (id) => rowFor(id)?.tidyMode || 'time',
    pendText(id) {
      if (mode === 'pc') return 'kmd 가 곧바로 문서에 넣는다'
      const m = hub.tidyModeOf(id)
      if (m === 'live') return '조용해지면 바로 문서에 들어간다'
      if (m === 'manual') return '누가 [지금 정리] 를 누를 때 문서에 들어간다'
      return `정해진 시각 ${hub.tidyAtOf(id)} 정리 때 문서에 들어간다`
    },
    ruleOnly: (id) => mode === 'team' && (!!rowFor(id)?.noClaude || workerRests()),
    liveSoon(id) {
      clearTimeout(liveTimers.get(id))
      const t = setTimeout(() => { liveTimers.delete(id); if (hub.tidyModeOf(id) === 'live') hub.tidyNow({ user: 'kmd', admin: true }, id, { by: 'kmd', auto: true }).catch((e) => log('실시간 정리', id, e.message)) }, config.liveQuietMs ?? 5 * 60_000)
      t.unref?.()
      liveTimers.set(id, t)
    },
    async tidyNow(ctx, id, { by = ctx.user, auto = false, ids = null } = {}) {
      await hub.meta(id, auto && ctx.user === 'kmd' ? undefined : ctx)
      sweepJobs()
      // 고른 것만 정리 — 관리 자리가 아니면 자기 기록만(고르지 않았으면 자기 기록 모두 · 쓰기 자리)
      const boss = auto || levelFor(id, ctx) === 'admin'
      if (!auto) hub.need(ctx, id, 'write')
      if (!auto && (ids || !boss)) {
        const k = await hub.get(id)
        const mine = (w) => boss || w.author === ctx.user
        const want = ids ? new Set(ids.map(String)) : null
        ids = k.works.filter((w) => (w.state === 'pend' || w.state === 'nowhere') && mine(w) && (!want || want.has(w.id))).map((w) => w.id)
        if (!ids.length) throw new KmdError('E_INPUT', boss ? '고른 기록 중 정리할 것이 없다' : '정리를 기다리는 내 기록이 없다')
        // 항목에 넣으면 그 항목을 기다리던 기록이 모두 「넣음」 이 된다 — 같은 자리에 모인 기록은 같이(다 모일 때까지)
        const pend = k.works.filter((w) => w.state === 'pend')
        for (let grew = true; grew; ) {
          const coords = new Set(pend.filter((w) => ids.includes(w.id)).flatMap((w) => w.touches))
          const more = pend.filter((w) => !ids.includes(w.id) && w.touches.some((c) => coords.has(c))).map((w) => w.id)
          grew = more.length > 0
          ids.push(...more)
        }
      }
      const cur = [...jobs.values()].find((j) => !j.kind && j.kn === id && (j.state === 'queued' || j.state === 'running'))
      if (cur) return cur
      // 규칙으로만 — 일꾼에게 내지 않고 서버가 넣는다(넣은 것이 없으면 「정리한 것」 카드를 남기지 않는다)
      if (hub.ruleOnly(id)) return hub.ruleJob(id, { by, auto, why: rowFor(id)?.noClaude ? '자동 정리에 Claude 를 쓰지 않는 지식: 규칙으로 넣었다' : '정리 일꾼이 쉬고 있어 규칙으로 넣었다' })
      const j = { id: crypto.randomBytes(6).toString('hex'), kn: id, by, auto, at: new Date().toISOString(), state: 'queued', ...(ids ? { ids } : {}) }
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
    // 화면이 보는 정리 일감 — 그 지식을 읽는 사람에게만(아니면 없는 일감과 같게)
    //   일꾼 id · 임대 · 일감 범위(ids)는 싣지 않는다 · 비용은 그 지식의 지식관리자 이상만(권한 모델 7절)
    jobFor(ctx, jid) {
      const j = hub.job(jid)
      if (j && !visibleTo(j.kn, ctx)) throw new KmdError('E_NOTFOUND', '그 일은 이제 없다')
      return j ? jobView(j, levelFor(j.kn, ctx) === 'admin' || !!ctx?.admin) : null
    },
    jobsOf: (id) => (sweepJobs(), [...jobs.values()].filter((j) => !j.kind && j.kn === id)),
    // 정리 일 줄 — 일꾼이 자리 하나의 글 쓰기를 시작했다(화면 · 터미널은 job 을 1.5초마다 읽는다)
    //   end 가 없으면 시작(글 쓰는 중) · end 면 초안 받음(got · 검사는 다 모인 뒤 한꺼번에) 또는 못 받음(left)
    //   why(시작) — 다시 쓰는 까닭(묶음 답에 없음) · ms · chars · cost · tokens(끝) — 걸린 시간 · 보낸 글 · 비용 · 받은 토큰(자리에 남긴다 · 느린 곳을 잰다)
    //   tick(쓰는 중) — keys 자리들에 쓴 글 · 생각 글자 수 · 지난 시간(묶음이면 자리 여럿이 Claude 한 번을 같이 본다) · 줄은 늘리지 않는다
    //   call · form — 같은 Claude 호출의 넣을 곳을 화면이 한 묶음으로(batch: 항목 여럿 한 번에 · patch: 고칠 조각 · single: 글 전체) · limit — 그 호출의 시간 상한 · edits — 받은 조각 수
    workerProgress(dctx, id, { key, keys = null, tick = false, out = 0, think = 0, model, end = false, ok = true, why = null, par = false, ms = 0, chars = 0, cost = 0, tokens = 0, call = null, form = null, limit = 0, edits = null } = {}) {
      if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const j = jobs.get(dctx.draft.job)
      // 소식이 오면 살아 있다 — 자리를 못 찾아도(재료를 다시 받아 열쇠가 바뀌었다) 먼저 올린다
      if (j) j.beat = new Date().toISOString()
      if (tick) {
        const ks = (Array.isArray(keys) ? keys : [key]).map(String).slice(0, 64)
        for (const sp of (j?.spots || []).filter((x) => ks.includes(x.key) && x.st === 'run')) {
          // 첫 글자 — 생각을 마치고 글을 쓰기 시작한 때(한 번만 줄로)
          if (Number(out) > 0 && !sp.out) sp.lines.push([2, 'sys', `첫 글자 · 받는 중 ${Number(out)} 자`])
          Object.assign(sp, { out: Number(out) || 0, think: Number(think) || 0, runMs: Number(ms) || 0, together: ks.length, ...(Number(limit) > 0 ? { limit: Number(limit) } : {}) })
        }
        stamp(j)
        return { ok: true, stop: !!j?.stop }
      }
      const sp = j?.spots?.find((x) => x.key === key)
      if (!sp) return { ok: false, stop: !!j?.stop }
      if (j.stop) return { ok: true, stop: true }
      const took = (Number(ms) || 0) > 0 ? ` · ${Math.round(ms / 1000)}초${chars ? ` · 보낸 글 ${(chars / 1000).toFixed(1)}k자` : ''}${tokens ? ` · 받은 토큰 ${tokens}` : ''}` : ''
      if (!end) {
        // 예전 일꾼은 끝을 알리지 않는다 — 다음 자리를 시작하면 앞 자리는 초안을 받은 것(자리를 같이 쓰는 일꾼은 par)
        if (!par) for (const x of j.spots) if (x.st === 'run' && x !== sp) Object.assign(x, { st: 'got', stage: 3 })
        Object.assign(sp, { st: 'run', stage: 2, tries: (sp.tries || 0) + 1, t0: Date.now(), out: 0, think: 0, runMs: 0, ...(call ? { call: String(call).slice(0, 24) } : {}), ...(form ? { form: String(form).slice(0, 12) } : {}), ...(Number(limit) > 0 ? { limit: Number(limit) } : {}) })
        if (why) sp.lines.push([2, 'sys', String(why).slice(0, 160)])
        const how = form === 'patch' ? '고칠 조각으로' : form === 'batch' ? '같은 문서 항목 여럿 한 번에' : form === 'bpatch' ? '같은 문서 항목 여럿을 조각으로 한 번에' : form === 'fix' ? '까닭을 붙여 고쳐 쓴다' : '글 전체로'
        sp.lines.push([2, 'tool', `▸ Claude 에 보냄${model ? ` · ${String(model).slice(0, 60)}` : ''}${Number(chars) > 0 ? ` · 프롬프트 ${(chars / 1000).toFixed(1)}k 자` : ''} · ${how}${sp.tries > 1 ? ` · ${sp.tries}번째` : ''}`])
      } else if (ok) {
        Object.assign(sp, { st: 'got', stage: 3, ms: Number(ms) || 0, msAll: (sp.msAll || 0) + (Number(ms) || 0), chars: Number(chars) || 0, cost: Number(cost) || 0, t1: Date.now() })
        sp.lines.push([2, 'ok', `✓ 초안을 받았다${Number(edits) > 0 ? ` · 조각 ${Number(edits)}` : ''}${took}`], [3, 'sys', '받는 대로 검사해 넣는다'])
      } else {
        const w = STOP_WHY[why] || `초안을 받지 못했다${why ? ': ' + String(why).slice(0, 120) : ''}`
        Object.assign(sp, { st: 'left', stage: 2, why: w, ms: Number(ms) || 0, msAll: (sp.msAll || 0) + (Number(ms) || 0), chars: Number(chars) || 0 })
        sp.lines.push([2, 'err', `✗ ${w}${took}`])
      }
      stamp(j)
      return { ok: true, stop: !!j.stop }
    },
    // 정리 계획 — 지금 정리하면 생길 자리(문서 › 항목)와 거기 모이는 기록 · 지난 정리에서 둔 횟수
    async tidyPlan(ctx, id) {
      await hub.meta(id, ctx)
      const k = await hub.get(id, ctx)
      const spots = material(k).map((g) => ({ key: spotKey(g), kind: g.kind, target: spotTarget(g), records: (g.kind === 'section' ? g.records : [g.record]).map((r) => r.id) }))
      const tries = await leftTries(id)
      return { spots, tries, hold: HOLD }
    },
    // 넣을 자리 정하기 — 자리를 못 찾은 기록 · 잘못 찾은 기록에 사람이 항목을 고른다(쓴 사람 · 관리자)
    async setTouches(ctx, id, rec, coord) {
      const meta = await hub.meta(id, ctx)
      const k = await hub.get(id, ctx)
      const w = k.byWork.get(String(rec))
      if (!w || (w.state !== 'pend' && w.state !== 'nowhere')) throw new KmdError('E_NOTFOUND', '정리를 기다리는 기록이 아니다')
      hub.need(ctx, id, 'write')
      if (levelFor(id, ctx) !== 'admin' && w.author !== ctx.user) throw new KmdError('E_FORBIDDEN', '자리는 쓴 사람이나 이 지식의 지식관리자가 정한다')
      if (!sectionOf(k, String(coord || ''))?.loc) throw new KmdError('E_INPUT', '그런 항목이 없다')
      if (!k.vocab.coords.has(String(coord)) || k.vocab.coords.get(String(coord)).deprecated) throw new KmdError('E_INPUT', '이름 장부에 있는 이름만 고른다(폐기된 이름은 이어 둔 새 이름으로)')
      const saved = await coreSave(meta.dir, { record: { title: `이름 바로잡음: ${w.title.split(/ — |: /)[0]}`, body: `${ctx.user} 가 넣을 자리를 골랐다`, touches: [String(coord)], tags: ['touches-fix'], fixes: [w.id], date: w.date } }, { user: ctx.user, system: true })
      cache.delete(id)
      return { record: saved.id }
    },
    // 정리 일꾼(팀)을 마지막으로 본 때 · 기다리는 정리 — 멈춤 줄 · 관리 화면
    workerSeen: () => ({ at: teamSeenAt ? new Date(teamSeenAt).toISOString() : null, queued: [...jobs.values()].filter((j) => j.state === 'queued') }),
    // 일꾼 — 다음 일감 하나 + 그 일감 · 그 지식에만 쓰는 단기 열쇠(30분 · 한 일감)
    workerNext(wctx) {
      teamSeenAt = Date.now()
      sweepJobs()
      const q = [...jobs.values()].filter((x) => x.state === 'queued')
      const j = q.find((x) => !x.auto) || q[0]
      if (!j) return null
      j.state = 'running'
      j.worker = wctx.worker.id
      j.started = new Date().toISOString()
      j.leaseUntil = Date.now() + JOB_LEASE
      saveJobs()
      const key = 'kmdd_' + crypto.randomBytes(24).toString('base64url')
      drafts.set(sha(key), { job: j.id, kn: j.kn, exp: Date.now() + 30 * 60_000 })
      return { job: { id: j.id, kn: j.kn, kind: j.kind || 'tidy', ...(j.kind === 'intake' ? { type: j.type } : {}) }, key }
    },
    draftCtx(token) {
      const d = drafts.get(sha(token))
      if (!d || d.exp < Date.now()) return null
      const j = jobs.get(d.job)
      if (j && j.state !== 'running') return null // 임대가 끝나 다시 기다림이 된 일감 — 옛 일꾼의 초안은 받지 않는다
      d.exp = Math.max(d.exp, Date.now() + 30 * 60_000)
      if (j) j.leaseUntil = Date.now() + (j.stop ? 5 * 60_000 : JOB_LEASE)
      return { user: 'kmd-worker', admin: false, draft: d, token }
    },
    async material(dctx, id) {
      if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const row = rowFor(id)
      // 나가기 전에 막는다 — 「Claude 에 보내지 않음」
      if (row?.noClaude) throw new KmdError('E_FORBIDDEN', '이 지식은 Claude 에 보내지 않는다')
      const k = await hub.get(id)
      const idx = await hub.index(id)
      const learned = await learnedOf(id)
      const cands = []
      const job = jobs.get(dctx.draft.job)
      let groups = material(k, { candidates: (w) => cands.find((c) => c.id === w.id)?.list || [], ids: job?.ids || null })
      // 자동 정리 — 세 번 둔 기록만 모인 자리는 뺀다(사람이 볼 것 · 새 기록이 같이 모였으면 같이 다시 쓴다)
      if (job?.auto) {
        const tries = await leftTries(id)
        const held = (g) => (g.kind === 'section' ? g.records : [g.record]).every((r) => (tries[r.id] || 0) >= HOLD)
        job.held = groups.filter(held).length
        groups = groups.filter((g) => !held(g))
      }
      // 정리 일 줄 — 묶음 하나가 자리 하나 · 모으기 · 자리 찾기는 여기서 끝난다
      if (job) {
        // 다시 받은 일감(서버가 다시 켜졌다) — 이미 넣은 자리는 그대로 보인다 · 그 기록은 받은 것에 없어 다시 쓰지 않는다
        const put = (job.spots || []).filter((x) => x.st === 'done')
        const prev = new Map((job.spots || []).map((x) => [x.key, x]))
        job.spots = put.concat(groups.map((g) => {
          const recs = g.kind === 'section' ? g.records : [g.record]
          const old = prev.get(spotKey(g))
          return {
            key: spotKey(g), kind: g.kind, target: spotTarget(g), records: recs.map((r) => r.id), st: 'wait', stage: 2,
            ...spotName(k, g),
            ...(g.kind === 'section' ? { size: (g.content || '').length } : {}),
            ...(old?.tries ? { tries: old.tries } : {}),
            lines: [
              // 서버가 다시 켜져 다시 받은 자리 — 앞 시도 줄은 그대로 두고 그 뒤에 잇는다
              ...(old?.lines?.length ? [...old.lines.slice(-40), [0, 'sys', `다시 시작: ${(job.tries || 0) + 1}번째 맡김`]] : []),
              [0, 'sys', `기록 ${recs.length} · ${[...new Set(recs.map((r) => r.author))].join(' · ')}${g.values?.length ? ` · 확인할 값 ${g.values.length}개` : ''}`],
              [1, 'ok', g.kind === 'section' ? '✓ 넣을 곳을 찾았다' : g.kind === 'ingest' ? `✓ 넣은 파일 · 후보 문서 ${g.docs.length}` : '넣을 곳을 못 찾은 기록 · Claude 가 후보에서 고른다'],
            ],
          }
        }).filter((x) => !put.some((y) => y.key === x.key)))
        stamp(job)
        saveJobs()
      }
      // 이름 없는 기록의 후보 이름 — 찾기 사다리(제목 + 글)
      for (const g of groups.filter((x) => x.kind === 'touches')) {
        const r = await ladder(k, idx, { q: `${g.record.title} ${g.record.body}`.slice(0, 300), learned, max: 8 })
        g.candidates = [...r.exact, ...r.coords].filter((c) => c.coord).slice(0, 8).map((c) => ({ coord: c.coord, name: c.name }))
      }
      return { kn: id, groups }
    },
    // ── 들이기 일감(S7 · docs/품질개선/KMD_개편_설계.md 3-5 · S-D18 ~ S-D22 · S-D43 · S-D47 · S-D48 · S-D50) ──
    //   원천(파일 하나 · 커밋 하나)을 일감이 들고 있다가 팀 일꾼의 claude -p 초안 하나로 기록 + 조각을 저장 한 번에 넣는다.
    //   일감을 세우는 곳은 openJob 하나 · 끝내 못 넘으면 기록만 + 넣지 못함(원천은 <data>/held/<지식>/<기록>.* 에 남긴다)
    jobTick: () => jobTick(),
    intakesOf: (id) => (sweepJobs(), [...jobs.values()].filter((j) => j.kind === 'intake' && j.kn === id)),
    // 일감을 세우는 한 곳(S-D47) — { state: 'queued', job } | { state: 'held', rec, why } | { state: 'same', rec }
    //   type: file · commit(S7 · fix · again · polish 는 S9 · S10 · S13) · by: 만든 사람(가져올 곳 · 문서 폴더는 kmd) · auto: 가져올 곳(하루 상한을 넘으면 기록만)
    //   src: { rel, sha, title, file } | { src, commit, title, touches } · md: 원천 글 · bin: 원천 파일 바이트 · qj: 줄을 남길 가져오기 일
    async openJob(id, { type, by, auto = false, src = {}, md = '', bin = null, qj = null }) {
      if (mode !== 'team') throw new KmdError('E_INPUT', '들이기 일감은 팀 서버만 세운다')
      if (!['file', 'commit', 'fix', 'again', 'polish'].includes(type)) throw new KmdError('E_INPUT', '모르는 들이기 일감이다')
      if (!by || typeof by !== 'string') throw new KmdError('E_INPUT', '일감을 만든 사람이 없다')
      await hub.meta(id)
      sweepJobs()
      const key = intakeKey(type, src)
      // 같은 원천에 열린 일감이 있으면 그것(한 원천 = 일감 하나)
      const open = [...jobs.values()].find((j) => j.kind === 'intake' && j.kn === id && j.key === key && ['queued', 'running', 'closing'].includes(j.state))
      if (open) return { state: 'queued', job: open.id, again: true }
      const base = { id: crypto.randomBytes(6).toString('hex'), kn: id, kind: 'intake', type, key, by, auto: !!auto, at: new Date().toISOString(), src: { ...src, type }, tries: 0, leases: 0, cost: 0, calls: 0, ...(qj ? { qj } : {}) }
      // Claude 에 보내지 않는 지식 — 일감을 세우지 않고 기록만 + 넣지 못함(S-D22)
      if (rowFor(id)?.noClaude) return hub.intakeHeld(base, md, bin, 'noclaude', 'Claude 에 보내지 않는 지식: 기록만 남겼다')
      // 사람마다 기다리는 수(가져올 곳 · 문서 폴더는 세지 않는다) · 지식마다 하루 수(S-D47 — 팀 구독 비용의 경계)
      if (by !== 'kmd') {
        const cap = config.intakeQueue ?? 20
        if ([...jobs.values()].filter((j) => j.kind === 'intake' && j.kn === id && j.by === by && j.state === 'queued').length >= cap) throw new KmdError('E_RATE', `들이기를 기다리는 일이 ${cap} 개다. 끝난 뒤에 다시 보낸다`, { details: { retryAfter: 60 } })
      }
      const day = localDay(new Date())
      const n0 = intakeDay[id]?.day === day ? intakeDay[id].n : 0
      const dcap = config.intakeDaily ?? 300
      if (n0 >= dcap) {
        if (auto) return hub.intakeHeld(base, md, bin, 'worker', `오늘 들이기 수(${dcap})를 넘었다: 기록만 남겼다`)
        throw new KmdError('E_RATE', `이 지식의 오늘 들이기 수(${dcap})를 넘었다. 내일 다시 보낸다`, { details: { retryAfter: 3600 } })
      }
      intakeDay = { ...Object.fromEntries(Object.entries(intakeDay).filter(([, v]) => v.day === day)), [id]: { day, n: n0 + 1 } }
      await writeJsonAtomic(intakeDayFile, intakeDay)
      await fs.mkdir(path.join(dataDir, 'queue'), { recursive: true })
      await fs.writeFile(intakeMdOf(base.id), String(md))
      if (bin) await fs.writeFile(binOf(base.id), bin)
      const j = { ...base, state: 'queued' }
      jobs.set(j.id, j)
      saveJobs()
      return { state: 'queued', job: j.id }
    },
    // 들이기 저장의 자리(S-D43) — 일감을 끝낼 때 명부에서 다시 읽는다: 가져올 곳은 kmd · 사람은 지금 자리(쓰기 이상 · 다듬기는 지식관리자) · 떠났거나 자리가 없으면 null(넣지 못함 seat)
    //   shell · admin 류 ctx 를 쓰지 않는다 — 저장은 그 사람 이름 · 쓰기 자리 길(값 대조 · 원본이 주인 · 표 블록을 거친다)
    intakeCtx(j) {
      if (j.by === 'kmd') return { user: 'kmd', intake: true }
      const u = hub.userOf(j.by)
      if (!u || u.off) return null
      const lv = levelFor(j.kn, { user: j.by, admin: !!u.admin })
      if (!owners.atLeast(lv, 'write') || (j.type === 'polish' && lv !== 'admin')) return null
      return { user: j.by, intake: true }
    },
    userOf: (u) => ({ id: u }), // 사람 명부 — http 가 auth 로 바꿔 끼운다(hub 만 쓰는 시험은 있는 사람으로)
    // 기록만 + 넣지 못함 — 원천 앞 2000자와 지문(S-D50) · 원천은 held/ 에 남긴다 · 같은 일감 기록이 이미 있으면 same(S-D48)
    async intakeHeld(j, md, bin, code, why) {
      const ctx = j.by === 'kmd' ? { user: 'kmd', intake: true } : { user: j.by, intake: true }
      const r = await hub.save(ctx, j.kn, { record: heldRecord(j.src, md, { why }) }, { channel: intakeChannel(j), intake: { job: j.id, tags: intakeTagsOf(j), held: [{ code, why }], cost: j.calls ? { usd: Math.round(j.cost * 1e4) / 1e4, calls: j.calls } : null } })
      if (r.same) return { state: 'same', rec: r.id }
      await keepHeld(j.kn, r.id, md, bin)
      return { state: 'held', rec: r.id, why }
    },
    // 일감을 끝낸다 — 일꾼이 끝내지 못했다(임대 세 번 · 24시간 기다림) · 원천을 기록만 + 넣지 못함으로
    async intakeGiveUp(j, code, why) {
      const md = await fs.readFile(intakeMdOf(j.id), 'utf8').catch((e) => (e.code === 'ENOENT' ? '' : Promise.reject(e)))
      const bin = await fs.readFile(binOf(j.id)).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
      const r = await hub.intakeHeld(j, md, bin, code, why)
      await intakeClose(j, { rec: r.rec, put: 0, held: r.state === 'held' ? 1 : 0, same: r.state === 'same', why })
      return r
    },
    // 재료(GET /api/k/:kn/worker/intake) — 원천 · 후보 문서(항목마다 머리 · 글 1500자 · base) · 갈래 · 이름 장부 앞 200 · 이름 종류
    async intakeMaterial(dctx, id) {
      const j = intakeJobOf(dctx, id)
      // 나가기 전에 막는다 — 「Claude 에 보내지 않음」(S-D22 · 모든 type)
      if (rowFor(id)?.noClaude) throw new KmdError('E_FORBIDDEN', '이 지식은 Claude 에 보내지 않는다')
      const md = await fs.readFile(intakeMdOf(j.id), 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
      if (md == null) throw new KmdError('E_NOTFOUND', '들일 글이 남아 있지 않다')
      const k = await hub.get(id)
      const g = intakeG(k, j, md)
      // 일꾼에게 보인 후보 · 지문 — 끝낼 때 이것으로 견준다(일꾼이 보낸 것을 믿지 않는다)
      j.seen = g.docs.map((d) => ({ doc: d.doc, s: d.sections.map((x) => [x.h, x.base]) }))
      j.beat = new Date().toISOString()
      saveJobs()
      return g
    },
    // 소식 — 쓰는 중 · 끝(비용은 done 이 센다) · 사람이 멈췄으면 stop
    intakeProgress(dctx, id, { tick = false, end = false, ok = true, why = null } = {}) {
      const j = intakeJobOf(dctx, id)
      j.beat = new Date().toISOString()
      if (!tick) intakeLine(j, end ? (ok ? 'ok' : 'err') : 'tool', end ? (ok ? '✓ 초안을 받았다' : `✗ 초안을 받지 못했다${why ? `: ${String(why).slice(0, 120)}` : ''}`) : `▸ Claude 에 보냄 · ${j.tries ? `${j.tries + 1}번째` : '처음'}`)
      return { ok: true, stop: !!j.stop }
    },
    // 초안 끝 — 서버가 시도를 센다(본문의 tries · last 는 믿지 않는다 · S-D20) · 마지막 전에는 마른 검사만(고칠 수 있는 까닭이면 { fix })
    async intakeDone(dctx, id, body = {}) {
      const j = intakeJobOf(dctx, id)
      const usd = Number(body?.cost)
      if (usd > 0 && usd < 100) j.cost = (j.cost || 0) + usd
      j.calls = (j.calls || 0) + 1
      j.tries = (j.tries || 0) + 1
      const last = j.tries >= INTAKE_FIX + 1
      const md = await fs.readFile(intakeMdOf(j.id), 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
      if (md == null) throw new KmdError('E_NOTFOUND', '들일 글이 남아 있지 않다')
      const bin = await fs.readFile(binOf(j.id)).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
      cache.delete(id)
      const k = await hub.get(id)
      const g = intakeG(k, j, md, { seen: j.seen })
      const ctx = hub.intakeCtx(j)
      const cost = { usd: Math.round((j.cost || 0) * 1e4) / 1e4, calls: j.calls }
      const finish = async (r) => {
        if (r.held?.length) await keepHeld(id, r.id, md, bin)
        await intakeClose(j, { rec: r.id, put: r.put ?? 0, held: r.held?.length || 0, same: !!r.same })
        return { ok: true, rec: r.id, put: r.put ?? 0, held: (r.held || []).map(({ coord, doc, heading, code, why }) => ({ coord, doc, heading, code, why })), ...(r.same ? { same: true } : {}) }
      }
      // 그사이 자리를 잃었다 — 기록만 + 넣지 못함(그 사람 이름으로 · S-D43)
      if (!ctx) return finish(await hub.save({ user: j.by, intake: true }, id, { record: heldRecord(j.src, md, { why: '일감을 만든 사람의 쓰기 자리가 없다' }) }, { channel: intakeChannel(j), intake: { job: j.id, tags: intakeTagsOf(j), held: [{ code: 'seat', why: '일감을 만든 사람의 쓰기 자리가 없다: 지식관리자가 다시 들인다' }], cost } }))
      const p = draftToSave(k, g, body?.draft)
      if (!p.ok) {
        if (!last) { intakeLine(j, 'err', `✗ 검사에 걸렸다: ${p.why} · 고쳐 쓴다`); saveJobs(); return { fix: p.why } }
        return finish(await hub.save(ctx, id, { record: heldRecord(j.src, md, { why: p.why }) }, { channel: intakeChannel(j), intake: { job: j.id, tags: intakeTagsOf(j), held: [{ code: /값/.test(p.why) ? 'values' : 'format', why: `${INTAKE_FIX + 1}번 지어도 검사를 넘지 못했다: ${p.why}` }], cost } }))
      }
      if (!last) {
        const c = await hub.checkSave(ctx, id, p.input, { intake: true })
        if (c.same) return finish({ id: c.id, same: true, put: 0, held: [] })
        const bad = (c.held || []).find((h) => FIX_CODES.has(h.code))
        if (bad) { intakeLine(j, 'err', `✗ 검사에 걸렸다: ${bad.why} · 고쳐 쓴다`); saveJobs(); return { fix: `${bad.coord ? bad.coord + ': ' : ''}${bad.why}` } }
      }
      const r = await hub.save(ctx, id, p.input, { channel: intakeChannel(j), intake: { job: j.id, tags: intakeTagsOf(j), held: p.held, cost, warn: p.warn } })
      return finish(r)
    },
    // 초안을 받지 못했다(일꾼) — 로그인 · 한도 · claude 없음은 일감을 태우지 않고 다시 기다림 · 그 밖(예산 · 시간 · 모양)은 한 번으로 세고 마지막이면 기록만 + 넣지 못함(claude)
    async intakeFail(dctx, id, body = {}) {
      const j = intakeJobOf(dctx, id)
      const code = String(body?.code || '')
      if (!INTAKE_FAIL.has(code)) throw new KmdError('E_INPUT', `code 는 ${[...INTAKE_FAIL].join(' · ')} 중 하나다`)
      const raw = body?.why == null ? '' : String(body.why)
      if (/[\r\n]/.test(raw) || raw.length > 200) throw new KmdError('E_INPUT', 'why 는 한 줄 200자 안이다')
      const why = raw.trim()
      intakeLine(j, 'err', `✗ 초안을 받지 못했다: ${why || code}`)
      if (['login', 'limit', 'missing'].includes(code)) {
        Object.assign(j, { state: 'queued', worker: null, why: STOP_WHY[code] || why })
        saveJobs()
        return { ok: true, requeued: true }
      }
      j.calls = (j.calls || 0) + 1
      j.tries = (j.tries || 0) + 1
      if (j.tries < INTAKE_FIX + 1) { saveJobs(); return { ok: true, retry: true } }
      const r = await hub.intakeGiveUp(j, 'claude', `팀 일꾼이 초안을 받지 못했다: ${why || code}`)
      return { ok: true, rec: r.rec, held: r.state === 'held' ? 1 : 0 }
    },
    // 초안 받기 — 한 지식에 한 번에 하나씩(자리를 같이 쓰는 일꾼이 초안을 겹쳐 올린다 · 같은 문서에 같이 쓰지 않게)
    drafts(dctx, id, list, o = {}) {
      const run = (draftLocks.get(id) || Promise.resolve()).catch(() => {}).then(() => hub.putDrafts(dctx, id, list, o))
      draftLocks.set(id, run)
      return run
    },
    // part — 자리 하나를 쓰는 대로 넣는다(받은 것에서 바로 빠진다) · 일감은 끝내지 않고 줄은 j.rows 에 모았다가 끝에 「정리한 것」 한 장으로
    async putDrafts(dctx, id, list, { part = false, fix = false } = {}) {
      if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const j = jobs.get(dctx.draft.job)
      if (part && j?.state !== 'running') return { rows: [], stop: true }
      const meta = await hub.meta(id)
      const rows = []
      for (const item of Array.isArray(list) ? list : []) {
        // 그만둔 정리 — 일꾼이 쓰지 않은 자리는 넣지도 「그대로 둠」 으로 세지도 않는다(받은 것에 그대로)
        if (item.error === 'stopped') {
          rows.push({ kind: 'stopped', target: String(item.group?.heading || item.group?.record?.title || ''), records: [] })
          continue
        }
        cache.delete(id)
        const k = await hub.get(id)
        // 묶음은 일꾼이 보낸 것을 믿지 않고 지금 지식에서 다시 만든다(열쇠를 빼앗겨도 재료 · 근거를 바꾸지 못하게)
        const g = await groupFor(k, id, item.group, j?.ids || null)
        const d = item.draft
        if (!g) {
          rows.push({ kind: 'left', target: String(item.group?.heading || item.group?.record?.title || ''), why: '그사이 넣을 것이 없어졌다', records: [] })
          continue
        }
        // 받은 조각 미리 보기 — 검사 전에(검사가 조각을 새 글로 바꾼다) · 셋까지 · 앞뒤를 줄인다
        const spP = j?.spots?.find((x) => x.key === spotKey(item.group))
        if (spP && Array.isArray(d?.edits) && d.edits.length) spP.preview = d.edits.slice(0, 3).map((e) => ({ from: String(e?.find || '').slice(0, 160), to: String(e?.replace || '').slice(0, 200) }))
        const r = item.error ? { ok: false, why: STOP_WHY[item.error] || `초안을 받지 못했다${item.why ? ': ' + String(item.why).slice(0, 120) : ''}` } : checkDraft(k, g, d)
        const target = g.kind === 'touches' || g.kind === 'ingest' ? g.record.title : `${g.doc.replace(/^docs\/|\.md$/g, '')} › ${g.heading}`
        // 원본이 주인인 문서에는 정리도 넣지 않는다 — 기록은 문서 옆에 그대로 읽힌다
        if (g.doc && watchedOf(await fs.readFile(path.join(meta.dir, ...g.doc.split('/')), 'utf8').catch(() => ''))) {
          rows.push({ kind: 'left', target, why: '원본이 주인인 문서: 원본 파일을 고친다 · 기록은 옆에 그대로 읽힌다', records: (g.records || [g.record]).map((x) => x.id) })
          continue
        }
        const recs = g.kind === 'touches' || g.kind === 'ingest' ? [g.record] : g.records
        // 이름 고르기에서 맞는 이름이 후보에 없다 — 정리는 더 할 수 없다. 지식관리자가 이름을 세우거나 고른다(지식 생성 가드 · 지식 점검)
        if (g.kind === 'touches' && (!r.ok || !(d?.touches || []).length)) {
          const why = r.ok ? '맞는 이름이 후보에 없다: 지식관리자가 이름을 세우거나 고른다' : r.why
          rows.push({ kind: 'left', target, why, records: recs.map((x) => x.id) })
          await askName(id, meta, g.record, why)
          continue
        }
        // 초안이 고칠 수 있는 까닭으로 걸렸다 — 자리 하나씩 올린 것이면 일꾼에게 까닭을 돌려주고 한 번 다시 쓰게 한다(그대로 두지 않는다)
        if (!r.ok && part && fix && d && !r.stale && FIXABLE.test(r.why) && (list || []).length === 1) {
          const sp = j?.spots?.find((x) => x.key === spotKey(item.group))
          if (sp) {
            Object.assign(sp, { st: 'run', stage: 2, fixes: (sp.fixes || 0) + 1, fixWhy: String(r.why).slice(0, 120) })
            sp.lines.push([3, 'err', `✗ 검사: ${r.why} · 고쳐 쓰기 ${sp.fixes}번째`])
            stamp(j)
            saveJobs()
          }
          return { rows: [], fix: r.why, stop: !!j?.stop }
        }
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
              ? { kind: 'tidy', rec: saved.id, kn: id, yl: true, b: `kmd 가 정리하며 값을 바꿨다: ${meta.name} › ${target} · ${r.changed[0].from} → ${r.changed[0].to}`, small: '내 기록에서: 되돌릴 수 있다', go: { kn: id, doc: at.doc, hl: at.heading }, revert: saved.id }
              : { kind: 'tidy', rec: saved.id, kn: id, dot: 'acc', text: g.kind === 'ingest' ? `kmd 가 넣은 파일을 문서에 들였다: ${meta.name} › ${at.doc}` : `kmd 가 정리했다: ${meta.name} › ${target}`, small: g.kind === 'ingest' ? `${d.newDoc ? '새 문서' : '기존 문서에'} · ${g.record.title.split(/ — |: /)[0]}` : '내가 남긴 기록', go: { kn: id, doc: at.doc, hl: at.heading } })
          }
        } catch (e) {
          rows.push({ kind: 'left', target, why: e.message, records: recs.map((x) => x.id) })
        }
      }
      cache.delete(id)
      // 정리 일 줄 — 초안마다 검사 · 넣기 결과(한 초안이 한 줄) · 일꾼이 이미 적은 「초안을 받았다」 는 다시 적지 않는다
      if (j?.spots) {
        ;(Array.isArray(list) ? list : []).forEach((item, i) => {
          const sp = j.spots.find((x) => x.key === spotKey(item.group))
          const row = rows[i]
          if (!sp || !row) return
          if (row.kind === 'stopped') {
            Object.assign(sp, { st: 'stop', stage: 2 })
            sp.lines.push([2, 'sys', '그만뒀다 · 받은 것에 그대로 남는다'])
          } else if (row.kind === 'left') {
            // 초안이 없으면 글 쓰기에서 멈춘 것 — 검사 줄을 적지 않는다
            const stg = item.draft ? 3 : 2
            Object.assign(sp, { st: 'left', stage: stg, why: row.why })
            const had = sp.lines.some((l) => l[0] === 2 && l[1] !== 'tool')
            sp.lines.push(...(had ? [] : [item.draft ? [2, 'ok', '✓ 초안을 받았다'] : [2, 'err', `✗ ${row.why}`]]), ...(item.draft ? [[3, 'err', `✗ ${row.why}`]] : []), [stg, 'sys', '넣지 않고 둔다 · 받은 것에 그대로 · 다시 정리할 수 있다'])
          } else {
            Object.assign(sp, { st: 'done', stage: 5, res: row.kind, record: row.record || null, ...(row.kind === 'changed' ? { from: row.from, to: row.to } : {}) })
            sp.lines.push(...(sp.lines.some((l) => l[0] === 2 && l[1] === 'ok') ? [] : [[2, 'ok', '✓ 초안을 받았다']]), [3, 'ok', '✓ 글 모양 · 그 사이 바뀌지 않음 · 값 맞춤 · 크기 · 머리'], [4, 'ok', row.kind === 'changed' ? `✓ 넣었다 · 값 바뀜 ${row.from} → ${row.to} · 쓴 사람에게 알렸다` : '✓ 넣었다'])
          }
        })
        stamp(j)
        // 일꾼이 에이전트로 넣은 파일은 초안이 오지 않는다
        if (!part) for (const sp of j.spots) if (sp.st === 'wait' || sp.st === 'run' || sp.st === 'got') Object.assign(sp, j.stop && sp.st === 'wait' ? { st: 'stop', stage: 2 } : sp.kind === 'ingest' ? { st: 'done', stage: 5, res: 'put' } : { st: 'left', stage: sp.st === 'got' ? 3 : 2, why: '초안이 오지 않았다' })
      }
      if (part) {
        if (j) { j.rows = (j.rows || []).concat(rows); saveJobs() }
        return { rows, stop: !!j?.stop }
      }
      const done = (j?.rows || []).concat(rows).filter((x) => x.kind !== 'stopped')
      const took = (j?.spots || []).filter((x) => x.ms).map((x) => ({ key: x.key, ms: x.msAll || x.ms, chars: x.chars || 0, tries: x.tries || 1 }))
      const run = { at: new Date().toISOString(), by: j?.by || null, auto: !!j?.auto, rows: done, ...(j?.stop ? { stopped: j.stop.by } : {}), ...(j ? { job: j.id, started: j.started || null, ms: j.started ? Date.now() - Date.parse(j.started) : null, took } : {}) }
      // 지난 정리 줄의 제목 · 사람 — 화면이 최근 기록 200개에서 찾다 옛 기록은 id · 「kmd」 가 되던 것
      if (done.length) { const kk = await hub.get(id); for (const x of done) { const w = kk.byWork.get((x.records || [])[0]); if (w) Object.assign(x, { title: x.title || w.title, who: x.who || w.author }) } }
      if (done.length) await saveRun(id, run) // 빈 정리는 「정리한 것」 카드를 남기지 않는다
      // 이번에 세 번째로 둔 기록 — 지식관리자에게 「사람이 볼 것」 한 번
      if (done.some((x) => x.kind === 'left')) {
        const tries = await leftTries(id)
        const k = await hub.get(id)
        const hit = done.filter((x) => x.kind === 'left').flatMap((x) => (x.records || []).filter((r) => tries[r] === HOLD).map((r) => ({ r, why: x.why })))
        for (const { r, why } of hit.filter((x, i) => hit.findIndex((y) => y.r === x.r) === i)) {
          const w = k.byWork.get(r)
          for (const u of await hub.curatorsOf(id)) {
            await feed.add(dataDir, u, { kind: 'tidy', rec: r, kn: id, dot: 'warn', text: `정리가 세 번 넣지 못한 기록: ${meta.name} › 「${String(w?.title || r).split(/ — |: /)[0]}」`, small: `${String(why || '').slice(0, 80)} · 자동 정리에서 뺐다: 글을 고치거나 자리를 고른 뒤 [다시 정리]` }).catch((e) => log(`사람이 볼 것 알림 실패: ${e.message}`))
          }
        }
      }
      if (j) {
        const stop = (Array.isArray(list) ? list : []).filter((x) => STOP_WHY[x.error])
        const allStop = done.length > 0 && stop.length === done.length
        j.state = j.stop ? 'cancelled' : allStop ? 'failed' : 'done'
        j.done = run.at
        if (j.stop) j.why = `그만뒀다: ${j.stop.by} · 쓴 자리는 넣고 남은 자리 ${rows.length - done.length} 는 받은 것에 그대로`
        else if (allStop) j.why = STOP_WHY[stop[0].error] + (stop[0].error === 'limit' ? '. 풀리면 이어서 한다' : '. 설정 · 팀 › Claude 연결')
        j.summary = { put: done.filter((x) => x.kind === 'put' || x.kind === 'touches').length, changed: done.filter((x) => x.kind === 'changed').length, left: done.filter((x) => x.kind === 'left').length, ...(j.stop ? { stopped: rows.length - done.length } : {}) }
        saveJobs()
      }
      drafts.delete(sha(dctx.token || ''))
      // 이 PC — 일꾼은 이름만 고른다. 걸린 항목이 없는 코드 바뀜 기록은 Claude Code 가 문서에 들인다(codeToDoc)
      cache.delete(id)
      if (mode === 'pc' && hub.agentOk(id) && (await hub.get(id)).works.some((w) => w.state === 'nowhere' && w.tags.includes('code-change') && !codeFresh(w.id))) hub.curateSoon(id).catch(() => {})
      if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return { rows: (j?.rows || []).concat(rows), summary: j?.summary || null }
    },
    async workerStatus(wctx, { ok = true, reason = null, message = null } = {}) {
      const prev = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => ({}))
      const next = ok ? { ok: true, at: new Date().toISOString() } : { ok: false, reason, message: String(message || '').slice(0, 200), since: prev.ok === false ? prev.since : new Date().toISOString(), at: new Date().toISOString() }
      await writeJsonAtomic(path.join(dataDir, 'worker.json'), next)
      wsNow = next
      for (const j of jobs.values()) if (j.state === 'running' && j.worker === wctx.worker.id && !ok) Object.assign(j, j.kind === 'intake' ? { state: 'queued', worker: null, why: STOP_WHY[reason] || STOP_WHY.login } : { state: 'failed', why: STOP_WHY[reason] || STOP_WHY.login, done: new Date().toISOString() })
      saveJobs()
      return next
    },
    // 다시 로그인했다 — 쉼을 걷는다. 메모리도 걷어야 다음 [지금 정리] 가 규칙으로 새지 않는다
    async workerClear() {
      await fs.rm(path.join(dataDir, 'worker.json'), { force: true }).catch(() => {})
      wsNow = null
    },
    runs: (id) => readRuns(id),
    // 새 기기가 이어졌다 — 그 사람의 오늘 바뀐 것 · 다음 대화 첫 안내(다른 대역에서 받은 표면 노랑)
    async notifyDevice(user, dev) {
      await feed.add(dataDir, user, { kind: 'device', brief: true, yl: !!dev.yellow, dot: 'acc', text: `새 기기가 이어졌다: ${dev.host || '이름 없는 기기'} · ${user}`, small: '설치 한 줄로 · 내가 한 것이 아니면 [보기] 에서 끊는다', device: dev.id })
    },
    // 오늘 바뀐 것 · 알림 — 지식이 실린 줄은 지금 읽을 수 있는 지식만(자리를 잃은 뒤에도 남지 않게)
    feedOk(ctx, x) {
      return !x?.kn || visibleTo(x.kn, ctx)
    },
    async today(ctx) {
      return (await feed.list(dataDir, ctx.user)).filter((x) => hub.feedOk(ctx, x))
    },
    // 이력 — 오늘 바뀐 것(사람마다 · 7일 · 알아야 할 것 · git 밖의 일)과 지식의 이력(kmd 가 다룬 일 · 저장 문이 넣은 기록 · git)을 한 흐름으로.
    //   같은 일은 한 줄 — 가져오기 · 바로 고침 · 저장 문 저장은 지식의 이력 줄로(누구에게나 같다) · 정리는 내 줄로(되돌리기가 있다)
    //   저장 문이 넣은 기록(태그 put)은 「## 넣은 것」 의 항목마다 「옛 값 → 새 값」 · 지금도 그 기록이 표지인 항목(live)만 되돌릴 수 있다(S-D12 · S-D13)
    //   예전 줄(갈래 없음)은 글로 가른다
    async history(ctx) {
      const mine = (await feed.list(dataDir, ctx.user)).filter((x) => hub.feedOk(ctx, x))
      const rows = []
      const logs = []
      const names = {}
      const kById = {}
      const putOf = new Map() // 「지식 \n 기록 id」 → { items, canRevert, yl }
      for (const m of await hub.visible(ctx)) {
        const k = await hub.get(m.id, ctx)
        kById[k.id] = k
        names[k.id] = k.name
        const curator = hub.canDirect(ctx, k.id)
        const write = owners.atLeast(levelFor(k.id, ctx), 'write')
        // 넣지 못한 기록(held · 넣은 것 없음)은 쓴 사람과 지식관리자에게만 이력 줄로(넣지 못함 목록과 같이)
        const heldOnly = (w) => w.tags.includes('held') && !w.tags.includes('put')
        const pool = [...k.logs, ...k.works.filter((w) => w.tags.includes('put') || (heldOnly(w) && (curator || w.author === ctx.user)))]
          .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
          .slice(0, 300)
        for (const w of pool) logs.push({ k, w })
        // 저장 문이 넣은 항목 — 날짜 순으로 그 항목에 마지막으로 넣은 사람을 따라가며, 내 값을 남이 바꿨으면 노랑(값 바뀜)
        const last = new Map()
        const puts = [...k.works, ...k.logs].filter((w) => w.tags.includes('put')).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        for (const w of puts) {
          const back = k.revertedItems?.get(w.id)
          let yl = false
          const items = parsePut(w.body).map((x) => {
            const key = itemKey(x.doc, x.heading)
            const sec = findHeading(k.byDocPath.get(x.doc)?.sections || [], x.heading) // 같은 머리 먼저(배포 / 배포 절차)
            const live = sec?.applied === w.id
            if (!x.isNew && last.get(key) === ctx.user && w.author !== ctx.user) yl = true
            last.set(key, w.author)
            return { doc: x.doc, name: x.doc.replace(/^docs\/|\.md$/g, ''), heading: x.heading, from: x.from, to: x.to, isNew: x.isNew, live, reverted: !!back?.has(key) || !!k.reverted?.has(w.id) }
          })
          const canRevert = write && (curator || w.author === ctx.user) && items.some((x) => x.live)
          putOf.set(`${k.id}\n${w.id}`, { items, canRevert, yl })
        }
      }
      const logIds = new Set(logs.map((x) => x.w.id))
      // 받음 — 개인 지식에서 보낸 기록이 이 지식에 섰다(예전 줄은 글로) · 보냄 줄과 화면이 잇는다
      const kindOf = (x) => (x.from != null || (x.kind === 'save' && /에서 받음$/.test(x.text || '')) ? 'recv' : x.kind) || (x.revert || /^kmd 가 정리/.test(x.text || '') ? 'tidy' : /^새 기기/.test(x.text || '') ? 'device' : /^(지식을 |되살렸다)/.test(x.text || '') ? 'kn' : /보냈다|옮겼다/.test(x.text || '') ? 'send' : /^파일 /.test(x.text || '') ? 'import' : /에서 (바뀐 표|새 묶음)/.test(x.text || '') ? 'source' : 'save')
      const FEED_KIND = { save: '저장', import: '가져오기', source: '가져오기', tidy: '정리', send: '보내기', recv: '받음', kn: '지식', device: '지식' }
      const putFields = (kn, rec, w) => {
        const p = kn && rec ? putOf.get(`${kn}\n${rec}`) : null
        return p ? { items: p.items, canRevert: p.canRevert, ...(p.yl ? { yl: true } : {}), ...(w && (w.state === 'reverted' || kById[kn]?.reverted?.has(rec)) ? { reverted: true } : {}) } : {}
      }
      const taken = new Set()
      for (const x of mine) {
        const kind = kindOf(x)
        if (kind === 'source') continue // 지식의 이력 「가져옴」 이 같은 일
        if (kind === 'save' && (x.rec ? logIds.has(x.rec) : /「화면에서 고침/.test(x.text || ''))) continue // 바로 고침 · 저장 문 저장 — 이력 줄이 같은 일
        if (x.rec && logIds.has(x.rec)) taken.add(x.rec)
        const w = (kind === 'save' || kind === 'recv') && x.rec && kById[x.kn]?.byWork.get(x.rec)
        const sub = !w ? x.small || '' : w.state === 'pend' ? hub.pendText(x.kn) : w.state === 'nowhere' ? '넣을 곳을 찾는 중: 관리자가 고른다' : w.state === 'held' ? '넣지 못함: 기록만 남았다' : w.state === 'memo' ? '메모: 문서는 바꾸지 않았다' : w.state === 'reverted' ? '되돌렸다' : '문서에 들어갔다'
        // 보냄 · 받음 — 어디로 · 어디서 · 받은 기록이 문서에 들어갔나(st)
        const link = kind === 'send' ? { to: x.to || (String(x.text || '').match(/→ (.+)$/) || [])[1] || null } : kind === 'recv' ? { from: x.from || (String(x.text || '').match(/: (.+)에서 받음$/) || [])[1] || null, st: w ? w.state : null } : {}
        rows.push({ id: `f:${x.id}`, at: x.at, kind: FEED_KIND[kind], kn: x.kn || null, title: x.b || x.text, sub, who: kind === 'tidy' ? 'kmd' : kind === 'device' ? '' : ctx.user, yl: !!x.yl, revert: x.revert || null, device: x.device || null, go: x.go || null, rec: x.rec || null, ...link, ...putFields(x.kn, x.rec, w) })
      }
      // 항목 줄 글 — 「머리: 옛 값 → 새 값」 · 「머리 (새 항목)」
      const itemText = (it) => `${it.heading}${it.isNew ? ' (새 항목)' : it.from || it.to ? `: ${it.from || '—'} → ${it.to || '—'}` : ''}`
      for (const { k, w } of logs) {
        if (taken.has(w.id)) continue
        const p = putFields(k.id, w.id, w)
        const plain = [PUT_PART, HELD_PART, REVERTED_PART].reduce((b, n) => dropPart(b, n), w.body).replace(/\s+/g, ' ').trim()
        const held = w.tags.includes('held') ? parseHeld(w.body) : []
        const sub = p.items?.length
          ? p.items.slice(0, 3).map(itemText).join(' · ') + (p.items.length > 3 ? ` 외 ${p.items.length - 3}` : '') + (held.length ? ` · 넣지 못함 ${held.length}` : '')
          : held.length ? `넣지 못함 ${held.length}: ${String(held[0].why || '').slice(0, 160)}` : plain.slice(0, 200)
        rows.push({ id: `l:${k.id}:${w.id}`, at: isoOfStamp(w.date), kind: logKind(w), kn: k.id, title: w.title, sub, who: w.author, rec: w.id, ...p })
      }
      for (const r of rows) r.knName = r.kn ? names[r.kn] || r.kn : ''
      rows.sort((a, b) => String(b.at).localeCompare(String(a.at)))
      return rows.slice(0, 600)
    },
    async notices(ctx) {
      return feed.takeNotices(dataDir, ctx.user, (x) => hub.feedOk(ctx, x))
    },

    // ── 파일 · 폴더 넣기(KM82 — 한 번 들여온다) ──
    // ── 이 PC — 정리가 따로 없다: 「아직 안 넣은 기록」 은 남는 즉시 문서에 ──
    //   Claude(claude -p · 정리와 같은 프롬프트 · 같은 검사)로 다듬어 넣고, 로그인 없음 · 한도 · 검사 실패 · Claude 끔이면 규칙으로:
    //   항목이 정해진 기록 → 그 항목 끝에 글을 붙인다 · 이름 없는 기록(넣은 파일 · 세션 메모) → 이어지는 문서 또는 새 문서(규칙이면 새 문서)
    //   어느 쪽이든 그 기록은 「넣음」(reflects) · 넣은 일은 이력에 · 지식마다 한 줄로(저장은 바로 돌려주고 뒤에서)
    // role — 그 일의 모델(core/models.js · 설정 › Claude 모델)
    async askClaude(id, prompt, schema, { budget = 0.5, timeoutMs, role = 'ingest' } = {}) {
      if (mode !== 'pc') return { why: '팀 서버는 이 길로 Claude 를 부르지 않는다(정리 일꾼이 한다)' }
      if (!hub.meaningOk(id)) return { why: 'Claude 를 쓰지 않는다' }
      const r = await runClaude({ prompt, schema, budget, model: hub.modelOf(role), ...(timeoutMs ? { timeoutMs } : {}) })
      if (r.error) {
        if (r.error === 'login' || r.error === 'limit') await hub.workerStatus({ worker: { id: null } }, { ok: false, reason: r.error, message: r.message })
        return { why: r.error === 'login' ? 'Claude 로그인이 없다. 머리의 「Claude」 에서 로그인' : r.error === 'limit' ? 'Claude 사용 한도' : 'Claude 가 답하지 않았다' }
      }
      await hub.workerStatus({ worker: { id: null } }, { ok: true })
      return { value: r.value, model: r.model }
    },
    // ── 에이전트로 지식 세우기 · 터미널(요구 v0.2 R6 · R8) ──
    //   일(run) 하나 = 파일 하나를 들이는 일 — 줄(터미널) · 상태 · 넣은 문서. 지식마다 최근 30 · 서버를 다시 켜면 비운다(이력은 log/)
    newRun(id, { title, file = null, by = null, quiet = false, parent = null }) {
      const run = { id: crypto.randomBytes(6).toString('hex'), kn: id, title, file, by, quiet, state: 'wait', startedAt: new Date().toISOString(), endedAt: null, lines: [], docs: [], names: 0, msg: '', kind: 'file', origin: by === 'kmd' ? 'docs' : 'file', ...(parent ? { parent } : {}) }
      runs.set(run.id, run)
      Q.add(run)
      // 끝난 일은 지식마다 최근 200 까지 메모리에(파일에는 30일)
      const mine = [...runs.values()].filter((r) => r.kn === id && r.endedAt)
      for (const r of mine.slice(0, Math.max(0, mine.length - 200))) runs.delete(r.id)
      Q.forget((j) => j.kind === 'file' && j.kn === id && !runs.has(j.id))
      return run
    },
    runLine(run, k, x) {
      Q.line(run, k, x) // 줄마다 그때의 단계(s)
    },
    // 끝난 일은 지식마다 파일로(<살림>/runs/<지식>.json · 30일 · 200 · 줄은 400 까지) — 다시 켜도 「끝난 일」 · 터미널이 남는다
    //   일 줄에서도 닫는다(못함은 줄에 남아 [다시] 를 기다린다) · 묶음의 마지막 파일이면 묶음도 닫는다
    runSave(run) {
      Q.end(run)
      if (isFinal(run)) fs.rm(binOf(run.id), { force: true }).catch(() => {})
      if (run.parent) hub.groupCheck(Q.get(run.parent))
      const f = path.join(dataDir, 'runs', `${encodeURIComponent(run.kn)}.json`)
      return serial(`json:${f}`, () => {
        const cut = Date.now() - 30 * 864e5
        const mine = [...runs.values()].filter((r) => r.kn === run.kn && r.endedAt && Date.parse(r.endedAt) >= cut).slice(-200).map((r) => ({ ...r, lines: r.lines.slice(-400) }))
        return writeJsonAtomic(f, mine)
      }).catch(() => {})
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
    // ── 일 줄(가져오기 화면 · core/queue.js) ──
    // 가져오기 한 번이 끝났다 — 그대로 · 바뀜 = 끝남 · 브레이크 = 확인할 것 · 못 가져옴 = 못함
    sourceJobEnd(qj, s, r) {
      const st = r.state === 'stopped' ? 'check' : r.state === 'failed' ? 'fail' : 'done'
      const msg = r.state === 'stopped' ? `한꺼번에 크게 바뀌었다: ${r.vanished ? `사라진 항목 ${r.vanished}` : `새 항목 ${r.added}`}${r.of ? ` / ${r.of}` : ''} · 아직 아무것도 쓰지 않았다`
        : r.state === 'failed' ? `못 가져왔다: ${r.why || ''}`
        : r.state === 'waiting' ? r.why || '쉰다'
        : r.commits != null ? (r.commits ? `새 묶음 ${r.commits}${r.codeRecords ? ` · 코드 바뀜 ${r.codeRecords}: ${intakeSum(r)}` : ' · 코드는 그대로'}` : '새 묶음 없음')
        // 문서 폴더(recs) — 파일마다 들이기(넣음 · 넣지 못함 · 들이기에 넘김) · 원본에서 지운 파일(지식은 그대로)
        : r.recs != null ? `${r.state === 'changed' ? intakeSum(r) : '그대로'}${r.removed ? ` · 원본에서 지움 ${r.removed}(지식은 그대로)` : ''}`
        : r.state === 'changed' ? `바뀐 표 ${r.n}`
        : '그대로'
      qj.same = st === 'done' && r.state !== 'changed'
      // 들이기에 넘긴 것 — 팀 일꾼이 넣으면(넣지 못하면) 이 아래에 하나마다 한 줄 · 이 PC 의 커밋 기록은 저장 즉시 넣기가 넣으면 한 줄
      Q.line(qj, st === 'done' ? (r.queued || r.record ? 'sys' : 'ok') : 'err', r.queued ? `${msg} · 팀 일꾼이 넣으면 여기에 하나마다 한 줄` : r.record && r.commits != null ? `${msg} · 문서에 넣으면 여기에 한 줄씩` : msg)
      Q.end(qj, st, msg)
      // 같은 곳의 지난 확인할 것 · 못함은 걷는다(이번 것이 맞췄거나 새 줄로 섰다) · 그대로였던 확인은 마지막 것만 남긴다
      for (const j of Q.list()) {
        if (j === qj || j.kind !== 'source' || j.kn !== qj.kn || j.spec?.name !== s.name) continue
        if (j.state === 'fail' || j.state === 'check' || (qj.same && j.same && isFinal(j))) Q.drop(j)
      }
    },
    // 파일 묶음 — 화면이 여러 파일을 나눠 보내는 것을 일 하나로(안의 파일마다 들이는 일이 아래에 선다) · id 는 화면이 정해 온다(첫 조각이 그 id 로 세운다)
    groupJob(ctx, id, g) {
      const old = g.id ? Q.get(String(g.id)) : null
      if (old) {
        if (old.kind !== 'group' || old.kn !== id) throw new KmdError('E_INPUT', '그 묶음이 아니다')
        // 남의 묶음은 이어 쓰지 않는다(묶음 id 는 일 줄에 보인다 · 줄을 더하거나 닫지 못하게) — 그 지식의 관리 자리는 된다
        if (old.by !== ctx.user && levelFor(id, ctx) !== 'admin') throw new KmdError('E_FORBIDDEN', '다른 사람의 파일 묶음이다')
        return old
      }
      const j = Q.add({ ...(/^[0-9a-f]{12}$/.test(String(g.id || '')) ? { id: String(g.id) } : {}), kind: 'group', origin: 'file', kn: id, title: String(g.title || '파일 묶음').slice(0, 200), by: ctx.user, total: Math.max(0, Number(g.total) || 0), sent: 0, children: [], rows: [], touched: new Date().toISOString() })
      Q.mark(j, 0)
      Q.line(j, 'sys', `파일 ${j.total}: 화면이 나눠 보낸다`)
      return j
    },
    groupAdd(j, rows, n, last) {
      j.sent += n
      j.touched = new Date().toISOString()
      for (const r of rows) {
        j.rows.push({ name: r.name, kind: r.kind, msg: r.msg || '', ...(r.run ? { run: r.run } : {}) })
        if (r.run) j.children.push(r.run)
      }
      if (j.rows.length > 2000) j.rows.splice(0, j.rows.length - 2000)
      const c = (k) => j.rows.filter((x) => x.kind === k).length
      j.msg = `받았다 ${j.sent}/${j.total || j.sent} · 문서 ${c('doc')} · 기록 ${c('record')} · Claude 일 ${c('run')} · 첨부 ${c('att')}${c('same') ? ' · 그대로 ' + c('same') : ''}${c('fail') ? ' · 못 넣음 ' + c('fail') : ''}${c('skip') ? ' · 읽지 못하는 종류 ' + c('skip') : ''}`
      Q.line(j, c('fail') ? 'err' : 'ok', j.msg)
      if (last || (j.total && j.sent >= j.total)) { j.uploaded = true; if (j.state !== 'pause') Q.mark(j, 3) }
      hub.groupCheck(j)
    },
    // 다 보냈고 안의 일이 모두 끝났다(못함은 줄에 남는다) — 묶음을 닫는다
    groupCheck(j) {
      if (!j || j.kind !== 'group' || !j.uploaded || isFinal(j)) return
      const kids = j.children.map((id) => Q.get(id)).filter(Boolean)
      if (kids.some((x) => !isFinal(x) && x.state !== 'fail')) return
      const bad = kids.filter((x) => x.state === 'fail').length
      Q.end(j, 'done', `${j.msg}${bad ? ` · 들이지 못한 파일 ${bad}` : ''}`)
    },
    groupAct(j, act) {
      const kids = j.children.map((x) => Q.get(x)).filter((x) => x && !isFinal(x))
      if (act === 'cancel') {
        for (const x of kids) if (x.state !== 'fail') Q.cancel(x.id, '그만뒀다. 묶음째')
        return Q.end(j, 'cancel', `그만뒀다: ${j.sent}/${j.total} 에서 · 남은 파일은 보내지 않는다`)
      }
      if (act === 'pause') { for (const x of kids) Q.pause(x.id); Object.assign(j, { paused: true, state: 'pause', msg: '멈췄다. 안의 파일이 지금 단계를 마치고 선다' }); return j }
      if (act === 'resume') { for (const x of kids) if (x.state === 'pause' || x.state === 'pausing') Q.resume(x.id); Object.assign(j, { paused: false, state: 'run' }); hub.groupCheck(j); return j }
      throw new KmdError('E_INPUT', '묶음은 멈춤 · 이어서 · 그만두기만 한다')
    },
    queueItem(j, knName = null) {
      const { lines, spec, rows, children, ...x } = j
      return { ...x, knName, n: (lines || []).length, fin: isFinal(j) || !!j.legacy, retry: ['ingest', 'source'].includes(spec?.type) || j.kind === 'curate', ...(spec?.name ? { src: spec.name } : {}), ...(spec?.recId ? { rec: spec.recId } : {}), ...(j.kind === 'group' ? { rows: (rows || []).slice(-300), children: (children || []).length } : {}) }
    },
    async queueList(ctx) {
      const ks = new Map((await hub.visible(ctx)).map((k) => [k.id, k.name]))
      const items = []
      for (const j of Q.list()) {
        if (!ks.has(j.kn) || (j.kind === 'file' && !hub.runOk(j, ctx))) continue
        if (j.kind === 'group' && !j.uploaded && !isFinal(j) && Date.now() - Date.parse(j.touched || j.at) > 10 * 60_000) Q.end(j, 'fail', `화면이 나머지 파일을 보내지 않았다: ${j.sent}/${j.total}`)
        // 못함 — 정리가 뒤에서 그 기록을 넣었으면 걷는다
        if (j.kind === 'file' && j.state === 'fail' && !j.legacy && j.spec?.recId) {
          const w = (await hub.get(j.kn).catch(() => null))?.byWork.get(j.spec.recId)
          if (w && w.state !== 'pend' && w.state !== 'nowhere') Q.end(j, 'done', '정리가 뒤에서 문서에 넣었다')
        }
        items.push(hub.queueItem(j, ks.get(j.kn)))
      }
      // 팀 정리 일감 — 정리 일꾼이 맡는다(같은 줄에 보이고 · 기다리는 것은 뺄 수 있다)
      for (const t of jobs.values()) {
        if (!ks.has(t.kn) || t.kind) continue // 들이기 일감은 가져오기 일 줄에 줄로 남는다
        const state = t.state === 'running' && t.stop ? 'pausing' : { queued: 'wait', running: 'run', failed: 'fail', cancelled: 'cancel' }[t.state] || 'done'
        const sum = t.summary ? `넣음 ${t.summary.put ?? 0}${t.summary.changed ? ` · 값 바뀜 ${t.summary.changed}` : ''}${t.summary.left ? ` · 남김 ${t.summary.left}` : ''}` : ''
        items.push({ id: 't:' + t.id, kind: 'tidy', origin: 'kmd', kn: t.kn, knName: ks.get(t.kn), title: '정리', by: t.by || 'kmd', auto: t.auto ? 'tidy' : null, state, stage: 3, stages: [{ state: 'skip' }, { state: 'skip' }, { state: 'skip' }, { state: state === 'cancel' ? 'cancel' : state }], order: 1e9, at: t.at, startedAt: t.at, endedAt: t.done || null, msg: t.state === 'running' && t.stop ? `멈추는 중: ${t.stop.by} · 지금 쓰는 자리가 끝나면 멈춘다` : t.why || (t.state === 'queued' ? '정리 일꾼을 기다린다' : t.state === 'running' ? '정리 일꾼이 하는 중' : sum), n: 0, fin: !['queued', 'running', 'failed'].includes(t.state), retry: false })
      }
      return { hold: Q.hold, caps: Q.caps, lanes: Q.lanes(), can: mode === 'pc' || !!ctx.admin, items }
    },
    async queueGet(ctx, id, from = 0) {
      const j = Q.get(id)
      if (!j || !(await hub.visible(ctx)).some((k) => k.id === j.kn) || (j.kind === 'file' && !hub.runOk(j, ctx))) throw new KmdError('E_NOTFOUND', '그 일은 이제 없다')
      return { ...hub.queueItem(j), lines: (j.lines || []).slice(Math.max(0, from)) }
    },
    // 손잡이 — 멈춤 · 이어서 · 그만두기 · 다시 · 그대로 맞추기(force) · 맨 앞으로 · 옮기기. 넣은 사람(쓰기 자리) · 그 지식의 관리 자리(이 PC 는 누구나)
    async queueAct(ctx, id, act, b = {}) {
      const mine = async (kn, by) => mode === 'pc' || levelFor(kn, ctx) === 'admin' || (by === ctx.user && owners.atLeast(levelFor(kn, ctx), 'write'))
      if (id.startsWith('t:')) {
        const t = jobs.get(id.slice(2))
        if (!t || t.kind || !(await hub.visible(ctx)).some((k) => k.id === t.kn)) throw new KmdError('E_NOTFOUND', '그 일은 이제 없다')
        if (act !== 'cancel') throw new KmdError('E_INPUT', '정리 일감은 그만두기만 한다')
        if (!(await mine(t.kn, t.by))) throw new KmdError('E_FORBIDDEN', '넣은 사람 · 그 지식의 지식관리자가 한다')
        // 도는 정리 — 일꾼이 다음 자리를 시작하거나 지금 자리를 끝낼 때 멈춘다(쓴 초안은 넣는다) · 일꾼이 안 오면 5분 뒤 닫는다
        if (t.state === 'running') {
          if (!t.stop) t.stop = { by: ctx.user, at: new Date().toISOString() }
          t.leaseUntil = Math.min(t.leaseUntil || Infinity, Date.now() + 5 * 60_000)
          saveJobs()
          return { ok: true, stopping: true }
        }
        if (t.state !== 'queued') throw new KmdError('E_CONFLICT', '이미 끝난 정리다')
        Object.assign(t, { state: 'cancelled', why: `뺐다: ${ctx.user}`, done: new Date().toISOString() })
        saveJobs()
        return { ok: true }
      }
      const j = Q.get(id)
      if (!j || !(await hub.visible(ctx)).some((k) => k.id === j.kn)) throw new KmdError('E_NOTFOUND', '그 일은 이제 없다')
      if (!(await mine(j.kn, j.by))) throw new KmdError('E_FORBIDDEN', '넣은 사람 · 그 지식의 지식관리자가 한다')
      try {
        if (j.kind === 'group') return hub.queueItem(hub.groupAct(j, act))
        if (act === 'force' && mode !== 'pc' && !hub.canSource(ctx, j.kn)) throw new KmdError('E_FORBIDDEN', '[그대로 맞추기] 는 그 지식의 지식관리자가 한다')
        const again = act === 'retry' || act === 'force' || (act === 'resume' && j.parked === 'restart')
        // 가져오기 · 넣기는 새로 한 번 — 지난 일은 걷는다
        if (again && j.kind === 'source') {
          Q.drop(j)
          hub.sourceRun(j.spec.kn, j.spec.name, { force: act === 'force', full: !!j.spec.full, by: ctx.user }).catch(() => {})
          return { ok: true, again: true }
        }
        if (again && j.kind === 'curate') { Q.drop(j); hub.curateSoon(j.kn).catch(() => {}); return { ok: true, again: true } }
        if (act === 'force') throw new KmdError('E_INPUT', '그대로 맞추기는 가져오기만 한다')
        const r = act === 'pause' ? Q.pause(id) : act === 'resume' ? Q.resume(id) : act === 'cancel' ? Q.cancel(id, `그만뒀다: ${ctx.user}`) : act === 'retry' ? Q.retry(id) : act === 'top' ? Q.top(id) : act === 'move' ? Q.move(id, String(b.before || '')) : null
        if (!r) throw new KmdError('E_INPUT', '그런 손잡이는 없다')
        return hub.queueItem(r)
      } catch (e) {
        if (e.code && !(e instanceof KmdError)) throw new KmdError(e.code, e.message)
        throw e
      }
    },
    queueHold(ctx, on) {
      if (mode !== 'pc' && !ctx.admin) throw new KmdError('E_FORBIDDEN', '줄 멈춤은 총괄 관리자가 한다')
      return Q.setHold(on)
    },
    queueCaps(ctx, x) {
      if (mode !== 'pc' && !ctx.admin) throw new KmdError('E_FORBIDDEN', '동시에 도는 수는 총괄 관리자가 정한다')
      return Q.setCaps({ claude: x?.claude, fetch: x?.fetch })
    },
    queue: Q,
    // 지금 하는 일 — 가져오기(지켜보며 맞추기) · Claude Code 일(넣은 파일 · 코드 바뀜) · 정리 일감 · 바로 넣기 · 전체 다시 맞추기.
    //   왼쪽 위 「kmd」 의 점멸 점과 작은 팝업이 읽는다(가볍게 — 메모리만)
    async busy(ctx) {
      const ks = new Map((await hub.visible(ctx)).map((k) => [k.id, k.name]))
      const nm = (id) => ks.get(id)
      const out = []
      // qid — 일 줄(Q)의 일 id(화면이 그 줄 · 터미널로 간다) · 정리는 job(정리 일감 id · 일 줄에서는 t:<job>)
      for (const b of srcBusy.values()) if (nm(b.kn)) out.push({ kind: 'source', kn: b.kn, knName: nm(b.kn), name: b.name, title: `${b.name} 가져오는 중${b.full ? ': 전체 다시 맞추기' : ''}`, small: { git: '소스 코드', db: 'DB', docs: '문서 폴더', folder: '폴더' }[b.kind] || b.kind, since: b.since, ...(b.qid ? { qid: b.qid } : {}) })
      for (const r of runs.values()) if ((r.state === 'wait' || r.state === 'run' || r.state === 'pausing') && nm(r.kn) && hub.runOk(r, ctx)) out.push({ kind: 'run', kn: r.kn, knName: nm(r.kn), title: r.title, small: r.state === 'wait' ? '차례를 기다린다' : r.state === 'pausing' ? '멈추는 중: 지금 단계를 마치고 선다' : `Claude Code 가 들이는 중 · 줄 ${r.lines.length}`, since: r.startedAt, run: r.id, qid: r.id })
      for (const j of jobs.values()) if (!j.kind && (j.state === 'queued' || j.state === 'running') && nm(j.kn)) out.push({ kind: 'tidy', kn: j.kn, knName: nm(j.kn), title: '정리', small: j.state === 'queued' ? '정리 일꾼을 기다린다' : j.stop ? '멈추는 중' : j.spots?.length ? `정리하는 중 · 넣을 곳 ${j.spots.length} 중 ${j.spots.filter((x) => x.st === 'done' || x.st === 'got' || (x.st === 'left' && x.stage >= 3)).length} 씀` : '정리하는 중', since: j.at, job: j.id, qid: 't:' + j.id })
      // 바로 넣기 — 차례를 기다리는 기록 수(코드 바뀜은 Claude Code 가 하나씩 넣어 몇 분씩 걸린다)
      for (const [id, since] of curating) {
        if (!nm(id)) continue
        const wait = (await hub.get(id)).works.filter((w) => (w.state === 'pend' || w.state === 'nowhere') && !queuedRecs.has(w.id)).length
        out.push({ kind: 'curate', kn: id, knName: nm(id), title: '기록을 문서에 넣는 중', small: wait ? `차례를 기다리는 기록 ${wait}` : '마무리하는 중', since, ...(curateQ.has(id) ? { qid: curateQ.get(id) } : {}) })
      }
      // 파일 묶음 — 화면이 나눠 보내는 중이거나 안의 파일이 도는 중(멈춘 묶음 · 멈추는 중도)
      for (const j of Q.list()) {
        if (j.kind !== 'group' || isFinal(j) || !nm(j.kn) || j.state === 'fail' || j.state === 'check') continue
        const n = j.total || j.sent || 0
        out.push({ kind: 'group', kn: j.kn, knName: nm(j.kn), title: `파일 ${n}개 넣는 중`, small: j.state === 'pause' ? '멈췄다' : j.uploaded ? `받았다 ${j.sent}/${n} · 안의 파일이 도는 중` : `받는 중 ${j.sent}/${n}`, since: j.at || j.touched, qid: j.id })
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
    // pdf · hwp · 그림만 든 docx · pptx · xlsx · hwpx → md — 바꾼 글 보관(<살림>/convert/<sha>.md)이 있으면 그것 · 없고 run 이 있으면 Claude Code 가 원본을 읽어 옮긴다
    //   오피스 파일은 Read 가 못 연다 — 안의 그림(pptx 는 슬라이드 차례)을 꺼내 준다
    async mdOf(rel, data, run = null) {
      const sha = crypto.createHash('sha256').update(data).digest('hex')
      const f = path.join(dataDir, 'convert', `${sha}.md`)
      const have = await fs.readFile(f, 'utf8').catch(() => null)
      if (have) return have
      if (!run) return null
      const name = rel.split('/').pop()
      const ext = name.split('.').pop().toLowerCase()
      const imgs = PCONLY.includes(ext) ? [] : imagesOf(name, data)
      if (!PCONLY.includes(ext) && !imgs.length) return null
      const slide = ext === 'pptx'
      hub.runLine(run, 'sys', `${name}: 글로 바꾼다(Claude Code 가 ${imgs.length ? `그림 ${imgs.length}장` : '원본'}을 읽는다)`)
      const r = await runAgent({
        prompt: [
          imgs.length
            ? `일 폴더의 「원본/${name}/」 그림 ${imgs.length}장(${slide ? '슬라이드' : '문서'} 차례 · 이름 차례)을 Read 로 하나씩 모두 읽고 그림 속 글을 그대로 md 로 옮긴다.${slide ? ' 슬라이드마다 `## 슬라이드 n: 제목` 머리 하나.' : ''}`
            : `일 폴더의 「원본/${name}」 을 Read 로 끝까지 읽고(쪽이 많으면 나눠 읽는다) 글 그대로 md 로 옮긴다.`,
          '- 머리 · 표 · 목록 짜임을 살린다(표는 md 표). 수 · 날짜 · 이름은 그대로. 요약하지 않는다.',
          '- 쪽 번호 · 머리글 · 바닥글 · 표지 장식은 뺀다. 글이 아닌 그림(사진 · 도형)은 [그림: 무엇] 한 줄로.',
          '- 마지막 답에는 md 글만 쓴다(설명 · 머리말 없이).',
        ].join('\n'),
        files: imgs.length ? imgs.map((x) => ({ name: `원본/${name}/${x.name}`, data: x.data })) : [{ name: `원본/${name}`, data }],
        budget: 3,
        model: hub.modelOf('convert'),
        onLine: (l) => hub.runLine(run, l.k, l.x),
        signal: Q.signal(run),
      })
      if (r.error === 'cancel') throw new Cancelled()
      if (!r.ok || !r.text.trim()) return null
      const md = r.text.replace(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```\s*$/m, '$1').trim()
      await fs.mkdir(path.dirname(f), { recursive: true })
      await fs.writeFile(f, md + '\n', 'utf8')
      hub.runLine(run, 'ok', `글로 바꿨다: ${md.split('\n').length}줄`)
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
      await Q.step(run, 3)
      hub.runLine(run, 'sys', `${meta.name} 에 들인다. 기록 ${w.id}`)
      const token = hub.agentToken(id, w.id, run.id)
      let r
      try {
        r = await runAgent({ ...(await hub.agentTask(meta, w, original)), mcp: { url: `${hub.selfUrl}/mcp`, token }, budget: 3, model: hub.modelOf('agent'), onLine: (l) => hub.runLine(run, l.k, l.x), signal: Q.signal(run) })
      } finally {
        agentKeys.delete(token)
      }
      if (r.error === 'cancel') throw new Cancelled()
      cache.delete(id)
      const k2 = await hub.get(id)
      const w2 = k2.byWork.get(w.id)
      if (r.ok && w2 && w2.state !== 'pend' && w2.state !== 'nowhere') {
        run.state = 'done'
        run.msg = `문서에 넣었다: ${run.docs.join(' · ') || meta.name}${run.names ? ` · 이름 ${run.names}` : ''}`
        if (r.error === 'login' || r.error === 'limit') await hub.workerStatus({ worker: { id: null } }, { ok: false, reason: r.error, message: r.message })
        else await hub.workerStatus({ worker: { id: null } }, { ok: true })
        if (!run.quiet) feed.add(dataDir, w.author, { kind: 'tidy', kn: id, dot: 'acc', text: `kmd 가 넣은 파일을 문서에 들였다: ${meta.name} › ${run.docs[0] || ''}`, small: `${name} · Claude Code 로`, ...(run.docs[0] ? { go: { kn: id, doc: run.docs[0] } } : {}) }).catch(() => {})
        return { doc: run.docs[0] || null, how: 'agent', msg: run.msg }
      }
      if (r.error === 'login' || r.error === 'limit') await hub.workerStatus({ worker: { id: null } }, { ok: false, reason: r.error, message: r.message })
      const why = r.ok ? 'Claude Code 가 이 기록을 문서에 넣지 않았다' : r.error === 'login' ? 'Claude 로그인이 없다. 머리의 「Claude」 에서 로그인' : r.error === 'limit' ? 'Claude 한도 · 예산' : 'Claude Code 가 끝을 내지 못했다'
      hub.runLine(run, 'sys', `규칙으로 넣는다: ${why}`)
      const got = await hub.ingestNow(id, w.id, { claude: false, why })
      run.state = got.doc ? 'rule' : 'fail'
      run.msg = got.doc ? `규칙으로 넣었다: ${got.doc} · ${why}` : `넣지 못했다: ${got.why || why}`
      if (got.doc) run.docs.push(got.doc)
      return got
    },
    // 코드 바뀜 기록 하나를 문서로 — Claude Code(에이전트)가 지식을 둘러보고 그 저장소가 만드는 시스템의 기능 · 설계 문서에
    //   넣는다(바뀐 기능의 항목을 지금 동작으로 고치거나 새 항목). 커밋마다 새 문서를 세우지 않는다. 에이전트가 없으면 기록으로 둔다
    async codeToDoc(id, w) {
      if (!hub.agentOk(id) || codeFresh(w.id) || queuedRecs.has(w.id)) return false
      codeTried.set(w.id, Date.now())
      queuedRecs.add(w.id)
      const run = hub.newRun(id, { title: w.title.split(/ — |: /)[0], file: hub.ingestFileOf(w), by: w.author, quiet: true })
      try {
        await hub.ingestAgent(id, w.id, run)
      } catch (e) {
        run.state = e?.cancelled ? 'cancel' : 'fail'
        run.msg = e?.cancelled ? '그만뒀다. 기록은 남았다' : e.message
        hub.runLine(run, e?.cancelled ? 'sys' : 'err', run.msg)
      } finally {
        queuedRecs.delete(w.id)
        run.endedAt = new Date().toISOString()
        hub.runSave(run)
        cache.delete(id)
        // 못 넣었으면 한 시간 뒤 정리 때 다시 맡는다 — 그때 줄도 이 일에
        const ok = run.state === 'done' || run.state === 'rule'
        codeNote([w.id], ok ? 'ok' : 'err', `문서: 「${w.title.split(/ — |: /)[0]}」 ${ok ? `→ ${run.docs.join(' · ') || '넣었다'}(Claude Code)` : `못 넣었다 · ${run.msg || ''}: 한 시간 뒤 다시`}`, { keep: !ok })
      }
      return run.state === 'done'
    },
    ingestFileOf(w) {
      const tag = w.tags.find((t) => t.startsWith('ingest/'))
      return tag ? tag.slice(7) : `${w.title.split(/ — |: /)[0]}.md`
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
      if (run) hub.runLine(run, 'sys', `${file.split('/').pop()}: Claude 가 읽고 기록을 정리한다(무엇 · 핵심 · 정한 것 · 남은 것 + 본문)`)
      const src = { file, author: w.author, date: w.date, md: w.body }
      const prompt = filePrompt(src)
      // 분석은 살림 자리에 남긴다(<살림>/convert/<지문>.read.json) — 쓰기가 넘어져 다시 해도 Claude 를 또 부르지 않는다
      const keep = path.join(dataDir, 'convert', `${crypto.createHash('sha256').update(prompt).digest('hex')}.read.json`)
      let a = await fs.readFile(keep, 'utf8').then((t) => ({ value: JSON.parse(t) }), () => null)
      if (!a) {
        a = await hub.askClaude(id, prompt, FILE_SCHEMA, { budget: 2, timeoutMs: 600_000, role: 'read' })
        if (a.value) await writeJsonAtomic(keep, a.value).catch(() => {})
      }
      const rec = fileRecord(src, a.value)
      if (!rec) {
        if (run) hub.runLine(run, 'err', `기록은 받은 글 그대로 둔다: ${a.why || 'Claude 의 답이 기록 모양이 아니었다'}`)
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
        await commitPaths(meta.dir, [w.path], `기록 정리: ${rec.title}`, 'kmd-auto')
      })
      cache.delete(id)
      if (run) hub.runLine(run, 'ok', `기록을 정리했다. 「${rec.title}」`)
      return { ok: true, title: rec.title }
    },
    // 화면의 [Claude 로 기록 정리] — 이 PC · 바로 넣을 수 있는 사람만
    async readRecord(ctx, id, recId) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '기록 정리는 개인 프로그램이 내 Claude 로 한다')
      await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '이 지식에 바로 넣을 수 없다')
      const r = await hub.queueRun(id, () => hub.polishRecord(id, String(recId || '')))
      if (!r.ok) throw new KmdError('E_INPUT', `기록을 정리하지 못했다: ${r.why}`)
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
      // 스킬 + 작성 가이드(항목 글의 모양 — 대상 하나 · 지금 동작 · 소제목 ### · 경과는 kmd)
      const guide = await fs.readFile(path.join(AGENT_DIR, 'skills', 'kmd-build', '작성가이드.md'), 'utf8').catch(() => '')
      const skill = [await fs.readFile(path.join(AGENT_DIR, 'skills', 'kmd-build', 'SKILL.md'), 'utf8').catch(() => ''), guide].filter(Boolean).join('\n\n')
      // 코드 바뀜 — 파일이 아니라 커밋 하나의 분석 기록이다. 자리는 그 저장소가 만드는 시스템의 기능 · 설계 문서
      if (w.tags.includes('code-change')) {
        const src = (w.title.match(/(?: —|:) (\S+) [0-9a-f]{7}(?:\.\.[0-9a-f]+)?$/) || [])[1] || '그 저장소'
        return {
          prompt: [
            `지식 「${meta.name}」(knowledge id: ${meta.id}) 에 소스 코드 커밋 하나의 기록을 들인다. kmd-build 순서대로, 다만 넣은 파일이 아니라 코드 바뀜이다.`,
            `- 기록: 「${mdName}」(일 폴더): Claude 가 커밋 차이를 읽고 쓴 분석(무엇이 바뀌었나 · 바뀐 것 · 영향 · 문서에서 맞춰 볼 것) · 끝에 커밋 메시지와 차이(근거)`,
            `- 저장소: ${src} · 기록 id: ${w.id}: save 하면 kmd 가 이 기록을 「넣음」 으로 단다`,
            `- 자리: ${src} 가 만드는 시스템의 기능 · 설계 문서. brief 로 둘러보고 그 시스템을 다루는 문서가 있으면 거기에: 바뀐 기능의 항목이 있으면 section 으로 읽고 base 와 함께 지금 동작으로 고치고, 없으면 그 기능 이름으로 새 항목을 더한다.`,
            `  그런 문서가 없을 때만 「${src} 기능」 처럼 시스템 이름의 새 문서 하나를 세운다. 커밋 · 판 · 날짜로 문서나 항목을 세우지 않는다.`,
            '- 항목 글은 바뀐 이력 나열이 아니라 「지금 어떻게 동작하나」 로 쓴다. 기능 · 화면 · API · 설정 · 데이터. 차이 · 분석에 없는 것은 지어내지 않는다. 코드 줄 · 차이는 항목에 옮기지 않는다.',
            '- from · append 는 쓰지 않는다(kmd 가 거절한다). 기록의 「무엇이 바뀌었나 · 바뀐 것 · 영향 · 맞춰 볼 것 · 근거」 는 항목 글이 아니다. 고칠 항목을 section 으로 읽고 그 글을 지금 동작으로 고친 새 글 전체를 content · base 로 보낸다. 경과 줄은 kmd 가 단다.',
            '- 이 지식의 다른 주제(이 저장소와 상관없는 문서)는 고치지 않는다.',
            '도구의 knowledge 는 늘 위 id 를 쓴다.',
          ].join('\n'),
          system: skill.replace(/^---[\s\S]*?---\s*/, ''),
          files: [{ name: mdName, data: Buffer.from(w.body.replace(/^# .*\n+/, ''), 'utf8') }],
        }
      }
      return {
        prompt: [`지식 「${meta.name}」(knowledge id: ${meta.id}) 에 넣은 파일 하나를 들인다. kmd-build 순서대로.`, `- 바꾼 글: 「${mdName}」(일 폴더)${original ? ` · 원본: 「원본/${name}」` : ''}`, `- 파일 이름: ${file}`, `- 넣은 사람: ${w.author} · ${w.date}`, `- 이 파일의 기록 id: ${w.id}: save 하면 kmd 가 이 기록을 「넣음」 으로 단다(따로 적지 않아도 된다)`, '도구의 knowledge 는 늘 위 id 를 쓴다.'].join('\n'),
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
      const meta = await hub.meta(id)
      cache.delete(id)
      const w = (await hub.get(id)).byWork.get(String(rec || ''))
      if (!w || w.state !== 'pend' || !w.tags.some((t) => t.startsWith('ingest/'))) throw new KmdError('E_NOTFOUND', '들일 넣은 파일 기록이 없다')
      // 이 일감이 고른 기록만(일감의 ids) — 일감 열쇠로 그 지식의 다른 기록에 바로 쓰는 열쇠를 받지 못하게
      const job = jobs.get(dctx.draft.job)
      if (job?.ids && !job.ids.includes(w.id)) throw new KmdError('E_FORBIDDEN', '이 일감의 기록이 아니다')
      const run = hub.newRun(id, { title: hub.ingestFileOf(w).split('/').pop(), file: hub.ingestFileOf(w), by: w.author })
      run.state = 'run'
      // 정리 일 줄의 그 자리 — 에이전트가 도는 동안 「쓰는 중」 · 줄은 지금 하는 일(run)에 쌓이고 도구 줄만 자리에도 잇는다
      const sp = job?.spots?.find((x) => x.key === 'r:' + w.id)
      if (sp) {
        Object.assign(sp, { st: 'run', stage: 2, tries: (sp.tries || 0) + 1, t0: Date.now(), run: run.id, out: 0, think: 0, runMs: 0 })
        sp.lines.push([2, 'tool', '▸ Claude Code 가 세션처럼 들인다 · 자세한 줄은 지금 하는 일'])
        stamp(job)
      }
      if (job) job.beat = new Date().toISOString()
      hub.runLine(run, 'sys', `정리 일꾼이 ${meta.name} 에 들인다. 기록 ${w.id}`)
      const task = await hub.agentTask(meta, w)
      return { run: run.id, token: hub.agentToken(id, w.id, run.id), prompt: task.prompt, system: task.system, files: task.files.map((f) => ({ name: f.name, b64: f.data.toString('base64') })) }
    },
    workerAgentLog(dctx, id, { run: rid, lines }) {
      const run = runs.get(String(rid || ''))
      if (!run || run.kn !== id || dctx.draft.kn !== id) throw new KmdError('E_NOTFOUND', '그 일은 없다')
      const job = jobs.get(dctx.draft.job)
      const sp = job?.spots?.find((x) => x.run === run.id)
      if (job) job.beat = new Date().toISOString()
      for (const l of (Array.isArray(lines) ? lines : []).slice(0, 500)) {
        const k = ['say', 'tool', 'ok', 'err', 'sys', 'cost'].includes(l?.k) ? l.k : 'sys'
        hub.runLine(run, k, String(l?.x ?? ''))
        // 자리에는 도구 · 오류 줄만 짧게(같은 소식을 두 곳에 · 글은 run 에만)
        if (sp && (k === 'tool' || k === 'err') && sp.lines.length < 400) sp.lines.push([2, k, String(l?.x ?? '').slice(0, 160)])
      }
      if (sp) { sp.runMs = Date.now() - (sp.t0 || Date.now()); stamp(job) }
      return { n: run.lines.length }
    },
    async workerAgentDone(dctx, id, { run: rid, ok = false, why = null }) {
      const run = runs.get(String(rid || ''))
      if (!run || run.kn !== id || dctx.draft.kn !== id) throw new KmdError('E_NOTFOUND', '그 일은 없다')
      for (const [t, a] of agentKeys) if (a.run === run.id) agentKeys.delete(t)
      cache.delete(id)
      // 넣었나 — 에이전트의 save 가 이 일에 문서를 남겼다(그 save 가 기록을 「넣음」 으로 달았다)
      const placed = !!ok && run.docs.length > 0
      const sp = jobs.get(dctx.draft.job)?.spots?.find((x) => x.run === run.id)
      if (sp) sp.lines.push(placed ? [4, 'ok', `✓ Claude Code 가 넣었다: ${run.docs.join(' · ').slice(0, 120)}`] : [2, 'err', `✗ Claude Code 가 넣지 못했다: ${String(why || '').slice(0, 100)} · 초안으로 다시 쓴다`])
      if (sp) stamp(jobs.get(dctx.draft.job))
      run.state = placed ? 'done' : 'fail'
      run.msg = placed ? `문서에 넣었다: ${run.docs.join(' · ')}${run.names ? ` · 이름 ${run.names}` : ''}` : `에이전트가 넣지 못했다: ${String(why || '정리 초안으로 다시 한다').slice(0, 200)}`
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
      const run = args.run
      if (args.data && !args.recId) fs.mkdir(path.dirname(binOf(run.id)), { recursive: true }).then(() => fs.writeFile(binOf(run.id), args.data)).catch(() => {})
      const stop = async (e, recId) => { run.state = 'cancel'; run.msg = e.message; hub.ingestEnd(id, run, recId, await hub.meta(id)) }
      // 멈춘 일 · 줄 멈춤은 앞일 자리를 잡기 전에 선다(멈춘 일이 앞일 자리를 쥐지 않게)
      const job = Q.gate(run).then(() => prepSlot(() => hub.ingestPrep(ctx, id, args)), (e) => stop(e, args.recId).then(() => null)).then(async (p) => {
        if (!p) return
        try { await Q.step(run, 3, { lane: 'claude' }) } catch (e) { return stop(e, p.recId) }
        return hub.queueRun(id, () => hub.ingestPlace(ctx, id, p))
      })
      const mine = preps.get(id) || preps.set(id, new Set()).get(id)
      mine.add(job)
      return job.finally(() => mine.delete(job))
    },
    // 앞일 — 들일 것이 남으면 { rel, data, recId, run } · 끝났으면(못 바꿈 · 같은 파일 · 넘어짐) null
    async ingestPrep(ctx, id, { rel, data = null, recId = null, run }) {
      const meta = await hub.meta(id)
      try {
        run.spec ||= { type: 'ingest', kn: id, rel, recId, user: ctx.user }
        if (!recId && data) {
          await Q.step(run, 0)
          const md = await hub.mdOf(rel, data, run)
          if (!md) {
            run.state = 'fail'
            run.msg = '글로 바꾸지 못했다. 원본은 첨부로 두었다'
            await coreSave(meta.dir, { record: { title: `글로 바꾸지 못한 파일: ${rel.split('/').pop()}`, body: `원본은 첨부로 두었다. docs/assets/${rel}\n- 까닭: ${hub.agentOk(id) ? 'Claude Code 가 글로 옮기지 못했다' : 'Claude 를 쓰지 않는다(로그인 · 「Claude 에 보내지 않음」)'}\n- 다시: 지식 만들기 › 파일 넣기에 같은 파일을 다시 넣는다`, tags: ['curate-auto'] } }, { user: 'kmd-auto', system: true })
            hub.ingestEnd(id, run, null, meta)
            return null
          }
          await Q.step(run, 1)
          const plan = await planImport(await hub.get(id), [{ path: rel, data }], { direct: true, asRecord: true, mdOf: async () => md, read: (r2) => fs.readFile(path.join(meta.dir, r2)).catch(() => null) })
          const rec = plan.records[0]
          if (!rec) {
            run.state = 'done'
            run.msg = '같은 파일: 그대로 두었다'
            hub.ingestEnd(id, run, null, meta)
            return null
          }
          await Q.step(run, 2)
          recId = (await hub.save(ctx, id, { record: rec }, { noCurate: true, holdWhy: '가져옴: 넣은 파일(정리가 문서 자리를 고른다)' })).id
          run.spec.recId = recId
          fs.rm(binOf(run.id), { force: true }).catch(() => {})
          queuedRecs.add(recId) // 들이기 차례를 기다리는 동안 정리 줄이 따로 집지 않게
          run.rec = recId
          hub.runLine(run, 'ok', `기록이 됐다: ${recId}`)
        }
        else await Q.step(run, 2)
        await hub.polishRecord(id, recId, run).catch((e) => hub.runLine(run, 'err', `기록 정리: ${e.message}`))
        return { rel, data, recId, run }
      } catch (e) {
        run.state = e?.cancelled ? 'cancel' : 'fail'
        run.msg = e?.cancelled ? `그만뒀다. 「${STAGES[run.stage ?? 0]}」 에서` : e.message
        hub.runLine(run, e?.cancelled ? 'sys' : 'err', run.msg)
        hub.ingestEnd(id, run, recId, meta)
        return null
      }
    },
    // 들이기 — 에이전트(없으면 규칙 · Claude 한 번)
    async ingestPlace(ctx, id, { rel, data, recId, run }) {
      const meta = await hub.meta(id)
      try {
        await Q.step(run, 3)
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
        run.state = e?.cancelled ? 'cancel' : 'fail'
        run.msg = e?.cancelled ? '그만뒀다. 「문서 생성」 에서 · 기록은 남았다(정리 때 다시 넣는다)' : e.message
        hub.runLine(run, e?.cancelled ? 'sys' : 'err', run.msg)
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
      if (w.tags.includes('code-change')) return { why: '코드 바뀜은 기록으로 둔다. 걸린 항목 글은 정리가 맞춘다' }
      const tag = w.tags.find((t) => t.startsWith('ingest/'))
      const file = tag ? tag.slice(7) : `${w.title.split(/ — |: /)[0].replace(/[\\/<>:"|?*\u0000-\u001f]/g, '').trim() || '메모'}.md`
      // 갈래 장부도 같이(material 과 같은 묶음) — 없으면 Claude 가 파일 이름으로 새 문서를 세우고 가드(「회의록-1021」 은 「회의록」 갈래다)에 걸려 늘 규칙 길로 갔다
      const g = { kind: 'ingest', record: { id: w.id, date: w.date, author: w.author, title: w.title, body: w.body, file }, docs: ingestCandidates(k, w), ...formsOf(k) }
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
            return { doc, how: 'claude', msg: `기록 · 문서가 됐다: ${meta.name} › ${doc.split('/').join(' › ')}${d.newDoc ? ' (새 문서)' : ' (기존 문서에 넣음)'} · Claude 로 다듬었다` }
          }
          why = `검사를 넘지 못했다: ${c.why}`
        }
      }
      const rule = ingestRule(k, g, { why })
      if (!rule) return { why: '빈 기록이다' }
      await coreSave(meta.dir, rule.input, { user: 'kmd-auto', system: true })
      cache.delete(id)
      return { doc: rule.doc, how: 'rule', msg: `기록 · 문서가 됐다: ${meta.name} › ${rule.doc.split('/').join(' › ')} (규칙으로 ${rule.note}${why ? ' · ' + why : ''})` }
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
          const r = await ladder(k, await hub.index(id), { q: `${g.record.title} ${g.record.body}`.slice(0, 300), learned: await learnedOf(id), max: 8 })
          g.candidates = [...r.exact, ...r.coords].filter((c) => c.coord).slice(0, 8).map((c) => ({ coord: c.coord, name: c.name }))
          if (g.candidates.length) {
            const a = await hub.askClaude(id, tidyPrompt(g), TOUCH_SCHEMA, { role: 'touch' })
            if (a.value && checkDraft(k, g, a.value).ok && a.value.touches.length) {
              await coreSave(meta.dir, planSave(k, g, a.value, { model: a.model }), { user: 'kmd-auto', system: true })
              cache.delete(id)
              codeNote([g.record.id], 'ok', `항목: 「${g.record.title.split(/ — |: /)[0]}」 → ${a.value.touches.join(' · ')} · 그 항목 글을 맞춘다`, { keep: true })
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
          for (const x of used) codeNote([x.id], c.changed.length ? 'err' : 'ok', `문서: 「${x.title.split(/ — |: /)[0]}」 → ${target} 글을 고쳤다(Claude)${c.changed.length ? ` · 값이 바뀜 ${c.changed[0].from} → ${c.changed[0].to}` : ''}`)
          for (const u of [...new Set(used.map((x) => x.author))])
            await feed.add(dataDir, u, c.changed.length
              ? { kind: 'tidy', rec: saved.id, kn: id, yl: true, b: `kmd 가 문서에 넣으며 값을 바꿨다: ${meta.name} › ${target} · ${c.changed[0].from} → ${c.changed[0].to}`, small: '내 기록에서: 되돌릴 수 있다', go: { kn: id, doc: g.doc.replace(/^docs\/|\.md$/g, ''), hl: g.heading }, revert: saved.id }
              : { kind: 'tidy', rec: saved.id, kn: id, dot: 'acc', text: `kmd 가 문서에 넣었다: ${meta.name} › ${target}`, small: '내가 남긴 기록', go: { kn: id, doc: g.doc.replace(/^docs\/|\.md$/g, ''), hl: g.heading } })
          // 넣지 않고 둔 기록(left)이 있으면 다음 차례에 규칙으로
          return true
        }
        why = `검사를 넘지 못했다: ${c.why}`
      }
      // 규칙 — 기록 글을 항목 끝에 붙인다(머리 줄은 굵은 글로 · 표지는 뺀다). 본문에는 기록 글만 —
      //   어느 기록인지는 문서 끝 참고 줄에 「다듬지 못함」 으로 단다(저장이 단다 · 작성기준 7절).
      //   코드 바뀜 기록(분석 · 커밋 메시지 · 차이)은 붙이지 않는다 — 항목 글이 아니다. 참고 줄로만 잇는다
      const pasted = g.records.filter((r) => !r.code).map((r) => ({ id: r.id, body: r.body.replace(/<!--[\s\S]*?-->/g, '').replace(/^#{1,6}\s+(.+)$/gm, '**$1**').trim() })).filter((x) => x.body)
      const content = [g.content.trim(), ...pasted.map((x) => x.body)].filter(Boolean).join('\n\n')
      await coreSave(meta.dir, { record: { title: `정리: ${g.name}`, body: ['규칙으로: 기록 글을 항목 끝에 붙였다(코드 바뀜 기록은 참고 줄만)', ...g.records.map((r) => `- 넣음 ${r.id}: ${r.title}`), ...(why ? [`- Claude 로 하지 못한 까닭: ${why}`] : [])].join('\n'), touches: [g.coord], tags: ['curate-auto'], reflects: g.records.map((r) => r.id) }, sections: [{ coord: g.coord, content, base: g.base, rough: pasted.map((x) => x.id) }] }, { user: 'kmd-auto', system: true })
      cache.delete(id)
      for (const x of g.records) codeNote([x.id], 'sys', `문서: 「${x.title.split(/ — |: /)[0]}」 → ${target} 에 참고 줄만 달았다(규칙)${why ? ` · ${why}` : ''}`)
      return true
    },
    // 그 지식의 「아직 안 넣은 기록」 모두 — 이름을 고른 기록은 다음 차례에 그 항목으로(세 차례까지)
    async curatePending(id) {
      if (mode !== 'pc' && !hub.ruleOnly(id)) return { n: 0 }
      let n = 0
      let cj = null
      let stop = false
      curating.set(id, new Date().toISOString())
      try {
        for (let round = 0; round < 3 && !stop; round++) {
          cache.delete(id)
          const k = await hub.get(id)
          const groups = material(k)
          let did = 0
          for (const g of groups) {
            if (!cj) { cj = Q.add({ kind: 'curate', origin: 'kmd', kn: id, title: '기록을 문서에 넣기', by: 'kmd', auto: 'curate' }); curateQ.set(id, cj.id) }
            try { await Q.step(cj, 3) } catch { stop = true; break }
            const what = g.kind === 'section' ? `${String(g.doc).replace(/^docs\/|\.md$/g, '')} › ${g.heading}` : g.record?.title || g.kind
            const ok = await hub.placeGroup(id, g).catch((e) => (log(`바로 넣기 ${id}: ${e.message}`), Q.line(cj, 'err', `${what}: ${e.message}`), false))
            if (ok) { did++; Q.line(cj, 'ok', `넣었다: ${what}`) }
          }
          n += did
          if (!did) break
        }
      } finally {
        curating.delete(id)
        curateQ.delete(id)
        // 넣은 것이 없으면(다른 일이 맡은 기록뿐) 줄에 남기지 않는다
        if (cj && !n && !stop) Q.drop(cj)
        else if (cj) Q.end(cj, stop ? 'cancel' : 'done', stop ? '그만뒀다. 남은 기록은 다음 정리 때 넣는다' : `넣은 기록 ${n}`)
      }
      if (n) {
        const meta = await hub.meta(id)
        if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      }
      return { n }
    },
    // 저장 뒤 — 이 PC 만 · 지식마다 한 줄로 뒤에서(저장은 기다리지 않는다) · 시험은 curateIdle 로 기다린다
    curateSoon(id) {
      if (mode !== 'pc') return Promise.resolve()
      const run = (curateRuns.get(id) || Promise.resolve()).catch(() => {}).then(() => hub.curatePending(id))
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
    // system — 문서 폴더 가져오기(작성자 kmd · 저장의 시스템 쓰기)
    async importFiles(ctx, id, files, { asDocs = false, group = null, system = false, offset = 0 } = {}) {
      // 자리부터 — 묶음(일 줄)을 세우기 전에
      const meta = await hub.meta(id, ctx)
      hub.need(ctx, id, 'write')
      const gj = group ? hub.groupJob(ctx, id, group) : null
      if (gj && isFinal(gj)) return { stopped: true, group: gj.id, summary: summary([]), rows: [] }
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
          let title = `파일 넣기: ${ctx.user} · ${docs.length + plan.atts.length}`
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
              if (!(await put(`work/${rid}.md`, renderRecord({ id: rid, title: `${file.split('/').pop()}: 들여온 문서 · ${meta.name}`, date, author: ctx.user, tags: [] }, d.text)))) continue
              ids.push(rid)
              stamped.push({ rel: d.rel, data: Buffer.from(stampAll(d.text, rid), 'utf8') })
            }
            title = `들여옴: 옛 폴더 · 문서 ${ids.length}${plan.atts.length ? ' · 첨부 ' + plan.atts.length : ''}`
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
          sv = await hub.save(ctx, id, { record: r }, { noCurate: now, system, holdWhy: '가져옴: 넣은 파일(정리가 문서 자리를 고른다)' })
        } catch (e) {
          if (recRows[i]) Object.assign(recRows[i], { kind: 'fail', msg: `넣지 못했다: ${e.message}` })
          continue
        }
        if (!recRows[i]) continue
        recRows[i].rec = sv.id
        if (agent && i + offset < INGEST_CLAUDE_MAX) {
          const rel = r.tags[0].slice(7)
          const run = hub.newRun(id, { title: recRows[i].name.split('/').pop(), file: recRows[i].name, by: ctx.user, quiet: files.length > 1, parent: gj?.id })
          if (gj?.paused) Q.pause(run.id)
          run.stages[0].state = run.stages[1].state = 'done' // 받기 · 겹침 확인은 이 부름에서 끝났다
          run.spec = { type: 'ingest', kn: id, rel, recId: sv.id, user: ctx.user }
          queuedRecs.add(sv.id)
          hub.ingestFileLater(ctx, id, { rel, recId: sv.id, run })
          Object.assign(recRows[i], { kind: 'run', run: run.id, msg: 'Claude Code 가 들이는 중: 터미널에서 본다' })
          continue
        }
        if (now) {
          if (i + offset < INGEST_CLAUDE_MAX) await hub.polishRecord(id, sv.id).catch(() => null)
          const got = await hub.ingestNow(id, sv.id, { claude: i + offset < INGEST_CLAUDE_MAX }).catch((e) => ({ why: e.message }))
          if (got.doc) Object.assign(recRows[i], { kind: 'doc', doc: got.doc, msg: got.msg })
          else recRows[i].msg = `기록이 됐다. 문서로 들이지 못했다 · ${got.why || ''}`
        }
      }
      } finally {
        importing.delete(id)
      }
      // pdf · hwp · 그림만 든 docx · pptx 등 — 바꾼 글이 없으면 Claude Code 가 원본을 읽어 글로 바꾼 뒤 같은 길로(원본은 위에서 첨부로 두었다)
      if (agent && hub.autoOf(ctx.user, 'file')) for (const x of plan.rows.filter((r) => r.kind === 'fail' && r.scan)) {
        const fd = files.find((y) => String(y.path || y.name).replace(/\\/g, '/').endsWith(x.name.split('/').pop()))
        if (!fd) continue
        const run = hub.newRun(id, { title: x.name.split('/').pop(), file: x.name, by: ctx.user, parent: gj?.id })
        hub.ingestFileLater(ctx, id, { rel: x.name, data: fd.data, run })
        Object.assign(x, { kind: 'run', run: run.id, msg: 'Claude Code 가 글로 바꿔 들이는 중: 터미널에서 본다 · 원본은 첨부로' })
      }
      const s = summary(plan.rows)
      // 이력 — 넣기 한 번이 한 줄(파일마다 줄을 쌓지 않는다) · 못 넣은 파일과 까닭도
      if (s.doc || s.record || s.run || s.fail || s.skip) feed.add(dataDir, ctx.user, { kind: 'import', kn: id, dot: s.fail ? 'warn' : 'acc', text: `파일 ${plan.rows.length}개를 넣었다: ${meta.name}`, small: [s.doc ? `문서 ${s.doc}` : '', s.record ? `기록 ${s.record}` : '', s.run ? `Claude Code 일 ${s.run}` : '', s.att ? `첨부 ${s.att}` : '', s.fail ? `못 넣음 ${s.fail}: ${plan.rows.filter((x) => x.kind === 'fail').slice(0, 3).map((x) => `${x.name}: ${x.msg}`).join(' · ')}` : '', s.skip ? `읽지 못하는 종류 ${s.skip}` : ''].filter(Boolean).join(' · ') }).catch(() => {})
      // 넣은 파일의 기록 — 팀은 정리를 바로 건다(Claude 에 보내지 않는 지식이면 기록으로 기다린다) · 이 PC 는 위에서 이미 문서까지
      if (!now && s.record && (hub.meaningOk(id) || hub.ruleOnly(id)) && hub.tidyModeOf(id) !== 'manual') hub.tidyNow({ user: 'kmd', admin: true }, id, { by: 'kmd', auto: true }).catch((e) => log('저장 뒤 정리', id, e.message))
      if ((plan.docs.length || plan.atts.length) && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      if (gj) hub.groupAdd(gj, plan.rows, files.length, !!group.last)
      return { direct, summary: s, rows: plan.rows, ...(gj ? { group: gj.id } : {}) }
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
          if (!(await hub.list()).some((k) => k.id === d.kn)) throw new KmdError('E_INPUT', `「${d.kn}」 지식이 없다. 다른 kmd(팀)의 지식이면 그 팀 › 지식으로 고른다`)
          continue
        }
        const t = await hub.teamKns(d.url).catch(() => null)
        if (t?.error === 401) throw new KmdError('E_INPUT', '이 PC 의 열쇠를 그 팀이 받지 않는다. 팀 화면 › 설치 한 줄로 다시 잇는다')
        if (t?.kns && !t.kns.some((k) => k.id === d.kn)) throw new KmdError('E_INPUT', `그 팀에 「${d.kn}」 지식이 없다. 팀 › 지식 목록에서 고른다`)
      }
      const conf = await sendLib.readConf(meta.dir)
      await serial(path.resolve(meta.dir), async () => {
        await ensureRepo(meta.dir)
        await writeJsonAtomic(path.join(meta.dir, sendLib.CONF), { ...conf, send: dests.map((d) => ({ kn: d.kn, ...(d.url ? { url: String(d.url).replace(/\/+$/, '') } : {}) })) }, { indent: 2, nl: true })
        await commitPaths(meta.dir, [sendLib.CONF], `보낼 곳: ${dests.map((d) => d.kn).join(' · ') || '없음'}`, ctx.user).catch(() => {})
      })
      // 처음 정하면 지금 글 · 기록을 보낸 것으로 — 그 뒤 고친 문서 · 새 기록만 변경사항에 모인다
      // 대기 — 뺀 보낼 곳의 것은 걷고 · 주소를 바꾼 곳은 새 주소로
      const nd = dests.map((d) => ({ kn: d.kn, ...(d.url ? { url: String(d.url).replace(/\/+$/, '') } : {}) }))
      const base = sendLib.baseline(await hub.get(id))
      await sendState(id, (st) => {
        st.wait = st.wait.filter((w) => nd.some((d) => d.kn === w.to.kn)).map((w) => ({ ...w, to: nd.find((d) => d.kn === w.to.kn) }))
        if (!Object.keys(st.sent).length) st.sent = base
        st.recSince ||= localStamp()
      })
      return sendLib.destsOf(meta.dir)
    },
    async teamKns(url) {
      const key = process.env.KMD_SEND_KEY || (await keystore.get(keystore.keyName(url)).catch(() => null))
      if (!key) return { error: 'nokey' } // 이 PC 에 그 팀의 열쇠가 없다 — 고를 때는 「잇지 않았다」 · 정할 때는 막지 않는다(보낼 때 다시 본다)
      const r = await fetch(`${url}/api/knowledge`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) })
      if (!r.ok) return { error: r.status }
      // 받을 곳은 쓰기 자리 이상인 지식만(자리를 싣지 않는 옛 팀 서버는 모두)
      return { kns: (await r.json()).filter((k) => !k.level || k.level === 'write' || k.level === 'admin').map((k) => ({ id: k.id, name: k.name })) }
    },
    // 보낼 곳 고르기 — 이 PC 가 이은 팀마다 그 팀의 지식(팀 지식 · 내 개인 지식)
    async sendTargets(ctx) {
      const teams = await fs.readFile(path.join(dataDir, 'teams.json'), 'utf8').then(JSON.parse, () => [])
      const out = []
      for (const u of teams) {
        const url = String(u).replace(/\/+$/, '')
        const t = await hub.teamKns(url).catch(() => ({ error: 'reach' }))
        out.push({ url, ...(t.kns ? { kns: t.kns } : { error: t.error === 401 ? '이 PC 의 열쇠를 그 팀이 받지 않는다. 다시 잇는다' : t.error === 'nokey' ? '이 PC 가 그 팀에 이어지지 않았다. 팀 화면 › 설치 한 줄' : '그 팀에 닿지 않는다' }) })
      }
      return { teams: out, local: mode === 'team' ? [] : (await hub.list()).map((k) => ({ id: k.id, name: k.name })) }
    },
    async sendQueue(ctx, id) {
      const meta = await hub.meta(id, ctx)
      const dests = await sendLib.destsOf(meta.dir)
      const st = await sendLib.readState(dataDir, id)
      const k = await hub.get(id)
      // 예전에 정한 보낼 곳 — 기록의 기준 시각이 없으면 지금부터(옛 기록이 한꺼번에 모이지 않게)
      if (dests.length && !st.recSince) st.recSince = await sendState(id, (s) => (s.recSince ||= localStamp()))
      // ① 변경사항(문서 · 기록) ② 지식(문서 · 기록 목록 — 골라서 전체로)
      const items = dests.length ? [...sendLib.queue(k, st), ...sendLib.recQueue(k, st)].sort((a, b) => String(b.when).localeCompare(String(a.when))) : []
      const docs = dests.length ? k.docs.map((d) => ({ path: d.path, id: d.id, title: d.title, when: d.mtime })) : []
      const recs = dests.length ? k.works.filter((w) => !w.tags.some((t) => t.startsWith('sent/'))).map((w) => ({ id: w.id, title: w.title, author: w.author, when: w.date })) : []
      return { dests, items, docs, recs, wait: st.wait.map((w) => ({ id: w.id, state: w.state, to: w.to.kn, url: w.to.url || null, n: w.payload.items.length, at: w.at, why: w.why, fix: w.fix || null })), log: st.log }
    },
    async sendDrop(ctx, id, { path: p, on }) {
      await hub.meta(id, ctx)
      const k = await hub.get(id)
      return sendState(id, (st) => {
        const q = sendLib.queue(k, st).find((x) => x.path === p)
        if (!q) throw new KmdError('E_NOTFOUND', '보낼 것에 없다')
        if (on) delete st.dropped[p]
        else st.dropped[p] = q.sha
        return { ok: true }
      })
    },
    // ── 지식 보내기 — 보내는 길: 내 개인 지식 하나 → 팀 지식 하나 ──
    //   개인 지식은 개인 프로그램에 있다. 개인 프로그램이 이 PC 의 기기 열쇠로 팀 서버에 보낸다(팀 화면은 짝 열쇠로 부른다)
    //   길은 개인 지식마다 하나(.kmd.json send: 팀 주소 · 지식 · 이름) · 바꾸려면 새 이름을 그대로 친다
    //   보낼 것은 기록(보내지 않은 것) · 문서(통째로) 둘뿐이다
    async routeMeta(ctx, id) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '지식 보내기는 개인 화면의 개인 지식에서 한다')
      return hub.meta(id, ctx)
    },
    async routeOf(meta) {
      const d = (await sendLib.destsOf(meta.dir)).find((x) => !!x.url)
      return d ? { kn: d.kn, name: d.name || d.kn, url: d.url } : null
    },
    // 이 PC 가 이은 팀 주소(kmd connect 가 teams.json 에 적었다). 짝 지은 팀 화면이 부르면 그 화면의 주소
    async teamUrlFor(ctx, url) {
      const teams = (await fs.readFile(path.join(dataDir, 'teams.json'), 'utf8').then(JSON.parse, () => [])).map((u) => String(u).replace(/\/+$/, ''))
      const want = String(url || ctx.origin || '').replace(/\/+$/, '')
      const originOf = (u) => { try { return new URL(u).origin } catch { return u } }
      if (want) {
        const hit = teams.find((u) => u === want || originOf(u) === want)
        if (!hit) throw new KmdError('E_INPUT', '이 PC 가 이은 팀이 아니다. 팀 화면의 설치 한 줄로 잇는다')
        return hit
      }
      if (teams.length !== 1) throw new KmdError('E_INPUT', teams.length ? '팀이 여럿이다. 팀 화면에서 정한다' : '이 PC 가 이은 팀이 없다. 팀 화면의 설치 한 줄로 잇는다')
      return teams[0]
    },
    async sendView(ctx, id) {
      const meta = await hub.routeMeta(ctx, id)
      const route = await hub.routeOf(meta)
      const st = await sendLib.readState(dataDir, id)
      const k = await hub.get(id)
      if (route) Object.assign(route, { since: st.route?.kn === route.kn ? st.route.since : null, times: st.log.filter((l) => l.to.includes(route.kn)).length })
      // 받아 온 것(sent/ 표지)은 다시 보내지 않는다 · 보낸 것은 언제 보냈는지(예전 표시는 true)
      const recs = k.works
        .filter((w) => !isSystemRecord(w) && !w.tags.some((t) => t.startsWith('sent/')))
        .map((w) => ({ id: w.id, title: w.title, author: w.author, when: w.date, sent: st.sentRecs[w.id] || null }))
        .sort((a, b) => String(b.when).localeCompare(String(a.when)))
      const docs = k.docs.map((d) => {
        const m = sendLib.marks(d)
        const prev = st.sent[d.path]
        const heads = prev ? Object.keys(m.secs).filter((h) => prev.secs[h] !== m.secs[h]) : []
        return { path: d.path, id: d.id, title: d.title, when: d.mtime, st: !prev ? 'new' : prev.sha === m.sha ? 'same' : 'chg', heads, sent: prev ? prev.at || true : null }
      })
      return { route, recs, docs, wait: st.wait.map((w) => ({ id: w.id, state: w.state, to: w.to.kn, n: w.payload.items.length, at: w.at, why: w.why, fix: w.fix || null })), log: st.log }
    },
    // 길 정하기 · 바꾸기 — 받는 지식은 같은 서버의 팀 지식 · 이미 길이 있으면 confirm 에 새 이름을 그대로
    async sendRoute(ctx, id, { to, confirm, url } = {}) {
      const meta = await hub.routeMeta(ctx, id)
      to = String(to || '')
      // 받는 지식은 이은 팀 서버의 팀 지식(이 PC 의 기기 열쇠로 그 팀의 목록을 본다)
      const u = await hub.teamUrlFor(ctx, url)
      const t = await hub.teamKns(u).catch(() => ({ error: 'reach' }))
      if (t.error) throw new KmdError('E_INPUT', t.error === 401 ? '이 PC 의 열쇠를 그 팀이 받지 않는다. 팀 화면의 설치 한 줄로 다시 잇는다' : t.error === 'nokey' ? '이 PC 가 그 팀에 이어지지 않았다. 팀 화면의 설치 한 줄로 잇는다' : '그 팀 서버에 닿지 않는다')
      const hit = t.kns.find((k) => k.id === to)
      if (!hit) throw new KmdError('E_INPUT', '받는 지식은 그 팀 서버의 팀 지식 하나다')
      const tm = { name: hit.name }
      const dest = { kn: to, url: u, name: hit.name }
      const cur = await hub.routeOf(meta)
      if (cur?.kn === to && (cur.url || '') === (dest.url || '')) return hub.sendView(ctx, id)
      if (cur && String(confirm || '').trim() !== tm.name) throw new KmdError('E_INPUT', `받는 지식을 바꾸려면 새 이름 「${tm.name}」 을 그대로 친다`)
      const conf = await sendLib.readConf(meta.dir)
      await serial(path.resolve(meta.dir), async () => {
        await ensureRepo(meta.dir)
        await writeJsonAtomic(path.join(meta.dir, sendLib.CONF), { ...conf, send: [dest] }, { indent: 2, nl: true })
        await commitPaths(meta.dir, [sendLib.CONF], `받는 지식: ${cur ? cur.kn + ' → ' : ''}${to}`, ctx.user).catch(() => {})
      })
      // 옛 받는 지식으로 가려던 대기는 걷는다(새 곳으로 옮겨 가지 않게)
      await sendState(id, (st) => {
        st.wait = st.wait.filter((w) => w.to.kn === to && (w.to.url || '') === (dest.url || ''))
        st.route = { kn: to, since: localStamp() }
      })
      feed.add(dataDir, ctx.user, { kind: 'send', kn: id, dot: 'acc', text: cur ? `받는 지식을 바꿨다: ${cur.name} → ${tm.name}` : `받는 지식을 정했다: ${tm.name}`, small: `${meta.name} 에서 보내는 것은 모두 ${tm.name} 로만 간다` }).catch(() => {})
      return hub.sendView(ctx, id)
    },
    // 보내기 — to(화면이 본 받는 지식 · 그새 바뀌었으면 보내지 않는다) · docs([{ path }] 문서는 통째로) · recs(기록 id)
    async sendPicked(ctx, id, { to, docs = [], recs = [] } = {}) {
      const meta = await hub.routeMeta(ctx, id)
      const route = await hub.routeOf(meta)
      if (!route) throw new KmdError('E_INPUT', '받는 지식을 먼저 정한다')
      if (route.gone) throw new KmdError('E_INPUT', `받는 지식 「${route.kn}」 이 이제 없다. 받는 지식을 다시 정한다`)
      if (String(to || '') !== route.kn) throw new KmdError('E_CONFLICT', `받는 지식이 「${route.name}」 로 바뀌었다. 화면을 다시 보고 보낸다`)
      const k = await hub.get(id)
      const st = await sendLib.readState(dataDir, id)
      const pickDocs = (Array.isArray(docs) ? docs : []).map((x) => ({ d: k.byDocPath.get(String(x?.path || '')) })).filter((x) => x.d)
      const recIds = [...new Set((Array.isArray(recs) ? recs : []).map(String))].filter((x) => { const w = k.byWork.get(x); return w && !isSystemRecord(w) && !w.tags.some((t) => t.startsWith('sent/')) })
      const items = [
        ...pickDocs.map(({ d }) => sendLib.docItem(k, d)),
        ...recIds.map((x) => sendLib.recItem(k, k.byWork.get(x))),
      ].flatMap((it) => sendLib.split(it))
      if (!items.length) throw new KmdError('E_INPUT', '보낼 것을 고른다')
      const dest = { kn: route.kn, ...(route.url ? { url: route.url } : {}) }
      const { sent, wait, fail, why, waits, unnamed } = await deliverAll(ctx, meta, [dest], items)
      const at = localStamp()
      await sendState(id, (st) => {
        st.wait.push(...waits)
        if (sent || wait) {
          for (const { d } of pickDocs) {
            st.sent[d.path] = { ...sendLib.marks(d), at }
            delete st.dropped[d.path]
          }
          for (const x of recIds) st.sentRecs[x] = at
        }
        st.log.unshift({ at: new Date().toISOString(), n: items.length, to: [route.kn], recs: recIds.length, docs: pickDocs.length, wait: !!wait, ...(fail ? { fail } : {}), ...(unnamed ? { unnamed } : {}), titles: items.slice(0, 5).map((x) => x.title) })
      })
      if (sent) feed.add(dataDir, ctx.user, { kind: 'send', kn: id, to: route.name, dot: 'acc', text: `${sent}개를 보냈다: ${meta.name} → ${route.name}`, small: '정리 때 문서에 들어간다' }).catch(() => {})
      return { sent, wait, to: route.kn, ...(unnamed ? { unnamed } : {}), ...(fail ? { fail, why } : {}) }
    },
    // 보내기 — changes(변경사항의 key) · docs(문서 경로 — 전체) · recs(기록 id — 전체) · 셋 다 없으면 변경사항 모두(예전 길)
    async send(ctx, id, { extra = [], changes = null, docs = [], recs = [] } = {}) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '내 지식에서만 보낸다')
      const dests = await sendLib.destsOf(meta.dir)
      if (!dests.length) throw new KmdError('E_INPUT', '보낼 곳이 없다. 지식 설정에서 정한다')
      const k = await hub.get(id)
      const st = await sendLib.readState(dataDir, id)
      const pick = Array.isArray(changes) ? new Set(changes.map(String)) : null
      // 지식에서 문서 전체를 고르면 그 문서의 변경사항(바뀐 항목만) 대신 전체로 간다
      const wholeDocs = [...new Set((Array.isArray(docs) ? docs : []).map(String))].map((p) => k.byDocPath.get(p)).filter(Boolean)
      const qs = sendLib.queue(k, st).filter((q) => (pick ? pick.has(q.key) : q.on) && !wholeDocs.some((d) => d.path === q.path))
      const rq = sendLib.recQueue(k, st).filter((q) => (pick ? pick.has(q.key) : true))
      const recIds = [...new Set([...rq.map((q) => q.id), ...(Array.isArray(recs) ? recs : []).map(String)])].filter((x) => k.works.some((w) => w.id === x))
      // 받는 쪽 기록 한도를 넘는 글은 나눠서(큰 문서 하나가 묶음 전체를 막지 않게)
      const items = [
        ...qs.map((q) => sendLib.itemOf(k, q)),
        ...wholeDocs.map((d) => sendLib.docItem(k, d)),
        ...recIds.map((x) => sendLib.recItem(k, k.byWork.get(x))),
        ...(Array.isArray(extra) ? extra : []).map((x) => ({ title: String(x.title || '').slice(0, 200), body: String(x.body || ''), sha: sha16(`${id}\n${x.title}\n${x.body}`) })),
      ].flatMap((it) => sendLib.split(it))
      if (!items.length) return { sent: 0, wait: 0 }
      const { sent, wait, fail, why, waits, unnamed } = await deliverAll(ctx, meta, dests, items)
      // 보낸 문서는 지금 글이 「보낸 것」 · 보낸 기록은 다시 모이지 않는다 — 모든 보낼 곳이 거절했으면 그대로 둔다(다시 고를 수 있게)
      await sendState(id, (st) => {
        st.wait.push(...waits)
        if (sent || wait) {
          for (const p of [...qs.map((q) => q.path), ...wholeDocs.map((d) => d.path)]) {
            st.sent[p] = sendLib.marks(k.byDocPath.get(p))
            delete st.dropped[p]
          }
          for (const x of recIds) st.sentRecs[x] = true
        }
        st.log.unshift({ at: new Date().toISOString(), n: items.length, to: dests.map((d) => d.kn), wait: !!wait, ...(fail ? { fail } : {}), ...(unnamed ? { unnamed } : {}), titles: items.slice(0, 5).map((x) => x.title) })
      })
      if (sent) feed.add(dataDir, ctx.user, { kind: 'send', kn: id, dot: 'acc', text: `${sent}개를 보냈다: ${dests.map((d) => d.kn).join(' · ')}`, small: '정리 때 문서에 들어간다' }).catch(() => {})
      return { sent, wait, ...(unnamed ? { unnamed } : {}), ...(fail ? { fail, why } : {}) }
    },
    // 닿지 않아 둔 것 — 닿을 때 저절로(분마다) · 거절된 것(fail)은 사람이 [다시] · [버리기]
    //   겹쳐 돌지 않는다(앞 차례가 시간 넘김을 기다리는 동안 다음 분이 와도 같은 일을 함께 기다린다)
    //   보내는 동안 다른 곳(보내기 · [다시] · [버리기])이 상태를 고쳐도 — 끝나면 다시 읽어 보낸 줄만 걷고 바뀐 줄만 바꾼다
    sendRetry() {
      retrying ||= (async () => {
        let n = 0
        for (const m of await hub.list().catch(() => [])) {
          const snap = await sendLib.readState(dataDir, m.id)
          const todo = snap.wait.filter((w) => w.state === 'wait')
          if (!todo.length) continue
          const done = new Map() // 대기 줄 id → 다음 줄(null 이면 다 보냄)
          const logs = []
          for (const w of todo) {
            try {
              const b = badOf(w.to, w.payload, await deliver({ user: pcUser || 'kmd', pc: mode === 'pc' }, w.to, w.payload))
              const k = w.payload.items.length - (b ? b.payload.items.length : 0)
              n += k
              logs.push({ at: new Date().toISOString(), n: k, to: [w.to.kn], late: w.at })
              done.set(w.id, b && { ...b, id: w.id, at: w.at })
            } catch (e) {
              done.set(w.id, { ...waitOf(w.to, w.payload, e), id: w.id, at: w.at })
            }
          }
          await sendState(m.id, (st) => {
            st.wait = st.wait.flatMap((w) => (done.has(w.id) ? (done.get(w.id) ? [done.get(w.id)] : []) : [w]))
            st.log.unshift(...logs.reverse())
          })
        }
        return n
      })().finally(() => { retrying = null })
      return retrying
    },
    // 대기 줄 하나 — [지금 다시](닿으면 보낸 것으로) · [버리기]
    async sendWaitAct(ctx, id, { wid, act }) {
      await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '내 지식에서만 보낸다')
      wid = String(wid)
      const gone = () => new KmdError('E_NOTFOUND', '그 줄은 이제 없다')
      if (act === 'drop') {
        return sendState(id, (st) => {
          const w = st.wait.find((x) => x.id === wid)
          if (!w) throw gone()
          st.wait = st.wait.filter((x) => x !== w)
          return { dropped: w.payload.items.length }
        })
      }
      if (act !== 'retry') throw new KmdError('E_INPUT', '다시 · 버리기 중 하나')
      const w = (await sendLib.readState(dataDir, id)).wait.find((x) => x.id === wid)
      if (!w) throw gone()
      // 보내기는 줄 밖에서 — 끝나면 그 줄만 걷거나(그새 버렸으면 그대로) 새 까닭으로 바꾼다
      let next = null
      let sentN = 0
      try {
        next = badOf(w.to, w.payload, await deliver(ctx, w.to, w.payload))
        sentN = w.payload.items.length - (next ? next.payload.items.length : 0)
      } catch (e) {
        next = waitOf(w.to, w.payload, e)
      }
      await sendState(id, (st) => {
        st.wait = st.wait.flatMap((x) => (x.id !== wid ? [x] : next ? [{ ...next, id: wid, at: w.at }] : []))
        if (sentN) st.log.unshift({ at: new Date().toISOString(), n: sentN, to: [w.to.kn], late: w.at })
      })
      if (next) throw new KmdError('E_INPUT', `보내지 못했다: ${next.why}${next.fix ? ' · ' + next.fix : ''}${sentN ? ` · ${sentN}개는 보냈다` : ''}`)
      return { sent: sentN }
    },
    // 받기 — 기록 하나씩(같은 지문이면 0) · 이름은 이 지식의 장부에 정확히 맞는 것만
    //   같은 지식의 받기는 한 줄로 — 시간 넘김 뒤 같은 묶음이 겹쳐 와도 지문 검사와 저장 사이에 끼어들지 않는다
    //   묶음 하나 = 지식 읽기 1번 · git 커밋 1번(글마다 커밋하면 150개에 2분이 넘는다)
    //   글 하나가 거절되면(너무 긴 글 등) 그것만 bad 로 두고 나머지는 받는다 · 지식 전체의 거절(멈춤 · 권한)은 그대로 던진다
    async receive(ctx, id, { from = '', items = [] } = {}) {
      const meta = await hub.meta(id, ctx)
      if (!Array.isArray(items) || !items.length || items.length > 200) throw new KmdError('E_INPUT', '받을 것은 1 ~ 200 개')
      if (ctx.machine && ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      if (!ctx.machine) hub.need(ctx, id, 'write')
      return serial(`receive:${path.resolve(meta.dir)}`, async () => {
        const shut = backup.closed(meta)
        if (shut) throw new KmdError('E_BEHIND', shut.message)
        const k = await hub.get(id)
        const seen = new Set(k.works.flatMap((w) => w.tags.filter((t) => t.startsWith('sent/'))))
        const now = localStamp()
        let same = 0
        const bad = []
        const recs = []
        const at = [] // recs[j] 는 items[at[j]]
        for (const [i, it] of items.entries()) {
          if (!it || typeof it !== 'object') { bad.push({ i, why: '글이 아니다' }); continue }
          const sha = /^[0-9a-f]{16}$/.test(String(it.sha)) ? it.sha : sha16(`${it.title}\n${it.body}`)
          const tag = `sent/${sha}`
          if (seen.has(tag)) {
            same++
            continue
          }
          seen.add(tag) // 같은 묶음 안의 같은 지문도 하나만
          const touches = recvTouches(k, it)
          // 쓴 때(보낸 쪽 기록의 date) — 기록의 날짜로 둔다(정리는 쓴 때 차례로 · 더 늦게 쓴 기록이 이미 든 항목에서는 옛 기록) ·
          //   받은 때는 recv/ 태그로(그 뒤에 정리된 항목이 아니면 아직 안 넣은 것 — recordState) · 앞날 · 모양이 틀린 날짜는 받은 때로
          const wrote = typeof it.date === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(it.date) && it.date < now ? it.date : null
          recs.push({ title: String(it.title || '보낸 것').slice(0, 200), body: `${String(from).slice(0, 80)}에서 보냄\n\n${String(it.body || '')}`.trim(), touches, tags: [tag, ...(wrote ? [`recv/${now.replace(/\D/g, '')}`] : [])], ...(wrote ? { date: wrote } : {}) })
          at.push(i)
        }
        let saved = 0
        let unnamed = 0
        if (recs.length) {
          const r = await saveRecords(meta.dir, recs, { user: ctx.user, holdWhy: `받음: ${String(from).slice(0, 60) || '보낸 곳'}에서 · 이 지식의 이름 장부에서 맞는 이름을 찾지 못했다` })
          for (const x of r.records) {
            if (x.error) bad.push({ i: at[x.i], why: `${recs[x.i].title.slice(0, 60)}: ${x.error.message}` })
            else {
              saved++
              if (x.unnamed) unnamed++
            }
          }
          cache.delete(id)
          if (saved) {
            feed.add(dataDir, ctx.user, { kind: 'save', rec: r.records.find((x) => x.id)?.id, kn: id, from: String(from).slice(0, 80), dot: 'pend', text: `${meta.name}에 기록 ${saved}개: ${String(from).slice(0, 80)}에서 받음`, small: hub.pendText(id) }).catch(() => {})
            scheduleDecide(id)
            // hub.save 와 같이 — 개인 지식은 바로 문서에(뒤에서) · 팀 지식은 정리 방식이 「실시간」 이면 조용해진 뒤
            if (mode === 'pc') hub.curateSoon(id).catch(() => {})
            else if (mode === 'team' && hub.tidyModeOf(id) === 'live') hub.liveSoon(id)
            if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
          }
        }
        bad.sort((a, b) => a.i - b.i)
        return { saved, same, ...(unnamed ? { unnamed } : {}), ...(bad.length ? { bad } : {}) }
      })
    },
    // 받기 미리 보기 — 쓰지 않고 받을 글마다 이 지식의 이름 장부에서 맞는 이름을 본다(보내는 쪽의 「보내기 확인」 · 지식 생성 가드)
    async receivePreview(ctx, id, { items = [] } = {}) {
      await hub.meta(id, ctx)
      if (!Array.isArray(items) || !items.length || items.length > 200) throw new KmdError('E_INPUT', '볼 것은 1 ~ 200 개')
      if (ctx.machine && ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      if (!ctx.machine) hub.need(ctx, id, 'write')
      const k = await hub.get(id)
      const seen = new Set(k.works.flatMap((w) => w.tags.filter((t) => t.startsWith('sent/'))))
      return {
        items: items.map((it, i) => {
          if (!it || typeof it !== 'object') return { i, bad: true }
          const sha = /^[0-9a-f]{16}$/.test(String(it.sha)) ? it.sha : sha16(`${it.title}\n${it.body}`)
          if (seen.has(`sent/${sha}`)) return { i, same: true }
          return { i, names: recvTouches(k, it).map((c) => ({ coord: c, name: labelOf(k, c) })) }
        }),
      }
    },
    // 보내기 미리 보기 — 고른 것을 받는 지식의 장부로 맞춰 본다(쓰지 않는다) · 받는 팀 서버가 옛 판이면 unavailable
    async sendPreview(ctx, id, { to, docs = [], recs = [] } = {}) {
      const meta = await hub.routeMeta(ctx, id)
      const route = await hub.routeOf(meta)
      if (!route || route.gone || String(to || '') !== route.kn) return { unavailable: '받는 지식을 다시 정한다' }
      const items = pickedItems(await hub.get(id), docs, recs)
      if (!items.length) return { n: 0, named: 0, unnamed: [], same: 0 }
      let r
      try {
        if (!route.url) r = await hub.receivePreview(ctx, route.kn, { items })
        else {
          const key = process.env.KMD_SEND_KEY || (await keystore.get(keystore.keyName(route.url)).catch(() => null))
          r = await sendLib.post(route.url, route.kn, { items }, key, { path: 'receive/preview', timeoutMs: 15_000 })
        }
      } catch (e) {
        return { unavailable: e.status === 404 ? '받는 팀 서버가 미리 보기를 모른다(옛 판)' : String(e.message || '미리 보지 못했다').slice(0, 120) }
      }
      const got = Array.isArray(r?.items) ? r.items : []
      const unnamed = got.filter((x) => !x.same && !x.bad && !(x.names || []).length).map((x) => items[x.i]?.title || '')
      return { n: items.length, named: got.filter((x) => (x.names || []).length).length, unnamed, same: got.filter((x) => x.same).length }
    },
    // 받은편지함 정리 — 이 PC 의 다른 지식으로만 옮긴다 · 팀 지식에 이름이 걸리면 보내기 후보 · private 표지 기록은 그대로
    async inboxTidy(ctx, id, { dry = false } = {}) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '받은편지함은 주인이 정리한다')
      const k = await hub.get(id)
      const f = path.join(dataDir, 'inbox', `${encodeURIComponent(id)}.json`)
      const st = await fs.readFile(f, 'utf8').then(JSON.parse, () => ({ moved: {} }))
      const others = (await hub.visible(ctx)).filter((m) => m.id !== id)
      const mine = mode === 'pc' ? others : []
      const team = others.filter((m) => !mine.includes(m))
      const moved = []
      const candidates = []
      for (const w of k.works) {
        if (isSystemRecord(w) || w.tags.includes('private') || st.moved[w.id]) continue
        const words = [...w.touches.map((c) => labelOf(k, c)), ...w.title.split(/\s+—\s+|:\s+/)].filter(Boolean)
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
      await serial(`json:${f}`, async () => {
        const cur = await fs.readFile(f, 'utf8').then(JSON.parse, () => ({ moved: {} }))
        await writeJsonAtomic(f, { ...cur, ...st, moved: { ...(cur.moved || {}), ...st.moved } })
      })
      if (moved.length) feed.add(dataDir, ctx.user, { kind: 'send', kn: id, dot: 'acc', text: `받은편지함 메모 ${moved.length}개를 옮겼다`, small: [...new Set(moved.map((x) => x.to))].join(' · ') }).catch(() => {})
      return { moved, candidates, left: k.works.filter((w) => !isSystemRecord(w) && !st.moved[w.id]).length - candidates.length }
    },
    // 받은편지함 메모 하나를 팀 지식으로(보내기 화면의 「보낼 것에 넣기」) — 같은 kmd 의 받기 길 · 다시 옮기지 않게 표시
    async inboxSend(ctx, id, { record, to }) {
      await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '받은편지함은 주인이 보낸다')
      const w = (await hub.get(id)).byWork.get(record)
      if (!w || w.tags.includes('private')) throw new KmdError('E_NOTFOUND', '보낼 메모가 없다')
      const r = await hub.receive(ctx, to, { from: '받은편지함', items: [{ title: w.title, body: w.body, sha: sha16(`${id}\n${w.id}`), date: w.date }] })
      const f = path.join(dataDir, 'inbox', `${encodeURIComponent(id)}.json`)
      await serial(`json:${f}`, async () => {
        const st = await fs.readFile(f, 'utf8').then(JSON.parse, () => ({ moved: {} }))
        ;(st.moved ||= {})[w.id] = to
        await writeJsonAtomic(f, st)
      })
      return r
    },

    // 멈춤 줄 — 그 사람이 보는 지식만
    async stops(ctx, id = null) {
      const ks = id ? [await hub.meta(id, ctx)] : await hub.visible(ctx)
      const out = []
      // 정리 일꾼이 쉬고 있다(로그인 끝 · 한도) — 관리자에게
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      const curates = !!ctx.admin
      if (ws && ws.ok === false && !id) {
        const d = (Date.now() - Date.parse(ws.since)) / 864e5
        out.push(stopLine({ kind: 'worker', level: 'warn', what: '자동 정리가 쉬고 있다', amount: d < 1 ? '오늘부터' : `${Math.round(d)}일`, fix: mode === 'pc' ? '설정 › Claude 연결에서 다시 로그인하면 이어서 한다 · 그동안은 규칙으로 넣는다' : ctx.admin ? '설정 · 팀 › Claude 연결에서 다시 로그인하면 이어서 한다 · 그동안은 규칙으로 넣는다' : '그동안은 규칙으로 넣는다', told: ctx.admin ? null : curates ? '관리자에게 알렸다' : null }))
      }
      // 정리 일꾼이 일감을 받지 않는다 — 기다리는 팀 정리가 10분 넘었고 일꾼을 10분 넘게 못 봤다(설치 뒤 일꾼을 띄우지 않았다 · 일꾼이 멈췄다)
      if (mode === 'team' && curates && !id && !(ws && ws.ok === false)) {
        const w = hub.workerSeen()
        const old = w.queued.filter((j) => Date.now() - Date.parse(j.at) > 10 * 60_000)
        if (old.length && (!w.at || Date.now() - Date.parse(w.at) > 10 * 60_000)) out.push(stopLine({ kind: 'worker', level: 'warn', what: '정리 일꾼이 일감을 받지 않는다', amount: `기다리는 정리 ${old.length}`, fix: ctx.admin ? '서버에서 정리 일꾼을 띄운다. 관리자 설명서 › Claude 연결' : null, told: ctx.admin ? (w.at ? `마지막으로 본 때 ${w.at.slice(5, 16).replace('T', ' ')}` : '한 번도 묻지 않았다') : '관리자에게 알렸다' }))
      }
      // 주인 장부를 다시 읽지 못했다 — 관리자에게 한 줄(옛 장부로 돌고 있다)
      if (regBad && ctx.admin && !id) out.push(stopLine({ kind: 'owners', level: 'warn', what: 'owners.json 을 읽지 못해 앞의 장부로 돌고 있다', amount: '고칠 때까지', fix: '서버의 owners.json 모양을 바로잡는다', told: regBad.why, since: `${regBad.since.slice(5, 16).replace('T', ' ')} 부터` }))
      for (const k of ks) {
        out.push(...backup.lines(k, { name: k.name }))
        // 보내기 멈춤은 팀 화면에만(개인 프로그램에는 보내기가 없다)
        const all = mode === 'team' ? (await sendLib.readState(dataDir, k.id)).wait : []
        const sw = all.filter((w) => w.state === 'wait')
        const sf = all.filter((w) => w.state !== 'wait')
        if (sw.length) out.push(stopLine({ kind: 'send', kn: k.id, level: 'warn', what: `${k.name}: 보낼 곳에 닿지 않는다`, amount: `${sw.reduce((a, w) => a + w.payload.items.length, 0)}개`, fix: '닿으면 저절로 보낸다', since: `${sw[0].at.slice(5, 10)} ${new Date(sw[0].at).toTimeString().slice(0, 5)} 에 누른 것` }))
        if (sf.length) out.push(stopLine({ kind: 'send', kn: k.id, level: 'warn', what: `${k.name}: 보내지 못했다(${sf[0].to.kn})`, amount: `${sf.reduce((a, w) => a + w.payload.items.length, 0)}개`, fix: sf[0].fix || '지식 보내기에서 [다시] · [버리기]', told: sf[0].why }))
        const decl = await readDecl(k.dir).catch((e) => {
          // 장부가 깨졌다 — 가져오기 · 고치기가 멈춘다(덮어쓰지 않는다) · 사람에게 한 줄
          out.push(stopLine({ kind: 'source', kn: k.id, level: 'bad', what: `${k.name}: ${DECL_BROKEN}`, amount: '가져오기 · 고치기 멈춤', fix: hub.canSource(ctx, k.id) ? '지식 폴더의 _sources.json 을 바로잡거나 git 에서 앞의 판으로 되돌린다' : null, told: hub.canSource(ctx, k.id) ? String(e.message).slice(0, 160) : '관리자에게 알렸다' }))
          return []
        })
        if (decl.length) out.push(...sourceLines(k, decl, await readSourceState(dataDir, k.id), { admin: hub.canSource(ctx, k.id) }))
        if (!backup.attached(k)) {
          const u = await unbacked(k)
          if (u) out.push(stopLine({ kind: 'backup', kn: k.id, level: 'warn', what: `${k.name}: 백업 자리가 없다`, amount: `백업 안 된 저장 ${u.n}번`, fix: mode === 'pc' ? '설정 › 이 PC 에서 백업 자리를 정하면 저절로 붙고 그동안의 것을 모두 보낸다' : '관리자가 백업 자리를 붙이면 그동안의 것을 모두 보낸다', since: `${u.since} 부터` }))
        }
      }
      return out
    },

    // 주인 · 관리자 · 정리 설정 — 관리자 또는 지금 주인. `_members.md` 도 같이 바꿔 백업 · 되살림에 따라가게.
    // 주인이 바꾸는 것은 정리 설정과 관리자까지 — 「주인」 은 관리자(· 셸)만(주인 혼자 팀 지식을 넘기지 않게).
    // 권한은 잠금 안의 지금 줄로 다시 본다(관리자가 막 바꾼 것을 옛 줄로 되돌리지 않게). 셸(서버를 띄운 사람)은 가림을 건너뛴다
    async setOwner(ctx, id, row) {
      const meta = await hub.meta(id, ctx.shell ? null : ctx)
      if (row && 'private' in row) { const { private: _p, ...rest } = row; row = rest } // 팀 서버에는 개인 지식이 없다
      // 정리 설정 · 지식관리자(예전 정리하는 사람) — 그 지식의 관리 자리 · 주인 바꾸기는 총괄 관리자 · 셸만
      const allowed = (reg) => {
        const cur = owners.rowOf(reg, id)
        if (!ctx.shell && mode === 'team' && owners.levelOf(reg, id, ctx) !== 'admin') throw new KmdError('E_FORBIDDEN', '이 지식의 지식관리자가 아니다', { need: 'admin' })
        const changesOwner = row?.owner != null && row.owner !== (cur?.owner ?? null)
        if (!ctx.admin && !ctx.shell && changesOwner) throw new KmdError('E_FORBIDDEN', '주인은 총괄 관리자가 바꾼다')
      }
      allowed(R())
      let cerr = null
      const out = await mutateReg(async (next) => {
        allowed(next)
        owners.setOwner(next, id, row)
        delete next.knowledge[id].check
        const r = { ...next.knowledge[id] }
        // 지식 안의 사람 칸도 잠금 안에서 — 셸 · 서버가 겹쳐 고쳐도 장부와 같은 차례로 쓰고 묶는다(git 잠금을 다투지 않는다).
        // 묶지 못해도 장부는 남기고 알린다(백업에 옛 사람 칸이 남으면 되살릴 때 다르게 열린다)
        await ensureRepo(meta.dir)
        const mf = path.join(meta.dir, '_members.md'), text = owners.renderMembers(r)
        if ((await fs.readFile(mf, 'utf8').catch(() => null)) !== text) {
          await fs.writeFile(mf, text, 'utf8')
          await commitPaths(meta.dir, ['_members.md'], '이 지식의 사람: 주인 · 정리', 'kmd').catch((e) => { cerr = e })
        }
        return r
      })
      if (out.tidyMode !== 'live') { clearTimeout(liveTimers.get(id)); liveTimers.delete(id) } // 실시간을 끄면 기다리던 한 번도 걷는다
      if (cerr) throw new KmdError('E_INTERNAL', `사람 칸을 지식에 묶지 못했다: ${String(cerr.message).split('\n')[0]} · 다시 한다`)
      return out
    },
    // 지식의 자리 표 — 보기(관리 자리) · 사람 목록(people) · 묶음 이름(groupNames) 은 고르기 칸
    async accessView(ctx, id) {
      await hub.meta(id, ctx.shell ? null : ctx)
      if (!ctx.shell) hub.need(ctx, id, 'admin')
      const reg = R()
      const row = owners.rowOf(reg, id)
      const a = owners.accessOf(row)
      return { all: a.all, users: { ...a.users, ...Object.fromEntries(owners.curatorsOf(row).map((c) => [c, 'admin'])) }, groups: a.groups, owner: row?.owner || null, people: hub.people(), groupNames: Object.keys(reg.groups || {}).sort(), legacy: !row?.access }
    },
    // 자리 표 바꾸기 — 그 지식의 관리 자리(총괄 관리자는 부르는 쪽이 비밀번호를 한 번 더) · 장부와 `_members.md` 를 같이
    async setAccess(ctx, id, { all, users, groups } = {}) {
      const meta = await hub.meta(id, ctx.shell ? null : ctx)
      if (!ctx.shell) hub.need(ctx, id, 'admin')
      const known = new Set(hub.people())
      if (users && typeof users === 'object' && known.size) for (const u of Object.keys(users)) if (!known.has(String(u).trim().toLowerCase())) throw new KmdError('E_INPUT', `그런 사람은 없다: ${String(u).slice(0, 40)}`)
      let cerr = null
      const out = await mutateReg(async (next) => {
        if (!ctx.shell && mode === 'team' && owners.levelOf(next, id, ctx) !== 'admin') throw new KmdError('E_FORBIDDEN', '이 지식의 지식관리자가 아니다', { need: 'admin' })
        let r
        try { r = { ...owners.setAccess(next, id, { all, users, groups }) } } catch (e) { throw e.code ? new KmdError(e.code, e.message) : e }
        delete next.knowledge[id].check
        await ensureRepo(meta.dir)
        const mf = path.join(meta.dir, '_members.md'), text = owners.renderMembers(r)
        if ((await fs.readFile(mf, 'utf8').catch(() => null)) !== text) {
          await fs.writeFile(mf, text, 'utf8')
          await commitPaths(meta.dir, ['_members.md'], '이 지식의 사람: 자리', 'kmd').catch((e) => { cerr = e })
        }
        return r
      })
      if (cerr) throw new KmdError('E_INTERNAL', `사람 칸을 지식에 묶지 못했다: ${String(cerr.message).split('\n')[0]} · 다시 한다`)
      list = null
      return { ...owners.accessOf(out), owner: out.owner || null }
    },
    // 옛 지식 한 번 옮기기(docs/kmd_권한_모델.md 4절) — 팀 서버를 켤 때 · people 은 그때 있는 사람(auth.people: 떠난 사람 · 기계 · 일꾼 제외).
    //   장부에 accessV 2 가 있으면 하지 않는다 · 장부가 깨져 있으면 mutateReg 가 던지고 옮기지 않는다(빈 장부로 덮지 않는다) · 바뀐 지식은 _members.md 도
    async migrateAccess(people) {
      if (mode !== 'team') return []
      if (!Array.isArray(people)) throw new KmdError('E_INPUT', '옮기기에는 사람 목록이 있어야 한다')
      if ((R().accessV || 0) >= 2) return []
      const ks = await hub.list()
      const touched = await mutateReg((next) => owners.migrateV2(next, ks.map((k) => k.id), people))
      if (!touched.length) return []
      await hub.membersFiles(touched, '권한 옮김: 기본 없음 · 있던 사람에게 옛 기본 자리')
      list = null
      log(`권한 옮김(한 번): 기본 자리를 없음으로 · 있던 사람 ${people.length}명에게 옛 기본 자리 · 지식 ${touched.length}`)
      return touched
    },
    // 한 사람의 지식마다 자리 — 보기(설정 › 사람 카드 · 총괄 관리자): 사람 줄 · 묶음 · 주인 · 실제 자리
    async seatsOf(ctx, user) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '사람의 자리는 총괄 관리자가 본다')
      const reg = R()
      const u = String(user ?? '').trim().toLowerCase()
      return Object.fromEntries((await hub.list()).map((k) => {
        const row = owners.rowOf(reg, k.id)
        const a = owners.accessOf(row)
        const mine = row?.owner === u || owners.curatorsOf(row).includes(u) ? 'admin' : a.users[u] || 'none'
        const viaGroups = owners.groupsOf(reg, u).filter((g) => a.groups[g]).map((g) => ({ group: g, level: a.groups[g] }))
        return [k.id, { name: k.name, mine, owner: row?.owner === u, groups: viaGroups, all: a.all, level: owners.levelOf(reg, k.id, { user: u }) }]
      }))
    },
    // 한 사람의 지식마다 자리 — 바꾸기(사람 더하기 · 사람 카드 · 총괄 관리자) · { 지식: 없음|읽기|쓰기|지식관리자 } · _members.md 도
    async setSeats(ctx, user, seats) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '사람의 자리는 총괄 관리자가 준다')
      const u = String(user ?? '').trim().toLowerCase()
      if (!hub.people().includes(u)) throw new KmdError('E_INPUT', `그런 사람은 없다: ${u.slice(0, 40)}`)
      if (!seats || typeof seats !== 'object' || Array.isArray(seats)) throw new KmdError('E_INPUT', '자리는 { 지식: 자리 } 이다')
      const ids = new Set((await hub.list()).map((k) => k.id))
      for (const id of Object.keys(seats)) if (!ids.has(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new KmdError('E_INPUT', `그런 지식은 없다: ${String(id).slice(0, 40)}`)
      let touched
      try {
        touched = await mutateReg((next) => owners.setSeats(next, u, seats))
      } catch (e) { throw e.code && !(e instanceof KmdError) ? new KmdError(e.code, e.message) : e }
      await hub.membersFiles(touched, `이 지식의 사람: ${u} 의 자리`)
      list = null
      return { user: u, kns: touched, seats: await hub.seatsOf(ctx, u) }
    },
    // 묶음 — 사람 여럿에 한 번에 자리를 준다(총괄 관리자 · 셸) · 사람 목록은 서버(owners.json)에만
    groups() {
      const g = R().groups || {}
      return Object.keys(g).sort().map((name) => ({ name, members: g[name].members || [], kns: Object.entries(R().knowledge || {}).filter(([, r]) => r?.access?.groups?.[name]).map(([id]) => id) }))
    },
    async setGroup(ctx, { name, members } = {}) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '묶음은 총괄 관리자가 정한다')
      const known = new Set(hub.people())
      const ms = (Array.isArray(members) ? members : String(members ?? '').split(/[,\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      if (known.size) for (const u of ms) if (!known.has(u)) throw new KmdError('E_INPUT', `그런 사람은 없다: ${u.slice(0, 40)}`)
      try {
        return await mutateReg((next) => owners.setGroup(next, name, ms))
      } catch (e) { throw e.code && !(e instanceof KmdError) ? new KmdError(e.code, e.message) : e }
    },
    async dropGroup(ctx, name) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '묶음은 총괄 관리자가 지운다')
      let touched
      try {
        touched = await mutateReg((next) => owners.dropGroup(next, name))
      } catch (e) { throw e.code && !(e instanceof KmdError) ? new KmdError(e.code, e.message) : e }
      await hub.membersFiles(touched, `이 지식의 사람: 묶음 ${name} 을 지웠다`)
      return { name, kns: touched }
    },
    // 장부의 지금 줄로 `_members.md` 를 고쳐 쓴다(묶음 · 떠남처럼 여러 지식이 한 번에 바뀔 때)
    async membersFiles(ids, title) {
      const ks = await hub.list()
      for (const id of ids || []) {
        const k = ks.find((x) => x.id === id)
        const row = owners.rowOf(R(), id)
        if (!k || !row) continue
        await fs.writeFile(path.join(k.dir, '_members.md'), owners.renderMembers(row), 'utf8').catch(() => {})
        await commitPaths(k.dir, ['_members.md'], title, 'kmd').catch((e) => log('사람 칸', id, e.message))
      }
    },
    // 되살린 지식 — `_members.md` 로 주인 · 정리 설정을 다시 건다(없으면 줄 없이 · 옛 꼴이면 안전한 쪽)
    async adoptRestored(id) {
      const meta = await hub.meta(id)
      return mutateReg((next) => owners.adoptMembers(next, id, meta.dir, { restore: true }))
    },
    // 장부와 `_members.md` 맞추기 — 켤 때 · 동기화 때(장부를 잃었거나 · 셸 · 밤 묶음으로 되돌렸어도 주인 · 정리 설정이 돌아온다).
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
      if (fixed.length) log(`주인 장부를 지식 안의 _members.md 와 맞췄다: ${fixed.join(' · ')}`)
      for (const k of ks) {
        const text = await fs.readFile(path.join(k.dir, '_members.md'), 'utf8').catch(() => null)
        const row = owners.rowOf(R(), k.id)
        if (text == null || !row) continue
        // 옛 꼴(설정 줄 없음) · 장부에 자리 표가 있는데 `_members.md` 의 것과 다르다 — 장부의 값으로 새 꼴로
        //   손으로 고친 줄이 깨져 있으면(나쁜 묶음 이름 · 모르는 자리) 다른 것으로 보고 장부의 값으로 고쳐 쓴다 · 지식 하나가 넘어져도 나머지는 이어서
        try {
          const pm = owners.parseMembers(text)
          let same = false
          try { same = owners.sameAccess(pm.access, row.access) } catch {}
          if (pm.settings && (!row.access || same)) continue
          await fs.writeFile(path.join(k.dir, '_members.md'), owners.renderMembers(row), 'utf8')
          await commitPaths(k.dir, ['_members.md'], pm.settings ? '이 지식의 사람: 자리 표를 장부와 맞춘다' : '이 지식의 사람: 정리 설정도 싣는다', 'kmd').catch((e) => log('사람 칸 새 꼴', k.id, e.message))
        } catch (e) {
          log('사람 칸 맞추기', k.id, e.message)
        }
      }
      return fixed
    },
    // 떠난 사람의 지식 — 관리자 칸에서 뺀다. to 가 있으면 그 사람이 주인을 잇고, 없으면 주인 칸을 비운다. `_members.md` 도 같이
    async handOver(user, { to = null } = {}) {
      const ks = await hub.list()
      const changed = await mutateReg((next) => {
        const out = []
        // 자리 표의 사람 줄 · 묶음에서도 뺀다
        const seat = new Set(owners.dropUser(next, user))
        for (const k of ks) {
          const r = next.knowledge[k.id]
          if (!r) continue
          const own = r.owner === user
          const cur = (r.curators || []).includes(user)
          if (!own && !cur && !seat.has(k.id)) continue
          if (own) { if (to) r.owner = to; else r.owner = null }
          if (cur) r.curators = r.curators.filter((x) => x !== user)
          r.at = new Date().toISOString()
          out.push({ id: k.id, dir: k.dir, own, cur, row: { ...r } })
        }
        return out
      })
      for (const c of changed) {
        await fs.writeFile(path.join(c.dir, '_members.md'), owners.renderMembers(c.row), 'utf8').catch(() => {})
        await commitPaths(c.dir, ['_members.md'], `이 지식의 사람: ${user} 이 떠났다`, 'kmd').catch((e) => log('사람 칸', c.id, e.message))
      }
      list = null
      return { team: changed.filter((c) => c.own).length, curate: changed.filter((c) => !c.own && c.cur).length, seat: changed.filter((c) => !c.own && !c.cur).length, to }
    },
    // 사람마다 — 주인인 팀 지식 · 정리하는 지식 · 자리 있는 지식(주인 · 정리 · 사람 줄 · 묶음 줄)의 수(관리 › 사람 · 떠남 확인)
    async peopleRoles() {
      const out = {}
      const add = (u, key) => { (out[u] ||= { team: 0, curate: 0, kns: 0 })[key]++ }
      const reg = R()
      const ks = await hub.list()
      for (const k of ks) {
        const r = rowFor(k.id)
        if (!r) continue
        if (r.owner) add(r.owner, 'team')
        for (const c of r.curators || []) add(c, 'curate')
      }
      for (const u of hub.people()) for (const k of ks) if (owners.seatOf(reg, k.id, u)) add(u, 'kns')
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
        if (insideDir(full, meta.dir) || insideDir(full, dataDir)) throw new KmdError('E_INPUT', '지식 폴더 · 살림 자리 안에는 백업을 둘 수 없다')
        if (!roots.some((r) => insideDir(full, r))) throw new KmdError('E_FORBIDDEN', '이 폴더는 백업 자리로 허락되지 않았다. serve.json 의 backupRoots 에 더한다')
      }
      const meta = await hub.meta(id)
      const r = await backup.attach(meta, url, { dataDir })
      return { ...r, backup: backup.stateOf(meta) }
    },
    async backupPull(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '백업에서 받기는 총괄 관리자가 한다')
      const meta = await hub.meta(id, ctx)
      const r = await backup.pull(meta, { check })
      cache.delete(id)
      return r
    },
    // 이 백업 이어 쓰기 — 갈라졌을 때 백업 쪽이 맞다고 사람이 정한다(지금 머리는 가지로 남긴다)
    async backupAdopt(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '백업 이어 쓰기는 총괄 관리자가 한다')
      const meta = await hub.meta(id)
      // 갈라졌으면 — 서버에만 있던 기록을 쓴 사람에게 알린다(가지 kmd-before-… 에 남는다 · 다시 남기면 들어간다)
      const lost = await backup.lostIfAdopt(meta).catch(() => ({ records: [], docs: [] }))
      const r = await backup.adopt(meta, { check })
      cache.delete(id)
      const by = {}
      for (const x of lost.records) if (x.author && !/^kmd/.test(x.author)) (by[x.author] ||= []).push(x)
      if (r.kept) for (const [u, recs] of Object.entries(by)) await feed.add(dataDir, u, { kind: 'kn', kn: id, yl: true, b: `${meta.name} 을 백업의 글로 되돌렸다. 내 기록 ${recs.length} 이 지식에서 빠졌다`, small: `${recs.slice(0, 3).map((x) => x.title).join(' · ')} · 가지 ${r.kept} 에 남아 있다. 필요하면 다시 남긴다` }).catch(() => {})
      return { ...r, lost: lost.records.length }
    },
    // 되살리기 — 백업 자리에서 새 폴더로(지식 받아 오기 · 새 PC 의 [이 PC 로 되살리기]) · 받은 곳을 그대로 백업 자리로 붙인다
    async restore(ctx, { url, name, attach = null }) {
      if (!ctx.admin && !ctx.shell && mode !== 'pc') throw new KmdError('E_FORBIDDEN', '되살리기는 총괄 관리자가 한다')
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다')
      const t = checkUrl(url, { roots: config.backupRoots || [], pc: mode === 'pc' })
      const nm = String(name || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || path.basename(t.url).replace(/\.git$/i, '')
      if (!nm || nm.startsWith('.')) throw new KmdError('E_INPUT', '이름을 정한다')
      if ((await hub.list()).some((k) => k.id.toLowerCase() === nm.toLowerCase())) throw new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`)
      const dir = path.join(root, nm)
      // 백업에 이어 붙이나 — 같은 주소를 이 kmd 의 다른 지식이 쓰면 붙이지 않는다(연습 사본이 운영 백업에 밀어 넣지 않게) ·
      // 정하지 않았으면 원래 이름(주소의 끝)으로 되살릴 때만 붙인다 · 다른 이름이면 읽기만 사본
      const used = (await hub.list()).find((k) => backup.stateOf(k)?.url === maskUrl(t.url))
      if (attach === true && used) throw new KmdError('E_CONFLICT', `같은 백업 자리를 「${used.name}」 이 쓰고 있다. 연습이면 붙이지 않고 되살린다(--practice)`)
      const same = nm.toLowerCase() === path.basename(String(t.url).replace(/[\\/]+$/, '')).replace(/\.git$/i, '').toLowerCase()
      const doAttach = attach === false ? false : attach === true ? true : !used && same
      const r = await restoreFrom({ url: t.url, dir, check, local: t.local })
      // 주인 · 개인 · 정리 설정을 목록에 보이기 전에 건다(되살린 개인 지식이 한순간도 팀에 열리지 않게)
      const owner = await mutateReg((next) => owners.adoptMembers(next, nm, dir, { restore: true }))
      list = null
      const meta = await hub.meta(nm)
      if (doAttach) await backup.attach(meta, t.url, { dataDir }).catch((e) => log('되살린 지식 백업 붙이기', nm, e.message))
      else {
        // 읽기만 사본 — 원래 백업에는 보내지 않는다(이 PC 의 백업 자리가 있으면 거기로 새로)
        await tryGit(dir, ['remote', 'remove', backup.REMOTE])
        await hub.autoBackup(nm).catch(() => {})
      }
      // 받을 사람 — 되살린 사람과(셸이면 없다) 주인에게 · 주인이 명부에 없으면 되살린 사람만
      if (owner?.check) for (const who of new Set([ctx.shell ? null : ctx.user, owner.owner].filter(Boolean))) feed.add(dataDir, who, { kind: 'kn', kn: nm, dot: 'warn', text: `되살린 지식의 정리 설정을 다시 본다: ${meta.name}`, small: '옛 백업이라 정리 방식 · Claude 에 보내지 않음이 없어 「손으로만 · 보내지 않음」 으로 두었다. 이 지식의 사람에서 바꾼다' }).catch(() => {})
      feed.add(dataDir, ctx.user || 'kmd', { kind: 'kn', kn: nm, dot: 'acc', text: `되살렸다: ${meta.name}`, small: `문서 ${r.docs} · 기록 ${r.records} · 첨부 ${r.atts}${r.errors.length ? ' · 검사 줄 ' + r.errors.length : ''}` }).catch(() => {})
      return { id: nm, ...r, owner: owner?.owner || null, check: !!owner?.check, attached: doAttach }
    },
    // GitLab 봇 — 백업 자리가 없는 팀 지식에 저장소를 찾거나 만들어 붙인다(안 되면 지금처럼 · 멈춤 줄이 남는다)
    async gitlabAttach(id) {
      const g = config.gitlab
      if (!g || mode !== 'team') return null
      const meta = await hub.meta(id)
      if (backup.attached(meta)) return null
      const token = await getSecret(dataDir, g.secret || 'gitlab')
      if (!token) return null
      const p = await ensureProject({ api: g.api, group: g.group, token, name: meta.id })
      await ensureRepo(meta.dir) // 아직 git 이 없는 지식이면 있던 글을 첫 묶음으로
      await backup.attach(meta, p.url, { dataDir })
      log(`${meta.name}: GitLab 백업 자리를 ${p.created ? '만들어' : '찾아'} 붙였다`)
      return p
    },
    backupStateSync: (meta) => backup.stateOf(meta),
    async backupState(ctx, id) {
      return backup.stateOf(await hub.meta(id, ctx.admin || ctx.shell ? undefined : ctx))
    },
    // 저절로 붙이기 — 이 PC 만 · 백업 자리(backupRoot) 아래(팀 지식은 관리자가 붙인다 · GitLab 봇)
    //   새 지식 · 동기화 · 되살리기 · 켤 때(붙지 않은 것)
    async autoBackup(id) {
      const meta = await hub.meta(id)
      if (backup.attached(meta)) return null
      const base = mode === 'pc' ? config.backupRoot : null
      if (!base) return null
      const bare = path.join(path.resolve(base), `${id}.git`)
      await fs.mkdir(path.dirname(bare), { recursive: true })
      if (!existsSync(bare)) {
        const r = await tryGit(path.dirname(bare), ['init', '-q', '--bare', '-b', 'main', bare])
        if (!r.ok) throw new KmdError('E_INPUT', `백업 자리를 만들지 못했다: ${r.err.split('\n')[0]}`)
      }
      await backup.attach(meta, bare, { dataDir })
      return bare
    },
    // 이 PC 의 백업 자리 정하기 — serve.json 의 backupRoot · 정하면 붙지 않은 지식을 모두 붙인다
    async setBackupRoot(ctx, dir) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '이 PC 의 일이다') // 팀 화면이면 이 PC 에서 확인을 받은 뒤다(PAIR_ASK)
      const full = path.resolve(String(dir || '').trim())
      if (!String(dir || '').trim()) throw new KmdError('E_INPUT', '백업 자리 폴더를 쓴다')
      const inside = insideDir // 대소문자를 가리지 않고(Windows) — sources.inside 하나로
      if (inside(full, path.resolve(root)) || inside(full, path.resolve(dataDir)) || inside(path.resolve(root), full)) throw new KmdError('E_INPUT', '지식 폴더 · 살림 자리와 겹치지 않는 곳에 둔다(다른 드라이브 · 네트워크 폴더)')
      await fs.mkdir(full, { recursive: true }).catch((e) => { throw new KmdError('E_INPUT', `그 폴더를 만들 수 없다: ${e.code || e.message}`) })
      const cur = await loadConfig(dataDir)
      await writeJsonAtomic(path.join(dataDir, 'serve.json'), { ...cur, backupRoot: full }, { indent: 1 })
      config.backupRoot = full
      let attached = 0
      const failed = []
      for (const m of await hub.list()) {
        try { if (await hub.autoBackup(m.id)) attached++ } catch (e) { failed.push(`${m.name}: ${e.message}`) }
      }
      return { root: full, attached, failed }
    },
    // 갈라졌을 때 — 이어 쓰기가 빼는 것(서버에만 있는 기록 · 문서) · 서버 것으로 백업 덮기
    async backupLost(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '총괄 관리자가 한다')
      return backup.lostIfAdopt(await hub.meta(id))
    },
    async backupKeep(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '총괄 관리자가 한다')
      return backup.keepServer(await hub.meta(id))
    },
    async start() {
      // 기다리던 정리 · 마지막 정리 날 · 정리 일꾼 상태 — 다시 켜도 잇는다(맡았던 일감은 기다림으로)
      for (const j of await fs.readFile(jobsFile, 'utf8').then(JSON.parse, () => [])) jobs.set(j.id, j.state === 'running' || j.state === 'closing' ? { ...j, state: j.rule ? 'failed' : 'queued', worker: null, ...(j.rule ? { why: '다시 켜며 멈췄다. [지금 정리]' } : {}) } : j)
      intakeDay = await fs.readFile(intakeDayFile, 'utf8').then(JSON.parse, (e) => (e.code === 'ENOENT' ? {} : (log('하루 들이기 수 장부를 읽지 못했다', e.message), {})))
      // 다시 켤 때 — 같은 일감의 기록(job/<id>)이 이미 있으면 그 일감은 넣었다(커밋 뒤 · 장부를 쓰기 전에 꺼졌다 · S-D48)
      for (const j of [...jobs.values()].filter((x) => x.kind === 'intake' && x.state === 'queued')) {
        const k = await hub.get(j.kn).catch(() => null)
        const w = k?.works.find((x) => x.tags.includes(`job/${j.id}`))
        if (w) await intakeClose(j, { rec: w.id, put: 0, held: w.tags.includes('held') ? 1 : 0, same: true }).catch((e) => log('들이기 일감 닫기', j.id, e.message))
      }
      for (const [k, v] of Object.entries(await fs.readFile(path.join(dataDir, 'tidy-last.json'), 'utf8').then(JSON.parse, () => ({})))) lastTidy.set(k, v)
      wsNow = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      // 장부를 지식 안의 `_members.md` 와 맞춘다 — 밤 묶음으로 살림 자리를 되돌렸거나 장부 줄을 잃었어도 개인 지식은 다시 가린다
      await hub.reconcileOwners().catch((e) => log('주인 장부 맞추기', e.message))
      await hub.runLoad()
      // 일 줄 — 남은 일 · 끝난 일을 읽는다 · 예전 runs 는 끝난 일로 · 꺼질 때 돌던 파일은 곧 그 단계부터 다시(가져오기 · 넣기는 정한 때가 다시 한다)
      for (const j of await Q.load()) if (j.kind === 'file') runs.set(j.id, j)
      for (const r of runs.values()) Q.adopt(r)
      setTimeout(() => {
        if (!started) return
        for (const j of Q.list()) {
          if (j.parked !== 'restart') continue
          if (j.kind === 'file' && j.spec?.type === 'ingest') { try { Q.retry(j.id) } catch (e) { Q.end(j, 'fail', e.message) } }
          else if (j.kind === 'group') Q.end(j, 'fail', `프로그램이 꺼져 나머지 파일을 받지 못했다: ${j.sent}/${j.total}`)
          else Q.drop(j)
        }
      }, config.queueResumeMs ?? 1500).unref?.()
      started = true
      // 꺼지며 남은 반쯤 쓴 저장 — 켤 때 되돌린다(거두기 · 백업보다 먼저 · 팀 서버도)
      for (const m of await hub.list().catch(() => [])) {
        const back = await serial(path.resolve(m.dir), () => recoverSave(m.dir)).catch((e) => (log('반쯤 쓴 저장 되돌리기', m.id, e.message), []))
        if (back.length) { cache.delete(m.id); log('반쯤 쓴 저장을 되돌렸다', m.id, back.join(' · ')) }
      }
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
      if (config.backupRoot) setTimeout(async () => { for (const m of await hub.list().catch(() => [])) await hub.autoBackup(m.id).catch((e) => log('백업 자리', m.id, e.message)) }, 800).unref?.()
      // 거두기 — PC(또는 serve.json collect)에서 편집기로 고친 문서를 30초 고요 뒤 들인다
      await hub.known().catch(() => {}) // 처음 켤 때 — 지금 있는 지식을 아는 것으로
      if (mode === 'pc' || config.collect) for (const m of await hub.list()) watchers.push(Object.assign(collect.watch(m.dir, () => hub.collect(m.id)), { dir: m.dir }))
      // 꺼져 있던 동안 편집기로 고친 것 — 켤 때 한 번 거둔다(다른 파일이 바뀔 때까지 기다리지 않게)
      if (mode === 'pc' || config.collect) setTimeout(async () => { for (const m of await hub.list().catch(() => [])) await hub.collect(m.id).catch(() => {}) }, config.collectOnStartMs ?? 1500).unref?.()
      // 가져올 곳 — 할 일 시계(분마다 본다 · 각자의 every) · 켤 때 한 번
      const dueSources = async (all) => {
        for (const m of await hub.list().catch(() => [])) {
          // 장부가 깨진 지식은 건너뛰고 한 번 알린다(같은 내용이면 다시 적지 않는다 · 멈춤 줄이 사람에게 보인다)
          const decl = await readDecl(m.dir).catch((e) => {
            if (declWarned.get(m.id) !== e.message) { declWarned.set(m.id, e.message); log('가져올 곳 건너뜀', m.id, e.message) }
            return null
          })
          if (decl) declWarned.delete(m.id)
          if (!decl?.length) continue
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
      // 시계 몸통의 오류는 log 만 남기고 다음 분에 다시(처리되지 않은 reject 로 서버가 내려가지 않게)
      sourceTimer = setInterval(() => dueSources(false).catch((e) => log('가져올 곳 시계', e.message)), config.sourceTickMs || 60_000)
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
      setTimeout(() => dueSources(true).catch((e) => log('가져올 곳 시계', e.message)), 3000).unref?.()
      // 이 PC — 켤 때 쌓여 있던 「아직 안 넣은 기록」 을 바로 문서에(뒤에서 · 지식마다 한 줄)
      if (config.curateOnStart !== false) setTimeout(async () => { for (const m of await hub.list().catch(() => [])) if (mode === 'pc') hub.curateSoon(m.id).catch(() => {}) }, 2000).unref?.()
      // 정해진 시간의 정리 — 분마다 본다 · 지식마다 하루 한 번 · 넣을 것이 있을 때만
      // 정리가 세워지지 못하면(오류) 그날 날짜를 지워 다음 분에 다시 — 하루 세 번까지
      const tidyFails = new Map()
      const tidyFailed = async (id, day, what, e) => {
        log(what, id, e.message)
        const n = (tidyFails.get(id)?.day === day ? tidyFails.get(id).n : 0) + 1
        tidyFails.set(id, { day, n })
        if (n < 3 && lastTidy.get(id) === day) {
          lastTidy.delete(id)
          await writeJsonAtomic(path.join(dataDir, 'tidy-last.json'), Object.fromEntries(lastTidy)).catch((e2) => log('정리 날짜 기록', e2.message))
        }
      }
      tidyTimer = setInterval(async () => {
        try {
          const d = new Date()
          const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          const day = localDay(d)
          for (const m of await hub.list().catch(() => [])) {
            if (hm < hub.tidyAtOf(m.id) || lastTidy.get(m.id) === day) continue
            lastTidy.set(m.id, day)
            await writeJsonAtomic(path.join(dataDir, 'tidy-last.json'), Object.fromEntries(lastTidy)).catch((e) => log('정리 날짜 기록', e.message))
            // 받은편지함 — 정리 시각에 같은 주인의 개인 지식으로 옮긴다
            if (m.name === '받은편지함') await hub.inboxTidy({ user: rowFor(m.id)?.owner || pcUser || 'kmd', pc: mode === 'pc' }, m.id).catch((e) => tidyFailed(m.id, day, '받은편지함 정리', e))
            const k = await hub.get(m.id).catch(() => null)
            if (k && (mode !== 'pc' || hub.autoOf(pcUser, 'claude')) && (mode === 'pc' || hub.tidyModeOf(m.id) === 'time') && k.works.some((w) => w.state === 'pend' || w.state === 'nowhere')) hub.tidyNow({ user: 'kmd', admin: true }, m.id, { by: 'kmd', auto: true }).catch((e) => tidyFailed(m.id, day, '정해진 시간 정리', e))
          }
        } catch (e) { log('정리 시계', e.message) }
      }, config.tidyTickMs || 60_000)
      tidyTimer.unref?.()
      // 팀 시계 — 임대 지난 일감 · 24시간 넘게 기다린 들이기(S-D22 · S-D40) · 넣지 못함 원천 걷기
      if (mode === 'team') {
        jobTimer = setInterval(() => jobTick().catch((e) => log('들이기 시계', e.message)), config.jobTickMs ?? config.inboxTickMs ?? 60_000)
        jobTimer.unref?.()
      }
      // 보내기 — 닿지 않아 둔 것을 분마다 다시(개인 프로그램 → 팀 서버 · 팀 서버의 옛 개인 지식)
      sendTimer = setInterval(() => hub.sendRetry().catch((e) => log('보내기 다시', e.message)), config.sendTickMs || 60_000)
      sendTimer?.unref?.()
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
        if (r.reverted?.length) log(`${meta.name}: 손으로 고친 기록 · 장부를 되돌렸다: ${r.reverted.join(' · ')}`)
        // 되돌린 손 고침 — 이력에 노란 줄(까닭 · 사본 자리) · 글은 사본으로 남았다
        for (const x of r.rescued || []) await feed.add(dataDir, user, { kind: 'edit', kn: id, yl: true, b: `편집기 고침을 되돌렸다: ${meta.name} › ${x.path}`, small: `${x.why} · 고친 글의 사본: ${x.copy}` }).catch(() => {})
        if (r.id && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      }
      return r
    },
    stop() {
      started = false
      Q.close().catch(() => {})
      backup.stop()
      for (const w of watchers) w.close()
      for (const t of decideTimers.values()) clearTimeout(t)
      for (const t of liveTimers.values()) clearTimeout(t)
      clearInterval(tidyTimer)
      clearInterval(jobTimer)
      clearInterval(sourceTimer)
      clearInterval(sendTimer)
      for (const w of srcWatch.values()) w.close()
      srcWatch.clear()
    },
  }
  Q.runner('ingest', async (j) => {
    const sp = j.spec
    const data = sp.recId ? null : await fs.readFile(binOf(j.id)).catch(() => null)
    if (!sp.recId && !data) throw new Error('원본이 남아 있지 않다. 파일을 다시 넣는다')
    if (sp.recId) queuedRecs.add(sp.recId)
    runs.set(j.id, j)
    await hub.ingestFileLater({ user: sp.user || j.by || 'kmd' }, sp.kn, { rel: sp.rel, data, recId: sp.recId, run: j })
  })
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
