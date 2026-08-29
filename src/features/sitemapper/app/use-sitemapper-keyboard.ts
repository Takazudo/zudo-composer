"use client";

import { useEffect } from "preact/hooks";

export interface KeyboardHost {
  addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
}

export interface SitemapperKeyboardOptions {
  selectedId: string | null;
  onRemoveSelected: (pageId: string) => void;
  onEscape: () => void;
  host?: KeyboardHost;
}

export function isSitemapperEditableEventTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).tagName !== "string") return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
}

export function useSitemapperKeyboard(options: SitemapperKeyboardOptions): void {
  const { selectedId, onRemoveSelected, onEscape, host } = options;
  useEffect(() => {
    const target: KeyboardHost = host ?? document;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isSitemapperEditableEventTarget(event.target)) return;
      if (event.key === "Escape") {
        onEscape();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId !== null) {
        event.preventDefault();
        onRemoveSelected(selectedId);
      }
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [host, onEscape, onRemoveSelected, selectedId]);
}
