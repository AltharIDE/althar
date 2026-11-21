import { systemOf, type RuleContext, type Kept, kept } from './ruleContext'

// ---- Git -------------------------------------------------------------------

export interface GitCall {
  readonly subcommand: string
  readonly args: ReadonlyArray<string>
  /** The folder git works in, after `-C`. */
  readonly cwd: string
  /** Global options that point git at another repository: `--git-dir`, `--work-tree`. */
  readonly elsewhere: ReadonlyArray<string>
}

const GIT_OPTIONS_WITH_VALUE = ['-c', '--namespace', '--exec-path', '--super-prefix', '--config-env', '--list-cmds']

export const gitCall = (words: ReadonlyArray<string>, cwd: string, paths = systemOf().paths): GitCall | undefined => {
  if ((words[0] ?? '').split('/').at(-1) !== 'git') return undefined
  let at = cwd
  const elsewhere: Array<string> = []
  let index = 1
  while (index < words.length) {
    const word = words[index] ?? ''
    if (word === '-C') {
      at = paths.resolve(at, words[index + 1] ?? '.')
      index += 2
    } else if (word === '--git-dir' || word === '--work-tree') {
      elsewhere.push(paths.resolve(at, words[index + 1] ?? '.'))
      index += 2
    } else if (word.startsWith('--git-dir=') || word.startsWith('--work-tree=')) {
      elsewhere.push(paths.resolve(at, word.slice(word.indexOf('=') + 1)))
      index += 1
    } else if (GIT_OPTIONS_WITH_VALUE.includes(word)) {
      index += 2
    } else if (word.startsWith('-')) {
      index += 1
    } else {
      return { subcommand: word, args: words.slice(index + 1), cwd: at, elsewhere }
    }
  }
  return undefined
}

export const PUSH_OPTIONS_WITH_VALUE = ['--repo', '-o', '--push-option', '--receive-pack', '--exec']

const PUSH_FLAGS_HARMLESS =
  /^(-u|--set-upstream|-n|--dry-run|-v|--verbose|-q|--quiet|--progress|--no-progress|--no-verify|--verify|--atomic|--no-atomic|--porcelain|--ipv4|--ipv6|-4|-6|--thin|--no-thin|--signed(=.*)?|--no-signed|--recurse-submodules=.*|--no-recurse-submodules|--no-force-with-lease|--no-force-if-includes|--no-tags|--no-follow-tags)$/

/** What a push does that the rules keep for the person: every kind it is; none where it goes only where the task may push. */
export const pushKinds = (args: ReadonlyArray<string>, context: RuleContext): ReadonlyArray<Kept> => {
  const mains = context.defaultBranches ?? [context.defaultBranch]
  const own = (branch: string) => branch === context.taskBranch
  const found: Array<Kept> = []
  const positional: Array<string> = []
  let deleting = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg)
      continue
    }
    if (/^(-f|--force|--force-with-lease(=.*)?|--force-if-includes)$/.test(arg) || /^-[a-z]*f[a-z]*$/.test(arg))
      found.push(kept('A force push always asks: it can throw away commits on the remote.', 'force-push', 'irreversible'))
    else if (arg === '--mirror')
      // A mirror makes the remote's branches the same as here: it forces them, and deletes those not here.
      found.push(
        kept('Pushing every branch always asks.', 'many-branches'),
        kept(
          'A mirror push forces every branch, which always asks: it can throw away commits on the remote.',
          'force-push',
          'irreversible',
        ),
        kept(
          "A mirror push deletes the remote's branches that aren't here, which always asks: their commits may be nowhere else.",
          'delete-branch',
          'irreversible',
        ),
      )
    else if (/^(--all|--branches)$/.test(arg)) found.push(kept('Pushing every branch always asks.', 'many-branches'))
    else if (/^(--tags|--follow-tags)$/.test(arg))
      found.push(kept('Pushing tags always asks; they often start a release.', 'many-branches'))
    else if (arg === '--prune')
      found.push(
        kept('A push that deletes remote branches always asks: their commits may be nowhere else.', 'delete-branch', 'irreversible'),
      )
    else if (arg === '-d' || arg === '--delete') deleting = true
    else if (PUSH_OPTIONS_WITH_VALUE.includes(arg)) index += 1
    else if (!PUSH_OPTIONS_WITH_VALUE.some((option) => arg.startsWith(`${option}=`)) && !PUSH_FLAGS_HARMLESS.test(arg))
      found.push(kept(`Althar can't tell what \`${arg}\` does to a push, so it asks.`, 'unclear', 'irreversible'))
  }
  const [, ...refspecs] = positional
  const destinations: Array<{ readonly branch: string; readonly deletes: boolean }> = []
  // `--tags` alone pushes the tags and no branch, whichever is checked out.
  if (refspecs.length === 0 && (deleting || !args.includes('--tags'))) {
    if (deleting) found.push(kept(`Althar can't tell which branch this deletes, so it asks.`, 'unclear', 'irreversible'))
    else if (context.currentBranch === undefined)
      found.push(kept(`Althar can't tell which branch this pushes, so it asks.`, 'unclear', 'irreversible'))
    else destinations.push({ branch: context.currentBranch, deletes: false })
  }
  for (const written of refspecs) {
    // A forced refspec still goes somewhere, which counts too.
    if (written.startsWith('+'))
      found.push(kept('A force push always asks: it can throw away commits on the remote.', 'force-push', 'irreversible'))
    const refspec = written.replace(/^\+/, '')
    if (refspec.includes('*')) {
      found.push(kept('A push to a pattern of branches always asks.', 'many-branches'))
      continue
    }
    const colon = refspec.lastIndexOf(':')
    const source = colon === -1 ? refspec : refspec.slice(0, colon)
    let destination = colon === -1 ? refspec : refspec.slice(colon + 1)
    if (colon !== -1 && destination === '') {
      found.push(kept('A push of matching branches always asks.', 'many-branches'))
      continue
    }
    if (destination === 'HEAD' || (colon === -1 && source === 'HEAD')) {
      if (context.currentBranch === undefined) {
        found.push(kept(`Althar can't tell which branch this pushes, so it asks.`, 'unclear', 'irreversible'))
        continue
      }
      destination = context.currentBranch
    }
    if (destination.startsWith('refs/tags/')) {
      found.push(kept('Pushing tags always asks; they often start a release.', 'many-branches'))
      continue
    }
    if (destination.startsWith('refs/') && !destination.startsWith('refs/heads/')) {
      found.push(kept(`Althar can't tell what \`${destination}\` is, so it asks.`, 'unclear', 'irreversible'))
      continue
    }
    destinations.push({ branch: destination.replace(/^refs\/heads\//, ''), deletes: deleting || (colon !== -1 && source === '') })
  }
  for (const { branch, deletes } of destinations) {
    if (mains.includes(branch))
      found.push(
        kept(
          deletes
            ? `Deleting ${branch} always asks: everyone's work starts from it.`
            : `A push to ${branch} always asks: once others have it, it can't be taken back.`,
          'default-branch',
          'irreversible',
        ),
      )
    else if (deletes && !own(branch))
      found.push(
        kept(
          `Deleting ${branch}, which isn't this task's branch, always asks: its commits may be nowhere else.`,
          'delete-branch',
          'irreversible',
        ),
      )
  }
  return found
}
