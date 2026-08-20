/** Controls YouTube audio ducking and Voice-created playback pauses. */
(() => {
  function createController(getVideo = () => document.querySelector("video.html5-main-video")) {
    let original = null;
    let pausedByVoice = false;

    function enableDucking(factor = 0.15) {
      const video = getVideo();
      if (!video) return false;
      if (!original) {
        original = { volume: video.volume, muted: video.muted };
      }
      video.volume = Math.max(0, Math.min(1, original.volume * factor));
      return true;
    }

    function snapshot() {
      const video = getVideo();
      return {
        currentTime: Number(video?.currentTime) || 0,
        playbackRate: Number(video?.playbackRate) || 1,
        paused: video ? !!video.paused : true,
        pausedByVoice,
      };
    }

    function pauseForCatchUp() {
      const video = getVideo();
      if (!video || video.paused) return false;
      pausedByVoice = true;
      video.pause();
      return true;
    }

    /**
     * Pauses the page's video when its tab becomes hidden. This runs in the
     * page itself so the pause survives side-panel transitions: the panel
     * page can be destroyed and recreated while the user switches tabs, and
     * during that gap its "pauseVideo" message never fires — which left the
     * video playing in the background and mixed with resumed narration.
     */
    function pauseForHiddenPage() {
      const video = getVideo();
      if (!video || video.paused) return false;
      pausedByVoice = false;
      video.pause();
      return true;
    }

    if (typeof document !== "undefined"
        && typeof document.addEventListener === "function"
        && typeof document.visibilityState === "string") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") pauseForHiddenPage();
      });
    }

    async function resumeAfterCatchUp() {
      const video = getVideo();
      if (!video || !pausedByVoice) return false;
      pausedByVoice = false;
      // Never auto-play a tab the user cannot see: teardown cleanup used to
      // resume hidden videos, restarting their audio behind the user's back.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return false;
      }
      await video.play();
      return true;
    }

    /**
     * Marks an externally requested pause (e.g. the user switched tabs) as
     * NOT voice-created, so later cleanup must not auto-resume the video.
     */
    function clearCatchUpPause() {
      pausedByVoice = false;
    }

    async function restore() {
      const video = getVideo();
      if (!video) {
        original = null;
        pausedByVoice = false;
        return false;
      }
      if (original) {
        video.volume = original.volume;
        video.muted = original.muted;
      }
      original = null;
      if (pausedByVoice) await resumeAfterCatchUp().catch(() => {});
      pausedByVoice = false;
      return true;
    }

    return {
      clearCatchUpPause,
      enableDucking,
      pauseForCatchUp,
      pauseForHiddenPage,
      restore,
      resumeAfterCatchUp,
      snapshot,
    };
  }

  const api = { createController };
  globalThis.YTD_VOICE_PLAYBACK = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
