# GitHub + Vercel deploy guide

## 1) GitHub repo

1. Create or open the GitHub repository.
2. Add the remote if needed:
   ```bash
   git remote add origin git@github.com:<username>/<repo>.git
   ```
3. Push the code:
   ```bash
   git add .
   git commit -m "Prepare Vercel webhook deployment"
   git push -u origin main
   ```

## 2) Vercel setup

1. Open https://vercel.com and import the GitHub repository.
2. Set the project root to this repository.
3. Add these environment variables in Vercel:
   - BOT_TOKEN
   - WEBHOOK_URL (the public Vercel URL, for example https://your-project.vercel.app/api/webhook)
4. Deploy.

## 3) Telegram webhook

After deployment, Vercel will expose the webhook endpoint at:

```text
https://your-project.vercel.app/api/webhook
```

If your bot code needs the webhook URL, set it to that value in your environment.
