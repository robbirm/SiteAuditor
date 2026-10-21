# Snail Chess — Android app

This is a complete Android Studio project that wraps the Snail Chess game (`app/src/main/assets/index.html`)
in a full-screen app. Everything runs offline on the phone.

## Get an APK without installing anything (GitHub builds it for you)

1. Create a new repository on github.com (it can be private) and upload the *contents* of this
   `SnailChess-Android` folder to it — including the hidden `.github` folder
   (drag-and-drop in the GitHub web page works; or use GitHub Desktop).
2. Open the repository's **Actions** tab. The "Build Snail Chess APK" job starts automatically
   (or press **Run workflow**). It takes about 3–5 minutes.
3. When it shows a green tick, open the run and download **SnailChess-apk** under *Artifacts*.
   Unzip it to get `SnailChess.apk`.
4. Copy the APK to your phone and tap it. Android will ask you to allow installing from that
   source (Files / Chrome) — allow it once, then install.

## Updating the app later

When there's a new version of the game, you only need to replace **one file** on GitHub:
`app/src/main/assets/index.html` (open it on GitHub → ⋯ → *Delete file*, commit, then *Add file → Upload files*
into `app/src/main/assets/`, or just upload the new `index.html` there and confirm the replace).
GitHub rebuilds the APK automatically. Download it and tap it on your phone — it installs **over** the old
version and keeps all coins, unlocks and saves, because every build is signed with the same key
(`app/snailchess.keystore`) and gets a higher version number automatically.

## Build and run it in Android Studio

1. Install **Android Studio** (free): https://developer.android.com/studio
2. **File → Open…** and choose this `SnailChess-Android` folder.
   Android Studio downloads Gradle and the Android libraries the first time (a few minutes).
   If it offers to create the Gradle wrapper or upgrade the Android Gradle Plugin, accept.
3. Plug in your phone with **USB debugging** turned on (Settings → About phone → tap *Build number* 7 times,
   then Developer options → USB debugging), or create an emulator in **Device Manager**.
4. Press the green **Run ▶** button. The game installs and opens.

To get an installable file to share: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
The APK appears in `app/build/outputs/apk/debug/`.

## Publishing on Google Play

1. **Build → Generate Signed App Bundle / APK… → Android App Bundle**, create a new keystore
   (keep the keystore file and passwords safe — you need them for every future update).
2. Upload the `.aab` file in the Google Play Console (one-off $25 developer registration).
3. Before you upload, consider:
   - **Package name** — `com.robgames.snailchess` is set in `app/build.gradle` (`applicationId`).
     Change it to something that is yours; it can never change after the first upload.
   - **Donate button** — Google Play has removed apps for linking to outside donation pages.
     To hide the PayPal button in the app, set `show_donate_button` to `false` in
     `app/src/main/res/values/config.xml`. The website version is unaffected.
   - Raise `versionCode` (and `versionName`) in `app/build.gradle` for every update.

## Updating the game

Replace `app/src/main/assets/index.html` with the newest `snail-chess.html` (renamed to `index.html`)
and run/build again. Players keep their coins, unlocks and saves.

## How saving works

- The game stores everything (coins, unlocks, Snail Run progress, settings, chess saves) through
  `window.AndroidBridge` into the app's private storage, so it survives restarts and app updates.
- The game also saves whenever the app goes into the background.
- **Save & load → Download backup** opens Android's "Save to…" picker so players can keep a backup file
  (Google Drive, Downloads…). **Restore backup** opens the file picker to load it again.

## Your PayPal link

Open `app/src/main/assets/index.html`, find `DONATE_URL` near the top of the game script and replace
`REPLACE_WITH_YOUR_BUTTON_ID` with your PayPal donate link (from paypal.com → Pay & Get Paid → Donations,
or a `https://paypal.me/yourname` link). Do the same in the website copy.
