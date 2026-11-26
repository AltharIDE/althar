"""Counts over the tree that may only fall, checked against main's baselines.

Each counted measure in .github/measures.json is something a refactor brings down and nothing should bring back up:
the runtime's import cycles, its json_extract calls, its comparisons of a code host's or an agent's name, its tests
that sleep on the real clock, and the places that write a node attempt's, an attention request's or a task's state
(docs/decisions/foundations.md, "What CI gates"). Run on a pull request as merged with main, and on a merge-queue
group as it will land, this refuses a count above main's baseline, and a baseline the file raises: a pull request may
lower a baseline, never raise it. A count below its baseline is a warning, which `--update` settles. It reads only the
tree and, for the baselines, main's file.

  python3 .github/scripts/measures.py [--base REV] [--update]

--base is main as it is (in the queue, the group's base), whose .github/measures.json holds the baselines; without
it, or where main has no such file yet, the tree's own file does. --update writes the tree's counts into the file,
and fails nothing.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass

FILE = '.github/measures.json'
RUNTIME = 'packages/runtime/src'
RUNTIME_TESTS = 'packages/runtime/tests'

# A value import or re-export of a file beside it: not `import type` or `export type`, which nothing runs.
VALUE_IMPORT = re.compile(r"""(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.[^'"]+)['"]""", re.S)
JSON_EXTRACT = re.compile(r'\bjson_extract\b', re.I)
CODE_HOSTS = ('github', 'gitlab', 'bitbucket')
# The agent registry's ids (packages/provider-adapters/src/registry.ts), and `claude`, the runtime's name for Claude Code.
AGENTS = ('claude-code', 'claude', 'codex', 'opencode', 'copilot', 'junie', 'grok', 'kimi', 'mistral-vibe', 'qwen-code', 'antigravity')
TEST = re.compile(r'\bit\.(live|effect)(?:\.\w+(?:\([^)]*\))?)?\(')
SLEEPS = re.compile(r'Effect\.sleep\(|\bsleep\(|setTimeout\(')
STATES = {'node_attempts': 'runtime-node-attempt-writers', 'attention_requests': 'runtime-attention-writers', 'tasks': 'runtime-task-writers'}
CHANGE = re.compile(r"\bchange\(\s*'(%s)'\s*," % '|'.join(STATES))
UPDATE = re.compile(r'\bUPDATE\s+(%s)\s+SET\b(.*?)(?:\bWHERE\b|`)' % '|'.join(STATES), re.S)


def compared(names):
    """A string literal of one of `names` beside ===, !==, == or !=, on either side, or as a case."""
    quoted = '|'.join(re.escape(name) for name in names)
    return re.compile(rf"[!=]==?\s*'(?:{quoted})'|'(?:{quoted})'\s*[!=]==?|\bcase\s+'(?:{quoted})'\s*:")


class Tree:
    """The checked-out tree."""

    def __init__(self, root='.'):
        self.root = root

    def sources(self, folder, tests=False):
        """The TypeScript files under `folder`, from it, with what each holds; tests and stories apart unless asked."""
        found = {}
        top = os.path.join(self.root, folder)
        for directory, _, names in os.walk(top):
            for name in names:
                if not name.endswith(('.ts', '.tsx')) or (not tests and ('.test.' in name or '.stories.' in name)):
                    continue
                path = os.path.join(directory, name)
                with open(path, encoding='utf-8') as handle:
                    found[os.path.relpath(path, top).replace(os.sep, '/')] = handle.read()
        return found


def cycles(sources):
    """The sizes of the import graph's strongly connected components of more than one file, largest first."""
    modules = {re.sub(r'\.tsx?$', '', path): path for path in sources}
    edges = {key: set() for key in modules}
    for key, path in modules.items():
        for match in VALUE_IMPORT.finditer(sources[path]):
            target = os.path.normpath(os.path.join(os.path.dirname(key), re.sub(r'\.(?:tsx?|m?js)$', '', match.group(1)))).replace(os.sep, '/')
            if target in modules:
                edges[key].add(target)
            elif f'{target}/index' in modules:
                edges[key].add(f'{target}/index')
    # Tarjan's, without recursion: a long chain of imports would pass Python's limit.
    index, low, stack, on, sizes, counter = {}, {}, [], set(), [], [0]
    for start in sorted(modules):
        if start in index:
            continue
        work = [(start, iter(sorted(edges[start])))]
        index[start] = low[start] = counter[0]
        counter[0] += 1
        stack.append(start)
        on.add(start)
        while work:
            node, rest = work[-1]
            step = next(rest, None)
            if step is not None:
                if step not in index:
                    index[step] = low[step] = counter[0]
                    counter[0] += 1
                    stack.append(step)
                    on.add(step)
                    work.append((step, iter(sorted(edges[step]))))
                elif step in on:
                    low[node] = min(low[node], index[step])
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[node])
            if low[node] == index[node]:
                size = 0
                while True:
                    member = stack.pop()
                    on.discard(member)
                    size += 1
                    if member == node:
                        break
                if size > 1:
                    sizes.append(size)
    return sorted(sizes, reverse=True)


def live_tests(sources):
    """The runtime's tests on the real clock and on the test's, and of the former those that sleep."""
    live = effect = sleeping = 0
    for source in sources.values():
        starts = list(TEST.finditer(source))
        for at, match in enumerate(starts):
            body = source[match.start():starts[at + 1].start() if at + 1 < len(starts) else len(source)]
            if match.group(1) == 'effect':
                effect += 1
                continue
            live += 1
            if SLEEPS.search(body):
                sleeping += 1
    return live, effect, sleeping


def keys(source, start):
    """What the object literal at the first `{` from `start` says at its own level: not inside a value's brackets."""
    opened = source.find('{', start)
    if opened < 0:
        return ''
    depth, said = 0, []
    for at in range(opened, len(source)):
        character = source[at]
        if character in '{[(':
            depth += 1
        elif character in '}])':
            depth -= 1
        if depth == 0:
            break
        if depth == 1 and character not in '{[(':
            said.append(character)
    return ''.join(said) + '}'


def state_writers(sources):
    """Per table, the places that write its state: through `change('<table>', id, {…})` or an UPDATE's SET."""
    counts = dict.fromkeys(STATES.values(), 0)
    for source in sources.values():
        for match in CHANGE.finditer(source):
            if re.search(r'(?<![\w.])state\s*[:,}]', keys(source, match.end())):
                counts[STATES[match.group(1)]] += 1
        for match in UPDATE.finditer(source):
            if re.search(r'\b(?:state|status)\s*=', match.group(2)):
                counts[STATES[match.group(1)]] += 1
    return counts


def count(tree):
    """Each counted measure's count over the tree, and what more it says, by name."""
    runtime = tree.sources(RUNTIME)
    sizes = cycles(runtime)
    live, effect, sleeping = live_tests(tree.sources(RUNTIME_TESTS, tests=True))
    hosts, agents = compared(CODE_HOSTS), compared(AGENTS)
    found = {
        'runtime-cycle-files': (sum(sizes), {'sizes': sizes}),
        'runtime-largest-cycle': (sizes[0] if sizes else 0, {}),
        'runtime-json-extract': (sum(len(JSON_EXTRACT.findall(source)) for source in runtime.values()), {}),
        'runtime-code-host-names': (sum(len(hosts.findall(source)) for source in runtime.values()), {}),
        'runtime-agent-ids': (sum(len(agents.findall(source)) for source in runtime.values()), {}),
        'runtime-live-sleeps': (sleeping, {'it.live': live, 'it.effect': effect}),
    }
    found.update({name: (value, {}) for name, value in state_writers(runtime).items()})
    return found


@dataclass(frozen=True)
class Problem:
    measure: str
    message: str


def baselines(measures):
    """The baselines a measures file holds, by name."""
    return {name: entry['baseline'] for name, entry in (measures or {}).get('counted', {}).items() if isinstance(entry.get('baseline'), int)}


def check(counts, head, base):
    """What refuses this tree, and what only warns: a count or a baseline above main's, or a count above its own baseline."""
    problems, warnings = [], []
    own, mains = baselines(head), baselines(base)
    for name, (value, _) in counts.items():
        if name not in own:
            problems.append(Problem(name, f'{name} has no baseline in {FILE}: run `python3 .github/scripts/measures.py --update` and commit it.'))
            continue
        what = head['counted'][name].get('what', name)
        if name in mains and value > mains[name]:
            problems.append(Problem(name, f'{name} is {value} here, above main\'s {mains[name]}: it may only fall. {what}'))
        elif name in mains and own[name] > mains[name]:
            problems.append(Problem(name, f'{name}\'s baseline is raised here from main\'s {mains[name]} to {own[name]}: a baseline may only fall. Put back {mains[name]}.'))
        elif value > own[name]:
            problems.append(Problem(name, f'{name} is {value} here, above its baseline of {own[name]}: it may only fall. {what}'))
        elif value < own[name]:
            warnings.append(Problem(name, f'{name} is {value} here, below its baseline of {own[name]}: lower the baseline with `python3 .github/scripts/measures.py --update`, so it stays down.'))
    return problems, warnings


def at(rev):
    """The measures file at a git revision; None where it has none."""
    subprocess.run(['git', 'rev-parse', '--verify', '--quiet', f'{rev}^{{commit}}'], capture_output=True, check=True)
    shown = subprocess.run(['git', 'show', f'{rev}:{FILE}'], capture_output=True, text=True)
    return json.loads(shown.stdout) if shown.returncode == 0 else None


def update(measures, counts):
    """The file with the tree's counts as its baselines, keeping what each says it is."""
    for name, (value, detail) in counts.items():
        entry = measures.setdefault('counted', {}).setdefault(name, {'what': name})
        entry['baseline'] = value
        if detail:
            entry['detail'] = detail
        else:
            entry.pop('detail', None)
    return measures


def summary(counts, head, base):
    """The run's summary: each measure, its count and the baselines."""
    own, mains = baselines(head), baselines(base)
    rows = [f'| {name} | {value} | {own.get(name, "none")} | {mains.get(name, "none")} |' for name, (value, _) in counts.items()]
    return '\n'.join(['### Measures that only fall', '', '| Measure | Here | Its baseline | Main\'s |', '| --- | ---: | ---: | ---: |', *rows, ''])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base')
    parser.add_argument('--update', action='store_true')
    args = parser.parse_args()
    with open(FILE, encoding='utf-8') as handle:
        head = json.load(handle)
    counts = count(Tree())
    if args.update:
        with open(FILE, 'w', encoding='utf-8') as handle:
            json.dump(update(head, counts), handle, indent=2, ensure_ascii=False)
            handle.write('\n')
        for name, (value, _) in counts.items():
            print(f'{name}: {value}')
        return 0
    base = at(args.base) if args.base else None
    problems, warnings = check(counts, head, base)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as handle:
            handle.write(summary(counts, head, base))
    for name, (value, _) in counts.items():
        print(f'{name}: {value}')
    for warning in warnings:
        print(f'::warning file={FILE},title={warning.measure}::{warning.message}')
    for problem in problems:
        print(f'::error file={FILE},title={problem.measure}::{problem.message}')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
