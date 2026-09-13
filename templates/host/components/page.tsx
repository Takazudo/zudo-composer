import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

export interface PageFrameProps { content?: ComponentChildren }
export function PageFrame({ content }: PageFrameProps) {
  return <main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16 font-sans text-slate-900">{content}</main>;
}

export interface WelcomeProps { heading: string; description: string }
export function Welcome({ heading, description }: WelcomeProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} class="flex flex-col gap-4">
      <h1 id={headingId} class="text-4xl font-semibold tracking-tight">{heading}</h1>
      <p class="max-w-prose text-lg leading-relaxed text-slate-600">{description}</p>
    </section>
  );
}

export interface PictureProps { src: string; alt: string }
export function Picture({ src, alt }: PictureProps) {
  return src ? <img src={src} alt={alt} width="640" height="400" class="aspect-[8/5] w-full rounded-lg object-cover" /> : null;
}
