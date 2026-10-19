"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Film } from "lucide-react";
import { assetFileUrl, assetThumbUrl } from "@/lib/client/api";
import { useLatest } from "@/lib/client/hooks";
import { captionAt } from "@/lib/shared/captions";
import { placeScenes, sceneAt, type PlacedScene } from "@/lib/shared/timeline";
import type { Asset, ProjectState } from "@/lib/shared/types";
import { CaptionOverlay } from "./caption-overlay";
import { useClockTime, type Clock } from "./clock";

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function LiveCaption({ clock, state, width, height }: { clock: Clock; state: ProjectState; width: number; height: number }) {
  const t = useClockTime(clock, 1 / 30);
  if (!state.captions.enabled) return null;
  return <CaptionOverlay caption={captionAt(state.captions.items, t)} style={state.captions.style} width={width} height={height} />;
}

const MOTION_ZOOM = 0.12;

/**
 * 9:16 preview. Each scene's media element stays mounted; a clock subscription
 * shows the active one and keeps video/audio in sync without re-rendering React.
 */
export function Preview({
  state,
  assets,
  clock,
  playing,
  aspect,
}: {
  state: ProjectState;
  assets: Map<string, Asset>;
  clock: Clock;
  playing: boolean;
  aspect: number;
}) {
  const [boxRef, box] = useElementSize<HTMLDivElement>();
  const placed = useMemo(() => placeScenes(state.scenes), [state.scenes]);
  const mediaRefs = useRef(new Map<string, HTMLVideoElement | HTMLImageElement>());
  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const narrationRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useLatest(playing);
  // Re-sync when a media file finishes loading (seeks made before that are otherwise lost).
  const syncRef = useRef<(() => void) | null>(null);
  const resync = () => syncRef.current?.();

  // Fit a 9:16 frame inside the available box.
  const frameH = Math.max(0, Math.min(box.h, box.w / aspect));
  const frameW = frameH * aspect;

  const narrationAsset = state.narration ? assets.get(state.narration.assetId) : undefined;
  const musicAsset = state.music ? assets.get(state.music.assetId) : undefined;

  useEffect(() => {
    const sync = () => {
      const t = clock.get();
      const isPlaying = playingRef.current;
      const active: PlacedScene | null = sceneAt(placed, t);
      for (const s of placed) {
        const layer = layerRefs.current.get(s.id);
        const media = mediaRefs.current.get(s.id);
        const on = active?.id === s.id;
        if (layer) layer.style.visibility = on ? "visible" : "hidden";
        if (!media) continue;
        const local = Math.max(0, Math.min(s.duration, t - s.start));
        if (media instanceof HTMLVideoElement) {
          if (!on) {
            if (!media.paused) media.pause();
            continue;
          }
          const expected = s.trimStart + local;
          media.muted = s.clipMuted;
          media.volume = Math.min(1, s.clipVolume);
          const drift = Math.abs(media.currentTime - expected);
          if (isPlaying) {
            if (drift > 0.3) media.currentTime = expected;
            if (media.paused) void media.play().catch(() => undefined);
          } else {
            if (!media.paused) media.pause();
            if (drift > 0.04 && media.readyState >= 1) media.currentTime = expected;
          }
        } else if (s.motion !== "none") {
          const p = s.duration > 0 ? local / s.duration : 0;
          const z = s.motion === "zoomIn" ? 1 + MOTION_ZOOM * p : 1 + MOTION_ZOOM * (1 - p);
          media.style.transform = `scale(${z})`;
        } else {
          media.style.transform = "";
        }
      }
      const syncAudio = (el: HTMLAudioElement | null, offset: number, volume: number, muted: boolean, loop: boolean) => {
        if (!el) return;
        el.volume = Math.min(1, volume);
        el.muted = muted;
        const dur = isFinite(el.duration) ? el.duration : 0;
        let expected = t - offset;
        if (loop && dur > 0) expected = expected % dur;
        const inRange = expected >= 0 && (dur === 0 || expected < dur);
        if (isPlaying && inRange) {
          if (Math.abs(el.currentTime - expected) > 0.25) el.currentTime = expected;
          if (el.paused) void el.play().catch(() => undefined);
        } else {
          if (!el.paused) el.pause();
          if (inRange && Math.abs(el.currentTime - expected) > 0.05 && el.readyState >= 1) el.currentTime = expected;
        }
      };
      syncAudio(narrationRef.current, state.narration?.offset ?? 0, state.narration?.volume ?? 1, !!state.narration?.muted, false);
      syncAudio(musicRef.current, state.music?.offset ?? 0, state.music?.volume ?? 1, !!state.music?.muted, !!state.music?.loop);
    };
    sync();
    syncRef.current = sync;
    return clock.subscribe(sync);
  }, [clock, placed, state.narration, state.music, playing, playingRef]);

  return (
    <div ref={boxRef} className="checkerboard relative flex h-full w-full items-center justify-center overflow-hidden">
      <div
        className="relative overflow-hidden rounded-md bg-black shadow-2xl shadow-black/60 ring-1 ring-white/10"
        style={{ width: frameW, height: frameH }}
        aria-label="Video preview"
        role="img"
      >
        {placed.length === 0 && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/50">
            <div>
              <Film className="mx-auto mb-2 size-8" />
              Add photos or clips from the Media panel to start.
            </div>
          </div>
        )}
        {placed.map((s) => {
          const a = assets.get(s.assetId);
          const missing = !a || !a.available;
          const objectFit = s.fit === "cover" ? "cover" : "contain";
          return (
            <div
              key={s.id}
              ref={(el) => {
                if (el) layerRefs.current.set(s.id, el);
                else layerRefs.current.delete(s.id);
              }}
              className="absolute inset-0 overflow-hidden"
              style={{ visibility: "hidden" }}
            >
              {missing ? (
                <div className="grid h-full place-items-center bg-zinc-900 p-4 text-center text-sm text-amber-300">
                  <div>
                    <AlertTriangle className="mx-auto mb-2 size-6" />
                    Missing media: {a?.name ?? "unknown"}
                  </div>
                </div>
              ) : (
                <>
                  {s.fit === "blur" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.kind === "image" ? assetFileUrl(a.id) : assetThumbUrl(a.id)}
                      alt=""
                      className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-75"
                    />
                  )}
                  {a.kind === "video" ? (
                    <video
                      ref={(el) => {
                        if (el) mediaRefs.current.set(s.id, el);
                        else mediaRefs.current.delete(s.id);
                      }}
                      src={assetFileUrl(a.id)}
                      className="absolute inset-0 h-full w-full"
                      style={{ objectFit }}
                      // Fully buffer only the first clips; later ones load metadata until needed.
                      preload={s.index < 3 ? "auto" : "metadata"}
                      onLoadedMetadata={resync}
                      onLoadedData={resync}
                      playsInline
                      muted
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      ref={(el) => {
                        if (el) mediaRefs.current.set(s.id, el);
                        else mediaRefs.current.delete(s.id);
                      }}
                      src={assetFileUrl(a.id)}
                      alt=""
                      className="absolute inset-0 h-full w-full origin-center"
                      style={{ objectFit }}
                      draggable={false}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
        {frameH > 0 && <LiveCaption clock={clock} state={state} width={frameW} height={frameH} />}
        {narrationAsset?.available && <audio ref={narrationRef} src={assetFileUrl(narrationAsset.id)} preload="auto" onLoadedMetadata={resync} />}
        {musicAsset?.available && <audio ref={musicRef} src={assetFileUrl(musicAsset.id)} preload="auto" onLoadedMetadata={resync} />}
      </div>
    </div>
  );
}
