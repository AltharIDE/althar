import { type ReactNode, useId, useState } from 'react'

import { Logo } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Switch } from '../../primitives/Switch/Switch'
import s from './CoAuthor.module.css'

/*
 * Whether Althar signs the work it sends to the code host: a co-author line
 * on each commit, under the person's own name as author, and its line at the
 * foot of a pull request. The agents' own credit lines are taken out either
 * way; this is only about Althar's. On by default. While it is off, a line
 * under it says, quietly, why it would be kept: Althar is free and this is
 * how people find it. The line it adds can be seen, for anyone who wants to
 * know exactly.
 */

export interface CoAuthorText {
  title: string
  line: string
  /** Under it while it is off. */
  ask: string
  again: string
  show: string
  hide: string
}

export const coAuthorText: CoAuthorText = {
  title: 'Althar as co-author',
  line: 'On your commits and pull requests, in place of the agents’ own. You stay the author.',
  ask: 'Althar is free, and we have no marketing budget. This line on your commits is how most developers hear about it, so if you can, we’d be grateful if you left it on.',
  again: 'Turn it back on',
  show: 'See the line',
  hide: 'Hide the line',
}

export interface CoAuthorProps {
  on: boolean
  onChange: (on: boolean) => void
  /** The trailer each commit gets: Co-authored-by: Althar <…@users.noreply.github.com>. */
  trailer: string
  /** The co-author's picture as the code host shows it. Althar's mark on ink, without it. */
  picture?: ReactNode
  text?: Partial<CoAuthorText>
  className?: string
}

export function CoAuthor({ on, onChange, trailer, picture, text, className }: CoAuthorProps) {
  const t = { ...coAuthorText, ...text }
  const id = useId()
  const [seeing, setSeeing] = useState(false)
  return (
    <div className={cx(s.coAuthor, className)}>
      <span className={s.picture} aria-hidden="true">
        {picture ?? <Logo size={15} />}
      </span>
      <span className={s.words}>
        <span id={`${id}-t`} className={s.title}>
          {t.title}
        </span>
        <span id={`${id}-l`} className={s.line}>
          {t.line}{' '}
          <LinkButton aria-expanded={seeing} aria-controls={`${id}-x`} onClick={() => setSeeing((x) => !x)}>
            {seeing ? t.hide : t.show}
          </LinkButton>
        </span>
      </span>
      <Switch checked={on} onChange={onChange} labelledBy={`${id}-t`} describedBy={`${id}-l`} className={s.switch} />
      {seeing && (
        <code id={`${id}-x`} className={cx(s.trailer, !on && s.trailerOff)}>
          {trailer}
        </code>
      )}
      {!on && (
        <p className={s.ask}>
          {t.ask}{' '}
          <LinkButton className={s.again} onClick={() => onChange(true)}>
            {t.again}
          </LinkButton>
        </p>
      )}
    </div>
  )
}
