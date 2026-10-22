// 글 다듬기 — 읽는 경계에서 한 번만 한다.
//
// 파일은 BOM · CRLF 로 올 수 있다(Windows 편집기). 계산은 늘 LF 하나로 하고,
// 쓸 때도 LF 로 쓴다 — 같은 글이 줄 끝 때문에 「바뀜」 으로 보이지 않게.

import crypto from 'node:crypto'

export function readText(t) {
  return String(t ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

// 한글 이름은 NFC 하나로 다룬다(macOS 파일 이름은 NFD 로 올 수 있다)
export function nfc(s) {
  return typeof s === 'string' ? s.normalize('NFC') : s
}

// 글 지문 — 16자 sha256. 줄 끝 · 끝 공백을 맞춘 뒤 잰다(같은 글은 같은 지문)
export function sha16(t) {
  const norm = readText(t).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '')
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 16)
}

// 한 줄 칸 — 줄바꿈이 든 값은 받지 않는다(프런트매터 주입 막기)
export function oneLine(v) {
  return typeof v === 'string' && !/[\r\n]/.test(v)
}
