## [0.0.1-rc.11](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.10...v0.0.1-rc.11) (2026-07-26)

### Features

* add Oribion brand footer ([bca6a12](https://github.com/isaiasgv/Linearr/commit/bca6a12329288af6970dd213acbd2a89b5630214))
* **cable-plex:** add-content picker modal for a channel ([c84734a](https://github.com/isaiasgv/Linearr/commit/c84734ad43dd4dca9eb418c021332302451d0b48))
* **cable-plex:** default to expanded view, persist it, fix thumb perf ([84fcd25](https://github.com/isaiasgv/Linearr/commit/84fcd254403c4206dafa7a8938ff2dac33b4a4ff))
* **cable-plex:** drag Plex posters onto channel cards to assign ([57304d4](https://github.com/isaiasgv/Linearr/commit/57304d4596a7b23a31f02f94727bec5fd8be8169))
* **channels:** add a stable `uid` identity to channel rows ([f161518](https://github.com/isaiasgv/Linearr/commit/f161518e6a7a1ee6de7aae23f99a165a9e411882))
* **channels:** add TIER_RANGES + pure _compute_reorder renumber math ([f2e362d](https://github.com/isaiasgv/Linearr/commit/f2e362dc7484a7725caa95e5596627a513059f4d))
* **channels:** drag to reorder + direct renumber in the sidebar ([c97bb8f](https://github.com/isaiasgv/Linearr/commit/c97bb8f7b6f239007808f08791f683d0a632cc12))
* **channels:** transactional POST /api/channels/reorder + shared cascade ([1893caf](https://github.com/isaiasgv/Linearr/commit/1893caf1e04a7deb1e7a6e410ae827b4ab12c42a))
* **collections:** add AssignCollectionModal ([a2d80cd](https://github.com/isaiasgv/Linearr/commit/a2d80cd8b11252124f6e58b8985cd30d24eb42e5))
* **collections:** add SmartCollectionBuilderModal ([9926810](https://github.com/isaiasgv/Linearr/commit/99268108d7cd3d3da207312b27074697a637e83f))
* **collections:** assign an existing collection by reference ([3773f26](https://github.com/isaiasgv/Linearr/commit/3773f26f32bde4770ac8f63cc1fd5a72d4118180))
* **collections:** create a Plex smart collection and assign it atomically ([a1f942d](https://github.com/isaiasgv/Linearr/commit/a1f942d887b9828ef15764ca39e4d5605b612fc5))
* **collections:** generating switches an assigned slot back to owned ([1973240](https://github.com/isaiasgv/Linearr/commit/1973240e38e2748b8ac500b929f9912f7242111d))
* **collections:** show owned vs assigned source in the collections panel ([26a16a8](https://github.com/isaiasgv/Linearr/commit/26a16a80b0b7b936b074f217796bb007bfc72f1a))
* **collections:** source-aware collection api + hooks ([27707d7](https://github.com/isaiasgv/Linearr/commit/27707d765b0253ee46b94ddd679a0fad92d84345))
* **design-system:** living showcase (design-system/showcase.html) ([cfda09e](https://github.com/isaiasgv/Linearr/commit/cfda09e495207b531a73cf3d9fea9914864f8bb8))
* **design-system:** shadcn token layer, QIIUB showcase, Linearr branding ([01f8c45](https://github.com/isaiasgv/Linearr/commit/01f8c451d7f35537f4f7ec56e52df30807d1c50d)), closes [#6366f1](https://github.com/isaiasgv/Linearr/issues/6366f1)
* **frontend:** migrate to Tailwind CSS v4 + formalize design system ([9a46318](https://github.com/isaiasgv/Linearr/commit/9a463188968e447856e22e1c181fb929fa6944b3))
* **plex:** optional multi-select + drag source on PosterGrid ([c7af056](https://github.com/isaiasgv/Linearr/commit/c7af056d70628f3ea209b4f2ab40119669164127))
* **tunarr:** add purge-all for Tunarr smart collections ([e2ee2aa](https://github.com/isaiasgv/Linearr/commit/e2ee2aa77eb2e3380b1e45741ef46fcea0646fc2))
* **tunarr:** explicit global purge of all Tunarr smart collections ([67a2340](https://github.com/isaiasgv/Linearr/commit/67a2340c1beb50f32d28c97e17d42d2dc6ebc276))
* **watermark:** frontend api client, types, and hooks ([88d228e](https://github.com/isaiasgv/Linearr/commit/88d228ed21b8be0f5f7a277799d21afa56e85958))
* **watermark:** host the watermark image on Tunarr ([674c4d9](https://github.com/isaiasgv/Linearr/commit/674c4d97f71b3f38b697eef75ac78666dfa7f165))
* **watermark:** include the watermark in every Tunarr channel sync ([01059d7](https://github.com/isaiasgv/Linearr/commit/01059d75ffaf4ec85206a250138d8d3c33793f69))
* **watermark:** per-channel watermark editor with live preview ([1b5d2ca](https://github.com/isaiasgv/Linearr/commit/1b5d2ca6a6ac208e4f7e7226f31f2b05f0bbb7ad))
* **watermark:** per-channel watermark storage, validation, and CRUD ([587dea0](https://github.com/isaiasgv/Linearr/commit/587dea08c8686fe99f85904575f6c79fa2e140af))

### Bug Fixes

* **channels:** confirm a reorder that renumbers filtered-out channels ([346af2e](https://github.com/isaiasgv/Linearr/commit/346af2e73730b2b1ae26877d796b37bc0836e699))
* **channels:** key every channel list on the stable `uid` ([eadbb56](https://github.com/isaiasgv/Linearr/commit/eadbb562d5ada21b5f423d9ae0e2d1ee22e8abdd))
* **channels:** stop cascading ai_logs on channel delete ([9fc769f](https://github.com/isaiasgv/Linearr/commit/9fc769f7ed848c3e4cbca419b246d6b95cf058dd))
* **collections:** gate smart-collection edit + delete on Linearr provenance ([eca11a2](https://github.com/isaiasgv/Linearr/commit/eca11a2f44571aa0b52e97438d2328f49aefa122))
* **collections:** never prune a Plex collection Linearr did not create ([3462455](https://github.com/isaiasgv/Linearr/commit/346245518af737b5ad3bf39252475407054da568))
* **security:** allow-list content types on the Tunarr image proxy ([431ff90](https://github.com/isaiasgv/Linearr/commit/431ff90550fd5857479d1e968c6082fa8694ec50))
* **tunarr:** channel updates need the full object, not a partial ([59fac53](https://github.com/isaiasgv/Linearr/commit/59fac530cb013b04e8faf494c7f79d50de75bdbc))
* **tunarr:** clear the channel icon in Tunarr when it is removed ([2ee9183](https://github.com/isaiasgv/Linearr/commit/2ee91838b35b5263e01561a3e45c18f70511952e))
* **tunarr:** close ambiguous-200 gap and readonly-key leak in channel writer ([721318b](https://github.com/isaiasgv/Linearr/commit/721318b30df9f4e4bb1db929c0061096a34b8a69))
* **tunarr:** explain an unresolvable transcode config instead of "Tunarr 400" ([9b389cb](https://github.com/isaiasgv/Linearr/commit/9b389cb2b571d28809d9bfc4e50a674f05a90fde))
* **tunarr:** push an explicit disabled watermark when clearing ([38d43a8](https://github.com/isaiasgv/Linearr/commit/38d43a87546fb31ab2c7bfae7a53476c2e74fe6a))
* **tunarr:** renumber reordered channels in two phases ([e602df4](https://github.com/isaiasgv/Linearr/commit/e602df4b93e6451cf20c7f39f5745ddfc6d44807))
* **tunarr:** resolve a real transcode config uuid for channel writes ([68f2c95](https://github.com/isaiasgv/Linearr/commit/68f2c95e46a3d0cdd1b8d290e1c40e646762bbef))
* **tunarr:** route channel writes through the read-modify-write writer ([ad5e5c3](https://github.com/isaiasgv/Linearr/commit/ad5e5c336d0ffc1e8ac55de6718ecf9e40679ee2))
* **watermark:** block enabling a watermark that has no image ([92b0877](https://github.com/isaiasgv/Linearr/commit/92b087756c439b0c2168f614888df43172154301))
* **watermark:** proxy Tunarr images so the live preview actually renders ([42ce9fb](https://github.com/isaiasgv/Linearr/commit/42ce9fbccf2ae391f2b5f121427a1883cd73286e))
* **watermark:** re-apply the image when a channel's icon changes ([dad26be](https://github.com/isaiasgv/Linearr/commit/dad26be2716e25a289f99c43fd3db77c355a39c4))
* **watermark:** reject an enabled watermark with no resolved image ([72ceb3d](https://github.com/isaiasgv/Linearr/commit/72ceb3d6fb2ccfc5f8b78098249b34f3f5ea35d6))

### Performance

* **thumbs:** collapse Cable Plex onto the two canonical thumb sizes ([b38d29e](https://github.com/isaiasgv/Linearr/commit/b38d29e80f25e0db7522b217afa36358350ff7be))

### Refactoring

* **design-system:** showcase is now plain self-contained HTML+CSS ([5455272](https://github.com/isaiasgv/Linearr/commit/54552725929db089c0c53bee0a43426ee21281a4))
* **tunarr:** drop the dead smart-collections hyphen fallback ([1c2cf6b](https://github.com/isaiasgv/Linearr/commit/1c2cf6b46db8e3f021a1143ba23169d80b0258aa))
* **tunarr:** drop the last smart-collections hyphen retry in generate_collections ([bfc2642](https://github.com/isaiasgv/Linearr/commit/bfc264226cb09135d3db91420447eadf1531a111))

## [0.0.1-rc.10](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.9...v0.0.1-rc.10) (2026-07-05)

### Bug Fixes

* **assignments:** 'Add all from collection' 422 + add channel content purge ([ce56fd5](https://github.com/isaiasgv/Linearr/commit/ce56fd56f8d174420e2e3d39203b663d20aa28f6))
* **logs:** deterministic newest-first ordering; de-flake mcp log test ([8ee5c47](https://github.com/isaiasgv/Linearr/commit/8ee5c47af3a503b2327886d1bd328cdb81f8fd22))

## [0.0.1-rc.9](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.8...v0.0.1-rc.9) (2026-07-04)

### Performance

* **images:** transcoded thumbs, layered caching, render containment ([f138475](https://github.com/isaiasgv/Linearr/commit/f1384754f5744b912989d5cf04997bb7fb9247ac))

## [0.0.1-rc.8](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.7...v0.0.1-rc.8) (2026-07-04)

### Features

* **observability:** full review hardening — MCP/Plex/CablePlex fixes + audit logging everywhere ([167cb28](https://github.com/isaiasgv/Linearr/commit/167cb28445ffa1191a990bf34c2766fb75845acd))

## [0.0.1-rc.7](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.6...v0.0.1-rc.7) (2026-07-04)

### Bug Fixes

* **tunarr:** smart collections were saved with no rules — wrong field name, no verification, scan ordering ([072c530](https://github.com/isaiasgv/Linearr/commit/072c5308db0a6b222946de9011733e60b219b007))
* **tunarr:** task runs 400 when a spurious {} body is sent to argless tasks ([9970d0b](https://github.com/isaiasgv/Linearr/commit/9970d0b39b3fe80bb9ae57487a5a665d8619a4b2))

## [0.0.1-rc.6](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.5...v0.0.1-rc.6) (2026-07-03)

### Features

* **mcp:** built-in MCP server at /mcp with 24 Cable Plex tools ([83561e7](https://github.com/isaiasgv/Linearr/commit/83561e740588f938fe6eaa6c00066fe43f5db834))
* **mcp:** Settings card, docs, and dev proxy for the MCP server ([b2bb113](https://github.com/isaiasgv/Linearr/commit/b2bb113bd51af7b4424f785f91474e8f24c8262e))

## [0.0.1-rc.5](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.4...v0.0.1-rc.5) (2026-07-03)

### Bug Fixes

* **security:** upgrade fastapi/starlette/cryptography past 5 HIGH CVEs ([c98874c](https://github.com/isaiasgv/Linearr/commit/c98874cf3faa36da0f0157179b8749286b4d9935))

## [0.0.1-rc.4](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.3...v0.0.1-rc.4) (2026-07-03)

### Bug Fixes

* **ci:** bump trivy-action to v0.36.0 (v0.28.0 depends on a deleted setup-trivy tag) ([7ef5d5b](https://github.com/isaiasgv/Linearr/commit/7ef5d5bdda5ede207ab0f8d28ab8d5ff7d8153ce))

## [0.0.1-rc.3](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.2...v0.0.1-rc.3) (2026-07-03)

### Bug Fixes

* **ci:** use v-prefixed trivy-action tag so the docker job can resolve it ([b9ef87e](https://github.com/isaiasgv/Linearr/commit/b9ef87e209062e16a2dbded30886f68cc53b84ec))

## [0.0.1-rc.2](https://github.com/isaiasgv/Linearr/compare/v0.0.1-rc.1...v0.0.1-rc.2) (2026-07-03)

### Features

* **ui:** apply design system + a11y polish to Channels, Blocks, Content, TopBar ([d2a74d2](https://github.com/isaiasgv/Linearr/commit/d2a74d2510ac0ed5d5a94a1e45af8e3979c626a6))
* **ui:** apply design system + a11y polish to Icons and Settings ([1dda81e](https://github.com/isaiasgv/Linearr/commit/1dda81ee4959b6822fdea667acaf947c2b84820b))
* **ui:** apply design system + a11y polish to Tunarr and Plex views ([6df5a52](https://github.com/isaiasgv/Linearr/commit/6df5a520a2e34a6cd1c1b95ab05b711c89541660))
* **ui:** design-system foundation + verified frontend bug fixes ([9d49339](https://github.com/isaiasgv/Linearr/commit/9d493392510fa62f244e2b207790da358eef2722))

### Bug Fixes

* **backend:** data-integrity and resource fixes from full review ([40a4454](https://github.com/isaiasgv/Linearr/commit/40a44549682a58930ce7c11f82669d580b4b84ca))
* **ui:** keep channel actions menu inside the pane when header wraps ([5189d19](https://github.com/isaiasgv/Linearr/commit/5189d19f6a465ef3d1207c9c443d9da5cd4da753))

## [0.0.1-rc.1](https://github.com/isaiasgv/Linearr/compare/v0.0.0...v0.0.1-rc.1) (2026-07-03)

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
* **browse:** denser Browse view + add-from-collection with preview ([baf4bbd](https://github.com/isaiasgv/Linearr/commit/baf4bbdb9b7c30aba0c391e5b05f8a2c6db7ea63))
* **channels:** expand network presets to ~80, add 24/7 content channel suggestions ([e1680e6](https://github.com/isaiasgv/Linearr/commit/e1680e662cf8f22337d78ef13d477f86776353a6))
* **channels:** no shipped channels — clean install starts with 1 example ([147fcb8](https://github.com/isaiasgv/Linearr/commit/147fcb8250182e7cc18ad7c81ae9b167b9404ef9))
* **channels:** ship Galaxy lineup as importable JSON, default to 1 example channel ([1e79f6f](https://github.com/isaiasgv/Linearr/commit/1e79f6fab8ba1456bfdd7d4699b285141c489589))
* **channels:** smart channel creation form ([72b43b1](https://github.com/isaiasgv/Linearr/commit/72b43b1e502aa0f9fc381b2e047e646fd0a06131))
* convert Settings from modal to full page view ([834c2b7](https://github.com/isaiasgv/Linearr/commit/834c2b7621a246ee072b8945150e16d28f619dec))
* Export to Galaxy split button with PNG/SVG/All dropdown ([9186c34](https://github.com/isaiasgv/Linearr/commit/9186c34d11df1c439547cab97b8361fdbefeb807))
* fix AI empty response, Tunarr start time, add Plex features ([f6af18c](https://github.com/isaiasgv/Linearr/commit/f6af18ca9c28e5356b0ad1a9723dd72e332f866b))
* **frontend:** PWA update flow + WCAG 2.2 accessibility fixes ([1a4eb0e](https://github.com/isaiasgv/Linearr/commit/1a4eb0e47f6166ebcf9bf009783d5221b1dcf98d))
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
* **integrations:** support latest Plex & Tunarr (1.3.6 + JWT auth) ([6f604a1](https://github.com/isaiasgv/Linearr/commit/6f604a12395b79e696716bea9a38ac15c271412a))
* **plex:** add grid/list view modes + poster sizing to Browse Plex ([a5f5def](https://github.com/isaiasgv/Linearr/commit/a5f5def19a2b2b0639e2cfed7d2419548acc6d22))
* re-edit project files from icon library ([841bf66](https://github.com/isaiasgv/Linearr/commit/841bf66bf193b21b75e092bfcbf1e45f4bbfc014))
* replace custom toasts with SweetAlert2 ([d74e316](https://github.com/isaiasgv/Linearr/commit/d74e316873b8b65abb3fd24c44764151fa35636a))
* richer app logs with retention, purge, and stats ([6bf72fc](https://github.com/isaiasgv/Linearr/commit/6bf72fc805210c014083d30190674d68e9a09024))
* **seo:** add full SEO to landing/, noindex frontend/ ([c2ddc0a](https://github.com/isaiasgv/Linearr/commit/c2ddc0aab08512c24c168acd64568a4d95dbecc3))
* **settings:** floating save bar + add UI_PATTERNS doc ([2f1fd05](https://github.com/isaiasgv/Linearr/commit/2f1fd05ac0e1a1decb7881af2884bc6ae77b8c2a))
* show all posters in expanded Cable Plex, fix Tunarr schedule/EPG ([dfa9b39](https://github.com/isaiasgv/Linearr/commit/dfa9b39a3d7c883f876b0f1b77169483a2f7d153))
* TopBar connection badges, settings dropdown, clickable Now Playing ([a15e90a](https://github.com/isaiasgv/Linearr/commit/a15e90a347180e715f8da93d5d1fe9d25f8c463e))
* **ui:** collapsible sidebar, slimmer channel header, collection status ([ffc0eae](https://github.com/isaiasgv/Linearr/commit/ffc0eae11f726338d67f42006ac5f575c8d89528))
* use brand Plex and Tunarr icons throughout the UI ([2715907](https://github.com/isaiasgv/Linearr/commit/271590760ac0b8a0691e8d7a5e80ecd386df7ece))

### Bug Fixes

* add logging to Plex web URL construction for debugging ([a1d2c14](https://github.com/isaiasgv/Linearr/commit/a1d2c14974f1454e84c7c3a106b04f12e6940b2c))
* AI requests timing out — increase frontend timeout to 5min ([e06c939](https://github.com/isaiasgv/Linearr/commit/e06c9399905cadc8c701ee0f18ea781846ce6689))
* **assignments:** stop the Assigned tab from hiding added movies ([0349e8f](https://github.com/isaiasgv/Linearr/commit/0349e8fcf7621a1189bb9682c3181e06c7fb3f3f))
* **assignments:** surface DB write failures instead of bare 500 ([8d99a7b](https://github.com/isaiasgv/Linearr/commit/8d99a7b4fac2dc32986edd6e0357ec84574433a4))
* **browse:** address review findings on Browse redesign ([0fb22ce](https://github.com/isaiasgv/Linearr/commit/0fb22ce67e23fd00531d6047f62b11eb42c4f353))
* **channels:** network preset list now always renders ([f396cac](https://github.com/isaiasgv/Linearr/commit/f396cace1f4b6c53bf03e56ba0bdf1f92f1e609b))
* **channels:** show channel number even when icon is set + cleaner Quick Start UI ([c5fb899](https://github.com/isaiasgv/Linearr/commit/c5fb899ec46d36c1524836a958a1675c6b785d4a))
* **ci:** make release/0.0.1 a prerelease branch (drop maintenance range) ([f15b7d4](https://github.com/isaiasgv/Linearr/commit/f15b7d47d37cb4bfe314984d7ac3c7b2a43adcd4))
* **ci:** pin release branch to 0.0.x range in semantic-release config ([4912838](https://github.com/isaiasgv/Linearr/commit/49128384d1d2a6a53e3a4759eef8319778403a34))
* clear search filter when collection picker modal opens ([2120b62](https://github.com/isaiasgv/Linearr/commit/2120b625bd83f8faeb70a2ab8a65b2735d50fe8a))
* clicking logo/brand navigates back to main channel view ([28e47f3](https://github.com/isaiasgv/Linearr/commit/28e47f35acef9624c4d3d2002daac47e5eecafed))
* **collections:** generate manages only Linearr-owned collections ([9481fcb](https://github.com/isaiasgv/Linearr/commit/9481fcbf875a629e27b9e675b098660edf7d1e0c))
* **docker:** auto-fix data volume ownership so SQLite writes work ([06cdf0e](https://github.com/isaiasgv/Linearr/commit/06cdf0eeda8078a4e05f0f4a94904fd02bc020c9))
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
* **security:** harden auth, proxy, and settings surface ([754b086](https://github.com/isaiasgv/Linearr/commit/754b086dc3460ac06d665c4620066df820e1aba1))
* **seo:** add OG social card, fix metadata on landing site ([7a34a7d](https://github.com/isaiasgv/Linearr/commit/7a34a7dafaebd57a477d1aa04d6eedc8ee7c7e82))
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

## 1.0.0-rc.1 (2026-05-07)

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
* **seo:** add full SEO to landing/, noindex frontend/ ([c2ddc0a](https://github.com/isaiasgv/Linearr/commit/c2ddc0aab08512c24c168acd64568a4d95dbecc3))
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

## [1.0.0-rc.2](https://github.com/isaiasgv/Linearr/compare/linearr-v1.0.0-rc.1...linearr-v1.0.0-rc.2) (2026-05-07)

### Features

* **seo:** add full SEO to landing/, noindex frontend/ ([c2ddc0a](https://github.com/isaiasgv/Linearr/commit/c2ddc0aab08512c24c168acd64568a4d95dbecc3))

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
