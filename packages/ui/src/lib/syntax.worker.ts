import { type ColourAsk, serveColours } from './shiki'

/*
 * Where a file's colours are worked out, off the window's thread: a long
 * file takes seconds to colour, and the window answers the person the
 * whole time. What it colours, and how it tells the window, is shiki.ts.
 */

/* A turn comes after whatever the window sent meanwhile: a message to itself, which no timer's clamp delays. */
const turns = new MessageChannel()
let queued: (() => void) | null = null
turns.port1.onmessage = () => {
  const next = queued
  queued = null
  next?.()
}

const hear = serveColours(
  (message, transfer) => self.postMessage(message, { transfer }),
  (next) => {
    queued = next
    turns.port2.postMessage(null)
  },
)
self.onmessage = (event: MessageEvent<ColourAsk>) => hear(event.data)
