import { AgentsAtOnce, ChromeButton, LoadMeter, PlanGauge } from '@althar/ui'

import { CLAUDE_PLENTY, CODEX_PLENTY } from '../../../../../packages/ui/src/fixtures/plan'
import { text as settingsText } from '../../../src/renderer/features/settings/text'
import { SLOTS } from '../data'
import type { Direction } from './types'

/* 0 · As built: the board's own banner over Up next (BoardView's AgentPlaces); the bar (Homes, CPU and MEM, plan usage) and the slider as they are. */
export const ZERO: Direction = {
  key: '0',
  kbd: '0',
  label: 'As built',
  idea: 'The board’s banner over Up next; the bar and the slider as they are',
  bar: (ctx) => (
    <>
      <ChromeButton icon="plug" label="Homes" compact />
      <LoadMeter load={ctx.load} slots={SLOTS} onOpen={() => undefined} onHide={() => undefined} />
      <PlanGauge agents={[CLAUDE_PLENTY, CODEX_PLENTY]} />
    </>
  ),
  quick: (ctx) => (
    <AgentsAtOnce
      compact
      count={ctx.count}
      own={ctx.places.own}
      machine={ctx.places.machine}
      most={ctx.most}
      onChange={ctx.setCount}
      text={{ value: settingsText.atOnceValue }}
    />
  ),
  settings: (ctx) => (
    <AgentsAtOnce
      count={ctx.count}
      own={ctx.places.own}
      machine={ctx.places.machine}
      most={ctx.most}
      onChange={ctx.setCount}
      text={{ note: settingsText.atOnceNote, mark: settingsText.atOnceMark, value: settingsText.atOnceValue }}
    />
  ),
}
