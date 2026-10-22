// Scrappy: what ⌘U opens. Ninemate's: the usage view, as built. A to C: nothing here; the bar's own peek opens instead (the Usage button's open state, which ⌘U toggles, drives it).
import { UsageView as Built } from '../../../src/renderer/features/usage/UsageView'
import { useProto } from '../store'

export function UsageView({ onClose }: { onClose: () => void }) {
  const { d } = useProto()
  return d === 'N' ? <Built onClose={onClose} /> : null
}
