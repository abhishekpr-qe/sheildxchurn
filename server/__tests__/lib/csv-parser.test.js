const { parseCSV } = require('../../lib/csv-parser');

describe('parseCSV', () => {
  test('parses CSV with headers', () => {
    const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
    const result = parseCSV(csv);
    expect(result).toEqual([
      ['name', 'age', 'city'],
      ['Alice', '30', 'NYC'],
      ['Bob', '25', 'LA'],
    ]);
  });

  test('handles empty input', () => {
    expect(parseCSV('')).toEqual([]);
  });

  test('handles quoted fields with commas', () => {
    const csv = 'name,desc\n"Smith, John","Has a, comma"';
    const result = parseCSV(csv);
    expect(result).toEqual([
      ['name', 'desc'],
      ['Smith, John', 'Has a, comma'],
    ]);
  });

  test('handles escaped quotes', () => {
    const csv = 'text,id\n"He said ""hello""",1';
    const result = parseCSV(csv);
    expect(result[1][0]).toBe('He said "hello"');
    expect(result[1][1]).toBe('1');
  });

  test('handles single row', () => {
    const csv = 'a,b,c';
    const result = parseCSV(csv);
    expect(result).toEqual([['a', 'b', 'c']]);
  });
});
