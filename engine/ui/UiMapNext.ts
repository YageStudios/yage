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
  | { type: "Partial"; name: string; contextVariable?: string; params?: Record<string, any>; children?: ASTNode[] }
  | { type: "InlinePartial"; name: string; content: ASTNode[] }
  | { type: "ScopedBlock"; contextVariable: string; body: ASTNode[] }
  | { type: "IfBlock"; condition: string; consequent: ASTNode[]; alternate?: ASTNode[] }
  | { type: "UnlessBlock"; condition: string; body: ASTNode[] };

export class CustomUIParser {
  private template: string;
  private partials: Record<string, string>;
  private ast: ASTNode;
  private context: any;
  private previousContext: any;
  private uiElements: Map<string, [UIElement<any>, ASTNode, string[]]>;
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
      // JavaScript reserved words and built-in objects/functions
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

      const cacheKey = expression + "|" + contextPath.join(".");

      if (this.cachedExpressions.has(cacheKey)) {
        transformedExpression = this.cachedExpressions.get(cacheKey);
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
        });
        this.cachedExpressions.set(cacheKey, transformedExpression);
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
      return [...contextPath, variableName].join(".");
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
    const tokens: string[] = [];
    let i = 0;
    const length = template.length;

    while (i < length) {
      if (template[i] === "<") {
        // Start of a tag
        const start = i;
        i++;
        let inQuote = false;
        let quoteChar = "";
        while (i < length) {
          const c = template[i];
          if (inQuote) {
            if (c === quoteChar) {
              inQuote = false;
              quoteChar = "";
            }
          } else {
            if (c === '"' || c === "'") {
              inQuote = true;
              quoteChar = c;
            } else if (c === ">") {
              i++; // Include '>'
              break;
            }
          }
          i++;
        }
        tokens.push(template.substring(start, i));
      } else if (template[i] === "{" && template[i + 1] === "{") {
        // Start of a handlebars expression
        const start = i;
        i += 2;
        while (i < length) {
          if (template[i] === "}" && template[i + 1] === "}") {
            i += 2;
            break;
          }
          i++;
        }
        tokens.push(template.substring(start, i));
      } else {
        // Text content
        const start = i;
        while (i < length && template[i] !== "<" && !(template[i] === "{" && template[i + 1] === "{")) {
          i++;
        }
        tokens.push(template.substring(start, i));
      }
    }

    return tokens;
  }

  private parseProgram(tokens: string[]): ASTNode {
    const body = this.parseNodes(tokens);
    return { type: "Program", body };
  }

  private parseNodes(tokens: string[], stopCondition?: (tokens: string[]) => boolean): ASTNode[] {
    const nodes: ASTNode[] = [];
    while (tokens.length > 0) {
      if (stopCondition && stopCondition(tokens)) {
        break;
      }

      const token = tokens[0];

      if (!token.trim()) {
        tokens.shift();
        continue;
      }

      if (token.startsWith("{{")) {
        const commandNode = this.parseCommand(tokens);
        if (commandNode) {
          nodes.push(commandNode);
          continue;
        } else {
          // Not a partial, treat as text
          const textToken = tokens.shift()!;
          nodes.push({ type: "Text", content: textToken });
          continue;
        }
      } else if (token.startsWith("<")) {
        const element = this.parseElement(tokens);
        if (element) {
          nodes.push(element);
        }
      } else {
        // Text content
        let content = "";
        while (tokens.length > 0 && !tokens[0].startsWith("<") && !tokens[0].startsWith("{{")) {
          content += tokens.shift()!;
        }
        if (content.trim() !== "") {
          nodes.push({ type: "Text", content });
        }
      }
    }
    return nodes;
  }

  private joinTextNodes(nodes: ASTNode[]): ASTNode[] {
    return nodes.reduce((acc, node) => {
      if (node.type === "Text" && acc.length > 0 && acc[acc.length - 1].type === "Text") {
        (acc[acc.length - 1] as { type: "Text"; content: string }).content += node.content;
      } else {
        acc.push(node);
      }
      return acc;
    }, [] as ASTNode[]);
  }

  private parseCommand(tokens: string[]): ASTNode | null {
    let partial = this.parsePartial(tokens);
    if (partial) return partial;
    const isCommand = tokens[0].trim().startsWith("{{#");
    if (!isCommand) return null;

    // Try parsing if and unless blocks
    let blockNode = this.parseIfUnlessBlock(tokens);
    if (blockNode) return blockNode;

    let scopedBlock = this.parseScopedBlock(tokens);
    if (scopedBlock) return scopedBlock;
    return null;
  }

  /** Parsing {{#if}}, {{#unless}} blocks */
  private parseIfUnlessBlock(tokens: string[]): ASTNode | null {
    const token = tokens.shift()!;
    // Match if block syntax
    const ifOpenMatch = token.match(/^{{#if (.+?)}}$/);
    const ifCloseMatch = token.match(/^{{\/if}}$/);
    const unlessOpenMatch = token.match(/^{{#unless (.+?)}}$/);
    const unlessCloseMatch = token.match(/^{{\/unless}}$/);

    if (ifOpenMatch) {
      const condition = ifOpenMatch[1].trim();
      // Parse consequent body until {{else}} or {{/if}}
      const consequent = this.parseNodes(tokens, (tokens) => {
        const nextToken = tokens[0]?.trim();
        return nextToken === "{{else}}" || nextToken === "{{/if}}";
      });
      let alternate: ASTNode[] | undefined = undefined;
      if (tokens[0]?.trim() === "{{else}}") {
        tokens.shift(); // Consume {{else}}
        // Parse alternate body until {{/if}}
        alternate = this.parseNodes(tokens, (tokens) => tokens[0]?.trim() === "{{/if}}");
      }
      if (tokens[0]?.trim() === "{{/if}}") {
        tokens.shift(); // Consume {{/if}}
      } else {
        throw new Error("Missing closing tag for {{#if}}");
      }
      return {
        type: "IfBlock",
        condition,
        consequent: this.joinTextNodes(consequent),
        alternate: alternate ? this.joinTextNodes(alternate) : undefined,
      };
    }

    if (unlessOpenMatch) {
      const condition = unlessOpenMatch[1].trim();
      // Parse body until {{/unless}}
      const body = this.parseNodes(tokens, (tokens) => tokens[0]?.trim() === "{{/unless}}");
      if (tokens[0]?.trim() === "{{/unless}}") {
        tokens.shift(); // Consume {{/unless}}
      } else {
        throw new Error("Missing closing tag for {{#unless}}");
      }
      return { type: "UnlessBlock", condition, body: this.joinTextNodes(body) };
    }

    // If it's a closing tag for if or unless, we should not have gotten here
    if (ifCloseMatch || unlessCloseMatch) {
      // It's a closing tag, do nothing (handled in open tag parsing)
      return null;
    }

    // Not an if or unless block, put the token back
    tokens.unshift(token);
    return null;
  }

  private parseScopedBlock(tokens: string[]): ASTNode | null {
    const token = tokens.shift()!;
    // Match block syntax
    const scopedOpenMatch = token.match(/^{{#with (.+?)}}$/);
    const scopedCloseMatch = token.match(/^{{\/with}}$/);

    if (scopedOpenMatch) {
      const contextVariable = scopedOpenMatch[1];
      // Parse until the closing tag
      const body = this.parseNodes(tokens, (tokens) => tokens[0]?.trim() === `{{/with}}`);
      // Consume closing tag
      if (tokens.length > 0) tokens.shift();
      return { type: "ScopedBlock", contextVariable, body: this.joinTextNodes(body) };
    }

    if (scopedCloseMatch) {
      // It's a closing tag, do nothing (handled in open tag parsing)
      return null;
    }

    // Not a with block, put the token back
    tokens.unshift(token);
    return null;
  }

  private parsePartial(tokens: string[]): ASTNode | null {
    const token = tokens.shift()!;
    // Match partial syntax
    const partialOpenMatch = token.match(/^{{\s*(#\*?|>)\s*(.+?)\s*}}$/);
    const partialCloseMatch = token.match(/^{{\/\s*(.+?)\s*}}$/);

    if (partialOpenMatch) {
      const [_, type, content] = partialOpenMatch;
      if (type === ">" || type === "^?>") {
        // Basic or dynamic partial
        const parts = content.trim().split(/\s+/);
        const name = parts[0];
        const contextVariable = parts[1] || undefined;

        // The rest of parts are parameters
        const params = parts.slice(2).join(" ");
        const paramMap = this.parseParams(params);

        return { type: "Partial", name, contextVariable, params: paramMap };
      } else if (type === "#>") {
        // Partial block
        const name = content.trim();
        // Parse until the closing tag
        const children = this.parseNodes(tokens, (tokens) => tokens[0]?.trim() === `{{/${name}}}`);
        // Consume closing tag
        if (tokens.length > 0) tokens.shift();
        return { type: "Partial", name, children: this.joinTextNodes(children) };
      } else if (type === "#*inline") {
        // Inline partial
        const nameMatch = content.match(/"(.+?)"/);
        const name = nameMatch ? nameMatch[1] : "";
        // Parse until the closing tag
        const children = this.parseNodes(tokens, (tokens) => tokens[0]?.trim() === "{{/inline}}");
        // Consume closing tag
        if (tokens.length > 0) tokens.shift();
        return { type: "InlinePartial", name, content: this.joinTextNodes(children) };
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

  private parseElement(tokens: string[]): ASTNode | null {
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
    let children: ASTNode[] = [];

    if (!selfClosing) {
      children = this.parseNodes(tokens, (tokens) => tokens[0]?.startsWith(`</${tag}>`));
      // Remove the closing tag
      if (tokens.length > 0 && tokens[0].startsWith(`</${tag}>`)) {
        tokens.shift();
      } else {
        throw new Error(`Missing closing tag for <${tag}>`);
      }
      children = this.joinTextNodes(children);
    }

    const key = this.generateKey();

    return { type: "Element", tag, attributes, children, key };
  }

  private parseAttributes(tagString: string): Record<string, any> {
    tagString = tagString.substring(tagString.indexOf(" ") + 1, tagString.length - 1);

    const attrs: Record<string, any> = {};
    let i = 0;
    const len = tagString.length;
    let attrName = "";
    let attrValue = "";
    let state: "attrName" | "beforeEqual" | "beforeValue" | "attrValue" | "afterAttr" = "attrName";
    let quoteChar = "";
    let inExpression = false;

    while (i < len) {
      const c = tagString[i];

      switch (state) {
        case "attrName":
          if (/\s/.test(c)) {
            if (attrName) {
              state = "beforeEqual";
            }
            i++;
          } else if (c === "=") {
            state = "beforeValue";
            i++;
          } else if (c === ">" || c === "/") {
            // End of tag
            if (attrName) {
              attrs[attrName] = null;
            }
            i = len; // Exit loop
          } else {
            attrName += c;
            i++;
          }
          break;

        case "beforeEqual":
          if (c === "=") {
            state = "beforeValue";
          }
          i++;
          break;

        case "beforeValue":
          if (c === '"' || c === "'") {
            quoteChar = c;
            attrValue = "";
            state = "attrValue";
          }
          i++;
          break;

        case "attrValue":
          if (c === quoteChar && !inExpression) {
            attrs[attrName] = attrValue;
            attrName = "";
            attrValue = "";
            quoteChar = "";
            state = "afterAttr";
          } else {
            if (c === "{" && tagString.substr(i, 2) === "{{") {
              inExpression = true;
              attrValue += "{{";
              i += 2;
              continue;
            } else if (c === "}" && tagString.substr(i, 2) === "}}") {
              inExpression = false;
              attrValue += "}}";
              i += 2;
              continue;
            } else {
              attrValue += c;
            }
            i++;
          }
          break;

        case "afterAttr":
          if (/\s/.test(c)) {
            state = "attrName";
          } else if (c === ">" || c === "/") {
            i = len; // Exit loop
          }
          i++;
          break;
      }
    }

    if (attrName && !attrs.hasOwnProperty(attrName)) {
      attrs[attrName] = null;
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
    this.renderNode(this.ast, this.rootElement, []);
    return this.rootElement;
  }

  private renderNode(node: ASTNode, parentElement: UIElement<any>, contextPath: string[] = []): void {
    switch (node.type) {
      case "Program":
        node.body.forEach((child) => this.renderNode(child, parentElement, contextPath));
        break;
      case "Element":
        this.renderElementNode(node as ASTNode & { type: "Element" }, parentElement, contextPath);
        break;
      case "Text":
        this.renderTextNode(node as ASTNode & { type: "Text" }, parentElement, contextPath);
        break;
      case "ScopedBlock":
        this.renderScopedBlockNode(node as ASTNode & { type: "ScopedBlock" }, parentElement, contextPath);
        break;
      case "Partial":
        this.renderPartialNode(node as ASTNode & { type: "Partial" }, parentElement, contextPath);
        break;
      case "InlinePartial":
        this.registerInlinePartial(node as ASTNode & { type: "InlinePartial" }, contextPath);
        break;
      case "IfBlock":
        this.renderIfBlockNode(node as ASTNode & { type: "IfBlock" }, parentElement, contextPath);
        break;
      case "UnlessBlock":
        this.renderUnlessBlockNode(node as ASTNode & { type: "UnlessBlock" }, parentElement, contextPath);
        break;
    }
  }

  private renderIfBlockNode(
    node: ASTNode & { type: "IfBlock" },
    parentElement: UIElement<any>,
    contextPath: string[] = []
  ): void {
    let conditionResult = this.evaluateExpression(node.condition, this.context, contextPath);
    const container = new Box(new Position("left", "top", { width: "100%", height: "100%" }));
    this.uiElements.set(container.id, [container, node, contextPath]);
    parentElement.addChild(container);
    // Set up variable watchers for the condition
    const variablesInCondition = this.extractVariablesFromExpression(node.condition);
    variablesInCondition.forEach((variableName) => {
      const fullPath = this.resolveFullPath(variableName, contextPath);
      if (!this.variableDependencies.has(fullPath)) {
        this.variableDependencies.set(fullPath, new Set());
      }
      this.variableDependencies.get(fullPath)!.add(container.id);
      if (!this.functionPointers.has(container.id)) {
        this.functionPointers.set(container.id, new Map());
      }
      this.functionPointers.get(container.id)!.set(fullPath, () => {
        // When condition variable changes, re-render the if block
        let nextConditionResult = this.evaluateExpression(node.condition, this.context, contextPath);
        if (nextConditionResult !== conditionResult) {
          container.removeAllChildren();

          if (nextConditionResult) {
            this.renderNode({ type: "Program", body: node.consequent }, container, contextPath);
          } else if (node.alternate) {
            this.renderNode({ type: "Program", body: node.alternate }, container, contextPath);
          }
          container.update();
          conditionResult = nextConditionResult;
        }
      });
    });

    if (conditionResult) {
      this.renderNode({ type: "Program", body: node.consequent }, container, contextPath);
    } else if (node.alternate) {
      this.renderNode({ type: "Program", body: node.alternate }, container, contextPath);
    }
  }

  private renderUnlessBlockNode(
    node: ASTNode & { type: "UnlessBlock" },
    parentElement: UIElement<any>,
    contextPath: string[] = []
  ): void {
    let conditionResult = this.evaluateExpression(node.condition, this.context, contextPath);
    const container = new Box(new Position("left", "top", { width: "100%", height: "100%" }));
    parentElement.addChild(container);
    this.uiElements.set(container.id, [container, node, contextPath]);

    // Set up variable watchers for the condition
    const variablesInCondition = this.extractVariablesFromExpression(node.condition);
    variablesInCondition.forEach((variableName) => {
      const fullPath = this.resolveFullPath(variableName, contextPath);
      if (!this.variableDependencies.has(fullPath)) {
        this.variableDependencies.set(fullPath, new Set());
      }
      this.variableDependencies.get(fullPath)!.add(container.id);
      if (!this.functionPointers.has(container.id)) {
        this.functionPointers.set(container.id, new Map());
      }
      this.functionPointers.get(container.id)!.set(fullPath, () => {
        let nextConditionResult = this.evaluateExpression(node.condition, this.context, contextPath);
        if (nextConditionResult !== conditionResult) {
          container.removeAllChildren();
          conditionResult = nextConditionResult;
          if (!conditionResult) {
            this.renderNode({ type: "Program", body: node.body }, container, contextPath);
          }
          container.update();
        }
      });
    });

    if (!conditionResult) {
      this.renderNode({ type: "Program", body: node.body }, container, contextPath);
    }
  }

  private renderScopedBlockNode(
    node: ASTNode & { type: "ScopedBlock" },
    parentElement: UIElement<any>,
    contextOverride?: any,
    contextPath: string[] = []
  ): void {
    const fullPath = this.resolveFullPath(node.contextVariable, contextPath);
    const newContextPath = fullPath.split(".");
    this.renderNode({ type: "Program", body: node.body }, parentElement, newContextPath);
  }

  private renderPartialNode(
    node: ASTNode & { type: "Partial" },
    parentElement: UIElement<any>,
    contextPath: string[] = []
  ): void {
    const context = this.context;

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

    if (node.contextVariable) {
      const fullPath = this.resolveFullPath(node.contextVariable, contextPath);
      const newContextPath = fullPath.split(".");
      this.renderNode(partialAST, parentElement, newContextPath);
      return;
    }

    // Render partial
    this.renderNode(partialAST, parentElement, contextPath);
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
        return `{{> ${node.name} }}`;
      case "Program":
        return node.body.map((child) => this.nodeToString(child)).join("");
      case "InlinePartial":
        return `{{#*inline "${node.name}"}}${node.content
          .map((child) => this.nodeToString(child))
          .join("")}}{{/inline}}`;
      case "ScopedBlock":
        return node.body.map((child) => this.nodeToString(child)).join("");
      case "IfBlock":
        const consequent = node.consequent.map((child) => this.nodeToString(child)).join("");
        const alternate = node.alternate ? node.alternate.map((child) => this.nodeToString(child)).join("") : "";
        return `{{#if ${node.condition}}}${consequent}${node.alternate ? `{{else}}${alternate}` : ""}{{/if}}`;
      case "UnlessBlock":
        const body = node.body.map((child) => this.nodeToString(child)).join("");
        return `{{#unless ${node.condition}}}${body}{{/unless}}`;
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
    contextPath: string[] = []
  ): void {
    const existingElement = this.uiElements.get(node.key!);
    let uiElement: UIElement<any>;

    if (existingElement && !existingElement[0]?.destroyed) {
      // Update existing element
      [uiElement] = existingElement;
      this.updateAttributes(uiElement, node.attributes, node.key!, this.context, contextPath);
    } else {
      // Create new element
      uiElement = this.createElement(node.tag, node.attributes, node.key!, contextPath);
      this.uiElements.set(node.key!, [uiElement, node, contextPath]);
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
          this.context,
          contextPath
        );

        if (!this.variableDependencies.has(itemVariablePath)) {
          this.variableDependencies.set(itemVariablePath, new Set());
        }
        this.variableDependencies.get(itemVariablePath)!.add(uiElement.id);

        items = this.getValueFromContextPath(itemVariablePath, this.context) || [];
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
          const itemContext = { ...this.context, this: itemData, $index: i };

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
                this.renderNode(clonedChildNode, uiElement, itemContextPath);
              }
            } else {
              this.renderNode(childNode, uiElement, itemContextPath);
            }
          }
        }
      };

      updateChildren(items);
    } else {
      // Recursively render or update children
      node.children.forEach((childNode) => this.renderNode(childNode, uiElement, contextPath));
    }
  }

  private renderTextNode(
    node: ASTNode & { type: "Text" },
    parentElement: UIElement<any>,
    contextPath: string[] = []
  ): void {
    if (node.content.trim() === "") return;
    contextPath = [...contextPath];

    let variablesInExpression: string[] = [];
    const processedContent = this.processTemplateString(
      node.content,
      (variableName, fullPath) => {
        variablesInExpression.push(variableName);
      },
      this.context,
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

  private generateStyleAttribute(styleString: string, contextPath: string[] = []): Record<string, any> {
    const context = this.context;
    const processedStyleString = this.processTemplateString(styleString, undefined, context, contextPath);

    // Now, parse the processed style string into individual style properties
    const styleAttrs = processedStyleString.split(";").filter((s) => s.trim() !== "");
    const styleObj: Record<string, any> = {};

    styleAttrs.forEach((styleAttr) => {
      const [key, value] = styleAttr.split(":").map((s) => s.trim());
      if (key) {
        const camelCasedKey = key.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        styleObj[camelCasedKey] = value;
      }
    });

    return styleObj;
  }

  private watchStyleAttributes(attribute: Record<string, any>, element: UIElement, contextPath: string[]): void {
    const originalStyleValue = attribute.style || "";
    const variablesInStyle: string[] = [];
    this.processTemplateString(
      originalStyleValue,
      (variableName, fullPath) => {
        variablesInStyle.push(variableName);
      },
      {},
      contextPath
    );

    variablesInStyle.forEach((variableName) => {
      const fullPath = this.resolveFullPath(variableName, contextPath);
      if (!this.variableDependencies.has(fullPath)) {
        this.variableDependencies.set(fullPath, new Set());
      }
      this.variableDependencies.get(fullPath)!.add(element.id);
      if (!this.functionPointers.has(element.id)) {
        this.functionPointers.set(element.id, new Map());
      }
      this.functionPointers.get(element.id)!.set(fullPath, () => {
        // Re-process the style attribute
        const styleObj = this.generateStyleAttribute(originalStyleValue, contextPath);
        if (
          Object.keys(styleObj).some((key) => {
            return element.config.style[key] !== styleObj[key];
          })
        ) {
          element.config.style = { ...element.config.style, ...styleObj };
        }
      });
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
    contextPath: string[] = []
  ): UIElement<any> {
    const config: any = {};

    // Handle label separately for Text and Button elements
    if (tag === "Text" || tag === "Button") {
      config.label = "";
    }

    // Extract event handlers from attributes
    const eventHandlers = this.extractEventHandlers(attributes);

    // Generate event listener methods
    const events = this.generateEventListener(eventHandlers, this.eventHandler, contextPath);

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
    const positionAttributes = [
      "x",
      "y",
      "yOffset",
      "xOffset",
      "width",
      "height",
      "maxHeight",
      "maxWidth",
      "minHeight",
      "minWidth",
    ];

    let stylesGenerated = false;

    let variablesToWatch: [string[], string, string, string[]][] = [];
    let positionVariablesToWatch: [string[], string, string, string[]][] = [];

    Object.entries(attributes).forEach(([attrKey, value]) => {
      if (attrKey === "style") {
        if (typeof attributes.style === "string") {
          config.style = { ...config.style, ...this.generateStyleAttribute(attributes.style, contextPath) };
          stylesGenerated = true;
        } else {
          config.style = attributes.style;
        }
      } else if (!eventAttributes.includes(attrKey) && attrKey !== "items" && !positionAttributes.includes(attrKey)) {
        const originalValue = value;
        let variablesInExpression: string[] = [];
        const processedValue = this.processTemplateString(
          value,
          (variableName, fullPath) => {
            variablesInExpression.push(variableName);
          },
          this.context,
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
          this.context,
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
    eventListener?: (playerIndex: number, eventName: string, eventType: string, context: any) => void,
    contextPath: string[] = []
  ) {
    const contextRef = this.context;
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
        uiElement.config.style = this.generateStyleAttribute(attributes.style, contextPath);
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
