import type { ReasoningRule } from './types';
import { OwlStore } from './owl-store';

export class Reasoner {
  constructor(private store: OwlStore) {}

  apply(rules: ReasoningRule[]): number {
    const activeRules = rules.filter(r => r.isActive).sort((a, b) => a.priority - b.priority);
    let newTriples = 0;
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of activeRules) {
        try {
          const bindings = this.matchConditions(rule.conditions);
          for (const binding of bindings) {
            const s = this.substitute(rule.conclusion.subject, binding);
            const p = this.substitute(rule.conclusion.predicate, binding);
            const o = this.substitute(rule.conclusion.object, binding);
            if (this.store.addRelation(s, p, o)) {
              newTriples++;
              changed = true;
            }
          }
        } catch { /* skip failing rule */ }
      }
    }
    return newTriples;
  }

  private matchConditions(conditions: ReasoningRule['conditions']): Array<Map<string, string>> {
    let bindings: Array<Map<string, string>> = [new Map()];
    for (const cond of conditions) {
      const matches = this.store.query(cond.subject, cond.predicate, cond.object);
      const newBindings: Array<Map<string, string>> = [];
      for (const b of bindings) {
        for (const m of matches) {
          const merged = new Map(b);
          let ok = true;
          for (const [k, v] of Object.entries(m)) {
            if (merged.has(k) && merged.get(k) !== v) { ok = false; break; }
            merged.set(k, v);
          }
          if (ok) newBindings.push(merged);
        }
      }
      bindings = newBindings.length > 0 ? newBindings : bindings;
    }
    return bindings;
  }

  private substitute(template: string, binding: Map<string, string>): string {
    return template.replace(/\?(\w+)/g, (_, name) => binding.get(`?${name}`) || `?${name}`);
  }
}
