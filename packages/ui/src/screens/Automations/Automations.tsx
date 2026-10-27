import { type ReactNode, useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
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
 * list. With none yet, the tab says what they are for and offers a few to
 * start from, each opening a new one filled in, with New automation for a
 * blank one. Once all are paused, a band under the head says so with
 * Resume all, and every card is quiet.
 */

export interface AutomationsText {
  title: string
  lede: string
  new: string
  more: string
  pauseAll: string
  resumeAll: string
  /** Every automation is paused: the band's title, and what it means. */
  allPaused: string
  allPausedNote: string
  /** Where they run, while Althar isn't opened at login. */
  where: string
  atLogin: string
  /** Its group, with how many are in it. */
  scheduled: string
  /** None yet: what they are for. */
  emptyTitle: string
  emptyLede: string
  /** The few to start from. */
  starters: string
  /** Beside New automation: what to say to the coordinator instead. */
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
  resumeAll: 'Resume all',
  allPaused: 'Every automation is paused',
  allPausedNote: 'None starts until you resume them. Runs under way finish.',
  where: 'They run on this Mac while Althar is open.',
  atLogin: 'Open Althar at login',
  scheduled: 'On a schedule',
  emptyTitle: 'Nothing runs by itself yet',
  emptyLede: 'An automation starts a task on a schedule, as you would ask the coordinator, and keeps what came of each run here.',
  starters: 'Start from one of these',
  empty: (example) => <>or ask the coordinator, as in {example}</>,
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

/** One to start from, while there are none: what it is called, when it would run, and what it asks. */
export interface AutomationStarter {
  id: string
  name: string
  when: string
  prompt: string
}

export type AutomationsProps = RootProps<
  'div',
  {
    /** In the order they show: the one that paused itself first. */
    automations: readonly AutomationTile[]
    /** Opens one as its own page. */
    onOpen: (id: string) => void
    /** Opens a new one as its own page: blank, or filled in from a starter. */
    onNew?: (starter?: string) => void
    /** A few to start from, while there are none. */
    starters?: readonly AutomationStarter[]
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

/** Every automation is paused: a band under the head, with its mark, what it means, and Resume all. */
function Paused({ onResume, t }: { onResume?: () => void; t: AutomationsText }) {
  const id = useId()
  return (
    <div className={s.band} role="status" aria-labelledby={id}>
      <span className={s.bandMark} aria-hidden="true">
        <Icon name="hold" size={14} />
      </span>
      <div className={s.bandWords}>
        <span id={id} className={s.bandTitle}>
          {t.allPaused}
        </span>
        <span className={s.bandNote}>{t.allPausedNote}</span>
      </div>
      {onResume !== undefined && (
        <Button icon="play" onClick={onResume}>
          {t.resumeAll}
        </Button>
      )}
    </div>
  )
}

/** None yet: what they are for, a few to start from, and New automation or what to say to the coordinator. */
function NoneYet({
  starters,
  onNew,
  level,
  t,
}: {
  starters: readonly AutomationStarter[]
  onNew?: (starter?: string) => void
  level: HeadingLevel
  t: AutomationsText
}) {
  const id = useId()
  return (
    <section className={s.none} aria-labelledby={id}>
      <div className={s.noneHead}>
        <span className={s.noneMark} aria-hidden="true">
          <Icon name="automation" size={18} />
        </span>
        <div>
          <Heading level={level} id={id} className={s.noneTitle}>
            {t.emptyTitle}
          </Heading>
          <p className={s.noneLede}>{t.emptyLede}</p>
        </div>
      </div>
      {starters.length > 0 && onNew !== undefined && (
        <>
          <Heading level={below(level)} className={s.groupHead}>
            {t.starters}
          </Heading>
          <ul className={s.starters}>
            {starters.map((one) => (
              <li key={one.id} className={s.starterItem}>
                <button type="button" className={s.starter} onClick={() => onNew(one.id)}>
                  <span className={s.starterName}>{one.name}</span>
                  <span className={s.starterWhen}>
                    <Icon name="clock" size={12} />
                    {one.when}
                  </span>
                  <span className={s.starterPrompt}>{one.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={s.noneFoot}>
        {onNew !== undefined && (
          <Button icon="plus" onClick={() => onNew()}>
            {t.new}
          </Button>
        )}
        <p className={s.noneAsk}>{t.empty(<span className={s.example}>{t.example}</span>)}</p>
      </div>
    </section>
  )
}

export function Automations({
  automations,
  onOpen,
  onNew,
  starters = [],
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
  const none = automations.length === 0
  return (
    <div className={cx(s.view, className)} {...rest}>
      <div className={s.column}>
        <header className={s.head}>
          <div className={s.headWords}>
            <Heading level={headingLevel} className={s.title}>
              {t.title}
            </Heading>
            {/* With none yet, what they are for is said below, with the way to make one. */}
            {!none && <p className={s.lede}>{t.lede}</p>}
          </div>
          {!none && onNew !== undefined && (
            <Button icon="plus" onClick={() => onNew()}>
              {t.new}
            </Button>
          )}
          {onPauseAll !== undefined && (!none || allPaused) && (
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
        {allPaused && <Paused t={t} {...(onPauseAll === undefined ? {} : { onResume: () => onPauseAll(false) })} />}
        {where && !none && (
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
        {none ? (
          <NoneYet starters={starters} level={below(headingLevel)} t={t} {...(onNew === undefined ? {} : { onNew })} />
        ) : (
          <section className={s.group} aria-label={t.scheduled}>
            <Heading level={below(headingLevel)} className={s.groupHead}>
              {t.scheduled} <span className={s.groupCount}>{automations.length}</span>
            </Heading>
            <div className={cx(s.cards, allPaused && s.cardsPaused)}>
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
