/**
 * Utility functions to work with whitespace on nodes.
 *
 * This is for manual manipulaiton of code where adding new lines should
 * attempt to keep the indentation of the original program.
 *
 * Another overal option is simply to pretty print, which this library
 * does not yet support.
 */
import {
  AstNode,
  DoStatementNode,
  FunctionNode,
  Whitespace,
} from '@shaderfrog/glsl-parser/ast';
import { makeFnStatement } from './ast';

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[31m(core.whitespace)\x1b[0m', ...args);

// Typescript fucked up flat https://stackoverflow.com/a/61420611/743464
export const combineWs = (
  a: string | string[],
  b: string | string[],
): string[] => [a, b].flat(<20>Infinity);

// Move whitespace from one node to another. Since whitespace is trailing, if a
// node is injected after a previous node, move the whitespace from the earlier
// node to the later one. This keeps comments in the same place.
export const transferWhitespace = (
  to: AstNode,
  from: AstNode,
): [AstNode, AstNode] => {
  return 'semi' in to && 'semi' in from
    ? [
        {
          ...to,
          semi: {
            ...to.semi,
            whitespace: from.semi.whitespace,
          },
        },
        {
          ...from,
          semi: {
            ...from.semi,
            whitespace: '\n',
          },
        },
      ]
    : 'whitespace' in to && 'semi' in from
      ? [
          {
            ...to,
            whitespace: combineWs(to.whitespace, from.semi.whitespace),
          },
          {
            ...from,
            semi: {
              ...from.semi,
              whitespace: '\n',
            },
          },
        ]
      : [to, from];
};

export const getLiteralIndent = (node: { whitespace: Whitespace }) =>
  [node?.whitespace || '']
    .flat(<20>Infinity)
    .join('')
    .split(/\r|\n/)
    .sort()
    .at(-1);

export const tryAddTrailingWhitespace = <T extends AstNode>(
  node: T,
  ws: string,
): T => {
  return 'semi' in node
    ? {
        ...node,
        semi: {
          ...node.semi,
          whitespace: combineWs(node.semi.whitespace, ws),
        },
      }
    : node;
};

export const guessFnIndent = (fnBody: FunctionNode) =>
  getLiteralIndent(fnBody.body.lb) ||
  fnBody.body.statements.reduce((ws, n) => {
    return ws || getLiteralIndent((n as DoStatementNode).semi);
  }, '');

export const addFnStmtWithIndent = (
  fnBody: FunctionNode,
  newNode: string | AstNode,
): AstNode[] => {
  const statements = fnBody.body.statements;
  const indent = guessFnIndent(fnBody);
  return [
    ...statements,
    // This simple hack is way easier than trying to modify the function body
    // opening brace and/or the previous statement
    { type: 'literal', literal: '', whitespace: indent },
    tryAddTrailingWhitespace(
      typeof newNode === 'string' ? makeFnStatement(newNode)[0] : newNode,
      `\n`,
    ),
  ];
};
