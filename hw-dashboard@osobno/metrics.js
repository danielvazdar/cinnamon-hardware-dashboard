// Turns Glances API answers into what the dashboard draws, and judges what needs attention.
// Pure JavaScript (no GJS imports) so Node can test it.

const LIMITS = {
    cpuPercent: {warn: 85, critical: 95},
    ramPercent: {warn: 85, critical: 95},
    // Disks are judged by free space, not percent: a small partition can be 95% full by design,
    // and a big disk at 95% still has plenty left.
    diskFreeGigabytes: {warn: 10, critical: 5},
    cpuTemperature: {warn: 80, critical: 90},
    gpuTemperature: {warn: 80, critical: 87},
};
const SEVERITY_ORDER = ['ok', 'warn', 'critical'];
const CPU_PACKAGE_LABEL = /^(package id 0|tctl|tdie|cpu)$/i;
const CPU_CORE_LABEL = /^core \d+$/i;
const NVME_LABEL = /^composite$/i;
const VIRTUAL_INTERFACE = /^(lo|tailscale|docker|br-|veth|virbr|wg|zt|tun|tap)/;
const PSEUDO_FILESYSTEMS = new Set(['squashfs', 'tmpfs', 'devtmpfs', 'overlay', 'vfat', 'efivarfs']);
const HISTORY_SAMPLES = 300;

// What the desklet asks Glances for: fast every poll, slow every few polls.
// Glances only refreshes what is asked for. Its process list (behind the service and runner checks,
// "amps") is refreshed by the processcount plugin, so asking for amps without processcount freezes
// every check at its first count.
const PLUGINS = {
    fast: ['cpu', 'mem', 'gpu', 'network', 'sensors'],
    slow: ['processcount', 'amps', 'fs', 'uptime', 'system'],
};
const DRIVER_NAMED_SENSOR = /^[a-z0-9_]+ \d+$/; // e.g. "dell_smm 0": the same fan again, under the driver's name

function severityOf(value, limits) {
    if (value === null || value === undefined)
        return 'ok';
    if (value >= limits.critical)
        return 'critical';
    return value >= limits.warn ? 'warn' : 'ok';
}

function worstSeverity(severities) {
    return severities.reduce((worst, next) =>
        (SEVERITY_ORDER.indexOf(next) > SEVERITY_ORDER.indexOf(worst) ? next : worst), 'ok');
}

function temperatures(sensors) {
    return sensors.filter(sensor => sensor.type === 'temperature_core' && typeof sensor.value === 'number');
}

// The CPU package temperature, or the hottest core when the package isn't reported.
function cpuTemperature(sensors) {
    const temps = temperatures(sensors);
    const packageSensor = temps.find(sensor => CPU_PACKAGE_LABEL.test(sensor.label));
    if (packageSensor)
        return packageSensor.value;
    const cores = temps.filter(sensor => CPU_CORE_LABEL.test(sensor.label)).map(sensor => sensor.value);
    return cores.length ? Math.max(...cores) : null;
}

function nvmeTemperature(sensors) {
    const nvme = temperatures(sensors).find(sensor => NVME_LABEL.test(sensor.label));
    return nvme ? nvme.value : null;
}

// Fans by their readable names; driver-named duplicates are dropped when a readable one exists.
function fans(sensors) {
    const all = sensors.filter(sensor => sensor.type === 'fan_speed');
    const readable = all.filter(sensor => !DRIVER_NAMED_SENSOR.test(sensor.label));
    return (readable.length ? readable : all).map(sensor => ({label: sensor.label, rpm: sensor.value}));
}

// The first GPU that reports real numbers (integrated GPUs often report only nulls).
function gpu(gpus) {
    const real = gpus.find(card => card.temperature !== null || card.mem !== null);
    if (!real)
        return null;
    return {name: real.name.replace(/^NVIDIA GeForce /, ''), percent: real.proc, temperature: real.temperature,
        memoryPercent: real.mem, fanPercent: real.fan_speed};
}

function disks(filesystems) {
    return filesystems
        .filter(fs => !PSEUDO_FILESYSTEMS.has(fs.fs_type) && !fs.mnt_point.startsWith('/snap') && !fs.mnt_point.startsWith('/boot'))
        .map(fs => ({mount: fs.mnt_point, percent: fs.percent, usedBytes: fs.used, sizeBytes: fs.size}));
}

// Bytes per second across the physical network interfaces.
function networkRates(interfaces) {
    const physical = interfaces.filter(nic => !VIRTUAL_INTERFACE.test(nic.interface_name));
    const sum = field => physical.reduce((total, nic) => total + (nic[field] || 0), 0);
    return {down: sum('bytes_recv_rate_per_sec'), up: sum('bytes_sent_rate_per_sec')};
}

const RUNNER_PREFIX = 'runner-';

// A CI runner check counts its listener (idle) plus a worker process while it runs a job.
function runnerState(processCount) {
    if (processCount === 0)
        return 'down';
    return processCount === 1 ? 'idle' : 'busy';
}

// Glances AMPs: names starting with "runner-" are CI runners (down/idle/busy); otherwise, with a
// minimum count they are services (up/down), without one they are counters.
function services(amps) {
    return amps.map(amp => {
        const name = amp.name.toLowerCase();
        if (name.startsWith(RUNNER_PREFIX))
            return {name: name.slice(RUNNER_PREFIX.length), kind: 'runner', state: runnerState(amp.count)};
        if (amp.countmin === null || amp.countmin === undefined)
            return {name, kind: 'counter', count: amp.count};
        return {name, kind: 'service', count: amp.count, up: amp.count >= amp.countmin};
    });
}

// "1 day, 2:13:53" / "11:33:48" -> seconds
function uptimeSeconds(uptime) {
    const match = /^(?:(\d+) days?, )?(\d+):(\d+):(\d+)/.exec(uptime || '');
    if (!match)
        return null;
    const [, days = '0', hours, minutes, seconds] = match;
    return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

function formatUptime(seconds) {
    if (seconds === null)
        return '';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0)
        return `${days}d ${hours}h`;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatBytes(bytes, suffix = '') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit++;
    }
    const digits = value >= 100 || unit === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unit]}${suffix}`;
}

function freeGigabytes(disk) {
    return (disk.sizeBytes - disk.usedBytes) / 1e9;
}

function diskSeverity(disk) {
    const free = freeGigabytes(disk);
    if (free < LIMITS.diskFreeGigabytes.critical)
        return 'critical';
    return free < LIMITS.diskFreeGigabytes.warn ? 'warn' : 'ok';
}

// The disk closest to running out of space.
function tightestDisk(disks) {
    return disks.reduce((tightest, disk) => (!tightest || freeGigabytes(disk) < freeGigabytes(tightest) ? disk : tightest), null);
}

// Everything that is not "ok", worst first, as short labels for the card header.
function warnings(snapshot) {
    const found = [];
    const add = (label, severity) => {
        if (severity !== 'ok')
            found.push({label, severity});
    };
    add(`CPU ${Math.round(snapshot.cpuPercent)}%`, severityOf(snapshot.cpuPercent, LIMITS.cpuPercent));
    add(`CPU ${snapshot.cpuTemperature}°C`, severityOf(snapshot.cpuTemperature, LIMITS.cpuTemperature));
    add(`RAM ${Math.round(snapshot.ram.percent)}%`, severityOf(snapshot.ram.percent, LIMITS.ramPercent));
    if (snapshot.gpu)
        add(`GPU ${snapshot.gpu.temperature}°C`, severityOf(snapshot.gpu.temperature, LIMITS.gpuTemperature));
    for (const disk of snapshot.disks)
        add(`Disk ${disk.mount} ${freeGigabytes(disk).toFixed(1)} GB free`, diskSeverity(disk));
    for (const service of snapshot.services.filter(s => s.kind === 'service' && !s.up))
        add(`${service.name} down`, 'critical');
    for (const runner of snapshot.services.filter(s => s.kind === 'runner' && s.state === 'down'))
        add(`runner ${runner.name} down`, 'critical');
    return found.sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
}

// answers: {cpu, mem, gpu, network, sensors, fs, uptime, amps, system}; slow ones may be missing.
function snapshotFrom(answers) {
    const sensors = answers.sensors || [];
    const snapshot = {
        hostname: answers.system ? answers.system.hostname : '',
        system: answers.system ? answers.system.linux_distro || answers.system.os_name : '',
        uptime: formatUptime(uptimeSeconds(answers.uptime)),
        cpuPercent: answers.cpu.total,
        cpuCores: answers.cpu.cpucore,
        cpuTemperature: cpuTemperature(sensors),
        nvmeTemperature: nvmeTemperature(sensors),
        ram: {percent: answers.mem.percent, usedBytes: answers.mem.used, totalBytes: answers.mem.total},
        gpu: gpu(answers.gpu || []),
        fans: fans(sensors),
        disks: disks(answers.fs || []),
        network: networkRates(answers.network || []),
        services: services(answers.amps || []),
    };
    return {...snapshot, warnings: warnings(snapshot)};
}

function valuesOf(series) {
    return (series || []).map(([, value]) => Number(value) || 0);
}

// Adds lists that may differ in length, lined up on their newest values.
function sumAlignedFromEnd(lists) {
    const length = Math.max(0, ...lists.map(list => list.length));
    return Array.from({length}, (_, index) => lists.reduce((sum, list) => {
        const fromEnd = length - index;
        return sum + (fromEnd <= list.length ? list[list.length - fromEnd] : 0);
    }, 0));
}

// Seconds between Glances samples, read from a history series ([[isoTime, value], ...]).
function samplingSeconds(series, fallback = 2) {
    if (!series || series.length < 2)
        return fallback;
    const seconds = (Date.parse(series[1][0]) - Date.parse(series[0][0])) / 1000;
    return seconds > 0 ? seconds : fallback;
}

// Every `step`-th value counting back from the newest, then at most `capacity` of them.
function resample(values, step, capacity) {
    const picked = values.filter((_, index) => (values.length - 1 - index) % step === 0);
    return picked.slice(Math.max(0, picked.length - capacity));
}

// Glances' own history ({cpu, gpu, network} from /api/4/<plugin>/history) as graph samples, so graphs
// start full after a restart. CPU = user + system (Glances keeps no "total" history).
// step: our poll interval divided by Glances' sampling interval.
function historyFromGlances({cpu = {}, gpu = {}, network = {}}, step, capacity) {
    const procKey = Object.keys(gpu).find(key => key.endsWith('_proc'));
    const physical = Object.keys(network).filter(key => !VIRTUAL_INTERFACE.test(key));
    const rates = suffix => sumAlignedFromEnd(physical.filter(key => key.endsWith(suffix)).map(key => valuesOf(network[key])));
    return {
        cpu: resample(sumAlignedFromEnd([valuesOf(cpu.user), valuesOf(cpu.system)]), step, capacity),
        gpu: resample(procKey ? valuesOf(gpu[procKey]) : [], step, capacity),
        down: resample(rates('_bytes_recv_rate_per_sec'), step, capacity),
        up: resample(rates('_bytes_sent_rate_per_sec'), step, capacity),
    };
}

// A new list with the sample appended, keeping at most `capacity` samples.
function appendSample(samples, value, capacity = HISTORY_SAMPLES) {
    const next = [...samples, value];
    return next.length > capacity ? next.slice(next.length - capacity) : next;
}

module.exports = {PLUGINS, LIMITS, severityOf, diskSeverity, tightestDisk, worstSeverity, cpuTemperature, nvmeTemperature, fans, gpu, disks,
    networkRates, services, historyFromGlances, samplingSeconds, uptimeSeconds, formatUptime, formatBytes, warnings, snapshotFrom, appendSample};
