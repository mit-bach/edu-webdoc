import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import {
  type SectionInfo,
  type StoredAudio,
  loadAudio,
  loadAllAudioIds,
  base64ToBlob,
  tryLoadStaticAudio,
  blobToBase64,
  getAudioDuration,
  estimateWordTimings,
  checkLocalDevMode,
} from "./tts";

// ─── Types ───

interface AudioState {
  // Availability
  audioReady: boolean;
  availableSections: Set<string>;

  // Playback
  currentSectionId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  currentWordIndex: number;
  sequentialMode: boolean;
  playbackRate: number;

  // Section catalog (set after extraction)
  sections: SectionInfo[];

  // UI state
  showGenerator: boolean;
  highlightingEnabled: boolean;

  // Dev mode
  localDev: boolean;
}

interface AudioActions {
  setSections: (s: SectionInfo[]) => void;
  playSectionFromBeginning: (sectionId: string) => void;
  playSection: (sectionId: string) => void;
  pause: () => void;
  resume: () => void;
  togglePlayPause: (sectionId: string) => void;
  seekTo: (time: number) => void;
  nextSection: () => void;
  prevSection: () => void;
  setSequentialMode: (v: boolean) => void;
  setPlaybackRate: (r: number) => void;
  setShowGenerator: (v: boolean) => void;
  setHighlightingEnabled: (v: boolean) => void;
  refreshAvailability: () => Promise<void>;
  markSectionAvailable: (id: string) => void;
}

type AudioCtx = AudioState & AudioActions;

const AudioContext = createContext<AudioCtx | null>(null);

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error("useAudio must be used inside AudioProvider");
  return ctx;
}

// ─── Provider ───

export function AudioProvider({ children }: { children: ReactNode }) {
  // State
  const [audioReady, setAudioReady] = useState(false);
  const [availableSections, setAvailableSections] = useState<Set<string>>(new Set());
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [sequentialMode, setSequentialMode] = useState(true);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [showGenerator, setShowGenerator] = useState(false);
  const [highlightingEnabled, setHighlightingEnabled] = useState(true);
  const [localDev, setLocalDev] = useState(false);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentDataRef = useRef<StoredAudio | null>(null);
  const animFrameRef = useRef<number>(0);
  const blobUrlRef = useRef<string>("");
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  // Initialize persistent audio element (iOS needs a single element)
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    // @ts-expect-error iOS webkit
    audio.setAttribute("playsinline", "");
    audioRef.current = audio;

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", () => setIsPlaying(false));
    audio.addEventListener("play", () => setIsPlaying(true));

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []); // eslint-disable-line

  // Check for dev mode + available audio on mount
  useEffect(() => {
    (async () => {
      const isDev = await checkLocalDevMode();
      setLocalDev(isDev);
      await refreshAvailability();
    })();
  }, []); // eslint-disable-line

  // Word highlighting loop
  useEffect(() => {
    if (!isPlaying || !highlightingEnabled) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const tick = () => {
      const audio = audioRef.current;
      const data = currentDataRef.current;
      if (!audio || !data) return;

      const t = audio.currentTime;
      setCurrentTime(t);

      const timings = data.wordTimings;
      let idx = -1;
      for (let i = timings.length - 1; i >= 0; i--) {
        if (t >= timings[i]) {
          idx = i;
          break;
        }
      }
      setCurrentWordIndex(idx);

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, highlightingEnabled]);

  // Apply word highlighting to DOM
  useEffect(() => {
    if (!currentSectionId || currentWordIndex < 0 || !highlightingEnabled) {
      document.querySelectorAll(".aw--active").forEach(el => el.classList.remove("aw--active"));
      return;
    }

    document.querySelectorAll(".aw--active").forEach(el => el.classList.remove("aw--active"));

    const wordEl = document.querySelector(
      `.aw[data-section="${currentSectionId}"][data-w="${currentWordIndex}"]`
    );
    if (wordEl) {
      wordEl.classList.add("aw--active");
      if (window.innerWidth < 768) {
        wordEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentWordIndex, currentSectionId, highlightingEnabled]);

  // ─── Handlers ───

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentWordIndex(-1);

    if (!sectionsRef.current.length) return;

    const curId = currentDataRef.current?.id;
    if (!curId) return;

    const curIdx = sectionsRef.current.findIndex(s => s.id === curId);
    if (curIdx >= 0 && curIdx < sectionsRef.current.length - 1) {
      setTimeout(() => {
        const next = sectionsRef.current[curIdx + 1];
        const seqCheckbox = document.querySelector('[data-sequential-mode]') as HTMLElement | null;
        const isSeq = seqCheckbox?.dataset.sequentialMode === "true";
        if (isSeq) {
          loadAndPlaySection(next.id);
        }
      }, 500);
    }
  }, []);

  const loadAndPlaySection = useCallback(async (sectionId: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Try IndexedDB first
    let data = await loadAudio(sectionId);

    if (!data) {
      // Try loading from static /audio/ directory (works for both local dev + GitHub Pages)
      const staticBlob = await tryLoadStaticAudio(sectionId);
      if (staticBlob) {
        const b64 = await blobToBase64(staticBlob);
        const dur = await getAudioDuration(staticBlob);
        const section = sectionsRef.current.find(s => s.id === sectionId);
        const words = section?.words || [];
        const timings = estimateWordTimings(words, dur);
        data = {
          id: sectionId,
          audioBase64: b64,
          duration: dur,
          wordTimings: timings,
          text: section?.text || "",
          words,
        };
      }
    }

    if (!data) return;

    currentDataRef.current = data;
    setCurrentSectionId(sectionId);
    setDuration(data.duration);
    setCurrentWordIndex(-1);
    setCurrentTime(0);

    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

    const blob = base64ToBlob(data.audioBase64);
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;

    audio.src = url;
    audio.playbackRate = playbackRate;
    try {
      await audio.play();
    } catch (e) {
      console.warn("Audio play failed (may need user interaction):", e);
    }
  }, [playbackRate]);

  // ─── Actions ───

  const playSectionFromBeginning = useCallback((sectionId: string) => {
    loadAndPlaySection(sectionId);
  }, [loadAndPlaySection]);

  const playSection = useCallback((sectionId: string) => {
    if (currentSectionId === sectionId && audioRef.current) {
      audioRef.current.play();
    } else {
      loadAndPlaySection(sectionId);
    }
  }, [currentSectionId, loadAndPlaySection]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play();
  }, []);

  const togglePlayPause = useCallback((sectionId: string) => {
    if (currentSectionId === sectionId && isPlaying) {
      pause();
    } else if (currentSectionId === sectionId) {
      resume();
    } else {
      loadAndPlaySection(sectionId);
    }
  }, [currentSectionId, isPlaying, pause, resume, loadAndPlaySection]);

  const seekTo = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const nextSection = useCallback(() => {
    if (!sections.length || !currentSectionId) return;
    const idx = sections.findIndex(s => s.id === currentSectionId);
    if (idx >= 0 && idx < sections.length - 1) {
      loadAndPlaySection(sections[idx + 1].id);
    }
  }, [sections, currentSectionId, loadAndPlaySection]);

  const prevSection = useCallback(() => {
    if (!sections.length || !currentSectionId) return;
    const idx = sections.findIndex(s => s.id === currentSectionId);
    if (idx > 0) {
      loadAndPlaySection(sections[idx - 1].id);
    }
  }, [sections, currentSectionId, loadAndPlaySection]);

  const setPlaybackRate = useCallback((r: number) => {
    setPlaybackRateState(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  }, []);

  const refreshAvailability = useCallback(async () => {
    try {
      const ids = await loadAllAudioIds();
      const set = new Set(ids);
      setAvailableSections(set);
      setAudioReady(set.size > 0);
    } catch {
      // IndexedDB not available
    }
  }, []);

  const markSectionAvailable = useCallback((id: string) => {
    setAvailableSections(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setAudioReady(true);
  }, []);

  // ─── Context value ───

  const value: AudioCtx = {
    audioReady,
    availableSections,
    currentSectionId,
    isPlaying,
    currentTime,
    duration,
    currentWordIndex,
    sequentialMode,
    playbackRate,
    sections,
    showGenerator,
    highlightingEnabled,
    localDev,

    setSections,
    playSectionFromBeginning,
    playSection,
    pause,
    resume,
    togglePlayPause,
    seekTo,
    nextSection,
    prevSection,
    setSequentialMode,
    setPlaybackRate,
    setShowGenerator,
    setHighlightingEnabled,
    refreshAvailability,
    markSectionAvailable,
  };

  return (
    <AudioContext.Provider value={value}>
      {/* Hidden data attribute for sequential mode (accessed by ended handler) */}
      <div data-sequential-mode={String(sequentialMode)} style={{ display: "none" }} />
      {children}
    </AudioContext.Provider>
  );
}

// ─── Word wrapping utility (call after chapter renders) ───

export function wrapWordsInSection(
  container: HTMLElement,
  sectionId: string
): number {
  const proseSelectors = "p, li, .callout p, .pull-quote";
  const proseEls = container.querySelectorAll(proseSelectors);
  let wordIndex = 0;

  proseEls.forEach(el => {
    if (el.closest(".code-block") || el.closest(".code-toggle-btn")) return;
    if (el.querySelector(".aw")) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    for (const textNode of textNodes) {
      const content = textNode.textContent || "";
      if (!content.trim()) continue;

      const parts = content.split(/(\s+)/);
      const fragment = document.createDocumentFragment();

      for (const part of parts) {
        if (/\S/.test(part)) {
          const span = document.createElement("span");
          span.className = "aw";
          span.dataset.w = String(wordIndex);
          span.dataset.section = sectionId;
          span.textContent = part;
          fragment.appendChild(span);
          wordIndex++;
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  });

  return wordIndex;
}

export function clearWordWrapping(container: HTMLElement) {
  const spans = container.querySelectorAll(".aw");
  spans.forEach(span => {
    const text = document.createTextNode(span.textContent || "");
    span.parentNode?.replaceChild(text, span);
  });
  container.normalize();
}
