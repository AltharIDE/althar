import { Logo } from '@althar/ui'
import { type RefObject, useEffect, useState } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import s from './parts.module.css'

/** The footer's links, in two short groups. */
export const GROUPS = [
  {
    name: 'Althar',
    links: [
      { href: LINKS.releases, name: 'Download' },
      { href: LINKS.repo, name: 'GitHub' },
      { href: LINKS.issues, name: 'Issues' },
    ],
  },
  {
    name: 'Read',
    links: [
      { href: '/thesis', name: 'Thesis' },
      { href: '/shifts', name: 'Shifts' },
      { href: '/wallpaper', name: 'Wallpaper' },
    ],
  },
] as const

export const YEAR = 2026

/** The mark and the name, as the footer starts. */
export function Signature({ className }: { className?: string }) {
  return (
    <a className={cx(s.signature, className)} href="#top">
      <Logo size={26} />
      <span>Althar</span>
    </a>
  )
}

/** The links, in their groups. */
export function Links({ className }: { className?: string }) {
  return (
    <nav className={cx(s.links, className)} aria-label="Footer">
      {GROUPS.map((group) => (
        <div key={group.name}>
          <p>{group.name}</p>
          <ul>
            {group.links.map((link) => (
              <li key={link.name}>
                <a href={link.href}>{link.name}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** Whether to hold still: reduced motion, or a still picture asked for with ?t. */
export const still = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t')

/** Whether `ref` is on screen at all, for what draws on every frame only while it is seen. */
export function useOnScreen(ref: RefObject<Element | null>) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setOn(e?.isIntersecting ?? false), { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return on
}

/** The same small unevenness every time: a seeded random, 0 to 1. */
export function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth value noise in one and two dimensions, on a seeded lattice. */
export function noise(seed: number) {
  const r = seeded(seed)
  const size = 256
  const table = Float32Array.from({ length: size }, () => r())
  const perm = Uint8Array.from({ length: size }, (_, i) => i)
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j]!, perm[i]!]
  }
  const fade = (t: number) => t * t * (3 - 2 * t)
  const at = (x: number, y: number) => table[perm[(perm[x & 255]! + y) & 255]!]!
  const n2 = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const u = fade(x - xi)
    const v = fade(y - yi)
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u
    return a + (b - a) * v
  }
  const n1 = (x: number) => n2(x, 0.5)
  /** Layered: big shapes, then smaller ones over them. */
  const fbm = (x: number, y = 0.5, octaves = 4) => {
    let sum = 0
    let amp = 0.5
    let f = 1
    for (let o = 0; o < octaves; o++) {
      sum += amp * n2(x * f, y * f)
      f *= 2
      amp *= 0.5
    }
    return sum / (1 - 0.5 ** octaves)
  }
  return { n1, n2, fbm }
}

/** A canvas at the screen's density, sized to its box; calls `draw` with the context in CSS px, again on resize. */
export function fitCanvas(canvas: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  let frame = 0
  const run = () => {
    frame = 0
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, w, h)
  }
  let size = ''
  const ro = new ResizeObserver(() => {
    const now = `${canvas.clientWidth}x${canvas.clientHeight}`
    if (now === size) return
    size = now
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(run)
  })
  ro.observe(canvas)
  return () => {
    ro.disconnect()
    cancelAnimationFrame(frame)
  }
}
