import { useId } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { Logo } from '../../foundations/Logo/Logo'
import { RuntimeState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { Runtimes, type RuntimesProps } from '../../setup/Runtimes/Runtimes'
import s from './Start.module.css'

/*
 * The first thing Charrette shows, before there is a project: which agents
 * it found on this machine and how each is signed in, then the way in: a
 * project. Nothing here is a step to finish. A project can be made with no
 * agent ready; its tasks start once one is.
 */

export interface StartText {
  title: string
  agents: string
  agentsNote: string
  noneReady: string
  begin: string
  project: string
  create: { title: string; note: string; kbd: string }
  drop: string
}

export const startText: StartText = {
  title: 'Charrette',
  agents: 'Agents on this Mac',
  agentsNote: 'Each keeps its own sign-in. Charrette asks it who you are, and never sees a password or a key.',
  noneReady: 'No agent is ready yet. You can still make a project; its tasks start once one is.',
  begin: 'Your first project',
  project:
    'A project holds a body of work: the repositories its tasks may change, what those tasks learn, and how often agents ask you. Most people start with one project per product.',
  create: { title: 'New project', note: 'Choose the repositories it works in, or start with none', kbd: '⌘N' },
  drop: 'Or drop repository folders anywhere on this window.',
}

export interface StartProps extends Omit<RuntimesProps, 'label' | 'className' | 'text'> {
  /** Opens the folder picker, then the new project with what was chosen. */
  onCreate: () => void
  className?: string
  text?: Partial<StartText>
}

/** Before any project: the agents found on this machine, and making the first project. */
export function Start({ onCreate, className, text, ...runtimes }: StartProps) {
  const t = { ...startText, ...text }
  const agentsId = useId()
  const beginId = useId()
  const ready = runtimes.runtimes.some((r) => r.state === RuntimeState.Ready)
  return (
    <div className={cx(s.start, className)}>
      <h1 className={s.title}>
        <Logo size={22} />
        {t.title}
      </h1>

      <section aria-labelledby={agentsId} className={s.section}>
        <h2 id={agentsId} className={s.label}>
          {t.agents}
        </h2>
        <p className={s.note}>{t.agentsNote}</p>
        <Runtimes label={t.agents} {...runtimes} />
        {!ready && <p className={s.none}>{t.noneReady}</p>}
      </section>

      <section aria-labelledby={beginId} className={s.section}>
        <h2 id={beginId} className={s.label}>
          {t.begin}
        </h2>
        <p className={s.note}>{t.project}</p>
        <Way icon="plus" {...t.create} onClick={onCreate} />
        <p className={s.drop}>{t.drop}</p>
      </section>
    </div>
  )
}

function Way({ icon, title, note, kbd, onClick }: { icon: IconName; title: string; note: string; kbd: string; onClick: () => void }) {
  return (
    <button type="button" className={s.way} onClick={onClick}>
      <Icon name={icon} size={15} className={s.wayIcon} />
      <span className={s.wayTitle}>{title}</span>
      <span className={s.wayNote}>{note}</span>
      <Kbd className={s.wayKbd}>{kbd}</Kbd>
    </button>
  )
}
