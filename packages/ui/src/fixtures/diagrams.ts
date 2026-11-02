/* Diagrams as agents draw them in a message, and as a repository's docs carry them. */

const fence = (source: string) => '```mermaid\n' + source + '\n```'

export const flowchart = fence(`flowchart TD
  ask[The person asks] --> plan[Coordinator plans the task]
  plan --> lead[A lead starts it in a worktree]
  lead --> checks{Checks pass?}
  checks -->|yes| review[Review]
  checks -->|no| lead
  review --> pr[Pull request]`)

export const sequence = fence(`sequenceDiagram
  participant P as Person
  participant C as Coordinator
  participant L as Lead
  P->>C: Draw how a task runs
  C->>L: Start the task
  L-->>C: Plan
  C-->>P: Asks to go ahead
  P->>C: Yes
  L->>L: Builds and tests
  L-->>P: Pull request, with evidence`)

/* wider than the thread: it scrolls sideways, or opens bigger */
export const wide = fence(`flowchart LR
  issue[Issue filed] --> triage[Triaged] --> task[Task started] --> plan[Plan agreed] --> build[Built in a worktree] --> checks[Checks] --> review[Reviewed] --> pr[Pull request opened] --> queue[Merge queue] --> main[Merged to main] --> release[Released]`)

export const broken = fence(`flowchart LR
  ask[The person asks] -->
  plan[[Coordinator plans`)

/** A message as an agent writes one: a few words, and the diagram. */
export const diagramMessage = `Here is how a task runs, from the ask to the pull request:

${flowchart}

The lead loops on its checks until they pass, and only then asks for a review.`

/** A doc with diagrams in it, as one in docs/architecture. */
export const diagramDoc = `# The workflow engine

A run moves through these states. One that is \`uncertain\` is reconciled before it can end.

\`\`\`mermaid
stateDiagram-v2
    [*] --> ready
    ready --> running
    running --> verifying
    verifying --> succeeded
    running --> waiting_attention
    waiting_attention --> running
    running --> uncertain
    uncertain --> reconciling
    reconciling --> succeeded
    reconciling --> failed
    running --> failed
    succeeded --> [*]
    failed --> [*]
\`\`\`

## Who talks to whom

${sequence}
`
