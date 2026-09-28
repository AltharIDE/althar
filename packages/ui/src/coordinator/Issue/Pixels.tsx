import { useEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import s from './Pixels.module.css'

/*
 * A field of small squares in the card's ink, each fading in and out on its
 * own beat. It sits behind the right of the card and thins out before it
 * reaches the text. It is decoration, so it holds one still frame until the
 * card is pointed at or focused, and always for reduced motion. While it
 * plays, it draws to a canvas at a low frame rate and pauses while off
 * screen; while it holds still, nothing runs. Its colour is the canvas's CSS
 * colour, so the card decides it, and it is read again when it resizes or
 * starts to play.
 */

interface Cell {
  speed: number
  phase: number
  peak: number
}

export interface PixelsProps {
  cell?: number
  gap?: number
  fps?: number
  /** Moving; otherwise one still frame. */
  playing?: boolean
  className?: string
}

interface Field {
  /** Draw the field at its own time. */
  draw: () => void
  /** Read the canvas's colour again. */
  recolour: () => void
  /** Whether it can move at all: not for reduced motion, nor without observers. */
  moves: boolean
  visible: boolean
  /** The field's own time, which only runs while it plays, so it picks up where it stopped. */
  clock: number
}

export function Pixels({ cell = 5, gap = 2, fps = 18, playing = false, className }: PixelsProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const field = useRef<Field | null>(null)

  /* the field itself: its size, its squares, one still frame, and what keeps it current */
  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    let cols = 0
    let rows = 0
    let cells: Cell[] = []
    /* read each time it draws a new size or starts, so a change of theme is picked up */
    let rgb = '0, 0, 0'
    const colour = () => {
      rgb = (getComputedStyle(cv).color.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).join(', ')
    }
    const size = () => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = cv.getBoundingClientRect()
      cv.width = Math.round(width * dpr)
      cv.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.ceil(width / (cell + gap))
      rows = Math.ceil(height / (cell + gap))
      /* each square gets its own speed and phase; about a third are dormant, so the field breathes in patches */
      cells = Array.from({ length: cols * rows }, () => ({
        speed: 0.4 + Math.random() * 1.3,
        phase: Math.random() * Math.PI * 2,
        peak: Math.random() < 0.34 ? 0.05 : 0.18 + Math.random() * 0.5,
      }))
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const observed = typeof ResizeObserver !== 'undefined' && typeof IntersectionObserver !== 'undefined'
    const f: Field = {
      moves: !still && observed,
      visible: true,
      clock: 2400,
      recolour: colour,
      draw: () => {
        ctx.clearRect(0, 0, cv.width, cv.height)
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const c = cells[y * cols + x]
            if (!c) continue
            const a = c.peak * Math.pow(0.5 + 0.5 * Math.sin(f.clock * 0.001 * c.speed + c.phase), 3)
            if (a < 0.015) continue
            ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`
            ctx.fillRect(x * (cell + gap), y * (cell + gap), cell, cell)
          }
        }
      },
    }
    field.current = f
    colour()
    size()
    f.draw()
    if (!observed) return
    /* a resize clears the canvas, so the frame is drawn again */
    const ro = new ResizeObserver(() => {
      colour()
      size()
      f.draw()
    })
    ro.observe(cv)
    const io = new IntersectionObserver(([e]) => {
      f.visible = !!e?.isIntersecting
    })
    io.observe(cv)
    return () => {
      ro.disconnect()
      io.disconnect()
      field.current = null
    }
  }, [cell, gap])

  /* the loop runs only while it plays; nothing is scheduled while it holds still */
  useEffect(() => {
    const f = field.current
    if (!playing || !f?.moves) return
    f.recolour()
    let raf = 0
    let last: number | null = null
    const frame = 1000 / fps
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      /* the first beat draws at once */
      if (last === null) last = t - frame
      if (!f.visible) {
        last = t
        return
      }
      if (t - last < frame) return
      f.clock += t - last
      last = t
      f.draw()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, fps])

  return <canvas ref={ref} className={cx(s.pixels, className)} aria-hidden="true" />
}
