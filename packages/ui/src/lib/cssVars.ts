import type { CSSProperties } from 'react'

/** Custom properties for a style prop. React's CSSProperties has no index for `--*` names; this is the one place that says they are fine. */
export const cssVars = (vars: Record<`--${string}`, string | number>): CSSProperties => vars as CSSProperties
