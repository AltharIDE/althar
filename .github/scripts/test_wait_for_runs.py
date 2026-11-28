import importlib.util
import unittest

spec = importlib.util.spec_from_file_location('waiting', '.github/scripts/wait-for-runs.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

SHA = '0123456789abcdef'
RUNNING = dict(status='in_progress', conclusion='', url='https://example.com/1')
QUEUED = dict(status='pending', conclusion='', url='https://example.com/2')
PASSED = dict(status='completed', conclusion='success', url='https://example.com/1')
FAILED = dict(status='completed', conclusion='failure', url='https://example.com/1')
CANCELLED = dict(status='completed', conclusion='cancelled', url='https://example.com/3')


class Tests(unittest.TestCase):
    def wait(self, *workflows, **reads):
        """Each workflow's reads, in order, the last one repeating; the seconds slept, once all have passed."""
        self.now = 0

        def read(workflow, sha):
            self.assertEqual(sha, SHA)
            answers = reads[workflow]
            answer = answers.pop(0) if len(answers) > 1 else answers[0]
            if isinstance(answer, Exception):
                raise answer
            return answer

        def sleep(seconds):
            self.now += seconds

        module.wait(workflows or list(reads), SHA, '{workflow} has not passed', read, lambda: self.now, sleep)
        return self.now

    def test_a_passed_run_goes_on_at_once(self):
        self.assertEqual(self.wait(post=[[PASSED]]), 0)

    def test_waits_for_a_queued_and_running_run(self):
        self.assertEqual(self.wait(post=[[QUEUED], [RUNNING], [PASSED]]), 60)

    def test_a_run_by_hand_is_waited_for_beside_a_failed_one(self):
        self.assertEqual(self.wait(post=[[RUNNING, FAILED], [PASSED, FAILED]]), 30)

    def test_waits_for_every_workflow(self):
        self.assertEqual(self.wait(post=[[RUNNING], [RUNNING], [PASSED]], host=[[PASSED]]), 60)

    def test_a_run_that_fails_while_waited_for_fails(self):
        with self.assertRaisesRegex(module.Failed, '^post has not passed$'):
            self.wait(post=[[RUNNING], [FAILED]])
        self.assertEqual(self.now, 30)

    def test_a_cancelled_run_fails(self):
        with self.assertRaisesRegex(module.Failed, '^post has not passed$'):
            self.wait(post=[[CANCELLED]])

    def test_no_run_fails_at_once_even_while_another_runs(self):
        with self.assertRaisesRegex(module.Failed, '^host has not passed$'):
            self.wait(post=[[RUNNING]], host=[[]])
        self.assertEqual(self.now, 0)

    def test_gives_up_after_the_limit(self):
        with self.assertRaisesRegex(module.Failed, '^Gave up on post after 120 minutes. post has not passed$'):
            self.wait(post=[[RUNNING]])
        self.assertLess(self.now, module.LIMIT)

    def test_a_read_that_fails_is_tried_again(self):
        self.assertEqual(self.wait(post=[RuntimeError('502'), [PASSED]]), 30)

    def test_reads_that_keep_failing_give_up(self):
        with self.assertRaisesRegex(module.Failed, "Couldn't read post's runs"):
            self.wait(post=[RuntimeError('502')])
        self.assertEqual(self.now, (module.FAILED_READS - 1) * module.EVERY)


if __name__ == '__main__':
    unittest.main()
