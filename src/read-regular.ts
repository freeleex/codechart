import { closeSync, constants, fstatSync, openSync, readSync, type Stats } from 'node:fs';

// Checks and reads one open file descriptor, so the file can't be swapped between check and read.
// O_NONBLOCK: a FIFO opens without blocking and fails the isFile check. O_NOFOLLOW: a swapped-in symlink fails to open.
// `accept` sees the descriptor's stats; returning false skips the read (undefined).
export function readRegularFile(path: string, accept: (st: Stats) => boolean): string | undefined {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    if (!accept(st)) return undefined;
    // Read at most the size that was checked, even if the file grows meanwhile.
    const buf = Buffer.alloc(st.size);
    let n = 0;
    for (let r = 1; r > 0 && n < buf.length; n += r) r = readSync(fd, buf, n, buf.length - n, null);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}
