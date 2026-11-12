"""Gate a merge group on its PR-head stress and Windows smoke checks."""
import json
import os
import re
import subprocess
import sys
import time


class Gate:
    def __init__(self):
        self.repo = os.environ['GH_REPO']
        # One deadline for the entire group, leaving ten minutes of job timeout.
        self.deadline = time.monotonic() + 70 * 60

    def api(self, path):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('70-minute group stress deadline exceeded')
        # No process substitution: gh failures and stderr reach the failing step.
        result = subprocess.run(['gh', 'api', f'repos/{self.repo}/{path}'],
                                capture_output=True, text=True,
                                timeout=min(60, remaining))
        if result.returncode:
            raise RuntimeError(f'gh api {path}: {result.stderr.strip()}')
        return json.loads(result.stdout)

    def pages(self, path, key):
        page = 1
        while True:
            data = self.api(f'{path}{"&" if "?" in path else "?"}per_page=100&page={page}')[key]
            yield from data
            if len(data) < 100:
                return
            page += 1

    def stress(self, pr, head):
        newest = None
        skipped = None
        for run in self.pages(f'actions/workflows/stress.yml/runs?head_sha={head}&event=pull_request', 'workflow_runs'):
            newest = newest or run
            jobs = list(self.pages(f'actions/runs/{run["id"]}/jobs', 'jobs'))
            self.log(pr, run)
            if jobs:
                # Empty queued records can shadow the real run. A completed
                # all-skipped run is evidence of no stress work on this head.
                if all(j['conclusion'] == 'skipped' for j in jobs):
                    skipped = skipped or dict(run, status='completed', conclusion='skipped')
                    continue
                return run
        # If no run has jobs yet, wait for the newest to start rather than
        # admitting a genuinely queued first run.
        return skipped or newest

    @staticmethod
    def log(pr, run):
        print(f'#{pr}: stress run {run["id"]} {run["html_url"]} '
              f'{run["status"]} / {run["conclusion"] or "pending"}', flush=True)

    def check(self, pr):
        head = self.api(f'pulls/{pr}')['head']['sha']
        while True:
            run = self.stress(pr, head)
            if run is None or run['status'] == 'completed':
                break
            if time.monotonic() + 30 >= self.deadline:
                raise RuntimeError(f'#{pr}: stress deadline exceeded: {run["html_url"]} ({run["status"]})')
            time.sleep(30)
        stress = run['conclusion'] if run else 'not run'
        checks = self.pages(f'commits/{head}/check-runs?check_name=windows-e2e', 'check_runs')
        smoke_failed = any(c['conclusion'] == 'failure' for c in checks)
        print(f'#{pr} at {head}: stress {stress}, Windows smoke failure={smoke_failed}', flush=True)
        if stress == 'failure' or smoke_failed:
            raise RuntimeError(f'#{pr}: stress or Windows smoke failed on its own head')


def main():
    gate = Gate()
    prs = sys.argv[1:]
    if not prs:
        compare = gate.api(f'compare/{os.environ["BASE_SHA"]}...{os.environ["GITHUB_SHA"]}')
        prs = list(dict.fromkeys(m.group(1) for c in compare['commits']
                                if (m := re.search(r'\(#([0-9]+)\)$', c['commit']['message'].split('\n')[0]))))
        if not prs:
            raise RuntimeError('No grouped PR numbers found in merge-group commits')
    for pr in prs:
        gate.check(pr)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired, ValueError, KeyError) as error:
        print(f'::error::{error}', flush=True)
        sys.exit(1)
