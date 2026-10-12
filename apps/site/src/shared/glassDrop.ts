/*
 * The nav's drop of glass: a small capsule of the lens's own glass under the
 * page or GitHub being pointed at, or tabbed to. It glides from one to the
 * next on a spring, settling with a breath past its mark, stretched a
 * little along the way it moves and squashed a little across it; it
 * gathers in where it first appears and fades out when nothing is held.
 * What passes under it is magnified, by as much as it is covered.
 *
 * Its width moves without its corners stretching: it is two halves, each
 * a box clipped at the middle with one rounded end of the capsule sliding
 * inside it, out to the width wanted. So the script writes only transforms
 * and opacity, a frame at a time and only while something moves. The
 * fading is the glass's own, not the drop's: an ancestor fading is a
 * backdrop of its own, and the glass would lose the page while it did.
 *
 * With reduced motion it appears where it is wanted, without gliding.
 */

/** Half the widest the drop is drawn: its halves' boxes. Keep with --drop-half in Nav.module.css. */
const HALF = 60
/** The glide's spring, per unit mass: about a third of a second, at a damping ratio of 0.75, so it settles just past and back. */
const STIFF = 300
const DAMP = 26
/** How fast it gathers in and fades out, in ms. */
const IN = 90
const OUT = 160
/** How much bigger what is fully under it shows. */
const MAGNIFY = 0.07
/** At most how far it stretches along its way and squashes across, at its quickest. */
const STRETCH = 0.12
const SQUASH = 0.08
/** Its narrowest: GitHub's circle. */
const LEAST = 34

export type GlassDrop = {
  /** What the pointer is on, or null once it has left the bar. */
  point(item: Element | null): void
  /** What has keyboard focus (shown as such), or null. */
  focus(item: Element | null): void
  stop(): void
}

type Item = { el: HTMLElement; centre: number; width: number }

export function glassDrop(row: HTMLElement, drop: HTMLElement): GlassDrop {
  const glass = [...drop.querySelectorAll<HTMLElement>('i')]
  const fall = drop.querySelector<HTMLElement>('b')
  let items: Item[] = []
  let pointed: Element | null = null
  let focused: Element | null = null
  // Where it is and is going: its centre and width in the row's box, how much it shows (0 to 1).
  let x = 0
  let w = 0
  let vx = 0
  let vw = 0
  let shown = 0
  let toX = 0
  let toW = 0
  let toShown = 0
  let frame = 0
  let last = 0

  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** Where each item is, untransformed: offsets ignore the magnifying. */
  const measure = () => {
    items = [...row.querySelectorAll<HTMLElement>('[data-drop]')].map((el) => {
      let left = 0
      for (let at: HTMLElement | null = el; at && at !== row; at = at.offsetParent as HTMLElement | null) left += at.offsetLeft
      return { el, centre: left + el.offsetWidth / 2, width: el.offsetWidth }
    })
  }

  const draw = () => {
    const speed = Math.min(Math.abs(vx) / 2400, 1)
    const gather = still() ? 1 : 0.82 + 0.18 * shown
    const along = gather * (1 + STRETCH * speed)
    const across = gather * (1 - SQUASH * speed)
    // On whole device pixels, so the line where the halves meet (its middle, which stretching doesn't move) is sharp.
    const pixel = window.devicePixelRatio || 1
    const left = Math.round((x - HALF) * pixel) / pixel
    drop.style.transform = `translate3d(${left}px, 0, 0) scale(${along.toFixed(4)}, ${across.toFixed(4)})`
    const reach = Math.max(0, HALF - w / 2).toFixed(2)
    if (glass[0]) glass[0].style.transform = `translate3d(${reach}px, 0, 0)`
    if (glass[1]) glass[1].style.transform = `translate3d(-${reach}px, 0, 0)`
    for (const g of glass) g.style.opacity = shown.toFixed(3)
    if (fall) {
      fall.style.transform = `scaleX(${(w / 60).toFixed(4)})`
      fall.style.opacity = shown.toFixed(3)
    }
    // What is under it, by how much of the narrower of the two the other covers.
    for (const item of items) {
      const over = Math.min(x + w / 2, item.centre + item.width / 2) - Math.max(x - w / 2, item.centre - item.width / 2)
      const k = over > 0 ? (over / Math.min(w, item.width)) * shown : 0
      item.el.style.transform = k > 0.001 ? `scale(${(1 + MAGNIFY * k).toFixed(4)})` : ''
    }
  }

  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30)
    last = now
    // The spring, in steps short enough to stay steady at any frame rate.
    const steps = Math.ceil(dt / (1 / 240))
    for (let n = 0; n < steps; n++) {
      const h = dt / steps
      vx += (STIFF * (toX - x) - DAMP * vx) * h
      vw += (STIFF * (toW - w) - DAMP * vw) * h
      x += vx * h
      w += vw * h
    }
    shown += (toShown - shown) * (1 - Math.exp((-dt * 1000) / (toShown > shown ? IN : OUT)))
    const settled =
      Math.abs(toX - x) < 0.05 && Math.abs(vx) < 0.5 && Math.abs(toW - w) < 0.05 && Math.abs(vw) < 0.5 && Math.abs(toShown - shown) < 0.004
    if (settled) {
      x = toX
      w = toW
      vx = vw = 0
      shown = toShown
    }
    draw()
    frame = settled ? 0 : requestAnimationFrame(tick)
  }

  const run = () => {
    if (frame) return
    last = performance.now()
    frame = requestAnimationFrame(tick)
  }

  /** Go to what is pointed at, or else what is focused, or fade where it is. */
  const aim = () => {
    const el = pointed ?? focused
    const item = el && items.find((i) => i.el === el)
    if (!item || !item.width) {
      toShown = 0
      return run()
    }
    toX = item.centre
    toW = Math.max(LEAST, item.width)
    // From nothing, or with reduced motion, it appears in place.
    if (shown < 0.05 || still()) {
      x = toX
      w = toW
      vx = vw = 0
    }
    toShown = 1
    run()
  }

  const remeasure = () => {
    measure()
    if (toShown) aim()
  }
  measure()
  window.addEventListener('resize', remeasure)
  // The pages' widths settle once the fonts have.
  void document.fonts?.ready.then(remeasure)

  return {
    point(item) {
      if (item === pointed) return
      pointed = item
      if (item && !items.some((i) => i.el === item)) measure()
      aim()
    },
    focus(item) {
      if (item === focused) return
      focused = item
      aim()
    },
    stop() {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', remeasure)
    },
  }
}
