// Scrappy: the kit as the task's screen sees it here: in the sketches, its header carries its parts, with + Add.
import type { ComponentProps } from 'react'

import { TaskHeader as RealTaskHeader } from '../../../src/chrome/TaskHeader/TaskHeader'
import { Parts } from '../directions/parts/Sketches'
import { useProto } from '../state'

export * from '../../../src/index'

export function TaskHeader<F extends string>(props: ComponentProps<typeof RealTaskHeader<F>>) {
  const p = useProto()
  if (p.surface !== 'parts') return <RealTaskHeader {...props} />
  const review = window.location.hash.includes('th-review')
  return (
    <RealTaskHeader
      {...props}
      actions={
        <>
          <Parts review={review} />
          {props.actions}
        </>
      }
    />
  )
}
