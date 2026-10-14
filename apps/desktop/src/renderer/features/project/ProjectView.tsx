import { type CSSProperties, useEffect, useState } from 'react'

import {
  Composer,
  DictationTray,
  LinkButton,
  ResizeHandle,
  Room,
  RulesOffer,
  TaskFace,
  Thread,
  ThreadDivider,
  ThreadMeasure,
  ThreadShellProvider,
  ThreadSkeleton,
  ProjectFront,
  type ProjectFrontProps,
  Running,
} from '@althar/ui'

import { contextMeter } from '../../shared/ContextMeter'
import { useModels } from '../../data/models'
import { useDictation } from '../../shared/dictation/useDictation'
import { queuedOf, queueShown, withQueued } from '../../shared/items'
import { ModelChoice } from '../../shared/ModelChoice'
import { useModelNames } from '../../shared/modelNames'
import { PartPending, pendingText } from '../../shared/Pending'
import { type Choice, runningOn } from '../../shared/models'
import { runningOf } from '../../shared/running'
import { RunOf } from '../../shared/RunOf'
import { ago, useNow } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { useThreadHost } from '../../shared/ThreadHost'
import { takesImages, useImages } from '../../shared/useImages'
import { BoardView } from '../board/BoardView'
import { type Lanes, lanesOf, yoursOf } from '../board/lanes'
import { firstNeedOf, needsOf } from '../board/needs'
import type { BoardModel } from '../board/useBoard'
import { ConnectDialog, type Opening, openingFor } from '../connections/ConnectDialog'
import type { ConnectionsModel } from '../connections/useConnections'
import type { AgentRulesModel } from '../rules/useAgentRules'
import { Card, type CardActions } from './Card'
import { DraftCard, type DraftActions } from './DraftCard'
import { lastSettledOf, partsOf, tasksOf, trackersOf } from './front'
import { nextRoom, ProjectBar } from './ProjectBar'
import { inkOf, ProjectSettings } from './ProjectSettings'
import s from './Project.module.css'
import type { ProjectModel } from './useProject'
import type { ProjectSettingsModel } from './useProjectSettings'

/*
 * A project: its front page across the top, then the conversation with its
 * coordinator, the board of its work, or both side by side, the conversation
 * as wide as the person drags it (b steps through them). The front page says
 * how the project stands (what needs you: pointed at, what it is; clicked,
 * the first of it), what it is made of, and opens its settings. The
 * coordinator answers questions itself and turns changes into tasks: there
 * is no task to start without it. Connecting the code host, from the
 * settings, opens over whichever view is shown. What you open from the board
 * opens its task.
 */

export const text = {
  project: 'Project',
  conversation: 'Conversation',
  coordinator: 'Coordinator',
  empty: (project: string) => `Ask the coordinator about ${project}, or say what should change.`,
  placeholder: 'Tell the coordinator something',
  handsOver: (agent: string) => `hands the conversation to ${agent}`,
  /** Another agent's model, picked: nothing happens until the person says something. */
  handingOver: (to: string, from: string) => `${to} takes over from ${from} when you send.`,
  keep: (from: string) => `Keep ${from}`,
  queued: 'Queued · the coordinator reads it next',
  queue: (n: number) => (n === 1 ? 'Queued; the coordinator reads it next' : `${n} queued; the coordinator reads them in order`),
  placeholderBusy: 'Add to the queue, or interrupt the coordinator',
  signedOut: (agent: string, instead: string) => `${agent} isn't signed in, so the coordinator starts on ${instead}.`,
  needsAgent: 'No agent is signed in. Sign one in from Settings, then come back.',
  earlier: 'Earlier',
  showEarlier: 'Show',
  loadingEarlier: 'Showing…',
  dismiss: 'Dismiss',
  boardFailed: 'Althar couldn’t read the board.',
  olderFailed: 'Althar couldn’t load older tasks.',
  boardReading: 'Reading the board',
  width: 'Width of the conversation',
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

/** The front page, with a clock of its own: what settled last says how long ago, a minute at a time, whatever else runs or doesn't. */
function Front({ lanes, ...front }: Omit<ProjectFrontProps, 'last'> & { lanes: Lanes | null }) {
  const now = useNow(true, 60_000)
  const last = lanes === null ? undefined : lastSettledOf(lanes, new Date(now))
  return <ProjectFront {...front} {...(last === undefined ? {} : { last })} />
}

/** The project's settings, and where they open. */
export interface ProjectSettingsActions {
  readonly model: ProjectSettingsModel
  readonly onRepositories: () => void
  readonly onRules: () => void
}

export function ProjectView({
  model,
  board,
  connections,
  onTask,
  settings,
  agentRules,
  room: opening = Room.Talk,
  onRoomChange,
}: {
  model: ProjectModel
  board: BoardModel
  connections: ConnectionsModel
  onTask: (threadId: string) => void
  /**
   * The offer, once, as the project opens, to start its rules from its
   * agents' own settings (ADR-036): reviewing them, which opens them on the
   * rules screen, or taking none. Without it, it isn't offered here.
   */
  agentRules?: { readonly model: AgentRulesModel; readonly onReview: () => void }
  /** The project's settings: its name and colour, its repositories, its rules, removing it; without them, no way to them. */
  settings?: ProjectSettingsActions
  /** The view it opens on: the one a task's bar chose, or the one the person was last on. */
  room?: Room
  /** The view it is on, each time it changes, to be opened on again. */
  onRoomChange?: (room: Room) => void
}) {
  const [room, setRoom] = useState<Room>(opening)
  useEffect(() => onRoomChange?.(room), [room, onRoomChange])
  // A picture the coordinator handed back opens in the lightbox; it writes no documents, so none opens beside it.
  const shown = useThreadHost(false)
  const both = useBothWidth()
  const lanes = board.board === null ? null : lanesOf(board.board)
  const yours = lanes === null ? 0 : yoursOf(lanes)
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
  const voice = useDictation(setDraft, { projectId: model.project?.id ?? model.coordinator?.project.id ?? null })
  // Images to send with what the person says, and which agents take them.
  const images = useImages()
  const models = useModels()
  const [pick, setPick] = useState<Choice | null>(null)
  // Another agent's model, picked while the coordinator runs: it takes over with what the person says next.
  const [handover, setHandover] = useState<Choice | null>(null)
  // Connecting, opened from the settings: the walk in to the project's host or tracker, or all of them where it is connected.
  const [connecting, setConnecting] = useState<Opening | null>(null)
  const coordinator = model.coordinator
  // Every run in the project, the tasks' too, each saying where, over the composer.
  const launches = coordinator?.launches ?? []
  // A running turn says how long it has worked so far; a plan on its countdown, when it starts; a run, how long it has been up.
  const now = useNow(
    (coordinator?.session?.turnRunning ?? false) ||
      (lanes?.next.some((task) => task.phase === 'planned') ?? false) ||
      launches.some((launch) => launch.ended === null),
  )
  const host = coordinator?.host ?? null
  const named = useModelNames()
  const session = coordinator?.session ?? null
  const suggested = coordinator?.suggested ?? null
  const busy = session?.turnRunning ?? false
  const queue = queueShown(session, model.pending)
  const agentName = (id: string | null) =>
    model.agents.find((agent) => agent.id === id)?.name ?? (id === session?.agentId ? session.agentName : (id ?? ''))
  // Whatever it ran on last, while that agent can; otherwise the first that can.
  const first = model.agents[0]
  const waiting = session === null || handover?.agentId === session.agentId ? null : handover
  const chosen: Choice | null =
    waiting ??
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
    onStopBackground: (threadId, id) => void model.stopBackground(threadId, id),
  }
  const draftActions: DraftActions = {
    onFile: (draftId) => void model.fileIssueDraft(draftId),
    onChange: (draftId, edit) => model.changeIssueDraft(draftId, edit),
    onDiscard: (draftId) => void model.discardIssueDraft(draftId),
  }

  // The agent what the person says goes to, and whether it takes images.
  const receiver = { name: agentName(chosen?.agentId ?? null), takes: takesImages(models, chosen?.agentId ?? null) }
  const send = (body: string, now: boolean) => {
    // Images that can't go yet hold the message back, and the composer says why.
    const outgoing = images.take(receiver)
    if (outgoing === null) return
    setDraft('')
    images.clear()
    const picked = waiting
    if (picked !== null) setHandover(null)
    const said =
      picked !== null ? model.handOver(picked, body, outgoing) : now ? model.sayNow(body, outgoing) : model.say(body, chosen, outgoing)
    // One Althar doesn't take goes back in the composer: its words, its images, and the agent picked to take over.
    void said.then((accepted) => {
      if (accepted) return
      setDraft((current) => withQueued(current, body))
      images.giveBack(outgoing)
      if (picked !== null) setHandover(picked)
    })
  }
  // Picking changes nothing that runs: the same agent's model or effort is set for its next turn, another agent waits for what the person says.
  const choose = (next: Choice) => {
    if (session === null) return setPick(next)
    if (next.agentId !== session.agentId) return setHandover(next)
    setHandover(null)
    void model.choose(next)
  }
  // A queued message goes back in the composer to be changed, and out of the queue, unless the coordinator has it already.
  const edit = async (id: string) => {
    const said = queuedOf(coordinator?.items ?? [], queue).find((message) => message.id === id)
    // One whose images wouldn't fit beside those waiting stays in the queue, and the composer says why.
    if (said === undefined || !images.fits(said.pictures)) return
    if (await model.takeBack(id)) {
      setDraft((current) => withQueued(current, said.text))
      images.restore(said.pictures)
    }
  }

  const composer = (
    <div className={s.composer}>
      {model.error !== null && (
        <p className={s.failure} role="alert">
          {model.error} <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
        </p>
      )}
      {waiting !== null && session !== null && (
        <p className={s.handover}>
          {text.handingOver(named(waiting.agentId, waiting.model).name, named(session.agentId, session.model).name)}{' '}
          <LinkButton onClick={() => setHandover(null)}>{text.keep(named(session.agentId, session.model).name)}</LinkButton>
        </p>
      )}
      {session === null && model.agents.length === 0 && <p className={s.quiet}>{text.needsAgent}</p>}
      {session === null && suggested !== null && !suggested.available && chosen !== null && (
        <p className={s.quiet}>{text.signedOut(suggested.agentName, agentName(chosen.agentId))}</p>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        inputRef={voice.inputRef}
        dictation={voice.dictation}
        tray={voice.tray && <DictationTray {...voice.tray} />}
        above={
          launches.length > 0 && (
            <Running
              processes={runningOf(launches, now, { where: true })}
              onStop={(id) => void model.stopLaunch(id)}
              onDismiss={(id) => void model.clearLaunch(id)}
              // Where it answers opens in the person's browser.
              onOpenUrl={(id) => {
                const url = launches.find((launch) => launch.id === id)?.url
                if (url != null) window.open(url, '_blank')
              }}
            />
          )
        }
        onSubmit={(body) => send(body, false)}
        onSendNow={(body) => send(body, true)}
        {...images.props(receiver)}
        {...(busy ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy}
        queued={queuedOf(coordinator?.items ?? [], queue)}
        onEditQueued={(id) => void edit(id)}
        onUnqueue={(id) => void model.takeBack(id)}
        text={{ queued: text.queue }}
        placeholder={busy ? text.placeholderBusy : text.placeholder}
        meter={contextMeter(session, named)}
        picker={
          model.agents.length > 0 &&
          chosen !== null && (
            <ModelChoice
              owner={text.coordinator}
              agents={model.agents}
              value={chosen}
              onChange={choose}
              // Another agent's model hands the conversation over, once the person says something.
              {...(session === null ? {} : { handover: { note: text.handsOver, ask: null } })}
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

  // The front page: its name and ink as the person last chose them, how it stands, and what it is made of.
  const projectId = model.project?.id ?? coordinator?.project.id ?? ''
  const kept = settings?.model
  const trackers = lanes === null ? [] : trackersOf(tasksOf(lanes), connections.list)
  const front = (
    <Front
      lanes={lanes}
      name={kept?.name ?? name}
      seed={projectId}
      ink={inkOf(kept?.ink ?? model.project?.ink ?? 'clay')}
      yours={yours}
      {...(lanes === null ? {} : { needs: needsOf(lanes, agentName, onTask), inProgress: lanes.running.length })}
      onYours={openYours}
      parts={partsOf({
        repositories: model.repositories,
        names: model.project?.repositories ?? [],
        host,
        trackers,
        open: (url) => window.open(url, '_blank'),
      })}
      // The default branch runs with no agent, where its repository says how.
      {...(coordinator?.runCommand == null ? {} : { run: { command: coordinator.runCommand, onRun: () => void model.runProject() } })}
      {...(settings === undefined
        ? {}
        : {
            settings: (
              <ProjectSettings
                model={settings.model}
                seed={projectId}
                repositories={model.repositories ?? []}
                connections={connections.list}
                host={host}
                tracker={trackers[0] ?? null}
                onRepositories={settings.onRepositories}
                onRules={settings.onRules}
                onConnect={(product, at) => setConnecting(openingFor(connections.list, product, at))}
              />
            ),
          })}
    />
  )

  return (
    <div className={s.window}>
      <ProjectBar room={room} onRoom={setRoom} />
      {front}
      <div className={room === Room.Both ? `${s.rooms} ${s.both}` : s.rooms}>
        {talking && (
          <div className={s.talk} style={room === Room.Both ? ({ '--talk-width': `${both.width}px` } as CSSProperties) : undefined}>
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
              <TaskFace className={s.face} composer={composer}>
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
                  {agentRules?.model.offering === true && (
                    <RulesOffer
                      count={agentRules.model.rules.length}
                      onReview={agentRules.onReview}
                      onDecline={() => void agentRules.model.decline()}
                      declining={agentRules.model.declining}
                    />
                  )}
                  {agentRules?.model.offering === true && agentRules.model.error !== null && (
                    <p className={s.failure} role="alert">
                      {agentRules.model.error}
                    </p>
                  )}
                  {coordinator.items.length === 0 && model.streaming.size === 0 && <p className={s.quiet}>{text.empty(name)}</p>}
                  {/* The coordinator only reads: what it hands back is pictures, which open in the lightbox; it writes no documents. */}
                  <ThreadShellProvider value={shown.shell}>
                    <ThreadBlocks
                      blocks={blocksOf(
                        { items: coordinator.items, turnRunning: busy, worktree: null, queue, outputs: model.outputs },
                        model.streaming,
                        (iso) => ago(iso),
                        now,
                      )}
                      threadId={coordinator.threadId}
                      session={session}
                      card={(card) => <Card card={card} actions={actions} />}
                      draft={(draft) => <DraftCard draft={draft} actions={draftActions} />}
                      run={(run) => (
                        <RunOf
                          run={run}
                          now={now}
                          onStop={(id) => void model.stopLaunch(id)}
                          onRunAgain={(taskId) => void model.runProject(taskId)}
                        />
                      )}
                      queued={text.queued}
                      onAnswerQuestion={model.answerQuestion}
                    />
                  </ThreadShellProvider>
                </Thread>
              </TaskFace>
            )}
            {shown.lightbox}
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
              <>
                {board.olderError !== null && (
                  <p className={s.failure} role="alert">
                    {text.olderFailed} {board.olderError}
                  </p>
                )}
                <BoardView
                  lanes={lanes}
                  agents={model.agents}
                  now={now}
                  onOpen={onTask}
                  {...(board.moreSettled ? { onShowOlder: board.showOlder } : {})}
                />
              </>
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
      {connecting !== null && <ConnectDialog model={connections} opening={connecting} onClose={() => setConnecting(null)} />}
    </div>
  )
}
