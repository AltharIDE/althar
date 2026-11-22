import { beforeEach } from 'vite-plus/test'

import { begin } from './deadline'
import { isolateGit } from './git'

/* A test's git never looks for a repository above the temporary folder, so it can't write into a task's (git.ts). */
isolateGit()

/* Each test's waits give up a little before its own time does (deadline.ts). */
beforeEach((context) => {
  begin(context.task.timeout)
})
