import { BrandMark } from '@charrette/ui'
import { useEffect, useRef, useState } from 'react'

import { AGENTS } from '../content/facts'
import { BRAND_OF } from '../content/site'
import s from './Crew.module.css'

/*
 * Who does the work: three steps of a task, each with an agent's name on a
 * plate like the one on the crane. The plates change hands every few
 * seconds, one line at a time, and never show the same agent twice at
 * once, so one lab is always checking another. It holds still for reduced
 * motion and while it's off screen.
 */

type Name = (typeof AGENTS)[number]

const LINES: readonly { verb: string; pool: readonly Name[] }[] = [
  { verb: 'writes it.', pool: ['Claude Code', 'Codex', 'Cursor', 'GitHub Copilot', 'OpenRouter'] },
  { verb: 'reviews it.', pool: ['Codex', 'Gemini CLI', 'Claude Code', 'Ollama'] },
  { verb: 'tests it.', pool: ['Gemini CLI', 'Cursor', 'Claude Code', 'Codex'] },
]
const FIRST: readonly Name[] = ['Claude Code', 'Codex', 'Gemini CLI']
const LONGEST = AGENTS.reduce((a, b) => (b.length > a.length ? b : a))
const EVERY = 1600

function Plate({ name }: { name: Name }) {
  return (
    <span className={s.plate}>
      <BrandMark brand={BRAND_OF[name]} size={22} className={s.icon} />
      {name}
    </span>
  )
}

export function Crew() {
  const [names, setNames] = useState<readonly Name[]>(FIRST)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let seen = false
    let step = 0
    const io = new IntersectionObserver(([e]) => {
      seen = e?.isIntersecting ?? false
    })
    io.observe(el)
    const id = window.setInterval(() => {
      if (!seen || document.hidden) return
      const line = step % LINES.length
      step += 1
      setNames((now) => {
        const pool = LINES[line]?.pool ?? []
        const at = pool.indexOf(now[line] ?? pool[0] ?? 'Claude Code')
        for (let k = 1; k <= pool.length; k++) {
          const next = pool[(at + k) % pool.length]
          if (next && !now.some((n, j) => j !== line && n === next)) return now.map((n, j) => (j === line ? next : n))
        }
        return now
      })
    }, EVERY)
    return () => {
      window.clearInterval(id)
      io.disconnect()
    }
  }, [])

  return (
    <div ref={box} className={s.crew}>
      <p className={s.sr}>For example: Claude Code writes it, Codex reviews it, Gemini CLI tests it. Any of them can take any step.</p>
      <ol className={s.lines} aria-hidden="true">
        {LINES.map((l, i) => {
          const name = names[i] ?? FIRST[0] ?? 'Claude Code'
          return (
            <li key={l.verb}>
              <span className={s.slot}>
                <span className={s.sizer}>
                  <Plate name={LONGEST} />
                </span>
                <span key={name} className={s.now}>
                  <Plate name={name} />
                </span>
              </span>
              <span className={s.verb}>{l.verb}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Every agent it's built to run, each with its mark. */
export function Roster() {
  return (
    <ul className={s.roster} aria-label="The agents it’s built to run">
      {AGENTS.map((a) => (
        <li key={a}>
          <BrandMark brand={BRAND_OF[a]} size={16} />
          {a}
        </li>
      ))}
    </ul>
  )
}
