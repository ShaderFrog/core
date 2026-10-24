import { expect, it } from 'vitest';
import { generate, parse } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import {
  alignPreprocessedLines,
  annotateStatementLines,
  mapGlslErrorsToNodes,
  parseGlslErrorLog,
} from './gl-errors';
import { findShaderSections } from './shader-sections';
import { FrogProgram } from '../util/ast';
import { NodeContexts } from './context';

const parseNode = (source: string) => {
  const preprocessed = preprocess(source, {
    preserve: { version: () => true },
  });
  const ast = parse(preprocessed, { quiet: true }) as FrogProgram;
  annotateStatementLines(ast);
  ast.sourceLineMap = alignPreprocessedLines(source, preprocessed);
  return ast;
};

it('annotates statements with the lines they span', () => {
  const ast = parse(`
// comment
uniform float t;

float fn() {
  return t;
}
float x; float y;
`);
  annotateStatementLines(ast);
  expect(ast.program.map((s) => s.location?.start.line)).toEqual([3, 5, 8, 8]);
  expect(ast.program.map((s) => s.location?.end.line)).toEqual([3, 7, 8, 8]);
});

it('aligns preprocessed lines to original lines', () => {
  const src = `#define FOO 1.0
#ifdef BAR
float x;
#endif
uniform float t; // comment

void main() {
  float a = FOO;
  gl_FragColor = vec4(a);
}`;
  const preprocessed = preprocess(src);
  const map = alignPreprocessedLines(src, preprocessed)!;
  const pre = preprocessed.split('\n');
  expect(pre[0]).toContain('uniform float t');
  expect(map[0]).toBe(5);
  // The macro expanded line has no exact match, falls back to next line
  expect(pre[3]).toContain('float a = 1.0');
  expect(map[3]).toBe(8);
  expect(map[4]).toBe(9);
});

it('returns no line map when preprocessing changes nothing', () => {
  expect(alignPreprocessedLines('float x;\n', 'float x;\n')).toBeUndefined();
});

it('parses ANGLE error logs', () => {
  expect(
    parseGlslErrorLog(`ERROR: 0:12: 'foo' : undeclared identifier
ERROR: 0:13: '=' : dimension mismatch
ERROR: 2 compilation errors.  No code generated.`)
  ).toEqual([
    { line: 12, message: "'foo' : undeclared identifier" },
    { line: 13, message: "'=' : dimension mismatch" },
  ]);
});

it('maps GPU errors back to node source lines', () => {
  const nodeSource = `#define SCALE 2.0
uniform float time;

#ifdef NOPE
float unused() { return 1.0; }
#endif

vec4 main() {
  float a = time * SCALE;
  return vec4(a, foo, 0.0, 1.0);
}`;
  const ast = parseNode(nodeSource);
  // Renaming doesn't change line structure
  const main = ast.program.find((s) => s.type === 'function') as any;
  main.prototype.header.name.identifier = 'main_node1';

  const sections = findShaderSections('node1', ast);
  const compiled = generate(ast);
  const gpuSource = `#version 300 es
#define SHADER_NAME whatever
uniform float time;
uniform mat4 modelMatrix;
${compiled}
void main() { gl_FragColor = main_node1(); }`;

  const gpuLines = gpuSource.split('\n');
  const errorLine =
    gpuLines.findIndex((l) => l.includes('vec4(a, foo')) + 1;
  const result = mapGlslErrorsToNodes(
    gpuSource,
    `ERROR: 0:${errorLine}: 'foo' : undeclared identifier\nERROR: 0:1: 'nope' : not in a node`,
    sections,
    { node1: { ast } } as unknown as NodeContexts
  );

  expect(Object.keys(result)).toEqual(['node1']);
  expect(result.node1.errors).toHaveLength(1);
  const [error] = result.node1.errors as any[];
  expect(error.message).toBe("'foo' : undeclared identifier");
  expect(nodeSource.split('\n')[error.location.start.line - 1]).toContain(
    'vec4(a, foo'
  );
});
