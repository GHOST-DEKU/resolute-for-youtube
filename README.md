# Resolute: Video Quality Control

A Chrome / Firefox extension for YouTube that:
- adds a **quality button inside the YouTube player** (next to the ⚙ settings button), and
- can **stop autoplay**: videos open paused and start only when you press play (optional, off by default).

📦 **Distribution**
- **Firefox:** [Mozilla Add-ons publishing guide](docs/PUBLISHING-FIREFOX.md). Planned for addons.mozilla.org; **not yet submitted**, so there's no store link yet.
- **Chrome:** [Manual installation and distribution guide](docs/PUBLISHING.md). **Not on the Chrome Web Store** (its developer registration fee isn't being paid); install it yourself in Developer mode.
- 🔒 [Privacy policy](PRIVACY.md)

Options: Auto · Highest available · 144p · 240p · 360p · 480p · 720p · 1080p · 1440p · 2160p (4K)

![In-player quality menu](docs/menu.png)

## Quality: choosing vs. saving

| You do | What happens |
|---|---|
| Pick a quality in the menu | Changes **this video only**. Nothing is saved. Next video goes back to normal. |
| 📌 **Remember for this video** | Saved. This video always opens at that quality. Click again to forget. |
| 👤 **Set as default for this channel** | Saved. Every video from this channel uses it. Click again to remove; pick another quality to **Update** it. |
| ★ **Make default for all videos** | Saved. Every video uses it, unless the video or its channel has its own setting. |

Which one wins when a video loads: **pick for now → remembered for this video → channel default → global default** (Auto = YouTube decides).

The menu header shows the current channel and whether it has its own default (or "no channel default (global: …)"). A short ✓ message confirms every save.
The dot on the button shows where the quality comes from: none = global default, hollow ring = this video only (not saved), filled grey-violet = remembered video, filled mauve = channel default.

## Open videos paused (no autoplay)

Off by default. Turn it on in either place; both stay in sync:
- the **⏸ button right next to YouTube's search box** (after the mic button), or
- the **Open videos paused** switch in the toolbar popup.

| When it's on | What happens |
|---|---|
| You open a video (link, thumbnail, new tab) | Opens **paused** |
| A video ends and YouTube's autoplay starts the next one | The next one opens **paused** |
| You press play (click/tap in the player, **K**, **Space**, or a media key) | **Plays**. Your own play is never undone. |
| The browser blocked autoplay and you pressed play | **Plays** (your press counts) |
| An ad plays first | The ad is left alone; the real video after it opens **paused** |
| You type a space in the search box, or use the quality menu | Doesn't count as "play" |

The ⏸ button: grey circle = autoplay allowed; filled indigo rounded square = videos open paused. Hover it (or focus it with Tab) to see the current state; Space/Enter toggles it. It follows YouTube's light/dark theme and hides when YouTube hides the search box on narrow windows.

## Design
The popup, the in-player menu and the ⏸ button use a design **inspired by Material 3 Expressive** (not an official Material implementation):
- **Shapes:** pill buttons and chips, connected button groups, and a selected item that morphs from a pill to a rounded square.
- **Colour roles:** primary = global default, secondary = this video, tertiary = channel.
- **Motion:** spring-like, and switched off when the system's "reduce motion" setting is on.
- **Surfaces:** translucent and frosted. In the player, the video shows through the menu.
- **Theme:** the popup has a **System / Light / Dark** switch. The in-player menu is always dark, like YouTube's own player controls. The ⏸ button matches YouTube's light or dark top bar.

## Toolbar popup
- Set the **global default** quality.
- Switch **Open videos paused** on or off.
- Under **Channel defaults**: see every saved channel, change its quality, remove it (×) or **Remove all**.
- Clear remembered videos with **Forget all**.
- Pick the popup theme: **System / Light / Dark**.

## How channels are recognised
- By the **permanent channel ID** (`UC…`) from YouTube's own player data for the video that is playing, never by the display name. Renamed channels keep their setting (the stored name is refreshed automatically).
- The ID is only accepted when the player data is for the **same video** that is playing, so one channel's setting is never applied to another channel's video during page changes.
- If no channel ID can be found within about 2 seconds, the video uses your global default and the menu says "Channel not detected".

## Install

**Chrome** (manual, no store; see the [full guide and its limits](docs/PUBLISHING.md)):
1. Download this repo (**Code → Download ZIP**) and unzip it somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder that contains `manifest.json`.

It won't update automatically. A downloaded ZIP or `.crx` can't be installed by just opening it in Chrome on Windows or macOS.

**Firefox 140+:**
- **Once it's listed** on Mozilla Add-ons, install it from there with one click and automatic updates. Not available yet.
- **For testing now:**
  1. Open `about:debugging#/runtime/this-firefox`.
  2. Click **Load Temporary Add-on** and pick `manifest.json`. It's removed when Firefox closes.
  3. If the button doesn't appear, open `about:addons` → Resolute → **Permissions** and allow YouTube.

**Other Chromium browsers (Edge, Brave, …):** each browser has its own rules; see the [Chrome guide, section 5](docs/PUBLISHING.md#5-legitimate-alternatives-for-chromium-based-browsers).

## How it works

| File | Job |
|------|-----|
| `page.js` | Runs in YouTube's page so it can use the player's own methods. Adds the quality button + menu, applies the quality on every new video, waits for ads to finish. Adds the ⏸ button beside the search box and, when "Open videos paused" is on, pauses each video the first time it starts by itself. |
| `content.js` | Bridge to extension storage: the global default and the "Open videos paused" setting (both synced), remembered videos (this device, newest 1,000) and channel defaults (this device, newest 2,000). Drops corrupted entries. |
| `popup.*` | Set the global default; switch "Open videos paused"; view, edit and remove channel defaults; clear remembered videos; fix switched-off YouTube access. |

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
Runs the scripts against a fake YouTube player and fake storage (placement, menu, this-video picks, remember/forget, channel defaults incl. switching channels, missing/stale channel IDs, renamed channels and corrupted data, global default, fallback, ads, no duplicates, keyboard, and "Open videos paused": paused on its own start, your play never undone, ads skipped, search-box typing and menu clicks not counted as play, the ⏸ button saving and following the popup).

## Build the packages

```
python3 scripts/build.py chrome    # -> dist/resolute-chrome-v<version>.zip
python3 scripts/build.py firefox   # -> dist/resolute-firefox-v<version>.zip
```

## Known limits

- Not for YouTube Shorts or m.youtube.com (they use a different player). "Open videos paused" doesn't affect Shorts or the muted hover previews on the home page.
- "Open videos paused" works by pausing a video right as it starts, so on a slow device you may hear a split second of sound first. YouTube offers no clean "don't autoplay" switch an extension can use.
- The ⏸ button is placed by finding YouTube's search box (`ytd-masthead #center`). If YouTube redesigns its top bar, the button may not appear; the popup switch still works.
- Channel defaults need the channel ID from YouTube's player data (`getPlayerResponse`). If YouTube stops providing it, videos fall back to the global default ("Channel not detected") — nothing wrong is applied.
- Remembered videos and channel defaults stay on the device where you saved them (not synced).
- Not affiliated with YouTube or Google. YouTube is a trademark of Google LLC.
- "Auto" after a forced quality uses `setPlaybackQualityRange('auto')`; verify on a real video.
