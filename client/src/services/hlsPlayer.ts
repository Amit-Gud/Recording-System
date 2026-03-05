import Hls from "hls.js";

export interface HlsPlayerOptions {
  onError?: (detail: string) => void;
  /** Called whenever the media duration becomes known / changes. */
  onDurationChange?: (seconds: number) => void;
}

/**
 * Thin wrapper around hls.js.
 * Handles attach/detach lifecycle and exposes a minimal control surface.
 */
export class HlsPlayer {
  private hls: Hls | null = null;
  private video: HTMLVideoElement | null = null;

  attach(video: HTMLVideoElement, src: string, opts: HlsPlayerOptions = {}): void {
    this.detach();
    this.video = video;

    if (Hls.isSupported()) {
      const hls = new Hls({
        // Start from the earliest segment so replay works from t=0
        startPosition: 0,
        // Low-latency tweaks are not needed for replay, keep defaults.
      });
      this.hls = hls;

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) opts.onError?.(data.details);
      });

      hls.on(Hls.Events.LEVEL_LOADED, (_evt, data) => {
        opts.onDurationChange?.(data.details.totalduration);
      });

      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = src;
      video.addEventListener("durationchange", () => {
        if (video.duration) opts.onDurationChange?.(video.duration);
      });
    } else {
      opts.onError?.("HLS is not supported in this browser");
    }
  }

  detach(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.video) {
      this.video.src = "";
      this.video = null;
    }
  }

  /** Seek to an absolute position in seconds. */
  seekTo(seconds: number): void {
    if (this.video) this.video.currentTime = seconds;
  }

  setPlaybackRate(rate: number): void {
    if (this.video) this.video.playbackRate = rate;
  }
}
