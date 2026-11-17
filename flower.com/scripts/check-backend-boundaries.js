// Verify deployment selectors and the production project dependency graph without credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function checkBackendBoundaries() {
    const docker = read('flower.com/backend/Dockerfile');
    assert.match(docker, /ENTRYPOINT\s+\["dotnet",\s*"FlowerFlow\.Api\.dll"\]/);
    assert.doesNotMatch(docker, /FlowerFlow\.Backend|legacy-node|npm\s+(?:run|start)/);
    const render = read('render.yaml');
    assert.match(render, /dockerfilePath:\s*\.\/flower\.com\/backend\/Dockerfile/);
    assert.match(render, /branch:\s*main\s/);
    const dev = read('flower.com/scripts/dev.js');
    assert.match(dev, /backend\/FlowerFlow\.Api/);
    assert.match(dev, /spawn\('dotnet'/);
    const visited = new Set();
    function visit(file) {
        file = path.resolve(file);
        if (visited.has(file)) return;
        visited.add(file);
        assert.doesNotMatch(file, /FlowerFlow\.(?:Backend|Commerce|InMemory)[\\/]/);
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/<ProjectReference\s+Include="([^"]+)"/g))
            visit(path.resolve(path.dirname(file), match[1].replaceAll('\\', '/')));
    }
    visit(path.join(root, 'flower.com/backend/FlowerFlow.Api/FlowerFlow.Api.csproj'));
    assert.ok(visited.size >= 4, 'Production dependency graph must include all application layers');
    for (const directory of ['flower.com/api', 'flower.com/backend/orders'])
        assert.ok(!fs.existsSync(path.join(root, directory)), `Legacy backend must stay under legacy-node: ${directory}`);
    console.log(`Backend boundaries OK: Render/dev -> FlowerFlow.Api; ${visited.size} production projects; legacy and independent hosts isolated.`);
}

if (require.main === module) checkBackendBoundaries();
module.exports = { checkBackendBoundaries };
