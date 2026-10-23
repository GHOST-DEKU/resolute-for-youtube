# Publishing Resolute on Firefox Add-ons (AMO)

**Firefox is this project's main distribution channel.** Resolute is *not* on the Chrome Web Store; for Chrome, see [PUBLISHING.md](PUBLISHING.md).

**Status:** prepared and validated, **not yet submitted**. Nothing has been published on addons.mozilla.org yet, so there's no public install link.

This is a step-by-step guide for a first-time publisher. Steps marked **👤 You** need your Mozilla account. Everything else is already prepared in this repo.

Facts that change over time are linked to Mozilla's official pages, checked on **22 October 2026**. If a page says something different when you read it, follow the page.

---

## 0. Ways to get Resolute into Firefox

Firefox only installs add-ons that **Mozilla has signed**. This applies to the normal release and beta versions of Firefox. Signing is free and happens through addons.mozilla.org (AMO), even if you never list the add-on publicly. ([Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/))

| Option | Who it's for | Signed? | Updates | Notes |
|---|---|---|---|---|
| **Listed on AMO** (the plan) | Everyone | ✅ by Mozilla | Automatic | One-click install from addons.mozilla.org. This guide's main path (sections 2–5). |
| **Self-distributed** ("On your own" in the Developer Hub) | People you give the file to | ✅ by Mozilla | Only if you host an `update_url`, otherwise manual | You get a signed `.xpi` to host yourself. Users install it from a web link served as `application/x-xpinstall`, or with ⚙ → **Install Add-on From File** in `about:addons`. No AMO page, no discovery. ([Self-distribution](https://extensionworkshop.com/documentation/publish/self-distribution/), [installing](https://extensionworkshop.com/documentation/publish/install-self-distributed/)) |
| **Temporary install** (`about:debugging`) | You, for testing | ❌ not needed | — | Removed when Firefox closes. See section 4. |
| **Unsigned install** | Testing only | ❌ | — | Only works in Firefox **Developer Edition, Nightly or ESR**, with `xpinstall.signatures.required` set to `false` in `about:config`. Not possible in regular Firefox. |

Listed and self-distributed versions go through the same signing, with the same add-on ID. Pick **one** main channel for public users (this project: listed on AMO).

---

## 1. Firefox check (done)

| Check | Result |
|---|---|
| Manifest V3 in Firefox | ✅ All keys used are supported. Running a script inside YouTube's page (`world: "MAIN"`) works from Firefox 128. ([MV3 in Firefox 128](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/)) |
| Add-on ID | ✅ Changed to the permanent ID `resolute-video-quality@ghost-deku`. **Never change it after the first upload.** AMO uses it to know new versions belong to your add-on. |
| Data collection declaration | ✅ Added `data_collection_permissions: { required: ["none"] }`. It is required for every new Firefox extension since 3 Nov 2025. ([built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)) |
| Minimum Firefox version | ✅ 140 on desktop, which that declaration needs. Android is set to 142 only to satisfy the validator; you won't list it for Android. |
| Permissions | ✅ Only `storage`, `notifications` (the saver's "it's running" notice) + access to `youtube.com` / `youtube-nocookie.com`. Nothing broader. |
| Site access can be switched off | ✅ **Fixed.** Firefox treats site access as optional, so users can switch it off and the button would then silently vanish. The popup now detects this and shows an **Allow on YouTube** button. ([host_permissions on MDN](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)) |
| Chrome-only key | ✅ `minimum_chrome_version` is left out of the Firefox ZIP (and the Firefox key is left out of the Chrome ZIP). |
| Remote code, minified code, third-party libraries | ✅ None, so **no source code upload is needed**. |
| Mozilla's validator (`web-ext lint`) on the release ZIP | ✅ **0 errors, 0 warnings, 0 notices** (actually run). |

**What was tested, honestly:**
- ✅ `web-ext lint` (Mozilla's own add-on linter) on the exact Firefox ZIP: clean.
- ✅ The same code in real Chromium, end to end, with no JS errors.
- ✅ Automated tests (`test/`).
- ❌ **Not run in real Firefox.** This build environment can't download Firefox. The code avoids every Firefox difference I know of, but you **must** run section 4 in Firefox before submitting.

---

## 2. Mozilla account — 👤 You

1. Go to the **Developer Hub**: <https://addons.mozilla.org/developers/> → **Register** (or **Log in**). This uses a **Mozilla account**.
2. **Turn on two-factor authentication (2FA)** on that Mozilla account. Mozilla requires it for extension developers and sends you to the settings page if it's off. ([2FA requirement](https://blog.mozilla.org/addons/2021/03/11/two-factor-authentication-required-for-extension-developers))
3. **Read and accept** the [Firefox Add-on Distribution Agreement](https://extensionworkshop.com/documentation/publish/firefox-add-on-distribution-agreement/) and the [Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) when asked.
4. **No fee:** neither Mozilla's submission guide nor the agreement mentions a publishing fee. If you're ever asked to pay, stop and check you're on `addons.mozilla.org`.
5. Optional: set your **display name** in your developer profile. It's shown as the add-on's author.

---

## 3. Build the Firefox package

### Commands (Windows)
One-time setup:
- Install **Python 3** (<https://www.python.org/downloads/>) and **Node.js LTS** (<https://nodejs.org/>).
- Then get the repo, in Command Prompt or PowerShell:

```bat
git clone https://github.com/GHOST-DEKU/youtube-quality-control.git
cd youtube-quality-control
```

Build and check, every release:

```bat
py scripts\build.py firefox
powershell -Command "Expand-Archive dist\resolute-firefox-v1.1.0.zip -DestinationPath dist\firefox-check -Force"
npx web-ext lint --source-dir dist\firefox-check
```

On Mac or Linux, use `python3` instead of `py`, and `unzip -o dist/resolute-firefox-v1.1.0.zip -d dist/firefox-check` instead of the PowerShell line.

### What the build does
`scripts/build.py firefox` creates `dist/resolute-firefox-v1.1.0.zip`. It refuses to build if something is wrong. It checks:
- `manifest.json` is at the **ZIP root**;
- every referenced file is included;
- the Firefox ID and data-collection declaration exist;
- icon sizes match their names;
- name/description lengths and the version format are valid;
- the scripts contain no `eval` or unexpected web addresses.

**Included:** `manifest.json`, `content.js`, `page.js`, `popup.html`, `popup.css`, `popup.js`, `icons/*.png`.
**Left out:** `test/`, `docs/`, `store/`, `scripts/`, `dist/`, `*.md`, `.git`, `node_modules/`.

### Reading `web-ext lint` results
- **Errors** block upload, so they must be fixed.
- **Warnings** don't block, but fix them anyway; reviewers notice them.
- **Notices** are information only.

The current package has none of any kind.

*Alternative:* Mozilla's `web-ext build` makes a ZIP too, but you'd need to list every file to exclude by hand. The script above does that for you and adds the checks.

---

## 4. Test in real Firefox — 👤 You (mandatory)

**Fastest way:** this opens a fresh Firefox profile with the add-on loaded, plus the Browser Console for errors:

```bat
npx web-ext run --source-dir dist\firefox-check --start-url https://www.youtube.com --browser-console
```

**Or by hand:**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Choose the **ZIP file** itself.
4. The add-on stays loaded until Firefox closes.

**Watch for errors:**
- The **Browser Console** (Ctrl+Shift+J) shows errors from the add-on itself.
- The page's **Web Console** (F12 → Console) shows errors from the in-page script.

### Mandatory tests
| # | Test | Pass when |
|---|---|---|
| 1 | Install | The install prompt mentions access to YouTube. `about:addons` → Resolute → **Permissions**: YouTube access is **on**. |
| 2 | Button | Open a video: the button shows **Max** left of the gear; one button only |
| 3 | Pick a quality | Choose 480p: video switches (⚙ → Quality, or right-click → *Stats for nerds*); label shows 480p with a white dot |
| 4 | This video only | Open another video: back to your default |
| 5 | Highest available | Popup → Highest available; a 4K video plays its top quality |
| 6 | Auto | Popup → Auto; after forcing a quality on one video, the next video is back on Auto |
| 7 | Remember / forget | Remember 720p → reload → still 720p (dusty pink dot); Forget → other video → back → default |
| 8 | Make default | Pick 1080p → Make default → new video plays 1080p; popup shows 1080p |
| 9 | Navigation | 5+ videos via recommendations, autoplay, back/forward: always exactly one button, right quality |
| 10 | Fullscreen | Press F, open the menu: visible, usable, fits the screen |
| 11 | Ads | Quality applied after the ad; playback unaffected |
| 12 | Restart persistence | Use `web-ext run` with a kept profile (`--profile-create-if-missing --keep-profile-changes --firefox-profile ffprofile`), restart, open a video. Default and remembered videos are kept. *(Temporary add-ons are removed on restart, so this is the only way to test it before publishing.)* |
| 13 | Site access off | `about:addons` → Permissions → turn YouTube **off** → popup shows **Allow on YouTube** → click it → access back on, button returns after reload |
| 14 | Keyboard | Tab to the button, ↓, arrows, Enter, Esc work; Space pauses the video after a mouse click on the button |
| 15 | Console | No red errors from the add-on in either console |
| 16 | Channel default | Channel A video → pick 1080p → **Set as default for this channel**: "✓ Saved for A", header "A · channel default 1080p", gold dot |
| 17 | Switch channels | Another A video → 1080p; a channel B video → global default; back to A → 1080p |
| 18 | Edit / remove in popup | Popup → Channel defaults → change A to 720p → next A video 720p; × → A uses global default |
| 19 | Channel + remembered video | Remember 480p on one A video: that video 480p, other A videos the channel default |
| 20 | Autoplay button | A small shape sits right after the mic button, in light and dark YouTube themes; one only. Pointing at it unfolds words + chevron; moving away folds it back |
| 21 | Videos I open | Chevron → switch on "Videos I open" (popup updates too). Open a video: it starts paused. Press play: it plays and stays playing |
| 22 | Next in queue | Switch only "Next in queue or playlist" on. Let a video end in a playlist: the next one starts paused. Click another video yourself: it plays |
| 23 | Both / off, ads | Click the shape: both on ("No autoplay"); a video with an ad: the ad plays, then the video starts paused. Click again: everything autoplays as normal |
| 24 | Video waiting | With "Videos I open" on, open a video: the button shows "Video waiting" + Play, then folds to a red dot. Start it with Space (not the button): it says "Playing" once. Pause and play again yourself: the button stays quiet |
| 25 | Background saver | Popup → Background saver on, 15 s, Lowest. Play a video, switch to another tab for 20 s: the YouTube tab title starts with "144p ·" and shows the gold leaf icon. Come back: quality, title and icon return; the popup's number goes up |
| 26 | Saver and PiP | Put a video in Firefox's picture-in-picture, switch tabs for 20 s: quality stays the same and the tab title doesn't change. **If it drops, stop and report it** |

If any mandatory test fails, **don't submit**. Send me what happened and I'll fix it.

**Should check:**
- A YouTube embed on another site.
- A live stream.
- Shorts and m.youtube.com: not supported, but nothing should break.

---

## 5. Submit on AMO — 👤 You

Guide: [Submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/). All copy-paste text is in [`store/LISTING-FIREFOX.md`](../store/LISTING-FIREFOX.md).

1. Developer Hub → **Submit a New Add-on**.
2. **How to distribute:** choose **On this site**.
   - This lists the add-on publicly on addons.mozilla.org.
   - *On your own* only signs a file for you to share yourself. That's not what you want.
3. **Upload** `dist/resolute-firefox-v1.1.0.zip`.
   - Max size is 200 MB; yours is about 22 KB.
   - The validator runs again: it should show no errors or warnings.
4. **Platforms:** tick **Firefox** only. Don't tick Firefox for Android.
5. **Source code question:** answer **No**. There's no minifying, bundling or build step.
6. **Describe add-on:** paste the name, summary, description and category.
   - Add a support email and/or support website.
   - Choose a **license**.
   - Privacy policy is optional, because nothing is transmitted.
   - Paste the **Notes to Reviewer**.
7. Click **Submit Version**. You get a confirmation email.
8. **What happens next:**
   - Mozilla's guide says the add-on is then published on AMO, but "may be subject to further review", and you'll be told the outcome.
   - No review time is promised, and it varies.
   - Watch the email of your Mozilla account.
9. **After it's listed:** on the add-on's **Edit Product Page**, add:
   - **screenshots:** take 3–4 at 1280×800 on real YouTube in Firefox, plus `store/screenshot-popup-1280x800.png`. Mozilla recommends 1280×800 or a 1.6:1 ratio, and putting explanations in captions rather than on the image.
     *How to take an exact 1280×800 shot:*
     1. Press Ctrl+Shift+M (Responsive Design Mode) and set the size to 1280 × 800.
     2. Click the camera icon in that toolbar. ([listing tips](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/))
   - the **homepage** URL.
10. **Verify the public listing:**
    - Open it in a private window.
    - Click **Add to Firefox**.
    - Run tests 1, 2, 3 and 7 again with the real, signed version.

---

## 6. Privacy and policy declarations (why each answer is true)

- **Data collection = `none`:**
  - *Mozilla's definition:* data transmission means data "collected, used, transferred, shared, or handled outside of the add-on or the local browser". ([Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/))
  - *Why "none" fits:* this add-on keeps everything in the browser's extension storage and makes no network requests.
  - *One grey area:* if a user has turned on **Firefox Sync**, Firefox itself copies the default-quality setting between that user's devices. That's done by the browser for the user, not sent to you, which is why "none" is the honest answer. Mozilla's docs don't address this case directly. If a reviewer asks, explain it exactly like this.
- **Privacy policy:** Mozilla asks for one when an add-on transmits data, so it's not required here. [`PRIVACY.md`](../PRIVACY.md) is available if you want to show it anyway.
- **Remote code:** none. Mozilla requires add-ons to be self-contained.
- **Minified, obfuscated or generated code:** none. All code is readable as written, so no source package is needed. ([source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/))
- **Listing accuracy:** the description only claims what the code does, and states its limits (Shorts, mobile site, Android). It doesn't promise every video will play at a given quality, because YouTube decides what each video offers.
- **Trademarks:** "YouTube" isn't in the add-on's name, and the description says it isn't endorsed by YouTube or Google.

> ⚠️ If you ever add analytics, crash reporting, sign-in or anything that sends data out, the declaration must change from `none`, and Firefox will then show users a consent prompt. Update `PRIVACY.md` first.

---

## 7. Review problems and fixes

| Problem | How to spot it | Fix |
|---|---|---|
| Invalid manifest | Upload or validator shows an **error** | Run `web-ext lint` on the unzipped package; make sure you uploaded the script's ZIP (manifest at the root), not a ZIP of the whole folder |
| Missing data-collection declaration | Validator warning `MISSING_DATA_COLLECTION_PERMISSIONS` | Already fixed; keep the key in `manifest.json` |
| Excessive permissions | Reviewer asks why a permission is needed | Only `storage`, `notifications` + two YouTube sites are used; explain using the Notes to Reviewer |
| Unreadable or obfuscated code | Reviewer asks for source | Not applicable now. If you ever add a bundler or minifier, upload the original source plus exact build steps |
| Inaccurate privacy disclosure | Reviewer finds data leaving the device | Not the case now. Keep the `none` declaration only while that stays true |
| Broken functionality | Reviewer can't see the button | Usually a YouTube layout change or site access turned off. Re-run section 4, fix, upload a new version |
| Misleading listing | Reviewer flags a claim | Use the provided text; don't add claims like "always 4K" |
| Security issue | Reviewer flags unsafe code | The code never uses `innerHTML`/`eval` and validates every message. Keep it that way |
| Mozilla trademark misuse | Using "Firefox" in the name | Don't. If ever needed, the allowed form is "<Name> for Firefox" |

When a reviewer writes to you:
1. Reply in the Developer Hub (or by email) with a short, factual explanation.
2. If a change is needed, raise the version and upload it as a new version (section 8).
3. Never upload it as a new add-on.

---

## 8. Updates

1. Change the code. Run `node test\page.test.js` and `node test\content.test.js` (needs `npm i jsdom` once).
2. **Raise `version` in `manifest.json`**. Every upload must be higher than the last: `1.0.0` → `1.0.1` for fixes, `1.1.0` for features.
3. **Keep the same `gecko.id` forever.** A new ID makes AMO treat it as a different add-on.
4. Rebuild and lint (section 3), then test in Firefox (section 4).
5. Developer Hub → **your add-on** → **Upload New Version**.
   **Don't** use "Submit a New Add-on" for updates; that creates a duplicate listing. ([submitting](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/))
6. Users get the update automatically after it's approved and signed.

**Staying healthy:**
- After each Firefox release (roughly monthly), open a YouTube video and confirm the button still appears.
- Check reviews on the listing page and your GitHub issues.
- Run `npx web-ext@latest lint` occasionally, since Mozilla adds new checks over time.

---

## 9. Final pre-submission checklist

- [ ] Mozilla account created; **2FA on**; agreement and policies read
- [ ] `py scripts\build.py firefox` succeeds
- [ ] `npx web-ext lint --source-dir dist\firefox-check` → 0 errors (and 0 warnings)
- [ ] All 26 mandatory tests pass in **real Firefox**
- [ ] Upload: **On this site**, **Firefox** only, source code: **No**
- [ ] Name, summary, description, category, support site/email and license filled from `store/LISTING-FIREFOX.md`
- [ ] Notes to Reviewer pasted
- [ ] After listing: screenshots and homepage added; installed from AMO and re-tested
- [ ] For every future update: higher version, same ID, **Upload New Version**
