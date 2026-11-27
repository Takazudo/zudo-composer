import type { Child } from "@takazudo/zfb/zudo-react";

// The component contract types a slot prop framework-neutrally (any object);
// Composer passes it rendered zudo-react children.
export interface PageFrameProps { content?: Child | object }
export function PageFrame({ content }: PageFrameProps) {
  return <main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16 font-sans text-slate-900">{content as Child}</main>;
}

export interface WelcomeProps { heading: string; description: string }
export function Welcome({ heading, description }: WelcomeProps) {
  return (
    <section aria-label={heading} class="flex flex-col gap-4">
      <h1 class="text-4xl font-semibold tracking-tight">{heading}</h1>
      <p class="max-w-prose text-lg leading-relaxed text-slate-600">{description}</p>
    </section>
  );
}

export interface PictureProps { src: string; alt: string }
export function Picture({ src, alt }: PictureProps) {
  return src ? <img src={src} alt={alt} width="640" height="400" class="aspect-[8/5] w-full rounded-lg object-cover" /> : null;
}
