// Scrappy: "Agents at once" as a notched slider that warms past the default, on one plain page, no Storybook.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AgentsAtOnce, KeepAwake, SettingList } from '../../setup/Preferences/Preferences'
import '../../styles/global.css'
import './prototype.css'

/* A 16 GB Mac with 10 cores: four by default. */
const MACHINE = { count: 4, memory: 16, cores: 10 }

/* As it sits in Settings: under Keep awake. */
function InPlace({ start = MACHINE.count }: { start?: number }) {
  const [awake, setAwake] = useState(true)
  const [n, setN] = useState(start)
  return (
    <div className="sheet">
      <SettingList>
        <KeepAwake on={awake} onChange={setAwake} onBattery={false} onBatteryChange={() => {}} />
        <AgentsAtOnce count={n} machine={MACHINE} onChange={(next) => setN(next ?? MACHINE.count)} />
      </SettingList>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <div className="ch-root page">
    <header>
      <h1>Agents at once</h1>
      <p className="lede">This Mac: 16 GB and 10 cores, so 4 by default. Drag, click or use the arrow keys.</p>
    </header>
    <section>
      <h2>At the default</h2>
      <InPlace />
    </section>
    <section>
      <h2>Raised to 11</h2>
      <InPlace start={11} />
    </section>
  </div>,
)
