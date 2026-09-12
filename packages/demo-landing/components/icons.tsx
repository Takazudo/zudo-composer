export type IconName = "calendar" | "people" | "clock" | "bell" | "layers" | "lock";

const ICON_PATHS: Record<IconName | "check" | "plus", readonly string[]> = {
  calendar: ["M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z", "M4 10h16", "M8 3v4", "M16 3v4"],
  people: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M3 20a6 6 0 0 1 12 0", "M16 5.5a3 3 0 0 1 0 5.5", "M18 20a6 6 0 0 0-2.5-4.9"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  bell: ["M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z", "M10 21h4"],
  layers: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  lock: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  plus: ["M12 5v14", "M5 12h14"],
};

export function Icon({ name, class: className }: { name: keyof typeof ICON_PATHS; class?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" class={className}>
      {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The Orrery brand mark: an orbit ring with a centre and one planet. */
export function OrreryMark({ class: className }: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" class={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="6" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Fictional customer wordmarks for `land.logo-strip` (landing.md § 5). */
export const WORDMARKS: readonly { name: string; emblem: string }[] = [
  { name: "Pelican Labs", emblem: "M14 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm0 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12z" },
  { name: "Northfield", emblem: "M14 4l12 24H2z" },
  { name: "Quarto", emblem: "M2 4h11v11H2zM15 4h11v11H15zM2 17h11v11H2z" },
  { name: "Halden & Co", emblem: "M2 4h6v24H2zM20 4h6v24h-6zM8 13h12v6H8z" },
  { name: "Tessera", emblem: "M14 2l12 14-12 14L2 16z" },
  { name: "Brightwater", emblem: "M2 8h24v4H2zM2 15h24v4H2zM2 22h24v4H2z" },
];

export function Wordmark({ name, emblem }: { name: string; emblem: string }) {
  return (
    <svg viewBox="0 0 176 32" role="img" aria-label={name} class="h-land-wordmark w-auto text-land-muted">
      <path d={emblem} fill="currentColor" fill-rule="evenodd" />
      <text x="36" y="22" fill="currentColor" font-size="17" font-weight="600" font-family="inherit">{name}</text>
    </svg>
  );
}
