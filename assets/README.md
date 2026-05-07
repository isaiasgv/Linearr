# /assets/

Canonical location for brand and marketing assets used by GitHub presence and the README.

## Files

| File | Purpose | Recommended size |
|---|---|---|
| `logo.svg` | Primary logo (used in README `<picture>` block) | square, vector |
| `logo-light.svg` *(optional)* | Light-theme variant | square, vector |
| `logo-dark.svg` *(optional)* | Dark-theme variant | square, vector |
| `social-preview.png` *(optional)* | GitHub social preview image | 1280×640 PNG |

## Conventions

- Keep `logo.svg` as the source of truth — other variants are derived.
- Raw URLs (for embedding outside this repo):
  `https://raw.githubusercontent.com/isaiasgv/Linearr/main/assets/logo.svg`
- To set the social preview, upload `social-preview.png` at:
  https://github.com/isaiasgv/Linearr/settings (scroll to "Social preview")

Managed by `repo-standards:setup-github-meta`. Re-running the command never overwrites existing files here.
