// Scrappy: the sign of life itself, as each direction draws it where the reply will start. B's is under your message (seams/blocksUi).
import { LinkButton, LiveDot, LOGO_BORE, LOGO_SECTION, type ModelInfo, Round, Thinking, Turn, VisuallyHidden } from '@althar/ui'
import type { ReactNode } from 'react'

import { useModelNames } from '../../../src/renderer/shared/modelNames'
import type { Screen } from '../data'
import { actions } from '../nav'
import { useElapsed, useProto } from '../store'
import { AT, seconds } from '../timeline'
import s from './life.module.css'

export const words = {
  thinking: (name: string) => `${name} is thinking`,
  slow: 'longer than usual',
  stop: 'Stop',
  failed: 'Anthropic’s API is overloaded (error 529); Claude Code gave up after 45 seconds.',
  noAnswer: 'No answer',
  sendAgain: 'Send again',
  sending: 'Sending',
  sent: 'Sent',
  has: (name: string) => `${name} has it`,
  thinkingFor: (took: string) => `Thinking · ${took}`,
  stopped: 'Stopped',
}

/** The lead's model, as its reply will be headed. */
export const useLead = (): ModelInfo => useModelNames()('claude-code', 'opus', null)

/** Who answers, headed as its reply will be: a turn in the coordinator's thread, a round in a task's. */
function Speaker({ screen, model, at, children }: { screen: Screen; model: ModelInfo; at?: ReactNode; children?: ReactNode }) {
  const when = at as string | undefined
  return screen === 'coordinator' ? (
    <Turn model={model} {...(when === undefined ? {} : { at: when })}>
      {children ?? null}
    </Turn>
  ) : (
    <Round model={model} {...(when === undefined ? {} : { at: when })}>
      {children ?? null}
    </Round>
  )
}

/** Past half a minute: it says so, and Stop is a word away. */
export function Slow({ screen }: { screen: Screen }) {
  return (
    <>
      <span className={s.sep}>·</span>
      <span>{words.slow}</span>
      <span className={s.sep}>·</span>
      <LinkButton className={s.link} onClick={() => actions.stop(screen)}>
        {words.stop}
      </LinkButton>
    </>
  )
}

/** It gave up: why, in a line, and the message a click from going again. */
export function Failed({ screen, text }: { screen: Screen; text: string }) {
  return (
    <span className={s.failed} role="alert">
      <span className={s.warn}>{words.noAnswer}</span>
      <span>{words.failed}</span>
      <LinkButton className={s.link} onClick={() => actions.sendAgain(screen, text)}>
        {words.sendAgain}
      </LinkButton>
    </span>
  )
}

/** A: three cobalt dots where the reply starts, the seconds after three. */
function Dots({ screen, t, failed, text, model }: Shown) {
  return (
    <div className={`${s.line} ${s.in}`} role="status">
      <VisuallyHidden>{words.thinking(model.name)}</VisuallyHidden>
      <span className={failed ? `${s.dots} ${s.still}` : s.dots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {failed ? (
        <Failed screen={screen} text={text} />
      ) : (
        t >= AT.count && (
          <span className={`${s.count} ${s.in}`} aria-hidden="true">
            {seconds(t)}
            {t >= AT.slow && <Slow screen={screen} />}
          </span>
        )
      )}
    </div>
  )
}

/** C: the reply's name, and its first line held by the kit's shimmering Thinking until the words take its place. */
function Placeholder({ screen, t, failed, text, model }: Shown) {
  return (
    <div className={s.in}>
      <Speaker screen={screen} model={model}>
        {failed ? (
          <p className={s.first}>
            <Failed screen={screen} text={text} />
          </p>
        ) : (
          <div className={s.first}>
            <Thinking />
            {t >= AT.count && (
              <span className={`${s.count} ${s.in}`} aria-hidden="true">
                {seconds(t)}
                {t >= AT.slow && <Slow screen={screen} />}
              </span>
            )}
          </div>
        )}
      </Speaker>
    </div>
  )
}

/** Althar's mark at the size of a line: drawn stroke by stroke, filled, then its cobalt point breathes. */
export function DrawnMark({ still = false }: { still?: boolean }) {
  return (
    <svg className={still ? `${s.mark} ${s.markStill}` : s.mark} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path className={s.outline} d={LOGO_SECTION} pathLength={1} />
      <path className={s.fill} d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" />
      <circle className={s.point} cx="12" cy="14.4" r="1.1" />
    </svg>
  )
}

/** D: Althar's mark where the reply starts, the seconds after three. */
function Mark({ screen, t, failed, text, model }: Shown) {
  return (
    <div className={`${s.line} ${s.in}`} role="status">
      <VisuallyHidden>{words.thinking(model.name)}</VisuallyHidden>
      <DrawnMark still={failed} />
      {failed ? (
        <Failed screen={screen} text={text} />
      ) : (
        t >= AT.count && (
          <span className={`${s.count} ${s.in}`} aria-hidden="true">
            {seconds(t)}
            {t >= AT.slow && <Slow screen={screen} />}
          </span>
        )
      )}
    </div>
  )
}

/** E: the reply's name at once, with a breathing cobalt dot where its time goes, and the seconds after three. */
function NameFirst({ screen, t, failed, text, model }: Shown) {
  const at = failed ? undefined : (
    <span className={s.presence} role="status">
      <VisuallyHidden>{words.thinking(model.name)}</VisuallyHidden>
      <LiveDot pulse />
      {t >= AT.count && (
        <span className={s.in} aria-hidden="true">
          {seconds(t)}
        </span>
      )}
    </span>
  )
  return (
    <div className={s.in}>
      <Speaker screen={screen} model={model} at={at}>
        {failed ? (
          <p className={s.first}>
            <Failed screen={screen} text={text} />
          </p>
        ) : (
          t >= AT.slow && (
            <p className={`${s.first} ${s.quiet} ${s.in}`}>
              <span>{words.slow}</span>
              <span className={s.sep}>·</span>
              <LinkButton className={s.link} onClick={() => actions.stop(screen)}>
                {words.stop}
              </LinkButton>
            </p>
          )
        )}
      </Speaker>
    </div>
  )
}

interface Shown {
  readonly screen: Screen
  readonly t: number
  readonly failed: boolean
  readonly text: string
  readonly model: ModelInfo
}

/** Where the reply will start: the direction's sign of life, while nothing has come back, or what it says when nothing will. */
export function SignOfLife({ screen }: { screen: Screen }) {
  const st = useProto()
  const t = useElapsed()
  const model = useLead()
  const gap = st.gap
  if (gap === null || gap.screen !== screen) return null
  const failed = gap.phase === 'failed'
  if (!failed && (gap.phase !== 'waiting' || t < AT.show)) return null
  const shown: Shown = { screen, t, failed, text: gap.text, model }
  switch (st.d) {
    case 'A':
      return <Dots {...shown} />
    case 'C':
      return <Placeholder {...shown} />
    case 'D':
      return <Mark {...shown} />
    case 'E':
      return <NameFirst {...shown} />
    default:
      return null
  }
}
