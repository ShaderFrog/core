import { expect, describe, it } from 'vitest';

import util from 'util';

import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { Graph, ShaderStage } from './graph-types';
import { addNode, outputNode, sourceNode } from './graph-node';

import {
  shaderSectionsToProgram,
  mergeShaderSections,
  findShaderSections,
} from './shader-sections';
import { Program } from '@shaderfrog/glsl-parser/ast';
import { numberNode } from './data-nodes';
import { makeEdge } from './edge';
import { Engine, EngineContext, PhysicalNodeConstructor } from '../engine';
import { evaluateNode } from './evaluate';
import { compileSource } from './graph';
import { texture2DStrategy } from 'src/strategy';
import { isError } from './context';

const inspect = (thing: any): void =>
  console.log(util.inspect(thing, false, null, true));

const mergeBlocks = (ast1: Program, ast2: Program): string => {
  const s1 = findShaderSections(ast1);
  const s2 = findShaderSections(ast2);
  const merged = mergeShaderSections(s1, s2);
  return generate(
    shaderSectionsToProgram(merged, {
      includePrecisions: true,
      includeVersion: true,
    }),
  );
};

const dedupe = (code: string) =>
  generate(
    shaderSectionsToProgram(findShaderSections(parser.parse(code)), {
      includePrecisions: true,
      includeVersion: true,
    }),
  );

let counter = 0;
const p = { x: 0, y: 0 };
const id = () => '' + counter++;

const constructor: PhysicalNodeConstructor = () => ({
  config: {
    version: 3,
    preprocess: false,
    strategies: [],
    uniforms: [],
  },
  id: '1',
  name: '1',
  engine: true,
  type: '',
  inputs: [],
  outputs: [],
  position: { x: 0, y: 0 },
  source: '',
  stage: undefined,
});

const engine: Engine = {
  name: 'three',
  displayName: 'Three.js',
  evaluateNode: (node) => {
    if (node.type === 'number') {
      return parseFloat(node.value);
    }
    return node.value;
  },
  constructors: {
    physical: constructor,
    toon: constructor,
  },
  mergeOptions: {
    includePrecisions: true,
    includeVersion: true,
  },
  importers: {},
  preserve: new Set<string>(),
  parsers: {},
};

const makeSourceNode = (
  id: string,
  source: string,
  stage: ShaderStage,
  strategies = [texture2DStrategy()],
) =>
  sourceNode(
    id,
    `Shader ${id}`,
    p,
    {
      version: 2,
      preprocess: false,
      strategies,
      uniforms: [],
    },
    source,
    stage,
  );

/**
 * What exactly am I doing here?
 *
 * I opened shaderfrog to start looking at the backfilling case and inlining
 * function calls at the top of functions
 *
 * WHie doing that I found jest not to work well anyore and switched to vitest,
 * which is fine, but with esm by default I can't stub the mangleName() function
 * call, which means mangling happens as-is in the tests.
 *
 * Without changing the mangling strategy, the strategies.test.ts file fails
 * because the uniform strategy looks for a mangled variable name, but the
 * program itself isn't mangled.
 *
 * One way to fix this is to make fillers not have to care about mangling names,
 * which would be simpler on the surface.
 *
 * Then everything in the tests broke and you found out the reason why was
 * trying to use scopes to rename things, and most of the ast manipulation steps
 * don't modify scopes, so you made some of them modify scopes, and now things
 * are fucked
 */
it('compileSource() fragment produces inlined output', async () => {
  const outV = outputNode(id(), 'Output v', p, 'vertex');
  const outF = outputNode(id(), 'Output f', p, 'fragment');
  const imageReplacemMe = makeSourceNode(
    id(),
    `uniform sampler2D image1;
uniform sampler2D image2;
void main() {
  vec3 col1 = texture2D(image1, posTurn - 0.4 * time).rgb + 1.0;
  vec3 col2 = texture2D(image2, negTurn - 0.4 * time).rgb + 2.0;
  gl_FragColor = vec4(col1 + col2, 1.0);
}
`,
    'fragment',
  );
  const input1 = makeSourceNode(
    id(),
    `float a = 1.0;
void main() {
  gl_FragColor = vec4(0.0);
}
`,
    'fragment',
  );
  const input2 = makeSourceNode(
    id(),
    `float a = 2.0;
void main() {
  gl_FragColor = vec4(1.0);
}
`,
    'fragment',
  );

  const graph: Graph = {
    nodes: [outV, outF, imageReplacemMe, input1, input2],
    edges: [
      makeEdge(
        id(),
        imageReplacemMe.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment',
      ),
      makeEdge(
        id(),
        input1.id,
        imageReplacemMe.id,
        'out',
        'filler_image1',
        'fragment',
      ),
      makeEdge(
        id(),
        input2.id,
        imageReplacemMe.id,
        'out',
        'filler_image2',
        'fragment',
      ),
      makeEdge(
        id(),
        input2.id,
        imageReplacemMe.id,
        'out',
        'filler_image2',
        'fragment',
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, engine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  expect(result.fragmentResult).toContain(`vec4 main_Shader_${input1.id}() {`);
  expect(result.fragmentResult).toContain(`vec4 main_Shader_${input2.id}() {`);

  const imgOut = `frogOut_${imageReplacemMe.id}`;

  expect(result.fragmentResult).toContain(`vec4 ${imgOut};`);

  expect(result.fragmentResult)
    .toContain(`vec4 main_Shader_${imageReplacemMe.id}() {
  vec3 col1 = main_Shader_${input1.id}().rgb + 1.0;
  vec3 col2 = main_Shader_${input2.id}().rgb + 2.0;
  ${imgOut} = vec4(col1 + col2, 1.0);
  return ${imgOut};
}`);
});

it('compileSource() base case', async () => {
  const outV = outputNode(id(), 'Output v', p, 'vertex');
  const outF = outputNode(id(), 'Output f', p, 'fragment');
  const imageReplacemMe = makeSourceNode(
    id(),
    `float a = 1.0;
void main() {
  gl_FragColor = vec4(1.0);
}
`,
    'fragment',
  );

  const graph: Graph = {
    nodes: [outV, outF, imageReplacemMe],
    edges: [
      makeEdge(
        id(),
        imageReplacemMe.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment',
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, engine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  const imgOut = `frogOut_${imageReplacemMe.id}`;
  expect(result.fragmentResult).toContain(`vec4 ${imgOut};`);
  expect(result.fragmentResult)
    .toContain(`vec4 main_Shader_${imageReplacemMe.id}() {
  ${imgOut} = vec4(1.0);
  return ${imgOut};
}`);
});

describe('evaluateNode()', () => {
  it('evaluates binary nodes', () => {
    const finalAdd = addNode(id(), p);
    const add2 = addNode(id(), p);
    const num1 = numberNode(id(), 'number', p, '3');
    const num2 = numberNode(id(), 'number', p, '5');
    const num3 = numberNode(id(), 'number', p, '7');
    const graph: Graph = {
      nodes: [num1, num2, num3, finalAdd, add2],
      edges: [
        makeEdge(id(), num1.id, finalAdd.id, 'out', 'a'),
        makeEdge(id(), add2.id, finalAdd.id, 'out', 'b'),
        makeEdge(id(), num2.id, add2.id, 'out', 'a'),
        makeEdge(id(), num3.id, add2.id, 'out', 'b'),
      ],
    };
    expect(evaluateNode(engine, graph, finalAdd)).toBe(15);
  });
});

it('should merge uniforms with interface blocks', () => {
  let astX = parser.parse(`uniform vec2 x;`);
  let astY = parser.parse(`uniform vec2 y, z;
uniform vec3 a;`);
  expect(mergeBlocks(astX, astY)).toEqual(`uniform vec2 x, y, z;
uniform vec3 a;
`);

  const astL01 = parser.parse(`uniform Light0 { vec4 y; } x;`, { quiet: true });
  const astL02 = parser.parse(`uniform Light0 { vec4 y; } x;`, { quiet: true });
  expect(mergeBlocks(astL01, astL02)).toEqual(`uniform Light0 { vec4 y; } x;
`);

  const astL001 = parser.parse(`uniform Light0 { vec4 y; } x;`, {
    quiet: true,
  });
  const astL002 = parser.parse(`uniform Light0 x;`, { quiet: true });
  expect(mergeBlocks(astL001, astL002)).toEqual(`uniform Light0 { vec4 y; } x;
`);

  const astLo01 = parser.parse(`uniform Light0 x;`, { quiet: true });
  const astLo02 = parser.parse(`uniform Light0 { vec4 y; } x;`, {
    quiet: true,
  });
  expect(mergeBlocks(astLo01, astLo02)).toEqual(`uniform Light0 { vec4 y; } x;
`);

  // This may be a bug, look at how the uniforms are merged. I at least want to
  // note its current behavior in this test
  const vec2Arr1 = parser.parse(`uniform vec2 y[5];`);
  const vec2Arr2 = parser.parse(`uniform vec2 y[10];`);
  expect(mergeBlocks(vec2Arr1, vec2Arr2)).toEqual(`uniform vec2 y[10];
`);

  const block1 = parser.parse(`uniform Scene { mat4 view; };`);
  const block2 = parser.parse(`uniform Scene { mat4 view; };`);
  expect(mergeBlocks(block1, block2)).toEqual(`uniform Scene { mat4 view; };
`);

  // Verify these lines are preserved (they go through dedupeUniforms)
  expect(dedupe(`layout(std140,column_major) uniform;`)).toEqual(
    `layout(std140,column_major) uniform;`,
  );
});
