import { AgentsAtOnce, ChromeButton, LoadMeter, PlanGauge } from '@althar/ui'

import { CLAUDE_PLENTY, CODEX_PLENTY } from '../../../../../packages/ui/src/fixtures/plan'
import { SLOTS } from '../data'
import type { Take } from './types'

/* 0 · As built: the board's banner over Up next; Homes, CPU and MEM, plan usage, and the slider as they are. */
export const ZERO: Take = {
  key: '0',
  kbd: '0',
  label: 'As built',
  idea: 'As built: the banner over Up next; the bar and the slider as they are, and no other workers anywhere',
  opens: 'peek',
  bar: (ctx) => (
    <>
      <ChromeButton icon="plug" label="Homes" compact onClick={() => ctx.say('Opens the homes menu, as it is')} />
      <LoadMeter load={ctx.load} slots={SLOTS} onOpen={ctx.onOpen} onHide={() => undefined} />
      <PlanGauge agents={[CLAUDE_PLENTY, CODEX_PLENTY]} />
    </>
  ),
  slider: (ctx, compact) => (
    <AgentsAtOnce
      compact={compact}
      count={ctx.here.configured}
      own={ctx.here.configured !== ctx.here.machine.count}
      machine={ctx.here.machine}
      most={ctx.most}
      onChange={(n) => ctx.setCount(ctx.here.id, n)}
    />
  ),
}
