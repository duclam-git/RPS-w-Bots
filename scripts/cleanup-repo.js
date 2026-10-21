#!/usr/bin/env node
// One-off repo hygiene: stop tracking files that must never be in git (node_modules, temp bot files, the
// SQLite database and its backups). Your working copy keeps them; only git forgets them. Safe to re-run.
//
//   node scripts/cleanup-repo.js --dry-run     show what would change
//   node scripts/cleanup-repo.js               stage the removals; then:  git commit -m "Stop tracking build/runtime files"
//
// (.gitignore already lists these paths, so they will not come back.)

'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dry = process.argv.includes('--dry-run');
const TARGETS = ['node_modules', 'temp_bots', 'data'];

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

try { git(['rev-parse', '--is-inside-work-tree']); }
catch (e) { console.error('Không phải thư mục git (hoặc chưa cài git). Không có gì để dọn.'); process.exit(1); }

const gi = fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
for (const t of TARGETS) {
    if (!new RegExp(`^/?${t}/?\\s*$`, 'm').test(gi)) {
        console.error(`⚠ .gitignore chưa có "${t}/" — hãy thêm vào trước, nếu không file sẽ bị add lại.`);
        process.exit(1);
    }
}

let total = 0;
for (const t of TARGETS) {
    const tracked = git(['ls-files', '--', t]).split('\n').filter(Boolean);
    total += tracked.length;
    console.log(`${t.padEnd(13)} ${String(tracked.length).padStart(5)} file đang được git theo dõi`);
    if (tracked.length && !dry) git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', t]);
}
// a placeholder keeps the (otherwise ignored) temp folder in fresh clones
if (!dry && !fs.existsSync(path.join(root, 'temp_bots', '.gitkeep'))) {
    fs.mkdirSync(path.join(root, 'temp_bots'), { recursive: true });
    fs.writeFileSync(path.join(root, 'temp_bots', '.gitkeep'), '');
}

if (!total) console.log('\nSạch rồi — git không còn theo dõi file nào trong các thư mục trên.');
else if (dry) console.log(`\n(dry-run) ${total} file sẽ bị bỏ khỏi git. Chạy lại không có --dry-run để thực hiện.`);
else console.log(`\nĐã bỏ ${total} file khỏi git (file trên đĩa vẫn còn). Tiếp theo:\n  git add .gitignore temp_bots/.gitkeep\n  git commit -m "Stop tracking build/runtime files"`);
