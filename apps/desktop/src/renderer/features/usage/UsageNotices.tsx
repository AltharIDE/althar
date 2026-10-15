import { UsageNotice } from '@althar/ui'

import { clock } from '../../shared/time'
import s from './Usage.module.css'
import { useOpenUsage, usePlanUsage, useSeen, windowWords } from './useUsage'

/**
 * The warnings the person has not seen, as notices at the foot of the
 * coordinator's thread they are looking at. They are Althar's own words, not
 * items of the thread and not a turn: they are drawn from what the window
 * reads of plan usage, and seeing one tells the runtime, which drops it from
 * every project's room and from the bar's count.
 */
export function UsageNotices() {
  const usage = usePlanUsage()
  const seen = useSeen()
  const open = useOpenUsage()
  const warnings = usage?.warnings ?? []
  if (warnings.length === 0) return null
  const now = new Date()
  return (
    <div className={s.notices}>
      {warnings.map((warning) => (
        <UsageNotice
          key={`${warning.accountId}:${warning.windowKey}`}
          account={`${warning.agentName} · ${warning.accountName}`}
          which={windowWords(warning)}
          left={warning.remainingPercent}
          until={warning.resetsAt === null ? null : clock(warning.resetsAt, now)}
          onSeen={() => void seen([warning])}
          onOpen={open}
        />
      ))}
    </div>
  )
}
