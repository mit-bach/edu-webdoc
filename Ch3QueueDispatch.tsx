import { useState } from "react";
const CodeToggle = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (<div className="my-4"><button onClick={() => setOpen(!open)} className="code-toggle-btn">{open ? "▾" : "▸"} {label}</button>{open && <div className="mt-2">{children}</div>}</div>);
};

export default function Ch3QueueDispatch() { return (<article className="prose-body">
  <div className="chapter-badge">Chapter 03</div>
  <h1 className="heading-display text-4xl mb-3">Queue: Agent Dispatch</h1>
  <p className="text-lg mb-10" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-body)" }}>The queue system serves two distinct purposes. This chapter covers the first: given a policy and a target, which agent do we run, with what data, and when is its job done?</p>

  <h2 className="heading-section text-2xl mt-12 mb-6">The Two Queue Problems</h2>
  <p>The queue system in Architecture_V1 is not one system — it is two systems that happen to share a data structure. Conflating them leads to confusion about responsibilities and, worse, to code where population-level traversal logic is tangled with per-unit dispatch logic, making both harder to modify independently.</p>
  <p>The first system, covered in this chapter, is <strong>intra-policy dispatch</strong>: given a specific piece of work to do (enrich this member, discover this family), how do we select the right agent configuration, prioritize it against other work, manage its dependencies, and track its lifecycle? This system operates at the level of individual work units — it doesn't know or care about the broader population strategy.</p>
  <p>The second system, covered in Chapter 4, is <strong>population-level traversal</strong>: given N students in the seed CSV, in what order do we process them, how deep do we go on each family before moving to the next, and when do we come back for subsequent passes? This system operates at the level of families and phases — it doesn't know or care about the mechanics of individual agent invocations.</p>
  <p>These two systems interact — the traversal system feeds work into the dispatch queue, and the dispatch queue's results influence the traversal system's decisions about what to process next — but they have different concerns, different state, and different optimization criteria. The dispatch queue optimizes for <em>agent effectiveness per work unit</em>: choosing the right agent, giving it the right tools, and tracking whether it succeeded. The traversal system optimizes for <em>information yield across the population</em>: deciding which families deserve more attention and when to move on. Mixing these concerns in a single queue leads to a system that does neither well. Keep them separate from day one.</p>

  <div className="section-divider">The Work Unit</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">Anatomy of a Work Unit</h2>
  <p>The atomic unit of work in the dispatch queue is a <code className="code-inline">WorkUnit</code>. It represents a single agent invocation waiting to happen — everything the system needs to dispatch an agent, track its progress, and handle its outcome. Designing the work unit well is critical because it is the contract between the traversal system (which creates work units) and the dispatch system (which processes them). If the contract is unclear, both systems become harder to build and debug.</p>
  <p>A work unit captures several categories of information. The <strong>identity</strong> fields tell you what this work is about: a unique ID, the family_id, the target member_id (null for whole-family operations), and which policy governs this work ("p1" or "p2"). The <strong>state snapshot</strong> fields capture the target's data state at the time the unit was enqueued: the pass number, a DataProfile summary, and any specific fields requested (for targeted P2 enrichment). The <strong>constraint</strong> fields bound the work: a token budget, an iteration cap, and an optional deadline for time-bounded processing. The <strong>provenance</strong> fields tell you where this work came from: what created it (initial BFS pass? feedback gate? manual re-queue?) and what other work units it depends on. Finally, the <strong>execution tracking</strong> fields record what happened: attempt count, last attempt timestamp, and last result status.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">The Data Profile</h3>
  <p>The data profile deserves special attention because it serves a dual purpose. For priority scoring, it provides the signals needed to rank work units: how empty is this member's profile? Does the member have internet presence (which makes web-search-based enrichment more likely to succeed)? How many relationship edges exist (which affects whether cross-referencing is viable)? For agent selection, it provides the signals the policy's selector needs to choose the right agent: does education data exist (enabling enrichment-aware discovery)? How many members are in the family (affecting the per-member vs whole-family mode decision)?</p>
  <p>Computing the data profile is cheap — it reads metadata and counts fields, consuming milliseconds rather than the seconds an LLM call takes. This matters because the data profile is computed for every work unit in the queue, and the queue might contain thousands of items during a BFS phase. If computing the profile required loading and parsing the full family_file, the queue management overhead would become significant. Instead, the profile can be cached and updated incrementally: when a merge operation writes to a family_file, it also updates the cached profile for that family.</p>

  <div className="callout">
    <strong>Why snapshot the data profile at queue time?</strong>
    <p className="mt-2 mb-0">Between when a work unit is enqueued and when it's actually dispatched, other agents may have modified the family_file. The queued data profile becomes stale. This is intentional — the policy selector re-evaluates the current state at dispatch time, using the queued profile only for priority scoring. If the data has changed dramatically (another agent already filled the fields this unit was targeting), the selector may choose a different agent or skip the work unit entirely. The queued profile is a hint for ordering, not a binding contract.</p>
  </div>

  <CodeToggle label="WorkUnit and DataProfile structures">
    <div className="code-block" data-lang="python">{`@dataclass
class WorkUnit:
    id: str
    family_id: str
    target_member_id: Optional[str]    # None for whole-family ops
    policy: str                         # "p1" or "p2"
    priority: float                     # Higher = process sooner

    # State snapshot at queue time
    pass_number: int
    data_profile: DataProfile
    requested_fields: list[str]         # P2 targeted enrichment

    # Constraints
    max_tokens: int
    max_iterations: int
    deadline: Optional[datetime]

    # Provenance
    created_by: str                     # "bfs_phase_1", "feedback_gate", etc.
    depends_on: list[str]               # WorkUnit IDs that must complete first

    # Execution tracking
    attempts: int = 0
    last_attempt: Optional[datetime] = None
    last_result: Optional[str] = None   # "completed", "partial", "failed", "skipped"

@dataclass
class DataProfile:
    member_count: int
    fields_populated: dict[str, int]    # category -> count of filled fields
    fields_total: dict[str, int]        # category -> total possible fields
    has_internet_presence: bool
    has_education_data: bool
    has_career_data: bool
    relationship_count: int
    confidence_floor: float
    last_modified: datetime
    byte_size: int                      # For context window budgeting`}</div>
  </CodeToggle>

  <h2 className="heading-section text-2xl mt-12 mb-6">Priority Scoring</h2>
  <p>The dispatch queue is a priority queue — work units with higher priority scores are processed first. The priority score is a composite of several signals, each capturing a different dimension of urgency or expected value. The score is recomputed at dequeue time (not just at enqueue time) to reflect any changes in the global state since the unit was queued.</p>
  <p><strong>Pass number penalty.</strong> First-pass work units are more valuable than second-pass ones, which are more valuable than third-pass. The first pass fills the most fields and discovers the most members per token spent — this is a consistent empirical pattern across LLM-based information extraction. Later passes have diminishing returns because the easy-to-find information has already been found. A simple linear penalty captures this: <code className="code-inline">base_score = max(0, 10 - pass_number × 3)</code>. First pass gets 7 points, second pass gets 4, third pass gets 1, and anything beyond that gets 0 base points.</p>
  <p><strong>Data sparsity bonus.</strong> Members with emptier profiles have more room to grow — each field filled represents a larger proportional improvement in the family_file's completeness. A member at 10% fill rate benefits more from enrichment than one at 80%, and the enrichment is more likely to succeed (the missing fields are the common ones that web search can typically find). The sparsity bonus is proportional to the gap: <code className="code-inline">(1 - fill_ratio) × 5</code>. A completely empty profile gets 5 bonus points; a 50%-filled profile gets 2.5.</p>
  <p><strong>Dependency resolution bonus.</strong> If other work units depend on this one — for example, P2 enrichment is waiting for P1 discovery to complete — this unit should be processed sooner to unblock the dependents. The bonus is proportional to the number of waiting dependents: <code className="code-inline">dependent_count × 2</code>. This naturally prioritizes "bottleneck" work that blocks the most downstream processing.</p>
  <p><strong>Recency cooldown.</strong> Avoid hammering the same family_file repeatedly in quick succession. If this family was processed within the last hour, apply a penalty of -5. This serves two purposes: it spreads API calls across different search targets (reducing the chance of search engine rate limiting or getting cached/stale results), and it gives other families a chance to advance in the queue. The cooldown is a soft penalty, not a hard block — if a family has the highest priority even with the penalty, it still gets processed.</p>
  <p><strong>Retry penalty.</strong> Each failed attempt reduces priority by 2 points. A work unit that has failed 3 times is likely hitting a data availability wall — the information simply doesn't exist online, or the LLM consistently misinterprets the search results. Spending more tokens on it is unlikely to yield new results. The penalty is <code className="code-inline">-attempts × 2</code>, so after 3 failures the unit has lost 6 points — enough to push it well below fresh first-pass units, but not enough to completely prevent retries if nothing else is in the queue.</p>

  <CodeToggle label="Priority scoring function">
    <div className="code-block" data-lang="python">{`def compute_priority(unit: WorkUnit, global_state: GlobalState) -> float:
    score = 0.0

    # Pass number: first passes are most valuable
    score += max(0, 10 - unit.pass_number * 3)

    # Sparsity: emptier profiles have more upside
    fill_ratio = (sum(unit.data_profile.fields_populated.values())
                  / max(sum(unit.data_profile.fields_total.values()), 1))
    score += (1 - fill_ratio) * 5

    # Dependency: unblock downstream work
    dependent_count = global_state.count_dependents(unit.id)
    score += dependent_count * 2

    # Cooldown: avoid hammering the same family
    if unit.last_attempt:
        hours_since = (now() - unit.last_attempt).total_seconds() / 3600
        if hours_since < 1:
            score -= 5

    # Retry: diminishing returns on failures
    score -= unit.attempts * 2

    return score`}</div>
  </CodeToggle>

  <div className="section-divider">Agent Registries</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">P1 Agent Registry</h2>
  <p>Policy 1 (family discovery) maintains a registry of agents, each optimized for a different discovery scenario. The registry is a static data structure in the MVP — essentially a lookup table keyed by agent name. Each entry specifies everything needed to construct an AgentConfig: the agent's description and purpose, its prerequisites (what data must exist before this agent can run), the prompt template key, the tool set, the output schema, expected yield metrics, and estimated token cost.</p>
  <p>The registry isn't just a code artifact — it's a design document that makes the system's capabilities legible. By reading the registry, you can immediately understand what discovery strategies exist, what data each one needs, and what each one costs. This legibility pays off during debugging (why did the policy choose this agent instead of that one?) and during extension (what gap in coverage would a new agent fill?).</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">The Four P1 Agents</h3>
  <p><strong>cold_start</strong> handles the initial discovery from a bare name and class year — no family_file exists yet. This is the most constrained scenario: the agent has essentially nothing to work with except the student's identity. It uses web search to find the student (LinkedIn, university directories, social media), then looks for family mentions in the results. The prompt emphasizes broad but cautious search — cast a wide net but require concrete evidence before reporting a candidate. Expected yield is 2-5 candidate family members. Token cost is low (~2k input, ~1k output) because the prompt is small and the agent typically completes in 2-3 iterations.</p>
  <p><strong>contextual_discovery</strong> runs when a family_file exists but lacks enrichment data — we know the family structure (member names and relationships) but haven't run P2 yet. The agent uses existing member names to construct more targeted searches: instead of just "Alice Chen MIT," it can search "Alice Chen Robert Chen family" or "Chen family [hometown]." The family_file context in the prompt gives the model relational clues that improve search query formulation. Expected yield is 1-3 new candidates, because the easy discoveries (parents, siblings with the same last name) were likely found in cold_start.</p>
  <p><strong>enrichment_aware_discovery</strong> runs when P2 has produced personal_data — career information, affiliations, internet accounts, education details. This is the agent that demonstrates the P1↔P2 feedback loop's value (Chapter 2, Level B). With enrichment data, the agent can construct highly specific searches: "Robert Chen Goldman Sachs managing director" instead of just "Robert Chen." It can follow affiliation trails: if Robert Chen is listed as a trustee of the Chen Family Foundation, the agent can search for other trustees who might be family members. Expected yield is 1-4 new candidates, but with significantly higher precision — the candidates found through enrichment-aware search tend to be real family members, not false positives.</p>
  <p><strong>cross_reference</strong> (post-MVP) uses the population index to find connections across families. If Alice Chen's father Robert works at Goldman Sachs, and Bob Park's mother also works at Goldman Sachs, there might be a connection worth exploring. The cross_reference agent queries the population index for shared employers, schools, locations, and affiliations, then investigates potential family links. This agent is explicitly out of scope for the MVP because it requires the population index, which requires at least one full BFS pass to populate.</p>

  <div className="pull-quote">
    The registry is a design document that makes the system's capabilities legible. By reading it, you understand what strategies exist, what each needs, and what each costs.
  </div>

  <h3 className="heading-sub text-xl mt-8 mb-4">P1 Selection Logic</h3>
  <p>The selector maps a DataProfile to an agent key. For the MVP, this is three branches:</p>

  <CodeToggle label="P1 agent selection">
    <div className="code-block" data-lang="python">{`def select_p1_agent(unit: WorkUnit) -> str:
    profile = unit.data_profile

    if profile.member_count == 0:
        return "cold_start"

    if not profile.has_education_data and not profile.has_career_data:
        return "contextual_discovery"

    if profile.has_education_data or profile.has_career_data:
        return "enrichment_aware_discovery"

    return "contextual_discovery"  # Default fallback`}</div>
  </CodeToggle>

  <p>Notice the selector's simplicity. It doesn't use the pass number (that's the priority scorer's job). It doesn't consider the token budget (that's the config builder's job). It doesn't evaluate whether the agent is likely to succeed (that's the skill system's job, post-MVP). The selector has one responsibility: given the data that exists, pick the agent that's best equipped to find what we're looking for. Clean separation of concerns makes each component testable and independently modifiable.</p>

  <h2 className="heading-section text-2xl mt-12 mb-6">P2 Agent Registry</h2>
  <p>Policy 2 (profile enrichment) has its own registry, with a fundamentally different structure. Where P1 agents vary by <em>how much context is available</em> for discovery, P2 agents vary by <em>execution mode</em> — whether they process a single member or the whole family, and whether they target specific fields or enrich broadly.</p>
  <p>The <strong>per_member_general</strong> agent enriches a single member with no specific field targets. It searches broadly for any available information about the person — education, career, internet presence, affiliations. The prompt gives the model the member's name, known relationships, and any existing data, then asks it to fill as many personal_data fields as possible. This is the workhorse agent for first-pass enrichment.</p>
  <p>The <strong>per_member_targeted</strong> agent enriches a single member but focuses on specific missing fields. The work unit's <code className="code-inline">requested_fields</code> list tells the agent exactly what to look for — "career.company," "internet.linkedin," "education.major." The prompt and output schema are narrowed to these fields only, which reduces token waste and improves accuracy. The model doesn't spend attention on already-known data or irrelevant field categories. This agent is dispatched by feedback gates that identify specific gaps.</p>
  <p>The <strong>whole_family</strong> agent processes the entire family at once. The full family_file is injected into the prompt, and the model reasons across all members simultaneously. This mode excels at filling relationship-dependent fields: inferring a parent's approximate age from their child's class year, deducing shared addresses from family context, identifying siblings who attend the same university. The cost is higher context usage (the full family in the prompt) and higher output tokens (deltas for multiple members), but the accuracy gain on inter-dependent fields is substantial.</p>
  <p>The <strong>shared_asset_propagation</strong> agent is a specialized post-processing step, not a general enrichment agent. It reads the family_file, identifies shared assets that haven't been propagated to all linked members (an address known for the father but not yet assigned to the children, a family trust with unlisted beneficiaries), and generates the propagation deltas. This agent doesn't do web search — it operates entirely on data already in the file. Its purpose is to maximize the value of data that's already been collected.</p>

  <h3 className="heading-sub text-xl mt-8 mb-4">Mode Selection Logic</h3>
  <p>The mode selector is a deterministic function — not an LLM call — that evaluates several factors to choose between per-member and whole-family processing. The logic is a decision tree with clear priorities.</p>
  <p><strong>Hard constraint: context budget.</strong> If the entire family_file's estimated token count exceeds the context budget for whole-family mode, per-member is the only option. There's no point trying to stuff a 20k-token family_file into a prompt that has 15k tokens of headroom. This check runs first and short-circuits the rest of the decision tree.</p>
  <p><strong>Shared assets pending.</strong> If the family has shared assets that haven't been propagated yet, the shared_asset_propagation agent should run before other enrichment. Propagation is cheap (no web search) and can fill multiple members' fields in one pass, making subsequent per-member enrichment more efficient because it won't waste searches on data that propagation would have provided for free.</p>
  <p><strong>Small families benefit from whole-family context.</strong> For families with 6 or fewer members and sparse relationship data (relationship density below 50%), whole-family mode provides a significant accuracy boost. The model can cross-reference members against each other, catching errors and filling gaps that per-member mode would miss. Above 6 members, the context cost starts to outweigh the accuracy benefit.</p>
  <p><strong>Targeted fields → per-member targeted.</strong> If the work unit specifies particular fields to fill (populated by a feedback gate or a second-pass re-entry), use per_member_targeted to focus the agent's attention narrowly.</p>

  <div className="section-divider">Lifecycle & Dependencies</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">Work Unit Lifecycle</h2>
  <p>A work unit progresses through a state machine with clearly defined transitions. Understanding this lifecycle is essential for three reasons: debugging stalled queues (why is this unit stuck?), implementing retry logic (when should we try again, and with what changes?), and building the monitoring dashboard that you'll inevitably need when running the system at population scale.</p>

  <div className="flow-step">
    <div className="flow-step-box"><div className="flow-step-label">CREATED</div><div className="flow-step-text">Generated by traversal or feedback gate</div></div>
    <div className="flow-step-box"><div className="flow-step-label">QUEUED</div><div className="flow-step-text">Priority scored, in the queue</div></div>
    <div className="flow-step-box"><div className="flow-step-label">DISPATCHED</div><div className="flow-step-text">Agent selected, executing</div></div>
    <div className="flow-step-box"><div className="flow-step-label">TERMINAL</div><div className="flow-step-text">Done: completed / partial / failed / skipped</div></div>
  </div>

  <p><strong>Created → Queued.</strong> The traversal system (or a feedback gate, or a manual re-queue) creates the work unit and inserts it into the dispatch queue. At this point, the priority score is computed for the first time. The unit sits in the queue until the dispatcher picks it up.</p>
  <p><strong>Queued → Dispatched.</strong> The dispatcher dequeues the highest-priority unit whose dependencies are all satisfied (see below). It loads the current family_file state, runs the policy's selector to choose an agent config, and hands the config to the agent executor. The unit is now in-flight.</p>
  <p><strong>Dispatched → Terminal.</strong> The agent executor runs the agent loop (Chapter 5) and produces a result. The result determines which terminal state the unit enters.</p>
  <p><strong>Completed</strong> means the agent ran to completion and produced usable output that was merged into the family_file. The merge result (accepted fields, conflicts, no-ops) is recorded in the work unit for telemetry. This is the happy path.</p>
  <p><strong>Partial</strong> means the agent filled some but not all of the targeted fields. Perhaps it found career data but not internet accounts. The work unit is re-enqueued with reduced scope (only the remaining unfilled fields) and slightly lower priority (multiplied by 0.8). Partial is not a failure — it's progress, and the re-enqueued unit will try again with a more targeted prompt.</p>
  <p><strong>Failed</strong> means the agent errored out — an API timeout, a rate limit, a malformed output that couldn't be parsed even after repair attempts. The work unit is re-enqueued with an incremented retry count. After a configurable maximum retry count (default: 3), the unit transitions to <strong>skipped</strong>, a terminal state meaning "we tried our best and couldn't get useful data here."</p>
  <p><strong>Skipped</strong> is not a failure in the system — it's a legitimate outcome. Some people have almost no internet presence. Some family members are minors with no public records. Some fields simply don't have discoverable data. Treating skipped as a normal outcome (rather than an error) prevents the system from wasting tokens on unproductive retries and keeps the queue moving.</p>

  <h2 className="heading-section text-2xl mt-12 mb-6">Dependency Management</h2>
  <p>Work units can depend on other work units. The most common dependency: P2 enrichment depends on P1 discovery — you can't enrich a member's profile until you've discovered them and created their entry in the family_file. More complex dependencies arise in the chaining patterns from Chapter 2: whole-family P2 depends on all per-member P2 units completing (so it has the full context), and cross-reference P1 depends on the population index being up-to-date (which happens between phases).</p>
  <p>Each work unit carries a <code className="code-inline">depends_on</code> list of work unit IDs. The dequeue function checks dependencies before returning a unit: if any dependency has not yet reached a terminal state (completed, partial, or skipped), the unit remains in the queue. This is equivalent to a topological ordering that naturally emerges from the dependency declarations — the queue processes units in dependency order without requiring an explicit sort.</p>
  <p>There's a subtlety in what counts as a "satisfied" dependency. A failed work unit that will be retried is <em>not</em> in a terminal state — its dependents continue to wait, because the retry might succeed and produce data the dependent needs. A partial work unit <em>is</em> terminal — its dependents can proceed with whatever data is available, rather than waiting for data that may never arrive. A skipped unit is terminal — its dependents proceed, accepting that the data won't be available. This design ensures dependencies never deadlock: every dependency chain eventually terminates because failed units have a maximum retry count that leads to the skipped terminal state.</p>

  <div className="callout-green callout">
    <strong>No Deadlock Guarantee</strong>
    <p className="mt-2 mb-0">The dependency system cannot deadlock because: (1) every work unit eventually reaches a terminal state (completed, partial, or skipped — the retry cap ensures this), (2) dependencies are acyclic by construction (P2 depends on P1, never the reverse), and (3) terminal dependencies always release their dependents. This means the queue always drains, even in the worst case where every agent invocation fails.</p>
  </div>

  <h2 className="heading-section text-2xl mt-12 mb-6">Token Budget Management</h2>
  <p>The token budget system is the financial controller of the pipeline. Without it, a single complex family could consume your entire API budget, leaving hundreds of other families untouched. The budget operates at three levels — global, per-family, and per-member — and the strictest limit wins.</p>
  <p>The <strong>global budget</strong> is the total token allocation for the entire pipeline run. When it's exhausted, processing stops entirely. This is the circuit breaker that prevents runaway costs.</p>
  <p>The <strong>per-family budget</strong> caps how much any single family can consume. This ensures equitable coverage across the population — no family monopolizes the resources, even if it's large and data-rich with many members to discover and enrich. When a family's budget is exhausted, all remaining work units for that family are transitioned to skipped. The system moves on to other families rather than spending more tokens on diminishing returns.</p>
  <p>The <strong>per-member budget</strong> caps how much any single member can consume. This prevents the system from running dozens of agent invocations on one particularly elusive member while ignoring others in the same family. A member who resists enrichment after three attempts is probably not going to yield data on the fourth try.</p>
  <p>When a work unit is dispatched, it receives the minimum of its own declared budget, its family's remaining budget, and its target member's remaining budget. After the agent completes, the actual tokens consumed (input + output, reported by the API response) are debited from all applicable budgets. This means a single expensive invocation can exhaust a member's budget without exhausting the family's budget, allowing other members in the same family to continue processing.</p>
  <p>Budget allocation is a policy decision that the traversal system makes. Uniform allocation (every family gets the same budget) is simplest but inefficient — sparse families waste their allocation while rich families hit their ceiling prematurely. Proportional allocation (budget proportional to member count) is better, since larger families need more token spend to cover more members. The hybrid traversal system (Chapter 4) can allocate a larger budget to families selected for DFS deep-dive in Phase 3, and a smaller budget to families that were adequately covered in the BFS shallow passes. This dynamic allocation is one of the main advantages of the hybrid approach.</p>

  <CodeToggle label="Token budget manager">
    <div className="code-block" data-lang="python">{`class TokenBudgetManager:
    def __init__(self, budget_per_family: int, budget_per_member: int):
        self.family_budgets: dict[str, int] = {}
        self.member_budgets: dict[str, int] = {}

    def allocate(self, unit: WorkUnit) -> int:
        family_rem = self.family_budgets.get(unit.family_id, self.budget_per_family)
        member_rem = self.member_budgets.get(unit.target_member_id, self.budget_per_member)
        return min(family_rem, member_rem, unit.max_tokens)

    def debit(self, unit: WorkUnit, tokens_used: int):
        self.family_budgets[unit.family_id] = (
            self.family_budgets.get(unit.family_id, self.budget_per_family) - tokens_used
        )
        if unit.target_member_id:
            self.member_budgets[unit.target_member_id] = (
                self.member_budgets.get(unit.target_member_id, self.budget_per_member) - tokens_used
            )

    def is_exhausted(self, family_id: str) -> bool:
        return self.family_budgets.get(family_id, self.budget_per_family) <= 0`}</div>
  </CodeToggle>

  <div className="section-divider">Putting It Together</div>

  <h2 className="heading-section text-2xl mt-12 mb-6">The Dispatch Loop</h2>
  <p>All of the components described in this chapter — work units, priority scoring, agent registries, dependency management, token budgets — come together in the dispatch loop. This is the runtime core of the system: the tight loop that continuously dequeues work, dispatches agents, and handles results. Understanding this loop is essential because it's where abstractions meet reality — where the clean separation of concerns either holds up under production load or collapses into a tangle of edge cases.</p>
  <p>The loop is straightforward. On each iteration: dequeue the highest-priority work unit whose dependencies are satisfied. Check the token budget — if the family is exhausted, skip. Load the current family_file state and compute a fresh PolicyState. Run the policy's selector to get an AgentConfig. Dispatch the agent. Merge the result into the family_file. Record telemetry. Update the work unit's terminal state. Emit any new work units generated by feedback gates. Repeat until the queue is empty or the global budget is exhausted.</p>
  <p>The loop runs asynchronously. Multiple iterations can be in-flight simultaneously — while one agent is waiting on an LLM API response, the loop dispatches the next work unit. The concurrency is bounded by a semaphore (configurable, typically 5-20 concurrent dispatches) to avoid overwhelming the API rate limits. The per-family locking in the file store (Chapter 6) ensures that concurrent merges to the same family_file are serialized correctly.</p>

  <CodeToggle label="Dispatch loop implementation">
    <div className="code-block" data-lang="python">{`async def dispatch_loop(queue: PriorityQueue, config: DispatchConfig):
    semaphore = asyncio.Semaphore(config.max_concurrency)
    completed: set[str] = set()
    tasks: list[asyncio.Task] = []

    while not queue.empty() and not budget_manager.global_exhausted():
        unit = dequeue_next(queue, completed)
        if unit is None:
            if tasks:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                tasks = [t for t in tasks if not t.done()]
                continue
            break

        async def process(u: WorkUnit):
            async with semaphore:
                config = select_and_build_config(u)
                result = await execute_agent(config, u, client, registry)
                handle_result(u, result, queue, completed)

        tasks.append(asyncio.create_task(process(unit)))

    await asyncio.gather(*tasks)`}</div>
  </CodeToggle>

  <p>The <code className="code-inline">handle_result</code> function is where terminal states are assigned, merges happen, telemetry is recorded, and new work units are generated. It's the function that connects the dispatch system to everything else — the state management layer (Chapter 6), the feedback gates (Chapter 2), and the telemetry pipeline (Chapter 8). Getting this function right is the difference between a system that runs cleanly and one that silently loses data or generates duplicate work.</p>
</article>); }
