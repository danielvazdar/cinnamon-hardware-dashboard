// A live line graph drawn with Cairo in the HUD style: cyan grid, newest sample on the right,
// a soft glow and fill under each line.

const St = imports.gi.St;
const Cairo = imports.cairo;

const GRID_ROWS = 3;
const GRID_COLUMNS = 10;
const GRID_RGBA = [0, 0.9, 1, 0.08];
const LINE_WIDTH = 1.8;
const GLOW_WIDTH = 6;
const GLOW_ALPHA = 0.12;
const FILL_TOP_ALPHA = 0.32;
const FILL_BOTTOM_ALPHA = 0.02;
const AUTO_SCALE_HEADROOM = 1.15;
const CORNER_RADIUS = 8; // matches .hw-graph border-radius in stylesheet.css

function hexToRgb(hex) {
    const value = parseInt(hex.replace('#', ''), 16);
    return [(value >> 16) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

// series: [{samples: number[], color: '#rrggbb'}]; maximum: fixed top of the scale, or null to fit the data.
function makeGraph({width, height, series, capacity, maximum = null}) {
    const area = new St.DrawingArea({style_class: 'hw-graph', style: `width: ${width}px; height: ${height}px;`});
    area.connect('repaint', () => paint(area, series, capacity, maximum));
    return area;
}

function scaleTop(series, maximum) {
    if (maximum !== null)
        return maximum;
    const largest = Math.max(1, ...series.flatMap(line => line.samples));
    return largest * AUTO_SCALE_HEADROOM;
}

function paint(area, series, capacity, maximum) {
    const context = area.get_context();
    const [width, height] = area.get_surface_size();
    clipToRoundedRectangle(context, width, height, CORNER_RADIUS);
    drawGrid(context, width, height);
    const top = scaleTop(series, maximum);
    const step = width / Math.max(capacity - 1, 1);
    for (const line of series.filter(each => each.samples.length > 1)) {
        const offset = capacity - line.samples.length;
        const points = line.samples.map((value, index) => [
            (offset + index) * step,
            height - 1 - Math.min(value / top, 1) * (height - 2),
        ]);
        drawLine(context, points, height, hexToRgb(line.color));
    }
    context.$dispose();
}

function clipToRoundedRectangle(context, width, height, radius) {
    context.newPath();
    context.arc(width - radius, radius, radius, -Math.PI / 2, 0);
    context.arc(width - radius, height - radius, radius, 0, Math.PI / 2);
    context.arc(radius, height - radius, radius, Math.PI / 2, Math.PI);
    context.arc(radius, radius, radius, Math.PI, 1.5 * Math.PI);
    context.closePath();
    context.clip();
}

function drawGrid(context, width, height) {
    context.setSourceRGBA(...GRID_RGBA);
    context.setLineWidth(1);
    for (let index = 1; index <= GRID_ROWS; index++) {
        const y = Math.round((height * index) / (GRID_ROWS + 1)) + 0.5;
        context.moveTo(0, y);
        context.lineTo(width, y);
    }
    for (let index = 1; index < GRID_COLUMNS; index++) {
        const x = Math.round((width * index) / GRID_COLUMNS) + 0.5;
        context.moveTo(x, 0);
        context.lineTo(x, height);
    }
    context.stroke();
}

function tracePath(context, points) {
    context.moveTo(...points[0]);
    for (const point of points.slice(1))
        context.lineTo(...point);
}

function drawLine(context, points, height, [red, green, blue]) {
    const fill = new Cairo.LinearGradient(0, 0, 0, height);
    fill.addColorStopRGBA(0, red, green, blue, FILL_TOP_ALPHA);
    fill.addColorStopRGBA(1, red, green, blue, FILL_BOTTOM_ALPHA);
    context.moveTo(points[0][0], height);
    for (const point of points)
        context.lineTo(...point);
    context.lineTo(points[points.length - 1][0], height);
    context.closePath();
    context.setSource(fill);
    context.fill();

    tracePath(context, points);
    context.setSourceRGBA(red, green, blue, GLOW_ALPHA);
    context.setLineWidth(GLOW_WIDTH);
    context.setLineJoin(Cairo.LineJoin.ROUND);
    context.stroke();

    tracePath(context, points);
    context.setSourceRGBA(red, green, blue, 0.95);
    context.setLineWidth(LINE_WIDTH);
    context.setLineJoin(Cairo.LineJoin.ROUND);
    context.stroke();
}

module.exports = {makeGraph, hexToRgb};
