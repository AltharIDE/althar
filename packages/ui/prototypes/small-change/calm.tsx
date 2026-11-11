import { AskCard, Button, HoverCard, Icon, LinkButton, Model, Spinner } from '@althar/ui'
import type { ReactNode } from 'react'

import today from '../../src/thread/SmallChange/SmallChange.module.css'
import c from './calm.module.css'
import { merged, type SmallState, SOL, SONNET } from './states'

/*
 * Third round, from scratch: the card opens the thread and should be calm.
 * What a small change is waits behind a hover on its name; the card itself
 * says only the title and where it stands, in ink, with Merge.
 */

export interface CardProps {
  state: SmallState
}

export interface Direction {
  key: string
  letter: string
  name: string
  idea: string
  Card: (props: CardProps) => ReactNode
}

const noop = () => {}
/** ?hover opens what a small change is, for a screenshot of it. */
const HOVER = new URLSearchParams(location.search).has('hover')

/** What a small change is, behind its name. */
function Explained({ s, children }: { s: SmallState; children: ReactNode }) {
  const card =
    s.key === 'full' ? (
      <p className={c.hover}>
        It was a small change. Now <Model model={SOL} short /> reviews it before it merges, as any change.
      </p>
    ) : (
      <p className={c.hover}>
        Starts at once on <Model model={SONNET} short />, with no plan. You merge it, then <Model model={SOL} short /> reviews what merged;
        anything it finds comes back here. To have it reviewed first, make it a full task.
      </p>
    )
  return (
    <HoverCard card={card} width={280} placement="below" {...(HOVER ? { defaultOpen: true } : {})}>
      <span tabIndex={0} className={c.named}>
        {children}
      </span>
    </HoverCard>
  )
}

/** Where it stands, in a few words, and when. */
function where(s: SmallState): { what: ReactNode; at?: string | undefined; tone?: 'bad' | 'live' } {
  switch (s.key) {
    case 'started':
      return { what: 'Started', at: s.started, tone: 'live' }
    case 'changing':
      return { what: `Changing ${s.files} files`, tone: 'live' }
    case 'checks':
      return { what: 'Checks running', at: s.changed, tone: 'live' }
    case 'failed':
      return { what: 'Checks failed', tone: 'bad' }
    case 'ready':
      return { what: 'Checks pass', at: s.checked }
    case 'merging':
      return { what: 'Merging', tone: 'live' }
    case 'queued':
      return { what: 'In the merge queue', tone: 'live' }
    case 'reviewing':
      return { what: 'Merged, in review', at: s.merged, tone: 'live' }
    case 'clean':
      return { what: 'Merged, nothing found', at: s.reviewed }
    case 'findings':
      return { what: `Merged, review found ${s.findings}`, at: s.reviewed, tone: 'bad' }
    case 'full':
      return { what: 'Checks running', at: s.changed, tone: 'live' }
  }
}

function Where({ s }: { s: SmallState }) {
  const w = where(s)
  return (
    <span className={c.where} data-tone={w.tone}>
      {w.tone === 'live' && s.key !== 'merging' && <span className={c.pulse} />}
      {s.key === 'merging' && <Spinner size="small" />}
      <span>{w.what}</span>
      {w.at && <span className={c.at}>{w.at}</span>}
    </span>
  )
}

/** What there is to press: Merge, or Fix it and Leave it. */
function Acts({ s }: { s: SmallState }) {
  if (s.key === 'ready')
    return (
      <Button size="small" variant="signal" onClick={noop}>
        Merge
      </Button>
    )
  if (s.key === 'findings')
    return (
      <span className={c.acts}>
        <Button size="small" variant="quiet" onClick={noop}>
          Leave it
        </Button>
        <Button size="small" variant="signal" onClick={noop}>
          Fix it
        </Button>
      </span>
    )
  return null
}

const canGoFull = (s: SmallState) => !merged(s) && !['merging', 'queued', 'full'].includes(s.key)

/* ——— A · Today, emptied ——— */

function Emptied({ state: s }: CardProps) {
  return (
    <AskCard
      icon="after"
      kicker={<Explained s={s}>{s.key === 'full' ? 'Full task' : 'Small change'}</Explained>}
      quiet
      who={
        canGoFull(s) && (
          <LinkButton className={today.aside} onClick={noop}>
            Make it a full task
          </LinkButton>
        )
      }
    >
      <div className={c.body}>
        <p className={c.title}>{s.title}</p>
        <div className={c.foot}>
          <Where s={s} />
          <Acts s={s} />
        </div>
      </div>
    </AskCard>
  )
}

/* ——— B · One line ——— */

function Line({ state: s }: CardProps) {
  return (
    <div className={c.line}>
      <Icon name="after" size={12} />
      <Explained s={s}>
        <span className={c.kind}>{s.key === 'full' ? 'Full task' : 'Small change'}</span>
      </Explained>
      <span className={c.lineTitle}>{s.title}</span>
      {canGoFull(s) && (
        <LinkButton className={c.lineFull} onClick={noop}>
          Make it a full task
        </LinkButton>
      )}
      <Where s={s} />
      <Acts s={s} />
    </div>
  )
}

/* ——— C · Today, its steps in a row ——— */

function Row({ state: s }: CardProps) {
  const steps: [string, string | undefined][] = [
    ['Started', s.started],
    ['Changed', s.changed],
    ['Checks', s.checked],
    ['Merged', s.merged],
  ]
  const next = steps.findIndex(([, at]) => at === undefined)
  const w = where(s)
  return (
    <AskCard
      icon="after"
      kicker={<Explained s={s}>{s.key === 'full' ? 'Full task' : 'Small change'}</Explained>}
      quiet
      who={
        canGoFull(s) && (
          <LinkButton className={today.aside} onClick={noop}>
            Make it a full task
          </LinkButton>
        )
      }
    >
      <div className={c.body}>
        <p className={c.title}>{s.title}</p>
        <div className={c.foot}>
          <ol className={c.steps}>
            {steps.map(([what, at], i) =>
              (i > next && next >= 0) || (merged(s) && what !== 'Merged') || (s.key === 'ready' && what === 'Merged') ? null : (
                <li
                  key={what}
                  data-done={at !== undefined || undefined}
                  data-now={i === next || undefined}
                  data-tone={i === next ? w.tone : undefined}
                >
                  <span>{i === next && s.key === 'failed' ? 'Checks failed' : what}</span>
                  {at && <span className={c.at}>{at}</span>}
                </li>
              ),
            )}
            {merged(s) && (
              <li
                data-done={s.key !== 'reviewing' || undefined}
                data-now={s.key === 'reviewing' || undefined}
                data-tone={s.key === 'findings' ? 'bad' : s.key === 'reviewing' ? 'live' : undefined}
              >
                <span>{s.key === 'findings' ? `Found ${s.findings}` : s.key === 'clean' ? 'Reviewed' : 'Review'}</span>
                {s.reviewed && <span className={c.at}>{s.reviewed}</span>}
              </li>
            )}
          </ol>
          <Acts s={s} />
        </div>
      </div>
    </AskCard>
  )
}

export const CALM: readonly Direction[] = [
  {
    key: 'a',
    letter: 'A',
    name: 'Today, emptied',
    idea: 'Today’s card with only its title and where it stands. What a small change is, behind its name.',
    Card: Emptied,
  },
  {
    key: 'b',
    letter: 'B',
    name: 'One line',
    idea: 'No card: one line at the top of the thread. Its name opens what a small change is.',
    Card: Line,
  },
  {
    key: 'c',
    letter: 'C',
    name: 'Steps in a row',
    idea: 'Today’s card, its steps as one quiet row of times. Its name opens what a small change is.',
    Card: Row,
  },
]
