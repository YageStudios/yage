import { Schema } from "minecs";
interface AjvSchema {
  type: string | string[];
  properties?: Record<string, AjvSchema>;
  items?: AjvSchema;
  required?: string[];
  default?: any;
  [key: string]: any;
}

function ajvSchemaToMarkdown(component: typeof Schema, type: string, indent: string = ""): string {
  const { schema } = component;
  let markdown = `${indent}# ${type ?? schema.$comment}\n\n`;

  function formatType(prop: AjvSchema): string {
    if (Array.isArray(prop.type)) {
      return prop.type.join(" | ");
    }
    return prop.type || "any";
  }

  function formatDefault(prop: AjvSchema): string {
    if (prop.default !== undefined) {
      return `Default: \`${JSON.stringify(prop.default)}\``;
    }
    return "";
  }

  function formatProperty(name: string, prop: AjvSchema, required: boolean, indent: string = ""): string {
    const typeStr = formatType(prop);
    const defaultStr = formatDefault(prop);
    const requiredStr = required ? "(required)" : "(optional)";

    let md = `${indent}- **${name}** (${typeStr}) ${requiredStr}`;
    if (defaultStr) md += `: ${defaultStr}`;
    md += "\n";

    if (prop.properties) {
      md += `${indent}  Properties:\n`;
      md += processProperties(prop.properties, prop.required || [], indent + "  ");
    }

    if (prop.items) {
      md += `${indent}  Items:\n`;
      md += formatProperty("item", prop.items, true, indent + "  ");
    }

    return md;
  }

  function processProperties(properties: Record<string, AjvSchema>, required: string[], indent: string): string {
    let md = "";
    for (const [name, prop] of Object.entries(properties)) {
      md += formatProperty(name, prop, required.includes(name), indent);
    }
    return md;
  }

  if (schema.properties) {
    markdown += processProperties(schema.properties, schema.required || [], indent);
  } else {
    markdown += formatProperty("value", schema, true);
  }

  return markdown;
}

export function componentToMarkdown(component: typeof Schema): string {
  if (!component.schema) {
    return "# " + component.type + "\n\nNo properties for this schema.\n";
  }
  return ajvSchemaToMarkdown(component, component.type);
}
