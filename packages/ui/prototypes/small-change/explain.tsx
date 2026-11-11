import { AskCard, AskFoot, Button, Caret, Disclosure, DisclosureTrigger, Fold, Icon, LinkButton, Model } from '@althar/ui'
import type { ReactNode } from 'react'

import today from '../../src/thread/SmallChange/SmallChange.module.css'
import type { CardProps, Direction } from './directions'
import e from './explain.module.css'
import { merged, type SmallState, SOL, SONNET } from './states'

/*
 * The second round: the card opens the thread, so its first job is to say
 * what a small change is, not to track it. Each starts from today's card
 * (its own CSS, its head, its list) and explains the lane a different way.
 */

const noop = () => {}

/** A row of today's list: a dot, ticked once done, what, and when. */
interface Row {
  readonly key: string
  readonly what: ReactNode
  readonly at?: string | undefined
  readonly done?: boolean
  /** Not on this path, or later than usual: drawn quieter, with what became of it. */
  readonly skipped?: ReactNode
  readonly failed?: boolean
}

function Rows({ rows }: { rows: readonly Row[] }) {
  return (
    <ol className={today.steps}>
      {rows.map((row) => (
        <li
          key={row.key}
          data-done={row.done || undefined}
          data-failed={row.failed || undefined}
          className={row.skipped === undefined ? undefined : e.skipped}
        >
          <span className={today.dot}>
            {row.done && <Icon name="check" size={9} />}
            {row.skipped !== undefined && <span className={e.dash} />}
          </span>
          <span className={today.stepWhat}>
            {row.what}
            {row.skipped !== undefined && <span className={e.why}>{row.skipped}</span>}
          </span>
          <span className={today.when}>{row.at ?? ''}</span>
        </li>
      ))}
    </ol>
  )
}

/** Today's four steps, as the state has them. */
function todayRows(s: SmallState): Row[] {
  return [
    { key: 'started', what: 'Started', at: s.started, done: true },
    {
      key: 'changed',
      what: s.changed ? `Changed ${s.files} files` : s.key === 'changing' ? `Changing ${s.files} files` : 'Change',
      at: s.changed,
      done: s.changed !== undefined,
    },
    {
      key: 'checks',
      what: s.key === 'failed' ? 'Checks failed: types' : 'Checks pass',
      at: s.checked,
      done: s.checked !== undefined,
      failed: s.key === 'failed',
    },
    {
      key: 'merged',
      what: s.key === 'merging' ? 'Merging' : s.key === 'queued' ? 'In the merge queue' : 'Merged',
      at: s.merged,
      done: s.merged !== undefined,
    },
  ]
}

/** The review after merge, as a row of the list. */
function reviewRow(s: SmallState): Row {
  const by = <Model model={SOL} short />
  if (s.key === 'clean') return { key: 'review', what: <>Reviewed by {by}: nothing found</>, at: s.reviewed, done: true }
  if (s.key === 'findings')
    return {
      key: 'review',
      what: (
        <>
          Reviewed by {by}: {s.findings} findings
        </>
      ),
      at: s.reviewed,
      failed: true,
    }
  if (s.key === 'reviewing') return { key: 'review', what: <>{by} is reviewing it</> }
  return { key: 'review', what: <>Reviewed by {by}</> }
}

/** Today's foot: Merge where it is ready, Fix it and Leave it where the review found something. */
function Foot({ s }: { s: SmallState }) {
  if (s.key === 'ready' || s.key === 'merging')
    return (
      <AskFoot>
        <Button size="small" variant="signal" busy={s.key === 'merging'} onClick={noop}>
          Merge
        </Button>
      </AskFoot>
    )
  if (s.key === 'findings')
    return (
      <AskFoot>
        <Button size="small" variant="signal" onClick={noop}>
          Fix it
        </Button>
        <Button size="small" variant="quiet" onClick={noop}>
          Leave it
        </Button>
      </AskFoot>
    )
  return null
}

const canGoFull = (s: SmallState) => !merged(s) && !['merging', 'queued', 'full'].includes(s.key)

function Head({ s, children, who }: { s: SmallState; children: ReactNode; who?: ReactNode }) {
  const full = s.key === 'full'
  return (
    <AskCard
      icon="after"
      kicker={full ? 'Full task' : 'Small change'}
      quiet={!(s.key === 'ready' || s.key === 'findings')}
      who={
        who === undefined
          ? canGoFull(s) && (
              <LinkButton className={today.aside} onClick={noop}>
                Make it a full task
              </LinkButton>
            )
          : who
      }
    >
      <p className={today.what}>
        <span className={today.titleText}>{s.title}</span>
      </p>
      {children}
    </AskCard>
  )
}

/* ——— E · Says it in a sentence ——— */

function Sentence({ state: s }: CardProps) {
  const full = s.key === 'full'
  return (
    <Head s={s}>
      <p className={e.sentence}>
        {full ? (
          <>
            <Model model={SOL} short /> reviews it before you can merge it, as any change.
          </>
        ) : (
          <>
            Starts at once on <Model model={SONNET} short />, with no plan. You merge it; <Model model={SOL} short /> reviews it after, and
            what it finds comes back here.
          </>
        )}
      </p>
      <Rows rows={full ? [...todayRows(s).slice(0, 3), reviewRow(s), todayRows(s)[3]!] : [...todayRows(s), reviewRow(s)]} />
      <Foot s={s} />
    </Head>
  )
}

/* ——— F · What it skips, in the list ——— */

function Skips({ state: s }: CardProps) {
  const full = s.key === 'full'
  const [started, changed, checks, mergedRow] = todayRows(s)
  const review = reviewRow(s)
  const plan: Row = { key: 'plan', what: <s>Plan</s>, skipped: 'none for a small change' }
  const rows = full
    ? [
        started!,
        changed!,
        checks!,
        {
          ...review,
          what: (
            <>
              Review by <Model model={SOL} short />
            </>
          ),
        },
        mergedRow!,
      ]
    : [plan, started!, changed!, checks!, mergedRow!, merged(s) ? review : { ...review, skipped: 'after it merges, not before' }]
  return (
    <Head s={s}>
      <p className={today.skipped}>
        One step on <Model model={SONNET} short />
      </p>
      <div className={e.gap} />
      <Rows rows={rows} />
      <Foot s={s} />
    </Head>
  )
}

/* ——— G · It explains itself, folded ——— */

function Explained({ state: s }: CardProps) {
  const full = s.key === 'full'
  // The first time someone sees one, it is open; after, a press away.
  const first = s.key === 'started'
  return (
    <Head s={s}>
      <Disclosure defaultOpen={first}>
        <DisclosureTrigger>
          <button type="button" className={e.trigger}>
            <span className={today.skipped}>
              <Model model={SONNET} short />, no plan, {full ? 'reviewed before it merges' : 'reviewed after it merges'}
            </span>
            <Caret />
          </button>
        </DisclosureTrigger>
        <Fold bleed={false}>
          <ul className={e.how}>
            <li>
              <Icon name="play" size={11} />
              <span>
                <b>Starts at once.</b> One step on a quick model, with no plan to approve and no countdown.
              </span>
            </li>
            <li>
              <Icon name="branch" size={11} />
              <span>
                <b>You merge it.</b> No review stands between its checks and the merge.
              </span>
            </li>
            <li>
              <Icon name="search" size={11} />
              <span>
                <b>Reviewed after.</b> <Model model={SOL} short /> reads what merged. What it finds comes back to this thread, to fix in a
                new pull request or leave.
              </span>
            </li>
            {canGoFull(s) && (
              <li className={e.out}>
                <Icon name="arrow" size={11} />
                <span>
                  Want it read first? <LinkButton onClick={noop}>Make it a full task</LinkButton>
                </span>
              </li>
            )}
          </ul>
        </Fold>
      </Disclosure>
      <div className={e.gap} />
      <Rows rows={merged(s) ? [...todayRows(s), reviewRow(s)] : todayRows(s)} />
      <Foot s={s} />
    </Head>
  )
}

/* ——— H · Small beside full ——— */

/** Where it stands, in a line: the last thing that happened, and when. */
function latest(s: SmallState): Row {
  const rows = merged(s) ? [...todayRows(s), reviewRow(s)] : todayRows(s)
  const live = rows.find((row) => !row.done && (row.failed || row.key === 'review' || row.what !== 'Change'))
  const last = [...rows].reverse().find((row) => row.done)
  if (s.key === 'findings' || s.key === 'clean') return rows.at(-1)!
  if (s.key === 'failed' || s.key === 'merging' || s.key === 'queued' || s.key === 'reviewing') return live ?? last!
  if (s.key === 'changing') return rows[1]!
  return last!
}

function Beside({ state: s }: CardProps) {
  const full = s.key === 'full'
  return (
    <Head s={s}>
      <div className={e.table} role="table">
        <div role="row" className={e.headRow}>
          <span role="columnheader" />
          <span role="columnheader" className={full ? e.off : e.on}>
            Small change
          </span>
          <span role="columnheader" className={full ? e.on : e.off}>
            Full task
          </span>
        </div>
        {[
          ['Starts', 'at once', 'after a plan you see'],
          ['Lead', <Model key="m" model={SONNET} short />, 'picked for the work'],
          ['Review', 'after you merge', 'before you merge'],
        ].map(([what, small, fullWay]) => (
          <div role="row" key={String(what)} className={e.row}>
            <span role="rowheader">{what}</span>
            <span role="cell" className={full ? e.off : e.on}>
              {small}
            </span>
            <span role="cell" className={full ? e.on : e.off}>
              {fullWay}
            </span>
          </div>
        ))}
      </div>
      <div className={e.gap} />
      <Rows rows={[latest(s)]} />
      <Foot s={s} />
    </Head>
  )
}

export const EXPLAINS: readonly Direction[] = [
  {
    key: 'e',
    letter: 'E',
    name: 'A sentence',
    idea: 'Today’s card, its meta line turned into the one sentence that says what a small change is. The review after merge joins the list.',
    Card: Sentence,
  },
  {
    key: 'f',
    letter: 'F',
    name: 'What it skips',
    idea: 'Today’s list, drawn as a task’s whole course: the plan it skips, struck through, and the review moved after the merge.',
    Card: Skips,
  },
  {
    key: 'g',
    letter: 'G',
    name: 'Explained, folded',
    idea: 'Today’s card; its meta line opens to how small changes work, open the first time, a press away after. Make it a full task is the way out, in it.',
    Card: Explained,
  },
  {
    key: 'h',
    letter: 'H',
    name: 'Beside a full task',
    idea: 'The card is a comparison: this small change beside a full task, three rows. Make it a full task stays in the head. Where it stands is one line under it.',
    Card: Beside,
  },
]
