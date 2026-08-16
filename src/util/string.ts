export const replaceFromOffset = (
  str: string,
  offset: number,
  search: string | RegExp,
  replacement: string
) => str.slice(0, offset) + str.slice(offset).replace(search, replacement);

export const replaceLast = (
  str: string,
  charToReplace: string,
  replacement: string
) => {
  const index = str.lastIndexOf(charToReplace);
  if (index === -1) return str;
  return (
    str.slice(0, index) + replacement + str.slice(index + charToReplace.length)
  );
};
