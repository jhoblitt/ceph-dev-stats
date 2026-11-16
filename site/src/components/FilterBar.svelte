<script lang="ts">
  import { get } from 'svelte/store';
  import {
    type Choice,
    DISCLOSURES,
    type Filters,
    SIZE_BANDS,
    STANDING_BANDS,
    TARGETS,
    dayOf,
    findChoice,
  } from '../lib/filters';
  import { getPage } from '../lib/page';

  const { meta, selection } = getPage();
  const uid = $props.id();
  const first = dayOf(meta.window_start);
  const last = dayOf(meta.fetched_through);
  const filters = $derived($selection.filters);

  function set(patch: Partial<Filters>) {
    selection.update((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  }

  // A day the state rejects (outside the data, or past the other end) leaves
  // the state as it was; show that rather than what was typed.
  function setDay(which: 'from' | 'to', input: HTMLInputElement) {
    set(which === 'from' ? { from: input.value } : { to: input.value });
    input.value = get(selection).filters[which];
  }

  interface Select {
    id: string;
    label: string;
    value: string;
    options: readonly Choice<string>[];
    change(value: string): void;
  }

  // The empty value stands for no filter.
  const all: Choice<string> = { id: '', label: 'all' };

  const selects: Select[] = $derived([
    {
      id: 'component',
      label: 'Component',
      value: filters.component ?? '',
      options: [all, ...meta.components.map((c) => ({ id: c.id, label: c.name }))],
      change: (v) => set({ component: v === '' ? null : v }),
    },
    {
      id: 'size',
      label: 'Size (lines added and deleted)',
      value: filters.size ?? '',
      options: [all, ...SIZE_BANDS],
      change: (v) => set({ size: findChoice(SIZE_BANDS, v) }),
    },
    {
      id: 'standing',
      label: 'Author standing (earlier PRs)',
      value: filters.standing ?? '',
      options: [all, ...STANDING_BANDS],
      change: (v) => set({ standing: findChoice(STANDING_BANDS, v) }),
    },
    {
      id: 'disclosure',
      label: 'Disclosure',
      value: filters.disclosure ?? '',
      options: [all, ...DISCLOSURES],
      change: (v) => set({ disclosure: findChoice(DISCLOSURES, v) }),
    },
    {
      id: 'drafts',
      label: 'Drafts',
      value: filters.excludeDrafts ? 'exclude' : '',
      options: [
        { id: '', label: 'include' },
        { id: 'exclude', label: 'exclude' },
      ],
      change: (v) => set({ excludeDrafts: v === 'exclude' }),
    },
    {
      id: 'reopened',
      label: 'Reopened',
      value: filters.reopenedOnly ? 'only' : '',
      options: [all, { id: 'only', label: 'reopened only' }],
      change: (v) => set({ reopenedOnly: v === 'only' }),
    },
  ]);
</script>

<section class="filter-bar" aria-labelledby="{uid}-heading">
  <h2 id="{uid}-heading" class="visually-hidden">Filters</h2>

  <fieldset>
    <legend>Period</legend>
    <div class="days">
      <div class="field">
        <label for="{uid}-from">From</label>
        <input
          id="{uid}-from"
          type="date"
          min={first}
          max={filters.to}
          value={filters.from}
          onchange={(e) => setDay('from', e.currentTarget)}
        />
      </div>
      <div class="field">
        <label for="{uid}-to">To</label>
        <input
          id="{uid}-to"
          type="date"
          min={filters.from}
          max={last}
          value={filters.to}
          onchange={(e) => setDay('to', e.currentTarget)}
        />
      </div>
    </div>
  </fieldset>

  <fieldset>
    <legend>Target</legend>
    <div class="segmented">
      {#each TARGETS as t (t.id)}
        <label>
          <input
            type="radio"
            name="{uid}-target"
            value={t.id}
            checked={filters.target === t.id}
            onchange={() => set({ target: t.id })}
          />
          <span>{t.label}</span>
        </label>
      {/each}
    </div>
  </fieldset>

  {#each selects as f (f.id)}
    <div class="field">
      <label for="{uid}-{f.id}">{f.label}</label>
      <select id="{uid}-{f.id}" value={f.value} onchange={(e) => f.change(e.currentTarget.value)}>
        {#each f.options as o (o.id)}
          <option value={o.id}>{o.label}</option>
        {/each}
      </select>
    </div>
  {/each}
</section>

<style>
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-4) var(--space-5);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  legend,
  .field label {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  legend {
    padding: 0;
    margin-bottom: var(--space-1);
  }

  .days {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  input[type='date'],
  select {
    min-height: 2.25rem;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--text);
    font: inherit;
    font-size: var(--text-base);
  }

  .segmented {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .segmented label {
    position: relative;
    display: flex;
  }

  .segmented label + label {
    border-left: 1px solid var(--border-strong);
  }

  /* The radio stays in the accessibility tree and takes focus; its label is the button. */
  .segmented input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }

  .segmented span {
    display: flex;
    align-items: center;
    min-height: 2.25rem;
    padding: var(--space-1) var(--space-3);
    color: var(--text);
    background: var(--page);
    white-space: nowrap;
  }

  .segmented input:hover + span {
    background: var(--accent-wash);
  }

  .segmented input:checked + span {
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* The ring of page colour keeps the focus outline visible on the accent fill. */
  .segmented input:focus-visible + span {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
    box-shadow: inset 0 0 0 4px var(--page);
  }
</style>
