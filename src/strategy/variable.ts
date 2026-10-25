import { generate } from '@shaderfrog/glsl-parser';
import { AstNode, IdentifierNode, visit } from '@shaderfrog/glsl-parser/ast';
import { InputCategory, nodeInput } from '../graph/base-node';
import {
  BaseStrategy,
  ApplyStrategy,
  StrategyType,
  ComputedInput,
  Filler,
} from '.';
import { Scope, ScopeIndex } from '@shaderfrog/glsl-parser/parser/scope';
import { FrogProgram, generateFiller } from '../util/ast';

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
  siblingNode
) => {
  const program = ast as FrogProgram;
  const variableInputs = Object.values(
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
              false
            ),
            replacer,
          ],
        ];
      },
      []
    );
  });

  return [...variableInputs, ...undeclaredFunctionInputs(program)];
};

/**
 * Inputs for an expression or function body fragment: the variables and
 * functions it uses but doesn't declare. Unlike the variable strategy, this
 * skips variables the snippet declares itself, which can't be replaced.
 */
export const snippetInputs = (program: FrogProgram): ComputedInput[] => [
  ...Object.entries(program.undeclaredVariables || {})
    // Built in variables like gl_FragCoord aren't inputs
    .filter(([name]) => !name.startsWith('gl_'))
    .map<ComputedInput>(([name, refs]) => [
      nodeInput(
        name,
        `filler_${name}`,
        'filler',
        undefined,
        ['code', 'data'],
        false
      ),
      (filler: Filler) => {
        refs.forEach((ref) => {
          (ref as IdentifierNode).identifier = generateFiller(filler());
        });
        return program;
      },
    ]),
  ...undeclaredFunctionInputs(program),
];

// Calls to functions the snippet doesn't declare, like main_Chain_Chomp(),
// become inputs too. Plugging a node into one replaces the call with that
// node's filler, so the reference follows the edge if the node is swapped out.
const undeclaredFunctionInputs = (program: FrogProgram): ComputedInput[] => {
  // The parser doesn't always represent a call's name as an identifier, so
  // match the call nodes the scope found instead of their names
  const callNames = new Map<AstNode, string>(
    Object.entries(program.undeclaredFunctions || {}).flatMap(([name, nodes]) =>
      nodes.map((node) => [node, name] as const)
    )
  );
  if (!callNames.size) {
    return [];
  }

  const calls: Record<
    string,
    { parent: any; key: string; index?: number; args: AstNode[] }[]
  > = {};
  visit(program, {
    function_call: {
      enter: (path) => {
        const name = callNames.get(path.node);
        if (!name || !path.parent || !path.key) {
          return;
        }
        calls[name] = calls[name] || [];
        calls[name].push({
          parent: path.parent,
          key: path.key,
          index: path.index,
          args: path.node.args,
        });
      },
    },
  });

  return Object.entries(calls).map<ComputedInput>(([name, refs]) => [
    nodeInput(
      `${name}()`,
      `filler_fn_${name}`,
      'filler',
      undefined,
      ['code', 'data'],
      false
    ),
    (filler: Filler) => {
      refs.forEach(({ parent, key, index, args }) => {
        // Args include the comma literals between them
        const f = filler(
          ...args
            .filter((arg) => arg.type !== 'literal' || arg.literal !== ',')
            .map(generate)
        );
        if (typeof index === 'number') {
          parent[key][index] = f;
        } else {
          parent[key] = f;
        }
      });
      return program;
    },
  ]);
};
