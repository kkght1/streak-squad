# Streak Squad

Daily goal check-ins and streaks for a small crew of friends. It runs in any phone browser and can be added to the home screen like an app. Nobody needs an account.

- Each person has their own color, goals and streaks.
- Three goal types: **every day**, **at least N times a week** (e.g. work out 3×), and **at most N times a week** (e.g. alcohol 2×).
- Streaks count days in a row for daily goals, and weeks in a row hitting the target or staying under the limit for weekly goals.
- You can tap earlier days in the week strip to catch up on check-ins you missed.
- Check-ins sync live between phones through a free Firebase database.

## One-time setup (about 10 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and click **Create a project**. Any name works. You can turn Google Analytics off.
2. Go to **Build → Firestore Database → Create database**. Pick a location near you and start in **production mode**.
3. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
4. Go to **Build → Authentication → Get started → Sign-in method**, turn on **Anonymous**, and save.
5. Open **Project settings** (gear icon) → **Your apps**, click the web icon `</>`, register an app (no hosting needed), and copy the `firebaseConfig` object it shows.
6. Paste it into [`firebase-config.js`](firebase-config.js) in place of `null`.

### 2. Turn on GitHub Pages
In this repo go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then **main** and **/ (root)**, and click **Save**. After a minute the app is live at `https://<your-username>.github.io/streak-squad/`.

### 3. Start your crew
1. Open the link on your phone and tap **Start a new crew**. Enter the three names and pick colors.
2. Tap the gear icon, then **Copy invite link**, and text it to your friends. Each of them opens it and picks their own name.
3. On each phone, add it to the home screen:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.

   The home screen app keeps its own storage, so the first time it opens it asks for the **crew code**. The code is shown on the gear screen (e.g. `XX6VY-WG38A`).

## Privacy
Anyone who has your crew code can see and edit your crew, so share it only with the crew. Codes are random and 10 characters long, and the database rules don't allow listing crews.

## Files
| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app |
| `firebase-config.js` | Your Firebase project settings |
| `firestore.rules` | Database access rules to paste into Firebase |
| `manifest.webmanifest`, `sw.js`, `icons/` | Home screen install and offline support |
