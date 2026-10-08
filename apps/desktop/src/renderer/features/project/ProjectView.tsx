import { type CSSProperties, useEffect, useState } from 'react'

import {
  ActionButton,
  Composer,
  LinkButton,
  ResizeHandle,
  SidePanel,
  SidePanelBody,
  SidePanelTitle,
  Room,
  TaskFace,
  Thread,
  ThreadDivider,
  ThreadMeasure,
  ThreadSkeleton,
  MenuItem,
  MenuSeparator,
  ProjectHead,
} from '@althar/ui'

import { contextMeter } from '../../shared/ContextMeter'
import { shortFolder } from '../../shared/folders'
import { ModelChoice } from '../../shared/ModelChoice'
import { PartPending, pendingText } from '../../shared/Pending'
import { type Choice, runningOn } from '../../shared/models'
import { ago, useNow } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { BoardView } from '../board/BoardView'
import { lanesOf, yoursOf } from '../board/lanes'
import { firstNeedOf, needsOf } from '../board/needs'
import type { BoardModel } from '../board/useBoard'
import { ConnectionsView, text as connectionsText } from '../connections/ConnectionsView'
import type { ConnectionsModel } from '../connections/useConnections'
import { Card, type CardActions } from './Card'
import { NewTask } from './NewTask'
import { ProjectDialogs, ProjectItems, ProjectMenu, type ProjectMenuActions } from './ProjectMenu'
import { nextRoom, ProjectBar } from './ProjectBar'
import s from './Project.module.css'
import type { ProjectModel } from './useProject'

/*
 * A project: the conversation with its coordinator, the board of its work,
 * or both side by side, the conversation as wide as the person drags it (b
 * steps through them). The coordinator answers questions itself and turns
 * changes into tasks; a task you plan yourself opens beside the conversation.
 * What you open from the board opens its task. The bar says how much is
 * running and how much needs you: pointed at, what it is; clicked, the
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
  boardReading: 'Reading the board',
  notConnected: (host: string) => `Althar isn't connected to ${host}, so tasks here end on their branch.`,
  connect: (host: string) => `Connect ${host}`,
  newTask: 'New task',
  width: 'Width of the conversation',
  /** Where a project of several repositories is: how many, and their names. */
  repositories: (names: ReadonlyArray<string>) => `${names.length} repositories · ${names.join(', ')}`,
}

/** Where a project is, as its head says: its folder, with the home folder as ~, or its repositories where it has several. */
export const whereOf = (project: { readonly repository: string | null; readonly repositories: ReadonlyArray<string> } | null) => {
  if (project === null) return undefined
  if (project.repositories.length > 1) return text.repositories(project.repositories)
  return project.repository === null ? undefined : shortFolder(project.repository)
}

/** How wide the conversation is beside the board, as the person last dragged it: this window's own, kept across launches. */
const WIDTH = { key: 'althar.both', start: 560, min: 340, board: 480 } as const

const storedWidth = (): number => {
  try {
    const kept = Number(window.localStorage.getItem(WIDTH.key))
    return Number.isFinite(kept) && kept >= WIDTH.min ? kept : WIDTH.start
  } catch {
    return WIDTH.start
  }
}

/** The conversation's width beside the board: dragged, kept once a move ends, and never so wide the board has no room. */
const useBothWidth = () => {
  const [width, setWidth] = useState(storedWidth)
  const [room, setRoom] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setRoom(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const max = Math.max(WIDTH.min, room - WIDTH.board)
  const keep = (next: number) => {
    setWidth(next)
    try {
      window.localStorage.setItem(WIDTH.key, String(next))
    } catch {
      // Not kept; it still holds for this window.
    }
  }
  return { width: Math.min(width, max), min: WIDTH.min, max, set: setWidth, keep, reset: () => keep(WIDTH.start) }
}

export function ProjectView({
  model,
  board,
  connections,
  onTask,
  menu,
  room: opening = Room.Talk,
  onRoomChange,
  newTask = false,
}: {
  model: ProjectModel
  board: BoardModel
  connections: ConnectionsModel
  onTask: (threadId: string) => void
  /** The project's menu: rename, its repositories, its rules, remove; without it, none. */
  menu?: ProjectMenuActions
  /** The view it opens on: the one a task's bar chose, or the one the person was last on. */
  room?: Room
  /** The view it is on, each time it changes, to be opened on again. */
  onRoomChange?: (room: Room) => void
  /** It opens planning a new task, as a task's bar asked. */
  newTask?: boolean
}) {
  const [room, setRoom] = useState<Room>(newTask && opening === Room.Board ? Room.Both : opening)
  useEffect(() => onRoomChange?.(room), [room, onRoomChange])
  const both = useBothWidth()
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
  const host = coordinator?.host ?? null
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
      {host !== null && !host.connected && (
        <p className={s.host}>
          {text.notConnected(host.name)}{' '}
          <ActionButton size="small" onClick={() => setPanel('connections')}>
            {text.connect(host.name)}
          </ActionButton>
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
        meter={contextMeter(session)}
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
  /** The first thing that waits on you, in its task. */
  const openYours = () => {
    const first = lanes === null ? null : firstNeedOf(lanes)
    if (first !== null) onTask(first)
  }

  return (
    <div className={s.window}>
      <ProjectBar
        place={{ room, onRoom: setRoom }}
        working={lanes === null ? null : working}
        yours={lanes === null ? null : yours}
        {...(lanes === null ? {} : { needs: needsOf(lanes, agentName, onTask) })}
        onYours={openYours}
        {...(menu === undefined ? {} : { menu: <ProjectMenu {...menu} /> })}
        newTask={panel === 'task'}
        onNewTask={() => {
          if (room === Room.Board) setRoom(Room.Both)
          setPanel('task')
        }}
      />
      <div className={room === Room.Both ? `${s.rooms} ${s.both}` : s.rooms}>
        {talking && (
          <div className={s.talk} style={room === Room.Both ? ({ '--talk-width': `${both.width}px` } as CSSProperties) : undefined}>
            <ProjectHead
              title={name}
              meta={whereOf(model.project)}
              side={room === Room.Both}
              menu={
                <>
                  <MenuItem icon="plus" onSelect={() => setPanel('task')}>
                    {text.newTask}
                  </MenuItem>
                  {host !== null && !host.connected && (
                    <MenuItem icon="plug" onSelect={() => setPanel('connections')}>
                      {text.connect(host.name)}
                    </MenuItem>
                  )}
                  {menu && (
                    <>
                      <MenuSeparator />
                      <ProjectItems {...menu} />
                    </>
                  )}
                </>
              }
            />
            {coordinator === null ? (
              model.error === null ? (
                <div className={s.reading}>
                  <ThreadMeasure>
                    <ThreadSkeleton label={pendingText.thread} />
                  </ThreadMeasure>
                </div>
              ) : (
                <div className={s.loading}>
                  <p role="alert">{model.error}</p>
                </div>
              )
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
            {room === Room.Both && (
              <ResizeHandle
                value={both.width}
                min={both.min}
                max={both.max}
                onChange={both.set}
                onCommit={both.keep}
                onReset={both.reset}
                label={text.width}
              />
            )}
          </div>
        )}
        {boarding && (
          <div className={s.board}>
            {lanes !== null ? (
              <BoardView lanes={lanes} agents={model.agents} now={now} onOpen={onTask} />
            ) : board.error === null ? (
              <PartPending label={text.boardReading} />
            ) : (
              <p className={s.failure} role="alert">
                {text.boardFailed} {board.error}
              </p>
            )}
          </div>
        )}
      </div>
      {menu && <ProjectDialogs model={menu.model} />}
    </div>
  )
}
