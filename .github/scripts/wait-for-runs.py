"""Waits for workflows to pass on a commit, for a release's guard (release.yml, host-release.yml).

  python3 .github/scripts/wait-for-runs.py --error MESSAGE WORKFLOW...

A tag may be pushed while a workflow is still running on its commit (GITHUB_SHA): this reads them all every 30 s until
each has passed. It fails with MESSAGE, `{workflow}` naming the one, as soon as one has no run on the commit or only
runs that didn't pass, and for one still running after two hours.
"""
import argparse
import json
import os
import subprocess
import sys
import time

# post-merge has taken up to 50 minutes, and it can wait its turn behind the merge before. The jobs that run this give
# it ten minutes more (timeout-minutes).
LIMIT = 120 * 60
EVERY = 30
# Reads of one workflow's runs that may fail in a row before it gives up: one that fails during a long wait says
# nothing of the runs.
FAILED_READS = 5


class Failed(Exception):
    pass


def runs(workflow, sha):
    result = subprocess.run(['gh', 'run', 'list', '--workflow', workflow, '--commit', sha, '--limit', '100',
                             '--json', 'status,conclusion,url'], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)


def wait(workflows, sha, error, read=runs, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + LIMIT
    pending = list(workflows)
    failed_reads = dict.fromkeys(pending, 0)
    said = set()
    while True:
        for workflow in list(pending):
            try:
                found = read(workflow, sha)
            except (RuntimeError, subprocess.TimeoutExpired, ValueError) as problem:
                failed_reads[workflow] += 1
                print(f"Couldn't read {workflow}'s runs: {problem}", flush=True)
                if failed_reads[workflow] >= FAILED_READS:
                    raise Failed(f"Couldn't read {workflow}'s runs on {sha[:8]} from GitHub. Re-run this.")
                continue
            failed_reads[workflow] = 0
            # One pass is enough, whatever other runs on the commit did.
            if any(run['conclusion'] == 'success' for run in found):
                print(f'{workflow} passed on {sha[:8]}', flush=True)
                pending.remove(workflow)
                continue
            running = [run for run in found if run['status'] != 'completed']
            if not running:
                for run in found:
                    print(f"{workflow} ended {run['conclusion']}: {run['url']}", flush=True)
                if not found:
                    print(f'{workflow} has no run on {sha[:8]}', flush=True)
                raise Failed(error.format(workflow=workflow))
            for run in running:
                if run['url'] not in said:
                    said.add(run['url'])
                    print(f"Waiting for {workflow}: {run['url']}", flush=True)
        if not pending:
            return
        # Read once more at the deadline itself: a run that passed in the last stretch still counts.
        if clock() >= deadline:
            waited = ' and '.join(pending)
            raise Failed(f'Gave up on {waited} after {LIMIT // 60} minutes. ' + error.format(workflow=pending[0]))
        sleep(min(EVERY, deadline - clock()))


def main():
    arguments = argparse.ArgumentParser()
    arguments.add_argument('--error', required=True)
    arguments.add_argument('workflows', nargs='+')
    given = arguments.parse_args()
    try:
        wait(given.workflows, os.environ['GITHUB_SHA'], given.error)
    except Failed as failure:
        print(f'::error::{failure}', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
