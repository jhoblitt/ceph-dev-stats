<!--
  A person in a table cell: their GitHub handle, a link to their page there
  when the login has the form of one, a mark when the account is a bot, and
  a control that sets or clears the filter by them.
-->
<script lang="ts">
  import type { Handle } from '../lib/handles';

  interface Props {
    handle: Handle;
    bot: boolean;
    /** What the control filters by, e.g. "author"; it reads "Filter by <login> as author". */
    role: string;
    /** Whether the filter is set to this person now. */
    active: boolean;
    ontoggle: () => void;
  }

  let { handle, bot, role, active, ontoggle }: Props = $props();
</script>

<span class="person">
  {#if handle.url}
    <a href={handle.url} target="_blank" rel="noopener noreferrer" aria-label="{handle.text} on GitHub, opens in a new tab"
      >{handle.text}</a
    >
  {:else}
    <span>{handle.text}</span>
  {/if}
  {#if bot}
    <span class="bot">bot</span>
  {/if}
  <button type="button" class="filter" aria-pressed={active} title="Filter by {handle.text} as {role}" onclick={ontoggle}
    ><span class="visually-hidden">Filter by {handle.text} as {role}</span><span aria-hidden="true">filter</span></button
  >
</span>

<style>
  .person {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .bot {
    padding: 0 var(--space-1);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }

  .filter {
    padding: 0 var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
  }

  .filter:hover {
    color: var(--accent);
    border-color: var(--border-strong);
  }

  .filter[aria-pressed='true'] {
    color: var(--accent-ink);
    background: var(--accent);
  }
</style>
