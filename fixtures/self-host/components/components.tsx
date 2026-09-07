export interface BannerProps {
  headline: string;
}

export function Banner({ headline }: BannerProps) {
  return <h1 class="self-host-banner">{headline}</h1>;
}
