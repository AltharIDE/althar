import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('cascade', os.path.abspath('.github/scripts/cascade.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PACKAGE = '{\n  "name": "@althar/desktop",\n  "version": "%s",\n  "private": true\n}\n'
APP = '{\n  "expo": {\n    "name": "Althar",\n    "version": "%s",\n    "ios": {\n      "bundleIdentifier": "app.althar"%s\n    },\n    "plugins": ["a", "b"]\n  }\n}\n'
TWO = 'one\nTWO\nthree\nfour\nfive\nsix\nseven\n'
SEVEN = 'one\nTWO\nthree\nfour\nfive\nsix\nSEVEN\n'


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

    def test_buildNumbers_and_versionCodes_stay_too(self):
        old = '{\n  "buildNumber": "3",\n  "versionCode": 3\n}\n'
        new = '{\n  "buildNumber": "4",\n  "versionCode": 4\n}\n'
        self.assertEqual(module.keep_versions(old, new), old)

    def test_a_build_number_the_target_never_had_is_left_out(self):
        old, new = APP % ('0.1.0', ''), APP % ('0.1.1', ',\n      "buildNumber": "4"')
        self.assertEqual(module.versions_kept('app.json', old, new), old)

    def test_a_build_number_the_source_dropped_stays(self):
        old, new = APP % ('0.1.0', ',\n      "buildNumber": "4"'), APP % ('0.1.0', '')
        self.assertEqual(module.versions_kept('app.json', old, new), old)

    def test_a_build_number_added_beside_another_change_keeps_that_change(self):
        old = APP % ('0.1.0', '')
        new = (APP % ('0.1.1', ',\n      "buildNumber": "4"')).replace('"plugins": ["a", "b"]', '"plugins": ["a"]')
        self.assertEqual(module.versions_kept('app.json', old, new), old.replace('["a", "b"]', '["a"]'))

    def test_a_json_file_written_as_python_writes_it_is_written_again_whole(self):
        old = json.dumps({'name': 'a', 'version': '1.0.0', 'scripts': {'a': 'b'}}, indent=2) + '\n'
        new = json.dumps({'name': 'a', 'scripts': {'a': 'c'}, 'version': '1.0.1'}, indent=2) + '\n'
        self.assertEqual(json.loads(module.versions_kept('package.json', old, new)),
                         {'name': 'a', 'scripts': {'a': 'c'}, 'version': '1.0.0'})

    def test_one_it_cant_leave_out_is_left_to_a_person(self):
        old = '{"expo": {"version": "0.1.0", "plugins": ["a"]}}\n'
        new = '{"expo": {"version": "0.1.1", "plugins": ["a", "b"]}}\n'
        self.assertIsNone(module.versions_kept('app.json', old, new))


class Waiting(unittest.TestCase):
    def wait(self, *reads, required=('check',)):
        self.now = 0
        answers = list(reads)

        def read(pull, workflow):
            self.assertEqual(workflow, 'cascade')
            return answers.pop(0) if len(answers) > 1 else answers[0]

        def sleep(seconds):
            self.now += seconds

        return module.wait(7, 'head', list(required), 'cascade', read, lambda: self.now, sleep)

    def test_waits_until_the_required_check_passed(self):
        self.assertEqual(self.wait(('head', 'OPEN', [('check', 'pending')]), ('head', 'OPEN', [('check', 'passed')])),
                         'passed')
        self.assertEqual(self.now, module.EVERY)

    def test_waits_for_a_required_check_that_has_not_shown_yet(self):
        self.assertEqual(self.wait(('head', 'OPEN', []), ('head', 'OPEN', [('other', 'passed')]),
                                   ('head', 'OPEN', [('other', 'passed'), ('check', 'passed')])), 'passed')
        self.assertEqual(self.now, 2 * module.EVERY)

    def test_never_shown_it_gives_up_naming_it(self):
        with self.assertRaisesRegex(module.Failed, 'check never passed'):
            self.wait(('head', 'OPEN', [('other', 'passed')]))
        self.assertEqual(self.now, module.LIMIT)

    def test_another_check_still_running_is_waited_for(self):
        self.assertEqual(self.wait(('head', 'OPEN', [('check', 'passed'), ('other', 'pending')]),
                                   ('head', 'OPEN', [('check', 'passed'), ('other', 'passed')])), 'passed')

    def test_a_failed_check_stops_it(self):
        self.assertEqual(self.wait(('head', 'OPEN', [('check', 'pending'), ('other', 'failed')])), 'failed')

    def test_with_none_required_it_waits_only_for_what_runs(self):
        self.assertEqual(self.wait(('head', 'OPEN', []), required=()), 'passed')
        self.assertEqual(self.now, 0)

    def test_a_new_head_or_a_closed_pull_request_ends_the_wait(self):
        self.assertEqual(self.wait(('other', 'OPEN', [('check', 'pending')])), 'moved')
        self.assertEqual(self.wait(('head', 'MERGED', [('check', 'passed')])), 'closed')


class Expected(unittest.TestCase):
    def test_paths_the_checks_skip_need_none(self):
        with mock.patch.object(module, 'UNCHECKED', ['**/*.md', 'docs/**']), \
                mock.patch.object(module, 'CHECKS', ['check']):
            for paths, wanted in ((['README.md', 'docs/a/b.png'], []), (['README.md', 'src/a.ts'], ['check'])):
                with mock.patch.object(module, 'out', return_value='\n'.join(paths)):
                    self.assertEqual(module.expected_checks('main', 'head'), wanted)

    def test_no_check_named_is_refused(self):
        with mock.patch.object(module, 'CHECKS', []), mock.patch.object(module, 'out', return_value='src/a.ts'):
            with self.assertRaisesRegex(module.Failed, 'CASCADE_CHECKS'):
                module.expected_checks('main', 'head')


class Repository(unittest.TestCase):
    """A bare origin and a clone of it, the clone as the cascade's checkout, and GitHub as a fake that keeps pull
    requests and merges them as squashes, with the commits' messages, onto origin."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.addCleanup(os.chdir, os.getcwd())
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
        self.calls, self.pulls, self.disarmed = [], {}, []
        # Release branches have no rules here; main has a merge queue.
        self.rules = {'main': [{'type': 'merge_queue'}, {'type': 'required_status_checks'}]}
        self.rollup = [{'__typename': 'CheckRun', 'name': 'check', 'status': 'COMPLETED', 'conclusion': 'SUCCESS',
                        'workflowName': 'check'}]
        for patch in (mock.patch.object(module, 'gh', self.gh), mock.patch.object(module, 'CHECKS', ['check']),
                      mock.patch.object(module.time, 'sleep', lambda seconds: None)):
            patch.start()
            self.addCleanup(patch.stop)

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

    def on(self, branch, changes, subject, fetch=True):
        """A person's commit on origin's `branch`, of `changes` (path: text)."""
        self.run_git('fetch', '-q', 'origin')
        self.run_git('switch', '-q', '--detach', f'origin/{branch}')
        for path, text in changes.items():
            self.write(path, text)
        sha = self.commit(subject)
        self.run_git('push', '-q', 'origin', f'HEAD:{branch}')
        if fetch:
            self.run_git('fetch', '-q', 'origin')
        return sha

    def tip(self, branch):
        return self.run_git('ls-remote', 'origin', f'refs/heads/{branch}').split('\t')[0] or None

    def squash(self, number):
        """The pull request, squashed onto its base as GitHub does, its commits' messages kept."""
        pull = self.pulls[number]
        head = self.tip(pull['head'])
        self.run_git('fetch', '-q', 'origin')
        tree = self.run_git('rev-parse', f'{head}^{{tree}}')
        text = self.run_git('log', '--format=%B', f'origin/{pull["base"]}..{head}')
        subject, _, rest = text.partition('\n')
        squashed = subprocess.run(['git', 'commit-tree', tree, '-p', f'origin/{pull["base"]}', '-m', f'{subject} (#{number})',
                                   '-m', rest.strip() or '.'], check=True, capture_output=True, text=True).stdout.strip()
        self.run_git('push', '-q', 'origin', f'{squashed}:refs/heads/{pull["base"]}')
        pull.update(state='MERGED', merged_head=head)
        self.run_git('fetch', '-q', 'origin')

    def gh(self, *args, check=True):
        self.calls.append(args)

        def option(name):
            return args[args.index(name) + 1] if name in args else None

        if args[:2] == ('pr', 'list'):
            state = option('--state').upper()
            found = [{'number': number, 'isDraft': pull['draft'], 'headRefName': pull['head'], 'baseRefName': pull['base'],
                      'headRefOid': pull.get('merged_head') or self.tip(pull['head']), 'body': pull['body']}
                     for number, pull in self.pulls.items()
                     if pull['state'] == state and option('--head') in (None, pull['head'])]
            return json.dumps(found)
        if args[:2] == ('pr', 'create'):
            number = 100 + len(self.pulls)
            self.pulls[number] = {'head': option('--head'), 'base': option('--base'), 'draft': '--draft' in args,
                                  'state': 'OPEN', 'body': option('--body')}
            return f'https://github.com/owner/repo/pull/{number}'
        if args[:2] == ('pr', 'view'):
            pull = self.pulls[int(args[2])]
            return json.dumps({'headRefOid': pull.get('merged_head') or self.tip(pull['head']), 'state': pull['state'],
                               'isDraft': pull['draft'], 'body': pull['body'], 'baseRefName': pull['base'],
                               'statusCheckRollup': self.rollup + [
                                   {'__typename': 'CheckRun', 'name': 'cascade', 'status': 'IN_PROGRESS',
                                    'conclusion': '', 'workflowName': 'cascade'}]})
        if args[:2] == ('pr', 'ready'):
            self.pulls[int(args[2])]['draft'] = '--undo' in args
            return ''
        if args[:2] == ('pr', 'edit'):
            self.pulls[int(args[2])]['body'] = option('--body')
            return ''
        if args[:2] == ('pr', 'close'):
            self.pulls[int(args[2])]['state'] = 'CLOSED'
            return ''
        if args[:2] == ('pr', 'merge') and '--disable-auto' in args:
            # Whether the branch being cut was there yet when it was disarmed.
            self.disarmed.append((int(args[2]), self.tip('release/0.11')))
            return ''
        if args[:2] == ('pr', 'merge') and '--auto' not in args:
            self.squash(int(args[2]))
            return ''
        if args[0] == 'api' and args[1:3] == ('-X', 'DELETE'):
            branch = args[3].split('/git/refs/heads/', 1)[1]
            self.run_git('push', '-q', 'origin', f':refs/heads/{branch}')
            return ''
        if args[0] == 'api' and '/rules/branches/' in args[1]:
            return json.dumps(self.rules.get(args[1].split('/rules/branches/', 1)[1], []))
        if args[:2] == ('api', 'repos/owner/repo'):
            return json.dumps({'allow_auto_merge': True})
        if args[0] == 'api' and '/branches/' in args[1]:
            return json.dumps({'protected': False})
        return ''

    def cascade(self, source):
        self.run_git('fetch', '-q', '--prune', 'origin')
        module.cascade('owner/repo', source, 'main', 'cascade')

    def after(self, number):
        self.run_git('fetch', '-q', '--prune', 'origin')
        module.after('owner/repo', number, 'main', 'cascade')

    def merges(self, number=None):
        return [call for call in self.calls if call[:2] == ('pr', 'merge') and '--disable-auto' not in call
                and number in (None, int(call[2]))]

    def ready(self, number):
        """A person marks it ready for review."""
        self.pulls[number]['draft'] = False
        self.after(number)

    def message(self, ref):
        return self.run_git('log', '-1', '--format=%B', ref)


class Cascading(Repository):
    def test_a_fix_carries_into_main_by_a_pull_request_that_joins_the_queue(self):
        fix = self.on('release/0.10', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/0.10')
        (pull,) = self.pulls
        self.assertEqual(self.pulls[pull]['head'], 'cascade/release-0.10-into-main')
        self.assertFalse(self.pulls[pull]['draft'])
        self.assertIn('<!-- cascade: release/0.10 into main -->', self.pulls[pull]['body'])
        branch = 'origin/cascade/release-0.10-into-main'
        self.assertEqual(self.read(branch, 'app.ts'), TWO.strip())
        self.assertIn(f'Cascade-from: release/0.10 {fix}', self.message(branch))
        self.assertIn(f'- Fix two ({fix[:7]})', self.message(branch))
        self.assertEqual(self.run_git('rev-parse', f'{branch}^'), self.run_git('rev-parse', 'origin/main'))
        self.assertEqual(self.run_git('log', '-1', '--format=%ae', branch), module.BOT[1])
        # Main's merge queue picks the method: none is given.
        (merge,) = self.merges()
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
        self.assertEqual(self.pulls, {})

    def test_after_its_squash_only_what_landed_since_is_carried(self):
        self.on('release/0.10', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/0.10')
        (pull,) = self.pulls
        self.squash(pull)
        # Main goes on to change the same line again: carried again from where the release branch was cut, the first fix
        # would conflict with it.
        self.on('main', {'app.ts': 'one\nTwo, better\nthree\nfour\nfive\nsix\nseven\n'}, 'Two, better')
        fix = self.on('release/0.10', {'app.ts': SEVEN}, 'Fix seven')
        self.cascade('release/0.10')
        second = max(self.pulls)
        self.assertNotEqual(second, pull)
        self.assertFalse(self.pulls[second]['draft'])
        branch = 'origin/cascade/release-0.10-into-main'
        self.assertEqual(self.read(branch, 'app.ts'), 'one\nTwo, better\nthree\nfour\nfive\nsix\nSEVEN')
        self.assertNotIn('Fix two', self.message(branch))
        self.assertIn(f'Cascade-from: release/0.10 {fix}', self.message(branch))

    def test_nothing_new_makes_no_pull_request(self):
        self.on('release/0.10', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/0.10')
        self.squash(min(self.pulls))
        self.cascade('release/0.10')
        self.assertEqual(len(self.pulls), 1)

    def test_a_fix_main_has_already_closes_the_open_pull_request(self):
        self.on('release/0.10', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/0.10')
        (pull,) = self.pulls
        self.on('main', {'app.ts': TWO}, 'Fix two on main too')
        self.cascade('release/0.10')
        self.assertEqual(self.pulls[pull]['state'], 'CLOSED')
        self.assertIsNone(self.tip('cascade/release-0.10-into-main'))

    def test_a_branch_that_is_not_a_release_branch_is_refused(self):
        self.run_git('push', '-q', 'origin', 'origin/main:refs/heads/release/next')
        with self.assertRaisesRegex(module.Failed, 'not a release branch'):
            self.cascade('release/next')


class Conflicts(Repository):
    def conflict(self):
        self.on('main', {'app.ts': 'one\nTwo on main\nthree\nfour\nfive\nsix\nseven\n'}, 'Two on main')
        self.on('release/0.10', {'app.ts': TWO, 'other.md': 'new\n'}, 'Fix two')
        self.cascade('release/0.10')
        (pull,) = self.pulls
        return pull

    def test_a_conflict_stays_open_as_a_draft_that_names_its_files(self):
        pull = self.conflict()
        self.assertTrue(self.pulls[pull]['draft'])
        self.assertIn('- `app.ts`', self.pulls[pull]['body'])
        self.assertNotIn('other.md`', self.pulls[pull]['body'])
        branch = 'origin/cascade/release-0.10-into-main'
        self.assertIn('<<<<<<<', self.read(branch, 'app.ts'))
        self.assertEqual(self.read(branch, 'other.md'), 'new')
        self.assertIn('Cascade-conflicts: app.ts', self.message(branch))
        self.assertEqual(self.merges(), [])

    def test_a_fix_made_ready_merges(self):
        pull = self.conflict()
        self.on('cascade/release-0.10-into-main', {'app.ts': 'one\nTWO on main\nthree\nfour\nfive\nsix\nseven\n'},
                'Settle two')
        self.ready(pull)
        (merge,) = self.merges(pull)
        self.assertIn('--auto', merge)

    def test_a_push_alone_is_not_taken_for_the_fix(self):
        pull = self.conflict()
        self.on('cascade/release-0.10-into-main', {'notes.md': 'unrelated\n'}, 'Something else')
        # Nothing runs on a push to the cascade's branch: only marking it ready does.
        self.assertEqual(self.merges(), [])
        self.assertTrue(self.pulls[pull]['draft'])

    def test_made_ready_with_markers_left_it_goes_back_to_a_draft(self):
        pull = self.conflict()
        self.on('cascade/release-0.10-into-main', {'notes.md': 'unrelated\n'}, 'Something else')
        self.ready(pull)
        self.assertEqual(self.merges(), [])
        self.assertTrue(self.pulls[pull]['draft'])
        (comment,) = [call for call in self.calls if call[:2] == ('pr', 'comment')]
        self.assertIn('conflict markers are left in app.ts', comment[-1])

    def test_made_ready_without_a_fix_it_goes_back_to_a_draft(self):
        pull = self.conflict()
        self.ready(pull)
        self.assertEqual(self.merges(), [])
        self.assertTrue(self.pulls[pull]['draft'])

    def test_a_persons_fix_is_never_pushed_over(self):
        self.conflict()
        fixed = self.on('cascade/release-0.10-into-main', {'app.ts': 'one\nTWO on main\nthree\nfour\nfive\nsix\nseven\n'},
                        'Settle two')
        self.on('release/0.10', {'app.ts': SEVEN}, 'Fix seven')
        self.cascade('release/0.10')
        self.assertEqual(self.tip('cascade/release-0.10-into-main'), fixed)
        self.assertTrue(any(call[:2] == ('pr', 'comment') for call in self.calls))

    def test_a_push_while_it_ran_is_not_pushed_over(self):
        self.conflict()
        self.on('release/0.10', {'app.ts': SEVEN}, 'Fix seven')
        merge = module.merge
        pushed = []

        def meanwhile(*args):
            # A person pushes their fix after the cascade read the branch, before it pushes.
            pushed.append(self.on('cascade/release-0.10-into-main', {'app.ts': 'settled\n'}, 'Settle two', fetch=False))
            return merge(*args)

        with mock.patch.object(module, 'merge', meanwhile):
            with self.assertRaisesRegex(module.Failed, 'moved while the cascade ran'):
                module.cascade('owner/repo', 'release/0.10', 'main', 'cascade')
        self.assertEqual(self.tip('cascade/release-0.10-into-main'), pushed[0])

    def test_a_persons_branch_with_no_open_pull_request_is_left_as_it_is(self):
        pull = self.conflict()
        fixed = self.on('cascade/release-0.10-into-main', {'app.ts': 'settled\n'}, 'Settle two')
        self.pulls[pull]['state'] = 'CLOSED'
        self.on('release/0.10', {'app.ts': SEVEN}, 'Fix seven')
        with self.assertRaisesRegex(module.Failed, "has a person's commits and no open pull request"):
            self.cascade('release/0.10')
        self.assertEqual(self.tip('cascade/release-0.10-into-main'), fixed)

    def test_once_merged_its_branch_is_no_ones_and_the_rest_carries_on(self):
        pull = self.conflict()
        self.on('cascade/release-0.10-into-main', {'app.ts': 'one\nTWO on main\nthree\nfour\nfive\nsix\nseven\n'},
                'Settle two')
        fix = self.on('release/0.10', {'app.ts': 'one\nTWO\nthree\nfour\nfive\nsix\nSEVEN\n'}, 'Fix seven')
        self.squash(pull)
        self.after(pull)
        second = max(self.pulls)
        self.assertNotEqual(second, pull)
        self.assertIn(f'Cascade-from: release/0.10 {fix}', self.message('origin/cascade/release-0.10-into-main'))
        self.assertEqual(self.read('origin/cascade/release-0.10-into-main', 'app.ts'),
                         'one\nTWO on main\nthree\nfour\nfive\nsix\nSEVEN')


class Routes(Repository):
    def test_a_fix_on_an_older_line_goes_to_the_next_release_branch_first(self):
        self.run_git('push', '-q', 'origin', 'origin/release/0.10:refs/heads/release/0.9')
        self.on('release/0.9', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/0.9')
        (pull,) = self.pulls
        self.assertEqual(self.pulls[pull]['head'], 'cascade/release-0.9-into-release-0.10')
        # release/0.10 requires no checks here: the cascade waits for `check` itself, then merges.
        (merge,) = self.merges(pull)
        self.assertIn('--squash', merge)
        self.assertNotIn('--auto', merge)
        self.assertEqual(self.read('origin/release/0.10', 'app.ts'), TWO.strip())
        self.assertIsNone(self.tip('cascade/release-0.9-into-release-0.10'))

    def test_without_its_check_it_is_not_merged(self):
        self.run_git('push', '-q', 'origin', 'origin/release/0.10:refs/heads/release/0.9')
        self.rollup = [{'__typename': 'CheckRun', 'name': 'stress', 'status': 'COMPLETED', 'conclusion': 'SUCCESS',
                        'workflowName': 'stress'}]
        self.on('release/0.9', {'app.ts': TWO}, 'Fix two')
        with mock.patch.object(module, 'LIMIT', 0), self.assertRaisesRegex(module.Failed, 'check never passed'):
            self.cascade('release/0.9')
        self.assertEqual(self.merges(), [])

    def test_a_cascade_into_main_moves_to_a_release_branch_cut_meanwhile(self):
        self.on('release/0.10', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/0.10')
        (old,) = self.pulls
        # release/0.11 is cut from main while release/0.10's cascade into main waits.
        self.run_git('push', '-q', 'origin', 'origin/main:refs/heads/release/0.11')
        self.cascade('release/0.11')
        self.assertEqual(self.pulls[old]['state'], 'CLOSED')
        # Made again into release/0.11 and merged there, and from release/0.11 on into main.
        routes = {(pull['head'], pull['state']) for number, pull in self.pulls.items() if number != old}
        self.assertEqual(routes, {('cascade/release-0.10-into-release-0.11', 'MERGED'),
                                  ('cascade/release-0.11-into-main', 'OPEN')})
        self.assertEqual(self.read('origin/release/0.11', 'app.ts'), TWO.strip())

    def test_a_release_branch_cut_while_it_waited_stops_its_merge(self):
        # release/0.9 carries into release/0.11 until release/0.10 is cut, while its checks run.
        self.run_git('push', '-q', 'origin', 'origin/release/0.10:refs/heads/release/0.9',
                     'origin/release/0.10:refs/heads/release/0.11', ':refs/heads/release/0.10')
        self.on('release/0.9', {'app.ts': TWO}, 'Fix two')
        wait, cut = module.wait, []

        def meanwhile(*args, **options):
            if not cut:
                cut.append(True)
                self.run_git('push', '-q', 'origin', 'origin/release/0.11:refs/heads/release/0.10')
            return wait(*args, **options)

        with mock.patch.object(module, 'wait', meanwhile):
            self.cascade('release/0.9')
        first = min(self.pulls)
        self.assertEqual(self.pulls[first]['base'], 'release/0.11')
        self.assertEqual(self.pulls[first]['state'], 'CLOSED')
        (merge,) = self.merges()
        self.assertEqual(self.pulls[int(merge[2])]['base'], 'release/0.10')
        self.assertEqual(self.read('origin/release/0.10', 'app.ts'), TWO.strip())
        self.assertNotEqual(self.read('origin/release/0.11', 'app.ts'), TWO.strip())

    def test_a_push_while_it_was_rerouted_keeps_the_branch_and_its_pull_request(self):
        self.on('release/0.10', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/0.10')
        (old,) = self.pulls
        self.run_git('push', '-q', 'origin', 'origin/main:refs/heads/release/0.11')
        self.run_git('fetch', '-q', 'origin')
        # A person pushes to the cascade's branch after the cascade read it.
        pushed = self.on('cascade/release-0.10-into-main', {'app.ts': 'mine\n'}, 'Mine', fetch=False)
        module.cascade('owner/repo', 'release/0.11', 'main', 'cascade')
        self.assertEqual(self.tip('cascade/release-0.10-into-main'), pushed)
        self.assertEqual(self.pulls[old]['state'], 'OPEN')
        self.assertTrue(any(call[:2] == ('pr', 'comment') and int(call[2]) == old for call in self.calls))


class Cutting(Repository):
    def test_a_cut_disarms_the_cascades_it_reroutes_before_the_branch_exists(self):
        self.on('release/0.10', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/0.10')
        (old,) = self.pulls
        self.run_git('tag', 'v0.11.0', 'origin/main')
        module.cut('owner/repo', 'release/0.11', 'v0.11.0', 'main', 'cascade')
        # Disarmed while release/0.11 didn't exist yet, so GitHub couldn't merge it on its old route during the cut.
        self.assertEqual(self.disarmed, [(old, None)])
        self.assertEqual(self.pulls[old]['state'], 'CLOSED')
        self.assertEqual(self.read('origin/release/0.11', 'app.ts'), TWO.strip())

    def test_a_cascade_the_cut_doesnt_reroute_is_left_armed(self):
        self.run_git('push', '-q', 'origin', 'origin/release/0.10:refs/heads/release/host-0.2')
        self.on('release/host-0.2', {'app.ts': TWO}, 'Fix two')
        self.cascade('release/host-0.2')
        self.run_git('tag', 'v0.11.0', 'origin/main')
        module.cut('owner/repo', 'release/0.11', 'v0.11.0', 'main', 'cascade')
        self.assertEqual(self.disarmed, [])
        self.assertEqual([pull['state'] for pull in self.pulls.values()], ['OPEN'])

    def test_it_cuts_only_a_new_release_branch(self):
        self.run_git('tag', 'v0.11.0', 'origin/main')
        with self.assertRaisesRegex(module.Failed, 'exists already'):
            module.cut('owner/repo', 'release/0.10', 'v0.11.0', 'main', 'cascade')
        with self.assertRaisesRegex(module.Failed, 'not a release branch'):
            module.cut('owner/repo', 'release/next', 'v0.11.0', 'main', 'cascade')

if __name__ == '__main__':
    unittest.main()
