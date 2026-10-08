import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { CountUp } from '../core/count-up.directive';
import { Header } from '../components/header';
import { HeroFilm } from '../components/hero-film';

@Component({
  selector: 'app-landing',
  imports: [RouterLink, CountUp, Header, HeroFilm],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class Landing implements OnInit, OnDestroy {
  private api = inject(Api);
  /** film clock in seconds, drives the hero text reveal */
  readonly t = signal(0);
  // shown immediately; replaced by live numbers from the backend
  readonly stats = signal([
    { glyph: '@', value: 3, suffix: '', dec: 0, label: 'NPT Rings Mapped' },
    { glyph: '#', value: 47, suffix: '', dec: 0, label: 'Network Elements' },
    { glyph: '*', value: 5, suffix: '', dec: 0, label: 'Peyto Routers' },
    { glyph: '+', value: 7, suffix: '', dec: 0, label: 'ECI Design Rules' },
  ]);

  async ngOnInit() {
    document.body.classList.add('lock');
    try {
      const o = await this.api.overview();
      this.stats.set([
        { glyph: '@', value: o.rings, suffix: '', dec: 0, label: 'NPT Rings Mapped' },
        { glyph: '#', value: o.nodes, suffix: '', dec: 0, label: 'Network Elements' },
        { glyph: '*', value: o.peyto_routers, suffix: '', dec: 0, label: 'Peyto Routers' },
        { glyph: '+', value: o.rules, suffix: '', dec: 0, label: 'ECI Design Rules' },
      ]);
    } catch { /* backend offline: keep defaults */ }
  }
  ngOnDestroy() { document.body.classList.remove('lock'); }
}
