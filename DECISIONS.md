# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-26 | Data from Glances 4 (REST API) on every machine, including this PC | Open source, one API for CPU, sensors, GPU, disks, network, process checks; little code of ours |
| 2026-11-26 | Glances as a per-user systemd service with linger | Installs without sudo on servers where sudo needs a password |
| 2026-11-26 | Bind Glances to 127.0.0.1 or a private VPN address; no auth | Read-only stats; the network boundary is the protection |
| 2026-11-26 | Services = Glances AMPs (process regex); `countmin` → up/down dot, none → counter | Same mechanism covers "service running" and "CI jobs running" |
| 2026-11-26 | Layout: first machine big panel with CPU/GPU/network graphs, others as cards with graphs | Owner's pick from three mock-ups |
| 2026-11-26 | Warn/critical limits as constants in metrics.js, not settings | One owner, sane defaults; add settings when someone needs different limits |
| 2026-11-26 | Rebuild the view each poll (2 s) instead of updating widgets in place | Measured ~4% of one core on a 14-core PC; simpler code wins until that matters |
| 2026-11-26 | Public repo, MIT; machine names, addresses and service checks stay in git-ignored `hosts/` | Owner asked for public with nothing personal |
| 2026-11-26 | Control-room HUD look (owner's pick over glass+rings and polish): ring gauges, corner brackets, JetBrains Mono, one load graph per machine | First version read as plain, hard to read and messy |
| 2026-11-26 | "Text size" setting (default 15 px); gauges take the height left after text | Theme default text was too small to read across the room |
| 2026-11-26 | Big panel: CPU, GPU and network graphs side by side, each on its own scale; cards keep one combined graph | Owner: one graph with three things in it was hard to read |
| 2026-11-26 | Rounded corners (frame 22 px, panels 14 px, graphs 8 px) with curved corner accents | Owner prefers rounded, like the calendar, over sharp HUD brackets |
| 2026-11-26 | CI runners: one check per runner named `runner-<name>`, counting its Listener + Worker (0 down, 1 idle, 2+ running a job); the card shows "N/N up" and which are running | Owner wants to see which runners run; one check per runner gives all three states |
| 2026-11-26 | A machine with exactly one fan shows it under the CPU gauge | Frees a line in the card for the runner list |
| 2026-11-26 | Disk warnings by free space (warn < 10 GB, critical < 5 GB), not percent | Owner: the PC's Linux partition is 95% full by design (Windows has the rest of the disk), 25 GB free is plenty |
| 2026-11-26 | Graphs show 30 minutes and start full from Glances' own history (`/api/4/<plugin>/history`, CPU = user + system) | Owner saw only a sliver of line: in-memory history restarted on every reload and 10 min scrolled by fast |
| 2026-11-26 | Always request `processcount` together with `amps` | Glances only refreshes what is asked for; without it every service/runner check froze at its first count (runner list showed finished jobs, a dead service would never turn red) |
| 2026-11-26 | Desklet ID `hw-dashboard@danielvazdar` (was `@osobno`) | The suffix is the author by Cinnamon convention; "osobno" meant nothing outside the owner's folder names |
| 2026-11-26 | Right-click menu opens at the mouse, clamped to the monitor (overrides the menu's `_calculatePosition`) | Cinnamon only checks for room on the right, then flips left without clamping: a full-width desklet pushed its menu off-screen |
| 2026-11-26 | Driver-named fans (e.g. `nct6799 1`) show as "Fan N"; at 0 rpm they are hidden as empty connectors; named fans show even at rest | Motherboard chips report every connector; listing empty ones at 0 rpm was noise |
| 2026-11-27 | Graphs show 10 minutes again (history still starts full from Glances) | Owner: 30 minutes was too long a window; trying 10 to see how it looks |
