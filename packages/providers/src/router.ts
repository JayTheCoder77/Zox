import type {
  ProviderAdapter,
  StreamChatParams,
  StreamEvent,
} from "./types.ts";

export function parseModelRef(modelRef: string): {
  providerId: string;
  modelId: string;
} {
  const slash = modelRef.indexOf("/");
  if (slash <= 0 || slash === modelRef.length - 1) {
    throw new Error(`Invalid model id: ${modelRef}`);
  }
  return {
    providerId: modelRef.slice(0, slash),
    modelId: modelRef.slice(slash + 1),
  };
}

export type ProviderRouter = {
  resolve(modelRef: string): ProviderAdapter;
  streamChat(
    params: StreamChatParams & { model: string },
  ): AsyncIterable<StreamEvent>;
};

export function createProviderRouter(opts: {
  adapters: ProviderAdapter[];
}): ProviderRouter {
  const byId = new Map(opts.adapters.map((adapter) => [adapter.id, adapter]));
  const resolve = (modelRef: string) => {
    const { providerId } = parseModelRef(modelRef);
    const adapter = byId.get(providerId);
    if (!adapter) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    return adapter;
  };
  return {
    resolve,
    streamChat(
      params: StreamChatParams & { model: string },
    ): AsyncIterable<StreamEvent> {
      const adapter = resolve(params.model);
      const { modelId } = parseModelRef(params.model);
      return adapter.streamChat({ ...params, model: modelId });
    },
  };
}
