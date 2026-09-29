## 2024-05-18 - Repeated Regex instantiation for parsing math intents
**Learning:** `isWordMath` creates dozens of Regexes in a loop (`Object.keys().some(...)`) every time `determineIntent` evaluates math expressions. This takes 470ms for 10000 executions instead of 12ms.
**Action:** Move RegExp creation outside of `isWordMath`. Instead of compiling ~40 Regex expressions repeatedly, pre-compile two joined Regex expressions `precompiledHasWordNumbers` and `precompiledHasOps` globally, taking advantage of standard boundary matching `\b`.
