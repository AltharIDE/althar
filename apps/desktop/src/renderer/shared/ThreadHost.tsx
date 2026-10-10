import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'

import { DocPanel, type DocRef, type ImageRef, Lightbox, type ThreadShell } from '@althar/ui'

import { messageOf } from '../data/client'
import { reads } from '../data/reads'
import { useServices } from '../data/services'

/*
 * What a thread's screen offers the parts in it (the kit's ThreadShell): a
 * picture opens in the lightbox, with the rest of its set a key away, and a
 * document in the side panel beside the thread, where the kit puts one,
 * read again as the agent edits it (DocumentPanel). Opening another
 * replaces it; Escape or Close gives focus back to what opened it.
 */

export interface ThreadHost {
  readonly shell: ThreadShell
  /** The lightbox, while a picture is open. */
  readonly lightbox: ReactNode
  /** The document open in the side panel, if one is. */
  readonly doc: DocRef | null
  readonly closeDoc: () => void
}

/** A thread's host; `documents` false where there is no panel to open one in. */
export const useThreadHost = (documents = true): ThreadHost => {
  const [pictures, setPictures] = useState<{ readonly set: readonly ImageRef[]; readonly at: number } | null>(null)
  const [doc, setDoc] = useState<DocRef | null>(null)
  const shell = useMemo<ThreadShell>(
    () => ({
      openImage: (image, set = [image]) => setPictures({ set, at: Math.max(set.indexOf(image), 0) }),
      ...(documents ? { openDoc: setDoc } : {}),
    }),
    [documents],
  )
  return {
    shell,
    lightbox: pictures && <Lightbox images={pictures.set} defaultIndex={pictures.at} onClose={() => setPictures(null)} />,
    doc,
    closeDoc: () => setDoc(null),
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
  /** Where the document was last touched in the thread: a new one reads it again. */
  version: string
  onClose: () => void
  /** Opens it in the person's editor; without it, there is no such button. */
  onOpen?: () => void
}) {
  const { client } = useServices()
  // Read by which file it is, where the card said; otherwise by its path.
  const source = doc.source ?? doc.path
  const read = useQuery({ ...reads(client).document(threadId, source ?? '', version), enabled: source !== undefined })
  return (
    <DocPanel
      doc={{ ...doc, body: read.data?.body ?? doc.body }}
      onClose={onClose}
      {...(onOpen === undefined ? {} : { onOpen })}
      {...(read.isError ? { error: messageOf(read.error) } : {})}
    />
  )
}
