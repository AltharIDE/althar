import type { Box, Picked } from '../main/browser/picked'
import { controlsIn } from './controls'
import { describe } from './describe'

/*
 * The ground of a canvas of boards (ADR-104): designs laid side by side on
 * pages, as a design tool lays out frames. The main process loads Althar's
 * own empty page at the version's `.althar/boards.html` in the canvas's view
 * and runs this in an isolated world of it, never in the page's own: it
 * builds each board as a frame of the canvas's own file at the size its
 * agent gave it, and moves and scales them all as one, so the canvas pans
 * and zooms. The boards are the canvas's origin, so this world reaches into
 * each to point at a part of it, while their scripts never see this world.
 *
 * It shows every board of a page, every page at once (a row each), or one
 * board at a time, fitted. Its tools: pointing at a part of a board (the
 * part is outlined and named; a press takes it, for the person to say what
 * they think in Althar's window, over a picture of it), moving around by
 * dragging (or with the space bar held), and using the boards as the pages
 * they are. Comments already made on parts show as numbered pins. What
 * changes, and what the person took or pressed, the main process hears by
 * asking `next`, which answers once there is news.
 */

export interface GroundBoard {
  readonly name: string
  readonly file: string
  readonly width: number
  readonly height: number
}

export interface GroundPage {
  readonly name: string
  readonly boards: ReadonlyArray<GroundBoard>
}

/** Every board of a page (or of every page), or one board at a time. */
export type GroundView = 'every' | 'one'

/** Pointing at a part, moving around, or using the boards as pages. */
export type GroundTool = 'point' | 'hand' | 'use'

/** A board by its page's place and its own on that page. */
export interface GroundAt {
  readonly page: number
  readonly board: number
}

export interface GroundState {
  readonly view: GroundView
  /** The page shown, by its place; -1 for every page at once. */
  readonly page: number
  /** The board one at a time shows, which is also the one chosen while every board shows. */
  readonly board: GroundAt
  readonly zoom: number
  readonly tool: GroundTool
}

/** A comment's pin, on the part of a board it was made on. */
export interface GroundPin {
  readonly n: number
  readonly page: string
  readonly board: string
  readonly selector: string
  /** Answered by an agent: drawn quieter. */
  readonly answered: boolean
  /** Still in the person's message, not sent: drawn as a draft. */
  readonly draft: boolean
}

/** A part found on a board: as the overlay describes it, inside its board, and where it shows on the ground. */
export interface GroundPart {
  readonly page: string
  readonly board: string
  readonly picked: Picked
  /** Its box on the ground, in the view's pixels. */
  readonly at: Box
}

export type GroundEvent =
  | ({ readonly kind: 'pointed' } & GroundPart)
  | { readonly kind: 'pin'; readonly n: number }
  /** A key the window acts on, pressed while the canvas has the keyboard. */
  /** Open, close and comment are its chip's, beside a conversation: the artifact itself, closing it, a comment on all of it. */
  | { readonly kind: 'key'; readonly key: 'escape' | 'older' | 'newer' | 'open' | 'close' | 'comment' }

/** What has happened since the news last asked for: the state now, and what the person did. */
export interface GroundNews {
  readonly seq: number
  readonly state: GroundState
  readonly events: ReadonlyArray<GroundEvent>
}

export interface GroundChange {
  readonly view?: GroundView
  readonly page?: number
  readonly board?: GroundAt
  /** The board before or after the one shown, through every page. */
  readonly step?: -1 | 1
  readonly zoom?: number | 'fit' | 'in' | 'out'
  readonly tool?: GroundTool
  /**
   * Beside a conversation, its chip beside the zoom: the canvas's name, and whether it takes a comment on all of it there
   * (its Open, close and Comment told as keys); null for none.
   */
  readonly chip?: { readonly title: string; readonly comment: boolean } | null
}

export interface Ground {
  /** Lays out a canvas's pages, as it shows them; called again on every load of its page. */
  readonly start: (pages: ReadonlyArray<GroundPage>, state: Partial<GroundState>) => GroundNews
  readonly set: (change: GroundChange) => GroundNews
  /** The news after `seq`: at once where there is some, else once there is, or after a while with the state as it is. */
  readonly next: (seq: number) => Promise<GroundNews>
  /** Draws these pins in place of those drawn; returns the numbers of those whose parts are on their boards. */
  readonly pins: (pins: ReadonlyArray<GroundPin>) => ReadonlyArray<number>
  /** A part of a board found again and brought into view, or null where it isn't there. */
  readonly find: (page: string, board: string, selector: string) => GroundPart | null
  /** Takes away the outline of what was taken: its comment is written, or set aside. */
  readonly clear: () => void
}

/** Room between boards, in the boards' own pixels; and round what is fitted, in the view's. */
const GAP = 96
const PAD = 56
/** Room over a line of boards for their names, and over a page for its name, in the view's pixels. */
const NAME_ROOM = 34
const PAGE_ROOM = 84
const MIN_ZOOM = 0.02
const MAX_ZOOM = 4
/** Below this, the boards' names would be smaller than the boards: they go, and the pages' names stay. */
const NAMES_FROM = 0.06
/** How long `next` waits with nothing new before it answers all the same, so a reload never leaves it waiting. */
const QUIET_MS = 20_000

const VIOLET = '#7a3ff0'

const PICTURE = /\.(png|jpe?g|gif|webp|avif)$/i

/** A board's file as an address beside the ground's own page, which is under `.althar/`. */
const addressOf = (file: string) => `../${file.split('/').map(encodeURIComponent).join('/')}`

const STYLE = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: var(--n-1, #f3efe8); }
  body { font-family: var(--font, system-ui, sans-serif); -webkit-font-smoothing: antialiased; user-select: none; }
  .althar-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .althar-board { position: absolute; background: #fff; box-shadow: 0 0 0 calc(1px / var(--z)) var(--line-2, rgba(0,0,0,.12)); }
  .althar-board[data-chosen] { box-shadow: 0 0 0 calc(2px / var(--z)) ${VIOLET}; }
  .althar-board > iframe, .althar-board > img { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
  .althar-board > img { object-fit: contain; }
  .althar-name { position: absolute; left: 0; bottom: 100%; box-sizing: border-box; transform-origin: 0 100%;
    width: calc(var(--w) * var(--z) * 1px); transform: scale(calc(1 / var(--z))); padding-bottom: 7px;
    display: flex; gap: 8px; align-items: baseline; white-space: nowrap; font-size: 12px; line-height: 16px; color: var(--t-2, #555); }
  .althar-name b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .althar-name span { color: var(--t-4, #999); font-variant-numeric: tabular-nums; flex: none; }
  .althar-board[data-chosen] .althar-name { color: ${VIOLET}; }
  .althar-board[data-narrow] .althar-name span { display: none; }
  .althar-row-name { position: absolute; left: 0; transform-origin: 0 100%; transform: scale(calc(1 / var(--z)));
    font-size: 15px; line-height: 20px; font-weight: 600; color: var(--t-1, #222); white-space: nowrap; cursor: pointer; }
  .althar-row-name:hover { color: ${VIOLET}; }
  [data-small] .althar-name { display: none; }
  .althar-catch { position: fixed; inset: 0; cursor: default; }
  .althar-catch[data-tool='point'] { cursor: crosshair; }
  .althar-catch[data-tool='hand'], .althar-catch[data-moving] { cursor: grab; }
  .althar-catch[data-dragging] { cursor: grabbing; }
  .althar-catch[data-tool='use']:not([data-moving]) { pointer-events: none; }
  .althar-controls { position: fixed; inset: 0; pointer-events: none; z-index: 1; }
  [hidden] { display: none !important; }
`

const OVERLAY = `
  :host { all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;
    pointer-events: none !important; display: block !important; contain: strict !important; }
  .outline { position: fixed; box-sizing: border-box; border: 2px solid ${VIOLET}; border-radius: 3px;
    background: rgba(122, 63, 240, 0.08); pointer-events: none; }
  .outline.taken { background: rgba(122, 63, 240, 0.14); }
  .name { position: fixed; padding: 2px 6px; border-radius: 4px; background: ${VIOLET}; color: #fff;
    font: 500 11px/16px 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Menlo, monospace; white-space: nowrap; pointer-events: none; }
  .name span { opacity: 0.72; margin-left: 6px; }
  .pin { position: fixed; box-sizing: border-box; width: 22px; height: 22px; border-radius: 11px; border: 2px solid #fff;
    background: ${VIOLET}; color: #fff; font: 600 11px/18px 'Inter Variable', Inter, system-ui, sans-serif; text-align: center;
    pointer-events: auto; cursor: pointer; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); font-variant-numeric: tabular-nums; }
  .pin.answered { background: #8b8478; }
  .pin.draft { background: #fff; color: ${VIOLET}; border-color: ${VIOLET}; }
  [hidden] { display: none !important; }
`

/** What a press on a board takes: the part the design names, where it names one; else the nearest element with words, or a small one. */
const pickable = (target: Element | null): Element | null => {
  const named = target?.closest('[data-part]')
  if (named !== null && named !== undefined) return named
  let at = target
  while (at !== null && at.tagName !== 'BODY' && at.tagName !== 'HTML') {
    const box = at.getBoundingClientRect()
    const words = (at.textContent ?? '').trim()
    if (box.width > 24 && box.height > 14 && (words !== '' || box.width < 400)) return at
    at = at.parentElement
  }
  return target
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

interface Placed {
  readonly page: number
  readonly board: number
  readonly def: GroundBoard
  readonly x: number
  readonly y: number
  readonly node: HTMLElement
  readonly frame: HTMLIFrameElement | HTMLImageElement
}

const install = (): Ground => {
  const style = document.createElement('style')
  style.textContent = STYLE
  const world = document.createElement('div')
  world.className = 'althar-world'
  const catcher = document.createElement('div')
  catcher.className = 'althar-catch'
  const host = document.createElement('althar-ground')
  const root = host.attachShadow({ mode: 'closed' })
  const overlayStyle = document.createElement('style')
  overlayStyle.textContent = OVERLAY
  const outline = document.createElement('div')
  outline.className = 'outline'
  outline.hidden = true
  const name = document.createElement('div')
  name.className = 'name'
  name.hidden = true
  const pinLayer = document.createElement('div')
  root.append(overlayStyle, outline, name, pinLayer)
  // The controls float over the boards and the catcher, in the kit's type; its menus open on the body, over them.
  const layer = document.createElement('div')
  layer.className = 'althar-controls ch-root'
  document.body.classList.add('ch-root')

  /* Kept in the page: a board that rewrites its parent's document can take them out with it. */
  const mounted = () => {
    if (!style.isConnected) document.head.append(style)
    if (!world.isConnected) document.body.append(world)
    if (!catcher.isConnected) document.body.append(catcher)
    if (!layer.isConnected) document.body.append(layer)
    if (!host.isConnected) document.documentElement.append(host)
  }

  let pages: ReadonlyArray<GroundPage> = []
  let placed: ReadonlyArray<Placed> = []
  let state: GroundState = { view: 'every', page: 0, board: { page: 0, board: 0 }, zoom: 1, tool: 'point' }
  let pan = { x: 0, y: 0 }
  /* Fitted since it was last moved: a view that grows or shrinks fits again. */
  let fitted = true
  /* Whether the person has chosen a board yet: only then is it marked. */
  let picked = false
  let seq = 0
  let events: Array<{ readonly seq: number; readonly event: GroundEvent }> = []
  let waiting: Array<() => void> = []
  let pins: ReadonlyArray<GroundPin & { readonly node: HTMLElement }> = []
  /* The part under the pointer, the one outlined (it, or one of its parents after widening), and the one taken. */
  let under: { readonly placed: Placed; readonly element: Element } | null = null
  let outlined: { readonly placed: Placed; readonly element: Element } | null = null
  let taken: { readonly placed: Placed; readonly element: Element } | null = null
  let frame = 0
  let spaceHeld = false

  const news = (): GroundNews => ({ seq, state, events: [] })
  /* Drawn again as the ground changes; made once `set` is. */
  let showControls = () => {}
  /* Beside a conversation, what its chip shows; null for none. */
  let chip: { readonly title: string; readonly comment: boolean } | null = null
  const changed = () => {
    showControls()
    seq += 1
    const ready = waiting
    waiting = []
    for (const wake of ready) wake()
  }
  const tell = (event: GroundEvent) => {
    seq += 1
    events.push({ seq, event })
    if (events.length > 40) events = events.slice(-40)
    changed()
  }

  const all = () => pages.flatMap((page, p) => page.boards.map((def, b) => ({ page: p, board: b, def })))
  const exists = (at: GroundAt) => pages[at.page]?.boards[at.board] !== undefined

  /** The room fitting has: the view, less its margin and the names over the boards. */
  const above = () => (state.view === 'every' && state.page === -1 && pages.length > 1 ? PAGE_ROOM : 28)
  const room = () => ({ width: Math.max(1, window.innerWidth - PAD * 2), height: Math.max(1, window.innerHeight - PAD * 2 - above()) })

  /**
   * Where each board goes, its page's boards in lines of `columns`, a page
   * under the one before, with room over each line for the boards' names and
   * over each page for its own, at the zoom they will be seen at.
   */
  const arrange = (
    sections: ReadonlyArray<{ readonly page: number; readonly boards: ReadonlyArray<number> }>,
    columns: number,
    zoom: number,
  ) => {
    const spots: Array<{ readonly page: number; readonly board: number; readonly x: number; readonly y: number }> = []
    const titles: Array<{ readonly page: number; readonly y: number }> = []
    const between = Math.max(GAP, NAME_ROOM / zoom)
    const titled = sections.length > 1
    let y = 0
    let right = 0
    for (const [at, section] of sections.entries()) {
      const page = pages[section.page]
      if (page === undefined) continue
      if (titled) {
        if (at > 0) y += Math.max(GAP * 2, (PAGE_ROOM + NAME_ROOM) / zoom)
        titles.push({ page: section.page, y })
      }
      for (let start = 0; start < section.boards.length; start += columns) {
        if (start > 0) y += between
        let x = 0
        let tallest = 0
        for (const board of section.boards.slice(start, start + columns)) {
          const def = page.boards[board]
          if (def === undefined) continue
          spots.push({ page: section.page, board, x, y })
          x += def.width + GAP
          tallest = Math.max(tallest, def.height)
        }
        right = Math.max(right, x - GAP)
        y += tallest
      }
    }
    return { spots, titles, width: Math.max(1, right), height: Math.max(1, y) }
  }

  /** The lines the boards go in: as many to a line as shows them largest in the view, at least one. */
  const plan = (sections: ReadonlyArray<{ readonly page: number; readonly boards: ReadonlyArray<number> }>) => {
    const most = Math.max(1, ...sections.map((one) => one.boards.length))
    const space = room()
    const zoomOf = (box: { readonly width: number; readonly height: number }) =>
      clamp(Math.min(space.width / box.width, space.height / box.height, 1), MIN_ZOOM, MAX_ZOOM)
    let best: { readonly made: ReturnType<typeof arrange>; readonly zoom: number } | null = null
    for (let columns = 1; columns <= most; columns += 1) {
      // Twice: the room for names depends on the zoom, which depends on the room.
      const first = arrange(sections, columns, zoomOf(arrange(sections, columns, 1)))
      const zoom = zoomOf(first)
      const made = arrange(sections, columns, zoom)
      if (best === null || zoomOf(made) > best.zoom + 1e-4) best = { made, zoom: zoomOf(made) }
    }
    return best?.made ?? arrange(sections, 1, 1)
  }

  /** The boards shown and where each is in the world: a page's, every page's, or the one board. */
  const layout = () => {
    world.replaceChildren()
    const made: Array<Placed> = []
    const sections =
      state.view === 'one'
        ? [{ page: state.board.page, boards: [state.board.board] }]
        : (state.page === -1 ? pages.map((_, p) => p) : [clamp(state.page, 0, pages.length - 1)]).map((p) => ({
            page: p,
            boards: (pages[p]?.boards ?? []).map((_, b) => b),
          }))
    const { spots, titles } = plan(sections)
    for (const title of titles) {
      const node = document.createElement('div')
      node.className = 'althar-row-name'
      node.textContent = pages[title.page]?.name ?? ''
      node.dataset.page = String(title.page)
      node.style.top = `${title.y}px`
      node.style.translate = '0 calc(-100% - 34px / var(--z))'
      world.append(node)
    }
    for (const spot of spots) {
      const def = pages[spot.page]?.boards[spot.board]
      if (def === undefined) continue
      const node = document.createElement('div')
      node.className = 'althar-board'
      node.style.cssText = `left:${spot.x}px;top:${spot.y}px;width:${def.width}px;height:${def.height}px;--w:${def.width}`
      const label = document.createElement('div')
      label.className = 'althar-name'
      const title = document.createElement('b')
      title.textContent = def.name
      const size = document.createElement('span')
      size.textContent = `${def.width} × ${def.height}`
      label.append(title, size)
      const content = PICTURE.test(def.file) ? document.createElement('img') : document.createElement('iframe')
      content.src = addressOf(def.file)
      if (content instanceof HTMLIFrameElement) content.title = def.name
      else content.alt = def.name
      node.append(label, content)
      world.append(node)
      made.push({ page: spot.page, board: spot.board, def, x: spot.x, y: spot.y, node, frame: content })
    }
    placed = made
    chosen()
  }

  const chosen = () => {
    for (const one of placed)
      one.node.toggleAttribute(
        'data-chosen',
        picked && state.view === 'every' && one.page === state.board.page && one.board === state.board.board,
      )
  }

  const bounds = () => {
    let left = Number.POSITIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    for (const one of placed) {
      left = Math.min(left, one.x)
      top = Math.min(top, one.y)
      right = Math.max(right, one.x + one.def.width)
      bottom = Math.max(bottom, one.y + one.def.height)
    }
    return placed.length === 0 ? { left: 0, top: 0, width: 1, height: 1 } : { left, top, width: right - left, height: bottom - top }
  }

  const apply = () => {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${state.zoom})`
    world.style.setProperty('--z', String(state.zoom))
    world.toggleAttribute('data-small', state.zoom < NAMES_FROM)
    // A board too narrow on screen for its name and its size keeps its name.
    for (const one of placed) one.node.toggleAttribute('data-narrow', one.def.width * state.zoom < 260)
    redraw()
    showControls()
  }

  /** Fits what shows into the view, with room for the names over it; never larger than its own size. */
  const fit = () => {
    const box = bounds()
    const space = room()
    const zoom = clamp(Math.min(space.width / box.width, space.height / box.height, 1), MIN_ZOOM, MAX_ZOOM)
    state = { ...state, zoom }
    pan = {
      x: (window.innerWidth - box.width * zoom) / 2 - box.left * zoom,
      y: (window.innerHeight - box.height * zoom) / 2 - box.top * zoom + above() / 2,
    }
    fitted = true
    apply()
  }

  /** Zooms to `zoom`, keeping the point at `about` (in the view's pixels) where it is. */
  const zoomTo = (zoom: number, about = { x: window.innerWidth / 2, y: window.innerHeight / 2 }) => {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    const worldX = (about.x - pan.x) / state.zoom
    const worldY = (about.y - pan.y) / state.zoom
    pan = { x: about.x - worldX * next, y: about.y - worldY * next }
    state = { ...state, zoom: next }
    fitted = false
    apply()
    changed()
  }

  const ZOOMS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4]

  /** The board and the part of it under a point of the view, where there is one. */
  const at = (x: number, y: number): { readonly placed: Placed; readonly element: Element } | null => {
    const wx = (x - pan.x) / state.zoom
    const wy = (y - pan.y) / state.zoom
    const one = placed.find((p) => wx >= p.x && wx < p.x + p.def.width && wy >= p.y && wy < p.y + p.def.height)
    if (one === undefined) return null
    if (one.frame instanceof HTMLImageElement) return { placed: one, element: one.frame }
    const inside = one.frame.contentDocument
    const element = inside?.elementFromPoint(wx - one.x, wy - one.y) ?? null
    return { placed: one, element: pickable(element) ?? one.frame }
  }

  /** A part's box on the ground: its box in its board, moved and scaled as the board is. */
  const boxOf = (part: { readonly placed: Placed; readonly element: Element }): Box => {
    const inner =
      part.element === part.placed.frame
        ? new DOMRect(0, 0, part.placed.def.width, part.placed.def.height)
        : part.element.getBoundingClientRect()
    return {
      x: pan.x + (part.placed.x + inner.x) * state.zoom,
      y: pan.y + (part.placed.y + inner.y) * state.zoom,
      width: inner.width * state.zoom,
      height: inner.height * state.zoom,
    }
  }

  /** A part as a comment carries it: described inside its board (a picture's board is its whole picture). */
  const partOf = (part: { readonly placed: Placed; readonly element: Element }): GroundPart => {
    const { placed: one, element } = part
    const page = pages[one.page]?.name ?? ''
    const box = boxOf(part)
    const picked: Picked =
      element === one.frame || !(one.frame instanceof HTMLIFrameElement) || one.frame.contentWindow === null
        ? {
            selector: ':root',
            label: 'the board',
            text: '',
            rect: { x: 0, y: 0, width: one.def.width, height: one.def.height },
            font: '',
            colour: '',
            background: '',
            page: { width: one.def.width, height: one.def.height },
          }
        : describe(element, one.frame.contentWindow)
    return { page, board: one.def.name, picked, at: box }
  }

  const draw = () => {
    frame = 0
    mounted()
    const shown = taken ?? (state.tool === 'point' && !spaceHeld ? outlined : null)
    if (shown !== null && shown.element.isConnected) {
      const box = boxOf(shown)
      Object.assign(outline.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` })
      outline.classList.toggle('taken', taken !== null)
      outline.hidden = false
      if (taken === null) {
        const inside = shown.element.getBoundingClientRect()
        name.textContent = shown.element === shown.placed.frame ? shown.placed.def.name : partOf(shown).picked.label
        const size = document.createElement('span')
        size.textContent = `${Math.round(inside.width)} × ${Math.round(inside.height)}`
        name.append(size)
        name.hidden = false
        const above = box.y - 22 >= 4
        Object.assign(name.style, {
          left: `${clamp(box.x, 4, window.innerWidth - name.offsetWidth - 4)}px`,
          top: `${above ? box.y - 22 : Math.min(box.y + box.height + 4, window.innerHeight - 22)}px`,
        })
      } else name.hidden = true
    } else {
      outline.hidden = true
      name.hidden = true
    }
    for (const pin of pins) {
      const one = placed.find((p) => pages[p.page]?.name === pin.page && p.def.name === pin.board)
      const element = one === undefined ? null : elementIn(one, pin.selector)
      if (one === undefined || element === null) {
        pin.node.hidden = true
        continue
      }
      const box = boxOf({ placed: one, element })
      pin.node.hidden = box.y + box.height < 0 || box.y > window.innerHeight || box.x > window.innerWidth || box.x + box.width < 0
      pin.node.style.left = `${clamp(box.x + box.width - 11, 2, window.innerWidth - 24)}px`
      pin.node.style.top = `${clamp(box.y - 11, 2, window.innerHeight - 24)}px`
    }
  }
  const redraw = () => {
    if (frame === 0) frame = requestAnimationFrame(draw)
  }

  const elementIn = (one: Placed, selector: string): Element | null => {
    if (selector === ':root' || !(one.frame instanceof HTMLIFrameElement)) return one.frame
    try {
      return one.frame.contentDocument?.querySelector(selector) ?? null
    } catch {
      return null
    }
  }

  const moving = () => state.tool === 'hand' || spaceHeld
  const showTool = () => {
    catcher.dataset.tool = state.tool
    catcher.toggleAttribute('data-moving', spaceHeld)
  }

  /* ——— The pointer ——— */

  let drag: { readonly x: number; readonly y: number; readonly pan: { x: number; y: number } } | null = null

  catcher.addEventListener('pointermove', (event) => {
    if (drag !== null) {
      pan = { x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y }
      fitted = false
      apply()
      return
    }
    if (state.tool !== 'point' || moving()) return
    under = at(event.clientX, event.clientY)
    outlined = under
    redraw()
  })
  catcher.addEventListener('pointerleave', () => {
    if (taken !== null) return
    under = null
    outlined = null
    redraw()
  })
  catcher.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.button === 1 || moving()) {
      catcher.setPointerCapture(event.pointerId)
      catcher.toggleAttribute('data-dragging', true)
      drag = { x: event.clientX, y: event.clientY, pan }
      return
    }
    if (event.button !== 0) return
    // A page's name opens that page; a board's name, that board on its own.
    const label = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element.closest('.althar-name, .althar-row-name'))
    const row = label?.closest<HTMLElement>('.althar-row-name')
    if (row !== null && row !== undefined) return void set({ page: Number(row.dataset.page), view: 'every' })
    const board = label?.closest('.althar-board')
    const named = placed.find((one) => one.node === board)
    if (named !== undefined) return void set({ board: { page: named.page, board: named.board }, view: 'one' })
    if (state.tool !== 'point') return
    const part = outlined ?? at(event.clientX, event.clientY)
    if (part === null) {
      taken = null
      redraw()
      return
    }
    state = { ...state, board: { page: part.placed.page, board: part.placed.board } }
    picked = true
    chosen()
    taken = part
    redraw()
    tell({ kind: 'pointed', ...partOf(part) })
  })
  const release = (event: PointerEvent) => {
    if (drag === null) return
    drag = null
    catcher.toggleAttribute('data-dragging', false)
    if (catcher.hasPointerCapture(event.pointerId)) catcher.releasePointerCapture(event.pointerId)
    changed()
  }
  catcher.addEventListener('pointerup', release)
  catcher.addEventListener('pointercancel', release)
  for (const kind of ['click', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu'])
    catcher.addEventListener(kind, (event) => {
      event.preventDefault()
      event.stopPropagation()
    })

  // Scrolling moves the canvas; pinching, or scrolling with Control or Command held, zooms it about the pointer.
  document.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const scale = event.deltaMode === 1 ? 0.05 : 0.01
        zoomTo(state.zoom * Math.exp(-event.deltaY * scale), { x: event.clientX, y: event.clientY })
        return
      }
      const step = event.deltaMode === 1 ? 16 : 1
      pan = {
        x: pan.x - (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * step,
        y: pan.y - (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * step,
      }
      fitted = false
      apply()
    },
    { passive: false },
  )

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || controls.owns(event)) return
    const key = event.key
    if (key === ' ') {
      event.preventDefault()
      if (!spaceHeld) {
        spaceHeld = true
        showTool()
        redraw()
      }
      return
    }
    if (key === 'Escape') {
      if (taken !== null) taken = null
      redraw()
      return tell({ kind: 'key', key: 'escape' })
    }
    if (key === '[') return tell({ kind: 'key', key: 'older' })
    if (key === ']') return tell({ kind: 'key', key: 'newer' })
    const lower = key.toLowerCase()
    if (lower === 'v') return void set({ tool: 'point' })
    if (lower === 'h') return void set({ tool: 'hand' })
    if (lower === 'u') return void set({ tool: 'use' })
    if (key === '!' || (key === '1' && event.shiftKey)) return void set({ zoom: 'fit' })
    if (key === ')' || (key === '0' && event.shiftKey)) return void set({ zoom: 1 })
    if (key === '=' || key === '+') return void set({ zoom: 'in' })
    if (key === '-' || key === '_') return void set({ zoom: 'out' })
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      event.preventDefault()
      return void set({ step: 1 })
    }
    if (key === 'ArrowLeft' || key === 'ArrowUp') {
      event.preventDefault()
      return void set({ step: -1 })
    }
  })
  document.addEventListener('keyup', (event) => {
    if (event.key !== ' ') return
    spaceHeld = false
    showTool()
    redraw()
  })
  window.addEventListener('blur', () => {
    if (!spaceHeld) return
    spaceHeld = false
    showTool()
  })
  // A view that grows or shrinks lays its boards out again for its new shape, where they were fitted to it.
  window.addEventListener('resize', () => {
    if (!fitted) return redraw()
    taken = null
    outlined = null
    layout()
    fit()
  })

  /* ——— What the main process asks, and the controls over the boards ——— */

  const set = (change: GroundChange): GroundNews => {
    mounted()
    if (change.chip !== undefined) chip = change.chip
    let relayout = false
    let refit = false
    if (change.tool !== undefined && change.tool !== state.tool) {
      state = { ...state, tool: change.tool }
      under = null
      outlined = null
      showTool()
      redraw()
    }
    if (change.board !== undefined && exists(change.board)) {
      state = { ...state, board: change.board }
      picked = true
      if (state.view === 'one') relayout = refit = true
      else if (state.page !== -1 && state.page !== change.board.page) state = { ...state, page: change.board.page }
      chosen()
    }
    if (change.page !== undefined && (change.page === -1 || pages[change.page] !== undefined) && change.page !== state.page) {
      state = { ...state, page: change.page }
      if (change.page !== -1 && state.board.page !== change.page) state = { ...state, board: { page: change.page, board: 0 } }
      relayout = refit = state.view === 'every' || change.view === 'every'
    }
    if (change.view !== undefined && change.view !== state.view) {
      state = { ...state, view: change.view }
      relayout = refit = true
    }
    if (change.step !== undefined) {
      const list = all()
      const here = list.findIndex((one) => one.page === state.board.page && one.board === state.board.board)
      const next = list[clamp(here + change.step, 0, list.length - 1)]
      if (next !== undefined && (next.page !== state.board.page || next.board !== state.board.board)) {
        picked = true
        state = { ...state, board: { page: next.page, board: next.board }, ...(state.page !== -1 ? { page: next.page } : {}) }
        relayout = state.view === 'one' || state.page !== -1
        refit = state.view === 'one'
        chosen()
      }
    }
    if (relayout) {
      taken = null
      outlined = null
      under = null
      layout()
    }
    if (change.zoom === 'fit' || refit) fit()
    else if (change.zoom === 'in') zoomTo(ZOOMS.find((one) => one > state.zoom + 0.001) ?? MAX_ZOOM)
    else if (change.zoom === 'out') zoomTo(ZOOMS.findLast((one) => one < state.zoom - 0.001) ?? MIN_ZOOM)
    else if (typeof change.zoom === 'number') zoomTo(change.zoom)
    // In every board, the board chosen by a step is brought into view.
    if (change.step !== undefined && state.view === 'every') {
      const one = placed.find((p) => p.page === state.board.page && p.board === state.board.board)
      if (one !== undefined) {
        const box = boxOf({ placed: one, element: one.frame })
        if (box.x < 0 || box.x + box.width > window.innerWidth || box.y < 0 || box.y + box.height > window.innerHeight) {
          pan = { x: pan.x + window.innerWidth / 2 - (box.x + box.width / 2), y: pan.y + window.innerHeight / 2 - (box.y + box.height / 2) }
          fitted = false
          apply()
        }
      }
    }
    changed()
    return news()
  }
  const controls = controlsIn(layer, (change) => void set(change))
  showControls = () =>
    controls.show(
      pages,
      state,
      chip === null
        ? null
        : {
            title: chip.title,
            onOpen: () => tell({ kind: 'key', key: 'open' }),
            onClose: () => tell({ kind: 'key', key: 'close' }),
            ...(chip.comment ? { onComment: () => tell({ kind: 'key', key: 'comment' }) } : {}),
          },
    )

  return {
    start: (given, asked) => {
      mounted()
      pages = given
      const board = asked.board !== undefined && exists(asked.board) ? asked.board : { page: 0, board: 0 }
      const page = asked.page !== undefined && (asked.page === -1 || pages[asked.page] !== undefined) ? asked.page : board.page
      state = { view: asked.view ?? 'every', page, board, zoom: 1, tool: asked.tool ?? 'point' }
      showTool()
      layout()
      fit()
      changed()
      return news()
    },
    set,
    next: (after) =>
      new Promise<GroundNews>((done) => {
        const answer = () => {
          clearTimeout(quiet)
          done({ seq, state, events: events.filter((one) => one.seq > after).map((one) => one.event) })
        }
        const quiet = setTimeout(() => {
          waiting = waiting.filter((one) => one !== answer)
          answer()
        }, QUIET_MS)
        if (seq > after) answer()
        else waiting.push(answer)
      }),
    pins: (list) => {
      mounted()
      for (const pin of pins) pin.node.remove()
      pins = list.map((pin) => {
        const node = document.createElement('div')
        node.className = `pin${pin.answered ? ' answered' : ''}${pin.draft ? ' draft' : ''}`
        node.textContent = String(pin.n)
        node.hidden = true
        node.addEventListener('pointerdown', (event) => {
          event.preventDefault()
          event.stopPropagation()
          tell({ kind: 'pin', n: pin.n })
        })
        pinLayer.append(node)
        return { ...pin, node }
      })
      redraw()
      return list
        .filter((pin) => {
          const one = placed.find((p) => pages[p.page]?.name === pin.page && p.def.name === pin.board)
          return one !== undefined && elementIn(one, pin.selector) !== null
        })
        .map((pin) => pin.n)
    },
    find: (page, board, selector) => {
      const p = pages.findIndex((one) => one.name === page)
      const b = pages[p]?.boards.findIndex((one) => one.name === board) ?? -1
      if (p === -1 || b === -1) return null
      let one = placed.find((x) => x.page === p && x.board === b)
      if (one === undefined) {
        set({ board: { page: p, board: b }, ...(state.page !== -1 ? { page: p } : {}) })
        one = placed.find((x) => x.page === p && x.board === b)
      }
      if (one === undefined) return null
      const element = elementIn(one, selector)
      if (element === null) return null
      taken = { placed: one, element }
      const box = boxOf(taken)
      if (box.x < 0 || box.x + box.width > window.innerWidth || box.y < 0 || box.y + box.height > window.innerHeight) {
        pan = { x: pan.x + window.innerWidth / 2 - (box.x + box.width / 2), y: pan.y + window.innerHeight / 2 - (box.y + box.height / 2) }
        fitted = false
        apply()
        changed()
      }
      redraw()
      return partOf(taken)
    },
    clear: () => {
      taken = null
      outlined = null
      under = null
      redraw()
    },
  }
}

declare global {
  // The ground's handle, in its isolated world's own global: the page's world and the boards' never see it.
  var __altharGround: Ground | undefined
}

/* Made once a world: the first run installs it, and a later run in the same world finds it there. */
globalThis.__altharGround ??= install()
