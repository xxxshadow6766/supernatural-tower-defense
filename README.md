# Supernatural Tower Defense

A 3D multiplayer tower defense game in the browser. Wizards, witches and dragons defend the Sanctum. No accounts: friends join with a 5-number party code.

## Run it

```
npm install
npm start
```

Then open http://localhost:3000. The server window prints your **Admin key**. Enter it in Settings ⚙ to become an Admin, whose map and difficulty pick overrules the party vote.

## Play with friends

- **Same Wi-Fi:** friends open `http://<your-computer's-IP>:3000`.
- **Over the internet, quick option:** install cloudflared (`winget install Cloudflare.cloudflared`), then run `cloudflared tunnel --url http://localhost:3000` and share the `trycloudflare.com` link it prints.
- **Permanent website:** push this folder to GitHub and create a free Web Service on render.com (Build: `npm install`, Start: `npm start`). Set an `ADMIN_KEY` environment variable there.

## Playing at school (or on any computer)

School laptops and Chromebooks can't run `npm start`, so put the game online once and then just open the link:

1. Make a free GitHub account and create a new repository. Click **Add file → Upload files** and drag in everything in this folder **except** `node_modules` and `admin-key.txt` (that file is your secret admin key).
2. Make a free account at render.com → **New → Blueprint** → choose that repository. `render.yaml` sets everything up.
3. After a few minutes you get a link like `https://supernatural-tower-defense.onrender.com`. Open it on any computer or Chromebook, share it with friends, and play.

Notes:
- Ask a parent/guardian to help with the accounts if you need to, and only play when your school allows it (e.g. at break or lunch).
- The free plan goes to sleep when nobody is playing, so the first visit can take about a minute to load.
- Your admin key is under **Environment** in the Render dashboard.
- On slow laptops the game starts in performance mode and lowers its graphics automatically if it's laggy. You can change this in Settings ⚙.
- Everything (including the 3D engine) is served from your own site, so it doesn't depend on other websites loading.

## Rules

- 10 rounds, 2 minutes each. Once a wave has fully spawned, players can vote to skip ahead.
- **Mana 🔮** is the in-match currency for building and upgrading towers. Every kill gives mana to every player.
- New players get 3 free starter-tower placements in their first match.
- Win a match to earn **coins 🪙** (Easy 60, Medium 150, Hard 300). Spend them in the Shop to unlock new towers. Coins and towers are saved in your browser.
