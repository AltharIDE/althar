import type { Writable } from 'node:stream'
import { Effect } from 'effect'

const watched = new WeakSet<Writable>()

/** Await the write callback so a slow pipe backpressures the feed instead of growing the terminal's write queue. */
export const terminalWrite = (output: Writable, text: string) =>
  Effect.callback<void, Error>((resume) => {
    if (!watched.has(output)) {
      watched.add(output)
      // Node can emit an error after a write callback or cancelled write has released its listener.
      output.on('error', () => undefined)
    }
    if (output.destroyed || output.writableEnded) {
      resume(Effect.fail(new Error('Terminal output closed.')))
      return
    }
    const failed = () => resume(Effect.fail(new Error('Terminal output closed.')))
    output.once('error', failed)
    output.write(text, (error) => {
      output.off('error', failed)
      resume(error == null ? Effect.void : Effect.fail(new Error('Terminal output closed.')))
    })
    return Effect.sync(() => {
      output.off('error', failed)
    })
  })
