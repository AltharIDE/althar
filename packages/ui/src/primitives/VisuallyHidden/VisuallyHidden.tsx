import { VisuallyHidden as V } from 'radix-ui'
import type { ReactNode } from 'react'

/** Text for screen readers only. Radix's, so it matches what its own parts hide. As a legend, it names a fieldset without showing. */
export function VisuallyHidden({ children, as }: { children: ReactNode; as?: 'legend' }) {
  if (as === 'legend')
    return (
      <V.Root asChild>
        <legend>{children}</legend>
      </V.Root>
    )
  return <V.Root>{children}</V.Root>
}
