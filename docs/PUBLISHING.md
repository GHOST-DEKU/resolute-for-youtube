# Chrome: manual installation and distribution

**Resolute is not published on the Chrome Web Store, and there are no plans to publish it there.** Listing on the Chrome Web Store requires a developer registration fee, which this project doesn't pay. On Firefox, Resolute goes through Mozilla's free Add-ons store instead: see [PUBLISHING-FIREFOX.md](PUBLISHING-FIREFOX.md).

This page explains what that means for Chrome users, honestly. In short: **Chrome on Windows and macOS only lets ordinary users install extensions from the Chrome Web Store.** Outside it, the realistic option is loading the extension yourself in Developer mode.

Facts were checked against official documentation on **22 October 2026**:
- Google: [Alternative extension distribution options](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions), [Load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- Microsoft: [Register as an Edge extension developer](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)

If those pages say something different when you read them, follow the pages.

---

## 1. Three different things, three different answers

| What you want | Works in Chrome? | How |
|---|---|---|
| **Use it yourself** | ✅ Yes | Load it unpacked in Developer mode (section 2) |
| **Share the source code** | ✅ Yes | The public GitHub repo, or a ZIP of the files. Others can read it, build it, or load it unpacked themselves. |
| **Public distribution** to ordinary users (download link → installed) | ❌ **Not on Windows/macOS** without the Chrome Web Store | See section 4 for why, and section 5 for legitimate alternatives |

---

## 2. Install it yourself (Developer mode)

1. Get the files, either way:
   - **Download ZIP** from the GitHub repo page (green **Code** button), then unzip it, or
   - build the Chrome package (`py scripts\build.py chrome` on Windows, `python3 scripts/build.py chrome` elsewhere) and unzip `dist/resolute-chrome-v1.1.0.zip`.
2. Move the unzipped folder somewhere permanent, for example `Documents\Extensions\resolute`. **Don't delete or move it later**, because Chrome loads the extension from that folder every time.
3. Open `chrome://extensions`.
4. Turn on **Developer mode** (top-right switch).
5. Click **Load unpacked** and choose the folder that contains `manifest.json`.
6. Optional: pin the extension. Click the puzzle-piece icon in the toolbar, then the pin next to **Resolute**.
7. Open a YouTube video. The quality button appears next to the ⚙ gear.

**Updating to a newer version:**
1. Replace the files inside the **same folder**.
2. Click the **↻ reload** icon on the extension's card in `chrome://extensions`.
3. Reload any open YouTube tabs.

Your settings are kept. Two things lose them:
- **Removing** the extension deletes its saved settings.
- **Loading it from a different folder** makes Chrome treat it as a new extension, which starts with empty settings.

---

## 3. Limitations of a manually installed (unpacked) extension

- **No automatic updates.** You have to fetch new versions and reload them yourself (above).
- **Developer mode must stay on.** Turning it off disables unpacked extensions.
- **The folder must stay in place.** If it's moved, renamed or deleted, the extension stops working.
- **Chrome may show warnings or prompts** about extensions that don't come from the Chrome Web Store. That's expected; check you recognise what's installed.
- **Work or school computers:** if your organisation manages Chrome, an administrator may block Developer mode or unpacked extensions entirely.
- **Each person installs it separately.** There is nothing to "click and install" for other people.

---

## 4. Why a ZIP or a download link doesn't "install" the extension

- **A ZIP is just a compressed folder.** Downloading it doesn't install anything. Chrome only uses it after someone unzips it and loads it in Developer mode (section 2).
- **Packed `.crx` files can't be installed by ordinary users on Windows or macOS.** Google's documentation states that no external installs from a local CRX file are allowed on Windows (since Chrome 33) or macOS (since Chrome 44). It also says that Windows and Mac installs must come from the Chrome Web Store.
- **Self-hosting** (an extension served from your own server with its own update address) is only described for **Linux**, or for computers whose administrator installs extensions through **enterprise policies**. Neither is practical for ordinary Windows users at home.

So this project does **not** offer a "download and install" link for Chrome. Promising one would be misleading.

What this project will never suggest:
- turning off browser security features
- modifying Chrome's program files
- installing unofficial or patched browsers to get around these rules

---

## 5. Legitimate alternatives for Chromium-based browsers

Every browser sets its own rules for extensions, so **don't assume Chrome's steps or limits apply elsewhere** (or the other way round).

- **Microsoft Edge:** Microsoft's own Add-ons store has **no registration fee** ([source](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)). Publishing Resolute there would let Edge users install it normally, with automatic updates. It needs:
  - a free Microsoft account
  - a separate submission
  - Microsoft's own review

  This project hasn't done that yet; it's a possible future step.
- **Other Chromium browsers** (Brave, Vivaldi, Opera and others) each handle extensions differently: some use the Chrome Web Store, some have their own store, and some allow Developer mode. Check that browser's own documentation.
- **Firefox:** Resolute is planned for the free Mozilla Add-ons store, which gives normal one-click installs and automatic updates. See [PUBLISHING-FIREFOX.md](PUBLISHING-FIREFOX.md).

---

## 6. Sharing it with friends (honest instructions you can send)

> Resolute isn't on the Chrome Web Store. To use it in Chrome you need to load it yourself:
> 1. Download the ZIP from https://github.com/GHOST-DEKU/resolute-for-youtube (Code → Download ZIP) and unzip it somewhere you'll keep.
> 2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the unzipped folder.
> 3. It won't update by itself: download the new ZIP into the same folder and click reload when there's a new version.
>
> If you use Firefox, install it from Mozilla Add-ons instead (link coming once it's approved).

Only share it with people who are comfortable loading an extension themselves. They can read every line of the source on GitHub first.

---

## 7. Checklist before sharing a Chrome build

- [ ] `py scripts\build.py chrome` succeeds (it checks the manifest, file list and icons)
- [ ] The unzipped build loads in `chrome://extensions` with **no Errors** button
- [ ] On real YouTube:
  - [ ] the button appears and quality changes work
  - [ ] Remember, channel defaults and global default all work
  - [ ] fullscreen works
  - [ ] no red console errors
- [ ] The version in `manifest.json` is higher than the last version you shared, so people can tell versions apart

---

### Note on earlier versions of this file
Earlier versions of this file were a step-by-step Chrome Web Store submission guide. That plan was dropped because of the developer registration fee. The guide is still in the git history (commit `293ce03`), and [`store/LISTING.md`](../store/LISTING.md) keeps the prepared Chrome Web Store text, in case the plan ever changes. Nothing in this repo has been submitted to or published on the Chrome Web Store.
