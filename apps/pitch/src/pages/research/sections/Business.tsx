import { cx } from '../../../lib/cx'
import s from '../Research.module.css'

export function Business() {
  return (
    <>
      <section className={s.s} id="s10">
        <p className={s.sN}>10 · Why open source</p>
        <h2>The workflow outlasts any model vendor.</h2>
        <div className={s.prose}>
          <p>
            Provider independence is often described as picking a model from a dropdown. That’s too shallow. If the project’s memory,
            orchestration policy, run history, acceptance logic and team conventions stay proprietary, the model is replaceable but the
            operating system is not. Althar should be open because it sits in a privileged, durable position:
          </p>
        </div>
        <ul className={cx(s.ticksList, s.proseList)}>
          <li>It reads repositories, issue trackers, test output and internal documentation.</li>
          <li>It encodes how a team scopes, delegates, reviews and accepts work.</li>
          <li>It accumulates knowledge that becomes more valuable, and harder to migrate, over time.</li>
          <li>Its adapters and security boundaries should be inspectable.</li>
          <li>Teams should be able to self-host, fork or replace it.</li>
          <li>Having nothing to train means no incentive to harvest a customer’s project knowledge.</li>
        </ul>
        <div className={s.prose}>
          <h3 className={s.h3s}>The business model</h3>
          <p>
            Charge for coordination and governance, never for compute. The open-source product is complete for an individual developer and
            serves as the adoption engine. Revenue comes from what teams need and self-hosting makes painful:
          </p>
        </div>
        <div className={s.biz}>
          <div>
            <p className={s.gsK}>Cloud, for teams</p>
            <p>
              Shared project memory across people and machines, decision history, hosted long-running execution, mobile approvals. Priced
              per seat or per active project.
            </p>
          </div>
          <div>
            <p className={s.gsK}>Enterprise, self-hosted</p>
            <p>
              SSO, audit, retention, deployment on customer infrastructure, knowledge across many projects, support and security review.
              Annual licence.
            </p>
          </div>
        </div>
        <div className={s.prose}>
          <p>
            Because Althar doesn’t resell model access, it adds to an existing AI budget rather than competing with it, and stays out of a
            price war with the labs. GitLab, Sentry, PostHog and Tailscale have followed versions of this model.
          </p>
        </div>
      </section>
    </>
  )
}
