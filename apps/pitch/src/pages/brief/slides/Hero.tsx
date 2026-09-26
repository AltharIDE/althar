import board from '../../../assets/board.png'
import board1080avif from '../../../assets/img/board-1080.avif'
import board1080webp from '../../../assets/img/board-1080.webp'
import board1440avif from '../../../assets/img/board-1440.avif'
import board1440webp from '../../../assets/img/board-1440.webp'
import board720avif from '../../../assets/img/board-720.avif'
import board720webp from '../../../assets/img/board-720.webp'
import { cx } from '../../../lib/cx'
import { type Lab, Mark } from '../Mark'
import { clamp } from '../model/lib'
import { Pin } from '../Slide'
import ui from '../ui.module.css'
import s from './Hero.module.css'

/** The reel beside the headline: labs whose agents come and go, the first repeated so the loop closes. */
const REEL: readonly Lab[] = ['anthropic', 'openai', 'google', 'deepseek', 'moonshot', 'qwen', 'cursor', 'minimax', 'xiaomi']

/** One lab's mark after another beside "Agents", like a slot machine. The words stay plain text. */
function Headline() {
  return (
    <h1 className={s.h1}>
      <span className={s.win} aria-hidden="true">
        <span className={s.strip}>
          {[...REEL, REEL[0]!].map((l, j) => (
            <span key={j} className={s.item}>
              <Mark lab={l} />
            </span>
          ))}
        </span>
      </span>
      Agents come and go. <span className={s.stays}>The project stays.</span>
    </h1>
  )
}

const SIZES = '(min-width: 1200px) 1180px, calc(100vw - 32px)'

/** Screens of scroll after the last step, while the board sinks into the dark of the next panel. */
const TAIL = 0.7

/* The opening copy lifts away and the product rises into its place. Then the
   board sinks back and the panel darkens, so the next one scrolls in on the same ink. */
function move(p: number, live: boolean, el: HTMLElement): void {
  const y = live ? (p * Math.max(0, el.offsetHeight - window.innerHeight)) / window.innerHeight : 0
  const r = clamp((y - 1) / TAIL)
  el.style.setProperty('--p', clamp(y).toFixed(4))
  el.style.setProperty('--q', live ? clamp((y - 0.1) / 0.75).toFixed(4) : '1')
  el.style.setProperty('--r', r.toFixed(4))
  el.dataset.tone = r > 0.5 ? 'dark' : 'light'
}

export function Hero() {
  return (
    <Pin id="top" tone="light" name="Charrette" className={s.hero} stickClassName={s.stick} steps={2} onProgress={move}>
      {() => (
        <>
          <div className={cx(ui.wrap, s.copy)}>
            <p className={cx(ui.kicker, s.kicker)}>Open-source infrastructure for software engineering with AI agents</p>
            <Headline />
            <div className={s.row}>
              <p className={s.dek}>
                Charrette gives a software project <b>a memory it owns</b> and <b>a coordinator that moves the work</b> between AI agents.
                Any agent, any model, your own subscriptions, on your own servers.
              </p>
              <aside className={s.prop}>
                <b>The proposition</b>
                <p>The agents will keep changing. Your project should not have to.</p>
              </aside>
            </div>
          </div>
          <figure className={s.shot}>
            <figcaption>
              <span className={cx(ui.kicker, s.kicker)}>The prototype · Board</span>
              <b>Every task the project is running. Four need a person. The rest move on their own.</b>
            </figcaption>
            <div className={ui.frame}>
              <picture>
                <source type="image/avif" srcSet={`${board720avif} 720w, ${board1080avif} 1080w, ${board1440avif} 1440w`} sizes={SIZES} />
                <source type="image/webp" srcSet={`${board720webp} 720w, ${board1080webp} 1080w, ${board1440webp} 1440w`} sizes={SIZES} />
                <img
                  src={board}
                  width={1440}
                  height={780}
                  fetchPriority="high"
                  alt="The Charrette board: tasks grouped as Up next, Running, Needs you and Settled, each showing its step, model and progress, with the decisions laid out as choices."
                />
              </picture>
            </div>
          </figure>
          <p className={s.cue} aria-hidden="true">
            Scroll ↓
          </p>
        </>
      )}
    </Pin>
  )
}
