import { useState, useCallback, useRef, useEffect } from "react";
import { useAudio } from "./AudioProvider";
import {
  generateSpeech,
  storeAudio,
  blobToBase64,
  getAudioDuration,
  estimateWordTimings,
  downloadAudioFiles,
  clearAllAudio,
  extractSectionsFromChapter,
  serverGenerateTTS,
  isLocalDev,
  type SectionInfo,
} from "./tts";
import {
  Headphones,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  X,
  Download,
  Loader2,
  Settings2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Server,
  Globe,
} from "lucide-react";

// ─── Chapter metadata for extraction ───
const CHAPTERS = [
  { id: "ch1", num: 1, title: "The Policy Architecture" },
  { id: "ch2", num: 2, title: "Prompt Chaining" },
  { id: "ch3", num: 3, title: "Queue: Agent Dispatch" },
  { id: "ch4", num: 4, title: "Queue: Population Traversal" },
  { id: "ch5", num: 5, title: "Tool Use & Structured Output" },
  { id: "ch6", num: 6, title: "State & Idempotency" },
  { id: "ch7", num: 7, title: "Context Engineering" },
  { id: "ch8", num: 8, title: "Beyond MVP" },
];

const VOICES = [
  // { id: "nova", name: "Nova", desc: "Warm, natural female" },
  // { id: "alloy", name: "Alloy", desc: "Balanced, neutral" },
  // { id: "echo", name: "Echo", desc: "Warm male" },
  // { id: "fable", name: "Fable", desc: "Expressive, British" },
  // { id: "marin", name: "Marin", desc: "Smooth, calm" },
  { id: "cedar", name: "Cedar", desc: "Grounded, rich" },
];

// ═══════════════════════════════════════════
// AUDIO SETUP BUTTON (sidebar)
// ═══════════════════════════════════════════

export function AudioSetupButton() {
  const { audioReady, setShowGenerator } = useAudio();

  return (
    <button
      onClick={() => setShowGenerator(true)}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-left transition-colors"
      style={{
        background: audioReady ? "var(--sage-faint)" : "var(--amber-glow)",
        border: `1px solid ${audioReady ? "var(--sage-dim)" : "var(--amber-dim)"}`,
        color: audioReady ? "var(--sage-bright)" : "var(--amber-bright)",
        fontFamily: "var(--font-body)",
        fontSize: "0.78rem",
      }}
    >
      <Headphones size={14} />
      {audioReady ? "Audio Ready" : "Setup Audiobook"}
    </button>
  );
}

// ═══════════════════════════════════════════
// GENERATOR MODAL
// ═══════════════════════════════════════════

export function AudioGeneratorModal() {
  const { showGenerator, setShowGenerator, setSections, markSectionAvailable, refreshAvailability, audioReady } = useAudio();
  const [apiKey, setApiKey] = useState("");
  const [voice, setVoice] = useState("cedar");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const abortRef = useRef(false);

  const localDev = isLocalDev();

  const handleGenerate = useCallback(async () => {
    // Only require API key if NOT running on local dev server
    if (!localDev && !apiKey.trim()) {
      setError("Please enter your OpenAI API key");
      return;
    }
    setError("");
    setGenerating(true);
    abortRef.current = false;

    try {
      // Step 1: Extract sections from all chapters
      const allSections: SectionInfo[] = [];
      let globalOffset = 0;

      const navButtons = document.querySelectorAll("nav button");

      for (let chIdx = 0; chIdx < CHAPTERS.length; chIdx++) {
        if (abortRef.current) break;

        const btn = navButtons[chIdx] as HTMLElement;
        if (btn) {
          btn.click();
          await new Promise(r => setTimeout(r, 150));
        }

        const currentArticle = document.querySelector("main article.prose-body") as HTMLElement;
        if (!currentArticle) continue;

        const chSections = extractSectionsFromChapter(currentArticle, CHAPTERS[chIdx].num, globalOffset);
        globalOffset += chSections.length;
        allSections.push(...chSections);
      }

      setSections(allSections);

      // Step 2: Generate audio for each section
      setProgress({ current: 0, total: allSections.length, label: "Generating audio..." });

      for (let i = 0; i < allSections.length; i++) {
        if (abortRef.current) break;
        const section = allSections[i];
        setProgress({
          current: i + 1,
          total: allSections.length,
          label: `Ch${section.chapterId.replace("ch", "")} — ${section.title.slice(0, 40)}...`,
        });

        try {
          if (localDev) {
            // ── Local dev: server generates + saves to disk ──
            const result = await serverGenerateTTS(
              section.id,
              section.text,
              section.words,
              voice
            );
            // Mark available immediately (file is on disk)
            markSectionAvailable(section.id);

            // Also store in IndexedDB for word highlighting playback
            // (load the file we just saved to get the blob)
            const audioResp = await fetch(result.filePath);
            if (audioResp.ok) {
              const blob = await audioResp.blob();
              const base64 = await blobToBase64(blob);
              const duration = await getAudioDuration(blob);
              const wordTimings = estimateWordTimings(section.words, duration);
              await storeAudio({
                id: section.id,
                audioBase64: base64,
                duration,
                wordTimings,
                text: section.text,
                words: section.words,
              });
            }
          } else {
            // ── GitHub Pages / no server: client-side generation ──
            const blob = await generateSpeech(section.text, apiKey.trim(), voice);
            const base64 = await blobToBase64(blob);
            const duration = await getAudioDuration(blob);
            const wordTimings = estimateWordTimings(section.words, duration);

            await storeAudio({
              id: section.id,
              audioBase64: base64,
              duration,
              wordTimings,
              text: section.text,
              words: section.words,
            });

            markSectionAvailable(section.id);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`Failed to generate audio for ${section.id}:`, msg);

          if (msg.includes("401") || msg.includes("Invalid")) {
            setError(localDev
              ? "Server API key issue. Check OPENAI_API_KEY in your .env file."
              : "Invalid API key. Check your OpenAI key and try again."
            );
            break;
          }
          if (msg.includes("429")) {
            setProgress(prev => ({ ...prev, label: "Rate limited, waiting 30s..." }));
            await new Promise(r => setTimeout(r, 30000));
            i--; // Retry this section
            continue;
          }
          if (msg.includes("OPENAI_API_KEY not set")) {
            setError("Server's OPENAI_API_KEY is not configured. Add it to your .env file and restart the server.");
            break;
          }
        }
      }

      if (!abortRef.current) {
        await refreshAvailability();
        const firstBtn = navButtons[0] as HTMLElement;
        if (firstBtn) firstBtn.click();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [apiKey, voice, localDev, setSections, markSectionAvailable, refreshAvailability]);

  const handleClear = useCallback(async () => {
    await clearAllAudio();
    await refreshAvailability();
  }, [refreshAvailability]);

  if (!showGenerator) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget && !generating) setShowGenerator(false); }}
    >
      <div
        className="w-full max-w-lg rounded-lg overflow-hidden"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center gap-3">
            <Headphones size={20} style={{ color: "var(--amber-bright)" }} />
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", color: "var(--text-primary)", fontWeight: 600 }}>
                Audiobook Setup
              </h2>
              <p style={{ fontFamily: "var(--font-body)", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
                {localDev
                  ? "Generate narration via local server — files saved to project"
                  : "Generate narration using OpenAI TTS"
                }
              </p>
            </div>
          </div>
          {!generating && (
            <button onClick={() => setShowGenerator(false)} style={{ color: "var(--text-muted)" }}>
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Mode indicator */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-md"
            style={{
              background: localDev ? "var(--sage-faint)" : "var(--bg-deep)",
              border: `1px solid ${localDev ? "var(--sage-dim)" : "var(--border-subtle)"}`,
            }}
          >
            {localDev ? <Server size={14} style={{ color: "var(--sage-bright)" }} /> : <Globe size={14} style={{ color: "var(--text-muted)" }} />}
            <span style={{ fontFamily: "var(--font-body)", fontSize: "0.75rem", color: localDev ? "var(--sage-bright)" : "var(--text-muted)" }}>
              {localDev
                ? "Local dev server detected — audio files will be saved to audio/ folder"
                : "Static deployment — audio stored in browser only"
              }
            </span>
          </div>

          {/* API Key — only show when NOT on local dev server */}
          {!localDev && (
            <div>
              <label style={{ fontFamily: "var(--font-body)", fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
                OpenAI API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                disabled={generating}
                className="w-full px-3 py-2.5 rounded-md"
                style={{
                  background: "var(--bg-deep)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.82rem",
                  outline: "none",
                }}
              />
              <p style={{ fontFamily: "var(--font-body)", fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 4 }}>
                Your key stays in your browser. It is never stored or sent anywhere except OpenAI.
              </p>
            </div>
          )}

          {/* Voice selection */}
          <div>
            <label style={{ fontFamily: "var(--font-body)", fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
              Voice
            </label>
            <div className="grid grid-cols-3 gap-2">
              {VOICES.map(v => (
                <button
                  key={v.id}
                  onClick={() => setVoice(v.id)}
                  disabled={generating}
                  className="px-3 py-2 rounded-md text-left transition-colors"
                  style={{
                    background: voice === v.id ? "var(--amber-glow)" : "var(--bg-deep)",
                    border: `1px solid ${voice === v.id ? "var(--amber-dim)" : "var(--border-subtle)"}`,
                    opacity: generating ? 0.5 : 1,
                  }}
                >
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", fontWeight: 600, color: voice === v.id ? "var(--amber-bright)" : "var(--text-primary)" }}>
                    {v.name}
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.65rem", color: "var(--text-muted)" }}>
                    {v.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced settings */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1"
            style={{ fontFamily: "var(--font-body)", fontSize: "0.75rem", color: "var(--text-muted)" }}
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Advanced settings
          </button>

          {showAdvanced && (
            <div className="p-3 rounded-md" style={{ background: "var(--bg-deep)", border: "1px solid var(--border-subtle)" }}>
              <p style={{ fontFamily: "var(--font-body)", fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--text-secondary)" }}>Cost estimate:</strong> ~24,000 words x ~$0.015/1K chars ~ $1.50-3.00 total.
                Uses <code className="code-inline">gpt-4o-mini-tts-2025-12-15</code> model.
                {localDev
                  ? " Audio is saved as .mp3 files in the audio/ directory of your project. These files can be committed and deployed to GitHub Pages."
                  : " Audio is stored in your browser's IndexedDB. For GitHub Pages deployment, use \"Download Audio Pack\" after generation."
                }
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-md" style={{ background: "var(--rose-faint)", border: "1px solid var(--rose-bright)", color: "var(--rose-bright)", fontFamily: "var(--font-body)", fontSize: "0.8rem" }}>
              {error}
            </div>
          )}

          {/* Progress */}
          {generating && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: "var(--font-body)", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  {progress.label}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--amber-bright)" }}>
                  {progress.current}/{progress.total}
                </span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-deep)" }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`,
                    background: "var(--amber-bright)",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex gap-2">
            {audioReady && (
              <>
                {/* Download pack only shown when NOT on local dev (files already on disk) */}
                {!localDev && (
                  <button
                    onClick={() => downloadAudioFiles()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md transition-colors"
                    style={{ background: "var(--bg-deep)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)", fontFamily: "var(--font-body)", fontSize: "0.78rem" }}
                  >
                    <Download size={14} /> Download Pack
                  </button>
                )}
                <button
                  onClick={handleClear}
                  className="px-3 py-2 rounded-md transition-colors"
                  style={{ background: "var(--bg-deep)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontFamily: "var(--font-body)", fontSize: "0.78rem" }}
                >
                  Clear Audio
                </button>
              </>
            )}
          </div>

          <button
            onClick={generating ? () => { abortRef.current = true; } : handleGenerate}
            className="flex items-center gap-2 px-5 py-2.5 rounded-md font-medium transition-colors"
            style={{
              background: generating ? "var(--rose-faint)" : "var(--amber-bright)",
              color: generating ? "var(--rose-bright)" : "var(--bg-deep)",
              border: generating ? "1px solid var(--rose-bright)" : "none",
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
            }}
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Cancel
              </>
            ) : (
              <>
                <Headphones size={16} /> Generate All Audio
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// SECTION PLAY BUTTON (inline per-section)
// ═══════════════════════════════════════════

export function SectionPlayButton({ sectionId }: { sectionId: string }) {
  const { availableSections, currentSectionId, isPlaying, togglePlayPause } = useAudio();

  if (!availableSections.has(sectionId)) return null;

  const isActive = currentSectionId === sectionId;
  const playing = isActive && isPlaying;

  return (
    <button
      onClick={() => togglePlayPause(sectionId)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all"
      style={{
        background: playing ? "var(--amber-glow)" : "var(--bg-surface)",
        border: `1px solid ${playing ? "var(--amber-dim)" : "var(--border-subtle)"}`,
        color: playing ? "var(--amber-bright)" : "var(--text-muted)",
        fontFamily: "var(--font-body)",
        fontSize: "0.7rem",
        verticalAlign: "middle",
        marginLeft: 8,
      }}
      aria-label={playing ? "Pause" : "Play"}
    >
      {playing ? <Pause size={12} /> : <Play size={12} />}
      {playing ? "Pause" : "Listen"}
    </button>
  );
}

// ═══════════════════════════════════════════
// STICKY PLAYER BAR (bottom of screen)
// ═══════════════════════════════════════════

export function AudioPlayerBar() {
  const {
    audioReady,
    currentSectionId,
    isPlaying,
    currentTime,
    duration,
    sections,
    sequentialMode,
    playbackRate,
    highlightingEnabled,
    pause,
    resume,
    seekTo,
    nextSection,
    prevSection,
    setSequentialMode,
    setPlaybackRate,
    setHighlightingEnabled,
    setShowGenerator,
  } = useAudio();

  const [expanded, setExpanded] = useState(false);

  if (!audioReady) return null;

  const currentSection = sections.find(s => s.id === currentSectionId);
  const currentIdx = sections.findIndex(s => s.id === currentSectionId);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const rates = [0.75, 1, 1.25, 1.5, 2];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border-subtle)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Progress bar (clickable) */}
      <div
        className="h-1 cursor-pointer relative"
        style={{ background: "var(--bg-deep)" }}
        onClick={e => {
          if (!duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seekTo(pct * duration);
        }}
      >
        <div
          className="h-full transition-[width] duration-100"
          style={{ width: `${progress}%`, background: "var(--amber-bright)" }}
        />
      </div>

      {/* Main controls */}
      <div className="flex items-center gap-3 px-4 py-2.5 md:px-6">
        {/* Prev / Play-Pause / Next */}
        <div className="flex items-center gap-1">
          <button
            onClick={prevSection}
            disabled={currentIdx <= 0}
            className="p-2 rounded-full transition-colors"
            style={{ color: currentIdx > 0 ? "var(--text-secondary)" : "var(--text-muted)", opacity: currentIdx > 0 ? 1 : 0.3 }}
          >
            <SkipBack size={16} />
          </button>

          <button
            onClick={() => isPlaying ? pause() : (currentSectionId ? resume() : null)}
            className="p-2.5 rounded-full"
            style={{ background: "var(--amber-bright)", color: "var(--bg-deep)" }}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
          </button>

          <button
            onClick={nextSection}
            disabled={currentIdx >= sections.length - 1}
            className="p-2 rounded-full transition-colors"
            style={{ color: currentIdx < sections.length - 1 ? "var(--text-secondary)" : "var(--text-muted)", opacity: currentIdx < sections.length - 1 ? 1 : 0.3 }}
          >
            <SkipForward size={16} />
          </button>
        </div>

        {/* Section info + time */}
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "var(--text-primary)", fontWeight: 500 }}>
            {currentSection?.title || "No section selected"}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--text-muted)" }}>
            {currentSectionId ? `${formatTime(currentTime)} / ${formatTime(duration)}` : "—"}
            {currentIdx >= 0 && <span className="ml-2">({currentIdx + 1}/{sections.length})</span>}
          </div>
        </div>

        {/* Right controls */}
        <div className="hidden md:flex items-center gap-2">
          {/* Playback rate */}
          <div
            className="flex items-center gap-1 px-1 py-1 rounded"
            style={{ background: "var(--bg-deep)", border: "1px solid var(--border-subtle)" }}
            aria-label="Playback speed controls"
          >
            {rates.map(rate => (
              <button
                key={rate}
                onClick={() => setPlaybackRate(rate)}
                className="px-2 py-1 rounded text-xs font-mono transition-colors"
                style={{
                  background: playbackRate === rate ? "var(--amber-glow)" : "transparent",
                  color: playbackRate === rate ? "var(--amber-bright)" : "var(--text-muted)",
                  border: `1px solid ${playbackRate === rate ? "var(--amber-dim)" : "transparent"}`,
                  minWidth: 40,
                  textAlign: "center",
                }}
                aria-label={`Set speed to ${rate}x`}
              >
                {rate}x
              </button>
            ))}
          </div>

          {/* Highlighting toggle */}
          <button
            onClick={() => setHighlightingEnabled(!highlightingEnabled)}
            className="p-1.5 rounded"
            style={{ color: highlightingEnabled ? "var(--amber-bright)" : "var(--text-muted)" }}
            title={highlightingEnabled ? "Disable word highlighting" : "Enable word highlighting"}
          >
            {highlightingEnabled ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>

          {/* Sequential toggle */}
          <button
            onClick={() => setSequentialMode(!sequentialMode)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs"
            style={{
              background: sequentialMode ? "var(--sage-faint)" : "var(--bg-deep)",
              border: `1px solid ${sequentialMode ? "var(--sage-dim)" : "var(--border-subtle)"}`,
              color: sequentialMode ? "var(--sage-bright)" : "var(--text-muted)",
              fontFamily: "var(--font-body)",
            }}
          >
            <Volume2 size={12} />
            Auto
          </button>

          {/* Settings */}
          <button onClick={() => setShowGenerator(true)} className="p-1.5 rounded" style={{ color: "var(--text-muted)" }}>
            <Settings2 size={16} />
          </button>
        </div>

        {/* Mobile expand button */}
        <button
          className="md:hidden p-2"
          onClick={() => setExpanded(!expanded)}
          style={{ color: "var(--text-muted)" }}
        >
          {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      </div>

      {/* Mobile expanded controls */}
      {expanded && (
        <div className="md:hidden flex items-center justify-between px-4 pb-3 pt-1" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <select
            value={String(playbackRate)}
            onChange={e => setPlaybackRate(Number(e.target.value))}
            className="px-3 py-1.5 rounded text-xs font-mono"
            style={{ background: "var(--bg-deep)", border: "1px solid var(--border-subtle)", color: "var(--amber-mid)" }}
            aria-label="Playback speed"
          >
            {rates.map(rate => (
              <option key={rate} value={String(rate)}>
                {rate}x
              </option>
            ))}
          </select>

          <button
            onClick={() => setHighlightingEnabled(!highlightingEnabled)}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs"
            style={{
              background: highlightingEnabled ? "var(--amber-glow)" : "var(--bg-deep)",
              border: `1px solid ${highlightingEnabled ? "var(--amber-dim)" : "var(--border-subtle)"}`,
              color: highlightingEnabled ? "var(--amber-bright)" : "var(--text-muted)",
              fontFamily: "var(--font-body)",
            }}
          >
            {highlightingEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
            Highlight
          </button>

          <button
            onClick={() => setSequentialMode(!sequentialMode)}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs"
            style={{
              background: sequentialMode ? "var(--sage-faint)" : "var(--bg-deep)",
              border: `1px solid ${sequentialMode ? "var(--sage-dim)" : "var(--border-subtle)"}`,
              color: sequentialMode ? "var(--sage-bright)" : "var(--text-muted)",
              fontFamily: "var(--font-body)",
            }}
          >
            <Volume2 size={12} />
            Auto-play
          </button>

          <button onClick={() => setShowGenerator(true)} className="p-1.5 rounded" style={{ color: "var(--text-muted)" }}>
            <Settings2 size={16} />
          </button>
        </div>
      )}

      {/* Safe area padding for iOS */}
      <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
    </div>
  );
}

// ═══════════════════════════════════════════
// SECTION HEADING INJECTOR
// Hook that adds play buttons to h2 headings
// ═══════════════════════════════════════════

export function useInjectSectionPlayButtons(
  containerRef: React.RefObject<HTMLElement | null>,
  chapterNum: number,
  _deps: unknown[]
) {
  const { availableSections, audioReady } = useAudio();

  useEffect(() => {
    if (!audioReady || !containerRef.current) return;

    const container = containerRef.current;
    const h2s = container.querySelectorAll("h2");
    const chId = `ch${chapterNum}`;

    // Clean up existing injected buttons
    container.querySelectorAll(".injected-play-btn").forEach(el => el.remove());

    h2s.forEach((h2, idx) => {
      const sectionId = `${chId}_s${idx}`;
      if (!availableSections.has(sectionId)) return;

      const btnContainer = document.createElement("span");
      btnContainer.className = "injected-play-btn";
      btnContainer.dataset.sectionId = sectionId;
      h2.appendChild(btnContainer);
    });
  }, [audioReady, availableSections, chapterNum, containerRef, ..._deps]); // eslint-disable-line
}
