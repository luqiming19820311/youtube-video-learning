# Privacy

Effective: August 17, 2026

YouTube Digest is a GitHub-only, bring-your-own-key Chrome extension. It has no YouTube Digest account, developer-operated backend, analytics, advertising, or telemetry.

## Data the extension handles

Depending on the feature you use, YouTube Digest handles:

- the canonical URL and video ID of the active YouTube video;
- transcript text and timestamps;
- video metadata such as title, channel, description, and duration;
- text you select in the transcript and nearby transcript context;
- transcript context around a timestamped note;
- content you ask to translate;
- notes you save;
- Supadata, AI-provider, and optional TTS-provider configuration, including API keys;
- Chinese narration text and in-memory streamed PCM audio when Voice is enabled; and
- cached transcript, digest, and translation results.

## Where data goes

### Supadata

YouTube Digest sends the canonical YouTube video URL to `https://api.supadata.ai` with your Supadata API key. Supadata returns the transcript and timestamps. A Supadata key is required for transcript retrieval.

### DeepSeek

The published version sends AI feature content to the provider and model you select in Settings. DeepSeek V4 Flash is the default; supported alternatives include Groq, Qwen, Volcengine, Gemini, Zhipu GLM, Xiaomi MiMo, local OpenAI-compatible services, and custom OpenAI-compatible endpoints.

- transcript plus relevant title, channel, description, or duration for an overview;
- selected text plus nearby transcript context for an explanation;
- small semantic transcript batches currently needed for progressive Chinese
  translation, or requested overview or explanation content;
- nearby transcript context and video metadata when polishing a saved note.

Each provider has its own API key, endpoint, and model list. Model lists are fetched directly from the selected provider when requested and fall back to built-in IDs when unavailable. API keys remain in Chrome local extension storage and are sent only to the selected provider.

Requests go directly from the extension to Supadata or DeepSeek. They are authenticated with the keys you supply. YouTube Digest's developer does not proxy or receive these requests.

Those services process data under their own terms, privacy policies, retention practices, and account settings. Do not send confidential, personal, or regulated content unless their terms and your obligations permit it.

### Voice and TTS

Voice always starts off when a side-panel session opens and requires Transcript to be enabled. For a Chinese transcript, the extension sends the subtitle text directly to the selected TTS service. For another language, the selected AI provider first receives batches of up to six source segments and returns Chinese text for narration.

When **System local** is selected, speech synthesis is performed by Chrome or the operating system using an installed Chinese voice. YouTube Digest does not send that narration text to a TTS API.

When **Xiaomi MiMo** is selected, the extension sends each Chinese narration segment, a natural-language pace instruction, the selected built-in voice, and your MiMo credential directly to the configured Xiaomi MiMo endpoint. MiMo returns 24 kHz PCM16LE mono audio in streamed Base64 chunks. Audio is decoded and played in memory; YouTube Digest does not save or cache synthesized audio.

## Local storage and retention

YouTube Digest uses Chrome's local extension storage, not a YouTube Digest cloud service.

- Supadata, AI-provider, and Xiaomi MiMo settings and API keys remain on the device in Chrome's extension storage.
- Saved notes remain until you delete them or remove/clear the extension's data. The extension keeps up to 100 notes.
- Recent transcript, digest, and per-segment translation cache entries are stored
  locally. The cache is limited to 20 videos, and entries older than 30 days are
  removed when the side panel opens.

Chrome extension storage is not a password vault. Anyone with sufficient access to your browser profile or device may be able to recover locally stored keys or content. Use scoped keys where providers support them, set spending limits, and rotate or revoke a key if the device or browser profile is compromised.

To remove data:

- delete individual saved notes in YouTube Digest;
- use the Options page to clear cached digests, delete all notes, or reset all extension data;
- remove the extension or clear its stored data from Chrome to delete all local settings, keys, notes, and cache entries; and
- revoke keys in the Supadata or DeepSeek dashboard to stop their future use.

Clearing local data does not delete information already processed or retained by Supadata or DeepSeek. Use each service's controls for service-side requests.

## Permissions

YouTube Digest uses Chrome permissions for these purposes:

- `sidePanel`: display the YouTube Digest interface beside YouTube.
- `storage`: store settings, keys, notes, and cached results locally.
- `tabs`: identify and interact with the active YouTube tab.
- `scripting`: coordinate the extension's YouTube page controls.
- YouTube host access: read the active video's URL and metadata and provide timestamp controls.
- Supadata host access: retrieve transcripts.
- Selected-provider host access: provide AI overviews, explanations, translation, note polishing, and player-caption translation through the provider and model chosen in Settings.
- Optional Xiaomi MiMo host access: test and stream Chinese TTS only after the user selects MiMo and grants the matching host permission.

YouTube Digest does not use these permissions to monitor general browsing activity.

## No sale or advertising use

YouTube Digest does not sell personal information, build advertising profiles, or share data with data brokers. It does not include analytics SDKs.

## Changes

Privacy-relevant changes will be documented in this file and in the repository history. Review updates before installing a new version.

## Questions

This repository does not provide a public support or issue channel. Review this policy, the source code, and each provider's documentation before using the extension. For a vulnerability or accidental secret exposure, follow the private process in [SECURITY.md](SECURITY.md).
