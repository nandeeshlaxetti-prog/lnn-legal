# 🧠 Linking Your LNN Legal AI "Brain" — v3.2.0

To activate the **AI Reasoning Engine** for your litigation strategy, follow these precise steps to generate and link your Gemini API Key.

### 📜 Part 1: How to Generate Your Gemini Key
1.  **Navigate to Google AI Studio**: Go to [aistudio.google.com](https://aistudio.google.com/).
2.  **Sign In**: Use your firm's primary Google/Gmail account.
3.  **Generate API Key**:
    *   Click the **"Get API key"** button in the left-hand sidebar.
    *   Select **"Create API key in new project"**.
4.  **Copy Your Key**: Once generated, copy the long string of characters (it usually starts with `AIza...`). 
    *   **⚠️ Security Warning**: Never share this key in public chats or emails.

---

### 🛡️ Part 2: How to Link the Key to Your Dashboard
Now you must tell your software to use this key for thinking and briefing.

1.  **Open Vercel**: Go to your [Vercel Dashboard](https://vercel.com/dashboard).
2.  **Select Your Project**: Click on your **"lnn-legal"** (or Office Management) project.
3.  **Navigate to Settings**:
    *   Click on the **"Settings"** tab at the top.
    *   Select **"Environment Variables"** from the left-hand menu.
4.  **Add the Variable**:
    *   **Key**: `GEMINI_API_KEY`
    *   **Value**: *[Paste your key here from Google AI Studio]*
    *   **Save**: Click the **"Add"** or **"Save"** button.

---

### 🚀 Part 3: Deploying the AI "Brain"
Environment variables only take effect on the **NEXT** build.

1.  **Go to the 'Deployments' Tab** in Vercel.
2.  **Click the '...' Icon** next to your latest production deployment.
3.  **Select 'Redeploy'**. 
4.  **Refresh your Dashboard**: Once the build finishes (about 30 seconds), hard refresh your browser (**Cmd + Shift + R**).

---

### ✅ Success Verification:
*   Open the **LNN Brain** sidebar.
*   The **"AI Intelligence Link"** light should now be **GREEN** 🟢.
*   Type a query like *"Summarize the current litigation workload"* and the Brain will now respond with real-time analysis of your Supabase database.

⚖️🦾🚀🛰️📡🛡️🔍⚙️💎🧩🏁💡🧠
