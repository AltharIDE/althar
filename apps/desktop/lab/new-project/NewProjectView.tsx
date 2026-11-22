import type { ComponentProps } from 'react'

import type { NewProjectView as AppNewProjectView } from '../../src/renderer/features/newProject/NewProjectView'
import st from '../../src/renderer/features/start/Start.module.css'
import { BareBar } from '../../src/renderer/features/tabs/TabsFrame'
import { APage } from './directions/a'
import { BEmpty } from './directions/b'
import { CPage } from './directions/c'
import { DPage } from './directions/d'
import l from './lab.module.css'
import { useLab } from './state'

/*
 * The New project tab, as its route has it in the lab (vite.config.ts's
 * seam): the direction's page. B's steps open over the window instead, so
 * its tab only says how to open them.
 */

export function NewProjectView({ onCreated, onClose }: ComponentProps<typeof AppNewProjectView>) {
  const { d } = useLab()
  return (
    // A home with no projects has no tabs: the window's bar stays over the page.
    <div className={st.window}>
      <BareBar />
      <div className={l.fill} data-lab-page>
        {d === 'a' ? (
          <APage onCreated={onCreated} onClose={onClose} />
        ) : d === 'b' ? (
          <BEmpty />
        ) : d === 'c' ? (
          <CPage onCreated={onCreated} onClose={onClose} />
        ) : (
          <DPage onCreated={onCreated} onClose={onClose} />
        )}
      </div>
    </div>
  )
}
