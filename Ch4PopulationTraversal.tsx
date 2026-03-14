import { useState } from "react";
const CodeToggle = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (<div className="my-4"><button onClick={() => setOpen(!open)} className="code-toggle-btn">{open ? "▾" : "▸"} {label}</button>{open && <div className="mt-2">{children}</div>}</div>);
};

export default function Ch4PopulationTraversal() { return (<article className="prose-body">
  <div className="chapter-badge">Chapter 04</div>
  <h1 className="heading-display text-4xl mb-3">Queue: Population Traversal</h1>
  <p className="text-lg mb-10" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-body)" }}>Given N students, in what order do we process them? How deep do we go? When do we come back? This chapter explores BFS, DFS, and the hybrid approach that fits Architecture_V1.</p>

  <h2 className="heading-section text-2xl mt-12 mb-6">The Population as a Graph</h2>
  <p>The seed CSV defines an implicit graph. Nodes are people — both seed students and their discovered family members. Edges are relationships. But unlike a classical graph traversal problem, this graph is <strong>not known upfront</strong>. It is revealed as the pipeline runs. When you start, you have N disconnected nodes (the seed students). After the first P1 pass, you have N small clusters (each student plus their discovered family). After enrichment and feedback, some clusters merge (when two seed students turn out to be siblings), new members appear, and the graph grows outward.</p>
  <p>This "discover as you traverse" property is what makes the traversal strategy so consequential. A classical BFS or DFS over a known graph is a solved problem — the optimal strategy depends on what you're looking for and the graph's topology, but the algorithm itself is straightforward. A BFS or DFS over an <em>emerging</em> graph requires decisions about how much to explore before moving on, when to revisit previously explored territory with new information, and how to incorporate what you've learned from one part of the graph into your exploration of another part. These are not algorithmic decisions — they're <em>economic</em> decisions about how to allocate a finite budget (tokens, time) across an uncertain landscape.</p>
  <p>The traversal strategy is also the primary determinant of the system's runtime behavior. BFS produces predictable, parallel workloads. DFS produces deep, sequential workloads. The choice affects API rate limiting, memory usage, checkpointing complexity, and the ability to produce intermediate results. Understanding the tradeoffs at a deep level is essential before committing to an implementation.</p>

  <div className="pull-quote">
    The population is a graph you discover as you traverse it. Every traversal strategy is making a bet about where the most information is hiding.
  </div>

  <h2 className="heading-section text-2xl mt-12 mb-6">BFS: Breadth-First Across the Population</h2>
  <p>Breadth-first search processes all students at a shallow depth before going deeper on any single family. Applied to Architecture_V1, "depth" maps to pipeline phases. Depth 0 is all seed students — the CSV rows, each representing a starting node. Depth 1 is P1 discovery for every student — running the cold_start agent to discover immediate family members. Depth 2 is P2 enrichment for all discovered families — running enrichment agents across every member found in Depth 1. Depth 3 is P1 re-discovery using enrichment data — the feedback loop from Chapter 2, applied across the entire population simultaneously. And so on, alternating between discovery and enrichment at each depth level.</p>
  <p>The BFS queue implementation maintains two levels: <code className="code-inline">current_level</code> (the items being processed at the current depth) and <code className="code-inline">next_level</code> (items discovered during processing that belong to the next depth). Dequeue always pulls from current_level. When current_level is empty, swap next_level into current_level and increment the depth counter. A visited set prevents processing the same (family_id, member_id, depth) triple twice. This guarantees uniform coverage — after depth 2, every seed student has been touched by both P1 and P2, regardless of family complexity or data availability.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Visualizing the BFS Token Distribution</h3>
  <p>BFS distributes tokens uniformly across the population at each depth. Think of it as spreading paint evenly across a surface — thin coats, many layers:</p>

  {/* ASCII-art token distribution */}
  <div className="diagram-container" style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", lineHeight: 1.6, color: "var(--text-secondary)" }}>
    <div style={{ color: "var(--text-muted)", marginBottom: "0.5rem" }}>Token spend per family (N=8 families, 3 depths):</div>
    <div><span style={{ color: "var(--amber-bright)" }}>Depth 1: </span>{"████████ ████████ ████████ ████████ ████████ ████████ ████████ ████████"}</div>
    <div><span style={{ color: "var(--amber-mid)" }}>Depth 2: </span>{"████████ ████████ ████████ ████████ ████████ ████████ ████████ ████████"}</div>
    <div><span style={{ color: "var(--amber-dim)" }}>Depth 3: </span>{"█████░░░ ████████ ██░░░░░░ ████████ █████░░░ ░░░░░░░░ ████████ ███░░░░░"}</div>
    <div style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>░ = skipped (no new targets from feedback gate)</div>
  </div>

  <h3 className="heading-sub text-xl mt-8 mb-4">When BFS Works Well</h3>
  <p><strong>Uniform data availability.</strong> If all students have roughly similar amounts of discoverable data — a reasonable assumption when the seed population is drawn from the same institution and class year — BFS allocates effort evenly and no family is neglected. Each family gets exactly one P1 pass and one P2 pass before any family gets a second pass. This fairness property is valuable when you need comprehensive coverage (every family has at least basic data) rather than deep coverage (some families are fully explored, others untouched).</p>
  <p><strong>Independent families.</strong> If families don't overlap — no shared members across seed records — each BFS pass can process all families in parallel. This is the natural case when the seed CSV doesn't contain siblings, and it's the case that benefits most from async concurrency. During a BFS depth level, you can run 10, 20, or 50 agent invocations simultaneously, bounded only by your API rate limits and concurrency semaphore.</p>
  <p><strong>Rate-limited APIs.</strong> BFS naturally spreads API calls across different search targets. If you're searching for 100 different people in round-robin fashion, you're unlikely to hit per-query rate limits on any search engine, because consecutive searches are for different names in different contexts. DFS, by contrast, hammers the same family repeatedly — "Robert Chen Goldman Sachs," "Robert Chen finance," "Robert Chen trustee" — which can trigger search engine cooldowns or return progressively more cached (and less useful) results.</p>
  <p><strong>Early population-level insights.</strong> After completing depth 2 (P1 + P2 for everyone), you have a shallow but complete view of the entire population. You know every family's basic structure, which families are large, which members have internet presence, which employers and schools are most common. This data feeds the population index (described later in this chapter), which makes all subsequent processing more effective. BFS front-loads this population-level learning, while DFS delays it until all families are individually complete.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">When BFS Fails</h3>
  <p><strong>High variance in data richness.</strong> Some students have extensive online presence — LinkedIn, GitHub, published papers, news mentions, family foundation pages. Others have almost nothing — no social media, no public records, a common name that generates thousands of false-positive search results. BFS gives both the same treatment at each depth level, wasting tokens on low-yield targets (the agent searches fruitlessly for data that doesn't exist) while leaving high-yield targets underexplored (the agent found 20 signals but only followed 3 because the single-pass depth limit cut it off). A student with 50 discoverable data points gets the same single-pass treatment as a student with 3.</p>
  <p><strong>Family overlaps.</strong> If Student_A and Student_B are siblings (both in the seed CSV), BFS processes them independently on the first pass. Student_A's cold_start agent discovers "Robert Chen (father), Mei Chen (mother), Brian Chen (sibling)." Student_B — who is Brian Chen — independently discovers "Robert Chen (father), Mei Chen (mother), Alice Chen (sibling)." These two family_files describe the same family but were created separately. They must be reconciled after the BFS phase: detected via member overlap (both files contain Robert and Mei), then merged into a single file using the family reconciliation process. This reconciliation adds complexity, and if the merge logic isn't careful, it can lose data (one file's relationship edges overwritten by the other's) or create duplicates.</p>
  <p><strong>No cross-family learning on early passes.</strong> The core limitation of BFS is that pass N for family_K doesn't benefit from what was learned during pass N for families 1 through K-1. Within a single depth level, all families are processed with the same global state. Cross-family learning only becomes available after a complete depth level is finished and the population index is rebuilt. This means the most valuable type of learning — "this company keeps appearing across multiple families" — is delayed until the depth boundary.</p>

  <div className="section-divider">Depth-First Search</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">DFS: Depth-First Per Family</h2>
  <p>Depth-first search fully processes one family before moving to the next. Within a family, the processing is also depth-first: discover a member, enrich them immediately, follow any references in their enrichment data to discover new members, enrich those, and continue until the family converges (no new members discovered, or budget exhausted). Only then does the system pop to the next family in the seed CSV.</p>
  <p>The DFS implementation uses a stack rather than a queue. The family stack contains the ordered list of families to process. The internal stack contains work units within the current family. Dequeue always pulls from the internal stack first — continue the current family. Only when the internal stack is empty (current family is converged) does the system pop from the family stack and begin the next family. Newly discovered work from feedback gates is pushed onto the internal stack, ensuring it's processed immediately — before any other family gets attention. This is the defining property of DFS: new discoveries are explored immediately rather than queued for later.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Visualizing the DFS Token Distribution</h3>
  <div className="diagram-container" style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", lineHeight: 1.6, color: "var(--text-secondary)" }}>
    <div style={{ color: "var(--text-muted)", marginBottom: "0.5rem" }}>Token spend per family (same 8 families, same budget):</div>
    <div><span style={{ color: "var(--amber-bright)" }}>Fam 1: </span>{"████████████████████████████████████  (deep — rich data)"}</div>
    <div><span style={{ color: "var(--amber-bright)" }}>Fam 2: </span>{"██████████████████████████  (deep)"}</div>
    <div><span style={{ color: "var(--amber-mid)" }}>Fam 3: </span>{"████████  (sparse — converged fast)"}</div>
    <div><span style={{ color: "var(--amber-mid)" }}>Fam 4: </span>{"████████████████████████████████████████████  (very rich)"}</div>
    <div><span style={{ color: "var(--amber-dim)" }}>Fam 5: </span>{"████  (very sparse)"}</div>
    <div><span style={{ color: "var(--amber-dim)" }}>Fam 6: </span>{"████████████████████  (moderate)"}</div>
    <div style={{ color: "var(--text-muted)" }}>Fam 7: {"░░░░░░  (budget exhausted, never reached)"}</div>
    <div style={{ color: "var(--text-muted)" }}>Fam 8: {"░░░░░░  (budget exhausted, never reached)"}</div>
  </div>

  <h3 className="heading-sub text-xl mt-8 mb-4">When DFS Works Well</h3>
  <p><strong>Rich, interconnected families.</strong> When discovering one member leads to many others — a parent's LinkedIn mentions three children, a family foundation page lists all trustees, a news article about a business acquisition names the entire executive family — DFS follows these chains naturally. The feedback loop between P1 and P2 fires rapidly, and each pass has rich context from the prior pass because the enrichment data was just written moments ago rather than being separated by an entire BFS depth level across the population.</p>
  <p><strong>Family overlap detection.</strong> Because DFS fully processes one family before starting the next, it builds a complete picture of family_1 before encountering family_2. If student_2 turns out to be a member of family_1's extended family, DFS detects this immediately (the member already exists in family_1's file) rather than creating a duplicate that needs post-hoc reconciliation. This advantage is significant for populations with a high sibling rate.</p>
  <p><strong>Maximum depth per family.</strong> If the primary goal is to extract as much data as possible from each family — maximizing per-family completeness rather than population-wide coverage — DFS gets you there fastest. By the time you move to family_2, family_1 is as complete as the system can make it. This is the right strategy when you care more about data quality for a subset of families than about having shallow data for all families.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">When DFS Fails</h3>
  <p><strong>Stuck on sparse families.</strong> DFS can spend many iterations on a family with little discoverable data before the convergence check triggers. Each P1 pass returns zero new members. Each P2 pass returns mostly empty enrichment. But the convergence condition — "no new information for N consecutive passes" — requires those N passes to occur before the system gives up. A family with no internet presence might consume 5 futile P1 passes (and their associated token cost) before being marked as converged. Meanwhile, family_50, which might be data-rich and easy to process, sits untouched.</p>
  <p><strong>No cross-family learning.</strong> Family_100's processing doesn't benefit from anything learned while processing families 1-99. If you had built a population index from those 99 families, it could contain the shared employer, the common school, the mutual affiliation that would unlock family_100's connections. But DFS doesn't build that index until every family is done — it processes the population as independent units rather than as a connected system.</p>
  <p><strong>Poor parallelization.</strong> DFS is inherently sequential across families. In the strict model, you cannot start family_2 until family_1 is complete. You can parallelize <em>within</em> a family to some extent — enriching multiple members simultaneously, running independent P2 agents in parallel — but the discovery→enrichment dependency chain limits the achievable parallelism. A family with 5 members might support 3-4 concurrent agents; a family with 2 members supports essentially none.</p>
  <p><strong>Unpredictable runtime.</strong> BFS has predictable per-phase runtime: N families × 1 agent invocation per family × average invocation time. DFS has wildly variable per-family runtime: a sparse family finishes in seconds, a rich one might take minutes. This makes capacity planning and progress estimation difficult. How long until the pipeline completes? With BFS, you can estimate after the first depth level. With DFS, you can't estimate until you've seen a representative sample of family complexities.</p>

  <div className="section-divider">The Hybrid Approach</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">Hybrid: Bounded BFS + Prioritized DFS</h2>
  <p>Neither pure BFS nor pure DFS is optimal for Architecture_V1. The hybrid approach that fits the architecture best interleaves them in four phases, each building on the previous phase's output. The design principle is: <strong>use BFS for coverage and index-building, then use DFS for depth on the families where depth is most valuable.</strong></p>

  <div className="flow-step">
    <div className="flow-step-box"><div className="flow-step-label">Phase 1</div><div className="flow-step-text">BFS: shallow P1 discovery across all students</div></div>
    <div className="flow-step-box"><div className="flow-step-label">Phase 2</div><div className="flow-step-text">BFS: P2 enrichment, reconcile, build index</div></div>
    <div className="flow-step-box"><div className="flow-step-label">Phase 3</div><div className="flow-step-text">DFS: deep dive on top-K families</div></div>
    <div className="flow-step-box"><div className="flow-step-label">Phase 4</div><div className="flow-step-text">BFS: re-sweep with population context</div></div>
  </div>

  <h3 className="heading-sub text-xl mt-8 mb-4">Phase 1: Shallow Discovery</h3>
  <p><strong>Phase 1</strong> runs a single P1 pass on every seed student. Every family gets a cold_start agent invocation. After this phase, you know the basic family structure for every student: who their parents are, whether they have siblings, rough member count. You also discover family overlaps — when two seed students share a family member — which triggers reconciliation before Phase 2.</p>
  <p>Phase 1 is embarrassingly parallel. Every student's P1 invocation is independent. You can run all N simultaneously, bounded only by API rate limits and the concurrency semaphore from Chapter 3's dispatch loop. For a population of 500 students with a concurrency limit of 20, Phase 1 completes in roughly 500/20 × average_invocation_time ≈ 25 batches × ~10 seconds ≈ 4-5 minutes. This is fast enough that you can observe the results before committing to the next phase.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Phase 2: Enrichment + Index Construction</h3>
  <p><strong>Phase 2</strong> runs P2 enrichment across all families, using either per-member or whole-family mode depending on the mode selection logic from Chapter 3. After enrichment completes, two things happen. First, family reconciliation runs: overlapping families discovered in Phase 1 are merged. Second, the population index is built (or rebuilt) from all family_files. After Phase 2, you have a shallow but complete view of the entire population — every member has been touched by both P1 and P2, and the population index contains employer, school, location, and affiliation data across all families.</p>
  <p>Phase 2 is also highly parallel, with one caveat: families that were flagged for reconciliation must be merged before their P2 agents run, because the P2 whole-family mode needs the complete merged family_file as input. The dispatch system handles this naturally through dependencies — the P2 work units for a reconciled family depend on the reconciliation work unit completing first.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Phase 3: Prioritized Deep Dive</h3>
  <p><strong>Phase 3</strong> is where the hybrid shines, and where it differs most from both pure BFS and pure DFS. Instead of DFS on all N families (expensive, and wasteful for families with sparse data), you rank families by their estimated information yield and DFS only on the top K. The ranking is informed by Phase 2's data — you're making an evidence-based decision about which families deserve the expensive deep treatment.</p>
  <p>The ranking function scores families on several dimensions. <strong>Sparsity with potential</strong>: a family with many members but low fill rates has room to grow — there's data out there, we just haven't found it yet. <strong>Unresolved references</strong>: if a family member's enrichment data mentions names not in the family_file, those are discovery targets waiting to be followed. <strong>Cross-family connections</strong>: families with members who share employers, schools, or affiliations with other families in the population are more likely to yield interesting connections during deep exploration. <strong>Member count</strong>: larger families have more surface area for discovery, and each new member found might connect to yet more members.</p>

  <CodeToggle label="Family ranking function for Phase 3">
    <div className="code-block" data-lang="python">{`def rank_families_by_potential(family_files, population_index) -> list[str]:
    scores = {}
    for family_id, ff in family_files.items():
        score = 0.0
        # Sparsity: room to grow
        score += (1 - ff.fill_ratio()) * 10
        # Unresolved references: discovery targets
        score += ff.count_unresolved_references() * 3
        # Cross-family connections: population value
        score += population_index.count_connections(family_id) * 2
        # Member count: surface area
        score += min(ff.member_count, 10) * 1.5
        scores[family_id] = score
    return sorted(scores, key=scores.get, reverse=True)`}</div>
  </CodeToggle>

  <p>K (the number of families selected for deep dive) is a configuration parameter. Setting K too low means you miss data-rich families. Setting K too high means you're essentially doing DFS on the full population, with all of DFS's disadvantages. A good heuristic is the top 10-20% of families by potential score, or a fixed number like 50 — whichever is smaller. The right value depends on your total token budget and the population's data distribution, both of which you can estimate after Phases 1 and 2.</p>
  <p>The DFS within Phase 3 follows the convergence criteria from Chapter 3: per-family token budget, information gain threshold, and maximum depth. Each deep-dive family gets its own generous budget (larger than the BFS per-family allocation) and runs the full P1→P2→feedback→P1 loop until convergence. Phase 3 families are processed sequentially (or with limited parallelism), because each family's DFS requires sustained context and rapid feedback loops that don't parallelize well.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Phase 4: Context-Aware Re-Sweep</h3>
  <p><strong>Phase 4</strong> is the payoff of the entire hybrid approach. After Phase 3, the population index has been enriched with deep data from the DFS families. These families' career histories, affiliations, trust structures, and internet accounts are now in the index. Phase 4 runs P1 re-discovery across the population with this enriched population context injected into the agents' prompts and toolsets.</p>
  <p>The P1 agents in Phase 4 are different from Phase 1's cold_start agents. They use the <code className="code-inline">cross_reference</code> or <code className="code-inline">enrichment_aware_discovery</code> agent (depending on the policy selector's evaluation of each family's state), and they have access to the <code className="code-inline">query_population_index</code> tool. This lets them discover connections that were invisible on the first pass: "Robert Chen at Goldman Sachs — are there other Goldman Sachs employees in this population? Yes, the Park family's mother also works there — is there a connection?" These cross-family discoveries are the highest-value output of the pipeline and they're only possible because the hybrid approach invested in building the population index before attempting cross-referencing.</p>
  <p>Not every family needs re-sweeping. The re-entry prioritization function (Chapter 8) ranks families by their expected benefit from population context. Families with no connections to the index are skipped. Families with many potential cross-references are prioritized. This selective re-sweep avoids wasting tokens on families that won't benefit from the new context.</p>

  <div className="section-divider">Supporting Systems</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">Family Reconciliation</h2>
  <p>When BFS processes siblings independently — Student_A and Student_B are both in the seed CSV and turn out to be in the same family — it creates separate family_files that need to be merged. Reconciliation detects these overlaps and merges the files into a single, consistent family_file. Getting this right is critical because an undetected overlap means two agents are independently processing the same family, potentially producing conflicting data that's never reconciled.</p>
  <p>Detection uses an inverted index: map each member_id to the list of family_files that contain it. Members appearing in multiple files indicate an overlap. For example, if both family_file_A and family_file_B contain a member named "Robert Chen" with the same member_id (derived from the same normalized name), those files overlap and should be merged.</p>
  <p>Overlapping families are grouped using Union-Find (disjoint set union), a data structure that efficiently groups elements connected by shared members. If family_A and family_B share Robert Chen, and family_B and family_C share Mei Chen, Union-Find groups all three into a single merge group. Each group is merged into a single family_file: the file with the most data is chosen as the primary, and the others' members, edges, and processing history are merged into it using the same delta-based merge logic from Chapter 6. The secondary files are deleted (or archived, depending on your retention policy).</p>
  <p>Reconciliation should run after every BFS phase, and after Phase 1 in the hybrid approach. It's computationally cheap — the inverted index scan is O(total members across all files), and Union-Find operations are effectively O(1) amortized per merge. The actual file merge is more expensive (loading, merging, and writing JSON files) but only applies to overlapping families, which are typically a small fraction of the population — perhaps 5-15% for a population drawn from the same university class year.</p>

  <CodeToggle label="Union-Find reconciliation">
    <div className="code-block" data-lang="python">{`class FamilyReconciler:
    def reconcile(self, family_files: dict[str, FamilyFile]) -> dict[str, FamilyFile]:
        # Build member → family_id index
        member_index: dict[str, list[str]] = defaultdict(list)
        for fid, ff in family_files.items():
            for member_id in ff.members:
                member_index[member_id].append(fid)

        # Union-Find to group overlapping families
        uf = UnionFind()
        for member_id, fids in member_index.items():
            if len(fids) > 1:
                for fid in fids[1:]:
                    uf.union(fids[0], fid)

        # Merge each group into a primary file
        merged = {}
        consumed = set()
        for group in uf.groups():
            primary = max(group, key=lambda fid: family_files[fid].member_count)
            for secondary in group:
                if secondary != primary:
                    family_files[primary] = merge_family_files(
                        family_files[primary], family_files[secondary]
                    )
                    consumed.add(secondary)
            merged[primary] = family_files[primary]

        # Add un-merged families
        for fid, ff in family_files.items():
            if fid not in merged and fid not in consumed:
                merged[fid] = ff
        return merged`}</div>
  </CodeToggle>

  <h2 className="heading-section text-2xl mt-12 mb-6">The Population Index</h2>
  <p>The population index is a lightweight inverted index that supports cross-family queries. It maps field values to member references: "Goldman Sachs" → [Alice Chen in Family_12, Bob Park in Family_37]. The index covers employers, schools, locations, names, and affiliations — the five dimensions most likely to reveal inter-family connections.</p>
  <p>The index is rebuilt from scratch after each phase transition in the hybrid approach. Rebuilding is cheap — it scans all family_files and extracts the indexed fields, producing a fresh, consistent snapshot of the population's data. Incremental updates are possible but introduce complexity (what if a merge overwrites an indexed value?) that isn't worth it when the full rebuild takes under a second for a population of 500 families.</p>
  <p><strong>Value normalization</strong> is the index's most important quality factor. "Goldman Sachs," "Goldman Sachs Group," "Goldman Sachs & Co.," and "GS" should all map to the same entry. The normalizer lowercases, strips common corporate suffixes (Inc., Corp., LLC, Group, & Co.), and applies a small dictionary of known aliases. Perfect normalization is impossible — there will always be edge cases — but the common cases must be handled to avoid missing obvious connections. For the MVP, a hand-maintained alias dictionary of the top 50-100 employers and schools in the population is sufficient. Post-MVP, the alias dictionary can be learned from the data itself (by clustering similar values using edit distance or embeddings).</p>
  <p>The index is queried in two contexts. The <code className="code-inline">cross_reference</code> P1 agent (post-MVP) queries it during discovery to find potential family connections across the population. The population context injection system (Chapter 8) queries it to build the context section that's injected into agent prompts during Phase 4 re-sweeps. In both cases, the query interface is simple: given a field name and a value, return all member references that match. The index also supports a "count connections" query: given a family_id, how many other families share at least one indexed value? This powers the Phase 3 ranking function.</p>

  <h2 className="heading-section text-2xl mt-12 mb-6">Convergence and Termination</h2>
  <p>Both BFS and DFS need termination conditions, and they operate at three nested levels. Getting termination wrong means either wasting tokens on futile exploration (terminating too late) or leaving easy data on the table (terminating too early). The art is in calibrating the thresholds, and the right values depend on empirical observation of the pipeline's behavior on your specific population.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Per-Agent Termination</h3>
  <p>The lowest level. The agent loop (Chapter 5) stops when: the model emits an end-of-turn signal (it decides it has a complete answer), the iteration cap is reached (a hard safety limit that prevents runaway agents), or an unrecoverable error occurs. Per-agent termination is mechanical — it's built into the agent loop and doesn't require policy-level judgment.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Per-Family Termination</h3>
  <p>A family is "done" for the current pass when any of these conditions are met. <strong>All members processed:</strong> every member at the current depth has had their work unit dispatched and completed (or skipped). <strong>No new targets:</strong> the feedback gate (Chapter 2) returns an empty list — there are no undiscovered members to pursue. <strong>Budget exhausted:</strong> the family's token budget from Chapter 3 is depleted. <strong>Information gain below threshold:</strong> the ratio of new fields filled to tokens spent has dropped below a configurable minimum. This last condition is the most nuanced — set the threshold too low and the system wastes tokens on marginal improvements; set it too high and it misses easy fields that happen to require a few extra iterations to find.</p>
  <p>For the MVP, a pragmatic approach: terminate when the feedback gate returns empty OR when 3 consecutive agent invocations produce zero new fields. This is simple, observable, and conservative. Tune the threshold empirically once you have telemetry data from real runs.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Per-Population Termination</h3>
  <p>The highest-level decision. The entire traversal stops when: all families have reached a terminal state (converged, skipped, or budget-exhausted), the global token budget is depleted, the time limit is reached, or the marginal gain across the last complete phase has dropped below a population-level threshold. For the MVP with the hybrid approach, the simplest termination condition is completing all four phases — Phase 4's end is the natural stopping point. More sophisticated termination (e.g., "stop Phase 4 early if the re-sweep is producing less than 1 new field per family") requires the telemetry infrastructure from Chapter 8.</p>

  <div className="callout-rose callout">
    <strong>Checkpointing</strong>
    <p className="mt-2 mb-0">For long-running traversals (hours for large populations), you need the ability to stop and resume. BFS checkpointing is straightforward: serialize which depth level you're on and which items are complete. DFS checkpointing requires saving the internal stack state per-family. The hybrid approach benefits from phase boundaries as natural checkpoints — you can stop between any two phases and resume cleanly. Implement serializable checkpoint objects from the start, even if you don't use them immediately in the MVP. Retrofitting checkpointing onto a running system is painful, and you will need it the first time a 3-hour run crashes at the 2-hour mark.</p>
  </div>

  <h2 className="heading-section text-2xl mt-12 mb-6">Choosing a Strategy</h2>
  <table>
    <thead><tr><th>Dimension</th><th>BFS</th><th>DFS</th><th>Hybrid</th></tr></thead>
    <tbody>
      <tr><td>Coverage speed</td><td>Fast — all families touched early</td><td>Slow — sequential across families</td><td>Medium — BFS phases first</td></tr>
      <tr><td>Per-family depth</td><td>Shallow — uniform across all</td><td>Deep — exhaustive per family</td><td>Configurable — deep for top-K</td></tr>
      <tr><td>Cross-family learning</td><td>After each full depth level</td><td>None until all done</td><td>After Phase 2, used in Phase 4</td></tr>
      <tr><td>Parallelization</td><td>Excellent</td><td>Poor across families</td><td>Phase-dependent</td></tr>
      <tr><td>Token efficiency</td><td>Low — uniform depth wastes on sparse</td><td>Mixed — efficient on rich, wasteful on sparse</td><td>Highest — prioritized allocation</td></tr>
      <tr><td>Family overlap handling</td><td>Post-hoc reconciliation needed</td><td>Natural detection (sequential)</td><td>Phase 1 BFS + reconcile before Phase 2</td></tr>
      <tr><td>Predictability</td><td>High — uniform per-phase runtime</td><td>Low — varies wildly per family</td><td>Medium — BFS phases predictable, DFS phase variable</td></tr>
      <tr><td>Implementation complexity</td><td>Low</td><td>Medium</td><td>High</td></tr>
    </tbody>
  </table>

  <p><strong>Recommendation:</strong> Start with BFS only (Phases 1 + 2) for the MVP. This gives you population-wide coverage, the population index, and the telemetry data needed to make informed decisions about Phase 3 (which families deserve DFS) and Phase 4 (whether population context improves discovery). Add Phases 3 and 4 once you have confidence scoring working and enough data to validate that deeper exploration produces meaningful improvements over the shallow passes.</p>
</article>); }
