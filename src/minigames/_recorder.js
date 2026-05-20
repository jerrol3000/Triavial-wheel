// Gameplay recorder — uses canvas.captureStream + MediaRecorder to
// capture the last N seconds of gameplay as a downloadable / shareable
// .webm video. This is the viral hook: a player gets a clip of their
// own match they can post to TikTok/Discord/Instagram with one tap.
//
// Architecture:
//   1. games create a Pixi canvas via _pixi.js. We grab the canvas
//      via the onReady callback (PixiArena exposes it).
//   2. Recorder.start(canvas) opens a captureStream + MediaRecorder
//      with a 10-second circular buffer (sliding window via dataavailable
//      chunks).
//   3. Recorder.stop() finalizes the last 10s into a Blob.
//   4. ShareSheet.share(blob) hands off to navigator.share with a video
//      File. Fallback: download .webm + clipboard caption.
//
// Browser support notes:
//   - Chrome / Edge / Firefox: full support
//   - iOS Safari 14.3+: supports MediaRecorder for video/mp4. Older
//     iOS falls back to a "Share text only" path.
//   - Captures Pixi-rendered canvases at 30fps with reasonable bitrate.

const TARGET_DURATION_MS = 10000;
const CHUNK_INTERVAL_MS = 500;
const BITRATE_BPS = 2_500_000; // 2.5 Mbps — good quality at small file size

// Pick a supported mimeType. Chrome prefers webm/vp9, Safari prefers mp4.
function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/mp4;codecs=h264",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  }
  return null;
}

export function isRecordingSupported() {
  return !!pickMime();
}

export class Recorder {
  constructor() {
    this.chunks = []; // [{at, blob}]
    this.recorder = null;
    this.stream = null;
    this.mimeType = null;
    this.startedAt = 0;
  }

  start(canvas, audioStream = null) {
    if (!canvas) return false;
    this.mimeType = pickMime();
    if (!this.mimeType) return false;
    try {
      const videoStream = canvas.captureStream(30);
      // Merge an audio track if provided (from a Howl or Web Audio dest).
      if (audioStream && audioStream.getAudioTracks().length > 0) {
        videoStream.addTrack(audioStream.getAudioTracks()[0]);
      }
      this.stream = videoStream;
      this.recorder = new MediaRecorder(videoStream, {
        mimeType: this.mimeType,
        videoBitsPerSecond: BITRATE_BPS,
      });
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push({ at: Date.now(), blob: e.data });
          // Trim chunks older than TARGET_DURATION_MS — keep the buffer rolling.
          const cutoff = Date.now() - TARGET_DURATION_MS - CHUNK_INTERVAL_MS;
          this.chunks = this.chunks.filter((c) => c.at >= cutoff);
        }
      };
      this.recorder.start(CHUNK_INTERVAL_MS);
      this.startedAt = Date.now();
      return true;
    } catch (e) {
      console.warn("[recorder] start failed", e.message);
      this.recorder = null;
      return false;
    }
  }

  // Returns a Blob of the last TARGET_DURATION_MS of video, or null on
  // failure. After this call, the recorder is stopped.
  async stop() {
    if (!this.recorder) return null;
    const recorder = this.recorder;
    return new Promise((resolve) => {
      const finalize = () => {
        try {
          // Use only the chunks from the trailing window.
          const cutoff = Date.now() - TARGET_DURATION_MS - CHUNK_INTERVAL_MS;
          const keep = this.chunks.filter((c) => c.at >= cutoff).map((c) => c.blob);
          if (keep.length === 0) return resolve(null);
          const blob = new Blob(keep, { type: this.mimeType });
          resolve(blob);
        } catch (e) {
          resolve(null);
        } finally {
          this.recorder = null;
          this.chunks = [];
          if (this.stream) try { this.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
          this.stream = null;
        }
      };
      recorder.onstop = finalize;
      try { recorder.stop(); }
      catch (e) { resolve(null); }
    });
  }
}

// Share a Blob via Web Share API with a video File, or fallback to
// download + clipboard.
export async function shareGameplay(blob, caption = "Spinlore Arena") {
  if (!blob) return { ok: false, reason: "no_blob" };
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const filename = `spinlore-clip.${ext}`;
  const file = new File([blob], filename, { type: blob.type });

  // Modern path: navigator.share with files
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Spinlore", text: caption });
      return { ok: true, method: "web_share" };
    }
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, reason: "user_cancelled" };
  }

  // Fallback: trigger download + copy caption.
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    try { await navigator.clipboard.writeText(caption); } catch (e) {}
    return { ok: true, method: "download" };
  } catch (e) {
    return { ok: false, reason: "download_failed" };
  }
}
