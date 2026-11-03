/**
 * Host opt-in for the AI Assistant. The host selects exactly one provider; a
 * provider that is unavailable is reported as such and never replaced by
 * another. The config never holds a secret and is never serialized to the
 * browser. CLI executables, models and timeouts come only from this trusted
 * host config, never from prompts or model output.
 */
type AssistantProviderKind = "anthropic" | "fake" | "claude-cli" | "codex-cli";

interface ContentAiProposerInput {
    instruction: string;
    /** Only the scoped fields, with their current working values. */
    fields: {
        key: string;
        label: string;
        kind: string;
        value: string;
    }[];
    signal: AbortSignal;
}
type ContentAiProposerOutput = {
    kind: "proposal";
    values: Record<string, string>;
    summary: string;
} | {
    kind: "refusal";
    message: string;
};
interface ContentAiProposer {
    readonly label: string;
    propose(input: ContentAiProposerInput): Promise<ContentAiProposerOutput>;
}

/**
 * Whether inference can run now. `ready` means the provider's own local check
 * passed, not that a model call has succeeded; `unknown` is never reported as
 * signed in.
 */
type ContentAiInference = {
    state: "ready";
    detail: string;
    version?: string | null;
} | {
    state: "unavailable";
    code: string;
    message: string;
} | {
    state: "unknown";
    message: string;
};

/** One selected Content-AI provider: the proposer and its own availability check. Never a fallback to another. */
interface ContentAiProvider {
    readonly kind: AssistantProviderKind;
    readonly label: string;
    readonly proposer: ContentAiProposer;
    /** Re-checked on every call, so an install or sign-in shows up without a restart. Never calls a model. */
    inference(): Promise<ContentAiInference>;
}

type ContentAiProviderConfig = {
    provider: "fake";
} | {
    provider: "claude-cli" | "codex-cli";
    /** Executable name looked up on PATH, or an absolute path. Never a command line. */
    executable?: string;
    /** `null` or omitted uses the CLI's own default model. */
    model?: string | null;
    effort?: "low" | "medium" | "high" | null;
    /** Upper bound for one model reply, 5000–900000 ms. */
    timeoutMs?: number;
};
interface ContentAiProviderOptions {
    /** The environment the CLI inherits; defaults to this process's. Composer's own ZUDO_ASSISTANT_* variables are always withheld. */
    env?: Record<string, string | undefined>;
}
/**
 * The one Content-AI provider a host selected. `fake` is the offline
 * deterministic proposer; `claude-cli` and `codex-cli` run the locally
 * installed, already signed-in CLI with Composer's restricted profile.
 */
declare function createContentAiProvider(config: ContentAiProviderConfig, options?: ContentAiProviderOptions): Promise<ContentAiProvider>;

export { createContentAiProvider };
export type { ContentAiInference, ContentAiProvider, ContentAiProviderConfig, ContentAiProviderOptions };
