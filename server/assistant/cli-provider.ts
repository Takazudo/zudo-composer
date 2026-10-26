import type { CliAssistantConfig } from "../config/assistant";
import { cliEnvironment, createCliScratch, removeCliScratch, runCliProcess, type CliExit } from "./cli-process";
import { ProviderError, type ModelProvider, type ProviderRequest, type ProviderStatus, type ProviderStatusCode, type ProviderTurn } from "./provider";
import { parseStructuredTurn, renderStructuredPrompt, structuredTurnJsonSchema } from "./structured-turn";

export type CliProbe =
  | { ok: true; version: string }
  | { ok: false; code: ProviderStatusCode; message: string; version: string | null };

/** Reads one invocation's JSONL stream and yields the reply only from a valid terminal result. */
export interface CliStreamParser {
  /** One stdout line. Throw a ProviderError to stop the process. */
  line(text: string, activity: (label: string) => void): void;
  /**
   * Called after the process exited. Returns the raw structured reply (JSON
   * text or object) only when the terminal result and exit status agree on
   * success; otherwise throws a ProviderError.
   */
  finish(exit: CliExit): unknown;
}

/** Everything that differs between CLIs. argv and env are fixed here, never derived from prompts. */
export interface CliProtocol {
  provider: CliAssistantConfig["provider"];
  label: string;
  /**
   * Inherited variables never passed to this CLI, e.g. an Anthropic API key
   * the server holds for the API provider. Composer's own ZUDO_ASSISTANT_*
   * variables are always withheld.
   */
  excludedEnv?: readonly string[];
  probe(config: CliAssistantConfig, env: NodeJS.ProcessEnv): Promise<CliProbe>;
  prepare(context: { config: CliAssistantConfig; scratch: string; schema: Record<string, unknown>; version: string }): Promise<{ args: string[]; env?: Record<string, string> }>;
  createParser(): CliStreamParser;
}

const STATUS_TTL_MS = 30_000;

/**
 * One CLI-backed provider: one CLI invocation per model reply, prompt on
 * stdin, restricted profile, scratch working directory, and Composer-side
 * validation of every reply. An unavailable CLI is reported, never replaced.
 */
export function createCliProvider(config: CliAssistantConfig, protocol: CliProtocol, inherited: NodeJS.ProcessEnv = process.env): ModelProvider {
  const excluded = new Set(protocol.excludedEnv ?? []);
  const base = Object.fromEntries(Object.entries(inherited).filter(([key]) => !excluded.has(key) && !key.startsWith("ZUDO_ASSISTANT_")));
  let cached: { at: number; status: ProviderStatus } | undefined;
  let pending: Promise<ProviderStatus> | undefined;
  const identity = (version: string | null) => ({ provider: protocol.provider, label: protocol.label, model: config.model, version });
  const status = async (): Promise<ProviderStatus> => {
    if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;
    pending ??= protocol.probe(config, cliEnvironment({}, base)).then(
      probe => probe.ok ? { ok: true as const, ...identity(probe.version) } : { ok: false as const, code: probe.code, message: probe.message, ...identity(probe.version) },
      () => ({ ok: false as const, code: "probe-failed" as const, message: `${protocol.label} could not be checked. Run "${config.executable} --version" in a terminal.`, ...identity(null) }),
    ).then(result => { cached = { at: Date.now(), status: result }; pending = undefined; return result; });
    return pending;
  };
  return {
    status,
    async turn(request: ProviderRequest): Promise<ProviderTurn> {
      const current = await status();
      if (!current.ok) {
        // Re-probe next time: the user may install or sign in without restarting Composer.
        cached = undefined;
        throw new ProviderError(current.code === "not-installed" ? "not-installed" : current.code === "not-logged-in" ? "auth" : "unsupported", current.message, false);
      }
      const scratch = await createCliScratch();
      try {
        const { args, env } = await protocol.prepare({ config, scratch, schema: structuredTurnJsonSchema(request.tools), version: current.version! });
        const parser = protocol.createParser();
        const activity = (label: string) => request.onActivity?.(label);
        activity(`${protocol.label} started`);
        const exit = await runCliProcess({
          executable: config.executable, args, env: cliEnvironment(env ?? {}, base), cwd: scratch,
          stdin: renderStructuredPrompt(request), timeoutMs: config.timeoutMs, signal: request.signal,
          onLine: text => parser.line(text, activity),
        });
        if (request.signal.aborted) throw new ProviderError("aborted", "Stopped.", false);
        return parseStructuredTurn(parser.finish(exit), request);
      } catch (error) {
        if (error instanceof ProviderError && (error.code === "auth" || error.code === "not-installed" || error.code === "unsupported")) cached = undefined;
        throw error;
      } finally { await removeCliScratch(scratch); }
    },
  };
}
