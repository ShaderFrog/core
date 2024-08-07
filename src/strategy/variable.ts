import { AstNode, Program } from '@shaderfrog/glsl-parser/ast';
import { InputCategory, nodeInput } from '../graph/base-node';
import {
  BaseStrategy,
  ApplyStrategy,
  StrategyType,
  ComputedInput,
  Filler,
} from '.';
import { Scope, ScopeIndex } from '@shaderfrog/glsl-parser/parser/scope';
import { generateFiller } from '../util/ast';

export interface VariableStrategy extends BaseStrategy {
  type: StrategyType.VARIABLE;
}
export const variableStrategy = (): VariableStrategy => ({
  type: StrategyType.VARIABLE,
  config: {},
});

export const applyVariableStrategy: ApplyStrategy<VariableStrategy> = (
  strategy,
  ast,
  graphNode,
  siblingNode,
) => {
  const program = ast as Program;
  return Object.values(
    (program.scopes as Scope[]).reduce<ScopeIndex>(
      (acc, scope) => ({ ...acc, ...scope.bindings }),
      {},
    ),
  ).flatMap((binding: any) => {
    return (binding.references as AstNode[]).reduce<ComputedInput[]>(
      (acc, ref) => {
        let identifier: string, replacer;

        if (ref.type === 'declaration') {
          identifier = ref.identifier.identifier;
          replacer = (filler: Filler) => {
            ref.identifier.identifier = generateFiller(filler());
            return ast;
          };
        } else if (ref.type === 'identifier') {
          identifier = ref.identifier;
          replacer = (filler: Filler) => {
            ref.identifier = generateFiller(filler());
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
              ['code', 'data'],
              false,
            ),
            replacer,
          ],
        ];
      },
      [],
    );
  });
};
