import { Position } from "./Rectangle";
import { UIElement } from "./UIElement";
import { Text } from "./Text";
import { createByType } from "./UiConfigs";
import { Box } from "./Box";
import { isEqual } from "lodash";

type ASTNode =
  | { type: "Element"; tag: string; attributes: Record<string, any>; children: ASTNode[]; key?: string }
  | { type: "Text"; content: string }
  | { type: "Variable"; name: string }
  | { type: "Program"; body: ASTNode[] };

export class CustomUIParser {
  private template: string;
  private ast: ASTNode;
  private context: any;
  private previousContext: any;
  private uiElements: Map<string, [UIElement<any>, ASTNode]>;
  private rootElement: UIElement<any>;
  private variableDependencies: Map<string, Set<string>>;
  private functionPointers: Map<string, Map<string, () => void>> = new Map();
  private eventHandler?: (playerIndex: number, eventName: string, eventType: string, context: any) => void;

  constructor(template: string) {
    this.template = template;
    this.ast = this.parseTemplate(template);
    console.log(this.ast);
    this.context = {};
    this.previousContext = {};
    this.uiElements = new Map();
    this.variableDependencies = new Map();
    this.rootElement = new Box(new Position(0, 0), { children: [] });
  }

  private processTemplateString(
    templateStr: string,
    variableCallback?: (variableName: string, fullPath: string) => void,
    contextOverride?: any,
    contextPath: string[] = []
  ): string {
    const context = contextOverride || this.context;
    return templateStr.replace(/{{\s*(.+?)\s*}}/g, (match, p1) => {
      const variableName = p1.trim();
      const fullPath = this.resolveFullPath(variableName, contextPath);
      console.log(fullPath);
      if (variableCallback) {
        variableCallback(variableName, fullPath);
      }
      const value = this.getValueFromContextPath(fullPath, context);
      return value !== undefined ? value : "";
    });
  }

  private resolveFullPath(variableName: string, contextPath: string[]): string {
    if (variableName.startsWith("this.")) {
      return [...contextPath, variableName.replace(/^this\./, "")].filter(Boolean).join(".");
    } else if (variableName === "this") {
      return contextPath.join(".");
    } else if (variableName === "$index") {
      return [...contextPath, variableName].join(".");
    } else {
      return variableName;
    }
  }

  private getValueFromContextPath(path: string, context: any): any {
    const parts = path.split(".");
    let acc = context;
    for (const part of parts) {
      if (part === "this") {
        acc = acc && acc["this"];
      } else if (part === "$index") {
        acc = acc && acc["$index"];
      } else {
        acc = acc && acc[part];
      }
    }
    return acc;
  }

  /** Step 1: Preprocess the template into an AST */
  private parseTemplate(template: string): ASTNode {
    const tokens = this.tokenize(template);
    return this.parseProgram(tokens);
  }

  private tokenize(template: string): string[] {
    const regex = /<\/?[A-Za-z][^>]*>|{{[^}]+}}|[^<{{]+/g;
    return template.match(regex) || [];
  }

  private parseProgram(tokens: string[]): ASTNode {
    const body: ASTNode[] = [];
    while (tokens.length > 0) {
      const token = tokens[0];
      if (token.startsWith("<")) {
        const element = this.parseElement(tokens);
        if (element) {
          body.push(element);
        }
      } else if (token.startsWith("{{")) {
        body.push(this.parseVariable(tokens.shift()!));
      } else {
        const textTokens = tokens.shift()!.trim();
        if (textTokens !== "") {
          body.push({ type: "Text", content: textTokens });
        }
      }
    }
    return { type: "Program", body };
  }

  private parseElement(tokens: string[], depth = 0): ASTNode | null {
    const token = tokens.shift()!;
    const isClosingTag = token.startsWith("</");
    const tagMatch = token.match(/^<\/?([A-Za-z][^\s/>]*)/);
    if (!tagMatch) throw new Error(`Invalid tag: ${token}`);
    const tag = tagMatch[1];

    if (isClosingTag) {
      return null; // Ignore closing tags here
    }

    const attributes = this.parseAttributes(token);
    const selfClosing = token.endsWith("/>");
    const children: ASTNode[] = [];

    if (!selfClosing) {
      while (tokens.length > 0 && !tokens[0].startsWith(`</${tag}>`)) {
        if (tokens[0].startsWith("<")) {
          const childElement = this.parseElement(tokens, depth + 1);
          if (childElement) {
            children.push(childElement);
          }
        } else if (tokens[0].startsWith("{{")) {
          children.push(this.parseVariable(tokens.shift()!));
        } else {
          const textTokens = tokens.shift()!.trim();
          if (textTokens !== "") {
            children.push({ type: "Text", content: textTokens });
          }
        }
      }
      // Remove the closing tag
      if (tokens.length > 0 && tokens[0].startsWith(`</${tag}>`)) {
        tokens.shift();
      } else {
        throw new Error(`Missing closing tag for <${tag}>`);
      }
    }

    const key = this.generateKey();

    return { type: "Element", tag, attributes, children, key };
  }

  private parseAttributes(tagString: string): Record<string, any> {
    const attrRegex = /(\w+)=["']([^"']*)["']/g;
    const attrs: Record<string, any> = {};
    let match;
    while ((match = attrRegex.exec(tagString)) !== null) {
      if (match[1] === "style" && (match[2].includes(";") || !match[2].endsWith("}"))) {
        const styleAttrs = match[2].split(";");
        styleAttrs.forEach((styleAttr) => {
          if (styleAttr.trim() === "") return;
          const [key, value] = styleAttr.split(":");
          if (attrs.style === undefined) {
            attrs.style = {};
          }
          attrs.style = { ...attrs.style, [key.trim()]: value.trim() };
        });
      } else if (match[1] === "style" && match[2].startsWith("{")) {
        // Handle style as an object (if needed)
      } else {
        attrs[match[1]] = match[2];
      }
    }
    return attrs;
  }

  private parseVariable(token: string): ASTNode {
    const variableName = token.slice(2, -2).trim();
    return { type: "Variable", name: variableName };
  }

  private generateKey(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  /** Step 2 & 3: Build and Update the UI Elements */
  public build(
    context: any,
    eventHandler?: (playerIndex: number, eventName: string, eventType: string, context: any) => void
  ): UIElement<any> {
    this.previousContext = this.context;
    this.context = context;
    this.eventHandler = eventHandler;
    this.renderNode(this.ast, this.rootElement);
    return this.rootElement;
  }

  private renderNode(
    node: ASTNode,
    parentElement: UIElement<any>,
    contextOverride?: any,
    contextPath: string[] = []
  ): void {
    const context = contextOverride || this.context;
    switch (node.type) {
      case "Program":
        node.body.forEach((child) => this.renderNode(child, parentElement, context, contextPath));
        break;
      case "Element":
        this.renderElementNode(node as ASTNode & { type: "Element" }, parentElement, context, contextPath);
        break;
      case "Text":
        this.renderTextNode(node as ASTNode & { type: "Text" }, parentElement, context, contextPath);
        break;
      case "Variable":
        this.renderVariableNode(node as ASTNode & { type: "Variable" }, parentElement, context, contextPath);
        break;
    }
  }

  private renderElementNode(
    node: ASTNode & { type: "Element" },
    parentElement: UIElement<any>,
    contextOverride?: any,
    contextPath: string[] = []
  ): void {
    const context = contextOverride || this.context;
    const existingElement = this.uiElements.get(node.key!);
    let uiElement: UIElement<any>;

    if (existingElement) {
      // Update existing element
      [uiElement] = existingElement;
      this.updateAttributes(uiElement, node.attributes, node.key!, context, contextPath);
    } else {
      // Create new element
      uiElement = this.createElement(node.tag, node.attributes, node.key!, context, contextPath);
      this.uiElements.set(node.key!, [uiElement, node]);
      parentElement.addChild(uiElement);
    }

    if (node.tag === "Grid") {
      const itemsAttr = node.attributes.items;
      let items = [];
      let itemVariablePath = "";

      if (itemsAttr) {
        const processedItemsAttr = this.processTemplateString(
          itemsAttr,
          (variableName, fullPath) => {
            itemVariablePath = fullPath;
          },
          context,
          contextPath
        );

        if (!this.variableDependencies.has(itemVariablePath)) {
          this.variableDependencies.set(itemVariablePath, new Set());
        }
        this.variableDependencies.get(itemVariablePath)!.add(uiElement.id);

        items = this.getValueFromContextPath(itemVariablePath, context) || [];
      }

      const updateChildren = (items: any[]) => {
        const existingChildren = uiElement.getChildren() ?? [];
        const totalChildrenNeeded = items.length * node.children.length;

        if (existingChildren.length > totalChildrenNeeded) {
          const childrenToRemove = existingChildren.slice(totalChildrenNeeded);
          childrenToRemove.forEach((child: UIElement) => {
            uiElement.removeChild(child);
            this.uiElements.delete(child.id);
          });
        }

        for (let i = 0; i < items.length; i++) {
          const itemData = items[i];
          const itemContextPath = [...contextPath, itemVariablePath, i.toString()];
          const itemContext = { ...context, this: itemData, $index: i };

          for (let j = 0; j < node.children.length; j++) {
            const childNode = node.children[j];
            if (childNode.type === "Element") {
              const childKey = `${node.key!}_${i}_${childNode.key || j}`;
              const [existingChildElement] = this.uiElements.get(childKey) ?? [];
              if (existingChildElement) {
                // Update existing child element
                this.updateAttributes(
                  existingChildElement,
                  childNode.attributes,
                  childKey,
                  itemContext,
                  itemContextPath
                );
              } else {
                // Create new child element
                const clonedChildNode = { ...childNode, key: childKey };
                clonedChildNode.attributes = { ...clonedChildNode.attributes };
                clonedChildNode.attributes.style = {
                  position: "relative",
                  flex: "0 0 auto",
                  pointerEvents: "auto",
                  ...clonedChildNode.attributes.style,
                };
                this.renderNode(clonedChildNode, uiElement, itemContext, itemContextPath);
              }
            } else {
              this.renderNode(childNode, uiElement, itemContext, itemContextPath);
            }
          }
        }
      };

      updateChildren(items);
    } else {
      // Recursively render or update children
      node.children.forEach((childNode) => this.renderNode(childNode, uiElement, context, contextPath));
    }
  }

  private renderTextNode(
    node: ASTNode & { type: "Text" },
    parentElement: UIElement<any>,
    contextOverride?: any,
    contextPath: string[] = []
  ): void {
    const context = contextOverride || this.context;
    if (node.content.trim() === "") return;

    const processedContent = this.processTemplateString(node.content, undefined, context, contextPath);

    if (parentElement.config.label !== undefined) {
      parentElement.config.label += processedContent;
    } else {
      const textElement = new Text(new Position(0, 0), { label: processedContent });
      parentElement.addChild(textElement);
    }
  }

  private renderVariableNode(
    node: ASTNode & { type: "Variable" },
    parentElement: UIElement<any>,
    contextOverride?: any,
    contextPath: string[] = []
  ): void {
    const context = contextOverride || this.context;
    const fullPath = this.resolveFullPath(node.name, contextPath);
    const value = this.getValueFromContextPath(fullPath, context);
    let textElement: Text | undefined;
    let prevLabel: string;

    const updateText = () => {
      const value = this.getValueFromContextPath(fullPath, this.context);
      const valueStr = String(value);

      if (parentElement.config.label !== undefined) {
        prevLabel = parentElement.config.label;
        parentElement.config.label = prevLabel + valueStr;
      } else if (!textElement) {
        textElement = new Text(new Position(0, 0), { label: valueStr });
        parentElement.addChild(textElement);
      } else {
        textElement.config.label = valueStr;
      }
    };

    updateText();

    if (!this.variableDependencies.has(fullPath)) {
      this.variableDependencies.set(fullPath, new Set());
    }
    this.variableDependencies.get(fullPath)!.add(textElement?.id ?? parentElement.id);
    if (!this.functionPointers.has(textElement?.id ?? parentElement.id)) {
      this.functionPointers.set(textElement?.id ?? parentElement.id, new Map());
    }
    this.functionPointers.get(textElement?.id ?? parentElement.id)!.set(fullPath, updateText);
  }

  private generateStyleAttribute(
    attribute: Record<string, any>,
    contextOverride?: any,
    contextPath: string[] = []
  ): Record<string, any> {
    const context = contextOverride || this.context;
    const style = attribute.style || {};
    const processedStyle: Record<string, any> = {};

    Object.entries(style).forEach(([key, value]) => {
      const processedValue = this.processTemplateString(value?.toString() || "", undefined, context, contextPath);
      processedStyle[key] = processedValue;
    });

    return { ...attribute, ...processedStyle };
  }

  private watchStyleAttributes(attribute: Record<string, any>, element: UIElement, contextPath: string[]): void {
    const style = attribute.style || {};
    Object.entries(style).forEach(([key, value]) => {
      const originalValue = value?.toString() || "";
      this.processTemplateString(
        originalValue,
        (variableName, fullPath) => {
          if (!this.variableDependencies.has(fullPath)) {
            this.variableDependencies.set(fullPath, new Set());
          }
          this.variableDependencies.get(fullPath)!.add(element.id);
          if (!this.functionPointers.has(element.id)) {
            this.functionPointers.set(element.id, new Map());
          }
          this.functionPointers.get(element.id)!.set(fullPath, () => {
            const processedValue = this.processTemplateString(originalValue, undefined, this.context, contextPath);
            element.config.style[key] = processedValue;
          });
        },
        {},
        contextPath
      );
    });
  }

  private watchVariables(variables: [string, string, string, string[]][], element: UIElement): void {
    variables.forEach(([variableName, key, originalValue, contextPath]) => {
      const fullPath = this.resolveFullPath(variableName, contextPath);
      if (!this.variableDependencies.has(fullPath)) {
        this.variableDependencies.set(fullPath, new Set());
      }
      this.variableDependencies.get(fullPath)!.add(element.id);
      if (!this.functionPointers.has(element.id)) {
        this.functionPointers.set(element.id, new Map());
      }
      this.functionPointers.get(element.id)!.set(fullPath, () => {
        const processedValue = this.processTemplateString(originalValue, undefined, this.context, contextPath);
        element.config[key] = processedValue;
      });
    });
  }

  private watchPositionVariables(variables: [string, string, string, string[]][], element: UIElement): void {
    variables.forEach(([variableName, key, originalValue, contextPath]) => {
      const fullPath = this.resolveFullPath(variableName, contextPath);
      if (!this.variableDependencies.has(fullPath)) {
        this.variableDependencies.set(fullPath, new Set());
      }
      this.variableDependencies.get(fullPath)!.add(element.id);
      if (!this.functionPointers.has(element.id)) {
        this.functionPointers.set(element.id, new Map());
      }
      this.functionPointers.get(element.id)!.set(fullPath, () => {
        const processedValue = this.processTemplateString(originalValue, undefined, this.context, contextPath);
        // @ts-expect-error - adjust as per your Position class definition
        element.position[key] = processedValue;
      });
    });
  }

  private createElement(
    tag: string,
    attributes: Record<string, any>,
    key: string,
    contextOverride?: any,
    contextPath: string[] = []
  ): UIElement<any> {
    const context = contextOverride || this.context;
    const config: any = {};

    // Handle label separately for Text and Button elements
    if (tag === "Text" || tag === "Button") {
      config.label = "";
    }

    // Extract event handlers from attributes
    const eventHandlers = this.extractEventHandlers(attributes);

    // Generate event listener methods
    const events = this.generateEventListener(eventHandlers, context, this.eventHandler, contextPath);

    // Merge events into config
    Object.assign(config, events);

    // Map other attributes to config (excluding event handler attributes and items)
    const eventAttributes = [
      "onclick",
      "onmousedown",
      "onmouseup",
      "onmouseenter",
      "onmouseleave",
      "onfocus",
      "onblur",
      "onescape",
    ];

    const position = new Position(0, 0);
    const positionAttributes = ["x", "y", "width", "height", "maxHeight", "maxWidth", "minHeight", "minWidth"];

    let stylesGenerated = false;

    let variablesToWatch: [string, string, string, string[]][] = [];
    let positionVariablesToWatch: [string, string, string, string[]][] = [];

    Object.entries(attributes).forEach(([attrKey, value]) => {
      if (attrKey === "style") {
        config.style = this.generateStyleAttribute(attributes.style, context, contextPath);
        stylesGenerated = true;
      } else if (!eventAttributes.includes(attrKey) && attrKey !== "items" && !positionAttributes.includes(attrKey)) {
        const originalValue = value;
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            variablesToWatch.push([variableName, attrKey, originalValue, contextPath]);
          },
          context,
          contextPath
        );
        config[attrKey] = processedValue;
      } else if (positionAttributes.includes(attrKey)) {
        const originalValue = value;
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            positionVariablesToWatch.push([variableName, attrKey, originalValue, contextPath]);
          },
          context,
          contextPath
        );
        // @ts-expect-error - adjust as per your Position class definition
        position[attrKey] = processedValue;
      }
    });

    let uiElement: UIElement<any>;

    if (!isNaN(config.x)) {
      config.x = parseFloat(config.x);
    }
    if (!isNaN(config.y)) {
      config.y = parseFloat(config.y);
    }

    if (tag === "Grid") {
      config.renderOnScroll = true;
      config.style = {
        border: "none",
        display: "flex",
        flexWrap: "wrap",
        overflow: "auto",
        padding: "2px",
        alignContent: "flex-start",
        boxSizing: "border-box",
        pointerEvents: "none",
        gap: config.gap || "0",
        ...config.style,
      };

      uiElement = new Box(position, config);
    } else {
      uiElement = createByType({
        rect: position,
        type: tag.toLowerCase() as any,
        config,
      });
    }

    if (stylesGenerated) {
      this.watchStyleAttributes(attributes, uiElement, contextPath);
    }

    this.watchVariables(variablesToWatch, uiElement);

    this.watchPositionVariables(positionVariablesToWatch, uiElement);

    return uiElement;
  }

  private extractEventHandlers(attributes: Record<string, any>): Record<string, string> {
    const eventHandlers: Record<string, string> = {};
    const eventAttributes = [
      "onclick",
      "onmousedown",
      "onmouseup",
      "onmouseenter",
      "onmouseleave",
      "onfocus",
      "onblur",
      "onescape",
    ];
    eventAttributes.forEach((attr) => {
      if (attributes[attr]) {
        eventHandlers[attr] = attributes[attr];
      }
    });
    return eventHandlers;
  }

  private generateEventListener(
    events: Record<string, string>,
    contextRef: any,
    eventListener?: (playerIndex: number, eventName: string, eventType: string, context: any) => void,
    contextPath: string[] = []
  ) {
    const handler = eventListener;
    return events && Object.keys(events).length > 0
      ? {
          onEscape: (playerIndex: number) => {
            if (events.onescape && handler) {
              handler(playerIndex, events.onescape, "escape", contextRef);
            }
          },
          onClick: (playerIndex: number) => {
            if (events.onclick && handler) {
              handler(playerIndex, events.onclick, "click", contextRef);
            }
            return false;
          },
          onMouseDown: (playerIndex: number) => {
            if (events.onmousedown && handler) {
              handler(playerIndex, events.onmousedown, "mouseDown", contextRef);
            }
            return false;
          },
          onMouseUp: (playerIndex: number) => {
            if (events.onmouseup && handler) {
              handler(playerIndex, events.onmouseup, "mouseUp", contextRef);
            }
            return false;
          },
          onMouseEnter: (playerIndex: number) => {
            if (events.onmouseenter && handler) {
              handler(playerIndex, events.onmouseenter, "mouseEnter", contextRef);
            }
          },
          onMouseLeave: (playerIndex: number) => {
            if (events.onmouseleave && handler) {
              handler(playerIndex, events.onmouseleave, "mouseLeave", contextRef);
            }
          },
          onBlur: (playerIndex: number) => {
            if (events.onblur && handler) {
              handler(playerIndex, events.onblur, "blur", contextRef);
            }
          },
          onFocus: (playerIndex: number) => {
            if (events.onfocus && handler) {
              handler(playerIndex, events.onfocus, "focus", contextRef);
            }
          },
        }
      : {};
  }

  private updateAttributes(
    uiElement: UIElement<any>,
    attributes: Record<string, any>,
    key: string,
    contextOverride?: any,
    contextPath: string[] = []
  ): void {
    const context = contextOverride || this.context;
    // Remove previous variable dependencies for this key
    this.variableDependencies.forEach((keysSet, variableName) => {
      if (keysSet.has(key)) {
        keysSet.delete(key);
      }
      if (keysSet.size === 0) {
        this.variableDependencies.delete(variableName);
      }
    });

    let variablesToWatch: [string, string, string, string[]][] = [];
    let positionVariablesToWatch: [string, string, string, string[]][] = [];

    const positionAttributes = ["x", "y", "width", "height", "maxHeight", "maxWidth", "minHeight", "minWidth"];

    Object.entries(attributes).forEach(([attrKey, value]) => {
      if (attrKey === "style") {
        uiElement.config.style = this.generateStyleAttribute(attributes.style, context, contextPath);
        this.watchStyleAttributes(attributes, uiElement, contextPath);
      } else if (!positionAttributes.includes(attrKey)) {
        const originalValue = value;
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            variablesToWatch.push([variableName, attrKey, originalValue, contextPath]);
          },
          context,
          contextPath
        );
        uiElement.config[attrKey] = processedValue;
      } else {
        const originalValue = value;
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            positionVariablesToWatch.push([variableName, attrKey, originalValue, contextPath]);
          },
          context,
          contextPath
        );
        // @ts-expect-error - adjust as per your Position class definition
        uiElement.position[attrKey] = processedValue;
      }
    });

    this.watchVariables(variablesToWatch, uiElement);

    this.watchPositionVariables(positionVariablesToWatch, uiElement);
  }

  /** Detect changes and update affected nodes */
  public update(newContext: any): void {
    const changedVariables = this.getChangedVariables(newContext);
    changedVariables.forEach((variableName) => {
      const affectedKeys = this.variableDependencies.get(variableName);
      if (affectedKeys) {
        affectedKeys.forEach((key) => {
          this.functionPointers.get(key)?.get(variableName)?.();
        });
      }
    });
    this.previousContext = { ...this.context };
    this.context = { ...this.context, ...newContext };
  }

  private getChangedVariables(newContext: any): Set<string> {
    const changedVariables = new Set<string>();
    const allVariables = new Set([...this.variableDependencies.keys()]);
    allVariables.forEach((variablePath) => {
      const oldValue = this.getValueFromContextPath(variablePath, this.context);
      const newValue = this.getValueFromContextPath(variablePath, newContext);
      if (!isEqual(oldValue, newValue)) {
        changedVariables.add(variablePath);
      }
    });
    return changedVariables;
  }

  /** Utility functions */
  public getRootElement(): UIElement<any> {
    return this.rootElement;
  }
}
