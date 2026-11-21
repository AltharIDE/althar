export const taskEventWaitKinds: ReadonlyArray<string> = ['review_settled', 'checks_passed', 'lead_done']

/** Kinds read by the merge line, the pull-request follower and the task and release watchers. */
export const errandWaitKinds: ReadonlyArray<string> = [
  'task_pull_request',
  'task_merged',
  'merge_line',
  'merge_queue',
  'merge_train',
  'merge_in_flight',
  'checks',
  'required-check-missing',
  'post-merge',
  'run',
  'draft',
  ...taskEventWaitKinds,
]

export const releaseWaitKinds: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ['push_tag', ['task_merged', 'checks', 'post-merge', 'required-check-missing']],
  ['approve_release_run', ['run']],
  ['publish_release', ['draft']],
])

/** A step added or advanced during the sweep gets its task waits read on the next sweep. */
export const taskWaitsReady = (ready: ReadonlySet<string>, step: { errandId: string; stepKey: string; waits: string }) =>
  ready.has(`${step.errandId}/${step.stepKey}`) ||
  !(JSON.parse(step.waits) as ReadonlyArray<{ kind: string }>).some((wait) => taskEventWaitKinds.includes(wait.kind))
