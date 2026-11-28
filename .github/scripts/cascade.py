"""The cascade (cascade.yml): what lands on a release branch is carried on to the next newer release branch of its line,
and from the newest into main, through a pull request that merges by itself once its checks pass.

  python3 .github/scripts/cascade.py --from release/0.10     carry release/0.10 on
  python3 .github/scripts/cascade.py --pull 1234             after cascade pull request 1234: land it once a person has
                                                              fixed its conflicts, or carry on its source once it merged

A line is the release branches that differ only by version: release/0.9, release/0.10 and on are the desktop app's,
release/host-0.2 and on the host's. Each carries into the next newer one of its own line, and the newest into main, so a
fix on release/0.9 reaches release/0.10 first, and main from there.

Main's merge queue squashes, so a cascade can't go by git's ancestry: once squashed, main shares nothing with the release
branch past where it was cut. Each cascade commit names the source commit it carries up to instead, in a trailer
(`Cascade-from: <branch> <sha>`), which the squash keeps (the repository squashes with the commits' messages). The next
cascade merges from there: a three-way merge of the target and the source, with that commit as the base, so only what
landed on the source since is carried. Without a trailer, the base is where the two branches meet.

A cascade never carries a version: a release branch's patch bump stays its own, and its target keeps its own version
(package.json's, app.json's and bun.lock's version lines).

A cascade that merges cleanly is pushed to cascade/<source>-into-<target> and its pull request merges by itself: with
auto-merge where the target's rules require checks (main's merge queue), and otherwise by this script, once the pull
request's checks have passed. One that conflicts is committed with its conflict markers, and its pull request stays open
as a draft that names the files; once a person pushes the fix to its branch, it is marked ready and merged the same way.
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

BOT = ('github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com')
RELEASE = re.compile(r'^release/(?P<line>[a-z][a-z-]*-)?(?P<major>\d+)\.(?P<minor>\d+)$')
# The files whose version lines a cascade leaves as the target has them, and those lines.
VERSION_FILES = ('package.json', 'app.json', 'bun.lock')
VERSION_LINE = re.compile(r'^\s*"(version|buildNumber|versionCode)":\s*("[^"]*"|\d+),?\s*$')
SHA = re.compile(r'^[0-9a-f]{40}$')
# Waiting for a pull request's checks: the longest of althar's take 75 minutes. The job's limit is a little over this;
# a repository whose checks are short sets its own (CASCADE_WAIT_MINUTES).
LIMIT = int(os.environ.get('CASCADE_WAIT_MINUTES', '110')) * 60
EVERY = 30
# Checks GitHub hasn't started yet don't show: none after this long means the pull request has none.
GRACE = 120


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


def head_branch(source, target):
    return f'cascade/{source.replace("/", "-")}-into-{target.replace("/", "-")}'


def is_ancestor(older, newer):
    return git('merge-base', '--is-ancestor', older, newer, check=False).returncode == 0


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
    """`new` with each version line it changed from `old` as `old` has it."""
    before, after = old.splitlines(keepends=True), new.splitlines(keepends=True)
    kept = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes():
        if op == 'replace' and i2 - i1 == j2 - j1:
            # Line for line: a version line changed into a version line stays as it was.
            for was, now in zip(before[i1:i2], after[j1:j2]):
                same = VERSION_LINE.match(was) and VERSION_LINE.match(now)
                kept.append(was if same and same[1] == VERSION_LINE.match(was)[1] else now)
        else:
            kept.extend(after[j1:j2])
    return ''.join(kept)


def without_versions(base, source):
    """`source`, or a commit on it with the version lines it changed since `base` as `base` has them."""
    paths = [path for path in out('diff', '--name-only', '--no-renames', base, source).splitlines()
             if path.rsplit('/', 1)[-1] in VERSION_FILES]
    changed = []
    for path in paths:
        old, new = git('show', f'{base}:{path}', check=False), git('show', f'{source}:{path}', check=False)
        if old.returncode or new.returncode:
            continue
        kept = keep_versions(old.stdout, new.stdout)
        if kept != new.stdout:
            changed.append((path, out('hash-object', '-w', '--stdin', input=kept)))
    if not changed:
        return source
    with tempfile.TemporaryDirectory() as folder:
        index = {'GIT_INDEX_FILE': os.path.join(folder, 'index')}
        git('read-tree', source, env=index)
        for path, blob in changed:
            mode = out('ls-tree', '--format=%(objectmode)', source, '--', path)
            git('update-index', '--cacheinfo', f'{mode},{blob},{path}', env=index)
        tree = out('write-tree', env=index)
    return out('commit-tree', tree, '-p', source, '-m', 'Keep the target\'s versions', env=identity())


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


def message(source, target, base, head, conflicts):
    """The cascade commit's message: what it carries, and the trailer the next cascade starts from."""
    landed = out('log', '--no-merges', '--format=- %s (%h)', f'{base}..{head}').splitlines()
    lines = [f'Cascade {source} into {target}', '', f'What landed on {source} since {base[:8]}:', *landed, '']
    if conflicts:
        lines.append(f'Cascade-conflicts: {", ".join(conflicts)}')
    lines.append(f'Cascade-from: {source} {head}')
    return '\n'.join(lines) + '\n'


def body(source, target, base, head, branch, conflicts):
    landed = out('log', '--no-merges', '--format=- %s (%h)', f'{base}..{head}').splitlines()
    lines = [f'<!-- cascade: {source} into {target} -->',
             f'Carries what landed on `{source}` since `{base[:8]}` into `{target}` (`.github/workflows/cascade.yml`):', '',
             *landed, '']
    if conflicts:
        lines += [f"It doesn't merge cleanly. These files conflict, and are committed here with git's conflict markers:", '',
                  *[f'- `{path}`' for path in conflicts], '',
                  f'To finish it, check out `{branch}`, fix them, commit and push. The cascade then marks this ready and '
                  'merges it once its checks pass.']
    else:
        lines.append('It merges by itself once its checks pass.')
    return '\n'.join(lines) + '\n'


def source_of(text):
    found = re.search(r'<!-- cascade: (\S+) into (\S+) -->', text or '')
    return found and (found[1], found[2])


def open_pull(branch, target):
    found = json.loads(gh('pr', 'list', '--head', branch, '--base', target, '--state', 'open',
                          '--json', 'number,isDraft,url,headRefOid'))
    return found[0] if found else None


def by_bot(sha):
    return out('log', '-1', '--format=%ae', sha) == BOT[1]


def auto_merges(repo, target):
    """How GitHub merges into `target` by itself: 'queue', 'auto' where its rules require checks, else None."""
    rules = {rule['type'] for rule in json.loads(gh('api', f'repos/{repo}/rules/branches/{target}'))}
    if 'merge_queue' in rules:
        return 'queue'
    allowed = json.loads(gh('api', f'repos/{repo}'))['allow_auto_merge']
    protected = json.loads(gh('api', f'repos/{repo}/branches/{target}'))['protected']
    return 'auto' if allowed and ('required_status_checks' in rules or protected) else None


def checks(pull, workflow):
    """The pull request's head and its checks, as 'pending', 'passed' or 'failed'; this workflow's own left out."""
    found = json.loads(gh('pr', 'view', str(pull), '--json', 'headRefOid,state,statusCheckRollup'))
    states = []
    for check in found['statusCheckRollup']:
        if check.get('workflowName') == workflow:
            continue
        if check.get('__typename') == 'StatusContext':
            state = check['state']
            states.append('passed' if state == 'SUCCESS' else 'pending' if state in ('PENDING', 'EXPECTED') else 'failed')
        elif check['status'] != 'COMPLETED':
            states.append('pending')
        else:
            states.append('passed' if check['conclusion'] in ('SUCCESS', 'SKIPPED', 'NEUTRAL') else 'failed')
    return found['headRefOid'], found['state'], states


def wait(pull, head, workflow, read=checks, clock=time.monotonic, sleep=time.sleep):
    """Waits for the pull request's checks on `head`: 'passed', 'failed', 'moved' (its head changed) or 'closed'."""
    start = clock()
    while True:
        now, state, states = read(pull, workflow)
        if state != 'OPEN':
            return 'closed'
        if now != head:
            return 'moved'
        if 'failed' in states:
            return 'failed'
        if states and 'pending' not in states:
            return 'passed'
        if not states and clock() - start >= GRACE:
            return 'passed'
        if clock() - start >= LIMIT:
            raise Failed(f'Gave up on #{pull} after {LIMIT // 60} minutes of checks.')
        sleep(EVERY)


def land(repo, pull, target, head, workflow):
    """Merges the pull request by itself: by auto-merge where GitHub can, else once its checks have passed here."""
    way = auto_merges(repo, target)
    if way == 'queue':
        gh('pr', 'merge', str(pull), '--auto', '--match-head-commit', head)
        print(f'#{pull} joins the merge queue once its checks pass.')
        return
    if way == 'auto':
        gh('pr', 'merge', str(pull), '--auto', '--squash', '--match-head-commit', head)
        print(f'#{pull} merges once its checks pass.')
        return
    print(f'Waiting for the checks of #{pull} ({target} has no auto-merge).', flush=True)
    outcome = wait(pull, head, workflow)
    if outcome == 'passed':
        # The commits' messages, so the trailer reaches the target as it does through the queue.
        messages = out('log', '--format=%B', f'origin/{target}..{head}')
        subject, _, rest = messages.partition('\n')
        gh('pr', 'merge', str(pull), '--squash', '--match-head-commit', head, '--subject', f'{subject} (#{pull})',
           '--body', rest.strip())
        print(f'Merged #{pull} into {target}.')
    elif outcome == 'failed':
        gh('pr', 'comment', str(pull), '--body', 'A check failed, so this stays open. Fix it here, and push: the '
           'cascade merges it once its checks pass.')
        raise Failed(f'A check of #{pull} failed: it stays open.')
    else:
        print(f'#{pull} {outcome} while its checks ran: what moved it carries on.')


def cascade(repo, source, default, workflow):
    branches = [ref.removeprefix('origin/') for ref in
                out('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/release/').splitlines()]
    if source not in branches:
        raise Failed(f'{source} is not a branch on origin.')
    if not version(source):
        raise Failed(f'{source} is not a release branch, such as release/0.10 or release/host-0.2.')
    target = next_branch(source, branches, default)
    theirs, ours = f'origin/{source}', f'origin/{target}'
    head = out('rev-parse', theirs)
    base = carried(ours, source, head) or out('merge-base', ours, theirs)
    branch = head_branch(source, target)
    print(f'{source} carries into {target}, from {base[:8]} to {head[:8]}.')
    existing = open_pull(branch, target)
    tree, conflicts = merge(base, ours, without_versions(base, head)) if base != head else (None, [])
    if base == head or (not conflicts and tree == out('rev-parse', f'{ours}^{{tree}}')):
        print(f'{target} has everything of {source} already.')
        if existing:
            gh('pr', 'close', str(existing['number']), '--delete-branch', '--comment',
               f'{target} has everything of {source} already.')
        return
    if existing and not by_bot(existing['headRefOid']):
        # A person is fixing it: their commits stay. Once it merges, the cascade carries the rest (cascade.yml).
        gh('pr', 'comment', str(existing['number']), '--body',
           f'{source} moved on to `{head[:8]}`. Once this merges, the cascade carries the rest.')
        print(f'#{existing["number"]} has a person\'s commits: left as it is.')
        return
    commit = out('commit-tree', tree, '-p', ours, '-F', '-', input=message(source, target, base, head, conflicts),
                 env=identity())
    git('push', '--force', 'origin', f'{commit}:refs/heads/{branch}')
    title, text = f'Cascade {source} into {target}', body(source, target, base, head, branch, conflicts)
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
    land(repo, pull, target, commit, workflow)


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
    elif found['state'] == 'OPEN' and not by_bot(found['headRefOid']):
        # A person pushed the fix for its conflicts.
        if found['isDraft']:
            gh('pr', 'ready', str(pull))
            # Ready, it runs more checks (althar's end-to-end runs): they show a little after.
            time.sleep(60)
        land(repo, pull, target, found['headRefOid'], workflow)


def main():
    arguments = argparse.ArgumentParser()
    given = arguments.add_mutually_exclusive_group(required=True)
    given.add_argument('--from', dest='source')
    given.add_argument('--pull', type=int)
    given.add_argument('--pushed', help='a cascade/… branch a person pushed to')
    given = arguments.parse_args()
    repo, default = os.environ['GITHUB_REPOSITORY'], os.environ.get('DEFAULT_BRANCH', 'main')
    workflow = os.environ.get('GITHUB_WORKFLOW', 'cascade')
    try:
        if given.source:
            cascade(repo, given.source, default, workflow)
        elif given.pull:
            after(repo, given.pull, default, workflow)
        else:
            found = json.loads(gh('pr', 'list', '--head', given.pushed, '--state', 'open', '--json', 'number'))
            if not found:
                print(f'{given.pushed} has no open pull request.')
                return
            after(repo, found[0]['number'], default, workflow)
    except Failed as failure:
        print(f'::error::{failure}', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
