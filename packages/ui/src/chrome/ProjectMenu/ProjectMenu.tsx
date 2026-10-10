import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { ChromeButton } from '../ChromeButton/ChromeButton'

/*
 * What you can change about a project once it is made, from its bar: its
 * name, its repositories, its rules, connecting the code host its
 * repositories are on when Althar isn't, and taking it out of Althar. Each
 * item is there when its callback is. Removing says what it does on the next
 * step, before anything goes.
 */

export interface ProjectMenuText {
  trigger: string
  label: string
  rename: string
  repositories: string
  memory: string
  rules: string
  connect: (host: string) => string
  remove: string
}

export const projectMenuText: ProjectMenuText = {
  trigger: 'More for this project',
  label: 'This project',
  rename: 'Rename',
  repositories: 'Repositories',
  memory: 'Project memory',
  rules: 'Project rules',
  connect: (host) => `Connect ${host}`,
  remove: 'Remove from Althar',
}

interface ProjectMenuItemsProps {
  /** How many repositories it has, beside Repositories. */
  repositories?: number
  onRename?: () => void
  onRepositories?: () => void
  onMemory?: () => void
  onRules?: () => void
  /** The code host its repositories are on, while Althar isn't connected to it: GitHub. */
  host?: string
  /** Connect that host; with both, the item is there. */
  onConnect?: () => void
  onRemove?: () => void
  text?: Partial<ProjectMenuText>
}

/** The project's items. */
function ProjectMenuItems({
  repositories,
  onRename,
  onRepositories,
  onRules,
  onMemory,
  host,
  onConnect,
  onRemove,
  text,
}: ProjectMenuItemsProps) {
  const t = { ...projectMenuText, ...text }
  const connect = host !== undefined && onConnect !== undefined
  return (
    <>
      {onRename && (
        <MenuItem icon="pencil" onSelect={onRename}>
          {t.rename}
        </MenuItem>
      )}
      {onRepositories && (
        <MenuItem icon="branch" hint={repositories} onSelect={onRepositories}>
          {t.repositories}
        </MenuItem>
      )}
      {onMemory && (
        <MenuItem icon="list" onSelect={onMemory}>
          {t.memory}
        </MenuItem>
      )}
      {onRules && (
        <MenuItem icon="gear" onSelect={onRules}>
          {t.rules}
        </MenuItem>
      )}
      {connect && (
        <MenuItem icon="plug" onSelect={onConnect}>
          {t.connect(host)}
        </MenuItem>
      )}
      {onRemove && (
        <>
          {(onRename || onRepositories || onRules || onMemory || connect) && <MenuSeparator />}
          <MenuItem icon="close" tone="danger" onSelect={onRemove}>
            {t.remove}
          </MenuItem>
        </>
      )}
    </>
  )
}

export interface ProjectMenuProps extends ProjectMenuItemsProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

/** The project's menu, behind the bar's more button. With nothing to offer, no button. */
export function ProjectMenu({ open, defaultOpen, onOpenChange, ...items }: ProjectMenuProps) {
  const t = { ...projectMenuText, ...items.text }
  const connect = items.host !== undefined && items.onConnect !== undefined
  if (!items.onRename && !items.onRepositories && !items.onRules && !items.onMemory && !connect && !items.onRemove) return null
  return (
    <Menu
      label={t.label}
      align="end"
      width={220}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      trigger={<ChromeButton icon="more" label={t.trigger} compact />}
    >
      <ProjectMenuItems {...items} />
    </Menu>
  )
}
