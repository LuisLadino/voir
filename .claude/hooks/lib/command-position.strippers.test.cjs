#!/usr/bin/env node
// Unit tests for the shared lexical strippers in command-position.cjs (#769).
// These define the canonical behavior every Bash gate now shares. Where the
// canonical regex strips MORE than a pre-#769 per-gate copy, the extra is always
// heredoc-body data (inert) or an invalid-shell construct, so it can only reduce
// false positives, never create a gate false-negative.

const assert = require('assert');
const { stripHeredocs, stripQuotedRegions } = require('./command-position.cjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}

// ---- stripHeredocs: preserve-operator (default) ----

test('preserve: drops body, keeps operator line', () => {
  assert.strictEqual(stripHeredocs('cat <<EOF\nbody line\nEOF'), 'cat <<EOF\n');
});

test('preserve: keeps a same-line redirect on the operator line', () => {
  const out = stripHeredocs('cat <<EOF > /tmp/x\nbody\nEOF');
  assert.ok(out.includes('> /tmp/x'), out);
  assert.ok(!out.includes('body'), out);
});

test('preserve: keeps a same-line pipe so it still reads as a command', () => {
  const out = stripHeredocs('cat <<EOF | git commit\nbody\nEOF');
  assert.ok(out.includes('| git commit'), out);
  assert.ok(!out.includes('body'), out);
});

test("preserve: matching-quoted delimiter <<'EOF'", () => {
  const out = stripHeredocs("cat <<'EOF'\nbody\nEOF");
  assert.ok(!out.includes('body'), out);
});

test('preserve: <<- tab-indented close', () => {
  const out = stripHeredocs('cat <<-EOF\n\tbody\n\tEOF');
  assert.ok(!out.includes('body'), out);
});

test('preserve: same-line EOF) command-substitution close', () => {
  const out = stripHeredocs('x=$(cat <<EOF\nbody\nEOF)');
  assert.ok(!out.includes('body'), out);
});

test('preserve: leading-digit delimiter is stripped (\\w+)', () => {
  const out = stripHeredocs('cat <<1EOF\nbody\n1EOF');
  assert.ok(!out.includes('body'), out);
});

test('preserve: non-string returns empty string', () => {
  assert.strictEqual(stripHeredocs(undefined), '');
  assert.strictEqual(stripHeredocs(null), '');
  assert.strictEqual(stripHeredocs(42), '');
});

test('preserve: no heredoc is a no-op', () => {
  assert.strictEqual(stripHeredocs('echo hello'), 'echo hello');
});

// ---- stripHeredocs: placeholder ----

test('placeholder: replaces the whole span with the default token', () => {
  assert.strictEqual(
    stripHeredocs('cat <<EOF\nbody\nEOF', { mode: 'placeholder' }),
    'cat <<HEREDOC_STRIPPED'
  );
});

test('placeholder: keeps text before <<', () => {
  const out = stripHeredocs('rm -rf ~ <<EOF\nbody\nEOF', { mode: 'placeholder' });
  assert.ok(out.startsWith('rm -rf ~ '), out);
  assert.ok(!out.includes('body'), out);
});

test('placeholder: custom placeholder string', () => {
  assert.strictEqual(
    stripHeredocs('cat <<EOF\nbody\nEOF', { mode: 'placeholder', placeholder: '<<X' }),
    'cat <<X'
  );
});

test('placeholder: <<- indented close stripped (delta vs pre-#769 copies)', () => {
  const out = stripHeredocs('cat <<-EOF\n\tbody\n\tEOF', { mode: 'placeholder' });
  assert.ok(!out.includes('body'), out);
});

// ---- stripQuotedRegions: default (full strip) ----

test('quotes default: removes single- and double-quoted regions', () => {
  assert.strictEqual(stripQuotedRegions(`echo 'a; b' "c | d"`), 'echo  ');
});

test('quotes default: honors escaped quote inside double quotes', () => {
  assert.strictEqual(stripQuotedRegions('echo "a \\" b"'), 'echo ');
});

test('quotes default: removes a $(...) inside quotes too', () => {
  assert.strictEqual(stripQuotedRegions('echo "$(git commit)"'), 'echo ');
});

// ---- stripQuotedRegions: preserveSubstitutions ----

test('quotes preserve-subs: keeps $(...) inside double quotes', () => {
  const out = stripQuotedRegions('x="$(git commit)"', { preserveSubstitutions: true });
  assert.ok(out.includes('$(git commit)'), out);
});

test('quotes preserve-subs: keeps backtick substitution', () => {
  const out = stripQuotedRegions('y="`git commit`"', { preserveSubstitutions: true });
  assert.ok(out.includes('`git commit`'), out);
});

test('quotes preserve-subs: drops plain quoted literal', () => {
  const out = stripQuotedRegions('echo "; git commit"', { preserveSubstitutions: true });
  assert.ok(!out.includes('git commit'), out);
});

test('quotes: non-string returns empty string', () => {
  assert.strictEqual(stripQuotedRegions(undefined), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
