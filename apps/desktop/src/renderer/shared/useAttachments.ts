import {
  type AgentModels,
  type AttachedFile,
  MESSAGE_FILES,
  MESSAGE_IMAGES,
  type Picture,
  type SentFile,
  type SentImage,
} from '@althar/contracts'
import type { AddedBy, ComposerFile, ComposerImage } from '@althar/ui'
import { useState } from 'react'

import { pictureUrl } from '../../main/pictureAddress'
import type { Host } from '../data/services'
import { nextImageId as next, setDraftDictated, setDraftFiles, setDraftImages, useDraftOf } from './drafts'
import { type Attached, metaOf, refusedText, text as filesText } from './files'
import { pictureOf, previewOf, readImage, remember, type Shrink, sentOf, shrinkInWindow, text } from './images'

/*
 * What waits to go with what the person writes in one composer: images and
 * files, read as they are added, shown, taken off, and sent with the
 * message. An image (PNG, JPEG, GIF, WebP) is read here and drawn small, and
 * goes as an image to an agent that takes them (its models' `images`); any
 * other file, a folder, or an image for an agent that says it doesn't take
 * them, goes as a file: main measures it and grants it (`main/attachments`),
 * and the runtime copies it where the agent reads as the message goes
 * (ADR-062). An image with no file behind it, as a pasted screenshot, can't
 * go as a file: for an agent that doesn't take images, it is refused, and
 * any added before that agent was picked hold the message back with a word
 * of why, rather than going nowhere. Where the agent hasn't said, images go,
 * and the runtime says in the thread if they weren't passed on.
 */

/** The agent a message would go to: its name, and whether it takes images (null where it hasn't said). */
export interface Receiver {
  readonly name: string
  readonly takes: boolean | null
}

/** Whether an agent takes images, as its models say; null where it hasn't said, or there is no agent to say. */
export const takesImages = (models: ReadonlyArray<AgentModels> | null, agentId: string | null): boolean | null =>
  models?.find((agent) => agent.agentId === agentId)?.images ?? null

/** What goes with a message: the images as sent, and as its window copy names them; and the files so. */
export interface Outgoing {
  readonly sent: ReadonlyArray<SentImage>
  readonly pictures: ReadonlyArray<Picture>
  readonly files: ReadonlyArray<SentFile>
  /** The files as the window's copy of the message shows them, until the store's arrives. */
  readonly attached: ReadonlyArray<AttachedFile>
  /** Some of its words were dictated, even if edited after: the agent is told so. Set with the images, so each send carries it. */
  readonly dictated?: boolean
}

/** What a send or a switch carries of a message's images and files and of its being dictated: nothing where it has none. */
export const sentWith = (
  outgoing: Outgoing | undefined,
): { readonly images?: ReadonlyArray<SentImage>; readonly files?: ReadonlyArray<SentFile>; readonly dictated?: boolean } => ({
  ...(outgoing === undefined || outgoing.sent.length === 0 ? {} : { images: outgoing.sent }),
  ...(outgoing === undefined || outgoing.files.length === 0 ? {} : { files: outgoing.files }),
  ...(outgoing?.dictated === true ? { dictated: true } : {}),
})

/** What a queued message went with, as its item says. */
export interface Said {
  readonly pictures: ReadonlyArray<Picture>
  readonly files: ReadonlyArray<AttachedFile>
  readonly dictated?: boolean
}

/** What goes again with a queued message: its images by their digests and its files by their copies, which Althar keeps, and its being dictated. */
export const outgoingOf = (said: Said): Outgoing => {
  const kept = said.pictures.flatMap((picture, index) =>
    picture.digest === null ? [] : [{ picture: { ...picture, digest: picture.digest }, name: picture.name ?? text.image(index + 1) }],
  )
  return {
    sent: kept.map(({ picture, name }) => sentOf({ data: null, digest: picture.digest, name })),
    pictures: kept.map(({ picture }) => picture),
    files: said.files.map((file) => ({ kept: file.id })),
    attached: said.files,
    ...(said.dictated === true ? { dictated: true } : {}),
  }
}

/** An image waiting in a thread's draft. */
export interface Waiting {
  readonly id: string
  readonly name: string
  /** Null while it is read. */
  readonly ready: { readonly data: string | null; readonly picture: Picture & { readonly digest: string }; readonly src: string } | null
}

/** A file or folder waiting in a thread's draft. */
export interface WaitingFile {
  readonly id: string
  readonly name: string
  /** Null while main measures it. */
  readonly ready: { readonly sent: SentFile; readonly attached: AttachedFile } | null
}

/** What adds files: main, which measures and grants each (`Host.attach`), and reads those copied in the file manager off the clipboard. */
export type Attacher = Pick<Host, 'attach' | 'attachPasted'>

/** The kinds the window reads and draws as images; any other file goes as a file. */
const PICTURE_TYPES: ReadonlyArray<string> = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export interface Attachments {
  /** What the composer takes, for the agent the message would go to. */
  readonly props: (receiver: Receiver) => {
    readonly images: ReadonlyArray<ComposerImage>
    readonly files: ReadonlyArray<ComposerFile>
    readonly onAddFiles: (files: ReadonlyArray<File>, how?: AddedBy) => void
    readonly onRemoveImage: (id: string) => void
    readonly onRemoveFile: (id: string) => void
    readonly fileNote?: string
  }
  /** What goes with a message now; null where it can't go yet, with the composer saying why. */
  readonly take: (receiver: Receiver) => Outgoing | null
  /** Takes every image and file off, once its message is sent. */
  readonly clear: () => void
  /** Puts back what went with a message Althar didn't take, before any added since, bytes and all, to send again. */
  readonly giveBack: (outgoing: Outgoing) => void
  /** Whether a queued message's images and files fit beside those waiting, to take it back to edit; saying why not where they don't. */
  readonly fits: (said: Said) => boolean
  /** Puts back the images and files of a message taken back from the queue, after any already there. */
  readonly restore: (said: Said) => void
}

/** A file main measured and granted, as it waits to go and as the window's copy of its message shows it. */
const readyOf = (attached: Extract<Attached, { ok: true }>): NonNullable<WaitingFile['ready']> => ({
  sent: { grant: attached.grant },
  attached: {
    id: attached.grant,
    name: attached.name,
    kind: attached.kind,
    mediaType: null,
    bytes: attached.bytes,
    entries: attached.entries,
    // Where its copy will be is the runtime's to say.
    path: '',
  },
})

/** The images and files waiting in the draft kept under `key` (`drafts.ts`). */
export function useAttachments(key: string, host: Attacher, shrink: Shrink = shrinkInWindow): Attachments {
  const { images: waiting, files: waitingFiles, dictated } = useDraftOf<Waiting, WaitingFile>(key)
  const setWaiting = (change: (now: ReadonlyArray<Waiting>) => ReadonlyArray<Waiting>) => setDraftImages(key, change)
  const setFiles = (change: (now: ReadonlyArray<WaitingFile>) => ReadonlyArray<WaitingFile>) => setDraftFiles(key, change)
  const [note, setNote] = useState<string | null>(null)

  const addImages = (files: ReadonlyArray<File>) => {
    const room = Math.max(0, MESSAGE_IMAGES.count - waiting.length)
    if (files.length > room) setNote(text.tooMany)
    const reading = files.slice(0, room).map((file) => ({ file, id: next() }))
    setWaiting((now) => [
      ...now,
      ...reading.map(({ file, id }) => ({ id, name: file.name.trim() === '' ? text.pasted : file.name, ready: null })),
    ])
    for (const { file, id } of reading)
      void readImage(file, shrink).then((read) => {
        if (!read.ok) {
          setNote(read.note)
          return setWaiting((now) => now.filter((one) => one.id !== id))
        }
        const { image } = read
        setWaiting((now) =>
          now.map((one) =>
            one.id === id
              ? {
                  id,
                  name: image.name,
                  ready: { data: image.data, picture: { ...pictureOf(image), digest: image.digest }, src: image.src },
                }
              : one,
          ),
        )
      })
  }

  /** Files main is asked of, each shown as it is measured; one it refuses goes, and the line says why: `unread`, where it has no file behind it. */
  const addFiles = (
    asked: ReadonlyArray<{ readonly name: string; readonly read: () => Promise<Attached | null>; readonly unread?: string }>,
  ) => {
    const room = Math.max(0, MESSAGE_FILES.count - waitingFiles.length)
    if (asked.length > room) setNote(filesText.tooMany)
    const reading = asked.slice(0, room).map((one) => ({ ...one, id: next() }))
    setFiles((now) => [...now, ...reading.map(({ id, name }) => ({ id, name, ready: null }))])
    for (const { id, name, read, unread } of reading)
      void read()
        .catch(() => null)
        .then((attached) => {
          if (attached === null || !attached.ok) {
            setNote(attached === null ? (unread ?? filesText.unreadable(name)) : refusedText(attached))
            return setFiles((now) => now.filter((one) => one.id !== id))
          }
          setFiles((now) => now.map((one) => (one.id === id ? { id, name: attached.name, ready: readyOf(attached) } : one)))
        })
  }

  const add = async (files: ReadonlyArray<File>, receiver: Receiver, how: AddedBy) => {
    setNote(null)
    // Copied in the file manager and pasted: the clipboard names the files, which go as dropped, whatever picture of them the page has.
    if (how === 'paste') {
      const copied = await host.attachPasted().catch(() => [])
      if (copied.length > 0) {
        // A picture among them is an image, read from its own bytes, for an agent that takes them; anything else, a file.
        const images = receiver.takes === false ? [] : copied.flatMap((one) => (one.ok && one.picture !== undefined ? [one] : []))
        if (images.length > 0)
          addImages(images.map((one) => new File([new Uint8Array(one.picture?.data ?? [])], one.name, { type: one.picture?.type ?? '' })))
        const rest = copied.filter((one) => !images.some((image) => image === one))
        if (rest.length > 0) addFiles(rest.map((attached) => ({ name: attached.name, read: () => Promise.resolve(attached) })))
        return
      }
    }
    const pictured = (file: File) => PICTURE_TYPES.includes(file.type)
    // An image for an agent that doesn't take them goes as a file, where there is one behind it.
    const asImages = receiver.takes === false ? [] : files.filter(pictured)
    const asFiles = files.filter((file) => !asImages.includes(file))
    if (asImages.length > 0) addImages(asImages)
    if (asFiles.length === 0) return
    addFiles(
      asFiles.map((file) => ({
        name: file.name.trim() === '' && pictured(file) ? text.pasted : file.name,
        read: () => host.attach(file),
        // A picture with nothing behind it, as a pasted screenshot, can't go as a file to an agent that doesn't take images.
        ...(pictured(file) ? { unread: text.refused(receiver.name) } : {}),
      })),
    )
  }

  const props = (receiver: Receiver) => {
    // Waiting for an agent that doesn't take them, images hold the message back, and say so before it is sent.
    const shown = waiting.length > 0 && receiver.takes === false ? text.blocked(receiver.name) : note
    return {
      images: waiting.map((one): ComposerImage => ({
        id: one.id,
        name: one.name,
        ...(one.ready === null ? { reading: true } : { src: one.ready.src }),
      })),
      files: waitingFiles.map((one): ComposerFile => ({
        id: one.id,
        name: one.name,
        ...(one.ready === null
          ? { reading: true }
          : { meta: metaOf(one.ready.attached), ...(one.ready.attached.kind === 'folder' ? { folder: true } : {}) }),
      })),
      onAddFiles: (files: ReadonlyArray<File>, how: AddedBy = 'drop') => void add(files, receiver, how),
      onRemoveImage: (id: string) => {
        setNote(null)
        setWaiting((now) => now.filter((one) => one.id !== id))
      },
      onRemoveFile: (id: string) => {
        setNote(null)
        setFiles((now) => now.filter((one) => one.id !== id))
      },
      ...(shown === null ? {} : { fileNote: shown }),
    }
  }

  const take = (receiver: Receiver): Outgoing | null => {
    if (waiting.length > 0 && receiver.takes === false) return null
    // More than a message carries, as after one given back beside others added meanwhile: none is dropped, and the person picks.
    if (waiting.length > MESSAGE_IMAGES.count) {
      setNote(text.tooMany)
      return null
    }
    if (waitingFiles.length > MESSAGE_FILES.count) {
      setNote(filesText.tooMany)
      return null
    }
    if (waiting.some((one) => one.ready === null)) {
      setNote(text.stillReading)
      return null
    }
    if (waitingFiles.some((one) => one.ready === null)) {
      setNote(filesText.stillReading)
      return null
    }
    // Each by the name it shows under, which its picture carries too.
    const ready = waiting.flatMap((one) =>
      one.ready === null ? [] : [{ ...one.ready, picture: { ...one.ready.picture, name: one.name } }],
    )
    const files = waitingFiles.flatMap((one) => (one.ready === null ? [] : [one.ready]))
    // Drawn from its own bytes in the thread, the moment it is sent.
    for (const one of ready) if (one.data !== null) remember(one.picture.digest, one.src)
    return {
      sent: ready.map((one) => sentOf({ data: one.data, digest: one.picture.digest, name: one.picture.name })),
      pictures: ready.map((one) => one.picture),
      files: files.map((one) => one.sent),
      attached: files.map((one) => one.attached),
      ...(dictated ? { dictated: true } : {}),
    }
  }

  return {
    props,
    take,
    clear: () => {
      setNote(null)
      setWaiting(() => [])
      setFiles(() => [])
    },
    giveBack: (outgoing) => {
      const given = outgoing.pictures.flatMap((picture, index): ReadonlyArray<Waiting> => {
        const sent = outgoing.sent[index]
        if (picture.digest === null || sent === undefined) return []
        const data = 'data' in sent ? sent.data : null
        const src =
          data === null ? (previewOf(picture.digest) ?? pictureUrl(picture.digest, true)) : `data:${picture.mediaType};base64,${data}`
        return [{ id: next(), name: picture.name ?? text.pasted, ready: { data, picture: { ...picture, digest: picture.digest }, src } }]
      })
      setWaiting((now) => [...given, ...now])
      const files = outgoing.attached.flatMap((attached, index): ReadonlyArray<WaitingFile> => {
        const sent = outgoing.files[index]
        return sent === undefined ? [] : [{ id: next(), name: attached.name, ready: { sent, attached } }]
      })
      setFiles((now) => [...files, ...now])
      // Its words came back in the composer: so did their being dictated.
      if (outgoing.dictated === true) setDraftDictated(key, true)
    },
    fits: (said) => {
      const kept = said.pictures.filter((picture) => picture.digest !== null).length
      if (waiting.length + kept > MESSAGE_IMAGES.count) {
        setNote(text.noRoom)
        return false
      }
      if (waitingFiles.length + said.files.length > MESSAGE_FILES.count) {
        setNote(filesText.noRoom)
        return false
      }
      return true
    },
    restore: (said) => {
      // Kept by the store, they go again by their digests; the files by the copies Althar made of them.
      const kept = said.pictures.flatMap((picture) => (picture.digest === null ? [] : [{ ...picture, digest: picture.digest }]))
      setWaiting((now) => [
        ...now,
        ...kept.map((picture, index) => ({
          id: next(),
          name: picture.name ?? text.image(index + 1),
          ready: { data: null, picture, src: previewOf(picture.digest) ?? pictureUrl(picture.digest, true) },
        })),
      ])
      setFiles((now) => [
        ...now,
        ...said.files.map((attached) => ({ id: next(), name: attached.name, ready: { sent: { kept: attached.id }, attached } })),
      ])
    },
  }
}
