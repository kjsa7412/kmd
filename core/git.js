// git — 시스템 `git` 을 부른다. 지식의 이력이자 백업의 바탕이다.
//
// 뒤에서 도는 git 은 묻지 않는다(GIT_TERMINAL_PROMPT=0 · GCM_INTERACTIVE=never) —
// 물으면 서버가 조용히 멈춘다. 줄 끝은 바꾸지 않는다(core.autocrlf=false).

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { KmdError } from './errors.js'

const BASE = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.quotepath=false', '-c', 'commit.gpgsign=false']

export function git(cwd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LANG: 'C.UTF-8' }
    const p = execFile('git', [...BASE, ...args], { cwd, env, maxBuffer: 64 << 20, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new KmdError('E_GIT', `git ${args[0]} 이 실패했다 — ${String(stderr || err.message).trim().split('\n')[0]}`))
      else resolve(stdout)
    })
    if (input != null) p.stdin.end(input)
  })
}

// 실패해도 던지지 않는 판 — 백업처럼 실패 사유(stderr)를 갈라 써야 하는 곳
export function tryGit(cwd, args, { timeout = 0, env: extra = {} } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', LANG: 'C.UTF-8', ...extra }
    execFile('git', [...BASE, ...args], { cwd, env, maxBuffer: 64 << 20, windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.killed ? 'timeout' : err?.message) || ''), timedOut: !!err?.killed })
    })
  })
}

export const headSha = async (dir) => {
  const r = await tryGit(dir, ['rev-parse', '--verify', '-q', 'HEAD'])
  return r.ok ? r.out.trim() : null
}
export const currentBranch = async (dir) => {
  const r = await tryGit(dir, ['symbolic-ref', '--short', '-q', 'HEAD'])
  return r.ok ? r.out.trim() || null : null
}
export const hasCommit = async (dir, sha) => !!sha && (await tryGit(dir, ['cat-file', '-e', `${sha}^{commit}`])).ok
export const isAncestor = async (dir, a, b) => (await tryGit(dir, ['merge-base', '--is-ancestor', a, b])).ok
export async function remoteUrl(dir, remote) {
  const r = await tryGit(dir, ['remote', 'get-url', remote])
  return r.ok ? r.out.trim() : null
}
// 주소의 자격(사용자:비밀@)은 지운다 — 상태 파일 · 화면 · 로그에 남기지 않는다
export const maskUrl = (u) => String(u || '').replace(/\/\/[^/@\s]+@/, '//')
// 커밋 시각(초) — 안 보낸 것 중 가장 오래된 것의 나이를 잰다
export async function oldestAfter(dir, from) {
  const r = await tryGit(dir, ['log', '--reverse', '--format=%ct', from ? `${from}..HEAD` : 'HEAD'])
  const xs = r.ok ? r.out.trim().split('\n').filter(Boolean) : []
  return { count: xs.length, oldest: xs.length ? Number(xs[0]) * 1000 : null }
}

const who = (user) => {
  const n = String(user).replace(/[<>\s]+/g, '') || 'kmd'
  return ['-c', `user.name=${n}`, '-c', `user.email=${n}@kmd`]
}

// git 이 없는 지식 폴더면 세우고, 있던 글을 첫 묶음으로 남긴다
export async function ensureRepo(dir) {
  const has = await fs.stat(path.join(dir, '.git')).then(() => true, () => false)
  if (has) return false
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['add', '-A'])
  const staged = (await git(dir, ['diff', '--cached', '--name-only'])).trim()
  if (staged) await git(dir, [...who('kmd'), 'commit', '-q', '-m', '처음 — 있던 글'])
  return true
}

// 고친 파일만 묶어 남긴다 — 사람이 손으로 고친 다른 파일은 섞지 않는다
export async function commitPaths(dir, paths, message, user) {
  await git(dir, ['add', '--', ...paths])
  await git(dir, [...who(user), 'commit', '-q', '-m', message, '--', ...paths])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}
