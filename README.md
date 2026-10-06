# SDA&CO — AI Workshop Sales Page

Fully automated registration page. When a student submits the form, it posts
directly to the SDA&Co_Admin Team Telegram group.

---

## Files

```
.
├── index.html                              ← the sales page
├── event-cover.jpg                         ← workshop poster
├── netlify.toml                            ← Netlify configuration
└── netlify/functions/
    └── submit-registration.mjs             ← serverless function
```

---

## How it works

```
Student fills form
      ↓
JavaScript sends data to /api/register
      ↓
Netlify Function receives the data
      ↓
Function reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from environment
      ↓
Posts a formatted message to SDA&Co_Admin Team group
      ↓
Student sees the Khmer thank-you panel
```

The bot token is NEVER exposed to the browser. It lives only on Netlify's
servers as an environment variable.

---

## Deployment — 5 minutes

### Step 1: Regenerate your bot token (IMPORTANT)

Your previous token was visible in a screenshot. Before deploying:

1. Open Telegram → message **@BotFather**
2. Send `/mybots` → pick your bot
3. Select **API Token** → **Revoke current token**
4. Copy the NEW token and save it somewhere safe

### Step 2: Deploy to Netlify

1. Go to **netlify.com** → log in → **Add new site** → **Deploy manually**
2. Drag the entire project folder (containing `index.html`, `event-cover.jpg`,
   `netlify.toml`, and the `netlify/` folder) into the drop zone
3. Wait ~30 seconds for the site to go live
4. You'll get a URL like `https://random-name.netlify.app`

### Step 3: Add environment variables

1. In Netlify → your site → **Site configuration** → **Environment variables**
2. Click **Add a variable** → **Add a single variable**, add these TWO:

   | Key                    | Value                         |
   |------------------------|-------------------------------|
   | `TELEGRAM_BOT_TOKEN`   | (the new token from BotFather)|
   | `TELEGRAM_CHAT_ID`     | `-1003983209176`              |

3. After adding both, go to **Deploys** → **Trigger deploy** → **Deploy site**
   (this is required so the function can read the new env vars)

### Step 4: Test

1. Visit your Netlify URL
2. Scroll to the registration form, fill it in, submit
3. Check your SDA&Co_Admin Team group — a message should arrive within
   a few seconds

### Step 5 (optional): Connect custom domain

1. In Netlify → **Domain management** → **Add a domain**
2. Enter your domain (e.g. `workshop.sdaandco.com`) → follow DNS instructions
3. Netlify will issue a free SSL certificate automatically

---

## Testing locally (optional)

If you want to test on your computer before deploying:

```
npm install -g netlify-cli
netlify dev
```

You'll also need to create a `.env` file in the project root:

```
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=-1003983209176
```

**Never commit `.env` to GitHub** — add it to `.gitignore`.

---

## Troubleshooting

**"Server not configured" error on form submit**
→ Environment variables aren't set, or you didn't redeploy after adding them.
   Go to Netlify → Deploys → Trigger deploy.

**Nothing arrives in the Telegram group**
→ Make sure the bot is a MEMBER of the group AND has ADMIN permission.
   Without admin, the bot can't post.

**Form shows a generic error**
→ Open the browser console (F12 → Console tab) and submit again. The exact
   error will show there. Also check Netlify → Functions → submit-registration
   → logs.

**I want to change the thank-you message**
→ Edit the `successPanel` div in `index.html` (search for `អរគុណ!`).

**I want to add email notifications too**
→ The function can be extended to POST to any API (SendGrid, Mailgun, Resend).
   Ping Claude for an update.

---

## Swapping the poster

Replace `event-cover.jpg` with a new image of the same name. Recommended
size: anything between 800–1600px wide, portrait or square orientation.
Don't change the filename unless you also update the `<img src>` in
`index.html`.

---

Prepared by Coach Sim Dara · SDA&CO Strategic Advisory · Phnom Penh
