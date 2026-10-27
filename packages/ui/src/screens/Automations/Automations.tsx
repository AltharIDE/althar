import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { Heading, type HeadingLevel, below } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { AutomationChip, type AutomationRunMark, type AutomationTone, RunMarks } from './marks'
import s from './Automations.module.css'

export type { AutomationRunMark, AutomationTone } from './marks'

/*
 * A project's Automations tab, a view of its own beside the board: work
 * that starts by itself, on a schedule. A head with the way to make one and
 * to pause them all, then the automations as cards, one column down the
 * middle of the project's ground. The one that paused itself comes first,
 * violet, saying why in place of its prompt; one the person paused is
 * quiet. Each card says when it runs and where it stands, two lines of its
 * prompt, and its last seven runs as marks with what the last one did; the
 * whole card opens the automation as its own page (AutomationPage). Making
 * one is asking the coordinator, or New automation: no form opens in the
 * list.
 */

export interface AutomationsText {
  title: string
  lede: string
  new: string
  more: string
  pauseAll: string
  resumeAll: string
  /** Every automation is paused, said once. */
  allPaused: string
  resume: string
  /** Where they run, while Althar isn't opened at login. */
  where: string
  atLogin: string
  /** Its group, with how many are in it. */
  scheduled: string
  /** None yet: what to say to the coordinator, or New automation. */
  empty: (example: ReactNode) => ReactNode
  example: string
  /** Its last run's line, where it hasn't run. */
  never: string
  /** The marks' name. */
  marks: (n: number) => string
  /** A mark's words. */
  mark: (at: string, words: string) => string
}

export const automationsText: AutomationsText = {
  title: 'Automations',
  lede: 'Work that starts by itself, on a schedule. Make one here, or ask the coordinator.',
  new: 'New automation',
  more: 'More',
  pauseAll: 'Pause all automations',
  resumeAll: 'Resume all automations',
  allPaused: 'Every automation is paused. None starts until you resume them.',
  resume: 'Resume',
  where: 'They run on this Mac while Althar is open.',
  atLogin: 'Open Althar at login',
  scheduled: 'On a schedule',
  empty: (example) => <>None yet. Ask the coordinator, as in {example}, or make one with New automation.</>,
  example: '“every weekday at 9, review the new pull requests”',
  never: 'Hasn’t run yet',
  marks: (n) => (n === 1 ? 'Its last run' : `Its last ${n} runs`),
  mark: (at, words) => `${at} · ${words}`,
}

/** An automation as its card on the tab shows it. */
export interface AutomationTile {
  id: string
  name: string
  /** When it runs, in words: Every weekday at 9:00. */
  when: string
  /** Where it stands, in a few words, at its right: Next tomorrow 9:00, Running since 9:21, Paused itself. */
  standing: string
  tone: AutomationTone
  /** Paused, by the person or by itself: its chip shows the pause. */
  paused: boolean
  prompt: string
  /** Why it paused itself, in a sentence: shown in place of its prompt. */
  why?: string
  /** Its latest runs, newest first: seven at most. */
  runs: readonly AutomationRunMark[]
}

export type AutomationsProps = RootProps<
  'div',
  {
    /** In the order they show: the one that paused itself first. */
    automations: readonly AutomationTile[]
    /** Opens one as its own page. */
    onOpen: (id: string) => void
    /** Opens a new one, blank, as its own page. */
    onNew?: () => void
    /** Every automation is paused. */
    allPaused?: boolean
    /** Pauses every automation, or resumes them. Runs under way finish. */
    onPauseAll?: (paused: boolean) => void
    /** Says where they run: on this computer, while Althar is open, as it isn't opened at login. */
    where?: boolean
    /** Has Althar opened at login, in the background. */
    onOpenAtLogin?: () => void
    /** What went wrong with the last thing asked of them. */
    error?: string
    headingLevel?: HeadingLevel
    text?: Partial<AutomationsText>
  }
>

const TONES: Readonly<Record<AutomationTone, string | undefined>> = {
  yours: s.toneYours,
  paused: s.tonePaused,
  live: s.toneLive,
  quiet: undefined,
}

/** One automation's card: the whole of it opens its page, through its name; its marks can be pointed at on their own. */
function Tile({ one, onOpen, t }: { one: AutomationTile; onOpen: (id: string) => void; t: AutomationsText }) {
  const last = one.runs[0]
  return (
    <article className={cx(s.card, one.tone === 'yours' && s.cardYours, one.tone === 'paused' && s.cardPaused)}>
      <span className={s.cardTop}>
        <AutomationChip tone={one.tone} paused={one.paused} />
        <span className={s.cardTitle}>
          <button type="button" className={s.cardName} onClick={() => onOpen(one.id)}>
            {one.name}
          </button>
          <span className={s.cardWhen}>{one.when}</span>
        </span>
        <span className={cx(s.cardState, TONES[one.tone])}>{one.standing}</span>
      </span>
      <p className={cx(s.cardPrompt, one.why !== undefined && s.cardWhy)}>{one.why ?? one.prompt}</p>
      <span className={s.cardFoot}>
        <RunMarks runs={one.runs} label={t.marks} mark={t.mark} />
        <span className={s.cardLast}>
          {last === undefined ? (
            t.never
          ) : (
            <>
              <span className={s.cardAt}>{last.at}</span>
              {last.words}
            </>
          )}
        </span>
      </span>
    </article>
  )
}

export function Automations({
  automations,
  onOpen,
  onNew,
  allPaused = false,
  onPauseAll,
  where = false,
  onOpenAtLogin,
  error,
  headingLevel = 2,
  text,
  className,
  ...rest
}: AutomationsProps) {
  const t = { ...automationsText, ...text }
  return (
    <div className={cx(s.view, className)} {...rest}>
      <div className={s.column}>
        <header className={s.head}>
          <div className={s.headWords}>
            <Heading level={headingLevel} className={s.title}>
              {t.title}
            </Heading>
            <p className={s.lede}>{t.lede}</p>
          </div>
          {onNew !== undefined && (
            <Button icon="plus" onClick={onNew}>
              {t.new}
            </Button>
          )}
          {onPauseAll !== undefined && (
            <Menu label={t.more} align="end" width={230} trigger={<IconButton icon="more" label={t.more} />}>
              <MenuItem icon={allPaused ? 'play' : 'hold'} onSelect={() => onPauseAll(!allPaused)}>
                {allPaused ? t.resumeAll : t.pauseAll}
              </MenuItem>
            </Menu>
          )}
        </header>
        {error !== undefined && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {allPaused && (
          <p className={s.line}>
            {t.allPaused}
            {onPauseAll !== undefined && (
              <>
                {' '}
                <LinkButton onClick={() => onPauseAll(false)}>{t.resume}</LinkButton>
              </>
            )}
          </p>
        )}
        {where && automations.length > 0 && (
          <p className={s.line}>
            {t.where}
            {onOpenAtLogin !== undefined && (
              <>
                {' '}
                <LinkButton onClick={onOpenAtLogin}>{t.atLogin}</LinkButton>
              </>
            )}
          </p>
        )}
        {automations.length === 0 ? (
          <p className={s.empty}>{t.empty(<span className={s.example}>{t.example}</span>)}</p>
        ) : (
          <section className={s.group} aria-label={t.scheduled}>
            <Heading level={below(headingLevel)} className={s.groupHead}>
              {t.scheduled} <span className={s.groupCount}>{automations.length}</span>
            </Heading>
            <div className={s.cards}>
              {automations.map((one) => (
                <Tile key={one.id} one={one} onOpen={onOpen} t={t} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
