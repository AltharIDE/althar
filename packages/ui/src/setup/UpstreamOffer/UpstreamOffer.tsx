import type { RootProps } from '../../lib/props'
import { AskCard, AskFoot } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { Problem } from '../../primitives/Problem/Problem'
import s from './UpstreamOffer.module.css'

/*
 * The one offer made to someone working from a fork, once its host says they
 * can push to the repository it forks: to send new tasks' branches there.
 * Nothing waits on it, so it is drawn quiet, and either answer is final: it
 * isn't made again, and the choice stays in the project's settings.
 */

export interface UpstreamOfferText {
  kicker: string
  what: (upstream: string) => string
  stays: string
  accept: string
  notNow: string
}

export const upstreamOfferText: UpstreamOfferText = {
  kicker: 'Push access',
  what: (upstream) => `You can push to ${upstream} now. Push new tasks’ branches there instead of your fork?`,
  stays: 'Pull requests already open stay on your fork.',
  accept: 'Push there',
  notNow: 'Not now',
}

export type UpstreamOfferProps = RootProps<
  'div',
  {
    /** The repository it forks, by its path on its host. */
    upstream: string
    onAccept: () => void
    onNotNow: () => void
    /** Why the last answer didn't go through. */
    error?: string
    text?: Partial<UpstreamOfferText>
  }
>

export function UpstreamOffer({ upstream, onAccept, onNotNow, error, text, ...rest }: UpstreamOfferProps) {
  const t = { ...upstreamOfferText, ...text }
  return (
    <AskCard icon="branch" kicker={t.kicker} what={t.what(upstream)} quiet {...rest}>
      <p className={s.stays}>{t.stays}</p>
      {error !== undefined && <Problem size="small">{error}</Problem>}
      <AskFoot>
        <Button size="small" variant="quiet" onClick={onNotNow}>
          {t.notNow}
        </Button>
        <Button size="small" onClick={onAccept}>
          {t.accept}
        </Button>
      </AskFoot>
    </AskCard>
  )
}
