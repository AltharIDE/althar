import { ApiVersionMismatch } from '@althar/ui/screens'

import type { Host } from '../../data/services'
import { useHostChrome } from '../../shared/useWindowChrome'

/*
 * What the window shows instead of opening when the runtime serves another
 * API version than the window speaks (the runtime refused it): the kit's
 * page, naming both, with a way to try again.
 */
export function ApiVersionMismatchView({
  windowVersion,
  runtimeVersion,
  host,
}: {
  readonly windowVersion: number | null
  readonly runtimeVersion: number
  readonly host: Host
}) {
  const chrome = useHostChrome(host)
  return (
    <ApiVersionMismatch
      windowVersion={windowVersion}
      runtimeVersion={runtimeVersion}
      onTryAgain={() => window.location.reload()}
      {...chrome}
    />
  )
}
