// A live line graph drawn with Cairo: newest sample on the right, soft fill under each line.

const St = imports.gi.St;
const Cairo = imports.cairo;

const GRID_LINES = 3;
const LINE_WIDTH = 1.6;
const FILL_TOP_ALPHA = 0.32;
const FILL_BOTTOM_ALPHA = 0.02;
const AUTO_SCALE_HEADROOM = 1.15;

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

function drawGrid(context, width, height) {
    context.setSourceRGBA(1, 1, 1, 0.06);
    context.setLineWidth(1);
    for (let index = 1; index <= GRID_LINES; index++) {
        const y = Math.round((height * index) / (GRID_LINES + 1)) + 0.5;
        context.moveTo(0, y);
        context.lineTo(width, y);
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
    context.setSourceRGBA(red, green, blue, 0.95);
    context.setLineWidth(LINE_WIDTH);
    context.setLineJoin(Cairo.LineJoin.ROUND);
    context.stroke();
}

module.exports = {makeGraph};
