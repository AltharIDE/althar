import type { ComponentProps } from 'react'

import { StartView as AppStartView } from '../../src/renderer/features/start/StartView'
import st from '../../src/renderer/features/start/Start.module.css'
import { BareBar } from '../../src/renderer/features/tabs/TabsFrame'
import { HomePending } from '../../src/renderer/shared/Pending'
import { AEmpty } from './directions/a'
import { BEmpty } from './directions/b'
import { CPage } from './directions/c'
import { DPage } from './directions/d'
import { useLab } from './state'
import { LabWelcome } from './welcome/Welcome'
import { HOME } from './world'

/*
 * The start screen, as the start route has it in the lab (vite.config.ts's
 * seam): a home with no projects opens on the welcome the bar picks (1–4),
 * or with none (0), as the direction has it; this Mac, and a home with
 * projects, as the app has them.
 */

export function StartView(props: ComponentProps<typeof AppStartView>) {
  const { d, w } = useLab()
  const projects = props.model.projects
  if (!HOME.remote) return <AppStartView {...props} />
  if (projects === null) return <HomePending />
  if (projects.length > 0) return props.home()
  return (
    <div className={st.window}>
      <BareBar />
      {w !== '0' ? <LabWelcome key={w} /> : d === 'a' ? <AEmpty /> : d === 'b' ? <BEmpty /> : d === 'c' ? <CPage first /> : <DPage first />}
    </div>
  )
}
