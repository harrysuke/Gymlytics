# Gymlytics Self-Service Troubleshooting

**Applies to:** Gymlytics 0.1.0 · **Last updated:** 2026-11-23 · **Audience:** all users

Find the message you see, try the steps in order, and stop when the problem is fixed. Nothing here requires technical knowledge. If you are asked to contact someone, tell them the **exact message**, the **time**, the **page or device** and the **member name** involved.

> Do not clear browser data, uninstall the app, delete the tablet's local database or unpair a kiosk unless instructed. Those actions can remove queued check-ins or require a new device key.

---

## Quick triage

| What you see | Most likely cause | Jump to |
| --- | --- | --- |
| "Failed to fetch" on sign-in | The web service is unreachable, not a bad password | [I cannot sign in](#i-cannot-sign-in) |
| "PIN not recognised" | Wrong PIN, or no PIN set | [The kiosk will not recognise a member](#the-kiosk-will-not-recognise-a-member) |
| "Waiver needed" | No current signed waiver | [Check-in is blocked by a waiver](#check-in-is-blocked-by-a-waiver) |
| "Offline — queueing" | The tablet lost its network | [The kiosk is offline or the queue is not shrinking](#the-kiosk-is-offline-or-the-queue-is-not-shrinking) |
| "No classes scheduled today" | No class instance exists for today | [The kiosk shows no classes](#the-kiosk-shows-no-classes) |
| Booking refused | Membership gate, full class or permission | [A booking is refused](#a-booking-is-refused) |
| "This tablet isn't paired" | Kiosk pairing is missing | [The tablet will not pair](#the-tablet-will-not-pair) |
| Sign button stays greyed out | A required waiver field is empty | [The waiver button will not activate](#the-waiver-button-will-not-activate) |
| "No linked children" | Guardian link not created yet | [The family portal is empty](#the-family-portal-is-empty) |
| Widget shows an error | Widget disabled or plan does not include it | [A public widget or trial form does not work](#a-public-widget-or-trial-form-does-not-work) |

---

## Sign-in and accounts

### I cannot sign in

**If you see "Failed to fetch" or the page never loads:**

1. Check your internet connection and reload the page.
2. On a local installation, check that the API is running by opening `http://localhost:3000/health` in a browser. A healthy service returns a response; if nothing loads, the service is down and the sign-in page can only report a fetch failure.
3. If you opened the web app from `127.0.0.1` instead of `localhost`, try `localhost` — or the address your academy gave you — and reload. Development mode works from both, but a stale address can still point at the wrong place.
4. In a hosted installation, confirm the address is the one your academy published. Production only accepts known web addresses; an unknown one is blocked deliberately.

**If you see a wrong-credentials message:**

1. Check the **Email** carefully, including spelling.
2. Check the **Academy slug** on the web sign-in form; the mobile app does not ask for one.
3. Check that Caps Lock is off before retyping the password.
4. If it still fails, ask an owner or admin to reset the password. There is no self-service reset in this version.

**If you land on the kiosk instead of the staff console:** your role is student or guardian. Use the [mobile app](end-user-manual.md#211-member-mobile-app) or the [family portal](end-user-manual.md#15-guardian-first-visit).

### A menu item I need is missing

Menus are role-based, not broken. Ask your owner which role you have and what it includes. Only owners and admins can see Setup, Imports, Embeds, Network and Plan; billing and point of sale are hidden for coaches.

---

## Front-desk kiosk

### The tablet will not pair

1. Confirm the **Academy slug** with the front desk; a typo puts the tablet in the wrong academy.
2. Confirm the **Device key** is the current one issued by the administrator. The demo value is `dev-kiosk-key`; a real academy uses its own secret.
3. Give the tablet a **Device id** no other tablet uses, such as `kiosk-lobby-01`. Duplicate IDs can resolve to the wrong device.
4. Check the connection: pairing needs the network once, even though check-in later works offline.
5. If the tablet was previously unpaired, ask the administrator whether the old device key was rotated.

### The kiosk shows no classes

1. Check the date and time on the tablet. Classes are shown for **today** in the academy's timezone.
2. Select **Refresh** in the **Which class?** panel while online.
3. If the panel still says "No classes scheduled today", ask a coach to open **Operations → Schedule** and confirm that a class instance exists for today. A template alone is not enough.

### The kiosk will not recognise a member

**PIN not recognised:**
1. Confirm the member is in the cached roster ("N members cached" at the bottom of the check-in panel). Select **Refresh** if the cache is old.
2. Try **Name** search with at least two letters of the surname.
3. If the member has no PIN, the front desk must set a 4–8 digit PIN in **Members**. PINs are hashed and cannot be recovered; a new one must be chosen.

**Card not recognised:**
1. Type the member card code manually into the QR field and press Enter.
2. If it still fails, ask the front desk to re-issue the card.

### Check-in is blocked by a waiver

1. Select **Open waiver** on the message, or send the person to the waiver tablet at `/waiver`.
2. Sign the current waiver and wait for the "Waiver signed" confirmation.
3. Return to the kiosk and check in again.

Drop-in waivers expire after one day; other waivers after 365 days. A new document version also requires a new signature.

### Check-in shows a past-due warning

The check-in itself succeeded. The amber line is a prompt for the front desk to follow up on the balance. Booking a class may still be blocked until payment is current.

### The kiosk is offline or the queue is not shrinking

1. Check the badge in the top right. "Offline — queueing" is expected behaviour: check-ins stay on the tablet and appear as **N queued**.
2. Reconnect the tablet to Wi-Fi or the network cable, then select **Sync now** at the bottom of the check-in panel.
3. Retries back off gradually, up to about 60 seconds, so the count may not drop instantly. Wait a minute and check again.
4. If the badge says Online but the queue does not move after several minutes, ask an administrator to check the API and the sync state. Do not unpair the tablet or clear its browser data — that would discard queued check-ins.
5. If the screen reports conflicts, leave the device as it is and ask an administrator. Genuine conflicts are flagged for review, never silently discarded.

### The roster looks out of date

The kiosk uses its last downloaded copy when offline. Select **Refresh** while online. The footer shows when the roster was synced and how many members are cached.

---

## Waivers

### The waiver button will not activate

Every one of these must be complete before **Sign and submit** turns on:

1. A waiver template is selected (the general one is chosen by default).
2. A **Member** is selected from the dropdown, or the member ID field is filled in.
3. **Full legal name** contains more than two characters.
4. The signature box has at least one stroke — sign with a finger, stylus or mouse.
5. The agreement checkbox is ticked.
6. If **Date of birth** shows the signer is under 18, **Parent / guardian name** must also contain more than two characters.

Use **Clear** above the signature box to start the signature again.

### The waiver page says "This tablet isn't paired"

Pair the tablet from `/kiosk` first, then return to `/waiver`. Waivers are signed for a specific academy, so the tablet needs its device pairing.

### The signed PDF does not open

1. Allow pop-ups for the Gymlytics address, then select **Download PDF** again.
2. If you are on a tablet with a pop-up blocker you cannot change, ask staff to open **People → Waivers**, find the member's row and select **PDF** from the staff console.

### A duplicate waiver is rejected

A person can sign each document version only once. If the agreement changed, the academy publishes a new version, which can then be signed.

---

## Members, bookings and payments

### A booking is refused

The message names the gate. The usual causes are:

- **Frozen membership:** a freeze with a future end date blocks booking. `Resume` or waiting for the end date restores access. An expired freeze is treated as active automatically.
- **Past-due balance:** settle the balance with the front desk.
- **Membership expired or no entitlement:** check your plan with the front desk.
- **Weekly quota reached:** your plan allows a set number of classes per week; the next week resets it.
- **Class cancelled or already started:** choose another class.
- **Guardian permission missing:** the front desk must grant "can book classes" on the child's link.

### I think I paid twice

Gymlytics records payments and point-of-sale sales with idempotency keys, so a retried request or repeated webhook should not create a second charge. Ask the front desk to check the transaction ledger and your membership status before contacting the provider. For Billplz and iPay88 refunds, the provider portal handles the refund.

### A frozen membership has not restarted

Check the freeze end date in **Billing**. If the end date has passed, booking access is restored automatically. If the freeze has no end date, it stays frozen until a staff member selects **Resume**.

### A class recap or techniques are missing

A coach must log techniques and write the recap for that class from the class panel in **Schedule**. Until then, the member's app has nothing to show.

---

## Family portal and mobile app

### The family portal is empty

"No linked children" means the guardian link has not been created. The front desk must link your account to the child and set the permissions. Only linked children appear.

### My child's progress looks stale

Promotions appear after a coach records them in **Promotions**. "Ready for review" is eligibility, not a completed promotion. Ask the coach if the requirements are met but no promotion has been recorded.

### The mobile app shows an error instead of classes

1. Check the connection and use the on-screen **Retry**.
2. Sign out and sign in again from **Profile** if the error mentions your session.
3. Mobile has no offline write queue in this version: a booking made without a network is reported as failed, not saved for later. Retry when connected.

### The app shows the wrong academy

The academy is set in the app configuration, not by a sign-in field. Ask the academy administrator to check it.

---

## Analytics, reports and public widgets

### A report or dashboard number looks wrong

1. If the class was checked in on the kiosk, confirm the queue has synced on that tablet (see [the kiosk section](#the-kiosk-is-offline-or-the-queue-is-not-shrinking)).
2. Refresh the page and check the date range filter.
3. Financial views are intentionally hidden for coaches; ask an owner if you need them.

### A public widget or trial form does not work

1. Ask an owner to check **Workspace → Embeds**: a disabled widget stops serving its public page immediately.
2. Ask them to check **Workspace → Plan**: widgets require an eligible subscription tier. A gated page links to the plan page.
3. For a trial form, confirm the confirmation message "Thanks — we'll be in touch". If nothing appears after **Request a trial**, check the connection and try again.

### A cross-training visitor cannot check in

The visitor needs a verified affiliation, a pass and a signed, unexpired waiver. Check the pass status on **Sales & billing → Passes** and use **Open waiver link** if the waiver is missing.

---

## Known limits in this version

These are not faults; they are planned follow-ups documented in the [release notes](release-notes.md#known-limitations-at-010):

- The mobile app has no offline booking queue.
- Billplz and iPay88 refunds are processed in the provider portal.
- There is no automated database backup or staging environment yet.
- No load test result is recorded, so very large academies may need tuning.
- Retention and data-erasure policy must be defined before general availability.

---

## Escalation checklist

When you contact your front desk, owner or administrator, include:

1. The exact message shown on screen (a photo is fine).
2. The time and the page, device or app tab.
3. The member name, class and date involved.
4. For a kiosk: the **Device id** and whether the badge said Online or Offline.
5. What you already tried from this guide.

For service-level problems (the site will not load at all), the [deployment runbook](deployment-runbook.md) has the technical checks an administrator needs.
