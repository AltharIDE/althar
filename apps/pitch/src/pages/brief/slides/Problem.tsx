import { cx } from '../../../lib/cx'
import { Mark } from '../Mark'
import { Pin } from '../Slide'
import ui from '../ui.module.css'
import s from './Problem.module.css'

type Kind = 'file' | 'mind' | 'text'
/* Where this project's knowledge lives, and whether it survives the switch. */
const PLACES: readonly [string, Kind, boolean][] = [
  ['CLAUDE.md', 'file', false],
  ['AGENTS.md', 'file', true],
  ['A chat from March', 'text', false],
  ['.cursor/rules', 'file', false],
  ['PR #1147 review thread', 'text', false],
  ['What Priya remembers', 'mind', false],
  ['docs/architecture.md', 'file', true],
  ['A compacted chat summary', 'text', false],
  ['Slack, #payments', 'text', false],
  ['Why we don’t use cascades', 'mind', false],
]

export function Problem() {
  return (
    <Pin id="problem" tone="light" name="Memory" className={s.p1} steps={3}>
      {(step) => (
        <div className={cx(ui.wrap, ui.split)}>
          <div>
            <p className={cx(ui.kicker, s.kicker)}>The problem · Memory</p>
            <h2>The project has no memory of its own.</h2>
            <p className={ui.body}>
              Why a decision was made, what was already tried, which rule came from a customer. That knowledge is spread across tools and
              people’s heads. Change agents and most of it stays behind.
            </p>
            <p className={ui.answer}>
              Althar’s answer <span>→</span> a memory the project owns
            </p>
          </div>
          <figure className={s.mig} data-step={step} aria-label="Switching from Claude Code to Codex, and what comes along">
            <div className={s.head}>
              <p>
                <span className={s.name}>
                  <Mark lab="anthropic" />
                  Claude Code
                </span>
                <small>six months of work</small>
              </p>
              <span className={s.arrow} aria-hidden="true">
                →
              </span>
              <p className={s.to}>
                <span className={s.name}>
                  <Mark lab="openai" />
                  Codex
                </span>
                <small>day one</small>
              </p>
            </div>
            <ul className={s.list}>
              {PLACES.map(([what, kind, keep]) => (
                <li key={what} className={cx(keep ? s.keep : s.lost, kind === 'file' && s.file, kind === 'mind' && s.mind)}>
                  {what}
                </li>
              ))}
            </ul>
            <div className={s.cap}>
              <p className={s.c0}>Ten places this project’s knowledge lives today.</p>
              <p className={s.c1}>A better model ships. The team switches to Codex.</p>
              <p className={s.c2}>
                <b>2 of 10 come along.</b> The rest stay behind.
              </p>
            </div>
            <p className={s.q}>
              <span>Codex, an hour later</span>“Should I add a cascade delete here?”
            </p>
          </figure>
        </div>
      )}
    </Pin>
  )
}
