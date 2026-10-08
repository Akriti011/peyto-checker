import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Header } from '../components/header';
import { HeroFilm } from '../components/hero-film';
import { FILM_LENGTH } from '../components/film3d';

@Component({
  selector: 'app-landing',
  imports: [RouterLink, Header, HeroFilm],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class Landing implements OnInit, OnDestroy {
  /** film clock in seconds (live 3D hero, see film3d.ts) */
  readonly t = signal(0);
  /** true once the intro film has finished; reveals the header and hero */
  readonly ended = signal(false);

  ngOnInit() { document.body.classList.add('lock'); }

  onTime(t: number) {
    this.t.set(t);
    const done = t >= FILM_LENGTH;
    if (done !== this.ended()) this.ended.set(done);   // Replay resets it
  }

  ngOnDestroy() { document.body.classList.remove('lock'); }
}
