// Scrappy: each direction's control, drawn where the one Run button was, on the project's front and in a task's bar.
import type { ComponentType } from 'react'

import type { Direction } from '../state'
import { A } from './A'
import { B } from './B'
import { C } from './C'
import { D } from './D'
import { E } from './E'

export const CONTROLS: Record<Exclude<Direction, 'Today'>, ComponentType> = { A, B, C, D, E }
