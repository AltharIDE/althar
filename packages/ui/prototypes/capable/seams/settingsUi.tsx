// Scrappy: the kit as Althar's Settings see it here: the Skills section is "MCP servers and skills", the role table with each direction's way to sync; and in What asks' B, a section of its own.
import type { ComponentProps } from 'react'

import { Button as RealButton } from '../../../src/primitives/Button/Button'
import { SettingsLayout as RealSettingsLayout } from '../../../src/setup/SettingsLayout/SettingsLayout'
import { SettingsNav as RealSettingsNav } from '../../../src/setup/SettingsNav/SettingsNav'
import { SkillInstall as RealSkillInstall, SkillList as RealSkillList } from '../../../src/setup/Skills/Skills'
import { WhatAsks } from '../directions/rules/WhatAsks'
import { ToolsByRole } from '../directions/tools/ToolsSettings'
import { useProto } from '../state'

export * from '../../../src/index'

const TITLE = 'MCP servers and skills'
const on = (p: ReturnType<typeof useProto>) => p.surface === 'tools' && p.direction !== 'Today'
const asks = (p: ReturnType<typeof useProto>) => p.surface === 'rules' && p.direction === 'B'

export function SkillList(props: ComponentProps<typeof RealSkillList>) {
  const p = useProto()
  if (!on(p)) return <RealSkillList {...props} />
  return <ToolsByRole sync />
}

export function SkillInstall(props: ComponentProps<typeof RealSkillInstall>) {
  const p = useProto()
  return on(p) ? null : <RealSkillInstall {...props} />
}

export function Button(props: ComponentProps<typeof RealButton>) {
  const p = useProto()
  return on(p) && props.children === 'Check for updates' ? null : <RealButton {...props} />
}

export function SettingsLayout(props: ComponentProps<typeof RealSettingsLayout>) {
  const p = useProto()
  if ((props.section as string) === 'what-asks')
    return (
      <RealSettingsLayout {...props}>
        <WhatAsks where="account" />
      </RealSettingsLayout>
    )
  return <RealSettingsLayout {...props} title={on(p) && props.title === 'Skills' ? TITLE : props.title} />
}

export function SettingsNav<V extends string>(props: ComponentProps<typeof RealSettingsNav<V>>) {
  const p = useProto()
  if (!on(p) && !asks(p)) return <RealSettingsNav {...props} />
  return (
    <RealSettingsNav
      {...props}
      groups={props.groups.map((group) =>
        group.flatMap((item) =>
          on(p) && item.title === 'Skills'
            ? [{ ...item, title: TITLE, icon: 'plug' as const }]
            : asks(p) && item.title === 'Agents'
              ? [item, { id: 'what-asks' as V, title: 'What asks', icon: 'lock' as const }]
              : [item],
        ),
      )}
    />
  )
}
