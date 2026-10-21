/*
 * Globals React Native 0.88 installs at startup (InitializeCore: setUpTimers,
 * setUpXHR) that the bare Hermes CLI lacks, installed only where missing and
 * each named in `globalThis.__polyfilled`. An app needs none of these: RN
 * provides them. See REPORT.md.
 */
const g = globalThis
const installed = (g.__polyfilled = g.__polyfilled || [])
const install = (name, make) => {
  if (typeof g[name] === 'undefined') {
    g[name] = make()
    installed.push(name)
  }
}

// RN: native in bridgeless (NativeMicrotasks); Hermes runs Promise jobs on the same queue.
install('queueMicrotask', () => (fn) => {
  Promise.resolve().then(fn).catch((error) => setTimeout(() => { throw error }, 0))
})

// RN: setInterval/clearInterval are installed by setUpTimers (host functions in bridgeless).
install('setInterval', () => (fn, ms, ...args) => {
  const handle = { id: 0 }
  const tick = () => {
    handle.id = setTimeout(tick, ms)
    fn(...args)
  }
  handle.id = setTimeout(tick, ms)
  return handle
})
install('clearInterval', () => (handle) => handle && clearTimeout(handle.id))

// RN bridgeless (the only architecture since 0.82): setImmediate is a shim over queueMicrotask (Libraries/Core/Timers/immediateShim.js).
// The CLI's setImmediate is its setTimeout; Node's is a macrotask. Make it RN's.
if (typeof g.HermesInternal === 'object' && g.HermesInternal !== null) {
  let nextImmediate = 1
  const cleared = new Set()
  g.setImmediate = (fn, ...args) => {
    const id = nextImmediate++
    g.queueMicrotask(() => (cleared.has(id) ? cleared.delete(id) : fn(...args)))
    return id
  }
  g.clearImmediate = (id) => void cleared.add(id)
  installed.push('setImmediate/clearImmediate (as RN shims them, over queueMicrotask)')
}

// RN: AbortController/AbortSignal are installed by setUpXHR.
install('AbortSignal', () => {
  class AbortSignal {
    constructor() {
      this.aborted = false
      this.reason = undefined
      this.onabort = null
      this._listeners = []
    }
    addEventListener(type, fn) { if (type === 'abort') this._listeners.push(fn) }
    removeEventListener(type, fn) { this._listeners = this._listeners.filter((one) => one !== fn) }
    throwIfAborted() { if (this.aborted) throw this.reason }
  }
  return AbortSignal
})
install('AbortController', () => class AbortController {
  constructor() { this.signal = new g.AbortSignal() }
  abort(reason) {
    const signal = this.signal
    if (signal.aborted) return
    signal.aborted = true
    signal.reason = reason === undefined ? new Error('This operation was aborted') : reason
    const event = { type: 'abort', target: signal }
    if (typeof signal.onabort === 'function') signal.onabort(event)
    for (const fn of signal._listeners.slice()) fn(event)
  }
})
