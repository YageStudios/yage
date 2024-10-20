import { Position } from "./Rectangle";
import { UIElement } from "./UIElement";
import { Text } from "./Text";
import { createByType } from "./UiConfigs";
import { Box } from "./Box";
import { isEqual } from "lodash";

type ASTNode =
  | { type: "Element"; tag: string; attributes: Record<string, any>; children: ASTNode[]; key?: string }
  | { type: "Text"; content: string }
  | { type: "Program"; body: ASTNode[] }
  | { type: "Partial"; name: string; context?: string; params?: Record<string, any>; children?: ASTNode[] }
  | { type: "InlinePartial"; name: string; content: ASTNode[] };

export class CustomUIParser {
  private template: string;
  private partials: Record<string, string>;
  private ast: ASTNode;
  private context: any;
  private previousContext: any;
  private uiElements: Map<string, [UIElement<any>, ASTNode]>;
  private rootElement: UIElement<any>;
  private variableDependencies: Map<string, Set<string>>;
  private functionPointers: Map<string, Map<string, () => void>> = new Map();
  private eventHandler?: (playerIndex: number, eventName: string, eventType: string, context: any) => void;

  constructor(template: string, partials: Record<string, string> = {}) {
    this.template = template;
    this.partials = partials;
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
      const expression = p1.trim();
      if (variableCallback) {
        const variables = this.extractVariablesFromExpression(expression);
        variables.forEach((variableName) => {
          const fullPath = this.resolveFullPath(variableName, contextPath);
          variableCallback(variableName, fullPath);
        });
      }
      const value = this.evaluateExpression(expression, context, contextPath);
      return value !== undefined ? value : "";
    });
  }

  private extractVariablesFromExpression(expression: string): string[] {
    const variableRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*\b/g;
    const excludedKeywords = new Set([
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "debugger",
      "default",
      "delete",
      "do",
      "else",
      "export",
      "extends",
      "finally",
      "for",
      "function",
      "if",
      "import",
      "in",
      "instanceof",
      "let",
      "new",
      "return",
      "super",
      "switch",
      "throw",
      "try",
      "typeof",
      "var",
      "void",
      "while",
      "with",
      "yield",
      // built-in objects
      "Array",
      "Boolean",
      "Date",
      "Error",
      "Function",
      "JSON",
      "Math",
      "Number",
      "Object",
      "RegExp",
      "String",
      "Promise",
      "Symbol",
      "Map",
      "Set",
      "WeakMap",
      "WeakSet",
      "ArrayBuffer",
      "DataView",
      "Float32Array",
      "Float64Array",
      "Int8Array",
      "Int16Array",
      "Int32Array",
      "Uint8Array",
      "Uint16Array",
      "Uint32Array",
      "Uint8ClampedArray",
      "BigInt64Array",
      "BigUint64Array",
      "BigInt",
      "Infinity",
      "NaN",
      "undefined",
      "null",
      "globalThis",
      // other built-in functions
      "isNaN",
      "parseInt",
      "parseFloat",
      "encodeURI",
      "encodeURIComponent",
      "decodeURI",
      "decodeURIComponent",
      "eval",
    ]);

    const variables = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = variableRegex.exec(expression)) !== null) {
      const varName = match[0];
      if (!excludedKeywords.has(varName)) {
        variables.add(varName);
      }
    }

    return Array.from(variables);
  }

  private cachedExpressions: Map<string, any> = new Map();

  private evaluateExpression(expression: string, context: any, contextPath: string[]): any {
    try {
      const variables = this.extractVariablesFromExpression(expression);

      let transformedExpression = expression;

      if (this.cachedExpressions.has(expression + "|" + contextPath.join("."))) {
        transformedExpression = this.cachedExpressions.get(expression + "|" + contextPath.join("."));
      } else {
        variables.forEach((variableName) => {
          let fullPath = this.resolveFullPath(variableName, contextPath);
          fullPath = fullPath.replace(/\.(\d+)(\.|$)/g, "[$1]$2");

          const variablePath = "context" + (fullPath ? "." + fullPath : "");

          // Escape special regex characters in variableName
          let escapedVarName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

          // Replace variable name with variablePath in the expression
          const regex = new RegExp("\\b" + escapedVarName + "\\b", "g");

          transformedExpression = transformedExpression.replace(regex, variablePath);
          this.cachedExpressions.set(expression + "|" + contextPath.join("."), transformedExpression);
        });
      }

      const func = new Function("context", "return " + transformedExpression + ";");

      return func(context);
    } catch (e) {
      console.error("Error evaluating expression:", expression, e);
      return undefined;
    }
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
        acc = acc;
      } else if (part === "$index") {
        acc = acc["$index"];
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
    const regex = /{{#\*?[^}]+}}|{{\/[^}]+}}|{{[^}]+}}|<\/?[A-Za-z][^>]*>|[^<{{]+/g;
    return template.match(regex) || [];
  }

  private parseProgram(tokens: string[]): ASTNode {
    const body: ASTNode[] = [];
    while (tokens.length > 0) {
      const token = tokens[0];
      if (token.startsWith("{{")) {
        console.log(token);
        const partialNode = this.parsePartial(tokens);
        if (partialNode) {
          body.push(partialNode);
          continue;
        }
      }
      if (token.startsWith("<")) {
        const element = this.parseElement(tokens);
        if (element) {
          body.push(element);
        }
      } else {
        // Combine consecutive text and variable tokens
        let content = "";
        while (tokens.length > 0 && !tokens[0].startsWith("<")) {
          content += tokens.shift()!;
        }
        if (content.trim() !== "") {
          body.push({ type: "Text", content });
        }
      }
    }
    return { type: "Program", body };
  }

  private parsePartial(tokens: string[]): ASTNode | null {
    const token = tokens.shift()!;
    // Match partial syntax
    const partialOpenMatch = token.match(/^{{\s*(#\*?|\^?>)\s*(.+?)\s*}}$/);
    const partialCloseMatch = token.match(/^{{\/\s*(.+?)\s*}}$/);

    if (partialOpenMatch) {
      const [_, type, content] = partialOpenMatch;
      if (type === ">" || type === "^?>") {
        // Basic or dynamic partial
        const [name, ...params] = content.split(/\s+/);
        const paramMap = this.parseParams(params.join(" "));
        return { type: "Partial", name, params: paramMap };
      } else if (type === "#>") {
        // Partial block
        const name = content.trim();
        const children: ASTNode[] = [];
        // Parse until the closing tag
        while (tokens.length > 0 && !(tokens[0].trim() === `{{/${name}}}`)) {
          const childNode = this.parseProgram(tokens);
          children.push(childNode);
        }
        // Consume closing tag
        if (tokens.length > 0) tokens.shift();
        return { type: "Partial", name, children };
      } else if (type === "#*inline") {
        // Inline partial
        const nameMatch = content.match(/"(.+?)"/);
        const name = nameMatch ? nameMatch[1] : "";
        const children: ASTNode[] = [];
        // Parse until the closing tag
        while (tokens.length > 0 && !(tokens[0].trim() === "{{/inline}}")) {
          const childNode = this.parseProgram(tokens);
          children.push(childNode);
        }
        // Consume closing tag
        if (tokens.length > 0) tokens.shift();
        return { type: "InlinePartial", name, content: children };
      }
    }

    if (partialCloseMatch) {
      // It's a closing tag, do nothing (handled in open tag parsing)
      return null;
    }

    // Not a partial, put the token back
    tokens.unshift(token);
    return null;
  }

  private parseParams(paramString: string): Record<string, any> {
    const params: Record<string, any> = {};
    const regex = /(\w+)=(["'])(.*?)\2/g;
    let match;
    while ((match = regex.exec(paramString)) !== null) {
      params[match[1]] = match[3];
    }
    return params;
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
        } else {
          // Combine consecutive text and variable tokens
          let content = "";
          while (tokens.length > 0 && !tokens[0].startsWith("<") && !tokens[0].startsWith(`</${tag}>`)) {
            content += tokens.shift()!;
          }
          if (content.trim() !== "") {
            children.push({ type: "Text", content });
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
      case "Partial":
        this.renderPartialNode(node as ASTNode & { type: "Partial" }, parentElement, context, contextPath);
        break;
      case "InlinePartial":
        this.registerInlinePartial(node as ASTNode & { type: "InlinePartial" }, context, contextPath);
        break;
    }
  }

  private renderPartialNode(
    node: ASTNode & { type: "Partial" },
    parentElement: UIElement<any>,
    contextOverride?: any,
    contextPath: string[] = []
  ): void {
    const context = contextOverride || this.context;

    // Handle dynamic partials
    let partialName = node.name;
    if (partialName.startsWith("(") && partialName.endsWith(")")) {
      const expression = partialName.slice(1, -1).trim();
      partialName = this.evaluateExpression(expression, context, contextPath);
    }

    // Retrieve partial content
    let partialTemplate = this.partials[partialName];
    if (!partialTemplate && node.children) {
      // Use partial block content as fallback
      partialTemplate = node.children.map((child) => this.nodeToString(child)).join("");
    }

    if (!partialTemplate) {
      console.warn(`Partial "${partialName}" not found.`);
      return;
    }

    // Parse partial template
    const partialAST = this.parseTemplate(partialTemplate);

    // // Merge parameters into context
    // let partialContext = context;
    // if (node.params) {
    //   partialContext = { ...context, ...node.params };
    // }

    let partialContext = context;
    if (node.params) {
      if (node.params[0]) {
        const contextExpression = node.params[0];
        const newContext = this.evaluateExpression(contextExpression, context, contextPath);
        partialContext = newContext;
      }
      // Merge hash parameters
      partialContext = { ...partialContext, ...node.params };
    }

    // Render partial
    this.renderNode(partialAST, parentElement, partialContext, contextPath);
  }

  private nodeToString(node: ASTNode): string {
    switch (node.type) {
      case "Text":
        return node.content;
      case "Element":
        const attrs = Object.entries(node.attributes)
          .map(([key, value]) => `${key}="${value}"`)
          .join(" ");
        const children = node.children.map((child) => this.nodeToString(child)).join("");
        return `<${node.tag} ${attrs}>${children}</${node.tag}>`;
      case "Partial":
        // Simplified; you may need to handle params and context
        return `{{> ${node.name} }}`;
      case "Program":
        return node.body.map((child) => this.nodeToString(child)).join("");
      case "InlinePartial":
        // Simplified
        return `{{#*inline "${node.name}"}}${node.content
          .map((child) => this.nodeToString(child))
          .join("")}}{{/inline}}`;
      default:
        return "";
    }
  }

  private registerInlinePartial(
    node: ASTNode & { type: "InlinePartial" },
    contextOverride?: any,
    contextPath: string[] = []
  ): void {
    const content = node.content.map((child) => this.nodeToString(child)).join("");
    this.partials[node.name] = content;
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
        this.processTemplateString(
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
          const itemContextPath = [...contextPath, itemVariablePath.split(".").pop() || "", i.toString()];
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

    let variablesInExpression: string[] = [];
    const processedContent = this.processTemplateString(
      node.content,
      (variableName, fullPath) => {
        variablesInExpression.push(variableName);
      },
      context,
      contextPath
    );

    if (parentElement.config.label !== undefined) {
      parentElement.config.label += processedContent;
    } else if (parentElement instanceof Text) {
      parentElement.config.label = (parentElement.config.label || "") + processedContent;
    } else {
      const textElement = new Text(new Position(0, 0), { label: processedContent });
      parentElement.addChild(textElement);
      parentElement = textElement;
    }

    // Set up variable watchers
    variablesInExpression.forEach((variableName) => {
      const fullPath = this.resolveFullPath(variableName, contextPath);
      if (!this.variableDependencies.has(fullPath)) {
        this.variableDependencies.set(fullPath, new Set());
      }
      this.variableDependencies.get(fullPath)!.add(parentElement.id);
      if (!this.functionPointers.has(parentElement.id)) {
        this.functionPointers.set(parentElement.id, new Map());
      }
      this.functionPointers.get(parentElement.id)!.set(fullPath, () => {
        const updatedContent = this.processTemplateString(node.content, undefined, this.context, contextPath);
        parentElement.config.label = updatedContent;
      });
    });
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

    return { ...attribute, style: processedStyle };
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

  private watchVariables(variables: [string[], string, string, string[]][], element: UIElement): void {
    variables.forEach(([variableNames, key, originalValue, contextPath]) => {
      variableNames.forEach((variableName) => {
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
    });
  }

  private watchPositionVariables(variables: [string[], string, string, string[]][], element: UIElement): void {
    variables.forEach(([variableNames, key, originalValue, contextPath]) => {
      variableNames.forEach((variableName) => {
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

    let variablesToWatch: [string[], string, string, string[]][] = [];
    let positionVariablesToWatch: [string[], string, string, string[]][] = [];

    Object.entries(attributes).forEach(([attrKey, value]) => {
      if (attrKey === "style") {
        config.style = this.generateStyleAttribute(attributes.style, context, contextPath);
        stylesGenerated = true;
      } else if (!eventAttributes.includes(attrKey) && attrKey !== "items" && !positionAttributes.includes(attrKey)) {
        const originalValue = value;
        let variablesInExpression: string[] = [];
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            variablesInExpression.push(variableName);
          },
          context,
          contextPath
        );
        variablesToWatch.push([variablesInExpression, attrKey, originalValue, contextPath]);
        config[attrKey] = processedValue;
      } else if (positionAttributes.includes(attrKey)) {
        const originalValue = value;
        let variablesInExpression: string[] = [];
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            variablesInExpression.push(variableName);
          },
          context,
          contextPath
        );
        positionVariablesToWatch.push([variablesInExpression, attrKey, originalValue, contextPath]);
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

    let variablesToWatch: [string[], string, string, string[]][] = [];
    let positionVariablesToWatch: [string[], string, string, string[]][] = [];

    const positionAttributes = ["x", "y", "width", "height", "maxHeight", "maxWidth", "minHeight", "minWidth"];

    Object.entries(attributes).forEach(([attrKey, value]) => {
      if (attrKey === "style") {
        uiElement.config.style = this.generateStyleAttribute(attributes.style, context, contextPath);
        this.watchStyleAttributes(attributes, uiElement, contextPath);
      } else if (!positionAttributes.includes(attrKey)) {
        const originalValue = value;
        let variablesInExpression: string[] = [];
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            variablesInExpression.push(variableName);
          },
          context,
          contextPath
        );
        variablesToWatch.push([variablesInExpression, attrKey, originalValue, contextPath]);
        uiElement.config[attrKey] = processedValue;
      } else {
        const originalValue = value;
        let variablesInExpression: string[] = [];
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            variablesInExpression.push(variableName);
          },
          context,
          contextPath
        );
        positionVariablesToWatch.push([variablesInExpression, attrKey, originalValue, contextPath]);
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
