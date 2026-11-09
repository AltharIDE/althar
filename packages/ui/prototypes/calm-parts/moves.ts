// Scrappy: what a press does. Each is an edit to the case on screen (its changes, parts, access, thread), so the bar, the card, the
// parts and the thread all read the same case after it; and what takes time (a Ship) goes step by step, in place. Nothing real happens.
import { type Ask, type Beat, type Case, type Change, changeIn, type Preset, type Stamp, type Who } from './cases'
import { askNeed, askOf, commits, list as joined, nameOf, open, recordOf } from './need'
import { type Edit, proto } from './state'

const STEP = 1100
const NEW_PR = 719
const SOL = { who: 'GPT-6.1 Sol', when: 'before' as const }

/* ——— The small edits the moves are made of ——— */

const compose =
  (...edits: ReadonlyArray<Edit>): Edit =>
  (c) =>
    edits.reduce((one, edit) => edit(one), c)

const change =
  (id: string, to: (one: Change) => Change): Edit =>
  (c) => ({ ...c, changes: c.changes.map((one) => (one.id === id ? to(one) : one)) })

const beat =
  (one: Beat): Edit =>
  (c) => ({ ...c, thread: [...c.thread, one] })

const part = (who: Who, text: string, id?: string, stamp?: Stamp): Edit =>
  beat({ kind: 'part', who, text, ...(id === undefined ? {} : { change: id }), ...(stamp === undefined ? {} : { stamp }) })
const line = (text: string, id?: string, tone?: 'warning'): Edit =>
  beat({ kind: 'line', text, ...(id === undefined ? {} : { change: id }), ...(tone === undefined ? {} : { tone }) })
/** A step in the work, stamped: up for review, merged, a new change. */
const stamped = (stamp: Stamp, text: string, id?: string): Edit =>
  beat({ kind: 'line', text, stamp, ...(id === undefined ? {} : { change: id }) })

/** What is under way is a line at the thread's end; it goes when the next step or the end comes. */
const underWay = (b: Beat) => b.kind === 'live' && (b.made === true || b.act === 'Call it off')
const calm: Edit = (c) => ({ ...c, thread: c.thread.filter((b) => !underWay(b)) })
const live = (text: string, id?: string, act?: string): Edit =>
  compose(
    calm,
    beat({
      kind: 'live',
      text,
      made: true,
      ...(id === undefined ? {} : { change: id }),
      ...(act === undefined ? {} : { act }),
    }),
  )

/** A line's way on, once taken, is gone from the line. */
const dropAct =
  (act: string): Edit =>
  (c) => ({
    ...c,
    thread: c.thread.map((b) => {
      if (!('act' in b) || b.act !== act) return b
      const next: Record<string, unknown> = { ...b }
      delete next['act']
      return next as unknown as Beat
    }),
  })

const standing =
  (lane: Case['lane'], status: Case['status'], word: string): Edit =>
  (c) => ({ ...c, lane, status, word, still: undefined })
const working = standing('running', 'running', 'Working')
const settled = standing('settled', 'done', 'Settled')

/** An ask, as the thread's last line: any earlier one of its kind goes, so there is only one. */
const asking =
  (ask: Ask): Edit =>
  (c) => ({
    ...c,
    lane: 'you',
    status: 'yours',
    word: 'Needs you',
    thread: [...c.thread.filter((b) => !(b.kind === 'ask' && b.ask.kind === ask.kind)), { kind: 'ask', ask }],
  })

const raise = (ask: Ask) => {
  proto.reopen(`${proto.get().key}:${ask.kind}`)
  proto.edit(asking(ask))
}

const without =
  (id: string): Edit =>
  (c) => ({ ...c, changes: c.changes.filter((one) => one.id !== id) })

const added =
  (one: Change): Edit =>
  (c) => ({ ...c, changes: [...c.changes, one] })

/** Steps one after the other: the first now, the rest a beat apart. */
const steps = (list: ReadonlyArray<Edit>, key = proto.get().key, from = 0) => {
  list.forEach((edit, n) => {
    if (n === 0 && from === 0) proto.edit(edit, key)
    else proto.later(STEP * (n + from), edit, key)
  })
}

/* ——— Ship ——— */

/** The changes to send, the ones holding commits below them first. */
const bottomUp = (c: Case, ids: ReadonlyArray<string>): ReadonlyArray<string> => {
  const out: string[] = []
  const add = (id: string) => {
    const one = changeIn(c, id)
    if (one === undefined || out.includes(id)) return
    if (one.heldBy !== undefined) add(one.heldBy)
    out.push(id)
  }
  ids.forEach(add)
  return out
}

interface ShipOptions {
  /** It was reviewed already, or the person said to go without. */
  readonly skipReview?: boolean
  /** Once it is up: a last step on the case. */
  readonly last?: Edit
  /** Once it is up: what the person's press goes on to do. */
  readonly after?: () => void
}

/** Ship one change: bring main in if it conflicts, the review, the push, and what is true after. */
const shipping = (c: Case, id: string, options: ShipOptions): ReadonlyArray<Edit> => {
  const one = changeIn(c, id)
  if (one === undefined) return []
  const name = nameOf(one)
  const n = one.waiting ?? 0
  const reviewed = c.reviewer?.when === 'before' && options.skipReview !== true && n > 0
  const mark = (to: NonNullable<Change['shipping']>): Edit =>
    compose(
      change(id, (x) => ({ ...x, shipping: to })),
      standing('running', 'running', 'Shipping'),
    )
  const list: Edit[] = []
  if (one.conflict === true)
    list.push(
      compose(mark('conflict'), live(`main changed the same lines as ${name}. Bringing main in first; the lead settles the conflict.`, id)),
    )
  if (reviewed)
    list.push(
      compose(
        mark('review'),
        change(id, (x) => ({ ...x, conflict: false })),
        live(`Reviewing the ${commits(n)} since ${name}’s last review.`, id),
      ),
    )
  list.push(
    compose(
      mark('pushing'),
      change(id, (x) => ({ ...x, conflict: false })),
      ...(reviewed ? [beat({ kind: 'review', findings: 0, change: id })] : []),
      live(
        one.pr === undefined
          ? `Pushing ${one.branch} and opening its pull request into ${one.toward ?? 'main'}.`
          : n === 0
            ? `Pushing ${name}, with the commits below it.`
            : `Pushing the ${commits(n)} to ${name}.`,
        id,
      ),
    ),
  )
  list.push((cc) => {
    const now = changeIn(cc, id)
    if (now === undefined) return cc
    const fresh = now.pr === undefined
    const pr = now.pr ?? NEW_PR
    const again = now.checks === 'failed'
    const words = fresh
      ? `${nameOf(now)} as #${pr}${(now.toward ?? 'main') === 'main' ? '' : `, into ${now.toward}`}, with ${commits(n)}.`
      : n === 0
        ? `${recordOf(now)}, on top of what shipped under it.`
        : `${commits(n)} to ${recordOf(now)}${(now.replies ?? 0) > 0 ? ', and the answer to the reply on it' : ''}${again ? '. Its checks run again' : ''}.`
    return compose(
      change(id, (x) => ({
        ...x,
        pr,
        state: x.state ?? 'open',
        waiting: undefined,
        replies: undefined,
        shipping: undefined,
        conflict: false,
        heldBy: undefined,
        checks: 'running',
        failing: undefined,
        ready: undefined,
        replaces: undefined,
      })),
      (x) => ({ ...x, changes: x.changes.map((other) => (other.heldBy === id ? { ...other, heldBy: undefined } : other)) }),
      calm,
      stamped('shipped', words, id),
      standing('running', 'running', 'Checks'),
      ...(now.replaces === undefined ? [] : [asking({ kind: 'close-old', old: now.replaces, now: pr })]),
    )(cc)
  })
  return list
}

/** Where the case lets a flow run on: the change's checks pass, and it is ready to merge. */
const passing =
  (id: string): Edit =>
  (c) => {
    const one = changeIn(c, id)
    if (c.passes !== true || one === undefined || !open(one) || one.checks !== 'running') return c
    return compose(
      change(id, (x) => ({ ...x, checks: 'passed', ready: true })),
      standing('you', 'yours', 'Ready'),
    )(c)
  }

/** Ship: one change, or every one waiting. A change holding up another is shipped first, and the ask that offered it is answered. */
export const ship = (id?: string, options: ShipOptions = {}) => {
  const c = proto.current()
  const wanted =
    id === undefined
      ? c.changes.filter((one) => open(one) && ((one.waiting ?? 0) > 0 || one.heldBy !== undefined)).map((one) => one.id)
      : [id]
  const order = bottomUp(c, wanted)
  if (order.length === 0) return
  const key = `${c.key}:ship-stack`
  if (c.thread.some((b) => b.kind === 'ask' && b.ask.kind === 'ship-stack') && proto.get().answered[key] === undefined)
    proto.answer(key, `Shipping ${order.map((one) => nameOf(changeIn(c, one)!)).join(', then ')}`)
  const list = order.flatMap((one) => shipping(c, one, options))
  if (c.passes === true) list.push(...order.map(passing))
  if (options.last !== undefined) list.push(options.last)
  steps(list)
  if (options.after !== undefined) proto.afterwards(STEP * list.length + 300, options.after)
}

/* ——— Merge ——— */

export const merge = (id?: string, then?: Edit, all = false) => {
  const c = proto.current()
  const ready = c.changes.filter((one) => open(one) && one.ready === true && (one.waiting ?? 0) === 0)
  // All of them: each ready one, the bottom of a stack before what stands on it.
  const stacked = (all && ready.length > 1) || (ready.length > 1 && ready.some((one) => one.on !== undefined))
  const target = changeIn(c, id) ?? ready[0]
  const order = stacked
    ? [...ready.filter((one) => one.on === undefined), ...ready.filter((one) => one.on !== undefined)]
    : target === undefined
      ? []
      : [target]
  const list = order.map((one): Edit => (cc) => {
    const above = cc.changes.find((other) => other.on === one.id)
    const waited = cc.changes.filter((other) => other.after === one.id && open(other))
    const next = {
      ...cc,
      changes: cc.changes.map((other) =>
        other.id === one.id
          ? { ...other, state: 'merged' as const, ready: undefined, place: 'none' as const, checks: undefined, shipping: undefined }
          : other.on === one.id
            ? { ...other, on: undefined, toward: undefined }
            : other.after === one.id
              ? { ...other, after: undefined, checks: 'running' as const, failing: undefined }
              : other,
      ),
    }
    return compose(
      calm,
      stamped(
        'merged',
        `${recordOf(one)}.${waited.length === 0 ? '' : ` ${joined(waited.map(nameOf))} took main in.`}${above === undefined ? '' : ` ${nameOf(above)} goes into main now.`}`,
        waited[0]?.id ?? one.id,
      ),
    )(next)
  })
  list.push((cc) => {
    const left = cc.changes.filter(open)
    if (left.length > 0) return working(cc)
    const last = order.at(-1)
    return compose(
      ...(cc.reviewer?.when === 'after' && last !== undefined ? [beat({ kind: 'review', findings: 0, after: true, change: last.id })] : []),
      then ?? settled,
    )(cc)
  })
  steps(list)
  // What waited for it: its checks run with main in, and pass a beat later where the case runs on.
  const waited = c.changes.filter((other) => open(other) && order.some((one) => other.after === one.id))
  if (c.passes === true && waited.length > 0) proto.later(STEP * (list.length + 1), compose(...waited.map((one) => passing(one.id))), c.key)
}

/* ——— Fix it, post it, resolve it ——— */

/** A round to fix a failing check: its commit waits for Ship, as the ADR has it, beside the failing head. */
const fixChecks = (id: string) => {
  const c = proto.current()
  const one = changeIn(c, id)
  if (one === undefined) return
  const failing = one.failing?.[0] ?? 'a check'
  steps([
    compose(working, live(`Fixing ${failing} on ${nameOf(one)}.`, id)),
    compose(
      change(id, (x) => ({ ...x, waiting: (x.waiting ?? 0) + 1 })),
      calm,
      line(`Fixed ${failing}. One commit, not shipped: ${failing} still fails on ${nameOf(one)}’s pushed head until Ship replaces it.`, id),
      standing('running', 'running', 'Not shipped'),
    ),
  ])
}

/** After a merge, what its review found, fixed in a change of its own. */
const fixAfterMerge = (c: Case, ask?: Extract<Ask, { kind: 'after-merge' }>) => {
  const merged = c.changes.find((one) => one.state === 'merged' && one.found !== undefined)
  const name = merged === undefined ? '' : nameOf(merged)
  const found = ask?.findings.length ?? merged?.found ?? 0
  proto.edit(
    compose(
      (cc) => ({ ...cc, changes: cc.changes.map((one) => (one.id === merged?.id ? { ...one, found: undefined } : one)) }),
      added({
        id: 'fix',
        branch: `${merged?.branch ?? 'althar/fix'}-fix`,
        title: `Settle what the review found on ${name}`,
        place: 'worktree',
      }),
      part('lead', `${merged?.branch ?? 'althar/fix'}-fix, after ${name}, for its ${found} findings.`, 'fix', 'change'),
      working,
    ),
  )
}

export const postReview = () => {
  const c = proto.current()
  const pr = c.reviewing?.pr
  proto.edit(
    compose(
      (cc) => ({ ...cc, reviewing: cc.reviewing === undefined ? undefined : { ...cc.reviewing, draft: undefined } }),
      part('you', `You posted the review on #${pr ?? ''}.`),
      ...(c.kind === 'review' ? [standing('settled', 'done', 'Posted')] : []),
    ),
  )
}

export const reviewNow = () =>
  steps([
    live('Reviewing everything since the last review.'),
    compose(calm, beat({ kind: 'review', findings: 0 }), part('you', 'You asked for a review of everything since the last one.')),
  ])

/* ——— Where it works ——— */

export const toLocal = (id: string) => {
  proto.edit((c) => ({ ...c, moving: { change: id, to: 'local' } }))
  raise({ kind: 'switch', change: id, own: 'balazs/notes' })
}

export const toWorktree = (id: string) => {
  const c = proto.current()
  const one = changeIn(c, id)
  if (one === undefined) return
  proto.edit(
    compose(
      (cc) => ({ ...cc, moving: { change: id, to: 'worktree' as const, waitsOn: 'Board.tsx' } }),
      part('you', `You moved ${one.branch} to a worktree.`, id),
      live('Moves to a worktree once Board.tsx is committed.', id, 'Call it off'),
    ),
  )
}

export const callOff = () =>
  proto.edit(
    compose(
      (c) => ({ ...c, moving: undefined }),
      calm,
      dropAct('Call it off'),
      part('you', 'You called off the move. It stays in your checkout.', proto.current().moving?.change),
    ),
  )

export const removeFolder = (id: string) => {
  const one = changeIn(proto.current(), id)
  if (one === undefined) return
  proto.edit(
    compose(
      change(id, (x) => ({ ...x, place: 'none' as const, helper: undefined })),
      part('you', `You removed ${nameOf(one)}’s worktree. ${one.branch} stays, here and on GitHub.`, id),
    ),
  )
}

export const stopHelper = (id: string) => {
  const one = changeIn(proto.current(), id)
  if (one === undefined) return
  proto.edit(
    compose(
      change(id, (x) => ({ ...x, helper: undefined })),
      part('you', `You stopped the helper on ${nameOf(one)}. What it committed stays.`, id),
    ),
  )
}

export const takeWorktree = () =>
  proto.edit(
    compose(
      (c) => ({
        ...c,
        copy: undefined,
        lane: c.lane === 'scratch' ? 'running' : c.lane,
        changes: [
          ...c.changes,
          { id: 'jump', branch: 'althar/what-does-adr-087-say-about-helpers', title: c.title, place: 'worktree' as const },
        ],
      }),
      part('you', 'You gave it a worktree. It’s on the board now.', 'jump'),
    ),
  )

/* ——— Access: outside code ——— */

export const runIt = () => {
  const c = proto.current()
  if (c.reviewing !== undefined) raise({ kind: 'run-it', pr: c.reviewing.pr, by: c.reviewing.by })
}

const runSafely = () => {
  const pr = proto.current().reviewing?.pr ?? ''
  steps([
    compose(
      (c) => ({ ...c, access: 'safe' as const }),
      part('you', `You ran #${pr} safely: offline, install scripts off.`),
      live('Installing from the lockfile, install scripts off.'),
    ),
    compose(
      calm,
      beat({
        kind: 'line',
        text: 'electron and playwright didn’t install: they need their install scripts.',
        tone: 'warning',
        act: 'Trust fully',
      }),
    ),
  ])
}

export const trust = () => {
  const pr = proto.current().reviewing?.pr ?? ''
  steps([
    compose(
      (c) => ({ ...c, access: 'full' as const }),
      dropAct('Trust fully'),
      part('you', `You trusted #${pr} fully: install scripts and the network.`),
      live('Installing electron and playwright, install scripts on.'),
    ),
    compose(calm, line('Installed electron and playwright. The end-to-end tests ran: 38 of 38 pass.')),
  ])
}

export const stopRunning = () =>
  proto.edit(
    compose((c) => ({ ...c, access: 'read' as const }), calm, dropAct('Trust fully'), part('you', 'What ran stopped. Read only again.')),
  )

/* ——— Parts: added, switched, removed ——— */

const NEXT_NAMES = ['tests', 'docs', 'extra']

/** A second, third change: a branch of its own, in its own worktree. */
export const addChange = () => {
  const c = proto.current()
  const n = c.changes.filter((one) => one.id.startsWith('new')).length
  const slug = NEXT_NAMES[n] ?? `more-${n}`
  const id = `new${n}`
  const branch = `althar/board-still-${slug}`
  proto.edit(
    compose(
      added({ id, branch, title: 'A change of its own', place: 'worktree' }),
      part('you', `${branch}, started by you.`, id, 'change'),
      (cc) => (cc.lane === 'scratch' ? { ...cc, lane: 'running' as const, status: 'running' as const } : cc),
    ),
  )
}

export const addCheckedBy = () =>
  proto.edit(compose((c) => ({ ...c, reviewer: SOL }), part('you', 'You added Checked by: GPT-6.1 Sol, before it ships.')))

export const addReview = () =>
  proto.edit(
    compose(
      (c) => ({ ...c, reviewing: { pr: 698, title: 'Virtualize long boards', by: 'noor-a', copy: true } }),
      part('you', 'You added a review of #698.'),
    ),
  )

export const attachPr = (pr = 718, base = 'release/0.8.0') => {
  const c = proto.current()
  if (c.changes.some((one) => one.pr === pr)) return
  const first = c.changes.find(open) ?? c.changes[0]
  proto.edit(
    compose(
      added({
        id: `pr${pr}`,
        branch: first?.branch ?? 'althar/board-still',
        pr,
        state: 'open',
        title: 'Hold the board still, into the release',
        checks: 'running',
        toward: base,
        came: 'outside',
        place: 'none',
      }),
      part('you', `#${pr}, into ${base}, attached by you.`, `pr${pr}`, 'change'),
    ),
  )
}

export const checkedWhen = () => {
  const when = proto.current().reviewer?.when
  proto.edit(
    compose(
      (c) => ({
        ...c,
        reviewer: c.reviewer == null ? c.reviewer : { ...c.reviewer, when: when === 'before' ? ('after' as const) : ('before' as const) },
      }),
      part('you', `You moved Checked by to ${when === 'before' ? 'after it merges' : 'before it ships'}.`),
    ),
  )
}

export const removeCheckedBy = () =>
  proto.edit(compose((c) => ({ ...c, reviewer: null }), part('you', 'You removed Checked by. Its findings stay in the thread.')))

/** A review is a part too: removing one with a draft not posted asks first; otherwise it just goes. */
export const removeReview = () => {
  const c = proto.current()
  if (c.reviewing === undefined) return
  if (c.reviewing.draft !== undefined) raise({ kind: 'remove-draft', pr: c.reviewing.pr, findings: c.reviewing.draft })
  else proto.edit(compose((cc) => ({ ...cc, reviewing: undefined }), part('you', `You removed the review of #${c.reviewing.pr}.`)))
}

export const setPreset = (to: Preset) =>
  proto.edit(
    compose(
      (c) => ({ ...c, preset: to, ...(to === 'Change' && c.reviewer == null ? { reviewer: SOL } : {}) }),
      part('you', to === 'Change' ? 'You switched it to Change: Checked by moves to before it ships.' : `You switched it to ${to}.`),
    ),
  )

export const savePreset = () => proto.edit(part('you', 'You saved its parts as a preset, “Board fix”.'))

/**
 * The change the window is about: what you say next, and “Ship it”, go to it. A view, not news: no line in the thread, and the
 * card still works out what most needs the person each time it is drawn.
 */
export const workOn = (id: string) => {
  if (changeIn(proto.current(), id) === undefined) return
  proto.edit((c) => ({ ...c, working: id }))
}

/* ——— A line's way on ——— */

export const lineAct = (act: string, id?: string) => {
  const c = proto.current()
  const one = changeIn(c, id)
  switch (act) {
    case 'Call it off':
      return callOff()
    case 'Trust fully':
      return trust()
    case 'Keep them together': {
      const into = c.changes.find((other) => other.id !== id && open(other))
      if (one === undefined || into === undefined) return undefined
      const closes = [...(into.closes ?? []), ...(one.closes ?? [])]
      return proto.edit(
        compose(
          (cc) => ({
            ...cc,
            changes: cc.changes
              .filter((other) => other.id !== id)
              .map((other) =>
                other.id === into.id
                  ? {
                      ...other,
                      waiting: (other.waiting ?? 0) + (one.waiting ?? 0),
                      ...(closes.length === 0 ? {} : { closes }),
                      // Alone again, it goes by its pull request or branch, as a task that never split does.
                      ...(cc.changes.filter(open).length <= 2 ? { short: undefined } : {}),
                    }
                  : other,
              ),
          }),
          dropAct(act),
          part(
            'you',
            `You kept ${nameOf(one)} with ${nameOf(into)}, on ${into.branch}${closes.length > 1 ? `. Its pull request closes ${joined(closes)}` : ''}.`,
          ),
        ),
      )
    }
    case 'Drop it':
      return proto.edit(compose(without(id ?? ''), dropAct(act), part('you', `You dropped ${one?.branch ?? 'it'}. The branch stays.`)))
    case 'Fix it':
      return one?.state === 'merged' ? fixAfterMerge(c) : id === undefined ? undefined : fixChecks(id)
    default:
      return proto.edit(compose(dropAct(act), part('you', `You chose ${act}.`)))
  }
}

/* ——— The asks ——— */

/** The button each ask puts first: what its card's own sentence and its chip press. */
export const PRIMARY: Record<Ask['kind'], string> = {
  'run-it': 'Run safely',
  switch: 'Switch',
  'settle-unshipped': 'Ship, then settle',
  'merge-unshipped': 'Review and merge',
  'remove-draft': 'Post it first',
  'after-merge': 'Fix it',
  'close-old': 'Close it',
  usage: 'Use another model',
  stuck: 'Try again',
  refused: 'Set up signing',
  attach: 'Attach it',
  'preset-offer': 'Keep it',
  'ship-stack': 'Ship',
}

/** Answer an ask by one of its buttons: the card says what was chosen, and the case changes to match. */
export const answerAsk = (c: Case, ask: Ask, choice: string) => {
  const key = `${c.key}:${ask.kind}`
  const say = (words: string, edit?: Edit) => proto.answer(key, words, edit)
  const id = 'change' in ask ? ask.change : undefined
  const one = changeIn(c, id)
  switch (ask.kind) {
    case 'run-it':
      if (choice === 'Run safely') {
        say('Run safely')
        return runSafely()
      }
      if (choice === 'Trust fully') {
        say('Trust fully')
        return trust()
      }
      return say('Not now')
    case 'switch':
      if (choice === 'Switch')
        return say(
          `Switched to ${one?.branch ?? ''}`,
          compose(
            change(ask.change, (x) => ({ ...x, place: 'local' as const })),
            (cc) => ({ ...cc, moving: undefined }),
            part('you', `You moved ${one?.branch ?? 'it'} to your checkout. It goes back to ${ask.own} when you settle.`, ask.change),
            working,
          ),
        )
      return say(
        'Stay in the worktree',
        compose((cc) => ({ ...cc, moving: undefined }), working),
      )
    case 'settle-unshipped':
      if (choice === 'Ship, then settle') {
        say('Ship, then settle')
        return ship(ask.change, { last: compose(calm, settled) })
      }
      return say(
        'Settled. The commits stay on the branch.',
        compose(
          change(ask.change, (x) => ({ ...x, waiting: undefined })),
          settled,
        ),
      )
    case 'merge-unshipped':
      if (choice === 'Review and merge') {
        say('Review and merge')
        return ship(ask.change, { after: () => merge(ask.change) })
      }
      say('Merge now')
      return merge(ask.change)
    case 'remove-draft':
      if (choice === 'Post it first')
        return say(
          `Posted on #${ask.pr}, then removed`,
          compose((cc) => ({ ...cc, reviewing: undefined }), part('you', `You posted the review on #${ask.pr}, then removed it.`)),
        )
      if (choice === 'Remove without posting')
        return say(
          'Removed. The draft stays in the thread.',
          compose(
            (cc) => ({ ...cc, reviewing: undefined }),
            part('you', `You removed the review of #${ask.pr}. Its draft stays in the thread.`),
          ),
        )
      return say('Kept')
    case 'after-merge':
      if (choice === 'Fix it') {
        say(`Fix it: a new change, after #${ask.pr}`)
        return fixAfterMerge(c, ask)
      }
      return say(
        'Left. The findings stay here.',
        compose((cc) => ({ ...cc, changes: cc.changes.map((x) => ({ ...x, found: undefined })) }), settled),
      )
    case 'close-old':
      return choice === 'Close it'
        ? say(`Closed #${ask.old}`, compose(working, line(`Closed #${ask.old}. #${ask.now} carries on.`)))
        : say(`Kept #${ask.old} open`, working)
    case 'usage': {
      if (choice === 'Wait') return say(`Waits until ${ask.until}`)
      // The chip's press takes the card's first free model: GPT-6.1 Sol, as the person's notes order them.
      const to = choice.startsWith('swap:') ? choice.slice(5) : 'GPT-6.1 Sol'
      return say(`Moved to ${to}`, compose(working, part('you', `You moved the lead to ${to} until Claude is back.`)))
    }
    case 'stuck': {
      const stuck = c.changes.find((x) => x.shipping !== undefined)?.id
      if (choice.startsWith('retry:')) {
        const to = choice.slice(6)
        say(`Reviewing with ${to}`, (cc) => ({ ...cc, reviewer: cc.reviewer == null ? cc.reviewer : { ...cc.reviewer, who: to } }))
        return ship(stuck)
      }
      if (choice === 'Ship without it') {
        say('Shipped without a review')
        return ship(stuck, { skipReview: true })
      }
      say('Trying the review again')
      return ship(stuck)
    }
    case 'refused':
      say(choice === 'Set up signing' ? 'Signing set up. Shipping' : 'Shipping again')
      return ship(ask.change, { skipReview: true })
    case 'attach':
      if (choice === 'Attach it') {
        say(`Attached #${ask.pr} as a change of its own`)
        return attachPr(ask.pr, ask.base)
      }
      return say('Left alone')
    case 'preset-offer':
      return say(choice === 'Keep it' ? `Kept as “${ask.name}”` : 'Not now')
    case 'ship-stack':
      return ship(ask.change)
  }
}

/* ——— A button, by its label ——— */

/**
 * What a button named this does, for the change it is on, where it is on one. A button that is an ask's first answer answers
 * the ask: the card, the bar and the chip are one control.
 */
export const act = (label: string, id?: string) => () => {
  const c = proto.current()
  const asked = askOf(c, proto.get().answered)
  if (asked !== null && askNeed(c, asked).act === label && (id === undefined || !('change' in asked) || asked.change === id))
    return answerAsk(c, asked, PRIMARY[asked.kind])
  if (label === 'Ship' || label === 'Ship them all') return ship(label === 'Ship them all' ? undefined : id)
  if (label === 'Merge both' || label.startsWith('Merge all')) return merge(undefined, undefined, true)
  if (label.startsWith('Merge')) return merge(id)
  if (label === 'Fix it') return lineAct('Fix it', id)
  if (label === 'Post it') return postReview()
  if (label === 'Run it') return runIt()
  if (label === 'Call it off') return callOff()
  if (label === 'Trust fully') return trust()
  if (label === 'Use another model') return raise({ kind: 'usage', agent: 'Claude Opus 5.5', until: '14:00' })
  if (label === 'Try again' || label.startsWith('Sign')) return ship(id, { skipReview: true })
  return undefined
}
