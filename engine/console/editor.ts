import type { RegistryComponent } from "@/components/ComponentRegistry";
import { componentList, editorComponents } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
// @ts-ignore
import { FloatingWindow } from "./floatingwindow";
import { componentStringSchema } from "../decorators/type";
import lodash from "lodash";
import DescriptionSchema from "@/schemas/core/Description";
import { AttachSchema } from "@/schemas/entity/Attach";

type EditorInstance = {
  close: () => void;
  [key: string]: any;
};

type EditorState = "components" | "component" | "summary" | "addComponent";

let currentEditor: EditorInstance | null = null;

let JSONEditor = class {};
if (typeof window !== "undefined") {
  (async () => {
    // @ts-ignore
    JSONEditor = (await import("@json-editor/json-editor")).JSONEditor;
  })();
}

export const editor = (entity: number, gameModel: GameModel) => {
  if (currentEditor) {
    currentEditor.close();
  }

  currentEditor = Editor(entity, gameModel);
};

const stringToObj = function (path: string, obj: any, value?: any): any {
  const parts = path.split(".");
  let part;
  const last = parts.pop() as string;
  while ((part = parts.shift())) {
    if (typeof obj[part] != "object") obj[part] = {};
    obj = obj[part]; // update "pointer"
  }
  if (value === undefined) {
    return obj[last];
  } else {
    obj[last] = value;
  }
};

const Editor = (entity: number, gameModel: GameModel): EditorInstance => {
  if (typeof entity === "string") {
    entity = parseInt(entity);
  }
  const editorContainer = document.createElement("div");
  editorContainer.id = "editor";
  const contentContainer = document.createElement("div");
  contentContainer.id = "editor-content";
  const jsonEditorContainer = document.createElement("div");
  jsonEditorContainer.id = "json-editor";
  const logEntity = document.createElement("button");

  logEntity.innerText = "Log Entity";
  logEntity.onclick = () => {
    console.log("LOG ENTITY");
    gameModel.logEntity(entity, true);
  };

  const addComponentDropdown = document.createElement("select");
  addComponentDropdown.id = "add-component-dropdown";
  const addComponentButton = document.createElement("button");
  addComponentButton.innerText = "Add Component";

  const removeComponent = document.createElement("button");
  removeComponent.style.display = "none";

  editorContainer.appendChild(logEntity);
  editorContainer.appendChild(addComponentDropdown);
  editorContainer.appendChild(addComponentButton);
  editorContainer.appendChild(contentContainer);
  editorContainer.appendChild(removeComponent);

  editorContainer.appendChild(jsonEditorContainer);

  let state: EditorState = "summary";
  let customComponentUI: string | null = null;
  let editedComponent: string | null = null;
  let activeJsonEditor: any | null = null;
  let selectedComponent: string | null = null;

  removeComponent.innerText = "Remove Component";
  removeComponent.onclick = () => {
    if (!selectedComponent) return;
    gameModel.removeComponent(entity, selectedComponent);
    activeJsonEditor?.destroy();
    activeJsonEditor = null;
    editedComponent = null;
    selectedComponent = null;
  };

  addComponentButton.onclick = () => {
    const component = addComponentDropdown.value;
    gameModel.setComponent(entity, component);
    editedComponent = component;
    selectedComponent = component;
    state = "component";
  };

  contentContainer.addEventListener("click", (e) => {
    console.log(e.target);
    const dataset = (e.target as HTMLElement)?.dataset;

    if (dataset) {
      if (dataset.select) {
        selectedComponent = dataset.select;
      }
      if (dataset.customcomponent) {
        state = "component";
        customComponentUI = dataset.customcomponent ?? null;
      } else if (dataset.entity) {
        customComponentUI = null;
        editedComponent = null;
        activeJsonEditor?.destroy();
        activeJsonEditor = null;
        entity = parseInt(dataset.entity);
        state = "summary";
      } else if (dataset.edit) {
        editedComponent = dataset.edit;
        const componentSchema = componentStringSchema.get(editedComponent);
        if (activeJsonEditor) {
          activeJsonEditor.destroy();
        }
        // @ts-ignore
        activeJsonEditor = new JSONEditor(jsonEditorContainer, {
          // @ts-ignore
          schema: componentSchema.__schema,
        });
        activeJsonEditor.on("ready", () => {
          if (!editedComponent) return;
          activeJsonEditor?.setValue(gameModel.getComponent(entity, editedComponent));
          // editor.setValue(window.localStorage.getItem("LOCOMOTION"));
        });
        activeJsonEditor.on("change", () => {
          const value = activeJsonEditor?.getValue();
          if (!dataset.edit) return;
          gameModel.setComponent(entity, dataset.edit, value, true);
        });
      }
    }
  });

  const refresh = () => {
    if (!editedComponent) return;
    const value = gameModel.getComponent(entity, editedComponent);
    if (!lodash.isEqual(value, activeJsonEditor?.getValue())) {
      // @ts-ignore
      const editors = activeJsonEditor?.editors as any;

      const keys = Object.keys(editors)
        .map((key) => key.substring(5))
        .filter((key) => key !== "");
      for (const key of keys) {
        const editor = editors["root." + key];
        if (editor) {
          const val = stringToObj(key, value);
          if (editor.value !== val) {
            editor.setValue(val);
            editor.refreshValue();
          }
        }
      }

      // activeJsonEditor?.setValue(value, false);
    }
  };

  const updateComponentDropdown = (inactiveComponents: string[]) => {
    addComponentDropdown.innerHTML = "";
    for (const component of inactiveComponents) {
      const option = document.createElement("option");
      option.value = component;
      option.innerText = component;
      addComponentDropdown.appendChild(option);
    }
  };

  let previousInactiveComponentStrings: string[] = [];
  const generateSummary = () => {
    const entityData = gameModel.state.entityComponentArray[entity];

    if (!entityData) {
      return `<div>Entity ${entity} does not exist</div>`;
    }
    const { inactiveComponents, activeComponents } = componentList.reduce(
      (
        acc: {
          inactiveComponents: RegistryComponent[];
          activeComponents: RegistryComponent[];
        },
        component,
        i
      ) => {
        if (entityData.get(i)) {
          acc.activeComponents.push(component);
        } else {
          acc.inactiveComponents.push(component);
        }
        return acc;
      },
      { inactiveComponents: [], activeComponents: [] }
    );

    const inactiveComponentStrings = inactiveComponents.map((component) => component.type).sort();

    if (!lodash.isEqual(inactiveComponentStrings, previousInactiveComponentStrings)) {
      updateComponentDropdown(inactiveComponentStrings);
      previousInactiveComponentStrings = inactiveComponentStrings;
    }

    const generateHeader = () => {
      let prev = "";
      if (gameModel.hasComponent(entity, AttachSchema)) {
        const parentId = gameModel.getTyped(entity, AttachSchema).parent;
        if (parentId != undefined) {
          prev = `<span data-entity="${parentId}">Parent</span>`;
        }
      }

      if (gameModel.hasComponent(entity, DescriptionSchema)) {
        const description = gameModel.getTyped(entity, DescriptionSchema).description;
        return `${prev}<h1>Entity: ${entity} - ${description}</h1>`;
      }
      return `${prev}<h1>Entity: ${entity}</h1>`;
    };

    const nextHtml = `
      ${generateHeader()}
      <h2>Components</h2>
      <ul>
        ${activeComponents
          .sort((a, b) => a.type.localeCompare(b.type))
          .map((component) => {
            if (!component.schema) {
              return `<li data-select="${component.type}">${component.type}</li>`;
            }
            if (editorComponents[component.type]) {
              return `<li data-select="${component.type}" data-customcomponent="${component.type}">${component.type}</li>`;
            }
            return `<li data-select="${component.type}" data-edit="${component.type}">${component.type}</li>`;
          })
          .join("")}
      </ul>
    `;
    if (nextHtml !== contentContainer.innerHTML) {
      contentContainer.innerHTML = nextHtml;
    }
  };

  const floater = new FloatingWindow(editorContainer);

  generateSummary();

  const close = () => {
    floater.close();
    if (activeJsonEditor) {
      activeJsonEditor.destroy();
    }
    clearInterval(inter);
  };

  const inter = setInterval(() => {
    if (!gameModel.isActive(entity)) {
      close();
      return;
    }
    removeComponent.style.display = selectedComponent ? "block" : "none";
    generateSummary();

    if (state === "component" && customComponentUI) {
      editorComponents[customComponentUI].system(contentContainer, entity, gameModel);
    }
    if (activeJsonEditor) {
      refresh();
    }
  }, 100);

  return {
    close,
  };
};

// const openJsonEditor = () => {

//   const floater = new FloatingWindow(jsonEditorContainer);

//   var editor = new JSONEditor(jsonEditorContainer, {
//     schema: LocomotionSchema.__schema,
//   });
//   editor.on("load", () => {
//     editor.setValue(window.localStorage.getItem("LOCOMOTION"));
//   });
// };
