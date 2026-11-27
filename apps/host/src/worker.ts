import { workerMain } from './workerSetup'

/*
 * A worker's own release (`dist/althar-worker.js`): only its setup's commands (workerSetup.ts), without the home. The
 * home's release takes the same commands as `althar-host worker …`, for workers installed from it before workers had
 * a release of their own.
 */
const exitCode = await workerMain(process.argv.slice(2), (text) => {
  process.stdout.write(text)
})
await new Promise<void>((resolve) => {
  process.stdout.write('', () => resolve())
})
process.exit(exitCode)
