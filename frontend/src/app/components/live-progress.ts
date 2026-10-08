import { Component, computed, input } from '@angular/core';
import { ResultRow, sourceLabel, statusIcon } from '../core/api.service';

/** Live per-LSI feed shown while a batch runs: progress bar + newest rows first. */
@Component({
  selector: 'app-live-progress',
  template: `
  @if (total() > 0) {
  <section class="lp">
    <div class="lp-head">
      <div>
        <div class="lp-title"><i class="fa-solid fa-satellite-dish"></i> Live check</div>
        <div class="lp-sub">
          {{ done() }} / {{ total() }} LSIs
          @if (current() && running()) { · now on <b>{{ current() }}</b> }
        </div>
      </div>
      <div class="lp-pct">{{ pct() }}%</div>
    </div>
    <div class="lp-bar"><span [style.width.%]="pct()"></span></div>
    <ul class="lp-list">
      @for (r of recent(); track $index) {
        <li [class]="'st-' + r.status">
          <span class="lsi">{{ r.lsi }}</span>
          <span class="src" [class.ssh]="r.ckt_source === 'ssh'">
            <i class="fa-solid" [class.fa-terminal]="r.ckt_source === 'ssh'" [class.fa-magnifying-glass]="r.ckt_source !== 'ssh'"></i>
            {{ src[r.ckt_source || ''] }}
          </span>
          <span class="ckt">{{ r.ckt_id || '—' }}</span>
          <span class="lbl"><i class="fa-solid {{ icon[r.status] }}"></i> {{ r.label }}</span>
        </li>
      }
    </ul>
  </section>
  }`,
  styles: [`
    .lp{background:#fff;border:1px solid #ffd6dc;border-radius:16px;padding:18px 20px;margin:18px 0;box-shadow:0 6px 24px rgba(228,0,0,.06)}
    .lp-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
    .lp-title{font-weight:700;color:#e40000;letter-spacing:.02em}
    .lp-sub{color:#7a3a44;font-size:.9rem;margin-top:2px}
    .lp-pct{font-size:1.8rem;font-weight:700;color:#e40000}
    .lp-bar{height:8px;background:#fff1f3;border-radius:99px;margin:12px 0 14px;overflow:hidden}
    .lp-bar span{display:block;height:100%;background:linear-gradient(90deg,#ff7a8a,#e40000);transition:width .4s ease}
    .lp-list{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto}
    .lp-list li{display:grid;grid-template-columns:110px 140px 1fr auto;gap:10px;align-items:center;padding:8px 10px;
      border-radius:10px;font-size:.9rem;animation:in .35s ease}
    .lp-list li:nth-child(odd){background:#fff7f8}
    .lsi{font-weight:700;color:#3a0a10}
    .src{color:#7a3a44;font-size:.82rem}.src.ssh{color:#e40000;font-weight:600}
    .ckt{font-family:ui-monospace,Menlo,monospace;color:#3a0a10;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lbl{font-weight:600;font-size:.82rem;padding:3px 10px;border-radius:99px;white-space:nowrap}
    .st-protected .lbl{background:#e40000;color:#fff}
    .st-unprotected .lbl{background:#ffb3bf;color:#3a0a10}
    .st-not_feasible .lbl{border:1px solid #e40000;color:#e40000}
    .st-not_found .lbl{background:#fff1f3;color:#8a4a55}
    .st-manual_check .lbl{background:#ffe08a;color:#5c3b00}
    @keyframes in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
    @media (max-width:700px){.lp-list li{grid-template-columns:1fr 1fr}.ckt,.src{display:none}}
  `],
})
export class LiveProgress {
  readonly rows = input<ResultRow[]>([]);
  readonly done = input(0);
  readonly total = input(0);
  readonly current = input('');
  readonly running = input(false);
  readonly src = sourceLabel;
  readonly icon = statusIcon;
  readonly pct = computed(() => (this.total() ? Math.round((this.done() / this.total()) * 100) : 0));
  readonly recent = computed(() => [...this.rows()].reverse().slice(0, 50));
}
