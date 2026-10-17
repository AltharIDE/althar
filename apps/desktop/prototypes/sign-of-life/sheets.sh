#!/bin/sh
# Scrappy: the shots grouped onto sheets, in the order they are handed over. Run after shoot.mjs, outside the agent sandbox.
cd "$(dirname "$0")"
n() { case $1 in A) echo 'A · Dots';; B) echo 'B · Receipt';; C) echo 'C · Placeholder';; D) echo 'D · Althar’s mark';; E) echo 'E · Name at once';; esac; }
node sheet.mjs shots/sheet-today.png 2 'shots/today-coordinator.png|Today · the coordinator, 6s after Enter' 'shots/today-task.png|Today · a task, 6s after Enter'
set --; for d in A B C D E; do set -- "$@" "shots/n-$d.png|$(n $d) · 0.6s after Enter"; done; node sheet.mjs shots/sheet-start.png 3 "$@"
set --; for d in A B C D E; do set -- "$@" "shots/p-$d-before.png|$(n $d) · 4.8s, just before the first word" "shots/p-$d-after.png|$(n $d) · 5.5s, the first words"; done; node sheet.mjs shots/sheet-handoff.png 2 "$@"
set --; for d in A B C D E; do set -- "$@" "shots/p-$d-slow.png|$(n $d) · 34s, longer than usual" "shots/p-$d-fail.png|$(n $d) · 46s, the agent gave up"; done; node sheet.mjs shots/sheet-slow-fail.png 2 "$@"
node sheet.mjs shots/sheet-queued.png 3 'shots/q-T-queued.png|Today · sent while the lead works' 'shots/q-A-queued.png|A · the same: queued, no dots' 'shots/q-A-turned.png|A · the lead turned to it: dots, counted from then'
set --; for d in A C D E; do set -- "$@" "shots/r-$d.png|$(n $d) · reduced motion, 8s"; done; node sheet.mjs shots/sheet-reduced.png 2 "$@"
