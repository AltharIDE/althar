import { DataNotMoved } from '@althar/ui/screens'

import type { Host, StoreFailure } from '../../data/services'
import { deviceWords } from '../../shared/device'
import { useMaximized } from '../../shared/useWindowChrome'

/*
 * What the window shows instead of opening when an update couldn't move the
 * store (main says so; nothing else of Althar runs): the kit's page, with
 * this system's file manager to show the copy in, and Report this once the
 * app can send a report (`Host.reportProblem`), with what stopped the update.
 */
export function UpdateStoppedView({
  failure,
  host,
}: {
  readonly failure: Exclude<StoreFailure, { readonly stopped: 'held' }>
  readonly host: Host
}) {
  const { reportProblem } = host
  const maximized = useMaximized(host)
  const darwin = host.platform === 'darwin'
  return (
    <DataNotMoved
      stopped={failure.stopped}
      backup={failure.backup}
      reason={failure.reason}
      onShowBackup={() => void host.showBackup()}
      {...(reportProblem === undefined ? {} : { onReport: () => reportProblem({ kind: 'update', reason: failure.reason }) })}
      lights={darwin ? 'space' : 'drawn'}
      {...(darwin
        ? {}
        : {
            window: {
              onClose: () => host.window('close'),
              onMinimize: () => host.window('minimize'),
              onToggleMaximize: () => host.window('toggle-maximize'),
              maximized,
            },
          })}
      text={{ show: `Show in ${deviceWords(host.platform).files}` }}
    />
  )
}
