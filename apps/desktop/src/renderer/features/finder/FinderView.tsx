import { Finder } from '@althar/ui'

import { useFinder } from './useFinder'

export const text = {
  inProject: (name: string) => `Find a task in ${name}`,
  everywhere: 'Find a task in any project',
  here: 'Find a task in this project',
}

/** The finder over the window, searching one project or (null) every one, until a task is opened or it closes. */
export function FinderView({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const model = useFinder(projectId, onClose)
  return (
    <Finder
      results={model.rows}
      searching={model.searching}
      query={model.query}
      onQueryChange={model.setQuery}
      onOpen={model.open}
      onClose={onClose}
      text={{ search: projectId === null ? text.everywhere : model.project === null ? text.here : text.inProject(model.project.name) }}
    />
  )
}
