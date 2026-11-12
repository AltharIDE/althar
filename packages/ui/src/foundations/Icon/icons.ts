import {
  Activity,
  AppWindow,
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Attachment,
  Bell,
  Book,
  ChatBubble,
  ChatPlusIn,
  Check,
  Clock,
  ClockRotateRight,
  CoffeeCup,
  Community,
  Compress,
  Cookie,
  Copy,
  Download,
  Edit,
  EditPencil,
  Expand,
  Folder,
  Frame,
  GitBranch,
  GitCompare,
  GitMerge,
  GitPullRequest,
  Globe,
  HalfMoon,
  KanbanBoard,
  LightBulb,
  List,
  Lock,
  LongArrowDownLeft,
  MediaImage,
  Microphone,
  NavArrowDown,
  NavArrowLeft,
  NavArrowRight,
  NavArrowUp,
  OpenNewWindow,
  Page,
  Palette,
  PageMinus,
  PagePlus,
  PageRight,
  Pause,
  Pin,
  Play,
  Plus,
  Prohibition,
  Quote,
  Refresh,
  Search,
  ServerConnection,
  Settings,
  ShieldCheck,
  SidebarExpand,
  SoundHigh,
  Square,
  TaskList,
  Terminal,
  Tools,
  WifiOff,
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

/* Two columns of three dots: a handle to drag something by, drawn as the three dots are. */
const grip = (cx: number, cy: number) => createElement('circle', { key: `${cx}:${cy}`, cx, cy, r: 1.5, fill: 'currentColor' })
function Grip(props: SVGProps<SVGSVGElement>) {
  return createElement(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', ...props },
    [9, 15].flatMap((cx) => [5.5, 12, 18.5].map((cy) => grip(cx, cy))),
  )
}

export const ICONS = {
  work: TaskList,
  knowledge: Book,
  artifact: Archive,
  chevron: NavArrowRight,
  chevronL: NavArrowLeft,
  chevronD: NavArrowDown,
  chevronU: NavArrowUp,
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
  /** A handle to drag something into another place by. */
  grip: Grip,
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
  /** The computer is offline. */
  offline: WifiOff,
  /** An MCP server. */
  plug: ServerConnection,
  agents: Community,
  copy: Copy,
  clip: Attachment,
  image: MediaImage,
  /** light or dark */
  theme: HalfMoon,
  think: LightBulb,
  list: List,
  quote: Quote,
  down: ArrowDown,
  lock: Lock,
  compress: Compress,
  /** Opens something bigger, as a diagram over the window. */
  expand: Expand,
  up: ArrowUp,
  /** When something happens on a schedule. */
  clock: Clock,
  /** An automation: work that starts by itself. */
  automation: ClockRotateRight,
  /** Keeps the Mac awake while work runs. */
  cup: CoffeeCup,
  /** How hard the computer works. */
  load: Activity,
  /** Notifications. */
  bell: Bell,
  /** A sound, as a notification plays it. */
  sound: SoundHigh,
  /** Plays something once, to hear it. */
  play: Play,
  /** Waits for something else to merge first. */
  after: GitMerge,
  external: OpenNewWindow,
  /** Fetches something to this computer: an agent Althar can download. */
  download: Download,
  pr: GitPullRequest,
  /** Two changes that touch the same lines, and resolving them: merge conflicts. */
  conflict: GitCompare,
  /** A tracker's issues, moving through its statuses as their tasks go. */
  issues: KanbanBoard,
  /** Loads a page again. */
  reload: Refresh,
  /** Points at something on a page, to comment on it for the lead. */
  comment: ChatPlusIn,
  /** A page's own session, kept apart from Althar's and the person's browser's. */
  session: ShieldCheck,
  /** The size a page is laid out at. */
  viewport: Frame,
  /** A page in a tab of its own. */
  tab: AppWindow,
  /** A page back beside the conversation it came from. */
  beside: SidebarExpand,
  /** What sites keep: cookies and storage. */
  cookie: Cookie,
  /** One of the project's canvases: what its agents drew for the person to look at and iterate on (ADR-104). */
  canvas: Palette,
} satisfies Record<string, ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number | string }>>

export type IconName = keyof typeof ICONS
export const ICON_NAMES = Object.keys(ICONS).filter((k): k is IconName => k in ICONS)
