<script lang="ts">
  import { get } from 'svelte/store';
  import {
    type Choice,
    DISCLOSURES,
    type Filters,
    SIZE_BANDS,
    STANDING_BANDS,
    TARGETS,
    UNKNOWN_KIND,
    findChoice,
  } from '../lib/filters';
  import { GHOST, findLogin } from '../lib/handles';
  import { getPage } from '../lib/page';
  import { dataDays, defaultFilters } from '../lib/state';
  import { formatDate } from '../lib/timeline-axis';

  const { meta, selection } = getPage();
  const uid = $props.id();
  const { first, last } = dataDays(meta);
  const recent = defaultFilters(meta);
  const filters = $derived($selection.filters);

  // A period the reader can reach in one choice: the default, and the whole
  // window when it reaches further back, which the date inputs reach only
  // a field at a time.
  const presets = [
    { label: 'Last 6 months', from: recent.from, to: recent.to },
    ...(first < recent.from ? [{ label: `All, from ${formatDate(meta.window_start)}`, from: first, to: last }] : []),
  ];

  function set(patch: Partial<Filters>) {
    selection.update((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  }

  // A day the state rejects (outside the data, or past the other end) leaves
  // the state as it was; show that rather than what was typed.
  function setDay(which: 'from' | 'to', input: HTMLInputElement) {
    set(which === 'from' ? { from: input.value } : { to: input.value });
    input.value = get(selection).filters[which];
  }

  type PersonFilter = 'author' | 'reviewer';
  // The Reviewer filter's dependence on the period is shown, not only hinted, since it narrows every section.
  const PEOPLE: { id: PersonFilter; label: string; hint: string; shown: boolean }[] = [
    { id: 'author', label: 'Author', hint: 'PRs this GitHub login opened', shown: false },
    { id: 'reviewer', label: 'Reviewer', hint: 'PRs reviewed or commented on in the period', shown: true },
  ];
  const bots = new Set(meta.people_bots);
  // What was typed that the data does not name, by filter, until the next change.
  let unknown = $state<Record<PersonFilter, string | null>>({ author: null, reviewer: null });

  // A login in any case is the one the data gives; one it does not name
  // leaves the filter as it was, and says so.
  function setPerson(which: PersonFilter, input: HTMLInputElement) {
    const typed = input.value.trim();
    const login = typed === '' ? null : findLogin(meta, typed);
    unknown[which] = typed !== '' && login === null ? typed : null;
    if (typed === '' || login !== null) setLogin(which, login);
    input.value = get(selection).filters[which] ?? '';
  }

  function setLogin(which: PersonFilter, login: string | null) {
    set(which === 'author' ? { author: login } : { reviewer: login });
  }

  function clearPerson(which: PersonFilter) {
    unknown[which] = null;
    setLogin(which, null);
  }

  const unknownText = (typed: string | null) => (typed === null ? '' : `No PR in the data names “${typed}”.`);

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
      id: 'kind',
      label: 'Kind',
      value: filters.kind ?? '',
      options: [all, ...meta.kinds.map((k) => ({ id: k.id, label: k.name })), UNKNOWN_KIND],
      change: (v) => set({ kind: v === '' ? null : v }),
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
      <div class="presets">
        {#each presets as p (p.label)}
          <button
            type="button"
            aria-pressed={filters.from === p.from && filters.to === p.to ? 'true' : 'false'}
            onclick={() => set({ from: p.from, to: p.to })}>{p.label}</button
          >
        {/each}
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

  <div class="people">
    {#each PEOPLE as f (f.id)}
      {@const value = filters[f.id]}
      <div class="field">
        <label for="{uid}-{f.id}">{f.label}</label>
        <div class="person">
          <input
            id="{uid}-{f.id}"
            type="text"
            list="{uid}-people"
            value={value ?? ''}
            placeholder="any GitHub login"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            title={f.hint}
            aria-describedby={[f.shown ? `${uid}-${f.id}-hint` : '', unknown[f.id] === null ? '' : `${uid}-${f.id}-unknown`]
              .filter(Boolean)
              .join(' ') || undefined}
            onchange={(e) => setPerson(f.id, e.currentTarget)}
          />
          {#if value !== null}
            <button type="button" aria-label="Clear the {f.label} filter" onclick={() => clearPerson(f.id)}>clear</button>
          {/if}
        </div>
        {#if f.shown}
          <p class="hint" id="{uid}-{f.id}-hint">{f.hint}</p>
        {/if}
        <p class="unknown" id="{uid}-{f.id}-unknown" role="status">{unknownText(unknown[f.id])}</p>
      </div>
    {/each}
  </div>
  <datalist id="{uid}-people">
    {#each meta.people as login, i (login)}
      <option value={login}>{login === GHOST ? 'deleted account' : bots.has(i) ? 'bot' : ''}</option>
    {/each}
  </datalist>
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

  /* Every control fits the bar's width on a narrow phone: a field may be no
     wider than the bar, and what is in it shrinks or wraps. */
  fieldset,
  .field,
  .people,
  .person {
    min-width: 0;
    max-width: 100%;
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
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
  input[type='text'],
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

  input[type='text'] {
    width: 13rem;
    min-width: 0;
    flex: 0 1 auto;
  }

  /* The bar aligns its fields at the bottom; the Reviewer's line under its
     input would lift that input above the Author's, so the pair aligns at
     the top among themselves. */
  .people {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--space-4) var(--space-5);
  }

  .person {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2);
  }

  .presets button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .presets button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .person button,
  .presets button {
    min-height: 2.25rem;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--page);
    color: var(--accent);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .hint,
  .unknown {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .hint {
    max-width: min(16rem, 100%);
  }

  /* Out of the flow while empty, but still rendered, so the live region announces. */
  .unknown:empty {
    position: absolute;
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

  @media (width < 480px) {
    .filter-bar {
      padding: var(--space-3) var(--space-4);
    }
  }
</style>
