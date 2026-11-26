import { beforeEach } from 'vite-plus/test'

import { begin } from './deadline'
import { fromRoot } from './flaky'
import { held, lapsedOf } from './quarantine'

/* What this job read of the quarantine as it started (quarantine.ts): none on a computer, or at night. */
const quarantine = held()

beforeEach((context) => {
  /* Each test's waits give up a little before its own time does (deadline.ts). */
  begin(context.task.timeout)
  /*
   * A test whose quarantine lapsed is skipped where quarantine is read: on pull requests, in the queue, after merge.
   * Where coverage is measured it runs, failing nothing, as a quarantined test does, so what it covers still counts.
   */
  if (process.env.QUARANTINE_LAPSED === 'run') return
  const issue = lapsedOf(quarantine, { file: fromRoot(context.task.file.filepath), name: context.task.fullTestName })
  if (issue !== undefined) context.skip(`its quarantine lapsed (#${issue}): it runs at night, where it gates`)
})
