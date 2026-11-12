import importlib.util
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gate', '.github/scripts/queue-stress.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def run(i, status='completed', conclusion='success'):
    return dict(id=i, status=status, conclusion=conclusion, html_url=f'https://example.com/{i}')


class Tests(unittest.TestCase):
    def gate(self, runs, jobs):
        with patch.dict('os.environ', GH_REPO='owner/repo'):
            gate = module.Gate()
        def pages(path, key):
            if key == 'workflow_runs':
                return iter(runs)
            if key == 'jobs':
                return iter(jobs[int(path.split('/')[2])])
            return iter([])
        gate.pages = pages
        gate.api = lambda path: {'head': {'sha': 'abc'}}
        return gate

    def test_empty_queued_shadow_and_skipped(self):
        gate = self.gate([run(2, 'queued', None), run(1, conclusion='skipped')],
                         {2: [], 1: [{'conclusion': 'skipped'}]})
        self.assertEqual(gate.stress('778', 'abc')['conclusion'], 'skipped')

    def test_skipped_does_not_hide_failed_work(self):
        gate = self.gate([run(2, conclusion='skipped'), run(1, conclusion='failure')],
                         {2: [{'conclusion': 'skipped'}], 1: [{'conclusion': 'failure'}]})
        with self.assertRaisesRegex(RuntimeError, 'failed'):
            gate.check('773')

    def test_deadline(self):
        gate = self.gate([run(1, 'in_progress', None)], {1: [{'conclusion': None}]})
        gate.deadline = module.time.monotonic() + 1
        with self.assertRaisesRegex(RuntimeError, 'deadline'):
            gate.check('773')

    def test_first_queued_run_is_waited_for(self):
        gate = self.gate([run(1, 'queued', None)], {1: []})
        gate.deadline = module.time.monotonic() + 1
        with self.assertRaisesRegex(RuntimeError, 'deadline'):
            gate.check('773')

    def test_api_failure_preserves_error(self):
        with patch.dict('os.environ', GH_REPO='owner/repo'):
            gate = module.Gate()
        with patch.object(module.subprocess, 'run', return_value=module.subprocess.CompletedProcess([], 1, '', 'HTTP 403 forbidden')):
            with self.assertRaisesRegex(RuntimeError, 'HTTP 403 forbidden'):
                gate.api('actions/runs')

    def test_windows_failure_blocks(self):
        gate = self.gate([], {})
        gate.pages = lambda path, key: iter([{'conclusion': 'failure'}] if key == 'check_runs' else [])
        with self.assertRaisesRegex(RuntimeError, 'failed'):
            gate.check('774')


if __name__ == '__main__':
    unittest.main()
