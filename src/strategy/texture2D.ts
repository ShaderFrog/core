import { generate } from '@shaderfrog/glsl-parser';
import {
  visit,
  AstNode,
  NodeVisitors,
  Program,
} from '@shaderfrog/glsl-parser/ast';
import { ComputedInput } from '../graph';
import { SourceNode } from '../nodes/code-nodes';
import { InputCategory, nodeInput, NodeInput } from '../nodes/core-node';
import { GraphDataType } from '../nodes/data-nodes';
import { BaseStrategy, StrategyImpl, StrategyType } from '.';

export interface Texture2DStrategy extends BaseStrategy {
  type: StrategyType.TEXTURE_2D;
}
export const texture2DStrategy = (): Texture2DStrategy => ({
  type: StrategyType.TEXTURE_2D,
  config: {},
});

export const applyTexture2DStrategy: StrategyImpl = (node, ast, strategy) => {
  let texture2Dcalls: [string, AstNode, string, AstNode[]][] = [];
  const seen: { [key: string]: number } = {};
  const visitors: NodeVisitors = {
    function_call: {
      enter: (path) => {
        if (
          // TODO: 100 vs 300
          // @ts-ignore
          (path.node.identifier?.specifier?.identifier === 'texture2D' ||
            // @ts-ignore
            path.node.identifier?.specifier?.identifier === 'texture') &&
          path.key
        ) {
          if (!path.parent) {
            throw new Error(
              'This error is impossible. A function call always has a parent.'
            );
          }

          const name = generate(path.node.args[0]);
          seen[name] = (seen[name] || 0) + 1;
          texture2Dcalls.push([
            name,
            path.parent as AstNode,
            path.key,
            // Remove the first argument and comma
            (path.node.args as AstNode[]).slice(2),
          ]);
        }
      },
    },
  };
  visit(ast, visitors);
  const names = new Set(
    Object.entries(seen).reduce<string[]>(
      (arr, [name, count]) => [...arr, ...(count > 1 ? [name] : [])],
      []
    )
  );
  const inputs = texture2Dcalls.map<ComputedInput>(
    ([name, parent, key, texture2dArgs], index) => {
      // Suffix input name if it's used more than once
      const iName = names.has(name) ? `${name}_${index}` : name;
      return [
        nodeInput(
          iName,
          `filler_${iName}`,
          'filler',
          'vector4', // Data type for what plugs into this filler
          new Set<InputCategory>(['code', 'data']),
          false
        ),
        (fillerAst) => {
          // @ts-ignore
          parent[key] = fillerAst;
          return ast;
        },
        texture2dArgs,
      ];
    }
  );

  return inputs;
};
