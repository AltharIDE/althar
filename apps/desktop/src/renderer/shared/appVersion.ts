import { useQuery } from '@tanstack/react-query'

import { reads } from '../data/reads'
import { useServices } from '../data/services'

/**
 * This app's version, for what the window says of Althar itself (what's new, About): as this computer's runtime says it,
 * or, on another computer's home, whose runtime says the home's own release, as main handed it to the window.
 */
export const useAppVersion = (): string | undefined => {
  const { client, host } = useServices()
  const local = client.connection === undefined
  const status = useQuery({ ...reads(client).status(), enabled: local }).data
  return local ? status?.appVersion : host.appVersion
}
