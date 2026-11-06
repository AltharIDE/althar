// Scrappy: the kit as Althar's Settings see it here: the Skills section is "MCP servers and skills", drawn by the direction.
import type { ComponentProps } from 'react'

import { Button as RealButton } from '../../../src/primitives/Button/Button'
import { SettingsLayout as RealSettingsLayout } from '../../../src/setup/SettingsLayout/SettingsLayout'
import { SettingsNav as RealSettingsNav } from '../../../src/setup/SettingsNav/SettingsNav'
import { SkillInstall as RealSkillInstall, SkillList as RealSkillList } from '../../../src/setup/Skills/Skills'
import { ToolsByRole, ToolsBySource } from '../directions/tools/ToolsSettings'
import { useProto } from '../state'

export * from '../../../src/index'

const TITLE = 'MCP servers and skills'
const on = (p: ReturnType<typeof useProto>) => p.surface === 'tools' && p.direction !== 'Today'

export function SkillList(props: ComponentProps<typeof RealSkillList>) {
  const p = useProto()
  if (!on(p)) return <RealSkillList {...props} />
  return p.direction === 'B' ? <ToolsByRole /> : <ToolsBySource />
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
  return <RealSettingsLayout {...props} title={on(p) && props.title === 'Skills' ? TITLE : props.title} />
}

export function SettingsNav<V extends string>(props: ComponentProps<typeof RealSettingsNav<V>>) {
  const p = useProto()
  if (!on(p)) return <RealSettingsNav {...props} />
  return (
    <RealSettingsNav
      {...props}
      groups={props.groups.map((group) =>
        group.map((item) => (item.title === 'Skills' ? { ...item, title: TITLE, icon: 'plug' as const } : item)),
      )}
    />
  )
}
