/**
 * Nice - Conversational response module
 * Keeps chat-only response policy separate from intent execution logic.
 */

const CONVERSATION_RESPONSES = {
  thanks: [
    'You are very welcome. It is my pleasure to help you.',
    'Thank you for your kind words. I am always here when you need assistance.',
    'I appreciate that. Please feel free to ask me anything at any time.',
    'It is my pleasure. I am glad I could help.',
  ],
  howareyou: [
    'I am doing well, thank you for asking. How may I assist you today?',
    'I am doing great. Thank you for checking in. What would you like help with?',
    'I am ready to help. Please tell me what you would like to do.',
  ],
  identity: [
    'TARUN VAMSI VAKA created NICE ASSISTANT.',
  ],
  goodbye: [
    'Goodbye. Please take care, and I will be here whenever you need me.',
    'See you soon. Have a great day, and feel free to come back anytime.',
    'Thank you for the conversation. I am always available when you need help.',
  ],
  joke: [
    'Certainly. Why do programmers prefer dark mode? Because light attracts bugs.',
    'Of course. What did the ocean say to the shore? Nothing, it just waved.',
    'Sure. Why do scientists not trust atoms? Because they make up everything.',
    'Here is one. I told my computer I needed a break, and now it keeps sending me kitkat ads.',
    'With pleasure. Why was the math book sad? Because it had too many problems.',
  ],
  compliment: [
    'Thank you very much. That is very kind of you.',
    'I appreciate your feedback. I will keep doing my best to assist you.',
    'That is very thoughtful of you. Thank you for saying that.',
  ],
  acknowledge: [
    'Understood. Please let me know how I can help next.',
    'Certainly. I am here whenever you need assistance.',
    'Noted. Please continue whenever you are ready.',
  ],
  general: [
    'I would be happy to chat with you. I can also assist with alarms, notes, apps, and offline tasks.',
    'Certainly. We can talk normally, and I can help with tasks whenever you ask.',
    'Of course. If you want file-based answers, please say: search my files for <topic>.',
  ],
  age: [
    'I do not have a human age, but I am continuously improving to assist you better.',
  ],
  philosophy: [
    'That is a thoughtful question. Many people find meaning through purpose, relationships, and growth. What is your view?',
    'That is a meaningful topic. In my role, my purpose is to support you as clearly and helpfully as possible.',
  ],
};

const MOOD_RESPONSES = {
  sad: 'I am sorry you are feeling sad. If you would like, I can stay with you and help with something gentle like music or a short chat.',
  happy: 'I am glad to hear that. Thank you for sharing your good mood with me.',
  tired: 'I understand. Please take some rest. If you want, I can set a reminder or alarm for you.',
  bored: 'I can help with that. We can chat, I can share a joke, or assist with a quick task.',
  lonely: 'I am here with you. If you would like to talk, I am ready to listen.',
  angry: 'I understand. Please take a slow breath. If you want, we can take this one step at a time together.',
  stressed: 'I am sorry you are feeling stressed. We can break things into smaller steps, and I can help you organize them.',
  anxious: 'That is understandable. Please breathe slowly. If you like, I can guide you through one small next step.',
  excited: 'That sounds wonderful. I am happy for you. Tell me more if you would like.',
  great: 'I am very glad to hear that. Please let me know if I can help with anything.',
  good: 'That is good to hear. I am here whenever you need support.',
  fine: 'Thank you for sharing. If you need anything, I will be glad to help.',
  okay: 'Understood. I am here whenever you would like help or conversation.',
  sick: 'I am sorry you are unwell. Please rest well, and I can set reminders if that helps.',
  unwell: 'I am sorry to hear that. Please take care, and let me know if I can assist you with reminders or simple tasks.',
};

export function buildConversationalReply(parsed, delay = 30) {
  if (parsed?.subtype === 'feeling') {
    const text = MOOD_RESPONSES[parsed?.mood]
      || 'Thank you for sharing how you feel. I am here to support you in any way I can.';
    return { text, delay };
  }

  const subtype = parsed?.subtype && CONVERSATION_RESPONSES[parsed.subtype]
    ? parsed.subtype
    : 'general';
  const list = CONVERSATION_RESPONSES[subtype] || CONVERSATION_RESPONSES.general;
  const index = Math.floor(Math.random() * list.length);
  return { text: list[index], delay };
}

