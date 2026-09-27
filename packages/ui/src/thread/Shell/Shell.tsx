import { createContext, useContext, type ReactNode } from 'react'

import type { ModelInfo } from '../../foundations/Model/Model'
import type { StepState } from '../../foundations/vocabulary'

/*
 * What a thread's host provides to what is inside it: a side panel for
 * reading a document at full size, a lightbox for an image, a step's own
 * thread, and steering a running step. Everything has a harmless default, so
 * a part renders on its own in a story.
 */

export interface DocRef {
  title?: string
  path?: string
  /** Markdown blocks: paragraphs, headings, lists, code, quotes. */
  body: string[]
}

export interface ImageRef {
  name: string
  meta?: string
  label?: string
  /** What to show at full size; a stand-in in the prototype. */
  view?: ReactNode
}

export interface StepRef {
  id: string
  label: string
  model?: ModelInfo
  state?: StepState
}

export interface Steer {
  id: number
  step: StepRef
  text: string
}

export interface ThreadShell {
  openDoc: (doc: DocRef) => void
  openImage: (image: ImageRef) => void
  openStep: (step: StepRef) => void
  steers: Steer[]
  steer: (step: StepRef, text: string) => void
}

const noop = () => {}
export const Shell = createContext<ThreadShell>({ openDoc: noop, openImage: noop, openStep: noop, steers: [], steer: noop })
export const useShell = () => useContext(Shell)
