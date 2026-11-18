import { BoardCard as RealCard, NextRow as RealRow, NextStep, NextSteps } from '@althar/ui'
import type { ComponentProps } from 'react'

import { MAYA_TITLE, TEAM_TASKS } from '../data'
import { useLab } from '../state'
import { Whose } from './team'

/*
 * A board card, and a row up next: whose work it is, where it is a
 * teammate's (C, E), from the branch and pull request it came from. In C
 * and E, Maya's change waits on Ana as Maya's ask, not as Ana's own work to
 * accept.
 */

const useTheirs = (title: string) => {
  const { d } = useLab()
  const theirs = TEAM_TASKS.find((one) => one.title === title)
  if (theirs?.by === undefined || (d !== 'c' && d !== 'e')) return null
  const says = title === MAYA_TITLE ? 'Maya’s · words only' : theirs.by === 'lee' ? 'Lee’s' : 'Sam’s intent, for anyone to pick up'
  return <Whose who={theirs.by} says={says} />
}

export function BoardCard(props: ComponentProps<typeof RealCard>) {
  const whose = useTheirs(props.title)
  if (whose === null) return <RealCard {...props} />
  if (props.title !== MAYA_TITLE) return <RealCard {...props} foot={whose} />
  // Maya's ask: its one way on opens what Ana approves from.
  return (
    <RealCard
      {...props}
      word="Maya asks you"
      foot={whose}
      next={
        <NextSteps>
          <NextStep signal onPress={props.onOpen}>
            Look and approve
          </NextStep>
        </NextSteps>
      }
    />
  )
}

export function NextRow(props: ComponentProps<typeof RealRow>) {
  const whose = useTheirs(props.title)
  if (whose === null) return <RealRow {...props} />
  return <RealRow {...props} foot={whose} />
}
