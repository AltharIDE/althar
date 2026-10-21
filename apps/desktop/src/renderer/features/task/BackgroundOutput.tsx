import { useQuery } from '@tanstack/react-query'

import { ActionButton, Dialog, Terminal } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import { linesOf } from '../../shared/handed'

/*
 * What a command the lead left running has printed so far, over the window:
 * where it has no address to open, it is the only way to see what it does.
 * Read again while it is open, as the command keeps printing.
 */

export const text = {
  close: 'Close',
  title: (name: string) => `Output of ${name}`,
}

/** How often what it printed is read again while it is shown. */
const EVERY = 1_500

export interface BackgroundOutputProps {
  readonly threadId: string
  readonly id: string
  /** What the person calls it: its name, else the command at a glance. */
  readonly name: string
  readonly command: string
  readonly onClose: () => void
}

export function BackgroundOutput({ threadId, id, name, command, onClose }: BackgroundOutputProps) {
  const { client } = useServices()
  const read = useQuery({
    queryKey: ['background-output', threadId, id],
    queryFn: () => client.readBackgroundOutput(threadId, id),
    refetchInterval: EVERY,
    gcTime: 0,
  })
  const { lines, earlier } = linesOf(read.data?.text ?? '')
  return (
    <Dialog title={text.title(name)} width={640} onClose={onClose} actions={<ActionButton onClick={onClose}>{text.close}</ActionButton>}>
      {read.isError && read.data === undefined ? (
        <Terminal command={command} lines={[]} error={messageOf(read.error)} />
      ) : read.data === undefined ? (
        <Terminal command={command} lines={[]} loading />
      ) : (
        <Terminal command={command} lines={[...lines]} earlier={[...earlier]} live="" />
      )}
    </Dialog>
  )
}
