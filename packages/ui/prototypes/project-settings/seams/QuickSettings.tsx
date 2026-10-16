// Scrappy: the gear at the bar's end. In E, on a project's screen, it leads with that project.
import { QuickSettings as Real } from '../../../../../apps/desktop/src/renderer/features/settings/QuickSettings'
import { EQuick, type QuickProps, useOnProject } from '../directions/E'
import { useProto } from '../state'

export function QuickSettings(props: QuickProps) {
  const p = useProto()
  const onProject = useOnProject()
  if (p.direction === 'E' && onProject) return <EQuick {...props} />
  return <Real {...props} />
}
