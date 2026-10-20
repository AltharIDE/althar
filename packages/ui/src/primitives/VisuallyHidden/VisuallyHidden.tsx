import { VisuallyHidden as V } from 'radix-ui'
import type { ReactNode } from 'react'

/**
 * Text for screen readers only. Radix's, so it matches what its own parts hide. As a legend, it names a fieldset
 * without showing. With an id, it is what a control's name or description points at (aria-labelledby, aria-describedby).
 */
export function VisuallyHidden({ children, as, id }: { children: ReactNode; as?: 'legend'; id?: string }) {
  if (as === 'legend')
    return (
      <V.Root asChild id={id}>
        <legend>{children}</legend>
      </V.Root>
    )
  return <V.Root id={id}>{children}</V.Root>
}
