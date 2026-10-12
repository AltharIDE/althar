/// <reference lib="webworker" />
import { type Clear, drawLandscape } from './engrave'

/*
 * The footer's landscape, drawn off the page's main thread: thousands of
 * small marks take a while, and on the main thread they would stall
 * whatever moves on the page meanwhile. It answers each ask with the
 * picture, which the footer shows as it is.
 */

export interface Ask {
  id: number
  /** The canvas's size in CSS px, and the screen's density. */
  w: number
  h: number
  dpr: number
  clear: ReadonlyArray<Clear>
  paper: string
  mark: string
}

export type Answer = { id: number; picture: ImageBitmap } | { id: number; failed: string }

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = ({ data: ask }: MessageEvent<Ask>) => {
  try {
    const canvas = new OffscreenCanvas(Math.round(ask.w * ask.dpr), Math.round(ask.h * ask.dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.setTransform(ask.dpr, 0, 0, ask.dpr, 0, 0)
    drawLandscape(ctx, ask.w, ask.h, ask.clear, ask.paper, ask.mark)
    const picture = canvas.transferToImageBitmap()
    scope.postMessage({ id: ask.id, picture } satisfies Answer, [picture])
  } catch (error) {
    scope.postMessage({ id: ask.id, failed: String(error) } satisfies Answer)
  }
}
