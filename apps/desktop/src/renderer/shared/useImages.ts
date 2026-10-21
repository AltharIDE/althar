import { type AgentModels, MESSAGE_IMAGES, type Picture, type SentImage } from '@althar/contracts'
import type { ComposerImage } from '@althar/ui'
import { useState } from 'react'

import { pictureUrl } from '../../main/pictureAddress'
import { nextImageId as next, setDraftDictated, setDraftImages, useDraftOf } from './drafts'
import { pictureOf, previewOf, readImage, remember, type Shrink, sentOf, shrinkInWindow, text } from './images'

/*
 * The images waiting to go with what the person writes in one composer:
 * read as they are added, shown small, taken off, and sent with the
 * message. The agent that would get them says whether it takes images (its
 * models' `images`): where it says it doesn't, none are added, and any added
 * before it was picked hold the message back with a word of why, rather
 * than going nowhere. Where it hasn't said, they go, and the runtime says in
 * the thread if they weren't passed on.
 */

/** The agent a message would go to: its name, and whether it takes images (null where it hasn't said). */
export interface Receiver {
  readonly name: string
  readonly takes: boolean | null
}

/** Whether an agent takes images, as its models say; null where it hasn't said, or there is no agent to say. */
export const takesImages = (models: ReadonlyArray<AgentModels> | null, agentId: string | null): boolean | null =>
  models?.find((agent) => agent.agentId === agentId)?.images ?? null

/** What goes with a message: the images as sent, and as its window copy names them. */
export interface Outgoing {
  readonly sent: ReadonlyArray<SentImage>
  readonly pictures: ReadonlyArray<Picture>
  /** Some of its words were dictated, even if edited after: the agent is told so. Set with the images, so each send carries it. */
  readonly dictated?: boolean
}

/** What a send or a switch carries of a message's images and of its being dictated: nothing where it has none, as before images. */
export const sentWith = (images: Outgoing | undefined): { readonly images?: ReadonlyArray<SentImage>; readonly dictated?: boolean } => ({
  ...(images === undefined || images.sent.length === 0 ? {} : { images: images.sent }),
  ...(images?.dictated === true ? { dictated: true } : {}),
})

/** What goes again with a queued message: its images by their digests, the store keeping them, and its being dictated. */
export const outgoingOf = (said: { readonly pictures: ReadonlyArray<Picture>; readonly dictated?: boolean }): Outgoing => {
  const kept = said.pictures.flatMap((picture, index) =>
    picture.digest === null ? [] : [{ picture: { ...picture, digest: picture.digest }, name: picture.name ?? text.image(index + 1) }],
  )
  return {
    sent: kept.map(({ picture, name }) => sentOf({ data: null, digest: picture.digest, name })),
    pictures: kept.map(({ picture }) => picture),
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

export interface Images {
  /** What the composer takes, for the agent the message would go to. */
  readonly props: (receiver: Receiver) => {
    readonly images: ReadonlyArray<ComposerImage>
    readonly onAddImages: (files: ReadonlyArray<File>) => void
    readonly onRemoveImage: (id: string) => void
    readonly imageNote?: string
  }
  /** What goes with a message now; null where it can't go yet, with the composer saying why. */
  readonly take: (receiver: Receiver) => Outgoing | null
  /** Takes every image off, once its message is sent. */
  readonly clear: () => void
  /** Puts back what went with a message Althar didn't take, before any added since, bytes and all, to send again. */
  readonly giveBack: (outgoing: Outgoing) => void
  /** Whether a queued message's images fit beside those waiting, to take it back to edit; saying why not where they don't. */
  readonly fits: (pictures: ReadonlyArray<Picture>) => boolean
  /** Puts back the images of a message taken back from the queue, after any already there. */
  readonly restore: (pictures: ReadonlyArray<Picture>) => void
}

/** The images waiting in the draft kept under `key` (`drafts.ts`). */
export function useImages(key: string, shrink: Shrink = shrinkInWindow): Images {
  const { images: waiting, dictated } = useDraftOf<Waiting>(key)
  const setWaiting = (change: (now: ReadonlyArray<Waiting>) => ReadonlyArray<Waiting>) => setDraftImages(key, change)
  const [note, setNote] = useState<string | null>(null)

  const add = (files: ReadonlyArray<File>, receiver: Receiver) => {
    if (receiver.takes === false) return setNote(text.refused(receiver.name))
    const room = Math.max(0, MESSAGE_IMAGES.count - waiting.length)
    setNote(files.length > room ? text.tooMany : null)
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

  const props = (receiver: Receiver) => {
    // Waiting for an agent that doesn't take them, they hold the message back, and say so before it is sent.
    const shown = waiting.length > 0 && receiver.takes === false ? text.blocked(receiver.name) : note
    return {
      images: waiting.map((one): ComposerImage => ({
        id: one.id,
        name: one.name,
        ...(one.ready === null ? { reading: true } : { src: one.ready.src }),
      })),
      onAddImages: (files: ReadonlyArray<File>) => add(files, receiver),
      onRemoveImage: (id: string) => {
        setNote(null)
        setWaiting((now) => now.filter((one) => one.id !== id))
      },
      ...(shown === null ? {} : { imageNote: shown }),
    }
  }

  const take = (receiver: Receiver): Outgoing | null => {
    if (waiting.length > 0 && receiver.takes === false) return null
    // More than a message carries, as after one given back beside others added meanwhile: none is dropped, and the person picks.
    if (waiting.length > MESSAGE_IMAGES.count) {
      setNote(text.tooMany)
      return null
    }
    if (waiting.some((one) => one.ready === null)) {
      setNote(text.stillReading)
      return null
    }
    // Each by the name it shows under, which its picture carries too.
    const ready = waiting.flatMap((one) =>
      one.ready === null ? [] : [{ ...one.ready, picture: { ...one.ready.picture, name: one.name } }],
    )
    // Drawn from its own bytes in the thread, the moment it is sent.
    for (const one of ready) if (one.data !== null) remember(one.picture.digest, one.src)
    return {
      sent: ready.map((one) => sentOf({ data: one.data, digest: one.picture.digest, name: one.picture.name })),
      pictures: ready.map((one) => one.picture),
      ...(dictated ? { dictated: true } : {}),
    }
  }

  return {
    props,
    take,
    clear: () => {
      setNote(null)
      setWaiting(() => [])
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
      // Its words came back in the composer: so did their being dictated.
      if (outgoing.dictated === true) setDraftDictated(key, true)
    },
    fits: (pictures) => {
      const kept = pictures.filter((picture) => picture.digest !== null).length
      if (waiting.length + kept <= MESSAGE_IMAGES.count) return true
      setNote(text.noRoom)
      return false
    },
    restore: (pictures) => {
      // Kept by the store, they go again by their digests.
      const kept = pictures.flatMap((picture) => (picture.digest === null ? [] : [{ ...picture, digest: picture.digest }]))
      setWaiting((now) => [
        ...now,
        ...kept.map((picture, index) => ({
          id: next(),
          name: picture.name ?? text.image(index + 1),
          ready: { data: null, picture, src: previewOf(picture.digest) ?? pictureUrl(picture.digest, true) },
        })),
      ])
    },
  }
}
