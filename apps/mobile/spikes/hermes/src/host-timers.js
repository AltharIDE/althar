/*
 * A fix to the Hermes CLI as a host, not a polyfill an app needs: the CLI's
 * setTimeout runs callbacks in the order they were set, ignoring the delay,
 * and its setImmediate is the same function (lib/ConsoleHost/ConsoleHost.cpp).
 * An app's timers keep time, so a 10 s timeout set before a 0 ms timer fires
 * first only here. On the CLI, timers become a loop ordered by when each is
 * due, pumped by the CLI's own.
 */
const g = globalThis
const installed = (g.__polyfilled = g.__polyfilled || [])
const isHermesCli = typeof g.print === 'function' && typeof g.HermesInternal === 'object' && g.HermesInternal !== null && typeof g.setInterval === 'undefined'
if (isHermesCli) {
  const pumpLater = g.setTimeout
  const timers = new Map()
  let nextId = 1
  let pumping = false
  const pump = () => {
    pumping = false
    let first
    for (const timer of timers.values()) if (!first || timer.due < first.due || (timer.due === first.due && timer.id < first.id)) first = timer
    if (!first) return
    // Not due yet: go to the back of the CLI's queue, so its other tasks run meanwhile.
    if (Date.now() < first.due) return schedule()
    timers.delete(first.id)
    if (timers.size > 0) schedule()
    first.fn(...first.args)
  }
  const schedule = () => {
    if (!pumping) {
      pumping = true
      pumpLater(pump)
    }
  }
  g.setTimeout = (fn, ms = 0, ...args) => {
    const id = nextId++
    timers.set(id, { id, due: Date.now() + Math.max(0, Number(ms) || 0), fn, args })
    schedule()
    return id
  }
  g.clearTimeout = (id) => void timers.delete(id)
  installed.push('setTimeout/clearTimeout (time-ordered, over the CLI\'s)')
}

