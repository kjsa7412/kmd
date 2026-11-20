#!/usr/bin/env node
// 채널별 지식 생성 평가(LLMOps 오프라인 평가) — 저장이 일어나는 길(하네스 설계 5-3 채널 표)마다 원천 몇 개를 넣어
//   시간(ms) · 비용($) · 부름 · 차례 · 토큰 · 고쳐 받기 · 실패 · 들어감 · 만든 문서/항목/기록 · savelog 채널이 맞나(channelOk)를 잰다.
//
//   node scripts/channel-eval.mjs plan                                                     채널 · 원천 · 예상 $ · 분(Claude 없이)
//   node scripts/channel-eval.mjs run --channel <ch>[,<ch>…]|all --tag <판> [--fake] [--model <m>] [--confirm-cost] [--max-usd <n>] [--no-retry] [--allow-drop]
//     --max-usd   실제 판 지출 상한(기본: 어림 × 1.5) · 건마다 계측 누계를 보고 넘으면 남은 건 · 채널은 「예산 넘음」 으로 적고 멈춘다
//     --no-retry  실패한 일감을 곧바로 다시 돌리지 않는다(일꾼 한 번) · --allow-drop  kmd-migrate 의 사라지는 표 행 · 문장을 넘긴다(넘긴 수는 칸으로)
//   node scripts/channel-eval.mjs report [<결과 json>…]                                   결과를 채널 표(markdown)로
//
//   --fake  가짜 Claude(test/fixture/fake-claude-agent.mjs + 대본 · fake-claude.mjs)로 배관만 본다(돈 0).
//   가짜가 아니면 실제 Claude 를 부른다(돈이 든다): --confirm-cost 가 있어야 돈다.
//   계측: KMD_CLAUDE_AGENT · KMD_CLAUDE 에 「계측 감싸개」(이 실행이 .kmd-data/channel-eval/meter/<판>/ 에 짓는다)를 걸어
//         Claude Code 의 result 줄(total_cost_usd · num_turns · duration · usage 토큰)을 줄마다 남긴다. 감싸개 안쪽이 가짜냐 진짜(cli.js)냐만 다르다.
//   쓰는 곳: .kmd-data/channel-eval/ 뿐(지식은 kn/<판>/<채널>/ · 결과 <날짜>-<판>.json). 188 · 제품 지식에는 쓰지 않는다.
//   사람 채널(session · send · bulk · http · edit · kmd-migrate)은 시험이 승인을 대신한다(받은 제안 그대로 승인 · 「사람이 무엇이든 승인한다」 쪽 상한).
//   session · bulk 는 사람 세션 그 자체가 아니라 머리 없는 대용(runAgent)이다(행의 proxy 칸).
//   비용 · 부름은 감싸개 계측이 기준(serverCost 는 j.cost · r.cost · 다르면 costGap) · 품질은 넣은 원천의 gold 부분집합으로 채점(score.scope).
import fs from 'node:fs/promises'
import fss from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadKnowledge } from '../core/knowledge.js'
import { RECORDS_DOC_PATH } from '../core/guard.js'
import { itemsOf, scoreKnowledge, gateOf, freshKn } from './harness-eval.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIX_DIR = path.join(ROOT, 'test/fixture/harness/빈지식')
const OUT_DIR = path.join(ROOT, '.kmd-data/channel-eval')
const KN = 'test-eval' // 임시 팀 서버의 지식 id(폴더 이름)
const USER = 'test-eval' // 시험 사람(총괄 관리자) — 일감을 건 사람 · 승인하는 사람
const SERVE = { decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000, sendTickMs: 3600000, queueResumeMs: 3600000, watchQuietMs: 600000, retryGaps: [1, 1, 1] }

// ───────── 채널 표 ─────────
//   ch      savelog 에 찍혀야 할 채널 값(channelOk) · llm 은 부르는 꼴(session · schema · none)
//   src     골든 원천 번호(gold.json sources.n) · base 는 앞 상태로 먼저 넣는 원천(무인 들이기 · intake-src · 비용은 따로)
//   unit    실제 Claude 예상(원천 · 건 하나) — 지난 실측(H4b · H7b: 세션 들이기 원천당 ≈ $0.45 · 3.5분)에서 어림
const CHANNELS = {
  'intake-file': { ch: 'intake-file', llm: 'session', src: [1, 2], unit: { usd: 0.45, min: 3.5 }, run: runIntakeFile, note: '화면 올리기 둘(importFiles → 승인 대기 → 승인): docx(원본 첨부 · bin) 하나 + md 하나. uploadAsk 끔(바로 들어감)은 설정을 바꾼 경우라 재지 않는다' },
  'intake-commit': { ch: 'intake-commit', llm: 'session', src: [7], extra: 1, base: [1], unit: { usd: 0.25, min: 1.3 }, run: runIntakeCommit, note: '지금 코드에서 이 채널을 여는 길이 없다(가져올 곳 · 개인 모두 auto → intake-src). 시험이 openJob 으로 직접 연다 · 07 은 값 바꿈(5→10 · retry_backoff 2) · 시험 커밋은 07 다음 값(10→15)' },
  'intake-src': { ch: 'intake-src', llm: 'session', src: [1, 2], unit: { usd: 0.45, min: 3.5 }, run: runIntakeSrc, note: '가져올 곳: 문서 폴더(하나씩 · 다시 돌려 same) + git 커밋 하나' },
  polish: { ch: 'polish', llm: 'schema', src: [], base: [1, 3], unit: { usd: 0.2, min: 2, per: '문서' }, docs: 2, run: runPolish, note: '들인 지식의 문서 둘을 다듬는다(runClaude 스키마 답 · 세션 아님)' },
  shape: { ch: 'shape', llm: 'schema', src: [1, 2, 3], unit: { usd: 0.35, min: 3 }, run: runShapeTeam, note: '팀 기초 세우기 Claude 안(올리기 → 조사 → shape-plan → shape-write → 연습 판 → 넣기)' },
  'shape-folder': { ch: 'shape', llm: 'none', src: [1, 2, 3], unit: { usd: 0, min: 0.2 }, run: runShapeFolder, note: '팀 기초 세우기 폴더 그대로(Claude 없음 · 기준선)' },
  'shape-pc': { ch: 'shape', llm: 'session', src: [1, 2, 3], unit: { usd: 0.6, min: 4 }, fakeSrc: [1, 3], run: runShapePc, note: '개인 기초 세우기 Claude 안(claudeSession 세션 · 뼈대 · 묶음 · 짓기)' },
  'shape-restructure': { ch: 'shape', llm: 'schema', src: [], base: [1, 3], unit: { usd: 0.5, min: 4, per: '구조안' }, run: runShapeRestructure, note: '짜임 다시 잡기(shapeAsk shape-plan → 검사 → 연습 판 → 넣기)' },
  send: { ch: 'send', llm: 'schema', src: [6, 8], base: [1], fakeSrc: [6, 3], unit: { usd: 0.4, min: 3 }, run: runSend, note: '개인 프로그램 → 팀 지식 보내기(sendPreview = Claude · sendPicked = 승인) · 팀 지식에 바탕(01)을 세운 뒤 값이 바뀐 판(06)을 보낸다' },
  session: { ch: 'session', llm: 'session', src: [6, 2], base: [1], unit: { usd: 0.5, min: 4 }, run: runSession, note: '사람 MCP 세션(kmd-team-save · propose → 승인 대신 → save) · 바탕(01) 위에 값이 바뀐 판(06) · 회의(02) · 머리 없는 대용(runAgent)' },
  bulk: { ch: 'bulk', llm: 'session', src: [6, 4], base: [1], unit: { usd: 0.5, min: 3 }, run: runBulk, note: '사람 MCP 대량 넣기(kmd-team-import · ingest/ 표지 + 첨부 · 한 세션에 원천 여럿) · 바탕(01) 위 · 머리 없는 대용(runAgent)' },
  http: { ch: 'http', llm: 'none', src: [3], base: [1], unit: { usd: 0, min: 0.1, per: '건' }, run: runHttp, note: 'API 열쇠 저장(POST /api/k/:id/propose → 받은 proposal 그대로 /save · 사람 채널) · 코드에 남아 있음 · H-D33 폐기 예정' },
  edit: { ch: 'edit', llm: 'none', src: [], base: [1], unit: { usd: 0, min: 0.1, per: '건' }, cases: 6, run: runEdit, note: '화면 고치기(저장 제안 → 넣기) · 기록 정정(fixes) · 거절 길(E_INPUT · E_FORMAT · E_CONFLICT · E_APPROVE)' },
  'edit-source': { ch: 'intake-file', llm: 'session', src: [], base: [1], unit: { usd: 0.45, min: 3.5, per: '건' }, cases: 1, run: runEditSource, note: '화면 고치기의 새 항목(editAsSource → 넣을 것 → 팀 일꾼 세션 → 승인 대기 → 승인) · 저장 줄 ch 는 intake-file' },
  'pc-intake': { ch: 'intake-file', llm: 'session', src: [2], unit: { usd: 0.45, min: 3.5 }, run: runPcIntake, note: '개인 프로그램 들이기(mode pc · importFiles → pcAgent(runAgent) → 승인 대기 → 승인) · 팀 일꾼과 다른 코드 길' },
  'kmd-migrate': { ch: null, llm: 'session', src: [], unit: { usd: 1.5, min: 15, per: '항목' }, cases: 1, run: runMigrate, note: '다시 그리기(세션 스킬 · core/save.js 를 바로 · savelog 없음) · 앞 상태는 test/fixture/kmd/dpms 사본' },
  'kmd-seed': { ch: 'shape', llm: 'session', src: [1, 2, 3], unit: { usd: 2, min: 12, per: '꾸러미' }, cases: 1, run: runSeedPack, note: '짜임 꾸러미(세션 스킬 kmd-seed · claude -p 가 survey · 카드 · 구조안 · 글 초안 · check) → 개인 hub seedSurvey({dir: 꾸러미}) → 연습 판 → 넣기(packed · by pack 길)' },
  'intake-fix': { dead: '걷은 채널: 정정 일감 type 이 없다(hub.openJob 은 file · commit · polish · shape-* 만 · core/worker.js KNOWN_TYPES 에 fix 없음 · INTAKE_CHANNELS 밖 · H-D38). 정정은 edit 의 fixes · session 의 record.fixes 로 잰다' },
  fix: { dead: '걷은 채널: hub.fixRecord 는 늘 E_INPUT(H-D38) · SAVE_CHANNELS 에 fix 없음. 정정은 edit 채널의 fixes 줄로 잰다' },
}
const ORDER = Object.keys(CHANNELS)

// ───────── 작은 것 ─────────
const arg = (name, d = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d }
const flag = (name) => process.argv.includes(`--${name}`)
const readJsonl = (f) => { try { return fss.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch (e) { if (e.code === 'ENOENT') return []; throw e } }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
// 원천 파일 이름의 번호 · 날짜 · 판 조각을 뗀다(가짜 대본이 파일 이름을 문서 · 머리 이름으로 쓸 때만)
const cleanName = (n) => String(n).replace(/^\d+\s+/, '').replace(/\d{4}-\d{2}-\d{2}\s*/g, '').replace(/[_ ]?v\d+(\.\d+)*$/i, '').trim() || '원천'
const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0)
const r4 = (x) => Math.round(x * 10000) / 10000
let GOLD = null
const gold = async () => (GOLD ||= JSON.parse(await fs.readFile(path.join(FIX_DIR, 'gold.json'), 'utf8')))
const srcOf = async (n) => { const s = (await gold()).sources.find((x) => x.n === n); return { ...s, md: await fs.readFile(path.join(FIX_DIR, s.file), 'utf8') } }
const gitCount = (dir) => { try { return Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()) } catch { return 0 } }
const G = (dir, ...a) => execFileSync('git', ['-c', 'user.name=test-eval', '-c', 'user.email=test-eval@example.invalid', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()

async function countsOf(dir, id = KN) {
  try {
    const k = await loadKnowledge({ id, name: id, dir })
    return { docs: k.docs.filter((d) => d.path !== RECORDS_DOC_PATH).length, items: itemsOf(k).length, records: (k.works?.length || 0) + (k.logs?.length || 0) }
  } catch { return null }
}
// 채점 범위 — 이 채널이 넣은 원천(바탕 포함)에 걸린 정답만(gold 에 원천 번호 칸이 없어 원천 글로 가른다):
//   알갱이(facts) · 지금 값(values)은 그 정규식이 넣은 원천 글에 맞는 것 · 대상(targets)은 그 알갱이의 대상이거나 넣은 원천의 머리 줄에 맞는 것.
//   gold 밖 원천(시험이 지은 커밋 · git 저장소 · dpms 사본)은 채점하지 않는다(extra 로 적기만)
const rx = (s, f = 'i') => new RegExp(s, f)
async function goldScope(fed) {
  const g = await gold()
  const ns = [...new Set((fed || []).filter((n) => Number.isInteger(n)))]
  const mds = await Promise.all(ns.map(async (n) => (await srcOf(n)).md))
  const text = mds.join('\n')
  const heads = mds.flatMap((md) => [...md.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1].trim()))
  const facts = g.facts.filter((f) => rx(f.re).test(text))
  const tids = new Set(facts.flatMap((f) => [f.target, f.alt].filter(Boolean)))
  for (const t of g.targets) if (heads.some((h) => rx(t.h).test(h))) tids.add(t.id)
  const values = g.values.filter((v) => rx(v.re).test(text))
  for (const v of values) { tids.add(v.target); if (v.alt) tids.add(v.alt) }
  const targets = g.targets.filter((t) => tids.has(t.id))
  return { gold: { ...g, targets, facts, values }, scope: { srcs: ns, targets: `${targets.length}/${g.targets.length}`, facts: `${facts.length}/${g.facts.length}`, values: `${values.length}/${g.values.length}`, comparable: facts.length >= 2 } }
}
async function scoreOf(dir, id = KN, fed = null) {
  try {
    const k = await loadKnowledge({ id, name: id, dir })
    const { gold: g, scope } = await goldScope(fed)
    if (!scope.srcs.length) return { scope, note: '넣은 골든 원천이 없다: 채점하지 않는다' }
    const s = scoreKnowledge(k, g)
    const nv = g.values.length
    return { scope, f1: scope.comparable ? s.f1 : null, nature: s.nature, dupRate: s.dupRate, missRate: g.targets.length ? s.missRate : null, valueRate: nv ? s.valueRate : null, factPlaced: s.factPlaced, pair: s.pair, injected: s.injected, counts: s.counts, gates: gateOf(s) }
  } catch (e) { return { error: e.message } }
}
const fedOf = (C, extra = []) => [...(C.base || []), ...(C.src || []), ...extra]
const deltaOf = (a, b) => (a && b && !a.error && !b.error ? Object.fromEntries(['f1', 'missRate', 'valueRate', 'dupRate', 'factPlaced'].filter((k) => typeof a[k] === 'number' && typeof b[k] === 'number').map((k) => [k, r4(b[k] - a[k])])) : null)

// ───────── 계측 감싸개 ─────────
//   core/agent.js · core/claude.js 는 KMD_CLAUDE_AGENT · KMD_CLAUDE 가 있으면 `node <그 파일> …인자` 로 띄운다(셸 없이 · 환경은 ENV_ALLOW 만).
//   그래서 감싸개는 안쪽 대상 · 기록 파일을 글에 박아 둔다(환경으로 넘기지 못한다) · 인자 · 표준 입력 · 출력은 손대지 않고 넘긴다.
//   끊기: core/agent.js · core/claude.js 는 감싸개를 「가짜」 로 보고 p.kill() 만 부른다(Windows 는 감싸개 node 만 죽고 처리기가 돌지 않는다).
//   그래서 감싸개는 안쪽을 띄운 뒤 「지킴이」(떨어진 node)를 하나 띄운다: 감싸개가 사라지면 안쪽을 나무째(taskkill /T /F) 끈다.
//   안쪽 pid 는 PIDS 파일에 start · end 줄로 남기고, channel-eval 은 채널마다 끝에 end 없는 안쪽을 거둔다(reapPids).
const WATCH = `const [w, i] = process.argv.slice(1).map(Number); const { spawnSync } = require('node:child_process'); const alive = (p) => { try { process.kill(p, 0); return true } catch (e) { return e.code === 'EPERM' } }; const kill = () => { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(i), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else { try { process.kill(i, 'SIGKILL') } catch {} } }; const t = setInterval(() => { if (!alive(i)) { clearInterval(t); return } if (!alive(w)) { kill(); clearInterval(t) } }, 1000)`
const wrapSrc = (inner, log, kind, pids) => `// channel-eval 계측 감싸개(scripts/channel-eval.mjs 가 지었다 · 손대지 않는다)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
const INNER = ${JSON.stringify(inner)}
const LOG = ${JSON.stringify(log)}
const KIND = ${JSON.stringify(kind)}
const PIDS = ${JSON.stringify(pids)}
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const t0 = Date.now()
const p = spawn(process.execPath, [INNER, ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
const pidLine = (k) => { try { fs.appendFileSync(PIDS, JSON.stringify({ k, run: RUN, wrap: process.pid, inner: p.pid, at: Date.now() }) + '\\n') } catch {} }
if (p.pid) {
  pidLine('start')
  try { spawn(process.execPath, ['-e', ${JSON.stringify(WATCH)}, String(process.pid), String(p.pid)], { detached: true, stdio: 'ignore', windowsHide: true }).unref() } catch {}
}
const killTree = () => { if (!p.pid) return; if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else p.kill('SIGKILL') }
process.stdin.pipe(p.stdin)
p.stdin.on('error', () => {})
p.stdout.setEncoding('utf8')
let buf = ''
const eat = (l) => {
  if (!l.startsWith('{')) return
  let j
  try { j = JSON.parse(l) } catch { return }
  if (j.type !== 'result') return
  const u = j.usage || null
  fs.appendFileSync(LOG, JSON.stringify({ kind: KIND, run: RUN, at: Date.now(), ms: Date.now() - t0, cost: j.total_cost_usd ?? null, turns: j.num_turns ?? null, dur: j.duration_ms ?? null, api: j.duration_api_ms ?? null, err: !!j.is_error, model: j.model || (j.modelUsage ? Object.keys(j.modelUsage).join(',') : null), tokens: u ? { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 } : null }) + '\\n')
}
p.stdout.on('data', (c) => { process.stdout.write(c); buf += c; let i; while ((i = buf.indexOf('\\n')) >= 0) { eat(buf.slice(0, i).trim()); buf = buf.slice(i + 1) } })
p.on('error', (e) => { process.stderr.write(String(e.message)); process.exit(1) })
p.on('close', (code) => { if (buf.trim()) eat(buf.trim()); pidLine('end'); process.exitCode = code ?? 1 })
for (const sig of ['SIGTERM', 'SIGINT', 'SIGBREAK']) process.on(sig, () => { killTree(); process.exit(1) })
`
// end 줄이 없는 안쪽(끊긴 감싸개의 고아)을 나무째 끈다 — 채널마다 끝에(finally)
function reapPids(E) {
  const ls = readJsonl(E.pidsFile)
  const ended = new Set(ls.filter((l) => l.k === 'end').map((l) => l.run))
  const alive = (p) => { try { process.kill(p, 0); return true } catch (e) { return e.code === 'EPERM' } }
  const left = ls.filter((l) => l.k === 'start' && !ended.has(l.run) && !E.reaped.has(l.run))
  const killed = []
  for (const l of left) {
    E.reaped.add(l.run)
    for (const pid of [l.inner, l.wrap]) {
      if (!pid || !alive(pid)) continue
      if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* 이미 끝남 */ } } else { try { process.kill(pid, 'SIGKILL') } catch { /* 이미 끝남 */ } }
      killed.push(pid)
    }
  }
  return killed
}
function claudeCli() {
  const cands = [process.env.CHANNEL_EVAL_CLAUDE_JS, process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')].filter(Boolean)
  return cands.find((f) => fss.existsSync(f)) || null
}
// 가짜 대본 — 세션 가짜(fake-claude-agent)가 FAKE_AGENT_SCRIPT 로 읽는다(사람 MCP 세션 · 대량 넣기: propose → 받은 그대로 승인 → save)
const FAKE_SESSION = `// channel-eval 가짜 대본(사람 MCP 세션 · kmd-team-save 흉내) — 원천.md 의 ## 머리마다 새 문서 항목 · propose → 그 proposal 로 save
const nameOf = (md, d) => ((/^# (.+)$/m.exec(md) || [, d])[1]).replace(/^[0-9]+ +/, '').replace(/[\\\\/:*?"<>|#%]/g, '').replace(/\\d{4}-\\d{2}-\\d{2}\\s*/g, '').replace(/[_ ]?v\\d+(\\.\\d+)*$/i, '').trim().slice(0, 40) || d
const secsOf = (md) => [...md.matchAll(/^## (.+)\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))/gm)].map((m) => ({ heading: m[1].trim(), content: m[2].trim() })).filter((x) => x.content).slice(0, 4)
export async function one({ kn, mcp, md, name, tags = null, attach = null }) {
  const doc = nameOf(md, name)
  const secs = secsOf(md)
  if (!secs.length) return { empty: true }
  const inp = { knowledge: kn, record: { title: doc + ': 남김', changes: secs.map((s) => '새로: ' + s.heading), why: ['시험(가짜 세션)'], touchesEmpty: '시험', ...(tags ? { tags } : {}) }, sections: secs.map((s) => ({ doc, heading: s.heading, content: s.content })), forms: [{ name: doc, kind: '서술' }] }
  for (const x of inp.sections) { const cur = await mcp('section', { knowledge: kn, doc: x.doc, heading: x.heading }); if (cur && !cur.error && cur.base) x.base = cur.base }
  let p = await mcp('propose', inp)
  if (!p || !p.proposal) { const r0 = await mcp('save', { ...inp, kit: 16, ...(attach ? { attach } : {}) }); return r0 && r0.same ? r0 : { error: 'propose', errors: (p && p.errors || []).map((x) => x.code + ' ' + x.why).slice(0, 3), save: r0 } }
  const r = await mcp('save', { ...inp, proposal: p.proposal, kit: 16, ...(attach ? { attach } : {}) })
  return r
}
export default async function ({ kn, files, read, mcp }) {
  await mcp('brief', { knowledge: kn })
  if (files.includes('index.json')) {
    const out = []
    for (const x of JSON.parse(read('index.json'))) out.push(await one({ kn, mcp, md: read(x.mdFile), name: x.rel.replace(/\\.[^.]+$/, ''), tags: x.tags, attach: [{ path: x.attachPath, b64: read(x.b64File) }] }))
    return JSON.stringify(out).slice(0, 500)
  }
  return JSON.stringify(await one({ kn, mcp, md: read('원천.md'), name: '원천' })).slice(0, 500)
}
`

// ───────── 환경 ─────────
async function setupEnv({ tag, fake }) {
  const meterDir = path.join(OUT_DIR, 'meter', tag)
  await fs.mkdir(meterDir, { recursive: true })
  const meterFile = path.join(meterDir, `meter-${Date.now()}.jsonl`)
  const fakeDir = path.join(OUT_DIR, 'fake')
  await fs.mkdir(fakeDir, { recursive: true })
  const cli = fake ? null : claudeCli()
  const innerAgent = fake ? path.join(ROOT, 'test/fixture/fake-claude-agent.mjs') : cli
  const innerClaude = fake ? path.join(ROOT, 'test/fixture/fake-claude.mjs') : cli
  if (!innerAgent) throw new Error('진짜 Claude Code 진입점(cli.js)을 찾지 못했다: CHANNEL_EVAL_CLAUDE_JS 로 준다')
  const agentWrap = path.join(meterDir, 'agent-wrap.mjs')
  const claudeWrap = path.join(meterDir, 'claude-wrap.mjs')
  const pidsFile = meterFile.replace(/\.jsonl$/, '.pids.jsonl')
  await fs.writeFile(agentWrap, wrapSrc(innerAgent, meterFile, 'agent', pidsFile))
  await fs.writeFile(claudeWrap, wrapSrc(innerClaude, meterFile, 'claude', pidsFile))
  const sessionScript = path.join(fakeDir, 'session.mjs')
  await fs.writeFile(sessionScript, FAKE_SESSION)
  // 들이기 가짜 대본 — test/fixture/agent-intake.mjs 그대로 · 새 문서 이름만 원천 파일 이름에서 번호 · 날짜 · 판 조각을 떼어 준다
  //   (골든 원천 파일 이름 「01 게이트웨이 설계서_v0.3」 을 그대로 문서 이름으로 쓰면 저장 검사가 「파일 이름 조각」 으로 거절한다 · 진짜 세션은 이름을 스스로 짓는다)
  const intakeScript = path.join(fakeDir, 'intake.mjs')
  await fs.writeFile(intakeScript, `// channel-eval 가짜 들이기 대본(생성됨) — agent-intake.mjs + 깨끗한 새 문서 이름
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const base = (await import(pathToFileURL(${JSON.stringify(path.join(ROOT, 'test/fixture/agent-intake.mjs'))}).href)).default
const clean = (n) => n.replace(/^\\d+\\s+/, '').replace(/\\d{4}-\\d{2}-\\d{2}\\s*/g, '').replace(/[_ ]?v\\d+(\\.\\d+)*$/i, '').replace(/\\s+\\d{4}-\\d{2}-\\d{2}$/, '').trim() || '원천'
export default async function (o) {
  const m = /바꾼 글: 「([^」]+)」/.exec(o.prompt)
  if (!m) return base(o)
  const orig = m[1]
  const ext = path.extname(orig)
  const nn = clean(orig.slice(0, orig.length - ext.length)) + ext
  return base({ ...o, prompt: o.prompt.replace(m[0], '바꾼 글: 「' + nn + '」'), read: (f) => o.read(f === nn ? orig : f) })
}
`)
  // 사람 집 폴더 — 가짜면 이 실행 폴더로 돌린다(시험과 같다 · 열쇠 파일 · 사용자 설정을 건드리지 않는다).
  //   진짜면 Claude Code 로그인이 사람 집에 있으므로 돌리지 않는다: 대신 KMD_NO_CLAUDE=1(Claude 설정 등록 안 함) · 개인 프로그램 자리 파일을 이 실행 폴더로
  const home = path.join(OUT_DIR, 'kn', tag, '_home')
  await fs.mkdir(home, { recursive: true })
  if (fake) process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = home
  process.env.KMD_PC_ROOT_FILE = path.join(home, '.kmd-pc.json')
  process.env.KMD_APP_HOME = path.join(home, '.kmd-app')
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE_AGENT = agentWrap
  process.env.KMD_CLAUDE = claudeWrap
  for (const k of ['FAKE_AGENT_SCRIPT', 'FAKE_AGENT_MODE', 'FAKE_CLAUDE_MODE', 'FAKE_AGENT_LOG', 'FAKE_CLAUDE_LOG', 'FAKE_AGENT_WAIT_MS', 'FAKE_CLAUDE_READ']) delete process.env[k]
  // 걸린 것을 먼저 확인한다(가짜 판에서 진짜를 부르지 않게)
  const innerOf = (f) => JSON.parse(/const INNER = (.+)/.exec(fss.readFileSync(f, 'utf8'))[1])
  const got = { agent: innerOf(process.env.KMD_CLAUDE_AGENT), claude: innerOf(process.env.KMD_CLAUDE) }
  if (fake && (!/fake-claude-agent\.mjs$/.test(got.agent) || !/fake-claude\.mjs$/.test(got.claude))) throw new Error(`가짜가 걸리지 않았다: ${JSON.stringify(got)}`)
  if (!fake && (/fake/.test(got.agent) || /fake/.test(got.claude))) throw new Error(`진짜 판에 가짜가 걸렸다: ${JSON.stringify(got)}`)
  return { meterFile, pidsFile, reaped: new Set(), sessionScript, intakeScript, agentInner: got.agent, claudeInner: got.claude, home, cli }
}

// ───────── 임시 팀 서버 ─────────
async function team(E, name, { fresh = true, serve = {}, before = null } = {}) {
  const root = path.join(E.knDir, name)
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await fs.mkdir(path.join(root, '.kmd'), { recursive: true })
  if (fresh) await freshKn(path.join(root, KN), KN)
  await fs.writeFile(path.join(root, '.kmd', 'serve.json'), JSON.stringify({ ...SERVE, ...serve }))
  if (before) await before(root)
  const { startServer } = await import('../server/http.js')
  const { signIn } = await import('../test/helpers.mjs')
  const s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  const wk = (await s.auth.workerAdd()).key
  const me = await signIn(s, { id: USER, admin: true })
  const t = {
    s, root, wk, me, kn: KN, dir: path.join(root, KN), ADMIN: { user: USER, admin: true },
    savelogFile: (id = t.kn) => path.join(root, '.kmd', 'savelog', `${encodeURIComponent(id)}.jsonl`),
    savelog: (id = t.kn) => readJsonl(t.savelogFile(id)),
    close: () => s.close(),
  }
  return t
}
// 일감 하나를 끝까지(다시 시도 간격 1ms · 일꾼을 되풀이) — 그 일감이 queued · running 이 아닐 때까지 · 최대 다섯 번
//   일꾼 로그 · 이 일감 동안의 savelog 줄로 고쳐 받기 · 실패를 센다:
//   세션 들이기 — savelog fix 칸은 그 세션의 누적값이라 이 일감 구간의 최댓값 · 실패는 fail 칸이 있는 줄(intakeRetry · 일감을 태운 실패)만 ·
//                 err 'unattended' 이면서 fail 이 없는 줄은 고쳐 받기 시도(fixTries)
//   스키마 일감(polish · shape-*) — 일꾼 로그의 「검사에 걸렸다 · 고쳐 쓴다」 가 고쳐 받기 · 「초안을 받지 못했다」 가 실패한 부름
async function workJob(E, t, jid, logs = []) {
  const { workOnce } = await import('../core/worker.js')
  const t0 = Date.now()
  const sl0 = t.savelog ? t.savelog().length : 0
  const lg0 = logs.length
  let loops = 0
  let r = null
  for (; loops < E.loops; loops++) {
    if (E.over) break
    r = await workOnce({ server: t.s.url, key: t.wk, log: (x) => logs.push(String(x)), models: E.models })
    const j = t.s.hub.job(jid)
    if (!r || r.stop || !j || !['queued', 'running', 'closing'].includes(j.state)) { loops++; break }
    await sleep(5)
  }
  const sl = t.savelog ? t.savelog().slice(sl0) : []
  const lg = logs.slice(lg0)
  return { ms: Date.now() - t0, loops, stop: r?.stop || null, got: !!r, ...fixOf(sl, lg) }
}
function fixOf(sl, lg = []) {
  const sessionFix = Math.max(0, ...sl.map((l) => Number(l.fix) || 0))
  const schemaFix = lg.filter((x) => /검사에 걸렸다 · 고쳐 쓴다/.test(x)).length
  const failLines = sl.filter((l) => l.fail)
  return { fix: sessionFix + schemaFix, fixTries: sl.filter((l) => l.err === 'unattended' && !l.fail).length, failJobs: failLines.length, failCodes: failLines.map((l) => l.fail.code), failCalls: lg.filter((x) => /초안을 받지 못했다\(/.test(x)).length }
}
const jobRow = (t, jid, w) => {
  const j = t.s.hub.job(jid) || {}
  const res = j.result || {}
  return {
    job: jid, state: j.state, ms: w.ms, workerLoops: w.loops, cost: j.cost || 0, calls: j.calls || 0, tries: j.tries ?? null,
    fix: w.fix || 0, fixTries: w.fixTries || 0, fails: w.failJobs || 0, failCalls: w.failCalls || 0,
    put: j.state === 'done' && !res.aborted && !res.empty, empty: !!res.empty, ...(res.put != null ? { putItems: res.put } : {}),
    ...(j.why ? { why: [String(j.why).slice(0, 300)] } : {}), ...(w.stop ? { stop: w.stop } : {}), codes: [...(!w.got ? ['NO_JOB'] : []), ...(w.failCodes || []), ...(w.failCalls ? ['SCHEMA_FAIL'] : [])],
  }
}
// 무인 들이기로 바탕 세우기(채널 intake-src · 비용은 base 줄로 따로)
async function baseIntake(E, t, ns, channel) {
  const { sha16 } = await import('../core/text.js')
  const rows = []
  for (const n of ns) {
    const s = await srcOf(n)
    rows.push(await measure(E, t, { channel, step: '바탕(무인 들이기)', base: true, n, file: s.file, expectCh: 'intake-src' }, async () => {
      const o = await t.s.hub.openJob(t.kn, { type: s.type, by: 'kmd', auto: true, src: s.type === 'commit' ? { src: '게이트웨이', commit: 'a1b2c3d4e5f60718', title: s.title, touches: [] } : { rel: s.file, file: s.file, title: s.title, sha: sha16(s.md) }, md: s.md })
      if (o.state !== 'queued') throw Object.assign(new Error(`일감을 열지 못했다: ${JSON.stringify(o).slice(0, 200)}`), { code: 'OPEN' })
      return jobRow(t, o.job, await workJob(E, t, o.job))
    }))
  }
  return rows
}
// 바탕이 있는 채널 — 바탕 뒤 · 끝 점수를 같은 범위(바탕 + 원천)로 매겨 차이를 남긴다
async function scored(out, dir, id, fed, before) {
  const score = await scoreOf(dir, id, fed)
  return { ...out, ...(before ? { scoreBefore: before, delta: deltaOf(before, score) } : {}), score }
}

// ───────── 재기 ─────────
//   fn(row) 이 돌려준 칸을 row 에 얹고 · 앞뒤 savelog · 계측 줄 · 지식 수를 끊어 읽는다
async function measure(E, t, meta, fn) {
  const slFile = t?.savelogFile ? t.savelogFile() : null
  const sl0 = slFile ? readJsonl(slFile).length : 0
  const m0 = readJsonl(E.meterFile).length
  const dir = meta.dir || t?.dir
  const kid = meta.kid || t?.kn || KN
  const c0 = dir ? await countsOf(dir, kid) : null
  const row = { channel: meta.channel, step: meta.step, base: !!meta.base, n: meta.n ?? null, file: meta.file ?? null, expectCh: meta.expectCh ?? null, ran: true, ms: 0, cost: 0, calls: 0, turns: null, tokens: null, fix: null, fixTries: 0, fails: 0, put: false, empty: false, codes: [], why: [] }
  // 지출 상한(--max-usd) — 넘었으면 이 건부터 돌리지 않는다
  if (E.over) { row.ran = false; row.codes.push('BUDGET'); row.why.push(`예산 넘음(계측 누계 $${E.spent().toFixed(3)} > $${E.maxUsd})`); return row }
  const t0 = Date.now()
  try {
    const got = (await fn(row)) || {}
    for (const [k, v] of Object.entries(got)) {
      if (k === 'codes' || k === 'why') row[k].push(...v)
      else row[k] = v
    }
  } catch (e) {
    row.codes.push(e.code || 'THROW')
    row.why.push(String(e.message || e).slice(0, 400))
  }
  if (!row.ms) row.ms = Date.now() - t0
  row.wallMs = Date.now() - t0
  // savelog — 이 건이 쓴 줄(저장 제안 줄 stage:'propose' · 비용 줄 stage:'cost'(P12) 은 채널 판정에서 뺀다 · 비용 줄은 cost 에만 더한다)
  const sl = slFile ? readJsonl(slFile).slice(sl0) : []
  const saves = sl.filter((l) => l.stage !== 'propose' && l.stage !== 'cost')
  const costLines = sl.filter((l) => l.stage === 'cost')
  const fx = fixOf(saves)
  row.savelog = {
    lines: sl.length, saves: saves.length, proposeLines: sl.length - saves.length - costLines.length, costLines: costLines.length,
    put: sum(saves.map((l) => l.put)), n: sum(saves.map((l) => l.n)), fixMax: Math.max(0, ...saves.map((l) => Number(l.fix) || 0)), fixTries: fx.fixTries,
    err: saves.map((l) => l.err).filter(Boolean), warned: [...new Set(saves.flatMap((l) => l.warned || []))], accepted: sum(saves.map((l) => (Array.isArray(l.accepted) ? l.accepted.length : l.accepted))),
    rounds: Math.max(0, ...saves.map((l) => Number(l.rounds) || 0)), fail: saves.map((l) => l.fail).filter(Boolean), dup: saves.filter((l) => l.dup).length,
    ms: sum(saves.map((l) => l.ms)), cost: r4(sum([...saves, ...costLines].map((l) => l.cost?.usd))), kit: [...new Set(saves.map((l) => l.kit).filter((x) => x != null))],
  }
  row.warned = row.savelog.warned.length
  row.accepted = row.savelog.accepted
  row.ch = [...new Set(saves.map((l) => l.ch))]
  // 사람 세션(session · bulk)은 세션이 MCP 로 저장한다: 들어감은 이 건의 저장 줄 가운데 걸리지 않고 넣은 줄이 있을 때
  if (row.putFromSavelog) { row.put = saves.some((l) => !l.err && Number(l.put) > 0) && !saves.some((l) => l.err && l.err !== 'unattended'); delete row.putFromSavelog }
  // 고쳐 받기 — fn(일감 줄)이 셈한 것이 먼저 · 없으면 이 건 구간의 savelog 최댓값(누적값이라 더하지 않는다)
  if (row.fix == null) row.fix = fx.fix
  if (!row.fixTries) row.fixTries = fx.fixTries
  // 실패 — fail 칸이 있는 줄(일감을 태운 실패)만 · 고쳐 받기 중간에 걸린 줄(err unattended · fail 없음)은 실패가 아니다
  if (!row.fails) row.fails = fx.failJobs
  for (const c of fx.failCodes) if (!row.codes.includes(c)) row.codes.push(c)
  for (const e of row.savelog.err) if (e !== 'unattended' && !row.codes.includes(e)) row.codes.push(e)
  // 계측 줄(Claude Code result) — 비용 · 부름의 기준(감싸개는 다시 띄운 것 · 스키마 일감의 실패한 부름까지 잡는다).
  //   j.cost · r.cost 는 serverCost · serverCalls 로 따로 남기고 계측과 $0.001 넘게 다르면 costGap.
  //   한 프로세스(run)에 result 가 여럿이면(stream-json 입력 세션의 턴마다) 칸 모두 마지막 result 를 쓴다(쌓이는 값으로 본다 · 확인 못 함: 결과의 tokensRule)
  const ml = readJsonl(E.meterFile).slice(m0)
  row.serverCost = r4(row.cost || 0)
  row.serverCalls = row.calls || 0
  if (ml.length) {
    const runs = new Map()
    for (const l of ml) runs.set(l.run, [...(runs.get(l.run) || []), l])
    const lasts = [...runs.values()].map((ls) => ls[ls.length - 1])
    const tk = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    let anyTk = false
    for (const l of lasts) if (l.tokens) { anyTk = true; for (const k of Object.keys(tk)) tk[k] += l.tokens[k] || 0 }
    const multi = [...runs.values()].filter((ls) => ls.length > 1)
    row.meter = { procs: runs.size, results: ml.length, multiResultProcs: multi.length, cost: r4(sum(lasts.map((l) => l.cost))), turns: sum(lasts.map((l) => l.turns)), apiMs: sum(lasts.map((l) => l.api)), errors: lasts.filter((l) => l.err).length, models: [...new Set(ml.map((l) => l.model).filter(Boolean))], tokens: anyTk ? tk : null }
    if (multi.length) row.meter.multiSample = multi.slice(0, 2).map((ls) => ls.map((l) => ({ cost: l.cost, turns: l.turns, tokens: l.tokens })))
    row.cost = row.meter.cost
    row.calls = row.meter.procs
    row.turns = row.meter.turns
    row.tokens = row.meter.tokens
    if (Math.abs(row.meter.cost - row.serverCost) > 0.001) row.costGap = r4(row.meter.cost - row.serverCost)
  }
  row.cost = r4(row.cost || 0)
  if (dir && c0) {
    const c1 = await countsOf(dir, kid)
    if (c1) row.added = { docs: c1.docs - c0.docs, items: c1.items - c0.items, records: c1.records - c0.records }
  }
  // 채널 판정 — 저장 줄이 모두 그 채널인가 · 들어갔는데(put 또는 문서 · 항목 · 기록이 늘었다) 저장 줄이 하나도 없으면 저장 문을 거치지 않은 것(nolog → 어긋남)
  const wrote = row.put || (row.added && (row.added.docs > 0 || row.added.items > 0 || row.added.records > 0))
  if (row.expectCh) {
    if (saves.length) row.channelOk = saves.every((l) => l.ch === row.expectCh)
    else if (wrote) { row.channelOk = false; row.nolog = true; row.codes.push('NOLOG') }
    else row.channelOk = null
  } else row.channelOk = null
  const tail = row.why.length ? ` · ${row.why[row.why.length - 1].slice(0, 90)}` : ''
  console.log(`  [${row.channel}${row.base ? ' 바탕' : ''}] ${row.step}${row.file ? ` · ${row.file}` : ''}: ${row.put ? '들어감' : row.empty ? '넣을 것 없음' : '안 들어감'} · ${Math.round(row.ms / 100) / 10}초 · $${row.cost.toFixed(3)} · 부름 ${row.calls} · 고쳐 받기 ${row.fix} · 실패 ${row.fails} · ch ${row.ch.join(',') || '-'}${row.channelOk === false ? ' (어긋남!)' : ''}${row.codes.length ? ` · ${row.codes.join(',')}` : ''}${row.added ? ` · 문서 +${row.added.docs} 항목 +${row.added.items} 기록 +${row.added.records}` : ''}${tail}`)
  if (!E.fake && E.spent() > E.maxUsd) { E.over = true; console.log(`  ! 예산 넘음: 계측 누계 $${E.spent().toFixed(3)} > $${E.maxUsd} · 남은 건 · 채널은 돌리지 않는다`) }
  return row
}

// ───────── 채널마다 ─────────
// 골든 md → docx(머리 줄 → 제목 스타일) — 원본 첨부(bin)가 있는 올리기 · 대량 넣기의 사무 파일 원본
async function docxOf(md) {
  const { storedZip } = await import('../test/fixture/officefiles.mjs')
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return storedZip([['word/document.xml', `<?xml version="1.0"?><w:document><w:body>${md.split('\n').filter((l) => l.trim()).map((l) => { const h = /^(#{1,3}) (.+)$/.exec(l); return `<w:p>${h ? `<w:pPr><w:pStyle w:val="Heading${h[1].length}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(h ? h[2] : l)}</w:t></w:r></w:p>` }).join('')}</w:body></w:document>`]])
}
// 화면 올리기 하나 — importFiles → 팀 일꾼 세션 → 승인 대기 → 승인(intakeAskApprove)
const uploadAndApprove = (E, t, file, data) => openThenApprove(E, t, () => t.s.hub.importFiles(t.ADMIN, t.kn, [{ path: file, data }]))
async function openThenApprove(E, t, open) {
  const before = new Set(t.s.hub.intakesOf(t.kn).map((j) => j.id))
  const r = await open()
  const j0 = t.s.hub.intakesOf(t.kn).find((j) => j.state === 'queued' && !before.has(j.id))
  if (!j0) throw Object.assign(new Error(`일감이 서지 않았다: ${JSON.stringify(r).slice(0, 200)}`), { code: 'OPEN' })
  const g0 = gitCount(t.dir)
  const w = await workJob(E, t, j0.id)
  const j1 = t.s.hub.job(j0.id) || {}
  const out = { ...jobRow(t, j0.id, w), ask: j1.ask === true, askState: j1.state, bin: !!j1.src?.attach, wroteBeforeApprove: gitCount(t.dir) !== g0 }
  if (j1.state === 'ask') {
    const ta = Date.now()
    const ap = await t.s.hub.intakeAskApprove(t.ADMIN, t.kn, j0.id)
    out.approveMs = Date.now() - ta
    out.approve = { rec: ap?.rec || null, again: !!ap?.again }
    const j2 = t.s.hub.job(j0.id)
    out.state = j2?.state || 'gone'
    out.put = !!ap?.rec
    out.cost = j2?.cost || out.cost
    out.calls = j2?.calls || out.calls
    if (out.put) delete out.why
  } else if (j1.state === 'done') out.put = false // 승인 대기 없이 끝났다(넣을 것 없음 · 같은 것)
  return out
}
async function runIntakeFile(E, C) {
  const t = await team(E, 'intake-file')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    const [a, b] = await Promise.all(C.src.map(srcOf))
    rows.push(await measure(E, t, { channel: 'intake-file', step: '화면 올리기 docx(원본 첨부) → 승인 대기 → 승인', n: a.n, file: a.file.replace(/\.md$/, '.docx'), expectCh: 'intake-file' }, async () => uploadAndApprove(E, t, a.file.replace(/\.md$/, '.docx'), await docxOf(a.md))))
    if (b) rows.push(await measure(E, t, { channel: 'intake-file', step: '화면 올리기 md → 승인 대기 → 승인', n: b.n, file: b.file, expectCh: 'intake-file' }, async () => uploadAndApprove(E, t, b.file, Buffer.from(b.md))))
    return { rows, dirs: { root: t.root, kn: t.dir }, score: await scoreOf(t.dir, KN, fedOf(C)) }
  } finally { await t.close() }
}

async function runIntakeCommit(E, C) {
  const t = await team(E, 'intake-commit')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base, 'intake-commit')))
    const fed = fedOf(C)
    const before = await scoreOf(t.dir, KN, fed)
    const s = await srcOf(C.src[0])
    // 07 은 값을 바꾸는 커밋이다(바탕 01 「전송 주기 5초」 → 10초 · retry_backoff_sec 2 새로) — 기대: 들어감.
    //   가짜 대본(agent-intake.mjs)은 「바뀐 값: a → b」 한 줄 꼴만 읽어 07 의 목록 꼴을 놓친다(문서와 상관없는 커밋으로 빠짐 · 가짜 한계)
    rows.push(await measure(E, t, { channel: 'intake-commit', step: '사람이 연 커밋 일감(시험이 직접 연다 · 07 값 5→10)', n: s.n, file: s.file, expectCh: 'intake-commit' }, async () => {
      const o = await t.s.hub.openJob(t.kn, { type: 'commit', by: USER, src: { src: '게이트웨이', commit: 'a1b2c3d4e5f60718', title: s.title, touches: [] }, md: s.md })
      if (o.state !== 'queued') throw Object.assign(new Error(`일감을 열지 못했다: ${JSON.stringify(o).slice(0, 200)}`), { code: 'OPEN' })
      const out = jobRow(t, o.job, await workJob(E, t, o.job))
      return { ...out, expectPut: true, ...(E.fake && !out.put ? { fakeLimit: '가짜 대본이 07 의 목록 꼴 「바뀐 값」 을 읽지 못한다' } : {}) }
    }))
    // 값이 바뀐 커밋(시험이 지은 원천 · gold 밖이라 채점하지 않는다) — 07 다음 값을 바꾼다(10초 → 15초).
    //   가짜 판은 07 이 들어가지 않아 지식 값이 5초 그대로라 5초 → 15초로 지어 값 바꿈 길을 탄다
    const from = E.fake && !rows[rows.length - 1].put ? 5 : 10
    const md2 = ['commit b2c3d4e5f6071829', 'Author: test-eval', 'Date: 2026-11-15 10:00', '', `    collector: 전송 주기 ${from}초 → 15초`, '', `바뀐 값: ${from}초 → 15초`, '', 'diff --git a/collector/collector.conf b/collector/collector.conf', `-send_interval_sec = ${from}`, '+send_interval_sec = 15', ''].join('\n')
    rows.push(await measure(E, t, { channel: 'intake-commit', step: `값이 바뀐 커밋(시험이 지은 원천 · ${from}초 → 15초)`, file: 'test-커밋 b2c3d4e', expectCh: 'intake-commit' }, async () => {
      const o = await t.s.hub.openJob(t.kn, { type: 'commit', by: USER, src: { src: '게이트웨이', commit: 'b2c3d4e5f6071829', title: `collector: 전송 주기 ${from}초 → 15초`, touches: [] }, md: md2 })
      if (o.state !== 'queued') throw Object.assign(new Error(`일감을 열지 못했다: ${JSON.stringify(o).slice(0, 200)}`), { code: 'OPEN' })
      return { ...jobRow(t, o.job, await workJob(E, t, o.job)), expectPut: true }
    }))
    return scored({ rows, dirs: { root: t.root, kn: t.dir } }, t.dir, KN, fed, before)
  } finally { await t.close() }
}

async function runIntakeSrc(E, C) {
  let srcDir, repo
  const t = await team(E, 'intake-src', {
    serve: { sourceRoots: [] },
    before: async (root) => {
      srcDir = path.join(root, 'src', '평가')
      repo = path.join(root, 'src', 'repo')
      await fs.mkdir(srcDir, { recursive: true })
      await fs.mkdir(repo, { recursive: true })
      const sj = path.join(root, '.kmd', 'serve.json')
      await fs.writeFile(sj, JSON.stringify({ ...JSON.parse(await fs.readFile(sj, 'utf8')), sourceRoots: [path.join(root, 'src')] }))
    },
  })
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    const srcs = await Promise.all(C.src.map(srcOf))
    const runQueued = async (row) => {
      const q = t.s.hub.intakesOf(t.kn).filter((j) => j.state === 'queued')
      let ms = 0, cost = 0, calls = 0, put = 0, empty = 0, fix = 0, fixTries = 0, fails = 0
      const why = []
      const codes = []
      for (const j of q) {
        const w = await workJob(E, t, j.id)
        const r = jobRow(t, j.id, w)
        ms += r.ms; cost += r.cost; calls += r.calls; put += r.put ? 1 : 0; empty += r.empty ? 1 : 0; fix += r.fix; fixTries += r.fixTries; fails += r.fails
        if (r.why) why.push(...r.why)
        codes.push(...r.codes)
      }
      return { jobs: q.length, ms, cost, calls, fix, fixTries, fails, put: q.length > 0 && put === q.length, empty: q.length > 0 && empty === q.length, why, codes }
    }
    // 문서 폴더 — 하나씩(같이 온 것이 붙지 않게) · 첫 원천을 둔 뒤 가져올 곳을 세운다(첫 실행)
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i]
      rows.push(await measure(E, t, { channel: 'intake-src', step: i ? '문서 폴더 다시 돌림(새 파일)' : '문서 폴더 첫 실행', n: s.n, file: s.file, expectCh: 'intake-src' }, async () => {
        await fs.writeFile(path.join(srcDir, s.file), s.md)
        const ts = Date.now()
        const r = i ? { run: await t.s.hub.sourceRun(t.kn, '평가') } : await t.s.hub.sourceAdd(t.ADMIN, t.kn, { name: '평가', kind: 'docs', at: srcDir, rules: [{ rule: 'docs', into: { doc: '평가' } }] })
        const srcMs = Date.now() - ts
        const run0 = (r.run || [])[0] || {}
        const out = await runQueued()
        return { ...out, srcMs, srcState: run0.state, queued: run0.queued ?? null }
      }))
    }
    rows.push(await measure(E, t, { channel: 'intake-src', step: '문서 폴더 같은 것 다시(same · 일감 0 이어야)', expectCh: 'intake-src' }, async () => {
      const r = (await t.s.hub.sourceRun(t.kn, '평가'))[0] || {}
      const q = t.s.hub.intakesOf(t.kn).filter((j) => j.state === 'queued').length
      return { srcState: r.state, queued: q, put: false, empty: true, sameOk: r.state === 'same' && q === 0 }
    }))
    // git — 첫 실행은 기준 묶음만(일감 0) · 커밋 하나 → 일감 하나
    rows.push(await measure(E, t, { channel: 'intake-src', step: 'git 커밋 하나', file: 'HealthCheck.java(시험 저장소)', expectCh: 'intake-src' }, async () => {
      await fs.writeFile(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 3초\nclass HealthCheck {\n  int timeoutSec = 3;\n}\n')
      G(repo, 'init', '-q', '-b', 'main'); G(repo, 'add', '-A'); G(repo, 'commit', '-q', '-m', '처음')
      const r0 = await t.s.hub.sourceAdd(t.ADMIN, t.kn, { name: '코드', kind: 'git', at: repo, every: 'manual' })
      await fs.writeFile(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 5초\nclass HealthCheck {\n  int timeoutSec = 5;\n}\n')
      G(repo, 'commit', '-q', '-am', '헬스 체크 시간 초과를 늘림')
      const ts = Date.now()
      const r1 = (await t.s.hub.sourceRun(t.kn, '코드'))[0] || {}
      const srcMs = Date.now() - ts
      const out = await runQueued()
      return { ...out, srcMs, firstCodeRecords: r0.run?.[0]?.codeRecords ?? null, codeRecords: r1.codeRecords ?? null, queued: r1.queued ?? null }
    }))
    return { rows, dirs: { root: t.root, kn: t.dir }, score: await scoreOf(t.dir, KN, fedOf(C)), scoreNote: 'git 커밋(HealthCheck.java)은 gold 밖이라 채점하지 않는다' }
  } finally { await t.close() }
}

async function runPolish(E, C) {
  const t = await team(E, 'polish')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base, 'polish')))
    const before = await scoreOf(t.dir, KN, fedOf(C))
    t.s.hub.forget?.(t.kn)
    const k = await t.s.hub.get(t.kn, t.ADMIN)
    const docs = k.docs.filter((d) => d.path !== RECORDS_DOC_PATH && d.sections.filter((x) => x.h).length >= 2).sort((a, b) => b.sections.length - a.sections.length).slice(0, C.docs)
    if (!docs.length) rows.push(await measure(E, t, { channel: 'polish', step: '다듬을 문서 없음', expectCh: 'polish' }, async () => ({ ran: false, why: ['바탕에 ## 항목 둘 이상인 문서가 없다'] })))
    for (const d of docs) {
      const secs = d.sections.filter((x) => x.h)
      rows.push(await measure(E, t, { channel: 'polish', step: `다듬기 ${d.id}`, file: d.path, expectCh: 'polish' }, async () => {
        const r = await t.s.hub.polish(t.ADMIN, t.kn, { doc: d.id })
        const out = jobRow(t, r.job, await workJob(E, t, r.job))
        return { ...out, sent: secs.length, putRate: out.putItems != null ? r4(out.putItems / secs.length) : null }
      }))
    }
    return scored({ rows, dirs: { root: t.root, kn: t.dir } }, t.dir, KN, fedOf(C), before)
  } finally { await t.close() }
}

// 팀 기초 세우기 — 빈 지식을 새로 세우고 원천을 올린다
async function seedOpen(E, t, name, C) {
  const r = await t.s.hub.addKnowledge(t.ADMIN, { kind: 'new', name, empty: true })
  const id = r.id
  const srcs = await Promise.all(C.src.map(srcOf))
  const files = srcs.map((s) => ({ path: s.file, b64: Buffer.from(s.md, 'utf8').toString('base64') }))
  const up = await t.s.hub.seedUpload(t.ADMIN, id, { group: { total: files.length, last: true }, files })
  return { id, up, srcs }
}
const settleSeed = async (hub, ctx, id, n = 3000) => {
  for (let i = 0; i < n; i++) { const v = await hub.seedView(ctx, id); if (!v.run || v.run.state !== 'running') return v; await sleep(100) }
  throw Object.assign(new Error('도는 일이 끝나지 않았다'), { code: 'TIMEOUT' })
}
async function runShapeTeam(E, C) {
  const t = await team(E, 'shape', { fresh: false })
  const rows = []
  const { workOnce } = await import('../core/worker.js')
  const work = (logs) => workOnce({ server: t.s.url, key: t.wk, log: (x) => logs.push(String(x)), models: E.models })
  let id = null
  try {
    const o = await seedOpen(E, t, 'test-기초세우기', C)
    id = o.id
    t.kn = id
    const dir = path.join(t.root, id)
    const jobsOf = (type) => t.s.hub.intakesOf(id).filter((j) => j.type === type)
    // 고쳐 받기 · 실패한 부름 — 일꾼 로그로(calls 에는 실패한 부름도 들어 calls-1 로는 둘이 섞인다)
    const lf = (logs) => { const x = fixOf([], logs); return { fix: x.fix, fails: x.failCalls, failCalls: x.failCalls, ...(x.failCalls ? { codes: ['SCHEMA_FAIL'] } : {}) } }
    const jobSum = (js) => ({ cost: r4(sum(js.map((j) => j.cost))), calls: sum(js.map((j) => j.calls)), tries: sum(js.map((j) => j.tries)) })
    rows.push(await measure(E, t, { channel: 'shape', step: '조사(올린 묶음)', dir, kid: id, file: o.srcs.map((s) => s.n).join(','), expectCh: 'shape' }, async () => {
      await t.s.hub.seedSurvey(t.ADMIN, id, { group: o.up.group })
      const v = await settleSeed(t.s.hub, t.ADMIN, id)
      return { rows: (v.work?.rows || []).map((r) => `${r.path}:${r.role || ''}:${r.pick}`), put: false }
    }))
    await work([]) // 일꾼이 아는 type(shape-seed)을 알린다(일감 없음)
    rows.push(await measure(E, t, { channel: 'shape', step: '구조안(shape-plan · Claude)', dir, kid: id, expectCh: 'shape' }, async () => {
      const logs = []
      const pl = await t.s.hub.seedPlan(t.ADMIN, id, { mode: 'claude' })
      const t0 = Date.now()
      for (let i = 0; i < 6 && !E.over && (await work(logs)); i++);
      const v = await t.s.hub.seedView(t.ADMIN, id)
      const js = jobSum(jobsOf('shape-plan'))
      return { ms: Date.now() - t0, ...js, ...lf(logs), started: !!pl.started, runState: v.run?.state, check: v.work?.check ? { ok: v.work.check.ok, errors: (v.work.check.errors || []).slice(0, 5) } : null, docs: (v.work?.plan?.docs || []).map((d) => `${d.id}(${(d.items || []).length})`), put: false, ...(v.work?.check?.ok ? {} : { codes: ['PLAN_CHECK'] }) }
    }))
    let v = await t.s.hub.seedView(t.ADMIN, id)
    const docIds = (v.work?.plan?.docs || []).map((d) => d.id)
    if (v.work?.check?.ok && docIds.length) {
      rows.push(await measure(E, t, { channel: 'shape', step: `글 짓기(shape-write · 문서 ${docIds.length})`, dir, kid: id, expectCh: 'shape' }, async () => {
        const logs = []
        const t0 = Date.now()
        await t.s.hub.seedWrite(t.ADMIN, id, { doc: docIds[0] })
        for (let i = 0; i < 6 && !E.over && (await work(logs)); i++);
        await t.s.hub.seedWrite(t.ADMIN, id, { approve: docIds[0] })
        if (docIds.length > 1) {
          await t.s.hub.seedWrite(t.ADMIN, id, { all: true })
          for (let i = 0; i < docIds.length * 4 && !E.over && (await work(logs)); i++);
          for (const d of docIds.slice(1)) await t.s.hub.seedWrite(t.ADMIN, id, { approve: d }).catch(() => null)
        }
        const v2 = await t.s.hub.seedView(t.ADMIN, id)
        const js = jobSum(jobsOf('shape-write'))
        const ds = v2.work?.docs || []
        return { ms: Date.now() - t0, ...js, ...lf(logs), docState: ds.map((d) => `${d.id}:${d.state}${d.values?.length ? `:값경고${d.values.length}` : ''}`), valueWarn: sum(ds.map((d) => d.values?.length || 0)), put: false }
      }))
      rows.push(await measure(E, t, { channel: 'shape', step: '연습 판 → 넣기(짜임 걸음)', dir, kid: id, expectCh: 'shape' }, async () => {
        const tr = await t.s.hub.seedTry(t.ADMIN, id)
        if (!tr.ok) return { put: false, codes: ['TRY'], diag: tr.diag, why: [`연습 판 막힘: ${JSON.stringify(tr.diag?.blockers || []).slice(0, 300)}`] }
        const p = await t.s.hub.shapePut(t.ADMIN, id)
        return { put: !!p.done, steps: p.steps ?? null, ...(p.done ? {} : { codes: ['PUT'], why: [JSON.stringify(p).slice(0, 300)] }) }
      }))
    } else rows.push({ channel: 'shape', step: '글 짓기 · 넣기', ran: false, why: ['구조안 검사를 넘지 못해 짓지 않았다'], codes: ['PLAN_CHECK'] })
    return { rows, dirs: { root: t.root, kn: path.join(t.root, id) }, score: await scoreOf(path.join(t.root, id), id, fedOf(C)) }
  } finally { await t.close() }
}
async function runShapeFolder(E, C) {
  const t = await team(E, 'shape-folder', { fresh: false })
  const rows = []
  try {
    const o = await seedOpen(E, t, 'test-폴더그대로', C)
    t.kn = o.id
    const dir = path.join(t.root, o.id)
    rows.push(await measure(E, t, { channel: 'shape-folder', step: '폴더 그대로(조사 → 구조안 → 연습 판 → 넣기)', dir, kid: o.id, file: o.srcs.map((s) => s.n).join(','), expectCh: 'shape' }, async () => {
      const out = await t.s.hub.seedAsIs(t.ADMIN, o.id, { group: o.up.group })
      return { put: !!out.done, ...(out.done ? {} : { codes: ['PUT'], why: [JSON.stringify(out).slice(0, 300)] }) }
    }))
    return { rows, dirs: { root: t.root, kn: dir }, score: await scoreOf(dir, o.id, fedOf(C)) }
  } finally { await t.close() }
}
async function runShapePc(E, C) {
  const { makeHub } = await import('../server/hub.js')
  const base = path.join(E.knDir, 'shape-pc')
  await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  const root = path.join(base, 'kn')
  const dataDir = path.join(base, 'data')
  const srcDir = path.join(base, 'src')
  for (const d of [root, dataDir, srcDir]) await fs.mkdir(d, { recursive: true })
  const srcs = await Promise.all(C.src.map(srcOf))
  for (const s of srcs) await fs.writeFile(path.join(srcDir, E.fake ? `${cleanName(s.file.replace(/\.md$/, ''))}.md` : s.file), s.md)
  const hub = await makeHub({ root, dataDir, mode: 'pc', pcUser: USER, log: () => {} })
  const ctx = { user: USER, pc: true }
  const id = (await hub.addKnowledge(ctx, { kind: 'new', name: 'test-개인기초', empty: true, backup: false })).id
  const dir = path.join(root, id)
  const t = { kn: id, dir, savelogFile: () => path.join(dataDir, 'savelog', `${encodeURIComponent(id)}.jsonl`) }
  const rows = []
  const feedSum = async () => { const f = await hub.seedFeed(ctx, id).catch(() => null); const rs = f?.rows || []; return { sessions: rs.filter((r) => r.k === 'start').length, said: rs.filter((r) => r.k === 'me').length, fixAsk: rs.filter((r) => r.k === 'kmd' && r.tone === 'warn').length, feedCost: r4(sum(rs.filter((r) => r.k === 'result').map((r) => r.cost))), feedTail: rs.filter((r) => r.k === 'kmd' || r.tone === 'err' || r.k === 'err').slice(-4).map((r) => String(r.text || '').slice(0, 200)) } }
  try {
    rows.push(await measure(E, t, { channel: 'shape-pc', step: '조사(폴더)', file: srcs.map((s) => s.n).join(','), expectCh: 'shape' }, async () => {
      await hub.seedSurvey(ctx, id, { dir: srcDir })
      const v = await settleSeed(hub, ctx, id)
      return { put: false, runState: v.run?.state }
    }))
    rows.push(await measure(E, t, { channel: 'shape-pc', step: '구조안(세션 · 뼈대 + 묶음)', expectCh: 'shape' }, async () => {
      await hub.seedPlan(ctx, id, { mode: 'claude' })
      const v = await settleSeed(hub, ctx, id)
      const f = await feedSum()
      return { put: false, runState: v.run?.state, runWhy: v.run?.why || v.run?.error || null, tries: v.run?.tries ?? null, check: v.work?.check ? { ok: v.work.check.ok, errors: (v.work.check.errors || []).slice(0, 5) } : null, docs: (v.work?.plan?.docs || []).map((d) => d.id), ...f, fix: f.fixAsk, ...(v.work?.check?.ok ? {} : { codes: ['PLAN_CHECK'] }) }
    }))
    const v = await hub.seedView(ctx, id)
    const docIds = (v.work?.plan?.docs || []).map((d) => d.id)
    if (v.work?.check?.ok && docIds.length) {
      rows.push(await measure(E, t, { channel: 'shape-pc', step: `글 짓기(세션 · 문서 ${docIds.length})`, expectCh: 'shape' }, async () => {
        const fs0 = []
        for (const d of docIds) {
          await hub.seedWrite(ctx, id, { doc: d })
          await settleSeed(hub, ctx, id)
          fs0.push(await feedSum())
          await hub.seedWrite(ctx, id, { approve: d }).catch(() => null)
        }
        const v2 = await hub.seedView(ctx, id)
        return { put: false, sessions: sum(fs0.map((x) => x.sessions)), fix: sum(fs0.map((x) => x.fixAsk)), docState: (v2.work?.docs || []).map((d) => `${d.id}:${d.state}`), docWhy: (v2.work?.docs || []).map((d) => JSON.stringify(d).slice(0, 400)), feedTail: fs0.flatMap((x) => x.feedTail) }
      }))
      rows.push(await measure(E, t, { channel: 'shape-pc', step: '연습 판 → 넣기(짜임 걸음)', expectCh: 'shape' }, async () => {
        const tr = await hub.seedTry(ctx, id)
        if (!tr.ok) return { put: false, codes: ['TRY'], why: [`연습 판 막힘: ${JSON.stringify(tr.diag?.blockers || []).slice(0, 300)}`] }
        const p = await hub.shapePut(ctx, id)
        return { put: !!p.done, ...(p.done ? {} : { codes: ['PUT'], why: [JSON.stringify(p).slice(0, 300)] }) }
      }))
    } else rows.push({ channel: 'shape-pc', step: '글 짓기 · 넣기', ran: false, why: ['구조안 검사를 넘지 못해 짓지 않았다'], codes: ['PLAN_CHECK'] })
    return { rows, dirs: { root, data: dataDir, kn: dir }, score: await scoreOf(dir, id, fedOf(C)) }
  } finally { await hub.close?.() }
}
async function runShapeRestructure(E, C) {
  const t = await team(E, 'shape-restructure')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base, 'shape-restructure')))
    const before = await scoreOf(t.dir, KN, fedOf(C))
    let plan = null
    rows.push(await measure(E, t, { channel: 'shape-restructure', step: '구조안(shapeAsk shape-plan)', expectCh: 'shape' }, async () => {
      const a = await t.s.hub.shapeAsk(t.ADMIN, t.kn, { type: 'shape-plan', note: '' })
      const out = jobRow(t, a.job, await workJob(E, t, a.job))
      const r = await t.s.hub.shapeAskOf(t.ADMIN, t.kn, a.job)
      plan = r.result?.plan || null
      return { ...out, put: false, empty: false, askState: r.state, planErrors: (r.result?.errors || []).length, ...(r.why ? { why: [String(r.why).slice(0, 300)] } : {}) }
    }))
    if (plan) rows.push(await measure(E, t, { channel: 'shape-restructure', step: '검사 → 연습 판 → 넣기', expectCh: 'shape' }, async () => {
      const c = await t.s.hub.shapeCheck(t.kn, t.ADMIN, { plan })
      if (!c.ok) return { put: false, codes: ['CHECK'], why: [JSON.stringify(c.errors || []).slice(0, 300)] }
      // 바뀐 걸음 — shapeCheck 의 changes(문서 옮김 · 새 문서 · 항목 옮김 · 글 걸음 · 걷음 · 갈래 장부)와 steps 를 늘 남긴다
      const diff = { changes: (c.changes || []).length, steps: Array.isArray(c.steps) ? c.steps.length : c.steps ?? null, kinds: [...new Set((c.changes || []).map((x) => String(x).split(':')[0]))], sample: (c.changes || []).slice(0, 6) }
      const tr = await t.s.hub.shapeTry(t.ADMIN, t.kn)
      if (!tr.ok) return { put: false, diff, codes: ['TRY'], why: [JSON.stringify(tr.diag?.blockers || []).slice(0, 300)] }
      const p = await t.s.hub.shapePut(t.ADMIN, t.kn)
      // 바뀐 것이 없으면(구조안이 지금 짜임 그대로) 들어감이 아니라 빈 것(empty)으로 센다 — 넣기 뒤 savelog n 은 measure 가 savelog.n 으로 남긴다
      if (!p.done) return { put: false, diff, steps: p.steps ?? null, codes: ['PUT'], why: [JSON.stringify(p).slice(0, 300)] }
      const sl = t.savelog().filter((l) => l.ch === 'shape').slice(-20)
      const changed = diff.changes > 0 || sum(sl.map((l) => l.n)) > 0
      return { put: changed, empty: !changed, diff, steps: p.steps ?? null, ...(changed ? {} : { why: ['구조안이 바꾼 것이 없다(짜임 걸음 · 글 걸음 0) · 기록만 남았다'] }) }
    }))
    return scored({ rows, dirs: { root: t.root, kn: t.dir } }, t.dir, KN, fedOf(C), before)
  } finally { await t.close() }
}

async function runSend(E, C) {
  const { SHELL } = await import('../server/hub.js')
  const { startServer } = await import('../server/http.js')
  const t = await team(E, 'send')
  const rows = []
  const proot = path.join(t.root, '..', 'send-pc')
  await fs.rm(proot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  const mine = path.join(proot, 'mine')
  for (const d of ['docs', 'work']) await fs.mkdir(path.join(mine, d), { recursive: true })
  await fs.writeFile(path.join(mine, '_vocab.md'), '# 항목 장부\n\n')
  const srcs = await Promise.all(C.src.map(srcOf))
  const docName = (s) => (E.fake ? cleanName(s.title) : s.title).replace(/[\\/:*?"<>|#%]/g, '').trim() || `원천 ${s.n}`
  for (const s of srcs) await fs.writeFile(path.join(mine, 'docs', `${docName(s)}.md`), s.md)
  const was = process.env.KMD_SEND_KEY
  process.env.KMD_SEND_KEY = t.me.key
  await t.s.hub.setOwner(SHELL, t.kn, { owner: USER })
  const pc = await startServer({ root: proot, mode: 'pc', user: USER, port: 0, log: () => {}, scryptN: 1 << 15 })
  let before = null
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base || [], 'send')))
    before = await scoreOf(t.dir, KN, fedOf(C))
    await fs.writeFile(path.join(proot, '.kmd', 'teams.json'), JSON.stringify([t.s.url]))
    const ME = { user: pc.pcUser, admin: true, pc: true }
    await pc.hub.sendRoute(ME, 'mine', { to: t.kn, url: t.s.url })
    for (const s of srcs) {
      rows.push(await measure(E, t, { channel: 'send', step: '보내기(미리 보기 = Claude → 승인 그대로 보냄)', n: s.n, file: s.file, expectCh: 'send' }, async () => {
        const pick = { to: t.kn, docs: [{ path: `docs/${docName(s)}.md` }] }
        const t0 = Date.now()
        const pv = await pc.hub.sendPreview(ME, 'mine', pick)
        const msDraft = Date.now() - t0
        const pr = pv.proposals?.[0]
        const errs = pr?.propose?.errors || []
        const out = { msDraft, proposeErrors: errs.length, warnings: (pr?.propose?.warnings || []).map((w) => w.code || w), kinds: (pr?.propose?.items || []).map((x) => x.kind), recordOnly: /항목 글은 고치지 않았다/.test(pr?.propose?.text || '') }
        if (errs.length) return { ...out, put: false, codes: ['PROPOSE'], why: [JSON.stringify(errs).slice(0, 300)] }
        const t1 = Date.now()
        const r = await pc.hub.sendPicked(ME, 'mine', pick)
        return { ...out, msSend: Date.now() - t1, ms: Date.now() - t0, put: (r.put || 0) > 0, putItems: r.put || 0, ...(r.fail ? { codes: ['FAIL'], why: [JSON.stringify(r.fail).slice(0, 300)] } : {}) }
      }))
    }
    return scored({ rows, dirs: { root: t.root, kn: t.dir, pc: proot } }, t.dir, KN, fedOf(C), before)
  } finally {
    await pc.close()
    if (was === undefined) delete process.env.KMD_SEND_KEY
    else process.env.KMD_SEND_KEY = was
    await t.close()
  }
}

// 사람 MCP 세션(session · bulk) — core/agent.js runAgent 로 머리 없는 Claude Code 세션 · MCP 열쇠는 사람의 기기 열쇠(사람 채널로 저장된다)
async function humanSession(E, t, { skill, prompt, files, extra }) {
  const { runAgent } = await import('../core/agent.js')
  const { teamKitParts } = await import('../core/teamkit.js')
  const kit = await teamKitParts()
  const sys = kit.skills.filter((x) => x.rel.includes(`/${skill}/`)).map((x) => `<!-- ${x.rel} -->\n${x.text}`).join('\n\n')
  const system = `${sys}\n\n## 이 시험 세션의 덧말(사람이 미리 정한 것)\n- 연결 이름은 kmd 다(스킬의 kmd-team 과 같다). 지식 id 는 ${t.kn} 하나다: 묻지 않는다.\n${extra}`
  const lines = []
  if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.sessionScript
  const r = await runAgent({ prompt, system, files, mcp: { url: `${t.s.url}/mcp`, token: t.me.key }, budget: 3, timeoutMs: 20 * 60_000, model: E.model || '', onLine: (x) => lines.push(x) })
  const tools = lines.filter((x) => x.k === 'tool').map((x) => String(x.x))
  const model = String(lines.find((x) => x.k === 'sys' && /^시작: /.test(String(x.x)))?.x || '').replace(/^시작: /, '').split(' · ')[0] || null
  // 이 행은 사람 세션 그 자체가 아니라 머리 없는 대용이다: 일꾼 틀(runAgent · 도구 Read · Glob · Grep + kmd MCP · 스킬 글을 시스템 프롬프트에 · 예산 $3).
  //   실제 사람 세션은 대화형 Claude Code(Skill 도구 · 사람의 모델 · CLAUDE.md · 예산 없음)라 시간 · 비용 · 차례가 다르다
  const proxy = { via: 'runAgent', tools: 'Read · Glob · Grep + kmd MCP', skillIn: 'append-system-prompt', model: model || E.model || '기본', budgetUsd: 3 }
  return { r, tools, lines, proxy }
}
async function runSession(E, C) {
  const t = await team(E, 'session')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base || [], 'session')))
    const before = await scoreOf(t.dir, KN, fedOf(C))
    for (const n of C.src) {
      const s = await srcOf(n)
      rows.push(await measure(E, t, { channel: 'session', step: '사람 세션(kmd-team-save · 승인 대신)', n: s.n, file: s.file, expectCh: 'session' }, async () => {
        const { r, tools, proxy } = await humanSession(E, t, {
          skill: 'kmd-team-save',
          files: [{ name: '원천.md', data: s.md }],
          extra: '- 정리 거리 고르기 · 승인 묻기는 사람이 미리 했다: propose 의 errors 가 0 이면 묻지 않고 그 proposal 을 그대로 실어 save 한다. errors 면 입력을 고쳐 다시 propose 한다(세 번까지).\n- 마지막 답에 제안서 text 를 붙인다.',
          prompt: `일 폴더의 「원천.md」 는 사람이 넣어 달라는 원문이다(knowledge id: ${t.kn}). 성격을 한 줄로 정하고 kmd-team-save 순서대로 남겨 줘. 저장 제안은 승인한 것으로 본다.`,
        })
        const saves = tools.filter((x) => x.startsWith('저장')).length
        const proposes = tools.filter((x) => x.startsWith('propose')).length
        return { putFromSavelog: true, proxy, cost: r.cost || 0, turns: r.turns ?? null, calls: 1, put: false, agentOk: !!r.ok, toolCalls: tools.length, proposeCalls: proposes, saveCalls: saves, answer: String(r.text || r.message || '').slice(0, 1500), ...(r.ok ? {} : { codes: [`AGENT_${r.error || 'fail'}`], why: [String(r.message || '').slice(0, 300)] }) }
      }))
    }
    return scored({ rows, dirs: { root: t.root, kn: t.dir } }, t.dir, KN, fedOf(C), before)
  } finally { await t.close() }
}
async function runBulk(E, C) {
  const crypto = await import('node:crypto')
  const { fileToMd } = await import('../core/importer.js')
  const t = await team(E, 'bulk')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base || [], 'bulk')))
    const before = await scoreOf(t.dir, KN, fedOf(C))
    const srcs = await Promise.all(C.src.map(srcOf))
    const files = []
    const index = []
    // 대량 넣기의 원본은 사무 파일이다: 첨부 꼴(core/save.js ASSET_EXT)에 md 가 없어 md 원천은 넣지 못한다(E_INPUT 「올릴 수 없는 첨부 꼴」).
    //   그래서 골든 md 를 docx(머리 줄 → 제목 스타일)로 바꿔 원본으로 쓴다 · 글 · 지문은 서버와 같은 fileToMd 로
    for (const s of srcs) {
      const rel = s.file.replace(/\.md$/, '.docx')
      const buf = await docxOf(s.md)
      const { md } = await fileToMd(rel, buf, { convert: true })
      if (!md) throw Object.assign(new Error(`docx 를 글로 바꾸지 못했다: ${rel}`), { code: 'CONVERT' })
      const sha = crypto.createHash('sha256').update(String(md).trim()).digest('hex').slice(0, 16)
      const mdFile = `글/${s.n}.md`
      const b64File = `원본/${s.n}.b64`
      index.push({ rel, attachPath: `docs/assets/${rel}`, mdFile, b64File, sha, tags: [`ingest/${rel}`, `md/${sha}`] })
      files.push({ name: mdFile, data: md }, { name: b64File, data: buf.toString('base64') })
    }
    files.push({ name: 'index.json', data: JSON.stringify(index, null, 1) })
    rows.push(await measure(E, t, { channel: 'bulk', step: `대량 넣기 세션(원천 ${srcs.length} · 한 세션)`, file: srcs.map((s) => s.n).join(','), expectCh: 'bulk' }, async () => {
      const { r, tools, proxy } = await humanSession(E, t, {
        skill: 'kmd-team-import',
        files,
        extra: '- 파서(kmd-parse)를 받지 않는다: 일 폴더의 index.json 이 파서 출력이다(rel · mdFile 글 · sha · tags · b64File 원본 base64).\n- 규칙 표 승인은 사람이 미리 했다: propose errors 가 0 이면 묻지 않고 파일마다 save 한다. save 의 record.tags 는 index.json 의 tags 그대로 · attach 는 [{ path: attachPath, b64: <b64File 글 그대로> }].\n- 빈 지식이어도 기초 세우기를 기다리지 않고 이어 간다.',
        prompt: `일 폴더의 파일들을 팀 지식(knowledge id: ${t.kn})에 대량으로 넣어 줘. index.json 을 먼저 읽는다. 규칙 표는 승인한 것으로 본다.`,
      })
      return { putFromSavelog: true, proxy, cost: r.cost || 0, turns: r.turns ?? null, calls: 1, agentOk: !!r.ok, toolCalls: tools.length, saveCalls: tools.filter((x) => x.startsWith('저장')).length, perFileCost: r4((r.cost || 0) / srcs.length), answer: String(r.text || r.message || '').slice(0, 800), ...(r.ok ? {} : { codes: [`AGENT_${r.error || 'fail'}`], why: [String(r.message || '').slice(0, 300)] }) }
    }))
    rows.push(await measure(E, t, { channel: 'bulk', step: '같은 묶음 다시(모두 same 이어야)', expectCh: 'bulk' }, async () => {
      if (!E.fake) return { ran: false, why: ['진짜 판에서는 다시 돌리지 않는다(돈) · 가짜 판에서만 본다'] }
      const { r } = await humanSession(E, t, { skill: 'kmd-team-import', files, extra: '', prompt: `일 폴더의 파일들을 팀 지식(knowledge id: ${t.kn})에 대량으로 넣어 줘.` })
      return { put: false, agentOk: !!r.ok, answer: String(r.text || '').slice(0, 400), sameOk: /"same":true/.test(String(r.text || '')) }
    }))
    return scored({ rows, dirs: { root: t.root, kn: t.dir } }, t.dir, KN, fedOf(C), before)
  } finally { await t.close() }
}

async function runEdit(E, C) {
  const { sha16 } = await import('../core/text.js')
  const { seat } = await import('../test/helpers.mjs')
  const t = await team(E, 'edit')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base, 'edit')))
    const before = await scoreOf(t.dir, KN, fedOf(C))
    await t.s.auth.addUser({ id: 'test-wr', admin: false })
    await seat(t.s, 'test-wr', { [t.kn]: 'write' })
    const WR = { user: 'test-wr' }
    // 단위가 붙은 값(5초 · 3회 · 20%)이 있는 항목을 먼저 고른다(판 번호 v0.1 같은 것을 값으로 고치지 않게)
    const UNIT = /(\d+)\s*(초|회|분|시간|묶음|%|ms|개|건|일)/
    const pick = async () => {
      t.s.hub.forget?.(t.kn)
      const k = await t.s.hub.get(t.kn, t.ADMIN)
      const docs = k.docs.filter((d) => d.path !== RECORDS_DOC_PATH)
      for (const re of [UNIT, /\d+/]) for (const d of docs) for (const x of d.sections) if (x.h && re.test(x.body)) return { d, x, k }
      return null
    }
    const baseRec = (await pick())?.x?.applied || null
    const ed = (ctx, body) => t.s.hub.edit(ctx, t.kn, body, { needBase: true })
    // 제안(dry) → 받은 제안 그대로 넣기 — 시간은 둘을 따로
    const twoStep = async (ctx, body) => {
      const t0 = Date.now()
      const d = await ed(ctx, { ...body, dry: true })
      const msPropose = Date.now() - t0
      if (d.propose?.errors?.length || !d.propose?.proposal) return { msPropose, ms: msPropose, put: false, codes: ['PROPOSE'], proposeErrors: (d.propose?.errors || []).map((x) => x.code), why: [JSON.stringify(d.propose?.errors || d).slice(0, 300)] }
      const t1 = Date.now()
      const r = await ed(ctx, { ...body, proposal: d.propose?.proposal })
      return { msPropose, msPut: Date.now() - t1, ms: Date.now() - t0, warnings: (d.propose?.warnings || []).map((w) => w.code || w), put: !!r.direct, record: r.record || null, also: (r.also || []).length }
    }
    const want = (code) => async (fn) => { try { await fn(); return { put: false, codes: ['NO_ERROR'], expect: code, expectOk: false } } catch (e) { return { put: false, codes: [e.code || 'THROW'], expect: code, expectOk: e.code === code, why: [String(e.message).slice(0, 200)] } } }
    const bump = (body) => { const m = UNIT.exec(body) || /\d+/.exec(body); const to = String(Number(m[1] ?? m[0]) + 1); const was = m[0]; const now = m[1] != null ? was.replace(m[1], to) : to; return { from: was, to: now, body: body.replace(was, now) } }
    const cases = [
      ['A 값 하나 바꿈 · 바뀐 것 없음(쓰기 자리 · 경고 받아들임)', WR, (p) => { const b = bump(p.x.body); return twoStep(WR, { doc: p.d.id, sections: [{ h: p.x.h, base: sha16(p.x.body), body: b.body }] }) }],
      ['B 값 바꿈 + 바뀐 것 · 까닭(쓰기 자리)', WR, (p) => { const b = bump(p.x.body); return twoStep(WR, { doc: p.d.id, sections: [{ h: p.x.h, base: sha16(p.x.body), body: b.body }], changes: [`${p.x.h}: ${b.from} → ${b.to}`], why: '시험' }) }],
      ['C 기록 정정(fixes · 지식관리자)', t.ADMIN, (p) => { const b = bump(p.x.body); return baseRec ? twoStep(t.ADMIN, { doc: p.d.id, sections: [{ h: p.x.h, base: sha16(p.x.body), body: b.body }], changes: [`${p.x.h}: ${b.from} → ${b.to}`], why: '바로잡음 시험', fixes: [baseRec] }) : Promise.resolve({ ran: false, why: ['정정할 바탕 기록(applied)이 없다'] }) }],
      ['D 새 머리(넣을 것으로 가야 · E_INPUT)', WR, (p) => want('E_INPUT')(() => ed(WR, { doc: p.d.id, sections: [{ h: 'test-새 항목', body: '새 글이다.' }], dry: true }))],
      ['E 꼴 어김(# 줄 · 주석 · E_FORMAT)', WR, (p) => want('E_FORMAT')(async () => { const d = await ed(WR, { doc: p.d.id, sections: [{ h: p.x.h, base: sha16(p.x.body), body: `${p.x.body}\n# 머리 줄\n<!-- 주석 -->` }], dry: true }); if (d.propose?.errors?.length) throw Object.assign(new Error(JSON.stringify(d.propose.errors).slice(0, 200)), { code: d.propose.errors.some((x) => x.code === 'format') ? 'E_FORMAT' : 'E_INPUT' }); return ed(WR, { doc: p.d.id, sections: [{ h: p.x.h, base: sha16(p.x.body), body: `${p.x.body}\n# 머리 줄\n<!-- 주석 -->` }], proposal: d.propose?.proposal }) })],
      ['F 낡은 base(E_CONFLICT)', WR, (p) => want('E_CONFLICT')(() => ed(WR, { doc: p.d.id, sections: [{ h: p.x.h, base: '0'.repeat(16), body: bump(p.x.body).body }], dry: true }))],
      ['G 제안 없이 넣기(E_APPROVE)', WR, (p) => want('E_APPROVE')(() => ed(WR, { doc: p.d.id, sections: [{ h: p.x.h, base: sha16(p.x.body), body: bump(p.x.body).body }] }))],
    ]
    for (const [step, , fn] of cases) {
      rows.push(await measure(E, t, { channel: 'edit', step, expectCh: 'edit' }, async () => {
        const p = await pick()
        if (!p) return { ran: false, why: ['숫자 값이 있는 항목이 없다'] }
        return { file: `${p.d.id} › ${p.x.h}`, ...(await fn(p)) }
      }))
    }
    return scored({ rows, dirs: { root: t.root, kn: t.dir } }, t.dir, KN, fedOf(C), before)
  } finally { await t.close() }
}

// API 열쇠 저장(http 채널) — POST /api/k/:id/propose → 받은 proposal 그대로 /save(사람 채널 · 승인 대신)
async function runHttp(E, C) {
  const { sha16 } = await import('../core/text.js')
  const t = await team(E, 'http')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base || [], 'http')))
    const before = await scoreOf(t.dir, KN, fedOf(C))
    const api = async (what, body) => {
      const r = await fetch(`${t.s.url}/api/k/${encodeURIComponent(t.kn)}/${what}`, { method: 'POST', headers: { authorization: `Bearer ${t.me.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return { status: r.status, j: await r.json().catch(() => null) }
    }
    const twoStep = async (input) => {
      const t0 = Date.now()
      const p = await api('propose', input)
      const msPropose = Date.now() - t0
      const errs = p.j?.errors || []
      if (p.status !== 200 || errs.length || !p.j?.proposal) return { msPropose, ms: msPropose, put: false, codes: ['PROPOSE'], proposeErrors: errs.map((e) => e.code), why: [JSON.stringify(p.j).slice(0, 300)] }
      const t1 = Date.now()
      const r = await api('save', { ...input, proposal: p.j.proposal })
      const bad = r.status !== 200 || !!r.j?.errors
      return { msPropose, msSave: Date.now() - t1, ms: Date.now() - t0, status: r.status, proposeWarnings: (p.j.warnings || []).map((w) => w.code || w), put: !bad && Number(r.j?.put || 0) > 0, putItems: r.j?.put ?? null, ...(bad ? { codes: [r.j?.code || `HTTP_${r.status}`], why: [JSON.stringify(r.j).slice(0, 300)] } : {}) }
    }
    const s = await srcOf(C.src[0])
    const doc = cleanName(s.title)
    const secs = [...s.md.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm)].map((m) => ({ heading: m[1].trim(), content: m[2].trim() })).filter((x) => x.content).slice(0, 4)
    rows.push(await measure(E, t, { channel: 'http', step: 'A 새 문서(propose → save)', n: s.n, file: s.file, expectCh: 'http' }, async () => twoStep({ record: { title: `${doc}: 남김`, body: `${doc} 의 지금 내용을 남겼다(API 저장 시험).`, changes: secs.map((x) => `새로: ${x.heading}`), why: ['시험(API 저장)'], touchesEmpty: '시험' }, sections: secs.map((x) => ({ doc, heading: x.heading, content: x.content })), forms: [{ name: doc, kind: '서술' }] })))
    // B 있는 항목 값 바꿈(바탕 01 의 단위 붙은 값 · base 지문)
    rows.push(await measure(E, t, { channel: 'http', step: 'B 있는 항목 값 바꿈(base · 경고 받아들임)', expectCh: 'http' }, async () => {
      t.s.hub.forget?.(t.kn)
      const k = await t.s.hub.get(t.kn, t.ADMIN)
      const UNIT = /(\d+)\s*(초|회|분|시간|묶음|%|ms|개|건|일)/
      let hit = null
      for (const d of k.docs.filter((y) => y.path !== RECORDS_DOC_PATH)) for (const x of d.sections) if (!hit && x.h && UNIT.test(x.body)) hit = { d, x }
      if (!hit) return { ran: false, why: ['단위가 붙은 값이 있는 항목이 없다'] }
      const m = UNIT.exec(hit.x.body)
      const now = m[0].replace(m[1], String(Number(m[1]) + 1))
      return { file: `${hit.d.id} › ${hit.x.h}`, ...(await twoStep({ record: { title: `${hit.x.h}: 값 바꿈`, body: `${hit.x.h} 의 값을 ${now} 로 바꿨다(API 저장 시험).`, changes: [`${hit.x.h}: ${m[0]} → ${now}`], why: ['시험(API 저장)'], touchesEmpty: '시험(항목 장부 좌표를 고르지 않는다)' }, sections: [{ doc: hit.d.id, heading: hit.x.h, base: sha16(hit.x.body), content: hit.x.body.replace(m[0], now) }] })) }
    }))
    return scored({ rows, dirs: { root: t.root, kn: t.dir } }, t.dir, KN, fedOf(C), before)
  } finally { await t.close() }
}

// 화면 고치기의 새 항목 — editAsSource → 넣을 것(importFiles) → 팀 일꾼 세션 → 승인 대기 → 승인(저장 줄 ch intake-file)
async function runEditSource(E, C) {
  const t = await team(E, 'edit-source')
  const rows = []
  try {
    if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
    rows.push(...(await baseIntake(E, t, C.base || [], 'edit-source')))
    const before = await scoreOf(t.dir, KN, fedOf(C))
    t.s.hub.forget?.(t.kn)
    const k = await t.s.hub.get(t.kn, t.ADMIN)
    const d = k.docs.filter((y) => y.path !== RECORDS_DOC_PATH).sort((a, b) => b.sections.length - a.sections.length)[0]
    if (!d) rows.push(await measure(E, t, { channel: 'edit-source', step: '고칠 문서 없음', expectCh: 'intake-file' }, async () => ({ ran: false, why: ['바탕에 문서가 없다'] })))
    else rows.push(await measure(E, t, { channel: 'edit-source', step: '새 항목(editAsSource → 넣을 것 → 세션 → 승인 대기 → 승인)', file: `${d.id} › test-점검 주기`, expectCh: 'intake-file' }, async () => openThenApprove(E, t, () => t.s.hub.editAsSource(t.ADMIN, t.kn, { doc: d.id, sections: [{ h: 'test-점검 주기', body: '수집기는 매일 09:00 에 상태를 점검한다. 점검 결과는 운영 메모에 남긴다.' }], why: '시험(화면 새 항목)' }))))
    return scored({ rows, dirs: { root: t.root, kn: t.dir } }, t.dir, KN, fedOf(C), before)
  } finally { await t.close() }
}

// 개인 프로그램 들이기 — mode pc 서버 · importFiles → pcAgent(runAgent · 같은 프로세스) → 승인 대기 → 승인
async function runPcIntake(E, C) {
  const { startServer } = await import('../server/http.js')
  const base = path.join(E.knDir, 'pc-intake')
  await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  const root = path.join(base, 'kn')
  const data = path.join(base, 'data')
  for (const d of [root, data]) await fs.mkdir(d, { recursive: true })
  await fs.writeFile(path.join(data, 'serve.json'), JSON.stringify({ curateOnStart: false, decideMs: 3600000, inboxTickMs: 3600000, sourceTickMs: 3600000, jobTickMs: 3600000, sendTickMs: 3600000, queueResumeMs: 3600000 }))
  const was = process.env.KMD_UPLOAD_ASK
  delete process.env.KMD_UPLOAD_ASK // 승인 대기(기본 켜짐)를 그대로
  if (E.fake) process.env.FAKE_AGENT_SCRIPT = E.intakeScript
  const pc = await startServer({ root, data, mode: 'pc', user: USER, port: 0, log: () => {}, scryptN: 1 << 15 })
  const rows = []
  try {
    const ME = { user: pc.pcUser, admin: true, pc: true }
    const id = (await pc.hub.addKnowledge(ME, { kind: 'new', name: 'test-개인들이기' })).id
    const dir = path.join(root, id)
    const t = { kn: id, dir, savelogFile: () => path.join(data, 'savelog', `${encodeURIComponent(id)}.jsonl`) }
    for (const n of C.src) {
      const s = await srcOf(n)
      const name = E.fake ? `${cleanName(s.file.replace(/\.md$/, ''))}.md` : s.file
      rows.push(await measure(E, t, { channel: 'pc-intake', step: '개인 올리기 → 세션(pcAgent) → 승인 대기 → 승인', n: s.n, file: name, expectCh: 'intake-file' }, async () => {
        const r = await pc.hub.importFiles(ME, id, [{ path: name, data: Buffer.from(s.md) }])
        const row = r.rows?.[0] || {}
        if (row.kind !== 'run') return { put: false, codes: ['OPEN'], why: [JSON.stringify(row).slice(0, 300)] }
        const g0 = gitCount(dir)
        const tw = Date.now()
        let j = null
        let run = null
        for (let i = 0; i < 25 * 60 * 4; i++) {
          j = pc.hub.intakesOf(id).find((x) => x.src?.rel === name) || null
          if (j?.state === 'ask') break
          run = pc.hub.runGet(ME, row.run)
          if (run && ['done', 'fail', 'cancelled', 'stopped'].includes(run.state) && (!j || !['queued', 'running'].includes(j.state))) break
          await sleep(250)
        }
        const out = { msSession: Date.now() - tw, cost: j?.cost || 0, calls: j?.calls || 0, ask: j?.state === 'ask', askState: j?.state || run?.state || null, wroteBeforeApprove: gitCount(dir) !== g0, put: false }
        if (j?.state !== 'ask') return { ...out, empty: run?.state === 'done', ...(run?.state === 'done' ? {} : { codes: ['NO_ASK'], why: [String(run?.msg || run?.why || '승인 대기로 서지 않았다').slice(0, 300)] }) }
        const ta = Date.now()
        const ap = await pc.hub.intakeAskApprove(ME, id, j.id)
        return { ...out, approveMs: Date.now() - ta, approve: { rec: ap?.rec || null }, put: !!ap?.rec }
      }))
    }
    return { rows, dirs: { root, data, kn: dir }, score: await scoreOf(dir, id, fedOf(C)) }
  } finally {
    await pc.close()
    if (was !== undefined) process.env.KMD_UPLOAD_ASK = was
  }
}

// 실제 세션(claude -p) 보호 — core/agent.js 와 같은 담: 사용자 MCP 를 붙이지 않고(--strict-mcp-config · 빈 설정) · 집 폴더의 숨은 파일 · AppData 읽기 거부 ·
//   사용자 settings(허락 · 훅)를 합치지 않는다(--setting-sources project · cwd 는 격리 폴더라 프로젝트 설정도 없다) · 환경은 ENV_ALLOW 만
const HOME_DENY = ['Read(~/.*)', 'Read(~/.*/**)', 'Read(~/AppData/Roaming/**)', 'Read(~/AppData/Local/Packages/**)']
function sessionArgs({ tools, allowed, budget, model }) {
  return ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--tools', tools, '--allowedTools', allowed.join(','), '--disallowedTools', HOME_DENY.join(','), '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }), '--setting-sources', 'project', '--no-session-persistence', '--max-budget-usd', String(budget), ...(model ? ['--model', model] : [])]
}
async function safeEnv() {
  const { ENV_ALLOW } = await import('../core/claude.js')
  return Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]))
}
const fwd = (p) => p.replace(/\\/g, '/')
const lastResult = (out) => out.split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((j) => j?.type === 'result').pop() || null

// 짜임 꾸러미(kmd-seed) — 세션 스킬이 꾸러미를 짓고(실제: claude -p · 가짜: survey + 시험이 지은 구조안 · 글 초안) 개인 hub 가 seedSurvey({dir}) 로 넣는다(packed · by pack)
async function fakePack(srcDir, pack) {
  const { survey, packCheck } = await import('../core/survey.js')
  const r = await survey(srcDir, { out: pack, log: () => {} })
  const keep = r.rows.filter((x) => x.src && x.pick === '넣음')
  const docs = []
  await fs.mkdir(path.join(pack, 'texts'), { recursive: true })
  for (const x of keep) {
    const md = await fs.readFile(path.join(pack, 'md', `${x.src.slice(2)}.md`), 'utf8')
    const id = cleanName(String(x.topic || path.basename(x.path, path.extname(x.path)))).replace(/[\\/:*?"<>|#%]/g, '').trim() || `원천 ${docs.length + 1}`
    const clean = (b) => b.split('\n').filter((l) => !/^#/.test(l) && !/<!--/.test(l)).join('\n').trim()
    let secs = [...md.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm)].map((m) => ({ h: m[1].trim(), text: clean(m[2]) })).filter((s) => s.text)
    if (!secs.length) secs = [{ h: '개요', text: clean(md) || id }]
    const seen = new Set()
    secs = secs.filter((s) => (seen.has(s.h) ? false : seen.add(s.h)))
    if (docs.some((d) => d.id === id)) continue
    docs.push({ id, was: null, items: secs.map((s) => ({ h: s.h, src: [x.src] })) })
    await fs.writeFile(path.join(pack, 'texts', `${id}.json`), JSON.stringify({ doc: id, items: secs.map((s) => ({ h: s.h, text: s.text })) }))
  }
  await fs.writeFile(path.join(pack, 'plan.json'), JSON.stringify({ v: 1, kind: 'seed', docs, names: [], skip: [] }))
  return packCheck(pack, {})
}
async function runSeedPack(E, C) {
  const { makeHub } = await import('../server/hub.js')
  const base = path.join(E.knDir, 'kmd-seed')
  await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  const root = path.join(base, 'kn')
  const dataDir = path.join(base, 'data')
  const srcDir = path.join(base, 'src')
  const pack = path.join(base, 'pack')
  for (const d of [root, dataDir, srcDir]) await fs.mkdir(d, { recursive: true })
  const srcs = await Promise.all(C.src.map(srcOf))
  for (const s of srcs) await fs.writeFile(path.join(srcDir, E.fake ? `${cleanName(s.file.replace(/\.md$/, ''))}.md` : s.file), s.md)
  const hub = await makeHub({ root, dataDir, mode: 'pc', pcUser: USER, log: () => {} })
  const ctx = { user: USER, pc: true }
  const id = (await hub.addKnowledge(ctx, { kind: 'new', name: 'test-꾸러미', empty: true, backup: false })).id
  const dir = path.join(root, id)
  const t = { kn: id, dir, savelogFile: () => path.join(dataDir, 'savelog', `${encodeURIComponent(id)}.jsonl`) }
  const rows = []
  try {
    rows.push(await measure(E, { kn: id }, { channel: 'kmd-seed', step: '꾸러미 짓기(survey · 카드 · 구조안 · 글 초안 · check)', file: srcs.map((s) => s.n).join(',') }, async () => {
      const { packCheck } = await import('../core/survey.js')
      if (E.fake) {
        const c = await fakePack(srcDir, pack)
        return { put: false, session: { fake: true }, check: { ok: c.ok, errors: (c.errors || []).slice(0, 5), warnings: (c.warnings || []).length }, ...(c.ok ? {} : { codes: ['PACK_CHECK'] }) }
      }
      const SEED = fwd(path.join(ROOT, 'scripts', 'kmd-seed.mjs'))
      const SKILL = fwd(path.join(ROOT, '.claude', 'skills', 'kmd-seed', 'SKILL.md'))
      const prompt = `kmd-seed 스킬(${SKILL})을 먼저 Read 하고 따른다. 사람이 미리 정한 것: 원본 폴더는 ./src · 꾸러미는 ./pack(빈 폴더 · 이 cwd 안). 명령은 반드시 \`node ${SEED} <명령> …\` 꼴로만 부른다(다른 셸 명령 없음). 순서: survey ./src --out ./pack → 카드(prompt card 를 하위 에이전트로) → 구조안(prompt plan 을 하위 에이전트로 · plan.json) → check ./pack 걸림 0 까지(최대 3번) → 문서마다 글 초안(prompt text <문서 id> 를 하위 에이전트로 · texts/<문서>.json) → check. 쓰기는 ./pack 안에만. 화면 넘기기 안내는 하지 않는다. 끝에 요약 한 단락만.`
      const allowed = [`Bash(node ${SEED}:*)`, 'Read', 'Glob', 'Grep', 'Edit(./pack/**)', 'Write(./pack/**)', 'Agent']
      const r = await runNode([process.env.KMD_CLAUDE, ...sessionArgs({ tools: 'Bash,Read,Write,Edit,Glob,Grep,Agent', allowed, budget: 6, model: E.model })], { cwd: base, input: prompt, env: await safeEnv(), timeoutMs: 40 * 60_000 })
      const res = lastResult(r.out)
      const checks = (r.out.match(/kmd-seed\.mjs check/g) || []).length
      const session = { exit: r.code, ok: !!res && !res.is_error, turns: res?.num_turns ?? null, checks, agents: (r.out.match(/"name":"(Agent|Task)"/g) || []).length, result: String(res?.result || r.err).slice(0, 800) }
      if (!fss.existsSync(path.join(pack, 'manifest.json'))) return { put: false, session, codes: ['NO_PACK'], why: ['세션이 꾸러미를 짓지 못했다'] }
      const c = await packCheck(pack, {})
      return { put: false, session, fix: Math.max(0, checks - 2), check: { ok: c.ok, errors: (c.errors || []).slice(0, 5), warnings: (c.warnings || []).length }, ...(c.ok ? {} : { codes: ['PACK_CHECK'] }) }
    }))
    if (!rows[0].check?.ok) rows.push({ channel: 'kmd-seed', step: '꾸러미 넣기', ran: false, why: ['꾸러미 check 를 넘지 못해 넣지 않았다'], codes: ['PACK_CHECK'] })
    else rows.push(await measure(E, t, { channel: 'kmd-seed', step: '꾸러미 넣기(seedSurvey dir → 짓기 남은 것 → 연습 판 → 넣기)', expectCh: 'shape' }, async () => {
      const st = await hub.seedSurvey(ctx, id, { dir: pack })
      let v = await settleSeed(hub, ctx, id)
      if (!v.work?.check?.ok) return { put: false, packed: !!st.packed, codes: ['PLAN_CHECK'], why: [JSON.stringify(v.work?.check?.errors || v.run || null).slice(0, 300)] }
      const docs0 = (v.work?.docs || []).map((d) => `${d.id}:${d.state}:${d.by || ''}`)
      // 글 초안이 없는 문서만 hub 가 짓는다(Claude) — 꾸러미 글은 by pack
      for (const d of v.work?.docs || []) if (d.state !== 'ok') { await hub.seedWrite(ctx, id, { doc: d.id }); await settleSeed(hub, ctx, id) }
      v = await hub.seedView(ctx, id)
      for (const d of v.work?.docs || []) await hub.seedWrite(ctx, id, { approve: d.id }).catch(() => null)
      const tr = await hub.seedTry(ctx, id)
      if (!tr.ok) return { put: false, packed: !!st.packed, docs: docs0, codes: ['TRY'], why: [`연습 판 막힘: ${JSON.stringify(tr.diag?.blockers || []).slice(0, 300)}`] }
      const p = await hub.shapePut(ctx, id)
      return { put: !!p.done, packed: !!st.packed, docs: docs0, byPack: docs0.filter((x) => x.endsWith(':pack')).length, ...(p.done ? {} : { codes: ['PUT'], why: [JSON.stringify(p).slice(0, 300)] }) }
    }))
    return { rows, dirs: { root, data: dataDir, kn: dir, pack }, score: await scoreOf(dir, id, fedOf(C)) }
  } finally { await hub.close?.() }
}

// 다시 그리기 — scripts/kmd-migrate.mjs 를 따로 띄운다(지식 폴더에 바로 · savelog 없음)
function runNode(args, { cwd = ROOT, input = null, timeoutMs = 25 * 60_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd, windowsHide: true, env })
    let so = '', se = ''
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8')
    p.stdout.on('data', (c) => (so += c)); p.stderr.on('data', (c) => (se += c))
    const k = setTimeout(() => p.kill(), timeoutMs)
    p.on('close', (code) => { clearTimeout(k); resolve({ code, out: so, err: se }) })
    if (input != null) p.stdin.end(input)
    else p.stdin.end()
  })
}
async function runMigrate(E, C) {
  const { ensureRepo } = await import('../core/git.js')
  const base = path.join(E.knDir, 'kmd-migrate')
  await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  const dir = path.join(base, 'dpms')
  const { copyDir } = await import('../test/helpers.mjs')
  copyDir(path.join(ROOT, 'test/fixture/kmd/dpms'), dir)
  await ensureRepo(dir)
  try { G(dir, 'add', '-A'); G(dir, 'commit', '-q', '-m', '시험 사본') } catch { /* 이미 깨끗 */ }
  const work = path.join(base, 'work')
  await fs.mkdir(work, { recursive: true })
  const MIG = path.join(ROOT, 'scripts', 'kmd-migrate.mjs')
  const DOC = 'docs/배포절차.md'
  const H = '헬스 체크'
  const t = { kn: 'dpms', dir, savelogFile: null }
  const rows = []
  rows.push(await measure(E, t, { channel: 'kmd-migrate', step: `다시 그리기 ${DOC} › ${H}`, kid: 'dpms', file: `${DOC} › ${H}` }, async () => {
    const scan = await runNode([MIG, 'scan', dir])
    const tr = await runNode([MIG, 'trail', dir, DOC, H, '--json'])
    if (tr.code) return { put: false, codes: ['TRAIL'], why: [tr.err.slice(0, 300)] }
    const trail = JSON.parse(tr.out)
    const inFile = path.join(work, 'input.json')
    const out = { scanHit: scan.out.includes(H), linked: trail.records.length, put: false }
    const t0 = Date.now()
    if (E.fake) {
      // 가짜: 세션이 지을 input.json 을 시험이 짓는다(지금 글 그대로 + 기록 근거 한 줄 · 값은 그대로)
      await fs.writeFile(inFile, JSON.stringify({ record: { title: `다시 그림: 배포절차 › ${H}`, body: `${H} 를 이어진 기록으로 지금 글로 다시 썼다.\n\n## 근거\n- 이어진 기록(trail)` }, sections: [{ doc: DOC, heading: H, base: trail.base, content: `${trail.current.trim()}\n` }] }, null, 1))
      out.session = { fake: true }
    } else {
      // 세션은 격리 폴더(work)에서 띄운다: 쓰기는 cwd 안만(Edit(./**) · Write(./**)) · 스킬 · 스크립트 · 지식 폴더는 절대 경로 ·
      //   사용자 MCP · 사용자 settings · 집 폴더 숨은 파일은 막고 환경은 ENV_ALLOW 만(sessionArgs · safeEnv)
      const MIGf = fwd(MIG)
      const SKILL = fwd(path.join(ROOT, '.claude', 'skills', 'kmd-migrate', 'SKILL.md'))
      const prompt = `kmd-migrate 스킬(${SKILL})을 먼저 Read 하고 따른다. 지식 폴더 ${fwd(dir)} · 대상 ${DOC} › ${H} 하나. 사람 승인 자리는 이 프롬프트가 대신한다: 고르기는 이 항목으로 승인됨. 명령은 반드시 「node ${MIGf} <명령> …」 꼴로만 부른다(scan · trail · rec · check · rules · 다른 셸 명령 없음). 새 글은 ./hc.md · 입력은 ./input.json(지금 폴더)에 쓰고 「node ${MIGf} check ${fwd(dir)} ./input.json」 가 걸림 0 이 될 때까지 고친다(최대 3번). put 은 하지 않는다. 지식 폴더의 파일을 직접 고치지 않는다. 끝에 승인 표만 낸다.`
      const allowed = ['scan', 'trail', 'rec', 'check', 'rules'].map((c) => `Bash(node ${MIGf} ${c}:*)`).concat(['Read', 'Glob', 'Grep', 'Edit(./**)', 'Write(./**)'])
      const r = await runNode([process.env.KMD_CLAUDE, ...sessionArgs({ tools: 'Bash,Read,Write,Edit,Glob,Grep', allowed, budget: 3, model: E.model })], { cwd: work, input: prompt, env: await safeEnv() })
      const res = lastResult(r.out)
      const checks = (r.out.match(/kmd-migrate\.mjs check/g) || []).length
      out.session = { exit: r.code, ok: !!res && !res.is_error, turns: res?.num_turns ?? null, checks, result: String(res?.result || r.err).slice(0, 800) }
      out.fix = Math.max(0, checks - 1)
      if (!fss.existsSync(inFile)) return { ...out, ms: Date.now() - t0, codes: ['NO_INPUT'], why: ['세션이 input.json 을 쓰지 않았다'] }
    }
    out.msSession = Date.now() - t0
    const g0 = gitCount(dir)
    // 마른 검사(--json) — 걸림 · 사라지는 표 행 · 문장을 셈해 남긴다. 사라지는 것이 있으면 사람 판단 거리: 기본은 --allow-drop 없이 넣지 않고 따로 센다
    const ck = await runNode([MIG, 'check', dir, inFile, '--json'])
    let rs = null
    try { rs = JSON.parse(ck.out) } catch { /* 글 */ }
    if (!Array.isArray(rs)) return { ...out, codes: ['CHECK'], why: [(ck.out + ck.err).slice(0, 300)] }
    const bad = rs.filter((x) => !x.ok)
    const drops = rs.filter((x) => x.lostRows?.length || x.lostLines?.length).map((x) => ({ at: `${x.doc} › ${x.heading}`, rows: x.lostRows?.length || 0, lines: x.lostLines?.length || 0 }))
    out.check = { items: rs.length, bad: bad.length, drops, changed: rs.flatMap((x) => (x.changed || []).map((c) => `${c.from} → ${c.to}`)).slice(0, 10) }
    if (bad.length) return { ...out, codes: ['CHECK'], why: [bad.map((x) => `${x.code || '-'} ${x.why || ''}`).join(' / ').slice(0, 300)] }
    if (drops.length && !E.allowDrop) return { ...out, needHuman: true, codes: ['DROP_REVIEW'], why: [`사라지는 표 행 · 문장 ${drops.length}곳: 사람이 본 뒤 --allow-drop(시험: channel-eval --allow-drop)`] }
    if (drops.length) out.allowedDrops = sum(drops.map((x) => x.rows + x.lines))
    const t1 = Date.now()
    const p = await runNode([MIG, 'put', dir, inFile, '--user', 'test-migrate', ...(drops.length ? ['--allow-drop'] : [])])
    out.msPut = Date.now() - t1
    let pj = null
    try { pj = JSON.parse(p.out) } catch { /* 글 */ }
    out.putOut = pj || p.out.slice(0, 300) + p.err.slice(0, 300)
    out.put = !!pj?.ok && gitCount(dir) === g0 + 1
    out.handEdits = (() => { try { return G(dir, 'status', '--porcelain').split('\n').filter(Boolean).length } catch { return null } })()
    if (!out.put) out.codes = ['PUT']
    return out
  }))
  return { rows, dirs: { root: base, kn: dir }, note: 'savelog 없음(core/save.js 를 바로) · channelOk 는 잴 것이 없다' }
}

// ───────── 명령 ─────────
const estOf = (name, C) => {
  const n = (C.unit?.per ? C.docs || C.cases || 1 : C.src?.length || 1) + (C.extra || 0)
  const baseN = C.base?.length || 0
  return { n, baseN, usd: r4(n * (C.unit?.usd || 0) + baseN * 0.45), min: Math.round((n * (C.unit?.min || 0) + baseN * 3.5) * 10) / 10 }
}
async function plan() {
  const g = await gold()
  console.log('| 채널 | savelog ch | LLM | 원천 | 바탕 | 예상 $ | 예상 분 | 메모 |\n|---|---|---|---|---|---|---|---|')
  let usd = 0, min = 0
  for (const name of ORDER) {
    const C = CHANNELS[name]
    if (C.dead) { console.log(`| ${name} | - | - | - | - | 0 | 0 | 몰 수 없음: ${C.dead} |`); continue }
    const e = estOf(name, C)
    usd += e.usd; min += e.min
    const nm = (ns) => (ns || []).map((n) => g.sources.find((s) => s.n === n)?.file || n).join(' · ')
    console.log(`| ${name} | ${C.ch || '(없음)'} | ${C.llm} | ${C.src?.length ? nm(C.src) : `${e.n} ${C.unit?.per || '건'}`} | ${nm(C.base) || '-'} | ${e.usd} | ${e.min} | ${C.note} |`)
  }
  console.log(`\n합: 약 $${usd.toFixed(2)} · 약 ${Math.round(min)}분(바탕 들이기 포함 · 지난 실측에서 어림 · 확인 못 함)`)
}

async function run() {
  const fake = flag('fake')
  const tag = arg('tag')
  if (!tag || !/^[\w가-힣.-]{1,40}$/.test(tag)) { console.error('--tag <판> 을 준다(글자 · 숫자 · - . 40자 안)'); process.exit(2) }
  const want = String(arg('channel', '') || '').split(',').map((x) => x.trim()).filter(Boolean)
  const names = want.includes('all') ? ORDER : want
  const bad = names.filter((x) => !CHANNELS[x])
  if (!names.length || bad.length) { console.error(`--channel 을 고른다(all 또는 ${ORDER.join(' · ')})${bad.length ? ` · 모르는 채널: ${bad.join(' · ')}` : ''}`); process.exit(2) }
  const estUsd = sum(names.filter((x) => !CHANNELS[x].dead).map((x) => estOf(x, CHANNELS[x]).usd))
  const maxUsd = Number(arg('max-usd', '')) > 0 ? Number(arg('max-usd')) : r4(estUsd * 1.5)
  if (!fake) {
    const est = names.filter((x) => !CHANNELS[x].dead).map((x) => estOf(x, CHANNELS[x]))
    console.log(`실제 Claude 를 부른다: 약 $${estUsd.toFixed(2)} · 약 ${Math.round(sum(est.map((e) => e.min)))}분(어림) · 지출 상한 $${maxUsd}(--max-usd · 계측 누계로 본다)`)
    if (!flag('confirm-cost')) { console.error('돈이 드는 실행이다: --confirm-cost 를 붙여야 돈다(배관만 보려면 --fake)'); process.exit(2) }
  }
  const model = arg('model', '')
  // --no-retry: 실패한 일감을 곧바로 다시 돌리지 않는다(일꾼 한 번 · 서버의 다시 시도 간격은 1ms 그대로라 일감은 queued 로 남는다)
  const E = { fake, tag, model, models: model ? { agent: model, ingest: model, commit: model } : null, knDir: path.join(OUT_DIR, 'kn', tag), loops: flag('no-retry') ? 1 : 5, maxUsd, over: false, allowDrop: flag('allow-drop') }
  await fs.mkdir(E.knDir, { recursive: true })
  Object.assign(E, await setupEnv({ tag, fake }))
  // 계측 누계(프로세스마다 마지막 result 의 값) — 지출 상한을 본다
  E.spent = () => { const runs = new Map(); for (const l of readJsonl(E.meterFile)) runs.set(l.run, l); return sum([...runs.values()].map((l) => l.cost)) }
  console.log(`${fake ? '가짜' : '실제'} Claude · 감싸개 안쪽: 에이전트 ${path.relative(ROOT, E.agentInner)} · 스키마 답 ${path.relative(ROOT, E.claudeInner)} · 계측 ${path.relative(ROOT, E.meterFile)}`)
  const day = new Date().toISOString().slice(0, 10)
  const outFile = path.join(OUT_DIR, `${day}-${tag}.json`)
  let head = null
  try { head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim() } catch { /* 저장소 밖 */ }
  // 같은 날 · 같은 판이면 앞 결과에 채널을 덧붙인다(채널을 나눠 돌려도 한 파일 · 같은 채널은 새 값으로) — 가짜 · 실제가 섞이지 않게 판을 가른다
  const prev = await fs.readFile(outFile, 'utf8').then(JSON.parse, () => null)
  if (prev && prev.fake !== fake) { console.error(`${path.relative(ROOT, outFile)} 는 ${prev.fake ? '가짜' : '실제'} 판이다: --tag 를 달리 준다`); process.exit(2) }
  const result = {
    tag, day, fake, model: model || null, head, meter: path.relative(ROOT, E.meterFile), meters: [...new Set([...(prev?.meters || []), path.relative(ROOT, E.meterFile)])], maxUsd: fake ? null : maxUsd, loops: E.loops,
    // 한 프로세스에 result 가 여럿일 때(stream-json 입력 세션) 칸마다 마지막 result 를 쓴다 — 쌓이는 값인지 실제 판 첫 실행의 rows[].meter.multiSample 로 확인한다
    tokensRule: 'last-result-per-process (unverified)',
    // 품질 점수는 채널이 넣은 골든 원천(바탕 포함)에 걸린 정답만으로 매긴다(score.scope) · 원천이 다르면 F1 을 견줄 때 scope 를 같이 본다
    scoreRule: 'gold subset by fed sources (score.scope)',
    channels: { ...(prev?.channels || {}) },
  }
  const save = () => fs.writeFile(outFile, JSON.stringify(result, null, 1) + '\n')
  for (const name of names) {
    const C = CHANNELS[name]
    console.log(`\n■ ${name}${C.dead ? '' : ` — ${C.note}`}`)
    if (C.dead) { result.channels[name] = { ran: false, why: C.dead, rows: [] }; console.log(`  몰 수 없음: ${C.dead}`); await save(); continue }
    if (E.over) { result.channels[name] = { ran: false, why: `예산 넘음(계측 누계 $${E.spent().toFixed(3)} > $${E.maxUsd})`, codes: ['BUDGET'], rows: [] }; console.log('  예산 넘음: 돌리지 않는다'); await save(); continue }
    const t0 = Date.now()
    let out
    try { out = await C.run(E, fake && C.fakeSrc ? { ...C, src: C.fakeSrc } : C) } catch (e) { out = { rows: [], error: `${e.code || ''} ${e.message}`.trim(), stack: String(e.stack || '').split('\n').slice(0, 4).join(' | ') }; console.log(`  넘어짐: ${out.error}`) } finally {
      // 끊긴 감싸개의 고아(안쪽 Claude)를 거둔다
      const killed = reapPids(E)
      if (killed.length) console.log(`  ! 남은 Claude 프로세스 ${killed.length}개를 껐다: ${killed.join(' ')}`)
    }
    const rows = out.rows || []
    const main = rows.filter((r) => !r.base && r.ran !== false)
    const baseRows = rows.filter((r) => r.base)
    const tot = (rs) => ({
      rows: rs.length, ms: sum(rs.map((r) => r.ms)), cost: r4(sum(rs.map((r) => r.cost))), serverCost: r4(sum(rs.map((r) => r.serverCost))), costGapRows: rs.filter((r) => r.costGap != null).length,
      calls: sum(rs.map((r) => r.calls)), turns: sum(rs.map((r) => r.turns)), fix: sum(rs.map((r) => r.fix)), fixTries: sum(rs.map((r) => r.fixTries)), fails: sum(rs.map((r) => r.fails)), failCalls: sum(rs.map((r) => r.failCalls)),
      put: rs.filter((r) => r.put).length, empty: rs.filter((r) => r.empty).length, nolog: rs.filter((r) => r.nolog).length, needHuman: rs.filter((r) => r.needHuman).length,
      warned: sum(rs.map((r) => r.warned)), accepted: sum(rs.map((r) => r.accepted)),
      tokens: rs.some((r) => r.tokens) ? Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map((k) => [k, sum(rs.map((r) => r.tokens?.[k]))])) : null,
    })
    const chs = main.filter((r) => r.channelOk != null)
    result.channels[name] = {
      ran: !out.error && main.length > 0, expectCh: C.ch, llm: C.llm, note: C.note, wallMs: Date.now() - t0, fed: fedOf(fake && C.fakeSrc ? { ...C, src: C.fakeSrc } : C),
      channelOk: chs.length ? chs.every((r) => r.channelOk) : null, total: tot(main), base: tot(baseRows),
      codes: [...new Set(main.flatMap((r) => r.codes || []))], expected: main.some((r) => r.expect) ? { rows: main.filter((r) => r.expect).length, ok: main.filter((r) => r.expect && r.expectOk).length } : null, ...(out.error ? { error: out.error, stack: out.stack } : {}),
      ...(main.some((r) => r.proxy) ? { proxy: main.find((r) => r.proxy).proxy } : {}),
      ...(out.note ? { note2: out.note } : {}), ...(out.scoreNote ? { scoreNote: out.scoreNote } : {}), dirs: Object.fromEntries(Object.entries(out.dirs || {}).map(([k, v]) => [k, path.relative(ROOT, v)])),
      scoreBefore: out.scoreBefore || null, delta: out.delta || null, score: out.score || null, rows,
    }
    const c = result.channels[name]
    console.log(`  = ${c.ran ? '돌았다' : '안 돌았다'} · channelOk ${c.channelOk} · 들어감 ${c.total.put}/${c.total.rows} · $${c.total.cost.toFixed(3)} · ${Math.round(c.total.ms / 1000)}초 · 부름 ${c.total.calls} · 고쳐 받기 ${c.total.fix} · 실패 ${c.total.fails}${c.base.rows ? ` · 바탕 $${c.base.cost.toFixed(3)} ${Math.round(c.base.ms / 1000)}초` : ''}${c.score?.scope ? ` · F1 ${c.score.f1 ?? '견줄 수 없음'}(알갱이 ${c.score.scope.facts}) 항목 ${c.score.counts?.items ?? '-'}` : ''}`)
    await save()
  }
  if (!fake) console.log(`계측 누계 $${E.spent().toFixed(3)} / 상한 $${E.maxUsd}`)
  console.log(`\n결과: ${path.relative(ROOT, outFile)}`)
}

async function report() {
  let files = process.argv.slice(3).filter((x) => !x.startsWith('--'))
  if (!files.length) files = (await fs.readdir(OUT_DIR).catch(() => [])).filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.json$/.test(f)).map((f) => path.join(OUT_DIR, f))
  if (!files.length) { console.error('결과 파일이 없다(.kmd-data/channel-eval/<날짜>-<판>.json)'); process.exit(1) }
  const tk = (t) => (t ? `${t.input}/${t.output}/${t.cacheRead}/${t.cacheWrite}` : '-')
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(f, 'utf8'))
    console.log(`\n## ${j.tag} · ${j.day} · ${j.fake ? '가짜' : '실제'} Claude${j.model ? ` · ${j.model}` : ''} · ${j.head || ''}\n`)
    if (j.tokensRule) console.log(`토큰 · 차례 · 값 규칙: ${j.tokensRule} · 채점: ${j.scoreRule || '-'}${j.maxUsd ? ` · 지출 상한 $${j.maxUsd}` : ''}\n`)
    console.log('| 채널 | 돌았나 | channelOk | 건 | 들어감 | 빈 | $(계측) | 서버 $ | 초 | 부름 | 차례 | 토큰 in/out/cR/cW | 고쳐 받기(시도) | 실패(부름) | 경고/받아들임 | 코드 | 바탕 $ / 초 | 채점(범위 알갱이) F1 · 빠짐 · 값 | Δ F1 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (const [name, c] of Object.entries(j.channels)) {
      if (!c.total) { console.log(`| ${name} | ${c.codes?.includes('BUDGET') ? '예산 넘음' : '몰 수 없음'} | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | ${String(c.why || '').slice(0, 80)} | - |`); continue }
      const t = c.total
      const sc = c.score || {}
      const scTxt = sc.scope ? `(${sc.scope.facts}) ${sc.f1 ?? '견줄 수 없음'} · ${sc.missRate ?? '-'} · ${sc.valueRate ?? '-'}` : '-'
      console.log(`| ${name}${c.proxy ? ' (대용)' : ''} | ${c.ran ? '예' : `아니오${c.error ? ` (${c.error.slice(0, 40)})` : ''}`} | ${c.channelOk ?? '-'}${t.nolog ? ` (nolog ${t.nolog})` : ''} | ${t.rows} | ${t.put} | ${t.empty} | ${t.cost.toFixed(3)} | ${(t.serverCost ?? 0).toFixed(3)}${t.costGapRows ? ' ≠' : ''} | ${Math.round(t.ms / 1000)} | ${t.calls} | ${t.turns} | ${tk(t.tokens)} | ${t.fix}(${t.fixTries ?? 0}) | ${t.fails}(${t.failCalls ?? 0}) | ${t.warned ?? 0}/${t.accepted ?? 0} | ${(c.codes || []).join(' ') || '-'}${c.expected ? ` (기대한 거절 ${c.expected.ok}/${c.expected.rows})` : ''}${t.needHuman ? ` · 사람 판단 ${t.needHuman}` : ''} | ${c.base?.rows ? `${c.base.cost.toFixed(3)} / ${Math.round(c.base.ms / 1000)}` : '-'} | ${scTxt} | ${c.delta?.f1 ?? '-'} |`)
    }
  }
}

async function main() {
  const cmd = process.argv[2]
  if (cmd === 'plan') return plan()
  if (cmd === 'run') return run()
  if (cmd === 'report') return report()
  console.error('쓰는 법: channel-eval.mjs plan | run --channel <ch>[,…]|all --tag <판> [--fake] [--model <m>] [--confirm-cost] | report [<결과 json>…]')
  process.exit(2)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(() => process.exit(process.exitCode || 0), (e) => { console.error(e); process.exit(1) })
