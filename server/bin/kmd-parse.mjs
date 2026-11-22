#!/usr/bin/env node
// kmd-parse — 대량 넣기 파서(K6-1 · 설계 4-6). 내 PC 의 파일 · 폴더를 글(md)로 바꿔 한 줄씩 낸다. Claude Code 스킬 kmd-team-import 가 읽는다.
//
//   kmd-parse <파일|폴더> [--out <폴더>] [--attach] [--upload <팀 서버 주소> --kn <팀 지식 id>]
//
//   읽는 파일  md · txt · log · csv · tsv · html · json · docx · pptx · xlsx · hwpx · hwp · pdf · 그림
//              숨김(. 으로 시작) · node_modules · 오피스 잠금 파일(~$ · .~)은 건너뛴다
//   바꾸기     개인 프로그램 · 팀 화면 파일 넣기와 같은 core/importer.js 의 fileToMd(갈라지지 않게 · 꾸러미가 같은 파일을 묶는다)
//   한 줄      { rel, md, sha, tags, scan?, img?, why?, atts }   파일마다 ndjson 한 줄
//              sha   글의 지문 sha256(md.trim()) 앞 16(팀 화면 파일 넣기의 md/ 표지와 같다) · 글이 없으면(스캔 · 그림) 파일 바이트의 지문
//              tags  기록에 그대로 다는 표지 [ingest/<경로>, md/<sha>] — 같은 파일을 다시 넣으면 팀 저장이 same 으로 답한다(이어 하기)
//              scan  글 층이 없는 pdf · 그림만 든 오피스: Claude Code 가 원본을 직접 읽어 글을 짓는다
//              img   그림: 글이 없다 · 원본 첨부로만 둔다
//              why   못 바꾼 까닭(깨진 파일 · 암호 · 너무 큼 · 없는 파일)
//              atts  --upload 일 때 [{ path: docs/assets/<경로>, ref: 'sha256:<64자>', bytes }]: 원본은 팀 서버에 올렸다 · save 의 attach 에 그대로 싣는다(base64 를 짓지 않는다)
//                    --attach 만이면(옛 꼴) [{ path, file: <이 PC 의 파일>, bytes }] · 팀 저장은 file 을 받지 않는다
//              source  --upload 일 때 글 원천(md · txt · csv …)의 { path: <경로>, ref: 'sha256:<64자>' }: 첨부는 짓지 않고 원본을 올려 지문을 증명한다 · propose · save 의 source 에 그대로 싣는다
//              attachWhy  첨부(글 원천은 올리기)하지 못한 까닭(32MB 넘음 · 올리기 한도 · 연결): 그 줄은 ingest/ · md/ 표지를 떼고 글만 넣는다
//   --upload   원본을 PUT <주소>/api/k/<지식>/stage/<sha256> 로 올린다(저장승인 설계 P-D47 · 사람 기기 열쇠 · 쓰기 자리 · 32MB 안 · 24시간 둔다)
//              열쇠는 이 폴더 .mcp.json 의 kmd-team 헤더 도우미(headersHelper)를 불러 메모리에만 둔다: 줄 · index.json · 오류 글에 싣지 않는다 · 주소가 kmd-team 연결과 같을 때만
//              --auth-env <변수> 는 시험용(그 환경 변수의 열쇠) · 401 · 403 · 404 면 끝 줄 why 로 멈춘다(종료 1)
//   --out      글을 <폴더>/<경로>.md 로 쓰고 줄에는 md 대신 mdFile 을 싣는다 · <폴더>/index.json 에 모든 줄
//   끝 줄      { done: true, n, fail }
//   종료 코드  0 모두 · 2 일부 못 바꿈 · 1 못 함(없는 경로 · 읽을 파일 없음)

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { fileToMd, cleanPath, ingestFp, ingestTags } from '../../core/importer.js'

export const PARSE_EXT = /\.(md|markdown|txt|log|csv|tsv|html?|json|docx|pptx|xlsx|hwpx|hwp|pdf|png|jpe?g|gif|webp|svg|bmp)$/i
// 파일 하나 상한 — 팀 화면 파일 넣기(32MB)보다 넉넉히 · 이보다 크면 바꾸지 않고 why
export const PARSE_MAX_FILE = 64 << 20
// 올리는 원본 하나 상한: 팀 저장의 첨부 상한(core/save.js ATTACH_MAX_BYTES)과 같다 · 넘으면 올리지 않고 attachWhy
export const UPLOAD_MAX = 32 << 20
const skipName = (n) => n.startsWith('.') || n.startsWith('~$') || n === 'node_modules'
export const wantParse = (rel) => PARSE_EXT.test(rel) && !rel.split('/').some(skipName)


// 폴더 안의 파일 — [{ rel, file }] · 이름 차례(같은 폴더는 늘 같은 차례 · 이어 하기)
export function listFiles(root) {
  const st = fs.statSync(root)
  if (st.isFile()) return [{ rel: cleanPath(path.basename(root)), file: root }]
  const out = []
  const walk = (dir, pre) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (skipName(e.name)) continue
      const rel = pre ? `${pre}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), rel)
      else if (e.isFile() && wantParse(rel)) out.push({ rel: cleanPath(rel), file: path.join(dir, e.name) })
    }
  }
  walk(root, '')
  return out
}

// 올리기 열쇠: 시험은 --auth-env 의 환경 변수 · 그 밖은 이 폴더 .mcp.json 의 kmd-team 헤더 도우미(주소가 같을 때만) → { header } | { why }
//   도우미의 stderr · 열쇠는 어디에도 옮기지 않는다
const originOf = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.origin : null } catch { return null } }
export function uploadAuth({ origin, authEnv = null, cwd = process.cwd(), env = process.env } = {}) {
  if (authEnv) {
    const k = String(env[authEnv] || '').trim()
    return k ? { header: `Bearer ${k}` } : { why: `환경 변수 ${authEnv} 에 열쇠가 없다` }
  }
  const no = { why: '이 폴더의 .mcp.json 에 kmd-team 연결이 없다: 팀 화면 › 설정 › 에이전트 설치의 한 줄을 이 폴더에서 다시 붙여 넣는다' }
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8')) } catch { return no }
  const srv = cfg?.mcpServers?.['kmd-team']
  if (!srv || typeof srv.headersHelper !== 'string' || !srv.headersHelper.trim()) return no
  if (!originOf(srv.url) || originOf(srv.url) !== originOf(origin)) return { why: '--upload 주소가 .mcp.json 의 kmd-team 연결 주소와 다르다(열쇠는 그 서버에만 보낸다)' }
  const r = spawnSync(srv.headersHelper, { shell: true, encoding: 'utf8', timeout: 30_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let h = null
  try { h = r.status === 0 ? JSON.parse(String(r.stdout || '').trim()) : null } catch { h = null }
  const v = h && (h.Authorization || h.authorization)
  return typeof v === 'string' && v.trim() ? { header: v.trim() } : { why: '헤더 도우미가 이 PC 의 팀 열쇠를 꺼내지 못했다: 팀 화면 › 설정 › 에이전트 설치의 한 줄을 다시 붙여 넣는다' }
}
// 원본 하나 올리기 → { ref } | { why }(이 파일만 첨부 못 함) | { stop }(열쇠 · 자리 · 지식이 틀려 더 올리지 않는다)
export async function uploadOne({ origin, kn, header }, buf) {
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  let r
  try {
    r = await fetch(`${originOf(origin)}/api/k/${encodeURIComponent(kn)}/stage/${sha}`, { method: 'PUT', headers: { authorization: header, 'content-type': 'application/octet-stream' }, body: buf })
  } catch (e) {
    return { why: `원본을 올리지 못했다(연결: ${e?.cause?.code || e?.name || '네트워크'})` }
  }
  let j = null
  try { j = await r.json() } catch { j = null }
  if (r.ok && j?.ref === `sha256:${sha}`) return { ref: j.ref }
  const msg = String(j?.message || '').replace(/[\r\n]+/g, ' ').slice(0, 200)
  if ([401, 403, 404].includes(r.status)) return { stop: `원본을 올릴 수 없다(${j?.error || r.status}${msg ? ` · ${msg}` : ''})` }
  return { why: `원본을 올리지 못했다(${j?.error || r.status}${msg ? ` · ${msg}` : ''})` }
}

// 파일 하나 → 한 줄 · upload: { origin, kn, header } 면 원본을 올려 atts 에 ref 를 싣는다
export async function parseOne({ rel, file }, { attach = false, upload = null } = {}) {
  let buf
  try {
    const st = fs.statSync(file)
    if (st.size > PARSE_MAX_FILE) return { rel, md: null, sha: null, tags: [], why: `파일이 너무 크다(${Math.round(st.size / 1048576)}MB · ${PARSE_MAX_FILE >> 20}MB 까지)`, atts: [], failed: true }
    buf = fs.readFileSync(file)
  } catch (e) {
    return { rel, md: null, sha: null, tags: [], why: e?.code === 'ENOENT' ? '없는 파일이다' : `읽지 못했다: ${e?.message || e}`, atts: [], failed: true }
  }
  const fm = await fileToMd(rel, buf)
  const md = fm.md != null ? fm.md : null
  // 지문 · 표지는 저장 문의 증명과 같은 규칙(core/importer.js ingestFp · ingestTags)
  const sha = ingestFp(md, buf)
  const line = { rel, md, sha, tags: ingestTags(rel, sha) }
  if (fm.scan || (fm.blank && fm.kind === 'office')) line.scan = true
  if (fm.kind === 'img') line.img = true
  if (fm.why) line.why = fm.why
  // 못 바꿈 — 바꾸다 넘어졌거나 · 까닭이 있는 빈 글(깨진 hwp · 암호 pdf: Claude 도 원본을 읽지 못한다) · 글도 스캔도 그림도 아닌 것
  if (fm.failed || (md == null && (fm.why || (!line.scan && !line.img)))) {
    delete line.scan
    line.failed = true
    if (!line.why) line.why = fm.blank ? '글도 그림도 없는 파일이다' : '바꾸지 못했다'
  }
  line.atts = []
  if (upload && fm.attach && !line.failed) {
    if (buf.length > UPLOAD_MAX) line.attachWhy = `원본이 ${UPLOAD_MAX >> 20}MB 를 넘어 첨부하지 않는다`
    else {
      const u = await uploadOne(upload, buf)
      if (u.stop) return { ...line, stop: u.stop }
      if (u.ref) line.atts = [{ path: `docs/assets/${rel}`, ref: u.ref, bytes: buf.length }]
      else line.attachWhy = u.why
    }
  } else if (upload && md != null && !line.failed) {
    // 글 원천(md · txt · csv …): 첨부는 짓지 않고 원본을 올려 source 로 지문을 증명한다(저장 문 · 제안이 내 올린 자리에서 풀어 대 본다)
    if (buf.length > UPLOAD_MAX) line.attachWhy = `원본이 ${UPLOAD_MAX >> 20}MB 를 넘어 올리지 않는다`
    else {
      const u = await uploadOne(upload, buf)
      if (u.stop) return { ...line, stop: u.stop }
      if (u.ref) line.source = { path: rel, ref: u.ref }
      else line.attachWhy = u.why
    }
  } else if (attach && fm.attach) line.atts = [{ path: `docs/assets/${rel}`, file: path.resolve(file), bytes: buf.length }]
  return line
}

export async function run(argv, { write = (s) => process.stdout.write(s) } = {}) {
  const args = [...argv]
  const at = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v ?? '' }
  const has = (f) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true }
  const out = at('--out')
  const attach = has('--attach')
  const up = at('--upload')
  const kn = at('--kn')
  const authEnv = at('--auth-env')
  const target = args.find((a) => !a.startsWith('--'))
  const emit = (o) => write(JSON.stringify(o) + '\n')
  if (!target || out === '' || up === '' || (up != null && !kn) || (up != null && !originOf(up))) {
    emit({ done: true, n: 0, fail: 0, why: '쓰는 법: kmd-parse <파일|폴더> [--out <폴더>] [--attach] [--upload <팀 서버 주소> --kn <팀 지식 id>]' })
    return 1
  }
  let upload = null
  if (up != null) {
    const a = uploadAuth({ origin: up, authEnv })
    if (!a.header) { emit({ done: true, n: 0, fail: 0, why: a.why }); return 1 }
    upload = { origin: up, kn, header: a.header }
  }
  if (!fs.existsSync(target)) {
    emit({ rel: path.basename(target), md: null, sha: null, tags: [], why: '없는 파일이다', atts: [], failed: true })
    emit({ done: true, n: 0, fail: 1 })
    return 1
  }
  const files = listFiles(target)
  if (!files.length) {
    emit({ done: true, n: 0, fail: 0, why: '읽을 파일이 없다(md · 오피스 · hwp · pdf · 글 · 그림)' })
    return 1
  }
  let fail = 0
  const index = []
  for (const f of files) {
    const line = await parseOne(f, { attach, upload })
    if (line.stop) {
      emit({ done: true, n: index.length, fail, why: line.stop })
      return 1
    }
    if (line.failed) fail++
    if (out && line.md != null) {
      const mdFile = path.join(out, ...`${line.rel}.md`.split('/'))
      fs.mkdirSync(path.dirname(mdFile), { recursive: true })
      fs.writeFileSync(mdFile, line.md)
      delete line.md
      line.mdFile = path.resolve(mdFile)
    }
    if (out) index.push(line)
    emit(line)
  }
  if (out) {
    fs.mkdirSync(out, { recursive: true })
    const tmp = path.join(out, `index.json.${process.pid}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(index, null, 1) + '\n')
    fs.renameSync(tmp, path.join(out, 'index.json'))
  }
  emit({ done: true, n: files.length, fail })
  return fail ? 2 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
    process.stdout.write(JSON.stringify({ done: true, n: 0, fail: 0, why: `넘어졌다: ${e?.message || e}` }) + '\n')
    process.exitCode = 1
  })
}
