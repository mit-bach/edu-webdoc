import { useState } from "react";
const CodeToggle = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => {
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

export default function Ch8BeyondMVP() {
  return (
    <article className="prose-body">
      <div className="chapter-badge">Chapter 08</div>
      <h1 className="heading-display text-4xl mb-3">Beyond MVP</h1>
      <p
        className="text-lg mb-10"
        style={{
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-body)",
        }}
      >
        The skill-based adaptive agent selection system and population-level
        learning — documented now for architectural continuity, built later when
        the foundation is stable.
      </p>

      <div className="callout-rose callout">
        <strong>Status: Design Only</strong>
        <p className="mt-2 mb-0">
          The systems described in this chapter are explicitly out of scope for
          the MVP. They are documented here for two reasons: first, to ensure
          the MVP architecture does not make design decisions that preclude
          these systems (every interface in Chapters 1-7 was designed with these
          extensions in mind); second, to provide a clear roadmap for post-MVP
          development with enough technical specificity to guide implementation
          when the time comes.{" "}
          <strong>
            Do not attempt to build these systems until the MVP is stable,
            instrumented, and producing telemetry data.
          </strong>{" "}
          Without telemetry, the skill system has nothing to learn from and the
          population learning system has nothing to inject.
        </p>
      </div>

      <h2 className="heading-section text-2xl mt-12 mb-6">
        The Skill System: Learned Agent Selection
      </h2>
      <p>
        In the MVP, the policy's agent selector is a hand-coded function with
        static conditional branches. If there's no family_file, use cold_start.
        If there's enrichment data, use enrichment_aware. If it's pass 2+, use
        cross_reference. These rules are reasonable starting points — they
        encode domain knowledge about which agents are appropriate for which
        situations. But they're based on programmer intuition, not on empirical
        measurement. The programmer doesn't <em>know</em> that cold_start is the
        best agent for a bare name — they <em>believe</em> it is, based on their
        understanding of the agents' designs and the data landscape. And that
        belief might be wrong, or it might be right in general but wrong for
        specific subpopulations.
      </p>
      <p>
        The skill system replaces static rules with{" "}
        <strong>learned routing</strong> — the system discovers which agent
        configurations work best for which types of input, and routes
        accordingly. "Learning" here doesn't mean training a neural network or
        fine-tuning a model. It means{" "}
        <em>
          recording what happened, analyzing the records, and updating routing
          decisions based on observed outcomes
        </em>
        . It's empirical optimization, not machine learning. The math is simple
        (averages, confidence intervals, a UCB1-style scoring function). The
        hard part is building the telemetry pipeline that produces reliable
        records and the mining process that extracts actionable patterns.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">What a Skill Is</h3>
      <p>
        A "skill" in this context is a specific pairing of{" "}
        <em>input characteristics</em> and <em>agent configuration</em> that has
        demonstrated measurable effectiveness. The system learns, for example,
        that for families where the seed student has a LinkedIn profile and at
        least one parent in the finance industry, the{" "}
        <code className="code-inline">enrichment_aware_discovery</code> agent
        with the <code className="code-inline">search_linkedin</code> and{" "}
        <code className="code-inline">search_sec_filings</code> tools
        outperforms the generic{" "}
        <code className="code-inline">contextual_discovery</code> agent by 40%
        in terms of fields filled per token spent. This pairing —
        "internet-present finance families → enrichment_aware + SEC tools" — is
        a skill.
      </p>
      <p>
        Each skill bundles four things. The <strong>agent configuration</strong>{" "}
        it maps to — the complete AgentConfig object (model, prompt template,
        tool set, output schema, temperature, token budget). The{" "}
        <strong>applicability conditions</strong> — a predicate over the
        DataProfile that determines when this skill should be considered (e.g.,
        "member count between 3 and 6, has internet presence, pass number ≤ 2").
        The <strong>performance metrics</strong> — effectiveness (fields filled
        ÷ fields attempted), precision (how often filled fields are later
        confirmed by independent sources), token efficiency (fields filled ÷
        tokens spent), and sample size (how many times this skill has been
        invoked, which determines statistical confidence in the metrics). And{" "}
        <strong>provenance</strong> — how the skill was discovered: manual
        definition by an operator, automated mining from telemetry, or evolution
        from a parent skill.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Skill Matching: Exploitation vs. Exploration
      </h3>
      <p>
        When a work unit is dispatched, the skill matcher evaluates all active
        skills whose applicability conditions match the work unit's DataProfile.
        Among the matching skills, it selects the one with the highest composite
        score. The scoring function must balance two competing objectives.
      </p>
      <p>
        <strong>Exploitation</strong> favors the skill with the best proven
        track record — the one that has consistently produced the most fields
        per token in past invocations. If enrichment_aware_discovery has an
        effectiveness of 0.82 over 150 invocations, and contextual_discovery has
        an effectiveness of 0.61 over 200 invocations, exploitation says: always
        use enrichment_aware.
      </p>
      <p>
        <strong>Exploration</strong> favors trying under-tested skills that
        might be better than the current best but haven't had enough invocations
        to prove it. A newly mined skill with an effectiveness of 0.90 over 8
        invocations might be genuinely superior, or it might be a statistical
        fluke from a small sample. Exploration says: give it more chances to
        prove itself.
      </p>
      <p>
        The scoring function uses a UCB1-inspired formula that handles this
        tradeoff. The score is the skill's{" "}
        <code className="code-inline">effectiveness × token_efficiency</code>{" "}
        (exploitation term) plus an exploration bonus proportional to{" "}
        <code className="code-inline">
          √(2 × ln(total_invocations) / skill_sample_size)
        </code>
        . Skills with few samples get a large exploration bonus. Skills with
        many samples are judged almost entirely on their track record. The{" "}
        <code className="code-inline">0.1</code> coefficient on the exploration
        term is tunable — higher values produce more exploration (more
        experimentation, slower convergence to the best skill), lower values
        produce more exploitation (less experimentation, faster convergence but
        risk of getting stuck on a suboptimal skill).
      </p>

      <CodeToggle label="Skill matching with UCB1 scoring">
        <div className="code-block" data-lang="python">{`class SkillMatcher:
    def __init__(self, registry, min_confidence=0.7, min_samples=20):
        self.registry = registry
        self.min_confidence = min_confidence
        self.min_samples = min_samples

    def match(self, unit: WorkUnit) -> AgentConfig:
        profile = unit.data_profile

        # Find all applicable skills
        candidates = [s for s in self.registry.active_skills()
                      if s.applies_when.matches(profile, unit)]

        # Filter by statistical confidence
        confident = [s for s in candidates
                     if s.sample_size >= self.min_samples]

        if not confident:
            return static_selector(unit)  # Fallback to MVP rules

        # UCB1-inspired scoring
        scored = [(s, self._score(s)) for s in confident]
        best = max(scored, key=lambda x: x[1])
        return best[0].agent_config

    def _score(self, skill) -> float:
        exploitation = skill.effectiveness * skill.token_efficiency
        exploration = math.sqrt(
            2 * math.log(self.registry.total_invocations) / skill.sample_size
        )
        return exploitation + 0.1 * exploration`}</div>
      </CodeToggle>

      <p>
        If no skill matches with sufficient confidence — either no skills'
        applicability conditions match, or all matching skills have too few
        samples to be statistically reliable — the matcher falls back to the
        static selector from Chapter 1. This means the skill system is{" "}
        <strong>strictly additive</strong>: it can only improve routing compared
        to the MVP baseline, never degrade it. This is an essential property for
        production deployment. You can enable the skill system, observe its
        decisions in the telemetry, and build confidence in its routing before
        removing the static fallback. If the skill system makes a mistake, the
        worst case is that it routes to a slightly suboptimal agent — the static
        fallback's agent — rather than a catastrophically wrong one.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Telemetry: The Raw Material
      </h3>
      <p>
        Skills are discovered from telemetry data. After every agent invocation
        — every single one, from the first cold_start on the first student to
        the last re-sweep on the last family — the system records an{" "}
        <code className="code-inline">InvocationRecord</code>. This record
        captures: the input DataProfile (member count, field fill rates, boolean
        flags), the pass number, the agent config that was selected (agent key,
        prompt template, tools, model), and the outcome metrics (how many fields
        the agent attempted to fill, how many it successfully filled, how many
        tokens it consumed, how long it took, and the terminal status).
      </p>
      <p>
        The invocation records are the raw material that skill mining, skill
        updating, and the ablation study all consume. They must be comprehensive
        (capture everything needed for analysis), compact (don't bloat the
        record with full family_file snapshots), and durable (persisted to disk,
        not just held in memory). In the MVP, these records are already being
        produced by the chain instrumentation system from Chapter 2 — the{" "}
        <code className="code-inline">AgentTrace</code> and{" "}
        <code className="code-inline">ChainTrace</code> objects contain all the
        necessary data. The post-MVP step is structuring them into a queryable
        format (a SQLite database or a Parquet file) and building the mining
        pipeline on top.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Skill Discovery via Mining
      </h3>
      <p>
        The mining process runs periodically — after each BFS phase in the
        hybrid traversal, or on a fixed schedule for long-running pipelines. It
        analyzes the accumulated invocation records to identify agent-profile
        pairings that significantly outperform the baseline.
      </p>
      <p>
        The algorithm groups records by a composite key:{" "}
        <strong>discretized DataProfile × agent key</strong>. The DataProfile is
        discretized to prevent over-fitting to narrow input ranges: member count
        bucketed into [0, 1-3, 4-6, 7+], pass number into [1, 2, 3+], and
        boolean flags for internet presence, education data, and career data.
        This produces a manageable number of buckets (4 × 3 × 2 × 2 × 2 = 96
        profile categories). Combined with the agent keys (4 P1 agents × 4 P2
        agents = 16), the total space is ~1500 candidate skills. Most of these
        will have zero or few records — the actual number of populated
        candidates is much smaller.
      </p>
      <p>
        For each candidate with at least 10 invocation records, the miner
        computes the effectiveness and token efficiency, then compares against
        the population average. Candidates that exceed the average by a
        configurable margin (default: 10% improvement) are promoted into the
        skill registry. The applicability conditions are inferred from the
        discretized profile — "member count 4-6, has internet presence, pass
        1-2" — and the agent config is extracted from the records.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Skill Evolution and Retirement
      </h3>
      <p>
        Skills aren't static. As the population index grows, as enrichment data
        accumulates, and as the pipeline makes more passes, the effectiveness of
        different agent-profile pairings changes. A skill that was effective
        during the initial BFS passes might become less effective during the
        re-sweep, because the easy data has already been found and the remaining
        data requires different strategies.
      </p>
      <p>
        The skill updater uses an exponential moving average (EMA) with a
        smoothing factor α (default: 0.1) to weight recent invocations more
        heavily than older ones. After each new invocation of a skill, its
        effectiveness is updated:{" "}
        <code className="code-inline">
          new_eff = (1 - α) × old_eff + α × invocation_eff
        </code>
        . This means the skill's score reflects its recent performance, not just
        its historical average. A skill that was effective 200 invocations ago
        but has declined over the last 50 will see its score decrease, and the
        matcher will eventually prefer a different skill.
      </p>
      <p>
        Skills with consistently poor performance are retired — marked inactive
        and excluded from the matcher's candidate set. The retirement criterion
        is simple: if a skill's effectiveness is below 0.1 (essentially useless)
        after at least 50 invocations, retire it. Retired skills remain in the
        registry for auditing and analysis — they're never deleted, just
        deactivated. A retired skill can be manually reactivated if an operator
        believes the conditions that caused its decline have changed.
      </p>

      <div className="section-divider">Population Learning</div>

      <h2 className="heading-section text-2xl mt-12 mb-6">
        Multi-Pass Population Learning
      </h2>
      <p>
        On early passes, the system operates on each family in relative
        isolation. Each agent has the family_file, its tools, and its system
        prompt — but no awareness of the broader population. On later passes,{" "}
        <strong>knowledge accumulated across the entire population</strong>{" "}
        should improve the agents' effectiveness. If 30 families in the
        population have members who worked at Goldman Sachs, the system should
        recognize Goldman Sachs as a significant node in the population's
        professional network and use that knowledge when processing Goldman
        Sachs-connected families. If 15 families share members at Brookline High
        School, the system should use that pattern to improve discovery for
        other Brookline-connected families.
      </p>
      <p>
        This is what population learning means: the system gets smarter about
        the <em>entire population</em> with each pass, not just about individual
        families. The insight is that the population is not just a collection of
        independent families — it's a <em>network</em> with shared employers,
        shared schools, shared neighborhoods, and shared affiliations.
        Exploiting these shared connections is the highest-leverage optimization
        available once the MVP is working.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        What the System Learns Across Passes
      </h3>
      <p>
        The knowledge accumulation is progressive, with each pass building on
        the previous ones. After <strong>Pass 1</strong> (discovery), the system
        knows names, rough relationships, and class years. No cross-family
        context exists yet — each family is an island. After{" "}
        <strong>Pass 2</strong> (enrichment), the system knows education,
        career, internet presence, and affiliations per member. The population
        index can now be built, and it immediately reveals connections that were
        invisible: two families share an employer, three families have members
        at the same school, a charitable trust connects two apparently unrelated
        families.
      </p>
      <p>
        After <strong>Pass 3</strong> (cross-reference discovery using the
        population index), the system has actively explored inter-family
        connections. New family members have been discovered through
        cross-referencing, and the index has grown richer and more accurate.
        After <strong>Pass 4+</strong> (deep enrichment with population priors),
        the system has enough accumulated data to recognize statistical
        patterns: typical career paths for MIT CS majors (75% go into tech, 15%
        into finance, 5% into consulting), common affiliations (the Phi Beta
        Kappa society appears in 20% of families), expected family sizes by
        demographic profile. These patterns act as <em>priors</em> that help P2
        fill sparse profiles — if every other MIT CS 2025 graduate went into
        tech, the model can assign higher confidence to tech-related career data
        for the remaining graduates whose career information is ambiguous.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Context Injection Mechanisms
      </h3>
      <p>
        Population context reaches agents through two channels, each with
        different strengths.
      </p>
      <p>
        <strong>Prompt injection</strong> adds a section to the system prompt
        populated with population-level data relevant to the current target.
        This section might include: other members in the population who share
        the target family's employer ("Other members at Goldman Sachs: Alice
        Chen [Family_12], James Park [Family_37]"), the most common employers
        and schools across the population, and any cross-family connections that
        have been identified. Prompt injection is simple and predictable — the
        agent sees the context immediately and can use it from the first
        iteration. The downside is token cost: injecting context for a family
        with 15 cross-family connections might consume 1-2k tokens, reducing the
        budget available for conversation history.
      </p>
      <p>
        <strong>Tool-based access</strong> provides the{" "}
        <code className="code-inline">query_population_index</code> tool, which
        lets the agent actively search the population for connections on demand.
        The agent decides what to query ("Find members who work at Goldman Sachs
        and went to MIT") and when, consuming tokens incrementally. This is more
        flexible than prompt injection — the agent can explore hypotheses that
        the prompt author didn't anticipate — but it's more expensive per-query
        (each tool call is a round trip through the agent loop) and requires the
        agent to know that the tool exists and to use it effectively (which
        depends on the system prompt's description of the tool).
      </p>
      <p>
        For maximum effectiveness, use both: inject a compact summary of the
        most relevant cross-family connections (the top 5-10 by relevance score)
        into the prompt, and provide the population index tool for deeper
        exploration. This gives the agent immediate context for the most obvious
        connections while preserving the flexibility to discover less obvious
        ones through active querying.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">Re-Entry Prioritization</h3>
      <p>
        On each re-sweep pass, which families should be re-opened? Not every
        family benefits equally from population context. A family with no
        connections to the population index gains nothing from re-processing —
        the agent will receive the same empty population context it had before.
        A family with many cross-family connections, unresolved name references,
        and gaps that population priors could fill has significant upside from a
        re-sweep with enriched context.
      </p>
      <p>
        The re-entry prioritization function ranks families by their estimated
        benefit from population context. The inputs are:{" "}
        <strong>new connections since last pass</strong> (other families that
        were enriched since this family was last processed, creating new indexed
        values that might match), <strong>resolvable references</strong> (name
        references in the family_file that the population index can now resolve,
        e.g., "the trust mentions a 'John Park' and there's now a John Park in
        Family_37"), and <strong>gap fillability</strong> (fields that are
        missing in this family but common in similar families, suggesting that
        population priors could help).
      </p>
      <p>
        A diminishing returns factor is applied per pass: the priority for
        re-entry on pass N is multiplied by 0.7^(N-1). This ensures the system
        doesn't endlessly re-process families with marginal gains. By pass 5,
        the re-entry priority is multiplied by ~0.24, meaning only families with
        very strong population signals are re-opened. This natural decay,
        combined with the population-level termination conditions from Chapter
        4, ensures convergence.
      </p>

      <div className="section-divider">Validation</div>

      <h2 className="heading-section text-2xl mt-12 mb-6">
        The Ablation Study
      </h2>
      <p>
        Architecture_V1 mentions: "When personal_data from LLM_Policy_2 is
        available, [P1] returns higher-recall family members. This differential
        is the empirical basis for the future graph_df ablation study." The
        ablation is designed to <em>quantify</em> the value of population
        learning — specifically, how much does P1 recall improve when the agent
        has access to population context versus when it doesn't?
      </p>
      <p>
        The study design is straightforward. For each family in the study
        sample, run the same P1 agent twice: once as the{" "}
        <strong>control</strong> (family_file only, no population context, no
        population index tool) and once as the <strong>treatment</strong>{" "}
        (family_file plus population context injection plus the
        query_population_index tool). The outcome metric is new members
        discovered. The cost metric is tokens consumed. If the treatment
        consistently discovers more members than the control, the delta
        quantifies the value of population learning. If the delta is small or
        inconsistent, population learning may not justify its complexity and
        cost.
      </p>
      <p>
        The study should be run on a <strong>stratified sample</strong> — not
        the entire population, because the ablation doubles the P1 cost for
        every family included. Select 50-100 families spanning the full range of
        data profiles: small families and large ones, sparse data and rich data,
        families with many cross-family connections and families with none.
        Stratification ensures the results generalize to the full population
        rather than reflecting the bias of a random sample that might
        over-represent common profiles.
      </p>
      <p>
        The ablation's results inform two decisions. First, whether population
        learning justifies its infrastructure cost (building and maintaining the
        population index, computing cross-family connections, injecting context,
        running the re-sweep phase). If the treatment discovers an average of
        0.5 more members per family across the sample, and the population has
        500 families, that's 250 additional members — likely worth the
        investment. If the average delta is 0.05, it's probably not worth the
        complexity. Second, the results reveal{" "}
        <strong>which family profiles benefit most</strong> from cross-family
        context. Families with many connections might see a delta of 2-3
        members; families with no connections see a delta of 0. This
        heterogeneity informs the re-entry prioritization function — weight the
        signals that predict large deltas more heavily.
      </p>

      <CodeToggle label="Ablation study runner">
        <div
          className="code-block"
          data-lang="python"
        >{`async def run_ablation(family_id: str, pass_number: int):
    family_file = await store.read(family_id)

    # Control: no population context
    control_config = policy_1.select_agent(
        PolicyState(family_file=family_file, pass_number=pass_number),
        use_population_context=False,
    )
    control_result = await execute_agent(control_config, state, client)

    # Treatment: with population context
    treatment_config = policy_1.select_agent(
        PolicyState(family_file=family_file, pass_number=pass_number),
        use_population_context=True,
    )
    treatment_result = await execute_agent(treatment_config, state, client)

    return AblationResult(
        family_id=family_id, pass_number=pass_number,
        control_members=len(control_result.candidates),
        treatment_members=len(treatment_result.candidates),
        delta=len(treatment_result.candidates) - len(control_result.candidates),
        control_tokens=control_result.tokens_used,
        treatment_tokens=treatment_result.tokens_used,
    )`}</div>
      </CodeToggle>

      <h2 className="heading-section text-2xl mt-12 mb-6">
        Relationship to MVP Architecture
      </h2>
      <p>
        The skill system and population learning don't change the MVP
        architecture — they <em>extend</em> it. Understanding exactly which
        extension points they use is important because it validates the MVP's
        design decisions. If the MVP's interfaces aren't flexible enough to
        support these extensions, you'll discover this as a painful rewrite
        rather than an incremental addition.
      </p>
      <p>
        The <strong>skill system</strong> replaces the static agent selector
        (Chapter 1) with a learned one. The selector's interface — input:
        PolicyState, output: AgentConfig — is unchanged. The selector's{" "}
        <em>implementation</em> changes from a hand-coded decision tree to a
        skill matcher backed by a registry. Everything downstream (the config
        builder, the agent executor, the merge logic, the telemetry) is
        unaffected. The skill system consumes InvocationRecords produced by the
        existing chain instrumentation — no new data collection is needed, just
        a new consumer of existing data.
      </p>
      <p>
        <strong>Population learning</strong> adds a new tool
        (query_population_index) to the tool registry and new sections to the
        prompt templates. The tool registry's interface (register a tool
        definition, resolve by name, execute by name) supports this natively —
        you're just adding a new tool, not changing the registry's design. The
        prompt template system supports parameterized sections — you're just
        adding a new section populated from the population index. The population
        index itself is a read-only data structure built from family_files — it
        doesn't modify any existing data or interfaces.
      </p>
      <p>
        The <strong>telemetry pipeline</strong> that feeds both systems is just
        structured logging of data that the agent loop already produces. The
        AgentTrace records token usage, tool calls, and outcomes. The ChainTrace
        records gate decisions and field-fill deltas. Structuring these into
        queryable InvocationRecords for the skill miner is a data
        transformation, not a new data source.
      </p>
      <p>
        This is why getting the MVP architecture right matters: every post-MVP
        system builds on top of it. The separation of concerns (policy →
        selector → config → executor) is what makes the skill system possible.
        The delta-based merge logic is what makes population context injection
        safe (propagated data is just another delta). The chain instrumentation
        is what provides the telemetry that skill mining consumes. Get the
        foundation wrong, and these extensions require a rewrite. Get it right,
        and they're incremental additions to a stable base.
      </p>

      <div className="section-divider">Open Questions</div>

      <h2 className="heading-section text-2xl mt-12 mb-6">
        Open Design Questions
      </h2>
      <p>
        Several questions are deliberately left unresolved. They require
        empirical data from MVP operation to answer well — and answering them
        prematurely (based on speculation rather than observation) risks
        over-engineering or optimizing for the wrong thing. These are documented
        here so they're not forgotten, but they should be revisited only after
        the MVP has processed at least one full population and produced
        telemetry data.
      </p>
      <p>
        <strong>Prompt template evolution.</strong> Can skills include learned
        prompt modifications, not just agent/tool selection? For example, "For
        families with trust structures, add this paragraph to the system prompt
        about trust discovery strategies." This would make skills more
        expressive — they could customize the agent's behavior at a finer grain
        than just swapping tool sets — but it raises debugging and
        interpretability challenges. How do you reason about a system where the
        prompt is dynamically assembled from learned fragments? How do you test
        a skill that includes a prompt modification? These questions need
        careful design, not hasty implementation.
      </p>
      <p>
        <strong>Transfer learning across populations.</strong> If you run the
        pipeline on MIT Class of 2025 first, do the skills transfer to MIT Class
        of 2024? The institution is the same, the data landscape is similar
        (same LinkedIn formats, same university directory structure), and the
        meta-patterns might transfer (career paths by major, typical family
        structures, common employers). But the specific students and families
        are entirely different. The hypothesis is that skills defined by{" "}
        <em>data profile characteristics</em> (internet presence, member count,
        field categories) transfer well, because those characteristics are
        properties of the data landscape rather than specific individuals. But
        this hypothesis needs empirical validation before relying on it.
      </p>
      <p>
        <strong>Active exploration.</strong> The UCB1 scoring provides some
        exploration, but it's passive — it gives a bonus to under-sampled skills
        within the current routing framework. Should the system also do{" "}
        <em>active</em> exploration: deliberately routing a fixed fraction (say,
        5%) of work units to random skills, regardless of UCB1 scores, to
        discover unexpected pairings? This is the classic explore-exploit
        tradeoff in a more aggressive form. The cost is a known 5% degradation
        in expected performance; the benefit is faster discovery of novel skills
        and resistance to the UCB1 scorer getting stuck in a local optimum.
      </p>
      <p>
        <strong>Human-in-the-loop skill creation.</strong> An operator who
        understands the domain might recognize patterns that the automated
        mining algorithm misses — especially early in the pipeline's life,
        before enough telemetry has accumulated for statistical significance.
        Can they manually define a skill ("for families where the seed student
        is pre-med, use this specialized agent with medical school directory
        search tools") and have it integrated into the skill registry alongside
        mined skills? The mechanism is straightforward — the skill registry
        accepts manual entries — but the policy question is whether
        manually-created skills should bypass the UCB1 scoring (operator
        confidence &gt; statistical evidence) or be subjected to the same
        performance tracking and potential retirement as mined skills.
      </p>
      <p>
        <strong>Skill composition.</strong> Can skills be chained? Rather than
        "use agent X for this profile," can a skill specify "use agent X, then
        if the result is partial, use agent Y"? This would capture multi-step
        strategies that the current skill system — which maps one profile to one
        agent config — can't represent. Skill composition interacts with the
        chaining system from Chapter 2 (a composed skill is essentially a
        dynamically-determined chain), adding complexity to both the skill
        registry and the dispatch loop. The payoff would need to be significant
        to justify that complexity.
      </p>
    </article>
  );
}
