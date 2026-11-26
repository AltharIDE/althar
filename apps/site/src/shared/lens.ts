/*
 * The home bar's drop as a lens: a displacement map for its capsule, read by
 * the SVG filter its backdrop goes through (Bar.tsx). Near its edge each
 * point shows what lies a little further out, more so the nearer the edge,
 * as light bends round the rim of a drop of glass; its middle stays true.
 * So what is under its rim is drawn in towards the middle, squeezed, never
 * folded back on itself: a word passing under its ends bends, and doesn't
 * double. Its straight top and foot don't bend.
 *
 * Red carries the shift across and green the shift down, half way (128)
 * being none. Drawn once per width the drop takes, and kept.
 */

/** How far in from the rim the bending reaches, in px. */
const EDGE = 9

const made = new Map<string, string>()

/** The map for a capsule `w` by `h` px, as a data URL. */
export function lensMap(w: number, h: number): string {
  const key = `${w}x${h}`
  const kept = made.get(key)
  if (kept) return kept
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (!g) return ''
  const image = g.createImageData(w, h)
  const r = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // From the capsule's spine, the nearest point on it, and how far inside the rim this point is.
      const px = x + 0.5
      const py = y + 0.5
      const vx = px - Math.min(w - r, Math.max(r, px))
      const vy = py - r
      const out = Math.hypot(vx, vy)
      const inside = r - out
      let dx = 0
      let dy = 0
      if (inside > 0 && inside < EDGE && out > 0) {
        // Only round its ends, fading out where they meet its straight top and foot: what sits along those (the point under the page being read) stays true.
        const k = (1 - inside / EDGE) ** 2 * (Math.abs(vx) / out)
        dx = (vx / out) * k
        dy = (vy / out) * k
      }
      const i = (y * w + x) * 4
      image.data[i] = 128 + dx * 127
      image.data[i + 1] = 128 + dy * 127
      image.data[i + 2] = 128
      image.data[i + 3] = 255
    }
  }
  g.putImageData(image, 0, 0)
  const url = canvas.toDataURL()
  made.set(key, url)
  return url
}
