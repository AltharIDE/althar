/** The kit's icon set, as the lab's home glyphs take it straight (the kit itself names only its own icons). */
declare module 'iconoir-react' {
  import type { ComponentType, SVGProps } from 'react'
  type Drawing = ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number | string }>
  export const Laptop: Drawing
  export const LinkSlash: Drawing
  export const Server: Drawing
}
