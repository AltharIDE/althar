"""What "Main is red" says of a failed post-merge run: the jobs that failed, and the merges since main was last green,
those that changed what a failed job tests first.

The merge queue tests what its entries could break together, and leaves the end-to-end run, coverage and Windows to
the pull request and to post-merge (queue.yml), so a break two merges make together shows here. Naming the merges
that touched it is what whoever fixes it, or reverts it, reads first.

`python3 main-red.py <run id> <head> [<green>]` prints the body, from GH_REPO's API.
"""
import json
import os
import re
import subprocess
import sys

# What a failed job tests, from its name, as paths: the first that matches.
AREAS = (
    (r'runtime', ('packages/runtime/',)),
    (r'\bui\b', ('packages/ui/',)),
    (r'desktop|e2e|package', ('apps/desktop/', 'packages/')),
    (r'harness|packages', ('packages/', 'apps/cli/')),
)


def api(path):
    result = subprocess.run(['gh', 'api', path], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(f'gh api {path}: {result.stderr.strip()}')
    return json.loads(result.stdout)


def areas(job):
    name = job.lower()
    for pattern, paths in AREAS:
        if re.search(pattern, name):
            return paths
    return ()


def body(failed, merges, run, head, green, server='https://github.com', repo=''):
    lines = [f'post-merge failed on {head[:8]}: {run}', '']
    lines.append('Failed: ' + (', '.join(failed) if failed else 'no job said which'))
    touched = tuple(sorted({path for job in failed for path in areas(job)}))
    changed = lambda merge: bool(touched) and any(file.startswith(touched) for file in merge['files'])
    if green is None:
        return '\n'.join(lines)
    lines.extend(['', f'Merged since post-merge last passed ({server}/{repo}/compare/{green[:8]}...{head[:8]}), '
                  'those that changed what failed first:'])
    for merge in sorted(merges, key=lambda merge: not changed(merge)):
        # Where it changed, what failed first, a few by name and the rest by count.
        where = sorted({'/'.join(file.split('/')[:2]) for file in merge['files']},
                       key=lambda place: (not f'{place}/'.startswith(touched), place))
        named = ', '.join(where[:4]) + (f' and {len(where) - 4} more' if len(where) > 4 else '')
        lines.append(f'- {merge["title"]}: {named or "no files"}' + (' (changed what failed)' if changed(merge) else ''))
    return '\n'.join(lines)


def main():
    repo = os.environ['GH_REPO']
    run, head = sys.argv[1], sys.argv[2]
    green = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    jobs = api(f'repos/{repo}/actions/runs/{run}/jobs?per_page=100')['jobs']
    failed = [job['name'] for job in jobs if job['conclusion'] == 'failure']
    merges = []
    if green is not None:
        for commit in api(f'repos/{repo}/compare/{green}...{head}')['commits']:
            files = [one['filename'] for one in api(f'repos/{repo}/commits/{commit["sha"]}').get('files', [])]
            merges.append({'title': commit['commit']['message'].split('\n')[0], 'files': files})
    print(body(failed, merges, f'{os.environ.get("GITHUB_SERVER_URL", "https://github.com")}/{repo}/actions/runs/{run}',
               head, green, os.environ.get('GITHUB_SERVER_URL', 'https://github.com'), repo))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired, KeyError, ValueError) as error:
        print(f'::warning::Could not say which merges changed what failed: {error}', file=sys.stderr)
        sys.exit(1)
