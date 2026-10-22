#!/bin/sh
# Scrappy: the shots grouped onto one sheet per direction, in shots.json's order, numbered and captioned. Run after shoot.mjs, outside the agent sandbox.
cd "$(dirname "$0")"
node sheet.mjs shots/sheet-ninemate.png 2 'Ninemate’s · as built: the Usage button and ⌘U view, the Talk room’s warnings; steering as a plain runtime line' --shots n-
node sheet.mjs shots/sheet-a.png 2 'A · A third gauge: PLAN beside CPU and MEM, its own peek a row per agent; a figure on every model' --shots a-
node sheet.mjs shots/sheet-b.png 2 'B · In the load meter: CPU · MEM · PLAN, one peek; steps and a figure on every model' --shots b-
node sheet.mjs shots/sheet-c.png 2 'C · Tightest first: a figure in the bar, the tightest limit big in the peek; models speak from half down' --shots c-
