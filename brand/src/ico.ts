/** A .ico holding one PNG, which every browser that asks for /favicon.ico understands. */
export function ico(png: Uint8Array, size: number): Uint8Array {
  const head = Buffer.alloc(22)
  head.writeUInt16LE(0, 0) // reserved
  head.writeUInt16LE(1, 2) // an icon
  head.writeUInt16LE(1, 4) // one image
  head.writeUInt8(size >= 256 ? 0 : size, 6)
  head.writeUInt8(size >= 256 ? 0 : size, 7)
  head.writeUInt16LE(1, 10) // colour planes
  head.writeUInt16LE(32, 12) // bits per pixel
  head.writeUInt32LE(png.length, 14)
  head.writeUInt32LE(22, 18) // where the image starts
  return Buffer.concat([head, png])
}
