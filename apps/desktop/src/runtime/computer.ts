import { randomUUID } from 'node:crypto'

import type { ComputerAnswer, ComputerCall, ComputerDone, ComputerOwner } from '@althar/runtime/computerBridge'
import { Duration, Effect } from 'effect'

type ComputerMessage =
  | { readonly type: 'computer'; readonly id: string; readonly owner: ComputerOwner; readonly call: ComputerCall }
  | { readonly type: 'computer-cancel'; readonly id: string }

export const computerWith = (post: (message: ComputerMessage) => void) => {
  const pending = new Map<string, (done: ComputerDone) => void>()
  return {
    ask: (owner: ComputerOwner, call: ComputerCall) =>
      Effect.callback<ComputerAnswer, string>((resume) => {
        const id = randomUUID()
        pending.set(id, (done) => resume('error' in done ? Effect.fail(done.error) : Effect.succeed(done.value)))
        post({ type: 'computer', id, owner, call })
        return Effect.sync(() => {
          if (pending.delete(id)) post({ type: 'computer-cancel', id })
        })
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(180),
          orElse: () => Effect.fail('Computer use timed out. Check the app before trying again.'),
        }),
      ),
    answer: (id: string, done: ComputerDone) => {
      const receive = pending.get(id)
      pending.delete(id)
      receive?.(done)
    },
  }
}
