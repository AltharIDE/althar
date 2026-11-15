import { definePlugin } from 'vite-plus/lint/plugins'

import { oneClock } from './clock.js'
import { pressAtOnce } from './press.js'
import { oneRemoval } from './removal.js'
import { offTheThread } from './thread.js'

/* Althar's own lint rules, one file each; vite.config.ts says where each applies. */
export default definePlugin({
  meta: { name: 'althar' },
  rules: { 'one-clock': oneClock, 'one-removal': oneRemoval, 'off-the-thread': offTheThread, 'press-at-once': pressAtOnce },
})
