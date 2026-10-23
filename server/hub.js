// kmd 의 가운데 — 지식 읽기 · 저장 · 백업 · 멈춤 줄 · 누가 무엇을 보나. 화면(HTTP)과 세션(MCP)이 같은 길을 쓴다.
//
// 모든 길은 ctx { user, admin, machine? } 를 받는다. 볼 수 없는 지식은 목록 · 찾기 · 읽기 · 저장에서 같은 판정
// 한 곳(`owners.visible`)으로 가린다. 저장은 여기 한 곳으로만 간다 — 읽기만으로 닫힌 지식을 막고, 그 지식의
// 캐시만 새로 읽게 하고(바뀐 파일만 — F12), 백업 줄에 넣고, 멈춤 줄을 warnings 로 돌려준다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { listKnowledge, loadKnowledge } from '../core/knowledge.js'
import { KmdError } from '../core/errors.js'
import { save as coreSave } from '../core/save.js'
import { check } from '../core/check.js'
import { commitPaths, ensureRepo, tryGit } from '../core/git.js'
import { stopLine } from '../core/stopline.js'
import * as backup from '../core/backup.js'
import * as owners from '../core/owners.js'
import { buildIndex, ladder, loadLearned, learn, searchCheck } from '../core/search.js'

// serve.json — 살림 자리의 설정(없어도 된다)
async function loadConfig(dataDir) {
  const t = await fs.readFile(path.join(dataDir, 'serve.json'), 'utf8').catch(() => null)
  if (t == null) return {}
  try {
    return JSON.parse(t)
  } catch (e) {
    throw new Error(`serve.json 이 깨졌다 — ${e.message}`)
  }
}

// 백업 주소가 이 PC 의 폴더인가(scp 모양 user@host:path · 스킴 주소는 아니다)
const isLocalPath = (u) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^[^/\\]+@[^/\\]+:/.test(u) && !/^ext::/i.test(u)

export async function makeHub({ root, dataDir, mode = 'team', log = (...a) => console.log('[kmd]', ...a) }) {
  const config = await loadConfig(dataDir)
  let reg = await owners.load(dataDir)
  const cache = new Map() // 지식 → 읽은 지식(promise)
  const files = new Map() // 지식 → 파일 캐시
  const indexes = new Map() // 지식 → { k, p: 색인 promise }
  let list = null

  const hub = {
    root,
    dataDir,
    mode,
    config,
    log,
    async list() {
      return (list ||= await listKnowledge(root))
    },
    // 그 사람이 보는 지식들
    async visible(ctx) {
      return (await hub.list()).filter((k) => owners.visible(reg, k.id, ctx))
    },
    async meta(id, ctx) {
      const m = (await hub.list()).find((k) => k.id === id)
      if (!m) throw new KmdError('E_NOTFOUND', `지식 「${id}」 이 없다`)
      if (ctx && !owners.visible(reg, id, ctx)) throw new KmdError('E_FORBIDDEN', '이 지식은 주인만 본다')
      return m
    },
    async get(id, ctx) {
      const meta = await hub.meta(id, ctx)
      if (!files.has(id)) files.set(id, new Map())
      if (!cache.has(id)) cache.set(id, loadKnowledge(meta, { cache: files.get(id) }).catch((e) => { cache.delete(id); throw e }))
      return cache.get(id)
    },
    async all(ctx) {
      return Promise.all((await hub.visible(ctx)).map((k) => hub.get(k.id)))
    },
    forget(id) {
      if (id) cache.delete(id)
      else {
        cache.clear()
        list = null
      }
    },
    owner(id) {
      return owners.rowOf(reg, id)
    },
    // 지식 안에서의 내 자리 — 주인 · 정리 · 기록
    roleIn(id, ctx) {
      const r = owners.rowOf(reg, id)
      if (r?.owner && r.owner === ctx.user) return '주인'
      if (r?.curators?.includes(ctx.user)) return '정리'
      return '기록'
    },

    // 저장 하나 — ctx.user 가 쓴다
    async save(ctx, id, input, opt = {}) {
      const meta = await hub.meta(id, ctx)
      if (ctx.machine && ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const shut = backup.closed(meta)
      if (shut) throw new KmdError('E_BEHIND', shut.message)
      const r = await coreSave(meta.dir, input, { user: ctx.user, system: !!opt.system })
      cache.delete(id)
      // 백업은 기다리되 길게는 아니다 — 늦으면 다음 판정이 줄을 낸다
      if (backup.attached(meta)) await Promise.race([backup.enqueue(meta, { log }), new Promise((ok) => setTimeout(ok, 3000).unref?.())])
      return { ...r, warnings: backup.lines(meta, { name: meta.name }).map((l) => l.text) }
    },

    // 찾기 — 색인은 지식마다 · 바뀐 파일만 다시(저장 뒤 · 처음 찾을 때) · 지식을 섞지 않는다
    async index(id) {
      const k = await hub.get(id)
      const cur = indexes.get(id)
      if (cur && cur.k === k) return cur.p
      const p = buildIndex(k, { dataDir, prev: cur ? await cur.p.catch(() => null) : null })
      indexes.set(id, { k, p })
      return p
    },
    async search(ctx, id, { q = '', words = null, max = 6 } = {}) {
      const ks = id ? [await hub.meta(id, ctx)] : await hub.visible(ctx)
      const out = []
      for (const m of ks) {
        const k = await hub.get(m.id)
        const r = await ladder(k, await hub.index(m.id), { q, words, max, learned: await loadLearned(dataDir, m.id) })
        out.push({ knowledge: m.id, name: m.name, ...r })
      }
      return out
    },
    async learn(ctx, id, { q, coord }) {
      await hub.meta(id, ctx)
      await learn(dataDir, id, { q, coord, who: ctx.user })
      return { ok: true }
    },
    async searchCheck(ctx, id, { freeze = false } = {}) {
      const k = await hub.get(id, ctx)
      return searchCheck(k, await hub.index(id), { dataDir, freeze })
    },

    // 멈춤 줄 — 그 사람이 보는 지식만
    async stops(ctx, id = null) {
      const ks = id ? [await hub.meta(id, ctx)] : await hub.visible(ctx)
      const out = []
      for (const k of ks) {
        out.push(...backup.lines(k, { name: k.name }))
        if (!backup.attached(k)) {
          const u = await unbacked(k)
          if (u) out.push(stopLine({ kind: 'backup', kn: k.id, level: 'warn', what: `${k.name} — 백업 자리가 없다`, amount: `저장 ${u.n}`, fix: '관리자가 백업 자리를 붙이면 그동안의 것을 모두 보낸다', since: `${u.since} 부터` }))
        }
      }
      return out
    },

    // 주인 · 개인 · 정리하는 사람 — 관리자 또는 지금 주인. `_members.md` 도 같이 바꿔 백업 · 되살림에 따라가게
    async setOwner(ctx, id, row) {
      const meta = await hub.meta(id, ctx)
      const cur = owners.rowOf(reg, id)
      if (!ctx.admin && !(cur?.owner && cur.owner === ctx.user) && !ctx.shell) throw new KmdError('E_FORBIDDEN', '주인이나 관리자만 바꾼다')
      const next = structuredClone(reg)
      owners.setOwner(next, id, row)
      await ensureRepo(meta.dir)
      await fs.writeFile(path.join(meta.dir, '_members.md'), owners.renderMembers(next.knowledge[id]), 'utf8')
      await commitPaths(meta.dir, ['_members.md'], '이 지식의 사람 — 주인 · 정리', 'kmd').catch(() => {})
      reg = next
      await owners.store(dataDir, reg)
      return reg.knowledge[id]
    },
    // 되살린 지식 — `_members.md` 로 주인을 다시 걸고, 없으면 관리자만 본다
    async adoptRestored(id) {
      const meta = await hub.meta(id)
      await owners.adoptMembers(reg, id, meta.dir)
      await owners.store(dataDir, reg)
      return owners.rowOf(reg, id)
    },

    // 백업 — 붙이기 · 받기 · 상태(관리자만)
    async backupAttach(ctx, id, url) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '백업 자리는 관리자가 붙인다')
      url = String(url || '').trim()
      if (!url || /[\s\0]/.test(url) || /^ext::|^-/i.test(url)) throw new KmdError('E_INPUT', '백업 자리 주소가 아니다')
      if (isLocalPath(url) && mode === 'team') {
        const roots = (config.backupRoots || []).map((r) => path.resolve(r))
        const full = path.resolve(url)
        const meta = await hub.meta(id)
        if (full === path.resolve(meta.dir) || full.startsWith(path.resolve(meta.dir) + path.sep) || full.startsWith(path.resolve(dataDir) + path.sep)) throw new KmdError('E_INPUT', '지식 폴더 · 살림 자리 안에는 백업을 둘 수 없다')
        if (!roots.some((r) => full === r || full.startsWith(r + path.sep))) throw new KmdError('E_FORBIDDEN', '이 폴더는 백업 자리로 허락되지 않았다 — serve.json 의 backupRoots 에 더한다')
      }
      const meta = await hub.meta(id, ctx)
      const r = await backup.attach(meta, url, { dataDir })
      return { ...r, backup: backup.stateOf(meta) }
    },
    async backupPull(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '백업에서 받기는 관리자가 한다')
      const meta = await hub.meta(id, ctx)
      const r = await backup.pull(meta, { check })
      cache.delete(id)
      return r
    },
    async backupState(ctx, id) {
      return backup.stateOf(await hub.meta(id, ctx))
    },
    async start() {
      await backup.start(await hub.list(), { dataDir, log })
      // 찾기 색인 — 뒤에서 미리(지금 찾는 지식은 기다리지 않고 그때 짓는다)
      setTimeout(async () => {
        for (const m of await hub.list().catch(() => [])) await hub.index(m.id).catch(() => {})
      }, 200).unref?.()
    },
    stop() {
      backup.stop()
    },
  }
  return hub
}

export const defaultDataDir = (root) => path.join(root, '.kmd')

// 백업 자리가 없는 지식 — 저장이 50 을 넘거나 첫 저장이 7일 넘었으면 노랑 한 줄(v0.5 §4.2). HEAD 마다 한 번 잰다
const unbackedCache = new Map()
async function unbacked(k) {
  const head = (await tryGit(k.dir, ['rev-parse', '-q', '--verify', 'HEAD'])).out.trim()
  if (!head) return null
  const hit = unbackedCache.get(k.dir)
  if (hit && hit.head === head) return hit.v
  const n = Number((await tryGit(k.dir, ['rev-list', '--count', 'HEAD'])).out.trim()) || 0
  const first = Number((await tryGit(k.dir, ['log', '--reverse', '--format=%ct', '--max-parents=0'])).out.trim().split('\n')[0]) * 1000
  const old = first && Date.now() - first > 7 * 864e5
  const d = new Date(first)
  const v = n >= 50 || old ? { n, since: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` } : null
  unbackedCache.set(k.dir, { head, v })
  return v
}
// 셸(서버를 띄운 사람)의 자리 — CLI 가 쓴다
export const SHELL = Object.freeze({ user: 'kmd', admin: true, shell: true })
