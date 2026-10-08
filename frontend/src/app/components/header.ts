import { Component, HostListener, effect, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  /** hidden on the landing page, where the hero already shows the Airtel logo */
  readonly showLogo = input(true);
  readonly links = [
    { label: 'Home', path: '/', exact: true },
    { label: 'Check', path: '/console', exact: false },
    { label: 'Rings', path: '/rings', exact: false },
    { label: 'Rules', path: '/rules', exact: false },
  ];
  readonly open = signal(false);

  constructor() {
    effect(() => document.body.classList.toggle('menu-open', this.open()));
  }
  toggle() { this.open.update(v => !v); }
  close() { this.open.set(false); }

  @HostListener('document:keydown.escape') onEsc() { this.close(); }
  @HostListener('window:resize') onResize() { if (window.innerWidth > 720) this.close(); }
}
