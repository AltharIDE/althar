import { type ComponentProps, type ReactNode, useState } from 'react'

import {
  BoardCard,
  Fact,
  Heading,
  Icon,
  IconButton,
  LiveDot,
  NextStep,
  NextSteps,
  Segmented,
  StepTrack,
  TaskKind,
  TaskStatus,
  trackOf,
} from '@althar/ui'

import { BoardView as TodaysBoard } from '../../src/renderer/features/board/BoardView'
import { TASKS } from './data'
import {
  type Feature,
  FEATURES,
  featureOf,
  type Handoff,
  handoffsOf,
  HANDOFFS,
  OWNER,
  PANELS,
  type PanelDef,
  STAGES,
  type Tone,
} from './features'
import { panelsOf } from './Switcher'
import { lab, type Role, ROLES, roleName, useLab } from './state'
import s from './lens.module.css'

/*
 * The board's pane, as each direction draws it for the lens on (the seam in
 * vite.config.ts puts it in the project's screen in place of the board):
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

type BoardProps = ComponentProps<typeof TodaysBoard>

export function BoardView(props: BoardProps) {
  const { d, role, feature } = useLab()
  const open = featureOf(feature)
  if (open !== null)
    return (
      <div className={s.pane}>
        <Timeline feature={open} role={role} />
      </div>
    )
  if (d === 'a') return role === 'engineering' ? <TodaysBoard {...props} /> : <Grouped role={role} />
  if (d === 'b')
    return (
      <div className={s.split}>
        <div className={s.boardPart}>
          <TodaysBoard {...props} />
        </div>
        <PanelColumn role={role} />
      </div>
    )
  return <FeatureHome role={role} board={<TodaysBoard {...props} />} />
}

const openFeature = (slug: string) => lab.set({ feature: slug })

/* ---- Cards ---------------------------------------------------------------- */

const FEATURE_OF_TASK: Record<string, string> = {
  'saved-carts-api': 'saved-carts',
  'saved-carts-rollout': 'saved-carts',
  'apple-pay-sheet': 'apple-pay',
  'guest-checkout-directions': 'guest-checkout',
  'gift-cards-spec': 'gift-cards',
  'refund-webhook-5xx': 'refund-webhooks',
}

function TaskCard({ slug }: { slug: string }) {
  const task = TASKS.find((one) => one.slug === slug)
  if (task === undefined) return null
  const feature = featureOf(FEATURE_OF_TASK[slug] ?? null)
  const status = task.phase === 'running' ? TaskStatus.Running : task.phase === 'ready' ? TaskStatus.Yours : TaskStatus.Queued
  const word =
    task.phase === 'running'
      ? task.kind === 'plain'
        ? 'Working'
        : 'Implement'
      : task.phase === 'ready'
        ? 'Ready to accept'
        : 'Starts in 10m'
  return (
    <BoardCard
      status={status}
      word={word}
      kind={task.kind === 'plain' ? TaskKind.Plain : TaskKind.Change}
      at={`${task.ago}m`}
      title={task.title}
      {...(task.kind === 'plain' ? {} : { track: trackOf(['Implement', 'Review', 'Ship'], task.phase === 'ready' ? 2 : 0) })}
      {...(feature === null ? {} : { foot: <Fact icon="artifact">{feature.name}</Fact> })}
    />
  )
}

/** A handoff waiting on a role, as a card: what came across, and taking it, for the role it waits on. */
function HandoffCard({ handoff, mine }: { handoff: Handoff; mine: boolean }) {
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
      onOpen={() => openFeature(feature.slug)}
      next={
        <NextSteps>
          {mine ? (
            <NextStep signal onPress={() => openFeature(feature.slug)}>
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
  const byFeature = [...FEATURES].sort((a, b) => a.at - b.at)
  return byFeature.slice(0, 4).map((feature) => ({
    name: `${feature.name} · ${STAGES[feature.at]}`,
    cards: [
      ...HANDOFFS.filter((one) => one.feature === feature.slug && one.ago !== '—').map(handoff),
      ...Object.entries(FEATURE_OF_TASK)
        .filter(([, slug]) => slug === feature.slug)
        .map(([task]) => <TaskCard key={task} slug={task} />),
    ],
  }))
}

function Grouped({ role }: { role: Role }) {
  const groups = groupsOf(role)
  return (
    <section className={s.lanes} aria-label="Board">
      {groups.map((group) => (
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
  const { pinned, unpinned } = useLab()
  const keys = panelsOf(role, pinned, unpinned)
  const unpin = (key: string) =>
    lab.get().pinned.includes(key)
      ? lab.set({ pinned: lab.get().pinned.filter((one) => one !== key) })
      : lab.set({ unpinned: [...lab.get().unpinned, key] })
  return (
    <aside className={s.column} aria-label={`Pinned for ${roleName(role)}`}>
      {keys.map((key) => {
        const panel = PANELS[key]
        if (panel === undefined) return null
        return <PinnedPanel key={key} panel={panel} role={role} onUnpin={() => unpin(key)} />
      })}
    </aside>
  )
}

const dot = (tone: Tone = 'quiet') => (tone === 'live' ? <LiveDot /> : <i className={s.dot} data-tone={tone} aria-hidden="true" />)

function PinnedPanel({ panel, role, onUnpin }: { panel: PanelDef; role: Role; onUnpin: () => void }) {
  const handoffs = panel.key === 'handoffs' ? handoffsOf(role) : []
  return (
    <section className={s.panel} aria-label={panel.title}>
      <header className={s.panelHead}>
        <Heading level={3} className={s.panelTitle}>
          {panel.title}
          {panel.key === 'handoffs' && <span className={s.panelCount}>{handoffs.length}</span>}
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
                <button type="button" className={s.row} onClick={() => openFeature(one.feature)}>
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
              <button
                type="button"
                className={s.row}
                {...(row.feature === undefined ? {} : { onClick: () => openFeature(row.feature ?? '') })}
              >
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

function FeatureHome({ role, board }: { role: Role; board: ReactNode }) {
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
        <div className={s.boardPart}>{board}</div>
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
                onChange={(next) => lab.set({ role: next })}
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

const CELL_WORD = { waits: 'Waits on', live: 'At work', alert: 'Alert' } as const

function FeatureGrid({ role }: { role: Role }) {
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
        <button key={feature.slug} type="button" className={s.gridRow} onClick={() => openFeature(feature.slug)}>
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
                    {cell === 'waits' ? `${CELL_WORD.waits} ${roleName(OWNER[stage])}` : CELL_WORD[cell]}
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
  const handoffs = HANDOFFS.filter((one) => one.feature === feature.slug && one.ago !== '—')
  const waiting = handoffs.find((one) => one.question === undefined)
  return (
    <article className={s.timeline} aria-label={feature.name}>
      <button type="button" className={s.back} onClick={() => lab.set({ feature: null })}>
        <Icon name="chevronL" size={12} />
        {lab.get().d === 'c' ? 'Features' : 'Board'}
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
              {record.work !== undefined && record.work}
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
    <section className={s.sheet} data-mine={mine || undefined} aria-label={question ? 'Question' : 'Handoff'}>
      <div className={s.sheetHead}>
        <span className={s.sheetWord} data-mine={mine || undefined}>
          {question
            ? `Question from ${handoff.from} to ${handoff.to}`
            : `${handoff.from} → ${handoff.to} · waits on ${roleName(handoff.role)}`}
        </span>
        <span className={s.source}>{handoff.ago}</span>
      </div>
      {question && <p className={s.question}>{handoff.question}</p>}
      <ul className={s.facts} hidden={question}>
        {handoff.facts.map((fact) => (
          <li key={fact}>
            <Fact icon="check" tone="ok">
              {fact}
            </Fact>
          </li>
        ))}
      </ul>
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
          <NextStep signal onPress={() => undefined}>
            {question ? 'Answer' : `Take ${handoff.to}: start ${handoff.proposed.length} tasks`}
          </NextStep>
        ) : (
          <NextStep>{`Remind ${roleName(handoff.role)}`}</NextStep>
        )}
      </NextSteps>
    </section>
  )
}
