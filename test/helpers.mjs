// 시험 도우미
import fs from 'node:fs'
import path from 'node:path'

// 폴더 복사 — fs.cpSync(recursive)는 Node 22 · Windows 의 한글 임시 경로(세정아~1)에서 넘어진다(segfault)
export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name)
    const b = path.join(to, e.name)
    if (e.isDirectory()) copyDir(a, b)
    else fs.copyFileSync(a, b)
  }
}
