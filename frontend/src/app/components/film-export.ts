/**
 * Exports the hero film as a true 4K (3840 x 2160, 30 fps) H.264 MP4, right in the browser.
 * Uses the laptop's GPU for rendering and WebCodecs for encoding, so it takes about
 * a minute instead of hours. Open  http://localhost:4200/?export  and press the button.
 *
 * Every frame = WebGL film + labels + the final hero text, drawn at 4K.
 *
 * Web versions for the landing page (film + labels only; the page adds the hero itself):
 *   ?export&w=1920&h=1080&dpr=1&hero=0&mbps=10   -> hero-1080p.mp4  (desktop)
 *   ?export&w=540&h=960&dpr=2&hero=0&mbps=8      -> hero-portrait.mp4 (phones)
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { FILM_LENGTH, Film3D } from './film3d';

const arg = new URLSearchParams(location.search);
const CSS_W = Number(arg.get('w')) || 1920, CSS_H = Number(arg.get('h')) || 1080, DPR = Number(arg.get('dpr')) || 2;
const W = CSS_W * DPR, H = CSS_H * DPR, FPS = 30;
const HERO = arg.get('hero') !== '0';            // bake the final hero text into the video
const BITRATE = (Number(arg.get('mbps')) || 45) * 1e6;
const TAIL = 1.5;                       // hold the final frame a little
const clamp = (x: number) => Math.max(0, Math.min(1, x));

interface Piece { el: HTMLElement; at: number; }

export async function exportFilm(film: Film3D, page: HTMLElement, onProgress: (p: number, msg: string) => void) {
  if (!('VideoEncoder' in window)) throw new Error('Is browser mein WebCodecs nahi hai. Chrome ya Edge use karo.');

  // lay the page out at exactly 1920 x 1080 css px (x2 = 4K) while exporting
  document.body.classList.add('film-exporting');
  const host = page;
  const scale = Math.min(window.innerWidth / CSS_W, window.innerHeight / CSS_H);
  host.style.setProperty('--export-scale', String(scale));
  await new Promise(r => setTimeout(r, 120));
  film.resize(CSS_W, CSS_H, DPR);

  // measure the final hero layout once (at t = 16 everything is fully revealed)
  (window as any).__film.seek(FILM_LENGTH + 0.5);
  await new Promise(r => setTimeout(r, 200));
  const rectOf = (el: HTMLElement) => {
    const r = el.getBoundingClientRect(), o = host.getBoundingClientRect();
    return { x: (r.left - o.left) / scale, y: (r.top - o.top) / scale, w: r.width / scale, h: r.height / scale };
  };
  const q = (s: string) => page.querySelector(s) as HTMLElement;
  const pieces: Piece[] = !HERO ? [] : [
    { el: q('.brand'), at: 14.6 }, { el: q('.title'), at: 14.85 },
    { el: q('.tag'), at: 15.15 }, { el: q('.cta'), at: 15.4 },
  ];
  const rects = pieces.map(p => rectOf(p.el));
  const logoImg = q('.brand') as HTMLImageElement;

  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;

  // pick a codec the machine can do at 4K
  const candidates = ['avc1.640034', 'avc1.640033', 'avc1.4d0034', 'avc1.640028'];
  let codec = '';
  for (const c of candidates) {
    const sup = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: BITRATE, framerate: FPS });
    if (sup.supported) { codec = c; break; }
  }
  if (!codec) throw new Error(`Is laptop pe ${W}x${H} H.264 encoder nahi mila.`);

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  let encErr: any = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => (encErr = e) });
  enc.configure({ codec, width: W, height: H, bitrate: BITRATE, framerate: FPS, bitrateMode: 'variable', latencyMode: 'quality' });

  const limit = Number(new URLSearchParams(location.search).get('frames')) || Infinity;   // quick test: ?export&frames=10
  const total = Math.min(limit, Math.round((FILM_LENGTH + TAIL) * FPS));
  for (let i = 0; i < total; i++) {
    if (encErr) throw encErr;
    const t = i / FPS;
    (window as any).__film.seek(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.drawImage(film.glCanvas, 0, 0, W, H);
    ctx.scale(DPR, DPR);                              // draw overlays in css px
    drawLabels(ctx, film);
    pieces.forEach((p, k) => drawPiece(ctx, p, rects[k], t, logoImg));
    const frame = new VideoFrame(out, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
    if (i % 5 === 0) { onProgress(i / total, `Frame ${i + 1} / ${total}`); await new Promise(r => setTimeout(r, 0)); }
  }
  onProgress(1, 'MP4 bana rahe hain…');
  await enc.flush();
  muxer.finalize();
  const blob = new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = HERO ? 'PeytoChecker_Hero_4K.mp4' : `hero-${CSS_W}x${CSS_H}.mp4`;
  document.body.appendChild(a); a.click(); a.remove();

  document.body.classList.remove('film-exporting');
  window.dispatchEvent(new Event('resize'));
  return blob.size;
}

function drawLabels(ctx: CanvasRenderingContext2D, film: Film3D) {
  const fs = Math.max(11, Math.min(22, CSS_W * 0.0078));
  ctx.font = `600 ${fs}px Poppins, Arial, sans-serif`;
  (ctx as any).letterSpacing = `${fs * 0.28}px`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of film.labelState) {
    const warm = l.cls.includes('warm'), ok = l.cls.includes('ok');
    const tw = ctx.measureText(l.text).width + fs * 1.8, th = fs * 2;
    ctx.globalAlpha = l.a;
    ctx.fillStyle = ok ? 'rgba(228,0,0,0.35)' : 'rgba(20,2,6,0.38)';
    ctx.strokeStyle = ok ? 'rgba(255,255,255,0.4)' : warm ? 'rgba(255,150,60,0.35)' : 'rgba(255,140,150,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(l.x - tw / 2, l.y - th / 2, tw, th, th / 2); ctx.fill(); ctx.stroke();
    ctx.shadowColor = warm ? 'rgba(255,120,30,0.8)' : 'rgba(255,30,30,0.75)'; ctx.shadowBlur = 14;
    ctx.fillStyle = ok ? '#fff' : warm ? '#ffc9a0' : 'rgba(255,232,235,0.95)';
    ctx.fillText(l.text, l.x + fs * 0.14, l.y + 1);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1; (ctx as any).letterSpacing = '0px';
}

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, r: { x: number; y: number; w: number; h: number }, t: number, logo: HTMLImageElement) {
  const k = clamp((t - p.at) / 0.8);
  if (k <= 0) return;
  const cs = getComputedStyle(p.el);
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(0, (1 - k) * 14);
  if (k < 1) ctx.filter = `blur(${((1 - k) * 6 * 2).toFixed(2)}px)`;
  if (p.el.classList.contains('brand')) {
    ctx.shadowColor = 'rgba(255,255,255,0.25)'; ctx.shadowBlur = 18;
    ctx.drawImage(logo, r.x, r.y, r.w, r.h);
  } else if (p.el.classList.contains('title')) {
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    (ctx as any).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(228,0,0,0.55)'; ctx.shadowBlur = 28;
    ctx.fillText(p.el.textContent!.trim(), r.x + r.w / 2, r.y + r.h / 2);
  } else if (p.el.classList.contains('tag')) {
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = cs.color;
    const lines = (p.el as HTMLElement).innerText.split('\n').filter(Boolean);
    const lh = r.h / lines.length;
    lines.forEach((ln, i) => ctx.fillText(ln.trim(), r.x + r.w / 2, r.y + lh * (i + 0.5)));
  } else {   // CTA pill
    ctx.shadowColor = 'rgba(228,0,0,0.55)'; ctx.shadowBlur = 26;
    ctx.fillStyle = '#e40000';
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.fillText((p.el.textContent || '').trim() + '  →', r.x + r.w / 2, r.y + r.h / 2 + 1);
  }
  ctx.restore();
}
