# Civilion Home — NRI client app

A phone app for your clients abroad to follow their Kerala home being built, plus an admin panel for your office staff and project managers.

**Clients get:** sign-in with an OTP on WhatsApp (or email), the home screen with progress and this week's update, the live site camera, the progress stages, bills & payments in ₹ with an approximate amount in their own currency, decisions to approve (tile choices, variation orders), and chat with their PM (text and photos).

**Staff get (at `/admin`):** projects, client access, stages, weekly updates with photos, cameras, a "today on site" log, bills (with bill PDF and receipt uploads), decisions, chat replies and team roles.

It runs in the browser and clients can add it to their home screen, where it opens like an app (works on iPhone and Android). Nothing has to go through the Play Store or App Store.

---

## What it's made of

| Part | What it does | Cost to start |
|---|---|---|
| **Supabase** (database, logins, file storage, live chat) | Holds all the data and photos. Each client only ever sees their own projects (rules are inside the database). | Free plan to start. The free plan pauses after a week with no activity and holds 1 GB of files, so move to Pro (about US$25/month) once real clients are using it. |
| **GitHub Pages** (website hosting) | Puts the app online at your own address, e.g. `home.civilionbuilders.com` | Free with a public repository |
| **Twilio** (only for WhatsApp OTP) | Sends the sign-in code on WhatsApp | Pay per message, plus Meta must approve your WhatsApp sender. Until that's ready, use email codes (free). |

Files in this folder:

```
supabase/schema.sql        ← run once: creates the database, security rules and file storage
supabase/sample-data.sql   ← optional: loads the "Anil & Divya" demo project from the design
src/                       ← the app itself
public/                    ← icons; put your logo here (see step 5)
```

---

## Setup (about an hour, one time)

You or any web developer can follow this. No server to look after.

### 1. Create the database

1. Sign up at **supabase.com** → **New project**. Name: `civilion-home`. Region: **Mumbai** (closest to Kerala; fine for the Gulf). Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, click **Run**. You should see "Success".
3. *(Optional)* Open `supabase/sample-data.sql`, put **your own** mobile number (digits only, with country code) in the first lines, paste and **Run**. You can then sign in as a "client" and see the demo project filled in.

### 2. Connect the app to the database

1. In Supabase: **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
2. In this folder, copy `.env.example` to a new file named `.env` and paste the two values in.
3. Set how clients sign in in `.env`, under `VITE_CLIENT_LOGIN`:
   - `email`: clients get a 6-digit code by email. **Start here.** It works today and costs nothing.
   - `whatsapp`: the code comes on WhatsApp (needs Twilio, step 4).
   - `sms`: the code comes by SMS (needs Twilio).

### 3. Sign-in settings in Supabase

**Authentication → URL Configuration**: set **Site URL** to your app's address (after step 6), e.g. `https://home.civilionbuilders.com` or `https://YOUR-USERNAME.github.io/civilion-home/`.

**For email codes:**
- **Authentication → Email Templates → Magic Link**: make sure the message shows the code. Add a line like `Your Civilion Home code is {{ .Token }}`.
- **Authentication → SMTP Settings**: Supabase's built-in email only allows a few emails an hour. Connect your own email sender (Zoho Mail, Google Workspace, Resend, Brevo…) before giving the app to clients.

### 4. WhatsApp OTP (when you're ready)

1. Create a **Twilio** account. Set up a **Twilio Verify** service with the WhatsApp channel turned on (Twilio guides you through connecting a WhatsApp Business sender, which Meta has to approve).
2. In Supabase: **Authentication → Providers → Phone** → turn on → provider **Twilio Verify** → paste Account SID, Auth Token and the Verify Service SID.
3. Change `VITE_CLIENT_LOGIN=whatsapp` and redeploy. On the sign-in screen, clients can still switch to "Use email instead".

### 5. Your logo

Put two image files in the `public` folder:
- `logo.png`: your full Civilion logo (wide), shown on the sign-in screen
- `logo-mark.png`: a square version, shown small on the home screen

Without these, the app shows the word **CIVILION**. To change the home-screen app icon, replace the three PNG files in `public/icons/` (192×192, 512×512, and a 512×512 version with extra space around the logo).

### 6. Put it online with GitHub Pages

The folder already has a workflow file (`.github/workflows/deploy.yml`). Every time you push to the `main` branch, GitHub builds the app and publishes it.

1. On **github.com → New repository**, name it `civilion-home`. Leave it **empty** (no README, no .gitignore).
   - On the free GitHub plan, Pages only works if the repository is **Public**. That makes the *code* visible, but none of your clients' data: that stays in Supabase behind its security rules. To keep the code private, you need GitHub Pro.
2. Upload the code. Pick one:
   - **Website:** in the new repository, click **uploading an existing file**. Drag in everything *inside* the `civilion-home` folder (including the hidden `.github` folder, which needs to be visible in your file browser) and commit.
   - **Command line:** in this folder, run
     ```
     git remote add origin https://github.com/YOUR-USERNAME/civilion-home.git
     git push -u origin main
     ```
3. Go to **Settings → Secrets and variables → Actions**.
   - Tab **Secrets**, then **New repository secret**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
   - Tab **Variables** *(optional)*: add `VITE_CLIENT_LOGIN` = `whatsapp` once WhatsApp OTP is set up. Without it, the app uses email codes.
4. Go to **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
5. Go to **Actions → Deploy to GitHub Pages → Run workflow** (or just push any change). After about 2 minutes the app is live at
   `https://YOUR-USERNAME.github.io/civilion-home/`
6. *(Recommended)* Use your own address: **Settings → Pages → Custom domain**, enter `home.civilionbuilders.com`. At your domain registrar, add a **CNAME** record `home` pointing to `YOUR-USERNAME.github.io`. Then tick **Enforce HTTPS**, and run the workflow again so the app switches to the new address.

From then on, any change you push goes live automatically.

*Prefer Netlify?* That also works: import the same GitHub repository there with build command `npm run build` and publish folder `dist`.

### 7. Make yourself the admin

1. Supabase → **Authentication → Users → Add user → Create new user**: your work email + a password, tick **Auto Confirm User**.
2. **SQL Editor**, run (with your email):
   ```sql
   update public.profiles set role = 'admin', full_name = 'Your Name'
   where email = 'you@yourcompany.com';
   ```
3. Open the app → **Staff sign in** → you land in the admin panel.

Add PMs and office staff the same way (step 1). Then go to **Admin → Team** and set their role to **Staff**.

---

## Everyday use (for staff)

1. **Projects → New project.** It starts with 8 standard stages, which you can rename.
2. **Overview:** contract amount, PM name and WhatsApp number, the client's currency, and **How to pay** (your bank details, shown to the client).
3. **Clients:** add the husband, wife, parents… by mobile number and/or email. Press **Send invite** to send them the link on WhatsApp.
4. **Updates:** every week, write what happened and attach photos straight from your phone. Photos are shrunk automatically.
5. **Stages:** press **Make current** on the stage you're in. Earlier stages get ticked off and the home screen line updates.
6. **Bills:** add the bill → upload the BOQ bill PDF → when paid, press **Mark paid** and upload the receipt.
7. **Decisions:** add the options with photos and any extra cost. The client picks one and confirms, and the app records their name and the time.
8. **Chat:** reply to clients. Also update **% complete** in Overview now and then.

Staff can open the admin panel on a phone too, so site engineers can post updates from site.

---

## Connecting CCTV

The **Live site** screen plays any of these, set per camera under **Cameras & site log**:

| Type | Paste this | Good for |
|---|---|---|
| **Live stream (.m3u8)** | An `https://….m3u8` link | Best quality and control |
| **Embed / YouTube Live** | e.g. `https://www.youtube.com/embed/VIDEO_ID` | Cheapest to start |
| **Snapshot image** | An `https://…jpg` link the camera refreshes | Very slow internet at site |

The apps that come with your cameras (Hik-Connect, CP Plus / EzyKam, etc.) **can't be shown inside another app**, so the video has to be sent somewhere that gives you one of the links above. Your options, easiest first:

1. **YouTube Live (unlisted).** Many Hikvision and CP Plus NVRs can stream to YouTube (look for "RTMP" in the NVR's network settings). If yours can't, a small PC or mini computer at site running OBS can do it. Mark the stream **Unlisted** and paste its embed link. It's free. But anyone who gets the link can watch, and it uses the site's upload bandwidth all day.
2. **A camera cloud service** (e.g. Angelcam, IPCamLive, RTSP.me). You give it the camera's RTSP address and it gives you an embed or `.m3u8` link. It's simple, but you pay monthly per camera, so check current prices.
3. **Your own small streaming server.** A developer installs the free **MediaMTX** program on a cheap cloud server. The site NVR pushes video to it and it gives HTTPS `.m3u8` links. It's the most private option and the cheapest when you have many sites. Have the site **push** video out to the server, because site 4G routers usually can't accept connections coming in.

Rules: the link **must start with `https://`** (browsers block plain `http` video inside apps). Test it on a phone over mobile data before giving it to the client. The "Today on site" notes under the camera come from the **site log** in the same tab.

---

## Security, in plain words

- Clients sign in with a one-time code. There are no passwords to forget.
- A client sees a project **only** if staff added their mobile number or email to it. They can't see other clients, can't change progress or bills, and can only send chat messages and choose an option on a decision. This is enforced inside the database, so it holds even if someone tampers with the app.
- All photos and PDFs are private and opened through short-lived links.
- **Staff can see every project.** Admins can also change roles. Only give staff access to employees.
- Never put the Supabase **service_role** key in this app. It only uses the public "anon" key, which is safe to publish.

---

## Not built yet (good next steps)

- **Push notifications** ("New update posted", "Bill 04 due"). For now, the Chat tab shows a red dot for unread messages.
- **Online payment.** Left out on purpose: bills show "How to pay" with your bank details.
- **Camera recordings / replay timeline** from the design. Live view only for now.
- **Malayalam interface.** Clients can already chat in Malayalam.
- **Play Store / App Store listing.** The same app can be wrapped later (Bubblewrap for Android or Capacitor for both) without rewriting it.
