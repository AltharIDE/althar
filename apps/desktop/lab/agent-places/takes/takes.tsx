import { AgentsAtOnce, agentsAtOnceText, LinkButton } from '@althar/ui'

import lp from '../../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import { Bar, MacPeek, SplitBar } from '../parts'
import { words } from '../words'
import type { Ctx, Take } from './types'
import t from './takes.module.css'

/*
 * Three takes on This Mac, the popover the CPU and MEM meter opens. Each adds
 * one thing, drawn only with what the popover and the slider already use, and
 * nothing in the bar or on the board. Beside the slider, every take does the
 * same: where the number is lowered for now, its note says so and until when.
 *
 * A · a reading: Agents beside CPU and Memory, in their form.
 * B · the control: the slider itself in This Mac, its one line what is so now.
 * C · only when it matters: nothing at rest; one sentence while tasks wait or
 *     the number is lowered.
 */

/** Agents at once, the kit's own, untouched but for its note: lowered for now, and until when. */
export function Slider({ ctx, compact, line }: { ctx: Ctx; compact: boolean; line?: string }) {
  const { places } = ctx
  const lowered = words.lowered(places)
  return (
    <AgentsAtOnce
      compact={compact}
      count={places.configured}
      own={places.configured !== places.machine.count}
      machine={places.machine}
      most={ctx.most}
      onChange={ctx.setCount}
      text={{
        note: (n, machine) => (n === places.configured && lowered !== null ? lowered : agentsAtOnceText.note(n, machine)),
        short: line ?? lowered ?? agentsAtOnceText.short,
      }}
    />
  )
}

/* A · a reading ------------------------------------------------------------------------------------------- */

function AgentsReading({ ctx }: { ctx: Ctx }) {
  const { places, waiting } = ctx
  const lowered = words.lowered(places)
  const share = places.agents.length / Math.max(1, places.configured)
  return (
    <div className={lp.row}>
      <span className={lp.name}>{words.agents}</span>
      <span className={lp.figure}>{words.of(places)}</span>
      <SplitBar total={share} ours={share} />
      {lowered !== null && <span className={lp.work}>{lowered}</span>}
      {waiting.length > 0 && <span className={lp.work}>{words.waiting(waiting.length)}</span>}
    </div>
  )
}

export const A: Take = {
  key: 'a',
  kbd: 'a',
  label: 'A · A reading',
  idea: 'A · Agents beside CPU and Memory in This Mac, in their form',
  bar: (ctx) => (
    <Bar ctx={ctx}>
      <MacPeek ctx={ctx} reading={<AgentsReading ctx={ctx} />} />
    </Bar>
  ),
  slider: (ctx, compact) => <Slider ctx={ctx} compact={compact} />,
}

/* B · the control ----------------------------------------------------------------------------------------- */

export const B: Take = {
  key: 'b',
  kbd: 'b',
  label: 'B · The slider',
  idea: 'B · The slider itself in This Mac; its line says what is so now',
  bar: (ctx) => (
    <Bar ctx={ctx}>
      <MacPeek
        ctx={ctx}
        after={
          <div className={t.atOnce}>
            <Slider ctx={ctx} compact line={words.live(ctx.places, ctx.waiting.length)} />
          </div>
        }
      />
    </Bar>
  ),
  slider: (ctx, compact) => <Slider ctx={ctx} compact={compact} />,
}

/* C · only when it matters -------------------------------------------------------------------------------- */

function Sentence({ ctx }: { ctx: Ctx }) {
  const said = words.sentence(ctx.places, ctx.waiting.length)
  if (said === null) return null
  // All at work and nothing lowered: more at once is the way, in place, in the quick settings.
  const more = ctx.places.atOnce === ctx.places.configured
  return (
    <p className={`${lp.state} ${t.state}`}>
      {said}
      {more && (
        <>
          {' '}
          <LinkButton
            onClick={() => {
              ctx.peek.set(false)
              ctx.quick.set(true)
            }}
          >
            {words.allowMore}
          </LinkButton>
        </>
      )}
    </p>
  )
}

export const C: Take = {
  key: 'c',
  kbd: 'c',
  label: 'C · Only when it matters',
  idea: 'C · Nothing at rest; one sentence in This Mac while tasks wait or the number is lowered',
  bar: (ctx) => (
    <Bar ctx={ctx}>
      <MacPeek ctx={ctx} after={<Sentence ctx={ctx} />} />
    </Bar>
  ),
  slider: (ctx, compact) => <Slider ctx={ctx} compact={compact} />,
}
