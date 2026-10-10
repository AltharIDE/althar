import { useId } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { Logo } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { Runtimes, type RuntimesProps } from '../../setup/Runtimes/Runtimes'
import s from './Start.module.css'

/* First-run setup has two steps: connect an agent once, then open a project.
 * The host keeps the completed step; this screen only presents it.
 */

export interface StartText {
  title: string
  agents: string
  agentsNote: string
  noneReady: string
  continue: string
  skip: string
  checking: string
  back: string
  begin: string
  project: string
  create: { title: string; note: string; kbd: string }
  drop: string
}

export const startText: StartText = {
  title: 'Althar',
  agents: 'Connect an agent',
  agentsNote: 'Use an existing sign-in, or sign in to one agent to get started. It will be available across your projects.',
  noneReady: 'Sign in to one agent, or set this up later in Settings.',
  continue: 'Continue',
  skip: 'Set up later',
  checking: 'Checking your agents…',
  back: 'Back to agents',
  begin: 'Open your project',
  project: 'Open a repository, or a folder containing several repositories.',
  create: { title: 'Open a folder', note: 'Choose a local Git repository', kbd: '⌘N' },
  drop: 'Or drop a repository folder anywhere on this window.',
}

export interface StartProps extends Omit<RuntimesProps, 'label' | 'className' | 'text'> {
  /** Opens the folder picker, then the new project with what was chosen. */
  onCreate: () => void
  step: 'agents' | 'project'
  onContinue: () => void
  onSkip: () => void
  onBack: () => void
  canContinue: boolean
  checking?: boolean
  opening?: boolean
  className?: string
  text?: Partial<StartText>
}

/** One decision at a time, before the first project. */
export function Start({
  onCreate,
  step,
  onContinue,
  onSkip,
  onBack,
  canContinue,
  checking,
  opening,
  className,
  text,
  ...runtimes
}: StartProps) {
  const t = { ...startText, ...text }
  const agentsId = useId()
  const beginId = useId()
  return (
    <div className={cx(s.start, className)}>
      {/* Each part arrives on its own as the window opens (screens/Launch). */}
      <h1 className={s.title} data-arrive>
        <Logo size={22} />
        {t.title}
      </h1>

      {step === 'agents' ? (
        <section aria-labelledby={agentsId} className={s.section} data-arrive>
          <h2 id={agentsId} className={s.label}>
            {t.agents}
          </h2>
          <p className={s.note}>{t.agentsNote}</p>
          {checking ? <output className={s.note}>{t.checking}</output> : <Runtimes label={t.agents} {...runtimes} />}
          {!checking && !canContinue && <p className={s.none}>{t.noneReady}</p>}
          <div className={s.actions}>
            <Button variant="signal" disabled={checking || !canContinue} onClick={onContinue}>
              {t.continue}
            </Button>
            {!checking && !canContinue && (
              <Button variant="quiet" onClick={onSkip}>
                {t.skip}
              </Button>
            )}
          </div>
        </section>
      ) : (
        <section aria-labelledby={beginId} className={s.section} data-arrive>
          <h2 id={beginId} className={s.label}>
            {t.begin}
          </h2>
          <p className={s.note}>{t.project}</p>
          <Way icon="plus" {...t.create} disabled={opening} onClick={onCreate} />
          <p className={s.drop}>{t.drop}</p>
          <div className={s.actions}>
            <Button variant="quiet" onClick={onBack}>
              {t.back}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function Way({
  icon,
  title,
  note,
  kbd,
  disabled,
  onClick,
}: {
  icon: IconName
  title: string
  note: string
  kbd: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={s.way} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={15} className={s.wayIcon} />
      <span className={s.wayTitle}>{title}</span>
      <span className={s.wayNote}>{note}</span>
      <Kbd className={s.wayKbd}>{kbd}</Kbd>
    </button>
  )
}
