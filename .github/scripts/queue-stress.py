"""Gate a merge group on its PR-head stress and Windows smoke checks."""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path


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
            response = self.api(f'{path}{"&" if "?" in path else "?"}per_page=100&page={page}')
            data = response if key is None else response[key]
            yield from data
            if len(data) < 100:
                return
            page += 1

    def workflow(self, pr, head, name, needs_smoke=False):
        newest = None
        skipped = None
        for run in self.pages(f'actions/workflows/{name}.yml/runs?head_sha={head}&event=pull_request', 'workflow_runs'):
            newest = newest or run
            jobs = list(self.pages(f'actions/runs/{run["id"]}/jobs', 'jobs'))
            self.log(pr, run, name)
            if jobs:
                smoke = [job for job in jobs if job['name'] == 'windows-e2e']
                if needs_smoke and smoke and all(job['conclusion'] == 'skipped' for job in smoke):
                    # The draft's desktop run on this same SHA is not evidence
                    # that a ready PR's required smoke test passed.
                    skipped = skipped or (run, jobs)
                    continue
                # Empty queued records can shadow the real run. A completed
                # all-skipped run is evidence of no stress work on this head.
                if all(j['conclusion'] == 'skipped' for j in jobs):
                    skipped = skipped or (dict(run, status='completed', conclusion='skipped'), jobs)
                    continue
                return run, jobs
        # If no run has jobs yet, wait for the newest to start rather than
        # admitting a genuinely queued first run.
        # A ready-for-review run can be queued behind the draft's all-skipped
        # run on the same head. Wait for it to make its own decision.
        if newest is not None and newest['status'] != 'completed':
            return newest, []
        return skipped or (newest, [])

    @staticmethod
    def log(pr, run, name):
        print(f'#{pr}: {name} run {run["id"]} {run["html_url"]} '
              f'{run["status"]} / {run["conclusion"] or "pending"}', flush=True)

    def applies(self, name, files):
        # Read the workflow's actual filters, with the same glob implementation
        # as queue.yml. Missing runs are safe only when those filters exclude it.
        result = subprocess.run(['bun', '-e', '''
            const paths = Bun.YAML.parse(await Bun.file(`.github/workflows/${process.argv[1]}.yml`).text()).on.pull_request.paths
            const files = await Bun.stdin.json()
            console.log(!paths || files.some(file => {
              let included = false
              for (const path of paths) {
                const negative = path.startsWith("!")
                if (new Bun.Glob(negative ? path.slice(1) : path).match(file)) included = !negative
              }
              return included
            }))
        ''', name], input=json.dumps(files), capture_output=True, text=True,
                                timeout=min(60, max(1, self.deadline - time.monotonic())))
        if result.returncode or result.stdout.strip() not in ('true', 'false'):
            raise RuntimeError(f'Could not determine whether {name} applies: {result.stderr.strip()}')
        return result.stdout.strip() == 'true'

    def wait(self, pr, name):
        if time.monotonic() + 30 >= self.deadline:
            raise RuntimeError(f'#{pr}: {name} deadline exceeded')
        time.sleep(30)

    def smoke_applies(self, head, files):
        def command(args, **kwargs):
            result = subprocess.run(args, capture_output=True, text=True,
                                    timeout=min(60, max(1, self.deadline - time.monotonic())), **kwargs)
            if result.returncode:
                raise RuntimeError(f'Could not plan Windows smoke: {result.stderr.strip()}')
            return result.stdout.strip()
        # Read the exact PR head's graph without installing or executing its
        # code. The selector itself comes from this gate's checked-out source.
        present = subprocess.run(['git', 'cat-file', '-e', f'{head}^{{commit}}'], capture_output=True)
        if present.returncode:
            command(['git', 'fetch', '--no-tags', '--depth=1', 'origin', head])
        with tempfile.TemporaryDirectory(prefix='althar-smoke-') as directory:
            command(['git', 'worktree', 'add', '--detach', directory, head])
            try:
                selector = (Path(__file__).resolve().parents[2] / 'packages/testing/src/select.ts').as_uri()
                output = command(['bun', '-e', '''
                    const {plan, repository} = await import(process.argv[1])
                    console.log(plan(await Bun.stdin.json(), repository(process.argv[2]), 'desktop').windowsE2e)
                ''', selector, directory], input=json.dumps(files))
            finally:
                command(['git', 'worktree', 'remove', directory])
        if output not in ('true', 'false'):
            raise RuntimeError('Windows smoke planner returned no decision')
        return output == 'true'

    def check(self, pr):
        pull = self.api(f'pulls/{pr}')
        head = pull['head']['sha']
        if pull.get('draft'):
            if os.environ.get('GITHUB_EVENT_NAME') == 'merge_group':
                raise RuntimeError(f'#{pr}: a draft cannot pass the merge queue')
            return
        files = [file['filename'] for file in self.pages(f'pulls/{pr}/files', None)]
        for name in ('stress', 'desktop'):
            if not self.applies(name, files):
                print(f'#{pr} at {head}: {name} not applicable to these paths', flush=True)
                continue
            needs_smoke = name == 'desktop' and self.smoke_applies(head, files)
            if name == 'desktop' and not needs_smoke:
                print(f'#{pr} at {head}: Windows smoke excluded by its head’s plan', flush=True)
                continue
            while True:
                run, jobs = self.workflow(pr, head, name, needs_smoke=needs_smoke)
                if name == 'stress':
                    if run is not None and run['status'] == 'completed':
                        if run['conclusion'] != 'success' or not jobs:
                            raise RuntimeError(f'#{pr}: stress failed to complete successfully: {run["conclusion"]}')
                        break
                else:
                    # The desktop plan explicitly skips the smoke job for work
                    # that does not need it. A missing/pending job is not a skip.
                    smoke = [job for job in jobs if job['name'] == 'windows-e2e']
                    if smoke and all(job['status'] == 'completed' for job in smoke):
                        if any(job['conclusion'] != 'success' for job in smoke):
                            raise RuntimeError(f'#{pr}: Windows smoke failed to complete successfully')
                        break
                    if run is not None and run['status'] == 'completed':
                        raise RuntimeError(f'#{pr}: desktop completed without a completed Windows smoke decision')
                self.wait(pr, name)
        # PR files and check results must all describe the head first read,
        # including when a push arrives while this gate is waiting.
        if self.api(f'pulls/{pr}')['head']['sha'] != head:
            raise RuntimeError(f'#{pr}: head changed while its checks were being read')


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
