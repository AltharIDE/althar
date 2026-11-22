import { Cloud, Computer, HomeSimple, Server } from '../../../../packages/ui/node_modules/iconoir-react'

import { headless, type Worker } from './data'

/*
 * A picture in Computers, from the kit's own set (Iconoir), at the kit's
 * weight. Few on purpose: the home a house, every worker a computer (or, with
 * two kinds, a server where it has no screen of its own), the cloud a cloud.
 * The kit's Icon has none of a house, a desktop or a cloud yet; were these
 * picked, they would join foundations/Icon/icons.ts.
 */

export type Picture = 'home' | 'computer' | 'headless' | 'cloud'

const DRAWINGS = { home: HomeSimple, computer: Computer, headless: Server, cloud: Cloud } as const

/** A worker's picture: the home's house, else a computer, or a server where two kinds are told apart. */
export const pictureOf = (worker: Worker, twoKinds: boolean): Picture =>
  worker.home ? 'home' : twoKinds && headless(worker) ? 'headless' : 'computer'

/** The kit's stroke for a size, as Icon draws it. */
const stroke = (size: number) => Math.min(2.4, Math.max(1.5, (1.25 * 24) / size))

export function Glyph({ kind, size = 14, className }: { kind: Picture; size?: number; className?: string }) {
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
