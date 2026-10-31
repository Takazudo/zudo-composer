// @ts-check
/**
 * Deterministic reply policy shared by the in-process fake provider and the
 * fake CLI executables used by process-protocol tests. It reads the same
 * request document a CLI model reads and answers with the same structured
 * reply contract, so fake and CLI paths exercise one editing contract.
 * It never contacts a model or any network service.
 *
 * Understood requests (case-insensitive):
 *   replace "A" with "B"               edit the current page
 *   replace "A" with "B" on all pages  edit every editable page that contains A
 *   suggest "text"                     offer wording without changing the draft
 *   remember: fact                     Memory update (saved or proposed per mode)
 *   wait                               keep replying until stopped
 *   try to apply                       request a tool that does not exist (must be refused)
 *   HTML/CSS/JSX, new component, template, file or shell requests are declined.
 *
 * A Content-AI request (its tools include propose_article_fields) gets a fixed
 * title-only proposal: the current title with " (revised)" appended.
 */

export const FAKE_POLICY_VERSION = "fake-policy/1";

/** @typedef {{ type: string, text?: string, id?: string, name?: string, input?: unknown, content?: string, is_error?: boolean }} DocumentBlock */
/** @typedef {{ system: string, tools: { name: string }[], messages: { role: "user" | "assistant", content: DocumentBlock[] }[] }} RequestDocument */
/** @typedef {{ text: string, tool_calls: { id: string, name: string, input_json: string }[], stop: "end_turn" | "tool_use" | "refusal", hang?: true }} FakeReply */

/** @param {string} text @param {{ name: string, input: unknown }[]} [calls] @returns {FakeReply} */
const reply = (text, calls = []) => ({ text, tool_calls: [], stop: "end_turn", ...(calls.length ? { tool_calls: calls.map((call, index) => ({ id: "", name: call.name, input_json: JSON.stringify(call.input), index })), stop: "tool_use" } : {}) });

/** @param {unknown} value @returns {any} */
const json = value => { try { return JSON.parse(String(value)); } catch { return null; } };

/**
 * @param {RequestDocument} document
 * @returns {FakeReply}
 */
export function fakeDecide(document) {
  if (document.tools.some(tool => tool.name === "propose_article_fields")) return contentAiDecision(document);
  const messages = document.messages;
  let turnIndex = -1;
  messages.forEach((message, index) => { if (message.role === "user" && message.content.some(block => block.type === "text" && String(block.text).includes("<turn_context>"))) turnIndex = index; });
  if (turnIndex < 0) return reply("I didn't receive a request.");
  const turnText = String(messages[turnIndex].content.find(block => block.type === "text" && String(block.text).includes("<turn_context>"))?.text ?? "");
  const request = turnText.split("\n\n<turn_context>")[0].trim();
  const pageMatch = /Current page: .*\(sitemapId "([^"]+)", pageId "([^"]+)"/.exec(turnText);
  const currentPage = pageMatch ? { sitemapId: pageMatch[1], pageId: pageMatch[2] } : null;
  const after = messages.slice(turnIndex + 1);
  const step = after.filter(message => message.role === "assistant").length;
  /** @type {Map<string, { name: string, input: any, content: any, isError: boolean }>} */
  const calls = new Map();
  for (const message of after) for (const block of message.content) {
    if (block.type === "tool_call" && block.id) calls.set(block.id, { name: String(block.name), input: block.input, content: null, isError: false });
    if (block.type === "tool_result" && block.id && calls.has(block.id)) Object.assign(/** @type {object} */ (calls.get(block.id)), { content: json(block.content) ?? block.content, isError: !!block.is_error });
  }
  const results = [...calls.values()];
  const last = (/** @type {string} */ name) => results.filter(result => result.name === name).at(-1);
  const failed = (/** @type {{ content: any } | undefined} */ result) => `I couldn't do that: ${typeof result?.content === "object" && result?.content?.message ? result.content.message : String(result?.content ?? "the tool failed")}`;
  const decide = () => {
    if (/^wait$/i.test(request)) return { ...reply(""), hang: /** @type {const} */ (true) };
    if (/^try to apply$/i.test(request)) return step === 0 ? reply("", [{ name: "apply_draft", input: {} }]) : reply("That tool is not available to me.");
    if (/\b(html|css|jsx|javascript|new component|create a component|template|shell|command|delete (?:the )?file|write (?:a |the )?file)\b/i.test(request)) {
      return { text: "I can't do that here. I can only propose changes to the fields and blocks of the components this site already defines; you review and apply them.", tool_calls: [], stop: /** @type {const} */ ("refusal") };
    }
    const remember = /^remember:\s*([\s\S]+)$/i.exec(request);
    if (remember) {
      const fact = remember[1].trim().slice(0, 500);
      if (!document.tools.some(tool => tool.name === "remember")) return reply("Memory is turned off for this site, so I can't remember that.");
      const result = last("remember");
      if (!result) return reply("", [{ name: "remember", input: { change: { kind: "append", text: fact } } }]);
      return result.isError ? reply(failed(result)) : reply(`${String(result.content)}`);
    }
    const suggest = /^suggest\s+"([\s\S]+)"$/i.exec(request);
    if (suggest) return step === 0 ? reply("", [{ name: "suggest_wording", input: { text: suggest[1] } }]) : reply("I offered that wording; the draft is unchanged.");
    const replace = /^replace\s+"([\s\S]+?)"\s+with\s+"([\s\S]*?)"(\s+on all pages)?\.?$/i.exec(request);
    if (replace) return replaceFlow(replace[1], replace[2], !!replace[3]);
    return reply('Fake provider (offline). Try: replace "A" with "B", replace "A" with "B" on all pages, suggest "text", remember: a fact, or wait.');
  };
  /** @param {string} find @param {string} value @param {boolean} everywhere */
  const replaceFlow = (find, value, everywhere) => {
    const proposed = last("propose_changes");
    if (proposed) return proposed.isError ? reply(failed(proposed)) : reply(`Proposed replacing “${find}” with “${value}” (${proposed.content?.changes?.length ?? 0} change${proposed.content?.changes?.length === 1 ? "" : "s"}). It is ready for your review; nothing is saved until you apply it.`);
    if (everywhere && !last("list_pages")) return reply("", [{ name: "list_pages", input: {} }]);
    const inspected = results.filter(result => result.name === "inspect_page");
    if (!inspected.length) {
      if (everywhere) {
        const pages = (last("list_pages")?.content?.pages ?? []).filter((/** @type {any} */ page) => page.editable === true).slice(0, 10);
        if (!pages.length) return reply("No page is editable here.");
        return reply("", pages.map((/** @type {any} */ page) => ({ name: "inspect_page", input: { page: { sitemapId: page.sitemapId, pageId: page.pageId } } })));
      }
      if (!currentPage) return reply("Which page should I change? Open a page first.");
      return reply("", [{ name: "inspect_page", input: {} }]);
    }
    /** @type {{ kind: "updateField", page: { sitemapId: string, pageId: string }, nodeId: string, prop: string, value: string, reason: string }[]} */
    const operations = [];
    const reads = [];
    for (const result of inspected) {
      if (result.isError || !result.content?.page) continue;
      const page = { sitemapId: result.content.page.sitemapId, pageId: result.content.page.pageId };
      for (const node of result.content.nodes ?? []) {
        if (!node.editable) continue;
        for (const [prop, field] of Object.entries(node.fields ?? {})) {
          const exact = results.find(candidate => candidate.name === "read_field" && candidate.content?.nodeId === node.id && candidate.content?.prop === prop && candidate.input?.page?.pageId === page.pageId);
          const current = exact ? exact.content.value : /** @type {any} */ (field).value;
          if (typeof current !== "string" || !current.includes(find)) continue;
          if (/** @type {any} */ (field).clipped && !exact) { reads.push({ name: "read_field", input: { page, nodeId: node.id, prop } }); continue; }
          operations.push({ kind: "updateField", page, nodeId: node.id, prop, value: current.split(find).join(value), reason: `User asked to replace “${find}” with “${value}”.` });
        }
      }
    }
    if (reads.length) return reply("", reads);
    if (!operations.length) return reply(`I couldn't find “${find}” in an editable field${everywhere ? " on any page" : " on this page"}.`);
    return reply("", [{ name: "propose_changes", input: { operations: operations.slice(0, 20) } }]);
  };
  const decision = decide();
  // Ids are unique within this turn's transcript.
  decision.tool_calls = decision.tool_calls.map((call, index) => ({ id: `fake-${step}-${index}`, name: call.name, input_json: call.input_json }));
  return decision;
}

/** @param {RequestDocument} document @returns {FakeReply} */
function contentAiDecision(document) {
  const text = document.messages[0]?.content.find(block => block.type === "text")?.text;
  const request = json(text);
  const title = Array.isArray(request?.fields) ? request.fields.find((/** @type {any} */ field) => field.key === "title") : null;
  const decision = !title || typeof title.value !== "string"
    ? reply("", [{ name: "decline", input: { reason: "No title field was provided." } }])
    : reply("", [{ name: "propose_article_fields", input: { title: `${title.value} (revised)`, summary: "Fake CLI policy: appended (revised) to the title only." } }]);
  decision.tool_calls = decision.tool_calls.map((call, index) => ({ id: `fake-content-ai-${index}`, name: call.name, input_json: call.input_json }));
  return decision;
}
