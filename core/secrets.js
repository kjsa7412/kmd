// 나가는 자격 — 팀 서버가 바깥에 닿는 비밀(DB · 원천 git · Claude …).
//
// 화면으로 받지 않는다 — 서버 셸의 숨김 입력(`kmd secret set <이름>`)으로만. `<data>/secrets.json`(0600).
// 화면 · API 는 이름과 「있음 · 언제 넣었나」 만 본다.
// 쓰기는 넣기 · 지우기 모두 임시 파일 뒤 이름 바꾸기(지우다 꺼져도 깨진 파일이 남지 않게 · 깨지면 모든 자격이 「없음」 으로 보인다).

import fs from 'node:fs/promises'
import path from 'node:path'
import { writeJsonAtomic } from './atomic.js'

const fileOf = (dataDir) => path.join(dataDir, 'secrets.json')
const NAME = /^[a-z0-9][a-z0-9._/-]{0,63}$/

async function load(dataDir) {
  const t = await fs.readFile(fileOf(dataDir), 'utf8').catch(() => null)
  return t ? JSON.parse(t) : {}
}

// 고치기는 한 줄로 — 읽기 · 고치기 · 쓰기가 겹쳐 앞의 것을 덮지 않게(같은 프로세스 안)
let q = Promise.resolve()
function mutate(dataDir, fn) {
  const p = q.then(async () => {
    const all = await load(dataDir)
    fn(all)
    await writeJsonAtomic(fileOf(dataDir), all, { indent: 1, nl: true, mode: 0o600 })
  })
  q = p.catch(() => {})
  return p
}

export async function setSecret(dataDir, name, value) {
  if (!NAME.test(name)) throw new Error('비밀 이름은 영문 소문자 · 숫자 · . _ / - 로')
  await mutate(dataDir, (all) => {
    all[name] = { value: String(value), at: new Date().toISOString() }
  })
}
export async function getSecret(dataDir, name) {
  return (await load(dataDir))[name]?.value ?? null
}
export async function listSecrets(dataDir) {
  return Object.entries(await load(dataDir)).map(([name, v]) => ({ name, at: v.at }))
}
export async function delSecret(dataDir, name) {
  await mutate(dataDir, (all) => {
    delete all[name]
  })
}
