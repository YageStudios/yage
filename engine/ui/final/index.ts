/** Preferred game UI entrypoint. Legacy ui/* imports remain supported during migration. */
export * from "./reactive";
export * from "./model";
export * from "./nodes";
export * from "./focus";
export * from "./runtime";
export * from "./document";
export * from "./services";
export * from "./input";
export { visibleRange, keyedItems } from "./render";
export type { RenderStats } from "./render";
export { defaultTheme } from "./theme";
export type { Theme } from "./theme";

export { defineHTMLComponent, extractHTMLComponent } from "./html";
export type { HTMLComponent, HTMLComponentDefinition, HTMLComponentProps, HTMLComponentContext, HTMLComponentEvents, HTMLNode, HTMLPolicy } from "./html";
export { WorldSurface, projectIsometric, isometricSurface, surfaceMatrix, surfaceTransform, surfaceToLocal } from "./surface";
export type { Point2, Point3, SurfacePose, IsometricCamera, IsometricSurfaceOptions } from "./surface";
