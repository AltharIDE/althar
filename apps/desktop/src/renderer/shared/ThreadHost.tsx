import { useQuery } from '@tanstack/react-query'
import { type CSSProperties, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  type CanvasRef,
  DocPanel,
  type DocRef,
  type FoundCode,
  type ImageRef,
  Lightbox,
  type ThreadShell,
  ThreadShellProvider,
  Workbench,
} from '@althar/ui'

import { messageOf } from '../data/client'
import { reads } from '../data/reads'
import { useServices } from '../data/services'
import type { PageOpener } from '../features/browser/opener'
import { pages, usePage } from '../features/browser/pages'
import { PageView } from '../features/browser/PageView'
import { CanvasHost, type OpenCanvas } from '../features/canvases/CanvasHost'
import { type BenchWidth, PAGE_BENCH, useBenchWidth } from './code/bench'
import { type CodeOpen, useCodeHost } from './code/CodeHost'

/*
 * What a thread's screen offers the parts in it (the kit's ThreadShell): a
 * picture opens in the lightbox, with the rest of its set a key away; a
 * document, and a file an agent names, on the conversation's workbench
 * beside the thread, one at a time, as wide as the person drags it. A
 * document is read again as the agent edits it (DocumentPanel). Opening
 * another from the thread replaces what is there; a file opened from inside
 * the document goes on top of it, with Back. Escape or Close gives focus
 * back to what opened it. Where the conversation has pages (ADR-100), its
 * page goes there too, in place of a document, as wide as half the window
 * to start; a link in a message opens there, or in the person's browser,
 * as the person keeps links.
 */

/** A conversation's page beside it: whose it is, the draft its comments go to, where its links open, and its way to a tab of its own. */
export interface ThreadPage {
  readonly owner: string
  readonly kind: 'task' | 'project'
  readonly draft: string
  readonly opener: PageOpener
  readonly onDock: () => void
}

export interface ThreadHost {
  readonly shell: ThreadShell
  /** The lightbox, while a picture is open. */
  readonly lightbox: ReactNode
  /** The document open in the side panel, if one is. */
  readonly doc: DocRef | null
  readonly closeDoc: () => void
  /** The file open beside the thread, if one is. */
  readonly code: CodeOpen | null
  /** The canvas open beside the thread, if one is (ADR-104). */
  readonly canvas: OpenCanvas | null
  /** Opens a canvas beside the thread: at a version, or the latest; following the latest, as one its agent opens. */
  readonly openCanvas: (canvasId: string, version: number | null, follow: boolean) => void
  /** The workbench's width, as the person drags it. */
  readonly bench: BenchWidth
  /**
   * The workbench, with what is open on it: the document `docPanel` draws,
   * and the file open, on top of the document where it was opened from it;
   * nothing where neither is open. Where it opens over something to the
   * conversation's right, as the board beside it, it is dragged by its end
   * (by its start, `edge`, where what it opens over is on the conversation's
   * left), within the `room` there, leaving `keep` of it; where it would leave less,
   * as in a small window, it takes the whole room, to the window's edge.
   */
  readonly workbench: (
    docPanel: ReactNode,
    over?: {
      readonly room: number
      readonly keep: number
      /** The edge it is dragged by: its end, over what is right of the conversation; its start, over what is left of it. */
      readonly edge?: 'start' | 'end'
      readonly className?: string
      readonly style?: CSSProperties
    },
  ) => ReactNode | undefined
}

/**
 * A thread's host; `documents` false where there is no panel to open one
 * in. With `code`, the thread whose agent's names open the code they name.
 * With `conversation` false, the thread is off screen (a task's outputs or
 * graph), so its page steps aside, kept where it is for when it shows again.
 */
export const useThreadHost = (
  documents = true,
  code: { readonly threadId: string | null; readonly taskId: string | null } | null = null,
  page: ThreadPage | null = null,
  conversation = true,
): ThreadHost => {
  const [pictures, setPictures] = useState<{ readonly set: readonly ImageRef[]; readonly at: number } | null>(null)
  const [doc, setDoc] = useState<DocRef | null>(null)
  const [opened, setOpen] = useState<(CodeOpen & { readonly threadId: string | null }) | null>(null)
  const [canvas, setCanvas] = useState<(OpenCanvas & { readonly threadId: string | null }) | null>(null)
  const owner = page?.owner ?? null
  const beside = usePage(owner, useServices().host.pages).where === 'beside' && conversation
  // A page opened beside the conversation takes the workbench from a document or a file; one of those opened takes it back.
  useEffect(() => {
    if (!beside) return
    setDoc(null)
    setOpen(null)
    setCanvas(null)
  }, [beside])
  const hidePage = () => {
    if (owner !== null && pages.where(owner) === 'beside') pages.hide(owner)
  }
  const docBench = useBenchWidth()
  const pageBench = useBenchWidth(undefined, PAGE_BENCH)
  const threadId = code?.threadId ?? null
  // The canvas open is the thread's: another conversation opens its own.
  const shownCanvas = canvas !== null && canvas.threadId === threadId ? canvas : null
  // A canvas is as wide as a page: it is often one.
  const bench = beside || shownCanvas !== null ? pageBench : docBench
  const openCanvas = useCallback(
    (canvasId: string, version: number | null, follow: boolean) => {
      setDoc(null)
      setOpen(null)
      if (owner !== null && pages.where(owner) === 'beside') pages.hide(owner)
      setCanvas({ canvasId, version, follow, threadId })
    },
    [owner, threadId],
  )
  // The file open is the thread's: another thread's names name other files.
  const open = opened !== null && opened.threadId === threadId ? opened : null
  // A file opened from the thread takes the workbench; one opened from what is on it goes on top of it.
  const openCode = (found: FoundCode, from: HTMLElement | null) => {
    const onTop = from?.closest('[data-workbench]') != null
    if (!onTop) setDoc(null)
    if (!onTop) setCanvas(null)
    hidePage()
    setOpen({ found, from, onTop, threadId })
  }
  const coded = useCodeHost({
    threadId,
    taskId: code?.taskId ?? null,
    open,
    onOpen: openCode,
    onClose: () => setOpen(null),
    onCloseAll: () => {
      setOpen(null)
      setDoc(null)
    },
  })
  const shell = useMemo<ThreadShell>(
    () => ({
      openImage: (image, set = [image]) => setPictures({ set, at: Math.max(set.indexOf(image), 0) }),
      ...(documents
        ? {
            openDoc: (opened: DocRef) => {
              setOpen(null)
              setCanvas(null)
              setDoc(opened)
              if (owner !== null && pages.where(owner) === 'beside') pages.hide(owner)
            },
          }
        : {}),
      ...(coded.shell === undefined ? {} : { code: coded.shell }),
      ...(page === null ? {} : { openLink: page.opener.link, ...(page.opener.links === 'beside' ? { linkNote: text.beside } : {}) }),
      ...(threadId === null
        ? {}
        : {
            openCanvas: (ref: CanvasRef) => {
              setDoc(null)
              setOpen(null)
              if (owner !== null && pages.where(owner) === 'beside') pages.hide(owner)
              setCanvas({ canvasId: ref.canvasId, version: ref.version, follow: false, threadId })
            },
            openedCanvas: shownCanvas?.canvasId ?? null,
          }),
    }),
    [documents, coded.shell, page, owner, threadId, shownCanvas?.canvasId],
  )
  const workbench: ThreadHost['workbench'] = (docPanel, over) => {
    // Over something, a sliver of it beside the panel is of no use: the panel takes it all, as wide as it can be.
    const whole = over !== undefined && bench.width > over.room - over.keep
    const max = over === undefined ? bench.max : whole ? over.room : over.room - over.keep
    const width = whole ? max : Math.min(bench.width, max)
    const file = coded.panel(width)
    const shown =
      beside && page !== null ? (
        <PageView owner={page.owner} kind={page.kind} draft={page.draft} where="beside" onDock={page.onDock} />
      ) : shownCanvas !== null && threadId !== null ? (
        <CanvasHost
          key={shownCanvas.canvasId}
          threadId={threadId}
          open={shownCanvas}
          draft={page?.draft ?? null}
          onVersion={(version) => setCanvas({ ...shownCanvas, version, follow: false })}
          onClose={() => setCanvas(null)}
        />
      ) : null
    if ((docPanel === null || docPanel === undefined || docPanel === false) && file === null && shown === null) return undefined
    return (
      <Workbench
        width={width}
        min={whole ? max : bench.min}
        max={max}
        onWidth={bench.set}
        onCommit={bench.keep}
        onReset={bench.reset}
        edge={over === undefined ? 'start' : (over.edge ?? 'end')}
        {...(over?.className === undefined ? {} : { className: over.className })}
        {...(over?.style === undefined ? {} : { style: { ...over.style, width } })}
      >
        {/* What opens from inside it opens here too: a file the lead's document names. */}
        <ThreadShellProvider value={shell}>
          {shown ?? (
            <>
              {docPanel !== null && docPanel !== undefined && docPanel !== false && <div hidden={file !== null}>{docPanel}</div>}
              {file}
            </>
          )}
        </ThreadShellProvider>
      </Workbench>
    )
  }
  return {
    shell,
    lightbox: pictures && <Lightbox images={pictures.set} defaultIndex={pictures.at} onClose={() => setPictures(null)} />,
    doc,
    closeDoc: () => setDoc(null),
    code: open,
    canvas: shownCanvas,
    openCanvas,
    bench,
    workbench,
  }
}

const text = { beside: '(opens beside the conversation)' } as const

/** A document in the side panel: as it was when it opened, then as it is now, read again at each `version`. */
export function DocumentPanel({
  threadId,
  doc,
  version,
  onClose,
  onOpen,
}: {
  threadId: string
  doc: DocRef
  /** What the document was last changed by in the thread: a new one reads it again. */
  version: string
  onClose: () => void
  /** Opens it in the person's editor; without it, there is no such button. */
  onOpen?: () => void
}) {
  const { client } = useServices()
  // Read by which file it is, where the card said; otherwise by its path.
  const source = doc.source ?? doc.path
  // Read again as it opens, whatever was read before: the panel shows the file as it is now.
  const read = useQuery({
    ...reads(client).document(threadId, source ?? '', version),
    enabled: source !== undefined,
    refetchOnMount: 'always',
  })
  return (
    <DocPanel
      doc={{ ...doc, body: read.data?.body ?? doc.body }}
      onClose={onClose}
      {...(onOpen === undefined ? {} : { onOpen })}
      {...(read.isError ? { error: messageOf(read.error) } : {})}
    />
  )
}
