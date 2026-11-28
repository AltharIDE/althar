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
    def wait(self, *workflows, late=0, slow=None, **reads):
        """Each workflow's reads, in order, the last one repeating; the seconds slept, once all have passed."""
        self.now = 0

        def read(workflow, sha):
            self.assertEqual(sha, SHA)
            # `late` is what the first read takes, so the polls don't fall on the limit exactly.
            nonlocal late
            self.now, late = self.now + late, 0
            # `slow` is (when, how long): the read begun at `when` takes that long to answer.
            if slow and self.now == slow[0]:
                self.now += slow[1]
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
        self.assertEqual(self.now, module.LIMIT)

    def test_a_pass_in_the_last_stretch_before_the_limit_counts(self):
        polls = module.LIMIT // module.EVERY
        self.assertEqual(self.wait(late=10, post=[*[[RUNNING]] * polls, [PASSED]]), module.LIMIT)

    def test_a_read_that_spans_the_limit_is_followed_by_a_last_one(self):
        before = module.LIMIT - module.EVERY
        polls = before // module.EVERY + 1
        waited = self.wait(slow=(before, module.EVERY + 1), post=[*[[RUNNING]] * polls, [PASSED]])
        self.assertEqual(waited, module.LIMIT + 1)

    def test_a_run_still_going_after_a_late_start_gives_up_at_the_limit(self):
        with self.assertRaisesRegex(module.Failed, '^Gave up on post'):
            self.wait(late=10, post=[[RUNNING]])
        self.assertEqual(self.now, module.LIMIT)

    def test_a_read_that_fails_is_tried_again(self):
        self.assertEqual(self.wait(post=[RuntimeError('502'), [PASSED]]), 30)

    def test_reads_that_keep_failing_give_up(self):
        with self.assertRaisesRegex(module.Failed, "Couldn't read post's runs"):
            self.wait(post=[RuntimeError('502')])
        self.assertEqual(self.now, (module.FAILED_READS - 1) * module.EVERY)

    def test_another_workflows_good_reads_do_not_reset_the_count(self):
        with self.assertRaisesRegex(module.Failed, "Couldn't read host's runs"):
            self.wait(post=[[RUNNING]], host=[RuntimeError('502')])
        self.assertEqual(self.now, (module.FAILED_READS - 1) * module.EVERY)

    def test_failed_reads_are_not_added_up_across_workflows(self):
        error = RuntimeError('502')
        # More failures between them than the limit, but neither alone reaches it.
        reads = [error] * (module.FAILED_READS - 1)
        self.assertEqual(self.wait(post=[*reads, [PASSED]], host=[*reads, [PASSED]]),
                         (module.FAILED_READS - 1) * module.EVERY)


if __name__ == '__main__':
    unittest.main()
