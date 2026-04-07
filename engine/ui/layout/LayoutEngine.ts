/**
 * POSSPEC Layout Engine — Two-Pass Measure/Arrange Algorithm
 *
 * Pass 1 (Measure): Bottom-up. Each element computes its intrinsic size.
 * Pass 2 (Arrange): Top-down. Each parent assigns final positions to children.
 */

import type {
  LayoutSize,
  LayoutRect,
  LayoutNodeConfig,
  NinePoint,
  AlignItems,
  JustifyContent,
  OverflowMode,
  PaddingBox,
} from "./LayoutTypes";
import {
  resolveAnchor,
  resolvePivot,
  parsePadding,
  clampSize,
  UNCONSTRAINED,
} from "./LayoutTypes";

// ─── Layout Result ───────────────────────────────────────────────────────────

export interface LayoutResult {
  /** The node config this result corresponds to */
  node: LayoutNodeConfig;
  /** Intrinsic size computed during measure pass */
  intrinsicSize: LayoutSize;
  /** Final bounds assigned during arrange pass */
  bounds: LayoutRect;
  /** Scale factor (for overflow: Scale) */
  scaleFactor: number;
  /** Scroll offset (for overflow: Scroll) */
  scrollOffset: { x: number; y: number };
  /** Child layout results */
  children: LayoutResult[];
}

// ─── Measure Pass ────────────────────────────────────────────────────────────

/**
 * Measure a node and all its descendants. Returns intrinsic size.
 */
export function measure(
  node: LayoutNodeConfig,
  availableWidth: number,
  availableHeight: number,
  measureText?: (text: string, styles: Record<string, any>) => LayoutSize
): LayoutResult {
  const padding = parsePadding(node.padding);
  const innerW = availableWidth - padding.left - padding.right;
  const innerH = availableHeight - padding.top - padding.bottom;

  // Resolve explicit width/height
  const explicitW = resolveExplicitSize(node.width, availableWidth);
  const explicitH = resolveExplicitSize(node.height, availableHeight);

  const contentW = explicitW ?? innerW;
  const contentH = explicitH ?? innerH;

  let intrinsicSize: LayoutSize;
  let childResults: LayoutResult[] = [];

  switch (node.type) {
    case "Text": {
      if (measureText && node.text) {
        const textSize = measureText(node.text, node.styles ?? {});
        intrinsicSize = {
          width: explicitW ?? textSize.width,
          height: explicitH ?? textSize.height,
        };
      } else {
        // Fallback: estimate from fontSize
        const fontSize = node.styles?.fontSize ?? 16;
        const text = node.text ?? "";
        intrinsicSize = {
          width: explicitW ?? text.length * fontSize * 0.6,
          height: explicitH ?? fontSize * 1.4,
        };
      }
      break;
    }

    case "Button": {
      const fontSize = node.styles?.fontSize ?? 16;
      const label = node.label ?? "";
      const textW = label.length * fontSize * 0.6;
      const textH = fontSize * 1.4;
      intrinsicSize = {
        width: explicitW ?? textW + padding.left + padding.right + 20,
        height: explicitH ?? textH + padding.top + padding.bottom + 10,
      };
      break;
    }

    case "Image": {
      intrinsicSize = {
        width: explicitW ?? 100,
        height: explicitH ?? 100,
      };
      break;
    }

    case "Input": {
      intrinsicSize = {
        width: explicitW ?? 200,
        height: explicitH ?? 40,
      };
      break;
    }

    case "Canvas": {
      // Canvas fills available space
      childResults = measureChildren(node.children, contentW, contentH, measureText);
      intrinsicSize = {
        width: explicitW ?? availableWidth,
        height: explicitH ?? availableHeight,
      };
      break;
    }

    case "VStack": {
      const result = measureStack(node, contentW, contentH, "vertical", measureText);
      childResults = result.children;
      intrinsicSize = {
        width: explicitW ?? result.size.width + padding.left + padding.right,
        height: explicitH ?? result.size.height + padding.top + padding.bottom,
      };
      break;
    }

    case "HStack": {
      const result = measureStack(node, contentW, contentH, "horizontal", measureText);
      childResults = result.children;
      intrinsicSize = {
        width: explicitW ?? result.size.width + padding.left + padding.right,
        height: explicitH ?? result.size.height + padding.top + padding.bottom,
      };
      break;
    }

    case "Grid": {
      const result = measureGrid(node, contentW, contentH, measureText);
      childResults = result.children;
      intrinsicSize = {
        width: explicitW ?? result.size.width + padding.left + padding.right,
        height: explicitH ?? result.size.height + padding.top + padding.bottom,
      };
      break;
    }

    case "Box":
    default: {
      childResults = measureChildren(node.children, contentW, contentH, measureText);

      // Box intrinsic size = bounding box of all children (or explicit size)
      let maxChildW = 0;
      let maxChildH = 0;
      for (const child of childResults) {
        maxChildW = Math.max(maxChildW, child.intrinsicSize.width);
        maxChildH = Math.max(maxChildH, child.intrinsicSize.height);
      }

      intrinsicSize = {
        width: explicitW ?? maxChildW + padding.left + padding.right,
        height: explicitH ?? maxChildH + padding.top + padding.bottom,
      };
      break;
    }
  }

  // Apply min/max constraints
  intrinsicSize = applyConstraints(intrinsicSize, node, availableWidth, availableHeight);

  return {
    node,
    intrinsicSize,
    bounds: { x: 0, y: 0, width: intrinsicSize.width, height: intrinsicSize.height },
    scaleFactor: 1,
    scrollOffset: { x: 0, y: 0 },
    children: childResults,
  };
}

function measureChildren(
  children: any[] | undefined,
  availableW: number,
  availableH: number,
  measureText?: (text: string, styles: Record<string, any>) => LayoutSize
): LayoutResult[] {
  if (!children) return [];
  const results: LayoutResult[] = [];
  for (const child of children) {
    if (!child || child.$if !== undefined || child.$unless !== undefined || child.$with !== undefined || child.$partial !== undefined || child.$each !== undefined) {
      // Structural nodes — skip during static layout (handled dynamically at runtime)
      continue;
    }
    if (child.type) {
      results.push(measure(child, availableW, availableH, measureText));
    }
  }
  return results;
}

function measureStack(
  node: LayoutNodeConfig,
  availableW: number,
  availableH: number,
  direction: "vertical" | "horizontal",
  measureText?: (text: string, styles: Record<string, any>) => LayoutSize
): { size: LayoutSize; children: LayoutResult[] } {
  const spacing = node.spacing ?? 0;
  const children = node.children ?? [];
  const alignItems = node.alignItems ?? "Start";

  // First pass: measure all fixed children, collect flex children
  const childResults: LayoutResult[] = [];
  const flexChildren: number[] = [];
  let fixedMainAxis = 0;
  let maxCrossAxis = 0;
  let flexTotal = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child?.type) continue;

    const flex = child.flex ?? 0;
    if (flex > 0) {
      flexChildren.push(i);
      flexTotal += flex;
      // Measure with minimal space first
      const result = measure(child, availableW, availableH, measureText);
      childResults.push(result);
    } else {
      const result = measure(child, availableW, availableH, measureText);
      childResults.push(result);

      if (direction === "vertical") {
        fixedMainAxis += result.intrinsicSize.height;
        maxCrossAxis = Math.max(maxCrossAxis, result.intrinsicSize.width);
      } else {
        fixedMainAxis += result.intrinsicSize.width;
        maxCrossAxis = Math.max(maxCrossAxis, result.intrinsicSize.height);
      }
    }
  }

  const gapTotal = Math.max(0, childResults.length - 1) * spacing;
  const mainAxisAvailable = (direction === "vertical" ? availableH : availableW);
  const remainingSpace = Math.max(0, mainAxisAvailable - fixedMainAxis - gapTotal);

  // Second pass: distribute flex space
  if (flexTotal > 0) {
    for (const idx of flexChildren) {
      const child = children.filter((c: any) => c?.type)[idx];
      if (!child) continue;
      const flex = child.flex ?? 0;
      const allocatedMain = (remainingSpace * flex) / flexTotal;

      const result = childResults[idx];
      if (direction === "vertical") {
        result.intrinsicSize.height = allocatedMain;
        maxCrossAxis = Math.max(maxCrossAxis, result.intrinsicSize.width);
      } else {
        result.intrinsicSize.width = allocatedMain;
        maxCrossAxis = Math.max(maxCrossAxis, result.intrinsicSize.height);
      }
    }
  }

  // Handle stretch
  if (alignItems === "Stretch") {
    for (const result of childResults) {
      if (direction === "vertical") {
        result.intrinsicSize.width = maxCrossAxis;
      } else {
        result.intrinsicSize.height = maxCrossAxis;
      }
    }
  }

  // Compute total main axis
  let totalMainAxis = 0;
  for (const result of childResults) {
    totalMainAxis += direction === "vertical" ? result.intrinsicSize.height : result.intrinsicSize.width;
  }
  totalMainAxis += gapTotal;

  const size: LayoutSize =
    direction === "vertical"
      ? { width: maxCrossAxis, height: totalMainAxis }
      : { width: totalMainAxis, height: maxCrossAxis };

  return { size, children: childResults };
}

function measureGrid(
  node: LayoutNodeConfig,
  availableW: number,
  availableH: number,
  measureText?: (text: string, styles: Record<string, any>) => LayoutSize
): { size: LayoutSize; children: LayoutResult[] } {
  const columns = node.columns ?? 1;
  const spacing = node.spacing ?? 0;
  const children = node.children ?? [];

  const childResults: LayoutResult[] = [];
  let maxCellW = 0;
  let maxCellH = 0;

  for (const child of children) {
    if (!child?.type) continue;
    const result = measure(child, availableW, availableH, measureText);
    childResults.push(result);
    maxCellW = Math.max(maxCellW, result.intrinsicSize.width);
    maxCellH = Math.max(maxCellH, result.intrinsicSize.height);
  }

  const rows = Math.ceil(childResults.length / columns);
  const gridW = columns * maxCellW + Math.max(0, columns - 1) * spacing;
  const gridH = rows * maxCellH + Math.max(0, rows - 1) * spacing;

  return { size: { width: gridW, height: gridH }, children: childResults };
}

// ─── Arrange Pass ────────────────────────────────────────────────────────────

/**
 * Arrange a measured tree. Assigns final x, y, width, height to each node.
 */
export function arrange(
  result: LayoutResult,
  x: number,
  y: number,
  allocatedWidth: number,
  allocatedHeight: number
): void {
  const node = result.node;
  const padding = parsePadding(node.padding);

  result.bounds = {
    x,
    y,
    width: allocatedWidth,
    height: allocatedHeight,
  };

  const contentX = x + padding.left;
  const contentY = y + padding.top;
  const contentW = allocatedWidth - padding.left - padding.right;
  const contentH = allocatedHeight - padding.top - padding.bottom;

  // Handle overflow: Scale
  let scaleFactor = 1;
  if (node.overflow === "Scale") {
    const intrinsicW = result.intrinsicSize.width - padding.left - padding.right;
    const intrinsicH = result.intrinsicSize.height - padding.top - padding.bottom;
    if (intrinsicW > contentW || intrinsicH > contentH) {
      scaleFactor = Math.min(
        contentW / Math.max(1, intrinsicW),
        contentH / Math.max(1, intrinsicH)
      );
    }
    result.scaleFactor = scaleFactor;
  }

  switch (node.type) {
    case "Canvas":
      arrangeCanvas(result, contentX, contentY, contentW, contentH);
      break;

    case "VStack":
      arrangeStack(result, contentX, contentY, contentW, contentH, "vertical");
      break;

    case "HStack":
      arrangeStack(result, contentX, contentY, contentW, contentH, "horizontal");
      break;

    case "Grid":
      arrangeGrid(result, contentX, contentY, contentW, contentH);
      break;

    case "Box":
      // Box children are positioned like a Canvas by default
      arrangeCanvas(result, contentX, contentY, contentW, contentH);
      break;

    // Leaf nodes: Text, Button, Image, Input — no children to arrange
    default:
      break;
  }
}

function arrangeCanvas(
  result: LayoutResult,
  contentX: number,
  contentY: number,
  contentW: number,
  contentH: number
): void {
  for (const childResult of result.children) {
    const childNode = childResult.node;
    const anchor: NinePoint = childNode.anchor ?? "Center";
    const pivot: NinePoint = childNode.pivot ?? anchor;
    const offset = childNode.offset ?? {};
    const offsetX = offset.x ?? 0;
    const offsetY = offset.y ?? 0;

    const childW = childResult.intrinsicSize.width;
    const childH = childResult.intrinsicSize.height;

    // Resolve anchor position on the container
    const anchorPos = resolveAnchor(anchor, contentW, contentH);

    // Resolve pivot offset on the child
    const pivotOff = resolvePivot(pivot, childW, childH);

    // Final position: anchor point - pivot offset + user offset
    // This places the child so that its pivot point aligns with the anchor point
    const finalX = contentX + anchorPos.x - pivotOff.x + offsetX - childW / 2;
    const finalY = contentY + anchorPos.y - pivotOff.y + offsetY - childH / 2;

    arrange(childResult, finalX, finalY, childW, childH);
  }
}

function arrangeStack(
  result: LayoutResult,
  contentX: number,
  contentY: number,
  contentW: number,
  contentH: number,
  direction: "vertical" | "horizontal"
): void {
  const node = result.node;
  const spacing = node.spacing ?? 0;
  const alignItems: AlignItems = node.alignItems ?? "Start";
  const justifyContent: JustifyContent = node.justifyContent ?? "Start";

  const children = result.children;
  if (children.length === 0) return;

  // Calculate total main axis and distribute justifyContent
  let totalMainAxis = 0;
  for (const child of children) {
    totalMainAxis += direction === "vertical" ? child.intrinsicSize.height : child.intrinsicSize.width;
  }
  const totalGaps = Math.max(0, children.length - 1) * spacing;
  const mainAxisAvailable = direction === "vertical" ? contentH : contentW;
  const extraSpace = Math.max(0, mainAxisAvailable - totalMainAxis - totalGaps);

  let cursor = 0;
  let gap = spacing;

  switch (justifyContent) {
    case "Start":
      cursor = 0;
      break;
    case "Center":
      cursor = extraSpace / 2;
      break;
    case "End":
      cursor = extraSpace;
      break;
    case "SpaceBetween":
      cursor = 0;
      if (children.length > 1) {
        gap = spacing + extraSpace / (children.length - 1);
      }
      break;
  }

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childMainSize = direction === "vertical" ? child.intrinsicSize.height : child.intrinsicSize.width;
    const childCrossSize = direction === "vertical" ? child.intrinsicSize.width : child.intrinsicSize.height;
    const crossAxisAvailable = direction === "vertical" ? contentW : contentH;

    // Cross-axis alignment
    let crossOffset = 0;
    let finalCrossSize = childCrossSize;

    switch (alignItems) {
      case "Start":
        crossOffset = 0;
        break;
      case "Center":
        crossOffset = (crossAxisAvailable - childCrossSize) / 2;
        break;
      case "End":
        crossOffset = crossAxisAvailable - childCrossSize;
        break;
      case "Stretch":
        crossOffset = 0;
        finalCrossSize = crossAxisAvailable;
        break;
    }

    if (direction === "vertical") {
      arrange(child, contentX + crossOffset, contentY + cursor, finalCrossSize, childMainSize);
    } else {
      arrange(child, contentX + cursor, contentY + crossOffset, childMainSize, finalCrossSize);
    }

    cursor += childMainSize + gap;
  }
}

function arrangeGrid(
  result: LayoutResult,
  contentX: number,
  contentY: number,
  contentW: number,
  contentH: number
): void {
  const node = result.node;
  const columns = node.columns ?? 1;
  const spacing = node.spacing ?? 0;
  const children = result.children;

  if (children.length === 0) return;

  // Find max cell dimensions
  let maxCellW = 0;
  let maxCellH = 0;
  for (const child of children) {
    maxCellW = Math.max(maxCellW, child.intrinsicSize.width);
    maxCellH = Math.max(maxCellH, child.intrinsicSize.height);
  }

  for (let i = 0; i < children.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const cellX = contentX + col * (maxCellW + spacing);
    const cellY = contentY + row * (maxCellH + spacing);

    arrange(children[i], cellX, cellY, maxCellW, maxCellH);
  }
}

// ─── Full Layout Pass ────────────────────────────────────────────────────────

/**
 * Run both measure and arrange passes on a layout tree.
 * Returns the complete LayoutResult tree with final positions.
 */
export function computeLayout(
  root: LayoutNodeConfig,
  viewportWidth: number,
  viewportHeight: number,
  measureText?: (text: string, styles: Record<string, any>) => LayoutSize
): LayoutResult {
  const result = measure(root, viewportWidth, viewportHeight, measureText);
  arrange(result, 0, 0, viewportWidth, viewportHeight);
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveExplicitSize(
  size: number | "fill" | undefined,
  available: number
): number | undefined {
  if (size === undefined) return undefined;
  if (size === "fill" || (size as any) === "full") return available;
  return size;
}

function applyConstraints(
  size: LayoutSize,
  node: LayoutNodeConfig,
  availableW: number,
  availableH: number
): LayoutSize {
  let { width, height } = size;

  if (node.minWidth !== undefined) width = Math.max(node.minWidth, width);
  if (node.maxWidth !== undefined) {
    const maxW = node.maxWidth === ("fill" as any) ? availableW : node.maxWidth;
    width = Math.min(maxW, width);
  }
  if (node.minHeight !== undefined) height = Math.max(node.minHeight, height);
  if (node.maxHeight !== undefined) {
    const maxH = node.maxHeight === ("fill" as any) ? availableH : node.maxHeight;
    height = Math.min(maxH, height);
  }

  return { width, height };
}
