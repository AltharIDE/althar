/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role -- The labelled overflow region must be keyboard-scrollable on narrow screens. */
import s from '../Research.module.css'

export function Market() {
  return (
    <>
      <section className={s.s} id="s9">
        <p className={s.sN}>9 · Market structure</p>
        <h2>Everyone is building the project layer. Each vendor builds it vertically.</h2>
        <div className={s.prose}>
          <p>
            Over the past year, the major AI coding companies have all moved from the agent towards the project around it: persistent
            knowledge, cloud tasks, review flows, multi-agent coordination. That validates the category. It also shows its incentive
            structure. Each vendor ties the project layer to what it sells.
          </p>
        </div>
        <figure className={s.ex}>
          <div className={s.tblWrap} tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens">
            <table className={s.tbl}>
              <thead>
                <tr>
                  <th scope="col" style={{ width: '22%' }}>
                    Product
                  </th>
                  <th>Which agent</th>
                  <th>Which models</th>
                  <th>What you pay for</th>
                  <th style={{ width: '25%' }}>Where project memory lives</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Devin</td>
                  <td className={s.lock}>Devin</td>
                  <td className={s.lock}>Cognition’s choice</td>
                  <td className={s.lock}>Their compute</td>
                  <td className={s.lock}>Inside Devin</td>
                </tr>
                <tr>
                  <td>GitHub Copilot</td>
                  <td className={s.lock}>Copilot</td>
                  <td className={s.lock}>GitHub’s catalogue</td>
                  <td className={s.lock}>Seats and requests</td>
                  <td className={s.lock}>Inside GitHub</td>
                </tr>
                <tr>
                  <td>Cursor</td>
                  <td className={s.lock}>Cursor’s agents</td>
                  <td className={s.lock}>Cursor’s catalogue</td>
                  <td className={s.lock}>Seats and usage</td>
                  <td className={s.lock}>Inside Cursor</td>
                </tr>
                <tr>
                  <td>Claude Code, Codex</td>
                  <td className={s.lock}>The lab’s own</td>
                  <td className={s.lock}>The lab’s own</td>
                  <td className={s.free}>Your subscription</td>
                  <td className={s.lock}>Files in each lab’s own format</td>
                </tr>
                <tr className={s.isUs}>
                  <td>Althar</td>
                  <td className={s.free}>Any</td>
                  <td className={s.free}>Any, including self-hosted</td>
                  <td className={s.free}>Your subscriptions</td>
                  <td className={s.free}>With the project, in an open format</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={s.exCap}>
            <span className={s.keyLock}></span>Decided by the vendor <span className={s.keyFree}></span>Decided by you. Simplified, as of
            September 2026.
          </p>
        </figure>
        <div className={s.prose}>
          <p>
            <strong>Vertical integration is rational for each vendor and costly for each customer.</strong> A memory that moves cleanly to a
            competitor stops keeping customers, so no vendor has a reason to make its memory portable, or to route work to a rival’s model
            when that model is better this month.
          </p>
          <p>
            <strong>The tools churn faster than projects do.</strong> The strongest coding model has changed hands repeatedly over the past
            eighteen months, and relative prices swing just as often. Open-weight models keep closing the gap, and new labs keep arriving. A
            team could spend weeks evaluating models and still not have an answer that holds for a quarter. Tying project context to one
            tool means paying for it at every switch.
          </p>
          <p>
            <strong>Subscription economics favour an orchestrator of official tools.</strong> Frontier models are far cheaper through the
            subscription plans developers already hold than through metered API pricing. A layer that coordinates the official agent tools
            under their own terms passes that saving on. A layer that resells tokens can’t.
          </p>
          <p>
            <strong>Independence is a quality feature.</strong> Review by a model from a different lab than the author catches failures the
            author’s model family shares. No lab can sell an independent reviewer of its own model.
          </p>
        </div>
      </section>
    </>
  )
}
