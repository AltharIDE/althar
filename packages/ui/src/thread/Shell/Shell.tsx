import { createContext, useContext, type ReactNode } from 'react'

import type { ModelInfo } from '../../primitives/Model/Model'
import type { StepState } from '../../foundations/vocabulary'
import type { FoundCode } from '../Code/code'

/*
 * What a thread's host offers the parts inside it: a side panel for reading
 * a document at full size, a lightbox for an image, a step's own thread.
 * Each is optional. A part whose control needs one the host does not offer
 * leaves that control out, so a part renders on its own in a story, and
 * never shows a button that does nothing.
 */

export interface DocRef {
  title?: string
  /** Where it is, as the person reads it. */
  path?: string
  /** Where the host reads it from, where that isn't its path as shown: its whole path, say. */
  source?: string
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

/**
 * What the host does with the code an agent names in what it says: finds
 * what each name names, where the thread's agent works; shows a peek at
 * it; opens it beside the thread, or in the person's editor.
 */
export interface CodeShell {
  /**
   * What a text's names name, by name: only those that are code; undefined
   * while the host looks. A hook, called once a render by each text that
   * has any such names, with the same names until its text changes.
   */
  useFound: (names: readonly string[]) => ReadonlyMap<string, FoundCode> | undefined
  /** What the peek over a name holds, as the host fills a CodePeek; `from` is the name it is over. */
  peek: (found: FoundCode, from: HTMLElement | null) => ReactNode
  /** Opens it beside the thread; `from` is the name pressed, which stepping through the thread's names goes on from. */
  open: (found: FoundCode, from: HTMLElement | null) => void
  /** Opens it in the person's editor, as ⌘-click on its name does. */
  openInEditor?: (found: FoundCode) => void
  /** The reference open beside the thread, as its `codeKey`: its chips show it open, and pressing one again closes it. */
  opened?: string | null
  close?: () => void
}

export interface ThreadShell {
  openDoc?: (doc: DocRef) => void
  /** Opens an image at full size; with the set it belongs to, such as a turn's screenshots, the others are a key away. */
  openImage?: (image: ImageRef, set?: readonly ImageRef[]) => void
  openStep?: (step: StepRef) => void
  /** The code an agent names: without it, a name in backticks is code text, as any other. */
  code?: CodeShell
}

const ThreadShellContext = createContext<ThreadShell>({})

/** The host's services, for every part inside. */
export function ThreadShellProvider({ value, children }: { value: ThreadShell; children: ReactNode }) {
  return <ThreadShellContext.Provider value={value}>{children}</ThreadShellContext.Provider>
}

export const useThreadShell = () => useContext(ThreadShellContext)
