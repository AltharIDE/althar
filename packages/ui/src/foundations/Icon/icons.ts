import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Attachment,
  Book,
  ChatBubble,
  Check,
  Clock,
  Community,
  Compress,
  Copy,
  Edit,
  EditPencil,
  Folder,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  LightBulb,
  List,
  Lock,
  LongArrowDownLeft,
  MediaImage,
  Microphone,
  NavArrowDown,
  NavArrowRight,
  OpenNewWindow,
  Page,
  PageMinus,
  PagePlus,
  PageRight,
  Pause,
  Pin,
  Plus,
  Prohibition,
  Quote,
  Search,
  ServerConnection,
  Settings,
  Square,
  TaskList,
  Terminal,
  Tools,
  Xmark,
} from 'iconoir-react'
import { type ComponentType, createElement, type SVGProps } from 'react'

/*
 * One icon set, one optical weight: Iconoir (MIT), outlined, round caps. The
 * names here are what an icon means in Althar, not what it draws, so a
 * component asks for `pr` and this table decides the drawing. Icons are
 * decoration: whatever holds one names itself.
 */
/* Three dots, as the prototype draws them. Iconoir's are pinpricks at 14px,
   which read as two faint marks beside a title. */
const dot = (cx: number) => createElement('circle', { key: cx, cx, cy: 12, r: 1.5, fill: 'currentColor' })
function MoreDots(props: SVGProps<SVGSVGElement>) {
  return createElement(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', ...props },
    dot(5.5),
    dot(12),
    dot(18.5),
  )
}

export const ICONS = {
  work: TaskList,
  knowledge: Book,
  artifact: Archive,
  chevron: NavArrowRight,
  chevronD: NavArrowDown,
  arrow: ArrowRight,
  close: Xmark,
  /** Back to an earlier point: a loop in the graph, a changed intent. */
  corner: LongArrowDownLeft,
  check: Check,
  answer: ChatBubble,
  stop: Prohibition,
  hold: Pause,
  plus: Plus,
  branch: GitBranch,
  pin: Pin,
  mic: Microphone,
  search: Search,
  /** Stop, as on a media control. */
  square: Square,
  pencil: EditPencil,
  more: MoreDots,
  gear: Settings,
  file: Page,
  folder: Folder,
  terminal: Terminal,
  edit: Edit,
  create: PagePlus,
  remove: PageMinus,
  move: PageRight,
  tool: Tools,
  globe: Globe,
  /** An MCP server. */
  plug: ServerConnection,
  agents: Community,
  copy: Copy,
  clip: Attachment,
  image: MediaImage,
  think: LightBulb,
  list: List,
  quote: Quote,
  down: ArrowDown,
  lock: Lock,
  compress: Compress,
  up: ArrowUp,
  clock: Clock,
  /** Waits for something else to merge first. */
  after: GitMerge,
  external: OpenNewWindow,
  pr: GitPullRequest,
} satisfies Record<string, ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number | string }>>

export type IconName = keyof typeof ICONS
export const ICON_NAMES = Object.keys(ICONS).filter((k): k is IconName => k in ICONS)
