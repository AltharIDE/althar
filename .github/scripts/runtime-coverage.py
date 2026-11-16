"""Gate complete runtime coverage separately from the tests replayed by Vitest."""

import json
import math
import os
import posixpath
import re
import sys
from pathlib import Path


PARTS = tuple(f'part-{i}.json' for i in range(4))
POLICY = Path(__file__).resolve().parents[2] / 'packages/runtime/coverage-gate.json'


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        raise ValueError(f'Coverage report could not be read: {path}: {error}') from error


def counts(value, label):
    if not isinstance(value, dict):
        raise ValueError(f'Coverage measurement is missing: {label}')
    total, covered, pct = (value.get(k) for k in ('total', 'covered', 'pct'))
    if (type(total) is not int or type(covered) is not int or total < 0 or covered < 0 or covered > total
            or type(pct) not in (int, float) or not math.isfinite(pct) or not 0 <= pct <= 100):
        raise ValueError(f'Coverage measurement is invalid: {label}')
    measured = 100 * covered / total if total else 100
    # Istanbul truncates its displayed percentage to two decimals. Gate on the counts, without rounding.
    if abs(measured - pct) > 0.011:
        raise ValueError(f'Coverage percentage disagrees with its counts: {label}')
    return total, covered


def summary(path):
    report = read_json(path)
    if not isinstance(report, dict) or len(report) < 2 or 'total' not in report:
        raise ValueError(f'Coverage summary has no source measurements: {path}')
    result = {}
    for kind in ('lines', 'branches'):
        total, covered = counts(report['total'].get(kind), f'{path}: total {kind}')
        if total == 0:
            raise ValueError(f'Coverage summary has no {kind}: {path}')
        files = [counts(value.get(kind) if isinstance(value, dict) else None, f'{name}: {kind}')
                 for name, value in report.items() if name != 'total']
        if (total, covered) != (sum(one[0] for one in files), sum(one[1] for one in files)):
            raise ValueError(f'Coverage summary is incomplete: {path}: {kind}')
        result[kind] = 100 * covered / total
    return result


def source_files(path):
    return {posixpath.normpath(name.replace('\\', '/')) for name in read_json(path) if name != 'total'}


def parts(directory):
    directory = Path(directory)
    for folder in ('blob', 'summary'):
        found = {path.name for path in (directory / folder).glob('*') if path.is_file()}
        if found != set(PARTS):
            raise ValueError(f'Expected four runtime {folder} reports; found {sorted(found)}')
    sources = set()
    for part in PARTS:
        blob = read_json(directory / 'blob' / part)
        # Vitest 5 uses flatted: its root is [version, files, errors, coverage, time, module graph], with string references.
        def reference(value):
            if not isinstance(value, str) or not value.isdecimal() or int(value) >= len(blob):
                raise ValueError(f'Invalid runtime blob reference: {part}')
            return blob[int(value)]
        if not isinstance(blob, list) or not blob or not isinstance(blob[0], list) or len(blob[0]) != 6:
            raise ValueError(f'Invalid runtime blob: {part}')
        version, files, errors, coverage, elapsed, graph = blob[0]
        if (not isinstance(reference(version), str) or not re.fullmatch(r'5\.[\w.+-]+', reference(version))
                or not isinstance(reference(files), list) or not reference(files)
                or not isinstance(reference(errors), list) or not isinstance(reference(coverage), dict) or not reference(coverage)
                or type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed < 0
                or not isinstance(reference(graph), dict)):
            raise ValueError(f'Invalid or incomplete runtime blob: {part}')
        measurement = directory / 'summary' / part
        summary(measurement)
        sources.update(source_files(measurement))
    return sources


def gate(directory, path, policy=POLICY):
    expected = parts(directory)
    measured = summary(path)
    found = source_files(path)
    if found != expected:
        raise ValueError(f'Merged runtime coverage source files differ from its parts: '
                         f'missing {sorted(expected - found)}; unexpected {sorted(found - expected)}')
    thresholds = read_json(policy)
    lines = ['### Runtime coverage', '', '| Measurement | Covered | Gate |', '| --- | ---: | ---: |']
    failed = []
    for kind, value in measured.items():
        threshold = thresholds[kind]
        if type(threshold) not in (int, float) or not math.isfinite(threshold) or not 0 <= threshold <= 100:
            raise ValueError(f'Invalid runtime coverage gate: {kind}')
        lines.append(f'| {kind.capitalize()} | {value:.2f}% | {threshold:.2f}% |')
        if value < threshold:
            failed.append(f'{kind}: {value:.4f}% < {threshold}%')
    lines.extend(['', f'The target is {thresholds["lines"]}%; the branch gate allows '
                  f'{thresholds["lines"] - thresholds["branches"]:g} percentage points for measurement variation.',
                  'Test results are reported by the individual runtime test jobs.'])
    text = '\n'.join(lines) + '\n'
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as out:
            out.write(text)
    if failed:
        raise ValueError(f'Runtime coverage is below its gate: {"; ".join(failed)}')
    return measured


if __name__ == '__main__':
    try:
        if len(sys.argv) == 3 and sys.argv[1] == 'parts':
            parts(sys.argv[2])
        elif len(sys.argv) == 4 and sys.argv[1] == 'gate':
            gate(sys.argv[2], sys.argv[3])
        else:
            raise ValueError('Use runtime-coverage.py parts <directory> or gate <directory> <summary>')
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f'::error::{error}', flush=True)
        sys.exit(1)
