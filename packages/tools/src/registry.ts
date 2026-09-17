import type { ZoxTool } from "./types.ts";

export class ToolRegistry {
  readonly #tools = new Map<string, ZoxTool>();

  register(tool: ZoxTool): void {
    this.#tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.#tools.delete(name);
  }

  get(name: string): ZoxTool | undefined {
    return this.#tools.get(name);
  }

  list(): ZoxTool[] {
    return [...this.#tools.values()];
  }

  without(name: string): ToolRegistry {
    const copy = new ToolRegistry();
    for (const tool of this.list()) {
      if (tool.name !== name) copy.register(tool);
    }
    return copy;
  }
}
