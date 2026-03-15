// ─── Client Patch: Local Dev Server Integration ───
// This script is injected by server.js into index.html at runtime.
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
      const resp = await fetch("/api/status", {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.mode === "local") {
          _serverReady = true;
          _apiKeyConfigured = data.apiKeyConfigured;
          if (data.defaultVoice) _selectedVoice = data.defaultVoice;
          if (data.defaultInstructions)
            _selectedInstructions = data.defaultInstructions;
          console.log(
            "%c[Dev Server] %cConnected — API key " +
              (_apiKeyConfigured ? "✓ configured" : "✗ missing"),
            "color: #7cb342; font-weight: bold",
            "color: inherit",
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
      "color: inherit",
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
  async function serverGenerateTTS(
    sectionId,
    text,
    words,
    voice,
    instructions,
  ) {
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectionId,
        text,
        words,
        voice,
        instructions: instructions || _selectedInstructions || undefined,
      }),
    });
    if (!resp.ok) {
      const err = await resp
        .json()
        .catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `Server TTS error ${resp.status}`);
    }
    return resp.json();
  }

  // ─── Clear audio via server ───
  async function serverClearAudio() {
    await fetch("/api/audio", { method: "DELETE" });
  }

  // ─── Path helpers ───
  // Converts sectionId to subfolder URL: "ch1_s0" → "/audio/ch1/s0.mp3"
  function sectionIdToAudioUrl(sectionId) {
    var idx = sectionId.indexOf("_");
    if (idx < 0) return "/audio/" + sectionId + ".mp3";
    return (
      "/audio/" +
      sectionId.slice(0, idx) +
      "/" +
      sectionId.slice(idx + 1) +
      ".mp3"
    );
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

    // Persist active chapter in URL hash
    patchChapterPersistence();
  }

  // ─── Chapter persistence via URL hash ───

  const VALID_CHAPTERS = [
    "ch1",
    "ch2",
    "ch3",
    "ch4",
    "ch5",
    "ch6",
    "ch7",
    "ch8",
  ];

  function patchChapterPersistence() {
    const navButtons = document.querySelectorAll("nav button");
    if (navButtons.length === 0) return;

    // On nav click → update hash
    navButtons.forEach((btn, idx) => {
      btn.addEventListener("click", () => {
        const chId = VALID_CHAPTERS[idx];
        if (chId) {
          // Use replaceState to avoid polluting history on every click
          // (hashchange listener handles back/forward separately)
          history.replaceState(null, "", "#" + chId);
        }
      });
    });

    // On load → restore from hash
    restoreChapterFromHash(navButtons);

    // On back/forward → navigate to the hash chapter
    window.addEventListener("hashchange", () => {
      restoreChapterFromHash(navButtons);
    });
  }

  function restoreChapterFromHash(navButtons) {
    const hash = location.hash.replace("#", "");
    const idx = VALID_CHAPTERS.indexOf(hash);
    if (idx >= 0 && navButtons[idx]) {
      // Small delay to let React finish mounting on initial load
      setTimeout(() => {
        navButtons[idx].click();
        // Re-set the hash since the click handler uses replaceState
        history.replaceState(null, "", "#" + hash);
      }, 150);
    }
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
      subtitle.textContent =
        "Generate narration via local server — files saved to project";
    }

    // ── Add mode indicator ──
    if (body && !body.querySelector(".dev-mode-indicator")) {
      const indicator = document.createElement("div");
      indicator.className =
        "dev-mode-indicator flex items-center gap-2 px-3 py-2 rounded-md";
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
      if (wrapper && wrapper.querySelector("label")) {
        wrapper.style.display = "none";
      }
    });

    // ── Update the voice list — replace old voices with new ones ──
    patchVoiceList(body);

    // ── Add TTS instructions panel ──
    patchInstructionsPanel(body);

    // ── Update advanced settings text ──
    patchAdvancedSettings(body);

    // ── Hijack the Generate button ──
    patchGenerateButton(modal, body);

    // ── Hide Download Pack (files are already on disk) ──
    const footer = modal.querySelector(".border-t:last-child");
    if (footer) {
      const downloadBtn = Array.from(footer.querySelectorAll("button")).find(
        (b) => b.textContent.includes("Download"),
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

  let _selectedVoice = "cedar";
  let _selectedInstructions = "";

  // ── Instruction presets for this project ──
  const INSTRUCTION_PRESETS = [
    {
      id: "none",
      name: "None",
      desc: "No instructions — default TTS behavior",
      text: "",
    },
    {
      id: "professor",
      name: "Professor",
      desc: "Clear, measured academic lecture",
      text: "Read as a knowledgeable computer science professor explaining a system architecture to graduate students. Use a clear, measured pace. Emphasize key technical terms and design decisions. Pause briefly before introducing new concepts.",
    },
    {
      id: "podcast",
      name: "Podcast Host",
      desc: "Engaging technical deep-dive",
      text: "Read as a knowledgeable podcast host doing a technical deep-dive on software architecture. Use an engaging yet scholarly tone. Flow naturally between sections with brief transitional pauses, emphasizing design trade-offs and implications.",
    },
    {
      id: "narrator",
      name: "Audiobook",
      desc: "Calm, focused narration",
      text: "Read in a calm, focused audiobook narration style. Maintain a steady pace suitable for technical content. Give slight emphasis to code references and architectural terms. Keep transitions smooth between paragraphs.",
    },
    {
      id: "mentor",
      name: "Senior Engineer",
      desc: "Practical, opinionated mentor",
      text: "Read as a senior engineer mentoring a junior developer through a codebase walkthrough. Be direct and practical. Emphasize why decisions were made, not just what they are. Use a conversational but authoritative tone.",
    },
    {
      id: "custom",
      name: "Custom",
      desc: "Write your own instructions",
      text: null, // signals "use the textarea value"
    },
  ];

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
          v.id === _selectedVoice
            ? "var(--amber-bright)"
            : "var(--text-primary)"
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

  // ── Instructions panel ──
  function patchInstructionsPanel(body) {
    if (!body) return;
    if (body.querySelector(".instructions-panel")) return;

    const panel = document.createElement("div");
    panel.className = "instructions-panel";
    panel.style.cssText = "margin-top: 12px;";

    // Label
    const label = document.createElement("div");
    label.style.cssText =
      "font-family: var(--font-body, sans-serif); font-size: 0.78rem; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;";
    label.textContent = "Voice Instructions";
    panel.appendChild(label);

    const sublabel = document.createElement("div");
    sublabel.style.cssText =
      "font-family: var(--font-body, sans-serif); font-size: 0.68rem; color: var(--text-muted); margin-bottom: 10px;";
    sublabel.textContent =
      "Guide the TTS voice style, tone, and delivery. Use presets or write custom instructions.";
    panel.appendChild(sublabel);

    // Preset buttons row
    const presetRow = document.createElement("div");
    presetRow.style.cssText =
      "display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;";

    INSTRUCTION_PRESETS.forEach((preset) => {
      const btn = document.createElement("button");
      btn.dataset.presetId = preset.id;
      btn.style.cssText = presetBtnStyle(preset.id === "none"); // "none" is default active
      btn.innerHTML = `
        <div style="font-family: var(--font-body, sans-serif); font-size: 0.72rem; font-weight: 600;">${preset.name}</div>
        <div style="font-family: var(--font-body, sans-serif); font-size: 0.6rem; color: var(--text-muted);">${preset.desc}</div>
      `;

      btn.addEventListener("click", () => {
        // Update active states
        presetRow.querySelectorAll("button").forEach((b) => {
          b.style.cssText = presetBtnStyle(b.dataset.presetId === preset.id);
          b.querySelector("div").style.color =
            b.dataset.presetId === preset.id
              ? "var(--amber-bright)"
              : "var(--text-primary)";
        });

        if (preset.id === "custom") {
          textarea.style.display = "block";
          textarea.focus();
          _selectedInstructions = textarea.value;
        } else {
          textarea.style.display = preset.id === "none" ? "none" : "block";
          textarea.value = preset.text || "";
          _selectedInstructions = preset.text || "";
        }
      });

      presetRow.appendChild(btn);
    });
    panel.appendChild(presetRow);

    // Custom textarea
    const textarea = document.createElement("textarea");
    textarea.placeholder =
      "e.g. Read as a calm narrator explaining technical architecture...";
    textarea.style.cssText =
      "display: none; width: 100%; min-height: 80px; padding: 10px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-deep); color: var(--text-primary); font-family: var(--font-body, sans-serif); font-size: 0.78rem; resize: vertical; outline: none; box-sizing: border-box;";
    textarea.addEventListener("input", () => {
      _selectedInstructions = textarea.value;
    });
    textarea.addEventListener("focus", () => {
      textarea.style.borderColor = "var(--amber-dim)";
    });
    textarea.addEventListener("blur", () => {
      textarea.style.borderColor = "var(--border-subtle)";
    });
    panel.appendChild(textarea);

    // Insert after the voice grid
    const voiceGrid = body.querySelector(".grid.grid-cols-3");
    if (voiceGrid && voiceGrid.parentNode) {
      voiceGrid.parentNode.insertBefore(panel, voiceGrid.nextSibling);
    } else {
      body.appendChild(panel);
    }
  }

  function presetBtnStyle(active) {
    return active
      ? "background: var(--amber-glow); border: 1px solid var(--amber-dim); padding: 6px 10px; border-radius: 6px; text-align: left; cursor: pointer; min-width: 100px; flex: 1;"
      : "background: var(--bg-deep); border: 1px solid var(--border-subtle); padding: 6px 10px; border-radius: 6px; text-align: left; cursor: pointer; min-width: 100px; flex: 1;";
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
    const footer =
      modal.querySelector(".border-t:last-child") ||
      modal.querySelector(".p-5.border-t");
    if (!footer) return;

    const genBtn = Array.from(footer.querySelectorAll("button")).find(
      (b) =>
        b.textContent.includes("Generate All Audio") ||
        b.textContent.includes("Cancel"),
    );
    if (!genBtn || genBtn.dataset.hijacked === "true") return;
    genBtn.dataset.hijacked = "true";

    // Clone to strip old event listeners
    const newBtn = genBtn.cloneNode(true);
    genBtn.parentNode.replaceChild(newBtn, genBtn);

    // ── Add "Test One Section" button ──
    if (!footer.querySelector(".test-one-btn")) {
      const testBtn = document.createElement("button");
      testBtn.className =
        "test-one-btn flex items-center gap-2 px-4 py-2.5 rounded-md font-medium transition-colors";
      testBtn.style.cssText =
        "background: var(--bg-deep); color: var(--text-secondary); border: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 6px; font-family: var(--font-body); font-size: 0.82rem; font-weight: 500; cursor: pointer; margin-right: 8px;";
      testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Test One Section`;
      newBtn.parentNode.insertBefore(testBtn, newBtn);

      testBtn.addEventListener("click", () =>
        handleTestOneSection(body, testBtn),
      );
    }

    // ── Update button text to "Generate This Chapter" ──
    newBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg> Generate This Chapter`;

    let _generating = false;
    let _abort = false;

    newBtn.addEventListener("click", async () => {
      if (_generating) {
        _abort = true;
        return;
      }

      if (!_apiKeyConfigured) {
        showError(
          body,
          "OPENAI_API_KEY not set. Add it to your .env file and restart the server.",
        );
        return;
      }

      _generating = true;
      _abort = false;
      newBtn.innerHTML = `<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Cancel`;
      newBtn.style.cssText =
        "background: var(--rose-faint); color: var(--rose-bright); border: 1px solid var(--rose-bright); display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 6px; font-family: var(--font-body); font-size: 0.85rem; font-weight: 500; cursor: pointer;";

      clearError(body);

      try {
        // Extract sections from the currently visible chapter only
        const article =
          document.querySelector("main article.prose-body") ||
          document.querySelector("main .prose-body") ||
          document.querySelector("main > div > div");
        if (!article) throw new Error("Cannot find chapter content in DOM");

        const activeChapterNum = detectActiveChapter();
        const chapterSections = extractSections(article, activeChapterNum, 0);

        if (chapterSections.length === 0) {
          showError(body, "No sections found in the current chapter.");
          return;
        }

        showProgress(
          body,
          0,
          chapterSections.length,
          `Generating Ch${activeChapterNum} (${chapterSections.length} sections)...`,
        );

        for (let i = 0; i < chapterSections.length; i++) {
          if (_abort) break;

          const section = chapterSections[i];
          showProgress(
            body,
            i + 1,
            chapterSections.length,
            `Ch${activeChapterNum} — ${section.title.slice(0, 40)}...`,
          );

          try {
            await serverGenerateTTS(
              section.id,
              section.text,
              section.words,
              _selectedVoice,
            );
          } catch (e) {
            const msg = e.message || String(e);
            console.error(`Failed ${section.id}:`, msg);

            if (
              msg.includes("401") ||
              msg.includes("Invalid") ||
              msg.includes("API_KEY")
            ) {
              showError(
                body,
                "Server API key issue. Check OPENAI_API_KEY in your .env file.",
              );
              break;
            }
            if (msg.includes("429")) {
              showProgress(
                body,
                i + 1,
                chapterSections.length,
                "Rate limited, waiting 30s...",
              );
              await sleep(30000);
              i--; // retry
              continue;
            }
          }
        }

        if (!_abort) {
          showProgress(
            body,
            chapterSections.length,
            chapterSections.length,
            `Ch${activeChapterNum} done! Reloading...`,
          );
          await sleep(1500);
          // Preserve current chapter in hash before reload
          history.replaceState(null, "", "#ch" + activeChapterNum);
          window.location.reload();
        }
      } catch (e) {
        showError(body, e.message || "Generation failed");
      } finally {
        _generating = false;
        newBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg> Generate This Chapter`;
        newBtn.style.cssText =
          "background: var(--amber-bright); color: var(--bg-deep); border: none; display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 6px; font-family: var(--font-body); font-size: 0.85rem; font-weight: 500; cursor: pointer;";
        hideProgress(body);
      }
    });
  }

  // ─── Detect which chapter is currently active ───

  function detectActiveChapter() {
    const navButtons = document.querySelectorAll("nav button");
    // Look for the active nav button
    const activeNav =
      document.querySelector("nav button.active") ||
      document.querySelector("nav .active");
    if (activeNav) {
      const btn = activeNav.closest("button") || activeNav;
      const idx = Array.from(navButtons).indexOf(btn);
      if (idx >= 0) return idx + 1;
    }
    // Fallback: check for visual active state (font-weight 600)
    for (let i = 0; i < navButtons.length; i++) {
      const spans = navButtons[i].querySelectorAll("span");
      for (const span of spans) {
        const fw = window.getComputedStyle(span).fontWeight;
        if (fw === "600" || fw === "bold" || fw === "700") return i + 1;
      }
    }
    return 1; // default to chapter 1
  }

  // ─── Test One Section handler ───

  async function handleTestOneSection(body, testBtn) {
    if (!_apiKeyConfigured) {
      showError(
        body,
        "OPENAI_API_KEY not set. Add it to your .env file and restart the server.",
      );
      return;
    }

    clearError(body);
    const origHTML = testBtn.innerHTML;
    testBtn.innerHTML = `<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Testing...`;
    testBtn.disabled = true;
    testBtn.style.opacity = "0.6";

    try {
      // Extract sections from the currently visible chapter only (no switching)
      const article =
        document.querySelector("main article.prose-body") ||
        document.querySelector("main .prose-body") ||
        document.querySelector("main > div > div");
      if (!article) throw new Error("Cannot find chapter content in DOM");

      const activeChapterNum = detectActiveChapter();
      const sections = extractSections(article, activeChapterNum, 0);
      if (sections.length === 0) {
        throw new Error(
          "No sections found in the current chapter. Try navigating to a chapter first.",
        );
      }

      // Pick the first section
      const section = sections[0];
      showProgress(
        body,
        1,
        1,
        `Testing: ${section.id} — "${section.title.slice(0, 50)}..."`,
      );

      const result = await serverGenerateTTS(
        section.id,
        section.text,
        section.words,
        _selectedVoice,
      );

      hideProgress(body);

      // Show success with details
      const successEl = document.createElement("div");
      successEl.className = "server-test-result p-3 rounded-md";
      successEl.style.cssText =
        "background: var(--sage-faint, rgba(120,180,120,0.1)); border: 1px solid var(--sage-dim, rgba(120,180,120,0.3)); color: var(--sage-bright, #7cb342); font-family: var(--font-body); font-size: 0.8rem; margin-top: 8px;";
      const fileSizeKB = result.fileSize
        ? (result.fileSize / 1024).toFixed(1)
        : "?";
      successEl.innerHTML = `
        <strong>Test passed!</strong><br>
        <span style="font-size: 0.72rem; color: var(--text-muted);">
          Section: <code>${section.id}</code> — "${section.title}"<br>
          File: audio/${section.id}.mp3 (${fileSizeKB} KB)<br>
          Voice: ${_selectedVoice} — Duration: ~${result.duration ? result.duration.toFixed(1) : "?"}s<br>
          Instructions: ${_selectedInstructions ? '"' + _selectedInstructions.slice(0, 60) + (_selectedInstructions.length > 60 ? "..." : "") + '"' : "<em>none</em>"}<br>
          Words extracted: ${section.words.length}
        </span>
        <div style="margin-top: 8px;">
          <audio controls src="${sectionIdToAudioUrl(section.id)}" style="width: 100%; height: 36px;" preload="auto"></audio>
        </div>
      `;

      // Remove any previous test result
      const prev = body.querySelector(".server-test-result");
      if (prev) prev.remove();
      body.appendChild(successEl);
    } catch (e) {
      hideProgress(body);
      showError(body, "Test failed: " + (e.message || String(e)));
    } finally {
      testBtn.innerHTML = origHTML;
      testBtn.disabled = false;
      testBtn.style.opacity = "1";
    }
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
      const nextH2Idx =
        i + 1 < h2Indices.length ? h2Indices[i + 1] : allChildren.length;
      const sectionEls = allChildren.slice(h2Idx, nextH2Idx);
      const title =
        ((sectionEls[0] && sectionEls[0].textContent) || "").trim() ||
        "Untitled";
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
      )
        continue;
      if (el.querySelector && el.querySelector(".code-block")) continue;

      if (tag === "H2" || tag === "H3") {
        parts.push((el.textContent || "").trim() + ".");
      } else if (tag === "P") {
        parts.push((el.textContent || "").trim());
      } else if (tag === "UL" || tag === "OL") {
        el.querySelectorAll("li").forEach((li) =>
          parts.push((li.textContent || "").trim()),
        );
      } else if (
        el.classList.contains("callout") ||
        el.classList.contains("pull-quote")
      ) {
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
    bar.querySelector(".progress-fill").style.width =
      `${total ? (current / total) * 100 : 0}%`;
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
                const resp = await fetch(sectionIdToAudioUrl(id));
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
