import { parse } from '@shaderfrog/glsl-parser';
import { FunctionNode, Program } from '@shaderfrog/glsl-parser/ast';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { SourceType } from './code-nodes';

const tryParse = (source: string): Program | undefined => {
  try {
    return parse(source, { quiet: true });
  } catch (e) {
    return;
  }
};

// Statements of the source wrapped in a main() fn, or undefined if it isn't
// valid inside a function body
const fnBodyStatements = (source: string) =>
  (
    tryParse(`void main() {\n${source}\n}`)?.program[0] as
      | FunctionNode
      | undefined
  )?.body.statements;

/**
 * Work out what kind of code a node's source is, so the user doesn't have to
 * pick it:
 * - An expression is a single expression, optionally ending in a semicolon,
 *   like `vec4(main_X().r)`
 * - A shader program parses at the top level and defines a function
 * - A function body fragment is more than one statement that's valid inside a
 *   function body
 * Returns undefined if the source is none of these, like a half typed edit,
 * so the caller can keep the node's current type.
 */
export const detectSourceType = (source: string): SourceType | undefined => {
  // The trailing semicolon is optional for expressions. Any other semicolon
  // makes more than one statement.
  const statements = fnBodyStatements(`${source.trim().replace(/;$/, '')};`);
  if (
    statements?.length === 1 &&
    statements[0].type === 'expression_statement'
  ) {
    return SourceType.EXPRESSION;
  }

  let preprocessed: string;
  try {
    preprocessed = preprocess(source, { preserve: { version: () => true } });
  } catch (e) {
    preprocessed = source;
  }
  if (
    tryParse(preprocessed)?.program.some((stmt) => stmt.type === 'function')
  ) {
    return SourceType.SHADER_PROGRAM;
  }

  if ((fnBodyStatements(source)?.length || 0) > 1) {
    return SourceType.FN_BODY_FRAGMENT;
  }
};
