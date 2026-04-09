# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## 1.1.0 (2026-04-09)


### Features

* initial Linearr standalone repository ([899fa4e](https://github.com/isaiasgv/Linearr/commit/899fa4e606b81b0ddd5f238df0979bfd027314eb))


### Bug Fixes

* make .env optional, rename container to linearr ([1c0d648](https://github.com/isaiasgv/Linearr/commit/1c0d6480c33dcb8ac5e38f568f15bc815a93eda7))

## 1.0.0 (2026-04-07)

### Features

- **channels**: full channel lineup manager with tier/vibe metadata
- **plex**: browse libraries, search, assign content via poster grid
- **blocks**: time-of-day schedule blocks with drag-and-drop slot editing
- **tunarr**: link channels, sync collections, push schedules
- **ai**: content advisor, network analysis, auto-generated day schedules
- **24/7**: analyze Plex library and generate standalone loop channels
- **settings**: unified settings with Plex OAuth, AI config, Tunarr, logs, backup/restore
- **pwa**: installable as desktop/mobile app, mobile-first responsive layout
- **auth**: stateless HMAC session cookie with login rate limiting
- **health**: `/api/health` endpoint with Docker HEALTHCHECK
- **logging**: structured app + AI operation logs viewable in Settings
