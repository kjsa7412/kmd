#!/usr/bin/env node
// kmd-key — Claude Code 의 headersHelper. 자격 저장소에서 그 서버의 기기 열쇠를 꺼내 헤더 한 줄로 낸다.
//
//   "headersHelper": "kmd-key http://팀:7373"   →   {"Authorization":"Bearer kmdk_…"}
//
// 열쇠를 못 꺼내면 stderr 에 한 줄 · 종료 1(Claude Code 는 정적 헤더로 물러선다).
import { get, keyName } from '../../core/keystore.js'

const url = process.argv[2] || process.env.KMD_URL
try {
  if (!url) throw new Error('서버 주소가 없다')
  const key = await get(keyName(url))
  if (!key) throw new Error('없다')
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${key}` }))
} catch {
  process.stderr.write('이 PC 가 팀 kmd 에 이어져 있지 않다 — 팀 화면 › 설치 한 줄을 한 번 붙여 넣으면 된다\n')
  process.exit(1)
}
