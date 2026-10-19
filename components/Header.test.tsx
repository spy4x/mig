// mig#119 — mig's top bar is the library's SiteHeader with no links.

import { assert, assertFalse } from "@std/assert"
import { renderToString } from "preact-render-to-string"
import { Header } from "./Header.tsx"

Deno.test("the header is the brand link home and the theme button, with no navigation or menu", () => {
  const html = renderToString(<Header defaultTheme="auto" />)
  assert(/<header\b/.test(html), html)
  assert(
    /<a\b[^>]*href="\/"[^>]*>[\s\S]*mig[\s\S]*<\/a>/.test(html),
    "brand links home",
  )
  assert(html.includes('aria-label="Theme: '), "theme button")
  assertFalse(html.includes("<nav"), "no navigation")
  assertFalse(html.includes("<details"), "no menu button")
})

Deno.test("the header without its theme button keeps the brand", () => {
  const html = renderToString(
    <Header defaultTheme="dark" themeToggle={false} />,
  )
  assert(html.includes('href="/"'))
  assertFalse(html.includes('aria-label="Theme: '))
})
