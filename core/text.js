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

// 목차 덩이를 뺀다 — 「머리 + 탭 · 점선 + 쪽 번호」 줄이 셋 넘게 이어지면(빈 줄은 사이에 둬도 된다) 본문 머리를 되풀이할 뿐이다.
//   한두 줄은 표의 줄일 수 있어 둔다(「포트\t502」)
const TOC_LINE = /^\S.{0,120}?(?:\t+|\s*(?:[.·…‥・]\s*){3,})\s*\d{1,4}$/
export function dropToc(text) {
  const lines = String(text ?? '').split('\n')
  const drop = new Set()
  for (let i = 0; i < lines.length; ) {
    if (!TOC_LINE.test(lines[i].trim())) { i++; continue }
    const run = []
    let j = i
    while (j < lines.length && (TOC_LINE.test(lines[j].trim()) || (!lines[j].trim() && TOC_LINE.test((lines[j + 1] || '').trim())))) {
      if (lines[j].trim()) run.push(j)
      j++
    }
    if (run.length >= 3) for (let x = i; x < j; x++) drop.add(x)
    i = j
  }
  return drop.size ? lines.filter((_, i) => !drop.has(i)).join('\n').replace(/\n{3,}/g, '\n\n') : String(text ?? '')
}

// 한 줄 칸 — 줄바꿈이 든 값은 받지 않는다(프런트매터 주입 막기)
export function oneLine(v) {
  return typeof v === 'string' && !/[\r\n]/.test(v)
}
