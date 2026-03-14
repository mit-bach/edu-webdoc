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

export default function Ch1PolicyArchitecture() {
  return (
    <article className="prose-body">
      <div className="chapter-badge">Chapter 01</div>
      <h1 className="heading-display text-4xl mb-3">The Policy Architecture</h1>
      <p className="text-lg mb-10" style={{ color: "hsl(30 10% 50%)", fontFamily: "'DM Sans', sans-serif" }}>
        Why an LLM_Policy is not an agent, and why the distinction determines whether your system can evolve.
      </p>

      <h2 className="heading-section text-2xl mt-12 mb-6">The Fundamental Misconception</h2>
      <p>
        When people first encounter the Architecture_V1 spec, the natural instinct is to treat <code className="code-inline">LLM_Policy_1</code> and <code className="code-inline">LLM_Policy_2</code> as agents — as entities that receive input, reason about it, call tools, and produce output. This mental model is wrong, and building on it will create a system that cannot adapt, cannot be tuned, and will hit a ceiling you cannot move past.
      </p>
      <p>
        An agent is a stateless executor. It receives a system prompt, a set of tools, an input message, and runs a loop: call the LLM, execute any tool requests, feed results back, repeat until the model decides it's done. The agent doesn't know why it was invoked, what came before it, or what happens after it. It is a worker bee.
      </p>
      <p>
        A policy is the intelligence that manages workers. It observes the current state of the data — how much is known about a family, which fields are populated, what tools are likely to be productive, how many times we've already tried — and makes a decision: <strong>which agent configuration should we dispatch?</strong> The policy selects the system prompt template, the tool set, the output schema, the model, the temperature, and the token budget. It packages all of this into an <code className="code-inline">AgentConfig</code> and hands it to a generic agent executor.
      </p>
      <p>
        This separation is not an architectural nicety. It is the difference between a system that requires code changes every time you want to change behavior, and a system where behavior is data-driven and composable.
      </p>

      <div className="callout">
        <strong style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem" }}>The Core Principle</strong>
        <p className="mt-2 mb-0">A policy encodes <em>what</em> data we need and <em>when</em> different strategies apply. An agent encodes <em>how</em> to execute a single retrieval or enrichment task. The policy maintains state awareness across the population; agents are stateless executors.</p>
      </div>

      <h2 className="heading-section text-2xl mt-12 mb-6">Anatomy of a Policy</h2>
      <p>
        Every policy — whether it's Policy 1 (family discovery) or Policy 2 (profile enrichment) — is composed of four components that operate in sequence each time a piece of work needs to be done. Understanding these four components is essential because they are the joints in the system. When something goes wrong, or when you want to change behavior, you need to know which component to modify.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">1. The State Evaluator</h3>
      <p>
        Before anything else happens, the policy examines the current state of its target. For Policy 1, the target is either a seed student (cold start — we know nothing but a name and class year) or an existing family_file (subsequent pass — we know the family structure and possibly enrichment data). For Policy 2, the target is always a family_file, and the question is which fields are missing and which members need attention.
      </p>
      <p>
        The state evaluator produces a <code className="code-inline">PolicyState</code> object — a snapshot of everything the policy needs to make its routing decision. This includes the family_file itself (or null on cold start), the target member, a data profile summarizing what exists and what's missing, the pass number (first time seeing this family? second? fifth?), and confidence scores from prior runs. Think of the PolicyState as the dashboard the policy checks before deciding which tool to reach for.
      </p>
      <p>
        Critically, the state evaluator is <strong>cheap</strong>. It reads metadata and computes summaries. It does not make LLM calls. It does not search the web. It runs in milliseconds, not seconds. This matters because the state evaluator runs on every single work unit in the queue, and the queue might contain thousands of items.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">2. The Agent Selector</h3>
      <p>
        This is the brain of the policy. Given a PolicyState, the selector chooses which agent to dispatch. In the MVP, this is a simple function with conditional branches — essentially a decision tree. If there's no family_file yet, use the cold start agent. If there's a family_file but no enrichment data, use the contextual discovery agent. If enrichment data exists, use the enrichment-aware agent. If this is a second or third pass, use the cross-reference agent.
      </p>
      <p>
        The reason the selector is a separate component (and not embedded in the agent itself) is that the selector's logic evolves independently of the agents. You might add new routing rules without changing any agent. You might add a new agent without changing the routing rules for existing ones. And in the post-MVP world, the selector becomes the target of the skill system — where learned routing replaces hard-coded branches based on historical performance data.
      </p>
      <p>
        The selector is also <strong>deterministic</strong>. Given the same PolicyState, it always returns the same AgentConfig. This property is essential for debugging: if a family_file is getting bad results, you can inspect the PolicyState, run it through the selector, and see exactly which agent was chosen and why. There is no randomness, no LLM call, no ambiguity in the routing decision.
      </p>

      {/* SVG Diagram */}
      <div className="diagram-container">
        <svg viewBox="0 0 740 320" xmlns="http://www.w3.org/2000/svg" className="w-full" style={{ maxWidth: 740 }}>
          {/* Background groups */}
          <rect x="20" y="20" width="700" height="280" rx="8" fill="none" stroke="hsl(30,8%,20%)" strokeDasharray="4,4" />
          <text x="40" y="50" fill="hsl(36,60%,55%)" fontFamily="DM Sans, sans-serif" fontSize="14" fontWeight="600">LLM_POLICY</text>

          {/* State Evaluator */}
          <rect x="50" y="80" width="140" height="70" rx="6" fill="hsl(30,8%,12%)" stroke="hsl(36,50%,35%)" />
          <text x="120" y="110" textAnchor="middle" fill="hsl(40,20%,85%)" fontFamily="DM Sans, sans-serif" fontSize="12" fontWeight="600">State</text>
          <text x="120" y="128" textAnchor="middle" fill="hsl(40,20%,85%)" fontFamily="DM Sans, sans-serif" fontSize="12" fontWeight="600">Evaluator</text>

          {/* Selector */}
          <rect x="230" y="80" width="140" height="70" rx="6" fill="hsl(30,8%,12%)" stroke="hsl(200,50%,40%)" />
          <text x="300" y="110" textAnchor="middle" fill="hsl(40,20%,85%)" fontFamily="DM Sans, sans-serif" fontSize="12" fontWeight="600">Agent</text>
          <text x="300" y="128" textAnchor="middle" fill="hsl(40,20%,85%)" fontFamily="DM Sans, sans-serif" fontSize="12" fontWeight="600">Selector</text>

          {/* Config Builder */}
          <rect x="410" y="80" width="140" height="70" rx="6" fill="hsl(30,8%,12%)" stroke="hsl(140,40%,35%)" />
          <text x="480" y="110" textAnchor="middle" fill="hsl(40,20%,85%)" fontFamily="DM Sans, sans-serif" fontSize="12" fontWeight="600">Config</text>
          <text x="480" y="128" textAnchor="middle" fill="hsl(40,20%,85%)" fontFamily="DM Sans, sans-serif" fontSize="12" fontWeight="600">Builder</text>

          {/* Executor */}
          <rect x="590" y="80" width="110" height="70" rx="6" fill="hsl(36,30%,12%)" stroke="hsl(36,80%,50%)" strokeWidth="2" />
          <text x="645" y="110" textAnchor="middle" fill="hsl(36,80%,56%)" fontFamily="DM Sans, sans-serif" fontSize="12" fontWeight="700">Agent</text>
          <text x="645" y="128" textAnchor="middle" fill="hsl(36,80%,56%)" fontFamily="DM Sans, sans-serif" fontSize="12" fontWeight="700">Executor</text>

          {/* Arrows */}
          <line x1="190" y1="115" x2="225" y2="115" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="370" y1="115" x2="405" y2="115" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="550" y1="115" x2="585" y2="115" stroke="hsl(30,10%,35%)" strokeWidth="1.5" markerEnd="url(#arrow)" />

          {/* Labels */}
          <text x="207" y="105" textAnchor="middle" fill="hsl(30,10%,40%)" fontFamily="JetBrains Mono, monospace" fontSize="9">PolicyState</text>
          <text x="387" y="105" textAnchor="middle" fill="hsl(30,10%,40%)" fontFamily="JetBrains Mono, monospace" fontSize="9">agent_key</text>
          <text x="567" y="105" textAnchor="middle" fill="hsl(30,10%,40%)" fontFamily="JetBrains Mono, monospace" fontSize="9">AgentConfig</text>

          {/* Agent Registry */}
          <rect x="230" y="185" width="320" height="100" rx="6" fill="hsl(30,8%,9%)" stroke="hsl(30,8%,18%)" />
          <text x="390" y="210" textAnchor="middle" fill="hsl(30,10%,45%)" fontFamily="DM Sans, sans-serif" fontSize="11" fontWeight="600" textDecoration="uppercase">Agent Registry</text>
          <text x="260" y="235" fill="hsl(40,15%,65%)" fontFamily="JetBrains Mono, monospace" fontSize="10">cold_start_discovery</text>
          <text x="260" y="253" fill="hsl(40,15%,65%)" fontFamily="JetBrains Mono, monospace" fontSize="10">contextual_discovery</text>
          <text x="260" y="271" fill="hsl(40,15%,65%)" fontFamily="JetBrains Mono, monospace" fontSize="10">enrichment_aware_discovery</text>

          {/* Connection from selector to registry */}
          <line x1="300" y1="150" x2="300" y2="182" stroke="hsl(30,10%,30%)" strokeWidth="1" strokeDasharray="3,3" />

          {/* Input arrow */}
          <text x="35" y="120" textAnchor="middle" fill="hsl(30,10%,30%)" fontFamily="DM Sans, sans-serif" fontSize="10" transform="rotate(-90,35,120)">input</text>

          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(30,10%,35%)" />
            </marker>
          </defs>
        </svg>
        <div className="diagram-caption">The four components of an LLM_Policy, operating left-to-right on each work unit</div>
      </div>

      <h3 className="heading-sub text-xl mt-8 mb-4">3. The Config Builder</h3>
      <p>
        Once the selector has chosen an agent, the config builder assembles everything that agent needs to run. This is not just picking a prompt template — it is constructing the complete execution environment. The config builder selects the system prompt template and fills in the variables from the PolicyState (the student's name, the family_file contents, any population context on later passes). It selects the tool set — which tools are available to this agent. It selects the output schema — the Pydantic model or JSON Schema that the agent's final output must conform to. It sets operational parameters: model name, temperature, max iterations, token budget.
      </p>
      <p>
        The resulting <code className="code-inline">AgentConfig</code> is a complete, self-contained description of a single agent invocation. It carries everything needed to run the agent loop without any external context. This is important for parallelization: you can serialize an AgentConfig, send it to a worker process, and the worker can execute it independently.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">4. The Agent Executor</h3>
      <p>
        The executor is the generic agent loop. It is the <strong>same code</strong> for every agent — what changes between agents is the config, not the loop. The executor takes an AgentConfig, constructs the initial message, and enters the tool-use loop: call the LLM, check if it wants to use tools, execute those tools, feed results back, repeat until the model stops or the iteration cap is hit.
      </p>
      <p>
        Making the executor generic is a deliberate design choice. It means you never write agent-specific loop logic. You never have a "discovery agent loop" and a separate "enrichment agent loop" with slightly different iteration handling. There is one loop, parameterized by the config. If you want to change how an agent behaves, you change its prompt template, its tools, or its schema — never the loop itself.
      </p>
      <p>
        This pattern comes directly from Anthropic's guidance on building production agent systems. In their words: the complexity should live in the prompt and tool definitions, not in the orchestration code. The orchestration code (the loop) should be simple enough that you can read it in thirty seconds and trust that it does the right thing.
      </p>

      <h2 className="heading-section text-2xl mt-12 mb-6">Responsibility Boundaries</h2>
      <p>
        The clean separation between policy and agent creates clear responsibility boundaries that matter enormously when debugging. When a family_file has bad data, the question is: was it the policy's fault (chose the wrong agent) or the agent's fault (the right agent executed poorly)? If the agent selection was correct but the output was wrong, you debug the prompt or tool set. If the selection was wrong — the system dispatched a cold-start agent when enrichment data was available — you debug the selector logic.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Concern</th>
            <th>Policy's Job</th>
            <th>Agent's Job</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Which agent to run</td><td>✓ Selects from registry</td><td>—</td></tr>
          <tr><td>What tools are available</td><td>✓ Picks the tool set</td><td>Uses provided tools</td></tr>
          <tr><td>When to stop a family_file</td><td>✓ Convergence logic</td><td>—</td></tr>
          <tr><td>When to reopen a file</td><td>✓ Re-entry priority</td><td>—</td></tr>
          <tr><td>Ordering across population</td><td>✓ Queue management</td><td>—</td></tr>
          <tr><td>Prompt construction</td><td>✓ Template selection</td><td>Follows system prompt</td></tr>
          <tr><td>Tool execution within a run</td><td>—</td><td>✓ Calls tools, observes results</td></tr>
          <tr><td>Reasoning about data</td><td>—</td><td>✓ LLM-driven reasoning</td></tr>
          <tr><td>Structured output generation</td><td>—</td><td>✓ Fills output schema</td></tr>
          <tr><td>Deciding next tool call</td><td>—</td><td>✓ Within its loop</td></tr>
        </tbody>
      </table>

      <h2 className="heading-section text-2xl mt-12 mb-6">Policy 1 vs Policy 2: The Structural Difference</h2>
      <p>
        Both policies share the exact same four-component pattern — state evaluator, selector, config builder, executor. What differs is the content of their agent registries and the logic in their selectors, because they have fundamentally different objectives.
      </p>
      <p>
        <strong>Policy 1 agents are oriented around discovery.</strong> Their goal is finding new family members — new nodes in the family graph. The policy routes based on how much is already known. A cold start agent gets only a name and class year. A contextual agent gets the existing family_file. An enrichment-aware agent gets the family_file plus personal_data from Policy 2, which dramatically improves recall — this is the core insight from Architecture_V1 that the entire feedback loop is built around.
      </p>
      <p>
        <strong>Policy 2 agents are oriented around enrichment.</strong> Their goal is filling in personal_data fields — education, career, affiliations, internet presence. The policy routes based on two axes: which fields are missing, and whether per-member or whole-family mode is more appropriate. Per-member mode is efficient and parallelizable — run one agent per member, each with a targeted prompt for the missing fields. Whole-family mode is more accurate for interconnected data — when the system prompt includes all family members, the LLM can cross-reference and discover data that wouldn't surface from looking at one member in isolation.
      </p>
      <p>
        The choice between per-member and whole-family mode is a policy decision, not an agent decision. The policy examines the family_file and makes a determination: is the family small enough to fit in one context window? Are there shared assets that need propagation? Is the relationship data sparse enough that inter-member context would help? These questions are answered by the state evaluator and the selector, and the agent never knows it was chosen over an alternative.
      </p>

      <div className="callout-blue callout">
        <strong style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem" }}>Why This Matters for the Feedback Loop</strong>
        <p className="mt-2 mb-0">The Architecture_V1 spec says: "When personal_data from LLM_Policy_2 is available, [P1] returns higher-recall family members." The <em>mechanism</em> for this is the policy's selector. On pass 1, the selector dispatches <code className="code-inline">cold_start_discovery</code>. On pass 2, after P2 has run, the state evaluator detects enrichment data, and the selector dispatches <code className="code-inline">enrichment_aware_discovery</code> — a different agent with a different prompt that includes career, education, and affiliation data. The agent itself doesn't "know" it's on pass 2. It just received a richer prompt with more context, and that context lets it discover more family members.</p>
      </div>

      <h2 className="heading-section text-2xl mt-12 mb-6">The Agent Registry</h2>
      <p>
        Each policy maintains a registry of available agents. A registry entry is not code — it's metadata: a description of what the agent does, what inputs it requires, which prompt template it uses, which tools it needs, what output schema it produces, and rough cost estimates. The selector uses this metadata to make its routing decisions. The config builder uses it to assemble the AgentConfig.
      </p>
      <p>
        For the MVP, the registries are small. Policy 1 might have three agents: cold start, contextual discovery, and enrichment-aware discovery. Policy 2 might have four: per-member general, per-member targeted, whole-family, and shared-asset propagation. As the system evolves, the registries grow. The cross-reference discovery agent (which queries the population index) is a post-MVP addition. The skill system (which learns optimal agent-profile pairings from telemetry) is even further out.
      </p>
      <p>
        The key property of the registry is that adding a new agent requires <strong>no changes to the executor</strong>. You add a registry entry (metadata), add a new branch to the selector, and write a new prompt template. The loop is unchanged. The tools are composed from existing tool definitions. This is how the system scales: not by making the loop smarter, but by making the routing smarter and the prompt library richer.
      </p>

      <CodeToggle label="Example: Policy 1 Agent Registry (Python)">
        <pre className="code-block">{`P1_AGENTS = {
    "cold_start": {
        "description": "Initial discovery from name + class_year only",
        "requires": [],
        "prompt_template": "p1_cold_start",
        "tools": ["web_search", "create_family_file"],
        "output_schema": "CandidateFamilyMembers",
        "expected_yield": "2-5 candidates",
        "token_cost": "~2k input, ~1k output",
    },
    "contextual_discovery": {
        "description": "Discovery using existing family_file context",
        "requires": ["family_file"],
        "prompt_template": "p1_with_context",
        "tools": ["web_search", "merge_member", "read_family_file"],
        "output_schema": "CandidateFamilyMembers",
        "expected_yield": "1-3 new candidates",
    },
    "enrichment_aware_discovery": {
        "description": "Discovery leveraging personal_data from P2",
        "requires": ["family_file", "personal_data"],
        "prompt_template": "p1_enrichment_aware",
        "tools": ["web_search", "merge_member", "read_family_file"],
        "output_schema": "CandidateFamilyMembers",
        "expected_yield": "1-4 new candidates (higher recall)",
    },
}`}</pre>
      </CodeToggle>

      <h2 className="heading-section text-2xl mt-12 mb-6">Implementation Priority</h2>
      <p>
        For the MVP, the selector is a simple Python function with two or three <code className="code-inline">if</code> branches per policy. The agent executor is generic from day one — the same loop runs cold start discovery and whole-family enrichment and everything in between, parameterized solely by the AgentConfig. Prompt templates and tool sets are the only things that change between agents, which means the primary development effort is in prompt engineering and tool implementation, not in control flow.
      </p>
      <p>
        Post-MVP, the selector becomes data-driven. Routing rules can be updated from configuration without code changes. Eventually, the skill system makes the selector partially learned — it observes which agent configurations produce the best results for different data profiles and routes accordingly. But this evolution is only possible because the policy-agent boundary was clean from the start. If the selector logic were entangled with the agent loop, learning would require rewriting the loop — an order of magnitude more complex.
      </p>
    </article>
  );
}
