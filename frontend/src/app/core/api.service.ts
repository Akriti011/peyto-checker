import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Status = 'protected' | 'unprotected' | 'not_feasible' | 'not_found' | 'manual_check';
export type CktSource = 'chitragupt' | 'ssh' | '';

export interface Overview { rings: number; nodes: number; peyto_routers: number; services: number; lsis: number; alarmed_links: number; rules: number; mode?: string; }
export interface PathInfo { role: 'primary' | 'secondary'; peyto: string; hops: string[]; }
export interface RuleCheck { id: string; title: string; ref: string; ok: boolean; detail: string; }
export interface TraceStep { step: string; status: string; note: string; ms: number; ckt_ids: string[]; }
export interface ResultRow {
  lsi: string; ckt_id: string; ckt_source: CktSource; service_type: string; ring: string; customer_mux: string;
  status: Status; label: string; reason: string; paths: PathInfo[]; checks: RuleCheck[]; design_ok: boolean | null;
  trace: TraceStep[];
}
export interface Summary {
  lsis: number; ckts: number; protected: number; unprotected: number; not_feasible: number; not_found: number;
  manual_check: number; design_issues: number; via_chitragupt: number; via_ssh: number; elapsed_ms: number;
}
export interface CheckResult { job_id: string; file: string; lsi_column: string; mode?: string; summary: Summary; rows: ResultRow[]; }
export interface JobState {
  job_id: string; file: string; lsi_column: string; status: 'queued' | 'running' | 'done' | 'error';
  total: number; done: number; current: string; rows: ResultRow[]; row_offset: number;
  summary: Summary | null; error: string; mode: string;
}
export interface Health {
  ok: boolean; version: string; mode: 'demo' | 'live'; nms_loaded: boolean; nms_error: string;
  chitragupt: { strategy: string; url_set: boolean; login_set: boolean };
  ssh: { tiers: Record<string, number>; jump_host: boolean; device_type: string };
  nms: { source: string; export_dir: string };
}
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
  /** demo / live, shown in the header */
  readonly health = signal<Health | null>(null);

  constructor() { this.loadHealth(); }

  async loadHealth() {
    try { this.health.set(await firstValueFrom(this.http.get<Health>('/api/health'))); } catch { this.health.set(null); }
  }

  overview() { return firstValueFrom(this.http.get<Overview>('/api/overview')); }
  rings() { return firstValueFrom(this.http.get<RingSummary[]>('/api/rings')); }
  rules() { return firstValueFrom(this.http.get<any>('/api/rules')); }

  ring(name: string) {
    if (!this.ringCache.has(name)) this.ringCache.set(name, firstValueFrom(this.http.get<RingDetail>(`/api/rings/${name}`)));
    return this.ringCache.get(name)!;
  }

  private form(file: File | null) {
    const fd = new FormData();
    if (file) fd.append('file', file); else fd.append('demo', 'true');
    return fd;
  }

  /** whole batch in one request (kept for scripts / fallback) */
  check(file: File | null) { return firstValueFrom(this.http.post<CheckResult>('/api/check', this.form(file))); }

  /** start a background batch; poll job() for live progress */
  startJob(file: File | null) { return firstValueFrom(this.http.post<{ job_id: string; total: number }>('/api/jobs', this.form(file))); }
  job(id: string, since = 0) { return firstValueFrom(this.http.get<JobState>(`/api/jobs/${id}?since=${since}`)); }

  uploadNmsExport(files: File[]) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return firstValueFrom(this.http.post<{ saved: string[]; nms_loaded: boolean; nms_error: string }>('/api/nms-export', fd));
  }
}

export const shortNode = (n: string) => (n.includes('_') ? n.split('_').pop()! : n);
export const statusIcon: Record<Status, string> = {
  protected: 'fa-shield-halved', unprotected: 'fa-triangle-exclamation',
  not_feasible: 'fa-circle-xmark', not_found: 'fa-magnifying-glass', manual_check: 'fa-user-gear',
};
export const sourceLabel: Record<string, string> = { chitragupt: 'Chitragupt', ssh: 'SSH · T3/T4', '': '—' };
