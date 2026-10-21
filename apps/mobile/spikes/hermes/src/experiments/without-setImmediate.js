// One RN global left out at a time, to see which of them Effect needs.
const g = globalThis
const cliSetImmediate = g.setImmediate
require('../host-timers')
require('../rn-globals')
if ('setImmediate' === 'setImmediate') g.setImmediate = cliSetImmediate
else delete g['setImmediate']
if ('setImmediate' === 'setInterval') delete g.clearInterval
if ('setImmediate' === 'AbortController') delete g.AbortSignal
g.__polyfilled = g.__polyfilled.concat(['(then left out: setImmediate)'])
require('../report-env')
require('../tests').run()
