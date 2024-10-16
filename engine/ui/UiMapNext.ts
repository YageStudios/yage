import { Position } from "./Rectangle";
import { UIElement } from "./UIElement";
import { Text } from "./Text";
import { createByType } from "./UiConfigs";
import { Box } from "./Box";

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
  private uiElements: Map<string, UIElement<any>>;
  private rootElement: UIElement<any>;
  private variableDependencies: Map<string, Set<string>>;
  private eventHandler?: (playerIndex: number, eventName: string, eventType: string, context: any) => void;

  constructor(template: string) {
    this.template = template;
    this.ast = this.parseTemplate(template);
    this.context = {};
    this.previousContext = {};
    this.uiElements = new Map();
    this.variableDependencies = new Map();
    this.rootElement = new Box(new Position(0, 0), { children: [] });
  }

  private processTemplateString(templateStr: string, variableCallback?: (variableName: string) => void): string {
    return templateStr.replace(/{{\s*(.+?)\s*}}/g, (match, p1) => {
      const variableName = p1.trim();
      if (variableCallback) {
        variableCallback(variableName);
      }
      const value = this.getValueFromContext(variableName);
      return value !== undefined ? value : "";
    });
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
        body.push(this.parseElement(tokens));
      } else if (token.startsWith("{{")) {
        body.push(this.parseVariable(tokens.shift()!));
      } else {
        body.push({ type: "Text", content: tokens.shift()!.trim() });
      }
    }
    return { type: "Program", body };
  }

  private parseElement(tokens: string[]): ASTNode {
    const token = tokens.shift()!;
    const isClosingTag = token.startsWith("</");
    const tagMatch = token.match(/^<\/?([A-Za-z][^\s/>]*)/);
    if (!tagMatch) throw new Error(`Invalid tag: ${token}`);
    const tag = tagMatch[1];

    if (isClosingTag) {
      return { type: "Text", content: "" }; // Ignore closing tags here
    }

    const attributes = this.parseAttributes(token);
    const selfClosing = token.endsWith("/>") || ["Box", "Text", "Button", "TextInput", "Image"].indexOf(tag) === -1;
    const children: ASTNode[] = [];

    if (!selfClosing) {
      while (tokens.length > 0 && !tokens[0].startsWith(`</${tag}>`)) {
        if (tokens[0].startsWith("<")) {
          children.push(this.parseElement(tokens));
        } else if (tokens[0].startsWith("{{")) {
          children.push(this.parseVariable(tokens.shift()!));
        } else {
          children.push({ type: "Text", content: tokens.shift()!.trim() });
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
      attrs[match[1]] = match[2];
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

  private renderNode(node: ASTNode, parentElement: UIElement<any>): void {
    switch (node.type) {
      case "Program":
        node.body.forEach((child) => this.renderNode(child, parentElement));
        break;
      case "Element":
        this.renderElementNode(node, parentElement);
        break;
      case "Text":
        this.renderTextNode(node, parentElement);
        break;
      case "Variable":
        this.renderVariableNode(node, parentElement);
        break;
    }
  }

  private renderElementNode(node: ASTNode & { type: "Element" }, parentElement: UIElement<any>): void {
    const existingElement = this.uiElements.get(node.key!);
    let uiElement: UIElement<any>;

    if (existingElement) {
      // Update existing element
      uiElement = existingElement;
      this.updateAttributes(uiElement, node.attributes, node.key!);
    } else {
      // Create new element
      uiElement = this.createElement(node.tag, node.attributes, node.key!);
      this.uiElements.set(node.key!, uiElement);
      parentElement.addChild(uiElement);
    }

    // Recursively render or update children
    node.children.forEach((childNode) => this.renderNode(childNode, uiElement));
  }

  private renderTextNode(node: ASTNode & { type: "Text" }, parentElement: UIElement<any>): void {
    if (node.content.trim() === "") return;

    // For Text and Button elements, append the text to the label
    if (parentElement.config.label !== undefined) {
      parentElement.config.label += node.content;
    } else {
      // For other elements, create a Text UIElement
      const textElement = new Text(new Position(0, 0), { label: node.content });
      parentElement.addChild(textElement);
    }
  }

  private renderVariableNode(node: ASTNode & { type: "Variable" }, parentElement: UIElement<any>): void {
    const value = this.getValueFromContext(node.name);
    const valueStr = String(value);

    // For Text and Button elements, append the variable value to the label
    if (parentElement.config.label !== undefined) {
      parentElement.config.label += valueStr;
    } else {
      // For other elements, create a Text UIElement
      const textElement = new Text(new Position(0, 0), { label: valueStr });
      parentElement.addChild(textElement);
    }

    // Track variable dependencies
    const key = parentElement.id;
    if (!this.variableDependencies.has(node.name)) {
      this.variableDependencies.set(node.name, new Set());
    }
    this.variableDependencies.get(node.name)!.add(key);
  }

  private createElement(tag: string, attributes: Record<string, any>, key: string): UIElement<any> {
    const config: any = {};

    // Handle label separately for Text and Button elements
    if (tag === "Text" || tag === "Button") {
      config.label = "";
    }

    // Extract event handlers from attributes
    const eventHandlers = this.extractEventHandlers(attributes);

    // Generate event listener methods
    const events = this.generateEventListener(eventHandlers, this.context, this.eventHandler);

    // Merge events into config
    Object.assign(config, events);

    // Map other attributes to config (excluding event handler attributes)
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

    Object.entries(attributes).forEach(([attrKey, value]) => {
      if (!eventAttributes.includes(attrKey)) {
        const processedValue = this.processTemplateString(value, (variableName) => {
          if (!this.variableDependencies.has(variableName)) {
            this.variableDependencies.set(variableName, new Set());
          }
          this.variableDependencies.get(variableName)!.add(key);
        });
        config[attrKey] = processedValue;
      }
    });

    // Create UIElement based on tag

    if (!isNaN(config.x)) {
      config.x = parseFloat(config.x);
    }
    if (!isNaN(config.y)) {
      config.y = parseFloat(config.y);
    }
    const position = new Position(config.x ?? 0, config.y ?? 0, {
      width: config.width,
      height: config.height,
      maxHeight: config.maxHeight,
      maxWidth: config.maxWidth,
      minHeight: config.minHeight,
      minWidth: config.minWidth,
    });

    const uiElement = createByType({
      rect: position,
      type: tag.toLowerCase() as any,
      config,
    });

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
    eventListener?: (playerIndex: number, eventName: string, eventType: string, context: any) => void
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

  private updateAttributes(uiElement: UIElement<any>, attributes: Record<string, any>, key: string): void {
    // Remove previous variable dependencies for this key
    this.variableDependencies.forEach((keysSet, variableName) => {
      if (keysSet.has(key)) {
        keysSet.delete(key);
      }
      if (keysSet.size === 0) {
        this.variableDependencies.delete(variableName);
      }
    });

    Object.entries(attributes).forEach(([attrKey, value]) => {
      const processedValue = this.processTemplateString(value, (variableName) => {
        if (!this.variableDependencies.has(variableName)) {
          this.variableDependencies.set(variableName, new Set());
        }
        this.variableDependencies.get(variableName)!.add(key);
      });
      uiElement.config[attrKey] = processedValue;
    });
  }

  private getValueFromContext(path: string): any {
    return path.split(".").reduce((acc, part) => acc && acc[part], this.context);
  }

  /** Detect changes and update affected nodes */
  public update(newContext: any): void {
    const changedVariables = this.getChangedVariables(newContext);
    changedVariables.forEach((variableName) => {
      const affectedKeys = this.variableDependencies.get(variableName);
      if (affectedKeys) {
        affectedKeys.forEach((key) => {
          const uiElement = this.uiElements.get(key);
          if (uiElement) {
            // Re-render the node
            const node = this.findNodeByKey(this.ast, key);
            if (node && uiElement.parent) {
              this.renderNode(node, uiElement.parent as UIElement<any>);
            }
          }
        });
      }
    });
    this.previousContext = { ...this.context };
    this.context = { ...this.context, ...newContext };
  }

  private getChangedVariables(newContext: any): Set<string> {
    const changedVariables = new Set<string>();
    const allVariables = new Set([...Object.keys(this.context), ...Object.keys(newContext)]);
    allVariables.forEach((variableName) => {
      const oldValue = this.getValueFromContext(variableName);
      const newValue = this.getValueFromNewContext(variableName, newContext);
      if (oldValue !== newValue) {
        changedVariables.add(variableName);
      }
    });
    return changedVariables;
  }

  private getValueFromNewContext(path: string, newContext: any): any {
    return path.split(".").reduce((acc, part) => acc && acc[part], newContext);
  }

  private findNodeByKey(node: ASTNode, key: string): ASTNode | null {
    if (node.type === "Element" && node.key === key) {
      return node;
    } else if (node.type === "Program") {
      for (const child of node.body) {
        const found = this.findNodeByKey(child, key);
        if (found) return found;
      }
    } else if ("children" in node) {
      for (const child of node.children) {
        const found = this.findNodeByKey(child, key);
        if (found) return found;
      }
    }
    return null;
  }

  /** Utility functions */
  public getRootElement(): UIElement<any> {
    return this.rootElement;
  }
}
