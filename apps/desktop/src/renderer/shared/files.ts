import { type AttachedFile, MESSAGE_FILES } from '@althar/contracts'
import { AttachmentKind, type MessageAttachment } from '@althar/ui'

import { bytesText } from './handed'

/*
 * Files and folders the person sends with a message (ADR-060), as the window
 * shows them: a chip with its name and size, waiting in the composer and on
 * the sent message. Main measures each as it is added and grants it, so the
 * window never has its path; the runtime copies it where the agent reads as
 * the message goes.
 */

/** What main says of a file or folder added to a message (`main/attachments`): its grant, name and size; or why it can't go. */
export type Attached =
  | {
      readonly ok: true
      readonly grant: string
      readonly name: string
      readonly kind: 'file' | 'folder'
      readonly bytes: number
      readonly entries: number | null
    }
  | { readonly ok: false; readonly name: string; readonly why: 'too_large' | 'too_many_files' | 'unreadable' }

const MB = 1024 * 1024

export const text = {
  tooLarge: (name: string) => `${name} is larger than ${MESSAGE_FILES.bytes / MB} MB, so it can’t be sent.`,
  tooManyFiles: (name: string) => `${name} holds more than ${MESSAGE_FILES.entries.toLocaleString('en')} files, so it can’t be sent.`,
  unreadable: (name: string) => `Althar couldn’t read ${name}.`,
  tooMany: `A message can carry at most ${MESSAGE_FILES.count} files and folders.`,
  /** A queued message taken back to edit whose files wouldn't fit beside those waiting: it stays in the queue. */
  noRoom: `Its files don’t fit beside these: a message can carry at most ${MESSAGE_FILES.count} files and folders. Remove some first.`,
  stillReading: 'The files are still being read. Send again in a moment.',
  /** What a folder holds, beside its size. */
  entries: (n: number) => (n === 1 ? '1 file' : `${n.toLocaleString('en')} files`),
}

/** Why main refused one, in a line over the field. */
export const refusedText = (attached: Extract<Attached, { ok: false }>) =>
  attached.why === 'too_large'
    ? text.tooLarge(attached.name)
    : attached.why === 'too_many_files'
      ? text.tooManyFiles(attached.name)
      : text.unreadable(attached.name)

/** What a chip says beside a file's name: its size, or a folder's files and size. */
export const metaOf = (file: { readonly kind: 'file' | 'folder'; readonly bytes: number; readonly entries: number | null }) =>
  file.kind === 'folder' && file.entries !== null ? `${text.entries(file.entries)} · ${bytesText(file.bytes)}` : bytesText(file.bytes)

/** The files and folders a message was sent with, as the kit's You draws them: still, a chip each. */
export const fileAttachments = (files: ReadonlyArray<AttachedFile>): ReadonlyArray<MessageAttachment> =>
  files.map((file, index) => ({
    id: `${file.id}:${index}`,
    kind: file.kind === 'folder' ? AttachmentKind.Folder : AttachmentKind.File,
    name: file.name,
    meta: metaOf(file),
  }))
