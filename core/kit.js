// 개인 에이전트 설치 — 작업 폴더의 Claude Code 에 개인 지식을 붙인다(스킬 셋 · 연결 kmd · CLAUDE.md 안 kmd 덩이). 개인 프로그램이 한다.
//   팀 지식은 따로: 팀 화면 › 설정 › 에이전트 설치의 한 줄(core/teamkit.js · 스킬 kmd-team-* · 연결 kmd-team · kmd-team 덩이). 여기서는 건드리지 않는다
//
//   지식   폴더 하나에 개인 지식 여럿. 붙이기는 더하기(덮지 않는다)
//   스킬   <폴더>/.claude/skills/kmd-work · kmd-save · kmd-build (레포의 agent/skills 그대로)
//   연결   <폴더>/.mcp.json 의 mcpServers.kmd(이 PC). 열쇠는 넣지 않고 헤더 도우미(kmd-key)가 꺼낸다
//   지식 표  덩이 끝에 「이 폴더의 개인 지식」 표. 읽기는 표 전부 · 저장은 여럿이면 세션이 묻는다(기본 지식은 두지 않는다)
//   안내   <폴더>/CLAUDE.md 안 `<!-- kmd:begin v=… -->` ~ `<!-- kmd:end -->` — 표지 밖의 줄은 바이트 그대로 둔다
//   판     덩이 표지의 v · 스킬 파일의 지문 — 지금 판과 다르면 「옛 판」 · 없으면 「없음」
//   목록   이 PC 의 붙인 폴더는 <data>/agent.json

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mcpConfig } from './claudecfg.js'
import { KmdError } from './errors.js'
import { writeJsonAtomic } from './atomic.js'

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

// 폴더 줄의 개인 지식 목록 — [{ area: 'me', kn, knName }] · 옛 꼴 { area, kn, knName } 은 하나짜리 목록으로 · 팀 지식 줄(예전 한 덩이)은 읽지 않는다
export function knsOf(f = {}) {
  const ks = Array.isArray(f.kns) ? f.kns : f.area && f.kn ? [{ area: f.area, kn: f.kn, knName: f.knName || f.kn }] : []
  return ks.filter((k) => k && k.kn && k.area === 'me').map((k) => ({ area: 'me', kn: k.kn, knName: k.knName || k.kn }))
}
// 개인 지식 하나 더하기(같은 것이면 이름만 새로) · 팀 지식은 받지 않는다(팀 화면 › 설정 › 에이전트 설치)
export function addKn(f, k) {
  const ks = knsOf(f)
  if (k.area && k.area !== 'me') return { ...f, kns: ks }
  const i = ks.findIndex((x) => x.kn === k.kn)
  const one = { area: 'me', kn: k.kn, knName: k.knName || k.kn }
  const { area, kn, knName, team, def, ...rest } = f
  return { ...rest, kns: i < 0 ? [...ks, one] : ks.map((x, j) => (j === i ? one : x)) }
}
// 개인 지식 하나 떼기
export function dropKn(f, kn) {
  const { area, kn: _k, knName, team, def, ...rest } = f
  return { ...rest, kns: knsOf(f).filter((x) => x.kn !== kn) }
}

// 이 폴더의 개인 지식 표(덩이 안 · 판 지문에는 들지 않는다)
export function knLine({ kns = [] } = {}) {
  if (!kns.length) return ''
  return [
    '\n\n## 이 폴더의 개인 지식\n',
    '| 지식 | id | 남기면 보는 사람 |',
    '|---|---|---|',
    ...kns.map((k) => `| 「${k.knName || k.kn}」 | ${k.kn} | 나만(이 PC) |`),
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

// 붙이기 · 최신으로 — 같은 일(덮어쓰기는 kmd 의 것만 · 팀 연결 kmd-team 과 팀 덩이는 그대로)
//   kns — 이 폴더의 개인 지식 목록(knsOf)
export async function install(dir, { meUrl = null, kns = [] } = {}) {
  const full = await checkDir(dir)
  const { skills, block, ver } = await kitParts()
  for (const s of skills) {
    const f = path.join(full, ...s.rel.split('/'))
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, s.text)
  }
  const mf = path.join(full, '.mcp.json')
  // 깨진 .mcp.json 은 빈 것으로 읽어 덮지 않는다(다른 연결이 사라진다)
  const raw = await fs.readFile(mf, 'utf8').catch(() => null)
  let cur = {}
  if (raw != null) { try { cur = JSON.parse(raw) } catch { throw new KmdError('E_INPUT', `${mf} 가 JSON 이 아니다. 고친 뒤 다시 붙인다`) } }
  const servers = { ...(cur.mcpServers || {}) }
  const mine = knsOf({ kns })
  if (meUrl) servers.kmd = mcpConfig(meUrl)
  await fs.writeFile(mf, JSON.stringify({ ...cur, mcpServers: servers }, null, 2) + '\n')
  const cf = path.join(full, 'CLAUDE.md')
  await fs.writeFile(cf, withBlock(await fs.readFile(cf, 'utf8').catch(() => ''), block + knLine({ kns: mine }), ver))
  return { dir: full, ver, kns: mine }
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
  // 팀 지식만 붙었던 폴더(예전 한 덩이)는 개인 목록에 두지 않는다 — 팀 화면의 에이전트 설치가 맡는다
  const had = (f) => (Array.isArray(f.kns) ? f.kns.length > 0 : !!(f.area && f.kn))
  return list.filter((f) => !had(f) || knsOf(f).length).map((f) => {
    const { area, kn, knName, team, def, ...rest } = f
    return { ...rest, kns: knsOf(f) }
  })
}
export async function setFolders(dataDir, list) {
  await writeJsonAtomic(listFile(dataDir), list, { indent: 1 })
}
