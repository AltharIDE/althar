import { useNavigate } from '@tanstack/react-router'
import { memo } from 'react'

import { settingsSearch } from '../project/search'
import { useWhenRemoved } from '../projectSettings/useProjectSettings'
import { useVisit } from '../tabs/TabsFrame'
import { TaskView } from './TaskView'
import { useTask } from './useTask'

/** One task's screen: everything it reads is its own, from the first render, and it is kept while the person is elsewhere (`KeptScreens`). */
export const TaskScreen = memo(function TaskScreen({ threadId }: { threadId: string }) {
  const navigate = useNavigate()
  const model = useTask(threadId)
  const project = model.snapshot?.project
  useVisit(threadId, project?.id)
  // Its project removed, from here or another window: home.
  useWhenRemoved(project?.id, () => void navigate({ to: '/' }))
  // Back to the project, which opens on the view it was last on.
  const back = () =>
    void (project === undefined ? navigate({ to: '/' }) : navigate({ to: '/projects/$projectId', params: { projectId: project.id } }))
  // Its project's rules are a section of the project's settings.
  const rules =
    project === undefined
      ? {}
      : {
          onRules: () => void navigate({ to: '/projects/$projectId', params: { projectId: project.id }, search: settingsSearch('rules') }),
        }
  return <TaskView model={model} onBack={back} {...rules} />
})
