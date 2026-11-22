import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Segmented, Tooltip } from '@althar/ui'

import { DEVICES } from '../../../src/main/browser/devices'
import type { Artifact, BoardDef, Size } from '../artifacts'
import { boardKey, type Spot, useLive } from '../live'
import { Board, drawnWidth, type Frames, type Look } from './Board'
import { Glyph, type GlyphName } from './Glyph'
import s from './boards.module.css'

/*
 * An artifact as a canvas of boards: every board laid out side by side on
 * the ground, or one board at a time, with its pages and its zoom; a tool
 * bar along the bottom. A board is whatever size the agent built it at:
 * Althar has no picker for sizes. Point at a part
 * of a board and the host opens a box on it, to say what you think; Mark
 * rings an area to say it about; Comment leaves a note for people. Nothing
 * here maps the design to controls: what changes a board is what is said.
 *
 * The ground moves with a trackpad (two fingers pan, a pinch zooms), by
 * dragging the ground, or with Move. Keys: V Point, H Move, P Mark, F one
 * board or every board, ← → between boards, + − zoom, Shift+1 fit,
 * Shift+0 100%, Space held to move.
 */

/** A row of boards: an artifact's page, with a heading over it on a wall of several. */
export interface Section {
  readonly key: string
  readonly artifact: Artifact
  readonly pageId: string
  readonly boards: ReadonlyArray<BoardDef>
  readonly heading?: { readonly title: string; readonly facts: string; readonly onOpen?: () => void }
}

export type Tool = 'point' | 'move' | 'mark' | 'comment'
export type View = 'every' | 'one'

/** A board where the canvas laid it, in the ground's own pixels. */
export interface Placed {
  readonly key: string
  readonly section: Section
  readonly def: BoardDef
  readonly size: Size
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** What the person pointed at, with which tool. */
export interface Pointed {
  readonly key: string
  readonly spot: Spot
  readonly tool: Tool
  readonly placed: Placed
}

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Where a board, or a box on it (or the element a selector finds in its page), is on screen, in the canvas's own pixels. */
export type At = (key: string, box?: Box | string) => (Box & { readonly zoom: number }) | null

interface Camera {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

const GAP = 120
const SECTION_GAP = 820
/** Room the canvas keeps clear of boards when it fits them: its head, its tool bar. */
const PAD = { top: 76, bottom: 96, side: 56 }
const MIN_ZOOM = 0.03
const MAX_ZOOM = 4
const LABELS_FROM = 0.1

const TOOLS: ReadonlyArray<{ readonly tool: Tool; readonly glyph: GlyphName; readonly label: string; readonly kbd?: string }> = [
  { tool: 'point', glyph: 'point', label: 'Point at a part', kbd: 'V' },
  { tool: 'move', glyph: 'move', label: 'Move around', kbd: 'H' },
  { tool: 'mark', glyph: 'mark', label: 'Ring an area', kbd: 'P' },
  { tool: 'comment', glyph: 'comment', label: 'Comment' },
]

/** The design's own names for its parts (Kiln's data-part). */
const PART_NAMES: Readonly<Record<string, string>> = {
  card: 'The card',
  amounts: 'The amounts',
  title: 'The heading',
  go: '“Send the gift”',
  note: 'The note',
}
const wordsOf = (element: Element) => (element.textContent ?? '').trim().replace(/\s+/g, ' ')
const short = (words: string) => (words.length > 28 ? `${words.slice(0, 26)}…` : words)

/** What a press picks: the part it is in, where the design names one; else the nearest element with words, or a picture. */
const pickable = (target: Element | null): HTMLElement | null => {
  // The design's elements are the frame's, not this window's: `instanceof HTMLElement` is false for them.
  const named = target?.closest('[data-part]') as HTMLElement | null | undefined
  if (named != null) return named
  let at = target as HTMLElement | null
  while (at !== null && at.tagName !== 'BODY' && at.id !== 'root') {
    const box = at.getBoundingClientRect()
    if (box.width > 24 && box.height > 14 && (wordsOf(at) !== '' || box.width < 400)) return at
    at = at.parentElement
  }
  return null
}

/** A path to an element that finds it again in another copy of the same page. */
const selectorOf = (element: HTMLElement): string => {
  if (element.dataset.part !== undefined) return `[data-part="${element.dataset.part}"]`
  const steps: string[] = []
  let at: HTMLElement | null = element
  while (at !== null && at.id !== 'root' && at.parentElement !== null) {
    const index = Array.from(at.parentElement.children).indexOf(at) + 1
    steps.unshift(`${at.tagName.toLowerCase()}:nth-child(${index})`)
    at = at.parentElement
  }
  return `#root > ${steps.join(' > ')}`
}

const nameOf = (element: HTMLElement) => {
  const part = PART_NAMES[element.dataset.part ?? '']
  if (part !== undefined) return part
  const words = wordsOf(element)
  return words === '' ? 'This part' : `“${short(words)}”`
}

const sizeOf = (def: BoardDef, sizes: Readonly<Record<string, Size>>, key: string): Size => sizes[key] ?? def.size ?? 'laptop'
const widthOf = (def: BoardDef, size: Size) => (def.draw === undefined ? DEVICES[size].width : drawnWidth(def))
const startHeight = (def: BoardDef, size: Size) => (def.draw === undefined ? DEVICES[size].height : 640)

/**
 * Where every board goes. One section is a row; several are stacked into as
 * many columns as keep the wall about as wide as the canvas is, each in the
 * shortest column so far.
 */
const lay = (
  sections: ReadonlyArray<Section>,
  heights: Readonly<Record<string, number>>,
  sizes: Readonly<Record<string, Size>>,
  aspect: number,
): {
  readonly placed: ReadonlyArray<Placed>
  readonly heads: ReadonlyArray<{ readonly section: Section; readonly x: number; readonly y: number; readonly width: number }>
} => {
  const rows = sections.map((section) => {
    let x = 0
    const boards = section.boards.map((def) => {
      const key = boardKey(section.artifact.id, def.id)
      const size = sizeOf(def, sizes, key)
      const width = widthOf(def, size)
      const height = heights[key] ?? startHeight(def, size)
      const at = { key, section, def, size, x, y: 0, width, height }
      x += width + GAP
      return at
    })
    return { section, boards, width: Math.max(0, x - GAP), height: Math.max(0, ...boards.map((one) => one.height)) }
  })
  if (rows.length === 1) return { placed: rows[0]?.boards ?? [], heads: [] }
  const columns = (n: number) => {
    const cols = Array.from({ length: n }, () => ({ rows: [] as typeof rows, height: 0, width: 0 }))
    for (const row of rows) {
      const col = cols.reduce((low, one) => (one.height < low.height ? one : low), cols[0] as (typeof cols)[number])
      col.rows.push(row)
      col.height += row.height + SECTION_GAP
      col.width = Math.max(col.width, row.width)
    }
    const width = cols.reduce((sum, one) => sum + one.width, 0) + (n - 1) * SECTION_GAP
    const height = Math.max(...cols.map((one) => one.height))
    return { cols, ratio: width / height }
  }
  const best = [1, 2, 3, 4]
    .map(columns)
    .reduce((a, b) => (Math.abs(Math.log(b.ratio / aspect)) < Math.abs(Math.log(a.ratio / aspect)) ? b : a))
  const placed: Placed[] = []
  const heads: Array<{ section: Section; x: number; y: number; width: number }> = []
  let cx = 0
  for (const col of best.cols) {
    let cy = 0
    for (const row of col.rows) {
      heads.push({ section: row.section, x: cx, y: cy, width: row.width })
      for (const one of row.boards) placed.push({ ...one, x: cx + one.x, y: cy })
      cy += row.height + SECTION_GAP
    }
    cx += col.width + SECTION_GAP
  }
  return { placed, heads }
}

const fitTo = (placed: ReadonlyArray<Placed>, width: number, height: number, most = 1, headroom = 0): Camera => {
  if (placed.length === 0 || width < 10 || height < 10) return { x: 0, y: 0, zoom: 1 }
  const left = Math.min(...placed.map((one) => one.x))
  const top = Math.min(...placed.map((one) => one.y))
  const right = Math.max(...placed.map((one) => one.x + one.width))
  const bottom = Math.max(...placed.map((one) => one.y + one.height))
  const roomW = Math.max(40, width - PAD.side * 2)
  const roomH = Math.max(40, height - PAD.top - PAD.bottom - headroom)
  const zoom = Math.max(MIN_ZOOM, Math.min(most, roomW / (right - left), roomH / (bottom - top)))
  return {
    zoom,
    x: PAD.side + (roomW - (right - left) * zoom) / 2 - left * zoom,
    // Tall boards start at their top, as a page is read; short ones sit in the middle.
    y: PAD.top + headroom + Math.max(0, (roomH - (bottom - top) * zoom) / 2) - top * zoom,
  }
}

export interface BoardsProps {
  readonly sections: ReadonlyArray<Section>
  readonly pages?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly count: number }>
  readonly page?: string
  readonly onPage?: (id: string) => void
  readonly view: View
  readonly onView: (view: View) => void
  /** The board one at a time shows, and that keys step from: its key. */
  readonly focus: string | null
  readonly onFocus: (key: string) => void
  /** After the view's switch, in the canvas's head. */
  readonly head?: ReactNode
  /** First in the canvas's top left: what the artifact is (its switcher, or the way back). */
  readonly lead?: ReactNode
  /** In the top right, before the zoom: its version, comments, where it lives, Share. */
  readonly trail?: ReactNode
  /** Last in the top right: closing it. */
  readonly close?: ReactNode
  readonly onPoint?: (pointed: Pointed) => void
  /** The box open on what was pointed at: the host draws it, the canvas places it by its spot. */
  readonly pointed?: Pointed | null
  readonly box?: ReactNode
  /** Drawn over the boards in place, as they move: pins, people. */
  readonly marks?: (at: At, placed: ReadonlyArray<Placed>, room: { readonly width: number; readonly height: number }) => ReactNode
  /** Boards picked, by key (the wall's). */
  readonly selected?: ReadonlySet<string>
  readonly onSelect?: (key: string, add: boolean) => void
  /** What a board's label offers after its own, at its end. */
  readonly labelEnd?: (placed: Placed) => ReactNode
  /** Changing, it fits the boards again: a moment, an artifact. */
  readonly fitKey?: string
  /** Where a moment starts: at a zoom, over a board. */
  readonly start?: { readonly zoom: number; readonly on: string } | null
  readonly tool?: Tool
  readonly onTool?: (tool: Tool) => void
  /** Pointed at as the moment starts: the part a selector finds on a board, once its page has drawn. */
  readonly aim?: { readonly key: string; readonly selector: string } | null
  /** Boards to frame together, every board shown: what the lead just drew beside one, with it. */
  readonly frame?: ReadonlyArray<string> | null
}

export function Boards({
  sections,
  pages = [],
  page,
  onPage,
  view,
  onView,
  focus,
  onFocus,
  head,
  lead,
  trail,
  close,
  onPoint,
  pointed = null,
  box,
  marks,
  selected,
  onSelect,
  labelEnd,
  fitKey = '',
  start = null,
  tool: toolGiven,
  onTool,
  aim = null,
  frame = null,
}: BoardsProps) {
  const world = useLive()
  const ground = useRef<HTMLDivElement>(null)
  const frames = useMemo<Frames>(() => new Map(), [])
  const [room, setRoom] = useState({ width: 0, height: 0 })
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({})
  const sizes = useMemo<Readonly<Record<string, Size>>>(() => ({}), [])
  const [toolOwn, setToolOwn] = useState<Tool>('point')
  const tool = toolGiven ?? toolOwn
  const setTool = onTool ?? setToolOwn
  const [spaced, setSpaced] = useState(false)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 0.3 })
  const [hover, setHover] = useState<{ readonly key: string; readonly box: Box; readonly label: string } | null>(null)
  const [stroke, setStroke] = useState<ReadonlyArray<{ readonly x: number; readonly y: number }> | null>(null)
  const [holding, setHolding] = useState<string | null>(null)
  // Moved by the person since the canvas last fitted: what it lays out next doesn't move the ground under them.
  const moved = useRef(false)

  useLayoutEffect(() => {
    const element = ground.current
    if (element === null) return
    const observer = new ResizeObserver(() => setRoom({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const every = useMemo(
    () => lay(sections, heights, sizes, Math.max(0.6, room.width / Math.max(1, room.height))),
    [sections, heights, sizes, room],
  )
  const all = every.placed
  const shownOne = view === 'one' ? (all.find((one) => one.key === focus) ?? all[0] ?? null) : null
  const placed = useMemo(() => (shownOne === null ? all : [{ ...shownOne, x: 0, y: 0 }]), [all, shownOne])
  const heads = view === 'one' ? [] : every.heads

  // Fitted again as what it shows changes, unless the person moved it since.
  const fitWhat = `${fitKey}|${view}|${page ?? ''}|${view === 'one' ? (shownOne?.key ?? '') : ''}`
  const lastFit = useRef('')
  useLayoutEffect(() => {
    if (room.width === 0) return
    const fresh = lastFit.current !== fitWhat
    if (fresh) moved.current = false
    if (moved.current) return
    lastFit.current = fitWhat
    const aimed = start !== null && fresh ? placed.find((one) => one.key === start.on) : undefined
    if (aimed !== undefined && start !== null) {
      setCamera({ zoom: start.zoom, x: room.width / 2 - (aimed.x + aimed.width / 2) * start.zoom, y: PAD.top - aimed.y * start.zoom })
      moved.current = true
      return
    }
    setCamera(fitTo(placed, room.width, room.height, view === 'one' ? 1 : 0.6, heads.length > 0 ? 64 : 0))
  }, [fitWhat, placed, room, view, start, heads.length])

  const toScreen = useCallback((x: number, y: number) => ({ x: x * camera.zoom + camera.x, y: y * camera.zoom + camera.y }), [camera])
  const at: At = useCallback(
    (key, inner) => {
      const one = placed.find((p) => p.key === key)
      if (one === undefined) return null
      let b: Box = { x: 0, y: 0, width: one.width, height: one.height }
      if (typeof inner === 'string') {
        const found = frames.get(key)?.contentDocument?.querySelector(inner)
        if (found == null) return null
        const r = found.getBoundingClientRect()
        b = { x: r.left, y: r.top, width: r.width, height: r.height }
      } else if (inner !== undefined) b = inner
      const tl = toScreen(one.x + b.x, one.y + b.y)
      return { x: tl.x, y: tl.y, width: b.width * camera.zoom, height: b.height * camera.zoom, zoom: camera.zoom }
    },
    [placed, toScreen, camera.zoom, frames],
  )

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    moved.current = true
    setCamera((was) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, was.zoom * factor))
      const px = cx ?? (ground.current?.clientWidth ?? 0) / 2
      const py = cy ?? (ground.current?.clientHeight ?? 0) / 2
      return { zoom, x: px - ((px - was.x) * zoom) / was.zoom, y: py - ((py - was.y) * zoom) / was.zoom }
    })
  }, [])
  const zoomTo = (zoom: number) => zoomAt(zoom / camera.zoom)
  const fit = () => {
    moved.current = false
    setCamera(fitTo(placed, room.width, room.height, view === 'one' ? 1 : 0.6, heads.length > 0 ? 64 : 0))
  }

  // Two fingers pan; a pinch, or a wheel with Ctrl, zooms at the pointer.
  useEffect(() => {
    const element = ground.current
    if (element === null) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - box.left, event.clientY - box.top)
      else {
        moved.current = true
        setCamera((was) => ({ ...was, x: was.x - event.deltaX, y: was.y - event.deltaY }))
      }
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [zoomAt])

  /** What is under the pointer: a part of a board's page, or the whole of a board Althar draws. */
  const pick = (clientX: number, clientY: number): Pointed | null => {
    const element = ground.current
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    const wx = (clientX - rect.left - camera.x) / camera.zoom
    const wy = (clientY - rect.top - camera.y) / camera.zoom
    const one = placed.find((p) => wx >= p.x && wx <= p.x + p.width && wy >= p.y && wy <= p.y + p.height)
    if (one === undefined) return null
    const whole: Spot = {
      artifactId: one.section.artifact.id,
      boardId: one.def.id,
      selector: null,
      label: one.def.name,
      box: { x: 0, y: 0, width: one.width, height: one.height },
      part: null,
    }
    if (one.def.draw !== undefined) return { key: one.key, spot: whole, tool, placed: one }
    const doc = frames.get(one.key)?.contentDocument
    const target = pickable(doc?.elementFromPoint(wx - one.x, wy - one.y) ?? null)
    if (target === null) return { key: one.key, spot: whole, tool, placed: one }
    const b = target.getBoundingClientRect()
    return {
      key: one.key,
      tool,
      placed: one,
      spot: {
        ...whole,
        selector: selectorOf(target),
        label: nameOf(target),
        box: { x: b.left, y: b.top, width: b.width, height: b.height },
        part: target.dataset.part ?? null,
      },
    }
  }

  const drag = useRef<{
    readonly x: number
    readonly y: number
    readonly cx: number
    readonly cy: number
    panned: boolean
    readonly pan: boolean
  } | null>(null)
  const panning = tool === 'move' || spaced
  const down = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
    if (tool === 'mark' && !spaced && event.button === 0) {
      const rect = (ground.current as HTMLDivElement).getBoundingClientRect()
      setStroke([{ x: (event.clientX - rect.left - camera.x) / camera.zoom, y: (event.clientY - rect.top - camera.y) / camera.zoom }])
      return
    }
    drag.current = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y, panned: false, pan: panning || event.button === 1 }
  }
  const move = (event: React.PointerEvent) => {
    const rect = (ground.current as HTMLDivElement).getBoundingClientRect()
    if (stroke !== null && drag.current === null && (event.buttons & 1) === 1) {
      const point = { x: (event.clientX - rect.left - camera.x) / camera.zoom, y: (event.clientY - rect.top - camera.y) / camera.zoom }
      setStroke((was) => (was === null ? [point] : [...was, point]))
      return
    }
    const d = drag.current
    if (d !== null) {
      const dx = event.clientX - d.x
      const dy = event.clientY - d.y
      if (!d.panned && Math.hypot(dx, dy) > 4) d.panned = true
      if (d.panned) {
        moved.current = true
        setCamera((was) => ({ ...was, x: d.cx + dx, y: d.cy + dy }))
        setHover(null)
      }
      return
    }
    if (panning || tool === 'mark' || pointed !== null) return setHover(null)
    const found = pick(event.clientX, event.clientY)
    setHover(found === null ? null : { key: found.key, box: found.spot.box, label: found.spot.label })
  }
  const up = (event: React.PointerEvent) => {
    if (stroke !== null) {
      const points = stroke
      if (points.length > 2) {
        const left = Math.min(...points.map((p) => p.x))
        const top = Math.min(...points.map((p) => p.y))
        const right = Math.max(...points.map((p) => p.x))
        const bottom = Math.max(...points.map((p) => p.y))
        const mid = { x: (left + right) / 2, y: (top + bottom) / 2 }
        const one = placed.find((p) => mid.x >= p.x && mid.x <= p.x + p.width && mid.y >= p.y && mid.y <= p.y + p.height)
        // What is ringed is what the ring's middle is on: the part a change to it changes.
        const rect = (ground.current as HTMLDivElement).getBoundingClientRect()
        const inside = pick(rect.left + camera.x + mid.x * camera.zoom, rect.top + camera.y + mid.y * camera.zoom)
        if (one !== undefined)
          onPoint?.({
            key: one.key,
            tool: 'mark',
            placed: one,
            spot: {
              artifactId: one.section.artifact.id,
              boardId: one.def.id,
              selector: inside?.key === one.key ? inside.spot.selector : null,
              label: 'The ringed area',
              box: { x: left - one.x, y: top - one.y, width: right - left, height: bottom - top },
              part: inside?.key === one.key ? inside.spot.part : null,
            },
          })
        else setStroke(null)
      } else setStroke(null)
      return
    }
    const d = drag.current
    drag.current = null
    if (d === null || d.panned || d.pan) return
    const found = pick(event.clientX, event.clientY)
    if (found === null) return
    setHover(null)
    onPoint?.(found)
  }
  // A moment that starts pointed at a part: once the board's page has drawn it, as if the person had pressed it.
  const aimDone = useRef(false)
  useEffect(() => {
    if (aim === null || aimDone.current) return
    let tries = 0
    const timer = window.setInterval(() => {
      const one = placed.find((p) => p.key === aim.key)
      const target = frames.get(aim.key)?.contentDocument?.querySelector<HTMLElement>(aim.selector)
      if ((one === undefined || target == null) && tries++ < 100) return
      window.clearInterval(timer)
      if (one === undefined || target == null) return
      aimDone.current = true
      const b = target.getBoundingClientRect()
      onPoint?.({
        key: one.key,
        tool: 'point',
        placed: one,
        spot: {
          artifactId: one.section.artifact.id,
          boardId: one.def.id,
          selector: selectorOf(target),
          label: nameOf(target),
          box: { x: b.left, y: b.top, width: b.width, height: b.height },
          part: target.dataset.part ?? null,
        },
      })
    }, 120)
    return () => window.clearInterval(timer)
  }, [aim, placed, frames, onPoint])

  // Boards framed together, once they are laid out.
  const framed = frame === null ? '' : frame.join('|')
  useLayoutEffect(() => {
    if (framed === '' || view !== 'every' || room.width === 0) return
    const these = placed.filter((one) => framed.split('|').includes(one.key))
    if (these.length === 0) return
    moved.current = true
    setCamera(fitTo(these, room.width, room.height, 0.6))
    // Only as they arrive: the person moves it from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framed, view, room.width === 0, placed.length])

  // The ring stays while its box is open.
  useEffect(() => {
    if (pointed === null || pointed.tool !== 'mark') setStroke(null)
  }, [pointed])

  // Keys, from anywhere but a field.
  const stepBy = useCallback(
    (by: number) => {
      const index = all.findIndex((one) => one.key === (shownOne?.key ?? focus))
      const next = all[(index + by + all.length) % all.length]
      if (next !== undefined) onFocus(next.key)
    },
    [all, shownOne, focus, onFocus],
  )
  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (!event.repeat) setSpaced(true)
        return
      }
      if (event.shiftKey && event.code === 'Digit1') return fit()
      if (event.shiftKey && event.code === 'Digit0') return zoomTo(1)
      if (event.shiftKey) return
      const key = event.key.toLowerCase()
      if (key === 'v') return setTool('point')
      if (key === 'h') return setTool('move')
      if (key === 'p') return setTool('mark')
      if (key === 'f') {
        if (view === 'every' && hover !== null) onFocus(hover.key)
        return onView(view === 'one' ? 'every' : 'one')
      }
      if (key === '+' || key === '=') return zoomAt(1.25)
      if (key === '-' || key === '_') return zoomAt(0.8)
      if (view === 'one' && key === 'arrowright') return stepBy(1)
      if (view === 'one' && key === 'arrowleft') return stepBy(-1)
      if (key === 'escape' && pointed === null && view === 'one') return onView('every')
    }
    const onUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaced(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  })

  const lookOf = (section: Section, def: BoardDef, held: boolean): Look => {
    const landed = world.landed[boardKey(section.artifact.id, def.id)] ?? []
    const own = def.look ?? {}
    if (held) return own
    return landed.reduce<Look>(
      (look, one) => ({
        ...look,
        ...one.look,
        ...(one.style === undefined ? {} : { [`style:${one.style.selector}`]: JSON.stringify(one.style.css) }),
      }),
      own,
    )
  }

  // A part is found again where it is now (a change may have moved it); a ringed area stays where it was ringed.
  const pointedAt =
    pointed === null
      ? null
      : ((pointed.tool !== 'mark' && pointed.spot.selector !== null ? at(pointed.key, pointed.spot.selector) : null) ??
        at(pointed.key, pointed.spot.box))
  const working = world.at === null ? null : at(boardKey(world.at.artifactId, world.at.boardId), world.at.box)
  const labels = camera.zoom >= LABELS_FROM || view === 'one'
  const pct = Math.round(camera.zoom * 100)
  const one = shownOne
  const index = one === null ? -1 : all.findIndex((p) => p.key === one.key)

  return (
    <div className={s.canvas} data-tool={panning ? 'move' : tool} data-view={view}>
      <div
        ref={ground}
        className={s.ground}
        style={{
          backgroundPosition: `${camera.x}px ${camera.y}px`,
          backgroundSize: `${24 * Math.max(0.5, Math.min(2, camera.zoom * 2))}px ${24 * Math.max(0.5, Math.min(2, camera.zoom * 2))}px`,
        }}
      >
        <div className={s.world} data-world="" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
          {all.map((p) => {
            const shown = view === 'every' || p.key === one?.key
            const x = view === 'one' ? 0 : p.x
            const y = view === 'one' ? 0 : p.y
            return (
              <div
                key={p.key}
                className={s.sheet}
                data-fresh={p.def.fresh === true || undefined}
                data-picked={selected?.has(p.key) === true || undefined}
                hidden={!shown}
                style={{ left: x, top: y, width: p.width, height: p.height, ['--z' as string]: camera.zoom }}
              >
                <Board
                  id={p.key}
                  def={p.def}
                  width={p.width}
                  look={lookOf(p.section, p.def, holding === p.key)}
                  frames={frames}
                  onHeight={(height) => setHeights((was) => (was[p.key] === height || height < 80 ? was : { ...was, [p.key]: height }))}
                />
              </div>
            )
          })}
        </div>

        {/* what takes the pointer: the boards' pages are pointed into, never used, on the canvas */}
        <div className={s.glass} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)} />

        <div className={s.over}>
          {heads.map((one) => {
            const p = toScreen(one.x, one.y)
            return (
              <div
                key={one.section.key}
                className={s.sectionHead}
                style={{ left: p.x, top: p.y - (labels ? 64 : 44), maxWidth: Math.max(240, one.width * camera.zoom) }}
              >
                {one.section.heading?.onOpen === undefined ? (
                  <span className={s.sectionTitle}>{one.section.heading?.title}</span>
                ) : (
                  <button type="button" className={s.sectionTitle} onClick={one.section.heading.onOpen}>
                    {one.section.heading.title}
                  </button>
                )}
                <span className={s.sectionFacts}>{one.section.heading?.facts}</span>
              </div>
            )
          })}
          {labels &&
            placed.map((p) => {
              const box = at(p.key)
              if (box === null) return null
              const landed = world.landed[p.key] ?? []
              const last = landed.at(-1)
              return (
                <div
                  key={p.key}
                  className={s.label}
                  data-picked={selected?.has(p.key) === true || undefined}
                  data-narrow={box.width < 150 || undefined}
                  style={{ left: box.x, top: box.y - 26, width: Math.max(box.width, 56) }}
                >
                  <button
                    type="button"
                    className={s.labelName}
                    onClick={(event) => (onSelect !== undefined ? onSelect(p.key, event.shiftKey) : onFocus(p.key))}
                    onDoubleClick={() => {
                      onFocus(p.key)
                      onView('one')
                    }}
                    title={p.def.name}
                  >
                    {p.def.name}
                  </button>

                  {last !== undefined && (
                    <button
                      type="button"
                      className={s.labelVersion}
                      onPointerDown={() => setHolding(p.key)}
                      onPointerUp={() => setHolding(null)}
                      onPointerLeave={() => setHolding(null)}
                      title="Hold for how it was"
                    >
                      v{last.version} · Hold for before
                    </button>
                  )}
                  <span className={s.labelGap} />
                  <span className={s.labelEnd}>
                    {labelEnd?.(p)}
                    {view === 'every' && (
                      <Tooltip label="One board" kbd="F">
                        <button
                          type="button"
                          className={s.labelIcon}
                          aria-label="One board"
                          onClick={() => {
                            onFocus(p.key)
                            onView('one')
                          }}
                        >
                          <Glyph name="oneBoard" size={13} />
                        </button>
                      </Tooltip>
                    )}
                  </span>
                  {p.def.tried !== undefined && <span className={s.tried}>{p.def.tried}</span>}
                </div>
              )
            })}
          {hover !== null &&
            pointed === null &&
            (() => {
              const box = at(hover.key, hover.box)
              return box === null ? null : (
                <div className={s.hover} style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
                  <span className={s.hoverName}>{hover.label}</span>
                </div>
              )
            })()}
          {stroke !== null && (
            <svg className={s.stroke} width={room.width} height={room.height}>
              <path
                d={stroke.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * camera.zoom + camera.x} ${p.y * camera.zoom + camera.y}`).join(' ')}
              />
            </svg>
          )}
          {working !== null && (
            <div className={s.working} style={{ left: working.x, top: working.y, width: working.width, height: working.height }}>
              <span className={s.workingWord}>Working on it</span>
            </div>
          )}
          {pointedAt !== null && pointed?.tool !== 'mark' && (
            <div className={s.pointed} style={{ left: pointedAt.x, top: pointedAt.y, width: pointedAt.width, height: pointedAt.height }} />
          )}
          {marks?.(at, placed, room)}
          {pointedAt !== null && box !== undefined && (
            <div
              className={s.boxPlace}
              style={{
                left: Math.max(12, Math.min(pointedAt.x, room.width - 372)),
                ...(pointedAt.y + pointedAt.height + 290 < room.height
                  ? { top: Math.max(12, pointedAt.y + pointedAt.height + 10) }
                  : { bottom: Math.max(84, room.height - pointedAt.y + 10) }),
              }}
            >
              {box}
            </div>
          )}
        </div>
      </div>

      <div className={s.headStart}>
        <div className={s.island}>
          {lead}
          {pages.length > 1 && page !== undefined && onPage !== undefined && (
            <Menu
              label="Pages"
              trigger={
                <button type="button" className={s.chip}>
                  <Glyph name="pages" size={13} />
                  <span className={s.chipWords}>{pages.find((one) => one.id === page)?.name ?? ''}</span>
                  <Glyph name="down" size={11} />
                </button>
              }
            >
              <MenuRadioGroup label="Pages" value={page} onChange={onPage}>
                {pages.map((one) => (
                  <MenuRadioItem key={one.id} value={one.id} hint={String(one.count)}>
                    {one.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </Menu>
          )}
          <Segmented
            label="Boards"
            className={s.views}
            value={view}
            onChange={(value) => {
              if (value === 'one' && hover !== null) onFocus(hover.key)
              onView(value)
            }}
            options={[
              // The kit's Segmented takes words; with a glyph for each, it would take a picture too.
              {
                value: 'every',
                label: (
                  <>
                    <Glyph name="everyBoard" size={14} />
                    <span className={s.hidden}>Every board</span>
                  </>
                ) as unknown as string,
                tooltip: { label: 'Every board', kbd: 'F' },
              },
              {
                value: 'one',
                label: (
                  <>
                    <Glyph name="oneBoard" size={13} />
                    <span className={s.hidden}>One board at a time</span>
                  </>
                ) as unknown as string,
                tooltip: { label: 'One board at a time', kbd: 'F' },
              },
            ]}
          />
        </div>
        {head}
      </div>

      {view === 'one' && one !== null && all.length > 1 && (
        <div className={s.stepper}>
          <button type="button" className={s.step} aria-label="Board before" onClick={() => stepBy(-1)}>
            ‹
          </button>
          <span className={s.stepName}>{one.def.name}</span>
          <span className={s.stepCount}>
            {index + 1} of {all.length}
          </span>
          <button type="button" className={s.step} aria-label="Next board" onClick={() => stepBy(1)}>
            ›
          </button>
        </div>
      )}

      <div className={s.headEnd}>
        <div className={s.island}>
          {trail}

          <Menu
            label="Zoom"
            align="end"
            trigger={
              <button type="button" className={s.chip}>
                <span className={s.zoomWord}>{pct}%</span>
                <Glyph name="down" size={11} />
              </button>
            }
          >
            <MenuItem onSelect={() => zoomAt(1.25)} kbd="+">
              Zoom in
            </MenuItem>
            <MenuItem onSelect={() => zoomAt(0.8)} kbd="−">
              Zoom out
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={fit} kbd="⇧1">
              {view === 'one' ? 'Fit the board' : 'Fit every board'}
            </MenuItem>
            <MenuItem onSelect={() => zoomTo(0.5)}>50%</MenuItem>
            <MenuItem onSelect={() => zoomTo(1)} kbd="⇧0">
              100%
            </MenuItem>
            <MenuItem onSelect={() => zoomTo(2)}>200%</MenuItem>
          </Menu>
          {close}
        </div>
      </div>

      <div className={s.tools} role="toolbar" aria-label="Tools">
        {TOOLS.map((one) => (
          <Tooltip key={one.tool} label={one.label} {...(one.kbd === undefined ? {} : { kbd: one.kbd })}>
            <button
              type="button"
              className={s.tool}
              aria-label={one.label}
              aria-pressed={tool === one.tool}
              onClick={() => setTool(one.tool)}
            >
              <Glyph name={one.glyph} size={15} />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

/** A hair between what an island in the canvas's head holds. */
export const Rule = () => <span className={s.islandRule} aria-hidden />
