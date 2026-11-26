// Hardware dashboard desklet: polls Glances on each machine and draws a panel per machine.
// Data shaping lives in metrics.js, drawing in views.js and graph.js.

imports.gi.versions.Soup = '3.0';
const Main = imports.ui.main;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;
const Metrics = require('./metrics');
const Views = require('./views');

const UUID = 'hw-dashboard@osobno';
const FAST_PLUGINS = ['cpu', 'mem', 'gpu', 'network', 'sensors'];
const SLOW_PLUGINS = ['fs', 'uptime', 'amps', 'system'];
const SLOW_EVERY_TICKS = 8;
const FAILURES_BEFORE_OFFLINE = 2;
const REQUEST_TIMEOUT_SECONDS = 4;
const OUTER_PADDING = 18;
const ROOT_BORDER = 1;
const PANEL_INSET = 17; // .hud-panel padding 16 + border 1, see stylesheet.css
const GAP = 12;
const MAIN_PANEL_SHARE = 0.5;
const TEXT_LINE_FACTOR = 1.45;
const HEADER_LINE_FACTOR = 2.0;
const LIGHT_ROWS_RESERVED = 2;
const MAIN_GRAPH_HEIGHT = 64;
const CARD_GRAPH_HEIGHT = 40;
const HISTORY_SECONDS = 600;

function nowClock() {
    return GLib.DateTime.new_now_local().format('%H:%M');
}

// Cinnamon opens a desklet's menu beside the desklet; when the desklet fills the screen width the menu
// ends up off-screen. Open it where the user right-clicked instead, kept inside that monitor.
function openMenuAtPointer(menu) {
    menu._calculatePosition = function () {
        if (!this.actor.visible)
            this.box.show();
        const [pointerX, pointerY] = global.get_pointer();
        const [, , naturalWidth, naturalHeight] = this.actor.get_preferred_size();
        const monitor = Main.layoutManager.findMonitorForActor(this.sourceActor);
        const x = Math.min(Math.max(pointerX, monitor.x), monitor.x + monitor.width - naturalWidth);
        const y = Math.min(Math.max(pointerY, monitor.y), monitor.y + monitor.height - naturalHeight);
        return [Math.round(x), Math.round(y)];
    };
}

class HardwareDashboardDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        openMenuAtPointer(this._menu);
        this._session = new Soup.Session({timeout: REQUEST_TIMEOUT_SECONDS});
        this._cancellable = new Gio.Cancellable();
        this._timerId = 0;
        this._tick = 0;
        this._polling = false;
        this._hosts = [];

        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bind('width', 'widthPx', () => this._render());
        this.settings.bind('height', 'heightPx', () => this._render());
        this.settings.bind('glass-opacity', 'glassOpacity', () => this._render());
        this.settings.bind('font-size', 'fontSizePx', () => this._render());
        this.settings.bind('hosts', 'hostList', () => this._resetHosts());
        this.settings.bind('refresh-seconds', 'refreshSeconds', () => this._startTimer());

        this._root = new St.BoxLayout({vertical: true, style_class: 'hw-root'});
        this.setContent(this._root);
        this._resetHosts();
        this._startTimer();
    }

    // ------------------------------------------------------------ hosts + polling

    _capacity() {
        return Math.round(HISTORY_SECONDS / Math.max(1, this.refreshSeconds));
    }

    _resetHosts() {
        this._hosts = (this.hostList || []).filter(entry => entry.url).map(entry => ({
            name: entry.name || entry.url,
            url: entry.url.replace(/\/+$/, ''),
            snapshot: null, slowAnswers: {}, failures: 0, offline: false, lastSeen: null, error: null,
            history: {cpu: [], gpu: [], down: [], up: []},
            capacity: this._capacity(),
        }));
        this._tick = 0;
        this._render();
        this._poll();
    }

    _startTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(1, this.refreshSeconds), () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getJson(url) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.get_status()}`);
                    resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    async _fetchPlugins(host, plugins) {
        const answers = await Promise.all(plugins.map(plugin => this._getJson(`${host.url}/api/4/${plugin}`)));
        return Object.fromEntries(plugins.map((plugin, index) => [plugin, answers[index]]));
    }

    // One poll at a time: a slow machine must not let polls pile up and overwrite each other.
    async _poll() {
        if (this._polling)
            return;
        this._polling = true;
        try {
            const withSlow = this._tick % SLOW_EVERY_TICKS === 0;
            this._tick++;
            const hosts = this._hosts;
            const updated = await Promise.all(hosts.map(host => this._pollHost(host, withSlow)));
            if (this._removed || hosts !== this._hosts)
                return;
            this._hosts = updated;
            this._render();
        } finally {
            this._polling = false;
        }
    }

    // Returns the host's next state; never throws, a failed poll is part of the state.
    async _pollHost(host, withSlow) {
        try {
            const slowAnswers = withSlow || !host.snapshot
                ? {...host.slowAnswers, ...await this._fetchPlugins(host, SLOW_PLUGINS)} : host.slowAnswers;
            const fast = await this._fetchPlugins(host, FAST_PLUGINS);
            const snapshot = Metrics.snapshotFrom({...slowAnswers, ...fast});
            const append = (samples, value) => Metrics.appendSample(samples, value || 0, host.capacity);
            return {...host, snapshot, slowAnswers, failures: 0, offline: false, lastSeen: nowClock(), error: null,
                history: {
                    cpu: append(host.history.cpu, snapshot.cpuPercent),
                    gpu: append(host.history.gpu, snapshot.gpu ? snapshot.gpu.percent : 0),
                    down: append(host.history.down, snapshot.network.down),
                    up: append(host.history.up, snapshot.network.up),
                }};
        } catch (error) {
            const failures = host.failures + 1;
            if (failures === FAILURES_BEFORE_OFFLINE)
                global.logWarning(`${UUID}: ${host.name} stopped answering: ${error.message}`);
            return {...host, failures, offline: failures >= FAILURES_BEFORE_OFFLINE, error: error.message};
        }
    }

    // ------------------------------------------------------------ drawing

    // Outer and inner sizes for the big panel and the cards. Text lines are sized from the font size;
    // the gauges get whatever height is left, so bigger text means smaller gauges, never overflow.
    _sizes() {
        const fontSize = this.fontSizePx;
        const contentWidth = this.widthPx - 2 * (OUTER_PADDING + ROOT_BORDER);
        const contentHeight = this.heightPx - 2 * (OUTER_PADDING + ROOT_BORDER);
        const mainHeight = Math.round(contentHeight * MAIN_PANEL_SHARE);
        const cardCount = Math.max(1, this._hosts.length - 1);
        const cardWidth = Math.floor((contentWidth - GAP * (cardCount - 1)) / cardCount);
        const cardHeight = contentHeight - mainHeight - GAP;
        const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
        const line = Math.round(fontSize * TEXT_LINE_FACTOR);
        const header = Math.round(fontSize * HEADER_LINE_FACTOR);
        const underGauge = 2 * line + 6;
        const stripHeader = line + 6;
        const lights = LIGHT_ROWS_RESERVED * (line + 6);
        const main = {width: contentWidth, height: mainHeight, innerWidth: contentWidth - 2 * PANEL_INSET, spacing: 12,
            graphHeight: MAIN_GRAPH_HEIGHT};
        const card = {width: cardWidth, height: cardHeight, innerWidth: cardWidth - 2 * PANEL_INSET, spacing: 10,
            graphHeight: CARD_GRAPH_HEIGHT};
        main.gaugeSize = clamp(mainHeight - 2 * PANEL_INSET - header - 2 * main.spacing - underGauge - stripHeader
            - main.graphHeight, 60, 150);
        card.gaugeSize = clamp(cardHeight - 2 * PANEL_INSET - header - 3 * card.spacing - underGauge - stripHeader
            - card.graphHeight - lights, 50, 120);
        return {contentWidth, contentHeight, main, card};
    }

    _render() {
        const sizes = this._sizes();
        const alpha = this.glassOpacity;
        this._root.set_style(`width: ${sizes.contentWidth}px; height: ${sizes.contentHeight}px; font-size: ${this.fontSizePx}px;`
            + ` padding: ${OUTER_PADDING}px; spacing: ${GAP}px;`
            + ` background-gradient-start: rgba(6, 14, 24, ${alpha});`
            + ` background-gradient-end: rgba(2, 5, 10, ${Math.min(alpha + 0.1, 1)});`);
        this._root.destroy_all_children();
        if (!this._hosts.length) {
            this._root.add_actor(new St.Label({text: 'Add a machine in this desklet\'s settings.', style_class: 'hw-detail'}));
            return;
        }
        const [main, ...others] = this._hosts;
        this._root.add_actor(Views.buildMainPanel(main, sizes.main));
        const cards = new St.BoxLayout({style: `spacing: ${GAP}px;`});
        for (const host of others)
            cards.add_actor(Views.buildCard(host, sizes.card));
        this._root.add_actor(cards);
    }

    on_desklet_removed() {
        this._removed = true;
        this._cancellable.cancel();
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this.settings.finalize();
    }
}

function main(metadata, deskletId) {
    return new HardwareDashboardDesklet(metadata, deskletId);
}
