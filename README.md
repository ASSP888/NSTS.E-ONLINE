# NSTS.E — School Network E-Testing System

A simple school-network multiple-choice testing system. Teachers create tests, share a 6-character code, and students take tests in a browser.

## AI question generation — free Gemini API

The teacher dashboard can read photos of textbook pages, notes, or slides and draft multiple-choice questions. This version uses **Google Gemini** instead of Anthropic. Google currently lists free-tier pricing for several Gemini models, including Gemini 3.1 Flash-Lite, subject to Google's quotas and policies.

### 1. Create a free Gemini API key

Open the official Google AI Studio:
https://aistudio.google.com/apikey

Create an API key and copy it. Keep it private. Google documents server-side API-key usage and current key requirements here:
https://ai.google.dev/gemini-api/docs/api-key

### 2. Set the key on Windows

Open Command Prompt in this project's folder:

```bat
cd "C:\Users\Noor Office\Desktop\etest-system-secure (1)\etest-system"
```

Then set the key for the current Command Prompt window:

```bat
set GEMINI_API_KEY=YOUR_REAL_GEMINI_KEY
```

Then start the server:

```bat
node server.js
```

You should see:

```text
AI question generation: ENABLED
```

Keep that Command Prompt window open while using the system.

### PowerShell alternative

```powershell
$env:GEMINI_API_KEY="YOUR_REAL_GEMINI_KEY"
node server.js
```

### 3. Open the system

On the same computer:

http://localhost:5000

Then choose **I'm a teacher**. The **Generate questions with AI** panel will be available when the key is configured.

### Important free-tier note

Free access is subject to Google's current model availability, quotas, rate limits, and account eligibility. Gemini supports image input, including multiple images in one request. Inline image requests have a 20 MB total request limit, so the teacher page compresses images before sending them. citeturn0search0turn1search2

This project does not store the API key in `config.json`, HTML, or browser JavaScript. The browser sends images to this server; the server calls Gemini.

### Security

Do not share your Gemini API key. Do not commit it to GitHub. `.gitignore` already excludes common secret files. This local school-network application does not currently provide teacher authentication, so add authentication before exposing it to an untrusted network.

## No npm install required

This project uses Node's built-in HTTP server and `fetch`. Start it with:

```bat
node server.js
```
