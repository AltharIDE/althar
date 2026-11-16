import { useTypedTitle } from '@althar/ui'

import { useAgentRename } from '../data/agentRenames'

/** A task's title as to be drawn: typed in where an agent renamed it, and as it is otherwise. */
export const useTaskTitle = (taskId: string | null | undefined, title: string) => useTypedTitle(title, useAgentRename(taskId))
