import {
  ChatBubble,
  CursorPointer,
  DragHandGesture,
  EditPencil,
  GitCommit,
  Link,
  MultiplePages,
  NavArrowDown,
  Repository,
  ShareIos,
  Square,
  ViewGrid,
  ZoomIn,
} from '../../../../../packages/ui/node_modules/iconoir-react'

/*
 * Glyphs the kit's icon set doesn't name yet (foundations/Icon/icons.ts),
 * drawn as the kit's Icon draws: Iconoir, its stroke set to land near
 * 1.25px at any size. Building it for real, they join the kit's set.
 */

const DRAWINGS = {
  everyBoard: ViewGrid,
  oneBoard: Square,
  point: CursorPointer,
  move: DragHandGesture,
  mark: EditPencil,
  comment: ChatBubble,
  share: ShareIos,
  link: Link,
  pages: MultiplePages,
  zoom: ZoomIn,
  down: NavArrowDown,
  repo: Repository,
  commit: GitCommit,
} as const
export type GlyphName = keyof typeof DRAWINGS

const stroke = (size: number) => Math.min(2.4, Math.max(1.5, (1.25 * 24) / size))

export function Glyph({ name, size = 14 }: { name: GlyphName; size?: number }) {
  const Drawing = DRAWINGS[name]
  return <Drawing width={size} height={size} strokeWidth={stroke(size)} style={{ flex: 'none' }} aria-hidden="true" focusable="false" />
}
