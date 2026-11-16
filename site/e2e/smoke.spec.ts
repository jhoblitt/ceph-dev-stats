// A smoke test of the built site on the real data: that the page loads whole,
// answers the reader's main interactions, and keeps the URL as the source of
// truth. The data is refreshed from time to time, so figures are compared
// with each other, never with fixed amounts, and no test names a PR or a
// person: a PR is taken from the table, and a login is checked for its form
// without being printed, even when the check fails.

import { type Locator, type Page, expect, test } from '@playwright/test';

const REPO = 'https://github.com/jhoblitt/ceph-dev-stats';
const DATA_REPO = 'https://github.com/ceph/ceph';
/** GitHub's form of a login (`site/src/lib/handles.ts`), as a user page's address. */
const USER_PAGE = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/** Console errors, uncaught exceptions and failed requests, checked after every test. */
let problems: string[] = [];

function watch(page: Page): void {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}: ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
}

test.beforeEach(({ page, context }) => {
  problems = [];
  watch(page);
  // A page a test opens itself is watched too.
  context.on('page', watch);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** The weekly (or monthly) counts of PRs opened, merged and closed, the first chart on the page. */
function countsChart(page: Page): Locator {
  return page.getByRole('figure', { name: /^PRs opened, merged and closed unmerged, per / });
}

/** The chart's text alternative: its headline figures, as sentences. */
async function headline(page: Page): Promise<string> {
  const id = await countsChart(page).getAttribute('aria-describedby');
  return (await page.locator(`[id="${id}"]`).textContent()) ?? '';
}

function prTable(page: Page): Locator {
  return page.getByRole('region', { name: 'Pull requests', exact: true });
}

/** The number of PRs the table says it lists. */
async function tableCount(page: Page): Promise<number> {
  const text = (await prTable(page).getByRole('status').textContent()) ?? '';
  const m = /^(no|[\d,]+) PRs? /.exec(text);
  expect(m, `the table's count: ${text}`).not.toBeNull();
  return m![1] === 'no' ? 0 : Number(m![1]!.replaceAll(',', ''));
}

/**
 * Brings the PR table on screen, as a reader scrolling down would, and waits
 * for the titles it then fetches: until no drawn row lacks its title and the
 * table is no longer busy loading any year's file. Returns the table.
 */
async function tableReady(page: Page): Promise<Locator> {
  const section = prTable(page);
  await section.scrollIntoViewIfNeeded();
  const rows = section.getByRole('table', { name: /^Pull requests, sorted / });
  await expect(rows.getByRole('row').nth(1)).toBeVisible();
  await expect(rows.getByRole('button', { name: /^Show #\d+$/ })).toHaveCount(0);
  await expect(rows).toHaveAttribute('aria-busy', 'false');
  await expect(section.getByText(/could not be loaded/)).toHaveCount(0);
  return rows;
}

async function open(page: Page, hash = ''): Promise<void> {
  await page.goto(hash === '' ? './' : `./${hash}`);
  await expect(countsChart(page)).toBeVisible();
}

test('the page loads whole, with every section', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Ceph pull requests' })).toBeAttached();
  for (const name of ['Filters', 'Velocity', 'Review', 'LLM use', 'Each PR', 'Timelines', 'Pull requests', 'People']) {
    await expect(page.getByRole('heading', { level: 2, name, exact: true }), name).toBeAttached();
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The table's title files are fetched only once it is on screen; waiting
  // for them puts their requests among those checked.
  await tableReady(page);
});

test('changing the Target filter changes the headline figures', async ({ page }) => {
  await open(page);
  const target = page.getByRole('group', { name: 'Target' });
  await expect(target.getByRole('radio', { name: 'main' })).toBeChecked();
  const before = await headline(page);
  expect(before).not.toBe('');

  await target.getByRole('radio', { name: 'all' }).check();
  await expect(page).toHaveURL(/[#&?]target=all(&|$)/);
  await expect(countsChart(page)).not.toHaveAccessibleDescription(before);
});

test('selecting a week narrows the table to the PRs opened in it', async ({ page }) => {
  await open(page);
  const table = prTable(page);
  await table.scrollIntoViewIfNeeded();
  const all = await tableCount(page);

  // A reader picks a tall bar: the week with the most PRs opened, as each
  // week's accessible name counts them.
  const weeks = countsChart(page).getByRole('group').getByRole('button');
  const opened = await weeks.evaluateAll((els) =>
    els.map((el) => Number(/\bopened ([\d,]+)/.exec(el.getAttribute('aria-label') ?? '')?.[1]?.replaceAll(',', '') ?? -1)),
  );
  expect(opened.length).toBeGreaterThan(1);
  const peak = opened.indexOf(Math.max(...opened));
  const week = weeks.nth(peak);
  await week.click();
  await expect(week).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/[#&?]week=\d{4}-\d{2}-\d{2}(&|$)/);

  await expect(table.getByRole('status')).toContainText(/ opened in the /);
  const narrowed = await tableCount(page);
  expect(narrowed).toBe(opened[peak]);
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThan(all);
  await expect(table.getByRole('table')).toHaveAttribute('aria-rowcount', String(narrowed + 1));
});

test('opening a PR from the table shows its timeline, whose marks link to it on GitHub', async ({ page }) => {
  await open(page);
  const rows = await tableReady(page);
  const row = rows.getByRole('row').nth(1);
  const label = (await row.getByRole('link', { name: /^#\d+ on GitHub/ }).getAttribute('aria-label')) ?? '';
  const number = /^#(\d+) /.exec(label)?.[1];
  expect(number, 'the first row names its PR').toBeTruthy();

  await row.getByRole('cell').nth(1).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`[#&?]pr=${number}(&|$)`));

  // Choosing a PR brings its section on screen, which is what loads the timeline.
  const section = page.getByRole('region', { name: `Pull request #${number}`, exact: true });
  await expect(section.getByRole('heading', { level: 2 })).toBeInViewport();
  const panel = section.getByRole('group', { name: `Selected PR #${number}`, exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('status')).toHaveCount(0);
  const timeline = section.getByRole('figure', { name: `The life of #${number}`, exact: true });
  await expect(timeline).toBeVisible();
  const marks = timeline.getByRole('group', { name: 'The marks on the line, in time order' }).getByRole('link');
  await expect(marks.first()).toBeAttached();

  // A mark links to the PR, or to a part of it by fragment or path; a merge
  // or a force-push links to the commit it made (site/src/lib/links.ts).
  const hrefs = (await marks.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).filter(
    (h): h is string => h !== null,
  );
  const pull = new RegExp(`^${DATA_REPO}/pull/${number}([#/].*)?$`);
  const commit = new RegExp(`^${DATA_REPO}/commit/[0-9a-f]{40}$`);
  expect(hrefs.filter((h) => pull.test(h)).length, 'marks linking to the chosen PR').toBeGreaterThan(0);
  expect(hrefs.filter((h) => !pull.test(h) && !commit.test(h)), 'marks linking elsewhere').toEqual([]);
});

test('an address with an unknown filter value loads the defaults', async ({ page, context }) => {
  await open(page);
  const defaults = await headline(page);
  const address = page.url();

  // Loaded fresh, as a shared link is, not as a hash change on a loaded page.
  const fresh = await context.newPage();
  await open(fresh, '#/?target=no-such-target&size=no-such-size&component=no-such-component&drafts=no-such-choice');
  await expect(fresh).toHaveURL(address);
  await expect(fresh.getByRole('group', { name: 'Target' }).getByRole('radio', { name: 'main' })).toBeChecked();
  await expect(countsChart(fresh)).toHaveAccessibleDescription(defaults);
  await fresh.close();
});

/** The numbers in a column of a table, as drawn, by the column's header. */
async function columnNumbers(table: Locator, header: string): Promise<number[]> {
  return table.evaluate((el, name) => {
    const t = el as HTMLTableElement;
    const heads = Array.from(t.tHead?.rows[0]?.cells ?? []);
    const at = heads.findIndex((h) => h.querySelector('button')?.firstChild?.textContent?.trim() === name);
    if (at < 0) return [];
    return Array.from(t.tBodies[0]?.rows ?? [])
      .filter((r) => r.cells.length > at)
      .map((r) => Number((r.cells[at]?.textContent ?? '').replaceAll(',', '')));
  }, header);
}

test('sorting the Reviewers table by a count orders it, and a handle links to GitHub', async ({ page }) => {
  await open(page);
  const people = page.getByRole('region', { name: 'People', exact: true });
  await people.scrollIntoViewIfNeeded();
  const table = people.getByRole('table', { name: /^Reviewers, sorted by / });
  await expect(table.getByRole('row').nth(1)).toBeVisible();

  const header = table.getByRole('columnheader', { name: 'Comments', exact: true });
  await expect(header).toHaveAttribute('aria-sort', 'none');
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(page).toHaveURL(/[#&?]reviewersort=-comments(&|$)/);
  const down = await columnNumbers(table, 'Comments');
  expect(down.length).toBeGreaterThan(1);
  expect(down.every((n) => Number.isFinite(n))).toBe(true);
  expect(down.some((n, i) => i > 0 && n > down[i - 1]!), `descending: ${down.join(' ')}`).toBe(false);

  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const up = await columnNumbers(table, 'Comments');
  expect(up.some((n, i) => i > 0 && n < up[i - 1]!), `ascending: ${up.join(' ')}`).toBe(false);
  expect(up[0]!).toBeLessThanOrEqual(down[0]!);

  // Checked for its form only: the address is not printed, so a failure names no one.
  const href = await table.getByRole('link', { name: / on GitHub, opens in a new tab$/ }).first().getAttribute('href');
  expect(USER_PAGE.test(href ?? ''), "a handle links to a GitHub user's page").toBe(true);
});

test('the methods page renders every section, its figures, and an address to a section', async ({ page, context }) => {
  await page.goto('./#/methods');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Methods' })).toBeVisible();
  // The figures are computed in the browser; wait for them to settle.
  await expect(main.getByText(/^Loading the data the figures on this page are computed from/)).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveCount(0);

  // Every section the contents list is on the page under that heading, with
  // text of its own: none is a placeholder.
  const contents = main.getByRole('navigation', { name: 'Contents' }).getByRole('link');
  const titles = await contents.allTextContents();
  expect(titles.length).toBeGreaterThan(1);
  await expect(main.getByRole('heading', { level: 2 })).toHaveCount(titles.length + 1);
  for (const title of titles) {
    const section = main.getByRole('region', { name: title.trim(), exact: true });
    await expect(section.getByRole('heading', { level: 2 }), title).toHaveText(title.trim());
    await expect(section.getByRole('paragraph').or(section.getByRole('listitem')).first(), title).not.toBeEmpty();
  }
  await expect(main.getByText(/not written yet|still being (written|built)|to come\b/i)).toHaveCount(0);

  // No figure is missing or still loading, and one sentence of figures reads as numbers.
  await expect(main.getByText(/\((not available|loading)\)/)).toHaveCount(0);
  await expect(main.getByText(/could not be computed/)).toHaveCount(0);
  await expect(
    main.getByText(
      /\b[\d,]+ pull requests, on every branch, were open at some point in the report's default period, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: [\d,]+ opened in it and [\d,]+ before it\b/,
    ),
  ).toBeVisible();

  // The address the contents gives a section, loaded fresh, lands on it.
  const last = contents.last();
  const title = (await last.textContent())!.trim();
  const href = (await last.getAttribute('href')) ?? '';
  expect(href).toMatch(/[#&?]section=[\w-]+(&|$)/);
  const fresh = await context.newPage();
  await fresh.goto(`./${href}`);
  const target = fresh.getByRole('main').getByRole('region', { name: title, exact: true });
  await expect(target).toBeFocused();
  await expect(target.getByRole('heading', { level: 2 })).toBeInViewport();
  await fresh.close();
});

test('the footer shows a version and the repository link', async ({ page }) => {
  await open(page);
  const footer = page.getByRole('contentinfo');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('link', { name: REPO.replace(/^https:\/\//, ''), exact: true })).toHaveAttribute('href', REPO);
  // A released build links its version to that release's page; a local build may be `dev`.
  const version = footer.getByRole('link', { name: /^v\d+\.\d+\.\d+$/ });
  if (process.env['CEPHSTATS_E2E_URL']) {
    await expect(version, 'a published site shows its release').toBeVisible();
  } else {
    await expect(footer).toContainText(/(^|\s)(dev|v\d+\.\d+\.\d+)(\s|$)/);
  }
  if ((await version.count()) > 0) {
    await expect(version).toHaveAttribute('href', `${REPO}/releases/tag/${(await version.textContent())!.trim()}`);
  }
});
