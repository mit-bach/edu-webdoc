import { useState } from "react";

const CodeToggle = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-4">
      <button onClick={() => setOpen(!open)} className="code-toggle-btn">{open ? "▾" : "▸"} {label}</button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
};

export default function Ch6StateMgmt() { return (<article className="prose-body">
  <div className="chapter-badge">Chapter 06</div>
  <h1 className="heading-display text-4xl mb-3">State & Idempotency</h1>
  <p className="text-lg mb-10" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-body)" }}>How the family_file maintains data integrity through append-only merges, deterministic identity, and conflict resolution — and why these choices determine whether your system is reliable or fragile.</p>

  <h2 className="heading-section text-2xl mt-12 mb-6">The family_file as Source of Truth</h2>
  <p>Every mutation in the system flows through the family_file. Agents are stateless — they start each invocation with no memory of prior runs, no awareness of what other agents have done, no persistent connection to the data they previously produced. All durable state lives in the file. This means the family_file's design directly determines whether the system is reliable or fragile, whether it can recover from errors or silently accumulates corruption over many passes.</p>
  <p>This is a deliberate architectural choice with important consequences. By making agents stateless and the file the single source of truth, we gain two properties that distributed systems engineers prize above almost all else. First, <strong>recoverability</strong>: if an agent crashes mid-execution, the family_file is either in its pre-execution state (the agent hadn't written yet) or in a valid post-execution state (the write completed). There is no intermediate corrupted state because writes are atomic. Second, <strong>reproducibility</strong>: given the same family_file and the same agent configuration, the agent will produce the same output. This makes debugging tractable — you can replay any agent invocation by feeding it the file state at that point in time.</p>
  <p>The family_file is a JSON document keyed by a deterministic family_id. It contains a map of <code className="code-inline">member_id → personal_data</code>, a separate <code className="code-inline">relationship_edges</code> array for inverse-aware links, and a <code className="code-inline">processing_history</code> log that records every agent invocation that touched this file. The processing_history is essential for debugging and for the skill system (Chapter 8) — it tells you exactly what was tried, what worked, and what failed, and it provides the telemetry data that skill mining uses to discover effective agent-profile pairings.</p>

  <div className="callout">
    <strong>Design Principle</strong>
    <p className="mt-2 mb-0">The family_file is not a database record. It is a self-contained document that carries its own history. Any reader can understand the file's provenance without querying external systems. This is a document-oriented design, not a relational one, and it makes the system resilient to infrastructure changes — you can move files between storage backends, archive them, ship them to another machine, and they remain fully self-describing.</p>
  </div>

  <h2 className="heading-section text-2xl mt-12 mb-6">Deterministic Identity</h2>
  <p>Family IDs and member IDs must be deterministic — the same family should always get the same ID regardless of when or in what order it's processed. This property eliminates an entire category of bugs related to duplicate creation, orphaned references, and non-reproducible behavior across runs. If you process the seed CSV today and again tomorrow, every family_file should have the same filename both times.</p>
  <p>For the MVP, the recommended approach is to derive the family_id from the seed student only — a SHA-256 hash of the normalized name plus class year, truncated to 16 hex characters. This is stable and unique enough: the seed student doesn't change, so the ID doesn't change when new members are discovered. Normalization is critical: lowercase the name, strip whitespace, use a consistent delimiter. Without normalization, "Alice Chen" and " alice  chen " would produce different hashes, creating duplicate family_files for the same person.</p>
  <p>The Architecture_V1 spec mentions a "hash of sorted member names + earliest class year" approach. This is better suited for <em>deduplication and reconciliation</em> — detecting when two independently-created family_files should be merged — but it creates a re-keying problem as a primary key. Every time you discover a new member, the hash changes, which invalidates all references to the old ID: in the dispatch queue, in the population index, in other family_files' cross-references, and in the processing history. For the primary key, stability matters more than content-derivation. Use the content-based hash as a secondary "fingerprint" for merge detection, not as the primary identifier.</p>

  <div className="section-divider">Merge Operations</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">Delta-Based Merges</h2>
  <p>Agents never output a complete family_file. They output <em>deltas</em> — structured descriptions of what to add or augment. A delta specifies: which member, which fields, the new values, the confidence score for each value, and the source or evidence string. This delta-only approach has three advantages over full-file replacement.</p>
  <p>First, it enables <strong>concurrent writes</strong>. If two agents are enriching different members of the same family simultaneously, their deltas don't conflict — they touch different parts of the file. With full-file replacement, the second agent's write would overwrite the first agent's changes, a classic lost-update problem.</p>
  <p>Second, it makes the <strong>append-only invariant</strong> enforceable. The merge function can verify that no delta attempts to delete or null out an existing field. If a delta tries to set a field to null, the merge function rejects it. This is a compile-time guarantee (enforced by the delta schema) rather than a runtime hope.</p>
  <p>Third, it creates an <strong>audit trail</strong>. Each delta is a record of what an agent thought it found. By storing deltas alongside the merged result, you can reconstruct the full history of how each field got its current value — which agent set it, when, with what confidence, based on what evidence. This is invaluable for debugging and for the ablation studies described in Chapter 8.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">The Three Merge Cases</h3>
  <p>The merge function handles three cases for each field in the delta, and understanding the semantics of each case is essential for reasoning about system behavior.</p>
  <p><strong>Case 1: New field</strong> (existing value is null). Always accept — write the value, record the confidence and source in a metadata sidecar keyed by the field path. The metadata tracks confidence, source, and the timestamp of the last update. This case is unambiguous and constitutes the majority of merges on early passes.</p>
  <p><strong>Case 2: Identical value</strong> (new value matches existing). This is a no-op for the value itself, but it carries information: if two independent agent runs, potentially using different search strategies and different evidence, arrive at the same value, our confidence that the value is correct should increase. The merge function boosts the confidence score by a diminishing increment — specifically, <code className="code-inline">new_conf = old_conf + (1 - old_conf) × 0.2</code>. This formula has the property that it asymptotically approaches 1.0 but never reaches it, and each successive boost is smaller than the last, reflecting diminishing marginal evidence.</p>
  <p><strong>Case 3: Conflict</strong> (new value differs from existing). This is where the merge strategy matters, and two strategies are supported. The <strong>confidence-wins</strong> strategy compares the new delta's confidence with the existing field's confidence. If the new value wins, it replaces the existing value, but the old value is archived in the metadata (never deleted — append-only). If the existing value wins, the new value is recorded as an attempted update in the processing history, providing evidence that there's disagreement about this field. The <strong>flag-all</strong> strategy never resolves the conflict automatically; it records both values and marks the field for human review. The MVP should use confidence-wins for most fields and flag-all for high-stakes fields like relationship types, which affect the graph structure and are expensive to correct after the fact.</p>

  <div className="callout-green callout">
    <strong>Idempotency Proof</strong>
    <p className="mt-2 mb-0">The merge function is idempotent: <code className="code-inline">merge(state, delta) == merge(merge(state, delta), delta)</code>. This holds because: new fields are set on first application and become "identical value" on second application (no-op with confidence boost). Conflicts are resolved on first application; the resolved value matches the delta on second application (no-op). The confidence boost on repeated no-ops converges asymptotically to 1.0, never diverges. This means you can safely re-run any agent on any family_file without fear of corruption — a property that enables the iterative multi-pass architecture described in Chapter 4.</p>
  </div>

  <CodeToggle label="Merge strategy implementation sketch">
    <div className="code-block" data-lang="python">{`class FamilyFileMerger:
    def merge_personal_data(self, existing: dict, delta: PersonalDataDelta,
                            strategy: str = "confidence_wins") -> MergeResult:
        accepted, conflicts, no_ops = {}, [], []
        for field_path, new_value in delta.updates.items():
            existing_value = get_nested(existing, field_path)
            new_conf = delta.confidence.get(field_path, 0.5)
            
            if existing_value is None:             # Case 1: new field
                set_nested(existing, field_path, new_value)
                set_nested(existing, f"_meta.{field_path}.confidence", new_conf)
                accepted[field_path] = new_value
            elif existing_value == new_value:       # Case 2: identical
                old_conf = get_nested(existing, f"_meta.{field_path}.confidence", 0.5)
                boosted = min(1.0, old_conf + (1 - old_conf) * 0.2)
                set_nested(existing, f"_meta.{field_path}.confidence", boosted)
                no_ops.append(field_path)
            else:                                    # Case 3: conflict
                # ... resolve by strategy
                pass
        return MergeResult(accepted=accepted, conflicts=conflicts, no_ops=no_ops)`}</div>
  </CodeToggle>

  <h2 className="heading-section text-2xl mt-12 mb-6">Shared-Asset Propagation</h2>
  <p>Certain personal_data fields are household-level — they belong to the family unit, not to an individual member. A primary residence, a family trust, a family business. When P2 enrichment discovers a shared asset for member A, that data should propagate bidirectionally to all linked members. If Robert Chen's enrichment reveals the family home address, that address should also appear in Alice Chen's and Brian Chen's personal_data without requiring a separate agent invocation for each.</p>
  <p>This propagation is a distinct merge path from the standard per-member merge. The propagator examines each field in an incoming delta, checks whether the field is in the set of shared-asset fields, and if so, generates <em>derived deltas</em> for all members linked to the source member through the relationship_edges. The derived delta is identical to the original except for two differences: the member_id points to the target member, and the confidence is multiplied by 0.9 (slightly reduced because the data is derived rather than directly observed). The "linked members" are determined by the field type: for primary_residence, it's household members (parents + children sharing the address); for trusts, it's listed beneficiaries; for family businesses, it's members tagged with the business affiliation.</p>
  <p>Propagation must be carefully ordered relative to the standard merge. The flow is: apply the original delta to the source member first, then generate propagated deltas, then apply those to target members. This ordering ensures that the source member's data is authoritative and the propagated data is clearly derived. If propagation were to run before the source merge, you'd risk propagating stale or rejected values.</p>

  <h2 className="heading-section text-2xl mt-12 mb-6">Relationship Edge Management</h2>
  <p>Relationship edges are stored separately from personal_data and have their own invariants that are critical to the system's correctness. The most important invariant: edges are <strong>inverse-aware</strong>. Adding "Robert parent_of Alice" automatically creates "Alice child_of Robert." Symmetric relationships (sibling_of, spouse_of) create their own inverses with the same confidence. This eliminates a large class of consistency bugs where one direction of a relationship exists but the other doesn't — bugs that are particularly insidious because they're invisible until you query the graph from the "wrong" direction.</p>
  <p>Edges also undergo <strong>consistency validation</strong> after each merge. The validator checks for: no member having more than 2 biological parents, no self-references (A parent_of A), no circular parentage (A parent_of B and B parent_of A), and no contradictory edges (A sibling_of B and A parent_of B simultaneously). These checks produce warnings, not errors — the system doesn't reject the data outright, because LLM-generated relationship data has a roughly 5-10% error rate on relationship types, and hard rejection would cause data loss. Instead, warnings are logged to the processing_history and flagged for review. In practice, most relationship errors are classification mistakes (labeling a sibling as a cousin, or a step-parent as a biological parent) rather than fabricated relationships.</p>
  <p>The deduplication logic for edges is based on the triple <code className="code-inline">(source, target, relationship_type)</code>. If the same edge is added twice, the second addition boosts the confidence score rather than creating a duplicate. This mirrors the personal_data merge behavior: repeated observations increase confidence without creating data duplication.</p>

  <div className="section-divider">Persistence</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">File Format and I/O</h2>
  <p>The MVP uses JSON files on the local filesystem. Each family_file is a single <code className="code-inline">.json</code> file named by the family_id. JSON is chosen over alternatives (Parquet, SQLite, Protocol Buffers) for three reasons: it's human-readable (you can open the file and inspect the data without any tooling), it's schema-flexible (adding new fields to personal_data doesn't require a migration), and it's natively supported by Python's standard library (no external dependencies).</p>
  <p>The tradeoff is performance. JSON files are slower to read and write than binary formats, and they're larger on disk. For the MVP, this doesn't matter — the bottleneck is LLM API latency (seconds per call), not file I/O (milliseconds). At scale, you'd migrate to a database (PostgreSQL with JSONB columns is a natural fit) or a binary format. The key insight is that the file store interface stays the same regardless of the backend. The <code className="code-inline">FamilyFileStore</code> class exposes <code className="code-inline">read()</code>, <code className="code-inline">write()</code>, and <code className="code-inline">merge_delta()</code> methods. The current implementation uses JSON files; a future implementation might use PostgreSQL. The rest of the system doesn't care.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Concurrent Access and Locking</h3>
  <p>When multiple agents run concurrently — which they will during BFS phases where dozens of families are being processed in parallel — they may attempt to read and write the same family_file simultaneously. Without coordination, this creates race conditions: two agents read the file, both make changes, and the second write overwrites the first agent's changes.</p>
  <p>The solution is per-family async locks. The file store maintains a dictionary of <code className="code-inline">asyncio.Lock</code> objects keyed by family_id. Reads and writes acquire the lock before accessing the file. Writes use atomic rename: write the complete JSON to a temp file (same directory, <code className="code-inline">.tmp</code> suffix), then rename the temp file to the target path. On POSIX systems, rename is atomic — either the old file exists or the new file exists, never neither and never a half-written file. This means a crash mid-write leaves the original file intact.</p>
  <p>For the MVP, in-process asyncio locks are sufficient because everything runs in one Python process. At scale — multiple worker processes, multiple machines, or a distributed deployment — you'd need distributed locks. Redis-based locks (using the Redlock algorithm), file-system advisory locks (<code className="code-inline">fcntl.flock</code>), or database row-level locking are all viable options. The interface stays the same; only the lock implementation changes. This is a strength of the architecture: the locking strategy is an implementation detail of the file store, invisible to agents and policies.</p>
</article>); }
