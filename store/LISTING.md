# Chrome Web Store — copy-ready text (not in use)

> **Not in use.** Resolute is not being published on the Chrome Web Store (see [docs/PUBLISHING.md](../docs/PUBLISHING.md)). This text is kept only in case that plan changes. It hasn't been submitted anywhere. Some details (privacy answers, screenshots) would need re-checking before any future submission.

Everything below matches what the code actually does (checked against `page.js`, `content.js`, `popup.js`).

---

## Store listing tab

**Name** (comes from `manifest.json`, 31/75 characters)
```
Resolute: Video Quality Control
```

**Summary / short description** (comes from `manifest.json` "description", 125/132 characters)
```
Pick video quality from a button inside the YouTube player. Set a default for all videos, for each channel, or for one video.
```

**Detailed description**
```
Resolute adds a quality button to the YouTube player, right next to the settings (gear) button, so you can change video quality in one click — in normal, theatre and fullscreen mode.

HOW IT WORKS
• Pick a quality from the menu: it changes the current video only. Nothing is saved.
• Remember for this video: that video will always open at the quality you chose.
• Set as default for this channel: every video from that channel uses that quality (for example, 4K for one channel, 720p for another).
• Make default for all videos: every other video uses that quality.

Which setting wins: a quality remembered for the video, then the channel's default, then your global default. Channels are recognised by their permanent channel ID, so renamed channels keep their setting.

QUALITY OPTIONS
Auto, Highest available, 144p, 240p, 360p, 480p, 720p, 1080p, 1440p and 2160p (4K).
• Qualities a video doesn't offer are shown as "Not available".
• If you choose a quality a video doesn't have, the closest lower quality is used, and the menu tells you which one.

NO AUTOPLAY (OPTIONAL)
• Two separate settings: "Videos I open" and "Next in queue or playlist" can each start paused until you press play.
• Switch them with the button next to YouTube's search box (it unfolds when you point at it) or in the toolbar popup.
• When Resolute holds a video, the button says "Video waiting" with a Play button. Pressing play any other way works too.

HIDE LIVE CHAT (OPTIONAL)
• The chat beside a live stream or stream replay closes when the video opens, using YouTube's own close button.
• Click "Show chat" and it stays open for that video.

BACKGROUND SAVER (OPTIONAL)
• Playing a video in a tab you aren't looking at? Quality drops to the lowest (or 480p) after 15 s, 30 s or 1 min, and comes back when you return.
• The tab title and icon show when it's saving. Videos in picture-in-picture are never lowered.
• The popup shows roughly how much data it saved this week (an estimate).
• Your own play is never undone, and ads are left alone.

DETAILS
• Works on youtube.com and on YouTube videos embedded in other websites.
• Waits for ads to finish before applying your quality.
• Keyboard friendly: Tab to the button, arrow keys to move, Enter to choose, Esc to close.
• The toolbar icon lets you set your global default, switch the two autoplay settings, hide live chat and the background saver, see, edit and remove channel defaults, and clear remembered videos.

PRIVACY
Your settings stay in your browser. The extension sends no data anywhere and has no analytics or ads.
Privacy policy: https://github.com/GHOST-DEKU/youtube-quality-control/blob/main/PRIVACY.md

Not available for YouTube Shorts or the mobile site (m.youtube.com).

YouTube is a trademark of Google LLC. Resolute is not made, endorsed, or sponsored by YouTube or Google.
```

**Category:** Entertainment
*(Alternative if you prefer: Functionality & UI. Pick whichever the dashboard list shows that fits best.)*

**Language:** English

**Graphic assets** (files in this `store/` folder unless noted)
| Field | File | Size |
|---|---|---|
| Store icon | `icons/icon128.png` (already inside the ZIP) | 128×128 |
| Small promo tile (required) | `store/small-promo-440x280.png` | 440×280 |
| Marquee promo tile (optional) | `store/marquee-1400x560.png` | 1400×560 |
| Screenshots (1 required, up to 5) | You take 3–4 on real YouTube (take them on real YouTube at 1280×800), plus `store/screenshot-popup-1280x800.png` | 1280×800 |

**Additional fields**
- Homepage URL: `https://github.com/GHOST-DEKU/youtube-quality-control`
- Support URL: `https://github.com/GHOST-DEKU/youtube-quality-control/issues`
- Mature content: **Off**

---

## Privacy practices tab

**Single purpose description**
```
Lets users choose the playback quality of YouTube videos from a button in the YouTube player, and optionally save that choice as a global default, a default for a channel, or for a specific video.
```

**Permission justification — storage**
```
Saves the user's chosen default video quality, the qualities of videos and channels the user explicitly chose to save (channel ID and name, video ID), so they are applied the next time a video plays. Data stays in the browser's extension storage and is never sent anywhere.
```

**Permission justification — notifications**
```
Shows one local notification when the optional background saver lowers the quality of a YouTube tab the user isn't watching, so the user knows it is running. It is cleared when the user returns to the tab. Nothing is sent anywhere.
```

**Host permission justification** (content scripts on youtube.com and youtube-nocookie.com)
```
The extension adds its quality button to the YouTube video player and applies the chosen quality using the player on the page. It runs only on youtube.com and youtube-nocookie.com (YouTube's embedded player) and on no other website.
```

**Remote code:** select **"No, I am not using remote code."**
*(True: every script is inside the ZIP; there is no eval, no external script, no network request.)*

**Data usage — what user data do you collect?**
- ✅ **Web browsing activity** — tick this.
  *Why:* when you click "Remember for this video" or "Set as default for this channel", the extension saves that video's ID or that channel's ID and name (on the device only). Google defines web browsing activity as information about the web resources a user interacts with, and its User Data FAQ says data must be disclosed even when it is only stored locally. Ticking it is the accurate, safe choice.
- ⬜ Everything else (personally identifiable info, health, financial, authentication, personal communications, location, website content, user activity, etc.) — **leave unticked**; the extension does not handle these.

**Certifications** — tick all three (they are all true for this extension). The dashboard wording is roughly:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**
```
https://github.com/GHOST-DEKU/youtube-quality-control/blob/main/PRIVACY.md
```

---

## Test instructions tab (optional)

```
No account or login is needed.
1. Open any YouTube video on https://www.youtube.com (one that offers 1080p or higher shows the most options).
2. A quality button (shows "Max" by default) appears in the player's control bar, left of the settings gear.
3. Click it and choose a quality: it applies to this video only.
4. Open the menu again and click "Remember for this video" or "Make default for all videos" to save.
5. The toolbar icon opens the popup to set the default or clear remembered videos.
```
