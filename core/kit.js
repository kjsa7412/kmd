// 에이전트 설치 — 작업 폴더의 Claude Code 에 kmd 를 붙인다(스킬 둘 · 연결 둘 · CLAUDE.md 안 kmd 덩이).
//
//   스킬   <폴더>/.claude/skills/kmd-work · kmd-save (레포의 agent/skills 그대로)
//   연결   <폴더>/.mcp.json 의 mcpServers.kmd(이 PC) · kmd-team(이은 팀) — 열쇠는 넣지 않고 헤더 도우미(kmd-key)가 꺼낸다
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
export const SKILLS = ['kmd-work', 'kmd-save']
const BEGIN = /<!--\s*kmd:begin(?:\s+v=(\S+))?\s*-->/
const END = /<!--\s*kmd:end\s*-->/

async function kitParts() {
  const skills = []
  for (const s of SKILLS) skills.push({ rel: `.claude/skills/${s}/SKILL.md`, text: await fs.readFile(path.join(KIT, 'skills', s, 'SKILL.md'), 'utf8') })
  const block = (await fs.readFile(path.join(KIT, 'CLAUDE-kmd.md'), 'utf8')).replace(/\r/g, '').trim()
  const ver = crypto.createHash('sha256').update(JSON.stringify([skills.map((x) => x.text), block])).digest('hex').slice(0, 8)
  return { skills, block, ver }
}
export const kitVersion = async () => (await kitParts()).ver

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
export async function install(dir, { pcUrl = null, teamUrl = null } = {}) {
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
  if (pcUrl) servers.kmd = mcpConfig(pcUrl)
  if (teamUrl) servers['kmd-team'] = mcpConfig(teamUrl)
  await fs.writeFile(mf, JSON.stringify({ ...cur, mcpServers: servers }, null, 2) + '\n')
  const cf = path.join(full, 'CLAUDE.md')
  await fs.writeFile(cf, withBlock(await fs.readFile(cf, 'utf8').catch(() => ''), block, ver))
  return { dir: full, ver }
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
export async function folders(dataDir) {
  return fs.readFile(listFile(dataDir), 'utf8').then(JSON.parse, () => [])
}
export async function setFolders(dataDir, list) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(listFile(dataDir), JSON.stringify(list, null, 1))
}
