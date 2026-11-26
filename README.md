# Hardware dashboard desklet for Cinnamon

A desktop widget for Linux Mint (Cinnamon) that shows how this PC and your servers are doing:
CPU load and temperature, GPU load, temperature, fan and memory, RAM, disks, network, fans, uptime,
and whether the services you care about are running. Graphs cover the last 10 minutes.

A machine's panel turns amber or red when it runs hot, fills a disk or its memory, loses a service,
or stops answering, so trouble stands out from across the room.

The numbers come from [Glances](https://github.com/nicolargo/glances) (open source), running on each
machine as a small user service.

- The first machine in the list gets the big panel; every other machine gets a card.
- Limits (warn / critical): CPU and RAM 85 / 95 %, CPU 80 / 90 °C, GPU 80 / 87 °C, disk free space
  under 10 / 5 GB (by free space, not percent: a small partition can be full by design).

Tested on Cinnamon 6.6 with Glances 4.5.

## Install

**1. Glances on each machine** (no sudo needed):

```sh
git clone https://github.com/danielvazdar/cinnamon-hardware-dashboard.git
cd cinnamon-hardware-dashboard
agent/install.sh --bind 127.0.0.1                    # this PC
agent/install.sh --bind 100.64.0.5 --config hosts/server.conf   # a server, on its private address
```

Glances answers anyone who can reach that address and port, without a password. Bind it to
`127.0.0.1` or to a private network address (Tailscale, WireGuard, your LAN), never a public one.

**2. The widget** (on the PC):

```sh
./install.sh
```

Right-click the desktop → **Add Desklets** → **Hardware Dashboard**. Then right-click the widget →
**Configure** → **Machines** and add each one as a name and `http://<address>:61208`.

## Service checks

Copy `agent/glances.conf` to `hosts/<machine>.conf` (the `hosts/` folder stays out of git) and add a
section per service. Glances counts the processes whose name or command line matches `regex`:

```ini
[amp_web-server]
enable=true
regex=\/usr\/sbin\/nginx
refresh=10
countmin=1        # with a minimum: a green or red dot

[amp_ci-jobs]
enable=true
regex=Runner\.Worker
refresh=5         # no minimum: shows the count, e.g. "ci-jobs 2"
```

**CI runners:** name a check `runner-<name>` and match the runner's `Runner.Listener` and
`Runner.Worker`. The card then lists runners as up/down and names the ones running a job right now
(the worker only exists during a job):

```ini
[amp_runner-web-1]
enable=true
regex=^/home/runner/web-1/bin/Runner\.(Listener|Worker)
refresh=5
```

Run `agent/install.sh` again with `--config hosts/<machine>.conf` after a change.

## Development

```sh
node --test tests/*.test.js
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon \
  --method org.Cinnamon.ReloadXlet 'hw-dashboard@osobno' 'DESKLET'
```

`metrics.js` (turning Glances answers into numbers and warnings) is plain JavaScript, tested with Node.

## License

MIT
