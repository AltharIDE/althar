// Scrappy: the kit as the task's screen sees it here. For a task's parts, one Parts button just before the faces, which sit beside Run, so nothing moves as parts come and go; each direction is a look for it.
import { Children, type ComponentProps, isValidElement, type ReactElement, type ReactNode } from 'react'

import { TaskHeader as RealTaskHeader } from '../../../src/chrome/TaskHeader/TaskHeader'
import { Segmented } from '../../../src/primitives/Segmented/Segmented'
import { PartsButton, partsOf } from '../directions/parts/Parts'
import s from '../directions/parts/parts.module.css'
import { useProto } from '../state'

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
          <PartsButton parts={parts()} />
          <Segmented label="Face" options={[...faces]} value={face} onChange={onFace} className={s.faces} />
          {split(props.actions)}
        </>
      }
    />
  )
}
