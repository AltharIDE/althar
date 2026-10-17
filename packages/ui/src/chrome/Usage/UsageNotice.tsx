import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './UsageNotice.module.css'
import { usageTone } from './tone'

/*
 * A plan window ran down to a threshold: a notice Althar posts itself in the
 * Talk room, not something the coordinator said and not a turn. It tells
 * whose account, how much of which window is left and until when, and has
 * two ways on: Seen, which takes it away for good, and Open usage. Its tone
 * follows what is left (warm at half and a quarter, red at a tenth and a
 * twentieth), and the words always say the share. It does not wait on an
 * answer, so it is not violet like an ask.
 */

export interface UsageNoticeText {
  /** The notice's name, for screen readers. */
  kicker: string
  /** 'Codex · work: 25% of the 5-hour window is left, until 17:00.' */
  what: (account: string, left: number, which: string, until: string | null) => string
  seen: string
  open: string
}

export const usageNoticeText: UsageNoticeText = {
  kicker: 'Plan usage',
  what: (account, left, which, until) =>
    until === null ? `${account}: ${left}% of the ${which} is left.` : `${account}: ${left}% of the ${which} is left, until ${until}.`,
  seen: 'Seen',
  open: 'Open usage',
}

export type UsageNoticeProps = RootProps<
  'section',
  {
    /** Whose: the agent, with the account: Codex · work. */
    account: string
    /** Which window, as words follow "the": 5-hour window, weekly window. */
    which: string
    /** The share of the window left when the threshold was crossed: 50, 25, 10 or 5. */
    left: number
    /** When the window resets, written for the person; null where it was not given. */
    until: string | null
    /** The person has seen it: it goes, here and everywhere. */
    onSeen: () => void
    /** Open the usage view. */
    onOpen: () => void
    text?: Partial<UsageNoticeText>
  }
>

export function UsageNotice({ account, which, left, until, onSeen, onOpen, text, className, ...rest }: UsageNoticeProps) {
  const t = { ...usageNoticeText, ...text }
  return (
    <section className={cx(s.notice, className)} data-tone={usageTone(left)} aria-label={t.kicker} {...rest}>
      <Icon name="bell" size={13} />
      <output className={s.what}>{t.what(account, left, which, until)}</output>
      <span className={s.actions}>
        <LinkButton onClick={onOpen}>{t.open}</LinkButton>
        <Button size="small" onClick={onSeen}>
          {t.seen}
        </Button>
      </span>
    </section>
  )
}
