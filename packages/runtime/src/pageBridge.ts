/*
 * How the lead and the coordinator reach the page beside their conversation
 * (ADR-100, agents driving pages). The tools live here, in the runtime; the
 * page lives in the desktop app's main process, with Chromium. A tool turns
 * what an agent asked into a PageCall and hands it to the host
 * (`RuntimeOptions.page`), which carries it to the main process over the
 * utility process's own channel, a private line between the two that no
 * window, page or agent can write to, and brings back the answer in words.
 *
 * Whose page it is never comes from the agent: the runtime reads it from the
 * session's own access (a lead's task, the coordinator's project), so a lead
 * can reach no page but the one beside its task.
 */

/** An element the agent names: a reference from its last snapshot (`e12`), or a CSS selector. One of the two. */
export interface PageTarget {
  readonly ref?: string
  readonly selector?: string
}

export type PageMoveWord = 'back' | 'forward' | 'reload' | 'stop'
export type PageViewport = 'fit' | 'desktop' | 'laptop' | 'tablet' | 'phone'

/** What an agent asks of a page. Each is checked again where it is carried out. */
export type PageCall =
  /** What is open beside the conversation, without waking or opening anything. */
  | { readonly op: 'state' }
  /** Goes to an address; opens the page beside the conversation where none is open, wakes one asleep. */
  | { readonly op: 'open'; readonly url: string }
  | { readonly op: 'move'; readonly move: PageMoveWord }
  | { readonly op: 'viewport'; readonly viewport: PageViewport }
  | { readonly op: 'snapshot'; readonly target: PageTarget | null }
  /** The page at its viewport, or its whole length; or one element. */
  | { readonly op: 'screenshot'; readonly target: PageTarget | null; readonly fullPage: boolean }
  /** Console messages and failed requests after `since` (0 is from the start); `kind` narrows them. */
  | { readonly op: 'logs'; readonly since: number; readonly kind: 'all' | 'console' | 'network' }
  | { readonly op: 'click'; readonly target: PageTarget; readonly button: 'left' | 'right' | 'middle'; readonly double: boolean }
  | { readonly op: 'hover'; readonly target: PageTarget }
  | { readonly op: 'type'; readonly target: PageTarget; readonly text: string; readonly replace: boolean; readonly submit: boolean }
  /** A key or a chord (`Enter`, `Control+A`, `ControlOrMeta+K`), to the element named, else to whatever has the page's focus. */
  | { readonly op: 'press'; readonly key: string; readonly target: PageTarget | null }
  | {
      readonly op: 'scroll'
      readonly target: PageTarget | null
      readonly to: 'top' | 'bottom' | 'up' | 'down' | null
      readonly by: number | null
    }
  | { readonly op: 'select'; readonly target: PageTarget; readonly values: ReadonlyArray<string> }
  /**
   * Waits up to `seconds` until the page shows `text`, no longer shows the words in `gone`, and has the element `target`
   * (those given, all of them), and says whether it came about. Watching doesn't yield to the person's use of the page.
   */
  | {
      readonly op: 'wait'
      readonly text: string | null
      readonly gone: string | null
      readonly target: PageTarget | null
      readonly seconds: number
    }
  /** Runs a script in an isolated world of the page: its DOM, none of its scripts' variables, nothing of Althar's. */
  | { readonly op: 'evaluate'; readonly script: string }
  /**
   * Answers the dialog the page shows (an alert, a confirm, a prompt), which holds everything in the page until it is
   * answered: `accept` is OK, else Cancel; `text` is a prompt's answer, its own text where null.
   */
  | { readonly op: 'dialog'; readonly accept: boolean; readonly text: string | null }

/** The least and most a wait may last, in seconds, and what it lasts without being told. */
export const WAIT = { least: 1, most: 60, usual: 10 } as const

/** The longest a script an agent runs may be, in characters. */
export const LONGEST_SCRIPT = 20_000

/** The most text one `type` call may enter, in characters. */
export const LONGEST_TEXT = 20_000

/** What comes back: words for the agent, and for a screenshot, the picture too (a PNG as base64). */
export interface PageAnswer {
  readonly text: string
  readonly picture?: { readonly png: string; readonly width: number; readonly height: number }
}

/** What the main process says of a call, or why it can't, in words for the agent. */
export interface PageDone {
  readonly value?: PageAnswer
  readonly error?: string
}

export const PAGE_OPS: ReadonlyArray<PageCall['op']> = [
  'state',
  'open',
  'move',
  'viewport',
  'snapshot',
  'screenshot',
  'logs',
  'click',
  'hover',
  'type',
  'press',
  'scroll',
  'select',
  'wait',
  'evaluate',
  'dialog',
]
