import type { ProjectState, Scene } from "./types";

export type PlacedScene = Scene & { start: number; end: number; index: number };

export function placeScenes(scenes: Scene[]): PlacedScene[] {
  let t = 0;
  return scenes.map((s, index) => {
    const placed = { ...s, start: t, end: t + s.duration, index };
    t += s.duration;
    return placed;
  });
}

export function timelineDuration(state: Pick<ProjectState, "scenes">): number {
  return state.scenes.reduce((n, s) => n + s.duration, 0);
}

export function sceneAt(scenes: PlacedScene[], t: number): PlacedScene | null {
  if (scenes.length === 0) return null;
  for (const s of scenes) if (t >= s.start && t < s.end) return s;
  const last = scenes[scenes.length - 1];
  return t >= last.end ? last : scenes[0];
}

/**
 * Split the scene under time `t` into two scenes (CapCut "Split").
 * For videos, the second half's trimStart advances so playback is continuous.
 * Returns null when `t` is too close to a scene edge.
 */
export function splitSceneAt(
  scenes: Scene[],
  t: number,
  isVideo: (assetId: string) => boolean,
  newId: () => string,
  minDuration = 0.1,
): { scenes: Scene[]; newSceneId: string } | null {
  const placed = placeScenes(scenes);
  const target = placed.find((s) => t > s.start && t < s.end);
  if (!target) return null;
  const firstDur = round3(t - target.start);
  const secondDur = round3(target.end - t);
  if (firstDur < minDuration || secondDur < minDuration) return null;
  const { index } = target;
  const base: Scene = {
    id: target.id,
    assetId: target.assetId,
    duration: target.duration,
    trimStart: target.trimStart,
    fit: target.fit,
    motion: target.motion,
    clipVolume: target.clipVolume,
    clipMuted: target.clipMuted,
  };
  const first: Scene = { ...base, duration: firstDur };
  const id = newId();
  const second: Scene = {
    ...base,
    id,
    duration: secondDur,
    trimStart: isVideo(base.assetId) ? round3(base.trimStart + firstDur) : base.trimStart,
  };
  const next = [...scenes];
  next.splice(index, 1, first, second);
  return { scenes: next, newSceneId: id };
}

export function moveScene(scenes: Scene[], from: number, to: number): Scene[] {
  if (from === to || from < 0 || to < 0 || from >= scenes.length || to >= scenes.length) return scenes;
  const next = [...scenes];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Stretch/shrink scenes proportionally so the video matches a target length
 * (e.g. the narration). Video scenes are not extended past their source length.
 */
export function fitScenesToDuration(
  scenes: Scene[],
  target: number,
  sourceDuration: (assetId: string) => number | null,
): Scene[] {
  const total = scenes.reduce((n, s) => n + s.duration, 0);
  if (total <= 0 || target <= 0) return scenes;
  const ratio = target / total;
  const next = scenes.map((s) => {
    let d = s.duration * ratio;
    const src = sourceDuration(s.assetId);
    if (src !== null) d = Math.min(d, Math.max(0.1, src - s.trimStart));
    return { ...s, duration: round3(Math.max(0.1, d)) };
  });
  // Put any remainder (from clamped videos) on the last image scene, or the last scene.
  const diff = round3(target - next.reduce((n, s) => n + s.duration, 0));
  if (Math.abs(diff) > 0.001 && next.length) {
    let idx = -1;
    for (let i = next.length - 1; i >= 0; i--) if (sourceDuration(next[i].assetId) === null) { idx = i; break; }
    if (idx < 0) idx = next.length - 1;
    next[idx] = { ...next[idx], duration: round3(Math.max(0.1, next[idx].duration + diff)) };
  }
  return next;
}

export function formatTimecode(seconds: number, fps = 30): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return "—";
  const s = Math.round(seconds * 10) / 10;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
