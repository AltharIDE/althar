import copy
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('wire', '.github/scripts/wire.py')
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)

SCRIPT = os.path.abspath('.github/scripts/wire.py')
FOLDERS = []


def tearDownModule():
    for folder in FOLDERS:
        shutil.rmtree(folder, ignore_errors=True)


# Schemas as the snapshot has them (packages/contracts/scripts/apiSchema.ts), written small.
STRING = {'type': 'string'}
NULL = {'type': 'null'}
BOOLEAN = {'type': 'boolean'}
# Effect's number, which says the ones JSON can't as words.
NUMBER = {'anyOf': [{'type': 'number'}, {'enum': ['Infinity', '-Infinity', 'NaN'], 'type': 'string'}]}
INTEGER = {'maximum': 9007199254740991, 'minimum': -9007199254740991, 'type': 'integer'}
# An empty struct, as a call that takes nothing says its payload.
NOTHING = {'not': {'type': 'null'}}
ERROR = {'$ref': '#/$defs/ApiErrorEncoded'}


def maybe(schema):
    """A field that may be left out."""
    return ('optional', schema)


def struct(**fields):
    return {
        'additionalProperties': True,
        'properties': {name: field[1] if isinstance(field, tuple) else field for name, field in fields.items()},
        'required': [name for name, field in fields.items() if not isinstance(field, tuple)],
        'type': 'object',
    }


def literals(*values):
    return {'enum': list(values), 'type': 'string'}


def union(*members):
    return {'anyOf': list(members)}


def nullable(schema):
    return union(schema, NULL)


def array(items, **limits):
    return {'items': items, 'type': 'array', **limits}


def record(values):
    return {'additionalProperties': values, 'type': 'object'}


def ref(name):
    return {'$ref': f'#/$defs/{name}'}


def none_of(values):
    return {'allOf': [{'not': {'enum': list(values)}}], 'type': 'string'}


def open_literals(*values):
    """`OpenLiterals`: one a client doesn't know reads as its fallback."""
    return union(literals(*values), none_of(values))


def open_union(key, *members, defs=None):
    """`OpenUnion`: a struct whose `key` a client doesn't know reads as its fallback."""
    structs = [(defs or {})[member['$ref'].rsplit('/', 1)[-1]] if '$ref' in member else member for member in members]
    tags = [tag for member in structs for tag in member['properties'][key]['enum']]
    return union(*members, {'additionalProperties': True, 'properties': {key: none_of(tags)}, 'required': [key], 'type': 'object'})


def call(payload=NOTHING, success=STRING, error=ERROR, socket=True, kind='call', lane='immediate'):
    return {'error': error, 'kind': kind, 'lane': lane, 'payload': payload, 'socket': socket, 'success': success}


API_ERROR = struct(_tag=literals('ApiError'), reason=STRING, message=STRING, detail=maybe(nullable(STRING)))


def snapshot(version=1, defs=None, **rpcs):
    return {
        '$defs': {'ApiErrorEncoded': API_ERROR, **(defs or {})},
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        'apiVersion': version,
        'rpcs': rpcs,
    }


def breaks(before, after):
    return [problem.message for problem in wire.check(before, after)]


def answers(before, after, **defs):
    """A call whose answer is `before`, then `after`."""
    return breaks(snapshot(GetThing=call(success=before), defs=defs), snapshot(GetThing=call(success=after), defs=defs))


def payloads(before, after, **defs):
    """A call whose payload is `before`, then `after`."""
    return breaks(snapshot(SetThing=call(payload=before), defs=defs), snapshot(SetThing=call(payload=after), defs=defs))


READS = 'GetThing: an older desktop or phone fails to read its answer'
CALLS = "SetThing: an older desktop or phone can't make this call. Its payload"


# A thread's items, as #717 changed a notice's role from four to six: the break this check was made for.
AGENT_MESSAGE = struct(kind=literals('agent_message'), id=STRING, text=STRING)


def notice(role):
    return struct(kind=literals('notice'), id=STRING, content=struct(title=STRING, role=maybe(role)))


def thread(role):
    defs = {'NoticeItem': notice(role), 'AgentMessageItem': AGENT_MESSAGE}
    return snapshot(GetThread=call(payload=struct(threadId=STRING), success=struct(items=array(union(ref('NoticeItem'), ref('AgentMessageItem'))))), defs=defs)


ROLES = ('aside', 'relayed', 'folder', 'brought')


class Calls(unittest.TestCase):
    def test_refuses_a_call_removed(self):
        self.assertEqual(breaks(snapshot(GetThing=call(), GetOther=call()), snapshot(GetOther=call())),
                         ["GetThing is gone: an older desktop or phone can't make this call."])

    def test_lets_a_call_be_added(self):
        self.assertEqual(breaks(snapshot(GetThing=call()), snapshot(GetThing=call(), GetOther=call())), [])

    def test_refuses_a_call_a_socket_can_no_longer_make_and_lets_it_make_one_more(self):
        self.assertEqual(breaks(snapshot(GetThing=call(socket=True)), snapshot(GetThing=call(socket=False))),
                         ["GetThing: a socket can't make it now, and an older phone, which calls through one, can't make this call."])
        self.assertEqual(breaks(snapshot(GetThing=call(socket=False)), snapshot(GetThing=call(socket=True))), [])

    def test_refuses_a_call_that_streams_now_or_no_longer(self):
        self.assertEqual(breaks(snapshot(GetThing=call()), snapshot(GetThing=call(kind='stream'))),
                         ['GetThing streams now, where it answered once: an older desktop or phone fails to read its answer.'])
        self.assertEqual(breaks(snapshot(GetThing=call(kind='stream')), snapshot(GetThing=call())),
                         ['GetThing answers once now, where it streamed: an older desktop or phone fails to read its answer.'])

    def test_lets_a_call_change_its_lane(self):
        self.assertEqual(breaks(snapshot(GetThing=call()), snapshot(GetThing=call(lane='background'))), [])


class Payloads(unittest.TestCase):
    """What an older client sends, which a newer home must take."""

    def test_refuses_a_field_added_as_required(self):
        self.assertEqual(payloads(struct(id=STRING), struct(id=STRING, title=STRING)),
                         [f"{CALLS} at title: the home requires it now, and an older client doesn't send it."])

    def test_refuses_a_field_required_that_was_optional(self):
        self.assertEqual(payloads(struct(id=STRING, title=maybe(STRING)), struct(id=STRING, title=STRING)),
                         [f'{CALLS} at title: the home requires it now, and an older client may leave it out.'])

    def test_refuses_a_command_made_of_a_call(self):
        self.assertEqual(payloads(struct(id=STRING), struct(id=STRING, commandId=STRING)),
                         [f"{CALLS} at commandId: the home requires it now, and an older client doesn't send it."])

    def test_lets_a_field_be_added_as_optional_made_optional_or_dropped(self):
        self.assertEqual(payloads(struct(id=STRING), struct(id=STRING, title=maybe(STRING))), [])
        self.assertEqual(payloads(struct(id=STRING, title=STRING), struct(id=STRING, title=maybe(STRING))), [])
        # The home drops a key it doesn't know, as Effect's structs do.
        self.assertEqual(payloads(struct(id=STRING, title=STRING), struct(id=STRING)), [])

    def test_lets_a_payload_that_took_nothing_take_an_optional_field_but_not_a_required_one(self):
        self.assertEqual(payloads(NOTHING, struct(refresh=maybe(nullable(BOOLEAN)))), [])
        self.assertEqual(payloads(NOTHING, struct(projectId=STRING)),
                         [f"{CALLS} at projectId: the home requires it now, and an older client doesn't send it."])

    def test_refuses_a_payload_that_takes_fewer_values_and_lets_it_take_more(self):
        self.assertEqual(payloads(struct(mode=literals('fast', 'careful')), struct(mode=literals('careful'))),
                         [f'{CALLS} at mode: the home refuses "fast" now, which an older client may send.'])
        self.assertEqual(payloads(struct(mode=literals('careful')), struct(mode=literals('fast', 'careful'))), [])
        self.assertEqual(payloads(struct(mode=literals('careful')), struct(mode=STRING)), [])
        self.assertEqual(payloads(struct(mode=STRING), struct(mode=literals('careful'))),
                         [f'{CALLS} at mode: the home takes only "careful" now, where an older client sends any value.'])

    def test_refuses_a_union_of_structs_that_takes_fewer(self):
        fast, careful = struct(kind=literals('fast')), struct(kind=literals('careful'), why=STRING)
        self.assertEqual(payloads(struct(plan=union(fast, careful)), struct(plan=fast)),
                         [f'{CALLS} at plan: the home refuses a member whose kind is "careful" now, which an older client may send.'])

    def test_refuses_a_type_changed_and_lets_a_payload_take_null_too(self):
        self.assertEqual(payloads(struct(limit=INTEGER), struct(limit=STRING)),
                         [f'{CALLS} at limit: the home takes only a string now, where an older client sends a whole number.'])
        self.assertEqual(payloads(struct(limit=INTEGER), struct(limit=nullable(INTEGER))), [])
        self.assertEqual(payloads(struct(limit=nullable(INTEGER)), struct(limit=INTEGER)),
                         [f'{CALLS} at limit: the home takes only a whole number now, where an older client sends null.'])
        self.assertEqual(payloads(struct(limit=INTEGER), struct(limit=NUMBER)), [])

    def test_refuses_a_tighter_limit_and_lets_a_looser_one(self):
        self.assertEqual(payloads(struct(title={'maxLength': 200, 'type': 'string'}), struct(title={'maxLength': 100, 'type': 'string'})),
                         [f'{CALLS} at title: the home refuses longer than 100 characters now, which an older client may send.'])
        self.assertEqual(payloads(struct(title={'maxLength': 100, 'type': 'string'}), struct(title=STRING)), [])
        self.assertEqual(payloads(struct(limit={'maximum': 100, 'minimum': 1, 'type': 'integer'}), struct(limit={'maximum': 50, 'minimum': 1, 'type': 'integer'})),
                         [f'{CALLS} at limit: the home refuses above 50 now, which an older client may send.'])
        self.assertEqual(payloads(struct(ids=array(STRING)), struct(ids=array(STRING, maxItems=10))),
                         [f'{CALLS} at ids: the home refuses more than 10 items now, which an older client may send.'])
        self.assertEqual(payloads(struct(slug=STRING), struct(slug={'pattern': '^[a-z]+$', 'type': 'string'})),
                         [f"{CALLS} at slug: the home refuses a string that doesn't match ^[a-z]+$ now, which an older client may send."])


class Answers(unittest.TestCase):
    """What a newer home sends, as success, each element of a stream and error, which an older client must read."""

    def test_refuses_a_closed_union_with_a_new_member_as_a_notices_role_was(self):
        reads = "GetThread: an older desktop or phone fails to read its answer at items[kind=notice].content.role, in NoticeItem"
        self.assertEqual(breaks(thread(literals(*ROLES)), thread(literals(*ROLES, 'compacted', 'interrupted'))), [
            f"{reads}: \"compacted\" is new there, and the union it reads isn't open.",
            f"{reads}: \"interrupted\" is new there, and the union it reads isn't open.",
        ])

    def test_lets_an_open_union_have_a_new_member_and_be_opened(self):
        self.assertEqual(breaks(thread(open_literals(*ROLES)), thread(open_literals(*ROLES, 'compacted'))), [])
        self.assertEqual(breaks(thread(literals(*ROLES)), thread(open_literals(*ROLES))), [])
        self.assertEqual(breaks(thread(open_literals(*ROLES)), thread(literals(*ROLES))), [])

    def test_refuses_a_union_opened_and_added_to_at_once(self):
        self.assertEqual(breaks(thread(literals(*ROLES)), thread(open_literals(*ROLES, 'compacted'))), [
            'GetThread: an older desktop or phone fails to read its answer at items[kind=notice].content.role, in NoticeItem: '
            '"compacted" is new there, and the union it reads isn\'t open.',
        ])

    def test_refuses_a_closed_union_of_structs_with_a_new_member(self):
        task = struct(kind=literals('task'), taskId=STRING)
        self.assertEqual(answers(array(union(ref('NoticeItem'), ref('AgentMessageItem'))), array(union(ref('NoticeItem'), ref('AgentMessageItem'), task)),
                                 NoticeItem=notice(literals(*ROLES)), AgentMessageItem=AGENT_MESSAGE),
                         [f"{READS} at []: a member whose kind is \"task\" is new there, and the union it reads isn't open."])

    def test_lets_an_open_union_of_structs_a_known_list_and_a_known_one_have_a_new_member(self):
        defs = {'NoticeItem': notice(literals(*ROLES)), 'AgentMessageItem': AGENT_MESSAGE}
        task = struct(kind=literals('task'), taskId=STRING)
        known = [ref('NoticeItem'), ref('AgentMessageItem')]
        # OpenUnion; KnownArray, a list of one; KnownOrNull, one or null.
        for shape in (lambda *members: open_union('kind', *members, defs=defs),
                      lambda *members: array(open_union('kind', *members, defs=defs)),
                      lambda *members: nullable(open_union('kind', *members, defs=defs))):
            self.assertEqual(answers(shape(*known), shape(*known, task), **defs), [])

    def test_refuses_a_required_field_removed_made_optional_or_made_null(self):
        before = struct(id=STRING, title=STRING)
        self.assertEqual(answers(before, struct(id=STRING)), [f'{READS} at title: it is gone, and an older client needs it.'])
        self.assertEqual(answers(before, struct(id=STRING, title=maybe(STRING))), [f'{READS} at title: it can be left out now, and an older client needs it.'])
        self.assertEqual(answers(before, struct(id=STRING, title=nullable(STRING))), [f'{READS} at title: it can be null now, where it reads only a string.'])

    def test_refuses_a_field_whose_type_changed(self):
        self.assertEqual(answers(struct(count=INTEGER), struct(count=STRING)), [f'{READS} at count: it can be a string now, where it reads only a whole number.'])
        # Effect's number says what JSON can't as words, which a whole number doesn't take either.
        self.assertEqual(answers(struct(count=INTEGER), struct(count=NUMBER)), [
            f'{READS} at count: it can be a number now, where it reads only a whole number.',
            f'{READS} at count: it can be "Infinity" now, where it reads only a whole number.',
            f'{READS} at count: it can be "-Infinity" now, where it reads only a whole number.',
            f'{READS} at count: it can be "NaN" now, where it reads only a whole number.',
        ])
        self.assertEqual(answers(struct(count=NUMBER), struct(count=INTEGER)), [])

    def test_refuses_any_string_where_it_read_a_few(self):
        self.assertEqual(answers(struct(state=literals('open', 'done')), struct(state=STRING)),
                         [f'{READS} at state: it can be any value now, where it reads only "open" or "done".'])
        self.assertEqual(answers(struct(state=STRING), struct(state=literals('open', 'done'))), [])

    def test_refuses_a_looser_limit(self):
        self.assertEqual(answers(struct(title={'maxLength': 100, 'type': 'string'}), struct(title=STRING)),
                         [f'{READS} at title: it can be longer than 100 characters now, which an older client refuses.'])
        self.assertEqual(answers(struct(title=STRING), struct(title={'maxLength': 100, 'type': 'string'})), [])

    def test_lets_a_field_be_added_and_an_optional_one_dropped(self):
        self.assertEqual(answers(struct(id=STRING), struct(id=STRING, title=STRING, note=maybe(STRING))), [])
        self.assertEqual(answers(struct(id=STRING, note=maybe(STRING)), struct(id=STRING)), [])

    def test_lets_a_union_narrow(self):
        self.assertEqual(answers(struct(state=literals('open', 'done')), struct(state=literals('open'))), [])
        self.assertEqual(answers(struct(title=nullable(STRING)), struct(title=STRING)), [])
        self.assertEqual(answers(union(ref('NoticeItem'), ref('AgentMessageItem')), ref('AgentMessageItem'),
                                 NoticeItem=notice(literals(*ROLES)), AgentMessageItem=AGENT_MESSAGE), [])

    def test_tells_a_struct_by_each_value_of_its_tag(self):
        # Two structs merged into one that says either kind: each kind is still read as it was.
        message, thought = struct(kind=literals('agent_message'), text=STRING), struct(kind=literals('agent_thought'), text=STRING)
        self.assertEqual(answers(union(message, thought), struct(kind=literals('agent_message', 'agent_thought'), text=STRING)), [])
        self.assertEqual(answers(union(message, thought), struct(kind=literals('agent_message', 'agent_said'), text=STRING)),
                         [f'{READS}: a member whose kind is "agent_said" is new there, and the union it reads isn\'t open.'])

    def test_judges_each_element_of_a_stream_and_the_error(self):
        heard = lambda *tags: union(*(struct(_tag=literals(tag), at=STRING) for tag in tags))
        self.assertEqual(breaks(snapshot(Watch=call(kind='stream', success=heard('Changed'))), snapshot(Watch=call(kind='stream', success=heard('Changed', 'Moved')))),
                         ['Watch: an older desktop or phone fails to read each element of its stream: '
                          'a member whose _tag is "Moved" is new there, and the union it reads isn\'t open.'])
        closed = {'ApiErrorEncoded': struct(_tag=literals('ApiError'), reason=literals('NotFound'), message=STRING)}
        wider = {'ApiErrorEncoded': struct(_tag=literals('ApiError'), reason=literals('NotFound', 'Gone'), message=STRING)}
        self.assertEqual(breaks(snapshot(GetThing=call(), defs=closed), snapshot(GetThing=call(), defs=wider)),
                         ['GetThing: an older desktop or phone fails to read its error at reason, in ApiErrorEncoded: "Gone" is new there, and the union it reads isn\'t open.'])


class Definitions(unittest.TestCase):
    def test_reads_a_definition_by_its_shape_not_its_name(self):
        self.assertEqual(answers(ref('Thing'), ref('Renamed'), Thing=struct(id=STRING), Renamed=struct(id=STRING)), [])

    def test_judges_a_definition_that_refers_to_itself(self):
        tree = lambda leaf: {'Tree': struct(name=STRING, leaf=leaf, children=array(ref('Tree')))}
        self.assertEqual(answers(ref('Tree'), ref('Tree'), **tree(STRING)), [])
        self.assertEqual(breaks(snapshot(GetTree=call(success=ref('Tree')), defs=tree(STRING)), snapshot(GetTree=call(success=ref('Tree')), defs=tree(INTEGER))),
                         ['GetTree: an older desktop or phone fails to read its answer at leaf, in Tree: it can be a whole number now, where it reads only a string.'])

    def test_judges_a_records_values_and_a_lists_items(self):
        self.assertEqual(answers(struct(env=record(STRING)), struct(env=record(INTEGER))),
                         [f'{READS} at env[*]: it can be a whole number now, where it reads only a string.'])
        self.assertEqual(answers(struct(ids=array(STRING)), struct(ids=array(nullable(STRING)))),
                         [f'{READS} at ids[]: it can be null now, where it reads only a string.'])
        self.assertEqual(payloads(struct(env=record(STRING)), struct(env=record(nullable(STRING)))), [])

    def test_says_what_it_cant_judge(self):
        self.assertEqual(answers(struct(at={'format': 'date', 'type': 'string'}), struct(at=STRING)),
                         [f"{READS} at at: this check can't judge what format takes: compare it by hand, and teach .github/scripts/wire.py to read it."])
        self.assertEqual(answers(struct(at={'format': 'date', 'type': 'string'}), struct(at={'format': 'date', 'type': 'string'})), [])


class Output(unittest.TestCase):
    def test_says_a_break_that_calls_share_once_naming_them(self):
        problems = [wire.Problem(rpc, f'{rpc}: an older desktop or phone fails to read its error.') for rpc in ('A', 'B', 'C', 'D')]
        self.assertEqual(wire.grouped([*problems[:3], wire.Problem('E', 'E is gone.')]), [
            wire.Problem('3 calls', 'A, B and C: an older desktop or phone fails to read its error.'),
            wire.Problem('E', 'E is gone.'),
        ])
        self.assertEqual(wire.grouped(problems), [wire.Problem('4 calls', 'A, B and 2 more calls: an older desktop or phone fails to read its error.')])


class Contract(unittest.TestCase):
    def test_the_contracts_own_snapshot_fits_itself_walked_whole(self):
        with open(wire.FILE, encoding='utf-8') as handle:
            document = json.load(handle)
        self.assertEqual(wire.check(document, copy.deepcopy(document), walk_all=True), [])


class Run(unittest.TestCase):
    """The script as CI runs it, against main as a git revision."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        FOLDERS.append(self.root)
        self.git('init', '--quiet')

    def git(self, *args):
        subprocess.run(['git', '-c', 'user.name=CI', '-c', 'user.email=ci@example.com', *args], cwd=self.root, check=True, capture_output=True)

    def write(self, document):
        path = os.path.join(self.root, wire.FILE)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as handle:
            json.dump(document, handle)

    def run_script(self, *args):
        return subprocess.run([sys.executable, SCRIPT, *args], cwd=self.root, capture_output=True, text=True)

    def test_passes_where_main_has_no_snapshot(self):
        with open(os.path.join(self.root, 'README.md'), 'w', encoding='utf-8') as handle:
            handle.write('# Althar\n')
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'main')
        self.write(thread(literals(*ROLES)))
        passed = self.run_script('--base', 'HEAD')
        self.assertEqual(passed.returncode, 0)
        self.assertIn('HEAD has no packages/contracts/api.schema.json yet', passed.stdout)

    def test_refuses_a_break_against_main_unless_api_version_goes_up(self):
        self.write(thread(literals(*ROLES)))
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'main')
        self.assertEqual(self.run_script('--base', 'HEAD').returncode, 0)
        self.write(thread(literals(*ROLES, 'compacted')))
        refused = self.run_script('--base', 'HEAD')
        self.assertEqual(refused.returncode, 1)
        self.assertIn('::error file=packages/contracts/api.schema.json,title=GetThread::GetThread: an older desktop or phone fails to read its answer '
                      'at items[kind=notice].content.role, in NoticeItem: "compacted" is new there', refused.stdout)
        self.assertIn('raise API_VERSION', refused.stdout)
        raised = thread(literals(*ROLES, 'compacted'))
        raised['apiVersion'] = 2
        self.write(raised)
        passed = self.run_script('--base', 'HEAD')
        self.assertEqual(passed.returncode, 0)
        self.assertIn('::warning file=packages/contracts/api.schema.json,title=GetThread::', passed.stdout)
        self.assertIn('API_VERSION goes from 1 to 2 here', passed.stdout)

    def test_refuses_api_version_falling(self):
        higher = thread(literals(*ROLES))
        higher['apiVersion'] = 2
        before = os.path.join(self.root, 'before.json')
        with open(before, 'w', encoding='utf-8') as handle:
            json.dump(higher, handle)
        self.write(thread(literals(*ROLES)))
        fell = self.run_script('--before', before)
        self.assertEqual(fell.returncode, 1)
        self.assertIn('API_VERSION falls from 2 to 1 here: it only goes up.', fell.stdout)


if __name__ == '__main__':
    unittest.main()
