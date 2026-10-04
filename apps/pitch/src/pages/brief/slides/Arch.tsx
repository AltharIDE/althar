import { useEffect, useState } from 'react'

import { cx } from '../../../lib/cx'
import { Slide } from '../Slide'
import ui from '../ui.module.css'
import s from './Arch.module.css'

const AGENTS = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'Open-weight'] as const

/** The agent in use changes every couple of seconds; the project layer doesn't. Holds still for reduced motion. */
function useRotation(n: number, ms: number): number {
  const [k, setK] = useState(0)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer = 0
    const run = (): void => {
      window.clearInterval(timer)
      if (reduce.matches || document.hidden) return
      timer = window.setInterval(() => setK((v) => (v + 1) % n), ms)
    }
    run()
    document.addEventListener('visibilitychange', run)
    reduce.addEventListener('change', run)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', run)
      reduce.removeEventListener('change', run)
    }
  }, [n, ms])
  return k
}

const YOURS = [
  { k: 'Repository', t: 'Your code and its history, where it already lives.' },
  { k: 'Subscriptions and keys', t: 'Your Claude, ChatGPT and Cursor plans, your API keys.' },
  { k: 'Machines', t: 'Your laptop, or your servers. Nothing leaves unless you send it.' },
] as const

export function Arch() {
  const on = useRotation(AGENTS.length, 2200)
  return (
    <Slide tone="dark" name="Where it sits" className={s.arch}>
      <div className={ui.wrap}>
        <p className={cx(ui.kicker, s.kicker)}>Where Althar sits</p>
        <h2>A persistent layer between your team and whichever agents you use.</h2>
        <div className={s.agents}>
          <p className={s.lK}>
            Agents<small>Replaceable. Use whichever is best this month.</small>
          </p>
          <div className={s.chips}>
            {AGENTS.map((a, j) => (
              <span key={a} className={cx(j === on && s.on)}>
                {a}
              </span>
            ))}
            <span className={s.next}>What ships next</span>
          </div>
        </div>
        <div className={s.plug} aria-hidden="true">
          <i />
          <span>
            Next task triaged from 6 facts · running on <b>{AGENTS[on]}</b>
          </span>
          <i />
        </div>
        <section className={s.yours} aria-labelledby="yours-k">
          <p className={s.yoursK} id="yours-k">
            Yours
          </p>
          <div className={s.tiles}>
            <div className={cx(s.tile, s.core)}>
              <div>
                <small>Your project layer</small>
                <b>Althar</b>
              </div>
              <span>
                Project memory, the coordinator, tasks and everything they produced. Open source, in an open format, on top of everything
                else that’s already yours.
              </span>
            </div>
            {YOURS.map((y) => (
              <div key={y.k} className={s.tile}>
                <small>Your</small>
                <b>{y.k}</b>
                <span>{y.t}</span>
              </div>
            ))}
          </div>
        </section>
        <p className={s.cap}>
          Mixing labs is the point: a reviewer from a different lab from the author is one of the strongest checks there is, and no lab will
          sell you an independent reviewer of its own model.
        </p>
      </div>
    </Slide>
  )
}
