import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BunPlugin } from "bun";
import { forbiddenRuntimeImports } from "./src/bundle-guards.ts";

const root = import.meta.dir;

function stubPlugin(): BunPlugin {
  return {
    name: "zox-code-stubs",
    setup(build) {
      const stubs: Record<string, string> = {
        "react-devtools-core": join(root, "stubs/react-devtools-core.ts"),
        ws: join(root, "stubs/ws.ts"),
      };
      build.onResolve({ filter: /^(react-devtools-core|ws)$/ }, (args) => ({
        path: stubs[args.path] ?? args.path,
      }));
      build.onLoad(
        { filter: /ink\/build\/devtools(?:-window-polyfill)?\.js$/ },
        () => ({
          contents: "export {};\n",
          loader: "js",
        }),
      );
    },
  };
}

export async function buildCli(
  outfile = join(root, "dist/cli.js"),
): Promise<void> {
  mkdirSync(join(root, "dist"), { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(root, "../cli/src/index.ts")],
    target: "bun",
    minify: true,
    packages: "bundle",
    plugins: [stubPlugin()],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "process.env.DEV": JSON.stringify("false"),
    },
  });
  if (!result.success || !result.outputs[0]) {
    const message = result.logs.map((log) => String(log)).join("\n");
    throw new Error(message || "bun build failed");
  }
  await Bun.write(outfile, result.outputs[0]);
  const source = await Bun.file(outfile).text();
  const forbidden = forbiddenRuntimeImports(source);
  if (forbidden.length > 0) {
    throw new Error(
      `CLI bundle still imports ${forbidden.join(", ")} at runtime`,
    );
  }
  chmodSync(outfile, 0o755);
}

if (import.meta.main) {
  await buildCli();
}
