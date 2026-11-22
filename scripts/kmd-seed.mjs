// 짜임 꾸러미 도구 — 세션 스킬 kmd-seed(.claude/skills/kmd-seed)가 부른다(바탕 세우기 설계 6절 · Z9).
//   화면 한도(300 파일 · 200MB)를 넘는 원본 · 스캔 pdf · 하위 에이전트로 나눠 지을 카드 · 구조안의 재료를 「짜임 꾸러미」 폴더로 만든다.
//   기능(화면 · 길)이 아니다. **지식에 쓰지 않는다** — 꾸러미 폴더에만 쓰고, 넣기는 사람이 기초 세우기 화면에서 같은 승인 · 같은 엔진으로 한다.
//
//   node scripts/kmd-seed.mjs survey <원본 폴더> --out <꾸러미>          조사: 파일마다 글로 바꿈(fileToMd) · 판 · 같은 글 · 스캔 · 비밀 의심 · 기본 고르기
//   node scripts/kmd-seed.mjs text   <꾸러미> <원본 경로> <글 파일.md>     스캔 글 넣기: 세션이 원본을 읽어 지은 글을 그 파일의 재료로(scan: true)
//   node scripts/kmd-seed.mjs prompt <꾸러미> card [--from n] [--n 10] | plan | text <문서 id> | text --all --save   하위 에이전트 프롬프트(작성기준 3 ~ 5절 · 6-1 판단 기준)
//   node scripts/kmd-seed.mjs check  <꾸러미> [--kn <지식 폴더>] [--json]  마른 검사: 구조안 planCheck(빈 지식 · 또는 그 지식을 읽기만) · 재료 · 덮임 · 비밀 의심 · 글 초안 꼴
//   node scripts/kmd-seed.mjs status <꾸러미> [--json]                    꾸러미 요약: 판 · 고르기 · 스캔 글 · 카드 · 구조안 · 글 초안
//
//   나가는 코드: 0 · 1(쓰기 · 오류) · 2(check 걸림)

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { survey, addText, openPack, packCheck, promptOf, ROLES, PICKS } from '../core/survey.js'
import { loadKnowledge } from '../core/knowledge.js'
import { readStructure } from '../core/restructure.js'

function args(argv) {
  const pos = []
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (['json', 'save', 'all'].includes(key)) o[key] = true
      else o[key] = argv[++i]
    } else pos.push(a)
  }
  return { pos, o }
}
const line = (c) => [...ROLES.map((k) => (c[k] ? `${k} ${c[k]}` : null)), c.scanNeed ? `글 없는 스캔 ${c.scanNeed}` : null, c.big ? `큰 파일 ${c.big}` : null].filter(Boolean).join(' · ')
const picks = (c) => PICKS.map((k) => `${k} ${c[`pick:${k}`] || 0}`).join(' · ')
const mb = (b) => `${(b / 1048576).toFixed(1)}MB`

async function cmdSurvey(root, o) {
  const r = await survey(root, { out: o.out, log: (m) => console.error(m) })
  if (o.json) return console.log(JSON.stringify({ pack: r.pack, counts: r.counts }, null, 1))
  console.log(`꾸러미: ${r.pack}`)
  console.log(`원본 ${r.counts.files} 파일 · ${mb(r.counts.bytes)}: ${line(r.counts)}`)
  console.log(`처음 고르기: ${picks(r.counts)}(화면에서 사람이 다시 고른다)`)
  const sec = r.rows.filter((x) => x.role === '비밀 의심')
  if (sec.length) console.log(`비밀 의심(보류 · 카드에 보내지 않음): ${sec.slice(0, 10).map((x) => `${x.path}(${x.secret.map((s) => `${s.line}째 줄 ${s.why}`).join(', ')})`).join(' / ')}${sec.length > 10 ? ` / 그 밖 ${sec.length - 10}` : ''}`)
  const scan = r.rows.filter((x) => x.role === '스캔' && !x.src)
  if (scan.length) console.log(`글이 없는 스캔(원본을 읽어 text 로 넣는다): ${scan.slice(0, 10).map((x) => x.path).join(' / ')}${scan.length > 10 ? ` / 그 밖 ${scan.length - 10}` : ''}`)
}

async function cmdText(pack, rel, file) {
  const md = await fs.readFile(path.resolve(file), 'utf8')
  const row = await addText(pack, rel, md)
  console.log(`넣음: ${row.path} → ${row.src}(스캔 글 · 고르기 ${row.pick}${row.secret ? ` · 비밀 의심: ${row.secret.map((s) => s.why).join(', ')}` : ''})`)
}

// --save(채널 평가 T10): 프롬프트를 꾸러미 prompts/<card-N | plan | text-문서>.md 에 쓰고 경로 한 줄만 찍는다.
//   메인 세션이 수천 자 프롬프트를 하위 에이전트 입력으로 다시 생성하던 몫(real-2b 다섯 번 1.46만 자 · 약 150초)을 걷는다
//   text --all --save(채널 평가 T14 seed): 구조안의 문서마다 prompts/text-<문서>.md 를 쓰고 경로를 한 줄씩: 문서 id 에 빈칸이 들어
//   따옴표 없이 부르다 「구조안에 없는 문서다: 게이트웨이/장애」 로 걸리던 것(real-5)과 문서마다 부르던 몫을 걷는다
async function cmdPrompt(pack, kind, a, o) {
  const P = await openPack(pack)
  const from = Number(o.from || 0)
  if (kind === 'text' && o.all) {
    if (!o.save) throw new Error('text --all 은 --save 와 같이 쓴다(문서마다 프롬프트 파일)')
    if (!P.plan) throw new Error('구조안(plan.json)이 먼저다')
    for (const d of P.plan.docs) if (!d.was) console.log(await savePrompt(P, `text-${d.id.replace(/[\\/:*?"<>|]/g, '__')}`, promptOf(P, 'text', { doc: d.id })))
    return
  }
  const text = promptOf(P, kind, { from, n: Number(o.n || 10), doc: a || null })
  if (!o.save) return console.log(text)
  const name = kind === 'card' ? `card-${from}` : kind === 'plan' ? 'plan' : `text-${String(a).replace(/[\\/:*?"<>|]/g, '__')}`
  console.log(await savePrompt(P, name, text))
}
async function savePrompt(P, name, text) {
  const file = path.join(P.pack, 'prompts', `${name}.md`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${text}\n`)
  return file
}

// 경고는 고치지 않는다(채널 평가 T14 seed · 크기를 맞추려고 한 대상을 쪼갠 판이 있었다): 머리 줄에 말로 막는다(크기 경고는 접지 않는다 · 신호는 그대로)
async function cmdCheck(pack, o) {
  let k = null
  let files = null
  if (o.kn) {
    const abs = path.resolve(o.kn)
    try { await fs.access(path.join(abs, 'docs')) } catch { throw new Error(`지식 폴더가 아니다(docs/ 가 없다): ${abs}`) }
    files = await readStructure(abs)
    k = await loadKnowledge({ id: path.basename(abs), name: path.basename(abs), dir: abs })
  }
  const r = await packCheck(pack, { k, files })
  if (o.json) console.log(JSON.stringify(r, null, 1))
  else {
    console.log(`${r.ok ? '걸림 없음' : `걸림 ${r.errors.length}`} · 경고 ${r.warnings.length}${r.warnings.length ? '(고치지 않는다 · 사람이 본다)' : ''}${r.stale ? ' · 지문(base)이 지금 지식과 다르다: 화면이 다시 견준다' : ''}`)
    if (r.summary) console.log(`문서 ${r.summary.creates} · 글 단위 ${r.summary.writes}`)
    for (const e of r.errors.slice(0, 40)) console.log(`  걸림 ${e.where}: ${e.why}`)
    if (r.errors.length > 40) console.log(`  그 밖 걸림 ${r.errors.length - 40}`)
    for (const w of r.warnings.slice(0, 20)) console.log(`  경고 ${w.where}: ${w.why}`)
    if (r.warnings.length > 20) console.log(`  그 밖 경고 ${r.warnings.length - 20}`)
  }
  if (!r.ok) process.exitCode = 2
}

async function cmdStatus(pack, o) {
  const P = await openPack(pack)
  const s = { pack: P.pack, root: P.root, made: P.made, counts: P.counts, cards: P.cards, plan: P.plan ? { docs: P.plan.docs.length, items: P.plan.docs.reduce((a, d) => a + d.items.length, 0), skip: P.plan.skip.length } : null, planError: P.planError, texts: P.texts.length, problems: P.problems }
  if (o.json) return console.log(JSON.stringify(s, null, 1))
  console.log(`꾸러미: ${s.pack}(원본 ${s.root} · 조사 ${s.made})`)
  console.log(`원본 ${s.counts.files} 파일 · ${mb(s.counts.bytes)}: ${line(s.counts)}`)
  console.log(`고르기: ${picks(s.counts)}`)
  console.log(`카드 ${s.cards} · 구조안 ${s.plan ? `문서 ${s.plan.docs} · 항목 ${s.plan.items} · skip ${s.plan.skip}` : s.planError ? `못 읽음(${s.planError})` : '없음'} · 글 초안 ${s.texts}`)
  for (const p of s.problems.slice(0, 20)) console.log(`  문제 ${p.where}: ${p.why}`)
}

export async function main(argv) {
  const { pos, o } = args(argv)
  const [cmd, a, b, c] = pos
  if (cmd === 'rules') { const { genRulesBlock } = await import('../core/genrules.js'); console.log(genRulesBlock({ profile: 'shape' })); return }
  if (cmd === 'survey' && a) return cmdSurvey(a, o)
  if (cmd === 'text' && a && b && c) return cmdText(a, b, c)
  if (cmd === 'prompt' && a && b) return cmdPrompt(a, b, c, o)
  if (cmd === 'check' && a) return cmdCheck(a, o)
  if (cmd === 'status' && a) return cmdStatus(a, o)
  console.error('쓰기: kmd-seed.mjs survey <원본 폴더> --out <꾸러미> | text <꾸러미> <원본 경로> <글 파일.md> | prompt <꾸러미> card|plan|text <문서 id> [--save] | prompt <꾸러미> text --all --save | check <꾸러미> [--kn <지식 폴더>] | status <꾸러미>')
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`오류: ${e.code ? `${e.code} ` : ''}${e.message}`)
    process.exitCode = 1
  })
}
