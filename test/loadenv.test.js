'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse, load } = require('../loadenv');

test('.env parsing: comments, quotes, blanks, bad lines', () => {
    const v = parse('# comment\nA=1\nB = "two words" \nC=x # trailing\nD=\n bad line\nE=\'q\'\n1X=no\nF=a=b');
    assert.deepStrictEqual(v, { A: '1', B: 'two words', C: 'x', D: '', E: 'q', F: 'a=b' });
});

test('.env never overrides the real environment and ignores empty values', () => {
    const f = path.join(os.tmpdir(), `ott-env-${process.pid}`);
    fs.writeFileSync(f, 'OTT_T1=fromfile\nOTT_T2=fromfile\nOTT_T3=\n');
    process.env.OTT_T1 = 'fromenv';
    delete process.env.OTT_T2; delete process.env.OTT_T3;
    load(f);
    assert.strictEqual(process.env.OTT_T1, 'fromenv');
    assert.strictEqual(process.env.OTT_T2, 'fromfile');
    assert.strictEqual(process.env.OTT_T3, undefined);
    fs.unlinkSync(f);
    assert.deepStrictEqual(load(path.join(os.tmpdir(), 'does-not-exist-ott')), {});
});
