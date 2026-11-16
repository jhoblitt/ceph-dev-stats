<!--
  The selected PR's timeline. It needs that PR's year of the table file, for
  its commits and the refs its links are built from, and loads only that,
  and only once the section is on screen: a link naming a PR must not fetch
  the large file at page load.
-->
<script lang="ts">
  import { locateRow } from '../lib/data';
  import { getPage } from '../lib/page';
  import { prUrl } from '../lib/links';
  import { prTimeline, rowOf } from '../lib/timeline';
  import { onScreen } from './onscreen';
  import TimelineChart from './timeline/TimelineChart.svelte';

  const { selection, data, view, loader, meta } = getPage();

  const pr = $derived($selection.pr);
  const dataset = $derived($view.dataset);
  const row = $derived(pr === null ? -1 : rowOf(dataset, pr));
  const year = $derived(row === -1 ? null : locateRow(dataset, row).year);
  let shown = $state(false);
  const table = $derived(year === null || !shown ? null : loader.table(year));
</script>

{#if pr !== null}
  <section id="pr" aria-labelledby="pr-heading" {@attach onScreen(() => (shown = true))}>
    <h2 id="pr-heading">
      Timeline of <a href={prUrl(meta.repo, pr)} target="_blank" rel="noopener noreferrer">#{pr}</a>
    </h2>
    {#if row === -1}
      {#if $data.loading}
        <p class="status" role="status">Loading the data…</p>
      {:else}
        <p class="missing">
          no such PR: #{pr} is not in the data{$data.errors.length > 0 ? ' that could be loaded' : ''}.
        </p>
      {/if}
    {:else if table === null}
      <p class="status waiting">The timeline of #{pr} loads when this section is on screen.</p>
    {:else}
      <!-- A new PR starts afresh: no scroll, open commits list or focus carries over. -->
      {#key pr}
        {#await table}
          <p class="status waiting" role="status">Loading the timeline of #{pr}…</p>
        {:then t}
          <TimelineChart timeline={prTimeline(dataset, row, t)} />
        {:catch err}
          <p class="missing" role="alert">
            The timeline of #{pr} could not be loaded: {err instanceof Error ? err.message : String(err)}. Reloading the
            page will try again.
          </p>
        {/await}
      {/key}
    {/if}
  </section>
{/if}

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  h2 {
    margin: 0;
  }

  .status,
  .missing {
    margin: 0;
    color: var(--text-muted);
  }

  /* From the placeholder through the load, holds about a timeline's height,
     so the section does not shrink before the chart replaces it. */
  .waiting {
    min-height: 24rem;
  }

  @media (width < 720px) {
    section {
      padding: var(--space-4);
    }
  }
</style>
