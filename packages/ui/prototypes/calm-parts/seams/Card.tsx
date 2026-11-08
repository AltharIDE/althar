// Scrappy: the plan card, as the coordinator shows it before a task runs, naming the preset it starts from: the one place a preset
// shows (the person's call). It is the kicker's first word, in the kicker's own type, as a board card names a task's kind; it opens
// only on a press, and on hover shows it can. Picking another changes the plan's starting parts: its steps and how it ends. Once it runs, a task's parts are
// what it has, and the preset is gone from it.
import { useState } from 'react'

import { TaskEnd } from '../../../src/foundations/vocabulary'
import { TaskLaunch as RealTaskLaunch, type TaskLaunchProps, type TaskLaunchText } from '../../../src/coordinator/TaskLaunch/TaskLaunch'
import { Menu, MenuItem } from '../../../src/primitives/Menu/Menu'
import { css } from '../parts'
import { proto } from '../state'

type PlanPreset = 'Change' | 'Small change' | 'Review a PR' | 'Prototype'

/** What each preset starts a task with, as the plan shows it: its steps, how it ends, and in a line what it holds. */
const PRESETS: Record<PlanPreset, { steps: ReadonlyArray<string>; end: TaskEnd; holds: string }> = {
  Change: { steps: ['implement', 'review'], end: TaskEnd.DraftPr, holds: 'A worktree, reviewed before it ships, a draft pull request' },
  'Small change': {
    steps: ['implement'],
    end: TaskEnd.ReadyPr,
    holds: 'A worktree, reviewed after it merges, a pull request ready to merge',
  },
  'Review a PR': { steps: ['review'], end: TaskEnd.PushOnly, holds: 'A copy at its head, a review drafted for you to post' },
  Prototype: {
    steps: ['implement'],
    end: TaskEnd.PushOnly,
    holds: 'Claude Opus 5.5 at xhigh, reviewed only once it ships, no pull request',
  },
}
const NAMES = Object.keys(PRESETS) as ReadonlyArray<PlanPreset>

function PresetChip({ value, onChange }: { value: PlanPreset; onChange: (to: PlanPreset) => void }) {
  return (
    <Menu
      label="Preset"
      align="start"
      width={340}
      note="Sets what it starts with. Once it runs, its parts are what it has."
      trigger={
        <button type="button" className={css.presetWord} aria-label={`Preset: ${value}`}>
          {value}
        </button>
      }
    >
      {NAMES.map((one) => (
        <MenuItem
          key={one}
          {...(one === value ? { icon: 'check' as const } : {})}
          description={PRESETS[one].holds}
          onSelect={() => onChange(one)}
        >
          {one}
        </MenuItem>
      ))}
    </Menu>
  )
}

export function TaskLaunch(props: TaskLaunchProps) {
  const start = proto.current().preset
  const [preset, setPreset] = useState<PlanPreset>(start in PRESETS ? (start as PlanPreset) : 'Change')
  const [end, setEnd] = useState<TaskEnd>(PRESETS[preset].end)
  const pick = (to: PlanPreset) => {
    setPreset(to)
    setEnd(PRESETS[to].end)
  }
  const steps = (props.steps ?? []).filter((step) => PRESETS[preset].steps.includes(step.id))
  // The kicker names the preset, before the task: the card's own words otherwise.
  const task = ((slug: string) => (
    <>
      <PresetChip value={preset} onChange={pick} /> · Task {slug}
    </>
  )) as unknown as TaskLaunchText['task']
  return (
    <RealTaskLaunch
      {...props}
      steps={steps}
      {...(props.hideEnd === true ? {} : { end, onEndChange: setEnd })}
      text={{ ...props.text, task }}
    />
  )
}
