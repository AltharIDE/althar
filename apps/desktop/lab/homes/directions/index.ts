import type { Direction } from '../state'
import { a } from './a'
import { b } from './b'
import { c } from './c'
import { d } from './d'
import { pr } from './pr'
import type { DirectionParts } from './types'

export const PARTS: Record<Direction, DirectionParts> = { pr, a, b, c, d }
