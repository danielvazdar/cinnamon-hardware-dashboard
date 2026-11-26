const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../hw-dashboard@osobno/metrics.js');

const temp = (label, value) => ({label, value, type: 'temperature_core', unit: 'C'});

const ANSWERS = {
    cpu: {total: 23.4, cpucore: 14},
    mem: {percent: 18.4, used: 6110396416, total: 33244868608},
    gpu: [{gpu_id: 'nvidia0', name: 'NVIDIA GeForce RTX 3060', mem: 8.2, proc: 11, temperature: 48, fan_speed: 53}],
    sensors: [temp('Composite', 37), temp('Core 0', 42), temp('Package id 0', 54),
        {label: 'CPU Fan', type: 'fan_speed', value: 1200, unit: 'R'}],
    network: [
        {interface_name: 'enp3s0', bytes_recv_rate_per_sec: 1000, bytes_sent_rate_per_sec: 200},
        {interface_name: 'wlp0s20f3', bytes_recv_rate_per_sec: 500, bytes_sent_rate_per_sec: 0},
        {interface_name: 'tailscale0', bytes_recv_rate_per_sec: 9999, bytes_sent_rate_per_sec: 9999},
        {interface_name: 'veth12ab', bytes_recv_rate_per_sec: 9999, bytes_sent_rate_per_sec: 9999},
    ],
    fs: [
        {mnt_point: '/', fs_type: 'ext4', percent: 95.1, used: 250e9, size: 263e9},
        {mnt_point: '/boot/efi', fs_type: 'vfat', percent: 0.6, used: 1e6, size: 1e9},
        {mnt_point: '/snap/core24/1643', fs_type: 'squashfs', percent: 100, used: 1, size: 1},
    ],
    uptime: '1 day, 2:13:53',
    amps: [
        {name: 'Web-server', count: 1, countmin: 1},
        {name: 'Worker', count: 0, countmin: 2},
        {name: 'Ci-jobs', count: 3, countmin: null},
    ],
    system: {hostname: 'workstation', linux_distro: 'Linux Mint 22.3', os_name: 'Linux'},
};

test('a full Glances answer becomes one snapshot', () => {
    const snapshot = metrics.snapshotFrom(ANSWERS);
    assert.equal(snapshot.hostname, 'workstation');
    assert.equal(snapshot.uptime, '1d 2h');
    assert.equal(snapshot.cpuTemperature, 54);
    assert.equal(snapshot.nvmeTemperature, 37);
    assert.deepEqual(snapshot.gpu, {name: 'RTX 3060', percent: 11, temperature: 48, memoryPercent: 8.2, fanPercent: 53});
    assert.deepEqual(snapshot.fans, [{label: 'CPU Fan', rpm: 1200}]);
    assert.deepEqual(snapshot.disks.map(disk => disk.mount), ['/']);
    assert.deepEqual(snapshot.network, {down: 1500, up: 200});
});

test('warnings list what needs attention, worst first', () => {
    const labels = metrics.snapshotFrom(ANSWERS).warnings.map(w => `${w.severity}: ${w.label}`);
    assert.deepEqual(labels, ['critical: Disk / 95%', 'critical: worker down']);
});

test('services with a minimum are up/down; without one they are counters', () => {
    assert.deepEqual(metrics.services(ANSWERS.amps), [
        {name: 'web-server', kind: 'service', count: 1, up: true},
        {name: 'worker', kind: 'service', count: 0, up: false},
        {name: 'ci-jobs', kind: 'counter', count: 3},
    ]);
});

test('CPU temperature falls back to the hottest core', () => {
    assert.equal(metrics.cpuTemperature([temp('Core 0', 44), temp('Core 12', 61), temp('Ambient', 34)]), 61);
    assert.equal(metrics.cpuTemperature([temp('Ambient', 34)]), null);
});

test('an integrated GPU with no numbers is not shown', () => {
    assert.equal(metrics.gpu([{name: 'Intel Graphics', mem: null, proc: 0, temperature: null, fan_speed: null}]), null);
});

test('missing slow answers (first poll) still give a snapshot', () => {
    const {fs, uptime, amps, system, ...fastOnly} = ANSWERS;
    const snapshot = metrics.snapshotFrom(fastOnly);
    assert.deepEqual([snapshot.disks, snapshot.services, snapshot.uptime, snapshot.hostname], [[], [], '', '']);
});

test('severity follows the limits', () => {
    const limits = {warn: 80, critical: 90};
    assert.deepEqual([79, 80, 90, null].map(value => metrics.severityOf(value, limits)), ['ok', 'warn', 'critical', 'ok']);
    assert.equal(metrics.worstSeverity(['ok', 'critical', 'warn']), 'critical');
    assert.equal(metrics.worstSeverity([]), 'ok');
});

test('uptime and sizes read like a person would write them', () => {
    assert.deepEqual(['11:33:48', '0:04:10', '3 days, 4:05:00', 'garbage'].map(u => metrics.formatUptime(metrics.uptimeSeconds(u))),
        ['11h 33m', '4m', '3d 4h', '']);
    assert.deepEqual([0, 950, 1234, 1234567, 33244868608].map(b => metrics.formatBytes(b)),
        ['0 B', '950 B', '1.2 KB', '1.2 MB', '33.2 GB']);
    assert.equal(metrics.formatBytes(80000, '/s'), '80.0 KB/s');
});

test('history keeps the newest samples and never mutates the old list', () => {
    const before = [1, 2, 3];
    const after = metrics.appendSample(before, 4, 3);
    assert.deepEqual([before, after], [[1, 2, 3], [2, 3, 4]]);
});

test('a fan reported twice (readable name + driver name) shows once', () => {
    const fan = (label, value) => ({label, value, type: 'fan_speed', unit: 'R'});
    assert.deepEqual(metrics.fans([fan('CPU Fan', 2100), fan('dell_smm 0', 2100)]), [{label: 'CPU Fan', rpm: 2100}]);
    assert.deepEqual(metrics.fans([fan('nct6798 1', 900)]), [{label: 'nct6798 1', rpm: 900}]);
});

test('runner checks become a runner list: down, idle or running a job', () => {
    const amps = [
        {name: 'Runner-ci-web-1', count: 1, countmin: null},
        {name: 'Runner-ci-web-2', count: 2, countmin: null},
        {name: 'Runner-ci-docs', count: 0, countmin: null},
    ];
    assert.deepEqual(metrics.services(amps), [
        {name: 'ci-web-1', kind: 'runner', state: 'idle'},
        {name: 'ci-web-2', kind: 'runner', state: 'busy'},
        {name: 'ci-docs', kind: 'runner', state: 'down'},
    ]);
    const snapshot = metrics.snapshotFrom({...ANSWERS, fs: [], amps});
    assert.deepEqual(snapshot.warnings.map(w => w.label), ['runner ci-docs down']);
});
