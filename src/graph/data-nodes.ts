import { BaseNode, NodeInput, NodeOutput, NodePosition } from './base-node';

type ArrayType = 'array';
type Vector = 'vector2' | 'vector3' | 'vector4';
type Color = 'rgb' | 'rgba';
type Mat =
  | 'mat2'
  | 'mat3'
  | 'mat4'
  | 'mat2x2'
  | 'mat2x3'
  | 'mat2x4'
  | 'mat3x2'
  | 'mat3x3'
  | 'mat3x4'
  | 'mat4x2'
  | 'mat4x3'
  | 'mat4x4';

export type GraphDataType =
  | Vector
  | Color
  | Mat
  | 'texture'
  | 'samplerCube'
  | 'number'
  | ArrayType;

const TypeCompatibility: Set<GraphDataType>[] = [
  new Set(['vector4', 'rgba']),
  new Set(['vector3', 'rgb']),
  // Note vector4 is wrong here - you can't plug a *data* vector4 into a
  // texture. But the output of a shader node is a *bakeable* vector4. This
  // allows that. Needs updating to take into account data vs code
  new Set(['texture', 'samplerCube', 'vector4']),
];

export const canMapType = (
  fromType: GraphDataType | undefined,
  toType: GraphDataType | undefined
) => {
  if (fromType === toType || !fromType || !toType) {
    return true;
  }
  return TypeCompatibility.some(
    (compatibility) => compatibility.has(fromType) && compatibility.has(toType)
  );
};

export interface NumberNode extends BaseNode {
  type: 'number';
  value: string;
  range?: [string | number, string | number];
  stepper?: string | number;
  isRandom?: boolean;
}
export const numberNode = (
  id: string,
  name: string,
  position: NodePosition,
  value: string,
  optionals?: {
    range?: [string | number, string | number];
    stepper?: string | number;
    isRandom?: boolean;
    inputs?: NodeInput[];
    outputs?: NodeOutput[];
  }
): NumberNode => ({
  type: 'number',
  id,
  name,
  position,
  value,
  inputs: optionals?.inputs || [],
  outputs: optionals?.outputs || [
    {
      name: 'float',
      id: '1',
      dataType: 'number',
      category: 'data',
    },
  ],
  range: optionals?.range,
  stepper: optionals?.stepper,
  isRandom: optionals?.isRandom,
});

export type NumberDataUniform = Pick<
  NumberNode,
  'type' | 'value' | 'name' | 'range' | 'stepper'
>;

export const numberUniformData = (
  name: string,
  value: string,
  range?: [string | number, string | number],
  stepper?: string | number
): NumberDataUniform => ({
  type: 'number',
  name,
  value,
  range,
  stepper,
});

export type TextureNodeValueData = {
  assetId?: number;
  versionId?: number;
  properties?: {
    repeatTexure: boolean;
    repeat?: { x: number; y: number };
    anisotropy?: number;
    encoding?: 'srgb';
  };
};
export interface TextureNode extends BaseNode {
  type: 'texture';
  // This is specific to the shaderfrog site and should probably be refactored
  // out. Maybe a separate TextureSiteNode and friends? Open to ideas here.
  value?: TextureNodeValueData;
}
export const textureNode = (
  id: string,
  name: string,
  position: NodePosition,
  value?: TextureNodeValueData
): TextureNode => ({
  type: 'texture',
  id,
  name,
  position,
  value: {
    ...(value || { assetId: undefined, versionId: undefined }),
    properties: value?.properties || { repeatTexure: true },
  },
  inputs: [],
  outputs: [
    {
      name: 'texture',
      id: '1',
      dataType: 'texture',
      category: 'data',
    },
  ],
});

export type TextureDataUniform = Pick<TextureNode, 'type' | 'value' | 'name'>;

export const textureUniformData = (
  name: string,
  value: TextureNodeValueData
): TextureDataUniform => ({ type: 'texture', name, value });

export interface SamplerCubeNode extends BaseNode {
  type: 'samplerCube';
  value: string;
}
export const samplerCubeNode = (
  id: string,
  name: string,
  position: NodePosition,
  value: string
): SamplerCubeNode => ({
  type: 'samplerCube',
  id,
  name,
  position,
  value,
  inputs: [],
  outputs: [
    {
      name: 'samplerCube',
      id: '1',
      dataType: 'samplerCube',
      category: 'data',
    },
  ],
});

export type SamplerCubeDataUniform = Pick<
  SamplerCubeNode,
  'type' | 'value' | 'name'
>;

export const samplerCubeUniformData = (
  name: string,
  value: string
): SamplerCubeDataUniform => ({ type: 'samplerCube', name, value });

export type ArrayValue = string[];

export interface ArrayNode extends BaseNode {
  type: 'array';
  dimensions: number;
  value: ArrayValue;
}

export function arrayNode(
  id: string,
  name: string,
  position: NodePosition,
  value: ArrayValue
): ArrayNode {
  return {
    id,
    name,
    position,
    inputs: [],
    outputs: [
      {
        name: 'array',
        id: '1',
        dataType: 'array',
        category: 'data',
      },
    ],
    value,
    dimensions: value.length,
    type: 'array',
  };
}

export type Vector2 = [string, string];
export type Vector3 = [string, string, string];
export type Vector4 = [string, string, string, string];

export interface Vector2Node extends BaseNode {
  type: 'vector2';
  dimensions: 2;
  value: Vector2;
  range?: [string, string, string, string];
}
export interface Vector3Node extends BaseNode {
  type: 'vector3';
  dimensions: 3;
  value: Vector3;
}
export interface Vector4Node extends BaseNode {
  type: 'vector4';
  dimensions: 4;
  value: Vector4;
}

export function vectorNode(
  id: string,
  name: string,
  position: NodePosition,
  value: Vector2 | Vector3 | Vector4
): Vector2Node | Vector3Node | Vector4Node {
  const dataType =
    value.length === 2 ? 'vector2' : value.length === 3 ? 'vector3' : 'vector4';
  return {
    id,
    name,
    position,
    inputs: [],
    outputs: [
      {
        name: `vector${value.length}`,
        id: '1',
        category: 'data',
        dataType,
      },
    ],
    // Have to specify dimensions and type together to avoid type errors!
    ...(value.length === 2
      ? { value, dimensions: 2, type: 'vector2' }
      : value.length === 3
      ? { value, dimensions: 3, type: 'vector3' }
      : { value, dimensions: 4, type: 'vector4' }),
  };
}

export type ArrayDataUniform = Pick<
  ArrayNode,
  'type' | 'value' | 'name' | 'dimensions'
>;

export const arrayUniformData = (
  name: string,
  value: ArrayValue
): ArrayDataUniform => ({
  name,
  value,
  dimensions: value.length,
  type: 'array',
});

export type Vector2DataUniform = Pick<
  Vector2Node,
  'type' | 'value' | 'name' | 'dimensions'
>;
export type Vector3DataUniform = Pick<
  Vector3Node,
  'type' | 'value' | 'name' | 'dimensions'
>;
export type Vector4DataUniform = Pick<
  Vector4Node,
  'type' | 'value' | 'name' | 'dimensions'
>;

export const vectorUniformData = (
  name: string,
  value: Vector2 | Vector3 | Vector4
): Vector2DataUniform | Vector3DataUniform | Vector4DataUniform => ({
  name,
  ...(value.length === 2
    ? { value, dimensions: 2, type: 'vector2' }
    : value.length === 3
    ? { value, dimensions: 3, type: 'vector3' }
    : { value, dimensions: 4, type: 'vector4' }),
});

export interface RgbNode extends BaseNode {
  type: 'rgb';
  dimensions: 3;
  value: Vector3;
}
export interface RgbaNode extends BaseNode {
  type: 'rgba';
  dimensions: 4;
  value: Vector4;
}

export function colorNode(
  id: string,
  name: string,
  position: NodePosition,
  value: Vector3 | Vector4
): RgbNode | RgbaNode {
  const dataType = value.length === 3 ? 'rgb' : 'rgba';
  return {
    id,
    name,
    position,
    inputs: [],
    outputs: [
      {
        name: dataType,
        id: '1',
        dataType,
        category: 'data',
      },
    ],
    ...(value.length === 3
      ? { value, dimensions: 3, type: 'rgb' }
      : { value, dimensions: 4, type: 'rgba' }),
  };
}

export type RgbDataUniform = Omit<
  RgbNode,
  'id' | 'inputs' | 'outputs' | 'position' | 'parentId'
>;
export type RgbaDataUniform = Omit<
  RgbaNode,
  'id' | 'inputs' | 'outputs' | 'position' | 'parentId'
>;

export const colorUniformData = (
  name: string,
  value: Vector3 | Vector4
): RgbDataUniform | RgbaDataUniform => ({
  name,
  ...(value.length === 3
    ? { value, dimensions: 3, type: 'rgb' }
    : { value, dimensions: 4, type: 'rgba' }),
});

// When defining nodes, these are the types allowed in uniforms
export type UniformDataType =
  | TextureDataUniform
  | SamplerCubeDataUniform
  | NumberDataUniform
  | Vector2DataUniform
  | Vector3DataUniform
  | Vector4DataUniform
  | RgbDataUniform
  | RgbaDataUniform;

export type DataNode =
  | TextureNode
  | SamplerCubeNode
  | NumberNode
  | Vector2Node
  | Vector3Node
  | Vector4Node
  | ArrayNode
  | RgbNode
  | RgbaNode;
