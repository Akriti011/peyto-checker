/**
 * Peyto Checker hero film: 16 s canvas animation.
 * Story: Airtel corridor -> logo dissolves into light -> fibre network ->
 * primary/secondary path + reroute -> LSI/CKT/NETWORK/PEYTO -> collapses into one fibre line.
 *
 * render(t) is fully deterministic (seeded random), so the same t always gives the same frame.
 * That lets us seek, skip, and record an MP4 frame by frame.
 */

export const FILM_LENGTH = 16;

type Pt = [number, number];
interface FilmData { W: number; H: number; logoBox: [number, number, number, number]; pts: Pt[]; lights: Pt[]; }

const VP: Pt = [605, 300];               // corridor vanishing point (image px)
const RED = '228,0,0';

// ---------- small math helpers ----------
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- network (virtual 1600 x 900 space) ----------
const N: Record<string, Pt> = {
  A: [250, 450],   // customer / LSI
  J: [500, 450],   // junction / CKT
  P1: [760, 290], P2: [1040, 290],
  S1: [760, 610], S2: [1040, 610],
  R1: [900, 760],  // alternate hop used by the reroute
  Z: [1300, 450],  // Peyto
  O: [1500, 450],
};
const PRIMARY = ['A', 'J', 'P1', 'P2', 'Z', 'O'];
const SECONDARY = ['J', 'S1', 'S2', 'Z'];
const REROUTE = ['S1', 'R1', 'S2'];

interface Particle { x: number; y: number; rel: number; speed: number; lane: number; size: number; }
interface BgNode { x: number; y: number; r: number; tw: number; links: number[]; }

export class HeroFilm {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private bgNodes: BgNode[] = [];
  private lights: { x: number; y: number; ph: number; sp: number }[] = [];
  private w = 0; private h = 0; private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, private data: FilmData,
              private plate: HTMLImageElement, private logo: HTMLImageElement) {
    this.ctx = canvas.getContext('2d')!;
    const r = rng(11);
    const [x0, , x1] = data.logoBox;
    this.particles = data.pts.map(([x, y]) => ({
      x, y,
      rel: 3 + ((x - x0) / (x1 - x0)) * 1.3 + r() * 0.5,   // dissolve sweeps left -> right
      speed: 0.6 + r() * 0.8,
      lane: (r() - 0.5) * 0.5,
      size: 0.6 + r() * 1.3,
    }));
    this.lights = data.lights.map(([x, y]) => ({ x, y, ph: r() * 6.28, sp: 1 + r() * 4 }));
    const rb = rng(29);
    for (let i = 0; i < 46; i++) {
      this.bgNodes.push({ x: -200 + rb() * 2000, y: -120 + rb() * 1140, r: 1.5 + rb() * 2.5, tw: rb() * 6.28, links: [] });
    }
    this.bgNodes.forEach((n, i) => {
      const near = this.bgNodes.map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.y - n.y) }))
        .filter(o => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2);
      n.links = near.filter(o => o.d < 420).map(o => o.j);
    });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width * this.dpr));
    this.h = Math.max(1, Math.round(rect.height * this.dpr));
    this.canvas.width = this.w; this.canvas.height = this.h;
  }

  /** t = film time in seconds. Values past 16 keep the final composition alive (idle loop). */
  render(time: number) {
    const ctx = this.ctx, W = this.w, H = this.h;
    const t = Math.min(time, FILM_LENGTH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1; ctx.filter = 'none';
    ctx.fillStyle = '#050102'; ctx.fillRect(0, 0, W, H);

    // ---- camera on the corridor image: slow dolly into the vanishing point ----
    const cover = Math.max(W / this.data.W, H / this.data.H);
    const dolly = 1 + ease(seg(t, 0, 9)) * 0.85;
    const finalZoom = lerp(dolly, 1.12, ease(seg(t, 13.6, 15.6)));
    const zoom = t > 13.6 ? finalZoom : dolly;
    const s = cover * zoom;
    const ox = (W - this.data.W * cover) / 2 + VP[0] * cover;   // VP screen pos at t = 0
    const oy = (H - this.data.H * cover) / 2 + VP[1] * cover;
    const toScreen = (x: number, y: number): Pt => [ox + (x - VP[0]) * s, oy + (y - VP[1]) * s];

    // plate visibility: full -> fades as the network takes over -> returns faintly for the final frame
    const plateA = (1 - ease(seg(t, 5.8, 8.8))) + 0.3 * ease(seg(t, 14, 16));
    const blur = lerp(0, 10, seg(t, 5, 8.5)) * (t < 14 ? 1 : lerp(1, 0.7, seg(t, 14, 16)));
    if (plateA > 0.003) {
      ctx.save();
      ctx.globalAlpha = clamp(plateA);
      if (blur > 0.3) ctx.filter = `blur(${(blur * this.dpr).toFixed(1)}px)`;
      const [px, py] = toScreen(0, 0);
      ctx.drawImage(this.plate, px, py, this.data.W * s, this.data.H * s);
      ctx.restore();

      // server indicators flicker naturally
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const l of this.lights) {
        const f = 0.5 + 0.5 * Math.sin(time * l.sp + l.ph);
        if (f < 0.55) continue;
        const [lx, ly] = toScreen(l.x, l.y);
        ctx.globalAlpha = clamp(plateA) * (f - 0.55) * 0.9;
        ctx.fillStyle = 'rgb(190,215,255)';
        ctx.beginPath(); ctx.arc(lx, ly, 1.3 * this.dpr * zoom, 0, 6.283); ctx.fill();
      }
      ctx.restore();

      // gentle red pulse from the ceiling
      const pulse = 0.06 + 0.05 * Math.sin(time * 1.4);
      const [cx, cy] = toScreen(VP[0], 60);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.6);
      g.addColorStop(0, `rgba(${RED},${pulse * clamp(plateA)})`); g.addColorStop(1, `rgba(${RED},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // ---- Airtel logo (crisp layer), dissolves 3 -> 4.6 s ----
    const logoA = 1 - seg(t, 4.7, 5.0);
    if (logoA > 0) {
      const [x0, y0, x1, y1] = this.data.logoBox;
      const [lx, ly] = toScreen(x0, y0);
      ctx.save();
      ctx.globalAlpha = logoA;
      // reveal mask: left part disappears first, in sync with the particle sweep
      const cut = lerp(x0 - 40, x1 + 40, seg(t, 3, 4.8));
      const [cxs] = toScreen(cut, 0);
      ctx.beginPath(); ctx.rect(cxs, 0, W, H); ctx.clip();
      ctx.drawImage(this.logo, lx, ly, (x1 - x0) * s, (y1 - y0) * s);
      ctx.restore();
    }

    // ---- logo particles -> streams of light into the corridor ----
    if (t > 2.9 && t < 9.5) this.drawParticles(t, toScreen, s);

    // ---- ceiling lines become fibre: light rails from the vanishing point ----
    const railA = ease(seg(t, 4.8, 6.6)) * (1 - ease(seg(t, 8.8, 10.2)));
    if (railA > 0.01) this.drawRails(time, railA, toScreen(VP[0], VP[1]));

    // ---- abstract fibre network ----
    const netA = ease(seg(t, 7.2, 9));
    if (netA > 0.01) this.drawNetwork(t, time, netA);

    // ---- final fibre line + vignette ----
    if (t > 14) this.drawFinalLine(t, time);
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    // final frame: darken behind the hero text for readability
    const shade = ease(seg(t, 14.4, 16));
    if (shade > 0) {
      const sg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.5);
      sg.addColorStop(0, `rgba(5,0,2,${0.6 * shade})`); sg.addColorStop(1, 'rgba(5,0,2,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    }
  }

  // ------------------------------------------------------------------
  private drawParticles(t: number, toScreen: (x: number, y: number) => Pt, s: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const fadeAll = 1 - seg(t, 7.6, 9.4);
    for (const p of this.particles) {
      if (t < p.rel) continue;
      const age = t - p.rel;
      // travel toward the vanishing point along a lane, accelerating; streaks get longer
      const k = 1 - Math.exp(-age * p.speed * 0.7);
      const k2 = 1 - Math.exp(-Math.max(0, age - 0.22) * p.speed * 0.7);
      const tx = VP[0] + p.lane * 900, ty = VP[1] + (p.y - 330) * 0.35 + p.lane * 120;
      const pos = (kk: number): Pt => toScreen(lerp(p.x, tx, kk), lerp(p.y, ty, kk) - Math.sin(kk * Math.PI) * 25 * p.lane);
      const [x, y] = pos(k); const [x2, y2] = pos(k2);
      const a = clamp(age * 3) * (1 - k * 0.45) * fadeAll;
      if (a <= 0.01) continue;
      const white = clamp(1 - age * 0.7);
      ctx.strokeStyle = `rgba(255,${Math.round(lerp(40, 245, white))},${Math.round(lerp(40, 245, white))},${a})`;
      ctx.lineWidth = p.size * this.dpr * (0.6 + 0.5 * (1 - k));
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x + 0.01, y); ctx.stroke();
    }
    ctx.restore();
  }

  private drawRails(time: number, a: number, vp: Pt) {
    const ctx = this.ctx, W = this.w, H = this.h;
    const R = Math.hypot(W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = rng(5);
    for (let i = 0; i < 44; i++) {
      // fan of rails mostly along ceiling and floor, like the light panels
      const top = i % 2 === 0;
      const ang = (top ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 2.5;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const bright = 0.25 + r() * 0.5;
      const lg = ctx.createLinearGradient(vp[0], vp[1], vp[0] + dx * R, vp[1] + dy * R);
      lg.addColorStop(0, `rgba(${RED},0)`); lg.addColorStop(0.12, `rgba(${RED},${0.7 * bright * a})`); lg.addColorStop(1, `rgba(${RED},${0.2 * a})`);
      ctx.strokeStyle = lg; ctx.lineWidth = (0.8 + r() * 1.4) * this.dpr;
      ctx.beginPath(); ctx.moveTo(vp[0], vp[1]); ctx.lineTo(vp[0] + dx * R, vp[1] + dy * R); ctx.stroke();
      // light pulse travelling outward (toward camera), accelerating with perspective
      const ph = (time * (0.35 + r() * 0.3) + r()) % 1;
      const d = Math.pow(ph, 2.2) * R * 0.9;
      const px = vp[0] + dx * d, py = vp[1] + dy * d;
      const pg = ctx.createRadialGradient(px, py, 0, px, py, (4 + 14 * ph) * this.dpr);
      pg.addColorStop(0, `rgba(255,235,235,${0.9 * a * bright})`); pg.addColorStop(1, `rgba(${RED},0)`);
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, (4 + 14 * ph) * this.dpr, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  /** maps the virtual 1600x900 network space to the screen with a camera scale */
  private netMap(t: number) {
    const W = this.w, H = this.h;
    const fit = Math.min(W / 1600, H / 900) * 1.12;
    // arrive close (8 s), settle (11 s), pull back slightly (12-14 s)
    const cam = t < 11 ? lerp(1.55, 1.0, ease(seg(t, 7.2, 11))) : lerp(1.0, 0.84, ease(seg(t, 11.8, 14)));
    const k = fit * cam;
    return (p: Pt): Pt => [W / 2 + (p[0] - 800) * k, H / 2 + (p[1] - 450) * k];
  }

  private drawNetwork(t: number, time: number, a: number) {
    const ctx = this.ctx, d = this.dpr;
    const map0 = this.netMap(t);
    // collapse (14 -> 15.2 s): everything slides onto one horizontal fibre line
    const col = ease(seg(t, 14, 15.2));
    const lineY = 900 * 0.76;
    const flat = (p: Pt): Pt => [lerp(p[0], 800 + (p[0] - 800) * 1.4, col), lerp(p[1], lineY, col)];
    const P = (name: string) => map0(flat(N[name]));
    const alpha = a * (1 - seg(t, 15.0, 15.8));
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // background mesh (more visible on pull back)
    const bgA = alpha * (0.25 + 0.5 * ease(seg(t, 11.8, 13.5))) * (1 - col);
    if (bgA > 0.01) {
      for (const n of this.bgNodes) {
        const [x, y] = map0([n.x, n.y]);
        for (const j of n.links) {
          const [x2, y2] = map0([this.bgNodes[j].x, this.bgNodes[j].y]);
          ctx.strokeStyle = `rgba(${RED},${0.22 * bgA})`; ctx.lineWidth = 1 * d;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
        }
        const tw = 0.5 + 0.5 * Math.sin(time * 1.3 + n.tw);
        ctx.fillStyle = `rgba(255,120,130,${(0.25 + 0.35 * tw) * bgA})`;
        ctx.beginPath(); ctx.arc(x, y, n.r * d, 0, 6.283); ctx.fill();
      }
    }

    // ---- states ----
    const split = ease(seg(t, 8.8, 10));           // paths separate at the junction
    const fault = seg(t, 10.3, 10.7);               // warning on S1-S2
    const dimmed = ease(seg(t, 10.7, 11.3));        // that fibre dims
    const reroute = ease(seg(t, 11.0, 11.9));       // light finds S1-R1-S2
    const verdict = ease(seg(t, 13.0, 13.7));       // evaluation

    const path = (names: string[]) => names.map(P);
    const prim = path(PRIMARY), sec = path(SECONDARY), rr = path(REROUTE);

    // secondary branches open from the junction: interpolate from primary line
    const grow = (pts: Pt[], k: number): Pt[] => pts.map((p, i) => i === 0 ? p : [lerp(pts[0][0], p[0], k), lerp(pts[0][1], p[1], k)]);
    const secG = grow(sec, split);
    const primG: Pt[] = prim.map((p, i) => i < 2 || i > 4 ? p : [p[0], lerp(P('J')[1] + (p[1] - P('J')[1]) * 0, p[1], split)]);

    // fibres
    const fibre = (pts: Pt[], color: string, w: number, glow: number) => {
      ctx.shadowColor = color; ctx.shadowBlur = glow * d;
      ctx.strokeStyle = color; ctx.lineWidth = w * d;
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
      ctx.shadowBlur = 0;
    };
    const primBright = lerp(0.75, 1, verdict);
    fibre(primG, `rgba(255,236,238,${0.55 * alpha * primBright})`, 2.2, 14);
    // secondary: J-S1, S2-Z normal; S1-S2 is the faulted span
    fibre([secG[0], secG[1]], `rgba(${RED},${0.85 * alpha})`, 2, 12);
    fibre([secG[2], secG[3]], `rgba(${RED},${0.85 * alpha})`, 2, 12);
    const flick = fault > 0 && dimmed < 1 ? 0.5 + 0.5 * Math.sin(time * 22) : 1;
    const spanA = alpha * lerp(0.85, 0.12, dimmed) * (fault > 0 ? flick : 1);
    fibre([secG[1], secG[2]], fault > 0 ? `rgba(255,140,40,${spanA})` : `rgba(${RED},${spanA})`, 2, fault > 0 ? 18 : 12);
    // reroute
    if (reroute > 0) {
      const pts = rr; const cut = partial(pts, reroute);
      fibre(cut, `rgba(255,90,90,${0.9 * alpha})`, 2, 16);
    }

    // light pulses travelling on the fibres
    const pulses = (pts: Pt[], n: number, speed: number, col: string, off: number, aa: number) => {
      if (aa <= 0.01) return;
      const L = polyLen(pts);
      for (let i = 0; i < n; i++) {
        const ph = ((time * speed) / (L / d / 300) + i / n + off) % 1;
        const [x, y] = along(pts, ph);
        const g = ctx.createRadialGradient(x, y, 0, x, y, 9 * d);
        g.addColorStop(0, col.replace('A', String(aa))); g.addColorStop(1, 'rgba(228,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9 * d, 0, 6.283); ctx.fill();
      }
    };
    pulses(primG, 5, 0.28, 'rgba(255,255,255,A)', 0, alpha);
    const secLive = dimmed < 0.5 ? secG : [secG[0], rr[0], ...partial(rr, reroute).slice(1), ...(reroute > 0.99 ? [secG[2], secG[3]] : [])];
    pulses(secLive, 3, 0.24, 'rgba(255,170,170,A)', 0.4, alpha * (dimmed > 0.3 && reroute < 0.2 ? 0.2 : 0.9));

    // warning pulse ring on the fault
    if (fault > 0 && t < 13.8) {
      const [mx, my] = mid(secG[1], secG[2]);
      const ph = (time * 1.4) % 1;
      ctx.strokeStyle = `rgba(255,140,40,${(1 - ph) * 0.9 * alpha})`; ctx.lineWidth = 2 * d;
      ctx.beginPath(); ctx.arc(mx, my, (6 + ph * 26) * d, 0, 6.283); ctx.stroke();
      if (verdict > 0) {                     // the failed span gets a small cross
        ctx.strokeStyle = `rgba(255,150,60,${verdict * alpha})`; ctx.lineWidth = 2 * d;
        const c = 7 * d;
        ctx.beginPath(); ctx.moveTo(mx - c, my - c); ctx.lineTo(mx + c, my + c); ctx.moveTo(mx + c, my - c); ctx.lineTo(mx - c, my + c); ctx.stroke();
      }
    }

    // nodes
    const node = (p: Pt, r: number, core: string, glow: string) => {
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 4 * d);
      g.addColorStop(0, glow); g.addColorStop(1, 'rgba(228,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], r * 4 * d, 0, 6.283); ctx.fill();
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(p[0], p[1], r * d, 0, 6.283); ctx.fill();
    };
    const all: Pt[] = [P('A'), P('J'), primG[2], primG[3], P('Z'), secG[1], secG[2]];
    all.forEach(p => node(p, 4, `rgba(255,245,245,${alpha})`, `rgba(${RED},${0.55 * alpha})`));
    if (reroute > 0) node(P('R1'), 3.5, `rgba(255,220,220,${alpha * reroute})`, `rgba(${RED},${0.5 * alpha * reroute})`);
    // the intelligent processing point: Peyto
    const zp = P('Z'); const zb = 0.5 + 0.5 * Math.sin(time * 2);
    node(zp, 6 + 2 * zb * ease(seg(t, 12, 13)), `rgba(255,255,255,${alpha})`, `rgba(255,60,60,${0.7 * alpha})`);
    ctx.restore();

    // ---- tiny labels ----
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const label = (txt: string, p: Pt, dx: number, dy: number, la: number, color = '255,225,228', align: CanvasTextAlign = 'center') => {
      if (la <= 0.01) return;
      ctx.font = `600 ${Math.round(13 * d)}px "Times New Roman", Times, serif`;
      (ctx as any).letterSpacing = `${(3 * d).toFixed(1)}px`;
      ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${color},${la})`;
      ctx.fillText(txt, p[0] + dx * d, p[1] + dy * d);
    };
    const lblA = alpha * (1 - col);
    const pl = ease(seg(t, 9.6, 10.4)) * lblA;
    label('PRIMARY PATH', mid(primG[2], primG[3]), 0, -22, pl);
    label('SECONDARY PATH', mid(secG[1], secG[2]), 0, 24, pl * (1 - 0.5 * dimmed));
    label('REROUTED', P('R1'), 0, 22, ease(seg(t, 11.6, 12.2)) * lblA, '255,160,160');
    const st = (k0: number) => ease(seg(t, k0, k0 + 0.5)) * lblA;
    label('LSI', P('A'), 0, -24, st(12.2));
    label('CKT', P('J'), 0, -24, st(12.5));
    label('NETWORK', mid(primG[2], secG[1]), -28, 0, st(12.8), '255,225,228', 'right');
    label('PEYTO', zp, 0, -28, st(13.1));
    label('PROTECTED', zp, 0, 30, ease(seg(t, 13.3, 13.8)) * lblA, '255,255,255');
    ctx.restore();
  }

  private drawFinalLine(t: number, time: number) {
    const ctx = this.ctx, W = this.w, H = this.h, d = this.dpr;
    const a = ease(seg(t, 14.6, 15.6));
    if (a <= 0) return;
    const y0 = this.netMap(t)([800, 900 * 0.76])[1];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // gently waving fibre strands
    for (let s = 0; s < 3; s++) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8 * d) {
        const u = x / W;
        const y = y0 + Math.sin(u * 6 + time * (0.6 + s * 0.25) + s) * (4 + s * 5) * d * Math.sin(u * Math.PI);
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = s === 0 ? `rgba(255,235,238,${0.75 * a})` : `rgba(${RED},${0.45 * a})`;
      ctx.lineWidth = (s === 0 ? 1.6 : 1) * d;
      ctx.shadowColor = `rgba(${RED},1)`; ctx.shadowBlur = 14 * d;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // pulses flowing left -> right
    for (let i = 0; i < 4; i++) {
      const u = ((time * 0.12 + i / 4) % 1);
      const x = u * W, y = y0 + Math.sin(u * 6 + time * 0.6) * 4 * d * Math.sin(u * Math.PI);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 26 * d);
      g.addColorStop(0, `rgba(255,255,255,${0.8 * a})`); g.addColorStop(0.3, `rgba(255,80,80,${0.35 * a})`); g.addColorStop(1, 'rgba(228,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 26 * d, 0, 6.283); ctx.fill();
    }
    // floor glow under the line
    const fg = ctx.createLinearGradient(0, y0, 0, H);
    fg.addColorStop(0, `rgba(${RED},${0.16 * a})`); fg.addColorStop(1, `rgba(${RED},0)`);
    ctx.fillStyle = fg; ctx.fillRect(0, y0, W, H - y0);
    ctx.restore();
  }
}

// ---------- polyline helpers ----------
function polyLen(pts: Pt[]) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L || 1; }
function along(pts: Pt[], k: number): Pt {
  const L = polyLen(pts) * k; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + l >= L) { const u = l ? (L - acc) / l : 0; return [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]; }
    acc += l;
  }
  return pts[pts.length - 1];
}
function partial(pts: Pt[], k: number): Pt[] {
  if (k >= 1) return pts;
  const L = polyLen(pts) * k; const out: Pt[] = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + l >= L) { const u = l ? (L - acc) / l : 0; out.push([lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]); return out; }
    out.push(pts[i]); acc += l;
  }
  return out;
}
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
