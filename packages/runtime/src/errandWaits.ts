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

/** How each release step names what it acts on: the watcher reads its repository from the part before " tag " or " release ". */
const releaseTargets: ReadonlyMap<string, { readonly shape: RegExp; readonly says: string }> = new Map([
  ['push_tag', { shape: /^\S+ tag \S+$/, says: '<owner/repo> tag <tag>' }],
  ['approve_release_run', { shape: /^\S+ tag \S+ approval$/, says: '<owner/repo> tag <tag> approval' }],
  ['publish_release', { shape: /^\S+ release \S+$/, says: '<owner/repo> release <tag>' }],
])

/**
 * Why nothing of Althar's would ever see this step's waits met, or null where something does: the merge line watches a merge
 * kept here by its task (merge_pull_request keeps and binds any other itself); the release watcher a release step by its repository and tag;
 * and any other step only a task's recorded results. Refused at keep_errand, so the coordinator keeps it another way rather
 * than leave it on hold.
 */
export const unwatchedStep = (step: {
  readonly tool: string
  readonly target: string
  readonly request: Readonly<Record<string, unknown>>
  readonly waits: ReadonlyArray<{ readonly kind: string }>
}): string | null => {
  // The merge line watches a concrete merge only as merge_pull_request binds it, from the head it read: never one kept here.
  if (step.tool === 'merge_pull_request')
    return step.target.startsWith('task:')
      ? null
      : 'Althar can’t find a pull request by its title or branch to watch, and a merge kept here isn’t bound to the head the merge line checks. Keep a task’s merge by its task (taskId, target task:<slug>, wait task_pull_request), or, for a pull request that is open already, call merge_pull_request on the person’s message: it keeps the merge errand itself.'
  const release = releaseTargets.get(step.tool)
  if (release !== undefined) {
    if (!release.shape.test(step.target.trim()) || typeof step.request.tag !== 'string')
      return `A ${step.tool} step targets ${release.says} with request {tag, …}: that is how Althar finds what to watch.`
    return null
  }
  // A kind Althar doesn't know is refused with the kinds it watches, by keep itself.
  const outside = [
    ...new Set(step.waits.map((wait) => wait.kind).filter((kind) => errandWaitKinds.includes(kind) && !taskEventWaitKinds.includes(kind))),
  ]
  if (outside.length === 0) return null
  return `Althar watches ${outside.join(', ')} only for merge_pull_request and release steps (push_tag, approve_release_run, publish_release). A ${step.tool} step can wait only on a task’s result: ${taskEventWaitKinds.join(', ')}, targeting the task by slug.`
}

/** A step added or advanced during the sweep gets its task waits read on the next sweep. */
export const taskWaitsReady = (ready: ReadonlySet<string>, step: { errandId: string; stepKey: string; waits: string }) =>
  ready.has(`${step.errandId}/${step.stepKey}`) ||
  !(JSON.parse(step.waits) as ReadonlyArray<{ kind: string }>).some((wait) => taskEventWaitKinds.includes(wait.kind))
