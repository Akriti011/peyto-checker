import { Component, computed, input } from '@angular/core';
import { PathInfo, RingDetail, shortNode } from '../core/api.service';

interface P { x: number; y: number; a: number; }

/** SVG ring topology: NEs, B2B links to Peyto routers, alarms, and the traced primary/secondary paths. */
@Component({
  selector: 'app-ring-map',
  templateUrl: './ring-map.html',
  styleUrl: './ring-map.css',
})
export class RingMap {
  ring = input.required<RingDetail>();
  paths = input<PathInfo[]>([]);
  mux = input<string>('');
  compact = input(false);

  readonly short = shortNode;

  readonly view = computed(() => {
    const r = this.ring(), n = r.nodes.length, cx = 320, cy = 320;
    const pos = new Map<string, P>();
    const R = 205;
    if (r.kind === 'ring') {
      r.nodes.forEach((nd, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        pos.set(nd.node, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a });
      });
    } else {
      // linear ring: gentle arc
      r.nodes.forEach((nd, i) => {
        const a = Math.PI + (i / Math.max(1, n - 1)) * Math.PI;
        pos.set(nd.node, { x: cx + 230 * Math.cos(a), y: 400 + 150 * Math.sin(a), a: -Math.PI / 2 });
      });
    }
    // Peyto routers outside their gateway
    const peyto: { id: string; x: number; y: number; gw: string; lx: number; ly: number; anchor: string }[] = [];
    for (const nd of r.nodes) {
      if (!nd.peyto_router) continue;
      const g = pos.get(nd.node)!, d = r.kind === 'ring' ? 78 : 92;
      const x = g.x + Math.cos(g.a) * d, y = g.y + Math.sin(g.a) * d;
      pos.set(nd.peyto_router, { x, y, a: g.a });
      const lab = this.labelAt(x, y, g.a, 22);
      peyto.push({ id: nd.peyto_router, x, y, gw: nd.node, ...lab });
    }

    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const onPath = new Map<string, 'primary' | 'secondary'>();
    for (const p of this.paths()) for (let i = 0; i < p.hops.length - 1; i++) onPath.set(key(p.hops[i], p.hops[i + 1]), p.role);
    const pathNodes = new Set(this.paths().flatMap(p => p.hops));

    const links = r.links.map(l => {
      const A = pos.get(l.a)!, B = pos.get(l.b)!;
      return { ...l, x1: A.x, y1: A.y, x2: B.x, y2: B.y, mx: (A.x + B.x) / 2, my: (A.y + B.y) / 2,
               role: onPath.get(key(l.a, l.b)) ?? null, down: l.status !== 'OK' };
    });
    const nodes = r.nodes.map(nd => {
      const p = pos.get(nd.node)!;
      return { ...nd, x: p.x, y: p.y, ...this.labelAt(p.x, p.y, p.a, nd.role === 'NE' ? 17 : 21),
               gw: nd.role !== 'NE', isMux: nd.node === this.mux(), lit: pathNodes.has(nd.node) };
    });
    const alarms = links.filter(l => l.down);
    return { links, nodes, peyto, alarms };
  });

  private labelAt(x: number, y: number, a: number, off: number) {
    const c = Math.cos(a), s = Math.sin(a);
    return { lx: x + c * off, ly: y + s * off + 4, anchor: c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle' };
  }
}
