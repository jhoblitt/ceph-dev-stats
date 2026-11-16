<script lang="ts">
  import { tick } from 'svelte';
  import DotPlot from '../components/DotPlot.svelte';
  import FilterBar from '../components/FilterBar.svelte';
  import Lanes from '../components/Lanes.svelte';
  import LlmUse from '../components/LlmUse.svelte';
  import People from '../components/People.svelte';
  import PrTable from '../components/PrTable.svelte';
  import PrTimeline from '../components/PrTimeline.svelte';
  import Review from '../components/Review.svelte';
  import Velocity from '../components/Velocity.svelte';
  import { yearHolds } from '../lib/data';
  import { keepEqual } from '../lib/memo';
  import { getPage } from '../lib/page';
  import { type Sort, sameSort } from '../lib/sort';
  import { ALL_TABLE_ROWS, narrowing, rowText, sortWords, tableOrder } from '../lib/table';
  import { tableLoads } from '../lib/tables';

  const { data, selection, view, loader } = getPage();

  // The lanes list the PR table's rows in the PR table's order. Choosing a
  // PR leaves the order, and so the lanes, alone; titles count only when the
  // table is sorted by title.
  const loads = tableLoads(loader);
  const keepSort = keepEqual<Sort>(sameSort);
  const sort = $derived(keepSort($selection.sort));
  const week = $derived($selection.week);
  const band = $derived($selection.band);
  const titles = $derived(sort.column === 'title' ? rowText($view.dataset, loads.map) : undefined);
  const laneOrder = $derived(tableOrder($view.dataset, $view.rows, { filters: $view.filters, week, band }, sort, titles));
  const laneOrderName = $derived(`in the PR table’s order, ${sortWords(sort)}`);
  // A file that did not arrive may arrive when fetched again; one that
  // arrived and could not be read is the same file until the data is
  // published again.
  const canRetry = $derived($data.errors.some((e) => e.retry));
  const remedy = $derived(
    canRetry
      ? 'Try again fetches what failed.'
      : 'A file arrived but could not be read, so trying again would not help; reloading the page after the data is next published may.',
  );
  // A period is never shown over fewer years than it needs: while its years
  // load, or after one failed, the sections keep the last period that loaded
  // whole, and the line says which.
  const status = $derived(
    $data.loading
      ? $view.pending && !$view.first
        ? `Loading the data for this period; everything below is still for ${$view.filters.from} to ${$view.filters.to}, with the filters then chosen.`
        : 'Loading the data for this period…'
      : $view.pending
        ? `The data for the period chosen could not be loaded, so everything below is still for ${$view.filters.from} to ${$view.filters.to}, with the filters then chosen. ${remedy}`
        : $data.retry.state === 'succeeded'
          ? 'All the data for this period has loaded.'
          : '',
  );
  const retrying = $derived($data.retry.state === 'running');
  const clock = (at: number) => new Date(at).toTimeString().slice(0, 5);

  // The alert, and the button the reader pressed in it, go once a retry
  // brings every year: the focus moves to the line that says so.
  let statusLine = $state<HTMLElement>();
  let lastRetry = $data.retry.state;
  $effect(() => {
    const now = $data.retry.state;
    if (now === 'succeeded' && lastRetry !== 'succeeded') void tick().then(() => statusLine?.focus());
    lastRetry = now;
  });
  const tryAgain = () => {
    if (!retrying) data.retry();
  };
  // The lanes name their rows in the PR table's own words for them.
  const laneRowsName = $derived(
    narrowing($view.dataset, { filters: $view.filters, week, band }) ?? ALL_TABLE_ROWS,
  );
</script>

<h1 class="visually-hidden">Ceph pull requests</h1>

<FilterBar />

{#if $data.errors.length > 0}
  <div class="load-errors" role="alert">
    <p>
      {$view.pending
        ? 'Some of the data for the period chosen could not be loaded:'
        : 'Some of the data could not be loaded, so everything below leaves these years out:'}
    </p>
    <ul>
      {#each $data.errors as e (e.file)}
        <li>{yearHolds(loader.meta, e.year)}: <code>{e.file}</code>, {e.message}</li>
      {/each}
    </ul>
    {#if $data.retry.state === 'failed'}
      <p>Tried again at {clock($data.retry.at)}; it still could not be loaded.</p>
    {/if}
    {#if canRetry}
      <button type="button" aria-disabled={retrying ? 'true' : undefined} onclick={tryAgain}>
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
    {/if}
  </div>
{/if}

<p class="loading" role="status" tabindex="-1" bind:this={statusLine}>{status}</p>

{#if $view.first}
  <!-- Reached from another route while the period's years load: no section has figures to show yet. -->
  <div class="waiting" aria-busy="true"></div>
{:else}
  <Velocity />
  <Review />
  <LlmUse />
  <DotPlot />
  <Lanes order={laneOrder} orderName={laneOrderName} rowsName={laneRowsName} />
  <!-- The chosen PR, what it is and then its timeline, between the views that choose one. -->
  <PrTimeline />
  <PrTable />
  <People />
{/if}

<style>
  .load-errors {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .load-errors p,
  .load-errors ul {
    margin: 0;
  }

  .load-errors button {
    margin-top: var(--space-2);
    min-height: 2.25rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .load-errors button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .waiting {
    min-height: 60vh;
  }

  .loading {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* Out of the flow while empty, but still rendered, so the live region announces. */
  .loading:empty {
    position: absolute;
  }
</style>
