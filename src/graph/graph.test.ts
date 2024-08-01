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
import { compileSource, nodeName, resultName } from './graph';
import { texture2DStrategy } from '../strategy';
import { isError } from './context';
import { fail } from '../test-util';
import { SourceType } from './code-nodes';

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

  const iOutName = resultName(imageReplacemMe);
  const iMainName = nodeName(imageReplacemMe);
  expect(result.fragmentResult).toContain(`
void main() {
  vec4 ${iOutName} = ${iMainName}();
  frogFragOut = ${iOutName};
}`);

  /**
   * Starting to look at memoizing the return of each function at the top of
   * the main function.
   *
   * Things to keep in mind:
   * - Support the function getting called with backfill args
   * - Support if there are loops in the graph which all need this, so track
   *   the memoized variable and pass it down all the way through.
   * - Support for dynamic variable names in your source code to avoid having
   *   to hard code a node's name and ID. Should be a magic reference and maybe
   *   an ID under the hood.
   *
   * Do all of the fillers need to be called in the top level main function?
   */
  const iOut1 = resultName(input1);
  const iOut2 = resultName(input2);
  expect(result.fragmentResult).toContain(`vec4 ${iMainName}() {
  vec4 ${iOut2} = ${nodeName(input2)}();
  vec4 ${iOut1} = ${nodeName(input1)}();
  vec3 col1 = ${iOut1}.rgb + 1.0;
  vec3 col2 = ${iOut2}.rgb + 2.0;
  ${imgOut} = vec4(col1 + col2, 1.0);
  return ${imgOut};
}`);
});

it('compileSource() inlining an expression', async () => {
  const outV = outputNode(id(), 'Output v', p, 'vertex');
  const outF = outputNode(id(), 'Output f', p, 'fragment');
  const imageReplacemMe = makeSourceNode(
    id(),
    `uniform sampler2D image1;
void main() {
  vec3 col1 = texture2D(image1, posTurn - 0.4 * time).rgb + 1.0;
  gl_FragColor = vec4(col1, 1.0);
}
`,
    'fragment',
  );

  // Inine an expression source node
  const input = makeSourceNode(id(), `vec4(1.0)`, 'fragment');
  input.sourceType = SourceType.EXPRESSION;

  const graph: Graph = {
    nodes: [outV, outF, imageReplacemMe, input],
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
        input.id,
        imageReplacemMe.id,
        'out',
        'filler_image1',
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

  // Verify it inlined the expression and did not memoize the source into a
  // varaible
  expect(result.fragmentResult).toContain(`vec4 ${nodeName(imageReplacemMe)}() {
  vec3 col1 = vec4(1.0).rgb + 1.0;`);
});

it('compileSource() binary zzz', async () => {
  const outV = outputNode(id(), 'Output v', p, 'vertex');
  const outF = outputNode(id(), 'Output f', p, 'fragment');

  const color = makeSourceNode(
    id(),
    `uniform sampler2D image;
void main() {
  vec3 col = texture2D(image, vec2(0.0)).rgb;
  gl_FragColor = vec4(col, 1.0);
}
`,
    'fragment',
  );

  // Inine an expression source node
  const expr = makeSourceNode(id(), `vec4(1.0)`, 'fragment');
  expr.sourceType = SourceType.EXPRESSION;

  const add = addNode(id(), p);
  const graph: Graph = {
    nodes: [color, expr, add, outV, outF],
    edges: [
      makeEdge(id(), color.id, add.id, 'out', 'a'),
      makeEdge(id(), expr.id, add.id, 'out', 'b'),
      makeEdge(id(), add.id, outF.id, 'out', 'filler_frogFragOut', 'fragment'),
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

  /**
   * I think we're seeing the need for hoisiting / continuations / passing (no
   * idea if this is right terminology, it's 1am) of function calls. Because
   * "main_Shader_2_out" fills in "a", and "vec4(1.0)" fills in "b", and we need
   * to inject the dclaration line. When does main_Shader_2_out get inlined?
   *
   * In the binary node filler I think. At that time, we don't know what
   * node the binary node is inlined into! It could be inlined into another
   * binary node! We need to queue up the function calls, and flush the queue
   * once we hit a main function?
   *
   * Or we could queue them all up until the output node, put them all in the
   * output node, and then pass them back down to the functions that need them.
   * We might have to do something like that regardless for the backfilling
   * case, and the case when a value is needed in more than one place in the
   * graph.
   *
   * At least there's a failing test for it now.
   *
   * I was also thinking a cop-out option could be to simply inline the function
   * call filler into the binary node filler, but that means the filler needs
   * to branch based on its context, which it doesn't currently have...
   */
  expect(result.fragmentResult).toContain(`void main() {
  vec4 ${resultName(color)} = ${nodeName(color)}();
  frogFragOut = (${resultName(color)}+ vec4(1.0));
}`);
});

it('compileSource() binary ttt', async () => {
  const outV = outputNode(id(), 'Output v', p, 'vertex');
  const outF = outputNode(id(), 'Output f', p, 'fragment');

  const a = makeSourceNode(
    id(),
    `
void main() {
  gl_FragColor = vec4(col, 1.0);
}
`,
    'fragment',
  );
  const b = makeSourceNode(
    id(),
    `
void main() {
  gl_FragColor = vec4(col, 1.0);
}
`,
    'fragment',
  );

  // Inine an expression source node
  const expr = makeSourceNode(id(), `vec4(1.0)`, 'fragment');
  expr.sourceType = SourceType.EXPRESSION;

  const add = addNode(id(), p);
  const graph: Graph = {
    nodes: [a, b, add, outV, outF],
    edges: [
      makeEdge(id(), a.id, add.id, 'out', 'a'),
      makeEdge(id(), b.id, add.id, 'out', 'b'),
      makeEdge(id(), add.id, outF.id, 'out', 'filler_frogFragOut', 'fragment'),
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

  expect(result.fragmentResult).toContain(`void main() {
  vec4 ${resultName(b)} = ${nodeName(b)}();
  vec4 ${resultName(a)} = ${nodeName(a)}();
  frogFragOut = (${resultName(a)}+ ${resultName(b)});
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
