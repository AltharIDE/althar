import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { ChromeButton } from '../ChromeButton/ChromeButton'

/*
 * What you can change about a project once it is made, from its bar: its
 * name, its repositories, its rules, and taking it out of Althar. Each item
 * is there when its callback is. Removing says what it does on the next
 * step, before anything goes.
 */

export interface ProjectMenuText {
  trigger: string
  label: string
  rename: string
  repositories: string
  rules: string
  remove: string
}

export const projectMenuText: ProjectMenuText = {
  trigger: 'More for this project',
  label: 'This project',
  rename: 'Rename',
  repositories: 'Repositories',
  rules: 'Project rules',
  remove: 'Remove from Althar',
}

export interface ProjectMenuItemsProps {
  /** How many repositories it has, beside Repositories. */
  repositories?: number
  onRename?: () => void
  onRepositories?: () => void
  onRules?: () => void
  onRemove?: () => void
  text?: Partial<ProjectMenuText>
}

/** The project's items, for a menu of its own or another's, such as the head of its conversation. */
export function ProjectMenuItems({ repositories, onRename, onRepositories, onRules, onRemove, text }: ProjectMenuItemsProps) {
  const t = { ...projectMenuText, ...text }
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
      {onRules && (
        <MenuItem icon="gear" onSelect={onRules}>
          {t.rules}
        </MenuItem>
      )}
      {onRemove && (
        <>
          {(onRename || onRepositories || onRules) && <MenuSeparator />}
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
  if (!items.onRename && !items.onRepositories && !items.onRules && !items.onRemove) return null
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
