"""Refuses a change to the wire that a client of an older release can't survive, unless API_VERSION goes up.

A home, the desktop and the phone ship apart and connect all the same (docs/decisions/foundations.md, "Clients of
another version"). packages/contracts/api.schema.json is the wire as the contract has it, written by `bun run
snapshot` and held to the contract by a test. This compares it with main's and judges each change both ways:

- An older client calling a newer home: what it sends must still be taken. A call gone, one a socket can't make any
  more (a phone calls through one), a payload's field required that wasn't, or a payload that takes less, breaks it.
- An older client reading a newer home's answer (its success, each element of a stream, its error): what the home
  sends must still read. A closed union with a new member, a field it reads left out or made null, or a field's type
  changed, breaks it. A field added doesn't: Effect's structs drop keys they don't know on decode. Nor does a member
  added to an open union (packages/contracts/src/open.ts), which an older client reads as its fallback.

What a side sends is narrower than its schema says: a home never sends an open union's fallback, which encoding
forbids, and a struct sends only its own fields. What a side takes is all its schema says, the fallback included.

  python3 .github/scripts/wire.py [--base REV | --before FILE] [--after FILE]

--base is main as it is (in the queue, the group's base), whose snapshot the tree's is compared with; where it has
none there is nothing to compare, and the check passes. --before compares a file instead, as a snapshot made at
another commit, and --after names the newer one (the tree's by default). A break passes when API_VERSION, which a
snapshot records, is higher in the newer.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass

FILE = 'packages/contracts/api.schema.json'

# What a schema may say that doesn't change what it takes.
ANNOTATIONS = {'$schema', '$id', '$comment', '$anchor', 'title', 'description', 'examples', 'default', 'deprecated', 'readOnly', 'writeOnly'}
# What this check reads; a schema that takes less by anything else is one it can't judge.
READ = ANNOTATIONS | {
    'type', 'enum', 'const', 'anyOf', 'allOf', 'not', '$ref', 'properties', 'required', 'additionalProperties', 'items',
    'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
}
# Which field tells a union's structs apart, where several could.
TAGS = ('_tag', 'kind', 'type')

NAMES = {'string': 'a string', 'number': 'a number', 'integer': 'a whole number', 'boolean': 'true or false', 'null': 'null',
         'array': 'a list', 'object': 'an object', 'any': 'anything', 'nonnull': 'anything but null'}


@dataclass(frozen=True)
class Problem:
    rpc: str
    message: str


@dataclass(frozen=True)
class Atom:
    """One member of a union, with no anyOf or $ref at its top: a schema node, of one type."""

    kind: str
    node: dict
    name: str | None = None
    # Made here rather than read from a document, so never remembered by its id.
    made: bool = False


ANY = Atom('any', {}, made=True)
NONNULL = Atom('nonnull', {}, made=True)
# An empty struct takes anything but null, and sends {}.
EMPTY = Atom('object', {'type': 'object', 'properties': {}, 'required': []}, made=True)


def quoted(value):
    return json.dumps(value, ensure_ascii=False)


def listed(values):
    said = [quoted(value) for value in values]
    return said[0] if len(said) == 1 else f'{", ".join(said[:-1])} or {said[-1]}'


def typed(value):
    """The JSON type of a value, as a schema names it."""
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer()):
        return 'integer'
    if isinstance(value, float):
        return 'number'
    if isinstance(value, str):
        return 'string'
    return 'array' if isinstance(value, list) else 'object'


def fits_type(kind, taken):
    """Whether a value of `kind` is of the type an atom takes."""
    return taken.kind in ('any', kind) or (taken.kind == 'nonnull' and kind != 'null') or (kind == 'integer' and taken.kind == 'number')


def none_of(part):
    """Whether a part of an `allOf` says the value is none of a few, as open.ts's fallback is none of the known ones."""
    return isinstance(part, dict) and set(part) == {'not'} and isinstance(part['not'], dict) and set(part['not']) == {'enum'}


def excluded(node):
    """The strings an atom's `allOf` says it is none of."""
    return {value for part in node.get('allOf', []) if none_of(part) for value in part['not']['enum'] if isinstance(value, str)}


def required_too(node):
    """What an atom's `allOf` requires besides that: each a schema the value must also fit."""
    return [part for part in node.get('allOf', []) if not none_of(part)]


def enumerated(node):
    if 'const' in node:
        return [node['const']]
    return node.get('enum')


def unread(node):
    """What an atom says that this check doesn't read."""
    return {key for key in node if key not in READ}


DEFS = '#/$defs/'


def defined(ref):
    """The definition a reference names, or None where it names none of the snapshot's own."""
    return ref[len(DEFS):].replace('~1', '/').replace('~0', '~') if isinstance(ref, str) and ref.startswith(DEFS) else None


class Snapshot:
    """A snapshot of the wire: its calls and its definitions."""

    def __init__(self, document):
        self.rpcs = document.get('rpcs', {})
        self.defs = document.get('$defs', {})

    def resolve(self, ref):
        name = defined(ref)
        if name not in self.defs:
            raise ValueError(f'{ref} names no definition of the snapshot: only {DEFS}… is followed.')
        return name, self.defs[name]


def references(node):
    """The definitions a node refers to, at any depth."""
    found, stack = set(), [node]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if defined(value.get('$ref')) is not None:
                found.add(defined(value['$ref']))
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return found


def unchanged(before, after):
    """The definitions that are the same in both snapshots, and all they refer to as well."""
    same = {name for name, node in before.defs.items() if after.defs.get(name) == node}
    refers = {name: references(before.defs[name]) for name in same}
    while True:
        gone = {name for name in same if not refers[name] <= same}
        if not gone:
            return same
        same -= gone


class Reading:
    """An older client reading what a newer home sends: the home's answer is sent, the client's schema takes it."""

    def value(self, value):
        return f'{quoted(value)} is new there, and the union it reads isn\'t open'

    def member(self, key, value):
        return f'a member whose {key} is {quoted(value)} is new there, and the union it reads isn\'t open'

    def type(self, sent, taken):
        return f'it can be {sent} now, where it reads only {taken}'

    def wider(self, values):
        return f'it can be any value now, where it reads only {listed(values)}'

    def limit(self, said):
        return f'it can be {said} now, which an older client refuses'

    def optional(self):
        return 'it can be left out now, and an older client needs it'

    def gone(self):
        return 'it is gone, and an older client needs it'

    def extra(self):
        return 'it is new, and an older client takes no field it doesn\'t know there'


class Calling:
    """A newer home taking what an older client sends: the client's payload is sent, the home's schema takes it."""

    def value(self, value):
        return f'the home refuses {quoted(value)} now, which an older client may send'

    def member(self, key, value):
        return f'the home refuses a member whose {key} is {quoted(value)} now, which an older client may send'

    def type(self, sent, taken):
        return f'the home takes only {taken} now, where an older client sends {sent}'

    def wider(self, values):
        return f'the home takes only {listed(values)} now, where an older client sends any value'

    def limit(self, said):
        return f'the home refuses {said} now, which an older client may send'

    def optional(self):
        return 'the home requires it now, and an older client may leave it out'

    def gone(self):
        return 'the home requires it now, and an older client doesn\'t send it'

    def extra(self):
        return 'the home refuses it now, and an older client sends it'


def never_sent(atom):
    """An open union's fallback, which encoding forbids: a string none of the known ones, or a struct whose tag is one."""
    if atom.kind == 'string':
        return bool(excluded(atom.node)) and enumerated(atom.node) is None
    if atom.kind == 'object':
        properties = atom.node.get('properties', {})
        for field in atom.node.get('required', []):
            inner = properties.get(field)
            if isinstance(inner, dict) and set(inner) - ANNOTATIONS <= {'type', 'allOf'} and inner.get('type') == 'string':
                if excluded(inner) and not required_too(inner):
                    return True
    return False


class Judge:
    """Whether everything one side sends, by one schema, is taken by the other's: the problems where it isn't.

    A problem is a path into the value and why it breaks. The path is made of ('field', name), ('items',), ('values',)
    for a record's, ('member', key, value) for one struct of a union, and ('def', name) where it enters a definition.
    """

    def __init__(self, sends, takes, words, newer, same=None):
        self.sends, self.takes, self.words = sends, takes, words
        # Which side is the newer, whose definitions a message names: that is where the change is made.
        self.newer = newer
        # The definitions both sides have alike, which aren't walked again; None walks everything.
        self.same = same
        self.judged, self.judging = {}, set()

    def members(self, node, snapshot, sending, seen=frozenset()):
        """The atoms of a union, references followed and nested unions flattened; sent, without what is never sent."""
        name = None
        while isinstance(node, dict) and '$ref' in node:
            if node['$ref'] in seen:
                return []
            seen = seen | {node['$ref']}
            name, node = snapshot.resolve(node['$ref'])
        if node is True or node == {}:
            return [ANY]
        if node is False:
            return []
        if 'anyOf' in node or 'oneOf' in node:
            rest = {key: value for key, value in node.items() if key not in ('anyOf', 'oneOf') and key not in ANNOTATIONS}
            found = []
            for branch in node.get('anyOf', []) + node.get('oneOf', []):
                found += self.members({**rest, **branch} if rest else branch, snapshot, sending, seen)
            return found
        if set(node) - ANNOTATIONS == {'not'} and node['not'] == {'type': 'null'}:
            return [EMPTY if sending else NONNULL]
        kinds = node.get('type')
        if isinstance(kinds, list):
            return [Atom(kind, {**node, 'type': kind}, name, made=True) for kind in kinds]
        if kinds is None:
            values = enumerated(node)
            if values is not None:
                kinds = sorted({typed(value) for value in values})
                return [Atom(kind, {'type': kind, 'enum': [value for value in values if typed(value) == kind]}, name, made=True) for kind in kinds]
            return [ANY]
        atom = Atom(kinds, node, name)
        if sending and never_sent(atom):
            return []
        return [atom]

    def fit(self, sent, taken, path=()):
        """The problems where what `sent` sends isn't taken by `taken`."""
        if self.same is not None and sent == taken and references(sent) <= self.same:
            return []
        takers, atoms = self.members(taken, self.takes, sending=False), self.members(sent, self.sends, sending=True)
        # A tag tells a union's structs apart, sent or taken: whether those sent are several.
        union = sum(atom.kind == 'object' for atom in atoms) > 1
        problems = []
        for atom in atoms:
            problems += self.fit_member(atom, takers, path, union)
        return problems

    def named(self, sent, taken):
        """Where an atom comes from a definition, the newer side's name for it."""
        newer, older = (sent, taken) if self.newer == 'sends' else (taken, sent)
        name = newer.name or older.name
        return (('def', name),) if name else ()

    def fit_member(self, atom, takers, path, union=False):
        """One atom sent, which some atom of the taker's union must take."""
        if any(taker.kind == 'any' for taker in takers):
            return []
        values = enumerated(atom.node)
        if values is not None:
            return [problem for value in values for problem in self.fit_value(value, takers, path)]
        if atom.kind == 'any':
            return [(path, self.words.type(NAMES['any'], self.names(takers)))]
        candidates = [taker for taker in takers if fits_type(atom.kind, taker)]
        if not candidates:
            return [(path, self.words.type(NAMES.get(atom.kind, atom.kind), self.names(takers)))]
        if atom.kind == 'string':
            return self.fit_string(atom, candidates, takers, path)
        if atom.kind == 'object':
            return self.fit_struct(atom, candidates, path, union)
        found = None
        for taker in candidates:
            problems = self.fit_atom(atom, taker)
            if not problems:
                return []
            found = found if found is not None and len(found[1]) <= len(problems) else (taker, problems)
        taker, problems = found
        return [(path + self.named(atom, taker) + where, why) for where, why in problems]

    def names(self, takers):
        """What a union takes, as a message says it: "a string or null"."""
        kinds = []
        for taker in takers:
            values = enumerated(taker.node)
            said = listed(values) if values is not None else NAMES.get(taker.kind, taker.kind)
            if said not in kinds:
                kinds.append(said)
        return ' or '.join(kinds) if kinds else 'nothing'

    def fit_value(self, value, takers, path):
        """One value sent, as a literal is: some atom must take it."""
        if any(self.takes_value(value, taker) for taker in takers):
            return []
        kind = typed(value)
        same = [taker for taker in takers if fits_type(kind, taker)]
        for taker in same:
            if unread(taker.node):
                return [(path, self.cant_judge(taker))]
        if same:
            return [(path, self.words.value(value))]
        return [(path, self.words.type(quoted(value), self.names(takers)))]

    def takes_value(self, value, taker):
        """Whether an atom takes one value; one with what this check doesn't read takes none."""
        if not fits_type(typed(value), taker):
            return False
        node = taker.node
        if taker.kind in ('any', 'nonnull'):
            return True
        if unread(node):
            return False
        values = enumerated(node)
        if values is not None and not any(typed(known) == typed(value) and known == value for known in values):
            return False
        if isinstance(value, str):
            if value in excluded(node) or len(value) < node.get('minLength', 0) or len(value) > node.get('maxLength', float('inf')):
                return False
            if 'pattern' in node and not matches(node['pattern'], value):
                return False
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if any(bound is not None and not within((value, False), bound, side) for side in ('minimum', 'maximum') for bound in [edge(node, side)]):
                return False
        for part in required_too(node):
            if not any(self.takes_value(value, inner) for inner in self.members(part, self.takes, sending=False)):
                return False
        return True

    def cant_judge(self, taker):
        said = ', '.join(sorted(unread(taker.node)))
        return f'this check can\'t judge what {said} takes: compare it by hand, and teach .github/scripts/wire.py to read it'

    def fit_string(self, atom, candidates, takers, path):
        """A string sent, not one of a few: some atom must take every string it may be, or a few others take the rest."""
        node, refused = atom.node, None
        for taker in candidates:
            if taker.kind in ('any', 'nonnull'):
                return []
            if enumerated(taker.node) is not None:
                continue
            problems = self.limits(node, taker.node, 'string')
            # Those the taker excludes must be taken by another of its union, unless this string can't be them.
            for value in sorted(excluded(taker.node) - excluded(node)):
                if could_be(value, node) and not any(other is not taker and self.takes_value(value, other) for other in takers):
                    problems.append(((), self.words.value(value)))
            for part in required_too(taker.node):
                problems += self.fit({k: v for k, v in node.items() if k != 'allOf'}, part)
            if not problems:
                return []
            refused = refused or (taker, problems)
        if refused is None:
            values = [value for taker in candidates for value in enumerated(taker.node) or []]
            return [(path, self.words.wider(values))]
        taker, problems = refused
        return [(path + self.named(atom, taker) + where, why) for where, why in problems]

    def limits(self, sent, taken, kind):
        """Where a value of one atom can be past what another of its type takes: a length, a bound, a pattern."""
        problems = []
        unknown = {key for key in unread(taken) if sent.get(key) != taken[key]}
        if unknown:
            problems.append(((), self.cant_judge(Atom(kind, {key: taken[key] for key in unknown}, made=True))))
        if kind == 'string':
            if sent.get('minLength', 0) < taken.get('minLength', 0):
                problems.append(((), self.words.limit(f'shorter than {taken["minLength"]} characters')))
            if sent.get('maxLength', float('inf')) > taken.get('maxLength', float('inf')):
                problems.append(((), self.words.limit(f'longer than {taken["maxLength"]} characters')))
            if 'pattern' in taken and sent.get('pattern') != taken['pattern']:
                problems.append(((), self.words.limit(f'a string that doesn\'t match {taken["pattern"]}')))
        if kind in ('number', 'integer'):
            for side, below, at in (('minimum', 'below', 'at or below'), ('maximum', 'above', 'at or above')):
                bound, past = edge(taken, side), edge(sent, side)
                if bound is not None and not within(past, bound, side):
                    problems.append(((), self.words.limit(f'{at if bound[1] else below} {bound[0]}')))
        if kind == 'array':
            if sent.get('minItems', 0) < taken.get('minItems', 0):
                problems.append(((), self.words.limit(f'fewer than {taken["minItems"]} items')))
            if sent.get('maxItems', float('inf')) > taken.get('maxItems', float('inf')):
                problems.append(((), self.words.limit(f'more than {taken["maxItems"]} items')))
        return problems

    def fit_atom(self, atom, taker):
        """Whether one atom, not a literal, is taken by another: remembered by the pair, and a pair met again inside itself is taken."""
        key = None if atom.made or taker.made else (id(atom.node), id(taker.node))
        if key in self.judged:
            return self.judged[key]
        if key is not None and key in self.judging:
            return []
        if key is not None:
            self.judging.add(key)
        try:
            problems = self.judge_atom(atom, taker)
        finally:
            self.judging.discard(key)
        if key is not None:
            self.judged[key] = problems
        return problems

    def judge_atom(self, atom, taker):
        if taker.kind in ('any', 'nonnull'):
            return []
        sent, taken = atom.node, taker.node
        values = enumerated(taken)
        if values is not None:
            return [((), self.words.wider(values))]
        problems = self.limits(sent, taken, atom.kind)
        for part in required_too(taken):
            problems += self.fit({key: value for key, value in sent.items() if key != 'allOf'}, part)
        if atom.kind == 'array':
            problems += self.fit(sent.get('items', True), taken.get('items', True), (('items',),))
        if atom.kind == 'object':
            problems += self.judge_struct(sent, taken)
        return problems

    def tag(self, atom, candidates):
        """The field that tells this struct from the others of its union, and the values it may say there."""
        properties, required = atom.node.get('properties', {}), atom.node.get('required', [])
        found = []
        for field in sorted(required, key=lambda field: (field not in TAGS, TAGS.index(field) if field in TAGS else 0, field)):
            said = self.literals(properties.get(field), self.sends, sending=True)
            if said and any(self.literals(candidate.node.get('properties', {}).get(field), self.takes, sending=False) for candidate in candidates):
                found.append((field, said))
        return found[0] if found else (None, None)

    def literals(self, node, snapshot, sending):
        """The strings a field may be, where it may be only a few: None where it may be any."""
        if node is None:
            return None
        members = self.members(node, snapshot, sending)
        values = []
        for member in members:
            said = enumerated(member.node)
            if member.kind != 'string' or said is None:
                return None
            values += said
        return values or None

    def fit_struct(self, atom, candidates, path, union):
        """A struct sent: some struct of the union takes it, the one with its tag where it has one."""
        # A tag tells one of several apart, and a message then says which it means.
        several = union or sum(candidate.kind == 'object' for candidate in candidates) > 1
        key, said = self.tag(atom, candidates) if several else (None, None)
        if key is not None:
            matching, others = [], []
            for candidate in candidates:
                known = self.literals(candidate.node.get('properties', {}).get(key), self.takes, sending=False)
                if known is None:
                    others.append(candidate)
                elif set(said) <= set(known):
                    matching.append(candidate)
                elif set(said) & set(known):
                    others.append(candidate)
            for candidate in matching + others:
                if not self.fit_atom(atom, candidate):
                    return []
            if len(said) > 1:
                # Each value of its tag may be taken by a struct of its own: judge the struct as each.
                problems = []
                for value in said:
                    one = {**atom.node, 'properties': {**atom.node['properties'], key: {'type': 'string', 'enum': [value]}}}
                    problems += self.fit_struct(Atom('object', one, atom.name, made=True), candidates, path, True)
                return problems
            if not matching:
                return [(path, self.words.member(key, said[0]))]
            candidates = matching
        best = None
        for candidate in candidates:
            problems = self.fit_atom(atom, candidate)
            if not problems:
                return []
            if best is None or len(problems) < len(best[1]):
                best = (candidate, problems)
        taker, problems = best
        member = (('member', key, said[0]),) if key is not None else ()
        return [(path + member + self.named(atom, taker) + where, why) for where, why in problems]

    def judge_struct(self, sent, taken):
        """A struct sends its own fields alone; a record, any key with its values. The taker drops a key it doesn't know."""
        problems = []
        sends, needs = sent.get('properties'), set(taken.get('required', []))
        fields, spare = taken.get('properties', {}), taken.get('additionalProperties', True)
        own = sends or {}
        # A struct, with properties, sends no others unless it has an index; a record sends any key.
        index = sent.get('additionalProperties', True) if sends is None else (sent['additionalProperties'] if isinstance(sent.get('additionalProperties'), dict) else None)
        for field in sorted(needs - set(sent.get('required', []))):
            problems.append(((('field', field),), self.words.optional() if field in own else self.words.gone()))
        for field, node in sorted(own.items()):
            if field in fields:
                problems += self.fit(node, fields[field], (('field', field),))
            elif spare is False:
                problems.append(((('field', field),), self.words.extra()))
            elif isinstance(spare, dict):
                problems += self.fit(node, spare, (('field', field),))
        if index is not None:
            for field, node in sorted(fields.items()):
                if field not in own:
                    problems += self.fit(index, node, (('field', field),))
            if spare is False:
                problems.append(((('values',),), self.words.extra()))
            elif isinstance(spare, dict):
                problems += self.fit(index, spare, (('values',),))
        return problems


def edge(node, side):
    """A number's bound on one side, `minimum` or `maximum`, and whether it is exclusive: the tighter where it has both."""
    exclusive = 'exclusiveMinimum' if side == 'minimum' else 'exclusiveMaximum'
    bounds = [(node[key], key == exclusive) for key in (side, exclusive) if key in node]
    if not bounds:
        return None
    return max(bounds) if side == 'minimum' else min(bounds, key=lambda bound: (bound[0], not bound[1]))


def within(sent, taken, side):
    """Whether every number inside the bound `sent` is inside `taken`, on one side."""
    if sent is None:
        return False
    if sent[0] != taken[0]:
        return sent[0] > taken[0] if side == 'minimum' else sent[0] < taken[0]
    return sent[1] or not taken[1]


def could_be(value, node):
    """Whether a string sent by `node` could be `value`; what this check doesn't read is taken to allow it."""
    values = enumerated(node)
    if values is not None:
        return value in values
    if value in excluded(node) or len(value) < node.get('minLength', 0) or len(value) > node.get('maxLength', float('inf')):
        return False
    return 'pattern' not in node or matches(node['pattern'], value)


def matches(pattern, value):
    """Whether a value matches a schema's pattern, as JavaScript would; a pattern Python can't read matches nothing."""
    try:
        return re.search(pattern, value) is not None
    except re.error:
        return False


def where(path):
    """A path as a message says it: `items[kind=notice].content.role`, and the innermost definition it is in."""
    said, inner = '', None
    for step in path:
        if step[0] == 'field':
            said += f'.{step[1]}' if said else step[1]
        elif step[0] == 'items':
            said += '[]'
        elif step[0] == 'values':
            said += '[*]'
        elif step[0] == 'member':
            said = f'{said[:-1]}{step[1]}={step[2]}]' if said.endswith('[]') else f'{said}[{step[1]}={step[2]}]'
        elif step[0] == 'def':
            inner = step[1]
    return said, inner


def located(said, inner):
    return (f' at {said}' if said else '') + (f', in {inner}' if inner else '')


def check(before, after, walk_all=False):
    """What in `after` breaks a client built against `before`, by call: each problem names the call, where and why.

    `walk_all` judges what is alike in both too, as a test of the walk itself.
    """
    before, after = Snapshot(before), Snapshot(after)
    same = None if walk_all else unchanged(before, after)
    reading = Judge(after, before, Reading(), 'sends', same)
    calling = Judge(before, after, Calling(), 'takes', same)
    problems = []
    for rpc, was in sorted(before.rpcs.items()):
        now = after.rpcs.get(rpc)
        if now is None:
            problems.append(Problem(rpc, f'{rpc} is gone: an older desktop or phone can\'t make this call.'))
            continue
        if was.get('socket') and not now.get('socket'):
            problems.append(Problem(rpc, f'{rpc}: a socket can\'t make it now, and an older phone, which calls through one, can\'t make this call.'))
        streams = now.get('kind') == 'stream'
        if streams != (was.get('kind') == 'stream'):
            said = 'streams now, where it answered once' if streams else 'answers once now, where it streamed'
            problems.append(Problem(rpc, f'{rpc} {said}: an older desktop or phone fails to read its answer.'))
            continue
        seen = set()
        for path, why in calling.fit(was.get('payload', True), now.get('payload', True)):
            message = f'{rpc}: an older desktop or phone can\'t make this call. Its payload{located(*where(path))}: {why}.'
            if message not in seen:
                seen.add(message)
                problems.append(Problem(rpc, message))
        for part, said in (('success', 'each element of its stream' if streams else 'its answer'), ('error', 'its error')):
            for path, why in reading.fit(now.get(part, True), was.get(part, True)):
                message = f'{rpc}: an older desktop or phone fails to read {said}{located(*where(path))}: {why}.'
                if message not in seen:
                    seen.add(message)
                    problems.append(Problem(rpc, message))
    return problems


def calls(rpcs):
    """Calls as a message names them: three or fewer by name, more as two and how many others."""
    if len(rpcs) == 1:
        return rpcs[0]
    named, last = (rpcs[:-1], rpcs[-1]) if len(rpcs) <= 3 else (rpcs[:2], f'{len(rpcs) - 2} more calls')
    return f'{", ".join(named)} and {last}'


def grouped(problems):
    """Problems alike but for their call, as one: a break in a definition many calls share is said once, naming them."""
    alike = {}
    for problem in problems:
        lead = f'{problem.rpc}: '
        # A call gone, or one that streams now, is said of that call alone.
        said = problem.message[len(lead):] if problem.message.startswith(lead) else (problem.message, problem.rpc)
        alike.setdefault(said, []).append(problem.rpc)
    return [Problem(rpcs[0], said[0]) if isinstance(said, tuple) else Problem(rpcs[0] if len(rpcs) == 1 else f'{len(rpcs)} calls', f'{calls(rpcs)}: {said}')
            for said, rpcs in alike.items()]


def at(rev):
    """The snapshot at a git revision; None where it has none."""
    subprocess.run(['git', 'rev-parse', '--verify', '--quiet', f'{rev}^{{commit}}'], capture_output=True, check=True)
    shown = subprocess.run(['git', 'show', f'{rev}:{FILE}'], capture_output=True, text=True)
    return json.loads(shown.stdout) if shown.returncode == 0 else None


def read(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


ADVICE = ('An older desktop or phone can\'t survive this. Open a union in an answer first, in a release of its own, so the '
          'clients out there read the member when it comes; add a field to a payload as optional; keep a call, or a '
          'socket\'s right to make it, until no client needs it. Or, for a change no older client survives, raise '
          'API_VERSION in packages/contracts/src/Api.ts (docs/decisions/foundations.md, "Clients of another version").')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base')
    parser.add_argument('--before')
    parser.add_argument('--after', default=FILE)
    args = parser.parse_args()
    if args.before:
        before, base = read(args.before), args.before
    elif args.base:
        before, base = at(args.base), args.base
    else:
        parser.error('say what to compare with: --base REV or --before FILE')
    if before is None:
        print(f'{base} has no {FILE} yet: there is no wire to compare with, so nothing breaks.')
        return 0
    if not os.path.exists(args.after):
        print(f'::error file={FILE},title=The wire::{args.after} is gone: write it with `bun run snapshot` in packages/contracts.')
        return 1
    after = read(args.after)
    problems = grouped(check(before, after))
    was, now = before.get('apiVersion'), after.get('apiVersion')
    raised = isinstance(was, int) and isinstance(now, int) and now > was
    if isinstance(was, int) and isinstance(now, int) and now < was:
        print(f'::error file={FILE},title=API_VERSION::API_VERSION falls from {was} to {now} here: it only goes up.')
        return 1
    level = 'warning' if raised else 'error'
    for problem in problems:
        print(f'::{level} file={FILE},title={problem.rpc}::{problem.message}')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as handle:
            handle.write(summary(problems, was, now, raised))
    if not problems:
        print(f'No change to the wire breaks an older client (API_VERSION {now}).')
        return 0
    if raised:
        print(f'API_VERSION goes from {was} to {now} here, so an older client is refused rather than broken: these {len(problems)} breaks pass.')
        return 0
    print(f'{len(problems)} changes to the wire break an older client. {ADVICE}')
    return 1


def summary(problems, was, now, raised):
    lines = ['### The wire', '']
    if not problems:
        lines.append(f'No change breaks an older client (API_VERSION {now}).')
    elif raised:
        lines.append(f'API_VERSION goes from {was} to {now}, so these breaks pass:')
    else:
        lines.append(f'These break an older client. {ADVICE}')
    lines += [''] + [f'- {problem.message}' for problem in problems] + ['']
    return '\n'.join(lines)


if __name__ == '__main__':
    sys.exit(main())
