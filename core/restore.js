// 되살리기 — 백업 자리에서 지식을 새 폴더로 받아 온다(폴더 밖 이력 · 새 PC 의 [이 PC 로 되살리기] · 지식 받아 오기).
//
//   받기    `git clone`(원격 이름 kmd-backup · 서브모듈 끔 · https · ssh 만 — 이 PC 의 폴더는 허락된 루트 안일 때만)
//   확인    `git fsck` · 지식 검사(check) · 트리 해시 · 첨부 · 이름 장부 · `_members.md` 가 같이 왔나
//   붙이기  받은 곳을 그대로 이 지식의 백업 자리로 — 다음 저장부터 이어서 보낸다(호출하는 쪽이 attach)
// 받는 폴더는 없거나 비어 있어야 한다. 실패하면 받던 폴더를 치운다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { tryGit } from './git.js'
import { KmdError } from './errors.js'
import { REMOTE } from './backup.js'

const isLocal = (u) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^[^/\\]+@[^/\\]+:/.test(u)

export function checkUrl(url, { roots = [], pc = false } = {}) {
  url = String(url || '').trim()
  if (!url || /[\s\0]/.test(url) || /^-|^ext::/i.test(url) || /^file:/i.test(url)) throw new KmdError('E_INPUT', '백업 자리 주소가 아니다')
  if (isLocal(url)) {
    const full = path.resolve(url)
    if (!pc && !roots.map((r) => path.resolve(r)).some((r) => full === r || full.startsWith(r + path.sep))) throw new KmdError('E_FORBIDDEN', '이 폴더는 백업 자리로 허락되지 않았다. serve.json 의 backupRoots')
    return { url: full, local: true }
  }
  if (!/^(https?|ssh):\/\//i.test(url) && !/^[^/\\]+@[^/\\]+:/.test(url)) throw new KmdError('E_INPUT', '주소는 https · ssh 만')
  return { url, local: false }
}

export async function restore({ url, dir, check = null, local = false }) {
  const st = await fs.readdir(dir).catch(() => null)
  if (st && st.length) throw new KmdError('E_CONFLICT', '받을 폴더가 비어 있지 않다')
  await fs.mkdir(path.dirname(dir), { recursive: true })
  const guard = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', `protocol.file.allow=${local ? 'always' : 'never'}`, '-c', 'submodule.recurse=false', '-c', 'core.autocrlf=false']
  const r = await tryGit(path.dirname(dir), [...guard, 'clone', '-q', '--origin', REMOTE, '--', url, dir], { timeout: 300_000 })
  const clean = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  if (!r.ok) {
    await clean()
    throw new KmdError('E_INPUT', `백업 자리에서 받지 못했다: ${String(r.err || '').split('\n')[0].replace(/\/\/[^/@\s]+@/, '//').slice(0, 160)}`)
  }
  const fsck = await tryGit(dir, ['fsck', '--no-progress'], { timeout: 300_000 })
  if (!fsck.ok) {
    await clean()
    throw new KmdError('E_CHECK', '받은 이력이 깨졌다(fsck): 다른 백업에서 받는다')
  }
  for (const k of ['core.autocrlf', 'core.quotepath']) await tryGit(dir, ['config', k, 'false'])
  const head = (await tryGit(dir, ['rev-parse', 'HEAD'])).out.trim()
  const tree = (await tryGit(dir, ['rev-parse', 'HEAD^{tree}'])).out.trim()
  const files = (await tryGit(dir, ['ls-files', '-z'])).out.split('\0').filter(Boolean)
  const errors = check ? await check(dir) : []
  return {
    head,
    tree,
    fsck: true,
    errors,
    docs: files.filter((f) => /^docs\/.+\.md$/.test(f)).length,
    records: files.filter((f) => /^work\/[^/]+\.md$/.test(f)).length,
    atts: files.filter((f) => /^(docs|work)\/assets\//.test(f)).length,
    vocab: files.includes('_vocab.md'),
    members: files.includes('_members.md'),
  }
}
