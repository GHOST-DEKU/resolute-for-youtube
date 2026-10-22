# Resolute: Video Quality Control

A Chrome / Firefox extension that adds a **quality button inside the YouTube player** (next to the ⚙ settings button).

📦 Publishing: [Chrome Web Store](docs/PUBLISHING.md) · [Firefox Add-ons](docs/PUBLISHING-FIREFOX.md) · 🔒 [Privacy policy](PRIVACY.md)

Options: Auto · Highest available · 144p · 240p · 360p · 480p · 720p · 1080p · 1440p · 2160p (4K)

![In-player quality menu](docs/menu.png)

## Choosing vs. saving

| You do | What happens |
|---|---|
| Pick a quality in the menu | Changes **this video only**. Nothing is saved. Next video goes back to normal. |
| 📌 **Remember for this video** | Saved. This video always opens at that quality. Click again to forget. |
| 👤 **Set as default for this channel** | Saved. Every video from this channel uses it. Click again to remove; pick another quality to **Update** it. |
| ★ **Make default for all videos** | Saved. Every video uses it, unless the video or its channel has its own setting. |

Which one wins when a video loads: **pick for now → remembered for this video → channel default → global default** (Auto = YouTube decides).

The menu header shows the current channel and whether it has its own default (or "no channel default (global: …)"). A short ✓ message confirms every save.
The dot on the button shows where the quality comes from: none = global default, hollow ring = this video only (not saved), filled grey-violet = remembered video, filled mauve = channel default.

### Design
The popup and the in-player menu use a design **inspired by Material 3 Expressive** (not an official Material implementation):
- **Shapes:** pill buttons and chips, connected button groups, and a selected item that morphs from a pill to a rounded square.
- **Colour roles:** primary = global default, secondary = this video, tertiary = channel.
- **Motion:** spring-like, and switched off when the system's "reduce motion" setting is on.
- **Surfaces:** translucent and frosted. In the player, the video shows through the menu.
- **Theme:** the popup has a **System / Light / Dark** switch. The in-player menu is always dark, like YouTube's own player controls.

**Toolbar popup:** set the global default; under **Channel defaults** see every saved channel, change its quality, remove it (×) or **Remove all**; clear remembered videos with **Forget all**.

### How channels are recognised
- By the **permanent channel ID** (`UC…`) from YouTube's own player data for the video that is playing, never by the display name. Renamed channels keep their setting (the stored name is refreshed automatically).
- The ID is only accepted when the player data is for the **same video** that is playing, so one channel's setting is never applied to another channel's video during page changes.
- If no channel ID can be found within about 2 seconds, the video uses your global default and the menu says "Channel not detected".

## Install (unpacked)

**Chrome / Edge**
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.

**Firefox (140+)**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick `manifest.json`.
3. If the button doesn't appear, open `about:addons` → this extension → **Permissions** and allow YouTube.

## How it works

| File | Job |
|------|-----|
| `page.js` | Runs in YouTube's page so it can use the player's own methods. Adds the button + menu, applies the quality on every new video, waits for ads to finish. |
| `content.js` | Bridge to extension storage: the global default (synced), remembered videos (this device, newest 1,000) and channel defaults (this device, newest 2,000). Drops corrupted entries. |
| `popup.*` | Set the global default; view, edit and remove channel defaults; clear remembered videos; fix switched-off YouTube access. |

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
Runs the scripts against a fake YouTube player and fake storage (placement, menu, this-video picks, remember/forget, channel defaults incl. switching channels, missing/stale channel IDs, renamed channels and corrupted data, global default, fallback, ads, no duplicates, keyboard).

## Build the store packages

```
python3 scripts/build.py chrome    # -> dist/resolute-chrome-v<version>.zip
python3 scripts/build.py firefox   # -> dist/resolute-firefox-v<version>.zip
```

## Known limits

- Not for YouTube Shorts or m.youtube.com (they use a different player).
- Channel defaults need the channel ID from YouTube's player data (`getPlayerResponse`). If YouTube stops providing it, videos fall back to the global default ("Channel not detected") — nothing wrong is applied.
- Remembered videos and channel defaults stay on the device where you saved them (not synced).
- Not affiliated with YouTube or Google. YouTube is a trademark of Google LLC.
- "Auto" after a forced quality uses `setPlaybackQualityRange('auto')`; verify on a real video.
