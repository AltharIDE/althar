import { useEffect, useLayoutEffect, useRef } from 'react'

import { arrive, type Box, boxIn, flyIn, holdBack, holdHeight, inView, land, landing, letGo, type Look, ringCard, SIGNAL } from './feel'
import s from './MergeFeel.module.css'

/*
 * What a merge feels like on the card it is merged from: the thread's small
 * change, a change on Outputs, a board card. Drawn last in the card, which
 * is positioned, it watches where the card says its merge stands and plays
 * each step as it comes (feel.ts): Merge itself answers the press
 * (MergeButton); going into the queue, it goes up as a dot into what in the
 * card says so, `data-merge-target`; landing, that fills with a small burst,
 * loud only for the first of many. Only what changes while the card is open
 * plays: come back to a merged card, and it is merged, still.
 */

/** Where a card's merge stands, as its feel reads it; null where nothing is the person's to merge yet. */
export type MergeFeelStage = 'ready' | 'merging' | 'queued' | 'merged'

export interface MergeFeelProps {
  stage: MergeFeelStage | null
  /** The press rings the whole card, as on a board card, whose strip is Merge across its width. */
  ringCard?: boolean
}

/** What it saw of the card while Merge was there to press: where Merge was, how it looked, and how tall the card was. */
interface Seen {
  readonly from: Box | null
  readonly look: Look | null
  readonly height: number
}

/** Merge, as the card has it: the button, or the two halves of a split one; where it was pressed, its answer. */
const mergeIn = (card: Element) => {
  const el = card.querySelector<HTMLElement>('[data-merge]')
  return el?.parentElement?.getAttribute('role') === 'group' ? el.parentElement : el
}

const lookOf = (el: HTMLElement): Look => {
  const style = getComputedStyle(el)
  return { background: style.backgroundColor, color: style.color, radius: style.borderTopLeftRadius }
}

function see(card: HTMLElement, layer: HTMLElement, stage: MergeFeelStage, before: Seen | null): Seen {
  const merge = mergeIn(card)
  // Its look once pressed, read the once: its colour then is the dot's.
  const pressed = stage === 'merging' && merge?.dataset.standing === 'merging'
  const look = before?.look ?? (pressed && merge !== null ? lookOf(merge) : null)
  return { from: merge === null ? (before?.from ?? null) : boxIn(merge, layer), look, height: card.offsetHeight }
}

const classes = { ghost: s.ghost, dot: s.dot }

function play(
  card: HTMLElement,
  layer: HTMLElement,
  before: MergeFeelStage | null,
  stage: MergeFeelStage | null,
  seen: Seen | null,
  rings: boolean,
) {
  const target = card.querySelector<HTMLElement>('[data-merge-target]')
  const pressed = before === 'ready' || before === 'merging'
  if (stage === 'merging' && before === 'ready') {
    if (rings) ringCard(card, layer, s.ring)
    return
  }
  if (stage !== 'queued' && stage !== 'merged') {
    letGo(card)
    return
  }
  if (!pressed && !(stage === 'merged' && before === 'queued')) return
  if (pressed && seen !== null) holdHeight(card, seen.height)
  const landNow = () => {
    if (stage !== 'merged' || target === null) return
    const { loud, delay } = landing(inView(card))
    land(card, layer, target, loud, delay, s.spark)
  }
  if (!pressed || target === null || seen?.from == null) {
    if (stage === 'queued' && target !== null) arrive(target, null)
    landNow()
    return
  }
  const words = target.dataset.mergeTarget === 'words'
  const b = boxIn(target, layer)
  const aim = words
    ? { x: b.x + 4, y: b.y + b.h / 2, size: 8 }
    : { x: b.x + b.w / 2, y: b.y + b.h / 2, size: Math.max(6, Math.min(b.w, b.h)) }
  // Its words wait for the dot; a merge that landed at once shows them landing.
  const held = words && stage === 'queued' ? holdBack(target) : null
  const look = seen.look ?? { ...SIGNAL, radius: seen.from.h > 26 ? '7px' : '6px' }
  void flyIn(layer, seen.from, look, aim, classes).then(() => (stage === 'queued' ? arrive(target, held) : landNow()))
}

/** Plays a merge's steps over the card it is drawn in, last, as the card's merge moves through them. */
export function MergeFeel({ stage, ringCard: rings = false }: MergeFeelProps) {
  const layer = useRef<HTMLSpanElement>(null)
  const was = useRef(stage)
  const seen = useRef<Seen | null>(null)
  // Before the frame is drawn: what went from the card is still where it was, as far as the person has seen.
  useLayoutEffect(() => {
    const here = layer.current
    const card = here?.parentElement
    if (here == null || card == null) return
    const before = was.current
    was.current = stage
    if (before !== stage) play(card, here, before, stage, seen.current, rings)
    if (stage === 'ready' || stage === 'merging') seen.current = see(card, here, stage, seen.current)
    else seen.current = null
  })
  // Gone with the card's height still held: let it go.
  useEffect(() => {
    const card = layer.current?.parentElement
    return () => {
      if (card != null) letGo(card)
    }
  }, [])
  return <span ref={layer} className={s.layer} aria-hidden="true" />
}
