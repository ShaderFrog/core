import { findAssignmentTo } from '../util/ast';
import { InputCategory, nodeInput } from '../graph/base-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { AssignmentNode, AstNode } from '@shaderfrog/glsl-parser/ast';

export interface AssignemntToStrategy extends BaseStrategy {
  type: StrategyType.ASSIGNMENT_TO;
  config: {
    assignTo: string;
  };
}

// Constructor
export const assignemntToStrategy = (
  assignTo: string
): AssignemntToStrategy => ({
  type: StrategyType.ASSIGNMENT_TO,
  config: { assignTo },
});

// Apply the strategy
export const applyAssignmentToStrategy: ApplyStrategy<AssignemntToStrategy> = (
  node,
  ast,
  strategy
) => {
  const assignNode = findAssignmentTo(ast, strategy.config.assignTo);

  const name = strategy.config.assignTo;
  return assignNode
    ? [
        [
          nodeInput(
            name,
            `filler_${name}`,
            'filler',
            undefined, // Data type for what plugs into this filler
            new Set<InputCategory>(['code', 'data']),
            false
          ),
          (fillerAst) => {
            (assignNode.expression as AssignmentNode).right =
              fillerAst as AstNode;
            return ast;
          },
        ],
      ]
    : [];
};
