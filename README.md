# Resolute: Video Quality Control

A Chrome / Firefox extension that adds a **quality button inside the YouTube player** (next to the ⚙ settings button).

📦 Publishing to the Chrome Web Store: see [docs/PUBLISHING.md](docs/PUBLISHING.md) · 🔒 [Privacy policy](PRIVACY.md)

Options: Auto · Highest available · 144p · 240p · 360p · 480p · 720p · 1080p · 1440p · 2160p (4K)

![In-player quality menu](docs/menu.png)

## Choosing vs. remembering

| You do | What happens |
|---|---|
| Pick a quality in the menu | Changes **this video only**. Nothing is saved. Next video goes back to normal. |
| 📌 **Remember for this video** | Saved. This video always opens at that quality. Click again to forget. |
| ★ **Make default for all videos** | Saved. Every video uses it (unless it has its own remembered quality). |

Which one wins when a video loads: **pick for now → remembered for this video → default**.

The label dot shows where the quality comes from: none = default, white = this video only, blue = remembered.
The toolbar popup sets the default and shows how many videos are remembered, with **Forget all**.

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
| `content.js` | Bridge to extension storage: the default (synced) and remembered videos (this device, newest 1000). |
| `popup.*` | Set the default; see / clear remembered videos. |

- If the chosen quality isn't on a video, it uses the best quality below it (shown as "Using 720p" in the menu).
- Unavailable qualities are dimmed with "Not available".
- Keyboard: Tab to the button, ↑/↓ to open and move, Enter to pick, Esc to close.
- If YouTube changes its layout, the button falls back to a small floating control above the progress bar. Playback is never touched by failures.

## Test

```
npm i jsdom
node test/page.test.js
node test/content.test.js
```
Runs the scripts against a fake YouTube player and fake storage (placement, menu, this-video picks, remember/forget, default, fallback, ads, no duplicates, keyboard).

## Build for the Chrome Web Store

```
python3 scripts/build-chrome.py   # -> dist/resolute-chrome-v<version>.zip
```

## Known limits

- Not for YouTube Shorts or m.youtube.com (they use a different player).
- Not affiliated with YouTube or Google. YouTube is a trademark of Google LLC.
- "Auto" after a forced quality uses `setPlaybackQualityRange('auto')`; verify on a real video.
