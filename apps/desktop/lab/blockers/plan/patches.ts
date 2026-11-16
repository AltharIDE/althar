import { join } from 'node:path'

import type { Patch } from '../patching'

/*
 * Lines patched into the kit's plan card (TaskLaunch), each where a plan
 * that waits for other tasks says so in the look picked (seams.tsx): the
 * line under its title, rows before its lead, its roster folded, and its foot.
 */

const here = import.meta.dirname
const launch = join(here, '../../../../../packages/ui/src/coordinator/TaskLaunch/TaskLaunch.tsx')

export const PLAN_PATCHES: ReadonlyArray<Patch> = [
  { file: launch, from: '', to: `import { LabFoot, LabRows, LabUnderTitle, useLabLaunch } from '${join(here, 'seams.tsx')}'\n` },
  // Whether it waits for other tasks, and the look picked.
  {
    file: launch,
    from: '  const [held, setHeld] = useControlled(heldProp, defaultHeld, onHeldChange)\n',
    to: '  const [held, setHeld] = useControlled(heldProp, defaultHeld, onHeldChange)\n  const lab = useLabLaunch(task, drafting !== undefined)\n',
  },
  // Under its title, as where it works is said.
  {
    file: launch,
    from: '          {where !== null && <p className={s.whereLine}>{where}</p>}\n',
    to: '          {where !== null && <p className={s.whereLine}>{where}</p>}\n          {lab !== null && <LabUnderTitle lab={lab} steps={steps} />}\n',
  },
  // Rows before its lead's, drawn as its own rows are; and its roster folded away.
  {
    file: launch,
    from: '        <ol className={s.roster}>\n',
    to: "        <ol className={s.roster} style={lab?.folded === true ? { display: 'none' } : undefined}>\n          {lab !== null && <LabRows lab={lab} Row={Row} Node={Node} />}\n",
  },
  // Its foot.
  {
    file: launch,
    from: '        {drafting !== undefined ? (\n          <div className={s.foot}>',
    to: '        {lab !== null ? (\n          <LabFoot lab={lab} held={held} onHold={() => setHeld(true)} onStart={start} estimate={estimate} />\n        ) : drafting !== undefined ? (\n          <div className={s.foot}>',
  },
]
