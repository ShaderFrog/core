import { expect, it } from 'vitest';

import { Graph, ShaderStage } from '../../graph/graph-types';
import { outputNode, sourceNode } from '../../graph/graph-node';

import { makeEdge } from '../../graph/edge';
import { EngineContext } from '../../engine';
import { compileSource, nodeName, resultName } from '../../graph/graph';
import { namedAttributeStrategy, texture2DStrategy } from '../../strategy';
import { isError } from '../../graph/context';
import { threngine } from './threngine';
import { makeId } from '../../util/id';
import { fail } from '../../test-util';
import importers from './importers';
import { generate, parser } from '@shaderfrog/glsl-parser';

const p = { x: 0, y: 0 };

const makeSourceNode = (
  id: string,
  source: string,
  stage: ShaderStage,
  strategies = [texture2DStrategy(), namedAttributeStrategy('position')],
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

it('threngine compileSource() and manipulateAst()', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');

  const vertInput = makeSourceNode(
    makeId(),
    `uniform vec4 modelViewMatrix;
attribute vec3 position;
float a = 2.0;
void main() {
  gl_Position = modelViewMatrix * vec4(position, 1.0);
}
`,
    'vertex',
  );

  const graph: Graph = {
    nodes: [outV, outF, vertInput],
    edges: [
      makeEdge(
        makeId(),
        vertInput.id,
        outV.id,
        'out',
        'filler_gl_Position',
        'vertex',
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, threngine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  // Threngine has parsers for vertex shaders, make sure that is set properly
  expect(result.vertexResult).toContain(`vec4 main_Shader_${vertInput.id}() {
  vec4 frogOut = modelViewMatrix * vec4(position, 1.0);
  return frogOut;
}`);

  // Check that it inlned. For fun.
  expect(result.vertexResult).toContain(
    `gl_Position = ${nodeName(vertInput)}();`,
  );
});

it('threngine compileSource() linking through vertex', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');

  const vert1 = makeSourceNode(
    makeId(),
    `void main() {
  gl_Position = modelViewMatrix * vec4(position, 1.0);
}
`,
    'vertex',
  );
  const vert2 = makeSourceNode(
    makeId(),
    `void main() {
  gl_Position = modelViewMatrix * vec4(position, 1.0);
}
`,
    'vertex',
  );

  const graph: Graph = {
    nodes: [outV, outF, vert1, vert2],
    edges: [
      makeEdge(
        makeId(),
        vert1.id,
        outV.id,
        'out',
        'filler_gl_Position',
        'vertex',
      ),
      makeEdge(
        makeId(),
        vert2.id,
        vert1.id,
        'out',
        'filler_position',
        'vertex',
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, threngine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  // Because vert2 links through vert1, it should be a vec3, not a vec4
  expect(result.vertexResult).toContain(`vec3 ${nodeName(vert2)}() {`);
  expect(result.vertexResult).toContain(`vec4 ${nodeName(vert1)}() {`);
});

it('threngine shadertoy import', async () => {
  const testImport = `
void mainImage( out vec4 fragColor, in vec2 fragCoord ){
  vec3 rd = normalize(vec3(2.*fragCoord - iResolution.xy, iResolution.y));
  fragColor = vec4(sqrt(clamp(col, 0., 1.)), 1.0 * iTime);
}
`;

  const p = parser.parse(testImport);
  importers.shadertoy.convertAst(p, { type: 'fragment' });
  expect(generate(p)).toContain(`
precision highp float;
precision highp int;

uniform vec2 mouse;
uniform float time;
uniform vec2 renderResolution;

void main() {
  vec3 rd = normalize(vec3(2.*gl_FragCoord.xy - renderResolution.xy, renderResolution.y));
  gl_FragColor = vec4(sqrt(clamp(col, 0., 1.)), 1.0 * time);
}
`);
});
