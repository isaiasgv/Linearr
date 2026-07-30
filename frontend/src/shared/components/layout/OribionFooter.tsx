// src/shared/components/layout/OribionFooter.tsx   {/* oribion-branding:footer */}
// The mark is vendored at frontend/public/oribion.svg rather than loaded from
// oribion.com: the app's CSP is `img-src 'self' data: blob:`, so a remote image
// is blocked and silently never renders. Serving it same-origin also keeps a
// self-hosted instance working with no internet. Same treatment as plex.svg and
// tunarr.svg. Guarded by tests/test_csp_asset_policy.py.
//
// Two deliberate deviations from the oribion-branding template — do not "restore"
// them if the brand setup command runs again:
//  1. It vendors the mark; the template says to load it from the CDN. Under this
//     app's CSP the CDN copy is blocked and simply never renders.
//  2. The template renders the logo AND the words "Powered By Oribion", but the
//     asset is a wordmark, so the brand name appeared twice. The name now appears
//     once — as the mark — after the words "Powered By". The link's aria-label
//     still carries the full "Powered by Oribion" for assistive tech.
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
          <span>Powered By</span>
          <img src="/oribion.svg" alt="Oribion" className="h-5 w-auto" width={68} height={20} />
        </a>
      </div>
    </footer>
  )
}
