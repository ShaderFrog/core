const items = [
  {
    pairId: 1,
    name: 'abc',
    count: 10,
  },
  {
    pairId: 1,
    name: 'xyz',
    count: 20,
  },
  {
    pairId: 2,
    name: 'abc',
    count: 15,
  },
  {
    pairId: 2,
    name: 'xyz',
    count: 25,
  },
  {
    pairId: 3,
    name: 'xyz',
    count: 25,
  },
];

// Group the items by pairId
const groups = items.reduce(
  (groups, item) => ({
    ...groups,
    [item.pairId]: [...(groups[item.pairId] || []), item],
  }),
  {}
);

// For each group, if has more than one element, append a new one with the sume of the previous elements.
// Object.values() takes advantage of the facts that object keys are iterated over in insertion order, so
// the resulting array is in the same order as the original one
const result = Object.values(groups).flatMap((group) => [
  ...group,
  ...(group.length > 1
    ? [
        {
          ...group[0],
          count: group.reduce((sum, item) => sum + item.count, 0),
        },
      ]
    : []),
]);

console.log(result);
