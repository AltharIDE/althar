/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role -- The labelled overflow region must be keyboard-scrollable on narrow screens. */
import { cx } from '../../../lib/cx'
import s from '../Research.module.css'

export function NoMemory() {
  return (
    <>
      <section className={s.s} id="s2">
        <p className={s.sN}>2 · Memory</p>
        <h2>The project has no independent memory.</h2>
        <div className={s.prose}>
          <p>
            Changing a mature system takes more than the repository. It takes the current goal, architectural intent, business constraints,
            approaches that already failed, temporary exceptions, local conventions, deployment risk, acceptance criteria, and the reasons
            one trade-off beat another.
          </p>
          <p>
            Today that knowledge is spread across instruction files (READMEs, <code>AGENTS.md</code>, provider-specific rules), issues and
            pull requests, individual agent conversations and their compacted summaries, and the heads of developers who know which written
            rules are still current. The evidence, meaning diffs, test runs, logs and incidents, is rarely connected to the decisions it
            supports.
          </p>
          <p>
            Documentation helps, but it flattens different kinds of knowledge. A Markdown file can hold text. It usually can’t say whether a
            statement is a settled policy, a hypothesis, a decision that applies to one service, an observation from a failed run, or a
            convention that went stale in February. Current practice puts all five into similar files and asks the next agent to guess their
            authority.
          </p>
        </div>
        <figure className={s.ex}>
          <figcaption className={s.exH}>
            <b>Figure 1</b> Standing: how much the project believes a claim
          </figcaption>
          <div className={s.stand}>
            <div className={s.sd}>
              <span className={cx(s.st, s.stEpi)}></span>
              <b>Observed</b>
              <p>Seen once, on one task. True of that moment. Stays attached to the task as provenance.</p>
            </div>
            <span className={s.sdArr} aria-hidden="true">
              →
            </span>
            <div className={s.sd}>
              <span className={cx(s.st, s.stProp)}></span>
              <b>Proposed</b>
              <p>A task wants it to bind future work. Nobody has agreed yet.</p>
            </div>
            <span className={s.sdArr} aria-hidden="true">
              →
            </span>
            <div className={cx(s.sd, s.isStrong)}>
              <span className={cx(s.st, s.stCanon)}></span>
              <b>Canonical</b>
              <p>The project asserts it. Every task in its scope is told.</p>
            </div>
            <span className={s.sdArr} aria-hidden="true">
              →
            </span>
            <div className={s.sd}>
              <span className={cx(s.st, s.stRet)}></span>
              <b>Retired</b>
              <p>No longer true, but kept, because earlier work was reasoned from it.</p>
            </div>
          </div>
          <p className={s.exCap}>
            Promotion is a decision, with an author and a date. Most observations should never be promoted. When two claims disagree,
            neither is quietly merged; both stay visible, marked as contested, until someone settles it.
          </p>
        </figure>
        <div className={s.prose}>
          <h3 className={s.h3s}>Standing is not activation</h3>
          <p>
            Agent products increasingly organise memory by <em>when text enters the model’s context</em>: always-on rules, instructions
            scoped to certain files, and skills loaded on demand when their description seems relevant. It’s a sound engineering answer to a
            real constraint, because context windows are finite and long instructions dilute attention. In 2026 some products went further
            and merged their separate knowledge stores into on-demand skills, because the two already loaded the same way.
          </p>
          <p>
            But that merges two separate questions. <strong>Is this claim true?</strong> is a question about the project.{' '}
            <strong>When should an agent see it?</strong> is a question about delivery. A procedure for running a migration and the fact
            that a payment provider’s webhooks arrive out of order both load on demand, but only one of them can go stale, be contradicted
            or be superseded. Althar keeps the two axes separate.
          </p>
        </div>
        <figure className={s.ex}>
          <figcaption className={s.exH}>
            <b>Figure 2</b> Two independent questions about every piece of project knowledge
          </figcaption>
          <div className={s.tblWrap} tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens">
            <table className={cx(s.tbl, s.axes)}>
              <thead>
                <tr>
                  <th style={{ width: '14%' }}>Standing</th>
                  <th>Seen by every task in scope</th>
                  <th>Seen when relevant</th>
                  <th>Seen on request</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Canonical</td>
                  <td>All money values are integer minor units</td>
                  <td>Webhook deliveries must remain idempotent</td>
                  <td>The full incident history of the refund queue</td>
                </tr>
                <tr>
                  <td>Proposed</td>
                  <td className={s.dim}>Not supplied until accepted</td>
                  <td className={s.dim}>Not supplied until accepted</td>
                  <td>Write paths fail fast; deliveries retry</td>
                </tr>
                <tr>
                  <td>Observed</td>
                  <td className={s.dim}>Never</td>
                  <td>Checkout timeouts follow cold starts</td>
                  <td>The worker pool saturates above 60 captures</td>
                </tr>
                <tr>
                  <td>Retired</td>
                  <td className={s.dim}>Never</td>
                  <td className={s.dim}>Never</td>
                  <td>Refunds were once processed synchronously</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={s.exCap}>
            Delivery can be tuned per agent and per context budget. Standing belongs to the project and changes only by decision.
          </p>
        </figure>
        <div className={s.prose}>
          <h3 className={s.h3s}>The context problem is being solved, mostly inside products</h3>
          <p>
            Cursor, GitHub, Devin and the labs’ own agents all now offer coherent project surfaces, cloud agents, repository-aware work and
            durable artifacts. That’s strong evidence the need is real. It also creates a structural risk: if a project’s memory, task
            history and coordination rules live inside one commercial environment, the team’s accumulated operating knowledge becomes part
            of that vendor’s moat. Changing the model is easy. Changing the system that remembers how the team builds is not. Althar
            therefore treats provider independence as an architectural requirement, not a model picker.
          </p>
        </div>
      </section>
    </>
  )
}
