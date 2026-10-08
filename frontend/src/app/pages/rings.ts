import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Api, RingDetail, RingSummary, shortNode } from '../core/api.service';
import { Header } from '../components/header';
import { RingMap } from '../components/ring-map';

@Component({
  selector: 'app-rings',
  imports: [Header, RingMap],
  template: `
  <div class="page-wrap">
    <app-header />
    <section class="intro">
      <span class="kicker anim" style="--d:.05s"><i class="fa-solid fa-diagram-project"></i> Topology</span>
      <h1 class="section-title anim" style="--d:.12s">NPT Rings</h1>
      <p class="lead anim" style="--d:.2s">Rings the checker knows about, with gateways, Peyto routers and live alarms. Click a ring to inspect it.</p>
    </section>

    <section class="grid">
      <div class="list">
        @for (r of rings(); track r.name; let i = $index) {
          <button class="ring-card anim" [style.--d]="(0.25 + i * 0.06) + 's'" [class.on]="sel()?.name === r.name" (click)="pick(r.name)">
            <div class="rc-top"><b>{{ r.name }}</b>
              @if (r.alarms) { <span class="alarm"><i class="fa-solid fa-bolt"></i> {{ r.alarms }} alarm{{ r.alarms > 1 ? 's' : '' }}</span> }
              @else { <span class="ok"><i class="fa-solid fa-circle-check"></i> Healthy</span> }
            </div>
            <div class="rc-meta"><span>{{ r.nodes }} NEs</span><span>{{ r.kind === 'ring' ? 'Closed ring' : 'Linear' }}</span><span>{{ r.peyto.length }} Peyto</span></div>
            <div class="rc-peyto">@for (p of r.peyto; track p) { <span>{{ p }}</span> }</div>
          </button>
        }
      </div>

      <div class="card viewer anim" style="--d:.3s">
        @if (sel(); as ring) {
          <app-ring-map [ring]="ring" />
          <div class="side">
            <h3>Gateways</h3>
            @for (g of gateways(); track g.node) {
              <div class="row"><span class="tag">{{ g.role }}</span><b [title]="g.node">{{ short(g.node) }}</b><i class="fa-solid fa-arrow-right"></i><span class="pey">{{ g.peyto_router }}</span></div>
            }
            <h3>Alarms</h3>
            @for (l of alarms(); track l.a + l.b) {
              <div class="row alarm-row"><i class="fa-solid fa-bolt"></i><b>{{ short(l.a) }} – {{ short(l.b) }}</b><span>{{ l.alarm }}</span></div>
            } @empty { <p class="none">No active alarms on this ring.</p> }
          </div>
        }
      </div>
    </section>
  </div>`,
  styles: [`
    .page-wrap > app-header { margin-bottom: clamp(20px, 4vh, 40px); }
    .intro { max-width: 1180px; margin: 0 auto 22px; }
    .kicker { display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--red); background:var(--white); border:1px solid var(--line); padding:6px 12px; border-radius:999px; }
    h1 { font-size: clamp(30px, 4.6vw, 56px); margin: 14px 0 8px; }
    .lead { margin:0; color:var(--muted); max-width:640px; font-size:15.5px; line-height:1.55; }
    .grid { max-width:1180px; margin:0 auto; display:grid; grid-template-columns: 320px 1fr; gap:18px; align-items:start; }
    .list { display:flex; flex-direction:column; gap:10px; }
    .ring-card { text-align:left; font:inherit; color:var(--ink); background:var(--white); border:1px solid var(--line); border-radius:18px; padding:14px 16px; cursor:pointer; box-shadow:var(--card-shadow); transition: transform .2s var(--ease), border-color .2s; }
    .ring-card:hover { transform: translateY(-2px); }
    .ring-card.on { border:2px solid var(--red); }
    .rc-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .rc-top b { font-family: var(--font-display); font-weight:700; font-size:20px; color:var(--red); letter-spacing:-0.01em; }
    .alarm { font-size:12px; font-weight:600; color:var(--white); background:var(--red); padding:3px 9px; border-radius:999px; }
    .ok { font-size:12px; font-weight:600; color:var(--red); background:var(--blush); padding:3px 9px; border-radius:999px; }
    .rc-meta { display:flex; gap:10px; font-size:12.5px; color:var(--muted); margin:6px 0 8px; }
    .rc-peyto { display:flex; gap:6px; flex-wrap:wrap; }
    .rc-peyto span { font-size:11.5px; font-weight:600; background:var(--pink); padding:3px 8px; border-radius:999px; }
    .viewer { padding:18px; display:grid; grid-template-columns: 1fr 260px; gap:18px; align-items:center; }
    .side h3 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:6px 0 8px; }
    .row { display:flex; align-items:center; gap:8px; background:var(--blush); border-radius:12px; padding:9px 10px; margin-bottom:6px; font-size:13px; }
    .row i { color: var(--pink-mid); font-size:11px; }
    .tag { white-space:nowrap; font-size:10.5px; font-weight:700; background:var(--red); color:var(--white); padding:2px 7px; border-radius:999px; }
    .pey { font-weight:600; color:var(--red); }
    .alarm-row { background: var(--pink); flex-wrap: wrap; }
    .alarm-row i { color: var(--red-deep); }
    .alarm-row span { color: var(--red-deep); font-size:12px; }
    .none { color:var(--muted); font-size:13px; margin:0; }
    @media (max-width: 960px) { .grid { grid-template-columns: 1fr; } .viewer { grid-template-columns: 1fr; } }
  `],
})
export class Rings implements OnInit {
  private api = inject(Api);
  readonly short = shortNode;
  readonly rings = signal<RingSummary[]>([]);
  readonly sel = signal<RingDetail | null>(null);
  readonly gateways = computed(() => this.sel()?.nodes.filter(n => n.peyto_router) ?? []);
  readonly alarms = computed(() => this.sel()?.links.filter(l => l.status !== 'OK') ?? []);

  async ngOnInit() {
    this.rings.set(await this.api.rings());
    const first = this.rings().find(r => r.alarms) ?? this.rings()[0];
    if (first) this.pick(first.name);
  }
  async pick(name: string) { this.sel.set(await this.api.ring(name)); }
}
