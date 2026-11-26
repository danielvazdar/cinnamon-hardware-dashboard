// HUD pieces drawn with Cairo: a 270° ring gauge with tick marks and glow, and a frame with corner brackets.

const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const {hexToRgb} = require('./graph');

const START_ANGLE = 0.75 * Math.PI;
const SWEEP = 1.5 * Math.PI;
const TICK_COUNT = 30;
const MAJOR_TICK_EVERY = 5;
const GLOW_LAYERS = [[10, 0.07], [5, 0.16]];
const BRACKET_LENGTH = 16;
const BRACKET_WIDTH = 2;

function strokeArc(context, centre, radius, fromAngle, toAngle) {
    context.newPath();
    context.arc(centre[0], centre[1], radius, fromAngle, toAngle);
    context.stroke();
}

function paintTicks(context, centre, radius, fraction, [red, green, blue]) {
    context.setLineWidth(1);
    for (let index = 0; index <= TICK_COUNT; index++) {
        const angle = START_ANGLE + (SWEEP * index) / TICK_COUNT;
        const isMajor = index % MAJOR_TICK_EVERY === 0;
        const inner = radius;
        const outer = radius + (isMajor ? 5 : 3);
        context.setSourceRGBA(red, green, blue, index / TICK_COUNT <= fraction ? 0.75 : 0.18);
        context.newPath();
        context.moveTo(centre[0] + Math.cos(angle) * inner, centre[1] + Math.sin(angle) * inner);
        context.lineTo(centre[0] + Math.cos(angle) * outer, centre[1] + Math.sin(angle) * outer);
        context.stroke();
    }
}

function paintRing(area, fraction, color, thickness) {
    const context = area.get_context();
    const [width, height] = area.get_surface_size();
    const centre = [width / 2, height / 2];
    const radius = Math.min(width, height) / 2 - thickness / 2 - 8;
    const rgb = hexToRgb(color);
    const [red, green, blue] = rgb;
    const clamped = Math.max(0, Math.min(fraction, 1));

    paintTicks(context, centre, radius + thickness / 2 + 3, clamped, rgb);
    context.setLineCap(Cairo.LineCap.ROUND);
    context.setSourceRGBA(1, 1, 1, 0.07);
    context.setLineWidth(thickness);
    strokeArc(context, centre, radius, START_ANGLE, START_ANGLE + SWEEP);
    if (clamped > 0) {
        const end = START_ANGLE + SWEEP * clamped;
        for (const [extraWidth, alpha] of GLOW_LAYERS) {
            context.setSourceRGBA(red, green, blue, alpha);
            context.setLineWidth(thickness + extraWidth);
            strokeArc(context, centre, radius, START_ANGLE, end);
        }
        context.setSourceRGBA(red, green, blue, 1);
        context.setLineWidth(thickness);
        strokeArc(context, centre, radius, START_ANGLE, end);
    }
    context.$dispose();
}

// A ring gauge with the value in the middle. percent: 0-100; markup: Pango markup for the centre text.
function makeGauge({size, percent, color, markup, valueFontSize}) {
    const holder = new St.Widget({layout_manager: new Clutter.BinLayout(), style: `width: ${size}px; height: ${size}px;`});
    const ring = new St.DrawingArea({style: `width: ${size}px; height: ${size}px;`});
    const thickness = Math.max(4, Math.round(size * 0.065));
    ring.connect('repaint', () => paintRing(ring, (percent || 0) / 100, color, thickness));
    const value = new St.Label({style_class: 'hud-gauge-value', style: `font-size: ${valueFontSize}px;`,
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
    value.clutter_text.set_markup(markup);
    holder.add_child(ring);
    holder.add_child(value);
    return holder;
}

function paintBrackets(area, color) {
    const context = area.get_context();
    const [width, height] = area.get_surface_size();
    const [red, green, blue] = hexToRgb(color);
    const edge = BRACKET_WIDTH / 2;
    const corners = [
        [[edge, BRACKET_LENGTH], [edge, edge], [BRACKET_LENGTH, edge]],
        [[width - BRACKET_LENGTH, edge], [width - edge, edge], [width - edge, BRACKET_LENGTH]],
        [[edge, height - BRACKET_LENGTH], [edge, height - edge], [BRACKET_LENGTH, height - edge]],
        [[width - BRACKET_LENGTH, height - edge], [width - edge, height - edge], [width - edge, height - BRACKET_LENGTH]],
    ];
    context.setSourceRGBA(red, green, blue, 0.9);
    context.setLineWidth(BRACKET_WIDTH);
    for (const [start, corner, end] of corners) {
        context.newPath();
        context.moveTo(...start);
        context.lineTo(...corner);
        context.lineTo(...end);
        context.stroke();
    }
    context.$dispose();
}

// Wraps a panel in a fixed-size holder and draws HUD corner brackets over its corners.
function framed(content, {width, height, color}) {
    const holder = new St.Widget({layout_manager: new Clutter.BinLayout(), style: `width: ${width}px; height: ${height}px;`});
    content.x_expand = true;
    content.y_expand = true;
    const brackets = new St.DrawingArea({x_expand: true, y_expand: true});
    brackets.connect('repaint', () => paintBrackets(brackets, color));
    holder.add_child(content);
    holder.add_child(brackets);
    return holder;
}

module.exports = {makeGauge, framed};
