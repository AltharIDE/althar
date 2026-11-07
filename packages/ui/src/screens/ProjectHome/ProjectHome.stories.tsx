import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import { Board, BoardColumn, BoardList, type BoardFolds } from '../../board/Board/Board'
import { BoardCard, type BoardCardProps } from '../../board/BoardCard/BoardCard'
import { BranchChip, Fact, PullChip } from '../../board/BoardCard/Chips'
import { NextRow } from '../../board/NextRow/NextRow'
import { ProjectHeader, type ProjectPart } from '../../chrome/ProjectHeader/ProjectHeader'
import { ProjectTabs } from '../../chrome/ProjectTabs/ProjectTabs'
import { Composer } from '../../composer/Composer/Composer'
import { ModelPick } from '../../composer/ModelPick/ModelPick'
import { TaskMark } from '../../coordinator/TaskCard/TaskCard'
import { TaskLaunch, type LaunchPick, type LaunchStep } from '../../coordinator/TaskLaunch/TaskLaunch'
import { FROM_231 } from '../../fixtures/coordinator'
import { MARKED } from '../../fixtures/marks'
import { CODEX, OPUS, SONNET, effortFor, useModelPrefs } from '../../fixtures/models'
import { GITHUB } from '../../fixtures/outputs'
import { Brand } from '../../foundations/brands/brands'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { BoardLane, Room, TaskKind, TaskStatus, Wait } from '../../foundations/vocabulary'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { trackOf } from '../../primitives/StepTrack/StepTrack'
import { Thread } from '../../thread/Thread/Thread'
import { TaskFace } from '../../thread/TaskFace/TaskFace'
import { Prose, Turn } from '../../thread/Turn/Turn'
import { WorkedFor } from '../../thread/WorkedFor/WorkedFor'
import { You } from '../../thread/You/You'
import s from './ProjectHome.stories.module.css'

/*
 * A project's home, as the desktop opens it (apps/desktop's ProjectView): its
 * tabs and header, the coordinator's conversation, and the board beside it.
 * Meridian on a Tuesday morning: two tasks the coordinator started earlier,
 * a third the person started from the board, one that needs them, and a new
 * ask answered with a plan on its countdown. Drawn from the kit's own pieces,
 * for the README's main picture (brand/src/screenshots.ts, project-home).
 */

const PARTS: ProjectPart[] = [
  { id: 'api', name: 'meridian-api', brand: Brand.GitHub, openLabel: 'Open on GitHub', onOpen: fn() },
  { id: 'web', name: 'meridian-web', brand: Brand.GitHub, openLabel: 'Open on GitHub', onOpen: fn() },
  { id: 'tracker', name: 'MER issues', brand: Brand.Linear, openLabel: 'Open in Linear', onOpen: fn() },
]

type Card = Omit<BoardCardProps, 'onOpen' | 'current' | 'text'>

const RUNNING: Card[] = [
  {
    status: TaskStatus.Running,
    word: 'Review',
    kind: TaskKind.Change,
    at: '38m',
    title: 'Repair token refresh on privilege change',
    track: trackOf(['Implement', 'Review', 'Security review'], 1),
    object: <BranchChip name="meridian/repair-token-refresh" add={126} del={31} />,
  },
  {
    status: TaskStatus.Running,
    word: 'Implement',
    kind: TaskKind.Change,
    at: '21m',
    title: 'Sign webhook v2 payloads with rotating keys',
    track: trackOf(['Implement', 'Review'], 0),
    object: <BranchChip name="meridian/sign-webhook-v2-payloads" add={212} del={18} />,
  },
  {
    status: TaskStatus.Running,
    word: 'Follow-up',
    kind: TaskKind.Change,
    at: '9m',
    title: 'Return 409 when a refund idempotency key is reused',
    track: trackOf(['Follow-up', 'Review'], 0),
    object: <PullChip host={GITHUB} repo="meridian-api" number={1191} add={48} del={9} />,
    foot: <Fact>6 of 8 checks passed</Fact>,
  },
]

const YOURS: Card = {
  status: TaskStatus.Yours,
  word: 'Question',
  kind: TaskKind.Change,
  at: '4m',
  title: 'Queue refunds that hit the rate limit',
  why: 'Which database should the refund queue live in?',
}

const NEXT = [
  { title: 'Backfill idempotency keys on refunds created before PR 1184', reason: 'Starts in 24s' },
  { title: 'Which partners still call the v1 webhook endpoint?', kind: 'Question', reason: 'Starts when an agent is free' },
  { title: 'Move partner webhooks to the new queue', reason: 'Starts when 429 merges' },
]

const PLAN: LaunchStep[] = [
  { id: 'impl', label: 'Implement', agents: [OPUS], fixed: 'the lead' },
  { id: 'dry', label: 'Dry run on a copy', agents: [CODEX], optional: true },
  { id: 'review', label: 'Review', agents: [CODEX], optional: true },
]

/** A step's agent, in the composer's own picker. */
function usePicker() {
  const prefs = useModelPrefs()
  return ({ agent, owner }: LaunchPick) => (
    <ModelPick
      variant="field"
      placement="below"
      owner={owner}
      model={agent}
      pinned={prefs.pinned}
      effort={effortFor(agent, prefs.efforts)}
      defaultEffort={effortFor(agent, prefs.efforts)}
      onChange={() => {}}
      onEffort={() => {}}
    />
  )
}

/* Up next and Running keep their room beside the conversation; Settled is folded to its rail. */
const FOLDS: BoardFolds = { collapsed: [BoardLane.Settled], opened: [] }

function ProjectHome() {
  const [steps, setSteps] = useState<readonly LaunchStep[]>(PLAN)
  const [draft, setDraft] = useState('')
  const picker = usePicker()
  return (
    <div className={s.window}>
      <ProjectTabs
        lights="drawn"
        tabs={MARKED.map((p) => ({
          id: p.id,
          name: p.name,
          seed: p.id,
          ink: p.ink,
          running: p.running,
          yours: p.id === 'meridian' ? 1 : 0,
        }))}
        current="meridian"
        yours={1}
        onSelect={fn()}
        onClose={fn()}
        end={<IconButton icon="gear" label="Settings" kbd="⌘," size="small" />}
      />
      <ProjectHeader
        name="Meridian"
        seed="meridian"
        ink={ProjectInk.Teal}
        yours={1}
        inProgress={RUNNING.length}
        onYours={fn()}
        room={Room.Both}
        onRoom={fn()}
        parts={PARTS}
      />
      <div className={s.rooms}>
        <div className={s.talk}>
          <TaskFace
            className={s.face}
            composer={
              <Composer value={draft} onChange={setDraft} onSubmit={() => setDraft('')} placeholder="Tell the coordinator something" />
            }
          >
            <Thread label="Conversation">
              <You at="10:12">
                Token refresh keeps admin rights after a downgrade. Fix that, and sign the v2 webhooks with rotating keys.
              </You>
              <Turn voice="Coordinator" at="10:13">
                <WorkedFor took="11s" />
                <Prose>Two tasks, side by side. Token refresh touches sessions, so your security review runs after the code review.</Prose>
              </Turn>
              {/* Each task it started, folded to the line it posted then: who leads it. */}
              <TaskMark
                task="418"
                verb="started"
                detail={`${OPUS.short} leads`}
                at="10:13"
                steps={['Implement', 'Review', 'Security review']}
                step={0}
                now="Review"
                onJump={fn()}
              />
              <TaskMark
                task="429"
                verb="started"
                detail={`${SONNET.short} leads`}
                at="10:30"
                steps={['Implement', 'Review']}
                step={0}
                now="Implement"
                onJump={fn()}
              />
              <TaskMark
                task="416"
                verb="started a follow-up"
                detail={`${CODEX.short} leads`}
                at="10:42"
                steps={['Follow-up', 'Review']}
                step={0}
                now="Follow-up"
                last
                onJump={fn()}
              />
              <You at="10:51">
                Refunds created before PR 1184 have no idempotency key. Backfill them, and dry-run it on a copy before anything writes.
              </You>
              <Turn voice="Coordinator" at="10:51">
                <WorkedFor took="14s" />
                <Prose>
                  One task. Opus 5 writes the backfill, Codex dry-runs it on last night’s snapshot and reviews it, since it writes to money
                  records.
                </Prose>
              </Turn>
              <TaskLaunch
                task="432"
                title="Backfill idempotency keys on refunds created before PR 1184"
                from={FROM_231}
                project="Meridian"
                estimate="About 40 min · about $2 on your subscriptions"
                steps={steps}
                onStepsChange={setSteps}
                picker={picker}
                wait={24}
                onStart={fn()}
              />
            </Thread>
          </TaskFace>
        </div>
        <div className={s.board}>
          <Board label="Meridian’s work" defaultFolds={FOLDS}>
            <BoardColumn lane={BoardLane.Next} count={NEXT.length}>
              <BoardList>
                {NEXT.map((row, i) => (
                  <NextRow
                    key={row.title}
                    place={i + 1}
                    task=""
                    text={{ task: () => '' }}
                    {...(row.kind === undefined ? {} : { kind: row.kind })}
                    title={row.title}
                    wait={i === 2 ? Wait.After : Wait.Workers}
                    reason={row.reason}
                    onOpen={fn()}
                  />
                ))}
              </BoardList>
            </BoardColumn>
            <BoardColumn lane={BoardLane.Running} count={RUNNING.length}>
              {RUNNING.map((card) => (
                <BoardCard key={card.title} {...card} onOpen={fn()} />
              ))}
            </BoardColumn>
            <BoardColumn lane={BoardLane.Yours} count={1}>
              <BoardCard {...YOURS} onOpen={fn()} />
            </BoardColumn>
            <BoardColumn lane={BoardLane.Settled} count={6} />
          </Board>
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Screens/ProjectHome',
  component: ProjectHome,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ProjectHome>
export default meta
type Story = StoryObj<typeof meta>

/** Meridian at work: the coordinator's plan counting down, three tasks running, one question for you, three up next. */
export const Busy: Story = {}
