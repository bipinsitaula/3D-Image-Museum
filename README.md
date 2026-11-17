# 3D Image Museum

A walkable 3D gallery built with three.js. Visitors walk around and look at the
pictures; only the admin can hang, replace or remove them — directly inside the
3D view. One Node process serves the site, the API and the image files.

## Run locally

```bash
npm install
cp .env.example .env      # then set ADMIN_PASSWORD and SESSION_SECRET
npm run dev               # open http://localhost:5173
```

`npm run dev` starts the API on port 3000 and Vite on 5173 (Vite proxies
`/api` and `/images` to the API).

## Using it

| | Desktop | Phone |
|---|---|---|
| Walk | `W` `A` `S` `D` / arrow keys | joystick, bottom-left |
| Run | hold `Shift` | push the joystick to its edge |
| Look | click the room, then move the mouse (`Esc` releases) — or just drag | drag anywhere |
| Turn | `Q` / `E` | — |
| View a picture | click it | tap it (pinch to zoom) |

The visit starts in a lobby facing the entrance; walk through the glass doors
into the main hall.

The round logo button (top-left) or `Esc` opens the menu: resume, back to the
entrance, controls, full screen and curator login.

**Admin:** choose *Curator login* in the menu (or open `/?admin`) and log in. Empty spots
show a dashed “+” placeholder; click any frame to upload, replace, retitle or
remove. Visitors see a clean wall where nothing hangs. The login lasts 7 days
per browser.

In the frame panel you can also:

- **Crop & edit** — crop freely or to a fixed shape (1:1, 4:3, 16:9 …), rotate,
  flip, and adjust brightness, contrast and colour. It works on a newly chosen
  file or on a picture that is already hanging (that one is re-saved from the
  stored 2048 px copy, so repeated edits lose a little quality each time).
- **Frame design** — Black, White, Oak, Gold, Slim or Canvas, per picture.

**Sections:** the building has five sections in a row, joined by doorways, with
the main hall in the middle. Each has label boards hanging from the ceiling just inside its doors (title + text)
and its title above the doors leading into it. In curator mode, click a board
or door sign to edit that section's title and text.

Uploads (max 15 MB) are auto-rotated, shrunk so the longest side is at most
2048 px and saved as WebP, together with a 512 px thumbnail that loads first.

## Where things live

```
server/index.js        Express app: API, auth, static files
server/storage.js      museum.json read/write, sharp image pipeline
shared/layout.js       room size, walls, benches and the list of frame slots
client/src/gallery.js  builds the hall, frames, lights
client/src/controls.js desktop + mobile movement
client/src/admin.js    login and the frame panel
client/src/editor.js   crop / rotate / adjust editor
client/src/menu.js     loading screen, start menu, pause menu
client/public/         logo, icon and favicon
client/src/viewer.js   full-screen image viewer
storage/               images/*.webp and museum.json  (not in git — back this up)
```

To add or move sections, frames, walls, benches or boards, edit `shared/layout.js`. Frame designs
are listed there too; their look (widths, colours) is `STYLE_SPECS` in
`client/src/gallery.js`, and the room colours are `PALETTE` in the same file. The server
reads the same file to know which slots exist, so restart it afterwards.
Removing a slot that holds an image hides it; delete the image first.

## API

| Method | Route | Auth |
|---|---|---|
| GET | `/api/museum` | public |
| POST | `/api/login` `{password}` → `{token}` | 10 attempts / 15 min per IP |
| POST | `/api/frames/:slot` (multipart: `image`, `title`, `caption`, `style`) | admin |
| PATCH | `/api/frames/:slot` `{title, caption, style}` | admin |
| DELETE | `/api/frames/:slot` | admin |
| PATCH | `/api/sections/:id` `{title, text}` | admin |
| GET | `/images/:file` | public, cached for a year |

Admin routes need `Authorization: Bearer <token>`.

## Deploy on a VPS (Ubuntu + nginx)

1. Install Node 20.12 or newer, nginx and pm2 (`npm i -g pm2`).
2. Copy the project to the server (everything except `node_modules`, `client/dist`,
   `storage`, `.env`), for example to `/var/www/museum`.
3. Build and configure:

   ```bash
   cd /var/www/museum
   npm ci
   npm run build
   cp .env.example .env
   nano .env        # strong ADMIN_PASSWORD, random SESSION_SECRET, TRUST_PROXY=1
   ```

   Generate the secret with
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

4. Start it and keep it running across reboots:

   ```bash
   pm2 start server/index.js --name museum
   pm2 save
   pm2 startup      # run the command it prints
   ```

5. nginx site (`/etc/nginx/sites-available/museum`, then symlink into `sites-enabled`):

   ```nginx
   server {
       server_name museum.example.com;
       client_max_body_size 15m;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d museum.example.com     # HTTPS
   ```

6. Share `https://museum.example.com` with visitors; use
   `https://museum.example.com/?admin` yourself.

**Updating:** copy the new code, then `npm ci && npm run build && pm2 restart museum`.
`storage/` is untouched by updates.

**Backups:** everything you uploaded is in `storage/`. Copy that folder somewhere
safe on a schedule, e.g. `tar czf museum-$(date +%F).tgz storage/`.

**Changing the password:** edit `.env` and `pm2 restart museum`. Changing
`SESSION_SECRET` as well logs out every admin browser.
