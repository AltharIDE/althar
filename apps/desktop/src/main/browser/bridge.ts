import { LONGEST_SCRIPT, LONGEST_TEXT, PAGE_OPS, type PageCall, type PageDone, type PageTarget, WAIT } from '@althar/runtime/pageBridge'

import { ownerOf } from './cookies'
import { isViewport } from './devices'
import { words } from './drive'
import type { Pages } from './pages'

/*
 * How the runtime's tools reach the page beside a conversation (ADR-100,
 * agents driving pages). The runtime runs in a utility process of Althar's
 * own, and its port to the main process is a private line: no window, page
 * or agent can write to it. What comes over it is still read as untrusted,
 * as anything crossing a process is: it counts only from the runtime
 * process main started, whose page is named by an owner id that is a task's
 * or a project's, and whose call is one of the ones the tools make, every
 * field of it checked. What can't be read is answered in words, never thrown.
 * There is no other way in: the windows' own calls about pages (ipc.ts) have
 * no channel that drives one.
 */

const MALFORMED = 'That isn’t a request Althar’s pages take.'
const SAY_WHICH = 'Say which element: a ref from page_snapshot, or a CSS selector.'

const SELECTOR = 4_000
const ADDRESS = 8_192
const WORDS = 500
const KEY = 64
const VALUES = 100
const REF = /^e\d{1,9}$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const textOf = (value: unknown, longest: number, least = 0): string | null =>
  typeof value === 'string' && value.length >= least && value.length <= longest && !value.includes('\u0000') ? value : null

/** An element as named, exactly one of a ref and a selector; null where none is named; false where what is named can't be read. */
const targetIn = (value: unknown): PageTarget | null | false => {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) return false
  const { ref, selector } = value
  const hasRef = ref !== undefined && ref !== null
  const hasSelector = selector !== undefined && selector !== null
  if (hasRef === hasSelector) return false
  if (hasRef) return typeof ref === 'string' && REF.test(ref) ? { ref } : false
  const found = textOf(selector, SELECTOR, 1)
  return found === null ? false : { selector: found }
}

const optionalText = (value: unknown): string | null | false => {
  if (value === undefined || value === null) return null
  const found = textOf(value, WORDS, 1)
  return found === null ? false : found
}

/** A call as the runtime's tools make it, every field checked; the words of why not, where it can't be read. */
export const callOf = (value: unknown): PageCall | string => {
  if (!isRecord(value)) return MALFORMED
  const op = value.op
  if (typeof op !== 'string' || !(PAGE_OPS as ReadonlyArray<string>).includes(op)) return MALFORMED
  switch (op) {
    case 'state':
      return { op }
    case 'open': {
      const url = textOf(value.url, ADDRESS, 1)
      return url === null ? words.notAnAddress : { op, url }
    }
    case 'move':
      return value.move === 'back' || value.move === 'forward' || value.move === 'reload' || value.move === 'stop'
        ? { op, move: value.move }
        : MALFORMED
    case 'viewport':
      return isViewport(value.viewport) ? { op, viewport: value.viewport } : MALFORMED
    case 'snapshot': {
      const target = targetIn(value.target)
      return target === false ? MALFORMED : { op, target }
    }
    case 'screenshot': {
      const target = targetIn(value.target)
      return target === false || typeof value.fullPage !== 'boolean' ? MALFORMED : { op, target, fullPage: value.fullPage }
    }
    case 'logs': {
      const { since, kind } = value
      if (typeof since !== 'number' || !Number.isInteger(since) || since < 0 || since > 1_000_000_000) return MALFORMED
      return kind === 'all' || kind === 'console' || kind === 'network' ? { op, since, kind } : MALFORMED
    }
    case 'click': {
      const target = targetIn(value.target)
      if (target === null) return SAY_WHICH
      const { button } = value
      if (target === false || (button !== 'left' && button !== 'right' && button !== 'middle') || typeof value.double !== 'boolean')
        return MALFORMED
      return { op, target, button, double: value.double }
    }
    case 'hover': {
      const target = targetIn(value.target)
      return target === null ? SAY_WHICH : target === false ? MALFORMED : { op, target }
    }
    case 'type': {
      const target = targetIn(value.target)
      if (target === null) return SAY_WHICH
      const text = typeof value.text === 'string' && value.text.length <= LONGEST_TEXT && !value.text.includes('\u0000') ? value.text : null
      if (target === false || text === null || typeof value.replace !== 'boolean' || typeof value.submit !== 'boolean') return MALFORMED
      return { op, target, text, replace: value.replace, submit: value.submit }
    }
    case 'press': {
      const target = targetIn(value.target)
      const key = textOf(value.key, KEY, 1)
      return target === false || key === null ? MALFORMED : { op, key, target }
    }
    case 'scroll': {
      const target = targetIn(value.target)
      const to = value.to ?? null
      const by = value.by ?? null
      if (target === false) return MALFORMED
      if (to !== null && to !== 'top' && to !== 'bottom' && to !== 'up' && to !== 'down') return MALFORMED
      if (by !== null && (typeof by !== 'number' || !Number.isFinite(by) || Math.abs(by) > 100_000)) return MALFORMED
      return { op, target, to, by }
    }
    case 'select': {
      const target = targetIn(value.target)
      if (target === null) return SAY_WHICH
      const list = value.values
      if (target === false || !Array.isArray(list) || list.length === 0 || list.length > VALUES) return MALFORMED
      const values: Array<string> = []
      for (const one of list as ReadonlyArray<unknown>) {
        const found = textOf(one, WORDS)
        if (found === null) return MALFORMED
        values.push(found)
      }
      return { op, target, values }
    }
    case 'wait': {
      const text = optionalText(value.text)
      const gone = optionalText(value.gone)
      const target = targetIn(value.target)
      const { seconds } = value
      if (text === false || gone === false || target === false) return MALFORMED
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < WAIT.least || seconds > WAIT.most) return MALFORMED
      return { op, text, gone, target, seconds }
    }
    case 'evaluate': {
      const script = textOf(value.script, LONGEST_SCRIPT, 1)
      return script === null ? MALFORMED : { op, script }
    }
    case 'dialog': {
      if (typeof value.accept !== 'boolean') return MALFORMED
      if (value.text === undefined || value.text === null) return { op, accept: value.accept, text: null }
      const text = textOf(value.text, LONGEST_TEXT)
      return text === null ? MALFORMED : { op, accept: value.accept, text }
    }
    default:
      return MALFORMED
  }
}

export interface BridgeOptions {
  /** The pages, as far as an agent reaches them: only `drive`, with a signal that ends where the runtime gave up on the call. */
  readonly pages: Pick<Pages, 'drive'>
  /** Whether a message came from the runtime process main started: its only sender. */
  readonly isRuntime: (from: unknown) => boolean
  /** Sends the answer back to the process that asked. */
  readonly reply: (to: unknown, requestId: string, done: PageDone) => void
}

export const bridgeOf = (options: BridgeOptions) => {
  /** The calls under way, by the runtime's request: each ends where the runtime gives up on it (`page-cancel`). */
  const going = new Map<string, AbortController>()

  /** A page call in words: the owner and the call read, then driven; never throws. */
  const request = async (owner: unknown, call: unknown, signal?: AbortSignal): Promise<PageDone> => {
    const named = typeof owner === 'string' ? ownerOf(owner) : null
    if (named === null) return { error: words.noPage }
    const checked = callOf(call)
    if (typeof checked === 'string') return { error: checked }
    try {
      return await options.pages.drive(named.id, checked, signal)
    } catch (error) {
      return { error: words.couldNot(error instanceof Error ? error.message : String(error)) }
    }
  }

  /**
   * A message that came to main: whether it was a page call from the
   * runtime, which is then answered, or the runtime giving up on one (its
   * agent stopped, or it waited too long), which then ends: what hasn't
   * begun isn't done. A message from anywhere else is ignored, as is one
   * with no request to answer.
   */
  const handle = (from: unknown, message: unknown): boolean => {
    if (!options.isRuntime(from)) return false
    if (!isRecord(message) || (message.type !== 'page' && message.type !== 'page-cancel')) return false
    const { requestId } = message
    if (typeof requestId !== 'string' || requestId === '' || requestId.length > 100) return true
    if (message.type === 'page-cancel') {
      going.get(requestId)?.abort()
      going.delete(requestId)
      return true
    }
    if (going.has(requestId)) return true
    const controller = new AbortController()
    going.set(requestId, controller)
    void request(message.owner, message.call, controller.signal).then((done) => {
      going.delete(requestId)
      if (!controller.signal.aborted) options.reply(from, requestId, done)
    })
    return true
  }

  return { handle, request }
}

export type Bridge = ReturnType<typeof bridgeOf>
