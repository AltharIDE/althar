import { useCallback, useState } from 'react'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import type { ClosingPullRequests } from './BoardView'

/*
 * Closing a settled task's pull request still open on its host, from its row
 * on the board: an abandoned task's left open, one press each. Only the
 * pull request goes; its branch on the host stays. What the host refused is
 * said on the row, and the row still says it is open, as it is.
 */
export const useClosePullRequests = (): ClosingPullRequests => {
  const { client } = useServices()
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<ClosingPullRequests['failed']>(null)
  const close = useCallback(
    (taskId: string, url: string) => {
      setBusy(taskId)
      setFailed(null)
      client
        .closePullRequest({ taskId, url, deleteBranch: false })
        .catch((failure: unknown) => setFailed({ taskId, message: messageOf(failure) }))
        .finally(() => setBusy(null))
    },
    [client],
  )
  return { busy, failed, close }
}
