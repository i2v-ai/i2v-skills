import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

const [portable, claude, marketplace, portableMcp, claudeMcp] = await Promise.all(
  ['plugin.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'mcp.json', '.mcp.json'].map(read),
);

for (const field of ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license']) {
  assert.deepEqual(claude[field], portable[field], `Claude plugin ${field} differs from the portable manifest`);
}
assert.equal(marketplace.owner.name, portable.author.name);
assert.deepEqual(marketplace.plugins, [{ name: portable.name, source: './' }]);
assert.deepEqual(portableMcp.mcpServers, {
  i2v: { type: 'streamable-http', url: 'https://i2v.ai/api/mcp' },
});
assert.deepEqual(claudeMcp.mcpServers, {
  i2v: { type: 'http', url: 'https://i2v.ai/api/mcp' },
});
assert.equal(portable.repository, 'https://github.com/i2v-ai/i2v-skills');

for (const skill of ['i2v-models', 'i2v-integrate']) {
  const source = await readFile(new URL(`../${skill}/SKILL.md`, import.meta.url), 'utf8');
  assert.match(source, /^---\n/, `${skill}/SKILL.md needs frontmatter`);
  assert.match(source, /\nname: /, `${skill}/SKILL.md needs a name`);
  assert.match(source, /\ndescription: /, `${skill}/SKILL.md needs a description`);
  assert.ok(!source.includes('/Users/'), `${skill}/SKILL.md must not contain local paths`);
}

console.log('Manifests and Skills are consistent.');
