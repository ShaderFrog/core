import { generate } from '@shaderfrog/glsl-parser';
import {
  AstNode,
  Program,
  Scope,
  ScopeIndex,
} from '@shaderfrog/glsl-parser/ast';
import { ComputedInput } from '../graph';
import { InputCategory, nodeInput } from '../nodes/core-node';
import { BaseStrategy, StrategyImpl, StrategyType } from '.';

export interface VariableStrategy extends BaseStrategy {
  type: StrategyType.VARIABLE;
}
export const variableStrategy = (): VariableStrategy => ({
  type: StrategyType.VARIABLE,
  config: {},
});

export const applyVariableStrategy: StrategyImpl = (node, ast, strategy) => {
  const program = ast as Program;
  return Object.values(
    (program.scopes as Scope[]).reduce<ScopeIndex>(
      (acc, scope) => ({ ...acc, ...scope.bindings }),
      {}
    )
  ).flatMap((binding: any) => {
    return (binding.references as AstNode[]).reduce<ComputedInput[]>(
      (acc, ref) => {
        let identifier: string, replacer;

        if (ref.type === 'declaration') {
          identifier = ref.identifier.identifier;
          replacer = (fillerAst: AstNode | Program) => {
            ref.identifier.identifier = generate(fillerAst);
            return ast;
          };
        } else if (ref.type === 'identifier') {
          identifier = ref.identifier;
          replacer = (fillerAst: AstNode | Program) => {
            ref.identifier = generate(fillerAst);
            return ast;
          };
          // } else if (ref.type === 'parameter_declaration') {
          //   identifier = ref.declaration.identifier.identifier;
          //   replacer = (fillerAst: AstNode) => {
          //     ref.declaration.identifier.identifier = generate(fillerAst);
          //   };
        } else {
          return acc;
        }
        return [
          ...acc,
          [
            nodeInput(
              identifier,
              `filler_${identifier}`,
              'filler',
              undefined, // Data type for what plugs into this filler
              new Set<InputCategory>(['code', 'data']),
              false
            ),
            replacer,
          ],
        ];
      },
      []
    );
  });
};
