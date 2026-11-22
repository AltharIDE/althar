import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ArtifactChat, ArtifactDrawing, CanvasSummary, PlanStep } from '@althar/contracts'
import { ArtifactHead, type ArtifactHeadArtifact, Button, Problem } from '@althar/ui'

import { messageOf, newTaskId } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { DraftComposer } from '../../shared/DraftComposer'
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
}

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
  // Words sent before the chat was ready: they wait in the composer's queue, and go as it is.
  const [queued, setQueued] = useState<string | null>(null)
  const sending = useRef(false)
  const known = summary?.chat ?? (drawn === null ? null : drawn) ?? (started !== null && started.canvasId === canvasId ? started : null)
  const chatTask = known?.taskId ?? null
  const chatThread = known?.threadId ?? null
  const chat: ArtifactChat | null = useMemo(
    () => (chatTask === null || chatThread === null ? null : { taskId: chatTask, threadId: chatThread }),
    [chatTask, chatThread],
  )
  const draft = draftKey.artifact(canvasId ?? open.id)
  const starting = useRef<string | null>(null)
  // Where the canvas's versions and actions go: the end of the artifact's row.
  const [actions, setActions] = useState<HTMLSpanElement | null>(null)

  const start = useCallback(() => {
    if (chat !== null || canvasId === null || summary === null || lead === null || starting.current === canvasId) return
    starting.current = canvasId
    setFailed(null)
    const taskId = newTaskId()
    client.startTask({ projectId, title: summary.latest.title, steps: [lead], chat: true, artifact: { canvasId }, taskId }).then(
      (made) => {
        // Read while the person writes: their first words open a ready conversation.
        void cache.prefetchQuery(reads(client).thread(made.threadId))
        setStarted({ canvasId, taskId: made.id, threadId: made.threadId })
      },
      (error: unknown) => {
        starting.current = null
        setFailed(artifactRoomText.startFailed(messageOf(error)))
      },
    )
  }, [chat, canvasId, summary, lead, projectId, client, cache])
  useEffect(() => {
    if (chat === null || queued === null || sending.current) return
    sending.current = true
    void sendFirst(client.send, chat.threadId, draft, queued).then(
      () => {
        sending.current = false
        setQueued(null)
      },
      (error: unknown) => {
        sending.current = false
        setQueued(null)
        setFailed(artifactRoomText.sendFailed(messageOf(error)))
      },
    )
  }, [chat, queued, client, draft])

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
        <section className={s.chat} aria-label={artifactRoomText.chat}>
          {chat !== null && queued === null ? (
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
              queued={queued}
              onStart={start}
              onSend={(words) => {
                setFailed(null)
                setQueued(words)
                setDraftText(draft, '')
                start()
              }}
              failed={failed}
              onAgain={() => {
                starting.current = null
                start()
              }}
            />
          )}
        </section>
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
  queued,
  onStart,
  onSend,
  failed,
  onAgain,
}: {
  draft: string
  queued: string | null
  onStart: () => void
  onSend: (words: string) => void
  /** Why its chat couldn't start, or the words couldn't go, in a sentence. */
  failed: string | null
  onAgain: () => void
}) {
  const comments = useComments(draft)
  // Pointing at a part says the person means to talk: the chat starts.
  useEffect(() => {
    if (comments.length > 0) onStart()
  }, [comments.length, onStart])
  return (
    <div className={s.first} onFocusCapture={onStart}>
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
        comments={comments.map((comment, index) => composerComment(comment, index + 1))}
        onRemoveComment={(id) => drop(draft, id)}
        {...(queued === null ? {} : { queued: [{ id: 'first', text: queued }], busy: true })}
        onSubmit={(words) => {
          if (words.trim() === '' && comments.length === 0) return
          onSend(words)
        }}
      />
    </div>
  )
}

/** Sends what was written before the chat was ready, with the parts pointed at, to its thread once it is. */
export const sendFirst = async (
  send: (input: {
    threadId: string
    body: string
    disposition: 'after_current'
    canvasComments?: ReturnType<typeof canvasCommentsOf>
  }) => Promise<void>,
  threadId: string,
  draft: string,
  words: string,
) => {
  const batch = takeComments(draft)
  try {
    await send({
      threadId,
      body: withComments(words, batch.taken, 0, false),
      disposition: 'after_current',
      canvasComments: canvasCommentsOf(batch.taken),
    })
    batch.finish(true)
  } catch (error) {
    batch.finish(false)
    setDraftText(draft, (now) => (now.trim() === '' ? words : `${words}\n\n${now}`))
    throw error
  }
}
