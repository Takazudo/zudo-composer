import { useId } from "preact/hooks";

export interface BannerProps {
  headline: string;
}

export function Banner({ headline }: BannerProps) {
  const id = useId();
  return <h1 id={id} class="self-host-banner">{headline}</h1>;
}
