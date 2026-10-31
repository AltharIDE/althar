import { basename } from 'node:path'

import { MESSAGE_FILES } from '@althar/contracts'
import { products } from '@althar/connectors'
import { Cause, Option } from 'effect'

import { thisDevice } from './device'
import type { AccountRefused } from './Accounts'
import type { CantMerge, DocumentRefused, FileRefused, ImageRefused, NoChangeToOpen, ProjectRefused, TaskRefused } from './errors'
import { NOTE_LENGTH, type NoteRefused, NOTES_KEPT } from './notes'
import { MESSAGE_IMAGES } from './pictures'
import { pushDetailOf, secondsOf } from './pushFailure'
import type { ReviewDraftIncomplete } from './Reviews'

/*
 * What went wrong, in words a person reads in the window. The runtime's
 * errors carry what happened for the log; these say it the way the interface
 * does (docs/glossary.md: tasks, leads and agents, never sessions, runs or
 * failures). Anything not listed here says only that the runtime couldn't do
 * it; the log has the rest.
 */

const tagOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string' ? error._tag : 'Unknown'

const fieldOf = (error: unknown, key: string): unknown =>
  typeof error === 'object' && error !== null && key in error ? (error as Record<string, unknown>)[key] : undefined

const text = (error: unknown, key: string): string => {
  const value = fieldOf(error, key)
  return typeof value === 'string' ? value : ''
}

/** The last line of an agent's error output, which usually says why. */
const lastLine = (output: string): string =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? ''

/**
 * What to do when the sandbox cannot reach the device (a Flatpak's host):
 * the permission, and how it is given. The same sentence the Codex bridge
 * prints, so it reaches the person either way.
 */
const hostDenied =
  'Althar can’t reach this computer from inside its Flatpak sandbox. Give the Flatpak permission to talk to org.freedesktop.Flatpak (flatpak override --user --talk-name=org.freedesktop.Flatpak dev.althar.app), then try again.'

/** A sentence, with its full stop. */
const sentence = (words: string): string => (/[.!?]$/.test(words) ? words : `${words}.`)

/** An agent whose account is signed out, as a step's call says it: the call itself offers signing in again. */
export const signedOutWords = 'The agent is signed out. Sign it in again in Settings, then try again.'

/** What an agent's own error says, when the runtime can put it in words. */
export const agentSaid = (error: unknown): string | undefined => {
  switch (tagOf(error)) {
    case 'StartTimedOut':
      return text(error, 'message')
    case 'AgentStartFailed': {
      const command = text(error, 'command')
      const reason = text(error, 'reason')
      // The person's own command, where the sandbox cannot reach the device: say what to put right, never "isn't installed".
      if (command === 'flatpak-spawn' || /flatpak|org\.freedesktop\.Flatpak/i.test(reason)) return hostDenied
      return /ENOENT/.test(reason)
        ? `${command} isn't installed, or isn't on ${thisDevice()}'s PATH.`
        : sentence(`${command} wouldn't start: ${reason}`)
    }
    case 'AgentExited': {
      const said = lastLine(text(error, 'stderr'))
      // A bridge that started and then could not take the command out to the device says so; keep its sentence, not "the agent stopped".
      if (/flatpak-spawn|org\.freedesktop\.Flatpak/i.test(said)) return hostDenied
      return said === '' ? 'The agent stopped.' : sentence(`The agent stopped: ${said}`)
    }
    case 'AgentRequestFailed':
      switch (fieldOf(error, 'failure')) {
        case 'auth_required':
          return signedOutWords
        case 'usage_limit': {
          const until = text(error, 'resetsAt')
          return until === '' ? "The agent's usage limit is reached." : `The agent's usage limit is reached until ${until}.`
        }
        case 'context_full':
          return "The agent's context is full."
        default:
          return sentence(text(error, 'message'))
      }
    case 'OptionUnavailable':
      return `The agent doesn't offer ${text(error, 'value')}.`
    case 'TurnInProgress':
      return 'The lead is still on its last turn.'
    // An agent that couldn't start: the sentence Althar wrote when it failed, or nothing where there was none to say.
    case 'SessionFailed':
      return text(error, 'summary')
    default:
      return undefined
  }
}

/** A cause, summed up for a person: what the agent said, what the host said no to, or the first line of what went wrong. */
export const summarize = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.findErrorOption(cause)
  const said = Option.isSome(error) ? (agentSaid(error.value) ?? hostFailed(error.value)) : undefined
  if (said !== undefined) return said
  const first = lastLine(Cause.pretty(cause).split('\n')[0] ?? '').replace(/^\w*Error: /, '')
  return first === '' ? '' : sentence(first)
}

const kinds: Readonly<Record<string, string>> = {
  project: 'project',
  task: 'task',
  'task thread': 'task',
  thread: 'task',
  'task thread with a ready worktree': 'task’s worktree',
  'thread item': 'message',
  plan: 'plan',
  automation: 'automation',
  attention_request: 'call',
  provider_session: 'agent',
  folder: 'folder',
  account: 'account',
  repository: 'repository',
  output: 'output',
  document: 'document',
  file: 'file',
  note: 'note',
}

/** What went wrong, for the window: the error's tag as its reason, and words for the person. */
export const words = (
  error: unknown,
  agentName: (agentId: string) => string,
): { readonly reason: string; readonly message: string; readonly why?: string; readonly detail?: string } => {
  const reason = tagOf(error)
  const message = ((): string => {
    switch (reason) {
      case 'NotARepository':
        return `${text(error, 'path')} isn't a git repository. Choose another folder.`
      case 'RepositoryRefused':
        return text(error, 'reason') === 'taken'
          ? `There’s a folder named ${text(error, 'name')} in ${basename(text(error, 'parent'))} already. Choose another place, or rename the project.`
          : 'Name the project first: its repository is named after it.'
      case 'RepositoriesNeeded': {
        const unknown = (error as { readonly unknown?: ReadonlyArray<string> }).unknown ?? []
        const choices = ((error as { readonly choices?: ReadonlyArray<string> }).choices ?? []).join(', ')
        return unknown.length > 0
          ? `The project has no repository called ${unknown.join(' or ')}. It has ${choices}.`
          : `Say which of the project's repositories the task changes: ${choices}.`
      }
      case 'ProjectRefused':
        return projectRefused[text(error, 'reason') as ProjectRefused['reason']] ?? "Althar can't change the project that way."
      case 'NotFound':
        // A push with nowhere to go: none of its repositories has a remote.
        if (text(error, 'kind') === 'remote') return 'Its repositories have no remote to push to. Add one with git, then push again.'
        return `That ${kinds[text(error, 'kind')] ?? 'thing'} isn't there any more.`
      case 'UnknownAgent':
        return `Althar has no agent called ${text(error, 'agentId')}.`
      case 'DocumentRefused':
        return documentRefused[text(error, 'reason') as DocumentRefused['reason']] ?? 'Althar can’t show that file here.'
      case 'ImageRefused': {
        const name = text(error, 'name')
        return (
          imageRefused[text(error, 'reason') as ImageRefused['reason']]?.(name === '' ? 'An image' : name) ??
          "Althar can't send that image."
        )
      }
      case 'FileRefused': {
        const name = text(error, 'name')
        return (
          fileRefused[text(error, 'reason') as FileRefused['reason']]?.(name === '' ? 'A file' : name) ?? "Althar can't send that file."
        )
      }
      case 'NoteRefused':
        return noteRefused[text(error, 'why') as NoteRefused['why']] ?? 'Althar can’t keep that note.'
      case 'SessionRunning':
        return 'An agent is already working on this task.'
      case 'NoSession':
        return 'The task isn’t running.'
      case 'InstallFailed':
        return text(error, 'summary')
      case 'SessionFailed': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))} couldn't start.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'EffortUnchanged': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))}’s effort didn't change.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'ModelUnchanged': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))}’s model didn't change.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'CoordinatorUnavailable':
        return `${text(error, 'agentName')} isn't signed in. Sign it in, or pick another agent for the coordinator.`
      case 'AttentionClosed':
        return 'That call is closed.'
      case 'RuleOnAnotherList': {
        const words = fieldOf(error, 'exact') === true ? `“${text(error, 'pattern')}”` : `Commands starting “${text(error, 'pattern')}”`
        const list = text(error, 'list') === 'never' ? '“Never”' : '“Always ask me”'
        return `${words} ${fieldOf(error, 'exact') === true ? 'is' : 'are'} on ${list}. Take ${fieldOf(error, 'exact') === true ? 'it' : 'them'} off ${list} first.`
      }
      case 'RulesChanged':
        return "The project's rules changed meanwhile. Make the change again."
      case 'AlwaysNotOffered':
        return "That can't be kept as a rule. Answer it once."
      case 'QuestionUnanswered':
        return 'Answer each question: pick an option, or write your own.'
      case 'NothingToWaitFor':
        return "The agent didn't say when its limit resets. Pick another model, or try again."
      case 'NotHeld':
        return "The step isn't waiting for its usage limit any more."
      case 'AlreadyDelivered':
        return 'The agent already has that message.'
      case 'GitFailed': {
        const args = fieldOf(error, 'args')
        const command = `git ${Array.isArray(args) ? String(args.find((arg) => !String(arg).startsWith('-') && !String(arg).includes('=')) ?? '') : ''}`
        const said = lastLine(text(error, 'stderr'))
        if (said !== '') return sentence(`${command} didn't work: ${said}`)
        // git said nothing: what Althar knows of how it ended.
        if (fieldOf(error, 'timedOut') === true) {
          const timeout = fieldOf(error, 'timeout')
          return `${command} got no answer in ${secondsOf(typeof timeout === 'number' ? timeout : undefined)}, so Althar stopped it. Try again.`
        }
        const signal = text(error, 'signal')
        if (signal !== '') return `${command} was stopped (${signal}) before it was done. Try again.`
        const code = fieldOf(error, 'code')
        return typeof code === 'number' ? `${command} failed with code ${code}, without saying why.` : `${command} didn't work.`
      }
      case 'CommandIdReused':
        return 'Something went wrong. Try again.'
      case 'DatabaseInUse':
        return 'Another copy of Althar is using this profile.'
      case 'PushRefused': {
        const remote = text(error, 'remote')
        const why = text(error, 'why')
        if (why === 'behind')
          return `${remote} has commits that aren’t here yet, so it didn’t take the push. Bring them in, then push again.`
        if (why === 'moved')
          return `${remote} has commits pushed since you looked, so nothing was replaced. Look again before replacing them.`
        if (why === 'never')
          return `The project’s rules never allow force pushes, so ${remote}’s commits stay. Ask the lead to merge instead.`
        if (why === 'refused') return sentence(`${remote} refused the push${text(error, 'said') === '' ? '' : `: ${text(error, 'said')}`}`)
        // Where the person's own git pushed, the host by name: GitLab, not origin/a-long-branch-name.
        const host = text(error, 'host')
        const where = host === '' ? remote : host
        if (why === 'forbidden')
          return `Your account can’t push to this repository on ${where}, so nothing was pushed. Push to a fork of it, or ask its owners for access.`
        if (why === 'protected')
          return `${host === '' ? `The branch is protected, so ${remote} didn’t take the push.` : `The branch is protected on ${host}, so it didn’t take the push.`} Push to another branch or a fork, or ask its owners to let you push to it.`
        if (why === 'unreachable')
          return `Althar couldn’t reach ${where}, so nothing was pushed. Check this computer’s connection, then try again.`
        if (why === 'unanswered')
          return `${where} didn’t answer in time, so the push was stopped. git may have been waiting for a sign-in it couldn’t ask for here: sign git in to ${where} from a terminal, then try again.`
        if (why === 'failed') return `Althar couldn’t push to ${where}. What git said is under Details.`
        // The person's own git pushed: signing git in is what puts it right, as connecting doesn't change how it pushes.
        if (host !== '')
          return `${host} didn’t accept your sign-in, so nothing was pushed. Sign git in to ${host} from a terminal, then try again.`
        return `git couldn’t sign in to push to ${remote}. Push once from a terminal so your sign-in is kept, then push again here.`
      }
      case 'CantMerge': {
        const detail = text(error, 'detail')
        const files = fieldOf(error, 'files')
        const said = {
          detail,
          into: text(error, 'into') === '' ? 'the default branch' : text(error, 'into'),
          files: Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [],
        }
        return cantMerge[text(error, 'why') as CantMerge['why']]?.(said) ?? `Althar couldn't merge it. ${detail}`
      }
      case 'NoChangeToOpen':
        return (noChangeToOpen[text(error, 'why') as NoChangeToOpen['why']] ?? noChangeToOpen.working)(text(error, 'detail'))
      case 'LaunchRefused':
      case 'AttachRefused':
      case 'ReviewRefused':
      case 'ScreenshotsRefused':
        return text(error, 'message')
      case 'AutomationRefused':
        return text(error, 'message')
      case 'TaskRefused':
        return taskRefused[text(error, 'why') as TaskRefused['why']] ?? "Althar can't change the task that way."
      case 'SignOutFailed':
        return `Couldn't sign this account out. Try again, or remove it anyway: its sign-in may stay on ${thisDevice()}.`
      case 'AccountRefused':
        return accountRefused[text(error, 'reason') as AccountRefused['reason']] ?? "Althar can't add that account."
      case 'ChangedSinceSeen':
        return text(error, 'what') === 'branch'
          ? 'The branch changed since you looked. Look again, then push.'
          : text(error, 'what') === 'folder'
            ? 'The task’s folder changed since you looked. Look again, then remove it.'
            : 'The pull request changed since you looked. Look again, then accept it.'
      case 'NotConnected':
        return `Althar isn't connected to ${productOf(text(error, 'product'))}. Connect it, then try again.`
      case 'NotAnIssue':
        return `That link is to a ${text(error, 'what')}, not an issue.`
      case 'DraftClosed':
        return draftClosed[text(error, 'state')] ?? 'That issue draft can’t change now.'
      case 'DraftUntitled':
        return 'An issue needs a title.'
      case 'ChangesClosed':
        return changesClosed[text(error, 'state')] ?? 'Those issue changes can’t change now.'
      case 'ReviewDraftClosed':
        return reviewClosed[text(error, 'state')] ?? 'That review draft can’t change now.'
      case 'ReviewDraftIncomplete':
        return reviewIncomplete[text(error, 'missing') as ReviewDraftIncomplete['missing']]
      case 'OutwardUncertain':
        return 'That may have gone through. Check on the host before trying again.'
      case 'ConnectorFailed':
        return hostSaid(productOf(text(error, 'product')), text(error, 'reason'), text(error, 'message'))
      // The keychain's own words, where main marked its refusal; anything else of its own — a file that won't write, a bad name, an empty reason — gets the generic sentence.
      case 'SecretsUnavailable': {
        const reason = text(error, 'reason')
        return fieldOf(error, 'keyring') === true && reason !== '' ? reason : "Althar's runtime couldn't do that. Its log has the details."
      }
      case 'CliSignedOut':
        return `${text(error, 'tool')} isn't signed in to ${text(error, 'host')} on ${thisDevice()}.`
      case 'CliUnanswered':
        return `${text(error, 'tool')} didn't answer in time. Try again in a moment.`
      case 'CliElsewhere':
        return `Althar only gives ${text(error, 'tool')}'s sign-in to a server it knows, over HTTPS. ${text(error, 'address')} isn't one.`
      case 'OtherAccount':
        return `This token is ${text(error, 'login')}'s. Make one as ${text(error, 'expected')}, or connect ${text(error, 'login')} as well from the list.`
      default:
        return agentSaid(error) ?? "Althar's runtime couldn't do that. Its log has the details."
    }
  })()
  // A merge that conflicts says in which files, for the window to have the lead settle them, or say it is.
  if (reason === 'CantMerge') return { reason, message, why: text(error, 'why'), detail: text(error, 'detail') }
  // A push refused says why, for the window to offer what puts it right: bringing the remote's commits in.
  if (reason === 'PushRefused')
    return { reason, message, why: text(error, 'why'), ...(text(error, 'detail') === '' ? {} : { detail: text(error, 'detail') }) }
  // A git failure that said anything keeps it all, and how it ended, for a quiet Details under its line.
  if (reason === 'GitFailed') {
    const code = fieldOf(error, 'code')
    const timeout = fieldOf(error, 'timeout')
    const detail =
      text(error, 'stderr').trim() === ''
        ? ''
        : pushDetailOf({
            stderr: text(error, 'stderr'),
            ...(typeof code === 'number' ? { code } : {}),
            ...(text(error, 'signal') === '' ? {} : { signal: text(error, 'signal') }),
            ...(fieldOf(error, 'timedOut') === true ? { timedOut: true } : {}),
            ...(typeof timeout === 'number' ? { timeout } : {}),
          })
    return { reason, message, ...(detail === '' ? {} : { detail }) }
  }
  // A service's refusal says which, for the window to say it where it happened: a token it didn't take, as against one it took and limits.
  if (reason === 'ConnectorFailed') return { reason, message, why: text(error, 'reason') }
  return { reason, message }
}

/** What a code host or tracker said no to, when that is what the error is: in the person's words, not the error's name. */
const hostFailed = (error: unknown): string | undefined =>
  tagOf(error) === 'ConnectorFailed'
    ? hostSaid(productOf(text(error, 'product')), text(error, 'reason'), text(error, 'message'))
    : undefined

/** A product's name, by its id: GitHub, Linear. */
const productOf = (product: string) => Object.values(products).find((info) => info.product === product)?.name ?? 'The service'

/** What a code host or tracker said no to, or why it couldn't be asked, in the person's words. */
const hostSaid = (host: string, reason: string, said: string) => {
  const what = said === '' ? '' : `: ${lastLine(said)}`
  switch (reason) {
    case 'unauthorized':
      return `${host} no longer takes Althar's sign-in. Sign in to it again.`
    case 'forbidden':
      return sentence(`${host} won't let this account do that${what}`)
    case 'not_found':
      return `${host} can't find it any more.`
    case 'rate_limited':
      return `${host} is rate limiting. Try again in a little while.`
    case 'unreachable':
      return `Althar couldn't reach ${host}. Try again in a moment.`
    case 'invalid_response':
      return `${host} answered in a way Althar didn't understand.`
    default:
      return sentence(`${host} said no${what}`)
  }
}

/** A couple of files by name, the rest counted: a.ts, b.ts and 3 more. */
const fewOf = (files: ReadonlyArray<string>) => {
  const names = files.map((file) => file.slice(file.lastIndexOf('/') + 1))
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** What a refused merge says of itself: the branch, and the files in the way. */
interface MergeSaid {
  readonly detail: string
  readonly into: string
  readonly files: ReadonlyArray<string>
}

/** Why Althar won't merge a task here, by reason: in a few words, a couple of files by name. */
const cantMerge = {
  pull_request: () => 'The task has a pull request: merge it there.',
  settled: () => 'The task is settled.',
  changed: () => 'The task’s branch changed since you looked. Look again, then merge.',
  conflicts: ({ into, files, detail }) => `It conflicts with ${into} in ${files.length > 0 ? fewOf(files) : detail}.`,
  resolving: ({ into, files, detail }) =>
    `It conflicts with ${into} in ${files.length > 0 ? fewOf(files) : detail}. The lead is resolving it.`,
  busy: ({ into, files }) =>
    files.length > 0
      ? `Your ${into} checkout has uncommitted changes to ${fewOf(files)}.`
      : `Your ${into} checkout has changes in the way.`,
  submodule: ({ files, detail }) => `Submodule ${files[0] ?? detail} has uncommitted changes, or isn’t at the commit recorded for it.`,
  unreadable: () => 'Couldn’t read the default branch’s checkout. Nothing was merged.',
  untracked: ({ into, files }) =>
    `Your ${into} checkout has ${files.length === 1 ? 'an untracked file' : 'untracked files'} in the way: ${fewOf(files)}.`,
  moved: ({ detail }) => `${detail} moved meanwhile. Merge again.`,
  missing: ({ detail }) => `${thisDevice().replace(/^t/, 'T')} has no ${detail} branch to merge into.`,
} as const satisfies Record<CantMerge['why'], (said: MergeSaid) => string>

/** Why a task has no pull request to open, by reason, with the files it concerns where it says them. */
const noChangeToOpen = {
  working: () => "The task's work isn't done yet.",
  settled: () => 'The task is settled.',
  opened: () => 'The task already has its pull request.',
  nothing: () => 'Every commit is in a pull request already.',
  uncommitted: (files: string) =>
    `The lead left changes it didn’t commit${files === '' ? '' : `, in ${files}`}. Ask it to commit them, then open the pull request again.`,
  conflicts: (files: string) =>
    `It conflicts with the default branch${files === '' ? '' : `, in ${files}`}. Ask the lead to merge the default branch in, then open the pull request again.`,
} as const satisfies Record<NoChangeToOpen['why'], (detail: string) => string>

/** Why a task can't be abandoned, reopened or renamed, by reason. */
const taskRefused = {
  merged: 'The task is merged.',
  branch_gone: 'The task’s worktree and branch are gone.',
  abandoned: 'The task is abandoned. Reopen it to carry on.',
  no_title: 'Give the task a title.',
  title_too_long: 'Keep the title to a few words.',
  folder_in_use: 'Something is running in the task’s folder. Stop it, then remove the folder.',
  folder_in_way: 'Something else is where the task’s folder goes. Move it away, then try again.',
} as const satisfies Record<TaskRefused['why'], string>

/** Why an issue draft can't change, by where it stands. */
const draftClosed: Readonly<Record<string, string>> = {
  filed: 'That issue is filed already. Change it on its tracker.',
  discarded: 'That issue draft was discarded.',
  filing: 'That issue is being filed now.',
}

/** Why a review draft can't change, by where it stands. */
const reviewClosed: Readonly<Record<string, string>> = {
  posted: 'That review is posted already. Change it on GitHub.',
  discarded: 'That review draft was discarded.',
  posting: 'That review is being posted now.',
}

/** Why changes to issues can't be applied or discarded now, by where they stand. */
const changesClosed: Readonly<Record<string, string>> = {
  applied: 'Those changes are applied already.',
  discarded: 'Those changes were discarded.',
  applying: 'Those changes are being applied.',
}

/** What a review draft lacks to be kept or posted. */
const reviewIncomplete = {
  verdict: 'Choose a verdict before you post the review.',
  summary: 'A review needs a summary.',
  comment: 'Write the comment, or drop it.',
} as const satisfies Record<ReviewDraftIncomplete['missing'], string>

/** Errors the person caused or can put right; anything else is worth the log. */
export const expected = new Set([
  'LaunchRefused',
  'AttachRefused',
  'ScreenshotsRefused',
  'DraftClosed',
  'DraftUntitled',
  'ChangesClosed',
  'ReviewDraftClosed',
  'ReviewDraftIncomplete',
  'ReviewRefused',
  'ChangedSinceSeen',
  'CantMerge',
  'NoChangeToOpen',
  'TaskRefused',
  'NotConnected',
  'CliSignedOut',
  'CliUnanswered',
  'CliElsewhere',
  'OtherAccount',
  'NotAnIssue',
  'NotARepository',
  'RepositoriesNeeded',
  'RepositoryRefused',
  'ProjectRefused',
  'DocumentRefused',
  'ImageRefused',
  'FileRefused',
  'NotFound',
  'NoteRefused',
  'UnknownAgent',
  'SessionRunning',
  'NoSession',
  'AttentionClosed',
  'AlwaysNotOffered',
  'QuestionUnanswered',
  'NothingToWaitFor',
  'NotHeld',
  'RuleOnAnotherList',
  'RulesChanged',
  'AlreadyDelivered',
  'CommandIdReused',
])

/** Why a note can't be kept as it is said, by reason. */
const noteRefused: Readonly<Record<NoteRefused['why'], string>> = {
  empty: 'A note needs some words.',
  long: `A note is at most ${NOTE_LENGTH} characters.`,
  full: `A project keeps at most ${NOTES_KEPT} notes. Remove one first.`,
}

/** Why a document isn't shown, by reason. */
const documentRefused: Readonly<Record<DocumentRefused['reason'], string>> = {
  not_markdown: 'Only markdown documents open here. Open the file in your editor.',
  outside: 'This file isn’t in the task’s worktree.',
  too_large: 'This document is too large to show here. Open it in your editor.',
}

/** Why an image sent with a message isn't sent, by reason, of the image by its name. */
const imageRefused = {
  unsupported: (name) => `${name} isn't a PNG, JPEG, GIF or WebP image.`,
  too_large: (name) => `${name} is over ${MESSAGE_IMAGES.bytes / (1024 * 1024)} MB.`,
  too_many: () => `A message can carry at most ${MESSAGE_IMAGES.count} images.`,
  missing: (name) => `${name} isn't kept any more. Add it again.`,
  unkept: () => 'Images can’t be sent here.',
} as const satisfies Record<ImageRefused['reason'], (name: string) => string>

/** Why a file or folder sent with a message isn't sent, by reason, of it by its name. */
const fileRefused = {
  too_large: (name) => `${name} is over ${MESSAGE_FILES.bytes / (1024 * 1024)} MB.`,
  too_many_files: (name) => `${name} holds over ${MESSAGE_FILES.entries.toLocaleString('en')} files.`,
  too_many: () => `A message can carry at most ${MESSAGE_FILES.count} files and folders.`,
  too_much: () => `A message's files come to at most ${MESSAGE_FILES.total / (1024 * 1024)} MB together.`,
  unreadable: (name) => `Althar couldn't read ${name}.`,
  missing: (name) => `${name} isn't there any more. Add it again.`,
  nowhere: () => "The task's folder isn't ready yet.",
} as const satisfies Record<FileRefused['reason'], (name: string) => string>

/** Why a project can't be changed so, by reason. */
const projectRefused = {
  no_name: 'Give the project a name.',
  last_repository: 'A project needs a repository. Add another first.',
  no_role: "That isn't a role a repository can have.",
  not_a_fork: "That repository isn't a fork.",
  id_taken: "Couldn't make the project. Close the tab and start again.",
} as const satisfies Record<ProjectRefused['reason'], string>

/** Why an account can't be added, renamed or removed, by reason. */
const accountRefused = {
  no_room: "Althar has nowhere to keep a new account's folder here. Choose a folder the agent signed in with instead.",
  not_a_folder: "That isn't a folder. Choose the folder the agent keeps the account's sign-in in.",
  usual: "That's the agent's usual sign-in: it stays.",
  taken: 'That folder is an account already.',
  no_name: 'Give the account a name.',
  one: "This agent can't have a second account yet.",
  no_terminal: 'This agent signs in only inside Althar: sign in with the browser.',
} as const satisfies Record<AccountRefused['reason'], string>
