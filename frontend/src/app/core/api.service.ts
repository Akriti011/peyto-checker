import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Status = 'protected' | 'unprotected' | 'not_feasible' | 'not_found';

export interface Overview { rings: number; nodes: number; peyto_routers: number; services: number; lsis: number; alarmed_links: number; rules: number; }
export interface PathInfo { role: 'primary' | 'secondary'; peyto: string; hops: string[]; }
export interface RuleCheck { id: string; title: string; ref: string; ok: boolean; detail: string; }
export interface ResultRow {
  lsi: string; ckt_id: string; service_type: string; ring: string; customer_mux: string;
  status: Status; label: string; reason: string; paths: PathInfo[]; checks: RuleCheck[]; design_ok: boolean | null;
}
export interface Summary { lsis: number; ckts: number; protected: number; unprotected: number; not_feasible: number; not_found: number; design_issues: number; elapsed_ms: number; }
export interface CheckResult { job_id: string; file: string; lsi_column: string; summary: Summary; rows: ResultRow[]; }
export interface RingNode { node: string; role: string; order: number; peyto_router: string; }
export interface RingLink { a: string; b: string; type: string; status: string; alarm: string; }
export interface RingDetail { name: string; kind: 'ring' | 'linear'; nodes: RingNode[]; links: RingLink[]; }
export interface RingSummary { name: string; kind: string; nodes: number; peyto: string[]; alarms: number; }

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private ringCache = new Map<string, Promise<RingDetail>>();
  /** last check result, kept so it survives page switches */
  readonly last = signal<CheckResult | null>(null);

  overview() { return firstValueFrom(this.http.get<Overview>('/api/overview')); }
  rings() { return firstValueFrom(this.http.get<RingSummary[]>('/api/rings')); }
  rules() { return firstValueFrom(this.http.get<any>('/api/rules')); }

  ring(name: string) {
    if (!this.ringCache.has(name)) this.ringCache.set(name, firstValueFrom(this.http.get<RingDetail>(`/api/rings/${name}`)));
    return this.ringCache.get(name)!;
  }

  check(file: File | null) {
    const fd = new FormData();
    if (file) fd.append('file', file); else fd.append('demo', 'true');
    return firstValueFrom(this.http.post<CheckResult>('/api/check', fd));
  }
}

export const shortNode = (n: string) => (n.includes('_') ? n.split('_').pop()! : n);
export const statusIcon: Record<Status, string> = {
  protected: 'fa-shield-halved', unprotected: 'fa-triangle-exclamation',
  not_feasible: 'fa-circle-xmark', not_found: 'fa-magnifying-glass',
};
