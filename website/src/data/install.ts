export interface Step { t: string; d: string; sc: 'gh' | 'fold' | 'ext'; a: string; hl?: 'addr' | 'dev' | 'load'; dev?: boolean; dlg?: boolean }
// Wording follows README.md > Install > Chrome (and other Chromium browsers).
export const STEPS: Step[] = [
  { t: 'Download the ZIP', d: 'Press the Download ZIP button on this card. You get one file, resolute-chrome.zip.', sc: 'gh', a: 'ghost-deku.github.io/resolute-for-youtube' },
  { t: 'Unzip and keep the folder', d: 'Move the folder somewhere it can stay, like Documents. Chrome keeps using these files, so do not delete or move it later.', sc: 'fold', a: 'Downloads' },
  { t: 'Open chrome://extensions', d: 'Type it in the address bar and press Enter. Edge: edge://extensions. Brave: brave://extensions.', sc: 'ext', a: 'chrome://extensions', hl: 'addr' },
  { t: 'Turn on Developer mode', d: 'It is the switch at the top right.', sc: 'ext', a: 'chrome://extensions', hl: 'dev', dev: true },
  { t: 'Load unpacked', d: 'Choose the folder that contains manifest.json. If there is one more folder with the same name inside, open it until you can see manifest.json.', sc: 'ext', a: 'chrome://extensions', hl: 'load', dev: true, dlg: true },
];
export const FIREFOX_STEPS = [
  'Open the Resolute page on Mozilla Add-ons in Firefox.',
  'Click Add to Firefox, then Add in the box that appears.',
  'Open any YouTube video. The speed and quality pill is in the player, next to the gear.',
];
