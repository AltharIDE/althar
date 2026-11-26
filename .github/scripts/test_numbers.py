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
# 0001 in parts, as the store's is, with a helper later migrations import too.
COLUMNS = "export const at = (name: string) => `${name} TEXT NOT NULL`\n"
INITIAL = "import { at } from './0001_initial/columns'\n\nexport const statements = [`CREATE TABLE devices (${at('created_at')}) STRICT`]\n"
LOADER = "export const migrations = import.meta.glob('./[0-9][0-9][0-9][0-9]_*.ts', { eager: true })\n"


def migration(key):
    return f"export const statements = ['CREATE TABLE {key[5:]} (id TEXT) STRICT']\n"


class Tree:
    """A repository with three migrations and ADR-001 to 003, 003 still proposed: main, until a test adds to it."""

    def __init__(self):
        self.root = tempfile.mkdtemp()
        FOLDERS.append(self.root)
        self.files = {'index.ts': LOADER, '0001_initial.ts': INITIAL, '0001_initial/columns.ts': COLUMNS}
        self.files.update({f'{key}.ts': migration(key) for key in MAIN_MIGRATIONS[1:]})
        self.main = {path: numbers.blob_id(text.encode()) for path, text in self.files.items()}
        self.rows = MAIN_ROWS
        self.proposals = ['003-pools.md']

    @property
    def keys(self):
        return [path[:-3] for path in self.files if numbers.MIGRATION.match(path)]

    @keys.setter
    def keys(self, keys):
        # Main's migrations under other numbers, or none: the loader and 0001's parts stay.
        self.files = {path: text for path, text in self.files.items() if not numbers.MIGRATION.match(path)}
        self.files.update({f'{key}.ts': INITIAL if key.endswith('_initial') else migration(key) for key in keys})

    def add_migration(self, key, text=None):
        self.files[f'{key}.ts'] = migration(key) if text is None else text
        return self

    def write(self):
        folder = os.path.join(self.root, numbers.MIGRATIONS)
        for path, text in self.files.items():
            os.makedirs(os.path.dirname(os.path.join(folder, path)), exist_ok=True)
            with open(os.path.join(folder, path), 'w') as file:
                file.write(text)
        proposed = os.path.join(self.root, numbers.PROPOSED)
        os.makedirs(proposed)
        for name in self.proposals:
            open(os.path.join(proposed, name), 'w').close()
        with open(os.path.join(self.root, numbers.DECISIONS), 'w') as readme:
            readme.write('| ADR | What | Where |\n|---|---|---|\n' + self.rows)
        return numbers.WorkingTree(self.root)

    def check(self):
        return numbers.check(self.write(), self.main, ['003-pools.md'])


class Migrations(unittest.TestCase):
    def messages(self, tree):
        return [problem.message for problem in tree.check()]

    def test_main_as_it_is_passes(self):
        self.assertEqual(Tree().check(), [])

    def test_the_next_number_passes(self):
        self.assertEqual(Tree().add_migration('0004_labels').check(), [])

    def test_a_number_main_has_is_refused_naming_the_one_to_renumber(self):
        problems = Tree().add_migration('0003_labels').check()
        self.assertEqual(problems, [numbers.Problem(
            f'{numbers.MIGRATIONS}/0003_labels.ts',
            'Migration 0003 is taken: main already has 0003_tags. Renumber 0003_labels to 0004: '
            'rename the file, and its folder if it has one.',
        )])

    def test_two_pull_requests_with_one_number_are_refused_together(self):
        # In the merge queue: neither is on main yet, and each passed alone.
        messages = self.messages(Tree().add_migration('0004_labels').add_migration('0004_colours'))
        self.assertEqual(messages, [
            'Migration 0004 is claimed by 0004_colours and 0004_labels, none of them on main yet: two pull requests took the '
            'same number. Only one keeps it; the one queued later renumbers to 0005: rename the file, and its folder if it '
            'has one.',
        ])

    def test_a_migration_main_has_cannot_move_to_another_number(self):
        # Main's 0002 and 0003 swapped: a store at 0003 would run neither, one at 0002 would skip tags and run threads again.
        tree = Tree()
        tree.keys = ['0001_initial', '0002_tags', '0003_threads']
        problems = tree.check()
        self.assertEqual(len(problems), 2)
        self.assertEqual(problems[0].file, f'{numbers.MIGRATIONS}/0003_threads.ts')
        self.assertIn("0002_threads is main's migration 0002, renumbered here to 0003.", problems[0].message)
        self.assertIn("0003_tags is main's migration 0003, renumbered here to 0002.", problems[1].message)

    def test_a_migration_main_has_cannot_go(self):
        # Dropping the last one would free its number for a migration stores at it never run.
        tree = Tree()
        tree.keys = ['0001_initial', '0002_threads']
        messages = [problem.message for problem in tree.check()]
        self.assertEqual(len(messages), 1)
        self.assertIn("0003_tags is main's migration 0003, gone here.", messages[0])

    def test_every_migration_main_has_cannot_go(self):
        tree = Tree()
        tree.keys = []
        messages = [problem.message for problem in tree.check()]
        self.assertEqual([message.split(',')[0] for message in messages], [
            "0001_initial is main's migration 0001", "0002_threads is main's migration 0002", "0003_tags is main's migration 0003",
        ])
        self.assertTrue(all('gone here.' in message for message in messages))

    def test_a_number_below_0001_is_refused(self):
        tree = Tree()
        tree.keys = ['0000_labels', *MAIN_MIGRATIONS]
        messages = [problem.message for problem in tree.check()]
        self.assertEqual(messages, [
            '0000_labels is numbered below 0001: a store that has run 0001 or later would never run it. Number it 0004.',
        ])

    def test_a_gap_is_refused(self):
        # A store that ran 0005 would never run a 0004 that landed after it.
        messages = self.messages(Tree().add_migration('0005_labels'))
        self.assertEqual(len(messages), 1)
        self.assertIn('skip 0004', messages[0])

    def test_a_migration_main_has_cannot_change(self):
        # A store that ran 0002 never runs it again: only a new store would have the column.
        tree = Tree()
        tree.files['0002_threads.ts'] = migration('0002_threads').replace('(id TEXT)', '(id TEXT, title TEXT)')
        self.assertEqual(tree.check(), [numbers.Problem(
            f'{numbers.MIGRATIONS}/0002_threads.ts',
            "0002_threads.ts is main's, changed here. A store runs a migration once, so one that ran main's keeps what it made, "
            'and only a new store would have this. Put it back as main has it, and make the change in a new migration, 0004.',
        )])

    def test_what_a_migration_main_has_imports_cannot_change_or_go(self):
        tree = Tree()
        tree.files['0001_initial/columns.ts'] = COLUMNS.replace('NOT NULL', 'NOT NULL DEFAULT ""')
        # A file main hasn't is a new migration's to use.
        tree.files['0001_initial/more.ts'] = COLUMNS
        messages = self.messages(tree)
        self.assertEqual(len(messages), 1)
        self.assertIn("0001_initial/columns.ts is main's, changed here.", messages[0])

        tree = Tree()
        del tree.files['0001_initial/columns.ts']
        messages = self.messages(tree)
        self.assertEqual(len(messages), 1)
        self.assertIn("0001_initial/columns.ts is part of main's migrations, gone here.", messages[0])

    def test_the_loader_may_change(self):
        tree = Tree()
        tree.files['index.ts'] = LOADER + '// Sorted by number.\n'
        self.assertEqual(tree.check(), [])

    def test_what_sat_beside_main_s_migrations_may_go(self):
        # Main still lists its migrations and their checksums; this change finds them by name instead.
        tree = Tree()
        tree.main['checksums.ts'] = numbers.blob_id(b"export const checksums = { '0001_initial': 'abc' }\n")
        self.assertEqual(tree.check(), [])

    def test_a_migration_imports_only_from_the_migrations(self):
        # What it imports could change under it, unseen: types alone, and the SQL's own `from`, are no import.
        text = (
            "import { at } from './0001_initial/columns'\n"
            "import type { Word } from '@althar/domain'\n"
            "import { WORDS } from '@althar/domain'\n"
            "export { more } from '../maintenance'\n"
            "export const statements = [`ALTER TABLE devices ADD COLUMN ${at('seen_at')}`, 'SELECT 1 from x']\n"
        )
        messages = self.messages(Tree().add_migration('0004_labels', text))
        self.assertEqual([message.split(',')[0] for message in messages], [
            '0004_labels.ts imports @althar/domain', '0004_labels.ts imports ../maintenance',
        ])

    def test_a_file_named_otherwise_is_refused(self):
        tree = Tree()
        root = tree.write().root
        open(os.path.join(root, numbers.MIGRATIONS, '96_labels.ts'), 'w').close()
        problems = numbers.check(numbers.WorkingTree(root))
        self.assertEqual(len(problems), 1)
        self.assertIn('96_labels.ts is not named as a migration', problems[0].message)

    def test_checksums_come_back_is_refused(self):
        # The hand-kept list of checksums is gone: this check compares the migrations with main's instead.
        tree = Tree()
        tree.files['checksums.ts'] = "export const checksums = { '0001_initial': 'abc' }\n"
        messages = self.messages(tree)
        self.assertEqual(len(messages), 1)
        self.assertIn('checksums.ts is not named as a migration', messages[0])


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
