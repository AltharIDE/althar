import { ProjectHeader as Real } from '@althar/ui'
import type { ComponentProps } from 'react'

import { whoIsHere } from '../data'
import { useLab } from '../state'
import { TeamChip } from './team'

/*
 * The project's row: in E, the team beside how it runs, one chip of faces.
 * For Maya, a designer, nothing of branches or runs: the app runs beside her
 * conversation from the first minute.
 */
export function ProjectHeader(props: ComponentProps<typeof Real>) {
  const { d } = useLab()
  if (whoIsHere() === 'maya') return <Real {...props} run={null} />
  if (d === 'e')
    return (
      <Real
        {...props}
        run={
          <>
            <TeamChip />
            {props.run}
          </>
        }
      />
    )
  return <Real {...props} />
}
