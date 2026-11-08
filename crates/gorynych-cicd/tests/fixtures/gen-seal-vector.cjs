// Тест-вектор шифрования секретов: настоящие electron/cicd/sealedbox.cjs и vendor/tweetnacl.cjs.
//   node crates/gorynych-cicd/tests/fixtures/gen-seal-vector.cjs
// Секретный ключ фиксирован, эфемерный случаен: шифротексты открывает tests/seal_vector.rs.
const fs = require('node:fs');
const path = require('node:path');

const electron = path.resolve(__dirname, '../../../../electron');
const nacl = require(path.join(electron, 'vendor/tweetnacl.cjs'));
const { seal, blake2b } = require(path.join(electron, 'cicd/sealedbox.cjs'));

const secret = new Uint8Array(32).map((_, i) => i + 1);
const pair = nacl.box.keyPair.fromSecretKey(secret);
const publicKey = Buffer.from(pair.publicKey).toString('base64');
const values = ['тайна', '', 'x'.repeat(1000), '🔑 ключ'];
const sealed = values.map((value) => ({ value, sealed: seal(publicKey, value) }));
const hash = Buffer.from(blake2b(Buffer.from('abc'), 64)).toString('hex');
fs.writeFileSync(path.join(__dirname, 'seal-vector.json'), `${JSON.stringify({ secret: Buffer.from(secret).toString('base64'), publicKey, sealed, blake2bAbc: hash }, null, 1)}\n`);
