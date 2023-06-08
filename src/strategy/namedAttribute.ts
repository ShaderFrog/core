import { generate } from '@shaderfrog/glsl-parser';
import { AstNode, Program } from '@shaderfrog/glsl-parser/ast';
import { InputCategory, nodeInput } from '../nodes/core-node';
import { BaseStrategy, StrategyImpl, StrategyType } from '.';

export const namedAttributeStrategy = (
  attributeName: string
): NamedAttributeStrategy => ({
  type: StrategyType.NAMED_ATTRIBUTE,
  config: { attributeName },
});
export interface NamedAttributeStrategy extends BaseStrategy {
  type: StrategyType.NAMED_ATTRIBUTE;
  config: {
    attributeName: string;
  };
}

export const applyNamedAttributeStrategy: StrategyImpl = (
  node,
  ast,
  strategy
) => {
  const program = ast as Program;
  const cast = strategy as NamedAttributeStrategy;
  const { attributeName } = cast.config;
  return [
    [
      nodeInput(
        attributeName,
        `filler_${attributeName}`,
        'filler',
        undefined, // Data type for what plugs into this filler
        new Set<InputCategory>(['code', 'data']),
        true
      ),
      (fillerAst) => {
        Object.entries(program.scopes[0].bindings).forEach(
          ([name, binding]: [string, any]) => {
            binding.references.forEach((ref: AstNode) => {
              if (
                ref.type === 'identifier' &&
                ref.identifier === attributeName
              ) {
                ref.identifier = generate(fillerAst);
              } else if (
                ref.type === 'parameter_declaration' &&
                'identifier' in ref.declaration &&
                ref.declaration.identifier.identifier === attributeName
              ) {
                ref.declaration.identifier.identifier = generate(fillerAst);
              }
            });
          }
        );
        return ast;
      },
    ],
  ];
};
