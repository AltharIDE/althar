// One RN global left out at a time, to see which of them Effect needs.
const g = globalThis
const cliSetImmediate = g.setImmediate
require('../host-timers')
require('../rn-globals')
if ('AbortController' === 'setImmediate') g.setImmediate = cliSetImmediate
else delete g['AbortController']
if ('AbortController' === 'setInterval') delete g.clearInterval
if ('AbortController' === 'AbortController') delete g.AbortSignal
g.__polyfilled = g.__polyfilled.concat(['(then left out: AbortController)'])
require('../report-env')
require('../tests').run()
