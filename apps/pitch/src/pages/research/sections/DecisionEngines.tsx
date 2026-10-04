import { cx } from '../../../lib/cx'
import s from '../Research.module.css'

export function DecisionEngines() {
  return (
    <>
      <section className={s.s} id="s7">
        <p className={s.sN}>7 · Decision engine hypothesis</p>
        <h2>Continuous supervision may need small decisions, not another general-purpose agent.</h2>
        <div className={s.prose}>
          <p>
            Many graph transitions aren’t writing tasks. They’re bounded judgments: does this result need repair, which specialist should
            review it, is the evidence sufficient, does this uncertainty warrant a person? TypeSafe’s September 2026 release of Jev
            introduces a model designed to return typed choices, scores and probabilities rather than text. Its interface is unusually
            relevant here.
          </p>
          <p>
            The hypothesis is not that Jev should become Althar’s coordinator. It’s that a fast, probabilistic decision model could become a
            supervision primitive used throughout the product, while the coordinator’s rules, state and history remain open and inspectable.
          </p>
        </div>
        <figure className={s.ex}>
          <figcaption className={s.exH}>
            <b>Figure 8</b> A four-part control loop
          </figcaption>
          <div className={s.ctl4}>
            <div className={s.c4}>
              <p className={s.c4K}>Deterministic policy</p>
              <p>
                Code defines permitted transitions, hard safety rules, budgets, required evidence, and actions that always need approval.
              </p>
            </div>
            <div className={s.c4}>
              <p className={s.c4K}>Typed judgment</p>
              <p>
                A decision model scores narrow choices (continue, review, repair, investigate, escalate) with a probability distribution.
              </p>
            </div>
            <div className={s.c4}>
              <p className={s.c4K}>Generative workers</p>
              <p>Frontier coding agents plan, implement, review and diagnose where open-ended reasoning and tool use are needed.</p>
            </div>
            <div className={cx(s.c4, s.isYou)}>
              <p className={s.c4K}>Human judgment</p>
              <p>People receive the low-confidence, high-impact, irreversible or genuinely ambiguous decisions, and nothing routine.</p>
            </div>
          </div>
          <p className={s.exCap}>
            The model never invents an arbitrary graph. The coordinator offers only the transitions project policy allows. Above a
            calibrated threshold, it takes low-risk transitions automatically. In the middle, it asks for a stronger model or more evidence.
            Below, it escalates. Every decision stores its inputs, choices, full distribution, threshold, model version and the graph change
            it caused.
          </p>
        </figure>
        <h3 className={s.h3s}>Where typed judgments could apply</h3>
        <div className={s.areas}>
          <div>
            <b>Graph</b>
            <p>Choose among permitted transitions. Deterministic conditions, such as failed tests or protected files, remain code.</p>
          </div>
          <div>
            <b>Selection</b>
            <p>Choose among permitted workers, model tiers and verification strategies by task shape, risk, cost and past performance.</p>
          </div>
          <div>
            <b>Evidence</b>
            <p>Estimate whether tests, reviews and visual artifacts support the acceptance claims, and what is still missing.</p>
          </div>
          <div>
            <b>Memory</b>
            <p>Classify candidate knowledge by standing, flag conflicts and staleness, and score relevance for the next worker.</p>
          </div>
          <div>
            <b>Runtime</b>
            <p>Classify agent traces as progressing, looping, blocked, drifting from scope, unexpectedly risky or ready for review.</p>
          </div>
          <div>
            <b>Attention</b>
            <p>Route only what needs a person, and decide whether the interruption is immediate or can be batched.</p>
          </div>
        </div>
        <div className={s.prose}>
          <p>
            <strong>The boundary.</strong> A decision engine can’t turn a vague feature request into a useful graph, plan an implementation,
            write or deeply review code, diagnose a novel failure or resolve an architectural trade-off. Those remain jobs for generative
            agents and people. It is most valuable where the candidate answers can be defined in advance and the same narrow question is
            asked thousands of times.
          </p>
          <p>
            <strong>Open interface, closed model.</strong> Jev is not open source; access is through TypeSafe’s hosted API, while its SDKs
            and a compatibility adapter built on ordinary LLM APIs are MIT-licensed. So the abstraction boundary matters. Althar should own
            an open decision-engine contract and treat Jev as one optional provider, alongside constrained frontier models, smaller
            open-weight models and deterministic implementations. Project policy must never depend on an uncalibrated, provider-specific
            confidence scale.
          </p>
          <p>
            <strong>An evaluation target, not a dependency.</strong> TypeSafe reports latency of roughly 70–500 ms, typed outputs,
            calibrated confidence and large cost advantages. Its published evaluations are company-run and use frontier-model consensus as
            the reference. A first benchmark should replay labelled events from real review, test and repair loops, and measure routing
            precision and recall (especially false acceptance and missed escalation), calibration, workflow outcomes, latency and cost at
            scale, robustness to contradictory or adversarial state, and portability across providers.
          </p>
        </div>
        <div className={s.gostop}>
          <div>
            <p className={s.gsK}>Go if</p>
            <p>
              a typed decision engine materially cuts latency, cost or unnecessary interruptions while matching a strong general model on
              safety-relevant judgments.
            </p>
          </div>
          <div>
            <p className={s.gsK}>Stop if</p>
            <p>
              confidence is poorly calibrated, false acceptance is hard to bound, or the integration makes project policy depend on one
              closed model.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
