// 판 — package.json 하나에서 읽는다
import { readFileSync } from 'node:fs'

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
// 꾸러미 판 이름 — pack 이 build.json 에 적는다(<판>-<날짜>-<시각> · 예: 0.1.0-20261030-1015 · 꾸러미마다 다르고 뒤의 것이 늘 크다).
//   설치 한 줄이 이 이름으로 「이 PC 의 개인 프로그램이 팀 서버의 것보다 옛 판인가」 를 가린다 · 꾸러미가 아니면(개발 폴더) 판 그대로
export const BUILD = (() => { try { const b = JSON.parse(readFileSync(new URL('../build.json', import.meta.url), 'utf8')).build; return /^[0-9A-Za-z._-]{1,40}$/.test(String(b)) ? String(b) : VERSION } catch { return VERSION } })()
