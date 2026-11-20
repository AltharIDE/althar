import importlib.util
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('numbers', '.github/scripts/numbers.py')
numbers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(numbers)

FOLDERS = []


def tearDownModule():
    for folder in FOLDERS:
        shutil.rmtree(folder, ignore_errors=True)


MAIN_MIGRATIONS = ['0001_initial', '0002_threads', '0003_tags']
MAIN_ROWS = '| 001 | First | [x](x.md) |\n| 002 | Second | [y](y.md) |\n| [003](proposed/003-pools.md) | Pools | Proposed |\n'


class Tree:
    """A repository with three migrations and ADR-001 to 003, 003 still proposed: main, until a test adds to it."""

    def __init__(self):
        self.root = tempfile.mkdtemp()
        FOLDERS.append(self.root)
        self.keys = list(MAIN_MIGRATIONS)
        self.rows = MAIN_ROWS
        self.proposals = ['003-pools.md']

    def add_migration(self, key, listed=True, checksum=True):
        self.keys.append((key, listed, checksum))
        return self

    def write(self):
        folder = os.path.join(self.root, numbers.MIGRATIONS)
        os.makedirs(folder)
        os.makedirs(os.path.join(folder, '0001_initial'))
        entries = [entry if isinstance(entry, tuple) else (entry, True, True) for entry in self.keys]
        for key, _, _ in entries:
            open(os.path.join(folder, f'{key}.ts'), 'w').close()
        with open(os.path.join(folder, 'index.ts'), 'w') as index:
            index.write('export const migrations = [\n')
            index.writelines(f"  {{ key: '{key}', statements: s }},\n" for key, listed, _ in entries if listed)
            index.write(']\n')
        with open(os.path.join(folder, 'checksums.ts'), 'w') as checksums:
            checksums.write('export const checksums = {\n')
            checksums.writelines(f"  '{key}': 'abc',\n" for key, _, checksum in entries if checksum)
            checksums.write('}\n')
        proposed = os.path.join(self.root, numbers.PROPOSED)
        os.makedirs(proposed)
        for name in self.proposals:
            open(os.path.join(proposed, name), 'w').close()
        with open(os.path.join(self.root, numbers.DECISIONS), 'w') as readme:
            readme.write('| ADR | What | Where |\n|---|---|---|\n' + self.rows)
        return numbers.WorkingTree(self.root)

    def check(self):
        return numbers.check(self.write(), [f'{key}.ts' for key in MAIN_MIGRATIONS] + ['index.ts', 'checksums.ts'], ['003-pools.md'])


class Migrations(unittest.TestCase):
    def messages(self, tree):
        return [problem.message for problem in tree.check()]

    def test_main_as_it_is_passes(self):
        self.assertEqual(Tree().check(), [])

    def test_the_next_number_passes(self):
        self.assertEqual(Tree().add_migration('0004_labels').check(), [])

    def test_this_repository_passes(self):
        self.assertEqual(numbers.check(numbers.WorkingTree('.')), [])

    def test_a_number_main_has_is_refused_naming_the_one_to_renumber(self):
        problems = Tree().add_migration('0003_labels').check()
        self.assertEqual(problems, [numbers.Problem(
            f'{numbers.MIGRATIONS}/0003_labels.ts',
            'Migration 0003 is taken: main already has 0003_tags. Renumber 0003_labels to 0004: '
            'rename the file, its key in index.ts and its line in checksums.ts.',
        )])

    def test_two_pull_requests_with_one_number_are_refused_together(self):
        # In the merge queue: neither is on main yet, and each passed alone.
        messages = self.messages(Tree().add_migration('0004_labels').add_migration('0004_colours'))
        self.assertEqual(messages, [
            'Migration 0004 is claimed by 0004_colours and 0004_labels, none of them on main yet: two pull requests took the '
            'same number. Only one keeps it; the one queued later renumbers to 0005: rename the file, its key in index.ts '
            'and its line in checksums.ts.',
        ])

    def test_a_gap_is_refused(self):
        # A store that ran 0005 would never run a 0004 that landed after it.
        messages = self.messages(Tree().add_migration('0005_labels'))
        self.assertEqual(len(messages), 1)
        self.assertIn('skip 0004', messages[0])

    def test_a_migration_left_out_of_the_list_or_its_checksums_is_refused(self):
        messages = self.messages(Tree().add_migration('0004_labels', listed=False, checksum=False))
        self.assertEqual(len(messages), 2)
        self.assertIn('0004_labels.ts is not in the migrations list', messages[0])
        self.assertIn('0004_labels has no checksum', messages[1])

    def test_a_file_named_otherwise_is_refused(self):
        tree = Tree()
        root = tree.write().root
        open(os.path.join(root, numbers.MIGRATIONS, '96_labels.ts'), 'w').close()
        problems = numbers.check(numbers.WorkingTree(root))
        self.assertEqual(len(problems), 1)
        self.assertIn('96_labels.ts is not named as a migration', problems[0].message)


class Proposals(unittest.TestCase):
    def test_a_number_main_has_is_refused(self):
        tree = Tree()
        tree.proposals.append('003-canvases.md')
        tree.rows += '| [003](proposed/003-canvases.md) | Canvases | Proposed |\n'
        messages = [problem.message for problem in tree.check()]
        self.assertEqual(messages, [
            'ADR 003 is taken: main already has 003-pools.md. Renumber 003-canvases.md to 004: '
            f'rename the file and its row in {numbers.DECISIONS}.',
            'ADR-003 has 2 rows in the table. One is the ADR main has; renumber the other to ADR-004.',
        ])

    def test_a_number_a_folded_adr_kept_is_refused(self):
        # ADR-002 was folded into an area document: its file is gone, its row stays.
        tree = Tree()
        tree.proposals.append('002-canvases.md')
        messages = [problem.message for problem in tree.check()]
        self.assertEqual(len(messages), 1)
        self.assertIn("The row for ADR-002 in docs/decisions/README.md is another decision's", messages[0])
        self.assertIn('renumber 002-canvases.md to 004', messages[0])

    def test_two_new_rows_with_one_number_are_refused(self):
        tree = Tree()
        tree.rows += '| 004 | Canvases | [c](c.md) |\n| 004 | Pools again | [p](p.md) |\n'
        messages = [problem.message for problem in tree.check()]
        self.assertEqual(messages, ['ADR-004 has 2 rows in the table. One is the ADR main has; renumber the other to ADR-005.'])

    def test_a_proposal_needs_its_row(self):
        tree = Tree()
        tree.proposals.append('004-canvases.md')
        messages = [problem.message for problem in tree.check()]
        self.assertEqual(len(messages), 1)
        self.assertIn('ADR-004 has no row in the table', messages[0])


class OpenPullRequests(unittest.TestCase):
    def test_another_open_pull_request_with_the_same_number_is_a_warning(self):
        added = [f'{numbers.MIGRATIONS}/0096_tags.ts', f'{numbers.PROPOSED}/107-numbers.md']
        files = {
            '1090': [f'{numbers.MIGRATIONS}/0096_labels.ts', 'README.md'],
            '1091': [f'{numbers.PROPOSED}/107-canvases.md'],
            '1092': [f'{numbers.MIGRATIONS}/0097_other.ts'],
        }
        with patch.object(numbers, 'gh', return_value=['1089', '1090', '1091', '1092']):
            warnings = numbers.shared_with_open_pulls('owner/repo', 1089, added, files.__getitem__)
        self.assertEqual([(warning.file, warning.message.split(' (')[0]) for warning in warnings], [
            (f'{numbers.MIGRATIONS}/0096_tags.ts', '#1090 adds migration 0096 too'),
            (f'{numbers.PROPOSED}/107-numbers.md', '#1091 adds ADR 107 too'),
        ])

    def test_a_change_that_adds_no_number_asks_nothing(self):
        with patch.object(numbers, 'gh', side_effect=AssertionError('no call')):
            self.assertEqual(numbers.shared_with_open_pulls('owner/repo', 1, ['README.md'], None), [])


if __name__ == '__main__':
    unittest.main()
