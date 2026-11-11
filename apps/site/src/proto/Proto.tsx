import { DesktopBody } from '../home/bodies/desktop/DesktopBody'
import { RunsOn } from '../home/bodies/RunsOn'
import { Hero } from '../home/Hero'
import home from '../home/Home.module.css'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { Bar, type Group, usePicks } from './Bar'
import { FLOW } from './flow'

/*
 * The developer page, with the part being chosen swapped in place: Fall in
 * love with building again, and the features it shows. In development only,
 * at /proto, and as one page to share (standalone/); nothing here ships.
 * Delete this folder, and DesktopBody's `trial`, once a direction is picked.
 */

const GROUPS: Group[] = [{ id: 'flow', label: 'Fall in love… (features)', target: 'flow', directions: FLOW }]

export function Proto() {
  const [picks, pick] = usePicks(GROUPS)
  const flow = FLOW.find((d) => d.key === picks.flow)!.value
  return (
    <div className={home.page} id="top">
      <Nav opening />
      <Hero nav={<NavSpace />} />
      <div className={home.night}>
        <RunsOn />
      </div>
      <DesktopBody key={picks.flow} trial={{ flow, after: { flow: flow.after } }} />
      <Footer />
      <Bar groups={GROUPS} picks={picks} pick={pick} />
    </div>
  )
}
