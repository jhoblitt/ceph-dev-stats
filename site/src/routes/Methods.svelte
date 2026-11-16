<!--
  How every figure on the site is arrived at. The prose is Markdown under
  src/content/methods/, shown at once; the figures in it are computed from
  the data when the page is shown, the ones that need the table files only
  once those load, and a load that fails leaves the prose as it is.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { type DataError, type TableYear } from '../lib/data';
  import { dayOf } from '../lib/filters';
  import Prose from '../lib/methods/Prose.svelte';
  import {
    type DataFigures,
    type Loadable,
    type TableFigures,
    dataFigures,
    inlineView,
    tableFigures,
    tableView,
  } from '../lib/methods/present';
  import { sections } from '../lib/methods/sections';
  import { getPage } from '../lib/page';
  import { routeHash } from '../lib/state';

  const { meta, loader, selection } = getPage();
  const all = sections();

  let data = $state<Loadable<DataFigures>>({ state: 'loading' });
  let tables = $state<Loadable<TableFigures>>({ state: 'loading' });

  const here = $derived(routeHash($selection, 'methods', meta));
  const inline = (name: string) => inlineView(name, meta, data, tables);
  const table = (name: string) => tableView(name, meta, data, tables);

  function describe(err: unknown): string {
    const e = err as Partial<DataError>;
    return e.file !== undefined && e.detail !== undefined ? `${e.file}: ${e.detail}` : String(err);
  }

  onMount(() => {
    let live = true;
    void (async () => {
      const loaded = await loader.load(meta.years);
      if (!live) return;
      if (loaded.errors.length > 0) {
        const message = loaded.errors.map((e) => `${e.file}: ${e.message}`).join('; ');
        data = { state: 'error', message };
        tables = { state: 'error', message };
        return;
      }
      data = { state: 'ready', value: dataFigures(loaded.dataset) };
      try {
        const years = await Promise.all(meta.years.map((y) => loader.table(y).then((t): [number, TableYear] => [y, t])));
        if (live) tables = { state: 'ready', value: tableFigures(loaded.dataset, new Map(years)) };
      } catch (err) {
        if (live) tables = { state: 'error', message: describe(err) };
      }
    })();
    return () => {
      live = false;
    };
  });

  function jump(id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }

  function follow(event: MouseEvent, id: string) {
    // A plain #id would replace the hash that holds the route and filters.
    event.preventDefault();
    jump(id);
  }

  const failures = $derived(
    [data, tables].flatMap((l) => (l.state === 'error' ? [l.message] : [])).filter((m, i, a) => a.indexOf(m) === i),
  );
</script>

<article class="methods">
  <header>
    <h1>Methods</h1>
    <p>
      How each figure on this site is arrived at, and what it cannot show. The figures on this page are computed in
      your browser from the same data as the report, as of {dayOf(meta.fetched_through)}.
    </p>
    {#if failures.length > 0}
      <p class="notice" role="alert">
        Some figures on this page could not be computed, because their data did not load ({failures.join('; ')}).
        The text does not depend on them. Reloading the page may help.
      </p>
    {:else if data.state === 'loading' || tables.state === 'loading'}
      <p class="notice" role="status">Loading the data the figures on this page are computed from…</p>
    {/if}
  </header>

  <nav aria-labelledby="methods-contents">
    <h2 id="methods-contents">Contents</h2>
    <ol>
      {#each all as section (section.id)}
        <li><a href={here} data-target={section.id} onclick={(e) => follow(e, section.id)}>{section.title}</a></li>
      {/each}
    </ol>
  </nav>

  {#each all as section (section.id)}
    <Prose {section} {inline} {table} {here} {jump} />
  {/each}
</article>

<style>
  .methods {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    padding-bottom: var(--space-7);
  }

  header p {
    margin: 0;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
  }

  .notice {
    color: var(--text-muted);
  }

  nav h2 {
    font-size: var(--text-lg);
    margin: 0 0 var(--space-2);
  }

  nav ol {
    margin: 0;
    padding-left: var(--space-5);
    columns: 2 18rem;
    column-gap: var(--space-6);
  }

  nav li {
    break-inside: avoid;
    margin-bottom: var(--space-1);
  }
</style>
