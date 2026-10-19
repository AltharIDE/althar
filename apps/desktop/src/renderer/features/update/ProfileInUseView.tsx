import { ProfileInUse } from '@althar/ui/screens'

import type { Host, StoreFailure } from '../../data/services'
import { useMaximized } from '../../shared/useWindowChrome'

/*
 * What the window shows instead of opening when another Althar, or the
 * command line, has the profile open (main says so; nothing else of Althar
 * runs): the kit's page, with a way to try again once that one is closed.
 */
export function ProfileInUseView({ failure, host }: { readonly failure: StoreFailure; readonly host: Host }) {
  const maximized = useMaximized(host)
  const darwin = host.platform === 'darwin'
  return (
    <ProfileInUse
      reason={failure.reason}
      onTryAgain={() => void host.tryAgain()}
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
    />
  )
}
