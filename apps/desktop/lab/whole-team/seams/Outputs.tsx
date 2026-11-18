import type { ComponentProps } from 'react'

import { Outputs as Real } from '../../../src/renderer/features/task/Outputs'
import { MAYA_TITLE } from '../data'
import { useLab } from '../state'
import { Evidence } from './team'

export * from '../../../src/renderer/features/task/Outputs'

/* A task's outputs: in C, Maya's change as Ana reads it, from its evidence; the diff a press away. */
export function Outputs(props: ComponentProps<typeof Real>) {
  const { d } = useLab()
  if (d === 'c' && props.snapshot.task.title === MAYA_TITLE) return <Evidence />
  return <Real {...props} />
}
