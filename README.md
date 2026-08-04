# Your portfolio site

A personal portfolio and resume that anyone can view without logging in, and that **you** can edit by clicking on it and typing.

This guide is written for someone who is not a developer. You never need to touch code.

---

## Contents

1. [Seeing it on your own computer first](#1-seeing-it-on-your-own-computer-first)
2. [Putting it online](#2-putting-it-online)
3. [Getting your editing key](#3-getting-your-editing-key)
4. [Editing your portfolio](#4-editing-your-portfolio)
5. [Adding photos and files](#5-adding-photos-and-files)
6. [Changing the design](#6-changing-the-design)
7. [Saving a PDF for job applications](#7-saving-a-pdf-for-job-applications)
8. [When something goes wrong](#8-when-something-goes-wrong)
9. [Things worth knowing](#9-things-worth-knowing)

---

## 1. Seeing it on your own computer first

Double-click **`preview.bat`**. A black window opens and your browser shows the site.

To edit while previewing, go to **http://localhost:8000/?edit=1**

> **Don't double-click `index.html`.** Browsers block pages opened straight from a folder from reading their own data, so you'd just see an error. Always use `preview.bat`.

Close the black window when you're done.

---

## 2. Putting it online

This uses **GitHub Pages** — free, permanent, no ads, no monthly fee.

### Create the repository

1. Go to [github.com/new](https://github.com/new).
2. **Repository name:** type `yourusername.github.io`, using your real GitHub username. The name must match exactly, or the site won't publish.
3. Choose **Public**. (Free GitHub Pages requires this. It only means the files are public — which they'd be anyway, since it's a public website.)
4. Click **Create repository**.

### Upload the files

On the new repository page, click **uploading an existing file**. Then drag in *everything* from your Portfolio folder:

- `index.html`
- `404.html`
- `content.json`
- `README.md`
- `.nojekyll`  ← easy to miss, and it matters
- the whole `assets` folder
- the whole `uploads` folder

Scroll down, click **Commit changes**.

> `.nojekyll` may be hidden on your computer. In File Explorer: **View → Show → Hidden items**.

### Turn on publishing

In your repository: **Settings → Pages**. Under *Build and deployment*, set **Source** to **Deploy from a branch**, branch **main**, folder **/ (root)**. Click **Save**.

Wait about a minute, then visit **`https://yourusername.github.io`**. That's your live site — share that link.

---

## 3. Getting your editing key

To save changes from the website itself, you need a GitHub *access token*. Think of it as a key that lets your browser put changes into your repository. **You only do this once** (until it expires).

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Token name:** `portfolio editing`
3. **Expiration:** pick a date. A year is sensible. (GitHub requires an expiry — see [When your token expires](#when-your-token-expires).)
4. **Repository access:** choose **Only select repositories**, then select your `yourusername.github.io` repository.
5. **Permissions → Repository permissions:** find **Contents** and set it to **Read and write**. Leave every other permission alone.
6. Click **Generate token**, then copy it. **GitHub shows it only once** — copy it before leaving the page.
7. Go to `https://yourusername.github.io/?edit=1`, paste the token into the box, and click **Unlock**.

Your browser remembers it from then on.

### Is this safe?

Yes, and it's worth understanding why:

- **The token is not in your website.** It lives only in your own browser's storage and is sent only to GitHub. Nobody who visits your site can read it.
- **It can only do one thing.** It can edit files in that one repository. It cannot touch your other repositories, your account settings, or anything else.
- **Hiding the edit button isn't the protection.** Anyone can add `?edit=1` and see the editing screen. But without a token GitHub accepts, every attempt to save is rejected by GitHub itself. The real lock is on GitHub's side.
- **On a shared or work computer**, click **Sign out** in the toolbar when you finish. That wipes the token from that browser.

---

## 4. Editing your portfolio

Go to **`https://yourusername.github.io/?edit=1`**.

Everything editable gets a dashed blue outline. Click any of it and type.

| Button | What it does |
|---|---|
| **+ Add …** | Adds a job, project, bullet point, skill, link, or paragraph |
| **↑ ↓** | Moves something up or down |
| **⚙ Details** | Opens fields you can't type on the page directly — web addresses, descriptions |
| **🗑 Delete** | Removes it (asks first) |
| **Site details** | The browser tab title, and the blurb shown in Google and link previews |
| **Add section** | Adds a whole new section, e.g. Volunteering or Publications |
| **View as visitor** | Shows exactly what other people see |
| **Save & Publish** | Sends your changes live |

**Nothing is public until you press Save & Publish.** After saving, allow about a minute for the public site to catch up — that's GitHub rebuilding it.

The dot next to "Editing" in the toolbar turns **amber** when you have unsaved changes and **green** when everything is saved.

### The browser tab title

Click **Site details** in the toolbar. Two fields:

- **Browser tab title** — the text on the browser tab, and the headline in Google results. Leave it empty and it uses your name and job title automatically, updating itself whenever you change them.
- **Short description** — the sentence under your link in Google, and in the preview card when you paste your link into LinkedIn, WhatsApp or Slack. About 150 characters is the sweet spot.

Neither appears anywhere on the page itself.

### Things that behave deliberately

- **Pressing Enter doesn't make a new line.** Each field is one paragraph by design. To add another paragraph or bullet, use the **+ Add** button — that keeps your content tidy and makes the PDF format correctly.
- **Pasting always comes in as plain text.** Paste from Word or Google Docs freely; none of their formatting tags in.
- **Your work is backed up as you type.** If your browser crashes or you close the tab by accident, you'll be offered your unsaved edits back next time.
- **Editing works on your phone**, including taking a photo and attaching it there and then.

---

## 5. Adding photos and files

- **Your profile photo:** the **📷 Add photo** button under your initials.
- **A project cover image:** the **🖼 Cover image** button on that project.
- **A document on a job or project** (a case study, a certificate): the **📎 Attach file** button.
- **A photo gallery or a list of downloads:** use **Add section** and choose *Photo gallery* or *Files to download*.

### The Tools rail (logos)

**Add section → "Tools & logos (side rail)"** creates a panel of tool logos that sits down the right-hand side of your page on a computer, and slots in neatly under your intro on a phone.

Press **+ Add tool** and either pick a logo from the built-in set (search by name), upload your own image, or add it with no logo at all. Anything without a logo gets a two-letter tile in the same style, so it still looks like part of the set rather than a gap.

The logos sit quietly in one colour and bloom into their real brand colour when someone hovers over them. On a phone there is no hover, so they simply stay in the calm version.

Around 30 logos are built in — including Google Sheets, Zapier, Claude, Apps Script, Slack, Dropbox and Synology. Some brands (JotForm, Visual Studio, Dubsado) aren't in the open-source set, so upload their logo or leave the lettermark.

**⚙ Details** on any tool lets you change its name, swap the logo, add a link, or set a custom hover colour.

Photos are automatically shrunk and compressed before uploading, so your site stays fast on a phone. That also strips hidden data from the photo — including the GPS location some phones record.

**Allowed:** images (JPG, PNG, GIF, WebP), PDF, Word, Excel, PowerPoint, text, CSV.

**Not allowed:** `.svg`, `.html`, `.js`, `.xml`. These can carry code, and a file served from your own web address runs with your site's privileges — which could put your saved token at risk. If you have an SVG logo, save it as a PNG first.

Documents over 5 MB get a warning; over 20 MB are refused. Link to very large files instead of hosting them.

When you delete something with a file attached, you'll be asked whether to delete the underlying file too.

---

## 6. Changing the design

Pick from the **design dropdown** in the toolbar. It changes instantly so you can compare, and switching **never alters your content** — only how it looks.

| Design | Best for |
|---|---|
| **Classic professional** | Finance, law, academia, corporate, operations. The default. |
| **Editorial** | When you want presence without losing formality. Magazine typesetting — numbered sections, an opening drop capital, warm paper. Still entirely appropriate for a serious application. |
| **Clean & minimal** | Almost anything. Calm and modern. |
| **Bold & modern** | Design, marketing, creative roles. |
| **Dark & technical** | Engineering, data, technical roles. |

The colour square next to it sets your accent colour.

If you pick a colour too faint to read against that design's background, the site keeps the design's own colour and tells you why. That's deliberate — it stops your headings becoming invisible to visitors.

Changed your mind before saving? Press **Discard** to go back to what's published.

---

## 7. Saving a PDF for job applications

Press **Print / PDF** in the toolbar, then choose **Save as PDF** in the dialog.

Two things are intentional here:

- **The PDF always comes out as a classic professional resume**, whichever design your site uses. A dark or bold design would waste ink and can confuse the automated systems that scan CVs.
- **There is no download button on your public page.** Visitors read your portfolio on the web; the PDF is yours, for applications and attachments.

Because the PDF is generated from the site itself, it can never be out of date.

Works on your phone too, via the print option in the share menu.

---

## 8. When something goes wrong

**"Nothing loaded" / an error box**
GitHub Pages takes about a minute after saving. Wait, then refresh.

**Your edits won't save**
Read the red message — it says what GitHub objected to. Usually the token has expired, or it wasn't given *Contents: Read and write* on this repository.

**The page says your content file has a typo**
This only happens if you edited `content.json` directly on GitHub. The message includes a line number. Or restore the last working version: open `content.json` on GitHub → **History** → pick the previous version → **Restore**.

**You want to undo something you already published**
GitHub keeps every version. Open `content.json` in your repository, click **History**, find the version from before the change, and restore it.

### When your token expires

Your site keeps working normally for visitors — only *saving* stops. Create a new token by repeating [section 3](#3-getting-your-editing-key), then click **Sign out** in the toolbar and unlock again with the new one.

### Editing without the editor

If the editor ever misbehaves, you can always edit `content.json` directly on github.com — click the file, then the pencil icon. Be careful to keep every comma and quotation mark exactly where it is.

---

## 9. Things worth knowing

**Everything in the repository is public.** Not just what's shown on a page — anything in `uploads/` can be opened by anyone with the link. An unlisted file is not a private one. Don't upload anything you wouldn't publish.

**Uploads stay in the history.** Deleting a file removes it from your site, but it remains in the repository's past versions. Harmless for an ordinary portfolio; it only matters if you upload something sensitive by mistake.

**Using your own domain name** (like `alexmorgan.com`): buy the domain, then in your repository go to **Settings → Pages → Custom domain**. GitHub walks you through it and it works with everything above.

---

## For anyone technical looking at this

Static site, no build step, no dependencies, no framework. `content.json` holds the data; `assets/app.js` renders it; `assets/editor.js` loads only when `?edit=1` is present and writes back through the GitHub Contents API using a fine-grained PAT held in `localStorage`.

All user content is written to the DOM with `textContent`/`createElement` — never `innerHTML` — so content can't become script. Uploads are restricted to a non-executable allowlist for the same reason. The accent colour is contrast-checked against the active theme's background (WCAG 3:1 for large text and UI) and rejected if it fails.

Themes are pure CSS custom-property sets keyed on `data-theme`; no theme changes markup or layout. `print.css` overrides the active theme entirely to render a conventional resume.

To add a fifth theme: add a variable block in `assets/themes.css` and an entry in `THEMES` in `assets/editor.js`.
