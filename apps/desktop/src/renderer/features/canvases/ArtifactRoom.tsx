import { useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AgentStatus, ArtifactChat, ArtifactDrawing, CanvasSummary, PlanStep } from '@althar/contracts'
import { ArtifactHead, type ArtifactHeadArtifact, Button, DictationTray, Problem, ResizeHandle } from '@althar/ui'

import { messageOf, newTaskId } from '../../data/client'
import { reads } from '../../data/reads'
import { useModels } from '../../data/models'
import { useServices } from '../../data/services'
import { DraftComposer } from '../../shared/DraftComposer'
import { useDictation } from '../../shared/dictation/useDictation'
import { ModelChoice } from '../../shared/ModelChoice'
import type { Choice } from '../../shared/models'
import { type Outgoing, sentWith, takesImages, useAttachments } from '../../shared/useAttachments'
import { useKeptWidth } from '../../shared/useKeptWidth'
import { canvasCommentsOf, composerComment, drop, takeComments, useComments, withComments } from '../../shared/comments'
import { draftKey, setDraftText } from '../../shared/drafts'
import { TaskView } from '../task/TaskView'
import { useTask } from '../task/useTask'
import { CanvasHost } from './CanvasHost'
import s from './ArtifactRoom.module.css'

/*
 * An artifact opened from the project's Artifacts (ADR-104, "Talking to an
 * artifact"): the artifact itself, with its own chat beside it, as a design
 * tool shows a design with its conversation. The chat's top row is the
 * artifact's, never a task's: no step, no state, nothing waiting on the
 * person. Its canvas fills the rest, with its own head and the controls that
 * float on it.
 *
 * An artifact no one has talked to has no chat yet: its composer is there at
 * once, and its chat starts as the person shows they mean to talk (they go
 * to the composer, or point at a part), as an aside starts on +, so it is
 * ready by the time they send. What they write, and the parts they point at,
 * are kept by the artifact, and are the chat's when it starts. Words sent
 * before it is ready wait in the composer's queue and go as it is.
 */

export const artifactRoomText = {
  placeholder: 'Ask about it, or say what to change',
  chat: 'Its chat',
  startFailed: (why: string) => `Couldn’t start its chat. ${why}`,
  sendFailed: (why: string) => `Couldn’t send it. ${why}`,
  again: 'Try again',
  drawing: 'Drawing the first version',
  width: 'Width of its chat',
  lead: 'Lead',
}

/** How wide its chat is beside the artifact, as the person last dragged it: the artifact keeps the most of the window. */
const CHAT_WIDTH = { key: 'althar.artifactChat', start: 380, min: 300, rest: 420 } as const

/*
 * Each artifact's chat as it starts, by its canvas, outside any room: what was sent before it was ready goes to that
 * artifact's own chat once it is, whether the person stayed, went to another artifact, or left every artifact.
 */
const starting = new Map<string, Promise<ArtifactChat | null>>()

/** The artifact open: a canvas by its id, or one still drawing its first version by its chat's task; at a version, or the latest. */
export interface OpenArtifact {
  readonly id: string
  readonly version: number | null
}

/** Who made a canvas's latest version, as its room and its card say it. */
export const byOf = (summary: CanvasSummary) =>
  summary.latest.by.role === 'coordinator'
    ? 'Coordinator'
    : summary.latest.by.role === 'chat'
      ? 'Its chat'
      : `Lead of ${summary.latest.by.taskTitle ?? 'a task'}`

export function ArtifactRoom({
  projectId,
  coordinatorThreadId,
  open,
  canvases,
  drawing,
  lead,
  agents = [],
  onOpen,
  onBack,
}: {
  projectId: string
  /** The coordinator's thread: what the canvas is shown by until the artifact's own chat starts. */
  coordinatorThreadId: string | null
  open: OpenArtifact
  canvases: ReadonlyArray<CanvasSummary>
  drawing: ReadonlyArray<ArtifactDrawing>
  /** Who answers in a chat started here: the coordinator's composer's pick. */
  lead: PlanStep | null
  /** The agents its composer's picker offers, to answer in a chat started here. */
  agents?: ReadonlyArray<AgentStatus>
  onOpen: (open: OpenArtifact) => void
  onBack: () => void
}) {
  const { client } = useServices()
  const cache = useQueryClient()
  // One drawing its first version is opened by its chat's task, and stays open as its canvas arrives.
  const summary = canvases.find((one) => one.id === open.id) ?? canvases.find((one) => one.chat?.taskId === open.id) ?? null
  const drawn = summary === null ? (drawing.find((one) => one.taskId === open.id) ?? null) : null
  const canvasId = summary?.id ?? null
  // A chat started here, until the canvas's own read names it.
  const [started, setStarted] = useState<(ArtifactChat & { readonly canvasId: string }) | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // Words sent before the chat was ready, with the artifact they were sent to: they wait in its composer's queue, and go
  // to its own chat as it is ready.
  const [queued, setQueued] = useState<{ readonly canvasId: string; readonly words: string } | null>(null)
  const known = summary?.chat ?? (drawn === null ? null : drawn) ?? (started !== null && started.canvasId === canvasId ? started : null)
  const chatTask = known?.taskId ?? null
  const chatThread = known?.threadId ?? null
  const chat: ArtifactChat | null = useMemo(
    () => (chatTask === null || chatThread === null ? null : { taskId: chatTask, threadId: chatThread }),
    [chatTask, chatThread],
  )
  const draft = draftKey.artifact(canvasId ?? open.id)
  // Where the canvas's versions and actions go: the end of the artifact's row.
  const [actions, setActions] = useState<HTMLSpanElement | null>(null)
  // Who answers in a chat started here: picked in its composer before it starts, else the coordinator's composer's pick.
  const [pick, setPick] = useState<Choice | null>(null)
  const answers: PlanStep | null = useMemo(() => (pick === null ? lead : { key: 'implement', ...pick, skipped: false }), [pick, lead])
  const choice: Choice | null = useMemo(
    () => (answers === null ? null : { agentId: answers.agentId, model: answers.model, effort: answers.effort ?? null }),
    [answers],
  )

  /** This artifact's chat: the one it has, or the one starting, or a new one started now; null where it can't start. */
  const start = useCallback((): Promise<ArtifactChat | null> => {
    if (chat !== null) return Promise.resolve(chat)
    if (canvasId === null || summary === null || answers === null) return Promise.resolve(null)
    const going = starting.get(canvasId)
    if (going !== undefined) return going
    setFailed(null)
    const taskId = newTaskId()
    const made = client
      .startTask({ projectId, title: summary.latest.title, steps: [answers], chat: true, artifact: { canvasId }, taskId })
      .then(
        (one) => {
          // Read while the person writes: their first words open a ready conversation.
          void cache.prefetchQuery(reads(client).thread(one.threadId))
          setStarted({ canvasId, taskId: one.id, threadId: one.threadId })
          return { taskId: one.id, threadId: one.threadId }
        },
        (error: unknown) => {
          setFailed(artifactRoomText.startFailed(messageOf(error)))
          return null
        },
      )
      // Once it has started or failed, its canvas names it, or a new ask may start it again: the runtime answers with the same.
      .finally(() => starting.delete(canvasId))
    starting.set(canvasId, made)
    return made
  }, [chat, canvasId, summary, answers, projectId, client, cache])

  /**
   * Words sent before the chat is ready: they go to this artifact's own chat, with the parts pointed at as Send was pressed,
   * as it is ready. Those parts are its from then: one pointed at while it waits stays in the draft, for the next message.
   */
  const sendSoon = (words: string, outgoing: Outgoing, giveBack: (outgoing: Outgoing) => void) => {
    // No artifact to talk to yet (its list not read): what went with the words stays in the composer, as they do.
    if (canvasId === null) return giveBack(outgoing)
    const to = { canvasId, words, draft, batch: takeComments(draft), outgoing }
    setFailed(null)
    setQueued({ canvasId, words })
    setDraftText(draft, '')
    const settled = (failure: string | null) => {
      setQueued((now) => (now?.canvasId === to.canvasId && now.words === to.words ? null : now))
      if (failure !== null) setFailed(failure)
    }
    void start().then((ready) => {
      if (ready === null) {
        // Its words and parts go back where they were written, for the person to send again.
        to.batch.finish(false)
        setDraftText(to.draft, (now) => (now.trim() === '' ? to.words : `${to.words}\n\n${now}`))
        giveBack(to.outgoing)
        return settled(null)
      }
      return sendFirst(client.send, ready.threadId, to.draft, to.words, to.batch, to.outgoing).then(
        () => settled(null),
        (error: unknown) => {
          giveBack(to.outgoing)
          settled(artifactRoomText.sendFailed(messageOf(error)))
        },
      )
    })
  }
  const waiting = queued !== null && queued.canvasId === canvasId ? queued.words : null

  const title = summary?.latest.title ?? drawn?.title ?? ''
  const artifacts: ReadonlyArray<ArtifactHeadArtifact> = useMemo(
    () => [
      ...drawing.map((one) => ({ id: one.taskId, title: one.title, drawing: true })),
      ...canvases.map((one) => ({ id: one.id, title: one.latest.title })),
    ],
    [canvases, drawing],
  )
  // The canvas is shown by its chat's thread, or the coordinator's until it has one.
  const shownBy = chat?.threadId ?? coordinatorThreadId
  const onCanvas = useCallback(
    (id: string, version: number | null, follow: boolean) => {
      // Its own canvas at a version, or another artifact its chat names: the room goes there.
      if (id === canvasId && follow) return onOpen({ id, version: null })
      onOpen({ id, version })
    },
    [canvasId, onOpen],
  )

  return (
    <div className={s.room}>
      {/* Its one top row, in place of the project's: the artifact's, with its canvas's versions and actions at the end. */}
      <ArtifactHead
        current={summary?.id ?? open.id}
        title={title}
        by={summary === null ? null : byOf(summary)}
        artifacts={artifacts}
        onPick={(id) => onOpen({ id, version: null })}
        onBack={onBack}
        kbd="esc"
        end={<span ref={setActions} className={s.actions} />}
      />
      <div className={s.body}>
        <ChatColumn>
          {chat !== null && waiting === null ? (
            <Conversation
              key={chat.threadId}
              threadId={chat.threadId}
              draft={draft}
              opened={canvasId}
              onCanvas={onCanvas}
              onBack={onBack}
            />
          ) : (
            <FirstWords
              draft={draft}
              projectId={projectId}
              agents={agents}
              choice={choice}
              onChoose={setPick}
              queued={waiting}
              onStart={() => void start()}
              onSend={sendSoon}
              failed={failed}
              onAgain={() => void start()}
            />
          )}
        </ChatColumn>
        <div className={s.canvas}>
          {summary !== null && shownBy !== null ? (
            <CanvasHost
              key={summary.id}
              threadId={shownBy}
              open={{ canvasId: summary.id, version: open.version, follow: open.version === null }}
              draft={draft}
              onVersion={(version) => onOpen({ id: summary.id, version })}
              onClose={onBack}
              actionsIn={actions}
            />
          ) : (
            <div className={s.drawing} aria-busy="true">
              <span>{artifactRoomText.drawing}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Its chat's column, as wide as the person last dragged its edge. The width is its own, set on the column itself: a drag
 * draws neither the chat nor the artifact again, and no custom property has every element of the thread's style worked
 * out again. While its edge is dragged, something of the window's own lies over the artifact, as an open menu does
 * (`browser/cover.ts`): an artifact drawn in a view of its own over the window steps aside for its picture, and takes
 * neither the pointer nor its hover.
 */
function ChatColumn({ children }: { children: ReactNode }) {
  const width = useKeptWidth(CHAT_WIDTH)
  const column = useRef<HTMLElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <section ref={column} className={s.chat} aria-label={artifactRoomText.chat} style={{ width: width.width }}>
      {children}
      <ResizeHandle
        className={s.handle}
        value={width.width}
        min={width.min}
        max={width.max}
        onChange={width.set}
        onCommit={width.keep}
        onReset={width.reset}
        onResizing={(on) => {
          column.current?.toggleAttribute('data-resizing', on)
          setDragging(on)
        }}
        label={artifactRoomText.width}
      />
      {dragging && createPortal(<div className={s.dragging} data-state="open" aria-hidden="true" />, document.body)}
    </section>
  )
}

/** The artifact's chat: the conversation alone, as an aside's, its lead speaking as itself, under the artifact's top row. */
function Conversation({
  threadId,
  draft,
  opened,
  onCanvas,
  onBack,
}: {
  threadId: string
  draft: string
  opened: string | null
  onCanvas: (canvasId: string, version: number | null, follow: boolean) => void
  onBack: () => void
}) {
  const model = useTask(threadId)
  const artifact = useMemo(() => ({ draft, opened, onCanvas }), [draft, opened, onCanvas])
  return <TaskView model={model} onBack={onBack} aside={{ bar: null, artifact }} />
}

/**
 * Its composer before its chat starts: going to it, or pointing at a part, starts the chat; what is sent before it is ready
 * waits in the queue, with the parts pointed at, and goes as it is.
 */
function FirstWords({
  draft,
  projectId,
  agents,
  choice,
  onChoose,
  queued,
  onStart,
  onSend,
  failed,
  onAgain,
}: {
  draft: string
  projectId: string
  agents: ReadonlyArray<AgentStatus>
  /** Who answers once its chat starts, as its picker shows it; null where no one can yet. */
  choice: Choice | null
  onChoose: (choice: Choice) => void
  queued: string | null
  onStart: () => void
  /** Sends what is written, with what goes with it; `giveBack` puts that back in the composer where it couldn't go. */
  onSend: (words: string, outgoing: Outgoing, giveBack: (outgoing: Outgoing) => void) => void
  /** Why its chat couldn't start, or the words couldn't go, in a sentence. */
  failed: string | null
  onAgain: () => void
}) {
  const comments = useComments(draft)
  // Its images, files and dictation are the artifact's draft's, as its chat's composer's are: they go on there once it starts.
  const voice = useDictation(draft, { projectId })
  const { host } = useServices()
  const images = useAttachments(draft, host)
  const models = useModels()
  const receiver = { name: agentNameOf(agents, choice?.agentId ?? null), takes: takesImages(models, choice?.agentId ?? null) }
  // Pointing at a part says the person means to talk: the chat starts. Parts given back, as a first message that couldn't
  // go returns them, were pointed at already: they don't start it again over why it couldn't.
  const seen = useRef(new Set<string>())
  useEffect(() => {
    const pointed = comments.some((one) => !seen.current.has(one.id))
    for (const one of comments) seen.current.add(one.id)
    if (pointed) onStart()
  }, [comments, onStart])
  return (
    // Going to its field says the person means to talk; its picker, attach button or microphone don't start it yet.
    <div
      className={s.first}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLTextAreaElement) onStart()
      }}
    >
      <div className={s.empty} />
      {failed !== null && (
        <Problem banner>
          {failed}{' '}
          <Button size="small" variant="quiet" onClick={onAgain}>
            {artifactRoomText.again}
          </Button>
        </Problem>
      )}
      <DraftComposer
        draft={draft}
        placeholder={artifactRoomText.placeholder}
        inputRef={voice.inputRef}
        dictation={voice.dictation}
        tray={voice.tray && <DictationTray {...voice.tray} />}
        {...images.props(receiver)}
        picker={
          agents.length > 0 &&
          choice !== null && (
            <ModelChoice owner={artifactRoomText.lead} agents={agents} projectId={projectId} value={choice} onChange={onChoose} />
          )
        }
        comments={comments.map((comment, index) => composerComment(comment, index + 1))}
        onRemoveComment={(id) => drop(draft, id)}
        {...(queued === null ? {} : { queued: [{ id: 'first', text: queued }], busy: true })}
        onSubmit={(words) => {
          const attached = images.props(receiver)
          if (words.trim() === '' && comments.length === 0 && attached.images.length === 0 && attached.files.length === 0) return
          // With its images and files, and whether it was dictated; not ready to go yet, the composer says why and keeps it all.
          const outgoing = images.take(receiver)
          if (outgoing === null) return
          images.clear()
          onSend(words, outgoing, images.giveBack)
        }}
      />
    </div>
  )
}

/**
 * Sends what was written before the chat was ready, with the parts taken with it as Send was pressed (`batch`), to its
 * thread once it is: kept where it went, given back to the draft, words and parts, where it didn't.
 */
export const sendFirst = async (
  send: (
    input: {
      threadId: string
      body: string
      disposition: 'after_current'
      canvasComments?: ReturnType<typeof canvasCommentsOf>
    } & ReturnType<typeof sentWith>,
  ) => Promise<void>,
  threadId: string,
  draft: string,
  words: string,
  batch: ReturnType<typeof takeComments>,
  outgoing?: Outgoing,
) => {
  try {
    await send({
      threadId,
      body: withComments(words, batch.taken, outgoing?.sent.length ?? 0, false),
      disposition: 'after_current',
      ...sentWith(outgoing),
      canvasComments: canvasCommentsOf(batch.taken),
    })
    batch.finish(true)
  } catch (error) {
    batch.finish(false)
    setDraftText(draft, (now) => (now.trim() === '' ? words : `${words}\n\n${now}`))
    throw error
  }
}

/** An agent by its name, as the composer says who it sends to. */
const agentNameOf = (agents: ReadonlyArray<AgentStatus>, agentId: string | null) =>
  agents.find((agent) => agent.id === agentId)?.name ?? agentId ?? ''
