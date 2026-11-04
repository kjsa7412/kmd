#!/usr/bin/env node
// kmd-parse — 대량 넣기 파서(K6-1 · 설계 4-6). 내 PC 의 파일 · 폴더를 글(md)로 바꿔 한 줄씩 낸다. Claude Code 스킬 kmd-team-import 가 읽는다.
//
//   kmd-parse <파일|폴더> [--out <폴더>] [--attach]
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
//              atts  --attach 일 때 원본 첨부 자리 [{ path: docs/assets/<경로>, file: <이 PC 의 파일>, bytes }]
//   --out      글을 <폴더>/<경로>.md 로 쓰고 줄에는 md 대신 mdFile 을 싣는다 · <폴더>/index.json 에 모든 줄
//   끝 줄      { done: true, n, fail }
//   종료 코드  0 모두 · 2 일부 못 바꿈 · 1 못 함(없는 경로 · 읽을 파일 없음)

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fileToMd, cleanPath } from '../../core/importer.js'

export const PARSE_EXT = /\.(md|markdown|txt|log|csv|tsv|html?|json|docx|pptx|xlsx|hwpx|hwp|pdf|png|jpe?g|gif|webp|svg|bmp)$/i
// 파일 하나 상한 — 팀 화면 파일 넣기(32MB)보다 넉넉히 · 이보다 크면 바꾸지 않고 why
export const PARSE_MAX_FILE = 64 << 20
const skipName = (n) => n.startsWith('.') || n.startsWith('~$') || n === 'node_modules'
export const wantParse = (rel) => PARSE_EXT.test(rel) && !rel.split('/').some(skipName)

const sha16 = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16)

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

// 파일 하나 → 한 줄
export async function parseOne({ rel, file }, { attach = false } = {}) {
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
  const sha = md != null ? sha16(md.trim()) : sha16(buf)
  const line = { rel, md, sha, tags: [`ingest/${rel}`.slice(0, 60), `md/${sha}`] }
  if (fm.scan || (fm.blank && fm.kind === 'office')) line.scan = true
  if (fm.kind === 'img') line.img = true
  if (fm.why) line.why = fm.why
  // 못 바꿈 — 바꾸다 넘어졌거나 · 까닭이 있는 빈 글(깨진 hwp · 암호 pdf: Claude 도 원본을 읽지 못한다) · 글도 스캔도 그림도 아닌 것
  if (fm.failed || (md == null && (fm.why || (!line.scan && !line.img)))) {
    delete line.scan
    line.failed = true
    if (!line.why) line.why = fm.blank ? '글도 그림도 없는 파일이다' : '바꾸지 못했다'
  }
  line.atts = attach && fm.attach ? [{ path: `docs/assets/${rel}`, file: path.resolve(file), bytes: buf.length }] : []
  return line
}

export async function run(argv, { write = (s) => process.stdout.write(s) } = {}) {
  const args = [...argv]
  const at = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v ?? '' }
  const has = (f) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true }
  const out = at('--out')
  const attach = has('--attach')
  const target = args.find((a) => !a.startsWith('--'))
  const emit = (o) => write(JSON.stringify(o) + '\n')
  if (!target || out === '') {
    emit({ done: true, n: 0, fail: 0, why: '쓰는 법: kmd-parse <파일|폴더> [--out <폴더>] [--attach]' })
    return 1
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
    const line = await parseOne(f, { attach })
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
