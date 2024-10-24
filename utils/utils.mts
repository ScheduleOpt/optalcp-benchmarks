import * as zlib from 'zlib';
import * as fs from 'fs';

/* Small utilities used by most of the benchmarks */

/** Read a file, if necessary gunzip it, and convert into a string. */
export function readFile(filename: string): string {
  if (filename.endsWith(".gz"))
    return zlib.gunzipSync(fs.readFileSync(filename), {}).toString();
  else
    return fs.readFileSync(filename, "utf8");
}

/** Read a file, if necessary gunzip it, and convert into an array of numbers. */
export function readFileAsNumberArray(filename: string): number[] {
  return readFile(filename).trim().split(/\s+/).map(Number);
}

/**
 * Create model name from benchmark name and input data file name.
 * Basically connects those two strings and:
 * - Gets rid of common "data/" prefix in the filename.
 * - Replaces all slashes with underscores (so we can generate e.g. json export file names from model names).
 * - Gets rid of ".gz" suffix in the filename if present.
 * - Removes any other short suffix (2 or 3 characters) such as ".txt".
 */
export function makeModelName(benchmarkName: string, filename: string): string {
  return benchmarkName + '_' + filename.replaceAll(/[/\\]/g, '_').replace(/^data_/, '').replace(/\.gz$/, '').replace(/\....?$/, '');
}
