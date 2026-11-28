import importlib.util
import json
import os
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('cascade', os.path.abspath('.github/scripts/cascade.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PACKAGE = '{\n  "name": "@althar/desktop",\n  "version": "%s",\n  "private": true\n}\n'


class Lines(unittest.TestCase):
    def test_each_release_branch_carries_into_the_next_newer_of_its_line(self):
        branches = ['release/0.9', 'release/0.10', 'release/0.11', 'release/host-0.2', 'release/host-0.3']
        self.assertEqual(module.next_branch('release/0.9', branches, 'main'), 'release/0.10')
        self.assertEqual(module.next_branch('release/0.10', branches, 'main'), 'release/0.11')
        self.assertEqual(module.next_branch('release/0.11', branches, 'main'), 'main')
        self.assertEqual(module.next_branch('release/host-0.2', branches, 'main'), 'release/host-0.3')
        self.assertEqual(module.next_branch('release/host-0.3', branches, 'main'), 'main')

    def test_a_newer_major_comes_after_every_minor(self):
        self.assertEqual(module.next_branch('release/0.12', ['release/0.12', 'release/1.0', 'release/0.13'], 'main'),
                         'release/0.13')

    def test_only_release_branches_have_a_version(self):
        self.assertEqual(module.version('release/0.10'), ('', (0, 10)))
        self.assertEqual(module.version('release/host-0.2'), ('host-', (0, 2)))
        for other in ('main', 'release/0.10.1', 'release/next', 'releases/0.10', 'cascade/release-0.10-into-main'):
            self.assertFalse(module.version(other), other)

    def test_its_branch_names_both_ends(self):
        self.assertEqual(module.head_branch('release/host-0.2', 'main'), 'cascade/release-host-0.2-into-main')

    def test_the_pull_request_names_its_ends(self):
        self.assertEqual(module.source_of('<!-- cascade: release/0.10 into main -->\nCarries…'), ('release/0.10', 'main'))
        self.assertFalse(module.source_of('A pull request of a person'))


class Versions(unittest.TestCase):
    def test_a_version_bump_is_left_out(self):
        self.assertEqual(module.keep_versions(PACKAGE % '0.10.0', PACKAGE % '0.10.1'), PACKAGE % '0.10.0')

    def test_everything_else_is_kept(self):
        old = PACKAGE % '0.10.0'
        new = (PACKAGE % '0.10.1').replace('"private": true', '"private": false')
        self.assertEqual(module.keep_versions(old, new), old.replace('"private": true', '"private": false'))

    def test_a_version_line_beside_another_change_is_left_out_too(self):
        old = '{\n  "version": "1.0.0",\n  "main": "a.js"\n}\n'
        new = '{\n  "version": "1.0.1",\n  "main": "b.js"\n}\n'
        self.assertEqual(module.keep_versions(old, new), '{\n  "version": "1.0.0",\n  "main": "b.js"\n}\n')

    def test_a_version_line_added_or_removed_is_carried(self):
        old = '{\n  "name": "a"\n}\n'
        new = '{\n  "name": "a",\n  "version": "1.0.0"\n}\n'
        self.assertEqual(module.keep_versions(old, new), new)

    def test_buildNumbers_and_versionCodes_stay_too(self):
        old = '{\n  "buildNumber": "3",\n  "versionCode": 3\n}\n'
        new = '{\n  "buildNumber": "4",\n  "versionCode": 4\n}\n'
        self.assertEqual(module.keep_versions(old, new), old)


class Waiting(unittest.TestCase):
    def wait(self, *reads):
        self.now = 0
        answers = list(reads)

        def read(pull, workflow):
            self.assertEqual(workflow, 'cascade')
            return answers.pop(0) if len(answers) > 1 else answers[0]

        def sleep(seconds):
            self.now += seconds

        return module.wait(7, 'head', 'cascade', read, lambda: self.now, sleep)

    def test_waits_until_every_check_passed(self):
        self.assertEqual(self.wait(('head', 'OPEN', ['pending', 'passed']), ('head', 'OPEN', ['passed', 'passed'])), 'passed')
        self.assertEqual(self.now, module.EVERY)

    def test_a_failed_check_stops_it(self):
        self.assertEqual(self.wait(('head', 'OPEN', ['pending', 'failed'])), 'failed')

    def test_no_checks_at_all_passes_after_the_grace(self):
        self.assertEqual(self.wait(('head', 'OPEN', [])), 'passed')
        self.assertEqual(self.now, module.GRACE)

    def test_a_new_head_or_a_closed_pull_request_ends_the_wait(self):
        self.assertEqual(self.wait(('other', 'OPEN', ['pending'])), 'moved')
        self.assertEqual(self.wait(('head', 'MERGED', ['passed'])), 'closed')

    def test_gives_up_after_the_limit(self):
        with self.assertRaisesRegex(module.Failed, 'Gave up on #7'):
            self.wait(('head', 'OPEN', ['pending']))
        self.assertEqual(self.now, module.LIMIT)


class Repository(unittest.TestCase):
    """A bare origin and a clone of it, the clone as the cascade's checkout."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.previous = os.getcwd()
        self.addCleanup(os.chdir, self.previous)
        origin, self.clone = os.path.join(self.folder.name, 'origin.git'), os.path.join(self.folder.name, 'clone')
        self.run_git('init', '-q', '--bare', '-b', 'main', origin, cwd=self.folder.name)
        self.run_git('clone', '-q', origin, self.clone, cwd=self.folder.name)
        os.chdir(self.clone)
        self.run_git('config', 'user.name', 'A person')
        self.run_git('config', 'user.email', 'person@example.com')
        os.makedirs('apps/desktop')
        self.write('apps/desktop/package.json', PACKAGE % '0.10.0')
        self.write('app.ts', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n')
        self.commit('Althar 0.10.0')
        self.run_git('push', '-q', 'origin', 'HEAD:main', 'HEAD:release/0.10')
        self.calls = []
        module.gh = self.gh

    def run_git(self, *args, cwd=None):
        return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

    def write(self, path, text):
        with open(path, 'w') as file:
            file.write(text)

    def read(self, ref, path):
        return self.run_git('show', f'{ref}:{path}')

    def commit(self, subject):
        self.run_git('add', '-A')
        self.run_git('commit', '-q', '-m', subject)
        return self.run_git('rev-parse', 'HEAD')

    def on(self, branch, changes, subject):
        """A commit on origin's `branch`, of `changes` (path: text)."""
        self.run_git('fetch', '-q', 'origin')
        self.run_git('switch', '-q', '--detach', f'origin/{branch}')
        for path, text in changes.items():
            self.write(path, text)
        sha = self.commit(subject)
        self.run_git('push', '-q', 'origin', f'HEAD:{branch}')
        self.run_git('fetch', '-q', 'origin')
        return sha

    def squash(self, pull, onto='main'):
        """The cascade's pull request, squashed onto `onto` as the merge queue does: the commits' messages kept."""
        self.run_git('fetch', '-q', 'origin')
        branch = f'origin/{self.created[pull]}'
        tree = self.run_git('rev-parse', f'{branch}^{{tree}}')
        text = self.run_git('log', '-1', '--format=%B', branch)
        subject, _, rest = text.partition('\n')
        squashed = subprocess.run(['git', 'commit-tree', tree, '-p', f'origin/{onto}', '-m', f'{subject} (#{pull})',
                                   '-m', rest.strip()], check=True, capture_output=True, text=True).stdout.strip()
        self.run_git('push', '-q', 'origin', f'{squashed}:refs/heads/{onto}')
        self.run_git('fetch', '-q', 'origin')
        self.pulls[pull]['open'] = False

    pulls = None
    created = None

    def gh(self, *args, check=True):
        self.calls.append(args)
        self.pulls = self.pulls if self.pulls is not None else {}
        self.created = self.created if self.created is not None else {}
        if args[:2] == ('pr', 'list'):
            head = args[args.index('--head') + 1]
            found = [{'number': number, 'isDraft': pull['draft'], 'url': '', 'headRefOid':
                      self.run_git('rev-parse', f'origin/{head}')}
                     for number, pull in self.pulls.items() if pull['head'] == head and pull['open']]
            return json.dumps(found)
        if args[:2] == ('pr', 'create'):
            number = 100 + len(self.pulls)
            self.pulls[number] = {'head': args[args.index('--head') + 1], 'draft': '--draft' in args, 'open': True,
                                  'body': args[args.index('--body') + 1]}
            self.created[number] = self.pulls[number]['head']
            self.run_git('fetch', '-q', 'origin')
            return f'https://github.com/owner/repo/pull/{number}'
        if args[:2] == ('pr', 'ready'):
            self.pulls[int(args[2])]['draft'] = '--undo' in args
            return ''
        if args[:2] == ('pr', 'view'):
            number = int(args[2])
            head = self.run_git('rev-parse', f'origin/{self.pulls[number]["head"]}')
            passed = {'__typename': 'CheckRun', 'status': 'COMPLETED', 'conclusion': 'SUCCESS', 'workflowName': 'check'}
            ours = {'__typename': 'CheckRun', 'status': 'IN_PROGRESS', 'conclusion': '', 'workflowName': 'cascade'}
            return json.dumps({'headRefOid': head, 'state': 'OPEN', 'statusCheckRollup': [passed, ours]})
        if args[:2] == ('pr', 'close'):
            self.pulls[int(args[2])]['open'] = False
            return ''
        if args[:2] == ('api', 'repos/owner/repo/rules/branches/main'):
            return json.dumps([{'type': 'merge_queue'}, {'type': 'required_status_checks'}])
        if args[0] == 'api' and '/rules/branches/' in args[1]:
            return '[]'
        if args[:2] == ('api', 'repos/owner/repo'):
            return json.dumps({'allow_auto_merge': True})
        if args[0] == 'api' and '/branches/' in args[1]:
            return json.dumps({'protected': False})
        return ''

    def cascade(self, source):
        self.run_git('fetch', '-q', 'origin')
        module.cascade('owner/repo', source, 'main', 'cascade')

    def merged_with_auto_merge(self):
        return [call for call in self.calls if call[:2] == ('pr', 'merge')]


class Cascading(Repository):
    def test_a_fix_carries_into_main_by_a_pull_request_that_joins_the_queue(self):
        fix = self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n'}, 'Fix two')
        self.cascade('release/0.10')
        (pull,) = self.pulls
        self.assertEqual(self.pulls[pull]['head'], 'cascade/release-0.10-into-main')
        self.assertFalse(self.pulls[pull]['draft'])
        self.assertIn('<!-- cascade: release/0.10 into main -->', self.pulls[pull]['body'])
        branch = 'origin/cascade/release-0.10-into-main'
        self.assertEqual(self.read(branch, 'app.ts'), 'one\nTWO\nthree\nfour\nfive\nsix\nseven')
        self.assertIn(f'Cascade-from: release/0.10 {fix}', self.run_git('log', '-1', '--format=%B', branch))
        self.assertIn(f'- Fix two ({fix[:7]})', self.run_git('log', '-1', '--format=%B', branch))
        self.assertEqual(self.run_git('rev-parse', f'{branch}^'), self.run_git('rev-parse', 'origin/main'))
        self.assertEqual(self.run_git('log', '-1', '--format=%ae', branch), module.BOT[1])
        # Main's merge queue picks the method: none is given.
        (merge,) = self.merged_with_auto_merge()
        self.assertIn('--auto', merge)
        self.assertNotIn('--squash', merge)

    def test_the_patch_bump_stays_on_the_release_branch(self):
        self.on('release/0.10', {'apps/desktop/package.json': PACKAGE % '0.10.1', 'notes.md': '0.10.1\n'}, 'Althar 0.10.1')
        self.cascade('release/0.10')
        branch = 'origin/cascade/release-0.10-into-main'
        self.assertEqual(self.read(branch, 'apps/desktop/package.json'), (PACKAGE % '0.10.0').strip())
        self.assertEqual(self.read(branch, 'notes.md'), '0.10.1')

    def test_a_bump_that_is_all_it_carries_makes_no_pull_request(self):
        self.on('main', {'apps/desktop/package.json': PACKAGE % '0.11.0'}, 'Althar 0.11.0')
        self.on('release/0.10', {'apps/desktop/package.json': PACKAGE % '0.10.1'}, 'Althar 0.10.1')
        self.cascade('release/0.10')
        self.assertEqual(self.pulls or {}, {})

    def test_after_its_squash_only_what_landed_since_is_carried(self):
        self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n'}, 'Fix two')
        self.cascade('release/0.10')
        (pull,) = self.pulls
        self.squash(pull)
        # Main goes on to change the same line again: carried again from where the release branch was cut, the first fix
        # would conflict with it.
        self.on('main', {'app.ts': 'one\nTwo, better\nthree\nfour\nfive\nsix\nseven\n'}, 'Two, better')
        fix = self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nSEVEN\n'}, 'Fix seven')
        self.cascade('release/0.10')
        second = max(self.pulls)
        self.assertNotEqual(second, pull)
        self.assertFalse(self.pulls[second]['draft'])
        branch = 'origin/cascade/release-0.10-into-main'
        self.assertEqual(self.read(branch, 'app.ts'), 'one\nTwo, better\nthree\nfour\nfive\nsix\nSEVEN')
        message = self.run_git('log', '-1', '--format=%B', branch)
        self.assertIn('Fix seven', message)
        self.assertNotIn('Fix two', message)
        self.assertIn(f'Cascade-from: release/0.10 {fix}', message)

    def test_nothing_new_makes_no_pull_request(self):
        self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n'}, 'Fix two')
        self.cascade('release/0.10')
        self.squash(min(self.pulls))
        self.cascade('release/0.10')
        self.assertEqual(len(self.pulls), 1)

    def test_a_fix_main_has_already_closes_the_open_pull_request(self):
        self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n'}, 'Fix two')
        self.cascade('release/0.10')
        (pull,) = self.pulls
        self.on('main', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n'}, 'Fix two on main too')
        self.cascade('release/0.10')
        self.assertFalse(self.pulls[pull]['open'])

    def test_a_conflict_stays_open_as_a_draft_that_names_its_files(self):
        self.on('main', {'app.ts': 'one\nTwo on main\nthree\nfour\nfive\nsix\nseven\n'}, 'Two on main')
        self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n', 'other.ts': 'new\n'}, 'Fix two')
        self.cascade('release/0.10')
        (pull,) = self.pulls
        self.assertTrue(self.pulls[pull]['draft'])
        self.assertIn('- `app.ts`', self.pulls[pull]['body'])
        self.assertNotIn('other.ts`', self.pulls[pull]['body'])
        branch = 'origin/cascade/release-0.10-into-main'
        self.assertIn('<<<<<<<', self.read(branch, 'app.ts'))
        self.assertEqual(self.read(branch, 'other.ts'), 'new')
        self.assertIn('Cascade-conflicts: app.ts', self.run_git('log', '-1', '--format=%B', branch))
        self.assertEqual(self.merged_with_auto_merge(), [])

    def test_a_persons_fix_to_a_conflict_is_never_pushed_over(self):
        self.on('main', {'app.ts': 'one\nTwo on main\nthree\nfour\nfive\nsix\nseven\n'}, 'Two on main')
        self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n'}, 'Fix two')
        self.cascade('release/0.10')
        fixed = self.on('cascade/release-0.10-into-main', {'app.ts': 'one\nTWO on main\nthree\nfour\nfive\nsix\nseven\n'},
                        'Settle two')
        self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nSEVEN\n'}, 'Fix seven')
        self.cascade('release/0.10')
        self.assertEqual(self.run_git('rev-parse', 'origin/cascade/release-0.10-into-main'), fixed)
        self.assertTrue(any(call[:2] == ('pr', 'comment') for call in self.calls))

    def test_a_fix_on_an_older_line_goes_to_the_next_release_branch_first(self):
        self.run_git('push', '-q', 'origin', 'origin/release/0.10:refs/heads/release/0.9')
        self.on('release/0.9', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n'}, 'Fix two')
        self.cascade('release/0.9')
        (pull,) = self.pulls
        self.assertEqual(self.pulls[pull]['head'], 'cascade/release-0.9-into-release-0.10')
        # release/0.10 requires no checks here: the cascade waits for them itself, then merges.
        self.assertEqual(self.merged_with_auto_merge()[-1][:3], ('pr', 'merge', str(pull)))
        self.assertIn('--squash', self.merged_with_auto_merge()[-1])
        self.assertNotIn('--auto', self.merged_with_auto_merge()[-1])

    def test_a_branch_that_is_not_a_release_branch_is_refused(self):
        self.run_git('push', '-q', 'origin', 'origin/main:refs/heads/release/next')
        with self.assertRaisesRegex(module.Failed, 'not a release branch'):
            self.cascade('release/next')


if __name__ == '__main__':
    unittest.main()
