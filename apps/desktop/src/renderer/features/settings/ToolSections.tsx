import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import type { SyncedAgent } from '@althar/contracts'
import {
  AddServerDialog,
  AddSkillDialog,
  type NewServerView,
  ServerSheet,
  type ServerStarter,
  ServerTiles,
  SkillSheet,
  SkillTiles,
  type ToolRoleId,
} from '@althar/ui'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { messageOf } from '../../data/client'
import type { StartModel } from '../start/useStart'
import s from './Settings.module.css'
import { text } from './text'
import { agentsOf, filesOf, projectsOf, serverTileOf, skillTileOf, syncOf, toolId } from './tools'
import { useAgentTools } from './useAgentTools'
import { useSkills } from './useSkills'

/*
 * Settings › MCP servers and Settings › Skills (ADR-097): the person's servers and skills as tiles, a repository's own
 * beside them, and their agents outside Althar. A tile's round switch gives it to every role or none; its name opens it
 * in place, and back returns to the tile. Each read says while it is under way, and says in words where it failed.
 */

/** The projects as the tiles name them, and the three agents with where each keeps its own. */
const useToolPeople = (start: StartModel, tools: ReturnType<typeof useAgentTools>['tools']) => {
  const { client } = useServices()
  const projects = useQuery(reads(client).projects()).data?.projects ?? []
  return { projects: projectsOf(projects), agents: agentsOf(tools, start.status?.agents ?? []) }
}

/** An opened server: each agent's own file, read when it opens, and its tools counted. */
function ServerOpened({
  id,
  name,
  repository,
  back,
  model,
  people,
  sync,
}: {
  id: string
  name: string
  repository: string | null
  back: () => void
  model: ReturnType<typeof useAgentTools>
  people: ReturnType<typeof useToolPeople>
  sync: boolean
}) {
  const { client } = useServices()
  const row = model.tools?.servers.find((one) => toolId(one) === id)
  const detail = useQuery(reads(client).serverDetail(name, repository))
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  if (row === undefined) return null
  const tile = serverTileOf(row)
  const own = repository === null
  return (
    <ServerSheet
      server={tile}
      agents={people.agents}
      projects={people.projects}
      sync={sync}
      files={detail.data === undefined ? null : filesOf(detail.data)}
      {...(detail.isError ? { filesError: messageOf(detail.error), onRetryFiles: () => void detail.refetch() } : {})}
      tools={detail.data?.tools ?? null}
      onBack={back}
      onRoles={(roles: readonly ToolRoleId[]) => model.setRoles('server', name, roles, repository)}
      onProject={(project, on) => model.setInProject('server', name, project, on)}
      {...(own
        ? {
            onKeepOut: (agent: string, out: boolean) => model.keep('server', agent as SyncedAgent, name, out),
            onUseWay: (agent: string) => model.pick('server', name, agent as SyncedAgent),
            onSignIn: (agent: string) => model.signIn(agent as SyncedAgent, name),
            onRemove: () => {
              setRemoving(true)
              setRemoveError(null)
              void model.remove(name).then((failed) => {
                setRemoving(false)
                if (failed === null) back()
                else setRemoveError(failed)
              })
            },
          }
        : {})}
      removing={removing}
      removeError={removeError}
    />
  )
}

/** The person's MCP servers: which roles and projects get each, what each agent's own file says of it, adding and removing one. */
export function ServersSection({ start }: { start: StartModel }) {
  const model = useAgentTools({ check: true })
  const { tools } = model
  const people = useToolPeople(start, tools)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ readonly start: ServerStarter | null } | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const servers = tools?.servers.map(serverTileOf) ?? []
  if (tools !== undefined && !tools.enabled) return <p className={s.quiet}>{text.agentToolsOff}</p>
  return (
    <>
      {model.error !== null && (
        <p role="alert" className={s.failed}>
          {model.error}
        </p>
      )}
      <ServerTiles
        servers={servers}
        agents={people.agents}
        projects={people.projects}
        sync={tools === undefined ? { on: false, targets: [] } : syncOf(tools.serverSync)}
        loading={tools === undefined && !model.loadFailed}
        error={model.loadFailed ? text.serversUnread : null}
        onRetry={model.reload}
        open={open}
        onOpenChange={setOpen}
        sheet={(server, back) => (
          <ServerOpened
            id={server.id}
            name={server.name}
            repository={server.repository}
            back={back}
            model={model}
            people={people}
            sync={tools?.serverSync.on === true}
          />
        )}
        onRoles={(server, roles) => model.setRoles('server', server.name, roles, server.repository)}
        onAdd={(starter) => {
          setAddError(null)
          setAdding({ start: starter })
        }}
        onSync={(on, takeBack) => model.setSync('server', on, takeBack)}
        onUndo={model.undo}
      />
      {adding !== null && (
        <AddServerDialog
          start={adding.start}
          sync={tools?.serverSync.on === true}
          agents={people.agents}
          taken={servers.filter((one) => one.repository === null).map((one) => one.name)}
          busy={model.busy}
          error={addError}
          onAdd={(server: NewServerView, agents) => {
            setAddError(null)
            void model.add(server, agents as ReadonlyArray<SyncedAgent>).then((failed) => {
              if (failed === null) setAdding(null)
              else setAddError(failed)
            })
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  )
}

/** The person's skills: a tile each, a repository's own beside them, and adding one from GitHub. */
export function SkillsSection({ start }: { start: StartModel }) {
  const model = useAgentTools()
  const skills = useSkills({ check: true })
  const { tools } = model
  const people = useToolPeople(start, tools)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // Added, the dialog that found it shuts; the tiles read again and show it.
  const seen = useRef(skills.added)
  useEffect(() => {
    if (skills.added === seen.current) return
    seen.current = skills.added
    setAdding(false)
    model.reload()
  }, [skills.added, model])
  if (tools !== undefined && !tools.enabled && !skills.enabled) return <p className={s.quiet}>{text.skillsOff}</p>
  const tiles = (tools?.skills ?? []).map((row) => skillTileOf(row, skills.available.includes(row.name)))
  // Reviewing a newer version, or finding one to add, takes the dialog; it shuts once the skill is added.
  const reviewing = adding || skills.card !== null
  return (
    <>
      {(model.error ?? skills.error) !== null && skills.card === null && !adding && (
        <p role="alert" className={s.failed}>
          {model.error ?? skills.error}
        </p>
      )}
      <SkillTiles
        skills={tiles}
        agents={people.agents}
        projects={people.projects}
        sync={tools === undefined ? { on: false, targets: [] } : syncOf(tools.skillSync)}
        loading={(tools === undefined && !model.loadFailed) || (!skills.loaded && !skills.loadFailed)}
        error={model.loadFailed || skills.loadFailed ? text.skillsUnread : null}
        onRetry={() => {
          model.reload()
          skills.reload()
        }}
        open={open}
        onOpenChange={setOpen}
        sheet={(skill, back) => (
          <SkillSheet
            skill={skill}
            agents={people.agents}
            projects={people.projects}
            onBack={back}
            onRoles={(roles) => model.setRoles('skill', skill.name, roles, skill.repository)}
            onProject={(project, on) => model.setInProject('skill', skill.name, project, on)}
            {...(skill.update ? { onUpdate: () => skills.reviewUpdate(skill.name) } : {})}
            {...(skill.from === null
              ? {}
              : {
                  onRemove: () => {
                    skills.remove(skill.name)
                    // The store reads again once it is gone; what couldn't be said is said above the tiles.
                    back()
                  },
                })}
            removing={skills.busy}
          />
        )}
        onRoles={(skill, roles) => model.setRoles('skill', skill.name, roles, skill.repository)}
        onAdd={() => setAdding(true)}
        onSync={(on, takeBack) => model.setSync('skill', on, takeBack)}
      />
      {reviewing && (
        <AddSkillDialog
          found={skills.found}
          busy={skills.busy}
          error={skills.error}
          card={skills.card}
          onFind={skills.find}
          onReview={skills.review}
          onInstall={skills.install}
          onBack={skills.cancel}
          onClose={() => {
            skills.cancel()
            setAdding(false)
          }}
        />
      )}
    </>
  )
}
