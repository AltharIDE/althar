import { createContext, useContext, type ReactNode } from 'react'

import type { ModelInfo } from '../../primitives/Model/Model'
import type { StepState } from '../../foundations/vocabulary'

/*
 * What a thread's host offers the parts inside it: a side panel for reading
 * a document at full size, a lightbox for an image, a step's own thread.
 * Each is optional. A part whose control needs one the host does not offer
 * leaves that control out, so a part renders on its own in a story, and
 * never shows a button that does nothing.
 */

export interface DocRef {
  title?: string
  path?: string
  /** The document, as markdown. */
  body: string
}

export interface ImageRef {
  name: string
  meta?: string
  /** What the picture shows, in words: its alternative text. Without it, its name. */
  alt?: string
  /** A caption to show in place of the name. */
  label?: string
  /** Where the image is, at full size. */
  src?: string
  /** A smaller copy, for where it shows small, as in Shots. Without it, src. */
  thumb?: string
  /** Its size in pixels, when known, so its box has its shape before it loads. */
  width?: number
  height?: number
  /**
   * What the host already knows of it: still on its way, or not to be had
   * (with `meta` saying why). Without it, the picture says itself as it loads.
   */
  status?: ImageStatus
  /** Something to draw in place of an image, when there is no src. */
  view?: ReactNode
}

/** Where an image stands, when the host knows before the picture loads. */
export type ImageStatus = 'loading' | 'failed'

export interface StepRef {
  id: string
  label: string
  model?: ModelInfo
  state?: StepState
}

export interface ThreadShell {
  openDoc?: (doc: DocRef) => void
  /** Opens an image at full size; with the set it belongs to, such as a turn's screenshots, the others are a key away. */
  openImage?: (image: ImageRef, set?: readonly ImageRef[]) => void
  openStep?: (step: StepRef) => void
}

const ThreadShellContext = createContext<ThreadShell>({})

/** The host's services, for every part inside. */
export function ThreadShellProvider({ value, children }: { value: ThreadShell; children: ReactNode }) {
  return <ThreadShellContext.Provider value={value}>{children}</ThreadShellContext.Provider>
}

export const useThreadShell = () => useContext(ThreadShellContext)
