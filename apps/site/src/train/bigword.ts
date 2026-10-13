import type { Ctx } from './paint'
import { PASSER } from './passer'
import type { Box } from './world'

/*
 * The depth look's word, standing in the scene: beyond the glass, in front
 * of the landscape, and behind the other train, which passes in front of it
 * as anything on the next track would. It is drawn on the same canvas as the
 * train, under it, so the train's tail uncovers it in the very frame the
 * tail moves, sharp, with nothing to keep in step; and caught in the train's
 * wake, it is carried a little after it, settling as the air does.
 */

export interface BigWord {
  /** The word, drawn once for the size. */
  picture: HTMLCanvasElement
  /** Where the picture stands, padding included, in the first screen's CSS px. */
  box: Box
  /** The word's own left and right edges, without the padding. */
  left: number
  right: number
}

/** Px around the word for its shadow. */
const PAD = 72
/** How far the wake carries it, in its own widths, and how quickly it settles (per second). */
const WAKE = { reach: 0.05, settle: 5.5 }

/**
 * Paints the word for the size: as large as the window allows across its
 * middle, its top a third of the way down the glass; on a phone, set to the
 * screen's right edge, as the window runs off both sides.
 */
export function bakeWord(text: string, win: Box, width: number, dpr: number): BigWord | null {
  const phone = width < 760
  const size = phone ? width * 0.37 : Math.min(win.w * 0.4, width * 0.44)
  const font = `800 ${size.toFixed(1)}px "Inter Display", "Inter Variable", Inter, system-ui, sans-serif`
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) return null
  probe.font = font
  const tracking = -0.06 * size
  const spaced = 'letterSpacing' in probe
  if (spaced) probe.letterSpacing = `${tracking.toFixed(1)}px`
  // Letter by letter where the canvas can't track type itself; the last letter's tracking isn't part of the word.
  const letters = text.split('')
  const advance = (c: CanvasRenderingContext2D) =>
    spaced ? c.measureText(text).width - tracking : letters.reduce((w, ch) => w + c.measureText(ch).width + tracking, -tracking)
  const m = probe.measureText(text)
  const wide = advance(probe)
  const ascent = m.actualBoundingBoxAscent
  const descent = m.actualBoundingBoxDescent
  const left = phone ? width - 14 - wide : win.x + (win.w - wide) / 2
  const top = win.y + win.h * (phone ? 0.36 : 0.37)
  const box = { x: left - PAD, y: top - PAD, w: wide + PAD * 2, h: ascent + descent + PAD * 2 }

  const picture = document.createElement('canvas')
  picture.width = Math.ceil(box.w * dpr)
  picture.height = Math.ceil(box.h * dpr)
  const c = picture.getContext('2d')
  if (!c) return null
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.font = font
  if (spaced) c.letterSpacing = `${tracking.toFixed(1)}px`
  c.fillStyle = '#fff'
  // A soft shadow under it, as the page's type has against the sky.
  c.shadowColor = 'rgba(6, 18, 60, 0.24)'
  c.shadowBlur = 40 * dpr
  c.shadowOffsetY = 10 * dpr
  const base = PAD + ascent
  if (spaced) c.fillText(text, PAD, base)
  else {
    let x = PAD
    for (const ch of letters) {
      c.fillText(ch, x, base)
      x += c.measureText(ch).width + tracking
    }
  }
  return { picture, box, left, right: left + wide }
}

/** When the other train's nose has passed the whole word, so it can stand there behind it, and when its tail reaches the word. */
export function wordBeats(word: BigWord, win: Box) {
  const speed = win.w / PASSER.cross
  const start = win.x + win.w + 40
  const tail = start + speed * PASSER.body
  return {
    behind: PASSER.at + (start - word.box.x) / speed,
    reached: PASSER.at + (tail - word.right) / speed,
  }
}

/** Whether the word is still moving at second `t`: from when it stands behind the train until the wake has settled. */
export function wordMoving(word: BigWord, win: Box, t: number) {
  const { behind, reached } = wordBeats(word, win)
  return t >= behind - 0.05 && t < reached + 6 / WAKE.settle
}

/**
 * Draws the word for second `t`, under what is on the canvas already: not
 * there until the other train covers it; then carried left in its wake as
 * its tail uncovers it, easing to a stop.
 */
export function drawWord(ctx: Ctx, word: BigWord, win: Box, t: number) {
  const { behind, reached } = wordBeats(word, win)
  if (t < behind) return
  const wake = (word.right - word.left) * WAKE.reach * (t < reached ? 1 : Math.exp(-(t - reached) * WAKE.settle))
  const { box } = word
  ctx.globalCompositeOperation = 'destination-over'
  ctx.drawImage(word.picture, box.x + wake, box.y, box.w, box.h)
  ctx.globalCompositeOperation = 'source-over'
}
