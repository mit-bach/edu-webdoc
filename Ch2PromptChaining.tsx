import { useState } from "react";

const CodeToggle = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-4">
      <button onClick={() => setOpen(!open)} className="code-toggle-btn">
        {open ? "▾" : "▸"} {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
};

export default function Ch2PromptChaining() {
  return (
    <article className="prose-body">
      <div className="chapter-badge">Chapter 02</div>
      <h1 className="heading-display text-4xl mb-3">Prompt Chaining</h1>
      <p className="text-lg mb-10" style={{ color: "hsl(30 10% 50%)", fontFamily: "'DM Sans', sans-serif" }}>How to wire multiple LLM invocations together, and why the joints between them matter more than the calls themselves.</p>

      <h2 className="heading-section text-2xl mt-12 mb-6">What Chaining Actually Is</h2>
      <p>Prompt chaining is sequential LLM invocations where the output of call N becomes input to call N+1. The word "chain" refers to the dependency graph between calls. This is distinct from a single agent loop — which is one LLM call with multiple tool-use iterations inside it. A chain is <strong>multiple distinct LLM invocations</strong> with potentially different prompts, different models, different tools, and different output schemas at each link.</p>
      <p>The fundamental question that determines your chain's quality is: <strong>where do you place the boundaries between links?</strong> Draw the boundary too wide (too much in one link) and the LLM has to juggle multiple objectives in a single prompt, which degrades accuracy. Draw the boundary too narrow (too many links) and you pay latency and token costs for passing context between links, and you risk losing coherence.</p>
      <p>Architecture_V1 has a natural two-link chain: Policy 1 (discovery) → Policy 2 (enrichment). But within that high-level structure, there are multiple complexity levels you can implement, each with different tradeoffs. We'll walk through four of them, from simplest to most sophisticated.</p>

      <h2 className="heading-section text-2xl mt-12 mb-6">Why Chains Beat Single-Shot Calls</h2>
      <p>A single LLM call with a massive prompt — "here's the student, find their family, enrich all their data, output the complete file" — will underperform a chain of focused calls for three concrete, measurable reasons.</p>
      <p><strong>Task decomposition improves accuracy.</strong> Each link in the chain has a narrow, well-defined objective. The model can concentrate its reasoning capacity on one subtask rather than juggling discovery and enrichment and validation simultaneously. This is the same principle behind chain-of-thought prompting, but applied at the system level rather than within a single prompt. Empirically, decomposed tasks show 15-30% higher accuracy on complex objectives compared to monolithic prompts.</p>
      <p><strong>Intermediate validation catches errors early.</strong> A gate between chain links can reject bad output before it propagates. If Policy 1 hallucinates a family member, the gate catches it before Policy 2 wastes tokens enriching a fictional person. Without chaining, the error propagates silently through the entire output, and you only discover it when you inspect the final family_file — at which point the tokens are already spent.</p>
      <p><strong>Different subtasks have different optimal configurations.</strong> Policy 1 (discovery) benefits from higher temperature and web search tools — you want creative, exploratory search. Policy 2 (enrichment) benefits from lower temperature and structured output constraints — you want precise, factual extraction. A chain lets you tune each link independently. A single-shot call forces one configuration for everything.</p>

      <h2 className="heading-section text-2xl mt-12 mb-6">The Gate: The Key Abstraction</h2>
      <p>The defining feature of a chain — the thing that separates it from "just calling an LLM twice" — is the <strong>gate</strong>. A gate is a deterministic function that sits between chain links. It validates, transforms, and routes the intermediate output.</p>
      <p>Without gates, you have two sequential API calls. The second call has no guarantee that the first call's output is usable. With gates, you have control points. The gate can <strong>reject</strong> the output and retry the previous link. It can <strong>filter</strong> low-confidence results before they pollute the next link. It can <strong>transform</strong> the output format (Policy 1's candidate list into Policy 2's expected input structure). And it can <strong>route</strong> to different downstream links based on what the data looks like.</p>

      <div className="callout-green callout">
        <strong style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem" }}>Gate Design Principles</strong>
        <p className="mt-2"><strong>Gates must be deterministic.</strong> They are regular Python functions, not LLM calls. If you need an LLM to evaluate the output, that's a separate chain link (an evaluator), not a gate.</p>
        <p><strong>Gates must be fast.</strong> They run synchronously between async LLM calls. Schema validation, confidence filtering, deduplication — sub-millisecond operations.</p>
        <p className="mb-0"><strong>Gates must be testable.</strong> Since they're deterministic, you can write unit tests with fixed inputs and expected outputs. This makes the chain debuggable: if the final output is wrong, you check each gate independently to find where the data went bad.</p>
      </div>

      {/* Chain Levels Diagram */}
      <div className="diagram-container">
        <svg viewBox="0 0 740 420" xmlns="http://www.w3.org/2000/svg" className="w-full">
          <defs>
            <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(30,10%,40%)" />
            </marker>
          </defs>

          {/* Level A */}
          <text x="30" y="35" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="13" fontWeight="600">LEVEL A: Linear Pipeline</text>
          <rect x="30" y="50" width="90" height="36" rx="4" fill="hsl(30,8%,12%)" stroke="hsl(200,50%,40%)" />
          <text x="75" y="73" textAnchor="middle" fill="hsl(40,20%,80%)" fontFamily="JetBrains Mono, monospace" fontSize="10">P1 Agent</text>
          <rect x="160" y="50" width="60" height="36" rx="4" fill="hsl(36,30%,10%)" stroke="hsl(36,60%,40%)" />
          <text x="190" y="73" textAnchor="middle" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="10" fontWeight="600">Gate</text>
          <rect x="260" y="50" width="90" height="36" rx="4" fill="hsl(30,8%,12%)" stroke="hsl(140,40%,35%)" />
          <text x="305" y="73" textAnchor="middle" fill="hsl(40,20%,80%)" fontFamily="JetBrains Mono, monospace" fontSize="10">P2 Agent</text>
          <rect x="390" y="50" width="60" height="36" rx="4" fill="hsl(36,30%,10%)" stroke="hsl(36,60%,40%)" />
          <text x="420" y="73" textAnchor="middle" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="10" fontWeight="600">Gate</text>
          <rect x="490" y="50" width="100" height="36" rx="4" fill="hsl(30,8%,14%)" stroke="hsl(30,8%,25%)" />
          <text x="540" y="73" textAnchor="middle" fill="hsl(40,15%,65%)" fontFamily="JetBrains Mono, monospace" fontSize="10">family_file</text>
          <line x1="120" y1="68" x2="155" y2="68" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arr2)" />
          <line x1="220" y1="68" x2="255" y2="68" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arr2)" />
          <line x1="350" y1="68" x2="385" y2="68" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arr2)" />
          <line x1="450" y1="68" x2="485" y2="68" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arr2)" />

          {/* Level B */}
          <text x="30" y="135" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="13" fontWeight="600">LEVEL B: Feedback Loop</text>
          <rect x="30" y="150" width="90" height="36" rx="4" fill="hsl(30,8%,12%)" stroke="hsl(200,50%,40%)" />
          <text x="75" y="173" textAnchor="middle" fill="hsl(40,20%,80%)" fontFamily="JetBrains Mono, monospace" fontSize="10">P1 Agent</text>
          <rect x="160" y="150" width="60" height="36" rx="4" fill="hsl(36,30%,10%)" stroke="hsl(36,60%,40%)" />
          <text x="190" y="173" textAnchor="middle" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="10" fontWeight="600">Gate</text>
          <rect x="260" y="150" width="90" height="36" rx="4" fill="hsl(30,8%,12%)" stroke="hsl(140,40%,35%)" />
          <text x="305" y="173" textAnchor="middle" fill="hsl(40,20%,80%)" fontFamily="JetBrains Mono, monospace" fontSize="10">P2 Agent</text>
          <rect x="390" y="150" width="80" height="36" rx="4" fill="hsl(200,20%,10%)" stroke="hsl(200,50%,40%)" />
          <text x="430" y="168" textAnchor="middle" fill="hsl(200,50%,60%)" fontFamily="DM Sans, sans-serif" fontSize="9" fontWeight="600">Feedback</text>
          <text x="430" y="180" textAnchor="middle" fill="hsl(200,50%,60%)" fontFamily="DM Sans, sans-serif" fontSize="9" fontWeight="600">Gate</text>
          <line x1="120" y1="168" x2="155" y2="168" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arr2)" />
          <line x1="220" y1="168" x2="255" y2="168" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arr2)" />
          <line x1="350" y1="168" x2="385" y2="168" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arr2)" />
          {/* Feedback arrow */}
          <path d="M 430 186 L 430 204 L 75 204 L 75 186" fill="none" stroke="hsl(200,50%,40%)" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#arr2)" />
          <text x="250" y="218" textAnchor="middle" fill="hsl(200,40%,45%)" fontFamily="JetBrains Mono, monospace" fontSize="9">new targets discovered?</text>

          {/* Level C */}
          <text x="30" y="260" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="13" fontWeight="600">LEVEL C: Branching Subchains</text>
          <rect x="30" y="275" width="90" height="36" rx="4" fill="hsl(30,8%,12%)" stroke="hsl(30,8%,25%)" />
          <text x="75" y="298" textAnchor="middle" fill="hsl(40,15%,65%)" fontFamily="JetBrains Mono, monospace" fontSize="10">Router</text>
          {/* Branches */}
          <rect x="170" y="260" width="130" height="24" rx="3" fill="hsl(30,8%,10%)" stroke="hsl(140,30%,30%)" />
          <text x="235" y="277" textAnchor="middle" fill="hsl(140,40%,55%)" fontFamily="JetBrains Mono, monospace" fontSize="9">internet_heavy</text>
          <rect x="170" y="290" width="130" height="24" rx="3" fill="hsl(30,8%,10%)" stroke="hsl(200,30%,35%)" />
          <text x="235" y="307" textAnchor="middle" fill="hsl(200,40%,55%)" fontFamily="JetBrains Mono, monospace" fontSize="9">records_heavy</text>
          <rect x="170" y="320" width="130" height="24" rx="3" fill="hsl(30,8%,10%)" stroke="hsl(30,20%,35%)" />
          <text x="235" y="337" textAnchor="middle" fill="hsl(30,30%,55%)" fontFamily="JetBrains Mono, monospace" fontSize="9">minimal_data</text>
          <line x1="120" y1="288" x2="165" y2="272" stroke="hsl(30,10%,30%)" strokeWidth="1" />
          <line x1="120" y1="293" x2="165" y2="302" stroke="hsl(30,10%,30%)" strokeWidth="1" />
          <line x1="120" y1="298" x2="165" y2="332" stroke="hsl(30,10%,30%)" strokeWidth="1" />
          <rect x="340" y="275" width="70" height="36" rx="4" fill="hsl(36,30%,10%)" stroke="hsl(36,60%,40%)" />
          <text x="375" y="298" textAnchor="middle" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="10" fontWeight="600">Merge</text>
          <line x1="300" y1="272" x2="335" y2="288" stroke="hsl(30,10%,30%)" strokeWidth="1" />
          <line x1="300" y1="302" x2="335" y2="293" stroke="hsl(30,10%,30%)" strokeWidth="1" />
          <line x1="300" y1="332" x2="335" y2="298" stroke="hsl(30,10%,30%)" strokeWidth="1" />

          {/* Level D */}
          <text x="30" y="380" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="13" fontWeight="600">LEVEL D: Dynamic Composition</text>
          <rect x="30" y="390" width="80" height="24" rx="3" fill="hsl(30,8%,12%)" stroke="hsl(30,8%,25%)" />
          <text x="70" y="407" textAnchor="middle" fill="hsl(40,15%,65%)" fontFamily="DM Sans, sans-serif" fontSize="9">Planner</text>
          <text x="130" y="407" fill="hsl(30,10%,40%)" fontFamily="JetBrains Mono, monospace" fontSize="9">→ builds chain at runtime based on gap analysis</text>
        </svg>
        <div className="diagram-caption">Four complexity levels — each builds on the previous one</div>
      </div>

      <h2 className="heading-section text-2xl mt-12 mb-6">Level A: Linear Pipeline</h2>
      <p>The simplest chain that maps to Architecture_V1. Each policy is a single link. No conditional branching. No feedback. Seed record goes in, enriched family_file comes out.</p>
      <p>The flow is: load seed record → construct P1 system prompt with name and class year → P1 agent runs its tool-use loop (searches, discovers family members, outputs candidates) → <strong>Gate A</strong> validates candidates against schema, filters below confidence threshold, checks for duplicates against existing family_files, creates or merges family_file → construct P2 system prompt with the family_file → P2 agent runs (searches, fills personal_data fields, outputs deltas) → <strong>Gate B</strong> validates deltas, runs merge strategy, checks relationship consistency, writes to disk.</p>
      <p>This is the right starting point because it teaches you the core mechanics: how system prompts and tool schemas shape agent behavior, how to design output schemas that serve both the LLM and the gate, how gates prevent error propagation, and what the latency profile looks like (each link takes 5-30 seconds depending on how many tool-use iterations the agent needs). But it has a critical limitation: there is no feedback between P1 and P2. The enrichment P2 discovers doesn't help P1 find more family members.</p>

      <h2 className="heading-section text-2xl mt-12 mb-6">Level B: Chain with Feedback Loop</h2>
      <p>This is where the Architecture_V1 insight comes to life. After P2 enriches the family_file, a <strong>feedback gate</strong> examines the enriched data and determines whether P1 should run again. The feedback gate doesn't make an LLM call — it applies heuristic rules to detect signals of undiscovered family members.</p>
      <p>Here's a concrete walkthrough. Pass 1: P1 receives "Alice Chen, MIT 2025." It searches the web, discovers Robert Chen (father) from a LinkedIn connection. Gate A creates the family_file with two members. P2 enriches both members. It discovers Robert Chen is CEO of Chen Industries. It discovers Alice has a sibling mentioned on a family foundation page: Brian Chen. Gate B writes the enrichment data.</p>
      <p>Now the feedback gate runs. It scans the enriched personal_data for references to people not in the family_file. It finds "Brian Chen" — referenced in the foundation page, not yet a member. It emits Brian as a new discovery target. P1 runs again, but this time it knows about the Chen family, Chen Industries, the foundation. It searches for Brian Chen with this context and finds him immediately — much higher recall than a cold search would have produced.</p>
      <p>The feedback loop <strong>must converge</strong>. Three mechanisms guarantee termination: a hard round cap (maximum N feedback iterations), a no-new-targets check (if the feedback gate returns nothing, stop), and a diminishing returns threshold (if the information gain per round drops below a minimum, stop). Without all three, the loop can theoretically run forever, which in practice means burning your token budget on increasingly marginal discoveries.</p>

      <h2 className="heading-section text-2xl mt-12 mb-6">Level C: Branching Chains</h2>
      <p>Not all family members need the same enrichment strategy. Alice Chen has LinkedIn, GitHub, and Instagram. Robert Chen has SEC filings and real estate records. Running the same generic P2 agent on both wastes tokens — Alice needs social media extraction tools, Robert needs public records tools.</p>
      <p>At Level C, the chain branches after a router classifies each member by their data profile. The router is a deterministic function, not an LLM call. It examines the member's existing data: if there are social media handles or email addresses, route to the internet-heavy subchain. If there's career or education data but no internet presence, route to the records-heavy subchain. If there's almost nothing, route to the minimal-data subchain.</p>
      <p>Each subchain is itself a mini-chain with its own gates, its own specialized tools, and its own prompts. The internet-heavy subchain might have three links: social media profile extraction → cross-platform identity linking → contact information enrichment. The records-heavy subchain might focus on public filings and employment records. After all subchains complete, a merge step reconciles overlapping data and writes the combined result.</p>

      <h2 className="heading-section text-2xl mt-12 mb-6">Level D: Dynamic Chain Composition</h2>
      <p>The chain structure itself is determined at runtime. A planner analyzes the family_file's current state — which fields are missing, what the field dependency graph looks like — and constructs a chain tailored to the specific gaps. Education data is filled before career data (because knowing the university helps find the employer). Career data is filled before affiliations (because knowing the company helps find industry organizations). This ordering is derived from a topological sort of the field dependency graph.</p>
      <p>Dynamic composition is post-MVP complexity. It's documented here so the architecture doesn't prevent it, but it requires chain instrumentation (telemetry on what each link produces) and enough historical data to inform the planner's decisions. For now, static chains (Levels A-C) are sufficient.</p>

      <h2 className="heading-section text-2xl mt-12 mb-6">Chain Composition Patterns</h2>
      <p>Chains can be composed in four ways, and your Architecture_V1 pipeline will use all four:</p>
      <p><strong>Sequential:</strong> Output of A feeds B. This is P1 → gate → P2. The simplest composition.</p>
      <p><strong>Parallel:</strong> Both links receive the same input. Results are merged. Useful for running per-member enrichment on multiple members concurrently — each member's P2 agent runs in parallel since they're independent.</p>
      <p><strong>Conditional:</strong> Routing determines which link runs. Only one executes. This is the Level C branching pattern — the router picks a subchain.</p>
      <p><strong>Iterative:</strong> The same link runs repeatedly with updated state. This is the Level B feedback loop — P1 → P2 → feedback gate → back to P1.</p>
      <p>Your complete pipeline combines all four: sequential (P1 → P2 for each student), iterative (feedback loop between P1 and P2), conditional (route members to specialized subchains), and parallel (run subchains concurrently).</p>

      <h2 className="heading-section text-2xl mt-12 mb-6">Debugging Chains</h2>
      <p>When the final output is wrong, how do you find which link or gate introduced the error? Three practices make chains debuggable.</p>
      <p><strong>Trace logging.</strong> Every gate logs its input, its decision, and its output. The chain trace gives you a complete picture: which agent was dispatched at each link, how many tokens it consumed, how many tool calls it made, what the gate passed through or filtered out. This is your primary debugging tool.</p>
      <p><strong>Gate replay.</strong> Since gates are deterministic, you can save the input to any gate and replay it later. If a gate incorrectly filtered a valid candidate, you can reproduce the exact scenario with the saved input. This is far harder to do with LLM-based evaluators, which is another reason gates should not make LLM calls.</p>
      <p><strong>Diff comparison.</strong> Compare the family_file state before and after each link. The diff tells you exactly what changed: new members added, fields filled, edges created. If a field is wrong, the diff shows which link introduced it. Combined with the chain trace, this gives you root-cause analysis in minutes rather than hours.</p>
    </article>
  );
}
