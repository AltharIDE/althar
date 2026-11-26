"""Refuses a migration or ADR number that is taken already, and a change to a migration main has.

Two pull requests that each pass alone can claim the same number. Run on a
pull request as merged with main, and on a merge-queue group as it will land,
this refuses the second one before it merges (docs/decisions/foundations.md,
"Numbers that can't collide"). It reads only the tree and, for its messages
and to hold main's migrations as they are, what main has.

  python3 .github/scripts/numbers.py [--base REV] [--pr NUMBER]

--base is main as it is (in the queue, the group's base): a number main has
already is said to be main's, so the message names the one to renumber, and a
migration main has must be here byte for byte.
--pr, with GH_REPO and GH_TOKEN, also warns of an open pull request that adds
the same number, without failing: whichever of the two merges second is refused
here then.
"""

import argparse
import hashlib
import os
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass

MIGRATIONS = 'packages/persistence-sqlite/src/migrations'
PROPOSED = 'docs/decisions/proposed'
DECISIONS = 'docs/decisions/README.md'
# What finds the migrations by their names; not a migration itself.
LOADER = 'index.ts'

MIGRATION = re.compile(r'^(\d{4})_([a-z0-9_]+)\.ts$')
PROPOSAL = re.compile(r'^(\d{3})-.+\.md$')
# A row of the README's table: `| 042 |` or `| [103](proposed/103-....md) |`.
ROW = re.compile(r'^\|\s*(?:\[(\d{3})\]\(([^)\s]+)\)|(\d{3}))\s*\|', re.M)
# An import or re-export at the start of a line, with `type` when it imports types alone, and what it imports.
IMPORT = re.compile(r'''^[ \t]*(?:import|export)\b(\s+type\b)?(?:[^'"`;]*?\bfrom)?\s*['"]([^'"\n]+)['"]''', re.M)

RENUMBER_MIGRATION = 'rename the file, and its folder if it has one'
RENUMBER_PROPOSAL = f'rename the file and its row in {DECISIONS}'


@dataclass(frozen=True)
class Problem:
    file: str
    message: str


class WorkingTree:
    """The checked-out tree."""

    def __init__(self, root='.'):
        self.root = root

    def names(self, folder):
        path = os.path.join(self.root, folder)
        return sorted(os.listdir(path)) if os.path.isdir(path) else []

    def read(self, file):
        with open(os.path.join(self.root, file), encoding='utf-8') as handle:
            return handle.read()

    def files(self, folder):
        """Every file under `folder`, by its path from there."""
        top = os.path.join(self.root, folder)
        found = [os.path.relpath(os.path.join(where, name), top) for where, _, names in os.walk(top) for name in names]
        return sorted(path.replace(os.sep, '/') for path in found)

    def blob(self, file):
        """The id git gives the file's contents."""
        with open(os.path.join(self.root, file), 'rb') as handle:
            return blob_id(handle.read())


def blob_id(data):
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def names_at(rev, folder):
    """The names in `folder` at a git revision; none where it has no such folder."""
    subprocess.run(['git', 'rev-parse', '--verify', '--quiet', f'{rev}^{{commit}}'], capture_output=True, check=True)
    out = subprocess.run(['git', 'ls-tree', '--name-only', f'{rev}:{folder}'], capture_output=True, text=True)
    return sorted(out.stdout.split()) if out.returncode == 0 else []


def files_at(rev, folder):
    """Every file under `folder` at a git revision, by its path from there, with its blob's id; none where it has no such folder."""
    subprocess.run(['git', 'rev-parse', '--verify', '--quiet', f'{rev}^{{commit}}'], capture_output=True, check=True)
    out = subprocess.run(['git', 'ls-tree', '-r', '-z', f'{rev}:{folder}'], capture_output=True, text=True)
    if out.returncode != 0:
        return {}
    entries = (entry.partition('\t') for entry in out.stdout.split('\0') if entry)
    return {path: meta.split()[2] for meta, _, path in entries}


def made_of(path):
    """Whether a file in the migrations folder is a migration or part of one: anything but what sits beside them."""
    return '/' in path or MIGRATION.match(path) is not None


def check_migrations(tree, on_main):
    """Each number once, one after another from 0001; main's migrations as main has them, made only of files here."""
    problems = []
    files = [name for name in tree.names(MIGRATIONS) if name.endswith('.ts') and name != LOADER]
    keys = []
    for name in files:
        if MIGRATION.match(name):
            keys.append(name[:-3])
        # One main has was let in before: checksums.ts, beside the migrations until they were found by their names.
        elif name not in on_main:
            problems.append(Problem(f'{MIGRATIONS}/{name}', f'{name} is not named as a migration: `<4-digit number>_<name>.ts`, such as 0096_task_tags.ts.'))
    main_keys = {name[:-3] for name in on_main if MIGRATION.match(name)}
    # A store that ran a migration main has never runs it again, nor anything numbered below it: main's stay as they are.
    for key in sorted(main_keys - set(keys)):
        moved = [other for other in keys if other[5:] == key[5:]]
        problems.append(Problem(
            f'{MIGRATIONS}/{moved[0] if moved else key}.ts',
            f'{key} is main\'s migration {key[:4]}, '
            + (f'renumbered here to {moved[0][:4]}. ' if moved else 'gone here. ')
            + 'A migration main has keeps its name and number: a store that ran it would never run what takes its place, '
            'and would run it again under a new number. Put it back, and give a new migration the next number.',
        ))

    if not keys:
        return problems

    by_number = defaultdict(list)
    for key in keys:
        by_number[int(key[:4])].append(key)
    following = f'{max(by_number) + 1:04d}'
    problems += collisions(
        'Migration', by_number, main_keys, following, RENUMBER_MIGRATION, lambda key: f'{MIGRATIONS}/{key}.ts', lambda n: f'{n:04d}'
    )

    for number in sorted(number for number in by_number if number < 1):
        for key in by_number[number]:
            problems.append(Problem(
                f'{MIGRATIONS}/{key}.ts',
                f'{key} is numbered below 0001: a store that has run 0001 or later would never run it. Number it {following}.',
            ))

    missing = [number for number in range(1, max(by_number) + 1) if number not in by_number]
    if missing:
        problems.append(Problem(
            MIGRATIONS,
            f'Migration numbers skip {", ".join(f"{number:04d}" for number in missing)}. Number migrations one after another: '
            'a store records only the numbers it ran, so one that has run a later number never runs one that lands below it.',
        ))

    # A store that ran one of main's migrations never runs it again: changed, it would keep what main's made, and only
    # a new store would have the change. What a migration imports is part of it, so it imports only from here.
    here = set(tree.files(MIGRATIONS))
    for path in sorted(path for path in on_main if made_of(path)):
        if path not in here:
            if '/' in path:
                problems.append(Problem(
                    f'{MIGRATIONS}/{path}',
                    f'{path} is part of main\'s migrations, gone here. Put it back as main has it: a migration main has never changes.',
                ))
        elif tree.blob(f'{MIGRATIONS}/{path}') != on_main[path]:
            problems.append(Problem(
                f'{MIGRATIONS}/{path}',
                f'{path} is main\'s, changed here. A store runs a migration once, so one that ran main\'s keeps what it made, '
                f'and only a new store would have this. Put it back as main has it, and make the change in a new migration, '
                f'{following}.',
            ))
    for path in sorted(path for path in here if path.endswith('.ts') and path != LOADER):
        for types, imported in IMPORT.findall(tree.read(f'{MIGRATIONS}/{path}')):
            inside = os.path.normpath(os.path.join(MIGRATIONS, os.path.dirname(path), imported)).startswith(f'{MIGRATIONS}/')
            if not types and not (imported.startswith('.') and inside):
                problems.append(Problem(
                    f'{MIGRATIONS}/{path}',
                    f'{path} imports {imported}, from outside {MIGRATIONS}. A migration is made only of files here, which this '
                    'check holds to main\'s, so that nothing elsewhere can change one: copy what it needs into it.',
                ))
    return problems


def check_proposals(tree, on_main):
    """Each ADR number once: one proposal file and one row of the README's table for each."""
    problems = []
    files = [name for name in tree.names(PROPOSED) if PROPOSAL.match(name)]
    rows = [(int(linked or plain), link) for linked, link, plain in ROW.findall(tree.read(DECISIONS))]
    numbers = {number for number, _ in rows} | {int(name[:3]) for name in files}
    if not numbers:
        return problems
    following = f'{max(numbers) + 1:03d}'

    by_number = defaultdict(list)
    for name in files:
        by_number[int(name[:3])].append(name)
    main_names = {name for name in on_main if PROPOSAL.match(name)}
    problems += collisions('ADR', by_number, main_names, following, RENUMBER_PROPOSAL, lambda name: f'{PROPOSED}/{name}', lambda n: f'{n:03d}')

    counted = defaultdict(int)
    for number, _ in rows:
        counted[number] += 1
    for number, count in sorted(counted.items()):
        if count > 1:
            problems.append(Problem(DECISIONS, f'ADR-{number:03d} has {count} rows in the table. One is the ADR main has; renumber the other to ADR-{following}.'))

    links = {number: link for number, link in rows}
    for name in files:
        number = int(name[:3])
        if len(by_number[number]) > 1:
            continue
        if number not in links:
            problems.append(Problem(f'{PROPOSED}/{name}', f'ADR-{number:03d} has no row in the table in {DECISIONS}: add one, linking to proposed/{name}.'))
        elif links[number] != f'proposed/{name}':
            problems.append(Problem(
                f'{PROPOSED}/{name}',
                f'The row for ADR-{number:03d} in {DECISIONS} is another decision\'s ({links[number] or "no link"}): '
                f'that number is taken, so renumber {name} to {following}: {RENUMBER_PROPOSAL}.',
            ))
    return problems


def collisions(kind, by_number, main_names, following, how, path_of, label):
    """One problem for each entry that has to give its number up."""
    problems = []
    for number, entries in sorted(by_number.items()):
        if len(entries) < 2:
            continue
        mains = [entry for entry in entries if entry in main_names or f'{entry}.ts' in main_names]
        others = [entry for entry in entries if entry not in mains]
        if mains and others:
            for entry in others:
                problems.append(Problem(
                    path_of(entry),
                    f'{kind} {label(number)} is taken: main already has {", ".join(mains)}. '
                    f'Renumber {entry} to {following}: {how}.',
                ))
        else:
            problems.append(Problem(
                path_of(entries[-1]),
                f'{kind} {label(number)} is claimed by {" and ".join(entries)}, '
                + ('both already on main.' if mains else 'none of them on main yet: two pull requests took the same number. ')
                + ('' if mains else f'Only one keeps it; the one queued later renumbers to {following}: {how}.'),
            ))
    return problems


def check(tree, migrations_on_main=None, proposals_on_main=()):
    """`migrations_on_main`: each file main has under the migrations folder, by its path there, with its blob's id."""
    return check_migrations(tree, migrations_on_main or {}) + check_proposals(tree, proposals_on_main)


def gh(*args):
    out = subprocess.run(['gh', 'api', *args], capture_output=True, text=True, check=True)
    return out.stdout.split()


def numbered(name):
    """`('migration', '0096')` for a file of either series, else None."""
    folder, _, base = name.rpartition('/')
    if folder == MIGRATIONS and (match := MIGRATION.match(base)):
        return ('migration', match.group(1))
    if folder == PROPOSED and (match := PROPOSAL.match(base)):
        return ('ADR', match.group(1))
    return None


def shared_with_open_pulls(repo, pr, added, files_of):
    """Warnings for the numbers this change adds that another open pull request adds too."""
    mine = {numbered(name): name for name in added if numbered(name)}
    if not mine:
        return []
    warnings = []
    for other in gh('--paginate', f'repos/{repo}/pulls?state=open&per_page=100', '--jq', '.[].number'):
        if other == str(pr):
            continue
        for name in files_of(other):
            series = numbered(name)
            if series in mine:
                kind, number = series
                warnings.append(Problem(
                    mine[series],
                    f'#{other} adds {kind} {number} too ({name.rpartition("/")[2]}). '
                    'Whichever merges second has to renumber; this check refuses it until it does.',
                ))
    return warnings


def files_added_by(repo, number):
    return gh('--paginate', f'repos/{repo}/pulls/{number}/files?per_page=100', '--jq', '.[] | select(.status == "added" or .status == "renamed") | .filename')


def report(level, problem):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        message = problem.message.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::{level} file={problem.file}::{message}')
    else:
        print(f'{level}: {problem.file}: {problem.message}')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Refuse a migration or ADR number that is taken already.')
    parser.add_argument('--base', help='main as it is: names a number main has as main\'s')
    parser.add_argument('--pr', help='this pull request, to warn of an open one that adds the same number (needs GH_REPO and gh signed in)')
    args = parser.parse_args(argv)

    tree = WorkingTree()
    migrations_on_main = files_at(args.base, MIGRATIONS) if args.base else {}
    proposals_on_main = names_at(args.base, PROPOSED) if args.base else ()
    problems = check(tree, migrations_on_main, proposals_on_main)
    for problem in problems:
        report('error', problem)

    if args.pr and args.base and os.environ.get('GH_REPO'):
        added = [f'{MIGRATIONS}/{name}' for name in tree.names(MIGRATIONS) if name not in migrations_on_main]
        added += [f'{PROPOSED}/{name}' for name in tree.names(PROPOSED) if name not in proposals_on_main]
        try:
            for warning in shared_with_open_pulls(os.environ['GH_REPO'], args.pr, added, lambda n: files_added_by(os.environ['GH_REPO'], n)):
                report('warning', warning)
        except (subprocess.CalledProcessError, OSError) as error:
            # Only a warning was at stake: say so, and let the check stand on the tree.
            print(f'::notice::Could not read the other open pull requests ({error}); their numbers were not compared.')

    if problems:
        print(f'{len(problems)} number problem(s): see above.', file=sys.stderr)
        return 1
    print('Migration and ADR numbers: each taken once, and main\'s migrations as main has them.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
