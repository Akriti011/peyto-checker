import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
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
export class Landing implements OnInit, AfterViewInit, OnDestroy {
  /** ?export renders the live WebGL film so new hero videos can be exported */
  readonly exportMode = new URLSearchParams(location.search).has('export');
  readonly filmLength = FILM_LENGTH;
  private vid = viewChild<ElementRef<HTMLVideoElement>>('vid');
  /** film clock in seconds */
  readonly t = signal(0);
  /** true once the intro film has finished; reveals the header and hero */
  readonly ended = signal(false);

  ngOnInit() { document.body.classList.add('lock'); }

  ngAfterViewInit() {
    const v = this.vid()?.nativeElement;
    if (!v) return;
    // Angular's `muted` attribute does not set the property, which autoplay needs
    v.muted = true;
    v.play().catch(() => this.skip(v));   // autoplay blocked: go straight to the hero
  }

  onTime(t: number) {
    this.t.set(t);
    const done = t >= FILM_LENGTH;
    if (done !== this.ended()) this.ended.set(done);   // Replay resets it
  }

  skip(v: HTMLVideoElement) {
    v.pause();
    if (Number.isFinite(v.duration)) v.currentTime = v.duration;
    this.onTime(FILM_LENGTH);
  }

  replay(v: HTMLVideoElement) {
    v.currentTime = 0;
    this.onTime(0);
    v.play().catch(() => this.skip(v));
  }

  ngOnDestroy() { document.body.classList.remove('lock'); }
}
