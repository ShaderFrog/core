import {
  Program,
  DeclarationStatementNode,
  KeywordNode,
  DeclaratorListNode,
  AstNode,
} from '@shaderfrog/glsl-parser/ast';

import { nodeInput } from '../graph/base-node';
import { GraphDataType } from '../graph/data-nodes';
import { BaseStrategy, ApplyStrategy, StrategyType, ComputedInput } from '.';
import { generateFiller } from '../util/ast';
import { renameBinding } from '@shaderfrog/glsl-parser/parser/utils';
import { ScopeEntry } from '@shaderfrog/glsl-parser/parser/scope';

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

const isUniformDeclaration = (
  node: Program['program'][0]
): node is DeclarationStatementNode =>
  node.type === 'declaration_statement' &&
  node.declaration.type === 'declarator_list' &&
  !!node.declaration?.specified_type?.qualifiers?.find(
    (n) => (n as KeywordNode).token === 'uniform'
  );
// commented this out to allow for sampler2D uniforms to appear as inputs
// && uniformType !== 'sampler2D'

export const applyUniformStrategy: ApplyStrategy<UniformStrategy> = (
  strategy,
  ast,
  graphNode
) => {
  const program = ast as Program;

  return (program.program || [])
    .filter(isUniformDeclaration)
    .flatMap<ComputedInput>((node) => {
      const declaration = node.declaration as DeclaratorListNode;

      // The uniform declaration type, like vec4
      // TODO: File VSCode bug, this is highlighted like a function
      const uniformType = (
        declaration?.specified_type?.specifier?.specifier as KeywordNode
      )?.token;
      const graphDataType = mapUniformType(uniformType);

      const { declarations } = declaration;

      // Capture the uniform names, and then capture their references in the
      // closure. This allows the scope binding to be renamed when the AST is
      // mangled, but this strategy can still find the original named variables
      // to work with
      const names = declarations.map((d) => d.identifier.identifier);
      const references = names.reduce<Record<string, ScopeEntry>>(
        (acc, name) => ({
          ...acc,
          [name]: program.scopes[0].bindings[name],
        }),
        {}
      );

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
          // Remove the declaration line, or the declared uniform
          if (declarations.length === 1) {
            program.program.splice(program.program.indexOf(node), 1);
          } else {
            const decl = node.declaration as DeclaratorListNode;
            decl.declarations = decl.declarations.filter(
              (d) => d.identifier.identifier !== name
            );
          }

          // Rename all the references to said uniform
          renameBinding(references[name], generateFiller(filler()));

          return ast;
        },
      ]);
    });
};
