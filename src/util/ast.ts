import { generate } from '@shaderfrog/glsl-parser';
import { Filler } from '../parsers';

export const generateFiller = (filler: Filler) => {
  if (!filler) {
    throw new Error('Cannot generate void filler!');
  }
  return Array.isArray(filler)
    ? filler.map(generate).join('')
    : generate(filler);
};
