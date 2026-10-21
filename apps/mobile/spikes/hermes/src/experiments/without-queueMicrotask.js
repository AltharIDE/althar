// One RN global left out at a time, to see which of them Effect needs.
const g = globalThis
const cliSetImmediate = g.setImmediate
require('../host-timers')
require('../rn-globals')
if ('queueMicrotask' === 'setImmediate') g.setImmediate = cliSetImmediate
else delete g['queueMicrotask']
if ('queueMicrotask' === 'setInterval') delete g.clearInterval
if ('queueMicrotask' === 'AbortController') delete g.AbortSignal
g.__polyfilled = g.__polyfilled.concat(['(then left out: queueMicrotask)'])
require('../report-env')
require('../tests').run()
