// The spike as the app would run it: the CLI's timers made to keep time, the globals RN provides, then the tests.
require('./host-timers')
require('./rn-globals')
require('./report-env')
let tests
const loading = Date.now()
try {
  tests = require('./tests')
  console.log(`loaded Effect, the contract and the tests in ${Date.now() - loading} ms`)
} catch (error) {
  console.log(`FAIL loading Effect and the contract -- ${error && error.stack ? error.stack : error}`)
}
if (tests) {
  tests.run().then(
    (failed) => { if (failed > 0 && typeof process === 'object' && process.exitCode !== undefined) process.exitCode = 1 },
    (error) => console.log(`FAIL the run threw -- ${error && error.stack ? error.stack : error}`),
  )
}
