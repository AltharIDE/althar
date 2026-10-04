/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role -- Keyboard-scrollable overflow regions and labelled inline SVGs are intentional. */
import { cx } from '../../../lib/cx'
import s from '../Research.module.css'

export function Orchestration() {
  return (
    <>
      <section className={s.s} id="s5">
        <p className={s.sN}>5 · Orchestration, precisely</p>
        <h2>Launching a sub-agent is delegation, not orchestration.</h2>
        <div className={s.prose}>
          <p>
            “Agent orchestration” now describes almost any product with more than one agent in it. It helps to be precise, because the rungs
            below differ in kind, not just in degree.
          </p>
        </div>
        <figure className={s.ex}>
          <figcaption className={s.exH}>
            <b>Figure 4</b> Five things called orchestration
          </figcaption>
          <ol className={s.ladder}>
            <li className={s.rung}>
              {' '}
              <span className={s.rungN}>1</span>{' '}
              <svg className={s.rungG} viewBox="0 0 150 56" aria-hidden="true">
                <rect x="8" y="18" width="34" height="20" rx="3" />
                <rect x="104" y="18" width="34" height="20" rx="3" />
                <path d="M44 24 H100 M96 20 L100 24 L96 28" />
                <path className={s.soft} d="M102 34 H46 M50 30 L46 34 L50 38" />
              </svg>{' '}
              <div className={s.rungT}>
                <h3>Delegation</h3>
                <p>An agent starts a sub-agent and waits for its answer. Same vendor, same model, and the context ends with the task.</p>
              </div>{' '}
              <span className={s.rungWho}>Common in agent products</span>{' '}
            </li>
            <li className={s.rung}>
              {' '}
              <span className={s.rungN}>2</span>{' '}
              <svg className={s.rungG} viewBox="0 0 150 56" aria-hidden="true">
                <rect x="98" y="4" width="40" height="12" rx="2" />
                <rect x="98" y="22" width="40" height="12" rx="2" />
                <rect x="98" y="40" width="40" height="12" rx="2" />
                <circle cx="24" cy="28" r="7" />
                <path className={s.soft} d="M31 26 L96 10 M31 28 H96 M31 30 L96 46" />
              </svg>{' '}
              <div className={s.rungT}>
                <h3>Parallel agents</h3>
                <p>
                  Many agents in separate worktrees or cloud sessions. Faster, but the developer notices each one finishing, briefs the next
                  and carries context between them.
                </p>
              </div>{' '}
              <span className={s.rungWho}>Common in agent products</span>{' '}
            </li>
            <li className={s.rung}>
              {' '}
              <span className={s.rungN}>3</span>{' '}
              <svg className={s.rungG} viewBox="0 0 150 56" aria-hidden="true">
                <rect x="4" y="20" width="26" height="16" rx="2" />
                <rect x="42" y="20" width="26" height="16" rx="2" />
                <rect x="80" y="20" width="26" height="16" rx="2" />
                <rect x="118" y="20" width="26" height="16" rx="2" />
                <path d="M30 28 H42 M68 28 H80 M106 28 H118" />
              </svg>{' '}
              <div className={s.rungT}>
                <h3>Fixed pipelines</h3>
                <p>
                  A plan known in advance: implement, review, test. It runs the same steps whether the work needs them or not, and stalls
                  when something unexpected happens.
                </p>
              </div>{' '}
              <span className={s.rungWho}>Workflow features, CI</span>{' '}
            </li>
            <li className={cx(s.rung, s.isUs)}>
              {' '}
              <span className={s.rungN}>4</span>{' '}
              <svg className={s.rungG} viewBox="0 0 150 56" aria-hidden="true">
                <rect x="4" y="8" width="26" height="16" rx="2" />
                <rect x="42" y="8" width="26" height="16" rx="2" />
                <rect x="80" y="8" width="26" height="16" rx="2" />
                <path d="M30 16 H42 M68 16 H80" />
                <rect className={s.dash} x="80" y="34" width="26" height="16" rx="2" />
                <rect className={s.dash} x="118" y="34" width="26" height="16" rx="2" />
                <path className={s.dashL} d="M93 24 V34 M106 42 H118" />
              </svg>{' '}
              <div className={s.rungT}>
                <h3>A graph that grows from evidence</h3>
                <p>
                  Each result decides the next node. A clean review skips repair. A finding adds the smallest loop that resolves it. A
                  sensitive path adds a specialist.
                </p>
              </div>{' '}
              <span className={s.rungWho}>Althar</span>{' '}
            </li>
            <li className={cx(s.rung, s.isUs)}>
              {' '}
              <span className={s.rungN}>5</span>{' '}
              <svg className={s.rungG} viewBox="0 0 150 56" aria-hidden="true">
                <rect x="4" y="4" width="26" height="14" rx="2" />
                <rect x="42" y="4" width="26" height="14" rx="2" />
                <rect x="80" y="4" width="26" height="14" rx="2" />
                <rect x="118" y="4" width="26" height="14" rx="2" />
                <path d="M30 11 H42 M68 11 H80 M106 11 H118" />
                <rect className={s.band} x="4" y="38" width="140" height="14" rx="2" />
                <path className={s.soft} d="M17 18 V38 M131 38 V18" />
              </svg>{' '}
              <div className={s.rungT}>
                <h3>Supervision</h3>
                <p>
                  The graph, plus routing across agents and model families, a boundary deciding what reaches a person, and a project memory
                  the next task inherits.
                </p>
              </div>{' '}
              <span className={s.rungWho}>Althar</span>{' '}
            </li>
          </ol>
        </figure>
        <div className={s.prose}>
          <p>
            A CI pipeline knows its stages in advance. Software work often doesn’t. An apparently small change can reveal a missing
            migration, a visual regression, an architectural disagreement or a security-sensitive path. A graph might begin as plan,
            implement, test. The first diff triggers independent review. A finding creates a repair node and a re-review. A flaky test
            branches into diagnosis rather than blindly retrying the implementation. A high-risk migration requires two reviews from
            different model families before it can be accepted.
          </p>
          <p>
            The graph is dynamic, but its history stays inspectable: every plan revision, transition, worker selection and artifact keeps
            its provenance. The difference between the rungs is not how many agents run. It is how many decisions are made between them, and
            whether those decisions rest on evidence.
          </p>
        </div>
        <figure className={s.ex}>
          <figcaption className={s.exH}>
            <b>Figure 5</b> What the coordinator decides
          </figcaption>
          <div className={s.tblWrap} tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens">
            <table className={cx(s.tbl, s.dec)}>
              <thead>
                <tr>
                  <th style={{ width: '15%' }}>Decision</th>
                  <th>What Althar decides</th>
                  <th style={{ width: '32%' }}>What delegation does instead</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Route</td>
                  <td>
                    Which agent and model runs a node, weighing capability, cost, where the code is allowed to go, and whether a reviewer
                    must come from a different model family.
                  </td>
                  <td>Uses whichever agent started the task.</td>
                </tr>
                <tr>
                  <td>Branch</td>
                  <td>Whether a result needs a repair loop, a specialist, or nothing, and adds only that.</td>
                  <td>Returns the sub-agent’s text and stops.</td>
                </tr>
                <tr>
                  <td>Verify</td>
                  <td>
                    What counts as done: a failing test that now passes, an independent re-review, a check against the claims the change
                    touched.
                  </td>
                  <td>Trusts the agent’s summary.</td>
                </tr>
                <tr>
                  <td>Escalate</td>
                  <td>Whether a person is needed, what exactly they are deciding, and what the options cost.</td>
                  <td>Asks about everything, or about nothing.</td>
                </tr>
                <tr>
                  <td>Remember</td>
                  <td>What the run taught the project: claims to propose, contradictions found, decisions to record.</td>
                  <td>Forgets when the session ends.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </figure>
        <figure className={s.ex}>
          <figcaption className={s.exH}>
            <b>Figure 6</b> Task 418, as it ran: stale permissions after a role change, in the design prototype’s example project
          </figcaption>
          <div className={s.dagWrap} tabIndex={0} role="region" aria-label="Diagram, scrolls sideways on small screens">
            <svg
              className={s.dag}
              viewBox="0 0 1288 334"
              role="img"
              aria-label="The graph task 418 grew: nine steps, four of them added from evidence, one question for a person."
            >
              <path className={s.e} d="M148 53 L172 53" />
              <path className={cx(s.e, s.app)} d="M308 53 C332 53, 308 165, 332 165" />
              <path className={cx(s.e, s.app, s.human)} d="M468 165 C492 165, 468 277, 492 277" />
              <path className={s.e} d="M468 165 C492 165, 468 53, 492 53" />
              <path className={cx(s.e, s.app)} d="M628 53 C652 53, 628 165, 652 165" />
              <path className={cx(s.e, s.app, s.human)} d="M628 277 C652 277, 628 165, 652 165" />
              <path className={cx(s.e, s.app)} d="M788 165 L812 165" />
              <path className={cx(s.e, s.app)} d="M948 165 C972 165, 948 53, 972 53" />
              <path className={s.e} d="M1108 53 L1132 53" />
              <g className={cx(s.n, s.coord)}>
                <rect x="12" y="14" width="136" height="78" rx="5" />
                <text className={s.nn} x="24" y="35">
                  01
                </text>
                <text className={s.nk} x="24" y="59">
                  Triage
                </text>
                <text className={s.nw} x="24" y="78">
                  Coordinator
                </text>
              </g>
              <g className={s.n}>
                <rect x="172" y="14" width="136" height="78" rx="5" />
                <text className={s.nn} x="184" y="35">
                  02
                </text>
                <text className={s.nk} x="184" y="59">
                  Implement
                </text>
                <text className={s.nw} x="184" y="78">
                  Claude Code
                </text>
              </g>
              <g className={cx(s.n, s.app)}>
                <rect x="332" y="126" width="136" height="78" rx="5" />
                <text className={s.nn} x="344" y="147">
                  03
                </text>
                <text className={s.nk} x="344" y="171">
                  Security
                </text>
                <text className={s.nw} x="344" y="190">
                  Self-hosted
                </text>
              </g>
              <g className={cx(s.n, s.app, s.human)}>
                <rect x="492" y="238" width="136" height="78" rx="5" />
                <text className={s.nn} x="504" y="259">
                  04
                </text>
                <text className={s.nk} x="504" y="283">
                  Decide
                </text>
                <text className={s.nw} x="504" y="302">
                  You
                </text>
              </g>
              <g className={s.n}>
                <rect x="492" y="14" width="136" height="78" rx="5" />
                <text className={s.nn} x="504" y="35">
                  05
                </text>
                <text className={s.nk} x="504" y="59">
                  Review
                </text>
                <text className={s.nw} x="504" y="78">
                  Codex · OpenAI
                </text>
              </g>
              <g className={cx(s.n, s.app)}>
                <rect x="652" y="126" width="136" height="78" rx="5" />
                <text className={s.nn} x="664" y="147">
                  06
                </text>
                <text className={s.nk} x="664" y="171">
                  Repair
                </text>
                <text className={s.nw} x="664" y="190">
                  Claude Code
                </text>
              </g>
              <g className={cx(s.n, s.app)}>
                <rect x="812" y="126" width="136" height="78" rx="5" />
                <text className={s.nn} x="824" y="147">
                  07
                </text>
                <text className={s.nk} x="824" y="171">
                  Re-review
                </text>
                <text className={s.nw} x="824" y="190">
                  Codex · OpenAI
                </text>
              </g>
              <g className={cx(s.n, s.app)}>
                <rect x="972" y="14" width="136" height="78" rx="5" />
                <text className={s.nn} x="984" y="35">
                  08
                </text>
                <text className={s.nk} x="984" y="59">
                  Acceptance
                </text>
                <text className={s.nw} x="984" y="78">
                  Gemini CLI
                </text>
              </g>
              <g className={cx(s.n, s.coord)}>
                <rect x="1132" y="14" width="136" height="78" rx="5" />
                <text className={s.nn} x="1144" y="35">
                  09
                </text>
                <text className={s.nk} x="1144" y="59">
                  Record
                </text>
                <text className={s.nw} x="1144" y="78">
                  Coordinator
                </text>
              </g>
            </svg>
          </div>
          <p className={s.dagKey}>
            <span>
              <i className={cx(s.k, s.kPlan)}></i>The obvious next step
            </span>
            <span>
              <i className={cx(s.k, s.kApp)}></i>Added because a result required it
            </span>
            <span>
              <i className={cx(s.k, s.kYou)}></i>Needs a person
            </span>
            <span>
              <i className={cx(s.k, s.kCoord)}></i>Coordinator
            </span>
          </p>
          <div className={s.tblWrap} tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens">
            <table className={cx(s.tbl, s.trace)}>
              <thead>
                <tr>
                  <th style={{ width: '4%' }}>#</th>
                  <th style={{ width: '13%' }}>Step</th>
                  <th style={{ width: '18%' }}>Who ran it</th>
                  <th>Why it exists</th>
                  <th style={{ width: '27%' }}>What it left behind</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>01</td>
                  <td>Triage</td>
                  <td>Coordinator</td>
                  <td>Every task starts from project memory. Six facts were in scope; two disagreed about the refresh window.</td>
                  <td>Three acceptance criteria, a failing test, and both disputed facts, marked as such</td>
                </tr>
                <tr>
                  <td>02</td>
                  <td>Implement</td>
                  <td>Claude Code · Anthropic</td>
                  <td>Best record on this module’s last five tasks. Received the criteria and the test, not a summary.</td>
                  <td>A diff against a named revision</td>
                </tr>
                <tr className={s.isApp}>
                  <td>03</td>
                  <td>Security audit</td>
                  <td>Open-weight, self-hosted</td>
                  <td>
                    <b>Added.</b> The diff touched token rotation, a path project memory marks sensitive. Runs locally, so the code stays on
                    the network.
                  </td>
                  <td>One finding it could not settle: a failed rotation now fails the request</td>
                </tr>
                <tr className={s.isYou}>
                  <td>04</td>
                  <td>Decide</td>
                  <td>A person</td>
                  <td>
                    <b>Added.</b> A user-visible behaviour change with no recorded decision.
                  </td>
                  <td>A decision: retry once, then fail</td>
                </tr>
                <tr>
                  <td>05</td>
                  <td>Review</td>
                  <td>Codex · OpenAI</td>
                  <td>Project policy: session code is reviewed by a lab other than the author’s.</td>
                  <td>Finding: three more call sites with the same bug</td>
                </tr>
                <tr className={s.isApp}>
                  <td>06</td>
                  <td>Repair</td>
                  <td>Claude Code · Anthropic</td>
                  <td>
                    <b>Added.</b> The review found three more call sites.
                  </td>
                  <td>A second diff, with the decision applied</td>
                </tr>
                <tr className={s.isApp}>
                  <td>07</td>
                  <td>Re-review</td>
                  <td>Codex · OpenAI</td>
                  <td>
                    <b>Added.</b> Every repair is re-reviewed against the findings it answers.
                  </td>
                  <td>Clean review of the repair</td>
                </tr>
                <tr className={s.isApp}>
                  <td>08</td>
                  <td>Acceptance test</td>
                  <td>Gemini CLI · Google</td>
                  <td>
                    <b>Added.</b> The change is user-facing, so the criteria from triage are tested end to end, by an agent that never saw
                    the code.
                  </td>
                  <td>All three criteria passing on staging; 412 tests passing</td>
                </tr>
                <tr>
                  <td>09</td>
                  <td>Record</td>
                  <td>Coordinator</td>
                  <td>The run ends by writing to the project.</td>
                  <td>A new convention, the decision, and the refresh-window dispute, still open</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={s.exCap}>
            This is an illustrative run built on the design prototype’s example data, not a production trace. What it shows is the shape:
            four of the nine steps did not exist when the task started, four model families took part, and the developer was asked one
            question, at the one point where the answer changes what users see. Without a coordinator, each of the nine hand-offs is one the
            developer carries, and each added step is one they have to remember.
          </p>
        </figure>
        <div className={s.prose}>
          <p>
            The two halves depend on each other. A graph with no memory has to rediscover policy on every run: which paths are sensitive,
            what counts as done, what was decided last time. A memory with no orchestration is a wiki: nothing supplies it, nothing tests it
            against the running system, and nothing notices when it contradicts itself. In Althar, each run starts by reading project memory
            and ends by writing to it.
          </p>
        </div>
      </section>
    </>
  )
}
