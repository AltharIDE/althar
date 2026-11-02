import type { ReactNode } from 'react'

import type { AccessLine, AccessReason, ConnectionCheck, ConnectPlace, Product, Service } from '@althar/contracts'
import {
  Button,
  CanState,
  ConnectActions,
  type ConnectCan,
  ConnectCard,
  ConnectChecks,
  ConnectClip,
  ConnectCode,
  ConnectFacts,
  ConnectField,
  ConnectFound,
  ConnectPerms,
  ConnectSteps,
  ConnectText,
  ConnectWaiting,
  type ConnectWayOption,
  ConnectWays,
  CopyButton,
  LinkButton,
  Skeleton,
} from '@althar/ui'

import { device } from '../../shared/device'
import s from './Connections.module.css'
import type { ConnectModel } from './useConnect'
import { hostOf, hostsCode, ownerOf, placesAt, serviceBrand, serviceName, type StepKind, type Way } from './ways'

/*
 * The walk in to a service, drawn with the kit's card: the ways in first,
 * then each step of the way chosen, then what the connection can do. Every
 * word here is the walk's; what the service said comes in its own words.
 * It is hosted by Settings, in its panel narrowed to a card, and beside a
 * project's or a task's work (ConnectPanel, ConnectDialog).
 */

/** A list in words: a, a and b, a, b and c. */
const and = (items: ReadonlyArray<string>): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.slice(-1).join('')}`

/** The repositories of some places by their paths; on GitHub, whose token is made for one owner, by name where they share it. */
const repositoriesIn = (places: ReadonlyArray<ConnectPlace>): ReadonlyArray<string> => {
  const paths = [...new Set(places.flatMap((place) => place.repositories))]
  const github = places.every((place) => place.product === 'github')
  return !github || ownerOf(places) === undefined ? paths : paths.map((path) => path.split('/').slice(1).join('/'))
}

/** Repositories by name, two at most; more, as a count. */
const named = (paths: ReadonlyArray<string>) => (paths.length <= 2 ? and(paths) : `${paths.length} repositories`)

/** Repositories to pick on the service's page, past two: one to a line. */
const Names = ({ paths }: { paths: ReadonlyArray<string> }) =>
  paths.length <= 2 ? null : (
    <ul className={s.names}>
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  )

/** Repositories in a step's words: two at most by name; more, counted. */
const these = (paths: ReadonlyArray<string>) => (paths.length <= 2 ? and(paths) : `these ${paths.length}`)

/** A step that picks repositories: its words, and past two, the list under them. */
const toPick = (paths: ReadonlyArray<string>, words: (names: string) => string): ReactNode => (
  <>
    {words(these(paths))}
    <Names paths={paths} />
  </>
)

const projectsIn = (places: ReadonlyArray<ConnectPlace>) => [...new Set(places.map((place) => place.project))]

/** Projects by name, two at most; more, as a count. */
const projectsWords = (projects: ReadonlyArray<string>) => (projects.length <= 2 ? and(projects) : `${projects.length} projects`)

/** A product's name for what it opens: pull requests, or GitLab's merge requests. */
const changes = (product: Product) => (product === 'gitlab' ? 'merge requests' : 'pull requests')

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

const minutesLeft = (iso: string | null, now = Date.now()) =>
  iso === null ? null : Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000))

export const text = {
  connect: (service: string) => `Connect ${service}`,
  again: (service: string) => `Sign in to ${service} again`,
  ways: (service: string) => `Ways to connect ${service}`,
  for: (projects: ReadonlyArray<string>) => `For ${projectsWords(projects)}`,
  forRepositories: (projects: ReadonlyArray<string>, repositories: string, host: string | null) =>
    `For ${projectsWords(projects)}: ${repositories}${host === null ? '' : ` on ${host}`}`,
  forMany: (projects: ReadonlyArray<string>, count: number) => `For ${projectsWords(projects)}: ${count} repositories`,
  hostsFor: 'Pull requests, their checks and review comments',
  trackersFor: 'Issues become tasks, and tasks move their issues',
  kept: `Kept encrypted on ${device.this}`,
  stopped: 'Its token stopped working.',
  anotherWay: 'Another way',
  ownServer: 'On a company’s own server',
  reading: 'Finding the ways in',

  /* the ways in */
  continueWith: (service: string) => `Continue with ${service}`,
  approveThenLet: (owner: string) => `Approve in your browser, then let Althar into ${owner}`,
  approve: 'Approve in your browser',
  inYourBrowser: (host: string) => `${host}, in your browser`,
  useCli: (tool: string) => `Use ${tool}’s sign-in`,
  cliHere: (account: string) => `Signed in as ${account} on ${device.this}`,
  cliAt: (host: string, account: string) => `Signed in to ${host} as ${account}`,
  makeToken: 'Make a token',
  tokenPage: (service: string) => `On ${service}’s token page, opened filled in`,
  atlassianToken: 'An Atlassian API token',
  atlassianLine: 'Made on your Atlassian account, with your account’s email',
  newToken: 'A new token',
  madeOn: (host: string) => `Made on ${host}`,
  linearKey: 'A personal API key',
  linearLine: 'Made in Linear’s settings',
  trelloKey: 'A Power-Up key and a token',
  trelloLine: 'A key of yours on Trello, then a token you allow for it',
  serverLine: (project: string) => `${project}’s server, from its remote`,
  site: 'Its site',
  siteLine: 'Jira Cloud or Data Center, by its address',

  /* the browser */
  typeCode: (service: string) => `Type this code on ${service}`,
  codeOpen: (page: string) => `Type it on ${page}, then Authorize Althar.`,
  waitingApprove: (minutes: number | null) =>
    minutes === null ? 'Waiting for you to approve' : `Waiting for you to approve · the code lasts ${minutes} min`,
  openAgain: 'Open the page again',
  tryAgain: 'Try again',
  letIn: (owner: string) => `Let Althar into ${owner}`,
  notInstalled: (login: string, projects: ReadonlyArray<string>, owner: string) => (
    <>
      Signed in as <b>{login}</b>. {projectsWords(projects)}’s repositories belong to <b>{owner}</b>, where Althar isn’t installed yet.
    </>
  ),
  install: (owner: string) => `Install Althar on ${owner}`,
  installSteps: (repositories: ReadonlyArray<string>) => [
    'Choose Only select repositories.',
    toPick(repositories, (names) => `Pick ${names}.`),
    'Install.',
  ],
  waitingFor: (who: string) => `Waiting for ${who}`,
  ownersApprove: (owner: string) => `If you don’t own ${owner}, its owners approve it first.`,
  approveOn: (service: string) => `Approve Althar on ${service}`,
  approveOpen: (host: string) => `Pick your workspace on ${host}, then Approve.`,
  copyLink: 'Copy the link for another browser',

  /* gh's or glab's sign-in */
  account: 'Account',
  scopes: 'Scopes',
  reaches: 'Reaches',
  accountOn: (account: string, host: string) => `${account} on ${host}`,
  reachesAll: (account: string, owner: string | undefined, host: boolean) =>
    `Every ${host ? 'repository' : 'project'} ${account} can${owner === undefined ? '' : `, ${owner}’s included`}`,
  useIt: 'Use this sign-in',

  /* a server */
  ownService: (service: string) => `Your company’s ${service}`,
  projectsService: (project: string, service: string) => `${project}’s ${service}`,
  address: 'Server address',
  siteTitle: 'Your Jira site',
  siteAddress: 'Site address',
  sitePlaceholder: 'https://your-site.atlassian.net',
  addressPlaceholder: 'https://git.example.com',
  asking: (host: string) => `Asking ${host}`,
  answers: (product: string, host: string) => `${product} answers at ${host}`,
  fromRemote: (project: string, remote: string) => ` · from ${project}’s remote, ${remote}`,
  notAnAddress: 'That isn’t a server’s address',
  nothingAt: (host: string) => `Nothing answers at ${host}`,
  notService: (host: string, service: string) => `${host} isn’t a ${service} server`,
  notSite: (host: string) => `${host} isn’t a Jira site`,
  instead: (host: string) => `${host} instead`,
  continue: 'Continue',

  /* a token */
  makeOn: (where: string) => `Make a token on ${where}`,
  makeAtlassian: 'Make an Atlassian API token',
  makeNewAtlassian: 'Make a new API token',
  makeLinear: 'Make a key in Linear',
  open: (where: string) => `Open ${where}’s token page`,
  openAtlassian: 'Open Atlassian’s API tokens',
  openLinear: 'Open Linear’s settings',
  openAccessTokens: (host: string) => `Open ${host}’s access tokens`,
  githubFilled: (owner: string | undefined) => (owner === undefined ? 'Opens filled in.' : `Opens filled in, for ${owner}.`),
  classicFilled: 'Opens with the repo and workflow scopes ticked.',
  gitlabFilled: 'Opens with the api scope ticked.',
  githubSteps: (repositories: ReadonlyArray<string> | null) => [
    repositories === null
      ? 'Under Repository access, choose the repositories Althar works in.'
      : toPick(repositories, (names) => `Under Repository access, choose Only select repositories: ${names}.`),
    'Generate token, then copy it.',
  ],
  classicSteps: ['Set when it runs out.', 'Generate token, then copy it.'],
  gitlabSteps: ['Set when it runs out.', 'Create token, then copy it.'],
  bitbucketSteps: [
    'Create API token with scopes.',
    'Name it Althar, and set when it runs out.',
    'Choose Bitbucket as the app, then tick the scopes below.',
    'Create, then copy the token.',
  ],
  bitbucketServerSteps: ['Create token, named Althar.', 'Give it Project read and Repository write.', 'Create, then copy it.'],
  jiraSteps: ['Create API token.', 'Name it Althar, and set when it runs out: a year at most.', 'Create, then copy it.'],
  jiraServerSteps: ['Create token, named Althar.', 'Set when it runs out.', 'Create, then copy it.'],
  linearSteps: ['Under Personal API keys, New key: name it Althar.', 'Create, then copy it.'],
  scopesToTick: 'The scopes to tick',
  waitingClipboard: 'Waiting for a token on the clipboard',
  pasteMyself: 'Paste it myself',
  pasteIt: 'Paste it',

  /* Trello */
  trelloKeyTitle: 'Make a Power-Up key on Trello',
  openPowerUps: 'Open Trello’s Power-Up admin',
  trelloKeySteps: [
    'New: name it Althar, choose your Workspace, Create.',
    'API key › Generate a new API key.',
    'Copy the API key, not the secret beside it.',
  ],
  keyField: 'Power-Up API key',
  keyPlaceholder: '32 characters',
  allowTitle: 'Allow Althar on Trello',
  openAllow: 'Open Trello’s allow page',
  madeForKey: (last: string) => `Made for your key ····${last}: Althar, read and write, no expiry.`,
  allowSteps: ['Allow.', 'Trello shows a token. Copy it.'],

  /* pasting */
  pasteToken: 'Paste the token',
  pasteNewToken: 'Paste the new token',
  pasteKey: 'Paste the key',
  pasteTrello: 'Paste the token Trello showed',
  email: 'Your Atlassian account’s email',
  emailFrom: (project: string | null) => (project === null ? 'From your git config' : `From ${project}’s git config`),
  orPaste: 'Or paste it',
  check: 'Check',
  keptToken: `Kept encrypted on ${device.this}.`,
  looksLike: (service: string, product: Product) =>
    product === 'bitbucket_cloud' || product === 'jira_cloud'
      ? 'An Atlassian token'
      : product === 'linear'
        ? 'A Linear key'
        : `A ${service} token`,

  /* what it can do */
  canDo: (service: string) => `What ${service} lets Althar do`,
  checking: 'Checking what it can do',
  asked: (service: string, owner: string | undefined) =>
    `Asking ${service} what this sign-in can do${owner === undefined ? '' : ` in ${owner}`}.`,
  connectedAs: (login: string) => `Connected as ${login}`,
  connectedTo: (workspace: string) => `Connected to ${workspace}`,
  isBack: (service: string) => `${service} is back`,
  didntTake: (service: string) => `${service} didn’t take that token`,
  didntWork: 'That token didn’t work',
  didntAnswer: (service: string) => `${service} didn’t answer`,
  cantPush: 'This token can’t push',
  roleCantPush: 'Your account can’t push there',
  cantOpen: (noun: string) => `This token can’t open ${noun}`,
  cantReadRuns: 'This token can’t read check runs',
  cantReadChecks: 'This token can’t read checks',
  cantReadIssues: 'This token can’t read issues',
  cantChangeIssues: 'This token can’t change issues',
  roleCantChange: 'Your account can’t change issues there',
  cantSee: 'It doesn’t reach every repository',
  restrictedTitle: (owner: string) => `${owner} keeps gh’s sign-in out`,
  ssoTitle: (owner: string) => `${owner} wants this token authorized`,
  notEverything: 'It can’t do everything Althar needs',

  needs: {
    server: 'The server',
    site: 'Site',
    key: 'A Power-Up API key',
    reach: (repositories: string) => `Reaches ${repositories}`,
    reachAll: 'Reaches the projects’ repositories',
    push: 'Push a task’s branch',
    changes: (noun: string) => `Open, update and merge ${noun}`,
    checks: (product: Product) =>
      product === 'gitlab'
        ? 'Read pipelines and job logs'
        : product === 'bitbucket_cloud' || product === 'bitbucket_dc'
          ? 'Read build statuses and pipeline logs'
          : 'Read checks and a failed job’s log',
    issues: 'Read issues and comment on them',
    read: (product: Product) =>
      product === 'trello' ? 'Reads your boards' : product === 'linear' ? 'Reads your workspace’s issues' : 'Reads its issues',
    comment: (product: Product) => (product === 'trello' ? 'Comments on cards' : 'Comments on issues'),
    move: (product: Product) =>
      product === 'trello'
        ? 'Moves cards between lists'
        : product === 'linear'
          ? 'Moves an issue’s status'
          : 'Moves them through their workflow',
    account: (product: Product, service: string, hosted: boolean) =>
      product === 'bitbucket_cloud' || product === 'jira_cloud'
        ? 'Your Atlassian account'
        : hosted
          ? `Your ${service} account`
          : 'Your account there',
  },
  counted: (product: Product, count: number) => {
    const noun = product === 'trello' ? 'board' : product === 'linear' ? 'team' : 'project'
    return count === 1 ? `1 ${noun}` : `${count} ${noun}s`
  },
  why: {
    refused: (service: string) => `${service} didn’t take this token: it may be mistyped, revoked or run out.`,
    scope: (scope: string) => `The token wasn’t given the ${scope} scope.`,
    permission: (permission: string) => `${permission} isn’t allowed on this token.`,
    role: (role: string | null) => (role === null ? 'Your account can’t do this there.' : `As ${role}, your account can’t do this there.`),
    unseen: (names: ReadonlyArray<string>) => `It doesn’t see ${named(names)}.`,
    notInstalled: (owner: string) => `Althar isn’t installed on ${owner} yet.`,
    restricted: (owner: string) => `${owner} keeps out apps that sign in with OAuth, gh among them, until its owners approve one.`,
    sso: (owner: string) => `${owner} signs in with SAML: the token needs authorizing for it.`,
    noCheckRuns: 'Fine-grained tokens can’t read check runs.',
    unreadable: (service: string) => `${service} doesn’t say what this token may change.`,
  },
  fix: {
    githubSet: (what: string) => `Set ${what}, then Update.`,
    githubAdd: (names: ReadonlyArray<string>) => `Add ${these(names)} under Repository access, then Update.`,
    githubScope: (scope: string) => `Tick ${scope}, then Update token.`,
    remake: (service: string, scope: string) => `A ${service} token keeps the scopes it was made with: make one with ${scope}.`,
    restricted: (owner: string) => `Its owners can approve GitHub CLI for ${owner}, or you can make a token instead.`,
    sso: (owner: string) => `Authorize the token for ${owner} on GitHub, then check again.`,
    classic: 'A classic token reads them.',
    role: 'Your account’s role there: its owners can change it.',
    changeOn: (service: string) => `Change it on ${service}`,
    checkAgain: 'Check again',
    asItIs: 'Connect as it is',
    makeNew: 'Make a new one',
    pasteAnother: 'Paste another',
    tokenInstead: 'Make a token instead',
    authorize: (owner: string) => `Authorize it for ${owner}`,
    classicToken: 'Make a classic token',
  },
  expires: {
    renews: (service: string) => `Through Althar’s ${service} app; renews itself.`,
    cli: (tool: string) => `${tool}’s token; it runs out when ${tool}’s does.`,
    on: (date: string) => `The token runs out on ${date}.`,
    never: 'The token doesn’t run out.',
  },
  done: 'Done',
}

/** What the header beside the card says: the service, and the projects it is for, or the connection's site. */
export const connectHead = (model: ConnectModel): { readonly title: string; readonly aside?: string } => {
  const title = serviceName(model.service)
  if (model.again !== null) return { title, aside: hostOf(model.again.webUrl) }
  const projects = projectsIn(model.guide?.places ?? [])
  return projects.length === 0 ? { title } : { title, aside: text.for(projects) }
}

/** The line under the card's heading on the ways in: what it is for. */
const forLine = (service: Service, places: ReadonlyArray<ConnectPlace>): string => {
  if (places.length === 0) return hostsCode(service) ? text.hostsFor : text.trackersFor
  const projects = projectsIn(places)
  const instances = [...new Set(places.map((place) => place.webUrl))]
  const paths = [...new Set(places.flatMap((place) => place.repositories))]
  if (paths.length > 2) return text.forMany(projects, paths.length)
  const [only] = instances
  const server = instances.length === 1 && only !== undefined && !/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)$/.test(only)
  return text.forRepositories(projects, and(paths), server && only !== undefined ? hostOf(only) : null)
}

/** A way in, as the card offers it. */
const wayOption = (way: Way, model: ConnectModel): ConnectWayOption => {
  const service = serviceName(model.service)
  const places = model.guide?.places ?? []
  const host = way.webUrl === null ? '' : hostOf(way.webUrl)
  switch (way.kind) {
    case 'browser': {
      const owner = ownerOf(placesAt(places, way.product, way.webUrl ?? ''))
      const line =
        way.product === 'github'
          ? owner === undefined
            ? text.approve
            : text.approveThenLet(owner)
          : way.product === 'gitlab'
            ? text.inYourBrowser(host)
            : text.approve
      return { id: way.id, title: text.continueWith(service), line, brand: serviceBrand(model.service) }
    }
    case 'cli': {
      const line = way.webUrl === 'https://github.com' ? text.cliHere(way.cli.account) : text.cliAt(host, way.cli.account)
      return { id: way.id, title: text.useCli(way.cli.tool), line, icon: 'terminal' }
    }
    case 'token':
      return { id: way.id, ...tokenWords(way, model), icon: 'lock' }
    case 'key':
      return { id: way.id, title: text.trelloKey, line: text.trelloLine, icon: 'lock' }
    case 'server':
      return { id: way.id, title: host, line: text.serverLine(way.place?.project ?? host), icon: 'globe' }
    case 'site':
      return { id: way.id, title: text.site, line: text.siteLine, icon: 'globe' }
  }
}

/**
 * A token way's words, by its product. Signing a connection in again, a
 * token is listed only beside gh's or glab's sign-in, so for GitHub or
 * GitLab; the ways in a walk in are each hosted service's token.
 */
const tokenWords = (way: Way, model: ConnectModel): { readonly title: string; readonly line: string } => {
  const host = hostOf(way.webUrl ?? '')
  if (model.again !== null) return { title: text.newToken, line: text.madeOn(host) }
  switch (way.product) {
    case 'bitbucket_cloud':
      return { title: text.atlassianToken, line: text.atlassianLine }
    case 'linear':
      return { title: text.linearKey, line: text.linearLine }
    default:
      return { title: text.makeToken, line: text.tokenPage(way.product === 'github' ? 'GitHub' : host) }
  }
}

/** A step's heading. */
const stepTitle = (model: ConnectModel, step: StepKind, way: Way): string => {
  const service = serviceName(model.service)
  const product = model.instance?.product ?? way.product
  const host = hostOf(model.instance?.webUrl ?? way.webUrl ?? '')
  const places = model.guide?.places ?? []
  switch (step) {
    case 'code':
      return text.typeCode(service)
    case 'install':
      return text.letIn(ownerOf(placesAt(places, product, way.webUrl ?? '')) ?? service)
    case 'approve':
      return text.approveOn(service)
    case 'cli':
      return text.useCli(way.kind === 'cli' ? way.cli.tool : 'gh')
    case 'server':
      return way.place === undefined ? text.ownService(service) : text.projectsService(way.place.project, service)
    case 'site':
      return text.siteTitle
    case 'key':
      return text.trelloKeyTitle
    case 'make':
      switch (product) {
        case 'bitbucket_cloud':
          return text.makeAtlassian
        case 'jira_cloud':
          return model.again === null ? text.makeAtlassian : text.makeNewAtlassian
        case 'linear':
          return text.makeLinear
        case 'github':
          return text.makeOn(host === 'github.com' ? 'GitHub' : host)
        default:
          return text.makeOn(host)
      }
    case 'allow':
      return text.allowTitle
    case 'paste':
      return product === 'linear'
        ? text.pasteKey
        : product === 'trello'
          ? text.pasteTrello
          : model.again === null
            ? text.pasteToken
            : text.pasteNewToken
    case 'check':
      return checkTitle(model, product)
  }
}

const NEEDS: Readonly<Record<Product, ReadonlyArray<AccessLine['need']>>> = {
  github: ['account', 'reach', 'push', 'changes', 'checks', 'issues'],
  gitlab: ['server', 'account', 'reach', 'push', 'changes', 'checks', 'issues'],
  bitbucket_cloud: ['account', 'reach', 'push', 'changes', 'checks'],
  bitbucket_dc: ['server', 'account', 'reach', 'push', 'changes'],
  linear: ['account', 'read', 'comment', 'move'],
  jira_cloud: ['site', 'account', 'read', 'comment', 'move'],
  jira_dc: ['site', 'account', 'read', 'comment', 'move'],
  trello: ['key', 'account', 'read', 'comment', 'move'],
}

/** The lines a product's check has, in its order, before the service has said anything: no server on a hosted service, no reach where no repositories are known. */
const needsOf = (product: Product, hosted: boolean, reaches: boolean): ReadonlyArray<AccessLine['need']> =>
  NEEDS[product].filter((need) => (need !== 'server' || !hosted) && (need !== 'reach' || reaches))

/** A line of the check, as the walk says it. */
const lineText = (need: AccessLine['need'], product: Product, model: ConnectModel, repositories: string): string => {
  const service = serviceName(model.service)
  switch (need) {
    case 'server':
      return text.needs.server
    case 'site':
      return text.needs.site
    case 'key':
      return text.needs.key
    case 'account':
      return text.needs.account(product, service, !(model.instance !== null && !isHosted(model.instance.webUrl)))
    case 'reach':
      return repositories === '' ? text.needs.reachAll : text.needs.reach(repositories)
    case 'push':
      return text.needs.push
    case 'changes':
      return text.needs.changes(changes(product))
    case 'checks':
      return text.needs.checks(product)
    case 'issues':
      return text.needs.issues
    case 'read':
      return text.needs.read(product)
    case 'comment':
      return text.needs.comment(product)
    case 'move':
      return text.needs.move(product)
  }
}

const isHosted = (webUrl: string) => /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org|linear\.app|trello\.com)$/.test(webUrl)

/** Why a line isn't ok, in the walk's words. */
const whyOf = (reason: AccessReason, line: AccessLine, product: Product, service: string): string => {
  switch (reason.kind) {
    case 'refused':
      return text.why.refused(service)
    case 'scope':
      return text.why.scope(reason.scope)
    case 'permission':
      return text.why.permission(reason.permission)
    case 'role':
      return text.why.role(reason.role)
    case 'unseen':
      return text.why.unseen(reason.names)
    case 'not_installed':
      return text.why.notInstalled(reason.owner)
    case 'restricted':
      return text.why.restricted(reason.owner)
    case 'sso':
      return text.why.sso(reason.owner)
    case 'no_check_runs':
      return text.why.noCheckRuns
    case 'unreadable':
      return text.why.unreadable(service)
    case 'failed':
      return reason.message
  }
}

const stateOf = (state: AccessLine['state']): CanState => {
  switch (state) {
    case 'ok':
      return CanState.Can
    case 'no':
      return CanState.Cannot
    case 'unknown':
      return CanState.Unknown
  }
}

/** What was found, at a line's end, as the walk says it. */
const factOf = (line: AccessLine, product: Product): string | undefined => {
  if (line.count !== null) return text.counted(product, line.count)
  if (line.fact === null) return undefined
  // Bitbucket's levels are lower case, as its API says them.
  return line.need === 'reach' && ['read', 'write', 'admin'].includes(line.fact) ? capital(line.fact) : line.fact
}

/** The check's lines, as they stand: being asked, as the service said, or stopped at a token it didn't take. */
const checkLines = (model: ConnectModel, product: Product): ReadonlyArray<ConnectCan> => {
  const service = serviceName(model.service)
  const webUrl = model.instance?.webUrl ?? ''
  const places = placesAt(model.guide?.places ?? [], product, webUrl)
  const repositories = named(repositoriesIn(places))
  const said = (need: AccessLine['need']) => lineText(need, product, model, repositories)
  if (model.check !== null)
    return model.check.lines.map((line) => {
      const fact = factOf(line, product)
      return {
        id: line.need,
        text: said(line.need),
        state: stateOf(line.state),
        ...(fact === undefined || line.state === 'no' ? {} : { fact }),
        ...(line.reason === null || line.state === 'ok' ? {} : { why: whyOf(line.reason, line, product, service) }),
      }
    })
  const needs = needsOf(product, isHosted(webUrl), places.length > 0)
  // Known before the service is asked: the server answered, the site, the key typed.
  const known = (need: AccessLine['need']): string | undefined =>
    need === 'server' || need === 'site' ? hostOf(webUrl) : need === 'key' ? `····${model.key.value.trim().slice(-4)}` : undefined
  return needs.map((need) => {
    const fact = known(need)
    if (fact !== undefined) return { id: need, text: said(need), state: CanState.Can, fact }
    if (model.refused !== null)
      return need === 'account'
        ? { id: need, text: said(need), state: CanState.Cannot, why: text.why.refused(service) }
        : { id: need, text: said(need), state: CanState.Waiting }
    if (need === 'account' && model.connection !== null && model.connection.login !== '')
      return { id: need, text: said(need), state: CanState.Can, fact: model.connection.login }
    return { id: need, text: said(need), state: model.checkError === null ? CanState.Checking : CanState.Waiting }
  })
}

/** The first line the connection can't do, if any. */
const firstNo = (model: ConnectModel) => model.check?.lines.find((line) => line.state === 'no')

const checkTitle = (model: ConnectModel, product: Product): string => {
  const service = serviceName(model.service)
  if (model.refused !== null) return model.again === null ? text.didntTake(service) : text.didntWork
  if (model.checkError !== null) return text.didntAnswer(service)
  if (model.check === null) return text.checking
  const no = firstNo(model)
  if (no === undefined) {
    if (model.again !== null && model.service === 'jira') return text.isBack(service)
    const account = model.check.lines.find((line) => line.need === 'account')?.fact ?? model.connection?.login ?? ''
    // Linear's account is the person and the workspace: who you · Northwind.
    if (product === 'linear' && account.includes(' · ')) return text.connectedTo(account.slice(account.lastIndexOf(' · ') + 3))
    return text.connectedAs(account)
  }
  const reason = no.reason
  switch (no.need) {
    case 'account':
      return model.again === null ? text.didntTake(service) : text.didntWork
    case 'server':
    case 'site':
    case 'key':
      return text.didntAnswer(service)
    case 'reach':
      return reason?.kind === 'restricted'
        ? text.restrictedTitle(reason.owner)
        : reason?.kind === 'sso'
          ? text.ssoTitle(reason.owner)
          : text.cantSee
    case 'push':
      return reason?.kind === 'role' ? text.roleCantPush : text.cantPush
    case 'changes':
      return text.cantOpen(changes(product))
    case 'checks':
      return reason?.kind === 'no_check_runs' ? text.cantReadRuns : text.cantReadChecks
    case 'issues':
    case 'read':
      return text.cantReadIssues
    case 'comment':
    case 'move':
      return reason?.kind === 'role' ? text.roleCantChange : text.cantChangeIssues
  }
}

export interface ConnectFlowProps {
  model: ConnectModel
  /** Narrow, as beside a project's work: the code smaller. */
  compact?: boolean
}

/** The walk in to a service, as a sign-in card. */
export function ConnectFlow({ model, compact = false }: ConnectFlowProps) {
  const service = serviceName(model.service)
  const brand = serviceBrand(model.service)
  const places = model.guide?.places ?? []
  const many = model.ways.length > 1

  if (model.reading)
    return (
      <ConnectCard brand={brand} title={model.again === null ? text.connect(service) : text.again(service)}>
        <output className={s.reading} aria-label={text.reading}>
          <Skeleton shape="sheet" height={54} />
          <Skeleton shape="sheet" height={54} />
        </output>
      </ConnectCard>
    )

  if (model.way === null || model.step === null) {
    return (
      <ConnectCard brand={brand} title={text.connect(service)} line={forLine(model.service, places)} foot={text.kept}>
        <ConnectWays label={text.ways(service)} ways={model.ways.map((way) => wayOption(way, model))} onChoose={model.choose} />
        {model.serverWay !== null && (
          <ConnectActions align="start">
            <LinkButton onClick={model.chooseServer}>{text.ownServer}</LinkButton>
          </ConnectActions>
        )}
      </ConnectCard>
    )
  }

  const way = model.way
  const step = model.step
  const first = model.at === 0
  const line =
    model.again !== null && first ? text.stopped : !many && first && model.again === null ? wayOption(way, model).line : undefined
  const done = step === 'check' && model.check !== null && firstNo(model) === undefined && model.refused === null
  return (
    <ConnectCard
      brand={brand}
      title={stepTitle(model, step, way)}
      pager={{ steps: way.steps.length, at: model.at }}
      done={done}
      {...(line === undefined ? {} : { line })}
    >
      <StepBody model={model} step={step} way={way} compact={compact} many={many} />
      {/* One way in, which went straight to its first step: a company's own server stays a press away. */}
      {!many && first && model.again === null && model.serverWay !== null && way.kind !== 'server' && (
        <ConnectActions align="start">
          <LinkButton onClick={model.chooseServer}>{text.ownServer}</LinkButton>
        </ConnectActions>
      )}
    </ConnectCard>
  )
}

/** What a step asks. */
function StepBody({ model, step, way, compact, many }: { model: ConnectModel; step: StepKind; way: Way; compact: boolean; many: boolean }) {
  const service = serviceName(model.service)
  const places = model.guide?.places ?? []
  const product = model.instance?.product ?? way.product
  const webUrl = model.instance?.webUrl ?? way.webUrl ?? ''
  const host = hostOf(webUrl)
  const here = placesAt(places, product, webUrl)
  const owner = ownerOf(here)
  const another = many ? <LinkButton onClick={model.anotherWay}>{text.anotherWay}</LinkButton> : null
  const waitingForToken = (option: boolean) =>
    option ? (
      <ConnectActions>
        <ConnectWaiting>{text.waitingClipboard}</ConnectWaiting>
        <LinkButton onClick={model.pasteMyself}>{text.pasteMyself}</LinkButton>
      </ConnectActions>
    ) : (
      <ConnectActions>
        <LinkButton onClick={model.pasteMyself}>{text.pasteIt}</LinkButton>
      </ConnectActions>
    )
  // The clipboard is watched only for a service whose tokens have a mark of their own.
  const watched = (model.option?.tokenPrefixes.length ?? 0) > 0
  const page = model.instance?.tokenPage ?? null
  const openPage = (label: string) =>
    page === null ? null : (
      <ConnectActions primary>
        <Button trailingIcon="external" onClick={() => model.open(page)}>
          {label}
        </Button>
      </ConnectActions>
    )

  switch (step) {
    case 'code': {
      const signIn = model.signIn
      if (signIn?.ended != null)
        return (
          <>
            <ConnectFound tone="no">{signIn.ended}</ConnectFound>
            <ConnectActions>
              <Button onClick={model.retrySignIn}>{text.tryAgain}</Button>
              {another}
            </ConnectActions>
          </>
        )
      if (signIn === null || signIn.code === null)
        return (
          <ConnectActions>
            <ConnectWaiting>{text.waitingFor(service)}</ConnectWaiting>
          </ConnectActions>
        )
      return (
        <>
          <ConnectText>{text.codeOpen(signIn.url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''))}</ConnectText>
          <ConnectCode code={signIn.code} compact={compact} />
          <ConnectActions>
            <ConnectWaiting>{text.waitingApprove(minutesLeft(signIn.expiresAt))}</ConnectWaiting>
          </ConnectActions>
          <ConnectActions>
            <LinkButton onClick={() => model.open(signIn.url)}>{text.openAgain}</LinkButton>
            {another}
          </ConnectActions>
        </>
      )
    }
    case 'approve': {
      const signIn = model.signIn
      if (signIn?.ended != null)
        return (
          <>
            <ConnectFound tone="no">{signIn.ended}</ConnectFound>
            <ConnectActions>
              <Button onClick={model.retrySignIn}>{text.tryAgain}</Button>
              {another}
            </ConnectActions>
          </>
        )
      return (
        <>
          <ConnectText>{text.approveOpen(host)}</ConnectText>
          <ConnectActions>
            <ConnectWaiting>{text.waitingFor(host)}</ConnectWaiting>
          </ConnectActions>
          <ConnectActions>
            {signIn !== null && <CopyButton value={signIn.url} text={{ copy: text.copyLink }} />}
            {another}
          </ConnectActions>
        </>
      )
    }
    case 'install': {
      const reach = model.check?.lines.find((line) => line.need === 'reach')
      const reason = reach?.reason?.kind === 'not_installed' ? reach.reason : null
      const login = model.connection?.login ?? ''
      const who = reason?.owner ?? owner ?? service
      return (
        <>
          {login !== '' && <ConnectText>{text.notInstalled(login, projectsIn(here), who)}</ConnectText>}
          {reason?.url != null && (
            <ConnectActions primary>
              <Button trailingIcon="external" onClick={() => model.open(reason.url ?? '')}>
                {text.install(who)}
              </Button>
            </ConnectActions>
          )}
          <ConnectSteps items={text.installSteps(repositoriesIn(here))} />
          <ConnectActions>
            <ConnectWaiting>{text.waitingFor(service)}</ConnectWaiting>
          </ConnectActions>
          <ConnectText tone="note">{text.ownersApprove(who)}</ConnectText>
        </>
      )
    }
    case 'cli': {
      if (way.kind !== 'cli') return null
      const cli = way.cli
      return (
        <>
          <ConnectFacts
            rows={[
              { label: text.account, value: text.accountOn(cli.account, hostOf(cli.webUrl)) },
              ...(cli.scopes === null || cli.scopes.length === 0 ? [] : [{ label: text.scopes, value: cli.scopes.join(', '), mono: true }]),
              { label: text.reaches, value: text.reachesAll(cli.account, owner, product === 'github') },
            ]}
          />
          {model.cli.error !== null && <ConnectFound tone="no">{model.cli.error}</ConnectFound>}
          <ConnectActions primary>
            <Button busy={model.cli.busy} onClick={model.takeCli}>
              {text.useIt}
            </Button>
            {another}
          </ConnectActions>
        </>
      )
    }
    case 'server':
    case 'site': {
      const site = step === 'site'
      const answered = model.address.found
      const typedHost = hostOf(answered?.webUrl ?? model.address.typed)
      const place = way.place
      const said =
        answered === null ? null : answered.product !== null ? (
          <ConnectFound>
            {text.answers(ANSWERS_AS[answered.product], hostOf(answered.webUrl))}
            {place !== undefined && place.remote !== null && hostOf(place.webUrl) === hostOf(answered.webUrl)
              ? text.fromRemote(place.project, place.remote)
              : ''}
          </ConnectFound>
        ) : (
          <ConnectFound tone="no">
            {answered.reason === 'invalid'
              ? text.notAnAddress
              : answered.reason === 'unreachable'
                ? text.nothingAt(typedHost)
                : site
                  ? text.notSite(typedHost)
                  : text.notService(typedHost, service)}
          </ConnectFound>
        )
      const hosted = model.ways.find((candidate) => candidate.kind === 'token' || candidate.kind === 'browser')
      return (
        <>
          <ConnectField
            label={site ? text.siteAddress : text.address}
            type="url"
            value={model.address.typed}
            onChange={model.setAddress}
            onSubmit={model.confirmAddress}
            placeholder={site ? text.sitePlaceholder : text.addressPlaceholder}
            focus={model.address.typed === ''}
          />
          {model.address.finding ? (
            <ConnectActions align="start">
              <ConnectWaiting>{text.asking(typedHost)}</ConnectWaiting>
            </ConnectActions>
          ) : (
            said
          )}
          <ConnectActions primary>
            <Button onClick={model.confirmAddress}>{site ? text.continue : text.makeToken}</Button>
            {!site && hosted !== undefined && hosted.webUrl !== null && (
              <LinkButton onClick={() => model.choose(hosted.id)}>{text.instead(hostOf(hosted.webUrl))}</LinkButton>
            )}
          </ConnectActions>
        </>
      )
    }
    case 'key':
      return (
        <>
          {openPage(text.openPowerUps)}
          <ConnectSteps items={text.trelloKeySteps} />
          <ConnectField
            label={text.keyField}
            value={model.key.value}
            onChange={model.setKey}
            onSubmit={model.confirmKey}
            submit={text.continue}
            mono
            placeholder={text.keyPlaceholder}
            {...(model.key.error === null ? {} : { error: model.key.error })}
          />
        </>
      )
    case 'allow': {
      const key = model.key.value.trim()
      const template = model.option?.tokenHelpForKey ?? null
      return (
        <>
          {template !== null && (
            <ConnectActions primary>
              <Button trailingIcon="external" onClick={() => model.open(template.replace('{key}', encodeURIComponent(key)))}>
                {text.openAllow}
              </Button>
            </ConnectActions>
          )}
          <ConnectText tone="note">{text.madeForKey(key.slice(-4))}</ConnectText>
          <ConnectSteps items={text.allowSteps} />
          {waitingForToken(watched)}
        </>
      )
    }
    case 'make':
      return (
        <MakeBody
          product={product}
          host={host}
          owner={owner}
          here={here}
          watched={watched}
          waitingForToken={waitingForToken}
          openPage={openPage}
        />
      )
    case 'paste':
      return <PasteBody model={model} product={product} service={service} />
    case 'check':
      return <CheckBody model={model} product={product} service={service} owner={owner} page={page} />
  }
}

/** A product as it answers at an address: a company's own server, or a Jira site. */
const ANSWERS_AS: Readonly<Record<Product, string>> = {
  github: 'GitHub Enterprise Server',
  gitlab: 'GitLab',
  bitbucket_cloud: 'Bitbucket',
  bitbucket_dc: 'Bitbucket Data Center',
  linear: 'Linear',
  jira_cloud: 'Jira Cloud',
  jira_dc: 'Jira Data Center',
  trello: 'Trello',
}

const GITHUB_PERMISSIONS = [
  { name: 'Contents', level: 'Read and write', why: 'push a task’s branch' },
  { name: 'Pull requests', level: 'Read and write', why: 'open, update and merge them' },
  { name: 'Commit statuses', level: 'Read', why: 'see them pass or fail' },
  { name: 'Actions', level: 'Read', why: 'read a failed job’s log' },
  { name: 'Issues', level: 'Read and write', why: 'read and comment' },
  { name: 'Workflows', level: 'Read and write', why: 'push changes to its workflows' },
]

const BITBUCKET_SCOPES = [
  { name: 'read:user:bitbucket', why: 'who you are' },
  { name: 'read:workspace:bitbucket', why: 'who can write' },
  { name: 'read:repository:bitbucket' },
  { name: 'write:repository:bitbucket', why: 'push a task’s branch' },
  { name: 'read:pullrequest:bitbucket' },
  { name: 'write:pullrequest:bitbucket', why: 'open, update and merge' },
  { name: 'read:pipeline:bitbucket', why: 'build statuses and logs' },
]

function MakeBody({
  product,
  host,
  owner,
  here,
  watched,
  waitingForToken,
  openPage,
}: {
  product: Product
  host: string
  owner: string | undefined
  here: ReadonlyArray<ConnectPlace>
  watched: boolean
  waitingForToken: (option: boolean) => ReactNode
  openPage: (label: string) => ReactNode
}) {
  switch (product) {
    case 'github': {
      const hosted = host === 'github.com'
      return (
        <>
          {openPage(text.open(hosted ? 'GitHub' : host))}
          <ConnectText tone="note">{hosted ? text.githubFilled(owner) : text.classicFilled}</ConnectText>
          {hosted && <ConnectPerms rows={GITHUB_PERMISSIONS} fold />}
          <ConnectSteps items={hosted ? text.githubSteps(here.length === 0 ? null : repositoriesIn(here)) : text.classicSteps} />
          {waitingForToken(watched)}
        </>
      )
    }
    case 'gitlab':
      return (
        <>
          {openPage(text.open(host))}
          <ConnectText tone="note">{text.gitlabFilled}</ConnectText>
          <ConnectSteps items={text.gitlabSteps} />
          {waitingForToken(watched)}
        </>
      )
    case 'bitbucket_cloud':
      return (
        <>
          {openPage(text.openAtlassian)}
          <ConnectSteps items={text.bitbucketSteps} />
          <ConnectPerms rows={BITBUCKET_SCOPES} text={{ title: text.scopesToTick }} />
          {waitingForToken(watched)}
        </>
      )
    case 'bitbucket_dc':
      return (
        <>
          {openPage(text.openAccessTokens(host))}
          <ConnectSteps items={text.bitbucketServerSteps} />
          {waitingForToken(false)}
        </>
      )
    case 'jira_cloud':
      return (
        <>
          {openPage(text.openAtlassian)}
          <ConnectSteps items={text.jiraSteps} />
          {waitingForToken(watched)}
        </>
      )
    case 'jira_dc':
      return (
        <>
          {openPage(text.open(host))}
          <ConnectSteps items={text.jiraServerSteps} />
          {waitingForToken(false)}
        </>
      )
    case 'linear':
      return (
        <>
          {openPage(text.openLinear)}
          <ConnectSteps items={text.linearSteps} />
          {waitingForToken(watched)}
        </>
      )
    case 'trello':
      return null
  }
}

function PasteBody({ model, product, service }: { model: ConnectModel; product: Product; service: string }) {
  const clip = model.clip
  const wantsEmail = (product === 'bitbucket_cloud' || product === 'jira_cloud') && model.again === null
  const email = model.guide?.email ?? null
  const prefix = {
    github: 'github_pat_…',
    gitlab: 'glpat-…',
    bitbucket_cloud: 'ATATT…',
    jira_cloud: 'ATATT…',
    linear: 'lin_api_…',
    trello: 'ATTA…',
  } as const
  const placeholder = product in prefix ? prefix[product as keyof typeof prefix] : undefined
  return (
    <>
      {wantsEmail && (
        <ConnectField
          label={text.email}
          type="email"
          value={model.token.email}
          onChange={model.setEmail}
          onSubmit={model.submitToken}
          {...(email !== null && model.token.email === email.address ? { hint: text.emailFrom(email.project) } : {})}
          {...(model.token.emailError === null ? {} : { error: model.token.emailError })}
        />
      )}
      {clip !== null && (
        <ConnectClip what={text.looksLike(service, product)} shown={shown(clip)} busy={model.token.saving} onUse={model.takeClip} />
      )}
      <ConnectField
        label={clip === null ? text.pasteIt : text.orPaste}
        type="password"
        mono
        value={model.token.value}
        onChange={model.setToken}
        onSubmit={model.submitToken}
        submit={text.check}
        busy={model.token.saving}
        focus={clip === null && !wantsEmail}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(model.token.error === null ? {} : { error: model.token.error })}
      />
      <ConnectText tone="note">{text.keptToken}</ConnectText>
    </>
  )
}

/** A token, without its middle: github_pat_11ABX····7Qx. */
const shown = (token: string) => (token.length <= 14 ? `${token.slice(0, 4)}····` : `${token.slice(0, 16)}····${token.slice(-3)}`)

function CheckBody({
  model,
  product,
  service,
  owner,
  page,
}: {
  model: ConnectModel
  product: Product
  service: string
  owner: string | undefined
  page: string | null
}) {
  const lines = checkLines(model, product)
  const list = <ConnectChecks label={text.canDo(service)} items={lines} />
  if (model.refused !== null)
    return (
      <>
        {list}
        <ConnectActions>
          {page !== null && (
            <Button trailingIcon="external" onClick={() => model.openAndPaste(page)}>
              {text.fix.makeNew}
            </Button>
          )}
          <LinkButton onClick={model.pasteMyself}>{text.fix.pasteAnother}</LinkButton>
        </ConnectActions>
      </>
    )
  if (model.checkError !== null)
    return (
      <>
        {list}
        <ConnectFound tone="no">{model.checkError}</ConnectFound>
        <ConnectActions>
          <Button onClick={model.checkAgain}>{text.fix.checkAgain}</Button>
          <LinkButton onClick={model.done}>{text.fix.asItIs}</LinkButton>
        </ConnectActions>
      </>
    )
  if (model.check === null)
    return (
      <>
        {list}
        <ConnectText tone="note">{text.asked(service, owner)}</ConnectText>
      </>
    )
  const no = firstNo(model)
  if (no === undefined) {
    const expiry = model.check.renews
      ? text.expires.renews(service)
      : model.way?.kind === 'cli'
        ? text.expires.cli(model.way.cli.tool)
        : model.check.expiresAt !== null
          ? text.expires.on(longDate(model.check.expiresAt))
          : product === 'trello'
            ? text.expires.never
            : null
    return (
      <>
        {list}
        {expiry !== null && <ConnectText tone="note">{expiry}</ConnectText>}
        <ConnectActions primary>
          <Button onClick={model.done}>{text.done}</Button>
        </ConnectActions>
      </>
    )
  }
  return (
    <>
      {list}
      <Fix model={model} check={model.check} line={no} product={product} service={service} page={page} />
    </>
  )
}

/** How to put right the first thing a connection can't do: the words, and the presses. */
function Fix({
  model,
  check,
  line,
  product,
  service,
  page,
}: {
  model: ConnectModel
  check: ConnectionCheck
  line: AccessLine
  product: Product
  service: string
  page: string | null
}) {
  const reason = line.reason
  const settings = check.settings
  const checkAgain = <LinkButton onClick={model.checkAgain}>{text.fix.checkAgain}</LinkButton>
  const asItIs = <LinkButton onClick={model.done}>{text.fix.asItIs}</LinkButton>
  const change = (url: string) => (
    <Button trailingIcon="external" onClick={() => model.open(url)}>
      {text.fix.changeOn(service)}
    </Button>
  )
  const remake =
    page === null ? null : (
      <Button trailingIcon="external" onClick={() => model.openAndPaste(page)}>
        {text.fix.makeNew}
      </Button>
    )
  /** The fix's words, past two repositories the list of them, and its presses. */
  const listed = (note: string | null, paths: ReadonlyArray<string>, ...presses: ReadonlyArray<ReactNode>) => (
    <>
      {note !== null && <ConnectText tone="note">{note}</ConnectText>}
      <Names paths={paths} />
      <ConnectActions>{presses}</ConnectActions>
    </>
  )
  const row = (note: string | null, ...presses: ReadonlyArray<ReactNode>) => listed(note, [], ...presses)
  if (reason === null) return row(null, checkAgain, asItIs)
  switch (reason.kind) {
    case 'refused':
      return row(
        null,
        remake,
        <LinkButton key="paste" onClick={model.pasteMyself}>
          {text.fix.pasteAnother}
        </LinkButton>,
      )
    case 'scope':
      return product === 'github'
        ? row(text.fix.githubScope(reason.scope), change(reason.url ?? settings), checkAgain, asItIs)
        : row(text.fix.remake(service, reason.scope), remake, asItIs)
    case 'permission':
      return row(
        text.fix.githubSet(`${reason.permission} to ${line.need === 'checks' ? 'Read' : 'Read and write'}`),
        change(reason.url ?? settings),
        checkAgain,
        asItIs,
      )
    case 'unseen':
      return product === 'github' && reason.url !== null
        ? listed(text.fix.githubAdd(reason.names), reason.names, change(reason.url), checkAgain, asItIs)
        : row(null, checkAgain, asItIs)
    case 'not_installed':
      return row(null, checkAgain, asItIs)
    case 'restricted': {
      const token = model.ways.find((candidate) => candidate.kind === 'token')
      return row(
        text.fix.restricted(reason.owner),
        token === undefined ? null : (
          <LinkButton key="token" onClick={() => model.choose(token.id)}>
            {text.fix.tokenInstead}
          </LinkButton>
        ),
        checkAgain,
        asItIs,
      )
    }
    case 'sso':
      return row(
        text.fix.sso(reason.owner),
        <Button key="sso" trailingIcon="external" onClick={() => model.open(reason.url)}>
          {text.fix.authorize(reason.owner)}
        </Button>,
        checkAgain,
        asItIs,
      )
    case 'no_check_runs':
      return row(
        text.fix.classic,
        <Button key="classic" trailingIcon="external" onClick={() => model.openAndPaste(reason.url)}>
          {text.fix.classicToken}
        </Button>,
        asItIs,
      )
    case 'role':
      return row(text.fix.role, checkAgain, asItIs)
    case 'unreadable':
      return row(null, asItIs)
    case 'failed':
      return row(reason.message, checkAgain, asItIs)
  }
}
