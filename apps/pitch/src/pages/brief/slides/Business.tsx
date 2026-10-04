import { cx } from '../../../lib/cx'
import { Slide } from '../Slide'
import ui from '../ui.module.css'
import s from './Business.module.css'

/** How a customer moves through Althar: one developer, then their team, then their organisation. */
const TIERS = [
  {
    k: 'Open source',
    price: 'Free',
    per: 'forever',
    who: 'One developer, on their own machine',
    has: ['The full memory and coordinator', 'Any agent, any model', 'Local-first, open format'],
    next: 'Moves up when a second person joins the project',
  },
  {
    k: 'Althar Cloud',
    price: 'Per seat',
    per: 'monthly',
    who: 'Teams, small and large, on one project record',
    has: ['Shared memory across people and machines', 'Decisions with authors and history', 'Hosted runs, approvals from your phone'],
    next: 'Moves up when policy, audit or residency apply',
  },
  {
    k: 'Enterprise',
    price: 'Licence',
    per: 'annual',
    who: 'Organisations, on their own infrastructure',
    has: ['SSO, audit and retention', 'Knowledge shared across projects', 'Support and security review'],
    next: 'Expands with every project that adopts it',
  },
] as const

export function Business() {
  return (
    <Slide id="business" tone="dark" name="The business" className={s.biz}>
      <div className={ui.wrap}>
        <p className={cx(ui.kicker, s.kicker)}>The business</p>
        <h2>Charge for coordination, never for compute.</h2>
        <div className={s.bills}>
          <p>
            <span>Compute</span>
            <b>Paid to the labs</b> through the subscriptions and keys your team already has. We add nothing to it.
          </p>
          <p className={s.ours}>
            <span>Coordination</span>
            <b>Paid to Althar</b> for what no single agent gives you: one project record, sync, governance and support.
          </p>
        </div>
        <ol className={s.tiers}>
          {TIERS.map((t) => (
            <li key={t.k} className={s.tier}>
              <p className={s.tK}>{t.k}</p>
              <p className={s.price}>
                <b>{t.price}</b> {t.per}
              </p>
              <p className={s.tWho}>{t.who}</p>
              <ul>
                {t.has.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <p className={s.tNext}>{t.next}</p>
            </li>
          ))}
        </ol>
        <p className={s.cap}>
          Adds to an AI budget instead of competing for it, and stays out of a price war with the labs. The model behind GitLab, Sentry,
          PostHog and Tailscale: free and complete for the individual, paid where a team needs sync, control and someone to call.
        </p>
      </div>
    </Slide>
  )
}
