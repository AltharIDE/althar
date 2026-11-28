import { MOTION, reducedMotion } from './motion'

/*
 * What floats on the composer's edge changing shape in place, as the merging
 * pill opening into its card and folding back: read where everything there
 * stands just before the change (as drawn, mid-flight included), and once more
 * after it; then each piece glides from where it was, on the move spring.
 *
 * - `data-m="key"`: words or a mark, the same thing in both shapes (#1168, its
 *   dot, "Merging"). The real element moves and scales from where its match
 *   stood: by centres where marked `data-m-at="center"`, as a mark meets;
 *   otherwise by its left edge and middle, as words do.
 * - `data-m-box="key"`: a surface. It reshapes from its match's box to its
 *   own, at its true corner radius and shadow, never stretched.
 * - `data-m-in`: what only one shape has. It fades in once what travels has
 *   all but landed (the spring is most of the way in 150 ms), so a title never
 *   shows under a number still on its way. What goes fades out at once, from
 *   a still copy of what `data-m-ghost` marks (`="parent"`: its parent, where
 *   it is all the parent holds).
 * - Whatever else floats there and stays (the run chip, the goal) glides to
 *   where the change put it, rather than jumping.
 *
 * A press mid-way turns it back from where it is drawn. Only transform and
 * opacity move, but a surface's size, as SizeMotion's height does. With
 * reduced motion nothing travels; what comes and goes only fades.
 */

interface Piece {
  readonly rect: DOMRect
  readonly font: number
  readonly center: boolean
}
interface Box {
  readonly rect: DOMRect
  readonly radius: string
  readonly shadow: string
}
export interface EdgeShot {
  readonly pieces: ReadonlyMap<string, Piece>
  readonly boxes: ReadonlyMap<string, Box>
  readonly others: ReadonlyMap<Element, DOMRect>
  readonly ghosts: ReadonlyArray<{ readonly copy: HTMLElement; readonly rect: DOMRect }>
}

const ID = 'edge-morph'
const shown = (el: Element) => el.getClientRects().length > 0
const animates = (el: Element) => typeof (el as HTMLElement).animate === 'function'

/** Where a piece of the edge reads its neighbours from: the composer's floats, or the piece itself outside a composer. */
export const edgeOf = (el: Element | null): HTMLElement | null =>
  el?.closest<HTMLElement>('[data-composer-floats]') ?? (el instanceof HTMLElement ? el : null)

/** What else floats there: each slot's own children (carried, above, notice). */
const othersIn = (scope: HTMLElement) =>
  [...scope.querySelectorAll<HTMLElement>(':scope > * > *')].filter((el) => !el.matches('[data-m-ghost], [data-m-ghost] *'))

/** A still copy, hidden where it was hidden and as faded as it was drawn. */
const still = (el: HTMLElement) => {
  const copy = el.cloneNode(true) as HTMLElement
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')]
  const to = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  // A copy is the same tree, so each has its match at the same place.
  from.forEach((one, at) => {
    const into = to[at]!
    into.removeAttribute('id')
    if (!shown(one)) into.style.display = 'none'
    const opacity = getComputedStyle(one).opacity
    if (opacity !== '1') into.style.opacity = opacity
  })
  return copy
}

/** Where everything on the edge stands now, as drawn; null where nothing will move. */
export const shootEdge = (scope: HTMLElement | null): EdgeShot | null => {
  if (scope === null || !animates(scope)) return null
  const pieces = new Map<string, Piece>()
  for (const el of scope.querySelectorAll<HTMLElement>('[data-m]')) {
    if (!shown(el)) continue
    const rect = el.getBoundingClientRect()
    const drawn = el.offsetHeight > 0 ? rect.height / el.offsetHeight : 1
    pieces.set(String(el.dataset.m), {
      rect,
      font: Number.parseFloat(getComputedStyle(el).fontSize) * drawn,
      center: el.dataset.mAt === 'center',
    })
  }
  const boxes = new Map<string, Box>()
  for (const el of scope.querySelectorAll<HTMLElement>('[data-m-box]')) {
    if (!shown(el)) continue
    const style = getComputedStyle(el)
    boxes.set(String(el.dataset.mBox), { rect: el.getBoundingClientRect(), radius: style.borderRadius, shadow: style.boxShadow })
  }
  const others = new Map<Element, DOMRect>()
  for (const el of othersIn(scope)) if (shown(el)) others.set(el, el.getBoundingClientRect())
  const ghosts = [...scope.querySelectorAll<HTMLElement>('[data-m-ghost]')].flatMap((el) => {
    // Its parent where it is all the parent holds, as a notice of its own; otherwise only itself, so nothing else there is doubled.
    const source = el.dataset.mGhost === 'parent' && el.parentElement?.childElementCount === 1 ? el.parentElement : el
    return source === null || !shown(source) ? [] : [{ copy: still(source), rect: source.getBoundingClientRect() }]
  })
  return { pieces, boxes, others, ghosts }
}

const run = (el: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) => {
  el.animate(frames, timing).id = ID
}

const fadeIn = (el: HTMLElement) =>
  run(el, [{ opacity: 0 }, { opacity: 1 }], { ...MOTION.enter, delay: reducedMotion() ? 0 : 160, fill: 'backwards' })

let layer: HTMLElement | null = null
/** Where what goes fades: over the page, under nothing that takes a press. */
const ghostLayer = () => {
  if (layer?.isConnected === true) return layer
  layer = document.createElement('div')
  layer.className = 'ch-root'
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true
  Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: 'var(--z-float)', pointerEvents: 'none', background: 'none' })
  document.body.append(layer)
  return layer
}

/** Glides everything on the edge from where `shot` saw it to where it stands now. */
export const playEdge = (shot: EdgeShot, scope: HTMLElement | null) => {
  if (scope === null) return
  for (const one of scope.getAnimations({ subtree: true })) if (one.id === ID) one.cancel()
  ghostLayer().replaceChildren()
  const travel = !reducedMotion()
  const glide = { ...MOTION.move }
  const here = new Set<string>()

  for (const el of scope.querySelectorAll<HTMLElement>('[data-m]')) {
    if (!shown(el)) continue
    const key = String(el.dataset.m)
    here.add(key)
    const was = shot.pieces.get(key)
    if (was === undefined) {
      fadeIn(el)
      continue
    }
    if (!travel) continue
    const now = el.getBoundingClientRect()
    const scale = was.font / Number.parseFloat(getComputedStyle(el).fontSize)
    const center = was.center || el.dataset.mAt === 'center'
    const x = center ? was.rect.left + was.rect.width / 2 - (now.left + now.width / 2) : was.rect.left - now.left
    const y = was.rect.top + was.rect.height / 2 - (now.top + now.height / 2)
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(scale - 1) < 0.01) continue
    const origin = center ? '50% 50%' : '0 50%'
    run(
      el,
      [
        { transform: `translate(${x}px, ${y}px) scale(${scale})`, transformOrigin: origin },
        { transform: 'none', transformOrigin: origin },
      ],
      glide,
    )
  }

  for (const el of scope.querySelectorAll<HTMLElement>('[data-m-box]')) {
    if (!shown(el)) continue
    const key = String(el.dataset.mBox)
    here.add(`box:${key}`)
    const was = shot.boxes.get(key)
    if (was === undefined) {
      fadeIn(el)
      continue
    }
    if (!travel) continue
    const now = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    run(
      el,
      [
        {
          transform: `translate(${was.rect.left - now.left}px, ${was.rect.top - now.top}px)`,
          width: `${was.rect.width}px`,
          height: `${was.rect.height}px`,
          borderRadius: was.radius,
          boxShadow: was.shadow,
        },
        {
          transform: 'none',
          width: `${now.width}px`,
          height: `${now.height}px`,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
        },
      ],
      glide,
    )
  }

  for (const el of scope.querySelectorAll<HTMLElement>('[data-m-in]')) if (shown(el)) fadeIn(el)

  // What else floats there and stays glides to where the change put it.
  if (travel)
    for (const el of othersIn(scope)) {
      const was = shot.others.get(el)
      if (was === undefined || !shown(el)) continue
      const now = el.getBoundingClientRect()
      const x = was.left - now.left
      const y = was.top - now.top
      if (Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5) run(el, [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], glide)
    }

  // What only the shape before had goes from a still copy, quicker than what comes; what moved on is hidden in it.
  for (const { copy, rect } of shot.ghosts) {
    for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('[data-m], [data-m-box]')]) {
      const key = el.dataset.m ?? (el.dataset.mBox === undefined ? undefined : `box:${el.dataset.mBox}`)
      if (key !== undefined && here.has(key)) el.style.visibility = 'hidden'
    }
    Object.assign(copy.style, {
      position: 'absolute',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      transform: 'none',
    })
    ghostLayer().append(copy)
    const out = copy.animate([{ opacity: 1 }, { opacity: 0 }], { ...MOTION.exit, fill: 'forwards' })
    out.addEventListener('finish', () => copy.remove())
  }
}
