/**
 * SDK logger — thin wrapper around console with level gating.
 *
 * Levels: debug < info < warn < error < silent
 * Default: 'warn' — only warnings and errors reach the console.
 * Set via CoBrowse.init({ logLevel: 'debug' }) for troubleshooting.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

let currentLevel = LEVELS.warn;

function setLevel(level) {
  currentLevel = LEVELS[level] ?? LEVELS.warn;
}

const noop = () => {};

const log = {
  get debug() { return currentLevel <= LEVELS.debug ? console.debug.bind(console) : noop; },
  get info()  { return currentLevel <= LEVELS.info  ? console.info.bind(console)  : noop; },
  get warn()  { return currentLevel <= LEVELS.warn  ? console.warn.bind(console)  : noop; },
  get error() { return currentLevel <= LEVELS.error ? console.error.bind(console) : noop; },
};

export { log, setLevel };
