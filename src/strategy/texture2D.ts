import { generate } from '@shaderfrog/glsl-parser';
import {
  visit,
  AstNode,
  NodeVisitors,
  IdentifierNode,
  Program,
} from '@shaderfrog/glsl-parser/ast';
import { nodeInput } from '../graph/base-node';
import { BaseStrategy, ApplyStrategy, StrategyType, ComputedInput } from '.';

export interface Texture2DStrategy extends BaseStrategy {
  type: StrategyType.TEXTURE_2D;
}
export const texture2DStrategy = (): Texture2DStrategy => ({
  type: StrategyType.TEXTURE_2D,
  config: {},
});

export const applyTexture2DStrategy: ApplyStrategy<Texture2DStrategy> = (
  strategy,
  ast,
  graphNode,
  siblingNode,
) => {
  //let texture2Dcalls: [string, AstNode, string, AstNode[], AstNode][] = [];
  let texture2Dcalls: string[] = [];

  const references: Record<
    string,
    { parent: AstNode; key: string; args: AstNode[] }[]
  > = {};

  const visitors: NodeVisitors = {
    function_call: {
      enter: (path) => {
        const identifier = path.node.identifier as IdentifierNode;
        if (
          // TODO: 100 vs 300
          (identifier?.identifier === 'texture2D' ||
            identifier?.identifier === 'texture') &&
          path.key
        ) {
          if (!path.parent) {
            throw new Error(
              'This error is impossible. A function call always has a parent.',
            );
          }

          const name = generate(path.node.args[0]);

          if (!(name in references)) {
            references[name] = [];
            texture2Dcalls.push(
              name,
              // path.parent as AstNode,
              // path.key,
              // // Remove the first argument and comma to populate the backfiller args
              // (path.node.args as AstNode[]).slice(2),
              // // For backfilling, find the parent statement of this texture2D() call.
              // // This is to try to ensure the backfilled dependency has access to
              // // any variables used in the texture2D() call.
              // path.findParent((p) => 'semi' in p.node)?.node,
            );
          }

          references[name].push({
            parent: path.parent as AstNode,
            key: path.key,
            args: (path.node.args as AstNode[]).slice(2),
          });
        }
      },
    },
  };
  visit(ast, visitors);

  const inputs = texture2Dcalls.map<ComputedInput>((name, index) => {
    //([name, parent, key, texture2dArgs, stmt], index) => {
    return [
      nodeInput(
        name,
        `filler_${name}`,
        'filler',
        'vector4', // Data type for what plugs into this filler
        ['code', 'data'],
        false,
      ),
      (filler) => {
        references[name].forEach(({ parent, key, args }) => {
          const f = filler(...args.map(generate));
          // @ts-ignore
          parent[key] = f;
        });

        return ast;
      },

      // These are the backfiller args
      //texture2dArgs,

      // The fillerStmt
      //stmt,
    ];
  });

  return inputs;
};
