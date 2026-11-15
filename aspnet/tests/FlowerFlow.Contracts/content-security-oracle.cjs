const path = require('node:path');
const { inlineScriptHashes, withSecurityPolicy } = require('../../../flower.com/lib/content-security');
const root = process.argv[2] || path.resolve(__dirname, '../../../flower.com');
console.log(JSON.stringify({ hashes:inlineScriptHashes(root), policy:withSecurityPolicy("default-src 'none'; script-src old; connect-src test; script-src duplicate", root) }));
