import { qrcodegen } from '../../lib/qrcodegen/qrcodegen.js'

/** A QR's modules: dark or not, `size` square, at error correction L (a screen's code is clean; L keeps it least dense). */
export interface QrMatrix {
  readonly size: number
  readonly dark: (x: number, y: number) => boolean
}

export const qrOf = (text: string): QrMatrix => {
  const code = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.LOW)
  return { size: code.size, dark: (x, y) => code.getModule(x, y) }
}

/** One SVG path for every dark module, with a quiet zone of `quiet` modules around. */
export const qrPath = (matrix: QrMatrix, quiet: number) => {
  let d = ''
  for (let y = 0; y < matrix.size; y++)
    for (let x = 0; x < matrix.size; x++) if (matrix.dark(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`
  return d
}
