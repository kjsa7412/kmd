// kmd 의 가운데 — 지식 읽기 · 저장 · 백업 · 멈춤 줄. 화면(HTTP)과 세션(MCP)이 같은 길을 쓴다.
//
// 저장은 여기 한 곳으로만 간다 — 읽기만으로 닫힌 지식(백업 behind · moved)을 막고, 저장 뒤 그 지식만
// 잊고(다음 요청이 다시 읽는다), 백업 줄에 넣고, 멈춤 줄을 warnings 로 돌려준다.

import path from 'node:path'
import { listKnowledge, loadKnowledge } from '../core/knowledge.js'
import { KmdError } from '../core/errors.js'
import { save as coreSave } from '../core/save.js'
import { check } from '../core/check.js'
import * as backup from '../core/backup.js'

export async function makeHub({ root, dataDir, mode = 'team', log = (...a) => console.log('[kmd]', ...a) }) {
  const cache = new Map()
  let list = null
  const hub = {
    root,
    dataDir,
    mode,
    log,
    async list() {
      return (list ||= await listKnowledge(root))
    },
    async meta(id) {
      const m = (await hub.list()).find((k) => k.id === id)
      if (!m) throw new KmdError('E_NOTFOUND', `지식 「${id}」 이 없다`)
      return m
    },
    async get(id) {
      const meta = await hub.meta(id)
      if (!cache.has(id)) cache.set(id, loadKnowledge(meta).catch((e) => { cache.delete(id); throw e }))
      return cache.get(id)
    },
    async all() {
      return Promise.all((await hub.list()).map((k) => hub.get(k.id)))
    },
    forget(id) {
      if (id) cache.delete(id)
      else cache.clear()
      list = null
    },

    // 저장 하나 — ctx.user 가 쓴다
    async save(ctx, id, input) {
      const meta = await hub.meta(id)
      const shut = backup.closed(meta)
      if (shut) throw new KmdError('E_BEHIND', shut.message)
      const r = await coreSave(meta.dir, input, { user: ctx.user })
      hub.forget(id)
      // 백업은 기다리되 길게는 아니다 — 늦으면 다음 판정이 줄을 낸다
      if (backup.attached(meta)) await Promise.race([backup.enqueue(meta, { log }), new Promise((ok) => setTimeout(ok, 3000).unref?.())])
      return { ...r, warnings: backup.lines(meta, { name: meta.name }).map((l) => l.text) }
    },

    // 멈춤 줄 — 모든 지식(또는 하나)
    async stops(id = null) {
      const ks = id ? [await hub.meta(id)] : await hub.list()
      return ks.flatMap((k) => backup.lines(k, { name: k.name }))
    },

    // 백업 — 붙이기 · 받기 · 상태
    async backupAttach(id, url) {
      const meta = await hub.meta(id)
      const r = await backup.attach(meta, url, { dataDir })
      return { ...r, backup: backup.stateOf(meta) }
    },
    async backupPull(id) {
      const meta = await hub.meta(id)
      const r = await backup.pull(meta, { check })
      hub.forget(id)
      return r
    },
    async backupState(id) {
      return backup.stateOf(await hub.meta(id))
    },
    async start() {
      await backup.start(await hub.list(), { dataDir, log })
    },
    stop() {
      backup.stop()
    },
  }
  return hub
}

export const defaultDataDir = (root) => path.join(root, '.kmd')
