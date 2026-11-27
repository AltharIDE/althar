import { type ReactNode, useState } from 'react'
import { fn } from 'storybook/test'

import {
  Board,
  BoardCard,
  BoardColumn,
  BoardLane,
  BoardList,
  type BoardFolds,
  BranchChip,
  Fact,
  Heading,
  Icon,
  IconButton,
  LiveDot,
  NextRow,
  NextStep,
  NextSteps,
  PullChip,
  Segmented,
  StepTrack,
  TaskKind,
  TaskStatus,
  trackOf,
  Wait,
} from '../../src'
import { GITHUB } from '../../src/fixtures/outputs'
import {
  type Feature,
  FEATURES,
  featureOf,
  type Handoff,
  handoffsOf,
  HANDOFFS,
  OWNER,
  PANELS,
  PINNED,
  type PanelDef,
  STAGES,
  type Tone,
} from './features'
import { type Role, ROLES, roleName, useLens } from './state'
import { TASKS, taskOf } from './tasks'
import s from './lens.module.css'

/*
 * The board's pane, as each direction draws it for the lens on:
 *
 * A · Minimal: today's board for Engineering; the same cards grouped another
 *     way for the others (by environment for DevOps, by feature for Product
 *     and Design). Nothing else changes.
 * B · Panels: today's board for everyone, with a column of pinned panels at
 *     its end, the lens's own first.
 * C · Feature-first: the features' timeline is the home, the lens's inbox of
 *     handoffs over it; the board is a press away.
 *
 * A feature's timeline opens in the pane's place, in every direction.
 */

export function LensPane() {
  const { d, role, feature } = useLens()
  const open = featureOf(feature)
  if (open !== null)
    return (
      <div className={s.pane}>
        <Timeline feature={open} role={role} />
      </div>
    )
  if (d === 'a') return role === 'engineering' ? <TodaysBoard /> : <Grouped role={role} />
  if (d === 'b')
    return (
      <div className={s.split}>
        <div className={s.boardPart}>
          <TodaysBoard folded />
        </div>
        <PanelColumn role={role} />
      </div>
    )
  return <FeatureHome role={role} />
}

/** The panels shown for a lens in direction B: its own, less those taken off, then those pinned from other lenses. */
export const panelsOf = (role: Role, pinned: ReadonlyArray<string>, unpinned: ReadonlyArray<string>) => [
  ...PINNED[role].filter((key) => !unpinned.includes(key)),
  ...pinned.filter((key) => !PINNED[role].includes(key)),
]

const useOpen = () => {
  const { set } = useLens()
  return (slug: string | null) => set({ feature: slug, menu: false })
}

/* ---- Today's board, as the desktop draws it ------------------------------ */

const SETTLED_FOLDED: BoardFolds = { collapsed: [BoardLane.Settled], opened: [] }

function TodaysBoard({ folded = false }: { folded?: boolean }) {
  const running = TASKS.filter((one) => one.phase === 'running')
  const ready = TASKS.filter((one) => one.phase === 'ready')
  const next = TASKS.filter((one) => one.phase === 'planned')
  return (
    <Board label="storefront’s work" defaultFolds={folded ? SETTLED_FOLDED : { collapsed: [], opened: [] }}>
      <BoardColumn lane={BoardLane.Next} count={next.length}>
        <BoardList>
          {next.map((row, i) => (
            <NextRow
              key={row.slug}
              place={i + 1}
              task=""
              text={{ task: () => '' }}
              title={row.title}
              wait={Wait.Workers}
              reason="Starts in 10 min"
              onOpen={fn()}
            />
          ))}
        </BoardList>
      </BoardColumn>
      <BoardColumn lane={BoardLane.Running} count={running.length}>
        {running.map((one) => (
          <TaskCard key={one.slug} slug={one.slug} today />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={ready.length}>
        {ready.map((one) => (
          <TaskCard key={one.slug} slug={one.slug} today />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Settled} count={63} />
    </Board>
  )
}

/* ---- Cards ---------------------------------------------------------------- */

function TaskCard({ slug, today = false }: { slug: string; today?: boolean }) {
  const task = taskOf(slug)
  if (task === undefined) return null
  const feature = featureOf(task.feature ?? null)
  const status = task.phase === 'running' ? TaskStatus.Running : task.phase === 'ready' ? TaskStatus.Yours : TaskStatus.Queued
  const word =
    task.phase === 'running'
      ? task.plain === true
        ? 'Working'
        : 'Implement'
      : task.phase === 'ready'
        ? task.plain === true
          ? 'Finished'
          : 'Ready to accept'
        : 'Starts in 10m'
  const object =
    task.pr !== undefined ? (
      <PullChip host={GITHUB} repo="storefront" number={task.pr} add={212} del={31} />
    ) : task.branch !== undefined && today ? (
      <BranchChip name={task.branch} />
    ) : undefined
  return (
    <BoardCard
      status={status}
      word={word}
      kind={task.plain === true ? TaskKind.Plain : TaskKind.Change}
      at={`${task.ago}m`}
      title={task.title}
      {...(object === undefined ? {} : { object })}
      {...(task.plain === true || today ? {} : { track: trackOf(['Implement', 'Review', 'Ship'], task.phase === 'ready' ? 2 : 0) })}
      {...(feature === null || today ? {} : { foot: <Fact icon="artifact">{feature.name}</Fact> })}
      {...(task.phase === 'ready' && task.pr !== undefined
        ? {
            next: (
              <NextSteps>
                <NextStep signal onPress={fn()}>
                  Accept and merge
                </NextStep>
              </NextSteps>
            ),
          }
        : {})}
      onOpen={fn()}
    />
  )
}

/** A handoff waiting on a role, as a card: what came across, and taking it, for the role it waits on. */
function HandoffCard({ handoff, mine }: { handoff: Handoff; mine: boolean }) {
  const open = useOpen()
  const feature = featureOf(handoff.feature)
  if (feature === null) return null
  const question = handoff.question !== undefined
  return (
    <BoardCard
      status={mine ? TaskStatus.Yours : TaskStatus.Done}
      word={question ? `Question from ${handoff.from}` : `${handoff.from} → ${handoff.to}`}
      at={handoff.ago}
      title={question ? (handoff.question ?? '') : feature.name}
      why={question ? feature.name : handoff.facts.join(' · ')}
      {...(question ? {} : { foot: <Fact icon="plus">{`${handoff.proposed.length} tasks proposed`}</Fact> })}
      onOpen={() => open(feature.slug)}
      next={
        <NextSteps>
          {mine ? (
            <NextStep signal onPress={() => open(feature.slug)}>
              {question ? 'Answer' : `Take ${handoff.to}`}
            </NextStep>
          ) : (
            <NextStep>{`Waits on ${roleName(handoff.role)}`}</NextStep>
          )}
        </NextSteps>
      }
    />
  )
}

/* ---- A · Minimal: the same cards, grouped by the lens ---------------------- */

interface Group {
  readonly name: string
  readonly cards: ReadonlyArray<ReactNode>
}

const groupsOf = (role: Role): ReadonlyArray<Group> => {
  const handoff = (one: Handoff, i: number) => <HandoffCard key={`h${i}`} handoff={one} mine={one.role === role} />
  if (role === 'devops')
    return [
      { name: 'To ship', cards: handoffsOf('devops').map(handoff) },
      { name: 'Production', cards: [<TaskCard key="r" slug="refund-webhook-5xx" />] },
      { name: 'Staging', cards: [<TaskCard key="s" slug="saved-carts-rollout" />] },
      {
        name: 'Not deployed yet',
        cards: ['saved-carts-api', 'apple-pay-sheet', 'checkout-e2e-flake', 'guest-checkout-directions', 'gift-cards-spec'].map((slug) => (
          <TaskCard key={slug} slug={slug} />
        )),
      },
    ]
  // Product and Design: by feature, earliest stage first.
  return [...FEATURES]
    .sort((a, b) => a.at - b.at)
    .slice(0, 4)
    .map((feature) => ({
      name: `${feature.name} · ${STAGES[feature.at]}`,
      cards: [
        ...HANDOFFS.filter((one) => one.feature === feature.slug && one.ago !== '—').map(handoff),
        ...TASKS.filter((one) => one.feature === feature.slug).map((one) => <TaskCard key={one.slug} slug={one.slug} />),
      ],
    }))
}

function Grouped({ role }: { role: Role }) {
  return (
    <section className={s.lanes} aria-label="Board">
      {groupsOf(role).map((group) => (
        <div key={group.name} className={s.lane}>
          <div className={s.laneHead}>
            <Heading level={2} className={s.laneTitle}>
              {group.name}
            </Heading>
            <span className={s.count}>{group.cards.length}</span>
          </div>
          <div className={s.cards}>{group.cards}</div>
        </div>
      ))}
    </section>
  )
}

/* ---- B · Panels ----------------------------------------------------------- */

function PanelColumn({ role }: { role: Role }) {
  const { pinned, unpinned, set } = useLens()
  const unpin = (key: string) =>
    pinned.includes(key) ? set({ pinned: pinned.filter((one) => one !== key) }) : set({ unpinned: [...unpinned, key] })
  return (
    <aside className={s.column} aria-label={`Pinned for ${roleName(role)}`}>
      {panelsOf(role, pinned, unpinned).map((key) => {
        const panel = PANELS[key]
        return panel === undefined ? null : <PinnedPanel key={key} panel={panel} role={role} onUnpin={() => unpin(key)} />
      })}
    </aside>
  )
}

const dot = (tone: Tone = 'quiet') => (tone === 'live' ? <LiveDot /> : <i className={s.dot} data-tone={tone} aria-hidden="true" />)

function PinnedPanel({ panel, role, onUnpin }: { panel: PanelDef; role: Role; onUnpin: () => void }) {
  const open = useOpen()
  const handoffs = panel.key === 'handoffs' ? handoffsOf(role) : []
  return (
    <section className={s.panel} aria-label={panel.title}>
      <header className={s.panelHead}>
        <Heading level={3} className={s.panelTitle}>
          {panel.title}
          {handoffs.length > 0 && <span className={s.panelCount}>{handoffs.length}</span>}
        </Heading>
        <span className={s.source}>{panel.source}</span>
        <IconButton icon="pin" label="Unpin" size="small" className={s.unpin} onClick={onUnpin} />
      </header>
      {panel.key === 'handoffs' ? (
        handoffs.length === 0 ? (
          <p className={s.quiet}>Nothing waits on {roleName(role)}.</p>
        ) : (
          <ul className={s.rows}>
            {handoffs.map((one, i) => (
              <li key={i}>
                <button type="button" className={s.row} onClick={() => open(one.feature)}>
                  <i className={s.dot} data-tone="signal" aria-hidden="true" />
                  <span className={s.rowName}>{one.question ?? featureOf(one.feature)?.name}</span>
                  <span className={s.rowValue}>{one.question === undefined ? `${one.from} → ${one.to}` : one.from}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className={s.rows}>
          {panel.rows.map((row) => (
            <li key={row.name}>
              <button type="button" className={s.row} {...(row.feature === undefined ? {} : { onClick: () => open(row.feature ?? null) })}>
                {dot(row.tone)}
                <span className={s.rowName}>{row.name}</span>
                <span className={s.rowValue} data-tone={row.tone}>
                  {row.value}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---- C · Feature-first ---------------------------------------------------- */

function FeatureHome({ role }: { role: Role }) {
  const { set } = useLens()
  const [view, setView] = useState<'features' | 'board'>('features')
  const inbox = handoffsOf(role)
  return (
    <div className={s.home}>
      <div className={s.homeBar}>
        <Segmented
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'features', label: 'Features' },
            { value: 'board', label: 'Tasks' },
          ]}
        />
      </div>
      {view === 'board' ? (
        <div className={s.boardPart}>
          <TodaysBoard />
        </div>
      ) : (
        <div className={s.homeBody}>
          <section className={s.inbox} aria-label="Handoffs">
            <div className={s.inboxHead}>
              <Heading level={2} className={s.laneTitle}>
                Waiting on
              </Heading>
              <Segmented
                label="Whose handoffs"
                value={role}
                onChange={(next) => set({ role: next })}
                options={ROLES.map((one) => ({
                  value: one.key,
                  label: one.label,
                  ...(handoffsOf(one.key).length > 0 ? { dot: 'yours' as const, dotLabel: 'Handoffs wait' } : {}),
                }))}
              />
            </div>
            {inbox.length === 0 ? (
              <div className={s.empty}>
                <Icon name="check" size={14} />
                <span>
                  Nothing waits on {roleName(role)}. <b>Gift cards</b> comes to you once its spec is approved.
                </span>
              </div>
            ) : (
              <div className={s.inboxCards}>
                {inbox.map((one, i) => (
                  <HandoffCard key={i} handoff={one} mine />
                ))}
              </div>
            )}
          </section>
          <FeatureGrid role={role} />
        </div>
      )}
    </div>
  )
}

/** Where a feature stands in a stage: done, the one it is on (and how), or to come. */
const cellOf = (feature: Feature, i: number): 'done' | 'waits' | 'live' | 'alert' | 'next' => {
  if (i < feature.at) return 'done'
  if (i > feature.at) return 'next'
  if (feature.alert !== undefined) return 'alert'
  return HANDOFFS.some((one) => one.feature === feature.slug && one.to === STAGES[i] && one.ago !== '—' && one.question === undefined)
    ? 'waits'
    : 'live'
}

const CELL_WORD = { live: 'At work', alert: 'Alert' } as const

function FeatureGrid({ role }: { role: Role }) {
  const open = useOpen()
  return (
    <section className={s.grid} aria-label="Features">
      <div className={s.gridRow} data-head>
        <span className={s.gridName}>Feature</span>
        {STAGES.map((stage) => (
          <span key={stage} className={s.stageHead} data-own={OWNER[stage] === role || undefined}>
            {stage}
            <small>{roleName(OWNER[stage])}</small>
          </span>
        ))}
      </div>
      {FEATURES.map((feature) => (
        <button key={feature.slug} type="button" className={s.gridRow} onClick={() => open(feature.slug)}>
          <span className={s.gridName}>
            {feature.name}
            <small>{feature.tracker}</small>
          </span>
          {STAGES.map((stage, i) => {
            const cell = cellOf(feature, i)
            return (
              <span key={stage} className={s.cell} data-own={OWNER[stage] === role || undefined}>
                <i className={s.bar} data-cell={cell} />
                {cell !== 'done' && cell !== 'next' && (
                  <span className={s.cellWord} data-cell={cell}>
                    {cell === 'waits' ? `Waits on ${roleName(OWNER[stage])}` : CELL_WORD[cell]}
                  </span>
                )}
              </span>
            )
          })}
        </button>
      ))}
    </section>
  )
}

/* ---- A feature's timeline, in every direction ----------------------------- */

function Timeline({ feature, role }: { feature: Feature; role: Role }) {
  const { d } = useLens()
  const open = useOpen()
  const handoffs = HANDOFFS.filter((one) => one.feature === feature.slug && one.ago !== '—')
  const waiting = handoffs.find((one) => one.question === undefined)
  return (
    <article className={s.timeline} aria-label={feature.name}>
      <button type="button" className={s.back} onClick={() => open(null)}>
        <Icon name="chevronL" size={12} />
        {d === 'c' ? 'Features' : 'Board'}
      </button>
      <header className={s.tlHead}>
        <Heading level={2} className={s.tlTitle}>
          {feature.name}
        </Heading>
        <span className={s.mono}>{`specs/${feature.slug}/ · ${feature.tracker}`}</span>
      </header>
      <StepTrack
        className={s.tlTrack}
        labels
        status={waiting !== undefined ? TaskStatus.Yours : TaskStatus.Running}
        steps={trackOf(STAGES, feature.at)}
      />
      {handoffs.length > 0 && (
        <div className={s.tlHandoffs}>
          {handoffs.map((one, i) => (
            <HandoffSheet key={i} handoff={one} mine={one.role === role} />
          ))}
        </div>
      )}
      <ol className={s.stages}>
        {feature.stages.map((record, i) => (
          <li key={record.stage} className={s.stage} data-cell={i < feature.at ? 'done' : i === feature.at ? 'now' : 'next'}>
            <span className={s.stageName}>{record.stage}</span>
            <span className={s.stageOwner}>{roleName(OWNER[record.stage])}</span>
            <span className={s.mono}>{record.artifact ?? ''}</span>
            <span className={s.stageGate}>
              {record.gate !== undefined && (
                <>
                  <Icon name="check" size={11} />
                  {record.gate}
                </>
              )}
              {record.work}
            </span>
          </li>
        ))}
      </ol>
    </article>
  )
}

/** A handoff, open on its feature's timeline: what came across, what the coordinator proposes, and taking it. */
function HandoffSheet({ handoff, mine }: { handoff: Handoff; mine: boolean }) {
  const question = handoff.question !== undefined
  return (
    <section className={s.sheet} aria-label={question ? 'Question' : 'Handoff'}>
      <div className={s.sheetHead}>
        <span className={s.sheetWord} data-mine={mine || undefined}>
          {question
            ? `Question from ${handoff.from} to ${handoff.to}`
            : `${handoff.from} → ${handoff.to} · waits on ${roleName(handoff.role)}`}
        </span>
        <span className={s.source}>{handoff.ago}</span>
      </div>
      {question ? (
        <p className={s.question}>{handoff.question}</p>
      ) : (
        <ul className={s.facts}>
          {handoff.facts.map((fact) => (
            <li key={fact}>
              <Fact icon="check" tone="ok">
                {fact}
              </Fact>
            </li>
          ))}
        </ul>
      )}
      {handoff.proposed.length > 0 && (
        <>
          <span className={s.proposedHead}>The coordinator proposes</span>
          <ul className={s.proposed}>
            {handoff.proposed.map((one) => (
              <li key={one}>
                <Icon name="plus" size={11} />
                {one}
              </li>
            ))}
          </ul>
        </>
      )}
      <NextSteps className={s.sheetSteps}>
        {question ? <NextStep>Open spec.md</NextStep> : <NextStep>Ask {handoff.from} a question</NextStep>}
        {mine ? (
          <NextStep signal onPress={fn()}>
            {question ? 'Answer' : `Take ${handoff.to}: start ${handoff.proposed.length} tasks`}
          </NextStep>
        ) : (
          <NextStep>{`Remind ${roleName(handoff.role)}`}</NextStep>
        )}
      </NextSteps>
    </section>
  )
}
