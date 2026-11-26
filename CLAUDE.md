# hw-dashboard

Cinnamon desklet: live hardware dashboard (this PC + servers) fed by Glances. Public repo
`danielvazdar/cinnamon-hardware-dashboard`. Nothing personal in git: machine names, addresses and
service checks live in `hosts/` (git-ignored). **Deployment notes: `hosts/NOTES.md`.**

## Map
| Path | What |
|---|---|
| `hw-dashboard@danielvazdar/desklet.js` | settings, polling Glances over HTTP (Soup 3), host state, render |
| `hw-dashboard@danielvazdar/metrics.js` | pure: Glances JSON → snapshot, limits, warnings, history; tested with Node |
| `hw-dashboard@danielvazdar/views.js` | St widgets: big panel (first machine) and cards (others) |
| `hw-dashboard@danielvazdar/graph.js` | Cairo line graphs (HUD grid + glow) |
| `hw-dashboard@danielvazdar/gauge.js` | Cairo ring gauges and corner-bracket frames |
| `agent/install.sh` | installs pinned Glances in `agent/.venv` as user service `glances-dashboard` (linger, no sudo) |
| `agent/glances.conf` | default Glances config; copy to `hosts/<machine>.conf` for service checks (AMPs) |
| `install.sh` | symlinks the desklet into `~/.local/share/cinnamon/desklets/` |

## Commands
- Tests: `node --test tests/*.test.js && shellcheck install.sh agent/install.sh`
- Reload: `gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon --method org.Cinnamon.ReloadXlet 'hw-dashboard@danielvazdar' 'DESKLET'`
- Glances on a machine: `systemctl --user status glances-dashboard`; API `curl http://<bind>:61208/api/4/cpu`
- Logs: `~/.xsession-errors` (grep `hw-dashboard`, `St-CRITICAL`)
- After editing `stylesheet.css`: ReloadXlet is NOT enough (St keeps the parsed sheet). Run Eval
  `imports.ui.main.themeManager._changeTheme()` then reload.

## Hard constraints
- Same St quirks as the calendar desklet (content-box sizes, no CSS opacity, `box.add(actor, props)`
  for alignment). Never pass `style: ''` to an St widget: it logs a parser error every render.
- A `foreground` span in label markup is overridden by the CSS colour: coloured text = its own label
  with a style colour. Pango `letter_spacing` breaks ClutterText's width → labels get cut; don't use it.
- Glances has no auth here: bind to 127.0.0.1 or a private VPN address only.
- Keep `GLANCES_VERSION` pinned in `agent/install.sh`; the API shape is version 4.
- Decisions → `DECISIONS.md`.
