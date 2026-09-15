import { Container, Stack } from "@zudo-composer/ui";

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
