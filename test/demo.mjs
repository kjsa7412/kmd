// 시연 — 시험 지식(test/fixture/kmd)의 사본을 .kmd-data/demo 에 두고 팀 서버로 띄운다.
// 사본에 쓰므로 저장해 봐도 시험 지식은 그대로다. 처음 상태로: .kmd-data/demo 를 지운다.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { copyDir } from './helpers.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const demo = path.join(ROOT, '.kmd-data', 'demo')
if (!fs.existsSync(demo)) copyDir(path.join(ROOT, 'test', 'fixture', 'kmd'), demo)
spawn(process.execPath, [path.join(ROOT, 'server', 'bin', 'kmd.mjs'), 'serve', demo, '--user', '김', ...process.argv.slice(2)], { stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0))
