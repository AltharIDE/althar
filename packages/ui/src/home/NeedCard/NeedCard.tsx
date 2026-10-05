import { type ReactNode, useId } from 'react'

import type { CodeHost } from '../../foundations/codeHost'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Code } from '../../primitives/Code/Code'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type ProjectRef, ProjectWord } from '../ProjectWord/ProjectWord'
import s from './NeedCard.module.css'

/*
 * Something on the home that waits on you, from any project: a permission,
 * a change ready to accept, a decision, an agent to sign in, a task that
 * stalled. It says what kind of call it is, whose, and what it asks, and
 * holds its answers at the right, so the quick ones are given where they
 * are. Opening it (its title) puts it in the dock, for the ones that need
 * reading first.
 *
 * What it asks and how it is answered differ by kind, so they are slots:
 * a NeedCommand, NeedChange or NeedOptions under the title, and Buttons at
 * the right. Answered, the consumer folds it to an AskAnswered.
 */

export interface NeedCardText {
  /** Read before the task's number, which is shown alone. */
  task: string
}

export const needCardText: NeedCardText = { task: 'Task' }

export type NeedCardProps = RootProps<
  'article',
  {
    /** What kind of call, in a word or two: Permission, Ready to accept, Decision. */
    kind: string
    project: ProjectRef
    /** The task it comes from, by number. */
    task?: string
    title: string
    /** When it was raised: 4m ago. */
    at?: string
    /** What it asks, under the title: a NeedCommand, a NeedChange, NeedOptions, or a sentence. */
    detail?: ReactNode
    /** Its answers, at the right: Buttons, the one that matters most in violet. */
    actions?: ReactNode
    /** Open it in the dock. Without it, the title is words. */
    onOpen?: () => void
    /** It is open in the dock. */
    current?: boolean
    text?: Partial<NeedCardText>
  }
>

export function NeedCard({ kind, project, task, title, at, detail, actions, onOpen, current, className, text, ...rest }: NeedCardProps) {
  const t = { ...needCardText, ...text }
  const titleId = useId()
  return (
    <article aria-labelledby={titleId} aria-current={current || undefined} className={cx(s.card, className)} {...rest}>
      <div className={s.top}>
        <span className={s.kind}>{kind}</span>
        <ProjectWord project={project} />
        {task && (
          <span className={s.ref}>
            <VisuallyHidden>{t.task} </VisuallyHidden>
            {task}
          </span>
        )}
        {at && <span className={s.at}>{at}</span>}
      </div>
      <div className={s.body}>
        <div className={s.main}>
          <h3 className={s.title} id={titleId}>
            {onOpen ? (
              <button type="button" className={s.open} onClick={onOpen}>
                {title}
              </button>
            ) : (
              title
            )}
          </h3>
          {typeof detail === 'string' ? <p className={s.words}>{detail}</p> : detail}
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
    </article>
  )
}

/* ---- What a call asks ------------------------------------------------------ */

export interface NeedCommandText {
  at: (step: string) => string
}

export const needCommandText: NeedCommandText = { at: (step) => `at ${step}` }

/** A permission's line: the command an agent asks to run, who asks, and at which step. */
export function NeedCommand({
  command,
  agent,
  step,
  text,
}: {
  command: string
  agent?: ModelInfo
  step?: string
  text?: Partial<NeedCommandText>
}) {
  const t = { ...needCommandText, ...text }
  return (
    <p className={s.line}>
      <Code className={s.command}>{command}</Code>
      {(agent || step) && (
        <span className={s.quiet}>
          {agent && <Model model={agent} short />}
          {step && t.at(step)}
        </span>
      )}
    </p>
  )
}

export interface NeedChangeText {
  number: (n: number) => string
  checks: (n: number) => string
  reviewedBy: string
}

export const needChangeText: NeedChangeText = {
  number: (n) => `#${n}`,
  checks: (n) => (n === 0 ? 'No checks ran' : n === 1 ? '1 check passed' : `${n} checks passed`),
  reviewedBy: 'reviewed by',
}

export interface NeedChangeProps {
  host: CodeHost
  /** The repository's name, without its owner. */
  repo: string
  number: number
  add: number
  del: number
  /** Checks that passed. */
  checks: number
  lead: ModelInfo
  reviewer?: ModelInfo
  text?: Partial<NeedChangeText>
}

/** A change ready to accept, in a line: its pull request, its size, its checks, and who led and reviewed it. */
export function NeedChange({ host, repo, number, add, del, checks, lead, reviewer, text }: NeedChangeProps) {
  const t = { ...needChangeText, ...text }
  return (
    <p className={s.line}>
      <span className={s.pr}>
        {host.brand && <BrandMark brand={host.brand} size={12} />}
        {repo}
        <span className={s.ref}>{t.number(number)}</span>
      </span>
      <Delta add={add} del={del} />
      <span className={s.sep} aria-hidden="true" />
      <span className={s.checks}>
        {checks > 0 && <Icon name="check" size={11} className={s.ok} />}
        {t.checks(checks)}
      </span>
      <span className={s.sep} aria-hidden="true" />
      <span className={s.quiet}>
        <Model model={lead} short />
        {reviewer && (
          <>
            {t.reviewedBy} <Model model={reviewer} short />
          </>
        )}
      </span>
    </p>
  )
}

export interface NeedOptionsText {
  /** The option's key: A, B. */
  key: (i: number) => string
}

export const needOptionsText: NeedOptionsText = { key: (i) => String.fromCharCode(65 + i) }

/** A decision's choices, side by side, as it will offer them. */
export function NeedOptions({ options, text }: { options: readonly { id: string; label: string }[]; text?: Partial<NeedOptionsText> }) {
  const t = { ...needOptionsText, ...text }
  return (
    <ol className={s.options}>
      {options.map((o, i) => (
        <li key={o.id} className={s.option}>
          <span className={s.key} aria-hidden="true">
            {t.key(i)}
          </span>
          {o.label}
        </li>
      ))}
    </ol>
  )
}
