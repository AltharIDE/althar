import { VisuallyHidden as V } from 'radix-ui'
import type { ReactNode } from 'react'

/**
 * Text for screen readers only. Radix's, so it matches what its own parts hide. As a legend, it names a fieldset without
 * showing; with an id, it can describe something else (`aria-describedby`).
 */
export function VisuallyHidden({ children, as, id }: { children: ReactNode; as?: 'legend'; id?: string }) {
  if (as === 'legend')
    return (
      <V.Root asChild>
        <legend id={id}>{children}</legend>
      </V.Root>
    )
  return <V.Root id={id}>{children}</V.Root>
}
