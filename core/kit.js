// 에이전트 설치 — 작업 폴더의 Claude Code 에 kmd 를 붙인다(스킬 셋 · 연결 하나 · CLAUDE.md 안 kmd 덩이).
//
//   지식   폴더 하나에 지식 여럿: 팀(kmd-team · 팀 지식) · 개인(kmd 이 PC · 개인 지식)을 섞어 붙인다. 붙이기는 더하기(덮지 않는다)
//   스킬   <폴더>/.claude/skills/kmd-work · kmd-save · kmd-build (레포의 agent/skills 그대로 · 팀 / 개인 같은 것)
//   연결   <폴더>/.mcp.json 의 mcpServers.kmd(이 PC) · kmd-team(이은 팀) — 붙은 지식의 영역 것만. 열쇠는 넣지 않고 헤더 도우미(kmd-key)가 꺼낸다
//   지식 표  덩이 끝에 「이 폴더의 지식」 표(영역 · 연결 · id · 보는 사람 · 기본 하나). 읽기는 표 전부 · 저장은 기본(사람이 말하면 다른 것)
//   안내   <폴더>/CLAUDE.md 안 `<!-- kmd:begin v=… -->` ~ `<!-- kmd:end -->` — 표지 밖의 줄은 바이트 그대로 둔다
//   판     덩이 표지의 v · 스킬 파일의 지문 — 지금 판과 다르면 「옛 판」 · 없으면 「없음」
//   목록   이 PC 의 붙인 폴더는 <data>/agent.json

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mcpConfig } from './claudecfg.js'
import { KmdError } from './errors.js'

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agent')
export const SKILLS = ['kmd-work', 'kmd-save', 'kmd-build']
const BEGIN = /<!--\s*kmd:begin(?:\s+v=(\S+))?\s*-->/
const END = /<!--\s*kmd:end\s*-->/

async function kitParts() {
  const skills = []
  // 스킬 폴더의 md 전부(SKILL.md · 작성가이드.md …) — 스킬이 옆 파일을 가리킨다
  for (const s of SKILLS) {
    const files = (await fs.readdir(path.join(KIT, 'skills', s))).filter((f) => f.endsWith('.md')).sort()
    for (const f of files) skills.push({ rel: `.claude/skills/${s}/${f}`, text: await fs.readFile(path.join(KIT, 'skills', s, f), 'utf8') })
  }
  const block = (await fs.readFile(path.join(KIT, 'CLAUDE-kmd.md'), 'utf8')).replace(/\r/g, '').trim()
  const ver = crypto.createHash('sha256').update(JSON.stringify([skills.map((x) => x.text), block])).digest('hex').slice(0, 8)
  return { skills, block, ver }
}
export const kitVersion = async () => (await kitParts()).ver

// 폴더 줄의 지식 목록 — [{ area: team|me, kn, knName, team? }] · 옛 꼴 { area, kn, knName, team } 은 하나짜리 목록으로
export function knsOf(f = {}) {
  if (Array.isArray(f.kns)) return f.kns.filter((k) => k && k.kn && (k.area === 'team' || k.area === 'me'))
  return f.area && f.kn ? [{ area: f.area, kn: f.kn, knName: f.knName || f.kn, ...(f.team ? { team: f.team } : {}) }] : []
}
const keyOf = (k) => `${k.area}:${k.kn}`
// 기본 지식 — 정한 것이 목록에 없으면 첫 지식
export function defOf(f = {}) {
  const ks = knsOf(f)
  return (ks.find((k) => keyOf(k) === f.def) || ks[0]) ?? null
}
// 지식 하나 더하기(같은 것이면 이름만 새로) · 기본은 그대로(처음이면 이것)
export function addKn(f, k) {
  const ks = knsOf(f)
  const i = ks.findIndex((x) => keyOf(x) === keyOf(k))
  const next = i < 0 ? [...ks, k] : ks.map((x, j) => (j === i ? k : x))
  const { area, kn, knName, team, ...rest } = f
  return { ...rest, kns: next, def: defOf(f) ? keyOf(defOf(f)) : keyOf(k) }
}
// 지식 하나 떼기 — 기본을 떼면 남은 첫 지식이 기본
export function dropKn(f, area, kn) {
  const ks = knsOf(f).filter((x) => keyOf(x) !== `${area}:${kn}`)
  const { area: _a, kn: _k, knName, team, ...rest } = f
  return { ...rest, kns: ks, def: ks.some((x) => keyOf(x) === f.def) ? f.def : ks[0] ? keyOf(ks[0]) : null }
}
export function setDef(f, area, kn) {
  if (!knsOf(f).some((x) => keyOf(x) === `${area}:${kn}`)) throw new KmdError('E_INPUT', '이 폴더에 붙지 않은 지식이다')
  return { ...f, kns: knsOf(f), def: `${area}:${kn}` }
}

// 이 폴더의 지식 표(덩이 안 · 판 지문에는 들지 않는다)
export function knLine({ kns = [], def = null } = {}) {
  if (!kns.length) return ''
  const d = defOf({ kns, def })
  const row = (k) => `| 「${k.knName || k.kn}」${keyOf(k) === keyOf(d) ? ' (기본)' : ''} | ${k.area === 'team' ? '팀' : '개인'} | ${k.area === 'team' ? 'kmd-team' : 'kmd'} | ${k.kn} | ${k.area === 'team' ? '이 팀 지식을 보는 팀 사람' : '나만(이 PC)'} |`
  return [
    '\n\n## 이 폴더의 지식\n',
    '| 지식 | 영역 | 연결 | id | 남기면 보는 사람 |',
    '|---|---|---|---|---|',
    ...kns.map(row),
    '',
    '- 읽기(`kmd-work`): 이 표의 지식 모두에서 찾는다. 연결마다 `brief` · `match` 의 knowledge 에 그 id 를 준다.',
    `- 기록 · 저장(\`kmd-save\`): 기본 지식 「${d.knName || d.kn}」 에 남긴다. 사람이 표의 다른 지식을 말하면 이 세션 동안은 그 지식에 남긴다.`,
    '- 기본이 아닌 지식(특히 팀 지식)에는 사람이 말할 때만 남긴다. 어디에 남길지 애매하면 이 표를 보여 주고 묻는다.',
    '- 표에 없는 지식은 사람이 말할 때만 읽는다.',
  ].join('\n')
}
function withBlock(text, block, ver) {
  const body = `<!-- kmd:begin v=${ver} -->\n${block}\n<!-- kmd:end -->`
  const t = String(text || '')
  const b = t.match(BEGIN)
  const e = t.match(END)
  if (b && e && e.index > b.index) return t.slice(0, b.index) + body + t.slice(e.index + e[0].length)
  return (t.trim() ? t.replace(/\s*$/, '\n\n') : '') + body + '\n'
}
function withoutBlock(text) {
  const t = String(text || '')
  const b = t.match(BEGIN)
  const e = t.match(END)
  if (!b || !e || e.index < b.index) return t
  return (t.slice(0, b.index).replace(/\s*$/, '') + '\n' + t.slice(e.index + e[0].length).replace(/^\s*/, '')).replace(/^\n$/, '')
}

async function checkDir(dir) {
  const full = path.resolve(String(dir || ''))
  if (!path.isAbsolute(String(dir || '')) || !(await fs.stat(full).then((s) => s.isDirectory(), () => false))) throw new KmdError('E_NOTFOUND', '그 폴더가 없다')
  return full
}

// 붙이기 · 최신으로 — 같은 일(덮어쓰기는 kmd 의 것만)
//   kns · def — 이 폴더의 지식 목록과 기본(폴더 줄 그대로 · knsOf). 연결은 목록에 든 영역의 것만 · 목록이 비면 둘 다
export async function install(dir, { pcUrl = null, teamUrl = null, kns = [], def = null } = {}) {
  const full = await checkDir(dir)
  const { skills, block, ver } = await kitParts()
  for (const s of skills) {
    const f = path.join(full, ...s.rel.split('/'))
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, s.text)
  }
  const mf = path.join(full, '.mcp.json')
  const cur = await fs.readFile(mf, 'utf8').then(JSON.parse, () => ({}))
  const servers = { ...(cur.mcpServers || {}) }
  const has = (a) => !kns.length || kns.some((k) => k.area === a)
  const tUrl = kns.find((k) => k.area === 'team' && k.team)?.team || teamUrl
  if (has('me') && pcUrl) servers.kmd = mcpConfig(pcUrl)
  if (has('team') && tUrl) servers['kmd-team'] = mcpConfig(tUrl)
  if (!has('me')) delete servers.kmd
  if (!has('team')) delete servers['kmd-team']
  await fs.writeFile(mf, JSON.stringify({ ...cur, mcpServers: servers }, null, 2) + '\n')
  const cf = path.join(full, 'CLAUDE.md')
  await fs.writeFile(cf, withBlock(await fs.readFile(cf, 'utf8').catch(() => ''), block + knLine({ kns, def }), ver))
  return { dir: full, ver, kns, def: defOf({ kns, def }) }
}

export async function status(dir) {
  const full = path.resolve(dir)
  const { skills, ver } = await kitParts()
  const t = await fs.readFile(path.join(full, 'CLAUDE.md'), 'utf8').catch(() => '')
  const m = t.match(BEGIN)
  if (!m) return { state: 'none', ver: null, latest: ver }
  const same = await Promise.all(skills.map(async (s) => (await fs.readFile(path.join(full, ...s.rel.split('/')), 'utf8').catch(() => null)) === s.text))
  return { state: m[1] === ver && same.every(Boolean) ? 'latest' : 'old', ver: m[1] || '?', latest: ver }
}

export async function remove(dir) {
  const full = path.resolve(dir)
  for (const s of SKILLS) await fs.rm(path.join(full, '.claude', 'skills', s), { recursive: true, force: true })
  const mf = path.join(full, '.mcp.json')
  const cur = await fs.readFile(mf, 'utf8').then(JSON.parse, () => null)
  if (cur?.mcpServers) {
    delete cur.mcpServers.kmd
    delete cur.mcpServers['kmd-team']
    if (!Object.keys(cur.mcpServers).length && Object.keys(cur).length === 1) await fs.rm(mf, { force: true })
    else await fs.writeFile(mf, JSON.stringify(cur, null, 2) + '\n')
  }
  const cf = path.join(full, 'CLAUDE.md')
  const t = await fs.readFile(cf, 'utf8').catch(() => null)
  if (t != null) {
    const rest = withoutBlock(t)
    if (rest.trim()) await fs.writeFile(cf, rest)
    else await fs.rm(cf, { force: true })
  }
  return { dir: full }
}

// 이 PC 의 붙인 폴더 목록
const listFile = (dataDir) => path.join(dataDir, 'agent.json')
// 옛 줄({ area, kn, knName, team })도 { kns, def } 로 읽는다
export async function folders(dataDir) {
  const list = await fs.readFile(listFile(dataDir), 'utf8').then(JSON.parse, () => [])
  return list.map((f) => {
    const { area, kn, knName, team, ...rest } = f
    const d = defOf(f)
    return { ...rest, kns: knsOf(f), def: d ? keyOf(d) : null }
  })
}
export async function setFolders(dataDir, list) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(listFile(dataDir), JSON.stringify(list, null, 1))
}
