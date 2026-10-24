/**
 * Map errors from the real GPU compiler (WebGL / ANGLE) back to the source
 * code of the graph node they came from.
 *
 * The final shader WebGL compiles is the graph's compiled GLSL spliced into
 * whatever the engine wraps it with (Three's material source, prefixes, etc),
 * so its line numbers have nothing to do with the line numbers in each node's
 * editor. To get back to a node's line:
 *
 * 1. At parse time, each top level statement of a node's AST is tagged with
 *    the line it starts on (annotateStatementLines), and the program is tagged
 *    with a map from preprocessed source lines to editor lines, since the
 *    preprocessor drops directive lines (alignPreprocessedLines).
 * 2. When the GPU compile fails, each compiled statement is generated and
 *    searched for in the final GPU source. The generator preserves whitespace,
 *    so a statement has the same line structure in the GPU source as it did in
 *    the parsed source, and the GPU line of an error converts directly to a
 *    line in the node (mapGlslErrorsToNodes).
 */
import { generate } from '@shaderfrog/glsl-parser';
import type { LocationObject, Program } from '@shaderfrog/glsl-parser/ast';
import { preprocessComments } from '@shaderfrog/glsl-parser/preprocessor';
import type { NodeContexts, NodeErrors } from './context';
import type { ShaderSections } from './shader-sections';
import type { FrogProgram } from '../util/ast';

// An error with a location in a node's source code that didn't come from the
// glsl-parser, like an error from the GPU compiler
export type GlslCompilerError = {
  message: string;
  location: LocationObject;
};

const countNewlines = (str: string) => {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 10) count++;
  }
  return count;
};

const lineLocation = (startLine: number, endLine = startLine) => ({
  start: { line: startLine, column: 1, offset: 0 },
  end: { line: endLine, column: 1, offset: 0 },
});

/**
 * Set the location of each top level statement to the lines it spans in the
 * source the program was parsed from. Must be called right after parsing,
 * before anything modifies the AST.
 */
export const annotateStatementLines = (ast: Program) => {
  const ws: string | string[] = ast.wsStart || '';
  let line = 1 + countNewlines(Array.isArray(ws) ? ws.join('') : ws);
  for (const stmt of ast.program) {
    const text = generate(stmt);
    stmt.location = lineLocation(line, line + countNewlines(text.trimEnd()));
    line += countNewlines(text);
  }
};

// How far ahead to look for a line in the original source. Limits how far a
// macro expanded line can accidentally match a later identical line.
const ALIGN_WINDOW = 200;

/**
 * The preprocessor removes directive lines and untaken #if branches. Return a
 * map where map[n - 1] is the original source line of preprocessed line n, or
 * undefined if preprocessing didn't change anything.
 *
 * The preprocessed lines are an in-order subset of the original lines, other
 * than macro expansion, so this walks both sources together. Each
 * preprocessed line maps to the next original line with identical text. Lines
 * changed by macro expansion have no match and map to the next original line
 * that isn't a directive.
 */
export const alignPreprocessedLines = (
  original: string,
  preprocessed: string
): number[] | undefined => {
  if (original === preprocessed) {
    return;
  }
  // preprocessComments() keeps newlines, so lines still line up with original
  const orig = preprocessComments(original)
    .split('\n')
    .map((l) => l.trim());
  const last = orig.length - 1;

  let cursor = 0;
  return preprocessed.split('\n').map((rawLine) => {
    const line = rawLine.trim();
    const end = Math.min(orig.length, cursor + ALIGN_WINDOW);
    let found = -1;
    for (let j = cursor; j < end; j++) {
      if (orig[j] === line) {
        found = j;
        break;
      }
    }
    if (found === -1) {
      found = cursor;
      while (found < last && orig[found].startsWith('#')) found++;
    }
    found = Math.min(found, last);
    cursor = found + 1;
    return found + 1;
  });
};

/**
 * Parse an ANGLE style info log, "ERROR: 0:123: 'foo' : undeclared identifier"
 */
export const parseGlslErrorLog = (log: string) =>
  log.split('\n').flatMap((l) => {
    const match = l.match(/^\s*ERROR:\s*\d+:(\d+):\s*(.*)$/);
    return match ? [{ line: parseInt(match[1], 10), message: match[2] }] : [];
  });

type StatementRange = {
  nodeId: string;
  gpuStart: number;
  gpuEnd: number;
  sourceStart: number;
};

/**
 * Find which graph nodes the errors in a GPU info log came from.
 *
 * @param gpuSource The exact source the GPU compiled (gl.getShaderSource())
 * @param errorLog The shader info log (gl.getShaderInfoLog())
 * @param sections The compiled shader sections for this stage
 * @param nodeContexts For each node's preprocessor line map
 * @param includeNode Optionally skip nodes, like ones without editable source
 */
export const mapGlslErrorsToNodes = (
  gpuSource: string | null | undefined,
  errorLog: string | null | undefined,
  sections: ShaderSections,
  nodeContexts: NodeContexts,
  includeNode: (nodeId: string) => boolean = () => true
): Record<string, NodeErrors> => {
  if (!gpuSource || !errorLog) {
    return {};
  }
  const errors = parseGlslErrorLog(errorLog);
  if (!errors.length) {
    return {};
  }

  const lineStarts = [0];
  for (let i = 0; i < gpuSource.length; i++) {
    if (gpuSource.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  // 1-based line number of a character offset
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const ranges: StatementRange[] = [];
  Object.values(sections).forEach((statements) => {
    for (const { nodeId, source } of statements) {
      if (!source?.location || !includeNode(nodeId)) continue;
      const text = generate(source).trimEnd();
      if (!text) continue;
      const index = gpuSource.indexOf(text);
      // Skip statements that aren't in the GPU source, or are ambiguous, like
      // a uniform declaration that also appears in the engine's code
      if (index === -1 || gpuSource.indexOf(text, index + 1) !== -1) continue;
      const gpuStart = lineAt(index);
      ranges.push({
        nodeId,
        gpuStart,
        gpuEnd: gpuStart + countNewlines(text),
        sourceStart: source.location.start.line,
      });
    }
  });

  const result: Record<string, NodeErrors> = {};
  const seen = new Set<string>();
  for (const { line, message } of errors) {
    // If a statement starts on the same line another ends, prefer the later one
    const range = ranges.reduce<StatementRange | undefined>(
      (best, r) =>
        r.gpuStart <= line &&
        line <= r.gpuEnd &&
        (!best || r.gpuStart > best.gpuStart)
          ? r
          : best,
      undefined
    );
    if (!range) continue;

    const parsedLine = range.sourceStart + (line - range.gpuStart);
    const lineMap = (nodeContexts[range.nodeId]?.ast as FrogProgram)
      ?.sourceLineMap;
    const sourceLine = lineMap?.[parsedLine - 1] ?? parsedLine;

    const key = `${range.nodeId}:${sourceLine}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result[range.nodeId] = result[range.nodeId] || {
      type: 'errors',
      nodeId: range.nodeId,
      errors: [],
    };
    result[range.nodeId].errors.push({
      message,
      location: lineLocation(sourceLine),
    });
  }

  return result;
};
