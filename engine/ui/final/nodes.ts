import { type Readable, type Signal, type Value } from "./reactive";

export type Key = string | number;
export type Direction = "left" | "right" | "up" | "down";
export type NavigationAction = Direction | "next" | "previous" | "accept" | "cancel";
export type NodeType = "panel" | "row" | "column" | "grid" | "text" | "button" | "input" | "textarea" |
  "image" | "scroll" | "progress" | "slider" | "toggle";
export type StyleValue = string | number | null | undefined;
export type Style = Readonly<Record<string, Value<StyleValue>>>;
export type UIEventType = "activate" | "input" | "change" | "submit" | "cancel" | "focus" | "blur" |
  "pointerDown" | "pointerUp" | "pointerMove" | "pointerCancel" | "keyDown" | "keyUp";
export interface UIEvent {
  readonly type: UIEventType;
  readonly player: number;
  readonly target: EventTarget | null;
  readonly currentTarget: HTMLElement;
  readonly nativeEvent: Event;
  readonly value: string;
  readonly checked: boolean;
  readonly isComposing: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  capturePointer(): void;
  releasePointer(): void;
}
export type EventHandler = (event: UIEvent) => void;
export type EventHandlers = Partial<Record<UIEventType, EventHandler>>;
export interface Props {
  key?: Key;
  /** Stable, runtime-local public ID. Omit inside repeated templates or derive it from the item key. */
  id?: string;
  class?: Value<string | undefined>;
  style?: Style;
  attrs?: Readonly<Record<string, Value<string | number | boolean | null | undefined>>>;
  text?: Value<string | number | null | undefined>;
  value?: Value<string | number>;
  bindValue?: Signal<string>;
  bindChecked?: Signal<boolean>;
  checked?: Value<boolean>;
  indeterminate?: Value<boolean>;
  disabled?: Value<boolean>;
  hidden?: Value<boolean>;
  readOnly?: Value<boolean>;
  placeholder?: Value<string>;
  title?: Value<string>;
  label?: Value<string>;
  describedBy?: Value<string>;
  role?: string;
  lang?: Value<string>;
  dir?: Value<"ltr" | "rtl" | "auto">;
  src?: Value<string>;
  alt?: Value<string>;
  min?: Value<number>;
  max?: Value<number>;
  step?: Value<number>;
  maxLength?: Value<number>;
  name?: string;
  inputType?: "text" | "password" | "email" | "search" | "tel" | "url" | "number";
  autoComplete?: string;
  focusable?: boolean;
  autoFocus?: boolean;
  /** An empty array means no players. Undefined permits all players. */
  players?: Value<readonly number[] | undefined>;
  navigation?: Partial<Record<Direction | "next" | "previous", string>>;
  /** Restricts navigation to the nearest ancestor carrying this scope name. */
  focusScope?: string;
  /** Participate in pointer hit testing even when the node is not a native control. */
  interactive?: boolean;
  on?: EventHandlers;
  onCapture?: EventHandlers;
  ref?: (element: HTMLElement | null) => void;
}
export interface ElementNode { kind: "element"; type: NodeType; props: Props; children: readonly Child[]; key?: Key; }
export interface TextNode { kind: "text"; value: Value<string | number | null | undefined>; key?: Key; }
export interface DynamicNode { kind: "dynamic"; render: () => Child; key?: Key; }
export interface EachNode<T = unknown> {
  kind: "each";
  items: Value<readonly T[]>;
  itemKey: (item: T, index: number) => Key;
  render: (item: Readable<T>, index: Readable<number>) => Child;
  key?: Key;
}
export interface VirtualNode<T = unknown> {
  kind: "virtual";
  items: Value<readonly T[]>;
  itemKey: (item: T, index: number) => Key;
  render: (item: Readable<T>, index: Readable<number>) => Child;
  rowHeight: number;
  height: Value<number>;
  overscan?: number;
  props?: Props;
  key?: Key;
}
export type VNode = ElementNode | TextNode | DynamicNode | EachNode<any> | VirtualNode<any>;
export type Child = VNode | string | number | boolean | null | undefined | readonly Child[];
export function h(type: NodeType, props: Props = {}, ...children: Child[]): ElementNode {
  return { kind: "element", type, props, children, key: props.key };
}
export function text(value: TextNode["value"], key?: Key): TextNode { return { kind: "text", value, key }; }
export function dynamic(render: () => Child, key?: Key): DynamicNode { return { kind: "dynamic", render, key }; }
export function when(condition: Value<boolean>, then: () => Child, otherwise: () => Child = () => null, key?: Key): DynamicNode {
  return dynamic(() => {
    // Kept separate from child rendering: this tracks only values actually read in the chosen branch.
    const result = typeof condition === "function" ? condition() : typeof condition === "object" ? condition.get() : condition;
    return result ? then() : otherwise();
  }, key);
}
export function each<T>(items: Value<readonly T[]>, itemKey: EachNode<T>["itemKey"], render: EachNode<T>["render"], key?: Key): EachNode<T> {
  return { kind: "each", items, itemKey, render, key };
}
export function virtualList<T>(options: Omit<VirtualNode<T>, "kind">): VirtualNode<T> { return { kind: "virtual", ...options }; }

// Components remain ordinary TypeScript functions. No hooks, compiler, JSX transform, or global current view.
export const Panel = (props: Props = {}, ...children: Child[]) => h("panel", props, ...children);
export const Row = (props: Props = {}, ...children: Child[]) => h("row", props, ...children);
export const Column = (props: Props = {}, ...children: Child[]) => h("column", props, ...children);
export const Grid = (props: Props = {}, ...children: Child[]) => h("grid", props, ...children);
export const Text = (value: TextNode["value"], props: Props = {}) => h("text", { ...props, text: value });
export const Button = (props: Props = {}, ...children: Child[]) => h("button", props, ...children);
export const TextInput = (props: Props = {}) => h("input", props);
export const TextArea = (props: Props = {}) => h("textarea", props);
export const Image = (props: Props) => h("image", props);
export const Progress = (props: Props) => h("progress", props);
export const Slider = (props: Props) => h("slider", props);
export const Toggle = (props: Props) => h("toggle", props);
export const ScrollView = (props: Props = {}, ...children: Child[]) => h("scroll", props, ...children);
