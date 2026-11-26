"""What each entry of a merge group changes, and what landed beneath it since its pull request branched from main.

The queue tests only what its entries could break together (packages/testing/src/select.ts, queuePlan): each pull
request's own checks passed on its head before it could be queued (queue-gate.py), against main as it was then. So for
each entry this writes the files its commit changes, and the files that changed between where its pull request
branched from main and the commit beneath it in the group: main since, and the entries ahead of it. Where it branched
is as early as its checks could have run against, so what landed since covers at least what they didn't see.

`python3 queue-entries.py <out>` reads BASE_SHA and GITHUB_SHA, and writes the entries as JSON. When anything about
them can't be read, it writes nothing and fails, and the plans fall back to everything the group changes against main.
"""
import json
import os
import re
import subprocess
import sys


def api(repo, path):
    result = subprocess.run(['gh', 'api', f'repos/{repo}/{path}'], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(f'gh api {path}: {result.stderr.strip()}')
    return json.loads(result.stdout)


def git(*args):
    result = subprocess.run(['git', *args], capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError(f'git {" ".join(args)}: {result.stderr.strip()}')
    return result.stdout


def changed(start, end):
    return [line for line in git('diff', '--name-only', '--no-renames', start, end).split('\n') if line]


def number(message):
    # A squashed entry's subject ends with its pull request's number, as main's do.
    found = re.search(r'\(#([0-9]+)\)$', message.split('\n')[0])
    if found is None:
        raise RuntimeError(f'No pull request number in {message.splitlines()[0]!r}')
    return int(found.group(1))


def entries(repo, base, head, read=api, fetch=None, diff=changed):
    """The group's entries, oldest first: each one's pull request, what it changes, and what landed beneath it."""
    fetch = fetch or (lambda *shas: git('fetch', '--no-tags', '--depth=1', '--filter=blob:none', 'origin', *shas))
    commits = read(repo, f'compare/{base}...{head}')['commits']
    if not commits:
        raise RuntimeError('No commits in the merge group')
    found = []
    for commit in commits:
        sha = commit['sha']
        parents = [parent['sha'] for parent in commit['parents']]
        pr = number(commit['commit']['message'])
        # A merge commit's second parent is the pull request's head; a squashed entry's is read from it.
        pull = parents[1] if len(parents) > 1 else read(repo, f'pulls/{pr}')['head']['sha']
        branched = read(repo, f'compare/{base}...{pull}')['merge_base_commit']['sha']
        fetch(sha, parents[0], branched)
        found.append({'pr': pr, 'changes': diff(parents[0], sha), 'since': diff(branched, parents[0])})
    return found


def main():
    out = sys.argv[1]
    found = entries(os.environ['GH_REPO'], os.environ['BASE_SHA'], os.environ['GITHUB_SHA'])
    with open(out, 'w') as file:
        json.dump(found, file)
    for entry in found:
        print(f'#{entry["pr"]}: changes {len(entry["changes"])} files; {len(entry["since"])} landed beneath it since it branched')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired, ValueError, KeyError, IndexError) as error:
        print(f'::warning::The queue runs everything the group changes, as it could not tell each entry apart: {error}', flush=True)
        sys.exit(1)
