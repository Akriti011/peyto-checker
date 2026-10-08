import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewEncapsulation, inject, output, signal, viewChild } from '@angular/core';
import { FILM_LENGTH, Film3D } from './film3d';
import { exportFilm } from './film-export';

/**
 * Full-screen WebGL hero film (see film3d.ts). Plays once, then keeps the final
 * frame alive. Emits `time` so the page can fade its hero text in.
 */
@Component({
  selector: 'app-hero-film',
  encapsulation: ViewEncapsulation.None,
  template: `
    <canvas #cv aria-hidden="true"></canvas>
    <div class="f3-overlay" #ov aria-hidden="true"></div>
    @if (ready() && !done()) {
      <button class="f3-skip" type="button" (click)="skip()">Skip intro <i class="fa-solid fa-forward"></i></button>
    }
    @if (done() && !exporting() && !failed()) {
      <button class="f3-skip light" type="button" (click)="replay()"><i class="fa-solid fa-rotate-right"></i> Replay</button>
    }
    @if (exportMode && ready()) {
      <div class="f3-export">
        @if (!exporting()) {
          <button type="button" (click)="export4k()"><i class="fa-solid fa-film"></i> Export 4K MP4</button>
        }
        <span>{{ exportMsg() }}</span>
      </div>
    }
  `,
  styles: [`
    app-hero-film { position: absolute; inset: 0; display: block; background: #050102; overflow: hidden; }
    app-hero-film canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .f3-overlay { position: absolute; inset: 0; pointer-events: none; }
    .f3-label {
      position: absolute; left: 0; top: 0; opacity: 0; white-space: nowrap; will-change: transform, opacity;
      font: 600 clamp(11px, 0.78vw, 22px) / 1 var(--font-display); letter-spacing: 0.28em;
      color: rgba(255, 232, 235, 0.95); text-shadow: 0 0 14px rgba(255, 30, 30, 0.75), 0 0 2px rgba(0,0,0,0.9);
      padding: 0.5em 0.9em; border-radius: 999px;
      background: rgba(20, 2, 6, 0.38); border: 1px solid rgba(255, 140, 150, 0.22);
      backdrop-filter: blur(4px);
    }
    .f3-label.warm { color: #ffc9a0; border-color: rgba(255, 150, 60, 0.35); text-shadow: 0 0 14px rgba(255, 120, 30, 0.8); }
    .f3-label.ok { color: #fff; border-color: rgba(255, 255, 255, 0.4); background: rgba(228, 0, 0, 0.35); }
    .f3-skip {
      position: absolute; right: clamp(14px, 2vw, 36px); bottom: clamp(14px, 2vh, 30px); z-index: 6;
      font: 500 clamp(12px, 0.7vw, 18px) var(--font-display); letter-spacing: 0.04em; color: rgba(255, 225, 228, 0.8);
      background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 214, 220, 0.25);
      border-radius: 999px; padding: 0.6em 1.1em; cursor: pointer; backdrop-filter: blur(6px);
      transition: color 0.2s, background 0.2s;
    }
    .f3-export { position: fixed; left: 16px; bottom: 16px; z-index: 2000; display: flex; gap: 12px; align-items: center;
      font: 500 14px var(--font-display); color: #fff; }
    .f3-export button { font: inherit; color: #fff; background: #e40000; border: 0; border-radius: 999px; padding: 10px 18px; cursor: pointer; }
    body.film-exporting .f3-skip { display: none; }
    .f3-skip:hover { color: #fff; background: rgba(228, 0, 0, 0.35); }
    /* Replay sits on the light page background once the film ends */
    .f3-skip.light { color: var(--red); background: var(--white); border-color: var(--pink-mid); box-shadow: var(--nav-shadow); }
    .f3-skip.light:hover { color: var(--white); background: var(--red); }
    .f3-skip i { margin-left: 4px; font-size: 0.85em; }
  `],
})
export class HeroFilm implements AfterViewInit, OnDestroy {
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private ov = viewChild.required<ElementRef<HTMLDivElement>>('ov');
  private zone = inject(NgZone);
  readonly time = output<number>();
  readonly ready = signal(false);
  readonly done = signal(false);
  readonly failed = signal(false);
  readonly exporting = signal(false);
  readonly exportMsg = signal('');
  readonly exportMode = new URLSearchParams(location.search).has('export');

  private film?: Film3D;
  private raf = 0;
  private start = 0;
  private manual = false;
  private ro?: ResizeObserver;
  private lastT = 0;
  private emitted = -1;
  private destroyed = false;

  async ngAfterViewInit() {
    const logo = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'assets/airtel-logo-white.svg';
    });
    await document.fonts?.ready;
    if (this.destroyed) return;   // left the page while the logo/fonts were loading
    const canvas = this.cv().nativeElement;
    try {
      this.film = new Film3D(canvas, this.ov().nativeElement, logo);
    } catch (e) {
      // no WebGL (e.g. hardware acceleration off): skip the film, show the landing hero straight away
      console.warn('Hero film disabled, WebGL unavailable:', e);
      this.failed.set(true);
      this.time.emit(FILM_LENGTH);
      return;
    }
    // ?rec = export mode (full 2x pixel density); live view caps density for smooth playback
    const rec = new URLSearchParams(location.search).has('rec');
    const size = () => {
      if (this.exporting()) return;
      const r = canvas.getBoundingClientRect();
      this.film!.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, rec ? 2 : 1.75));
      if (this.manual) this.film!.render(this.lastT);
    };
    size();
    this.ro = new ResizeObserver(size);
    this.ro.observe(canvas);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.start = performance.now() - (reduce ? FILM_LENGTH * 1000 : 0);

    (window as any).__film = {
      seek: (t: number) => {
        this.manual = true; this.lastT = t; this.film!.render(t);
        this.zone.run(() => { this.time.emit(t); this.done.set(t >= FILM_LENGTH); });
      },
      length: FILM_LENGTH,
    };
    this.ready.set(true);
    this.zone.runOutsideAngular(() => this.loop());
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.manual || document.hidden) return;
    const t = (performance.now() - this.start) / 1000;
    this.lastT = t;
    this.film!.render(t);
    const tt = Math.min(t, FILM_LENGTH + 1);
    if (tt !== this.emitted) {
      this.emitted = tt;
      this.zone.run(() => {
        this.time.emit(tt);
        if (t >= FILM_LENGTH && !this.done()) this.done.set(true);
      });
    }
  };

  async export4k() {
    this.exporting.set(true);
    try {
      const page = document.querySelector('app-landing') as HTMLElement;
      const bytes = await exportFilm(this.film!, page, (p, msg) => this.exportMsg.set(`${Math.round(p * 100)}%  ·  ${msg}`));
      this.exportMsg.set(`Done ✓  (${(bytes / 1e6).toFixed(1)} MB) Downloads mein save hua`);
    } catch (e: any) {
      this.exportMsg.set('Export fail: ' + (e?.message || e));
    } finally {
      document.body.classList.remove('film-exporting');
      this.exporting.set(false);
      this.manual = false;
      const r = this.cv().nativeElement.getBoundingClientRect();
      this.film!.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 1.75));
    }
  }

  skip() { this.start = performance.now() - FILM_LENGTH * 1000; }
  replay() { this.done.set(false); this.start = performance.now(); }

  ngOnDestroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.film?.dispose();
    delete (window as any).__film;
  }
}
