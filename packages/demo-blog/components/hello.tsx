export interface HelloProps {
  text: string;
}

export function Hello({ text }: HelloProps) {
  return <p class="text-blog-accent">{text}</p>;
}
