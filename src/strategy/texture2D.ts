import { generate } from '@shaderfrog/glsl-parser';
import {
  visit,
  AstNode,
  NodeVisitors,
  IdentifierNode,
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
            texture2Dcalls.push(name);
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

  const inputs = texture2Dcalls.map<ComputedInput>((name) => {
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
          // Backfilling into the filler! Similar to parsers.ts filler
          const f = filler(...args.map(generate));
          // @ts-ignore
          parent[key] = f;
        });

        return ast;
      },
    ];
  });

  return inputs;
};
