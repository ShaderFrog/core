import {
  Program,
  DeclarationStatementNode,
  KeywordNode,
  DeclaratorListNode,
} from '@shaderfrog/glsl-parser/ast';
import { mangleName } from '../graph/graph';
import { nodeInput } from '../graph/base-node';
import { GraphDataType } from '../graph/data-nodes';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { ComputedInput } from '../graph/parsers';
import { generateFiller } from '../util/ast';

export interface UniformStrategy extends BaseStrategy {
  type: StrategyType.UNIFORM;
}
export const uniformStrategy = (): UniformStrategy => ({
  type: StrategyType.UNIFORM,
  config: {},
});

const DATA_TYPE_MAP: Readonly<[GraphDataType, Set<string>][]> = [
  ['vector2', new Set(['bvec2', 'dvec2', 'ivec2', 'uvec2', 'vec2'])],
  ['number', new Set(['float', 'double', 'int', 'uint', 'atomic_uint'])],
  ['vector3', new Set(['bvec3', 'dvec3', 'ivec3', 'uvec3', 'vec3'])],
  ['vector4', new Set(['bvec4', 'dvec4', 'ivec4', 'uvec4', 'vec4'])],
  ['texture', new Set(['sampler2D'])],
  ['mat2', new Set(['mat2', 'dmat2'])],
  ['mat3', new Set(['mat3', 'dmat3'])],
  ['mat4', new Set(['mat4', 'dmat4'])],
  ['mat2x2', new Set(['mat2x2', 'dmat2x2'])],
  ['mat2x3', new Set(['mat2x3', 'dmat2x3'])],
  ['mat2x4', new Set(['mat2x4', 'dmat2x4'])],
  ['mat3x2', new Set(['mat3x2', 'dmat3x2'])],
  ['mat3x3', new Set(['mat3x3', 'dmat3x3'])],
  ['mat3x4', new Set(['mat3x4', 'dmat3x4'])],
  ['mat4x2', new Set(['mat4x2', 'dmat4x2'])],
  ['mat4x3', new Set(['mat4x3', 'dmat4x3'])],
  ['mat4x4', new Set(['mat4x4', 'dmat4x4'])],
];
/**
 * Uncategorized:
 * 
"sampler1D"
"sampler3D"
"samplerCube"
"sampler1DShadow"
"sampler2DShadow"
"samplerCubeShadow"
"sampler1DArray"
"sampler2DArray"
"sampler1DArrayShadow"
"sampler2DArrayshadow"
"isampler1D"
"isampler2D"
"isampler3D"
"isamplerCube"
"isampler1Darray"
"isampler2DArray"
"usampler1D"
"usampler2D"
"usampler3D"
"usamplerCube"
"usampler1DArray"
"usampler2DArray"
"sampler2DRect"
"sampler2DRectshadow"
"isampler2DRect"
"usampler2DRect"
"samplerBuffer"
"isamplerBuffer"
"usamplerBuffer"
"samplerCubeArray"
"samplerCubeArrayShadow"
"isamplerCubeArray"
"usamplerCubeArray"
"sampler2DMS"
"isampler2DMS"
"usampler2DMS"
"sampler2DMSArray"
"isampler2DMSArray"
"usampler2DMSArray"
"image1D"
"iimage1D"
"uimage1D"
"image2D"
"iimage2D"
"uimage2D"
"image3D"
"iimage3D"
"uimage3D"
"image2DRect"
"iimage2DRect"
"uimage2DRect"
"imageCube"
"iimageCube"
"uimageCube"
"imageBuffer"
"iimageBuffer"
"uimageBuffer"
"image1DArray"
"iimage1DArray"
"uimage1DArray"
"image2DArray"
"iimage2DArray"
"uimage2DArray"
"imageCubeArray"
"iimageCubeArray"
"uimageCubeArray"
"image2DMS"
"iimage2DMS"
"uimage2DMS"
"image2DMArray"
"iimage2DMSArray"
"uimage2DMSArray"
"struct"
 */

const mapUniformType = (type: string): GraphDataType | undefined => {
  const found = DATA_TYPE_MAP.find(([_, set]) => set.has(type));
  if (found) {
    return found[0];
  }
  // console.log(`Unknown uniform type, can't map to graph: ${type}`);
};

export const applyUniformStrategy: ApplyStrategy<UniformStrategy> = (
  graphNode,
  ast,
  strategy
) => {
  const program = ast as Program;
  return (program.program || []).flatMap<ComputedInput>((node) => {
    // The uniform declaration type, like vec4
    const uniformType = (
      ((node as DeclarationStatementNode).declaration as DeclaratorListNode)
        ?.specified_type?.specifier?.specifier as KeywordNode
    )?.token;
    const graphDataType = mapUniformType(uniformType);

    // If this is a uniform declaration line
    if (
      node.type === 'declaration_statement' &&
      node.declaration.type === 'declarator_list' &&
      node.declaration?.specified_type?.qualifiers?.find(
        (n) => (n as KeywordNode).token === 'uniform'
      )
      // commented this out to allow for sampler2D uniforms to appear as inputs
      // && uniformType !== 'sampler2D'
    ) {
      // Capture all the declared names, removing mangling suffix
      const { declarations } = node.declaration;
      const names = declarations.map(
        (d: any) => d.identifier.identifier
      ) as string[];

      // Tricky code warning: The flow of preparing a node for the graph is:
      // 1. Produce/mangle the AST (with unmangled names)
      // 2. findInputs() (with unmangled names)
      // 3. The AST is *then* mangled in graph.ts
      // 4. Later, the inputs are filled in, and now, we have an input with
      //    the name "x" but the ast now has the mangled name "x_1". So
      //    here, we look for the *mangled* name in the strategy runner
      return names.map<ComputedInput>((name) => [
        nodeInput(
          name,
          `uniform_${name}`,
          'uniform',
          graphDataType,
          ['code', 'data'],
          true
        ),
        (filler) => {
          const mangledName = mangleName(name, graphNode);
          // Remove the declaration line, or the declared uniform
          if (declarations.length === 1) {
            program.program.splice(program.program.indexOf(node), 1);
          } else {
            const decl = node.declaration as DeclaratorListNode;
            decl.declarations = decl.declarations.filter(
              (d) => d.identifier.identifier !== mangledName
            );
          }
          // And rename all the references to said uniform
          program.scopes[0].bindings[name].references.forEach((ref) => {
            if (ref.type === 'identifier' && ref.identifier === mangledName) {
              ref.identifier = generateFiller(filler);
            } else if (
              ref.type === 'parameter_declaration' &&
              'identifier' in ref &&
              ref.identifier.identifier === mangledName
            ) {
              ref.identifier.identifier = generateFiller(filler);
            } else if ('identifier' in ref) {
              ref.identifier = generateFiller(filler);
            } else {
              console.warn(
                'Unknown uniform reference for',
                graphNode.name,
                'ref'
              );
            }
          });

          return ast;
        },
      ]);
    }
    return [];
  });
};
