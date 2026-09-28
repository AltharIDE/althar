import { useEffect, useState } from 'react'

import { Logo } from '../../components/Logo'
import { useMeta } from '../../lib/useMeta'
import { RESEARCH } from '../../meta'
import { homeHref, researchHref } from '../../paths'
import s from './Research.module.css'
import { Attention } from './sections/Attention'
import { Bottleneck } from './sections/Bottleneck'
import { Business } from './sections/Business'
import { Close } from './sections/Close'
import { DecisionEngines } from './sections/DecisionEngines'
import { EventLoop } from './sections/EventLoop'
import { Falsifiers } from './sections/Falsifiers'
import { Market } from './sections/Market'
import { NoMemory } from './sections/NoMemory'
import { Opening } from './sections/Opening'
import { Orchestration } from './sections/Orchestration'
import { PriorArt } from './sections/PriorArt'
import { ProductPath } from './sections/ProductPath'
import { Tacit } from './sections/Tacit'
import { Thesis } from './sections/Thesis'

const CONTENTS = [
  'The bottleneck is moving',
  'No independent memory',
  'The human event loop',
  'The thesis',
  'Orchestration, precisely',
  'The attention boundary',
  'Decision engines',
  'What can’t be written down',
  'Market structure',
  'Open source and the business',
  'Product path',
  'What would prove us wrong',
  'Prior art',
]

/** The index of the section being read: the last one whose top has passed a third of the way down. */
function useReading(ids: string[]): number {
  const [on, setOn] = useState(-1)
  useEffect(() => {
    const sections = ids.map((id) => document.getElementById(id))
    let queued = false
    const mark = (): void => {
      queued = false
      const y = window.innerHeight * 0.35
      let k = -1
      sections.forEach((el, j) => {
        if (el && el.getBoundingClientRect().top < y) k = j
      })
      setOn(k)
    }
    const onScroll = (): void => {
      if (queued) return
      queued = true
      requestAnimationFrame(mark)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    mark()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ids])
  return on
}

const IDS = CONTENTS.map((_, k) => `s${k + 1}`)

/** The research note: the brief's argument in full, set like a paper. */
export function Research() {
  useMeta(RESEARCH)
  const on = useReading(IDS)
  return (
    <div className={s.page}>
      <header className={s.mast}>
        <a className={s.brand} href={homeHref}>
          <Logo />
          Charrette
        </a>
        <nav className={s.pages} aria-label="Pages">
          <a href={homeHref}>Brief</a>
          <a href={researchHref} aria-current="page">
            Research note
          </a>
        </nav>
      </header>
      <div className={s.doc}>
        <aside className={s.toc} aria-label="Contents">
          <p className={s.tocH}>Research note</p>
          <ol>
            {CONTENTS.map((title, k) => (
              <li key={title}>
                <a href={`#${IDS[k]}`} aria-current={k === on ? 'location' : undefined}>
                  <span className={s.n}>{k + 1}</span>
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </aside>
        <main className={s.main} id="main" tabIndex={-1}>
          <Opening />
          <Bottleneck />
          <NoMemory />
          <EventLoop />
          <Thesis />
          <Orchestration />
          <Attention />
          <DecisionEngines />
          <Tacit />
          <Market />
          <Business />
          <ProductPath />
          <Falsifiers />
          <PriorArt />
          <Close />
        </main>
      </div>
    </div>
  )
}
