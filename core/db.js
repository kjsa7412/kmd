// DB 카탈로그 — PostgreSQL 의 테이블 정의를 읽는다(감시 검토 v0.1 단계 3 · v0.6 §5).
//
//   붙기     읽기 전용 세션만(`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`) · 질의 15초 · 붙기 8초 ·
//            질의는 고정된 카탈로그 SELECT 뿐(pg_catalog) — 테이블의 행은 읽지 않는다
//   계정     읽기 전용 계정이어야 한다 — 슈퍼유저 · DB/역할 만들기 · 스키마 CREATE · 테이블 쓰기 권한 · 위험한 역할 멤버십
//            (pg_write_all_data · pg_read_server_files · pg_execute_server_program · pg_signal_backend)이 있으면 problems 에 적는다.
//            호출하는 쪽이 거절한다(시험 DB 만 serve.json `dbAllowUnsafeAccount` 로 넘긴다 — 그래도 세션은 읽기 전용)
//   읽기     스키마 하나의 테이블(r · p)마다 칸 · 형 · 널 · 키 · 설명 · 테이블 설명 · 앞머리 bak_ bk_ qrtz_ tmp_ stg_ 는 뺀다
//   지문     테이블마다 정의의 해시 — 감시 엔진이 바뀐 테이블만 안다

import crypto from 'node:crypto'
import pg from 'pg'
import { KmdError } from './errors.js'

const SKIP = /^(bak_|bk_|qrtz_|tmp_|stg_)/i
const WORD = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/

// postgres://user@host:port/db?schema=s → { host, port, database, user, schema }
export function parseDbUrl(at) {
  let u
  try { u = new URL(String(at)) } catch { throw new KmdError('E_INPUT', 'DB 주소가 아니다') }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new KmdError('E_INPUT', 'DB 는 PostgreSQL 만')
  const o = { host: u.hostname, port: Number(u.port || 5432), database: decodeURIComponent(u.pathname.slice(1)), user: decodeURIComponent(u.username), schema: u.searchParams.get('schema') || 'public' }
  if (!WORD.test(o.database) || !WORD.test(o.user) || !WORD.test(o.schema)) throw new KmdError('E_INPUT', 'DB 주소가 아니다')
  return o
}

export async function connect({ host, port, database, user, password }) {
  if (!password) throw new KmdError('E_AUTH', 'DB 비밀번호가 없다 — 이 PC 는 화면에서 · 팀 서버는 셸에서 kmd secret set')
  const c = new pg.Client({ host, port, database, user, password, connectionTimeoutMillis: 8000, statement_timeout: 15000, query_timeout: 20000, application_name: 'kmd-catalog' })
  try {
    await c.connect()
  } catch (e) {
    throw new KmdError('E_SOURCE', /password|auth/i.test(e.message) ? 'DB 계정 · 비밀번호가 맞지 않는다' : /does not exist/i.test(e.message) ? 'DB 이름이 없다' : 'DB 에 붙지 못했다')
  }
  c.on('error', () => {})
  await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  return c
}

// 계정 확인 — { super, problems: [쉬운 말] , writeTables }
export async function checkAccount(c, schema) {
  const q = async (s, a) => (await c.query(s, a)).rows
  const [role] = await q('select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user')
  const problems = []
  if (role?.rolsuper) problems.push('슈퍼유저다')
  if (role?.rolcreatedb) problems.push('DB 를 만들 수 있다')
  if (role?.rolcreaterole) problems.push('역할을 만들 수 있다')
  const [sc] = await q("select has_schema_privilege($1, 'CREATE') c", [schema])
  if (sc?.c) problems.push(`스키마 ${schema} 에 만들 수 있다`)
  const [w] = await q("select count(*)::int n from pg_class t join pg_namespace n on n.oid = t.relnamespace where n.nspname = $1 and t.relkind in ('r','p') and (has_table_privilege(t.oid,'INSERT') or has_table_privilege(t.oid,'UPDATE') or has_table_privilege(t.oid,'DELETE') or has_table_privilege(t.oid,'TRUNCATE'))", [schema])
  if (w?.n) problems.push(`테이블 ${w.n} 에 쓸 수 있다`)
  const risky = await q("select r.rolname from pg_roles r where r.rolname in ('pg_write_all_data','pg_read_server_files','pg_execute_server_program','pg_signal_backend') and pg_has_role(current_user, r.oid, 'MEMBER')")
  for (const r of risky) problems.push(`${r.rolname} 역할이 있다`)
  return { super: !!role?.rolsuper, writeTables: w?.n || 0, problems }
}

// 카탈로그 — Map(테이블 → { name, comment, cols, rows, hash })
export async function catalog(c, schema) {
  const rows = (await c.query(`select c.relname as tbl, obj_description(c.oid, 'pg_class') as tcomment, a.attnum, a.attname as col,
      format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn, col_description(c.oid, a.attnum) as ccomment,
      exists(select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary and a.attnum = any(i.indkey)) as pk
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
    where n.nspname = $1 and c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum`, [schema])).rows
  const out = new Map()
  const odd = new Set()
  for (const r of rows) {
    if (SKIP.test(r.tbl)) continue
    // 줄바꿈 · 제어 글자가 든 이름(실수로 만든 테이블 — 예: SQL 글이 이름이 된 것)은 머리가 될 수 없어 뺀다
    if (/[\u0000-\u001f]/.test(r.tbl) || r.tbl.trim() !== r.tbl) { odd.add(r.tbl); continue }
    if (!out.has(r.tbl)) out.set(r.tbl, { name: r.tbl, comment: (r.tcomment || '').replace(/\s+/g, ' ').trim().slice(0, 80), cols: ['칸', '형', '널', '키', '설명'], rows: [] })
    out.get(r.tbl).rows.push([r.col, r.typ, r.nn ? 'NOT NULL' : '', r.pk ? 'PK' : '', (r.ccomment || '').replace(/\s+/g, ' ').trim()])
  }
  for (const t of out.values()) t.hash = crypto.createHash('sha1').update(JSON.stringify([t.comment, t.rows])).digest('hex')
  out.odd = odd.size // 뺀 이상한 이름 수
  return out
}

// 한 번에 — 붙고 · 계정 확인 · 카탈로그 · 끊기
export async function readDb(conn, { allowUnsafe = false } = {}) {
  const c = await connect(conn)
  try {
    const acct = await checkAccount(c, conn.schema)
    if (acct.problems.length && !allowUnsafe) throw new KmdError('E_FORBIDDEN', `읽기 전용 계정이 아니다 — ${acct.problems.join(' · ')} · 읽기 전용 계정으로 바꾼다`)
    const tables = await catalog(c, conn.schema)
    return { acct, tables }
  } finally {
    await c.end().catch(() => {})
  }
}
