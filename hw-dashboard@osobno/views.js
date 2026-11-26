// Draws the dashboard in a control-room HUD style: a large panel for the first machine and a card
// for each other machine, each with ring gauges, a load graph and status lights.
// Drawing only; polling and state live in desklet.js.
// St quirks: St.BoxLayout ignores Clutter alignment (use box.add(actor, {...})); a `foreground` in
// label markup is overridden by the CSS colour, so coloured text is its own label with a style colour.

const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Metrics = require('./metrics');
const {makeGraph} = require('./graph');
const {makeGauge, framed} = require('./gauge');

const COLORS = {accent: '#00e5ff', gpu: '#b388ff', up: '#ffb74d', ok: '#3ddc97', warn: '#ffb300', critical: '#ff5370', offline: '#7d8b99'};
const SEVERITY_COLORS = {ok: COLORS.accent, warn: COLORS.warn, critical: COLORS.critical};
const NEVER_WARN = {warn: Infinity, critical: Infinity}; // a busy GPU is not a problem
const OFFLINE_OPACITY = 110;
const LIGHTS_PER_ROW = 3;
const RUNNERS_PER_ROW = 4;
const GRAPH_GAP = 18;
const CENTERED = {y_fill: false, y_align: St.Align.MIDDLE};
const CENTERED_X = {x_fill: false, x_align: St.Align.MIDDLE};
const EXPAND = {expand: true};

function escape(text) {
    return GLib.markup_escape_text(String(text), -1);
}

// A label from Pango markup. Only long free text (titles, warnings) may be shortened with "…".
function label(markup, styleClass, {color = null, ellipsize = false} = {}) {
    const actor = new St.Label({style_class: styleClass});
    if (color) // never pass an empty style: St logs a parser error for it
        actor.set_style(`color: ${color};`);
    actor.clutter_text.set_ellipsize(ellipsize ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE);
    actor.clutter_text.set_markup(markup);
    return actor;
}

function caption(text, color = null) {
    return label(escape(text.toUpperCase()), 'hud-caption', {color});
}

function row(spacing, children = []) {
    const box = new St.BoxLayout({style: `spacing: ${spacing}px;`});
    for (const [child, props] of children)
        box.add(child, props || CENTERED);
    return box;
}

function column(spacing) {
    return new St.BoxLayout({vertical: true, style: `spacing: ${spacing}px;`});
}

function spacer() {
    return [new St.Widget(), EXPAND];
}

// Several pieces of text in a row, each with its own colour: [{text, color}].
function coloredLine(parts, styleClass, spacing = 8) {
    return row(spacing, parts.filter(part => part.text).map(part => [label(escape(part.text), styleClass, {color: part.color})]));
}

function hostSeverity(host) {
    if (host.offline)
        return 'critical';
    if (!host.snapshot)
        return 'ok';
    return Metrics.worstSeverity(host.snapshot.warnings.map(w => w.severity));
}

function frameColor(host) {
    if (!host.snapshot && !host.offline)
        return COLORS.offline;
    return SEVERITY_COLORS[hostSeverity(host)];
}

function statusTag(host) {
    if (host.offline)
        return label(escape(host.lastSeen ? `OFFLINE · LAST SEEN ${host.lastSeen}` : 'OFFLINE'), 'hud-status', {color: COLORS.critical, ellipsize: true});
    if (!host.snapshot)
        return label('CONNECTING', 'hud-status', {color: COLORS.offline});
    const warnings = host.snapshot.warnings;
    if (!warnings.length)
        return label('● NOMINAL', 'hud-status', {color: COLORS.ok});
    const color = SEVERITY_COLORS[Metrics.worstSeverity(warnings.map(w => w.severity))];
    return label(escape(`▲ ${warnings.map(w => w.label).join(' · ').toUpperCase()}`), 'hud-status', {color, ellipsize: true});
}

function header(host, titleClass) {
    const uptime = host.snapshot && host.snapshot.uptime ? `UP ${host.snapshot.uptime.toUpperCase()}` : '';
    return row(12, [
        [label('▍', titleClass, {color: frameColor(host)})],
        [label(escape(host.name.toUpperCase()), titleClass)],
        spacer(), [statusTag(host)], [caption(uptime)],
    ]);
}

function temperaturePart(value, limits) {
    if (value === null)
        return {text: ''};
    return {text: `${value}°C`, color: SEVERITY_COLORS[Metrics.severityOf(value, limits)]};
}

// One gauge with its name and a detail line under it. detail: [{text, color}]
function gaugeBlock({name, percent, limits, detail, size, color = COLORS.accent}) {
    const severity = Metrics.severityOf(percent, limits);
    const block = column(3);
    block.add(makeGauge({size, percent, color: severity === 'ok' ? color : SEVERITY_COLORS[severity],
        markup: `${Math.round(percent)}<span size="small" fgalpha="60%">%</span>`,
        valueFontSize: Math.round(size * 0.25)}), CENTERED_X);
    block.add(caption(name), CENTERED_X);
    block.add(coloredLine(detail, 'hud-detail', 6), CENTERED_X);
    return block;
}

function fullestDisk(disks) {
    return disks.reduce((fullest, disk) => (!fullest || disk.percent > fullest.percent ? disk : fullest), null);
}

function gaugeRow(snapshot, size) {
    const disk = fullestDisk(snapshot.disks);
    const gpu = snapshot.gpu;
    const gauges = [
        gaugeBlock({name: 'cpu', percent: snapshot.cpuPercent, limits: Metrics.LIMITS.cpuPercent, size,
            detail: [temperaturePart(snapshot.cpuTemperature, Metrics.LIMITS.cpuTemperature),
                {text: snapshot.fans.length === 1 ? `fan ${snapshot.fans[0].rpm} rpm` : ''}]}),
        gpu && gaugeBlock({name: 'gpu', percent: gpu.percent, limits: NEVER_WARN, size, color: COLORS.gpu,
            detail: [temperaturePart(gpu.temperature, Metrics.LIMITS.gpuTemperature),
                {text: gpu.fanPercent !== null ? `fan ${gpu.fanPercent}%` : ''}]}),
        gaugeBlock({name: 'ram', percent: snapshot.ram.percent, limits: Metrics.LIMITS.ramPercent, size,
            detail: [{text: `${(snapshot.ram.usedBytes / 1e9).toFixed(1)}/${Metrics.formatBytes(snapshot.ram.totalBytes)}`}]}),
        disk && gaugeBlock({name: `disk ${disk.mount}`, percent: disk.percent, limits: Metrics.LIMITS.diskPercent, size,
            detail: [{text: `${Metrics.formatBytes(disk.sizeBytes - disk.usedBytes)} free`},
                temperaturePart(snapshot.nvmeTemperature, Metrics.LIMITS.cpuTemperature)]}),
    ].filter(Boolean);
    return row(0, gauges.map(gauge => [gauge, {expand: true, x_fill: false, x_align: St.Align.MIDDLE, y_fill: false}]));
}

function legend(name, color) {
    return row(6, [[label('■', 'hud-caption', {color})], [caption(name)]]);
}

// "LOAD · 10 MIN   ■ CPU ■ GPU      ↓ 1.2 MB/s ↑ 80 KB/s" over a CPU/GPU graph.
function loadStrip(host, width, graphHeight) {
    const snapshot = host.snapshot;
    const series = [{samples: host.history.cpu, color: COLORS.accent}];
    const legends = [[legend('cpu', COLORS.accent)]];
    if (snapshot.gpu) {
        series.push({samples: host.history.gpu, color: COLORS.gpu});
        legends.push([legend('gpu', COLORS.gpu)]);
    }
    const strip = column(6);
    strip.add_actor(row(14, [[caption('load · 10 min')], ...legends, spacer(), [networkRates(snapshot.network)]]));
    strip.add_actor(makeGraph({width, height: graphHeight, capacity: host.capacity, maximum: 100, series}));
    return strip;
}

function networkRates(network) {
    return coloredLine([
        {text: `↓ ${Metrics.formatBytes(network.down, '/s')}`, color: COLORS.accent},
        {text: `↑ ${Metrics.formatBytes(network.up, '/s')}`, color: COLORS.up},
    ], 'hud-detail', 14);
}

// One graph with its own caption line: "CPU ............ 10 MIN".
function graphColumn({name, rightSide, width, graphHeight, capacity, maximum, series}) {
    const box = column(6);
    box.add_actor(row(10, [[caption(name)], spacer(), [rightSide]]));
    box.add_actor(makeGraph({width, height: graphHeight, capacity, maximum, series}));
    return box;
}

// The big panel's graphs side by side: CPU, GPU (if any) and network, each on its own scale.
function splitGraphs(host, width, graphHeight, gap) {
    const {snapshot, history, capacity} = host;
    const graphs = [
        {name: 'cpu', rightSide: caption('10 min'), maximum: 100, series: [{samples: history.cpu, color: COLORS.accent}]},
        snapshot.gpu && {name: 'gpu', rightSide: caption('10 min'), maximum: 100, series: [{samples: history.gpu, color: COLORS.gpu}]},
        {name: 'network', rightSide: networkRates(snapshot.network), maximum: null,
            series: [{samples: history.down, color: COLORS.accent}, {samples: history.up, color: COLORS.up}]},
    ].filter(Boolean);
    const columnWidth = Math.floor((width - gap * (graphs.length - 1)) / graphs.length);
    return row(gap, graphs.map(graph => [graphColumn({...graph, width: columnWidth, graphHeight, capacity})]));
}

function statusLight(service) {
    if (service.kind === 'counter')
        return coloredLine([{text: service.name.toUpperCase()}, {text: String(service.count), color: COLORS.accent}], 'hud-detail', 6);
    return row(6, [[label('●', 'hud-detail', {color: service.up ? COLORS.ok : COLORS.critical})],
        [label(escape(service.name.toUpperCase()), 'hud-detail')]]);
}

// Runner names without the prefix they all share ("ci-evemos-1", "ci-kyuro" -> "evemos-1", "kyuro").
function shortRunnerNames(runners) {
    const names = runners.map(runner => runner.name);
    const shared = names.length > 1 && names.every(name => name.startsWith(names[0].split('-')[0] + '-'))
        ? names[0].split('-')[0].length + 1 : 0;
    return runners.map(runner => ({...runner, shortName: runner.name.slice(shared).toUpperCase()}));
}

// "RUNNERS 10/10 UP" (down ones in red), then "RUNNING ▶ EVEMOS-1 ▶ KYURO" or "no jobs".
function runnersBlock(runners) {
    const named = shortRunnerNames(runners);
    const down = named.filter(runner => runner.state === 'down');
    const busy = named.filter(runner => runner.state === 'busy');
    const box = column(6);
    box.add_actor(coloredLine([
        {text: 'RUNNERS'},
        {text: `${runners.length - down.length}/${runners.length} UP`, color: down.length ? COLORS.critical : COLORS.ok},
        ...down.map(runner => ({text: `${runner.shortName} DOWN`, color: COLORS.critical})),
    ], 'hud-detail', 10));
    const running = busy.length
        ? busy.map(runner => ({text: `▶ ${runner.shortName}`, color: COLORS.accent}))
        : [{text: 'no jobs', color: COLORS.offline}];
    for (let index = 0; index < running.length; index += RUNNERS_PER_ROW) {
        const lead = index === 0 ? [{text: 'RUNNING'}] : [{text: '       '}];
        box.add_actor(coloredLine([...lead, ...running.slice(index, index + RUNNERS_PER_ROW)], 'hud-detail', 10));
    }
    return box;
}

function statusLights(services, fans) {
    const lights = [
        ...services.filter(service => service.kind !== 'runner').map(statusLight),
        ...fans.map(fan => coloredLine([{text: fan.label.toUpperCase()}, {text: `${fan.rpm} rpm`, color: COLORS.accent}], 'hud-detail', 6)),
    ];
    const box = column(6);
    for (let index = 0; index < lights.length; index += LIGHTS_PER_ROW)
        box.add_actor(row(20, lights.slice(index, index + LIGHTS_PER_ROW).map(light => [light])));
    const runners = services.filter(service => service.kind === 'runner');
    if (runners.length)
        box.add_actor(runnersBlock(runners));
    return box;
}

function waitingBody(host) {
    return label(escape(host.error ? `no answer: ${host.error}` : 'waiting for the first answer'), 'hud-detail', {ellipsize: true});
}

// The panel body shared by the big panel (graphs side by side) and the cards (one combined graph).
function hostBody(host, sizes, {withLights, splitLoad}) {
    const body = column(sizes.spacing);
    body.add_actor(gaugeRow(host.snapshot, sizes.gaugeSize));
    body.add_actor(splitLoad
        ? splitGraphs(host, sizes.innerWidth, sizes.graphHeight, GRAPH_GAP)
        : loadStrip(host, sizes.innerWidth, sizes.graphHeight));
    if (withLights)
        body.add_actor(statusLights(host.snapshot.services, host.snapshot.fans.length > 1 ? host.snapshot.fans : []));
    if (host.offline)
        body.opacity = OFFLINE_OPACITY;
    return body;
}

function buildPanel(host, sizes, {styleClass, titleClass, withLights, splitLoad}) {
    const panel = new St.BoxLayout({vertical: true, style_class: `hud-panel ${styleClass} is-${hostSeverity(host)}`,
        style: `spacing: ${sizes.spacing}px;`});
    panel.add_actor(header(host, titleClass));
    panel.add(host.snapshot ? hostBody(host, sizes, {withLights, splitLoad}) : waitingBody(host), EXPAND);
    return framed(panel, {width: sizes.width, height: sizes.height, color: frameColor(host)});
}

// sizes: {width, height (outer), innerWidth, spacing, gaugeSize, graphHeight}
function buildMainPanel(host, sizes) {
    const hasLights = Boolean(host.snapshot && (host.snapshot.services.length || host.snapshot.fans.length > 1));
    return buildPanel(host, sizes, {styleClass: 'hud-main', titleClass: 'hud-title', withLights: hasLights, splitLoad: true});
}

function buildCard(host, sizes) {
    return buildPanel(host, sizes, {styleClass: 'hud-card', titleClass: 'hud-card-title', withLights: true, splitLoad: false});
}

module.exports = {buildMainPanel, buildCard};
