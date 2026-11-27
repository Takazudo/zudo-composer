import type { Child, HTMLAttributes } from "@takazudo/zfb/zudo-react";

export type ProsePProps = { children?: Child; class?: string } & Omit<
  HTMLAttributes<HTMLParagraphElement>,
  "class" | "children"
>;

/** MDX `p` element override. No appearance of its own — flow spacing is owned by the consumer's content-flow stylesheet. */
export function ProseP({ children, ...rest }: ProsePProps) {
  return <p {...rest}>{children}</p>;
}
