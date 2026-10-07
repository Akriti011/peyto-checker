import { Component, OnInit, inject, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { Header } from '../components/header';

@Component({
  selector: 'app-rules',
  imports: [Header],
  template: `
  <div class="page-wrap">
    <app-header />
    <section class="intro">
      <span class="kicker anim" style="--d:.05s"><i class="fa-solid fa-book"></i> ECI Design Guidelines v5.2</span>
      <h1 class="section-title anim" style="--d:.12s">Rules We Check</h1>
      <p class="lead anim" style="--d:.2s">Every CKT is checked against these guideline points. Thresholds live in <code>backend/config/rules.yaml</code>, so the team can change them without touching code.</p>
    </section>

    <section class="rules">
      @for (r of rules(); track r.id; let i = $index) {
        <article class="rule anim" [style.--d]="(0.25 + i * 0.05) + 's'">
          <span class="num">{{ (i + 1).toString().padStart(2, '0') }}</span>
          <div><b>{{ r.title }}</b><small>{{ r.id }} &middot; {{ r.ref }}</small></div>
          <i class="fa-solid fa-circle-check"></i>
        </article>
      }
    </section>

    @if (labels(); as l) {
      <section class="card labels anim" style="--d:.6s">
        <h3>Peyto feasibility outcomes</h3>
        <div class="out">
          <div><span class="badge protected"><i class="fa-solid fa-shield-halved"></i> {{ l.protected }}</span><p>Customer mux reaches the Peyto routers over two node-disjoint, alarm-free paths (primary + secondary).</p></div>
          <div><span class="badge unprotected"><i class="fa-solid fa-triangle-exclamation"></i> {{ l.unprotected }}</span><p>Only one healthy path: single-homed ring, or the second path is broken by an alarm.</p></div>
          <div><span class="badge not_feasible"><i class="fa-solid fa-circle-xmark"></i> {{ l.not_feasible }}</span><p>No healthy path from the customer mux to any Peyto router.</p></div>
          <div><span class="badge not_found"><i class="fa-solid fa-magnifying-glass"></i> {{ l.not_found }}</span><p>No NPT service carries this LSI.</p></div>
        </div>
        <p class="note"><i class="fa-solid fa-circle-info"></i> These definitions are the POC's working assumption. Confirm the exact Peyto rule with the team before using results.</p>
      </section>
    }
  </div>`,
  styles: [`
    .page-wrap > app-header { margin-bottom: clamp(20px, 4vh, 40px); }
    .intro { max-width: 980px; margin: 0 auto 22px; }
    .kicker { display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--red); background:var(--white); border:1px solid var(--line); padding:6px 12px; border-radius:999px; }
    h1 { font-size: clamp(30px, 4.6vw, 56px); margin: 14px 0 8px; }
    .lead { margin:0; color:var(--muted); max-width:680px; font-size:15.5px; line-height:1.55; }
    code { background: var(--pink); padding: 1px 6px; border-radius: 6px; font-size: 13px; color: var(--ink); }
    .rules { max-width:980px; margin:0 auto; display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
    .rule { display:flex; align-items:center; gap:14px; background:var(--white); border:1px solid var(--line); border-radius:18px; padding:14px 16px; box-shadow: var(--card-shadow); }
    .num { font-family: var(--font-display); font-weight:900; font-size:30px; color:var(--red); letter-spacing:-0.05em; }
    .rule div { flex:1; display:flex; flex-direction:column; gap:2px; }
    .rule b { font-size:14.5px; }
    .rule small { font-size:12px; color:var(--muted); }
    .rule > i { color: var(--pink-mid); font-size: 18px; }
    .labels { max-width:980px; margin:16px auto 0; padding:18px 20px; }
    .labels h3 { margin:0 0 12px; font-size:16px; }
    .out { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
    .out p { margin:6px 0 0; font-size:13px; color:var(--muted); line-height:1.5; }
    .note { margin:14px 0 0; font-size:12.5px; color:var(--red-deep); background:var(--blush); padding:10px 12px; border-radius:12px; }
    @media (max-width: 720px) { .rules, .out { grid-template-columns: 1fr; } }
  `],
})
export class Rules implements OnInit {
  private api = inject(Api);
  readonly rules = signal<{ id: string; title: string; ref: string }[]>([]);
  readonly labels = signal<any>(null);
  async ngOnInit() {
    const r = await this.api.rules();
    this.rules.set(r.rules); this.labels.set(r.config.feasibility_labels);
  }
}
