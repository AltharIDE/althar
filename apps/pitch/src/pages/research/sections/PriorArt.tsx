import s from '../Research.module.css'

export function PriorArt() {
  return (
    <>
      <section className={s.s} id="s13">
        <p className={s.sN}>13 · Resources and prior art</p>
        <h2>Products and ideas informing the research.</h2>
        <div className={s.prose}>
          <p>
            An annotated working set, not a neutral market ranking. Descriptions reflect public positioning; notes on gaps are our current
            assessment. Links were checked in September 2026.
          </p>
        </div>
        <h3 className={s.resG}>Agent products</h3>
        <ol className={s.res}>
          <li>
            <b>Cursor</b>
            <p>
              The benchmark for a coherent, repository-aware agent experience: project surfaces, cloud agents and integrated review. Also
              the clearest example of that intelligence living inside a proprietary environment.
            </p>
            <span className={s.resL}>
              <a href="https://cursor.com/" target="_blank" rel="noopener">
                cursor.com
              </a>
            </span>
          </li>
          <li>
            <b>GitHub Copilot coding agent</b>
            <p>
              A reference for issue-to-pull-request delegation inside the repository’s existing collaboration surface. GitHub’s multi-agent
              direction validates a central control plane, one that remains platform-owned.
            </p>
            <span className={s.resL}>
              <a
                href="https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/"
                target="_blank"
                rel="noopener"
              >
                github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent
              </a>
            </span>
          </li>
          <li>
            <b>Devin</b>
            <p>
              The most complete vertical agent: persistent knowledge, skills, playbooks and session insights tied to Cognition’s own agent
              and compute. Its consolidation of knowledge into on-demand skills shows the industry sorting memory by delivery rather than
              standing.
            </p>
            <span className={s.resL}>
              <a href="https://devin.ai/" target="_blank" rel="noopener">
                devin.ai
              </a>
            </span>
          </li>
          <li>
            <b>Claude Code and Codex</b>
            <p>
              The labs’ own agent tools, available on consumer and team subscriptions. Increasingly capable of long-running and cloud work,
              with memory kept in each lab’s own file conventions.
            </p>
            <span className={s.resL}>
              <a href="https://www.anthropic.com/claude-code" target="_blank" rel="noopener">
                anthropic.com/claude-code
              </a>{' '}
              ·{' '}
              <a href="https://openai.com/codex/" target="_blank" rel="noopener">
                openai.com/codex
              </a>
            </span>
          </li>
          <li>
            <b>Factory</b>
            <p>
              A commercial reference for the full product surface: desktop, CLI, web and mobile, cloud computers, reviewable sessions and
              enterprise controls. Relevant to the capital-intensive infrastructure Althar will eventually need.
            </p>
            <span className={s.resL}>
              <a href="https://docs.factory.ai/" target="_blank" rel="noopener">
                docs.factory.ai
              </a>
            </span>
          </li>
        </ol>
        <h3 className={s.resG}>Orchestration, harnesses and workspaces</h3>
        <ol className={s.res}>
          <li>
            <b>Archon</b>
            <p>
              A harness builder that expresses development as graphs of deterministic steps, AI nodes and review. The closest existing work
              to rung 4, a graph shaped by results. It does not keep a project memory above several vendors’ agents.
            </p>
            <span className={s.resL}>
              <a href="https://github.com/coleam00/Archon" target="_blank" rel="noopener">
                github.com/coleam00/Archon
              </a>
            </span>
          </li>
          <li>
            <b>Agent Orchestrator</b>
            <p>
              A main agent plans the work, spawns workers and escalates to a person. A useful reference for the coordinator role, with the
              plan held by one agent rather than by the project.
            </p>
            <span className={s.resL}>
              <a href="https://orchestrator.inc/" target="_blank" rel="noopener">
                orchestrator.inc
              </a>{' '}
              ·{' '}
              <a href="https://github.com/Untrivial-ai/agent-orchestrator" target="_blank" rel="noopener">
                github.com/Untrivial-ai/agent-orchestrator
              </a>
            </span>
          </li>
          <li>
            <b>Superset</b>
            <p>
              A local-first workspace that hosts several agents in isolated Git worktrees. It shows how much of the parallel-agents problem
              is plain workspace hygiene.
            </p>
            <span className={s.resL}>
              <a href="https://superset.sh/" target="_blank" rel="noopener">
                superset.sh
              </a>
            </span>
          </li>
          <li>
            <b>Agetor</b>
            <p>
              A local-first Kanban control plane for CLI agents, with approvals and transcripts. Close to Althar’s board view; the board
              tracks sessions rather than what the project knows.
            </p>
            <span className={s.resL}>
              <a href="https://www.agetor.dev/" target="_blank" rel="noopener">
                agetor.dev
              </a>
            </span>
          </li>
          <li>
            <b>JCode</b>
            <p>
              A harness exploring shared tools, memory and multiple sessions in one place. Evidence that shared memory across sessions is a
              live question in open source.
            </p>
            <span className={s.resL}>
              <a href="https://github.com/1jehuang/jcode" target="_blank" rel="noopener">
                github.com/1jehuang/jcode
              </a>
            </span>
          </li>
          <li>
            <b>Bottega</b>
            <p>
              An experiment in driving several agents through one interface. A small, honest data point on what supervising many agents
              feels like day to day.
            </p>
            <span className={s.resL}>
              <a href="https://vdaubry.github.io/" target="_blank" rel="noopener">
                vdaubry.github.io
              </a>
            </span>
          </li>
          <li>
            <b>“Welcome to Gas Town”</b>
            <p>
              Steve Yegge’s essay treating coding-agent orchestration as infrastructure rather than a feature of any one agent. The same bet
              this note makes, argued from the practitioner’s side.
            </p>
            <span className={s.resL}>
              <a href="https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04" target="_blank" rel="noopener">
                steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04
              </a>
            </span>
          </li>
        </ol>
        <h3 className={s.resG}>Ideas</h3>
        <ol className={s.res}>
          <li>
            <b>“Complex Acts of Knowing”</b>
            <p>
              Dave Snowden’s knowledge-management paper. It informs the distinction between explicit project records and situated, tacit
              knowledge, a boundary Althar should expose rather than claim to eliminate.
            </p>
            <span className={s.resL}>
              <a href="https://doi.org/10.1108/13673270210424639" target="_blank" rel="noopener">
                doi.org/10.1108/13673270210424639
              </a>
            </span>
          </li>
          <li>
            <b>Jev and System One models</b>
            <p>
              TypeSafe’s proposal for machine-native intelligence: unstructured state in, typed probabilistic decisions out. The most
              relevant emerging architecture for low-latency supervision. Proprietary and hosted, with open SDKs and adapter. To be
              evaluated as one provider.
            </p>
            <span className={s.resL}>
              <a href="https://typesafe.ai/blog/introducing-system-one-models-and-jev" target="_blank" rel="noopener">
                typesafe.ai/blog/introducing-system-one-models-and-jev
              </a>{' '}
              ·{' '}
              <a href="https://docs.typesafe.ai/introduction" target="_blank" rel="noopener">
                docs.typesafe.ai/introduction
              </a>{' '}
              ·{' '}
              <a href="https://evals.typesafe.ai/" target="_blank" rel="noopener">
                evals.typesafe.ai
              </a>{' '}
              ·{' '}
              <a href="https://github.com/typesafe-ai/system-one-adapter-python" target="_blank" rel="noopener">
                github.com/typesafe-ai/system-one-adapter-python
              </a>
            </span>
          </li>
          <li>
            <b>Structured-output critique</b>
            <p>
              Sean Goedecke argues that much of Jev’s speed and consistency may be reproducible with constrained single-token inference on
              existing models. An important counter-hypothesis: the interface may matter strategically even if the model has no durable
              technical moat.
            </p>
            <span className={s.resL}>
              <a href="https://www.seangoedecke.com/jev-means-structured-output-is-interesting-again/" target="_blank" rel="noopener">
                seangoedecke.com/jev-means-structured-output-is-interesting-again
              </a>
            </span>
          </li>
        </ol>
      </section>
    </>
  )
}
