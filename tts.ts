// ─── TTS Integration: Local Dev Server + Static Fallback + IndexedDB ───
//
// When running on the local dev server (server.js), audio generation
// is proxied through the backend which saves .mp3 files directly to
// the project's audio/ folder. The API key lives server-side only.
//
// When deployed to GitHub Pages, the app loads pre-generated static
// files from /audio/ and/or IndexedDB (no generation possible).

const DB_NAME = "archv1_audio";
const DB_VERSION = 1;
const STORE = "sections";
const TTS_CHAR_LIMIT = 4000;
const TTS_MODEL = "gpt-4o-mini-tts-2025-12-15";

// ─── Types ───

export interface SectionInfo {
  id: string;          // "ch1_s0", "ch1_s1", ...
  chapterId: string;   // "ch1"
  title: string;       // Section heading text
  text: string;        // Full prose text for TTS
  words: string[];     // Individual words for highlighting
  order: number;       // Global ordering across all chapters
}

export interface StoredAudio {
  id: string;
  audioBase64: string;  // base64-encoded mp3
  duration: number;     // seconds
  wordTimings: number[]; // start time for each word (seconds)
  text: string;
  words: string[];
}

export interface ServerStatus {
  mode: "local";
  apiKeyConfigured: boolean;
  audioDir: string;
}

export interface ServerTTSResult {
  sectionId: string;
  duration: number;
  wordTimings: number[];
  fileSize: number;
  filePath: string;
}

// ─── Dev Mode Detection ───
// Cached after first check so we don't re-fetch every call.

let _isLocalDev: boolean | null = null;
let _serverStatus: ServerStatus | null = null;

export async function checkLocalDevMode(): Promise<boolean> {
  if (_isLocalDev !== null) return _isLocalDev;

  try {
    const resp = await fetch("/api/status", { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data.mode === "local") {
        _isLocalDev = true;
        _serverStatus = data;
        return true;
      }
    }
  } catch {
    // Not running on local dev server
  }
  _isLocalDev = false;
  return false;
}

export function getServerStatus(): ServerStatus | null {
  return _serverStatus;
}

export function isLocalDev(): boolean {
  return _isLocalDev === true;
}

// ─── Local Dev Server API ───

export async function serverGenerateTTS(
  sectionId: string,
  text: string,
  words: string[],
  voice: string = "nova"
): Promise<ServerTTSResult> {
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

export async function serverListAudio(): Promise<string[]> {
  try {
    const resp = await fetch("/api/audio");
    if (resp.ok) {
      const data = await resp.json();
      return data.sections || [];
    }
  } catch {
    // Server not available
  }
  return [];
}

export async function serverClearAudio(): Promise<void> {
  await fetch("/api/audio", { method: "DELETE" });
}

// ─── IndexedDB ───

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeAudio(data: StoredAudio): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAudio(id: string): Promise<StoredAudio | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAllAudioIds(): Promise<string[]> {
  // In local dev mode, prefer the server's file listing
  if (_isLocalDev) {
    const serverIds = await serverListAudio();
    if (serverIds.length > 0) return serverIds;
  }

  // Fallback to IndexedDB
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllAudio(): Promise<void> {
  // In local dev mode, also clear server files
  if (_isLocalDev) {
    await serverClearAudio();
  }

  // Also clear IndexedDB
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Static file loading (for GitHub Pages) ───

export async function tryLoadStaticAudio(sectionId: string): Promise<Blob | null> {
  try {
    const resp = await fetch(`/audio/${sectionId}.mp3`);
    if (resp.ok) return resp.blob();
    return null;
  } catch {
    return null;
  }
}

// ─── OpenAI TTS API (client-side, used only on GitHub Pages if needed) ───

export async function generateSpeech(
  text: string,
  apiKey: string,
  voice: string = "nova"
): Promise<Blob> {
  if (text.length <= TTS_CHAR_LIMIT) {
    return callTTS(text, apiKey, voice);
  }

  const chunks = chunkText(text, TTS_CHAR_LIMIT);
  const blobs: Blob[] = [];
  for (const chunk of chunks) {
    const blob = await callTTS(chunk, apiKey, voice);
    blobs.push(blob);
    await new Promise(r => setTimeout(r, 200));
  }
  return new Blob(blobs, { type: "audio/mpeg" });
}

async function callTTS(text: string, apiKey: string, voice: string): Promise<Blob> {
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice,
      input: text,
      response_format: "mp3",
      speed: 1.0,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`TTS API error ${resp.status}: ${err}`);
  }

  return resp.blob();
}

function chunkText(text: string, maxLen: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const chunks: string[] = [];
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

// ─── Text extraction from DOM ───

export function extractSectionsFromChapter(
  container: HTMLElement,
  chapterNum: number,
  globalOffset: number
): SectionInfo[] {
  const sections: SectionInfo[] = [];
  const chapterId = `ch${chapterNum}`;

  const allChildren = Array.from(container.children);
  const h2Indices: number[] = [];

  allChildren.forEach((el, i) => {
    if (el.tagName === "H2") h2Indices.push(i);
  });

  // Intro: everything before the first h2
  if (h2Indices.length > 0 && h2Indices[0] > 0) {
    const introEls = allChildren.slice(0, h2Indices[0]);
    const text = extractTextFromElements(introEls);
    if (text.length > 30) {
      const words = textToWords(text);
      sections.push({
        id: `${chapterId}_intro`,
        chapterId,
        title: "Introduction",
        text,
        words,
        order: globalOffset + sections.length,
      });
    }
  }

  // Each h2 section
  h2Indices.forEach((h2Idx, i) => {
    const nextH2Idx = i + 1 < h2Indices.length ? h2Indices[i + 1] : allChildren.length;
    const sectionEls = allChildren.slice(h2Idx, nextH2Idx);
    const title = sectionEls[0]?.textContent?.trim() || "Untitled";
    const text = extractTextFromElements(sectionEls);
    const words = textToWords(text);

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

function extractTextFromElements(elements: Element[]): string {
  const parts: string[] = [];

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

    if (el.querySelector?.(".code-block")) continue;

    if (tag === "H2" || tag === "H3") {
      parts.push(el.textContent?.trim() + "." || "");
    } else if (tag === "P") {
      parts.push(el.textContent?.trim() || "");
    } else if (tag === "UL" || tag === "OL") {
      const items = el.querySelectorAll("li");
      items.forEach(li => parts.push(li.textContent?.trim() || ""));
    } else if (el.classList.contains("callout") || el.classList.contains("pull-quote")) {
      parts.push(el.textContent?.trim() || "");
    } else if (tag === "DIV") {
      const inner = extractTextFromElements(Array.from(el.children));
      if (inner) parts.push(inner);
    }
  }

  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function textToWords(text: string): string[] {
  return text.split(/\s+/).filter(w => w.length > 0);
}

// ─── Word timing estimation ───

function estimateSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const vowelGroups = w.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;
  if (w.endsWith("e") && !w.endsWith("le") && count > 1) count--;
  return Math.max(1, count);
}

export function estimateWordTimings(words: string[], durationSeconds: number): number[] {
  if (words.length === 0) return [];
  if (words.length === 1) return [0];

  const syllables = words.map(estimateSyllables);
  const totalSyllables = syllables.reduce((a, b) => a + b, 0);

  const pauseWeight = 0.3;
  let sentencePauses = 0;
  const weights = syllables.map((syl, i) => {
    const word = words[i];
    if (/[.!?]$/.test(word)) sentencePauses++;
    return syl;
  });

  const totalPauseTime = sentencePauses * pauseWeight;
  const speechTime = Math.max(durationSeconds - totalPauseTime, durationSeconds * 0.8);
  const timePerSyllable = speechTime / totalSyllables;

  const timings: number[] = [];
  let currentTime = 0;

  for (let i = 0; i < words.length; i++) {
    timings.push(currentTime);
    currentTime += weights[i] * timePerSyllable;
    if (/[.!?]$/.test(words[i])) {
      currentTime += pauseWeight;
    }
  }

  return timings;
}

// ─── Audio duration from blob ───

export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      URL.revokeObjectURL(url);
      if (!isFinite(d)) {
        resolve(blob.size / (128 * 128));
      } else {
        resolve(d);
      }
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load audio metadata"));
    };
    audio.src = url;
  });
}

// ─── Blob ↔ Base64 ───

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string): Blob {
  const [header, data] = base64.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "audio/mpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ─── Download audio files (browser download, for non-dev fallback) ───

export async function downloadAudioFiles(): Promise<void> {
  const ids = await loadAllAudioIds();
  for (let i = 0; i < ids.length; i++) {
    const data = await loadAudio(ids[i]);
    if (!data) continue;
    const blob = base64ToBlob(data.audioBase64);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ids[i]}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await new Promise(r => setTimeout(r, 300));
  }
}
