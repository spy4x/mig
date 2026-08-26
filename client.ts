// Client entry. Anything imported here is processed by Vite (including
// the @tailwindcss/vite plugin) and Fresh injects the resulting CSS
// into the document head at <link rel="stylesheet" href="/assets/...">.
// The stylesheet must NOT be linked manually from routes/_app.tsx —
// Fresh will handle injection. See main.ts for the server entry.
import "./static/styles.css";
