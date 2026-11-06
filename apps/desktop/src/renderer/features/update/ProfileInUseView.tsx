import { ProfileInUse } from '@althar/ui/screens'

import type { Host, StoreFailure } from '../../data/services'
import { useHostChrome } from '../../shared/useWindowChrome'

/*
 * What the window shows instead of opening when another Althar, or the
 * command line, has the profile open (main says so; nothing else of Althar
 * runs): the kit's page, with a way to try again once that one is closed.
 */
export function ProfileInUseView({ failure, host }: { readonly failure: StoreFailure; readonly host: Host }) {
  const chrome = useHostChrome(host)
  return <ProfileInUse reason={failure.reason} onTryAgain={() => void host.tryAgain()} {...chrome} />
}
