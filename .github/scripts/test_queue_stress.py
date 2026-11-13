import importlib.util
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('gate', '.github/scripts/queue-stress.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def run(i, status='completed', conclusion='success'):
    return dict(id=i, status=status, conclusion=conclusion, html_url=f'https://example.com/{i}')


def job(name='linux', status='completed', conclusion='success'):
    return dict(name=name, status=status, conclusion=conclusion)


class Tests(unittest.TestCase):
    def gate(self, runs=None, jobs=None, applies=('stress',)):
        with patch.dict('os.environ', GH_REPO='owner/repo'):
            gate = module.Gate()
        runs = runs or []
        jobs = jobs or {}
        def pages(path, key):
            if key == 'workflow_runs': return iter(runs)
            if key == 'jobs': return iter(jobs[int(path.split('/')[2])])
            if path.endswith('/files'):
                return iter([{'filename': 'packages/runtime/tests/sessions.test.ts'}])
            raise AssertionError(path)
        gate.pages = pages
        gate.api = Mock(return_value={'head': {'sha': 'abc'}})
        gate.applies = lambda name, files: name in applies
        gate.smoke_applies = Mock(return_value=True)
        return gate

    def test_empty_queued_shadow_does_not_hide_actual_run(self):
        gate = self.gate([run(2, 'queued', None), run(1)], {2: [], 1: [job()]})
        gate.check('778')

    def test_skipped_does_not_hide_failed_work(self):
        gate = self.gate([run(2, conclusion='skipped'), run(1, conclusion='failure')],
                         {2: [job(conclusion='skipped')], 1: [job(conclusion='failure')]})
        with self.assertRaisesRegex(RuntimeError, 'failed'): gate.check('773')

    def test_unsuccessful_stress_blocks(self):
        for conclusion in ('failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'startup_failure', None):
            with self.subTest(conclusion=conclusion):
                gate = self.gate([run(1, conclusion=conclusion)], {1: [job(conclusion=conclusion)]})
                with self.assertRaisesRegex(RuntimeError, 'failed'): gate.check('773')

    def test_running_and_missing_required_runs_are_waited_for(self):
        for runs, jobs in (([], {}), ([run(1, 'queued', None)], {1: []}),
                           ([run(1, 'in_progress', None)], {1: [job(status='in_progress', conclusion=None)]})):
            gate = self.gate(runs, jobs)
            gate.deadline = module.time.monotonic() + 1
            with self.assertRaisesRegex(RuntimeError, 'deadline'): gate.check('773')

    def test_ready_run_waits_instead_of_using_a_draft_skip(self):
        gate = self.gate([run(2, 'queued', None), run(1, conclusion='skipped')],
                         {2: [], 1: [job(conclusion='skipped')]})
        gate.deadline = module.time.monotonic() + 1
        with self.assertRaisesRegex(RuntimeError, 'deadline'): gate.check('773')

    def test_only_paths_explicitly_excluded_can_have_no_run(self):
        self.gate(applies=()).check('773')

    def test_windows_plan_may_explicitly_skip_smoke(self):
        gate = self.gate([run(1)], {1: [job('windows-e2e', conclusion='skipped')]}, ('desktop',))
        gate.smoke_applies.return_value = False
        gate.check('774')

    def test_a_draft_smoke_skip_cannot_admit_a_ready_pr_on_the_same_sha(self):
        gate = self.gate([run(2, 'queued', None), run(1)],
                         {2: [], 1: [job('plan'), job('windows-e2e', conclusion='skipped')]}, ('desktop',))
        gate.deadline = module.time.monotonic() + 1
        with self.assertRaisesRegex(RuntimeError, 'deadline'): gate.check('774')

    def test_unsuccessful_windows_smoke_blocks(self):
        for conclusion in ('failure', 'cancelled', 'timed_out', 'neutral', 'action_required', 'skipped'):
            with self.subTest(conclusion=conclusion):
                gate = self.gate([run(1)], {1: [job('windows-e2e', conclusion=conclusion)]}, ('desktop',))
                with self.assertRaisesRegex(RuntimeError, 'Windows smoke failed'): gate.check('774')

    def test_pending_windows_smoke_is_waited_for(self):
        gate = self.gate([run(1, 'in_progress', None)], {1: [job('windows-e2e', 'in_progress', None)]}, ('desktop',))
        gate.wait = Mock(side_effect=RuntimeError('still waiting'))
        with self.assertRaisesRegex(RuntimeError, 'still waiting'): gate.check('774')
        gate.wait.assert_called_once_with('774', 'desktop')

    def test_pending_windows_smoke_can_finish(self):
        gate = self.gate(applies=('desktop',))
        gate.workflow = Mock(side_effect=[(run(1, 'in_progress', None), [job('windows-e2e', 'in_progress', None)]),
                                          (run(1), [job('windows-e2e')])])
        gate.wait = Mock()
        gate.check('774')
        gate.wait.assert_called_once()

    def test_completed_desktop_without_smoke_decision_blocks(self):
        gate = self.gate([run(1)], {1: [job('plan')]}, ('desktop',))
        with self.assertRaisesRegex(RuntimeError, 'without a completed Windows smoke decision'): gate.check('774')

    def test_changed_head_blocks_even_if_old_checks_passed(self):
        gate = self.gate([run(1)], {1: [job()]})
        gate.api.side_effect = [{'head': {'sha': 'abc'}}, {'head': {'sha': 'def'}}]
        with self.assertRaisesRegex(RuntimeError, 'head changed'): gate.check('774')

    def test_draft_runs_no_heavy_checks_but_cannot_pass_a_group(self):
        gate = self.gate()
        gate.api.return_value = {'head': {'sha': 'abc'}, 'draft': True}
        with patch.dict('os.environ', GITHUB_EVENT_NAME='pull_request'): gate.check('774')
        with patch.dict('os.environ', GITHUB_EVENT_NAME='merge_group'):
            with self.assertRaisesRegex(RuntimeError, 'draft'): gate.check('774')

    def test_api_failure_preserves_error(self):
        gate = self.gate()
        with patch.object(module.subprocess, 'run', return_value=module.subprocess.CompletedProcess([], 1, '', 'HTTP 403 forbidden')):
            with self.assertRaisesRegex(RuntimeError, 'HTTP 403 forbidden'): module.Gate.api(gate, 'actions/runs')

    def test_actual_workflow_filters(self):
        gate = self.gate()
        self.assertFalse(module.Gate.applies(gate, 'stress', ['README.md']))
        self.assertFalse(module.Gate.applies(gate, 'stress', ['packages/runtime/src/Sessions.ts']))
        self.assertTrue(module.Gate.applies(gate, 'stress', ['packages/runtime/tests/sessions.test.ts']))
        self.assertTrue(module.Gate.applies(gate, 'desktop', ['packages/runtime/src/Sessions.ts']))

    def test_smoke_decision_uses_the_pr_heads_files(self):
        gate = self.gate()
        head = module.subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
        self.assertFalse(module.Gate.smoke_applies(gate, head, ['README.md']))
        self.assertTrue(module.Gate.smoke_applies(gate, head, ['packages/runtime/src/Sessions.ts']))


if __name__ == '__main__': unittest.main()
