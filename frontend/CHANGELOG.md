## 1.0.0-rc.1 (2026-05-06)

### Features

* add bidirectional channel import/export between Cable Plex and Tunarr ([8dc0b3f](https://github.com/isaiasgv/Linearr/commit/8dc0b3fc9e2405ece3e3256709d3dccc2a54112c))
* add docker-compose.dev.yml for local builds during development ([458a802](https://github.com/isaiasgv/Linearr/commit/458a8025e148a9e9bbd185c37b5794ea82d98d66))
* add genre/year/rating filters to PlexBrowser, quality + rating UI to ItemDetailModal ([5816606](https://github.com/isaiasgv/Linearr/commit/58166069d7262a44112feff7b91c9f8a25a2abfa))
* add isolated test environment with Linearr + Tunarr ([bf1a3e5](https://github.com/isaiasgv/Linearr/commit/bf1a3e557bcd2cbbb8232bb8b1307b1ee8efe6ff))
* add On Deck and Popular in Your Library sections to Plex view ([b0e7e8e](https://github.com/isaiasgv/Linearr/commit/b0e7e8e1c6f8a717dfe13a546ea8b8cae000891e))
* add Plex content intelligence layer ([ecc7267](https://github.com/isaiasgv/Linearr/commit/ecc7267536c7d0aa64b91f97e8d7968553c202a9))
* add Plex Pass icon, fix generic block creation, enhance settings info ([6e85c73](https://github.com/isaiasgv/Linearr/commit/6e85c7388bad94652db58862e1bb714ea072ab5b))
* add Plex webhooks receiver, event feed, and collection CRUD ([4e866aa](https://github.com/isaiasgv/Linearr/commit/4e866aa3f2822e7e2aba69fb68356903bdf240ef))
* add recognizable Plex and Tunarr brand icons to sidebar and view headers ([925db93](https://github.com/isaiasgv/Linearr/commit/925db93ecc2f28cab6e21ba80f8b83b057708c1c))
* add splash screen with logo, use official Plex/Tunarr icons on empty state ([38ada24](https://github.com/isaiasgv/Linearr/commit/38ada244a3b372065637389a2e6e77a00409e195))
* add Tunarr version display and compatibility warning ([70702fc](https://github.com/isaiasgv/Linearr/commit/70702fcacd582bba55bee8ebe489e83e3c7c9e09))
* add Tunarr XMLTV/M3U management, sessions monitoring, and filler lists ([1a481ea](https://github.com/isaiasgv/Linearr/commit/1a481eab031042850f2f3e8383b53512094b8bff))
* auto-assign collection items when linking collection to channel ([8eba6ea](https://github.com/isaiasgv/Linearr/commit/8eba6ea4a9517019e8489b77cdabe864ae3e7de3))
* auto-sync Cable Plex channel metadata to Tunarr ([9a35c95](https://github.com/isaiasgv/Linearr/commit/9a35c959aabb6c75597d84e65940b09f29f4fdaa))
* browsable Plex libraries, clickable items, image caching ([501d9d9](https://github.com/isaiasgv/Linearr/commit/501d9d97c383cb8a579c73be61ee58df16871d08))
* **channels:** expand network presets to ~80, add 24/7 content channel suggestions ([e1680e6](https://github.com/isaiasgv/Linearr/commit/e1680e662cf8f22337d78ef13d477f86776353a6))
* **channels:** no shipped channels — clean install starts with 1 example ([147fcb8](https://github.com/isaiasgv/Linearr/commit/147fcb8250182e7cc18ad7c81ae9b167b9404ef9))
* **channels:** ship Galaxy lineup as importable JSON, default to 1 example channel ([1e79f6f](https://github.com/isaiasgv/Linearr/commit/1e79f6fab8ba1456bfdd7d4699b285141c489589))
* **channels:** smart channel creation form ([72b43b1](https://github.com/isaiasgv/Linearr/commit/72b43b1e502aa0f9fc381b2e047e646fd0a06131))
* convert Settings from modal to full page view ([834c2b7](https://github.com/isaiasgv/Linearr/commit/834c2b7621a246ee072b8945150e16d28f619dec))
* Export to Galaxy split button with PNG/SVG/All dropdown ([9186c34](https://github.com/isaiasgv/Linearr/commit/9186c34d11df1c439547cab97b8361fdbefeb807))
* fix AI empty response, Tunarr start time, add Plex features ([f6af18c](https://github.com/isaiasgv/Linearr/commit/f6af18ca9c28e5356b0ad1a9723dd72e332f866b))
* icon editor edge guides, auto-fit, default 2 text boxes, save project ([d6b76a7](https://github.com/isaiasgv/Linearr/commit/d6b76a7e3c2a6465ac8035df516afdd6aec6cdfe))
* icon editor save dialog with project, PNG, and SVG options ([188d4dd](https://github.com/isaiasgv/Linearr/commit/188d4dd8f033a81dd93f3bdefa12aedf5cceb4e9))
* icon library editor tab gets same Save Project + Export to Galaxy ([a42a87c](https://github.com/isaiasgv/Linearr/commit/a42a87cb572795506cf222b91087e1629fa2d767))
* icon library sticky assign bar + improved card layout ([9cfc2eb](https://github.com/isaiasgv/Linearr/commit/9cfc2eb33c48cf97a04c1e59d14c3ab95df10a9d))
* **icons:** backend support for icon in channel CRUD and composition in library ([f3b5a21](https://github.com/isaiasgv/Linearr/commit/f3b5a218992be7a7e7e6de4e9ef607945e82fd4a))
* **icons:** display icons in ChannelSidebar and CablePlexView cards ([1c96f68](https://github.com/isaiasgv/Linearr/commit/1c96f68614d8abc709d3a29027966eaa3684044a))
* **icons:** editor foundation - types, render (SVG + PNG + color modes), fonts ([b2780c6](https://github.com/isaiasgv/Linearr/commit/b2780c6f7d5eb6b0f78f0e637529e39ca5995704))
* **icons:** layered SVG editor + IconPickerModal + ChannelFormModal integration ([043f6a5](https://github.com/isaiasgv/Linearr/commit/043f6a5b1d7c3e33fef9a183d99c840c1bfbbc23))
* improved app logs viewer with expandable rows and filters ([8bbf887](https://github.com/isaiasgv/Linearr/commit/8bbf88704c1839802fb3dae38c5fcee00c739558))
* initial Linearr standalone repository ([899fa4e](https://github.com/isaiasgv/Linearr/commit/899fa4e606b81b0ddd5f238df0979bfd027314eb))
* re-edit project files from icon library ([841bf66](https://github.com/isaiasgv/Linearr/commit/841bf66bf193b21b75e092bfcbf1e45f4bbfc014))
* replace custom toasts with SweetAlert2 ([d74e316](https://github.com/isaiasgv/Linearr/commit/d74e316873b8b65abb3fd24c44764151fa35636a))
* richer app logs with retention, purge, and stats ([6bf72fc](https://github.com/isaiasgv/Linearr/commit/6bf72fc805210c014083d30190674d68e9a09024))
* **settings:** floating save bar + add UI_PATTERNS doc ([2f1fd05](https://github.com/isaiasgv/Linearr/commit/2f1fd05ac0e1a1decb7881af2884bc6ae77b8c2a))
* show all posters in expanded Cable Plex, fix Tunarr schedule/EPG ([dfa9b39](https://github.com/isaiasgv/Linearr/commit/dfa9b39a3d7c883f876b0f1b77169483a2f7d153))
* TopBar connection badges, settings dropdown, clickable Now Playing ([a15e90a](https://github.com/isaiasgv/Linearr/commit/a15e90a347180e715f8da93d5d1fe9d25f8c463e))
* use brand Plex and Tunarr icons throughout the UI ([2715907](https://github.com/isaiasgv/Linearr/commit/271590760ac0b8a0691e8d7a5e80ecd386df7ece))

### Bug Fixes

* add logging to Plex web URL construction for debugging ([a1d2c14](https://github.com/isaiasgv/Linearr/commit/a1d2c14974f1454e84c7c3a106b04f12e6940b2c))
* AI requests timing out — increase frontend timeout to 5min ([e06c939](https://github.com/isaiasgv/Linearr/commit/e06c9399905cadc8c701ee0f18ea781846ce6689))
* **channels:** network preset list now always renders ([f396cac](https://github.com/isaiasgv/Linearr/commit/f396cace1f4b6c53bf03e56ba0bdf1f92f1e609b))
* **channels:** show channel number even when icon is set + cleaner Quick Start UI ([c5fb899](https://github.com/isaiasgv/Linearr/commit/c5fb899ec46d36c1524836a958a1675c6b785d4a))
* clear search filter when collection picker modal opens ([2120b62](https://github.com/isaiasgv/Linearr/commit/2120b625bd83f8faeb70a2ab8a65b2735d50fe8a))
* clicking logo/brand navigates back to main channel view ([28e47f3](https://github.com/isaiasgv/Linearr/commit/28e47f35acef9624c4d3d2002daac47e5eecafed))
* embed Google Fonts as base64 in SVG for correct PNG export ([cd91855](https://github.com/isaiasgv/Linearr/commit/cd918555c333d913ad03eed92cfd8f956614ed98))
* fallback for crypto.randomUUID on non-secure contexts ([224319f](https://github.com/isaiasgv/Linearr/commit/224319f8a5149fbabf2f505a5467269a94c9c9a5))
* fix JSX nesting in SettingsView Plex webhook section ([b6198fa](https://github.com/isaiasgv/Linearr/commit/b6198faa701dc7f59bffe69871f95d65ff6c3a87))
* font export matching, webhook copy, now-playing placement ([2b93669](https://github.com/isaiasgv/Linearr/commit/2b936693dbc699136d532ddad90f070818fbf72e))
* handle Tunarr guide response format {uuid: [programs]} ([d779b9c](https://github.com/isaiasgv/Linearr/commit/d779b9cd31d4f9d4559761eaa659f9d4db805acf))
* handle Tunarr schedule responses that return dict instead of list ([6360ab0](https://github.com/isaiasgv/Linearr/commit/6360ab0b3c75bd3adb0254f031d54a14dcca04b4))
* icon editor selection, add project save with variants ([b98bc5b](https://github.com/isaiasgv/Linearr/commit/b98bc5b3b22d5258dc098fa18026d04f81224ffc))
* improve Tunarr guide reliability, clickable collections, Plex streaming ([84db095](https://github.com/isaiasgv/Linearr/commit/84db09510fbb52a8318399ebcade32aada81da38))
* increase TopBar badge size for readability ([86e6727](https://github.com/isaiasgv/Linearr/commit/86e6727a61777665d75941354481c1e28807ba80))
* make .env optional, rename container to linearr ([1c0d648](https://github.com/isaiasgv/Linearr/commit/1c0d6480c33dcb8ac5e38f568f15bc815a93eda7))
* move plex_web_url construction before return statement ([55ff3ed](https://github.com/isaiasgv/Linearr/commit/55ff3edfb39cb1ffce053983a41d0f67c5dfce1f))
* Play on Plex now uses direct link instead of async fetch ([a717c9a](https://github.com/isaiasgv/Linearr/commit/a717c9a9fdd2fcadffbcdfd8343e43022c2b6d7a))
* remove old Toast component body to fix build ([c59ba99](https://github.com/isaiasgv/Linearr/commit/c59ba99df6d51e609762baed1a42ed457b5970dd))
* remove unused getSvgPoint causing build failure ([0393768](https://github.com/isaiasgv/Linearr/commit/039376827557e1f98eae1db34d7cba4ad8cabc09))
* remove unused openModal import in CollectionBrowser ([64cf770](https://github.com/isaiasgv/Linearr/commit/64cf77096a4d156c36f7bd4d15ef78b957d3d455))
* resolve Tunarr guide program titles, Plex play for all content types ([960bfec](https://github.com/isaiasgv/Linearr/commit/960bfec7bbb40855918f4bc41ae1f16d9d18747d))
* revert editor drag to working version, add arrow keys, improve Now Playing ([8ecc7f8](https://github.com/isaiasgv/Linearr/commit/8ecc7f88440507e9106b52ad49f6c654fa1dfb25))
* revert stopPropagation to SVG only, fixes stuck drag ([9d2e3cf](https://github.com/isaiasgv/Linearr/commit/9d2e3cf828b5d1e79a05cc0f419cdc950c6f3471))
* Tunarr test showing 0 channels due to closed HTTP client ([6cf7e82](https://github.com/isaiasgv/Linearr/commit/6cf7e8204fe8da7849e59f7021680c6ed7f87840))
* use encoded slashes and context param in Plex web URL ([e485398](https://github.com/isaiasgv/Linearr/commit/e4853981b513a86330cc2baaa92a8636e5480541))
* use max_completion_tokens instead of max_tokens for AI calls ([0723cd3](https://github.com/isaiasgv/Linearr/commit/0723cd3fa8f34ec805058b6a962ac2c08c54f19c))
* use network-first strategy for HTML in service worker ([0cdaaf6](https://github.com/isaiasgv/Linearr/commit/0cdaaf684e50c9c481e81c4c0917ca3d4700fa6c))
* use Tunarr guide API for EPG data and channel lineup ([a1937ef](https://github.com/isaiasgv/Linearr/commit/a1937efa93399dfc069d987eea4965a93e6afb33))
* use unencoded slashes in Plex web URL key parameter ([f060948](https://github.com/isaiasgv/Linearr/commit/f0609481a4e3b5c9c64d897e860f3568637d0f4b))

### Performance

* fix icon editor lag during drag/move operations ([038e4a7](https://github.com/isaiasgv/Linearr/commit/038e4a785f34522a0489de8cc0528697fabc77ca))

### Refactoring

* extract reusable IconEditor component, add Baloo Thambi fonts ([5d0b52e](https://github.com/isaiasgv/Linearr/commit/5d0b52eef37b916f842b5c7cab8b331d0ca2deec))

# Changelog

All notable changes to this project will be documented in this file.
See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.
