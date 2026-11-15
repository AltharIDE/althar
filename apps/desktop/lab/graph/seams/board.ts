import type { BoardTask } from '@althar/contracts'
import { Wait } from '@althar/ui'

import { scenario, worldNow } from '../state'
import { graphOf } from '../view'

/*
 * What a task of the request says in Up next, where it waits for others:
 * the runtime holds it until they merge (DEV-228), and its row says for
 * which, after the board's own mark for after. Patched into BoardView's
 * Up next row; any other task says what it says today.
 */

const nodeOf = (work: BoardTask) => {
  const sc = scenario()
  const graph = graphOf(sc, worldNow())
  return graph.nodes.find((one) => one.slug === work.slug) ?? null
}

export const labWaitOf = (work: BoardTask): Wait | null => {
  const node = nodeOf(work)
  return node !== null && (node.stand === 'waits' || node.stand === 'stuck') ? Wait.After : null
}

export const labReasonOf = (work: BoardTask): string | null => {
  const node = nodeOf(work)
  return node !== null && (node.stand === 'waits' || node.stand === 'stuck') ? node.word : null
}
