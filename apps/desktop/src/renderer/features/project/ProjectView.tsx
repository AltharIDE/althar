import { MessageMotion } from '../../shared/MessageMotion'
import { useSearchReveal } from '../finder/revealSearch'
import { useCoordinatorWanted } from '../../shared/openCoordinator'
import { reveal } from '../task/reveal'
import { EarlierTurns } from '../../shared/EarlierTurns'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { BoardTask, ThreadItem } from '@althar/contracts'

import {
  Behind,
  DictationTray,
  LinkButton,
  ResizeHandle,
  Room,
  TaskFace,
  Thread,
  ThreadMeasure,
  ThreadShellProvider,
  ThreadSkeleton,
  ProjectHeader,
  type Pane,
  keys,
  modKey,
  Problem,
} from '@althar/ui'

import { contextMeter } from '../../shared/ContextMeter'
import {
  asideCommandOf,
  commandsOf,
  commandText,
  compactCommandOf,
  coordinatorGoalOf,
  interruptCommandOf,
  modelCommandOf,
  pressOf,
} from '../../shared/composerCommands'
import { useModels } from '../../data/models'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { catalogRead } from '../finder/catalog'
import { CarriedOver } from '../../shared/dictation/Carried'
import { useDictation } from '../../shared/dictation/useDictation'
import { draftKey, draftOf as draftNow, setDraftDictated, useSetDraft } from '../../shared/drafts'
import { DraftComposer } from '../../shared/DraftComposer'
import { pillOf, runIdOf } from '../../shared/running'
import { queuedOf, queueShown, readingLocallyOf, readingNow, withQueued } from '../../shared/items'
import { ModelChoice } from '../../shared/ModelChoice'
import { useModelNames } from '../../shared/modelNames'
import { PartPending, pendingText } from '../../shared/Pending'
import { type Choice, runningOn, upcomingOn } from '../../shared/models'
import { usualLead } from '../automations/lead'
import { RunOf } from '../../shared/RunOf'
import { useHelpMeFix } from '../../shared/helpMeFix'
import { Runs } from '../runs/Runs'
import { LiveBlocks } from '../../shared/LiveBlocks'
import { NOTHING_HEARD } from '../../shared/heard'
import { Now } from '../../shared/Now'
import { MINUTE, SECOND } from '../../shared/time'
import { UnsentBringIn } from '../elsewhere/UnsentBringIn'
import { BoardWorkbench, ConversationFace, useThreadHost } from '../../shared/ThreadHost'
import { type Outgoing, outgoingOf, takesImages, useAttachments } from '../../shared/useAttachments'
import { PageOpenerProvider, useOpener } from '../browser/opener'
import { Foot } from '../foot/Foot'
import { useFootShown } from '../foot/shown'
import { pages, usePage } from '../browser/pages'
import { useDraftCanvasVersions } from '../canvases/draftVersions'
import { useCanvasArrivals } from '../canvases/arrivals'
import { ArtifactsView } from '../canvases/ArtifactsView'
import {
  composerComment,
  cropsOf,
  takeOff,
  takeComments,
  readingCommentCrops,
  useComments,
  withComments,
  canvasCommentsOf,
} from '../../shared/comments'
import { AutomationInThread } from '../automations/AutomationInThread'
import { AutomationsView } from '../automations/AutomationsView'
import { useAutomationActions, useAutomations } from '../automations/useAutomations'
import { BoardView } from '../board/BoardView'
import { TeamOf } from '../team/Team'
import type { SettingsWays } from '../settings/open'
import { useSendMidTurn } from '../settings/useSendMidTurn'
import { useFolds } from '../board/folds'
import { useClosePullRequests } from '../board/useClosePullRequests'
import { lanesOf, yoursOf } from '../board/lanes'
import { firstNeedOf, needsOf } from '../board/needs'
import type { BoardModel } from '../board/useBoard'
import type { ConnectionsModel } from '../connections/useConnections'
import { ProjectSettingsPage } from '../projectSettings/ProjectSettingsPage'
import { FIRST_PROJECT_SECTION, type ProjectSection } from '../projectSettings/sections'
import { connectionsNeedYou } from '../projectSettings/standing'
import { ForkOffer, useForkOffer } from '../repositories/ForkOffer'
import type { ProjectSettingsModel } from '../projectSettings/useProjectSettings'
import { kitInk } from '../../shared/inks'
import { Card, type CardActions } from './Card'
import { DraftingCard, useDraftingCards } from './DraftingCard'
import { planIt, usePlansAsked } from '../../shared/planIt'
import { useClearChat } from './ClearChat'
import { TaskAskOf } from './TaskAskOf'
import { FirstConnectionsView } from './FirstConnectionsView'
import {
  AsideConversation,
  AsideMoveFailed,
  AsideQuote,
  AsidesBar,
  passagesOf,
  AskInAside,
  asidesText,
  COORDINATOR,
  opensInPlace,
  useAsideMoves,
  useAsides,
  withOpenAside,
} from './Asides'
import { showingAside } from './asked'
import { coordinatorSigned } from '../../shared/signed'
import { ChangesCard, type ChangesActions } from '../../shared/ChangesCard'
import { DraftCard, type DraftActions } from '../../shared/DraftCard'
import { partsOf, tasksOf, trackersOf, trackersWithBinding } from './front'
import { type HomeRoom, isHome, shownOf, toggled } from './rooms'
import s from './Project.module.css'
import type { ProjectModel } from './useProject'
import { turnsById } from '../../shared/turnTime'
import { ReadFailed } from '../../shared/ReadFailed'
import { setLoadPeek } from '../../shared/loadPeek'
import { usePreferences } from '../../shared/usePreferences'

/*
 * A project: its header across the top, the bar a task has, then its home:
 * the conversation with its coordinator, the board of its work, or both side
 * by side, the conversation as wide as the person drags it and on whichever
 * side they put it (⋯'s Layout in its header; c and b, rooms.ts). With
 * the conversation hidden, its composer stays under the board, and what is
 * sent there brings the conversation back for the answer. Or its automations,
 * its artifacts or its settings, in the home's place, a violet dot on
 * Automations where one paused itself, and on Settings where a connection
 * waits on the person. The header says how the project stands (what needs
 * you: pointed at, what it is; clicked, the first of it), holds its views,
 * runs it, and lists what it is made of under ⋯.
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
  placeholder: 'Tell the coordinator something',
  /** Another agent's model, picked: nothing happens until the person says something. */
  handingOver: (to: string, from: string) => `${to} takes over from ${from} when you send.`,
  keep: (from: string) => `Keep ${from}`,
  queued: 'Queued',
  queue: (n: number) => (n === 1 ? 'Queued' : `${n} queued`),
  placeholderBusy: 'Add to the queue, or interrupt the coordinator',
  placeholderBusySteer: 'Steer the coordinator, or add to the queue',
  /** Whose usage the composer's ring says, under the context. */
  usageHeading: 'Today',
  signedOut: (agent: string, instead: string) => `${agent} isn't signed in. Using ${instead}.`,
  signIn: 'Sign in again',
  needsAgent: 'No agent is signed in.',
  signOneIn: 'Sign one in',
  dismiss: 'Dismiss',
  boardFailed: 'Althar couldn’t read the board.',
  olderFailed: 'Althar couldn’t load older tasks.',
  boardReading: 'Reading the board',
  width: 'Width of the conversation',
}

/** The class names given, those that apply. */
const classes = (...names: ReadonlyArray<string | false | undefined>) => names.filter(Boolean).join(' ')

/** Which side of the board the conversation is on, as the person last put it: this window's own, kept across launches. */
const SWAPPED = 'althar.swapped'

const storedSwapped = (): boolean => {
  try {
    return window.localStorage.getItem(SWAPPED) === 'true'
  } catch {
    return false
  }
}

/** The conversation on the right of the board, or not; kept as it changes. */
const useSwapped = () => {
  const [swapped, setSwapped] = useState(storedSwapped)
  const swap = () =>
    setSwapped((was) => {
      try {
        window.localStorage.setItem(SWAPPED, String(!was))
      } catch {
        // Not kept across launches; it still holds for this window.
      }
      return !was
    })
  return [swapped, swap] as const
}

/**
 * How wide the conversation is beside the board, as the person last dragged it: this window's own, kept across launches.
 * `lane` is the least of the board worth leaving beside a file open over it.
 */
const WIDTH = { key: 'althar.both', start: 560, min: 340, board: 480, lane: 240 } as const

/** No tasks, the same list each time. */
const NO_TASKS: ReadonlyArray<BoardTask> = []

/*
 * The width last kept in this window where storage wouldn't take it: the column goes with a switch of room, and back
 * it is as the person left it all the same. Null where storage holds it.
 */
let held: number | null = null

const storedWidth = (): number => {
  if (held !== null) return held
  try {
    const kept = Number(window.localStorage.getItem(WIDTH.key))
    return Number.isFinite(kept) && kept >= WIDTH.min ? kept : WIDTH.start
  } catch {
    return WIDTH.start
  }
}

/** The conversation's width beside the board: dragged, kept once a move ends, and never so wide the board has no room; `room`, the window's. */
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
      held = null
    } catch {
      // Not kept across launches; it still holds for this window.
      held = next
    }
  }
  return { width: Math.min(width, max), min: WIDTH.min, max, room, set: setWidth, keep, reset: () => keep(WIDTH.start) }
}

/**
 * The conversation's column, and beside the board its divider and what opens over the board against it. The width is
 * its own so dragging redraws only the column and the workbench beside it.
 */
function TalkColumn({ beside, swapped, children }: { beside: boolean; swapped: boolean; children: ReactNode }) {
  const both = useBothWidth()
  const column = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const board = useMemo(
    () =>
      beside && target !== null
        ? {
            target,
            over: {
              room: both.room - both.width,
              keep: WIDTH.lane,
              edge: swapped ? ('start' as const) : ('end' as const),
              className: classes(s.over, swapped && s.overLeft),
              style: swapped ? { right: both.width } : { left: both.width },
            },
          }
        : null,
    [beside, target, both.room, both.width, swapped],
  )
  return (
    <>
      <div ref={column} className={s.talk} style={beside ? { width: both.width } : undefined}>
        <BoardWorkbench.Provider value={board}>{children}</BoardWorkbench.Provider>
        {beside && (
          <ResizeHandle
            value={both.width}
            min={both.min}
            max={both.max}
            onChange={both.set}
            onCommit={both.keep}
            onReset={both.reset}
            onResizing={(on) => column.current?.toggleAttribute('data-resizing', on)}
            label={text.width}
            edge={swapped ? 'start' : 'end'}
          />
        )}
      </div>
      {beside && <div ref={setTarget} style={{ display: 'contents' }} />}
    </>
  )
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

/** No items, the same each time, while the coordinator's thread isn't read yet. */
const NO_DRAFTED_ITEMS: ReadonlyArray<ThreadItem> = []
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
  ways,
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
  /** Where in Althar's settings an error is put right: an agent's sign-in, or the agents. */
  ways?: SettingsWays
}) {
  const [room, setRoom] = useState<Room>(asked ?? Room.Both)
  // Whether the bar shows this computer's load: Up next's line over what is held back opens it there.
  const { preferences } = usePreferences()
  // The home as it was last laid out, for coming back to it from another view.
  const [home, setHome] = useState<HomeRoom>(asked !== undefined && isHome(asked) ? asked : Room.Both)
  if (isHome(room) && room !== home) setHome(room)
  const [swapped, swap] = useSwapped()
  const [footShown, setFootShown] = useFootShown()
  const panes = shownOf(room)
  const both = panes.talk && panes.board
  const coordinatorFace = useRef<HTMLDivElement>(null)
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
  // The lanes the person collapsed, kept for every project, apart beside the conversation.
  const [folds, setFolds] = useFolds(both ? 'beside' : 'alone')
  // The board as the person's moves on asides leave it, at once: one cleared gone, one made a task on it as work (`useAsideMoves`).
  const asideMoves = useAsideMoves(useServices().client, board.board, model.project?.id ?? model.coordinator?.project.id ?? null)
  const seen = asideMoves.over
  // The same lanes while the board and what merges stay as they were: the board's cards are measured, and drawn, only then.
  // Beside the conversation, its asides are there; the board alone keeps them behind its chip.
  const talkShown = shownOf(room).talk
  const { lanes, boardLanes } = useMemo(() => {
    const all = seen === null ? null : lanesOf(seen, board.merging, board.queuing)
    return { lanes: all, boardLanes: all === null || !talkShown ? all : { ...all, scratch: NO_TASKS } }
  }, [seen, board.merging, board.queuing, talkShown])
  const yours = lanes === null ? 0 : yoursOf(lanes)
  // An abandoned task's pull request left open, closed from its row.
  const closing = useClosePullRequests()
  /** A pane shown or hidden, from ⋯ or its key. */
  const togglePane = useCallback((pane: Pane) => setRoom((was) => toggled(was, home, pane)), [home])
  // c and b toggle the conversation and the board, t the terminal bar, when nothing is being typed; ⌘ and a number belongs to the window's tabs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.key !== 'b' && event.key !== 'c' && event.key !== 't') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="dialog"]') !== null)
      )
        return
      event.preventDefault()
      if (event.key === 't') setFootShown(!footShown)
      else togglePane(event.key === 'c' ? 'talk' : 'board')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePane, footShown, setFootShown])
  // What the person writes to the coordinator, kept by the project while they are elsewhere, as are its images and what they dictate.
  const about = model.project?.id ?? model.coordinator?.project.id ?? null
  // Titles already in the bar are found at once. Only matching passages in
  // this project come back from the store as the person types.
  const [asideSearch, setAsideSearch] = useState('')
  const catalogClient = useServices().client
  const asideWords = asideSearch.trim()
  const said = useQuery(
    catalogRead(
      catalogClient,
      { text: asideWords, kinds: ['said'], ...(about === null ? {} : { projectId: about }) },
      about !== null && asideWords !== '',
    ),
  ).data?.documents
  const passages = useMemo(() => (said === undefined ? undefined : passagesOf(said, about)), [said, about])
  const draftOf = draftKey.coordinator(about ?? '')
  // The words themselves are its composer's to show (DraftComposer): a word typed doesn't draw the project again.
  const setDraft = useSetDraft(draftOf)
  // A page beside the coordinator's conversation (ADR-100): the project goes to its conversation, the board stepping aside for it.
  // The room it stepped aside from is kept with the page, in the window's storage, so closing the page brings the board back even after a reload.
  const beforeKey = `althar.before.${about ?? ''}`
  const rememberRoom = useCallback(
    (was: Room) => {
      if (was === Room.Talk || about === null) return
      try {
        window.localStorage.setItem(beforeKey, String(was))
      } catch {
        // Kept for nothing.
      }
    },
    [about, beforeKey],
  )
  const showTalk = useCallback(() => setRoom(Room.Talk), [])
  const showTalkForPage = useCallback(() => {
    setRoom((was) => {
      rememberRoom(was)
      return Room.Talk
    })
  }, [rememberRoom])
  const latestSearch = useRef(model)
  latestSearch.current = model
  useSearchReveal(model.coordinator?.threadId, (itemId) => {
    showTalk()
    void reveal(itemId, async () => {
      const now = latestSearch.current
      if (!now.coordinator?.earlier) return false
      await now.loadEarlier()
      return true
    })
  })
  const opener = useOpener(about, showTalkForPage)
  const { where: pageWhere } = usePage(about, useServices().host.pages)
  const wasBeside = useRef(false)
  useEffect(() => {
    // Only a page that was beside the conversation and went is a close; a view that opens with none is not.
    const closed = wasBeside.current && pageWhere !== 'beside'
    wasBeside.current = pageWhere === 'beside'
    if (!closed) return
    // The page went from beside the conversation: the right side returns to what was there before it opened.
    // A page its window's storage kept, main yet to say it still has it, isn't closed.
    if (about !== null && pages.waking(about)) return
    let back: Room | null = null
    try {
      const kept = window.localStorage.getItem(beforeKey)
      window.localStorage.removeItem(beforeKey)
      back = kept === String(Room.Both) ? Room.Both : kept === String(Room.Board) ? Room.Board : null
    } catch {
      // Nothing kept.
    }
    if (back !== null && pageWhere === null) setRoom((now) => (now === Room.Talk ? (back as Room) : now))
  }, [pageWhere, beforeKey, about])
  const navigate = useNavigate()
  const comments = useComments(draftOf)
  useDraftCanvasVersions(draftOf, comments)
  // A picture the coordinator handed back opens in the lightbox; it writes no documents, so none opens beside it.
  // What the coordinator's thread opens: a picture in the lightbox, a file it names beside the thread, a page.
  const shown = useThreadHost(
    false,
    { threadId: model.coordinator?.threadId ?? null, taskId: null },
    about === null
      ? null
      : {
          owner: about,
          kind: 'project',
          draft: draftOf,
          opener,
          onDock: () => {
            pages.place(about, 'tab', { kind: 'project', projectId: about, draft: draftOf })
            void navigate({ to: '/pages/$owner', params: { owner: about } })
          },
        },
  )
  // A canvas the coordinator publishes or opens beside its conversation opens on the workbench as it arrives (ADR-104).
  useCanvasArrivals(model.coordinator?.items, shown.openCanvas)
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
  // A model or effort of the coordinator's own agent, picked and not yet taken by the runtime.
  const [moving, setMoving] = useState<Choice | null>(null)
  // Another agent's model, picked while the coordinator runs: it takes over with what the person says next.
  const [handover, setHandover] = useState<Choice | null>(null)
  const coordinator = model.coordinator
  // The tasks the coordinator is drafting, each as its card fills in, in its card's place in the thread once it is a task.
  const drafting = useDraftingCards(coordinator?.threadId ?? null, model.drafts, coordinator?.items ?? NO_DRAFTED_ITEMS, model.holdDraft)
  // Every run in the project, the tasks' too: Run's list and its switcher say them.
  const launches = coordinator?.launches ?? []
  // Those of no task are the project's own; a task's show over its own composer.
  const projectRuns = launches.filter((launch) => launch.taskId === null)
  const offer = useForkOffer(about ?? '', model.repositories)
  // A running turn says how long it has worked so far; a plan on its countdown, when it starts; a run, how long it has been up.
  // Each place that says so ticks by itself (Now): the project isn't drawn again each second.
  const ticking =
    (coordinator?.session?.turnRunning ?? false) ||
    // While what the person sent is on its way, or the coordinator starts for it, how long they have waited.
    model.pending ||
    coordinator?.session?.state === 'starting' ||
    (lanes?.next.some((task) => task.phase === 'planned') ?? false) ||
    launches.some((launch) => launch.ended === null)
  const host = coordinator?.host ?? null
  const named = useModelNames()
  const session = coordinator?.session ?? null
  const suggested = coordinator?.suggested ?? null
  const busy = session?.turnRunning ?? false
  // "Help me fix it" on a failed run: a prompt for the composer, unsent.
  const helpMe = useHelpMeFix(draftOf, busy, voice.inputRef)
  const steers = useSendMidTurn()?.to === 'steer'
  const queue = queueShown(session, model.pending, coordinator?.accepting, coordinator?.items)
  // What the coordinator's thread is drawn from, kept while its items and its turn are: its words streaming, its commands
  // printing and its clock ticking draw the thread alone (LiveBlocks), not the project.
  const coordinatorItems = coordinator?.items
  // With a stand-in for each draft that is a task, its card not read yet, where it will be.
  const draftedItems = drafting.placed
  const turnStarted = session?.turnStartedAt ?? null
  const turnEnded = session?.turnEndedAt ?? null
  const reading = readingNow(session, model.pending, false, coordinator?.accepting)
  const readingLocally = readingLocallyOf(session, coordinator?.accepting)
  const turns = coordinator?.turns
  const coordinatorSource = useMemo(
    () =>
      coordinatorItems === undefined
        ? null
        : {
            items: draftedItems,
            turnRunning: busy,
            turnStarted,
            reading,
            readingLocally,
            turnEnded,
            worktree: null,
            queue,
            turns: turnsById(turns),
          },
    [coordinatorItems, draftedItems, busy, turnStarted, reading, readingLocally, turnEnded, queue, turns],
  )
  const agentName = (id: string | null) =>
    model.agents.find((agent) => agent.id === id)?.name ?? (id === session?.agentId ? session.agentName : (id ?? ''))
  // Whatever it ran on last, while that agent can; otherwise the first that can.
  const first = model.agents[0]
  const waiting = session === null || !session.held || handover?.agentId === session.agentId ? null : handover
  // Another session takes it over after the one going out let it go: the picker says who leads as that one will.
  const taking = session !== null && !session.held && session.handover === true ? upcomingOn(session) : null
  const chosen: Choice | null =
    waiting ??
    (session === null
      ? null
      : session.held
        ? ((moving === null ? null : { ...moving, agentId: session.agentId }) ?? upcomingOn(session) ?? runningOn(session))
        : taking === null
          ? null
          : ((moving === null ? null : { ...moving, agentId: taking.agentId }) ?? taking)) ??
    pick ??
    (suggested?.available === true ? { agentId: suggested.agentId, model: suggested.model, effort: suggested.effort } : null) ??
    (first === undefined ? null : { agentId: first.id, model: null, effort: null })
  // What the coordinator's pane shows: its conversation, an aside, or a new one, started as + is pressed on the lead picked here.
  const asides = useAsides({
    client: useServices().client,
    cache: useServices().cache,
    projectId: about,
    lead:
      chosen === null ? null : { key: 'implement', agentId: chosen.agentId, model: chosen.model, effort: chosen.effort, skipped: false },
    scratch: lanes?.scratch ?? NO_TASKS,
    tasks: seen?.tasks ?? NO_TASKS,
    moves: asideMoves,
  })
  const aside = asides.open
  // Its prompts (a computer-use permission) show here while the conversation does, so the window need not go to the thread.
  const asideThread = aside.kind === 'coordinator' ? null : aside.threadId
  useEffect(() => (asideThread !== null && talkShown ? showingAside(asideThread) : undefined), [asideThread, talkShown])
  // Words put in the coordinator's composer from elsewhere (Run's Ask): its own conversation shows, over any aside.
  useCoordinatorWanted(about, () => {
    asides.back()
    setRoom(Room.Talk)
  })
  // A new aside's thread: what the coordinator's composer quotes into it, with no turn of its own yet.
  const asideItems = asides.items
  const newAside = useMemo(() => ({ items: asideItems, turnRunning: false, worktree: null }), [asideItems])
  // Who the composer tells: the conversation open, or, under the board with the conversation hidden, the coordinator always,
  // whatever aside was open; sending from there brings the coordinator's conversation back for the answer.
  const docked = !panes.talk
  const talkingTo = docked ? COORDINATOR : aside
  // What the composer's picker shows and sets: a new aside's own lead while one is open, else the coordinator's.
  const picking: Choice | null =
    docked || asides.lead === null ? chosen : { agentId: asides.lead.agentId, model: asides.lead.model, effort: asides.lead.effort ?? null }
  const name = model.project?.name ?? coordinator?.project.name ?? text.project
  // The presets a plan can start from, this project's own with them: what the plan card's kicker lists.
  const { client } = useServices()
  const presets = useQuery({
    queryKey: ['presets', about ?? null],
    queryFn: () => client.listPresets(about ?? undefined),
  }).data

  // The team of a task, open from its row up next or from a small change's card, while it can still change.
  const [teamFor, setTeamFor] = useState<string | null>(null)
  // Drafts whose plan the person asked for, each until its ask is over (`usePlansAsked`).
  const plansAsked = usePlansAsked(coordinator?.items ?? NO_DRAFTED_ITEMS, session)
  const actions: CardActions = {
    project: name,
    ...(about === null ? {} : { projectId: about }),
    agents: model.agents,
    agentName,
    workers: model.workers,
    onStart: (planId, workerId) => model.startPlan(planId, workerId),
    onHold: (planId) => void model.holdPlan(planId),
    onPlace: (planId, workerId, chosenAt) => model.placePlan(planId, workerId, chosenAt),
    onStopWaiting: (taskId, on) => model.stopWaiting(taskId, on),
    onReopen: (taskId) => void model.reopenTask(taskId),
    onChange: (planId, steps, end, worksIn, toward) => model.changePlan(planId, steps, end, worksIn, toward),
    onCreateBranch: (planId, steps, end, repositoryId, branch) =>
      void model.changePlanToNewBranch(planId, steps, end, repositoryId, branch),
    onOpen: onTask,
    // An aside opens where its pill does, over the coordinator's conversation, waiting on the person or not; one that left
    // Scratch, or was cleared, opens as a task.
    onOpenAside: (taskId, threadId) =>
      (seen?.tasks ?? NO_TASKS).some((one) => one.taskId === taskId && opensInPlace(one)) ? asides.pick(taskId) : onTask(threadId),
    onChangeTeam: setTeamFor,
    onStopBackground: (threadId, id) => void model.stopBackground(threadId, id),
    // A draft whose plan didn't come: the coordinator is asked for it, in the person's words, which show in the thread at once.
    onPlanDraft: (task) => {
      plansAsked.ask(task)
      void model
        .say(planIt(task), null)
        .then((sent) => {
          if (!sent) plansAsked.unask(task.taskId)
        })
        .catch(() => plansAsked.unask(task.taskId))
    },
    planAsked: plansAsked.asked,
    onDiscard: (taskId) => model.discardTask(taskId),
    // Every waiting card has the same holders, so only the newest says them.
    holdersOn: newestWaiting(coordinator?.items ?? []),
    ...(presets === undefined
      ? {}
      : {
          presets: presets.map((one) => ({ name: one.name, about: one.about, reviews: one.parts.reviews === true })),
          onPreset: (planId: string, preset: string) => void model.applyPreset(planId, preset),
        }),
  }
  const draftActions: DraftActions = {
    onFile: (draftId) => void model.fileIssueDraft(draftId),
    onChange: (draftId, edit) => model.changeIssueDraft(draftId, edit),
    onDiscard: (draftId) => void model.discardIssueDraft(draftId),
    onPrefer: (atOnce) => void model.preferIssueCards(atOnce),
  }
  const changesActions: ChangesActions = {
    onApply: (changesId) => void model.applyIssueChanges(changesId),
    onDiscard: (changesId) => void model.discardIssueChanges(changesId),
    onPrefer: (atOnce) => void model.preferIssueCards(atOnce),
  }

  // The agent what the person says goes to, and whether it takes images.
  const receiver = { name: agentName(picking?.agentId ?? null), takes: takesImages(models, picking?.agentId ?? null) }
  const clearing = useClearChat(model)
  /** The person's first words in a new aside, sent to it, which opens; the words come back where they couldn't go. */
  const startAside = (body: string) => {
    if (body.trim() === '') return
    setDraft('')
    void asides.say(body).then(
      (went) => {
        if (!went) setDraft((current) => (current === '' ? body : current))
      },
      (error: unknown) => {
        // The words come back, and the line over the composer says why.
        setDraft((current) => (current === '' ? body : current))
        asideMoves.startFailed(error)
      },
    )
  }
  /*
   * /aside with words from the coordinator's composer: a new aside opens, and the words are its first, as + and then typing
   * them would do; they wait here until it is open.
   */
  const asideFirst = useRef<string | null>(null)
  const startAsideFrom = (words: string) => {
    asideFirst.current = words
    asides.begin(null)
  }
  const opened = talkingTo.kind
  useEffect(() => {
    const words = asideFirst.current
    if (opened !== 'new' || words === null) return
    asideFirst.current = null
    startAside(words)
  })
  const send = (body: string, now: boolean) => {
    // Asking to clear the chat is not said to the coordinator.
    if (clearing.command(body)) {
      setDraft('')
      return
    }
    // A new aside: the coordinator's composer starts it, with what it quotes, and it opens.
    if (talkingTo.kind === 'new') {
      startAside(body)
      return
    }
    // Images that can't go yet hold the message back, and the composer says why.
    const pictures = receiver.takes !== false
    const own = images.take(receiver, pictures && readingCommentCrops(draftOf))
    if (own === null) return
    const batch = takeComments(draftOf)
    setDraft('')
    images.clear()
    const picked = waiting
    if (picked !== null) setHandover(null)
    // Sent from under the board, the coordinator's conversation comes back for the answer.
    if (docked) {
      asides.back()
      togglePane('talk')
    }
    const gathered = batch.taken
    const crops = pictures ? cropsOf(gathered) : { sent: [], pictures: [] }
    const outgoing: Outgoing = {
      ...own,
      sent: [...own.sent, ...crops.sent],
      pictures: [...own.pictures, ...crops.pictures],
      canvasComments: canvasCommentsOf(gathered),
      onAccepted: () => batch.finish(true),
    }
    const words = withComments(body, gathered, own.sent.length, pictures)
    const restore = () => {
      batch.finish(false)
      setDraft((current) => withQueued(current, body))
      images.giveBack(own)
      if (picked !== null) setHandover(picked)
    }
    const said =
      picked !== null ? model.handOver(picked, words, outgoing) : now ? model.sayNow(words, outgoing) : model.say(words, chosen, outgoing)
    void said.then((accepted) => {
      if (accepted) batch.finish(true)
      else restore()
    }, restore)
  }
  // Picking changes nothing that runs: the same agent's model or effort is set for its next turn, another agent waits for what the person says.
  const choose = (next: Choice) => {
    if (session === null || !session.held) return setPick(next)
    if (next.agentId !== session.agentId) return setHandover(next)
    setHandover(null)
    setMoving(next)
    // Only the last pick's end takes the choice shown away: one made after is still on its way.
    void model.choose(next).then(() => setMoving((now) => (now === next ? null : now)))
  }
  // A queued message goes back in the composer to be changed, and out of the queue, unless the coordinator has it already.
  // Out of the queue and in the composer at once; one the coordinator had already read comes back where it was, said why,
  // and the composer goes back to what it held, unless written in since.
  const edit = (id: string) => {
    const said = queuedOf(coordinator?.items ?? [], queue, readingLocally).find((message) => message.id === id)
    // One whose images wouldn't fit beside those waiting stays in the queue, and the composer says why.
    if (said === undefined || !images.fits(said)) return
    let was: string | null = null
    let put: string | null = null
    // Taken back where the lead had it already: the words, images, files and whether it was dictated, as the composer held them.
    let unrestore: () => void = () => undefined
    const dictatedBefore = draftNow(draftOf).dictated
    const refused = () => {
      setDraft((current) => (current === put && was !== null ? was : current))
      unrestore()
      setDraftDictated(draftOf, dictatedBefore)
    }
    if (!model.takeBack(id, refused)) return
    setDraft((current) => {
      was = current
      put = withQueued(current, said.text)
      return put
    })
    if (said.dictated === true) setDraftDictated(draftOf, true)
    unrestore = images.restore(said)
  }

  // A queued message goes to the coordinator now, interrupting it, rather than when it is done: out of the queue, and said
  // again, at once. One it has already read stays as it was; one Althar didn't take goes back in the composer.
  const sendQueuedNow = (id: string) => {
    const said = queuedOf(coordinator?.items ?? [], queue, readingLocally).find((message) => message.id === id)
    if (said === undefined) return
    model.sayQueuedNow(id, said.text, outgoingOf(said), () => {
      setDraft((current) => withQueued(current, said.text))
      if (said.dictated === true) setDraftDictated(draftOf, true)
      images.restore(said)
    })
  }

  const line: ReactNode =
    waiting !== null && session !== null ? (
      <>
        {text.handingOver(named(waiting.agentId, waiting.model).name, named(session.agentId, session.model).name)}{' '}
        <LinkButton onClick={() => setHandover(null)}>{text.keep(named(session.agentId, session.model).name)}</LinkButton>
      </>
    ) : (session === null || !session.held) && model.agentsKnown && model.agents.length === 0 ? (
      <>
        {text.needsAgent} {ways !== undefined && <LinkButton onClick={() => ways.agents()}>{text.signOneIn}</LinkButton>}
      </>
    ) : (session === null || !session.held) && model.agentsKnown && suggested !== null && !suggested.available && chosen !== null ? (
      <>
        {text.signedOut(suggested.agentName, agentName(chosen.agentId))}{' '}
        {ways !== undefined && <LinkButton onClick={() => ways.signIn(suggested.agentId)}>{text.signIn}</LinkButton>}
      </>
    ) : null

  // What a slash in the coordinator's composer offers; a new aside's is only its first words. A goal is said to it, for a task.
  const commands =
    talkingTo.kind === 'new'
      ? []
      : commandsOf(
          asideCommandOf((words) => startAsideFrom(words)),
          coordinatorGoalOf((body) => send(body, false)),
          model.agents.length > 0 &&
            picking !== null &&
            modelCommandOf(models, text.coordinator.toLowerCase(), model.agents, picking, choose),
          compactCommandOf(session, () => void model.compact()),
          interruptCommandOf(busy, text.coordinator.toLowerCase(), () => void model.interrupt()),
          clearing.ask !== null && pressOf('clear', commandText.clear.does, 'remove', clearing.ask),
        )

  const composer = (
    <div className={s.composer}>
      <DraftComposer
        draft={draftOf}
        commands={commands}
        {...(helpMe.suggestion === undefined ? {} : { suggestion: helpMe.suggestion })}
        inputRef={voice.inputRef}
        dictation={voice.dictation}
        tray={voice.tray && <DictationTray {...voice.tray} />}
        carried={<CarriedOver here={draftOf} />}
        // The lines about who answers go on the composer's edge, so a running launch's chip and they never overlap.
        notice={
          model.error !== null || line !== null || asideMoves.failed !== null ? (
            <>
              <AsideMoveFailed moves={asideMoves} className={s.failure} />
              {model.error !== null && (
                <Problem as="div" className={s.failure} action={<LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>}>
                  {model.error}
                </Problem>
              )}
              {line !== null && <div>{line}</div>}
            </>
          ) : null
        }
        // The project's own runs, the ones of no task, as the task's chip says its own (ADR-096).
        above={
          talkingTo.kind === 'new'
            ? talkingTo.quote !== null && <AsideQuote quote={talkingTo.quote} onDrop={asides.dropQuote} />
            : (offer.offering !== null || projectRuns.some((launch) => launch.ended === null)) && (
                <>
                  {offer.offering !== null && <ForkOffer offer={offer} />}
                  <Now ticking={ticking}>
                    {(now) => (
                      <Behind
                        processes={pillOf([], projectRuns, now, { where: true })}
                        onStop={(id) => {
                          const run = runIdOf(id)
                          if (run !== null) void model.stopLaunch(run)
                        }}
                        onOpenUrl={(id) => {
                          const url = projectRuns.find((launch) => launch.id === runIdOf(id))?.url
                          // Beside the coordinator's conversation, the board stepping aside for it.
                          if (url != null) opener.run(url)
                        }}
                      />
                    )}
                  </Now>
                </>
              )
        }
        onSubmit={(body) => send(body, false)}
        onSendNow={(body) => send(body, true)}
        steer={steers}
        {...images.props(receiver)}
        comments={comments.map((comment, index) => composerComment(comment, index + 1))}
        onOpenComment={(id) => {
          if (about === null) return
          const spot = comments.find((one) => one.id === id)?.on
          setRoom((was) => {
            rememberRoom(was)
            return Room.Talk
          })
          if (spot?.kind === 'canvas') shown.openCanvas(spot.canvasId, spot.version, false)
          if (spot?.kind === 'page') {
            pages.place(about, 'beside')
            pages.reopen(about, id)
          }
        }}
        onRemoveComment={(id) => takeOff(draftOf, id)}
        {...(busy && talkingTo.kind !== 'new' ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy && talkingTo.kind !== 'new'}
        queued={talkingTo.kind === 'new' ? [] : queuedOf(coordinator?.items ?? [], queue, readingLocally)}
        onEditQueued={edit}
        onSendQueuedNow={sendQueuedNow}
        onUnqueue={(id) => void model.takeBack(id)}
        text={{ queued: text.queue, sendNowKey: modKey(keys.return) }}
        placeholder={
          talkingTo.kind === 'new'
            ? talkingTo.quote === null
              ? asidesText.newPlaceholder
              : asidesText.quotePlaceholder
            : busy
              ? steers
                ? text.placeholderBusySteer
                : text.placeholderBusy
              : text.placeholder
        }
        // A new aside has used nothing of the coordinator's context.
        {...(talkingTo.kind === 'new'
          ? {}
          : {
              meter: contextMeter(session, named, model.compact, { usage: coordinator?.usage, heading: text.usageHeading }, clearing.ring),
            })}
        picker={
          model.agents.length > 0 &&
          picking !== null && (
            <ModelChoice
              owner={talkingTo.kind === 'new' ? asidesText.lead : text.coordinator}
              agents={model.agents}
              {...(about === null ? {} : { projectId: about })}
              value={picking}
              // A new aside's pick is its own: the coordinator's model, effort or agent stays as it was.
              onChange={talkingTo.kind === 'new' ? (next) => asides.choose({ key: 'implement', ...next, skipped: false }) : choose}
            />
          )
        }
      />
    </div>
  )

  /** Into the coordinator's composer, from an empty board: beside it, or under it where the conversation is hidden. */
  const talkToCoordinator = () => requestAnimationFrame(() => voice.inputRef.current?.focus())
  /** The first thing that waits on you, in its task. */
  const openYours = () => {
    const first = lanes === null ? null : firstNeedOf(lanes)
    if (first !== null) onTask(first)
  }

  // The header: its name and ink as the person last chose them, how it stands, its views, and what it is made of.
  const projectId = model.project?.id ?? coordinator?.project.id ?? ''
  const kept = settings.model
  const read = reads(useServices().client)
  const binding = useQuery(read.projectTracker(projectId)).data ?? null
  const teams = useQuery({
    ...read.containers(binding?.connectionId ?? ''),
    enabled: binding?.container != null && binding.gone == null,
  }).data
  const containerKey = teams?.find((team) => team.id === binding?.container?.id)?.key ?? null
  const trackers = trackersWithBinding(
    lanes === null ? [] : trackersOf(tasksOf(lanes), connections.list),
    binding,
    connections.list,
    containerKey,
  )
  const settingsNeedYou = connectionsNeedYou(model.repositories, trackers, connections.list)
  // Its automations: a dot on their view where one paused itself; and what its cards in the conversation do.
  const automations = useAutomations(projectId)
  const automationActions = useAutomationActions(projectId)
  /** An automation, opened as its own page in Automations. */
  const openAutomation = (id: string) => {
    setAutomation(id)
    setRoom(Room.Automations)
  }
  const header = (
    <ProjectHeader
      name={kept.name ?? name}
      seed={projectId}
      ink={kitInk(kept.ink ?? model.project?.ink ?? 'clay')}
      // Until the board is read, where it stands isn't said, rather than said wrong.
      {...(lanes === null ? {} : { yours, needs: needsOf(lanes, agentName, onTask), inProgress: lanes.atWork })}
      onYours={openYours}
      room={room}
      // Home is the home as it was last laid out.
      onRoom={(next) => setRoom(next === Room.Both ? home : next)}
      panes={{
        shown: panes,
        onToggle: togglePane,
        swapped,
        onSwap: swap,
        keys: { talk: 'c', board: 'b' },
        foot: { shown: footShown, onToggle: () => setFootShown(!footShown), key: 't' },
      }}
      settingsNeedYou={settingsNeedYou}
      automationsNeedYou={automations.needsYou}
      parts={partsOf({
        repositories: model.repositories,
        names: model.project?.repositories ?? [],
        host,
        trackers,
        open: (url) => window.open(url, '_blank'),
      })}
      // What the project runs, with no agent, where it is picked to (ADR-090).
      {...(coordinator === null
        ? {}
        : {
            run: (
              <Now ticking={ticking}>
                {(now) => (
                  <Runs
                    projectId={projectId}
                    project={kept.name ?? name}
                    taskId={null}
                    // Its tasks run in their worktrees: those under way with a branch, not a review, which runs nothing of what it reads.
                    tasks={
                      board.board?.tasks
                        .filter((task) => task.settledAt === null && task.branch !== null && task.reviewing == null)
                        .map((task) => ({ id: task.taskId, title: task.title })) ?? null
                    }
                    {...(ways === undefined ? {} : { onConnect: ways.connections })}
                    runnables={coordinator.runnables}
                    launches={coordinator.launches}
                    now={now}
                    onRun={(id, taskId) => model.runProject(taskId, id)}
                    onStop={(id) => void model.stopLaunch(id)}
                    onClear={(id) => void model.clearLaunch(id)}
                    onRunRef={model.runRef}
                  />
                )}
              </Now>
            ),
          })}
    />
  )

  return (
    <PageOpenerProvider value={opener}>
      <MessageMotion
        className={s.window}
        // What moves a message between the conversation and its composer, or what shows with the rooms: not a word typed or
        // streamed, nor a second ticking. The board's cards are its own (BoardView).
        version={[
          coordinator?.items,
          queue,
          model.pending,
          asides.items,
          room,
          panes.talk,
          panes.board,
          swapped,
          aside.kind === 'aside' ? aside.threadId : aside.kind,
          teamFor,
        ]}
      >
        {/* An artifact open in Artifacts takes the window as a task does: its row is in the project's place. */}
        {room === Room.Artifacts ? null : header}
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
        ) : room === Room.Artifacts ? (
          <ArtifactsView
            projectId={projectId}
            header={header}
            threadId={coordinator?.threadId ?? null}
            agents={model.agents}
            // An artifact's chat started there is answered as a new aside would be: by the coordinator's composer's pick.
            lead={
              chosen === null
                ? null
                : { key: 'implement', agentId: chosen.agentId, model: chosen.model, effort: chosen.effort, skipped: false }
            }
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
          <div className={classes(s.rooms, both && s.both, both && swapped && s.swapped)}>
            {panes.talk && (
              <TalkColumn beside={both} swapped={swapped}>
                {coordinator === null ? (
                  model.error === null ? (
                    <div className={s.reading}>
                      <ThreadMeasure>
                        <ThreadSkeleton label={pendingText.thread} />
                      </ThreadMeasure>
                    </div>
                  ) : (
                    <div className={s.loading}>
                      <ReadFailed error={model.error} />
                    </div>
                  )
                ) : (
                  <>
                    {/* The coordinator first, then its asides: the conversation says who it is with. */}
                    {lanes !== null && (
                      <Now ticking every={ticking ? SECOND : MINUTE}>
                        {(now) => (
                          <AsidesBar
                            scratch={withOpenAside(lanes.scratch, aside, seen?.tasks ?? NO_TASKS)}
                            open={aside}
                            first={asides.first}
                            title={asides.title}
                            onPick={asides.pick}
                            onNew={() => asides.begin(null)}
                            onClear={asides.clear}
                            board={seen?.tasks ?? []}
                            now={Date.parse(now)}
                            passages={passages}
                            onSearch={setAsideSearch}
                          />
                        )}
                      </Now>
                    )}
                    {aside.kind === 'aside' ? (
                      <AsideConversation
                        key={aside.threadId}
                        threadId={aside.threadId}
                        onBack={asides.back}
                        onOpenTask={onTask}
                        onMakeTask={asides.makeTask}
                        failed={asideMoves.failed === null ? null : <AsideMoveFailed moves={asideMoves} className={s.failure} />}
                      />
                    ) : aside.kind === 'new' ? (
                      <TaskFace className={s.face} composer={composer} under>
                        <Thread label={asidesText.newPlaceholder}>
                          <LiveBlocks
                            source={newAside}
                            streaming={NOTHING_HEARD}
                            outputs={NOTHING_HEARD}
                            ticking={false}
                            threadId={aside.threadId ?? aside.taskId}
                          />
                        </Thread>
                      </TaskFace>
                    ) : (
                      <div ref={coordinatorFace} className={s.coordinatorFace}>
                        <ConversationFace className={s.face} composer={composer} under host={shown}>
                          <Thread label={text.conversation} busy={busy}>
                            {/* A new project's first word: what its tasks will need later, while its conversation hasn't begun. */}
                            {coordinator.items.length === 0 && !coordinator.earlier && !coordinator.view.cleared && (
                              <FirstConnectionsView
                                projectId={projectId}
                                project={model.project?.name ?? coordinator.project.name}
                                model={connections}
                                className={s.firstConnections}
                              />
                            )}
                            <EarlierTurns
                              key={coordinator.threadId}
                              earlier={coordinator.earlier}
                              load={model.loadEarlier}
                              version={coordinator.items}
                              loading={model.loadingEarlier}
                            />
                            {clearing.line}
                            {/* The coordinator only reads: what it hands back is pictures, which open in the lightbox; it writes no documents. */}
                            <ThreadShellProvider value={shown.shell}>
                              <LiveBlocks
                                source={coordinatorSource ?? newAside}
                                streaming={model.streaming}
                                outputs={model.outputs}
                                ticking={ticking}
                                threadId={coordinator.threadId}
                                session={session}
                                retryable={coordinator.retryable}
                                {...(busy ? {} : { onTryAgain: () => void model.tryAgain(), onCompact: () => void model.compact() })}
                                {...(ways === undefined ? {} : { onSignIn: ways.signIn })}
                                card={(card) => {
                                  // Still being drafted: the live draft fills its card's place, until its plan is in.
                                  const draft = drafting.inPlace(card)
                                  return draft === undefined ? (
                                    <Card card={card} actions={actions} />
                                  ) : (
                                    <DraftingCard
                                      draft={draft}
                                      project={name}
                                      held={drafting.held(draft)}
                                      onHold={() => drafting.hold(draft)}
                                      onPlan={actions.onPlanDraft}
                                      planAsked={actions.planAsked}
                                      onDiscard={actions.onDiscard}
                                    />
                                  )
                                }}
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
                                taskAsk={(ask, itemId) => <TaskAskOf ask={ask} itemId={itemId} onOpen={onTask} />}
                                changes={(changes) => <ChangesCard changes={changes} actions={changesActions} />}
                                run={(run) => (
                                  <RunOf
                                    run={run}
                                    onStop={(id) => void model.stopLaunch(id)}
                                    onRunAgain={(taskId, runnableId, ref) => void model.runProject(taskId, runnableId, ref)}
                                    onHelp={helpMe.help}
                                  />
                                )}
                                queued={text.queued}
                                onAnswerQuestion={model.answerQuestion}
                                signed={coordinatorSigned}
                                virtual={coordinator.threadId}
                              />
                              {/* A bringing in from other tools the runtime never got: the window says it, with Try again. */}
                              <UnsentBringIn projectId={projectId} className={s.unsent} />
                              {drafting.shown.map((draft) => (
                                <DraftingCard
                                  key={draft.key}
                                  draft={draft}
                                  project={name}
                                  held={drafting.held(draft)}
                                  onHold={() => drafting.hold(draft)}
                                  onPlan={actions.onPlanDraft}
                                  planAsked={actions.planAsked}
                                  onDiscard={actions.onDiscard}
                                />
                              ))}
                            </ThreadShellProvider>
                          </Thread>
                        </ConversationFace>
                        <AskInAside within={coordinatorFace} onAsk={asides.begin} />
                      </div>
                    )}
                  </>
                )}
                {shown.lightbox}
                {clearing.dialog}
              </TalkColumn>
            )}
            {panes.board && (
              <div className={s.board}>
                {lanes !== null ? (
                  <>
                    {board.olderError !== null && (
                      <Problem className={s.failure}>
                        {text.olderFailed} {board.olderError}
                      </Problem>
                    )}
                    {!panes.talk && <AsideMoveFailed moves={asideMoves} className={s.failure} />}
                    <Now ticking every={ticking ? SECOND : MINUTE}>
                      {(now) => (
                        <BoardView
                          lanes={boardLanes ?? lanes}
                          agents={model.agents}
                          now={now}
                          onOpen={onTask}
                          closing={closing}
                          // An aside cleared from the chip goes at once, as from its pill.
                          actions={{
                            ...board,
                            markDone: (taskId) => {
                              if (!lanes.scratch.some((one) => one.taskId === taskId)) return board.markDone(taskId)
                              asides.clear([taskId])
                              return Promise.resolve(true)
                            },
                          }}
                          line={board.line}
                          folds={folds}
                          onFoldsChange={setFolds}
                          onTalk={talkToCoordinator}
                          {...(ways === undefined ? {} : { onSignIn: ways.signIn })}
                          team={{
                            projectId,
                            start: async (planId) => {
                              await model.startPlan(planId)
                            },
                            hold: (planId) => model.holdPlan(planId),
                            change: setTeamFor,
                            abandon: board.abandon,
                          }}
                          {...(board.moreSettled ? { onShowOlder: board.showOlder } : {})}
                          // Where the bar shows this computer's load, Up next's line over what is held back opens it there.
                          {...(preferences.showLoad ? { onPlaces: () => setLoadPeek(true) } : {})}
                        />
                      )}
                    </Now>
                  </>
                ) : board.error === null ? (
                  <PartPending label={text.boardReading} />
                ) : (
                  <Problem className={s.failure}>
                    {text.boardFailed} {board.error}
                  </Problem>
                )}
                {/* The conversation hidden, its composer stays under the board. */}
                {!panes.talk && <div className={s.dock}>{composer}</div>}
              </div>
            )}
          </div>
        )}
        {/* A team opened from a card in the conversation or a row of the board: whichever of them is on show, and before the board is. */}
        {teamFor !== null && (
          <TeamOf key={teamFor} projectId={projectId} taskId={teamFor} agents={model.agents} onClose={() => setTeamFor(null)} />
        )}
        {/* What the project runs, its tasks' too, and its terminals, along its foot; a new terminal opens in its repository. */}
        <Foot
          projectId={projectId}
          taskId={null}
          where={model.repositories?.[0]?.name ?? kept.name ?? name}
          onHelp={helpMe.help}
          // Its card in the coordinator's thread, as a card's Run again has it.
          onRunAgain={(launch) => void model.runProject(launch.taskId, launch.runnableId ?? null) === undefined}
        />
      </MessageMotion>
    </PageOpenerProvider>
  )
}
