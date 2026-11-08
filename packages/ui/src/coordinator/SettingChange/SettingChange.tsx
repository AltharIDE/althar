import { useState, type ReactNode } from 'react'

import { Rhythm } from '../../lib/rhythm'
import type { RootProps } from '../../lib/props'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import s from './SettingChange.module.css'

/*
 * An agent's change to a setting, in its conversation (ADR-097). Made, it is
 * one line: the setting, what it was and is now, with Undo. One that loosens
 * what asks, and that no message of the person's asked for, is a card they
 * press first: Change makes it, Not now leaves it. Once undone, declined or
 * overtaken, a line saying so.
 */

export interface SettingChangeMove {
  readonly label: string
  readonly before: string
  readonly after: string
}

export interface SettingChangeText {
  kicker: string
  /** The question on a card: the settings, and where. */
  ask: (what: ReactNode, where: string) => ReactNode
  change: string
  notNow: string
  declined: string
  undone: string
  moot: string
  /** Where: a project's settings, or Althar's own. */
  where: (section: string, project: string | null) => string
}

export const settingChangeText: SettingChangeText = {
  kicker: 'Setting',
  ask: (what, where) => (
    <>
      Change {what} in {where}?
    </>
  ),
  change: 'Change',
  notNow: 'Not now',
  declined: 'Not now.',
  undone: 'Undone.',
  moot: 'Nothing to do.',
  where: (section, project) => (project === null ? `Settings › ${section}` : `${project} › ${section}`),
}

export type SettingChangeProps = RootProps<
  'div',
  {
    /** The section's title, as Settings names it. */
    section: string
    /** The project, by name; null for Althar's own settings. */
    project: string | null
    moves: ReadonlyArray<SettingChangeMove>
    state: 'asked' | 'done' | 'undone' | 'declined' | 'moot'
    /** The person's words it acted on, where it did. */
    words?: string
    /** Why the agent asks, on a card. */
    why?: string
    /** Why there was nothing to do, where it was overtaken. */
    said?: string
    /** Answers a card: yes makes the change. Without it, no buttons. */
    onAnswer?: (yes: boolean) => void
    /** Puts back what was there. Without it, no Undo. */
    onUndo?: () => void
    busy?: boolean
    text?: Partial<SettingChangeText>
  }
>

/** The person's words, on one line and cut short. */
const short = (words: string) => {
  const line = words.replace(/\s+/g, ' ').trim()
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}

/** One setting moved: its name, then before → after. */
function Moved({ move }: { move: SettingChangeMove }) {
  return (
    <span className={s.move}>
      {move.label} <span className={s.before}>{move.before}</span> → <b>{move.after}</b>
    </span>
  )
}

export function SettingChange({
  section,
  project,
  moves,
  state,
  words,
  why,
  said,
  onAnswer,
  onUndo,
  busy = false,
  text,
  className,
  ...rest
}: SettingChangeProps) {
  const t = { ...settingChangeText, ...text }
  const [answered, setAnswered] = useState(false)
  const where = t.where(section, project)
  const list = moves.map((move, at) => (
    <span key={move.label}>
      {at > 0 && '; '}
      <Moved move={move} />
    </span>
  ))
  if (state === 'asked') {
    const answer = (yes: boolean) => {
      setAnswered(true)
      onAnswer?.(yes)
    }
    return (
      <AskCard icon="gear" kicker={t.kicker} what={t.ask(<>{list}</>, where)} className={className} data-rhythm={Rhythm.Card} {...rest}>
        {why !== undefined && <p className={s.why}>{why}</p>}
        {onAnswer !== undefined && (
          <AskFoot>
            <Button variant="quiet" disabled={busy} onClick={() => answer(false)}>
              {t.notNow}
            </Button>
            <Button variant="signal" busy={busy} onClick={() => answer(true)}>
              {t.change}
            </Button>
          </AskFoot>
        )}
      </AskCard>
    )
  }
  if (state === 'done')
    return (
      <AskAnswered
        className={className}
        data-rhythm={Rhythm.Fold}
        said={<>{list}</>}
        wrap
        focusOnMount={answered}
        {...(onUndo === undefined ? {} : { onUndo })}
        {...rest}
      >
        <AskNote>{words === undefined ? where : `${where}, as you asked: “${short(words)}”`}</AskNote>
      </AskAnswered>
    )
  return (
    <AskAnswered
      className={className}
      data-rhythm={Rhythm.Fold}
      denied={state !== 'undone'}
      said={state === 'undone' ? t.undone : state === 'declined' ? t.declined : t.moot}
      wrap
      focusOnMount={answered}
      {...rest}
    >
      <AskNote>{state === 'moot' && said !== undefined ? said : <>{list}</>}</AskNote>
    </AskAnswered>
  )
}
