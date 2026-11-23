import { useState } from 'react'
import { fn } from 'storybook/test'

import {
  Brand,
  Button,
  CheckList,
  ChromeButton,
  Composer,
  Dialog,
  IconButton,
  IssueRef,
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  ProjectHeader,
  ProjectInk,
  ProjectTabs,
  Prose,
  Room,
  TaskFace,
  Thread,
  Turn,
  You,
} from '../../src'
import { type Role, ROLES, roleName, TRACKER } from './data'
import { Pane } from './Panes'
import { HandoffProvider, type HandoffState, useHandoff } from './state'
import s from './handoff.module.css'

/*
 * storefront's window, as Screens/ProjectHome draws a project: its tabs, its
 * row with the lens chip, the coordinator's conversation, and the pane the
 * scene draws (Panes.tsx). Drawn from the kit's own pieces on made-up data.
 */

export function HandoffWindow(initial: HandoffState) {
  return (
    // Keyed on what the story asks, so the controls start it again.
    <HandoffProvider key={JSON.stringify(initial)} initial={initial}>
      <Shell />
    </HandoffProvider>
  )
}

function Shell() {
  const [draft, setDraft] = useState('')
  const { picking } = useHandoff()
  return (
    <div className={s.window}>
      <ProjectTabs
        lights="drawn"
        tabs={[
          { id: 'storefront', name: 'storefront', seed: 'storefront', ink: ProjectInk.Clay, running: true, yours: 1 },
          { id: 'infra', name: 'infra', seed: 'infra', ink: ProjectInk.Teal, running: false, yours: 0 },
        ]}
        current="storefront"
        yours={1}
        onSelect={fn()}
        onClose={fn()}
        end={<IconButton icon="gear" label="Settings" size="small" />}
      />
      <ProjectHeader
        name="storefront"
        seed="storefront"
        ink={ProjectInk.Clay}
        yours={1}
        inProgress={3}
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
            <Talk />
          </TaskFace>
        </div>
        <div className={s.pane}>
          <Pane />
        </div>
      </div>
      {picking && <RolePicker />}
    </div>
  )
}

/** The coordinator's conversation, as it stands in each scene. */
function Talk() {
  const { scene, role, opened, accepted, asked, answered } = useHandoff()
  if (scene === 'spec')
    return (
      <Thread label="Conversation">
        <You at="24m ago">Write SHOP-212 up as a spec.</You>
        <Turn voice="Coordinator" at="23m ago">
          <IssueRef mark={Brand.Linear} id={TRACKER} linear />
          <Prose>
            I drafted <code>specs/saved-carts/spec.md</code> from <b>{TRACKER}</b> and its 14 comments: the problem, the goal, six
            acceptance criteria and what is out of scope. Its frontmatter names you as Spec’s owner and Dani as Design’s.
          </Prose>
          <Prose dim>It’s on the right. Change what you like there or here; it opens as a pull request when you say.</Prose>
        </Turn>
        {opened && (
          <>
            <You at="just now">Open it.</You>
            <Turn voice="Coordinator" at="just now">
              <Prose>
                Opened <b>#431</b> in shop. It’s the Spec stage’s artefact: when it merges on main, Saved carts moves to Design, and Dani’s
                Althar proposes the design work.
              </Prose>
              <Prose dim>GitHub asks for a code owner of specs/ and one review. Althar only shows them.</Prose>
            </Turn>
          </>
        )}
      </Thread>
    )
  if (scene === 'handoff')
    return (
      <Thread label="Conversation">
        <Turn voice="Coordinator" at="8m ago">
          <Prose>
            <b>Saved carts</b>’ spec merged on main (#431, Réka’s). Its next stage is Design, yours here, so I read the spec and proposed
            three prototype tasks from its acceptance criteria. They’re held for you, in Waiting on Design.
          </Prose>
        </Turn>
        {accepted && (
          <>
            <You at="just now">Start them.</You>
            <Turn voice="Coordinator" at="just now">
              <Prose>
                Started <b>512</b>, <b>513</b> and <b>514</b>. Each ends with its branch and a canvas; the one you pick goes into{' '}
                <code>design/</code> as a pull request.
              </Prose>
            </Turn>
          </>
        )}
      </Thread>
    )
  if (scene === 'ask' && role === 'product')
    return (
      <Thread label="Conversation">
        <Turn voice="Coordinator" at="5m ago">
          <Prose>
            Dani asks on <b>Saved carts</b>: <i>Can a gift card pay for shipping?</i> It doesn’t move the stage; Saved carts stays in
            Design.
          </Prose>
        </Turn>
        {answered && (
          <>
            <You at="just now">No, items only. Put it in the spec.</You>
            <Turn voice="Coordinator" at="just now">
              <Prose>
                Answered on #431 and {TRACKER}, and opened <b>#437</b>, a line in the spec’s Out of scope. Saved carts is still in Design.
              </Prose>
            </Turn>
          </>
        )}
      </Thread>
    )
  if (scene === 'ask')
    return (
      <Thread label="Conversation">
        <You at="6m ago">Ask Réka whether a gift card can pay for shipping. Direction B shows it as a payment line.</You>
        <Turn voice="Coordinator" at="5m ago">
          <Prose>
            Asked Réka on Saved carts, on #431’s thread and {TRACKER}. The stage stays at Design; your tasks carry on. I’ll tell you when
            she answers.
          </Prose>
        </Turn>
        {asked && answered && (
          <Turn voice="Coordinator" at="just now">
            <Prose>
              Réka answered: <i>No, gift cards pay for items only.</i> She’s adding it to the spec in #437. Direction B’s payment line needs
              a change; shall I tell 512?
            </Prose>
          </Turn>
        )}
      </Thread>
    )
  if (scene === 'feature')
    return (
      <Thread label="Conversation">
        <You at="3m ago">Where is saved carts?</You>
        <Turn voice="Coordinator" at="3m ago">
          <Prose>
            In <b>Design</b>. #436 brings <code>design/</code>; GitHub shows 1 of 2 reviews and waits on Noor, the code owner of design/.
            When it merges, Build is Balázs’s.
          </Prose>
        </Turn>
      </Thread>
    )
  return (
    <Thread label="Conversation">
      <You at="12m ago">B it is. Put it in design/ and open the pull request.</You>
      <Turn voice="Coordinator" at="11m ago">
        <Prose>
          Opened <b>#436</b> with <code>specs/saved-carts/design/</code>: direction B’s canvas, its decisions, the tokens it changed, and
          the screenshots light and dark. The screenshot diff found six changed screens; you accepted them.
        </Prose>
        <Prose dim>When it merges, Build’s owners hear it, and their coordinator proposes the build.</Prose>
      </Turn>
    </Thread>
  )
}

/** The lens chip: names the lens. Its menu switches the lens in place, your roles first, and changes your roles here. */
function LensSwitch() {
  const { role, roles, menu, set } = useHandoff()
  const others = ROLES.filter((one) => !roles.includes(one.key))
  return (
    <Menu
      label="Lens"
      align="end"
      width={300}
      open={menu}
      onOpenChange={(open) => set({ menu: open })}
      note="A lens changes what opens first. Every feature, task and file is here in every lens."
      trigger={<ChromeButton icon="viewport" label={roleName(role)} aria-label={`Lens: ${roleName(role)}`} />}
    >
      <MenuRadioGroup label="Your roles here" value={role} onChange={(value) => set({ role: value as Role, menu: false })}>
        {ROLES.filter((one) => roles.includes(one.key)).map((one) => (
          <MenuRadioItem key={one.key} value={one.key} kbd={one.kbd} description={one.lands}>
            {one.label}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {others.length > 0 && (
        <MenuRadioGroup label="Look through another" value={role} onChange={(value) => set({ role: value as Role, menu: false })}>
          {others.map((one) => (
            <MenuRadioItem key={one.key} value={one.key} kbd={one.kbd}>
              {one.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      )}
      <MenuItem icon="pencil" onSelect={() => set({ menu: false, picking: true, firstRun: false })}>
        Your roles in storefront…
      </MenuItem>
    </Menu>
  )
}

/** "Your role here": on first opening a project, or from the lens menu. Several roles; the first one chosen is the lens it opens with. */
function RolePicker() {
  const { roles, firstRun, set } = useHandoff()
  const [chosen, setChosen] = useState<readonly string[]>(roles)
  const done = () => {
    const now = ROLES.map((one) => one.key).filter((key) => chosen.includes(key))
    set({ roles: now, role: now[0] ?? 'engineering', picking: false, firstRun: false })
  }
  return (
    <Dialog
      title={firstRun ? 'What do you do in storefront?' : 'Your roles in storefront'}
      description="Pick each one you do here. You look through one at a time, and switch from the chip in the project’s row."
      onClose={() => set({ picking: false })}
      width={460}
      actions={
        <>
          {firstRun && (
            <Button variant="quiet" onClick={() => set({ picking: false, firstRun: false })}>
              Skip
            </Button>
          )}
          <Button variant="signal" onClick={done} disabled={chosen.length === 0}>
            {firstRun ? 'Open storefront' : 'Done'}
          </Button>
        </>
      }
    >
      <CheckList label="Roles" items={ROLES.map((one) => ({ id: one.key, label: one.label }))} value={chosen} onChange={setChosen} />
      <dl className={s.lands}>
        {ROLES.filter((one) => chosen.includes(one.key)).map((one) => (
          <div key={one.key}>
            <dt>{one.label}</dt>
            <dd>{one.lands}</dd>
          </div>
        ))}
      </dl>
      <p className={s.nothingHidden}>
        Nothing is hidden or locked by a role. It changes what opens first, how the board groups and which presets come first. Only you see
        your roles; they’re kept in your Althar, for this project.
      </p>
    </Dialog>
  )
}
