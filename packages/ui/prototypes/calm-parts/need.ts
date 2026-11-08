// Scrappy: what most needs the person, worked out each time it is drawn, never kept (ADR § Local, attaching and the card).
import { type Ask, type Case, type Change, changeIn, type Timing } from './cases'

export interface Need {
  /** you: theirs to do; bad: something failed; live: under way; quiet: nothing to do. */
  readonly tone: 'you' | 'bad' | 'live' | 'quiet'
  /** The one fact, in a short sentence: “#714 checks failing”. */
  readonly says: string
  /** Its one button, where there is one: Ship, Merge #714, then #716. */
  readonly act?: string
  /** The change it is about, where it is about one. */
  readonly change?: Change
  /** How many of the task's other changes are open, apart from it: “· 2 more”. */
  readonly more: number
}

export const nameOf = (change: Change) => (change.pr === undefined ? change.branch : `#${change.pr}`)
export const open = (change: Change) => change.state !== 'merged' && change.state !== 'closed'
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const commits = (n: number) => plural(n, 'commit')
const list = (names: ReadonlyArray<string>) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')}${names.length > 2 ? ',' : ''} and ${names.at(-1) ?? ''}`
export const listOf = (names: ReadonlyArray<string>) => names.join(', ')

/** The ask on screen, where one waits: the thread's last beat, unanswered. */
export const askOf = (c: Case, answered: Readonly<Record<string, string>>): Ask | null => {
  const last = [...c.thread].reverse().find((beat) => beat.kind === 'ask')
  return last?.kind === 'ask' && answered[`${c.key}:${last.ask.kind}`] === undefined ? last.ask : null
}

/** What an ask says on a card and in the header, and its button. */
const askNeed = (c: Case, ask: Ask): Omit<Need, 'more'> => {
  const of = (id: string) => changeIn(c, id)
  switch (ask.kind) {
    case 'run-it':
      return { tone: 'you', says: `How far to trust #${ask.pr}’s code`, act: 'Run safely' }
    case 'switch':
      return { tone: 'you', says: `Your checkout is on ${ask.own}`, act: 'Switch', change: of(ask.change) }
    case 'settle-unshipped': {
      const change = of(ask.change)
      return { tone: 'you', says: `${commits(change?.waiting ?? 0)} not shipped`, act: 'Ship', change }
    }
    case 'merge-unshipped': {
      const change = of(ask.change)
      return {
        tone: 'you',
        says: `${commits(change?.waiting ?? 0)} on ${change === undefined ? '' : nameOf(change)} not shipped`,
        act: 'Review and merge',
        change,
      }
    }
    case 'remove-draft':
      return { tone: 'you', says: `Your review of #${ask.pr} isn’t posted`, act: 'Post it' }
    case 'after-merge':
      return { tone: 'you', says: `The review of #${ask.pr} found ${ask.findings.length}`, act: 'Fix it' }
    case 'close-old':
      return { tone: 'you', says: `#${ask.now} is up. #${ask.old} is still open`, act: `Close #${ask.old}` }
    case 'usage':
      return { tone: 'bad', says: `${ask.agent.split(' ')[0]} is out of usage until ${ask.until}`, act: 'Use another model' }
    case 'stuck':
      return { tone: 'bad', says: `${ask.what} stopped`, act: 'Try again' }
    case 'refused':
      return { tone: 'bad', says: 'GitHub refused the push', act: 'Sign and ship', change: of(ask.change) }
    case 'attach':
      return { tone: 'you', says: `#${ask.pr} goes into ${ask.base}`, act: 'Attach it', change: of(ask.change) }
    case 'preset-offer':
      return { tone: 'you', says: `Keep these parts as “${ask.name}”?`, act: 'Keep it' }
    case 'ship-stack': {
      const change = of(ask.change)
      const below = change?.heldBy === undefined ? undefined : of(change.heldBy)
      return {
        tone: 'you',
        says: `Held: ${commits(below?.waiting ?? 0)} waiting on ${below === undefined ? '' : nameOf(below)} below`,
        act: 'Ship',
        change,
      }
    }
  }
}

export const needOf = (c: Case, answered: Readonly<Record<string, string>>): Need => {
  const live = c.changes.filter(open)
  const more = (change: Change | undefined) => (change === undefined ? 0 : live.filter((one) => one !== change).length)
  const with_ = (need: Omit<Need, 'more'>): Need => ({ ...need, more: more(need.change) })
  // A line that offers a way on, but asks nothing (a pull request not taken, a preset offered), never takes the task's one fact.
  const ask = askOf(c, answered)
  if (ask !== null && ask.kind !== 'attach' && ask.kind !== 'preset-offer') {
    const need = askNeed(c, ask)
    // Held up a stack, the sentence names the change below as well.
    return ask.kind === 'ship-stack' ? { ...need, more: Math.max(0, live.length - 2) } : with_(need)
  }
  if (c.still !== undefined)
    return with_({
      tone: c.status === 'queued' ? 'quiet' : 'bad',
      says: c.still.why,
      ...(c.still.act === undefined ? {} : { act: c.still.act }),
    })
  const failing = live.find((one) => one.checks === 'failed' && (one.waiting ?? 0) === 0)
  if (failing !== undefined) return with_({ tone: 'bad', says: `${nameOf(failing)} checks failing`, act: 'Fix it', change: failing })
  const conflict = live.find((one) => one.conflict === true)
  if (conflict !== undefined)
    return with_({ tone: 'bad', says: `${nameOf(conflict)} conflicts with main`, act: 'Resolve it', change: conflict })
  const ready = live.filter((one) => one.ready === true)
  if (ready.length > 1 && ready.some((one) => one.on !== undefined)) {
    const bottom = ready.find((one) => one.on === undefined) ?? ready[0]!
    const top = ready.find((one) => one.on !== undefined) ?? ready[1]!
    return {
      tone: 'you',
      says: `${list(ready.map(nameOf))} ready`,
      act: `Merge ${nameOf(bottom)}, then ${nameOf(top)}`,
      change: bottom,
      more: live.length - ready.length,
    }
  }
  if (ready.length > 0 && (ready[0]?.waiting ?? 0) === 0)
    return with_({ tone: 'you', says: `${nameOf(ready[0]!)} ready to merge`, act: 'Merge', change: ready[0]! })
  const shipping = live.find((one) => one.shipping !== undefined)
  if (shipping !== undefined)
    return with_({
      tone: 'live',
      says: `Shipping ${nameOf(shipping)}: ${shipping.shipping === 'review' ? 'reviewing' : shipping.shipping === 'conflict' ? 'bringing main in' : 'pushing'}`,
      change: shipping,
    })
  const waiting = live.filter((one) => (one.waiting ?? 0) > 0)
  if (waiting.length > 0 && c.moving === undefined) {
    const first = waiting[0]!
    const beside = first.checks === 'failed' ? [`${first.failing?.[0] ?? 'a check'} fails on ${nameOf(first)}`] : []
    const n = waiting.reduce((sum, one) => sum + (one.waiting ?? 0), 0)
    return with_({
      tone: 'you',
      says: `${commits(n)} not shipped${beside.length === 0 ? '' : ` · ${beside.join(' · ')}`}`,
      act: waiting.length > 1 ? 'Ship them all' : 'Ship',
      change: first,
    })
  }
  if (c.reviewing?.draft !== undefined) return with_({ tone: 'you', says: `Review of #${c.reviewing.pr} drafted`, act: 'Post it' })
  if (c.moving !== undefined && c.moving.waitsOn !== undefined)
    return with_({
      tone: 'quiet',
      says: `Moves to a worktree once ${c.moving.waitsOn} is committed`,
      act: 'Call it off',
      change: changeIn(c, c.moving.change),
    })
  const helped = live.find((one) => one.helper !== undefined)
  if (helped !== undefined) return with_({ tone: 'live', says: `A helper on ${nameOf(helped)}`, change: helped })
  const checking = live.filter((one) => one.checks === 'running' && one.pr !== undefined)
  if (checking.length > 0)
    return { tone: 'live', says: `Waiting for checks on ${listOf(checking.map(nameOf))}`, more: live.length - checking.length }
  return with_({ tone: c.status === 'running' ? 'live' : 'quiet', says: c.word })
}

/* ——— Where a turn's time went ——— */

const span = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 === 0 ? '' : ` ${s % 60}s`}`)
export const totalOf = (t: Timing) => (t.wait ?? 0) + (t.start ?? 0) + t.work + (t.review ?? 0) + (t.checks ?? 0)
export const tookOf = (t: Timing) => {
  const s = totalOf(t)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
/** Its parts, the largest first, each “3m waiting for a place”. */
export const partsOfTime = (t: Timing): ReadonlyArray<readonly [number, string]> =>
  (
    [
      [t.wait ?? 0, 'waiting for a place'],
      [t.start ?? 0, 'starting the session'],
      [t.work - (t.tools ?? 0), 'the agent’s own work'],
      [t.tools ?? 0, 'running tools'],
      [t.review ?? 0, 'the review'],
      [t.checks ?? 0, 'checks'],
    ] as Array<readonly [number, string]>
  )
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0])
export const said = ([s, what]: readonly [number, string]) => `${span(s)} ${what}`
