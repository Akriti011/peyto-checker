import { Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TraceStep } from '../core/api.service';

/** Step-by-step lookup log for one LSI (shown in the detail drawer). */
@Component({
  selector: 'app-trace-view',
  template: `
  @if (steps().length) {
  <div class="tv">
    <div class="tv-title"><i class="fa-solid fa-route"></i> How this was found</div>
    <ol>
      @for (s of steps(); track $index) {
        <li [class]="'s-' + s.status">
          <span class="dot"></span>
          <div>
            <div class="name">{{ s.step }} <em>{{ s.status.replace('_', ' ') }}</em>
              @if (s.ms) { <small>{{ s.ms | number:'1.0-0' }} ms</small> }</div>
            @if (s.ckt_ids.length) { <div class="ids">{{ s.ckt_ids.join(', ') }}</div> }
            @if (s.note) { <div class="note">{{ s.note }}</div> }
          </div>
        </li>
      }
    </ol>
  </div>
  }`,
  imports: [DecimalPipe],
  styles: [`
    .tv{margin:16px 0}
    .tv-title{font-weight:700;color:#e40000;margin-bottom:8px}
    ol{list-style:none;margin:0;padding:0 0 0 6px;border-left:2px solid #ffd6dc}
    li{display:flex;gap:10px;padding:6px 0 10px;position:relative}
    .dot{width:12px;height:12px;border-radius:50%;background:#ffd6dc;margin-left:-13px;margin-top:4px;flex:none;border:2px solid #fff}
    .s-found .dot,.s-protected .dot{background:#e40000}
    .s-error .dot{background:#f0a500}
    .s-unprotected .dot{background:#ff7a8a}
    .name{font-weight:600;color:#3a0a10}
    em{font-style:normal;font-weight:500;font-size:.78rem;color:#7a3a44;background:#fff1f3;padding:1px 8px;border-radius:99px;margin-left:6px;text-transform:capitalize}
    small{color:#a0717a;margin-left:6px}
    .ids{font-family:ui-monospace,Menlo,monospace;color:#e40000;font-size:.85rem}
    .note{color:#7a3a44;font-size:.85rem}
  `],
})
export class TraceView {
  readonly steps = input<TraceStep[]>([]);
}
