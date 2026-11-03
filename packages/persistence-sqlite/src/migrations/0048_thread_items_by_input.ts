import { index } from './0001_initial/columns'

/*
 * A way in to a message's own item in its thread, by the message: a task
 * opens with the messages its request was made from (0047), each read from
 * the coordinator's thread, which otherwise was scanned whole.
 */
export const statements: ReadonlyArray<string> = [
  index('thread_items_by_user_input', 'thread_items (user_input_id)', { where: 'user_input_id IS NOT NULL' }),
]
