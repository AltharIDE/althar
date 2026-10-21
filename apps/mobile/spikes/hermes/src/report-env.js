// Names the engine and what was polyfilled, before the tests run.
const g = globalThis
const engine = typeof g.HermesInternal === 'object' && g.HermesInternal
  ? `Hermes ${(g.HermesInternal.getRuntimeProperties?.() || {})['OSS Release Version'] || ''} (bytecode ${(g.HermesInternal.getRuntimeProperties?.() || {})['Bytecode Version'] || '?'})`
  : typeof process === 'object' && process.versions ? `Node ${process.versions.node}` : 'unknown engine'
console.log(`engine: ${engine}`)
console.log(`polyfilled: ${(g.__polyfilled || []).join(', ') || 'nothing'}`)
