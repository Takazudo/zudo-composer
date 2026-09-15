// Public barrel for @zudo-composer/ui. Trimmed from the pinned @zudo-sg/ui
// barrel (Takazudo/zudo-sg@6b0826c, src/index.ts) to the 12 components this
// package actually ships — see README.md for the full provenance record.

export { Callout, Note } from "./cards/callout/callout";
export type { CalloutTone, CalloutProps } from "./cards/callout/callout";

export { Card, CardTitle } from "./cards/card/card";
export type { CardVariant, CardPadding, CardProps, CardTitleProps } from "./cards/card/card";

export { ProseMd } from "./content/prose-md/prose-md";
export type { ProseMdProps } from "./content/prose-md/prose-md";

export { ProseP } from "./content/prose-p/prose-p";
export type { ProsePProps } from "./content/prose-p/prose-p";

export { PlaceholderBox } from "./media/placeholder-box/placeholder-box";
export type { PlaceholderBoxSize, PlaceholderBoxProps } from "./media/placeholder-box/placeholder-box";

export { AutoGrid } from "./shared/auto-grid/auto-grid";
export type { AutoGridMin, AutoGridGap, AutoGridProps } from "./shared/auto-grid/auto-grid";

export { Container } from "./shared/container/container";
export type { ContainerProps } from "./shared/container/container";

export { CtaButton } from "./shared/cta-button/cta-button";
export type { CtaButtonVariant, CtaButtonProps } from "./shared/cta-button/cta-button";

export { Hero } from "./shared/hero/hero";
export type { HeroAction, HeroVariant, HeroProps } from "./shared/hero/hero";

export { SectionHeading } from "./shared/section-heading/section-heading";
export type { SectionHeadingProps } from "./shared/section-heading/section-heading";

export { SplitLayout } from "./shared/split-layout/split-layout";
export type { SplitLayoutRatio, SplitLayoutGap, SplitLayoutProps } from "./shared/split-layout/split-layout";

export { Stack } from "./shared/stack/stack";
export type { StackDirection, StackGap, StackAlign, StackJustify, StackProps } from "./shared/stack/stack";

export { cx } from "./lib/cx";
export type { ClassValue } from "./lib/cx";
