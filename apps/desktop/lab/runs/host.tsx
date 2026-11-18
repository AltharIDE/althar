import { Workbench } from '@althar/ui'

import { useThreadHost as useRealHost } from '../../src/renderer/shared/ThreadHost'
import { BesidePanel } from './Beside'
import { useLab } from './state'
import { useWorld } from './world'

/*
 * The project's screen's thread host, as the lab gives it (vite.config.ts's
 * seam): the app's own, but in A, while a run or a terminal is open, its
 * workbench holds that, sized and placed as the app places a file or a page:
 * beside the thread, or over the board from the conversation's edge.
 */

export * from '../../src/renderer/shared/ThreadHost'

export const useThreadHost: typeof useRealHost = (...args) => {
  const host = useRealHost(...args)
  const { d } = useLab()
  const state = useWorld()
  if (d !== 'a' || !state.open || state.focus === null) return host
  return {
    ...host,
    workbench: (_docPanel, over) => {
      const bench = host.bench
      const whole = over !== undefined && bench.width > over.room - over.keep
      const max = over === undefined ? bench.max : whole ? over.room : over.room - over.keep
      const width = whole ? max : Math.min(bench.width, max)
      return (
        <Workbench
          width={width}
          min={whole ? max : bench.min}
          max={max}
          onWidth={bench.set}
          onCommit={bench.keep}
          onReset={bench.reset}
          edge={over === undefined ? 'start' : (over.edge ?? 'end')}
          {...(over?.className === undefined ? {} : { className: over.className })}
          {...(over?.style === undefined ? {} : { style: { ...over.style, width } })}
        >
          <BesidePanel />
        </Workbench>
      )
    },
  }
}
