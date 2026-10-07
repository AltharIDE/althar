import { useEffect, useState } from 'react'

import type { BoardTask } from '@althar/contracts'

import {
  ActionButton,
  ChangeView,
  Composer,
  Heading,
  LinkButton,
  SidePanel,
  SidePanelBody,
  SidePanelTitle,
  Room,
  Spinner,
  TaskFace,
  Thread,
  ThreadDivider,
  ThreadMeasure,
} from '@althar/ui'

import { ModelChoice } from '../../shared/ModelChoice'
import { type Choice, runningOn } from '../../shared/models'
import { ago, useNow } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { BoardView, type DockTarget } from '../board/BoardView'
import { DockView, useHead } from '../board/DockView'
import { lanesOf, yoursOf } from '../board/lanes'
import type { BoardModel } from '../board/useBoard'
import { ConnectionsView, text as connectionsText } from '../connections/ConnectionsView'
import { useChanges } from '../task/useChanges'
import type { ConnectionsModel } from '../connections/useConnections'
import { Card, type CardActions } from './Card'
import { NewTask } from './NewTask'
import { nextRoom, ProjectBar } from './ProjectBar'
import s from './Project.module.css'
import type { ProjectModel } from './useProject'

/*
 * A project: the conversation with its coordinator, the board of its work,
 * or both side by side (⌘1, ⌘2, ⌘3). The coordinator answers questions
 * itself and turns changes into tasks; a task you plan yourself opens beside
 * the conversation. What you open from the board opens in the dock beside it,
 * to answer or accept there; a task's changes open over the window. The bar
 * says how much is running and how much needs you, and takes you to the
 * first of it.
 */

export const text = {
  project: 'Project',
  conversation: 'Conversation',
  coordinator: 'Coordinator',
  empty: 'Ask the coordinator about the project, or say what should change.',
  placeholder: 'Tell the coordinator something',
  handsOver: (agent: string) => `hands the conversation to ${agent}`,
  takesOver: (to: string, from: string) => `${to} takes over from a brief; ${from}’s turn stops.`,
  handOver: 'Hand it over',
  queued: 'Queued · the coordinator reads it next',
  placeholderBusy: 'Add to the queue, or interrupt the coordinator',
  signedOut: (agent: string, instead: string) => `${agent} isn't signed in, so the coordinator starts on ${instead}.`,
  needsAgent: 'No agent is signed in. Sign one in with its own tool, then come back.',
  earlier: 'Earlier',
  showEarlier: 'Show',
  loadingEarlier: 'Showing…',
  dismiss: 'Dismiss',
  boardFailed: 'Althar couldn’t read the board.',
  notConnected: (host: string) => `Althar isn't connected to ${host}, so tasks here end on their branch.`,
  connect: (host: string) => `Connect ${host}`,
}

export function ProjectView({
  model,
  board,
  connections,
  onTask,
  onRules,
  room: opening = Room.Talk,
  newTask = false,
}: {
  model: ProjectModel
  board: BoardModel
  connections: ConnectionsModel
  onTask: (threadId: string) => void
  /** Opens the project's rules; without it, no way there. */
  onRules?: () => void
  /** The view it opens on, as a task's bar chose it. */
  room?: Room
  /** It opens planning a new task, as a task's bar asked. */
  newTask?: boolean
}) {
  const [room, setRoom] = useState<Room>(newTask && opening === Room.Board ? Room.Both : opening)
  const [dock, setDock] = useState<DockTarget | null>(null)
  // A board task's changes, over the window: the task and the file to open on.
  const [reviewing, setReviewing] = useState<{ readonly task: BoardTask; readonly path?: string } | null>(null)
  const reviewed = useHead(reviewing?.task.threadId ?? null, board.board?.cursor ?? 0)
  const changes = useChanges(reviewing?.task.taskId ?? null, reviewed?.task.files[0]?.path ?? null)
  const { show: showChanges, close: closeChanges } = changes
  useEffect(() => {
    if (reviewing === null) return
    showChanges(reviewing.path)
  }, [reviewing, showChanges])
  const lanes = board.board === null ? null : lanesOf(board.board)
  const yours = lanes === null ? 0 : yoursOf(lanes)
  const working = lanes === null ? 0 : lanes.running.filter((task) => task.phase !== 'stopped').length
  // b steps through the views, when nothing is being typed; ⌘ and a number belongs to the window's tabs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'b' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="dialog"]') !== null)
      )
        return
      event.preventDefault()
      setRoom(nextRoom)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [draft, setDraft] = useState('')
  const [pick, setPick] = useState<Choice | null>(null)
  // What opens beside the conversation: a task you plan, or the connections.
  const [panel, setPanel] = useState<'task' | 'connections' | null>(newTask ? 'task' : null)
  // A running turn says how long it has worked so far; a plan on its countdown, when it starts.
  const now = useNow((model.coordinator?.session?.turnRunning ?? false) || (lanes?.next.some((task) => task.phase === 'planned') ?? false))
  const coordinator = model.coordinator
  const session = coordinator?.session ?? null
  const suggested = coordinator?.suggested ?? null
  const busy = session?.turnRunning ?? false
  const agentName = (id: string | null) =>
    model.agents.find((agent) => agent.id === id)?.name ?? (id === session?.agentId ? session.agentName : (id ?? ''))
  // Whatever it ran on last, while that agent can; otherwise the first that can.
  const first = model.agents[0]
  const chosen: Choice | null =
    (session === null ? null : runningOn(session)) ??
    pick ??
    (suggested?.available === true ? { agentId: suggested.agentId, model: suggested.model, effort: suggested.effort } : null) ??
    (first === undefined ? null : { agentId: first.id, model: null, effort: null })
  const name = model.project?.name ?? coordinator?.project.name ?? text.project

  const actions: CardActions = {
    project: name,
    agents: model.agents,
    agentName,
    onStart: (planId) => void model.startPlan(planId),
    onHold: (planId) => void model.holdPlan(planId),
    onChange: (planId, steps, end) => void model.changePlan(planId, steps, end),
    onOpen: onTask,
  }

  const send = (body: string, now: boolean) => {
    setDraft('')
    void (now ? model.sayNow(body) : model.say(body, chosen))
  }

  const composer = (
    <div className={s.composer}>
      {model.error !== null && (
        <p className={s.failure} role="alert">
          {model.error} <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
        </p>
      )}
      {session === null && model.agents.length === 0 && <p className={s.quiet}>{text.needsAgent}</p>}
      {session === null && suggested !== null && !suggested.available && chosen !== null && (
        <p className={s.quiet}>{text.signedOut(suggested.agentName, agentName(chosen.agentId))}</p>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={(body) => send(body, false)}
        onSendNow={(body) => send(body, true)}
        {...(busy ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy}
        placeholder={busy ? text.placeholderBusy : text.placeholder}
        picker={
          model.agents.length > 0 &&
          chosen !== null && (
            <ModelChoice
              owner={text.coordinator}
              agents={model.agents}
              value={chosen}
              onChange={(next) => (session === null ? setPick(next) : void model.choose(next))}
              {...(session === null ? {} : { handover: { note: text.handsOver, ask: busy ? text.takesOver : null } })}
              text={{ proceed: text.handOver }}
            />
          )
        }
      />
    </div>
  )

  const talking = room !== Room.Board
  const boarding = room !== Room.Talk
  /** The first thing that waits on you, in the dock, beside the board. */
  const openYours = () => {
    const first: DockTarget | null =
      lanes?.calls[0] !== undefined
        ? { kind: 'call', id: lanes.calls[0].id }
        : lanes?.ready[0] !== undefined
          ? { kind: 'task', id: lanes.ready[0].taskId }
          : null
    if (first === null) return
    if (room === Room.Talk) setRoom(Room.Both)
    setDock(first)
  }

  return (
    <div className={s.window}>
      <ProjectBar
        room={room}
        onRoom={setRoom}
        working={working}
        yours={yours}
        onYours={openYours}
        {...(onRules === undefined ? {} : { onRules })}
        newTask={panel === 'task'}
        onNewTask={() => {
          if (room === Room.Board) setRoom(Room.Both)
          setPanel('task')
        }}
      />
      <div className={room === Room.Both ? `${s.rooms} ${s.both}` : s.rooms}>
        {talking && (
          <div className={s.talk}>
            <div className={s.head}>
              <ThreadMeasure>
                <div className={s.heading}>
                  <div>
                    <Heading level={1}>{name}</Heading>
                    {model.project?.repository && <p className={s.repository}>{model.project.repository}</p>}
                  </div>
                </div>
                {coordinator?.host != null && !coordinator.host.connected && (
                  <p className={s.host}>
                    {text.notConnected(coordinator.host.name)}{' '}
                    <ActionButton onClick={() => setPanel('connections')}>{text.connect(coordinator.host.name)}</ActionButton>
                  </p>
                )}
              </ThreadMeasure>
            </div>
            {coordinator === null ? (
              <div className={s.loading}>{model.error === null ? <Spinner /> : <p role="alert">{model.error}</p>}</div>
            ) : (
              <TaskFace
                className={s.face}
                composer={composer}
                panel={
                  panel === 'task' ? (
                    <NewTask
                      agents={model.agents}
                      starting={model.starting}
                      connected={coordinator.host?.connected === true}
                      defaultEnd={model.end}
                      repositories={model.project?.repositories ?? []}
                      listIssues={model.listIssues}
                      onClose={() => setPanel(null)}
                      onStart={(task) =>
                        void model.startTask(task).then((started) => {
                          if (started !== null) setPanel(null)
                        })
                      }
                    />
                  ) : panel === 'connections' ? (
                    <SidePanel
                      label={connectionsText.label}
                      head={<SidePanelTitle>{connectionsText.label}</SidePanelTitle>}
                      onClose={() => setPanel(null)}
                    >
                      <SidePanelBody>
                        <ConnectionsView model={connections} />
                      </SidePanelBody>
                    </SidePanel>
                  ) : undefined
                }
              >
                <Thread label={text.conversation} busy={busy}>
                  {coordinator.earlier && (
                    <ThreadDivider
                      icon="up"
                      action={model.loadingEarlier ? text.loadingEarlier : text.showEarlier}
                      onAction={() => void model.loadEarlier()}
                    >
                      {text.earlier}
                    </ThreadDivider>
                  )}
                  {coordinator.items.length === 0 && model.streaming.size === 0 && <p className={s.quiet}>{text.empty}</p>}
                  <ThreadBlocks
                    blocks={blocksOf(
                      { items: coordinator.items, turnRunning: busy, worktree: null },
                      model.streaming,
                      (iso) => ago(iso),
                      now,
                    )}
                    agentName={agentName}
                    card={(card) => <Card card={card} actions={actions} />}
                    queued={text.queued}
                  />
                </Thread>
              </TaskFace>
            )}
          </div>
        )}
        {boarding && (
          <div className={s.board}>
            {lanes !== null ? (
              <BoardView lanes={lanes} agents={model.agents} now={now} current={dock} onOpen={(target) => setDock(target)} />
            ) : board.error === null ? (
              <div className={s.loading}>
                <Spinner />
              </div>
            ) : (
              <p className={s.failure} role="alert">
                {text.boardFailed} {board.error}
              </p>
            )}
          </div>
        )}
        {dock !== null && (
          <div className={s.dock}>
            <DockView
              target={dock}
              model={board}
              agents={model.agents}
              project={name}
              now={now}
              onClose={() => setDock(null)}
              onTask={onTask}
              onChanges={(task, path) => setReviewing({ task, ...(path === undefined ? {} : { path }) })}
            />
          </div>
        )}
      </div>
      {changes.open && reviewing !== null && reviewed !== null && (
        <ChangeView
          lights="space"
          branch={reviewed.task.branch ?? ''}
          {...(reviewed.task.baseRef === null ? {} : { base: reviewed.task.baseRef.replace(/^origin\//, '') })}
          files={reviewed.task.files}
          selected={changes.selected}
          onSelect={changes.select}
          view={changes.view}
          onRetry={changes.retry}
          onClose={() => {
            closeChanges()
            setReviewing(null)
          }}
        />
      )}
    </div>
  )
}
