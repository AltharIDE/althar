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
  /** Where the image is. */
  src?: string
  /** Something to draw in place of an image, when there is no src. */
  view?: ReactNode
}

export interface StepRef {
  id: string
  label: string
  model?: ModelInfo
  state?: StepState
}

export interface ThreadShell {
  openDoc?: (doc: DocRef) => void
  openImage?: (image: ImageRef) => void
  openStep?: (step: StepRef) => void
}

const ThreadShellContext = createContext<ThreadShell>({})

/** The host's services, for every part inside. */
export function ThreadShellProvider({ value, children }: { value: ThreadShell; children: ReactNode }) {
  return <ThreadShellContext.Provider value={value}>{children}</ThreadShellContext.Provider>
}

export const useThreadShell = () => useContext(ThreadShellContext)
