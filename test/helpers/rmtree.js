// test/helpers/rmtree.js — remove a temporary tree the way these tests expect.
//
// git writes loose objects read-only (mode 0444), which on Windows becomes the read-only attribute; fs.rmSync does not
// clear it, so removing a temporary checkout that ran `git add` fails with EPERM. Clearing the write bit first makes the
// cleanup behave the same on every platform.

import fs from 'node:fs';

/** Clear the read-only bit on every file under `dir`, then remove the tree. */
export function removeTree(dir) {
  const unwrite = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = p + (p.endsWith('/') ? '' : '/') + e.name;
      if (e.isDirectory()) unwrite(full);
      else { try { fs.chmodSync(full, 0o644); } catch { /* a link or a vanished file: rmSync will report it */ } }
    }
  };
  try { unwrite(dir); } catch { /* the tree is already gone */ }
  fs.rmSync(dir, { recursive: true, force: true });
}
