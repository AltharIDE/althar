import { AskCard, Button, type ChangedFile, Delta, FileChanges, Icon, Menu, Model, Skeleton, Spinner } from '@althar/ui'
import { type ReactNode, useContext } from 'react'

import { BrandMark } from '../../src/foundations/Marks/Marks'
import { type Direction, Explained, ReviewMode } from './calm'
import f from './fresh.module.css'
import { Choices, type Review, useReview } from './review'
import { merged, type SmallState, SOL, SONNET } from './states'

/*
 * Fifth round, back to the drawing board: a bigger card with room to breathe,
 * one idea each, and the review after merge something this one change can
 * drop or take (the project's setting, R, is where each starts).
 */

const noop = () => {}

const FILES: readonly ChangedFile[] = [
  { path: 'packages/ui/src/outputs/Usage/Usage.tsx', add: 14, del: 52 },
  { path: 'packages/ui/src/outputs/Usage/Usage.module.css', add: 0, del: 21 },
  { path: 'packages/ui/src/outputs/Usage/Usage.stories.tsx', add: 0, del: 18 },
  { path: 'apps/desktop/src/renderer/shared/turnTime.ts', add: 9, del: 7 },
  { path: 'apps/desktop/tests/turnTime.test.tsx', add: 6, del: 2 },
  { path: 'apps/desktop/tests/usage.test.tsx', add: 12, del: 18 },
]
const SO_FAR: readonly ChangedFile[] = [
  { path: 'packages/ui/src/outputs/Usage/Usage.tsx', add: 9, del: 10 },
  { path: 'packages/ui/src/outputs/Usage/Usage.module.css', add: 0, del: 21 },
]
const filesOf = (s: SmallState) => (s.files === undefined ? [] : s.key === 'changing' ? SO_FAR : FILES)

const FINDINGS = [
  { at: 'Usage.tsx:112', what: 'The CSV export still reads byTime, now undefined, so it loses its last column.' },
  { at: 'turnTime.ts:40', what: 'A turn that runs past midnight is counted on both days.' },
]

const passed = (s: SmallState) => s.checks?.filter((c) => c.state === 'passed').length ?? 0
const failedCheck = (s: SmallState) => s.checks?.find((c) => c.state === 'failed')

/** The review's choice for this change, and the state as that choice draws it. */
function useChoice(state: SmallState) {
  const project = useContext(ReviewMode)
  const r = useReview(state)
  const menu = (trigger: ReactNode) => (
    <Menu label="Review" width={250} align="end" trigger={trigger as React.ReactElement}>
      <Choices review={r.review} onChange={r.setReview} project={project} />
    </Menu>
  )
  return { ...r, project, menu }
}

const kind = (s: SmallState) => (s.key === 'full' ? 'Full task' : 'Small change')
const Kicker = ({ s }: { s: SmallState }) => <Explained s={s}>{kind(s)}</Explained>

/** What the review found, and what to do with it. */
function Found({ mode }: { mode: ReviewMode }) {
  return (
    <div className={f.found}>
      <p className={f.foundHead}>
        <BrandMark brand={SOL.mark!} size={13} />
        <span>
          {FINDINGS.length} {mode === 'major' ? 'major ' : ''}findings after the merge
        </span>
      </p>
      <ul className={f.findings}>
        {FINDINGS.map((x) => (
          <li key={x.at}>
            <code>{x.at}</code>
            <span>{x.what}</span>
          </li>
        ))}
      </ul>
      <div className={f.acts}>
        <Button size="small" variant="quiet" onClick={noop}>
          Leave it
        </Button>
        <Button size="small" variant="signal" onClick={noop}>
          Fix it
        </Button>
      </div>
    </div>
  )
}

function MergeButton({ s }: { s: SmallState }) {
  if (s.key !== 'ready' && s.key !== 'merging') return null
  return (
    <Button size="medium" variant="signal" busy={s.key === 'merging'} onClick={noop}>
      Merge
    </Button>
  )
}

/* ——— A · The route: four stops, the review a stop you can move or take off ——— */

type Stop = { key: string; what: ReactNode; sub?: ReactNode; at: 'done' | 'now' | 'todo' | 'bad' | 'found'; later?: boolean }

function stops(s: SmallState, review: Review, mode: ReviewMode, reviewWord: (w: ReactNode) => ReactNode): Stop[] {
  const change: Stop =
    s.key === 'started'
      ? { key: 'change', what: 'Change', sub: `Started ${s.started}`, at: 'now' }
      : s.key === 'changing'
        ? { key: 'change', what: 'Change', sub: `${s.files} files so far`, at: 'now' }
        : { key: 'change', what: 'Change', sub: `${s.files} files · ${s.changed}`, at: 'done' }
  const checks: Stop =
    s.key === 'started' || s.key === 'changing'
      ? { key: 'checks', what: 'Checks', at: 'todo' }
      : s.key === 'checks' || s.key === 'full'
        ? { key: 'checks', what: 'Checks', sub: `${passed(s)} of ${s.checks?.length}`, at: 'now' }
        : s.key === 'failed'
          ? { key: 'checks', what: 'Checks', sub: `${failedCheck(s)?.name} failed`, at: 'bad' }
          : { key: 'checks', what: 'Checks', sub: `Passed · ${s.checked}`, at: 'done' }
  const merge: Stop = merged(s)
    ? { key: 'merge', what: 'Merge', sub: s.merged, at: 'done' }
    : s.key === 'ready'
      ? { key: 'merge', what: 'Merge', sub: 'Yours', at: 'now' }
      : s.key === 'merging'
        ? { key: 'merge', what: 'Merge', sub: 'Merging', at: 'now' }
        : s.key === 'queued'
          ? { key: 'merge', what: 'Merge', sub: 'In the queue, 2nd', at: 'now' }
          : { key: 'merge', what: 'Merge', at: 'todo' }
  const rev: Stop =
    review === 'before'
      ? { key: 'review', what: reviewWord('Review'), sub: 'Before merge', at: 'todo' }
      : s.key === 'reviewing'
        ? { key: 'review', what: 'Review', sub: <Model model={SOL} short />, at: 'now' }
        : s.key === 'clean'
          ? { key: 'review', what: 'Review', sub: mode === 'major' ? 'Nothing major' : 'Nothing found', at: 'done' }
          : s.key === 'findings'
            ? { key: 'review', what: 'Review', sub: `${s.findings}${mode === 'major' ? ' major' : ''} found`, at: 'found' }
            : { key: 'review', what: reviewWord('Review'), sub: 'After merge', at: 'todo', later: true }
  if (review === 'none') return [change, checks, merge]
  return review === 'before' ? [change, checks, rev, merge] : [change, checks, merge, rev]
}

function Route({ state }: { state: SmallState }) {
  const { review, shown: s, mode, open, menu } = useChoice(state)
  const word = (w: ReactNode) =>
    open
      ? menu(
          <button type="button" className={f.stopButton}>
            {w}
          </button>,
        )
      : w
  const list = stops(s, s.key === 'full' ? 'before' : review, mode, word)
  return (
    <AskCard icon="after" kicker={<Kicker s={s} />} quiet className={f.big}>
      <p className={f.title}>{s.title}</p>
      <ol className={f.route} style={{ gridTemplateColumns: `repeat(${list.length - 1}, minmax(0, 1fr)) auto` }}>
        {list.map((x) => (
          <li key={x.key} data-at={x.at} data-later={x.later || undefined}>
            <span className={f.knot}>
              {x.at === 'done' && <Icon name="check" size={9} />}
              {x.at === 'bad' && <Icon name="close" size={9} />}
              {x.at === 'found' && <span className={f.knotNum}>{s.findings}</span>}
            </span>
            <span className={f.stopWhat}>{x.what}</span>
            {x.sub && <span className={f.stopSub}>{x.sub}</span>}
          </li>
        ))}
        {open && review === 'none' && (
          <li className={f.addStop}>
            {menu(
              <button type="button" className={f.stopButton}>
                <Icon name="plus" size={10} /> Review
              </button>,
            )}
          </li>
        )}
      </ol>
      {s.key === 'failed' && (
        <p className={f.bad}>
          <code>{failedCheck(s)?.detail}</code>
          <span className={f.mute}>
            <Model model={SONNET} short /> is on it
          </span>
        </p>
      )}
      {s.key === 'findings' && mode !== 'off' && <Found mode={mode} />}
      {(s.key === 'ready' || s.key === 'merging') && (
        <div className={f.foot}>
          <span className={f.mute}>
            {s.files} files <Delta add={s.add} del={s.del} />
          </span>
          <MergeButton s={s} />
        </div>
      )}
    </AskCard>
  )
}

/* ——— B · The ring: one figure that fills as it goes, as the context ring does ——— */

const FILL: Record<SmallState['key'], number> = {
  started: 0.06,
  changing: 0.22,
  checks: 0.5,
  failed: 0.5,
  ready: 0.72,
  merging: 0.82,
  queued: 0.82,
  reviewing: 0.92,
  clean: 1,
  findings: 1,
  full: 0.5,
}

function RingFigure({ s, mode }: { s: SmallState; mode: ReviewMode }) {
  const r = 25
  const len = 2 * Math.PI * r
  const fill = mode === 'off' && merged(s) ? 1 : FILL[s.key]
  const inner =
    s.key === 'started' ? (
      <Spinner size="small" />
    ) : s.key === 'changing' ? (
      <Icon name="pencil" size={16} />
    ) : s.key === 'checks' || s.key === 'full' ? (
      <span className={f.ringNum}>
        {passed(s)}
        <small>/{s.checks?.length}</small>
      </span>
    ) : s.key === 'failed' ? (
      <Icon name="close" size={16} />
    ) : s.key === 'ready' ? (
      <Icon name="check" size={18} />
    ) : s.key === 'merging' || s.key === 'queued' ? (
      <Spinner size="small" />
    ) : s.key === 'reviewing' && mode !== 'off' ? (
      <BrandMark brand={SOL.mark!} size={20} />
    ) : s.key === 'findings' && mode !== 'off' ? (
      <span className={f.ringNum}>{s.findings}</span>
    ) : (
      <Icon name="check" size={18} />
    )
  return (
    <span className={f.ring} data-key={s.key} data-whole={fill === 1 || undefined}>
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r={r} className={f.ringTrack} />
        <circle cx="30" cy="30" r={r} className={f.ringFill} strokeDasharray={len} strokeDashoffset={len * (1 - fill)} />
      </svg>
      <span className={f.ringIn}>{inner}</span>
    </span>
  )
}

function ringLine(s: SmallState, mode: ReviewMode): { what: ReactNode; at?: string } {
  if (mode === 'off' && merged(s)) return { what: 'Merged', at: s.merged }
  switch (s.key) {
    case 'started':
      return {
        what: (
          <>
            Starting on <Model model={SONNET} short />
          </>
        ),
        at: s.started,
      }
    case 'changing':
      return { what: `Changing ${s.files} files` }
    case 'checks':
      return { what: 'Checks running', at: s.changed }
    case 'failed':
      return {
        what: (
          <>
            <span className={f.danger}>{failedCheck(s)?.name} failed</span> · <Model model={SONNET} short /> is on it
          </>
        ),
      }
    case 'ready':
      return {
        what: (
          <>
            Checks pass · {s.files} files <Delta add={s.add} del={s.del} />
          </>
        ),
        at: s.checked,
      }
    case 'merging':
      return { what: 'Merging' }
    case 'queued':
      return { what: 'In the merge queue, 2nd' }
    case 'reviewing':
      return {
        what: (
          <>
            Merged · <Model model={SOL} short /> is reading it
          </>
        ),
        at: s.merged,
      }
    case 'clean':
      return { what: mode === 'major' ? 'Merged · nothing major found' : 'Merged · nothing found', at: s.reviewed }
    case 'findings':
      return {
        what: (
          <>
            Merged ·{' '}
            <span className={f.signal}>
              {s.findings}
              {mode === 'major' ? ' major' : ''} found
            </span>
          </>
        ),
        at: s.reviewed,
      }
    case 'full':
      return {
        what: (
          <>
            Checks running · <Model model={SOL} short /> reviews before it merges
          </>
        ),
        at: s.changed,
      }
  }
}

function ReviewChip({ review, open, menu }: { review: Review; open: boolean; menu: (t: ReactNode) => ReactNode }) {
  if (!open) return null
  return menu(
    <button type="button" className={f.chip} data-off={review === 'none' || undefined}>
      <BrandMark brand={SOL.mark!} size={11} />
      {review === 'none' ? 'No review' : 'Review after merge'}
      <Icon name="chevronD" size={9} />
    </button>,
  )
}

function Ring({ state }: { state: SmallState }) {
  const { review, shown: s, mode, open, menu } = useChoice(state)
  const line = ringLine(s, mode)
  return (
    <AskCard icon="after" kicker={<Kicker s={s} />} quiet who={<ReviewChip review={review} open={open} menu={menu} />} className={f.big}>
      <div className={f.ringRow}>
        <RingFigure s={s} mode={mode} />
        <div className={f.ringText}>
          <p className={f.title}>{s.title}</p>
          <p className={f.line}>
            {line.what}
            {line.at && <span className={f.at}>{line.at}</span>}
          </p>
        </div>
        <MergeButton s={s} />
      </div>
      {s.key === 'failed' && (
        <p className={f.bad}>
          <code>{failedCheck(s)?.detail}</code>
        </p>
      )}
      {s.key === 'findings' && mode !== 'off' && <Found mode={mode} />}
    </AskCard>
  )
}

/* ——— C · The sentence: one line of prose, its review a phrase you can change ——— */

function Sentence({ state }: { state: SmallState }) {
  const { review, shown: s, mode, open, menu } = useChoice(state)
  const phrase = (w: string) =>
    open ? (
      menu(
        <button type="button" className={f.phrase}>
          {w}
        </button>,
      )
    ) : (
      <span>{w}</span>
    )
  const sol = <Model model={SOL} short />
  const after =
    review === 'none' || mode === 'off' ? (
      <>Nobody reviews it: {phrase('no review')}.</>
    ) : (
      <>
        {sol} reads it {phrase('after it merges')}
        {mode === 'major' ? '; only something major comes back.' : '.'}
      </>
    )
  const now: ReactNode = (() => {
    switch (s.key) {
      case 'started':
        return (
          <>
            <Model model={SONNET} short /> is reading the code. {after}
          </>
        )
      case 'changing':
        return (
          <>
            <Model model={SONNET} short /> has changed {s.files} files so far. {after}
          </>
        )
      case 'checks':
        return (
          <>
            {s.files} files changed; checks are running, {passed(s)} of {s.checks?.length} passed. {after}
          </>
        )
      case 'failed':
        return (
          <>
            <span className={f.danger}>{failedCheck(s)?.name} failed</span>, and <Model model={SONNET} short /> is fixing it. {after}
          </>
        )
      case 'ready':
        return (
          <>
            {s.files} files changed, and every check passed. {after}
          </>
        )
      case 'merging':
        return <>Merging.</>
      case 'queued':
        return <>Second in the merge queue.</>
      case 'reviewing':
        return mode === 'off' ? <>Merged.</> : <>Merged. {sol} is reading what merged.</>
      case 'clean':
        return mode === 'off' ? (
          <>Merged.</>
        ) : (
          <>
            Merged, and {sol} found nothing{mode === 'major' ? ' major' : ''}.
          </>
        )
      case 'findings':
        return mode === 'off' ? (
          <>Merged.</>
        ) : (
          <>
            Merged; {sol} found {s.findings}
            {mode === 'major' ? ' major things' : ' things'} after.
          </>
        )
      case 'full':
        return <>Now a full task: {sol} reviews it before it merges. Checks are running.</>
    }
  })()
  const times = [s.started, s.merged ?? s.checked ?? s.changed].filter(Boolean)
  return (
    <div className={f.note}>
      <p className={f.noteHead}>
        <Icon name="after" size={12} />
        <Kicker s={s} />
        <span className={f.at}>{times.join(' – ')}</span>
      </p>
      <p className={f.noteTitle}>{s.title}</p>
      <p className={f.prose}>{now}</p>
      {s.key === 'failed' && (
        <p className={f.bad}>
          <code>{failedCheck(s)?.detail}</code>
        </p>
      )}
      {s.key === 'findings' && mode !== 'off' && <Found mode={mode} />}
      {(s.key === 'ready' || s.key === 'merging') && (
        <div className={f.foot}>
          <span />
          <MergeButton s={s} />
        </div>
      )}
    </div>
  )
}

/* ——— D · The change itself: a small change is small enough to show whole ——— */

function Contents({ state }: { state: SmallState }) {
  const { review, shown: s, mode, open, menu } = useChoice(state)
  const files = filesOf(s)
  const done = merged(s)
  const head = ringLine(s, mode)
  return (
    <AskCard
      icon="after"
      kicker={<Kicker s={s} />}
      quiet
      who={
        <span className={f.status} data-tone={s.key === 'failed' ? 'bad' : undefined}>
          {head.what}
          {head.at && <span className={f.at}>{head.at}</span>}
        </span>
      }
      className={f.big}
    >
      <p className={f.title}>{s.title}</p>
      {files.length === 0 ? (
        <div className={f.skeleton}>
          <Skeleton width="62%" />
          <Skeleton width="44%" />
        </div>
      ) : done ? (
        <p className={f.folded}>
          <Icon name="branch" size={11} /> {s.files} files <Delta add={s.add} del={s.del} />
          <span className={f.at}>merged {s.merged}</span>
        </p>
      ) : (
        <FileChanges files={files} className={f.files} />
      )}
      {s.key === 'failed' && (
        <p className={f.bad}>
          <code>
            {failedCheck(s)?.name}: {failedCheck(s)?.detail}
          </code>
        </p>
      )}
      {s.key === 'findings' && mode !== 'off' && <Found mode={mode} />}
      {(open || s.key === 'merging') && (
        <div className={f.foot}>
          <ReviewChip review={review} open={open} menu={menu} />
          <MergeButton s={s} />
        </div>
      )}
    </AskCard>
  )
}

export const FRESH: readonly Direction[] = [
  {
    key: 'route',
    letter: 'A',
    name: 'Route',
    idea: 'Its stops in a row, the review one of them: click it to move it before the merge or take it off.',
    Card: Route,
  },
  {
    key: 'ring',
    letter: 'B',
    name: 'Ring',
    idea: 'One figure that fills as it goes, as the context ring does; one line beside it.',
    Card: Ring,
  },
  {
    key: 'sentence',
    letter: 'C',
    name: 'Sentence',
    idea: 'Where it stands as one sentence of prose; the review is a phrase in it you can change.',
    Card: Sentence,
  },
  {
    key: 'contents',
    letter: 'D',
    name: 'Contents',
    idea: 'A small change is small enough to show whole: its files, then what the review found.',
    Card: Contents,
  },
]
