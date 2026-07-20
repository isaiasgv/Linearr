// src/shared/components/layout/OribionFooter.tsx   {/* oribion-branding:footer */}
// Note: the logo loads from https://oribion.com (external CDN). On an offline /
// air-gapped self-hosted instance it will fail to load; the alt text remains.
export function OribionFooter() {
  return (
    <footer className="border-t border-border bg-background py-2">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 text-sm text-muted-foreground">
        <a
          href="https://oribion.com"
          target="_blank"
          rel="noopener"
          aria-label="Powered by Oribion — visit oribion.com"
          className="inline-flex items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oribion"
        >
          <img
            src="https://oribion.com/assets/oribion-logo.svg"
            alt="Oribion"
            className="h-5 w-auto"
          />
          <span>
            Powered By <span className="font-medium text-oribion">Oribion</span>
          </span>
        </a>
      </div>
    </footer>
  )
}
