// Entry for `deno task compile`: serves the Vite build (`_fresh/`, embedded
// with `--include`) on all interfaces, like `deno serve` does in the Docker
// image. Fresh's own `_fresh/compiled-entry.js` binds to `$HOSTNAME`, which
// Docker and many shells set to the machine's name, so it can end up
// listening on one odd interface or failing to start.
//
// The Vite build bundles every dependency, so the task leaves node_modules
// out of the binary (`--exclude node_modules`), halving its size.
//
// The build is imported through a variable, not a string literal, so
// `deno task check` doesn't need `_fresh/` to exist.

const SERVER = "./_fresh/server.js";

const { default: server } = await import(SERVER);

Deno.serve(
  { hostname: "0.0.0.0", port: Number(Deno.env.get("PORT") ?? 8080) },
  server.fetch,
);
