import { Usage } from '@althar/ui'

import { useUsage } from './useUsage'

/** Plan usage over the window, for every account of every agent, until it closes. */
export function UsageView({ onClose }: { onClose: () => void }) {
  const model = useUsage()
  return (
    <Usage
      groups={model.groups}
      reading={model.reading}
      {...(model.error === null ? {} : { error: model.error })}
      onRefresh={model.refresh}
      onClose={onClose}
    />
  )
}
