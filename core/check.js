// 검사 — 지식 폴더가 kmd 가 읽을 수 있는 모양인가. 오류는 한 줄 글의 목록(같은 오류는 같은 글 — 앞뒤를 견준다).
//
// 백업에서 받은 머리 · 저장 뒤 · 서버 시작에서 같은 함수를 부른다. 판이 올라가며 검사 줄만 더한다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { readText } from './text.js'
import { parseRecord } from './frontmatter.js'

const DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/

export async function check(dir) {
  const errs = []
  const files = await fs.readdir(path.join(dir, 'work')).catch(() => [])
  const seen = new Map()
  for (const f of files.filter((x) => x.toLowerCase().endsWith('.md')).sort()) {
    const text = await fs.readFile(path.join(dir, 'work', f), 'utf8').then(readText, () => null)
    const r = text == null ? null : parseRecord(text, f)
    if (!r) {
      errs.push(`기록 머리가 깨졌다 — work/${f}`)
      continue
    }
    if (!DATE.test(r.date)) errs.push(`기록 날짜 모양이 아니다 — work/${f}`)
    if (seen.has(r.id)) errs.push(`같은 기록 이름이 둘 — ${r.id}`)
    seen.set(r.id, f)
  }
  return errs
}
