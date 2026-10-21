// Only the CLI's timers fixed, none of RN's globals: which of those does Effect actually need?
require('./host-timers')
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
    () => {},
    (error) => console.log(`FAIL the run threw -- ${error && error.stack ? error.stack : error}`),
  )
}
