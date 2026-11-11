export interface Chapter { k: string; t: string; s: string; opt: boolean; text: string }
export const CHAPTERS: Chapter[] = [
  { k: "quality", t: "Quality", s: "The quality you pick, not the one YouTube guesses.", opt: false, text: "Pick 144p to 4K, or Highest. You can remember it for this video, for the channel, or for every video." },
  { k: "speed", t: "Speed", s: "0.75× to 3×, with the minutes it saves.", opt: false, text: "Pick a speed. Under each one: the minutes it saves on this video. Resolute can also offer to keep a speed for a channel." },
  { k: "time", t: "Time left", s: "The real time left, at your speed.", opt: false, text: "Next to YouTube’s clock you see how long the video really takes at your speed. In another tab, the tab name shows it too." },
  { k: "resume", t: "Pick up where you stopped", s: "A flag on the bar and a button by the clock.", opt: false, text: "The flag on the bar and the button by the clock show where you left off. Jump back, start over, or leave a video or channel out." },
  { k: "auto", t: "No more autoplay", s: "The button beside the search box.", opt: true, text: "The button sits beside YouTube’s search box. Point at it to unfold. Opened videos can play or wait for you. A video that ends with no queue, or with a queue, can also stop. Off by default, you choose." },
  { k: "cinema", t: "Cinema mode", s: "The bar slides away, the video fills the window.", opt: true, text: "Optional. A video opens in theater mode, the top bar slides away while it plays, and the video fills the window without stretching or cutting. Pause or point at the top and the bar returns." },
  { k: "glow", t: "Ambient glow", s: "The video’s colours light the page.", opt: true, text: "Optional. The colours of the video softly light the page around the player, in dark and light theme." },
];
