import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

import type { ThreadItem } from '@althar/contracts'

import {
  Composer,
  DictationTray,
  LinkButton,
  ResizeHandle,
  Room,
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
import { platform } from '../../shared/device'
import { useModels } from '../../data/models'
import { useServices } from '../../data/services'
import { CarriedOver } from '../../shared/dictation/Carried'
import { useDictation } from '../../shared/dictation/useDictation'
import { draftKey, setDraftDictated, useDraft } from '../../shared/drafts'
import { queuedOf, queueShown, readingNow, withQueued } from '../../shared/items'
import { ModelChoice } from '../../shared/ModelChoice'
import { useModelNames } from '../../shared/modelNames'
import { PartPending, pendingText } from '../../shared/Pending'
import { type Choice, runningOn } from '../../shared/models'
import { usualLead } from '../automations/lead'
import { runningOf } from '../../shared/running'
import { RunOf } from '../../shared/RunOf'
import { Runs } from '../runs/Runs'
import { ago, useNow } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { useThreadHost } from '../../shared/ThreadHost'
import { outgoingOf, takesImages, useAttachments } from '../../shared/useAttachments'
import { AutomationInThread } from '../automations/AutomationInThread'
import { AutomationsView } from '../automations/AutomationsView'
import { useAutomationActions, useAutomations } from '../automations/useAutomations'
import { BoardView } from '../board/BoardView'
import { useFolds } from '../board/folds'
import { useClosePullRequests } from '../board/useClosePullRequests'
import { type Lanes, lanesOf, yoursOf } from '../board/lanes'
import { firstNeedOf, needsOf } from '../board/needs'
import type { BoardModel } from '../board/useBoard'
import type { ConnectionsModel } from '../connections/useConnections'
import { ProjectSettingsPage } from '../projectSettings/ProjectSettingsPage'
import { FIRST_PROJECT_SECTION, type ProjectSection } from '../projectSettings/sections'
import { connectionsNeedYou } from '../projectSettings/standing'
import type { ProjectSettingsModel } from '../projectSettings/useProjectSettings'
import { kitInk } from '../../shared/inks'
import { Card, type CardActions } from './Card'
import { ChangesCard, type ChangesActions } from '../../shared/ChangesCard'
import { DraftCard, type DraftActions } from '../../shared/DraftCard'
import { lastSettledOf, partsOf, tasksOf, trackersOf } from './front'
import { nextRoom, ProjectBar } from './ProjectBar'
import s from './Project.module.css'
import type { ProjectModel } from './useProject'

/*
 * A project: its front page across the top, then the conversation with its
 * coordinator, the board of its work, or both side by side, the conversation
 * as wide as the person drags it (b steps through them); or its automations,
 * or its settings, in their place, a violet dot in the bar on Automations
 * where one paused itself, and on Settings where a connection waits on the
 * person. The front page says how the project stands (what needs you:
 * pointed at, what it is; clicked, the first of it) and what it is made of.
 * The coordinator answers questions itself and turns changes into tasks:
 * there is no task to start without it. What you open from the board opens
 * its task.
 */

export const text = {
  /** Dictation carried once the person leaves the coordinator: whose it is, and putting another thread's here. */
  carriedTo: (project: string) => `To the coordinator · ${project}`,
  carriedSend: 'Send to the coordinator',
  carriedTake: 'Move it to the coordinator',
  project: 'Project',
  conversation: 'Conversation',
  coordinator: 'Coordinator',
  empty: (project: string) => `Ask the coordinator about ${project}, or say what should change.`,
  placeholder: 'Tell the coordinator something',
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

/** The project's settings, and where they lead out of the project. */
export interface ProjectSettingsActions {
  readonly model: ProjectSettingsModel
  /** The section they open on, where something asked for one. */
  readonly section?: ProjectSection
  /** Althar's own settings, at its code hosts and trackers, where connections are managed. */
  readonly onConnections: () => void
}

/** The thread of the newest task card waiting for a free agent, if any. */
const newestWaiting = (items: ReadonlyArray<ThreadItem>): string | null => {
  const waiting = items.filter((item) => item.kind === 'task' && item.content.queued !== null)
  const newest = waiting.at(-1)
  return newest?.kind === 'task' ? newest.content.threadId : null
}

export function ProjectView({
  model,
  board,
  connections,
  onTask,
  settings,
  room: asked,
  onRoomChange,
  automation: openingAutomation = null,
  onAutomationChange,
  visit,
}: {
  model: ProjectModel
  board: BoardModel
  connections: ConnectionsModel
  onTask: (threadId: string) => void
  /** The project's settings: its name and colour, its code and issues, its rules, what it runs, its notes, removing it. */
  settings: ProjectSettingsActions
  /** The view it opens on: the one a task's bar chose, or the one the person was last on. */
  room?: Room
  /** The view it is on, each time it changes, to be opened on again. */
  onRoomChange?: (room: Room) => void
  /** The automation open as its own page in Automations, `new` for a new one; null for the tab. */
  automation?: string | null
  /** The automation open, each time it changes, to be opened on again. */
  onAutomationChange?: (automation: string | null) => void
  /** Counts the times its address asked for it, the screen kept in between: each time, it goes to the view, automation or section asked. */
  visit?: number
}) {
  const [room, setRoom] = useState<Room>(asked ?? Room.Both)
  const [automation, setAutomation] = useState<string | null>(openingAutomation)
  useEffect(() => onAutomationChange?.(automation), [automation, onAutomationChange])
  // The section its settings show, kept while the person is on another view.
  const [section, setSection] = useState<ProjectSection>(settings.section ?? FIRST_PROJECT_SECTION)
  // Asked for again, kept while the person was elsewhere: what the address asks, it goes to; the rest stays as they left it.
  const [visited, setVisited] = useState(visit)
  if (visit !== visited) {
    setVisited(visit)
    if (asked !== undefined) setRoom(asked)
    if (openingAutomation !== null) setAutomation(openingAutomation)
    if (settings.section !== undefined) setSection(settings.section)
  }
  useEffect(() => onRoomChange?.(room), [room, onRoomChange])
  // A picture the coordinator handed back opens in the lightbox; it writes no documents, so none opens beside it.
  // What the coordinator's thread opens: a picture in the lightbox, a file it names beside the thread.
  const shown = useThreadHost(false, { threadId: model.coordinator?.threadId ?? null, taskId: null })
  const both = useBothWidth()
  // The lanes the person collapsed, kept for every project, apart beside the conversation.
  const [folds, setFolds] = useFolds(room === Room.Both ? 'beside' : 'alone')
  const lanes = board.board === null ? null : lanesOf(board.board)
  const yours = lanes === null ? 0 : yoursOf(lanes)
  // An abandoned task's pull request left open, closed from its row.
  const closing = useClosePullRequests()
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
  // What the person writes to the coordinator, kept by the project while they are elsewhere, as are its images and what they dictate.
  const about = model.project?.id ?? model.coordinator?.project.id ?? null
  const draftOf = draftKey.coordinator(about ?? '')
  const [draft, setDraft] = useDraft(draftOf)
  const coordinatorThread = model.coordinator?.threadId ?? null
  const voice = useDictation(draftOf, {
    projectId: about,
    to:
      about === null
        ? null
        : {
            to: text.carriedTo(model.project?.name ?? model.coordinator?.project.name ?? text.project),
            back: { kind: 'coordinator', projectId: about },
            // What the person says to the coordinator starts it if it isn't running, so it goes from anywhere.
            threadId: coordinatorThread,
            send: text.carriedSend,
            take: text.carriedTake,
          },
  })
  // Images and files to send with what the person says, and which agents take images.
  const images = useAttachments(draftOf, useServices().host)
  const models = useModels()
  const [pick, setPick] = useState<Choice | null>(null)
  // Another agent's model, picked while the coordinator runs: it takes over with what the person says next.
  const [handover, setHandover] = useState<Choice | null>(null)
  const coordinator = model.coordinator
  // Every run in the project, the tasks' too, each saying where, over the composer.
  const launches = coordinator?.launches ?? []
  // A running turn says how long it has worked so far; a plan on its countdown, when it starts; a run, how long it has been up.
  const now = useNow(
    (coordinator?.session?.turnRunning ?? false) ||
      // While what the person sent is on its way, or the coordinator starts for it, how long they have waited.
      model.pending ||
      coordinator?.session?.state === 'starting' ||
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
  const waiting = session === null || !session.held || handover?.agentId === session.agentId ? null : handover
  const chosen: Choice | null =
    waiting ??
    (session === null || !session.held ? null : runningOn(session)) ??
    pick ??
    (suggested?.available === true ? { agentId: suggested.agentId, model: suggested.model, effort: suggested.effort } : null) ??
    (first === undefined ? null : { agentId: first.id, model: null, effort: null })
  const name = model.project?.name ?? coordinator?.project.name ?? text.project

  const actions: CardActions = {
    project: name,
    ...(about === null ? {} : { projectId: about }),
    agents: model.agents,
    agentName,
    onStart: (planId) => void model.startPlan(planId),
    onHold: (planId) => void model.holdPlan(planId),
    onChange: (planId, steps, end) => void model.changePlan(planId, steps, end),
    onOpen: onTask,
    onStopBackground: (threadId, id) => void model.stopBackground(threadId, id),
    // Every waiting card has the same holders, so only the newest says them.
    holdersOn: newestWaiting(coordinator?.items ?? []),
  }
  const draftActions: DraftActions = {
    onFile: (draftId) => void model.fileIssueDraft(draftId),
    onChange: (draftId, edit) => model.changeIssueDraft(draftId, edit),
    onDiscard: (draftId) => void model.discardIssueDraft(draftId),
  }
  const changesActions: ChangesActions = {
    onApply: (changesId) => void model.applyIssueChanges(changesId),
    onDiscard: (changesId) => void model.discardIssueChanges(changesId),
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
    if (session === null || !session.held) return setPick(next)
    if (next.agentId !== session.agentId) return setHandover(next)
    setHandover(null)
    void model.choose(next)
  }
  // A queued message goes back in the composer to be changed, and out of the queue, unless the coordinator has it already.
  const edit = async (id: string) => {
    const said = queuedOf(coordinator?.items ?? [], queue).find((message) => message.id === id)
    // One whose images wouldn't fit beside those waiting stays in the queue, and the composer says why.
    if (said === undefined || !images.fits(said)) return
    if (await model.takeBack(id)) {
      setDraft((current) => withQueued(current, said.text))
      if (said.dictated === true) setDraftDictated(draftOf, true)
      images.restore(said)
    }
  }

  // A queued message goes to the coordinator now, interrupting it, rather than when it is done: out of the queue, and said again. One it has already read stays as it was.
  const sendQueuedNow = async (id: string) => {
    const said = queuedOf(coordinator?.items ?? [], queue).find((message) => message.id === id)
    if (said === undefined || !(await model.takeBack(id))) return
    if (await model.sayNow(said.text, outgoingOf(said))) return
    // Althar didn't take it: it goes back in the composer, as one taken back to edit does.
    setDraft((current) => withQueued(current, said.text))
    if (said.dictated === true) setDraftDictated(draftOf, true)
    images.restore(said)
  }

  const line: ReactNode =
    waiting !== null && session !== null ? (
      <>
        {text.handingOver(named(waiting.agentId, waiting.model).name, named(session.agentId, session.model).name)}{' '}
        <LinkButton onClick={() => setHandover(null)}>{text.keep(named(session.agentId, session.model).name)}</LinkButton>
      </>
    ) : (session === null || !session.held) && model.agents.length === 0 ? (
      text.needsAgent
    ) : (session === null || !session.held) && suggested !== null && !suggested.available && chosen !== null ? (
      text.signedOut(suggested.agentName, agentName(chosen.agentId))
    ) : null

  const composer = (
    <div className={s.composer}>
      <Composer
        value={draft}
        onChange={setDraft}
        inputRef={voice.inputRef}
        dictation={voice.dictation}
        tray={voice.tray && <DictationTray {...voice.tray} />}
        carried={<CarriedOver here={draftOf} />}
        // The lines about who answers go on the composer's edge, so a running launch's chip and they never overlap.
        notice={
          model.error !== null || line !== null ? (
            <>
              {model.error !== null && (
                <div className={s.failure} role="alert">
                  {model.error} <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
                </div>
              )}
              {line !== null && <div>{line}</div>}
            </>
          ) : null
        }
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
        onSendQueuedNow={(id) => void sendQueuedNow(id)}
        onUnqueue={(id) => void model.takeBack(id)}
        text={{ queued: text.queue, sendNowKey: platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter' }}
        placeholder={busy ? text.placeholderBusy : text.placeholder}
        meter={contextMeter(session, named, model.compact)}
        picker={
          model.agents.length > 0 &&
          chosen !== null && (
            <ModelChoice
              owner={text.coordinator}
              agents={model.agents}
              {...(about === null ? {} : { projectId: about })}
              value={chosen}
              onChange={choose}
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
  const kept = settings.model
  const trackers = lanes === null ? [] : trackersOf(tasksOf(lanes), connections.list)
  const settingsNeedYou = connectionsNeedYou(model.repositories, trackers, connections.list)
  // Its automations: a dot on their view where one paused itself; and what its cards in the conversation do.
  const automations = useAutomations(projectId)
  const automationActions = useAutomationActions(projectId)
  /** An automation, opened as its own page in Automations. */
  const openAutomation = (id: string) => {
    setAutomation(id)
    setRoom(Room.Automations)
  }
  const front = (
    <Front
      lanes={lanes}
      name={kept.name ?? name}
      seed={projectId}
      ink={kitInk(kept.ink ?? model.project?.ink ?? 'clay')}
      yours={yours}
      {...(lanes === null ? {} : { needs: needsOf(lanes, agentName, onTask), inProgress: lanes.atWork })}
      onYours={openYours}
      parts={partsOf({
        repositories: model.repositories,
        names: model.project?.repositories ?? [],
        host,
        trackers,
        open: (url) => window.open(url, '_blank'),
      })}
      // What the project runs, with no agent, on its default branch (ADR-044).
      {...(coordinator === null
        ? {}
        : {
            run: (
              <Runs
                projectId={projectId}
                project={kept.name ?? name}
                taskId={null}
                runnables={coordinator.runnables}
                launches={coordinator.launches}
                now={now}
                onRun={(id) => void model.runProject(null, id)}
                onStop={(id) => void model.stopLaunch(id)}
              />
            ),
          })}
    />
  )

  return (
    <div className={s.window}>
      <ProjectBar room={room} onRoom={setRoom} settingsNeedYou={settingsNeedYou} automationsNeedYou={automations.needsYou} />
      {front}
      {room === Room.Automations ? (
        <AutomationsView
          projectId={projectId}
          project={kept.name ?? name}
          agents={model.agents}
          lead={usualLead(coordinator?.items ?? [], model.agents)}
          open={automation}
          onOpen={setAutomation}
          onTask={onTask}
        />
      ) : room === Room.Settings ? (
        <div className={s.settings}>
          <ProjectSettingsPage
            projectId={projectId}
            model={kept}
            section={section}
            onSection={setSection}
            connections={connections}
            trackers={trackers}
            repositories={model.repositories}
            connectionsNeedYou={settingsNeedYou}
            runnables={coordinator?.runnables ?? null}
            onConnections={settings.onConnections}
          />
        </div>
      ) : (
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
                <TaskFace
                  className={s.face}
                  composer={composer}
                  // Beside the board, the conversation has no room to share: what it opens goes over the board instead.
                  {...(room === Room.Both ? {} : { panel: shown.workbench(null), panelWidth: shown.bench.width })}
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
                    {coordinator.items.length === 0 && model.streaming.size === 0 && <p className={s.quiet}>{text.empty(name)}</p>}
                    {/* The coordinator only reads: what it hands back is pictures, which open in the lightbox; it writes no documents. */}
                    <ThreadShellProvider value={shown.shell}>
                      <ThreadBlocks
                        blocks={blocksOf(
                          {
                            items: coordinator.items,
                            turnRunning: busy,
                            turnStarted: session?.turnStartedAt ?? null,
                            reading: readingNow(session, model.pending),
                            turnEnded: session?.turnEndedAt ?? null,
                            worktree: null,
                            queue,
                            outputs: model.outputs,
                          },
                          model.streaming,
                          (iso) => ago(iso),
                          now,
                        )}
                        threadId={coordinator.threadId}
                        session={session}
                        {...(busy ? {} : { onTryAgain: () => void model.tryAgain() })}
                        card={(card) => <Card card={card} actions={actions} />}
                        draft={(draft) => <DraftCard draft={draft} actions={draftActions} />}
                        automation={(card, itemId) => (
                          <AutomationInThread
                            card={card}
                            itemId={itemId}
                            project={kept.name ?? name}
                            agents={model.agents}
                            actions={automationActions}
                            onOpen={openAutomation}
                          />
                        )}
                        changes={(changes) => <ChangesCard changes={changes} actions={changesActions} />}
                        run={(run) => (
                          <RunOf
                            run={run}
                            now={now}
                            onStop={(id) => void model.stopLaunch(id)}
                            onRunAgain={(taskId, runnableId) => void model.runProject(taskId, runnableId)}
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
          {/* Beside the board, a file the coordinator names opens over the board, against the conversation, dragged by its far edge. */}
          {room === Room.Both &&
            talking &&
            shown.workbench(null, {
              max: Math.max(360, window.innerWidth - both.width - 48),
              className: s.over,
              style: { left: both.width },
            })}
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
                    closing={closing}
                    actions={board}
                    line={board.line}
                    folds={folds}
                    onFoldsChange={setFolds}
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
      )}
    </div>
  )
}
