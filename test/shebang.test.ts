import { parse } from '../src/shebang';

describe('shebang', () => {
    it('should parse basic', () => {
        const parsed = parse('#!/usr/bin/env deno run --version=v1.2.3 --location http://example.com/test')
        expect(parsed).toMatchInlineSnapshot(`
{
  "--version": "v1.2.3",
  "_": [
    "--location",
    "http://example.com/test",
  ],
  "env": {},
}
`);
        expect(Array.from(parsed)).toMatchInlineSnapshot(`
[
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
{
  "_": [],
  "env": {
    "ANOTHER": "with space",
    "DENO_DIR": "/tmp",
  },
}
`);
        expect(Array.from(parsed)).toHaveLength(0);
    });
});
