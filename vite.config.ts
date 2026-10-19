import { defineConfig, type PluginOption } from "vite"
import { fresh } from "@fresh/plugin-vite"
import tailwindcss from "@tailwindcss/vite"
import { preactThemeCss, requireComponentCss } from "@spy4x/preact-theme/vite"

// @spy4x/preact-theme 8.4.0 types `configureServer`'s request as `{ url?: string }`, which
// TypeScript's weak-type check refuses against Vite's `IncomingMessage`. The plugins themselves
// are Vite plugins, so the casts only restate that.
export default defineConfig({
  plugins: [
    fresh(),
    preactThemeCss({ stylesheet: "/static/styles.css" }) as PluginOption,
    tailwindcss(),
    // Fresh also builds the server bundle, which has no CSS: check the client build only.
    {
      ...requireComponentCss(),
      applyToEnvironment: (environment: { name: string }) =>
        environment.name === "client",
    } as PluginOption,
  ],
})
