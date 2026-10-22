# Privacy Policy — Resolute: Video Quality Control

**Effective date:** 22 October 2026

Resolute is available by manual installation in Chrome and is planned for Mozilla Add-ons (Firefox). This policy covers the extension's own behaviour in any browser.

Resolute: Video Quality Control ("the extension") lets you choose the video quality of YouTube videos from a button inside the YouTube player. This policy explains exactly what the extension stores and what it does not do.

## What the extension stores

| What | When | Where it is stored |
|---|---|---|
| Your **default quality** (for example "1080p" or "Highest available") | When you pick a default in the popup or click **Make default for all videos** in the player menu | Your browser's extension storage (`storage.sync`). If you have turned on Chrome Sync or Firefox Sync, your browser copies this setting to your other signed-in browsers. That copying is done by your browser and your Google or Mozilla account, not by the extension or its developer. |
| Your two **autoplay settings** ("Videos I open" and "Next in queue or playlist", each on or off) | When you switch them in the toolbar popup or with the button next to YouTube's search box | Your browser's extension storage (`storage.sync`), synced by your browser like the default quality. |
| Your **background saver** setting (on or off, when it starts, how low it goes) | When you change it in the toolbar popup | Your browser's extension storage (`storage.sync`), synced by your browser like the default quality. |
| The saver's **daily estimate** of data saved (for example `2026-10-23 → 140 MB`) | Only while the background saver is on, after it has lowered a video | Your browser's local extension storage (`storage.local`), on this device only. It is never synced. Only the last 21 days are kept. It holds a date and a number, nothing about which videos you watched. |
| Your **popup theme** (System, Light or Dark) | When you pick a theme in the toolbar popup | Your browser's extension storage (`storage.sync`), synced by your browser like the default quality. |
| **Video IDs you choose to remember**, each with its quality (for example `dQw4w9WgXcQ → 480p`) | Only when you click **Remember for this video** | Your browser's local extension storage (`storage.local`), on this device only. It is never synced. At most the 1,000 most recent are kept. |
| **Channel defaults**: the YouTube channel ID (for example `UCxxxxxxxxxxxxxxxxxxxxxx`), the channel's display name, and the chosen quality | Only when you click **Set as default for this channel** (or edit the list in the popup) | Your browser's local extension storage (`storage.local`), on this device only. It is never synced. The name is kept only so the list in the popup is readable; it is updated if the channel renames itself. At most 2,000 channels are kept. |

While the background saver is on, the extension checks whether the YouTube tab is visible and whether its video is in picture-in-picture, and changes that tab's title and icon while it has lowered the quality. It restores both when you return.

The extension reads the ID of the video currently playing, the ID and name of its channel, and the list of qualities the YouTube player offers for it, so that it can apply your choice. It uses these only on your device, at that moment, and does not keep them unless you click **Remember for this video** or **Set as default for this channel**.

## What the extension does not do

- It does **not** send any data to the developer or to any other server. The extension contains no code that makes network requests.
- It does **not** use analytics, tracking, advertising, or cookies.
- It does **not** use or store your YouTube account details, watch history, comments, video titles, or anything else from the page beyond what is described above.
- It does **not** sell, share, or transfer your data to anyone.
- It does **not** use your data for any purpose other than applying the video quality you chose.

## Permissions

- **storage:** to save the settings described above.
- **Access to youtube.com and youtube-nocookie.com pages:** to add the quality button to the video player and apply your chosen quality. The extension does not run on any other website. You can turn this access off in your browser's extension settings; the button then won't appear, and the extension's popup offers to turn it back on.

## Your control over your data

- **Forget one video:** open the quality menu on that video and click **Remembered for this video** (Forget).
- **Forget all videos:** click the extension's toolbar icon, then **Forget all**.
- **Remove a channel default:** in the player menu on one of that channel's videos, or in the toolbar popup under **Channel defaults** (the × button). **Remove all** clears every channel default.
- **Remove everything:** uninstalling the extension deletes all data it stored.

The popup's channel list links to each channel's page on YouTube. Following such a link is ordinary browsing that you choose to do; the extension doesn't send anything by itself.

## Changes to this policy

If the extension's data practices change, this policy will be updated and the effective date above will change. Any change will be made before a new version with different data practices is published.

## Contact

Questions or concerns: open an issue at <https://github.com/GHOST-DEKU/youtube-quality-control/issues>.

*YouTube is a trademark of Google LLC. This extension is not made, endorsed, or sponsored by YouTube or Google.*
