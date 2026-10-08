/**
 * chrome.cjs — the local Chrome/Edge the unit tests drive in browser mode.
 *
 * Vitest runs the tests in the browser's own DOM, MutationObserver,
 * ResizeObserver and animation frames, so no stand-in implementation is needed.
 * `CHROME_PATH` overrides the lookup.
 */
'use strict'
const fs = require('fs')

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

/** The browser to drive: CHROME_PATH, else the first installed Chrome/Edge; undefined when there is none. */
function findChrome() {
  return CANDIDATES.filter(Boolean).find((candidate) => fs.existsSync(candidate))
}

module.exports = { findChrome }
