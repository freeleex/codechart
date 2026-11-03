/** Reads stdin up to `max` bytes; past it, throws `overCap` or, given 'stop', returns what was read so far. */
export async function readStdin(max: number, overCap: Error | 'stop'): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > max && overCap !== 'stop') throw overCap;
    chunks.push(chunk as Buffer);
    if (size > max) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}
