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
