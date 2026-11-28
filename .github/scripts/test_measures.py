import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('measures', '.github/scripts/measures.py')
measures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measures)

SCRIPT = os.path.abspath('.github/scripts/measures.py')
FOLDERS = []


def tearDownModule():
    for folder in FOLDERS:
        shutil.rmtree(folder, ignore_errors=True)


class Tree:
    """A repository with a small runtime: its sources and tests, as a test writes them."""

    def __init__(self, files):
        self.root = tempfile.mkdtemp()
        FOLDERS.append(self.root)
        for path, text in files.items():
            os.makedirs(os.path.dirname(os.path.join(self.root, path)), exist_ok=True)
            with open(os.path.join(self.root, path), 'w', encoding='utf-8') as handle:
                handle.write(text)

    def count(self):
        return {name: value for name, (value, _) in measures.count(measures.Tree(self.root)).items()}


RUNTIME = {
    # Tasks and Runs import each other; with Queries, which imports Tasks back, they are one cycle of three.
    'packages/runtime/src/Tasks.ts': "import { run } from './Runs'\nexport const task = 1",
    'packages/runtime/src/Runs.ts': "import { query } from './Queries.ts'\nexport { task } from './Tasks'",
    'packages/runtime/src/Queries.ts': "import { task } from './Tasks'\nexport const query = 1",
    # Words and Cards only import each other's types: no cycle.
    'packages/runtime/src/words.ts': "import type { Card } from './cards'\nexport const said = 1",
    'packages/runtime/src/cards.ts': "import type { said } from './words'\nimport { tool } from './tools'",
    'packages/runtime/src/tools/index.ts': "import { said } from '../words'\nexport const tool = 1",
    'packages/runtime/src/hosts.ts': "\n".join([
        "if (host.product === 'github') x()",
        "if ('gitlab' !== product) y()",
        "switch (product) { case 'bitbucket': z() }",
        "const named = 'github'",
        "if (agent === 'claude-code' || definition.native === 'copilot') a()",
        "if (agentId === 'codex-mini') b()",
    ]),
    'packages/runtime/src/store.ts': "\n".join([
        "sql`SELECT json_extract(output, '$.summary') FROM node_attempts WHERE JSON_EXTRACT(input, '$.a') = 1`",
        "yield* change('node_attempts', id, { state: 'running', startedAt })",
        "yield* change('node_attempts', id, { output: JSON.stringify({ state }) })",
        "yield* change('tasks', id, { state })",
        "yield* sql`UPDATE attention_requests SET state = 'withdrawn' WHERE task_id = ${id}`",
        "yield* sql`UPDATE tasks SET seen_at = ${at} WHERE id = ${id} AND state = 'open'`",
    ]),
    'packages/runtime/src/store.test.ts': "import { task } from './Tasks'\nimport { query } from './Queries'",
    'packages/runtime/tests/clock.test.ts': "\n".join([
        "it.live('waits a moment', () => Effect.gen(function* () { yield* Effect.sleep('10 millis') }))",
        "it.live.skipIf(windows)('runs git', () => run('git status'))",
        "it.effect('moves the clock', () => TestClock.adjust('1 hour'))",
        "it.live('sleeps by Node', async () => { await new Promise((done) => setTimeout(done, 5)) })",
    ]),
}


class Counts(unittest.TestCase):
    def test_counts_each_measure_over_the_tree(self):
        self.assertEqual(Tree(RUNTIME).count(), {
            'runtime-cycle-files': 3,
            'runtime-largest-cycle': 3,
            'runtime-json-extract': 2,
            'runtime-code-host-names': 3,
            'runtime-agent-ids': 2,
            'runtime-live-sleeps': 2,
            'runtime-node-attempt-writers': 1,
            'runtime-attention-writers': 1,
            'runtime-task-writers': 1,
        })

    def test_gives_each_cycles_size_and_each_kind_of_test(self):
        found = measures.count(measures.Tree(Tree({
            **RUNTIME,
            'packages/runtime/src/a.ts': "import { b } from './b'",
            'packages/runtime/src/b.ts': "import { a } from './a'",
        }).root))
        self.assertEqual(found['runtime-cycle-files'], (5, {'sizes': [3, 2]}))
        self.assertEqual(found['runtime-live-sleeps'], (2, {'it.live': 3, 'it.effect': 1}))

    def test_counts_nothing_in_an_empty_runtime(self):
        self.assertEqual(set(Tree({'README.md': '# Althar'}).count().values()), {0})


FILE = {'counted': {name: {'what': f'What {name} counts.', 'baseline': 3} for name in ('one', 'two')}}


def counts(**values):
    return {name: (value, {}) for name, value in values.items()}


class Check(unittest.TestCase):
    def test_passes_at_or_below_main(self):
        self.assertEqual(measures.check(counts(one=3, two=3), FILE, FILE), ([], []))

    def test_refuses_a_count_above_mains_baseline(self):
        problems, _ = measures.check(counts(one=4, two=3), FILE, FILE)
        self.assertEqual(problems, [measures.Problem('one', "one is 4 here, above main's 3: it may only fall. What one counts.")])

    def test_refuses_a_baseline_raised_from_mains(self):
        raised = {'counted': {**FILE['counted'], 'one': {'what': 'What one counts.', 'baseline': 5}}}
        problems, _ = measures.check(counts(one=4, two=3), raised, FILE)
        self.assertEqual([problem.measure for problem in problems], ['one'])
        self.assertIn("one is 4 here, above main's 3", problems[0].message)
        problems, _ = measures.check(counts(one=3, two=3), raised, FILE)
        self.assertEqual(problems, [measures.Problem('one', "one's baseline is raised here from main's 3 to 5: a baseline may only fall. Put back 3.")])

    def test_warns_of_a_count_below_its_baseline_and_lets_a_pull_request_lower_it(self):
        problems, warnings = measures.check(counts(one=2, two=3), FILE, FILE)
        self.assertEqual(problems, [])
        self.assertEqual([warning.measure for warning in warnings], ['one'])
        lowered = {'counted': {**FILE['counted'], 'one': {'what': 'What one counts.', 'baseline': 2}}}
        self.assertEqual(measures.check(counts(one=2, two=3), lowered, FILE), ([], []))

    def test_holds_a_tree_to_its_own_baselines_where_main_has_none(self):
        self.assertEqual(measures.check(counts(one=3, two=3), FILE, None), ([], []))
        problems, _ = measures.check(counts(one=4, two=3), FILE, None)
        self.assertEqual(problems, [measures.Problem('one', 'one is 4 here, above its baseline of 3: it may only fall. What one counts.')])

    def test_refuses_a_measure_with_no_baseline(self):
        problems, _ = measures.check(counts(one=3, two=3, three=0), FILE, FILE)
        self.assertEqual([problem.measure for problem in problems], ['three'])

    def test_updates_the_baselines_keeping_what_each_counts(self):
        updated = measures.update(json.loads(json.dumps(FILE)), {'one': (1, {'sizes': [1]}), 'two': (3, {}), 'three': (0, {})})
        self.assertEqual(updated['counted']['one'], {'what': 'What one counts.', 'baseline': 1, 'detail': {'sizes': [1]}})
        self.assertEqual(updated['counted']['three'], {'what': 'three', 'baseline': 0})


class Run(unittest.TestCase):
    """The script as CI runs it, in a repository whose main has a measures file."""

    def git(self, root, *args):
        subprocess.run(['git', '-c', 'user.name=CI', '-c', 'user.email=ci@example.com', *args], cwd=root, check=True, capture_output=True)

    def run_script(self, root, *args):
        return subprocess.run([sys.executable, SCRIPT, *args], cwd=root, capture_output=True, text=True)

    def test_refuses_on_a_rise_against_main_and_passes_once_it_falls(self):
        tree = Tree(RUNTIME)
        os.makedirs(os.path.join(tree.root, '.github'))
        with open(os.path.join(tree.root, '.github/measures.json'), 'w', encoding='utf-8') as handle:
            json.dump({'counted': {}}, handle)
        self.assertEqual(self.run_script(tree.root, '--update').returncode, 0)
        self.git(tree.root, 'init', '--quiet')
        self.git(tree.root, 'add', '.')
        self.git(tree.root, 'commit', '--quiet', '-m', 'main')
        self.assertEqual(self.run_script(tree.root, '--base', 'HEAD').returncode, 0)
        with open(os.path.join(tree.root, 'packages/runtime/src/more.ts'), 'w', encoding='utf-8') as handle:
            handle.write("const at = sql`SELECT json_extract(a, '$.b')`")
        refused = self.run_script(tree.root, '--base', 'HEAD')
        self.assertEqual(refused.returncode, 1)
        self.assertIn("::error file=.github/measures.json,title=runtime-json-extract::runtime-json-extract is 3 here, above main's 2", refused.stdout)
        os.remove(os.path.join(tree.root, 'packages/runtime/src/more.ts'))
        os.remove(os.path.join(tree.root, 'packages/runtime/src/store.ts'))
        fell = self.run_script(tree.root, '--base', 'HEAD')
        self.assertEqual(fell.returncode, 0)
        self.assertIn('::warning file=.github/measures.json,title=runtime-json-extract::', fell.stdout)


if __name__ == '__main__':
    unittest.main()
