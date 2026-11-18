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
import { copyDir, signIn, seat, ensureRecordsDoc } from './helpers.mjs'
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
  fs.writeFileSync(path.join(dir, '_vocab.md'), `# 항목 장부\n\n${vocab}\n`)
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
  // 저장 승인 P7 — approve 모드로 켤 받는 팀 지식(같은 점검 › 순서)
  mkKnowledge(path.join(tmp, 'kn', 'apvs'), '## proc\n\n- `proc:순서`: 순서')
  fs.writeFileSync(path.join(tmp, 'kn', 'apvs', 'docs', '점검.md'), '# 점검\n\n## 순서\n전원부터 본다.\n\n## 기록\n날마다 남긴다.\n')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sendTickMs: 3600000, inboxTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  for (const id of ['inbox', 'memo', 'note', 'rcv']) await s.hub.setOwner(SHELL, id, { owner: 'kim' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

// 저장 승인 P7(P-D22 · P-D23 · P-D46) — approve 모드 팀 지식으로 보내기: 창(미리 보기)이 글마다 팀 propose 를 미리 돌린 제안서 ·
//   창 없이 보내면 E_APPROVE(아무것도 안 보냄) · 창에서 모두 뺀 글은 보내지 않고 남는다 · [보내기] 는 그 proposal 로 기록 + 항목 글 한 번 ·
//   옛 판(proposal 없음)은 E_APPROVE + 새 판 안내(아무것도 안 씀) · 판(kit)은 savelog 에 · 개인 프로그램의 받기 갈래는 걷었다
test('보내기(P7 · approve 팀 지식): 미리 보기 = 저장 제안 · 창 없이 E_APPROVE · 모두 빼면 안 보냄 · 승인한 제안으로 들어감 · 옛 판 E_APPROVE · 개인 받기 없음', async () => {
  await s.hub.setOwner(SHELL, 'apvs', { owner: 'kim' })
  await ensureRecordsDoc(s, 'apvs')
  const proot = path.join(tmp, 'pcapv')
  mkKnowledge(path.join(proot, 'mine'), '')
  fs.writeFileSync(path.join(proot, 'mine', 'docs', '점검.md'), '# 점검\n\n## 순서\n전원 다음 통신을 본다.\n\n## 기록\n주마다 남긴다.\n')
  const me = await signIn(s, { id: 'kim7', admin: true })
  const was = process.env.KMD_SEND_KEY
  process.env.KMD_SEND_KEY = me.key
  const pc = await startServer({ root: proot, mode: 'pc', user: 'kim7', port: 0, log: () => {}, scryptN: 1 << 15 })
  fs.writeFileSync(path.join(proot, '.kmd', 'teams.json'), JSON.stringify([s.url]))
  const ME = { user: pc.pcUser, admin: true, pc: true }
  const code = (p) => p.then(() => null, (e) => e.code)
  const recsOf = async () => (s.hub.forget?.('apvs'), (await s.hub.get('apvs')).works.filter((w) => w.tags.some((x) => x.startsWith('sent/'))))
  const secOf = async (h = '순서') => (s.hub.forget?.('apvs'), (await s.hub.get('apvs')).byDocPath.get('docs/점검.md').sections.find((x) => x.h === h).body)
  try {
    await pc.hub.sendRoute(ME, 'mine', { to: 'apvs', url: s.url })
    const pick = { to: 'apvs', docs: [{ path: 'docs/점검.md' }] }
    // ① 창(미리 보기) 없이 보내면 — 아무것도 보내지 않는다
    assert.equal(await code(pc.hub.sendPicked(ME, 'mine', pick)), 'E_APPROVE')
    assert.equal((await recsOf()).length, 0)
    assert.equal((await pc.hub.sendView(ME, 'mine')).wait.length, 0, 'fail 줄도 없다')
    // ② 미리 보기 — 글마다 받는 팀의 저장 제안(propose) · 쓰지 않는다
    const pv = await pc.hub.sendPreview(ME, 'mine', pick)
    assert.equal(pv.approve, true, JSON.stringify(pv))
    assert.equal(pv.proposals.length, 1)
    const pr = pv.proposals[0]
    assert.match(pr.rec, /^[0-9a-f]{16}$/)
    assert.ok(pr.propose.items.some((x) => x.at.includes('순서') && x.kind === '고침'), JSON.stringify(pr.propose))
    assert.match(pr.propose.text, /【저장 제안】.*길: 보내기/)
    assert.deepEqual(pr.propose.errors, [])
    assert.equal((await recsOf()).length, 0, '미리 보기는 쓰지 않는다')
    // ③ 창에서 넣을 곳을 모두 뺐다 — 보내지 않고 개인 쪽에 남는다
    assert.equal(await code(pc.hub.sendPicked(ME, 'mine', { ...pick, excluded: { zz: ['x'] } })), 'E_INPUT')
    let r = await pc.hub.sendPicked(ME, 'mine', { ...pick, excluded: { [pr.rec]: pr.propose.items.map((x) => x.at) } })
    assert.deepEqual({ put: r.put, skipped: r.skipped }, { put: 0, skipped: 1 }, JSON.stringify(r))
    assert.equal((await recsOf()).length, 0)
    assert.equal((await pc.hub.sendView(ME, 'mine')).docs.find((d) => d.path === 'docs/점검.md').st, 'new', '뺀 문서는 「보냄」 이 아니다')
    // ③-2 순서만 뺐다 — 남은 항목(기록)으로 다시 제안해 들어간다 · 「뺀다」 줄 · 순서는 그대로 · 문서는 「보냄」 이 아니다
    const atOrder = pr.propose.items.find((x) => x.at.includes('순서')).at
    assert.ok(pr.propose.items.some((x) => x.at.includes('기록') && x.kind === '고침'), JSON.stringify(pr.propose.items))
    r = await pc.hub.sendPicked(ME, 'mine', { ...pick, excluded: { [pr.rec]: [atOrder] } })
    assert.deepEqual({ put: r.put, fail: r.fail }, { put: 1, fail: undefined }, JSON.stringify(r))
    assert.match(await secOf('기록'), /주마다/)
    assert.match(await secOf(), /전원부터/, '뺀 항목은 들어가지 않았다')
    assert.notEqual((await pc.hub.sendView(ME, 'mine')).docs.find((d) => d.path === 'docs/점검.md').st, 'same')
    const part = (await recsOf())[0]
    assert.doesNotMatch(part.body, /통신/, '뺀 항목의 글은 기록(원천 인용)으로도 가지 않는다')
    // ④ 다시 창을 열고(새 제안) 모두 보낸다 — 앞의 일부 보내기와 다른 보낸 지문이라 「이미 넣음」 이 아니다 · 판(kit)은 측정 줄에
    assert.equal(await code(pc.hub.sendPicked(ME, 'mine', pick)), 'E_APPROVE', '보낸 제안은 걷혔다: 창을 다시 연다')
    const pv2 = await pc.hub.sendPreview(ME, 'mine', pick)
    assert.ok(pv2.proposals[0].propose.items.some((x) => x.at === atOrder), JSON.stringify(pv2.proposals[0].propose))
    r = await pc.hub.sendPicked(ME, 'mine', pick)
    assert.deepEqual({ put: r.put, held: r.held, fail: r.fail, same: r.same }, { put: 1, held: undefined, fail: undefined, same: 0 }, JSON.stringify(r))
    assert.match(await secOf(), /통신/)
    const got = await recsOf()
    assert.equal(got.length, 2)
    assert.ok(got.every((w) => !['held', 'memo', 'pend'].includes(w.state)), got.map((w) => w.state).join())
    assert.equal((await pc.hub.sendView(ME, 'mine')).docs.find((d) => d.path === 'docs/점검.md').st, 'same')
    const lines = fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'apvs.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x))
    assert.ok(lines.some((x) => x.ch === 'send' && x.kit === 2 && x.mode === 'approve'), JSON.stringify(lines.slice(-2)))
    // ⑤ 옛 판 개인 프로그램(proposal 없음 · 판 없음) — E_APPROVE + 새 판 안내 · 아무것도 쓰지 않는다 · 판 없는 보내기를 센다
    const old = await fetch(`${s.url}/api/k/apvs/save`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${me.key}` }, body: JSON.stringify({ channel: 'send', record: { title: '옛 판 보내기', body: '글', tags: ['sent/00000000000000ef'], touchesEmpty: '시험' }, sections: [] }) })
    const oj = await old.json()
    assert.deepEqual([old.status, oj.error], [428, 'E_APPROVE'])
    assert.match(oj.message, /보내기 창에서 저장 제안을 승인/)
    assert.equal(oj.details?.update, undefined, '옛 판 안내는 걷었다(P11)')
    assert.equal((await recsOf()).length, 2)
    // ⑥ 개인 프로그램의 받기 갈래는 걷었다(저장 승인 P-D23)
    assert.equal(await code(pc.hub.receive(ME, 'mine', { from: 'x', items: [{ title: 't', body: 'b' }] })), 'E_INPUT')
  } finally {
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
    assert.deepEqual((await pc.hub.get('옛자료')).docs.map((d) => d.id).sort(), ['기록 모음', '배포 절차', '회의/10월'], '새 개인 지식은 기록 모음을 같이 세운다(저장 승인 PC1)')
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

test('지식 지우기: 이름을 그대로 써야 · 팀은 총괄 관리자만 · 보관 없이 폴더 · 살림까지 완전히', async () => {
  const dir = path.join(tmp, 'kn', 'inbox')
  const data = path.join(tmp, 'kn', '.kmd')
  assert.ok(fs.existsSync(dir))
  await assert.rejects(s.hub.deleteKnowledge(KIM, 'inbox', { confirm: '아무거나' }), { code: 'E_INPUT' })
  if (!s.auth.getUser?.('lee')) await s.auth.addUser({ id: 'lee', admin: false }).catch((e) => console.warn('lee', e.message))
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
