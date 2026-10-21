// The same tests on the host as it is, nothing polyfilled: to see what breaks without RN's globals.
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
