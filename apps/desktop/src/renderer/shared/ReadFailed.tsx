import { Button, Problem } from '@althar/ui'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'

/** Said by a screen whose first read failed. */
export const readFailedText = { again: 'Try again' }

/**
 * What a screen shows where it couldn't read what it draws: the problem on
 * its own, and Try again, which reads again whatever failed. A read that
 * failed can work a moment later, as the runtime comes back.
 */
export function ReadFailed({ error, className }: { error: string; className?: string }) {
  const queries = useQueryClient()
  const failed = { type: 'active', predicate: (query: { state: { status: string } }) => query.state.status === 'error' } as const
  // Busy at once, from the press, while what failed is read again.
  const reading = useIsFetching(failed) > 0
  const again = () => void queries.refetchQueries(failed)
  return (
    <Problem
      banner
      {...(className === undefined ? {} : { className })}
      action={
        <Button size="small" busy={reading} onClick={again}>
          {readFailedText.again}
        </Button>
      }
    >
      {error}
    </Problem>
  )
}
