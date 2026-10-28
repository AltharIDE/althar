import { MESSAGE_FILES } from '@althar/contracts'
import { products } from '@althar/connectors'
import { Cause, Option } from 'effect'

import type { AccountRefused } from './Accounts'
import type { CantMerge, DocumentRefused, FileRefused, ImageRefused, NoChangeToOpen, ProjectRefused, TaskRefused } from './errors'
import { NOTE_LENGTH, type NoteRefused, NOTES_KEPT } from './notes'
import { MESSAGE_IMAGES } from './pictures'
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
        ? `${command} isn't installed, or isn't on this computer's PATH.`
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
        return `${text(error, 'path')} isn't a git repository, in one, or a folder with one directly inside it. Choose another folder.`
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
        return 'No agent is working on this task.'
      case 'InstallFailed':
        return text(error, 'summary')
      case 'SessionFailed': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))} couldn't start.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'EffortUnchanged': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))} still thinks as hard as it did.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'ModelUnchanged': {
        const summary = text(error, 'summary')
        return `${agentName(text(error, 'agentId'))} is still on its old model.${summary === '' ? '' : ` ${summary}`}`
      }
      case 'CoordinatorUnavailable':
        return `${text(error, 'agentName')} isn't signed in, so the coordinator can't start on it. Pick another agent for the coordinator, or sign in with its own tool.`
      case 'AttentionClosed':
        return 'That call was already answered, or the agent took it back.'
      case 'RuleOnAnotherList': {
        const words = fieldOf(error, 'exact') === true ? `“${text(error, 'pattern')}”` : `Commands starting “${text(error, 'pattern')}”`
        const list = text(error, 'list') === 'never' ? '“Never”' : '“Always ask me”'
        return `${words} ${fieldOf(error, 'exact') === true ? 'is' : 'are'} on ${list}, which comes first, so nothing changed. Take ${fieldOf(error, 'exact') === true ? 'it' : 'them'} off ${list} first.`
      }
      case 'RulesChanged':
        return "The project's rules changed meanwhile, so that change wasn't made. They're shown as they are now: make it again if it's still wanted."
      case 'AlwaysNotOffered':
        return "That can't be kept as a rule for this request. Answer it once instead."
      case 'QuestionUnanswered':
        return 'Answer each question: pick an option, or write your own.'
      case 'NothingToWaitFor':
        return "The agent didn't say when its limit resets, so there's no time to wait for. Pick another model, or try it again."
      case 'NotHeld':
        return "The step isn't waiting for its usage limit any more: it carried on, or was stopped."
      case 'AlreadyDelivered':
        return "The agent already has that message, so it can't be taken back."
      case 'GitFailed': {
        const args = fieldOf(error, 'args')
        const said = lastLine(text(error, 'stderr'))
        return sentence(`git ${Array.isArray(args) ? String(args[0] ?? '') : ''} didn't work${said === '' ? '' : `: ${said}`}`)
      }
      case 'CommandIdReused':
        return 'That request was already used for something else. Try again.'
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
        return `git couldn’t sign in to push to ${remote}. Push once from a terminal so your sign-in is kept, then push again here.`
      }
      case 'CantMerge': {
        const detail = text(error, 'detail')
        return cantMerge[text(error, 'why') as CantMerge['why']]?.(detail) ?? `Althar couldn't merge it. ${detail}`
      }
      case 'NoChangeToOpen':
        return (noChangeToOpen[text(error, 'why') as NoChangeToOpen['why']] ?? noChangeToOpen.working)(text(error, 'detail'))
      case 'LaunchRefused':
      case 'AttachRefused':
        return text(error, 'message')
      case 'AutomationRefused':
        return text(error, 'message')
      case 'TaskRefused':
        return taskRefused[text(error, 'why') as TaskRefused['why']] ?? "Althar can't change the task that way."
      case 'SignOutFailed':
        return `Althar couldn't sign this account out, so it kept it and its folder. Try again, or run this in a terminal, then remove it: ${text(error, 'line')}. If the agent isn't on this computer any more, remove it anyway; its sign-in may stay behind.`
      case 'AccountRefused':
        return accountRefused[text(error, 'reason') as AccountRefused['reason']] ?? "Althar can't add that account."
      case 'ChangedSinceSeen':
        return text(error, 'what') === 'branch'
          ? 'The branch changed since you looked at it, so nothing was pushed. Have another look at what would go up, then push.'
          : text(error, 'what') === 'folder'
            ? 'What is in the task’s folder changed since you looked at it, so it stays. Have another look before you remove it.'
            : 'The pull request changed since you looked at it. Have another look before you accept it.'
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
        return "Althar can't tell whether that went through: its answer was lost. Look on the host before trying again."
      case 'ConnectorFailed':
        return hostSaid(productOf(text(error, 'product')), text(error, 'reason'), text(error, 'message'))
      // The keychain's own words, where main marked its refusal; anything else of its own — a file that won't write, a bad name, an empty reason — gets the generic sentence.
      case 'SecretsUnavailable': {
        const reason = text(error, 'reason')
        return fieldOf(error, 'keyring') === true && reason !== '' ? reason : "Althar's runtime couldn't do that. Its log has the details."
      }
      case 'CliSignedOut':
        return `${text(error, 'tool')} isn't signed in to ${text(error, 'host')} on this computer.`
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
  if (reason === 'PushRefused') return { reason, message, why: text(error, 'why') }
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
      return `${host} is asking Althar to slow down. Try again in a little while.`
    case 'unreachable':
      return `Althar couldn't reach ${host}. Try again in a moment.`
    case 'invalid_response':
      return `${host} answered in a way Althar didn't understand.`
    default:
      return sentence(`${host} said no${what}`)
  }
}

/** Why Althar won't merge a task here, by reason. */
const cantMerge = {
  pull_request: () => 'The task has a pull request: merge it there.',
  settled: () => 'The task is settled, so its branch stays as it is.',
  changed: () => 'The task’s branch changed since you looked. Look again, then merge.',
  conflicts: (files: string) =>
    `It conflicts with the default branch, in ${files}. Tell the lead to merge the default branch into its branch (merge, don’t rebase), then merge again.`,
  resolving: (files: string) =>
    `It conflicts with the default branch, in ${files}. The lead is resolving it, as the project’s rules say; merge again once it has.`,
  busy: (where: string) =>
    `The default branch is checked out in ${where} with changes not committed. Commit or put them away, then merge again.`,
  submodule: (where: string) =>
    `The merge moves the submodule at ${where}, which has changes not committed or isn’t at the commit the default branch has for it. Commit or put them away, or bring it along (git submodule update), then merge again.`,
  unreadable: (detail: string) =>
    `Althar couldn’t read the default branch’s checkout, or a submodule the merge moves, so nothing was merged. Where, and what git said:\n${detail}`,
  untracked: (files: string) => `The merge would overwrite files git doesn’t track: ${files}. Move them away, then merge again.`,
  moved: (branch: string) => `${branch} moved while Althar was merging, so nothing was merged. Merge again.`,
  missing: (branch: string) => `This Mac has no ${branch} branch to merge into.`,
} as const satisfies Record<CantMerge['why'], (detail: string) => string>

/** Why a task has no pull request to open, by reason, with the files it concerns where it says them. */
const noChangeToOpen = {
  working: () => "The task's work isn't done yet. Its pull request opens when it is.",
  stopped: () => 'The task’s work stopped before it was done, so it has no pull request to open.',
  settled: () => 'The task is settled, so its branch stays as it is.',
  opened: () => 'The task already has its pull request.',
  nothing: () => 'Every commit on the task’s branch is in a pull request already, so there’s nothing new to open one for.',
  uncommitted: (files: string) =>
    `The lead left changes it didn’t commit${files === '' ? '' : `, in ${files}`}. Ask it to commit them or clear them away, then open the pull request again.`,
  conflicts: (files: string) =>
    `The new commits don’t apply on the default branch as it is now: they conflict${files === '' ? '' : ` in ${files}`}. Ask the lead to merge the default branch into its branch (merge, don’t rebase), then open the pull request again.`,
} as const satisfies Record<NoChangeToOpen['why'], (detail: string) => string>

/** Why a task can't be abandoned, reopened or renamed, by reason. */
const taskRefused = {
  merged: 'The task is merged, so it stays done.',
  branch_gone: 'The task’s worktree and its branch are both gone, so it can’t be reopened on them.',
  abandoned: 'The task is abandoned. Reopen it to carry on.',
  no_title: 'Give the task a title.',
  title_too_long: 'Keep the title short: what should change, in a few words.',
  left_running:
    'Althar couldn’t stop what the task left running, such as a page, so it isn’t done yet. Try Done again, or keep it for later.',
  folder_in_use: 'Something runs from the task’s folder, or an agent works in it, so it stays. Stop it first, then remove the folder.',
  folder_in_way:
    'Something that isn’t the task’s worktree is where its folder goes, so the folder can’t come back there. Move it away, then try again.',
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
  'DraftClosed',
  'DraftUntitled',
  'ChangesClosed',
  'ReviewDraftClosed',
  'ReviewDraftIncomplete',
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
  empty: 'A note needs some words. To take one out, remove it.',
  long: `A note is a sentence or two: at most ${NOTE_LENGTH} characters.`,
  full: `A project keeps at most ${NOTES_KEPT} notes. Remove one that no longer holds first.`,
}

/** Why a document isn't shown, by reason. */
const documentRefused: Readonly<Record<DocumentRefused['reason'], string>> = {
  not_markdown: 'Only markdown documents open here. Open the file in your editor.',
  outside: 'This file isn’t in the task’s worktree, so Althar doesn’t show it.',
  too_large: 'This document is too large to show here. Open it in your editor.',
}

/** Why an image sent with a message isn't sent, by reason, of the image by its name. */
const imageRefused = {
  unsupported: (name) => `${name} isn't a PNG, JPEG, GIF or WebP image, so it can't be sent.`,
  too_large: (name) => `${name} is larger than ${MESSAGE_IMAGES.bytes / (1024 * 1024)} MB, so it can't be sent.`,
  too_many: () => `A message can carry at most ${MESSAGE_IMAGES.count} images.`,
  missing: (name) => `${name} isn't kept any more. Add it again.`,
  unkept: () => 'Althar has nowhere to keep images here, so none can be sent.',
} as const satisfies Record<ImageRefused['reason'], (name: string) => string>

/** Why a file or folder sent with a message isn't sent, by reason, of it by its name. */
const fileRefused = {
  too_large: (name) => `${name} is larger than ${MESSAGE_FILES.bytes / (1024 * 1024)} MB, so it can't be sent.`,
  too_many_files: (name) => `${name} holds more than ${MESSAGE_FILES.entries.toLocaleString('en')} files, so it can't be sent.`,
  too_many: () => `A message can carry at most ${MESSAGE_FILES.count} files and folders.`,
  too_much: () =>
    `A message's files can come to at most ${MESSAGE_FILES.total / (1024 * 1024)} MB together. Send some in a message of their own.`,
  unreadable: (name) => `Althar couldn't read ${name}.`,
  missing: (name) => `${name} isn't there any more. Add it again.`,
  nowhere: () => "The task's folder isn't ready on this computer, so files can't be sent to it yet.",
} as const satisfies Record<FileRefused['reason'], (name: string) => string>

/** Why a project can't be changed so, by reason. */
const projectRefused = {
  no_name: 'Give the project a name.',
  last_repository: 'The project needs a repository for its tasks to work in. Add another before leaving this one out.',
  no_role: "That isn't a role a repository can have.",
  not_a_fork: "That repository isn't a fork, so its pull requests open on it.",
  id_taken: "Althar couldn't make the project under the id its mark was drawn from. Close the tab and start again.",
} as const satisfies Record<ProjectRefused['reason'], string>

/** Why an account can't be added, renamed or removed, by reason. */
const accountRefused = {
  no_room: "Althar has nowhere to keep a new account's folder here. Choose a folder the agent signed in with instead.",
  not_a_folder: "That isn't a folder. Choose the folder the agent keeps the account's sign-in in.",
  usual: "That's the agent's usual sign-in, its first account: it stays.",
  taken: 'That folder is an account already.',
  no_name: 'Give the account a name.',
  one: "This agent keeps its sign-in where every folder shares it, so it can't have a second account yet: sign its usual one in to the account you want.",
  no_terminal: 'This agent signs in only inside Althar: sign in with the browser.',
} as const satisfies Record<AccountRefused['reason'], string>
