// Scrappy: the app's real settings, opened as each direction has them. Their modules are the app's own.
import { type AgentStatus, useQuery } from '../deps'
import { useRef } from 'react'

import { reads } from '../../../../../../apps/desktop/src/renderer/data/reads'
import { useServices } from '../../../../../../apps/desktop/src/renderer/data/services'
import { useAgentsAtOnce } from '../../../../../../apps/desktop/src/renderer/features/settings/useAgentsAtOnce'
import { brandOf } from '../../../../../../apps/desktop/src/renderer/shared/agents'
import { ControlCenter as KitControlCenter, type ControlCenterProps } from '../../../setup/ControlCenter/ControlCenter'
import { BrandMark } from '../../../foundations/Marks/Marks'
import { Logo } from '../../../foundations/Logo/Logo'
import { Button } from '../../../primitives/Button/Button'
import { Menu, MenuGroup, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../../primitives/Menu/Menu'
import { Segmented } from '../../../primitives/Segmented/Segmented'
import { proto, useCurrentProject, useProto } from '../state'

export function ControlCenter(props: ControlCenterProps) {
  const { direction } = useProto()
  if (direction === 'B') return <Scoped {...props} />
  if (direction === 'D') return <AppMenu {...props} />
  return <KitControlCenter {...props} />
}

/** Where the project's half of the one panel is drawn: one function, so React hands it the element once. */
const keepSlot = (slot: HTMLElement | null) => {
  if (proto.get().slot !== slot) proto.set({ slot })
}

/* B: one panel. On a project's tab, its gear opens on the project, with Althar's settings a switch away; ⌘, opens on Althar. */
function Scoped({ children, onOpenChange, ...props }: ControlCenterProps) {
  const { scope, project: here } = useProto()
  const project = useCurrentProject()
  const showProject = here && project !== null && scope === 'project'
  return (
    <KitControlCenter
      {...props}
      {...(showProject ? { width: 440, holding: false } : {})}
      onOpenChange={(open) => {
        // From the gear: the project whose tab it is, first.
        if (open) proto.set({ scope: here ? 'project' : 'althar' })
        onOpenChange?.(open)
      }}
      text={{ label: 'Settings' }}
    >
      {here && project !== null && (
        <div style={{ padding: '14px 14px 0', display: 'flex' }}>
          <Segmented
            label="Settings for"
            value={scope}
            onChange={(next) => proto.set({ scope: next })}
            options={[
              { value: 'project', label: project.name },
              { value: 'althar', label: 'Althar' },
            ]}
          />
        </div>
      )}
      {showProject ? <div ref={keepSlot} /> : children}
    </KitControlCenter>
  )
}

/* D: an app menu at the bar's end, on every tab: who is signed in, how many agents at once, and Settings. */
function AppMenu({ trigger: _gear, onOpenChange, ...props }: ControlCenterProps) {
  const { client } = useServices()
  const agents: ReadonlyArray<AgentStatus> = useQuery(reads(client).status()).data?.agents ?? []
  const atOnce = useAgentsAtOnce()
  const anchor = useRef<HTMLButtonElement>(null)
  const most = atOnce === null ? 8 : Math.max(8, atOnce.atOnce.machine.count + 2)
  const counts = Array.from({ length: most }, (_, i) => String(i + 1))
  const open = () => onOpenChange?.(true)
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <Menu
        label="Althar"
        align="end"
        width={280}
        trigger={
          <Button size="small" variant="quiet" trailingIcon="chevronD" data-proto="app-menu">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Logo size={14} />
              Althar
            </span>
          </Button>
        }
        note="Althar 0.2.0"
      >
        <MenuGroup label="Agents">
          {agents.map((agent) => {
            const brand = brandOf(agent.id)
            return (
              <MenuItem
                key={agent.id}
                {...(brand === undefined ? {} : { lead: <BrandMark brand={brand} size={13} /> })}
                {...(agent.signIn === 'unknown' ? {} : { hint: agent.signIn === 'signed_in' ? 'Signed in' : 'Signed out' })}
                onSelect={open}
              >
                {agent.name}
              </MenuItem>
            )
          })}
        </MenuGroup>
        <MenuSeparator />
        {atOnce !== null && (
          <MenuRadioGroup label="Agents at once" value={String(atOnce.atOnce.count)} onChange={(n) => atOnce.set(Number(n))}>
            {counts
              .filter((n) => Number(n) <= 6 || Number(n) === atOnce.atOnce.machine.count)
              .map((n) => (
                <MenuRadioItem
                  key={n}
                  value={n}
                  keepOpen
                  {...(Number(n) === atOnce.atOnce.machine.count ? { hint: 'This Mac’s default' } : {})}
                >
                  {n === '1' ? '1 agent at once' : `${n} agents at once`}
                </MenuRadioItem>
              ))}
          </MenuRadioGroup>
        )}
        <MenuSeparator />
        <MenuItem icon="gear" kbd="⌘," onSelect={open}>
          Settings…
        </MenuItem>
      </Menu>
      {/* The settings open from where the menu is, as if from it. */}
      <KitControlCenter
        {...props}
        onOpenChange={onOpenChange}
        trigger={
          <button
            ref={anchor}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: 1,
              height: '100%',
              opacity: 0,
              pointerEvents: 'none',
              padding: 0,
              border: 0,
            }}
          />
        }
      />
    </span>
  )
}
