import { RunButton as KitRunButton, type RunButtonProps } from '@althar/ui'

import { useLab } from './state'
import { openTerminal } from './terminal'

/** Run's button, as the app draws it: in every direction but today's, its list opens a terminal too. */
export function RunButton(props: RunButtonProps) {
  const { d } = useLab()
  return <KitRunButton {...props} {...(d === 'today' ? {} : { onTerminal: () => openTerminal() })} />
}
