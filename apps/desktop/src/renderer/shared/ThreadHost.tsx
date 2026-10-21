import { useQuery } from '@tanstack/react-query'
import { type CSSProperties, useMemo, useState, type ReactNode } from 'react'

import {
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
import { type BenchWidth, useBenchWidth } from './code/bench'
import { type CodeOpen, useCodeHost } from './code/CodeHost'

/*
 * What a thread's screen offers the parts in it (the kit's ThreadShell): a
 * picture opens in the lightbox, with the rest of its set a key away; a
 * document, and a file an agent names, on the conversation's workbench
 * beside the thread, one at a time, as wide as the person drags it. A
 * document is read again as the agent edits it (DocumentPanel). Opening
 * another from the thread replaces what is there; a file opened from inside
 * the document goes on top of it, with Back. Escape or Close gives focus
 * back to what opened it.
 */

export interface ThreadHost {
  readonly shell: ThreadShell
  /** The lightbox, while a picture is open. */
  readonly lightbox: ReactNode
  /** The document open in the side panel, if one is. */
  readonly doc: DocRef | null
  readonly closeDoc: () => void
  /** The file open beside the thread, if one is. */
  readonly code: CodeOpen | null
  /** The workbench's width, as the person drags it. */
  readonly bench: BenchWidth
  /**
   * The workbench, with what is open on it: the document `docPanel` draws,
   * and the file open, on top of the document where it was opened from it;
   * nothing where neither is open. Where it opens over something to the
   * conversation's right, as the board beside it, it is dragged by its end.
   */
  readonly workbench: (
    docPanel: ReactNode,
    over?: { readonly max: number; readonly className?: string; readonly style?: CSSProperties },
  ) => ReactNode | undefined
}

/**
 * A thread's host; `documents` false where there is no panel to open one
 * in. With `code`, the thread whose agent's names open the code they name.
 */
export const useThreadHost = (
  documents = true,
  code: { readonly threadId: string | null; readonly taskId: string | null } | null = null,
): ThreadHost => {
  const [pictures, setPictures] = useState<{ readonly set: readonly ImageRef[]; readonly at: number } | null>(null)
  const [doc, setDoc] = useState<DocRef | null>(null)
  const [opened, setOpen] = useState<(CodeOpen & { readonly threadId: string | null }) | null>(null)
  const bench = useBenchWidth()
  const threadId = code?.threadId ?? null
  // The file open is the thread's: another thread's names name other files.
  const open = opened !== null && opened.threadId === threadId ? opened : null
  // A file opened from the thread takes the workbench; one opened from what is on it goes on top of it.
  const openCode = (found: FoundCode, from: HTMLElement | null) => {
    const onTop = from?.closest('[data-workbench]') != null
    if (!onTop) setDoc(null)
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
              setDoc(opened)
            },
          }
        : {}),
      ...(coded.shell === undefined ? {} : { code: coded.shell }),
    }),
    [documents, coded.shell],
  )
  const workbench: ThreadHost['workbench'] = (docPanel, over) => {
    const max = over?.max ?? bench.max
    const width = Math.min(bench.width, max)
    const file = coded.panel(width)
    if ((docPanel === null || docPanel === undefined || docPanel === false) && file === null) return undefined
    return (
      <Workbench
        width={width}
        min={bench.min}
        max={max}
        onWidth={bench.set}
        onCommit={bench.keep}
        onReset={bench.reset}
        edge={over === undefined ? 'start' : 'end'}
        {...(over?.className === undefined ? {} : { className: over.className })}
        {...(over?.style === undefined ? {} : { style: { ...over.style, width } })}
      >
        {/* What opens from inside it opens here too: a file the lead's document names. */}
        <ThreadShellProvider value={shell}>
          {docPanel !== null && docPanel !== undefined && docPanel !== false && <div hidden={file !== null}>{docPanel}</div>}
          {file}
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
    bench,
    workbench,
  }
}

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
