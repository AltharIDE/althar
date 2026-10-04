import { cx } from '../../../lib/cx'
import s from '../Research.module.css'

export function Thesis() {
  return (
    <>
      <section className={s.s} id="s4">
        <p className={s.sN}>4 · The Althar thesis</p>
        <h2>Manage intent and evidence. Treat agent sessions as replaceable compute.</h2>
        <div className={s.prose}>
          <p>
            Althar is a control plane above coding agents. It owns the durable representation of the project and its tasks. Agents are
            workers, chosen for capability, availability, cost or trust.
          </p>
        </div>
        <div className={s.prims}>
          <div className={s.prim}>
            <p className={s.primK}>Project</p>
            <p>
              The durable memory: goals, architecture, vocabulary, policies, constraints and accepted knowledge, each with standing and
              provenance.
            </p>
          </div>
          <div className={s.prim}>
            <p className={s.primK}>Coordinator</p>
            <p>The active steward. It hardens scope, composes the graph, selects workers and changes the route as evidence arrives.</p>
          </div>
          <div className={s.prim}>
            <p className={s.primK}>Task</p>
            <p>
              The unit of continuity: objective, acceptance criteria, decisions, plan versions, runs, open questions and recovery state.
            </p>
          </div>
          <div className={s.prim}>
            <p className={s.primK}>Artifact</p>
            <p>The proof: diffs, logs, tests, reviews, screenshots and reports, attached to the specific run that produced them.</p>
          </div>
        </div>
        <figure className={s.ex}>
          <figcaption className={s.exH}>
            <b>Figure 3</b> Where Althar sits
          </figcaption>
          <div className={s.layers}>
            <div className={s.ly}>
              <p className={s.lyK}>
                Agents<small>Replaceable workers</small>
              </p>
              <p className={s.lyV}>
                Claude Code · Codex · Cursor · Gemini CLI · open-weight models on your own hardware · whatever ships next
              </p>
            </div>
            <div className={cx(s.ly, s.isUs)}>
              <p className={s.lyK}>
                Althar<small>Persists with the project</small>
              </p>
              <div className={s.lyCore}>
                <div>
                  <b>Project memory</b>
                  <span>Claims with standing, scope and provenance; decisions; contradictions</span>
                </div>
                <div>
                  <b>Coordinator</b>
                  <span>Composes and revises task graphs, routes work, enforces the attention boundary</span>
                </div>
                <div>
                  <b>Tasks and artifacts</b>
                  <span>Objectives, criteria, runs, and the evidence each run produced</span>
                </div>
              </div>
            </div>
            <div className={s.ly}>
              <p className={s.lyK}>
                Yours<small>Never moved without consent</small>
              </p>
              <p className={s.lyV}>Repositories · agent subscriptions and API keys · issue trackers and CI · your laptop or your servers</p>
            </div>
          </div>
          <p className={s.exCap}>
            Althar drives the official agent tools through their own interfaces, under their own terms, on the user’s own plans. It holds no
            model weights and resells no tokens. The only thing it owns is the project record, and that is stored in an open format the team
            can read without Althar.
          </p>
        </figure>
        <div className={s.prose}>
          <h3 className={s.h3s}>Completion is backed by evidence</h3>
          <p>
            Acceptance criteria are part of the task before execution begins, and evidence is attached as the work proceeds. A task is
            complete when its claims are supported: tests passed against a named revision, an independent review examined that revision,
            visual evidence matches the deployed output, and remaining risks are either cleared or explicitly accepted. “The agent said it
            was done” is not an acceptance state.
          </p>
        </div>
        <div className={s.callout}>
          <p className={s.calloutK}>The honest boundary of portability</p>
          <p>
            What moves between providers is project and task state: objective, criteria, worktree or diff, decisions, completed steps,
            tests, open questions, artifacts and provenance. What doesn’t move is the hidden state of each provider’s session: its tools,
            context window, approvals, memory behaviour and model behaviour.
          </p>
          <p>
            <b>We promise</b> that a task survives provider swaps, retries, machine loss and migration. <b>We don’t promise</b> identical
            sessions or identical outcomes across agents.
          </p>
        </div>
      </section>
    </>
  )
}
