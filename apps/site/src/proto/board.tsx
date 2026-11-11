import type { Scene } from '../home/bodies/desktop/DesktopBody'
import { SCENE } from '../home/bodies/desktop/DesktopBody'

/*
 * The board's words, while they are chosen. The board under them follows one
 * task: it starts on Opus, Claude Code runs out of usage, it moves on to
 * Codex and carries on, waits on you, and is merged, with tasks led by
 * Codex, Gemini and Qwen running beside it, in four lanes: Up next, Running,
 * Needs you, Settled.
 */

export interface Direction<T> {
  key: string
  name: string
  value: T
}

export const BOARD: Direction<Scene>[] = [
  { key: 'a', name: 'As it is', value: SCENE.independent },
  {
    key: 'b',
    name: 'The work doesn’t stop',
    value: {
      title: (
        <>
          Usage runs out.
          <br />
          <b>The work doesn’t.</b>
        </>
      ),
      lead: 'Claude Code hits its limit mid-task, and Codex picks up the same step and carries it to merged. Every task, every agent, on one board.',
    },
  },
  {
    key: 'c',
    name: 'One board',
    value: {
      title: (
        <>
          Every agent’s work.
          <br />
          <b>One board.</b>
        </>
      ),
      lead: 'Up next, running, needs you, settled: every task across Claude Code, Codex, Gemini and Qwen, in one place. When one agent runs out, another takes over.',
    },
  },
  {
    key: 'd',
    name: 'Watch one column',
    value: {
      title: (
        <>
          Tasks run themselves.
          <br />
          <b>You watch one column.</b>
        </>
      ),
      lead: 'Tasks start, change agent when one runs out, and get reviewed on their own. They stop in Needs you only for a decision or a merge.',
    },
  },
  {
    key: 'e',
    name: 'Althar stays, shown',
    value: {
      title: (
        <>
          Usage gets cut.
          <br />
          Models get pulled.
          <br />
          <b>Your tasks carry on.</b>
        </>
      ),
      lead: 'When Claude Code runs out, its tasks move to Codex or Gemini and keep going, all the way to merged. Open source, on your computer, with any agent you have.',
    },
  },
]
