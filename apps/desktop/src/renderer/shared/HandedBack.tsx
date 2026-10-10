import { useQuery } from '@tanstack/react-query'

import { FileArtifact, Shots } from '@althar/ui'

import { messageOf } from '../data/client'
import { reads } from '../data/reads'
import { useServices } from '../data/services'
import { bytesText, type Handed, type HandedFile } from './handed'

/*
 * What a turn handed back, standing under its words: its pictures as one set
 * of screenshots, which open in the lightbox; each markdown document it
 * wrote, read from the task's worktree as it is now, as a card whose preview
 * opens in the side panel; and each other file it pointed at, as a card.
 */

export interface HandedBackProps {
  readonly handed: Handed
  readonly threadId: string
  /** Where each file was last touched, so a document is read again after an edit. */
  readonly touched: ReadonlyMap<string, string>
  /** Opens a file of the task's in the person's editor, by its whole path; without it, there is no such button. */
  readonly openFile?: (path: string) => void
}

export function HandedBack({ handed, threadId, touched, openFile }: HandedBackProps) {
  return (
    <>
      {handed.pictures.length > 0 && <Shots items={handed.pictures} />}
      {handed.documents.map((file) => (
        <DocumentCard key={file.id} file={file} threadId={threadId} version={touched.get(file.shown) ?? ''} openFile={openFile} />
      ))}
      {handed.files.map((file) => (
        <FileArtifact
          key={file.id}
          path={file.shown}
          kind={file.kind}
          {...(file.size === null ? {} : { size: file.size })}
          {...(openFile === undefined || file.local === null ? {} : { onOpen: () => openFile(file.local ?? '') })}
        />
      ))}
    </>
  )
}

/** A markdown document the agent wrote, read from where it is now. */
function DocumentCard({
  file,
  threadId,
  version,
  openFile,
}: {
  file: HandedFile
  threadId: string
  version: string
  openFile: ((path: string) => void) | undefined
}) {
  const { client } = useServices()
  const read = useQuery(reads(client).document(threadId, file.shown, version))
  return (
    <FileArtifact
      path={file.shown}
      kind={file.kind}
      loading={read.isPending}
      {...(read.data === undefined ? {} : { body: read.data.body, size: bytesText(read.data.bytes), lines: read.data.lines })}
      {...(read.isError ? { error: messageOf(read.error) } : {})}
      {...(openFile === undefined || file.local === null ? {} : { onOpen: () => openFile(file.local ?? '') })}
    />
  )
}
