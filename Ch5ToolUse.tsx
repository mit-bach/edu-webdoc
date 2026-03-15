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

export default function Ch5ToolUse() {
  return (
    <article className="prose-body">
      <div className="chapter-badge">Chapter 05</div>
      <h1 className="heading-display text-4xl mb-3">
        Tool Use & Structured Output
      </h1>
      <p
        className="text-lg mb-10"
        style={{
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-body)",
        }}
      >
        The LLM client, tool registry, structured output parsing, and the
        complete agent loop — the infrastructure layer that every policy and
        every agent runs on top of.
      </p>

      <h2 className="heading-section text-2xl mt-12 mb-6">
        LLM Client Architecture
      </h2>
      <p>
        The LLM client is the lowest-level abstraction in the system. It wraps
        the HTTP API for a specific provider (Anthropic, OpenAI, Google) and
        exposes a consistent interface: given a system prompt, messages, and
        tool definitions, make the API call and return a structured response.
        The client handles retry logic, rate limiting, and response parsing —
        concerns that no other component in the system should need to think
        about. When the agent loop calls{" "}
        <code className="code-inline">client.create_message()</code>, it should
        be as reliable as calling a local function: either it returns a valid
        response or it raises an exception. The transient failures of
        distributed systems — network timeouts, rate limits, server overload —
        are the client's problem, not the caller's.
      </p>
      <p>
        The key design principle is{" "}
        <strong>provider-agnosticism at the call site</strong>. The agent loop,
        the policy selector, and the tool registry all interact with an abstract{" "}
        <code className="code-inline">LLMClient</code> interface that defines
        the contract: system prompt, messages, tools, and configuration in;
        structured response out. The concrete implementation —{" "}
        <code className="code-inline">AnthropicClient</code>,{" "}
        <code className="code-inline">OpenAIClient</code>, or a future{" "}
        <code className="code-inline">OllamaClient</code> for local models —
        handles provider-specific details: different API endpoints, different
        request body schemas (Anthropic uses{" "}
        <code className="code-inline">system</code> as a top-level field; OpenAI
        uses it as a message role), different response formats (Anthropic
        returns content blocks with type discrimination; OpenAI returns a single
        message with optional tool_calls), and different rate limit headers.
      </p>
      <p>
        Swapping providers means changing a single configuration value in the
        AgentConfig, not rewriting agent code. This matters because model
        selection is a policy-level decision (Chapter 1): different agents might
        use different providers or different models from the same provider. The
        cold_start agent might use Claude Haiku (fast, cheap) while the
        cross-reference agent uses Claude Sonnet (more capable). The client
        abstraction makes this routing invisible to the agent loop — it just
        calls <code className="code-inline">client.create_message()</code> and
        gets back a provider-agnostic{" "}
        <code className="code-inline">LLMResponse</code> object.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">Response Parsing</h3>
      <p>
        The client's response parser translates provider-specific response
        formats into a unified <code className="code-inline">LLMResponse</code>{" "}
        object. This object contains: the text content (if any), a list of tool
        calls (if any), the stop reason (why the model stopped generating —
        "end_turn" means the model is done, "tool_use" means it wants to call a
        tool), token usage (input and output token counts, essential for budget
        tracking), and the raw response (preserved for debugging and telemetry).
        The parser handles the provider-specific quirks: Anthropic's content is
        a list of blocks that may interleave text and tool_use; OpenAI's content
        is a single message with a separate tool_calls field. The agent loop
        sees the same structure regardless of provider.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">Retry Logic</h3>
      <p>
        The client's retry logic handles two classes of transient failures that
        are routine in production LLM usage. <strong>Rate limiting</strong>{" "}
        (HTTP 429): the API returns a{" "}
        <code className="code-inline">retry-after</code> header indicating how
        long to wait. The client sleeps for the indicated duration, then
        retries. This is deterministic — the API tells you exactly when to try
        again. <strong>Overload</strong> (HTTP 529 for Anthropic, HTTP 503 for
        others): the server is temporarily overloaded and can't process the
        request. The client uses exponential backoff — 1 second, 2 seconds, 4
        seconds — up to a maximum of 3 retries. If all retries fail, the client
        raises an exception that propagates to the agent loop, which records the
        failure and transitions the work unit to the "failed" state.
      </p>
      <p>
        Both retry strategies are invisible to the calling code. From the agent
        loop's perspective,{" "}
        <code className="code-inline">client.create_message()</code> either
        returns a valid response (possibly after some transparent waiting) or
        raises an exception. The loop doesn't need to implement its own retry
        logic, and it doesn't need to know whether the response took 2 seconds
        (no retries) or 30 seconds (two rate-limit waits). This encapsulation is
        important because retry behavior is a concern of the transport layer,
        not the application layer.
      </p>

      <CodeToggle label="LLM client abstract interface and Anthropic implementation">
        <div className="code-block" data-lang="python">{`class LLMClient(ABC):
    @abstractmethod
    async def create_message(
        self, model: str, system: str, messages: list[dict],
        tools: list[ToolDefinition] | None = None,
        max_tokens: int = 4096, temperature: float = 0.0,
    ) -> LLMResponse: ...

class AnthropicClient(LLMClient):
    def __init__(self, api_key: str):
        self.http = httpx.AsyncClient(
            base_url="https://api.anthropic.com",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            timeout=httpx.Timeout(connect=10, read=120),
        )
        self._rate_limiter = TokenBucketRateLimiter(rpm=50, tpm=40_000)

    async def create_message(self, **kwargs) -> LLMResponse:
        await self._rate_limiter.acquire(kwargs.get("max_tokens", 4096))
        payload = self._build_payload(**kwargs)

        for attempt in range(3):
            resp = await self.http.post("/v1/messages", json=payload)
            if resp.status_code == 429:
                await asyncio.sleep(float(resp.headers.get("retry-after", 2**attempt)))
                continue
            if resp.status_code == 529:
                await asyncio.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            return self._parse_response(resp.json())
        raise MaxRetriesExceeded()`}</div>
      </CodeToggle>

      <h3 className="heading-sub text-xl mt-8 mb-4">Rate Limiting</h3>
      <p>
        LLM APIs enforce both requests-per-minute and tokens-per-minute limits,
        and both must be respected simultaneously. A naive client that fires
        requests as fast as the agent loop runs will hit these limits within
        seconds during BFS phases, when dozens of agents are running
        concurrently through the dispatch loop from Chapter 3.
      </p>
      <p>
        The rate limiter is a <strong>dual token bucket</strong>: one bucket for
        requests (refills at RPM/60 tokens per second), one bucket for tokens
        (refills at TPM/60 per second). Both buckets must have capacity before a
        request proceeds. If either bucket is empty, the client blocks
        asynchronously (using <code className="code-inline">asyncio.sleep</code>
        ) until capacity is available. The blocking is non-disruptive — other
        coroutines in the event loop continue executing, so other agents can
        make progress while one agent waits for rate limit capacity.
      </p>
      <p>
        The token bucket requires an estimate of how many tokens the request
        will consume, which you don't know precisely until the response arrives.
        The strategy is to reserve{" "}
        <code className="code-inline">max_tokens</code> (the maximum possible
        output) at request time, then refund the difference between the
        reservation and the actual usage after the response arrives. This is
        pessimistic — the system may run slightly slower than necessary because
        it's reserving more capacity than it uses — but it guarantees the rate
        limit is never exceeded. The alternative (estimate based on historical
        averages) risks bursts that trigger 429 responses, which are more
        expensive than the slight under-utilization of the pessimistic approach.
      </p>

      <div className="section-divider">Tool System</div>

      <h2 className="heading-section text-2xl mt-12 mb-6">The Tool Registry</h2>
      <p>
        Tools are the bridge between the LLM's reasoning and the outside world.
        The model can think, but it can't act — it can decide that it needs to
        search for "Robert Chen Goldman Sachs," but it can't execute that
        search. Tools are Python functions that the model can invoke by name,
        with arguments, to perform actions and observe results. The tool
        registry is the central place where these functions are defined, stored,
        and resolved.
      </p>
      <p>
        When the policy's config builder specifies a list of tool names for an
        agent (e.g.,{" "}
        <code className="code-inline">
          ["web_search", "merge_member", "read_family_file"]
        </code>
        ), the registry resolves those names to two things: the JSON schemas
        that tell the LLM what the tools do and how to call them (sent as part
        of the API request), and the handler functions that execute the tools
        when the LLM invokes them (called by the agent loop when a tool_use
        response is received). This dual resolution — schema for the LLM,
        handler for the runtime — is the registry's core responsibility.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">Tool Definition Anatomy</h3>
      <p>
        Each tool definition has six components, each serving a distinct purpose
        in the system.
      </p>
      <p>
        The <strong>name</strong> must be concise, descriptive, and unique. The
        model reads it to decide which tool to call. Use verb_noun format:{" "}
        <code className="code-inline">web_search</code>,{" "}
        <code className="code-inline">read_family_file</code>,{" "}
        <code className="code-inline">merge_member</code>. Avoid generic names
        like <code className="code-inline">search</code> (search what?) or{" "}
        <code className="code-inline">update</code> (update what?).
      </p>
      <p>
        The <strong>description</strong> is the single most important field —
        it's the prompt that teaches the model when and how to use the tool.
        Write descriptions as if you're explaining the tool to a competent
        colleague who has never seen your codebase. Include the tool's purpose
        ("Search the web for information about a person"), its input
        expectations ("Use specific queries: include full name plus school,
        company, or location"), and any caveats ("Returns top 5 results with
        snippets; results may be stale or inaccurate"). The quality of the
        description directly determines how effectively the model uses the tool.
        A vague description produces vague tool usage.
      </p>
      <p>
        The <strong>parameters_schema</strong> is a JSON Schema object that
        defines the tool's inputs. This is what the model fills out when making
        a tool call — the schema constrains what the model can provide. Use
        enums for fields with fixed valid values (relationship types, field
        categories). Mark only truly required fields as required; optional
        fields with sensible defaults let the model skip what isn't relevant,
        reducing the chance of the model fabricating a value just to satisfy a
        required field. Nest sparingly — deep nesting increases the chance of
        malformed output.
      </p>
      <p>
        The <strong>handler</strong> is the async Python function that
        implements the tool. It receives the arguments the model provided,
        performs the action, and returns the result. The handler must be
        defensive: validate inputs (the model might provide unexpected argument
        types or values despite the schema), handle errors gracefully (a web
        search might time out or return no results), and produce output that the
        model can usefully interpret (structured JSON, not raw HTML).
      </p>
      <p>
        The <strong>timeout</strong> caps how long the handler can run. Web
        searches might take 5-10 seconds; file reads should be sub-second. A
        handler that exceeds its timeout returns a timeout error to the model,
        which can then decide to retry with different arguments or move on.
        Without a timeout, a hung handler blocks the entire agent loop.
      </p>
      <p>
        The <strong>max_retries</strong> controls how many times a failed
        handler is retried before returning the error to the model. For
        transient failures (network timeouts), 2 retries is reasonable. For
        deterministic failures (invalid arguments), 0 retries is correct —
        retrying won't help.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Tool Categories for Architecture_V1
      </h3>
      <p>
        The tools fall into three categories that map cleanly to the system's
        data flow.
      </p>
      <p>
        <strong>Read tools</strong> extract data without side effects.{" "}
        <code className="code-inline">read_family_file</code> returns the
        current state of a family.{" "}
        <code className="code-inline">read_member_data</code> returns full
        personal_data for a specific member (used with the
        summary-plus-detail-on-demand context strategy from Chapter 7). These
        tools are pure — they don't modify any state, they're safe to call any
        number of times, and they're safe to call concurrently. They're the
        agent's eyes.
      </p>
      <p>
        <strong>Write tools</strong> modify the family_file.{" "}
        <code className="code-inline">merge_member</code> adds a discovered
        family member with confidence and evidence.{" "}
        <code className="code-inline">update_personal_data</code> writes
        enrichment deltas. These tools enforce the append-only invariant from
        Chapter 6 — they validate that no input attempts to delete or null out
        existing data, and they use the merge strategy (confidence-wins or
        flag-all) configured for the current policy. Write tools acquire the
        per-family lock before modifying the file, ensuring concurrent agents
        don't corrupt each other's writes. They're the agent's hands.
      </p>
      <p>
        <strong>Search tools</strong> retrieve information from external
        sources. <code className="code-inline">web_search</code> queries a
        search engine and returns results with snippets.{" "}
        <code className="code-inline">query_population_index</code> (post-MVP)
        searches the population index for cross-family connections. Search tools
        are the most expensive in terms of latency (seconds per call) and the
        most variable in terms of result quality (a search might return exactly
        what you need, or nothing useful, or misleading information). They're
        the agent's legs — they go out into the world and bring back what they
        find.
      </p>

      <div className="callout">
        <strong>Tool Schema Design Principles</strong>
        <p className="mt-2 mb-0">
          <strong>Descriptions are prompts.</strong> They're the primary
          mechanism the model uses to decide which tool to call and how. Be
          precise and include usage guidance.{" "}
          <strong>Constrain with enums.</strong> If a parameter has a fixed set
          of valid values, declare them — this reduces model errors
          dramatically. <strong>Require only what's essential.</strong> Optional
          fields with sensible defaults let the model skip irrelevant
          parameters. <strong>Nest sparingly.</strong> Deep nesting increases
          malformed output probability.{" "}
          <strong>Include examples in descriptions</strong> when the expected
          format is non-obvious: "Query should be specific: 'John Smith MIT
          2024' not 'John Smith'."
        </p>
      </div>

      <CodeToggle label="Example tool definitions for Architecture_V1">
        <div
          className="code-block"
          data-lang="python"
        >{`web_search = ToolDefinition(
    name="web_search",
    description=(
        "Search the web for information about a person. "
        "Use specific queries: include full name plus school, company, "
        "or location for best results. Returns top results with snippets."
    ),
    parameters_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Specific search query. Example: 'John Smith MIT 2024'"
            },
            "max_results": {"type": "integer", "default": 5, "minimum": 1, "maximum": 10}
        },
        "required": ["query"]
    },
    handler=handlers.web_search,
    timeout_seconds=15.0,
)

merge_member = ToolDefinition(
    name="merge_member",
    description=(
        "Add a candidate family member to the family file. Append-only: "
        "existing data is never overwritten. Include evidence for the relationship."
    ),
    parameters_schema={
        "type": "object",
        "properties": {
            "family_id": {"type": "string"},
            "member": {
                "type": "object",
                "properties": {
                    "first_name": {"type": "string"},
                    "last_name": {"type": "string"},
                    "relationship_to_seed": {
                        "type": "string",
                        "enum": ["parent", "sibling", "child", "spouse", "other"]
                    },
                    "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                    "evidence": {"type": "string"}
                },
                "required": ["first_name", "last_name", "relationship_to_seed",
                             "confidence", "evidence"]
            }
        },
        "required": ["family_id", "member"]
    },
    handler=handlers.merge_member,
)`}</div>
      </CodeToggle>

      <div className="section-divider">Structured Output</div>

      <h2 className="heading-section text-2xl mt-12 mb-6">Structured Output</h2>
      <p>
        Getting reliable structured data out of an LLM is one of the most
        practically important problems in agent development. The model needs to
        produce JSON that conforms to your schema — not "almost JSON" with
        trailing commas, not a markdown code block containing JSON, not a
        narrative description of what the JSON would look like. Actual,
        parseable, schema-valid JSON. Everything downstream — the merge
        function, the feedback gate, the telemetry system — depends on receiving
        well-formed structured data.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Primary Method: Function Calling
      </h3>
      <p>
        The primary mechanism is function calling (tool use). You define a
        "tool" whose parameters match your desired output schema, then set{" "}
        <code className="code-inline">tool_choice</code> to force the model to
        call that tool on its final turn. The model's output is a structured
        tool call with arguments that conform to the schema. This works reliably
        with Claude and GPT-4 — the models have been fine-tuned to produce valid
        JSON when making tool calls, and the API layer provides additional
        validation.
      </p>
      <p>
        The pattern looks like this: alongside your real tools (web_search,
        merge_member), you define an output tool — say,{" "}
        <code className="code-inline">submit_candidates</code> — whose schema
        matches the data you want the agent to produce. During the agent loop,
        the model can use any tool. On the final iteration (or when you want to
        force output), you set <code className="code-inline">tool_choice</code>{" "}
        to require calling{" "}
        <code className="code-inline">submit_candidates</code>. The model's
        response is a structured tool call with the candidates as arguments,
        which you parse directly into your Pydantic model.
      </p>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Pydantic Schema Generation
      </h3>
      <p>
        Define your output schemas as Pydantic models and auto-generate the JSON
        Schema for tool definitions. This gives you three things for free: the
        JSON Schema for the LLM (via{" "}
        <code className="code-inline">model_json_schema()</code>), type-safe
        parsing with validation (via{" "}
        <code className="code-inline">model_validate()</code>), and clear error
        messages when validation fails (Pydantic tells you exactly which field
        violated which constraint). The Pydantic model is the single source of
        truth for what the output looks like — you define it once, and both the
        LLM's schema constraints and your parsing logic derive from it.
      </p>

      <CodeToggle label="Pydantic output schema example">
        <div
          className="code-block"
          data-lang="python"
        >{`from pydantic import BaseModel, Field
from typing import Literal

class CandidateMember(BaseModel):
    first_name: str
    last_name: str
    relationship: Literal["parent", "sibling", "child", "spouse", "other"]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: str
    estimated_age_range: str | None = None

class DiscoveryOutput(BaseModel):
    candidates: list[CandidateMember]
    search_exhausted: bool
    suggested_next_queries: list[str] = Field(default_factory=list)

# Generate JSON Schema for tool definition
schema = DiscoveryOutput.model_json_schema()

# After receiving the tool call, parse into the Pydantic model
parsed = DiscoveryOutput.model_validate(response.tool_calls[0].arguments)`}</div>
      </CodeToggle>

      <h3 className="heading-sub text-xl mt-8 mb-4">
        Handling Malformed Output
      </h3>
      <p>
        Even with function calling, LLMs occasionally produce output that
        doesn't validate against the schema. The error rate is low — roughly
        1-3% with Claude Sonnet on well-designed schemas — but it's non-zero,
        and it increases with schema complexity (deeply nested objects, arrays
        of objects with many required fields). In a system that makes thousands
        of agent invocations, a 2% error rate means dozens of failures that need
        handling.
      </p>
      <p>
        The repair strategy is a three-step fallback. First, attempt standard
        parsing with <code className="code-inline">model_validate()</code>. If
        this succeeds, you're done — the common case. Second, if parsing fails,
        construct a repair prompt: include the JSON Schema, the malformed
        output, and the specific validation errors. Send this to a cheap, fast
        model (Haiku) with instructions to fix the JSON. This succeeds about 80%
        of the time — most failures are minor (a missing field, a number outside
        the valid range, a string where an enum value was expected). Third, if
        repair also fails, the agent invocation is marked as "failed" and the
        work unit enters the retry flow from Chapter 3. On retry, the full agent
        runs again from scratch, and the stochastic nature of LLM generation
        means the second attempt usually produces valid output.
      </p>
      <p>
        A subtler problem is <strong>semantic validity</strong> — the JSON is
        well-formed and passes schema validation, but the values are wrong. A
        confidence score of 0.95 on a hallucinated family member. A career field
        filled with plausible but fabricated company names. Schema validation
        catches structural errors, not semantic errors. Semantic validation
        happens in the gate functions (Chapter 2) — they apply domain-specific
        heuristics and cross-referencing checks that the schema alone can't
        enforce. This is one of the key reasons gates exist between chain links:
        they're the semantic validation layer.
      </p>

      <div className="section-divider">The Agent Loop</div>

      <h2 className="heading-section text-2xl mt-12 mb-6">
        The Complete Agent Loop
      </h2>
      <p>
        The agent loop is the generic executor that runs any agent
        configuration. It's parameterized by the AgentConfig (from Chapter 1),
        the PolicyState, the LLM client, and the tool registry. The loop itself
        is model-agnostic, tool-agnostic, and policy-agnostic — it's pure
        infrastructure. The same loop runs a cold_start P1 agent with Haiku and
        3 tools, and a whole_family P2 agent with Sonnet and 5 tools. The
        behavior difference comes entirely from the config, not from the loop.
      </p>
      <p>
        The loop's structure is deceptively simple: render the system prompt
        from the config's template and the policy state. Resolve the tool
        schemas from the config's tool list. Construct the initial user message
        from the state. Then iterate. Each iteration makes one LLM call. If the
        model returns tool calls (stop_reason is "tool_use"), execute them
        through the registry and append the results to the message history. If
        the model returns an end-of-turn, parse the output using the config's
        output schema and return the result. If the iteration cap is reached
        without a final answer, return a partial result.
      </p>
      <p>
        Between iterations, two maintenance operations occur. The message
        manager's <code className="code-inline">compact_if_needed</code> method
        (Chapter 7) checks whether the conversation history is approaching the
        context budget and compacts it if necessary. And the trace recorder logs
        the iteration's metrics: token usage, tool calls (names and statuses),
        and duration. This per-iteration telemetry feeds into the chain trace
        (Chapter 2's instrumentation) and the skill system's invocation records
        (Chapter 8).
      </p>

      <CodeToggle label="Complete agent loop implementation">
        <div
          className="code-block"
          data-lang="python"
        >{`async def run_agent(config: AgentConfig, state: PolicyState,
                    client: LLMClient, registry: ToolRegistry) -> AgentResult:
    system_prompt = render_prompt(config.prompt_template, state)
    tool_schemas = registry.get_schemas(config.tools)
    messages = MessageManager(max_context_tokens=config.context_budget)
    messages.add_user(build_initial_message(state))
    trace = AgentTrace(agent=config.agent, family_id=state.family_id)

    for iteration in range(config.max_iterations):
        trace.start_iteration()
        messages.compact_if_needed()

        response = await client.create_message(
            model=config.model, system=system_prompt,
            messages=messages.to_list(), tools=tool_schemas,
            max_tokens=config.token_budget, temperature=config.temperature,
        )
        trace.record_llm_call(response.usage)
        messages.add_assistant(response)

        # Case 1: Model wants to use tools
        if response.stop_reason == "tool_use" and response.tool_calls:
            results = []
            for tc in response.tool_calls:
                result = await registry.execute(tc.name, tc.arguments)
                result.tool_call_id = tc.id
                results.append(result)
                trace.record_tool_call(tc.name, result.status)
            messages.add_tool_results(results)
            continue

        # Case 2: Model finished
        if response.stop_reason == "end_turn":
            trace.finish("completed")
            if response.tool_calls:
                parsed = parse_structured_output(response, config.output_schema, client)
                return AgentResult(status="success", data=parsed, trace=trace)
            return AgentResult(status="success", text=response.text, trace=trace)

    # Case 3: Hit iteration limit
    trace.finish("max_iterations")
    return AgentResult(status="max_iterations", trace=trace)`}</div>
      </CodeToggle>

      <h2 className="heading-section text-2xl mt-12 mb-6">
        System Prompt Engineering
      </h2>
      <p>
        System prompts are parameterized templates — not static strings, but
        dynamic documents that incorporate context from the PolicyState. The
        template defines the agent's role ("You are a family research agent"),
        its rules of engagement ("Do NOT guess; only include candidates with
        concrete evidence"), the expected output format (implicitly defined by
        the output tool's schema, but worth restating in natural language for
        emphasis), and contextual data injected from the state (the target's
        name, the family_file summary, the pass number, the requested fields).
      </p>
      <p>
        The most impactful section of the system prompt is the{" "}
        <strong>confidence guidelines</strong>. Without explicit guidance,
        models assign confidence scores erratically — either over-confident
        (everything is 0.9+, even guesses) or unhelpfully uniform (everything is
        0.5, giving the merge function no signal to resolve conflicts). The
        prompt should define what each range means in concrete terms. A 0.9+
        confidence requires direct evidence from a reliable source: the person
        is named as a family member in a news article, institutional profile, or
        official document. A 0.7-0.9 requires strong circumstantial evidence:
        same last name, same location, plausible age range, and at least one
        independent corroborating signal. A 0.5-0.7 requires moderate evidence:
        shared last name with some contextual match but no strong corroboration.
        Below 0.5 should not be included — the merge function will accept it but
        the confidence is too low to be useful, and it pollutes the family_file
        with noise.
      </p>
      <p>
        Templates should also include <strong>negative instructions</strong> —
        telling the model what <em>not</em> to do is often more effective at
        preventing failures than telling it what to do. "Do NOT include public
        figures who happen to share the target's name unless there is specific
        evidence linking them to this family." "Do NOT fabricate email
        addresses, social media profiles, or other contact information." "Do NOT
        report a confidence above 0.8 unless you have at least two independent
        pieces of evidence." These constraints prevent the most common failure
        modes — hallucinated celebrities as family members, fabricated LinkedIn
        profiles, inflated confidence on single-source data — and are worth the
        200-300 tokens they cost to include in every invocation.
      </p>
      <p>
        Template parameterization is straightforward — Python f-strings or
        Jinja2 templates that substitute values from the PolicyState. The
        important discipline is to keep templates in a separate namespace (a
        templates directory, a dictionary, a config file) rather than embedding
        them in code. This makes templates reviewable, testable, and modifiable
        without changing Python logic. When you're debugging why an agent
        produced bad output, the first thing you'll want to inspect is the
        rendered prompt, and having it in a clean template makes that inspection
        easy.
      </p>
    </article>
  );
}
