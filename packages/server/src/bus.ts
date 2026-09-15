import type { ZoxEvent } from "@zox/contracts";

type Subscriber = (event: ZoxEvent) => void;

export class SessionEventBus {
  #subs = new Map<string, Set<Subscriber>>();
  #buffers = new Map<string, ZoxEvent[]>();

  /** Drop buffered events from the previous turn before a new POST /messages. */
  beginTurn(sessionId: string): void {
    this.#buffers.set(sessionId, []);
  }

  publish(sessionId: string, event: ZoxEvent): void {
    const buffer = this.#buffers.get(sessionId) ?? [];
    buffer.push(event);
    this.#buffers.set(sessionId, buffer);
    for (const sub of this.#subs.get(sessionId) ?? []) {
      sub(event);
    }
  }

  /**
   * Drop a completed prior turn so a new subscriber waiting for the next POST
   * does not replay terminal idle from the previous turn.
   */
  discardCompletedTurn(sessionId: string): void {
    if (this.turnComplete(sessionId)) {
      this.beginTurn(sessionId);
    }
  }

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    const set = this.#subs.get(sessionId) ?? new Set();
    set.add(subscriber);
    this.#subs.set(sessionId, set);
    for (const event of this.#buffers.get(sessionId) ?? []) {
      subscriber(event);
    }
    return () => {
      set.delete(subscriber);
    };
  }

  /** True if the buffered turn already ended in idle or error. */
  turnComplete(sessionId: string): boolean {
    const buffer = this.#buffers.get(sessionId) ?? [];
    for (let i = buffer.length - 1; i >= 0; i--) {
      const event = buffer[i];
      if (event?.type === "session.status") {
        return event.status === "idle" || event.status === "error";
      }
    }
    return false;
  }
}
