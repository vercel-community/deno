import { parse } from '../src/shebang';

describe('shebang', () => {
    it('should parse basic', () => {
        const parsed = parse('#!/usr/bin/env deno run --version=v1.2.3 --location http://example.com/test')
        expect(parsed).toMatchInlineSnapshot(`
Object {
  "--version": "v1.2.3",
  "_": Array [
    "--location",
    "http://example.com/test",
  ],
  "env": Object {},
}
`);
        expect(Array.from(parsed)).toMatchInlineSnapshot(`
Array [
  "--version",
  "v1.2.3",
  "--location",
  "http://example.com/test",
]
`);
    });
    it('should parse with env vars', () => {
        const parsed = parse('#!/usr/bin/env DENO_DIR=/tmp ANOTHER="with space" deno run')
        expect(parsed).toMatchInlineSnapshot(`
Object {
  "_": Array [],
  "env": Object {
    "ANOTHER": "with space",
    "DENO_DIR": "/tmp",
  },
}
`);
        expect(Array.from(parsed)).toHaveLength(0);
    });
});
