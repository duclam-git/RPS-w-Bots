// Minimal .env loader (no dependency): KEY=VALUE lines, # comments, optional quotes.
// Variables that are already set in the real environment are never overridden.
'use strict';
const fs = require('fs');
const path = require('path');

function parse(text) {
    const out = {};
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
        let val = line.slice(eq + 1).trim();
        const q = val[0];
        if ((q === '"' || q === "'") && val.endsWith(q) && val.length >= 2) val = val.slice(1, -1);
        else val = val.replace(/\s+#.*$/, '');           // trailing comment on an unquoted value
        out[key] = val;
    }
    return out;
}

function load(file = path.join(__dirname, '.env')) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return {}; }
    const vars = parse(text);
    for (const [k, v] of Object.entries(vars)) {
        if (process.env[k] === undefined && v !== '') process.env[k] = v;    // empty = "unset"
    }
    return vars;
}

module.exports = { load, parse };
