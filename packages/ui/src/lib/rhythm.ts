/**
 * How a thread-level part spaces itself against its neighbours. Each part's root carries it as data-rhythm, and
 * Thread and Turn read it, so the spacing lives with the layout rather than in each host.
 */
export enum Rhythm {
  /** Something you said: what you send in a row reads as one message. */
  You = 'you',
  /** Finished work folded to a line; closed, what follows sits closer to it than to a block. */
  Fold = 'fold',
  /** A tool call's line: a run of them stacks tight. */
  Tool = 'tool',
  /** A tool call opened into a sheet: it stands apart from what came before, and the run goes on under it. */
  Sheet = 'sheet',
  /** A command to run: a run of them reads as one block. */
  Snippet = 'snippet',
  /** A call out of the codebase, to the web or an MCP server: a run of them stacks. */
  External = 'external',
  /** A step's row, or a review: steps stack close together. */
  Step = 'step',
  /** A line saying the work was steered. */
  Steer = 'steer',
  /** A quiet line recording a change: to the graph, or to where work runs. Several read as one list. */
  Change = 'change',
  /** What was allowed without you: it sits by its step like a change, but ends its own list. */
  Allowed = 'allowed',
  /** A task's trace over time. */
  Mark = 'mark',
  /** A task's card, or the card that launches one. */
  Card = 'card',
}
