import { afterEach, expect, it } from "vitest";
import { computed, flush, For, signal, type Signal } from "@takazudo/zfb/zudo-react";
import { mountOwned, type OwnedRoot } from "../../src/runtime/root";

const roots: OwnedRoot[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.stop(); });

interface Option { value: string; label: string }

// Option lists are static per <select>; a plain helper (not a component) must
// produce the <option> children (zudo-react parser-context rule).
function optionElement(option: Option) {
  return <option value={option.value}>{option.label}</option>;
}

it("(e) dynamic select options: the select is rebuilt per option revision and the model is kept valid", async () => {
  const options = signal({ rev: 1, list: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] as readonly Option[] });
  const selected: Signal<string> = signal("b");
  const versions = computed(() => [options.value]);

  // Set options and model in one batch: the next select validates its model
  // against its new static options (ZR_MODEL_VALUE otherwise).
  function replaceOptions(list: readonly Option[]) {
    if (!list.some((o) => o.value === selected.value)) selected.value = list[0]?.value ?? "";
    options.value = { rev: options.value.rev + 1, list };
  }

  function Picker() {
    return (
      <label>
        Composition
        <For each={versions} by={(v) => v.rev}>
          {(v) => <select modelValue={selected}>{v.value.list.map(optionElement)}</select>}
        </For>
      </label>
    );
  }
  const root = mountOwned(Picker, {});
  roots.push(root);
  expect(root.handle).not.toBeNull();
  let select = root.host.querySelector("select")!;
  expect(select.value).toBe("b");

  select.value = "a";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  expect(selected.value).toBe("a");

  const { batch } = await import("@takazudo/zfb/zudo-react");
  batch(() => replaceOptions([{ value: "a", label: "Alpha" }, { value: "c", label: "Gamma" }]));
  await flush();
  select = root.host.querySelector("select")!;
  expect([...select.options].map((o) => o.label)).toEqual(["Alpha", "Gamma"]);
  expect(select.value).toBe("a");

  batch(() => replaceOptions([{ value: "d", label: "Delta" }]));
  await flush();
  select = root.host.querySelector("select")!;
  expect(select.value).toBe("d");
  expect(selected.value).toBe("d");
  expect(root.diagnostics).toEqual([]);
});

it("(e) numeric input keeps an invalid intermediate draft without saving the last valid value", async () => {
  const saved = signal(4);
  const draft = signal<{ raw: string; value: number | null }>({ raw: "4", value: 4 });
  const invalid = computed(() => draft.value.value === null);
  const dirty = computed(() => draft.value.value !== saved.value);
  const saveDisabled = computed(() => invalid.value || !dirty.value);
  const input = { current: null as HTMLInputElement | null };
  const writes: number[] = [];

  function NumberField() {
    return (
      <form on:submit={(event) => {
        event.preventDefault();
        const next = draft.value.value;
        if (next === null) return; // never fall back to the previous valid value
        writes.push(next);
        saved.value = next;
      }}>
        <input
          ref={input}
          type="number"
          step="1"
          value={String(saved.value)}
          aria-invalid={invalid}
          on:input={(event) => {
            const el = event.currentTarget;
            const raw = el.value;
            const parsed = raw.trim() === "" || el.validity.badInput ? null : Number(raw);
            draft.value = { raw, value: parsed !== null && Number.isFinite(parsed) ? parsed : null };
          }}
        />
        <button type="submit" disabled={saveDisabled}>Save field</button>
        <button type="button" on:click={() => {
          // Discard: an uncontrolled numeric input must be written back explicitly.
          draft.value = { raw: String(saved.value), value: saved.value };
          input.current!.value = String(saved.value);
        }}>Discard local draft</button>
      </form>
    );
  }
  const root = mountOwned(NumberField, {});
  roots.push(root);
  const el = input.current!;
  const [save, discard] = [...root.host.querySelectorAll("button")];
  await flush();
  expect(save!.disabled).toBe(true);

  // A browser reports "-" / "1e" as value "" (badInput); jsdom sanitizes to "".
  el.value = "1e";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  expect(el.value).toBe("");
  expect(el.getAttribute("aria-invalid")).toBe("true");
  expect(save!.disabled).toBe(true);
  root.host.querySelector("form")!.requestSubmit();
  expect(writes).toEqual([]);
  expect(saved.value).toBe(4);

  el.value = "12";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  expect(save!.disabled).toBe(false);
  el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  discard!.click();
  await flush();
  expect(el.value).toBe("4");
  expect(save!.disabled).toBe(true);

  el.value = "7";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  root.host.querySelector("form")!.requestSubmit();
  expect(writes).toEqual([7]);
});
