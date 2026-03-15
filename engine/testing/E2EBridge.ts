import type { GameInstance } from "yage/game/GameInstance";
import type { GameModel } from "yage/game/GameModel";
import { InputManager, InputEventType } from "yage/inputs/InputManager";
import type { E2EConnectionInstance } from "yage/connection/E2EConnectionInstance";
import { GameCoordinator } from "yage/game/GameCoordinator";
import { UIService } from "yage/ui/UIService";
import type { UIElement } from "yage/ui/UIElement";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { stepWorldDraw } from "minecs";
import { componentList, hasComponent } from "minecs";

/**
 * Serialized representation of a UI element passed back to Node.js via Playwright.
 */
export interface SerializedUIElement {
  id: string;
  type: string;
  text: string;
  visible: boolean;
  bounds: [number, number, number, number];
}

/**
 * Serialized representation of an ECS entity passed back to Node.js via Playwright.
 */
export interface SerializedEntityState {
  id: number;
  description: string;
  components: Record<string, any>;
}

/**
 * Query interface for finding UI elements.
 */
export interface UIQuery {
  id?: string;
  type?: string;
  text?: string;
  textIncludes?: string;
}

/**
 * Query interface for finding ECS entities.
 */
export interface ECSQuery {
  components: string[];
  filters?: Record<string, any>;
}

/**
 * Tick result returned from executeTicks to coordinate with Node.js side.
 */
export interface TickResult {
  completed: boolean;
  framesExecuted: number;
  pausedAt?: number;
  requiresScreenshot?: boolean;
  errors: string[];
}

/**
 * E2EBridge is injected into the browser window as `window.__YAGE_E2E__`.
 * It provides the RPC surface that Node.js (via Playwright page.evaluate()) uses to
 * control the game engine deterministically.
 */
export class E2EBridge {
  public ready = false;
  public errors: string[] = [];
  public currentFrame = 0;

  private gameInstance: GameInstance<any>;
  private connection: E2EConnectionInstance<any>;
  private inputManager: InputManager;
  private screenshotInterval = 0;

  constructor(gameInstance: GameInstance<any>, inputManager: InputManager) {
    this.gameInstance = gameInstance;
    this.connection = gameInstance.options.connection as E2EConnectionInstance<any>;
    this.inputManager = inputManager;

    // Set up global error trapping
    this.setupErrorTrapping();
  }

  /**
   * Set up error trapping for unhandled exceptions and rejections.
   */
  private setupErrorTrapping() {
    window.onerror = (message, source, lineno, colno, error) => {
      const errorMsg = `[${source}:${lineno}:${colno}] ${message}${error?.stack ? "\n" + error.stack : ""}`;
      this.errors.push(errorMsg);
    };

    window.addEventListener("unhandledrejection", (event) => {
      const errorMsg = `Unhandled rejection: ${event.reason?.stack || event.reason}`;
      this.errors.push(errorMsg);
    });
  }

  /**
   * Configure screenshot interval (set from Node.js side).
   */
  public setScreenshotInterval(interval: number) {
    this.screenshotInterval = interval;
  }

  /**
   * Get the current scene name from the GameCoordinator.
   */
  public getCurrentScene(): string {
    try {
      const coordinator = GameCoordinator.GetInstance();
      if (coordinator && coordinator.currentScene) {
        return coordinator.currentScene.constructor.name || "";
      }
    } catch {
      // GameCoordinator may not exist yet
    }
    return "";
  }

  /**
   * Execute a command dispatched from Node.js via page.evaluate().
   * This is the main RPC entry point.
   */
  public executeCommand(command: string, args: any[]): any {
    try {
      switch (command) {
        case "JOIN_PLAYER":
          return this.joinPlayer(args[0], args[1]);
        case "TICK":
          return this.executeTicks(args[0]);
        case "QUERY_UI":
          return this.queryUI(args[0]);
        case "QUERY_ECS":
          return this.queryECS(args[0]);
        case "DISPATCH_INPUT":
          return this.dispatchInput(args[0], args[1], args[2], args[3]);
        case "GET_SCENE":
          return this.getCurrentScene();
        case "GET_ERRORS":
          return [...this.errors];
        case "EXTRACT_REPLAY":
          return this.extractReplay();
        case "SET_SCREENSHOT_INTERVAL":
          this.setScreenshotInterval(args[0]);
          return true;
        default:
          throw new Error(`Unknown E2E command: ${command}`);
      }
    } catch (e: any) {
      this.errors.push(`E2E command '${command}' failed: ${e.message}\n${e.stack}`);
      throw e;
    }
  }

  /**
   * Join a simulated player via the E2EConnectionInstance.
   */
  private joinPlayer(pid: string, config: any): number {
    return this.connection.joinSimulatedPlayer(pid, config);
  }

  /**
   * Execute an exact number of deterministic game ticks.
   * Returns a TickResult that tells the Node.js side whether screenshots are needed.
   */
  private executeTicks(frames: number): TickResult {
    const errors: string[] = [];
    let framesExecuted = 0;
    const gameModel = this.getActiveGameModel();

    if (!gameModel) {
      return {
        completed: false,
        framesExecuted: 0,
        errors: ["No active game model found"],
      };
    }

    for (let i = 0; i < frames; i++) {
      try {
        // Apply connection startFrame (processes inputs from the frame stack)
        this.connection.startFrame(gameModel);

        // Step the engine exactly one frame (16.6666ms = 60fps)
        gameModel.step(16.666666666666668);

        // Run draw systems
        stepWorldDraw(gameModel);

        // Process connection endFrame (history recording, etc.)
        this.connection.endFrame(gameModel);

        this.currentFrame++;
        framesExecuted++;

        // Check if we need a screenshot at this frame
        if (this.screenshotInterval > 0 && this.currentFrame % this.screenshotInterval === 0) {
          return {
            completed: false,
            framesExecuted,
            pausedAt: this.currentFrame,
            requiresScreenshot: true,
            errors,
          };
        }
      } catch (e: any) {
        const errorMsg = `Engine crashed during tick ${this.currentFrame}: ${e.message}\n${e.stack}`;
        this.errors.push(errorMsg);
        errors.push(errorMsg);

        // Pause the game model on crash
        gameModel.paused = true;

        return {
          completed: false,
          framesExecuted,
          errors,
        };
      }
    }

    return {
      completed: true,
      framesExecuted,
      errors,
    };
  }

  /**
   * Dispatch an input event (key press/release) for a specific player.
   */
  private dispatchInput(pid: string, key: string, pressed: boolean, eventType?: string): void {
    const inputIndex = this.connection.getPlayerInputIndex(pid);
    const type = eventType === "TOUCH" ? InputEventType.TOUCH : InputEventType.KEYBOARD;
    this.inputManager.dispatchEvent(key, pressed, type, inputIndex);
  }

  /**
   * Query UI elements matching the given query.
   */
  private queryUI(query: UIQuery): SerializedUIElement[] {
    try {
      const uiService = UIService.getInstance();
      const results: SerializedUIElement[] = [];

      for (const element of this.collectUIElements(uiService.elements)) {
        if (this.matchesUIQuery(element, query)) {
          results.push(this.serializeUIElement(element));
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private collectUIElements(elements: UIElement[]): UIElement[] {
    const visited = new Set<UIElement>();
    const collected: UIElement[] = [];

    const visit = (element: UIElement) => {
      if (visited.has(element)) {
        return;
      }
      visited.add(element);
      collected.push(element);

      const children = element.config.children;
      if (Array.isArray(children)) {
        children.forEach((child) => visit(child));
      }
    };

    elements.forEach((element) => visit(element));
    return collected;
  }

  /**
   * Check if a UIElement matches the given query.
   */
  private matchesUIQuery(element: UIElement, query: UIQuery): boolean {
    if (query.id && element._id !== query.id) {
      return false;
    }

    if (query.type) {
      const elementType = element.constructor.name.toLowerCase();
      if (elementType !== query.type.toLowerCase()) {
        return false;
      }
    }

    if (query.text) {
      const textContent = this.getElementText(element);
      if (textContent !== query.text) {
        return false;
      }
    }

    if (query.textIncludes) {
      const textContent = this.getElementText(element);
      if (!textContent.includes(query.textIncludes)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Extract text content from a UIElement.
   */
  private getElementText(element: UIElement): string {
    if (element._element) {
      return element._element.innerText || element._element.innerHTML || "";
    }
    return "";
  }

  /**
   * Serialize a UIElement to a plain object for transfer to Node.js.
   */
  private serializeUIElement(element: UIElement): SerializedUIElement {
    let bounds: [number, number, number, number] = [0, 0, 0, 0];

    if (element._element) {
      const rect = element._element.getBoundingClientRect();
      bounds = [rect.left, rect.top, rect.width, rect.height];
    }

    return {
      id: element._id,
      type: element.constructor.name.toLowerCase(),
      text: this.getElementText(element),
      visible: element.isVisible(),
      bounds,
    };
  }

  /**
   * Query ECS entities matching the given component and filter criteria.
   */
  private queryECS(query: ECSQuery): SerializedEntityState[] {
    const gameModel = this.getActiveGameModel();
    if (!gameModel) {
      return [];
    }

    const results: SerializedEntityState[] = [];

    // Get all entities that have ALL the requested components
    if (!query.components || query.components.length === 0) {
      return [];
    }

    // Start from the first component's actives and filter
    let candidateEntities = gameModel.getComponentActives(query.components[0]);

    for (let i = 1; i < query.components.length; i++) {
      const componentActives = new Set(gameModel.getComponentActives(query.components[i]));
      candidateEntities = candidateEntities.filter((eid) => componentActives.has(eid));
    }

    // Apply filters
    if (query.filters) {
      candidateEntities = candidateEntities.filter((eid) => {
        for (const [path, expectedValue] of Object.entries(query.filters!)) {
          const [componentName, ...propertyParts] = path.split(".");
          const propertyPath = propertyParts.join(".");

          const component = gameModel.getComponent(componentName, eid);
          if (!component) {
            return false;
          }

          // Navigate the property path
          let value: any = component;
          for (const part of propertyParts) {
            if (value == null) return false;
            value = value[part];
          }

          if (value !== expectedValue) {
            return false;
          }
        }
        return true;
      });
    }

    // Serialize matching entities
    for (const eid of candidateEntities) {
      results.push(this.serializeEntity(gameModel, eid));
    }

    return results;
  }

  /**
   * Serialize an ECS entity to a plain object.
   */
  private serializeEntity(gameModel: GameModel, entityId: number): SerializedEntityState {
    const components: Record<string, any> = {};

    for (const componentSchema of componentList) {
      if (hasComponent(gameModel, componentSchema, entityId)) {
        try {
          const componentData = gameModel.getComponent(componentSchema, entityId);
          if (componentData) {
            // Serialize the component, handling special types like Map
            const serialized: Record<string, any> = {};
            for (const [key, value] of Object.entries(componentData)) {
              if (key === "type") continue; // Skip the minecs type field
              if (value instanceof Map) {
                serialized[key] = Object.fromEntries(value);
              } else {
                serialized[key] = value;
              }
            }
            components[componentSchema.name] = serialized;
          }
        } catch {
          // Skip components that fail to serialize
        }
      }
    }

    // Extract description if available
    let description = "";
    if (components["Description"]?.description) {
      description = components["Description"].description;
    }

    return {
      id: entityId,
      description,
      components,
    };
  }

  /**
   * Extract the replay stack from the connection for saving as a .yagereplay file.
   */
  private extractReplay(): Record<string, any> {
    return { ...this.connection.history };
  }

  /**
   * Get the active game model from the first active room.
   */
  private getActiveGameModel(): GameModel | null {
    const roomStates = this.connection.roomStates;
    const roomIds = Object.keys(roomStates);

    if (roomIds.length === 0) {
      return null;
    }

    return roomStates[roomIds[0]]?.gameModel ?? null;
  }
}
