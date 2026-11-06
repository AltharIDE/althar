// Scrappy: what every direction's page shares: its pages and their history, the task's preview, the comments gathered, and what was sent.
import { useSyncExternalStore } from 'react'

import { normalized, RUNS, runOf, serve, verdictOf } from './addresses'
import { items, OTHER, sentPicture, TASK } from './data'

export type Direction = 'A' | 'B' | 'C' | 'D' | 'E'

export const DIRECTIONS: ReadonlyArray<{ value: Direction; name: string; about: string }> = [
  { value: 'A', name: 'A browser tab', about: 'Althar is where you browse while you work: any page in a tab beside the projects' },
  { value: 'B', name: 'The task’s preview', about: 'A Preview face on each task: its run, and comments to its lead' },
  { value: 'C', name: 'Compare the change', about: 'The task’s run against main’s, with the lead’s screenshots laid over the live page' },
  { value: 'D', name: 'Shared with the lead', about: 'C, with the lead using the same browser while you watch, and you taking over' },
  {
    value: 'E',
    name: 'Beside the conversation',
    about: 'Any page opens on the conversation’s right, its comments in the composer; a tab of its own or your browser if you want',
  },
]

/** Where comments go: a task's lead, or the project's coordinator. */
export type Destination = { readonly kind: 'task'; readonly taskId: string } | { readonly kind: 'coordinator' }

/** A page in a tab of its own (A), or a task's preview (B, C): its history, and where it came from. */
export interface Page {
  readonly id: string
  readonly history: ReadonlyArray<string>
  readonly at: number
  readonly from: Destination | null
  /** Drawn again from the top. */
  readonly reloads: number
  /** Its title, once the page said it. */
  readonly title?: string
}

/** What was pointed at: the element, as the lead will read it, and where on the page it was. */
export interface Picked {
  readonly scope: string
  readonly address: string
  /** The frame's own address: what the crop is drawn from. */
  readonly src: string
  readonly selector: string
  /** The element at a glance: span.needs. */
  readonly label: string
  readonly text: string
  /** Where it is in the viewport as pointed at, and the viewport. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  readonly viewport: { readonly w: number; readonly h: number }
  readonly scroll: number
}

export interface Crop {
  readonly digest: string
  readonly width: number
  readonly height: number
  readonly bytes: number
}

export interface Comment extends Picked {
  readonly id: string
  readonly note: string
  /** Its picture of the spot: drawing, drawn, or none to be had. */
  readonly crop: Crop | 'drawing' | 'failed'
}

/** A line under a page's bar: something refused, asked, or sent, with what to do about it. */
export type Line =
  | { readonly kind: 'scheme'; readonly scheme: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'permission'; readonly what: string; readonly host: string }
  | { readonly kind: 'sent'; readonly count: number; readonly to: Destination }

export type Mode = 'side' | 'swipe' | 'onion'
export type Width = 'wide' | 'narrow'

/** D: what the lead is doing in the browser, step by step, and who has it. */
export interface Driving {
  readonly by: 'lead' | 'person' | 'done'
  readonly step: number
  readonly said: string
  /** Where the lead's pointer is, in the page as drawn, as a share of its width and height. */
  readonly cursor: { readonly x: number; readonly y: number } | null
  readonly flash: boolean
  /** Where the lead scrolled the page to. */
  readonly scroll: number | null
  /** The screenshots it took, by digest. */
  readonly shots: ReadonlyArray<string>
}

export interface Proto {
  readonly direction: Direction
  readonly bare: boolean
  /* A: pages in tabs of their own, and the one that has the window. */
  readonly pages: ReadonlyArray<Page>
  readonly page: string | null
  /* B, C: the task's face is its preview, and the preview itself. */
  readonly face: boolean
  readonly preview: Page
  readonly running: 'up' | 'starting' | 'off'
  readonly mode: Mode
  readonly width: Width
  readonly swipe: number
  readonly onion: number
  /** C: the lead's screenshot laid over the live page, by its digest. */
  readonly evidence: string | null
  /* Every direction: pointing, the comment being written, those gathered, and what was sent. */
  readonly pointing: string | null
  readonly draft: (Picked & { readonly editing?: string }) | null
  readonly comments: ReadonlyArray<Comment>
  readonly lines: Readonly<Record<string, Line | undefined>>
  readonly sent: Readonly<Record<string, ReadonlyArray<ReturnType<typeof items.you>>>>
  /** The prototype's own note: where the app would have sent an address instead. */
  readonly outside: string | null
  readonly driving: Driving | null
  /** Which go of the task's branch its run serves: the lead's first, or its second after the comments. */
  readonly revision: number
  /* E: the page open beside each conversation, by its thread, and how wide the workbench it is on is. */
  readonly side: Readonly<Record<string, Page | undefined>>
  readonly bench: number
}

const preview = (address: string = RUNS.task.address): Page => ({
  id: 'preview',
  history: [address],
  at: 0,
  from: { kind: 'task', taskId: TASK.id },
  reloads: 0,
})

/** Half the window, leaving the conversation its measure: a page needs more room than a document. */
export const benchStart = () => Math.round(Math.max(480, Math.min(window.innerWidth / 2, window.innerWidth - 440)))

const fresh = (): Proto => ({
  direction: 'A',
  bare: false,
  pages: [],
  page: null,
  face: false,
  preview: preview(),
  running: 'up',
  mode: 'side',
  width: 'wide',
  swipe: 0.5,
  onion: 0.5,
  evidence: null,
  pointing: null,
  draft: null,
  comments: [],
  lines: {},
  sent: {},
  outside: null,
  driving: null,
  revision: 1,
  side: {},
  bench: benchStart(),
})

let state: Proto = fresh()
const listeners = new Set<() => void>()

const set = (next: Partial<Proto>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

let made = 0
const nextId = (prefix: string) => `${prefix}${(made += 1)}`

/** A page's address now. */
export const addressOf = (page: Page) => page.history[page.at] ?? ''

/** E: a page beside a conversation is that thread's. */
export const SIDE = 'side:'
export const sideScope = (thread: string) => `${SIDE}${thread}`

/** The conversation the window is on: a task's thread, or the project's coordinator. */
export const threadHere = () => /^#\/threads\/([^/?]+)/.exec(window.location.hash)?.[1] ?? 'thc'

/** Where what is said in a thread goes. */
export const destinationOfThread = (thread: string): Destination =>
  thread === TASK.threadId
    ? { kind: 'task', taskId: TASK.id }
    : thread === OTHER.threadId
      ? { kind: 'task', taskId: OTHER.id }
      : { kind: 'coordinator' }

const threadOf = (to: Destination | null) =>
  to === null || to.kind === 'coordinator' ? 'thc' : to.taskId === OTHER.id ? OTHER.threadId : TASK.threadId

const hashOf = (thread: string) => (thread === 'thc' ? '#/projects/p1' : `#/threads/${thread}`)

/** The page for a scope: a tab's (A), the preview (B, C), or one beside a conversation (E). */
export const pageOf = (scope: string): Page | undefined =>
  scope === 'preview'
    ? state.preview
    : scope.startsWith(SIDE)
      ? state.side[scope.slice(SIDE.length)]
      : state.pages.find((one) => one.id === scope)

const changePage = (scope: string, next: (page: Page) => Page) => {
  if (scope === 'preview') return set({ preview: next(state.preview) })
  if (scope.startsWith(SIDE)) {
    const thread = scope.slice(SIDE.length)
    const page = state.side[thread]
    return page === undefined ? undefined : set({ side: { ...state.side, [thread]: next(page) } })
  }
  set({ pages: state.pages.map((one) => (one.id === scope ? next(one) : one)) })
}

/** Where a page goes: a refused scheme stays where it was, with a line saying so; anything else is a step in its history. */
const goTo = (scope: string, typed: string) => {
  const address = normalized(typed)
  const verdict = verdictOf(address)
  if (verdict.kind === 'scheme' || verdict.kind === 'file') {
    const line: Line = verdict.kind === 'file' ? { kind: 'file', path: verdict.path } : { kind: 'scheme', scheme: verdict.scheme }
    return set({ lines: { ...state.lines, [scope]: line } })
  }
  set({ lines: { ...state.lines, [scope]: undefined }, draft: null })
  changePage(scope, (page) => {
    if (addressOf(page) === address) return page
    const history = [...page.history.slice(0, page.at + 1), address]
    return { ...page, history, at: history.length - 1 }
  })
}

const flash = (note: string) => {
  set({ outside: note })
  window.setTimeout(() => {
    if (state.outside === note) set({ outside: null })
  }, 4200)
}

/** What the lead reads: each comment with its element, its text, and the address it is on; the crops go with it, in order. */
export const messageOf = (comments: ReadonlyArray<Comment>): string => {
  const addresses = [...new Set(comments.map((one) => one.address))]
  const viewport = comments[0]?.viewport
  const head =
    addresses.length === 1
      ? `${comments.length === 1 ? 'A comment' : `${comments.length} comments`} on ${addresses[0]}${viewport ? `, at ${viewport.w} × ${viewport.h}` : ''}:`
      : `${comments.length} comments on ${addresses.length} pages:`
  const body = comments.map((one, at) => {
    const where = addresses.length === 1 ? '' : ` on ${one.address}`
    const text = one.text === '' ? '' : ` “${one.text}”`
    return `${at + 1}. ${one.selector}${text}${where}\n${one.note}`
  })
  return [head, ...body].join('\n\n')
}

export const proto = {
  get: () => state,
  set,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  startOver: () => {
    const { direction, bare } = state
    stopDriving()
    serve(1)
    state = { ...fresh(), direction, bare }
    for (const listener of listeners) listener()
  },

  /*
   * An address from a thread, the Running pill or a run's card. A: a page in a tab of its own, from where it was opened.
   * B, C: the task's run opens its preview face; anything else is the person's browser, as today.
   */
  open: (address: string, from: Destination | null) => {
    const verdict = verdictOf(normalized(address))
    if (state.direction === 'A') {
      // A file or a script never opens a tab: the line says so where the link was, in the prototype's note.
      if (verdict.kind === 'file' || verdict.kind === 'scheme')
        return flash(verdict.kind === 'file' ? 'Files don’t open in Althar’s browser' : 'Only web pages open here')
      const same = state.pages.find((one) => addressOf(one) === verdict.address)
      if (same !== undefined) return set({ page: same.id })
      const page: Page = { id: nextId('page'), history: [verdict.address], at: 0, from, reloads: 0 }
      return set({ pages: [...state.pages, page], page: page.id })
    }
    if (state.direction === 'E') {
      if (verdict.kind === 'file' || verdict.kind === 'scheme')
        return flash(verdict.kind === 'file' ? 'Files don’t open in Althar’s browser' : 'Only web pages open here')
      return proto.beside(threadHere(), verdict.address)
    }
    if (runOf(verdict.address) === 'task') {
      proto.navigate('preview', verdict.address)
      set({ face: true })
      return window.location.assign(`#/threads/${TASK.threadId}`)
    }
    flash(`Opened in your browser: ${verdict.address}`)
  },
  /*
   * E: a page beside a conversation, on its workbench: a step in the page already there, or the first of one. Beside the
   * coordinator, the project goes to its Conversation view, the board stepping aside for the page.
   */
  beside: (thread: string, address: string) => {
    if (thread === 'thc') {
      const view = [...document.querySelectorAll('header [aria-checked], header [aria-pressed]')].find(
        (one) => one.textContent?.trim() === 'Conversation',
      )
      if (view instanceof HTMLElement && view.getAttribute('aria-checked') !== 'true' && view.getAttribute('aria-pressed') !== 'true')
        view.click()
    }
    const scope = sideScope(thread)
    if (state.side[thread] !== undefined) {
      goTo(scope, address)
    } else {
      const page: Page = { id: scope, history: [address], at: 0, from: destinationOfThread(thread), reloads: 0 }
      set({ side: { ...state.side, [thread]: page }, lines: { ...state.lines, [scope]: undefined } })
    }
  },
  closeSide: (thread: string) => {
    const scope = sideScope(thread)
    set({
      side: { ...state.side, [thread]: undefined },
      pointing: state.pointing === scope ? null : state.pointing,
      draft: state.draft?.scope === scope ? null : state.draft,
    })
  },
  /** E: the page beside a conversation becomes a tab of its own, its history and comments with it. */
  toTab: (thread: string) => {
    const page = state.side[thread]
    if (page === undefined) return
    const scope = sideScope(thread)
    const id = nextId('page')
    set({
      side: { ...state.side, [thread]: undefined },
      pages: [...state.pages, { ...page, id }],
      page: id,
      comments: state.comments.map((one) => (one.scope === scope ? { ...one, scope: id } : one)),
      lines: { ...state.lines, [id]: state.lines[scope], [scope]: undefined },
      pointing: null,
      draft: null,
    })
  },
  /** E: a tab back beside the conversation it came from. */
  dock: (id: string) => {
    const page = state.pages.find((one) => one.id === id)
    if (page === undefined) return
    const thread = threadOf(page.from)
    const scope = sideScope(thread)
    set({
      pages: state.pages.filter((one) => one.id !== id),
      page: null,
      side: { ...state.side, [thread]: { ...page, id: scope } },
      comments: state.comments.map((one) => (one.scope === id ? { ...one, scope } : one)),
      lines: { ...state.lines, [scope]: state.lines[id], [id]: undefined },
      pointing: null,
      draft: null,
    })
    window.location.assign(hashOf(thread))
  },
  /** A new, empty tab (A), its address bar ready for typing. */
  newPage: () => {
    const page: Page = { id: nextId('page'), history: [''], at: 0, from: null, reloads: 0 }
    set({ pages: [...state.pages, page], page: page.id })
  },
  closePage: (id: string) => {
    if (id.startsWith(SIDE)) return proto.closeSide(id.slice(SIDE.length))
    const at = state.pages.findIndex((one) => one.id === id)
    const pages = state.pages.filter((one) => one.id !== id)
    const page = state.page === id ? (pages[Math.min(at, pages.length - 1)]?.id ?? null) : state.page
    set({
      pages,
      page,
      comments: state.comments.filter((one) => one.scope !== id),
      pointing: state.pointing === id ? null : state.pointing,
    })
  },
  showPage: (id: string | null) => set({ page: id }),
  title: (scope: string, title: string) => changePage(scope, (page) => (page.title === title ? page : { ...page, title })),
  /** Where a page's comments go, as the person picked. */
  sendTo: (scope: string, to: Destination) => changePage(scope, (page) => ({ ...page, from: to })),

  navigate: goTo,
  back: (scope: string) => changePage(scope, (page) => ({ ...page, at: Math.max(0, page.at - 1) })),
  forward: (scope: string) => changePage(scope, (page) => ({ ...page, at: Math.min(page.history.length - 1, page.at + 1) })),
  reload: (scope: string) => changePage(scope, (page) => ({ ...page, reloads: page.reloads + 1 })),
  /** Sends where it is now to the person's browser. */
  outside: (address: string) => flash(`Opened in your browser: ${address}`),
  line: (scope: string, line: Line | undefined) => set({ lines: { ...state.lines, [scope]: line } }),

  /** The task's run, from the preview's own button: starting, then up. */
  run: () => {
    set({ running: 'starting' })
    window.setTimeout(() => set({ running: 'up' }), 1400)
  },

  /* Pointing and commenting. */
  point: (scope: string | null) => set({ pointing: scope, draft: null }),
  pick: (picked: Picked) => set({ draft: picked }),
  cancel: () => set({ draft: null }),
  edit: (id: string) => {
    const one = state.comments.find((each) => each.id === id)
    if (one !== undefined) set({ draft: { ...one, editing: id } })
  },
  add: (note: string) => {
    const draft = state.draft
    if (draft === null) return
    if (draft.editing !== undefined) {
      const id = draft.editing
      return set({ comments: state.comments.map((one) => (one.id === id ? { ...one, note } : one)), draft: null })
    }
    const id = nextId('c')
    const { editing: _editing, ...picked } = draft
    set({ comments: [...state.comments, { ...picked, id, note, crop: 'drawing' }], draft: null })
    // The spot, drawn as the person saw it: the element with a little room round it, at their viewport, where they had scrolled to.
    const pad = 16
    const x = Math.max(0, Math.floor(picked.box.x - pad))
    const y = Math.max(0, Math.floor(picked.box.y - pad))
    const cw = Math.min(picked.viewport.w - x, Math.ceil(picked.box.w + pad * 2))
    const ch = Math.min(picked.viewport.h - y, Math.ceil(picked.box.h + pad * 2))
    const query = new URLSearchParams({
      src: picked.src,
      w: String(picked.viewport.w),
      h: String(picked.viewport.h),
      scroll: String(picked.scroll),
      x: String(x),
      y: String(y),
      cw: String(cw),
      ch: String(ch),
    })
    fetch(`/__crop?${query.toString()}`)
      .then((answer) => (answer.ok ? (answer.json() as Promise<Crop>) : Promise.reject(new Error(String(answer.status)))))
      .then(
        (crop) => set({ comments: state.comments.map((one) => (one.id === id ? { ...one, crop } : one)) }),
        () => set({ comments: state.comments.map((one) => (one.id === id ? { ...one, crop: 'failed' } : one)) }),
      )
  },
  remove: (id: string) => set({ comments: state.comments.filter((one) => one.id !== id), draft: null }),
  discard: (scope: string) => set({ comments: state.comments.filter((one) => one.scope !== scope), draft: null, pointing: null }),

  /** One message to the lead (or the coordinator): the comments, their crops, and the lead answers a moment later. */
  send: (scope: string, to: Destination, said = '') => {
    const mine = state.comments.filter((one) => one.scope === scope)
    if (mine.length === 0) return
    const pictures = mine.flatMap((one, at) => (typeof one.crop === 'object' ? [sentPicture(one.crop, `comment-${at + 1}.png`)] : []))
    const thread = threadOf(to)
    const words = said.trim() === '' ? messageOf(mine) : `${said.trim()}\n\n${messageOf(mine)}`
    const message = items.you(words, { state: 'delivered', interrupting: false }, [], pictures)
    set({
      comments: state.comments.filter((one) => one.scope !== scope),
      sent: { ...state.sent, [thread]: [...(state.sent[thread] ?? []), message] },
      lines: { ...state.lines, [scope]: { kind: 'sent', count: mine.length, to } },
      pointing: null,
      draft: null,
    })
    window.setTimeout(() => {
      const answer = items.says(
        thread === TASK.threadId
          ? 'On it: Linux’s line gets shorter, and the band gets room for two lines at every width. I’ll take the screenshots again once it’s done.'
          : 'Thanks. I’ll pass these on with the page they’re about.',
      )
      set({ sent: { ...state.sent, [thread]: [...(state.sent[thread] ?? []), answer as ReturnType<typeof items.you>] } })
      if (thread !== TASK.threadId) return
      // Its second go lands in the task's folder, and its run serves it, as a dev server reloads.
      window.setTimeout(() => {
        proto.revise()
        if (state.direction === 'D' && state.face) proto.drive()
      }, 3600)
    }, 2400)
  },
  revise: () => {
    serve(2)
    // What shows the task's run draws it again, as its dev server reloads it.
    const side = Object.fromEntries(
      Object.entries(state.side).map(([thread, page]) => [
        thread,
        page !== undefined && runOf(addressOf(page)) === 'task' ? { ...page, reloads: page.reloads + 1 } : page,
      ]),
    )
    set({ revision: 2, preview: { ...state.preview, reloads: state.preview.reloads + 1 }, side })
  },

  /* D: the lead uses the preview, a step at a time, until it's done or the person takes it. */
  drive: () => {
    stopDriving()
    if (state.revision < 2) proto.revise()
    set({
      face: true,
      pointing: null,
      draft: null,
      driving: { by: 'lead', step: -1, said: 'Opening the task’s site', cursor: null, flash: false, scroll: 0, shots: [] },
    })
    stepDriving()
  },
  takeOver: () => {
    stopDriving()
    if (state.driving !== null) set({ driving: { ...state.driving, by: 'person', cursor: null, flash: false } })
  },
  giveBack: () => {
    if (state.driving === null) return
    set({ driving: { ...state.driving, by: 'lead' } })
    stepDriving()
  },
}

/** What the lead does in the preview, in order: what it says it's doing, where its pointer goes, what it scrolls, what it takes. */
const SCRIPT: ReadonlyArray<{
  said: string
  cursor: { x: number; y: number }
  scroll?: number
  width?: Width
  shot?: string
  navigate?: string
}> = [
  { said: 'Opening the task’s site', cursor: { x: 0.5, y: 0.16 }, navigate: RUNS.task.address, width: 'wide' },
  { said: 'Scrolling to Runs on', cursor: { x: 0.42, y: 0.55 }, scroll: 560 },
  { said: 'Reading the band', cursor: { x: 0.74, y: 0.2 } },
  { said: 'Taking a screenshot of the band', cursor: { x: 0.74, y: 0.21 }, shot: 'lead-band-wide-2' },
  { said: 'Trying a phone’s width', cursor: { x: 0.5, y: 0.5 }, width: 'narrow', scroll: 0 },
  { said: 'Scrolling to Runs on', cursor: { x: 0.5, y: 0.5 }, scroll: 600 },
  { said: 'Taking a screenshot on a phone', cursor: { x: 0.5, y: 0.35 }, shot: 'lead-band-narrow-2' },
]

let driver: number | null = null
const stopDriving = () => {
  if (driver !== null) window.clearTimeout(driver)
  driver = null
}
const stepDriving = () => {
  stopDriving()
  driver = window.setTimeout(() => {
    const now = state.driving
    if (now === null || now.by !== 'lead') return
    const step = now.step + 1
    const next = SCRIPT[step]
    if (next === undefined) {
      const pictures = now.shots.map((digest) => ({
        digest,
        mediaType: 'image/png',
        bytes: 120_000,
        width: digest.includes('narrow') ? 390 : 1280,
        height: digest.includes('narrow') ? 290 : 176,
        name: `${digest}.png`,
        unkept: null,
      }))
      const said = items.hands(
        'Checked in the preview: the band has room for its two lines now, Linux’s line is short, and Windows says arm64.',
        { pictures },
      )
      set({
        driving: { ...now, by: 'done', cursor: null, flash: false },
        sent: { ...state.sent, [TASK.threadId]: [...(state.sent[TASK.threadId] ?? []), said as ReturnType<typeof items.you>] },
      })
      return
    }
    if (next.navigate !== undefined) goTo('preview', next.navigate)
    set({
      ...(next.width === undefined ? {} : { width: next.width }),
      driving: {
        ...now,
        step,
        said: next.said,
        cursor: next.cursor,
        flash: next.shot !== undefined,
        scroll: next.scroll ?? now.scroll,
        shots: next.shot === undefined ? now.shots : [...now.shots, next.shot],
      },
    })
    if (next.shot !== undefined)
      window.setTimeout(() => state.driving !== null && set({ driving: { ...state.driving, flash: false } }), 260)
    stepDriving()
  }, 1700)
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)

/** The comments of one page, or of the preview. */
export const useComments = (scope: string) => useProto().comments.filter((one) => one.scope === scope)

/** Where a comment of a page goes by default: the task it came from, else the project's coordinator. */
export const destinationOf = (page: Page | undefined): Destination => page?.from ?? { kind: 'coordinator' }

export { RUNS, TASK, OTHER }
