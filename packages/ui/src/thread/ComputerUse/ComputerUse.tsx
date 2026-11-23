import { useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { ComputerPhase, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { AskAnswered, AskCard, AskFoot } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Problem } from '../../primitives/Problem/Problem'
import { ImageView } from '../Lightbox/Lightbox'
import { type ImageRef, useThreadShell } from '../Shell/Shell'
import s from './ComputerUse.module.css'

/*
 * A task's use of this computer, under the turn at work. While it asks, one
 * ask in violet: why, in its lead's words, and what a yes lets it do, until
 * its turn ends; Not now, or Allow for this turn. Once allowed, a quiet card
 * in a run's language: its dot, what it is doing now, Take over and Stop
 * beside it, and the last picture it took, which opens full size. Once it
 * ends, the card stays, saying why.
 */

export interface ComputerUseText {
  /** What the region is called. */
  label: string
  /** The card's name. */
  name: string
  kicker: string
  /** What a yes lets it do, with the screen where it may be shared. */
  scope: (display: boolean) => string
  /** The keys that stop it from anywhere, where it has them. */
  stopsIt: string
  allow: string
  notNow: string
  allowed: string
  declined: string
  /** The display, as a picture of it is named. */
  primaryDisplay: string
  takeOver: string
  resume: string
  stop: string
  /** The last picture it took, of a window by its app or of the display. */
  latest: (of: string) => string
  view: (of: string) => string
}

export const computerUseText: ComputerUseText = {
  label: 'Computer use',
  name: 'Computer use',
  kicker: 'Asks to use this computer',
  scope: (display) =>
    display
      ? 'It can use any app or window, type and click, and see your screen, until this turn ends.'
      : 'It can use any app or window, and type and click in them, until this turn ends.',
  stopsIt: 'stops it',
  allow: 'Allow for this turn',
  notNow: 'Not now',
  allowed: 'Allowed for this turn',
  declined: 'Not now',
  primaryDisplay: 'the primary display',
  takeOver: 'Take over',
  resume: 'Resume',
  stop: 'Stop',
  latest: (of) => `Latest view of ${of}`,
  view: (of) => `View the latest view of ${of} full size`,
}

/** What the task asks, once a turn: whether it may use this computer, and why. */
export interface ComputerAsk {
  id: string
  /** Why, in its lead's words. */
  reason: string
  /** A yes takes in the primary display too: it can't be shared on Linux with several displays. */
  display: boolean
}

/** The person's answer to an ask. */
export interface ComputerAnswer {
  ask: string
  allow: boolean
}

/** The last picture it took: of a window, named by its app, or of the display. */
export interface ComputerLatest {
  of: string
  image: ImageRef
}

export type ComputerUseProps = RootProps<
  'section',
  {
    phase: ComputerPhase
    /** What it is doing now, or why it ended, in the session's words: Using Writer in the foreground. */
    activity: string
    /** What it asks, while it waits on the person. */
    ask?: ComputerAsk
    /** The person's answer to the ask, kept by the consumer while the session takes it: the ask folds to a line at once. */
    answered?: ComputerAnswer
    /** The last picture it took. */
    latest?: ComputerLatest
    /** A press on its way, in words, until the session says what came of it: Taking over… */
    pending?: string
    /** What went wrong with the last answer or press. */
    error?: string
    /** The keys that stop it from anywhere, where the system lets Althar have them. */
    stopKeys?: string
    onAnswer?: (answer: ComputerAnswer) => void
    onTakeOver?: () => void
    onResume?: () => void
    onStop?: () => void
    text?: Partial<ComputerUseText>
  }
>

export function ComputerUse({
  phase,
  activity,
  ask,
  answered,
  latest,
  pending,
  error,
  stopKeys,
  onAnswer,
  onTakeOver,
  onResume,
  onStop,
  text,
  className,
  ...rest
}: ComputerUseProps) {
  const t = { ...computerUseText, ...text }
  const body = () => {
    if (phase === ComputerPhase.Stopped) return <Session t={t} phase={phase} activity={pending ?? activity} error={error} />
    if (ask !== undefined && answered?.ask === ask.id)
      return <AskAnswered denied={!answered.allow} said={answered.allow ? t.allowed : t.declined} focusOnMount />
    if (ask !== undefined) return <Asking t={t} ask={ask} error={error} stopKeys={stopKeys} onAnswer={onAnswer} />
    return (
      <Session
        t={t}
        phase={phase}
        activity={pending ?? activity}
        latest={pending === undefined ? latest : undefined}
        busy={pending !== undefined}
        error={error}
        stopKeys={stopKeys}
        onTakeOver={onTakeOver}
        onResume={onResume}
        onStop={onStop}
      />
    )
  }
  return (
    <section aria-label={t.label} className={cx(s.root, className)} data-rhythm={Rhythm.Live} {...rest}>
      {body()}
    </section>
  )
}

/** The one ask: why, what a yes lets it do and how to stop it, and the answers. */
function Asking({
  t,
  ask,
  error,
  stopKeys,
  onAnswer,
}: {
  t: ComputerUseText
  ask: ComputerAsk
  error: string | undefined
  stopKeys: string | undefined
  onAnswer: ((answer: ComputerAnswer) => void) | undefined
}) {
  const scope = useId()
  return (
    <AskCard icon="computer" kicker={t.kicker} what={ask.reason} aria-describedby={scope}>
      <p id={scope} className={s.scope}>
        {t.scope(ask.display)}
      </p>
      {error !== undefined && (
        <Problem size="small" className={s.problem}>
          {error}
        </Problem>
      )}
      <AskFoot>
        <Button variant="quiet" onClick={() => onAnswer?.({ ask: ask.id, allow: false })}>
          {t.notNow}
        </Button>
        <Button variant="signal" onClick={() => onAnswer?.({ ask: ask.id, allow: true })}>
          {t.allow}
        </Button>
        {stopKeys !== undefined && (
          <span className={s.stops}>
            <Kbd>{stopKeys}</Kbd>
            {t.stopsIt}
          </span>
        )}
      </AskFoot>
    </AskCard>
  )
}

/** The session: what it does now, the person's ways to take it back, and its last picture. Once it ends, why. */
function Session({
  t,
  phase,
  activity,
  latest,
  busy = false,
  error,
  stopKeys,
  onTakeOver,
  onResume,
  onStop,
}: {
  t: ComputerUseText
  phase: ComputerPhase
  activity: string
  latest?: ComputerLatest | undefined
  busy?: boolean
  error: string | undefined
  stopKeys?: string | undefined
  onTakeOver?: (() => void) | undefined
  onResume?: (() => void) | undefined
  onStop?: (() => void) | undefined
}) {
  const { openImage } = useThreadShell()
  const ended = phase === ComputerPhase.Stopped
  const mark = () => {
    switch (phase) {
      case ComputerPhase.Active:
      case ComputerPhase.Asking:
        return <LiveDot />
      case ComputerPhase.Paused:
        return <Icon name="pause" size={12} />
      case ComputerPhase.Stopped:
        return <Icon name="computer" size={13} />
      default:
        return unreachable(phase)
    }
  }
  const image =
    latest === undefined ? undefined : { ...latest.image, label: t.latest(latest.of), alt: latest.image.alt ?? t.latest(latest.of) }
  return (
    <>
      <div className={cx(s.card, ended && s.ended)}>
        <div className={s.head}>
          <span className={s.mark}>{mark()}</span>
          <div className={s.main}>
            <span className={s.name}>{t.name}</span>
            <output className={s.activity}>{activity}</output>
          </div>
          {!ended && (
            <div className={s.acts}>
              {phase === ComputerPhase.Paused
                ? onResume && (
                    <Button size="small" disabled={busy} onClick={onResume}>
                      {t.resume}
                    </Button>
                  )
                : onTakeOver && (
                    <Button size="small" variant="quiet" disabled={busy} onClick={onTakeOver}>
                      {t.takeOver}
                    </Button>
                  )}
              {onStop && (
                <Button size="small" variant="quiet" {...(stopKeys === undefined ? {} : { kbd: stopKeys })} onClick={onStop}>
                  {t.stop}
                </Button>
              )}
            </div>
          )}
        </div>
        {image !== undefined && latest !== undefined && (
          <figure className={s.latest}>
            {openImage ? (
              <button
                type="button"
                className={cx(s.picture, s.opens)}
                aria-label={t.view(latest.of)}
                onClick={() => openImage(image, [image])}
              >
                <ImageView image={image} className={s.shot} />
              </button>
            ) : (
              <span className={s.picture}>
                <ImageView image={image} className={s.shot} />
              </span>
            )}
            <figcaption className={s.caption}>{t.latest(latest.of)}</figcaption>
          </figure>
        )}
      </div>
      {error !== undefined && <Problem size="small">{error}</Problem>}
    </>
  )
}
