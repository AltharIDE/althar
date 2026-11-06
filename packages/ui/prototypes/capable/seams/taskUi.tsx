// Scrappy: the kit as the task's screen sees it here. For a task's parts, its faces sit beside Run, so neither moves as parts come and go; each direction puts the parts somewhere of their own.
import { Children, type ComponentProps, isValidElement, type ReactElement, type ReactNode } from 'react'

import { BackCrumb as RealBackCrumb } from '../../../src/chrome/BackCrumb/BackCrumb'
import { TaskHeader as RealTaskHeader } from '../../../src/chrome/TaskHeader/TaskHeader'
import { TitleBar as RealTitleBar } from '../../../src/chrome/TitleBar/TitleBar'
import { Segmented } from '../../../src/primitives/Segmented/Segmented'
import { PartsAfterTitle, PartsButton, partsOf, PartsRail, PartsRow, RailButton } from '../directions/parts/Parts'
import s from '../directions/parts/parts.module.css'
import { proto, useProto } from '../state'

export * from '../../../src/index'

type P = ReturnType<typeof useProto>
const on = (p: P) => p.surface === 'parts' && p.direction !== 'Today'
const parts = () => partsOf(window.location.hash)

/** The bar's own buttons, as the screen made them: what it changed (the files) goes into the worktree part; Run and the menu stay. */
const split = (actions: ReactNode) => {
  const all = isValidElement<{ children?: ReactNode }>(actions) ? Children.toArray(actions.props.children) : [actions]
  return all.filter((one) => !(isValidElement<{ icon?: string }>(one) && one.props.icon === 'file')) as ReactElement[]
}

export function TaskHeader<F extends string>(props: ComponentProps<typeof RealTaskHeader<F>>) {
  const p = useProto()
  if (!on(p) || props.faces === undefined || props.face === undefined || props.onFace === undefined) return <RealTaskHeader {...props} />
  const { faces, face, onFace, ...rest } = props
  return (
    <RealTaskHeader
      {...rest}
      actions={
        <>
          {p.direction === 'C' && <PartsButton parts={parts()} />}
          {p.direction === 'D' && <RailButton parts={parts()} open={p.rail} onToggle={() => proto.set({ rail: !p.rail })} />}
          <Segmented label="Face" options={[...faces]} value={face} onChange={onFace} className={s.faces} />
          {split(props.actions)}
        </>
      }
    />
  )
}

/** A: the parts follow the task's title. */
export function BackCrumb(props: ComponentProps<typeof RealBackCrumb>) {
  const p = useProto()
  if (!on(p) || p.direction !== 'A') return <RealBackCrumb {...props} />
  return (
    <>
      <RealBackCrumb {...props} />
      <PartsAfterTitle parts={parts()} />
    </>
  )
}

/** B: a row under the bar; D: the rail beside the thread, hung from under the bar. */
export function TitleBar(props: ComponentProps<typeof RealTitleBar>) {
  const p = useProto()
  if (!on(p) || (p.direction !== 'B' && p.direction !== 'D')) return <RealTitleBar {...props} />
  return (
    <>
      <RealTitleBar {...props} />
      {p.direction === 'B' && <PartsRow parts={parts()} />}
      {p.direction === 'D' && p.rail && <PartsRail parts={parts()} onClose={() => proto.set({ rail: false })} />}
    </>
  )
}
