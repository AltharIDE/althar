/*
 * One of the project's canvases (ADR-104), as the kit draws it: what its
 * agents drew for the person to look at and iterate on. The kit draws the
 * canvas's line in a thread, its panel beside the conversation and the
 * project's list of them; the host draws what is on it (a document, a
 * diagram, a picture or a page) and says what was said on it.
 */

/** How a canvas is drawn: a document, a diagram, an SVG, a picture or a page of its own. */
export type CanvasKind = 'markdown' | 'mermaid' | 'svg' | 'picture' | 'html'

/** A canvas as a thread's part names it, to open it beside the conversation: a version, or the latest. */
export interface CanvasRef {
  readonly canvasId: string
  readonly name: string
  readonly title: string
  readonly kind: CanvasKind
  /** A version to open at; the latest where it is null. */
  readonly version: number | null
}

/** What a kind is called, as a canvas's facts say it. */
export const canvasKindWords: Readonly<Record<CanvasKind, string>> = {
  markdown: 'Document',
  mermaid: 'Diagram',
  svg: 'Drawing',
  picture: 'Picture',
  html: 'Page',
}
