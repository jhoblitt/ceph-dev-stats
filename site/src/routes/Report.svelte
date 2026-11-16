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
  import { getPage } from '../lib/page';

  const { data, selection } = getPage();
</script>

<h1 class="visually-hidden">Ceph pull requests</h1>

<FilterBar />

{#if $data.errors.length > 0}
  <div class="load-errors" role="alert">
    <p>Some of the data could not be loaded, so everything below leaves these years out:</p>
    <ul>
      {#each $data.errors as e (e.file)}
        <li>PRs opened in {e.year}: <code>{e.file}</code>, {e.message}</li>
      {/each}
    </ul>
  </div>
{/if}

<p class="loading" role="status">{$data.loading ? 'Loading the data for this period…' : ''}</p>

<Velocity />
<Review />
<LlmUse />
<DotPlot />
<Lanes />
<PrTable />
{#if $selection.pr !== null}
  <PrTimeline />
{/if}
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
