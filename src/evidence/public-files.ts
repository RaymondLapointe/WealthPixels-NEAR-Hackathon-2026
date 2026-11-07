import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

/** CLI files are explicitly public evidence JSON, never credentials or ignored transaction journals. */
async function publicPath(file: string, root: string, writing: boolean): Promise<string> {
  const base = resolve(root, "evidence"), target = resolve(root, file), part = relative(base, target);
  if (!part || part === ".." || part.startsWith(".." + sep) || isAbsolute(part) || extname(target) !== ".json")
    throw new Error("Place public JSON files inside this checkout's evidence directory; local runtime and credential paths are prohibited.");
  const components = [base];
  let next = base;
  for (const component of relative(base, dirname(target)).split(sep).filter(Boolean)) { next = resolve(next, component); components.push(next); }
  for (const component of components) {
    const item = await lstat(component);
    if (!item.isDirectory() || item.isSymbolicLink()) throw new Error("Public evidence directories must be regular directories without links.");
  }
  const realBase = await realpath(base), realParent = await realpath(dirname(target)), parentPart = relative(realBase, realParent);
  if (parentPart === ".." || parentPart.startsWith(".." + sep) || isAbsolute(parentPart)) throw new Error("Public evidence path escapes its directory.");
  if (!writing) {
    const item = await lstat(target);
    if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1 || item.size > 2_000_000) throw new Error("Public evidence must be a bounded regular JSON file without links.");
  }
  return target;
}
export async function readPublicEvidenceJson(file: string, root = process.cwd()): Promise<string> {
  return readFile(await publicPath(file, root, false), "utf8");
}
export async function assertUnusedPublicEvidenceOutput(file: string, root = process.cwd()): Promise<void> {
  const target = await publicPath(file, root, true);
  try { await lstat(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new Error("Public evidence output already exists; preserve it and choose a new filename.");
}
export async function writeNewPublicEvidenceJson(file: string, text: string, root = process.cwd()): Promise<void> {
  if (Buffer.byteLength(text) > 2_000_000) throw new Error("Public evidence JSON exceeds two megabytes.");
  const handle = await open(await publicPath(file, root, true), "wx", 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
}
