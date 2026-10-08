import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { CountUp } from '../core/count-up.directive';
import { Header } from '../components/header';

@Component({
  selector: 'app-landing',
  imports: [RouterLink, CountUp, Header],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class Landing implements OnInit, AfterViewInit, OnDestroy {
  private api = inject(Api);
  private vid = viewChild.required<ElementRef<HTMLVideoElement>>('vid');
  /** video clock in seconds */
  readonly t = signal(0);
  /** true once the intro video has finished; reveals CTA, header and stats */
  readonly ended = signal(false);
  // shown immediately; replaced by live numbers from the backend
  readonly stats = signal([
    { glyph: '@', value: 3, suffix: '', dec: 0, label: 'NPT Rings Mapped' },
    { glyph: '#', value: 47, suffix: '', dec: 0, label: 'Network Elements' },
    { glyph: '*', value: 5, suffix: '', dec: 0, label: 'Peyto Routers' },
    { glyph: '+', value: 7, suffix: '', dec: 0, label: 'ECI Design Rules' },
  ]);

  async ngOnInit() {
    document.body.classList.add('lock');
    try {
      const o = await this.api.overview();
      this.stats.set([
        { glyph: '@', value: o.rings, suffix: '', dec: 0, label: 'NPT Rings Mapped' },
        { glyph: '#', value: o.nodes, suffix: '', dec: 0, label: 'Network Elements' },
        { glyph: '*', value: o.peyto_routers, suffix: '', dec: 0, label: 'Peyto Routers' },
        { glyph: '+', value: o.rules, suffix: '', dec: 0, label: 'ECI Design Rules' },
      ]);
    } catch { /* backend offline: keep defaults */ }
  }
  ngAfterViewInit() {
    // Angular's `muted` attribute does not set the property, which autoplay needs
    const v = this.vid().nativeElement;
    v.muted = true;
    v.play().catch(() => this.skip(v)); // autoplay blocked: go straight to the final frame
  }

  onVideoEnd() { this.ended.set(true); }

  /** the recording shows the old landing UI after this point, so freeze on the network frame */
  private readonly cut = 14.2;
  onTime(v: HTMLVideoElement) {
    this.t.set(v.currentTime);
    if (v.currentTime >= this.cut && !this.ended()) { v.pause(); this.onVideoEnd(); }
  }
  skip(v: HTMLVideoElement) { v.currentTime = this.cut; v.pause(); this.onVideoEnd(); }
  ngOnDestroy() { document.body.classList.remove('lock'); }
}
