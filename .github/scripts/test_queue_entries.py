import importlib.util
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('entries', '.github/scripts/queue-entries.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def commit(sha, parents, subject):
    return {'sha': sha, 'parents': [{'sha': one} for one in parents], 'commit': {'message': f'{subject}\n\nWhy it changed'}}


class Tests(unittest.TestCase):
    def read(self, commits, heads=None, bases=None):
        heads = heads or {}
        bases = bases or {}
        def read(repo, path):
            if path == 'compare/main...group': return {'commits': commits}
            if path.startswith('pulls/'): return {'head': {'sha': heads[path.split('/')[1]]}}
            if path.startswith('compare/main...'): return {'merge_base_commit': {'sha': bases[path.split('...')[1]]}}
            raise AssertionError(path)
        return read

    def test_each_entry_against_where_its_pull_request_branched(self):
        commits = [commit('a', ['main'], 'Ahead (#1)'), commit('group', ['a'], 'Last (#2)')]
        fetch = Mock()
        diff = lambda start, end: [f'{start}..{end}']
        found = module.entries('owner/repo', 'main', 'group', self.read(commits, {'1': 'h1', '2': 'h2'}, {'h1': 'main', 'h2': 'old'}),
                               fetch, diff)
        self.assertEqual(found, [
            {'pr': 1, 'changes': ['main..a'], 'since': ['main..main']},
            # What landed beneath the last: main since it branched, and the entry ahead of it.
            {'pr': 2, 'changes': ['a..group'], 'since': ['old..a']},
        ])
        fetch.assert_any_call('group', 'a', 'old')

    def test_a_merge_commits_second_parent_is_its_pull_requests_head(self):
        commits = [commit('group', ['main', 'h3'], 'Merge (#3)')]
        found = module.entries('owner/repo', 'main', 'group', self.read(commits, bases={'h3': 'old'}), Mock(), lambda start, end: [start])
        self.assertEqual(found, [{'pr': 3, 'changes': ['main'], 'since': ['old']}])

    def test_an_entry_without_a_number_is_not_guessed_at(self):
        commits = [commit('group', ['main'], 'No number')]
        with self.assertRaisesRegex(RuntimeError, 'No pull request number'):
            module.entries('owner/repo', 'main', 'group', self.read(commits), Mock(), Mock())

    def test_an_empty_group_is_not_nothing_to_test(self):
        with self.assertRaisesRegex(RuntimeError, 'No commits'):
            module.entries('owner/repo', 'main', 'group', self.read([]), Mock(), Mock())

    def test_reads_what_changed_from_git(self):
        head = module.git('rev-parse', 'HEAD').strip()
        self.assertEqual(module.changed(head, head), [])


if __name__ == '__main__': unittest.main()
