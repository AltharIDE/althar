import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { LONGEST_SCRIPT, LONGEST_TEXT, type PageAnswer, type PageCall, type PageTarget, type PageViewport, WAIT } from './pageBridge'
import { settledAmong } from './settled'
import { POOL, type Tool, type ToolAccess, ToolRefused, type ToolPicture, ToolServer } from './ToolServer'

/*
 * The page beside a conversation, read and driven by the conversation's agent
 * (ADR-100): the lead beside its task's page, the coordinator beside its
 * project's. One set of tools for both (ADR-097), `page_*`, served to the pool
 * and asking nothing: the person decided a lead reads and drives the page
 * without asking, signed in or not. The page itself is in the desktop app's
 * main process, with Chromium: each tool turns what the agent asked into a
 * PageCall (pageBridge.ts) and hands it to the host (`RuntimeOptions.page`),
 * which answers in words for the agent, or says why it can't.
 *
 * Whose page it is never comes from the agent. The tools take no task or
 * project; the runtime reads the page's owner from the session's own access,
 * so a lead can reach no page but the one beside its task.
 */

type Input = Readonly<Record<string, unknown>>

/** Why an input is no call, thrown inside the parsing below and said whole to the agent. */
class Unclear {
  constructor(readonly message: string) {}
}

const LONGEST_SELECTOR = 4_000
const LONGEST_ADDRESS = 8_192
const LONGEST_WORDS = 500
const LONGEST_KEY = 60
const LONGEST_VALUE = 500
const MOST_VALUES = 50
const FARTHEST = 100_000

const VIEWPORTS: ReadonlyArray<PageViewport> = ['fit', 'desktop', 'laptop', 'tablet', 'phone']
const MOVES = ['back', 'forward', 'reload', 'stop'] as const

const recordOf = (input: unknown): Input => (typeof input === 'object' && input !== null ? (input as Input) : {})

/** A string input, trimmed of nothing: null where it isn't given; an error where it is given as anything else. */
const stringIn = (input: Input, key: string, longest: number): string | null => {
  const value = input[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Unclear(`${key} should be text.`)
  if (value.length > longest)
    throw new Unclear(`${key} is ${value.length} characters long; at most ${longest.toLocaleString('en')} go in one call.`)
  if (value.includes('\u0000')) throw new Unclear(`${key} can’t hold a null character.`)
  return value
}

const flagIn = (input: Input, key: string, otherwise: boolean): boolean => {
  const value = input[key]
  if (value === undefined || value === null) return otherwise
  if (typeof value !== 'boolean') throw new Unclear(`${key} should be true or false.`)
  return value
}

const oneOf = <T extends string>(input: Input, key: string, allowed: ReadonlyArray<T>): T | null => {
  const value = input[key]
  if (value === undefined || value === null) return null
  const found = allowed.find((one) => one === value)
  if (found === undefined) throw new Unclear(`${key} should be one of ${allowed.join(', ')}.`)
  return found
}

/** A reference as `page_snapshot` writes it, `e12`; `[ref=e12]` and `ref=e12`, as the snapshot prints them, are read as it. */
const refOf = (raw: string): string | null => /^(?:\[?ref=)?(e\d{1,9})\]?$/.exec(raw.trim().toLowerCase())?.[1] ?? null

/** The element an input names, by `ref` or `selector`, one of the two: null where it names none and one isn't needed. */
const targetIn = (input: Input, needed: boolean): PageTarget | null => {
  const ref = stringIn(input, 'ref', 100)
  const selector = stringIn(input, 'selector', LONGEST_SELECTOR)
  const named = ref !== null && ref.trim() !== ''
  const selected = selector !== null && selector.trim() !== ''
  if (named && selected) throw new Unclear('Name the element by ref or by selector, not both.')
  if (named) {
    const found = refOf(ref)
    if (found === null) throw new Unclear(`${ref} isn’t a reference. Take one from page_snapshot, such as e12, or give a selector.`)
    return { ref: found }
  }
  if (selected) return { selector: selector.trim() }
  if (needed) throw new Unclear('Say which element: its ref from page_snapshot, such as e12, or a CSS selector.')
  return null
}

const whole = (input: Input, key: string, least: number, most: number): number | null => {
  const value = input[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Unclear(`${key} should be a number.`)
  return Math.min(most, Math.max(least, Math.round(value)))
}

/** The tools, by name: what the agent can ask of the page. */
export const PAGE_TOOLS = [
  'page_state',
  'page_open',
  'page_move',
  'page_viewport',
  'page_snapshot',
  'page_screenshot',
  'page_logs',
  'page_click',
  'page_hover',
  'page_type',
  'page_press',
  'page_scroll',
  'page_select',
  'page_wait',
  'page_evaluate',
  'page_dialog',
] as const

export type PageToolName = (typeof PAGE_TOOLS)[number]

const parse = (tool: PageToolName, input: Input): PageCall => {
  switch (tool) {
    case 'page_state':
      return { op: 'state' }
    case 'page_open': {
      const url = stringIn(input, 'url', LONGEST_ADDRESS)?.trim() ?? ''
      if (url === '') throw new Unclear('Give the url of the page, such as http://localhost:5173/.')
      return { op: 'open', url }
    }
    case 'page_move': {
      const move = oneOf(input, 'move', MOVES)
      if (move === null) throw new Unclear(`Say how to move: ${MOVES.join(', ')}.`)
      return { op: 'move', move }
    }
    case 'page_viewport': {
      const viewport = oneOf(input, 'viewport', VIEWPORTS)
      if (viewport === null) throw new Unclear(`Say which viewport: ${VIEWPORTS.join(', ')}.`)
      return { op: 'viewport', viewport }
    }
    case 'page_snapshot':
      return { op: 'snapshot', target: targetIn(input, false) }
    case 'page_screenshot':
      return { op: 'screenshot', target: targetIn(input, false), fullPage: flagIn(input, 'full_page', false) }
    case 'page_logs':
      return {
        op: 'logs',
        since: whole(input, 'since', 0, Number.MAX_SAFE_INTEGER) ?? 0,
        kind: oneOf(input, 'kind', ['all', 'console', 'network']) ?? 'all',
      }
    case 'page_click':
      return {
        op: 'click',
        target: targetIn(input, true) as PageTarget,
        button: oneOf(input, 'button', ['left', 'right', 'middle']) ?? 'left',
        double: flagIn(input, 'double', false),
      }
    case 'page_hover':
      return { op: 'hover', target: targetIn(input, true) as PageTarget }
    case 'page_type': {
      const target = targetIn(input, true) as PageTarget
      const text = stringIn(input, 'text', LONGEST_TEXT)
      if (text === null) throw new Unclear('Give the text to type.')
      return { op: 'type', target, text, replace: flagIn(input, 'replace', true), submit: flagIn(input, 'submit', false) }
    }
    case 'page_press': {
      const key = stringIn(input, 'key', LONGEST_KEY)?.trim() ?? ''
      if (key === '') throw new Unclear('Say which key, such as Enter, Escape or Control+A.')
      if (Array.from({ length: key.length }, (_, at) => key.charCodeAt(at)).some((code) => code < 0x20 || code === 0x7f))
        throw new Unclear('key should be a key’s name, such as Enter or Control+A. To enter text, use page_type.')
      return { op: 'press', key, target: targetIn(input, false) }
    }
    case 'page_scroll': {
      const target = targetIn(input, false)
      const to = oneOf(input, 'to', ['top', 'bottom', 'up', 'down'])
      const by = whole(input, 'by', -FARTHEST, FARTHEST)
      if (to !== null && by !== null) throw new Unclear('Give to or by, not both.')
      if (to === null && by === null && target === null)
        throw new Unclear(
          'Say where to scroll: to (top, bottom, up or down) or by (pixels, positive is down), or an element to bring into view.',
        )
      return { op: 'scroll', target, to, by }
    }
    case 'page_select': {
      const target = targetIn(input, true) as PageTarget
      const given = input.values
      if (!Array.isArray(given) || given.length === 0) throw new Unclear('Give values: the text or value of each option to choose.')
      if (given.length > MOST_VALUES) throw new Unclear(`At most ${MOST_VALUES} options go in one call.`)
      const values = given.map((one: unknown) => {
        if (typeof one !== 'string' || one === '' || one.length > LONGEST_VALUE)
          throw new Unclear('Each of values should be some text of at most 500 characters.')
        return one
      })
      return { op: 'select', target, values }
    }
    case 'page_wait': {
      const text = stringIn(input, 'text', LONGEST_WORDS)
      const gone = stringIn(input, 'gone', LONGEST_WORDS)
      const target = targetIn(input, false)
      const words = text !== null && text !== '' ? text : null
      const missing = gone !== null && gone !== '' ? gone : null
      if (words === null && missing === null && target === null)
        throw new Unclear('Say what to wait for: text that shows, gone for text that goes, or an element by ref or selector.')
      return { op: 'wait', text: words, gone: missing, target, seconds: whole(input, 'seconds', WAIT.least, WAIT.most) ?? WAIT.usual }
    }
    case 'page_evaluate': {
      const script = stringIn(input, 'script', LONGEST_SCRIPT)
      if (script === null || script.trim() === '') throw new Unclear('Give the script to run.')
      return { op: 'evaluate', script }
    }
    case 'page_dialog':
      return { op: 'dialog', accept: flagIn(input, 'accept', true), text: stringIn(input, 'text', LONGEST_TEXT) }
  }
}

/** What an agent's input to a page tool asks of the page, or why it asks nothing, in words for the agent. */
export const pageCallOf = (tool: PageToolName, input: unknown): PageCall | string => {
  try {
    return parse(tool, recordOf(input))
  } catch (error) {
    if (error instanceof Unclear) return error.message
    throw error
  }
}

/** The page's owner for a session: a lead's task, the coordinator's project; null for anyone else, who has no page. */
export const pageOwnerOf = (access: ToolAccess): string | null =>
  access.role === 'coordinator' ? access.projectId : access.role === 'lead' ? access.taskId : null

const answered = (answer: PageAnswer): string | ToolPicture =>
  answer.picture === undefined ? answer.text : { text: answer.text, image: { data: answer.picture.png, mimeType: 'image/png' } }

const ELEMENT = {
  ref: { type: 'string', description: 'The element by its reference from page_snapshot, such as e12.' },
  selector: { type: 'string', description: 'Or by a CSS selector (the first element it finds). Give one of the two.' },
} as const

const definitions: Readonly<
  Record<
    PageToolName,
    { readonly description: string; readonly properties?: Readonly<Record<string, unknown>>; readonly required?: ReadonlyArray<string> }
  >
> = {
  page_state: {
    description:
      "Says what is open in the page beside this conversation: its address and title, its viewport, whether it is shown beside the conversation, in a tab of its own or asleep, and any note under its bar. It is the person's own page for this work, in a session of its own that may be signed in to the dev app or a company's single sign-on; you read and drive it without asking, and the person sees you at work. Opens nothing. page_open opens or moves it; page_snapshot, page_screenshot and page_logs read it; page_click, page_type, page_press, page_hover, page_scroll, page_select, page_wait, page_move, page_viewport, page_evaluate and page_dialog drive it. For a page nobody has open, or to look at one without the person's, use screenshot.",
  },
  page_open: {
    description:
      "Opens an address in the page beside this conversation, or goes there where a page is open; a page asleep wakes. Only http and https pages load. A sign-in to Claude, GitHub, GitLab or Linear opens in the person's own browser instead, never here, and the answer says so, as it does for anything else a guard refuses. A bare localhost:5173 is read as http. Answers with where the page is and a log mark for page_logs.",
    properties: { url: { type: 'string', description: 'The address, such as http://localhost:5173/settings.' } },
    required: ['url'],
  },
  page_move: {
    description: "Goes back or forward in the page's history, reloads it, or stops it loading, as its bar's buttons do.",
    properties: { move: { type: 'string', enum: MOVES } },
    required: ['move'],
  },
  page_viewport: {
    description:
      "Sets the page's viewport as the bar's Viewport menu does: fit (the panel's own size), desktop (1440×900), laptop (1280×800), tablet (820×1180) or phone (390×844). A tablet and a phone are touch screens with a mobile browser's user agent, and the page reloads when that changes.",
    properties: { viewport: { type: 'string', enum: VIEWPORTS } },
    required: ['viewport'],
  },
  page_snapshot: {
    description:
      'Reads the page as an accessibility tree: roles, names, values and states, with a reference like [ref=e12] on each element you can act on. Take one before you act and again after the page changes: a reference stays with its element while it is on the page, and the answer says when it isn’t. ref or selector reads only that element and what is in it. Cheaper than a screenshot; page_screenshot shows how it looks.',
    properties: ELEMENT,
  },
  page_screenshot: {
    description:
      'A picture of the page as the person sees it beside the conversation, at its viewport, at 1×; full_page takes its whole length, ref or selector one element. Each picture stays in your context, so take only what you need to see.',
    properties: { ...ELEMENT, full_page: { type: 'boolean' } },
  },
  page_logs: {
    description:
      "The page's console messages and the requests that failed, since a point: since is the log mark an earlier answer gave (0 is everything kept); kind narrows them to console or network. Ends with the mark to use next.",
    properties: {
      since: { type: 'integer', minimum: 0 },
      kind: { type: 'string', enum: ['all', 'console', 'network'] },
    },
  },
  page_click: {
    description:
      "Clicks an element with the real mouse, as a person would: scrolled into view and outlined for the person first. button is left (the default), right or middle; double clicks twice. The answer says what it did and what the page did about it, including a guard refusing something (a file or another app's address, a sign-in, a permission, a download). If the person clicks, types or scrolls in the page meanwhile, the action stops and says so.",
    properties: { ...ELEMENT, button: { type: 'string', enum: ['left', 'right', 'middle'] }, double: { type: 'boolean' } },
  },
  page_hover: {
    description: 'Moves the mouse over an element, for menus and tooltips that open on hover.',
    properties: ELEMENT,
  },
  page_type: {
    description:
      'Types text into a field: it is focused and what it held is replaced (replace false adds to the end), and submit presses Enter after. For Tab, Escape and the like, use page_press.',
    properties: {
      ...ELEMENT,
      text: { type: 'string' },
      replace: { type: 'boolean' },
      submit: { type: 'boolean' },
    },
    required: ['text'],
  },
  page_press: {
    description:
      'Presses a key or a chord, such as Enter, Escape, Tab, ArrowDown, Control+A or ControlOrMeta+K, in the element named, else wherever the page has its focus.',
    properties: { key: { type: 'string' }, ...ELEMENT },
    required: ['key'],
  },
  page_scroll: {
    description:
      'Scrolls the page, or the element named: to its top or bottom, up or down a screen, or by pixels (positive is down). An element alone is brought into view.',
    properties: {
      ...ELEMENT,
      to: { type: 'string', enum: ['top', 'bottom', 'up', 'down'] },
      by: { type: 'integer', description: 'Pixels; positive is down.' },
    },
  },
  page_select: {
    description: 'Chooses options of a select, each by its text or its value.',
    properties: { ...ELEMENT, values: { type: 'array', items: { type: 'string' }, minItems: 1 } },
    required: ['values'],
  },
  page_wait: {
    description: `Waits up to seconds (${WAIT.least} to ${WAIT.most}, ${WAIT.usual} unless you say) for text to show, for text to be gone, or for an element to be on the page, and says whether it came about. The person using the page doesn't end a wait.`,
    properties: {
      text: { type: 'string', description: 'Words that should show on the page.' },
      gone: { type: 'string', description: 'Words that should no longer show.' },
      ...ELEMENT,
      seconds: { type: 'integer', minimum: WAIT.least, maximum: WAIT.most },
    },
  },
  page_evaluate: {
    description: `Runs a script in an isolated world of the page: its DOM and what the browser gives every script, not the page's own variables, and nothing of Althar's. Give an expression, or statements that return a value; it comes back as JSON, cut at 20,000 characters. The guards hold for anything it does.`,
    properties: { script: { type: 'string', description: `At most ${LONGEST_SCRIPT.toLocaleString('en')} characters.` } },
    required: ['script'],
  },
  page_dialog: {
    description:
      'Answers the dialog the page shows (an alert or a confirm), which holds everything in the page until it is answered: the other page tools say when one is open, and what it says. accept is OK (unless you say, as it is for an alert); false is Cancel. (Althar answers a prompt() itself, with nothing.)',
    properties: {
      accept: { type: 'boolean', description: 'OK where true (unless you say), Cancel where false.' },
      text: { type: 'string', description: 'For a prompt: the answer typed into it. Its own text where you give none.' },
    },
  },
}

export class PageTools extends Context.Service<
  PageTools,
  {
    /** The tools it serves, by name. */
    readonly tools: ReadonlyArray<string>
  }
>()('@althar/runtime/PageTools') {
  static readonly layer: Layer.Layer<PageTools, never, SqlClient.SqlClient | RuntimeConfig | ToolServer> = Layer.effect(
    PageTools,
    Effect.gen(function* () {
      const config = yield* RuntimeConfig
      const toolServer = yield* ToolServer
      const context = yield* Effect.context<SqlClient.SqlClient>()

      const refuse = (message: string) => Effect.fail(new ToolRefused({ message }))

      /** What the agent asked of its page, carried to where the page is. */
      const reach = (name: PageToolName, input: unknown, access: ToolAccess): Effect.Effect<string | ToolPicture, ToolRefused> =>
        Effect.gen(function* () {
          const owner = pageOwnerOf(access)
          if (owner === null)
            return yield* refuse(
              access.role === 'lead'
                ? 'You have no task of your own, so there is no page beside you.'
                : 'Only a task’s lead and the project’s coordinator have a page.',
            )
          const host = config.page
          if (host === undefined) return yield* refuse('This Althar can’t drive pages: only the desktop app has them.')
          const call = pageCallOf(name, input)
          if (typeof call === 'string') return yield* refuse(call)
          // Done with, a task's page is closed with it, and a removed project's too.
          const over = yield* settledAmong([owner]).pipe(
            Effect.provideContext(context),
            Effect.orElseSucceed((): ReadonlyArray<string> => []),
          )
          if (over.length > 0)
            return yield* refuse(
              access.role === 'coordinator'
                ? 'This project was removed, so its page is closed.'
                : 'This task is done, so its page is closed.',
            )
          return answered(yield* host(owner, call).pipe(Effect.mapError((message) => new ToolRefused({ message }))))
        })

      const tools: ReadonlyArray<Tool> = PAGE_TOOLS.map((name) => {
        const { description, properties, required } = definitions[name]
        return {
          name,
          description,
          input: { type: 'object', properties: properties ?? {}, ...(required === undefined ? {} : { required }) },
          call: (input, access) => reach(name, input, access),
        }
      })
      yield* toolServer.serve(POOL, tools)
      return PageTools.of({ tools: PAGE_TOOLS })
    }),
  )
}
