import type { Option } from '../state'

/* The ways a task of a mission shows it from inside: where it sits, how the whole stands, and what the plan gave it. */
export const TASK_OPTIONS: ReadonlyArray<Option> = [
  {
    key: 'a',
    name: 'In the header',
    line: 'Beside the title, the mission and the step, its neighbours as marks; pressed, the step’s brief and the whole mission, drawn small.',
  },
  {
    key: 'b',
    name: 'In the thread',
    line: 'The thread opens with what the plan gave the step, your notes pinned, says when the mission started it, and ends with what merging it starts.',
  },
  {
    key: 'c',
    name: 'Its own view',
    line: 'A view beside Conversation and Outputs (r): the whole mission drawn large, this step ringed, and its brief under it.',
  },
  {
    key: 'd',
    name: 'A path',
    line: 'A slim line under the header: the step before on the left, after on the right, [ and ] to walk; the mission as beads between.',
  },
]
