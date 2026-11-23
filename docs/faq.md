# Gymlytics FAQ

**Applies to:** Gymlytics 0.1.0 · **Last updated:** 2026-11-23 · **Audience:** members, guardians, coaches and front-desk staff

Short answers to the questions we hear most often. For step-by-step instructions, see the [end-user manual](end-user-manual.md). If a fix is needed, use the [troubleshooting guide](troubleshooting.md).

---

## Getting started and accounts

### What is an academy slug, and where do I find it?

It is the short name that identifies your academy, for example `gymlytics-demo`, and it is required on the web sign-in screen. Ask the front desk or your owner if you do not know it. The mobile app only asks for email and password.

### Can I create my own account?

No. Accounts are created by the academy. A member record can include a role, a kiosk PIN and an optional email address. Ask the front desk to add you or to link a guardian account to your child.

### I forgot my password or PIN. Can I reset it myself?

There is no self-service reset in this version. Ask an owner or admin to update the account. PINs are stored as hashes, so nobody can tell you your old PIN — a new one must be set.

### Why can't I see Billing, Reports or Setup?

Menu items are hidden for your role. Coaches cannot see billing, point of sale, passes, reports, curriculum or workspace settings; owners and admins can. Students and guardians do not get the staff console at all — guardians should use the [family portal](end-user-manual.md#15-guardian-first-visit) and students the [mobile app](end-user-manual.md#211-member-mobile-app).

### Can I use the demo accounts on my real academy?

No. The seeded accounts and the password `Password123!` belong to the practice academy only. Change the demo password before using Gymlytics with real members.

---

## Classes, bookings and attendance

### How do I book a class?

Open the mobile app, go to **Schedule**, choose a class and select **Book**. You can also cancel from **My classes**. See [the walkthrough](end-user-manual.md#211-member-mobile-app).

### What happens when a class is full?

Your booking becomes **waitlisted** rather than being rejected. You are not counted as booked until a place opens up. Spots remaining are shown on each class.

### Why was my booking refused?

The most common reasons are: a frozen membership, a past-due balance, an expired membership, reaching your weekly class quota, a cancelled class, or a class that has already started. The app shows the reason. A guardian also needs the "can book classes" permission for a child.

### Can I book for my child?

Yes, if the front desk gave you that permission. Use the **Family** tab in the app for dependents you can act for. If the action is missing, ask the front desk to update the link.

### Can I cancel at the last minute?

Yes, up to the class start time without penalty. Open **My classes**, select **Cancel booking**, then confirm. Choose **Keep it** to leave the booking unchanged.

### I forgot to scan out. Will it look like I trained all day?

No. Mat time is calculated from the scan times, capped at four hours, and falls back to the scheduled class length when a check-out is missing.

### Can someone be checked in twice for the same class?

No. A repeated PIN tap, QR scan or sync retry returns the original check-in rather than creating a second record.

---

## Front-desk kiosk

### Does check-in still work without Wi-Fi?

Yes. The kiosk stores the check-in and its queue entry in one local transaction, then sends them when the connection returns. The badge reads "Offline — queueing" and shows how many check-ins are waiting. Use **Sync now** to flush the queue manually. See [offline check-in](end-user-manual.md#210-front-desk-check-in-kiosk).

### The PIN was not recognised. What should I do?

Check that you chose the right member, then try **Name** search. If the person has no PIN yet, the front desk must set one. PINs are hashed and cannot be read back.

### The QR card was not recognised.

Type the code manually in the QR field. If it still fails, the front desk needs to re-issue the member card.

### Check-in says "Waiver needed".

The member needs a current signed waiver before stepping on the mat. Use the **Open waiver** button on the kiosk message, sign on the waiver tablet, then check in again.

### Check-in says membership is past due.

The check-in still succeeds, but an amber warning appears so the front desk can follow up. Booking a class may still be blocked until the account is current.

### Can I add a visitor who has no account?

Yes. Choose **+ Register a drop-in visitor**, fill in name and phone, then **Register & open waiver**. The visitor is marked pending waiver and cannot check in until it is signed.

### Why does the kiosk show an old roster?

It uses the last downloaded copy while offline. Select **Refresh** when online to get the newest roster and class list.

### Do I need to pair every tablet?

Yes, once per tablet. Each device needs its own **Device id** and the academy's device key. **Unpair** removes that pairing and requires the key again.

---

## Waivers

### Who has to sign a waiver?

Every member or visitor before training. For someone under 18, a parent or guardian must sign and provide their name alongside the signer details.

### How long is a waiver valid?

Drop-in waivers last one day. Other waivers last 365 days. The waiver register shows signed, expiring within 30 days and expired records.

### Can a waiver be signed more than once for the same document version?

No. A duplicate signature for the same person and document version is rejected. When the academy publishes a new version, a new signature can be added.

### Can I get a copy of what I signed?

Yes. Right after signing, select **Download PDF**. Staff can also open the PDF from **People → Waivers** by selecting **PDF** on the register row. The document contains the exact version that was signed.

### The waiver page says "This tablet isn't paired".

The waiver tablet must be paired first. Select **Go to pairing** and follow the kiosk pairing steps; then return to `/waiver`.

### A public waiver link does not open.

The widget may have been disabled by an owner, or the subscription may no longer include widgets. Ask the owner to check **Workspace → Embeds** and **Workspace → Plan**.

---

## Billing and payments

### Which payment methods are supported?

Card payments through Stripe, one-off FPX bills through Billplz, and local cards or hosted checkout through iPay88, depending on what your academy has configured. Cash / manual payments are recorded in point of sale. Gymlytics never stores your card number or CVV.

### My renewal failed. What happens next?

The system retries automatically on days 1, 3, 5, 7 and 12. If the payment succeeds, the membership becomes active again. Check your card with your bank if the retries keep failing.

### Can I pause my membership while travelling?

Yes, if your plan allows freezes. An owner or staff member opens **Billing**, selects **Freeze**, enters the number of days and a reason. **Resume** ends a freeze early. Frozen days are added to the end of your membership period.

### How does family pricing work?

Additional family seats receive a discount set by your academy, up to a maximum number of dependents. The payer is recorded separately from the member who trains.

### How do refunds work?

Stripe refunds are handled through the configured provider; Billplz and iPay88 refunds are handled in the provider's portal, not inside Gymlytics in this version. Ask the front desk to confirm which provider handled your payment.

### Can I buy a day pass without a waiver?

No. A valid signed waiver is required before a day pass can be sold.

---

## Family portal and progress

### The family portal says "No linked children".

The guardian account has not been linked to a child yet. Ask the front desk to create the link; it cannot be done from the portal.

### What do "Ready for review" and the missing-item list mean?

"Ready for review" means the belt or stripe requirements (time in rank, classes, mat hours and curriculum) are met. A coach still has to approve and record the promotion. The missing-item list names the requirements not yet met.

### Can I see my child's attendance and belt history on my phone?

You can see their schedule and progression in the **Family** tab. The detailed attendance log is a staff view; ask the front desk if you need a record of specific sessions.

---

## Analytics and reports

### Who can see financial numbers?

Only owner, admin and staff roles. Financial analytics and most reports are hidden for coaches. Members can only see their own data.

### Why has a report not changed after a check-in?

Data flows from the same live source as the dashboard. If the kiosk is offline, its check-ins are queued on the tablet until sync completes. Select **Sync now** on the kiosk, then refresh the report.

### Can I take a report away with me?

Yes. Reports can be exported as CSV for use in a spreadsheet.

---

## Mobile app

### Does the app work offline?

It shows a retryable error when the network is unavailable. In this version there is no offline booking queue; check-ins are queued only on the kiosk.

### Why does the app not ask for an academy slug?

Your academy is set in the app configuration. Use your member email and password. If the wrong academy appears, ask the academy administrator to check the app configuration.

---

## Still need help?

Work through the [troubleshooting guide](troubleshooting.md), then contact your front desk or owner. For technical background, see the [documentation index](README.md).
