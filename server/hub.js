// kmd 의 가운데 — 지식 읽기 · 저장 · 백업 · 멈춤 줄 · 누가 무엇을 보나. 화면(HTTP)과 세션(MCP)이 같은 길을 쓴다.
//
// 모든 길은 ctx { user, admin, machine? } 를 받는다. 볼 수 없는 지식은 목록 · 찾기 · 읽기 · 저장에서 같은 판정
// 한 곳(`owners.visible`)으로 가린다. 저장은 여기 한 곳으로만 간다 — 읽기만으로 닫힌 지식을 막고, 그 지식의
// 캐시만 새로 읽게 하고(바뀐 파일만 — F12), 백업 줄에 넣고, 멈춤 줄을 warnings 로 돌려준다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { listKnowledge, loadKnowledge, coordsOfSection, sectionOf } from '../core/knowledge.js'
import { KmdError } from '../core/errors.js'
import { save as coreSave, serial } from '../core/save.js'
import { decide, decisionRecord, revertPlan } from '../core/curate.js'
import * as collect from '../core/collect.js'
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

export async function makeHub({ root, dataDir, mode = 'team', pcUser = null, log = (...a) => console.log('[kmd]', ...a) }) {
  const config = await loadConfig(dataDir)
  let reg = await owners.load(dataDir)
  const cache = new Map() // 지식 → 읽은 지식(promise)
  const files = new Map() // 지식 → 파일 캐시
  const indexes = new Map() // 지식 → { k, p: 색인 promise }
  let list = null
  const decideTimers = new Map()
  const watchers = []
  const scheduleDecide = (id) => {
    clearTimeout(decideTimers.get(id))
    const t = setTimeout(() => hub.decide(id).catch((e) => log('결정 규칙', id, e.message)), config.decideMs ?? 60_000)
    t.unref?.()
    decideTimers.set(id, t)
  }

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
      // 팀 지식에서 주인 · 정리하는 사람이 아니면 항목 글은 기록에 싣는다 — 정리 때 문서에 들어간다
      let queued = false
      if (input?.sections?.some((s) => s?.doc && owners.isReservedFile(String(s.doc).replace(/\.md$/, '') + '.md'))) throw new KmdError('E_FORBIDDEN', 'kmd 가 쓰는 파일이다')
      if (input?.sections?.length && !opt.system && !hub.canDirect(ctx, id)) {
        const k = await hub.get(id)
        const add = []
        const lines = []
        for (const s of input.sections) {
          if (s.coord) {
            add.push(s.coord)
            const x = sectionOf(k, s.coord)
            lines.push(`## ${x?.sec?.h || x?.loc?.heading || s.coord}\n${String(s.content || '').trim()}`)
          } else lines.push(`## ${s.heading}\n${String(s.content || '').trim()}`)
          if (!s.coord && s.doc && s.heading) {
            const d = k.docs.find((x) => x.id === String(s.doc).replace(/^docs\/|\.md$/g, ''))
            if (d) add.push(...coordsOfSection(k, d, s.heading))
          }
        }
        input = { record: { ...input.record, touches: [...new Set([...(input.record?.touches || []), ...add])], body: `${input.record?.body || ''}\n\n${lines.join('\n\n')}`.trim() } }
        queued = true
      }
      const r0 = await coreSave(meta.dir, input, { user: ctx.user, system: !!opt.system })
      const r = queued ? { ...r0, queued: true } : r0
      cache.delete(id)
      scheduleDecide(id)
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

    // 고치기 — 주인(PC · 개인 · 주인 줄)은 저장하면 바로 문서에 · 그 밖은 기록으로 남고 정리 때 문서에
    canDirect(ctx, id) {
      if (mode === 'pc' || ctx.pc) return true
      const r = owners.rowOf(reg, id)
      if (r?.owner && r.owner === ctx.user) return true
      if (r?.curators?.includes(ctx.user)) return true
      return !r?.owner && !!ctx.admin // 주인을 정하지 않은 팀 지식은 관리자가 정리한다
    },
    async edit(ctx, id, { doc, sections }) {
      const k = await hub.get(id, ctx)
      const d = k.docs.find((x) => x.id === doc)
      if (!d) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      if (!Array.isArray(sections) || !sections.length) throw new KmdError('E_INPUT', '바뀐 항목이 없다')
      const hs = sections.map((s) => String(s.h || '').trim())
      if (hs.some((h) => !h || /[\r\n]/.test(h))) throw new KmdError('E_INPUT', '항목 이름은 한 줄 글이다')
      const coords = [...new Set(hs.flatMap((h) => coordsOfSection(k, d, h)))]
      if (hub.canDirect(ctx, id)) {
        const r = await hub.save(ctx, id, {
          record: { title: `화면에서 고침 — ${d.title} 「${hs.join(' · ')}」`, body: `화면에서 고쳤다 — ${hs.map((h) => `${d.title} › ${h}`).join(' · ')}`, touches: coords, tags: ['edit'] },
          sections: sections.map((s) => ({ doc: d.path, heading: s.h, content: String(s.body ?? ''), ...(s.base ? { base: s.base } : {}) })),
        }, { system: true })
        return { direct: true, ...r }
      }
      const body = sections.map((s) => `## ${s.h}\n${String(s.body ?? '').trim()}`).join('\n\n')
      const r = await hub.save(ctx, id, { record: { title: `${d.title} › ${hs.join(' · ')} 고침`, body: `화면에서 남긴 기록 — 정리 때 문서에 넣는다\n\n${body}`, touches: coords } })
      return { direct: false, ...r }
    },
    // 되돌리기 — 그 기록을 넣은 항목을 넣기 전 글로 쓰고 판정을 거둔다(그 기록은 다시 아직 안 넣은 기록)
    async revert(ctx, id, { record }) {
      const k = await hub.get(id, ctx)
      if (!hub.canDirect(ctx, id) && !owners.rowOf(reg, id)?.curators?.includes(ctx.user) && !ctx.admin) throw new KmdError('E_FORBIDDEN', '주인 · 정리하는 사람만 되돌린다')
      const plan = await revertPlan(k, record)
      const w = plan.record
      return hub.save(ctx, id, {
        record: { title: `되돌림 — ${w.title}`, body: plan.sections.length ? plan.sections.map((s) => `- ${s.doc.replace(/^docs\/|\.md$/g, '')} › ${s.heading} — 넣기 전 글로`).join('\n') : '넣은 항목이 없다 — 판정만 거둔다', tags: ['curate-auto'], reopens: [w.id] },
        sections: plan.sections.map((s) => ({ doc: s.doc, heading: s.heading, content: s.content, applied: s.applied })),
      }, { system: true })
    },
    // 결정 규칙 — 저장 뒤 잠시(기본 1분) 뒤에 한 번 · 누름 없음
    async decide(id) {
      const meta = await hub.meta(id)
      const k = await hub.get(id)
      const { curates, tasks } = decide(k)
      if (!curates.length) return { curates: 0, tasks: tasks.length }
      await coreSave(meta.dir, { record: decisionRecord(curates) }, { user: 'kmd-auto', system: true })
      cache.delete(id)
      return { curates: curates.length, tasks: tasks.length }
    },
    tasks: async (id) => decide(await hub.get(id)).tasks,

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
      // 거두기 — PC(또는 serve.json collect)에서 편집기로 고친 문서를 30초 고요 뒤 들인다
      if (mode === 'pc' || config.collect) for (const m of await hub.list()) watchers.push(collect.watch(m.dir, () => hub.collect(m.id)))
      // 찾기 색인 — 뒤에서 미리(지금 찾는 지식은 기다리지 않고 그때 짓는다)
      setTimeout(async () => {
        for (const m of await hub.list().catch(() => [])) await hub.index(m.id).catch(() => {})
      }, 200).unref?.()
    },
    async collect(id) {
      const meta = await hub.meta(id)
      const user = pcUser || 'kmd'
      const r = await serial(path.resolve(meta.dir), () => collect.collectNow(meta.dir, { user, save: (x) => collect.writeCollect(meta.dir, { ...x, user }) }))
      if (r) {
        cache.delete(id)
        if (r.reverted?.length) log(`${meta.name} — 손으로 고친 기록 · 장부를 되돌렸다: ${r.reverted.join(' · ')}`)
        if (r.id && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      }
      return r
    },
    stop() {
      backup.stop()
      for (const w of watchers) w.close()
      for (const t of decideTimers.values()) clearTimeout(t)
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
