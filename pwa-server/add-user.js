#!/usr/bin/env node
'use strict';

// add-user.js — friendly helper to add a *bootstrap* admin/staff account to the
// PWA without hand-crafting bcrypt hashes or JSON.
//
// Bootstrap accounts live in the WR26_AUTH_USERS env var (read from
// pwa-server/.env). They always work even if the Google Sheet "Staff" tab is
// empty, so they're the right place for the one or two people who administer the
// app. Day-to-day staff are better added in-app from the admin "Staff" tab,
// which auto-syncs to the PWA — see the README.
//
// Usage:
//   node add-user.js                      # interactive prompts
//   node add-user.js --user caleb --role admin --password 's3cret!'
//   node add-user.js --user jane --role registrar,checkin   # prompts for password
//   node add-user.js --user caleb --role admin --print      # print only, don't touch .env
//
// By default the new/updated user is written into pwa-server/.env (the existing
// WR26_AUTH_USERS array is merged, replacing any account with the same username).
// Pass --print to just print the JSON entry instead of writing the file.
//
// After writing .env, restart the container so it picks up the change:
//   docker compose up -d --build

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');

const VALID_ROLES = ['admin', 'registrar', 'payments', 'checkin', 'readonly'];
const ENV_PATH = path.join(__dirname, '.env');
const ENV_KEY = 'WR26_AUTH_USERS';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print') { args.print = true; continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    }
  }
  return args;
}

function usage() {
  console.log(`
Add a bootstrap admin/staff account to the IMSDA Registration PWA.

  node add-user.js --user <name> --role <roles> [--password <pw>] [--print]

  --user      Username (2-40 chars: letters, numbers, . _ -)
  --role      Comma-separated roles. Valid: ${VALID_ROLES.join(', ')} (default: admin)
  --password  Password (>= 8 chars). Omit to be prompted securely.
  --print     Print the JSON entry only; do not modify .env.
  -h, --help  Show this help.

With no flags, the script prompts for each value interactively.
`);
}

function prompt(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (hidden) {
      // Mask input so passwords aren't echoed to the terminal.
      const onData = (char) => {
        const s = char.toString('utf8');
        if (s === '\n' || s === '\r' || s === '') process.stdout.write('\n');
        else process.stdout.write('*');
      };
      process.stdin.on('data', onData);
      rl.question(question, (answer) => {
        process.stdin.removeListener('data', onData);
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    }
  });
}

function normalizeRoles(raw, fallback) {
  const list = String(raw == null ? '' : raw)
    .split(/[,\s]+/)
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  const out = [];
  for (const r of list) {
    if (!VALID_ROLES.includes(r)) throw new Error(`Unknown role "${r}". Valid roles: ${VALID_ROLES.join(', ')}`);
    if (!out.includes(r)) out.push(r);
  }
  return out.length ? out : fallback;
}

function readExistingUsers() {
  if (!fs.existsSync(ENV_PATH)) return { users: [], lines: [] };
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  const line = lines.find((l) => l.replace(/^export\s+/, '').startsWith(`${ENV_KEY}=`));
  if (!line) return { users: [], lines };
  let value = line.slice(line.indexOf('=') + 1).trim();
  if (value.length >= 2 && ((value[0] === "'" && value.endsWith("'")) || (value[0] === '"' && value.endsWith('"')))) {
    value = value.slice(1, -1);
  }
  try {
    const parsed = JSON.parse(value);
    return { users: Array.isArray(parsed) ? parsed : [], lines };
  } catch (_e) {
    console.warn(`Warning: existing ${ENV_KEY} in .env is not valid JSON; it will be replaced.`);
    return { users: [], lines };
  }
}

function writeEnv(users) {
  // Single-quote the JSON so the bcrypt "$" characters are never treated as shell
  // variable expansions. server.js tolerates these surrounding quotes on read.
  const serialized = `${ENV_KEY}='${JSON.stringify(users)}'`;
  let lines = [];
  if (fs.existsSync(ENV_PATH)) lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  const idx = lines.findIndex((l) => l.replace(/^export\s+/, '').startsWith(`${ENV_KEY}=`));
  if (idx >= 0) lines[idx] = serialized;
  else {
    if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, serialized);
    else lines.push(serialized);
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n').replace(/\n*$/, '\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }

  let username = args.user || args.username;
  if (!username) username = await prompt('Username: ');
  username = String(username).trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
    throw new Error('Username must be 2-40 chars: letters, numbers, . _ -');
  }

  let rolesRaw = args.role || args.roles;
  if (rolesRaw == null) rolesRaw = await prompt(`Roles [${VALID_ROLES.join(', ')}] (default: admin): `);
  const roles = normalizeRoles(rolesRaw, ['admin']);

  let password = args.password || args.pass;
  if (!password) {
    password = await prompt('Password (hidden): ', { hidden: true });
    const confirm = await prompt('Confirm password (hidden): ', { hidden: true });
    if (password !== confirm) throw new Error('Passwords did not match.');
  }
  if (String(password).length < 8) throw new Error('Password must be at least 8 characters.');

  const passwordHash = await bcrypt.hash(String(password), 10);
  const entry = { username, password: passwordHash, roles };

  if (args.print) {
    console.log('\nAdd this object to the WR26_AUTH_USERS array:\n');
    console.log(JSON.stringify(entry, null, 2));
    console.log(`\nOr the full single-line value:\n${ENV_KEY}='${JSON.stringify([entry])}'\n`);
    return;
  }

  const { users } = readExistingUsers();
  const filtered = users.filter((u) => String(u && u.username || '').toLowerCase() !== username);
  const replaced = filtered.length !== users.length;
  filtered.push(entry);
  writeEnv(filtered);

  console.log(`\n${replaced ? 'Updated' : 'Added'} bootstrap account "${username}" (roles: ${roles.join(', ')}) in ${path.relative(process.cwd(), ENV_PATH)}.`);
  console.log('Restart the app to apply:  docker compose up -d --build\n');
}

main().catch((err) => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});
