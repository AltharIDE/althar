import { useConnections } from '../connections/useConnections'
import { useNewTab } from '../tabs/TabsFrame'
import { NewProjectView } from './NewProjectView'
import { useNewProject } from './useNewProject'

/** A new project in its tab: loaded as the tab first opens, beside what it reads (route.tsx), since few launches start there. */
export function NewProject() {
  const tab = useNewTab()
  return (
    <NewProjectView model={useNewProject()} connections={useConnections()} onCreated={tab.made} onOpen={tab.made} onClose={tab.close} />
  )
}
