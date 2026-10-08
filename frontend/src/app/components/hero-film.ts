import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, inject, output, signal, viewChild } from '@angular/core';
import { FILM_LENGTH, HeroFilm as Engine } from './hero-film.engine';

/**
 * Full-screen canvas that plays the 16 s Peyto Checker hero film once,
 * then keeps the final frame alive (fibre line keeps flowing).
 * Emits `time` every frame so the page can fade its hero text in.
 */
@Component({
  selector: 'app-hero-film',
  template: `
    <canvas #cv aria-hidden="true"></canvas>
    @if (ready() && !done()) {
      <button class="skip" type="button" (click)="skip()">Skip intro <i class="fa-solid fa-forward"></i></button>
    }
    @if (done()) {
      <button class="skip" type="button" (click)="replay()"><i class="fa-solid fa-rotate-right"></i> Replay</button>
    }
  `,
  styles: [`
    :host { position: absolute; inset: 0; display: block; background: #050102; }
    canvas { width: 100%; height: 100%; display: block; }
    .skip {
      position: absolute; right: clamp(14px, 2vw, 28px); bottom: clamp(14px, 2vh, 24px); z-index: 6;
      font: 500 13px var(--font-sans); letter-spacing: 0.04em; color: rgba(255, 225, 228, 0.75);
      background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 214, 220, 0.25);
      border-radius: 999px; padding: 8px 14px; cursor: pointer; backdrop-filter: blur(6px);
      transition: color 0.2s, background 0.2s;
    }
    .skip:hover { color: #fff; background: rgba(228, 0, 0, 0.35); }
    .skip i { margin-left: 4px; font-size: 11px; }
  `],
})
export class HeroFilm implements AfterViewInit, OnDestroy {
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private zone = inject(NgZone);
  readonly time = output<number>();
  readonly ready = signal(false);
  readonly done = signal(false);

  private engine?: Engine;
  private raf = 0;
  private start = 0;          // performance.now() when t = 0
  private manual = false;     // true while a recorder drives the timeline
  private ro?: ResizeObserver;

  async ngAfterViewInit() {
    const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
    });
    const [data, plate, logo] = await Promise.all([
      fetch('hero/film-data.json').then(r => r.json()),
      load('hero/plate.jpg'),
      load('hero/logo.png'),
      document.fonts?.ready,
    ]);
    const canvas = this.cv().nativeElement;
    this.engine = new Engine(canvas, data, plate, logo);
    this.engine.resize();
    this.ro = new ResizeObserver(() => { this.engine!.resize(); if (this.manual) this.draw(this.lastT); });
    this.ro.observe(canvas);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.start = performance.now() - (reduce ? FILM_LENGTH * 1000 : 0);

    // hook for frame-by-frame recording (used to export the MP4)
    (window as any).__film = {
      seek: (t: number) => { this.manual = true; this.draw(t); },
      length: FILM_LENGTH,
    };
    this.ready.set(true);
    this.zone.runOutsideAngular(() => this.loop());
  }

  private lastT = 0;
  private draw(t: number) {
    this.lastT = t;
    this.engine!.render(t);
    this.zone.run(() => {
      this.time.emit(t);
      const finished = t >= FILM_LENGTH;
      if (finished !== this.done()) this.done.set(finished);
    });
  }

  private emitted = -1;
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.manual || document.hidden) return;
    const t = (performance.now() - this.start) / 1000;
    this.engine!.render(t);
    this.lastT = t;
    // only cross into Angular when the hero text actually needs updating
    const tt = Math.min(t, FILM_LENGTH + 1);
    if (tt !== this.emitted) {
      this.emitted = tt;
      this.zone.run(() => {
        this.time.emit(tt);
        if (t >= FILM_LENGTH && !this.done()) this.done.set(true);
      });
    }
  };

  skip() { this.start = performance.now() - FILM_LENGTH * 1000; }
  replay() { this.done.set(false); this.start = performance.now(); }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    delete (window as any).__film;
  }
}
