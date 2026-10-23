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
import crypto from 'node:crypto'
import { material, check as checkDraft, planSave } from '../core/tidy.js'
import * as feed from '../core/feed.js'
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
  const jobs = new Map() // 정리 일감
  let tidyTimer = null
  const lastTidy = new Map()
  const drafts = new Map() // 초안 전용 단기 열쇠(sha → { job, kn, exp })
  const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
  async function groupFor(k, id, g) {
    if (!g) return null
    const all = material(k)
    if (g.kind === 'touches') {
      const x = all.find((y) => y.kind === 'touches' && y.record.id === g.record?.id)
      if (!x) return null
      const r = await ladder(k, await hub.index(id), { q: `${x.record.title} ${x.record.body}`.slice(0, 300), learned: await loadLearned(dataDir, id), max: 8 })
      x.candidates = [...r.exact, ...r.coords].filter((c) => c.coord).slice(0, 8).map((c) => ({ coord: c.coord, name: c.name }))
      return x
    }
    return all.find((y) => y.kind === 'section' && y.coord === g.coord) || null
  }
  // 되돌림 — 그 문서에서 7일 안에 되돌린 수
  async function recentReverts(id, doc) {
    const k = await hub.get(id)
    const cut = Date.now() - 7 * 864e5
    return k.works.filter((w) => w.reopens.length && w.title.startsWith('되돌림') && w.body.includes(doc.replace(/^docs\/|\.md$/g, '')) && (stampMs(w.date) || 0) >= cut).length
  }
  async function saveRun(id, run) {
    const f = path.join(dataDir, 'tidy', `${encodeURIComponent(id)}.json`)
    const all = await fs.readFile(f, 'utf8').then(JSON.parse, () => [])
    all.unshift(run)
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, JSON.stringify(all.slice(0, 30)))
  }
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
      // 그 사람의 「오늘 바뀐 것」 한 줄
      const title = input?.record?.title || ''
      feed.add(dataDir, ctx.user, queued || !r0.docs.length
        ? { kn: id, dot: r0.docs.length ? 'acc' : 'pend', text: `${meta.name}에 기록 — 「${title.split(' — ')[0]}」`, small: r0.docs.length ? '' : '정리 때 문서에 들어간다' }
        : { kn: id, dot: 'acc', text: `저장 — ${meta.name} › ${r0.docs.map((p) => p.replace(/^docs\/|\.md$/g, '')).join(' · ')} 「${title.split(' — ')[0]}」`, small: '문서에도 넣었다' }).catch(() => {})
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
      // 주인 · 정리하는 사람 · 관리자 — 또는 그 정리가 넣은 기록을 쓴 사람(「내 기록에서 값이 바뀌었다 — 되돌릴 수 있다」)
      const mine = (k.byWork.get(record)?.reflects || []).some((x) => k.byWork.get(x)?.author === ctx.user)
      if (!hub.canDirect(ctx, id) && !owners.rowOf(reg, id)?.curators?.includes(ctx.user) && !ctx.admin && !mine) throw new KmdError('E_FORBIDDEN', '주인 · 정리하는 사람만 되돌린다')
      const plan = await revertPlan(k, record)
      const w = plan.record
      // 정리 기록을 되돌리면 그 정리가 넣은 기록들도 「주인이 되돌림」 — 다음 정리가 같은 초안을 다시 넣지 않게
      const used = w.tags.includes('curate-llm') ? [...w.body.matchAll(/^- 넣음 (\S+) — /gm)].map((m) => m[1]) : []
      return hub.save(ctx, id, {
        record: { title: `되돌림 — ${w.title}`, body: plan.sections.length ? plan.sections.map((s) => `- ${s.doc.replace(/^docs\/|\.md$/g, '')} › ${s.heading} — 넣기 전 글로`).join('\n') : '넣은 항목이 없다 — 판정만 거둔다', tags: ['curate-auto'], reopens: [w.id, ...used] },
        sections: plan.sections.map((s) => ({ doc: s.doc, heading: s.heading, content: s.content, applied: s.applied })),
      }, { system: true }).then(async (r) => {
        // 그 사람의 「오늘 바뀐 것」 줄에 「되돌렸다」
        for (const x of await feed.list(dataDir, ctx.user)) if (x.revert === record) await feed.mark(dataDir, ctx.user, x.id, { reverted: true })
        return r
      })
    },
    // 비교 — 그 기록이 넣은 항목의 넣기 전 · 지금
    async diff(ctx, id, record) {
      const k = await hub.get(id, ctx)
      const plan = await revertPlan(k, record)
      return plan.sections.map((s) => {
        const d = k.byDocPath.get(s.doc)
        const now = d?.sections.find((x) => x.h === s.heading)
        return { doc: s.doc.replace(/^docs\/|\.md$/g, ''), title: d?.title || s.doc, heading: s.heading, before: s.content, after: now ? now.body : '' }
      })
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

    // ── 정리(KM81 — 검사를 넘으면 승인 없이 바로) ──
    // 일감은 서버가 낸다(정해진 시간 · [지금 정리]). 일꾼은 일감마다 받은 초안 전용 단기 열쇠로 재료를 받고 초안만 올린다
    tidyAtOf: (id) => owners.rowOf(reg, id)?.tidyAt || config.tidyAt || '02:30',
    async tidyNow(ctx, id, { by = ctx.user, auto = false } = {}) {
      await hub.meta(id, ctx)
      const cur = [...jobs.values()].find((j) => j.kn === id && (j.state === 'queued' || j.state === 'running'))
      if (cur) return cur
      const j = { id: crypto.randomBytes(6).toString('hex'), kn: id, by, auto, at: new Date().toISOString(), state: 'queued' }
      jobs.set(j.id, j)
      return j
    },
    job: (jid) => jobs.get(jid) || null,
    jobsOf: (id) => [...jobs.values()].filter((j) => j.kn === id),
    // 일꾼 — 다음 일감 하나 + 그 일감 · 그 지식에만 쓰는 단기 열쇠(30분 · 한 일감)
    workerNext(wctx) {
      const j = [...jobs.values()].find((x) => x.state === 'queued')
      if (!j) return null
      j.state = 'running'
      j.worker = wctx.worker.id
      j.started = new Date().toISOString()
      const key = 'kmdd_' + crypto.randomBytes(24).toString('base64url')
      drafts.set(sha(key), { job: j.id, kn: j.kn, exp: Date.now() + 30 * 60_000 })
      return { job: { id: j.id, kn: j.kn }, key }
    },
    draftCtx(token) {
      const d = drafts.get(sha(token))
      if (!d || d.exp < Date.now()) return null
      return { user: 'kmd-worker', admin: false, draft: d, token }
    },
    async material(dctx, id) {
      if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const row = owners.rowOf(reg, id)
      // 나가기 전에 막는다 — 「Claude 에 보내지 않음」 · 남의 개인 지식은 주인이 켠 것만
      if (row?.noClaude) throw new KmdError('E_FORBIDDEN', '이 지식은 Claude 에 보내지 않는다')
      if (row?.private && !row.workerOk) throw new KmdError('E_FORBIDDEN', '개인 지식은 주인이 켠 것만 정리한다')
      const k = await hub.get(id)
      const idx = await hub.index(id)
      const learned = await loadLearned(dataDir, id)
      const cands = []
      const groups = material(k, { candidates: (w) => cands.find((c) => c.id === w.id)?.list || [] })
      // 이름 없는 기록의 후보 이름 — 찾기 사다리(제목 + 글)
      for (const g of groups.filter((x) => x.kind === 'touches')) {
        const r = await ladder(k, idx, { q: `${g.record.title} ${g.record.body}`.slice(0, 300), learned, max: 8 })
        g.candidates = [...r.exact, ...r.coords].filter((c) => c.coord).slice(0, 8).map((c) => ({ coord: c.coord, name: c.name }))
      }
      return { kn: id, groups }
    },
    async drafts(dctx, id, list) {
      if (dctx.draft.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const j = jobs.get(dctx.draft.job)
      const meta = await hub.meta(id)
      const rows = []
      for (const item of Array.isArray(list) ? list : []) {
        cache.delete(id)
        const k = await hub.get(id)
        // 묶음은 일꾼이 보낸 것을 믿지 않고 지금 지식에서 다시 만든다(열쇠를 빼앗겨도 재료 · 근거를 바꾸지 못하게)
        const g = await groupFor(k, id, item.group)
        const d = item.draft
        if (!g) {
          rows.push({ kind: 'left', target: String(item.group?.heading || item.group?.record?.title || ''), why: '그사이 넣을 것이 없어졌다', records: [] })
          continue
        }
        const r = item.error ? { ok: false, why: item.error === 'login' ? '정리 전용 로그인이 끝났다' : item.error === 'limit' ? '사용 한도에 닿았다' : '초안을 받지 못했다' } : checkDraft(k, g, d)
        const target = g.kind === 'touches' ? g.record.title : `${g.doc.replace(/^docs\/|\.md$/g, '')} › ${g.heading}`
        const recs = g.kind === 'touches' ? [g.record] : g.records
        if (!r.ok) {
          rows.push({ kind: 'left', target, why: r.why, records: recs.map((x) => x.id) })
          continue
        }
        // 되돌림이 잦은 문서는 7일 동안 값 바뀜을 넣지 않는다
        if (r.changed.length && (await recentReverts(id, g.doc)) >= 2) {
          rows.push({ kind: 'left', target, why: '이 문서는 되돌림이 잦아 값이 바뀌는 것은 7일 동안 넣지 않는다', records: recs.map((x) => x.id) })
          continue
        }
        try {
          const saved = await coreSave(meta.dir, planSave(k, g, d, { model: item.model }), { user: 'kmd-auto', system: true })
          const used = g.kind === 'touches' ? [] : g.records.filter((x) => d.used.includes(x.id))
          rows.push({ kind: g.kind === 'touches' ? 'touches' : r.changed.length ? 'changed' : 'put', target, record: saved.id, from: r.changed[0]?.from, to: r.changed[0]?.to, records: used.map((x) => x.id), left: (d.left || []).map((x) => x.id) })
          // 그 기록을 쓴 사람의 「오늘 바뀐 것」 — 값이 바뀌었으면 노랑
          for (const u of [...new Set(used.map((x) => x.author))]) {
            await feed.add(dataDir, u, r.changed.length
              ? { kn: id, yl: true, b: `kmd 가 정리하며 값을 바꿨다 — ${meta.name} › ${target} · ${r.changed[0].from} → ${r.changed[0].to}`, small: '내 기록에서 — 되돌릴 수 있다', go: { kn: id, doc: g.doc.replace(/^docs\/|\.md$/g, ''), hl: g.heading }, revert: saved.id }
              : { kn: id, dot: 'acc', text: `kmd 가 정리했다 — ${meta.name} › ${target}`, small: '내가 남긴 기록', go: { kn: id, doc: g.doc.replace(/^docs\/|\.md$/g, ''), hl: g.heading } })
          }
        } catch (e) {
          rows.push({ kind: 'left', target, why: e.message, records: recs.map((x) => x.id) })
        }
      }
      cache.delete(id)
      const run = { at: new Date().toISOString(), by: j?.by || null, auto: !!j?.auto, rows }
      await saveRun(id, run)
      if (j) {
        j.state = 'done'
        j.done = run.at
        j.summary = { put: rows.filter((x) => x.kind === 'put' || x.kind === 'touches').length, changed: rows.filter((x) => x.kind === 'changed').length, left: rows.filter((x) => x.kind === 'left').length }
      }
      drafts.delete(sha(dctx.token || ''))
      if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return { rows, summary: j?.summary || null }
    },
    async workerStatus(wctx, { ok = true, reason = null, message = null } = {}) {
      const prev = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => ({}))
      const next = ok ? { ok: true, at: new Date().toISOString() } : { ok: false, reason, message: String(message || '').slice(0, 200), since: prev.ok === false ? prev.since : new Date().toISOString(), at: new Date().toISOString() }
      await fs.mkdir(dataDir, { recursive: true })
      await fs.writeFile(path.join(dataDir, 'worker.json'), JSON.stringify(next))
      for (const j of jobs.values()) if (j.state === 'running' && j.worker === wctx.worker.id && !ok) j.state = 'failed'
      return next
    },
    async runs(id) {
      return fs.readFile(path.join(dataDir, 'tidy', `${encodeURIComponent(id)}.json`), 'utf8').then(JSON.parse, () => [])
    },
    // 새 기기가 이어졌다 — 그 사람의 오늘 바뀐 것 · 다음 대화 첫 안내(다른 대역에서 받은 표면 노랑)
    async notifyDevice(user, dev) {
      await feed.add(dataDir, user, { brief: true, yl: !!dev.yellow, dot: 'acc', text: `새 기기가 이어졌다 — ${dev.host || '이름 없는 기기'} · ${user}`, small: '설치 한 줄로 · 내가 한 것이 아니면 [보기] 에서 끊는다', device: dev.id })
    },
    async today(ctx) {
      return feed.list(dataDir, ctx.user)
    },
    async notices(ctx) {
      return feed.takeNotices(dataDir, ctx.user)
    },

    // 멈춤 줄 — 그 사람이 보는 지식만
    async stops(ctx, id = null) {
      const ks = id ? [await hub.meta(id, ctx)] : await hub.visible(ctx)
      const out = []
      // 정리 일꾼이 쉬고 있다(로그인 끝 · 한도) — 관리자 · 정리하는 사람에게
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      const curates = ctx.admin || ks.some((k) => owners.rowOf(reg, k.id)?.curators?.includes(ctx.user) || owners.rowOf(reg, k.id)?.owner === ctx.user)
      if (ws && ws.ok === false && curates && !id) {
        const days = Math.max(1, Math.round((Date.now() - Date.parse(ws.since)) / 864e5))
        out.push(stopLine({ kind: 'worker', level: 'warn', what: '자동 정리가 쉬고 있다', amount: `${days}일`, fix: ctx.admin ? '관리 › Claude 연결에서 다시 로그인하면 이어서 한다' : null, told: ctx.admin ? null : '관리자에게 알렸다' }))
      }
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
      // 정해진 시간의 정리 — 분마다 본다 · 지식마다 하루 한 번 · 넣을 것이 있을 때만
      tidyTimer = setInterval(async () => {
        const d = new Date()
        const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        const day = d.toISOString().slice(0, 10)
        for (const m of await hub.list().catch(() => [])) {
          if (hm < hub.tidyAtOf(m.id) || lastTidy.get(m.id) === day) continue
          lastTidy.set(m.id, day)
          const k = await hub.get(m.id).catch(() => null)
          if (k && k.works.some((w) => w.state === 'pend' || w.state === 'nowhere')) hub.tidyNow({ user: 'kmd', admin: true }, m.id, { by: 'kmd', auto: true }).catch(() => {})
        }
      }, config.tidyTickMs || 60_000)
      tidyTimer.unref?.()
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
      clearInterval(tidyTimer)
    },
  }
  return hub
}

export const defaultDataDir = (root) => path.join(root, '.kmd')
const stampMs = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : null
}

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
