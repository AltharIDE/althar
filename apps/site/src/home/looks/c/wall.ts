import { seeded } from '../../../shared/footer/random'

/*
 * Prototype, C: the cabin's wall and its windows' sky, drawn once.
 *
 * The wall is isogrid, as a spacecraft's inner skin is milled: ribs in an
 * equilateral lattice, a boss at each node, the ribs lit from above (a
 * bright edge over, a shadow under). It comes in two strengths: faint, the
 * wall in the dark; and lit, where a screen's light falls on it.
 *
 * The sky is a tile of stars, most faint, a few bright with a soft glow.
 */

/** The lattice's tile: a rib's run across, the triangles' height twice. */
const W = 64
const H = 110

const svg = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`

/** The isogrid tile, its ribs, their lit edge and shadow, and the bosses at the nodes, in the colours given. */
export function isogrid({ rib, edge, shade, boss }: { rib: string; edge: string; shade: string; boss: string }) {
  const half = H / 2
  const ribs = `M0 0H${W}M0 ${half}H${W}M0 ${H}H${W}M0 0L${W} ${H}M${W} 0L0 ${H}`
  const nodes = [
    [0, 0],
    [W, 0],
    [W / 2, half],
    [0, H],
    [W, H],
  ]
  const at = (x: number, y: number, body: string) => `<g transform='translate(${x} ${y})'>${body}</g>`
  return svg(
    `<g fill='none'>` +
      `<path d='${ribs}' stroke='${shade}' stroke-width='1' transform='translate(0 1.75)'/>` +
      `<path d='${ribs}' stroke='${rib}' stroke-width='3'/>` +
      `<path d='${ribs}' stroke='${edge}' stroke-width='1' transform='translate(0 -1.75)'/>` +
      `</g>` +
      nodes
        .map(([x, y]) =>
          at(
            x!,
            y!,
            `<circle r='6' fill='${boss}'/>` +
              `<path d='M-5.2 -1.4A5.4 5.4 0 0 1 5.2 -1.4' fill='none' stroke='${edge}' stroke-width='1'/>` +
              `<path d='M-5.2 1.6A5.4 5.4 0 0 0 5.2 1.6' fill='none' stroke='${shade}' stroke-width='1'/>` +
              `<circle r='1.6' fill='${shade}'/>`,
          ),
        )
        .join(''),
    W,
    H,
  )
}

/** The wall in the dark, and where a screen's light falls on it. */
export const WALL = {
  dark: isogrid({
    rib: 'rgba(255,236,214,0.022)',
    edge: 'rgba(255,240,226,0.045)',
    shade: 'rgba(0,0,0,0.5)',
    boss: 'rgba(255,236,214,0.03)',
  }),
  lit: isogrid({ rib: 'rgba(150,164,255,0.04)', edge: 'rgba(170,182,255,0.12)', shade: 'rgba(0,0,0,0.6)', boss: 'rgba(150,164,255,0.05)' }),
}

/** A tile of stars, drawn once: `size` px square, its stars from `seed`, one to every `room` square px (the windows' sky is thick with them; the wall's night, as Orrery's, sparse). */
const skies = new Map<string, string>()
export function stars(seed = 7, size = 480, room = 1500) {
  const key = `${seed}:${size}:${room}`
  const known = skies.get(key)
  if (known) return known
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) return ''
  const r = seeded(seed)
  const count = Math.round((size * size) / room)
  for (let i = 0; i < count; i++) {
    const x = r() * size
    const y = r() * size
    // Most are faint; one in thirty bright, and those carry a glow.
    const bright = r() < 0.025
    const a = bright ? 0.7 + r() * 0.3 : 0.12 + r() ** 2 * 0.5
    const warm = r()
    const tint = warm < 0.25 ? '255,226,200' : warm > 0.8 ? '205,214,255' : '255,250,244'
    if (bright) {
      const halo = g.createRadialGradient(x, y, 0, x, y, 5)
      halo.addColorStop(0, `rgba(${tint},${(a * 0.35).toFixed(3)})`)
      halo.addColorStop(1, `rgba(${tint},0)`)
      g.fillStyle = halo
      g.fillRect(x - 5, y - 5, 10, 10)
    }
    g.fillStyle = `rgba(${tint},${a.toFixed(3)})`
    const s = bright ? 1.6 : r() < 0.3 ? 1.1 : 0.8
    g.beginPath()
    g.arc(x, y, s / 2 + 0.2, 0, Math.PI * 2)
    g.fill()
  }
  const url = `url(${canvas.toDataURL()})`
  skies.set(key, url)
  return url
}
