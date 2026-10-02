import { defineHTMLComponent, projectIsometric, type Point3 } from "../../engine/ui/final/index";
export const TERMINAL_CAMERA = { origin: { x: 585, y: 225 }, zoom: 1 };
const p = (x: number, y: number, z = 0) => projectIsometric({ x, y, z }, TERMINAL_CAMERA);
const xy = (point: Point3) => { const v = p(point.x, point.y, point.z); return `${v.x.toFixed(2)},${v.y.toFixed(2)}`; };
const polygon = (points: Point3[], fill: string, stroke = "none") => `<polygon points="${points.map(xy).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round"/>`;
const rect = (x: number, y: number, w: number, d: number, z: number, fill: string, stroke?: string) => polygon([{ x, y, z }, { x: x + w, y, z }, { x: x + w, y: y + d, z }, { x, y: y + d, z }], fill, stroke);
const line = (a: Point3, b: Point3, color: string, width = 1) => `<line x1="${p(a.x, a.y, a.z).x}" y1="${p(a.x, a.y, a.z).y}" x2="${p(b.x, b.y, b.z).x}" y2="${p(b.x, b.y, b.z).y}" stroke="${color}" stroke-width="${width}"/>`;
function box(x: number, y: number, w: number, d: number, h: number, top: string, left: string, right: string, z = 0): string {
    return polygon([{ x, y: y + d, z }, { x: x + w, y: y + d, z }, { x: x + w, y: y + d, z: z + h }, { x, y: y + d, z: z + h }], left) +
        polygon([{ x: x + w, y, z }, { x: x + w, y: y + d, z }, { x: x + w, y: y + d, z: z + h }, { x: x + w, y, z: z + h }], right) + rect(x, y, w, d, z + h, top);
}
function plant(x: number, y: number): string {
    const at = p(x, y);
    return `<g><ellipse cx="${at.x + 3}" cy="${at.y + 2}" rx="24" ry="12" fill="#2a695b" opacity=".13"/><path d="M${at.x - 16},${at.y - 21}l4,26q12,9 24,0l4,-26z" fill="#d4a884"/><ellipse cx="${at.x}" cy="${at.y - 21}" rx="16" ry="8" fill="#a47a55"/><path d="M${at.x},${at.y - 21}v-51" stroke="#456e54" stroke-width="4"/><ellipse cx="${at.x - 12}" cy="${at.y - 56}" rx="11" ry="21" fill="#54806a" transform="rotate(-40 ${at.x - 12} ${at.y - 56})"/><ellipse cx="${at.x + 10}" cy="${at.y - 66}" rx="11" ry="22" fill="#71977b" transform="rotate(25 ${at.x + 10} ${at.y - 66})"/><ellipse cx="${at.x + 17}" cy="${at.y - 43}" rx="11" ry="22" fill="#3e705d" transform="rotate(57 ${at.x + 17} ${at.y - 43})"/></g>`;
}
function person(x: number, y: number, coat: string, bag = false): string {
    const a = p(x, y);
    return `<g><ellipse cx="${a.x + 3}" cy="${a.y + 2}" rx="11" ry="5" fill="#49695b" opacity=".18"/><path d="M${a.x - 3},${a.y - 12}l-2,13m8,-13l2,13" stroke="#314745" stroke-width="4" stroke-linecap="round"/><rect x="${a.x - 7}" y="${a.y - 32}" width="14" height="22" rx="5" fill="${coat}"/><circle cx="${a.x}" cy="${a.y - 39}" r="6" fill="#c99778"/><path d="M${a.x - 6},${a.y - 40}q1,-10 11,-3l1,3" fill="#374f46"/>${bag ? `<rect x="${a.x + 12}" y="${a.y - 15}" width="11" height="17" rx="3" fill="#a5724e"/><path d="M${a.x + 15},${a.y - 15}v-7h5v7" fill="none" stroke="#5f5449" stroke-width="1.5"/>` : ""}</g>`;
}
function bench(x: number, y: number, seats: number): string {
    let result = rect(x - 4, y - 4, seats * 43 + 10, 40, 0, "#abb8a644");
    result += box(x + 5, y + 7, seats * 43 - 12, 5, 12, "#48655e", "#657e72", "#3c5954");
    result += box(x + 5, y + 28, seats * 43 - 12, 5, 12, "#48655e", "#657e72", "#3c5954");
    for (let i = 0; i < seats; i++) {
        result += box(x + i * 43, y, 39, 34, 7, "#719481", "#638773", "#496e60", 12);
        result += box(x + i * 43, y + 28, 39, 6, 25, "#85a08a", "#77987f", "#496e60", 19);
    }
    return result;
}
function architecture(): string {
    const parts: string[] = [];
    // Floor slab and true 30° orthographic axes.
    parts.push(`<ellipse cx="592" cy="603" rx="525" ry="204" fill="#4f7658" opacity=".08"/>`);
    parts.push(box(0, 0, 600, 600, 15, "#e8e7d5", "#c9ccb5", "#bec6af", -15));
    for (let n = 0; n <= 600; n += 60) {
        parts.push(line({ x: n, y: 0, z: .1 }, { x: n, y: 600, z: .1 }, "#ced5c1"));
        parts.push(line({ x: 0, y: n, z: .1 }, { x: 600, y: n, z: .1 }, "#ced5c1"));
    }
    parts.push(polygon([{ x: 0, y: 0, z: 0 }, { x: 600, y: 0, z: 0 }, { x: 600, y: 0, z: 205 }, { x: 0, y: 0, z: 205 }], "#dce0d0"));
    parts.push(polygon([{ x: 0, y: 0, z: 0 }, { x: 0, y: 600, z: 0 }, { x: 0, y: 600, z: 205 }, { x: 0, y: 0, z: 205 }], "#eaf0df"));
    parts.push(box(-9, -9, 618, 9, 214, "#f5f5e8", "#d4ddc7", "#b4c5af"));
    parts.push(box(-9, 0, 9, 600, 214, "#f5f5e8", "#d4ddc7", "#c5d2bd"));
    parts.push(line({ x: 0, y: 0, z: 7 }, { x: 600, y: 0, z: 7 }, "#91a895", 8), line({ x: 0, y: 0, z: 7 }, { x: 0, y: 600, z: 7 }, "#b1c2aa", 8));
    // Long window wall, runway view and mullions.
    for (let n = 0; n < 3; n++) {
        const y = 28 + n * 187, span = 160;
        parts.push(polygon([{ x: 1, y, z: 53 }, { x: 1, y: y + span, z: 53 }, { x: 1, y: y + span, z: 176 }, { x: 1, y, z: 176 }], "#a8cbd0", "#92b9ba"));
        parts.push(polygon([{ x: 2, y, z: 53 }, { x: 2, y: y + span, z: 53 }, { x: 2, y: y + span, z: 100 }, { x: 2, y, z: 98 }], "#c4d7c4"));
        parts.push(line({ x: 3, y, z: 81 }, { x: 3, y: y + span, z: 81 }, "#eaf0d6", 3));
        parts.push(line({ x: 3, y: y + 80, z: 53 }, { x: 3, y: y + 80, z: 176 }, "#ecf0da", 5));
        parts.push(line({ x: 3, y, z: 121 }, { x: 3, y: y + span, z: 121 }, "#e9efd9", 4));
        parts.push(polygon([{ x: 3, y: y + 14, z: 125 }, { x: 3, y: y + 48, z: 142 }, { x: 3, y: y + 75, z: 174 }, { x: 3, y: y + 54, z: 174 }], "#d4e5df88"));
        parts.push(box(0, y - 6, 16, span + 12, 7, "#fbf8e9", "#d3ddc8", "#b4c6af", 47));
    }
    // A tiny plane through the center pane (decorative SVG, not an external asset).
    const plane = p(3, 314, 128);
    parts.push(`<g transform="translate(${plane.x} ${plane.y}) rotate(-30) scale(.8)"><path d="M-44,0L-10,-5L10,-29L18,-29L10,-4L42,-1Q53,1 42,4L9,5L15,20L8,20L-11,5L-41,6L-50,15L-56,15L-50,3L-56,-8L-50,-8z" fill="#f6f6e8"/><path d="M-30,1L25,1" stroke="#87a9a6" stroke-width="2"/></g>`);
    // Carpet and markings anchor the waiting area.
    parts.push(rect(120, 215, 290, 210, .5, "#b9cab3"), rect(128, 223, 274, 194, .7, "#becfb8"));
    const path = p(440, 370, .8);
    parts.push(`<g transform="matrix(.866,.5,-.866,.5,${path.x},${path.y})" fill="#91a78c"><rect x="0" y="0" width="15" height="60" rx="5"/><path d="M-12,21L7,-2L26,21z"/><text x="-10" y="92" font-family="system-ui" font-size="16" font-weight="700">GATES</text></g>`);
    // Sort freestanding objects by floor depth for this fixed camera.
    const objects: [
        number,
        string
    ][] = [];
    objects.push([430, bench(160, 230, 4)], [525, bench(160, 325, 4)]);
    for (let n = 0; n < 3; n++) {
        const x = 387 + n * 57, y = 100;
        objects.push([x + y, box(x, y, 47, 60, 48, "#d8e4cc", "#6e9582", "#507968") + box(x + 5, y + 7, 35, 17, 4, "#edf0da", "#cad5bf", "#a4b59e", 48) + box(x + 10, y + 15, 24, 6, 21, "#324b47", "#476863", "#243d38", 52)]);
    }
    objects.push([690, box(62, 480, 118, 50, 55, "#e9d6b7", "#b69778", "#8f795f") + box(77, 487, 20, 22, 23, "#627f70", "#4e6e5e", "#385647", 55)]);
    for (const [x, y] of [[32, 180], [35, 553], [558, 55], [477, 502]])
        objects.push([x + y, plant(x, y)]);
    const people: [
        number,
        number,
        string,
        boolean
    ][] = [[344, 165, "#bd8e60", true], [295, 462, "#4b7470", true], [462, 268, "#a06449", false], [126, 436, "#cebb83", false], [254, 285, "#d4a866", false], [428, 472, "#63816f", true], [215, 580, "#966951", true], [519, 350, "#c4b493", false], [361, 549, "#7b9d97", false]];
    for (const [x, y, color, bag] of people)
        objects.push([x + y, person(x, y, color, bag)]);
    objects.sort((a, b) => a[0] - b[0]);
    parts.push(...objects.map(item => item[1]));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 860" aria-hidden="true">${parts.join("")}</svg>`;
}
export const TerminalArchitecture = defineHTMLComponent<null>({ name: "sky-harbor/terminal-architecture", template: architecture(), styles: ':host{display:block;width:1200px;height:860px;pointer-events:none}svg{display:block;width:100%;height:100%}' });
