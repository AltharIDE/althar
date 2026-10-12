#!/bin/bash
# The X11 smoke test: runs the packaged app under a real X server and window
# manager and checks the window's chrome through the X11 protocol — its
# identity, its own buttons, moving, resizing, maximizing, closing. This is
# the Linux review matrix's X11 leg (see DEVELOPMENT); CI runs the
# end-to-end suite instead. Needs xdotool, xprop, wmctrl and a running desktop:
#
#   DISPLAY=:0 ALTHAR_BIN=/usr/bin/althar scripts/x11-smoke.sh
#
# ALTHAR_ARGS passes extra arguments to the app, e.g. --no-sandbox where the
# desktop runs as root, which Chromium's sandbox refuses.
set -u
export DISPLAY=${DISPLAY:-:0}
export XAUTHORITY=${XAUTHORITY:-$HOME/.Xauthority}
ALTHAR_BIN=${ALTHAR_BIN:-althar}
ALTHAR_ARGS=${ALTHAR_ARGS:-}

pass=0; fail=0
ok() { echo "PASS: $1"; pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }
geom() { xdotool getwindowgeometry --shell "$WIN"; }
state() { xprop -id "$WIN" _NET_WM_STATE 2>/dev/null; }
maximized() { state | grep -q MAXIMIZED; }
hidden() { state | grep -q HIDDEN; }
wait_for() { for i in $(seq 1 20); do "$1" && return 0; sleep 0.3; done; return 1; }
wait_until() { for i in $(seq 1 20); do "$1" || return 0; sleep 0.3; done; return 1; }

# The window the app has, or one started here.
WIN=$(xdotool search --onlyvisible --name '^Althar$' 2>/dev/null | head -n1)
if [ -z "$WIN" ]; then
  # shellcheck disable=SC2086
  setsid -f "$ALTHAR_BIN" $ALTHAR_ARGS >/tmp/althar-smoke.log 2>&1
  for i in $(seq 1 30); do
    WIN=$(xdotool search --onlyvisible --name '^Althar$' 2>/dev/null | head -n1)
    [ -n "$WIN" ] && break
    sleep 1
  done
fi
if [ -z "$WIN" ]; then
  bad "window opens"
  echo "RESULT: $pass passed, $fail failed"
  exit 1
fi
ok "window opens"
xdotool windowactivate --sync "$WIN" 2>/dev/null || true
sleep 1

cls=$(xprop -id "$WIN" WM_CLASS | sed 's/^[^=]*= //')
[ "$cls" = '"althar", "althar"' ] && ok "WM_CLASS is althar ($cls)" || bad "WM_CLASS is $cls"
name=$(xprop -id "$WIN" _NET_WM_NAME | sed 's/^[^=]*= //')
[ "$name" = '"Althar"' ] && ok "window is named Althar" || bad "window name is $name"
icon=$(xprop -id "$WIN" _NET_WM_ICON | grep -oE 'Icon \([0-9]+ x [0-9]+\)' | head -n1)
[ -n "$icon" ] && ok "window icon is set ($icon)" || bad "window icon missing"

# Resize by the bottom-right corner, in steps, the way a hand does: from clear of the screen's edge, drawing the corner inward.
xdotool windowmove "$WIN" 0 10
sleep 0.5
eval "$(geom)"
w0=$WIDTH; h0=$HEIGHT
xdotool mousemove $((X + WIDTH - 1)) $((Y + HEIGHT - 1)) mousedown 1
for i in 1 2 3 4 5 6; do xdotool mousemove_relative -- -8 -6; sleep 0.08; done
xdotool mouseup 1
sleep 1
eval "$(geom)"
if [ "$WIDTH" -lt "$w0" ] && [ "$HEIGHT" -lt "$h0" ]; then ok "corner drag resizes (${w0}x${h0} -> ${WIDTH}x${HEIGHT})"; else bad "corner drag resize (${w0}x${h0} -> ${WIDTH}x${HEIGHT})"; fi

# Move by the strip, in steps, as a hand does.
eval "$(geom)"
x0=$X; y0=$Y
xdotool mousemove $((X + 300)) $((Y + 20)) mousedown 1
for i in 1 2 3 4 5 6; do xdotool mousemove_relative 8 6; sleep 0.08; done
xdotool mouseup 1
sleep 1
eval "$(geom)"
if [ "$X" -ne "$x0" ] || [ "$Y" -ne "$y0" ]; then ok "strip drag moves ($x0,$y0 -> $X,$Y)"; else bad "strip drag move (still $X,$Y)"; fi

# Double-click the strip: maximized, and back.
eval "$(geom)"
xdotool mousemove $((X + 300)) $((Y + 20)) click --repeat 2 --delay 50 1
if wait_for maximized; then ok "double-click maximizes"; else bad "double-click maximizes"; fi
sleep 1
eval "$(geom)"
xdotool mousemove $((X + 300)) $((Y + 20)) click --repeat 2 --delay 50 1
if wait_until maximized; then ok "double-click restores"; else bad "double-click restores"; fi
sleep 1

# The strip's own buttons: maximize, then back; minimize; restore.
eval "$(geom)"
xdotool mousemove $((X + 64)) $((Y + 20)) click 1
if wait_for maximized; then ok "maximize button maximizes"; else bad "maximize button maximizes"; fi
sleep 1
eval "$(geom)"
xdotool mousemove $((X + 64)) $((Y + 20)) click 1
if wait_until maximized; then ok "maximize button restores"; else bad "maximize button restores"; fi
sleep 1

eval "$(geom)"
xdotool mousemove $((X + 43)) $((Y + 20)) click 1
if wait_for hidden; then ok "minimize button minimizes"; else bad "minimize button minimizes"; fi
wmctrl -ia "$WIN" 2>/dev/null || xdotool windowactivate "$WIN" 2>/dev/null
sleep 1

# Close: the window goes and the app with it.
eval "$(geom)"
xdotool mousemove $((X + 22)) $((Y + 20)) click 1
closed=1
for i in 1 2 3 4 5; do
  if ! xdotool search --onlyvisible --name '^Althar$' >/dev/null 2>&1; then closed=0; break; fi
  sleep 1
done
[ "$closed" = 0 ] && ok "close button closes the window" || bad "close button closes the window"
if pgrep -x althar >/dev/null; then bad "app exits with its last window"; else ok "app exits with its last window"; fi

echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
