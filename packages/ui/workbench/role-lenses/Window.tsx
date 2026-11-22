import { useState } from 'react'
import { fn } from 'storybook/test'

import {
  ChromeButton,
  Composer,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  ProjectHeader,
  ProjectInk,
  Prose,
  Room,
  TaskFace,
  Thread,
  Turn,
  You,
  ProjectTabs,
} from '../../src'
import { featureOf, handoffsOf, LANDING, PANELS, PINNED } from './features'
import { LensPane, panelsOf } from './Lens'
import { LensProvider, type LensState, type Role, ROLES, roleName, useLens } from './state'
import s from './window.module.css'

/*
 * A team's project, storefront, as the desktop opens it: its tabs, its row
 * with the lens chip before ⋯, the coordinator's conversation, and the
 * board's pane as the direction draws it for the lens on (Lens.tsx). Drawn
 * from the kit's own pieces, as Screens/ProjectHome is; the live lab on the
 * whole app is apps/desktop/lab/role-lenses.
 */

export function RoleLensesWindow(initial: LensState) {
  return (
    // Keyed on what the story asks, so the controls start it again.
    <LensProvider key={JSON.stringify(initial)} initial={initial}>
      <Shell />
    </LensProvider>
  )
}

function Shell() {
  const [draft, setDraft] = useState('')
  return (
    <div className={s.window}>
      <ProjectTabs
        lights="drawn"
        tabs={[
          { id: 'storefront', name: 'storefront', seed: 'storefront', ink: ProjectInk.Clay, running: true, yours: 2 },
          { id: 'infra', name: 'infra', seed: 'infra', ink: ProjectInk.Teal, running: false, yours: 0 },
        ]}
        current="storefront"
        yours={2}
        onSelect={fn()}
        onClose={fn()}
        end={<IconButton icon="gear" label="Settings" size="small" />}
      />
      <ProjectHeader
        name="storefront"
        seed="storefront"
        ink={ProjectInk.Clay}
        yours={2}
        inProgress={4}
        onYours={fn()}
        room={Room.Both}
        onRoom={fn()}
        run={<LensSwitch />}
      />
      <div className={s.rooms}>
        <div className={s.talk}>
          <TaskFace
            className={s.face}
            composer={
              <Composer value={draft} onChange={setDraft} onSubmit={() => setDraft('')} placeholder="Tell the coordinator something" />
            }
          >
            <Thread label="Conversation">
              <You at="52m ago">Where is saved carts?</You>
              <Turn voice="Coordinator" at="51m ago">
                <Prose>
                  Built. <b>#412</b>, <b>#415</b> and <b>#418</b> are merged, the review passed and main is green, so Build is done and{' '}
                  <b>Saved carts</b> waits on DevOps to ship.
                </Prose>
                <Prose>
                  I drafted <code>specs/saved-carts/ops.md</code> from the spec: staging first, behind <code>saved_carts</code>, then 10% of
                  production.
                </Prose>
              </Turn>
              <You at="14m ago">Guest checkout’s design is approved, start the build.</You>
              <Turn voice="Coordinator" at="13m ago">
                <Prose>
                  Design is done. I proposed two build tasks from <code>specs/guest-checkout/design/</code>; they’re in Engineering’s
                  handoffs.
                </Prose>
              </Turn>
            </Thread>
          </TaskFace>
        </div>
        <div className={s.board}>
          <LensPane />
        </div>
      </div>
    </div>
  )
}

/** The lens chip: names the lens and counts the handoffs waiting on it. Its menu changes the lens in place, and in B pins any role's panels. */
function LensSwitch() {
  const { d, role, menu, pinned, unpinned, set } = useLens()
  const waiting = handoffsOf(role).length
  const shown = panelsOf(role, pinned, unpinned)
  const toggle = (key: string, on: boolean) => {
    if (PINNED[role].includes(key)) set({ unpinned: on ? unpinned.filter((one) => one !== key) : [...unpinned, key] })
    else set({ pinned: on ? [...pinned, key] : pinned.filter((one) => one !== key) })
  }
  return (
    <Menu
      label="Lens"
      align="end"
      width={290}
      open={menu}
      onOpenChange={(open) => set({ menu: open })}
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
      <MenuRadioGroup label="See storefront as" value={role} onChange={(value) => set({ role: value as Role, pinned: [], unpinned: [] })}>
        {ROLES.map((one) => (
          <MenuRadioItem
            key={one.key}
            value={one.key}
            kbd={one.kbd}
            {...(d === 'c' ? { hint: `${handoffsOf(one.key).length || '—'}` } : {})}
            {...(d === 'a'
              ? { description: LANDING[one.key].lands }
              : d === 'b'
                ? {
                    description: PINNED[one.key]
                      .filter((key) => key !== 'handoffs')
                      .map((key) => PANELS[key]?.title)
                      .join(', '),
                  }
                : {})}
          >
            {one.label}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {d === 'a' && waiting > 0 && (
        <MenuGroup label={`Waiting on ${roleName(role)}`}>
          {handoffsOf(role).map((one, i) => (
            <MenuItem key={i} icon="artifact" hint={one.ago} onSelect={() => set({ feature: one.feature, menu: false })}>
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
