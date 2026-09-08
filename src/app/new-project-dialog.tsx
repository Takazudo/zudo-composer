import { useRef, useState } from "preact/hooks";
import { Dialog } from "../components/overlay";
import { Banner, Button, Field, Input } from "../components/ui";

export function NewProjectDialog({ busy, error, onSubmit, onClose }: {
  busy: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [missing, setMissing] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const submit = () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) { setMissing(true); return; }
    setMissing(false);
    onSubmit(trimmed);
  };
  return <Dialog open title="Create project" initialFocusRef={field} dismissOnBackdrop={!busy} onClose={() => { if (!busy) onClose(); }} footer={<>
    <Button disabled={busy} onClick={onClose}>Cancel</Button>
    <Button busy={busy} onClick={submit}>Create project</Button>
  </>}>
    <p>Name your project to start an empty, writable workspace.</p>
    {error && <Banner tone="err">{error}</Banner>}
    <div ref={(element) => { field.current = element?.querySelector("input") ?? null; }}>
      <Field label="Project name" error={missing ? "Enter a project name." : undefined}>
        <Input value={name} autocomplete="off" disabled={busy} onInput={(event) => { setName(event.currentTarget.value); setMissing(false); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} />
      </Field>
    </div>
  </Dialog>;
}
