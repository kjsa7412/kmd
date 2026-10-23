// 나가는 자격 — 팀 서버가 바깥에 닿는 비밀(DB · 원천 git · Claude …).
//
// 화면으로 받지 않는다 — 서버 셸의 숨김 입력(`kmd secret set <이름>`)으로만. `<data>/secrets.json`(0600).
// 화면 · API 는 이름과 「있음 · 언제 넣었나」 만 본다.

import fs from 'node:fs/promises'
import path from 'node:path'

const fileOf = (dataDir) => path.join(dataDir, 'secrets.json')
const NAME = /^[a-z0-9][a-z0-9._/-]{0,63}$/

async function load(dataDir) {
  const t = await fs.readFile(fileOf(dataDir), 'utf8').catch(() => null)
  return t ? JSON.parse(t) : {}
}

export async function setSecret(dataDir, name, value) {
  if (!NAME.test(name)) throw new Error('비밀 이름은 영문 소문자 · 숫자 · . _ / - 로')
  const all = await load(dataDir)
  all[name] = { value: String(value), at: new Date().toISOString() }
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(fileOf(dataDir) + '.tmp', JSON.stringify(all, null, 1) + '\n', { mode: 0o600 })
  await fs.rename(fileOf(dataDir) + '.tmp', fileOf(dataDir))
}
export async function getSecret(dataDir, name) {
  return (await load(dataDir))[name]?.value ?? null
}
export async function listSecrets(dataDir) {
  return Object.entries(await load(dataDir)).map(([name, v]) => ({ name, at: v.at }))
}
export async function delSecret(dataDir, name) {
  const all = await load(dataDir)
  delete all[name]
  await fs.writeFile(fileOf(dataDir), JSON.stringify(all, null, 1) + '\n', { mode: 0o600 })
}
