// Statique uniquement : aucune connexion SQL et aucune application du correctif.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const dir = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'TZ-COMPAT-MANIFEST.json'), 'utf8'))
const hash = t => crypto.createHash('sha256').update(t.replace(/\r\n/g, '\n').replace(/\r/g, '\n')).digest('hex')
function assert(ok, label) { if (!ok) throw new Error(label) }
const patch = fs.readFileSync(path.join(dir, manifest.patch), 'utf8')
assert(hash(patch) === manifest.sha256, 'PATCH_HASH')
assert((patch.match(/create or replace function/gi) || []).length === 9, 'NINE_FUNCTIONS')
assert(manifest.functions.length === 9, 'NINE_EXPECTED_DEFINITIONS')
assert(manifest.functions.every(f => f.otherAttributeDifferences.length === 0), 'ATTRIBUTES')
for (const item of [manifest.applicationWrapper, manifest.productionCompatibility]) {
  assert(hash(fs.readFileSync(path.join(dir, item.path), 'utf8')) === item.sha256, item.path)
}
const compatibility = JSON.parse(fs.readFileSync(path.join(dir, manifest.productionCompatibility.path), 'utf8'))
assert(compatibility.compatible && compatibility.functions.length === 7, 'PRODUCTION_COMPATIBILITY')
assert(compatibility.functions.every(f => f.onlyPlannedChanges), 'ONLY_TIMEZONE_CHANGES')
assert(compatibility.functions.reduce((n, f) => n + f.replacementCount, 0) === 23, '23_EFFECTIVE_SITES')
assert(manifest.tests.exit === 0 && manifest.tests.restored, 'B13_QUALIFIED_AND_RESTORED')
const wrapper = fs.readFileSync(path.join(dir, manifest.applicationWrapper.path), 'utf8')
assert(wrapper.includes('begin;') && wrapper.includes('commit;') && wrapper.includes('\\set ON_ERROR_STOP on'), 'TRANSACTION')
assert(wrapper.includes('TZ_SOURCE_DRIFT') && wrapper.includes('TZ_TARGET_HASH_FAILED') && wrapper.includes('TZ_SECURITY_OR_CONFIG_DRIFT'), 'BLOCKING_ASSERTIONS')
assert(!/sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./.test(patch + wrapper), 'NO_CREDENTIAL')
console.log('PASS — patch, wrapper, sept sources Production, neuf cibles et preuve B13 cohérents')