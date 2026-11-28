"""The cascade (cascade.yml): what lands on a release branch is carried on to the next newer release branch of its line,
and from the newest into main, through a pull request that merges by itself once its checks pass.

  python3 .github/scripts/cascade.py --from release/0.10     carry release/0.10 on
  python3 .github/scripts/cascade.py --pull 1234             after cascade pull request 1234 was marked ready (a person
                                                              fixed its conflicts) or merged (carry on its source)

A line is the release branches that differ only by version: release/0.9, release/0.10 and on are the desktop app's,
release/host-0.2 and on the host's. Each carries into the next newer one of its own line, and the newest into main, so a
fix on release/0.9 reaches release/0.10 first, and main from there. A cascade whose target is no longer the next branch
along, as when release/0.11 is cut while release/0.10's pull request to main is open, is closed and made again to the
new one, on every run and before any pull request is merged.

Main's merge queue squashes, so a cascade can't go by git's ancestry: once squashed, main shares nothing with the release
branch past where it was cut. Each cascade commit names the source commit it carries up to instead, in a trailer
(`Cascade-from: <branch> <sha>`), which the squash keeps (the repository squashes with the commits' messages). The next
cascade merges from there: a three-way merge of the target and the source, with that commit as the base, so only what
landed on the source since is carried. Without a trailer, the base is where the two branches meet.

A cascade never carries a version: the target keeps its own `version`, `buildNumber` and `versionCode` fields
(package.json's, app.json's and bun.lock's), whether it has them or not. A file where that can't be done on its text is
left to a person, as a conflict is.

A cascade that merges cleanly is pushed to cascade/<source>-into-<target> and its pull request merges by itself: with
auto-merge where the target's rules require checks (main's merge queue), and otherwise by this script, once the checks
it was told to expect (CASCADE_CHECKS) have passed on the pull request's head. One that conflicts is committed with its
conflict markers, and its pull request stays open as a draft that names the files. A person pushes the fix to its
branch and marks it ready; once no conflict markers are left in those files, it merges the same way. The cascade pushes
with a lease on what it read, and never over a commit of a person's.
"""
import argparse
import difflib
import fnmatch
import json
import os
import re
import subprocess
import sys
import tempfile
import time

BOT = ('github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com')
RELEASE = re.compile(r'^release/(?P<line>[a-z][a-z-]*-)?(?P<major>\d+)\.(?P<minor>\d+)$')
# The files whose version fields a cascade leaves as the target has them, and those fields.
VERSION_FILES = ('package.json', 'app.json', 'bun.lock')
VERSION_KEYS = ('version', 'buildNumber', 'versionCode')
VERSION_LINE = re.compile(r'^\s*"(version|buildNumber|versionCode)":\s*("[^"]*"|\d+),?\s*$')
SHA = re.compile(r'^[0-9a-f]{40}$')
MARKER = re.compile(r'^(<<<<<<<|>>>>>>>) ', re.M)
# Waiting for a pull request's checks: the longest of althar's take 75 minutes. The job's limit is a little over this;
# a repository whose checks are short sets its own (CASCADE_WAIT_MINUTES).
LIMIT = int(os.environ.get('CASCADE_WAIT_MINUTES', '110')) * 60
EVERY = 30
# The checks that must pass on a pull request's head before it is merged where GitHub has no auto-merge, by name,
# comma-separated: althar's `merge queue`, which passes only once all of a pull request's own checks have, mobile's
# `check`. A pull request that changes only paths those checks' workflows skip (CASCADE_UNCHECKED, globs) expects none.
CHECKS = [name.strip() for name in os.environ.get('CASCADE_CHECKS', '').split(',') if name.strip()]
UNCHECKED = [glob.strip() for glob in os.environ.get('CASCADE_UNCHECKED', '').split(',') if glob.strip()]


class Failed(Exception):
    pass


def git(*args, input=None, env=None, check=True):
    result = subprocess.run(['git', *args], input=input, capture_output=True, text=True,
                            env={**os.environ, **(env or {})})
    if check and result.returncode:
        raise Failed(f'git {" ".join(args)}: {result.stderr.strip()}')
    return result


def out(*args, **options):
    return git(*args, **options).stdout.strip()


def gh(*args, check=True):
    result = subprocess.run(['gh', *args], capture_output=True, text=True, timeout=120)
    if check and result.returncode:
        raise Failed(f'gh {" ".join(args[:3])}: {result.stderr.strip()}')
    return result.stdout.strip()


def version(branch):
    """A release branch's line and version, or None for any other branch."""
    found = RELEASE.match(branch)
    return found and (found['line'] or '', (int(found['major']), int(found['minor'])))


def next_branch(source, branches, default):
    """Where `source` carries to: the next newer release branch of its line, or `default` past the newest."""
    line, at = version(source)
    newer = [(version(branch)[1], branch) for branch in branches
             if version(branch) and version(branch)[0] == line and version(branch)[1] > at]
    return min(newer)[1] if newer else default


def release_branches():
    return [ref.removeprefix('origin/') for ref in
            out('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/release/').splitlines()]


def head_branch(source, target):
    return f'cascade/{source.replace("/", "-")}-into-{target.replace("/", "-")}'


def is_ancestor(older, newer):
    return git('merge-base', '--is-ancestor', older, newer, check=False).returncode == 0


def remote(branch):
    """Where origin's `branch` is, as last fetched, or None."""
    found = git('rev-parse', '-q', '--verify', f'refs/remotes/origin/{branch}^{{commit}}', check=False)
    return found.stdout.strip() if found.returncode == 0 else None


def peoples(target, head):
    """The commits on `head`, not on `target`, that a person made."""
    return [sha for sha, email in (line.split(' ', 1) for line in
                                   out('log', '--format=%H %ae', f'{target}..{head}').splitlines())
            if email != BOT[1]]


def carried(target, source, at):
    """The newest commit of the branch `source` (at `at`) that a cascade carried into `target` already, from their
    trailers, or None."""
    trailer = re.compile(rf'^Cascade-from: {re.escape(source)} (\S+)\s*$', re.M)
    log = out('log', '-F', f'--grep=Cascade-from: {source} ', '--format=%B%x00', target)
    for message in log.split('\0'):
        # One squash can hold more than one, as when a person's fix followed a cascade: the newest of them.
        shas = [sha for sha in trailer.findall(message) if SHA.match(sha) and is_ancestor(sha, at)]
        if shas:
            return next(sha for sha in shas if all(is_ancestor(other, sha) for other in shas))
    return None


def keep_versions(old, new):
    """`new`'s text with each version field it changed, added or removed from `old` as `old` has it."""
    before, after = old.splitlines(keepends=True), new.splitlines(keepends=True)

    def rest(lines):
        # What a run of lines says besides its version fields, a comma their coming or going moved left out.
        return [line.rstrip().rstrip(',') for line in lines if not VERSION_LINE.match(line)]

    kept = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes():
        was, now = before[i1:i2], after[j1:j2]
        if op == 'equal':
            kept.extend(now)
        elif rest(was) == rest(now):
            # Only version fields changed here, with the commas around them.
            kept.extend(was)
        elif op == 'replace' and len(was) == len(now):
            # Line for line: a version line changed into the same field's line stays as it was.
            for one, other in zip(was, now):
                same = VERSION_LINE.match(one) and VERSION_LINE.match(other)
                kept.append(one if same and VERSION_LINE.match(one)[1] == VERSION_LINE.match(other)[1] else other)
        else:
            kept.extend(now)
    return ''.join(kept)


def with_versions(document, of):
    """The JSON `document` with every version field as `of` has it: set where it has one, left out where it hasn't."""
    if not isinstance(document, dict):
        return document
    of = of if isinstance(of, dict) else {}
    result = {}
    for key, value in document.items():
        if key in VERSION_KEYS and not isinstance(value, (dict, list)):
            if key in of:
                result[key] = of[key]
        else:
            result[key] = with_versions(value, of.get(key))
    for key in VERSION_KEYS:
        if key in of and key not in document and not isinstance(of[key], (dict, list)):
            result[key] = of[key]
    return result


def versions_kept(path, old, new):
    """`new` with `old`'s version fields, keeping `new`'s text otherwise, or None where that can't be done."""
    kept = keep_versions(old, new)
    if not path.endswith('.json'):
        return kept
    try:
        wanted = with_versions(json.loads(new), json.loads(old))
        if json.loads(kept) == wanted:
            return kept
        # Written as Python writes JSON, the file can be written again whole.
        if json.dumps(json.loads(new), indent=2, ensure_ascii=False) + '\n' == new:
            return json.dumps(wanted, indent=2, ensure_ascii=False) + '\n'
    except ValueError:
        pass
    return None


def without_versions(base, source):
    """`source`, or a commit on it with the version fields it changed since `base` as `base` has them; and the files
    where that couldn't be done."""
    paths = [path for path in out('diff', '--name-only', '--no-renames', base, source).splitlines()
             if path.rsplit('/', 1)[-1] in VERSION_FILES]
    changed, unsure = [], []
    for path in paths:
        old, new = git('show', f'{base}:{path}', check=False), git('show', f'{source}:{path}', check=False)
        if old.returncode or new.returncode:
            continue
        kept = versions_kept(path, old.stdout, new.stdout)
        if kept is None:
            unsure.append(path)
        elif kept != new.stdout:
            changed.append((path, out('hash-object', '-w', '--stdin', input=kept)))
    if not changed:
        return source, unsure
    with tempfile.TemporaryDirectory() as folder:
        index = {'GIT_INDEX_FILE': os.path.join(folder, 'index')}
        git('read-tree', source, env=index)
        for path, blob in changed:
            mode = out('ls-tree', '--format=%(objectmode)', source, '--', path)
            git('update-index', '--cacheinfo', f'{mode},{blob},{path}', env=index)
        tree = out('write-tree', env=index)
    return out('commit-tree', tree, '-p', source, '-m', "Keep the target's versions", env=identity()), unsure


def merge(base, target, source):
    """The tree of `source` merged into `target` from `base`, and the files that conflict (committed with markers)."""
    result = git('merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', f'--merge-base={base}',
                 target, source, check=False)
    if result.returncode not in (0, 1):
        raise Failed(f'git merge-tree: {result.stderr.strip()}')
    tree, *files = [part for part in result.stdout.split('\0') if part]
    return tree, sorted(set(files))


def identity():
    name, email = BOT
    return {'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email, 'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email}


def landed(base, head):
    return out('log', '--no-merges', '--format=- %s (%h)', f'{base}..{head}').splitlines()


def message(source, target, base, head, conflicts):
    """The cascade commit's message: what it carries, and the trailer the next cascade starts from."""
    lines = [f'Cascade {source} into {target}', '', f'What landed on {source} since {base[:8]}:', *landed(base, head), '']
    if conflicts:
        lines.append(f'Cascade-conflicts: {", ".join(conflicts)}')
    lines.append(f'Cascade-from: {source} {head}')
    return '\n'.join(lines) + '\n'


def body(source, target, base, head, branch, conflicts, unsure):
    lines = [f'<!-- cascade: {source} into {target} -->',
             f'Carries what landed on `{source}` since `{base[:8]}` into `{target}` (`.github/workflows/cascade.yml`):', '',
             *landed(base, head), '']
    if conflicts:
        lines += ["It doesn't merge cleanly. Fix these files, committed here with git's conflict markers where they "
                  'conflict:', '', *[f'- `{path}`' for path in conflicts], '']
        if unsure:
            lines += ['In ' + ', '.join(f'`{path}`' for path in unsure) + f", keep `{target}`'s own version fields: the "
                      "cascade couldn't leave them out of its text.", '']
        lines.append(f'To finish it, check out `{branch}`, fix them, commit and push, then mark this ready for review. '
                     'Once no conflict markers are left in them, it merges once its checks pass.')
    else:
        lines.append('It merges by itself once its checks pass.')
    return '\n'.join(lines) + '\n'


def source_of(text):
    found = re.search(r'<!-- cascade: (\S+) into (\S+) -->', text or '')
    return found and (found[1], found[2])


def open_pulls(head=None):
    """Open cascade pull requests, from `head` alone where it is given."""
    found = json.loads(gh('pr', 'list', '--state', 'open', *(['--head', head] if head else []), '--limit', '200',
                          '--json', 'number,isDraft,headRefName,headRefOid,baseRefName,body'))
    return [pull for pull in found if pull['headRefName'].startswith('cascade/') and source_of(pull['body'])]


def merged(branch, tip):
    """Whether a pull request from `branch` at `tip` was merged: what's left of the branch is in its target already."""
    found = json.loads(gh('pr', 'list', '--head', branch, '--state', 'merged', '--limit', '20', '--json', 'headRefOid'))
    return any(pull['headRefOid'] == tip for pull in found)


def drop(repo, branch):
    """Deletes origin's `branch`, where the cascade is done with it."""
    gh('api', '-X', 'DELETE', f'repos/{repo}/git/refs/heads/{branch}', check=False)


def push(branch, commit, expected):
    """`commit` to origin's `branch`, only while it is still at `expected` (None: while it doesn't exist)."""
    lease = f'--force-with-lease=refs/heads/{branch}:{expected or ""}'
    result = git('push', lease, 'origin', f'{commit}:refs/heads/{branch}', check=False)
    if result.returncode:
        raise Failed(f'{branch} moved while the cascade ran, so nothing was pushed over it. Run the cascade again: '
                     f'{result.stderr.strip()}')


def auto_merges(repo, target):
    """How GitHub merges into `target` by itself: 'queue', 'auto' where its rules require checks, else None."""
    rules = {rule['type'] for rule in json.loads(gh('api', f'repos/{repo}/rules/branches/{target}'))}
    if 'merge_queue' in rules:
        return 'queue'
    allowed = json.loads(gh('api', f'repos/{repo}'))['allow_auto_merge']
    protected = json.loads(gh('api', f'repos/{repo}/branches/{target}'))['protected']
    return 'auto' if allowed and ('required_status_checks' in rules or protected) else None


def checks(pull, workflow):
    """The pull request's head, its state, and its checks by name, as 'pending', 'passed' or 'failed'; this workflow's
    own left out."""
    found = json.loads(gh('pr', 'view', str(pull), '--json', 'headRefOid,state,statusCheckRollup'))
    states = []
    for check in found['statusCheckRollup']:
        if check.get('workflowName') == workflow:
            continue
        if check.get('__typename') == 'StatusContext':
            state = check['state']
            states.append((check.get('context', ''), 'passed' if state == 'SUCCESS' else
                           'pending' if state in ('PENDING', 'EXPECTED') else 'failed'))
        elif check['status'] != 'COMPLETED':
            states.append((check.get('name', ''), 'pending'))
        else:
            states.append((check.get('name', ''),
                           'passed' if check['conclusion'] in ('SUCCESS', 'SKIPPED', 'NEUTRAL') else 'failed'))
    return found['headRefOid'], found['state'], states


def wait(pull, head, required, workflow, read=checks, clock=time.monotonic, sleep=time.sleep):
    """Waits until every check in `required` has passed on `head` and nothing else is running or failed: 'passed',
    'failed', 'moved' (its head changed) or 'closed'. A required check that hasn't shown yet is waited for."""
    start = clock()
    while True:
        now, state, states = read(pull, workflow)
        if state != 'OPEN':
            return 'closed'
        if now != head:
            return 'moved'
        if any(outcome == 'failed' for _, outcome in states):
            return 'failed'
        passed = {name for name, outcome in states if outcome == 'passed'}
        if all(name in passed for name in required) and not any(outcome == 'pending' for _, outcome in states):
            return 'passed'
        if clock() - start >= LIMIT:
            missing = [name for name in required if name not in passed]
            raise Failed(f'Gave up on #{pull} after {LIMIT // 60} minutes' +
                         (f': {", ".join(missing)} never passed.' if missing else ' of checks.'))
        sleep(EVERY)


def unchecked(path):
    return any(fnmatch.fnmatch(path, glob) or (glob.startswith('**/') and fnmatch.fnmatch(path, glob[3:]))
               for glob in UNCHECKED)


def expected_checks(target, head):
    """The checks that must pass on `head`: none where it changes only what their workflows skip."""
    changed = out('diff', '--name-only', f'origin/{target}...{head}').splitlines()
    if UNCHECKED and changed and all(unchecked(path) for path in changed):
        return []
    if not CHECKS:
        raise Failed('CASCADE_CHECKS names no check to wait for, so nothing can say the pull request passed.')
    return CHECKS


def retarget(repo, pull, source, target, branches, default, workflow):
    """False, after closing it and cascading its source again, where `target` is no longer where `source` carries to."""
    now = next_branch(source, branches, default)
    if now == target:
        return True
    branch = head_branch(source, target)
    tip = remote(branch)
    if tip and peoples(f'origin/{target}', tip):
        gh('pr', 'comment', str(pull), '--body', f'Cascades from `{source}` go to `{now}` now, not `{target}`. This '
           f'one has your commits, so it stays open: move them to the cascade into `{now}`, then close this.')
        print(f"::warning::#{pull} targets {target}, but {source} carries into {now} now. It has a person's commits.")
        return False
    gh('pr', 'close', str(pull), '--comment', f'Cascades from `{source}` go to `{now}` now, so this one is made again there.')
    drop(repo, branch)
    git('fetch', '--prune', '--quiet', 'origin')
    print(f'#{pull} closed: {source} carries into {now} now.')
    cascade(repo, source, default, workflow, reconciled=True)
    return False


def land(repo, pull, source, target, head, workflow):
    """Merges the pull request by itself: by auto-merge where GitHub can, else once its checks have passed here."""
    git('fetch', '--prune', '--quiet', 'origin')
    if not retarget(repo, pull, source, target, release_branches(), os.environ.get('DEFAULT_BRANCH', 'main'), workflow):
        return
    way = auto_merges(repo, target)
    if way == 'queue':
        gh('pr', 'merge', str(pull), '--auto', '--match-head-commit', head)
        print(f'#{pull} joins the merge queue once its checks pass.')
        return
    if way == 'auto':
        gh('pr', 'merge', str(pull), '--auto', '--squash', '--match-head-commit', head)
        print(f'#{pull} merges once its checks pass.')
        return
    required = expected_checks(target, head)
    print(f'Waiting for {", ".join(required) or "no check"} on #{pull} ({target} has no auto-merge).', flush=True)
    outcome = wait(pull, head, required, workflow)
    if outcome == 'passed':
        # Where the next branch along was cut while it waited.
        git('fetch', '--prune', '--quiet', 'origin')
        if not retarget(repo, pull, source, target, release_branches(), os.environ.get('DEFAULT_BRANCH', 'main'),
                        workflow):
            return
        # The commits' messages, so the trailer reaches the target as it does through the queue.
        messages = out('log', '--format=%B', f'origin/{target}..{head}')
        subject, _, rest = messages.partition('\n')
        gh('pr', 'merge', str(pull), '--squash', '--match-head-commit', head,
           '--subject', f'{subject} (#{pull})', '--body', rest.strip())
        drop(repo, head_branch(source, target))
        print(f'Merged #{pull} into {target}.')
    elif outcome == 'failed':
        gh('pr', 'comment', str(pull), '--body', 'A check failed, so this stays open. Fix it here and push: the '
           'cascade merges it once its checks pass.')
        raise Failed(f'A check of #{pull} failed: it stays open.')
    else:
        print(f'#{pull} {outcome} while its checks ran: what moved it carries on.')


def reconcile(repo, branches, default, workflow):
    """Every open cascade whose target is no longer the next branch along, as when one was cut, made again there."""
    for pull in open_pulls():
        source, target = source_of(pull['body'])
        if pull['baseRefName'] == target and version(source) and source in branches:
            retarget(repo, pull['number'], source, target, branches, default, workflow)


def cascade(repo, source, default, workflow, reconciled=False):
    branches = release_branches()
    if source not in branches:
        raise Failed(f'{source} is not a branch on origin.')
    if not version(source):
        raise Failed(f'{source} is not a release branch, such as release/0.10 or release/host-0.2.')
    if not reconciled:
        reconcile(repo, branches, default, workflow)
    target = next_branch(source, branches, default)
    theirs, ours = f'origin/{source}', f'origin/{target}'
    head = out('rev-parse', theirs)
    base = carried(ours, source, head) or out('merge-base', ours, theirs)
    branch = head_branch(source, target)
    print(f'{source} carries into {target}, from {base[:8]} to {head[:8]}.')
    existing = next(iter(open_pulls(branch)), None)
    tip = remote(branch)
    if tip and peoples(ours, tip) and not (not existing and merged(branch, tip)):
        # A person's commits stay. With its pull request open, they are fixing it, and once it merges the cascade
        # carries the rest; without one, the branch is theirs to delete or open again.
        if existing:
            gh('pr', 'comment', str(existing['number']), '--body',
               f'{source} moved on to `{head[:8]}`. Once this merges, the cascade carries the rest.')
            print(f"#{existing['number']} has a person's commits: left as it is.")
            return
        raise Failed(f"{branch} has a person's commits and no open pull request, so the cascade leaves it as it is. "
                     'Open its pull request again, or delete the branch, then run the cascade again.')
    commit, unsure = without_versions(base, head) if base != head else (head, [])
    tree, conflicts = merge(base, ours, commit) if base != head else (None, [])
    conflicts = sorted(set(conflicts) | set(unsure))
    if base == head or (not conflicts and tree == out('rev-parse', f'{ours}^{{tree}}')):
        print(f'{target} has everything of {source} already.')
        if existing:
            gh('pr', 'close', str(existing['number']), '--comment', f'{target} has everything of {source} already.')
            drop(repo, branch)
        return
    commit = out('commit-tree', tree, '-p', ours, '-F', '-', input=message(source, target, base, head, conflicts),
                 env=identity())
    push(branch, commit, tip)
    title, text = f'Cascade {source} into {target}', body(source, target, base, head, branch, conflicts, unsure)
    if existing:
        pull = existing['number']
        gh('pr', 'edit', str(pull), '--title', title, '--body', text)
        if conflicts and not existing['isDraft']:
            gh('pr', 'ready', str(pull), '--undo')
        if not conflicts and existing['isDraft']:
            gh('pr', 'ready', str(pull))
    else:
        url = gh('pr', 'create', '--base', target, '--head', branch, '--title', title, '--body', text,
                 *(['--draft'] if conflicts else []))
        pull = int(url.rstrip('/').rsplit('/', 1)[-1])
    if conflicts:
        print(f'::warning::{source} conflicts with {target} in {", ".join(conflicts)}: #{pull} waits for a person.')
        return
    land(repo, pull, source, target, commit, workflow)


def settled(target, head):
    """What still stands between a person's fix and merging it: their commits missing, or conflict markers left in the
    files the cascade named. Empty once it is settled."""
    named = sorted({path.strip() for text in re.findall(r'^Cascade-conflicts: (.*)$',
                                                         out('log', '--format=%B', f'origin/{target}..{head}'), re.M)
                    for path in text.split(',') if path.strip()})
    if not peoples(f'origin/{target}', head):
        return ['no commit of a person fixes it yet']
    marked = [path for path in named
              if MARKER.search(git('show', f'{head}:{path}', check=False).stdout)]
    return [f'conflict markers are left in {", ".join(marked)}'] if marked else []


def after(repo, pull, default, workflow):
    found = json.loads(gh('pr', 'view', str(pull), '--json', 'body,state,isDraft,headRefOid,baseRefName'))
    ends = source_of(found['body'])
    if not ends:
        print(f'#{pull} is not a cascade.')
        return
    source, target = ends
    if found['state'] == 'MERGED':
        # What landed on the source while it was open.
        cascade(repo, source, default, workflow)
        return
    if found['state'] != 'OPEN' or found['isDraft']:
        return
    head = found['headRefOid']
    if not peoples(f'origin/{target}', head) and 'Cascade-conflicts:' not in out('log', '-1', '--format=%B', head):
        # The cascade's own, made ready by the cascade, which lands it itself.
        return
    left = settled(target, head)
    if left:
        gh('pr', 'ready', str(pull), '--undo')
        gh('pr', 'comment', str(pull), '--body', f"Back to a draft: {'; '.join(left)}. Fix it, push, and mark it "
           'ready again.')
        print(f'#{pull} is not settled yet: {"; ".join(left)}.')
        return
    # Ready, a pull request runs more checks (althar's end-to-end runs): they show a little after.
    time.sleep(60)
    land(repo, pull, source, target, head, workflow)


def main():
    arguments = argparse.ArgumentParser()
    given = arguments.add_mutually_exclusive_group(required=True)
    given.add_argument('--from', dest='source')
    given.add_argument('--pull', type=int)
    given = arguments.parse_args()
    repo, default = os.environ['GITHUB_REPOSITORY'], os.environ.get('DEFAULT_BRANCH', 'main')
    workflow = os.environ.get('GITHUB_WORKFLOW', 'cascade')
    try:
        if given.source:
            cascade(repo, given.source, default, workflow)
        else:
            after(repo, given.pull, default, workflow)
    except Failed as failure:
        print(f'::error::{failure}', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
