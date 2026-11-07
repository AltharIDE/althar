// Scrappy: the change card Outputs draws, swapped for the direction's where the task has several repositories; one repository's is today's, untouched.
import { useContext } from 'react'

import { ChangeState } from '../../../src/foundations/vocabulary'
import { ChangeSet as Today, type ChangeSetProps } from '../../../src/outputs/ChangeSet/ChangeSet'
import { CardA } from '../directions/A'
import { CardB } from '../directions/B'
import { CardC } from '../directions/C'
import { Showing } from '../parts'
import { useProto } from '../state'

const CARDS = { A: CardA, B: CardB, C: CardC }

export function ChangeSet(props: ChangeSetProps) {
  const store = useProto()
  const shown = useContext(Showing)
  const { direction, scenario, repos } = shown ?? store
  if (direction === 'Today' || repos.length <= 1) return <Today {...props} />
  // A repository with no pull request yet, as its host isn't connected, is one of the change's own, not a card of its own.
  if (props.state === ChangeState.Branch) return null
  const Card = CARDS[direction]
  const { onOpenFile, onReviewDiff } = props
  return (
    <Card
      scenario={scenario}
      repos={repos}
      {...(props.review === undefined ? {} : { review: props.review })}
      {...(onOpenFile === undefined ? {} : { onOpenFile: (path?: string) => (path === undefined ? onReviewDiff?.() : onOpenFile(path)) })}
      {...(props.diffKey === undefined ? {} : { diffKey: props.diffKey })}
      label={props.text?.label ?? 'The change'}
    />
  )
}
