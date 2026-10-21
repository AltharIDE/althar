import type { PortLike } from '@althar/contracts'

/*
 * The contract's port over a channel that carries text, as the relay's
 * WebSocket does once a frame is opened: each message as JSON. The RPC's
 * messages are the contract's schemas encoded, so plain JSON holds them; a
 * bigint (Effect's request ids) travels as a tagged string and comes back
 * whole.
 */

/** What carries text both ways: a WebSocket, or the relay's encrypted channel over one. */
export interface TextChannel {
  send(text: string): void
  /** Calls `handler` with each text that arrives, until the returned function is called. */
  onText(handler: (text: string) => void): () => void
  /** Calls `handler` once the channel has closed. */
  onClose?(handler: () => void): () => void
}

const BIGINT = '\u0000bigint:'

export const encode = (message: unknown): string =>
  JSON.stringify(message, (_key, value: unknown) => (typeof value === 'bigint' ? `${BIGINT}${value.toString()}` : value))

export const decode = (text: string): unknown =>
  JSON.parse(text, (_key, value: unknown) =>
    typeof value === 'string' && value.startsWith(BIGINT) ? BigInt(value.slice(BIGINT.length)) : value,
  )

export const jsonPort = (channel: TextChannel): PortLike => ({
  post: (message) => channel.send(encode(message)),
  listen: (handler) => channel.onText((text) => handler(decode(text))),
  ...(channel.onClose === undefined ? {} : { closed: (handler: () => void) => channel.onClose?.(handler) ?? (() => {}) }),
})
