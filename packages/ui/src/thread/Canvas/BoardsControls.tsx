import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { cx } from '../../lib/cx'
import { CanvasChip } from './CanvasChip'
import s from './Canvas.module.css'

/*
 * A canvas of boards' controls (ADR-104), floating over its boards as a
 * design tool's do: at the top left, the page shown (or every page at once)
 * and every board of it or one at a time, with a step through them; at the
 * top right, how near it is; along the bottom, what a press does (point at a
 * part to say what you think, move around, or use the boards as the pages
 * they are). The canvas's own page draws them over its boards, so they
 * float there; every press shows at once.
 */

export type BoardsView = 'every' | 'one'
export type BoardsTool = 'point' | 'hand' | 'use'
export type BoardsZoom = number | 'fit' | 'in' | 'out'

export interface BoardsControlsText {
  pages: string
  everyPage: string
  boards: string
  every: string
  one: string
  before: string
  after: string
  of: (n: number, all: number) => string
  tools: string
  point: string
  hand: string
  use: string
  zoom: string
  zoomIn: string
  zoomOut: string
  fit: string
  fitOne: string
  percent: (zoom: number) => string
}

export const boardsControlsText: BoardsControlsText = {
  pages: 'Pages',
  everyPage: 'Every page',
  boards: 'Boards',
  every: 'Every board',
  one: 'One board at a time',
  before: 'Board before',
  after: 'Next board',
  of: (n, all) => `${n} of ${all}`,
  tools: 'Tools',
  point: 'Point at a part',
  hand: 'Move around',
  use: 'Use the boards',
  zoom: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Fit every board',
  fitOne: 'Fit the board',
  percent: (zoom) => `${Math.round(zoom * 100)}%`,
}

export interface BoardsControlsPage {
  readonly name: string
  readonly boards: ReadonlyArray<{ readonly name: string }>
}

export interface BoardsControlsProps {
  pages: ReadonlyArray<BoardsControlsPage>
  view: BoardsView
  /** The page shown, by its place; -1 for every page at once. */
  page: number
  /** The board one at a time shows, by its page's place and its own. */
  board: { readonly page: number; readonly board: number }
  zoom: number
  tool: BoardsTool
  onView: (view: BoardsView) => void
  onPage: (page: number) => void
  onStep: (step: -1 | 1) => void
  onZoom: (zoom: BoardsZoom) => void
  onTool: (tool: BoardsTool) => void
  /** Beside a conversation: what it is, after the zoom; its name opens the artifact itself. */
  chip?: { readonly title: string; readonly onOpen: () => void; readonly onClose: () => void } | null
  text?: Partial<BoardsControlsText>
}

const TOOLS: ReadonlyArray<{ readonly tool: BoardsTool; readonly icon: 'point' | 'hand' | 'use'; readonly kbd: string }> = [
  { tool: 'point', icon: 'point', kbd: 'V' },
  { tool: 'hand', icon: 'hand', kbd: 'H' },
  { tool: 'use', icon: 'use', kbd: 'U' },
]

export function BoardsControls({
  pages,
  view,
  page,
  board,
  zoom,
  tool,
  onView,
  onPage,
  onStep,
  onZoom,
  onTool,
  chip = null,
  text,
}: BoardsControlsProps) {
  const t = { ...boardsControlsText, ...text }
  const all = pages.flatMap((one, p) => one.boards.map((b, i) => ({ page: p, board: i, name: b.name })))
  const at = all.findIndex((one) => one.page === board.page && one.board === board.board)
  const shown = all[at]
  const pageName = page === -1 ? t.everyPage : (pages[page]?.name ?? '')
  return (
    <div className={s.boardsControls}>
      <div className={cx(s.float, s.floatStart)}>
        {pages.length > 1 && (
          <Menu
            label={t.pages}
            trigger={
              <Button variant="quiet" size="small" trailingIcon="chevronD" className={s.pageMenu} aria-label={`${t.pages}: ${pageName}`}>
                <span className={s.pageWord}>{pageName}</span>
              </Button>
            }
          >
            <MenuRadioGroup label={t.pages} value={String(page)} onChange={(value) => onPage(Number(value))}>
              <MenuRadioItem value="-1" hint={String(all.length)}>
                {t.everyPage}
              </MenuRadioItem>
              <MenuSeparator />
              {pages.map((one, p) => (
                <MenuRadioItem key={one.name} value={String(p)} hint={String(one.boards.length)}>
                  {one.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </Menu>
        )}
        <Segmented
          label={t.boards}
          value={view}
          onChange={onView}
          options={[
            { value: 'every', label: t.every, icon: 'boards', tooltip: { label: t.every } },
            { value: 'one', label: t.one, icon: 'board', tooltip: { label: t.one } },
          ]}
        />
        {view === 'one' && shown !== undefined && (
          <span className={s.stepper}>
            <IconButton
              icon="chevronL"
              label={t.before}
              kbd="←"
              tooltip="below"
              size="small"
              disabled={at <= 0}
              onClick={() => onStep(-1)}
            />
            <span className={s.stepName} title={shown.name}>
              {shown.name}
            </span>
            {all.length > 1 && <span className={s.stepCount}>{t.of(at + 1, all.length)}</span>}
            <IconButton
              icon="chevron"
              label={t.after}
              kbd="→"
              tooltip="below"
              size="small"
              disabled={at >= all.length - 1}
              onClick={() => onStep(1)}
            />
          </span>
        )}
      </div>
      <div className={cx(s.float, s.floatEnd)}>
        <Menu
          label={t.zoom}
          align="end"
          trigger={
            <Button variant="quiet" size="small" trailingIcon="chevronD" className={s.zoom} aria-label={`${t.zoom}: ${t.percent(zoom)}`}>
              {t.percent(zoom)}
            </Button>
          }
        >
          <MenuItem onSelect={() => onZoom('in')} kbd="+">
            {t.zoomIn}
          </MenuItem>
          <MenuItem onSelect={() => onZoom('out')} kbd="−">
            {t.zoomOut}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => onZoom('fit')} kbd="⇧1">
            {view === 'one' ? t.fitOne : t.fit}
          </MenuItem>
          <MenuItem onSelect={() => onZoom(0.5)}>{t.percent(0.5)}</MenuItem>
          <MenuItem onSelect={() => onZoom(1)} kbd="⇧0">
            {t.percent(1)}
          </MenuItem>
          <MenuItem onSelect={() => onZoom(2)}>{t.percent(2)}</MenuItem>
        </Menu>
        {chip !== null && <CanvasChip title={chip.title} onOpen={chip.onOpen} onClose={chip.onClose} bare />}
      </div>
      <div className={cx(s.float, s.floatTools)} role="toolbar" aria-label={t.tools}>
        {TOOLS.map((one) => (
          <IconButton
            key={one.tool}
            icon={one.icon}
            label={t[one.tool]}
            kbd={one.kbd}
            size="small"
            aria-pressed={tool === one.tool}
            onClick={() => onTool(one.tool)}
          />
        ))}
      </div>
    </div>
  )
}
