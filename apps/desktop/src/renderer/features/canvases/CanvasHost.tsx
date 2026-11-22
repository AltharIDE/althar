import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { CanvasAnchor, CanvasBoards, CanvasDetail, CanvasVersionFacts } from '@althar/contracts'
import { BoardsBar, CanvasPagePlace, CanvasPanel, type CanvasPanelComment, CanvasPicture, CommentBox, Markdown } from '@althar/ui'

import { sized } from '../../../main/browser/elementWords'
import type { CanvasPointed } from '../../../main/canvases/boards'
import { pictureUrl } from '../../../main/pictureAddress'
import { messageOf } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { type CanvasSpot, canvasPlace, drop, gather, savePageComment, useComments } from '../../shared/comments'
import { ago } from '../../shared/time'
import { useCovered } from '../browser/cover'
import { boardsOfText, pinsOf, useGround } from './boards'
import { SaveCanvas } from './SaveCanvas'

/*
 * One of the project's canvases beside a conversation (ADR-104), on its
 * workbench: the kit's CanvasPanel, with what is on it drawn by its kind. A
 * document is Althar's own Markdown, its mermaid blocks diagrams; a diagram
 * alone is drawn the same way; an SVG and a picture are pictures, so no
 * script in them runs; a page is a view of its own the main process lays
 * over the panel's place, at the version's address, in the project's canvas
 * partition. A version the person reads stays while a newer one is
 * published, unless it follows the latest (opened by the agent at work
 * beside it). A comment waits in the conversation's draft, with the
 * version and the words it is on, until the person sends their message.
 *
 * A canvas of boards is a page view too, on Althar's ground (ADR-104): its
 * bar along the bottom changes how it shows, and pointing at a part of a
 * board writes a comment on it over a picture of the canvas, which waits in
 * the draft as any comment does; sent ones are numbered pins on their parts.
 */

/** A canvas open beside a conversation: which, at which version (null for the latest), and whether it follows the latest. */
export interface OpenCanvas {
  readonly canvasId: string
  readonly version: number | null
  readonly follow: boolean
}

export interface CanvasHostProps {
  /** The conversation it is beside, by its thread: where its comments go, and its page view's key. */
  readonly threadId: string
  readonly open: OpenCanvas
  /** The conversation's draft, where comments wait; null where there is none. */
  readonly draft: string | null
  readonly onVersion: (version: number) => void
  readonly onClose: () => void
  /** Back to where it was opened from: every artifact of the project. */
  readonly onBack?: () => void
}

const LONGEST_SELECTION = 240

/** Who published a version, as the panel says it. */
export const byWords = (version: CanvasVersionFacts, now = new Date()) => {
  const who = version.by.role === 'coordinator' ? 'The coordinator' : `The lead of ${version.by.taskTitle ?? 'a task'}`
  const when = ago(version.at, now)
  return when === '' ? who : `${who} · ${when}`
}

/** The comments sent on a canvas, open first, as its panel lists them. */
export const commentsShown = (detail: CanvasDetail): ReadonlyArray<CanvasPanelComment & { readonly anchor: CanvasAnchor }> =>
  detail.comments
    .map((comment) => ({
      id: comment.id,
      version: comment.version,
      body: comment.body,
      place: canvasPlace(comment.anchor),
      answered: comment.resolved !== null,
      answer: comment.resolved?.note ?? null,
      anchor: comment.anchor,
    }))
    .toSorted((a, b) => Number(a.answered) - Number(b.answered))

/** The version shown: the latest where it follows or names none, else the one it names, where the canvas has it. */
export const shownVersion = (detail: CanvasDetail, open: OpenCanvas): CanvasVersionFacts | null => {
  const latest = detail.versions.at(-1) ?? null
  if (open.follow || open.version === null) return latest
  return detail.versions.find((one) => one.number === open.version) ?? latest
}

/** The words selected in the canvas's body, and the heading they are under: what a comment is on, where there are any. */
const selectionIn = (body: Element | null): { readonly text: string; readonly heading: string | null } | null => {
  const selection = window.getSelection()
  if (body === null || selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!body.contains(range.commonAncestorContainer)) return null
  const words = selection.toString().replace(/\s+/g, ' ').trim()
  if (words === '') return null
  // The nearest heading before it, in the document's order.
  let heading: string | null = null
  for (const one of body.querySelectorAll('h1, h2, h3, h4')) {
    if (one.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) heading = one.textContent?.trim() ?? null
  }
  return { text: words.length > LONGEST_SELECTION ? `${words.slice(0, LONGEST_SELECTION - 1)}…` : words, heading }
}

/** Base64 of an SVG's words, for a picture of it: drawn as an image, its scripts never run. */
export const svgAddress = (svg: string) => {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  // In pieces: a large drawing's bytes at once would be more arguments than a call takes.
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

export function CanvasHost({ threadId, open, draft, onVersion, onClose, onBack }: CanvasHostProps) {
  const { client, host } = useServices()
  const detail = useQuery(reads(client).canvas(open.canvasId))
  const version = detail.data === undefined ? null : shownVersion(detail.data, open)
  const latest = detail.data?.versions.at(-1)?.number ?? 0
  const kind = version?.kind ?? 'markdown'
  // A canvas of boards' entry is read too: its pages and boards are what its bar steps through.
  const drawsText = kind === 'markdown' || kind === 'mermaid' || kind === 'svg' || kind === 'boards'
  const text = useQuery({
    ...reads(client).canvasText(open.canvasId, version?.number ?? 0),
    enabled: version !== null && drawsText,
  })
  const [selected, setSelected] = useState<{ readonly text: string; readonly heading: string | null } | null>(null)
  const [body, setBody] = useState<HTMLDivElement | null>(null)

  // The words selected in a document, as they change: what a comment would be on. Only a document's words are a passage.
  useEffect(() => {
    if (kind !== 'markdown') return
    const changed = () => setSelected(selectionIn(body))
    document.addEventListener('selectionchange', changed)
    return () => document.removeEventListener('selectionchange', changed)
  }, [body, kind])
  const passage = kind === 'markdown' ? selected : null

  // [ and ] step through its versions, from anywhere on the panel but a field.
  const step = useCallback(
    (event: KeyboardEvent) => {
      if (version === null || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (!(target instanceof Node) || body?.closest('aside')?.contains(target) !== true) return
      if (event.key === '[' && version.number > 1) onVersion(version.number - 1)
      if (event.key === ']' && version.number < latest) onVersion(version.number + 1)
    },
    [version, latest, onVersion, body],
  )
  useEffect(() => {
    window.addEventListener('keydown', step)
    return () => window.removeEventListener('keydown', step)
  }, [step])

  const summary = detail.data?.summary
  const sent = useMemo(() => (detail.data === undefined ? [] : commentsShown(detail.data)), [detail.data])
  const boards = useMemo(() => (kind === 'boards' && text.data !== undefined ? boardsOfText(text.data.text) : null), [kind, text.data])
  const drafts = useComments(draft ?? '')
  const pinned = useMemo(() => pinsOf(sent, draft === null ? [] : drafts, open.canvasId), [sent, drafts, draft, open.canvasId])
  const comments = useMemo(
    () => (kind === 'boards' ? sent.map((one) => ({ ...one, n: pinned.numbers.get(one.id) ?? null })) : sent),
    [kind, sent, pinned],
  )
  const ground = useBoards({
    threadId,
    canvasId: open.canvasId,
    boards,
    draft,
    pinned,
    onVersion: (step) => {
      if (version === null) return
      const to = version.number + step
      if (to >= 1 && to <= latest) onVersion(to)
    },
  })
  // The last words selected, with the heading they are under: what a comment pressed on them is on.
  const lastPassage = useRef<{ readonly text: string; readonly heading: string | null } | null>(null)
  useEffect(() => {
    if (passage !== null) lastPassage.current = passage
  }, [passage])
  const comment =
    draft === null || summary === undefined || version === null
      ? undefined
      : (note: string, on: string | null) => {
          const heading = on !== null && lastPassage.current?.text === on ? lastPassage.current.heading : null
          const anchor: CanvasAnchor = on === null ? { kind: 'whole' } : { kind: 'passage', text: on, heading }
          gather(draft, {
            id: `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            note,
            on: { kind: 'canvas', canvasId: summary.id, name: summary.name, title: version.title, version: version.number, anchor },
            crop: null,
          })
          window.getSelection()?.removeAllRanges()
        }

  // Its words are only waited for once there is a version to read them from: a canvas that can't be read says why.
  const loading = detail.isPending || (drawsText && version !== null && text.isPending)
  const error = detail.isError ? messageOf(detail.error) : drawsText && text.isError ? messageOf(text.error) : undefined
  const fill = kind === 'html' || kind === 'boards' || kind === 'picture' || kind === 'svg'
  return (
    <CanvasPanel
      name={summary?.name ?? ''}
      title={version?.title ?? ''}
      kind={kind}
      version={version?.number ?? 1}
      latest={latest}
      by={version === null ? '' : byWords(version)}
      note={version?.note ?? null}
      onVersion={onVersion}
      newer={!open.follow && version !== null && version.number < latest ? latest : null}
      selected={passage?.text ?? null}
      comments={comments}
      onClose={onClose}
      {...(onBack === undefined ? {} : { onBack })}
      {...(summary === undefined || version === null || error !== undefined
        ? {}
        : { extra: <SaveCanvas summary={summary} version={latest} /> })}
      fill={fill}
      loading={loading}
      {...(comment === undefined ? {} : { onComment: comment })}
      {...(error === undefined ? {} : { error })}
      {...((kind === 'html' || kind === 'boards') && host.canvases !== undefined
        ? { onReload: () => host.canvases?.reload(threadId) }
        : {})}
      {...(kind === 'boards' && boards !== null && !loading && error === undefined
        ? {
            bar: (
              <BoardsBar
                pages={boards.pages}
                view={ground.state.view}
                page={ground.state.page}
                board={ground.state.board}
                zoom={ground.state.zoom}
                tool={ground.state.tool}
                onView={(view) => ground.change({ view })}
                onPage={(page) => ground.change({ page, view: 'every' })}
                onStep={(step) => ground.change({ step })}
                onZoom={(zoom) => ground.change({ zoom })}
                onTool={(tool) => ground.change({ tool })}
              />
            ),
            onCommentPick: (id: string) => {
              const one = sent.find((c) => c.id === id)
              if (one?.anchor.kind === 'element' && one.anchor.page !== undefined && one.anchor.board !== undefined)
                void host.canvases?.find?.(threadId, { page: one.anchor.page, board: one.anchor.board, selector: one.anchor.selector })
            },
          }
        : {})}
    >
      {version !== null && summary !== undefined && (
        <div ref={setBody} style={{ display: 'contents' }}>
          {kind === 'boards' ? (
            <CanvasPage
              threadId={threadId}
              target={{
                projectId: summary.projectId,
                canvasId: summary.id,
                version: version.number,
                manifest: version.manifest,
                boards: true,
              }}
              writing={ground.writing}
              onShown={ground.restore}
              onPlace={ground.setRoom}
            >
              {ground.writing !== null && draft !== null && (
                <BoardComment
                  writing={ground.writing}
                  room={ground.room}
                  n={pinned.numbers.size + (ground.writing.comment === null ? 1 : 0)}
                  onSubmit={(note) => {
                    const { pointed, comment: was } = ground.writing ?? { pointed: null, comment: null }
                    if (pointed === null) return
                    const spot: CanvasSpot = {
                      kind: 'canvas',
                      canvasId: summary.id,
                      name: summary.name,
                      title: version.title,
                      version: version.number,
                      anchor: {
                        kind: 'element',
                        selector: pointed.picked.selector,
                        label: pointed.picked.label,
                        text: pointed.picked.text,
                        page: pointed.page,
                        board: pointed.board,
                      },
                      picked: pointed.picked,
                    }
                    savePageComment(draft, was?.id ?? null, note, spot, pointed.crop)
                    ground.done()
                  }}
                  onCancel={ground.done}
                  onRemove={() => {
                    const was = ground.writing?.comment
                    if (was !== null && was !== undefined) drop(draft, was.id)
                    ground.done()
                  }}
                />
              )}
            </CanvasPage>
          ) : (
            <Drawn threadId={threadId} projectId={summary.projectId} canvasId={summary.id} version={version} text={text.data?.text ?? ''} />
          )}
        </div>
      )}
    </CanvasPanel>
  )
}

/** A comment being written on a part of a board: the part pointed at, and the comment it changes, where it is one in the draft. */
interface Writing {
  readonly pointed: CanvasPointed
  readonly comment: { readonly id: string; readonly note: string } | null
}

/**
 * A canvas of boards beside a thread: how its ground shows it, changed at
 * once by its bar; the comment being written on a part pointed at (or on a
 * draft comment's pin, pressed again); the keys pressed in it the window acts
 * on; and the pins of the comments on its parts, drawn whenever they change.
 */
function useBoards({
  threadId,
  canvasId,
  boards,
  draft,
  pinned,
  onVersion,
}: {
  threadId: string
  canvasId: string
  boards: CanvasBoards | null
  draft: string | null
  pinned: ReturnType<typeof pinsOf>
  onVersion: (step: -1 | 1) => void
}) {
  const views = useServices().host.canvases
  const [writing, setWriting] = useState<Writing | null>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })
  const drafts = useComments(draft ?? '')
  const ground = useGround(threadId, canvasId, boards, {
    // A part pointed at opens its comment, where there is a draft to keep it in.
    pointed: (pointed) => {
      if (draft !== null) setWriting({ pointed, comment: null })
      else views?.clear?.(threadId)
    },
    pin: (n) => {
      const id = [...pinned.numbers].find(([, number]) => number === n)?.[0]
      const mine = drafts.find((one) => one.id === id)
      // A sent comment's pin shows it in the list under the canvas; a draft's opens it again, to change or remove.
      if (mine === undefined) return document.querySelector(`[data-comment="${id ?? ''}"]`)?.scrollIntoView({ block: 'nearest' })
      if (mine.on.kind !== 'canvas' || mine.on.anchor.kind !== 'element') return
      const { page, board, selector } = mine.on.anchor
      if (page === undefined || board === undefined) return
      void views?.find?.(threadId, { page, board, selector }).then((pointed) => {
        if (pointed !== null) setWriting({ pointed, comment: { id: mine.id, note: mine.note } })
      })
    },
    key: (key) => {
      if (key === 'escape') return setWriting(null)
      onVersion(key === 'older' ? -1 : 1)
    },
  })
  const { change, state, wanted } = ground
  // The pins go to the ground as they change; it keeps them for every load after.
  useEffect(() => {
    if (boards !== null) void views?.pins?.(threadId, pinned.pins)
  }, [views, threadId, boards, pinned.pins])
  const done = useCallback(() => {
    setWriting(null)
    views?.clear?.(threadId)
  }, [views, threadId])
  const restore = useCallback(() => {
    const was = wanted()
    if (was !== null) views?.ground?.(threadId, was)
  }, [wanted, views, threadId])
  return { state, change, writing, done, restore, room, setRoom }
}

/** The comment being written on a part of a board, over the picture of the canvas. */
function BoardComment({
  writing,
  room,
  n,
  onSubmit,
  onCancel,
  onRemove,
}: {
  writing: Writing
  room: { readonly width: number; readonly height: number }
  n: number
  onSubmit: (note: string) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const { pointed, comment } = writing
  const label = pointed.picked.label === 'the board' ? pointed.board : pointed.picked.label
  return (
    <CommentBox
      key={`${comment?.id ?? 'new'}:${pointed.picked.selector}`}
      at={pointed.at}
      room={room}
      n={n}
      element={label}
      size={sized(pointed.picked.rect.width, pointed.picked.rect.height)}
      defaultValue={comment?.note ?? ''}
      existing={comment !== null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...(comment === null ? {} : { onRemove })}
    />
  )
}

/** What is on a version, drawn by its kind. */
function Drawn({
  threadId,
  projectId,
  canvasId,
  version,
  text,
}: {
  threadId: string
  projectId: string
  canvasId: string
  version: CanvasVersionFacts
  text: string
}) {
  switch (version.kind) {
    case 'markdown':
      return <Markdown source={text} size="panel" />
    case 'mermaid':
      return <Markdown source={`\`\`\`mermaid\n${text}\n\`\`\``} size="panel" />
    case 'svg':
      return <CanvasPicture src={svgAddress(text)} alt={version.title} />
    case 'picture':
      return <CanvasPicture src={pictureUrl(version.entrySha256)} alt={version.title} />
    case 'html':
      return <CanvasPage threadId={threadId} target={{ projectId, canvasId, version: version.number, manifest: version.manifest }} />
  }
}

/** Where a page canvas is drawn: a place in the panel the main process lays the canvas's view over, as it moves and grows. */
function CanvasPage({
  threadId,
  target,
  writing = null,
  onShown,
  onPlace,
  children,
}: {
  threadId: string
  target: {
    readonly projectId: string
    readonly canvasId: string
    readonly version: number
    readonly manifest: string
    readonly boards?: boolean
  }
  /** A comment being written over it: the view steps aside for the picture taken as it was pointed at. */
  writing?: { readonly pointed: { readonly still: string } } | null
  /** Once it is first shown: a canvas of boards shows as it last did. */
  onShown?: () => void
  /** The size of its place, as it changes. */
  onPlace?: (room: { width: number; height: number }) => void
  /** What the window draws over it, such as the comment being written. */
  children?: ReactNode
}) {
  const { host } = useServices()
  const views = host.canvases
  const [place, setPlace] = useState<HTMLDivElement | null>(null)
  const [panel, setPanel] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const measure = useCallback(() => {
    if (place === null) return
    const box = place.getBoundingClientRect()
    const next = box.width < 1 || box.height < 1 ? null : { x: box.left, y: box.top, width: box.width, height: box.height }
    setPanel((was) =>
      was !== null && next !== null && was.x === next.x && was.y === next.y && was.width === next.width && was.height === next.height
        ? was
        : next,
    )
  }, [place])
  useEffect(() => {
    if (place === null) return
    const watching = new ResizeObserver(measure)
    watching.observe(place)
    window.addEventListener('resize', measure)
    document.addEventListener('animationend', measure, true)
    document.addEventListener('transitionend', measure, true)
    return () => {
      watching.disconnect()
      window.removeEventListener('resize', measure)
      document.removeEventListener('animationend', measure, true)
      document.removeEventListener('transitionend', measure, true)
    }
  }, [place, measure])
  useLayoutEffect(measure)
  const { projectId, canvasId, version, manifest } = target
  const boards = target.boards === true
  useEffect(() => {
    views?.show(threadId, { projectId, canvasId, version, manifest, ...(boards ? { boards } : {}) }, panel)
  }, [views, threadId, projectId, canvasId, version, manifest, boards, panel])
  // Shown for the first time, after the view is made (an effect declared after the one above runs after it).
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || panel === null) return
    shown.current = true
    onShown?.()
  }, [panel, onShown])
  useEffect(() => {
    if (panel !== null) onPlace?.({ width: panel.width, height: panel.height })
  }, [panel, onPlace])
  // Closed, or another kind shown in its place, the view goes with its process.
  useEffect(() => () => views?.close(threadId), [views, threadId])

  // Something of the window's own over its place (a dialog, a menu, a lightbox) would open under the view: a picture of the
  // canvas shows in its place and the view steps aside, as the page's does (ADR-100).
  const covered = useCovered(panel, () => document.getElementById('root'))
  const [still, setStill] = useState<string | null>(null)
  // Whether the view should be aside now: a picture that finishes drawing after what was over it went must not hide it again.
  const aside = useRef(false)
  const pictured = writing?.pointed.still ?? null
  useLayoutEffect(() => {
    aside.current = covered || pictured !== null
  }, [covered, pictured])
  useEffect(() => {
    if (views === undefined) return
    let live = true
    // A comment written over the canvas: its picture shows in the view's place, and the view steps aside once it has drawn.
    if (pictured !== null) {
      if (pictured === '') void views.cover(threadId, true)
      return
    }
    if (covered) {
      void views
        .still(threadId)
        .catch(() => null)
        .then((picture) => {
          if (!live) return
          // With no picture to show, the view steps aside all the same: what is over it must show.
          if (picture === null) void views.cover(threadId, true)
          setStill(picture)
        })
      return () => {
        live = false
      }
    }
    void views.cover(threadId, false)
    // The picture goes once the view is back over it, so nothing between blinks.
    const frame = requestAnimationFrame(() => setStill(null))
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [views, threadId, covered, pictured])
  // Closing or leaving, the view comes back for whoever shows it next.
  useEffect(() => () => void views?.cover(threadId, false), [views, threadId])
  return (
    <CanvasPagePlace
      ref={setPlace}
      canvas={canvasId}
      still={pictured !== null && pictured !== '' ? pictured : still}
      onStill={() => {
        if (aside.current) void views?.cover(threadId, true)
      }}
    >
      {children}
    </CanvasPagePlace>
  )
}
