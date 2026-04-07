/**
 * POSSPEC Layout Renderer
 *
 * Bridges the layout engine (measure/arrange) to the existing UIElement DOM system.
 * Applies computed layout positions to UIElement instances.
 */

import type { LayoutResult } from "./LayoutEngine";
import { computeLayout } from "./LayoutEngine";
import type { LayoutNodeConfig, LayoutSize } from "./LayoutTypes";
import type { UIElement } from "../UIElement";
import { getViewportScale, scaleFont } from "../utils";

/**
 * Apply computed layout bounds to an HTML element.
 * Converts center-origin LayoutRect to CSS absolute positioning.
 */
export function applyLayoutToElement(
  result: LayoutResult,
  element: HTMLElement,
  parentElement: HTMLElement,
  viewportScale: number
): void {
  const { bounds, scaleFactor } = result;

  const scale = viewportScale;
  const x = Math.floor(bounds.x * scale);
  const y = Math.floor(bounds.y * scale);
  const w = Math.floor(bounds.width * scale);
  const h = Math.floor(bounds.height * scale);

  element.style.position = "absolute";
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = w > 0 ? `${w}px` : "auto";
  element.style.height = h > 0 ? `${h}px` : "auto";

  // Apply scale transform for overflow: Scale
  if (scaleFactor !== 1) {
    element.style.transform = `scale(${scaleFactor})`;
    element.style.transformOrigin = "top left";
  }
}

/**
 * Apply visual styles from a LayoutNodeConfig to an HTML element.
 * Only applies visual properties (colors, fonts, borders, etc.) — NOT layout geometry.
 */
export function applyStylesToElement(
  node: LayoutNodeConfig,
  element: HTMLElement,
  viewportScale: number
): void {
  const styles = node.styles ?? {};

  for (const [key, value] of Object.entries(styles)) {
    if (key === "fontSize") {
      // Scale font size with viewport
      const fontSize = typeof value === "number" ? value : parseFloat(value);
      if (!isNaN(fontSize)) {
        element.style.fontSize = `${scaleFont(fontSize, 1)}px`;
      }
      continue;
    }

    // Apply other visual styles directly
    try {
      (element.style as any)[key] = value;
    } catch {
      // Ignore invalid style properties
    }
  }
}

/**
 * Create a simple text measurement function using a hidden DOM element.
 */
export function createTextMeasurer(): (text: string, styles: Record<string, any>) => LayoutSize {
  let measurer: HTMLSpanElement | null = null;

  return (text: string, styles: Record<string, any>): LayoutSize => {
    if (!measurer) {
      measurer = document.createElement("span");
      measurer.style.position = "absolute";
      measurer.style.left = "-9999px";
      measurer.style.top = "-9999px";
      measurer.style.whiteSpace = "nowrap";
      measurer.style.visibility = "hidden";
      document.body.appendChild(measurer);
    }

    const fontSize = styles.fontSize ?? 16;
    const fontFamily = styles.fontFamily ?? "YageFont";
    const fontWeight = styles.fontWeight ?? "normal";

    measurer.style.fontSize = `${fontSize}px`;
    measurer.style.fontFamily = fontFamily;
    measurer.style.fontWeight = fontWeight;
    measurer.innerText = text;

    return {
      width: measurer.offsetWidth + 2,
      height: measurer.offsetHeight,
    };
  };
}

/**
 * Check if a UI definition uses the new POSSPEC format.
 * Detection: root element has type "Canvas", or any child uses anchor/pivot.
 */
export function isPosspecFormat(json: any): boolean {
  if (!json || typeof json !== "object") return false;

  // Check all top-level keys
  for (const key of Object.keys(json)) {
    const value = json[key];
    if (!value || typeof value !== "object") continue;

    // Direct check on the root element
    if (value.type === "Canvas") return true;

    // Check if root element's type is PascalCase (new format)
    if (
      typeof value.type === "string" &&
      ["VStack", "HStack", "Grid"].includes(value.type)
    ) {
      return true;
    }

    // Check for anchor/pivot on root or immediate children
    if (value.anchor || value.pivot) return true;
    if (value.children && Array.isArray(value.children)) return true;
  }

  return false;
}

/**
 * Convert a POSSPEC LayoutNodeConfig to the legacy UiMap format for building.
 * This is the bridge that allows the new JSON format to work with the existing
 * UiMap build system while the layout engine is being fully integrated.
 *
 * Maps: Canvas → box(full), VStack/HStack → box with flex styles,
 * anchor/pivot/offset → rect x/y/xOffset/yOffset
 */
export function posspecToLegacy(node: any, inFlowParent = false): any {
  if (!node || typeof node !== "object") return node;

  // Handle arrays (new children format)
  if (Array.isArray(node)) {
    const obj: any = {};
    node.forEach((child: any, index: number) => {
      const id = child?.id || child?.then?.id || `_child_${index}`;
      obj[id] = posspecToLegacy(child, inFlowParent);
    });
    return obj;
  }

  // Handle structural nodes ($if, $unless, $with, $partial, $each)
  if (node.$if !== undefined || node.$unless !== undefined) {
    const result: any = {};
    if (node.$if !== undefined) result.$if = node.$if;
    if (node.$unless !== undefined) result.$unless = node.$unless;
    if (node.then) result.then = posspecToLegacy(node.then, inFlowParent);
    if (node.else) result.else = posspecToLegacy(node.else, inFlowParent);
    return result;
  }
  if (node.$with !== undefined) {
    return {
      $with: node.$with,
      content: posspecToLegacy(node.content, inFlowParent),
    };
  }
  if (node.$partial !== undefined) {
    return { $partial: node.$partial, context: node.context };
  }
  if (node.$each !== undefined) {
    return {
      $each: node.$each,
      content: node.content ? posspecToLegacy(node.content, inFlowParent) : undefined,
      else: node.else ? posspecToLegacy(node.else, inFlowParent) : undefined,
    };
  }

  if (!node.type) return node;

  const result: any = {};
  if (node.id) {
    result.id = node.id;
  }

  // Map type
  const typeMap: Record<string, string> = {
    Canvas: "box",
    VStack: "box",
    HStack: "box",
    Grid: "grid",
    Box: "box",
    Text: "text",
    Button: "button",
    Image: "image",
    Input: "input",
  };
  result.type = typeMap[node.type] || node.type.toLowerCase();

  // Build rect from anchor/pivot/offset or explicit position
  result.rect = buildLegacyRect(node);

  // Build config from flat properties
  result.config = buildLegacyConfig(node);

  // Handle grid-specific
  if (node.type === "Grid" || result.type === "grid") {
    if (node.items) result.items = node.items;
    if (node.element) result.element = posspecToLegacy(node.element, true);

    // Apply grid-specific config
    const spacing = node.spacing ?? 0;
    result.config.gap = `${spacing}px`;

    if (!result.config.style) result.config.style = {};
    result.config.style.display = "flex";
    result.config.style.flexWrap = "wrap";
    result.config.style.overflow = "auto";
    result.config.style.alignContent = "flex-start";
    result.config.style.boxSizing = "border-box";
    result.config.style.pointerEvents = "auto";
  }

  // Handle VStack/HStack styling
  if (node.type === "VStack" || node.type === "HStack") {
    if (!result.config.style) result.config.style = {};
    result.config.style.display = "flex";
    result.config.style.flexDirection = node.type === "VStack" ? "column" : "row";
    result.config.style.overflow = "visible";
    result.config.style.pointerEvents = "auto";

    const spacing = node.spacing ?? 0;
    if (spacing > 0) {
      result.config.style.gap = `${spacing}px`;
    }

    // alignItems mapping
    const alignMap: Record<string, string> = {
      Start: "flex-start",
      Center: "center",
      End: "flex-end",
      Stretch: "stretch",
    };
    if (node.alignItems) {
      result.config.style.alignItems = alignMap[node.alignItems] || "flex-start";
    }

    // justifyContent mapping
    const justifyMap: Record<string, string> = {
      Start: "flex-start",
      Center: "center",
      End: "flex-end",
      SpaceBetween: "space-between",
    };
    if (node.justifyContent) {
      result.config.style.justifyContent = justifyMap[node.justifyContent] || "flex-start";
    }

    // Overflow: Scale
    if (node.overflow === "Scale") {
      // Scale is handled specially — for now, just don't clip
      result.config.style.overflow = "visible";
    } else if (node.overflow === "Hidden") {
      result.config.style.overflow = "hidden";
    } else if (node.overflow === "Scroll") {
      result.config.style.overflow = "auto";
    }
  }

  // Handle Canvas root styling
  if (node.type === "Canvas") {
    result.rect = { x: "full", y: "full" };
    if (!result.config.style) result.config.style = {};
  }

  if (inFlowParent) {
    if (!result.config.style) result.config.style = {};
    result.config.style.position = "relative";
    result.config.style.pointerEvents = result.config.style.pointerEvents ?? "auto";
  }

  // Handle children
  if (node.children && Array.isArray(node.children)) {
    result.children = posspecToLegacy(node.children, node.type === "VStack" || node.type === "HStack" || node.type === "Grid");
  }

  // Handle events
  if (node.events) {
    result.events = node.events;
  }

  return result;
}

function buildLegacyRect(node: any): any {
  const rect: any = {};

  // Map anchor to x/y positions
  if (node.anchor) {
    const anchorMap: Record<string, { x: string; y: string }> = {
      TopLeft: { x: "left", y: "top" },
      TopCenter: { x: "center", y: "top" },
      TopRight: { x: "right", y: "top" },
      MiddleLeft: { x: "left", y: "center" },
      Center: { x: "center", y: "center" },
      MiddleRight: { x: "right", y: "center" },
      BottomLeft: { x: "left", y: "bottom" },
      BottomCenter: { x: "center", y: "bottom" },
      BottomRight: { x: "right", y: "bottom" },
    };
    const mapped = anchorMap[node.anchor] ?? { x: "center", y: "center" };
    rect.x = mapped.x;
    rect.y = mapped.y;
  } else {
    rect.x = 0;
    rect.y = 0;
  }

  // Map offset
  if (node.offset) {
    if (node.offset.x) rect.xOffset = node.offset.x;
    if (node.offset.y) rect.yOffset = node.offset.y;
  }

  // Map dimensions
  if (node.width !== undefined) {
    if (node.width === "fill" || node.width === "full") {
      rect.width = "100%";
    } else {
      rect.width = node.width;
    }
  }
  if (node.height !== undefined) {
    if (node.height === "fill" || node.height === "full") {
      rect.height = "100%";
    } else {
      rect.height = node.height;
    }
  }

  // Map min/max constraints
  if (node.minWidth !== undefined) rect.minWidth = node.minWidth;
  if (node.maxWidth !== undefined) {
    rect.maxWidth = node.maxWidth === "fill" || node.maxWidth === "full" ? "100%" : node.maxWidth;
  }
  if (node.minHeight !== undefined) rect.minHeight = node.minHeight;
  if (node.maxHeight !== undefined) {
    rect.maxHeight = node.maxHeight === "fill" || node.maxHeight === "full" ? "100%" : node.maxHeight;
  }

  return rect;
}

function buildLegacyConfig(node: any): any {
  const config: any = {};

  // Map styles
  if (node.styles) {
    config.style = { ...node.styles };

    // Extract fontSize from styles into config.fontSize for Text/Button
    if (config.style.fontSize !== undefined) {
      config.fontSize = config.style.fontSize;
      delete config.style.fontSize;
    }
  }

  // Map text/label
  if (node.text !== undefined) config.label = node.text;
  if (node.label !== undefined) config.label = node.label;
  if (node.texture !== undefined) config.imageKey = node.texture;
  if (node.value !== undefined) config.value = node.value;

  // Map focus/interaction
  if (node.focusable !== undefined) config.focusable = node.focusable;
  if (node.autoFocus !== undefined) config.autoFocus = node.autoFocus;
  if (node.captureFocus !== undefined) config.captureFocus = node.captureFocus;
  if (node.visible !== undefined) config.visible = node.visible;

  // Map focusStyle
  if (node.focusStyle) {
    config.focusStyle = { ...node.focusStyle };
  }

  // Map hoverStyle
  if (node.hoverStyle) {
    config.hoverStyle = { ...node.hoverStyle };
  }

  // Map padding into styles
  if (node.padding !== undefined) {
    if (!config.style) config.style = {};
    if (typeof node.padding === "number") {
      config.style.padding = `${node.padding}px`;
    } else if (Array.isArray(node.padding)) {
      config.style.padding = node.padding.map((v: number) => `${v}px`).join(" ");
    }
  }

  // Map flex
  if (node.flex !== undefined && node.flex > 0) {
    if (!config.style) config.style = {};
    config.style.flex = `${node.flex}`;
    config.style.position = "relative";
  }

  // Map class
  if (node.class) config.class = node.class;

  return config;
}
