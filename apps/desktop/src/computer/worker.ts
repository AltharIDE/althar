import { ComputerProblem, nativeComputer } from './native'
import type { NativeCall, NativeReply } from './protocol'

const port = process.parentPort
if (port === undefined) throw new Error('The desktop process must start the native computer helper.')

let computer: ReturnType<typeof nativeComputer> | undefined
port.on('message', ({ data }: { data: { readonly id: string; readonly call: NativeCall } }) => {
  const { id, call } = data
  void Promise.resolve()
    .then(() => {
      computer ??= nativeComputer()
      return computer.run(call)
    })
    .then(
      (value) => port.postMessage({ id, value } satisfies NativeReply),
      (error: unknown) => {
        // Native library errors can carry screen content. Only send messages from our own validation and controlled driver branches.
        const message =
          error instanceof ComputerProblem
            ? error.message
            : 'The native driver could not complete that call. Check the app before retrying.'
        port.postMessage({ id, error: message } satisfies NativeReply)
      },
    )
})
