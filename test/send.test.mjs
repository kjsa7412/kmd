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

test('보내기 고르기 — 변경사항(새 기록은 전체 · 고친 문서는 바뀐 항목만) · 지식에서 문서 · 기록을 골라 전체로 · 고르지 않은 것은 남는다', async () => {
  await s.hub.sendDests(KIM, 'note', [{ kn: 'dpms' }])
  await s.hub.save(KIM, 'note', { record: { title: '롤백 순서 — 쓰기 먼저 멈춤', body: '롤백 전에 쓰기를 멈춘다.' } })
  await s.hub.edit(KIM, 'note', { doc: '배포메모', sections: [{ h: '카나리', body: '첫 30분은 요청의 30%.' }] })
  const q = await s.hub.sendQueue(KIM, 'note')
  const rec = q.items.find((x) => x.kind === 'rec')
  const doc = q.items.find((x) => x.kind === 'doc')
  assert.equal(rec.title, '롤백 순서 — 쓰기 먼저 멈춤', '새 기록은 변경사항에')
  assert.deepEqual(doc.heads, ['카나리'], '고친 문서는 바뀐 항목만')
  assert.ok(q.docs.some((d) => d.path === 'docs/배포메모.md'), '지식 — 문서 목록')
  assert.ok(q.recs.some((r) => r.id === rec.id), '지식 — 기록 목록')
  assert.ok(!q.items.some((x) => /화면에서 고침/.test(x.title)), '이력은 보낼 것이 아니다')

  // 변경사항에서는 기록만 고르고 · 지식에서 같은 문서를 전체로 고른다
  const r = await s.hub.send(KIM, 'note', { changes: [rec.key], docs: ['docs/배포메모.md'], recs: [] })
  assert.deepEqual(r, { sent: 2, wait: 0 })
  const got = (await s.hub.get('dpms')).works.filter((w) => w.tags.some((t) => t.startsWith('sent/')))
  assert.ok(got.some((w) => w.title === '롤백 순서 — 쓰기 먼저 멈춤' && /롤백 전에 쓰기를 멈춘다/.test(w.body)), '기록은 전체로')
  assert.ok(got.some((w) => w.title === '배포메모 — 문서 전체' && /## 카나리\n첫 30분은 요청의 30%/.test(w.body)), '문서는 전체로')
  assert.equal((await s.hub.sendQueue(KIM, 'note')).items.length, 0, '보낸 기록 · 문서는 변경사항에서 빠진다')

  // 고르지 않은 변경사항은 다음에 그대로 남는다
  await s.hub.save(KIM, 'note', { record: { title: '헬스 체크 — 5초', body: '5초 안에 200.' } })
  await s.hub.edit(KIM, 'note', { doc: '배포메모', sections: [{ h: '카나리', body: '첫 30분은 요청의 40%.' }] })
  const q2 = await s.hub.sendQueue(KIM, 'note')
  const r2 = await s.hub.send(KIM, 'note', { changes: [q2.items.find((x) => x.kind === 'doc').key] })
  assert.equal(r2.sent, 1)
  assert.deepEqual((await s.hub.sendQueue(KIM, 'note')).items.map((x) => x.title), ['헬스 체크 — 5초'])
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

test('지식 추가 — 지식 폴더 밖의 폴더는 지식 폴더 안의 새 지식으로 들여온다(원본은 그대로 · 따라가지 않는다)', async () => {
  const root = path.join(tmp, 'pcroot')
  fs.mkdirSync(root, { recursive: true })
  const old = path.join(tmp, '옛자료')
  fs.mkdirSync(path.join(old, '회의'), { recursive: true })
  fs.writeFileSync(path.join(old, '배포 절차.md'), '# 배포 절차\n\n## 순서\n빌드 → 배포.\n')
  fs.writeFileSync(path.join(old, '회의', '10월.md'), '# 10월\n\n## 정한 것\n화 · 목 배포.\n')
  fs.writeFileSync(path.join(old, '그림.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const before = fs.readdirSync(old, { recursive: true }).sort()
  const pc = await startServer({ root, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const ME = { user: pc.pcUser, admin: true, pc: true }
    const r = await pc.hub.addKnowledge(ME, { kind: 'folder', dir: old })
    assert.equal(r.dir, path.join(root, '옛자료'), '지식 폴더 안에 선다')
    assert.equal(r.summary.doc, 2)
    assert.ok(fs.existsSync(path.join(root, '옛자료', 'docs', '회의', '10월.md')))
    assert.ok(!fs.existsSync(path.join(root, '옛자료', 'docs', '처음.md')), '들여온 지식에는 빈 처음 문서가 없다')
    assert.deepEqual(fs.readdirSync(old, { recursive: true }).sort(), before, '원본 폴더는 그대로(.git · work 를 만들지 않는다)')
    assert.ok(!fs.existsSync(path.join(root, '.kmd', 'links.json')) || !JSON.parse(fs.readFileSync(path.join(root, '.kmd', 'links.json'), 'utf8')).length, '따라가는 줄 0')
    assert.deepEqual((await pc.hub.get('옛자료')).docs.map((d) => d.id).sort(), ['배포 절차', '회의/10월'])
    // 같은 폴더를 또 — 이름이 겹치면 -2 · 지식 폴더 안 · 지식 폴더를 품은 폴더는 거절
    assert.equal((await pc.hub.addKnowledge(ME, { kind: 'folder', dir: old })).id, '옛자료-2')
    await assert.rejects(pc.hub.addKnowledge(ME, { kind: 'folder', dir: path.join(root, '옛자료') }), { code: 'E_INPUT' })
    await assert.rejects(pc.hub.addKnowledge(ME, { kind: 'folder', dir: tmp }), { code: 'E_INPUT' })
    await assert.rejects(s.hub.addKnowledge(KIM, { kind: 'folder', dir: old }), { code: 'E_FORBIDDEN' }, '팀 서버는 경로를 받지 않는다')
  } finally {
    await pc.close()
  }
})

test('지식 지우기 — 이름을 그대로 써야 · 팀은 관리자나 개인 지식의 주인만 · 보관 없이 폴더 · 살림까지 완전히', async () => {
  const dir = path.join(tmp, 'kn', 'inbox')
  const data = path.join(tmp, 'kn', '.kmd')
  assert.ok(fs.existsSync(dir))
  await assert.rejects(s.hub.deleteKnowledge(KIM, 'inbox', { confirm: '아무거나' }), { code: 'E_INPUT' })
  await assert.rejects(s.hub.deleteKnowledge({ user: 'lee' }, 'dpms', { confirm: 'DPMS 지식' }), { code: 'E_FORBIDDEN' })
  const r = await s.hub.deleteKnowledge({ user: 'kim' }, 'inbox', { confirm: 'inbox' }) // 개인 지식의 주인 — 관리자가 아니어도
  assert.equal(r.removed, true)
  assert.ok(!fs.existsSync(dir), '폴더가 통째로 없다(보관 없음)')
  assert.ok(!fs.existsSync(path.join(data, 'inbox', 'inbox.json')), '받은편지함 정리 상태도 없다')
  assert.equal(s.hub.owner('inbox'), null, '주인 줄도 없다')
  assert.ok(!(await s.hub.list()).some((k) => k.id === 'inbox'))
  await assert.rejects(s.hub.get('inbox'), { code: 'E_NOTFOUND' })
  // 팀 지식은 관리자 — HTTP 길은 비밀번호 한 번 더
  const lee2 = await fetch(`${s.url}/api/k/dpms/delete`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: (await signIn(s, { id: 'admin2', admin: true })).cookie }, body: JSON.stringify({ confirm: 'DPMS 지식' }) })
  assert.equal(lee2.status, 403)
  assert.equal((await lee2.json()).error, 'E_SUDO')
  assert.ok(fs.existsSync(path.join(tmp, 'kn', 'dpms')))
})
