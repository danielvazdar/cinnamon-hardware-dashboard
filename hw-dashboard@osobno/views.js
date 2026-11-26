// Draws the dashboard: a large panel for the first machine and a card for each other machine.
// Drawing only; polling and state live in desklet.js. Cinnamon's St.BoxLayout ignores Clutter
// alignment, so alignment and stretching go through box.add(actor, {...}).

const St = imports.gi.St;
const Pango = imports.gi.Pango;
const Metrics = require('./metrics');
const {makeGraph} = require('./graph');

const SERIES_COLORS = {cpu: '#8ab4f8', gpu: '#81c995', down: '#78d9ec', up: '#f28b82'};
const SEVERITY_COLORS = {ok: '#81c995', warn: '#fdd663', critical: '#f28b82', offline: '#80868b'};
const OFFLINE_OPACITY = 110;
const SERVICES_PER_ROW = 3;
const CENTERED = {y_fill: false, y_align: St.Align.MIDDLE};
const EXPAND = {expand: true};

function label(text, styleClass, style = '') {
    const actor = new St.Label({text, style_class: styleClass});
    if (style) // an empty style string makes St log a parser error
        actor.set_style(style);
    actor.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    return actor;
}

function row(spacing, children = []) {
    const box = new St.BoxLayout({style: `spacing: ${spacing}px;`});
    for (const [child, props] of children)
        box.add(child, props || CENTERED);
    return box;
}

function column(spacing, width = null) {
    return new St.BoxLayout({vertical: true, style: `spacing: ${spacing}px;${width ? ` width: ${width}px;` : ''}`});
}

function severityColor(severity) {
    return SEVERITY_COLORS[severity];
}

function temperatureLabel(value, limits, styleClass) {
    if (value === null)
        return label('', styleClass);
    return label(`${value}°C`, styleClass, `color: ${severityColor(Metrics.severityOf(value, limits))};`);
}

// A thin progress bar coloured by how worrying the value is.
function bar(percent, width, limits) {
    const track = new St.BoxLayout({style_class: 'hw-bar', style: `width: ${width}px;`});
    const fillWidth = Math.max(2, Math.round((Math.min(percent, 100) / 100) * width));
    track.add_actor(new St.Widget({style_class: 'hw-bar-fill',
        style: `width: ${fillWidth}px; background-color: ${severityColor(Metrics.severityOf(percent, limits))};`}));
    return track;
}

// "RAM            6.1 / 33.2 GB" over a bar.
function barRow(name, detail, percent, width, limits) {
    const box = column(3, width);
    box.add_actor(row(6, [[label(name, 'hw-caption')], [new St.Widget(), EXPAND], [label(detail, 'hw-detail')]]));
    box.add_actor(bar(percent, width, limits));
    return box;
}

function diskRows(disks, width) {
    return disks.map(disk => barRow(`Disk ${disk.mount}`,
        `${Math.round(disk.percent)}% · ${Metrics.formatBytes(disk.sizeBytes - disk.usedBytes)} free`,
        disk.percent, width, Metrics.LIMITS.diskPercent));
}

function ramRow(ram, width) {
    return barRow('RAM', `${Metrics.formatBytes(ram.usedBytes)} / ${Metrics.formatBytes(ram.totalBytes)}`,
        ram.percent, width, Metrics.LIMITS.ramPercent);
}

function fansLine(fans) {
    if (!fans.length)
        return null;
    return label(fans.map(fan => `${fan.label} ${fan.rpm} rpm`).join(' · '), 'hw-detail');
}

function statusPill(host) {
    if (host.offline)
        return label(host.lastSeen ? `offline · last seen ${host.lastSeen}` : 'offline', 'hw-pill', `color: ${SEVERITY_COLORS.critical};`);
    if (!host.snapshot)
        return label('connecting…', 'hw-pill', `color: ${SEVERITY_COLORS.offline};`);
    const warnings = host.snapshot.warnings;
    if (!warnings.length)
        return label('All good', 'hw-pill', `color: ${SEVERITY_COLORS.ok};`);
    const severity = Metrics.worstSeverity(warnings.map(w => w.severity));
    return label(warnings.map(w => w.label).join(' · '), 'hw-pill', `color: ${severityColor(severity)};`);
}

function hostSeverity(host) {
    if (host.offline)
        return 'critical';
    if (!host.snapshot)
        return 'ok';
    return Metrics.worstSeverity(host.snapshot.warnings.map(w => w.severity));
}

function header(host, titleClass) {
    const snapshot = host.snapshot;
    const dot = new St.Widget({style_class: 'hw-dot',
        style: `background-color: ${host.offline || !host.snapshot ? SEVERITY_COLORS.offline : severityColor(hostSeverity(host))};`});
    return row(8, [
        [dot], [label(host.name, titleClass)], [label(snapshot ? snapshot.system : '', 'hw-detail')],
        [new St.Widget(), EXPAND], [statusPill(host)],
        [label(snapshot && snapshot.uptime ? `up ${snapshot.uptime}` : '', 'hw-detail')],
    ]);
}

// Big number with two small lines beside it: "23%  54°C / 14 cores".
function bigFigure(value, sideTop, sideBottom) {
    const side = column(0);
    side.add_actor(sideTop);
    side.add_actor(sideBottom);
    return row(10, [[label(`${Math.round(value)}%`, 'hw-big')], [side]]);
}

function cpuColumn(host, width, graphHeight) {
    const snapshot = host.snapshot;
    const box = column(6, width);
    box.add_actor(label('CPU', 'hw-caption'));
    box.add_actor(bigFigure(snapshot.cpuPercent,
        temperatureLabel(snapshot.cpuTemperature, Metrics.LIMITS.cpuTemperature, 'hw-temp'),
        label(`${snapshot.cpuCores} cores`, 'hw-detail')));
    box.add_actor(makeGraph({width, height: graphHeight, capacity: host.capacity, maximum: 100,
        series: [{samples: host.history.cpu, color: SERIES_COLORS.cpu}]}));
    return box;
}

function gpuColumn(host, width, graphHeight) {
    const gpu = host.snapshot.gpu;
    const box = column(6, width);
    box.add_actor(label(`GPU · ${gpu.name}`, 'hw-caption'));
    box.add_actor(bigFigure(gpu.percent,
        temperatureLabel(gpu.temperature, Metrics.LIMITS.gpuTemperature, 'hw-temp'),
        label(`fan ${gpu.fanPercent}% · VRAM ${Math.round(gpu.memoryPercent)}%`, 'hw-detail')));
    box.add_actor(makeGraph({width, height: graphHeight, capacity: host.capacity, maximum: 100,
        series: [{samples: host.history.gpu, color: SERIES_COLORS.gpu}]}));
    return box;
}

function networkBlock(host, width, graphHeight) {
    const {down, up} = host.snapshot.network;
    const box = column(4, width);
    box.add_actor(row(6, [[label('Network', 'hw-caption')], [new St.Widget(), EXPAND],
        [label(`↓ ${Metrics.formatBytes(down, '/s')}`, 'hw-detail', `color: ${SERIES_COLORS.down};`)],
        [label(`↑ ${Metrics.formatBytes(up, '/s')}`, 'hw-detail', `color: ${SERIES_COLORS.up};`)]]));
    box.add_actor(makeGraph({width, height: graphHeight, capacity: host.capacity,
        series: [{samples: host.history.down, color: SERIES_COLORS.down}, {samples: host.history.up, color: SERIES_COLORS.up}]}));
    return box;
}

function systemColumn(host, width, graphHeight) {
    const snapshot = host.snapshot;
    const box = column(8, width);
    box.add_actor(ramRow(snapshot.ram, width));
    for (const diskRow of diskRows(snapshot.disks, width))
        box.add_actor(diskRow);
    const extras = [snapshot.nvmeTemperature !== null ? `SSD ${snapshot.nvmeTemperature}°C` : null,
        ...snapshot.fans.map(fan => `${fan.label} ${fan.rpm} rpm`)].filter(Boolean);
    if (extras.length)
        box.add_actor(label(extras.join(' · '), 'hw-detail'));
    box.add(new St.Widget(), EXPAND);
    box.add_actor(networkBlock(host, width, graphHeight));
    return box;
}

function servicesBlock(services) {
    const box = column(4);
    for (let index = 0; index < services.length; index += SERVICES_PER_ROW) {
        const chips = services.slice(index, index + SERVICES_PER_ROW).map(service => {
            if (service.kind === 'counter')
                return [label(`${service.name} ${service.count}`, 'hw-chip hw-chip-counter')];
            const color = service.up ? SEVERITY_COLORS.ok : SEVERITY_COLORS.critical;
            return [label(`● ${service.name}`, 'hw-chip', `color: ${color};`)];
        });
        box.add_actor(row(6, chips));
    }
    return box;
}

function offlineBody(host) {
    return label(host.error ? `No answer: ${host.error}` : 'Waiting for the first answer…', 'hw-detail');
}

// sizes: {width, height, gap, graphHeight}
function buildMainPanel(host, sizes) {
    const panel = new St.BoxLayout({vertical: true, style_class: `hw-panel is-${hostSeverity(host)}`,
        style: `width: ${sizes.width}px; height: ${sizes.height}px; spacing: 10px;`});
    panel.add_actor(header(host, 'hw-title'));
    if (!host.snapshot) {
        panel.add_actor(offlineBody(host));
        return panel;
    }
    const columnWidth = Math.floor((sizes.width - 2 * sizes.gap) / 3);
    const columns = row(sizes.gap);
    columns.add(cpuColumn(host, columnWidth, sizes.graphHeight), {y_fill: true});
    if (host.snapshot.gpu)
        columns.add(gpuColumn(host, columnWidth, sizes.graphHeight), {y_fill: true});
    columns.add(systemColumn(host, columnWidth, Math.round(sizes.graphHeight * 0.45)), {y_fill: true});
    panel.add(columns, EXPAND);
    if (host.offline)
        columns.opacity = OFFLINE_OPACITY;
    return panel;
}

function cardTopRow(host, width, graphHeight) {
    const snapshot = host.snapshot;
    const figureWidth = Math.round(width * 0.36);
    const figure = column(0, figureWidth);
    figure.add_actor(label('CPU', 'hw-caption'));
    figure.add_actor(bigFigure(snapshot.cpuPercent,
        temperatureLabel(snapshot.cpuTemperature, Metrics.LIMITS.cpuTemperature, 'hw-temp'),
        label(`${snapshot.cpuCores} cores`, 'hw-detail')));
    const series = [{samples: host.history.cpu, color: SERIES_COLORS.cpu}];
    if (snapshot.gpu)
        series.push({samples: host.history.gpu, color: SERIES_COLORS.gpu});
    const graph = makeGraph({width: width - figureWidth - 10, height: graphHeight, capacity: host.capacity, maximum: 100, series});
    return row(10, [[figure], [graph]]);
}

function buildCard(host, sizes) {
    const card = new St.BoxLayout({vertical: true, style_class: `hw-card is-${hostSeverity(host)}`,
        style: `width: ${sizes.width}px; height: ${sizes.height}px; spacing: 8px;`});
    card.add_actor(header(host, 'hw-card-title'));
    if (!host.snapshot) {
        card.add_actor(offlineBody(host));
        return card;
    }
    const body = column(8);
    const snapshot = host.snapshot;
    body.add_actor(cardTopRow(host, sizes.width, sizes.graphHeight));
    body.add_actor(ramRow(snapshot.ram, sizes.width));
    if (snapshot.gpu) {
        body.add_actor(row(8, [[label(`GPU · ${snapshot.gpu.name}`, 'hw-caption')], [new St.Widget(), EXPAND],
            [label(`${Math.round(snapshot.gpu.percent)}%`, 'hw-detail')],
            [temperatureLabel(snapshot.gpu.temperature, Metrics.LIMITS.gpuTemperature, 'hw-detail')],
            [label(`fan ${snapshot.gpu.fanPercent}%`, 'hw-detail')]]));
    }
    for (const diskRow of diskRows(snapshot.disks, sizes.width))
        body.add_actor(diskRow);
    const fans = fansLine(snapshot.fans);
    if (fans)
        body.add_actor(fans);
    if (snapshot.services.length)
        body.add_actor(servicesBlock(snapshot.services));
    if (host.offline)
        body.opacity = OFFLINE_OPACITY;
    card.add(body, EXPAND);
    return card;
}

module.exports = {buildMainPanel, buildCard};
