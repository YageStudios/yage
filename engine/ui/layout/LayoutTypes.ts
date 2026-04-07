/**
 * POSSPEC Layout Engine — Core Types & Primitives
 *
 * Center-origin coordinate system:
 *   - Every element's local origin (0,0) is its mathematical center
 *   - X increases right, Y increases down (standard Canvas2D)
 *   - Bounding box: [x - w/2, x + w/2] × [y - h/2, y + h/2]
 */

// ─── Size & Constraints ──────────────────────────────────────────────────────

export interface LayoutSize {
  width: number;
  height: number;
}

export interface LayoutConstraints {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const UNCONSTRAINED: LayoutConstraints = {
  minWidth: 0,
  maxWidth: Infinity,
  minHeight: 0,
  maxHeight: Infinity,
};

// ─── 9-Point Anchor/Pivot ────────────────────────────────────────────────────

export type NinePoint =
  | "TopLeft"
  | "TopCenter"
  | "TopRight"
  | "MiddleLeft"
  | "Center"
  | "MiddleRight"
  | "BottomLeft"
  | "BottomCenter"
  | "BottomRight";

/**
 * Resolve an anchor point to absolute pixel coordinates on a container.
 */
export function resolveAnchor(
  anchor: NinePoint,
  containerWidth: number,
  containerHeight: number
): { x: number; y: number } {
  let x = 0;
  let y = 0;

  // Horizontal
  if (anchor.includes("Left")) {
    x = 0;
  } else if (anchor.includes("Right")) {
    x = containerWidth;
  } else {
    // Center or Middle
    x = containerWidth / 2;
  }

  // Vertical
  if (anchor.startsWith("Top")) {
    y = 0;
  } else if (anchor.startsWith("Bottom")) {
    y = containerHeight;
  } else {
    // Middle or Center
    y = containerHeight / 2;
  }

  return { x, y };
}

/**
 * Resolve a pivot point to an offset from the child's center.
 * Returns how far the pivot is from the child's center.
 */
export function resolvePivot(
  pivot: NinePoint,
  childWidth: number,
  childHeight: number
): { x: number; y: number } {
  let x = 0;
  let y = 0;

  // Horizontal offset from center
  if (pivot.includes("Left")) {
    x = -childWidth / 2;
  } else if (pivot.includes("Right")) {
    x = childWidth / 2;
  }

  // Vertical offset from center
  if (pivot.startsWith("Top")) {
    y = -childHeight / 2;
  } else if (pivot.startsWith("Bottom")) {
    y = childHeight / 2;
  }

  return { x, y };
}

// ─── Alignment & Justification ───────────────────────────────────────────────

export type AlignItems = "Start" | "Center" | "End" | "Stretch";
export type JustifyContent = "Start" | "Center" | "End" | "SpaceBetween";
export type OverflowMode = "Visible" | "Hidden" | "Scroll" | "Scale" | "Wrap";

// ─── Layout Node Types ───────────────────────────────────────────────────────

export type LayoutNodeType =
  | "Canvas"
  | "VStack"
  | "HStack"
  | "Grid"
  | "Box"
  | "Text"
  | "Button"
  | "Image"
  | "Input";

// ─── Parsed Layout Node ──────────────────────────────────────────────────────

export interface LayoutNodeConfig {
  type: LayoutNodeType;
  id?: string;

  // Size
  width?: number | "fill";
  height?: number | "fill";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  // Padding
  padding?: number | number[];

  // Flex
  flex?: number;

  // Canvas child placement
  anchor?: NinePoint;
  pivot?: NinePoint;
  offset?: { x?: number; y?: number };

  // Stack properties
  spacing?: number;
  alignItems?: AlignItems;
  justifyContent?: JustifyContent;
  overflow?: OverflowMode;

  // Grid
  columns?: number;

  // Content
  text?: string;
  label?: string;
  texture?: string;
  value?: string;

  // Interaction
  focusable?: boolean;
  autoFocus?: boolean;
  captureFocus?: any;
  visible?: boolean;

  // Styles (visual only)
  styles?: Record<string, any>;
  focusStyle?: Record<string, any>;
  hoverStyle?: Record<string, any>;

  // Events
  events?: Record<string, string>;

  // Children
  children?: any[];

  // Grid data binding
  items?: string;
  element?: any;
}

// ─── Padding helper ──────────────────────────────────────────────────────────

export interface PaddingBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function parsePadding(padding: number | number[] | undefined): PaddingBox {
  if (padding === undefined || padding === 0) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  if (padding.length === 2) {
    return { top: padding[0], right: padding[1], bottom: padding[0], left: padding[1] };
  }
  if (padding.length === 4) {
    return { top: padding[0], right: padding[1], bottom: padding[2], left: padding[3] };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

// ─── Constraint helpers ──────────────────────────────────────────────────────

export function clampSize(size: LayoutSize, constraints: LayoutConstraints): LayoutSize {
  return {
    width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, size.width)),
    height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, size.height)),
  };
}

export function mergeConstraints(
  node: LayoutNodeConfig,
  parentConstraints: LayoutConstraints
): LayoutConstraints {
  return {
    minWidth: node.minWidth ?? parentConstraints.minWidth,
    maxWidth: node.maxWidth ?? parentConstraints.maxWidth,
    minHeight: node.minHeight ?? parentConstraints.minHeight,
    maxHeight: node.maxHeight ?? parentConstraints.maxHeight,
  };
}