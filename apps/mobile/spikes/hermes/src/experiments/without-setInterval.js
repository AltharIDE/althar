// One RN global left out at a time, to see which of them Effect needs.
const g = globalThis
const cliSetImmediate = g.setImmediate
require('../host-timers')
require('../rn-globals')
if ('setInterval' === 'setImmediate') g.setImmediate = cliSetImmediate
else delete g['setInterval']
if ('setInterval' === 'setInterval') delete g.clearInterval
if ('setInterval' === 'AbortController') delete g.AbortSignal
g.__polyfilled = g.__polyfilled.concat(['(then left out: setInterval)'])
require('../report-env')
require('../tests').run()
