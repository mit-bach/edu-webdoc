import { useState, useRef, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AudioProvider,
  useAudio,
  AudioSetupButton,
  AudioGeneratorModal,
  AudioPlayerBar,
  SectionPlayButton,
  wrapWordsInSection,
  clearWordWrapping,
  extractSectionsFromChapter,
} from "./audio";
import { Play, Headphones } from "lucide-react";

import Ch1PolicyArchitecture from "./chapters/Ch1PolicyArchitecture";
import Ch2PromptChaining from "./chapters/Ch2PromptChaining";
import Ch3QueueDispatch from "./chapters/Ch3QueueDispatch";
import Ch4PopulationTraversal from "./chapters/Ch4PopulationTraversal";
import Ch5ToolUse from "./chapters/Ch5ToolUse";
import Ch6StateMgmt from "./chapters/Ch6StateMgmt";
import Ch7Context from "./chapters/Ch7Context";
import Ch8BeyondMVP from "./chapters/Ch8BeyondMVP";

const chapters = [
  {
    id: "ch1",
    num: 1,
    title: "The Policy Architecture",
    subtitle: "Policy as Agent Selection System",
    component: Ch1PolicyArchitecture,
    tag: "core",
  },
  {
    id: "ch2",
    num: 2,
    title: "Prompt Chaining",
    subtitle: "Implementation Patterns & Complexity",
    component: Ch2PromptChaining,
    tag: "core",
  },
  {
    id: "ch3",
    num: 3,
    title: "Queue: Agent Dispatch",
    subtitle: "Intra-Policy Selection & Work Units",
    component: Ch3QueueDispatch,
    tag: "queue",
  },
  {
    id: "ch4",
    num: 4,
    title: "Queue: Population Traversal",
    subtitle: "BFS, DFS & Hybrid Strategies",
    component: Ch4PopulationTraversal,
    tag: "queue",
  },
  {
    id: "ch5",
    num: 5,
    title: "Tool Use & Structured Output",
    subtitle: "LLM Client, Registry, Agent Loop",
    component: Ch5ToolUse,
    tag: "infra",
  },
  {
    id: "ch6",
    num: 6,
    title: "State & Idempotency",
    subtitle: "family_file Ops & Merge Logic",
    component: Ch6StateMgmt,
    tag: "infra",
  },
  {
    id: "ch7",
    num: 7,
    title: "Context Engineering",
    subtitle: "Window Budgets & Compaction",
    component: Ch7Context,
    tag: "infra",
  },
  {
    id: "ch8",
    num: 8,
    title: "Beyond MVP",
    subtitle: "Skill System & Population Learning",
    component: Ch8BeyondMVP,
    tag: "future",
  },
];

const tagColors: Record<string, string> = {
  core: "hsl(36 80% 56%)",
  queue: "hsl(160 30% 55%)",
  infra: "hsl(200 50% 60%)",
  future: "hsl(280 40% 60%)",
};

function AppInner() {
  const [activeChapter, setActiveChapter] = useState("ch1");
  const contentRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const ActiveComponent =
    chapters.find((c) => c.id === activeChapter)?.component ||
    Ch1PolicyArchitecture;
  const activeIdx = chapters.findIndex((c) => c.id === activeChapter);
  const activeChapterData = chapters[activeIdx];

  const {
    audioReady,
    availableSections,
    setSections,
    sections,
    playSectionFromBeginning,
    currentSectionId,
    isPlaying,
    togglePlayPause,
  } = useAudio();

  // After chapter renders: extract sections + wrap words for highlighting
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Small delay to ensure DOM is fully rendered
    const timer = setTimeout(() => {
      // Clear previous word wrapping
      clearWordWrapping(container);

      // Extract sections for this chapter
      const chNum = activeChapterData.num;
      const chSections = extractSectionsFromChapter(container, chNum, 0);

      // If we have audio, wrap words for highlighting
      if (audioReady) {
        const h2s = container.querySelectorAll("h2.heading-section");
        h2s.forEach((h2, idx) => {
          const sectionId = `ch${chNum}_s${idx}`;
          if (!availableSections.has(sectionId)) return;

          // Find the content between this h2 and the next h2
          let el = h2.nextElementSibling;
          const sectionContent: Element[] = [];
          while (el && el.tagName !== "H2") {
            sectionContent.push(el);
            el = el.nextElementSibling;
          }

          // Wrap words in each content element
          for (const contentEl of sectionContent) {
            if (contentEl instanceof HTMLElement) {
              wrapWordsInSection(contentEl, sectionId);
            }
          }
        });
      }

      // Update global sections list if not already populated
      if (sections.length === 0 && chSections.length > 0) {
        // We'd need all chapters for the full list, but for now set this chapter's sections
        setSections(chSections);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [activeChapter, audioReady, availableSections]); // eslint-disable-line

  // Get sections for current chapter
  const chapterSections = sections.filter(
    (s) => s.chapterId === activeChapterData.id,
  );
  // Also check availableSections directly for sections from this chapter
  const currentChapterHasAudio = Array.from(availableSections).some((id) =>
    id.startsWith(`ch${activeChapterData.num}_`),
  );

  // Scroll to top when changing chapters
  const handleChapterChange = useCallback((chId: string) => {
    setActiveChapter(chId);
    mainRef.current?.scrollTo(0, 0);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── SIDEBAR ── */}
      <aside
        className="w-[280px] flex-shrink-0 border-r flex-col sidebar-texture hidden md:flex"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-base)",
        }}
      >
        <div
          className="p-6 border-b brand-glow"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div
            className="heading-display text-xl"
            style={{ color: "var(--amber-bright)" }}
          >
            Architecture V1
          </div>
          <div
            className="mt-1.5"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.68rem",
              color: "var(--text-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Educational Reference
          </div>
          <div className="flex gap-1.5 mt-4">
            {chapters.map((_, i) => (
              <div
                key={i}
                className={`progress-dot ${i <= activeIdx ? "filled" : ""}`}
              />
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <nav className="p-3">
            {chapters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => handleChapterChange(ch.id)}
                className={`nav-item w-full text-left px-4 py-3 rounded-md mb-1 ${activeChapter === ch.id ? "active" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.7rem",
                      color:
                        activeChapter === ch.id
                          ? "var(--amber-bright)"
                          : "var(--text-muted)",
                      marginTop: 3,
                      opacity: activeChapter === ch.id ? 1 : 0.7,
                    }}
                  >
                    {ch.num.toString().padStart(2, "0")}
                  </span>
                  <div className="flex-1">
                    <span
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "0.85rem",
                        fontWeight: activeChapter === ch.id ? 600 : 500,
                        color:
                          activeChapter === ch.id
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                      }}
                    >
                      {ch.title}
                    </span>
                    <div
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "0.72rem",
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {ch.subtitle}
                    </div>
                  </div>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: tagColors[ch.tag],
                      marginTop: 6,
                      opacity: activeChapter === ch.id ? 1 : 0.3,
                    }}
                  />
                </div>
              </button>
            ))}
          </nav>
        </ScrollArea>

        {/* Audio setup in sidebar */}
        <div
          className="p-3 border-t"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <AudioSetupButton />
        </div>

        <div
          className="p-4 border-t"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.68rem",
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            MIT Family Tree Pipeline
            <br />
            Agent System Documentation
          </div>
        </div>
      </aside>

      {/* ── MOBILE HEADER ── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3"
        style={{
          background: "var(--bg-base)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "1rem",
              fontWeight: 700,
              color: "var(--amber-bright)",
            }}
          >
            Architecture V1
          </div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.65rem",
              color: "var(--text-muted)",
            }}
          >
            {activeChapterData.title}
          </div>
        </div>
        <div className="flex gap-2">
          <AudioSetupButton />
          {/* Mobile chapter selector */}
          <select
            value={activeChapter}
            onChange={(e) => handleChapterChange(e.target.value)}
            className="px-2 py-1 rounded-md text-xs"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-body)",
            }}
          >
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                Ch {ch.num}: {ch.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto pt-14 md:pt-0 pb-24"
        style={{ background: "var(--bg-deep)" }}
      >
        <div
          style={{
            height: 1,
            background: `linear-gradient(90deg, transparent 0%, ${tagColors[activeChapterData.tag]} 50%, transparent 100%)`,
            opacity: 0.3,
          }}
        />

        <div
          className="max-w-3xl mx-auto px-5 md:px-12 py-10 md:py-14 fade-in"
          key={activeChapter}
        >
          {/* Audio section player for this chapter */}
          {currentChapterHasAudio && (
            <div
              className="mb-8 p-4 rounded-lg"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Headphones
                  size={14}
                  style={{ color: "var(--amber-bright)" }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  Listen to Chapter {activeChapterData.num}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from(availableSections)
                  .filter((id) => id.startsWith(`ch${activeChapterData.num}_`))
                  .sort()
                  .map((sectionId, idx) => {
                    const section = sections.find((s) => s.id === sectionId);
                    const isActive = currentSectionId === sectionId;
                    const playing = isActive && isPlaying;
                    return (
                      <button
                        key={sectionId}
                        onClick={() => togglePlayPause(sectionId)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all"
                        style={{
                          background: playing
                            ? "var(--amber-glow)"
                            : "var(--bg-deep)",
                          border: `1px solid ${isActive ? "var(--amber-dim)" : "var(--border-subtle)"}`,
                          color: playing
                            ? "var(--amber-bright)"
                            : "var(--text-secondary)",
                          fontFamily: "var(--font-body)",
                          fontSize: "0.72rem",
                        }}
                      >
                        {playing ? (
                          <span
                            className="inline-block w-2 h-2 rounded-sm"
                            style={{ background: "var(--amber-bright)" }}
                          />
                        ) : (
                          <Play size={10} />
                        )}
                        {section?.title
                          ? section.title.slice(0, 30) +
                            (section.title.length > 30 ? "..." : "")
                          : `Section ${idx + 1}`}
                      </button>
                    );
                  })}
                {/* Play All button */}
                {Array.from(availableSections).filter((id) =>
                  id.startsWith(`ch${activeChapterData.num}_`),
                ).length > 1 && (
                  <button
                    onClick={() => {
                      const firstSection = Array.from(availableSections)
                        .filter((id) =>
                          id.startsWith(`ch${activeChapterData.num}_`),
                        )
                        .sort()[0];
                      if (firstSection) playSectionFromBeginning(firstSection);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md"
                    style={{
                      background: "var(--sage-faint)",
                      border: "1px solid var(--sage-dim)",
                      color: "var(--sage-bright)",
                      fontFamily: "var(--font-body)",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                    }}
                  >
                    <Play size={10} /> Play All
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Chapter content */}
          <div ref={contentRef}>
            <ActiveComponent />
          </div>

          {/* Chapter navigation footer */}
          <div
            className="flex justify-between items-center mt-16 pt-6"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            {activeIdx > 0 ? (
              <button
                onClick={() => handleChapterChange(chapters[activeIdx - 1].id)}
                className="code-toggle-btn flex items-center gap-2"
              >
                <span>←</span> {chapters[activeIdx - 1].title}
              </button>
            ) : (
              <div />
            )}
            {activeIdx < chapters.length - 1 ? (
              <button
                onClick={() => handleChapterChange(chapters[activeIdx + 1].id)}
                className="code-toggle-btn flex items-center gap-2"
              >
                {chapters[activeIdx + 1].title} <span>→</span>
              </button>
            ) : (
              <div />
            )}
          </div>
        </div>
      </main>

      {/* ── AUDIO OVERLAYS ── */}
      <AudioGeneratorModal />
      <AudioPlayerBar />
    </div>
  );
}

export default function App() {
  return (
    <AudioProvider>
      <AppInner />
    </AudioProvider>
  );
}
