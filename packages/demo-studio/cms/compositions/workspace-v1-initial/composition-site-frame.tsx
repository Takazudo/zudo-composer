import { Container, Stack } from "@zudo-sg/ui";

export type CompositionOutlets = {
  "main-content"?: import("preact").ComponentChildren;
};

export default function Composition({ outlets = {} }: { outlets?: CompositionOutlets }) {
  return (
    <>
      <Container>
        <Stack direction="vertical" gap="xl" align="stretch" justify="start">
          {outlets["main-content"]}
        </Stack>
      </Container>
    </>
  );
}
