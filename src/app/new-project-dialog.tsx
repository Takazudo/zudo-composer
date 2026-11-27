import { computed, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { Dialog } from "../components/overlay";
import { read, type MaybeSignal } from "../components/reactive";
import { Banner, Button, Field, Input, isComposingKey } from "../components/ui";

export interface NewProjectDialogProps {
  busy: MaybeSignal<boolean>;
  error: MaybeSignal<string | null>;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function NewProjectDialog({ busy, error, onSubmit, onClose }: NewProjectDialogProps): Child {
  const name = signal("");
  const missing = signal(false);
  const field: Ref<HTMLInputElement> = { current: null };
  const isBusy = computed(() => read(busy));
  const errorText = computed(() => read(error));
  const submit = () => {
    if (isBusy.value) return;
    const trimmed = name.value.trim();
    if (!trimmed) { missing.value = true; return; }
    missing.value = false;
    onSubmit(trimmed);
  };
  return <Dialog open title="Create project" initialFocusRef={field} dismissOnBackdrop={computed(() => !isBusy.value)} onClose={() => { if (!isBusy.value) onClose(); }} footer={<>
    <Button disabled={isBusy} on:click={() => onClose()}>Cancel</Button>
    <Button busy={isBusy} on:click={submit}>Create project</Button>
  </>}>
    <p>Name your project to start an empty, writable workspace.</p>
    <Show when={computed(() => Boolean(errorText.value))}>{() => <Banner tone="err">{computed(() => errorText.value ?? "")}</Banner>}</Show>
    <div>
      <Field label="Project name" error={computed(() => (missing.value ? "Enter a project name." : undefined))}>
        {(control) => (
          <Input
            field={control}
            elementRef={field}
            modelValue={name}
            autocomplete="off"
            disabled={isBusy}
            on:input={() => { missing.value = false; }}
            on:keydown={(event: KeyboardEvent) => { if (event.key === "Enter" && !isComposingKey(event)) { event.preventDefault(); submit(); } }}
          />
        )}
      </Field>
    </div>
  </Dialog>;
}
