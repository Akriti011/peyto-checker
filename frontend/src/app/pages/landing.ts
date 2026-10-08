import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Header } from '../components/header';

@Component({
  selector: 'app-landing',
  imports: [RouterLink, Header],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class Landing implements OnInit, AfterViewInit, OnDestroy {
  private vid = viewChild.required<ElementRef<HTMLVideoElement>>('vid');
  /** video clock in seconds */
  readonly t = signal(0);
  /** true once the intro video has finished; reveals the header and hero */
  readonly ended = signal(false);
  ngOnInit() { document.body.classList.add('lock'); }
  ngAfterViewInit() {
    // Angular's `muted` attribute does not set the property, which autoplay needs
    const v = this.vid().nativeElement;
    v.muted = true;
    v.play().catch(() => this.skip(v)); // autoplay blocked: go straight to the final frame
  }

  onVideoEnd() { this.ended.set(true); }

  onTime(v: HTMLVideoElement) { this.t.set(v.currentTime); }
  skip(v: HTMLVideoElement) { v.currentTime = v.duration; this.onVideoEnd(); }
  ngOnDestroy() { document.body.classList.remove('lock'); }
}
