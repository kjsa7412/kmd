// 소스 변경 → 기록 — 감시 검토 v0.1 단계 4(결정 ③: 지식마다 켬/끔 · 「Claude 에 보내지 않음」 지식은 하지 않는다).
//
//   바뀐 코드 파일마다 기록 하나 — 「코드가 바뀌었다 — RetryPolicy.java (+12 −3)」 · 글에 바뀐 값(「3초 → 5초」) · 차이(4,000자까지)
//   이름   바뀐 줄 · 파일 이름에 나오는 이 지식의 항목 이름(이름 장부 · 다른 이름)을 단다 — 이름이 걸리면 그 항목 정리로(pend),
//          안 걸리면 정리 일꾼이 후보 중에서 고른다(nowhere → 이름 바로잡기)
//   차이   git — 지난 커밋과 새 커밋 · 폴더 — kmd 만 보는 사본(`<data>/watch/…/<지문>.snap/`)과 지금 파일(`git diff --no-index`)
//   정리   기록은 작성자 kmd · 예약 태그 code-change(사람 · 세션은 못 단다) — 정해진 정리 검사(숫자 · 이름 대조 · 값 바뀜 노랑 ·
//          줄마다 되돌리기)를 그대로 탄다. 기록을 남긴 뒤 그 지식의 정리를 저절로 건다
//   막음   테스트 · 빌드 결과 · 잠금 파일 · .min · 1MB 넘는 파일은 보지 않는다 · 한 번에 20 파일(나머지는 마지막 기록에 목록)
//   내 PC 폴더(팀으로 보내기)는 하지 않는다 — 코드가 팀으로 가지 않게

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { tryGit } from './git.js'
import { exact, nameContain } from './search.js'
import { valuesOf } from './save.js'

const CODE = /\.(js|mjs|cjs|ts|tsx|jsx|java|py|go|kt|cs|sql|xml|ya?ml|properties)$/i
const NOT = /(^|\/)(test|tests|__tests__|dist|build|target|node_modules|attic)\/|\.min\.|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i
export const wantCode = (p) => CODE.test(p) && !NOT.test(p)
export const MAX_FILES = 20
const MAX_DIFF = 4000

const snapDir = (dataDir, kn, name) => path.join(dataDir, 'watch', encodeURIComponent(kn), `${crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 16)}.snap`)

// 폴더 — 사본을 지금 파일로 맞춘다(처음 · 바뀐 뒤)
export async function syncSnap(dataDir, kn, name, rels, readBuf, removed = []) {
  const root = snapDir(dataDir, kn, name)
  for (const rel of rels) {
    const f = path.join(root, ...rel.split('/'))
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, await readBuf(rel))
  }
  for (const rel of removed) await fs.rm(path.join(root, ...rel.split('/')), { force: true })
}
export const hasSnap = (dataDir, kn, name) => fs.stat(snapDir(dataDir, kn, name)).then(() => true, () => false)

// 차이 한 파일 — { patch, plus, minus }
export async function diffFolder(dataDir, kn, name, rel, full) {
  const old = path.join(snapDir(dataDir, kn, name), ...rel.split('/'))
  const empty = path.join(os.tmpdir(), 'kmd-empty-file')
  await fs.writeFile(empty, '').catch(() => {})
  const a = (await fs.stat(old).then(() => true, () => false)) ? old : empty
  const b = full && (await fs.stat(full).then(() => true, () => false)) ? full : empty
  const r = await tryGit(os.tmpdir(), ['diff', '--no-index', '--no-color', '-U2', '--', a, b])
  return clean(r.out)
}
export async function diffGit(bare, oldCommit, newCommit, rel) {
  const r = await tryGit(bare, ['diff', '--no-color', '-U2', oldCommit, newCommit, '--', rel])
  return clean(r.out)
}
function clean(out) {
  const lines = String(out || '').split('\n')
  const body = lines.filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(l))
  const plus = body.filter((l) => l.startsWith('+')).length
  const minus = body.filter((l) => l.startsWith('-')).length
  return { patch: body.join('\n').trim(), plus, minus, added: body.filter((l) => l.startsWith('+')).map((l) => l.slice(1)), removed: body.filter((l) => l.startsWith('-')).map((l) => l.slice(1)) }
}

// 바뀐 값 — 지운 줄에만 있던 값 → 더한 줄에만 있는 값(개수가 같을 때 차례로 짝)
export function valueChanges(d) {
  const a = [...valuesOf(d.removed.join('\n'))]
  const b = [...valuesOf(d.added.join('\n'))]
  const olds = a.filter((x) => !b.includes(x))
  const news = b.filter((x) => !a.includes(x))
  if (!olds.length || olds.length !== news.length) return []
  const pairs = olds.map((x, i) => [x, news[i]])
  // 단위 붙은 짝(3초 → 5초)에 가려지는 맨 숫자 짝(3 → 5)은 뺀다
  return pairs.filter(([o, n]) => !(/^\d+$/.test(o) && pairs.some(([o2, n2]) => o2 !== o && o2.startsWith(o) && n2.startsWith(n)))).map(([o, n]) => `${o} → ${n}`)
}
// 기록 글의 「바뀐 값」 줄 → 새 값들(정리 검사가 「기록의 값이 글에 있나」 로 볼 값 — 차이 속 다른 수는 보지 않는다)
export function newValuesOf(body) {
  const m = String(body || '').match(/바뀐 값:? ([^\n]+)/)
  return m ? m[1].split(' — ')[0].split(' · ').map((p) => p.split(' → ')[1]).filter(Boolean).map((x) => x.trim()) : []
}

// 이름 — 바뀐 줄 · 파일 이름에 나오는 항목(이름 장부 · 다른 이름 · 3글자 넘는 것만 · 다섯까지)
export function namesOf(k, rel, d) {
  const out = []
  const add = (xs) => { for (const x of xs) if (x.coord && !out.includes(x.coord) && out.length < 5) out.push(x.coord) }
  const base = rel.split('/').pop().replace(/\.[^.]+$/, '')
  add(exact(k, base))
  for (const line of [...d.removed, ...d.added].slice(0, 200)) {
    const t = line.replace(/^[\s/#*\-<>!]+/, '').trim()
    if (t.length < 3) continue
    add(nameContain(k, t).filter((x) => x.via === '말이 이름을 품음' && (x.keys || []).some((key) => key.length >= 3)))
    if (out.length >= 5) break
  }
  return out
}

// 기록 한 장
export function codeRecord(k, src, rel, d, status) {
  const base = rel.split('/').pop()
  const vc = valueChanges(d)
  const what = status === 'removed' ? '지워졌다' : status === 'added' ? '새로 생겼다' : '바뀌었다'
  const title = `코드가 ${what} — ${base} (+${d.plus} −${d.minus})`
  const patch = d.patch.length > MAX_DIFF ? d.patch.slice(0, MAX_DIFF) + '\n… (뒤는 줄였다)' : d.patch
  // 첫 줄은 한 줄 요약(바뀐 값 먼저) — 사람도 정리도 첫 줄로 안다
  const body = [
    vc.length ? `바뀐 값: ${vc.join(' · ')} — ${rel}` : `${rel} 이 ${what}`,
    '',
    `${src.name} 의 코드가 ${what}. 이 항목 글이 코드와 맞는지 보고, 코드가 바꾼 값이 글에 있으면 새 값으로 고친다 — 코드에 없는 값은 지어내지 않는다.`,
    '',
    '```diff',
    patch || '(바뀐 줄 없음)',
    '```',
  ].join('\n')
  return { title: title.slice(0, 200), body, touches: namesOf(k, rel, d), tags: ['code-change'] }
}
