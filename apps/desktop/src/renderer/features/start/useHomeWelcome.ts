import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { type ConnectionList, inkFor, type Machine, type ProjectInk, type Status } from '@althar/contracts'
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
import { useProjectsHere } from '../../shared/projectsHere'
import { hostsCode, serviceBrand, serviceName, serviceOfProduct } from '../connections/ways'
import { type Draft, draftsOf } from '../newProject/draft'
import { LAST_WITHOUT_MAKING_PROJECTS, LAST_WITHOUT_SETTING_UP } from '../../../homes'
import { useHomeState, useHomeUpdating } from '../homes/useHomes'

/*
 * A home with no projects, on another computer: what its welcome reads from
 * the home (what the machine is, its agents and how each is signed in there,
 * git, the code hosts it's connected to, the repositories it finds on its
 * disk), this computer's projects whose code is on a host, and where each
 * way in goes: the New project tab, with the way chosen, and a repository's
 * address pasted anywhere chosen to clone. An agent signs in, and a code
 * host connects, in place, where the home lets the window do it.
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

/** A need's place in the list: what isn't ready first, then a code host to connect, then what is. */
const URGENCY: Record<WelcomeNeed['state'], number> = { unchecked: 0, signedOut: 1, missing: 2, connect: 3, ready: 4 }

/** The code hosts offered to connect where the home has none: those most code is on. */
const OFFERED = ['github', 'gitlab'] as const

/**
 * What work on the home needs, as it stands there: its agents (those
 * installed, or, where none is, those Althar can say how to install), git,
 * and the code hosts it's connected to, or, where it's connected to none and
 * the window can connect one (`connects`), GitHub and GitLab to connect.
 * Null until its agents are read.
 */
export const needsOf = (
  status: Status | null,
  machine: Machine | null,
  list: ConnectionList | null,
  connects = false,
): WelcomeNeed[] | null => {
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
  const hosts = (list?.connections ?? []).filter(
    (connection) => connection.state === 'ready' && hostsCode(serviceOfProduct(connection.product)),
  )
  for (const connection of hosts)
    needs.push({
      id: connection.id,
      name: connection.name,
      brand: productBrand(connection.product),
      state: 'ready',
      note: `as ${connection.account.login}`,
    })
  if (connects && list !== null && hosts.length === 0)
    for (const service of OFFERED) needs.push({ id: service, name: serviceName(service), brand: serviceBrand(service), state: 'connect' })
  return needs.sort((a, b) => URGENCY[a.state] - URGENCY[b.state])
}

/** A repository's address, as it's pasted: a web or SSH address with an owner and a name. Anything else isn't taken. */
export const pastedRepository = (text: string) => (/^(?:https?:\/\/|ssh:\/\/|git@)\S+$/.test(text.trim()) ? remoteOf(text) : null)

/**
 * The welcome's model; null while main hasn't said which home the window is on, so its name never changes under it. An
 * agent's sign-in (`signIn`) and a code host's walk in (`connect`) are the screen's, in place, offered where the home lets
 * this window do them: an older home's agents say their command for its terminal instead, and it offers no host.
 */
export const useHomeWelcome = (
  onNew: () => void,
  { signIn, connect }: { readonly signIn: (agentId: string) => void; readonly connect: (service: string) => void },
): HomeWelcomeProps | null => {
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
  const signsIn = canCall(client, 'StartAccountSignIn')
  const connects = canCall(client, 'ConnectToken')
  // One that makes projects but can't be set up from here (its agents signed in, its code hosts connected) is offered its
  // update for that too, under what it has, once a release that brings it is out.
  const behind = makes && !(signsIn && connects)
  const updating = useHomeUpdating(!makes || behind, markTouredHere, makes ? LAST_WITHOUT_SETTING_UP : LAST_WITHOUT_MAKING_PROJECTS)
  const ways = {
    ...(updating.onUpdate === undefined ? {} : { onUpdate: updating.onUpdate }),
    ...(updating.onCancelUpdate === undefined ? {} : { onCancelUpdate: updating.onCancelUpdate }),
    onCheckAgain: updating.onCheckAgain,
  }
  // This computer's projects with their code on a host: a door of their own, each project once.
  const projectsHere = useProjectsHere()
  const fromHere = [...new Map(projectsHere.map((one) => [one.projectId, one])).values()]
  const home = here !== null && here.current.kind !== 'local' ? here.current.home : null

  /** The New project tab, its draft on the way chosen. */
  const enter = (change: (draft: Draft) => Draft) => {
    const drafts = draftsOf(client)
    const draft = drafts.start()
    drafts.change(draft.id, (now) => change({ ...now, error: null }))
    onNew()
  }
  const way: Record<HomeDoor, Draft['way']> = { clone: 'clone', here: 'clone', folder: 'folder', fresh: 'new' }

  if (host.homes !== undefined && here === null) return null
  return {
    name: home?.name ?? 'this home',
    at: home === null ? '' : home.ssh !== undefined ? home.ssh.target : new URL(home.https.origin).host,
    machine,
    ...(machine === null ? {} : { git: machine.git }),
    needs: needsOf(status, machine, list, connects),
    // The home's own repositories on its hosts, not this computer's, which have their door.
    repositories: (repositories ?? [])
      .filter((one) => !one.id.startsWith('here:'))
      .slice(0, 5)
      .map((one) => ({ id: one.id, ink: kitInk(inkFor(one.id, [])) })),
    here: fromHere.slice(0, 5).map((one) => ({ id: one.projectId, ink: kitInk(one.ink as ProjectInk) })),
    found: found.isError ? 'failed' : (found.data?.repositories.map((one) => one.where) ?? null),
    ...(!makes
      ? { update: updating.offer, ...ways }
      : behind && updating.offer.release === undefined
        ? { behind: updating.offer, ...ways }
        : {}),
    ...(signsIn ? { onSignIn: signIn } : {}),
    ...(connects ? { onConnect: connect } : {}),
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
