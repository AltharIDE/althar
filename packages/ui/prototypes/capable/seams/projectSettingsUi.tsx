// Scrappy: the kit as a project's General settings see it here: a row an agent changed says who and when, with Undo; undone, it shows what it was.
import type { ComponentProps } from 'react'

import { BranchSelect as RealBranchSelect } from '../../../src/primitives/BranchSelect/BranchSelect'
import { Segmented as RealSegmented } from '../../../src/primitives/Segmented/Segmented'
import { SettingRow as RealSettingRow, SettingSwitch as RealSettingSwitch } from '../../../src/setup/Preferences/Preferences'
import { ChangedNote, changeOf } from '../directions/tune/Tune'
import { useProto } from '../state'

export * from '../../../src/index'

type P = ReturnType<typeof useProto>
const on = (p: P) => p.surface === 'tune' && p.direction !== 'Today'
const undone = (p: P, id: string) => p.off.includes(`undo:${id}`)

const noted = (note: ComponentProps<typeof RealSettingRow>['note'], title: unknown) => {
  const change = changeOf(title)
  if (change === undefined) return note
  return (
    <>
      {note}
      <ChangedNote change={change} />
    </>
  )
}

export function SettingRow(props: ComponentProps<typeof RealSettingRow>) {
  const p = useProto()
  return <RealSettingRow {...props} note={on(p) ? noted(props.note, props.title) : props.note} />
}

export function SettingSwitch(props: ComponentProps<typeof RealSettingSwitch>) {
  const p = useProto()
  if (!on(p) || changeOf(props.title) === undefined) return <RealSettingSwitch {...props} />
  // The lead turned conflicts on; undone, it's off again.
  return <RealSettingSwitch {...props} checked={!undone(p, changeOf(props.title)!.id)} note={noted(props.note, props.title)} />
}

export function Segmented<V extends string>(props: ComponentProps<typeof RealSegmented<V>>) {
  const p = useProto()
  if (!on(p) || props.label !== 'New tasks start in') return <RealSegmented {...props} />
  return <RealSegmented {...props} value={(undone(p, 'worksIn') ? 'checkout' : 'worktree') as V} />
}

export function BranchSelect(props: ComponentProps<typeof RealBranchSelect>) {
  const p = useProto()
  if (!on(p) || props.label !== 'Work toward') return <RealBranchSelect {...props} />
  return <RealBranchSelect {...props} value={undone(p, 'workToward') ? 'main' : 'next'} branches={['main', 'next', 'release/0.9']} />
}
