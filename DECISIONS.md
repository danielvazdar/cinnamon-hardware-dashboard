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
