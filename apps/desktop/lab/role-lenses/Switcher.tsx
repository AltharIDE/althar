import {
  ChromeButton,
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  ProjectHeader as KitProjectHeader,
  type ProjectHeaderProps,
} from '@althar/ui'

import { featureOf, handoffsOf, LANDING, PANELS, PINNED } from './features'
import { lab, type Role, ROLES, roleName, useLab } from './state'

/*
 * The project's row with the lens on it: one chip at its end, before ⋯,
 * naming the lens and counting the handoffs waiting on it. Its menu changes
 * the lens in place; in direction B it also pins any role's panels, so
 * nothing a lens leaves out is out of reach.
 */

export function ProjectHeader(props: ProjectHeaderProps) {
  return (
    <KitProjectHeader
      {...props}
      run={
        <>
          <LensSwitch />
          {props.run}
        </>
      }
    />
  )
}

/** The panels shown for a lens in direction B: its own, less those taken off, then those pinned from other lenses. */
export const panelsOf = (role: Role, pinned: ReadonlyArray<string>, unpinned: ReadonlyArray<string>) => [
  ...PINNED[role].filter((key) => !unpinned.includes(key)),
  ...pinned.filter((key) => !PINNED[role].includes(key)),
]

function LensSwitch() {
  const { d, role, menu, pinned, unpinned } = useLab()
  const waiting = handoffsOf(role).length
  const shown = panelsOf(role, pinned, unpinned)
  const toggle = (key: string, on: boolean) => {
    const own = PINNED[role].includes(key)
    if (own) lab.set({ unpinned: on ? unpinned.filter((one) => one !== key) : [...unpinned, key] })
    else lab.set({ pinned: on ? [...pinned, key] : pinned.filter((one) => one !== key) })
  }
  return (
    <Menu
      label="Lens"
      align="end"
      width={290}
      {...(menu ? { defaultOpen: true } : {})}
      onOpenChange={(open) => !open && menu && lab.set({ menu: false })}
      note={
        d === 'b'
          ? 'Pinned for you in storefront. Your teammates keep their own.'
          : 'A lens changes what opens first. Everything else stays where it is.'
      }
      trigger={
        <ChromeButton
          icon="viewport"
          label={roleName(role)}
          count={waiting}
          aria-label={`Lens: ${roleName(role)}, ${waiting} handoffs wait`}
        />
      }
    >
      <MenuRadioGroup
        label="See storefront as"
        value={role}
        onChange={(value) => lab.set({ role: value as Role, pinned: [], unpinned: [] })}
      >
        {ROLES.map((one) => (
          <MenuRadioItem
            key={one.key}
            value={one.key}
            kbd={one.kbd}
            hint={d === 'c' ? `${handoffsOf(one.key).length || '—'}` : undefined}
            description={
              d === 'a'
                ? LANDING[one.key].lands
                : d === 'b'
                  ? PINNED[one.key]
                      .filter((key) => key !== 'handoffs')
                      .map((key) => PANELS[key]?.title)
                      .join(', ')
                  : undefined
            }
          >
            {one.label}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {d === 'a' && handoffsOf(role).length > 0 && (
        <MenuGroup label={`Waiting on ${roleName(role)}`}>
          {handoffsOf(role).map((one, i) => (
            <MenuItem key={i} icon="artifact" hint={one.ago} onSelect={() => lab.set({ feature: one.feature, menu: false })}>
              {one.question ?? `${featureOf(one.feature)?.name}: ${one.from} → ${one.to}`}
            </MenuItem>
          ))}
        </MenuGroup>
      )}
      {d === 'b' && (
        <MenuGroup label="Pinned panels">
          {Object.values(PANELS).map((panel) => (
            <MenuCheckboxItem
              key={panel.key}
              checked={shown.includes(panel.key)}
              onCheckedChange={(on) => toggle(panel.key, on)}
              hint={ROLES.filter((one) => PINNED[one.key].includes(panel.key) && panel.key !== 'handoffs')
                .map((one) => one.label)
                .join(', ')}
              keepOpen
            >
              {panel.title}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
      )}
    </Menu>
  )
}
