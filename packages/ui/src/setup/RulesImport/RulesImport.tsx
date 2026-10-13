import { useState } from 'react'

import { CommandMatch, RulePlace } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { AskCard, AskFoot } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { CheckList } from '../../primitives/CheckList/CheckList'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { CommandToken } from '../Charter/Charter'
import s from './RulesImport.module.css'

/*
 * A project's rules started from its agents' own settings (ADR-034): what
 * their files say, as a proposal. Each rule that can be one of the
 * project's sits under the sentence it would join, Never, Always ask me or
 * Go ahead, with where it came from and how the file wrote it, and the
 * person takes all of it, some or none: every one is chosen to start with.
 * What can't be one is listed apart, each with why. Nothing is kept until
 * the person takes it. RulesOffer is the card that offers it, once, as a
 * project opens.
 */

/** Where a rule taken would sit: never with the rest, which is for what no rule names. */
export type ImportPlace = RulePlace.Never | RulePlace.Ask | RulePlace.Allow

/** A rule of the agents' that can be one of the project's. */
export interface ImportRule {
  id: string
  /** The sentence it would join. */
  place: ImportPlace
  /** The command, as the project's rule would keep it. */
  pattern: string
  match: CommandMatch
  /** Its file, as the person would find it: .claude/settings.json. */
  from: string
  /** How the file wrote it: Bash(rm -rf:*). */
  said: string
}

/** A rule of the agents' that can't be one of the project's, and why. */
export interface SkippedRule {
  id: string
  from: string
  said: string
  /** Why, in a sentence. */
  why: string
}

export interface RulesImportText {
  title: string
  description: string
  /** Each sentence's name, over the rules that would join it. */
  place: Record<ImportPlace, string>
  /** Under a rule: its file, and how it was written there. */
  from: (file: string, said: string) => string
  /** What can't be taken, by how many: the fold's row. */
  skipped: (count: number) => string
  /** Under a rule that can't be taken: its file. */
  skippedFrom: (file: string) => string
  /** Files that couldn't be read as their agents read them. */
  unreadable: (files: string) => string
  /** Nothing to take. */
  none: string
  /** While the files are read. */
  reading: string
  take: (count: number) => string
  /** Taken with none chosen. */
  chooseFirst: string
  /** Turning it down: nothing taken, and the offer answered. */
  decline: string
  cancel: string
}

export const rulesImportText: RulesImportText = {
  title: 'Rules from your agents',
  description:
    'Their own settings say these. Take all of them, some or none: the files stay as they are, and nothing changes here until you take it.',
  place: { [RulePlace.Never]: 'Never', [RulePlace.Ask]: 'Always ask me', [RulePlace.Allow]: 'Go ahead' },
  from: (file, said) => `From ${file}, as ${said}`,
  skipped: (count) => (count === 1 ? 'One can’t be taken' : `${count} can’t be taken`),
  skippedFrom: (file) => `From ${file}`,
  unreadable: (files) => `Althar couldn’t read ${files} as its agent does.`,
  none: 'Nothing in them can be one of this project’s rules.',
  reading: 'Reading your agents’ settings…',
  take: (count) => (count === 1 ? 'Take 1 rule' : `Take ${count} rules`),
  chooseFirst: 'Choose a rule to take first.',
  decline: 'Take none',
  cancel: 'Cancel',
}

const PLACES = [RulePlace.Never, RulePlace.Ask, RulePlace.Allow] as const

export interface RulesImportProps {
  /** The rules that can be taken, in the order read. */
  rules: readonly ImportRule[]
  /** Those that can't, with why. */
  skipped?: readonly SkippedRule[]
  /** Files that couldn't be read, as the person would find them: said in a line under the rest. */
  unreadable?: readonly string[]
  /** The rules chosen, by id: every one to start with. */
  chosen?: readonly string[]
  defaultChosen?: readonly string[]
  onChosenChange?: (ids: readonly string[]) => void
  /** Takes those chosen. */
  onTake: (ids: readonly string[]) => void
  /** Takes none, answering the offer as the project opened. Without it, there is Cancel, which only closes. */
  onDecline?: () => void
  /** Escape, a click outside, or Cancel. */
  onClose: () => void
  /** The files are still being read: nothing to say of them yet. */
  reading?: boolean
  /** What was chosen is on its way. */
  taking?: boolean
  error?: string
  text?: Partial<RulesImportText>
}

/** The agents' rules as a proposal, in a dialog: each taken or not, and what can't be, with why. */
export function RulesImport({
  rules,
  skipped = [],
  unreadable = [],
  chosen,
  defaultChosen,
  onChosenChange,
  onTake,
  onDecline,
  onClose,
  reading = false,
  taking = false,
  error,
  text,
}: RulesImportProps) {
  const t = { ...rulesImportText, ...text }
  // What the person took out; until they change anything, what is chosen to start with: every one, unless said. Kept as
  // what was taken out, so rules read after it opened, or read again, start chosen too.
  const [dropped, setDropped] = useState<ReadonlySet<string> | null>(null)
  const own =
    dropped === null
      ? (defaultChosen ?? rules.map((rule) => rule.id)).filter((id) => rules.some((rule) => rule.id === id))
      : rules.flatMap((rule) => (dropped.has(rule.id) ? [] : [rule.id]))
  const ids = chosen ?? own
  const setIds = (next: readonly string[]) => {
    if (chosen === undefined) setDropped(new Set(rules.flatMap((rule) => (next.includes(rule.id) ? [] : [rule.id]))))
    onChosenChange?.(next)
  }
  const [unchosen, setUnchosen] = useState(false)
  const take = () => {
    if (ids.length === 0) return setUnchosen(true)
    onTake(ids)
  }
  const said = unchosen && ids.length === 0 ? t.chooseFirst : error
  return (
    <Dialog
      title={t.title}
      description={t.description}
      onClose={onClose}
      holding={taking}
      width={560}
      actions={
        <>
          <Button variant="quiet" onClick={onDecline ?? onClose}>
            {onDecline === undefined ? t.cancel : t.decline}
          </Button>
          {!reading && rules.length > 0 && (
            <Button variant="ink" busy={taking} onClick={take}>
              {t.take(ids.length)}
            </Button>
          )}
        </>
      }
    >
      {reading ? (
        <p className={s.none} aria-busy="true">
          {t.reading}
        </p>
      ) : (
        rules.length === 0 && <p className={s.none}>{t.none}</p>
      )}
      {!reading &&
        PLACES.map((place) => {
          const here = rules.filter((rule) => rule.place === place)
          if (here.length === 0) return null
          // Each sentence's choices, kept in the order of every rule, as a CheckList hands back its own.
          const others = ids.filter((id) => !here.some((rule) => rule.id === id))
          return (
            <section key={place} className={s.place} aria-label={t.place[place]}>
              <h3 className={s.placeName}>{t.place[place]}</h3>
              <CheckList
                label={t.place[place]}
                items={here.map((rule) => ({
                  id: rule.id,
                  label: <CommandToken pattern={rule.pattern} match={rule.match} />,
                  detail: t.from(rule.from, rule.said),
                }))}
                value={ids.filter((id) => here.some((rule) => rule.id === id))}
                onChange={(next) => {
                  const all = new Set([...others, ...next])
                  setIds(rules.flatMap((rule) => (all.has(rule.id) ? [rule.id] : [])))
                }}
              />
            </section>
          )
        })}
      {!reading && skipped.length > 0 && (
        <Disclosure className={s.skipped}>
          <DisclosureTrigger>
            <LinkButton className={s.skippedRow}>
              <Caret />
              {t.skipped(skipped.length)}
            </LinkButton>
          </DisclosureTrigger>
          <Fold>
            <ul className={s.skippedList}>
              {skipped.map((rule) => (
                <li key={rule.id} className={s.skippedRule}>
                  <code className={s.said}>{rule.said}</code>
                  <span className={s.why}>{rule.why}</span>
                  <span className={s.where}>{t.skippedFrom(rule.from)}</span>
                </li>
              ))}
            </ul>
          </Fold>
        </Disclosure>
      )}
      {unreadable.length > 0 && <p className={s.unreadable}>{t.unreadable(unreadable.join(', '))}</p>}
      {said !== undefined && (
        <p className={s.error} role="alert">
          {said}
        </p>
      )}
    </Dialog>
  )
}

export interface RulesOfferText {
  kicker: string
  /** What the agents' settings offer, by how many rules can be taken. */
  what: (count: number) => string
  review: string
  decline: string
}

export const rulesOfferText: RulesOfferText = {
  kicker: 'Rules from your agents',
  what: (count) =>
    count === 1
      ? 'Your agents’ own settings name a rule this project could start from.'
      : `Your agents’ own settings name ${count} rules this project could start from.`,
  review: 'Review',
  decline: 'Take none',
}

export type RulesOfferProps = RootProps<
  'div',
  {
    /** How many of the agents' rules can be taken. */
    count: number
    /** Opens the proposal. */
    onReview: () => void
    /** Takes none, answering the offer. */
    onDecline: () => void
    /** Turning it down is on its way. */
    declining?: boolean
    text?: Partial<RulesOfferText>
  }
>

/** The offer, once, as a project opens: its agents' own settings name rules it could start from. */
export function RulesOffer({ count, onReview, onDecline, declining = false, text, className, ...rest }: RulesOfferProps) {
  const t = { ...rulesOfferText, ...text }
  return (
    <AskCard icon="agents" kicker={t.kicker} what={t.what(count)} className={cx(s.offer, className)} {...rest}>
      <AskFoot>
        <Button variant="signal" onClick={onReview}>
          {t.review}
        </Button>
        <Button variant="quiet" busy={declining} onClick={onDecline}>
          {t.decline}
        </Button>
      </AskFoot>
    </AskCard>
  )
}
