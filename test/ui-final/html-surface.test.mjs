import test from "node:test";
import assert from "node:assert/strict";
import { defineHTMLComponent, surfaceMatrix, surfaceTransform, surfaceToLocal, projectIsometric, isometricSurface, WorldSurface, signal, compileDocument } from "../../.ui-final-build/engine/ui/final/index.js";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
test("HTML definitions are immutable first-class nodes with stable definition identity", () => {
    const spec = { name: "example/board", template: "<span></span>" };
    const Component = defineHTMLComponent(spec), state = signal({ count: 1 });
    spec.template = "changed";
    const a = Component({ key: "a", id: "board", state }), b = Component({ state });
    assert.equal(a.kind, "html");
    assert.equal(a.key, "a");
    assert.equal(a.props.id, "board");
    assert.equal(a.state, state);
    assert.equal(a.definition, b.definition);
    assert.equal(a.definition.template, "<span></span>");
    assert.ok(Object.isFrozen(a.definition));
});
test("HTML definitions reject missing template and invalid names without a DOM", () => {
    assert.throws(() => defineHTMLComponent({ name: "", template: "" }), /HTML_NAME/);
    assert.throws(() => defineHTMLComponent({ name: "ok", template: 4 }), /HTML_TEMPLATE/);
});
test("isometric axes have equal scale, 30 degree slopes and independent height", () => {
    const camera = { origin: { x: 100, y: 200 }, zoom: 2 };
    const x = projectIsometric({ x: 10, y: 0, z: 0 }, camera), y = projectIsometric({ x: 0, y: 10, z: 0 }, camera), z = projectIsometric({ x: 0, y: 0, z: 10 }, camera);
    close(x.x - 100, Math.sqrt(3) * 10);
    close(x.y - 200, 10);
    close(y.x - 100, -Math.sqrt(3) * 10);
    close(y.y - 200, 10);
    close(z.y, 180);
});
for (const plane of ["wall-x", "wall-y", "floor"])
    test(`${plane} surface projection and inverse round-trip`, () => {
        const pose = isometricSurface({ plane, position: { x: 35, y: 10, z: 90 }, width: 400, height: 150, worldUnitsPerPixel: .3, camera: { origin: { x: 200, y: 100 }, zoom: 1.7 } });
        const [a, b, c, d, e, f] = surfaceMatrix(pose);
        assert.match(surfaceTransform(pose), /^matrix\(/);
        for (const [x, y] of [[0, 0], [400, 150], [123, 48], [-15, 170]]) {
            const local = surfaceToLocal(pose, { x: a * x + c * y + e, y: b * x + d * y + f });
            close(local.x, x);
            close(local.y, y);
        }
    });
test("projected surfaces reject nonfinite, zero-area, collapsed and unsupported poses", () => {
    const pose = { width: 100, height: 50, origin: { x: 0, y: 0 }, xAxis: { x: 100, y: 0 }, yAxis: { x: 0, y: 50 } };
    for (const invalid of [{ ...pose, width: 0 }, { ...pose, height: -1 }, { ...pose, xAxis: { x: NaN, y: 0 } }, { ...pose, yAxis: { x: 10, y: 0 } }])
        assert.throws(() => surfaceMatrix(invalid), /UIF_SURFACE/);
    assert.throws(() => projectIsometric({ x: 0, y: 0, z: 0 }, { origin: { x: 0, y: 0 }, zoom: 0 }), /UIF_PROJECTION/);
    assert.throws(() => isometricSurface({ position: { x: 0, y: 0, z: 0 }, width: 10, height: 10, plane: "bad", camera: { origin: { x: 0, y: 0 } } }), /UIF_SURFACE/);
});
test("WorldSurface stays a retained node with reactive pose and no pixel-ratio multiplication", () => {
    const pose = signal({ width: 100, height: 50, origin: { x: 12, y: 24 }, xAxis: { x: 100, y: 0 }, yAxis: { x: 0, y: 50 }, visible: true });
    const surface = WorldSurface({ pose, id: "wall" }, "content");
    assert.equal(surface.kind, "element");
    assert.equal(surface.props.style.transform(), "matrix(1,0,0,1,12,24)");
    assert.equal(surface.props.hidden(), false);
    pose.update(value => ({ ...value, visible: false }));
    assert.equal(surface.props.hidden(), true);
    assert.equal(surface.children[0], "content");
});
test("document compiler resolves registered HTML components and data events without evaluating source", async () => {
    const { parseDocument, compileDocument, Model } = await import("../../.ui-final-build/engine/ui/final/index.js");
    const Component = defineHTMLComponent({ name: "counter", template: "<span></span>" });
    const asset = { schema: "ui-final/1", root: { component: "counter", state: { $bind: "screen" }, props: { id: "counter" }, events: { increment: "incrementCounter" } } };
    const model = new Model({ screen: { count: 4 } });
    let payload;
    const node = compileDocument(asset, { model, components: { counter: Component }, componentActions: { incrementCounter: detail => payload = detail } });
    assert.equal(node.kind, "html");
    assert.equal(node.props.id, "counter");
    assert.deepEqual(node.state(), { count: 4 });
    node.events.increment({ by: 2 });
    assert.deepEqual(payload, { by: 2 });
    assert.throws(() => compileDocument(asset, { model }), /unregistered component/);
    assert.throws(() => compileDocument(asset, { model, components: { counter: Component } }), /unregistered component action/);
    assert.throws(() => parseDocument({ ...asset, root: { ...asset.root, props: { text: "bad" } } }), /not a component host property/);
    assert.throws(() => parseDocument({ ...asset, root: { ...asset.root, events: { x: () => { } } } }), /JSON-compatible/);
});
test("document state with component/type field names is literal data, not an asset node", () => {
    const component = defineHTMLComponent({ name: "custom", template: "<div></div>" });
    const state = { component: "aircraft-part", events: { activate: "not-an-action" }, type: "simulation", on: { activate: "not-an-action" } };
    const node = compileDocument({ schema: "ui-final/1", root: { component: "custom", state } }, { model: { select() { throw Error("unexpected binding"); } }, components: { custom: component } });
    assert.deepEqual(node.state, state);
});
