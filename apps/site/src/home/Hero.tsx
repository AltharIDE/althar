import { CopyButton } from '@althar/ui'
import { type ReactNode, useRef } from 'react'

import { INSTALL, LINKS } from '../content/facts'
import { HERO } from '../content/home'
import { useHydrated, useMedia } from '../lib/browser'
import { useDownload } from '../lib/download'
import { OsMark } from '../shared/OsMark'
import s from './Hero.module.css'
import { useFeed } from './hero/feed'
import { Rings } from './hero/Rings'
import { KM } from './story/Altitude'

/*
 * The first screen, in daylight: the page's paper, its ink and its cobalt,
 * and as little else as it can. On the left the subhead at the top, the
 * line low down, the download under it; on the right the flat orrery,
 * running off the page's right edge. Along the foot, where it runs and how
 * to install it. A dot follows the pointer over it, and over the download
 * the button takes the dot in, rippling, and the agents feed it
 * (hero/feed.ts).
 */

const SYSTEMS = [
  { id: 'mac', name: 'macOS' },
  { id: 'linux', name: 'Linux' },
  { id: 'windows', name: 'Windows', soon: true },
] as const

export function Hero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLElement>(null)
  const get = useRef<HTMLAnchorElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const dot = useRef<HTMLDivElement>(null)
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const download = useDownload()
  const hydrated = useHydrated()
  useFeed(root, get, canvas, dot, still || !hydrated)

  return (
    <header ref={root} className={s.hero} data-km={KM.hero}>
      {nav}
      <div ref={dot} className={s.dot} aria-hidden="true" />
      {/* Drawn only in the browser. */}
      {hydrated && <canvas ref={canvas} className={s.feed} aria-hidden="true" />}
      <div className={s.inner}>
        <div className={s.grid}>
          <div className={s.copy}>
            <p className={s.lead}>{HERO.lead}</p>
            <h1 className={s.h1}>
              {HERO.lines.map((line) => (
                <span key={line} className={s.line}>
                  {line}
                </span>
              ))}
              <span className={s.line}>
                <b>{HERO.last}</b>
              </span>
            </h1>
            <div className={s.ctas}>
              <a ref={get} className={s.get} href={download.href}>
                {/* Under the label: where the pointer's dot ripples as the button takes it in (hero/feed.ts). */}
                <span className={s.pool} aria-hidden="true" data-pool="" />
                {download.pending ? 'Download' : download.label}
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 4v12M6 11l6 6 6-6M5 20h14" />
                </svg>
              </a>
              <a className={s.star} href={LINKS.repo}>
                Star on GitHub
              </a>
            </div>
          </div>
          <Rings className={s.art} />
        </div>
        <div className={s.foot}>
          <p className={s.runs}>
            <span className={s.label}>{HERO.runsOn}</span>
            {SYSTEMS.map((x) => (
              <span key={x.id} className={s.system}>
                <OsMark id={x.id} size={16} />
                {x.name}
                {'soon' in x && <span className={s.soon}>{HERO.soon}</span>}
              </span>
            ))}
          </p>
          <div className={s.install}>
            <span className={s.label}>{HERO.install}</span>
            <code>
              <span aria-hidden="true">$ </span>
              {INSTALL.brew}
            </code>
            <span className="ch-root">
              <CopyButton value={INSTALL.brew} ghost />
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
