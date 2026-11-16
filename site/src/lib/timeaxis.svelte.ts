// One time axis for the charts a section stacks over the same period: each
// chart says whether it names lines at its right end, and every chart on the
// axis keeps the margin for end labels when any of them does, so their
// columns, and with them their buckets and tick labels, line up.

import { SvelteMap } from 'svelte/reactivity';

export class TimeAxis {
  readonly #claims = new SvelteMap<symbol, boolean>();

  /** Records whether the chart `id` names lines at its right end. */
  claim(id: symbol, endLabels: boolean): void {
    if (this.#claims.get(id) !== endLabels) this.#claims.set(id, endLabels);
  }

  /** Forgets the chart `id`, as when it is no longer drawn. */
  release(id: symbol): void {
    this.#claims.delete(id);
  }

  /** Whether any chart on the axis names lines at its right end. */
  get endLabels(): boolean {
    for (const wants of this.#claims.values()) if (wants) return true;
    return false;
  }
}
