export type Entry = { offset: number; text: string };

export function visibleEntries(
  entries: Entry[],
  searchText: string,
  loading: boolean,
): Entry[] {
  const query = searchText.trim().toLocaleLowerCase();
  const matches = entries.filter((entry) =>
    entry.text.toLocaleLowerCase().includes(query),
  );
  return !loading && query
    ? [...matches, { offset: -1, text: searchText }]
    : matches;
}
