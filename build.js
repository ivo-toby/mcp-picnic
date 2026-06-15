import * as esbuild from "esbuild";
import { chmodSync, existsSync } from "fs";
await esbuild.build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "./dist/bundle.js",
  target: "node18",
  banner: {
    js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`,
  },
});

// The declared CLI entrypoint must exist, otherwise the package would publish a
// broken bin mapping. Assert it before touching permissions.
const binPath = "bin/mcp-server.js";
if (!existsSync(binPath)) {
  throw new Error(`CLI entrypoint ${binPath} is missing; cannot complete build`);
}

// Set the POSIX executable bit. On Windows / filesystems without POSIX
// permissions chmod is unsupported; ignore only that case and rethrow the rest.
try {
  chmodSync(binPath, 0o755);
} catch (err) {
  if (err.code !== "ENOSYS" && err.code !== "EPERM") {
    throw err;
  }
}
