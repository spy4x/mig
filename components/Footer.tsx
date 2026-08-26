/*
  Footer. Hidden when HIDE_BRANDING is true (config-driven, not env).

  Kept minimal — a single line with the "Powered by mig" attribution
  and an "embed" link. No socials, no language picker. The page is
  supposed to feel personal, not corporate.
*/

interface FooterProps {
  githubUrl: string;
  hidden?: boolean;
}

export function Footer({ githubUrl, hidden = false }: FooterProps) {
  if (hidden) return null;
  return (
    <footer class="mt-16 pt-6 border-t border-line">
      <div class="mx-auto max-w-2xl px-4 sm:px-6 flex items-center justify-between text-xs text-ink-subtle">
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-ink transition-colors"
        >
          Powered by mig
        </a>
        <a
          href="/embed"
          class="hover:text-ink transition-colors"
          title="Use this on your own site"
        >
          Embed
        </a>
      </div>
    </footer>
  );
}
