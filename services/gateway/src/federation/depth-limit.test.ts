import { buildSchema, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { depthLimit } from './depth-limit';

const schema = buildSchema(`
  type Node { id: ID!, child: Node }
  type Query { node: Node }
`);

const check = (query: string, max: number) => validate(schema, parse(query), [depthLimit(max)]);

describe('depthLimit', () => {
  it('accepts shallow queries', () => {
    expect(check('{ node { id child { id } } }', 3)).toHaveLength(0);
  });

  it('rejects queries that are too deep, including through fragments', () => {
    expect(check('{ node { child { child { child { id } } } } }', 3)[0]?.message).toMatch(
      /exceeds the maximum of 3/,
    );
    const viaFragment = 'fragment F on Node { child { child { id } } } { node { child { ...F } } }';
    expect(check(viaFragment, 3)).toHaveLength(1);
  });

  it('ignores introspection fields', () => {
    expect(check('{ __schema { types { name } } }', 1)).toHaveLength(0);
  });
});
