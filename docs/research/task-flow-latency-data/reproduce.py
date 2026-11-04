#!/usr/bin/env python3
"""Reproduce the task-flow investigation on a consistent PRIVATE SQLite backup.

Python standard library only. Reads SQLite with mode=ro and query_only=ON.
Writes redacted CSVs to a NEW directory; never writes the profile or raw data.
See ../task-flow-latency.md for source fields, public GitHub inputs and limits.
"""
import argparse
import csv
import json
import re
import sqlite3
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("snapshot", nargs="?", help="Consistent SQLite backup; opened mode=ro")
parser.add_argument("--out", type=Path, help="New directory for redacted exports")
parser.add_argument("--prs", type=Path, help="Public prs.csv containing url and merged_at; refresh for a new cohort")
parser.add_argument("--summarize", type=Path, help="Recompute medians from samples.csv")
args = parser.parse_args()
if args.summarize:
    metrics = {}
    with (args.summarize / "samples.csv").open() as f:
        for r in csv.DictReader(f):
            metrics.setdefault(r["metric"], []).append(float(r["seconds"]))
    for k, xs in metrics.items():
        print(f"{k}: n={len(xs)} median={statistics.median(xs):.3f}s worst={max(xs):.3f}s")
    raise SystemExit(0)
if not args.snapshot or not args.out or not args.prs:
    parser.error("extraction needs snapshot, --out and --prs")
DB = str(Path(args.snapshot).resolve())
OUT = args.out
OUT.mkdir(exist_ok=False)
with args.prs.open() as f:
    public_prs = {r["url"].rstrip('/'): r for r in csv.DictReader(f)}
c = sqlite3.connect(Path(DB).as_uri() + '?mode=ro', uri=True)
c.row_factory = sqlite3.Row
c.execute('pragma query_only=ON')
assert c.execute('pragma integrity_check').fetchone()[0] == 'ok'
def rows(q, args=()): return [dict(r) for r in c.execute(q, args)]
def sec(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() if s else None
def iso(s): return datetime.fromtimestamp(s, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def obj(s):
    try: return json.loads(s or '{}')
    except Exception: return {}
def merged(xs):
    out=[]
    for a,b in sorted((a,b) for a,b in xs if a is not None and b is not None and b>a):
        if out and a<=out[-1][1]: out[-1]=(out[-1][0],max(out[-1][1],b))
        else: out.append((a,b))
    return out
def length(xs): return sum(b-a for a,b in merged(xs))
def intersect(xs,ys): return merged([(max(a,x),min(b,y)) for a,b in xs for x,y in ys if min(b,y)>max(a,x)])

tasks=rows("select * from tasks where state='done' order by settled_at desc limit 20")
events=rows('select aggregate_id,type,occurred_at,payload from record_events order by sequence')
byid={}
for e in events: byid.setdefault(e['aggregate_id'],[]).append(e)
changes={r['aggregate_id']:r['last'] for r in rows("select aggregate_id,max(changed_at) last from change_log where aggregate_type='thread_item' group by aggregate_id")}
summaries=[]; phases=[]; samples=[]
missing_merge_times=0; ambiguous_queue_links=0
for t in tasks:
    tid=t['id']; a=sec(t['created_at']); b=sec(t['settled_at']); bound=[(a,b)]
    def keep(k,v):
        samples.append(dict(task=tid,metric=k,seconds=round(v,3)))
    def phase(kind,start,end,**extra):
        if not start: return
        phases.append(dict(task=tid,phase=kind,start=start,end=end or '',duration_s=round(sec(end)-sec(start),3) if end else '',**extra))
    plans=rows('select * from task_plans where task_id=? order by proposed_at',(tid,))
    attempts=rows('select a.*,n.node_key,n.iteration,n.type from node_attempts a join nodes n on n.id=a.node_id join workflow_executions e on e.id=n.execution_id join runs r on r.id=e.run_id where r.task_id=? order by a.admitted_at',(tid,))
    turns=rows('select d.* from turn_deliveries d join threads t on t.id=d.thread_id where t.task_id=? order by d.requested_at',(tid,))
    tools=rows("select ti.* from thread_items ti join threads t on t.id=ti.thread_id where t.task_id=? and ti.kind='tool_call'",(tid,))
    items=rows("select ti.kind,ti.content,ti.created_at from thread_items ti join threads t on t.id=ti.thread_id where t.task_id=? and ti.kind in ('setup','notice','arrival') order by ti.created_at",(tid,))
    workspaces=rows('select * from workspaces where task_id=?',(tid,))
    links=rows("select * from external_links where task_id=? and kind='change'",(tid,))
    obs=[]
    for l in links:
        obs.extend([dict(r,url=l['url']) for r in rows('select * from observations where subject_id=? order by observed_at',(l['id'],))])
    for p in plans:
        due=p['starts_at']
        for ev in byid.get(p['id'],[]):
            due=obj(ev['payload']).get('startsAt',due)
        phase('plan',p['proposed_at'],p['decided_at'],due=due)
        if p['decided_at']:
            keep('plan_proposed_to_decided',sec(p['decided_at'])-sec(p['proposed_at']))
            if p['starts_at']:keep('plan_due_to_decided',sec(p['decided_at'])-sec(p['starts_at']))
    startup=[]; waits=[]; turnints=[]; toolints=[]; heavyints=[]; setupints=[]; checkints=[]; human=[]
    for w in workspaces:
        ready=next((e['occurred_at'] for e in byid.get(w['id'],[]) if e['type']=='workspace.ready'),None)
        phase('worktree',w['created_at'],ready)
        if ready: keep('worktree_created_to_ready',sec(ready)-sec(w['created_at']))
    for x in items:
        o=obj(x['content'])
        if x['kind']=='setup' and o.get('ended',{}).get('at') and o.get('startedAt'):
            s,e=sec(o['startedAt']),sec(o['ended']['at']);setupints.append((s,e));keep('setup',e-s)
            phase('setup',o['startedAt'],o['ended']['at'])
    for x in attempts:
        phase(x['node_key']+':'+str(x['iteration']),x['admitted_at'],x['ended_at'],started=x['started_at'],state=x['state'],attempt=x['id'])
        if x['started_at']:
            s,e=sec(x['admitted_at']),sec(x['started_at']);waits.append((s,e));keep('attempt_admitted_to_started',e-s)
            if x['ended_at']:keep('step_'+x['node_key'],sec(x['ended_at'])-e)
    for x in attempts:
        ev = byid.get(x['id'], [])
        for i, event in enumerate(ev):
            if event['type'] == 'node_attempt.held':
                end = next((z['occurred_at'] for z in ev[i+1:] if z['type'] in (
                    'node_attempt.held', 'node_attempt.running', 'node_attempt.resumed',
                    'node_attempt.failed', 'node_attempt.cancelled', 'node_attempt.succeeded')), x['ended_at'])
                reason = obj(event['payload']).get('reason', 'unknown')
                phase('held_'+reason,event['occurred_at'],end,attempt=x['id'])
                if end: keep('held_'+reason, sec(end)-sec(event['occurred_at']))
    for x,y in zip(attempts,attempts[1:]):
        if x['ended_at']:
            gap=sec(y['admitted_at'])-sec(x['ended_at'])
            keep('adjacent_attempt_gap',gap)
            if 0<=gap<=60: keep('adjacent_gap_0_to_60',gap)
    for x in turns:
        if x['delivered_at'] and x['ended_at']:
            s,e=sec(x['delivered_at']),sec(x['ended_at']);turnints.append((s,e));keep('turn',e-s)
            keep('turn_requested_to_delivered',s-sec(x['requested_at']))
            phase('turn',x['delivered_at'],x['ended_at'],delivery=x['id'],attempt=x['node_attempt_id'])
    sessions=rows('select s.* from provider_sessions s join threads t on t.id=s.thread_id where t.task_id=?',(tid,))
    for s in sessions:
        ev=byid.get(s['id'],[])
        active=next((e['occurred_at'] for e in ev if e['type']=='provider_session.active'),None)
        if active:
            start=next((e['occurred_at'] for e in ev if e['type']=='provider_session.starting'),s['started_at'])
            startup.append((sec(start),sec(active)));keep('provider_startup',sec(active)-sec(start));keep('provider_startup_'+s['agent_id'],sec(active)-sec(start))
            phase('provider_startup',start,active,agent=s['agent_id'])
    for x in tools:
        o=obj(x['content']); end=changes.get(x['id'])
        if o.get('status') not in ['completed','failed'] or not end:continue
        interval=intersect([(sec(x['created_at']),sec(end))],turnints)
        toolints.extend(interval)
        raw=o.get('rawInput') or {};command=raw.get('command',raw.get('cmd','')) or ''
        if re.search(r'\b(?:vitest|playwright|test:e2e|bun (?:run )?(?:test|check|verify|build|install)|bunx (?:vp|tsc)|vp (?:check|test|build)|npm (?:run |ci|install))\b',command):
            heavyints.extend(interval)
    for ob in obs:
        o=obj(ob['payload']);phase('host_'+ob['kind'],ob['observed_at'],None,sha=o.get('sha'),url=ob['url'])
        if ob['kind']=='checks_running':
            end=next((z for z in obs if z['subject_id']==ob['subject_id'] and z['kind']=='checks' and obj(z['payload']).get('sha')==o.get('sha') and z['observed_at']>ob['observed_at']),None)
            if end:checkints.append((sec(ob['observed_at']),sec(end['observed_at'])))
        if ob['kind']=='checks_rerun':
            end=next((z for z in obs if z['subject_id']==ob['subject_id'] and z['kind']=='checks' and obj(z['payload']).get('sha')==o.get('sha') and z['observed_at']>ob['observed_at']),None)
            if end:keep('rerun_to_next_result',sec(end['observed_at'])-sec(ob['observed_at']))
    for x in rows('select * from attention_requests where task_id=?',(tid,)):
        if x['answered_at']:human.append((sec(x['created_at']),sec(x['answered_at'])))
        why=obj(x['payload']).get('why','') if x['kind']=='stuck' else ''
        phase('attention_'+x['kind']+('_'+why if why else ''),x['created_at'],x['answered_at'])
    # Disjoint wall-clock partition. Higher priority claims overlapping intervals first.
    categories=[('attention',human),('tools',toolints),('agent_other',turnints),('setup',setupints),('startup',startup),('admission',waits),('ci_observed',checkints),('unattributed',bound)]
    points=sorted(set([a,b]+[max(a,min(b,v)) for _,xs in categories for pair in xs for v in pair]))
    totals={k:0 for k,_ in categories}
    for left,right in zip(points,points[1:]):
        mid=(left+right)/2
        k=next(k for k,xs in categories if any(s<=mid<e for s,e in xs));totals[k]+=right-left
    assert abs(sum(totals.values())-(b-a))<.01
    pub=[x for x in attempts if x['node_key']=='publish' and x['state']=='succeeded' and x['ended_at']]
    firstpub=min((sec(x['ended_at']) for x in pub),default=None)
    firstturn=min((s for s,e in turnints),default=None)
    mergedobs=[sec(o['observed_at']) for o in obs if o['kind']=='merged']
    summary=dict(task=tid,created=t['created_at'],done=t['settled_at'],minutes=round((b-a)/60,2),turns=len(turns),attempts=len(attempts),urls=' '.join(l['url'] for l in links),first_turn=iso(firstturn) if firstturn else '',first_publish=iso(firstpub) if firstpub else '',merged_observed=iso(max(mergedobs)) if mergedobs else '',reruns=sum(o['kind']=='checks_rerun' for o in obs),heavy_tool_minutes=round(length(intersect(heavyints,bound))/60,2),**{k+'_minutes':round(v/60,2) for k,v in totals.items()})
    summaries.append(summary)
    keep('task_total',b-a);keep('task_tools',totals['tools']);keep('task_agent_other',totals['agent_other']);keep('task_ci_observed',totals['ci_observed']);keep('task_unattributed',totals['unattributed'])
    if firstpub is not None:keep('first_publish_to_done',b-firstpub)
    if firstturn is not None:keep('created_to_first_turn',firstturn-a)
    phase('task_lifetime',t['created_at'],t['settled_at'])
    keep('task_heavy_tools',length(intersect(heavyints,bound)))
    # Queue entry is a task-thread notice, NOT an observations row. Whitelist
    # the runtime-generated title shape; never export notice bodies.
    for item in items:
        if item['kind'] != 'notice': continue
        match = re.fullmatch(r'PR #(\d+) is in the merge queue for main\.', obj(item['content']).get('title',''))
        if not match: continue
        number = match[1]
        # PR numbers are repository-local. Recover the actual external link
        # from this task's observations rather than inventing a repository.
        urls={o['url'] for o in obs if o['url'].rstrip('/').endswith('/pull/'+number)}
        url=next(iter(urls)) if len(urls)==1 else ''
        phase('queue_entry_notice',item['created_at'],None,url=url)
        if not url:
            ambiguous_queue_links+=1
            continue
        green = [o for o in obs if o['kind']=='checks' and o['url']==url
                 and obj(o['payload']).get('outcome')=='passed' and o['observed_at']<item['created_at']]
        if green: keep('green_to_queue_notice',sec(item['created_at'])-sec(max(o['observed_at'] for o in green)))
    for item in items:
        if item['kind'] != 'notice': continue
        if re.fullmatch(r'PR #\d+ conflicts with main, in \d+ files?\.', obj(item['content']).get('title','')):
            phase('conflict_notice',item['created_at'],None)
            delivered=[d['delivered_at'] for d in turns if d['delivered_at'] and d['delivered_at']>item['created_at']]
            if delivered: keep('conflict_notice_to_next_turn',sec(min(delivered))-sec(item['created_at']))
    for ob in obs:
        if ob['kind']=='checks_told':
            failed=[z for z in obs if z['kind']=='checks' and z['subject_id']==ob['subject_id']
                    and obj(z['payload']).get('outcome')=='failed'
                    and obj(z['payload']).get('sha')==obj(ob['payload']).get('sha')
                    and z['observed_at']<ob['observed_at']]
            # First failure since the preceding notification on the same link/SHA.
            previous=[z['observed_at'] for z in obs if z['kind']=='checks_told' and z['subject_id']==ob['subject_id']
                      and obj(z['payload']).get('sha')==obj(ob['payload']).get('sha') and z['observed_at']<ob['observed_at']]
            failed=[z for z in failed if not previous or z['observed_at']>max(previous)]
            if failed: keep('first_failed_result_to_notification',sec(ob['observed_at'])-sec(min(z['observed_at'] for z in failed)))
        if ob['kind']=='merged':
            pr=public_prs.get(ob['url'].rstrip('/'))
            if pr and pr.get('merged_at'):
                keep('merge_detection_lag',sec(ob['observed_at'])-sec(pr['merged_at']))
            else:
                missing_merge_times+=1

# Only whitelisted fields leave memory. Profile IDs encode creation times, so
# replace them, not just the timestamp columns. Preserve elapsed durations;
# round each task-relative event position to a whole minute.
aliases = {t['id']: f"task-{i:02d}" for i,t in enumerate(tasks,1)}
origins = {t['id']: sec(t['created_at']) for t in tasks}
local_ids = {}
def alias(value):
    if not value: return ''
    if value not in local_ids: local_ids[value] = f"record-{len(local_ids)+1:04d}"
    return local_ids[value]
def offset(tid, value):
    return round((sec(value)-origins[tid])/60) if value else ''
def write(name, records, fields):
    with (OUT/name).open('w', newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,lineterminator="\n")
        w.writeheader();w.writerows(records)
source = {
    'plan': 'task_plans.proposed_at/decided_at; record_events.payload.startsAt',
    'worktree': 'workspaces.created_at; record_events[type=workspace.ready].occurred_at',
    'setup': 'thread_items[kind=setup].content.startedAt/ended.at',
    'turn': 'turn_deliveries.delivered_at/ended_at',
    'provider_startup': 'record_events[type=provider_session.starting/active].occurred_at',
    'task_lifetime': 'tasks.created_at/settled_at',
    'conflict_notice': 'thread_items[kind=notice].created_at; content.title matches runtime conflict notice',
    'queue_entry_notice': 'thread_items[kind=notice].created_at; content.title matches runtime merge-queue notice',
}
public_phases=[]
for p in phases:
    tid=p['task']; kind=p['phase']
    public_phases.append(dict(
        task=aliases[tid],phase=kind,
        start_offset_min=offset(tid,p['start']),end_offset_min=offset(tid,p['end']),
        due_offset_min=offset(tid,p.get('due')),started_offset_min=offset(tid,p.get('started')),
        duration_s=p['duration_s'],state=p.get('state',''),
        attempt=alias(p.get('attempt')),delivery=alias(p.get('delivery')),
        agent=p.get('agent',''),sha=p.get('sha','') or '',url=p.get('url',''),
        source=source.get(kind, 'observations.kind/observed_at' if kind.startswith('host_') else
                          'record_events[type=node_attempt.held/resumed/running/terminal].occurred_at' if kind.startswith('held_') else
                          'attention_requests.created_at/answered_at' if kind.startswith('attention_') else
                          'node_attempts.admitted_at/started_at/ended_at; nodes.node_key/iteration')))
public_tasks=[]
for s in summaries:
    tid=s['task']
    # Titles are omitted for ALL projects. Public PR links identify relevant
    # Althar work; unrelated projects retain only an anonymous cohort row.
    row={k:v for k,v in s.items() if k not in ('title','project','created','done','first_turn','first_publish','merged_observed')}
    row['task']=aliases[tid]
    for k in ('created','done','first_turn','first_publish','merged_observed'):
        row[k+'_offset_min']=offset(tid,s[k])
    public_tasks.append(row)
for s in samples: s['task']=aliases[s['task']]
write('tasks.csv',public_tasks,list(public_tasks[0]))
write('phases.csv',public_phases,list(public_phases[0]))
write('samples.csv',samples,['task','metric','seconds'])
if missing_merge_times:
    print(f"Warning: skipped {missing_merge_times} merge-detection lag samples without a matching URL and merge time in --prs; refresh prs.csv for this cohort. Other exports are complete.", file=sys.stderr)
if ambiguous_queue_links:
    print(f"Warning: {ambiguous_queue_links} queue notices have no unique matching external link; exported with a blank URL and omitted their green-to-queue samples.", file=sys.stderr)
print(f"Exported {len(public_tasks)} tasks, {len(public_phases)} phases, {len(samples)} duration samples; no profile titles, IDs or absolute timestamps.")
