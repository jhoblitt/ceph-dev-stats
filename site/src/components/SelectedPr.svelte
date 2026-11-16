<!--
  The selected PR in brief: a link to it on GitHub, its kind and what decided
  it, the tracker tickets it references, and for a backport the PR it
  backports. All but the link and the kind's name come from its year's table
  file, which the table loads.
-->
<script lang="ts">
  import type { Dataset } from '../lib/data';
  import { type TableLoad, kindDecided, prUrl, ticketUrl } from '../lib/table';

  interface Props {
    data: Dataset;
    /** The PR's dataset row. */
    row: number;
    /** Its index in its year's table file. */
    index: number;
    table: TableLoad | undefined;
    /** Chooses the PR with this number. */
    onchoose: (pr: number) => void;
  }

  let { data, row, index, table, onchoose }: Props = $props();

  const number = $derived(data.prs.number[row] as number);
  const repo = $derived(data.meta.repo);
  const loaded = $derived(table?.status === 'loaded' ? table.table : null);
  const title = $derived(loaded?.titles[index] ?? '');
  const tickets = $derived(loaded?.tickets[index] ?? []);
  const original = $derived(loaded?.backport_of[index] ?? 0);
  const originalInData = $derived(original > 0 && data.prs.number.includes(original));
  const kind = $derived(data.prs.kind[row] as number);
</script>

{#snippet external(href: string, text: string, name: string)}
  <a {href} target="_blank" rel="noopener noreferrer" aria-label="{name}, opens in a new tab">{text}</a>
{/snippet}

<div class="selected" role="group" aria-label="Selected PR #{number}">
  <h3>Selected: #{number}{title ? ` ${title}` : ''}</h3>
  <p class="open">{@render external(prUrl(repo, number), 'Open on GitHub', `Open on GitHub, #${number}`)}</p>
  {#if table === undefined || table.status === 'loading'}
    <p class="muted" role="status">Loading its details…</p>
  {:else if table.status === 'error'}
    <p class="muted">Its kind’s source, tickets and backport could not be loaded: {table.message}.</p>
    <dl><div><dt>Kind</dt><dd>{data.meta.kinds[kind]?.name ?? 'unknown'}</dd></div></dl>
  {:else}
    <dl>
      <div>
        <dt>Kind</dt>
        <dd>{kindDecided(data.meta.kinds, kind, table.table.kind_source[index] ?? '')}</dd>
      </div>
      {#if tickets.length > 0}
        <div>
          <dt>Tracker ticket{tickets.length === 1 ? '' : 's'}</dt>
          <dd>
            {#each tickets as t, i (i)}{#if i > 0}{', '}{/if}{@render external(
                ticketUrl(t),
                `Ticket ${t}`,
                `Ticket ${t} on tracker.ceph.com`,
              )}{/each}
          </dd>
        </div>
      {/if}
      {#if original > 0}
        <div>
          <dt>Backport of</dt>
          <dd>
            {@render external(prUrl(repo, original), `#${original}`, `#${original} on GitHub`)}
            {#if originalInData}
              <button type="button" onclick={() => onchoose(original)}>Show #{original} here</button>
            {/if}
          </dd>
        </div>
      {/if}
    </dl>
  {/if}
</div>

<style>
  .selected {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--page);
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  p {
    margin: 0 0 var(--space-2);
  }

  .muted {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    margin: 0;
    font-size: var(--text-sm);
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
  }

  button {
    margin-inline-start: var(--space-2);
    padding: 0 var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
</style>
