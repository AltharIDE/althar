/** Kinds read by the merge line, the pull-request follower and the release watcher. */
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
]
