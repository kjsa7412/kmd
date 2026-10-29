// 원자적 쓰기 — 장부 · 설정 JSON 을 반쯤 쓴 채로 남기지 않는다.
//
// 이 쓰기만의 임시 파일(둘이 같은 .tmp 를 다투지 않게)에 다 쓴 뒤 이름을 바꾼다. 꺼지거나 겹쳐도 파일은 앞의 것이거나 새 것이다.
// Windows 에서 백신 · 색인 · 읽는 쪽이 잠깐 잡으면(EPERM · EBUSY · EACCES) 조금 쉬고 몇 번 더(owners.store · sources.writeState 와 같은 방식).
// 같은 파일을 읽고 고쳐 쓰는 쪽(읽기 · 고치기 · 쓰기)은 부르는 쪽이 save.serial 로 한 줄로 세운다 — 이 함수는 마지막 쓰기만 지킨다.

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const BUSY = ['EPERM', 'EBUSY', 'EACCES']

export async function writeFileAtomic(file, data, { mode, encoding = 'utf8', tries = 20 } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, data, { encoding, ...(mode != null ? { mode } : {}) })
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(tmp, file)
    } catch (e) {
      if (i >= tries || !BUSY.includes(e.code)) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw e
      }
      await new Promise((ok) => setTimeout(ok, 25 * Math.min(i + 1, 8)))
    }
  }
}

// value 를 JSON 으로 — indent(기본 없음) · nl(끝 줄바꿈)은 그 파일이 쓰던 모양 그대로 고른다
export function writeJsonAtomic(file, value, { indent, nl = false, mode } = {}) {
  return writeFileAtomic(file, JSON.stringify(value, null, indent) + (nl ? '\n' : ''), { mode })
}
