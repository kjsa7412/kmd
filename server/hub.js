// kmd 의 가운데 — 지식 읽기 · 저장 · 백업 · 멈춤 줄 · 누가 무엇을 보나. 화면(HTTP)과 세션(MCP)이 같은 길을 쓴다.
//
// 모든 길은 ctx { user, admin, machine? } 를 받는다. 볼 수 없는 지식은 목록 · 찾기 · 읽기 · 저장에서 같은 판정
// 한 곳(`owners.visible`)으로 가린다. 저장은 여기 한 곳으로만 간다 — 읽기만으로 닫힌 지식을 막고, 그 지식의
// 캐시만 새로 읽게 하고(바뀐 파일만 — F12), 백업 줄에 넣고, 멈춤 줄을 warnings 로 돌려준다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { listKnowledge, loadKnowledge, coordsOfSection, sectionOf, looksLikeKnowledge } from '../core/knowledge.js'
import { KmdError } from '../core/errors.js'
import { save as coreSave, serial } from '../core/save.js'
import { decide, decisionRecord, revertPlan } from '../core/curate.js'
import * as collect from '../core/collect.js'
import crypto from 'node:crypto'
import net from 'node:net'
import { material, check as checkDraft, planSave } from '../core/tidy.js'
import * as feed from '../core/feed.js'
import { checkTarget, readSource, probe, readDecl, writeDecl, stripCreds, secretName, secretPrefix, docPrefix, runSource, planRun, readState as readSourceState, writeState as writeSourceState, sourceLines, everyMs } from '../core/sources.js'
import { check } from '../core/check.js'
import { commitPaths, ensureRepo, tryGit, maskUrl } from '../core/git.js'
import { stopLine, ageText } from '../core/stopline.js'
import * as backup from '../core/backup.js'
import * as owners from '../core/owners.js'
import { buildIndex, ladder, loadLearned, learn, searchCheck, exact } from '../core/search.js'
import { planImport, summary, MAX_FILES, MAX_BYTES } from '../core/importer.js'
import { existsSync, watch as fsWatch } from 'node:fs'
import * as sendLib from '../core/send.js'
import * as keystore from '../core/keystore.js'
import { sha16 } from '../core/text.js'
import { isSystemRecord, labelOf } from '../core/knowledge.js'
import { restore as restoreFrom, checkUrl } from '../core/restore.js'
import { watchedOf } from '../core/watchmark.js'
import { applyDocs, wantDoc, watchedCount } from '../core/docwatch.js'
import { connect as dbConnect, checkAccount, catalog as dbCatalog } from '../core/db.js'
import { listPushes, addPush, removePush, runPush, readPushState } from '../core/push.js'
import { ensureProject } from '../core/gitlab.js'
import { getSecret, setSecret, listSecrets, delSecret } from '../core/secrets.js'

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
  // 저절로 하는 일 켬 · 끔(설정) — PC 는 하나 · 팀은 사람마다. 없으면 켬
  let prefs = await fs.readFile(path.join(dataDir, 'prefs.json'), 'utf8').then(JSON.parse, () => ({}))
  const cache = new Map() // 지식 → 읽은 지식(promise)
  const files = new Map() // 지식 → 파일 캐시
  const indexes = new Map() // 지식 → { k, p: 색인 promise }
  let list = null
  const decideTimers = new Map()
  const jobs = new Map() // 정리 일감
  let tidyTimer = null
  let sourceTimer = null
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
  // 보내기 한 곳 — 같은 kmd 면 받기 길 그대로 · 다른 kmd 면 그 주소의 기기 열쇠로
  async function deliver(ctx, d, payload) {
    if (!d.url) return hub.receive(ctx, d.kn, payload)
    const key = process.env.KMD_SEND_KEY || (await keystore.get(keystore.keyName(d.url)).catch(() => null))
    return sendLib.post(d.url, d.kn, payload, key)
  }
  let sendTimer = null
  let pushTimer = null
  const srcRuns = new Map() // 가져오는 곳마다 도는 중인 것(한 줄로 세운다)
  const adding = new Set() // 막 더하는 중인 곳 — 시계 · 켤 때 확인이 끼어들지 않게
  const resyncs = new Map() // 전체 다시 맞추기 일감 — 진행률
  const srcWatch = new Map() // 코드 폴더 실시간 감시
  let started = false
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
    // 루트 아래 지식 + 이 PC 에서 이은 폴더(`<data>/links.json` — 그 자리에서 따라간다)
    async list() {
      if (!list) {
        const own = await listKnowledge(root)
        const links = await fs.readFile(path.join(dataDir, 'links.json'), 'utf8').then(JSON.parse, () => [])
        const more = []
        for (const l of links) if (!own.some((k) => k.id === l.id) && (await looksLikeKnowledge(l.dir))) more.push({ id: l.id, name: (await listKnowledge(l.dir))[0]?.name || l.id, dir: l.dir })
        list = [...own, ...more]
      }
      return list
    },
    // 지식 추가 — 새 이름(PC: 지식 폴더 안 · 팀: 서버 안 내 지식 · 나만) · 내 폴더(PC 만 · 지식 폴더 안의 새 지식으로 들여온다 · 원본은 그대로)
    async addKnowledge(ctx, { kind, name, dir, empty = false }) {
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다 — 여러 지식을 두려면 위 폴더에서 띄운다')
      if (kind === 'new') {
        const nm = String(name || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim()
        if (!nm || nm.length > 60 || nm.startsWith('.')) throw new KmdError('E_INPUT', '이름은 한 줄 60자 안')
        const all = await hub.list()
        let id = nm
        if (mode === 'team') id = `${nm}-${ctx.user}`.replace(/[<>:"/\\|?*\s]+/g, '-')
        if (all.some((k) => k.id.toLowerCase() === id.toLowerCase())) throw new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`)
        const d = path.join(root, id)
        await fs.mkdir(d, { recursive: true })
        await ensureRepo(d) // 빈 폴더에서 먼저 — 만든 묶음이 만든 사람 이름으로 남게
        await fs.mkdir(path.join(d, 'docs'), { recursive: true })
        await fs.mkdir(path.join(d, 'work'), { recursive: true })
        await fs.writeFile(path.join(d, 'README.md'), `# ${nm}\n`, 'utf8')
        if (!empty) await fs.writeFile(path.join(d, 'docs', '처음.md'), `# 처음\n\n## 개요\n새 지식 — 첫 문서를 쓴다.\n`, 'utf8')
        await commitPaths(d, empty ? ['README.md'] : ['README.md', 'docs/처음.md'], `지식 만듦 — ${nm}`, ctx.user)
        list = null
        if (mode === 'pc' && started) watchers.push(Object.assign(collect.watch(d, () => hub.collect(id)), { dir: d })) // 편집기에서 고친 것 거두기 — 켤 때 없던 지식도
        if (mode === 'team') await hub.setOwner({ ...ctx, shell: true }, id, { owner: ctx.user, private: true })
        await hub.gitlabAttach(id).catch((e) => log('GitLab 백업 자리', id, e.message))
        feed.add(dataDir, ctx.user, { kn: id, dot: 'acc', text: `지식을 추가했다 — ${nm}`, small: mode === 'team' ? '팀 서버 안 내 지식 · 나만' : d }).catch(() => {})
        return { id, name: nm, dir: mode === 'pc' ? d : undefined }
      }
      // 지식 폴더 밖의 폴더 — 그 자리에서 따라가지 않는다(남의 폴더에 쓰지 않게 · 지식은 지식 폴더 안에만).
      // 지식 폴더 안에 같은 이름의 새 지식을 세우고 그 폴더의 파일을 한 번 들여온다(파일 넣기와 같은 길 · 원본은 그대로)
      if (kind === 'folder') {
        if (mode !== 'pc' && !ctx.pc) throw new KmdError('E_FORBIDDEN', '경로는 내 PC 프로그램이 연다')
        const full = path.resolve(String(dir || ''))
        if (!path.isAbsolute(String(dir || '')) || !(await fs.stat(full).then((s) => s.isDirectory(), () => false))) throw new KmdError('E_NOTFOUND', '그 폴더가 없다')
        const inside = (a, b) => a === b || a.startsWith(b + path.sep)
        if (inside(full, path.resolve(root))) throw new KmdError('E_INPUT', '이미 지식 폴더 안이다 — 지식 목록에서 연다')
        if (inside(path.resolve(root), full)) throw new KmdError('E_INPUT', '지식 폴더를 품은 폴더는 들여오지 않는다')
        // 이미 지식 모양(docs 폴더)이면 그 docs 안을 · 아니면 폴더 전체를 문서로 · 숨김 · node_modules 는 보지 않는다
        const src = (await fs.stat(path.join(full, 'docs')).then((s) => s.isDirectory(), () => false)) ? path.join(full, 'docs') : full
        const files = []
        let bytes = 0
        const walk = async (d, rel) => {
          for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue
            const r = rel ? `${rel}/${e.name}` : e.name
            if (e.isDirectory()) await walk(path.join(d, e.name), r)
            else if (e.isFile()) {
              const st = await fs.stat(path.join(d, e.name))
              bytes += st.size
              files.push({ path: r, full: path.join(d, e.name) })
              if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new KmdError('E_INPUT', `한 번에 ${MAX_FILES} 파일 · 200MB 까지 — 자료 가져오기에서 나눠 넣는다`)
            }
          }
        }
        await walk(src, '')
        if (!files.some((f) => /\.(md|markdown|docx|pptx|xlsx)$/i.test(f.path))) throw new KmdError('E_INPUT', '이 폴더에는 문서가 될 파일(md · docx · pptx · xlsx)이 없다')
        const all = await hub.list()
        let nm = path.basename(full).normalize('NFC')
        for (let n = 2; all.some((k) => k.id.toLowerCase() === nm.toLowerCase()); n++) nm = `${path.basename(full).normalize('NFC')}-${n}`
        const made = await hub.addKnowledge(ctx, { kind: 'new', name: nm, empty: true })
        const r = await hub.importFiles(ctx, made.id, await Promise.all(files.map(async (f) => ({ path: f.path, data: await fs.readFile(f.full) }))))
        for (const x of ['_vocab.md', '_managed.md']) {
          const t = await fs.readFile(path.join(full, x)).catch(() => null)
          if (t) await fs.writeFile(path.join(made.dir, x), t)
        }
        if (src !== full) await commitPaths(made.dir, ['_vocab.md', '_managed.md'].filter((x) => existsSync(path.join(made.dir, x))), '이름 장부 들여옴', ctx.user).catch(() => {})
        cache.delete(made.id)
        return { ...made, from: full, summary: r.summary }
      }
      throw new KmdError('E_INPUT', '알아듣지 못했다 — 이름 · 내 PC 폴더 경로를 붙인다')
    },
    // 지식 지우기 — 보관하지 않고 완전히. 지식 폴더 · kmd 가 그 지식에 대해 둔 살림(백업 연결 · 색인 · 보내기 · 정리 · 가져오기 상태 · 주인 줄)을
    // 모두 지운다. 확인은 지식 이름을 그대로 다시 쓰는 것. 백업 자리에 이미 보낸 이력은 kmd 가 지우지 않는다(백업 자리의 일).
    // 누가 — 이 PC 의 주인 · 팀은 관리자 또는 개인 지식의 주인
    async deleteKnowledge(ctx, id, { confirm } = {}) {
      const meta = await hub.meta(id, ctx)
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다 — 지울 수 없다')
      const row = owners.rowOf(reg, id)
      const mine = row?.owner && row.owner === ctx.user && row.private
      if (mode !== 'pc' && !ctx.pc && !ctx.admin && !ctx.shell && !mine) throw new KmdError('E_FORBIDDEN', '팀 지식은 관리자가 지운다')
      if (String(confirm ?? '').trim().normalize('NFC') !== meta.name.normalize('NFC')) throw new KmdError('E_INPUT', `지우려면 지식 이름 「${meta.name}」 을 그대로 쓴다`)
      const dir = path.resolve(meta.dir)
      const inRoot = dir.startsWith(path.resolve(root) + path.sep)
      // 붙어 있는 것부터 떼고(감시 · 백업 · 일감 · 시계) 폴더를 지운다
      for (const w of watchers.filter((x) => x.dir && path.resolve(x.dir) === dir)) w.close()
      watchers.splice(0, watchers.length, ...watchers.filter((x) => !(x.dir && path.resolve(x.dir) === dir)))
      clearTimeout(decideTimers.get(id))
      decideTimers.delete(id)
      for (const [jid, j] of jobs) if (j.kn === id) jobs.delete(jid)
      for (const [key, w] of srcWatch) if (key.startsWith(id + '\n')) { w.close(); srcWatch.delete(key) }
      await backup.detach(meta).catch(() => {})
      cache.delete(id)
      files.delete(id)
      indexes.delete(id)
      // 지식 폴더 안의 것만 폴더째 지운다(예전에 밖에서 이어 둔 것은 잇기만 끊는다 — 남의 폴더를 지우지 않게)
      if (inRoot) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      const e = encodeURIComponent(id)
      for (const p of [`backup/${e}.json`, `send/${e}.json`, `inbox/${e}.json`, `tidy/${e}.json`, `baseline/${e}.json`, `searchcheck/${e}.json`, `learn/${e}.json`, `index/${e}`, `sources/${e}`, `watch/${e}`]) await fs.rm(path.join(dataDir, p), { recursive: true, force: true }).catch(() => {})
      for (const x of await listSecrets(dataDir).catch(() => [])) if (x.name.startsWith(secretPrefix(id))) await delSecret(dataDir, x.name).catch(() => {}) // 가져오는 곳의 자격
      const lf = path.join(dataDir, 'links.json')
      const links = await fs.readFile(lf, 'utf8').then(JSON.parse, () => null)
      if (links) await fs.writeFile(lf, JSON.stringify(links.filter((l) => l.id !== id), null, 1))
      if (reg.knowledge[id]) {
        delete reg.knowledge[id]
        await owners.store(dataDir, reg)
      }
      list = null
      feed.add(dataDir, ctx.user || 'kmd', { dot: 'acc', text: `지식을 지웠다 — ${meta.name}`, small: inRoot ? '보관하지 않고 완전히' : '잇기만 끊었다 — 폴더는 그 자리에 그대로' }).catch(() => {})
      log(`지식을 지웠다 — ${meta.name}${inRoot ? '' : ' (잇기만 끊음)'}`)
      return { id, name: meta.name, removed: inRoot }
    },
    autoOf(user, key) {
      return mode === 'pc' ? prefs.pc?.[key] !== false : prefs.users?.[user]?.[key] !== false
    },
    async setAuto(ctx, key, on) {
      const ok = mode === 'pc' ? ['save', 'file', 'src', 'claude', 'find'] : ['file', 'find']
      if (!ok.includes(key)) throw new KmdError('E_INPUT', '그런 일은 없다')
      const next = structuredClone(prefs)
      if (mode === 'pc') (next.pc ||= {})[key] = !!on
      else ((next.users ||= {})[ctx.user] ||= {})[key] = !!on
      await fs.mkdir(dataDir, { recursive: true })
      await fs.writeFile(path.join(dataDir, 'prefs.json'), JSON.stringify(next, null, 1))
      prefs = next
      return { key, on: !!on }
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
        const r = await ladder(k, await hub.index(m.id), { q, words, max, learned: await loadLearned(dataDir, m.id), passagesMax: hub.autoOf(ctx.user, 'find') ? 5 : 0 })
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
      const w = watchedOf(await fs.readFile(path.join(k.dir, ...d.path.split('/')), 'utf8').catch(() => ''))
      if (w) throw new KmdError('E_FORBIDDEN', `이 문서는 원본이 주인이다 — ${w.src} 의 ${w.path} 를 고친다 · 덧붙일 말은 기록으로 남긴다`)
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

    // ── 자동으로 가져오는 곳(v0.6 §5) — 더하기는 관리자(팀) · 주인(PC) · 그 밖은 [관리자에게 부탁] ──
    async sourceCtx(id) {
      const metas = await hub.list()
      const backups = metas.map((m) => backup.stateOf(m)?.url).filter(Boolean)
      return { roots: (config.sourceRoots || []).map((r) => path.resolve(r)), dataDir, knowledgeDirs: metas.map((m) => m.dir), backups, pc: mode === 'pc' }
    },
    canSource(ctx, id) {
      return mode === 'pc' || ctx.pc || !!ctx.admin
    },
    // 살펴보기 — 주소를 받아 어떤 규칙이 무엇을 내는지(쓰지 않는다)
    async sourceProbe(ctx, id, { at, kind = null }) {
      await hub.meta(id, ctx)
      const k2 = kind || (/^(https?|ssh):\/\//i.test(String(at)) || /\.git$/i.test(String(at)) ? 'git' : 'folder')
      const t = checkTarget(at, { kind: k2, ...(await hub.sourceCtx(id)) })
      const src = { name: 'probe', kind: k2, at: t.url || t.folder, folder: t.folder, rules: [] }
      const r = await readSource(src, { dataDir, kn: id })
      const files = await r.read()
      return { kind: k2, at: maskUrl(t.url || t.folder), asof: r.asof, files: files.length, rules: probe(files).map((x) => ({ rule: x.rule, items: x.items.length, sample: x.items.slice(0, 3).map((i) => i.key || `${i.rows.length}줄`) })) }
    },
    // 더하기 — 유형마다(folder 코드 폴더 · git 저장소 · db). 나가는 자격(git 토큰 · DB 비밀번호)은 이 PC 화면만 받는다 —
    // 팀 화면은 받지 않고 셸 한 줄(`kmd secret set <자격 이름>`)과 상태만 보인다(v0.6 정정 ③)
    async sourceAdd(ctx, id, { name, at, kind = null, every = 'hourly', rules, cred = null, db = null, mode: pcMode = 'docs', meaning = false }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 관리자가 더한다 — [관리자에게 부탁]')
      name = String(name || '').trim()
      if (!name || name.length > 60 || /[\r\n"]/.test(name)) throw new KmdError('E_INPUT', '이름은 한 줄 60자 안')
      const pcScreen = mode === 'pc' || ctx.pc
      if ((cred?.password || cred?.token || db?.password) && !pcScreen) throw new KmdError('E_FORBIDDEN', `자격은 화면으로 받지 않는다 — 서버에서 한 줄: kmd secret set ${secretName(id, name)}`)
      const k2 = kind || (db ? 'db' : /^(https?|ssh):\/\//i.test(String(at)) ? 'git' : 'folder')
      // 파일 목록(files)은 걷었다(감시 검토 v0.1 — 값보다 소음) · 표 파일(tables)은 사람이 고른 파일 · 폴더만
      // docs — 문서 폴더(지식 안 그 폴더로 사본 문서) · pc — 내 PC 폴더(팀 · 관리자 · PC 프로그램이 기계 열쇠로 보낸다 · 결정 ④)
      if (k2 === 'pc' && (mode !== 'team' || !ctx.admin)) throw new KmdError('E_FORBIDDEN', '내 PC 폴더는 팀에서 관리자가 허락한다')
      const okRules = k2 === 'db' ? ['dbtables'] : k2 === 'docs' || (k2 === 'pc' && pcMode === 'docs') ? ['docs'] : ['deps', 'tables']
      for (const r of Array.isArray(rules) ? rules : []) {
        if (r?.rule !== 'tables') continue
        const ps = (Array.isArray(r.paths) ? r.paths : []).map((x) => String(x).trim().replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '')).filter(Boolean)
        if (!ps.length || ps.some((x) => x.split('/').includes('..') || /^[A-Za-z]:|^\//.test(x))) throw new KmdError('E_INPUT', '표로 만들 파일 · 폴더를 그 안의 경로로 하나 이상 적는다(예: codes/상태코드.csv · data/)')
        r.paths = ps.slice(0, 50)
      }
      if (!Array.isArray(rules) || !rules.length || rules.some((r) => !okRules.includes(r.rule) || !r.into?.doc)) throw new KmdError('E_INPUT', `무엇을 채우나는 ${okRules.join(' · ')} 중 · 넣을 문서와 함께`)
      const decl = await readDecl(meta.dir)
      if (decl.some((s) => s.name === name)) throw new KmdError('E_CONFLICT', '같은 이름의 가져오는 곳이 있다')
      let shown
      if (k2 === 'db') {
        const d = db || {}
        const word = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/
        if ((d.engine || 'postgres') !== 'postgres') throw new KmdError('E_INPUT', 'DB 는 PostgreSQL 만 — 다른 DB 는 바깥 생성기(기계 열쇠)로')
        if (!/^[A-Za-z0-9.-]{1,253}$/.test(String(d.host || ''))) throw new KmdError('E_INPUT', '호스트가 아니다')
        const port = Number(d.port || 5432)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new KmdError('E_INPUT', '포트는 1 ~ 65535')
        if (!word.test(String(d.database || ''))) throw new KmdError('E_INPUT', 'DB 이름이 아니다')
        if (!word.test(String(d.user || ''))) throw new KmdError('E_INPUT', '계정이 아니다')
        const schema = String(d.schema || 'public')
        if (!word.test(schema)) throw new KmdError('E_INPUT', '스키마 이름이 아니다')
        if (d.password) await setSecret(dataDir, secretName(id, name), String(d.password))
        shown = `postgres://${d.user}@${d.host}:${port}/${d.database}?schema=${schema}`
      } else if (k2 === 'pc') {
        shown = '내 PC — 기계 열쇠로 보낸다'
      } else {
        const t = checkTarget(at, { kind: k2 === 'docs' ? 'folder' : k2, ...(await hub.sourceCtx(id)) })
        if (k2 === 'git' && (cred?.user || cred?.token)) await setSecret(dataDir, secretName(id, name), `${cred.user || 'git'}:${cred.token || ''}`)
        shown = t.url ? await stripCreds(t.url, { dataDir, kn: id, name }) : t.folder
      }
      // DB 주소는 계정 이름까지 둔다(비밀번호는 처음부터 없다) · 그 밖은 주소에 든 자격을 가린다
      // 뜻 갱신(소스 변경 → 기록 → 정리)은 코드 폴더 · git 만 — 내 PC 폴더는 코드가 팀으로 가지 않게 하지 않는다
      const src = { name, kind: k2, ...(meaning && (k2 === 'folder' || k2 === 'git') ? { meaning: true } : {}), ...(k2 === 'pc' ? { mode: pcMode === 'docs' ? 'docs' : 'code' } : {}), at: k2 === 'db' || k2 === 'pc' ? shown : maskUrl(shown), every: k2 === 'pc' ? 'manual' : every, rules: rules.map((r) => ({ rule: r.rule, ...(r.paths ? { paths: r.paths } : {}), into: { doc: String(r.into.doc), ...(r.into.heading ? { heading: String(r.into.heading) } : {}) } })), by: ctx.user, since: new Date().toISOString().slice(0, 10) }
      const addKey = `${id}\n${name}`
      adding.add(addKey)
      try {
        await writeDecl(meta.dir, [...decl, src], { user: ctx.user, title: `가져오는 곳 더함 — ${name}` })
        cache.delete(id)
        if (k2 === 'pc') {
          // 그 지식 · 그 이름에만 묶인 열쇠 — 한 번만 보인다 · PC 프로그램 › 자료 가져오기 › 팀으로 보내는 폴더에 넣는다
          const mk = await hub.machineKey(id, name)
          return { source: src, run: [{ name, state: 'waiting', n: 0, why: '내 PC 프로그램이 보내기를 기다린다' }], key: mk.key, team: null }
        }
        if (started) hub.watchSource(id, src)
        const r = await hub.sourceRun(id, name, { first: true })
        return { source: src, run: r, secret: secretName(id, name) }
      } finally {
        adding.delete(addKey)
      }
    },
    // ── 팀으로 보내는 폴더(이 PC) — 팀 관리자가 허락한 열쇠로 바뀐 것만 팀 지식에 ──
    async pushes(ctx) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '팀으로 보내는 폴더는 내 PC 프로그램에서')
      const st = await readPushState(dataDir)
      return (await listPushes(dataDir)).map((p) => ({ ...p, state: st[p.id] || {}, watch: srcWatch.has(`push\n${p.id}`) ? 'live' : 'poll', resync: resyncs.get(`push\n${p.id}`) || null }))
    },
    async pushAdd(ctx, body) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '팀으로 보내는 폴더는 내 PC 프로그램에서')
      const p = await addPush(dataDir, body || {})
      if (started) hub.watchPush(p)
      const r = await hub.pushRun(p.id)
      return { push: p, run: r }
    },
    async pushRun(id, { full = false, onProgress = null } = {}) {
      const p = (await listPushes(dataDir)).find((x) => x.id === id)
      if (!p) throw new KmdError('E_NOTFOUND', '그 폴더가 없다')
      const key = `push\n${id}`
      const job = (srcRuns.get(key) || Promise.resolve()).catch(() => {}).then(() => runPush(dataDir, p, { full, onProgress }))
      srcRuns.set(key, job)
      const r = await job
      if (srcRuns.get(key) === job) srcRuns.delete(key)
      return r
    },
    async pushResync(ctx, id) {
      const key = `push\n${id}`
      if (resyncs.get(key)?.state === 'running') return resyncs.get(key)
      const job = { state: 'running', done: 0, total: 0, at: new Date().toISOString() }
      resyncs.set(key, job)
      hub.pushRun(id, { full: true, onProgress: (d, t) => { job.done = d; job.total = t } }).then((r) => Object.assign(job, { state: r.state === 'failed' ? 'failed' : 'done', result: r, end: new Date().toISOString() }))
      return job
    },
    async pushRemove(ctx, id) {
      srcWatch.get(`push\n${id}`)?.close()
      srcWatch.delete(`push\n${id}`)
      await removePush(dataDir, id)
      return { ok: true }
    },
    watchPush(p) {
      const key = `push\n${p.id}`
      srcWatch.get(key)?.close()
      let timer = null
      try {
        const w = fsWatch(p.folder, { recursive: true }, (ev, f) => {
          const q = String(f || '').replace(/\\/g, '/')
          if (q.split('/').some((x) => x.startsWith('.') || x.startsWith('~$') || x === 'node_modules')) return
          clearTimeout(timer)
          timer = setTimeout(() => hub.pushRun(p.id).catch(() => {}), config.watchQuietMs ?? 10_000)
          timer.unref?.()
        })
        w.on('error', () => {})
        srcWatch.set(key, { close: () => { clearTimeout(timer); w.close() } })
      } catch {}
    },
    // 기계 열쇠 — http 가 auth 를 이어 준다(내 PC 폴더를 허락할 때 그 지식 · 그 이름에만)
    machineKey: async () => { throw new KmdError('E_INPUT', '기계 열쇠를 만들 수 없다') },
    // 내 PC 폴더 — PC 프로그램이 묻는 선언(무엇을 · 어디로) · 기계 열쇠의 그 이름만
    async pcDecl(ctx, id) {
      const meta = await hub.meta(id)
      if (!ctx.machine || ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const s = (await readDecl(meta.dir)).find((x) => x.name === ctx.machine.source && x.kind === 'pc')
      if (!s) throw new KmdError('E_NOTFOUND', '팀에서 이 폴더를 뺐다 — 관리자에게 묻는다')
      return { kn: id, knName: meta.name, name: s.name, mode: s.mode, rules: s.rules }
    },
    // 내 PC 폴더 — 바뀐 문서를 받는다(원본이 주인 · 지운 것은 「원본에 없다」 · 한꺼번에 많이 사라지면 멈춤)
    async receiveWatched(ctx, id, { files = [], removed = [], host = '', first = false } = {}) {
      const meta = await hub.meta(id)
      if (!ctx.machine || ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      const s = (await readDecl(meta.dir)).find((x) => x.name === ctx.machine.source && x.kind === 'pc' && x.mode === 'docs')
      if (!s) throw new KmdError('E_NOTFOUND', '팀에서 이 문서 폴더를 뺐다 — 관리자에게 묻는다')
      if (!Array.isArray(files) || !Array.isArray(removed) || files.length > MAX_FILES) throw new KmdError('E_INPUT', `한 번에 ${MAX_FILES} 파일까지`)
      const k = await hub.get(id)
      const st = await readSourceState(dataDir, id)
      const s0 = (st[s.name] ||= {})
      const now = new Date().toISOString()
      const before = await watchedCount(k, s.name)
      if (!first && before && removed.length / before > 0.1) {
        s0.stopped = { at: now, added: 0, vanished: removed.length, of: before }
        s0.lastNote = '멈춤'
        await writeSourceState(dataDir, id, st)
        return { state: 'stopped', ...s0.stopped }
      }
      const clean = (p) => String(p || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').join('/')
      const r = await applyDocs(k, { src: s, prefix: docPrefix(s), files: files.map((f) => ({ rel: clean(f.path), data: Buffer.from(String(f.b64 || ''), 'base64') })).filter((f) => f.rel && wantDoc(f.rel)), removed: removed.map(clean).filter(Boolean) })
      cache.delete(id)
      Object.assign(s0, { checkedAt: now, host: String(host).slice(0, 60), failures: 0, stopped: null, lastNote: r.commit ? `문서 ${r.docs}${r.missing ? ' · 원본에 없다 ' + r.missing : ''}` : '그대로', ...(r.commit ? { lastChange: { at: now, files: files.length + removed.length, docs: r.docs, removed: r.missing, tables: 0 } } : {}) })
      await writeSourceState(dataDir, id, st)
      if (r.commit) {
        for (const u of await hub.curatorsOf(id)) await feed.add(dataDir, u, { kn: id, dot: 'acc', text: `${s.name}에서 문서 ${r.docs}${r.missing ? ' · 원본에 없다 ' + r.missing : ''} — ${meta.name}`, small: `내 PC 폴더${host ? ' · ' + host : ''}` })
        if (backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      }
      return { state: r.commit ? 'changed' : 'same', docs: r.docs, missing: r.missing, rows: r.rows }
    },
    // DB 연결 확인 — 호스트 · 포트에 닿나만(읽기는 다음 판 · S10 계정) · 관리자 · PC 만(아무나 포트를 두드리지 않게)
    async sourceCheckDb(ctx, id, { host, port = 5432, database = null, user = null, schema = 'public', password = null, name = null }) {
      await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '관리자가 한다')
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(String(host || ''))) throw new KmdError('E_INPUT', '호스트가 아니다')
      const t0 = Date.now()
      const reach = await new Promise((ok) => {
        const sock = net.connect({ host: String(host), port: Number(port) || 5432 })
        const done = (v) => { sock.destroy(); ok(v) }
        sock.setTimeout(3000, () => done(false))
        sock.once('connect', () => done(true))
        sock.once('error', () => done(false))
      })
      if (!reach || !database || !user) return { reach, ms: Date.now() - t0 }
      // 팀 화면은 비밀번호를 받지 않는다 — 이미 넣은 비밀(그 이름)이 있으면 그것으로
      if (password && mode !== 'pc' && !ctx.pc) throw new KmdError('E_FORBIDDEN', '비밀번호는 화면으로 받지 않는다 — 서버에서 kmd secret set')
      const pw = password || (name ? await getSecret(dataDir, secretName(id, name)) : null)
      if (!pw) return { reach, ms: Date.now() - t0, login: null }
      try {
        const c = await dbConnect({ host: String(host), port: Number(port) || 5432, database: String(database), user: String(user), password: pw })
        try {
          const acct = await checkAccount(c, String(schema || 'public'))
          const t = await dbCatalog(c, String(schema || 'public'))
          return { reach, ms: Date.now() - t0, login: true, tables: t.size, problems: acct.problems, allowUnsafe: !!config.dbAllowUnsafeAccount }
        } finally { await c.end().catch(() => {}) }
      } catch (e) {
        return { reach, ms: Date.now() - t0, login: false, why: e.message }
      }
    },
    // 한 곳 돌리기 — 같은 곳은 한 줄로 선다(실시간 감시 · 시계 · [지금 확인] · 전체 다시 맞추기가 겹쳐도 차례로)
    async sourceRun(id, name = null, { first = false, force = false, full = false, pass = null, onProgress = null } = {}) {
      const meta = await hub.meta(id)
      const decl = await readDecl(meta.dir)
      const out = []
      for (const s of decl.filter((x) => !name || x.name === name)) {
        // DB 읽기(pg · 읽기 전용 확인)는 S10 계정이 생기면 연다 — 그때까지는 연결 정보만 두고 쉰다(실패로 세지 않는다 · 멈춤 줄 없음)
        if (s.kind === 'pc') {
          out.push({ name: s.name, state: 'waiting', n: 0, why: '내 PC 프로그램이 바뀐 것을 보낸다 — 여기서는 기다린다' })
          continue
        }
        const key = `${id}\n${s.name}`
        const prev = srcRuns.get(key) || Promise.resolve()
        const job = prev.catch(() => {}).then(async () => {
          const k = await hub.get(id)
          const src = { ...s, folder: s.kind === 'folder' || !/^(https?|ssh):\/\//i.test(s.at) ? s.at : undefined }
          const r = await runSource(k, src, { dataDir, first, force, full, pass, onProgress, meaning: hub.meaningOk(id), dbAllowUnsafe: !!config.dbAllowUnsafeAccount, save: (input) => coreSave(meta.dir, input, { user: 'kmd', system: true }) })
          cache.delete(id)
          // 코드가 바뀌어 기록을 남겼다 — 그 지식의 정리를 바로 건다(정리 검사를 그대로 탄다 · 값이 바뀌면 노랑 · 되돌릴 수 있다)
          if (r.codeRecords) hub.tidyNow({ user: 'kmd', admin: true }, id, { by: 'kmd', auto: true }).catch(() => {})
          if (r.state === 'changed') for (const u of await hub.curatorsOf(id)) await feed.add(dataDir, u, { kn: id, dot: 'acc', text: `${s.name}에서 바뀐 표 ${r.n} — ${meta.name}`, small: `바뀐 파일 ${r.files} · 저절로 채우는 표` })
          return r
        })
        srcRuns.set(key, job)
        out.push({ name: s.name, ...(await job) })
        if (srcRuns.get(key) === job) srcRuns.delete(key)
      }
      if (out.some((x) => x.state === 'changed') && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return out
    },
    // 전체 다시 맞추기 — 뒤에서 일감으로 · 진행률 · 끊기면(서버를 다시 켜면) 같은 pass 로 이어서. 쓰는 것은 다른 것뿐
    async sourceResync(ctx, id, name) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '전체 다시 맞추기는 관리자가 한다')
      const s = (await readDecl(meta.dir)).find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져오는 곳이 없다')
      if (s.kind === 'db') throw new KmdError('E_INPUT', 'DB 읽기는 아직 열리지 않았다')
      const key = `${id}\n${name}`
      if (resyncs.get(key)?.state === 'running') return resyncs.get(key)
      const st = await readSourceState(dataDir, id)
      const pass = st[name]?.resync?.pass || Date.now() // 남은 pass 가 있으면 이어서
      const job = { state: 'running', done: 0, total: 0, pass, at: new Date().toISOString() }
      resyncs.set(key, job)
      const mark = async (v) => { const x = await readSourceState(dataDir, id); (x[name] ||= {}).resync = v; await writeSourceState(dataDir, id, x) }
      await mark({ pass, at: job.at })
      hub.sourceRun(id, name, { full: true, pass, onProgress: (d, t) => { job.done = d; job.total = t } })
        .then(async ([r]) => {
          Object.assign(job, { state: r?.state === 'failed' ? 'failed' : 'done', result: r, end: new Date().toISOString() })
          if (r?.state !== 'failed') await mark(undefined)
        })
        .catch((e) => Object.assign(job, { state: 'failed', why: e.message }))
      return job
    },
    // 뜻 갱신을 해도 되는 지식 — 「Claude 에 보내지 않음」 이 아니고(결정 ③) · 이 PC 는 「자동 정리 — Claude 로」 를 켰을 때
    meaningOk(id) {
      if (owners.rowOf(reg, id)?.noClaude) return false
      return mode === 'pc' ? hub.autoOf(pcUser, 'claude') : true
    },
    async sourceMeaning(ctx, id, { name, on }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '관리자가 한다')
      const decl = await readDecl(meta.dir)
      const s = decl.find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져오는 곳이 없다')
      if (s.kind !== 'folder' && s.kind !== 'git') throw new KmdError('E_INPUT', '뜻 갱신은 코드 폴더 · git 만')
      if (!!s.meaning === !!on) return s
      if (on) s.meaning = true
      else delete s.meaning
      await writeDecl(meta.dir, decl, { user: ctx.user, title: `가져오는 곳 뜻 갱신 ${on ? '켬' : '끔'} — ${name}` })
      cache.delete(id)
      // 켜면 지금 코드로 사본 · 장부를 맞춘다(그 뒤 바뀐 것부터 기록)
      if (on) await hub.sourceRun(id, name)
      return s
    },
    // 실시간 감시 — 이 PC(팀이면 서버)의 코드 폴더는 바뀌면 조용해진 뒤(기본 10초) 그곳만 확인한다 · git 은 정한 때마다
    watchSource(id, s) {
      const key = `${id}\n${s.name}`
      srcWatch.get(key)?.close()
      srcWatch.delete(key)
      if ((s.kind !== 'folder' && s.kind !== 'docs') || !s.at) return
      let timer = null
      try {
        const w = fsWatch(s.at, { recursive: true }, (ev, f) => {
          const p = String(f || '').replace(/\\/g, '/')
          if (p.split('/').some((x) => x.startsWith('.') || x === 'node_modules')) return
          clearTimeout(timer)
          timer = setTimeout(() => hub.sourceRun(id, s.name).catch(() => {}), config.watchQuietMs ?? 10_000)
          timer.unref?.()
        })
        w.on('error', () => {})
        srcWatch.set(key, { close: () => { clearTimeout(timer); w.close() } })
      } catch {}
    },
    sourceState: (id) => readSourceState(dataDir, id),
    async sources(ctx, id) {
      const meta = await hub.meta(id, ctx)
      const decl = await readDecl(meta.dir)
      const st = await readSourceState(dataDir, id)
      const have = new Set((await listSecrets(dataDir).catch(() => [])).map((x) => x.name))
      // watch — live(실시간 감시) · poll(정한 때마다) · none · resync — 전체 다시 맞추기(도는 중 · 끝 · 끊김)
      const noClaude = !hub.meaningOk(id)
      return decl.map((s) => ({ ...s, meaningBlocked: noClaude, watch: s.kind === 'pc' ? 'pc' : s.kind === 'folder' || s.kind === 'docs' ? (srcWatch.has(`${id}\n${s.name}`) ? 'live' : 'poll') : s.kind === 'git' ? 'poll' : 'none', resync: resyncs.get(`${id}\n${s.name}`) || (st[s.name]?.resync ? { state: 'paused', ...st[s.name].resync } : null), state: st[s.name] || {}, secret: { name: secretName(id, s.name), has: have.has(secretName(id, s.name)) } }))
    },
    // 자료 가져오기 화면 — 그 사람이 보는 지식들의 가져오는 곳 모두
    async allSources(ctx) {
      const out = []
      for (const m of await hub.visible(ctx)) for (const s of await hub.sources(ctx, m.id)) out.push({ kn: m.id, knName: m.name, ...s })
      return out
    },
    // 언제 — hourly · daily HH:MM · weekly · change(바뀔 때만) · manual
    async sourceEvery(ctx, id, { name, every }) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '언제 바꾸기는 관리자가 한다')
      if (!/^(hourly|weekly|change|manual|daily ([01]\d|2[0-3]):[0-5]\d)$/.test(String(every))) throw new KmdError('E_INPUT', '언제는 hourly · daily HH:MM · weekly · change')
      const decl = await readDecl(meta.dir)
      const s = decl.find((x) => x.name === name)
      if (!s) throw new KmdError('E_NOTFOUND', '그 가져오는 곳이 없다')
      if (s.every === every) return s
      s.every = every
      await writeDecl(meta.dir, decl, { user: ctx.user, title: `가져오는 곳 언제 — ${name} · ${every}` })
      cache.delete(id)
      return s
    },
    async curatorsOf(id) {
      const r = owners.rowOf(reg, id)
      return [...new Set([r?.owner, ...(r?.curators || [])].filter(Boolean))]
    },
    // 관리자에게 부탁 — 관리 화면 · 관리자의 오늘 바뀐 것에
    async sourceRequest(ctx, id, card) {
      await hub.meta(id, ctx)
      const f = path.join(dataDir, 'requests.json')
      const all = await fs.readFile(f, 'utf8').then(JSON.parse, () => [])
      const req = { id: crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), by: ctx.user, kn: id, name: String(card.name || '').slice(0, 60), at2: maskUrl(String(card.at || '')), kind: card.kind || null, rules: card.rules || [], every: card.every || 'hourly', ...(card.db ? { db: { engine: 'postgres', host: String(card.db.host || '').slice(0, 253), port: Number(card.db.port) || 5432, database: String(card.db.database || '').slice(0, 63), schema: String(card.db.schema || 'public').slice(0, 63), user: String(card.db.user || '').slice(0, 63) } } : {}) }
      all.unshift(req)
      await fs.writeFile(f, JSON.stringify(all.slice(0, 100)))
      return req
    },
    requests: async () => fs.readFile(path.join(dataDir, 'requests.json'), 'utf8').then(JSON.parse, () => []),
    // 바깥 생성기 — 기계 열쇠로 그 원천의 표만(이름의 종류도 열쇠의 것과 대조)
    async baseline(ctx, id, { source, items = [], asof = null, host = '', files = 0 }) {
      const meta = await hub.meta(id)
      if (!ctx.machine || ctx.machine.kn !== id) throw new KmdError('E_FORBIDDEN', '기계 열쇠로만 쓴다', { need: 'machine' })
      if (String(source) !== ctx.machine.source) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 원천의 것이다')
      const k = await hub.get(id)
      const types = ctx.machine.types || []
      const targets = []
      for (const it of Array.isArray(items) ? items : []) {
        if (!Array.isArray(it.cols) || !Array.isArray(it.rows)) throw new KmdError('E_INPUT', '항목마다 cols · rows')
        let doc = it.doc
        let heading = it.heading
        if (it.coord) {
          if (types.length && !types.includes(String(it.coord).split(':')[0])) throw new KmdError('E_FORBIDDEN', `이 열쇠는 ${types.join(' · ')} 종류만 쓴다`)
          const x = sectionOf(k, it.coord)
          if (!x?.loc) throw new KmdError('E_NOTFOUND', `「${it.coord}」 이 들어갈 문서가 정해져 있지 않다`)
          doc = x.loc.doc
          heading = x.sec ? x.sec.h : x.loc.heading
        }
        if (!doc || !heading) throw new KmdError('E_INPUT', '항목마다 coord 또는 doc · heading')
        targets.push({ doc: String(doc).replace(/^docs\/|\.md$/g, ''), heading, cols: it.cols.map(String), rows: it.rows.map((r) => r.map((c) => String(c ?? ''))) })
      }
      const srcDecl = { name: source, rules: [{ rule: 'outside', into: { doc: targets[0]?.doc || '' } }] }
      const plan = await planRun(k, srcDecl, { outside: targets.map((t) => ({ key: t.heading, cols: t.cols, rows: t.rows, doc: t.doc })) }, { asof: asof || new Date().toISOString().slice(0, 16).replace('T', ' ') })
      // 줄의 상태(내 PC 폴더 · 바깥 생성기) — 받은 때 · 마지막 변화
      const mark = async (n) => {
        const st = await readSourceState(dataDir, id)
        const s0 = (st[source] ||= {})
        const now = new Date().toISOString()
        Object.assign(s0, { checkedAt: now, host: String(host || '').slice(0, 60), failures: 0, lastNote: n ? `바뀐 표 ${n}` : '그대로', ...(n ? { lastChange: { at: now, files: files || 0, tables: n } } : {}) })
        await writeSourceState(dataDir, id, st)
      }
      if (!plan.changed.length) { await mark(0); return { changed: 0 } }
      await mark(plan.changed.length)
      await coreSave(meta.dir, { record: { title: `가져옴 — ${source} · 바뀐 표 ${plan.changed.length}`, body: plan.changed.map((c) => `- ${c.doc} › ${c.heading}`).join('\n'), tags: ['sources'] }, sections: plan.changed.map((c) => ({ doc: c.doc, heading: c.heading, content: c.content, applied: c.applied })) }, { user: 'kmd-auto', system: true })
      cache.delete(id)
      return { changed: plan.changed.length }
    },

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
        // 원본이 주인인 문서에는 정리도 넣지 않는다 — 기록은 문서 옆에 그대로 읽힌다
        if (g.doc && watchedOf(await fs.readFile(path.join(meta.dir, ...g.doc.split('/')), 'utf8').catch(() => ''))) {
          rows.push({ kind: 'left', target, why: '원본이 주인인 문서 — 원본 파일을 고친다 · 기록은 옆에 그대로 읽힌다', records: (g.records || [g.record]).map((x) => x.id) })
          continue
        }
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

    // ── 파일 · 폴더 넣기(KM82 — 한 번 들여온다) ──
    async importFiles(ctx, id, files) {
      const meta = await hub.meta(id, ctx)
      const shut = backup.closed(meta)
      if (shut) throw new KmdError('E_BEHIND', shut.message)
      const k = await hub.get(id)
      const direct = hub.canDirect(ctx, id)
      const plan = await planImport(k, files, { direct, convert: hub.autoOf(ctx.user, 'file'), read: (rel) => fs.readFile(path.join(meta.dir, rel)).catch(() => null) })
      if (plan.docs.length || plan.atts.length) {
        await serial(path.resolve(meta.dir), async () => {
          await ensureRepo(meta.dir)
          const paths = []
          for (const x of [...plan.docs.map((d) => ({ rel: d.rel, data: Buffer.from(d.text, 'utf8') })), ...plan.atts]) {
            const full = path.join(meta.dir, x.rel)
            if (!path.resolve(full).startsWith(path.resolve(meta.dir) + path.sep) || owners.isReservedFile(x.rel)) continue
            await fs.mkdir(path.dirname(full), { recursive: true })
            await fs.writeFile(full, x.data)
            paths.push(x.rel)
          }
          if (paths.length) await commitPaths(meta.dir, paths, `파일 넣기 — ${ctx.user} · ${paths.length}`, ctx.user)
        })
        cache.delete(id)
      }
      for (const r of plan.records) await hub.save(ctx, id, { record: r })
      const s = summary(plan.rows)
      if (s.doc || s.record) feed.add(dataDir, ctx.user, { kn: id, dot: 'acc', text: `파일 ${s.doc + s.record}개를 ${s.doc ? '문서로' : '기록으로'} — ${meta.name}`, small: s.fail ? `바꾸지 못한 파일 ${s.fail}` : s.doc ? '원본은 첨부로 두었다' : '다음 정리 때 문서에' }).catch(() => {})
      if ((plan.docs.length || plan.atts.length) && backup.attached(meta)) backup.enqueue(meta, { log }).catch(() => {})
      return { direct, summary: s, rows: plan.rows }
    },

    // ── 보내기(M10) — 보낼 곳 · 보낼 것 · 보내기 · 받기 ──
    async sendDests(ctx, id, dests) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '보낼 곳은 주인이 정한다')
      if (!Array.isArray(dests)) throw new KmdError('E_INPUT', '보낼 곳은 목록이다')
      dests.forEach(sendLib.checkDest)
      const conf = await sendLib.readConf(meta.dir)
      await serial(path.resolve(meta.dir), async () => {
        await ensureRepo(meta.dir)
        await fs.writeFile(path.join(meta.dir, sendLib.CONF), JSON.stringify({ ...conf, send: dests.map((d) => ({ kn: d.kn, ...(d.url ? { url: String(d.url).replace(/\/+$/, '') } : {}) })) }, null, 2) + '\n')
        await commitPaths(meta.dir, [sendLib.CONF], `보낼 곳 — ${dests.map((d) => d.kn).join(' · ') || '없음'}`, ctx.user).catch(() => {})
      })
      // 처음 정하면 지금 글을 보낸 것으로 — 그 뒤 고친 것만 모인다
      const st = await sendLib.readState(dataDir, id)
      if (!Object.keys(st.sent).length) await sendLib.writeState(dataDir, id, { ...st, sent: sendLib.baseline(await hub.get(id)) })
      return sendLib.destsOf(meta.dir)
    },
    async sendQueue(ctx, id) {
      const meta = await hub.meta(id, ctx)
      const dests = await sendLib.destsOf(meta.dir)
      const st = await sendLib.readState(dataDir, id)
      const items = dests.length ? sendLib.queue(await hub.get(id), st) : []
      return { dests, items, wait: st.wait.map((w) => ({ to: w.to.kn, n: w.payload.items.length, at: w.at, why: w.why })), log: st.log }
    },
    async sendDrop(ctx, id, { path: p, on }) {
      await hub.meta(id, ctx)
      const st = await sendLib.readState(dataDir, id)
      const q = sendLib.queue(await hub.get(id), st).find((x) => x.path === p)
      if (!q) throw new KmdError('E_NOTFOUND', '보낼 것에 없다')
      if (on) delete st.dropped[p]
      else st.dropped[p] = q.sha
      await sendLib.writeState(dataDir, id, st)
      return { ok: true }
    },
    async send(ctx, id, { extra = [] } = {}) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '내 지식에서만 보낸다')
      const dests = await sendLib.destsOf(meta.dir)
      if (!dests.length) throw new KmdError('E_INPUT', '보낼 곳이 없다 — 지식 설정에서 정한다')
      const k = await hub.get(id)
      const st = await sendLib.readState(dataDir, id)
      const qs = sendLib.queue(k, st).filter((q) => q.on)
      const items = [...qs.map((q) => sendLib.itemOf(k, q)), ...(Array.isArray(extra) ? extra : []).map((x) => ({ title: String(x.title || '').slice(0, 200), body: String(x.body || ''), sha: sha16(`${id}\n${x.title}\n${x.body}`) }))]
      if (!items.length) return { sent: 0, wait: 0 }
      const payload = { from: meta.name, items }
      let sent = 0
      let wait = 0
      for (const d of dests) {
        try {
          await deliver(ctx, d, payload)
          sent += items.length
        } catch (e) {
          st.wait.push({ to: d, payload, at: new Date().toISOString(), why: e.message.slice(0, 120) })
          wait += items.length
        }
      }
      for (const q of qs) {
        st.sent[q.path] = sendLib.marks(k.byDocPath.get(q.path))
        delete st.dropped[q.path]
      }
      st.log.unshift({ at: new Date().toISOString(), n: items.length, to: dests.map((d) => d.kn), wait: !!wait })
      await sendLib.writeState(dataDir, id, st)
      if (sent) feed.add(dataDir, ctx.user, { kn: id, dot: 'acc', text: `${items.length}개를 보냈다 — ${dests.map((d) => d.kn).join(' · ')}`, small: '정리 때 문서에 들어간다' }).catch(() => {})
      return { sent, wait }
    },
    // 닿지 않아 둔 것 — 닿을 때 저절로(분마다)
    async sendRetry() {
      let n = 0
      for (const m of await hub.list().catch(() => [])) {
        const st = await sendLib.readState(dataDir, m.id)
        if (!st.wait.length) continue
        const left = []
        for (const w of st.wait) {
          try {
            await deliver({ user: pcUser || 'kmd', pc: mode === 'pc' }, w.to, w.payload)
            n += w.payload.items.length
            st.log.unshift({ at: new Date().toISOString(), n: w.payload.items.length, to: [w.to.kn], late: w.at })
          } catch (e) {
            left.push({ ...w, why: e.message.slice(0, 120) })
          }
        }
        st.wait = left
        await sendLib.writeState(dataDir, m.id, st)
      }
      return n
    },
    // 받기 — 기록 하나씩(같은 지문이면 0) · 이름은 이 지식의 장부에 정확히 맞는 것만
    async receive(ctx, id, { from = '', items = [] } = {}) {
      await hub.meta(id, ctx)
      if (!Array.isArray(items) || !items.length || items.length > 200) throw new KmdError('E_INPUT', '받을 것은 1 ~ 200 개')
      let saved = 0
      let same = 0
      for (const it of items) {
        const k = await hub.get(id)
        const sha = /^[0-9a-f]{16}$/.test(String(it.sha)) ? it.sha : sha16(`${it.title}\n${it.body}`)
        const tag = `sent/${sha}`
        if (k.works.some((w) => w.tags.includes(tag))) {
          same++
          continue
        }
        const heads = [...String(it.body || '').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
        const words = [...heads, ...String(it.title || '').split(/\s+—\s+/)]
        const touches = [...new Set(words.flatMap((w) => exact(k, w).map((x) => x.coord)).filter(Boolean))]
        await hub.save(ctx, id, { record: { title: String(it.title || '보낸 것').slice(0, 200), body: `${String(from).slice(0, 80)}에서 보냄\n\n${String(it.body || '')}`.trim(), touches, tags: [tag] } })
        saved++
      }
      return { saved, same }
    },
    // 받은편지함 정리 — 같은 주인의 개인 지식으로만 옮긴다 · 팀 지식에 이름이 걸리면 보내기 후보 · private 은 그대로
    async inboxTidy(ctx, id, { dry = false } = {}) {
      const meta = await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '받은편지함은 주인이 정리한다')
      const owner = owners.rowOf(reg, id)?.owner || ctx.user
      const k = await hub.get(id)
      const f = path.join(dataDir, 'inbox', `${encodeURIComponent(id)}.json`)
      const st = await fs.readFile(f, 'utf8').then(JSON.parse, () => ({ moved: {} }))
      const others = (await hub.visible(ctx)).filter((m) => m.id !== id)
      const mine = others.filter((m) => mode === 'pc' || (owners.rowOf(reg, m.id)?.owner === owner && owners.rowOf(reg, m.id)?.private))
      const team = others.filter((m) => !mine.includes(m))
      const moved = []
      const candidates = []
      for (const w of k.works) {
        if (isSystemRecord(w) || w.tags.includes('private') || st.moved[w.id]) continue
        const words = [...w.touches.map((c) => labelOf(k, c)), ...w.title.split(/\s+—\s+/)].filter(Boolean)
        const hit = async (ms) => {
          for (const m of ms) {
            const k2 = await hub.get(m.id)
            const coords = [...new Set(words.flatMap((x) => exact(k2, x).map((y) => y.coord)).filter(Boolean))]
            if (coords.length) return { m, coords }
          }
          return null
        }
        const to = await hit(mine)
        if (to && dry) {
          moved.push({ record: w.id, title: w.title, to: to.m.id })
          continue
        }
        if (to) {
          await hub.save(ctx, to.m.id, { record: { title: w.title, body: `받은편지함에서 옮김\n\n${w.body}`.trim(), touches: to.coords, tags: w.tags.filter((t) => !t.startsWith('sent/')) } })
          st.moved[w.id] = to.m.id
          moved.push({ record: w.id, title: w.title, to: to.m.id })
          continue
        }
        const t2 = await hit(team)
        if (t2) candidates.push({ record: w.id, title: w.title, to: t2.m.id, name: labelOf(await hub.get(t2.m.id), t2.coords[0]) })
      }
      if (dry) return { moved, candidates }
      await fs.mkdir(path.dirname(f), { recursive: true })
      await fs.writeFile(f, JSON.stringify(st))
      if (moved.length) feed.add(dataDir, ctx.user, { kn: id, dot: 'acc', text: `받은편지함 메모 ${moved.length}개를 옮겼다`, small: [...new Set(moved.map((x) => x.to))].join(' · ') }).catch(() => {})
      return { moved, candidates, left: k.works.filter((w) => !isSystemRecord(w) && !st.moved[w.id]).length - candidates.length }
    },
    // 받은편지함 메모 하나를 팀 지식으로(보내기 화면의 「보낼 것에 넣기」) — 같은 kmd 의 받기 길 · 다시 옮기지 않게 표시
    async inboxSend(ctx, id, { record, to }) {
      await hub.meta(id, ctx)
      if (!hub.canDirect(ctx, id)) throw new KmdError('E_FORBIDDEN', '받은편지함은 주인이 보낸다')
      const w = (await hub.get(id)).byWork.get(record)
      if (!w || w.tags.includes('private')) throw new KmdError('E_NOTFOUND', '보낼 메모가 없다')
      const r = await hub.receive(ctx, to, { from: '받은편지함', items: [{ title: w.title, body: w.body, sha: sha16(`${id}\n${w.id}`) }] })
      const f = path.join(dataDir, 'inbox', `${encodeURIComponent(id)}.json`)
      const st = await fs.readFile(f, 'utf8').then(JSON.parse, () => ({ moved: {} }))
      st.moved[w.id] = to
      await fs.mkdir(path.dirname(f), { recursive: true })
      await fs.writeFile(f, JSON.stringify(st))
      return r
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
      if (mode === 'pc' && !id) {
        const pst = await readPushState(dataDir).catch(() => ({}))
        for (const p of await listPushes(dataDir).catch(() => [])) {
          const x = pst[p.id]
          if (x && x.failures >= 2 && Date.now() - Date.parse(x.failingSince) > 10 * 60_000) out.push(stopLine({ kind: 'push', level: 'warn', what: `${p.name} 을 팀에 못 보냈다`, amount: ageText(Date.now() - Date.parse(x.failingSince)), fix: '닿으면 바뀐 것을 이어서 보낸다', told: x.lastNote }))
        }
      }
      for (const k of ks) {
        out.push(...backup.lines(k, { name: k.name }))
        const sw = (await sendLib.readState(dataDir, k.id)).wait
        if (sw.length) out.push(stopLine({ kind: 'send', kn: k.id, level: 'warn', what: `${k.name} — 보낼 곳에 닿지 않는다`, amount: `${sw.reduce((a, w) => a + w.payload.items.length, 0)}개`, fix: '닿으면 저절로 보낸다', since: `${sw[0].at.slice(5, 10)} ${new Date(sw[0].at).toTimeString().slice(0, 5)} 에 누른 것` }))
        const decl = await readDecl(k.dir)
        if (decl.length) out.push(...sourceLines(k, decl, await readSourceState(dataDir, k.id), { admin: !!ctx.admin || mode === 'pc' }))
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
    // 이 백업 이어 쓰기 — 갈라졌을 때 백업 쪽이 맞다고 사람이 정한다(지금 머리는 가지로 남긴다)
    async backupAdopt(ctx, id) {
      if (!ctx.admin && !ctx.shell) throw new KmdError('E_FORBIDDEN', '백업 이어 쓰기는 관리자가 한다')
      const meta = await hub.meta(id, ctx)
      const r = await backup.adopt(meta, { check })
      cache.delete(id)
      return r
    },
    // 되살리기 — 백업 자리에서 새 폴더로(지식 받아 오기 · 새 PC 의 [이 PC 로 되살리기]) · 받은 곳을 그대로 백업 자리로 붙인다
    async restore(ctx, { url, name }) {
      if (!ctx.admin && !ctx.shell && mode !== 'pc') throw new KmdError('E_FORBIDDEN', '되살리기는 관리자가 한다')
      if (await looksLikeKnowledge(root)) throw new KmdError('E_INPUT', '이 kmd 는 지식 하나만 연다')
      const t = checkUrl(url, { roots: config.backupRoots || [], pc: mode === 'pc' })
      const nm = String(name || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || path.basename(t.url).replace(/\.git$/i, '')
      if (!nm || nm.startsWith('.')) throw new KmdError('E_INPUT', '이름을 정한다')
      if ((await hub.list()).some((k) => k.id.toLowerCase() === nm.toLowerCase())) throw new KmdError('E_CONFLICT', `「${nm}」 지식이 이미 있다`)
      const dir = path.join(root, nm)
      const r = await restoreFrom({ url: t.url, dir, check, local: t.local })
      list = null
      const meta = await hub.meta(nm)
      await backup.attach(meta, t.url, { dataDir }).catch((e) => log('되살린 지식 백업 붙이기', nm, e.message))
      const owner = await hub.adoptRestored(nm)
      feed.add(dataDir, ctx.user || 'kmd', { kn: nm, dot: 'acc', text: `되살렸다 — ${meta.name}`, small: `문서 ${r.docs} · 기록 ${r.records} · 첨부 ${r.atts}${r.errors.length ? ' · 검사 줄 ' + r.errors.length : ''}` }).catch(() => {})
      return { id: nm, ...r, owner: owner?.owner || null }
    },
    // GitLab 봇 — 백업 자리가 없는 팀 지식에 저장소를 찾거나 만들어 붙인다(안 되면 지금처럼 · 멈춤 줄이 남는다)
    async gitlabAttach(id) {
      const g = config.gitlab
      if (!g || mode !== 'team') return null
      const meta = await hub.meta(id)
      if (backup.attached(meta)) return null
      const token = await getSecret(dataDir, g.secret || 'gitlab')
      if (!token) return null
      const p = await ensureProject({ api: g.api, group: g.group, token, name: meta.id })
      await ensureRepo(meta.dir) // 아직 git 이 없는 지식이면 있던 글을 첫 묶음으로
      await backup.attach(meta, p.url, { dataDir })
      log(`${meta.name} — GitLab 백업 자리를 ${p.created ? '만들어' : '찾아'} 붙였다`)
      return p
    },
    backupStateSync: (meta) => backup.stateOf(meta),
    async backupState(ctx, id) {
      return backup.stateOf(await hub.meta(id, ctx))
    },
    async start() {
      started = true
      await backup.start(await hub.list(), { dataDir, log })
      // GitLab 봇 — 백업 자리가 없는 지식마다(켤 때 한 번 · 지식 추가 때)
      if (config.gitlab) setTimeout(async () => { for (const m of await hub.list().catch(() => [])) await hub.gitlabAttach(m.id).catch((e) => log('GitLab 백업 자리', m.id, e.message)) }, 500).unref?.()
      // 거두기 — PC(또는 serve.json collect)에서 편집기로 고친 문서를 30초 고요 뒤 들인다
      if (mode === 'pc' || config.collect) for (const m of await hub.list()) watchers.push(Object.assign(collect.watch(m.dir, () => hub.collect(m.id)), { dir: m.dir }))
      // 가져오는 곳 — 할 일 시계(분마다 본다 · 각자의 every) · 켤 때 한 번
      const dueSources = async (all) => {
        for (const m of await hub.list().catch(() => [])) {
          const decl = await readDecl(m.dir)
          if (!decl.length) continue
          const st = await readSourceState(dataDir, m.id)
          for (const s of decl) {
            const c = st[s.name]?.checkedAt
            const daily = String(s.every || '').startsWith('daily ') && String(s.every).slice(6)
            const hm = new Date().toTimeString().slice(0, 5)
            const due = all || !c || (daily ? hm >= daily && new Date(c).toDateString() !== new Date().toDateString() : Date.now() - Date.parse(c) >= everyMs(s.every))
            if (adding.has(`${m.id}\n${s.name}`)) continue // 막 더하는 중 — 더하기의 첫 확인이 한다
            if (due && s.every !== 'manual' && (mode !== 'pc' || hub.autoOf(pcUser, 'src'))) await hub.sourceRun(m.id, s.name).catch(() => {})
          }
        }
      }
      sourceTimer = setInterval(() => dueSources(false), config.sourceTickMs || 60_000)
      setTimeout(async () => {
        for (const m of await hub.list().catch(() => [])) {
          const decl = await readDecl(m.dir).catch(() => [])
          const st = await readSourceState(dataDir, m.id).catch(() => ({}))
          for (const s of decl) {
            hub.watchSource(m.id, s)
            if (st[s.name]?.resync) hub.sourceResync({ ...SHELL }, m.id, s.name).catch(() => {})
          }
        }
        // 팀으로 보내는 폴더(이 PC) — 실시간 감시 · 켤 때 한 번 · 5분마다 다시(닿지 않았던 것 · 놓친 신호)
        if (mode === 'pc') {
          for (const p of await listPushes(dataDir).catch(() => [])) { hub.watchPush(p); hub.pushRun(p.id).catch(() => {}) }
          pushTimer = setInterval(async () => { for (const p of await listPushes(dataDir).catch(() => [])) await hub.pushRun(p.id).catch(() => {}) }, config.pushTickMs || 300_000)
          pushTimer.unref?.()
        }
      }, 1000).unref?.()
      sourceTimer.unref?.()
      setTimeout(() => dueSources(true), 3000).unref?.()
      // 정해진 시간의 정리 — 분마다 본다 · 지식마다 하루 한 번 · 넣을 것이 있을 때만
      tidyTimer = setInterval(async () => {
        const d = new Date()
        const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        const day = d.toISOString().slice(0, 10)
        for (const m of await hub.list().catch(() => [])) {
          if (hm < hub.tidyAtOf(m.id) || lastTidy.get(m.id) === day) continue
          lastTidy.set(m.id, day)
          // 받은편지함 — 정리 시각에 같은 주인의 개인 지식으로 옮긴다
          if (m.name === '받은편지함') await hub.inboxTidy({ user: owners.rowOf(reg, m.id)?.owner || pcUser || 'kmd', pc: mode === 'pc' }, m.id).catch(() => {})
          const k = await hub.get(m.id).catch(() => null)
          if (k && (mode !== 'pc' || hub.autoOf(pcUser, 'claude')) && k.works.some((w) => w.state === 'pend' || w.state === 'nowhere')) hub.tidyNow({ user: 'kmd', admin: true }, m.id, { by: 'kmd', auto: true }).catch(() => {})
        }
      }, config.tidyTickMs || 60_000)
      tidyTimer.unref?.()
      // 보내기 — 닿지 않아 둔 것을 분마다 다시
      sendTimer = setInterval(() => hub.sendRetry().catch(() => {}), config.sendTickMs || 60_000)
      sendTimer.unref?.()
      // 찾기 색인 — 뒤에서 미리(지금 찾는 지식은 기다리지 않고 그때 짓는다)
      setTimeout(async () => {
        for (const m of await hub.list().catch(() => [])) await hub.index(m.id).catch(() => {})
      }, 200).unref?.()
    },
    async collect(id) {
      const meta = await hub.meta(id)
      if (!hub.autoOf(pcUser, 'save')) return null // 설정에서 「편집기에서 고친 것 저장」 을 껐다
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
      clearInterval(sourceTimer)
      clearInterval(sendTimer)
      clearInterval(pushTimer)
      for (const w of srcWatch.values()) w.close()
      srcWatch.clear()
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
