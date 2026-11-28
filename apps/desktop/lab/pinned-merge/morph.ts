import { MOTION, reducedMotion } from '@althar/ui'

/*
 * The pill's morph into its card and back, on the kit's motion. Read where
 * everything stands just before a change (as drawn, mid-flight included), and
 * once more after it; then each piece glides from where it was:
 *
 * - `data-m="key"`: words or a mark, the same thing in both states (#1168, its
 *   dot, "Merging"). The real element moves and scales from where its match
 *   stood (`data-m-at="center"` meets by centres, as a mark does; otherwise by
 *   its left edge and middle, as words do).
 * - `data-m-box="key"`: a surface. It reshapes from its match's box to its
 *   own, at its true corner radius and shadow, never stretched.
 * - `data-m-in`: what only one state has. It fades in once what travels has
 *   all but landed (the spring is most of the way in 150 ms), so a title never
 *   shows under a number still on its way; what goes fades out at once from a still copy
 *   (`data-m-ghost` marks what is copied; `="parent"` copies its parent).
 *
 * A press mid-way turns it back from where it is drawn. With reduced motion
 * nothing travels; what comes and goes only fades.
 */

interface Piece {
  rect: DOMRect
  font: number
  center: boolean
}
interface Box {
  rect: DOMRect
  radius: string
  shadow: string
}
export interface Shot {
  pieces: Map<string, Piece>
  boxes: Map<string, Box>
  ghosts: Array<{ copy: HTMLElement; rect: DOMRect }>
}

const ID = 'pill-morph'
const shown = (el: Element) => el.getClientRects().length > 0

/** A still copy of what it was, hidden where hidden and as faded as it was drawn. */
const still = (el: HTMLElement) => {
  const copy = el.cloneNode(true) as HTMLElement
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')]
  const to = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  from.forEach((one, at) => {
    const into = to[at]
    if (into === undefined) return
    into.removeAttribute('id')
    if (!shown(one)) into.style.display = 'none'
    const opacity = getComputedStyle(one).opacity
    if (opacity !== '1') into.style.opacity = opacity
  })
  return copy
}

/** Where everything stands now, as drawn. */
export const shoot = (scope: HTMLElement | null): Shot | null => {
  if (scope === null) return null
  const pieces = new Map<string, Piece>()
  const boxes = new Map<string, Box>()
  for (const el of scope.querySelectorAll<HTMLElement>('[data-m]')) {
    if (!shown(el)) continue
    const rect = el.getBoundingClientRect()
    const drawn = el.offsetHeight > 0 ? rect.height / el.offsetHeight : 1
    pieces.set(el.dataset.m ?? '', {
      rect,
      font: Number.parseFloat(getComputedStyle(el).fontSize) * drawn,
      center: el.dataset.mAt === 'center',
    })
  }
  for (const el of scope.querySelectorAll<HTMLElement>('[data-m-box]')) {
    if (!shown(el)) continue
    const style = getComputedStyle(el)
    boxes.set(el.dataset.mBox ?? '', { rect: el.getBoundingClientRect(), radius: style.borderRadius, shadow: style.boxShadow })
  }
  const ghosts = [...scope.querySelectorAll<HTMLElement>('[data-m-ghost]')].flatMap((el) => {
    const source = el.dataset.mGhost === 'parent' ? el.parentElement : el
    return source === null || !shown(source) ? [] : [{ copy: still(source), rect: source.getBoundingClientRect() }]
  })
  return { pieces, boxes, ghosts }
}

const run = (el: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) => {
  const animation = el.animate(frames, timing)
  animation.id = ID
  return animation
}

const fadeIn = (el: HTMLElement) =>
  run(el, [{ opacity: 0 }, { opacity: 1 }], {
    duration: MOTION.enter.duration,
    easing: MOTION.enter.easing,
    delay: reducedMotion() ? 0 : 160,
    fill: 'backwards',
  })

let layer: HTMLElement | null = null
const ghostLayer = () => {
  if (layer?.isConnected === true) return layer
  layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true
  Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: 'var(--z-float)', pointerEvents: 'none' })
  document.body.append(layer)
  return layer
}

/** Glides everything in `scope` from where `shot` saw it to where it stands now. */
export const play = (shot: Shot, scope: HTMLElement | null) => {
  if (scope === null) return
  for (const one of scope.getAnimations({ subtree: true })) if (one.id === ID) one.cancel()
  ghostLayer().replaceChildren()
  const travel = !reducedMotion()
  const glide = { duration: MOTION.move.duration, easing: MOTION.move.easing }
  const here = new Set<string>()

  for (const el of scope.querySelectorAll<HTMLElement>('[data-m]')) {
    if (!shown(el)) continue
    const key = el.dataset.m ?? ''
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
    const key = el.dataset.mBox ?? ''
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

  // What only the state before had goes from a still copy, quicker than what comes; what moved on is hidden in it.
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
