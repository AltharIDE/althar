import { Logo } from '@althar/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../lib/cx'
import { type Clear, drawLight, lightOf } from '../shared/footer/engrave'
import { ALTAR_X, ASPECT, engravingUrl, groundAt } from '../shared/footer/engraving'
import { CARDS, OG_PAGES, type OgPage } from './cards'
import s from './Takes.module.css'

/*
 * Directions for the link previews on the footer's engraving, while one is
 * chosen. In development only: `/og?take=a&page=home`, with a bar along the
 * bottom to swap the direction (A–E, or the keys 1–5) and the page.
 */

const W = 1200
const H = 630
/** Where the light is held: a moment of its breathing. */
const AT = 5200

interface Take {
  id: string
  name: string
  /** The engraving's width, where its altar stands (a share of the card's width), and how much of it goes under the card's foot. */
  iw: number
  altar: number
  drop: number
  /** Night: the print in light ink on the dark. Centred: the words over the middle. */
  night?: boolean
  centred?: boolean
}

export const TAKES: readonly Take[] = [
  { id: 'a', name: 'The footer’s print', iw: 1200, altar: ALTAR_X, drop: 70 },
  { id: 'b', name: 'The altar beside the words', iw: 1640, altar: 0.8, drop: 162 },
  { id: 'c', name: 'Night', iw: 1640, altar: 0.8, drop: 162, night: true },
  { id: 'd', name: 'Centred over the altar', iw: 2000, altar: 0.5, drop: 232, centred: true },
  { id: 'e', name: 'The headland, close', iw: 2600, altar: 0.74, drop: 342 },
]

export function TakeCard({ page, take }: { page: OgPage; take: Take }) {
  const card = CARDS[page]
  const box = useRef<HTMLDivElement>(null)
  const glow = useRef<HTMLCanvasElement>(null)
  const words = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const ih = take.iw / ASPECT
  const left = take.altar * W - ALTAR_X * take.iw
  const top = H - ih + take.drop

  useLayoutEffect(() => {
    const el = box.current
    const canvas = glow.current
    if (!el || !canvas || !loaded) return
    let cancelled = false
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        if (cancelled) return
        const at = el.getBoundingClientRect()
        const clear: Clear[] = [...(words.current?.querySelectorAll('h1, p') ?? [])].flatMap((line) => {
          const range = document.createRange()
          range.selectNodeContents(line)
          return [...range.getClientRects()]
            .filter((r) => r.width > 0)
            .map((r) => ({ left: r.left - at.left, right: r.right - at.left, bottom: r.bottom - at.top }))
        })
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        canvas.width = W * dpr
        canvas.height = H * dpr
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const g = groundAt(left, top, take.iw, ih, W, H, clear)
        drawLight(ctx, g, lightOf(g), AT)
        el.dataset.ready = ''
      }),
    )
    return () => {
      cancelled = true
      delete el.dataset.ready
    }
  }, [loaded, left, top, ih, take, page])

  return (
    <div ref={box} className={cx(s.card, take.night && s.night, take.centred && s.centred)}>
      <img
        className={s.land}
        src={engravingUrl('engraving-1916.webp')}
        alt=""
        onLoad={() => setLoaded(true)}
        style={{ left, top, width: take.iw, height: ih }}
      />
      <canvas ref={glow} className={s.glow} />
      <div ref={words} className={s.words}>
        <p className={s.sign}>
          <Logo size={24} />
          Althar
        </p>
        <h1 className={s.title}>{card.title}</h1>
        <p className={s.lead}>{card.lead}</p>
      </div>
    </div>
  )
}

/** The directions, one at a time, with the bar to swap them. */
export function Takes() {
  const params = new URLSearchParams(window.location.search)
  const [take, setTake] = useState(() => TAKES.find((t) => t.id === params.get('take')) ?? TAKES[0]!)
  const [page, setPage] = useState<OgPage>(() => {
    const asked = params.get('page')
    return asked && (OG_PAGES as string[]).includes(asked) ? (asked as OgPage) : 'home'
  })

  useEffect(() => {
    window.history.replaceState(null, '', `/og?take=${take.id}&page=${page}`)
  }, [take, page])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1
      if (TAKES[i]) setTake(TAKES[i])
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  return (
    <div className={s.stage}>
      <TakeCard key={`${take.id}-${page}`} page={page} take={take} />
      <nav className={s.bar}>
        {TAKES.map((t, i) => (
          <button key={t.id} type="button" aria-pressed={t === take} onClick={() => setTake(t)}>
            <b>{t.id.toUpperCase()}</b> {t.name} <kbd>{i + 1}</kbd>
          </button>
        ))}
        <span className={s.gap} />
        {OG_PAGES.map((p) => (
          <button key={p} type="button" aria-pressed={p === page} onClick={() => setPage(p)}>
            {p}
          </button>
        ))}
      </nav>
    </div>
  )
}
