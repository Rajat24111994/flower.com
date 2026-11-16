const path = require('node:path');
const { inlineScriptHashes, withSecurityPolicy } = require('../../../flower.com/lib/content-security');
const root = process.argv[2] || path.resolve(__dirname, '../../../flower.com');
const fs = require('node:fs'); const os = require('node:os');
const files = { 'one.html':'<script>\r\nwindow.a = "🌸";\r</script><script src="a.js">ignored</script><script type="application/ld+json">{}</script><script> \uFEFF \uFEFF </script>',
 'two.html':'<script>\nwindow.a = "🌸";\n</script><script>unicode-close</script\u00A0><script>\u0085</script>', 'ignored.HTML':'<script>uppercase extension ignored</script>' };
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flowerflow-csp-'));
try { for(const [name,html] of Object.entries(files)) fs.writeFileSync(path.join(directory,name),html);
 console.log(JSON.stringify({ hashes:inlineScriptHashes(root), policy:withSecurityPolicy("default-src 'none'; script-src old; connect-src test; script-src duplicate", root), files, fixtureHashes:inlineScriptHashes(directory) }));
} finally { for(const name of Object.keys(files)) fs.unlinkSync(path.join(directory,name)); fs.rmdirSync(directory); }
