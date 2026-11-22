import { Cloud, Computer, Cpu, HomeSimple, Laptop, Server } from '../../../../packages/ui/node_modules/iconoir-react'

import type { Kind } from './data'

/*
 * A computer's picture, from the kit's own set (Iconoir), at the kit's
 * weight: the kit's Icon has a laptop for this computer and a server for a
 * home, and nothing yet for a Mac mini, a GPU box, Althar Cloud or a home as
 * a house. Were one picked, these would join foundations/Icon/icons.ts.
 */

const DRAWINGS = { laptop: Laptop, desktop: Computer, server: Server, gpu: Cpu, cloud: Cloud, home: HomeSimple } as const

/** The kit's stroke for a size, as Icon draws it. */
const stroke = (size: number) => Math.min(2.4, Math.max(1.5, (1.25 * 24) / size))

export function Glyph({ kind, size = 14, className }: { kind: Kind | 'home'; size?: number; className?: string }) {
  const Drawing = DRAWINGS[kind]
  return (
    <Drawing
      width={size}
      height={size}
      strokeWidth={stroke(size)}
      style={{ flex: 'none' }}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  )
}
