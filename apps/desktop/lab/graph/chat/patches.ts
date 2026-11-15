import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the project's page (ProjectView), each where the plan shows beside the coordinator's conversation. */

const here = import.meta.dirname
const projectView = join(here, '../../../src/renderer/features/project/ProjectView.tsx')

export const CHAT_PATCHES: ReadonlyArray<Patch> = [
  { file: projectView, from: '', to: `import { LabDock } from '${join(here, 'Dock.tsx')}'\n` },
  // Over the composer: the plan docked over the coordinator's composer, through the whole talk.
  {
    file: projectView,
    from: `<TaskFace
                          className={s.face}
                          composer={composer}`,
    to: `<TaskFace
                          className={s.face}
                          composer={<LabDock>{composer}</LabDock>}`,
  },
]
