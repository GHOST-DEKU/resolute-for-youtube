# Firefox Add-ons (AMO) — copy-ready text

Matches what the code actually does (checked against `page.js`, `content.js`, `popup.js`, `manifest.json`).

---

## Upload page answers

| Question | Answer | Why |
|---|---|---|
| Where to distribute | **On this site** | Lists it publicly on addons.mozilla.org. ("On your own" only signs it for self-hosting.) |
| Compatible platforms | **Firefox** only. Leave **Firefox for Android unticked.** | Android Firefox opens YouTube's mobile site (m.youtube.com), which the extension doesn't support. |
| Do you need to submit source code? | **No** | The code is plain, hand-written JavaScript with no build step, bundler, minifier or transpiler. The uploaded files *are* the source. |

---

## Describe add-on page

**Name** (from manifest)
```
Resolute: Video Quality Control
```

**Add-on URL (slug)**
```
resolute-video-quality
```

**Summary** (224/250 characters)
```
Change YouTube video quality from a button inside the player. Pick a quality for just the current video, remember it for that video, save it as the default for the video's channel, or make it your global default. Auto to 4K.
```

**Description**
```
Resolute adds a quality button to the YouTube player, right next to the settings (gear) button, so you can change video quality in one click — in normal, theatre and fullscreen mode.

How it works
• Pick a quality from the menu: it changes the current video only. Nothing is saved.
• Remember for this video: that video will always open at the quality you chose.
• Set as default for this channel: every video from that channel uses that quality (for example, 4K for one channel, 720p for another).
• Make default for all videos: every other video uses that quality.

Which setting wins: a quality remembered for the video, then the channel's default, then your global default. Channels are recognised by their permanent channel ID, so renamed channels keep their setting.

Quality options
Auto, Highest available, 144p, 240p, 360p, 480p, 720p, 1080p, 1440p and 2160p (4K).
• Qualities a video doesn't offer are shown as "Not available".
• If you choose a quality a video doesn't have, the closest lower quality is used, and the menu tells you which one.
• YouTube decides which qualities each video offers. Your connection and YouTube itself can still affect playback.

Details
• Works on youtube.com and on YouTube videos embedded in other websites.
• Waits for ads to finish before applying your quality.
• Keyboard friendly: Tab to the button, arrow keys to move, Enter to choose, Esc to close.
• The toolbar icon lets you set your global default, see, edit and remove channel defaults, and clear remembered videos.

Privacy
Your settings stay in your browser. The extension sends no data anywhere and has no analytics or ads.

Not available for YouTube Shorts, the mobile site (m.youtube.com), or Firefox for Android.

Source code: https://github.com/GHOST-DEKU/youtube-quality-control

YouTube is a trademark of Google LLC. Resolute is not made, endorsed, or sponsored by YouTube or Google.
```

**Experimental:** No  **Requires payment:** No

**Categories (Firefox):** **Photos, Music & Videos** (one is enough; Mozilla advises not adding a second unless needed)

**Support email:** an email address you're happy to show publicly (optional if you give a support website)
**Support website:**
```
https://github.com/GHOST-DEKU/youtube-quality-control/issues
```
**Homepage** (on the listing's edit page after submission)
```
https://github.com/GHOST-DEKU/youtube-quality-control
```

**License:** your choice. The repo has no license file yet, so pick one you're happy with:
- **MIT:** others may reuse the code if they keep your name on it.
- **All Rights Reserved:** others may not reuse the code.

Tell me which one and I'll add a matching `LICENSE` file to the repo.

**Privacy policy:** *not required.* Mozilla requires one only if an add-on transmits data off the device, and this one doesn't. If you want to show one anyway (good for trust), tick the box and paste the contents of `PRIVACY.md`.

**Notes to Reviewer**
```
- Plain, hand-written JavaScript. No build step, bundler, minifier, transpiler or third-party libraries; the uploaded files are the full source (also at https://github.com/GHOST-DEKU/youtube-quality-control).
- No remote code, no eval, no network requests. Data collection declared as "none": settings are kept only in storage.sync / storage.local.
- page.js runs in the MAIN world because YouTube's player methods (getAvailableQualityLevels, setPlaybackQualityRange, getPlayerResponse on #movie_player) are only reachable from the page. getPlayerResponse is used only to read the current video's channel ID (videoDetails.channelId) for per-channel defaults. content.js bridges to extension storage via window.postMessage; all incoming values are validated against an allow-list.
- How to test: open any youtube.com video. A quality button (shows "Max" by default) appears left of the player's settings gear. Pick a quality: it applies to that video only. "Remember for this video" / "Make default for all videos" at the bottom of the menu save the choice. No login required.
```

---

## Images

| Asset | File | Notes |
|---|---|---|
| Icon | from the manifest (`icons/*.png`) | AMO shows the manifest icon; you can also upload one on the listing edit page (32×32 / 64×64, PNG or JPEG). |
| Screenshots | 3–4 shots at 1280×800 taken in Firefox on real YouTube (steps in `docs/PUBLISHING-FIREFOX.md`), plus `store/screenshot-popup-1280x800.png` | Mozilla recommends 1280×800 (or a 1.6:1 ratio). Explain features in the caption field, not as text on the image. Added on the listing edit page after submission. |
