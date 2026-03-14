// ─── Local Dev Server ───
// Serves the edu-webdoc app and proxies TTS generation through OpenAI,
// saving generated audio files directly to the project's audio/ folder.
// This only runs during local development — on GitHub Pages the app
// falls back to pre-generated static files in /audio/.

import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3333;
const AUDIO_DIR = path.join(__dirname, "audio");
const HTML_FILE = path.join(__dirname, "index.html");
const PATCH_FILE = path.join(__dirname, "client-patch.js");

// ─── Ensure audio/ directory exists ───
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// ─── Middleware ───
app.use(express.json({ limit: "50mb" }));

// CORS for local dev
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve static audio files
app.use("/audio", express.static(AUDIO_DIR));

// ─── Serve client-patch.js ───
app.get("/client-patch.js", (req, res) => {
  res.type("application/javascript").sendFile(PATCH_FILE);
});

// ─── Serve the HTML app with patch script injected ───
// Instead of static serving, we read the HTML, inject our patch <script>,
// and send the modified version. This ensures the old compiled code gets
// our server-side overrides without needing a full rebuild.
app.get("/", (req, res) => {
  try {
    let html = fs.readFileSync(HTML_FILE, "utf-8");

    // Inject the patch script before </body> (or at the end if no </body>)
    const patchTag = `\n<script src="/client-patch.js"></script>\n`;

    if (html.includes("</body>")) {
      html = html.replace("</body>", patchTag + "</body>");
    } else if (html.includes("</html>")) {
      html = html.replace("</html>", patchTag + "</html>");
    } else {
      html += patchTag;
    }

    res.type("text/html").send(html);
  } catch (err) {
    console.error("Failed to serve HTML:", err.message);
    res.status(500).send("Failed to load application");
  }
});

// Serve other static files (CSS, etc.) — but NOT index.html as auto-index
// (our custom "/" handler above takes care of that)
app.use(express.static(__dirname, {
  index: false, // Disable auto-index so our custom handler wins
}));

// ─── API: Health / mode detection ───
app.get("/api/status", (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  res.json({
    mode: "local",
    apiKeyConfigured: !!apiKey,
    audioDir: "audio/",
  });
});

// ─── API: List available audio files ───
// Scans audio/{ch1,ch2,...}/*.mp3 subdirectories and returns section IDs
app.get("/api/audio", (req, res) => {
  try {
    const sections = [];
    const entries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Scan subdirectory (e.g. audio/ch1/)
        const subDir = path.join(AUDIO_DIR, entry.name);
        const files = fs.readdirSync(subDir).filter(f => f.endsWith(".mp3"));
        for (const file of files) {
          // ch1/s0.mp3 → ch1_s0
          sections.push(`${entry.name}_${file.replace(".mp3", "")}`);
        }
      } else if (entry.isFile() && entry.name.endsWith(".mp3")) {
        // Also support flat files for backwards compatibility
        sections.push(entry.name.replace(".mp3", ""));
      }
    }
    res.json({ sections });
  } catch {
    res.json({ sections: [] });
  }
});

// ─── API: Generate TTS for a single section ───
// POST /api/tts
// Body: { sectionId, text, words, voice }
// Uses OPENAI_API_KEY from .env. Saves .mp3 to audio/ folder.
app.post("/api/tts", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not set in server environment. Add it to your .env file and restart." });
  }

  const { sectionId, text, words, voice } = req.body;
  if (!sectionId || !text) {
    return res.status(400).json({ error: "sectionId and text are required" });
  }

  const ttsVoice = voice || "nova";
  const TTS_MODEL = "gpt-4o-mini-tts-2025-12-15";
  const TTS_CHAR_LIMIT = 4000;

  try {
    const chunks = chunkText(text, TTS_CHAR_LIMIT);
    const audioBuffers = [];

    for (const chunk of chunks) {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: TTS_MODEL,
          voice: ttsVoice,
          input: chunk,
          response_format: "mp3",
          speed: 1.0,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({
          error: `OpenAI TTS error ${response.status}: ${errText}`,
        });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      audioBuffers.push(buffer);

      if (chunks.length > 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const fullBuffer = Buffer.concat(audioBuffers);

    // Save to audio/{chapter}/{section}.mp3
    const filePath = sectionIdToPath(sectionId);
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(filePath, fullBuffer);

    // Estimate duration from file size (MP3 ~128kbps = 16KB/s)
    const estimatedDuration = fullBuffer.length / (128 * 128);
    const wordTimings = estimateWordTimings(words || [], estimatedDuration);

    const urlPath = sectionIdToUrlPath(sectionId);
    console.log(`  ✓ Saved ${urlPath} (${(fullBuffer.length / 1024).toFixed(1)} KB)`);

    res.json({
      sectionId,
      duration: estimatedDuration,
      wordTimings,
      fileSize: fullBuffer.length,
      filePath: urlPath,
    });
  } catch (err) {
    console.error(`  ✗ Failed ${sectionId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Delete all audio files ───
app.delete("/api/audio", (req, res) => {
  try {
    let count = 0;
    const entries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(AUDIO_DIR, entry.name);
        const files = fs.readdirSync(subDir).filter(f => f.endsWith(".mp3"));
        for (const file of files) {
          fs.unlinkSync(path.join(subDir, file));
          count++;
        }
        // Remove empty subdirectory
        if (fs.readdirSync(subDir).length === 0) fs.rmdirSync(subDir);
      } else if (entry.isFile() && entry.name.endsWith(".mp3")) {
        fs.unlinkSync(path.join(AUDIO_DIR, entry.name));
        count++;
      }
    }
    console.log(`  ✓ Cleared ${count} audio files`);
    res.json({ cleared: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Delete a single audio file ───
app.delete("/api/audio/:sectionId", (req, res) => {
  const filePath = sectionIdToPath(req.params.sectionId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`  ✓ Deleted ${req.params.sectionId}`);
    }
    res.json({ deleted: req.params.sectionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Path helpers ───
// Converts sectionId "ch1_s0" → "ch1/s0.mp3", "ch2_intro" → "ch2/intro.mp3"
function sectionIdToPath(sectionId) {
  const sepIdx = sectionId.indexOf("_");
  if (sepIdx < 0) return path.join(AUDIO_DIR, sectionId + ".mp3");
  const chapter = sectionId.slice(0, sepIdx);
  const section = sectionId.slice(sepIdx + 1);
  return path.join(AUDIO_DIR, chapter, section + ".mp3");
}

function sectionIdToUrlPath(sectionId) {
  const sepIdx = sectionId.indexOf("_");
  if (sepIdx < 0) return `/audio/${sectionId}.mp3`;
  const chapter = sectionId.slice(0, sepIdx);
  const section = sectionId.slice(sepIdx + 1);
  return `/audio/${chapter}/${section}.mp3`;
}

// ─── Helpers ───

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxLen) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function estimateWordTimings(words, durationSeconds) {
  if (words.length === 0) return [];
  if (words.length === 1) return [0];

  const syllables = words.map(estimateSyllables);
  const totalSyllables = syllables.reduce((a, b) => a + b, 0);

  const pauseWeight = 0.3;
  let sentencePauses = 0;
  words.forEach(word => {
    if (/[.!?]$/.test(word)) sentencePauses++;
  });

  const totalPauseTime = sentencePauses * pauseWeight;
  const speechTime = Math.max(durationSeconds - totalPauseTime, durationSeconds * 0.8);
  const timePerSyllable = speechTime / totalSyllables;

  const timings = [];
  let currentTime = 0;

  for (let i = 0; i < words.length; i++) {
    timings.push(currentTime);
    currentTime += syllables[i] * timePerSyllable;
    if (/[.!?]$/.test(words[i])) {
      currentTime += pauseWeight;
    }
  }

  return timings;
}

function estimateSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const vowelGroups = w.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;
  if (w.endsWith("e") && !w.endsWith("le") && count > 1) count--;
  return Math.max(1, count);
}

// ─── Start ───

app.listen(PORT, () => {
  const hasKey = !!process.env.OPENAI_API_KEY;
  console.log("");
  console.log("  ┌───────────────────────────────────────────────┐");
  console.log("  │  Architecture V1 — Local Dev Server            │");
  console.log(`  │  http://localhost:${PORT}                          │`);
  console.log("  │                                                 │");
  console.log(`  │  API Key: ${hasKey ? "✓ configured                       " : "✗ missing (set OPENAI_API_KEY in .env)"}  │`);
  console.log(`  │  Audio dir: ./audio/                            │`);
  console.log(`  │  Patch: client-patch.js injected into HTML      │`);
  console.log("  └───────────────────────────────────────────────┘");
  console.log("");
});
