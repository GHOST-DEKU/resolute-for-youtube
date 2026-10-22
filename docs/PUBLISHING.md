# Publishing Resolute on the Chrome Web Store

*Publishing on Firefox instead? See [PUBLISHING-FIREFOX.md](PUBLISHING-FIREFOX.md).*

A step-by-step guide for a first-time publisher. Steps marked **👤 You** need your Google account and can only be done by you. Everything else is already prepared in this repo.

Facts that change over time (fees, sizes, rules) are linked to Google's official pages. They were checked on **22 October 2026**; if a page says something different when you read it, follow the page.

---

## 1. Project check (done)

| Check | Result |
|---|---|
| Manifest V3 | ✅ `manifest_version: 3` |
| Required fields | ✅ name (31/75 chars), version `1.0.0`, description (116/132 chars), icons 16/32/48/128 |
| Permissions | ✅ Only `storage`, plus site access (`host_permissions` + content scripts) for `youtube.com` and `youtube-nocookie.com` only. No `<all_urls>`, no `tabs`, no background worker. |
| Remote code | ✅ None. No `eval`, no external scripts, no network requests. |
| Chrome compatibility | ✅ `minimum_chrome_version: 111` (needed for running code in YouTube's page). Firefox-only manifest key is removed in the Chrome ZIP. |
| JavaScript errors | ✅ No errors when the packaged ZIP runs in real Chromium (test below). |
| Store icon | ✅ 128×128 PNG, 96×96 artwork with 16 px transparent padding, as Google recommends. |
| Privacy | ⚠️ A privacy policy **is required**: the extension stores the IDs of videos you choose to remember. Done: [`PRIVACY.md`](../PRIVACY.md). |
| Name | ⚠️ Renamed from "YouTube Quality Control" to **"Resolute: Video Quality Control"**. YouTube's branding rules say an app's name must never use "YouTube" (saying it works *for* YouTube in the description is fine), and store policy bans implying endorsement. |

**What was tested, honestly:**
- ✅ Automated tests against a fake YouTube player (`test/`).
- ✅ The exact release ZIP, unzipped and loaded into real Chromium, on a fake page served at `www.youtube.com`: button appears, this-video-only picks, remember/forget, default, reload, popup — **no JS errors**.
- ❌ **Not tested on the real YouTube site** (this build environment can't reach youtube.com). You must do section 6 before submitting.

Sources: [Images](https://developer.chrome.com/docs/webstore/images) · [Manifest description](https://developer.chrome.com/docs/extensions/reference/manifest/description) · [Manifest name](https://developer.chrome.com/docs/extensions/reference/manifest/name) · [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) · [YouTube branding guidelines](https://developers.google.com/youtube/branding) · [Impersonation & IP policy](https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property)

---

## 2. Developer account — 👤 You

1. **Turn on 2-Step Verification** on the Google account you'll use. It is required before you can publish or update anything. ([policy](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification))
   Do it at <https://myaccount.google.com/security>.
2. **Choose the account carefully.** The developer email can't be changed later. Google suggests an account used only for publishing. ([register](https://developer.chrome.com/docs/webstore/register))
3. Open the **Developer Dashboard**: <https://chrome.google.com/webstore/devconsole>
4. **Accept the developer agreement** and **pay the registration fee.**
   - Google's page says it is a **one-time** fee (not yearly). ([register](https://developer.chrome.com/docs/webstore/register))
   - The official page doesn't state the amount. It has long been **US $5**, and independent guides still say so, but trust the amount the dashboard shows you.
   - India is on the list of supported countries.
   - Pay in Google's own payment screen. Never paste card details anywhere else.
5. **Account page** (left menu → Account): ([set up account](https://developer.chrome.com/docs/webstore/set-up-account))
   - **Publisher name** (required): shown on your listing as "Offered by". For example, your name or "GHOST-DEKU".
   - **Contact email** (required): click **Verify** and open the link Google emails you. It's shown publicly as your contact.
6. **Trader or Non-Trader** declaration: every developer must choose one. ([Trader FAQ](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq))
   - A **trader** acts "for purposes relating to his trade, business, craft or profession". Traders must give a legal name, an address and an SMS-verified phone number, and these are **shown publicly** on the listing.
   - A **non-trader** acts outside any trade or business.
   - Google says each person decides for themselves and won't decide for you. A free hobby/student project with no income is usually understood as non-trader, but if you earn money from it (ads, donations, paid features, or as part of a business), read the FAQ carefully. If unsure, ask [developer support](https://support.google.com/chrome_webstore/contact/one_stop_support).

> New publishers can have at most **two** published extensions at first. ([publish](https://developer.chrome.com/docs/webstore/publish/))

---

## 3. Build the upload ZIP

The ZIP is built by a script so it's the same every time.

```bash
python3 scripts/build.py chrome
```

It creates `dist/resolute-chrome-v1.0.0.zip` and **refuses to build** if something is wrong. It checks:
- `manifest.json` is at the **root of the ZIP** (not inside a folder);
- every file the manifest points to is included and present;
- name ≤ 75 and description ≤ 132 characters, and a valid version number;
- each icon is really the size its name says;
- no `eval`, `new Function` or web addresses in the scripts.

**Included:** `manifest.json`, `content.js`, `page.js`, `popup.html`, `popup.css`, `popup.js`, `icons/*.png`.
**Left out on purpose:** `test/`, `docs/`, `store/`, `scripts/`, `README.md`, `PRIVACY.md`, `.git`, `.gitignore`, `node_modules/`.

### Test the ZIP locally before uploading — 👤 You
1. Unzip `dist/resolute-chrome-v1.0.0.zip` into a **new, empty folder**.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. If an older copy of the extension is loaded, click **Remove** on it first.
4. Click **Load unpacked** → choose the unzipped folder.
5. There must be **no "Errors" button** on the extension card. If there is one, click it, and fix the problem before going on.
6. Do the checklist in section 6 with this exact copy.

---

## 4. Store listing assets

All copy-ready text is in [`store/LISTING.md`](../store/LISTING.md).

| Asset | Required? | Status |
|---|---|---|
| Store icon 128×128 | Required | ✅ inside the ZIP |
| Small promo tile 440×280 | Required | ✅ `store/small-promo-440x280.png` |
| Screenshot(s) 1280×800 (or 640×400), 1–5 | At least 1 required | ⚠️ 1 ready (`store/screenshot-popup-1280x800.png`); **take 3–4 on real YouTube** (below) |
| Marquee tile 1400×560 | Optional (needed only to be featured) | ✅ `store/marquee-1400x560.png` |
| Promo video (YouTube link) | ⚠️ Unclear | One Google page says only the icon, small tile and a screenshot are mandatory; another lists a video too. If the dashboard asks for one, record a short screen video of the menu in use and upload it to YouTube. |

Image rules from Google: screenshots have **square corners and no padding**; they're shown at 640×400, so avoid tiny text; promo tiles should avoid text and fill the whole area. ([Images](https://developer.chrome.com/docs/webstore/images), [Listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing))

### Taking the YouTube screenshots (exactly 1280×800) — 👤 You
1. Open a YouTube video with the extension installed.
2. Press **F12** (DevTools) → click the **phone/tablet icon** (Toggle device toolbar) or press **Ctrl+Shift+M**.
3. In the device dropdown at the top, choose **Edit… → Add custom device**: width **1280**, height **800**, device pixel ratio **1**. Select it.
4. Set things up (see the list below), then in DevTools press **Ctrl+Shift+P**, type **"Capture screenshot"**, press Enter. Chrome saves a 1280×800 PNG.

Suggested shots (show the real experience, don't edit the YouTube UI):
1. The quality button in the control bar (hover it so the tooltip shows).
2. The menu open, with a quality ticked.
3. The menu after **Remember for this video** (blue pin).
4. Fullscreen with the menu open.
5. The popup: `store/screenshot-popup-1280x800.png` (already made from the real extension).

Pick a video you have the right to show, such as a Creative Commons video or your own upload, and avoid showing personal info (your account avatar, recommendations, history).

---

## 5. Privacy declarations

All answers are in [`store/LISTING.md`](../store/LISTING.md) → *Privacy practices tab*. Here is why each one is true for this code:

- **Single purpose:** one narrow job, controlling YouTube playback quality. Google requires "a single purpose that is narrow and easy to understand". ([privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy))
- **Permissions:** only `storage` and the two YouTube sites. Asking for more than needed gets rejected (code *Purple Potassium*). ([troubleshooting](https://developer.chrome.com/docs/webstore/troubleshooting))
- **Remote code: No.** All code is in the package, which MV3 requires anyway.
- **Data: tick "Web browsing activity" only.**
  - *Why it applies:* remembered video IDs are information about web resources you interact with.
  - *Why it applies even though nothing leaves your device:* Google's FAQ says data must be disclosed "even when data is processed or stored locally", and that products storing data only locally or with Chrome Sync must post a privacy policy. ([User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq))
  - *How sure I am:* not 100% that Google insists on this box for data that never leaves the device. But ticking it is accurate and can't be called a false declaration, while leaving it unticked could be.
- **Limited Use certifications:** all true. No selling, no transfer, no unrelated use, no humans reading data, no ads.
- **Privacy policy URL:** `https://github.com/GHOST-DEKU/youtube-quality-control/blob/main/PRIVACY.md`. It must be reachable without signing in, so the repo has to stay **public**. A missing or unreachable policy is a common rejection (code *Purple Lithium*).
- **Consent:** no separate consent screen is needed. Nothing is collected in the background; data is saved only when you click a clearly labelled button (Remember / Make default).

> ⚠️ If you ever add analytics, crash reporting, sign-in, or anything that sends data off the device, you **must** update `PRIVACY.md` and these answers **before** publishing that version.

---

## 6. Release testing on real YouTube — 👤 You

Use the unzipped release copy (section 3). Open DevTools → **Console** while testing and watch for red errors that mention the extension.

### Mandatory (fix before submitting)
| # | Test | How | Pass when |
|---|---|---|---|
| 1 | Fresh install | Remove the extension, load the unzipped ZIP, open a video | Button shows **Max** left of the gear; no errors on the extension card |
| 2 | Quality pick | Open the menu, choose 480p | Video changes to 480p (check ⚙ → Quality, or right-click → *Stats for nerds*); label shows 480p with a white dot |
| 3 | This video only | After test 2, open another video | It goes back to your default, not 480p |
| 4 | Highest available | Popup → Highest available, open a 4K video | Plays the top quality (⚙ → Quality shows it) |
| 5 | Auto | Popup → Auto, open a new video | YouTube's own Auto behaviour; after forcing a quality on one video, the next video is back on Auto |
| 6 | Remember | Pick 720p → menu → Remember for this video → reload | Still 720p, blue dot |
| 7 | Forget | Menu → Remembered (Forget) → open another video then come back | Uses the default again |
| 8 | Make default | Pick 1080p → Make default → new video | 1080p; popup shows 1080p |
| 9 | Unavailable quality | Default 4K on a 1080p-only video | Uses 1080p; menu shows "Using 1080p" and dims 4K "Not available" |
| 10 | Navigation | Click through 5+ videos via recommendations, autoplay, back/forward | Exactly **one** button every time; correct quality each time |
| 11 | Fullscreen | Press F, open the menu | Button and menu visible and usable; menu fits on screen |
| 12 | Theatre & small window | Press T; make the window narrow | Menu stays inside the player and scrolls if short |
| 13 | Ads | A video with a pre-roll ad | Quality applied after the ad ends; playback unaffected |
| 14 | Browser restart | Close Chrome fully, reopen, open a video | Default and remembered videos are kept |
| 15 | Keyboard | Tab to the button, ↓ to open, arrows, Enter, Esc | Works; Space still pauses the video after a mouse click on the button |
| 16 | Console | Watch the Console during all tests | No red errors coming from the extension |
| 17 | Channel default | Video from channel A → pick 1080p → menu → **Set as default for this channel** | "✓ Saved for A"; header shows "A · channel default 1080p"; purple dot |
| 18 | Switch channels | Open another A video, then a channel B video, then A again | A videos: 1080p; B (no default): global default; never mixed up |
| 19 | Edit / remove in popup | Popup → Channel defaults → change A to 720p, then × | Next A video plays 720p; after ×, A uses the global default |
| 20 | Channel + remembered video | Remember 480p on one A video | That video: 480p; other A videos: channel default |

### Should check (fix if it breaks)
- An embedded video on another site (e.g. a blog with a YouTube embed): the button appears in the embed.
- A live stream: no errors (live streams may offer fewer qualities).
- Shorts (`/shorts/`) and `m.youtube.com`: **not supported**, as the listing says; just make sure nothing breaks.
- Light and dark YouTube theme: the player menu is dark in both, like YouTube's own menu.

### Optional improvements (not needed for approval)
- More screenshots or a promo video.
- Translations.

If **any mandatory test fails, don't submit**. Google rejects extensions that don't work as described (code *Yellow Magnesium*). Send me what happened and I'll fix it.

---

## 7. Upload and publish — 👤 You

Dashboard: <https://chrome.google.com/webstore/devconsole> ([publish guide](https://developer.chrome.com/docs/webstore/publish/))

1. Click **Add new item** → choose `dist/resolute-chrome-v1.0.0.zip` → **Upload**.
   An upload error usually means the manifest isn't at the ZIP root. Always upload the script's ZIP, not a ZIP of the whole folder.
2. **Store listing** tab: paste the description, then choose the category and language. Upload the small promo tile, the screenshots and (optionally) the marquee tile. Add the homepage and support URLs. → **Save draft**.
3. **Privacy** tab: fill in exactly as in `store/LISTING.md` → **Save draft**.
4. **Distribution** tab: ([distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution))
   - Payment: free.
   - Visibility:
     - **Public:** listed in the store; anyone can find and install it.
     - **Unlisted:** not in search; anyone with the link can install.
     - **Private:** only people you choose (trusted testers).
     - All three go through the **same review**.
   - Regions: **All regions**.
   - Tip: publish **Private** first, test with 1–2 friends, then switch to Public.
5. **Test instructions** tab: paste the text from `store/LISTING.md`.
6. Fix any warning the dashboard shows. The **Submit for review** button stays disabled until required fields are done.
7. Click **Submit for review**.
   - In the dialog you can untick automatic publishing to **publish manually** after approval.
   - You then have **30 days** to press Publish, or the submission goes back to draft.
8. **Wait.** Google says most reviews finish "within a few days, but it can take up to a few weeks". New developers and new extensions get a closer look. If it's still pending after **3 weeks**, contact support. ([review process](https://developer.chrome.com/docs/webstore/review-process))
   - Statuses: **Pending** (in queue), **Published**, **Rejected** (email explains why), **Taken down**. ([check review](https://developer.chrome.com/docs/webstore/check-review))
   - Turn on email notifications on the Account page.
9. **Approved:** if you chose manual publishing, click **Publish**.
10. **Verify:**
    - Open the public listing link.
    - In a clean Chrome profile, click **Add to Chrome**.
    - Run tests 1, 2, 6 and 8 again.
    - Check that the privacy policy link on the listing opens.

There is no guaranteed approval or fixed review time.

---

## 8. Rejections, updates and maintenance

### Common rejection codes and what they'd mean here ([full list](https://developer.chrome.com/docs/webstore/troubleshooting))
| Code | Meaning | Most likely cause for this extension | Fix |
|---|---|---|---|
| Yellow Magnesium | Doesn't work | YouTube changed its player and the button doesn't appear | Re-test on real YouTube, fix, resubmit |
| Purple Lithium | Privacy policy missing or broken | Repo made private, or wrong URL | Keep the repo public; check the link in a signed-out window |
| Purple Potassium | Excessive permissions | Unlikely; only `storage` is used | Appeal and explain if flagged |
| Red Nickel / Potassium / Silicon | Deceptive (incl. implied endorsement) | Using "YouTube" in the name, or YouTube's logo in images | Keep the current name; never use YouTube logos in the icon or tiles |
| Yellow Zinc | Weak metadata | Too few or unclear screenshots | Add the real YouTube screenshots |
| Yellow Argon | Keyword spam | Repeating keywords in the description | Use the provided description as is |

### If rejected
1. Read the email and the item's **Status** tab: it names the policy.
2. Fix the problem.
3. Bump the version (below), rebuild, upload, resubmit.
4. If you think it's a mistake, use the **Appeal** button on the item, or [developer support](https://support.google.com/chrome_webstore/contact/one_stop_support).

A rejected update never affects the live version. ([review process](https://developer.chrome.com/docs/webstore/review-process))

### Shipping an update ([update guide](https://developer.chrome.com/docs/webstore/update))
1. Change the code. Run `node test/page.test.js` and `node test/content.test.js` (needs `npm i jsdom` once).
2. **Raise the version** in `manifest.json`. Each upload must be higher than the last: `1.0.0` → `1.0.1` for fixes, `1.1.0` for new features.
3. `python3 scripts/build.py chrome`
4. Dashboard → your item → **Package** → **Upload new package** → **Submit for review**.
5. If the update collects new data or needs new permissions, update `PRIVACY.md` and the Privacy tab **first**. New permissions show users a prompt.

### Ongoing maintenance
- **Check the extension every few weeks.** YouTube changes its player often, so open a video and confirm the button still appears.
- **Watch for feedback** in two places:
  - store **reviews** and the **Support** tab in the dashboard;
  - **GitHub issues**.
- **Keep the version number history** in git tags (`git tag v1.0.0`).

---

## 9. Final pre-submission checklist

- [ ] 2-Step Verification on; fee paid; publisher name set; contact email **verified**; trader status chosen
- [ ] `python3 scripts/build.py chrome` succeeds
- [ ] Unzipped release loads in Chrome with **no Errors** button
- [ ] All 20 mandatory tests pass on **real YouTube**
- [ ] Repo is **public**; privacy policy link opens in a signed-out window
- [ ] Description pasted from `store/LISTING.md`; category and language set
- [ ] Small promo tile uploaded; at least 1 screenshot (ideally 4–5); icon shows correctly
- [ ] Privacy tab: single purpose, both justifications, remote code = No, Web browsing activity ticked, 3 certifications, policy URL
- [ ] Distribution set (Private first, or Public)
- [ ] No YouTube logos in any image; the name doesn't contain "YouTube"
- [ ] Submit for review — then wait for the email; don't resubmit while pending
