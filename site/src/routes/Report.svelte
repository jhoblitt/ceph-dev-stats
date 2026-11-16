<script lang="ts">
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
  // The lanes name their rows in the PR table's own words for them.
  const laneRowsName = $derived(
    narrowing($view.dataset, { filters: $view.filters, week, band }) ?? ALL_TABLE_ROWS,
  );
</script>

<h1 class="visually-hidden">Ceph pull requests</h1>

<FilterBar />

{#if $data.errors.length > 0}
  <div class="load-errors" role="alert">
    <p>Some of the data could not be loaded, so everything below leaves these years out:</p>
    <ul>
      {#each $data.errors as e (e.file)}
        <li>{yearHolds(loader.meta, e.year)}: <code>{e.file}</code>, {e.message}</li>
      {/each}
    </ul>
  </div>
{/if}

<p class="loading" role="status">{$data.loading ? 'Loading the data for this period…' : ''}</p>

<Velocity />
<Review />
<LlmUse />
<DotPlot />
<Lanes order={laneOrder} orderName={laneOrderName} rowsName={laneRowsName} />
<!-- The chosen PR, what it is and then its timeline, between the views that choose one. -->
<PrTimeline />
<PrTable />
<People />

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
