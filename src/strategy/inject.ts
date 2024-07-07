import { generate } from '@shaderfrog/glsl-parser';
import { Program, AstNode } from '@shaderfrog/glsl-parser/ast';
import { InputCategory, nodeInput } from '../graph/base-node';
import { BaseStrategy, ApplyStrategy, StrategyType } from '.';
import { transferWhitespace } from '../util/whitespace';

export interface InjectStrategy extends BaseStrategy {
  type: StrategyType.INJECT;
  config: {
    find: string;
    insert: 'before' | 'after' | 'replace';
    count: number;
  };
}

/**
 * Inject source code into an AST, in a find-and-replace style. This only
 * operates on statements right now
 */
export const injectStrategy = (
  config: InjectStrategy['config'],
): InjectStrategy => ({
  type: StrategyType.INJECT,
  config,
});

export const applyInjectStrategy: ApplyStrategy<InjectStrategy> = (
  strategy,
  ast,
  graphNode,
  siblingNode,
) => {
  const program = (ast as Program).program;
  const { find, count, insert } = strategy.config;

  // Total hack for now. Search each function body for statements that when
  // generated, match the user's "find" string.
  const matchedStatements = program.reduce<[AstNode[], AstNode, number][]>(
    (matches, statement) => {
      let newMatches: [AstNode[], AstNode, number][] = [];
      if (statement.type === 'function') {
        const bodyStatements = statement.body.statements as AstNode[];
        newMatches = bodyStatements.reduce<[AstNode[], AstNode, number][]>(
          (innerMatches, bodyStmt, index) => {
            const generated = generate(bodyStmt);
            // console.log(`"${generated}"`);
            const triple: [AstNode[], AstNode, number] = [
              bodyStatements,
              bodyStmt,
              index,
            ];
            return [
              ...innerMatches,
              ...(generated.includes(find) ? [triple] : []),
            ];
          },
          [],
        );
      }
      return [...matches, ...newMatches];
    },
    [],
  );

  const name = `Inject ${strategy.config.insert}`;

  return [
    [
      nodeInput(
        name,
        `filler_${name}`,
        'filler',
        undefined, // Data type for what plugs into this filler
        ['code', 'data'],
        false,
      ),
      (fillerAst) => {
        const toInsert = Array.isArray(fillerAst)
          ? fillerAst
          : [fillerAst as AstNode];
        // Loop backwards through the matches because when we inject code into
        // parent nodes, it modifies the statement list arrays
        for (
          // Only go as many count replacements as specified in the config
          let i = Math.min(matchedStatements.length - 1, count);
          i >= 0;
          i--
        ) {
          const [parent, stmt, index] = matchedStatements[i];
          if (insert === 'after') {
            const [first, ...rest] = toInsert;
            const [newFirst, updatedStmt] = transferWhitespace(first, stmt);
            const newStatements = [newFirst, ...rest];
            parent.splice(index, 1, updatedStmt, ...newStatements);
          } else if (insert === 'before') {
            parent.splice(index - 1, 0, ...toInsert);
          } else if (insert === 'replace') {
            throw new Error('not yet implemented');
          }
        }
        return ast;
      },
    ],
  ];
};
