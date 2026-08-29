export async function copyText(text: string, clipboard: Pick<Clipboard, "writeText"> | undefined = navigator.clipboard): Promise<boolean> {
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}
