const indexById = <T extends { id: string | number }>(records: T[]) =>
  records.reduce<Record<string, T>>(
    (acc, record) => ({ ...acc, [record.id]: record }),
    {}
  );

export default indexById;
