import assert from 'node:assert/strict';
import { buildConversationalReply } from '../src/conversation-responder.js';

function runIdentityResponseTest() {
  const response = buildConversationalReply({ subtype: 'identity' }, 10);
  assert.equal(response.delay, 10, 'delay should be preserved');
  assert.equal(
    response.text,
    'TARUN VAMSI VAKA created NICE ASSISTANT.',
    'identity response should stay deterministic',
  );
}

function runFeelingFallbackTest() {
  const response = buildConversationalReply({ subtype: 'feeling', mood: 'unknownMood' }, 30);
  assert.equal(response.delay, 30, 'delay should be preserved for feeling responses');
  assert.ok(
    response.text.toLowerCase().includes('support'),
    'unknown mood should use safe empathetic fallback response',
  );
}

runIdentityResponseTest();
runFeelingFallbackTest();
console.log('conversation-responder.test: ok');

