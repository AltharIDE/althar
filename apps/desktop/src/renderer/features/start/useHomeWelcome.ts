import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { type ConnectionList, inkFor, type Machine, type Status } from '@althar/contracts'
import type { HomeDoor, HomeWelcomeProps, WelcomeNeed } from '@althar/ui/screens'

import { canCall } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { brandOf } from '../../shared/agents'
import { useFound } from '../../shared/found'
import { useHostRepositories } from '../../shared/hostRepositories'
import { kitInk } from '../../shared/inks'
import { productBrand } from '../../shared/products'
import { remoteOf } from '../../shared/remotes'
import { hostsCode, serviceOfProduct } from '../connections/ways'
import { type Draft, draftsOf } from '../newProject/draft'
import { useHomeState, useHomeUpdating } from '../homes/useHomes'
import { useSettingsWays } from '../settings/open'

/*
 * A home with no projects, on another computer: what its welcome reads from
 * the home (what the machine is, its agents and how each is signed in there,
 * git, the code hosts it's connected to, the repositories it finds on its
 * disk) and where each way in goes: the New project tab, with the way chosen,
 * and a repository's address pasted anywhere chosen to clone.
 */

/** Seen once on a home, its tour is left out after. Each home's window keeps its own storage. */
const TOURED = 'althar.homeToured'

const touredHere = () => {
  try {
    return window.localStorage.getItem(TOURED) === '1'
  } catch {
    return false
  }
}

const markTouredHere = () => {
  try {
    window.localStorage.setItem(TOURED, '1')
  } catch {
    // Shown once more.
  }
}

/** Where git is had, where a home has none. */
const GIT_GUIDE = 'https://git-scm.com/downloads'

/** A need's place in the list: what isn't ready first, then what is. */
const URGENCY: Record<WelcomeNeed['state'], number> = { unchecked: 0, signedOut: 1, missing: 2, ready: 3 }

/**
 * What work on the home needs, as it stands there: its agents (those
 * installed, or, where none is, those Althar can say how to install), git,
 * and the code hosts it's connected to. Null until its agents are read.
 */
export const needsOf = (status: Status | null, machine: Machine | null, list: ConnectionList | null): WelcomeNeed[] | null => {
  if (status === null) return null
  const agents = status.agents.filter((agent) => agent.id !== 'copilot-direct')
  const installed = agents.filter((agent) => agent.installed)
  const shown = installed.length > 0 ? installed : agents.filter((agent) => agent.guide !== null).slice(0, 2)
  const needs: WelcomeNeed[] = shown.map((agent) => {
    const brand = brandOf(agent.id)
    const base = { id: agent.id, name: agent.name, ...(brand === undefined ? {} : { brand }) }
    if (agent.problem !== null) return { ...base, state: 'unchecked', why: agent.problem }
    if (!agent.installed) return { ...base, state: 'missing', ...(agent.guide === null ? {} : { guide: agent.guide }) }
    if (agent.signIn === 'signed_out') return { ...base, state: 'signedOut', command: agent.login }
    if (agent.signIn === 'unknown') return { ...base, state: 'unchecked', why: 'Sign-in not checked' }
    return { ...base, state: 'ready', ...(agent.version === null ? {} : { note: agent.version }) }
  })
  if (machine !== null)
    needs.push(
      machine.git === null
        ? { id: 'git', name: 'git', icon: 'branch', state: 'missing', guide: GIT_GUIDE }
        : { id: 'git', name: 'git', icon: 'branch', state: 'ready', note: machine.git },
    )
  for (const connection of list?.connections ?? [])
    if (connection.state === 'ready' && hostsCode(serviceOfProduct(connection.product)))
      needs.push({
        id: connection.id,
        name: connection.name,
        brand: productBrand(connection.product),
        state: 'ready',
        note: `as ${connection.account.login}`,
      })
  return needs.sort((a, b) => URGENCY[a.state] - URGENCY[b.state])
}

/** A repository's address, as it's pasted: a web or SSH address with an owner and a name. Anything else isn't taken. */
export const pastedRepository = (text: string) => (/^(?:https?:\/\/|ssh:\/\/|git@)\S+$/.test(text.trim()) ? remoteOf(text) : null)

/** The welcome's model; null while main hasn't said which home the window is on, so its name never changes under it. */
export const useHomeWelcome = (onNew: () => void): HomeWelcomeProps | null => {
  const { client, host } = useServices()
  const read = reads(client)
  const here = useHomeState(host.homes)
  // A home from before windows made projects there says neither what it is nor what it finds: it's asked to update.
  const makes = canCall(client, 'FindHomeFolders')
  const status = useQuery(read.status()).data ?? null
  const machine =
    useQuery({ queryKey: ['machine'], queryFn: () => client.getMachine(), staleTime: 60_000, enabled: canCall(client, 'GetMachine') })
      .data ?? null
  const list = useQuery({ ...read.connections(), enabled: canCall(client, 'ListConnections') }).data ?? null
  const found = useFound(makes)
  const { repositories } = useHostRepositories(list, '')
  const [toured] = useState(touredHere)
  // Updated from here, the window reconnects onto the ways in: the tour is for another visit.
  const updating = useHomeUpdating(!makes, markTouredHere)
  const settings = useSettingsWays()
  const home = here !== null && here.current.kind !== 'local' ? here.current.home : null

  /** The New project tab, its draft on the way chosen. */
  const enter = (change: (draft: Draft) => Draft) => {
    const drafts = draftsOf(client)
    const draft = drafts.start()
    drafts.change(draft.id, (now) => change({ ...now, error: null }))
    onNew()
  }
  const way: Record<HomeDoor, Draft['way']> = { clone: 'clone', folder: 'folder', fresh: 'new' }

  if (host.homes !== undefined && here === null) return null
  return {
    name: home?.name ?? 'this home',
    at: home === null ? '' : home.ssh !== undefined ? home.ssh.target : new URL(home.https.origin).host,
    machine,
    ...(machine === null ? {} : { git: machine.git }),
    needs: needsOf(status, machine, list),
    repositories: (repositories ?? []).slice(0, 5).map((one) => ({ id: one.id, ink: kitInk(inkFor(one.id, [])) })),
    found: found.isError ? 'failed' : (found.data?.repositories.map((one) => one.where) ?? null),
    ...(makes
      ? {}
      : {
          update: updating.offer,
          ...(updating.onUpdate === undefined ? {} : { onUpdate: updating.onUpdate }),
          ...(updating.onCancelUpdate === undefined ? {} : { onCancelUpdate: updating.onCancelUpdate }),
          onCheckAgain: updating.onCheckAgain,
        }),
    onSignIn: (agentId) => settings.signIn(agentId),
    onDoor: (door) => enter((now) => ({ ...now, way: way[door] })),
    onPaste: (text) => {
      const ref = pastedRepository(text)
      if (ref === null) return false
      const name = ref.path.split('/').at(-1) ?? ref.path
      enter((now) => ({
        ...now,
        way: 'clone',
        query: text,
        clone: { id: `url:${text}`, remote: ref.path, from: { url: text }, product: null, hostName: ref.host, host: ref.host, here: null },
        name: now.name.trim() === '' ? name.replace(/^./, (first) => first.toUpperCase()) : now.name,
      }))
      return true
    },
    toured,
    onToured: markTouredHere,
    onCopy: (command) => void navigator.clipboard.writeText(command).catch(() => undefined),
    onGuide: (url) => void window.open(url, '_blank'),
  }
}
