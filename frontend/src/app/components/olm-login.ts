import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';

/**
 * OLM ID + password + OTP login. One login is used for every system the bot
 * touches (Chitragupt, T3/T4 nodes, later CFM and NMS). Nothing is stored in
 * the browser; the server keeps it in memory only until logout / timeout.
 */
@Component({
  selector: 'app-olm-login',
  imports: [FormsModule],
  template: `
  @if (needed()) {
  <section class="card olm anim" style="--d: 0.22s" [class.done]="loggedIn()">
    @if (loggedIn()) {
      <div class="ok-row">
        <span class="who"><i class="fa-solid fa-user-shield"></i> Logged in as <b>{{ s()?.olm_id }}</b></span>
        <span class="sys">
          @for (x of systems(); track x.name) {
            <span class="pill" [class]="x.tone" [title]="x.title"><i class="fa-solid {{ x.icon }}"></i> {{ x.name }}</span>
          }
        </span>
        <span class="exp"><i class="fa-regular fa-clock"></i> auto logout in {{ minutesLeft() }} min</span>
        <button class="btn btn-ghost sm" (click)="logout()"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>
      </div>
    } @else {
      <div class="head">
        <span class="step">1</span>
        <div>
          <h3>Login with your OLM ID</h3>
          <p>Same OLM login you use for Chitragupt, CFM, PuTTY and LightSoft. The bot uses it only for this session. Nothing is saved.</p>
        </div>
      </div>

      @if (s()?.state !== 'otp_required') {
        <form class="row" (ngSubmit)="login()">
          <label><span>OLM ID</span>
            <input name="olm" autocomplete="username" [(ngModel)]="olm" placeholder="e.g. B0123456" [disabled]="busy()" /></label>
          <label><span>Password</span>
            <input name="pw" type="password" autocomplete="current-password" [(ngModel)]="pw" placeholder="OLM password" [disabled]="busy()" /></label>
          <button class="btn btn-red" type="submit" [disabled]="busy() || !olm.trim() || !pw">
            @if (busy()) { <i class="fa-solid fa-circle-notch fa-spin"></i> } @else { <i class="fa-solid fa-arrow-right-to-bracket"></i> } Login
          </button>
        </form>
      } @else {
        <form class="row" (ngSubmit)="verify()">
          <label class="otp"><span>OTP sent to your registered mobile ({{ s()?.olm_id }})</span>
            <input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8" [(ngModel)]="otp"
                   placeholder="Enter OTP" [disabled]="busy()" /></label>
          <button class="btn btn-red" type="submit" [disabled]="busy() || otp.trim().length < 4">
            @if (busy()) { <i class="fa-solid fa-circle-notch fa-spin"></i> } @else { <i class="fa-solid fa-key"></i> } Verify
          </button>
          <button class="btn btn-ghost" type="button" (click)="restart()" [disabled]="busy()">Change ID</button>
        </form>
      }
      @if (hint()) { <div class="hint"><i class="fa-solid fa-flask"></i> Demo login: {{ hint() }}</div> }
      @if (error()) { <div class="err"><i class="fa-solid fa-circle-exclamation"></i> {{ error() }}</div> }
    }
  </section>
  }`,
  styles: [`
    .olm{max-width:1180px;margin:0 auto 18px;padding:18px 22px}
    .head{display:flex;gap:14px;align-items:flex-start;margin-bottom:12px}
    .step{flex:none;width:30px;height:30px;border-radius:50%;background:var(--red);color:var(--white);display:grid;place-items:center;font-weight:700}
    h3{margin:0 0 2px;font-size:17px;color:var(--ink)}
    .head p{margin:0;color:var(--muted);font-size:13.5px}
    .row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}
    label{display:flex;flex-direction:column;gap:5px;flex:1;min-width:200px}
    label span{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.02em}
    label.otp{max-width:360px}
    input{padding:11px 14px;border-radius:12px;border:1.5px solid var(--pink-mid);background:var(--blush);font:inherit;color:var(--ink);outline:none}
    input:focus{border-color:var(--red);background:var(--white)}
    .otp input{letter-spacing:.4em;font-weight:700;font-size:18px}
    .hint{margin-top:10px;font-size:12.5px;color:var(--muted);background:var(--blush);border:1px dashed var(--pink-mid);border-radius:10px;padding:6px 10px;display:inline-block}
    .err{margin-top:10px;color:var(--red);font-size:13.5px;font-weight:600}
    .ok-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    .who{color:var(--ink)} .who i{color:var(--red);margin-right:4px}
    .sys{display:flex;gap:6px;flex-wrap:wrap;flex:1}
    .pill{font-size:12px;padding:3px 10px;border-radius:99px;background:var(--blush);color:var(--muted);border:1px solid var(--pink)}
    .pill.ok{background:var(--red);color:var(--white);border-color:var(--red)}
    .pill.wait{background:var(--white);color:var(--red);border-color:var(--pink-mid)}
    .pill.bad{background:#ffe08a;color:#5c3b00;border-color:#f0c64a}
    .exp{font-size:12.5px;color:var(--muted)}
    .btn.sm{padding:7px 14px;font-size:13px}
    .olm.done{padding:12px 18px}
  `],
})
export class OlmLogin implements OnDestroy {
  private api = inject(Api);
  readonly s = this.api.session;
  readonly needed = computed(() => (this.api.health()?.auth ?? this.s()?.auth) === 'olm');
  readonly loggedIn = computed(() => !!this.s()?.logged_in);
  readonly hint = computed(() => this.api.health()?.demo_login_hint || '');
  readonly busy = signal(false);
  readonly error = signal('');
  olm = ''; pw = ''; otp = '';
  private timer = setInterval(() => this.refresh(), 15000);

  readonly minutesLeft = computed(() => Math.max(0, Math.round((this.s()?.expires_in_s ?? 0) / 60)));
  readonly systems = computed(() => {
    const y = this.s()?.systems; if (!y) return [];
    const ssh = y.ssh === 'ok' ? 'ok' : y.ssh === 'checking' ? 'wait' : y.ssh.startsWith('failed') ? 'bad' : '';
    return [
      { name: 'Chitragupt', tone: y.chitragupt === 'ok' ? 'ok' : 'bad', icon: 'fa-magnifying-glass', title: y.chitragupt },
      { name: 'T3/T4 SSH', tone: ssh, icon: ssh === 'wait' ? 'fa-circle-notch fa-spin' : 'fa-terminal', title: y.ssh },
      { name: 'CFM', tone: '', icon: 'fa-hourglass-half', title: y.cfm },
      { name: 'NMS', tone: '', icon: 'fa-file-csv', title: 'NMS: ' + y.nms },
    ];
  });

  ngOnDestroy() { clearInterval(this.timer); }

  private async refresh() {
    const before = this.s()?.logged_in;
    const now = await this.api.loadSession();
    if (before && !now?.logged_in) this.error.set('Your session ended (logout or timeout). Please login again.');
    if (now?.systems?.ssh === 'checking') setTimeout(() => this.refresh(), 1500);
  }

  private msg(e: any) { return e?.error?.detail || 'Login service not reachable. Is the backend running?'; }

  async login() {
    this.busy.set(true); this.error.set('');
    try {
      const r = await this.api.login(this.olm.trim(), this.pw);
      this.pw = '';                                   // never keep it in the page
      if (r.logged_in) this.refresh();
    } catch (e) { this.error.set(this.msg(e)); this.pw = ''; }
    finally { this.busy.set(false); }
  }

  async verify() {
    this.busy.set(true); this.error.set('');
    try { await this.api.verifyOtp(this.otp.trim()); this.otp = ''; this.refresh(); }
    catch (e) { this.error.set(this.msg(e)); this.otp = ''; }
    finally { this.busy.set(false); }
  }

  async restart() { this.otp = ''; this.error.set(''); await this.api.logout(); }
  async logout() { this.error.set(''); await this.api.logout(); }
}
