// E7 필수 — 파일 넣기 · 보내기 · 받기 · 받은편지함 정리.
//
// docx → 문서 1 · 같은 파일 → 커밋 0 · 스캔 pdf → 「바꾸지 못한 파일 1」 · 상한 넘는 docx → 거절 · 고친 문서 → 보낼 것 1 →
// 보내면 받는 지식에 기록 1(같은 것 다시 → 0) · 닿지 않으면 둠 + 멈춤 줄 · `private` 메모 → 옮김 0.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { post } from '../core/send.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const KIM = { user: 'kim', admin: true }
const G = (dir, ...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const count = (dir) => Number(G(dir, 'rev-list', '--count', 'HEAD'))

// 작은 zip 쓰기 — 시험용(store · deflate)
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b) => {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function zip(entries) {
  const locals = []
  const centrals = []
  let off = 0
  for (const e of entries) {
    const raw = Buffer.from(e.data)
    const data = e.deflate ? zlib.deflateRawSync(raw) : raw
    const name = Buffer.from(e.name)
    const head = (sig, central) => {
      const h = Buffer.alloc(central ? 46 : 30)
      h.writeUInt32LE(sig, 0)
      let p = central ? 6 : 4
      if (central) h.writeUInt16LE(20, 4)
      h.writeUInt16LE(20, p)
      h.writeUInt16LE(0x800, p + 2)
      h.writeUInt16LE(e.deflate ? 8 : 0, p + 4)
      h.writeUInt32LE(crc32(raw), p + 10)
      h.writeUInt32LE(data.length, p + 14)
      h.writeUInt32LE(raw.length, p + 18)
      h.writeUInt16LE(name.length, p + 22)
      if (central) h.writeUInt32LE(off, 42)
      return h
    }
    const l = Buffer.concat([head(0x04034b50, false), name, data])
    centrals.push(Buffer.concat([head(0x02014b50, true), name]))
    locals.push(l)
    off += l.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}
const docx = (paras) => zip([{ name: 'word/document.xml', deflate: true, data: `<?xml version="1.0"?><w:document><w:body>${paras.map(([st, t]) => `<w:p>${st ? `<w:pPr><w:pStyle w:val="${st}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` }])
const b64 = (b) => Buffer.from(b).toString('base64')

function mkKnowledge(dir, vocab) {
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true })
  fs.writeFileSync(path.join(dir, '_vocab.md'), `# 이름 장부\n\n${vocab}\n`)
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e7-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  mkKnowledge(path.join(tmp, 'kn', 'inbox'), '')
  mkKnowledge(path.join(tmp, 'kn', 'memo'), '## term\n\n- `term:주간 회의` — 주간 회의')
  mkKnowledge(path.join(tmp, 'kn', 'note'), '')
  fs.writeFileSync(path.join(tmp, 'kn', 'note', 'docs', '배포메모.md'), '# 배포메모\n\n## 카나리\n첫 30분은 요청의 10%.\n')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sendTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  for (const id of ['inbox', 'memo', 'note']) await s.hub.setOwner(SHELL, id, { owner: 'kim', private: true })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('파일 넣기 — docx → 문서 1 · 같은 파일 → 커밋 0 · 스캔 pdf → 바꾸지 못한 파일 1 · 상한 넘는 docx → 거절', async () => {
  const dir = path.join(tmp, 'kn', 'dpms')
  const file = docx([['Heading1', '목적'], ['', '회의에서 정한 것을 남긴다.'], ['Heading1', '정한 것'], ['', '배포 창은 화 · 목.']])
  const r = await s.hub.importFiles(KIM, 'dpms', [{ path: '회의/회의록-1021.docx', data: file }])
  assert.equal(r.summary.doc, 1)
  const md = fs.readFileSync(path.join(dir, 'docs', '회의', '회의록-1021.md'), 'utf8')
  assert.match(md, /^# 회의록-1021\n\n## 목적\n\n회의에서 정한 것을 남긴다\./)
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'assets', '회의', '회의록-1021.docx')), '원본은 첨부')
  assert.ok((await s.hub.get('dpms')).docs.some((d) => d.id === '회의/회의록-1021'))

  const n0 = count(dir)
  const again = await s.hub.importFiles(KIM, 'dpms', [{ path: '회의/회의록-1021.docx', data: file }])
  assert.equal(again.summary.same, 1)
  assert.equal(count(dir), n0, '같은 파일 → 커밋 0')

  const pdf = await s.hub.importFiles(KIM, 'dpms', [{ path: '스캔.pdf', data: Buffer.from('%PDF-1.4 scan') }, { path: 'a.exe', data: Buffer.from('MZ') }])
  assert.equal(pdf.summary.fail, 1, '바꾸지 못한 파일 1')
  assert.equal(pdf.summary.skip, 1, '넣지 않은 파일 1')

  const bomb = zip([{ name: 'word/document.xml', deflate: true, data: Buffer.alloc(40 << 20, 32) }])
  const big = await s.hub.importFiles(KIM, 'dpms', [{ path: '폭탄.docx', data: bomb }])
  assert.equal(big.summary.doc, 0)
  assert.match(big.rows[0].msg, /너무 크다/)
  assert.ok(!fs.existsSync(path.join(dir, 'docs', '폭탄.md')))
  await assert.rejects(s.hub.importFiles(KIM, 'dpms', Array.from({ length: 301 }, (_, i) => ({ path: `${i}.md`, data: Buffer.from('# x') }))), { code: 'E_INPUT' })

  // 팀 지식에서 바로 넣지 못하는 사람은 기록으로(HTTP 길 — 글자로 보낸다)
  const lee = await signIn(s, { id: 'lee', admin: false })
  const h = await fetch(`${s.url}/api/k/dpms/import`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${lee.key}` }, body: JSON.stringify({ files: [{ path: '메모.md', b64: b64('# 메모\n\n## 연락 순서\n당번 → 박.\n') }] }) }).then((x) => x.json())
  assert.equal(h.summary.record, 1)
  assert.ok(!fs.existsSync(path.join(dir, 'docs', '메모.md')))
})

test('보내기 — 고친 문서 → 보낼 것 1 → 받는 지식에 기록 1 · 같은 것 다시 → 0 · 닿지 않으면 둠', async () => {
  await s.hub.sendDests(KIM, 'note', [{ kn: 'dpms' }])
  assert.equal((await s.hub.sendQueue(KIM, 'note')).items.length, 0, '정한 때의 글은 보낸 것')
  await s.hub.edit(KIM, 'note', { doc: '배포메모', sections: [{ h: '카나리', body: '첫 30분은 요청의 20%.' }] })
  const q = await s.hub.sendQueue(KIM, 'note')
  assert.equal(q.items.length, 1)
  assert.deepEqual(q.items[0].heads, ['카나리'])

  const r = await s.hub.send(KIM, 'note')
  assert.deepEqual(r, { sent: 1, wait: 0 })
  const got = (await s.hub.get('dpms')).works.filter((w) => w.tags.some((t) => t.startsWith('sent/')))
  assert.equal(got.length, 1)
  assert.deepEqual(got[0].touches, ['proc:카나리'])
  assert.match(got[0].body, /20%/)
  assert.equal((await s.hub.sendQueue(KIM, 'note')).items.length, 0)

  // 같은 것을 다시 받으면 0 — 기기 열쇠 HTTP 길로
  const kim = await signIn(s, { id: 'kim2', admin: true })
  const sha = got[0].tags.find((t) => t.startsWith('sent/')).slice(5)
  const again = await post(s.url, 'dpms', { from: 'note', items: [{ title: got[0].title, body: '다시', sha }] }, kim.key)
  assert.deepEqual(again, { saved: 0, same: 1 })

  // 닿지 않는 kmd — 두었다가 멈춤 줄
  await s.hub.sendDests(KIM, 'note', [{ kn: 'dpms', url: 'http://127.0.0.1:9' }])
  await s.hub.edit(KIM, 'note', { doc: '배포메모', sections: [{ h: '카나리', body: '첫 30분은 요청의 25%.' }] })
  const w = await s.hub.send(KIM, 'note')
  assert.equal(w.wait, 1)
  assert.ok((await s.hub.stops(KIM)).some((l) => l.kind === 'send' && /닿지 않는다/.test(l.b)))
})

test('받은편지함 정리 — 같은 주인의 개인 지식으로 옮김 · private 메모 → 옮김 0 · 팀 이름은 보내기 후보', async () => {
  await s.hub.save(KIM, 'inbox', { record: { title: '주간 회의 — 안건', body: '다음 주 안건 셋.' } })
  await s.hub.save(KIM, 'inbox', { record: { title: '주간 회의 — 개인 생각', body: '나만 본다.', tags: ['private'] } })
  await s.hub.save(KIM, 'inbox', { record: { title: '카나리 — 비율 메모', body: '20% 가 낫다.' } })
  const r = await s.hub.inboxTidy(KIM, 'inbox')
  assert.equal(r.moved.length, 1)
  assert.equal(r.moved[0].to, 'memo')
  assert.ok(!r.moved.some((x) => /개인 생각/.test(x.title)), 'private 은 그대로')
  assert.equal((await s.hub.get('memo')).works.filter((w) => /개인 생각/.test(w.title)).length, 0)
  assert.equal(r.candidates.length, 1)
  assert.equal(r.candidates[0].to, 'dpms')
  // 두 번 해도 다시 옮기지 않는다
  assert.equal((await s.hub.inboxTidy(KIM, 'inbox')).moved.length, 0)
})
