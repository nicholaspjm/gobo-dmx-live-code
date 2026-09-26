/**
 * "Report a problem": an issue form with the boring half already filled in.
 *
 * A bug report without the version, the browser and the route is a question
 * back to the reporter, and a first-time reporter who is asked a question
 * usually does not answer it. The app knows all of those, so it writes them.
 *
 * What it writes is deliberately short of everything it could. Not the scene:
 * a scene carries node addresses, venue names and whatever its comments say,
 * and a report is public. Not the log, for the same reason. Not the output's
 * host, only which kind of output it is. The form asks for the scene and the
 * log separately, where the person pasting them can see what they are
 * publishing. Everything here travels in a URL, so nothing here may be
 * anything that belongs to the person rather than to their setup.
 */

export const ISSUE_FORM = 'https://github.com/nicholaspjm/gobo-dmx-live-code/issues/new';

/** The field id in .github/ISSUE_TEMPLATE/bug_report.yml this fills in. */
const ENVIRONMENT_FIELD = 'environment';

export interface Environment {
  /** This build's version. */
  version: string;
  /** How gobo is being run, in words: the website, the desktop app, npm start… */
  route: string;
  browser: string;
  system: string;
  /** Which output the scene chose, by kind only. */
  output: string;
  /** The connector's version, or why there is none. */
  connector: string;
  /** What the browser says about reaching this computer, where it says anything. */
  localAccess: string;
}

interface Brand { brand: string; version: string }

/**
 * The browser and its major version.
 *
 * userAgentData first, where there is one, because a Chromium browser's user
 * agent string claims to be Chrome and Safari at once. The string after that,
 * checked in an order that stops each browser being taken for the ones it
 * imitates: Edge says Chrome, Chrome says Safari.
 */
export function browserName(ua: string, brands?: readonly Brand[]): string {
  const known = brands?.find((b) => /^(Google Chrome|Microsoft Edge|Chromium|Opera|Brave)$/.test(b.brand));
  if (known) return `${known.brand} ${known.version}`;
  const tests: [RegExp, string][] = [
    [/Edg\/(\d+)/, 'Microsoft Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[.\d]* .*Safari\//, 'Safari'],
  ];
  for (const [re, name] of tests) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}`;
  }
  return 'unknown browser';
}

/** The operating system, as a family. Versions are left out: the user agent lies about them. */
export function systemName(ua: string, platform?: string): string {
  const p = `${platform ?? ''} ${ua}`;
  if (/iPhone|iPad|iOS/i.test(p)) return 'iOS';
  if (/Android/i.test(p)) return 'Android';
  if (/Mac/i.test(p)) return 'macOS';
  if (/Win/i.test(p)) return 'Windows';
  if (/Linux|X11|CrOS/i.test(p)) return 'Linux';
  return 'unknown system';
}

/**
 * How gobo is being run, from where the page came from.
 *
 * An address that is none of the known ones is not named: it could be a LAN
 * address or a private host, and neither belongs in a public issue.
 */
export function routeName(opts: { desktop: boolean; hostname: string; port: string }): string {
  if (opts.desktop) return 'the desktop app';
  const local = opts.hostname === 'localhost' || opts.hostname === '127.0.0.1' || opts.hostname === '[::1]';
  if (opts.hostname === 'gobolive.cc' || opts.hostname === 'www.gobolive.cc') return 'the website';
  if (/(^|\.)nicholaspjm\.github\.io$/.test(opts.hostname)) return 'the website, at its old address';
  if (local && opts.port === '3001') return 'npm start, on localhost:3001';
  if (local && opts.port === '3000') return 'npm run dev';
  if (local) return `a local copy on port ${opts.port || '80'}`;
  return 'a copy served from another address';
}

/** The environment as the lines the issue form shows. */
export function environmentText(env: Environment): string {
  return [
    `gobo: ${env.version}`,
    `running as: ${env.route}`,
    `browser: ${env.browser}`,
    `system: ${env.system}`,
    `output: ${env.output}`,
    `connector: ${env.connector}`,
    `local network access: ${env.localAccess}`,
  ].join('\n');
}

/** The new-issue URL, with the bug form chosen and its environment filled in. */
export function reportUrl(env: Environment): string {
  const url = new URL(ISSUE_FORM);
  url.searchParams.set('template', 'bug_report.yml');
  url.searchParams.set(ENVIRONMENT_FIELD, environmentText(env));
  return url.toString();
}
