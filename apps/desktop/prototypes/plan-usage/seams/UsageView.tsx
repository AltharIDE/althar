// Scrappy: what ⌘U opens. Ninemate's: the usage view, as built. A: nothing here, the chip's popover opens instead. B: the model picker of the composer on screen. C: Settings › Agents, where every account shows its usage.
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { UsageView as Built } from '../../../src/renderer/features/usage/UsageView'
import { useProto } from '../store'

export function UsageView({ onClose }: { onClose: () => void }) {
  const { d } = useProto()
  const navigate = useNavigate()
  useEffect(() => {
    if (d === 'B') {
      const chip = document.querySelector<HTMLButtonElement>('form button[aria-label^="Lead:"], form button[aria-label^="Coordinator:"]')
      chip?.click()
      onClose()
    }
    if (d === 'C') {
      void navigate({ to: '/settings/$section', params: { section: 'agents' } })
      onClose()
    }
  }, [d, navigate, onClose])
  return d === 'N' ? <Built onClose={onClose} /> : null
}
