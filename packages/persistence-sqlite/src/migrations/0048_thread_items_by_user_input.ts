import { index } from './0001_initial/columns'

/*
 * A task's opening request points to the coordinator's user messages. Find
 * those messages by their input id without scanning the thread's history.
 */
export const statements: ReadonlyArray<string> = [
  index('thread_items_by_user_input', 'thread_items (user_input_id)', { where: "kind = 'user_message'" }),
]
