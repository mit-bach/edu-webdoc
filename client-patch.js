// ─── Client Patch: Local Dev Server Integration ───
// This script is injected by server.js into arch-v1-edu.html at runtime.
// It overrides the compiled-in TTS generation to route through the local
// server API, which saves .mp3 files directly to the project's audio/ folder.
// The OpenAI API key stays server-side — never entered in the browser.

(function () {
  "use strict";

  // ─── State ───
  let _serverReady = false;
  let _apiKeyConfigured = false;

  // ─── Detect local dev server ───
  async function checkServer() {
    try {
      const resp = await fetch("/api/status", { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        const data = await resp.json();
        if (data.mode === "local") {
          _serverReady = true;
          _apiKeyConfigured = data.apiKeyConfigured;
          console.log(
            "%c[Dev Server] %cConnected — API key " +
              (_apiKeyConfigured ? "✓ configured" : "✗ missing"),
            "color: #7cb342; font-weight: bold",
            "color: inherit"
          );
          patchUI();
          return;
        }
      }
    } catch {
      // Not on local server
    }
    console.log(
      "%c[Dev Server] %cNot detected — using default static mode",
      "color: #888; font-weight: bold",
      "color: inherit"
    );
  }

  // ─── Load available audio from server's file system ───
  async function loadServerAudioList() {
    try {
      const resp = await fetch("/api/audio");
      if (resp.ok) {
        const data = await resp.json();
        return data.sections || [];
      }
    } catch {}
    return [];
  }

  // ─── Generate TTS via server ───
  async function serverGenerateTTS(sectionId, text, words, voice) {
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, text, words, voice }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `Server TTS error ${resp.status}`);
    }
    return resp.json();
  }

  // ─── Clear audio via server ───
  async function serverClearAudio() {
    await fetch("/api/audio", { method: "DELETE" });
  }

  // ─── Patch the UI ───
  // We observe the DOM for the generator modal and patch it when it appears.
  function patchUI() {
    // Patch the generator modal whenever it opens
    const observer = new MutationObserver(() => {
      patchGeneratorModal();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also run immediately in case modal is already open
    patchGeneratorModal();

    // Override audio availability check — also look at server files
    overrideAvailabilityCheck();
  }

  function patchGeneratorModal() {
    // Find the modal by its structure: a fixed overlay containing "Audiobook Setup"
    const modals = document.querySelectorAll(".fixed.inset-0.z-50");
    if (modals.length === 0) return;

    const modal = modals[modals.length - 1];

    // Always re-run patchAdvancedSettings since it may appear later when
    // the user expands the accordion. Only skip the one-time patches.
    const body = modal.querySelector(".p-5.space-y-4");
    patchAdvancedSettings(body);

    if (modal.dataset.patched === "true") return;
    modal.dataset.patched = "true";

    // ── Update subtitle ──
    const subtitle = modal.querySelector("p");
    if (subtitle && subtitle.textContent.includes("Generate narration")) {
      subtitle.textContent = "Generate narration via local server — files saved to project";
    }

    // ── Add mode indicator ──
    if (body && !body.querySelector(".dev-mode-indicator")) {
      const indicator = document.createElement("div");
      indicator.className = "dev-mode-indicator flex items-center gap-2 px-3 py-2 rounded-md";
      indicator.style.cssText =
        "background: var(--sage-faint, rgba(120,180,120,0.1)); border: 1px solid var(--sage-dim, rgba(120,180,120,0.3)); margin-bottom: 8px;";
      indicator.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--sage-bright, #7cb342);">
          <rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 7h.01M17 7h.01M12 7h.01M7 12h.01M17 12h.01M12 12h.01M7 17h.01M17 17h.01M12 17h.01"/>
        </svg>
        <span style="font-family: var(--font-body, sans-serif); font-size: 0.75rem; color: var(--sage-bright, #7cb342);">
          Local dev server detected — audio files will be saved to <code style="font-size: 0.72rem;">audio/</code> folder
          ${_apiKeyConfigured ? "" : '<br><strong style="color: var(--rose-bright, #e57373);">⚠ OPENAI_API_KEY not set in .env</strong>'}
        </span>
      `;
      body.insertBefore(indicator, body.firstChild);
    }

    // ── Hide the API key input ──
    const inputs = body ? body.querySelectorAll("input[type=password]") : [];
    inputs.forEach((input) => {
      const wrapper = input.closest("div");
      if (wrapper && wrapper.querySelector('label')) {
        wrapper.style.display = "none";
      }
    });

    // ── Update the voice list — replace old voices with new ones ──
    patchVoiceList(body);

    // ── Update advanced settings text ──
    patchAdvancedSettings(body);

    // ── Hijack the Generate button ──
    patchGenerateButton(modal, body);

    // ── Hide Download Pack (files are already on disk) ──
    const footer = modal.querySelector(".border-t:last-child");
    if (footer) {
      const downloadBtn = Array.from(footer.querySelectorAll("button")).find(
        (b) => b.textContent.includes("Download")
      );
      if (downloadBtn) downloadBtn.style.display = "none";
    }
  }

  // ── Voice list patch ──
  const NEW_VOICES = [
    { id: "nova", name: "Nova", desc: "Warm, natural female" },
    { id: "alloy", name: "Alloy", desc: "Balanced, neutral" },
    { id: "echo", name: "Echo", desc: "Warm male" },
    { id: "fable", name: "Fable", desc: "Expressive, British" },
    { id: "marin", name: "Marin", desc: "Smooth, calm" },
    { id: "cedar", name: "Cedar", desc: "Grounded, rich" },
  ];

  let _selectedVoice = "nova";

  function patchVoiceList(body) {
    if (!body) return;
    // Find the voice grid
    const grids = body.querySelectorAll(".grid.grid-cols-3");
    if (grids.length === 0) return;

    const grid = grids[0];
    if (grid.dataset.voicePatched === "true") return;
    grid.dataset.voicePatched = "true";

    // Replace grid contents
    grid.innerHTML = "";
    NEW_VOICES.forEach((v) => {
      const btn = document.createElement("button");
      btn.className = "px-3 py-2 rounded-md text-left transition-colors";
      btn.dataset.voiceId = v.id;

      const updateStyle = (selected) => {
        btn.style.cssText = selected
          ? "background: var(--amber-glow); border: 1px solid var(--amber-dim);"
          : "background: var(--bg-deep); border: 1px solid var(--border-subtle);";
      };

      updateStyle(v.id === _selectedVoice);

      btn.innerHTML = `
        <div style="font-family: var(--font-body, sans-serif); font-size: 0.8rem; font-weight: 600; color: ${
          v.id === _selectedVoice ? "var(--amber-bright)" : "var(--text-primary)"
        };">${v.name}</div>
        <div style="font-family: var(--font-body, sans-serif); font-size: 0.65rem; color: var(--text-muted);">${v.desc}</div>
      `;

      btn.addEventListener("click", () => {
        _selectedVoice = v.id;
        // Update all voice buttons
        grid.querySelectorAll("button").forEach((b) => {
          const sel = b.dataset.voiceId === v.id;
          b.style.cssText = sel
            ? "background: var(--amber-glow); border: 1px solid var(--amber-dim);"
            : "background: var(--bg-deep); border: 1px solid var(--border-subtle);";
          b.querySelector("div").style.color = sel
            ? "var(--amber-bright)"
            : "var(--text-primary)";
        });
      });

      grid.appendChild(btn);
    });
  }

  // ── Advanced settings patch ──
  function patchAdvancedSettings(body) {
    if (!body) return;
    const advancedDivs = body.querySelectorAll(".rounded-md");
    advancedDivs.forEach((div) => {
      const p = div.querySelector("p");
      if (p && p.textContent.includes("tts-1")) {
        p.innerHTML = `
          <strong style="color: var(--text-secondary);">Cost estimate:</strong> ~24,000 words × ~$0.015/1K chars ≈ $1.50-3.00 total.
          Uses <code class="code-inline">gpt-4o-mini-tts-2025-12-15</code> model.
          Audio is saved as .mp3 files in the <code class="code-inline">audio/</code> directory of your project.
          These files can be committed and deployed to GitHub Pages.
        `;
      }
    });
  }

  // ── Generate button hijack ──
  function patchGenerateButton(modal, body) {
    // Find the generate button (contains "Generate All Audio")
    const footer = modal.querySelector(".border-t:last-child") || modal.querySelector(".p-5.border-t");
    if (!footer) return;

    const genBtn = Array.from(footer.querySelectorAll("button")).find(
      (b) => b.textContent.includes("Generate All Audio") || b.textContent.includes("Cancel")
    );
    if (!genBtn || genBtn.dataset.hijacked === "true") return;
    genBtn.dataset.hijacked = "true";

    // Clone to strip old event listeners
    const newBtn = genBtn.cloneNode(true);
    genBtn.parentNode.replaceChild(newBtn, genBtn);

    let _generating = false;
    let _abort = false;

    newBtn.addEventListener("click", async () => {
      if (_generating) {
        _abort = true;
        return;
      }

      if (!_apiKeyConfigured) {
        showError(body, "OPENAI_API_KEY not set. Add it to your .env file and restart the server.");
        return;
      }

      _generating = true;
      _abort = false;
      newBtn.innerHTML = `<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Cancel`;
      newBtn.style.cssText =
        "background: var(--rose-faint); color: var(--rose-bright); border: 1px solid var(--rose-bright); display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 6px; font-family: var(--font-body); font-size: 0.85rem; font-weight: 500; cursor: pointer;";

      clearError(body);

      try {
        // Step 1: Extract sections by switching through chapters
        const navButtons = document.querySelectorAll("nav button");
        const CHAPTERS = [
          { num: 1 }, { num: 2 }, { num: 3 }, { num: 4 },
          { num: 5 }, { num: 6 }, { num: 7 }, { num: 8 },
        ];

        const allSections = [];
        let globalOffset = 0;

        showProgress(body, 0, CHAPTERS.length, "Extracting chapter text...");

        for (let chIdx = 0; chIdx < CHAPTERS.length; chIdx++) {
          if (_abort) break;

          const btn = navButtons[chIdx];
          if (btn) {
            btn.click();
            await sleep(200);
          }

          const article = document.querySelector("main article.prose-body") ||
                          document.querySelector("main .prose-body") ||
                          document.querySelector("main > div > div");
          if (!article) continue;

          const chSections = extractSections(article, CHAPTERS[chIdx].num, globalOffset);
          globalOffset += chSections.length;
          allSections.push(...chSections);
        }

        if (allSections.length === 0) {
          showError(body, "Could not extract any sections from the chapters. Check the DOM structure.");
          return;
        }

        // Step 2: Generate via server
        for (let i = 0; i < allSections.length; i++) {
          if (_abort) break;

          const section = allSections[i];
          showProgress(
            body,
            i + 1,
            allSections.length,
            `Ch${section.chapterId.replace("ch", "")} — ${section.title.slice(0, 40)}...`
          );

          try {
            await serverGenerateTTS(section.id, section.text, section.words, _selectedVoice);
          } catch (e) {
            const msg = e.message || String(e);
            console.error(`Failed ${section.id}:`, msg);

            if (msg.includes("401") || msg.includes("Invalid") || msg.includes("API_KEY")) {
              showError(body, "Server API key issue. Check OPENAI_API_KEY in your .env file.");
              break;
            }
            if (msg.includes("429")) {
              showProgress(body, i + 1, allSections.length, "Rate limited, waiting 30s...");
              await sleep(30000);
              i--; // retry
              continue;
            }
            // Continue with next section on other errors
          }
        }

        // Navigate back to ch1
        if (!_abort && navButtons[0]) {
          navButtons[0].click();
        }

        // Refresh the page to pick up new audio files
        if (!_abort) {
          showProgress(body, allSections.length, allSections.length, "Done! Reloading to pick up audio...");
          await sleep(1500);
          window.location.reload();
        }
      } catch (e) {
        showError(body, e.message || "Generation failed");
      } finally {
        _generating = false;
        newBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg> Generate All Audio`;
        newBtn.style.cssText =
          "background: var(--amber-bright); color: var(--bg-deep); border: none; display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 6px; font-family: var(--font-body); font-size: 0.85rem; font-weight: 500; cursor: pointer;";
        hideProgress(body);
      }
    });
  }

  // ─── Section extraction (mirrors tts.ts logic) ───

  function extractSections(container, chapterNum, globalOffset) {
    const sections = [];
    const chapterId = `ch${chapterNum}`;
    const allChildren = Array.from(container.children);
    const h2Indices = [];

    allChildren.forEach((el, i) => {
      if (el.tagName === "H2") h2Indices.push(i);
    });

    // Intro before first h2
    if (h2Indices.length > 0 && h2Indices[0] > 0) {
      const introEls = allChildren.slice(0, h2Indices[0]);
      const text = extractText(introEls);
      if (text.length > 30) {
        sections.push({
          id: `${chapterId}_intro`,
          chapterId,
          title: "Introduction",
          text,
          words: text.split(/\s+/).filter((w) => w.length > 0),
          order: globalOffset + sections.length,
        });
      }
    }

    h2Indices.forEach((h2Idx, i) => {
      const nextH2Idx = i + 1 < h2Indices.length ? h2Indices[i + 1] : allChildren.length;
      const sectionEls = allChildren.slice(h2Idx, nextH2Idx);
      const title = (sectionEls[0] && sectionEls[0].textContent || "").trim() || "Untitled";
      const text = extractText(sectionEls);
      const words = text.split(/\s+/).filter((w) => w.length > 0);

      if (words.length > 5) {
        sections.push({
          id: `${chapterId}_s${i}`,
          chapterId,
          title,
          text,
          words,
          order: globalOffset + sections.length,
        });
      }
    });

    return sections;
  }

  function extractText(elements) {
    const parts = [];
    for (const el of elements) {
      const tag = el.tagName;
      if (
        el.classList.contains("code-block") ||
        el.classList.contains("code-toggle-btn") ||
        el.classList.contains("diagram-container") ||
        el.classList.contains("flow-step") ||
        el.classList.contains("stat-row") ||
        el.classList.contains("section-divider") ||
        tag === "SVG" ||
        tag === "TABLE"
      ) continue;
      if (el.querySelector && el.querySelector(".code-block")) continue;

      if (tag === "H2" || tag === "H3") {
        parts.push((el.textContent || "").trim() + ".");
      } else if (tag === "P") {
        parts.push((el.textContent || "").trim());
      } else if (tag === "UL" || tag === "OL") {
        el.querySelectorAll("li").forEach((li) => parts.push((li.textContent || "").trim()));
      } else if (el.classList.contains("callout") || el.classList.contains("pull-quote")) {
        parts.push((el.textContent || "").trim());
      } else if (tag === "DIV") {
        const inner = extractText(Array.from(el.children));
        if (inner) parts.push(inner);
      }
    }
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  // ─── UI Helpers ───

  function showProgress(body, current, total, label) {
    if (!body) return;
    let bar = body.querySelector(".server-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "server-progress space-y-2";
      bar.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="progress-label" style="font-family: var(--font-body); font-size: 0.78rem; color: var(--text-secondary);"></span>
          <span class="progress-count" style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--amber-bright);"></span>
        </div>
        <div style="width: 100%; height: 8px; border-radius: 9999px; overflow: hidden; background: var(--bg-deep);">
          <div class="progress-fill" style="height: 100%; border-radius: 9999px; transition: width 0.3s; background: var(--amber-bright);"></div>
        </div>
      `;
      body.appendChild(bar);
    }
    bar.querySelector(".progress-label").textContent = label;
    bar.querySelector(".progress-count").textContent = `${current}/${total}`;
    bar.querySelector(".progress-fill").style.width = `${total ? (current / total) * 100 : 0}%`;
  }

  function hideProgress(body) {
    if (!body) return;
    const bar = body.querySelector(".server-progress");
    if (bar) bar.remove();
  }

  function showError(body, msg) {
    if (!body) return;
    clearError(body);
    const el = document.createElement("div");
    el.className = "server-error p-3 rounded-md";
    el.style.cssText =
      "background: var(--rose-faint); border: 1px solid var(--rose-bright); color: var(--rose-bright); font-family: var(--font-body); font-size: 0.8rem;";
    el.textContent = msg;
    body.appendChild(el);
  }

  function clearError(body) {
    if (!body) return;
    const el = body.querySelector(".server-error");
    if (el) el.remove();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─── Override availability to check server files ───
  function overrideAvailabilityCheck() {
    // Poll server for audio files and update the app's knowledge of available sections
    async function checkAndUpdate() {
      const ids = await loadServerAudioList();
      if (ids.length === 0) return;

      // The app uses IndexedDB to track availability. We also need to make
      // the static /audio/*.mp3 files work for playback. The existing code
      // already has tryLoadStaticAudio that fetches /audio/{id}.mp3.
      // We just need to tell the app these sections are available.

      // Try to trigger the app's availability refresh by dispatching an event
      // or by adding entries to IndexedDB
      const DB_NAME = "archv1_audio";
      const STORE = "sections";

      try {
        const dbReq = indexedDB.open(DB_NAME, 1);
        dbReq.onupgradeneeded = () => {
          const db = dbReq.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "id" });
          }
        };
        dbReq.onsuccess = () => {
          const db = dbReq.result;

          // For each server audio file, check if it exists in IndexedDB
          // If not, create a minimal entry so the app sees it as available
          for (const id of ids) {
            const tx = db.transaction(STORE, "readonly");
            const getReq = tx.objectStore(STORE).get(id);
            getReq.onsuccess = async () => {
              if (getReq.result) return; // Already in IndexedDB

              // Load the static file and store it
              try {
                const resp = await fetch(`/audio/${id}.mp3`);
                if (!resp.ok) return;
                const blob = await resp.blob();

                // Convert to base64
                const reader = new FileReader();
                reader.onload = () => {
                  const base64 = reader.result;

                  // Get duration
                  const audioEl = new Audio();
                  const url = URL.createObjectURL(blob);
                  audioEl.preload = "metadata";
                  audioEl.onloadedmetadata = () => {
                    let dur = audioEl.duration;
                    URL.revokeObjectURL(url);
                    if (!isFinite(dur)) dur = blob.size / (128 * 128);

                    // Store in IndexedDB
                    const wtx = db.transaction(STORE, "readwrite");
                    wtx.objectStore(STORE).put({
                      id,
                      audioBase64: base64,
                      duration: dur,
                      wordTimings: [],
                      text: "",
                      words: [],
                    });
                  };
                  audioEl.src = url;
                };
                reader.readAsDataURL(blob);
              } catch {}
            };
          }
        };
      } catch {}
    }

    // Run once after a short delay (let the app initialize first)
    setTimeout(checkAndUpdate, 1000);
  }

  // ─── Init ───
  checkServer();
})();
