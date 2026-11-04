// E7 필수 — 파일 넣기 · 보내기 · 받기 · 받은편지함 정리.
//
// 팀 화면 파일 넣기(S8): docx → 들이기 일감 · 일꾼 한 번 = 기록 + 문서 = 커밋 하나 · 같은 파일 → same · 스캔 pdf → 「바꾸지 못한 파일 1」 · 21개 → E_INPUT · 64MB → 413 ·
// 상한 넘는 docx → 거절 · 고친 문서 → 보낼 것 1 →
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
import { copyDir, signIn, seat } from './helpers.mjs'
import { workOnce } from '../core/worker.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const KIM = { user: 'kim', admin: true }
const G = (dir, ...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const count = (dir) => { try { return Number(G(dir, 'rev-list', '--count', 'HEAD')) } catch { return 0 } } // 처음 저장 전에는 git 이 없다

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
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  mkKnowledge(path.join(tmp, 'kn', 'inbox'), '')
  mkKnowledge(path.join(tmp, 'kn', 'memo'), '## term\n\n- `term:주간 회의`: 주간 회의')
  mkKnowledge(path.join(tmp, 'kn', 'note'), '')
  fs.writeFileSync(path.join(tmp, 'kn', 'note', 'docs', '배포메모.md'), '# 배포메모\n\n## 카나리\n첫 30분은 요청의 10%.\n')
  // 보내기(S12) 받는 팀 지식 — 점검 › 순서 하나
  mkKnowledge(path.join(tmp, 'kn', 'rcv'), '## proc\n\n- `proc:순서`: 순서')
  fs.writeFileSync(path.join(tmp, 'kn', 'rcv', 'docs', '점검.md'), '# 점검\n\n## 순서\n전원부터 본다.\n')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sendTickMs: 3600000, inboxTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  for (const id of ['inbox', 'memo', 'note', 'rcv']) await s.hub.setOwner(SHELL, id, { owner: 'kim' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('파일 넣기(팀 화면 · S8): 파일마다 들이기 일감 + 일 줄 하나 · 일꾼 한 번 = 기록 + 문서 = 커밋 하나 · 정리 일감 0 · 같은 파일 → same · 스캔 pdf · 21개 → E_INPUT · 첨부 기본 해제 · 그만두기 → 기록 없음', async () => {
  const dir = path.join(tmp, 'kn', 'dpms')
  // 들이기 일감은 끝낼 때 명부에서 만든 사람의 자리를 다시 읽는다 — 명부에 있는 사람으로
  if (!s.auth.people().includes('kim')) await s.auth.addUser({ id: 'kim', admin: true })
  const wkey = (await s.auth.workerAdd()).key
  const file = docx([['Heading1', '목적'], ['', '회의에서 정한 것을 남긴다.'], ['Heading1', '정한 것'], ['', '배포 창은 화 · 목.']])
  const c0 = count(dir) || 1 // 처음 저장이면 git 을 세우는 첫 묶음이 하나 먼저 선다
  const r = await s.hub.importFiles(KIM, 'dpms', [{ path: '회의/배포회의.docx', data: file }])
  assert.equal(r.summary.run, 1, '팀 일꾼에게 넘김 1')
  assert.equal(r.summary.record, 0, '받을 때 기록을 먼저 쓰지 않는다')
  assert.ok(count(dir) <= c0, '받을 때는 커밋 0')
  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'assets', '회의', '배포회의.docx')), '원본 첨부는 기본 해제')
  const runId = r.rows[0].run
  let run = s.hub.runGet(KIM, runId)
  assert.deepEqual(run.stages.map((x) => x.state).slice(0, 2), ['done', 'done'], '수집 · 검토는 받으며 닫았다')
  assert.equal(run.stage, 2, '「짓기」 앞에서 팀 일꾼을 기다린다')
  assert.equal(run.spec?.type, 'intake')
  await workOnce({ server: s.url, key: wkey })
  assert.equal(count(dir), c0 + 1, '파일 하나 = 저장 하나 = 커밋 하나')
  const k = await s.hub.get('dpms')
  const rec = k.works.find((w) => w.tags.includes('ingest/회의/배포회의.docx'))
  assert.ok(rec, '기록이 섰다')
  assert.equal(rec.author, 'kim', '넣은 사람의 기록')
  assert.ok(rec.tags.includes('intake'))
  assert.equal(rec.state, 'in', '기록과 문서가 한 번에')
  run = s.hub.runGet(KIM, runId)
  assert.equal(run.state, 'done', run.msg)
  assert.deepEqual(run.stages.map((x) => x.state), ['done', 'done', 'done', 'done'])
  assert.equal(run.rec, rec.id)
  assert.match(fs.readFileSync(path.join(dir, 'docs', '배포회의.md'), 'utf8'), /배포 창은 화 · 목\./)

  // 같은 파일 — 다시 들이지 않는다
  const n0 = count(dir)
  const again = await s.hub.importFiles(KIM, 'dpms', [{ path: '회의/배포회의.docx', data: file }])
  assert.equal(again.summary.same, 1)
  assert.equal(s.hub.intakesOf('dpms').filter((j) => j.state === 'queued').length, 0)
  assert.equal(count(dir), n0, '같은 파일 → 커밋 0')

  // 스캔 pdf → 못 넣음(대량 넣기가 원본을 읽는다) · 읽지 못하는 종류 → 넣지 않음 · 큰 압축 → 못 넣음
  const pdf = await s.hub.importFiles(KIM, 'dpms', [{ path: '스캔.pdf', data: Buffer.from('%PDF-1.4 scan') }, { path: 'a.exe', data: Buffer.from('MZ') }])
  assert.equal(pdf.summary.fail, 1, '바꾸지 못한 파일 1')
  assert.match(pdf.rows[0].msg, /대량 넣기/)
  assert.equal(pdf.summary.skip, 1, '넣지 않은 파일 1')
  const bomb = zip([{ name: 'word/document.xml', deflate: true, data: Buffer.alloc(40 << 20, 32) }])
  const big = await s.hub.importFiles(KIM, 'dpms', [{ path: '폭탄.docx', data: bomb }])
  assert.equal(big.summary.run, 0)
  assert.match(big.rows[0].msg, /너무 크다/)
  // 한 번에 20 파일까지(S-D35) — 21개는 하나도 받지 않는다 · 묶음 누계도
  await assert.rejects(s.hub.importFiles(KIM, 'dpms', Array.from({ length: 21 }, (_, i) => ({ path: `${i}.md`, data: Buffer.from(`# ${i}\n\n## 칸${i}\n글 ${i}.\n`) }))), { code: 'E_INPUT', message: /한 번에 20 파일까지/ })
  await assert.rejects(s.hub.importFiles(KIM, 'dpms', [{ path: '묶음.md', data: Buffer.from('# 묶음\n') }], { group: { id: 'aa11bb22cc33', title: '묶음', total: 21 } }), { code: 'E_INPUT' })

  // 그만두기 — 아직 짓지 않은 들이기는 기록 없이 닫는다
  const st = await s.hub.importFiles(KIM, 'dpms', [{ path: '그만둘.md', data: Buffer.from('# 그만둘\n\n## 그만둘 순서\n넣지 않는다.\n') }])
  const sid = st.rows[0].run
  const jid = s.hub.runGet(KIM, sid).spec?.job || s.hub.intakesOf('dpms').find((j) => j.run === sid)?.id
  await s.hub.queueAct(KIM, sid, 'cancel')
  assert.equal(s.hub.job(jid).state, 'cancelled')
  assert.equal(s.hub.runGet(KIM, sid).state, 'cancel')
  assert.ok(!(await s.hub.get('dpms')).works.some((w) => w.tags.includes('ingest/그만둘.md')), '기록 없음')
  await assert.rejects(s.hub.queueAct(KIM, (await s.hub.importFiles(KIM, 'dpms', [{ path: '멈춤.md', data: Buffer.from('# 멈춤\n\n## 멈춤 순서\n멈추지 않는다.\n') }])).rows[0].run, 'pause'), { code: 'E_INPUT' })

  // 원본 첨부(고를 때만) — 글로 바꾼 파일은 들이기 저장 덩이에(같은 커밋) · 그림은 첨부가 유일한 결과
  while (s.hub.intakesOf('dpms').some((j) => j.state === 'queued')) await workOnce({ server: s.url, key: wkey })
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  const noAtt = await s.hub.importFiles(KIM, 'dpms', [{ path: '그림.png', data: png }])
  assert.equal(noAtt.summary.skip, 1)
  assert.match(noAtt.rows[0].msg, /원본 첨부를 고르지 않았다/)
  const att = await s.hub.importFiles(KIM, 'dpms', [{ path: '그림.png', data: png }, { path: '회의/첨부함.docx', data: docx([['Heading1', '첨부 순서'], ['', '원본도 둔다.']]) }], { attach: true })
  assert.equal(att.summary.att, 1)
  assert.equal(att.summary.run, 1)
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'assets', '그림.png')))
  const a0 = count(dir)
  await workOnce({ server: s.url, key: wkey })
  assert.equal(count(dir), a0 + 1, '첨부도 같은 커밋')
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'assets', '회의', '첨부함.docx')), '원본은 첨부로')
  // 고친 파일을 같은 이름으로 다시 + 원본 첨부 — 같은 이름의 다른 첨부는 덮지 않고 글만 들인다(E_CONFLICT 로 돌지 않는다 · 끝 검토 1)
  const att0 = fs.readFileSync(path.join(dir, 'docs', 'assets', '회의', '첨부함.docx'))
  const re = await s.hub.importFiles(KIM, 'dpms', [{ path: '회의/첨부함.docx', data: docx([['Heading1', '첨부 순서'], ['', '원본도 둔다. 고친 판이다.']]) }], { attach: true })
  assert.equal(re.summary.run, 1)
  assert.match(re.rows[0].msg, /같은 이름의 다른 첨부가 있어 원본은 두지 않았다/)
  const rj = s.hub.intakesOf('dpms').find((j) => j.run === re.rows[0].run)
  assert.ok(rj && !rj.src?.attach, '일감에 첨부를 싣지 않는다')
  await workOnce({ server: s.url, key: wkey })
  const rd = s.hub.job(rj.id)
  assert.equal(rd.state, 'done')
  assert.ok(rd.result.put >= 1 && !rd.result.held, JSON.stringify(rd.result))
  assert.ok(fs.readFileSync(path.join(dir, 'docs', 'assets', '회의', '첨부함.docx')).equals(att0), '앞 첨부는 그대로')

  // 쓰기 자리 — HTTP 길도 같다 · 21개는 400 · 첨부는 쓰기 자리부터
  const lee = await signIn(s, { id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write' }) // 기본 자리는 없음 — 쓰기 자리를 준 보통 팀 사람
  const hdr = { 'content-type': 'application/json', authorization: `Bearer ${lee.key}` }
  const h = await fetch(`${s.url}/api/k/dpms/import`, { method: 'POST', headers: hdr, body: JSON.stringify({ files: [{ path: '메모.md', b64: b64('# 메모\n\n## 연락 순서\n당번 → 박.\n') }] }) }).then((x) => x.json())
  assert.equal(h.summary.run, 1)
  assert.ok(!fs.existsSync(path.join(dir, 'docs', '메모.md')), '팀 일꾼이 짓기 전에는 문서가 없다')
  const many = await fetch(`${s.url}/api/k/dpms/import`, { method: 'POST', headers: hdr, body: JSON.stringify({ files: Array.from({ length: 21 }, (_, i) => ({ path: `x${i}.md`, b64: b64('# x') })) }) })
  assert.equal(many.status, 400)
  assert.match((await many.json()).message || '', /한 번에 20 파일까지/)
  // 팀 요청 하나는 64MB 까지 — 넘으면 413(화면은 묶음으로 나눠 보낸다)
  const huge = await fetch(`${s.url}/api/k/dpms/import`, { method: 'POST', headers: hdr, body: JSON.stringify({ files: [{ path: '큰.md', b64: 'A'.repeat(65 << 20) }] }) })
  assert.equal(huge.status, 413)
  assert.equal((await huge.json()).error, 'E_TOO_BIG')
})

test('보내기: 고친 문서 → 보낼 것 1 → 받는 지식에 기록 1 · 같은 것 다시 → 0 · 닿지 않으면 둠', async () => {
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

test('보내기 고르기: 변경사항(새 기록은 전체 · 고친 문서는 바뀐 항목만) · 지식에서 문서 · 기록을 골라 전체로 · 고르지 않은 것은 남는다', async () => {
  await s.hub.sendDests(KIM, 'note', [{ kn: 'dpms' }])
  await s.hub.save(KIM, 'note', { record: { title: '롤백 순서: 쓰기 먼저 멈춤', body: '롤백 전에 쓰기를 멈춘다.' } })
  await s.hub.edit(KIM, 'note', { doc: '배포메모', sections: [{ h: '카나리', body: '첫 30분은 요청의 30%.' }] })
  // 팀 서버의 개인 지식은 기록이 남는 즉시 문서에(PC 일꾼이 없으면 규칙으로) — 그 문서도 변경사항에 선다
  await s.hub.idle('note')
  const q = await s.hub.sendQueue(KIM, 'note')
  const rec = q.items.find((x) => x.kind === 'rec')
  const doc = q.items.find((x) => x.kind === 'doc' && /배포메모/.test(x.title))
  assert.equal(rec.title, '롤백 순서: 쓰기 먼저 멈춤', '새 기록은 변경사항에')
  assert.deepEqual(doc.heads, ['카나리'], '고친 문서는 바뀐 항목만')
  assert.ok(q.docs.some((d) => d.path === 'docs/배포메모.md'), '지식: 문서 목록')
  assert.ok(q.recs.some((r) => r.id === rec.id), '지식: 기록 목록')
  assert.ok(!q.items.some((x) => /화면에서 고침/.test(x.title)), '이력은 보낼 것이 아니다')

  // 변경사항에서는 기록만 고르고 · 지식에서 같은 문서를 전체로 고른다
  const r = await s.hub.send(KIM, 'note', { changes: [rec.key], docs: ['docs/배포메모.md'], recs: [] })
  assert.deepEqual({ sent: r.sent, wait: r.wait }, { sent: 2, wait: 0 })
  const got = (await s.hub.get('dpms')).works.filter((w) => w.tags.some((t) => t.startsWith('sent/')))
  assert.ok(got.some((w) => w.title === '롤백 순서: 쓰기 먼저 멈춤' && /롤백 전에 쓰기를 멈춘다/.test(w.body)), '기록은 전체로')
  assert.ok(got.some((w) => w.title === '배포메모: 문서 전체' && /## 카나리\n첫 30분은 요청의 30%/.test(w.body)), '문서는 전체로')
  assert.equal((await s.hub.sendQueue(KIM, 'note')).items.filter((x) => x.key === rec.key || /배포메모/.test(x.title)).length, 0, '보낸 기록 · 문서는 변경사항에서 빠진다')

  // 고르지 않은 변경사항은 다음에 그대로 남는다
  await s.hub.save(KIM, 'note', { record: { title: '헬스 체크: 5초', body: '5초 안에 200.' } })
  await s.hub.edit(KIM, 'note', { doc: '배포메모', sections: [{ h: '카나리', body: '첫 30분은 요청의 40%.' }] })
  await s.hub.idle('note')
  const q2 = await s.hub.sendQueue(KIM, 'note')
  const r2 = await s.hub.send(KIM, 'note', { changes: [q2.items.find((x) => x.kind === 'doc' && /배포메모/.test(x.title)).key] })
  assert.equal(r2.sent, 1)
  const left = (await s.hub.sendQueue(KIM, 'note')).items.map((x) => x.title)
  assert.ok(left.includes('헬스 체크: 5초') && !left.some((t) => /배포메모/.test(t)), '고르지 않은 것은 남는다 ' + left)
})

test('지식 보내기(내 PC → 팀): 보내는 길은 개인 지식마다 팀 지식 하나 · 바꾸려면 새 이름을 친다 · 화면이 본 길과 다르면 보내지 않는다 · 문서는 통째로만 · 팀 서버는 보내지 않는다', async () => {
  const code = (p) => p.then(() => null, (e) => e.code)
  assert.equal(await code(s.hub.sendView(KIM, 'memo')), 'E_FORBIDDEN', '팀 서버에는 개인 지식이 없다 · 보내기는 내 PC 에서')
  // 내 PC 쪽 — 이은 팀(teams.json)의 팀 지식으로 · 이 PC 의 기기 열쇠로 보낸다
  const proot = path.join(tmp, 'pcsend')
  mkKnowledge(path.join(proot, 'memo'), '')
  fs.writeFileSync(path.join(proot, 'memo', 'docs', '점검.md'), '# 점검\n\n## 순서\n전원부터 본다.\n\n## 기록\n날마다 남긴다.\n')
  const dk = await signIn(s, { id: 'kim3', admin: true })
  const was = process.env.KMD_SEND_KEY
  process.env.KMD_SEND_KEY = dk.key
  const pc = await startServer({ root: proot, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  fs.writeFileSync(path.join(proot, '.kmd', 'teams.json'), JSON.stringify([s.url]))
  const ME = { user: pc.pcUser, admin: true, pc: true }
  try {
    let v = await pc.hub.sendView(ME, 'memo')
    assert.equal(v.route, null, '처음에는 받는 지식이 없다')
    assert.equal(v.docs.find((d) => d.path === 'docs/점검.md').st, 'new', '보낸 적 없는 문서')
    assert.equal(await code(pc.hub.sendPicked(ME, 'memo', { to: 'dpms', recs: [] })), 'E_INPUT', '길을 정하기 전에는 보내지 않는다')
    assert.equal(await code(pc.hub.sendRoute(ME, 'memo', { to: '없는지식', url: s.url })), 'E_INPUT', '받는 지식은 그 팀의 팀 지식')
    v = await pc.hub.sendRoute(ME, 'memo', { to: 'dpms', url: s.url })
    assert.equal(v.route.kn, 'dpms')
    assert.ok(v.route.since, '정한 때가 남는다')

    await pc.hub.save(ME, 'memo', { record: { title: '전원 점검: 아침', body: '아침마다 전원부터.' } })
    await pc.hub.idle('memo')
    v = await pc.hub.sendView(ME, 'memo')
    const rec = v.recs.find((x) => x.title === '전원 점검: 아침')
    assert.ok(rec && !rec.sent, '보내지 않은 기록')
    assert.equal(await code(pc.hub.sendPicked(ME, 'memo', { to: 'gdi', recs: [rec.id] })), 'E_CONFLICT', '화면이 본 받는 지식과 다르면 보내지 않는다')
    const r = await pc.hub.sendPicked(ME, 'memo', { to: 'dpms', recs: [rec.id], docs: [{ path: 'docs/점검.md' }] })
    // 저장 문으로(S12) — 글마다 Claude(가짜)가 지은 기록 + 조각 · 받는 쪽이 그 순간 넣거나 넣지 못함으로
    assert.deepEqual({ sent: r.sent, put: r.put, held: r.held }, { sent: 2, put: 1, held: 1 }, JSON.stringify(r))
    let got = (await s.hub.get('dpms')).works.filter((w) => w.tags.some((t) => t.startsWith('sent/')))
    assert.ok(got.some((w) => w.title === '전원 점검: 들임' && w.state === 'held'), '머리 없는 기록은 넣을 곳이 없어 넣지 못함')
    assert.ok(got.some((w) => w.title === '점검: 들임' && w.state !== 'pend' && w.state !== 'held'), '문서는 그 순간 들어간다')
    assert.ok(!got.some((w) => w.state === 'pend'), '정리를 기다리는 기록이 없다')
    assert.match((await s.hub.get('dpms')).byDocPath.get('docs/점검.md').sections.find((x) => x.h === '순서').body, /전원부터 본다/)
    v = await pc.hub.sendView(ME, 'memo')
    assert.ok(v.recs.find((x) => x.id === rec.id).sent, '보낸 기록은 「보냄」')
    assert.equal(v.docs.find((d) => d.path === 'docs/점검.md').st, 'same')
    assert.equal(v.route.times, 1)

    await pc.hub.edit(ME, 'memo', { doc: '점검', sections: [{ h: '순서', body: '전원 다음 통신을 본다.' }] })
    v = await pc.hub.sendView(ME, 'memo')
    const d = v.docs.find((x) => x.path === 'docs/점검.md')
    assert.deepEqual([d.st, d.heads], ['chg', ['순서']])
    await pc.hub.sendPicked(ME, 'memo', { to: 'dpms', docs: [{ path: 'docs/점검.md', whole: false }] })
    got = (await s.hub.get('dpms')).works.filter((w) => w.tags.some((t) => t.startsWith('sent/')))
    const team = (await s.hub.get('dpms')).byDocPath.get('docs/점검.md').sections
    assert.match(team.find((x) => x.h === '순서').body, /통신/, '고친 항목이 받는 쪽 문서에 들어간다')
    assert.match(team.find((x) => x.h === '기록').body, /날마다 남긴다/, '문서는 통째로 간다(고친 항목만은 없다)')
    assert.ok(!got.some((w) => w.title === '점검: 순서'), '항목 조각은 보내지 않는다')

    // 바꾸기 — 새 이름을 그대로 쳐야
    assert.equal(await code(pc.hub.sendRoute(ME, 'memo', { to: 'gdi', url: s.url })), 'E_INPUT')
    assert.equal(await code(pc.hub.sendRoute(ME, 'memo', { to: 'gdi', url: s.url, confirm: 'dpms' })), 'E_INPUT')
    const gname = (await s.hub.meta('gdi')).name
    assert.equal((await pc.hub.sendRoute(ME, 'memo', { to: 'gdi', url: s.url, confirm: gname })).route.kn, 'gdi')
  } finally {
    await pc.close()
    if (was === undefined) delete process.env.KMD_SEND_KEY
    else process.env.KMD_SEND_KEY = was
  }
})
test('보내기(S12 · 저장 문): 쓰기 자리 · 받는 쪽 문서가 그 순간 바뀜 · 같은 것 다시 → 이미 넣음 · 넣지 못함 → fail 줄 · [지금 다시] 뒤 옛 넣지 못함은 바로잡힘 · 새 문서는 지식관리자만 · Claude 에 보내지 않는 팀 지식 → Claude 0번 · 넣지 못함(noclaude)', async () => {
  const proot = path.join(tmp, 'pcsave')
  mkKnowledge(path.join(proot, 'mine'), '')
  fs.writeFileSync(path.join(proot, 'mine', 'docs', '점검.md'), '# 점검\n\n## 순서\n전원 다음 통신을 본다.\n')
  fs.writeFileSync(path.join(proot, 'mine', 'docs', '새규칙.md'), '# 새규칙\n\n## 당번\n당번은 박이 맡는다.\n')
  const lee = await signIn(s, { id: 'lee5', admin: false })
  await seat(s, 'lee5', { rcv: 'write' }) // 지식관리자가 아닌 쓰기 자리
  const was = process.env.KMD_SEND_KEY
  process.env.KMD_SEND_KEY = lee.key
  const pc = await startServer({ root: proot, mode: 'pc', user: 'lee5', port: 0, log: () => {}, scryptN: 1 << 15 })
  fs.writeFileSync(path.join(proot, '.kmd', 'teams.json'), JSON.stringify([s.url]))
  const ME = { user: pc.pcUser, admin: true, pc: true }
  const log = path.join(tmp, 'claude-send.log')
  const sentOf = async () => (await s.hub.get('rcv')).works.filter((w) => w.tags.some((t) => t.startsWith('sent/')))
  const secOf = async (h) => (await s.hub.get('rcv')).byDocPath.get('docs/점검.md').sections.find((x) => x.h === h).body
  try {
    await pc.hub.sendRoute(ME, 'mine', { to: 'rcv', url: s.url })
    // ① 문서 → 받는 쪽 문서가 그 순간 바뀐다(정리를 기다리지 않는다) · 보낸 사람 이름으로
    let r = await pc.hub.sendPicked(ME, 'mine', { to: 'rcv', docs: [{ path: 'docs/점검.md' }] })
    assert.deepEqual({ put: r.put, held: r.held, fail: r.fail }, { put: 1, held: 0, fail: undefined }, JSON.stringify(r))
    assert.match(await secOf('순서'), /통신/)
    const w1 = (await sentOf())[0]
    assert.equal(w1.author, 'lee5')
    assert.notEqual(w1.state, 'pend')
    assert.equal((await pc.hub.sendView(ME, 'mine')).log[0].put, 1, '보낸 것 줄에 넣음 수')
    // ② 같은 것 다시 → 이미 넣음(아무것도 쓰지 않는다)
    r = await pc.hub.sendPicked(ME, 'mine', { to: 'rcv', docs: [{ path: 'docs/점검.md' }] })
    assert.equal(r.same, 1)
    assert.equal((await sentOf()).length, 1)
    // ③ 새 문서(쓰기 자리는 세우지 못한다) → 받는 쪽은 넣지 못함 · 보내는 쪽은 fail 줄
    r = await pc.hub.sendPicked(ME, 'mine', { to: 'rcv', docs: [{ path: 'docs/새규칙.md' }] })
    assert.deepEqual({ put: r.put, held: r.held }, { put: 0, held: 1 }, JSON.stringify(r))
    const line = (await pc.hub.sendView(ME, 'mine')).wait.find((x) => x.state === 'fail')
    assert.ok(line && line.held && /넣지 못함/.test(line.why) && /다시/.test(line.fix), JSON.stringify(line))
    const h1 = (await sentOf()).find((w) => w.state === 'held')
    assert.ok(h1 && /지식관리자가 세운다/.test(h1.body), '넣지 못함 칸에 까닭')
    assert.ok(!(await s.hub.get('rcv')).byDocPath.get('docs/새규칙.md'), '새 문서는 서지 않았다')
    // ④ [지금 다시] — 넣지 못한 까닭이 그대로면 줄이 그대로(새 까닭) · 지식관리자 자리를 받은 뒤 다시 → 새 문서가 서고 앞 넣지 못함은 바로잡힘
    await assert.rejects(pc.hub.sendWaitAct(ME, 'mine', { wid: line.id, act: 'retry' }), { code: 'E_INPUT', message: /넣지 못함/ })
    let v = await pc.hub.sendView(ME, 'mine')
    assert.equal(v.wait.filter((x) => x.state === 'fail').length, 1, '줄은 하나로 바뀐다')
    const h2 = (await sentOf()).find((w) => w.state === 'held')
    assert.equal((await sentOf()).find((w) => w.id === h1.id).state, 'held', '새 기록도 넣지 못함이면 앞 기록은 그대로(다음 [다시] 가 둘 다 바로잡는다)')
    await seat(s, 'lee5', { rcv: 'admin' })
    assert.deepEqual(await pc.hub.sendWaitAct(ME, 'mine', { wid: line.id, act: 'retry' }), { sent: 1 })
    const after = await sentOf()
    assert.deepEqual([after.find((w) => w.id === h1.id).state, after.find((w) => w.id === h2.id).state], ['fixed', 'fixed'], '[다시] 의 fixes 로 앞 넣지 못함이 모두 바로잡힘')
    assert.equal(after.filter((w) => w.state === 'held').length, 0, '넣지 못함이 겹쳐 남지 않는다')
    assert.match((await s.hub.get('rcv')).byDocPath.get('docs/새규칙.md').sections.find((x) => x.h === '당번').body, /박/)
    v = await pc.hub.sendView(ME, 'mine')
    assert.equal(v.wait.length, 0, '줄이 걷힌다')
    // ⑤ Claude 에 보내지 않는 팀 지식 → 내 PC 도 Claude 를 부르지 않고 기록만 → 받는 쪽 넣지 못함(noclaude)
    await s.hub.setOwner(SHELL, 'rcv', { noClaude: true })
    process.env.FAKE_CLAUDE_LOG = log
    await pc.hub.edit(ME, 'mine', { doc: '점검', sections: [{ h: '순서', body: '전원 다음 통신 다음 경보를 본다.' }] })
    r = await pc.hub.sendPicked(ME, 'mine', { to: 'rcv', docs: [{ path: 'docs/점검.md' }] })
    assert.equal(r.held, 1, JSON.stringify(r))
    assert.ok(!fs.existsSync(log) || !/intake/.test(fs.readFileSync(log, 'utf8')), 'Claude 0번')
    assert.ok((await sentOf()).some((w) => w.state === 'held' && /Claude 에 보내지 않는/.test(w.body)))
    assert.doesNotMatch(await secOf('순서'), /경보/, '문서는 그대로')
  } finally {
    delete process.env.FAKE_CLAUDE_LOG
    await s.hub.setOwner(SHELL, 'rcv', { noClaude: false })
    await pc.close()
    if (was === undefined) delete process.env.KMD_SEND_KEY
    else process.env.KMD_SEND_KEY = was
  }
})

test('보내기: 저장 속도 한도(429)는 Retry-After 만큼 쉬고 다시 보낸다(fail 줄이 아니다)', async () => {
  const http = await import('node:http')
  let n = 0
  const srv = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      n++
      if (n === 1) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' })
        return res.end(JSON.stringify({ error: 'E_RATE', message: '저장이 너무 잦다', details: { retryAfter: 1 } }))
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'r1', put: 1 }))
    })
  })
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  try {
    const t0 = Date.now()
    const r = await post(`http://127.0.0.1:${srv.address().port}`, 'kn', { record: { title: 'x' }, channel: 'send' }, 'k', { path: 'save' })
    assert.deepEqual(r, { id: 'r1', put: 1 })
    assert.equal(n, 2)
    assert.ok(Date.now() - t0 >= 900, '쉬었다가')
  } finally {
    srv.close()
  }
})

test('받은편지함 정리(내 PC): 이름이 걸리는 개인 지식으로 옮김 · private 메모 → 옮김 0 · 팀 서버는 옮기지 않는다', async () => {
  // 팀 서버에는 개인 지식이 없다 — 옮길 곳이 없다
  await s.hub.save(KIM, 'inbox', { record: { title: '주간 회의: 팀 안건', body: '팀 서버에 남은 메모.' } })
  assert.equal((await s.hub.inboxMove(KIM, 'inbox')).moved.length, 0)
  const proot = path.join(tmp, 'pcinbox')
  mkKnowledge(path.join(proot, 'inbox'), '')
  mkKnowledge(path.join(proot, 'memo'), '## term\n\n- `term:주간 회의`: 주간 회의')
  const pc = await startServer({ root: proot, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  const ME = { user: pc.pcUser, admin: true, pc: true }
  try {
    await pc.hub.save(ME, 'inbox', { record: { title: '주간 회의: 안건', body: '다음 주 안건 셋.' } })
    await pc.hub.save(ME, 'inbox', { record: { title: '주간 회의: 개인 생각', body: '나만 본다.', tags: ['private'] } })
    await pc.hub.idle('inbox')
    const r = await pc.hub.inboxMove(ME, 'inbox')
    assert.ok(r.moved.some((x) => x.to === 'memo' && /안건/.test(x.title)))
    assert.ok(!r.moved.some((x) => /개인 생각/.test(x.title)), 'private 은 그대로')
    assert.equal((await pc.hub.get('memo')).works.filter((w) => /개인 생각/.test(w.title)).length, 0)
    // 두 번 해도 다시 옮기지 않는다
    assert.equal((await pc.hub.inboxMove(ME, 'inbox')).moved.length, 0)
  } finally {
    await pc.close()
  }
})
test('지식 추가: 지식 폴더 밖의 폴더는 지식 폴더 안의 새 지식으로 들여온다(원본은 그대로 · 따라가지 않는다)', async () => {
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
    // 대원칙 — 기록 → 문서: 파일마다 기록(글 그대로)이 먼저 · 문서 항목은 그 기록을 표지로 · 기록은 「문서에 들어감」
    const k = await pc.hub.get('옛자료')
    const recs = k.works.filter((w) => /들여온 문서 · /.test(w.title))
    assert.equal(recs.length, 2)
    assert.ok(recs.every((w) => w.state === 'in'), recs.map((w) => w.state).join())
    const d10 = k.docs.find((d) => d.id === '회의/10월')
    assert.equal(k.byWork.get(d10.sections[0].applied)?.title, '10월.md: 들여온 문서 · 옛자료')
    assert.ok(k.logs.some((w) => w.title.startsWith('들여옴: 옛 폴더 · 문서 2') && w.reflects.length === 2), '이력 하나가 그 기록들을 넣었다')
    // 같은 폴더를 또 — 이름이 겹치면 -2 · 지식 폴더 안 · 지식 폴더를 품은 폴더는 거절
    assert.equal((await pc.hub.addKnowledge(ME, { kind: 'folder', dir: old })).id, '옛자료-2')
    await assert.rejects(pc.hub.addKnowledge(ME, { kind: 'folder', dir: path.join(root, '옛자료') }), { code: 'E_INPUT' })
    await assert.rejects(pc.hub.addKnowledge(ME, { kind: 'folder', dir: tmp }), { code: 'E_INPUT' })
    await assert.rejects(s.hub.addKnowledge(KIM, { kind: 'folder', dir: old }), { code: 'E_FORBIDDEN' }, '팀 서버는 경로를 받지 않는다')
  } finally {
    await pc.close()
  }
})

test('이 PC 의 파일 넣기: 정리가 따로 없다: 기록과 문서가 바로(Claude 로 다듬어) · Claude 로그인이 없으면 규칙으로 갈래 · 주제 문서(파일 이름 아님) · 기록은 늘 「넣음」', async () => {
  const root = path.join(tmp, 'pcroot-ingest')
  fs.mkdirSync(root, { recursive: true })
  const pc = await startServer({ root, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const ME = { user: pc.pcUser, admin: true, pc: true }
    const { id } = await pc.hub.addKnowledge(ME, { kind: 'new', name: '배포노트' })
    const dir = path.join(root, id)
    // Claude 로 — 「회의록-1021」 은 회의록 갈래라 갈래 문서 「회의록」 의 새 항목 「언제 · 무엇」 으로(파일 이름 문서는 서지 않는다) · 그 기록은 넣음 · 정리 일감은 없다
    const r = await pc.hub.importFiles(ME, id, [{ path: '회의록-1021.md', data: Buffer.from('# 회의록-1021\n\n## 정한 것\n배포 창은 화 · 목.\n') }])
    assert.equal(r.rows[0].kind, 'doc', r.rows[0].msg)
    assert.match(r.rows[0].msg, /기록 · 문서가 됐다. 배포노트 › 회의록 \(새 문서\) · Claude 로 다듬었다/)
    assert.match(fs.readFileSync(path.join(dir, 'docs', '회의록.md'), 'utf8'), /## \d{4}-\d{2}-\d{2} 1021\n<!-- applied: [^>]+ -->\n\*\*정한 것\*\*\n배포 창은 화 · 목\./)
    assert.ok(!fs.existsSync(path.join(dir, 'docs', '회의록-1021.md')), '파일 이름 문서는 서지 않는다')
    let k = await pc.hub.get(id)
    const rec = k.works.find((w) => w.tags.includes('ingest/회의록-1021.md'))
    assert.equal(rec.state, 'in', '기록은 바로 넣음')
    // Claude 로그인이 없다 — 규칙으로 파일 그대로 새 문서 · 설정의 Claude 연결이 로그인을 부른다
    process.env.FAKE_CLAUDE_MODE = 'logout'
    try {
      const r2 = await pc.hub.importFiles(ME, id, [{ path: '메모.md', data: Buffer.from('머리 없는 메모 — 당번은 박.\n') }])
      assert.equal(r2.rows[0].kind, 'doc')
      assert.match(r2.rows[0].msg, /메모 \(규칙으로 주제로 새 문서 · Claude 로그인이 없다/)
      assert.match(fs.readFileSync(path.join(dir, 'docs', '메모.md'), 'utf8'), /## 개요\n<!-- applied: [^>]+ -->\n머리 없는 메모: 당번은 박\./)
      // 규칙으로도 문서 이름은 파일 이름이 아니라 갈래 · 주제 — 통화 · 회의 파일은 「회의록」 의 새 항목 「언제 · 무엇」 · 날짜 · 판 조각은 걷는다
      const r3 = await pc.hub.importFiles(ME, id, [{ path: '2026-10-21 HNC 통화.md', data: Buffer.from('# HNC 통화\n\n## 정한 것\n납기는 11-02.\n') }])
      assert.match(r3.rows[0].msg, /배포노트 › 회의록 \(규칙으로 갈래 「회의록」 문서에 새 항목 2026-10-21 HNC 통화/)
      const r4 = await pc.hub.importFiles(ME, id, [{ path: '회의_20261022_v2(최종).md', data: Buffer.from('주간 회의 — 당번 표를 바꾼다.\n') }])
      assert.match(r4.rows[0].msg, /배포노트 › 회의록 \(규칙으로 갈래 「회의록」 문서에 새 항목 2026-10-22/)
      const mins = fs.readFileSync(path.join(dir, 'docs', '회의록.md'), 'utf8')
      assert.match(mins, /## 2026-10-21 HNC 통화\n<!-- applied: [^>]+ -->\n\*\*정한 것\*\*\n납기는 11-02\./, '글 속 머리는 굵은 글')
      assert.match(mins, /## 2026-10-22 회의\n/)
      assert.ok(!fs.existsSync(path.join(dir, 'docs', '2026-10-21 HNC 통화.md')), '파일 이름 문서는 서지 않는다')
      const r5 = await pc.hub.importFiles(ME, id, [{ path: '01_배포 절차_v2(최종).md', data: Buffer.from('## 순서\n앱 먼저.\n') }])
      assert.match(r5.rows[0].msg, /배포노트 › 배포 절차 \(규칙으로 주제로 새 문서/)
    } finally {
      delete process.env.FAKE_CLAUDE_MODE
    }
    k = await pc.hub.get(id)
    assert.ok(k.works.filter((w) => w.tags.some((t) => t.startsWith('ingest/'))).every((w) => w.state === 'in'), '기록은 모두 넣음')
    assert.ok(k.logs.some((w) => w.title === '정리: 메모.md 들임' && /규칙으로/.test(w.body)))
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.kmd', 'worker.json'), 'utf8')).reason, 'login')
  } finally {
    await pc.close()
  }
})

test('이 PC: 「아직 안 넣은 기록」 은 남는 즉시 문서에(켤 때 쌓인 것 · 세션 기록 · 이름 없는 메모 · Claude 로그인이 없으면 규칙으로)', async () => {
  const root = path.join(tmp, 'pcroot-curate')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  const pc = await startServer({ root, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  const pending = async () => (pc.hub.forget('dpms'), (await pc.hub.get('dpms')).works.filter((w) => w.state === 'pend' || w.state === 'nowhere'))
  const doc = () => fs.readFileSync(path.join(root, 'dpms', 'docs', '배포절차.md'), 'utf8')
  try {
    const ME = { user: pc.pcUser, admin: true, pc: true }
    // 켤 때 쌓여 있던 기록 — 저절로 문서에
    const t0 = Date.now()
    while ((await pending()).length && Date.now() - t0 < 90_000) await new Promise((r) => setTimeout(r, 500))
    await pc.hub.idle('dpms')
    assert.deepEqual((await pending()).map((w) => w.title), [], '켤 때 쌓인 기록은 모두 넣었다')
    // 세션이 남긴 기록(항목이 정해진) — 저장은 바로 돌려주고 뒤에서 그 항목에(Claude)
    const r = await pc.hub.save(ME, 'dpms', { record: { title: '카나리: 첫 30분 20%', body: '첫 30분은 요청의 20% 만 보낸다.', touches: ['proc:카나리'] } })
    await pc.hub.idle('dpms')
    let k = await pc.hub.get('dpms')
    assert.equal(k.byWork.get(r.id).state, 'in')
    assert.match(doc(), /첫 30분은 요청의 20% 만 보낸다\./)
    // 이름 없는 메모 — 이어지는 문서 · 새 문서로
    const m = await pc.hub.save(ME, 'dpms', { record: { title: '당번: 이번 주', body: '이번 주 당번은 박.' } })
    await pc.hub.idle('dpms')
    k = await pc.hub.get('dpms')
    assert.equal(k.byWork.get(m.id).state, 'in', '이름 없는 메모도 넣음')
    // Claude 로그인이 없다 — 규칙으로 기록 글을 그 항목 끝에
    process.env.FAKE_CLAUDE_MODE = 'logout'
    try {
      const h = await pc.hub.save(ME, 'dpms', { record: { title: '헬스 체크: 경로', body: '## 경로\n헬스 체크 경로는 `/healthz` 로 바꾼다.' , touches: ['proc:헬스 체크'] } })
      await pc.hub.idle('dpms')
      k = await pc.hub.get('dpms')
      assert.equal(k.byWork.get(h.id).state, 'in')
      assert.match(doc(), /## 헬스 체크\n<!-- applied: [^>]+ -->\n[\s\S]*\*\*경로\*\*\n헬스 체크 경로는 `\/healthz` 로 바꾼다\./, '머리 줄은 굵은 글로 붙였다')
      assert.ok(k.logs.some((w) => w.title === '정리: 헬스 체크' && /규칙으로: 기록 글을 항목 끝에 붙였다/.test(w.body)))
    } finally {
      delete process.env.FAKE_CLAUDE_MODE
    }
    assert.deepEqual((await pending()).map((w) => w.title), [], '남은 기록 0')
  } finally {
    await pc.close()
  }
})

test('지식 지우기: 이름을 그대로 써야 · 팀은 총괄 관리자만 · 보관 없이 폴더 · 살림까지 완전히', async () => {
  const dir = path.join(tmp, 'kn', 'inbox')
  const data = path.join(tmp, 'kn', '.kmd')
  assert.ok(fs.existsSync(dir))
  await assert.rejects(s.hub.deleteKnowledge(KIM, 'inbox', { confirm: '아무거나' }), { code: 'E_INPUT' })
  await seat(s, 'lee', { dpms: 'write' }) // 그 지식을 보는 보통 팀 사람(자리가 없으면 404 로 먼저 막힌다)
  await assert.rejects(s.hub.deleteKnowledge({ user: 'lee' }, 'dpms', { confirm: 'DPMS 지식' }), { code: 'E_FORBIDDEN' })
  await assert.rejects(s.hub.deleteKnowledge({ user: 'kim' }, 'inbox', { confirm: 'inbox' }), { code: 'E_FORBIDDEN' }, '총괄 관리자가 아니면(주인이어도)')
  await s.hub.inboxMove(KIM, 'inbox')
  const r = await s.hub.deleteKnowledge(KIM, 'inbox', { confirm: 'inbox' })
  assert.equal(r.removed, true)
  assert.ok(!fs.existsSync(dir), '폴더가 통째로 없다(보관 없음)')
  assert.ok(!fs.existsSync(path.join(data, 'inbox', 'inbox.json')), '받은편지함 정리 상태도 없다')
  assert.equal(s.hub.owner('inbox'), null, '주인 줄도 없다')
  assert.ok(!(await s.hub.list()).some((k) => k.id === 'inbox'))
  await assert.rejects(s.hub.get('inbox'), { code: 'E_NOTFOUND' })
  // 팀 지식은 총괄 관리자 — HTTP 길은 비밀번호 한 번 더
  const lee2 = await fetch(`${s.url}/api/k/dpms/delete`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: (await signIn(s, { id: 'admin2', admin: true })).cookie }, body: JSON.stringify({ confirm: 'DPMS 지식' }) })
  assert.equal(lee2.status, 403)
  assert.equal((await lee2.json()).error, 'E_SUDO')
  assert.ok(fs.existsSync(path.join(tmp, 'kn', 'dpms')))
})
