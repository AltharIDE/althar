import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('coverage_gate', '.github/scripts/runtime-coverage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def measurement(lines=90, branches=90):
    counts = {name: dict(total=10000, covered=round(pct * 100), pct=pct)
              for name, pct in [('lines', lines), ('branches', branches)]}
    return {'total': counts, '/runtime/src/example.ts': counts.copy()}


def blob(failed=False):
    # The fields the gate checks in Vitest's flatted report; outcomes belong to the shard, not the coverage verdict.
    return [['1', '2', '3', '4', 100, '5'], '5.1.0', [{'result': 'failed' if failed else 'passed'}], [],
            {'/runtime/src/example.ts': {}}, {}]


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for kind in ('blob', 'summary'):
            (self.root / kind).mkdir()
        for name in module.PARTS:
            self.write(self.root / 'blob' / name, blob())
            self.write(self.root / 'summary' / name, measurement())
        self.policy = self.root / 'policy.json'
        self.write(self.policy, {'lines': 90, 'branches': 89.75})
        self.merged = self.root / 'merged.json'
        self.write(self.merged, measurement())

    def write(self, path, data):
        path.write_text(json.dumps(data))

    def gate(self):
        with contextlib.redirect_stdout(io.StringIO()), patch.dict('os.environ', GITHUB_STEP_SUMMARY=''):
            return module.gate(self.root, self.merged, self.policy)

    def test_branch_variation_has_bounded_slack_and_lines_keep_their_gate(self):
        for pct in (90.13, 89.98, 89.75):
            self.write(self.merged, measurement(branches=pct))
            self.assertAlmostEqual(self.gate()['branches'], pct)
        for measured in (measurement(branches=89.74), measurement(lines=89.99)):
            self.write(self.merged, measured)
            with self.assertRaisesRegex(ValueError, 'below its gate'):
                self.gate()

    def test_partial_or_missing_parts_are_not_a_coverage_verdict(self):
        for kind in ('blob', 'summary'):
            path = self.root / kind / 'part-3.json'
            text = path.read_text()
            path.unlink()
            with self.assertRaisesRegex(ValueError, 'Expected four'):
                self.gate()
            path.write_text(text)
        self.write(self.root / 'blob' / 'unexpected.json', ['other run'])
        with self.assertRaisesRegex(ValueError, 'Expected four'):
            self.gate()

    def test_a_blob_without_coverage_measurements_is_not_complete(self):
        self.write(self.root / 'summary' / 'part-0.json', {})
        with self.assertRaisesRegex(ValueError, 'no source measurements'):
            self.gate()

    def test_malformed_or_empty_blob_coverage_fails_even_with_a_summary(self):
        for broken in ([], ['not a blob'], blob(), blob()):
            if len(broken) == 6:
                broken[4] = {}
            self.write(self.root / 'blob' / 'part-0.json', broken)
            with self.assertRaises(ValueError):
                self.gate()

    def test_missing_malformed_and_incomplete_merged_measurements_fail(self):
        self.merged.unlink()
        with self.assertRaisesRegex(ValueError, 'could not be read'):
            self.gate()
        self.merged.write_text('{broken')
        with self.assertRaisesRegex(ValueError, 'could not be read'):
            self.gate()
        for broken in ({'total': {}}, measurement()):
            if len(broken) > 1:
                broken['total'] = {'lines': {'total': 10000, 'covered': 9000, 'pct': 90},
                                   'branches': {'total': 10000, 'covered': 10001, 'pct': 100.01}}
            self.write(self.merged, broken)
            with self.assertRaises(ValueError):
                self.gate()
        incomplete = measurement()
        incomplete['/runtime/src/example.ts'] = measurement(lines=95)['total']
        self.write(self.merged, incomplete)
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            self.gate()

    def test_replayed_test_failures_are_not_part_of_the_coverage_verdict(self):
        self.write(self.root / 'blob' / 'part-0.json', blob(failed=True))
        self.assertEqual(self.gate(), {'lines': 90, 'branches': 90})

    def test_an_internally_valid_merge_cannot_omit_a_source_from_one_part(self):
        part = measurement()
        part['/runtime/src/omitted.ts'] = measurement()['total']
        part['total'] = {kind: dict(total=20000, covered=18000, pct=90) for kind in ('lines', 'branches')}
        self.write(self.root / 'summary' / 'part-2.json', part)
        # The merged summary still has internally consistent totals, but lost an entire source file.
        with self.assertRaisesRegex(ValueError, 'missing.*omitted.ts'):
            self.gate()

    def test_normalizes_source_paths_when_comparing_parts_to_the_merge(self):
        part = measurement()
        part['/runtime/src/../src/example.ts'] = part.pop('/runtime/src/example.ts')
        self.write(self.root / 'summary' / 'part-0.json', part)
        self.assertEqual(self.gate(), {'lines': 90, 'branches': 90})


if __name__ == '__main__':
    unittest.main()
