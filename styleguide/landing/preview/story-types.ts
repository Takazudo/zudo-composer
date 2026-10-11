import type { ComponentChildren } from "preact";
import type { Story as EngineStory } from "@takazudo/zudo-sg/stories";
export type { StoryMeta, StoryControl } from "@takazudo/zudo-sg/stories";
// The authored component pack is Preact; only declarative controls cross to SG.
export type Story<P = Record<string, unknown>> = Omit<
  EngineStory<P>,
  "render"
> & {
  render: (args?: Partial<P>) => ComponentChildren;
};
