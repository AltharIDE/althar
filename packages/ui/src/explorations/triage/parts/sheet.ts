import { checkpoint, Phase, type Assumption, type Checkpoint, type CheckpointActions } from '../model'
import { ASKED, ONE, OWN_BUDGET, SAME_BUDGET, THREE } from '../world'
import type { Moment, Shown } from './Moments'

/*
 * The moments every direction is shown in, in the order a task meets them,
 * so the directions can be compared moment by moment. A direction gives only
 * how it draws one.
 */

/** How long a checkpoint waits before it carries on: two minutes. */
export const WAIT = 120

export interface Scene {
  assumptions: readonly Assumption[]
  /** The clock as it is with less motion asked for. */
  still?: boolean
  /** Shown opened, where the direction folds it, to see what opens. */
  open?: boolean
}

/** How a direction draws a moment. */
export type Draw = (scene: Scene) => (c: Checkpoint, on: CheckpointActions) => Shown

export type MomentId =
  | 'looking'
  | 'empty'
  | 'one'
  | 'three'
  | 'correcting'
  | 'corrected'
  | 'held'
  | 'ranOut'
  | 'continuedNow'
  | 'still'
  | 'asking'
  | 'answered'

const corrected = { [SAME_BUDGET.id]: OWN_BUDGET }

const MOMENTS: readonly (Omit<Moment, 'show'> & { id: MomentId; scene: Scene })[] = [
  {
    id: 'looking',
    state: 'Looking around',
    note: 'Groundwork. The card says so; the thread shows what it reads.',
    start: checkpoint(Phase.Looking),
    scene: { assumptions: THREE },
  },
  {
    id: 'empty',
    state: 'Nothing to check',
    note: 'An empty checkpoint passes almost unseen. This is meant to be the usual case.',
    start: checkpoint(Phase.Continued, { by: 'time', left: 0 }),
    scene: { assumptions: [] },
  },
  {
    id: 'one',
    state: 'One assumption',
    note: 'Shown opened, where the direction folds it.',
    start: checkpoint(Phase.Open),
    scene: { assumptions: ONE, open: true },
  },
  {
    id: 'three',
    state: 'Three, counting down',
    note: 'Leaving it alone is a yes.',
    start: checkpoint(Phase.Open),
    scene: { assumptions: THREE },
  },
  {
    id: 'correcting',
    state: 'Correcting one',
    note: 'No opens a line in place. The clock waits while you write.',
    start: checkpoint(Phase.Open, { correcting: SAME_BUDGET.id }),
    scene: { assumptions: THREE },
  },
  {
    id: 'corrected',
    state: 'Corrected, counting',
    note: 'What you said replaces it, with Undo until it carries on.',
    start: checkpoint(Phase.Open, { left: 64, corrections: corrected }),
    scene: { assumptions: THREE },
  },
  {
    id: 'held',
    state: 'Held',
    note: 'You held it. Not violet: you chose to stop it, so it isn’t a call. It stays in Running.',
    start: checkpoint(Phase.Held),
    scene: { assumptions: THREE },
  },
  {
    id: 'ranOut',
    state: 'Ran out',
    note: 'It carried on by itself. What it assumed stays, a click away.',
    start: checkpoint(Phase.Continued, { by: 'time', left: 0, corrections: corrected }),
    scene: { assumptions: THREE },
  },
  {
    id: 'continuedNow',
    state: 'Continued now',
    start: checkpoint(Phase.Continued, { by: 'you', left: 51 }),
    scene: { assumptions: THREE },
  },
  {
    id: 'still',
    state: 'Less motion',
    note: 'With reduced motion nothing ticks or drains: it says when it carries on.',
    start: checkpoint(Phase.Open),
    scene: { assumptions: THREE, still: true },
  },
  {
    id: 'asking',
    state: 'A real question',
    note: 'The exception: a wrong guess would redo the task and partners would see it. Violet, in Needs you, and the card waits on you.',
    start: checkpoint(Phase.Asking),
    scene: { assumptions: ASKED.also },
  },
  {
    id: 'answered',
    state: 'Answered',
    note: 'The call settles, the card is back to running, and what it also assumed carries on with the answer.',
    start: checkpoint(Phase.Answered),
    scene: { assumptions: ASKED.also },
  },
]

/** Every moment, drawn the direction's way, with its own notes where it has them. */
export function momentsOf(draw: Draw, notes: Partial<Record<MomentId, string>> = {}): Moment[] {
  return MOMENTS.map(({ scene, ...m }) => ({ ...m, note: notes[m.id] ?? m.note, show: draw(scene) }))
}

/** Two to try with a running clock: a checkpoint from the top, and a question. */
export function liveOf(draw: Draw): Moment[] {
  return [
    {
      id: 'live',
      state: 'Try it',
      note: 'The clock runs. Say no to one, hold it, or let it carry on.',
      start: checkpoint(Phase.Open, { left: WAIT }),
      show: draw({ assumptions: THREE }),
    },
    {
      id: 'live-question',
      state: 'Try a question',
      note: 'Answer it in the thread; the call leaves Needs you and the card runs again.',
      start: checkpoint(Phase.Asking),
      show: draw({ assumptions: ASKED.also }),
    },
  ]
}
