// 시험용 오피스 파일 — 저장(압축 없음) zip · 작은 hwp(복합 파일). test/cost.test.mjs 와 같은 꼴(그 파일을 import 하면 그 시험이 같이 돈다)
import zlib from 'node:zlib'

export function storedZip(entries) {
  const locals = []
  const centrals = []
  let off = 0
  for (const [n, d] of entries) {
    const name = Buffer.from(n)
    const data = Buffer.from(d)
    const head = (central) => {
      const h = Buffer.alloc(central ? 46 : 30)
      h.writeUInt32LE(central ? 0x02014b50 : 0x04034b50, 0)
      const q = central ? 6 : 4
      h.writeUInt16LE(0x800, q + 2)
      h.writeUInt32LE(data.length, q + 14)
      h.writeUInt32LE(data.length, q + 18)
      h.writeUInt16LE(name.length, q + 22)
      if (central) h.writeUInt32LE(off, 42)
      return h
    }
    const l = Buffer.concat([head(false), name, data])
    centrals.push(Buffer.concat([head(true), name]))
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

export function fakeHwp(recs, { compress = false, prop = 0 } = {}) {
  const rec = (tag, level, data) => {
    const h = Buffer.alloc(4)
    h.writeUInt32LE(((tag & 0x3ff) | ((level & 0x3ff) << 10) | (data.length << 20)) >>> 0)
    return Buffer.concat([h, data])
  }
  const ch = (c) => {
    const one = c === 10 || c === 13
    const b = Buffer.alloc(one ? 2 : 16)
    b.writeUInt16LE(c, 0)
    if (!one) b.writeUInt16LE(c, 14)
    return b
  }
  const text = (parts) => Buffer.concat([...parts.map((p) => (typeof p === 'number' ? ch(p) : Buffer.from(p, 'utf16le'))), ch(13)])
  const u16s = (vals, size) => {
    const b = Buffer.alloc(size)
    for (const [at, v] of vals) b.writeUInt16LE(v, at)
    return b
  }
  const data = ([tag, , x]) =>
    tag === 67 ? text(x) : tag === 71 ? Buffer.from(x.split('').reverse().join('') + '\0\0\0\0', 'latin1') : tag === 72 ? u16s([[0, 1], [10, x[0]], [8, x[1]]], 34) : tag === 77 ? u16s([[4, x[0]], [6, x[1]]], 8) : Buffer.alloc(0)
  const body = Buffer.concat(recs.map((r) => rec(r[0], r[1], data(r))))
  const section = compress ? zlib.deflateRawSync(body) : body
  const head = Buffer.alloc(256)
  head.write('HWP Document File', 0, 'latin1')
  head.writeUInt32LE(prop | (compress ? 1 : 0), 36)
  const SS = 512
  const pad = (b) => Buffer.concat([b, Buffer.alloc((SS - (b.length % SS)) % SS)])
  const streams = [pad(head), pad(section)]
  const fat = new Array(SS / 4).fill(0xffffffff)
  fat[0] = 0xfffffffd
  fat[1] = 0xfffffffe
  let s = 2
  const starts = streams.map((b) => {
    const st = s
    const n = b.length / SS
    for (let i = 0; i < n; i++) fat[s + i] = i === n - 1 ? 0xfffffffe : s + i + 1
    s += n
    return st
  })
  const fatBuf = Buffer.alloc(SS)
  fat.forEach((v, i) => fatBuf.writeUInt32LE(v >>> 0, i * 4))
  const N = 0xffffffff
  const ent = (name, type, child, right, start, size) => {
    const e = Buffer.alloc(128)
    e.write(name, 0, 'utf16le')
    e.writeUInt16LE((name.length + 1) * 2, 64)
    e[66] = type
    e.writeUInt32LE(N, 68)
    e.writeUInt32LE(right >>> 0, 72)
    e.writeUInt32LE(child >>> 0, 76)
    e.writeUInt32LE(start >>> 0, 116)
    e.writeUInt32LE(size, 120)
    return e
  }
  const dir = Buffer.concat([ent('Root Entry', 5, 1, N, 0xfffffffe, 0), ent('FileHeader', 2, N, 2, starts[0], head.length), ent('BodyText', 1, 3, N, 0, 0), ent('Section0', 2, N, N, starts[1], section.length)])
  const hdr = Buffer.alloc(512)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(hdr, 0)
  hdr.writeUInt16LE(9, 30)
  hdr.writeUInt16LE(6, 32)
  hdr.writeUInt32LE(1, 44)
  hdr.writeUInt32LE(1, 48)
  hdr.writeUInt32LE(0, 56) // 작은 흐름 경계 0 — 모든 흐름을 보통 칸에
  hdr.writeUInt32LE(0xfffffffe, 60)
  hdr.writeUInt32LE(0xfffffffe, 68)
  for (let i = 0; i < 109; i++) hdr.writeUInt32LE(i === 0 ? 0 : N, 76 + i * 4)
  return Buffer.concat([hdr, fatBuf, pad(dir), ...streams])
}
