import { useState, type ReactNode } from 'react'

import { Rhythm } from '../../lib/rhythm'
import type { RootProps } from '../../lib/props'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './SettingChange.module.css'

/*
 * An agent's change to a setting, in its conversation (ADR-097). Made, it is
 * a line of what changed, in plain words and real names (`Turned on Kimi K3.1
 * Pro in OpenCode`, `Default effort for Claude Opus 5.5: high → xhigh`), with
 * Undo: never a list or an object's whole self. Several changes fold to a
 * count, with each one a press away. One that loosens what asks, and that no
 * message of the person's asked for, is a card they press first: Change
 * makes it, Not now leaves it. Once undone, declined or overtaken, a line
 * saying so.
 */

export interface SettingChangeMove {
  readonly label: string
  /** What it was and is, in a few words; a change kept before `changes` may hold a whole list, which is never shown. */
  readonly before: string
  readonly after: string
  /** What moved, a line for each thing, in plain words. */
  readonly changes?: ReadonlyArray<string>
}

export interface SettingChangeText {
  kicker: string
  /** The question on a card: how many changes, and where. */
  ask: (count: number, where: string) => ReactNode
  /** Several changes, folded to a line. */
  many: (count: number) => string
  show: (count: number) => string
  hide: string
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
  ask: (count, where) => `${count === 1 ? 'Make this change' : `Make these ${count} changes`} in ${where}?`,
  many: (count) => `${count} changes`,
  show: (count) => `Show all ${count}`,
  hide: 'Hide',
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

/** The longest a value is let run in a line, as a change kept before its lines were words may hold a whole list. */
const LONGEST = 60

/**
 * What a move says, a line for each thing that moved. A change kept before it had its lines says what it can: a short
 * value before and after, and for a long one, which is a list or an object, only that the setting changed.
 */
const changeLinesOf = (move: SettingChangeMove): ReadonlyArray<string> => {
  if (move.changes !== undefined) return move.changes
  const plain = (value: string) => value.length <= LONGEST && !/^[[{]/.test(value)
  return plain(move.before) && plain(move.after) ? [`${move.label}: ${move.before} → ${move.after}`] : [`${move.label} changed`]
}

/** Lines, one under another. */
function Lines({ lines }: { lines: ReadonlyArray<string> }) {
  return (
    <ul className={s.lines}>
      {lines.map((line, at) => (
        // A line can repeat (a setting named twice), so it is its place that tells them apart.
        <li key={`${at}:${line}`}>{line}</li>
      ))}
    </ul>
  )
}

/** How many lines a made change reads in full, beside its Undo, before it folds to a count. */
const FEW = 2

/** A card's lines, which it shows whole up to this many. */
const CARD_FEW = 5

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
  const [all, setAll] = useState(false)
  const where = t.where(section, project)
  const lines = moves.flatMap(changeLinesOf)
  const toggle = (limit: number) =>
    lines.length > limit && (
      <LinkButton aria-expanded={all} onClick={() => setAll(!all)}>
        {all ? t.hide : t.show(lines.length)}
      </LinkButton>
    )
  if (state === 'asked') {
    const answer = (yes: boolean) => {
      setAnswered(true)
      onAnswer?.(yes)
    }
    return (
      <AskCard icon="gear" kicker={t.kicker} what={t.ask(lines.length, where)} className={className} data-rhythm={Rhythm.Card} {...rest}>
        <Lines lines={all ? lines : lines.slice(0, CARD_FEW)} />
        {lines.length > CARD_FEW && <p className={s.more}>{toggle(CARD_FEW)}</p>}
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
  if (state === 'done') {
    const folded = lines.length > FEW
    return (
      <AskAnswered
        className={className}
        data-rhythm={Rhythm.Fold}
        said={folded ? t.many(lines.length) : lines.join('; ')}
        flow
        focusOnMount={answered}
        {...(onUndo === undefined ? {} : { onUndo })}
        {...(folded && all ? { detail: <Lines lines={lines} /> } : {})}
        {...rest}
      >
        <AskNote>{words === undefined ? where : `${where}, as you asked: “${short(words)}”`}</AskNote>
        {folded && toggle(FEW)}
      </AskAnswered>
    )
  }
  return (
    <AskAnswered
      className={className}
      data-rhythm={Rhythm.Fold}
      denied={state !== 'undone'}
      said={state === 'undone' ? t.undone : state === 'declined' ? t.declined : t.moot}
      flow
      focusOnMount={answered}
      {...rest}
    >
      <AskNote>{state === 'moot' && said !== undefined ? said : lines.length === 1 ? lines[0] : t.many(lines.length)}</AskNote>
    </AskAnswered>
  )
}
