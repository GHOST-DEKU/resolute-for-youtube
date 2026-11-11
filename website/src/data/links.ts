export const AMO = 'https://addons.mozilla.org/en-US/firefox/addon/resolute-video-quality-control/';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// the build runs inside website/, the extension's manifest.json is one folder up
export const VERSION: string = JSON.parse(readFileSync(resolve(process.cwd(), '..', 'manifest.json'), 'utf8')).version;
/** The Chrome ZIP is built from the extension files in the deploy workflow and served by the site itself. */
export const CHROME_ZIP = import.meta.env.BASE_URL.replace(/\/$/, '') + '/downloads/resolute-chrome.zip';
export const REPO = 'https://github.com/ghost-deku/resolute-for-youtube';
export const PRIVACY_POLICY = REPO + '/blob/main/PRIVACY.md';
export const ISSUES = REPO + '/issues';
