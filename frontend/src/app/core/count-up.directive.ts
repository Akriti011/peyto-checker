import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';

/** Count-up on first view: easeOutCubic, IntersectionObserver threshold 0.25 (from the reference spec). */
@Directive({ selector: '[countUp]' })
export class CountUp implements OnDestroy {
  countUp = input.required<number>();
  decimals = input(0);
  suffix = input('');
  duration = input(1500);
  delay = input(0);

  private el = inject(ElementRef<HTMLElement>);
  private io?: IntersectionObserver;
  private raf = 0;
  private timer: any;

  constructor() {
    effect(() => {
      const target = this.countUp();
      this.stop();
      const run = () => {
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return this.paint(target);
        this.timer = setTimeout(() => {
          const t0 = performance.now(), d = this.duration();
          const step = (now: number) => {
            const p = Math.min(1, (now - t0) / d);
            this.paint(target * (1 - Math.pow(1 - p, 3)));
            if (p < 1) this.raf = requestAnimationFrame(step);
          };
          this.raf = requestAnimationFrame(step);
        }, this.delay());
      };
      this.paint(0);
      this.io = new IntersectionObserver(es => {
        if (es.some(e => e.isIntersecting)) { this.io?.disconnect(); run(); }
      }, { threshold: 0.25 });
      this.io.observe(this.el.nativeElement);
    });
  }

  private paint(v: number) {
    this.el.nativeElement.textContent = v.toFixed(this.decimals()) + this.suffix();
  }
  private stop() { this.io?.disconnect(); cancelAnimationFrame(this.raf); clearTimeout(this.timer); }
  ngOnDestroy() { this.stop(); }
}
