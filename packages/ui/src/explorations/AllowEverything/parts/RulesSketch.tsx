import { Fragment, type ReactNode } from 'react'

import { MERIDIAN_COMMANDS, MERIDIAN_KINDS } from '../../../fixtures/rules'
import { RuleKind, RulePlace } from '../../../foundations/vocabulary'
import { cx } from '../../../lib/cx'
import type { RootProps } from '../../../lib/props'
import { Heading, type HeadingLevel } from '../../../primitives/Heading/Heading'
import { projectRulesText } from '../../../screens/ProjectRules/ProjectRules'
import { Charter, CharterKey, Clause, CommandToken } from '../../../setup/Charter/Charter'
import s from './RulesSketch.module.css'

/*
 * The rules page as far as these paths touch it: the same sentences, from
 * the same parts and words, for Meridian's rules, with a place at the top
 * for each path's control and a way to say which sentences are off. The
 * kinds and commands only read here: moving them is the real page's, and
 * unchanged by any path. How a task ends and what a limit does follow, as
 * they are now.
 */

export type RulePart = 'never' | 'ask' | 'allow' | 'rest'

export interface RulesSketchText {
  title: string
  lede: (project: string) => string
  /** At the foot: what follows on the real page, untouched. */
  follows: string
}

export const rulesSketchText: RulesSketchText = {
  title: 'Rules',
  lede: projectRulesText.lede,
  follows: 'How a task ends, its names, and what a usage limit does follow here, as they are now.',
}

export type RulesSketchProps = RootProps<
  'div',
  {
    project: string
    headingLevel?: HeadingLevel
    /** The path's control, over the sentences. */
    top?: ReactNode
    /** The rest's word: a ChoiceWord where it is chosen in the sentence, or the words of what is chosen elsewhere. */
    restWord: ReactNode
    /** What follows the rest's word, in the sentence. */
    restAfter?: ReactNode
    /** Sentences that hold for nothing just now, and why, said under each. */
    off?: Partial<Record<RulePart, string>>
    /** Sentences after the rest's, as Clauses. */
    more?: ReactNode
    text?: Partial<RulesSketchText>
  }
>

const KINDS = [
  RuleKind.DefaultBranch,
  RuleKind.ForcePush,
  RuleKind.ManyBranches,
  RuleKind.DeleteBranch,
  RuleKind.Deploy,
  RuleKind.Outside,
] as const

/** Things in a list, as a sentence has them: a, b and c. */
const join = (items: readonly ReactNode[], last: string) =>
  items.map((item, index) => (
    <Fragment key={index}>
      {index > 0 && (index === items.length - 1 ? ` ${last} ` : ', ')}
      {item}
    </Fragment>
  ))

export function RulesSketch({
  project,
  headingLevel = 1,
  top,
  restWord,
  restAfter,
  off = {},
  more,
  text,
  className,
  ...rest
}: RulesSketchProps) {
  const t = { ...rulesSketchText, ...text }
  const w = projectRulesText
  const sub: HeadingLevel = headingLevel >= 6 ? 6 : ((headingLevel + 1) as HeadingLevel)
  const kindsAt = (place: RulePlace) =>
    KINDS.filter((kind) => MERIDIAN_KINDS[kind] === place).map((kind) => (
      <span key={kind} className={s.kind}>
        {place === RulePlace.Never ? w.kinds[kind].does : w.kinds[kind].doing}
      </span>
    ))
  const commandsAt = (place: RulePlace) =>
    MERIDIAN_COMMANDS.filter((command) => command.place === place).map((command) => (
      <CommandToken key={command.id} pattern={command.pattern} match={command.match} />
    ))
  // A sentence that holds for nothing is quieter, its commands with it.
  const offOf = (part: RulePart) => (off[part] === undefined ? {} : { off: off[part], className: s.quiet })
  return (
    <div className={cx(s.page, className)} {...rest}>
      <header className={s.head}>
        <div>
          <Heading level={headingLevel} className={s.title}>
            {t.title}
          </Heading>
          <p className={s.lede}>{t.lede(project)}</p>
        </div>
        <CharterKey className={s.key} />
      </header>
      {top != null && <div className={s.top}>{top}</div>}
      <Charter>
        <Clause label={w.label.always} headingLevel={sub} fixed>
          {w.fixed}
        </Clause>
        <Clause label={w.label.never} headingLevel={sub} {...offOf('never')}>
          {w.never.does(w.agents)}
          {join(kindsAt(RulePlace.Never), w.or)}
          {w.never.andRuns}
          {join(commandsAt(RulePlace.Never), w.or)}.
        </Clause>
        <Clause label={w.label.ask} headingLevel={sub} {...offOf('ask')}>
          {w.ask.before(w.they)}
          {join(kindsAt(RulePlace.Ask), w.or)}
          {w.ask.andRunning}
          {join(commandsAt(RulePlace.Ask), w.or)}.
        </Clause>
        <Clause label={w.label.allow} headingLevel={sub} {...offOf('allow')}>
          {w.allow.with(w.they)}
          {join(commandsAt(RulePlace.Allow), w.and)}.
        </Clause>
        <Clause label={w.label.rest} headingLevel={sub} {...offOf('rest')}>
          {w.rest.like}
          {join(kindsAt(RulePlace.Rest), w.and)}
          {w.rest.colon}
          {restWord}.{restAfter != null && <> {restAfter}</>}
        </Clause>
        {more}
      </Charter>
      <p className={s.follows}>{t.follows}</p>
    </div>
  )
}
