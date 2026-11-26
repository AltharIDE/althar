import { definePlugin } from 'vite-plus/lint/plugins'

import { specTime, testTime } from './budget.js'
import { oneClock } from './clock.js'
import { noFutureDates } from './dates.js'
import { exportedWhereMade } from './exports.js'
import { systemKeys } from './keys.js'
import { layers } from './layers.js'
import { pressAtOnce } from './press.js'
import { oneRemoval } from './removal.js'
import { offTheThread } from './thread.js'

/* Althar's own lint rules, one file each; vite.config.ts says where each applies. */
export default definePlugin({
  meta: { name: 'althar' },
  rules: {
    'one-clock': oneClock,
    'one-removal': oneRemoval,
    'off-the-thread': offTheThread,
    'press-at-once': pressAtOnce,
    'test-time': testTime,
    'spec-time': specTime,
    'system-keys': systemKeys,
    'no-future-dates': noFutureDates,
    layers,
    'exported-where-made': exportedWhereMade,
  },
})
