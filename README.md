# YouTube Quality Control

A Chrome / Firefox extension that adds a **quality button inside the YouTube player** (next to the ⚙ settings button). Pick a quality once and it is applied to the current video right away and to every video after it.

Options: Auto · Highest available · 144p · 240p · 360p · 480p · 720p · 1080p · 1440p · 2160p (4K)

## Install (unpacked)

**Chrome / Edge**
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.

**Firefox (128+)**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick `manifest.json`.
3. If the button doesn't appear, open `about:addons` → this extension → **Permissions** and allow YouTube.

## How it works

| File | Job |
|------|-----|
| `page.js` | Runs in YouTube's page so it can use the player's own methods. Adds the button + menu, applies the quality on every new video, waits for ads to finish. |
| `content.js` | Bridge to extension storage (saves your choice, passes it to `page.js`). |
| `popup.*` | Same choice from the toolbar icon (secondary). |

- If the chosen quality isn't on a video, it uses the best quality below it (shown as "Using 720p" in the menu).
- Unavailable qualities are dimmed with "Not available".
- Keyboard: Tab to the button, ↑/↓ to open and move, Enter to pick, Esc to close.
- If YouTube changes its layout, the button falls back to a small floating control above the progress bar. Playback is never touched by failures.

## Test

```
npm i jsdom
node test/page.test.js
```
Runs the script against a fake YouTube player (placement, menu, apply, fallback, ads, no duplicates, keyboard).

## Known limits

- Not for YouTube Shorts or m.youtube.com (they use a different player).
- "Auto" after a forced quality uses `setPlaybackQualityRange('auto')`; verify on a real video.
