/*
 * A home’s print and its three words, as the phone draws them: copied from
 * althar-mobile's src/ui/geometry.ts (starsOf, printDots, wordsOf,
 * printSeed), unchanged, so the print beside the code here is the one the
 * phone shows when it reads that code. Pure, the same on every client given
 * the same seed.
 */

const clamp = (x: number) => Math.min(1, Math.max(0, x))
const fract = (x: number) => x - Math.floor(x)
const jitterOf = (i: number, n = 0) => fract(Math.sin(i * 12.9898 + n * 78.233 + 4.1) * 43758.5453)

const fnv = (seed: string) => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return h >>> 0
}
const mulberry = (start: number) => {
  let s = start
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rngOf = (seed: string, salt: string) => mulberry(fnv(seed + ':' + salt))

export interface Dot {
  readonly x: number
  readonly y: number
  readonly r: number
  readonly at: number
}

interface Star {
  readonly x: number
  readonly y: number
  readonly s: number
}

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax,
    dy = by - ay,
    t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Five stars round the home at the centre, joined by the shortest lines between them (Prim). */
const starsOf = (seed: string) => {
  const n = rngOf(seed, 'stars'),
    off = n() * Math.PI * 2,
    nodes: Star[] = [{ x: 30, y: 30, s: 0 }]
  for (let i = 0; i < 5; i++) {
    const a = off + (i / 5) * Math.PI * 2 + (n() - 0.5) * 0.95,
      d = 12 + n() * 13.5
    nodes.push({ x: 30 + d * Math.cos(a), y: 30 + d * Math.sin(a), s: 2.3 + n() * 2.4 })
  }
  const edges: Array<[number, number]> = [],
    inTree = [0]
  while (inTree.length < nodes.length) {
    let best: [number, number, number] | null = null
    for (const i of inTree)
      for (let j = 0; j < nodes.length; j++)
        if (!inTree.includes(j)) {
          const d = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y)
          if (!best || d < best[2]) best = [i, j, d]
        }
    edges.push([best![0], best![1]])
    inTree.push(best![1])
  }
  return { nodes, edges }
}

/** The print's dots, in a 60-unit box, on the mark's 15° lattice, lit from the upper left; they ripple out from the bore. */
export const printDots = (seed: string, pitch = 1.5): readonly Dot[] => {
  const { nodes, edges } = starsOf(seed)
  const tone = (x: number, y: number) => {
    for (let i = 1; i < nodes.length; i++) {
      const d = Math.hypot(x - nodes[i]!.x, y - nodes[i]!.y),
        r = nodes[i]!.s * 1.3
      if (d < r) return clamp(1 - (d / r) ** 2 * 0.78)
    }
    for (const [a, b] of edges) if (segDist(x, y, nodes[a]!.x, nodes[a]!.y, nodes[b]!.x, nodes[b]!.y) < 1.35) return 0.6
    return 0
  }
  const a15 = (15 * Math.PI) / 180,
    ca = Math.cos(a15),
    sa = Math.sin(a15),
    reach = Math.ceil(46 / pitch),
    dots: Dot[] = []
  for (let a = -reach; a <= reach; a++)
    for (let b = -reach; b <= reach; b++) {
      const x = 30 + (a * ca - b * sa) * pitch,
        y = 30 + (a * sa + b * ca) * pitch,
        dc = Math.hypot(x - 30, y - 30)
      if (dc > 29 || dc < 4.4) continue
      let t = dc < 7 ? 0.9 : Math.max(0.05, tone(x, y))
      t = Math.min(1, t * (0.58 + 0.42 * ((x + y) / 120)))
      dots.push({ x, y, r: (pitch / 2) * Math.sqrt(t) * 1.12, at: (dc / 29) * 560 + jitterOf(dots.length, 3) * 180 })
    }
  return dots
}

const WORDS =
  'acorn alder amber anchor apple arch aspen badge basil bay beacon birch bloom bolt bramble brook canyon cedar chalk cinder cliff cloud clover comet copper coral cove crane creek dawn delta dove dune elm ember fern fig finch fjord flint frost gale garnet glacier glade granite grove harbor hawk hazel heath heron hollow holly iris island ivory jade jasper juniper kelp kite lagoon lantern larch lark ledge lemon lily linen lotus lynx maple marble marsh meadow mesa mint moon moss nectar north oak ochre olive onyx opal orbit otter pearl pebble pine plume prairie quartz quill raven reed ridge river robin rowan saffron sage salt sand shore slate sparrow spruce stone summit swift thistle thyme tide timber topaz tulip tundra umber valley velvet walnut wave willow wren yarrow zephyr'.split(
    ' ',
  )

/** Three words for the print, for checking it by voice or with a screen reader. */
export const wordsOf = (seed: string) => {
  const n = rngOf(seed + 'stars', 'words')
  return [0, 1, 2].map(() => WORDS[Math.floor(n() * WORDS.length)]).join(' · ')
}

/** A home's print is drawn from its id and its key, so a changed key draws a different print. */
export const printSeed = (homeId: string, tlsKeyPin: string) => `${homeId}:${tlsKeyPin}`
