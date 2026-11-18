// 옛 꼴 이행기: 지식 폴더 하나의 「옛 꼴 → 지금 꼴」 을 계산하고(plan) 지식에 쓴다(apply · 커밋 하나).
//
//   옛 꼴을 아는 곳은 이 파일 하나다(docs/품질개선/KMD_옛잔재_정리.md O-9). 다른 코드는 지금 꼴만 읽는다.
//   그래서 지금 코드(guard · namebook · vocab · registry · knowledge · docformat · sections)가 옛 꼴을 읽는 결과를
//   여기서 똑같이 계산해 지금 꼴로 굳혀 적는다. 옛 읽기는 그 파일에서 복사해 둔다(G 에서 원본을 지운다 · 출처 주석).
//
//   plan(dir, opt) → { changes: [{ path, kind: 'write'|'delete', before?, after?, why, rule }], judge: [{ what, where, count, why }], counts, allow }
//     기계 규칙은 모두 멱등이다(두 번 돌리면 바뀜 0). 사람 · 세션 판단이 드는 것은 judge 로만(쓰지 않는다).
//     opt.personal: 개인 지식(옛 표지 기록 · 저절로 채우는 표 블록 · 사본 문서 표지도 기계로)
//     opt.drop: 지울 기록 id 목록(세션이 값 대조 뒤 정한 것) · 그 기록을 가리키는 줄도 같이 걷는다
//   apply(dir, plan, { user, msg }) → { commit, log, files }: 지금 꼴로 다시 읽은 기록 상태가 앞과 같아야 쓴다(아니면 아무것도 쓰지 않고 오류)
//   runOnce(dir, { personal: true }): 개인 지식 자동 이행(.git/kmd-oldform 판 표시가 없을 때 한 번)

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { readText, nfc } from './text.js'
import { splitFrontmatter, parseRecord, renderRecord } from './frontmatter.js'
import { splitRef, withRef, parseRefLine, isLogEntry, parseDoc, replaceSection, REF_OPEN, REF_CLOSE } from './sections.js'
import { locate } from './registry.js'
import { parseForms, TYPE_RE } from './guard.js'
import { parseMembers, sameAccess } from './owners.js'
import { renderPut, parsePut, dropPart } from './parts.js'
import { convertDoc } from './docformat.js'
import { toLevels } from './levels.js'
import { loadKnowledge, sectionOf } from './knowledge.js'
import { LOG_DIR } from './names.js'
import { writeFileAtomic } from './atomic.js'
import { begin, writeAtomic } from './journal.js'
import { ensureRepo, git } from './git.js'
import { serial, localStamp, recordTaken } from './save.js'
import { KmdError } from './errors.js'

// 이행 판: 개인 지식의 .git/kmd-oldform 에 적는다(이 판을 지난 지식은 다시 돌리지 않는다)
export const OLDFORM_VER = 1
export const MARK_FILE = 'kmd-oldform'

// 기계 규칙 id: 셈 표의 차례
export const RULES = ['forms.newdoc', 'forms.head', 'vocab.head', 'vocab.dash', 'registry.head', 'members', 'record.state', 'record.oldtag', 'record.fm', 'record.drop', 'record.refs', 'record.logdir', 'doc.marks', 'doc.blocks', 'ref.line', 'log.old', 'seed']
export const RULE_SAY = {
  'forms.newdoc': '갈래 장부 새 문서 줄',
  'forms.head': '갈래 장부 옛 표 머리',
  'vocab.head': '항목 장부 옛 머리글',
  'vocab.dash': '항목 장부 줄표 줄',
  'registry.head': '문서 장부 옛 제목 · 표',
  members: '사람 장부 옛 줄',
  'record.state': '저장 문 밖 기록 굳히기(put · 넣은 것)',
  'record.oldtag': '옛 표지 기록(넣지 못함 · 메모 · 이행)',
  'record.fm': '기록 머리말 옛 칸(source · attachments)',
  'record.drop': '넘겨받은 지울 기록',
  'record.refs': '지운 기록을 가리키는 줄',
  'record.logdir': 'work/ 에 쓴 이력(이력 태그)을 log/ 로',
  'doc.marks': '문서 옛 표식 · 옛 꼴',
  'doc.blocks': '저절로 채우는 표 블록 · 사본 문서 표지',
  'ref.line': '참고 블록의 옛 기록 줄(링크 뒤 「 · 」 없는 한 마디)',
  'log.old': '정리 시절 이력',
  seed: '세움 메모 · 기록 없는 첨부',
}

// ── 옛 읽기의 사본(G 에서 원본을 걷는다) ──

// core/namebook.js VOCAB_HEAD · REG_HEAD(지금 머리 글)
const VOCAB_HEAD = '# 항목 장부\n\n항목마다 `종류:값` 하나를 정하고 같은 것을 가리키는 다른 말은 별칭으로 잇는다.\n'
const REG_TABLE = '| 항목 | 문서 | 머리 |\n|---|---|---|\n'
const REG_HEAD = `# 문서 장부\n\n항목 하나가 어느 문서의 어느 머리(\`##\`)인지 여기에만 적는다.\n\n${REG_TABLE}`
// core/guard.js formsOf: 「- 새 문서:」 줄이 없는 옛 갈래 장부(갈래 줄이 있다)는 닫힘으로 읽었다
const CLOSED_RE = /^\s*[-*]\s*새 문서\s*[:：]\s*(닫음|열림)/m
const oldClosed = (text) => { const m = CLOSED_RE.exec(String(text || '')); return m ? m[1] === '닫음' : parseForms(text).length > 0 }
// core/vocab.js parseVocab(2026-11-18 판): 줄표 라벨 줄 · 라벨 꼬리 (구)/(example) 도 읽던 옛 읽기(대 보기의 「앞」 을 옛 읽기로 본다)
function oldVocab(text) {
  const coords = new Map()
  let cur = null
  for (const raw of String(text || '').split('\n')) {
    if (/^##\s+(.+?)\s*$/.test(raw)) { cur = null; continue }
    if (/^뜻\s*[:：]\s*(.+)$/.test(raw)) continue
    const m = raw.match(/^\s*-\s+`([^`\s:]+:[^`]+)`\s*(?:[—–:-]\s*(.*))?$/)
    if (m) {
      const coord = nfc(m[1].trim())
      cur = { coord, label: nfc((m[2] || '').replace(/\s*\((?:구|example)\)\s*$/, '').trim()) || coord.split(':').slice(1).join(':'), aliases: [], deprecated: null, gist: '' }
      coords.set(coord, cur)
      continue
    }
    const a = raw.match(/^\s+aliases:\s*(.+)$/)
    if (a && cur) { cur.aliases.push(...a[1].split(',').map((x) => nfc(x.trim())).filter(Boolean)); continue }
    const d = raw.match(/^\s+deprecated:\s*(.+)$/)
    if (d && cur) { cur.deprecated = d[1].trim(); continue }
    const gm = raw.match(/^\s+gist:\s*(.+)$/)
    if (gm && cur) { cur.gist = nfc(gm[1].trim()).slice(0, 80); continue }
    if (/^\S/.test(raw)) cur = null
  }
  return { coords }
}
// core/names.js 의 옛 표지(저장 승인 전) · 정리 시절 이력 태그(O-10)
const OLD_TAGS = ['held', 'memo', 'migrate-held']
// core/parts.js 의 옛 칸(저장 승인 전 넣지 못함 · json 울타리 칸)
const HELD_PART = '넣지 못함'
function dropHeld(body) {
  const s = String(body || '')
  const at = [...s.matchAll(new RegExp(`^## ${HELD_PART}[ \\t]*$`, 'gm'))].pop()?.index ?? -1
  if (at < 0) return s
  const m = s.slice(at).match(/^## [^\n]*\n(`{3,})json\n[\s\S]*?\n\1[ \t]*$/m)
  return m ? (s.slice(0, at) + s.slice(at + m.index + m[0].length)).replace(/\s+$/, '') : dropPart(s, HELD_PART)
}
const OLD_LOG_TAGS = ['curate', 'curate-llm', 'curate-auto', 'docfmt', 'levels', 'tidy']
// core/names.js LOG_TAGS(지금): 기록 · 이력 가르기
const LOG_TAGS = ['edit', 'curate-auto', 'curate-llm', 'alias-auto', 'sources', 'polish', 'revert', 'drop', 'ledger', 'shape-done', 'format']
const isLogRecord = (tags) => (tags || []).some((t) => LOG_TAGS.includes(t))

// core/knowledge.js recordState · reflectedState · reflectedIn(2026-11-18 판): put 이 없는 기록의 옛 상태 읽기
//   s: { reflected: Set, superseded: Set, reverted: Set, byWork: Map(id → { date, reflects, tags }) }
const INGEST = (w) => w.tags.some((t) => /^(ingest|touches\??)\//.test(t))
const arrivedOf = (w) => {
  const t = w.tags.find((x) => /^recv\/\d{12}$/.test(x))
  return t ? t.slice(5).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5') : w.date
}
function reflectedIn(s, w, sec) {
  if (!sec?.applied) return false
  if (sec.applied === w.id) return true
  const a = s.byWork.get(sec.applied)
  if (a?.reflects?.includes(w.id)) return true
  return !!a && a.date > arrivedOf(w)
}
function reflectedState(k, s, w) {
  if (!w.touches.length) {
    if (s.reflected.has(w.id)) return 'in'
    if (w.tags.some((t) => t.startsWith('ingest/'))) return 'old'
    return isLogRecord(w.tags) || INGEST(w) || w.curates.length || w.reopens.length ? 'none' : 'old'
  }
  let any = false
  for (const c of w.touches) {
    const x = sectionOf(k, c)
    if (!x) continue
    any = true
    if (!reflectedIn(s, w, x.sec)) return 'old'
  }
  if (!any && w.tags.includes('code-change')) return s.reflected.has(w.id) ? 'in' : 'old'
  return any ? 'in' : 'none'
}
// 옛 상태 재료: 기록 · 이력 목록에서(머리말 reflects 는 frontmatter.js 가 읽는다)
function oldView(all) {
  return {
    reflected: new Set(all.flatMap((w) => w.reflects || [])),
    reverted: new Set(all.flatMap((w) => w.reopens || [])),
    superseded: new Set(all.filter((w) => w.fixes?.length && !w.tags.some((t) => ['held', 'migrate-held', 'touches-fix'].includes(t))).flatMap((w) => w.fixes)),
    byWork: new Map(all.map((w) => [w.id, { date: w.date, reflects: w.reflects || [], tags: w.tags }])),
  }
}
// 지식 하나를 옛 읽기로 본 기록 상태(대 보기의 「앞」 · 시험이 옮기기 전 상태를 잰다): put 기록은 지금 상태 · 그 밖은 옛 상태
//   work/ 의 이력 태그 기록은 옛 읽기에서 이력이라 뺀다
export function oldStates(k) {
  const s = oldView([...k.works, ...k.logs])
  const out = new Map()
  for (const w of k.works) {
    if (isLogRecord(w.tags)) continue
    out.set(w.id, (w.tags || []).includes('put') && !w.tags.some((t) => t === 'held' || t === 'memo') ? w.state : oldStateOf(k, s, w).state)
  }
  return out
}
// put 이 없는 기록의 옛 상태: { state, base(바로잡힘을 빼고 본 상태) }
export function oldStateOf(k, s, w) {
  const tags = w.tags || []
  if (tags.some((t) => t === 'curate-auto' || t === 'curate-llm' || t === 'touches-fix')) return { state: 'none', base: 'none' }
  if (s.reverted.has(w.id)) return { state: 'reverted', base: 'reverted' }
  if (tags.some((t) => t === 'held' || t === 'memo')) return { state: 'old', base: 'old' }
  const sup = s.superseded.has(w.id)
  const base = reflectedState(k, s, w)
  return { state: sup && base !== 'none' ? 'fixed' : base, base }
}

// ── 글 도우미 ──
const nl = (t) => String(t ?? '').replace(/\r\n/g, '\n')
const endNl = (t) => (t.endsWith('\n') ? t : t + '\n')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const walk = async (root, rel = '', out = []) => {
  const ents = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch((e) => { if (e?.code === 'ENOENT') return []; throw e })
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) await walk(root, r, out)
    else out.push(nfc(r))
  }
  return out
}
const readOr = (full) => fs.readFile(full, 'utf8').then(readText, () => null)
// 참고 줄 href → 기록 id(마지막 경로 조각 · scripts/kmd-migrate.mjs idOfHref 와 같다)
const idOfHref = (href) => {
  const m = String(href || '').match(/(?:^|\/)(?:work|log)\/([^/]+)\.md$/)
  if (!m) return null
  try {
    return nfc(decodeURI(m[1]).replace(/%28/g, '(').replace(/%29/g, ')'))
  } catch {
    return nfc(m[1])
  }
}

// ── 머리말(frontmatter) 줄 고치기: 다른 칸의 글자는 그대로 두고 한 칸만 바꾼다 ──
const FM = /^---\n([\s\S]*?)\n---(?:\n|$)/
function fmSplit(text) {
  const m = text.match(FM)
  if (!m) return null
  return { lines: m[1].split('\n'), rest: text.slice(m[0].length) }
}
const fmJoin = (lines, rest) => `---\n${lines.join('\n')}\n---\n${rest}`
// 칸 하나의 줄 범위 [a, b) · 없으면 null
function keyRange(lines, key) {
  const a = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l))
  if (a < 0) return null
  let b = a + 1
  while (b < lines.length && (/^\s/.test(lines[b]) || /^-\s/.test(lines[b]) || !lines[b].trim())) b++
  return [a, b]
}
// 칸 하나를 값으로(null 이나 빈 목록이면 칸을 걷는다) · 없던 칸은 끝에
function setKey(lines, key, value) {
  const out = lines.slice()
  const r = keyRange(out, key)
  const empty = value == null || (Array.isArray(value) && !value.length)
  const add = empty ? [] : yaml.dump({ [key]: value }, { lineWidth: -1, quotingType: '"', forceQuotes: false }).replace(/\n$/, '').split('\n')
  if (r) out.splice(r[0], r[1] - r[0], ...add)
  else out.push(...add)
  return out
}

// ── 장부 규칙(순수 함수 · 글 → 새 글) ──

// forms.newdoc: 갈래 줄이 있고 「- 새 문서:」 줄이 없으면 옛 읽기(닫힘) 그대로 「- 새 문서: 닫음」 을 머리 아래(첫 표 앞)에
export function formsNewdoc(text) {
  const t = nl(text)
  if (!t.trim() || CLOSED_RE.test(t) || !parseForms(t).length) return t
  const lines = t.split('\n')
  let at = lines.findIndex((l) => /^\|/.test(l))
  if (at < 0) at = lines.length
  lines.splice(at, 0, '- 새 문서: 닫음', '')
  return lines.join('\n')
}
// forms.head: 갈래 표 옛 머리 「다른 이름」 · 「이름」 → 「별칭」 · 「항목」(core/guard.js parseForms 는 칸 차례로 읽는다)
const FORMS_TABLE_HEAD = '| 갈래 | 별칭 | 폴더 | 종류 | 항목 | 서식 |'
export function formsHead(text) {
  return nl(text).split('\n').map((l) => {
    const cells = l.match(/^\|(.+)\|\s*$/)?.[1].split('|').map((x) => x.trim())
    if (!cells || cells[0] !== '갈래' || cells.length !== 6) return l
    return cells[1] === '별칭' && cells[4] === '항목' ? l : FORMS_TABLE_HEAD
  }).join('\n')
}

// vocab.head: 첫 종류(줄이 있는 `## 종류`) 앞의 옛 제목 · 안내 단락을 지금 머리로(항목 줄은 손대지 않는다)
const OLD_VOCAB = /좌표|ctx|아직 비어 있다|excluded|통제 어휘|authority|큐레이터|이름 장부|정본/
function vocabHeadEnd(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/)
    if (!m || !TYPE_RE.test(nfc(m[1]))) continue
    let j = i + 1
    while (j < lines.length && !/^##\s/.test(lines[j])) {
      if (/^\s*-\s+`[^`\s:]+:[^`]+`/.test(lines[j]) || /^뜻\s*[:：]/.test(lines[j])) return i
      j++
    }
  }
  return -1
}
export function vocabHead(text) {
  const t = nl(text)
  const lines = t.split('\n')
  const end = vocabHeadEnd(lines)
  if (end < 0) return t
  const head = lines.slice(0, end).join('\n')
  if (head.trim() === VOCAB_HEAD.trim()) return t
  if (/^#\s+항목 장부\s*$/.test(lines[0] || '') && !OLD_VOCAB.test(head)) return t
  return `${VOCAB_HEAD}\n${lines.slice(end).join('\n')}`
}
// vocab.dash: 줄표(엠대시 · 엔대시 · 붙임표) 라벨 줄 · 라벨 꼬리 (구)/(example) · 폐기 줄의 줄표 까닭 → 쌍점 꼴(core/vocab.js parseVocab 의 옛 읽기)
export function vocabDash(text) {
  return nl(text).split('\n').map((l) => {
    const m = l.match(/^(\s*-\s+`[^`\s:]+:[^`]+`)\s*([—–:-])\s*(.*)$/)
    if (m) {
      const label = m[3].replace(/\s*\((?:구|example)\)\s*$/, '').trim()
      if (m[2] === ':' && label === m[3]) return l
      return label ? `${m[1]}: ${label}` : m[1]
    }
    const d = l.match(/^(\s+deprecated:\s*.*?→\s*[^\s`]+:[^\s`]+?)\s+[—–]\s+(.*)$/)
    return d ? `${d[1]}: ${d[2]}` : l
  }).join('\n')
}
// vocab 의 종류 절 안 설명 글(항목 줄 · 이어지는 줄 · 뜻 줄이 아닌 것): 사람이 뜻 줄로 옮길지 정한다
function vocabProse(text) {
  const lines = nl(text).split('\n')
  const end = vocabHeadEnd(lines)
  const out = []
  for (let i = Math.max(0, end); i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim() || /^##\s/.test(l) || /^\s*-\s+`/.test(l) || /^\s+\S/.test(l) || /^뜻\s*[:：]/.test(l)) continue
    out.push(i + 1)
  }
  return out
}

// registry.head: 옛 제목(관리 문서 등록부 · 등록부) · 옛 표 머리 · 덧칸 · 설명 단락 → 「# 문서 장부」 한 표(줄 차례 그대로)
const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`(#{1,6})\s+([^`]+)`\s*\|/
const WHOLE_RE = /^\|\s*`([^`]+)`\s*\|\s*`(docs\/[^`]+\.md)`\s*\|\s*(?:—|-)\s*\|/
export function registryRows(text) {
  const rows = []
  const odd = []
  nl(text).split('\n').forEach((l, i) => {
    const m = l.match(ROW_RE)
    if (m) return void rows.push(`| \`${m[1].trim()}\` | \`${m[2].trim()}\` | \`${m[3]} ${m[4].trim()}\` |`)
    const w = l.match(WHOLE_RE)
    if (w) return void rows.push(`| \`${w[1].trim()}\` | \`${w[2].trim()}\` | - |`)
    if (/^\|\s*`/.test(l)) { rows.push(l.replace(/\s+$/, '')); odd.push(i + 1) }
  })
  return { rows, odd }
}
export function registryHead(text) {
  const t = nl(text)
  if (!t.trim()) return t
  const { rows } = registryRows(t)
  const next = `${REG_HEAD}${rows.join('\n')}${rows.length ? '\n' : ''}`
  return next === t ? t : next
}

// members: 「- 정리:」(값은 지식관리자 자리로) · 「- 저장 방식:」 · 「- 정리 방식:」 · 옛 「- 관리:」 → 지금 자리 표(core/owners.js parseMembers)
const MEM_RE = /^\s*[-*]\s*(주인|정리 방식|정리|Claude 에 보내지 않음|이슈 주소|승인 받고 넣기|저장 방식|모두|읽기|쓰기|지식관리자|관리|묶음)\s*[:：]\s*(.*?)\s*$/
const ids = (s) => String(s || '').split(/[,\s·]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
// core/owners.js parseMembers(2026-11-18 앞 판): 「정리」 줄은 지식관리자 목록 · 「관리」 는 지식관리자 · 설정 줄
const LV = { 없음: 'none', 읽기: 'read', 쓰기: 'write', 지식관리자: 'admin', 관리: 'admin' }
const RANK = { none: 0, read: 1, write: 2, admin: 3 }
export function oldMembers(text) {
  const out = { owner: null, curators: [], noClaude: false, access: null }
  for (const line of nl(text).split('\n')) {
    const m = MEM_RE.exec(line)
    if (!m) continue
    if (['모두', '읽기', '쓰기', '지식관리자', '관리', '묶음'].includes(m[1])) {
      out.access ||= { all: 'none', users: {}, groups: {} }
      if (m[1] === '모두') out.access.all = LV[m[2]] || 'none'
      else if (m[1] === '묶음') {
        for (const part of m[2].split(/[,·]/)) {
          const [g, l] = part.split('=').map((x) => (x || '').trim())
          if (g && LV[l] && LV[l] !== 'none') out.access.groups[g] = LV[l]
        }
      } else for (const u of ids(m[2])) if (RANK[LV[m[1]]] > RANK[out.access.users[u] || 'none']) out.access.users[u] = LV[m[1]]
    } else if (m[1] === '주인') out.owner = m[2] || null
    else if (m[1] === '정리') out.curators = m[2].split(/[,\s·]+/).filter(Boolean)
    else if (m[1] === 'Claude 에 보내지 않음') out.noClaude = /^(예|네|yes|true|1)$/i.test(m[2])
  }
  return out
}
export function membersFix(text) {
  const t = nl(text)
  const lines = t.split('\n')
  const keyOf = (l) => MEM_RE.exec(l)?.[1] || null
  const has = (k) => lines.some((l) => keyOf(l) === k)
  const accessLines = lines.some((l) => ['모두', '읽기', '쓰기', '지식관리자', '묶음'].includes(keyOf(l)))
  const admins = []
  let stuck = false
  const out = []
  for (const l of lines) {
    const k = keyOf(l)
    const v = MEM_RE.exec(l)?.[2] || ''
    if (k === '정리' || k === '관리') {
      if (ids(v).length && !accessLines && k === '정리') { stuck = true; out.push(l); continue }
      admins.push(...ids(v))
      if (k === '관리' && !has('지식관리자')) { out.push(`- 지식관리자: ${[...new Set(ids(v))].join(', ')}`); continue }
      continue
    }
    if (k === '저장 방식') continue
    if (k === '정리 방식') {
      if (!has('Claude 에 보내지 않음')) out.push('- Claude 에 보내지 않음: 아니오')
      continue
    }
    out.push(l)
  }
  if (admins.length) {
    const i = out.findIndex((l) => keyOf(l) === '지식관리자')
    if (i >= 0) {
      const all = [...new Set([...ids(MEM_RE.exec(out[i])[2]), ...admins])]
      out[i] = `- 지식관리자: ${all.join(', ')}`
    } else if (accessLines) {
      const w = out.findIndex((l) => keyOf(l) === '쓰기')
      out.splice(w >= 0 ? w + 1 : out.length, 0, `- 지식관리자: ${[...new Set(admins)].join(', ')}`)
    }
  }
  return { text: out.join('\n'), stuck }
}

// ── 문서 규칙 ──
// doc.marks: 참고 블록의 옛 표식 메모(「표식: cdp:form …」 · 「표식: gen: … 이 줄 아래는 다시 쓴다」)
const OLD_MARK_NOTE = /^-\s+표식:\s*(?:cdp:form\b|gen\s*:.*이 줄 아래)/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const BASE_OPEN = /^\s{0,3}<!--\s*baseline:.*-->\s*$/
const BASE_CLOSE = /^\s{0,3}<!--\s*\/baseline\s*-->\s*$/
const WATCHED = /^<!--\s*watched:.*-->\s*$/

// 문서 하나: 지운 기록의 참고 줄 · 표지 · 옛 표식 메모 · (개인) 블록 표식 · 사본 표지 → { text, n: { refs, applied, marks, blocks, watched, stuck } }
//   gone: 지운 기록 id 모음. 지운 기록을 가리키는 표지는 걷기만 한다(다른 기록으로 옮기지 않는다:
//   옮긴 표지는 git 이력에 없던 것이라 되돌리기가 그 기록을 잘못 연다 · 굳힌 기록은 put 으로 읽혀 표지에 기대지 않는다)
//   표지 읽기 · 쓰기는 sections.js parseDoc · replaceSection 으로만(울타리 처리를 한 곳에)
export function fixDoc(text0, { gone = new Set(), personal = false } = {}) {
  let text = nl(text0)
  const n = { refs: 0, applied: 0, marks: 0, blocks: 0, watched: 0, stuck: [] }
  for (const sec of parseDoc(text, '').sections) {
    if (!sec.applied || !gone.has(nfc(sec.applied))) continue
    // 같은 머리가 둘 이상이면 replaceSection 이 어느 것을 고칠지 모른다: 사람이 본다
    if (parseDoc(text, '').sections.filter((x) => x.h.normalize('NFC') === sec.h.normalize('NFC')).length > 1) { n.stuck.push(sec.h); continue }
    text = replaceSection(text, { heading: sec.h, body: sec.body, applied: null })
    n.applied++
  }
  let lines = text.split('\n')
  // (개인) 저절로 채우는 표 블록 표식 · 첫 줄 사본 표지
  if (personal) {
    let fence = null
    const keep = []
    lines.forEach((l, i) => {
      const f = l.match(FENCE)
      if (f) fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
      if (!fence && !f && (BASE_OPEN.test(l) || BASE_CLOSE.test(l))) { n.blocks++; return }
      if (i === 0 && WATCHED.test(l)) { n.watched++; return }
      keep.push(l)
    })
    if (n.watched && keep.length && !keep[0].trim()) keep.shift()
    lines = keep
  }
  // 참고 블록: 지운 기록 줄 · 옛 표식 메모(sections.js splitRef · withRef 로만)
  const r = splitRef(lines)
  let cut = 0
  for (const [key, ls] of r.ref) {
    const keep = ls.filter((l) => {
      if (isLogEntry(l)) {
        const id = idOfHref(parseRefLine(l).href)
        if (id && gone.has(id)) { n.refs++; return false }
        return true
      }
      if (OLD_MARK_NOTE.test(String(l).trim())) { n.marks++; return false }
      return true
    })
    if (keep.length !== ls.length) {
      cut += ls.length - keep.length
      if (keep.length) r.ref.set(key, keep)
      else r.ref.delete(key)
    }
  }
  return { text: cut ? withRef(r.lines, r.ref) : lines.join('\n'), n }
}

// 참고 블록의 옛 기록 줄: 「- 날짜 [제목](../work/x.md) 한 마디」(링크 뒤 「 · 」 없음)는 메모 줄로 읽혀 출처가 기록을 잇지 못한다.
//   「- 날짜 [제목](../work/x.md) · 한 마디」 로 고친다. 한 항목 아래 같은 기록 줄이 둘 이상이면(지금 읽기는 같은 링크를 한 줄로 합친다)
//   앞 줄에 뒤 줄의 한 마디를 「 · 」 로 이어 한 줄로 만든다(한 마디를 잃지 않게). 줄 단위로만 고치고 다른 줄은 바이트 그대로
//   → { text, fixed(고친 옛 줄), merged(합친 줄) }
const REF_ENTRY = /^(\s+)-\s+((?:\d{4}-\d{2}-\d{2}\s+)?\[[^\]]*\]\(((?:\.\.\/)*(?:work|log)\/[^)\s/]+\.md)\))(.*)$/
export function refLineFix(text0) {
  const lines = nl(text0).split('\n')
  const out = []
  let fixed = 0
  let merged = 0
  let inBlock = false
  let fence = null
  let seen = null // 항목 아래 href → out 의 줄 번호
  for (const l of lines) {
    const fm = l.match(FENCE)
    if (!inBlock && fm) fence = !fence ? fm[1] : fm[1][0] === fence[0] && fm[1].length >= fence.length ? null : fence
    if (!fence && REF_OPEN.test(l)) { inBlock = true; seen = new Map(); out.push(l); continue }
    if (inBlock && REF_CLOSE.test(l)) { inBlock = false; seen = null; out.push(l); continue }
    if (!inBlock) { out.push(l); continue }
    if (/^- /.test(l)) { seen = new Map(); out.push(l); continue }
    const m = l.match(REF_ENTRY)
    if (!m) { out.push(l); continue }
    const rest = m[4]
    let note = rest.trim()
    if (note && !/^\s+·\s+/.test(rest)) fixed++
    else note = note.replace(/^·\s+/, '')
    const at = seen.get(m[3])
    if (at != null) {
      const prev = out[at]
      const pm = prev.match(REF_ENTRY)
      const pn = (pm?.[4] || '').trim().replace(/^·\s+/, '')
      if (pm && note && !` · ${pn} · `.includes(` · ${note} · `)) out[at] = `${pm[1]}- ${pm[2]} · ${pn ? `${pn} · ` : ''}${note}`
      merged++
      continue
    }
    seen.set(m[3], out.length)
    out.push(note ? `${m[1]}- ${m[2]} · ${note}` : l)
  }
  return { text: out.join('\n'), fixed, merged }
}

// ── 기록 규칙 ──
// 넣지 못함 · 원천 칸 → 「## 남은 것」 사람 말(개인 지식 record.oldtag)
function heldRows(body) {
  const at = [...String(body).matchAll(new RegExp(`^## ${HELD_PART}[ \\t]*$`, 'gm'))].pop()
  if (!at) return []
  const m = String(body).slice(at.index).match(/^## [^\n]*\n(`{3,})json\n([\s\S]*?)\n\1[ \t]*$/m)
  if (!m) return []
  try {
    const v = JSON.parse(m[2])
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []
  } catch {
    return []
  }
}
const short = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
export function heldToLeft(body) {
  const rows = heldRows(body)
  const src = String(body).match(/^## 원천[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)
  let b = dropHeld(body)
  if (src) b = dropPart(b, '원천')
  const out = []
  for (const r of rows) {
    out.push(`- ${r.doc || '(문서 없음)'} › ${r.heading || '(머리 없음)'}: 넣지 못했다${r.why ? `(${short(r.why, 120)})` : ''}`)
    for (const e of Array.isArray(r.edits) ? r.edits : []) out.push(`  - 「${short(e.find)}」 을 「${short(e.replace)}」 로 바꾸려 했다`)
    if (typeof r.content === 'string' && r.content.trim()) out.push(`  - 새 글 ${r.content.length}자를 넣으려 했다(git 이력의 앞 판에 있다)`)
  }
  if (src) {
    const first = src[1].split('\n').find((l) => /^\s*-\s+\S/.test(l))
    out.push(`- 다시 들인 기록이다${first ? `: ${short(first.replace(/^\s*-\s+/, ''), 200)}` : ''}`)
  }
  if (!out.length) return b
  return `${b.replace(/\s+$/, '')}\n\n## 남은 것\n${out.join('\n')}`
}

// ── 계획 ──
// 지식 하나 읽기: loadKnowledge 의 것에 기록 파일 글 · 머리말 칸을 더한다
async function readAll(dir) {
  const abs = path.resolve(dir)
  const k = await loadKnowledge({ id: path.basename(abs), name: path.basename(abs), dir: abs })
  const files = await walk(abs)
  const recs = new Map() // id → { path, text, data, r }
  for (const p of files) {
    if (!/^(work|log)\/[^/]+\.md$/i.test(p)) continue
    const text = await readOr(path.join(abs, ...p.split('/')))
    if (text == null) continue
    const r = parseRecord(text, path.basename(p))
    if (!r) continue
    recs.set(r.id, { path: p, text, data: splitFrontmatter(text).data || {}, r })
  }
  return { abs, k, files, recs }
}

export async function plan(dir, { personal = false, drop: drop0 = [] } = {}) {
  const drop = drop0.map((x) => nfc(String(x).trim())).filter(Boolean)
  const { abs, k, files, recs } = await readAll(dir)
  const changes = []
  const judge = []
  const counts = Object.fromEntries(RULES.map((r) => [r, 0]))
  const allow = {}
  const cur = new Map() // 경로 → 지금까지 계산한 글(null = 지움)
  const textOf = async (p) => (cur.has(p) ? cur.get(p) : readOr(path.join(abs, ...p.split('/'))))
  const write = async (p, after, rule, why, n = 1) => {
    const before = await textOf(p)
    if (before == null || before === after) return false
    changes.push({ path: p, kind: 'write', before, after, why, rule })
    cur.set(p, after)
    counts[rule] += n
    return true
  }
  const del = async (p, rule, why) => {
    if (cur.has(p) && cur.get(p) === null) return false
    const before = /\.(md|json)$/i.test(p) ? await textOf(p) : undefined
    changes.push({ path: p, kind: 'delete', before: before ?? undefined, why, rule })
    cur.set(p, null)
    counts[rule]++
    return true
  }
  const J = (what, where, count, why) => { if (count) judge.push({ what, where, count, why }) }

  // 기록 상태 재료(옛 읽기): 머리말 칸을 그대로 읽는다
  const all = [...recs.values()].map((x) => x.r)
  const s = oldView(all)
  // 건드린 항목 바로잡기(touches-fix): knowledge.js 처럼 원 기록의 건드린 항목을 바꿔 읽는다
  const touchesOf = new Map(k.works.map((w) => [w.id, w.touches]))

  // 1) 지울 것: 넘겨받은 기록 · 정리 시절 이력
  const gone = new Set()
  for (const id of drop) {
    const x = recs.get(id)
    if (!x) throw new KmdError('E_INPUT', `지울 기록이 없다: ${id}`)
    gone.add(id)
  }
  for (const x of recs.values()) {
    const w = x.r
    if (!w.tags.some((t) => OLD_LOG_TAGS.includes(t))) continue
    if (!(x.path.startsWith('log/') || isLogRecord(w.tags))) continue
    // 되돌림 · 바로잡기를 지닌 이력은 남은 기록의 상태를 가른다: 세션이 본다
    //   건드린 항목 바로잡기(touches-fix)도: 지우면 원 기록의 touches 가 바로잡기 전 값으로 읽힌다
    if (w.reopens.length || w.fixes.length) {
      J('되돌림 · 바로잡기를 지닌 정리 시절 이력', x.path, 1, w.tags.includes('touches-fix') ? '지우면 원 기록의 건드린 항목이 바로잡기 전 값으로 읽힌다' : '지우면 그 기록들의 상태가 바뀐다')
      continue
    }
    gone.add(w.id)
  }
  for (const id of gone) {
    const x = recs.get(id)
    const rule = drop.includes(id) ? 'record.drop' : 'log.old'
    await del(x.path, rule, rule === 'record.drop' ? '넘겨받은 지울 기록' : `정리 시절 이력(태그 ${x.r.tags.filter((t) => OLD_LOG_TAGS.includes(t)).join(' · ')})`)
    for (const f of files.filter((p) => p.startsWith(`work/assets/${id}/`))) await del(f, rule, '지운 기록의 첨부')
  }

  // 2) 장부
  {
    const t = await textOf('_forms.md')
    if (t != null) {
      const a = formsNewdoc(nl(t))
      if (a !== nl(t)) await write('_forms.md', endNl(a), 'forms.newdoc', '「- 새 문서:」 줄이 없어 닫힘으로 읽던 것을 줄로 적는다')
      const b = formsHead(nl(await textOf('_forms.md')))
      if (b !== nl(await textOf('_forms.md'))) await write('_forms.md', endNl(b), 'forms.head', '갈래 표 옛 머리(다른 이름 · 이름)')
    }
  }
  {
    const t = await textOf('_vocab.md')
    if (t != null) {
      const a = vocabHead(nl(t))
      if (a !== nl(t)) await write('_vocab.md', endNl(a), 'vocab.head', '옛 제목 · 안내 단락')
      const t2 = nl(await textOf('_vocab.md'))
      const b = vocabDash(t2)
      if (b !== t2) await write('_vocab.md', endNl(b), 'vocab.dash', '줄표 라벨 · 옛 라벨 꼬리 · 폐기 줄', t2.split('\n').filter((l, i) => l !== b.split('\n')[i]).length)
      const prose = vocabProse(nl(await textOf('_vocab.md')))
      J('항목 장부 종류 절 안의 설명 글(뜻 줄로 옮길지 · 걷을지)', `_vocab.md ${prose.slice(0, 8).join(' · ')}줄`, prose.length, '항목 줄 · 뜻 줄이 아니라 읽히지 않는다')
    }
  }
  {
    const t = await textOf('_managed.md')
    if (t != null) {
      const a = registryHead(nl(t))
      if (a !== nl(t)) await write('_managed.md', a, 'registry.head', '옛 제목 · 표 머리 · 덧칸 · 설명 단락 → 「# 문서 장부」 한 표')
      const { odd } = registryRows(nl(t))
      J('문서 장부의 읽히지 않는 줄(그대로 옮겨 둠)', `_managed.md ${odd.join(' · ')}줄`, odd.length, '항목 · 문서 · 머리 꼴이 아니다')
      J('섹션 없는 문서 장부 줄(문서 한 벌 · O-2)', '_managed.md', nl(t).split('\n').filter((l) => WHOLE_RE.test(l)).length, '그 문서의 대표 항목으로 retire 하거나 줄을 지운다(kmd-migrate put 의 ledger unplace)')
    }
  }
  {
    const t = await textOf('_members.md')
    if (t != null) {
      const { text: a, stuck } = membersFix(nl(t))
      const n = nl(t).split('\n').filter((l) => /^\s*[-*]\s*(정리 방식|정리|저장 방식|관리)\s*[:：]/.test(l)).length - (stuck ? 1 : 0)
      if (a !== nl(t)) await write('_members.md', a, 'members', '정리 · 저장 방식 · 정리 방식 · 관리 줄', n)
      J('사람 장부 「정리」 줄에 사람이 있는데 자리 표가 없다', '_members.md', stuck ? 1 : 0, '지식관리자 자리 표를 세운 뒤 옮긴다')
    }
  }
  {
    const t = await textOf('README.md')
    const words = ['CDP', 'cdp', 'ctx', '좌표', '반영 대기', '이름 장부', '넣을 곳 장부', '정리가', '등록부', '큐레이터', '관리 문서']
    const hit = t ? words.filter((w) => t.includes(w)) : []
    J('README 의 옛 말', `README.md(${hit.join(' · ')})`, hit.length ? 1 : 0, '지식 홈 「먼저 읽을 것」 카드로 보인다 · 사람이 고쳐 쓴다')
  }

  // 3) 기록
  const ROW = (doc, heading) => ({ doc, heading, from: '', to: '', isNew: false })
  const oldTagged = []
  const oldState = []
  const noneState = []
  for (const x of recs.values()) {
    const w = x.r
    if (gone.has(w.id)) continue
    const isWork = x.path.startsWith('work/') && !isLogRecord(w.tags)
    let text = nl(await textOf(x.path))
    let fm = fmSplit(text)
    if (!fm) continue
    // record.fm: 읽지 않는 옛 칸
    {
      let ls = fm.lines
      for (const key of ['source', 'attachments']) ls = keyRange(ls, key) ? setKey(ls, key, null) : ls
      if (ls !== fm.lines) {
        const next = fmJoin(ls, fm.rest)
        // 다시 읽은 기록이 앞과 같아야 한다(읽지 않는 칸만 걷었다)
        if (!same(parseRecord(next, path.basename(x.path)), parseRecord(text, path.basename(x.path)))) J('머리말 옛 칸을 걷으면 읽기가 바뀌는 기록', x.path, 1, '손으로 본다')
        else {
          await write(x.path, next, 'record.fm', '머리말 source · attachments(읽히지 않는다)')
          text = next
          fm = fmSplit(text)
        }
      }
    }
    // record.refs: 지운 기록을 가리키는 supersedes · reflects · reopens · curates
    if (gone.size) {
      const d = splitFrontmatter(text).data || {}
      let ls = fm.lines
      const sup = d.supersedes
      const supIds = list(typeof sup === 'object' && sup && !Array.isArray(sup) ? sup.id : sup)
      if (supIds.some((i) => gone.has(i))) { const left = supIds.filter((i) => !gone.has(i)); ls = setKey(ls, 'supersedes', left.length > 1 ? left : left[0] ?? null) }
      for (const key of ['reflects', 'reopens']) { const xs = list(d[key]); if (xs.some((i) => gone.has(i))) ls = setKey(ls, key, xs.filter((i) => !gone.has(i))) }
      if (Array.isArray(d.curates) && d.curates.some((c) => gone.has(nfc(String(c?.id ?? ''))))) ls = setKey(ls, 'curates', d.curates.filter((c) => !gone.has(nfc(String(c?.id ?? '')))))
      if (ls !== fm.lines) {
        const next = fmJoin(ls, fm.rest)
        await write(x.path, next, 'record.refs', '지운 기록을 가리키는 머리말 칸')
        text = next
        fm = fmSplit(text)
      }
    }
    if (!isWork) continue
    const tags = w.tags
    // record.oldtag: 옛 표지(넣지 못함 · 메모 · 이행)
    if (tags.some((t) => OLD_TAGS.includes(t))) {
      if (!personal) { oldTagged.push(w.id); continue }
      const d = splitFrontmatter(text).data || {}
      let ls = setKey(fm.lines, 'tags', list(d.tags).filter((t) => !OLD_TAGS.includes(t)))
      const put = tags.includes('put')
      if (!put && (tags.includes('held') || tags.includes('memo'))) {
        ls = setKey(ls, 'touches', null)
        ls = setKey(ls, 'touchesEmpty', '저장 승인 전 기록이다 · 넣지 못한 것은 본문 끝 「남은 것」')
      }
      const next = fmJoin(ls, heldToLeft(fm.rest.replace(/\s+$/, '')).replace(/\s*$/, '\n'))
      await write(x.path, next, 'record.oldtag', `옛 표지 ${tags.filter((t) => OLD_TAGS.includes(t)).join(' · ')} 를 걷는다`)
      // 넣은 것이 있던 기록은 들어감 · 이 기록이 가리킨 기록은 바로잡힘이 된다
      allow[w.id] = put ? ['in', 'fixed', 'old'] : ['old']
      for (const f of w.fixes) allow[f] = [...new Set([...(allow[f] || []), 'fixed'])]
      continue
    }
    if (tags.includes('put')) continue
    // record.state: 저장 문 밖에서 들어간 기록을 put + 넣은 것으로
    const ww = { ...w, touches: touchesOf.get(w.id) || w.touches }
    const st = oldStateOf(k, s, ww)
    if (st.base === 'in' && (st.state === 'in' || st.state === 'fixed')) {
      const rows = []
      for (const c of ww.touches) {
        const sec = sectionOf(k, c)
        if (!sec?.sec || !sec.doc) continue
        if (!rows.some((r) => r.doc === sec.doc.path && r.heading === sec.sec.h)) rows.push(ROW(sec.doc.path, sec.sec.h))
      }
      // 넣은 것 줄을 다시 읽어 같은 항목이 나와야 한다(머리에 「: … → …」 가 든 항목은 줄을 달리 읽는다)
      const ok = rows.filter((r) => same(parsePut(renderPut([r]))[0], r))
      if (ok.length !== rows.length) J('넣은 것 줄로 적으면 머리를 달리 읽는 항목', `${x.path}`, rows.length - ok.length, '머리에 「: … → …」 가 들었다 · 그 줄은 빼고 굳혔다')
      const d = splitFrontmatter(text).data || {}
      const ls = setKey(fm.lines, 'tags', [...list(d.tags), 'put'])
      const body = fm.rest.replace(/\s+$/, '')
      const next = fmJoin(ls, `${body}${ok.length ? `\n\n${renderPut(ok)}` : ''}\n`)
      await write(x.path, next, 'record.state', `저장 문 밖에서 들어간 기록(${st.state}) · 넣은 것 ${ok.length}`)
      continue
    }
    if (st.state === 'old' || (st.state === 'fixed' && st.base === 'old')) oldState.push(w.id)
    else if (st.state === 'none') noneState.push(w.id)
  }
  // record.logdir: work/ 에 쓴 이력(이력 태그 · 옛 kmd 가 work/ 에 썼다)을 log/ 로 · 문서 참고 줄의 링크도 log/ 로
  const toLog = new Set()
  for (const x of recs.values()) {
    const w = x.r
    if (gone.has(w.id) || !x.path.startsWith('work/') || !isLogRecord(w.tags)) continue
    const dst = `${LOG_DIR}/${w.id}.md`
    if (files.includes(dst) || cur.has(dst)) { J('log/ 에 같은 id 가 있는 work/ 의 이력', x.path, 1, '사람이 둘 가운데 하나를 고른다'); continue }
    const text = await textOf(x.path)
    changes.push({ path: dst, kind: 'write', before: null, after: text, why: `work/ 의 이력(태그 ${w.tags.filter((t) => LOG_TAGS.includes(t)).join(' · ')})을 log/ 로`, rule: 'record.logdir' })
    cur.set(dst, text)
    await del(x.path, 'record.logdir', '이력을 log/ 로 옮겼다')
    toLog.add(w.id)
  }
  J('옛 표지 기록(held · memo · migrate-held · O-6)', 'work/', oldTagged.length, `값이 지금 글에 있으면 --drop 으로 지우고 없는 값은 새 기록으로 넣은 뒤 지운다: ${oldTagged.join(' · ')}`)
  J('저장 문 밖 기록 가운데 지금 글에 다 들지 않은 것(old · O-7)', 'work/', oldState.length, `값이 지금 글에 있으면 굳히고(새 기록) 아니면 --drop: ${oldState.join(' · ')}`)
  J('건드린 항목이 문서 장부에서 자리를 찾지 못하는 기록(none)', 'work/', noneState.length, `지금 꼴(put)로 적으면 들어감으로 읽힌다 · O-2(섹션 없는 장부 줄) 뒤 다시 센다: ${noneState.join(' · ')}`)
  // 본문 글이 지운 기록을 링크로 가리킨다: 사람이 고친다
  if (gone.size) {
    const hits = []
    for (const x of recs.values()) {
      if (gone.has(x.r.id)) continue
      const t = await textOf(x.path)
      if (t && [...gone].some((id) => t.includes(`/${id}.md`) || t.includes(`/${encodeURI(id)}.md`))) hits.push(x.r.id)
    }
    J('본문이 지운 기록을 링크로 가리키는 기록', 'work/ · log/', hits.length, hits.join(' · '))
  }

  // 4) 문서
  let heads3 = 0
  const h3docs = []
  for (const p of files.filter((f) => /^docs\/.+\.md$/i.test(f) && !/^docs\/assets\//i.test(f))) {
    const t0 = await textOf(p)
    if (t0 == null) continue
    const t = nl(t0)
    // 옛 문서 꼴(core/docformat.js convertDoc: 경과 꼬리 · 기록 그대로 · applied: null · cdp:baseline · 옛 GDI 변경 이력)
    const c = convertDoc(t)
    if (!c.ok) J('옛 꼴을 옮기지 못한 문서', p, 1, c.why || '')
    else if (c.changed) await write(p, c.text, 'doc.marks', `옛 문서 꼴 ${c.moved}줄을 참고 블록으로`, c.moved)
    if (toLog.size) {
      const t2 = nl(await textOf(p))
      let t3 = t2
      for (const id of toLog) for (const v of new Set([id, encodeURI(id).replace(/\(/g, '%28').replace(/\)/g, '%29')])) t3 = t3.split(`/work/${v}.md)`).join(`/${LOG_DIR}/${v}.md)`)
      if (t3 !== t2) await write(p, t3, 'record.logdir', 'log/ 로 옮긴 이력을 가리키는 참고 줄')
    }
    {
      const t2 = nl(await textOf(p))
      const r = refLineFix(t2)
      if (r.text !== t2) await write(p, r.text, 'ref.line', `옛 참고 줄 ${r.fixed} · 같은 기록 줄 합침 ${r.merged}`, r.fixed + r.merged)
    }
    const t1 = nl(await textOf(p))
    const f = fixDoc(t1, { gone, personal })
    J('지운 기록을 가리키는 표지가 있는데 같은 머리가 둘 이상인 항목', p, f.n.stuck.length, f.n.stuck.join(' · '))
    if (f.text !== t1) {
      if (f.n.refs || f.n.applied) await write(p, f.text, 'record.refs', `지운 기록의 참고 줄 ${f.n.refs} · 표지 ${f.n.applied}`, f.n.refs + f.n.applied)
      // 한 글에 여러 규칙이 섞이면 셈만 따로 올린다(바꾼 글은 위의 한 걸음)
      if (f.n.marks) { if (!(f.n.refs || f.n.applied)) await write(p, f.text, 'doc.marks', `옛 표식 메모 ${f.n.marks}`, f.n.marks); else counts['doc.marks'] += f.n.marks }
      if (f.n.blocks || f.n.watched) { if (!(f.n.refs || f.n.applied || f.n.marks)) await write(p, f.text, 'doc.blocks', `블록 표식 ${f.n.blocks} · 사본 표지 ${f.n.watched}`, f.n.blocks + f.n.watched); else counts['doc.blocks'] += f.n.blocks + f.n.watched }
    }
    // 팀 지식의 블록 · 사본 표지 · ### 소제목은 사람이 본다
    if (!personal) {
      const live = splitRef(t1.split('\n')).lines
      const bl = live.filter((l) => BASE_OPEN.test(l)).length
      J('저절로 채우는 표 블록(<!-- baseline -->)', p, bl, '블록 표식만 걷고 표를 남길지 사람이 정한다')
      J('사본 문서 표지(watched)', p, WATCHED.test(live[0] || '') ? 1 : 0, '원본이 주인인 문서 · 표지를 걷으면 사람이 고치는 문서가 된다')
    }
    const lv = toLevels(t1)
    if (lv.heads) { heads3 += lv.heads; h3docs.push(p) }
  }
  J('항목 안 ### 소제목(수준 표시 전 꼴)', h3docs.join(' · '), heads3, '수준 표시로 옮길지 서식 맞춤에서 본다(목록 줄까지 바꾸므로 기계로 옮기지 않는다)')

  // 5) 남은 옛 태그 이력(지우지 않는 것) · 세움 메모 · 기록 없는 첨부
  {
    const keep = [...recs.values()].filter((x) => !gone.has(x.r.id) && x.path.startsWith('log/') && x.r.tags.some((t) => ['structure', 'rebuild', 'registry', 'shape', 'transition'].includes(t)))
    J('지금 이력 태그 밖의 옛 태그 이력(structure · rebuild · registry · shape · transition)', 'log/', keep.length, '이력은 그대로 읽힌다 · 지울지는 사람이 정한다')
  }
  if (files.includes('_seed.json')) await del('_seed.json', 'seed', '세움 메모(코드가 읽지 않는다 · git 이력에 남는다)')
  {
    const folders = new Set(files.filter((p) => p.startsWith('work/assets/')).map((p) => p.split('/')[2]))
    const live = []
    for (const p of files.filter((f) => /\.md$/i.test(f) && !/assets\//.test(f))) { const t = await textOf(p); if (t) live.push(t) }
    const body = live.join('\n')
    for (const fd of folders) {
      if (recs.has(fd) && !gone.has(fd)) continue
      const own = files.filter((p) => p.startsWith(`work/assets/${fd}/`) && cur.get(p) !== null)
      if (!own.length) continue
      if (body.includes(`assets/${fd}/`) || body.includes(`assets/${encodeURI(fd)}/`)) { J('기록 없는 첨부 폴더를 글이 가리킨다', `work/assets/${fd}`, own.length, '링크와 폴더를 같이 옮기거나 지운다(사람)'); continue }
      for (const p of own) await del(p, 'seed', '기록 없는 첨부 폴더')
    }
  }
  return { changes, judge, counts, allow, gone: [...gone], moved: [...toLog], personal }
}
const list = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).filter((x) => x != null).map((x) => nfc(String(x).trim())).filter(Boolean))

// 계획의 경로마다 마지막 글(null = 지움)
export function finalOf(p) {
  const out = new Map()
  for (const c of p.changes) out.set(c.path, c.kind === 'delete' ? null : c.after)
  return out
}

// ── 대 보기: 계획대로 쓴 사본을 지금 코드로 다시 읽어 기록 상태 · 장부 읽기가 앞과 같은가 ──
export async function verifyPlan(dir, p) {
  const abs = path.resolve(dir)
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kmd-oldform-'))
  try {
    const files = await walk(abs)
    for (const f of files) {
      if (!/\.md$/i.test(f) || /^(docs|work)\/assets\//i.test(f)) continue
      const to = path.join(tmp, ...f.split('/'))
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.copyFile(path.join(abs, ...f.split('/')), to)
    }
    for (const [f, t] of finalOf(p)) {
      if (/^(docs|work)\/assets\//i.test(f) || !/\.md$/i.test(f)) continue
      const to = path.join(tmp, ...f.split('/'))
      if (t == null) await fs.rm(to, { force: true })
      else { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.writeFile(to, t) }
    }
    const A = await loadKnowledge({ id: 'a', name: 'a', dir: abs })
    const B = await loadKnowledge({ id: 'b', name: 'b', dir: tmp })
    const why = []
    const gone = new Set([...(p.gone || []), ...(p.moved || [])])
    const after = new Map(B.works.map((w) => [w.id, w]))
    // 앞(옛 꼴)의 상태는 옛 읽기로 본다: put 이 없는 기록 · work/ 의 이력 태그 기록(옛 읽기는 이력으로 보았다)
    const sA = oldStates(A)
    const stateA = (w) => sA.get(w.id)
    for (const w of A.works) {
      if (gone.has(w.id) || isLogRecord(w.tags)) continue
      const b = after.get(w.id)
      if (!b) { why.push(`${w.id}: 기록이 사라졌다`); continue }
      const was = stateA(w)
      if (b.state === was) continue
      if ((p.allow?.[w.id] || []).includes(b.state)) continue
      // 지운 기록이 바로잡았던 기록은 바로잡힘이 풀린다
      if (was === 'fixed' && b.state === 'in' && !B.superseded.has(w.id)) continue
      why.push(`${w.id}: 상태 ${was} → ${b.state}`)
    }
    // 폐기 줄은 글이 아니라 「폐기됐나 · 이을 항목」 으로 견준다(core/guard.js nextOf · 옛 줄표 까닭 줄도 같은 항목)
    const nextOf = (dep) => String(dep || '').match(/→\s*([^\s`]+:[^\s`]+)/)?.[1]?.replace(/:+$/, '') || null
    const vk = (v) => (v ? { ...v, deprecated: v.deprecated ? { next: nextOf(v.deprecated) } : null } : null)
    //   앞(옛 꼴)은 옛 읽기로 본다: 줄표 라벨 줄 · 「- 새 문서:」 줄이 없는 갈래 장부(닫힘) — 지금 읽기는 그 꼴을 모른다(O-9)
    const vA = oldVocab((await readOr(path.join(abs, '_vocab.md'))) || '')
    const closedA = oldClosed((await readOr(path.join(abs, '_forms.md'))) || '')
    for (const [c] of vA.coords) if (!same(vk(vA.coords.get(c)), vk(B.vocab.coords.get(c)))) why.push(`항목 장부 ${c} 의 읽기가 바뀐다`)
    if (vA.coords.size !== B.vocab.coords.size) why.push('항목 장부 줄 수가 바뀐다')
    if (!same(A.registry, B.registry)) why.push('문서 장부의 읽기가 바뀐다')
    for (const c of vA.coords.keys()) if (!same(locate(A.registry, c), locate(B.registry, c))) why.push(`${c} 의 자리가 바뀐다`)
    if (!same(A.forms.rows, B.forms.rows) || closedA !== B.forms.closed) why.push('갈래 장부의 읽기가 바뀐다')
    // 문서 본문 · 머리는 그대로(표지 · 참고 줄만 바뀐다)
    const docB = new Map(B.docs.map((d) => [d.path, d]))
    for (const d0 of A.docs) {
      const e = docB.get(d0.path)
      if (!e) { why.push(`${d0.path}: 문서가 사라졌다`); continue }
      // 앞 글은 옛 꼴(경과 꼬리 · 기록 그대로 줄)을 뗀 본문으로 견준다(지금 parseDoc 은 옛 꼴을 떼지 않는다)
      const raw = (await readOr(path.join(abs, ...d0.path.split('/')))) || ''
      const c = convertDoc(raw)
      const d = c.ok && c.changed ? { ...d0, ...parseDoc(c.text, d0.title) } : d0
      if (d.title !== e.title || d.sections.length !== e.sections.length || d.sections.some((s, i) => s.h !== e.sections[i].h || (s.body !== e.sections[i].body && !p.personal))) why.push(`${d.path}: 본문이 바뀐다`)
    }
    // 사람 장부: 자리 표(정리 줄의 사람은 지식관리자로)
    const ma = oldMembers(await readOr(path.join(abs, '_members.md')) || '')
    const mb = parseMembers(await readOr(path.join(tmp, '_members.md')) || '')
    const want = ma.access ? { ...ma.access, users: { ...ma.access.users } } : null
    if (want) for (const u of ma.curators.map((x) => x.toLowerCase())) want.users[u] = 'admin'
    if (ma.owner !== mb.owner || !!ma.noClaude !== !!mb.noClaude || (want && !sameAccess(want, mb.access)) || (!want && mb.access)) why.push('사람 장부의 읽기가 바뀐다')
    return { ok: !why.length, why }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch((x) => console.error('옛 꼴 대 보기 임시 폴더 지우기 실패:', x?.message || x))
  }
}

// ── 쓰기 ──
const LEDGERS = new Set(['_vocab.md', '_managed.md', '_forms.md', '_members.md', '_order.md', '_seed.json'])
export function apply(dir, p, { user, msg = null, now = new Date(), personal = false } = {}) {
  if (!user || typeof user !== 'string') throw new KmdError('E_INPUT', '쓴 사람(user)이 있어야 한다')
  const abs = path.resolve(dir)
  return serial(abs, async () => {
    const fin = finalOf(p)
    if (!fin.size) return { commit: null, log: null, files: 0 }
    // 계획 뒤에 바뀐 파일이 있으면 아무것도 쓰지 않는다
    const first = new Map()
    for (const c of p.changes) if (!first.has(c.path)) first.set(c.path, c.before)
    for (const [f, before] of first) {
      const now0 = await (/\.md$/i.test(f) || f.endsWith('.json') ? readOr(path.join(abs, ...f.split('/'))) : fs.readFile(path.join(abs, ...f.split('/'))).then((b) => b, () => null))
      if (before != null && now0 == null) throw new KmdError('E_CONFLICT', `계획 뒤에 지워졌다: ${f} · 다시 계획한다`)
      if (before !== undefined && typeof now0 === 'string' && nl(now0) !== nl(before)) throw new KmdError('E_CONFLICT', `계획 뒤에 바뀌었다: ${f} · 다시 계획한다`)
    }
    const v = await verifyPlan(abs, { ...p, personal: personal || !!p.personal })
    if (!v.ok) throw new KmdError('E_INPUT', `옮긴 뒤 다시 읽은 것이 앞과 다르다(아무것도 쓰지 않았다): ${v.why.slice(0, 5).join(' / ')}`, { details: { why: v.why } })
    await ensureRepo(abs)
    const date = localStamp(now)
    const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
    let id = `${day}-옛-꼴-옮김`
    for (let n = 2; await recordTaken(abs, id); n++) id = `${day}-옛-꼴-옮김-${n}`
    const logRel = `${LOG_DIR}/${id}.md`
    const wrote = [...fin].filter(([, t]) => t != null).length
    const dropped = [...fin].filter(([, t]) => t == null).length
    const title = `옛 꼴 옮김: 고친 파일 ${wrote} · 지운 파일 ${dropped}`
    const byRule = RULES.map((r) => [r, p.changes.filter((c) => c.rule === r && c.kind === 'write').length, p.changes.filter((c) => c.rule === r && c.kind === 'delete').length, p.counts?.[r] || 0]).filter(([, a, b]) => a || b)
    const body = [
      `옛 꼴을 지금 꼴로 옮겼다. 지금 코드가 읽는 결과(기록 상태 · 장부 · 자리)는 그대로다. 지운 것은 이 지식의 git 이력에 있다(되돌릴 때는 이 커밋을 revert)${msg ? ` · ${String(msg).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`,
      '',
      '| 규칙 | 고친 파일 | 지운 파일 | 셈 |',
      '|---|---|---|---|',
      ...byRule.map(([r, a, b, n]) => `| ${RULE_SAY[r]} | ${a} | ${b} | ${n} |`),
      ...(p.gone?.length ? ['', `지운 기록 · 이력 ${p.gone.length}: ${p.gone.slice(0, 300).join(' · ')}${p.gone.length > 300 ? ' …' : ''}`] : []),
    ].join('\n')
    const j = await begin(abs)
    try {
      for (const [f, t] of fin) {
        await j.add(f)
        const full = path.join(abs, ...f.split('/'))
        if (t == null) await fs.rm(full, { force: true })
        else if (LEDGERS.has(f)) await writeFileAtomic(full, t)
        else { await fs.mkdir(path.dirname(full), { recursive: true }); await writeAtomic(full, t) }
      }
      await fs.mkdir(path.join(abs, LOG_DIR), { recursive: true })
      await j.add(logRel)
      await writeAtomic(path.join(abs, LOG_DIR, `${id}.md`), renderRecord({ id, title, date, author: user, tags: ['format'] }, body))
      // 커밋: 고친 · 지운 파일과 이력만(다른 손 고침은 섞지 않는다) · 경로가 많아 pathspec 파일로 넘긴다
      const tracked = new Set((await git(abs, ['ls-files', '-z'])).split('\0').filter(Boolean).map(nfc))
      const paths = [...[...fin].filter(([f, t]) => t != null || tracked.has(f)).map(([f]) => f), logRel]
      const z = paths.join('\0') + '\0'
      const gone = paths.filter((f) => fin.get(f) === null)
      if (gone.length) await git(abs, ['rm', '-q', '--cached', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: gone.join('\0') + '\0' })
      const live = paths.filter((f) => fin.get(f) !== null)
      await git(abs, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: live.join('\0') + '\0' })
      const who = String(user).replace(/[<>\s]+/g, '') || 'kmd'
      await git(abs, ['-c', `user.name=${who}`, '-c', `user.email=${who}@kmd`, 'commit', '-q', '-m', title, '--pathspec-from-file=-', '--pathspec-file-nul'], { input: z })
      const commit = (await git(abs, ['rev-parse', 'HEAD'])).trim()
      await j.done()
      return { commit, log: id, files: fin.size }
    } catch (e) {
      await j.undo().catch((x) => console.error('옛 꼴 옮김 되돌리기 실패:', x?.message || x))
      throw e
    }
  })
}

// 개인 지식 자동 이행: 판 표시가 없으면 한 번(기계 규칙만 · 판단이 드는 것은 쓰지 않는다)
//   부르는 곳은 G 단계에서 단다(개인 프로그램이 지식을 열 때)
export async function runOnce(dir, { personal = true, user = 'kmd', now = new Date() } = {}) {
  const abs = path.resolve(dir)
  const mark = path.join(abs, '.git', MARK_FILE)
  const had = await fs.readFile(mark, 'utf8').then((t) => t.trim(), () => null)
  if (had) return { skipped: true, ver: had }
  await ensureRepo(abs)
  const p = await plan(abs, { personal })
  const r = p.changes.length ? await apply(abs, p, { user, now, personal }) : { commit: null, log: null, files: 0 }
  await fs.mkdir(path.join(abs, '.git'), { recursive: true })
  await writeFileAtomic(mark, `${OLDFORM_VER}\n`)
  return { skipped: false, ...r, counts: p.counts, judge: p.judge.length }
}
