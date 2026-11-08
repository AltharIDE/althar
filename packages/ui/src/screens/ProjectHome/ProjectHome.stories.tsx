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
 * Meridian on an ordinary morning: two tasks the coordinator started earlier,
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
    title: 'Fix the login redirect loop in Safari',
    track: trackOf(['Implement', 'Review'], 1),
    object: <BranchChip name="meridian/safari-login-loop" add={42} del={11} />,
    foot: <Fact>{OPUS.short} leads</Fact>,
  },
  {
    status: TaskStatus.Running,
    word: 'Implement',
    kind: TaskKind.Change,
    at: '21m',
    title: 'Export invoices as CSV',
    track: trackOf(['Implement', 'Review'], 0),
    object: <BranchChip name="meridian/invoice-csv-export" add={186} del={4} />,
    foot: <Fact>{SONNET.short} leads</Fact>,
  },
  {
    status: TaskStatus.Running,
    word: 'Review',
    kind: TaskKind.Change,
    at: '9m',
    title: 'Paginate the customers endpoint',
    track: trackOf(['Implement', 'Review'], 1),
    object: <PullChip host={GITHUB} repo="meridian-api" number={1191} add={74} del={22} />,
    foot: <Fact>{CODEX.short} leads</Fact>,
  },
]

const YOURS: Card = {
  status: TaskStatus.Yours,
  word: 'Question',
  kind: TaskKind.Change,
  at: '4m',
  title: 'Rate-limit the public API',
  why: 'Per API key, or per account?',
}

const NEXT = [
  { title: 'Fix the VAT rate on EU invoice PDFs', reason: 'Starts in 24s' },
  { title: 'Upgrade the Stripe SDK to v18', reason: 'Starts when an agent is free' },
]

const PLAN: LaunchStep[] = [
  { id: 'impl', label: 'Implement', agents: [OPUS], fixed: 'the lead' },
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
              <You at="10:12">Fix the Safari login loop, and add CSV export to invoices.</You>
              <Turn voice="Coordinator" at="10:13">
                <Prose>Two tasks, side by side.</Prose>
              </Turn>
              {/* Each task it started, folded to the line it posted then: who leads it. */}
              <TaskMark
                task="418"
                verb="started"
                detail={`${OPUS.short} leads`}
                at="10:13"
                steps={['Implement', 'Review']}
                step={0}
                now="Review"
                onJump={fn()}
              />
              <TaskMark
                task="429"
                verb="started"
                detail={`${SONNET.short} leads`}
                at="10:13"
                steps={['Implement', 'Review']}
                step={0}
                now="Implement"
                last
                onJump={fn()}
              />
              <You at="10:51">EU customers are seeing the wrong VAT rate on their invoice PDFs since Monday. Can you fix it?</You>
              <Turn voice="Coordinator" at="10:51">
                <WorkedFor took="14s" />
                <Prose>One task. Opus 5 fixes the rate lookup and adds a test for each EU country, and Codex reviews it.</Prose>
              </Turn>
              <TaskLaunch
                task="432"
                title="Fix the VAT rate on EU invoice PDFs"
                from={FROM_231}
                project="Meridian"
                estimate="About 25 min · about $1 on your subscriptions"
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
                    title={row.title}
                    wait={Wait.Workers}
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

/** Meridian at work: the coordinator's plan counting down, three tasks running, one question for you, two up next. */
export const Busy: Story = {}
