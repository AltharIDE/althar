import type { Option } from '../state'

/* The ways a task of the request shows the whole of it, from inside the task. */
export const TASK_OPTIONS: ReadonlyArray<Option> = [
  { key: 'a', name: 'As it is', line: 'The task’s page as today, its header saying what it waits for.' },
  { key: 'b', name: 'As it is', line: 'The task’s page as today, its header saying what it waits for.' },
  { key: 'c', name: 'Request view', line: 'A Request view beside Conversation and Outputs: the whole graph, this task in it.' },
]
