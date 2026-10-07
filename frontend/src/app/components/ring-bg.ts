import { AfterViewInit, Component, ElementRef, OnDestroy, viewChild } from '@angular/core';

/**
 * Animated NPT network background (replaces the stock video in the reference layout).
 * Two rings + Peyto routers; packets run primary (red) and secondary (pink) around the rings.
 */
interface Ring { cx: number; cy: number; r: number; n: number; phase: number; pts: { x: number; y: number }[]; gw: number[]; }
interface Packet { ring: number; i: number; dir: 1 | -1; t: number; hops: number; speed: number; color: string; }

@Component({
  selector: 'app-ring-bg',
  template: `<canvas #cv></canvas><div class="veil"></div>`,
  styles: [`
    :host { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0;
      background: radial-gradient(1100px 700px at 50% 45%, #ffffff 0%, #fff6f7 45%, #ffe4e9 100%); }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .veil { position: absolute; inset: 0;
      background: radial-gradient(ellipse 46% 42% at 50% 50%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.55) 55%, rgba(255,255,255,0) 100%); }
  `],
})
export class RingBg implements AfterViewInit, OnDestroy {
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private ctx!: CanvasRenderingContext2D;
  private rings: Ring[] = [];
  private packets: Packet[] = [];
  private raf = 0;
  private w = 0; private h = 0; private dpr = 1;
  private onResize = () => this.layout();

  ngAfterViewInit() {
    this.ctx = this.cv().nativeElement.getContext('2d')!;
    this.layout();
    window.addEventListener('resize', this.onResize);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { this.draw(0); return; }
    const loop = (t: number) => { this.step(); this.draw(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  ngOnDestroy() { cancelAnimationFrame(this.raf); window.removeEventListener('resize', this.onResize); }

  private layout() {
    const c = this.cv().nativeElement;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = c.clientWidth; this.h = c.clientHeight;
    c.width = this.w * this.dpr; c.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const m = Math.min(this.w, this.h), mobile = this.w < 720;
    const spec = mobile
      ? [{ cx: 0.5, cy: -0.02, r: 0.4, n: 12, gw: [3, 9] }, { cx: 0.5, cy: 1.2, r: 0.42, n: 10, gw: [7] }]
      : [{ cx: 0.86, cy: 0.58, r: 0.44, n: 16, gw: [5, 12] }, { cx: 0.12, cy: 0.34, r: 0.3, n: 10, gw: [2, 7] }];
    this.rings = spec.map((s, k) => {
      const r = s.r * m, cx = s.cx * this.w, cy = s.cy * this.h, phase = k * 0.6;
      const pts = Array.from({ length: s.n }, (_, i) => {
        const a = phase + (i / s.n) * Math.PI * 2;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      });
      return { cx, cy, r, n: s.n, phase, pts, gw: s.gw };
    });
    this.packets = Array.from({ length: mobile ? 8 : 14 }, () => this.spawn());
  }

  private spawn(): Packet {
    const ring = Math.random() < 0.6 ? 0 : 1;
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    return { ring, i: Math.floor(Math.random() * this.rings[ring].n), dir, t: Math.random(),
             hops: 3 + Math.floor(Math.random() * 6), speed: 0.006 + Math.random() * 0.008,
             color: dir === 1 ? '#e40000' : '#ff8fa1' };
  }

  private step() {
    for (let k = 0; k < this.packets.length; k++) {
      const p = this.packets[k];
      p.t += p.speed;
      if (p.t >= 1) {
        p.t = 0; p.i = (p.i + p.dir + this.rings[p.ring].n) % this.rings[p.ring].n;
        if (--p.hops <= 0) this.packets[k] = { ...this.spawn(), t: 0 };
      }
    }
  }

  private draw(time: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    // faint dot grid
    ctx.fillStyle = 'rgba(228,0,0,0.07)';
    for (let x = 12; x < this.w; x += 28) for (let y = 12; y < this.h; y += 28) ctx.fillRect(x, y, 1.4, 1.4);

    for (const r of this.rings) {
      // ring links
      ctx.strokeStyle = 'rgba(255,143,161,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); r.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
      // Peyto routers off the gateways (B2B NNI)
      for (const g of r.gw) {
        const p = r.pts[g], a = r.phase + (g / r.n) * Math.PI * 2;
        const q = { x: p.x + Math.cos(a) * 46, y: p.y + Math.sin(a) * 46 };
        ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(228,0,0,0.45)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#e40000'; this.roundRect(q.x - 7, q.y - 7, 14, 14, 4); ctx.fill();
      }
      // nodes
      r.pts.forEach((p, i) => {
        const gw = r.gw.includes(i);
        const pulse = 0.5 + 0.5 * Math.sin(time / 700 + i * 1.7);
        if (i % 5 === 2) { ctx.fillStyle = `rgba(228,0,0,${0.08 + pulse * 0.1})`; ctx.beginPath(); ctx.arc(p.x, p.y, 10 + pulse * 6, 0, 7); ctx.fill(); }
        ctx.beginPath(); ctx.arc(p.x, p.y, gw ? 6.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = gw ? '#e40000' : '#ffffff'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#e40000'; ctx.stroke();
      });
    }
    // packets with a short trail
    for (const p of this.packets) {
      const r = this.rings[p.ring], a = r.pts[p.i], b = r.pts[(p.i + p.dir + r.n) % r.n];
      const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
      const tt = Math.max(0, p.t - 0.25), tx = a.x + (b.x - a.x) * tt, ty = a.y + (b.y - a.y) * tt;
      const grad = ctx.createLinearGradient(tx, ty, x, y);
      grad.addColorStop(0, 'rgba(228,0,0,0)'); grad.addColorStop(1, p.color);
      ctx.strokeStyle = grad; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.shadowColor = p.color; ctx.shadowBlur = 10; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
}
