import type { ZoxTool } from "./types.ts";

export class ToolRegistry {
  readonly #tools = new Map<string, ZoxTool>();

  register(tool: ZoxTool): void {
    this.#tools.set(tool.name, tool);
  }

  get(name: string): ZoxTool | undefined {
    return this.#tools.get(name);
  }

  list(): ZoxTool[] {
    return [...this.#tools.values()];
  }
}
