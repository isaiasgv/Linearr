// src/shared/components/layout/OribionFooter.tsx   {/* oribion-branding:footer */}
// The mark is vendored at frontend/public/oribion.svg rather than loaded from
// oribion.com: the app's CSP is `img-src 'self' data: blob:`, so a remote image
// is blocked and silently never renders. Serving it same-origin also keeps a
// self-hosted instance working with no internet. Same treatment as plex.svg and
// tunarr.svg. Guarded by tests/test_csp_asset_policy.py.
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
          <img src="/oribion.svg" alt="Oribion" className="h-5 w-auto" width={68} height={20} />
          <span>
            Powered By <span className="font-medium text-oribion">Oribion</span>
          </span>
        </a>
      </div>
    </footer>
  )
}
