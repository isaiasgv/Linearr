# Presets

This folder contains example/personal lineup JSON files. **These files are NOT shipped with the Docker image** — they're available in the repo for anyone who wants to import them personally.

## How to use a preset on your own Linearr install

Linearr reads preset lineups from the `presets/` folder inside your data volume (i.e., `./data/presets/` on the host).

1. Copy any JSON file from this folder (e.g., `galaxy-lineup.json`) to your Linearr data volume:
   ```bash
   mkdir -p ./data/presets
   cp galaxy-lineup.json ./data/presets/
   ```
2. In the Linearr app, open the **Cable Plex** view. A button with the preset's name will appear next to Export/Import.
3. Click it to import (merge mode — existing channels are preserved).

## Creating your own preset

1. Build your lineup in Linearr
2. Click **Export Lineup** in the Cable Plex view — this downloads a JSON file
3. Move/rename it to something like `my-lineup.json`
4. Drop it in `./data/presets/` — it'll appear as a button next to Export/Import

## Shipped files

- **`galaxy-lineup.json`** — The Galaxy Network personal lineup (29 curated channels: Galaxy ONE, Cartoon Network, Disney, Nickelodeon, HBO-style premium, etc.). This is a personal collection, not part of default Linearr.
