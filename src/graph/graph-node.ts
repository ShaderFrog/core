import { NodeType, ShaderStage } from './graph-types';
import { assignemntToStrategy, variableStrategy } from '../strategy';
import { BinaryNode, CodeNode, NodeConfig, SourceType } from './code-nodes';
import { NodePosition } from './base-node';

export const sourceNode = (
  id: string,
  name: string,
  position: NodePosition,
  config: NodeConfig,
  source: string,
  stage: ShaderStage,
  originalEngine?: string,
): CodeNode => ({
  id,
  name,
  type: NodeType.SOURCE,
  sourceType: SourceType.SHADER_PROGRAM,
  engine: false,
  config,
  position,
  inputs: [],
  outputs: [
    {
      name: 'vector4',
      dataType: 'vector4',
      category: 'data',
      id: '1',
    },
  ],
  source,
  stage,
  originalEngine,
});

export const outputNode = (
  id: string,
  name: string,
  position: NodePosition,
  stage: ShaderStage,
): CodeNode => ({
  id,
  name,
  position,
  type: NodeType.OUTPUT,
  sourceType: SourceType.SHADER_PROGRAM,
  engine: false,
  config: {
    version: 3,
    mangle: false,
    preprocess: false,
    uniforms: [],
    inputMapping:
      stage === 'fragment'
        ? {
            filler_frogFragOut: 'Color',
          }
        : {
            filler_gl_Position: 'Position',
          },
    strategies: [
      assignemntToStrategy(
        stage === 'fragment' ? 'frogFragOut' : 'gl_Position',
      ),
    ],
  },
  inputs: [],
  outputs: [],
  // Consumed by findVec4Constructo4
  source:
    stage === 'fragment'
      ? `
#version 300 es
precision highp float;

out vec4 frogFragOut;
void main() {
  frogFragOut = vec4(1.0);
}
`
      : // gl_Position isn't "out"-able apparently https://stackoverflow.com/a/24425436/743464
        `
#version 300 es
precision highp float;

void main() {
  gl_Position = vec4(1.0);
}
`,
  stage,
});

export const expressionNode = (
  id: string,
  name: string,
  position: NodePosition,
  source: string,
): CodeNode => ({
  id,
  name,
  position,
  type: NodeType.SOURCE,
  engine: false,
  sourceType: SourceType.EXPRESSION,
  stage: undefined,
  config: {
    uniforms: [],
    version: 3,
    preprocess: false,
    inputMapping: {},
    strategies: [variableStrategy()],
  },
  inputs: [],
  outputs: [
    {
      name: 'expression',
      category: 'data',
      id: '1',
    },
  ],
  source,
});

export const BINARY_NODE_TYPES = {
  add: { operator: '+', output: 'sum' },
  subtract: { operator: '-', output: 'difference' },
  multiply: { operator: '*', output: 'product' },
  divide: { operator: '/', output: 'quotient' },
} as const;

export type BinaryNodeType = keyof typeof BINARY_NODE_TYPES;

export const binaryNodeTypes = Object.keys(
  BINARY_NODE_TYPES,
) as BinaryNodeType[];

export const isBinaryNodeType = (type: string): type is BinaryNodeType =>
  type in BINARY_NODE_TYPES;

export const binaryNodeType = (node: BinaryNode): BinaryNodeType | undefined =>
  binaryNodeTypes.find(
    (type) => BINARY_NODE_TYPES[type].operator === node.operator,
  );

export const binaryNode = (
  id: string,
  position: NodePosition,
  type: BinaryNodeType,
): BinaryNode => {
  const { operator, output } = BINARY_NODE_TYPES[type];
  return {
    id,
    name: type,
    position,
    type: NodeType.BINARY,
    engine: false,
    stage: undefined,
    config: {
      mangle: false,
      version: 3,
      preprocess: true,
      strategies: [],
      uniforms: [],
    },
    inputs: [],
    outputs: [
      {
        name: output,
        category: 'data',
        id: '1',
      },
    ],
    source: `a ${operator} b`,
    operator,
    sourceType: SourceType.EXPRESSION,
    biStage: true,
  };
};

/**
 * Switch a binary node to a different operator. Keeps the id, position,
 * inputs, and output ids so the edges into and out of it stay connected. The
 * node name is only changed if it's still the default name of the old type.
 */
export const changeBinaryNodeType = (
  node: BinaryNode,
  type: BinaryNodeType,
): BinaryNode => {
  const { operator, output } = BINARY_NODE_TYPES[type];
  const oldType = binaryNodeType(node);
  return {
    ...node,
    name: !oldType || node.name === oldType ? type : node.name,
    source: `a ${operator} b`,
    operator,
    outputs: node.outputs.map((o) => ({ ...o, name: output })),
  };
};

export const addNode = (id: string, position: NodePosition): BinaryNode =>
  binaryNode(id, position, 'add');

export const subtractNode = (id: string, position: NodePosition): BinaryNode =>
  binaryNode(id, position, 'subtract');

export const multiplyNode = (id: string, position: NodePosition): BinaryNode =>
  binaryNode(id, position, 'multiply');

export const divideNode = (id: string, position: NodePosition): BinaryNode =>
  binaryNode(id, position, 'divide');
