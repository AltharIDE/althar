// The CLI's own setImmediate (a FIFO task) kept, with the clearImmediate it lacks, and timers that keep time; no RN globals.
const g = globalThis
require('../host-timers')
const cancelled = new Set()
const cliSetImmediate = g.setImmediate
g.setImmediate = (fn, ...args) => {
  const box = {}
  cliSetImmediate(() => (cancelled.has(box) ? cancelled.delete(box) : fn(...args)))
  return box
}
g.clearImmediate = (box) => void cancelled.add(box)
g.__polyfilled.push('clearImmediate (paired with the CLI setImmediate)')
require('../report-env')
require('../tests').run()
