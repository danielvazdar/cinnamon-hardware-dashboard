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
