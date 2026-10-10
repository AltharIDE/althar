import { createContext, type ReactNode, useContext, useId } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Code } from '../../primitives/Code/Code'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type ProjectRef, ProjectWord } from '../ProjectWord/ProjectWord'
import s from './NeedLine.module.css'

/*
 * Something that waits on you, as one line of the home's list: what kind
 * of call it is, in violet; its title, which opens its task; under it the
 * one thing to know to answer (the command asked for, the change and its
 * checks, the choices, why it stalled); whose it is; and its answers, so
 * the quick ones are given where they are. Nothing else: when and by whom
 * is in the task. Lines stack in a NeedList, which rules them apart; one
 * gathered under its project's name needn't say whose again. Narrow, whose
 * it is goes under the title; as narrow as the edge's sheet, beside what
 * kind, with the title the whole width.
 */

export interface NeedLineText {
  /** Read before the task's number. */
  task: string
}

export const needLineText: NeedLineText = { task: 'Task' }

export type NeedLineProps = RootProps<
  'article',
  {
    /** What kind of call, in a word or two: Permission, Ready to accept, Decision, Stuck. */
    kind: string
    project: ProjectRef
    /** The task it comes from, by number, read out. */
    task?: string
    title: string
    /** The command an agent asks to run, drawn as code. */
    command?: string
    /** Otherwise, a few words to answer by: the change and its checks, the choices, why it stalled. */
    brief?: ReactNode
    /** Its answers: Buttons, the one that matters most in violet. */
    actions?: ReactNode
    /** Open its task. Without it, the title is words. */
    onOpen?: () => void
    /** The title's rank in the page's outline; by default, its NeedList's. */
    headingLevel?: HeadingLevel
    text?: Partial<NeedLineText>
  }
>

/** What a NeedList tells its lines: whether to say whose they are, and their titles' rank. */
const Lines = createContext<{ whose: boolean; headingLevel: HeadingLevel }>({ whose: true, headingLevel: 3 })

export function NeedLine({
  kind,
  project,
  task,
  title,
  command,
  brief,
  actions,
  onOpen,
  headingLevel,
  className,
  text,
  ...rest
}: NeedLineProps) {
  const t = { ...needLineText, ...text }
  const titleId = useId()
  const lines = useContext(Lines)
  return (
    <article aria-labelledby={titleId} className={cx(s.line, className)} {...rest}>
      <span className={s.kind}>{kind}</span>
      <div className={s.main}>
        <Heading level={headingLevel ?? lines.headingLevel} className={s.title} id={titleId} title={title}>
          {onOpen ? (
            <button type="button" className={s.open} onClick={onOpen}>
              {title}
            </button>
          ) : (
            title
          )}
        </Heading>
        {(command !== undefined || brief !== undefined) && (
          <p className={s.brief}>{command !== undefined ? <Code className={s.command}>{command}</Code> : brief}</p>
        )}
      </div>
      <span className={s.whose}>
        {lines.whose && <ProjectWord project={project} />}
        {task && (
          <VisuallyHidden>
            , {t.task} {task}
          </VisuallyHidden>
        )}
      </span>
      {actions && <div className={s.actions}>{actions}</div>}
    </article>
  )
}

export type NeedListProps = RootProps<
  'div',
  {
    /** On a sheet of its own, such as the edge's: only the rules. */
    bare?: boolean
    /** Whether its lines say whose they are; not when they are gathered under their project's name. */
    whose?: boolean
    /** Its lines' titles' rank in the page's outline. */
    headingLevel?: HeadingLevel
    children: ReactNode
  }
>

/** The lines on one sheet, ruled apart; an answered one folds to its AskAnswered in place. */
export function NeedList({ bare = false, whose = true, headingLevel = 3, children, className, ...rest }: NeedListProps) {
  return (
    <Lines.Provider value={{ whose, headingLevel }}>
      <div className={cx(s.list, bare && s.bare, className)} {...rest}>
        {children}
      </div>
    </Lines.Provider>
  )
}
