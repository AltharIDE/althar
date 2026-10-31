import { type ReactNode, useId, useState } from 'react'

import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { Logo } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import { useRefocus } from '../../lib/refocus'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './CoAuthor.module.css'
import { identicon } from './identicon'

/*
 * Whether Althar signs the work it sends to the code host, shown on a commit
 * as the host shows one: the message with the co-author line at its end, and
 * under it the person's face with Althar's beside it. The person stays the
 * author; the agents' own credit lines are taken out either way. Turned off,
 * the line is struck through and Althar's face leaves the commit; and as it
 * is turned off, once, on a card of its own over the commit, why it would be
 * kept: Althar is free, and this line is how most developers hear of it.
 * Althar's mark comes up beside it, dot by dot, in a little light. The card
 * puts it back in one press, or is left off in another, which the person's
 * choice is; focus then lands on what goes out now. Opened again while off,
 * it shows only what goes out. The switch is the consumer's, in the head of
 * what holds this.
 */

export interface CoAuthorText {
  /** What it does, while it is on. */
  line: string
  /** The ask, set large, as it is turned off. */
  ask: string
  why: string
  again: string
  /** Leaves it off: the card goes, and what goes out stays. */
  leave: string
  /** The commit, for a screen reader. */
  commit: string
  /** Between the person's name and Althar's, under the commit. */
  and: string
  althar: string
  /** Under the commit: what a pull request ends with while it is on, and what goes out while it is off. */
  opened: string
  openedBy: string
  alone: string
}

export const coAuthorText: CoAuthorText = {
  line: 'On your commits and pull requests. You stay the author.',
  ask: 'Althar is free, and we have no marketing budget.',
  why: 'This line is how most developers hear about it. We’d be grateful if you left it on.',
  again: 'Put Althar back on your commits',
  leave: 'Leave it off',
  commit: 'A commit as GitHub shows it',
  and: 'and',
  althar: 'Althar',
  opened: 'Pull requests end with',
  openedBy: 'Opened by',
  alone: 'Only your name goes out.',
}

/** A commit to show it on, as the code host would. */
export interface CoAuthorCommit {
  subject: string
  /** Its message's body, a line or two. */
  body?: string
  /** Its short hash. */
  sha: string
  /** When, as the host says it: committed 12 minutes ago. */
  when: string
}

export interface CoAuthorProps {
  on: boolean
  onChange: (on: boolean) => void
  /** The trailer each commit gets: Co-authored-by: Althar <…@users.noreply.github.com>. */
  trailer: string
  /** The person, as the code host names them: dana-k. */
  author: string
  commit: CoAuthorCommit
  /** Althar's face as the code host shows it, the AltharAi account's picture. The mark on ink, without it. */
  picture?: ReactNode
  /** Whether it asks why it would stay. Without it, once it is turned off while it shows, until it is turned on again or left off. */
  asking?: boolean
  text?: Partial<CoAuthorText>
  className?: string
}

/** Althar as co-author, on a commit as the code host shows it; turned off, it asks once, on a card of its own, why it would stay. */
export function CoAuthor({ on, onChange, trailer, author, commit, picture, asking: driven, text, className }: CoAuthorProps) {
  const t = { ...coAuthorText, ...text }
  const askId = useId()
  // Turned off while this shows: the ask, until it is turned on again, left off, or opened afresh.
  const [turnedOff, setTurnedOff] = useState(false)
  const [was, setWas] = useState(on)
  if (on !== was) {
    setWas(on)
    setTurnedOff(!on)
  }
  const asking = !on && (driven ?? turnedOff)
  // Back from the ask, which went with the focus: it lands on the line that says what goes out now.
  const said = useRefocus<HTMLParagraphElement>(asking)
  return (
    <div className={cx(s.coAuthor, className)}>
      {on && (
        <p ref={said} tabIndex={-1} className={s.line}>
          {t.line}
        </p>
      )}
      {asking && (
        <section className={s.ask} aria-labelledby={askId}>
          <div className={s.askWords}>
            <p id={askId} className={s.big}>
              {t.ask}
            </p>
            <p className={s.why}>{t.why}</p>
            <div className={s.askActions}>
              <Button variant="ink" onClick={() => onChange(true)}>
                {t.again}
              </Button>
              {driven === undefined && <LinkButton onClick={() => setTurnedOff(false)}>{t.leave}</LinkButton>}
            </div>
          </div>
          <span className={s.askMark} aria-hidden="true">
            <HalftoneMark size={88} rise />
          </span>
        </section>
      )}
      <figure className={cx(s.commit, !on && s.off)} aria-label={t.commit}>
        <div className={s.message}>
          <span className={s.subject}>{commit.subject}</span>
          {commit.body !== undefined && <span className={s.body}>{commit.body}</span>}
          <code className={s.trailer}>{trailer}</code>
        </div>
        <figcaption className={s.foot}>
          <span className={s.faces} aria-hidden="true">
            <PersonFace name={author} />
            <CoAuthorFace picture={picture} ghost={!on} className={s.althar} />
          </span>
          <span className={s.who}>
            <b>{author}</b>
            {on && (
              <>
                {' '}
                {t.and} <b>{t.althar}</b>
              </>
            )}{' '}
            {commit.when}
          </span>
          <code className={s.sha}>{commit.sha}</code>
        </figcaption>
      </figure>
      <p {...(on ? {} : { ref: said, tabIndex: -1 })} className={s.after}>
        {on ? (
          <>
            {t.opened}{' '}
            <span className={s.sub}>
              {t.openedBy}{' '}
              <a href="https://github.com/AltharIDE/althar" target="_blank" rel="noreferrer">
                {t.althar}
              </a>
              .
            </span>
          </>
        ) : (
          t.alone
        )}
      </p>
    </div>
  )
}

export interface CoAuthorFaceProps {
  /** The AltharAi account's picture. The mark on ink, without it. */
  picture?: ReactNode
  /** How large, in px. */
  size?: number
  /** Not there: only its outline, dashed, where it would be. */
  ghost?: boolean
  className?: string
}

/** Althar's face as a code host shows it beside a commit: round. */
export function CoAuthorFace({ picture, size = 20, ghost = false, className }: CoAuthorFaceProps) {
  return (
    <span className={cx(s.face, ghost ? s.ghost : s.mark, className)} style={{ width: size, height: size }} aria-hidden="true">
      {!ghost && (picture ?? <Logo size={Math.round(size * 0.6)} />)}
    </span>
  )
}

/** The person's face, as the host draws one for an account with no picture of its own. */
function PersonFace({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg className={cx(s.face, s.person)} width={size} height={size} viewBox="0 0 6 6" aria-hidden="true">
      {identicon(name).flatMap((row, y) =>
        row.map((filled, x) => (filled ? <rect key={`${x}-${y}`} x={0.5 + x} y={0.5 + y} width="1" height="1" /> : null)),
      )}
    </svg>
  )
}
