// Scrappy: what a task made, as Outputs draws it; in B, inside where it stands.
import { type ComponentProps, useContext } from 'react'

import { WhatItMade as Built } from '../../../src/index'
import { Standing } from '../directions/B'
import { useProto } from '../state'
import { OutputsOf } from './Outputs'

export function WhatItMade(props: ComponentProps<typeof Built>) {
  const { direction } = useProto()
  const snapshot = useContext(OutputsOf)
  if (direction !== 'B' || snapshot === null) return <Built {...props} />
  return <Standing snapshot={snapshot} made={<Built {...props} />} />
}
