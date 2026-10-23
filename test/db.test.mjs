// 감시 단계 3 필수 — DB 카탈로그(실제 PostgreSQL 이 있을 때만).
//
// 접속 정보는 레포에 두지 않는다 — 환경변수 KMD_TEST_PG = postgres://계정:비밀번호@호스트:포트/DB(?schema=public) 로만 준다.
// 없으면 건너뛴다. DB 에는 읽기 전용 세션으로 카탈로그 SELECT 만 한다(쓰지 않는다).
//
// 계정은 가리지 않는다(슈퍼유저도) — 읽기 전용 세션으로 테이블마다 정의 표 · 이름 장부의 table:* 자리로 · 그대로면 0 · 지문이 다른 테이블만 「바뀐 테이블」 로 센다(같은 정의면 쓰지 않는다) · 연결 확인

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { setSecret } from '../core/secrets.js'
import { secretName } from '../core/sources.js'
import { parseDbUrl } from '../core/db.js'
import { readLedger, writeLedger } from '../core/watch.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = process.env.KMD_TEST_PG
let tmp, s, conn
const ADMIN = { user: 'kim', admin: true }

before(async () => {
  if (!PG) return
  const u = new URL(PG)
  conn = { ...parseDbUrl(`postgres://${u.username}@${u.host}${u.pathname}${u.search}`), password: decodeURIComponent(u.password) }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-db-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  // 이름 장부의 자리 — table:* 은 테이블정의서의 ## {값}
  fs.writeFileSync(path.join(tmp, 'kn', 'gdi', '_managed.md'), '# 자리 장부\n\n| 이름 | 문서 | 머리 |\n|---|---|---|\n| `table:*` | `docs/테이블정의서.md` | `## {값}` |\n')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('DB — 계정을 가리지 않고 테이블마다 정의 표(이름 장부 자리) · 바뀐 테이블만 · 가져옴은 이력으로', { skip: !PG && 'KMD_TEST_PG 가 없다' }, async () => {
  const name = '시험 DB'
  await setSecret(path.join(tmp, 'kn', '.kmd'), secretName('gdi', name), conn.password)
  const db = { host: conn.host, port: conn.port, database: conn.database, schema: conn.schema, user: conn.user }
  const ck = await s.hub.sourceCheckDb(ADMIN, 'gdi', { ...db, name })
  assert.equal(ck.login, true)
  assert.ok(ck.tables > 0)
  const t0 = Date.now()
  const r = await s.hub.sourceAdd(ADMIN, 'gdi', { name, kind: 'db', db, every: 'manual', rules: [{ rule: 'dbtables', into: { doc: '테이블 정의' } }] })
  const run = r.run[0]
  assert.equal(run.state, 'changed', run.why)
  assert.equal(run.n, ck.tables, '처음은 테이블마다 표')
  const doc = fs.readFileSync(path.join(tmp, 'kn', 'gdi', 'docs', '테이블정의서.md'), 'utf8')
  assert.match(doc, /<!-- baseline: src="시험 DB" rule=dbtables[^>]*-->\n\| 칸 \| 형 \| 널 \| 키 \| 설명 \|/)
  assert.equal((doc.match(/<!-- baseline: src="시험 DB"/g) || []).length, ck.tables, '이름 장부 자리(테이블정의서)로')
  assert.ok(Date.now() - t0 < 120000)
  // 가져옴은 기록이 아니라 이력(log/) — 기록(work/)에는 남지 않는다
  const logs = fs.readdirSync(path.join(tmp, 'kn', 'gdi', 'log'))
  assert.ok(logs.some((f) => f.includes('가져옴')), '가져옴은 이력으로')
  assert.ok(!(fs.existsSync(path.join(tmp, 'kn', 'gdi', 'work')) ? fs.readdirSync(path.join(tmp, 'kn', 'gdi', 'work')) : []).some((f) => f.includes('가져옴') || f.includes('가져오는-곳')), '기록에는 없다')

  // 그대로면 0
  assert.equal((await s.hub.sourceRun('gdi', name))[0].state, 'same')
  // 지문만 다른 테이블 하나(정의는 같다) — 「바뀐 테이블」 로 세지만 같은 정의라 쓰지 않는다
  const L = await readLedger(path.join(tmp, 'kn', '.kmd'), 'gdi', name)
  const one = Object.keys(L.files)[0]
  L.files[one].hash = 'x'
  await writeLedger(path.join(tmp, 'kn', '.kmd'), 'gdi', name, L)
  const before = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: path.join(tmp, 'kn', 'gdi'), encoding: 'utf8' }).trim()
  const r2 = (await s.hub.sourceRun('gdi', name))[0]
  assert.equal(r2.files, 1)
  assert.equal(r2.state, 'same')
  assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: path.join(tmp, 'kn', 'gdi'), encoding: 'utf8' }).trim(), before, '같은 정의면 묶음 0')
  const row = (await s.hub.sources(ADMIN, 'gdi')).find((x) => x.name === name)
  assert.match(row.state.lastNote, /테이블 \d+/)
})
