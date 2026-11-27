import importlib.util
import unittest

spec = importlib.util.spec_from_file_location('main_red', '.github/scripts/main-red.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

MERGES = [
    {'title': 'Site: a new hero (#1)', 'files': ['apps/site/src/Hero.tsx']},
    {'title': 'Sign-in keeps its reach (#2)', 'files': ['packages/runtime/src/Connections.ts', 'packages/runtime/tests/c.test.ts']},
    {'title': 'A home row menu (#3)', 'files': ['apps/desktop/src/renderer/Row.tsx']},
]


class Tests(unittest.TestCase):
    def body(self, failed, merges=MERGES, green='g' * 40):
        return module.body(failed, merges, 'https://github.com/o/r/actions/runs/9', 'h' * 40, green, repo='o/r')

    def test_names_what_failed_and_puts_the_merges_that_changed_it_first(self):
        text = self.body(['harness (packages/runtime)'])
        self.assertIn('Failed: harness (packages/runtime)', text)
        self.assertIn('compare/gggggggg...hhhhhhhh', text)
        listed = [line for line in text.splitlines() if line.startswith('- ')]
        self.assertEqual(listed[0], '- Sign-in keeps its reach (#2): packages/runtime (changed what failed)')
        self.assertNotIn('changed what failed', ''.join(listed[1:]))

    def test_a_desktop_or_windows_part_reads_as_its_package(self):
        self.assertEqual(module.areas('windows (runtime 3/6)'), ('packages/runtime/',))
        self.assertEqual(module.areas('windows (desktop)'), ('apps/desktop/', 'packages/'))
        self.assertEqual(module.areas('desktop-e2e / e2e (2/4)'), ('apps/desktop/', 'packages/'))
        self.assertEqual(module.areas('ui'), ('packages/ui/',))
        self.assertEqual(module.areas('report'), ())

    def test_a_failure_it_can_place_nowhere_lists_the_merges_as_they_came(self):
        listed = [line for line in self.body(['report']).splitlines() if line.startswith('- ')]
        self.assertEqual(listed[0], '- Site: a new hero (#1): apps/site')
        self.assertNotIn('(changed what failed)', ''.join(listed))

    def test_without_a_green_run_it_names_only_what_failed(self):
        self.assertNotIn('Merged since', self.body(['ui'], green=None))
        self.assertIn('no job said which', self.body([], green=None))


if __name__ == '__main__': unittest.main()
