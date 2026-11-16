import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'

/** Pull one line at a time. Backpressure reaches stdin while an RPC is running; no unbounded queue of commands. */
export async function* attachmentLines(input: Readable): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  for await (const chunk of input) {
    if (!Buffer.isBuffer(chunk)) throw new Error('The terminal input must be a byte stream.')
    pending += decoder.write(chunk)
    let newline: number
    while ((newline = pending.indexOf('\n')) !== -1) {
      if (Buffer.byteLength(pending.slice(0, newline)) > 1024 * 1024) throw new Error('Input lines must be at most 1 MiB.')
      yield pending.slice(0, newline).replace(/\r$/, '')
      pending = pending.slice(newline + 1)
    }
    if (Buffer.byteLength(pending) > 1024 * 1024) throw new Error('Input lines must be at most 1 MiB.')
  }
  pending += decoder.end()
  if (pending !== '') yield pending
}
