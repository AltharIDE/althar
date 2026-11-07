// Scrappy, surface 2: a task a lead started, as the board and its parent's thread show it; the coordinator as a speaker in a task's thread; and what a lead does from a turn the person didn't start, as a card.
import { useState } from 'react'

import { Card } from '../../../../../../apps/desktop/src/renderer/features/project/Card'
import { agents } from '../../../../../../apps/desktop/tests/fixtures'
import { Icon } from '../../../../src/foundations/Icon/Icon'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../../../src/primitives/Ask/Ask'
import { Button } from '../../../../src/primitives/Button/Button'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { AltharLine } from '../../../../src/thread/AltharLine/AltharLine'
import { Prose, Turn } from '../../../../src/thread/Turn/Turn'
import { Tool } from '../../../../src/thread/Tool/Tool'
import { ToolKind, ToolState } from '../../../../src/foundations/vocabulary'
import { TASKS } from '../../data'
import { proto, useProto } from '../../state'
import s from './lineage.module.css'

export const lineageText = {
  from: (parent: string) => `From ${parent}`,
  started: (n: number) => (n === 1 ? 'Started 1 task' : `Started ${n} tasks`),
  held: 'Held',
  coordinator: 'Coordinator',
  unasked: {
    kicker: 'From a turn you didn’t start',
    what: (title: string) => (
      <>
        Start <strong>{title}</strong>?
      </>
    ),
    why: 'dana’s comment on #638 woke the lead.',
    notNow: 'Not now',
    start: 'Start it',
    started: 'Started.',
    declined: 'Not now.',
  },
}

/** At the foot of a card: the task whose lead started it, which opens it. */
export function Lineage({ parent, onOpen }: { parent: string; onOpen: () => void }) {
  return (
    <button type="button" className={s.lineage} onClick={onOpen} title={parent}>
      <Icon name="branch" size={11} />
      <span className={s.parent}>{lineageText.from(parent)}</span>
    </button>
  )
}

const noop = () => undefined

/** The child's card in its parent's thread, as the coordinator's thread shows a task it planned: under way at once (A), or counting down with Hold (B). */
export function ChildCard({ countdown }: { countdown: boolean }) {
  const p = useProto()
  const base = TASKS.child()
  const content = countdown
    ? {
        ...base,
        phase: p.childHeld ? ('held' as const) : ('planned' as const),
        step: null,
        startedAt: null,
        plan: { ...base.plan!, startsAt: p.childHeld ? null : countdownEnds },
      }
    : base
  return (
    <div className={s.card}>
      <Card
        card={content}
        actions={{
          project: 'althar',
          projectId: 'p1',
          agents,
          agentName: (id) => agents.find((one) => one.id === id)?.name ?? id ?? '',
          onStart: () => proto.set({ childHeld: false }),
          onHold: () => proto.set({ childHeld: true }),
          onChange: noop,
          onCreateBranch: noop,
          onOpen: (threadId) => window.location.assign(`#/threads/${threadId}`),
          onStopBackground: noop,
        }}
      />
    </div>
  )
}

/** When the child's countdown ends: two minutes after the page opened, so it can be held. */
const countdownEnds = new Date(Date.now() + 120_000).toISOString()

/** The coordinator acting in a task's thread: one line per act (A), or a turn of its own, its acts as rows (B). */
export function CoordinatorActs({ speaker }: { speaker: boolean }) {
  if (!speaker)
    return (
      <div className={s.lines}>
        <AltharLine text={{ name: lineageText.coordinator }}>Pushed 4 commits, on your word.</AltharLine>
        <AltharLine text={{ name: lineageText.coordinator }}>Asked the lead to leave ADR-081’s merge rules as they are.</AltharLine>
      </div>
    )
  return (
    <Turn voice={lineageText.coordinator} at="6m ago" className={s.turn}>
      <Prose>
        You asked to read it on GitHub, so I pushed what’s here. You also said merging stays as ADR-081 has it; I’ve told the lead.
      </Prose>
      <div className={s.acts}>
        <Tool kind={ToolKind.Push} verb="Pushed" target="4 commits to #638" state={ToolState.Done} meta="on your word" />
        <Tool kind={ToolKind.Comment} verb="Asked the lead" target="to leave ADR-081’s merge rules as they are" state={ToolState.Done} />
      </div>
    </Turn>
  )
}

/** What a lead would do from a turn the person didn't start: a card, done only on their word. */
export function UnaskedStart({ title }: { title: string }) {
  const [said, setSaid] = useState<'started' | 'declined' | null>(null)
  const t = lineageText.unasked
  if (said !== null)
    return (
      <AskAnswered
        denied={said === 'declined'}
        said={said === 'started' ? t.started : t.declined}
        onUndo={() => setSaid(null)}
        className={s.answered}
      >
        <AskNote>{title}</AskNote>
      </AskAnswered>
    )
  return (
    <AskCard icon="plus" kicker={t.kicker} what={t.what(title)} className={s.ask}>
      <p className={s.why}>{t.why}</p>
      <AskFoot>
        <Button variant="quiet" onClick={() => setSaid('declined')}>
          {t.notNow}
        </Button>
        <Button variant="signal" onClick={() => setSaid('started')}>
          {t.start}
        </Button>
      </AskFoot>
    </AskCard>
  )
}

export { LinkButton }
