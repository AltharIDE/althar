import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { arrivesQuietly } from '../../lib/arrivals'
import { registerVirtualThread, type VirtualStop } from '../../lib/virtual'

/*
 * A long thread's blocks, drawn only near the view: what is on screen, and
 * about a screen above and below it. A block further off is a gap of its
 * height, as last measured, or as the blocks measured so far suggest, so the
 * scrollbar stays true and the thread opens, scrolls and switches as fast
 * with two thousand messages as with twenty (DEV-57).
 *
 * The blocks stay the thread's own children, as they would be drawn whole:
 * each comes after a blank text node, which neither CSS's sibling rules nor
 * layout see, and which says where the block starts. So the thread's rhythm
 * (Thread.module.css) spaces them as before. A gap takes the rhythm of the
 * block it stands after, so what follows it is spaced as it would be.
 *
 * What it keeps working: a reply streaming in place, the thread following its
 * bottom (useStickToBottom sees the column grow, as ever), a block that grows
 * (measured again as it does), what the person has selected or has focus in
 * (kept drawn while they do, and every block a selection spans drawn as it is
 * copied, so Select All copies the whole thread), the navigator's stops and a
 * search or link that
 * takes the person to an item (`lib/virtual`, which draws its block first).
 */

export interface VirtualBlocksProps {
  /** How many blocks the thread has. */
  count: number
  /** A block's key, which stays with it as blocks come before or after it. */
  keyOf: (index: number) => string
  /** Draws a block: whatever it draws stands in the thread's column, as it would drawn whole. */
  render: (index: number) => ReactNode
  /** Whether a block holds an item, by its id: so a search or a link can bring it into view. */
  holds?: (index: number, itemId: string) => boolean
  /** What the person said where a block is theirs, and the start of what answered it: the navigator's stops. */
  stopOf?: (index: number) => { readonly prompt: string; readonly reply: string } | null
  /** What its blocks' heights are kept under, so the thread opened again is laid out as it was: its id. */
  memory?: string
}

interface Size {
  /** The space above it, its first element's margin. */
  readonly lead: number
  /** From its first element's top to its last's bottom. */
  readonly height: number
  /** Its last element's rhythm, which what follows it is spaced by. */
  readonly rhythm: string | null
  /** It draws nothing. */
  readonly empty: boolean
}

/** A block not measured yet, before any is: about a short exchange's turn. */
const ESTIMATE = 160
/** How far beyond the view it draws, at least, in px. */
const OVERSCAN = 900
/** What starts each block: a newline, which a block container lays out as nothing. */
const MARK = '\n'
/** How far from the bottom still counts as at it, as useStickToBottom's. */
const SLACK = 90
/** Threads whose heights are kept, at most. */
const MEMORIES = 40

const memories = new Map<string, Map<string, Size>>()
const sizesFor = (memory: string | undefined) => {
  if (memory === undefined) return new Map<string, Size>()
  const kept = memories.get(memory)
  if (kept !== undefined) {
    memories.delete(memory)
    memories.set(memory, kept)
    return kept
  }
  const made = new Map<string, Size>()
  memories.set(memory, made)
  while (memories.size > MEMORIES) memories.delete(memories.keys().next().value!)
  return made
}

const scrollerOf = (el: Element | null) => {
  let box = el?.parentElement ?? null
  while (box !== null && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
  return box
}

/** The first index whose start is past `at`, less one: the block at `at`. */
const blockAt = (prefix: Float64Array, count: number, at: number) => {
  let low = 0
  let high = count
  while (low < high) {
    const mid = (low + high) >> 1
    if (prefix[mid + 1]! <= at) low = mid + 1
    else high = mid
  }
  return Math.min(low, Math.max(count - 1, 0))
}

/** Where the person left the view: how far it was scrolled, and the blocks in view, each where it was in the content. */
interface Place {
  at: number
  readonly blocks: ReadonlyArray<{ readonly key: string; offset: number }>
}

interface Window {
  /** The first block drawn; null while it follows the bottom, from wherever that makes it. */
  readonly from: string | null
  /** The last block drawn; null for the thread's last, whichever that is as blocks come. */
  readonly to: string | null
}

interface Plan {
  readonly keys: ReadonlyArray<string>
  readonly indexOf: ReadonlyMap<string, number>
  prefix: Float64Array
  readonly runs: ReadonlyArray<readonly [number, number]>
  readonly start: number
  readonly end: number
  stops: ReadonlyArray<VirtualStop> | null
}

export function VirtualBlocks({ count, keyOf, render, holds, stopOf, memory }: VirtualBlocksProps) {
  const sizes = useMemo(() => sizesFor(memory), [memory])
  const [win, setWin] = useState<Window>({ from: null, to: null })
  /** Blocks kept drawn beside the window: what holds focus or a selection, and one being brought into view. */
  const [held, setHeld] = useState<ReadonlyArray<readonly [string, string]>>([])
  const [, redraw] = useState(0)
  const plan = useRef<Plan | null>(null)
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const keys: string[] = []
  for (let i = 0; i < count; i++) keys.push(keyOf(i))
  const indexOf = new Map(keys.map((key, i) => [key, i]))
  let measured = 0
  let total = 0
  for (const key of keys) {
    const size = sizes.get(key)
    if (size !== undefined && !size.empty) {
      measured++
      total += size.lead + size.height
    }
  }
  const estimate = measured === 0 ? ESTIMATE : total / measured
  const prefix = new Float64Array(count + 1)
  for (let i = 0; i < count; i++) {
    const size = sizes.get(keys[i]!)
    prefix[i + 1] = prefix[i]! + (size === undefined ? estimate : size.lead + size.height)
  }
  // A block's key can change as an earlier page joins it (a turn is keyed by its first item): the window then holds to
  // the nearest block whose key stayed, as it was drawn last.
  const prior = plan.current
  const resolve = (key: string, step: 1 | -1) => {
    const i = indexOf.get(key)
    if (i !== undefined || prior === null) return i
    for (let j = prior.indexOf.get(key) ?? -1; j >= 0 && j < prior.keys.length; j += step) {
      const k = indexOf.get(prior.keys[j]!)
      if (k !== undefined) return k
    }
    return undefined
  }
  const end = win.to === null ? count - 1 : (resolve(win.to, -1) ?? count - 1)
  const fromBottom = () => {
    const span = 2 * (typeof window === 'undefined' ? 800 : window.innerHeight || 800)
    let i = end
    while (i > 0 && prefix[end + 1]! - prefix[i]! < span) i--
    return Math.max(i, 0)
  }
  const found = win.from === null ? undefined : resolve(win.from, 1)
  const start = found === undefined || found > end ? fromBottom() : found
  const spans: Array<[number, number]> = count === 0 ? [] : [[start, end]]
  for (const [a, b] of held) {
    const i = indexOf.get(a)
    const j = indexOf.get(b)
    if (i !== undefined && j !== undefined) spans.push([Math.min(i, j), Math.max(i, j)])
  }
  spans.sort((a, b) => a[0] - b[0])
  const runs: Array<[number, number]> = []
  for (const span of spans) {
    const last = runs.at(-1)
    if (last !== undefined && span[0] <= last[1] + 1) last[1] = Math.max(last[1], span[1])
    else runs.push([span[0], span[1]])
  }

  /** The host's questions, as it asks them now, for the listeners set up once. */
  const asks = useRef({ holds, stopOf })
  const current: Plan = { keys, indexOf, prefix, runs, start, end, stops: null }
  /** The thread follows its bottom, as it does on opening, until the person scrolls up from it. */
  const following = useRef(true)
  /** Where the view was last scrolled to, the person's way or the list's own: a move up from it leaves the bottom. */
  const lastTop = useRef(0)
  /** How far the view was from the bottom as the person or the list last scrolled it: kept, following, as blocks come. */
  const below = useRef(Number.POSITIVE_INFINITY)
  /** Where to put a block once it is drawn: its key and how far under the scroller's top. */
  const placing = useRef<{ key: string; offset: number } | null>(null)
  /**
   * The block in view as the person last left it, and how far under the scroller's top it was: kept there as the thread
   * draws, measures, or gains earlier pages above it, unless it follows its bottom.
   */
  const place = useRef<Place>({ at: 0, blocks: [] })
  /** Blocks drawn before, so one drawn again doesn't rise in as if it had just arrived. */
  const seen = useRef(new Set<string>())
  /** The thread's last block as it was last drawn: blocks after it are new. */
  const lastDrawn = useRef<string | undefined>(undefined)
  const [listeners] = useState(() => new Set<() => void>())
  /** The elements each drawn block is made of, by its key, and each element's block. */
  const elements = useRef(new Map<string, Element[]>())
  const blockOf = useRef(new WeakMap<Element, string>())
  const resize = useRef<ResizeObserver | null>(null)

  /** The drawn blocks' elements, read from the thread between the first gap and the last. */
  const read = () => {
    const now = plan.current
    const first = top.current
    const last = bottom.current
    elements.current = new Map()
    const gaps: HTMLElement[] = []
    if (now === null || first === null || last === null) return gaps
    const order = now.runs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k))
    let at = -1
    for (let node = first.nextSibling; node !== null && node !== last; node = node.nextSibling) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue === MARK) {
        at++
        const key = now.keys[order[at]!]
        if (key !== undefined) elements.current.set(key, [])
      } else if (node instanceof HTMLElement && node.hasAttribute('data-virtual-gap')) gaps.push(node)
      else if (node instanceof Element) {
        const key = now.keys[order[at]!]
        if (key === undefined) continue
        elements.current.get(key)?.push(node)
        blockOf.current.set(node, key)
      }
    }
    return gaps
  }

  /** Sets each gap's height, and its rhythm, from what is known of the blocks it stands for. */
  const layGaps = (gaps: ReadonlyArray<HTMLElement>) => {
    const now = plan.current
    if (now === null || top.current === null || bottom.current === null) return
    const rhythmBefore = (i: number) => {
      for (let j = i - 1; j >= 0; j--) {
        const size = sizes.get(now.keys[j]!)
        if (size === undefined) return null
        if (!size.empty) return size.rhythm
      }
      return null
    }
    const lay = (gap: HTMLElement, from: number, to: number) => {
      const height = Math.max(now.prefix[to]! - now.prefix[from]!, 0)
      gap.style.height = `${height}px`
      const rhythm = height === 0 ? ((gap.previousElementSibling as HTMLElement | null)?.dataset.rhythm ?? null) : rhythmBefore(to)
      if (rhythm === null) gap.removeAttribute('data-rhythm')
      else gap.setAttribute('data-rhythm', rhythm)
    }
    const { runs: drawnRuns } = now
    const count = now.keys.length
    lay(top.current, 0, drawnRuns[0]?.[0] ?? count)
    gaps.forEach((gap, k) => lay(gap, drawnRuns[k]![1] + 1, drawnRuns[k + 1]![0]))
    lay(bottom.current, drawnRuns.length === 0 ? count : drawnRuns.at(-1)![1] + 1, count)
  }

  /** Measures the drawn blocks; whether any changed. */
  const measure = () => {
    let changed = false
    for (const [key, els] of elements.current) {
      const first = els[0]
      const last = els.at(-1)
      const size: Size =
        first === undefined || last === undefined
          ? { lead: 0, height: 0, rhythm: null, empty: true }
          : {
              lead: Number.parseFloat(getComputedStyle(first).marginTop) || 0,
              height: last.getBoundingClientRect().bottom - first.getBoundingClientRect().top,
              rhythm: last.getAttribute('data-rhythm'),
              empty: false,
            }
      const was = sizes.get(key)
      if (
        was === undefined ||
        Math.abs(was.lead - size.lead) > 0.5 ||
        Math.abs(was.height - size.height) > 0.5 ||
        was.rhythm !== size.rhythm ||
        was.empty !== size.empty
      ) {
        sizes.set(key, size)
        changed = true
      }
    }
    if (changed && plan.current !== null) {
      const now = plan.current
      const guess = estimateOf(now.keys)
      for (let i = 0; i < now.keys.length; i++) {
        const size = sizes.get(now.keys[i]!)
        now.prefix[i + 1] = now.prefix[i]! + (size === undefined ? guess : size.lead + size.height)
      }
    }
    return changed
  }

  const estimateOf = (all: ReadonlyArray<string>) => {
    let n = 0
    let sum = 0
    for (const key of all) {
      const size = sizes.get(key)
      if (size !== undefined && !size.empty) {
        n++
        sum += size.lead + size.height
      }
    }
    return n === 0 ? ESTIMATE : sum / n
  }

  /** Whether the thread shows: hidden (a kept screen, React's Activity), nothing is measured or moved. */
  const showing = (scroller: HTMLElement | null): scroller is HTMLElement =>
    scroller !== null && scroller.clientHeight > 0 && (top.current?.getClientRects().length ?? 0) > 0

  /** Where an element's top is in the scroller's content, however far it is scrolled. */
  const offsetIn = (scroller: HTMLElement, el: Element) =>
    el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop

  /**
   * The first drawn block in view and the one after it, each with where its top is in the scroller's content: two, as
   * the first may be keyed again by the time it is kept in place.
   */
  const inView = (scroller: HTMLElement): Place => {
    const edge = scroller.getBoundingClientRect().top
    const found: Array<{ key: string; offset: number }> = []
    for (const [key, els] of elements.current) {
      const first = els[0]
      if (first === undefined) continue
      if (found.length > 0 || els.at(-1)!.getBoundingClientRect().bottom > edge) found.push({ key, offset: offsetIn(scroller, first) })
      if (found.length === 2) break
    }
    return { at: scroller.scrollTop, blocks: found }
  }

  /**
   * Moves the view with a block that moved in the content, as what is above it was drawn or measured, so it stays where
   * the person saw it. Only the content moving moves it, and only where nothing else moved the view since: a scroll of
   * the person's own not yet heard, a jump to the bottom, or what "Show earlier" keeps in place itself.
   */
  const keep = (scroller: HTMLElement, place: Place) => {
    if (Math.abs(scroller.scrollTop - place.at) >= 1) return
    for (const one of place.blocks) {
      const first = elements.current.get(one.key)?.[0]
      if (first === undefined) continue
      const offset = offsetIn(scroller, first)
      const moved = offset - one.offset
      // Kept where it now is, so it moves the view once for each move of its own.
      one.offset = offset
      if (Math.abs(moved) >= 0.5) scrollTo(scroller, scroller.scrollTop + moved)
      place.at = scroller.scrollTop
      return
    }
  }

  /** Scrolls the view itself: not a move of the person's, so it neither leaves the bottom nor comes to it. */
  const scrollTo = (scroller: HTMLElement, to: number) => {
    scroller.scrollTop = to
    lastTop.current = scroller.scrollTop
  }

  const toBottom = (scroller: HTMLElement) => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

  /**
   * Counts a scroll of the person's own that the list hasn't heard yet, as it is about to move the view: one made in this
   * frame, whose event comes later. Following the bottom, a move up from it keeps its distance, or leaves it past the
   * slack; reckoned from the move itself, as what was just drawn may have changed the thread's height.
   */
  const hear = (scroller: HTMLElement) => {
    const moved = lastTop.current - scroller.scrollTop
    if (!following.current || Math.abs(moved) < 1) return
    lastTop.current = scroller.scrollTop
    const was = Math.max(below.current + moved, 0)
    if (moved > 0 && was >= SLACK) following.current = false
    below.current = was
  }

  /**
   * Following the bottom, the view stays as near it as it was as what is drawn changes height above it: at it, or a
   * nudge up from it the person made; and goes to it from further, as on opening (useStickToBottom's rule).
   */
  const down = (scroller: HTMLElement) => {
    hear(scroller)
    if (!following.current) return
    const was = below.current
    const to = was < SLACK ? was : 0
    if (Math.abs(toBottom(scroller) - to) >= 1) scrollTo(scroller, scroller.scrollHeight - scroller.clientHeight - to)
    below.current = toBottom(scroller)
  }

  /** Measures what is drawn and lays the gaps from it, keeping what is in view where it is. */
  const settle = (scroller: HTMLElement, gaps: ReadonlyArray<HTMLElement>) => {
    hear(scroller)
    layGaps(gaps)
    // What was in view stays there, unless the thread follows its bottom, where it stays.
    if (!following.current) keep(scroller, place.current)
    if (measure()) {
      layGaps(gaps)
      if (!following.current) keep(scroller, place.current)
    }
    const wanted = placing.current
    const first = wanted === null ? undefined : elements.current.get(wanted.key)?.[0]
    if (wanted !== null && first !== undefined) {
      placing.current = null
      scrollTo(scroller, scroller.scrollTop + first.getBoundingClientRect().top - scroller.getBoundingClientRect().top - wanted.offset)
    }
    if (following.current)
      // Once the commit is over, before the frame is drawn: what moves a message in place (ListMotion) reads where each
      // stands as the commit ends, and the view following the bottom isn't a message moving.
      queueMicrotask(() => {
        if (!following.current || !showing(scroller)) return
        down(scroller)
        place.current = inView(scroller)
      })
    else below.current = toBottom(scroller)
    place.current = inView(scroller)
    const observer = resize.current
    if (observer !== null) {
      observer.disconnect()
      for (const els of elements.current.values()) for (const el of els) observer.observe(el)
    }
  }

  /** Moves the window where the view needs blocks it doesn't have, or has far more than it needs. */
  const check = () => {
    const now = plan.current
    const scroller = scrollerOf(top.current)
    if (now === null || !showing(scroller) || top.current === null) return
    const count = now.keys.length
    if (count === 0) return
    const origin = top.current.getBoundingClientRect().top
    const rect = scroller.getBoundingClientRect()
    const viewTop = rect.top - origin
    const viewBottom = rect.bottom - origin
    const over = Math.max(OVERSCAN, scroller.clientHeight)
    const from = now.prefix[now.start]!
    const to = now.prefix[now.end + 1]!
    const covered = (now.start === 0 || from <= viewTop - over / 3) && (now.end === count - 1 || to >= viewBottom + over / 3)
    const lean = to - from <= viewBottom - viewTop + 4 * over
    if (covered && lean) return
    const first = blockAt(now.prefix, count, Math.max(viewTop - over, 0))
    const last = blockAt(now.prefix, count, viewBottom + over)
    const next: Window = { from: now.keys[first]!, to: last >= count - 1 ? null : now.keys[last]! }
    setWin((was) => (was.from === next.from && was.to === next.to ? was : next))
  }

  const bring = (key: string, offset: number) => {
    const now = plan.current
    const i = now?.indexOf.get(key)
    if (now === undefined || now === null || i === undefined) return
    const count = now.keys.length
    const first = Math.max(i - 2, 0)
    const last = i + 4
    placing.current = { key, offset }
    following.current = false
    setWin({ from: now.keys[first]!, to: last >= count - 1 ? null : now.keys[last]! })
    redraw((n) => n + 1)
  }

  // The latest plan, for what runs after: listeners, the gaps' heights, the registry.
  useLayoutEffect(() => {
    plan.current = current
    asks.current = { holds, stopOf }
  })

  // Each time it draws: what came in on scrolling kept from rising in, the gaps laid, the blocks measured.
  useLayoutEffect(() => {
    const now = plan.current
    if (now === null) return
    const scroller = scrollerOf(top.current)
    const gaps = read()
    // A block arrives where it is new, after what was the thread's last: anything else drawn now was there before.
    const after = lastDrawn.current === undefined ? undefined : now.indexOf.get(lastDrawn.current)
    for (const [key, els] of elements.current) {
      const arriving = !seen.current.has(key) && after !== undefined && now.indexOf.get(key)! > after
      seen.current.add(key)
      if (!arriving) for (const el of els) arrivesQuietly(el)
    }
    lastDrawn.current = now.keys.at(-1)
    if (showing(scroller)) settle(scroller, gaps)
    else layGaps(gaps)
    for (const listener of listeners) listener()
  })

  // Scrolling, resizing and the blocks growing move the window; focus and selection keep their blocks drawn.
  useEffect(() => {
    const scroller = scrollerOf(top.current)
    const thread = top.current?.parentElement ?? null
    if (scroller === null || thread === null) return
    let frame = 0
    const later = () => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0
          check()
        })
    }
    // The list keeps what is in view in place itself, as it draws and measures: the browser's own anchoring would move the
    // view up as blocks above it are measured shorter than guessed, which reads as the person leaving the bottom.
    const anchoring = scroller.style.overflowAnchor
    scroller.style.overflowAnchor = 'none'
    lastTop.current = scroller.scrollTop
    const onScroll = () => {
      // As useStickToBottom: near the bottom follows it, and only a move up leaves it.
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < SLACK) following.current = true
      else if (scroller.scrollTop < lastTop.current) following.current = false
      lastTop.current = scroller.scrollTop
      below.current = toBottom(scroller)
      if (showing(scroller)) place.current = inView(scroller)
      later()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    resize.current =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (!showing(scroller)) return
            hear(scroller)
            if (measure()) {
              layGaps(read())
              if (following.current) down(scroller)
              else keep(scroller, place.current)
            }
            place.current = inView(scroller)
            later()
          })
    const outer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later)
    outer?.observe(scroller)
    for (const els of elements.current.values()) for (const el of els) resize.current?.observe(el)
    const blockFor = (node: Node | null) => {
      let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null)
      while (el !== null && el.parentElement !== thread) el = el.parentElement
      return el === null ? undefined : blockOf.current.get(el)
    }
    let focused: string | undefined
    let selected: readonly [string, string] | undefined
    /** What a copy spanned, drawn whole for it, kept while that selection stays. */
    let copied: readonly [string, string] | undefined
    const hold = () => {
      const next: Array<readonly [string, string]> = []
      if (focused !== undefined) next.push([focused, focused])
      if (selected !== undefined) next.push(selected)
      if (copied !== undefined) next.push(copied)
      setHeld((was) => (was.length === next.length && was.every((one, i) => one[0] === next[i]![0] && one[1] === next[i]![1]) ? was : next))
    }
    const onFocus = (event: FocusEvent) => {
      focused = blockFor(event.target as Node)
      hold()
    }
    const onBlur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && thread.contains(event.relatedTarget)) return
      focused = undefined
      hold()
    }
    const onSelect = () => {
      const selection = document.getSelection()
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
        if (selected === undefined && copied === undefined) return
        selected = undefined
        copied = undefined
        return hold()
      }
      if (copied !== undefined && !selection.getRangeAt(0).intersectsNode(thread)) {
        copied = undefined
        hold()
      }
      const a = blockFor(selection.anchorNode)
      const b = blockFor(selection.focusNode)
      const next =
        a !== undefined && b !== undefined
          ? ([a, b] as const)
          : a !== undefined
            ? ([a, a] as const)
            : b !== undefined
              ? ([b, b] as const)
              : undefined
      if (next?.[0] === selected?.[0] && next?.[1] === selected?.[1]) return
      selected = next
      hold()
    }
    /**
     * As the person copies, the blocks their selection spans are drawn first, so the browser's own copy, which reads the
     * page as it stands once this returns, takes every message from the selection's start to its end, not only those near
     * the view: a selection from before the thread (Select All) or after it spans the thread's whole start or end.
     */
    const onCopy = () => {
      const now = plan.current
      const selection = document.getSelection()
      const first = top.current
      const last = bottom.current
      if (now === null || first === null || last === null || selection === null || selection.rangeCount === 0 || selection.isCollapsed)
        return
      const range = selection.getRangeAt(0)
      const count = now.keys.length
      if (count === 0 || !range.intersectsNode(thread)) return
      let from = range.intersectsNode(first) ? 0 : count
      let to = range.intersectsNode(last) ? count - 1 : -1
      for (const [key, els] of elements.current) {
        if (!els.some((el) => range.intersectsNode(el))) continue
        const i = now.indexOf.get(key)!
        from = Math.min(from, i)
        to = Math.max(to, i)
      }
      if (from > to) return
      let whole = true
      for (let i = from; i <= to && whole; i++) whole = elements.current.has(now.keys[i]!)
      if (whole) return
      copied = [now.keys[from]!, now.keys[to]!]
      flushSync(hold)
    }
    thread.addEventListener('focusin', onFocus)
    thread.addEventListener('focusout', onBlur)
    document.addEventListener('selectionchange', onSelect)
    document.addEventListener('copy', onCopy)
    const unregister = registerVirtualThread(scroller, {
      stops: () => {
        const now = plan.current
        const { stopOf } = asks.current
        if (now === null || stopOf === undefined) return []
        if (now.stops === null) {
          const stops: VirtualStop[] = []
          for (let i = 0; i < now.keys.length; i++) {
            const stop = stopOf(i)
            if (stop !== null) stops.push({ key: now.keys[i]!, ...stop })
          }
          now.stops = stops
        }
        return now.stops
      },
      topOf: (key) => {
        const now = plan.current
        const i = now?.indexOf.get(key)
        if (now === null || i === undefined || top.current === null) return null
        const drawn = elements.current.get(key)?.[0]
        if (drawn !== undefined) return drawn.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
        const size = sizes.get(key)
        return (
          top.current.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop +
          now.prefix[i]! +
          (size?.lead ?? 0)
        )
      },
      bring,
      bringItem: (itemId) => {
        const now = plan.current
        const { holds } = asks.current
        if (now === null || holds === undefined) return false
        for (let i = now.keys.length - 1; i >= 0; i--)
          if (holds(i, itemId)) {
            const key = now.keys[i]!
            if (!elements.current.has(key)) bring(key, scroller.clientHeight / 3)
            return true
          }
        return false
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    // Measured as soon as it can be: a scroller that had no size as the list was first drawn has one now.
    if (showing(scroller)) settle(scroller, read())
    later()
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll)
      scroller.style.overflowAnchor = anchoring
      resize.current?.disconnect()
      resize.current = null
      outer?.disconnect()
      thread.removeEventListener('focusin', onFocus)
      thread.removeEventListener('focusout', onBlur)
      document.removeEventListener('selectionchange', onSelect)
      document.removeEventListener('copy', onCopy)
      unregister()
    }
    // The handlers read the latest plan and the host's questions from their refs: set up once for the heights kept.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes])

  // Each gap as tall as the blocks it stands for, from the start: laid again once what is drawn is measured.
  const gap = (from: number, to: number) => ({ margin: 0, height: Math.max(prefix[to]! - prefix[from]!, 0) })
  const out: ReactNode[] = [
    <div key="virtual-top" ref={top} data-virtual-gap="" aria-hidden="true" style={gap(0, runs[0]?.[0] ?? count)} />,
  ]
  runs.forEach(([a, b], k) => {
    if (k > 0) out.push(<div key={`virtual-gap-${keys[a]}`} data-virtual-gap="" aria-hidden="true" style={gap(runs[k - 1]![1] + 1, a)} />)
    for (let i = a; i <= b; i++)
      out.push(
        <Fragment key={keys[i]}>
          {MARK}
          {render(i)}
        </Fragment>,
      )
  })
  out.push(
    <div key="virtual-bottom" ref={bottom} data-virtual-gap="" aria-hidden="true" style={gap((runs.at(-1)?.[1] ?? -1) + 1, count)} />,
  )
  return out
}
