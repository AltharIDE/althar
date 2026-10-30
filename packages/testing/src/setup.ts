import { beforeEach } from 'vite-plus/test'

import { begin } from './deadline'

/* Each test's waits give up a little before its own time does (deadline.ts). */
beforeEach((context) => {
  begin(context.task.timeout)
})
