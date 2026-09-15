/** The one-request stdin framing shared by the supervised authoring commands. */
export async function readExactlyOneJson(stream: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const bytesChunk = Buffer.from(chunk as string | Uint8Array);
    bytes += bytesChunk.byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error("Request exceeds the CLI input limit.");
    chunks.push(bytesChunk);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  if (text.trim() === "") throw new Error("Request stdin is blank.");
  return JSON.parse(text) as unknown;
}
