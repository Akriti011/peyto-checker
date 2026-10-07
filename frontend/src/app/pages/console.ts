import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ResultRow, RingDetail, Status, shortNode, statusIcon } from '../core/api.service';
import { CountUp } from '../core/count-up.directive';
import { Header } from '../components/header';
import { RingMap } from '../components/ring-map';

type Filter = 'all' | Status | 'design';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

@Component({
  selector: 'app-console',
  imports: [FormsModule, CountUp, Header, RingMap],
  templateUrl: './console.html',
  styleUrl: './console.css',
})
export class Console {
  private api = inject(Api);
  readonly short = shortNode;
  readonly icon = statusIcon;

  readonly steps = [
    { icon: 'fa-file-excel', title: 'Read LSI sheet', sub: 'Find the LSI column' },
    { icon: 'fa-magnifying-glass', title: 'LSI to CKT ID', sub: 'Match the Customer field' },
    { icon: 'fa-diagram-project', title: 'Trace the ring', sub: 'Primary + secondary to Peyto' },
    { icon: 'fa-list-check', title: 'ECI design rules', sub: '7 guideline checks' },
    { icon: 'fa-table', title: 'Fill Excel', sub: 'Result + remarks' },
  ];

  /** decorative ring for the empty state */
  readonly demoRing: RingDetail = (() => {
    const ids = Array.from({ length: 12 }, (_, i) => `N${i}`);
    return {
      name: '', kind: 'ring',
      nodes: ids.map((n, i) => ({ node: n, order: i, role: i === 2 || i === 8 ? 'GW' : 'NE', peyto_router: i === 2 ? 'P1' : i === 8 ? 'P2' : '' })),
      links: [...ids.map((n, i) => ({ a: n, b: ids[(i + 1) % ids.length], type: 'RING', status: 'OK', alarm: '' })),
              { a: 'N2', b: 'P1', type: 'B2B-NNI', status: 'OK', alarm: '' }, { a: 'N8', b: 'P2', type: 'B2B-NNI', status: 'OK', alarm: '' }],
    };
  })();
  readonly demoPaths = [
    { role: 'primary' as const, peyto: 'P1', hops: ['N5', 'N4', 'N3', 'N2', 'P1'] },
    { role: 'secondary' as const, peyto: 'P2', hops: ['N5', 'N6', 'N7', 'N8', 'P2'] },
  ];

  readonly file = signal<File | null>(null);
  readonly dragging = signal(false);
  readonly running = signal(false);
  readonly step = signal(-1);
  readonly error = signal('');
  readonly result = this.api.last;
  readonly filter = signal<Filter>('all');
  readonly query = signal('');
  readonly selected = signal<ResultRow | null>(null);
  readonly selRing = signal<RingDetail | null>(null);

  readonly kpis = computed(() => {
    const s = this.result()?.summary;
    if (!s) return [];
    return [
      { key: 'all', label: 'LSIs Checked', value: s.lsis, icon: 'fa-hashtag', tone: 'plain' },
      { key: 'all', label: 'CKT IDs Found', value: s.ckts, icon: 'fa-link', tone: 'plain' },
      { key: 'protected', label: 'Feasible · Protected', value: s.protected, icon: 'fa-shield-halved', tone: 'red' },
      { key: 'unprotected', label: 'Feasible · Unprotected', value: s.unprotected, icon: 'fa-triangle-exclamation', tone: 'pink' },
      { key: 'not_feasible', label: 'Not Feasible', value: s.not_feasible, icon: 'fa-circle-xmark', tone: 'outline' },
      { key: 'not_found', label: 'LSI Not Found', value: s.not_found, icon: 'fa-magnifying-glass', tone: 'blush' },
      { key: 'design', label: 'Design Issues', value: s.design_issues, icon: 'fa-list-check', tone: 'outline' },
    ] as { key: Filter; label: string; value: number; icon: string; tone: string }[];
  });

  readonly chips = computed(() => {
    const s = this.result()?.summary;
    if (!s) return [];
    return [
      { key: 'all' as Filter, label: 'All', n: this.result()!.rows.length },
      { key: 'protected' as Filter, label: 'Protected', n: s.protected },
      { key: 'unprotected' as Filter, label: 'Unprotected', n: s.unprotected },
      { key: 'not_feasible' as Filter, label: 'Not feasible', n: s.not_feasible },
      { key: 'not_found' as Filter, label: 'Not found', n: s.not_found },
      { key: 'design' as Filter, label: 'Design issues', n: s.design_issues },
    ];
  });

  readonly rows = computed(() => {
    const r = this.result(); if (!r) return [];
    const f = this.filter(), q = this.query().trim().toLowerCase();
    return r.rows.filter(x =>
      (f === 'all' || (f === 'design' ? x.design_ok === false : x.status === f)) &&
      (!q || [x.lsi, x.ckt_id, x.ring, x.customer_mux].some(v => v.toLowerCase().includes(q))));
  });

  // ---------- upload ----------
  onDrop(e: DragEvent) {
    e.preventDefault(); this.dragging.set(false);
    const f = e.dataTransfer?.files?.[0]; if (f) this.pick(f);
  }
  onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.pick(f);
    (e.target as HTMLInputElement).value = '';
  }
  private pick(f: File) {
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) { this.error.set('Please choose an Excel (.xlsx) or CSV file'); return; }
    this.error.set(''); this.file.set(f);
  }

  async run(demo = false) {
    if (this.running()) return;
    this.running.set(true); this.error.set(''); this.selected.set(null);
    const req = this.api.check(demo ? null : this.file());
    try {
      for (let i = 0; i < this.steps.length; i++) { this.step.set(i); await sleep(380); }
      const res = await req;
      this.result.set(res); this.filter.set('all'); this.query.set('');
      this.step.set(this.steps.length);
      setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    } catch (e: any) {
      this.error.set(e?.error?.detail || 'Could not reach the checker service. Is the backend running?');
      this.step.set(-1);
    } finally { this.running.set(false); }
  }

  download() { const r = this.result(); if (r) window.location.href = `/api/download/${r.job_id}`; }

  // ---------- detail drawer ----------
  async open(row: ResultRow) {
    this.selected.set(row); this.selRing.set(null);
    if (row.ring) this.selRing.set(await this.api.ring(row.ring));
  }
  close() { this.selected.set(null); }
  @HostListener('document:keydown.escape') esc() { this.close(); }

  failCount(r: ResultRow) { return r.checks.filter(c => !c.ok).length; }
  stepState(i: number) { const s = this.step(); return i < s ? 'done' : i === s ? 'active' : 'todo'; }
}
