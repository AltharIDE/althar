import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { CanvasAnchor, CanvasDetail, CanvasVersionFacts } from '@althar/contracts'
import { CanvasPagePlace, CanvasPanel, type CanvasPanelComment, CanvasPicture, Markdown } from '@althar/ui'

import { pictureUrl } from '../../../main/pictureAddress'
import { messageOf } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { canvasPlace, gather } from '../../shared/comments'
import { ago } from '../../shared/time'

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
}

const LONGEST_SELECTION = 240

/** Who published a version, as the panel says it. */
export const byWords = (version: CanvasVersionFacts, now = new Date()) => {
  const who = version.by.role === 'coordinator' ? 'The coordinator' : `The lead of ${version.by.taskTitle ?? 'a task'}`
  const when = ago(version.at, now)
  return when === '' ? who : `${who} · ${when}`
}

/** The comments sent on a canvas, open first, as its panel lists them. */
export const commentsShown = (detail: CanvasDetail): ReadonlyArray<CanvasPanelComment> =>
  detail.comments
    .map((comment) => ({
      id: comment.id,
      version: comment.version,
      body: comment.body,
      place: canvasPlace(comment.anchor),
      answered: comment.resolved !== null,
      answer: comment.resolved?.note ?? null,
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

export function CanvasHost({ threadId, open, draft, onVersion, onClose }: CanvasHostProps) {
  const { client, host } = useServices()
  const detail = useQuery(reads(client).canvas(open.canvasId))
  const version = detail.data === undefined ? null : shownVersion(detail.data, open)
  const latest = detail.data?.versions.at(-1)?.number ?? 0
  const kind = version?.kind ?? 'markdown'
  const drawsText = kind === 'markdown' || kind === 'mermaid' || kind === 'svg'
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
  const comments = useMemo(() => (detail.data === undefined ? [] : commentsShown(detail.data)), [detail.data])
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
  const fill = kind === 'html' || kind === 'picture' || kind === 'svg'
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
      fill={fill}
      loading={loading}
      {...(comment === undefined ? {} : { onComment: comment })}
      {...(error === undefined ? {} : { error })}
      {...(kind === 'html' && host.canvases !== undefined ? { onReload: () => host.canvases?.reload(threadId) } : {})}
    >
      {version !== null && summary !== undefined && (
        <div ref={setBody} style={{ display: 'contents' }}>
          <Drawn threadId={threadId} projectId={summary.projectId} canvasId={summary.id} version={version} text={text.data?.text ?? ''} />
        </div>
      )}
    </CanvasPanel>
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
}: {
  threadId: string
  target: { readonly projectId: string; readonly canvasId: string; readonly version: number; readonly manifest: string }
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
  useEffect(() => {
    views?.show(threadId, { projectId, canvasId, version, manifest }, panel)
  }, [views, threadId, projectId, canvasId, version, manifest, panel])
  // Closed, or another kind shown in its place, the view goes with its process.
  useEffect(() => () => views?.close(threadId), [views, threadId])
  return <CanvasPagePlace ref={setPlace} canvas={canvasId} />
}
