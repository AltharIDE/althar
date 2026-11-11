import {
  AskAnswered,
  AskCard,
  AskFoot,
  AskNote,
  Button,
  changeSetText,
  ChecksLine,
  CheckState,
  Delta,
  Icon,
  LinkButton,
  LiveDot,
  Menu,
  MenuItem,
  IconButton,
  Model,
  Spinner,
  StepTrack,
  TaskStatus,
  TrackStep,
  type TrackItem,
} from '@althar/ui'
import type { ReactNode } from 'react'

import { beforeMerge, merged, type SmallState, SOL, SONNET } from './states'
import d from './directions.module.css'

/*
 * Four ways to draw a small change's card. Each takes one state and draws it
 * whole; the page puts every state of a direction side by side, and one of
 * them in a thread between the cards it sits among.
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

const files = (n: number) => (n === 1 ? '1 file' : `${n} files`)
const passed = (s: SmallState) => (s.checks ?? []).filter((c) => c.state === CheckState.Passed).length
const failedNames = (s: SmallState) => (s.checks ?? []).filter((c) => c.state === CheckState.Failed).map((c) => c.name)
const noop = () => {}
/** Waits on the person: violet, as every ask is. */
const waits = (s: SmallState) => s.key === 'ready' || s.key === 'findings'

function Title({ children }: { children: ReactNode }) {
  return <p className={d.title}>{children}</p>
}

function Findings() {
  return (
    <>
      <Button size="small" variant="signal" onClick={noop}>
        Fix it
      </Button>
      <Button size="small" variant="quiet" onClick={noop}>
        Leave it
      </Button>
    </>
  )
}

function MergeButton() {
  return (
    <Button size="small" variant="signal" onClick={noop}>
      Merge
    </Button>
  )
}

/* ——— A · One line ——— */

/** Where it stands, as one line: what it is doing, or the checks' own line, which opens to the list. */
function standing(s: SmallState): ReactNode {
  switch (s.key) {
    case 'started':
      return (
        <p className={d.line}>
          <LiveDot ping />
          <span>Reading the code</span>
          <span className={d.at}>17:22</span>
        </p>
      )
    case 'changing':
      return (
        <p className={d.line}>
          <LiveDot ping />
          <span>Changing {files(s.files ?? 0)}</span>
          <Delta add={s.add} del={s.del} />
        </p>
      )
    case 'checks':
    case 'failed':
    case 'ready':
      return <ChecksLine checks={s.checks ?? []} t={changeSetText} />
    case 'merging':
      return (
        <p className={d.line}>
          <Spinner size="small" />
          <span>Merging</span>
        </p>
      )
    case 'queued':
      return (
        <p className={d.line}>
          <LiveDot ping />
          <span>In the merge queue, 2 ahead</span>
        </p>
      )
    case 'reviewing':
      return (
        <p className={d.line}>
          <LiveDot ping />
          <span>
            Merged {s.merged}. <Model model={SOL} short /> is reviewing it
          </span>
        </p>
      )
    case 'clean':
      return (
        <p className={`${d.line} ${d.good}`}>
          <Icon name="check" size={12} />
          <span>Merged {s.merged}, reviewed after: nothing found</span>
        </p>
      )
    case 'findings':
      return (
        <p className={`${d.line} ${d.bad}`}>
          <Icon name="close" size={12} />
          <span>
            Merged {s.merged}. Review found {s.findings}
          </span>
        </p>
      )
    default:
      return null
  }
}

function OneLine({ state: s }: CardProps) {
  if (s.key === 'full')
    return (
      <AskAnswered said="Full task">
        <AskNote>reviewed before it merges</AskNote>
      </AskAnswered>
    )
  return (
    <AskCard
      icon="branch"
      kicker="Small change"
      quiet={!waits(s)}
      title={`Led by ${SONNET.name}, reviewed by ${SOL.name} after it merges`}
      who={beforeMerge(s) ? <LinkButton onClick={noop}>Review first</LinkButton> : <span className={d.pr}>PR #{s.pr}</span>}
    >
      <Title>{s.title}</Title>
      <div className={d.row}>
        <div className={d.grow}>{standing(s)}</div>
        {s.key === 'ready' && <MergeButton />}
      </div>
      {s.key === 'findings' && (
        <AskFoot>
          <Findings />
        </AskFoot>
      )}
    </AskCard>
  )
}

/* ——— B · Track ——— */

const STOPS = ['Change', 'Checks', 'Merge', 'Review'] as const
const FULL_STOPS = ['Change', 'Checks', 'Review', 'Merge'] as const
const AT: Record<SmallState['key'], number> = {
  started: 0,
  changing: 0,
  checks: 1,
  failed: 1,
  ready: 2,
  merging: 2,
  queued: 2,
  reviewing: 3,
  clean: 4,
  findings: 3,
  full: 1,
}

function trackOf(s: SmallState): TrackItem[] {
  const names = s.key === 'full' ? FULL_STOPS : STOPS
  const at = AT[s.key]
  return names.map((label, i) => ({ label, state: i < at ? TrackStep.Done : i === at ? TrackStep.Now : TrackStep.Next }))
}

/** The one step it is on, in a line, with its time. */
function trackLine(s: SmallState): [ReactNode, string, string?] {
  switch (s.key) {
    case 'started':
      return ['Reading the code', '17:22']
    case 'changing':
      return [
        <>
          {files(s.files ?? 0)} so far <Delta add={s.add} del={s.del} />
        </>,
        '',
      ]
    case 'checks':
      return [`${passed(s)} of ${s.checks?.length ?? 0} passed`, '']
    case 'failed':
      return [`${failedNames(s).join(', ')} failed. ${SONNET.short} is fixing it`, '', d.bad]
    case 'ready':
      return [`${s.checks?.length ?? 0} checks passed`, s.checked ?? '']
    case 'merging':
      return ['Merging', '']
    case 'queued':
      return ['In the merge queue, 2 ahead', '']
    case 'reviewing':
      return [
        <>
          <Model model={SOL} short /> is reading what merged
        </>,
        '',
      ]
    case 'clean':
      return ['Nothing found', s.reviewed ?? '', d.good]
    case 'findings':
      return [`Found ${s.findings} after it merged`, s.reviewed ?? '', d.bad]
    case 'full':
      return [`${passed(s)} of ${s.checks?.length ?? 0} passed, then ${SOL.short} reviews it`, '']
  }
}

function Track({ state: s }: CardProps) {
  const status = waits(s) ? TaskStatus.Yours : s.key === 'clean' ? TaskStatus.Done : TaskStatus.Running
  const [what, at, tone] = trackLine(s)
  return (
    <AskCard icon="branch" kicker={s.key === 'full' ? 'Change' : 'Small change'} quiet={!waits(s)} who={<Model model={SONNET} short />}>
      <Title>{s.title}</Title>
      <StepTrack steps={trackOf(s)} status={status} labels className={d.track} />
      <p className={`${d.line} ${d.detail} ${tone ?? ''}`}>
        <span className={d.grow}>{what}</span>
        {at !== '' && <span className={d.at}>{at}</span>}
      </p>
      {(s.key === 'findings' || beforeMerge(s)) && (
        <AskFoot>
          {s.key === 'ready' && <MergeButton />}
          {s.key === 'findings' && <Findings />}
          {beforeMerge(s) && (
            <LinkButton className={d.aside} onClick={noop}>
              Review before it merges
            </LinkButton>
          )}
        </AskFoot>
      )}
    </AskCard>
  )
}

/* ——— C · The Change card, small ——— */

function reviewLine(s: SmallState): ReactNode {
  const by = <Model model={SOL} short />
  if (s.key === 'reviewing')
    return (
      <p className={`${d.line} ${d.running}`}>
        <LiveDot ping />
        <span>Being reviewed by {by}</span>
      </p>
    )
  if (s.key === 'clean')
    return (
      <p className={`${d.line} ${d.good}`}>
        <Icon name="check" size={12} />
        <span>Reviewed by {by}, nothing found</span>
        <span className={d.at}>{s.reviewed}</span>
      </p>
    )
  if (s.key === 'findings')
    return (
      <p className={`${d.line} ${d.bad}`}>
        <Icon name="close" size={12} />
        <span>
          {s.findings} findings from {by}
        </span>
        <span className={d.at}>{s.reviewed}</span>
      </p>
    )
  if (s.key === 'full')
    return (
      <p className={`${d.line} ${d.quietLine}`}>
        <span className={d.hollow} />
        <span>Reviewed by {by} before it merges</span>
      </p>
    )
  return (
    <p className={`${d.line} ${d.quietLine}`}>
      <span className={d.hollow} />
      <span>Reviewed by {by} after it merges</span>
    </p>
  )
}

function ChangeLike({ state: s }: CardProps) {
  const head =
    s.key === 'merging' ? (
      <span className={d.pr}>
        <Spinner size="small" /> Merging
      </span>
    ) : s.key === 'queued' ? (
      <span className={d.pr}>In the merge queue · PR #{s.pr}</span>
    ) : merged(s) ? (
      <span className={d.pr}>
        Merged {s.merged} · PR #{s.pr}
      </span>
    ) : s.files === undefined ? null : (
      <span className={d.pr}>PR #{s.pr}</span>
    )
  return (
    <AskCard icon="branch" kicker={s.key === 'full' ? 'Change' : 'Small change'} quiet={!waits(s)} who={head}>
      <Title>{s.title}</Title>
      <div className={d.lines}>
        {s.key === 'started' ? (
          <p className={d.line}>
            <LiveDot ping />
            <span>
              <Model model={SONNET} short /> started
            </span>
            <span className={d.at}>{s.started}</span>
          </p>
        ) : (
          <p className={d.line}>
            {s.key === 'changing' ? <LiveDot ping /> : <Icon name="edit" size={12} />}
            <span>
              <Model model={SONNET} short /> {s.key === 'changing' ? 'is changing' : 'changed'} {files(s.files ?? 0)}
            </span>
            <Delta add={s.add} del={s.del} />
          </p>
        )}
        {s.checks !== undefined && !merged(s) && <ChecksLine checks={s.checks} t={changeSetText} />}
        {reviewLine(s)}
      </div>
      {(s.key === 'findings' || (beforeMerge(s) && s.key !== 'started')) && (
        <AskFoot>
          {s.key === 'ready' && <MergeButton />}
          {beforeMerge(s) && (
            <Button size="small" variant="quiet" onClick={noop}>
              Review first
            </Button>
          )}
          {s.key === 'findings' && <Findings />}
        </AskFoot>
      )}
    </AskCard>
  )
}

/* ——— D · Minutes ——— */

const STANDING: Record<SmallState['key'], string> = {
  started: 'Started',
  changing: 'Changing',
  checks: 'Checks running',
  failed: 'Checks failed',
  ready: 'Ready to merge',
  merging: 'Merging',
  queued: 'In the merge queue',
  reviewing: 'Merged',
  clean: 'Merged',
  findings: 'Merged',
  full: 'Full task',
}

function Minutes({ state: s }: CardProps) {
  const times = [
    `started ${s.started}`,
    s.changed && `${files(s.files ?? 0)} ${s.changed}`,
    s.checked && `checks ${s.checked}`,
    s.merged && `merged ${s.merged}`,
  ].filter(Boolean)
  const live = !merged(s) && s.key !== 'ready' && s.key !== 'failed'
  const tone = s.key === 'failed' ? d.bad : merged(s) ? d.good : ''
  const menu = beforeMerge(s) && (
    <Menu label="More" trigger={<IconButton icon="more" label="More" size="small" />} align="end">
      <MenuItem description={`${SOL.short} reviews it before it merges`} onSelect={noop}>
        Make it a full task
      </MenuItem>
    </Menu>
  )
  return (
    <AskCard icon="branch" kicker={s.key === 'full' ? 'Change' : 'Small change'} quiet={!waits(s)} who={menu || undefined}>
      <Title>{s.title}</Title>
      <div className={d.big}>
        <span className={d.figure}>{s.minutes === 0 ? 'now' : `${s.minutes} min`}</span>
        <span className={`${d.state} ${tone}`}>
          {live && <LiveDot ping />}
          {s.key === 'failed' && <Icon name="close" size={12} />}
          {merged(s) && <Icon name="check" size={12} />}
          {STANDING[s.key]}
          {s.key === 'failed' && <span className={d.aside}>{failedNames(s).join(', ')}</span>}
          {s.key === 'checks' && (
            <span className={d.aside}>
              {passed(s)} of {s.checks?.length}
            </span>
          )}
        </span>
        {s.key === 'ready' && <MergeButton />}
      </div>
      <p className={d.times}>{times.join(' · ')}</p>
      {(merged(s) || s.key === 'full') && (
        <div className={d.after}>
          <span className={d.key}>{s.key === 'full' ? 'Review, before it merges' : 'Review, after it merged'}</span>
          <p className={`${d.line} ${s.key === 'findings' ? d.badMark : s.key === 'clean' ? d.good : ''}`}>
            {(s.key === 'reviewing' || s.key === 'full') && <span className={d.hollow} />}
            {s.key === 'clean' && <Icon name="check" size={12} />}
            {s.key === 'findings' && <Icon name="close" size={12} />}
            <span className={d.grow}>
              <Model model={SOL} short />{' '}
              {s.key === 'reviewing'
                ? 'is reading it'
                : s.key === 'clean'
                  ? 'found nothing'
                  : s.key === 'findings'
                    ? `found ${s.findings}`
                    : 'once checks pass'}
            </span>
            {s.reviewed && <span className={d.at}>{s.reviewed}</span>}
          </p>
          {s.key === 'findings' && (
            <div className={d.acts}>
              <Button size="small" variant="signal" onClick={noop}>
                Fix it
              </Button>
              <Button size="small" variant="quiet" onClick={noop}>
                Leave it
              </Button>
            </div>
          )}
        </div>
      )}
    </AskCard>
  )
}

export const DIRECTIONS: readonly Direction[] = [
  {
    key: 'a',
    letter: 'A',
    name: 'One line',
    idea: 'No checklist, no meta line: where it stands now, in one line, with Merge at its end. Review first in the head.',
    Card: OneLine,
  },
  {
    key: 'b',
    letter: 'B',
    name: 'Track',
    idea: 'The kit’s step bars, with Review drawn after Merge: the track says what the meta line said. One line for the step it is on.',
    Card: Track,
  },
  {
    key: 'c',
    letter: 'C',
    name: 'Change card, small',
    idea: 'The Change card’s own lines: what it changed, its checks, its review. The review line is there from the start, empty until it runs.',
    Card: ChangeLike,
  },
  {
    key: 'd',
    letter: 'D',
    name: 'Minutes',
    idea: 'Small changes must be fast, so the time is the figure, as the context ring’s share is. The review after merge is a section of its own.',
    Card: Minutes,
  },
]
