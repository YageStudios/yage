import { Panel, type Child, type ElementNode, type Props } from "./nodes";
import { read, type Value } from "./reactive";
export interface Point2 {
    readonly x: number;
    readonly y: number;
}
export interface Point3 extends Point2 {
    readonly z: number;
}
/** Coordinates are CSS pixels in the positioned parent, not device pixels. */
export interface SurfacePose {
    readonly origin: Point2;
    /** Projected displacement across the full local width/height (not unit vectors). */
    readonly xAxis: Point2;
    readonly yAxis: Point2;
    readonly width: number;
    readonly height: number;
    readonly visible?: boolean;
    readonly zIndex?: number;
}
export interface IsometricCamera {
    readonly origin: Point2;
    readonly zoom?: number;
}
const finite = (...values: number[]) => values.every(Number.isFinite);
export function projectIsometric(point: Point3, camera: IsometricCamera): Point2 {
    const zoom = camera.zoom ?? 1;
    if (!finite(point.x, point.y, point.z, camera.origin.x, camera.origin.y, zoom) || zoom <= 0)
        throw new Error("UIF_PROJECTION: invalid camera or world point");
    return { x: camera.origin.x + (point.x - point.y) * Math.sqrt(3) / 2 * zoom, y: camera.origin.y + ((point.x + point.y) / 2 - point.z) * zoom };
}
export function surfaceMatrix(pose: SurfacePose): readonly [
    number,
    number,
    number,
    number,
    number,
    number
] {
    if (!finite(pose.width, pose.height, pose.origin.x, pose.origin.y, pose.xAxis.x, pose.xAxis.y, pose.yAxis.x, pose.yAxis.y) || pose.width <= 0 || pose.height <= 0)
        throw new Error("UIF_SURFACE: dimensions must be positive and coordinates finite");
    const a = pose.xAxis.x / pose.width, b = pose.xAxis.y / pose.width, c = pose.yAxis.x / pose.height, d = pose.yAxis.y / pose.height;
    if (Math.abs(a * d - b * c) < 1e-10)
        throw new Error("UIF_SURFACE: projected axes must not be collinear");
    return [a, b, c, d, pose.origin.x, pose.origin.y];
}
export function surfaceTransform(pose: SurfacePose): string { return `matrix(${surfaceMatrix(pose).join(",")})`; }
/** Inverse of the same affine matrix used by DOM rendering. */
export function surfaceToLocal(pose: SurfacePose, point: Point2): Point2 {
    if (!finite(point.x, point.y))
        throw new Error("UIF_SURFACE: invalid input point");
    const [a, b, c, d, e, f] = surfaceMatrix(pose), x = point.x - e, y = point.y - f, determinant = a * d - b * c;
    return { x: (d * x - c * y) / determinant, y: (-b * x + a * y) / determinant };
}
export interface IsometricSurfaceOptions {
    /** Top-left corner of a wall, or first corner of a floor panel, in world units. */
    position: Point3;
    width: number;
    height: number;
    /** Uniform conversion from local CSS units to world units. */
    worldUnitsPerPixel?: number;
    plane?: "wall-x" | "wall-y" | "floor";
    camera: IsometricCamera;
    visible?: boolean;
    zIndex?: number;
}
export function isometricSurface(options: IsometricSurfaceOptions): SurfacePose {
    const { position, camera, width, height } = options, scale = options.worldUnitsPerPixel ?? 1;
    if (!Number.isFinite(scale) || scale <= 0)
        throw new Error("UIF_SURFACE: worldUnitsPerPixel must be positive");
    const origin = projectIsometric(position, camera);
    const plane = options.plane ?? "wall-x";
    if (!["wall-x", "wall-y", "floor"].includes(plane))
        throw new Error("UIF_SURFACE: unsupported plane");
    const across = projectIsometric({ ...position, x: position.x + (plane !== "wall-y" ? width * scale : 0), y: position.y + (plane === "wall-y" ? width * scale : 0) }, camera);
    const down = projectIsometric({ ...position, y: position.y + (plane === "floor" ? height * scale : 0), z: position.z - (plane !== "floor" ? height * scale : 0) }, camera);
    const pose: SurfacePose = { width, height, origin, xAxis: { x: across.x - origin.x, y: across.y - origin.y }, yAxis: { x: down.x - origin.x, y: down.y - origin.y }, visible: options.visible, zIndex: options.zIndex };
    surfaceMatrix(pose);
    return pose;
}
/** Retained DOM surface: transform/layout are bound, content is never rasterized or re-created.
 * The game owns depth/occlusion via visible/zIndex. This is not a Pixi texture or a depth-buffer mesh.
 */
export function WorldSurface(options: Omit<Props, "hidden"> & {
    pose: Value<SurfacePose>;
}, ...children: Child[]): ElementNode {
    const { pose, style, ...props } = options;
    return Panel({ ...props, hidden: () => read(pose).visible === false, style: { ...style,
            position: "absolute", left: 0, top: 0, transformOrigin: "0 0", width: () => read(pose).width,
            height: () => read(pose).height, transform: () => surfaceTransform(read(pose)), zIndex: () => read(pose).zIndex ?? 0,
        } }, ...children);
}
