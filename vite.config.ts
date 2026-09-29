import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
import { preactThemeCss, requireComponentCss } from "@spy4x/preact-theme/vite";

export default defineConfig({
  plugins: [
    fresh(),
    preactThemeCss({ stylesheet: "/static/styles.css" }),
    tailwindcss(),
    // Fresh also builds the server bundle, which has no CSS: check the client build only.
    {
      ...requireComponentCss(),
      applyToEnvironment: (environment: { name: string }) =>
        environment.name === "client",
    },
  ],
});
